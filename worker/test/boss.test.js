import test from 'node:test';
import assert from 'node:assert/strict';
import { slotFor, nextSlot, chooseTier, bossMaxHp, newBoss, performAttack, lootPlan, largestRemainder, attackWindow } from '../src/game/boss.js';
import { idleStats } from '../src/game/stats.js';
import { taipeiAt } from '../src/game/time.js';
import { mulberry32, rngFor } from '../src/game/rng.js';
import { mkChar, starterGear } from './helpers.js';

const D = '2026-10-08'; const M = 60_000;

test('hourly spawn slots except sleeping hours, 30 minutes each', () => {
  for (const h of [0, ...Array.from({ length: 16 }, (_, i) => i + 8)]) {
    const s = slotFor(taipeiAt(D, h, 0)); assert.equal(s.id, `b20261008${String(h).padStart(2, '0')}`);
    assert.equal(s.end - s.start, 30 * M); assert.ok(slotFor(taipeiAt(D, h, 29))); assert.equal(slotFor(taipeiAt(D, h, 30)), null);
  }
  for(let h=1;h<=7;h++)assert.equal(slotFor(taipeiAt(D,h,0)),null);assert.equal(nextSlot(taipeiAt(D,0,10)).hour,8);
  assert.equal(nextSlot(taipeiAt(D, 23, 10)).day, '2026-10-09'); assert.equal(nextSlot(taipeiAt(D, 23, 10)).hour, 0);
});

const pl = (level, inv = {}, class_path = '') => ({ level, class_path, inv });
/** simulate `days` days of 6 slots with the production context rules (prev boss, spawned-today, slots left) */
function simulate(players, days, seed, maxTier = 2) {
  const rng = mulberry32(seed); const log = []; let prev = null;
  for (let d = 0; d < days; d++) {
    const today = [];
    BOSS_SLOTS.forEach((h, i) => {
      const c = chooseTier(players, { prevTier: prev, spawnedToday: [...today], slotsLeft: BOSS_SLOTS.length - i }, rng, maxTier);
      log.push({ d, h, ...c }); today.push(c.tier); prev = c.tier;
    });
  }
  return log;
}
const BOSS_SLOTS = [0, ...Array.from({ length: 16 }, (_, i) => i + 8)];

test('chooseTier: random boss per slot, never the previous slot\'s boss when there is a choice', () => {
  const players = [pl(5), pl(15, {}, 'A')];                       // maps 1 and 2 have players, nobody stuck
  const log = simulate(players, 200, 7); const count = { 1: 0, 2: 0 };
  for (let i = 0; i < log.length; i++) { count[log[i].tier] += 1; assert.equal(log[i].reason, 'random'); if (i) assert.notEqual(log[i].tier, log[i - 1].tier, `slot ${i} repeats`); }
  assert.ok(count[1] > 500 && count[2] > 500, JSON.stringify(count));
  assert.equal(chooseTier([pl(5)], { prevTier: 1 }, mulberry32(1), 2).tier, 1, 'only one map has players → it may repeat');
  assert.equal(chooseTier([], {}, mulberry32(1), 2).reason, 'empty');
});

test('chooseTier: every map with a stuck player (cap level, no material) gets ≥1 spawn per day, in a random slot', () => {
  const players = [pl(30), pl(60, {}, 'A'), pl(15, { mat_1: 1 })];  // stuck at Lv30 (map 3) and Lv60 (map 6)
  for (const seed of [1, 2, 3, 99, 12345]) {
    const log = simulate(players, 120, seed, 6);
    for (let d = 0; d < 120; d++) { const day = log.filter((x) => x.d === d).map((x) => x.tier); assert.ok(day.includes(3) && day.includes(6), `seed ${seed} day ${d}: ${day}`); }
    for (let i = 1; i < log.length; i++) assert.notEqual(log[i].tier, log[i - 1].tier);
  }
  // 9 open maps, only map 3 stuck: map 3 at least once per day, and the guarantee lands in varied slots
  const log = simulate([pl(30), pl(45, {}, 'A'), pl(75, {}, 'AA')], 300, 42, 9); const slotOfGuarantee = new Set();
  for (let d = 0; d < 300; d++) { const day = log.filter((x) => x.d === d); assert.ok(day.some((x) => x.tier === 3), `day ${d}`); const g = day.find((x) => x.reason === 'guarantee'); if (g) slotOfGuarantee.add(g.h); }
  assert.ok(slotOfGuarantee.size >= 4, `guarantee lands in varied slots: ${[...slotOfGuarantee]}`);
  // last slot of the day with a pending stuck map → forced
  assert.deepEqual([chooseTier([pl(30), pl(45, {}, 'A')], { prevTier: 5, spawnedToday: [5], slotsLeft: 1 }, mulberry32(5), 6).tier, 'guarantee'].join(), '3,guarantee');
  assert.equal(chooseTier([pl(30, { mat_1: 1 })], {}, mulberry32(1), 6).pending.length, 0, 'holding the material = not stuck');
  assert.equal(chooseTier([pl(29)], {}, mulberry32(1), 6).stuck.length, 0, 'below the cap = not stuck');
  // deterministic: same seed → same sequence
  assert.deepEqual(simulate(players, 5, 77, 6).map((x) => x.tier), simulate(players, 5, 77, 6).map((x) => x.tier));
});

test('boss HP scales by participants', () => {
  assert.equal(bossMaxHp(3, 1), 7000); assert.equal(bossMaxHp(3, 3), 17000); assert.equal(bossMaxHp(6, 2), 34000);
  const b = newBoss(slotFor(taipeiAt(D, 9)), 3, rngFor('x'), '-100'); assert.equal(b.hp, 7000); assert.equal(b.ends_at - b.started_at, 30 * M);
  assert.equal(attackWindow(b, b.started_at + 2 * M), 0); assert.equal(attackWindow(b, b.started_at + 29 * M), 9);
});

test('a solo Lv30 player can kill the tier-1 boss within the 10 attack windows', () => {
  const c = mkChar({ level: 30 }); const eq = starterGear(c); const s = idleStats(c, eq); const inv = { red_1: 500, blue_1: 500 };
  const b = newBoss(slotFor(taipeiAt(D, 9)), 3, rngFor('solo'), '-1'); let dmg = 0; let attacks = 0;
  const rng = mulberry32(3);
  while (dmg < b.hp && attacks < 10) { const r = performAttack({ c, inv, stats: s, boss: b, rng, now: b.started_at + attacks * 3 * M }); dmg += r.damage; attacks += 1; }
  assert.ok(dmg >= b.hp, `solo dmg ${dmg} after ${attacks}`); assert.ok(attacks >= 4, `too easy: ${attacks}`);
});

test('loot: gold pool conserved, material to needy only, capped players get 20% and no gear', () => {
  assert.deepEqual(largestRemainder(10, { a: 1, b: 1, c: 1 }), { a: 4, b: 3, c: 3 });
  const b = { map_id: 3 }; const A = (id, level, damage, lootToday = 0, inv = {}) => ({ tg_id: id, damage, char: { level, class_path: '' }, inv, lootToday });
  const att = [A('1', 25, 5000), A('2', 30, 3000, 0, { mat_1: 1 }), A('3', 28, 2000, 4)];
  const plan = lootPlan(b, att, mulberry32(9));
  assert.deepEqual(plan.materials.sort(), ['1', '3']);
  assert.deepEqual(plan.capped, ['3']);
  const raw = largestRemainder(13500, { 1: 5000, 2: 4500, 3: 2000 });
  assert.equal(plan.gold['1'] + plan.gold['2'], raw['1'] + raw['2']); assert.equal(plan.gold['3'], Math.floor(raw['3'] * 0.2));
  assert.notEqual(plan.gear, '3');
});

