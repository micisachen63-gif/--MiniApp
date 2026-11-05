// Immutable guardian evidence. Reads never settle, grant welcome or advance a job.
import { GameError } from '../game/classes.js';
import { ledgerStmt } from '../db.js';
import { QUALITY_ORDER, TYPES } from '../game/guardian-sigil-config.js';
import { ASSIST_ITEM } from '../game/guardian-assist.js';
import { SELL_PRICES } from './guardian-shop.js';

const TYPE = '天使場景操作收據';
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const has = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const stable = v => Array.isArray(v) ? v.map(stable) : plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])) : v;
const same = (a,b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const input = message => { throw new GameError('guardian_receipt_input',message,400); };
const corrupt = () => { throw new GameError('guardian_receipt_corrupt','原天使操作目前無法完整核對，請保留原操作編號',409); };
const parse = v => { try { return JSON.parse(v); } catch { return corrupt(); } };
const hash = async v => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(v)))))).map(n=>n.toString(16).padStart(2,'0')).join('');
const identity = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\u0000-\u001f]/.test(v);
const item = v => { if(!identity(v)) input('天使識別無效'); return v; };
const costs = (v,keys) => {
 if(!plain(v)||!same(Object.keys(v).sort(),[...keys].sort())||keys.some(k=>!integer(v[k]))) input('請提供完整的原費用確認');
 return Object.fromEntries(keys.map(k=>[k,v[k]]));
};
const items = (v,min,max) => {
 if(!Array.isArray(v)||v.length<min||v.length>max||new Set(v).size!==v.length) input('請提供不重複的完整天使選取');
 return v.map(item).sort();
};
const SIGIL = new Set(['summon','fuse','activate','lock','unbind','assist']);

export function operation(kind,body={},namespace='service') {
 if(!plain(body)||!['app','service'].includes(namespace)||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId)) input('需要有效的原操作編號');
 let fields={};
 if(!['auto-stop','auto-seen'].includes(kind)) {
  if(typeof body.configVersion!=='string'||!body.configVersion||body.configVersion.length>128) input('請確認目前天使規則版本');
  fields.configVersion=body.configVersion;
 }
 if(kind==='welcome') {}
 else if(kind==='summon') {
  if(!['normal','featured'].includes(body.pool)||![1,5,10].includes(body.count)) input('召喚設定無效');
  Object.assign(fields,{pool:body.pool,count:body.count,expectedCosts:costs(body.expectedCosts,['gold','vouchers','credits','freeNormalDraws'])});
 } else if(kind==='fuse') {
  const ids=items(body.itemIds,4,6); if(![4,6].includes(ids.length)||!ids.includes(body.primaryId)) input('主羽毛與完整素材不符');
  Object.assign(fields,{itemIds:ids,primaryId:body.primaryId,expectedCosts:costs(body.expectedCosts,['gold'])});
 } else if(kind==='activate') {
  if(!has(body,'itemId')||body.itemId!==null&&!identity(body.itemId)) input('請明確選擇守護天使或卸下');
  fields.itemId=body.itemId;
 } else if(kind==='lock') {
  if(typeof body.locked!=='boolean') input('請明確選擇鎖定狀態');
  Object.assign(fields,{itemId:item(body.itemId),locked:body.locked});
 } else if(kind==='unbind') Object.assign(fields,{itemId:item(body.itemId),expectedCosts:costs(body.expectedCosts,['unbind'])});
 else if(kind==='assist') {
  if(!['start','select','stop','renew','continuation','supply','buy'].includes(body.mode)||typeof body.itemId!=='string'||body.itemId!==''&&!identity(body.itemId)||['start','select'].includes(body.mode)&&!body.itemId||!Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>10||typeof body.autoRenew!=='boolean'||typeof body.autoBuy!=='boolean') input('請提供完整參戰與補給設定');
  Object.assign(fields,{mode:body.mode,itemId:body.itemId,quantity:body.quantity,autoRenew:body.autoRenew,autoBuy:body.autoBuy,expectedCosts:costs(body.expectedCosts,['gold','stones'])});
 } else if(kind==='sale') {
  if(typeof body.characterId!=='string'||body.characterId!==body.selectedCharacterId||!integer(body.expectedGold)||body.expectedGold<1) input('請核對販售角色與金額');
  const selected=items(body.itemIds,1,50);if(selected.some(id=>id.length>64))input('販售天使識別長度無效');
  Object.assign(fields,{characterId:body.characterId,itemIds:selected,expectedGold:body.expectedGold});
 } else if(kind==='auto-start') {
  if(!['normal','featured'].includes(body.pool)||![1,5,10].includes(body.count)||!['any','attack','melee','ranged','magic','loot'].includes(body.targetType)||!integer(body.targetRank)||body.targetRank>6||body.targetType==='any'&&body.targetRank===0||!has(body,'maxGold')||body.maxGold!==null&&!integer(body.maxGold)) input('請提供完整背景召喚設定');
  Object.assign(fields,{pool:body.pool,count:body.count,targetType:body.targetType,targetRank:body.targetRank,maxGold:body.maxGold});
 } else if(['auto-stop','auto-seen'].includes(kind)) fields={jobId:item(body.jobId)};
 else input('天使操作種類無效');
 return {kind,fields,requestId:body.requestId,request:'scene:'+namespace+':'+body.requestId,signature:JSON.stringify({kind,...fields})};
}

export async function actorContext(env,tg,now,body=null) {
 const characterId=String(tg);
 if(!/^(?:\d{1,20}|c[a-f0-9]{32})$/i.test(characterId)) input('角色識別無效');
 const realmId=env.REALM_CONTEXT?.id||'permanent';
 if(body&&(body.realmId!==realmId||body.selectedCharacterId!==characterId)) throw new GameError(body.realmId!==realmId?'realm_mismatch':'character_changed','遊戲環境或目前角色已變更，請回到原角色核對',409);
 const actor=await env.DB.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,c.level,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(characterId).first();
 if(!actor) throw new GameError('no_character','找不到目前帳號的角色',404);
 if(actor.active_char_id&&String(actor.active_char_id)!==characterId) throw new GameError('character_changed','角色已切換，請回到原角色核對這筆紀錄',409);
 return {actor,context:{ok:true,now,realmId,accountId:String(actor.account_tg_id||characterId),characterId,revision:Number(actor.rev||0)}};
}
export function requireActiveRealm(env) {
 if(env.REALM_CONTEXT?.phase&&env.REALM_CONTEXT.phase!=='ACTIVE') throw new GameError('realm_read_only','這個世界目前僅供查看',409);
}
export function scopedGuardianEnv(env,actor) {
 const db=env.DB,statements=new WeakMap(),characterId=String(actor.tg_id),accountId=String(actor.account_tg_id||characterId);
 const guard=()=>db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND c.account_tg_id=? AND (a.active_char_id IS NULL OR a.active_char_id=c.tg_id))').bind(characterId,accountId);
 async function execute(items) {
  const entries=items.map(i=>{const e=statements.get(i);if(!e)throw new Error('guardian scoped statement belongs to another database');return e;});
  const writing=entries.some(e=>!e.readOnly),out=await db.batch([...(writing?[guard()]:[]),...entries.map(e=>e.statement)]);
  return writing?out.slice(1):out;
 }
 function wrap(statement,readOnly) {
  const wrapped={bind(...v){return wrap(statement.bind(...v),readOnly);},async all(){return(await execute([wrapped]))[0];},async run(){return(await execute([wrapped]))[0];},async first(column){const row=(await execute([wrapped]))[0]?.results?.[0]??null;return column&&row?row[column]:row;}};
  statements.set(wrapped,{statement,readOnly});return wrapped;
 }
 return {...env,DB:{prepare(sql){return wrap(db.prepare(sql),/^\s*SELECT\b/i.test(sql));},batch:execute}};
}

const scopeOf = context => ({realmId:context.realmId,accountId:context.accountId,characterId:context.characterId});
const eventId = (tg,op) => 'guardian-scene-receipt:'+tg+':'+op.request;
export function operationCosts(op,result) {
 const r=result.operation;
 if(op.kind==='summon') return {gold:r.consumed.gold,vouchers:r.consumed.vouchers,credits:r.consumed.credits,freeNormalDraws:r.consumed.freeNormalDraws||0};
 if(op.kind==='fuse') return {gold:r.consumed.gold};
 if(op.kind==='unbind') return {unbind:r.usedUnbindScrolls};
 if(op.kind==='assist') return {gold:r.consumed.gold,stones:r.consumed.stones||0};
 if(op.kind==='sale') return {sigils:result.sale.count};
 return {};
}
export function receiptStatement(db,context,op,result,now) {
 const actual=operationCosts(op,result);
 if(op.fields.expectedCosts&&!same(actual,op.fields.expectedCosts)) throw new GameError('guardian_quote_changed','費用或免費次數已更新，請先保留並核對原操作',409);
 return ledgerStmt(db,{event_id:eventId(context.characterId,op),tg_id:context.characterId,type:TYPE,note:JSON.stringify({version:1,kind:op.kind,signature:op.signature,scope:scopeOf(context),createdAt:now,result,costs:actual})},now);
}

// These SELECT projections run inside the original final write batch, after the
// exact job/welcome statement. Later runner progress cannot rewrite the snapshot.
export function projectionReceiptStatements(db,context,op,now,{jobId=null}={}) {
 const auto=op.kind.startsWith('auto-');
 const jobJson="json_object('id',id,'characterId',char_id,'pool',pool,'count',CASE WHEN single_draw=1 THEN 1 ELSE draw_count END,'targetType',target_type,'targetRank',target_rank,'maxGold',max_gold,'status',status,'reason',reason,'matchId',match_id,'batches',batches,'totalDraws',total_draws,'spentGold',spent_gold,'spentVouchers',spent_vouchers,'usedFree',used_free,'counts',json(counts_json),'nextAt',next_at,'updatedAt',updated_at,'seen',json(CASE WHEN seen_at IS NULL THEN 'false' ELSE 'true' END))";
 const welcomeJson="json_object('accountId',account_id,'recipientCharacterId',recipient_char_id,'draws',draws,'createdAt',created_at)";
 const source=auto?'rpg_guardian_auto':'rpg_guardian_welcome';
 const where=auto?"id=? AND owner=?"+(op.kind==='auto-seen'?" AND status='ended'":''):'account_id=?';
 const result=auto?"json_object('job',"+jobJson+")":"json_object('welcome',"+welcomeJson+")";
 const sql="INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at) SELECT ?,?,?,0,NULL,0,0,json_object('version',1,'kind',?,'signature',?,'scope',json(?),'createdAt',?,'result',"+result+",'costs',json('{}')"+(auto?",'jobRequestId',request_id":"")+"),? FROM "+source+" WHERE "+where;
 return [db.prepare(sql).bind(eventId(context.characterId,op),context.characterId,TYPE,op.kind,op.signature,JSON.stringify(scopeOf(context)),now,now,...(auto?[jobId,context.accountId]:[context.accountId])),
  db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE changes()<>1')];
}
function originalPayload(op) {
 const b=op.fields;
 if(op.kind==='summon')return {pool:b.pool,count:b.count};
 if(op.kind==='fuse')return {itemIds:b.itemIds,primaryId:b.primaryId};
 if(op.kind==='activate'||op.kind==='unbind')return {itemId:b.itemId};
 if(op.kind==='lock')return {itemId:b.itemId,locked:b.locked};
 return {mode:b.mode,itemId:b.itemId,quantity:b.quantity,autoRenew:b.autoRenew,autoBuy:b.autoBuy};
}
const validSigil = r => plain(r)&&identity(r.id)&&TYPES.includes(r.type)&&Number.isSafeInteger(r.rank)&&r.rank>=1&&r.rank<=8&&r.quality===QUALITY_ORDER[r.rank-1]&&['bound','active','locked','inTrade','inExchange'].every(k=>typeof r[k]==='boolean');
const ledger = (db,id) => db.prepare('SELECT * FROM rpg_ledger WHERE event_id=?').bind(id).first();
function ledgerMatches(row,{tg,type,gold=0,item=null,delta=0,at}) {
 return !!row&&String(row.tg_id)===tg&&row.type===type&&row.gold_delta===gold&&row.item===item&&row.item_delta===delta&&row.exp_delta===0&&row.created_at===at;
}
async function verifySigil(db,context,op,result) {
 const row=await db.prepare('SELECT * FROM rpg_guardian_operations WHERE char_id=? AND request_id=?').bind(context.characterId,op.request).first();
 if(!row||String(row.account_id)!==context.accountId||row.action!==(op.kind==='assist'?'activate':op.kind)||row.payload_hash!==await hash({action:op.kind,payload:originalPayload(op)}))corrupt();
 const r=parse(row.result_json),c=parse(row.cost_json);
 if(!plain(r)||!same(result,{operation:r})||r.action!==op.kind||r.status!=='committed'||r.operationId!==row.operation_id||r.requestId!==op.request||r.charId!==context.characterId||r.configVersion!==op.fields.configVersion||r.configVersion!==row.config_version||r.createdAt!==row.created_at||!plain(c)||!same(c,r.consumed)||!['gold','vouchers','credits'].every(k=>integer(c[k]))||!Array.isArray(r.results)||!r.results.every(validSigil))corrupt();
 const money=await ledger(db,'guardian:'+row.operation_id);
 if(!ledgerMatches(money,{tg:context.characterId,type:'守護神'+op.kind,gold:-c.gold,at:row.created_at})||!same(parse(money.note),r))corrupt();
 const b=op.fields;
 if(op.kind==='summon') {
  if(r.pool!==b.pool||r.count!==b.count||r.results.length!==b.count||new Set(r.results.map(i=>i.id)).size!==b.count||!integer(c.freeNormalDraws))corrupt();
  for(const i of r.results) {
   const l=await ledger(db,'guardian:'+r.operationId+':item:'+i.id);
   if(!ledgerMatches(l,{tg:context.characterId,type:'守護羽毛取得',item:'sigil:'+i.id,delta:1,at:r.createdAt})||!same(parse(l.note),{operationId:r.operationId,source:b.pool,type:i.type,quality:i.quality}))corrupt();
  }
 } else if(op.kind==='fuse') {
  const consumed=r.success===true?b.itemIds:b.itemIds.filter(id=>id!==b.primaryId);
  if(typeof r.success!=='boolean'||r.primaryId!==b.primaryId||r.refundedId!==(r.success?null:b.primaryId)||!same([...r.consumedIds||[]].sort(),consumed)||r.results.length!==1||!Number.isInteger(r.inputRank)||r.inputRank<1||r.inputRank>7||r.results[0].rank!==r.inputRank+(r.success?1:0)||!r.success&&r.results[0].id!==b.primaryId)corrupt();
  for(const id of consumed)if(!ledgerMatches(await ledger(db,'guardian:'+r.operationId+':consume:'+id),{tg:context.characterId,type:'守護羽毛合成素材',item:'sigil:'+id,delta:-1,at:r.createdAt}))corrupt();
 } else if(op.kind==='activate') {
  if(b.itemId===null?r.results.length!==0:r.results.length!==1||r.results[0].id!==b.itemId||!r.results[0].active||!r.results[0].bound)corrupt();
 } else if(op.kind==='lock') {if(r.results.length!==0)corrupt();}
 else if(op.kind==='unbind') {if(r.results.length!==1||r.results[0].id!==b.itemId||r.results[0].bound||!integer(r.usedUnbindScrolls))corrupt();}
 else {
  if(r.mode!==b.mode||typeof r.resumed!=='boolean'||!integer(r.replacedRemainingBattles))corrupt();
  const delta=b.mode==='buy'?b.quantity:b.mode==='start'?-(c.stones||0):0;
  if(!ledgerMatches(await ledger(db,'guardian-assist:'+context.characterId+':'+op.request),{tg:context.characterId,type:b.mode==='buy'?'天使召喚石補給':b.mode==='start'?'天使參戰':'天使參戰設定',item:['buy','start'].includes(b.mode)?ASSIST_ITEM:null,delta,at:r.createdAt}))corrupt();
 }
 return {family:'operations',id:row.operation_id,requestKey:op.request};
}
async function verifySale(db,context,op,result,at) {
 const row=await ledger(db,'guardian-shop:'+context.characterId+':'+op.request),note=row?parse(row.note):null,r=result.sale,b=op.fields;
 if(!plain(r)||!Array.isArray(r.items)||r.count!==b.itemIds.length||r.gold!==b.expectedGold||r.items.length!==r.count||!same(r.items.map(i=>i.id).sort(),b.itemIds)||r.items.some(i=>!TYPES.includes(i.type)||!QUALITY_ORDER.includes(i.quality)||i.gold!==SELL_PRICES[QUALITY_ORDER.indexOf(i.quality)])||r.items.reduce((n,i)=>n+i.gold,0)!==r.gold||!ledgerMatches(row,{tg:context.characterId,type:'天使商店販售',gold:r.gold,delta:-r.count,at})||note.fingerprint!==JSON.stringify({ids:b.itemIds,gold:b.expectedGold})||!same(note.result,r)||!same(Object.keys(result),['sale']))corrupt();
 return {family:'sale',id:row.event_id,requestKey:op.request};
}
async function verifyWelcome(db,context,result) {
 const row=await db.prepare('SELECT * FROM rpg_guardian_welcome WHERE account_id=?').bind(context.accountId).first();
 if(!row||!same(result,{welcome:{accountId:context.accountId,recipientCharacterId:row.recipient_char_id,draws:row.draws,createdAt:row.created_at}})||row.draws!==200)corrupt();
 const grant=await ledger(db,'guardian-welcome:'+context.accountId);
 if(!ledgerMatches(grant,{tg:row.recipient_char_id,type:'守護神初見贈禮',item:'guardian_free_normal',delta:200,at:row.created_at})||grant.note!=='首次進入；免費普通召喚')corrupt();
 return {family:'welcome',id:context.accountId,recipientCharacterId:row.recipient_char_id};
}
async function verifyAuto(db,context,op,result,at,jobRequestId) {
 const j=result.job;
 if(!plain(j)||!same(Object.keys(result),['job'])||!identity(j.id)||!['running','ended'].includes(j.status)||typeof j.seen!=='boolean'||!['batches','totalDraws','spentGold','spentVouchers','usedFree','nextAt','updatedAt'].every(k=>integer(j[k]))||!Array.isArray(j.counts)||j.counts.length!==8||!j.counts.every(integer)||j.counts.reduce((a,b)=>a+b,0)!==j.totalDraws)corrupt();
 const row=await db.prepare('SELECT * FROM rpg_guardian_auto WHERE id=? AND owner=?').bind(j.id,context.accountId).first();
 if(!row||typeof jobRequestId!=='string'||row.request_id!==jobRequestId||row.char_id!==j.characterId||row.pool!==j.pool||(row.single_draw?1:row.draw_count)!==j.count||row.target_type!==j.targetType||row.target_rank!==j.targetRank||row.max_gold!==j.maxGold||j.updatedAt>at||row.created_at>at)corrupt();
 if(op.kind==='auto-start') {
  const b=op.fields;
  if(row.request_id!==op.request||j.characterId!==context.characterId||j.pool!==b.pool||j.count!==b.count||j.targetType!==b.targetType||j.targetRank!==b.targetRank||j.maxGold!==b.maxGold||j.status!=='running'||j.reason!==null||j.matchId!==null||j.seen||j.batches!==0||j.totalDraws!==0||j.spentGold!==0||j.spentVouchers!==0||j.usedFree!==0||j.nextAt!==at||j.updatedAt!==at||row.created_at!==at)corrupt();
 } else if(j.id!==op.fields.jobId||j.status!=='ended'||op.kind==='auto-seen'&&!j.seen)corrupt();
 return {family:'auto',id:j.id,sourceCharacterId:j.characterId,jobRequestId:row.request_id,requestKey:op.request};
}
async function partialAuthority(db,context,op) {
 const original=await db.prepare('SELECT operation_id FROM rpg_guardian_operations WHERE char_id=? AND request_id=?').bind(context.characterId,op.request).first();
 const sale=await ledger(db,'guardian-shop:'+context.characterId+':'+op.request);
 const job=await db.prepare('SELECT id FROM rpg_guardian_auto WHERE owner=? AND request_id=?').bind(context.accountId,op.request).first();
 return !!(original||sale||job);
}
export async function record(env,context,op) {
 const row=await ledger(env.DB,eventId(context.characterId,op));
 if(!row)return {found:false,result:null,receipt:null,recoveryAllowed:(!env.REALM_CONTEXT?.phase||env.REALM_CONTEXT.phase==='ACTIVE')&&!await partialAuthority(env.DB,context,op)};
 const saved=parse(row.note);
 if(!plain(saved)||saved.version!==1||!ledgerMatches(row,{tg:context.characterId,type:TYPE,at:saved.createdAt})||!integer(saved.createdAt)||!plain(saved.result)||!plain(saved.costs)||!same(saved.scope,scopeOf(context)))corrupt();
 if(saved.kind!==op.kind||saved.signature!==op.signature)throw new GameError('request_reused','同一操作編號不可更換內容，請保留原始確認資料',409);
 let authority;
 if(SIGIL.has(op.kind))authority=await verifySigil(env.DB,context,op,saved.result);
 else if(op.kind==='sale')authority=await verifySale(env.DB,context,op,saved.result,saved.createdAt);
 else if(op.kind==='welcome')authority=await verifyWelcome(env.DB,context,saved.result);
 else authority=await verifyAuto(env.DB,context,op,saved.result,saved.createdAt,saved.jobRequestId);
 if(SIGIL.has(op.kind)&&saved.createdAt!==saved.result.operation.createdAt)corrupt();
 const actual=operationCosts(op,saved.result);
 if(!same(saved.costs,actual)||op.fields.expectedCosts&&!same(op.fields.expectedCosts,actual))corrupt();
 return {found:true,result:saved.result,recoveryAllowed:false,receipt:{version:1,kind:op.kind,requestId:op.requestId,requestKey:op.request,signature:op.signature,scope:saved.scope,createdAt:saved.createdAt,costs:actual,authority}};
}
export async function view(env,tg,body={},now=Date.now(),namespace='service') {
 const op=operation(body.kind,body,namespace),{context}=await actorContext(env,tg,now,body),saved=await record(env,context,op);
 const {context:current}=await actorContext(env,tg,now,body);
 return {...current,kind:op.kind,requestId:op.requestId,signature:op.signature,...saved};
}
