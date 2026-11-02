import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoEnhanceRunner } from '../src/auto-enhance-runner.js';
import * as A from '../src/services/auto-enhance.js';
import * as R from '../src/services/auto-reroll.js';
import * as G from '../src/services/guardian-auto.js';
import { createCharacter } from '../src/services/player.js';
import { makeGear } from '../src/game/gear.js';
import { insertEquipStmt } from '../src/db.js';
import { resolveRealm, scopeEnvForRealm, transitionRealmPhase } from '../src/realm/index.js';
import { CATALOG, NOW, initialized, gameplaySnapshot } from './realm-test-helpers.js';

function storageFixture(seed = {}) {
  const data = new Map(Object.entries(seed));
  let alarm = null, transactionTail = Promise.resolve();
  const storage = {
    get: async key => data.get(key), put: async (key, value) => { data.set(key, value); }, delete: async key => data.delete(key),
    getAlarm: async () => alarm, setAlarm: async value => { alarm = value; }, deleteAlarm: async () => { alarm = null; },
    transaction: callback => {
      const operation = transactionTail.then(async () => {
        const staged = new Map(data);
        await callback({ get: async key => staged.get(key), put: async (key, value) => { staged.set(key, value); }, delete: async key => staged.delete(key) });
        data.clear(); for (const [key, value] of staged) data.set(key, value);
      });
      transactionTail = operation.catch(() => {});
      return operation;
    },
  };
  return { state: { storage }, data, get alarm() { return alarm; } };
}

const wakeRequest = body => new Request('https://auto-enhance.internal/wake', { method: 'POST', body: JSON.stringify(body) });
const freeze = env => transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW + 1 });

async function jobs(t) {
  t.mock.method(Date, 'now', () => NOW);
  const env = await initialized(t), jobs = {};
  for (const realmId of ['permanent', 'season_2026_01']) {
    const scoped = scopeEnvForRealm(env, await resolveRealm(env, realmId));
    await createCharacter(scoped, { tgId: '16001', name: '排程保留角色', gender: 'm', baseClass: 'sword' }, NOW);
    const item = makeGear({ id: 'same-equipment-id', tgId: '16001', cls: 'sword', slot: 'helmet', tier: 1, rng: () => .5, now: NOW });
    await insertEquipStmt(scoped.DB, item).run();
    await scoped.DB.prepare("UPDATE rpg_characters SET gold = 10000 WHERE tg_id = '16001'").run();
    jobs[realmId] = (await A.start(scoped, '16001', { itemId: item.id, target: 3 }, NOW)).job;
  }
  // A collision across physical DBs must remain safe, not rely on UUID luck.
  const sharedId = jobs.permanent.id, originalSeasonId = jobs.season_2026_01.id;
  env.DB_SEASON.sqlite.prepare('UPDATE rpg_auto_enhance SET id = ? WHERE id = ?').run(sharedId, originalSeasonId);
  env.DB_SEASON.sqlite.prepare('UPDATE rpg_background_operations SET ref_id = ? WHERE ref_id = ?').run(sharedId, originalSeasonId);
  return { env, id: sharedId };
}

test('all workshop wakes preserve permanent names and namespace seasonal names/payloads with the immutable ID', async t => {
  const env = await initialized(t), requests = [], id = crypto.randomUUID();
  env.AUTO_ENHANCE_RUNNER = { idFromName: name => name, get: name => ({ fetch: async (_url, options) => { requests.push({ name, body: JSON.parse(options.body) }); return new Response('Scheduled', { status: 202 }); } }) };
  for (const realmId of ['permanent', 'season_2026_01']) {
    const scoped = scopeEnvForRealm(env, await resolveRealm(env, realmId));
    for (const service of [A, R, G]) assert.equal(await service.wake(scoped, id), true);
  }
  assert.deepEqual(requests.map(row => row.name), [id, 'reroll:' + id, 'guardian:' + id, 'realm:season_2026_01:' + id, 'realm:season_2026_01:reroll:' + id, 'realm:season_2026_01:guardian:' + id]);
  assert.deepEqual(requests.map(row => row.body.realmId), ['permanent', 'permanent', 'permanent', 'season_2026_01', 'season_2026_01', 'season_2026_01']);
  assert.deepEqual(requests.map(row => row.body.kind), ['enhance', 'reroll', 'guardian', 'enhance', 'reroll', 'guardian']);
});

test('legacy stored job is permanently assigned to permanent; same UUID seasonal job executes only in its own DB after restart', async t => {
  const { env, id } = await jobs(t), legacy = storageFixture({ jobId: id, kind: 'enhance' });
  const seasonBefore = gameplaySnapshot(env.DB_SEASON);
  await new AutoEnhanceRunner(legacy.state, env).alarm();
  assert.equal(legacy.data.get('realmBinding').realmId, 'permanent');
  assert.equal(env.DB.sqlite.prepare('SELECT attempts FROM rpg_auto_enhance WHERE id = ?').get(id).attempts, 1);
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), seasonBefore);
  const permanentBefore = gameplaySnapshot(env.DB), season = storageFixture();
  let runner = new AutoEnhanceRunner(season.state, env);
  assert.equal((await runner.fetch(wakeRequest({ jobId: id, realmId: 'season_2026_01' }))).status, 202);
  runner = new AutoEnhanceRunner(season.state, env);
  await runner.alarm();
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT attempts FROM rpg_auto_enhance WHERE id = ?').get(id).attempts, 1);
  assert.deepEqual(gameplaySnapshot(env.DB), permanentBefore);
  assert.equal(runner.env, env); assert.equal(runner.env.DB, env.DB);
});

test('an existing or completed object cannot switch realms, job IDs or work kinds, and a bad request does not cancel its alarm', async t => {
  const { env, id } = await jobs(t), state = storageFixture();
  const runner = new AutoEnhanceRunner(state.state, env);
  assert.equal((await runner.fetch(wakeRequest({ jobId: id, realmId: 'season_2026_01' }))).status, 202);
  const alarm = state.alarm;
  for (const body of [{ jobId: id }, { jobId: id, realmId: 'permanent' }, { jobId: crypto.randomUUID(), realmId: 'season_2026_01' }, { jobId: id, kind: 'guardian', realmId: 'season_2026_01' }]) {
    const response = await runner.fetch(wakeRequest(body));
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'realm_background_mismatch');
    assert.equal(state.alarm, alarm);
  }
  const scoped = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  await A.stop(scoped, '16001', { jobId: id }, NOW);
  await runner.alarm();
  assert.equal(state.alarm, null); assert.equal(state.data.get('jobId'), undefined);
  assert.equal(state.data.get('realmBinding').realmId, 'season_2026_01');
  assert.equal((await new AutoEnhanceRunner(state.state, env).fetch(wakeRequest({ jobId: id }))).status, 409);
});

test('old storage with no realm rejects a seasonal wake instead of silently adopting the current season', async t => {
  const { env, id } = await jobs(t), state = storageFixture({ jobId: id, kind: 'enhance' });
  const runner = new AutoEnhanceRunner(state.state, env);
  const response = await runner.fetch(wakeRequest({ jobId: id, realmId: 'season_2026_01' }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'realm_background_mismatch');
  await runner.alarm();
  assert.equal(state.data.get('realmId'), 'permanent');
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT attempts FROM rpg_auto_enhance WHERE id = ?').get(id).attempts, 0);
});

test('invalid persisted realm is rejected instead of using the missing-realm legacy default', async t => {
  const { env, id } = await jobs(t), before = gameplaySnapshot(env.DB);
  for (const realmId of ['', null, 'current']) {
    const state = storageFixture({ jobId: id, kind: 'enhance', realmId });
    await new AutoEnhanceRunner(state.state, env).alarm();
    assert.equal(state.alarm, null);
    assert(['realm_required', 'realm_unknown'].includes(state.data.get('realmSuspension').code));
  }
  assert.deepEqual(gameplaySnapshot(env.DB), before);
});

test('closed season removes its alarm without charging, mutating paid job state or retrying forever', async t => {
  const { env, id } = await jobs(t), state = storageFixture();
  const runner = new AutoEnhanceRunner(state.state, env);
  await runner.fetch(wakeRequest({ jobId: id, realmId: 'season_2026_01' }));
  const before = gameplaySnapshot(env.DB_SEASON);
  await freeze(env);
  await runner.alarm();
  assert.equal(state.alarm, null); assert.equal(state.data.get('realmSuspension').code, 'realm_read_only');
  assert.equal(state.data.get('jobId'), id);
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), before);
  const response = await runner.fetch(wakeRequest({ jobId: id, realmId: 'season_2026_01' }));
  assert.equal(response.status, 409); assert.equal(state.alarm, null);
});

test('removed season or rebound DB stops the old alarm and never falls back to permanent', async t => {
  const { env, id } = await jobs(t), originalPermanent = gameplaySnapshot(env.DB), originalSeason = gameplaySnapshot(env.DB_SEASON);
  for (const changed of [
    { ...env, REALM_CATALOG_JSON: JSON.stringify([CATALOG[0]]), CURRENT_SEASON_ID: undefined },
    { ...env, DB_SEASON: env.DB },
  ]) {
    const state = storageFixture({ jobId: id, kind: 'enhance', realmId: 'season_2026_01', realmBinding: { realmId: 'season_2026_01', jobId: id, kind: 'enhance' } });
    await new AutoEnhanceRunner(state.state, changed).alarm();
    assert.equal(state.alarm, null);
    assert(['realm_unknown', 'realm_binding_mismatch'].includes(state.data.get('realmSuspension').code));
  }
  assert.deepEqual(gameplaySnapshot(env.DB), originalPermanent);
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), originalSeason);
});

test('freezing between background calculation and its final D1 batch rolls back the whole paid attempt and stops its alarm', async t => {
  const { env, id } = await jobs(t), state = storageFixture(), runner = new AutoEnhanceRunner(state.state, env);
  await runner.fetch(wakeRequest({ jobId: id, realmId: 'season_2026_01' }));
  const before = gameplaySnapshot(env.DB_SEASON), originalBatch = env.DB_SEASON.batch.bind(env.DB_SEASON);
  let freezeAtCommit = true;
  env.DB_SEASON.batch = async statements => {
    if (freezeAtCommit && statements.some(statement => statement.sql.includes("SET status='processing'"))) {
      freezeAtCommit = false;
      await freeze(env);
    }
    return originalBatch(statements);
  };
  await runner.alarm();
  assert.equal(freezeAtCommit, false);
  assert.equal(state.alarm, null); assert.equal(state.data.get('realmSuspension').code, 'realm_fence_changed');
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), before);
});

test('concurrent first wakes cannot bind one durable object to both economies', async t => {
  const { env, id } = await jobs(t), state = storageFixture(), runner = new AutoEnhanceRunner(state.state, env);
  const responses = await Promise.all([
    runner.fetch(wakeRequest({ jobId: id, realmId: 'permanent' })),
    runner.fetch(wakeRequest({ jobId: id, realmId: 'season_2026_01' })),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]);
  assert(state.alarm != null); assert.equal(state.data.get('realmSuspension'), undefined);
  const boundRealm = state.data.get('realmBinding').realmId;
  await runner.alarm();
  assert.equal(env.DB.sqlite.prepare('SELECT attempts FROM rpg_auto_enhance WHERE id = ?').get(id).attempts, boundRealm === 'permanent' ? 1 : 0);
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT attempts FROM rpg_auto_enhance WHERE id = ?').get(id).attempts, boundRealm === 'season_2026_01' ? 1 : 0);
});
