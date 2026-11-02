import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.js';
import { createCharacter } from '../src/services/player.js';
import { initializeRealmIdentity, resolveRealm } from '../src/realm/index.js';
import { CATALOG, NOW, fixture, gameplaySnapshot } from './realm-test-helpers.js';

const folder = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('0035_realm_identity.sql', folder), 'utf8');

test('realm metadata migration leaves every old row, schema, equipment +N and enhancement ledger untouched', async t => {
  const DB = new D1Shim(); t.after(() => DB.sqlite.close());
  for (const file of readdirSync(folder).filter(file => file.endsWith('.sql') && file < '0035').sort()) DB.sqlite.exec(readFileSync(new URL(file, folder), 'utf8').replace(/\r\n/g, '\n'));
  await createCharacter({ DB }, { tgId: '13001', name: '永久保留角色', gender: 'm', baseClass: 'thief' }, NOW);
  DB.sqlite.prepare('UPDATE rpg_characters SET gold = 98765, level = 50 WHERE tg_id = ?').run('13001');
  DB.sqlite.prepare('UPDATE rpg_equipment SET enhance_level = 12 WHERE tg_id = ?').run('13001');
  DB.sqlite.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,note,created_at) VALUES(?,?,?,?,?)').run('original-enhancement-receipt', '13001', '強化', '+11 → +12', NOW);
  const schema = () => DB.sqlite.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'rpg_realm_%' ORDER BY type, name").all();
  const before = { rows: gameplaySnapshot(DB), schema: schema() };
  const oldContext = await resolveRealm({ DB }, 'permanent');
  assert.equal(oldContext.DB, DB); assert.equal(oldContext.identityVerified, false);
  DB.sqlite.exec(migration);
  assert.deepEqual({ rows: gameplaySnapshot(DB), schema: schema() }, before);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_identity').get().n, 0);
  assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(DB.sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  const env = { DB, REALM_CATALOG_JSON: JSON.stringify([CATALOG[0]]) };
  await assert.rejects(initializeRealmIdentity(env, 'permanent', { now: NOW }), { code: 'realm_not_empty' });
  await initializeRealmIdentity(env, 'permanent', { now: NOW, adoptExistingPermanent: true });
  assert.deepEqual({ rows: gameplaySnapshot(DB), schema: schema() }, before);
});

test('season initialization rejects populated DB even with permanent adoption flag and preserves it in full', async t => {
  const env = fixture(t);
  await initializeRealmIdentity(env, 'permanent', { now: NOW });
  await createCharacter({ DB: env.DB_SEASON }, { tgId: '13002', name: '不可清除', gender: 'f', baseClass: 'sword' }, NOW);
  const before = gameplaySnapshot(env.DB_SEASON);
  await assert.rejects(initializeRealmIdentity(env, 'season_2026_01', { now: NOW, adoptExistingPermanent: true }), { code: 'realm_not_empty' });
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), before);
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_identity').get().n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_realm_registry WHERE realm_type = 'season'").get().n, 0);
});

test('identity and registry cannot be deleted, overwritten, replaced or rebound to a different ID', async t => {
  const env = fixture(t);
  await initializeRealmIdentity(env, 'permanent', { now: NOW });
  await initializeRealmIdentity(env, 'season_2026_01', { now: NOW });
  const identity = env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_realm_identity').get();
  for (const sql of [
    'DELETE FROM rpg_realm_identity',
    "UPDATE rpg_realm_identity SET realm_id = 'season_2026_02'",
    'INSERT OR REPLACE INTO rpg_realm_identity SELECT * FROM rpg_realm_identity',
    "UPDATE rpg_realm_identity SET phase = 'ACTIVE', fence_epoch = 99",
  ]) assert.throws(() => env.DB_SEASON.sqlite.exec(sql), /realm_/);
  for (const sql of [
    'DELETE FROM rpg_realm_registry',
    "UPDATE rpg_realm_registry SET realm_id = 'rebound'",
    'INSERT OR REPLACE INTO rpg_realm_registry SELECT * FROM rpg_realm_registry',
  ]) assert.throws(() => env.DB.sqlite.exec(sql), /realm_/);
  assert.deepEqual(env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_realm_identity').get(), identity);
});
