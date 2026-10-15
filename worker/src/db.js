// D1 persistence helpers: load a player, write the whole change as ONE batch (atomic), optimistic lock via rev + rpg_guard.
import { GameError } from './game/classes.js';
import {guardianEffect} from './game/guardian-effects.js';
import {activeSettings} from './game/guardian-sigil-config.js';

const CHAR_FIELDS = ['collection_active_map', 'guardian_draw_remainder', 'idle_combat_json', 'special_json', 'party_id', 'level', 'exp', 'hp', 'mp', 'map_id', 'idle_state', 'state_until', 'class_path', 'pending_tier', 'auto_red_pct', 'auto_blue',
  'last_settle_at', 'last_daily_gold_day', 'penalty_day', 'penalties_today', 'drop_day', 'drops_today', 'deaths_total', 'last_reselect_at', 'boss_down_until'];
const EQUIP_MUTABLE = ['affixes_json', 'is_equipped', 'kind', 'branch_req', 'name', 'bonus_json', 'convert_token', 'enhance_level', 'element', 'element_stat', 'element_tier', 'bound'];
const EQUIP_COLS = ['affixes_json', 'id', 'tg_id', 'slot', 'kind', 'class_req', 'branch_req', 'tier', 'level_req', 'name', 'source', 'base_stat', 'bonus_json', 'element', 'element_stat', 'element_tier', 'enhance_level', 'is_equipped', 'convert_token', 'created_at', 'grade', 'affix_json', 'bound', 'trade_id'];

/** bump a player's rev so a concurrent withPlayer batch (loaded before this change) fails its optimistic lock and retries */
export const bumpRevStmt = (db, tgId, now) => db.prepare('UPDATE rpg_characters SET rev = rev + 1, updated_at = ? WHERE tg_id = ?').bind(now, String(tgId));
export const guardStmt = (db) => db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE changes() = 0');

export async function loadPlayer(db, tgId, env={}) {
  const [c, inv, eq, guardian] = await db.batch([
    db.prepare('SELECT c.*, a.active_char_id FROM rpg_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id = ?').bind(String(tgId)),
    db.prepare('SELECT item, quantity FROM rpg_inventory WHERE tg_id = ?').bind(String(tgId)),
    db.prepare('SELECT * FROM rpg_equipment WHERE tg_id = ? ORDER BY created_at').bind(String(tgId)),
    db.prepare('SELECT * FROM rpg_guardian_sigils WHERE char_id = ? AND active = 1').bind(String(tgId)),
  ]);
  const char = c.results?.[0] || null; if (!char) return null;
  char.guardian=guardianEffect(guardian.results?.[0],env);
  char.guardianAssistSettings=activeSettings(env).assist;
  return { char, inv: Object.fromEntries((inv.results || []).map((r) => [r.item, r.quantity])), equipment: eq.results || [] };
}
export const clonePlayer = (p) => ({ char: { ...p.char }, inv: { ...p.inv }, equipment: p.equipment.map((e) => ({ ...e })) });

export const insertEquipStmt = (db, e) => db.prepare(`INSERT INTO rpg_equipment (${EQUIP_COLS.join(',')}) VALUES (${EQUIP_COLS.map(() => '?').join(',')})`).bind(...EQUIP_COLS.map((k) => e[k] ?? (k==='affixes_json'?'[]':null)));
export const ledgerStmt = (db, l, now) => db.prepare('INSERT INTO rpg_ledger (event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .bind(l.event_id, String(l.tg_id), l.type, l.gold_delta || 0, l.item || null, l.item_delta || 0, l.exp_delta || 0, l.note || null, now);
/** Same receipts, grouped below D1's 100 bound-parameter limit. */
export function ledgerBatchStmts(db, entries, now) {
  const out=[];
  for(let i=0;i<entries.length;i+=11){const part=entries.slice(i,i+11);out.push(part.length===1?ledgerStmt(db,part[0],now):db.prepare(`INSERT INTO rpg_ledger (event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at) VALUES ${part.map(()=>'(?,?,?,?,?,?,?,?,?)').join(',')}`).bind(...part.flatMap(l=>[l.event_id,String(l.tg_id),l.type,l.gold_delta||0,l.item||null,l.item_delta||0,l.exp_delta||0,l.note||null,now])));}
  return out;
}
// SQLite checks CHECK(quantity >= 0) on the would-be-inserted row before UPSERT, so negative deltas use UPDATE (+ guard: the row must exist).
export const invDeltaStmt = (db, tgId, item, delta) => db.prepare('INSERT INTO rpg_inventory (tg_id,item,quantity) VALUES (?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity = quantity + excluded.quantity')
  .bind(String(tgId), item, delta);
export const invDeltaStmts = (db, tgId, item, delta) => (delta >= 0 ? [invDeltaStmt(db, tgId, item, delta)]
  : [db.prepare('UPDATE rpg_inventory SET quantity = quantity + ? WHERE tg_id = ? AND item = ?').bind(delta, String(tgId), item), guardStmt(db)]);
export const outboxStmt = (db, { dedupe, target, tgId = null, kind, payload = {} }, now) => db.prepare(`INSERT OR IGNORE INTO rpg_outbox (dedupe_key,target,tg_id,kind,payload_json,created_at)
  VALUES (?,?,CASE WHEN ? = 'dm' AND ? IS NOT NULL THEN COALESCE((SELECT account_tg_id FROM rpg_characters WHERE tg_id = ?), ?) ELSE ? END,?,?,?)`)
  .bind(dedupe || null, target, target, tgId == null ? null : String(tgId), tgId == null ? null : String(tgId), tgId == null ? null : String(tgId), tgId == null ? null : String(tgId), kind, JSON.stringify(target==='dm'&&tgId!=null?{...payload,recipientCharId:String(tgId)}:payload), now);

/** build the batch statements that turn `before` into `after` (+ ledger rows + extra statements) */
export function persistStatements(db, before, after, { ledger = [], extra = [], pre = [], batchEquipmentDeletes = false } = {}, now) {
  const c = after.char; const tg = String(c.tg_id);
  const goldDelta = (c.gold || 0) - (before.char.gold || 0);
  const stmts = [...pre,
    db.prepare(`UPDATE rpg_characters SET ${CHAR_FIELDS.map((f) => `${f} = ?`).join(', ')}, gold = gold + ?, rev = rev + 1, updated_at = ? WHERE tg_id = ? AND rev = ?`)
      .bind(...CHAR_FIELDS.map((f) => c[f] ?? null), goldDelta, now, tg, before.char.rev),
    guardStmt(db)];
  const keys = new Set([...Object.keys(before.inv), ...Object.keys(after.inv)]);
  for (const k of keys) { const d = (after.inv[k] || 0) - (before.inv[k] || 0); if (d) stmts.push(...invDeltaStmts(db, tg, k, d)); }
  const old = new Map(before.equipment.map((e) => [e.id, e]));
  const kept = new Set(after.equipment.map((e) => e.id));
  const removed = before.equipment.filter(e => !kept.has(e.id));
  if (batchEquipmentDeletes && removed.length) {
    // One indexed deletion plus an exact count guard; not two queries per sold item.
    stmts.push(db.prepare(`DELETE FROM rpg_equipment WHERE tg_id=? AND is_equipped=0 AND trade_id IS NULL AND id IN (${removed.map(() => '?').join(',')})`).bind(tg, ...removed.map(e => e.id)),
      db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE changes() <> ?').bind(removed.length));
  } else for (const e of removed) stmts.push(db.prepare('DELETE FROM rpg_equipment WHERE id = ? AND tg_id = ?').bind(e.id, tg), guardStmt(db));
  const added=[];
  for (const e of after.equipment) {
    const o = old.get(e.id);
    if (!o) { added.push(e); continue; }
    const changed = EQUIP_MUTABLE.filter((k) => (o[k] ?? null) !== (e[k] ?? null));
    if (changed.length) stmts.push(db.prepare(`UPDATE rpg_equipment SET ${changed.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND tg_id = ?`).bind(...changed.map((k) => e[k] ?? null), e.id, tg));
  }
  const chunkSize=Math.floor(100/EQUIP_COLS.length);
  for(let i=0;i<added.length;i+=chunkSize){const part=added.slice(i,i+chunkSize);stmts.push(part.length===1?insertEquipStmt(db,part[0]):db.prepare(`INSERT INTO rpg_equipment (${EQUIP_COLS.join(',')}) VALUES ${part.map(()=>`(${EQUIP_COLS.map(()=>'?').join(',')})`).join(',')}`).bind(...part.flatMap(e=>EQUIP_COLS.map(k=>e[k]??(k==='affixes_json'?'[]':null)))));}
  for (const l of ledger) stmts.push(ledgerStmt(db, l, now));
  return [...stmts, ...extra];
}

export function classifyDbError(error) {
  const g = classifyRaw(error); if (g) g.cause = error; return g;
}
function classifyRaw(error) {
  const m = String(error?.message || error);
  if (/exchange_guardian_locked/.test(m)) return new GameError('in_exchange','這位守護天使已在交易所保管，請先取回',409);
  if (/exchange_equipment_locked/.test(m)) return new GameError('in_exchange','這件裝備已在交易所保管，請先取回',409);
  if (/guardian_party_locked/.test(m)) return new GameError('party','請先完成組隊冒險，再調整或交易守護天使',409);
  if (/collection_not_owned|collection_active_owned/.test(m)) return new GameError('not_owned','收藏狀態已更新，請重新整理後再選擇祝福',409);
  if (/collection_party_locked/.test(m)) return new GameError('party','請先完成組隊冒險再更換收藏祝福',409);
  if (/auto_reroll_locked|background_item_locked/.test(m)) return new GameError('auto_active','這件裝備正在背景作業，請先停止該任務',409);
  if (/UNIQUE constraint failed: rpg_auto_reroll.owner/.test(m)) return new GameError('auto_active','已有背景洗屬性任務，請先停止',409);
  if (/auto_enhance_locked/.test(m)) return new GameError('auto_active', '這件裝備正在背景強化，請先停止強化', 409);
  if (/UNIQUE constraint failed: rpg_auto_enhance.owner/.test(m)) return new GameError('auto_active', '已有背景強化任務，請重新整理查看進度', 409);
  if (/rpg_guard\.ok/.test(m)) return new GameError('conflict', '資料同時被更新，請再試一次', 409);
  if (/UNIQUE constraint failed: rpg_ledger\.event_id/.test(m)) return new GameError('duplicate', '這個操作已經處理過了', 409);
  if (/UNIQUE constraint failed: rpg_characters\.name/.test(m)) return new GameError('name_taken', '這個角色名已經有人用了', 409);
  if (/UNIQUE constraint failed: rpg_characters\.account_tg_id, rpg_characters\.char_slot/.test(m)) return new GameError('character_limit', '角色欄位已滿，請重新整理後再試', 409);
  if (/UNIQUE constraint failed: rpg_characters\.tg_id/.test(m)) return new GameError('exists', '你已經有角色了', 409);
  if (/PRIMARY KEY|UNIQUE constraint failed: rpg_boss_attacks/.test(m)) return new GameError('cooldown', '這 3 分鐘內已經攻擊過了', 409);
  if (/UNIQUE constraint failed: rpg_trade_items/.test(m)) return new GameError('in_trade', '這個道具已經在交易中', 409);
  if (/CHECK constraint failed/i.test(m)) {
    if (/gold\s*>=\s*0/i.test(m)) return new GameError('gold', '金幣不足，請確認目前金幣後再試', 400);
    if (/quantity\s*>=\s*0/i.test(m)) return new GameError('insufficient', '強化卷或道具數量剛更新，請重新整理背包後再試', 409);
    return new GameError('state_conflict', '資料狀態剛更新，請重新整理後再試', 409);
  }
  return null;
}
