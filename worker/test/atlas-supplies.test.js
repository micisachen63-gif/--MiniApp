import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasRun, advanceAtlasRun, AtlasRuleError } from '../src/game/atlas-engine.js';
import { ATLAS_BUILDS } from '../src/game/atlas-catalog.js';
import { POTIONS } from '../src/game/constants.js';
import { ATLAS_POTION_KEYS, ATLAS_SUPPLY_RULES_VERSION, atlasSupplyPolicyForCharacter, isVersionedAtlasSupplies } from '../src/game/atlas-supplies.js';

const START = 1800000000;
const VERSION = 'atlas-supplies-v1';
const KEYS = ['red_1','red_2','red_3','red_4','blue_1','blue_2','blue_3','blue_4'];
const policy = (changes = {}) => ({ hpPreference: 'auto', mpPreference: 'auto', hpThresholdPct: 50, mpThresholdPct: 50, autoBlue: true, ...changes });
function make({ items = {}, preferences = policy(), snapshot = {}, ...overrides } = {}) {
  return createAtlasRun({ runId: 'supplies-run', realmId: 'permanent', seed: 'supplies-replay', startAt: START,
    queueMode: 'duration', durationSeconds: 600, buildId: 'sword_whirlwind', mapId: 'laurel_intro',
    snapshot: { characterId: 'supply-hero', baseClass: 'sword', level: 20, atk: 30, def: 100, maxHp: 1000, hp: 1000, maxMp: 1000, mp: 1000, mpRegenPerSecond: 0, ...snapshot },
    supplies: { items, policy: preferences }, ...overrides });
}
// One deterministic, long-lived opponent isolates automatic supply decisions
// from random encounter rewards and pauses attacks only where a test needs it.
function combat(options = {}) {
  const run = make(options);
  run.transitionSeconds = 0;
  run.hero.nextActionAt = 99999;
  run.enemies = [{ id: 'supply-target', name: 'supply target', rank: 'normal', maxHp: 1000000, hp: 1000000,
    atk: 1, def: 0, attackInterval: 10, nextAttackAt: 99999, chilledUntil: 0, dots: [] }];
  return run;
}
const step = (run, elapsed = run.elapsedSeconds + 1) => advanceAtlasRun(run, START + elapsed).state;
function settle(run, now, maxSteps) {
  const rewards = [], activities = [];
  let result;
  do {
    result = advanceAtlasRun(run, now, { maxSteps });
    run = JSON.parse(JSON.stringify(result.state));
    rewards.push(...result.rewards); activities.push(...result.activities);
  } while (result.stillCatchingUp);
  return { state: run, rewards, activities };
}
function conserved(supplies) {
  for (const key of KEYS) assert.equal(supplies.items[key] + supplies.usedItems[key], supplies.initialItems[key], key);
  for (const [color, kind] of [['hp','red'],['mp','blue']]) {
    const sum = field => KEYS.filter(key => key.startsWith(kind + '_')).reduce((total, key) => total + supplies[field][key], 0);
    assert.equal(supplies[color], sum('items'));
    assert.equal(supplies[color + 'Used'], sum('usedItems'));
    assert.equal(supplies[color + 'Initial'], sum('initialItems'));
    assert.equal(supplies[color] + supplies[color + 'Used'], supplies[color + 'Initial']);
  }
}

test('server policy snapshots normalize native per-character preferences without changing unrelated saved state', () => {
  const char = { auto_red_pct: 65, auto_blue: 1,
    special_json: JSON.stringify({ autoRedPotion: 'red_3', autoBluePotion: 'blue_2', autoBluePct: 70, learned: ['skill_1'], guardianStoneSupply: true }) };
  const before = JSON.stringify(char), saved = atlasSupplyPolicyForCharacter(char);
  assert.deepEqual(saved, policy({ hpPreference: 'red_3', mpPreference: 'blue_2', hpThresholdPct: 65, mpThresholdPct: 70 }));
  assert.equal(JSON.stringify(char), before);
  for (const special_json of ['broken', 'null', '{}', '{"autoBluePct":900,"autoRedPotion":"blue_1"}']) {
    assert.deepEqual(atlasSupplyPolicyForCharacter({ auto_red_pct: 999, auto_blue: 0, special_json }), policy({ autoBlue: false }));
  }
  assert.deepEqual(ATLAS_POTION_KEYS, KEYS); assert.equal(ATLAS_SUPPLY_RULES_VERSION, VERSION);
  assert.equal(isVersionedAtlasSupplies({ supplyRulesVersion: VERSION }), true);
  assert.equal(isVersionedAtlasSupplies({ hp: 1, mp: 1 }), false);
});

test('new supply snapshots preserve per-item quantities, server restoration/prices, policy and original inputs', () => {
  const items = { red_2: 3, blue_4: 2 }, preferences = policy({ hpPreference: 'red_2' });
  const input = { items, policy: preferences, hpRestore: 99999999, mpRestore: 99999999,
    restoreByItem: { red_2: 99999999 }, priceByItem: { red_2: 0 } };
  const run = make({ supplies: input });
  assert.equal(run.ruleset_version, 'atlas-v4');
  assert.equal(run.supplies.supplyRulesVersion, VERSION);
  assert.equal(run.supplies.hp, 3); assert.equal(run.supplies.mp, 2);
  assert.equal(run.supplies.hpRestore, 50); assert.equal(run.supplies.mpRestore, 40);
  for (const key of KEYS) {
    assert.equal(run.supplies.restoreByItem[key], POTIONS[key].heal);
    assert.equal(run.supplies.priceByItem[key], POTIONS[key].price);
  }
  items.red_2 = 999; preferences.hpPreference = 'red_4';
  assert.equal(run.supplies.items.red_2, 3); assert.equal(run.supplies.policy.hpPreference, 'red_2');
  assert.deepEqual(JSON.parse(JSON.stringify(run)), run);
  conserved(run.supplies);
});

test('partial, invalid and over-budget versioned supplies fail instead of silently becoming legacy supplies', () => {
  const invalid = [
    { items: {} }, { policy: policy() }, { items: null, policy: policy() }, { items: [], policy: policy() },
    { items: {}, policy: null }, { items: {}, policy: {} },
    { items: { red_1: -1 }, policy: policy() }, { items: { blue_1: .5 }, policy: policy() },
    { items: { red_1: 300, red_2: 201 }, policy: policy() }, { items: { blue_4: 501 }, policy: policy() },
    { items: { gold: 1 }, policy: policy() }, { items: JSON.parse('{"__proto__":1}'), policy: policy() },
    { items: {}, policy: policy({ hpPreference: 'blue_1' }) }, { items: {}, policy: policy({ mpPreference: 'red_1' }) },
    { items: {}, policy: policy({ hpThresholdPct: 19 }) }, { items: {}, policy: policy({ mpThresholdPct: 81 }) },
    { items: {}, policy: policy({ autoBlue: 1 }) },
  ];
  for (const supplies of invalid) assert.throws(() => make({ supplies }), error => error instanceof AtlasRuleError && error.code === 'atlas_invalid_supplies', JSON.stringify(supplies));
  const exact = make({ items: { red_1: 500, blue_4: 500 } });
  assert.equal(exact.supplies.hp, 500); assert.equal(exact.supplies.mp, 500);
});

test('automatic consumption exhausts the lowest owned tiers in order, including gaps, without converting item identity', () => {
  const original = combat({ items: { red_1: 2, red_2: 1, red_4: 1, blue_1: 2, blue_2: 1, blue_4: 1 },
    preferences: policy({ hpThresholdPct: 80, mpThresholdPct: 80 }),
    snapshot: { maxHp: 10000, hp: 1, maxMp: 10000, mp: 1 } });
  const before = JSON.stringify(original), spent = { red: [], blue: [] };
  let run = original;
  for (let tick = 1; tick <= 5; tick++) {
    const next = step(JSON.parse(JSON.stringify(run)));
    for (const key of KEYS) if (next.supplies.usedItems[key] > run.supplies.usedItems[key]) spent[POTIONS[key].kind].push(key);
    conserved(next.supplies); run = next;
  }
  assert.deepEqual(spent.red, ['red_1','red_1','red_2','red_4']);
  assert.deepEqual(spent.blue, ['blue_1','blue_1','blue_2','blue_4']);
  assert.equal(run.hero.hp, 851); assert.equal(run.hero.mp, 581);
  assert.equal(run.metrics.hpRestored, 850); assert.equal(run.metrics.mpRestored, 580);
  assert.equal(JSON.stringify(original), before);
});

test('explicit HP and MP choices remain exclusive after their reserved stock runs out', () => {
  const run = combat({ items: { red_1: 10, red_3: 1, red_4: 10, blue_1: 10, blue_2: 1, blue_4: 10 },
    preferences: policy({ hpPreference: 'red_3', mpPreference: 'blue_2', hpThresholdPct: 80, mpThresholdPct: 80 }),
    snapshot: { maxHp: 10000, hp: 1, maxMp: 10000, mp: 1 } });
  const result = step(run, 5);
  assert.equal(result.supplies.usedItems.red_3, 1); assert.equal(result.supplies.usedItems.blue_2, 1);
  for (const key of ['red_1','red_4','blue_1','blue_4']) assert.equal(result.supplies.items[key], 10, key);
  assert.equal(result.supplies.hpUsed, 1); assert.equal(result.supplies.mpUsed, 1);
  conserved(result.supplies);
});

test('combat thresholds match native boundaries: HP strictly below, MP at or below; travel never drinks', () => {
  const run = combat({ items: { red_1: 3, blue_1: 3 }, snapshot: { hp: 500, mp: 500 } });
  let result = step(run);
  assert.equal(result.supplies.hpUsed, 0); assert.equal(result.supplies.mpUsed, 1);
  const below = structuredClone(run); below.hero.hp = 499; below.hero.mp = 501;
  result = step(below);
  assert.equal(result.supplies.hpUsed, 1); assert.equal(result.supplies.mpUsed, 0);
  const travelling = structuredClone(below); travelling.transitionSeconds = 3;
  result = step(travelling);
  assert.equal(result.supplies.hpUsed, 0); assert.equal(result.supplies.mpUsed, 0);
});

test('disabling blue potions prevents threshold drinking and emergency skill drinking while HP remains active', () => {
  const run = combat({ items: { red_1: 3, blue_1: 3, blue_4: 3 }, preferences: policy({ autoBlue: false }),
    snapshot: { hp: 100, mp: 0 }, automation: 'burst' });
  run.hero.nextActionAt = 1;
  const result = step(run, 5);
  assert.equal(result.supplies.mpUsed, 0);
  assert.equal(result.supplies.items.blue_1, 3); assert.equal(result.supplies.items.blue_4, 3);
  assert.equal(result.metrics.casts, 0); assert.ok(result.metrics.basicAttacks > 0);
  assert.ok(result.supplies.hpUsed > 0);
});

test('normal balanced combat can reserve a bottle for an affordable skill, with at most one bottle per color per second', () => {
  const run = combat({ items: { red_1: 20, blue_1: 20 }, preferences: policy({ mpThresholdPct: 20 }),
    snapshot: { hp: 1, maxMp: 100, mp: 40, attackSpeedMultiplier: 4 }, automation: 'balanced' });
  run.hero.nextActionAt = 0;
  run.skill.cost = 60; run.skill.cooldown = .25;
  run.enemies.push({ ...run.enemies[0], id: 'supply-target-2' });
  for (const enemy of run.enemies) enemy.nextAttackAt = 1;
  const result = step(run);
  assert.equal(result.metrics.casts, 1);
  assert.equal(result.supplies.mpUsed, 1); assert.equal(result.supplies.hpUsed, 1);
  assert.equal(result.supplies.lastMpAt, 1); assert.equal(result.supplies.lastHpAt, 1);
  conserved(result.supplies);
});

test('new persisted supply snapshots replay identical state, rewards and activities for every build across JSON chunks', () => {
  for (const build of ATLAS_BUILDS) {
    const run = make({ buildId: build.id, mapId: 'grove_intro', automation: build.recommendedAutomation,
      supports: build.recommendedSupports, snapshot: { baseClass: build.baseClass, atk: 80, hp: 150, maxMp: 200, mp: 10 },
      items: { red_1: 5, red_2: 10, red_4: 5, blue_1: 5, blue_2: 10, blue_3: 5 } });
    const before = JSON.stringify(run);
    const whole = settle(run, START + 600, 2000), chunks = settle(run, START + 600, 17);
    assert.deepEqual(chunks, whole, build.id);
    conserved(whole.state.supplies);
    assert.equal(JSON.stringify(run), before);
    const retry = advanceAtlasRun(whole.state, START + 1000000);
    assert.deepEqual(retry.state, whole.state); assert.deepEqual(retry.rewards, []); assert.deepEqual(retry.activities, []);
  }
});

test('consumption uses the restoration snapshot and caps recovery at the actual missing resource', () => {
  const run = combat({ items: { red_4: 1, blue_4: 1 }, preferences: policy({ hpThresholdPct: 80, mpThresholdPct: 80 }),
    snapshot: { maxHp: 100, hp: 79, maxMp: 100, mp: 80 } });
  const result = step(run);
  assert.equal(result.hero.hp, 100); assert.equal(result.hero.mp, 100);
  assert.equal(result.metrics.hpRestored, 21); assert.equal(result.metrics.mpRestored, 20);
  const frozen = combat({ items: { red_1: 1, blue_1: 1 }, snapshot: { hp: 1, mp: 1 } });
  frozen.supplies.restoreByItem.red_1 = 7; frozen.supplies.restoreByItem.blue_1 = 9;
  const saved = step(JSON.parse(JSON.stringify(frozen)));
  assert.equal(saved.hero.hp, 8); assert.equal(saved.hero.mp, 10);
});

test('unknown or corrupted supply versions are rejected before advancing and cannot downgrade to legacy rules', () => {
  const run = make({ items: { red_1: 3 } });
  const unsupported = structuredClone(run); unsupported.supplies.supplyRulesVersion = 'future-unknown';
  assert.throws(() => step(unsupported), error => error instanceof AtlasRuleError && error.code === 'atlas_supply_rules_unsupported');
  const missing = structuredClone(run); delete missing.supplies.supplyRulesVersion;
  assert.throws(() => step(missing), error => error instanceof AtlasRuleError);
  const corrupt = structuredClone(run); corrupt.supplies.items.red_1 = 4;
  assert.throws(() => step(corrupt), error => error instanceof AtlasRuleError && error.code === 'atlas_invalid_supplies');
});

test('unversioned create callers keep the exact legacy shape and original threshold/strategy behavior', () => {
  const run = combat({ supplies: { hp: 3, mp: 4 }, snapshot: { hp: 400, mp: 500 } });
  assert.deepEqual(run.supplies, { hp: 3, mp: 4, hpInitial: 3, mpInitial: 4, hpUsed: 0, mpUsed: 0,
    hpRestore: 50, mpRestore: 40, lastHpAt: -1, lastMpAt: -1 });
  run.enemies[0].nextAttackAt = 1;
  const result = step(run);
  assert.equal(result.supplies.hpUsed, 1); assert.equal(result.supplies.mpUsed, 0);
  assert.equal(Object.hasOwn(result.supplies, 'supplyRulesVersion'), false);
});
