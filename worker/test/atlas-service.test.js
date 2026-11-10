import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { mulberry32 } from '../src/game/rng.js';
import { computeStats } from '../src/game/stats.js';
import { loadPlayer } from '../src/db.js';
import { selectAccountCharacter, activeCharacterId } from '../src/accounts.js';
import { advanceAtlasRun } from '../src/game/atlas-engine.js';
import * as P from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';
import * as Party from '../src/services/party.js';
import { runCron } from '../src/index.js';

const MINUTE = 60000;
async function fixture(t, { baseClass = 'sword', flags = {}, account = '81201' } = {}) {
  const env = { DB: freshDb(), ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent' }, ...flags };
  t.after(() => env.DB.sqlite.close());
  const initial = await P.createCharacter(env, { tgId: account, name: '星圖測試甲', gender: 'm', baseClass }, T0, mulberry32(7));
  assert.equal(initial.equipment.length, 2, 'use the real production creation path, not a full hypothetical standard set');
  assert.ok(initial.equipment.every(item => item.source === 'starter'));
  return { env, db: env.DB.sqlite, id: initial.char.tg_id, account, initial };
}
const body = (extra = {}) => ({ requestId: 'atlas-start-001', mapId: 'laurel_intro', mapCount: 1, durationMinutes: 60, supplies: { hp: 20, mp: 20 }, ...extra });
const readRun = (db, id) => db.prepare('SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(id);
const savedState = (db, id) => JSON.parse(readRun(db, id).state_json);
const rows = (db, sql, ...bindings) => JSON.parse(JSON.stringify(db.prepare(sql).all(...bindings)));
function assets(db, id) {
  return {
    character: rows(db, 'SELECT * FROM rpg_characters WHERE tg_id=?', id),
    inventory: rows(db, 'SELECT * FROM rpg_inventory WHERE tg_id=? ORDER BY item', id),
    equipment: rows(db, 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id', id),
    ledger: rows(db, 'SELECT * FROM rpg_ledger WHERE tg_id=? ORDER BY event_id', id),
    runs: rows(db, 'SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY id', id),
    materials: rows(db, 'SELECT * FROM rpg_atlas_materials WHERE char_id=? ORDER BY material', id),
    progress: rows(db, 'SELECT * FROM rpg_atlas_progress WHERE char_id=? ORDER BY map_id', id),
  };
}
async function levelUpFixture(env, id, level) {
  const player = await loadPlayer(env.DB, id, env);
  const stats = computeStats({ ...player.char, level }, player.equipment, level);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=?,hp=?,mp=? WHERE tg_id=?').run(level, stats.maxHp, stats.maxMp, id);
}
async function finish(env, id, now = T0 + 60 * MINUTE) {
  let result;
  for (let index = 0; index < 20; index++) {
    result = await Atlas.settle(env, id, {}, now);
    if (result.run?.status !== 'running') return result;
    assert.equal(result.run.progress.catchingUp, true, 'fixture must be old enough to finish or catch up');
  }
  assert.fail('Atlas settlement did not finish within its bounded chunk count');
}
function grantMaterials(db, id, quantity = 100) {
  for (const material of ['atlas_shard', 'atlas_iron', 'atlas_ember', 'atlas_venom']) {
    db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,?)').run(id, material, quantity);
  }
}

test('Atlas is opt-in and disabled environments retain their normal legacy idle progression', async t => {
  const { env, db, id } = await fixture(t, { flags: { ATLAS_ENABLED: 'false' } });
  const before = assets(db, id);
  assert.equal((await Atlas.catalog(env)).enabled, false);
  assert.equal((await Atlas.status(env, id, T0)).enabled, false);
  await assert.rejects(Atlas.start(env, id, body(), T0), error => error.code === 'atlas_unavailable');
  await assert.rejects(Atlas.configure(env, id, { requestId: 'config-disabled', buildId: 'sword_bleed', supportIds: [] }, T0), error => error.code === 'atlas_unavailable');
  assert.deepEqual(assets(db, id), before);
  await P.withPlayer(env, id, T0);
  const legacy = await P.withPlayer(env, id, T0 + 2 * MINUTE);
  assert.ok(legacy.report.ticks > 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_atlas_runs').get().n, 0);
});

test('start reserves real starter supplies once and ignores all client combat, seed and restoration overrides', async t => {
  const { env, db, id, initial } = await fixture(t);
  const weapon = initial.equipment.find(item => item.slot === 'weapon');
  db.prepare('UPDATE rpg_equipment SET enhance_level=12 WHERE id=?').run(weapon.id);
  const player = await loadPlayer(env.DB, id, env), expected = computeStats(player.char, player.equipment);
  const equipmentBefore = rows(db, 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id', id);
  const input = body({ seed: 'client-picked', runId: 'client-run', startAt: 0,
    snapshot: { atk: 99999999, maxHp: 99999999 }, stats: { atk: 99999999 },
    profile: { id: 'client-free-loot', rewardMultiplier: 100 },
    supplies: { hp: 20, mp: 20, hpRestore: 99999999, mpRestore: 99999999 } });
  const started = await Atlas.start(env, id, input, T0);
  const run = savedState(db, id), persisted = readRun(db, id);
  assert.equal(run.snapshot.atk, expected.atk);
  assert.equal(run.snapshot.def, expected.def);
  assert.equal(run.snapshot.maxHp, expected.maxHp);
  assert.equal(run.supplies.hpRestore, 50);
  assert.equal(run.supplies.mpRestore, 40);
  assert.notEqual(run.seed, 'client-picked');
  assert.notEqual(run.runId, 'client-run');
  assert.notEqual(run.balanceProfile.id, 'client-free-loot');
  assert.equal(run.startedAt, T0 / 1000);
  assert.equal(started.supplies.hp, 130);
  assert.equal(started.supplies.mp, 130);
  assert.equal(db.prepare('SELECT atlas_run_id FROM rpg_characters WHERE tg_id=?').get(id).atlas_run_id, persisted.id);
  assert.deepEqual(rows(db, 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id', id), equipmentBefore);
  const committed = assets(db, id);
  await Atlas.start(env, id, input, T0 + 5 * MINUTE);
  assert.deepEqual(assets(db, id), committed);
  await assert.rejects(Atlas.start(env, id, { ...input, mapCount: 2 }, T0), error => error.code === 'request_reused');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='星圖補給保留'").get().n, 2);
});

test('configure validates class/supports, is idempotent, and only changes the next run snapshot', async t => {
  const { env, db, id } = await fixture(t);
  await assert.rejects(Atlas.configure(env, id, { requestId: 'config-invalid', buildId: 'mage_chain', supportIds: [] }, T0), error => error.code === 'atlas_build');
  await assert.rejects(Atlas.configure(env, id, { requestId: 'config-invalid', buildId: 'sword_whirlwind', supportIds: ['lasting'] }, T0), error => error.code === 'atlas_support');
  const config = { requestId: 'config-first01', buildId: 'sword_bleed', supportIds: ['lasting', 'wide'], automation: 'balanced' };
  await Atlas.configure(env, id, config, T0);
  const before = rows(db, 'SELECT * FROM rpg_atlas_profiles WHERE char_id=?', id);
  await Atlas.configure(env, id, config, T0);
  assert.deepEqual(rows(db, 'SELECT * FROM rpg_atlas_profiles WHERE char_id=?', id), before);
  await Atlas.start(env, id, body(), T0);
  const snapshot = savedState(db, id);
  await Atlas.configure(env, id, { requestId: 'config-next001', buildId: 'sword_counter', supportIds: ['guarded', 'economy'], automation: 'conserve' }, T0);
  assert.deepEqual(savedState(db, id), snapshot);
  assert.equal((await Atlas.status(env, id, T0)).profile.buildId, 'sword_counter');
});

test('configuration operation IDs cannot be reused across two characters of the same account', async t => {
  const { env, db, id, account } = await fixture(t);
  const second = await P.createCharacter(env, { tgId: account, name: '星圖測試乙', gender: 'f', baseClass: 'sword' }, T0, mulberry32(8));
  const config = { requestId: 'shared-config01', buildId: 'sword_bleed', supportIds: ['lasting'], automation: 'balanced' };
  await Atlas.configure(env, id, config, T0);
  await selectAccountCharacter(env, account, second.char.tg_id, T0);
  await assert.rejects(Atlas.configure(env, second.char.tg_id, config, T0), error => error.code === 'request_reused');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_atlas_profiles WHERE char_id=?').get(second.char.tg_id).n, 0);
});

test('locked boss, unopened maps and unavailable supplies cannot create or charge a run', async t => {
  const { env, db, id } = await fixture(t);
  await assert.rejects(Atlas.start(env, id, body({ mapId: 'laurel_warden' }), T0), error => error.code === 'atlas_level');
  await levelUpFixture(env, id, 10);
  await assert.rejects(Atlas.start(env, id, body({ mapId: 'laurel_warden' }), T0), error => error.code === 'atlas_locked');
  await assert.rejects(Atlas.start(env, id, body({ mapId: 'unreleased-map' }), T0), error => error.code === 'atlas_map');
  await assert.rejects(Atlas.start(env, id, body({ supplies: { hp: 151, mp: 0 } }), T0), error => error.code === 'insufficient');
  await assert.rejects(Atlas.start(env, id, body({ supplies: { hp: -1, mp: 0 } }), T0), error => error.code === 'atlas_input');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_atlas_runs').get().n, 0);
  assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='red_1'").get(id).quantity, 150);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='星圖補給保留'").get().n, 0);
});

test('settlement credits actual room receipts, unlocks progress and returns unused supplies exactly once', async t => {
  const { env, db, id, initial } = await fixture(t);
  const beforeGear = rows(db, 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id', id);
  await Atlas.start(env, id, body(), T0);
  const view = await finish(env, id), state = savedState(db, id);
  assert.equal(view.run.status, 'completed');
  const player = await loadPlayer(env.DB, id, env);
  assert.equal(player.char.gold, initial.char.gold + state.totals.gold);
  assert.equal(player.inv.red_1, 150 - state.supplies.hpUsed);
  assert.equal(player.inv.blue_1, 150 - state.supplies.mpUsed);
  assert.equal(player.char.atlas_run_id, null);
  assert.equal(view.completedMaps.laurel_intro, 1);
  assert.deepEqual(view.materials, state.totals.materials);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='星圖掉落'").get().n, state.rewardSequence);
  assert.deepEqual(rows(db, 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id', id), beforeGear);
  const committed = assets(db, id);
  await Atlas.settle(env, id, { runId: view.run.id }, T0 + 60 * MINUTE);
  await Atlas.settle(env, id, {}, T0 + 120 * MINUTE);
  assert.deepEqual(assets(db, id), committed);
});

test('a disconnect after the settlement commit cannot duplicate gold, materials, experience or refunds', async t => {
  const { env, db, id } = await fixture(t);
  await Atlas.start(env, id, body(), T0);
  const originalBatch = env.DB.batch.bind(env.DB);
  let lost = false;
  env.DB.batch = async statements => {
    const result = await originalBatch(statements);
    if (!lost && statements.some(stmt => stmt.sql.startsWith('UPDATE rpg_atlas_runs SET status='))) {
      lost = true; throw new Error('simulated response lost after commit');
    }
    return result;
  };
  try { await Atlas.settle(env, id, {}, T0 + 60 * MINUTE); }
  catch (error) { assert.match(error.message, /simulated response lost/); }
  assert.equal(lost, true);
  const committed = assets(db, id);
  assert.equal(readRun(db, id).status, 'completed');
  await Atlas.settle(env, id, {}, T0 + 60 * MINUTE);
  assert.deepEqual(assets(db, id), committed);
});

test('a reward ledger failure rolls back the entire settlement including player and run state', async t => {
  const { env, db, id } = await fixture(t);
  await Atlas.start(env, id, body(), T0);
  const before = assets(db, id);
  db.exec("CREATE TRIGGER atlas_test_fail_reward BEFORE INSERT ON rpg_ledger WHEN NEW.type='星圖掉落' BEGIN SELECT RAISE(ABORT,'atlas_test_reward_failure'); END");
  await assert.rejects(Atlas.settle(env, id, {}, T0 + 60 * MINUTE), /atlas_test_reward_failure/);
  assert.deepEqual(assets(db, id), before);
  db.exec('DROP TRIGGER atlas_test_fail_reward');
  const result = await finish(env, id);
  assert.equal(result.run.status, 'completed');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='星圖掉落'").get().n, 6);
});

test('old panels and the actual legacy cron cannot farm the same active Atlas time window', async t => {
  const { env, db, id, initial } = await fixture(t);
  await Atlas.start(env, id, body(), T0);
  const now = T0 + 30 * MINUTE;
  const panel = await P.withPlayer(env, id, now);
  assert.equal(panel.report.ticks, 0);
  assert.equal(panel.player.char.gold, initial.char.gold);
  await runCron(env, now + 2 * MINUTE);
  assert.equal(db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(id).gold, initial.char.gold);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_idle_reports WHERE tg_id=?').get(id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE tg_id=? AND event_id LIKE 'idle:%'").get(id).n, 0);
  const results = await Promise.all([Atlas.settle(env, id, {}, now + 2 * MINUTE), P.withPlayer(env, id, now + 2 * MINUTE)]);
  assert.equal(results[0].run.status, 'completed');
  const state = savedState(db, id), committed = await loadPlayer(env.DB, id, env);
  assert.equal(committed.char.gold, initial.char.gold + state.totals.gold);
  await runCron(env, now + 2 * MINUTE);
  assert.equal(db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(id).gold, committed.char.gold);
});

test('selected-character guards reject inactive starts and switching during a run', async t => {
  const { env, db, id, account } = await fixture(t);
  const second = await P.createCharacter(env, { tgId: account, name: '星圖測試乙', gender: 'f', baseClass: 'mage' }, T0, mulberry32(8));
  await assert.rejects(Atlas.start(env, second.char.tg_id, body(), T0), error => error.code === 'character_changed');
  await Atlas.start(env, id, body(), T0);
  await assert.rejects(selectAccountCharacter(env, account, second.char.tg_id, T0), error => error.code === 'atlas_active');
  assert.equal(await activeCharacterId(env.DB, account), id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_atlas_runs').get().n, 1);
  assert.throws(() => db.prepare('UPDATE rpg_characters SET party_id=? WHERE tg_id=?').run('racing-party', id), /atlas_character_busy/);
});

test('a real party recruitment lobby blocks starting Atlas before the party enters combat', async t => {
  const { env, db, id } = await fixture(t);
  await levelUpFixture(env, id, 30);
  const party = await Party.create(env, id, { kind: 'dungeon', dungeonId: Party.DUNGEONS[0].id }, T0);
  assert.equal(party.party.status, 'lobby');
  assert.equal(db.prepare('SELECT party_id FROM rpg_characters WHERE tg_id=?').get(id).party_id, null);
  await assert.rejects(Atlas.start(env, id, body(), T0), error => ['atlas_active', 'party'].includes(error.code));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_atlas_runs').get().n, 0);
  assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='red_1'").get(id).quantity, 150);
});

test('an active Atlas run also blocks party recruitment atomically in the opposite direction', async t => {
  const { env, db, id } = await fixture(t);
  await levelUpFixture(env, id, 30);
  await Atlas.start(env, id, body(), T0);
  await assert.rejects(Party.create(env, id, { kind: 'dungeon', dungeonId: Party.DUNGEONS[0].id }, T0), error => ['atlas_active', 'party'].includes(error.code));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_parties').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rpg_party_presence').get().n, 0);
  assert.equal(readRun(db, id).status, 'running');
});

test('stopping a long run fixes one cutoff and finishes multiple bounded chunks without extending combat', async t => {
  const { env, db, id } = await fixture(t, { flags: { ATLAS_PROFILE_JSON: JSON.stringify({ id: 'chunk-test-only', enemyHpMultiplier: 100, enemyDefenseMultiplier: 100, enemyDamageMultiplier: .05 }) } });
  await Atlas.configure(env, id, { requestId: 'config-long001', buildId: 'sword_counter', supportIds: ['guarded', 'economy'], automation: 'burst' }, T0);
  const started = await Atlas.start(env, id, body({ mapCount: 96, durationMinutes: 480, supplies: { hp: 150, mp: 150 } }), T0);
  const original = savedState(db, id), cutoff = T0 + 4500 * 1000;
  const stopBody = { requestId: 'stop-fixed-001', runId: started.run.id };
  const first = await Atlas.stop(env, id, stopBody, cutoff);
  assert.equal(first.run.status, 'running');
  assert.equal(first.run.progress.processedSeconds, 2000);
  assert.equal(first.run.progress.catchingUp, true);
  assert.equal(readRun(db, id).stop_at, cutoff);
  const second = await Atlas.stop(env, id, stopBody, cutoff + 1000 * 1000);
  assert.equal(second.run.status, 'running');
  assert.equal(second.run.progress.processedSeconds, 4000);
  assert.equal(readRun(db, id).stop_at, cutoff);
  const final = await Atlas.settle(env, id, { runId: started.run.id }, cutoff + 2000 * 1000);
  assert.equal(final.run.status, 'stopped');
  const state = savedState(db, id);
  assert.equal(state.elapsedSeconds, 4500);
  assert.equal(readRun(db, id).stop_at, cutoff);
  let expected = original, result;
  do { result = advanceAtlasRun(expected, cutoff / 1000); expected = result.state; } while (result.stillCatchingUp);
  assert.deepEqual(state.metrics, expected.metrics);
  assert.deepEqual(state.totals, expected.totals);
  assert.deepEqual(state.supplies, expected.supplies);
  const player = await loadPlayer(env.DB, id, env);
  assert.equal(player.char.atlas_run_id, null);
  assert.equal(player.inv.red_1, 150 - state.supplies.hpUsed);
  assert.equal(player.inv.blue_1, 150 - state.supplies.mpUsed);
  const committed = assets(db, id);
  await Atlas.stop(env, id, stopBody, cutoff + 3000 * 1000);
  assert.deepEqual(assets(db, id), committed);
});

test('fatal combat persists as failure, clears the active marker and refunds unused supplies', async t => {
  const { env, db, id } = await fixture(t, { flags: { ATLAS_PROFILE_JSON: JSON.stringify({ id: 'fatal-test-only', enemyHpMultiplier: 100, enemyDamageMultiplier: 100 }) } });
  await Atlas.start(env, id, body(), T0);
  const final = await finish(env, id), state = savedState(db, id);
  assert.equal(final.run.status, 'failed');
  assert.equal(final.run.report.deaths, 1);
  assert.equal(state.status, 'dead');
  assert.ok(state.elapsedSeconds < 60);
  const player = await loadPlayer(env.DB, id, env);
  assert.equal(player.char.atlas_run_id, null);
  assert.equal(player.inv.red_1, 150 - state.supplies.hpUsed);
  assert.equal(player.inv.blue_1, 150 - state.supplies.mpUsed);
  const committed = assets(db, id);
  await Atlas.settle(env, id, {}, T0 + 300 * MINUTE);
  assert.deepEqual(assets(db, id), committed);
});

test('crafting preserves item identity and +N, consumes materials once and cannot bypass its three-craft cap', async t => {
  const { env, db, id, initial } = await fixture(t);
  const itemId = initial.equipment.find(item => item.slot === 'weapon').id;
  const metadata = { towerImprint: { version: 1, stacks: 3 }, starRingGearVersion: 1, starRingYieldVersion: 2, futureMetadata: { source: 'preservation-fixture' } };
  db.prepare('UPDATE rpg_equipment SET enhance_level=15,bonus_json=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(initial.equipment.find(item => item.id === itemId).bonus_json), ...metadata }), itemId);
  grantMaterials(db, id);
  const before = rows(db, 'SELECT * FROM rpg_equipment WHERE id=?', itemId)[0];
  const craftBody = { requestId: 'craft-temper001', itemId, recipeId: 'temper', enhanceLevel: 0, base_stat: 999999 };
  await Promise.all([Atlas.craft(env, id, craftBody, T0), Atlas.craft(env, id, craftBody, T0)]);
  const after = rows(db, 'SELECT * FROM rpg_equipment WHERE id=?', itemId)[0];
  assert.equal(after.base_stat, before.base_stat + Math.max(1, Math.round(before.base_stat * .03)));
  for (const key of Object.keys(before).filter(key => key !== 'base_stat')) assert.deepEqual(after[key], before[key], key);
  assert.equal(db.prepare('SELECT crafts FROM rpg_atlas_forges WHERE item_id=?').get(itemId).crafts, 1);
  assert.equal(db.prepare("SELECT quantity FROM rpg_atlas_materials WHERE char_id=? AND material='atlas_shard'").get(id).quantity, 88);
  const committed = assets(db, id);
  await Atlas.craft(env, id, craftBody, T0);
  assert.deepEqual(assets(db, id), committed);
  await Atlas.craft(env, id, { requestId: 'craft-focus001', itemId, recipeId: 'focus' }, T0);
  await Atlas.craft(env, id, { requestId: 'craft-venom001', itemId, recipeId: 'venom' }, T0);
  const third = assets(db, id);
  await assert.rejects(Atlas.craft(env, id, { requestId: 'craft-fourth01', itemId, recipeId: 'temper' }, T0), error => error.code === 'atlas_craft_cap');
  assert.deepEqual(assets(db, id), third);
  assert.equal(db.prepare('SELECT enhance_level FROM rpg_equipment WHERE id=?').get(itemId).enhance_level, 15);
  const finalBonus = JSON.parse(db.prepare('SELECT bonus_json FROM rpg_equipment WHERE id=?').get(itemId).bonus_json);
  for (const [key, value] of Object.entries(metadata)) assert.deepEqual(finalBonus[key], value, key);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='星圖銘刻'").get().n, 3);
});

test('crafting during Atlas affects future stats while the active run and existing enhancements stay fixed', async t => {
  const { env, db, id, initial } = await fixture(t);
  const itemId = initial.equipment.find(item => item.slot === 'weapon').id;
  db.prepare('UPDATE rpg_equipment SET enhance_level=9 WHERE id=?').run(itemId);
  grantMaterials(db, id);
  const started = await Atlas.start(env, id, body(), T0), snapshot = savedState(db, id);
  await Atlas.craft(env, id, { requestId: 'craft-in-run01', itemId, recipeId: 'temper' }, T0);
  assert.deepEqual(savedState(db, id), snapshot);
  assert.equal(db.prepare('SELECT enhance_level FROM rpg_equipment WHERE id=?').get(itemId).enhance_level, 9);
  await Atlas.stop(env, id, { requestId: 'stop-for-next1', runId: started.run.id }, T0 + 1000);
  await Atlas.start(env, id, body({ requestId: 'atlas-start-002' }), T0 + 1000);
  const second = savedState(db, id), player = await loadPlayer(env.DB, id, env);
  assert.equal(second.snapshot.atk, computeStats(player.char, player.equipment).atk);
  assert.ok(second.snapshot.atk >= snapshot.snapshot.atk);
  assert.notEqual(second.runId, snapshot.runId);
});

test('crafting rejects foreign equipment, insufficient materials and escrowed equipment without deleting +N', async t => {
  const { env, db, id, initial } = await fixture(t);
  const itemId = initial.equipment[0].id;
  db.prepare('UPDATE rpg_equipment SET enhance_level=11 WHERE id=?').run(itemId);
  await assert.rejects(Atlas.craft(env, id, { requestId: 'craft-missing1', itemId: 'someone-elses-item', recipeId: 'temper' }, T0), error => error.code === 'not_owned');
  await assert.rejects(Atlas.craft(env, id, { requestId: 'craft-no-mats1', itemId, recipeId: 'temper' }, T0), error => error.code === 'insufficient');
  grantMaterials(db, id);
  db.prepare('UPDATE rpg_equipment SET is_equipped=0,trade_id=? WHERE id=?').run('escrow-fixture', itemId);
  const before = assets(db, id);
  await assert.rejects(Atlas.craft(env, id, { requestId: 'craft-escrow01', itemId, recipeId: 'temper' }, T0), error => error.code === 'atlas_locked_item');
  assert.deepEqual(assets(db, id), before);
  assert.equal(db.prepare('SELECT enhance_level FROM rpg_equipment WHERE id=?').get(itemId).enhance_level, 11);
});

test('crafting also respects the existing background enhancement lock', async t => {
  const { env, db, id, initial, account } = await fixture(t);
  const itemId = initial.equipment[0].id;
  grantMaterials(db, id);
  db.prepare("INSERT INTO rpg_auto_enhance(id,owner,tg_id,item_id,item_name,target,blessed,status,level,next_at,created_at,updated_at) VALUES(?,?,?,?,?,15,0,'running',0,?,?,?)")
    .run('atlas-background-test', account, id, itemId, initial.equipment[0].name, T0 + MINUTE, T0, T0);
  const before = assets(db, id);
  await assert.rejects(Atlas.craft(env, id, { requestId: 'craft-busy001', itemId, recipeId: 'temper' }, T0), error => error.code === 'atlas_locked_item');
  assert.deepEqual(assets(db, id), before);
});

test('turning the feature off blocks new work but preserves committed operation replay and stopping/refunds', async t => {
  const { env, db, id, initial } = await fixture(t);
  const config = { requestId: 'config-before-off', buildId: 'sword_counter', supportIds: ['guarded', 'economy'], automation: 'balanced' };
  const craft = { requestId: 'craft-before-off', itemId: initial.equipment[0].id, recipeId: 'temper' };
  grantMaterials(db, id);
  await Atlas.configure(env, id, config, T0);
  await Atlas.craft(env, id, craft, T0);
  const start = body(), started = await Atlas.start(env, id, start, T0);
  env.ATLAS_ENABLED = 'false';
  const catalog = await Atlas.catalog(env, id), status = await Atlas.status(env, id, T0);
  assert.equal(catalog.enabled, true);
  assert.equal(catalog.canStart, false);
  assert.equal(status.enabled, true);
  assert.equal(status.canStart, false);
  const before = assets(db, id);
  await Atlas.configure(env, id, config, T0);
  await Atlas.craft(env, id, craft, T0);
  await Atlas.start(env, id, start, T0);
  assert.deepEqual(assets(db, id), before, 'replaying an existing operation after a feature rollback is read-only');
  await assert.rejects(Atlas.configure(env, id, { ...config, requestId: 'config-after-off' }, T0), error => error.code === 'atlas_unavailable');
  await assert.rejects(Atlas.craft(env, id, { ...craft, requestId: 'craft-after-off' }, T0), error => error.code === 'atlas_unavailable');
  await assert.rejects(Atlas.start(env, id, { ...start, requestId: 'start-after-off' }, T0), error => error.code === 'atlas_unavailable');
  const stopped = await Atlas.stop(env, id, { requestId: 'stop-after-off', runId: started.run.id }, T0 + 1000);
  assert.equal(stopped.run.status, 'stopped');
  const player = await loadPlayer(env.DB, id, env);
  assert.equal(player.char.atlas_run_id, null);
  assert.equal(player.inv.red_1, 150);
  assert.equal(player.inv.blue_1, 150);
  assert.equal(stopped.enabled, false);
  await P.withPlayer(env, id, T0 + 1000);
  const legacy = await P.withPlayer(env, id, T0 + 1000 + 2 * MINUTE);
  assert.ok(legacy.report.ticks > 0, 'legacy idle resumes after a feature rollback has closed the run');
});

test('an existing run may also finish naturally after Atlas is disabled', async t => {
  const { env, db, id } = await fixture(t);
  await Atlas.start(env, id, body(), T0);
  env.ATLAS_ENABLED = 'false';
  const finished = await finish(env, id);
  assert.equal(finished.run.status, 'completed');
  assert.equal(finished.canStart, false);
  const state = savedState(db, id), player = await loadPlayer(env.DB, id, env);
  assert.equal(player.char.atlas_run_id, null);
  assert.equal(player.inv.red_1, 150 - state.supplies.hpUsed);
  assert.equal(player.inv.blue_1, 150 - state.supplies.mpUsed);
});

test('realm cutoff caps existing runs, bounds the visible target, and refunds after chunked settlement while writes are permitted', async t => {
  // These are service-level ACTIVE-context checks. They do not claim that the
  // separate FREEZE/DRAIN maintenance and cross-D1 import workflow is finished.
  const cutoff = T0 + 4500 * 1000;
  for (const cutoffKnownAtStart of [true, false]) {
    const { env, db, id } = await fixture(t, { flags: {
      REALM_CONTEXT: { id: 'season-cutoff-fixture', ...(cutoffKnownAtStart ? { cutoffAt: cutoff } : {}) },
      ATLAS_PROFILE_JSON: JSON.stringify({ id: 'cutoff-test-only', enemyHpMultiplier: 100, enemyDefenseMultiplier: 100, enemyDamageMultiplier: .05 }),
    } });
    await Atlas.configure(env, id, { requestId: 'config-cutoff01', buildId: 'sword_counter', supportIds: ['guarded', 'economy'], automation: 'burst' }, T0);
    await Atlas.start(env, id, body({ mapCount: 96, durationMinutes: 480, supplies: { hp: 150, mp: 150 } }), T0);
    assert.equal(savedState(db, id).durationSeconds, cutoffKnownAtStart ? 4500 : 28800);
    env.REALM_CONTEXT.cutoffAt = cutoff;
    const first = await Atlas.settle(env, id, {}, cutoff + 60 * MINUTE);
    assert.equal(first.run.status, 'running');
    assert.equal(first.run.endsAt, cutoff);
    assert.equal(first.run.progress.elapsedSeconds, 4500);
    assert.equal(first.run.progress.processedSeconds, 2000);
    assert.equal(first.run.progress.catchingUp, true);
    const second = await Atlas.settle(env, id, {}, cutoff + 90 * MINUTE);
    assert.equal(second.run.progress.processedSeconds, 4000);
    const final = await Atlas.settle(env, id, {}, cutoff + 120 * MINUTE);
    assert.equal(final.run.status, 'stopped');
    assert.equal(final.run.progress.catchingUp, false);
    const state = savedState(db, id), player = await loadPlayer(env.DB, id, env);
    assert.equal(state.elapsedSeconds, 4500);
    assert.equal(state.stopReason, 'realm_ended');
    assert.equal(state.endedAt, cutoff / 1000);
    assert.equal(player.char.atlas_run_id, null);
    assert.equal(player.inv.red_1, 150 - state.supplies.hpUsed);
    assert.equal(player.inv.blue_1, 150 - state.supplies.mpUsed);
    const committed = assets(db, id);
    await Atlas.settle(env, id, {}, cutoff + 240 * MINUTE);
    assert.deepEqual(assets(db, id), committed);
  }
});

test('a realm at its cutoff cannot admit a new dispatch or reserve inventory', async t => {
  const { env, db, id } = await fixture(t, { flags: { REALM_CONTEXT: { id: 'ended-cutoff-fixture', cutoffAt: T0 } } });
  const before = assets(db, id);
  await assert.rejects(Atlas.start(env, id, body(), T0), error => /realm|season/.test(error.code || ''));
  assert.deepEqual(assets(db, id), before);
});

test('the actual two-item starter kit can complete its first map for all four classes without replacing equipment', async t => {
  const sample = [];
  for (const baseClass of ['sword', 'archer', 'mage', 'thief']) {
    const { env, db, id, initial } = await fixture(t, { baseClass });
    const equipment = rows(db, 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id', id);
    await Atlas.start(env, id, body(), T0);
    const result = await finish(env, id), state = savedState(db, id);
    assert.equal(result.run.status, 'completed', baseClass);
    assert.deepEqual(rows(db, 'SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id', id), equipment);
    assert.ok(initial.equipment.every(item => item.enhance_level === 0));
    sample.push({ baseClass, seconds: state.elapsedSeconds, hp: state.supplies.hpUsed, mp: state.supplies.mpUsed,
      netGoldAtShopPotionPrices: state.totals.gold - 6 * (state.supplies.hpUsed + state.supplies.mpUsed) });
  }
  t.diagnostic(`Prototype source-code starter sample; not a production population measurement: ${JSON.stringify(sample)}`);
});
