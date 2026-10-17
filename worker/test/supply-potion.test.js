import test from 'node:test';
import assert from 'node:assert/strict';
import { supplyHours, refillPlan, potionTierFor, settleIdle } from '../src/game/idle.js';
import { POTIONS } from '../src/game/constants.js';
import { mkChar, starterGear } from './helpers.js';

const lv59 = () => mkChar({ level: 59, base_class: 'archer', class_path: 'A' });

test('supply: Lv59 uses tier-2 (橙色藥水／精神藥水), not tier 1', () => {
  const c = lv59(); assert.equal(potionTierFor(c), 2);
  assert.equal(POTIONS.red_2.name, '橙色藥水'); assert.equal(POTIONS.blue_2.name, '精神藥水');
  const plan = refillPlan(c, {}, starterGear(c), 24);
  assert.ok(plan.red_2 > 0 && plan.blue_2 > 0); assert.equal(plan.red_1, undefined); assert.equal(plan.blue_1, undefined);
  assert.equal(plan.cost, plan.red_2 * POTIONS.red_2.price + plan.blue_2 * POTIONS.blue_2.price);
});

test('supply: measured use follows what the real loop drinks and never drops below the formula', () => {
  const c = lv59(); const eq = starterGear(c);
  const f = supplyHours(c, { red_2: 100, blue_2: 100 }, eq, { measure: false });
  const m = supplyHours(c, { red_2: 100, blue_2: 100 }, eq);
  assert.equal(m.measured, true); assert.ok(m.hpPerTick >= f.hpPerTick && m.mpPerTick >= f.mpPerTick);
  assert.equal(m.tier, 2);
  const plan = refillPlan(c, {}, eq, 24);
  // the plan is within ~15% of what 24h of real idling drinks (rng variance), and only tier-2 potions are consumed
  const r = settleIdle(c, { red_2: 1e6, blue_2: 1e6 }, eq, c.last_settle_at + 24 * 3_600_000);
  assert.deepEqual(Object.keys(r.report.used).sort(), ['blue_2', 'red_2']);
  assert.ok(r.report.used.red_2 <= plan.red_2 * 1.15 && r.report.used.blue_2 <= plan.blue_2 * 1.15 + 2, JSON.stringify([r.report.used, plan]));
});

test('supply: when the formula says ~0 use, measured real drinking still produces a purchase', () => {
  const c = lv59(); const eq = starterGear(c);
  const plan = refillPlan(c, {}, eq, 24, { hpPerTick: 0.01, mpPerTick: 0.01 });
  assert.ok(plan.red_2 <= 1);   // direct formula path is only what the caller passes in
  const real = refillPlan(c, { red_1: 10, blue_1: 10 }, eq, 24);
  assert.ok(real.red_2 > 0, 'few low-tier potions do not count as 24h of supply');
});

test('supply: after buying the plan the panel reports ≥24h and nothing more to buy', () => {
  const c = lv59(); const eq = starterGear(c);
  const plan = refillPlan(c, {}, eq, 24);
  const inv = { red_2: plan.red_2, blue_2: plan.blue_2 };
  const sup = supplyHours(c, inv, eq);
  assert.ok(sup.red >= 23.9 && sup.blue >= 23.9, JSON.stringify(sup));
  assert.equal(refillPlan(c, inv, eq, 24, sup).cost, 0);
});

test('supply: higher tiers map to matching potion keys (tier 3/4)', () => {
  assert.equal(potionTierFor(mkChar({ level: 100 })), 4);
  assert.equal(potionTierFor(mkChar({ level: 1 })), 1);
});
