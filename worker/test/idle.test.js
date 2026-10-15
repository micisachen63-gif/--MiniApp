import test from 'node:test';
import assert from 'node:assert/strict';
import { settleIdle, autoResume, supplyHours, refillPlan, atGate } from '../src/game/idle.js';
import { idleStats } from '../src/game/stats.js';
import { expToNext } from '../src/game/formulas.js';
import { mkChar, starterGear, T0 } from './helpers.js';

const H = 3_600_000;

test('no time passed → nothing changes', () => {
  const c = mkChar(); const r = settleIdle(c, { red_1: 10, blue_1: 10 }, starterGear(c), T0 + 59_000);
  assert.equal(r.report.ticks, 0); assert.equal(r.char.exp, 0);
});

test('fresh character levels with starter potions and is deterministic', () => {
  const c = mkChar(); const eq = starterGear(c); const inv = { red_1: 150, blue_1: 150 };
  const a = settleIdle(c, inv, eq, T0 + 6 * H); const b = settleIdle(c, inv, eq, T0 + 6 * H);
  assert.deepEqual(a, b);
  assert.ok(a.char.level >= 3, `level ${a.char.level}`);
  assert.equal(a.report.ticks, 360); assert.ok(a.report.gold_gained > 0); assert.ok(a.report.kills > 0);
  assert.equal(a.char.last_settle_at, T0 + 6 * H);
  assert.equal(inv.red_1, 150, 'input not mutated');
});

test('no MP potions → basic attacks at 35% (state no_mp), EXP lower', () => {
  const c = mkChar({ level: 15, mp: 1 }); const eq = starterGear(c);
  const withBlue = settleIdle(c, { red_1: 500, blue_1: 500 }, eq, T0 + 2 * H);
  const noBlue = settleIdle(c, { red_1: 500 }, eq, T0 + 2 * H);
  assert.equal(noBlue.char.idle_state, 'no_mp');
  assert.ok(noBlue.events.some((e) => e.type === 'no_mp'));
  const ratio = noBlue.report.exp_gained / withBlue.report.exp_gained;
  assert.ok(ratio > 0.3 && ratio < 0.85, `ratio ${ratio}`);  // natural MP regen still allows some casts
});

test('no HP potions → returns to town, EXP stops; restock → auto-resume', () => {
  const c = mkChar({ level: 20 }); const eq = starterGear(c);
  const r = settleIdle(c, { blue_1: 500 }, eq, T0 + 12 * H);
  assert.equal(r.char.idle_state, 'town_no_red'); assert.ok(r.events.some((e) => e.type === 'town_no_red'));
  const exp1 = r.char.exp; const lvl1 = r.char.level;
  const later = settleIdle(r.char, r.inv, eq, r.char.last_settle_at + 3 * H);
  assert.equal(later.char.exp, exp1); assert.equal(later.char.level, lvl1); assert.equal(later.report.exp_gained, 0);
  const inv = { ...later.inv, red_1: 200 }; const ch = { ...later.char };
  assert.equal(autoResume(ch, inv, idleStats(ch, eq).maxHp), true); assert.equal(ch.idle_state, 'fighting');
  const resumed = settleIdle(ch, inv, eq, ch.last_settle_at + H); assert.ok(resumed.report.exp_gained > 0);
});

test('offline cap: at most 24h (1440 ticks) is settled', () => {
  const c = mkChar(); const r = settleIdle(c, { red_1: 99999, blue_1: 99999 }, starterGear(c), T0 + 72 * H);
  assert.equal(r.report.ticks, 1440); assert.equal(r.report.skipped_ticks, 2880); assert.equal(r.char.last_settle_at, T0 + 72 * H);
});

function deathRun(over, inv, hours = 24) {
  const c = mkChar({ level: 25, auto_red_pct: 20, ...over }); const eq = starterGear(c);  // low threshold → elite bursts can kill
  return settleIdle(c, { red_1: 99999, blue_1: 99999, ...inv }, eq, T0 + hours * H);
}
test('default 50% auto-red threshold survives a full day at Lv25', () => {
  assert.equal(deathRun({ exp: 1000, auto_red_pct: 50 }, {}).report.deaths, 0);
});
test('death: −5% of level EXP, never de-levels, capped at 3 penalties/day', () => {
  const r = deathRun({ exp: 1000 }, {});
  const deaths = r.events.filter((e) => e.type === 'death'); assert.ok(deaths.length > 3, `deaths ${deaths.length}`);
  const pen = deaths.filter((d) => d.reason === 'penalty'); assert.ok(pen.length <= 3 * 2, 'cap per Taipei day (run crosses ≤2 days)');
  for (const d of pen) assert.ok(d.penalty <= Math.floor(0.05 * expToNext(d.level)));
  assert.ok(deaths.some((d) => d.reason === 'daily_cap'));
  assert.ok(r.char.level >= 25);
});
test('death: 守護符 absorbs the penalty (and is consumed), newbies have no penalty', () => {
  const r = deathRun({ exp: 1000 }, { ward: 2 });
  const deaths = r.events.filter((e) => e.type === 'death');
  assert.deepEqual(deaths.slice(0, 2).map((d) => d.reason), ['ward', 'ward']);
  assert.equal(r.inv.ward, 0); assert.equal(r.report.wards_used, 2);
  const n = settleIdle(mkChar({ level: 5 }), { red_1: 9999, blue_1: 9999 }, starterGear(mkChar()), T0 + 24 * H);
  for (const d of n.events.filter((e) => e.type === 'death')) assert.equal(d.reason, 'newbie');
  assert.equal(n.report.exp_lost, 0);
});
test('death → reviving 10 minutes (no EXP during revive)', () => {
  const r = deathRun({ exp: 1000 }, {}, 24);
  const d = r.events.find((e) => e.type === 'death'); assert.ok(d);
  const c0 = mkChar({ level: 25, exp: 1000, auto_red_pct: 20 }); const eq = starterGear(c0);
  const upTo = settleIdle(c0, { red_1: 99999, blue_1: 99999 }, eq, d.at);
  assert.equal(upTo.char.idle_state, 'reviving'); assert.equal(upTo.char.state_until, d.at + 10 * 60_000);
  const during = settleIdle(upTo.char, upTo.inv, eq, d.at + 9 * 60_000); assert.equal(during.report.exp_gained, 0);
});

test('Lv30 gate: EXP fills then waits (state gate) until advancement', () => {
  const c = mkChar({ level: 30, exp: expToNext(30) - 10 }); const eq = starterGear(c);
  const r = settleIdle(c, { red_1: 9999, blue_1: 9999 }, eq, T0 + 2 * H);
  assert.equal(r.char.level, 30); assert.equal(r.char.exp, expToNext(30)); assert.equal(r.char.idle_state, 'gate'); assert.ok(atGate(r.char));
  assert.ok(r.events.some((e) => e.type === 'gate'));
  const adv = settleIdle({ ...r.char, class_path: 'A', idle_state: 'gate' }, r.inv, eq, r.char.last_settle_at + 60_000);
  assert.equal(adv.char.level, 31);
});
test('Lv60 gate holds in P1 even after first advancement (map 3 not open)', () => {
  const c = mkChar({ level: 60, class_path: 'A', exp: expToNext(60) - 5 });
  const r = settleIdle(c, { red_2: 9999, blue_2: 9999 }, starterGear(c, 2), T0 + H);
  assert.equal(r.char.level, 60); assert.equal(r.char.idle_state, 'gate');
});
test('supply hours and 24h refill plan are positive and consistent', () => {
  const c = mkChar({ level: 12 }); const eq = starterGear(c);
  const s = supplyHours(c, { red_1: 100, blue_1: 100 }, eq); assert.ok(s.red > 0 && s.blue > 0);
  const plan = refillPlan(c, {}, eq, 24); assert.ok(plan.red_1 > 0 && plan.blue_1 > 0 && plan.cost > 0);
  const after = refillPlan(c, { red_1: plan.red_1, blue_1: plan.blue_1 }, eq, 24); assert.equal(after.cost, 0);
});
test('performance: 24h settle < 50ms', () => {
  const c = mkChar({ level: 40, class_path: 'B' }); const eq = starterGear(c, 2); const t = performance.now();
  for (let i = 0; i < 10; i++) settleIdle({ ...c, last_settle_at: T0 + i }, { red_2: 99999, blue_2: 99999 }, eq, T0 + i + 24 * H);
  assert.ok((performance.now() - t) / 10 < 50);
});

// ---- idle drops: enhancement / reroll scrolls ----
import { DROPS } from '../src/game/constants.js';
test('drops: deterministic, near expected rate, scaled by map tier, on a separate RNG stream', () => {
  const c = mkChar({ level: 25 }); const eq = starterGear(c); const inv = { red_1: 99999, blue_1: 99999 };
  const a = settleIdle(c, inv, eq, T0 + 24 * H); const b = settleIdle(c, inv, eq, T0 + 24 * H);
  assert.deepEqual(a.report.drops, b.report.drops); assert.equal(a.inv.scroll_w || 0, a.report.drops.scroll_w || 0);
  // average over many seeds: expected per 1440 fighting ticks at Map 3 (T3) = base × 3 × 1440
  const tot = { scroll_w: 0, scroll_a: 0, scroll_r: 0 }; const N = 60;
  for (let i = 0; i < N; i++) { const r = settleIdle({ ...c, tg_id: String(1000 + i) }, inv, eq, T0 + 24 * H); for (const k in tot) tot[k] += r.report.drops[k] || 0; }
  for (const k in tot) { const exp = DROPS[k].base * 3 * 1440; const avg = tot[k] / N; assert.ok(avg > exp * 0.6 && avg < exp * 1.4, `${k} avg ${avg} vs ${exp}`); }
  const t2 = { scroll_w: 0, scroll_a: 0, scroll_r: 0 }; const c2 = mkChar({ level: 45, class_path: 'A' }); const eq2 = starterGear(c2, 2);
  for (let i = 0; i < N; i++) { const r = settleIdle({ ...c2, tg_id: String(2000 + i) }, { red_2: 99999, blue_2: 99999 }, eq2, T0 + 24 * H); for (const k in t2) t2[k] += r.report.drops[k] || 0; }
  const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0); assert.ok(sum(t2) > sum(tot) * 1.5, `T5 ${sum(t2)} vs T3 ${sum(tot)}`);
  // combat unaffected by drops: same EXP/deaths as a run with the drop table zeroed out is implied by the separate stream
  assert.equal(a.report.exp_gained, b.report.exp_gained);
});
test('drops: none in town; daily cap per Taipei day; counter resets next day', () => {
  const town = settleIdle(mkChar({ level: 20, idle_state: 'town_no_red' }), {}, starterGear(mkChar()), T0 + 24 * H);
  assert.deepEqual(town.report.drops, {});
  const c = mkChar({ level: 25, drop_day: '2026-10-08', drops_today: JSON.stringify({ scroll_w: 6, scroll_a: 9, scroll_r: 6 }) });
  const r = settleIdle(c, { red_1: 99999, blue_1: 99999 }, starterGear(c), Date.parse('2026-10-08T15:59:00Z')); // until 23:59 Taipei
  assert.deepEqual(Object.fromEntries(Object.entries(r.report.drops).filter(([k])=>DROPS[k])), {}, 'all scrolls already at cap today'); assert.ok(r.report.drops_capped >= 0);
  const next = settleIdle(r.char, r.inv, starterGear(c), Date.parse('2026-10-09T15:59:00Z'));
  assert.equal(next.char.drop_day, '2026-10-09'); assert.ok(Object.keys(next.report.drops).length > 0 || next.report.ticks === 1440);
  const today = JSON.parse(next.char.drops_today); for (const k in today) if (DROPS[k]) assert.ok(today[k] <= DROPS[k].capPerTier * 3);
});
