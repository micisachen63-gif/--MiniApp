/* Scoped original-intent invitations: request, accept, reject, withdraw, gear-open.
 * The old share/trade authorities perform every write. A typed receipt is added
 * to their SAME D1 batch, using the existing rpg_trade_operations table.
 * Read-only receipt never expires a request or settles any escrow.
 */
import {GameError} from '../game/classes.js';
import * as Share from './share.js';
import * as Trade from './trade.js';

const NS='direct-trade-invites-v1';
const TYPE='scoped-direct-trade-invitation-v1';
const KINDS=new Set(['request','accept','reject','withdraw','open']);
const COMMON=new Set(['accountId','realmId','selectedCharacterId','contextEpoch','kind','requestId','recovery','tgId']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const identity=x=>typeof x==='string'&&x.length>0&&x.length<=128&&!/[\u0000-\u001f]/.test(x);
const fail=(code,message,status=400)=>{throw new GameError(code,message,status);};
const reuse=()=>fail('request_reused','邀請 UUID 已用於另一項操作或不同交易目標，請保留原始請求',409);
const corrupt=()=>fail('trade_invitation_receipt_corrupt','邀請收據與原始交易資料不符，請保留原始請求',409);
const live=env=>!env.REALM_CONTEXT?.phase||env.REALM_CONTEXT.phase==='ACTIVE';
const scopeOf=context=>({accountId:context.accountId,realmId:context.realmId,characterId:context.characterId});
const fingerprint=x=>[String(x.tg_id),String(x.account_tg_id||x.tg_id),x.active_char_id==null?null:String(x.active_char_id),x.rev];
const storageId=uuid=>'app:ti_'+uuid.replaceAll('-','');

export function operation(body={}){
  if(!plain(body)||!KINDS.has(body.kind))fail('trade_invitation_action','無效的交易邀請操作');
  const kind=body.kind,specific=kind==='request'?['shareId']:kind==='open'?['equipId','targetCharId']:['reqId'];
  if(Object.keys(body).some(k=>!COMMON.has(k)&&!specific.includes(k)))
    fail('trade_invitation_action','邀請包含不屬於本次原始操作的參數');
  if(typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))
    fail('request','請提供原始邀請 UUID');
  if(!integer(body.contextEpoch))fail('trade_context','邀請畫面已變更');
  if(Object.hasOwn(body,'recovery')&&typeof body.recovery!=='boolean')
    fail('trade_invitation_action','恢復標記格式無效');
  if(specific.some(key=>!identity(body[key])))
    fail('trade_invitation_action','邀請識別或交易目標無效');
  const payload=Object.fromEntries(specific.map(k=>[k,body[k]]));
  const requestId=body.requestId.toLowerCase();
  return {kind,requestId,payload,storageRequestId:storageId(requestId),
    initialRequestId:'q'+requestId.replaceAll('-','')};
}
async function actorContext(env,tg,body,now){
  if(!plain(body)||!integer(body.contextEpoch)||!integer(now))fail('trade_context','邀請畫面已切換');
  if(!identity(body.accountId)||!identity(body.realmId)||!identity(body.selectedCharacterId))
    fail('trade_context','帳號、世界或角色資訊不完整');
  const id=String(tg),realmId=env.REALM_CONTEXT?.id||'permanent',db=env.DB;
  if(body.realmId!==realmId)fail('realm_mismatch','遊戲世界不一致',409);
  if(body.selectedCharacterId!==id)fail('character_changed','角色已變更，請重新核對邀請',409);
  const actor=await db.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(id).first();
  if(!actor)fail('no_character','找不到目前角色',404);
  const accountId=String(actor.account_tg_id||id);
  if(body.accountId!==accountId)fail('account_changed','帳號已切換',409);
  if(actor.active_char_id!=null&&String(actor.active_char_id)!==id)
    fail('character_changed','角色已在其他視窗切換',409);
  if(!integer(actor.rev))fail('trade_invitation_data','角色資料無效',500);
  return {actor,context:{ok:true,schemaVersion:1,accountId,realmId,characterId:id,
    contextEpoch:body.contextEpoch,revision:actor.rev,serverNow:now}};
}
function descriptor(context,op){
  return {scope:scopeOf(context),kind:op.kind,requestId:op.requestId,
    payload:op.payload,signature:JSON.stringify({accountId:context.accountId,realmId:context.realmId,
      characterId:context.characterId,kind:op.kind,requestId:op.requestId,payload:op.payload})};
}
function stampedResult(op,info){
  switch(op.kind){
    case 'request':
      return {reqId:info.id,shareId:info.shareId,ownerTg:info.ownerTg,requesterTg:info.requesterTg,status:'pending'};
    case 'accept':
      return {reqId:info.reqId,tradeId:info.tradeId,shareId:info.shareId,ownerTg:info.ownerTg,requesterTg:info.requesterTg,status:'accepted'};
    case 'reject':
    case 'withdraw':
      return {reqId:info.reqId,shareId:info.shareId,ownerTg:info.ownerTg,requesterTg:info.requesterTg,status:info.status};
    case 'open':
      return {tradeId:info.tradeId,equipId:info.equipId,ownerTg:info.ownerTg,targetCharId:info.otherTg,status:'open'};
    default:throw Error('Invalid invitation authority result');
  }
}
function appendReceipt(context,op,now){
  const expected=descriptor(context,op);
  return (db,info)=>{
    const result=stampedResult(op,info);
    return [db.prepare('INSERT INTO rpg_trade_operations(trade_id,tg_id,request_id,result_json,created_at) VALUES(?,?,?,?,?)')
      .bind(NS,context.accountId,op.storageRequestId,JSON.stringify({
        receiptType:TYPE,...expected,createdAt:now,result
      }),now)];
  };
}
async function validateAuthority(db,context,op,result){
  if(!plain(result))corrupt();
  if(op.kind==='request'){
    if(result.reqId!==op.initialRequestId||result.shareId!==op.payload.shareId||
      result.requesterTg!==context.characterId||!identity(result.ownerTg)||result.status!=='pending')corrupt();
    const row=await db.prepare('SELECT id,share_id,requester_tg,owner_tg FROM rpg_trade_requests WHERE id=?').bind(result.reqId).first();
    if(!row||row.share_id!==result.shareId||row.requester_tg!==context.characterId||row.owner_tg!==result.ownerTg)corrupt();
  }else if(op.kind==='accept'){
    if(result.reqId!==op.payload.reqId||result.ownerTg!==context.characterId||
      !identity(result.tradeId)||result.status!=='accepted')corrupt();
    const row=await db.prepare('SELECT id,share_id,trade_id,owner_tg,requester_tg,status FROM rpg_trade_requests WHERE id=?').bind(result.reqId).first();
    if(!row||row.trade_id!==result.tradeId||row.owner_tg!==context.characterId||
      row.share_id!==result.shareId||row.requester_tg!==result.requesterTg||row.status!=='accepted')corrupt();
    const trade=await db.prepare('SELECT id,a_tg,b_tg,request_id,origin FROM rpg_trades WHERE id=?').bind(result.tradeId).first();
    if(!trade||trade.a_tg!==context.characterId||trade.b_tg!==result.requesterTg||
       trade.request_id!==result.reqId||trade.origin!=='share')corrupt();
  }else if(op.kind==='reject'||op.kind==='withdraw'){
    const status=op.kind==='reject'?'rejected':'cancelled';
    if(result.reqId!==op.payload.reqId||result.status!==status||
      (op.kind==='reject'?result.ownerTg:result.requesterTg)!==context.characterId)corrupt();
    const row=await db.prepare('SELECT share_id,status,owner_tg,requester_tg FROM rpg_trade_requests WHERE id=?').bind(result.reqId).first();
    if(!row||row.status!==status||row.share_id!==result.shareId||
       row.owner_tg!==result.ownerTg||row.requester_tg!==result.requesterTg)corrupt();
  }else if(op.kind==='open'){
    if(result.equipId!==op.payload.equipId||result.targetCharId!==op.payload.targetCharId||
      result.ownerTg!==context.characterId||result.status!=='open'||!identity(result.tradeId))corrupt();
    const trade=await db.prepare('SELECT id,a_tg,b_tg,request_id,origin FROM rpg_trades WHERE id=?').bind(result.tradeId).first();
    if(!trade||trade.a_tg!==context.characterId||trade.b_tg!==result.targetCharId||
       trade.request_id!=='gear:'+op.storageRequestId||trade.origin!=='gear')corrupt();
    const line=await db.prepare("SELECT ref FROM rpg_trade_items WHERE trade_id=? AND side='a' AND kind='equip' AND ref=?")
      .bind(result.tradeId,result.equipId).first();
    if(!line)corrupt();
  }else corrupt();
}
async function record(env,context,op){
  const row=await env.DB.prepare('SELECT result_json,created_at FROM rpg_trade_operations WHERE trade_id=? AND tg_id=? AND request_id=?')
    .bind(NS,context.accountId,op.storageRequestId).first();
  if(!row)return {found:false,status:'missing',result:null,receipt:null,recoveryAllowed:live(env)};
  let saved;
  try{saved=JSON.parse(row.result_json);}catch{corrupt();}
  const expected=descriptor(context,op);
  if(!plain(saved)||saved.receiptType!==TYPE)reuse();
  if(saved.kind!==expected.kind||saved.requestId!==expected.requestId||
      saved.signature!==expected.signature||!plain(saved.scope)||
      JSON.stringify(saved.scope)!==JSON.stringify(expected.scope)||
      JSON.stringify(saved.payload)!==JSON.stringify(expected.payload))reuse();
  if(!integer(row.created_at)||saved.createdAt!==row.created_at)corrupt();
  await validateAuthority(env.DB,context,op,saved.result);
  return {found:true,status:'committed',result:saved.result,recoveryAllowed:false,
    receipt:{schemaVersion:1,...scopeOf(context),kind:op.kind,requestId:op.requestId,
      payload:op.payload,signature:expected.signature,createdAt:row.created_at}};
}
const envelope=(context,op,saved,extra={})=>({...context,kind:op.kind,requestId:op.requestId,
  signature:descriptor(context,op).signature,...saved,...extra});
async function snapshot(env,tg,body,now,op){
  const before=await actorContext(env,tg,body,now);
  const saved=await record(env,before.context,op);
  const after=await actorContext(env,tg,body,now);
  if(JSON.stringify(fingerprint(before.actor))!==JSON.stringify(fingerprint(after.actor)))
    fail('character_changed','邀請期間角色已變更，請核對原始 UUID',409);
  return {context:after.context,saved};
}
export async function receipt(env,tg,body={},now=Date.now()){
  const op=operation(body),current=await snapshot(env,tg,body,now,op);
  return envelope(current.context,op,current.saved);
}
function guardedEnv(env,actor,targetCharId=null){
  const db=env.DB,charId=String(actor.tg_id),account=String(actor.account_tg_id||charId);
  const guard=()=>db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM rpg_live_characters c JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND c.account_tg_id=? AND c.rev=? AND a.active_char_id=c.tg_id)')
    .bind(charId,account,actor.rev);
  return {...env,DB:{
    prepare(sql){return db.prepare(sql);},
    async batch(stmts){
      if(!live(env))fail('realm_read_only','目前世界不允許新交易邀請',409);
      if(!Array.isArray(stmts)||!stmts.length)throw Error('Invalid invitation batch');
      const targetGuard=targetCharId===null?[]:[db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM rpg_live_characters c JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND a.active_char_id=c.tg_id)')
        .bind(targetCharId)];
      const result=await db.batch([guard(),...targetGuard,...stmts]);
      return result.slice(1+targetGuard.length);
    }
  }};
}
async function submit(env,context,op,now){
  const extraStmts=appendReceipt(context,op,now);
  const args={tgId:context.characterId};
  switch(op.kind){
    case 'request':return Share.requestTrade(env,{...args,shareId:op.payload.shareId},now,
      {scoped:true,id:op.initialRequestId,extraStmts});
    case 'accept':return Share.acceptRequest(env,{...args,requestId:op.payload.reqId},now,{scoped:true,extraStmts});
    case 'reject':return Share.rejectRequest(env,{...args,requestId:op.payload.reqId},now,{scoped:true,extraStmts});
    case 'withdraw':return Share.cancelRequest(env,{...args,requestId:op.payload.reqId},now,{scoped:true,extraStmts});
    case 'open':return Trade.openWithEquip(env,{...args,target:{tgId:op.payload.targetCharId},
      equipId:op.payload.equipId,requestId:op.storageRequestId},now,{scoped:true,extraStmts});
    default:throw Error('Unknown invitation action');
  }
}
export async function run(env,tg,body={},now=Date.now()){
  const op=operation(body),before=await actorContext(env,tg,body,now);
  const saved=await record(env,before.context,op);
  if(saved.found){
    const after=await actorContext(env,tg,body,now);
    if(JSON.stringify(fingerprint(before.actor))!==JSON.stringify(fingerprint(after.actor)))
      fail('character_changed','角色已切換，請核對原始邀請',409);
    return envelope(after.context,op,saved,{replayed:true});
  }
  if(!live(env))fail('realm_read_only','目前世界只允許查詢已提交的邀請收據',409);
  const scoped=guardedEnv(env,before.actor,op.kind==='open'?op.payload.targetCharId:null);
  try{
    await submit(scoped,before.context,op,now);
  }catch(error){
    const current=await snapshot(env,tg,body,now,op);
    if(current.saved.found)return envelope(current.context,op,current.saved,{replayed:true});
    throw error;
  }
  const current=await snapshot(env,tg,body,now,op);
  if(!current.saved.found)fail('trade_invitation_receipt_pending','邀請結果待核對，請保留原 UUID',409);
  return envelope(current.context,op,current.saved,{replayed:false});
}
