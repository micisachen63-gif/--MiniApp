/* Strictly SELECT-only direct trade scene; expiry settlement remains in its original authority. */
import { GameError } from '../game/classes.js';
import * as TRADE from './trade.js';
import * as SHARE from './share.js';

const TRADE_PAGE = 20;
const REQUEST_PAGE = 30;
const RECENT_REQUEST_MS = 3 * 86400e3;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value);
const fail = (code, message, status = 400) => { throw new GameError(code, message, status); };
const actorIdentity = row => [String(row.tg_id), String(row.account_tg_id || row.tg_id), row.active_char_id == null ? null : String(row.active_char_id), row.rev];

async function actor(db, id) {
  return db.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(id).first();
}
async function snapshot(db, actorId, now, tradeId) {
  const trades = (await db.prepare("SELECT id,rev,status,offer_rev,updated_at,expires_at FROM rpg_trades WHERE (a_tg=? OR b_tg=?) ORDER BY (status='open') DESC, updated_at DESC, id DESC LIMIT ?").bind(actorId,actorId,TRADE_PAGE).all()).results || [];
  const requests = (await db.prepare("SELECT * FROM rpg_trade_requests WHERE (owner_tg=? OR requester_tg=?) AND (status='pending' OR decided_at>?) ORDER BY (status='pending') DESC, created_at DESC, id DESC LIMIT ?").bind(actorId,actorId,now-RECENT_REQUEST_MS,REQUEST_PAGE).all()).results || [];
  const selected = tradeId == null ? null : await db.prepare('SELECT id,rev,status,offer_rev,updated_at,expires_at FROM rpg_trades WHERE id=? AND (a_tg=? OR b_tg=?)').bind(tradeId,actorId,actorId).first();
  return { trades, requests, selected };
}
export async function view(env, tg, input = {}, now = Date.now()) {
  const allowed = new Set(['accountId','realmId','selectedCharacterId','contextEpoch','tradeId','tgId']);
  if (!plain(input) || Object.keys(input).some(key => !allowed.has(key))) fail('trade_scene_input', '交易場景讀取參數無效');
  if (!integer(input.contextEpoch) || input.contextEpoch < 0) fail('trade_context', '交易畫面已變更，請重新整理');
  if (!integer(now) || now < 0) fail('trade_data', '交易時間無效', 500);
  const id = String(tg), realmId = env.REALM_CONTEXT?.id || 'permanent', db = env.DB;
  if (typeof input.realmId !== 'string' || !input.realmId) fail('realm_required', '請先選擇遊戲環境');
  if (input.realmId !== realmId) fail('realm_mismatch', '遊戲環境不一致', 409);
  if (typeof input.selectedCharacterId !== 'string' || !input.selectedCharacterId) fail('selected_character_required', '請先選擇角色');
  if (input.selectedCharacterId !== id) fail('character_changed', '角色已切換，請重新整理', 409);
  if (typeof input.accountId !== 'string' || !input.accountId) fail('account_required', '請先核對帳號');
  const tradeId = input.tradeId == null ? null : input.tradeId;
  if (tradeId !== null && (typeof tradeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tradeId))) fail('trade_scene_input', '交易識別無效');

  const before = await actor(db,id);
  if (!before) fail('no_character', '找不到選定角色', 404);
  const accountId = String(before.account_tg_id || id);
  if (input.accountId !== accountId) fail('account_changed', '帳號已變更，請重新整理', 409);
  if (before.active_char_id != null && String(before.active_char_id) !== id) fail('character_changed', '角色已在另一個視窗切換', 409);
  if (!integer(before.rev) || before.rev < 0) fail('trade_data', '角色狀態無效', 500);

  const original = await snapshot(db,id,now,tradeId);
  if (tradeId !== null && !original.selected) fail('not_found', '找不到可讀取的本人交易', 404);
  const tradeViews = [];
  for (const row of original.trades) {
    const trade = await TRADE.tradeView(env,row.id,id,now);
    if (!trade?.me) fail('trade_changed', '交易資訊已更新，請重新整理', 409);
    tradeViews.push({ ...trade, expiryPendingMaintenance: trade.status === 'open' && trade.expiresAt <= now });
  }
  const requestViews = [];
  for (const row of original.requests) {
    const request = await SHARE.requestView(env,row,now);
    if (!request) fail('trade_changed', '交易請求已更新，請重新整理', 409);
    requestViews.push({ ...request, expiryPendingMaintenance: request.status === 'pending' && request.expiresAt <= now });
  }
  let selected = null;
  if (tradeId !== null) {
    selected = tradeViews.find(row => row.id === tradeId) || await TRADE.tradeView(env,tradeId,id,now);
    if (!selected?.me) fail('not_found', '找不到可讀取的本人交易', 404);
    selected = { ...selected, expiryPendingMaintenance: selected.status === 'open' && selected.expiresAt <= now };
  }
  const afterSnapshot = await snapshot(db,id,now,tradeId);
  const after = await actor(db,id);
  if (!after || JSON.stringify(actorIdentity(after)) !== JSON.stringify(actorIdentity(before))
      || JSON.stringify(afterSnapshot) !== JSON.stringify(original)) fail('trade_changed', '交易或選角狀態已變更，請重新整理', 409);

  return { ok:true, schemaVersion:1, accountId, realmId, characterId:id, contextEpoch:input.contextEpoch,
    revision:before.rev, serverNow:now, pureRead:true, pageLimits:{trades:TRADE_PAGE,requests:REQUEST_PAGE},
    trades:{open:tradeViews.filter(row=>row.status==='open'),history:tradeViews.filter(row=>row.status!=='open')},
    requests:{incoming:requestViews.filter(row=>String(row.owner.tgId)===id),outgoing:requestViews.filter(row=>String(row.requester.tgId)===id)},
    selected };
}
