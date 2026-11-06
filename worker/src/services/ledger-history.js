// One character's committed ledger. SELECT only; no settle, replay or balance reconstruction.
import { GameError } from '../game/classes.js';
import { ITEMS } from '../game/constants.js';

const PAGE_SIZE = 30;
const CATEGORIES = ['all', 'gold', 'items', 'experience'];
const fail = (code, message, status = 400) => { throw new GameError(code, message, status); };
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value, limit = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
const integer = value => Number.isSafeInteger(value);

function encode(value) {
  return 'lh1.' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function readCursor(value, scope) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 640 || !/^lh1\.[A-Za-z0-9_-]+$/.test(value))
    fail('ledger_cursor', '紀錄頁碼已失效，請重新整理');
  let data;
  try {
    const raw = value.slice(4).replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { fail('ledger_cursor', '紀錄頁碼已失效，請重新整理'); }
  if (!Array.isArray(data) || data.length !== 7 || !scope.every((part, i) => data[i] === part)
      || !integer(data[5]) || data[5] < 0 || !integer(data[6]) || data[6] < 1)
    fail('ledger_cursor', '角色、世界或篩選已變更，請重新整理紀錄');
  return { time: data[5], id: data[6] };
}
function summary(row) {
  const note = clean(row.note, 500);
  if (!note) return '';
  // Typed receipts can contain private fingerprints, operation IDs and other internal state.
  // Their presence alone must never acknowledge or replay an uncertain original action.
  if (/收據/.test(String(row.type)) || /^[{["]/.test(note)) return '操作細節請至對應功能查看。';
  try { JSON.parse(note); return '操作細節請至對應功能查看。'; } catch {}
  return clean(note, 160);
}
function project(row) {
  if (![row.id, row.created_at, row.gold_delta, row.item_delta, row.exp_delta].every(integer)
      || row.id < 1 || row.created_at < 0) fail('ledger_data', '此筆紀錄資料尚未完整，請稍後重新整理', 500);
  const item = typeof row.item === 'string' && row.item ? clean(row.item, 180) : null;
  const itemName = item ? (Object.hasOwn(ITEMS, item) ? ITEMS[item]?.name : null) || (/^(equip|equipment):/.test(item) ? '裝備' : /^sigil:/.test(item) ? '守護羽毛' : '其他道具') : null;
  return { id: 'ledger:' + row.id, createdAt: row.created_at, type: clean(row.type, 80) || '已入帳紀錄',
    goldDelta: row.gold_delta, item, itemName, itemDelta: row.item_delta, expDelta: row.exp_delta, summary: summary(row) };
}
async function actor(db, id) {
  return db.prepare('SELECT c.tg_id,c.account_tg_id,c.rev,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(id).first();
}
function identity(char) {
  return [String(char.tg_id), String(char.account_tg_id || char.tg_id), char.active_char_id == null ? null : String(char.active_char_id), char.rev];
}

export async function history(env, tg, input = {}, now = Date.now()) {
  if (!plain(input)) fail('ledger_filters', '紀錄篩選格式無效');
  const category = input.category ?? 'all', epoch = input.contextEpoch;
  if (!CATEGORIES.includes(category)) fail('ledger_filters', '請選擇有效的紀錄分類');
  if (!integer(epoch) || epoch < 0) fail('ledger_context', '角色狀態已變更，請重新開啟紀錄');
  const realmId = env.REALM_CONTEXT?.id || 'permanent', id = String(tg);
  if (typeof input.realmId !== 'string' || !input.realmId) fail('realm_required', '請先選擇遊戲環境');
  if (input.realmId !== realmId) fail('realm_mismatch', '環境不一致', 409);
  if (typeof input.selectedCharacterId !== 'string' || !input.selectedCharacterId) fail('selected_character_required', '請先選擇角色');
  if (input.selectedCharacterId !== id) fail('character_changed', '角色已切換，請重新開啟紀錄', 409);
  const db = env.DB, before = await actor(db, id);
  if (!before) fail('no_character', '找不到目前角色', 404);
  if (before.active_char_id != null && String(before.active_char_id) !== id) fail('character_changed', '角色已在另一個視窗切換，請重新選角', 409);
  if (!integer(before.rev) || before.rev < 0) fail('ledger_data', '角色資料尚未完整', 500);
  const accountId = String(before.account_tg_id || id);
  const scope = [accountId, realmId, id, category, epoch], cursor = readCursor(input.cursor, scope);
  const categorySql = { all: '', gold: 'AND gold_delta<>0', items: 'AND item_delta<>0', experience: 'AND exp_delta<>0' }[category];
  const params = [id];
  if (cursor) params.push(cursor.time, cursor.time, cursor.id);
  // The owner index includes rowid as its final key; same-millisecond entries retain their order.
  const sql = 'SELECT id,type,gold_delta,item,item_delta,exp_delta,note,created_at FROM rpg_ledger INDEXED BY idx_rpg_ledger_owner ' +
    'WHERE tg_id=? ' + categorySql + (cursor ? ' AND created_at<=? AND (created_at<? OR id<?)' : '') +
    ' ORDER BY created_at DESC,id DESC LIMIT ' + (PAGE_SIZE + 1);
  const found = (await db.prepare(sql).bind(...params).all()).results || [];
  const page = found.slice(0, PAGE_SIZE), entries = page.map(project), after = await actor(db, id);
  if (!after || JSON.stringify(identity(after)) !== JSON.stringify(identity(before)))
    fail('character_changed', '角色或紀錄狀態已更新，請重新整理', 409);
  const last = page.at(-1);
  return { ok: true, schemaVersion: 1, accountId, realmId, characterId: id, contextEpoch: epoch,
    revision: before.rev, serverNow: now, pageSize: PAGE_SIZE, category, entries,
    nextCursor: found.length > PAGE_SIZE && last ? encode([...scope, last.created_at, last.id]) : null };
}
