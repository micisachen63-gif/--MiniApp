import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { mulberry32 } from '../src/game/rng.js';
import { computeStats } from '../src/game/stats.js';
import { ELEMENT_KEYS } from '../src/game/constants.js';
import { advanceAtlasRun } from '../src/game/atlas-engine.js';
import { ATLAS_EFFECTS_RULES_VERSION } from '../src/game/atlas-effects.js';
import { loadPlayer } from '../src/db.js';
import * as Player from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';

const plain = value => JSON.parse(JSON.stringify(value));
const POTION_KEYS = ['red_1', 'red_2', 'red_3', 'red_4', 'blue_1', 'blue_2', 'blue_3', 'blue_4'];
const readRun = (db, id) => db.prepare('SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY rowid DESC LIMIT 1').get(id);
const stateOf = (db, id) => JSON.parse(readRun(db, id).state_json);
const inventory = (db, id) => Object.fromEntries(POTION_KEYS.map(key => [
  key, db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').get(id, key)?.quantity || 0,
]));
const rewardLedger = (db, id) => plain(db.prepare(
  "SELECT event_id,gold_delta,exp_delta,note FROM rpg_ledger WHERE tg_id=? AND type='星圖掉落' ORDER BY event_id"
).all(id));

function databaseState(db) {
  // Every table belongs to this test's disposable SQLite database. Checking the
  // whole transaction catches leaked RNG, rewards, quests, inventory or receipts.
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all()
    .map(({ name }) => [name, plain(db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all())]);
}

async function fixture(t, {
  baseClass = 'sword', element = 'fire', resist = 120,
  pct = { elemPct: .15, expPct: .25, freeCastPct: .35 }, flags = {},
} = {}) {
  const env = {
    DB: freshDb(), ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent' },
    ATLAS_PROFILE_JSON: JSON.stringify({
      id: 'effects-sqlite-test-only', enemyHpMultiplier: .05, enemyDamageMultiplier: .05,
      travelMultiplier: .05, experienceMultiplier: 1.15, goldMultiplier: 1.3,
    }),
    ...flags,
  };
  const db = env.DB.sqlite;
  t.after(() => db.close());
  const account = '894401';
  const initial = await Player.createCharacter(env, {
    tgId: account, name: '裝備效果整合測試', gender: 'f', baseClass,
  }, T0, mulberry32(7));
  assert.equal(initial.equipment.length, 2, 'start with real server-created equipment');
  const id = initial.char.tg_id;
  const weapon = initial.equipment.find(item => item.slot === 'weapon');
  const armor = initial.equipment.find(item => item.slot === 'armor');
  db.prepare('UPDATE rpg_characters SET level=30,exp=17 WHERE tg_id=?').run(id);
  db.prepare('UPDATE rpg_equipment SET enhance_level=12,element_tier=?,element=?,element_stat=24,bonus_json=? WHERE id=?')
    .run('common', element, JSON.stringify({ ...JSON.parse(weapon.bonus_json), ...pct }), weapon.id);
  db.prepare('UPDATE rpg_equipment SET element_tier=?,element=?,element_stat=? WHERE id=?')
    .run('common', 'earth', resist, armor.id);
  for (const key of POTION_KEYS) {
    db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,40) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=40').run(id, key);
  }
  await Player.withPlayer(env, id, T0, (work, ctx) => Player.settings(work, ctx, { autoBlue: false }));
  const player = await loadPlayer(env.DB, id, env);
  const stats = computeStats(player.char, player.equipment.filter(item => item.is_equipped));
  db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp, stats.maxMp, id);
  return { env, db, id, account, initial, weapon, armor, stats };
}

const startBody = (extra = {}) => ({
  requestId: 'effects-start-001', mapId: 'laurel_intro', mapCount: 1, durationMinutes: 10,
  supplies: { items: { red_2: 3, blue_4: 4 } }, ...extra,
});

function pureFinish(run, now = T0 / 1000 + 600) {
  let state = plain(run), result;
  const rewards = [], activities = [];
  do {
    result = advanceAtlasRun(state, now, { maxSteps: 137 });
    state = result.state; rewards.push(...result.rewards); activities.push(...result.activities);
  } while (result.stillCatchingUp);
  return { state, rewards, activities };
}

function assertSnapshot(actor, stats) {
  for (const key of ['level', 'element', 'weaponElem']) assert.equal(actor[key], stats[key], key);
  assert.deepEqual(actor.elementResist, stats.elementResist);
  assert.deepEqual(actor.elementResistance, stats.elementResistance);
  for (const key of ['elemPct', 'expPct', 'freeCastPct']) assert.equal(actor.pct[key], stats.pct[key], key);
}

function assertPotionConservation(db, id, before, state) {
  const after = inventory(db, id);
  for (const key of POTION_KEYS) {
    assert.equal(state.supplies.items[key] + state.supplies.usedItems[key], state.supplies.initialItems[key], key + ' budget');
    assert.equal(after[key], before[key] - state.supplies.usedItems[key], key + ' final stock');
  }
}

test('new departures snapshot real enhanced equipment and native per-hit elements, ignoring client effects', async t => {
  const { env, db, id, weapon, stats } = await fixture(t, { baseClass: 'thief' });
  assert.equal(stats.hitAttackMultiplier, .6);
  assert.equal(stats.weaponElem, 14, 'the native adapter already scaled and rounded 24 elemental power');
  assert.equal(stats.elementResistance.earth, .3, '120 points at level 30 means 30% resistance');
  const gearBefore = plain(db.prepare('SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id').all(id));
  const started = await Atlas.start(env, id, startBody({
    effectsRulesVersion: 'client-unsupported-v99',
    effects: { version: 'client-unsupported-v99', actor: { element: 'dark', weaponElem: 999999, pct: { expPct: 999, freeCastPct: 1 } } },
    snapshot: { level: 9999, element: 'dark', weaponElem: 999999, elementResistance: { earth: .4 }, pct: { expPct: 999, freeCastPct: 1 } },
    stats: { atk: 99999999, weaponElem: 999999, pct: { expPct: 999 } },
  }), T0);
  const state = stateOf(db, id);
  assert.equal(state.effects.version, ATLAS_EFFECTS_RULES_VERSION);
  assertSnapshot(state.effects.actor, stats);
  assert.equal(state.snapshot.atk, stats.atk, 'do not reapply enhancement or native hit scaling');
  assert.equal(state.effects.enemy.element, 'earth');
  for (const key of ELEMENT_KEYS) assert.equal(state.effects.enemy.elementResist[key], 0, 'do not add new enemy resistance');
  assert.equal(state.metrics.freeCasts, 0);
  assert.ok(Number.isInteger(state.effects.manaRng) && state.effects.manaRng > 0);
  assert.deepEqual(started.run.equipmentEffects.actor, state.effects.actor);
  assert.equal(started.run.equipmentEffects.version, ATLAS_EFFECTS_RULES_VERSION);
  assert.equal(started.run.equipmentEffects.enemyElement, 'earth');
  assert.equal(Object.hasOwn(started.run.equipmentEffects, 'manaRng'), false);
  assert.equal(db.prepare('SELECT enhance_level FROM rpg_equipment WHERE id=?').get(weapon.id).enhance_level, 12);
  assert.deepEqual(plain(db.prepare('SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id').all(id)), gearBefore);
});

test('real equipment changes affect only the next departure and old request replay never resnapshots or charges again', async t => {
  const { env, db, id, weapon } = await fixture(t);
  const input = startBody();
  const first = await Atlas.start(env, id, input, T0);
  const frozen = stateOf(db, id);
  await Player.withPlayer(env, id, T0 + 1000, (work, ctx) => Player.unequip(work, ctx, { itemId: weapon.id }));
  const changedPlayer = await loadPlayer(env.DB, id, env);
  const nextStats = computeStats(changedPlayer.char, changedPlayer.equipment.filter(item => item.is_equipped));
  assert.equal(nextStats.element, null);
  assert.equal(nextStats.weaponElem, 0);
  assert.ok(nextStats.atk < frozen.snapshot.atk);
  assert.deepEqual(stateOf(db, id), frozen, 'the current run does not reread equipped items');
  const changed = databaseState(db);
  await Atlas.start(env, id, { ...input, effectsRulesVersion: 'another-client-value', snapshot: { pct: { expPct: 1 } } }, T0 + 2000);
  await Atlas.status(env, id, T0 + 120000);
  assert.deepEqual(databaseState(db), changed, 'replay and status are read-only even after gear changes and elapsed time');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rpg_atlas_operations WHERE kind='start'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='星圖補給保留'").get().n, 2);
  await Atlas.stop(env, id, { requestId: 'effects-stop-first', runId: first.run.id }, T0 + 1000);
  await Atlas.start(env, id, startBody({ requestId: 'effects-start-next' }), T0 + 2000);
  const next = stateOf(db, id);
  assert.notEqual(next.runId, frozen.runId);
  assertSnapshot(next.effects.actor, nextStats);
  assert.equal(next.snapshot.atk, nextStats.atk);
  const committed = databaseState(db);
  await Atlas.start(env, id, input, T0 + 3000);
  assert.deepEqual(databaseState(db), committed, 'an old receipt cannot replace the active later run');
  assert.equal(stateOf(db, id).runId, next.runId);
});

test('experience is rounded once in each receipt, conserved through concurrent settlement, and never multiplied into gold', async t => {
  const { env, db, id, stats } = await fixture(t, {
    element: 'earth', resist: 0, pct: { elemPct: 0, expPct: .25, freeCastPct: 1 },
  });
  assert.equal(stats.pct.expPct, .25);
  const beforePlayer = await loadPlayer(env.DB, id, env), beforeStock = inventory(db, id);
  const input = startBody();
  const started = await Atlas.start(env, id, input, T0);
  const initialRun = stateOf(db, id);
  const expected = pureFinish(initialRun);
  const noBonus = plain(initialRun);
  noBonus.effects.actor.pct.expPct = 0;
  const ordinaryExp = pureFinish(noBonus);
  assert.equal(expected.state.status, 'completed');
  // These concrete values distinguish one final floor from floor-then-bonus:
  // room: floor(12 * 1.15 * 1.25) = 17; completion: floor(30 * 1.15 * 1.25) = 43.
  assert.deepEqual(expected.rewards.map(row => row.exp), [17, 17, 17, 17, 17, 43]);
  assert.equal(expected.state.totals.exp, 128);
  assert.deepEqual(expected.rewards.map(row => row.gold), ordinaryExp.rewards.map(row => row.gold));
  assert.deepEqual(expected.rewards.map(row => row.materials), ordinaryExp.rewards.map(row => row.materials));
  await Promise.all([
    Atlas.settle(env, id, { runId: started.run.id }, T0 + 600000),
    Atlas.settle(env, id, { runId: started.run.id }, T0 + 600000),
  ]);
  const committed = stateOf(db, id), player = await loadPlayer(env.DB, id, env);
  assert.deepEqual(committed, expected.state);
  assert.equal(player.char.level, beforePlayer.char.level);
  assert.equal(player.char.exp, beforePlayer.char.exp + 128);
  assert.equal(player.char.gold, beforePlayer.char.gold + ordinaryExp.state.totals.gold);
  assert.ok(committed.metrics.casts > 0);
  assert.equal(committed.metrics.freeCasts, committed.metrics.casts);
  assert.equal(committed.metrics.manaSpent, 0);
  const ledger = rewardLedger(db, id);
  assert.equal(ledger.length, 6);
  assert.deepEqual(ledger.map(row => row.exp_delta), [17, 17, 17, 17, 17, 43]);
  assert.equal(ledger.reduce((sum, row) => sum + row.exp_delta, 0), committed.totals.exp);
  assert.equal(new Set(ledger.map(row => row.event_id)).size, 6);
  assertPotionConservation(db, id, beforeStock, committed);
  const terminal = databaseState(db);
  await Atlas.settle(env, id, {}, T0 + 1200000);
  await Atlas.status(env, id, T0 + 1200000);
  await Atlas.start(env, id, input, T0 + 1200000);
  assert.deepEqual(databaseState(db), terminal);
  // A first terminal stop still records its own operation/cutoff by the existing
  // contract. Its replay is wholly read-only and neither call pays rewards again.
  const stop = { requestId: 'effects-stop-complete', runId: started.run.id };
  await Atlas.stop(env, id, stop, T0 + 1200000);
  assert.deepEqual(rewardLedger(db, id), ledger);
  assert.deepEqual(stateOf(db, id), committed);
  assertPotionConservation(db, id, beforeStock, committed);
  const stopped = databaseState(db);
  await Atlas.stop(env, id, stop, T0 + 1800000);
  assert.deepEqual(databaseState(db), stopped);
});

test('a late refund failure rolls back effects RNG, rewards and every asset, then retries the identical saved simulation', async t => {
  const { env, db, id } = await fixture(t);
  const beforeStock = inventory(db, id);
  await Atlas.start(env, id, startBody(), T0);
  const original = stateOf(db, id), expected = pureFinish(original);
  assert.equal(expected.state.status, 'completed');
  assert.ok(expected.state.metrics.casts > 0);
  assert.notEqual(expected.state.effects.manaRng, original.effects.manaRng);
  const before = databaseState(db);
  db.exec("CREATE TRIGGER effects_refund_failure BEFORE INSERT ON rpg_ledger WHEN NEW.type='星圖補給歸還' AND NEW.item='blue_4' BEGIN SELECT RAISE(ABORT,'effects_refund_test_failure'); END");
  await assert.rejects(Atlas.settle(env, id, {}, T0 + 600000), /effects_refund_test_failure/);
  assert.deepEqual(databaseState(db), before, 'no partial character, run, RNG, receipt, inventory, quest or reward commit');
  db.exec('DROP TRIGGER effects_refund_failure');
  await Atlas.settle(env, id, {}, T0 + 600000);
  assert.deepEqual(stateOf(db, id), expected.state);
  assert.deepEqual(rewardLedger(db, id).map(row => row.exp_delta), expected.rewards.map(row => row.exp));
  assertPotionConservation(db, id, beforeStock, expected.state);
});

test('a lost response after the effects settlement commits cannot reroll free casts or issue experience twice', async t => {
  const { env, db, id } = await fixture(t);
  const input = startBody();
  await Atlas.start(env, id, input, T0);
  const expected = pureFinish(stateOf(db, id));
  const batch = env.DB.batch.bind(env.DB);
  let lost = false;
  env.DB.batch = async statements => {
    const result = await batch(statements);
    if (!lost && statements.some(statement => statement.sql.startsWith('UPDATE rpg_atlas_runs SET status='))) {
      lost = true;
      throw new Error('effects settlement response lost after commit');
    }
    return result;
  };
  await assert.rejects(Atlas.settle(env, id, {}, T0 + 600000), /effects settlement response lost after commit/);
  assert.equal(lost, true);
  env.DB.batch = batch;
  assert.deepEqual(stateOf(db, id), expected.state);
  const committed = databaseState(db);
  await Atlas.settle(env, id, {}, T0 + 1200000);
  await Atlas.start(env, id, input, T0 + 1200000);
  assert.deepEqual(databaseState(db), committed);
  assert.deepEqual(rewardLedger(db, id).map(row => row.exp_delta), expected.rewards.map(row => row.exp));
});

test('invalid server-derived effects reject departure before reserving items or creating a receipt', async t => {
  const { env, db, id, weapon } = await fixture(t);
  const row = db.prepare('SELECT bonus_json FROM rpg_equipment WHERE id=?').get(weapon.id);
  db.prepare('UPDATE rpg_equipment SET bonus_json=? WHERE id=?')
    .run(JSON.stringify({ ...JSON.parse(row.bonus_json), expPct: -1 }), weapon.id);
  const before = databaseState(db);
  await assert.rejects(Atlas.start(env, id, startBody(), T0), error => error.code === 'atlas_invalid_effects');
  assert.deepEqual(databaseState(db), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_atlas_runs').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rpg_atlas_operations WHERE kind='start'").get().n, 0);
});

test('unsupported or incomplete persisted effects fail settlement without repairing the run or changing assets', async t => {
  const { env, db, id } = await fixture(t);
  await Atlas.start(env, id, startBody(), T0);
  const original = stateOf(db, id), row = readRun(db, id);
  for (const [label, alter, code] of [
    ['future version', state => { state.effects.version = 'atlas-legacy-effects-v999'; }, 'atlas_effects_unsupported'],
    ['missing RNG', state => { delete state.effects.manaRng; }, 'atlas_invalid_effects'],
    ['missing resistance', state => { delete state.effects.actor.elementResist.earth; }, 'atlas_invalid_effects'],
    ['inconsistent resistance', state => { state.effects.actor.elementResistance.earth = .1; }, 'atlas_invalid_effects'],
  ]) {
    const damaged = plain(original); alter(damaged);
    db.prepare('UPDATE rpg_atlas_runs SET state_json=? WHERE id=?').run(JSON.stringify(damaged), row.id);
    const before = databaseState(db);
    await assert.rejects(Atlas.settle(env, id, {}, T0 + 600000), error => error.code === code, label);
    assert.deepEqual(databaseState(db), before, label);
  }
  db.prepare('UPDATE rpg_atlas_runs SET state_json=? WHERE id=?').run(JSON.stringify(original), row.id);
  await Atlas.settle(env, id, {}, T0 + 600000);
  assert.deepEqual(stateOf(db, id), pureFinish(original).state);
});
