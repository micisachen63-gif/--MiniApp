// End-to-end through the Worker fetch handler with an in-memory D1 (node:sqlite), migrations applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { handle, runCron } from '../src/index.js';
import { loadPlayer, persistStatements, clonePlayer, classifyDbError } from '../src/db.js';
import { taipeiAt } from '../src/game/time.js';
import { expToNext } from '../src/game/formulas.js';

const SECRET = 'test-secret-0123456789';
const D = '2026-10-08'; const M = 60_000; const H = 60 * M;
function mk(envOver = {}) {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true', GROUP_CHAT_ID: '-100123', ...envOver };
  const call = async (path, body = {}, now = taipeiAt(D, 8), headers = {}) => {
    const res = await handle(new Request(`http://rpg${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(now), ...headers }, body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  return { env, call, sql: (q, ...p) => env.DB.sqlite.prepare(q).run(...p), one: (q, ...p) => env.DB.sqlite.prepare(q).get(...p) };
}
const create = (call, tgId, name, baseClass = 'sword', now) => call('/rpg/create', { tgId, name, gender: 'f', baseClass, tgName: name }, now);

test('auth: health is public; wrong/missing secret rejected; unconfigured secret → 503', async () => {
  const { env } = mk();
  assert.equal((await handle(new Request('http://rpg/health'), env)).status, 200);
  assert.equal((await handle(new Request('http://rpg/rpg/me', { method: 'POST', body: '{}' }), env)).status, 401);
  assert.equal((await handle(new Request('http://rpg/rpg/me', { method: 'POST', headers: { 'X-Service-Secret': 'nope' }, body: '{}' }), env)).status, 401);
  assert.equal((await handle(new Request('http://rpg/rpg/me', { method: 'POST', headers: { 'X-Service-Secret': 'x' }, body: '{}' }), { ...env, SERVICE_SECRET: '' })).status, 503);
});

test('create → starter kit; duplicate / bad name rejected; debug time ignored in production', async () => {
  const { call, env, one } = mk(); const future = taipeiAt('2027-01-01', 8);
  const r = await create(call, '1001', '小明', 'sword', future);
  assert.equal(r.ok, true); assert.equal(r.character.level, 1); assert.equal(r.character.gold, 1000);
  assert.equal(r.inventory.red_1, 150); assert.equal(r.equipment.filter((e) => e.equipped).length, 2); assert.equal(r.character.className, '劍士');
  const second = await create(call, '1001', '小明二', 'mage', future);
  assert.equal(second.ok,true);
  assert.equal(one('SELECT COUNT(*) n FROM rpg_characters WHERE account_tg_id=?','1001').n,2);
  assert.equal(second.character.tgId,r.character.tgId,'create response retains the currently selected character');
  assert.equal((await call('/rpg/me',{tgId:'1001'},future)).character.name,'小明');
  for(const name of ['小明三','小明四']) assert.equal((await create(call,'1001',name,'sword',future)).ok,true);
  assert.equal((await create(call,'1001','小明五','sword',future)).error,'character_limit');
  assert.equal((await create(call, '1002', '小明')).error, 'name_taken');
  assert.equal((await create(call, '1003', 'a b')).error, 'name');
  assert.equal((await call('/rpg/me', { tgId: '9999' })).error, 'no_character');
  const prod = await handle(new Request('http://rpg/rpg/me', { method: 'POST', headers: { 'X-Service-Secret': SECRET, 'X-Debug-Now': String(taipeiAt(D, 8) + 48 * H) }, body: JSON.stringify({ tgId: '1001' }) }), { ...env, ENVIRONMENT: 'production' });
  const pj = await prod.json(); assert.equal(pj.ok, true); assert.equal(pj.character.level, 1, 'production ignores X-Debug-Now (real clock is before the 2027 creation time)');
});

test('idle settles lazily on read; daily gold once per day; shop + 守護符 limits; refill; gear', async () => {
  const { call } = mk(); const t0 = taipeiAt(D, 8);
  await create(call, '2001', '阿弓', 'archer', t0);
  const later = await call('/rpg/me', { tgId: '2001' }, t0 + 5 * H);
  assert.ok(later.character.level >= 3); assert.ok(later.report.ticks === 300);
  const d1 = await call('/rpg/daily', { tgId: '2001', requestId: 'r1' }, t0 + 5 * H); assert.equal(d1.ok, true); assert.equal(d1.result.gold, Math.round((600 + 70 * later.character.level) * 1.5));
  const dailyLedger = await call('/rpg/ledger',{tgId:'2001'},t0+5*H);
  assert.ok(dailyLedger.ledger.some(l=>l.type==='每日補給金' && l.gold_delta===d1.result.gold));
  assert.equal((await call('/rpg/daily', { tgId: '2001', requestId: 'r2' }, t0 + 6 * H)).error, 'claimed');
  assert.equal((await call('/rpg/daily', { tgId: '2001', requestId: 'r3' }, t0 + 24 * H)).ok, true, 'next Taipei day');
  const g0 = (await call('/rpg/me', { tgId: '2001' }, t0 + 24 * H)).character.gold;
  const w = await call('/rpg/buy', { tgId: '2001', item: 'ward', qty: 3, requestId: 'w1' }, t0 + 24 * H);
  assert.equal(w.ok, true); assert.equal(w.inventory.ward, 3); assert.equal(w.character.gold, g0 - 1200);
  assert.equal((await call('/rpg/buy', { tgId: '2001', item: 'ward', qty: 1, requestId: 'w2' }, t0 + 24 * H)).error, 'daily_limit');
  assert.equal((await call('/rpg/buy', { tgId: '2001', item: 'ward', qty: 1, requestId: 'w1' }, t0 + 48 * H)).error, 'duplicate', 'same requestId is idempotent');
  const shop = await call('/rpg/shop', { tgId: '2001' }, t0 + 48 * H);
  assert.ok(shop.shop.gear.every((o) => o.code.startsWith('w.longbow') || o.code.startsWith('a.')));
  const ref = await call('/rpg/refill', { tgId: '2001', requestId: 'f1' }, t0 + 48 * H); assert.equal(ref.ok, true); assert.ok(ref.supply.redHours >= 23 || ref.result.partial);
  const buy = await call('/rpg/buy-gear', { tgId: '2001', code: 'a.boots.1', requestId: 'g1' }, t0 + 48 * H);
  assert.equal(buy.ok, true); const boots = buy.equipment.find((e) => e.slot === 'boots');
  assert.equal((await call('/rpg/equip', { tgId: '2001', itemId: boots.id }, t0 + 48 * H)).equipment.find((e) => e.id === boots.id).equipped, true);
  assert.equal((await call('/rpg/buy-gear', { tgId: '2001', code: 'w.sword.1', requestId: 'g2' }, t0 + 48 * H)).error, 'not_sold');
  assert.equal((await call('/rpg/settings', { tgId: '2001', autoRedPct: 90 }, t0 + 48 * H)).error, 'range');
  const led = await call('/rpg/ledger', { tgId: '2001' },t0+48*H); assert.ok(led.ledger.length>0 && led.ledger.length<=15);
});

test('optimistic lock: a stale write aborts the whole batch; CHECK stops negative inventory', async () => {
  const { call, env, sql, one } = mk(); await create(call, '3001', '鎖鎖');
  const before = await loadPlayer(env.DB, '3001'); const after = clonePlayer(before); after.char.gold += 5; after.inv.red_1 -= 1;
  sql('UPDATE rpg_characters SET rev = rev + 1 WHERE tg_id = ?', '3001');
  await assert.rejects(env.DB.batch(persistStatements(env.DB, before, after, {}, Date.now())), (e) => classifyDbError(e)?.code === 'conflict');
  assert.equal(one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?', '3001', 'red_1').quantity, 150, 'rolled back');
  const fresh = await loadPlayer(env.DB, '3001'); const neg = clonePlayer(fresh); neg.inv.red_1 = -1;
  await assert.rejects(env.DB.batch(persistStatements(env.DB, fresh, neg, {}, Date.now())), (e) => classifyDbError(e)?.code === 'insufficient');
});

test('scheduled boss: spawn at 09:00 → attack windows → HP scaling → kill → material → advance → re-select', async () => {
  const { call, env, sql, one } = mk(); const t = (h, m = 0) => taipeiAt(D, h, m);
  await create(call, '4001', '甲甲', 'sword', t(8)); await create(call, '4002', '乙乙', 'mage', t(8));
  sql("UPDATE rpg_characters SET level = 30, exp = 0, last_settle_at = ? WHERE tg_id IN ('4001','4002')", t(8, 59));
  assert.equal((await call('/rpg/boss/spawn-due', {}, t(8, 30))).spawn.reason, 'no_slot');
  const sp = await call('/rpg/boss/spawn-due', {}, t(9, 0)); assert.equal(sp.spawn.spawned, true); assert.equal(sp.spawn.tier, 3); assert.ok(['guarantee', 'random'].includes(sp.spawn.reason), sp.spawn.reason);
  assert.equal((await call('/rpg/boss/spawn-due', {}, t(9, 1))).spawn.reason, 'exists', 'idempotent');
  const ob = await call('/rpg/outbox/claim', {}, t(9, 1)); assert.equal(ob.items.length, 1); assert.equal(ob.items[0].kind, 'boss_spawn'); assert.equal(ob.items[0].payload.boss.hp, 7000);
  assert.equal((await call('/rpg/outbox/claim', {}, t(9, 1))).items.length, 0, 'active lease is not double-claimed');
  const retry = await call('/rpg/outbox/claim', {}, t(9, 2) + 60_001); assert.equal(retry.items.length, 1, 'unacknowledged delivery is retried after lease');
  assert.notEqual(retry.items[0].claimToken, ob.items[0].claimToken);
  await call('/rpg/outbox/ack', { ids: [retry.items[0].id], claimToken: retry.items[0].claimToken }, t(9, 2) + 60_002);
  assert.equal((await call('/rpg/outbox/claim', {}, t(9, 2) + 120_003)).items.length, 0, 'acknowledged delivery is not retried');
  const id = sp.spawn.id; assert.equal(id, 'b2026100809');
  await call('/rpg/boss/message', { bossId: id, chatId: '-100123', messageId: 55 });
  const a1 = await call('/rpg/boss/attack', { tgId: '4001', bossId: id }, t(9, 2)); assert.equal(a1.ok, true); assert.ok(a1.result.damage > 0);
  assert.equal((await call('/rpg/boss/attack', { tgId: '4001', bossId: id }, t(9, 2) + 30_000)).error, 'cooldown');
  const a2 = await call('/rpg/boss/attack', { tgId: '4002', bossId: id }, t(9, 4));
  assert.equal(a2.boss.maxHp, 12000, 'second participant adds perPlayer HP'); assert.equal(a2.boss.participants, 2); assert.equal(a2.boss.messageId, 55);
  let killed = null;
  for (let w = 1; w < 10 && !killed; w++) for (const tg of ['4001', '4002']) {
    if (killed) break; const r = await call('/rpg/boss/attack', { tgId: tg, bossId: id }, t(9, 3 * w + 1));
    if (r.ok && r.result.killed) killed = r.result.kill; else if (!r.ok) assert.match(r.error, /down|boss_over/);
  }
  assert.ok(killed, 'boss killed within 30 minutes'); assert.equal(killed.status, 'killed'); assert.equal(killed.materials.length, 2);
  const goldSum = Object.values(killed.gold).reduce((a, b) => a + b, 0); assert.equal(goldSum, 1500 * 3 * 2);
  assert.ok(killed.gear?.itemName);
  assert.equal(one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?', '4001', 'mat_1').quantity, 1);
  const end = await call('/rpg/outbox/claim', {}, t(9, 40)); const kinds = end.items.map((i) => i.kind).sort();
  assert.deepEqual(kinds.filter((k) => !['relic', 'share'].includes(k)), ['boss_end', 'material', 'material']);
  const nRelic = kinds.filter((k) => k === 'relic').length; assert.ok([0, 1].includes(nRelic), 'relic: at most 1 per kill (DM)'); assert.ok(kinds.filter((k) => k === 'share').length >= nRelic, 'group photo posts include relic and boss gear'); assert.equal(end.items.find((i) => i.kind === 'boss_end').payload.boss.status, 'killed');
  // advancement
  const adv = await call('/rpg/advance', { tgId: '4001', branch: 'A', requestId: 'adv1' }, t(9, 41));
  assert.equal(adv.ok, true); assert.equal(adv.character.classPath, 'A'); assert.equal(adv.character.className, '狂戰士'); assert.equal(adv.stats.skill.name, '旋風斬');
  assert.equal(adv.inventory.mat_1, 0);
  // 命運轉職書: 6,000 gold, then switch to 騎士
  sql("UPDATE rpg_characters SET gold = gold + 10000 WHERE tg_id = '4001'");
  const book = await call('/rpg/buy', { tgId: '4001', item: 'reselect_1', qty: 1, requestId: 'b1' }, t(9, 42)); assert.equal(book.ok, true);
  const rs = await call('/rpg/reselect', { tgId: '4001', tier: 1, branch: 'B', requestId: 'rs1' }, t(9, 43));
  assert.equal(rs.ok, true); assert.equal(rs.character.className, '騎士');
  assert.equal((await call('/rpg/reselect', { tgId: '4001', tier: 1, branch: 'A', requestId: 'rs2' }, t(9, 44))).error, 'no_book');
  // Lv30 → leaves the gate after advancing (EXP full)
  sql("UPDATE rpg_characters SET exp = ? WHERE tg_id = '4002'", expToNext(30));
  sql("INSERT INTO rpg_inventory (tg_id,item,quantity) VALUES ('4002','mat_1',0) ON CONFLICT DO UPDATE SET quantity = 1");
  const adv2 = await call('/rpg/advance', { tgId: '4002', branch: 'B', requestId: 'adv2' }, t(9, 45));
  assert.equal(adv2.character.level, 31); assert.equal(adv2.character.className, '秘法師');
});

test('unattacked boss vanishes after 30 min; attacked-but-alive boss flees', async () => {
  const { call, env, one } = mk(); const t = (h, m = 0) => taipeiAt(D, h, m);
  await create(call, '5001', '丙丙', 'archer', t(8));
  await call('/rpg/boss/spawn-due', {}, t(12, 0));
  await runCron(env, t(12, 30));
  assert.equal(one("SELECT status FROM rpg_boss_instances WHERE id='b2026100812'").status, 'vanished');
  await call('/rpg/boss/spawn-due', {}, t(15, 0));
  await call('/rpg/boss/attack', { tgId: '5001', bossId: 'b2026100815' }, t(15, 1));
  assert.equal((await call('/rpg/boss/attack', { tgId: '5001', bossId: 'b2026100815' }, t(15, 31))).error, 'boss_over');
  assert.equal(one("SELECT status FROM rpg_boss_instances WHERE id='b2026100815'").status, 'fled');
  const ends = (await call('/rpg/outbox/claim', { limit: 50 }, t(15, 32))).items.filter((i) => i.kind === 'boss_end').map((i) => i.payload.status);
  assert.deepEqual(ends.sort(), ['fled', 'vanished']);
});

test('cron settles everyone and queues DMs (town / low supply), deduped per day', async () => {
  const { call, env, sql } = mk(); const t0 = taipeiAt(D, 8);
  await create(call, '6001', '丁丁', 'sword', t0);
  sql("UPDATE rpg_inventory SET quantity = 0 WHERE tg_id='6001' AND item='red_1'"); sql("UPDATE rpg_characters SET level = 20 WHERE tg_id='6001'");
  const r = await runCron(env, t0 + 12 * H); assert.equal(r.settled, 1);
  await runCron(env, t0 + 12.5 * H);
  const dms = (await call('/rpg/outbox/claim', { limit: 50 }, t0 + 13 * H)).items.filter((i) => i.target === 'dm');
  assert.equal(dms.filter((i) => i.kind === 'town_no_red').length, 1);
  assert.equal(dms[0].tgId, '6001');
});

test('admin grant is audited and idempotent; dev routes refuse in production', async () => {
  const { call, env, one } = mk(); await create(call, '7001', '戊戊');
  const g = await call('/rpg/admin/grant', { adminTgId: '1', tgId: '7001', item: 'reselect_1', qty: 1, requestId: 'x1', reason: 'test' }); assert.equal(g.ok, true);
  assert.equal((await call('/rpg/admin/grant', { adminTgId: '1', tgId: '7001', gold: 5, requestId: 'x1' })).error, 'duplicate');
  assert.equal(one("SELECT COUNT(*) n FROM rpg_admin_audit").n, 1);
  const res = await handle(new Request('http://rpg/rpg/dev/spawn-now', { method: 'POST', headers: { 'X-Service-Secret': SECRET }, body: '{}' }), { ...env, ENVIRONMENT: 'production' });
  assert.equal(res.status, 403);
});

test('idle drops land in the inventory; enhance (incl. break → item deleted + group announcement) and reroll via API', async () => {
  const { call, sql, one } = mk(); const t0 = taipeiAt(D, 8);
  await create(call, '8001', '鐵匠', 'sword', t0);
  sql("UPDATE rpg_characters SET level = 25 WHERE tg_id = '8001'");
  sql("UPDATE rpg_inventory SET quantity = 5000 WHERE tg_id = '8001'");
  const me = await call('/rpg/me', { tgId: '8001' }, t0 + 24 * H);
  const dropped = me.report.drops; const stored = one("SELECT drops_json FROM rpg_idle_reports WHERE tg_id='8001' ORDER BY id DESC").drops_json;
  assert.deepEqual(JSON.parse(stored), dropped);
  for (const [k, v] of Object.entries(dropped)) assert.equal(me.inventory[k], v);
  await call('/rpg/admin/grant', { adminTgId: '1', tgId: '8001', item: 'scroll_w', qty: 60, requestId: 'g-w' });
  await call('/rpg/admin/grant', { adminTgId: '1', tgId: '8001', item: 'scroll_r', qty: 3, requestId: 'g-r' });
  const weapon = me.equipment.find((e) => e.slot === 'weapon');
  sql('UPDATE rpg_equipment SET enhance_level = 8 WHERE id = ?', weapon.id);
  let broke = false; let last = null;
  for (let i = 0; i < 40 && !broke; i++) {
    last = await call('/rpg/enhance', { tgId: '8001', itemId: weapon.id, requestId: `e${i}` }, t0 + 24 * H + i * 1000);
    assert.equal(last.ok, true, last.message); broke = last.result.result === 'break';
  }
  assert.ok(broke, 'beyond safe eventually breaks');
  assert.equal(one('SELECT COUNT(*) n FROM rpg_equipment WHERE id = ?', weapon.id).n, 0);
  const ann = (await call('/rpg/outbox/claim', { limit: 50 }, t0 + 25 * H)).items.filter((i) => i.kind === 'enhance');
  assert.ok(ann.length >= 1 && ann.at(-1).payload.result === 'break');
  const armor = last.equipment.find((e) => e.slot === 'armor');
  const rr = await call('/rpg/reroll', { tgId: '8001', itemId: armor.id, requestId: 'rr1' }, t0 + 25 * H);
  assert.equal(rr.ok, true); assert.equal(rr.inventory.scroll_r, (me.inventory.scroll_r || 0) + 3 - 1);
  assert.equal(rr.result.after.lines.length,1); assert.ok(['C','B','A','S','SS'].includes(rr.result.after.quality));
  sql("DELETE FROM rpg_inventory WHERE tg_id='8001' AND item='scroll_a'");
  const armorEnhance=await call('/rpg/enhance',{tgId:'8001',itemId:armor.id,requestId:'ea'},t0+25*H);
  assert.equal(armorEnhance.ok,true);
  assert.equal(armorEnhance.result.goldCost,50);
  assert.equal(armorEnhance.character.gold,rr.character.gold-50);
});

test('boss slots: random map per slot from D1 context — never repeats the previous slot, stuck map forced by the last slot', async () => {
  const { call, sql } = mk(); const t = (h, m = 0) => taipeiAt(D, h, m);
  await create(call, '5001', '丙丙', 'sword', t(8)); await create(call, '5002', '丁丁', 'mage', t(8));
  sql("UPDATE rpg_characters SET level = 12, last_settle_at = ? WHERE tg_id = '5001'", t(8, 59));
  sql("UPDATE rpg_characters SET level = 45, class_path = 'A', last_settle_at = ? WHERE tg_id = '5002'", t(8, 59));
  const tiers = [];
  for (const h of [9, 12, 15, 18, 20, 22]) { const r = (await call('/rpg/boss/spawn-due', {}, t(h))).spawn; assert.equal(r.spawned, true); assert.equal(r.reason, 'random'); tiers.push(r.tier); await call('/rpg/dev/cron', {}, t(h, 31)); }
  for (let i = 1; i < tiers.length; i++) assert.notEqual(tiers[i], tiers[i - 1], `slots ${tiers}`);
  // next day: 丙丙 is stuck at Lv30 (map 3) — map 3 must appear that day, deterministically for the same slot ids
  const D2 = '2026-10-09'; const t2 = (h, m = 0) => taipeiAt(D2, h, m);
  sql("UPDATE rpg_characters SET level = 30, last_settle_at = ? WHERE tg_id = '5001'", t2(8, 59));
  const day2 = [];
  for (const h of [9, 12, 15, 18, 20, 22]) { const r = (await call('/rpg/boss/spawn-due', {}, t2(h))).spawn; day2.push(r); await call('/rpg/dev/cron', {}, t2(h, 31)); }
  assert.ok(day2.some((r) => r.tier === 3), JSON.stringify(day2.map((r) => r.tier)));
  assert.equal(day2[0].prevTier, tiers.at(-1), 'previous slot = yesterday 22:00');
});

