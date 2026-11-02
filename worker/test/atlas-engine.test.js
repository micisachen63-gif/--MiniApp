import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, standardSet } from '../src/game/stats.js';
import {
  ATLAS_BUILDS, ATLAS_MAPS, ATLAS_THEMES, ATLAS_RULESET_VERSION,
  ATLAS_MAX_DURATION_SECONDS, getAtlasCatalog,
} from '../src/game/atlas-catalog.js';
import { createAtlasRun, advanceAtlasRun, normalizeAtlasSnapshot } from '../src/game/atlas-engine.js';

const START = 1800000000;
function snapshot(baseClass = 'sword', level = 10) {
  const character = { id: `test-${baseClass}`, base_class: baseClass, level, class_path: '' };
  return { ...computeStats(character, standardSet(baseClass, level)), characterId: character.id, baseClass };
}
function make(overrides = {}) {
  return createAtlasRun({ runId: 'run-test', realmId: 'realm-test', seed: 'replay-seed', startAt: START,
    snapshot: snapshot(), buildId: 'sword_whirlwind', mapId: 'pillar_intro',
    supplies: { hp: 30, mp: 30 }, ...overrides });
}
function settle(run, now = START + ATLAS_MAX_DURATION_SECONDS, maxSteps = 2000) {
  let state = run;
  const rewards = [];
  let result;
  do {
    result = advanceAtlasRun(state, now, { maxSteps });
    state = result.state; rewards.push(...result.rewards);
  } while (result.stillCatchingUp);
  return { state, rewards };
}

test('catalog retains all twelve legacy themes and twelve distinct class build mechanisms', () => {
  assert.equal(ATLAS_THEMES.length, 12);
  assert.equal(ATLAS_BUILDS.length, 12);
  for (const baseClass of ['sword', 'archer', 'mage', 'thief']) assert.equal(ATLAS_BUILDS.filter(build => build.baseClass === baseClass).length, 3);
  assert.equal(ATLAS_MAPS.length, 4);
  assert.deepEqual(ATLAS_MAPS.at(-1).prerequisites, ['grove_intro']);
  const catalog = getAtlasCatalog();
  catalog.builds[0].coefficient = 999;
  assert.notEqual(getAtlasCatalog().builds[0].coefficient, 999);
  assert.equal(catalog.rulesVersion, ATLAS_RULESET_VERSION);
  assert.equal(catalog.balanceStatus, 'prototype');
});

test('snapshots preserve server stats including enhanced gear and do not apply native hit scaling twice', () => {
  const character = { id: 'legacy-hero', base_class: 'thief', level: 30, class_path: 'A' };
  const equipment = standardSet('thief', 30).map(item => ({ ...item, enhance_level: 9 }));
  const before = JSON.stringify({ character, equipment });
  const stats = computeStats(character, equipment);
  const normalized = normalizeAtlasSnapshot({ ...stats, characterId: character.id, baseClass: 'thief' });
  const run = make({ snapshot: normalized, buildId: 'thief_poison' });
  assert.equal(run.snapshot.atk, stats.atk);
  assert.equal(run.snapshot.hitAttackMultiplier, .6);
  settle(run);
  assert.equal(JSON.stringify({ character, equipment }), before);
  assert.deepEqual(JSON.parse(JSON.stringify(run)), run);
});

test('settlement uses elapsed seconds, is pure, and retries cannot reroll combat or receipts', () => {
  const run = make();
  const before = JSON.stringify(run);
  const a = advanceAtlasRun(run, START + 10.9);
  assert.equal(a.state.elapsedSeconds, 10);
  assert.equal(a.processedAt, START + 10);
  assert.equal(a.state.metrics.travelSeconds, 10);
  assert.deepEqual(advanceAtlasRun(run, START + 10.9), a);
  const final = settle(run);
  assert.equal(JSON.stringify(run), before);
  assert.deepEqual(settle(run), final);
  const retry = advanceAtlasRun(final.state, START + ATLAS_MAX_DURATION_SECONDS);
  assert.deepEqual(retry.state, final.state);
  assert.deepEqual(retry.rewards, []);
  assert.equal(retry.steps, 0);
  assert.equal(retry.stillCatchingUp, false);
  assert.equal(new Set(final.rewards.map(row => row.id)).size, final.rewards.length);
  assert.equal(final.rewards.reduce((sum, row) => sum + row.gold, 0), final.state.totals.gold);
});

test('all builds produce identical full state and reward order under arbitrary settlement partitions', () => {
  for (const build of ATLAS_BUILDS) {
    const run = make({ snapshot: snapshot(build.baseClass), buildId: build.id, supports: build.recommendedSupports,
      mapId: 'grove_intro', mapCount: 3, automation: build.recommendedAutomation });
    const whole = settle(run, START + 1600);
    let state = run;
    const rewards = [];
    for (const elapsed of [0, .5, 1, 13.7, 27, 27, 44.2, 71, 183, 399.9, 401, 800, 1600]) {
      const part = settle(state, START + elapsed, 137);
      state = part.state; rewards.push(...part.rewards);
    }
    assert.deepEqual(state, whole.state, build.id);
    assert.deepEqual(rewards, whole.rewards, build.id);
  }
});

test('bounded chunks retain overdue seconds and equal uninterrupted simulation including JSON persistence', () => {
  const run = make({ mapCount: 4 });
  const partial = advanceAtlasRun(run, START + 1000, { maxSteps: 19 });
  assert.equal(partial.steps, 19);
  assert.equal(partial.processedAt, START + 19);
  assert.equal(partial.stillCatchingUp, true);
  const rest = settle(JSON.parse(JSON.stringify(partial.state)), START + 1000, 37);
  const whole = settle(run, START + 1000);
  assert.deepEqual(rest.state, whole.state);
  assert.deepEqual([...partial.rewards, ...rest.rewards], whole.rewards);
  assert.throws(() => advanceAtlasRun(run, START + 1000, { maxSteps: 2001 }), /maxSteps/);
});

test('eight hour limit is absolute across calls and years offline cannot farm unbounded rewards', () => {
  const run = make({ mapId: 'laurel_warden', mapCount: 96,
    snapshot: { characterId: 'slow', baseClass: 'sword', level: 10, atk: 0, def: 1000000, maxHp: 1000000, maxMp: 0 },
    profile: { id: 'time-cap-fixture', enemyHpMultiplier: 100 }, supplies: { hp: 0, mp: 0 } });
  const result = settle(run, START + 10 * 365 * 86400);
  assert.equal(result.state.status, 'expired');
  assert.equal(result.state.elapsedSeconds, ATLAS_MAX_DURATION_SECONDS);
  assert.equal(result.state.metrics.combatSeconds + result.state.metrics.travelSeconds, ATLAS_MAX_DURATION_SECONDS);
  assert.equal(result.state.supplies.hpUsed, 0);
  assert.equal(result.state.supplies.mpUsed, 0);
  assert.equal(result.rewards.length, 0);
  assert.deepEqual(advanceAtlasRun(result.state, START + 20 * 365 * 86400).state, result.state);
});

test('death stops the entire queue and never consumes remaining supplies on retries', () => {
  const run = make({ mapId: 'grove_intro', mapCount: 96,
    snapshot: { characterId: 'fragile', baseClass: 'sword', level: 10, atk: 1, def: 0, maxHp: 1, maxMp: 0 },
    supplies: { hp: 99, mp: 99 } });
  const result = settle(run);
  assert.equal(result.state.status, 'dead');
  assert.equal(result.state.hero.hp, 0);
  assert.equal(result.state.metrics.mapsCompleted, 0);
  assert.ok(result.state.elapsedSeconds < 60);
  assert.equal(result.state.supplies.hp, 99);
  assert.equal(result.state.supplies.mp, 99);
  assert.deepEqual(advanceAtlasRun(result.state, START + 99999999).state, result.state);
});

test('defeat in a later room preserves only already cleared room receipts', () => {
  const result = settle(make({ seed: 'partial-death', snapshot: snapshot('thief'), buildId: 'thief_poison',
    supports: ['lasting', 'wide'], mapId: 'grove_intro', mapCount: 3, supplies: { hp: 5, mp: 5 } }));
  assert.equal(result.state.status, 'dead');
  assert.ok(result.state.metrics.roomsCleared > 0);
  assert.equal(result.rewards.length, result.state.metrics.roomsCleared);
  assert.equal(result.state.metrics.mapsCompleted, 0);
  assert.ok(result.rewards.every(row => row.kind === 'room'));
  assert.equal(result.rewards.reduce((sum, row) => sum + row.gold, 0), result.state.totals.gold);
  assert.equal(result.state.supplies.hpUsed + result.state.supplies.hp, 5);
  assert.equal(result.state.supplies.mpUsed + result.state.supplies.mp, 5);
  assert.equal(advanceAtlasRun(result.state, START + 864000).rewards.length, 0);
});

test('a final poison tick credits the boss, completion, and guaranteed core exactly once', () => {
  const run = make({ seed: '0', snapshot: snapshot('thief'), buildId: 'thief_poison', supports: ['lasting', 'wide'],
    mapId: 'laurel_warden', supplies: { hp: 20, mp: 20 } });
  const result = settle(run);
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.events.filter(row => row.type === 'enemy_defeated').at(-1).source, 'dot');
  assert.equal(result.state.metrics.kills, 1);
  assert.equal(result.rewards.length, 2);
  assert.equal(result.state.totals.materials.atlas_core, 1);
  assert.equal(result.rewards.filter(row => row.kind === 'completion').length, 1);
  assert.deepEqual(settle(run, START + 28800, 1), result);
  assert.equal(advanceAtlasRun(result.state, START + 28800).rewards.length, 0);
});

test('a skill above maximum mana falls back without burning unusable blue supplies', () => {
  const run = make({ snapshot: { ...snapshot(), maxMp: 2, mp: 1, mpRegenPerSecond: 0 },
    mapId: 'laurel_warden', automation: 'burst' });
  const result = advanceAtlasRun(run, START + 30).state;
  assert.equal(result.metrics.casts, 0);
  assert.ok(result.metrics.basicAttacks > 0);
  assert.equal(result.supplies.mpUsed, 0);
});

test('supports and automation alter targets, mana budgets, and combat outcomes rather than labels', () => {
  const base = { snapshot: snapshot('sword', 10), mapId: 'pillar_intro', automation: 'burst' };
  const wide = settle(make({ ...base, supports: ['wide'] })).state;
  const focused = settle(make({ ...base, supports: ['focused'] })).state;
  assert.equal(wide.status, 'completed');
  assert.equal(focused.status, 'completed');
  assert.ok(wide.metrics.packCombatSeconds < focused.metrics.packCombatSeconds);
  const bossWide = settle(make({ ...base, mapId: 'laurel_warden', supports: ['wide'] })).state;
  const bossFocused = settle(make({ ...base, mapId: 'laurel_warden', supports: ['focused'] })).state;
  assert.ok(bossFocused.metrics.bossCombatSeconds < bossWide.metrics.bossCombatSeconds);
  const mage = { snapshot: snapshot('mage'), buildId: 'mage_chain', mapId: 'grove_intro', mapCount: 3 };
  const burst = settle(make({ ...mage, automation: 'burst' })).state;
  const conserve = settle(make({ ...mage, automation: 'conserve' })).state;
  assert.ok(burst.metrics.casts > conserve.metrics.casts);
  assert.ok(burst.supplies.mpUsed > conserve.supplies.mpUsed);
  assert.ok(burst.metrics.packCombatSeconds < conserve.metrics.packCombatSeconds);
});

test('poison, shields, block counters, summons, traps, execute and combos are exercised by real encounters', () => {
  const checks = [
    ['thief_poison', 'dotDamage'], ['mage_frost', 'shieldAbsorbed'], ['sword_counter', 'counterDamage'],
    ['archer_beast', 'petDamage'], ['archer_trap', 'trapsTriggered'], ['thief_execute', 'executeHits'], ['thief_combo', 'comboBursts'],
  ];
  for (const [buildId, metric] of checks) {
    const build = ATLAS_BUILDS.find(row => row.id === buildId);
    const result = settle(make({ snapshot: snapshot(build.baseClass, 20), buildId, mapId: 'laurel_warden', automation: 'burst' })).state;
    assert.equal(result.status, 'completed', buildId);
    assert.ok(result.metrics[metric] > 0, `${buildId}: ${metric}`);
  }
});

test('stronger existing equipment improves fixed maps without secretly increasing enemy health', () => {
  const base = snapshot('sword');
  const weak = make({ snapshot: base, mapId: 'laurel_warden' });
  const strong = make({ snapshot: { ...base, atk: base.atk * 2, def: base.def * 2 } , mapId: 'laurel_warden' });
  const weakSpawn = advanceAtlasRun(weak, START + 15).state;
  const strongSpawn = advanceAtlasRun(strong, START + 15).state;
  assert.deepEqual(strongSpawn.enemies, weakSpawn.enemies);
  const a = settle(weak).state, b = settle(strong).state;
  assert.ok(b.elapsedSeconds < a.elapsedSeconds);
  assert.ok(b.supplies.hpUsed <= a.supplies.hpUsed);
  const weakMap = settle(make({ snapshot: base })).state;
  const strongMap = settle(make({ snapshot: { ...base, atk: base.atk * 2, def: base.def * 2 } })).state;
  assert.equal(strongMap.metrics.damage, weakMap.metrics.damage, 'encounter RNG is independent of the number of player hits');
});

test('invalid cross-class loadouts, unsupported versions and non-finite values fail before simulation', () => {
  assert.throws(() => make({ buildId: 'mage_chain' }), error => error.code === 'atlas_invalid_build');
  assert.throws(() => make({ supports: ['lasting'] }), error => error.code === 'atlas_invalid_support');
  assert.throws(() => make({ supports: ['wide', 'wide'] }), error => error.code === 'atlas_invalid_support');
  assert.throws(() => make({ mapCount: 97 }), /mapCount/);
  assert.throws(() => make({ durationSeconds: 28801 }), /durationSeconds/);
  assert.throws(() => make({ seed: undefined }), /seed/);
  assert.throws(() => make({ snapshot: { ...snapshot(), atk: Infinity } }), /atk/);
  assert.throws(() => advanceAtlasRun({ ...make(), ruleset_version: 'unknown-v9' }, START + 99), error => error.code === 'atlas_ruleset_unsupported');
  assert.throws(() => advanceAtlasRun(make(), START - 1), error => error.code === 'atlas_clock_before_start');
});
