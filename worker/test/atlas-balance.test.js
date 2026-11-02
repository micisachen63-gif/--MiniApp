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
