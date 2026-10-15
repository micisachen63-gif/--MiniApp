// v0.5 群組決鬥 (1v1 PK): challenge → the challenged player accepts (group card button or Mini App) → server-side duel.
// Loser: 20% chance to drop ONE random equipped item (weapons included) → winner's bag, UNBOUND (can be traded back);
// a 守護符 in the loser's bag absorbs that drop (consumed). No EXP/HP effect on the idle character.
// Anti-abuse: both ≥ Lv10, level gap ≤ 10, 5 duels/player/day, one duel per pair per 12h, ≤1 outgoing / ≤3 incoming
// pending challenges, 10-min challenge expiry. The duel seed is crypto-random at accept time (stored for replay).
import { PK, CLASSES } from '../game/constants.js';
import { GameError } from '../game/classes.js';
import { checkPk, simulateDuel, rollDrop } from '../game/pk.js';
import { computeStats } from '../game/stats.js';
import { mulberry32 } from '../game/rng.js';
import { taipeiDay } from '../game/time.js';
import { snapshotOf, cardPhoto } from '../game/share.js';
import { equipmentView } from '../views.js';
import { loadPlayer, guardStmt, outboxStmt, ledgerStmt, invDeltaStmts, classifyDbError } from '../db.js';
import { withPlayer } from './player.js';
import { findTarget } from './trade.js';
import { shareStmts } from './share.js';

const newId = () => `p${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`;
const fullChar = (db, tg) => db.prepare('SELECT * FROM rpg_characters WHERE tg_id = ?').bind(String(tg)).first();
const pkRow = (db, id) => db.prepare('SELECT * FROM rpg_pk WHERE id = ?').bind(String(id)).first();
const hhmm = (ms) => { const m = Math.ceil(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };
const checkParty = (a,b) => { if(a?.party_id||b?.party_id)throw new GameError('party','你或對方正在組隊戰鬥，請完成冒險後再決鬥',409); };
async function checkAutoEnhance(db,a,b){
  const locked=await db.prepare("SELECT 1 FROM rpg_auto_enhance j JOIN rpg_equipment e ON e.id=j.item_id WHERE j.tg_id IN (?,?) AND j.status IN ('running','processing') AND e.is_equipped>0 LIMIT 1").bind(String(a),String(b)).first();
  if(locked)throw new GameError('auto_active','你或對方的穿戴裝備正在背景強化，請停止或完成強化後再決鬥',409);
}

export async function pkView(env, idOrRow, viewer = null, now = Date.now()) {
  const db = env.DB; const p = typeof idOrRow === 'object' ? idOrRow : await pkRow(db, idOrRow); if (!p) return null;
  const [a, b] = await Promise.all([fullChar(db, p.a_tg), fullChar(db, p.b_tg)]);
  const side = (c, tg) => ({ tgId: tg, name: c?.name || '?', level: c?.level || 0, baseClass: c?.base_class, gender: c?.gender, classPath: c?.class_path || '', className: CLASSES[c?.base_class]?.name });
  const me = viewer == null ? null : String(viewer) === String(p.a_tg) ? 'a' : String(viewer) === String(p.b_tg) ? 'b' : null;
  return { id: p.id, status: p.status, origin: p.origin, a: side(a, p.a_tg), b: side(b, p.b_tg), me,
    winner: p.winner_tg ? (String(p.winner_tg) === String(p.a_tg) ? 'a' : 'b') : null, rounds: p.rounds, log: p.log_json ? JSON.parse(p.log_json) : null,
    drop: p.drop_json ? JSON.parse(p.drop_json) : null, wardUsed: !!p.ward_used, createdAt: p.created_at, expiresAt: p.expires_at, decidedAt: p.decided_at,
    secondsLeft: Math.max(0, Math.round((p.expires_at - now) / 1000)), messageChatId: p.chat_id, messageId: p.message_id };
}

async function capsFor(db, a, b, now) {
  const day = taipeiDay(now);
  const [na, nb, pair] = await Promise.all([
    db.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id = ? AND day = ? AND key = 'pk'").bind(String(a.tg_id), day).first(),
    db.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id = ? AND day = ? AND key = 'pk'").bind(String(b.tg_id), day).first(),
    db.prepare("SELECT MAX(decided_at) AS t FROM rpg_pk WHERE status = 'done' AND ((a_tg = ? AND b_tg = ?) OR (a_tg = ? AND b_tg = ?))").bind(String(a.tg_id), String(b.tg_id), String(b.tg_id), String(a.tg_id)).first()]);
  if ((na?.n || 0) >= PK.dailyCap) throw new GameError('daily_limit', `${a.name} 今天已經決鬥 ${PK.dailyCap} 場了，明天再來`);
  if ((nb?.n || 0) >= PK.dailyCap) throw new GameError('daily_limit', `${b.name} 今天已經決鬥 ${PK.dailyCap} 場了`);
  if (pair?.t && now - pair.t < PK.pairCooldownMs) throw new GameError('cooldown', `你們 ${PK.pairCooldownMs / 3600e3} 小時內只能決鬥一次（還要 ${hhmm(PK.pairCooldownMs - (now - pair.t))}）`);
}

/** target: { tgId } | { username } | { name }. origin 'group' → the bot posts the card itself; 'app' → outbox pk_card */
export async function challenge(env, { tgId, target, origin = 'app', chatId = null }, now) {
  const db = env.DB; const tg = String(tgId);
  const me = await fullChar(db, tg); const t0 = await findTarget(env, target); const other = t0 ? await fullChar(db, t0.tg_id) : null;
  if (me && other && String(me.account_tg_id) === String(other.account_tg_id)) throw new GameError('self', '不能用同一個 Telegram 帳號的角色互相決鬥');
  checkPk(me, other); checkParty(me,other); await checkAutoEnhance(db,tg,other.tg_id); await expirePk(env, now, { tg }); await expirePk(env, now, { tg: other.tg_id });
  const [out, inn, pair] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM rpg_pk WHERE a_tg = ? AND status = 'pending'").bind(tg).first(),
    db.prepare("SELECT COUNT(*) AS n FROM rpg_pk WHERE b_tg = ? AND status = 'pending'").bind(String(other.tg_id)).first(),
    db.prepare("SELECT id FROM rpg_pk WHERE status = 'pending' AND ((a_tg = ? AND b_tg = ?) OR (a_tg = ? AND b_tg = ?))").bind(tg, String(other.tg_id), String(other.tg_id), tg).first()]);
  if (pair) throw new GameError('duplicate', '你們之間已經有一場等待回應的決鬥');
  if ((out?.n || 0) >= PK.maxPendingOut) throw new GameError('too_many', '你已經有一場等待回應的挑戰，先等對方回應或取消');
  if ((inn?.n || 0) >= PK.maxPendingIn) throw new GameError('too_many', '對方收到的挑戰太多了，晚點再試');
  await capsFor(db, me, other, now);
  const id = newId(); const o = String(other.tg_id);
  const stmts = [db.prepare(`INSERT INTO rpg_pk (id,a_tg,b_tg,status,origin,chat_id,created_at,expires_at)
    SELECT ?,?,?,'pending',?,?,?,?
    WHERE (SELECT COUNT(*) FROM rpg_pk WHERE a_tg=? AND status='pending')<?
      AND (SELECT COUNT(*) FROM rpg_pk WHERE b_tg=? AND status='pending')<?
      AND NOT EXISTS(SELECT 1 FROM rpg_pk WHERE status='pending' AND ((a_tg=? AND b_tg=?) OR (a_tg=? AND b_tg=?)))
      AND NOT EXISTS(SELECT 1 FROM rpg_characters WHERE tg_id IN (?,?) AND party_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM rpg_auto_enhance j JOIN rpg_equipment e ON e.id=j.item_id WHERE j.tg_id IN (?,?) AND j.status IN ('running','processing') AND e.is_equipped>0)`)
    .bind(id, tg, o, origin === 'group' ? 'group' : 'app', chatId == null ? null : String(chatId), now, now + PK.challengeTtlMs,tg,PK.maxPendingOut,o,PK.maxPendingIn,tg,o,o,tg,tg,o,tg,o),guardStmt(db),
    outboxStmt(db, { dedupe: `dm:${o}:pk:${id}`, target: 'dm', tgId: o, kind: 'pk_challenge', payload: { pkId: id, from: me.name } }, now)];
  if (origin !== 'group') stmts.push(outboxStmt(db, { dedupe: `pk_card:${id}`, target: 'group', kind: 'pk_card', payload: { pkId: id } }, now));
  try { await db.batch(stmts); }
  catch(e) {
    const error=classifyDbError(e);
    if(error?.code==='conflict') {
      checkParty(await fullChar(db,tg),await fullChar(db,o));
      await checkAutoEnhance(db,tg,o);
      throw new GameError('too_many','決鬥邀請剛更新，你或對方已達邀請上限，請重新整理',409);
    }
    throw error||e;
  }
  return pkView(env, id, tg, now);
}

/** the challenged player accepts → settle both idles, duel, roll the drop, ONE atomic batch guarded by both players' rev */
export async function accept(env, { tgId, pkId }, now, rngSeed = null) {
  const db = env.DB; const tg = String(tgId);
  for (let attempt = 1; ; attempt++) {
    const p = await pkRow(db, pkId); if (!p) throw new GameError('not_found', '找不到這場決鬥', 404);
    if (String(p.b_tg) !== tg) throw new GameError(String(p.a_tg) === tg ? 'self' : 'not_party', String(p.a_tg) === tg ? '要等對方接受挑戰' : '這場決鬥不是找你的', 403);
    if (p.status !== 'pending') throw new GameError('closed', { done: '這場決鬥已經結束了', declined: '已經拒絕了', cancelled: '挑戰者已取消', expired: '挑戰已過期' }[p.status] || '決鬥已結束', 409);
    if (p.expires_at <= now) { await expirePk(env, now, { tg }); throw new GameError('closed', '挑戰已過期', 409); }
    await withPlayer(env, p.a_tg, now); await withPlayer(env, p.b_tg, now);          // settle idle up to now (gear changes after this point)
    const [A, B] = await Promise.all([loadPlayer(db, p.a_tg), loadPlayer(db, p.b_tg)]);
    checkPk(A.char, B.char); checkParty(A.char,B.char); await checkAutoEnhance(db,p.a_tg,p.b_tg); await capsFor(db, A.char, B.char, now);
    const eqA = A.equipment.filter((e) => e.is_equipped), eqB = B.equipment.filter((e) => e.is_equipped);
    const sa = computeStats(A.char, eqA), sb = computeStats(B.char, eqB);
    const seed = rngSeed ?? (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0); const rng = mulberry32(seed);
    const sim = simulateDuel(sa, sb, rng, {a:A.char,b:B.char});
    const W = sim.winner === 'a' ? A : B, L = sim.winner === 'a' ? B : A; const wTg = String(W.char.tg_id), lTg = String(L.char.tg_id);
    const lEq = (sim.winner === 'a' ? eqB : eqA).filter((e) => !e.trade_id);
    const d = rollDrop(rng, lEq, L.inv.ward || 0);
    const day = taipeiDay(now);
    const stmts = [db.prepare("UPDATE rpg_pk SET status = 'done', winner_tg = ?, loser_tg = ?, seed = ?, rounds = ?, log_json = ?, decided_at = ?, ward_used = ? WHERE id = ? AND status = 'pending'")
      .bind(wTg, lTg, seed, sim.rounds, JSON.stringify({ first: sim.log[0]?.by, hp: sim.hp, mp: sim.mp, max: sim.max, maxMp: sim.maxMp, initial: sim.initial, ko: sim.ko, steps: sim.log.slice(0, 60) }), now, d.ward ? 1 : 0, p.id), guardStmt(db)];
    for (const X of [A, B]) stmts.push(db.prepare("UPDATE rpg_characters SET rev = rev + 1, updated_at = ? WHERE tg_id = ? AND rev = ? AND party_id IS NULL AND NOT EXISTS(SELECT 1 FROM rpg_auto_enhance j JOIN rpg_equipment e ON e.id=j.item_id WHERE j.tg_id=? AND j.status IN ('running','processing') AND e.is_equipped>0)").bind(now, String(X.char.tg_id), X.char.rev,String(X.char.tg_id)), guardStmt(db),
      db.prepare("INSERT INTO rpg_daily_counters (tg_id,day,key,n) VALUES (?,?,'pk',1) ON CONFLICT(tg_id,day,key) DO UPDATE SET n = n + 1").bind(String(X.char.tg_id), day));
    let drop = null;
    if (d.ward) stmts.push(...invDeltaStmts(db, lTg, 'ward', -1), ledgerStmt(db, { event_id: `pk:${p.id}:ward`, tg_id: lTg, type: '守護符（決鬥）', item: 'ward', item_delta: -1, note: `擋下決鬥掉裝（${W.char.name}）` }, now));
    if (d.item) {
      const it = d.item; const moved = { ...it, tg_id: wTg, is_equipped: 0, bound: 0 };
      const v = equipmentView(W.char, moved); drop = { ...snapshotOf(v), id: it.id, photo: cardPhoto(moved) };
      const rest = computeStats(L.char, (sim.winner === 'a' ? eqB : eqA).filter((e) => e.id !== it.id));
      stmts.push(db.prepare('UPDATE rpg_equipment SET tg_id = ?, is_equipped = 0, bound = 0 WHERE id = ? AND tg_id = ? AND is_equipped > 0 AND trade_id IS NULL').bind(wTg, it.id, lTg), guardStmt(db),
        db.prepare('UPDATE rpg_characters SET hp = MIN(hp, ?), mp = MIN(mp, ?) WHERE tg_id = ?').bind(rest.maxHp, rest.maxMp, lTg),
        db.prepare('UPDATE rpg_pk SET drop_equip_id = ?, drop_json = ? WHERE id = ?').bind(it.id, JSON.stringify(drop), p.id),
        ledgerStmt(db, { event_id: `pk:${p.id}:lose:${it.id}`, tg_id: lTg, type: '決鬥掉落', item: `equip:${it.id}`, item_delta: -1, note: `${it.name} → ${W.char.name}` }, now),
        ledgerStmt(db, { event_id: `pk:${p.id}:win:${it.id}`, tg_id: wTg, type: '決鬥戰利品', item: `equip:${it.id}`, item_delta: 1, note: `${it.name}（${L.char.name}）` }, now),
        ...shareStmts(db, { id: `s${p.id}`, owner: wTg, ownerChar: W.char, equip: moved, kind: 'pk', context: { pkId: p.id, winner: W.char.name, loser: L.char.name }, now }).stmts);
    }
    stmts.push(outboxStmt(db, { dedupe: `pk_result:${p.id}`, target: 'group', kind: 'pk_result', payload: { pkId: p.id } }, now),
      ...[p.a_tg, p.b_tg].map((x) => outboxStmt(db, { dedupe: `dm:${x}:pkres:${p.id}`, target: 'dm', tgId: x, kind: 'pk_result', payload: { pkId: p.id } }, now)));
    try { await db.batch(stmts); }
    catch (e) { const g = classifyDbError(e); if (g?.code === 'conflict' && attempt < 3) continue; throw g || e; }
    return pkView(env, p.id, tg, now);
  }
}
export async function decline(env, { tgId, pkId }, now) {
  const db = env.DB; const tg = String(tgId); const p = await pkRow(db, pkId); if (!p) throw new GameError('not_found', '找不到這場決鬥', 404);
  const side = String(p.a_tg) === tg ? 'a' : String(p.b_tg) === tg ? 'b' : null; if (!side) throw new GameError('not_party', '這場決鬥不是你的', 403);
  if (p.status !== 'pending') throw new GameError('closed', '這場決鬥已經結束了', 409);
  const status = side === 'a' ? 'cancelled' : 'declined';
  await db.batch([db.prepare('UPDATE rpg_pk SET status = ?, decided_at = ? WHERE id = ? AND status = \'pending\'').bind(status, now, p.id), guardStmt(db),
    outboxStmt(db, { dedupe: `pk_upd:${p.id}:${status}`, target: 'group', kind: 'pk_update', payload: { pkId: p.id } }, now),
    ...(status === 'declined' ? [outboxStmt(db, { dedupe: `dm:${p.a_tg}:pkno:${p.id}`, target: 'dm', tgId: p.a_tg, kind: 'pk_declined', payload: { pkId: p.id } }, now)] : [])]);
  return pkView(env, p.id, tg, now);
}
export async function expirePk(env, now, { tg = null } = {}) {
  const db = env.DB;
  const rows = (await (tg ? db.prepare("SELECT id FROM rpg_pk WHERE status = 'pending' AND expires_at <= ? AND (a_tg = ? OR b_tg = ?)").bind(now, String(tg), String(tg))
    : db.prepare("SELECT id FROM rpg_pk WHERE status = 'pending' AND expires_at <= ? LIMIT 100").bind(now)).all()).results || [];
  for (const r of rows) await db.batch([db.prepare("UPDATE rpg_pk SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, r.id),
    outboxStmt(db, { dedupe: `pk_upd:${r.id}:expired`, target: 'group', kind: 'pk_update', payload: { pkId: r.id } }, now)]);
  return rows.length;
}
export async function listPk(env, tg, now) {
  const db = env.DB; tg = String(tg); await expirePk(env, now, { tg });
  const rows = (await db.prepare("SELECT * FROM rpg_pk WHERE (a_tg = ? OR b_tg = ?) ORDER BY (status = 'pending') DESC, COALESCE(decided_at, created_at) DESC LIMIT 15").bind(tg, tg).all()).results || [];
  const out = []; for (const r of rows) out.push(await pkView(env, r, tg, now));
  const day = taipeiDay(now); const n = (await db.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id = ? AND day = ? AND key = 'pk'").bind(tg, day).first())?.n || 0;
  return { pending: out.filter((x) => x.status === 'pending'), history: out.filter((x) => x.status !== 'pending'), today: n, rules: { ...PK } };
}
export async function setPkMessage(env, pkId, chatId, messageId) {
  await env.DB.prepare('UPDATE rpg_pk SET chat_id = ?, message_id = ? WHERE id = ?').bind(String(chatId), Number(messageId), String(pkId)).run();
  return { ok: true };
}
