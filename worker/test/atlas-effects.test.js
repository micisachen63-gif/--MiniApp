import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, standardSet } from '../src/game/stats.js';
import { ELEMENT_KEYS } from '../src/game/constants.js';
import { resistanceRate } from '../src/game/elements.js';
import { ATLAS_BUILDS } from '../src/game/atlas-catalog.js';
import { createAtlasRun, advanceAtlasRun, AtlasRuleError } from '../src/game/atlas-engine.js';
import {
  ATLAS_EFFECTS_RULES_VERSION as VERSION, createAtlasEffects,
  atlasOutgoingDamage, atlasIncomingDamage, atlasManaCost,
} from '../src/game/atlas-effects.js';

const START = 1800000000;
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' != ' + b);
const xorshift = value => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; };
const baseSnapshot = () => ({
  characterId: 'effects-hero', baseClass: 'sword', level: 30, atk: 100, def: 0,
  maxHp: 10000, maxMp: 1000, mpRegenPerSecond: 0, pct: { critPct: -.9 },
});
function make({ snapshot = {}, ...overrides } = {}) {
  return createAtlasRun({
    runId: 'effects-run', realmId: 'permanent', seed: 'effects-replay', startAt: START,
    buildId: 'sword_whirlwind', mapId: 'laurel_intro', durationSeconds: 900,
    queueMode: 'duration', automation: 'burst', supports: [], supplies: { hp: 0, mp: 0 },
    effectsRulesVersion: VERSION, snapshot: { ...baseSnapshot(), ...snapshot }, ...overrides,
  });
}
function combat(options = {}) {
  const run = make(options);
  run.transitionSeconds = 0;
  run.enemies = [{ id: 'effects-target', name: 'effects target', rank: 'normal',
    maxHp: 1000000, hp: 1000000, atk: 100, def: 10, attackInterval: 10,
    nextAttackAt: 99999, chilledUntil: 0, dots: [] }];
  return run;
}
const step = (run, elapsed = run.elapsedSeconds + 1) => advanceAtlasRun(run, START + elapsed).state;
function settle(run, elapsed = 900, maxSteps = 2000) {
  const rewards = [], activities = [];
  let result;
  do {
    result = advanceAtlasRun(run, START + elapsed, { maxSteps });
    run = clone(result.state);
    rewards.push(...result.rewards); activities.push(...result.activities);
  } while (result.stillCatchingUp);
  return { state: run, rewards, activities };
}

test('server computed native element values retain +N, per-hit scaling and input immutability', () => {
  const char = { id: 'native-thief', base_class: 'thief', class_path: 'A', level: 30 };
  const gear = standardSet('thief', 30).map(row => ({ ...row, enhance_level: 9 }));
  gear[0].element = 'wind'; gear[0].element_stat = 40;
  gear[1].element = 'earth'; gear[1].element_stat = 100;
  gear[0].affix_json = JSON.stringify({ expPct: .25, freeCastPct: .5, elemPct: .2 });
  const before = JSON.stringify({ char, gear });
  const stats = computeStats(char, gear);
  const input = { ...stats, characterId: char.id, baseClass: 'thief' };
  const run = make({ snapshot: input, buildId: 'thief_poison' });
  assert.equal(run.snapshot.atk, stats.atk);
  assert.equal(run.effects.actor.weaponElem, stats.weaponElem);
  assert.equal(run.effects.actor.element, 'wind');
  assert.deepEqual(run.effects.actor.elementResist, stats.elementResist);
  assert.deepEqual(run.effects.actor.elementResistance, stats.elementResistance);
  assert.equal(run.effects.actor.pct.expPct, stats.pct.expPct);
  assert.equal(run.effects.actor.pct.freeCastPct, stats.pct.freeCastPct);
  input.elementResist.earth = 0; input.pct.freeCastPct = 0;
  assert.notEqual(run.effects.actor.elementResist.earth, 0);
  assert.equal(run.effects.actor.pct.freeCastPct, .5);
  assert.equal(JSON.stringify({ char, gear }), before);
});

test('element matchups, native weapon cap and favorable-only elemPct use the shared formula', () => {
  const effect = changes => createAtlasEffects(VERSION, { level: 30, element: 'water', weaponElem: 20, ...changes }, { themeId: 5 }, 'numbers');
  const state = { effects: effect({}) };
  close(atlasOutgoingDamage(state, 100, 'skill'), 150);
  state.effects = effect({ weaponElem: 200 });
  close(atlasOutgoingDamage(state, 100, 'skill'), 187.5);
  state.effects = effect({ pct: { elemPct: .2 } });
  close(atlasOutgoingDamage(state, 100, 'skill'), 174);
  state.effects.enemy.element = 'earth';
  close(atlasOutgoingDamage(state, 100, 'skill'), 102);
  state.effects.actor.element = null;
  close(atlasOutgoingDamage(state, 100, 'skill'), 100);
  state.effects = effect({});
  state.effects.enemy.elementResist.water = 100;
  state.effects.enemy.level = 30;
  close(atlasOutgoingDamage(state, 100, 'skill'), 150 * (1 - 100 / 380));
});

test('point-only, rate-only and dual resistance inputs apply one canonical reduction', () => {
  const rate = 100 / 380;
  const build = fields => ({ effects: createAtlasEffects(VERSION, { level: 30, ...fields }, { themeId: 1 }, 'resistance') });
  const points = build({ elementResist: { earth: 100 } });
  const rates = build({ elementResistance: { earth: rate } });
  const both = build({ elementResist: { earth: 100 }, elementResistance: { earth: rate } });
  for (const state of [points, rates, both]) close(atlasIncomingDamage(state, 100), 100 * (1 - rate));
  const staleRate = build({ elementResist: { earth: 100 }, elementResistance: { earth: .1 } });
  close(staleRate.effects.actor.elementResistance.earth, rate);
  const cap = build({ elementResist: { earth: 1000000 } });
  close(atlasIncomingDamage(cap, 100), 60);
  close(build({ elementResistance: { earth: .4 } }).effects.actor.elementResistance.earth, .4);
});

test('native percentage caps and zero enemy resistance are frozen without retuning bosses', () => {
  const run = make({ mapId: 'laurel_warden', snapshot: { pct: { elemPct: 2, expPct: 2, freeCastPct: 2 } } });
  assert.deepEqual(run.effects.actor.pct, { elemPct: .5, expPct: .5, freeCastPct: 1 });
  assert.equal(run.effects.enemy.element, 'earth');
  for (const key of ELEMENT_KEYS) assert.equal(run.effects.enemy.elementResist[key], 0);
  assert.deepEqual(make({ snapshot: { pct: { elemPct: -.2, freeCastPct: -.2 } } }).effects.actor.pct,
    { elemPct: 0, expPct: 0, freeCastPct: 0 });
  assert.throws(() => createAtlasEffects(VERSION, { level: 1 }, { themeId: 999 }, 'bad'), /map theme/);
});

test('invalid source numbers and unknown effect versions reject creation before a run exists', () => {
  for (const snapshot of [
    { element: 'unknown' }, { weaponElem: -1 }, { weaponElem: NaN },
    { elementResist: { earth: Infinity } }, { elementResistance: { earth: .41 } },
    { elementResist: [] }, { pct: { expPct: NaN } }, { pct: { freeCastPct: Infinity } },
  ]) assert.throws(() => make({ snapshot }), error => error instanceof AtlasRuleError);
  assert.throws(() => make({ effectsRulesVersion: 'future-effects' }), error => error.code === 'atlas_effects_unsupported');
});

test('persisted new effect state is validated without repairing or mutating corrupt snapshots', () => {
  const valid = make();
  const damage = [
    run => { run.effects = null; },
    run => { delete run.effects; },
    run => { delete run.effects.version; },
    run => { run.effects.version = 'unknown'; },
    run => { delete run.effects.actor.weaponElem; },
    run => { run.effects.actor.weaponElem = undefined; },
    run => { run.effects.enemy.element = undefined; },
    run => { delete run.effects.actor.elementResist.earth; },
    run => { run.effects.actor.elementResistance.earth = .2; },
    run => { delete run.effects.actor.pct.freeCastPct; },
    run => { run.effects.actor.pct.freeCastPct = 2; },
    run => { run.effects.actor.level++; },
    run => { run.effects.manaRng = 0; },
    run => { run.effects.manaRng = NaN; },
    run => { delete run.metrics.freeCasts; },
    run => { run.metrics.freeCasts = 1; },
  ];
  for (const mutate of damage) {
    const run = structuredClone(valid); mutate(run);
    const before = structuredClone(run);
    assert.throws(() => advanceAtlasRun(run, START + 1), error => error instanceof AtlasRuleError);
    assert.deepEqual(run, before);
  }
});

test('neutral new effects preserve all twelve builds and the original combat/loot RNG sequences', () => {
  for (const build of ATLAS_BUILDS) {
    const input = { buildId: build.id, supports: build.recommendedSupports,
      snapshot: { baseClass: build.baseClass, atk: 110, def: 100, maxHp: 10000, maxMp: 1000 } };
    const original = settle(make({ ...input, effectsRulesVersion: undefined }), 900);
    const current = settle(make(input), 900);
    assert.equal(current.state.metrics.freeCasts, 0);
    delete current.state.metrics.freeCasts; delete current.state.effects;
    assert.deepEqual(current, original, build.id);
  }
});

test('actual basic and skill hits apply elements once after critical raw damage and before DEF', () => {
  const attack = type => {
    const run = combat({ snapshot: { element: 'wind', weaponElem: 20 } });
    if (type === 'basic') run.hero.nextSkillAt = 99999;
    return step(run);
  };
  assert.equal(attack('basic').metrics.damage, Math.round((70 + 20) * 1.25 / 1.4));
  assert.equal(attack('skill').metrics.damage, Math.round((135 + 20) * 1.25 / 1.4));
  const crit = combat({ snapshot: { element: 'wind', weaponElem: 20, pct: { critPct: .75 } } });
  crit.combatRng = 1; // first deterministic roll is below the .8 cap
  assert.equal(step(crit).metrics.damage, Math.round((135 * 1.7 + 20) * 1.25 / 1.4));
});

test('DOT, pets and block-triggered counters keep matchups without repeated flat weapon bonuses', () => {
  const dot = combat({ snapshot: { element: 'wind', weaponElem: 20 } });
  dot.hero.nextActionAt = 99999;
  dot.enemies[0].dots.push({ source: 'poison', remaining: 3, damage: 100, appliedAt: 0 });
  assert.equal(step(dot).metrics.dotDamage, 125);
  const pet = combat({ snapshot: { element: 'wind', weaponElem: 20 } });
  pet.hero.nextActionAt = 99999;
  pet.hero.pets.push({ remaining: 5, nextAttackAt: 1, damage: 100 });
  assert.equal(step(pet).metrics.petDamage, Math.round(125 / 1.4));
  const counter = combat({ buildId: 'sword_counter', snapshot: { element: 'wind', weaponElem: 20 } });
  counter.hero.nextActionAt = 99999; counter.skill.blockChance = 1;
  counter.enemies[0].nextAttackAt = 1;
  assert.equal(step(counter).metrics.counterDamage, Math.round(95 * 1.25 / 1.4));
});

test('a delayed trap applies its direct weapon element bonus at trigger, not again at placement', () => {
  const run = combat({ buildId: 'archer_trap', snapshot: { baseClass: 'archer', element: 'wind', weaponElem: 20 } });
  const planted = step(run);
  assert.equal(planted.metrics.damage, 0); assert.equal(planted.hero.traps.length, 1);
  planted.hero.nextActionAt = 99999;
  const triggered = step(planted, 3);
  assert.equal(triggered.metrics.trapsTriggered, 1);
  assert.equal(triggered.metrics.damage, Math.round((280 + 20) * 1.25 / 1.4));
  assert.equal(triggered.hero.traps.length, 0);
});

test('incoming resistance precedes shield absorption and only actual HP loss is counted', () => {
  const run = combat({ snapshot: { maxHp: 1000, elementResist: { earth: 100 } } });
  run.hero.nextActionAt = 99999; run.hero.shield = 20;
  run.enemies[0].nextAttackAt = 1;
  const next = step(run);
  assert.equal(next.metrics.shieldAbsorbed, 20);
  assert.equal(next.metrics.damageTaken, Math.round(100 * (1 - 100 / 380)) - 20);
  assert.equal(next.hero.hp, 1000 - next.metrics.damageTaken);
  assert.equal(next.content.mapHpDamage, next.metrics.damageTaken);
});

test('100% free multi-target casts roll once, keep cooldown/healing, and do not move critical RNG', () => {
  const run = combat({ snapshot: { hp: 500, maxHp: 1000, mp: 6,
    pct: { critPct: -.9, freeCastPct: 1, healPerCastPct: .1 } } });
  run.enemies = Array.from({ length: 3 }, (_, i) => ({ ...clone(run.enemies[0]), id: 'multi-' + i }));
  const rng = run.effects.manaRng, critRng = run.combatRng;
  const next = step(run);
  assert.equal(next.metrics.casts, 1); assert.equal(next.metrics.freeCasts, 1);
  assert.equal(next.metrics.manaSpent, 0); assert.equal(next.hero.mp, 6);
  assert.equal(next.hero.hp, 600); assert.equal(next.hero.nextSkillAt, 3);
  assert.equal(next.effects.manaRng, xorshift(rng));
  assert.equal(next.combatRng, xorshift(xorshift(xorshift(critRng))));
});

test('free casts never bypass mana affordability, strategy or cooldown gates', () => {
  for (const mode of ['insufficient', 'strategy', 'cooldown', 'too-expensive']) {
    const run = combat({ snapshot: { mp: mode === 'insufficient' ? 5 : 6,
      maxMp: mode === 'too-expensive' ? 6 : 1000, pct: { freeCastPct: 1, critPct: -.9 } } });
    if (mode === 'strategy') run.automation = 'conserve';
    if (mode === 'cooldown') run.hero.nextSkillAt = 99999;
    if (mode === 'too-expensive') run.skill.cost = 7;
    const rng = run.effects.manaRng;
    const next = step(run);
    assert.equal(next.metrics.casts, 0, mode);
    assert.equal(next.metrics.freeCasts, 0, mode);
    assert.equal(next.effects.manaRng, rng, mode);
    assert.equal(next.metrics.basicAttacks, 1, mode);
  }
});

test('free-mana boundary is strict and zero chance consumes no dedicated random number', () => {
  const run = make();
  const rng = run.effects.manaRng, roll = xorshift(rng) / 4294967296;
  assert.equal(atlasManaCost(run, 6), 6);
  assert.equal(run.effects.manaRng, rng);
  run.effects.actor.pct.freeCastPct = roll;
  assert.equal(atlasManaCost(run, 6), 6);
  assert.equal(run.effects.manaRng, xorshift(rng));
  run.effects.manaRng = rng; run.effects.actor.pct.freeCastPct = roll + Number.EPSILON;
  assert.equal(atlasManaCost(run, 6), 0);
  assert.equal(run.effects.manaRng, xorshift(rng));
});

test('expPct multiplies room and completion EXP before one final floor and no other reward', () => {
  const input = { queueMode: 'count', mapCount: 1, profile: { experienceMultiplier: 1.15, goldMultiplier: 1.3 },
    snapshot: { atk: 10000, def: 1000, pct: { expPct: .25, critPct: -.9 } } };
  const boosted = settle(make(input));
  const plain = settle(make({ ...input, snapshot: { ...input.snapshot, pct: { expPct: 0, critPct: -.9 } } }));
  assert.equal(boosted.state.status, 'completed');
  assert.ok(boosted.rewards.some(row => row.kind === 'room'));
  assert.ok(boosted.rewards.some(row => row.kind === 'completion'));
  for (const row of boosted.rewards) assert.equal(row.exp, row.kind === 'room' ? 17 : 43);
  assert.equal(boosted.state.totals.exp, boosted.rewards.reduce((sum, row) => sum + row.exp, 0));
  assert.deepEqual(boosted.rewards.map(({ exp, ...row }) => row), plain.rewards.map(({ exp, ...row }) => row));
  assert.deepEqual(boosted.state.metrics, plain.state.metrics);
  assert.deepEqual(boosted.state.content.rng, plain.state.content.rng);
  const retry = advanceAtlasRun(boosted.state, START + 9000);
  assert.deepEqual(retry.state, boosted.state); assert.deepEqual(retry.rewards, []);
});

test('new effects replay deterministically across twelve builds, arbitrary chunks and JSON persistence', () => {
  for (const build of ATLAS_BUILDS) {
    const run = make({ buildId: build.id, supports: build.recommendedSupports, mapId: 'grove_intro',
      snapshot: { baseClass: build.baseClass, atk: 200, def: 1000, maxHp: 10000,
        element: 'fire', weaponElem: 25, elementResist: { wind: 80 },
        pct: { freeCastPct: .37, expPct: .27, elemPct: .2 } },
      supplies: { items: { red_2: 20, blue_2: 20 }, policy: {
        hpPreference: 'auto', mpPreference: 'auto', hpThresholdPct: 50, mpThresholdPct: 50, autoBlue: true } } });
    const before = JSON.stringify(run), whole = settle(run);
    let state = run; const rewards = [], activities = [];
    for (const elapsed of [0, .5, 13, 40.2, 137, 301, 601, 900]) {
      const part = settle(state, elapsed, 19);
      state = clone(part.state); rewards.push(...part.rewards); activities.push(...part.activities);
    }
    assert.deepEqual({ state, rewards, activities }, whole, build.id);
    assert.equal(JSON.stringify(run), before);
    assert.ok(state.metrics.casts > 0, build.id);
    assert.ok(state.metrics.freeCasts > 0, build.id);
    const retry = advanceAtlasRun(state, START + 9999999);
    assert.deepEqual(retry.rewards, [], build.id);
    assert.deepEqual(retry.state, state, build.id);
  }
});
