// v0.4: 11 equipment slots, relic gear, migration 0003. (Trading moved to the v0.5 flow → v05.test.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { freshDb } from './d1-shim.js';
import { handle } from '../src/index.js';
import { taipeiAt } from '../src/game/time.js';
import { makeRelic, makeGear, canEquip, gearOffers } from '../src/game/gear.js';
import { relicPlan, relicChances } from '../src/game/boss.js';
import { tradeTax, netGold } from '../src/game/trade.js';
import { mulberry32 } from '../src/game/rng.js';
import { RELIC, TRADE, SLOTS, CLASS_KEYS } from '../src/game/constants.js';
import { itemStat } from '../src/game/stats.js';

const SECRET = 'test-secret-0123456789'; const D = '2026-10-08'; const H = 3600e3;
function mk() {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true', GROUP_CHAT_ID: '-100123' };
  const call = async (path, body = {}, now = taipeiAt(D, 8)) => {
    const res = await handle(new Request(`http://rpg${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(now) }, body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  return { env, call, sql: (q, ...p) => env.DB.sqlite.prepare(q).run(...p), one: (q, ...p) => env.DB.sqlite.prepare(q).get(...p), all: (q, ...p) => env.DB.sqlite.prepare(q).all(...p) };
}
const T0 = taipeiAt(D, 8);
async function two(cls1 = 'sword', cls2 = 'mage') {
  const k = mk();
  await k.call('/rpg/create', { tgId: '501', name: '甲甲', gender: 'f', baseClass: cls1 }, T0);
  await k.call('/rpg/create', { tgId: '502', name: '乙乙', gender: 'm', baseClass: cls2 }, T0);
  // park both in town (reviving far into the future) so idle settlement doesn't consume potions between assertions
  k.sql("UPDATE rpg_characters SET gold = 500000, level = 30, idle_state = 'reviving', state_until = ? WHERE tg_id IN ('501','502')", T0 + 1000 * H);
  return k;
}
const gold = (k, tg) => k.one('SELECT gold FROM rpg_characters WHERE tg_id = ?', tg).gold;
const inv = (k, tg, item) => k.one('SELECT quantity FROM rpg_inventory WHERE tg_id = ? AND item = ?', tg, item)?.quantity || 0;

// ------------------------------------------------------------------------------------------- equipment
test('11 slots: class restriction on 盔甲/頭盔/手套/長靴, shared slots for all classes, accessory positions', async () => {
  const k = await two('sword', 'archer'); const t = T0 + 60e3;
  const offers = (await k.call('/rpg/shop', { tgId: '501' }, t)).shop.gear;
  for (const g of ['weapon', 'armor', 'accessory']) assert.ok(offers.some((o) => o.group === g), `shop group ${g}`);
  for (const s of SLOTS) assert.ok(offers.some((o) => o.slot === s), `shop has ${s}`);
  const buy = async (tg, code, rid) => { const r = await k.call('/rpg/buy-gear', { tgId: tg, code, requestId: rid }, t); assert.equal(r.ok, true, code + JSON.stringify(r)); return r.result.item.id; };
  const e1 = await buy('501', 'a.earring.1', 'b1'); const e2 = await buy('501', 'a.earring.1', 'b2'); const e3 = await buy('501', 'a.earring.1', 'b3');
  const r1 = await buy('501', 'a.ring.1', 'b4'); const belt = await buy('501', 'a.belt.1', 'b5'); const und = await buy('501', 'a.undershirt.1', 'b6'); const helm = await buy('501', 'a.helmet.1', 'b7');
  let r = await k.call('/rpg/equip', { tgId: '501', itemId: e1 }, t); assert.equal(r.ok, true);
  r = await k.call('/rpg/equip', { tgId: '501', itemId: e2 }, t); assert.equal(r.ok, true);
  const pos = (id) => r.equipment.find((e) => e.id === id);
  assert.equal(pos(e1).position, 1); assert.equal(pos(e2).position, 2, 'second earring auto → 耳環2');
  r = await k.call('/rpg/equip', { tgId: '501', itemId: e3, position: 1 }, t); assert.equal(r.ok, true);
  assert.equal(pos(e3).position, 1); assert.equal(pos(e1).equipped, false, '耳環1 replaced'); assert.equal(pos(e2).position, 2);
  assert.equal(r.equipment.filter((e) => e.slot === 'earring' && e.equipped).length, 2, 'never more than 2 earrings');
  for (const id of [r1, belt, und, helm]) { r = await k.call('/rpg/equip', { tgId: '501', itemId: id }, t); assert.equal(r.ok, true); }
  assert.equal(r.equipment.filter((e) => e.equipped).length, 8);
  assert.ok(r.equipment.filter((e) => e.equipped).every((e) => e.bound), 'equipping binds');
  // unique: no slot (except earring/ring) has 2 equipped; position uniqueness
  const eq = k.all("SELECT slot, is_equipped, COUNT(*) n FROM rpg_equipment WHERE tg_id='501' AND is_equipped>0 GROUP BY slot, is_equipped"); assert.ok(eq.every((x) => x.n === 1));
  // class restriction: a sword helmet can't go on an archer (inject foreign-class gear for 502)
  const g = makeGear({ id: 'xhelm', tgId: '502', cls: 'sword', slot: 'helmet', kind: null, tier: 1, rng: mulberry32(1), now: t });
  assert.match(canEquip({ tg_id: '502', base_class: 'archer', level: 30 }, g), /職業不符/);
  const ring = makeGear({ id: 'xring', tgId: '502', cls: 'sword', slot: 'ring', kind: null, tier: 1, rng: mulberry32(1), now: t });
  assert.equal(ring.class_req, 'any'); assert.equal(canEquip({ tg_id: '502', base_class: 'archer', level: 30 }, ring), null);
  // unequip a specific accessory position; stats drop back
  const before = r.stats.maxMp; r = await k.call('/rpg/unequip', { tgId: '501', slot: 'earring', position: 2 }, t); assert.equal(r.ok, true);
  assert.equal(pos(e2).equipped, false); assert.ok(r.stats.maxMp < before, 'earring MP removed');
  // gear offers: mage gets 8 non-weapon shared/class offers per tier listed
  assert.ok(gearOffers({ base_class: 'mage', level: 35, class_path: '' }).filter((o) => o.slot === 'ring').length >= 1);
});

test('enhance / reroll work on accessories (armor scroll), shared DEF scales with wearer', async () => {
  const k = await two(); const t = T0 + 60e3;
  k.sql("INSERT INTO rpg_inventory (tg_id,item,quantity) VALUES ('501','scroll_a',20),('501','scroll_r',5),('501','scroll_w',5) ON CONFLICT(tg_id,item) DO UPDATE SET quantity = excluded.quantity");
  const id = (await k.call('/rpg/buy-gear', { tgId: '501', code: 'a.ring.1', requestId: 'g' }, t)).result.item.id;
  const e = await k.call('/rpg/enhance', { tgId: '501', itemId: id, requestId: 'e1' }, t); assert.equal(e.ok, true, JSON.stringify(e));
  assert.equal(inv(k, '501', 'scroll_a'), 19, 'ring uses armor scroll'); assert.equal(inv(k, '501', 'scroll_w'), 5);
  const rr = await k.call('/rpg/reroll', { tgId: '501', itemId: id, requestId: 'r1' }, t); assert.equal(rr.ok, true, JSON.stringify(rr));
  const belt = makeGear({ id: 'b', tgId: '1', cls: 'sword', slot: 'belt', kind: null, tier: 2, rng: mulberry32(3), now: t, forceRarity: 'common' });
  assert.ok(itemStat(belt, 'sword').main > itemStat(belt, 'mage').main, 'plate wearer gets more DEF from a shared belt than cloth');
});

// ------------------------------------------------------------------------------------------- relics
test('relic: ×1.25 stats + one extra affix, gold-purple grade, uniform released classes, every slot', () => {
  const rng = mulberry32(42); const cls = {}; const slots = {};
  for (let i = 0; i < 3000; i++) { const r = makeRelic({ id: `r${i}`, tgId: '1', tier: 2, rng, now: 0, source: 'relic_boss' });
    assert.equal(r.grade, 'relic'); assert.ok(r.name.startsWith(RELIC.prefix)); assert.equal(Object.keys(JSON.parse(r.affix_json)).length, 1); assert.equal(r.bound, 0);
    slots[r.slot] = (slots[r.slot] || 0) + 1; if (r.class_req !== 'any') cls[r.class_req] = (cls[r.class_req] || 0) + 1;
    if (['belt', 'undershirt', 'earring', 'ring'].includes(r.slot)) assert.equal(r.class_req, 'any'); }
  for (const s of SLOTS) assert.ok(slots[s] > 3000 / SLOTS.length * 0.7, `slot ${s} ${slots[s]}`);
  const tot = Object.values(cls).reduce((a, b) => a + b, 0); assert.deepEqual(Object.keys(cls).sort(),[...CLASS_KEYS].sort());for (const c of CLASS_KEYS) assert.ok(Math.abs(cls[c] / tot - 1 / CLASS_KEYS.length) < 0.04, `class ${c}`);
  const a = makeGear({ id: 'n', tgId: '1', cls: 'sword', slot: 'armor', kind: null, tier: 3, rng: mulberry32(9), now: 0, forceRarity: 'epic' });
  const b = makeGear({ id: 'r', tgId: '1', cls: 'sword', slot: 'armor', kind: null, tier: 3, rng: mulberry32(9), now: 0, forceRarity: 'epic', relic: true });
  assert.ok(Math.abs(b.base_stat / a.base_stat - RELIC.statMult) < 0.06, `${b.base_stat}/${a.base_stat}`);
});

test('relic boss plan: 35% chance of exactly 1 drop, damage-weighted, every participant has a nonzero chance', () => {
  const att = [{ tg_id: 'big', damage: 8000 }, { tg_id: 'mid', damage: 1800 }, { tg_id: 'tiny', damage: 200 }];
  const ch = relicChances(att); assert.ok(ch.tiny > 0.03, `tiny ${ch.tiny}`); assert.ok(ch.big > ch.mid && ch.mid > ch.tiny);
  const rng = mulberry32(5); const got = { big: 0, mid: 0, tiny: 0 }; const n = {}; const N = 20000;
  for (let i = 0; i < N; i++) { const p = relicPlan(att, rng); n[p.length] = (n[p.length] || 0) + 1; for (const x of p) got[x]++; }
  assert.deepEqual(Object.keys(n).map(Number).sort(), [0, 1], 'never more than one relic per kill');
  assert.ok(Math.abs(n[1] / N - RELIC.bossChance) < 0.015, JSON.stringify(n));
  const share = got.tiny / n[1]; assert.ok(Math.abs(share - ch.tiny) < 0.012, `tiny share ${share} vs ${ch.tiny}`);
  const capped = { big: 0, tiny: 0 }; for (let i = 0; i < N; i++) for (const x of relicPlan([{ tg_id: 'big', damage: 8000, mult: 0.2 }, { tg_id: 'tiny', damage: 200 }], rng)) capped[x]++;
  assert.ok(capped.big > 0 && capped.tiny > 0, 'loot-capped attacker keeps a reduced, non-zero chance');
  assert.ok(got.big > got.mid && got.mid > got.tiny && got.tiny > 0, JSON.stringify(got));
  assert.deepEqual(relicPlan([{ tg_id: 'z', damage: 0 }], rng), []);
});

test('relic elite drops: ~0.5%/elite kill, daily cap, announced in group + DM', async () => {
  const k = mk(); await k.call('/rpg/create', { tgId: '601', name: '丙丙', gender: 'f', baseClass: 'sword' }, T0);
  k.sql("UPDATE rpg_characters SET level = 25, map_id = 1 WHERE tg_id = '601'");
  k.sql("INSERT INTO rpg_inventory (tg_id,item,quantity) VALUES ('601','red_1',100000),('601','blue_1',100000) ON CONFLICT(tg_id,item) DO UPDATE SET quantity = excluded.quantity");
  let relics = 0; let t = T0;
  for (let d = 0; d < 20; d++) { t += 24 * H; const r = await k.call('/rpg/me', { tgId: '601' }, t); relics += (r.report?.relics || []).length; assert.ok((r.report?.relics || []).length <= RELIC.eliteDailyCap); }
  const rows = k.all("SELECT * FROM rpg_equipment WHERE tg_id='601' AND grade='relic'"); assert.equal(rows.length, relics);
  const ob = k.all("SELECT target, kind FROM rpg_outbox WHERE kind = 'relic'"); assert.equal(ob.length, relics, 'DM per relic');
  const posts = k.all("SELECT * FROM rpg_shares WHERE kind = 'relic' AND tg_id = '601'"); assert.equal(posts.length, relics, 'v0.5: group photo post per relic');
  assert.ok(k.all("SELECT 1 FROM rpg_outbox WHERE kind = 'share' AND target = 'group'").length >= relics, 'group shares include relic announcements; elite gear may add more');
  assert.ok(relics <= 20); // expectation ≈ 0.2/day → a handful over 20 days
});

// trading: v0.5 flow (share → 我要交易 → 確認 → 鎖定 → OK) is tested in v05.test.js

test('migration 0003 on v0.3 data keeps 白色毛衣 gear (old armor → 盔甲), binds equipped, adds trade tables', () => {
  const db = new DatabaseSync(':memory:'); const M = new URL('../migrations/', import.meta.url);
  db.exec(readFileSync(new URL('0001_init.sql', M), 'utf8')); db.exec(readFileSync(new URL('0002_app_access.sql', M), 'utf8'));
  const cols = db.prepare('PRAGMA table_info(rpg_equipment)').all().map((c) => c.name);
  const row = { id: 'aa0c2f54d2cd', tg_id: '9001', slot: 'armor', kind: 'plate', class_req: 'sword', tier: 1, level_req: 1, name: '粗製板甲', source: 'starter', base_stat: 11, element: 'fire', element_stat: 2, element_tier: 'common', enhance_level: 0, is_equipped: 1, created_at: 1 };
  const helm = { ...row, id: '398792097786', slot: 'helmet', name: '粗製頭盔', source: 'shop', base_stat: 4, is_equipped: 0 };
  for (const r of [row, helm]) { const k = Object.keys(r).filter((c) => cols.includes(c)); db.prepare(`INSERT INTO rpg_equipment (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((c) => r[c])); }
  db.exec(readFileSync(new URL('0003_gear_v04_trade.sql', M), 'utf8'));
  const a = db.prepare('SELECT * FROM rpg_equipment WHERE id = ?').get('aa0c2f54d2cd'); const h = db.prepare('SELECT * FROM rpg_equipment WHERE id = ?').get('398792097786');
  assert.equal(a.slot, 'armor'); assert.equal(a.is_equipped, 1); assert.equal(a.bound, 1); assert.equal(a.grade, 'normal'); assert.equal(a.base_stat, 11);
  assert.equal(h.is_equipped, 0); assert.equal(h.bound, 0, 'never-equipped shop gear stays tradeable');
  for (const tb of ['rpg_trades', 'rpg_trade_items', 'rpg_trade_log']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(tb));
  assert.throws(() => db.prepare("UPDATE rpg_equipment SET slot = 'cape' WHERE id = ?").run(a.id), /CHECK/);
  assert.throws(() => db.prepare("UPDATE rpg_equipment SET trade_id = 'tx' WHERE id = ?").run(a.id), /CHECK/, 'equipped item cannot be escrowed');
});
