// SELECT-only scene adapter over the existing exchange authorities.
import { GameError } from '../game/classes.js';
import * as EXCHANGE from './market-exchange.js';
import { history as exchangeHistory } from './market-exchange-history.js';

const PAGE_SIZE = 30;
const TABS = ['browse', 'mine', 'history'];
const FILTER_KEYS = ['category', 'classReq', 'tier', 'quality', 'enhanceMin', 'enhanceMax'];
const fail = (code, message, status = 400) => { throw new GameError(code, message, status); };
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value);

function encode(value) {
  return 'xs1.' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function rawCursorValid(value, tab) {
  if (typeof value !== 'string') return false;
  if (tab !== 'history')
    return /^\d{1,16}$/.test(value) && integer(Number(value)) && Number(value) > 0;
  if (!/^\d{1,16}:\d{1,16}$/.test(value)) return false;
  const [time, id] = value.split(':').map(Number);
  return integer(time) && time >= 0 && integer(id) && id > 0;
}
function readCursor(value, scope) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 1600 || !/^xs1\.[A-Za-z0-9_-]+$/.test(value))
    fail('exchange_cursor', '交易所頁碼已失效，請重新整理');
  let data;
  try {
    const raw = value.slice(4).replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { fail('exchange_cursor', '交易所頁碼已失效，請重新整理'); }
  if (!Array.isArray(data) || data.length !== 7 || !scope.every((part, i) => data[i] === part)
      || !rawCursorValid(data[6], scope[4]))
    fail('exchange_cursor', '角色、世界或交易所頁面已變更，請重新整理');
  return { selector: data[5], raw: data[6] };
}
async function actor(db, id) {
  return db.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(id).first();
}
function identity(char) {
  return [String(char.tg_id), String(char.account_tg_id || char.tg_id),
    char.active_char_id == null ? null : String(char.active_char_id), char.rev];
}

export async function view(env, tg, input = {}, now = Date.now()) {
  if (!plain(input)) fail('exchange_filters', '交易所讀取格式無效');
  const tab = input.tab, epoch = input.contextEpoch;
  if (!TABS.includes(tab)) fail('exchange_tab', '請選擇交易所頁面');
  if (!integer(epoch) || epoch < 0) fail('exchange_context', '角色狀態已變更，請重新開啟交易所');
  if (tab === 'browse') {
    if (input.filters != null && (!plain(input.filters) || Object.keys(input.filters).some(key => !FILTER_KEYS.includes(key))))
      fail('exchange_filters', '請選擇有效的交易所篩選條件');
    if (input.role != null) fail('exchange_filters', '買賣分類僅適用於成交紀錄');
  } else {
    if (input.filters != null) fail('exchange_filters', '此交易所頁面不使用刊登篩選');
    if (tab !== 'history' && input.role != null) fail('exchange_filters', '買賣分類僅適用於成交紀錄');
  }
  const realmId = env.REALM_CONTEXT?.id || 'permanent', id = String(tg);
  if (typeof input.realmId !== 'string' || !input.realmId) fail('realm_required', '請先選擇遊戲環境');
  if (input.realmId !== realmId) fail('realm_mismatch', '環境不一致', 409);
  if (typeof input.selectedCharacterId !== 'string' || !input.selectedCharacterId)
    fail('selected_character_required', '請先選擇角色');
  if (input.selectedCharacterId !== id) fail('character_changed', '角色已切換，請重新開啟交易所', 409);
  const db = env.DB, before = await actor(db, id);
  if (!before) fail('no_character', '找不到目前角色', 404);
  if (before.active_char_id != null && String(before.active_char_id) !== id)
    fail('character_changed', '角色已在另一個視窗切換，請重新選角', 409);
  if (!integer(before.rev) || before.rev < 0 || !integer(now) || now < 0)
    fail('exchange_data', '交易所資料尚未完整，請稍後重新整理', 500);
  const accountId = String(before.account_tg_id || id);
  const scope = [accountId, realmId, id, epoch, tab], cursor = readCursor(input.cursor, scope);
  // Only these three audited services are reachable here. No generic dispatch,
  // expiry, sellable, settlement, operation lookup or mutation path is invoked.
  const result = tab === 'browse'
    ? await EXCHANGE.list(env, id, { filters: input.filters ?? {}, cursor: cursor?.raw ?? null })
    : tab === 'mine'
      ? await EXCHANGE.mine(env, id, { cursor: cursor?.raw ?? null })
      : await exchangeHistory(env, id, { characterId: id, role: input.role ?? 'all', cursor: cursor?.raw ?? null });
  const selector = tab === 'browse' ? FILTER_KEYS.map(key => result.filters[key])
    : tab === 'history' ? result.role : null;
  // The authority owns filter normalization. A mismatched cursor is discarded
  // after its pure SELECT and cannot expose a page from another filter.
  if (cursor && JSON.stringify(cursor.selector) !== JSON.stringify(selector))
    fail('exchange_cursor', '交易所篩選已變更，請重新整理');
  if (result.ok !== true || !Array.isArray(result.items) || result.items.length > PAGE_SIZE
      || result.nextCursor != null && !rawCursorValid(result.nextCursor, tab))
    fail('exchange_data', '交易所資料尚未完整，請稍後重新整理', 500);
  const after = await actor(db, id);
  if (!after || JSON.stringify(identity(after)) !== JSON.stringify(identity(before)))
    fail('character_changed', '角色或交易所狀態已更新，請重新整理', 409);
  return { ok: true, schemaVersion: 1, accountId, realmId, characterId: id, contextEpoch: epoch,
    revision: before.rev, serverNow: now, pageSize: PAGE_SIZE, tab,
    filters: tab === 'browse' ? result.filters : null, role: tab === 'history' ? result.role : null,
    items: result.items, meta: tab === 'history' ? null : result.meta,
    nextCursor: result.nextCursor == null ? null : encode([...scope, selector, result.nextCursor]) };
}
