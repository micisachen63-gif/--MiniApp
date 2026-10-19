import {GameError} from '../game/classes.js';
import {loadPlayer,clonePlayer,persistStatements,guardStmt,outboxStmt} from '../db.js';
import {doEnhance,withPlayer} from './player.js';
import {runningRingId,canEnhanceInParty} from './party-presence.js';
export const INTERVAL_MS=3000;

// Only the scroll used this round, target equipment and equipped gear are needed for an attempt.
async function loadEnhancePlayer(db,tg,itemId,blessed){
 const [chars,inv,gear]=await db.batch([
  db.prepare('SELECT c.*,a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(tg),
  db.prepare("SELECT item,quantity FROM rpg_inventory WHERE tg_id=? AND item IN (?,?)").bind(tg,blessed?'blessed_scroll_w':'scroll_w',blessed?'blessed_scroll_a':'scroll_a'),
  db.prepare('SELECT * FROM rpg_equipment WHERE tg_id=? AND (id=? OR is_equipped<>0)').bind(tg,itemId)
 ]);const char=chars.results?.[0];return char?{char,inv:Object.fromEntries((inv.results||[]).map(x=>[x.item,x.quantity])),equipment:gear.results||[]}:null;
}

export async function wake(env,id){
 if(!env.AUTO_ENHANCE_RUNNER)return false;
 const stub=env.AUTO_ENHANCE_RUNNER.get(env.AUTO_ENHANCE_RUNNER.idFromName(id));
 const r=await stub.fetch('https://auto-enhance.internal/wake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:id})});
 if(!r.ok)throw new Error('Unable to schedule background enhancement');return true;
}

const ownerOf=async(db,tg)=>(await db.prepare('SELECT account_tg_id FROM rpg_characters WHERE tg_id=?').bind(String(tg)).first())?.account_tg_id||String(tg);
export const jobView=j=>j?{id:j.id,itemId:j.item_id,itemName:j.item_name,characterId:j.tg_id,ownerAccountId:j.owner,dismissed:!!j.notice_dismissed_at,target:j.target,blessed:!!j.blessed,status:j.status,reason:j.reason,level:j.level,attempts:j.attempts,spentGold:j.spent_gold,spentScrolls:j.spent_scrolls,updatedAt:j.updated_at,nextAt:j.next_at,intervalMs:INTERVAL_MS}:null;
export async function view(env,tg){const owner=await ownerOf(env.DB,tg);return jobView(await env.DB.prepare("SELECT j.*,n.created_at AS notice_dismissed_at FROM rpg_auto_enhance j LEFT JOIN rpg_notice_dismissals n ON n.account_tg_id=j.owner AND n.kind='auto_enhance_end' AND n.ref_id=j.id WHERE j.owner=? ORDER BY CASE WHEN j.status='running' THEN 0 ELSE 1 END,j.created_at DESC,j.rowid DESC LIMIT 1").bind(owner).first());}
export async function start(env,tg,b,now){
 if(b.guaranteed!==undefined&&b.guaranteed!==false)throw new GameError('scroll_mode','星輝必成卷請於鍛造介面手動選用，不支援背景消耗');
 const db=env.DB, p=await loadPlayer(db,tg);if(!p)throw new GameError('no_character','還沒有角色');
 const owner=p.char.account_tg_id||String(tg),existing=await db.prepare("SELECT * FROM rpg_auto_enhance WHERE owner=? AND status='running'").bind(owner).first();
 if(existing){if(existing.item_id===String(b.itemId)&&existing.target===Number(b.target)&&existing.blessed===Number(b.blessed===true))return {ok:true,job:jobView(existing)};throw new GameError('auto_active','請先停止目前的背景強化');}
 const item=p.equipment.find(e=>e.id===String(b.itemId)),target=Number(b.target);
 if(!item)throw new GameError('not_found','找不到這件裝備');
 if(!Number.isInteger(target)||target<=item.enhance_level||target>15)throw new GameError('target','請選擇高於目前強化值的目標，上限 +15');
 const runningExpeditionId=p.char.party_id?await runningRingId(db,tg):null;
 if(item.trade_id||!canEnhanceInParty(p.char,item,runningExpeditionId))throw new GameError('busy','遠征期間只能強化未穿戴、未交易的背包裝備；其他組隊戰鬥請先結束');
 // Validate affordability with the real enhancement rules, without committing a trial roll.
 doEnhance(clonePlayer(p),{db,now,runningExpeditionId},{itemId:item.id,requestId:'validate',blessed:b.blessed===true},()=>.99);
 const id=crypto.randomUUID();
 await db.batch([
 db.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=? AND rev=?').bind(String(tg),p.char.rev),guardStmt(db),
 db.prepare("INSERT INTO rpg_auto_enhance(id,owner,tg_id,item_id,item_name,target,blessed,status,level,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'running',?,?,?,?)").bind(id,owner,String(tg),item.id,item.name,target,Number(b.blessed===true),item.enhance_level||0,now,now,now)
 ]);return {ok:true,job:await view(env,tg)};
}
const notice=(db,j,reason,now)=>outboxStmt(db,{dedupe:'auto-end:'+j.id,target:'dm',tgId:j.owner,kind:'auto_enhance_end',payload:{itemName:j.item_name,target:j.target,level:j.level,attempts:j.attempts,spentGold:j.spent_gold,spentScrolls:j.spent_scrolls,reason}},now);
export async function stop(env,tg,b,now){
 const db=env.DB,owner=await ownerOf(db,tg);
 for(let n=0;n<3;n++){
 const j=await db.prepare('SELECT * FROM rpg_auto_enhance WHERE id=? AND owner=?').bind(String(b.jobId),owner).first();
 if(!j)throw new GameError('not_found','找不到這次強化');if(j.status!=='running')return {ok:true,job:jobView(j)};
 try{await db.batch([db.prepare("UPDATE rpg_auto_enhance SET status='ended',reason='stopped',rev=rev+1,updated_at=? WHERE id=? AND rev=? AND status='running'").bind(now,j.id,j.rev),guardStmt(db),notice(db,j,'stopped',now)]);return {ok:true,job:await view(env,tg)};}catch(e){if(!String(e.message).includes('rpg_guard.ok'))throw e;}
 }throw new GameError('conflict','強化結果正在更新，請再按一次停止',409);
}
export async function step(env,id,now,rng){
 const db=env.DB,j=await db.prepare("SELECT * FROM rpg_auto_enhance WHERE id=? AND status='running' AND next_at<=?").bind(id,now).first();if(!j)return false;
 let p=await loadEnhancePlayer(db,j.tg_id,j.item_id,!!j.blessed);
 if(p&&(!p.char.active_char_id||p.char.active_char_id===p.char.tg_id)&&now-p.char.last_settle_at>=60_000){await withPlayer(env,j.tg_id,now);p=await loadEnhancePlayer(db,j.tg_id,j.item_id,!!j.blessed);}
 let out={},reason=null,work=p&&clonePlayer(p);
 if(!p)reason='missing';else{
 const item=work.equipment.find(e=>e.id===j.item_id);
 if(!item)reason='missing';else if(item.enhance_level>=j.target)reason='target';else{
 try{const runningExpeditionId=work.char.party_id?await runningRingId(db,j.tg_id):null;out=doEnhance(work,{db,now,runningExpeditionId},{itemId:j.item_id,requestId:'auto:'+j.id+':'+j.rev,blessed:!!j.blessed},rng);
 j.attempts++;j.spent_gold+=out.result.goldCost;j.spent_scrolls+=Object.values(out.result.used).reduce((a,b)=>a+b,0);j.level=out.result.to;
 if(out.result.result==='break')reason='break';else if(j.level>=j.target)reason='target';
 }catch(e){if(!(e instanceof GameError))throw e;reason=e.code==='gold'||e.code==='no_scroll'?'resources':e.code==='party'?'party':'busy';work=clonePlayer(p);}
 }}
 const pre=[db.prepare("UPDATE rpg_auto_enhance SET status='processing',rev=rev+1 WHERE id=? AND rev=? AND status='running'").bind(j.id,j.rev),guardStmt(db)];
 const extra=[...(out.extra||[]),db.prepare('UPDATE rpg_auto_enhance SET status=?,reason=?,level=?,attempts=?,spent_gold=?,spent_scrolls=?,next_at=?,updated_at=? WHERE id=?').bind(reason?'ended':'running',reason,j.level,j.attempts,j.spent_gold,j.spent_scrolls,now+INTERVAL_MS,now,j.id)];
 if(reason)extra.push(notice(db,j,reason,now));
 try{await db.batch(p?persistStatements(db,p,work,{pre,ledger:out.ledger||[],extra},now):[...pre,...extra]);return true;}
 catch(e){if(/rpg_guard\.ok|rpg_ledger\.event_id/.test(String(e.message)))return false;throw e;}
}
// The minute cron repairs missing alarms; it is also a fallback if the namespace is unavailable.
export async function sweep(env,now){const rows=await env.DB.prepare("SELECT id FROM rpg_auto_enhance WHERE status='running' AND next_at<=? ORDER BY next_at LIMIT 100").bind(now).all();let count=0;for(const j of rows.results||[]){try{if(await wake(env,j.id))count++;else if(await step(env,j.id,now))count++;}catch(e){console.error('auto enhance',j.id,e.message);}}return count;}
