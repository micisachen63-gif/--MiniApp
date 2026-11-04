import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { mulberry32 } from '../src/game/rng.js';
import { POTIONS } from '../src/game/constants.js';
import { createAtlasRun, advanceAtlasRun } from '../src/game/atlas-engine.js';
import * as Player from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';

const KEYS = ['red_1', 'red_2', 'red_3', 'red_4', 'blue_1', 'blue_2', 'blue_3', 'blue_4'];
const itemMap = (items = {}) => Object.fromEntries(KEYS.map(key => [key, items[key] ?? 0]));
const sumKind = (items, kind) => KEYS.filter(key => key.startsWith(kind + '_')).reduce((total, key) => total + (items[key] || 0), 0);
const inventory = (db, id) => itemMap(Object.fromEntries(db.prepare('SELECT item,quantity FROM rpg_inventory WHERE tg_id=?').all(id).map(row => [row.item, row.quantity])));
const readRun = (db, id) => db.prepare('SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY rowid DESC LIMIT 1').get(id);
const stateOf = (db, id) => JSON.parse(readRun(db, id).state_json);
const plain = value => JSON.parse(JSON.stringify(value));

function databaseState(db) {
  // This is an isolated in-memory fixture. Comparing all game tables catches
  // partial inventory, ledger, receipt, quest and active-character commits.
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all()
    .map(({ name }) => [name, plain(db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all())]);
}

function seedPotions(db, id, items) {
  for (const [key, quantity] of Object.entries(itemMap(items))) {
    if (!quantity) db.prepare('DELETE FROM rpg_inventory WHERE tg_id=? AND item=?').run(id, key);
    else db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id, key, quantity);
  }
}

const settingsFor = (env, id, settings, now = T0) => Player.withPlayer(env, id, now, (work, ctx) => Player.settings(work, ctx, settings));

async function fixture(t, { stocks = { red_1: 15, red_2: 12, red_4: 9, blue_1: 16, blue_3: 13, blue_4: 10 }, settings, flags = {} } = {}) {
  const env = { DB: freshDb(), ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent' }, ...flags };
  const db = env.DB.sqlite;
  t.after(() => db.close());
  const account = '894201';
  const initial = await Player.createCharacter(env, { tgId: account, name: '補給整合測試', gender: 'f', baseClass: 'sword' }, T0, mulberry32(7));
  const id = initial.char.tg_id;
  seedPotions(db, id, stocks);
  if (settings) await settingsFor(env, id, settings);
  return { env, db, id, account, initial };
}

const startBody = (items = { red_2: 3, red_4: 4, blue_3: 5, blue_4: 6 }, extra = {}) => ({
  requestId: 'supply-start-001', mapId: 'laurel_intro', queueMode: 'duration', durationMinutes: 1,
  supplies: { items }, ...extra,
});

async function finish(env, id, now = T0 + 180000) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await Atlas.settle(env, id, {}, now);
    if (result.run.status !== 'running') return result;
    assert.equal(result.run.progress.catchingUp, true);
  }
  assert.fail('The bounded fixture did not finish within twenty settlement chunks');
}

function assertConservation(db, id, original, state) {
  const remaining = itemMap(state.supplies.items), used = itemMap(state.supplies.usedItems), reserved = itemMap(state.supplies.initialItems);
  const after = inventory(db, id);
  for (const key of KEYS) {
    assert.equal(remaining[key] + used[key], reserved[key], key + ' run budget');
    assert.equal(after[key], original[key] - used[key], key + ' inventory after refund');
  }
  assert.equal(state.supplies.hp, sumKind(remaining, 'red'));
  assert.equal(state.supplies.mp, sumKind(remaining, 'blue'));
  assert.equal(state.supplies.hpUsed, sumKind(used, 'red'));
  assert.equal(state.supplies.mpUsed, sumKind(used, 'blue'));
  const ledger = plain(db.prepare("SELECT type,item,item_delta FROM rpg_ledger WHERE tg_id=? AND type IN ('星圖補給保留','星圖補給歸還') ORDER BY type,item").all(id));
  const expected = [];
  for (const key of KEYS) {
    if (reserved[key]) expected.push({ type: '星圖補給保留', item: key, item_delta: -reserved[key] });
    if (remaining[key]) expected.push({ type: '星圖補給歸還', item: key, item_delta: remaining[key] });
  }
  // SQLite's ordering is byte ordering; compare by the item/type identity instead.
  const sort = list => list.sort((a, b) => (a.type + a.item).localeCompare(b.type + b.item, 'en'));
  assert.deepEqual(sort(ledger), sort(expected), 'one reserve and at most one refund per actual item');
}

test('status reads all potion grades and saved next-run policy without changing any game table', async t => {
  const { env, db, id } = await fixture(t, { stocks: { red_2: 4, red_4: 7, blue_3: 6, blue_4: 8 }, settings: {
    autoRedPct: 70, autoBluePct: 35, autoBlue: false, autoRedPotion: 'red_4', autoBluePotion: 'blue_3',
  } });
  const before = databaseState(db);
  const result = await Atlas.status(env, id, T0 + 60000);
  assert.deepEqual(result.supplies.items, itemMap({ red_2: 4, red_4: 7, blue_3: 6, blue_4: 8 }));
  assert.equal(result.supplies.hp, 0, 'cached legacy clients still interpret hp as red_1 availability');
  assert.equal(result.supplies.mp, 0, 'cached legacy clients still interpret mp as blue_1 availability');
  assert.deepEqual(result.supplies.totals, { hp: 11, mp: 14 });
  assert.deepEqual(result.supplies.policy, { hpPreference: 'red_4', mpPreference: 'blue_3', hpThresholdPct: 70, mpThresholdPct: 35, autoBlue: false });
  assert.equal(result.scene.live.supplies.hp, 0);
  assert.equal(result.scene.live.supplies.mp, 0);
  assert.deepEqual(result.scene.live.supplies.totals, { hp: 11, mp: 14 });
  assert.deepEqual(result.scene.live.supplies.items, result.supplies.items);
  assert.deepEqual(result.scene.live.supplies.policy, result.supplies.policy);
  assert.equal(result.run, null);
  assert.deepEqual(databaseState(db), before);
});

test('itemized departure reserves exact grades once and canonical request replay cannot recharge or retune it', async t => {
  const { env, db, id } = await fixture(t);
  const before = inventory(db, id), requested = itemMap({ red_1: 2, red_2: 3, red_4: 4, blue_1: 1, blue_3: 5, blue_4: 6 });
  const input = startBody(requested, { seed: 'client-seed', snapshot: { maxHp: 99999999 }, restoreByItem: { red_4: 99999999 } });
  const result = await Atlas.start(env, id, input, T0);
  const state = stateOf(db, id);
  assert.equal(state.supplies.supplyRulesVersion, 'atlas-supplies-v1');
  assert.deepEqual(state.supplies.items, requested);
  assert.deepEqual(state.supplies.initialItems, requested);
  assert.deepEqual(itemMap(state.supplies.usedItems), itemMap());
  for (const key of KEYS) {
    assert.equal(inventory(db, id)[key], before[key] - requested[key], key);
    assert.equal(state.supplies.restoreByItem[key], POTIONS[key].heal, key + ' server restoration');
  }
  assert.equal(result.run.supplies.hp, 9);
  assert.equal(result.run.supplies.mp, 12);
  assert.deepEqual(result.run.supplies.items, requested);
  assert.deepEqual(result.run.supplies.initialItems, requested);
  assert.deepEqual(result.run.supplies.policy, state.supplies.policy);
  assert.deepEqual(result.scene.run.supplies.items, requested);
  assert.deepEqual(result.scene.run.supplies.initialItems, requested);
  assert.deepEqual(result.scene.run.supplies.usedItems, state.supplies.usedItems);
  assert.deepEqual(result.scene.run.supplies.policy, state.supplies.policy);
  assert.equal(result.scene.run.supplies.hp, 9);
  assert.equal(result.scene.run.supplies.mp, 12);
  const committed = databaseState(db);
  const reordered = Object.fromEntries(Object.entries(requested).reverse().filter(([, amount]) => amount > 0));
  await Atlas.start(env, id, { ...input, supplies: { items: reordered } }, T0 + 2000);
  assert.deepEqual(databaseState(db), committed);
  await assert.rejects(Atlas.start(env, id, { ...input, supplies: { items: { ...requested, red_4: 5 } } }, T0), { code: 'request_reused' });
  assert.deepEqual(databaseState(db), committed);
});

test('high-grade-only supplies actually heal, honor disabled blue, and refund the original items exactly once', async t => {
  const { env, db, id } = await fixture(t, { stocks: { red_4: 6, blue_4: 7 }, settings: {
    autoRedPct: 80, autoBluePct: 80, autoBlue: false, autoRedPotion: 'red_4', autoBluePotion: 'blue_4',
  } });
  const before = inventory(db, id);
  db.prepare('UPDATE rpg_characters SET hp=1,mp=0 WHERE tg_id=?').run(id);
  const input = startBody({ red_4: 4, blue_4: 5 });
  await Atlas.start(env, id, input, T0);
  const final = await finish(env, id), state = stateOf(db, id);
  assert.equal(final.run.status, 'completed');
  assert.ok(state.supplies.usedItems.red_4 > 0, 'a real high-grade red potion must be consumed');
  assert.ok(state.metrics.hpRestored > 0);
  assert.equal(state.supplies.mpUsed, 0, 'autoBlue=false also disables insufficient-mana rescue');
  assert.equal(state.supplies.usedItems.blue_4 || 0, 0);
  assertConservation(db, id, before, state);
  assert.equal(inventory(db, id).red_1, 0, 'high red potions must not turn into starter potions');
  assert.equal(inventory(db, id).blue_1, 0, 'high blue potions must not turn into starter potions');
  assert.equal(db.prepare('SELECT atlas_run_id FROM rpg_characters WHERE tg_id=?').get(id).atlas_run_id, null);
  const committed = databaseState(db);
  await Atlas.settle(env, id, {}, T0 + 86400000);
  await Atlas.start(env, id, input, T0 + 86400000);
  assert.deepEqual(databaseState(db), committed);
});

test('saved settings change the next dispatch only and replay still returns the original operation', async t => {
  const { env, db, id } = await fixture(t, { settings: { autoRedPct: 25, autoBluePct: 30, autoBlue: true, autoRedPotion: 'red_2', autoBluePotion: 'blue_3' } });
  const input = startBody();
  await Atlas.start(env, id, input, T0);
  const departure = readRun(db, id).state_json;
  const oldPolicy = stateOf(db, id).supplies.policy;
  await settingsFor(env, id, { autoRedPct: 80, autoBluePct: 75, autoBlue: false, autoRedPotion: 'auto', autoBluePotion: 'blue_4' }, T0 + 1000);
  const result = await Atlas.status(env, id, T0 + 2000);
  const expectedNext = { hpPreference: 'auto', mpPreference: 'blue_4', hpThresholdPct: 80, mpThresholdPct: 75, autoBlue: false };
  assert.deepEqual(result.supplies.policy, expectedNext);
  assert.deepEqual(result.run.supplies.policy, oldPolicy);
  assert.deepEqual(result.scene.live.supplies.policy, expectedNext);
  assert.deepEqual(result.scene.run.supplies.policy, oldPolicy);
  assert.equal(readRun(db, id).state_json, departure);
  const committed = databaseState(db);
  await Atlas.start(env, id, input, T0 + 3000);
  assert.deepEqual(databaseState(db), committed);
  await Atlas.stop(env, id, { requestId: 'supply-stop-settings', runId: result.run.id }, T0 + 4000);
  await Atlas.start(env, id, startBody({}, { requestId: 'supply-next-policy' }), T0 + 4000);
  assert.deepEqual(stateOf(db, id).supplies.policy, expectedNext);
});

test('invalid, mixed or insufficient itemized requests leave all inventory, receipts and game tables untouched', async t => {
  const { env, db, id } = await fixture(t);
  const before = databaseState(db);
  const invalid = [
    { items: { red_2: -1 } }, { items: { red_2: 1.5 } }, { items: { red_2: '2' } }, { items: { red_2: null } },
    { items: { red_2: NaN } }, { items: { red_2: Infinity } }, { items: { red_2: 501 } },
    { items: { red_1: 300, red_2: 201 } }, { items: { blue_1: 251, blue_4: 250 } },
    { items: { red_5: 1 } }, { items: { scroll_w: 1 } }, { items: [] }, { items: null },
    { items: { red_2: 1 }, hp: 0 }, { items: { red_2: 1 }, mp: 0 },
    { items: { red_2: 1 }, policy: { hpThresholdPct: 80 } }, { items: { red_2: 1 }, hpRestore: 999999 },
  ];
  for (let index = 0; index < invalid.length; index++) {
    await assert.rejects(Atlas.start(env, id, startBody({}, { requestId: 'supply-invalid-' + index, supplies: invalid[index] }), T0), { code: 'atlas_input' });
    assert.deepEqual(databaseState(db), before, 'invalid request ' + index);
  }
  await assert.rejects(Atlas.start(env, id, startBody({ red_4: 10 }), T0), { code: 'insufficient' });
  assert.deepEqual(databaseState(db), before, 'insufficient one grade cannot consume any other grade');
});

test('competing departures cannot spend the same itemized stock twice', async t => {
  const { env, db, id } = await fixture(t, { stocks: { red_4: 5, blue_3: 6 } });
  const input = startBody({ red_4: 5, blue_3: 6 });
  const results = await Promise.allSettled([
    Atlas.start(env, id, input, T0),
    Atlas.start(env, id, { ...input, requestId: 'supply-racing-002' }, T0),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_atlas_runs').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rpg_atlas_operations WHERE kind='start'").get().n, 1);
  assert.deepEqual(inventory(db, id), itemMap());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='星圖補給保留'").get().n, 2);
  await finish(env, id);
  assertConservation(db, id, itemMap({ red_4: 5, blue_3: 6 }), stateOf(db, id));
});

test('failure at a later reserve ledger row rolls back every grade, the run and its request receipt', async t => {
  const { env, db, id } = await fixture(t);
  const before = databaseState(db), input = startBody({ red_4: 4, blue_4: 5 });
  db.exec("CREATE TRIGGER supply_reserve_failure BEFORE INSERT ON rpg_ledger WHEN NEW.type='星圖補給保留' AND NEW.item='blue_4' BEGIN SELECT RAISE(ABORT,'supply_reserve_test_failure'); END");
  await assert.rejects(Atlas.start(env, id, input, T0), /supply_reserve_test_failure/);
  assert.deepEqual(databaseState(db), before);
  db.exec('DROP TRIGGER supply_reserve_failure');
  await Atlas.start(env, id, input, T0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_atlas_runs').get().n, 1);
  assert.equal(inventory(db, id).red_4, 5);
  assert.equal(inventory(db, id).blue_4, 5);
});

test('failure during itemized refunds rolls back rewards, run progress and every inventory refund together', async t => {
  const { env, db, id } = await fixture(t);
  const original = inventory(db, id);
  await Atlas.start(env, id, startBody({ red_4: 4, blue_4: 5 }), T0);
  const before = databaseState(db);
  db.exec("CREATE TRIGGER supply_refund_failure BEFORE INSERT ON rpg_ledger WHEN NEW.type='星圖補給歸還' AND NEW.item='blue_4' BEGIN SELECT RAISE(ABORT,'supply_refund_test_failure'); END");
  await assert.rejects(Atlas.settle(env, id, {}, T0 + 60000), /supply_refund_test_failure/);
  assert.deepEqual(databaseState(db), before);
  db.exec('DROP TRIGGER supply_refund_failure');
  await finish(env, id);
  assertConservation(db, id, original, stateOf(db, id));
});

test('lost start and settlement responses do not duplicate high-grade charges, refunds or receipts', async t => {
  const { env, db, id } = await fixture(t);
  const original = inventory(db, id), input = startBody({ red_4: 4, blue_4: 5 });
  const batch = env.DB.batch.bind(env.DB);
  let phase = 'start', lostStart = false, lostSettlement = false;
  env.DB.batch = async statements => {
    const result = await batch(statements);
    if (phase === 'start' && !lostStart && statements.some(statement => statement.sql.startsWith('INSERT INTO rpg_atlas_runs('))) {
      lostStart = true; throw new Error('supply response lost after start commit');
    }
    if (phase === 'settle' && !lostSettlement && statements.some(statement => statement.sql.startsWith('UPDATE rpg_atlas_runs SET status='))) {
      lostSettlement = true; throw new Error('supply response lost after settlement commit');
    }
    return result;
  };
  try { await Atlas.start(env, id, input, T0); } catch (error) { assert.match(error.message, /response lost after start commit/); }
  assert.equal(lostStart, true);
  const charged = databaseState(db);
  await Atlas.start(env, id, input, T0 + 1000);
  assert.deepEqual(databaseState(db), charged);
  phase = 'settle';
  try { await Atlas.settle(env, id, {}, T0 + 60000); } catch (error) { assert.match(error.message, /response lost after settlement commit/); }
  assert.equal(lostSettlement, true);
  assert.equal(readRun(db, id).status, 'completed');
  assertConservation(db, id, original, stateOf(db, id));
  const settled = databaseState(db);
  await Atlas.settle(env, id, {}, T0 + 120000);
  await Atlas.start(env, id, input, T0 + 120000);
  assert.deepEqual(databaseState(db), settled);
});

test('manual stop, fatal combat and a newly imposed realm cutoff all return the exact unused grades once', async t => {
  for (const mode of ['stop-disabled', 'death', 'realm-cutoff']) await t.test(mode, async t => {
    const flags = mode === 'death' ? { ATLAS_PROFILE_JSON: JSON.stringify({ id: 'fatal-supply-fixture', enemyHpMultiplier: 100, enemyDamageMultiplier: 100 }) }
      : mode === 'realm-cutoff' ? { REALM_CONTEXT: { id: 'season-supply-fixture', phase: 'ACTIVE' } } : {};
    const { env, db, id } = await fixture(t, { flags, settings: { autoBlue: false } });
    const original = inventory(db, id);
    const started = await Atlas.start(env, id, startBody({ red_2: 4, red_4: 5, blue_3: 6, blue_4: 7 }, { durationMinutes: 3 }), T0);
    let result;
    if (mode === 'stop-disabled') {
      env.ATLAS_ENABLED = 'false';
      result = await Atlas.stop(env, id, { requestId: 'supply-stop-disabled', runId: started.run.id }, T0 + 15000);
      assert.equal(result.run.report.reason, 'player_stopped');
    } else {
      if (mode === 'realm-cutoff') env.REALM_CONTEXT.cutoffAt = T0 + 15000;
      result = await finish(env, id, T0 + 86400000);
      assert.equal(result.run.report.reason, mode === 'death' ? 'hp_depleted' : 'realm_ended');
    }
    assert.equal(result.run.status, mode === 'death' ? 'failed' : 'stopped');
    const state = stateOf(db, id);
    if (mode === 'realm-cutoff') assert.equal(state.elapsedSeconds, 15);
    assertConservation(db, id, original, state);
    assert.equal(db.prepare('SELECT atlas_run_id FROM rpg_characters WHERE tg_id=?').get(id).atlas_run_id, null);
    const committed = databaseState(db);
    await Atlas.settle(env, id, {}, T0 + 2 * 86400000);
    assert.deepEqual(databaseState(db), committed);
  });
});

test('legacy request identity and ignored restore overrides remain compatible after itemized support', async t => {
  const { env, db, id } = await fixture(t);
  const input = { requestId: 'supply-legacy-receipt', mapId: 'laurel_intro', mapCount: 1, durationMinutes: 60,
    supplies: { hp: 4, mp: 5, hpRestore: 99999999, mpRestore: 99999999 } };
  await Atlas.start(env, id, input, T0);
  const signature = db.prepare('SELECT signature FROM rpg_atlas_operations WHERE request_id=?').get(input.requestId).signature;
  assert.equal(signature, JSON.stringify({ charId: id, mapId: 'laurel_intro', mapCount: 1, durationMinutes: 60, supplies: { hp: 4, mp: 5 } }));
  const state = stateOf(db, id);
  assert.equal(state.supplies.supplyRulesVersion, 'atlas-supplies-v1');
  assert.equal(state.supplies.hpRestore, 50);
  assert.equal(state.supplies.mpRestore, 40);
  assert.deepEqual(state.supplies.initialItems, itemMap({ red_1: 4, blue_1: 5 }));
  const committed = databaseState(db);
  await Atlas.start(env, id, { ...input, supplies: { hp: 4, mp: 5 } }, T0 + 1000);
  assert.deepEqual(databaseState(db), committed);
});

test('a real frozen v1 snapshot and a pre-upgrade v4 snapshot retain legacy supply settlement and never gain new policy', async t => {
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/atlas-v1-resume.json', import.meta.url), 'utf8'));
  for (const version of ['atlas-v1', 'atlas-v4']) await t.test(version, async t => {
    const { env, db, id, account } = await fixture(t, { stocks: { red_1: 40, blue_1: 40, red_4: 9, blue_4: 10 }, settings: { autoRedPct: 80, autoBlue: false } });
    const run = version === 'atlas-v1' ? structuredClone(golden.partial) : createAtlasRun({
      runId: 'pre-upgrade-v4-supply', realmId: 'permanent', seed: 'legacy-supply-fixture', startAt: T0 / 1000,
      durationSeconds: 60, queueMode: 'duration', mapId: 'laurel_intro', buildId: 'sword_whirlwind',
      snapshot: { characterId: id, baseClass: 'sword', level: 1, atk: 35, def: 20, maxHp: 120, maxMp: 50, hp: 39, mp: 0 },
      supplies: { hp: 4, mp: 5, hpRestore: 50, mpRestore: 40 },
    });
    assert.equal(run.ruleset_version, version);
    assert.equal(Object.hasOwn(run.supplies, 'supplyRulesVersion'), false);
    // Bind the frozen synthetic actor to this fixture's real character identity.
    // Combat, supplies, timing and every reward field stay exactly as recorded.
    if (version === 'atlas-v1') run.snapshot.characterId = id;
    const now = (run.startedAt + run.durationSeconds) * 1000;
    const expected = version === 'atlas-v1' ? structuredClone(golden.expectedFinal) : advanceAtlasRun(run, now / 1000).state;
    if (version === 'atlas-v1') expected.snapshot.characterId = id;
    seedPotions(db, id, { red_1: 40 - run.supplies.hpInitial, blue_1: 40 - run.supplies.mpInitial, red_4: 9, blue_4: 10 });
    db.prepare('INSERT INTO rpg_atlas_runs(id,realm_id,account_id,char_id,status,state_json,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(run.runId, 'permanent', account, id, 'running', JSON.stringify(run), run.startedAt * 1000, run.processedAt * 1000);
    db.prepare('UPDATE rpg_characters SET atlas_run_id=? WHERE tg_id=?').run(run.runId, id);
    const status = await Atlas.status(env, id, now);
    assert.equal(Object.hasOwn(status.run.supplies, 'policy'), false);
    assert.equal(Object.hasOwn(status.scene.run.supplies, 'policy'), false);
    await finish(env, id, now);
    assert.deepEqual(stateOf(db, id), expected);
    assert.deepEqual(inventory(db, id), itemMap({ red_1: 40 - expected.supplies.hpUsed, blue_1: 40 - expected.supplies.mpUsed, red_4: 9, blue_4: 10 }));
    const committed = databaseState(db);
    await Atlas.settle(env, id, {}, now + 86400000);
    assert.deepEqual(databaseState(db), committed);
  });
});
