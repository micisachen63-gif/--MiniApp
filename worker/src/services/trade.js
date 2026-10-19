// 交易 (v0.5): a window opens only from a share request (services/share.js acceptRequest). Initiator a = the owner/sharer
// (top slots), acceptor b = the requester (bottom). Each side places items/gold (escrowed immediately), presses 鎖定
// (irreversible; a locked side can't add/remove), and once BOTH are locked each presses OK → atomic swap.
// Cancel any time before the second OK returns everything; 30 min without any action → expired (escrow returned).
// Every write is ONE D1 batch guarded by the trade row's rev (optimistic lock) + rpg_guard; any player whose wallet/items
// move gets rev+1 so a concurrent idle/menu batch for that player retries on fresh data. Ledger event_ids are unique per
// trade + version, so retries/double clicks can't duplicate anything. Gold can't go negative (guarded UPDATE + CHECK).
import {sigilView} from './guardian-sigil.js';
import { TRADE, ITEMS, SLOT_NAMES, RARITIES, CLASSES, ELEMENTS } from '../game/constants.js';
import {affixView} from '../game/affixes.js';
import { GameError } from '../game/classes.js';
import { tradeTax, netGold, checkGold, checkItemLine, checkEquipLine, sideOf, otherSide } from '../game/trade.js';
import { itemStat, itemExtras, mainStatOf } from '../game/stats.js';
import { guardStmt, bumpRevStmt, ledgerStmt, invDeltaStmt, invDeltaStmts, outboxStmt, classifyDbError } from '../db.js';

const newId = () => `t${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`;
const logStmt = (db, id, tg, action, details, now) => db.prepare('INSERT INTO rpg_trade_log (trade_id,tg_id,action,details,created_at) VALUES (?,?,?,?,?)')
  .bind(id, tg == null ? null : String(tg), action, details == null ? null : JSON.stringify(details), now);
const lockStmt = (db, t, set, binds, now) => db.prepare(`UPDATE rpg_trades SET ${set}, rev = rev + 1, updated_at = ?, expires_at = ? WHERE id = ? AND rev = ? AND status = 'open'`).bind(...binds, now, now + TRADE.idleMs, t.id, t.rev);

async function load(db, id) {
  const t = await db.prepare('SELECT * FROM rpg_trades WHERE id = ?').bind(String(id)).first(); if (!t) return null;
  const lines = (await db.prepare('SELECT * FROM rpg_trade_items WHERE trade_id = ?').bind(t.id).all()).results || [];
  return { ...t, lines };
}
async function charOf(db, tg) { return db.prepare('SELECT tg_id, account_tg_id, name, base_class, level, party_id, gold, tg_username FROM rpg_characters WHERE tg_id = ?').bind(String(tg)).first(); }

/** run fn(trade) → { stmts, result } with optimistic-lock retries; lazily expires an overdue trade first */
async function mutate(env, id, now, tg, fn, requestId = null, attempts = 4) {
  const db = env.DB;
  if (requestId != null && !/^(?:app:)?[\w-]{1,100}$/.test(String(requestId))) throw new GameError('request', '交易操作編號無效');
  for (let attempt = 1; ; attempt++) {
    if (requestId != null) {
      const prior = await db.prepare('SELECT result_json FROM rpg_trade_operations WHERE trade_id = ? AND tg_id = ? AND request_id = ?').bind(String(id), String(tg), String(requestId)).first();
      if (prior) return JSON.parse(prior.result_json);
    }
    const t = await load(db, id); if (!t) throw new GameError('not_found', '找不到這筆交易', 404);
    if (tg != null && !sideOf(t, tg)) throw new GameError('not_party', '你不是這筆交易的成員', 403);
    if (t.status === 'open' && t.expires_at <= now) {
      try { await closeTrade(env,t,'expired',null,now); }
      catch(e) { const error=classifyDbError(e);if(error?.code==='conflict'&&attempt<attempts)continue;throw error||e; }
      continue;
    }
    if (t.status !== 'open') throw new GameError('closed', { done: '這筆交易已經完成了', cancelled: '這筆交易已取消', expired: '這筆交易已過期（物品與金幣已退回）' }[t.status] || '交易已結束', 409);
    const { stmts, result } = await fn(t);
    const batch = requestId == null ? stmts : [...stmts, db.prepare('INSERT INTO rpg_trade_operations (trade_id,tg_id,request_id,result_json,created_at) VALUES (?,?,?,?,?)').bind(String(id), String(tg), String(requestId), JSON.stringify(result), now)];
    try { await db.batch(batch); return result; }
    catch (e) { const g = classifyDbError(e); if (g?.code === 'conflict' && attempt < attempts) continue; throw g || e; }
  }
}

// ---------------------------------------------------------------------------------------------- views
export async function tradeView(env, id, viewer = null, now = Date.now()) {
  const db = env.DB; const t = await load(db, id); if (!t) return null;
  const [a, b] = await Promise.all([charOf(db, t.a_tg), charOf(db, t.b_tg)]);
  const eqIds = t.lines.filter((l) => l.kind === 'equip').map((l) => l.ref);
  const eq = eqIds.length ? ((await db.prepare(`SELECT * FROM rpg_equipment WHERE id IN (${eqIds.map(() => '?').join(',')})`).bind(...eqIds).all()).results || []) : [];
  const eqMap = new Map(eq.map((e) => [e.id, e]));
  const sigilIds=t.lines.filter(l=>l.kind==='sigil').map(l=>l.ref);
  const sigils=sigilIds.length?(await db.prepare('SELECT * FROM rpg_guardian_sigils WHERE id IN ('+sigilIds.map(()=>'?').join(',')+')').bind(...sigilIds).all()).results:[];
  const sigilMap=new Map(sigils.map(row=>[row.id,row]));
  const line = (l) => {
    if(l.kind==='sigil'){const row=sigilMap.get(l.ref)||JSON.parse(l.snapshot_json||'{}'),v=sigilView(row);return {...v,kind:'sigil',ref:l.ref,qty:1,name:v.qualityName+'・'+v.typeName,artUrl:'/art/guardian-sigil-20261013/'+v.type+'.webp'};}
    if (l.kind === 'item') return { kind: 'item', ref: l.ref, qty: l.qty, name: ITEMS[l.ref]?.name || l.ref, emoji: ITEMS[l.ref]?.emoji };
    const e = (t.status==='open'?eqMap.get(l.ref):null) || JSON.parse(l.snapshot_json || '{}'); const st = e.base_stat != null ? itemStat(e) : { main: null };const extras=itemExtras({...e,affix_json:null});
    return { kind: 'equip', ref: l.ref, qty: 1, name: e.name, slot: e.slot, wkind: e.kind, slotName: SLOT_NAMES[e.slot], tier: e.tier, grade: e.grade || 'normal', rarity: e.element_tier, rarityName: RARITIES[e.element_tier]?.name,
      enhance: e.enhance_level || 0, classReq: e.class_req, className: CLASSES[e.class_req]?.name || '全職業', stat: st.main, statName: mainStatOf(e.slot).toUpperCase(), affix: e.affix_json ? JSON.parse(e.affix_json) : null,
      affixes:affixView(e),element:e.element,elementName:ELEMENTS[e.element]?.name,elemStat:st.elem||0,extras:extras.flat,pct:extras.pct,levelReq:e.level_req,branchReq:e.branch_req };
  };
  const side = (s, c) => ({ tgId: t[`${s}_tg`], name: c?.name || '?', username: c?.tg_username || null, gold: t[`${s}_gold`], goldNet: netGold(t[`${s}_gold`]), tax: tradeTax(t[`${s}_gold`]),
    locked: !!t[`${s}_lock`], ok: !!t[`${s}_ok`], lines: t.lines.filter((l) => l.side === s).map(line) });
  const me = viewer ? sideOf(t, viewer) : null;
  const phase = t.status !== 'open' ? t.status : t.a_lock && t.b_lock ? (t.a_ok || t.b_ok ? 'ok_wait' : 'ready') : t.a_lock || t.b_lock ? 'one_locked' : 'placing';
  return { id: t.id, status: t.status, phase, origin: t.origin, shareId: t.share_id, requestId: t.request_id, offerRev: t.offer_rev, createdAt: t.created_at, expiresAt: t.expires_at, closedAt: t.closed_at, closedBy: t.closed_by, idleMinutes: TRADE.idleMs / 60e3,
    secondsLeft: Math.max(0, Math.round((t.expires_at - now) / 1000)), taxPct: TRADE.taxPct, taxGold: t.tax_gold, a: side('a', a), b: side('b', b), me, messageChatId: t.chat_id, messageId: t.message_id };
}
export async function listTrades(env, tg, now = Date.now(), limit = 20) {
  const db = env.DB;
  const due = await db.prepare("SELECT id FROM rpg_trades WHERE status = 'open' AND expires_at <= ? AND (a_tg = ? OR b_tg = ?)").bind(now, String(tg), String(tg)).all();
  for (const r of due.results || []) await expireOne(env, r.id, now).catch(() => null);
  const rows = await db.prepare('SELECT id FROM rpg_trades WHERE a_tg = ? OR b_tg = ? ORDER BY (status = \'open\') DESC, updated_at DESC LIMIT ?').bind(String(tg), String(tg), limit).all();
  const out = []; for (const r of rows.results || []) out.push(await tradeView(env, r.id, tg, now));
  return { open: out.filter((t) => t.status === 'open'), history: out.filter((t) => t.status !== 'open') };
}
export async function tradeLog(env, id) {
  return ((await env.DB.prepare('SELECT tg_id, action, details, created_at FROM rpg_trade_log WHERE trade_id = ? ORDER BY id').bind(String(id)).all()).results || [])
    .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}

// ---------------------------------------------------------------------------------------------- open
/** target: { tgId } | { username } | { name } (character name) */
export async function findTarget(env, target) {
  const db = env.DB;
  if (target?.tgId && /^c[\da-f]{32}$/i.test(String(target.tgId))) return charOf(db, target.tgId);
  if (target?.tgId && /^\d{1,20}$/.test(String(target.tgId))) {
    const account = String(target.tgId);
    return db.prepare(`SELECT c.tg_id, c.name, c.tg_username FROM rpg_accounts a
      JOIN rpg_characters c ON c.tg_id = a.active_char_id AND c.account_tg_id = a.account_tg_id
      WHERE a.account_tg_id = ?`).bind(account).first().then((c) => c || charOf(db, account));
  }
  if (target?.username) return db.prepare(`SELECT c.tg_id, c.name, c.tg_username FROM rpg_accounts a
    JOIN rpg_characters c ON c.tg_id = a.active_char_id AND c.account_tg_id = a.account_tg_id
    WHERE c.tg_username = ? COLLATE NOCASE`).bind(String(target.username).replace(/^@/, '')).first();
  if (target?.name) return db.prepare('SELECT tg_id, name, tg_username FROM rpg_characters WHERE name = ? COLLATE NOCASE').bind(String(target.name).replace(/^@/, '')).first();
  return null;
}
/** statements that open a window a (initiator/owner) ⇄ b (acceptor/requester), optionally with a's shared item pre-placed */
export async function openTradeStmts(env, { aTg, bTg, origin = 'share', shareId = null, requestId = null, preEquip = null, preItem = null, preSigil = null }, now) {
  const db = env.DB; const a = String(aTg), o = String(bTg);
  if (a === o) throw new GameError('self', '不能跟自己交易');
  const owners=(await db.prepare('SELECT tg_id,account_tg_id FROM rpg_characters WHERE tg_id IN (?,?)').bind(a,o).all()).results||[];
  if(owners.length===2&&(owners[0].account_tg_id||owners[0].tg_id)===(owners[1].account_tg_id||owners[1].tg_id))throw new GameError('self','同一帳號的角色不能彼此交易');
  const id = newId();
  // IDs are either Telegram numeric IDs (legacy characters) or server-generated c+hex IDs.
  const literal = (who) => `'${String(who).replaceAll("'", "''")}'`;
  const openCount = (who) => `(SELECT COUNT(*) FROM rpg_trades WHERE status = 'open' AND expires_at > ${Number(now)} AND (a_tg = ${literal(who)} OR b_tg = ${literal(who)}))`;
  for (const [who, label] of [[a, '你'], [o, '對方']]) {
    const n = (await db.prepare(`SELECT ${openCount(who)} AS n`).first())?.n || 0;
    if (n >= TRADE.maxOpenPerPlayer) throw new GameError('too_many', `${label}已經有 ${TRADE.maxOpenPerPlayer} 筆進行中的交易，先完成或取消一筆`);
  }
  const stmts = [
    db.prepare(`INSERT INTO rpg_trades (id,a_tg,b_tg,status,origin,share_id,request_id,created_at,updated_at,expires_at) SELECT ?,?,?,'open',?,?,?,?,?,? WHERE ${openCount(a)} < ? AND ${openCount(o)} < ?`)
      .bind(id, a, o, origin, shareId, requestId, now, now, now + TRADE.idleMs, TRADE.maxOpenPerPlayer, TRADE.maxOpenPerPlayer),
    guardStmt(db), logStmt(db, id, a, 'open', { with: o, origin, shareId }, now)];
  if (preEquip) stmts.push(
    db.prepare('UPDATE rpg_equipment SET trade_id = ? WHERE id = ? AND tg_id = ? AND trade_id IS NULL AND is_equipped = 0 AND bound = 0').bind(id, preEquip.id, a), guardStmt(db),
    db.prepare("INSERT INTO rpg_trade_items (trade_id,side,kind,ref,qty,snapshot_json) VALUES (?,'a','equip',?,1,?)").bind(id, preEquip.id, JSON.stringify(preEquip)),
    logStmt(db, id, a, 'add', { equip: preEquip.id, name: preEquip.name, pre: true }, now), bumpRevStmt(db, a, now));
  if(preSigil){await checkSigil(db,preSigil,a,o);stmts.push(
    db.prepare('UPDATE rpg_guardian_sigils SET trade_id=?,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND bound=0 AND active=0 AND locked=0 AND trade_id IS NULL AND exchange_id IS NULL').bind(id,now,preSigil.id,a),guardStmt(db),
    db.prepare("INSERT INTO rpg_trade_items(trade_id,side,kind,ref,qty,snapshot_json) VALUES(?,'a','sigil',?,1,?)").bind(id,preSigil.id,JSON.stringify(preSigil)),logStmt(db,id,a,'add',{sigil:preSigil.id,pre:true},now));}
  if(preItem) {
    const {item,qty=1}=preItem;checkItemLine(item,qty);
    const have=(await db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').bind(a,item).first())?.quantity||0;
    if(have<qty)throw new GameError('insufficient',`「${ITEMS[item].name}」不夠（你有 ${have}）`);
    stmts.push(...invDeltaStmts(db,a,item,-qty),
      db.prepare("INSERT INTO rpg_trade_items(trade_id,side,kind,ref,qty) VALUES(?,'a','item',?,?)").bind(id,item,qty),
      ledgerStmt(db,{event_id:`trade:${id}:0:${a}:add:${item}`,tg_id:a,type:'交易保管道具',item,item_delta:-qty,note:id},now),
      logStmt(db,id,a,'add',{item,qty,pre:true},now),bumpRevStmt(db,a,now));
  }
  return { id, stmts };
}

// ---------------------------------------------------------------------------------------------- offer changes
/** every content change: offer_rev+1 (OK needs both locks, and a locked side can't change, so OKs never go stale) */
const changed = (db, t, now) => lockStmt(db, t, 'offer_rev = offer_rev + 1, a_ok = 0, b_ok = 0', [], now);
const updateNote = () => [];
const notLocked = (t, s) => { if (t[`${s}_lock`]) throw new GameError('locked', '你已經鎖定了，不能再放入或取回（要改就取消交易）', 409); };

export async function setGold(env, { tgId, tradeId, gold, requestId = null }, now) {
  gold = Number(gold); checkGold(gold); const db = env.DB; const tg = String(tgId);
  return mutate(env, tradeId, now, tg, async (t) => {
    const s = sideOf(t, tg); notLocked(t, s); const cur = t[`${s}_gold`]; const d = gold - cur; if (!d) return { stmts: [db.prepare('SELECT 1')], result: { unchanged: true } };
    const ev = `trade:${t.id}:${t.rev}:${tg}:gold`;
    const wallet = d > 0 ? [db.prepare('UPDATE rpg_characters SET gold = gold - ? WHERE tg_id = ? AND gold >= ?').bind(d, tg, d), guardStmt(db)] : [db.prepare('UPDATE rpg_characters SET gold = gold + ? WHERE tg_id = ?').bind(-d, tg)];
    if (d > 0) { const c = await charOf(db, tg); if ((c?.gold || 0) < d) throw new GameError('gold', `金幣不足（需要 ${d.toLocaleString()}，你有 ${(c?.gold || 0).toLocaleString()}）`); }
    return { stmts: [changed(db, t, now), guardStmt(db), db.prepare(`UPDATE rpg_trades SET ${s}_gold = ? WHERE id = ?`).bind(gold, t.id), ...wallet, bumpRevStmt(db, tg, now),
      ledgerStmt(db, { event_id: ev, tg_id: tg, type: d > 0 ? '交易保管金幣' : '交易退回金幣', gold_delta: -d, note: t.id }, now), logStmt(db, t.id, tg, 'gold', { from: cur, to: gold }, now), ...updateNote(db, t, now)],
      result: { gold } };
  }, requestId);
}

async function checkSigil(db,row,tg,other){
 if(!row||row.char_id!==tg)throw new GameError('not_found','找不到你的守護羽毛');
 if(row.bound||row.active||row.locked||row.trade_id||row.exchange_id)throw new GameError('protected','請先解除啟用、綁定、鎖定或交易保管');
 const players=(await db.prepare('SELECT level,party_id FROM rpg_characters WHERE tg_id IN (?,?)').bind(tg,other).all()).results||[];
 if(players.length!==2||players.some(c=>c.level<15||c.party_id))throw new GameError('guardian_level','雙方須達15級且不在組隊戰鬥中');
}
/** add a line: { equipId } or { item, qty } */
export async function addLine(env, { tgId, tradeId, equipId = null, sigilId = null, item = null, qty = 1, requestId = null }, now) {
  const db = env.DB; const tg = String(tgId);
  return mutate(env, tradeId, now, tg, async (t) => {
    const s = sideOf(t, tg); notLocked(t, s); if (t.lines.filter((l) => l.side === s).length >= TRADE.maxLines && !(item && t.lines.some((l) => l.side === s && l.ref === item))) throw new GameError('too_many_lines', `每人最多放 ${TRADE.maxLines} 項`);
    const base = [changed(db, t, now), guardStmt(db), bumpRevStmt(db, tg, now)];
    if (sigilId) {
      const row=await db.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').bind(String(sigilId)).first();await checkSigil(db,row,tg,t[otherSide(s)+'_tg']);
      return {stmts:[...base,db.prepare('UPDATE rpg_guardian_sigils SET trade_id=?,rev=rev+1,updated_at=? WHERE id=? AND char_id=? AND bound=0 AND active=0 AND locked=0 AND trade_id IS NULL AND exchange_id IS NULL').bind(t.id,now,row.id,tg),guardStmt(db),db.prepare("INSERT INTO rpg_trade_items(trade_id,side,kind,ref,qty,snapshot_json) VALUES(?,?,'sigil',?,1,?)").bind(t.id,s,row.id,JSON.stringify(row)),logStmt(db,t.id,tg,'add',{sigil:row.id},now)],result:{added:row.id}};
    }
    if (equipId) {
      const e = await db.prepare('SELECT * FROM rpg_equipment WHERE id = ?').bind(String(equipId)).first(); checkEquipLine(e, tg);
      return { stmts: [...base,
        db.prepare('UPDATE rpg_equipment SET trade_id = ? WHERE id = ? AND tg_id = ? AND trade_id IS NULL AND is_equipped = 0 AND bound = 0').bind(t.id, e.id, tg), guardStmt(db),
        db.prepare("INSERT INTO rpg_trade_items (trade_id,side,kind,ref,qty,snapshot_json) VALUES (?,?,'equip',?,1,?)").bind(t.id, s, e.id, JSON.stringify(e)),
        logStmt(db, t.id, tg, 'add', { equip: e.id, name: e.name }, now), ...updateNote(db, t, now)], result: { added: e.id } };
    }
    qty = Number(qty); checkItemLine(item, qty);
    const have = (await db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id = ? AND item = ?').bind(tg, item).first())?.quantity || 0;
    if (have < qty) throw new GameError('insufficient', `「${ITEMS[item].name}」不夠（你有 ${have}）`);
    return { stmts: [...base, ...invDeltaStmts(db, tg, item, -qty),
      db.prepare("INSERT INTO rpg_trade_items (trade_id,side,kind,ref,qty) VALUES (?,?,'item',?,?) ON CONFLICT(trade_id,side,kind,ref) DO UPDATE SET qty = qty + excluded.qty").bind(t.id, s, item, qty),
      ledgerStmt(db, { event_id: `trade:${t.id}:${t.rev}:${tg}:add:${item}`, tg_id: tg, type: '交易保管道具', item, item_delta: -qty, note: t.id }, now),
      logStmt(db, t.id, tg, 'add', { item, qty }, now), ...updateNote(db, t, now)], result: { added: item, qty } };
  }, requestId);
}
export async function removeLine(env, { tgId, tradeId, equipId = null, sigilId = null, item = null, qty = null, requestId = null }, now) {
  const db = env.DB; const tg = String(tgId);
  return mutate(env, tradeId, now, tg, async (t) => {
    const s = sideOf(t, tg); notLocked(t, s); const l = t.lines.find((x) => x.side === s && (sigilId ? x.kind==='sigil'&&x.ref===String(sigilId) : equipId ? x.kind === 'equip' && x.ref === String(equipId) : x.kind === 'item' && x.ref === item));
    if (!l) throw new GameError('not_found', '交易裡沒有這一項');
    const base = [changed(db, t, now), guardStmt(db), bumpRevStmt(db, tg, now)];
    if(l.kind==='sigil')return {stmts:[...base,db.prepare('UPDATE rpg_guardian_sigils SET trade_id=NULL,rev=rev+1,updated_at=? WHERE id=? AND trade_id=? AND char_id=?').bind(now,l.ref,t.id,tg),guardStmt(db),db.prepare("DELETE FROM rpg_trade_items WHERE trade_id=? AND side=? AND kind='sigil' AND ref=?").bind(t.id,s,l.ref),guardStmt(db),logStmt(db,t.id,tg,'remove',{sigil:l.ref},now)],result:{removed:l.ref}};
    if (l.kind === 'equip') return { stmts: [...base,
      db.prepare('UPDATE rpg_equipment SET trade_id = NULL WHERE id = ? AND trade_id = ?').bind(l.ref, t.id), guardStmt(db),
      db.prepare("DELETE FROM rpg_trade_items WHERE trade_id = ? AND side = ? AND kind = 'equip' AND ref = ?").bind(t.id, s, l.ref), guardStmt(db),
      logStmt(db, t.id, tg, 'remove', { equip: l.ref }, now), ...updateNote(db, t, now)], result: { removed: l.ref } };
    const n = qty == null ? l.qty : Math.min(l.qty, Number(qty)); if (!Number.isInteger(n) || n < 1) throw new GameError('qty', '數量無效');
    return { stmts: [...base,
      // Decide from the original escrow quantity. Running UPDATE then DELETE loses
      // the remainder when withdrawing exactly half of a stack.
      n === l.qty
        ? db.prepare("DELETE FROM rpg_trade_items WHERE trade_id = ? AND side = ? AND kind = 'item' AND ref = ? AND qty = ?").bind(t.id, s, l.ref, l.qty)
        : db.prepare("UPDATE rpg_trade_items SET qty = qty - ? WHERE trade_id = ? AND side = ? AND kind = 'item' AND ref = ? AND qty = ?").bind(n, t.id, s, l.ref, l.qty),
      guardStmt(db),
      invDeltaStmt(db, tg, l.ref, n),
      ledgerStmt(db, { event_id: `trade:${t.id}:${t.rev}:${tg}:remove:${l.ref}`, tg_id: tg, type: '交易退回道具', item: l.ref, item_delta: n, note: t.id }, now),
      logStmt(db, t.id, tg, 'remove', { item: l.ref, qty: n }, now), ...updateNote(db, t, now)], result: { removed: l.ref, qty: n } };
  }, requestId);
}

// ---------------------------------------------------------------------------------------------- lock / OK / settle
/** 鎖定 my side (irreversible). The other side gets a DM; when both are locked both get a 「按 OK」 DM. */
export async function lock(env, { tgId, tradeId, requestId = null }, now) {
  const db = env.DB; const tg = String(tgId);
  return mutate(env, tradeId, now, tg, async (t) => {
    const s = sideOf(t, tg); const o = otherSide(s); if (t[`${s}_lock`]) return { stmts: [db.prepare('SELECT 1')], result: { locked: true, unchanged: true } };
    const both = !!t[`${o}_lock`];
    const note = both ? ['a', 'b'].map((x) => outboxStmt(db, { dedupe: `dm:${t[`${x}_tg`]}:tready:${t.id}`, target: 'dm', tgId: t[`${x}_tg`], kind: 'trade_ready', payload: { tradeId: t.id } }, now))
      : [outboxStmt(db, { dedupe: `dm:${t[`${o}_tg`]}:tlock:${t.id}`, target: 'dm', tgId: t[`${o}_tg`], kind: 'trade_locked', payload: { tradeId: t.id } }, now)];
    return { stmts: [lockStmt(db, t, `${s}_lock = 1`, [], now), guardStmt(db), logStmt(db, t.id, tg, 'lock', null, now), ...note], result: { locked: true, bothLocked: both } };
  }, requestId);
}
/** OK: only when both sides are locked. The second OK settles atomically in the same batch. */
export async function confirm(env, { tgId, tradeId, offerRev = null, requestId = null }, now) {
  const db = env.DB; const tg = String(tgId);
  return mutate(env, tradeId, now, tg, async (t) => {
    if (!t.a_lock || !t.b_lock) throw new GameError('not_locked', '雙方都按「鎖定」之後才能按 OK', 409);
    if (offerRev != null && Number(offerRev) !== t.offer_rev) throw new GameError('offer_changed', '交易內容剛剛有變動，請重新確認', 409);
    const s = sideOf(t, tg); const o = otherSide(s);
    if (!t.lines.length && !t.a_gold && !t.b_gold) throw new GameError('empty', '交易還是空的');
    if (t[`${s}_ok`]) return { stmts: [db.prepare('SELECT 1')], result: { confirmed: true, done: false, unchanged: true } };
    if (!t[`${o}_ok`]) return { stmts: [lockStmt(db, t, `${s}_ok = 1`, [], now), guardStmt(db), logStmt(db, t.id, tg, 'confirm', { offerRev: t.offer_rev }, now)], result: { confirmed: true, done: false } };
    const tax = tradeTax(t.a_gold) + tradeTax(t.b_gold);
    return { stmts: [lockStmt(db, t, `${s}_ok = 1, status = 'done', closed_at = ?, closed_by = ?, tax_gold = ?`, [now, tg, tax], now), guardStmt(db),
      ...settleStatements(db, t, now), logStmt(db, t.id, tg, 'confirm', { offerRev: t.offer_rev }, now), logStmt(db, t.id, null, 'done', { taxGold: tax }, now),
      ...endNotes(db, t, 'done', now)], result: { confirmed: true, done: true } };
  }, requestId);
}
/** DMs to both sides + (share trades) mark the post 成交 when the shared item changed hands */
function endNotes(db, t, status, now) {
  const out = ['a', 'b'].map((x) => outboxStmt(db, { dedupe: `dm:${t[`${x}_tg`]}:tend:${t.id}`, target: 'dm', tgId: t[`${x}_tg`], kind: 'trade_end', payload: { tradeId: t.id, status } }, now));
  if (status === 'done') out.push(outboxStmt(db, { dedupe: `group:trade_done:${t.id}`, target: 'group', kind: 'trade_completed', payload: { tradeId: t.id, completedAt: now } }, now));
  if (status === 'done' && t.share_id) {
    out.push(db.prepare("UPDATE rpg_shares SET status = 'traded' WHERE id = ? AND status = 'open' AND equip_id IN (SELECT ref FROM rpg_trade_items WHERE trade_id = ? AND kind = rpg_shares.object_kind AND side = 'a')").bind(t.share_id, t.id),
      db.prepare("UPDATE rpg_trade_requests SET status = 'expired', decided_at = ? WHERE share_id = ? AND status = 'pending'").bind(now, t.share_id),
      outboxStmt(db, { dedupe: `share_upd:${t.share_id}:${t.id}`, target: 'group', kind: 'share_update', payload: { shareId: t.share_id } }, now));
  }
  return out;
}
function settleStatements(db, t, now) {
  const out = [];
  for (const s of ['a', 'b']) {
    const from = t[`${s}_tg`]; const to = t[`${otherSide(s)}_tg`];
    for (const l of t.lines.filter((x) => x.side === s)) {
      if(l.kind==='sigil'){
        out.push(db.prepare('UPDATE rpg_guardian_sigils SET char_id=?,trade_id=NULL,rev=rev+1,updated_at=? WHERE id=? AND trade_id=? AND char_id=? AND bound=0 AND active=0 AND locked=0 AND EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id=? AND party_id IS NULL AND level>=15)').bind(to,now,l.ref,t.id,from,to),guardStmt(db),ledgerStmt(db,{event_id:'trade:'+t.id+':done:'+from+':give:'+l.ref,tg_id:from,type:'交易交出守護羽毛',item:'sigil:'+l.ref,item_delta:-1,note:t.id},now),ledgerStmt(db,{event_id:'trade:'+t.id+':done:'+to+':get:'+l.ref,tg_id:to,type:'交易獲得守護羽毛',item:'sigil:'+l.ref,item_delta:1,note:t.id},now));
      } else if (l.kind === 'equip') {
        out.push(db.prepare('UPDATE rpg_equipment SET tg_id = ?, trade_id = NULL, is_equipped = 0 WHERE id = ? AND trade_id = ? AND tg_id = ?').bind(to, l.ref, t.id, from), guardStmt(db),
          ledgerStmt(db, { event_id: `trade:${t.id}:done:${from}:give:${l.ref}`, tg_id: from, type: '交易交出裝備', item: `equip:${l.ref}`, item_delta: -1, note: t.id }, now),
          ledgerStmt(db, { event_id: `trade:${t.id}:done:${to}:get:${l.ref}`, tg_id: to, type: '交易獲得裝備', item: `equip:${l.ref}`, item_delta: 1, note: t.id }, now));
      } else {
        out.push(invDeltaStmt(db, to, l.ref, l.qty), ledgerStmt(db, { event_id: `trade:${t.id}:done:${to}:get:${l.ref}`, tg_id: to, type: '交易獲得道具', item: l.ref, item_delta: l.qty, note: t.id }, now));
      }
    }
    const g = t[`${s}_gold`];
    if (g > 0) out.push(db.prepare('UPDATE rpg_characters SET gold = gold + ? WHERE tg_id = ?').bind(netGold(g), to),
      ledgerStmt(db, { event_id: `trade:${t.id}:done:${to}:gold`, tg_id: to, type: '交易獲得金幣', gold_delta: netGold(g), note: `${t.id} 稅 ${tradeTax(g)}` }, now));
  }
  out.push(bumpRevStmt(db, t.a_tg, now), bumpRevStmt(db, t.b_tg, now));
  return out;
}

// ---------------------------------------------------------------------------------------------- cancel / expire
async function closeTrade(env, t, status, by, now, extraStmts = []) {
  const db = env.DB; const stmts = [lockStmt(db, t, 'status = ?, closed_at = ?, closed_by = ?, a_ok = 0, b_ok = 0', [status, now, by == null ? null : String(by)], now), guardStmt(db)];
  for (const l of t.lines) {
    const owner = t[`${l.side}_tg`];
    if(l.kind==='sigil')stmts.push(db.prepare('UPDATE rpg_guardian_sigils SET trade_id=NULL,rev=rev+1,updated_at=? WHERE id=? AND trade_id=?').bind(now,l.ref,t.id));
    else if (l.kind === 'equip') stmts.push(db.prepare('UPDATE rpg_equipment SET trade_id = NULL WHERE id = ? AND trade_id = ?').bind(l.ref, t.id));
    else stmts.push(invDeltaStmt(db, owner, l.ref, l.qty), ledgerStmt(db, { event_id: `trade:${t.id}:${status}:${owner}:back:${l.ref}`, tg_id: owner, type: '交易退回道具', item: l.ref, item_delta: l.qty, note: t.id }, now));
  }
  for (const s of ['a', 'b']) {
    const g = t[`${s}_gold`]; const owner = t[`${s}_tg`];
    if (g > 0) stmts.push(db.prepare('UPDATE rpg_characters SET gold = gold + ? WHERE tg_id = ?').bind(g, owner), ledgerStmt(db, { event_id: `trade:${t.id}:${status}:${owner}:gold`, tg_id: owner, type: '交易退回金幣', gold_delta: g, note: t.id }, now));
  }
  stmts.push(bumpRevStmt(db, t.a_tg, now), bumpRevStmt(db, t.b_tg, now), logStmt(db, t.id, by, status === 'expired' ? 'expire' : 'cancel', null, now), ...endNotes(db, t, status, now));
  await db.batch([...stmts, ...extraStmts]);
  return { status };
}
export async function cancel(env, { tgId, tradeId, requestId = null }, now) {
  const db = env.DB; const tg = String(tgId);
  if (requestId != null && !/^(?:app:)?[\w-]{1,100}$/.test(String(requestId))) throw new GameError('request', '交易操作編號無效');
  for (let attempt = 1; ; attempt++) {
    if (requestId != null) {
      const prior = await db.prepare('SELECT result_json FROM rpg_trade_operations WHERE trade_id = ? AND tg_id = ? AND request_id = ?').bind(String(tradeId), tg, String(requestId)).first();
      if (prior) return JSON.parse(prior.result_json);
    }
    const t = await load(db, tradeId); if (!t) throw new GameError('not_found', '找不到這筆交易', 404);
    if (!sideOf(t, tg)) throw new GameError('not_party', '你不是這筆交易的成員', 403);
    if (t.status !== 'open') throw new GameError('closed', '這筆交易已經結束了', 409);
    const status = t.expires_at <= now ? 'expired' : 'cancelled'; const result = { status };
    const extra = requestId == null ? [] : [db.prepare('INSERT INTO rpg_trade_operations (trade_id,tg_id,request_id,result_json,created_at) VALUES (?,?,?,?,?)').bind(String(tradeId), tg, String(requestId), JSON.stringify(result), now)];
    try { return await closeTrade(env, t, status, tg, now, extra); }
    catch (e) { const g = classifyDbError(e); if (g?.code === 'conflict' && attempt < 4) continue; throw g || e; }
  }
}
async function expireOne(env, id, now) {
  const t = await load(env.DB, id); if (!t || t.status !== 'open' || t.expires_at > now) return null;
  try { return await closeTrade(env, t, 'expired', null, now); } catch (e) { const g = classifyDbError(e); if (g?.code === 'conflict') return null; throw g || e; }
}
/** cron: expire every overdue open trade (escrow returned) */
export async function expireDue(env, now) {
  const rows = await env.DB.prepare("SELECT id FROM rpg_trades WHERE status = 'open' AND expires_at <= ? LIMIT 200").bind(now).all();
  let n = 0; for (const r of rows.results || []) if (await expireOne(env, r.id, now)) n += 1;
  return n;
}
/** remember @username for "/決鬥 @user" lookups (Mini App initData / bot) */
export async function touchUsername(env, tg, username) {
  if (!username || !/^[A-Za-z0-9_]{3,32}$/.test(username)) return;
  await env.DB.prepare('UPDATE rpg_characters SET tg_username = ? WHERE tg_id = ? AND (tg_username IS NULL OR tg_username <> ?)').bind(username, String(tg), username).run();
}

// Player-initiated trade from the gear menu: open a window with this equipment already escrowed on side a (same validation as share-accept).
export async function openWithEquip(env, { tgId, target, equipId, requestId = null }, now) {
  const tg = String(tgId), rid = requestId ? `gear:${String(requestId)}` : null;
  if (rid) { const old = await env.DB.prepare('SELECT id FROM rpg_trades WHERE request_id = ? AND a_tg = ?').bind(rid, tg).first(); if (old) return { ok: true, tradeId: old.id, trade: await tradeView(env, old.id, tg, now) }; }
  const other = await findTarget(env, target); if (!other) throw new GameError('target', '找不到交易對象');
  const e = await env.DB.prepare('SELECT * FROM rpg_equipment WHERE id = ?').bind(String(equipId || '')).first(); checkEquipLine(e, tg);
  const { id, stmts } = await openTradeStmts(env, { aTg: tg, bTg: other.tg_id, origin: 'gear', requestId: rid, preEquip: e }, now);
  try { await env.DB.batch([...stmts, ...[tg, String(other.tg_id)].map((who) => outboxStmt(env.DB, { dedupe: `gear-trade:${id}:${who}`, target: 'dm', tgId: who, kind: 'trade_open', payload: { tradeId: id } }, now))]); }
  catch (err) { throw classifyDbError(err) || err; }
  return { ok: true, tradeId: id, trade: await tradeView(env, id, tg, now) };
}
