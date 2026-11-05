import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { gameplaySnapshot } from './realm-test-helpers.js';
import * as P from '../src/services/player.js';
import * as B from '../src/services/boss.js';
import { bossExchange, exchangeScoped } from '../src/services/boss-exchange.js';
import * as RECEIPT from '../src/services/boss-receipt.js';
import { BOSS } from '../src/game/constants.js';

const OWNER = '19301';
function put(db, item, n) {
  db.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(OWNER, item, n);
}
const inventory = db => Object.fromEntries(db.sqlite.prepare('SELECT item,quantity FROM rpg_inventory WHERE tg_id=?').all(OWNER).map(row => [row.item, row.quantity]));
const rows = (db, table) => db.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all();
const changes = db => db.sqlite.prepare('SELECT total_changes() AS n').get().n;
async function fixture(t) {
  const env = { DB: freshDb() }; t.after(() => env.DB.sqlite.close());
  await P.createCharacter(env, { tgId: OWNER, name: '首領交易甲', gender: 'f', baseClass: 'sword' }, T0);
  const second = await P.createCharacter(env, { tgId: OWNER, name: '首領交易乙', gender: 'm', baseClass: 'mage', charSlot: 2 }, T0);
  env.DB.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(OWNER, OWNER);
  env.DB.sqlite.prepare("UPDATE rpg_characters SET level=60,class_path='A1' WHERE tg_id=?").run(OWNER);
  for (const [item, n] of [['boss_essence', 500], ['relic_fragment', 120], ['mat_3', 1], ['mat_4', 1]]) put(env.DB, item, n);
  const { id } = await B.spawnDue(env, T0, { force: { tier: 1 } });
  env.DB.sqlite.prepare('UPDATE rpg_boss_instances SET hp=1000000000,max_hp=1000000000 WHERE id=?').run(id);
  return { env, db: env.DB, id, secondId: second.char.tg_id };
}

test('Stale expectedWin is rejected before any attack, expiry maintenance, idle settlement or outbox write', async t => {
  const { env, db, id } = await fixture(t);
  for (const now of [T0 + BOSS.attackWindowMs, T0 + BOSS.durationMs + 1]) {
    const before = gameplaySnapshot(db), count = changes(db);
    await assert.rejects(B.attackScoped(env, OWNER, { bossId: id, expectedWin: 0 }, now), { code: 'boss_window_changed' });
    await assert.rejects(B.attackBoss(env, OWNER, id, now, { expectedWin: 0 }), { code: 'boss_window_changed' });
    assert.equal(changes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
  }
  await assert.rejects(B.attackScoped(env, OWNER, { bossId: id }, T0), { code: 'boss_receipt_input' });
});

test('Scoped attack commits one original tuple and an explicit same-window retry returns only stored damage evidence', async t => {
  const { env, db, id } = await fixture(t), body = { bossId: id, expectedWin: 0 };
  const first = await B.attackScoped(env, OWNER, body, T0);
  assert.equal(first.replayed, false); assert.equal(first.resultEvidence, 'response');
  assert.equal(first.bossId, id); assert.equal(first.win, 0); assert.ok(first.result.damage > 0);
  const before = gameplaySnapshot(db), count = changes(db), second = await B.attackScoped(env, OWNER, body, T0 + 1000);
  assert.equal(second.replayed, true); assert.equal(second.resultEvidence, 'attack-row');
  assert.deepEqual(second.result, { bossId: id, win: 0, damage: first.result.damage, createdAt: T0 });
  assert.equal(changes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
  assert.equal(rows(db, 'rpg_boss_attacks').length, 1);
  await assert.rejects(B.attackScoped(env, OWNER, body, T0 + BOSS.attackWindowMs), { code: 'boss_window_changed' });
  assert.equal(rows(db, 'rpg_boss_attacks').length, 1);
});

test('Racing scoped attacks cannot consume supplies or deal damage twice in one original window', async t => {
  const { env, db, id } = await fixture(t), body = { bossId: id, expectedWin: 0 };
  const [first, second] = await Promise.all([B.attackScoped(env, OWNER, body, T0), B.attackScoped(env, OWNER, body, T0)]);
  assert.equal(first.result.damage, second.result.damage);
  assert.equal(rows(db, 'rpg_boss_attacks').length, 1);
  assert.equal(db.sqlite.prepare('SELECT hp FROM rpg_boss_instances WHERE id=?').get(id).hp, 1000000000 - first.result.damage);
  assert.equal([first, second].filter(result => !result.replayed).length, 1);
});

test('Original attack and exchange entrypoints retain their old response and duplicate semantics', async t => {
  const { env, db, id } = await fixture(t);
  const result = await B.attackBoss(env, OWNER, id, T0);
  assert.equal('bossId' in result, false); assert.equal('win' in result, false);
  await assert.rejects(B.attackBoss(env, OWNER, id, T0), { code: 'cooldown' });
  const body = { offer: 'reroll', requestId: 'legacy-old-request' };
  const run = () => P.withPlayer(env, OWNER, T0, (work, ctx) => bossExchange(work, ctx, body));
  const exchanged = await run();
  assert.deepEqual(exchanged.result, { items: { scroll_r: 5 } });
  await assert.rejects(run(), { code: 'duplicate' });
  assert.equal(rows(db, 'rpg_ledger').filter(row => row.type === '首領精華操作收據').length, 0);
  const receipt = await RECEIPT.view(env, OWNER, { kind: 'exchange', ...body }, T0);
  assert.equal(receipt.found, false); assert.equal(receipt.unverified, true); assert.equal(receipt.recoveryAllowed, false);
});

test('Scoped exchange stores exact signature, typed costs and original output in the same atomic batch', async t => {
  const { env, db } = await fixture(t), body = { offer: 'reroll', requestId: 'exchange-first-001' };
  const first = await exchangeScoped(env, OWNER, body, T0, 'app');
  assert.deepEqual(first.result, { items: { scroll_r: 5 } }); assert.equal(first.replayed, false);
  assert.equal(first.signature, JSON.stringify({ offer: 'reroll' }));
  assert.equal(inventory(db).boss_essence, 495); assert.equal(inventory(db).scroll_r, 5);
  const before = gameplaySnapshot(db), count = changes(db);
  const receipt = await RECEIPT.view(env, OWNER, { kind: 'exchange', ...body }, T0 + 86400000, 'app');
  assert.equal(receipt.found, true); assert.equal(receipt.signature, first.signature); assert.equal(receipt.recoveryAllowed, false);
  assert.deepEqual(receipt.receipt.costs, { boss_essence: 5 }); assert.deepEqual(receipt.result, first.result);
  const again = await exchangeScoped(env, OWNER, body, T0 + 86400000, 'app');
  assert.equal(again.replayed, true); assert.deepEqual(again.result, first.result);
  assert.equal(changes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
  await assert.rejects(exchangeScoped(env, OWNER, { ...body, offer: 'armor' }, T0, 'app'), { code: 'request_reused' });
  assert.deepEqual(gameplaySnapshot(db), before);
});

test('Racing exchange requests with one original ID grant once and return one committed result', async t => {
  const { env, db } = await fixture(t), body = { offer: 'weapon', requestId: 'exchange-race-001' };
  const [a, b] = await Promise.all([exchangeScoped(env, OWNER, body, T0, 'app'), exchangeScoped(env, OWNER, body, T0, 'app')]);
  assert.deepEqual(a.result, b.result); assert.equal(a.signature, b.signature);
  assert.equal(inventory(db).boss_essence, 495); assert.equal(inventory(db).scroll_w, 4);
  assert.equal(rows(db, 'rpg_ledger').filter(row => row.type === '首領精華操作收據').length, 1);
});

test('A committed random relic is recovered exactly even after that equipment is sold or changed', async t => {
  const { env, db } = await fixture(t), body = { offer: 'relic', requestId: 'exchange-relic-001' };
  const first = await exchangeScoped(env, OWNER, body, T0, 'app'), item = first.result.equipment;
  assert.equal(item.grade, 'relic'); assert.equal(item.tg_id, OWNER); assert.equal(item.tier, 6);
  assert.equal(inventory(db).relic_fragment, 90);
  db.sqlite.prepare('DELETE FROM rpg_equipment WHERE id=?').run(item.id);
  const before = gameplaySnapshot(db), count = changes(db);
  const again = await exchangeScoped(env, OWNER, body, T0 + 1000, 'app');
  assert.equal(again.replayed, true); assert.deepEqual(again.result.equipment, item);
  assert.equal(db.sqlite.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(item.id), undefined);
  assert.equal(changes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

test('Legacy exchange consumes exactly the confirmed full quantities and its signature is typed and canonical', async t => {
  const { env, db } = await fixture(t), body = { offer: 'legacy', requestId: 'exchange-legacy-001', expectedMaterials: { mat_3: 1, mat_4: 1 } };
  const first = await exchangeScoped(env, OWNER, body, T0, 'app');
  assert.equal(first.signature, JSON.stringify({ offer: 'legacy', expectedMaterials: { mat_3: 1, mat_4: 1 } }));
  assert.deepEqual(first.result, { items: { boss_essence: 28 } });
  assert.equal(inventory(db).boss_essence, 528); assert.equal(inventory(db).mat_3, 0); assert.equal(inventory(db).mat_4, 0);
  const before = gameplaySnapshot(db);
  const receipt = await RECEIPT.view(env, OWNER, { kind: 'exchange', ...body }, T0, 'app');
  assert.deepEqual(receipt.receipt.costs, body.expectedMaterials); assert.deepEqual(receipt.result, first.result);
  assert.equal((await exchangeScoped(env, OWNER, body, T0, 'app')).replayed, true);
  await assert.rejects(exchangeScoped(env, OWNER, { ...body, expectedMaterials: { mat_3: 0, mat_4: 1 } }, T0, 'app'), { code: 'request_reused' });
  assert.deepEqual(gameplaySnapshot(db), before);
});

for (const item of ['mat_3', 'mat_4']) test('Legacy commit rejects a concurrent ' + item + ' grant that does not change character rev', async t => {
  const { env, db } = await fixture(t);
  if (item === 'mat_4') put(db, 'mat_4', 0);
  const expectedMaterials = { mat_3: 1, mat_4: item === 'mat_4' ? 0 : 1 };
  const beforeRev = db.sqlite.prepare('SELECT rev FROM rpg_characters WHERE tg_id=?').get(OWNER).rev;
  const before = inventory(db), ledger = rows(db, 'rpg_ledger'), gear = rows(db, 'rpg_equipment');
  const batch = db.batch.bind(db); let injected = false;
  db.batch = async statements => {
    if (!injected && statements.some(statement => /^UPDATE rpg_characters SET/.test(statement.sql))) {
      injected = true;
      db.sqlite.prepare('UPDATE rpg_inventory SET quantity=quantity+1 WHERE tg_id=? AND item=?').run(OWNER, item);
    }
    return batch(statements);
  };
  await assert.rejects(exchangeScoped(env, OWNER, { offer: 'legacy', requestId: 'legacy-race-' + item, expectedMaterials }, T0, 'app'), { code: 'material_changed' });
  assert.equal(injected, true);
  assert.deepEqual(inventory(db), { ...before, [item]: before[item] + 1 });
  assert.equal(db.sqlite.prepare('SELECT rev FROM rpg_characters WHERE tg_id=?').get(OWNER).rev, beforeRev);
  assert.deepEqual(rows(db, 'rpg_ledger'), ledger); assert.deepEqual(rows(db, 'rpg_equipment'), gear);
});

test('Failure of the receipt INSERT rolls back payment and the random equipment together', async t => {
  const { env, db } = await fixture(t);
  db.sqlite.exec("CREATE TRIGGER fail_boss_receipt BEFORE INSERT ON rpg_ledger WHEN NEW.type='首領精華操作收據' BEGIN SELECT RAISE(ABORT,'boss_receipt_test_failure'); END");
  const before = gameplaySnapshot(db);
  await assert.rejects(exchangeScoped(env, OWNER, { offer: 'relic', requestId: 'receipt-atomic-001' }, T0, 'app'), /boss_receipt_test_failure/);
  assert.deepEqual(gameplaySnapshot(db), before);
});

test('Incomplete old receipts remain unverified and cannot authorize resending a legacy or relic exchange', async t => {
  const { env, db } = await fixture(t), body = { offer: 'relic', requestId: 'old-partial-001' };
  db.sqlite.prepare("INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at) VALUES(?,?,'首領精華兌換','relic_fragment',-30,'old',?)")
    .run('boss-exchange:' + OWNER + ':app:' + body.requestId + ':relic_fragment', OWNER, T0);
  const before = gameplaySnapshot(db), count = changes(db);
  const record = await RECEIPT.view(env, OWNER, { kind: 'exchange', ...body }, T0, 'app');
  assert.equal(record.found, false); assert.equal(record.recoveryAllowed, false); assert.equal(record.reason, 'legacy_receipt');
  await assert.rejects(exchangeScoped(env, OWNER, body, T0, 'app'), { code: 'boss_receipt_legacy' });
  assert.equal(changes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

for (const corruption of ['result', 'cost', 'ledger', 'signature', 'empty']) test('Malformed ' + corruption + ' exchange evidence is never reported as a confirmed success', async t => {
  const { env, db } = await fixture(t), body = { offer: 'armor', requestId: 'corrupt-' + corruption + '-001' };
  await exchangeScoped(env, OWNER, body, T0, 'app');
  const event = 'boss-exchange-receipt:' + OWNER + ':app:' + body.requestId;
  const saved = JSON.parse(db.sqlite.prepare('SELECT note FROM rpg_ledger WHERE event_id=?').get(event).note);
  if (corruption === 'result') saved.result.items.scroll_a = 999;
  if (corruption === 'cost') saved.costs.boss_essence = '5';
  if (corruption === 'signature') saved.signature = JSON.stringify({ offer: 'weapon' });
  if (corruption === 'empty') saved.result = {};
  if (corruption === 'ledger') db.sqlite.prepare("UPDATE rpg_ledger SET item_delta=3 WHERE event_id=?").run('boss-exchange:' + OWNER + ':app:' + body.requestId + ':scroll_a');
  db.sqlite.prepare('UPDATE rpg_ledger SET note=? WHERE event_id=?').run(JSON.stringify(saved), event);
  const before = gameplaySnapshot(db), count = changes(db), code = corruption === 'signature' ? 'request_reused' : 'boss_receipt_corrupt';
  await assert.rejects(RECEIPT.view(env, OWNER, { kind: 'exchange', ...body }, T0, 'app'), { code });
  await assert.rejects(exchangeScoped(env, OWNER, body, T0, 'app'), { code });
  assert.equal(changes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

for (const mode of ['exchange-success', 'exchange-insufficient', 'exchange-material-changed', 'attack-success', 'attack-down']) test('Scoped ' + mode + ' guards every attempted write after a concurrent active-character switch without a revision bump', async t => {
  const { env, db, id, secondId } = await fixture(t);
  if (mode === 'exchange-insufficient') put(db, 'boss_essence', 0);
  if (mode === 'attack-down') db.sqlite.prepare('UPDATE rpg_characters SET boss_down_until=? WHERE tg_id=?').run(T0 + BOSS.downMs, OWNER);
  const before = gameplaySnapshot(db);
  const batch = db.batch.bind(db); let injected = false, attempted = 0;
  db.batch = async statements => {
    if (statements.some(statement => /^UPDATE rpg_characters SET/.test(statement.sql))) {
      attempted++;
      if (!injected) {
        injected = true;
        // Intentionally no rev bump: the scoped guard, not the normal optimistic
        // revision check, must stop both successful and rejected-action batches.
        db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(secondId, OWNER);
      }
    }
    return batch(statements);
  };
  const operation = mode.startsWith('attack')
    ? B.attackScoped(env, OWNER, { bossId: id, expectedWin: 0 }, T0 + 60000)
    : exchangeScoped(env, OWNER, mode === 'exchange-material-changed'
      ? { offer: 'legacy', requestId: 'switch-' + mode, expectedMaterials: { mat_3: 0, mat_4: 0 } }
      : { offer: mode === 'exchange-success' ? 'relic' : 'reroll', requestId: 'switch-' + mode }, T0 + 60000, 'app');
  await assert.rejects(operation, { code: 'character_changed' });
  assert.equal(injected, true); assert.ok(attempted >= 1);
  db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(OWNER, OWNER);
  assert.deepEqual(gameplaySnapshot(db), before);
});

test('A character switch after a killing hit cannot let later settlement or loot writes escape the scoped guard', async t => {
  const { env, db, id, secondId } = await fixture(t);
  db.sqlite.prepare('UPDATE rpg_boss_instances SET hp=1 WHERE id=?').run(id);
  const beforeInventory = inventory(db), beforeLedger = rows(db, 'rpg_ledger');
  const batch = db.batch.bind(db); let switched = false;
  db.batch = async statements => {
    if (!switched && statements.some(statement => /^UPDATE rpg_boss_instances SET status = 'settling'/.test(statement.sql))) {
      switched = true; db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(secondId, OWNER);
    }
    return batch(statements);
  };
  await assert.rejects(B.attackScoped(env, OWNER, { bossId: id, expectedWin: 0 }, T0), { code: 'character_changed' });
  assert.equal(switched, true);
  const boss = db.sqlite.prepare('SELECT hp,status,result_json FROM rpg_boss_instances WHERE id=?').get(id);
  assert.equal(boss.hp, 0); assert.equal(boss.status, 'active'); assert.equal(boss.result_json, null);
  assert.equal(rows(db, 'rpg_boss_attacks').length, 1);
  // The already committed hit legitimately grants its original guardian voucher.
  // Settlement rewards after the switch must remain absent.
  const ledger = rows(db, 'rpg_ledger'), voucher = ledger.filter(row => row.event_id === 'guardian-voucher:' + id + ':' + OWNER);
  assert.equal(voucher.length, 1); assert.equal(voucher[0].item, 'guardian_voucher'); assert.equal(voucher[0].item_delta, 1);
  assert.deepEqual(ledger.filter(row => row !== voucher[0]), beforeLedger);
  assert.equal(inventory(db).boss_essence, beforeInventory.boss_essence);
  assert.equal(rows(db, 'rpg_outbox').filter(row => row.kind === 'boss_end').length, 0);
  db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(OWNER, OWNER);
  const receipt = await RECEIPT.view(env, OWNER, { kind: 'attack', bossId: id, win: 0 }, T0, 'app');
  assert.equal(receipt.found, true); assert.equal('kill' in receipt.result, false);
});
