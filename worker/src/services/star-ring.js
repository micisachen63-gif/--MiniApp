import * as Engine from '../game/star-ring.js';
import * as Player from './player.js';
import {loadPlayer,clonePlayer,persistStatements,guardStmt,outboxStmt,classifyDbError} from '../db.js';
import {GameError} from '../game/classes.js';
import {taipeiDay} from '../game/time.js';
import {applyExp} from '../game/idle.js';
import {computeStats} from '../game/stats.js';
import {makeEliteGear} from '../game/gear.js';
import {rngFor} from '../game/rng.js';
import {mapForLevel} from '../game/formulas.js';

const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const parse=JSON.parse;
// Long expeditions reserve the character, not every character on its account.
// Member.account_id remains the real owner so five distinct players are still
// mandatory within a run. Shared presence.char_id UNIQUE prevents any overlap
// with short parties; numeric Telegram owners cannot collide with this prefix.
const presenceKey=tg=>`ring:${tg}`;
// A projection contains no writes or entitlement decisions. Reuse the exact
// server beat among teammates polling the same isolate; any action/checkpoint
// changes rev and invalidates it. Bound both age and memory, never cache DB auth.
const projections=new Map();
function projected(p,index,beats,now){
 const key=`${p.id}:${p.rev}:${index}:${beats}`,hit=projections.get(key);
 if(hit&&now-hit.at>=0&&now-hit.at<120000)return hit.battle;
 const battle=Engine.simulateStage(p.state,index,beats);
 for(const[k,v]of projections)if(now-v.at>=120000||now<v.at)projections.delete(k);
 projections.set(key,{at:now,battle});while(projections.size>48)projections.delete(projections.keys().next().value);
 return battle;
}
const failure=e=>classifyDbError(e)||(/rpg_party_presence/.test(String(e))?new GameError('party','此角色已有組隊，請先完成或離隊',409):/rpg_star_ring_starts/.test(String(e))?new GameError('daily','這個角色今日已出發過',409):e);
const validRequest=b=>{const id=String(b.requestId||'');if(id.length>100)throw new GameError('request','操作編號過長');return id;};
async function load(db,id){const p=await db.prepare('SELECT * FROM rpg_star_ring_runs WHERE id=?').bind(String(id)).first();if(!p)throw new GameError('star_ring','找不到這趟星環遠征',404);p.state=parse(p.state_json);p.members=await rows(db,'SELECT m.*,c.name,c.level,c.base_class,c.class_path,c.gender FROM rpg_star_ring_members m JOIN rpg_characters c ON c.tg_id=m.char_id WHERE m.run_id=? ORDER BY m.joined_at,m.char_id',p.id);return p;}
const member=(p,tg)=>{const m=p.members.find(m=>m.char_id===String(tg));if(!m||m.left_at!=null)throw new GameError('member','你不在這支遠征隊伍中',403);return m;};
const admit=(c,tier)=>{if(!c)throw new GameError('no_character','請先建立角色',404);if(c.level<tier||Engine.rolesOf(c).length===0)throw new GameError('level',`需要 Lv.${tier}${tier>=90?' 並完成二轉':''}`);};
async function mutate(env,id,tg,b,now,fn){for(let attempt=0;attempt<5;attempt++){
 const db=env.DB,request=validRequest(b),p=await load(db,id),op=String(b.action||'system');
 if(request){const old=await db.prepare('SELECT operation FROM rpg_star_ring_operations WHERE run_id=? AND char_id=? AND request_id=?').bind(p.id,String(tg),request).first();if(old){if(old.operation!==op)throw new GameError('request','操作編號已用於其他動作',409);return;}}
 const extra=[];await fn(p,extra);
 const stmts=[db.prepare('UPDATE rpg_star_ring_runs SET status=?,leader_id=?,state_json=?,rev=rev+1,updated_at=?,next_at=? WHERE id=? AND rev=?').bind(p.status,p.leader_id,JSON.stringify(p.state),now,p.next_at,p.id,p.rev),guardStmt(db),...extra];
 if(request)stmts.push(db.prepare('INSERT INTO rpg_star_ring_operations(run_id,char_id,request_id,operation,created_at) VALUES(?,?,?,?,?)').bind(p.id,String(tg),request,op,now));
 try{await db.batch(stmts);return;}catch(e){const f=failure(e);if(f.code==='conflict'&&attempt<4)continue;throw f;}
 }throw new GameError('conflict','遠征狀況正在更新，請重試',409);}
function release(db,p,at,charId=null){const out=[];if(charId){out.push(db.prepare('UPDATE rpg_characters SET party_id=NULL,last_settle_at=?,rev=rev+1,updated_at=? WHERE tg_id=? AND party_id=?').bind(at,at,charId,p.id),db.prepare('DELETE FROM rpg_party_presence WHERE char_id=? AND party_id=?').bind(charId,p.id));}else out.push(db.prepare('UPDATE rpg_characters SET party_id=NULL,last_settle_at=?,rev=rev+1,updated_at=? WHERE party_id=?').bind(at,at,p.id),db.prepare('DELETE FROM rpg_party_presence WHERE party_id=?').bind(p.id));return out;}
async function daily(db,tg,now){const day=taipeiDay(now),used=!!await db.prepare('SELECT 1 FROM rpg_star_ring_starts WHERE char_id=? AND day=?').bind(String(tg),day).first(),busy=!!await db.prepare('SELECT 1 FROM rpg_party_presence WHERE char_id=?').bind(String(tg)).first();return {day,used,busy,canStart:!used&&!busy};}
async function rewards(db,id,tg){const all=await rows(db,'SELECT reward_json FROM rpg_star_ring_rewards WHERE run_id=? AND char_id=? ORDER BY stage',id,String(tg));const total={exp:0,items:{},equipment:[]};for(const row of all){const r=parse(row.reward_json);total.exp+=r.exp;for(const[k,v]of Object.entries(r.items))total.items[k]=(total.items[k]||0)+v;total.equipment.push(...r.equipment);}return total;}
const catalog={tiers:Engine.TIERS,tactics:Engine.TACTICS,shop:Engine.SHOP,scenes:Engine.SCENES,duration:Engine.DURATION,stageMs:Engine.STAGE_MS,hourMs:Engine.HOUR_MS};
export async function list(env,tg,now){await sweep(env,now,6);const db=env.DB,presence=await db.prepare('SELECT party_id FROM rpg_party_presence WHERE char_id=?').bind(String(tg)).first();const open=await rows(db,"SELECT id FROM rpg_star_ring_runs WHERE status='lobby' AND expires_at>? ORDER BY created_at DESC LIMIT 20",now),history=await rows(db,"SELECT r.id FROM rpg_star_ring_runs r JOIN rpg_star_ring_members m ON m.run_id=r.id WHERE m.char_id=? AND (r.status IN('complete','ended') OR m.left_at IS NOT NULL) ORDER BY r.updated_at DESC LIMIT 8",String(tg));const active=presence?.party_id?.startsWith('ring:')?await view(env,presence.party_id,tg,now):null;return {ok:true,...catalog,active,parties:await Promise.all(open.map(x=>view(env,x.id,tg,now))),history:await Promise.all(history.map(x=>view(env,x.id,tg,now))),daily:await daily(db,tg,now),now};}
export const me=list;
export async function create(env,tg,b,now){
 await sweep(env,now,6);const request=validRequest(b),tier=Number(b.tier??40),difficulty=b.difficulty??'normal',tactic=b.tactic??'balanced',config=JSON.stringify({tier,difficulty,tactic});
 if(!Engine.TIERS.some(t=>t.id===tier)||!['normal','advanced'].includes(difficulty)||!Engine.TACTICS.some(t=>t.id===tactic))throw new GameError('config','遠征設定無效');
 if(request){const old=await env.DB.prepare('SELECT run_id,config_json FROM rpg_star_ring_creations WHERE char_id=? AND request_id=?').bind(String(tg),request).first();if(old){if(old.config_json!==config)throw new GameError('request','操作編號已用於其他遠征設定',409);return {ok:true,party:await view(env,old.run_id,tg,now)};}}
 const {player}=await Player.withPlayer(env,String(tg),now),c=player.char;admit(c,tier);
 if(c.party_id)throw new GameError('party','請先完成目前的組隊');
 if((await daily(env.DB,tg,now)).used)throw new GameError('daily','這個角色今日已出發過',409);
 const id=`ring:${crypto.randomUUID().replaceAll('-','')}`,state={id,engineVersion:Engine.ENGINE_VERSION,tier,difficulty,tactic,name:`星環遠征 · ${Engine.TIERS.find(t=>t.id===tier).name}`,actors:[],results:[],departed:{},log:[{at:now,text:'五名旅人集結後，由隊長帶隊啟程。'}]},db=env.DB;
 try{await db.batch([
  db.prepare("INSERT INTO rpg_star_ring_runs(id,leader_id,status,state_json,created_at,updated_at,expires_at,next_at) VALUES(?,?,'lobby',?,?,?,?,?)").bind(id,String(tg),JSON.stringify(state),now,now,now+1800000,now+1800000),
  db.prepare('INSERT INTO rpg_star_ring_members(run_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').bind(id,String(tg),String(c.account_tg_id||tg),now),
  db.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').bind(presenceKey(tg),id,String(tg)),
  ...(request?[db.prepare('INSERT INTO rpg_star_ring_creations(char_id,request_id,run_id,config_json,created_at) VALUES(?,?,?,?,?)').bind(String(tg),request,id,config,now)]:[])
 ]);}catch(e){if(request){const old=await env.DB.prepare('SELECT run_id,config_json FROM rpg_star_ring_creations WHERE char_id=? AND request_id=?').bind(String(tg),request).first();if(old&&old.config_json===config)return {ok:true,party:await view(env,old.run_id,tg,now)};}throw failure(e);}return {ok:true,party:await view(env,id,tg,now)};
}
async function begin(env,p,extra,now){
 const active=p.members.filter(m=>m.left_at==null);if(active.length!==5||active.some(m=>!m.ready)||new Set(active.map(m=>m.account_id)).size!==5)throw new GameError('ready','需要五個不同帳號，且全員準備');
 const actors=[];
 for(const m of active){
  const {player}=await Player.withPlayer(env,m.char_id,now),c=player.char;admit(c,p.state.tier);
  if(c.active_char_id!==m.char_id||c.party_id||c.hp<=0||c.idle_state==='reviving')throw new GameError('changed','有隊員已切換角色、倒地或進入其他戰鬥，請重新準備',409);
  if(await env.DB.prepare('SELECT 1 FROM rpg_guardian_sigils WHERE char_id=? AND trade_id IS NOT NULL LIMIT 1').bind(m.char_id).first())throw new GameError('guardian_trade','請先完成守護天使交易');
  if((await daily(env.DB,m.char_id,now)).used)throw new GameError('daily',`${c.name}今日已出發過`,409);
  actors.push(Engine.snapshot(player));
  extra.push(env.DB.prepare('INSERT INTO rpg_star_ring_starts(char_id,day,run_id,started_at) VALUES(?,?,?,?)').bind(m.char_id,taipeiDay(now),p.id,now),
   env.DB.prepare('UPDATE rpg_characters SET party_id=?,last_settle_at=?,rev=rev+1,updated_at=? WHERE tg_id=? AND rev=? AND party_id IS NULL AND EXISTS(SELECT 1 FROM rpg_accounts WHERE account_tg_id=? AND active_char_id=?) AND EXISTS(SELECT 1 FROM rpg_party_presence WHERE account_id=? AND char_id=? AND party_id=?)').bind(p.id,now,now,m.char_id,c.rev,m.account_id,m.char_id,presenceKey(m.char_id),m.char_id,p.id),guardStmt(env.DB));
 }
 if(p.state.difficulty==='advanced'&&Engine.coverage(actors).missing.length)throw new GameError('party_roles','深入遠征需要不同隊員分擔守護、破陣、支援與壓制');
 Object.assign(p.state,{actors,startedAt:now,endsAt:now+Engine.DURATION,seed:crypto.randomUUID(),results:[],stageTactics:[p.state.tactic]});p.status='running';p.next_at=now+Engine.STAGE_MS;p.state.log.unshift({at:now,text:'星環遠征啟程；伺服器持續推進，離線仍會累積戰果。'});
}
export async function action(env,tg,b,now){const id=String(b.partyId||''),op=String(b.action||b.op||'');await advance(env,id,now);
 if(op==='join')await Player.withPlayer(env,String(tg),now);
 await mutate(env,id,String(tg),{...b,action:op},now,async(p,extra)=>{
  if(['complete','ended'].includes(p.status))throw new GameError('closed','這趟遠征已結束');
  if(op==='join'){
   if(p.status!=='lobby'||p.expires_at<=now)throw new GameError('started','招募已結束');
   if(p.members.some(m=>m.char_id===String(tg)&&m.left_at==null))return;
   if(p.members.filter(m=>m.left_at==null).length>=5)throw new GameError('full','遠征隊伍已滿');
   const c=await env.DB.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').bind(String(tg)).first();admit(c,p.state.tier);
   if(c.party_id||(await daily(env.DB,tg,now)).used)throw new GameError('daily','目前已有戰鬥，或今日已出發過');
   const account=String(c.account_tg_id||tg);
   if(p.members.some(m=>m.account_id===account&&m.char_id!==String(tg)&&m.left_at==null))throw new GameError('account','同帳號只能派一名角色');
   // A player may withdraw an unstarted character and return with another owned
   // character. Historical lobby seats must not hold the UNIQUE owner seat forever.
   const former=p.members.find(m=>m.account_id===account&&m.char_id!==String(tg)&&m.left_at!=null);
   if(former)extra.push(env.DB.prepare('DELETE FROM rpg_star_ring_members WHERE run_id=? AND char_id=? AND left_at IS NOT NULL').bind(p.id,former.char_id),guardStmt(env.DB));
   extra.push(env.DB.prepare('INSERT INTO rpg_star_ring_members(run_id,char_id,account_id,joined_at) VALUES(?,?,?,?) ON CONFLICT(run_id,char_id) DO UPDATE SET left_at=NULL,ready=0,joined_at=excluded.joined_at').bind(p.id,String(tg),account,now),env.DB.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').bind(presenceKey(tg),p.id,String(tg)));p.state.log.unshift({at:now,text:`${c.name}加入遠征隊伍。`});return;
  }
  const m=member(p,tg);
  if(op==='ready'){
   if(p.status!=='lobby')throw new GameError('started','已經出發');
   extra.push(env.DB.prepare('UPDATE rpg_star_ring_members SET ready=? WHERE run_id=? AND char_id=? AND left_at IS NULL').bind(b.ready===false?0:1,p.id,String(tg)));
  }else if(op==='start'){
   if(String(tg)!==p.leader_id)throw new GameError('leader','只有隊長能出發',403);if(p.status!=='lobby')throw new GameError('started','已經出發');await begin(env,p,extra,now);
  }else if(op==='tactic'){
   if(String(tg)!==p.leader_id)throw new GameError('leader','只有隊長能設定戰術',403);
   if(!Engine.TACTICS.some(t=>t.id===b.tactic))throw new GameError('tactic','戰術無效');
   if(p.status==='running'){p.state.nextTactic=b.tactic;p.state.log.unshift({at:now,text:'新戰術將於下一個階段開始時套用。'});}else p.state.tactic=b.tactic;
  }else if(op==='leave'){
   extra.push(env.DB.prepare('UPDATE rpg_star_ring_members SET left_at=? WHERE run_id=? AND char_id=? AND left_at IS NULL').bind(now,p.id,String(tg)),...release(env.DB,p,now,String(tg)));
   p.state.departed[String(tg)]=now;p.state.log.unshift({at:now,text:`${m.name}離開遠征；已完成階段的戰果保留。`});
   if(p.status==='lobby'&&p.leader_id===String(tg)){p.status='ended';p.state.endedAt=now;extra.push(...release(env.DB,p,now));}
   else if(p.status==='running'&&p.members.filter(x=>x.left_at==null&&x.char_id!==String(tg)).length===0){p.status='ended';p.state.endedAt=now;extra.push(...release(env.DB,p,now));}
   else if(p.leader_id===String(tg))p.leader_id=p.members.find(x=>x.left_at==null&&x.char_id!==String(tg))?.char_id||p.leader_id;
  }else throw new GameError('action','遠征操作無效');
  p.state.log=p.state.log.slice(0,30);
 });return {ok:true,party:await view(env,id,tg,now)};
}
async function advance(env,id,now){
 const initial=await load(env.DB,id);if(initial.status==='running'&&initial.next_at>now||!['lobby','running'].includes(initial.status)||initial.status==='lobby'&&initial.expires_at>now)return;
 await mutate(env,id,'system',{},now,async(p,extra)=>{
  if(p.status==='lobby'){if(p.expires_at<=now){p.status='ended';extra.push(...release(env.DB,p,now));}return;}
  if(p.status!=='running')return;
  const s=p.state,due=Math.min(6,Math.max(0,Math.floor((now-s.startedAt)/Engine.STAGE_MS))),fresh=[];
  for(let i=s.results.length;i<due;i++){
   const result=Engine.simulateStage(s,i);s.results.push(result);fresh.push({index:i,result});
   s.log.unshift({at:s.startedAt+(i+1)*Engine.STAGE_MS,text:`${Engine.STAGES[i].name}完成，評價 ${result.grade}；${result.defeated?'已擊退'+Engine.STAGES[i].enemyName:'整頓補給後繼續前行'}。`});
   if(s.nextTactic){s.tactic=s.nextTactic;delete s.nextTactic;}s.stageTactics[i+1]=s.tactic;
  }
  if(!fresh.length)return;
  for(const m of p.members.filter(m=>m.left_at==null)){
   const before=await loadPlayer(env.DB,m.char_id,env);if(!before)continue;
   if(before.char.party_id!==p.id)throw new GameError('conflict','角色遠征狀態剛更新',409);
   const after=clonePlayer(before),actor=s.actors.find(a=>a.id===m.char_id),entries=[],total=await rewards(env.DB,p.id,m.char_id);
   for(const f of fresh){
    const old=await env.DB.prepare('SELECT 1 FROM rpg_star_ring_rewards WHERE run_id=? AND char_id=? AND stage=?').bind(p.id,m.char_id,f.index).first();if(old)continue;
    const r=Engine.stageReward(s,actor,f.index,f.result);after.char.exp+=r.exp;total.exp+=r.exp;for(const[k,v]of Object.entries(r.items))total.items[k]=(total.items[k]||0)+v;total.equipment.push(...r.equipment);
    applyExp(after.char,level=>computeStats(after.char,actor.equipment,level));
    for(const[k,v]of Object.entries(r.items))after.inv[k]=(after.inv[k]||0)+v;
    after.equipment.push(...r.equipment);entries.push({event_id:`star-ring:${p.id}:${m.char_id}:${f.index}`,tg_id:m.char_id,type:'星環遠征',exp_delta:r.exp,note:JSON.stringify({stage:f.index,grade:r.grade,items:r.items})});
    extra.push(env.DB.prepare('INSERT INTO rpg_star_ring_rewards(run_id,char_id,stage,reward_json,created_at) VALUES(?,?,?,?,?)').bind(p.id,m.char_id,f.index,JSON.stringify(r),now));
   }
   if(due===6){after.char.party_id=null;after.char.last_settle_at=s.endsAt;extra.push(env.DB.prepare('DELETE FROM rpg_party_presence WHERE char_id=? AND party_id=?').bind(m.char_id,p.id),outboxStmt(env.DB,{dedupe:`star-ring-complete:${p.id}:${m.char_id}`,target:'dm',tgId:m.char_id,kind:'star_ring_complete',payload:{partyId:p.id,name:s.name,charId:m.char_id,characterName:actor.name,tier:s.tier,completedStages:6,grades:s.results.map(r=>r.grade),grade:s.results.every(r=>r.grade==='S')?'S':s.results.some(r=>r.grade==='B')?'B':'A',rewards:total}},now));}
   extra.push(...persistStatements(env.DB,before,after,{ledger:entries},now));
  }
  s.log=s.log.slice(0,30);p.next_at=s.startedAt+(s.results.length+1)*Engine.STAGE_MS;
  if(due===6){p.status='complete';p.next_at=s.endsAt;}
 });
}
export async function view(env,id,tg,now){await advance(env,id,now);const p=await load(env.DB,id),s=p.state,index=Math.min(5,s.results.length),isRunning=p.status==='running',beats=isRunning?Math.floor(Math.max(0,now-s.startedAt-index*Engine.STAGE_MS)/Engine.BEAT_MS):0;
 const b=isRunning?projected(p,index,beats,now):s.results.at(-1)||null;
 const hourIndex=b?.hourIndex??0,scene=s.startedAt?Engine.sceneFor(s,hourIndex):{...Engine.SCENES[hourIndex],startsAt:null,endsAt:null};
 const members=p.members.map(m=>{const a=b?.actors.find(a=>a.id===m.char_id)||s.actors.find(a=>a.id===m.char_id);return {id:m.char_id,name:a?.name||m.name,base:a?.base||m.base_class,classPath:a?.path||m.class_path,gender:a?.gender||m.gender,level:a?.level||m.level,roles:a?.roles||Engine.rolesOf(m),ready:!!m.ready,left:m.left_at!=null,hp:a?.hp||0,maxHp:a?.maxHp||0,mp:a?.mp||0,maxMp:a?.maxMp||0,guardian:a?.guardian||null,contribution:b?.contribution[m.char_id]||null};});
 const mine=p.members.find(m=>m.char_id===String(tg)),runningProgress=s.startedAt?Math.min(1,Math.max(0,(Math.min(p.status==='ended'?(s.endedAt||p.updated_at):now,s.endsAt)-s.startedAt)/Engine.DURATION)):0;
 return {id:p.id,name:s.name,status:p.status,leaderId:p.leader_id,tier:s.tier,level:s.tier,difficulty:s.difficulty,tactic:s.tactic,nextTactic:s.nextTactic||null,rev:p.rev,createdAt:p.created_at,expiresAt:p.expires_at,startedAt:s.startedAt||null,endsAt:s.endsAt||null,stageIndex:index,completedStages:s.results.length,hourIndex,hourEndsAt:scene.endsAt,scene,scenes:Engine.SCENES.map((d,i)=>s.startedAt?Engine.sceneFor(s,i):{...d,startsAt:null,endsAt:null}),progress:p.status==='complete'?1:runningProgress,nextAt:p.next_at,serverNow:now,
  stages:Engine.STAGES.map((d,i)=>({...d,roles:Engine.stageRoles(s.tier,i),index:i,startsAt:s.startedAt? s.startedAt+i*Engine.STAGE_MS:null,endsAt:s.startedAt? s.startedAt+(i+1)*Engine.STAGE_MS:null,status:s.results[i]?'complete':isRunning&&i===index?'active':'pending',result:s.results[i]?{grade:s.results[i].grade,defeated:s.results[i].defeated,expHours:s.results[i].expHours,coverage:s.results[i].coverage,encounters:s.results[i].encounters}:null})),
  members,battle:b?{stageIndex:index,hourIndex,scene,enemy:{id:b.enemy.id,name:b.enemy.name,hp:b.enemy.hp,maxHp:b.enemy.maxHp,shield:b.enemy.shield,windup:b.enemy.windup,interrupted:b.enemy.interrupted,spell:b.enemy.spell,behavior:b.enemy.behavior,counterRoles:b.enemy.counterRoles,artIndex:b.enemy.artIndex,artUrl:b.enemy.artUrl},members,sequence:b.sequence,events:b.events,coverage:b.coverage,waves:b.waves,objective:b.objective,encounters:b.encounters}:null,log:s.log,engineVersion:s.engineVersion||1,me:mine?{id:String(tg),leader:p.leader_id===String(tg),ready:!!mine.ready,left:mine.left_at!=null,rewards:await rewards(env.DB,p.id,tg)}:null,roleCoverage:Engine.coverage(members.filter(m=>!m.left).map(m=>({...m,path:m.classPath}))),rewardsPreview:{expHours:[18,24],tokens:s.difficulty==='advanced'?[11,12]:[10,11],extraEquipmentChance:s.difficulty==='advanced'?{S:.6,A:.25,B:0}:{S:.35,A:0,B:0},guardianLootBonus:true}};
}
export async function sweep(env,now,limit=15){const due=await rows(env.DB,"SELECT id FROM rpg_star_ring_runs WHERE status IN('lobby','running') AND next_at<=? ORDER BY next_at LIMIT ?",now,Math.max(1,Math.min(30,Number(limit)||15)));const errors=[];for(const r of due)try{await advance(env,r.id,now);}catch(e){errors.push({id:r.id,code:e.code||'internal'});}return {processed:due.length,errors};}
export async function shop(env,tg,b,now){
 if(!b?.offerId)return {ok:true,offers:Engine.SHOP,currency:'star_ring_token',balance:(await env.DB.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='star_ring_token'").bind(String(tg)).first())?.quantity||0};
 const offer=Engine.SHOP.find(x=>x.id===b.offerId),request=validRequest(b);if(!offer||!request)throw new GameError('shop','請選擇商品並提供操作編號');
 for(let n=0;n<4;n++){
  const old=await env.DB.prepare('SELECT reward_json FROM rpg_star_ring_purchases WHERE char_id=? AND request_id=?').bind(String(tg),request).first();if(old){const r=parse(old.reward_json);if(r.offerId!==offer.id)throw new GameError('request','操作編號已用於其他商品',409);return {ok:true,...r};}
  try{const out=await Player.withPlayer(env,String(tg),now,async(w)=>{
   if((w.inv.star_ring_token||0)<offer.cost)throw new GameError('currency','星征徽記不足');w.inv.star_ring_token-=offer.cost;const reward={offerId:offer.id,items:{},equipment:[]};
   // The receipt gives replay stability; a client-selected requestId must never
   // choose a gear roll. Generate the first candidate from private server entropy.
   if(offer.gear){const e=makeEliteGear({id:`ringshop:${crypto.randomUUID()}`,tgId:String(tg),cls:w.char.base_class,classPath:w.char.class_path,tier:mapForLevel(w.char.level),rng:rngFor(crypto.randomUUID()),now});e.source='star_ring';e.name=e.name.replace(/^菁英/,'星征');reward.equipment.push(e);w.equipment.push(e);}else{reward.items[offer.item]=offer.qty;w.inv[offer.item]=(w.inv[offer.item]||0)+offer.qty;}
   return {extra:[env.DB.prepare('INSERT INTO rpg_star_ring_purchases(char_id,request_id,reward_json,created_at) VALUES(?,?,?,?)').bind(String(tg),request,JSON.stringify(reward),now)],ledger:[{event_id:`star-ring-shop:${tg}:${request}`,tg_id:String(tg),type:'星征徽記兌換',item:'star_ring_token',item_delta:-offer.cost,note:offer.name}],result:reward};
  });return {ok:true,...out.result};}catch(e){if(n<3&&(/rpg_star_ring_purchases|rpg_ledger.event_id/.test(String(e))||e.code==='conflict'))continue;throw e;}
 }throw new GameError('conflict','兌換正在更新，請重新整理',409);
}
