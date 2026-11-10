import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { mulberry32 } from '../src/game/rng.js';
import { advanceAtlasRun } from '../src/game/atlas-engine.js';
import * as P from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';

async function fixture(t, flags = {}) {
  const env = { DB: freshDb(), ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent' }, ...flags };
  t.after(() => env.DB.sqlite.close());
  const account = '81991';
  const initial = await P.createCharacter(env,
    { tgId: account, name: '施放事件測試', gender: 'm', baseClass: 'sword' }, T0, mulberry32(7));
  const id = initial.char.tg_id;
  const started = await Atlas.start(env, id, {
    requestId: 'trace-service-start', mapId: 'laurel_intro', mapCount: 1,
    durationMinutes: 60, supplies: { hp: 20, mp: 20 },
  }, T0);
  return { env, db: env.DB.sqlite, account, id, started };
}
const readRun = (db, id) => db.prepare(
  'SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1'
).get(id);
const stateOf = (db, id) => JSON.parse(readRun(db, id).state_json);
const changes = db => db.prepare('SELECT total_changes() AS n').get().n;
const isRunCommit = stmt => /^\s*UPDATE\s+rpg_atlas_runs\s+SET\s+status\s*=/i.test(stmt.sql);

// Check all rows, including operation/quest receipts and player assets. SQLite
// total_changes() may include rolled-back statements, so it is not a rollback
// oracle; only the read-only tests use that counter.
function snapshot(db) {
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(row => row.name);
  return Object.fromEntries(names.map(name => {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    const rows = db.prepare('SELECT * FROM ' + quoted).all()
      .map(row => JSON.parse(JSON.stringify(row)))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return [name, rows];
  }));
}

function expectedEnvelope(trace, { account, id, run, now, revision }) {
  assert.equal(trace.schemaVersion, 1);
  assert.equal(trace.source, 'committed-combat');
  assert.deepEqual(trace.context, {
    accountId: account, realmId: 'permanent', characterId: id, dispatchId: run.id,
  });
  assert.equal(trace.revision, revision);
  assert.equal(trace.committedAtMs, now);
  assert.equal(trace.resolutionMs, 1000);
  assert.equal(trace.limit, 128);
  assert.ok(trace.events.length > 0 && trace.events.length <= 128);
  assert.equal(trace.events.length + trace.dropped, trace.total);
  const originalState = JSON.parse(run.state_json);
  for (const event of trace.events) {
    assert.equal(event.actorId, id);
    assert.equal(event.skillId, 'atlas:' + originalState.buildId);
    assert.equal(event.atMs, event.resolvedAtMs);
    assert.ok(event.scheduledAtMs <= event.resolvedAtMs);
    assert.equal(Object.hasOwn(event, 'from'), false);
    assert.equal(Object.hasOwn(event, 'to'), false);
    assert.equal(Object.hasOwn(event, 'revision'), false, 'revision belongs to the commit envelope');
    for (const hit of event.hits) {
      assert.equal(hit.hpBefore - hit.hpAfter, hit.damage);
      assert.ok(hit.damage > 0);
      assert.equal(typeof hit.critical, 'boolean');
    }
  }
}

test('a trace becomes observable only after the real CAS transaction commits', { timeout: 10000 }, async t => {
  const { env, db, account, id } = await fixture(t);
  const originalRun = readRun(db, id), originalState = stateOf(db, id), now = T0 + 120000;
  const expected = advanceAtlasRun(originalState, Math.floor(now / 1000), { maxSteps: 2000 });
  const originalBatch = env.DB.batch.bind(env.DB);
  let release, entered, published = false;
  const gate = new Promise(resolve => { release = resolve; });
  const atBatch = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  env.DB.batch = async statements => {
    if (statements.some(isRunCommit)) { entered(); await gate; }
    return originalBatch(statements);
  };
  const pending = Atlas.settle(env, id, {}, now).then(result => { published = true; return result; });
  await atBatch;
  assert.equal(published, false);
  assert.deepEqual(readRun(db, id), originalRun);
  release();
  const result = await pending, saved = readRun(db, id);
  expectedEnvelope(result.combatTrace, { account, id, run: originalRun, now, revision: Number(originalRun.rev) + 1 });
  assert.equal(result.combatTrace.revision, saved.rev);
  assert.deepEqual(stateOf(db, id), expected.state, 'persisted combat is identical to observation-disabled rules');
  assert.equal(Object.hasOwn(stateOf(db, id), 'combatTrace'), false);
  assert.equal(Object.hasOwn(stateOf(db, id), 'combatEvents'), false);
});

test('status stays read-only and never exposes or reconstructs combatTrace', async t => {
  const { env, db, id, started } = await fixture(t);
  assert.equal(Object.hasOwn(started, 'combatTrace'), false);
  const before = snapshot(db), writes = changes(db);
  for (const now of [T0, T0 + 60000, T0 + 3600000]) {
    const result = await Atlas.status(env, id, now);
    assert.equal(Object.hasOwn(result, 'combatTrace'), false);
    assert.equal(Object.hasOwn(result.scene?.run || {}, 'combatTrace'), false);
  }
  assert.equal(changes(db), writes);
  assert.deepEqual(snapshot(db), before);
});

test('no-op and already-committed settlement reads have no trace and perform no writes', async t => {
  const { env, db, id } = await fixture(t);
  let before = snapshot(db), writes = changes(db);
  assert.equal(Object.hasOwn(await Atlas.settle(env, id, {}, T0), 'combatTrace'), false);
  assert.equal(changes(db), writes);
  assert.deepEqual(snapshot(db), before);
  const committed = await Atlas.settle(env, id, {}, T0 + 120000);
  assert.ok(committed.combatTrace);
  before = snapshot(db); writes = changes(db);
  assert.equal(Object.hasOwn(await Atlas.settle(env, id, {}, T0 + 120000), 'combatTrace'), false);
  assert.equal(changes(db), writes);
  assert.deepEqual(snapshot(db), before);
});

test('three real CAS guard failures publish no trace and roll back every table', async t => {
  const { env, db, id } = await fixture(t);
  const before = snapshot(db), originalBatch = env.DB.batch.bind(env.DB);
  let attempts = 0, published;
  env.DB.batch = async statements => {
    const index = statements.findIndex(isRunCommit);
    if (index < 0) return originalBatch(statements);
    attempts++;
    const altered = [...statements], stmt = statements[index], bindings = [...stmt.params];
    bindings[bindings.length - 1] = Number(bindings.at(-1)) + 1;
    altered[index] = env.DB.prepare(stmt.sql).bind(...bindings);
    return originalBatch(altered);
  };
  await assert.rejects(
    Atlas.settle(env, id, {}, T0 + 120000).then(value => { published = value; return value; }),
    error => error.code === 'conflict' && !Object.hasOwn(error, 'combatTrace'),
  );
  assert.equal(attempts, 3);
  assert.equal(published, undefined);
  assert.deepEqual(snapshot(db), before);
});

test('a genuine concurrent commit discards the failed attempt and publishes only its successful remainder', async t => {
  const { env, db, id } = await fixture(t, {
    ATLAS_PROFILE_JSON: JSON.stringify({
      id: 'trace-cas-test', enemyHpMultiplier: 100, enemyDefenseMultiplier: 100, enemyDamageMultiplier: .05,
    }),
  });
  const originalRun = readRun(db, id), originalState = stateOf(db, id);
  const midNow = T0 + (originalState.map.entrySeconds + 12) * 1000, finalNow = midNow + 30000;
  const originalBatch = env.DB.batch.bind(env.DB);
  let injected = false, middle, afterMiddle, failedBatches = 0, runBatches = 0;
  env.DB.batch = async statements => {
    if (statements.some(isRunCommit)) {
      runBatches++;
      if (!injected) {
        injected = true;
        middle = await Atlas.settle(env, id, {}, midNow);
        afterMiddle = stateOf(db, id);
      }
    }
    try { return await originalBatch(statements); }
    catch (error) { if (statements.some(isRunCommit)) failedBatches++; throw error; }
  };
  const result = await Atlas.settle(env, id, {}, finalNow);
  assert.equal(failedBatches, 1);
  assert.equal(runBatches, 3, 'middle commit, stale attempt and successful retry all hit the real batch');
  assert.ok(middle.combatTrace.events.length > 0);
  const expected = advanceAtlasRun(afterMiddle, Math.floor(finalNow / 1000), { maxSteps: 2000, combatTrace: true });
  assert.deepEqual(result.combatTrace.events, expected.combatTrace.events);
  assert.equal(result.combatTrace.total, expected.combatTrace.total);
  assert.equal(result.combatTrace.dropped, expected.combatTrace.dropped);
  assert.equal(result.combatTrace.revision, Number(originalRun.rev) + 2);
  assert.equal(readRun(db, id).rev, result.combatTrace.revision);
  assert.deepEqual(stateOf(db, id), expected.state);
  const committedEarlier = new Set(middle.combatTrace.events.map(event => event.eventId));
  assert.ok(result.combatTrace.events.every(event => !committedEarlier.has(event.eventId)));
});

test('a late reward failure rolls back the state and does not publish its computed cast events', async t => {
  const { env, db, id } = await fixture(t);
  const now = T0 + 1800000;
  const expected = advanceAtlasRun(stateOf(db, id), Math.floor(now / 1000), { maxSteps: 2000 });
  assert.ok(expected.rewards.length > 0, 'fixture must reach a real reward statement');
  db.exec("CREATE TRIGGER trace_test_fail_reward BEFORE INSERT ON rpg_ledger WHEN NEW.type='星圖掉落' BEGIN SELECT RAISE(ABORT,'trace_test_reward_failure'); END");
  const before = snapshot(db);
  let published;
  await assert.rejects(
    Atlas.settle(env, id, {}, now).then(value => { published = value; return value; }),
    error => /trace_test_reward_failure/.test(error.message) && !Object.hasOwn(error, 'combatTrace'),
  );
  assert.equal(published, undefined);
  assert.deepEqual(snapshot(db), before);
});

test('a committed response loss never replays combatTrace through status or a retry', async t => {
  const { env, db, id } = await fixture(t);
  const now = T0 + 120000, expected = advanceAtlasRun(stateOf(db, id), Math.floor(now / 1000), { maxSteps: 2000 });
  const originalBatch = env.DB.batch.bind(env.DB);
  let lost = false, published;
  env.DB.batch = async statements => {
    const result = await originalBatch(statements);
    if (!lost && statements.some(isRunCommit)) {
      lost = true;
      throw new Error('trace-response-lost-after-commit');
    }
    return result;
  };
  await assert.rejects(
    Atlas.settle(env, id, {}, now).then(value => { published = value; return value; }),
    /trace-response-lost-after-commit/,
  );
  assert.equal(published, undefined);
  assert.equal(lost, true);
  assert.deepEqual(stateOf(db, id), expected.state);
  const saved = snapshot(db), writes = changes(db);
  assert.equal(Object.hasOwn(await Atlas.status(env, id, now), 'combatTrace'), false);
  assert.equal(Object.hasOwn(await Atlas.settle(env, id, {}, now), 'combatTrace'), false);
  assert.equal(changes(db), writes);
  assert.deepEqual(snapshot(db), saved);
});

test('post-commit status may read a newer scene without relabelling or mixing the earlier trace', async t => {
  const { env, db, account, id } = await fixture(t, {
    ATLAS_PROFILE_JSON: JSON.stringify({
      id: 'trace-read-skew-test', enemyHpMultiplier: 100, enemyDefenseMultiplier: 100, enemyDamageMultiplier: .05,
    }),
  });
  const originalRun = readRun(db, id), originalState = stateOf(db, id);
  const firstNow = T0 + (originalState.map.entrySeconds + 12) * 1000;
  // Let the ordinary balanced build regenerate enough mana for a distinct
  // second cast batch while the long-lived fixture keeps the same dispatch.
  const secondNow = firstNow + 240000;
  const firstExpected = advanceAtlasRun(originalState, Math.floor(firstNow / 1000), { maxSteps: 2000, combatTrace: true });
  const secondExpected = advanceAtlasRun(firstExpected.state, Math.floor(secondNow / 1000), { maxSteps: 2000, combatTrace: true });
  assert.ok(firstExpected.combatTrace.events.length > 0);
  assert.ok(secondExpected.combatTrace.events.length > 0, 'both commits must have real, distinguishable cast events');

  const originalBatch = env.DB.batch.bind(env.DB);
  let injected = false, successfulCommits = 0, afterFirst, second;
  env.DB.batch = async statements => {
    const result = await originalBatch(statements);
    if (statements.some(isRunCommit)) {
      successfulCommits++;
      if (!injected) {
        injected = true;
        // A is already committed. Commit B before resolving A's batch promise,
        // so A's subsequent SELECTs really observe revision N+1 in SQLite.
        afterFirst = readRun(db, id);
        assert.equal(afterFirst.rev, Number(originalRun.rev) + 1);
        assert.deepEqual(JSON.parse(afterFirst.state_json), firstExpected.state);
        second = await Atlas.settle(env, id, {}, secondNow);
      }
    }
    return result;
  };

  const first = await Atlas.settle(env, id, {}, firstNow);
  const firstRevision = Number(originalRun.rev) + 1, secondRevision = firstRevision + 1;
  assert.equal(successfulCommits, 2, 'this is two successful transactions, not a CAS failure/retry');
  expectedEnvelope(first.combatTrace, { account, id, run: originalRun, now: firstNow, revision: firstRevision });
  expectedEnvelope(second.combatTrace, { account, id, run: afterFirst, now: secondNow, revision: secondRevision });
  assert.equal(first.scene.run.revision, secondRevision);
  assert.equal(second.scene.run.revision, secondRevision);
  assert.equal(readRun(db, id).rev, secondRevision);
  assert.ok(first.combatTrace.revision < first.scene.run.revision, 'the earlier committed trace remains valid alongside the newer scene');

  for (const response of [first, second]) {
    const context = response.combatTrace.context;
    assert.equal(context.accountId, response.scene.accountId);
    assert.equal(context.realmId, response.scene.realmId);
    assert.equal(context.characterId, response.scene.characterId);
    assert.equal(context.dispatchId, response.scene.run.id);
  }
  for (const key of ['events', 'limit', 'dropped', 'total']) {
    assert.deepEqual(first.combatTrace[key], firstExpected.combatTrace[key], 'A keeps only its committed observations: ' + key);
    assert.deepEqual(second.combatTrace[key], secondExpected.combatTrace[key], 'B keeps only its committed observations: ' + key);
  }
  const secondIds = new Set(second.combatTrace.events.map(event => event.eventId));
  assert.ok(first.combatTrace.events.every(event => !secondIds.has(event.eventId)));
  assert.equal(first.scene.run.processedAt, secondExpected.state.processedAt * 1000);
  assert.deepEqual(stateOf(db, id), secondExpected.state);
  assert.equal(Object.hasOwn(stateOf(db, id), 'combatTrace'), false);
});
