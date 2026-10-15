import {GameError} from '../game/classes.js';
import {loadPlayer,guardStmt,classifyDbError} from '../db.js';
import {activeSettings} from '../game/guardian-sigil-config.js';
import {ensureWelcome,autoSummonStep} from './guardian-sigil.js';
export const INTERVAL_MS=3000;
const ownerOf=async(db,tg)=>(await db.prepare('SELECT account_tg_id FROM rpg_characters WHERE tg_id=?').bind(String(tg)).first())?.account_tg_id||String(tg);
export const jobView=j=>j?{id:j.id,characterId:j.char_id,pool:j.pool,count:j.single_draw?1:j.draw_count,targetType:j.target_type,targetRank:j.target_rank,maxGold:j.max_gold,status:j.status,reason:j.reason,matchId:j.match_id,batches:j.batches,totalDraws:j.total_draws,spentGold:j.spent_gold,spentVouchers:j.spent_vouchers,usedFree:j.used_free,counts:JSON.parse(j.counts_json),nextAt:j.next_at,updatedAt:j.updated_at,seen:!!j.seen_at}:null;
export async function view(env,tg){const owner=await ownerOf(env.DB,tg);return jobView(await env.DB.prepare("SELECT * FROM rpg_guardian_auto WHERE owner=? AND (status='running' OR seen_at IS NULL) ORDER BY CASE WHEN status='running' THEN 0 ELSE 1 END,created_at DESC,rowid DESC LIMIT 1").bind(owner).first());}
export async function start(env,tg,b,now){
 const cfg=activeSettings(env),pool=String(b.pool||''),count=Number(b.count),type=String(b.targetType||'any'),rank=Number(b.targetRank||0),max=b.maxGold==null||b.maxGold===''?null:Number(b.maxGold),request=String(b.requestId||'');
 if(!cfg.enabled||cfg.status!=='approved')throw new GameError('guardian_closed','召喚尚未開放');
 if(!['normal','featured'].includes(pool)||![1,5,10].includes(count)||!['any','attack','melee','ranged','magic','loot'].includes(type)||!Number.isInteger(rank)||rank<0||rank>6||max!==null&&(!Number.isSafeInteger(max)||max<0)||!/^(?:app:)?[A-Za-z0-9_-]{6,64}$/.test(request))throw new GameError('auto_settings','自動召喚設定無效');
 if(type==='any'&&rank===0)throw new GameError('auto_target','至少選擇能力或品質其中一項');
 const db=env.DB;await ensureWelcome(env,tg,now);const p=await loadPlayer(db,tg,env);if(!p)throw new GameError('no_character','還沒有角色');if(p.char.level<15)throw new GameError('guardian_level','15級開啟守護天使');
 const owner=p.char.account_tg_id||String(tg),old=await db.prepare('SELECT * FROM rpg_guardian_auto WHERE owner=? AND request_id=?').bind(owner,request).first();
 const replay=job=>{
  if(String(job.char_id)!==String(tg)||job.pool!==pool||(job.single_draw?1:job.draw_count)!==count||job.target_type!==type||job.target_rank!==rank||job.max_gold!==max)throw new GameError('request_reused','同一操作編號不能使用不同角色或設定',409);
  return {ok:true,job:jobView(job)};
 };
 if(old)return replay(old);
 if(await db.prepare("SELECT id FROM rpg_guardian_auto WHERE owner=? AND status='running'").bind(owner).first())throw new GameError('auto_active','已有背景召喚，請先停止');
 const id=crypto.randomUUID();try{await db.batch([db.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=? AND rev=?').bind(String(tg),p.char.rev),guardStmt(db),db.prepare("INSERT INTO rpg_guardian_auto(id,owner,char_id,request_id,pool,draw_count,single_draw,target_type,target_rank,max_gold,status,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'running',?,?,?)").bind(id,owner,String(tg),request,pool,count===1?5:count,count===1?1:0,type,rank,max,now,now,now)]);}catch(e){const previous=await db.prepare('SELECT * FROM rpg_guardian_auto WHERE owner=? AND request_id=?').bind(owner,request).first();if(previous)return replay(previous);if(String(e.message).includes('rpg_guardian_auto.owner'))throw new GameError('auto_active','已有背景召喚，請先停止',409);throw classifyDbError(e)||e;}
 return {ok:true,job:await view(env,tg)};
}
export async function stop(env,tg,b,now){const owner=await ownerOf(env.DB,tg);await env.DB.prepare("UPDATE rpg_guardian_auto SET status='ended',reason='stopped',rev=rev+1,updated_at=? WHERE id=? AND owner=? AND status='running'").bind(now,String(b.jobId),owner).run();return {ok:true,job:await view(env,tg)};}
export async function seen(env,tg,b,now){const owner=await ownerOf(env.DB,tg);await env.DB.prepare("UPDATE rpg_guardian_auto SET seen_at=? WHERE id=? AND owner=? AND status='ended'").bind(now,String(b.jobId),owner).run();return {ok:true,job:await view(env,tg)};}
export async function wake(env,id){if(!env.AUTO_ENHANCE_RUNNER)return false;const stub=env.AUTO_ENHANCE_RUNNER.get(env.AUTO_ENHANCE_RUNNER.idFromName('guardian:'+id));const r=await stub.fetch('https://auto-enhance.internal/wake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:id,kind:'guardian'})});if(!r.ok)throw Error('Unable to schedule guardian summon');return true;}
export async function step(env,id,now){const j=await env.DB.prepare("SELECT * FROM rpg_guardian_auto WHERE id=? AND status='running' AND next_at<=?").bind(id,now).first();if(!j)return false;try{await autoSummonStep(env,j,now);return true;}catch(e){if(e.code==='conflict')return false;if(!(e instanceof GameError))throw e;const reason=['gold','insufficient'].includes(e.code)?'resources':e.code==='auto_budget'?'budget':e.code==='no_character'?'missing':'rules';await env.DB.prepare("UPDATE rpg_guardian_auto SET status='ended',reason=?,rev=rev+1,updated_at=? WHERE id=? AND rev=? AND status='running'").bind(reason,now,j.id,j.rev).run();return true;}}
export async function sweep(env,now){const rows=(await env.DB.prepare("SELECT id FROM rpg_guardian_auto WHERE status='running' AND next_at<=? ORDER BY next_at LIMIT 100").bind(now).all()).results||[];let n=0;for(const j of rows){try{if(await wake(env,j.id)||await step(env,j.id,now))n++;}catch(e){console.error('guardian auto',j.id,e.message);}}return n;}
