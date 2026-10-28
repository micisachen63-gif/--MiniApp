import {GameError} from '../game/classes.js';
import {bumpRevStmt,guardStmt,invDeltaStmts,ledgerStmt,ledgerBatchStmts,classifyDbError} from '../db.js';

export const GIFT_ITEM='fate_cycle_gift';
export const GIFT_NAME='四世星輝匣';
export const GIFT_INTERVAL=4;
// Integer weights, published to the UI. Neither a client parameter nor a paid draw.
export const GIFT_POOL=Object.freeze([
 Object.freeze({id:'weapon',weight:5,items:Object.freeze({guaranteed_scroll_w:1})}),
 Object.freeze({id:'armor',weight:5,items:Object.freeze({guaranteed_scroll_a:1})}),
 Object.freeze({id:'scrolls',weight:90,items:Object.freeze({scroll_w:2,scroll_a:2})}),
]);
const owner=async(db,tg)=>{const c=await db.prepare('SELECT tg_id,account_tg_id FROM rpg_live_characters AS rpg_characters WHERE tg_id=?').bind(String(tg)).first();if(!c)throw new GameError('no_character','請先建立角色',404);return {char:String(c.tg_id),account:String(c.account_tg_id||c.tg_id)};};
const canonical=o=>o&&typeof o==='object'?(Array.isArray(o)?o.map(canonical):Object.fromEntries(Object.keys(o).sort().filter(k=>!['requestId','tgId','selectedCharacterId'].includes(k)).map(k=>[k,canonical(o[k])]))):o;
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function mutate(env,tg,b,now,kind,fn){
 if(typeof b.requestId!=='string'||!/^[A-Za-z0-9:_-]{6,90}$/.test(b.requestId))throw new GameError('request','需要有效的操作編號');
 const db=env.DB,c=await owner(db,tg),fingerprint=await hash({kind,char:c.char,body:canonical(b)});
 const replay=async()=>{
  const old=await db.prepare('SELECT payload_hash,result_json FROM rpg_fate_gift_operations WHERE account_id=? AND request_id=?').bind(c.account,b.requestId).first();
  if(old){if(old.payload_hash!==fingerprint)throw new GameError('request_changed','操作內容已變更，請更新畫面再試',409);return {ok:true,result:JSON.parse(old.result_json),replayed:true};}
  return null;
 };
 for(let n=0;n<5;n++){
  const old=await replay();if(old)return old;
  try{
   const {stmts,result}=await fn(c,db);
   stmts.push(db.prepare('INSERT INTO rpg_fate_gift_operations(account_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)').bind(c.account,b.requestId,fingerprint,JSON.stringify(result),now));
   await db.batch(stmts);return {ok:true,result};
  }catch(e){
   // Another identical request may commit after our receipt read but before
   // even the gift lookup. Recover read failures and lost commit replies too.
   const committed=await replay();if(committed)return committed;
   if(n<4&&(classifyDbError(e)?.code==='conflict'||/UNIQUE constraint failed: rpg_fate_gift/.test(String(e.message))))continue;
   throw classifyDbError(e)||e;
  }
 }
 throw new GameError('conflict','星輝匣正在同步，請稍後再試',409);
}
async function counts(db,tg){return db.prepare("SELECT (SELECT COUNT(*) FROM rpg_fate_lives WHERE char_id=? AND status='complete') AS completed,(SELECT COUNT(*) FROM rpg_fate_gifts WHERE char_id=?) AS claimed,(SELECT COUNT(*) FROM rpg_fate_gifts WHERE char_id=? AND status='opened') AS opened").bind(String(tg),String(tg),String(tg)).first();}
export async function summary(env,tg){
 const c=await owner(env.DB,tg),s=await counts(env.DB,c.char),eligible=Math.floor(s.completed/GIFT_INTERVAL);
 return {ok:true,name:GIFT_NAME,item:GIFT_ITEM,interval:GIFT_INTERVAL,completed:s.completed,earned:eligible,claimable:Math.max(0,eligible-s.claimed),unopened:s.claimed-s.opened,opened:s.opened,nextIn:GIFT_INTERVAL-s.completed%GIFT_INTERVAL,pool:GIFT_POOL.map(x=>({id:x.id,chance:x.weight,items:x.items}))};
}
export async function claim(env,tg,b,now){
 return mutate(env,tg,b,now,'claim',async(c,db)=>{
  const s=await counts(db,c.char),eligible=Math.floor(s.completed/GIFT_INTERVAL),owned=(await db.prepare('SELECT milestone FROM rpg_fate_gifts WHERE char_id=?').bind(c.char).all()).results||[],seen=new Set(owned.map(x=>x.milestone)),milestones=[];
  // Bound one atomic batch. Further accumulated gifts remain claimable, never lost.
  for(let i=1;i<=eligible&&milestones.length<25;i++)if(!seen.has(i*GIFT_INTERVAL))milestones.push(i*GIFT_INTERVAL);
  if(!milestones.length)return {stmts:[],result:{claimed:0,giftIds:[],remaining:0}};
  const ids=milestones.map(()=>crypto.randomUUID().replaceAll('-','')),stmts=[],ledger=[];
  for(let i=0;i<ids.length;i++){stmts.push(db.prepare("INSERT INTO rpg_fate_gifts(id,char_id,milestone,status,created_at) VALUES(?,?,?,'claimed',?)").bind(ids[i],c.char,milestones[i],now));ledger.push({event_id:'fate-gift:claim:'+ids[i],tg_id:c.char,type:'輪迴贈禮',item:GIFT_ITEM,item_delta:1,note:`正式完成 ${milestones[i]} 世 · ${GIFT_NAME}`});}
  stmts.push(...ledgerBatchStmts(db,ledger,now));
  stmts.push(...invDeltaStmts(db,c.char,GIFT_ITEM,ids.length),bumpRevStmt(db,c.char,now),guardStmt(db));
  return {stmts,result:{claimed:ids.length,giftIds:ids,remaining:Math.max(0,eligible-s.claimed-ids.length)}};
 });
}
function secureRoll(){return crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;}
export function drawGift(rng=secureRoll){const roll=rng();if(!Number.isFinite(roll)||roll<0||roll>=1)throw new GameError('random','無法開啟星輝匣，請稍後再試',503);let cumulative=0;for(const reward of GIFT_POOL){cumulative+=reward.weight;if(roll*100<cumulative)return reward;}throw new Error('invalid gift pool');}
export async function open(env,tg,b,now,rng=secureRoll){
 return mutate(env,tg,b,now,'open',async(c,db)=>{
  const row=b.giftId?await db.prepare("SELECT id,milestone FROM rpg_fate_gifts WHERE id=? AND char_id=? AND status='claimed'").bind(String(b.giftId),c.char).first():await db.prepare("SELECT id,milestone FROM rpg_fate_gifts WHERE char_id=? AND status='claimed' ORDER BY milestone LIMIT 1").bind(c.char).first();
  if(!row)throw new GameError('fate_no_gift','沒有可開啟的四世星輝匣，請先領取輪迴贈禮',409);
  const reward=drawGift(rng),items={...reward.items},stmts=[db.prepare("UPDATE rpg_fate_gifts SET status='opened',rewards_json=?,opened_at=? WHERE id=? AND char_id=? AND status='claimed'").bind(JSON.stringify(items),now,row.id,c.char),guardStmt(db),...invDeltaStmts(db,c.char,GIFT_ITEM,-1)];
  for(const [item,qty]of Object.entries(items))stmts.push(...invDeltaStmts(db,c.char,item,qty),ledgerStmt(db,{event_id:`fate-gift:open:${row.id}:${item}`,tg_id:c.char,type:'星輝匣獎勵',item,item_delta:qty,note:GIFT_NAME},now));
  stmts.push(ledgerStmt(db,{event_id:'fate-gift:consume:'+row.id,tg_id:c.char,type:'開啟輪迴禮',item:GIFT_ITEM,item_delta:-1,note:GIFT_NAME},now),bumpRevStmt(db,c.char,now),guardStmt(db));
  return {stmts,result:{giftId:row.id,milestone:row.milestone,reward:reward.id,items}};
 });
}
