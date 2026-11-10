import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, standardSet } from '../src/game/stats.js';
import { ATLAS_BUILDS, ATLAS_MAPS } from '../src/game/atlas-catalog.js';
import { benchmarkAtlasRun } from '../src/game/atlas-balance.js';

function fixture(build, mapId, seed = 'sample-1') {
  const character = { id: 'anonymized-fixture', base_class: build.baseClass, level: 10, class_path: '' };
  return {
    runId: `sample-${build.id}`, realmId: 'benchmark', startAt: 0, seed,
    snapshot: { ...computeStats(character, standardSet(build.baseClass, 10)), characterId: character.id, baseClass: build.baseClass },
    buildId: build.id, supports: build.recommendedSupports, automation: build.recommendedAutomation,
    mapId, supplies: { hp: 20, mp: 20 },
  };
}

test('prototype starter recommendations complete the three tutorials in a small fixed native-stat sample', () => {
  // 12 builds × 3 authored tutorials × 3 fixed seeds. This is a regression sample,
  // not proof of endgame parity or a substitute for real population calibration.
  for (const build of ATLAS_BUILDS) for (const map of ATLAS_MAPS.filter(row => row.kind === 'tutorial')) {
    for (const seed of ['sample-1', 'sample-2', 'sample-3']) {
      const { summary, state } = benchmarkAtlasRun(fixture(build, map.id, seed));
      assert.equal(summary.status, 'completed', `${build.id}/${map.id}/${seed}`);
      assert.ok(summary.elapsedSeconds > 0);
      assert.equal(state.supplies.hp + summary.hpUsed, 20);
      assert.equal(state.supplies.mp + summary.mpUsed, 20);
      assert.ok(Number.isFinite(summary.netGoldPerActiveHour));
    }
  }
});

test('benchmark distinguishes active income from an unattended window and unavailable target materials', () => {
  const input = fixture(ATLAS_BUILDS[0], 'laurel_intro');
  const reachable = benchmarkAtlasRun(input, { target: { gold: 20, materials: { atlas_iron: 1 } } }).summary;
  assert.ok(reachable.nextUpgradeActiveSeconds > 0);
  assert.ok(reachable.netGoldPerActiveHour > reachable.netGoldPerPlannedHour);
  const unreachable = benchmarkAtlasRun(input, { target: { materials: { atlas_core: 1 } } }).summary;
  assert.equal(unreachable.nextUpgradeActiveSeconds, null);
  const defeated = benchmarkAtlasRun({ ...input, mapId: 'laurel_warden',
    snapshot: { ...input.snapshot, atk: 1, def: 0, maxHp: 1 }, supplies: { hp: 0, mp: 0 } },
  { target: { gold: 1 } }).summary;
  assert.equal(defeated.status, 'dead');
  assert.equal(defeated.nextUpgradeActiveSeconds, null);
});

test('itemized calibration charges actual high-tier and mixed-tier stock at saved prices while legacy prices remain configurable', () => {
  const build = ATLAS_BUILDS.find(row => row.id === 'sword_whirlwind');
  const input = fixture(build, 'laurel_warden', 'itemized-cost');
  const base = { ...input, queueMode: 'duration', durationSeconds: 60, automation: 'burst',
    snapshot: { ...input.snapshot, atk: 1, def: 1000000, maxHp: 10000, hp: 1, maxMp: 10000, mp: 1, mpRegenPerSecond: 0 } };
  const policy = { hpPreference: 'auto', mpPreference: 'auto', hpThresholdPct: 80, mpThresholdPct: 80, autoBlue: true };
  for (const [items, expectedCost] of [
    [{ red_4: 3, blue_4: 2 }, 219],
    [{ red_1: 1, red_2: 2, red_4: 1, blue_1: 1, blue_3: 2, blue_4: 1 }, 179],
  ]) {
    // This boss has no restoration encounters; low initial HP/MP and ample
    // defense ensure all these reserved bottles are actually used in combat.
    const { state, summary } = benchmarkAtlasRun({ ...base, supplies: { items, policy } }, { supplyPrices: { hp: 0, mp: 0 } });
    for (const [key, count] of Object.entries(items)) assert.equal(state.supplies.usedItems[key], count, key);
    assert.equal(summary.supplyGoldSpent, expectedCost);
    assert.equal(summary.netGold, summary.grossGold - expectedCost);
    assert.equal(summary.netGoldPerActiveHour, summary.netGold * 3600 / summary.elapsedSeconds);
  }
  const legacy = benchmarkAtlasRun({ ...base, supplies: { hp: 2, mp: 3 } }, { supplyPrices: { hp: 17, mp: 19 } }).summary;
  assert.ok(legacy.hpUsed > 0);
  assert.equal(legacy.supplyGoldSpent, legacy.hpUsed * 17 + legacy.mpUsed * 19);
});
