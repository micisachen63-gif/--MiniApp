// v0.5.1: 掛機打怪掉金幣 — per-kill gold (normal < elite < boss), variance, ledger idempotency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { handle, runCron } from '../src/index.js';
import { taipeiAt } from '../src/game/time.js';
import { settleIdle, goldPerKill } from '../src/game/idle.js';
import { MONSTER_GOLD, POTIONS, BOSS, ITEMS } from '../src/game/constants.js';
import { standardSet } from '../src/game/stats.js';
import { ledgerStmt } from '../src/db.js';
import { mkChar, starterGear, T0 } from './helpers.js';

const SECRET = 'test-secret-0123456789'; const H = 3600e3;
function mk() {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true', GROUP_CHAT_ID: '-100123' };
  const call = async (path, body = {}, now) => {
    const res = await handle(new Request(`http://rpg${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(now) }, body: JSON.stringify(body) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  return { env, call, sql: (q, ...p) => env.DB.sqlite.prepare(q).run(...p), one: (q, ...p) => env.DB.sqlite.prepare(q).get(...p), all: (q, ...p) => env.DB.sqlite.prepare(q).all(...p) };
}
const big = { red_1: 99999, blue_1: 99999 };

test('per-kill gold scales with level, covers potion upkeep, and has variance but is deterministic', () => {
  assert.ok(goldPerKill(50) > goldPerKill(20) && goldPerKill(20) > goldPerKill(3));
  const run = (lv, h = 6) => { const c = mkChar({ level: lv }); return settleIdle(c, { ...big }, starterGear(c), T0 + h * H); };
  for (const lv of [3, 15, 25]) {
    const r = run(lv); const used = Object.entries(r.report.used).reduce((s, [k, n]) => s + (POTIONS[k]?.price || 0) * n, 0);
    assert.ok(r.report.gold_kills > 0, 'kill gold credited');
    assert.equal(r.report.gold_gained, r.report.gold_kills + r.report.gold_elites, 'daily-pct accrual retired');
    assert.ok(r.report.gold_gained > used * 1.5, `L${lv}: idle gold ${r.report.gold_gained} must beat potion upkeep ${used}`);
    const netPerMin = (r.report.gold_gained - used) / 360;   // 6h window
    // ミカサ 21:33「10分鐘 至少要能衝3-5次裝 新手期卡太久」: starter gear (weapon+armor) must afford ≥3 one-tap attempts / 10 min
    const per10 = (k) => (netPerMin * 10) / ITEMS[k].price;
    assert.ok(per10('scroll_w') >= 3, `L${lv}: ≥3 weapon attempts / 10 min, got ${per10('scroll_w').toFixed(1)}`);
    assert.ok(per10('scroll_a') >= 4, `L${lv}: ≥4 armor attempts / 10 min, got ${per10('scroll_a').toFixed(1)}`);
    assert.ok(per10('scroll_a') <= 12, `L${lv}: but not absurd (${per10('scroll_a').toFixed(1)} armor / 10 min)`);
    const nominal = r.report.kills * goldPerKill(lv);
    assert.ok(Math.abs(r.report.gold_kills - nominal) <= nominal * MONSTER_GOLD.variance + 2, 'variance bounded');
    assert.deepEqual(run(lv).report, r.report, 'same window → same gold');
  }
});

test('elite ambush pays elite × kill gold; elites ≪ map boss pool', () => {
  const c = mkChar({ level: 20 }); const r = settleIdle(c, { ...big }, starterGear(c), T0 + 24 * H);
  assert.ok(r.report.elites > 0);
  const per = r.report.gold_elites / r.report.elites;
  assert.ok(per >= goldPerKill(20) * MONSTER_GOLD.elite * (1 - MONSTER_GOLD.variance) - 1 && per <= goldPerKill(20) * MONSTER_GOLD.elite * (1 + MONSTER_GOLD.variance) + 1);
  assert.ok(per > goldPerKill(20) * 5 && per < BOSS.goldPerTierPerPlayer, 'normal < elite < map boss');
});

test('idle gold goes through the ledger once per window — app read, cron and retries never double credit', async () => {
  const k = mk(); const t0 = taipeiAt('2026-10-08', 8);
  await k.call('/rpg/create', { tgId: '7001', name: '金金', gender: 'f', baseClass: 'sword' }, t0);
  k.sql("UPDATE rpg_characters SET level = 12 WHERE tg_id = '7001'");
  k.sql("UPDATE rpg_inventory SET quantity = 5000 WHERE tg_id = '7001' AND item IN ('red_1','blue_1')");
  const g0 = k.one("SELECT gold FROM rpg_characters WHERE tg_id='7001'").gold;
  const a = await k.call('/rpg/me', { tgId: '7001' }, t0 + 3 * H);
  assert.ok(a.report.gold_gained > 0);
  const rows = () => k.all("SELECT event_id, gold_delta FROM rpg_ledger WHERE tg_id='7001' AND type='掛機打怪'");
  assert.equal(rows().length, 1); assert.equal(rows()[0].event_id, `idle:7001:${t0}`); assert.equal(rows()[0].gold_delta, a.report.gold_gained);
  // same instant again (app retry) + cron at the same instant: nothing new to settle → no new row, no new gold
  await k.call('/rpg/me', { tgId: '7001' }, t0 + 3 * H); await runCron(k.env, t0 + 3 * H);
  assert.equal(rows().length, 1);
  // a replay of the same window's ledger row is rejected by UNIQUE(event_id)
  await assert.rejects(ledgerStmt(k.env.DB, { event_id: `idle:7001:${t0}`, tg_id: '7001', type: '掛機打怪', gold_delta: 1 }, t0).run());
  // racing app + cron settles of the next window: exactly one wins
  await Promise.all([k.call('/rpg/me', { tgId: '7001' }, t0 + 5 * H), runCron(k.env, t0 + 5 * H), k.call('/rpg/me', { tgId: '7001' }, t0 + 5 * H)]);
  const after = k.one("SELECT gold FROM rpg_characters WHERE tg_id='7001'").gold;
  assert.equal(rows().length, 2);
  assert.equal(after - g0, rows().reduce((s, r) => s + r.gold_delta, 0), 'character gold == Σ idle ledger rows');
});

test('stronger gear → faster idle kills → more EXP and gold per hour (soft tail past +5, cap 2.0)', async () => {
  const { gearSpeed, standardSet } = await import('../src/game/stats.js');
  assert.ok(gearSpeed(0.7) < gearSpeed(1) && gearSpeed(1) === 1 && gearSpeed(1.4) < gearSpeed(1.66) && gearSpeed(1.66) < gearSpeed(3) && gearSpeed(3) < gearSpeed(6));
  assert.ok(Math.abs(gearSpeed(1.5 ** 1.25) - 1.5) < 1e-9, 'continuous at the knee'); assert.equal(gearSpeed(50), 2);
  const L = 20; const t0 = T0; const c = mkChar({ level: L });
  const run = (eq) => settleIdle({ ...c }, { red_1: 1e5, blue_1: 1e5 }, eq.map((e) => ({ ...e, is_equipped: 1 })), t0 + 6 * H).report;
  const std = standardSet('sword', L); const p0 = run(std), p5 = run(std.map((e) => ({ ...e, enhance_level: 5 }))), p10 = run(std.map((e) => ({ ...e, enhance_level: 10 })));
  assert.ok(p5.exp_gained > p0.exp_gained * 1.25 && p10.exp_gained > p5.exp_gained * 1.25, 'EXP/h climbs with enhancement');
  assert.ok(p5.gold_gained > p0.gold_gained * 1.2 && p10.gold_gained > p5.gold_gained * 1.2, 'gold/h climbs with enhancement');
});

test('minute-by-minute settlements (app open) earn about the same gold as one long settlement — no flooring loss', () => {
  const lv = 6; let c = mkChar({ level: lv }); let inv = { red_1: 1e5, blue_1: 1e5 }; const eq = starterGear(c); let sum = 0;
  for (let i = 1; i <= 240; i++) { const r = settleIdle(c, inv, eq, T0 + i * 60_000); sum += r.report.gold_gained; c = r.char; inv = r.inv; }
  const one = settleIdle(mkChar({ level: lv }), { red_1: 1e5, blue_1: 1e5 }, eq, T0 + 240 * 60_000).report.gold_gained;
  assert.ok(Math.abs(sum - one) / one < 0.15, `per-minute ${sum} vs one window ${one}`);
});

test('growth v2 lowest-first auto potion economy matches audited costs, bounded against the released baseline',()=>{
  // Growth v2 retains all prices/drop rates, caps the direct speed uplift at10%,
  // and stronger defense/MP reduces upkeep. Auto now drains tier 2 before 3/4
  // in this mixed bag (2026-10-29). Gross income and all pre-growth bounds stay fixed.
  const baseline=[[50,'sword',23100,390,21215,926],[50,'archer',20708,431,19041,817],[50,'mage',23100,578,21215,933],[70,'sword',28063,118,25773,987],[70,'archer',25157,146,23132,841],[70,'mage',28063,252,25773,950],[100,'sword',36393,144,33424,1119],[100,'archer',32625,130,29998,891],[100,'mage',36393,279,33424,984]];
  for(const [level,cls,gross,potions,oldGross,oldPotions] of baseline){
    const c=mkChar({level,base_class:cls,class_path:'A'}),r=settleIdle(c,{red_2:1e6,blue_2:1e6,red_3:1e6,blue_3:1e6,red_4:1e6,blue_4:1e6},standardSet(cls,level),T0+6*H);
    const used=Object.entries(r.report.used).reduce((sum,[key,n])=>sum+(POTIONS[key]?.price||0)*n,0);
    assert(Object.keys(r.report.used).every(key=>key==='red_2'||key==='blue_2'));
    assert.equal(r.report.gold_gained,gross,`${level} ${cls} gross`);assert.equal(used,potions,`${level} ${cls} potions`);assert.ok(gross>used);assert.ok(gross<=oldGross*1.1);assert.ok(used<=oldPotions);assert.ok((gross-used)/(oldGross-oldPotions)<1.15);
  }
});
