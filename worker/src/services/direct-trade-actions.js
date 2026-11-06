/* The original person-to-person trade authority owns every economic write.
 * No new D1 table: signed scoped receipts are stored in the original
 * rpg_trade_operations.result_json, inside the same atomic escrow/ledger batch.
 * Historical rows lack a signature and can never be promoted to scoped proof. */
import { GameError } from '../game/classes.js';
import { TRADE } from '../game/constants.js';
import * as Trade from './trade.js';

const KINDS = new Set(['gold','add','remove','lock','confirm','cancel']);
const COMMON = new Set(['accountId','realmId','selectedCharacterId','contextEpoch','tradeId','kind','requestId','recovery','tgId','offerRev']);
const ASSET = ['equipId','sigilId','item'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
const fail = (code,message,status=400) => { throw new GameError(code,message,status); };
const collision = () => fail('request_reused','這個交易請求編號已用於另一項操作或不同參數，請核對原始請求',409);
const corrupt = () => fail('trade_receipt_corrupt','原始交易收據無法完整驗證，請保留請求編號',409);
const activeRealm = env => !env.REALM_CONTEXT?.phase || env.REALM_CONTEXT.phase === 'ACTIVE';
const actorFingerprint = row => [String(row.tg_id),String(row.account_tg_id || row.tg_id),
  row.active_char_id == null ? null : String(row.active_char_id),row.rev];

// All economic fields are canonical integers, not client-coerced values.
export function operation(body = {}) {
  if (!plain(body) || !KINDS.has(body.kind)) fail('trade_action','無效的人對人交易操作');
  const kind = body.kind, specific = kind === 'gold' ? ['gold']
    : kind === 'add' || kind === 'remove' ? [...ASSET,'qty'] : [];
  if (Object.keys(body).some(key => !COMMON.has(key) && !specific.includes(key)))
    fail('trade_action','交易參數包含非本次確認的欄位');
  if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))
    fail('request','請提供原始交易 UUID');
  if (!identity(body.tradeId) || !/^[A-Za-z0-9_-]{1,128}$/.test(body.tradeId))
    fail('trade_action','交易識別無效');
  if (!integer(body.offerRev)) fail('offer_changed','請提供已檢視的報價版本',409);
  if (!integer(body.contextEpoch)) fail('trade_context','交易場景狀態已變更');
  if (Object.hasOwn(body,'recovery') && typeof body.recovery !== 'boolean')
    fail('trade_action','恢復標記格式無效');
  let payload,fields={};
  if (kind === 'gold') {
    if (!integer(body.gold) || body.gold > TRADE.maxGold)
      fail('gold','金幣必須是範圍內的整數');
    payload={gold:body.gold};fields={gold:body.gold};
  } else if (kind === 'add' || kind === 'remove') {
    const selected=ASSET.filter(key => Object.hasOwn(body,key));
    if (selected.length !== 1) fail('trade_action','一次只允許一種已確認資產');
    const key=selected[0],ref=body[key];
    if (!identity(ref)) fail('trade_action','資產識別無效');
    const assetKind=key === 'equipId' ? 'equip' : key === 'sigilId' ? 'sigil' : 'item';
    if (assetKind !== 'item') {
      if (Object.hasOwn(body,'qty') && body.qty !== 1 && body.qty !== null)
        fail('qty','裝備及守護羽毛交易數量必須是一');
      payload={assetKind,ref,qty:1};fields={[key]:ref};
    } else if (kind === 'add') {
      if (!integer(body.qty) || body.qty < 1 || body.qty > 99999)
        fail('qty','道具數量無效');
      payload={assetKind,ref,qty:body.qty};fields={item:ref,qty:body.qty};
    } else {
      if (Object.hasOwn(body,'qty') && body.qty !== null && (!integer(body.qty) || body.qty < 1))
        fail('qty','撤回道具數量無效');
      payload={assetKind,ref,qty:body.qty ?? null};
      fields={item:ref,qty:body.qty ?? null};
    }
  } else payload={};
  const requestId=body.requestId.toLowerCase();
  return {kind,requestId,storageRequestId:'app:dt_'+requestId.replaceAll('-',''),
    tradeId:body.tradeId,offerRev:body.offerRev,payload,fields};
}
async function actorContext(env,tg,body,now) {
  if (!plain(body) || !integer(body.contextEpoch) || !integer(now))
    fail('trade_context','交易場景狀態已變更');
  if (!identity(body.accountId) || !identity(body.realmId) || !identity(body.selectedCharacterId))
    fail('trade_context','交易帳號、環境或角色未設定');
  const characterId=String(tg),realmId=env.REALM_CONTEXT?.id || 'permanent';
  if (body.realmId !== realmId) fail('realm_mismatch','遊戲環境不一致',409);
  if (body.selectedCharacterId !== characterId) fail('character_changed','角色已切換，請重新核對交易',409);
  const actor=await env.DB.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(characterId).first();
  if (!actor) fail('no_character','找不到選定角色',404);
  const accountId=String(actor.account_tg_id || characterId);
  if (body.accountId !== accountId) fail('account_changed','帳號已變更，請重新核對交易',409);
  if (actor.active_char_id != null && String(actor.active_char_id) !== characterId)
    fail('character_changed','角色已在另一個視窗切換',409);
  if (!integer(actor.rev)) fail('trade_data','角色版本無效',500);
  const context={ok:true,schemaVersion:1,accountId,realmId,characterId,
    contextEpoch:body.contextEpoch,revision:actor.rev,serverNow:now};
  return {actor,context};
}
async function ownedTrade(env,context,op) {
  const trade=await env.DB.prepare('SELECT id,a_tg,b_tg,offer_rev,status,expires_at FROM rpg_trades WHERE id=?').bind(op.tradeId).first();
  if (!trade) fail('not_found','找不到交易',404);
  if (![trade.a_tg,trade.b_tg].includes(context.characterId)) fail('not_party','無權讀取這項交易',403);
  return trade;
}
function descriptor(context,op) {
  return {kind:op.kind,requestId:op.requestId,tradeId:op.tradeId,accountId:context.accountId,
    realmId:context.realmId,characterId:context.characterId,offerRev:op.offerRev,payload:op.payload,
    signature:JSON.stringify({accountId:context.accountId,realmId:context.realmId,
      characterId:context.characterId,tradeId:op.tradeId,kind:op.kind,offerRev:op.offerRev,
      requestId:op.requestId,payload:op.payload})};
}
function validResult(kind, result,payload) {
  if (!plain(result)) return false;
  if (kind === 'gold') return result.gold === payload.gold || result.unchanged === true;
  if (kind === 'add' || kind === 'remove') {
    const field=kind === 'add' ? 'added' : 'removed';
    return result[field] === payload.ref && (payload.assetKind !== 'item' ||
      (kind === 'add' ? result.qty === payload.qty : integer(result.qty) && result.qty > 0));
  }
  if (kind === 'lock') return result.locked === true;
  if (kind === 'confirm') return result.confirmed === true && typeof result.done === 'boolean';
  if (kind === 'cancel') return ['cancelled','expired'].includes(result.status);
  return false;
}
async function record(env,context,op,trade) {
  const expected=descriptor(context,op);
  const row=await env.DB.prepare('SELECT result_json,created_at FROM rpg_trade_operations WHERE trade_id=? AND tg_id=? AND request_id=?')
    .bind(op.tradeId,context.characterId,op.storageRequestId).first();
  if (!row) return {found:false,status:'missing',result:null,receipt:null,
    recoveryAllowed:activeRealm(env) && trade.status==='open' && trade.expires_at > context.serverNow
      && trade.offer_rev === op.offerRev};
  let saved;
  try { saved=JSON.parse(row.result_json); } catch { corrupt(); }
  if (!plain(saved) || saved.receiptType !== 'scoped-direct-trade-v1') collision(); // legacy is not signed
  for (const key of ['signature','kind','requestId','tradeId','accountId','realmId','characterId','offerRev']) {
    if (saved[key] !== expected[key]) collision();
  }
  if (JSON.stringify(saved.payload) !== JSON.stringify(expected.payload)) collision();
  if (!integer(row.created_at) || saved.createdAt !== row.created_at ||
      !validResult(op.kind,saved.result,op.payload)) corrupt();
  return {found:true,status:'committed',result:saved.result,recoveryAllowed:false,
    receipt:{schemaVersion:1,accountId:context.accountId,realmId:context.realmId,
      characterId:context.characterId,tradeId:op.tradeId,kind:op.kind,requestId:op.requestId,
      offerRev:op.offerRev,payload:op.payload,signature:expected.signature,createdAt:row.created_at}};
}
const envelope=(context,op,saved,extras={})=>({...context,tradeId:op.tradeId,kind:op.kind,
  requestId:op.requestId,offerRev:op.offerRev,signature:descriptor(context,op).signature,
  ...saved,...extras});
async function snapshot(env,tg,body,now,op) {
  const before=await actorContext(env,tg,body,now);
  const trade=await ownedTrade(env,before.context,op);
  const saved=await record(env,before.context,op,trade);
  const after=await actorContext(env,tg,body,now);
  if (JSON.stringify(actorFingerprint(before.actor)) !== JSON.stringify(actorFingerprint(after.actor)))
    fail('character_changed','角色狀態已更新，請核對原始請求',409);
  return {context:after.context,trade,saved};
}
export async function receipt(env,tg,body={},now=Date.now()) {
  const op=operation(body),current=await snapshot(env,tg,body,now,op);
  return envelope(current.context,op,current.saved);
}
// Authoritative original trade batch is augmented by a selected-actor guard.
// This wrapper never starts a separate transaction or writes a second receipt.
function scopedEnv(env,actor) {
  const db=env.DB,characterId=String(actor.tg_id),accountId=String(actor.account_tg_id || actor.tg_id);
  const guard=()=>db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM rpg_live_characters c JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND c.account_tg_id=? AND c.rev=? AND a.active_char_id=c.tg_id)')
    .bind(characterId,accountId,actor.rev);
  return {...env,DB:{
    prepare(sql){return db.prepare(sql);},
    async batch(stmts){
      if (!activeRealm(env)) fail('realm_read_only','目前世界只允許查詢既有收據',409);
      if (!Array.isArray(stmts) || !stmts.length) throw Error('Invalid scoped direct trade batch');
      const results=await db.batch([guard(),...stmts]);
      return results.slice(1);
    }
  }};
}
async function mutateOriginal(env,tg,op,receiptRecord,now) {
  const args={tgId:String(tg),tradeId:op.tradeId,requestId:op.storageRequestId,...op.fields};
  switch(op.kind) {
    case 'gold': return Trade.setGold(env,args,now,receiptRecord);
    case 'add': return Trade.addLine(env,args,now,receiptRecord);
    case 'remove': return Trade.removeLine(env,args,now,receiptRecord);
    case 'lock': return Trade.lock(env,args,now,receiptRecord);
    case 'confirm': return Trade.confirm(env,{...args,offerRev:op.offerRev},now,receiptRecord);
    case 'cancel': return Trade.cancel(env,args,now,receiptRecord);
    default: throw Error('Unrecognized direct trade action');
  }
}
export async function run(env,tg,body={},now=Date.now()) {
  const op=operation(body),before=await actorContext(env,tg,body,now);
  const trade=await ownedTrade(env,before.context,op);
  const saved=await record(env,before.context,op,trade);
  if (saved.found) {
    const after=await actorContext(env,tg,body,now);
    if (JSON.stringify(actorFingerprint(before.actor)) !== JSON.stringify(actorFingerprint(after.actor)))
      fail('character_changed','角色狀態已更新，請核對原始請求',409);
    return envelope(after.context,op,saved,{replayed:true});
  }
  if (!activeRealm(env)) fail('realm_read_only','目前世界只允許查詢既有收據',409);
  if (trade.status!=='open' || trade.expires_at<=now) fail('closed','交易已關閉或逾時，請重新查看',409);
  if (trade.offer_rev!==op.offerRev) fail('offer_changed','交易報價已變更，請重新核對',409);
  const recordForWrite=descriptor(before.context,op),scoped=scopedEnv(env,before.actor);
  try {
    await mutateOriginal(scoped,tg,op,recordForWrite,now);
  } catch (error) {
    // A response/transport failure after the original batch may still have
    // committed. Only the typed, same-intent original receipt can prove it.
    const current=await snapshot(env,tg,body,now,op);
    if (current.saved.found) return envelope(current.context,op,current.saved,{replayed:true});
    throw error;
  }
  const current=await snapshot(env,tg,body,now,op);
  if (!current.saved.found) fail('trade_receipt_pending','交易結果待核對；請保留原始請求 ID',409);
  return envelope(current.context,op,current.saved,{replayed:false});
}
