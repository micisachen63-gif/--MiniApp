import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ATLAS_BUILDS } from '../src/game/atlas-catalog.js';
import { createAtlasRun, advanceAtlasRun } from '../src/game/atlas-engine.js';

const START = 1800000000;
function make(buildId = 'sword_whirlwind', overrides = {}) {
  const build = ATLAS_BUILDS.find(row => row.id === buildId);
  return createAtlasRun({
    runId: 'trace-' + build.id, realmId: 'trace-realm', seed: 'trace-replay', startAt: START,
    durationSeconds: 240, queueMode: 'duration', buildId: build.id, mapId: 'grove_intro',
    supports: build.recommendedSupports, automation: 'burst', supplies: { hp: 20, mp: 20 },
    snapshot: {
      characterId: 'actor-' + build.baseClass, baseClass: build.baseClass, level: 10,
      atk: 50, def: 30, maxHp: 10000, hp: 9000, maxMp: 3000, mp: 3000,
      attackSpeedMultiplier: 1.6, mpRegenPerSecond: 5,
      pct: { critPct: .25, lifestealPct: .05, healPerCastPct: .02 },
    },
    ...overrides,
  });
}

// Captured before observer changes from atlas-engine.js SHA-256
// 8f131f77d72803059678fb47f0d21c3a63e327d1d849e617d2dad62491441d82.
// These fingerprints cover the full legacy return, including all RNG streams,
// rewards, summaries, clocks and state keys, not just visible damage totals.
const GOLDEN_HASHES = {
  "sword_whirlwind:trace-replay": "bd914ef9180299f3ef00413aeddf5d1d3103326a2e8581ffcd088b72793129f7",
  "sword_whirlwind:trace-second-seed": "ab4ea0499d2474d5e2fc776e8373be74d06f1b1a1863076e20ee66b7b2b1afd2",
  "sword_bleed:trace-replay": "aa26e0f8994d2dbb0ea27c2d395cd870248557a4d53b5422abe5d7bf2d3238a7",
  "sword_bleed:trace-second-seed": "905abdce88c83903137d39cf4a62fe9202226d631a9debe6a729cb0a95210603",
  "sword_counter:trace-replay": "6cb184c1a10f89f1290c0b924952fe903b95a01aacf9cee13f0dc2f80f534400",
  "sword_counter:trace-second-seed": "05d752a892b227e6b158ac24a630ec764d13fcd27c69aa0b578f7e986cc1e07d",
  "archer_pierce:trace-replay": "6e6442374292b13cbf01869fb66749a1b20075549a9d5bd3ff1f6d7ce8109265",
  "archer_pierce:trace-second-seed": "68b915c9c68d4f02349355f3f390b4fd6ffe1da2ec7bdf6abb7e7a3dd202e17b",
  "archer_beast:trace-replay": "0ea66c6de5269575c01535e9bd3874f339f9d40bb23adb3d45bd2cc72af5cade",
  "archer_beast:trace-second-seed": "d0dc57094f26a2bb9bf83d50812a0e191432cd94264feb8d12e6cb8d312c1192",
  "archer_trap:trace-replay": "fe80ed0877e8e9b184bfae8d3345b45ff949ecc9cdb960d114480057bca48eed",
  "archer_trap:trace-second-seed": "22c40e46e240a292a08d70b84dee70bc75a9c485fbece46988eaf3c09fa06a60",
  "mage_chain:trace-replay": "2257a7e8bdb48524f639c073b4f25b3bfb699bed876c2d4f6aceb101672c4ed5",
  "mage_chain:trace-second-seed": "e84e0a210096580c7bc5454c8bc125d8061e6e8f277a3888fc1e0a7678dceb6b",
  "mage_frost:trace-replay": "66ab5ca4ededfd392adbb2dc6063854d4f9b6f24772314ce22c59a4a15ee9761",
  "mage_frost:trace-second-seed": "af1a95140e74cca9f188b80ad819e7c18c7ff17d51bc82a3bcbdd19256d35cfc",
  "mage_arcane:trace-replay": "68d6158370b24d0bab395eb30ae0739b9f5180e81a4c14bf40eb0bbb89d56535",
  "mage_arcane:trace-second-seed": "18e74a415abe6775e43a19dc1fa6264a342835468293403a49d350a16f298a17",
  "thief_poison:trace-replay": "9b479d8f6501c6f26e79acfdfb3acaef8495e803c2e23678b6453406a34bc3a4",
  "thief_poison:trace-second-seed": "5f775538babbda6c6db608c5e4dd7398f6c8105f597e46223eaa4fad15b813d4",
  "thief_execute:trace-replay": "0cb05ab2db7f553762b2a601bb5c75e53f98377b042c022613f1d9ca216d52a7",
  "thief_execute:trace-second-seed": "7637521cd78e0ed0f2d9ed1f37e5d52384db64b7080734a802045bcddb73ed3c",
  "thief_combo:trace-replay": "b6a45b2519129789edf7ec550df55b771ca7a3909452ff2f659e7537689d32b7",
  "thief_combo:trace-second-seed": "21191d5b2cd57675705a954c451c957ba4187426bd0a25ca6e21c621527b81e6"
};

const BASELINES = JSON.parse(readFileSync(new URL('./fixtures/atlas-observer-baselines-20261104.json', import.meta.url), 'utf8'));

function withoutTrace(result) {
  const { combatTrace, ...legacy } = result;
  return legacy;
}

function arena(buildId) {
  const run = make(buildId, { supports: [] });
  run.elapsedSeconds = 10;
  run.processedAt = START + 10;
  run.transitionSeconds = 0;
  run.hero.nextActionAt = 10.25;
  run.hero.nextSkillAt = 0;
  run.enemies = Array.from({ length: 3 }, (_, index) => ({
    id: '0:0:' + index, name: 'Observed target ' + index, rank: 'normal',
    maxHp: 10000, hp: 10000, atk: 5, def: 0, attackInterval: 4,
    nextAttackAt: 1000, chilledUntil: 0, dots: [],
  }));
  return run;
}

function advanceParts(run, checkpoints, maxSteps = 17) {
  let state = structuredClone(run);
  const rewards = [], activities = [], events = [];
  let total = 0;
  for (const elapsed of checkpoints) {
    let result;
    do {
      result = advanceAtlasRun(state, START + elapsed, { maxSteps, combatTrace: { limit: 256 } });
      rewards.push(...result.rewards);
      activities.push(...result.activities);
      events.push(...result.combatTrace.events);
      total += result.combatTrace.total;
      state = JSON.parse(JSON.stringify(result.state));
    } while (result.stillCatchingUp);
  }
  return { state, rewards, activities, events, total };
}

test('all 12 legacy v3 builds and two seeds retain the original pre-observer full results', () => {
  for (const build of ATLAS_BUILDS) {
    for (const seed of ['trace-replay', 'trace-second-seed']) {
      const fixture = BASELINES.v3.find(row => row.key === build.id + ':' + seed);
      assert.ok(fixture);
      const run = structuredClone(fixture.run), before = structuredClone(run);
      const off = advanceAtlasRun(run, START + 240);
      const { activities, ...legacy } = off;
      assert.deepEqual(activities, [], 'legacy runs never create v4 activities');
      assert.equal(Object.hasOwn(off, 'combatTrace'), false);
      assert.equal(createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),
        GOLDEN_HASHES[build.id + ':' + seed], build.id + ' must retain the pre-change replay');
      assert.deepEqual(advanceAtlasRun(run, START + 240, { combatTrace: false }), off);
      const on = advanceAtlasRun(run, START + 240, { combatTrace: true });
      assert.deepEqual(withoutTrace(on), off, build.id + ' observer must not affect the legacy result');
      for (const stream of ['combatRng', 'encounterRng', 'lootRng']) assert.equal(on.state[stream], off.state[stream]);
      assert.deepEqual(run, before, 'observation must not mutate the input snapshot');
      assert.equal(Object.hasOwn(on.state, 'combatTrace'), false);
      assert.equal(Object.hasOwn(on.state, 'combatEvents'), false);
    }
  }
});

test('committed v4 baseline keeps all six RNG streams, activity and equipment receipts identical with tracing', () => {
  assert.equal(BASELINES.baselines.v4.commit, 'e4908c02f858c27d992a8efb0199a9c3c9a2cd1e');
  assert.equal(BASELINES.v4.length, 27);
  for (const fixture of BASELINES.v4) {
    const before = JSON.stringify(fixture.run);
    const off = advanceAtlasRun(fixture.run, fixture.now);
    assert.equal(createHash('sha256').update(JSON.stringify(off)).digest('hex'), fixture.expectedSha256, fixture.key);
    for (const option of [true, { limit: 1 }]) {
      const on = advanceAtlasRun(fixture.run, fixture.now, { combatTrace: option });
      assert.deepEqual(withoutTrace(on), off, fixture.key + ' complete v4 result');
      assert.deepEqual(on.state.content.rng, off.state.content.rng, 'content RNG');
      for (const stream of ['combatRng', 'encounterRng', 'lootRng']) assert.equal(on.state[stream], off.state[stream]);
    }
    assert.equal(JSON.stringify(fixture.run), before);
    if (fixture.key.startsWith('survey:')) {
      assert.ok(off.state.totals.equipment > 0, fixture.key + ' exercises actual equipment blueprints');
      assert.ok(Object.values(off.state.totals.items).some(value => value > 0), fixture.key + ' exercises actual scroll drops');
      assert.ok(off.activities.length > 0);
    }
  }
});

test('real Atlas casts expose IDs, actual hit outcomes and millisecond resolution without invented coordinates', () => {
  assert.equal(ATLAS_BUILDS.length, 12);
  for (const build of ATLAS_BUILDS) {
    const run = make(build.id);
    const result = advanceAtlasRun(run, START + run.map.entrySeconds + 12, { combatTrace: { limit: 256 } });
    const trace = result.combatTrace, casts = trace.events.filter(event => event.type === 'skill_cast');
    assert.equal(trace.dropped, 0, build.id + ' fixture must retain all its observations');
    assert.equal(casts.length, result.state.metrics.casts, build.id + ' must record one event per paid cast');
    assert.ok(casts.length > 0);
    assert.equal(new Set(trace.events.map(event => event.eventId)).size, trace.events.length);
    for (const event of trace.events) {
      assert.equal(event.actorId, run.snapshot.characterId);
      assert.equal(event.skillId, 'atlas:' + build.id);
      assert.equal(event.atMs, event.resolvedAtMs);
      assert.equal(event.resolutionMs, 1000);
      assert.ok(Number.isSafeInteger(event.atMs) && Number.isSafeInteger(event.scheduledAtMs));
      assert.ok(event.scheduledAtMs <= event.resolvedAtMs);
      assert.equal(Object.hasOwn(event, 'from'), false);
      assert.equal(Object.hasOwn(event, 'to'), false);
      assert.deepEqual(event.targetIds, [...new Set(event.hits.map(hit => hit.targetId))]);
      if (event.type === 'skill_cast') {
        assert.equal(event.mpSpent, run.skill.cost);
        assert.ok(Math.abs(event.mpBefore - event.mpAfter - event.mpSpent) < 1e-6);
        if (build.mechanic !== 'trap') assert.ok(event.hits.length > 0);
      } else {
        assert.equal(event.type, 'skill_effect');
        assert.ok(['dot', 'pet', 'trap', 'counter'].includes(event.effectKind));
        assert.ok(event.hits.length > 0);
      }
      for (const hit of event.hits) {
        assert.ok(hit.damage > 0);
        assert.equal(hit.hpBefore - hit.hpAfter, hit.damage);
        assert.equal(typeof hit.critical, 'boolean');
        assert.equal(hit.source, event.type === 'skill_cast' ? 'skill' : event.effectKind);
        if (hit.source === 'dot' || hit.source === 'pet') assert.equal(hit.critical, false);
      }
    }
  }
});

test('event IDs and complete records survive arbitrary settlement chunks and JSON persistence', () => {
  for (const build of ATLAS_BUILDS) {
    const run = make(build.id);
    const whole = advanceAtlasRun(run, START + 240, { combatTrace: { limit: 256 } });
    const part = advanceParts(run, [0, .5, 1, 17, 38.2, 57, 57, 118, 240]);
    assert.deepEqual(part.state, whole.state, build.id);
    assert.deepEqual(part.rewards, whole.rewards, build.id);
    assert.deepEqual(part.activities, whole.activities, build.id + ' activity receipts are chunk invariant');
    assert.deepEqual(part.events.slice(-256), whole.combatTrace.events, build.id + ' stable tick/phase/ordinal identities');
    assert.equal(part.total, whole.combatTrace.total);
    assert.equal(new Set(part.events.map(event => event.eventId)).size, part.events.length);
    assert.deepEqual(advanceAtlasRun(run, START + 240, { combatTrace: { limit: 256 } }), whole);
    const retry = advanceAtlasRun(part.state, START + 240, { combatTrace: true });
    assert.deepEqual(retry.combatTrace.events, []);
    assert.equal(retry.combatTrace.total, 0);
  }
});

test('third-cast combo retargeting records the three actual capped hits as one cast', () => {
  const run = arena('thief_combo');
  run.hero.combo = 2;
  run.enemies[0].hp = 1;
  run.enemies[1].hp = 1;
  const result = advanceAtlasRun(run, START + 11, { combatTrace: true });
  const [cast] = result.combatTrace.events;
  assert.equal(result.combatTrace.events.length, 1);
  assert.equal(cast.type, 'skill_cast');
  assert.equal(result.state.metrics.casts, 1);
  assert.equal(result.state.metrics.comboBursts, 1);
  assert.deepEqual(cast.targetIds, ['0:0:0', '0:0:1', '0:0:2']);
  assert.deepEqual(cast.hits.map(hit => hit.targetId), cast.targetIds);
  assert.equal(cast.hits[0].damage, 1);
  assert.equal(cast.hits[1].damage, 1);
  assert.equal(cast.hits[0].hpAfter, 0);
  assert.equal(cast.hits[1].hpAfter, 0);
  assert.equal(cast.scheduledAtMs, START * 1000 + 10250);
  assert.equal(cast.atMs, START * 1000 + 11000);
});

test('trap placement has no target and only the later real trigger records damaging effects', () => {
  const run = arena('archer_trap');
  const first = advanceAtlasRun(run, START + 11, { combatTrace: true });
  const [cast] = first.combatTrace.events;
  assert.equal(first.combatTrace.events.length, 1);
  assert.equal(cast.type, 'skill_cast');
  assert.deepEqual(cast.targetIds, []);
  assert.deepEqual(cast.hits, []);
  const result = advanceAtlasRun(run, START + 13, { combatTrace: true });
  const traps = result.combatTrace.events.filter(event => event.effectKind === 'trap');
  assert.equal(traps.length, 1);
  assert.equal(traps[0].type, 'skill_effect');
  assert.equal(traps[0].atMs, START * 1000 + 13000);
  assert.equal(traps[0].scheduledAtMs, traps[0].atMs);
  assert.deepEqual(traps[0].targetIds, ['0:0:0', '0:0:1', '0:0:2']);
  assert.equal(traps[0].hits.length, 3);
  assert.equal(result.combatTrace.events.filter(event => event.type === 'skill_cast').length, 1);
});

test('a hawk follow-up is a pet effect and never an additional summon cast', () => {
  const run = arena('archer_beast');
  const first = advanceAtlasRun(run, START + 11, { combatTrace: true });
  assert.equal(first.combatTrace.events.length, 1);
  assert.equal(first.combatTrace.events[0].type, 'skill_cast');
  assert.equal(first.combatTrace.events[0].hits.length, 1, 'the existing summon cast really has a direct hit');
  const result = advanceAtlasRun(run, START + 13, { combatTrace: true });
  const pets = result.combatTrace.events.filter(event => event.effectKind === 'pet');
  assert.equal(pets.length, 1);
  assert.equal(pets[0].type, 'skill_effect');
  assert.equal(pets[0].actorId, run.snapshot.characterId);
  assert.equal(pets[0].scheduledAtMs, START * 1000 + 13000);
  assert.equal(pets[0].hits[0].source, 'pet');
  assert.equal(pets[0].hits[0].critical, false);
  assert.equal(result.combatTrace.events.filter(event => event.type === 'skill_cast').length, result.state.metrics.casts);
  assert.equal(pets.reduce((sum, event) => sum + event.hits.reduce((n, hit) => n + hit.damage, 0), 0), result.state.metrics.petDamage);
});

test('poison and bleed tick only after application and report actual non-critical damage', () => {
  for (const buildId of ['thief_poison', 'sword_bleed']) {
    const run = arena(buildId);
    const first = advanceAtlasRun(run, START + 11, { combatTrace: true });
    assert.equal(first.combatTrace.events.some(event => event.type === 'skill_effect'), false);
    const result = advanceAtlasRun(run, START + 12, { combatTrace: true });
    const dots = result.combatTrace.events.filter(event => event.effectKind === 'dot');
    assert.equal(dots.length, 1);
    assert.equal(dots[0].atMs, START * 1000 + 12000);
    assert.equal(dots[0].hits[0].critical, false);
    assert.equal(dots[0].hits[0].damage, result.state.metrics.dotDamage);
  }
});

test('only successful surviving block responses are recorded as counter effects', () => {
  const run = arena('sword_counter');
  for (const enemy of run.enemies) enemy.nextAttackAt = 11;
  const result = advanceAtlasRun(run, START + 20, { combatTrace: { limit: 256 } });
  assert.ok(result.state.metrics.blocks > 0, 'fixed seed must exercise a real block');
  const counters = result.combatTrace.events.filter(event => event.effectKind === 'counter');
  assert.equal(counters.length, result.state.metrics.blocks);
  assert.equal(counters.reduce((sum, event) => sum + event.hits.reduce((n, hit) => n + hit.damage, 0), 0), result.state.metrics.counterDamage);
  assert.ok(counters.every(event => event.type === 'skill_effect' && event.hits.length === 3));
});

test('basic attacks never masquerade as native skills or paid Atlas casts', () => {
  const run = arena('mage_arcane');
  run.hero.mp = 0;
  run.snapshot.mpRegenPerSecond = 0;
  run.supplies.mp = 0;
  const result = advanceAtlasRun(run, START + 12, { combatTrace: true });
  assert.ok(result.state.metrics.basicAttacks > 0);
  assert.ok(result.state.metrics.damage > 0);
  assert.equal(result.state.metrics.casts, 0);
  assert.deepEqual(result.combatTrace.events, []);
});

test('recent-event caps drop only observations and never change simulation or event identity', () => {
  const run = arena('thief_poison');
  const whole = advanceAtlasRun(run, START + 240, { combatTrace: { limit: 256 } });
  assert.ok(whole.combatTrace.total > 256, 'stress fixture must overflow the hard cap');
  for (const [option, expectedLimit] of [[true, 128], [{ limit: 8 }, 8], [{ limit: 1e9 }, 256], [{ limit: 0 }, 1], [{ limit: NaN }, 128]]) {
    const result = advanceAtlasRun(run, START + 240, { combatTrace: option });
    assert.equal(result.combatTrace.limit, expectedLimit);
    assert.equal(result.combatTrace.events.length, expectedLimit);
    assert.equal(result.combatTrace.dropped, result.combatTrace.total - expectedLimit);
    assert.deepEqual(result.combatTrace.events, whole.combatTrace.events.slice(-expectedLimit));
    assert.deepEqual(withoutTrace(result), withoutTrace(whole));
  }
  const persisted = JSON.stringify(whole.state);
  whole.combatTrace.events[0].targetIds.push('unrelated');
  whole.combatTrace.events[0].hits[0].damage = -999;
  assert.equal(JSON.stringify(whole.state), persisted, 'trace outcomes hold no live state references');
});

test('saved v1 and v2 runs can be observed without a migration or extra persisted fields', () => {
  for (const filename of ['atlas-v1-resume.json', 'atlas-v2-resume.json']) {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/' + filename, import.meta.url), 'utf8'));
    const input = fixture.partial;
    const now = input.processedAt + 120;
    const off = advanceAtlasRun(input, now);
    const on = advanceAtlasRun(input, now, { combatTrace: true });
    assert.deepEqual(withoutTrace(on), off, filename);
    assert.deepEqual(Object.keys(on.state), Object.keys(off.state));
    assert.equal(Object.hasOwn(on.state, 'combatTrace'), false);
  }
});
