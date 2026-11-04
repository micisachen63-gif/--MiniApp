import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { initialized, NOW, gameplaySnapshot } from './realm-test-helpers.js';
import { resolveRealm, scopeEnvForRealm, transitionRealmPhase } from '../src/realm/index.js';
import { mulberry32 } from '../src/game/rng.js';
import * as P from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';
import { sweep, ATLAS_SWEEP_LIMIT, ATLAS_SWEEP_MAX } from '../src/services/atlas-background.js';

const runRow = (db, id) => db.prepare('SELECT * FROM rpg_atlas_runs WHERE id=?').get(id);
const runBody = requestId => ({ requestId, mapId: 'laurel_intro', mapCount: 1, durationMinutes: 60, supplies: { hp: 20, mp: 20 } });

async function startOne(env, account, now = T0) {
  const player = await P.createCharacter(env, { tgId: String(account), name: '巡行' + account, gender: 'm', baseClass: 'sword' }, now, mulberry32(7));
  const result = await Atlas.start(env, player.char.tg_id, runBody('sweep-start-' + account), now);
  return { id: result.run.id, charId: player.char.tg_id };
}
async function fixture(t, count = 1) {
  const DB = freshDb();
  t.after(() => DB.sqlite.close());
  const env = { DB, ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent', phase: 'ACTIVE' } };
  const runs = [];
  for (let i = 0; i < count; i++) runs.push(await startOne(env, 83000 + i));
  runs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { env, db: DB.sqlite, runs };
}

test('flag-off and non-active realms do not access Atlas tables, including an old schema', async () => {
  const DB = { prepare() { assert.fail('disabled sweep touched the database'); } };
  for (const ATLAS_ENABLED of [undefined, 'false', 'TRUE', '1']) {
    const result = await sweep({ DB, ATLAS_ENABLED }, T0);
    assert.equal(result.enabled, false);
    assert.equal(result.processed, 0);
  }
  const result = await sweep({ DB, ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'season', phase: 'FREEZE' } }, T0);
  assert.equal(result.skipped, 'realm_closed');
  assert.equal(result.processed, 0);
});

test('background settlement commits a real run without any panel or status-write side effect', async t => {
  const { env, db, runs: [run] } = await fixture(t);
  const before = runRow(db, run.id);
  assert.equal(before.rev, 0);
  const result = await sweep(env, T0 + 15000);
  assert.equal(result.processed, 1);
  assert.equal(result.advanced, 1);
  assert.deepEqual(result.errors, []);
  const after = runRow(db, run.id);
  assert.equal(after.rev, 1, 'one chunk produces one committed revision');
  assert.ok(JSON.parse(after.state_json).processedAt > JSON.parse(before.state_json).processedAt);
  const snapshot = gameplaySnapshot(env.DB);
  const view = await Atlas.status(env, run.charId, T0 + 30000);
  assert.equal(view.scene.run.revision, 1);
  assert.deepEqual(gameplaySnapshot(env.DB), snapshot, 'ordinary status remains zero-write');
});

test('persistent keyset pages wrap fairly and a damaged run cannot starve later accounts', async t => {
  const { env, db, runs } = await fixture(t, 5);
  db.prepare('UPDATE rpg_atlas_runs SET state_json=? WHERE id=?').run('{broken', runs[0].id);
  const first = await sweep(env, T0 + 15000, 2);
  assert.equal(first.processed, 2);
  assert.equal(first.errors[0].runId, runs[0].id);
  assert.equal(runRow(db, runs[1].id).rev, 1);
  assert.equal(db.prepare('SELECT cursor FROM rpg_atlas_sweep_cursor').get().cursor, runs[1].id);
  const restarted = await import('../src/services/atlas-background.js?fresh-isolate');
  const second = await restarted.sweep({ ...env }, T0 + 15000, 2);
  assert.equal(second.processed, 2);
  assert.equal(runRow(db, runs[2].id).rev, 1);
  assert.equal(runRow(db, runs[3].id).rev, 1);
  const third = await restarted.sweep({ ...env }, T0 + 15000, 2);
  assert.equal(third.processed, 2);
  assert.equal(third.errors[0].runId, runs[0].id);
  assert.equal(runRow(db, runs[4].id).rev, 1);
  assert.equal(runRow(db, runs[0].id).rev, 0);
  assert.equal(db.prepare('SELECT rev FROM rpg_atlas_sweep_cursor').get().rev, 3);
});

test('default and caller-supplied batch sizes remain bounded for a large active queue', async t => {
  const { env, db, runs } = await fixture(t, ATLAS_SWEEP_MAX + 1);
  assert.equal((await sweep(env, T0 + 15000)).processed, ATLAS_SWEEP_LIMIT);
  assert.equal(runs.filter(run => runRow(db, run.id).rev === 1).length, ATLAS_SWEEP_LIMIT);
  const result = await sweep(env, T0 + 15000, 1000000);
  assert.equal(result.processed, ATLAS_SWEEP_MAX);
  assert.equal(runs.filter(run => runRow(db, run.id).rev === 1).length, runs.length);
  assert.equal(runs.filter(run => runRow(db, run.id).rev > 1).length, 0, 'revisiting a fully caught-up run is harmless');
});

test('overlapping sweep claims and manual settlement do not double-commit rewards', async t => {
  const { env, db, runs: [run] } = await fixture(t);
  const beforeGold = db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(run.charId).gold;
  const [first, second] = await Promise.all([sweep(env, T0 + 60000, 1), sweep(env, T0 + 60000, 1)]);
  assert.equal([first, second].filter(result => result.skipped === 'claim_conflict').length, 1);
  assert.equal(first.processed + second.processed, 1);
  await Promise.all([sweep(env, T0 + 120000, 1), Atlas.settle(env, run.charId, { runId: run.id }, T0 + 120000)]);
  const row = runRow(db, run.id), state = JSON.parse(row.state_json);
  assert.ok(row.rev <= 2, 'same-target concurrent operations can commit each chunk only once');
  assert.equal(db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(run.charId).gold, beforeGold + state.totals.gold);
  const ledger = db.prepare("SELECT event_id FROM rpg_ledger WHERE tg_id=? AND type='星圖掉落'").all(run.charId);
  assert.equal(new Set(ledger.map(item => item.event_id)).size, ledger.length);
});

test('sweeps use their guarded realm database and stale phase fences cannot mutate progress', async t => {
  const env = { ...await initialized(t), ATLAS_ENABLED: 'true' };
  const permanent = scopeEnvForRealm(env, await resolveRealm(env, 'permanent'));
  const season = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  const permanentRun = await startOne(permanent, 84001, NOW);
  const seasonRun = await startOne(season, 84001, NOW);
  const beforePermanent = gameplaySnapshot(env.DB);
  assert.equal((await sweep(season, NOW + 15000)).advanced, 1);
  assert.deepEqual(gameplaySnapshot(env.DB), beforePermanent);
  assert.equal(runRow(env.DB.sqlite, permanentRun.id).rev, 0);
  assert.equal(runRow(env.DB_SEASON.sqlite, seasonRun.id).rev, 1);
  await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW + 20000, now: NOW + 20000 });
  const frozen = gameplaySnapshot(env.DB_SEASON);
  await assert.rejects(sweep(season, NOW + 30000), error => error.code === 'realm_fence_changed');
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), frozen);
  const fresh = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  assert.equal((await sweep(fresh, NOW + 30000)).skipped, 'realm_closed');
});

test('a realm fence change after claiming a page stops the page before any run commits', async t => {
  const env = { ...await initialized(t), ATLAS_ENABLED: 'true' };
  const scoped = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  const runs = [await startOne(scoped, 85001, NOW), await startOne(scoped, 85002, NOW)];
  let changed = false;
  const original = scoped.DB;
  const DB = { ...original, prepare(sql) {
    const statement = original.prepare(sql);
    if (!sql.startsWith('UPDATE rpg_atlas_sweep_cursor ')) return statement;
    const wrap = current => ({
      bind(...args) { return wrap(current.bind(...args)); },
      async run() {
        const result = await current.run();
        await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW + 15000, now: NOW + 15000 });
        changed = true;
        return result;
      },
    });
    return wrap(statement);
  } };
  const result = await sweep({ ...scoped, DB }, NOW + 15000, 2);
  assert.equal(changed, true);
  assert.equal(result.processed, 1);
  assert.equal(result.interrupted, true);
  assert.equal(result.errors[0].code, 'realm_fence_changed');
  for (const run of runs) assert.equal(runRow(env.DB_SEASON.sqlite, run.id).rev, 0);
});

test('the minute scheduler advances Atlas and an Atlas-only failure does not reject legacy sweeps', async t => {
  const { default: Worker } = await import('../src/index.js');
  const { env, db, runs: [run] } = await fixture(t);
  const execute = async environment => {
    let completion;
    Worker.scheduled({ cron: '* * * * *', scheduledTime: T0 + 15000 }, environment, { waitUntil(promise) { completion = promise; } });
    await completion;
  };
  await execute(env);
  assert.equal(runRow(db, run.id).rev, 1);
  db.exec('DROP TABLE rpg_atlas_sweep_cursor');
  const observed = [];
  const original = env.DB;
  const DB = { prepare(sql) { observed.push(sql); return original.prepare(sql); }, batch(statements) { return original.batch(statements); } };
  await execute({ ...env, DB });
  assert.ok(observed.some(sql => sql.includes('rpg_parties')));
  assert.ok(observed.some(sql => sql.includes('rpg_star_ring_runs')));
});
