import {needsBlue,blueTarget} from '../game/auto-blue.js';
import {choosePotion} from '../game/idle.js';
import {POTIONS} from '../game/constants.js';
import {mapForLevel} from '../game/formulas.js';
import {encounterPlan,roleSkills,validateRole,briefing,assertRoster,initCooperation,prepareMechanic,automaticRoleAction,castRole,roleEvidence,creditMechanic,resolveMechanic,cooperationView} from '../game/party-roles.js';
import {collectionBlessing} from '../game/collection-blessings.js';
import {guardianChance} from '../game/guardian-effects.js';
import {mapElement,bossResistance} from '../game/elements.js';
import {dungeonTheme} from '../game/dungeon-art.js';
import * as P from './player.js';
import { loadPlayer,guardStmt,invDeltaStmt,ledgerStmt,outboxStmt,classifyDbError } from '../db.js';
import { computeStats,nodeFor } from '../game/stats.js';
import { GameError } from '../game/classes.js';
import { specialState,saveSpecial,SKILL_MAP,eligible,validateCast,castSpecial,combatActor,performThiefNativeStrikes,periodic,receiveDamage,damageEnemy,valueOf,autoPartyAction } from '../game/special.js';
import {spendMana,restoreOnAction} from '../game/combat-passives.js';
import { SPECIAL_SKILLS } from '../game/special-data.js';
import {dungeonSkillPool} from '../game/thief-skill-catalog.js';
import { taipeiDay } from '../game/time.js';
export const DUNGEONS=[
 {id:'pillar',name:'百柱遺跡',level:30,map:2,skillLevels:[30]},
 {id:'aegean',name:'愛琴深窟',level:45,map:4,skillLevels:[40,50]},
 {id:'forge',name:'熔爐禁庫',level:60,map:6,skillLevels:[60]},
 {id:'river',name:'冥河秘藏',level:75,map:7,skillLevels:[70]},
 {id:'titan',name:'泰坦寶庫',level:90,map:9,skillLevels:[90]},
 {id:'oracle',name:'神諭星庫',level:105,map:8,skillLevels:[100]},
 {id:'stars',name:'星穹神藏',level:120,map:12,skillLevels:[120]},
 {id:'trial3',name:'英雄傳承試煉',level:90,map:9,trial:3,skillLevels:[]},
 {id:'trial4',name:'神域覺醒試煉',level:120,map:12,trial:4,skillLevels:[]},
];
const rows=async(db,sql,...bind)=>(await db.prepare(sql).bind(...bind).all()).results||[];
async function load(db,id){const p=await db.prepare('SELECT * FROM rpg_parties WHERE id=?').bind(String(id)).first();if(!p)throw new GameError('party','找不到隊伍',404);return {...p,state:JSON.parse(p.state_json),members:await rows(db,'SELECT m.*,c.name,c.level,c.base_class,c.class_path,c.gender,c.collection_active_map FROM rpg_party_members m JOIN rpg_characters c ON c.tg_id=m.char_id WHERE m.party_id=? ORDER BY m.joined_at,m.char_id',p.id)};}
// Multiple rooms may run concurrently (one party per account is still enforced by rpg_party_presence).
const requireMember=(p,tg)=>{if(!p.members.some(m=>m.char_id===tg))throw new GameError('member','你不是這支隊伍的成員',403);};
function enemyFor(p){const a=p.state.actors;const atk=a.reduce((n,x)=>n+x.atk,0);const level=p.state.level;const element=p.kind==='tower'?(p.state.floor>20?'light':p.state.floor>10?'dark':'earth'):({forge:'fire',river:'dark',titan:'earth',oracle:'light',stars:'light',trial3:'light',trial4:'fire'})[p.state.dungeonId]||mapElement(p.state.map);const boss={level,element,elementResist:bossResistance(level,element),artMap:p.state.map,name:dungeonTheme({kind:p.kind,dungeonId:p.state.dungeonId,map:p.state.map,floor:p.state.floor}).name,rank:p.kind==='tower'?(isBoss(p)?'boss':'normal'):'boss',def:level*(p.kind==='tower'?(isBoss(p)?1.05:.65):1.3),maxHp:Math.round(atk*(p.kind==='tower'?(isBoss(p)?5:3)*(1+((p.state.floor-1)%10)*.03):p.state.trial?11:8)),hp:0,buffs:[],dots:[],shield:0,interruptible:p.state.round%2===1,windup:false};boss.hp=boss.maxHp;return boss;}
const isBoss=p=>p.kind!=='tower'||p.state.floor%5===0;
function updateStmt(db,p,now){return db.prepare('UPDATE rpg_parties SET status=?,state_json=?,rev=rev+1,updated_at=? WHERE id=? AND rev=?').bind(p.status,JSON.stringify(p.state),now,p.id,p.rev);}
function cardStmt(db,p,now){return outboxStmt(db,{dedupe:`party:${p.id}:${p.rev+1}`,target:'group',kind:'party_card',payload:{partyId:p.id}},now);}
function releaseStmts(db,p,now){return [db.prepare('UPDATE rpg_characters SET party_id=NULL,last_settle_at=?,rev=rev+1,updated_at=? WHERE party_id=?').bind(now,now,p.id),db.prepare('DELETE FROM rpg_party_presence WHERE party_id=?').bind(p.id)];}
function combatStmts(db,p,now){return p.state.actors.flatMap(a=>[
 db.prepare('UPDATE rpg_characters SET hp=?,mp=?,special_json=?,rev=rev+1,last_settle_at=?,updated_at=? WHERE tg_id=? AND party_id=?').bind(Math.max(1,a.hp),Math.max(0,a.mp),JSON.stringify(a.special),now,now,a.id,p.id),guardStmt(db)
]);}
async function mutate(env,id,tg,b,now,fn){const db=env.DB;for(let n=0;n<4;n++){
 const request=String(b.requestId||'');if(request){const old=await db.prepare('SELECT result_json FROM rpg_party_operations WHERE party_id=? AND char_id=? AND request_id=?').bind(String(id),tg,request).first();if(old)return JSON.parse(old.result_json);}
 const p=await load(db,id),previousStatus=p.status;let stmts=[];const result=await fn(p,stmts);
 if(['won','lost','ended'].includes(p.status)&&!['won','lost','ended'].includes(previousStatus)&&!p.state.endedAt)p.state.endedAt=now;
 stmts.unshift(updateStmt(db,p,now),guardStmt(db));if(!b.silent)stmts.push(cardStmt(db,p,now));
 if(request)stmts.push(db.prepare('INSERT INTO rpg_party_operations(party_id,char_id,request_id,result_json) VALUES(?,?,?,?)').bind(p.id,tg,request,JSON.stringify(result||{ok:true})));
 try{await db.batch(stmts);return result||{ok:true};}catch(e){const error=classifyDbError(e);if(error?.code==='conflict'&&n<3)continue;throw error||e;}
}throw new GameError('conflict','隊伍正在更新，請重試',409);}
function admit(c,p){if(c.level<p.state.level)throw new GameError('level',`需要 Lv.${p.state.level}`);if(p.state.trial&&String(c.class_path).length<p.state.trial-1)throw new GameError('trial','轉職階段不符合此試煉');if(p.kind==='tower'&&(specialState(c).towerBest||0)<p.state.startFloor-1)throw new GameError('tower','請先通關上一區爬塔');}
export async function list(env,tg,now){await sweep(env,now,10);const groupView=null;const presence=await env.DB.prepare('SELECT party_id FROM rpg_party_presence WHERE char_id=?').bind(tg).first();const available=await rows(env.DB,"SELECT id FROM rpg_parties WHERE status='lobby' AND expires_at>? ORDER BY created_at DESC LIMIT 20",now);const recent=await rows(env.DB,`SELECT p.id FROM rpg_parties p JOIN rpg_party_members m ON m.party_id=p.id WHERE m.char_id=? AND p.status IN ('won','lost','ended') ORDER BY p.updated_at DESC LIMIT 10`,tg);const dropRows=await rows(env.DB,'SELECT r.party_id,r.reward_json,r.created_at,p.kind,p.state_json FROM rpg_party_rewards r JOIN rpg_parties p ON p.id=r.party_id WHERE r.char_id=? ORDER BY r.created_at DESC LIMIT 30',tg);const drops=dropRows.map(r=>{let st={},items={};try{st=JSON.parse(r.state_json)||{};}catch{}try{items=JSON.parse(r.reward_json)?.items||{};}catch{}return {partyId:r.party_id,mode:r.kind,name:st.name||'',dungeonId:st.dungeonId||null,trial:st.trial||null,startFloor:st.startFloor||1,floor:st.floor||null,items,at:r.created_at};});return {ok:true,singleGroupSession:false,drops,groupActive:groupView&&["lobby","combat"].includes(groupView.status)?groupView:null,history:await Promise.all(recent.map(r=>view(env,r.id,tg,now))),dungeons:DUNGEONS.map(d=>({...d,cooperation:briefing(encounterPlan('dungeon',d.id),[])})),active:presence?await view(env,presence.party_id,tg,now):null,parties:await Promise.all(available.map(r=>view(env,r.id,tg,now))),now};}
export async function create(env,tg,b,now){
 await sweep(env,now);
 const r=await P.withPlayer(env,tg,now);const c=r.player.char,db=env.DB;const d=DUNGEONS.find(d=>d.id===b.dungeonId);const kind=b.kind==='tower'?'tower':'dungeon';const startFloor=kind==='tower'?[1,11,21].includes(Number(b.startFloor))?Number(b.startFloor):1:1;
 if(kind==='dungeon'&&!d)throw new GameError('dungeon','副本無效');
 const state={name:kind==='tower'?`星穹爬塔 · 第 ${startFloor}–${startFloor+9} 層`:d.name,level:kind==='tower'?30+(startFloor-1)*3:d.level,map:kind==='tower'?2:d.map,trial:d?.trial||null,dungeonId:d?.id||'pillar',startFloor,floor:startFloor,round:1,actors:[],actions:{},log:['隊伍招募中，三人準備後出發。'],rewarded:[],revived:false};
 state.roleRules=encounterPlan(kind,d?.id,kind==='tower'&&startFloor===21?30:startFloor);
 const id=`p${crypto.randomUUID().replaceAll('-','').slice(0,15)}`;const p={id,leader_id:tg,kind,status:'lobby',rev:-1,state};admit(c,p);
 await db.batch([db.prepare("INSERT INTO rpg_parties(id,leader_id,kind,state_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?)").bind(id,tg,kind,JSON.stringify(state),now,now,now+600000),guardStmt(db),db.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').bind(id,tg,c.account_tg_id||tg,now),db.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').bind(c.account_tg_id||tg,id,tg),cardStmt(db,p,now)]).catch(e=>{const error=classifyDbError(e);if(error?.code==='conflict')throw new GameError('group_busy','其他玩家已先開場，請等本場結束',409);throw error||new GameError('party','你已有隊伍，請先離隊');});
 return {ok:true,party:await view(env,id,tg,now)};
}
async function beginParty(env,p,stmts,now){const s=p.state;s.actors=[];
   for(const m of p.members){await P.withPlayer(env,m.char_id,now);const player=await loadPlayer(env.DB,m.char_id,env),c=player.char;admit(c,p);if(await env.DB.prepare('SELECT 1 FROM rpg_guardian_sigils WHERE char_id=? AND trade_id IS NOT NULL LIMIT 1').bind(c.tg_id).first())throw new GameError('guardian_trade','請先完成守護天使交易再出發');if(c.party_id||c.hp<=0||c.idle_state==='reviving')throw new GameError('down','有隊員倒地或仍在其他戰鬥');const active=await env.DB.prepare('SELECT active_char_id FROM rpg_accounts WHERE account_tg_id=?').bind(m.account_id).first();if(active?.active_char_id!==m.char_id)throw new GameError('changed','隊員已切換角色，請重新準備');const st=computeStats(c,player.equipment.filter(e=>e.is_equipped));s.actors.push(combatActor(c,st));stmts.push(env.DB.prepare('UPDATE rpg_characters SET party_id=?,last_settle_at=?,rev=rev+1 WHERE tg_id=? AND rev=? AND party_id IS NULL AND EXISTS(SELECT 1 FROM rpg_accounts WHERE account_tg_id=? AND active_char_id=?)').bind(p.id,now,c.tg_id,c.rev,m.account_id,m.char_id),guardStmt(env.DB));}
   if(s.roleRules)assertRoster(s.roleRules,s.actors);
   initCooperation(s,s.roleRules?encounterPlan(p.kind,s.dungeonId,s.floor):null);
   p.status='combat';s.deadline=now+(s.cooperation?15000:5000);s.roundStarted=now;s.enemy=enemyFor(p);if(s.cooperation){prepareMechanic(s,now);s.log.unshift('職責機制啟動：'+cooperationView(s).name+'；不同隊員分工，三回合內破解。');}s.log.unshift('三位英雄出發，戰鬥由伺服器結算。');stmts.push(env.DB.prepare('UPDATE rpg_parties SET expires_at=? WHERE id=?').bind(now+1800000,p.id));
}
export async function action(env,tg,b,now){const id=String(b.partyId||'');
 if(b.op==='join')await P.withPlayer(env,tg,now);
 await mutate(env,id,tg,b,now,async(p,stmts)=>{
  const s=p.state;
  if(p.expires_at<=now||['ended','lost','won'].includes(p.status))throw new GameError('closed','隊伍已結束或已過期');
  if(b.op==='join'){
   if(p.status!=='lobby')throw new GameError('started','隊伍已出發');if(p.members.length>=3)throw new GameError('full','隊伍已滿');
   if(p.members.some(m=>m.char_id===tg))return {ok:true};
   const c=await env.DB.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').bind(tg).first();if(!c)throw new GameError('character','需要角色');admit(c,p);
   stmts.push(env.DB.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').bind(p.id,tg,c.account_tg_id||tg,now),env.DB.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').bind(c.account_tg_id||tg,p.id,tg));s.log.unshift(`${c.name}加入隊伍。`);return {ok:true};
  }
  requireMember(p,tg);
  if(b.op==='ready'){
   if(p.status!=='lobby')throw new GameError('started','隊伍已出發');stmts.push(env.DB.prepare('UPDATE rpg_party_members SET ready=? WHERE party_id=? AND char_id=?').bind(b.ready===false?0:1,p.id,tg));
  }else if(b.op==='leave'){
   if(p.status==='combat'){p.status='ended';s.log.unshift('隊員離隊，挑戰已中止。');stmts.push(...releaseStmts(env.DB,p,now));return {ok:true};}
   if(tg===p.leader_id){p.status='ended';stmts.push(...releaseStmts(env.DB,p,now));}else stmts.push(env.DB.prepare('DELETE FROM rpg_party_members WHERE party_id=? AND char_id=?').bind(p.id,tg),env.DB.prepare('DELETE FROM rpg_party_presence WHERE party_id=? AND char_id=?').bind(p.id,tg));
  }else if(b.op==='end'){
   if(tg!==p.leader_id)throw new GameError('leader','只有隊長能結束隊伍');p.status='ended';s.log.unshift('隊長結束冒險。');stmts.push(...releaseStmts(env.DB,p,now));
  }else if(b.op==='start'){
   if(tg!==p.leader_id)throw new GameError('leader','只有隊長能出發');if(p.status!=='lobby'||p.members.length!==3||p.members.some(m=>!m.ready)||new Set(p.members.map(m=>m.account_id)).size!==3)throw new GameError('ready','需要三個不同 Telegram 帳號，且全員準備');
   await beginParty(env,p,stmts,now);
  }else if(b.op==='submit'){
   if(p.status!=='combat')throw new GameError('combat','目前沒有首領戰');if(Number(b.round)!==s.round||now>=s.deadline)throw new GameError('round','回合已更新，請重新選擇',409);
   const a=s.actors.find(a=>a.id===tg);if(a.hp<=0)throw new GameError('down','你已倒地，等待隊友復活');
   const skillId=String(b.skillId||'attack');if(skillId.startsWith('role_'))validateRole(a,skillId,s);else if(!['attack','defend'].includes(skillId))validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp,affixPct:a.affixPct},a.special,skillId,now);
   if(b.targetId&&!s.actors.some(a=>a.id===String(b.targetId)))throw new GameError('target','隊友目標無效');
   s.actions[tg]={skillId,targetId:String(b.targetId||tg),manual:true};s.log.unshift(`${a.name}已選擇戰術。`);
  }else throw new GameError('op','隊伍操作無效');s.log=s.log.slice(0,6);return {ok:true};
 });return {ok:true,party:await view(env,id,tg,now)};}
async function advance(env,id,now){return mutate(env,id,'system',{silent:false},now,async(p,stmts)=>{
 const s=p.state;if(p.status!=='combat')return {ok:true};
 if(p.expires_at<=now){p.status='ended';s.log.unshift('冒險逾時，隊伍已結束。');stmts.push(...releaseStmts(env.DB,p,now));return {ok:true};}
 if(now<s.deadline)return {ok:true};
 const enemy=s.enemy;enemy.windup=s.round%3===0;enemy.interruptible=s.round%2===1;enemy.interrupted=false;prepareMechanic(s,now);
 // Keep a bounded replay in the same atomic party update; no per-hit database writes.
 const turnFloor=s.floor;
 const snapshot=(target=enemy,floor=turnFloor)=>({floor,enemyHp:target.hp,enemyMaxHp:target.maxHp,enemyName:target.name,members:s.actors.map(a=>({id:a.id,hp:a.hp,maxHp:a.maxHp,mp:a.mp,maxMp:a.maxMp}))});
 const turn={id:`${p.id}:${s.floor}:${s.round}`,sequence:(s.turnSequence||0)+1,round:s.round,floor:s.floor,at:now,events:[]};
 turn.before=snapshot();
 s.log=[];periodic(s.actors,enemy,now);if(enemy.hp<turn.before.enemyHp)turn.events.push({actorId:null,label:'召喚／持續傷害',damage:turn.before.enemyHp-enemy.hp,effect:'magic',after:snapshot()});
 for(const a of s.actors){if(a.hp<=0)continue;
  const player=await loadPlayer(env.DB,a.id,env),c=player.char,used={};
  stmts.push(env.DB.prepare('UPDATE rpg_characters SET updated_at=updated_at WHERE tg_id=? AND party_id=? AND rev=?').bind(a.id,p.id,c.rev),guardStmt(env.DB));
  // Keep live preferences when persisting the encounter's skill cooldowns.
  if(Object.hasOwn(specialState(c),'autoBluePct'))a.special.autoBluePct=specialState(c).autoBluePct;
  const native=a.skill||nodeFor(a.base,a.path).skill;
  const projected={...a,mp:a.maxMp};
  const planned=s.actions[a.id]||automaticRoleAction({...s,actors:s.actors.map(x=>x.id===a.id?projected:x)},projected)||autoPartyAction(projected,s.actors,enemy,now,s);
  let required=native.cost;
  if(planned.skillId.startsWith('role_'))required=roleSkills(a).find(x=>x.id===planned.skillId)?.mp||0;
  else if(!['attack','defend'].includes(planned.skillId))try{required=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.maxMp,affixPct:a.affixPct},a.special,planned.skillId,now).mp;}catch{required=0;}
  else if(planned.skillId==='defend')required=0;
  if(enemy.hp>0&&needsBlue(c,a.mp,a.maxMp,required)){const target=blueTarget(c,a.maxMp,required);let key;do{key=choosePotion(player.inv,'blue',mapForLevel(c.level));if(!key)break;player.inv[key]--;used[key]=(used[key]||0)+1;a.mp=Math.min(a.maxMp,a.mp+POTIONS[key].heal);}while(a.mp<target);}
  for(const [key,count] of Object.entries(used))stmts.push(env.DB.prepare('UPDATE rpg_inventory SET quantity=quantity-? WHERE tg_id=? AND item=? AND quantity>=?').bind(count,a.id,key,count),guardStmt(env.DB));
  if(Object.keys(used).length){turn.events.push({actorId:a.id,label:'自動喝藍水',used,healedMp:a.mp-turn.before.members.find(m=>m.id===a.id).mp,after:snapshot()});s.log.push(a.name+'：自動喝藍水');}
  const action=s.actions[a.id]||automaticRoleAction(s,a)||autoPartyAction(a,s.actors,enemy,now,s);
  try{let result;if(action.skillId.startsWith('role_')){result=castRole(a,s,action.skillId,now);}
   else if(action.skillId==='defend'){a.buffs.push({type:'nextReduce',value:.35,until:now+60000,uses:1});result={damage:0};}
   else if(action.skillId==='attack'){const rng=()=>crypto.getRandomValues(new Uint32Array(1))[0]/2**32;
    const skill=a.skill||{...nodeFor(a.base,a.path).skill,cost:Math.max(1,Math.round(nodeFor(a.base,a.path).skill.cost*(1+(a.affixPct?.mpCostPct||0))*(1-(a.affixPct?.mpEfficiencyPct||0))))};const cast=a.mp>=skill.cost;
    if(a.base==='thief'){
     result=performThiefNativeStrikes(a,enemy,now,{cast,baseRaw:a.atk*(cast?skill.mult:1.5),rng,actionId:`${turn.id}:${a.id}`});
     result.nativeSkill=cast?skill.name:null;result.spentMp=cast?spendMana(a,skill.cost,rng):0;result.healed=restoreOnAction(a,result.damage,{cast,enabled:enemy.hp>0}).healed;
    }else{
     let raw=a.atk*(cast?skill.mult:1.5)*(1+valueOf(a,'atkUp',now))*(1+valueOf(a,'damageUp',now))*(1+valueOf(a,'nextDamage',now));const crit=rng()<Math.min(.8,a.crit+valueOf(a,'critUp',now));if(crit)raw*=1.5;
     result={damage:damageEnemy(enemy,raw,{},now,a),crit,nativeSkill:cast?skill.name:null,spentMp:cast?spendMana(a,skill.cost,rng):0};result.healed=restoreOnAction(a,result.damage,{cast,enabled:enemy.hp>0}).healed;for(const b of a.buffs)if(['nextDamage','critUp'].includes(b.type)&&b.uses>0)b.uses--;
    }}
   else{const skill=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp,affixPct:a.affixPct},a.special,action.skillId,now);result=castSpecial(a,s.actors,enemy,skill,action.targetId,now,()=>crypto.getRandomValues(new Uint32Array(1))[0]/2**32,s);}
   creditMechanic(s,a,roleEvidence(action.skillId,result,s));
   turn.events.push({actorId:a.id,base:a.base,skillId:action.skillId,targetId:action.targetId,label:action.skillId==='defend'?'防禦':action.skillId==='attack'?(result.nativeSkill||'普通攻擊'):(result.label||SKILL_MAP[action.skillId]?.name||'組隊戰技'),...result,after:snapshot()});
   a.actions++;if(action.manual)a.manualActions=(a.manualActions||0)+1;s.log.push(`${a.name}：${action.skillId==='defend'?'防禦':action.skillId==='attack'?(result.nativeSkill||'普攻'):(result.label||SKILL_MAP[action.skillId]?.name||'組隊戰技')}${result.damage?`，傷害 ${result.damage}`:''}${result.healed?`，治療 ${result.healed}`:''}`);
  }catch(e){s.log.push(`${a.name}技能未生效：${e.message}`);}
 }
 const mechanic=resolveMechanic(s);if(mechanic){s.log.unshift(mechanic.text);turn.events.push({actorId:null,label:mechanic.text,mechanic:true,...mechanic,after:snapshot()});if(mechanic.success===false)p.status='lost';}
 if(p.status==='combat'&&enemy.hp>0&&!enemy.interrupted){
  const pressure=s.actors.reduce((n,a)=>n+a.maxHp,0)/3*(p.kind==='tower'?(isBoss(p)?.04:.025):.065)*(enemy.windup?(p.kind==='tower'?1.6:2.1):1)*(1-valueOf(enemy,'enemyNextReduce',now));
  const hits=[];for(const a of s.actors)hits.push({id:a.id,damage:receiveDamage(a,pressure,s.actors,enemy,now)});turn.events.push({actorId:'boss',label:enemy.windup?'蓄力重擊':'首領反擊',windup:enemy.windup,hits,after:snapshot()});for(const b of enemy.buffs)if(b.type==='enemyNextReduce'&&b.uses>0)b.uses--;
  s.log.push(enemy.windup?'首領施放蓄力重擊！':'首領攻擊全隊。');
 }else if(enemy.interrupted){s.log.push('蓄力已被隊伍打斷！');turn.events.push({actorId:'boss',label:'蓄力已打斷',interrupted:true,after:snapshot()});}
 for(const a of s.actors){if(a.hp>0)a.mp=Math.min(a.maxMp,a.mp+Math.ceil(a.maxMp*.04));a.buffs=a.buffs.filter(b=>b.until>now&&(b.uses==null||b.uses>0));}
 if(enemy.hp<=0&&s.actors.some(a=>a.hp>0)&&p.kind==='tower')s.journalFloors=[...(s.journalFloors||[]),{floor:s.floor,at:now,participants:s.actors.filter(a=>a.manualActions>0).map(a=>a.id)}].slice(-10);
 if(p.status==='lost'){}
 else if(s.actors.every(a=>a.hp<=0)){p.status='lost';s.log.push('隊伍全員倒地，挑戰結束。');}
 else if(enemy.hp<=0){if(p.kind==='tower'&&s.floor<s.startFloor+9){s.floor++;s.deadline=now+5000;s.round=1;for(const a of s.actors)if(a.hp>0){a.hp=Math.min(a.maxHp,a.hp+Math.ceil(a.maxHp*.2));a.mp=Math.min(a.maxMp,a.mp+Math.ceil(a.maxMp*.25));}s.actions={};s.roundStarted=now;s.enemy=enemyFor(p);initCooperation(s,s.roleRules?encounterPlan(p.kind,s.dungeonId,s.floor):null);if(s.cooperation){s.deadline=now+15000;prepareMechanic(s,now);}s.log.push('本層已通關，存活隊員恢復 20% HP／25% MP，回合重置後繼續攀登。');}else{p.status='won';s.log.push('隊伍通關！每位隊員獨立領取戰利品。');}}
 else if(s.round>=40){p.status='lost';s.log.push('首領狂暴，挑戰結束。');}
 else{s.round++;s.actions={};s.deadline=now+(s.cooperation?15000:5000);s.roundStarted=now;if(s.cooperation){prepareMechanic(s,now);const next=cooperationView(s);s.log.unshift(next.complete?'機制全數破解，全力進攻！':`${next.name}：${next.roles.map(r=>({guard:'守護',breach:'破陣',aid:'支援',control:'壓制'})[r]).join('／')}${next.next?'；下一道機制於第 '+next.next.round+' 回合開始':''}`);}}
 if(p.status==='won')s.journalWonAt=now;
 turn.after=snapshot();turn.final=snapshot(s.enemy,s.floor);turn.status=p.status;s.lastTurn=turn;s.turnSequence=turn.sequence;
 s.recentTurns=[...(s.recentTurns||[]),turn].slice(-5);
 stmts.push(...combatStmts(env.DB,p,now));if(p.status!=='combat')stmts.push(...releaseStmts(env.DB,p,now));return {ok:true};
});}
const granting=new Set();
async function grantAll(env,p,now){if(granting.has(p.id))return false;granting.add(p.id);let n=0;try{const have=new Set((await rows(env.DB,'SELECT char_id FROM rpg_party_rewards WHERE party_id=?',p.id)).map(r=>r.char_id));for(const m of p.members){const a=p.state.actors.find(a=>a.id===m.char_id);if(have.has(m.char_id)||p.state.rewarded.includes(m.char_id)||!(a?.actions>0))continue;try{await reward(env,m.char_id,{partyId:p.id},now);n++;}catch(e){}}}finally{granting.delete(p.id);}return n>0;}
export async function view(env,id,tg,now,sinceTurnId=null){
 let p=await load(env.DB,id);if(p.status==='lobby'&&p.expires_at<=now){await sweep(env,now);p=await load(env.DB,id);}
 if(p.status==='combat'&&(now>=p.state.deadline)) {await advance(env,id,now);p=await load(env.DB,id);}
  if(p.status==='won'&&await grantAll(env,p,now))p=await load(env.DB,id);
 const s=p.state;
 const cooperation=cooperationView(s),plan=briefing(s.roleRules,s.actors.length?s.actors:p.members.map(m=>({...m,id:m.char_id})));
 const recent=s.recentTurns?.length?s.recentTurns:s.lastTurn?[s.lastTurn]:[],cursor=sinceTurnId?recent.findIndex(t=>t.id===String(sinceTurnId)):-1;
 const mine=p.members.find(m=>m.char_id===tg);let myReward=null;if(mine&&p.status==='won'){const rr=await env.DB.prepare('SELECT reward_json FROM rpg_party_rewards WHERE party_id=? AND char_id=?').bind(p.id,tg).first();if(rr)try{myReward=JSON.parse(rr.reward_json);}catch{}}return {id:p.id,kind:p.kind,status:p.status,leaderId:p.leader_id,rev:p.rev,name:p.state.name,level:p.state.level,dungeonId:p.state.dungeonId,map:p.state.map,trial:p.state.trial,floor:p.state.floor,startFloor:p.state.startFloor,round:p.state.round,roundSeconds:s.cooperation?15:5,cooperation,briefing:plan,roundLimit:40,deadline:p.state.deadline||p.expires_at,enemy:p.state.enemy?{...p.state.enemy,name:dungeonTheme({kind:p.kind,dungeonId:p.state.dungeonId,map:p.state.map,floor:p.state.floor}).name}:null,log:p.state.log,battleTurn:p.state.lastTurn||null,battleTurns:sinceTurnId&&cursor>=0?recent.slice(cursor+1):recent,battleSync:{latestTurnId:s.lastTurn?.id||null,hasGap:!!sinceTurnId&&cursor<0&&recent.length>0},members:p.members.map(m=>({id:m.char_id,name:m.name,level:m.level,base:m.base_class,gender:m.gender,classPath:m.class_path,roles:roleSkills({...m,maxMp:s.actors.find(a=>a.id===m.char_id)?.maxMp}).map(x=>x.role),ready:!!m.ready,collectionBlessing:p.state.actors.find(a=>a.id===m.char_id)?.collectionBlessing||collectionBlessing(m),...(p.state.actors.find(a=>a.id===m.char_id)?{hp:p.state.actors.find(a=>a.id===m.char_id).hp,maxHp:p.state.actors.find(a=>a.id===m.char_id).maxHp,guardian:p.state.actors.find(a=>a.id===m.char_id).guardian||null,mp:p.state.actors.find(a=>a.id===m.char_id).mp,maxMp:p.state.actors.find(a=>a.id===m.char_id).maxMp}:{}),submitted:!!p.state.actions[m.char_id]})),me:mine?{id:tg,ready:!!mine.ready,leader:tg===p.leader_id,actor:p.state.actors.find(a=>a.id===tg),roleSkills:s.cooperation?roleSkills(s.actors.find(a=>a.id===tg)||{}):[],rewarded:p.state.rewarded.includes(tg)||!!myReward,reward:myReward}:null,chatId:p.chat_id,messageId:p.message_id};
}
export async function reward(env,tg,b,now){
 const id=String(b.partyId);const old=await env.DB.prepare('SELECT reward_json FROM rpg_party_rewards WHERE party_id=? AND char_id=?').bind(id,tg).first();if(old)return {ok:true,reward:JSON.parse(old.reward_json),party:await view(env,id,tg,now)};
 await mutate(env,id,tg,b,now,async(p,stmts)=>{requireMember(p,tg);if(p.state.rewarded.includes(tg))return {already:true};if(p.status!=='won')throw new GameError('win','尚未通關');const a=p.state.actors.find(a=>a.id===tg);if(!(a?.actions>0))throw new GameError('participation','需要實際選擇戰術參與討伐才能領寶');
  const db=env.DB,day=taipeiDay(now),reward={items:{}};const c=await db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').bind(tg).first();const account=c.account_tg_id||tg;
  if(p.state.trial){const key=`trial_${p.state.trial}`;if(c.level>=p.state.trial*30&&c.class_path.length===p.state.trial-1){const count=await db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').bind(tg,key).first();if(!count?.quantity)reward.items[key]=1;}}
  else if(p.kind==='tower'){const x=specialState(c);x.towerBest=Math.max(x.towerBest,p.state.floor);reward.items.tower_fragment=10;stmts.push(db.prepare('UPDATE rpg_characters SET special_json=?,rev=rev+1 WHERE tg_id=? AND rev=?').bind(JSON.stringify(x),tg,c.rev),guardStmt(db));}
  else{
    reward.items.research_fragment=8;const d=DUNGEONS.find(d=>d.id===p.state.dungeonId);const pool=dungeonSkillPool(SPECIAL_SKILLS,d.skillLevels,c);const rng=crypto.getRandomValues(new Uint32Array(2));if(pool.length&&rng[0]/2**32<guardianChance(.35,p.state.actors.find(a=>a.id===tg)))reward.items[`book_${pool[rng[1]%pool.length].id}`]=1;
  }
  for(const [item,qty] of Object.entries(reward.items))stmts.push(invDeltaStmt(db,tg,item,qty));
  if(p.kind!=='tower')stmts.push(db.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=? AND rev=?').bind(tg,c.rev),guardStmt(db));
  stmts.push(db.prepare('INSERT INTO rpg_party_rewards(party_id,char_id,reward_json,created_at) VALUES(?,?,?,?)').bind(p.id,tg,JSON.stringify(reward),now),ledgerStmt(db,{event_id:`party-reward:${p.id}:${tg}`,tg_id:tg,type:p.state.trial?'轉職試煉獎勵':'組隊戰利品',note:JSON.stringify(reward.items)},now));p.state.rewarded.push(tg);return reward;
 });const row=await env.DB.prepare('SELECT reward_json FROM rpg_party_rewards WHERE party_id=? AND char_id=?').bind(id,tg).first();return {ok:true,reward:JSON.parse(row.reward_json),party:await view(env,id,tg,now)};
}
export async function sweep(env,now,limit=30){const due=await rows(env.DB,"SELECT id,status FROM rpg_parties WHERE (status='lobby' AND expires_at<=?) OR (status='combat' AND (expires_at<=? OR json_extract(state_json,'$.deadline')<=?)) LIMIT ?",now,now,now,limit);for(const row of due){if(row.status==='combat')await advance(env,row.id,now).catch(()=>null);else await mutate(env,row.id,'system',{},now,async(p,stmts)=>{if(p.status!=='lobby'||p.expires_at>now)return {ok:true};const ready=p.members.length===3&&p.members.every(m=>m.ready)&&new Set(p.members.map(m=>m.account_id)).size===3;if(ready){try{await beginParty(env,p,stmts,now);p.state.log.unshift('招募倒數結束，全員準備，自動出發。');return {ok:true};}catch(e){if(!['down','changed','level','trial','tower','no_character','party_roles'].includes(e.code))throw e;stmts.length=0;p.state.actors=[];p.state.log.unshift('自動出發失敗：'+e.message+'。請調整後重新組隊。');}}else p.state.log.unshift(p.members.length<3?'招募時間結束，人數不足，隊伍已解散。':'招募時間結束，未全員準備，隊伍已解散。');p.status='ended';stmts.push(...releaseStmts(env.DB,p,now));}).catch(()=>null);}return due.length;}
export async function setMessage(env,b){await env.DB.prepare('UPDATE rpg_parties SET chat_id=?,message_id=? WHERE id=?').bind(String(b.chatId),Number(b.messageId),String(b.partyId)).run();return {ok:true};}





// Public party directory: bound each page, but keep every matching party reachable.
const HALL_DAYS=7*86400000;
const endedTime=p=>Number(p.state.endedAt)||p.updated_at;
export async function hall(env,tg,b,now){
 await sweep(env,now,30);
 const ended=b.tab==='ended',page=Math.max(1,Math.min(1000000,Math.floor(Number(b.page)||1))),size=20;
 const where=ended?"status IN ('won','lost','ended') AND COALESCE(json_extract(state_json,'$.endedAt'),updated_at)>=?":"status IN ('lobby','combat') AND expires_at>?";
 const cutoff=ended?now-HALL_DAYS:now;
 const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM rpg_parties WHERE '+where).bind(cutoff).first();
 const total=count?.total||0,pages=Math.max(1,Math.ceil(total/size)),current=Math.min(page,pages);
 const entries=await rows(env.DB,'SELECT id FROM rpg_parties WHERE '+where+' ORDER BY '+(ended?"COALESCE(json_extract(state_json,'$.endedAt'),updated_at) DESC":"created_at DESC")+',id DESC LIMIT ? OFFSET ?',cutoff,size,(current-1)*size);
 const parties=await Promise.all(entries.map(async row=>{const p=await load(env.DB,row.id);return {id:p.id,name:p.state.name,kind:p.kind,status:p.status,level:p.state.level,floor:p.state.floor,round:p.state.round,createdAt:p.created_at,endedAt:ended?endedTime(p):null,deadline:p.state.deadline||p.expires_at,mine:p.members.some(m=>m.char_id===tg),members:p.members.map(m=>({id:m.char_id,name:m.name,level:m.level,base:m.base_class,classPath:m.class_path,gender:m.gender,leader:m.char_id===p.leader_id}))};}));
 return {ok:true,tab:ended?'ended':'active',parties,total,page:current,pages,pageSize:size,retentionDays:7,now};
}
export async function hallGet(env,tg,b,now){
 const id=String(b.partyId||'');let p=await load(env.DB,id);
 if(['won','lost','ended'].includes(p.status)&&endedTime(p)<now-HALL_DAYS)throw new GameError('hall_expired','組隊大廳僅展示近7天；請回自己的打寶或爬塔分頁查看。',404);
 const party=await view(env,id,tg,now);p=await load(env.DB,id);
 const rewards=await rows(env.DB,'SELECT char_id,reward_json,created_at FROM rpg_party_rewards WHERE party_id=? ORDER BY char_id',id);
 const drops=p.members.map(m=>{const r=rewards.find(x=>x.char_id===m.char_id);let items={};try{items=JSON.parse(r?.reward_json||'{}').items||{};}catch{}return {characterId:m.char_id,name:m.name,received:!!r,items:Object.fromEntries(Object.entries(items).filter(([k,n])=>typeof k==='string'&&Number.isSafeInteger(n)&&n>0)),at:r?.created_at||null};});
 return {ok:true,party,endedAt:['won','lost','ended'].includes(p.status)?endedTime(p):null,drops,now};
}
