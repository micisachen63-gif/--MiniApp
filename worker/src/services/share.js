// v0.5 分享至群組 + 超讚 + 我要交易 requests. A post (rpg_shares) freezes the item view for the caption; the bot sends
// it to the group as a PHOTO (art/cards JPG) with 「🤝 我要交易」「👍 超讚」. A request = the requester's confirmation;
// the owner 確認 in the Mini App → trade window opens (services/trade.js openTrade) with the item pre-placed.
import { TRADE, SHARE } from '../game/constants.js';
import { GameError } from '../game/classes.js';
import { shareBlock, checkShareRate, snapshotOf, cardPhoto } from '../game/share.js';
import { tradeBlock } from '../game/gear.js';
import { taipeiDay } from '../game/time.js';
import { equipmentView } from '../views.js';
import { guardStmt, outboxStmt, classifyDbError } from '../db.js';
import { openTradeStmts, tradeView } from './trade.js';

const sid = (p) => `${p}${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`;
const charOf = (db, tg) => db.prepare('SELECT tg_id, account_tg_id, name, base_class, class_path, level, gold FROM rpg_characters WHERE tg_id = ?').bind(String(tg)).first();
const counterStmt = (db, tg, day, key) => db.prepare('INSERT INTO rpg_daily_counters (tg_id,day,key,n) VALUES (?,?,?,1) ON CONFLICT(tg_id,day,key) DO UPDATE SET n = n + 1').bind(String(tg), day, key);

/** INSERT statement for a post (also used inside the relic / PK batches). kind: share | relic | pk */
export function shareStmts(db, { id = sid('s'), owner, ownerChar, equip, kind, context = null, now, announce = true }) {
  const v = equipmentView(ownerChar, equip); const snap = { ...snapshotOf(v), statClass: ownerChar.base_class, photo: cardPhoto(equip) };
  const tradeable = tradeBlock(equip) ? 0 : 1;
  const stmts = [db.prepare('INSERT INTO rpg_shares (id,tg_id,equip_id,kind,snapshot_json,context_json,tradeable,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, String(owner), equip.id, kind, JSON.stringify(snap), context ? JSON.stringify(context) : null, tradeable, now)];
  if (announce) stmts.push(outboxStmt(db, { dedupe: `share:${id}`, target: 'group', kind: 'share', payload: { shareId: id } }, now));
  return { id, stmts };
}

export async function shareView(env, id) {
  const db = env.DB; const s = await db.prepare('SELECT * FROM rpg_shares WHERE id = ?').bind(String(id)).first(); if (!s) return null;
  const owner = await charOf(db, s.tg_id); const ctx = s.context_json ? JSON.parse(s.context_json) : null;
  // live: is the item still with the poster, unbound and free? (a stale post keeps its photo but loses 我要交易)
  const guardian=s.object_kind==='sigil';
  const e = await db.prepare(guardian?'SELECT * FROM rpg_guardian_sigils WHERE id=?':'SELECT * FROM rpg_equipment WHERE id = ?').bind(s.equip_id).first();
  const ownerHasItem = !!(e && String(guardian?e.char_id:e.tg_id) === String(s.tg_id));
  const showcase = (s.kind==='share'||ctx?.source==='guardian') && ctx?.showcase===true;
  const requestable = !showcase && s.status === 'open' && ownerHasItem;
  const live = requestable && !(guardian?(e.bound||e.active||e.locked||e.trade_id||e.exchange_id):tradeBlock(e));
  const guardianBlock=guardian&&ownerHasItem?(e.bound?'這位天使已綁定；主人須先取消啟用並使用解綁卷軸，才能交易。':e.active?'這位天使已啟用，請先由主人取消啟用。':e.locked?'這位天使已鎖定，請先由主人解除鎖定。':e.trade_id||e.exchange_id?'這位天使目前正在交易或保管中，暫時不能提出交易請求。':null):null;
  const snapshot = JSON.parse(s.snapshot_json);
  return { id: s.id, kind: s.kind, objectKind:s.object_kind, ownerTgId: s.tg_id, ownerName: owner?.name || '?', item: { ...snapshot, photo: guardian?snapshot.photo:cardPhoto(snapshot) }, context: ctx,
    tradeable: live, requestable, showcase, ...(guardian?{tradeBlockReason:guardianBlock}:{}), status: s.status, likes: s.likes, chatId: s.chat_id, messageId: s.message_id, createdAt: s.created_at };
}

/** Mini App long-press → 分享至群組 */
export async function shareItem(env, { tgId, equipId }, now) {
  const db = env.DB; const tg = String(tgId); const day = taipeiDay(now);
  const ch = await db.prepare('SELECT * FROM rpg_characters WHERE tg_id = ?').bind(tg).first(); if (!ch) throw new GameError('no_character', '你還沒有角色', 404);
  const e = await db.prepare('SELECT * FROM rpg_equipment WHERE id = ?').bind(String(equipId)).first();
  const why = shareBlock(e, tg); if (why) throw new GameError('unshareable', why === '找不到這件裝備' ? why : `不能分享：${why}`);
  const [last, today, same] = await Promise.all([
    db.prepare("SELECT MAX(created_at) AS t FROM rpg_shares WHERE tg_id = ? AND kind = 'share'").bind(tg).first(),
    db.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id = ? AND day = ? AND key = 'share'").bind(tg, day).first(),
    db.prepare("SELECT MAX(created_at) AS t FROM rpg_shares WHERE equip_id = ? AND kind = 'share'").bind(e.id).first()]);
  checkShareRate({ last: last?.t, today: today?.n || 0, sameItemAt: same?.t }, now);
  const { id, stmts } = shareStmts(db, { owner: tg, ownerChar: ch, equip: e, kind: 'share', context: tradeBlock(e)?{showcase:true}:null, now });
  // Cooldowns and ownership are checked again in the transaction, so simultaneous posts
  // cannot all pass the same previously read counter or publish an item already sold.
  const gate=db.prepare(`UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=?
    AND NOT EXISTS(SELECT 1 FROM rpg_shares WHERE tg_id=? AND kind='share' AND created_at>?)
    AND NOT EXISTS(SELECT 1 FROM rpg_shares WHERE equip_id=? AND kind='share' AND created_at>?)
    AND COALESCE((SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key='share'),0)<?
    AND EXISTS(SELECT 1 FROM rpg_equipment WHERE id=? AND tg_id=? AND trade_id IS NULL)`)
    .bind(tg,tg,now-SHARE.cooldownMs,e.id,now-SHARE.sameItemMs,tg,day,SHARE.dailyCap,e.id,tg);
  try{await db.batch([gate,guardStmt(db),...stmts,counterStmt(db,tg,day,'share')]);}
  catch(err){const error=classifyDbError(err);if(error?.code==='conflict')throw new GameError('cooldown','分享或裝備狀態剛更新，請稍後再試',409);throw error||err;}
  return shareView(env, id);
}

/** 👍 超讚 toggle (anyone in the group; no game effect) → { liked, likes } */
export async function toggleLike(env, { tgId, shareId }, now) {
  const db = env.DB; const tg = String(tgId); const id = String(shareId);
  const s = await db.prepare('SELECT id FROM rpg_shares WHERE id = ?').bind(id).first(); if (!s) throw new GameError('not_found', '找不到這則分享', 404);
  const had = await db.prepare('SELECT 1 FROM rpg_share_likes WHERE share_id = ? AND tg_id = ?').bind(id, tg).first();
  const recount = db.prepare('UPDATE rpg_shares SET likes = (SELECT COUNT(*) FROM rpg_share_likes WHERE share_id = ?) WHERE id = ?').bind(id, id);
  await db.batch([had ? db.prepare('DELETE FROM rpg_share_likes WHERE share_id = ? AND tg_id = ?').bind(id, tg)
    : db.prepare('INSERT OR IGNORE INTO rpg_share_likes (share_id,tg_id,created_at) VALUES (?,?,?)').bind(id, tg, now), recount]);
  const r = await db.prepare('SELECT likes FROM rpg_shares WHERE id = ?').bind(id).first();
  return { liked: !had, likes: r?.likes || 0 };
}
export async function setShareMessage(env, shareId, chatId, messageId) {
  await env.DB.prepare('UPDATE rpg_shares SET chat_id = ?, message_id = ? WHERE id = ?').bind(String(chatId), Number(messageId), String(shareId)).run();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------- 我要交易 requests
async function requestRow(db, id) { return db.prepare('SELECT * FROM rpg_trade_requests WHERE id = ?').bind(String(id)).first(); }
export async function requestView(env, r, now = Date.now()) {
  if (!r) return null; const db = env.DB;
  const [o, q, s] = await Promise.all([charOf(db, r.owner_tg), charOf(db, r.requester_tg), shareView(env, r.share_id)]);
  const trade = r.status === 'accepted' && r.trade_id ? await db.prepare('SELECT status, expires_at FROM rpg_trades WHERE id = ?').bind(String(r.trade_id)).first() : null;
  const tradeStatus = r.status === 'accepted' ? (!trade ? 'closed' : trade.status === 'open' && trade.expires_at <= now ? 'expired' : trade.status) : null;
  return { id: r.id, status: r.status, tradeStatus, shareId: r.share_id, equipId: r.equip_id, objectKind:r.object_kind, owner: { tgId: r.owner_tg, name: o?.name || '?' }, requester: { tgId: r.requester_tg, name: q?.name || '?', level: q?.level, baseClass: q?.base_class },
    item: s?.item || null, tradeId: r.trade_id, createdAt: r.created_at, expiresAt: r.expires_at, decidedAt: r.decided_at };
}
/** group 🤝 我要交易 → pending request + DM to the owner (+ Mini App badge) */
export async function requestTrade(env, { tgId, shareId }, now) {
  const db = env.DB; const tg = String(tgId);
  const s = await shareView(env, shareId); if (!s) throw new GameError('not_found', '找不到這則分享', 404);
  const me = await charOf(db, tg); if (!me) throw new GameError('no_character', '你還沒有角色，先私訊星穹旅誌輸入 /rpg 創角', 404);
  const owner = String(s.ownerTgId) === tg ? me : await charOf(db, s.ownerTgId);
  if (String(s.ownerTgId) === tg || (owner && String(owner.account_tg_id) === String(me.account_tg_id))) throw new GameError('self', '不能讓同一個 Telegram 帳號的角色互相交易 🙂');
  if(s.objectKind==='sigil'&&s.tradeBlockReason)throw new GameError('untradeable',s.tradeBlockReason,409);
  if (!s.requestable) throw new GameError('untradeable', s.showcase ? s.objectKind==='sigil'?'這張是天使展示卡，不能提出交易；請使用主人另行分享的未綁定天使卡。':'這張是裝備展示卡，不能提出交易；請使用主人另行分享的可交易裝備卡' : s.status === 'traded' ? '這件已經成交了' : '這件裝備已不在原主人手上，無法提出交易意願');
  if(s.objectKind==='sigil'&&me.level<15)throw new GameError('guardian_level','守護神交易於15級開放');
  await expireRequests(env, now, { tg });
  const [out, inn] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM rpg_trade_requests WHERE requester_tg = ? AND status = 'pending' AND expires_at>?").bind(tg,now).first(),
    db.prepare("SELECT COUNT(*) AS n FROM rpg_trade_requests WHERE owner_tg = ? AND status = 'pending' AND expires_at>?").bind(String(s.ownerTgId),now).first()]);
  if ((out?.n || 0) >= TRADE.maxPendingOut) throw new GameError('too_many', `你已經有 ${TRADE.maxPendingOut} 個等待回覆的交易請求`);
  if ((inn?.n || 0) >= TRADE.maxPendingIn) throw new GameError('too_many', '對方的交易請求太多了，晚點再試');
  const id = sid('q');
  try {
    await db.batch([db.prepare(`INSERT INTO rpg_trade_requests (id,share_id,equip_id,object_kind,owner_tg,requester_tg,status,created_at,expires_at)
      SELECT ?,s.id,s.equip_id,s.object_kind,?,?,'pending',?,? FROM rpg_shares s
      WHERE s.id=? AND s.status='open'
        AND ((s.object_kind='equip' AND EXISTS(SELECT 1 FROM rpg_equipment e WHERE e.id=s.equip_id AND e.tg_id=s.tg_id)) OR (s.object_kind='sigil' AND EXISTS(SELECT 1 FROM rpg_guardian_sigils g WHERE g.id=s.equip_id AND g.char_id=s.tg_id AND g.bound=0 AND g.active=0 AND g.locked=0 AND g.trade_id IS NULL AND g.exchange_id IS NULL)))
        AND (SELECT COUNT(*) FROM rpg_trade_requests WHERE requester_tg=? AND status='pending' AND expires_at>?)<?
        AND (SELECT COUNT(*) FROM rpg_trade_requests WHERE owner_tg=? AND status='pending' AND expires_at>?)<?`)
      .bind(id,String(s.ownerTgId),tg,now,now+TRADE.requestTtlMs,s.id,tg,now,TRADE.maxPendingOut,String(s.ownerTgId),now,TRADE.maxPendingIn),guardStmt(db),
      outboxStmt(db, { dedupe: `dm:${s.ownerTgId}:treq:${id}`, target: 'dm', tgId: s.ownerTgId, kind: 'trade_request', payload: { requestId: id, from: me.name, item: s.item.name } }, now)]);
  } catch (e) { if (/UNIQUE constraint failed: rpg_trade_requests/.test(String(e?.message || e))) throw new GameError('duplicate', '你已經對這件送出交易請求了，等對方確認'); const error=classifyDbError(e);if(error?.code==='conflict')throw new GameError('too_many','交易請求或分享狀態剛更新，請重新整理後再試',409);throw error||e; }
  return requestView(env, await requestRow(db, id));
}
export async function listRequests(env, tg, now) {
  const db = env.DB; tg = String(tg); await expireRequests(env, now, { tg });
  const rows = (await db.prepare("SELECT * FROM rpg_trade_requests WHERE (owner_tg = ? OR requester_tg = ?) AND (status = 'pending' OR decided_at > ?) ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 30")
    .bind(tg, tg, now - 3 * 86400e3).all()).results || [];
  const out = []; for (const r of rows) out.push(await requestView(env, r, now));
  return { incoming: out.filter((r) => String(r.owner.tgId) === tg), outgoing: out.filter((r) => String(r.requester.tgId) === tg) };
}
/** owner 確認 → open the window (owner = initiator a, requester = b), shared item pre-placed if still tradeable */
export async function acceptRequest(env, { tgId, requestId }, now) {
  const db = env.DB; const tg = String(tgId);
  const r = await requestRow(db, requestId); if (!r) throw new GameError('not_found', '找不到這個請求', 404);
  if (String(r.owner_tg) !== tg) throw new GameError('not_party', '只有物品主人可以確認', 403);
  if (r.status !== 'pending') throw new GameError('closed', { accepted: '已經開啟交易了', rejected: '已經拒絕了', expired: '請求已過期', cancelled: '對方已撤回請求' }[r.status] || '請求已結束', 409);
  if (r.expires_at <= now) { await expireRequests(env, now, { tg }); throw new GameError('closed', '請求已過期', 409); }
  const guardian=r.object_kind==='sigil';
  const e = await db.prepare(guardian?'SELECT * FROM rpg_guardian_sigils WHERE id=?':'SELECT * FROM rpg_equipment WHERE id = ?').bind(r.equip_id).first();
  const unavailable = !e ? '這件裝備已不存在' : String(guardian?e.char_id:e.tg_id) !== tg ? '這件裝備已換了主人' : null;
  if (unavailable) {
    await db.prepare("UPDATE rpg_trade_requests SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, r.id).run();
    throw new GameError('untradeable', `${unavailable}；這筆交易請求已結束` , 409);
  }
  const blocked = guardian?(e.bound||e.active||e.locked||e.trade_id||e.exchange_id?'守護羽毛仍被保護，請先解除啟用、綁定、鎖定或交易狀態':null):tradeBlock(e);
  if (blocked) {
    const next = e.trade_id ? '請先完成或取消目前保管這件裝備的交易' : e.source === 'starter' ? '新手裝備無法解綁交易，請改選其他裝備' : e.is_equipped ? '請先到背包卸下裝備，再使用解契卷解除綁定' : e.bound ? '請先購買解契卷並解除裝備綁定' : blocked;
    throw new GameError('untradeable', `${blocked}；${next}，處理完成後再按確認。這筆請求會保留，剩餘時間照常倒數。`, 409);
  }
  const pre = e;
  const { id: tradeId, stmts } = await openTradeStmts(env, { aTg: tg, bTg: r.requester_tg, origin: 'share', shareId: r.share_id, requestId: r.id, preEquip: guardian?null:pre, preSigil:guardian?pre:null }, now);
  try {
    await db.batch([db.prepare("UPDATE rpg_trade_requests SET status = 'accepted', trade_id = ?, decided_at = ? WHERE id = ? AND status = 'pending'").bind(tradeId, now, r.id), guardStmt(db), ...stmts,
      outboxStmt(db, { dedupe: `dm:${r.requester_tg}:topen:${tradeId}`, target: 'dm', tgId: r.requester_tg, kind: 'trade_open', payload: { tradeId, requestId: r.id } }, now)]);
  } catch (err) {
    const g = classifyDbError(err);
    if (g?.code === 'in_trade') {
      await db.prepare("UPDATE rpg_trade_requests SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, r.id).run();
      throw new GameError('in_trade', '這件裝備已在另一筆交易中，這筆請求已結束；請到「進行中的交易視窗」打開原交易', 409);
    }
    if (g?.code === 'conflict') throw new GameError('too_many', `你或對方已經有 ${TRADE.maxOpenPerPlayer} 筆進行中的交易，或裝備／請求剛被處理；請重新整理交易列表`);
    throw g || err;
  }
  return { request: await requestView(env, await requestRow(db, r.id)), trade: await tradeView(env, tradeId, tg, now), prePlaced: !!pre };
}
export async function rejectRequest(env, { tgId, requestId }, now) { return closeRequest(env, tgId, requestId, 'rejected', now); }
export async function cancelRequest(env, { tgId, requestId }, now) { return closeRequest(env, tgId, requestId, 'cancelled', now); }
async function closeRequest(env, tgId, requestId, status, now) {
  const db = env.DB; const tg = String(tgId); const r = await requestRow(db, requestId); if (!r) throw new GameError('not_found', '找不到這個請求', 404);
  const who = status === 'rejected' ? r.owner_tg : r.requester_tg;
  if (String(who) !== tg) throw new GameError('not_party', status === 'rejected' ? '只有物品主人可以拒絕' : '只有送出請求的人可以撤回', 403);
  if (r.status !== 'pending') throw new GameError('closed', '請求已經結束了', 409);
  const notify = status === 'rejected' ? [outboxStmt(db, { dedupe: `dm:${r.requester_tg}:treqno:${r.id}`, target: 'dm', tgId: r.requester_tg, kind: 'trade_rejected', payload: { requestId: r.id } }, now)] : [];
  await db.batch([db.prepare('UPDATE rpg_trade_requests SET status = ?, decided_at = ? WHERE id = ? AND status = \'pending\'').bind(status, now, r.id), guardStmt(db), ...notify]);
  return requestView(env, await requestRow(db, r.id));
}
/** 24h unanswered → expired (cron, or lazily for one player) */
export async function expireRequests(env, now, { tg = null } = {}) {
  const db = env.DB;
  const r = tg ? await db.prepare("UPDATE rpg_trade_requests SET status = 'expired', decided_at = ? WHERE status = 'pending' AND expires_at <= ? AND (owner_tg = ? OR requester_tg = ?)").bind(now, now, String(tg), String(tg)).run()
    : await db.prepare("UPDATE rpg_trade_requests SET status = 'expired', decided_at = ? WHERE status = 'pending' AND expires_at <= ?").bind(now, now).run();
  return r?.meta?.changes || 0;
}
export async function pendingCounts(env, tg, now) {
  const db = env.DB; tg = String(tg);
  const [q, p, t] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM rpg_trade_requests WHERE owner_tg = ? AND status = 'pending' AND expires_at > ?").bind(tg, now).first(),
    db.prepare("SELECT COUNT(*) AS n FROM rpg_pk WHERE b_tg = ? AND status = 'pending' AND expires_at > ?").bind(tg, now).first(),
    db.prepare("SELECT COUNT(*) AS n FROM rpg_trades WHERE (a_tg = ? OR b_tg = ?) AND status = 'open' AND expires_at > ?").bind(tg, tg, now).first()]);
  return { requests: q?.n || 0, challenges: p?.n || 0, trades: t?.n || 0 };
}
void SHARE;
