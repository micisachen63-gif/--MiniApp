// v0.5: 分享至群組 photo posts + 超讚, 我要交易 → owner 確認 → window (鎖定 → OK), 赫密士解契卷, 群組決鬥 PK, migration 0004.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { freshDb } from './d1-shim.js';
import { handle } from '../src/index.js';
import { taipeiAt } from '../src/game/time.js';
import { TRADE, SHARE, PK, ITEMS } from '../src/game/constants.js';
import { unbindCost, cardPhoto, CARD_ART, CARD_FRAMES } from '../src/game/share.js';
import { simulateDuel, rollDrop, pkBlock } from '../src/game/pk.js';
import { computeStats } from '../src/game/stats.js';
import { mulberry32 } from '../src/game/rng.js';
import { loadPlayer } from '../src/db.js';
import * as PKS from '../src/services/pk.js';

const SECRET = 'test-secret-0123456789'; const D = '2026-10-08'; const H = 3600e3; const M = 60e3;
function mk() {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true', GROUP_CHAT_ID: '-100123' };
  const call = async (path, body = {}, now = T0) => {
    const res = await handle(new Request(`http://rpg${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(now) }, body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  return { env, call, sql: (q, ...p) => env.DB.sqlite.prepare(q).run(...p), one: (q, ...p) => env.DB.sqlite.prepare(q).get(...p), all: (q, ...p) => env.DB.sqlite.prepare(q).all(...p) };
}
const T0 = taipeiAt(D, 8);
async function three() {
  const k = mk();
  await k.call('/rpg/create', { tgId: '501', name: '甲甲', gender: 'f', baseClass: 'sword' }, T0);
  await k.call('/rpg/create', { tgId: '502', name: '乙乙', gender: 'm', baseClass: 'mage' }, T0);
  await k.call('/rpg/create', { tgId: '503', name: '丙丙', gender: 'f', baseClass: 'archer' }, T0);
  k.sql("UPDATE rpg_characters SET gold = 500000, level = 30, idle_state = 'reviving', state_until = ? WHERE tg_id IN ('501','502','503')", T0 + 1000 * H);
  return k;
}
const gold = (k, tg) => k.one('SELECT gold FROM rpg_characters WHERE tg_id = ?', tg).gold;
const inv = (k, tg, item) => k.one('SELECT quantity FROM rpg_inventory WHERE tg_id = ? AND item = ?', tg, item)?.quantity || 0;
const buy = async (k, tg, code, t, rid) => (await k.call('/rpg/buy-gear', { tgId: tg, code, requestId: rid }, t)).result.item.id;
/** owner shares → requester 我要交易 → owner 確認 → trade view */
async function openVia(k, owner, requester, equipId, t) {
  const s = await k.call('/rpg/share', { tgId: owner, equipId }, t); assert.equal(s.ok, true, s.message);
  const q = await k.call('/rpg/trade/request', { tgId: requester, shareId: s.share.id }, t); assert.equal(q.ok, true, q.message);
  const a = await k.call('/rpg/trade/accept', { tgId: owner, reqId: q.request.id }, t); assert.equal(a.ok, true, a.message);
  return { share: s.share, request: q.request, trade: a.trade };
}

// ------------------------------------------------------------------------------------------- share + like
test('share: photo snapshot, equipped/bound showcase, rate limits and 超讚 toggle', async () => {
  const k = await three(); let t = T0 + M;
  const ring = await buy(k, '501', 'a.ring.1', t, 'g1');
  const r = await k.call('/rpg/share', { tgId: '501', equipId: ring }, t); assert.equal(r.ok, true);
  const s = r.share; assert.equal(s.kind, 'share'); assert.equal(s.ownerName, '甲甲'); assert.equal(s.tradeable, true); assert.equal(s.item.slot, 'ring');
  assert.match(s.item.photo, /^\/art\/cards\/equipment-20261011-r2\/gear_ring_laurel_(common|advanced|epic|legendary|supreme)\.jpg$/);
  const ob = (await k.call('/rpg/outbox/claim', {}, t)).items.find((i) => i.kind === 'share'); assert.equal(ob.target, 'group'); assert.equal(ob.payload.share.id, s.id);
  for (const k2 of ['name', 'rarityName', 'slotName', 'className', 'tier', 'enhance', 'stat', 'statName', 'bound']) assert.ok(k2 in s.item, k2);
  assert.equal((await k.call('/rpg/share', { tgId: '501', equipId: ring }, t + 5e3)).error, 'cooldown', '60 s per player');
  assert.equal((await k.call('/rpg/share', { tgId: '501', equipId: ring }, t + 2 * M)).error, 'cooldown', 'same item 10 min');
  // Equipped and bound gear can be showcased without changing trade restrictions.
  const ring2 = await buy(k, '501', 'a.ring.1', t, 'g2'); await k.call('/rpg/equip', { tgId: '501', itemId: ring2 }, t);
  const worn = await k.call('/rpg/share', { tgId: '501', equipId: ring2 }, t + 3 * M); assert.equal(worn.ok,true);assert.equal(worn.share.showcase,true);assert.equal(worn.share.requestable,false);assert.equal(worn.share.item.equipped,true);
  await k.call('/rpg/unequip', { tgId: '501', itemId: ring2 }, t + 3 * M);
  const bound = await k.call('/rpg/share', { tgId: '501', equipId: ring2 }, t + 14 * M);assert.equal(bound.ok,true);assert.equal(bound.share.showcase,true);
  const me = await k.call('/rpg/me', { tgId: '501' }, t + 4 * M); const v = me.equipment.find((e) => e.id === ring2);
  assert.equal(v.shareBlock,null);assert.ok(v.tradeBlock && v.unbindBlock === null && v.unbindCost >= 1, 'view enables sharing and retains trade/unbind rules');
  assert.equal((await k.call('/rpg/share', { tgId: '502', equipId: ring }, t + 5 * M)).ok, false, 'not the owner');
  // likes: one per user, toggle
  let L = await k.call('/rpg/share/like', { tgId: '502', shareId: s.id }, t); assert.deepEqual([L.liked, L.likes], [true, 1]);
  L = await k.call('/rpg/share/like', { tgId: '777', shareId: s.id }, t); assert.equal(L.likes, 2, 'no character needed');
  L = await k.call('/rpg/share/like', { tgId: '502', shareId: s.id }, t); assert.deepEqual([L.liked, L.likes], [false, 1]);
  await Promise.all([1, 2, 3].map(() => k.call('/rpg/share/like', { tgId: '503', shareId: s.id }, t)));
  assert.ok([1, 2].includes(k.one('SELECT likes FROM rpg_shares WHERE id = ?', s.id).likes));
  assert.equal(k.one('SELECT COUNT(*) n FROM rpg_share_likes WHERE share_id = ?', s.id).n, k.one('SELECT likes FROM rpg_shares WHERE id = ?', s.id).likes);
  // daily cap
  k.sql("INSERT INTO rpg_daily_counters (tg_id,day,key,n) VALUES ('503',?, 'share', ?)", D, SHARE.dailyCap);
  const bow = await buy(k, '503', 'a.ring.1', t, 'g3'); assert.equal((await k.call('/rpg/share', { tgId: '503', equipId: bow }, t)).error, 'daily_limit');
});

// ------------------------------------------------------------------------------------------- requests
test('我要交易: owner DM + badge, duplicate/self blocked, reject, 24h expiry, accept pre-places the item', async () => {
  const k = await three(); const t = T0 + M;
  const ring = await buy(k, '501', 'a.ring.1', t, 'g1');
  const s = (await k.call('/rpg/share', { tgId: '501', equipId: ring }, t)).share;
  assert.equal((await k.call('/rpg/trade/request', { tgId: '501', shareId: s.id }, t)).error, 'self');
  assert.equal((await k.call('/rpg/trade/request', { tgId: '999', shareId: s.id }, t)).error, 'no_character');
  const q = await k.call('/rpg/trade/request', { tgId: '502', shareId: s.id }, t); assert.equal(q.request.status, 'pending');
  assert.equal((await k.call('/rpg/trade/request', { tgId: '502', shareId: s.id }, t)).error, 'duplicate');
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='trade_request' AND tg_id='501' AND target='dm'"), 'owner DM');
  assert.equal((await k.call('/rpg/me', { tgId: '501' }, t)).badges.requests, 1, 'in-app badge');
  const q3 = await k.call('/rpg/trade/request', { tgId: '503', shareId: s.id }, t);
  assert.equal((await k.call('/rpg/trade/accept', { tgId: '502', reqId: q.request.id }, t)).error, 'not_party', 'only the owner confirms');
  assert.equal((await k.call('/rpg/trade/reject', { tgId: '501', reqId: q3.request.id }, t)).request.status, 'rejected');
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='trade_rejected' AND tg_id='503'"));
  const a = await k.call('/rpg/trade/accept', { tgId: '501', reqId: q.request.id }, t); assert.equal(a.ok, true); assert.equal(a.prePlaced, true);
  const tr = a.trade; assert.equal(tr.a.tgId, '501', 'initiator = owner (top)'); assert.equal(tr.b.tgId, '502', 'acceptor = requester (bottom)');
  assert.equal(tr.a.lines[0].ref, ring); assert.equal(tr.phase, 'placing'); assert.equal(k.one('SELECT trade_id FROM rpg_equipment WHERE id = ?', ring).trade_id, tr.id);
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='trade_open' AND tg_id='502'"), 'requester notified');
  assert.equal((await k.call('/rpg/trade/accept', { tgId: '501', reqId: q.request.id }, t)).error, 'closed', 'idempotent');
  // the shared item is now escrowed → the post no longer offers 我要交易
  assert.equal((await k.call('/rpg/share/get', { shareId: s.id }, t)).share.tradeable, false);
  // 24h expiry of an unanswered request
  const ring2 = await buy(k, '502', 'a.ring.1', t, 'g2'); const s2 = (await k.call('/rpg/share', { tgId: '502', equipId: ring2 }, t)).share;
  const q2 = await k.call('/rpg/trade/request', { tgId: '503', shareId: s2.id }, t);
  await k.call('/rpg/dev/cron', {}, t + TRADE.requestTtlMs + M);
  assert.equal(k.one('SELECT status FROM rpg_trade_requests WHERE id = ?', q2.request.id).status, 'expired');
  assert.equal((await k.call('/rpg/trade/withdraw', { tgId: '503', reqId: q2.request.id }, t)).error, 'closed');
});

// ------------------------------------------------------------------------------------------- window
test('window: place → 鎖定 (locked side frozen) → OK only when both locked → atomic swap, 5% tax, post marked 成交', async () => {
  const k = await three(); const t = T0 + M;
  const ring = await buy(k, '501', 'a.ring.1', t, 'g1'); const belt = await buy(k, '501', 'a.belt.1', t, 'g2');
  const g501 = gold(k, '501'), g502 = gold(k, '502'), red502 = inv(k, '502', 'red_1'), red501 = inv(k, '501', 'red_1');
  const { trade, share } = await openVia(k, '501', '502', ring, t); const id = trade.id;
  let r = await k.call('/rpg/trade/add', { tgId: '501', tradeId: id, equipId: belt }, t); assert.equal(r.trade.a.lines.length, 2);
  r = await k.call('/rpg/trade/remove', { tgId: '501', tradeId: id, equipId: belt }, t); assert.equal(r.trade.a.lines.length, 1, 'shared item can be changed until locking');
  r = await k.call('/rpg/trade/gold', { tgId: '502', tradeId: id, gold: 10001 }, t); assert.equal(gold(k, '502'), g502 - 10001, 'gold escrowed');
  r = await k.call('/rpg/trade/add', { tgId: '502', tradeId: id, item: 'red_1', qty: 40, requestId: 'retry-safe-add' }, t); assert.equal(inv(k, '502', 'red_1'), red502 - 40);
  const retryAdd = await k.call('/rpg/trade/add', { tgId: '502', tradeId: id, item: 'red_1', qty: 40, requestId: 'retry-safe-add' }, t);
  assert.equal(retryAdd.ok, true, 'a network retry replays the original result'); assert.equal(inv(k, '502', 'red_1'), red502 - 40); assert.equal(retryAdd.trade.b.lines.find((l) => l.name === '紅色藥水').qty, 40);
  assert.equal((await k.call('/rpg/trade/confirm', { tgId: '501', tradeId: id }, t)).error, 'not_locked', 'OK disabled until both locked');
  r = await k.call('/rpg/trade/lock', { tgId: '501', tradeId: id }, t); assert.equal(r.trade.a.locked, true); assert.equal(r.trade.phase, 'one_locked');
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='trade_locked' AND tg_id='502'"));
  assert.equal((await k.call('/rpg/trade/add', { tgId: '501', tradeId: id, equipId: belt }, t)).error, 'locked');
  assert.equal((await k.call('/rpg/trade/remove', { tgId: '501', tradeId: id, equipId: ring }, t)).error, 'locked');
  assert.equal((await k.call('/rpg/trade/gold', { tgId: '501', tradeId: id, gold: 5 }, t)).error, 'locked');
  assert.equal((await k.call('/rpg/trade/confirm', { tgId: '502', tradeId: id }, t)).error, 'not_locked');
  r = await k.call('/rpg/trade/add', { tgId: '502', tradeId: id, item: 'red_1', qty: 10 }, t); assert.equal(r.ok, true, 'unlocked side can still change');
  r = await k.call('/rpg/trade/lock', { tgId: '502', tradeId: id }, t); assert.equal(r.trade.phase, 'ready');
  assert.equal(k.all("SELECT 1 FROM rpg_outbox WHERE kind='trade_ready'").length, 2);
  r = await k.call('/rpg/trade/confirm', { tgId: '502', tradeId: id }, t); assert.equal(r.trade.phase, 'ok_wait'); assert.equal(r.trade.status, 'open');
  r = await k.call('/rpg/trade/confirm', { tgId: '501', tradeId: id }, t); assert.equal(r.trade.status, 'done');
  assert.equal(k.one('SELECT tg_id FROM rpg_equipment WHERE id = ?', ring).tg_id, '502');
  assert.equal(gold(k, '501'), g501 + 9500, 'receiver gets gold − ceil(5%)'); assert.equal(inv(k, '501', 'red_1') - red501, 50); assert.equal(r.trade.taxGold, 501);
  assert.equal(k.one('SELECT status FROM rpg_shares WHERE id = ?', share.id).status, 'traded');
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='share_update'")); assert.equal(k.all("SELECT 1 FROM rpg_outbox WHERE kind='trade_end'").length, 2, 'DM both');
  assert.equal((await k.call('/rpg/trade/confirm', { tgId: '501', tradeId: id }, t)).error, 'closed', 'retry after done');
  assert.equal(gold(k, '501'), g501 + 9500, 'no duplication');
  assert.ok((await k.call('/rpg/trade/log', { tgId: '502', tradeId: id }, t)).log.some((l) => l.action === 'lock'));
});

test('window: concurrent final OK settles once; cancel / 30-min idle expiry return everything; rules and limits', async () => {
  const k = await three(); let t = T0 + M;
  const rings = []; for (let i = 0; i < 4; i++) rings.push(await buy(k, '501', 'a.ring.1', t, `r${i}`));
  let { trade } = await openVia(k, '501', '502', rings[0], t);
  await k.call('/rpg/trade/gold', { tgId: '502', tradeId: trade.id, gold: 1000 }, t);
  await k.call('/rpg/trade/lock', { tgId: '501', tradeId: trade.id }, t); await k.call('/rpg/trade/lock', { tgId: '502', tradeId: trade.id }, t);
  await k.call('/rpg/trade/confirm', { tgId: '501', tradeId: trade.id }, t); const g501 = gold(k, '501');
  const rs = await Promise.all([1, 2, 3].map(() => k.call('/rpg/trade/confirm', { tgId: '502', tradeId: trade.id }, t)));
  assert.ok(rs.some((x) => x.ok)); assert.equal(gold(k, '501'), g501 + 950, 'exactly one settlement');
  // cancel returns everything
  t += 2 * M; const red = inv(k, '501', 'red_1'); const g = gold(k, '501');
  ({ trade } = await openVia(k, '501', '503', rings[1], t));
  await k.call('/rpg/trade/add', { tgId: '501', tradeId: trade.id, item: 'red_1', qty: 25 }, t); await k.call('/rpg/trade/gold', { tgId: '501', tradeId: trade.id, gold: 777 }, t);
  await k.call('/rpg/trade/lock', { tgId: '501', tradeId: trade.id }, t);
  assert.equal((await k.call('/rpg/trade/cancel', { tgId: '503', tradeId: trade.id }, t)).trade.status, 'cancelled', 'either side, any time before both OK');
  assert.equal(inv(k, '501', 'red_1'), red); assert.equal(gold(k, '501'), g); assert.equal(k.one('SELECT trade_id FROM rpg_equipment WHERE id = ?', rings[1]).trade_id, null);
  // 30-min idle expiry (activity extends it)
  t += 12 * M; ({ trade } = await openVia(k, '501', '503', rings[2], t)); const id = trade.id;
  await k.call('/rpg/trade/add', { tgId: '503', tradeId: id, item: 'red_1', qty: 5 }, t + 25 * M);
  assert.equal(k.one('SELECT status FROM rpg_trades WHERE id = ?', id).status, 'open'); const r503 = inv(k, '503', 'red_1');
  await k.call('/rpg/dev/cron', {}, t + 25 * M + TRADE.idleMs + M);
  assert.equal(k.one('SELECT status FROM rpg_trades WHERE id = ?', id).status, 'expired'); assert.equal(inv(k, '503', 'red_1'), r503 + 5);
  assert.equal(k.one('SELECT trade_id FROM rpg_equipment WHERE id = ?', rings[2]).trade_id, null);
  // rules inside a window
  t += 2 * H; ({ trade } = await openVia(k, '501', '502', rings[3], t)); const w = trade.id;
  const starter = k.one("SELECT id FROM rpg_equipment WHERE tg_id='502' AND slot='weapon'").id;
  assert.match((await k.call('/rpg/trade/add', { tgId: '502', tradeId: w, equipId: starter }, t)).message, /卸下/, 'equipped not tradeable');
  await k.call('/rpg/unequip', { tgId: '502', itemId: starter }, t);
  assert.equal((await k.call('/rpg/trade/add', { tgId: '502', tradeId: w, equipId: starter }, t)).ok, false, 'starter bound');
  k.sql("INSERT INTO rpg_inventory (tg_id,item,quantity) VALUES ('502','ward',2) ON CONFLICT(tg_id,item) DO UPDATE SET quantity = 2");
  assert.equal((await k.call('/rpg/trade/add', { tgId: '502', tradeId: w, item: 'ward', qty: 1 }, t)).ok, true, 'unbound inventory items, including wards, are tradeable');
  assert.equal((await k.call('/rpg/trade/gold', { tgId: '502', tradeId: w, gold: TRADE.maxGold + 1 }, t)).ok, false, 'gold cap');
  k.sql("UPDATE rpg_characters SET gold = 5 WHERE tg_id = '502'");
  assert.equal((await k.call('/rpg/trade/gold', { tgId: '502', tradeId: w, gold: 6 }, t)).ok, false, 'gold cannot go negative'); assert.equal(gold(k, '502'), 5);
  assert.equal((await k.call('/rpg/trade/add', { tgId: '503', tradeId: w, item: 'red_1', qty: 1 }, t)).error, 'not_party');
  assert.equal((await k.call('/rpg/equip', { tgId: '501', itemId: rings[3] }, t)).ok, false, 'escrowed item cannot be equipped');
  assert.equal((await k.call('/rpg/trade/open', { tgId: '501', target: { tgId: '502' } }, t)).error, 'not_found', 'old direct-open route removed');
  // max open trades per player (3)
  for (let i = 0; i < 2; i++) { t += 2 * M; const x = await buy(k, '503', 'a.ring.1', t, `m${i}`); await openVia(k, '503', '501', x, t); }
  t += 2 * M; const x = await buy(k, "503", "a.ring.1", t, "m9"); const s = (await k.call('/rpg/share', { tgId: '503', equipId: x }, t)).share;
  const q = await k.call('/rpg/trade/request', { tgId: '501', shareId: s.id }, t);
  assert.equal((await k.call('/rpg/trade/accept', { tgId: '503', reqId: q.request.id }, t)).error, 'too_many', 'max 3 open');
});

// ------------------------------------------------------------------------------------------- unbind
test('赫密士解契卷: cost by tier/rarity/relic/enhance, only bound + unequipped + non-starter, then tradeable again', async () => {
  const base = { tier: 2, element_tier: 'common', grade: 'normal', enhance_level: 0 };
  assert.equal(unbindCost(base), 2); assert.equal(unbindCost({ ...base, element_tier: 'epic' }), 4); assert.equal(unbindCost({ ...base, element_tier: 'supreme' }), 8);
  assert.equal(unbindCost({ ...base, grade: 'relic', element_tier: 'advanced' }), 6); assert.equal(unbindCost({ ...base, grade: 'relic', element_tier: 'supreme' }), 24);
  assert.equal(unbindCost({ ...base, enhance_level: 7 }), 4); assert.equal(unbindCost({ tier: 1, element_tier: 'common' }), 1);
  assert.equal(ITEMS.unbind.price, 500);
  const k = await three(); const t = T0 + M;
  const ring = await buy(k, '501', 'a.ring.1', t, 'g1'); await k.call('/rpg/equip', { tgId: '501', itemId: ring }, t);
  assert.equal((await k.call('/rpg/unbind', { tgId: '501', itemId: ring }, t)).error, 'cannot_unbind', 'equipped');
  await k.call('/rpg/unequip', { tgId: '501', itemId: ring }, t);
  const need = (await k.call('/rpg/me', { tgId: '501' }, t)).equipment.find((e) => e.id === ring).unbindCost;
  assert.equal((await k.call('/rpg/unbind', { tgId: '501', itemId: ring }, t)).error, 'insufficient');
  const shop = await k.call('/rpg/shop', { tgId: '501' }, t); assert.ok(shop.shop.items.some((i) => i.item === 'unbind'), 'sold in the shop');
  await k.call('/rpg/buy', { tgId: '501', item: 'unbind', qty: need + 1, requestId: 'b1' }, t);
  const r = await k.call('/rpg/unbind', { tgId: '501', itemId: ring, requestId: 'u1' }, t); assert.equal(r.ok, true); assert.equal(r.result.used, need);
  assert.equal(inv(k, '501', 'unbind'), 1); assert.equal(k.one('SELECT bound FROM rpg_equipment WHERE id = ?', ring).bound, 0);
  assert.equal((await k.call('/rpg/share', { tgId: '501', equipId: ring }, t)).ok, true, 'shareable again');
  assert.equal((await k.call('/rpg/unbind', { tgId: '501', itemId: ring }, t)).error, 'cannot_unbind', 'not bound any more');
  const starter = k.one("SELECT id FROM rpg_equipment WHERE tg_id='501' AND slot='armor' AND source='starter'").id; await k.call('/rpg/unequip', { tgId: '501', itemId: starter }, t);
  assert.match((await k.call('/rpg/unbind', { tgId: '501', itemId: starter }, t)).message, /新手/);
});

// ------------------------------------------------------------------------------------------- PK
test('PK rules: level gate, level gap, duel sim deterministic per seed, drop roll with ward', () => {
  const c = (lv) => ({ tg_id: String(lv), level: lv });
  assert.equal(pkBlock(c(9), c(12))[0], 'level'); assert.equal(pkBlock(c(15), c(26))[0], 'level_gap'); assert.equal(pkBlock(c(15), c(25)), null);
  const sa = computeStats({ base_class: 'sword', class_path: '' }, [], 20), sb = computeStats({ base_class: 'mage', class_path: '' }, [], 20);
  const r1 = simulateDuel(sa, sb, mulberry32(5)), r2 = simulateDuel(sa, sb, mulberry32(5)); assert.deepEqual(r1, r2);
  assert.ok(r1.rounds >= 2 && r1.rounds <= PK.maxRounds); assert.ok(r1.log.every((s) => s.dmg >= 1));
  let wins = 0; for (let i = 0; i < 400; i++) if (simulateDuel(sa, sb, mulberry32(i)).winner === 'a') wins++; assert.ok(wins > 40 && wins < 360, `balanced-ish ${wins}`);
  let drops = 0, wards = 0; const eq = [{ id: 'x' }, { id: 'y' }];
  for (let i = 0; i < 5000; i++) { const d = rollDrop(mulberry32(i * 7 + 1), eq, i % 2); if (d.drop) { drops++; if (d.ward) wards++; else assert.ok(d.item); } }
  assert.ok(Math.abs(drops / 5000 - PK.dropChance) < 0.02, String(drops)); assert.ok(Math.abs(wards / drops - 0.5) < 0.06);
});

/** a seed whose duel ends with a gear drop for this pk (replays the service's exact rng sequence) */
async function dropSeed(k, pkId, wantWard = false) {
  const p = k.one('SELECT * FROM rpg_pk WHERE id = ?', pkId);
  const [A, B] = await Promise.all([loadPlayer(k.env.DB, p.a_tg), loadPlayer(k.env.DB, p.b_tg)]);
  const ea = A.equipment.filter((e) => e.is_equipped), eb = B.equipment.filter((e) => e.is_equipped);
  for (let seed = 1; seed < 5000; seed++) {
    const rng = mulberry32(seed); const s = simulateDuel(computeStats(A.char, ea), computeStats(B.char, eb), rng);
    const L = s.winner === 'a' ? B : A; const d = rollDrop(rng, (s.winner === 'a' ? eb : ea), L.inv.ward || 0);
    if (d.drop && !!d.ward === wantWard) return { seed, winner: s.winner };
  }
  throw new Error('no seed');
}
test('PK flow: challenge (group card + DM) → accept → duel; 20% drop → winner bag unbound + photo post; ward absorbs; caps & cooldown', async () => {
  const k = await three(); let t = T0 + M;
  k.sql("UPDATE rpg_characters SET idle_state = 'fighting', state_until = NULL WHERE tg_id IN ('501','502','503')");
  k.sql("INSERT INTO rpg_inventory (tg_id,item,quantity) VALUES ('501','red_1',50000),('501','blue_1',50000),('502','red_1',50000),('502','blue_1',50000) ON CONFLICT(tg_id,item) DO UPDATE SET quantity = excluded.quantity");
  assert.equal((await k.call('/rpg/pk/challenge', { tgId: '501', target: { tgId: '501' } }, t)).error, 'self');
  k.sql("UPDATE rpg_characters SET level = 5 WHERE tg_id = '503'");
  assert.equal((await k.call('/rpg/pk/challenge', { tgId: '501', target: { name: '丙丙' } }, t)).error, 'level');
  let c = await k.call('/rpg/pk/challenge', { tgId: '501', target: { name: '乙乙' } }, t); assert.equal(c.ok, true); const id = c.pk.id;
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='pk_card' AND target='group'"), 'app challenge → group card');
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='pk_challenge' AND tg_id='502'"), 'DM to the challenged');
  assert.equal((await k.call('/rpg/pk/challenge', { tgId: '501', target: { name: '乙乙' } }, t)).error, 'duplicate');
  assert.equal((await k.call('/rpg/pk/accept', { tgId: '501', pkId: id }, t)).error, 'self', 'challenger cannot accept');
  assert.equal((await k.call('/rpg/me', { tgId: '502' }, t)).badges.challenges, 1);
  // accept with a seed that makes the loser drop gear
  const { seed, winner } = await dropSeed(k, id); const W = winner === 'a' ? '501' : '502', L = winner === 'a' ? '502' : '501';
  const lostBefore = k.all('SELECT id FROM rpg_equipment WHERE tg_id = ? AND is_equipped > 0', L).map((r) => r.id);
  const v = await PKS.accept(k.env, { tgId: '502', pkId: id }, t, seed); assert.equal(v.status, 'done'); assert.ok(v.drop);
  const moved = k.one('SELECT * FROM rpg_equipment WHERE id = ?', v.drop.id); assert.ok(lostBefore.includes(v.drop.id));
  assert.equal(moved.tg_id, W); assert.equal(moved.is_equipped, 0); assert.equal(moved.bound, 0, 'dropped item becomes UNBOUND');
  const post = k.one("SELECT * FROM rpg_shares WHERE kind = 'pk'"); assert.equal(post.tg_id, W); assert.equal(post.tradeable, 1);
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='share' AND payload_json LIKE ?", `%${post.id}%`), 'photo announcement');
  assert.ok(k.one("SELECT 1 x FROM rpg_outbox WHERE kind='pk_result' AND target='group'")); assert.equal(k.all("SELECT 1 FROM rpg_outbox WHERE kind='pk_result' AND target='dm'").length, 2);
  assert.ok(k.all('SELECT * FROM rpg_ledger WHERE event_id LIKE ?', `pk:${id}:%`).length === 2);
  // buy-back via the normal trade flow: winner can share it
  assert.equal((await k.call('/rpg/share', { tgId: W, equipId: v.drop.id }, t + 2 * M)).ok, true);
  // pair cooldown 12h
  assert.equal((await k.call('/rpg/pk/challenge', { tgId: '502', target: { tgId: '501' } }, t + H)).error, 'cooldown');
  // ward absorbs the drop (consumed), gear stays
  k.sql("UPDATE rpg_characters SET level = 30 WHERE tg_id = '503'");
  k.sql("INSERT INTO rpg_inventory (tg_id,item,quantity) VALUES ('503','ward',1),('501','ward',1),('503','red_1',50000),('503','blue_1',50000) ON CONFLICT(tg_id,item) DO UPDATE SET quantity = excluded.quantity");
  await k.call('/rpg/me', { tgId: '501' }, t + 2 * H); await k.call('/rpg/me', { tgId: '503' }, t + 2 * H);
  c = await k.call('/rpg/pk/challenge', { tgId: '503', target: { tgId: '501' } }, t + 2 * H);
  const ws = await dropSeed(k, c.pk.id, true); const loser = ws.winner === 'a' ? '501' : '503'; const n0 = k.all('SELECT 1 FROM rpg_equipment WHERE tg_id = ?', loser).length;
  const v2 = await PKS.accept(k.env, { tgId: '501', pkId: c.pk.id }, t + 2 * H, ws.seed); assert.equal(v2.wardUsed, true); assert.equal(v2.drop, null);
  assert.equal(inv(k, loser, 'ward'), 0); assert.equal(k.all('SELECT 1 FROM rpg_equipment WHERE tg_id = ?', loser).length, n0);
  // decline / cancel / expiry
  k.sql("DELETE FROM rpg_pk WHERE status = 'done'");
  c = await k.call('/rpg/pk/challenge', { tgId: '501', target: { tgId: '502' } }, t + 3 * H);
  assert.equal((await k.call('/rpg/pk/decline', { tgId: '502', pkId: c.pk.id }, t + 3 * H)).pk.status, 'declined');
  c = await k.call('/rpg/pk/challenge', { tgId: '501', target: { tgId: '502' } }, t + 3 * H);
  assert.equal((await k.call('/rpg/pk/decline', { tgId: '501', pkId: c.pk.id }, t + 3 * H)).pk.status, 'cancelled');
  c = await k.call('/rpg/pk/challenge', { tgId: '501', target: { tgId: '502' } }, t + 3 * H);
  await k.call('/rpg/dev/cron', {}, t + 3 * H + PK.challengeTtlMs + M); assert.equal(k.one('SELECT status FROM rpg_pk WHERE id = ?', c.pk.id).status, 'expired');
  // daily cap
  k.sql("INSERT INTO rpg_daily_counters (tg_id,day,key,n) VALUES ('502',?,'pk',?) ON CONFLICT(tg_id,day,key) DO UPDATE SET n = excluded.n", D, PK.dailyCap);
  assert.equal((await k.call('/rpg/pk/challenge', { tgId: '501', target: { tgId: '502' } }, t + 4 * H)).error, 'daily_limit');
  const L2 = await k.call('/rpg/pk/list', { tgId: '501' }, t + 4 * H); assert.ok(L2.history.length >= 3);
});

// ------------------------------------------------------------------------------------------- art + migration
test('item-card photos exist for every gear art × rarity frame (Telegram sendPhoto JPG)', () => {
  const dir = new URL('../public/art/cards/', import.meta.url);
  for (const a of CARD_ART) for (const f of CARD_FRAMES) assert.ok(existsSync(new URL(`${a}_${f}.jpg`, dir)), `${a}_${f}.jpg`);
  assert.equal(cardPhoto({ slot: 'weapon', kind: 'crossbow', element_tier: 'epic', grade: 'normal' }), '/art/cards/wpn_crossbow_epic.jpg');
  assert.equal(cardPhoto({ slot: 'helmet', class_req: 'mage', element_tier: 'advanced', grade: 'relic' }), '/art/cards/helm_cloth_relic.jpg');
});
test('migration 0004 on v0.4 prod-like data: additive (trades get lock columns, new tables), 白色毛衣 untouched', () => {
  const dbx = new DatabaseSync(':memory:'); const mig = (f) => dbx.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  for (const f of ['0001_init.sql', '0002_app_access.sql', '0003_gear_v04_trade.sql']) mig(f);
  dbx.exec("INSERT INTO rpg_characters (tg_id,name,gender,base_class,class_path,level,exp,hp,mp,map_id,idle_state,auto_red_pct,auto_blue,gold,last_settle_at,created_day,created_at,updated_at,rev) VALUES ('489706404','白色毛衣','f','archer','',4,0,100,50,1,'fighting',50,1,2013,0,'2026-10-07',0,0,0)");
  dbx.exec("INSERT INTO rpg_equipment (id,tg_id,slot,kind,class_req,tier,level_req,name,source,base_stat,is_equipped,created_at,bound) VALUES ('w','489706404','weapon','longbow','archer',1,1,'練習短弓','starter',12,1,0,1)");
  dbx.exec("INSERT INTO rpg_trades (id,a_tg,b_tg,created_at,updated_at,expires_at) VALUES ('t1','1','2',0,0,1)");
  mig('0004_v05_share_pk.sql');
  const t = dbx.prepare("SELECT a_lock, b_lock, share_id FROM rpg_trades WHERE id='t1'").get(); assert.deepEqual({ ...t }, { a_lock: 0, b_lock: 0, share_id: null });
  for (const tb of ['rpg_shares', 'rpg_share_likes', 'rpg_trade_requests', 'rpg_pk']) assert.ok(dbx.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(tb), tb);
  assert.equal(dbx.prepare("SELECT name FROM rpg_equipment WHERE tg_id='489706404'").get().name, '練習短弓');
  assert.equal(dbx.prepare("SELECT gold FROM rpg_characters WHERE tg_id='489706404'").get().gold, 2013);
});
