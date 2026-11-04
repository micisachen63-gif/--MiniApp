import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { insertEquipStmt } from '../src/db.js';
import { makeGear } from '../src/game/gear.js';
import { affixView } from '../src/game/affixes.js';
import { mulberry32 } from '../src/game/rng.js';
import * as Player from '../src/services/player.js';
import * as Recovery from '../src/services/equipment-recovery.js';
import * as Trade from '../src/services/trade.js';

const row = (db, id) => ({ ...db.prepare('SELECT * FROM rpg_equipment WHERE id=?').get(id) });

async function fixture(t) {
  const DB = freshDb(), db = DB.sqlite;
  t.after(() => db.close());
  const env = { DB, EQUIPMENT_RECOVERY_ENABLED: 'true', ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent', phase: 'ACTIVE' } };
  const owner = (await Player.createCharacter(env, { tgId: '87101', name: '快照賣方', gender: 'm', baseClass: 'sword' }, T0, mulberry32(7))).char.tg_id;
  const buyer = (await Player.createCharacter(env, { tgId: '87102', name: '快照買方', gender: 'f', baseClass: 'mage' }, T0, mulberry32(8))).char.tg_id;
  db.prepare('UPDATE rpg_characters SET level=50,gold=10000,last_settle_at=?').run(T0);
  const item = makeGear({ id: 'trade-reforge-target', tgId: owner, cls: 'sword', slot: 'weapon', kind: 'sword', tier: 1, rng: mulberry32(9), now: T0, source: 'atlas', forceRarity: 'legendary' });
  Object.assign(item, { enhance_level: 13, bound: 0, is_equipped: 0, affixes_json: '[]' });
  item.bonus_json = JSON.stringify({ ...JSON.parse(item.bonus_json), atlasLootVersion: 'atlas-loot-v1', atlasLootRunId: 'frozen-run', atlasLootMapId: 'laurel_survey', atlasLootRewardId: 'frozen-reward', towerImprint: 2 });
  await insertEquipStmt(DB, item).run();
  const scraps = [];
  for (let i = 0; i < 10; i++) {
    const scrap = makeGear({ id: 'trade-scrap-' + i, tgId: owner, cls: 'sword', slot: 'weapon', kind: 'sword', tier: 1, rng: mulberry32(i), now: T0, source: 'shop', forceRarity: 'common' });
    await insertEquipStmt(DB, scrap).run(); scraps.push(scrap.id);
  }
  const salvage = { mode: 'salvage', itemIds: scraps };
  const preview = await Recovery.preview(env, owner, salvage, T0);
  await Recovery.action(env, owner, { ...salvage, token: preview.token, requestId: 'trade-race-scrap', acknowledge: true }, T0);
  const reforge = { mode: 'reforge', itemIds: [item.id] };
  const proposed = await Recovery.preview(env, owner, reforge, T0);
  const request = { ...reforge, token: proposed.token, requestId: 'trade-race-reforge', acknowledge: true };
  return { env, db, owner, buyer, item, request };
}

function injectReforge(f) {
  const original = f.env.DB.batch.bind(f.env.DB);
  let injected = false, committed;
  f.env.DB.batch = async statements => {
    const escrowsTarget = statements.some(statement => statement.sql.startsWith('UPDATE rpg_equipment SET trade_id = ?') && statement.params[1] === f.item.id);
    if (!injected && escrowsTarget) {
      injected = true;
      await Recovery.action(f.env, f.owner, f.request, T0);
      committed = row(f.db, f.item.id);
      assert.notEqual(committed.affixes_json, f.item.affixes_json, 'the interleaved operation is a real independent-affix reforge');
      assert.equal(committed.enhance_level, 13);
      assert.equal(committed.bonus_json, f.item.bonus_json);
    }
    return original(statements);
  };
  return { get injected() { return injected; }, get committed() { return committed; } };
}

async function verifyCompletedTrade(f, tradeId, expected) {
  const snapshot = JSON.parse(f.db.prepare("SELECT snapshot_json FROM rpg_trade_items WHERE trade_id=? AND kind='equip'").get(tradeId).snapshot_json);
  assert.deepEqual(snapshot, expected, 'the escrow record must capture the same full item that was actually locked');
  for (const tgId of [f.owner, f.buyer]) await Trade.lock(f.env, { tgId, tradeId }, T0);
  const open = await Trade.tradeView(f.env, tradeId, f.owner, T0);
  for (const tgId of [f.owner, f.buyer]) await Trade.confirm(f.env, { tgId, tradeId, offerRev: open.offerRev }, T0);
  const delivered = row(f.db, f.item.id);
  assert.deepEqual(delivered, { ...expected, tg_id: f.buyer, trade_id: null, is_equipped: 0 });
  const history = await Trade.tradeView(f.env, tradeId, f.owner, T0);
  assert.equal(history.status, 'done');
  assert.equal(history.a.lines[0].enhance, 13);
  assert.deepEqual(history.a.lines[0].affixes, affixView(delivered));
  assert.equal(delivered.bonus_json, f.item.bonus_json, 'Atlas provenance and imprint survive both the reforge and transfer');
  const repeated = await Recovery.action(f.env, f.owner, f.request, T0);
  assert.equal(repeated.replayed, true, 'a lost reforge receipt remains recoverable after the item changed owner');
  assert.deepEqual(row(f.db, f.item.id), delivered, 'recovering the old receipt cannot reforge the new owner item');
}

test('addLine retries when a real reforge commits after its equipment read and records the actual transferred snapshot', async t => {
  const f = await fixture(t);
  const trade = await Trade.openTradeStmts(f.env, { aTg: f.owner, bTg: f.buyer }, T0);
  await f.env.DB.batch(trade.stmts);
  const race = injectReforge(f);
  await Trade.addLine(f.env, { tgId: f.owner, tradeId: trade.id, equipId: f.item.id, requestId: 'add-after-reforge' }, T0);
  assert.equal(race.injected, true);
  await verifyCompletedTrade(f, trade.id, race.committed);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rpg_trade_items').get().n, 1);
});

test('openWithEquip safely conflicts on an interleaved real reforge and the same request can retry without duplicate windows', async t => {
  const f = await fixture(t), race = injectReforge(f);
  const request = { tgId: f.owner, target: { tgId: f.buyer }, equipId: f.item.id, requestId: 'open-after-reforge' };
  await assert.rejects(Trade.openWithEquip(f.env, request, T0), error => error.code === 'conflict');
  assert.equal(race.injected, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rpg_trades').get().n, 0, 'failed escrow rolls back the provisional window');
  assert.equal(row(f.db, f.item.id).trade_id, null);
  const retried = await Trade.openWithEquip(f.env, request, T0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rpg_trades').get().n, 1);
  await verifyCompletedTrade(f, retried.tradeId, race.committed);
});
