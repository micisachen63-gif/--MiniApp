import test from 'node:test';
import assert from 'node:assert/strict';
import { NOW, initialized, gameplaySnapshot } from './realm-test-helpers.js';
import { resolveRealm, scopeEnvForRealm, transitionRealmPhase } from '../src/realm/index.js';
import { createCharacter } from '../src/services/player.js';
import { guardStmt } from '../src/db.js';

async function player(t) {
  const env = await initialized(t), context = await resolveRealm(env, 'season_2026_01');
  const scoped = scopeEnvForRealm(env, context);
  await createCharacter(scoped, { tgId: '12001', name: '封存旅人', gender: 'f', baseClass: 'mage' }, NOW);
  return { env, scoped, context };
}
const freeze = env => transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW + 1 });

test('a request prepared before freeze cannot commit afterwards, even through run, returning-first or a mixed batch', async t => {
  const { env, scoped } = await player(t), before = gameplaySnapshot(env.DB_SEASON);
  const pending = scoped.DB.prepare('UPDATE rpg_characters SET gold = gold + 9 WHERE tg_id = ?').bind('12001');
  const returning = scoped.DB.prepare('UPDATE rpg_characters SET gold = gold + 8 WHERE tg_id = ? RETURNING gold').bind('12001');
  await freeze(env);
  await assert.rejects(pending.run(), { code: 'realm_fence_changed' });
  await assert.rejects(returning.first('gold'), { code: 'realm_fence_changed' });
  await assert.rejects(scoped.DB.batch([
    pending,
    scoped.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('12001', 'late_reward', 1),
  ]), { code: 'realm_fence_changed' });
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), before);
});

test('frozen realm permits fresh read-only queries but rejects writes and raw maintenance escapes', async t => {
  const { env } = await player(t);
  await freeze(env);
  const context = await resolveRealm(env, 'season_2026_01'), scoped = scopeEnvForRealm(env, context);
  assert.equal(context.phase, 'FREEZE'); assert.equal(context.cutoffAt, NOW);
  assert.equal(await scoped.DB.prepare('/* profile */ SELECT name FROM rpg_characters WHERE tg_id = ?').bind('12001').first('name'), '封存旅人');
  await assert.rejects(scoped.DB.prepare('UPDATE rpg_characters SET gold = gold + 1').all(), { code: 'realm_read_only' });
  await assert.rejects(scoped.DB.prepare('WITH n AS (SELECT 1) UPDATE rpg_characters SET gold = gold + 1').run(), { code: 'realm_read_only' });
  await assert.rejects(scoped.DB.exec('UPDATE rpg_characters SET gold = 0'), { code: 'realm_maintenance_required' });
  assert.throws(() => scoped.DB.prepare("UPDATE rpg_realm_identity SET phase = 'ACTIVE'"), { code: 'realm_maintenance_required' });
  assert.throws(() => scoped.DB.prepare("SELECT '--'; UPDATE rpg_characters SET gold = 0"), { code: 'realm_statement_invalid' });
  assert.throws(() => scoped.DB.prepare('PRAGMA writable_schema = ON'), { code: 'realm_maintenance_required' });
  assert.equal(await scoped.DB.prepare("SELECT '--;/*literal*/' AS text").first('text'), '--;/*literal*/');
  assert.equal(scoped.DB.sqlite, undefined);
});

test('realm guard preserves legacy optimistic changes guards, result ordering and atomic rollback', async t => {
  const { env, scoped } = await player(t);
  const before = await scoped.DB.prepare('SELECT gold FROM rpg_characters WHERE tg_id = ?').bind('12001').first('gold');
  const results = await scoped.DB.batch([
    scoped.DB.prepare('UPDATE rpg_characters SET gold = gold + 7 WHERE tg_id = ?').bind('12001'),
    guardStmt(scoped.DB),
    scoped.DB.prepare('SELECT gold FROM rpg_characters WHERE tg_id = ?').bind('12001'),
  ]);
  assert.equal(results.length, 3); assert.equal(results[0].meta.changes, 1); assert.equal(results[2].results[0].gold, before + 7);
  await assert.rejects(scoped.DB.batch([
    scoped.DB.prepare('UPDATE rpg_characters SET gold = gold + 100 WHERE tg_id = ?').bind('12001'),
    scoped.DB.prepare('UPDATE rpg_characters SET gold = gold + 1 WHERE tg_id = ?').bind('nonexistent'),
    guardStmt(scoped.DB),
  ]), /rpg_guard\.ok/);
  assert.equal(await scoped.DB.prepare('SELECT gold FROM rpg_characters WHERE tg_id = ?').bind('12001').first('gold'), before + 7);
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_commit_guard').get().n, 0);
});

test('raw and other realm statements cannot be mixed into a guarded DB batch', async t => {
  const { env, scoped } = await player(t);
  const other = await resolveRealm(env, 'permanent');
  await assert.rejects(scoped.DB.batch([env.DB_SEASON.prepare('UPDATE rpg_characters SET gold = 0')]), { code: 'realm_statement_mismatch' });
  await assert.rejects(scoped.DB.batch([other.DB.prepare('SELECT 1')]), { code: 'realm_statement_mismatch' });
});

test('lifecycle advances one audited step at a time, keeps cutoff and never changes player or enhancement data', async t => {
  const { env } = await player(t);
  env.DB_SEASON.sqlite.prepare('UPDATE rpg_equipment SET enhance_level = 13 WHERE tg_id = ?').run('12001');
  const before = gameplaySnapshot(env.DB_SEASON);
  await assert.rejects(transitionRealmPhase(env, 'permanent', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE' }), { code: 'realm_transition_invalid' });
  await assert.rejects(transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'SEALED', now: NOW }), { code: 'realm_transition_invalid' });
  await assert.rejects(transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', now: NOW }), { code: 'realm_cutoff_required' });
  await freeze(env);
  await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'FREEZE', expectedFenceEpoch: 1, nextPhase: 'DRAIN', now: NOW + 2 });
  await assert.rejects(transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'DRAIN', expectedFenceEpoch: 2, nextPhase: 'SEALED', now: NOW + 3 }), { code: 'realm_manifest_required' });
  await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'DRAIN', expectedFenceEpoch: 2, nextPhase: 'SEALED', manifestHash: 'a'.repeat(64), now: NOW + 3 });
  await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'SEALED', expectedFenceEpoch: 3, nextPhase: 'IMPORTING', now: NOW + 4 });
  await assert.rejects(transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'IMPORTING', expectedFenceEpoch: 4, nextPhase: 'COMPLETE', now: NOW + 5 }), { code: 'realm_completion_required' });
  const completed = await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'IMPORTING', expectedFenceEpoch: 4, nextPhase: 'COMPLETE', completionHash: 'b'.repeat(64), now: NOW + 5 });
  assert.equal(completed.phase, 'COMPLETE'); assert.equal(completed.fenceEpoch, 5); assert.equal(completed.cutoffAt, NOW);
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_phase_history').get().n, 5);
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), before);
  const scoped = scopeEnvForRealm(env, completed);
  assert.equal(await scoped.DB.prepare('SELECT COUNT(*) n FROM rpg_characters').first('n'), 1);
  await assert.rejects(scoped.DB.prepare('UPDATE rpg_characters SET gold = 0').run(), { code: 'realm_read_only' });
});

test('concurrent phase changes have exactly one winner and no duplicate phase history', async t => {
  const { env } = await player(t);
  const results = await Promise.allSettled([freeze(env), freeze(env)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'realm_fence_changed');
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_realm_phase_history').get().n, 1);
  assert.equal((await resolveRealm(env, 'season_2026_01')).fenceEpoch, 1);
});
