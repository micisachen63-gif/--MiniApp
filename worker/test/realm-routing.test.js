import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { CATALOG, NOW, fixture, initialized, gameplaySnapshot } from './realm-test-helpers.js';
import { initializeRealmIdentity, listRealmCatalog, resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';
import { createCharacter } from '../src/services/player.js';

test('unconfigured permanent realm remains the original DB and creates no identity or player data', async t => {
  const DB = freshDb(); t.after(() => DB.sqlite.close());
  const env = { DB, existing: 'keep' }, before = gameplaySnapshot(DB);
  const catalog = listRealmCatalog(env);
  assert.deepEqual(catalog, [{ id: 'permanent', type: 'permanent', name: '永久世界', rulesVersion: 'legacy-v1', isCurrent: false, legacy: true }]);
  const context = await resolveRealm(env, 'permanent'), scoped = scopeEnvForRealm(env, context);
  assert.equal(context.DB, DB); assert.equal(scoped.DB, DB); assert.equal(scoped.existing, 'keep');
  assert.equal(context.legacy, true); assert.equal(context.identityVerified, false);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_identity').get().n, 0);
  assert.deepEqual(gameplaySnapshot(DB), before);
  await assert.rejects(resolveRealm(env), { code: 'realm_required' });
  await assert.rejects(resolveRealm(env, 'invented'), { code: 'realm_unknown' });
});

test('configured realms require database identity and permanent registry; catalog lookup never initializes them', async t => {
  const env = fixture(t);
  assert.equal(listRealmCatalog(env).length, 2);
  await assert.rejects(resolveRealm(env, 'permanent'), { code: 'realm_identity_missing' });
  await assert.rejects(resolveRealm(env, 'season_2026_01'), { code: 'realm_identity_missing' });
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_identity').get().n, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_registry').get().n, 0);
});

test('removing configuration cannot downgrade an initialized seasonal DB into the legacy permanent route', async t => {
  const env = await initialized(t);
  await assert.rejects(resolveRealm({ DB: env.DB_SEASON }, 'permanent'), { code: 'realm_identity_mismatch' });
  const permanent = await resolveRealm({ DB: env.DB }, 'permanent');
  assert.equal(permanent.identityVerified, true);
  assert.notEqual(permanent.DB, env.DB);
});

test('two initialized realms isolate the same account, character IDs, names, money and inventory', async t => {
  const env = await initialized(t);
  const permanent = scopeEnvForRealm(env, await resolveRealm(env, 'permanent'));
  const season = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  await createCharacter(permanent, { tgId: '11001', name: '同名旅人', gender: 'm', baseClass: 'sword' }, NOW);
  await createCharacter(season, { tgId: '11001', name: '同名旅人', gender: 'm', baseClass: 'sword' }, NOW);
  await permanent.DB.prepare('UPDATE rpg_characters SET gold = 12345 WHERE tg_id = ?').bind('11001').run();
  await season.DB.prepare('UPDATE rpg_characters SET gold = 88 WHERE tg_id = ?').bind('11001').run();
  await season.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('11001', 'realm_test_drop', 3).run();
  assert.equal(await permanent.DB.prepare('SELECT gold FROM rpg_characters WHERE tg_id = ?').bind('11001').first('gold'), 12345);
  assert.equal(await season.DB.prepare('SELECT gold FROM rpg_characters WHERE tg_id = ?').bind('11001').first('gold'), 88);
  assert.equal(await permanent.DB.prepare("SELECT quantity FROM rpg_inventory WHERE item = 'realm_test_drop'").first(), null);
  assert.equal(await season.DB.prepare("SELECT quantity FROM rpg_inventory WHERE item = 'realm_test_drop'").first('quantity'), 3);
  assert.equal(permanent.DB_SEASON, undefined); assert.equal(season.DB_SEASON, undefined);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_commit_guard').get().n, 0);
});

test('wrong binding, immutable ID, type, token and rule version fail closed', async t => {
  const env = await initialized(t);
  await assert.rejects(resolveRealm({ ...env, DB_SEASON: env.DB }, 'season_2026_01'), { code: 'realm_binding_mismatch' });
  const wrongDatabase = freshDb(); t.after(() => wrongDatabase.sqlite.close());
  await assert.rejects(resolveRealm({ ...env, DB_SEASON: wrongDatabase }, 'season_2026_01'), { code: 'realm_identity_missing' });
  for (const change of [
    { id: 'season_2026_02' }, { databaseToken: 'some-other-database-token' }, { rulesVersion: 'poe-v2' },
  ]) {
    const catalog = [CATALOG[0], { ...CATALOG[1], ...change }];
    const changed = { ...env, REALM_CATALOG_JSON: JSON.stringify(catalog), CURRENT_SEASON_ID: catalog[1].id };
    await assert.rejects(resolveRealm(changed, catalog[1].id), { code: 'realm_identity_mismatch' });
  }
  const wrongType = { ...env, DB_SEASON: { prepare: (...args) => env.DB.prepare(...args), batch: (...args) => env.DB.batch(...args) } };
  await assert.rejects(resolveRealm(wrongType, 'season_2026_01'), { code: 'realm_identity_mismatch' });
});

test('current-season alias is display-only; malformed or partial configuration cannot fall back', async t => {
  const env = await initialized(t);
  assert.equal(listRealmCatalog(env).find(entry => entry.isCurrent).id, 'season_2026_01');
  for (const id of ['current', 'season', 'latest', 'season_2099_01']) await assert.rejects(resolveRealm(env, id), { code: 'realm_unknown' });
  for (const changed of [
    { ...env, REALM_CATALOG_JSON: undefined },
    { ...env, REALM_CATALOG_JSON: '{broken' },
    { ...env, CURRENT_SEASON_ID: 'season_2099_01' },
    { ...env, REALM_CATALOG_JSON: JSON.stringify([CATALOG[0], { ...CATALOG[1], binding: 'DB' }]) },
    { ...env, REALM_CATALOG_JSON: JSON.stringify([{ ...CATALOG[0], rulesVersion: undefined }, CATALOG[1]]) },
  ]) assert.throws(() => listRealmCatalog(changed), { code: 'realm_config_invalid' });
  assert.throws(() => scopeEnvForRealm(env, { id: 'season_2026_01', DB: env.DB }), { code: 'realm_context_invalid' });
});

test('a newly initialized DB cannot reuse a registered season ID even with the same configuration token', async t => {
  const env = await initialized(t), oldRegistry = env.DB.sqlite.prepare('SELECT * FROM rpg_realm_registry ORDER BY realm_id').all();
  const replacement = freshDb(); t.after(() => replacement.sqlite.close());
  const rebound = { ...env, DB_SEASON: replacement };
  await assert.rejects(initializeRealmIdentity(rebound, 'season_2026_01', { now: NOW + 1 }), { code: 'realm_id_reused' });
  await assert.rejects(resolveRealm(rebound, 'season_2026_01'), { code: 'realm_registry_mismatch' });
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM rpg_realm_registry ORDER BY realm_id').all(), oldRegistry);
  assert.equal(replacement.sqlite.prepare('SELECT COUNT(*) n FROM rpg_characters').get().n, 0);
  assert.equal((await resolveRealm(env, 'season_2026_01')).identityVerified, true);
});

test('initialization can retry after target identity commit and before registry registration', async t => {
  const env = fixture(t);
  await initializeRealmIdentity(env, 'permanent', { now: NOW });
  const batch = env.DB_SEASON.batch.bind(env.DB_SEASON);
  let interrupted = true;
  env.DB_SEASON.batch = async statements => {
    const result = await batch(statements);
    if (interrupted) { interrupted = false; throw new Error('simulated lost initialization response'); }
    return result;
  };
  // Lost target response is reconciled from its immutable identity, without a new nonce.
  const first = await initializeRealmIdentity(env, 'season_2026_01', { now: NOW });
  const nonce = env.DB_SEASON.sqlite.prepare('SELECT instance_nonce FROM rpg_realm_identity').get().instance_nonce;
  const second = await initializeRealmIdentity(env, 'season_2026_01', { now: NOW + 1 });
  assert.equal(first.id, second.id);
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT instance_nonce FROM rpg_realm_identity').get().instance_nonce, nonce);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_realm_registry WHERE realm_type = 'season'").get().n, 1);
});
