// Scoped scene adapter over the original exchange transaction and operation table.
// Receipt reads never settle a character, create a listing or replay a mutation.
import { GameError } from '../game/classes.js';
import * as Market from './market-exchange.js';

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (code, message, status = 400) => { throw new GameError(code, message, status); };
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
const checkedId = value => {
  if (!identity(value)) fail('selection', '請提供完整的原交易選取');
  return value;
};
const corrupt = () => fail('exchange_receipt_corrupt', '原交易收據目前無法完整核對，請保留原操作編號', 409);
const rejections = new WeakMap();
const REJECTED_BUSINESS = new Set(['gold','closed','not_found','not_owned','self_trade','protected','untradeable','item','party','guardian_level','auto_active','insufficient','in_exchange']);
export const rejectionOf = error => error && typeof error === 'object' ? rejections.get(error) || null : null;
const activeRealm = env => !env.REALM_CONTEXT?.phase || env.REALM_CONTEXT.phase === 'ACTIVE';
const scopeOf = context => ({ accountId: context.accountId, realmId: context.realmId, characterId: context.characterId });
const actorIdentity = actor => [String(actor.tg_id), String(actor.account_tg_id || actor.tg_id), actor.active_char_id == null ? null : String(actor.active_char_id), actor.rev];

// The order and values below deliberately match market-exchange.js payload_json.
// contextEpoch is a caller generation, not part of an original persisted intent.
export function operation(body = {}) {
  if (!plain(body) || !['create', 'buy', 'cancel'].includes(body.kind))
    fail('exchange_action', '請選擇有效的交易操作');
  const kind = body.kind;
  const common = ['accountId', 'realmId', 'selectedCharacterId', 'contextEpoch', 'tgId', 'kind', 'requestId', 'characterId', 'recovery'];
  const specific = kind === 'create' ? ['equipId', 'item', 'guardianId', 'qty', 'price'] : ['listingId'];
  if (Object.keys(body).some(key => !common.includes(key) && !specific.includes(key)))
    fail('exchange_action', '交易內容包含不適用的欄位，請保留原始確認資料');
  if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))
    fail('request', '需要有效的操作編號');
  if (has(body, 'recovery') && typeof body.recovery !== 'boolean') fail('exchange_action', '原筆恢復標記無效');
  const requestId = body.requestId.toLowerCase(), characterId = checkedId(body.characterId);
  let payload, fields;
  if (kind === 'create') {
    const selected = ['equipId', 'item', 'guardianId'].filter(key => has(body, key));
    if (selected.length !== 1) fail('selection', '一次只能上架一種道具、一件裝備或一位天使');
    const key = selected[0], assetKind = key === 'equipId' ? 'equip' : key === 'guardianId' ? 'guardian' : 'item';
    const ref = checkedId(body[key]), qty = body.qty, price = body.price;
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > (assetKind === 'item' ? Market.EXCHANGE.maxQty : 1))
      fail('qty', '數量無效');
    if (!Number.isSafeInteger(price) || price < 1 || price > Market.EXCHANGE.maxPrice)
      fail('price', '售價須為 1 至 1,000,000 的整數金幣');
    payload = { kind: assetKind, ref, qty, price, characterId };
    fields = { [key]: ref, qty, price, characterId };
  } else {
    const listingId = checkedId(body.listingId);
    payload = { listingId, characterId };
    fields = { listingId, characterId };
  }
  if (characterId !== body.selectedCharacterId)
    fail('character_changed', '原交易角色與目前選取不符，請回到原角色核對', 409);
  return { kind, requestId, payload, fields, signature: JSON.stringify({ kind, payload }) };
}

export async function actorContext(env, tg, body, now) {
  if (!plain(body) || !integer(body.contextEpoch))
    fail('exchange_context', '角色狀態已變更，請重新開啟交易所');
  if (!identity(body.accountId)) fail('account_required', '請先核對目前帳號');
  if (!identity(body.realmId)) fail('realm_required', '請先選擇遊戲環境');
  if (!identity(body.selectedCharacterId)) fail('selected_character_required', '請先選擇角色');
  const realmId = env.REALM_CONTEXT?.id || 'permanent', characterId = String(tg);
  if (body.realmId !== realmId) fail('realm_mismatch', '環境不一致', 409);
  if (body.selectedCharacterId !== characterId)
    fail('character_changed', '角色已切換，請回到原角色核對這筆交易', 409);
  const actor = await env.DB.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(characterId).first();
  if (!actor) fail('no_character', '找不到目前帳號的角色', 404);
  const accountId = String(actor.account_tg_id || characterId);
  if (body.accountId !== accountId) fail('account_changed', '帳號已變更，請回到原帳號核對', 409);
  if (actor.active_char_id != null && String(actor.active_char_id) !== characterId)
    fail('character_changed', '角色已在另一個視窗切換，請回到原角色核對', 409);
  if (!integer(actor.rev) || !integer(now)) fail('exchange_data', '交易所資料尚未完整，請稍後重新整理', 500);
  return { actor, context: { ok: true, schemaVersion: 1, accountId, realmId, characterId,
    contextEpoch: body.contextEpoch, revision: actor.rev, serverNow: now } };
}

function validateResult(result, op, createdAt) {
  if (!plain(result) || !plain(result.listing)) corrupt();
  const listing = result.listing, expectedStatus = { create: 'active', buy: 'sold', cancel: 'cancelled' }[op.kind];
  if (result.action !== op.kind || !identity(result.listingId) || listing.id !== result.listingId
      || listing.status !== expectedStatus || !['equip', 'item', 'guardian'].includes(listing.kind)
      || !Number.isSafeInteger(result.qty) || result.qty < 1 || result.qty > Market.EXCHANGE.maxQty
      || listing.kind !== 'item' && result.qty !== 1 || listing.qty !== result.qty
      || !Number.isSafeInteger(result.price) || result.price < 1 || result.price > Market.EXCHANGE.maxPrice
      || listing.price !== result.price || listing.fee !== Math.ceil(result.price / 20)
      || listing.netGold !== listing.price - listing.fee || result.fee !== (op.kind === 'cancel' ? 0 : listing.fee)
      || result.netGold !== (op.kind === 'cancel' ? 0 : result.price - result.fee)
      || !plain(listing.seller) || !identity(listing.seller.characterId)
      || !integer(listing.createdAt) || listing.updatedAt !== createdAt
      || listing.ownedByMe !== (op.kind !== 'buy') || listing.canBuy !== false) corrupt();
  const ref = listing.kind === 'equip' ? listing.equipId : listing.kind === 'guardian' ? listing.guardianId : listing.item;
  if (!identity(ref)) corrupt();
  if (op.kind === 'create') {
    if (listing.kind !== op.payload.kind || ref !== op.payload.ref || result.qty !== op.payload.qty
        || result.price !== op.payload.price || listing.seller.characterId !== op.payload.characterId) corrupt();
  } else if (result.listingId !== op.payload.listingId) corrupt();
  if (op.kind === 'cancel' && result.returnedCharacterId !== listing.seller.characterId) corrupt();
}

// Original operation rows are committed in the same atomic batch as escrow,
// transfer and ledger rows. Never infer a receipt from today's listing or balance.
export async function record(env, context, op) {
  const row = await env.DB.prepare('SELECT account_tg_id,request_id,char_id,action,payload_json,result_json,created_at FROM rpg_exchange_operations WHERE account_tg_id=? AND request_id=?')
    .bind(context.accountId, op.requestId).first();
  if (!row) return { found: false, status: 'missing', result: null, receipt: null, recoveryAllowed: activeRealm(env) };
  if (row.account_tg_id !== context.accountId || row.request_id !== op.requestId
      || row.char_id !== context.characterId || row.action !== op.kind || row.payload_json !== JSON.stringify(op.payload))
    fail('request_reused', '同一操作編號不可更換角色或內容，請保留原始確認資料', 409);
  if (!integer(row.created_at)) corrupt();
  let result;
  try { result = JSON.parse(row.result_json); } catch { corrupt(); }
  validateResult(result, op, row.created_at);
  return { found: true, status: 'committed', result, recoveryAllowed: false,
    receipt: { schemaVersion: 1, scope: scopeOf(context), kind: op.kind, requestId: op.requestId,
      payload: op.payload, signature: op.signature, createdAt: row.created_at } };
}
const envelope = (context, op, saved, extra = {}) => ({ ...context, kind: op.kind,
  requestId: op.requestId, signature: op.signature, ...saved, ...extra });

async function savedSnapshot(env, tg, body, now, op) {
  const before = await actorContext(env, tg, body, now);
  const saved = await record(env, before.context, op), after = await actorContext(env, tg, body, now);
  if (JSON.stringify(actorIdentity(before.actor)) !== JSON.stringify(actorIdentity(after.actor)))
    fail('character_changed', '角色或交易所狀態已更新，請保留原編號重新查核', 409);
  return { ...after, saved };
}
export async function receipt(env, tg, body = {}, now = Date.now()) {
  const op = operation(body), snapshot = await savedSnapshot(env, tg, body, now, op);
  return envelope(snapshot.context, op, snapshot.saved);
}

// Keep the realm wrapper around the original batch and add the captured actor
// guard in that SAME transaction. This also rejects a switch away and back.
function scopedEnv(env, actor, onCommit) {
  const db = env.DB, statements = new WeakMap(), characterId = String(actor.tg_id);
  const accountId = String(actor.account_tg_id || characterId);
  const guard = () => db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM rpg_live_characters c JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=? AND c.account_tg_id=? AND c.rev=? AND a.active_char_id=c.tg_id)')
    .bind(characterId, accountId, actor.rev);
  async function execute(items) {
    if (!Array.isArray(items)) throw new Error('exchange scoped batch is invalid');
    if (!items.length) return [];
    const entries = items.map(item => {
      const entry = statements.get(item);
      if (!entry) throw new Error('exchange scoped statement belongs to another database');
      return entry;
    });
    const writing = entries.some(entry => !entry.readOnly);
    const result = await db.batch([...(writing ? [guard()] : []), ...entries.map(entry => entry.statement)]);
    if (writing) onCommit();
    return writing ? result.slice(1) : result;
  }
  function wrap(statement, readOnly) {
    const wrapped = {
      bind(...values) { return wrap(statement.bind(...values), readOnly); },
      async all() { return (await execute([wrapped]))[0]; },
      async run() { return (await execute([wrapped]))[0]; },
      async first(column) {
        const row = (await execute([wrapped]))[0]?.results?.[0] ?? null;
        return column && row ? row[column] : row;
      }
    };
    statements.set(wrapped, { statement, readOnly });
    return wrapped;
  }
  return { ...env, DB: { prepare(sql) { return wrap(db.prepare(sql), /^\s*SELECT\b/i.test(sql)); }, batch: execute } };
}

export async function run(env, tg, body = {}, now = Date.now()) {
  const op = operation(body), before = await actorContext(env, tg, body, now);
  if (!activeRealm(env)) fail('realm_read_only', '這個世界目前僅供查看，請查核原交易收據', 409);
  const previous = await record(env, before.context, op);
  if (previous.found) {
    const after = await actorContext(env, tg, body, now);
    if (JSON.stringify(actorIdentity(before.actor)) !== JSON.stringify(actorIdentity(after.actor)))
      fail('character_changed', '角色或交易所狀態已更新，請保留原編號重新查核', 409);
    return envelope(after.context, op, previous, { replayed: true });
  }
  let committed = false;
  const scoped = scopedEnv(env, before.actor, () => { committed = true; });
  try {
    await Market[op.kind](scoped, tg, { ...op.fields, requestId: op.requestId }, now);
  } catch (error) {
    // A response failure after commit must resolve through the original receipt.
    // A missing receipt is never converted into success or an automatic retry.
    const current = await savedSnapshot(env, tg, body, now, op), saved = current.saved;
    if (saved.found) return envelope(current.context, op, saved, { replayed: true });
    if (!committed && body.recovery !== true && error instanceof GameError && REJECTED_BUSINESS.has(error.code)
        && error.status >= 400 && error.status < 500
        && JSON.stringify(actorIdentity(before.actor)) === JSON.stringify(actorIdentity(current.actor))) {
      const checked = await actorContext(env, tg, body, now);
      if (JSON.stringify(actorIdentity(current.actor)) === JSON.stringify(actorIdentity(checked.actor)))
        rejections.set(error, envelope(checked.context, op, { found: false, status: 'rejected', result: null,
          receipt: null, recoveryAllowed: false }, { ok: false, definitiveRejection: true, error: error.code, message: error.message }));
    }
    throw error;
  }
  const current = await savedSnapshot(env, tg, body, now, op), saved = current.saved;
  if (!saved.found) fail('exchange_receipt_pending', '原交易結果尚待核對，請保留原操作編號', 409);
  return envelope(current.context, op, saved, { replayed: !committed });
}
