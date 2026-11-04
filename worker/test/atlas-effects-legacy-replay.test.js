import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { advanceAtlasRun } from '../src/game/atlas-engine.js';

// These expected bytes were generated in the separate, clean 8370ce7 worktree.
// Do not regenerate them with the effects-enabled implementation under test.
const BASELINE = '8370ce7c11f09f44146c3bade06df6b5b7d33ff0';
const SOURCE_MANIFEST_SHA = '62ac74f700c94357570ef2f78fd40c34840caa77c1c43cf2d531f70c04159d5a';
const BASELINE_ENGINE_SHA = '63d275217f7c9b34416de889afb58d8535f77ee3b4307a78e66bf89e76061613';
const BUILDS = [
  'sword_whirlwind', 'sword_bleed', 'sword_counter',
  'archer_pierce', 'archer_beast', 'archer_trap',
  'mage_chain', 'mage_frost', 'mage_arcane',
  'thief_poison', 'thief_execute', 'thief_combo',
];
const SUPPLY_MODES = ['legacy-starter', 'atlas-supplies-v1'];
const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/atlas-v4-effects-legacy-20261104.json', import.meta.url), 'utf8'));
const json = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function finish(initial, now, maxSteps) {
  let state = initial;
  const rewards = [], activities = [];
  for (let attempt = 0; attempt < 1000; attempt++) {
    const before = JSON.stringify(state);
    const part = advanceAtlasRun(state, now, { maxSteps });
    assert.equal(JSON.stringify(state), before, 'advancing a saved run must not mutate its input');
    state = json(part.state);
    rewards.push(...part.rewards);
    activities.push(...part.activities);
    if (!part.stillCatchingUp) return { state, rewards, activities };
    assert.ok(part.steps > 0, 'a catch-up chunk must make progress');
  }
  assert.fail('saved fixture did not finish within its bounded chunk budget');
}

function assertExpected(result, fixture) {
  const expected = fixture.expected;
  assert.equal(sha(result.state), expected.finalStateSha256, 'entire serialized final state stays byte-identical');
  assert.equal(sha(result.rewards), expected.remainingRewardsSha256, 'remaining reward receipts stay byte-identical');
  assert.equal(sha(result.activities), expected.remainingActivitiesSha256, 'remaining quest activities stay byte-identical');
  assert.equal(result.rewards.length, expected.remainingRewardCount);
  assert.equal(result.activities.length, expected.remainingActivityCount);
  assert.equal(result.state.status, expected.status);
  assert.equal(result.state.elapsedSeconds, expected.elapsedSeconds);
  assert.deepEqual(result.state.metrics, expected.metrics);
  assert.deepEqual({
    encounterRng: result.state.encounterRng,
    combatRng: result.state.combatRng,
    lootRng: result.state.lootRng,
    content: result.state.content.rng,
  }, expected.rng, 'old random streams cannot gain an effects roll');
  assert.deepEqual(Object.keys(result.state), Object.keys(fixture.partialState), 'no new run fields are added to a saved run');
  assert.deepEqual(Object.keys(result.state.snapshot), Object.keys(fixture.partialState.snapshot), 'old snapshot shape is retained');
  assert.deepEqual(Object.keys(result.state.snapshot.pct), Object.keys(fixture.partialState.snapshot.pct), 'discarded native bonuses are not retrofitted');

  const allRewards = [...fixture.alreadyEarned.rewards, ...result.rewards];
  const allActivities = [...fixture.alreadyEarned.activities, ...result.activities];
  assert.equal(sha(allRewards), expected.cumulativeRewardsSha256);
  assert.equal(sha(allActivities), expected.cumulativeActivitiesSha256);
  assert.equal(allRewards.length, expected.cumulativeRewardCount);
  assert.equal(allActivities.length, expected.cumulativeActivityCount);
  assert.equal(new Set(allRewards.map(row => row.id)).size, allRewards.length, 'saved and newly earned receipts do not overlap');
  assert.equal(new Set(allActivities.map(row => row.kind + '|' + row.sourceId)).size, allActivities.length, 'saved and newly earned activities do not overlap');
  assert.equal(allRewards.reduce((sum, row) => sum + row.exp, 0), result.state.totals.exp);
  assert.equal(allRewards.reduce((sum, row) => sum + row.gold, 0), result.state.totals.gold);
  assert.deepEqual({ hp: result.state.supplies.hpUsed, mp: result.state.supplies.mpUsed }, expected.supplyUsage);

  const retried = advanceAtlasRun(json(result.state), fixture.now + 86400);
  assert.deepEqual(retried.state, result.state, 'terminal retries do not upgrade the saved snapshot');
  assert.deepEqual(retried.rewards, []);
  assert.deepEqual(retried.activities, []);
  assert.equal(retried.steps, 0);
  assert.equal(retried.stillCatchingUp, false);
}

test('legacy v4 fixtures pin the committed pre-effects sources and both supply histories for all twelve builds', () => {
  assert.equal(golden.schemaVersion, 1);
  assert.equal(golden.baselineCommit, BASELINE);
  assert.equal(golden.sourceManifestSha256, SOURCE_MANIFEST_SHA);
  assert.equal(sha(golden.sources), SOURCE_MANIFEST_SHA);
  assert.equal(golden.sources.find(row => row.path === 'worker/src/game/atlas-engine.js')?.committedSha256, BASELINE_ENGINE_SHA);
  assert.equal(new Set(golden.sources.map(row => row.path)).size, golden.sources.length);
  for (const source of golden.sources) {
    assert.match(source.gitBlobId, /^[a-f0-9]{40}$/);
    assert.match(source.committedSha256, /^[a-f0-9]{64}$/);
    assert.match(source.workingSha256, /^[a-f0-9]{64}$/);
    assert.ok(source.committedBytes > 0);
  }
  assert.equal(golden.fixtures.length, 24);
  assert.deepEqual(golden.fixtures.map(row => row.id).sort(),
    SUPPLY_MODES.flatMap(mode => BUILDS.map(build => mode + '/' + build)).sort());
  for (const fixture of golden.fixtures) {
    assert.equal(fixture.partialState.ruleset_version, 'atlas-v4');
    assert.equal(fixture.partialState.status, 'running');
    assert.equal(fixture.partialState.elapsedSeconds, 137);
    assert.ok(fixture.partialState.metrics.combatSeconds > 0);
    assert.ok(fixture.partialState.metrics.casts > 0);
    assert.equal(sha(fixture.partialState), fixture.partialStateSha256);
    assert.equal(fixture.creationInput.snapshot.pct.expPct, .25);
    assert.equal(fixture.creationInput.snapshot.pct.freeCastPct, .5);
    assert.equal(Object.hasOwn(fixture.partialState.snapshot.pct, 'expPct'), false);
    assert.equal(Object.hasOwn(fixture.partialState.snapshot.pct, 'freeCastPct'), false);
    assert.equal(fixture.partialState.supplies.supplyRulesVersion ?? null,
      fixture.supplyMode === 'legacy-starter' ? null : 'atlas-supplies-v1');
  }
});

for (const fixture of golden.fixtures) {
  test('saved v4 ' + fixture.id + ' preserves original bytes, receipts and RNG through JSON resume', () => {
    const before = JSON.stringify(fixture);
    const whole = finish(json(fixture.partialState), fixture.now, 2000);
    assertExpected(whole, fixture);

    let state = json(fixture.partialState);
    const rewards = [], activities = [];
    const start = state.startedAt, elapsed = state.elapsedSeconds;
    const targets = [
      start + elapsed, start + elapsed + .75, start + elapsed + 1,
      start + elapsed + 19.7, start + elapsed + 19.7,
      start + elapsed + 89, start + elapsed + 379.2, fixture.now,
    ];
    for (const [index, now] of targets.entries()) {
      const part = finish(json(state), now, [7, 31, 137][index % 3]);
      state = part.state;
      rewards.push(...part.rewards);
      activities.push(...part.activities);
    }
    const partitioned = { state, rewards, activities };
    assertExpected(partitioned, fixture);
    assert.deepEqual(partitioned, whole, 'arbitrary read and settlement partitions do not change the result');
    assert.equal(JSON.stringify(fixture), before, 'golden input is never mutated');
  });
}
