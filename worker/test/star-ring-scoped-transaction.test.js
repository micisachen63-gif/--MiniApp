import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, NOW, changes, snapshot, sqlRows, put } from './star-ring-scene-fixture.js';
import * as Scoped from '../src/services/star-ring-scoped.js';
import * as Receipt from '../src/services/star-ring-receipt.js';
import * as Ring from '../src/services/star-ring.js';
import * as Engine from '../src/game/star-ring.js';
import { COSMETICS } from '../src/game/star-ring-cosmetics.js';

const receiptId = (tg, request, namespace = 'app') => 'star-ring-receipt:' + tg + ':scene:' + namespace + ':' + request;
const inventory = (f, tg = f.ids[0]) => Object.fromEntries(f.sql.prepare('SELECT item,quantity FROM rpg_inventory WHERE tg_id=?').all(tg).map(row => [row.item, row.quantity]));
const run = (f, kind, body, tg = f.ids[0], now = NOW, namespace = 'app') => Scoped.run(f.env, tg, kind, body, now, namespace);
const read = (f, kind, body, now = NOW + 1, namespace = 'app') => Receipt.view(f.env, f.ids[0], { kind, ...body }, now, namespace);
const count = (f, table) => f.sql.prepare('SELECT count(*) AS n FROM ' + table).get().n;
function sameDatabase(f, before, n) { assert.deepEqual(snapshot(f.db), before); assert.equal(changes(f.db), n); }

test('Scoped create and every original action store complete typed results with the original authority', async t => {
  const f = await fixture(t, { lobby: false }), body = { tier: 80, difficulty: 'normal', tactic: 'balanced', requestId: 'create-typed-001' };
  const created = await run(f, 'create', body), id = created.result.partyId;
  assert.equal(created.signature, JSON.stringify({ kind: 'create', tier: 80, difficulty: 'normal', tactic: 'balanced' }));
  assert.deepEqual(created.result, { partyId: id, tier: 80, difficulty: 'normal', tactic: 'balanced' });
  assert.deepEqual(created.receipt.costs, {}); assert.equal(created.receipt.version, 1);
  assert.equal(count(f, 'rpg_star_ring_creations'), 1);
  const operations = [
    [f.ids[0], { action: 'ready', ready: false }], [f.ids[0], { action: 'ready', ready: true }],
    [f.ids[0], { action: 'tactic', tactic: 'deep' }],
    ...f.ids.slice(1).map(tg => [tg, { action: 'join-ready' }]), [f.ids[0], { action: 'start' }],
  ];
  for (const [i, [tg, fields]] of operations.entries()) {
    const action = { partyId: id, ...fields, requestId: 'typed-action-' + String(i).padStart(3, '0') };
    const result = await run(f, 'action', action, tg);
    assert.deepEqual(result.result, { partyId: id, ...fields });
    assert.equal(result.signature, JSON.stringify({ kind: 'action', partyId: id, ...fields }));
    assert.deepEqual(result.receipt.costs, {});
    const original = f.sql.prepare('SELECT * FROM rpg_star_ring_operations WHERE char_id=? AND request_id=?').get(tg, 'scene:app:' + action.requestId);
    assert.equal(original.operation, fields.action); assert.equal(original.run_id, id); assert.equal(original.created_at, NOW);
  }
  assert.equal(count(f, 'rpg_star_ring_starts'), 5);
  const before = snapshot(f.db), n = changes(f.db), recovered = await read(f, 'create', body, NOW + Engine.DURATION + 1);
  const replay = await run(f, 'create', body, f.ids[0], NOW + Engine.DURATION + 1);
  assert.deepEqual(recovered.result, created.result); assert.deepEqual(replay.result, created.result); assert.equal(replay.replayed, true);
  sameDatabase(f, before, n);
  await assert.rejects(run(f, 'create', { ...body, tactic: 'deep' }), { code: 'request_reused' });
});

test('Action receipts reject a changed ready flag, tactic, party or kind; simultaneous originals commit once', async t => {
  const f = await fixture(t), body = { partyId: f.id, action: 'ready', ready: false, requestId: 'ready-reused-001' };
  const first = await run(f, 'action', body), before = snapshot(f.db), n = changes(f.db);
  for (const candidate of [{ ...body, ready: true }, { ...body, action: 'tactic', tactic: 'deep' }, { ...body, partyId: 'ring:' + 'f'.repeat(32) }]) {
    await assert.rejects(read(f, 'action', candidate), { code: 'request_reused' });
    await assert.rejects(run(f, 'action', candidate), { code: 'request_reused' });
  }
  await assert.rejects(run(f, 'shop', { offerId: 'reroll', requestId: body.requestId }), { code: 'request_reused' });
  assert.deepEqual((await run(f, 'action', body)).result, first.result); sameDatabase(f, before, n);
  const concurrent = { partyId: f.id, action: 'tactic', tactic: 'deep', requestId: 'concurrent-tactic-001' };
  const output = await Promise.all([run(f, 'action', concurrent), run(f, 'action', concurrent)]);
  assert.deepEqual(output[0].result, output[1].result);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM rpg_star_ring_operations WHERE request_id=?').get('scene:app:' + concurrent.requestId).n, 1);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM rpg_ledger WHERE event_id=?').get(receiptId(f.ids[0], concurrent.requestId)).n, 1);
  const racing = { partyId: f.id, action: 'ready', requestId: 'racing-ready-001' };
  const race = await Promise.allSettled([run(f, 'action', { ...racing, ready: true }), run(f, 'action', { ...racing, ready: false })]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'request_reused');
});

test('Shop recovers original random gear after sale and class change without reroll or a second cost', async t => {
  const f = await fixture(t, { lobby: false }), body = { offerId: 'gear', requestId: 'private-random-gear-001' };
  const first = await run(f, 'shop', body), equipment = first.result.equipment[0];
  assert.match(equipment.id, /^ringshop:/); assert.deepEqual(first.receipt.costs, { star_ring_token: 40 });
  f.sql.prepare('DELETE FROM rpg_equipment WHERE id=?').run(equipment.id);
  f.sql.prepare("UPDATE rpg_characters SET base_class='mage',class_path='B1',level=100 WHERE tg_id=?").run(f.ids[0]);
  const before = snapshot(f.db), n = changes(f.db);
  assert.deepEqual((await read(f, 'shop', body, NOW + 86400000)).result, first.result);
  assert.deepEqual((await run(f, 'shop', body, f.ids[0], NOW + 86400000)).result, first.result);
  sameDatabase(f, before, n); assert.equal(inventory(f).star_ring_token, 460);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM rpg_equipment WHERE id=?').get(equipment.id).n, 0);
  assert.equal(count(f, 'rpg_star_ring_purchases'), 1);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM rpg_ledger WHERE type='星征徽記兌換'").get().n, 1);
});

test('Supplies, core exchange, already-owned cosmetic and null equip retain original costs and stored results', async t => {
  const f = await fixture(t, { lobby: false }), cosmeticId = COSMETICS[0].id;
  for (const [offerId, costs] of [['reroll', { star_ring_token: 5 }], ['core-w', { star_ring_core: 60 }], [cosmeticId, { star_ring_token: 60 }], [cosmeticId, {}]]) {
    const body = { offerId, requestId: 'shop-' + offerId + '-' + count(f, 'rpg_star_ring_purchases') };
    const result = await run(f, 'shop', body); assert.deepEqual(result.receipt.costs, costs);
    if (!Object.keys(costs).length) assert.equal(result.result.alreadyOwned, true);
    const before = snapshot(f.db), n = changes(f.db);
    assert.deepEqual((await read(f, 'shop', body)).result, result.result);
    assert.deepEqual((await run(f, 'shop', body)).result, result.result); sameDatabase(f, before, n);
  }
  for (const [i, id] of [cosmeticId, null].entries()) {
    const body = { cosmeticId: id, requestId: 'cosmetic-equip-' + i };
    const result = await run(f, 'cosmetic', body); assert.deepEqual(result.result, { cosmeticId: id });
    assert.deepEqual(result.receipt.costs, {});
    assert.deepEqual((await read(f, 'cosmetic', body)).result, result.result);
  }
  assert.equal(inventory(f).star_ring_token, 435); assert.equal(inventory(f).star_ring_core, 60);
});

test('Missing and legacy-only evidence stays pure and never upgrades an original op-only row into a typed receipt', async t => {
  const f = await fixture(t), body = { partyId: f.id, action: 'ready', ready: false, requestId: 'legacy-only-ready-001' };
  await Ring.action(f.env, f.ids[0], { ...body, requestId: 'scene:app:' + body.requestId }, NOW);
  const before = snapshot(f.db), n = changes(f.db), result = await read(f, 'action', body);
  assert.equal(result.found, false); assert.equal(result.unverified, true); assert.equal(result.recoveryAllowed, false);
  await assert.rejects(run(f, 'action', body), { code: 'star_ring_receipt_unverified' }); sameDatabase(f, before, n);
  const fresh = { ...body, requestId: 'not-yet-sent-001' };
  assert.equal((await read(f, 'action', fresh)).recoveryAllowed, true);
  f.env.REALM_CONTEXT = { id: 'season_test', phase: 'FROZEN' };
  assert.equal((await read(f, 'action', fresh)).recoveryAllowed, false);
  await assert.rejects(run(f, 'action', fresh), { code: 'realm_read_only' }); sameDatabase(f, before, n);
});

test('Namespace, malformed payload and historical recipient cannot redirect a scoped mutation', async t => {
  const f = await fixture(t, { second: true }), body = { partyId: f.id, action: 'ready', ready: true, requestId: 'namespace-ready-001' };
  await run(f, 'action', body);
  assert.equal((await read(f, 'action', body, NOW, 'service')).found, false);
  const before = snapshot(f.db), n = changes(f.db);
  await assert.rejects(run(f, 'action', { ...body, requestId: 'historical-ready-001', recipientCharId: f.secondId }), { code: 'read_only_report' });
  for (const [kind, malformed] of [
    ['action', { ...body, ready: 'true' }], ['action', { ...body, ready: undefined }], ['action', { ...body, action: 'tactic', tactic: 'new-tactic' }],
    ['create', { requestId: 'invalid-create-001', tier: '80', difficulty: 'normal', tactic: 'balanced' }],
    ['shop', { requestId: 'invalid-shop-001', offerId: 'unknown' }], ['cosmetic', { requestId: 'invalid-aura-001' }],
    ['cosmetic', { requestId: 'invalid-aura-002', cosmeticId: '' }], ['shop', { requestId: 'x', offerId: 'gear' }],
  ]) await assert.rejects(run(f, kind, malformed), { code: 'star_ring_receipt_input' });
  sameDatabase(f, before, n);
});

test('Corrupt receipt, altered original purchase and missing debit are rejected without reconstructing rewards', async t => {
  const f = await fixture(t, { lobby: false }), body = { offerId: 'reroll', requestId: 'corrupt-shop-001' };
  await run(f, 'shop', body);
  const event = receiptId(f.ids[0], body.requestId), ledger = f.sql.prepare('SELECT * FROM rpg_ledger WHERE event_id=?').get(event);
  const purchase = f.sql.prepare('SELECT * FROM rpg_star_ring_purchases WHERE char_id=? AND request_id=?').get(f.ids[0], 'scene:app:' + body.requestId);
  for (const mutate of [
    () => f.sql.prepare("UPDATE rpg_ledger SET note='not-json' WHERE event_id=?").run(event),
    () => f.sql.prepare('UPDATE rpg_ledger SET note=? WHERE event_id=?').run(JSON.stringify({ ...JSON.parse(ledger.note), version: 2 }), event),
    () => { f.sql.prepare('UPDATE rpg_ledger SET note=? WHERE event_id=?').run(ledger.note, event); f.sql.prepare("UPDATE rpg_star_ring_purchases SET reward_json='{}' WHERE char_id=? AND request_id=?").run(f.ids[0], purchase.request_id); },
    () => { f.sql.prepare('UPDATE rpg_star_ring_purchases SET reward_json=? WHERE char_id=? AND request_id=?').run(purchase.reward_json, f.ids[0], purchase.request_id); f.sql.prepare('DELETE FROM rpg_ledger WHERE event_id=?').run('star-ring-shop:' + f.ids[0] + ':' + purchase.request_id); },
  ]) {
    mutate(); const before = snapshot(f.db), n = changes(f.db);
    await assert.rejects(read(f, 'shop', body), { code: 'star_ring_receipt_corrupt' });
    await assert.rejects(run(f, 'shop', body), { code: 'star_ring_receipt_corrupt' }); sameDatabase(f, before, n);
  }
});

test('Injected final-batch failure rolls back purchase, costs, equipment and new receipt together', async t => {
  const f = await fixture(t, { lobby: false }), body = { offerId: 'gear', requestId: 'atomic-gear-failure-001' };
  const before = snapshot(f.db), batch = f.db.batch.bind(f.db);
  f.db.batch = stmts => batch(stmts.some(stmt => /INSERT INTO rpg_star_ring_purchases/.test(stmt.sql))
    ? [...stmts, f.db.prepare('INSERT INTO rpg_guard(ok) VALUES(NULL)')] : stmts);
  await assert.rejects(run(f, 'shop', body));
  f.db.batch = batch;
  assert.deepEqual(snapshot(f.db), before); assert.equal(count(f, 'rpg_star_ring_purchases'), 0);
  assert.equal((await read(f, 'shop', body)).found, false);
  const success = await run(f, 'shop', body); assert.equal(success.result.equipment.length, 1); assert.equal(inventory(f).star_ring_token, 460);
});

for (const [kind, fields, target] of [
  ['create', { tier: 80, difficulty: 'normal', tactic: 'balanced' }, 'rpg_star_ring_creations'],
  ['shop', { offerId: 'gear' }, 'rpg_star_ring_purchases'],
  ['cosmetic', { cosmeticId: null }, 'rpg_star_ring_cosmetic_operations'],
]) test('Switching current actor before final ' + kind + ' authority prevents all its writes and receipt', async t => {
  const f = await fixture(t, { lobby: false, second: true }), body = { ...fields, requestId: 'switch-' + kind + '-001' }, batch = f.db.batch.bind(f.db);
  let switched = false, afterSwitch, writesAfter;
  f.db.batch = async stmts => {
    if (!switched && stmts.some(stmt => stmt.sql.includes('INSERT INTO ' + target))) {
      switched = true; f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.secondId, f.ids[0]);
      afterSwitch = snapshot(f.db); writesAfter = changes(f.db);
    }
    return batch(stmts);
  };
  await assert.rejects(run(f, kind, body), { code: 'character_changed' });
  f.db.batch = batch; assert.equal(switched, true); assert.deepEqual(snapshot(f.db), afterSwitch);
  // SQLite total_changes includes rolled-back attempts; persisted rows are the authority.
  assert.ok(changes(f.db) >= writesAfter); assert.equal(count(f, target), 0);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM rpg_ledger WHERE event_id=?').get(receiptId(f.ids[0], body.requestId)).n, 0);
});

test('Start preparation commits per original member, but a later actor switch rolls back departure and final receipt', async t => {
  const f = await fixture(t, { second: true }), body = { partyId: f.id, action: 'start', requestId: 'switch-start-final-001' };
  const revisions = f.sql.prepare('SELECT tg_id,rev FROM rpg_characters ORDER BY tg_id').all(), batch = f.db.batch.bind(f.db);
  let switched = false, afterSwitch;
  f.db.batch = async stmts => {
    if (!switched && stmts.some(stmt => /INSERT INTO rpg_star_ring_operations/.test(stmt.sql))) {
      switched = true; f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.secondId, f.ids[0]); afterSwitch = snapshot(f.db);
    }
    return batch(stmts);
  };
  await assert.rejects(run(f, 'action', body, f.ids[0], NOW + 60000), { code: 'character_changed' }); f.db.batch = batch;
  assert.equal(switched, true); assert.deepEqual(snapshot(f.db), afterSwitch);
  assert.equal(f.sql.prepare('SELECT status FROM rpg_star_ring_runs WHERE id=?').get(f.id).status, 'lobby');
  assert.equal(count(f, 'rpg_star_ring_starts'), 0); assert.equal(count(f, 'rpg_star_ring_operations'), 0);
  assert.ok(revisions.some(row => f.sql.prepare('SELECT rev FROM rpg_characters WHERE tg_id=?').get(row.tg_id).rev > row.rev),
    'original separate withPlayer preparation remains legitimately committed');
});

test('A scoped guard also stops the first preparatory write after an actor switch', async t => {
  const f = await fixture(t, { lobby: false, second: true }), batch = f.db.batch.bind(f.db);
  let switched = false, afterSwitch;
  f.db.batch = async stmts => {
    if (!switched && stmts.some(stmt => /UPDATE rpg_characters SET/.test(stmt.sql))) {
      switched = true; f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.secondId, f.ids[0]); afterSwitch = snapshot(f.db);
    }
    return batch(stmts);
  };
  await assert.rejects(run(f, 'create', { tier: 80, difficulty: 'normal', tactic: 'balanced', requestId: 'switch-before-prep-001' }, f.ids[0], NOW + 60000), { code: 'character_changed' });
  f.db.batch = batch; assert.equal(switched, true); assert.deepEqual(snapshot(f.db), afterSwitch);
  assert.equal(count(f, 'rpg_star_ring_runs'), 0);
});

test('Committed original checkpoint survives a later scoped failure; explicit same-ID retry cannot duplicate its rewards', async t => {
  const f = await fixture(t, { start: true, second: true }), body = { partyId: f.id, action: 'tactic', tactic: 'deep', requestId: 'checkpoint-then-switch-001' };
  const batch = f.db.batch.bind(f.db), due = NOW + Engine.STAGE_MS;
  let switched = false, afterSwitch;
  f.db.batch = async stmts => {
    if (!switched && stmts.some(stmt => /INSERT INTO rpg_star_ring_operations/.test(stmt.sql))) {
      switched = true; f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.secondId, f.ids[0]); afterSwitch = snapshot(f.db);
    }
    return batch(stmts);
  };
  await assert.rejects(run(f, 'action', body, f.ids[0], due), { code: 'character_changed' }); f.db.batch = batch;
  assert.equal(switched, true); assert.deepEqual(snapshot(f.db), afterSwitch);
  assert.equal(count(f, 'rpg_star_ring_rewards'), 5);
  const saved = f.sql.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(f.id);
  assert.equal(JSON.parse(saved.state_json).results.length, 1); assert.equal(JSON.parse(saved.state_json).nextTactic, undefined);
  f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.ids[0], f.ids[0]);
  const missing = await read(f, 'action', body, due + 1); assert.equal(missing.found, false); assert.equal(missing.recoveryAllowed, true);
  const rewardRows = sqlRows(f.db, 'rpg_star_ring_rewards');
  await run(f, 'action', body, f.ids[0], due + 1);
  assert.deepEqual(sqlRows(f.db, 'rpg_star_ring_rewards'), rewardRows); assert.equal((await read(f, 'action', body, due + 2)).found, true);
});
