import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { freshDb } from './d1-shim.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW } from './realm-test-helpers.js';
import { handle } from '../src/index.js';
import { createCharacter } from '../src/services/player.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { resolveRealm, scopeEnvForRealm, transitionRealmPhase } from '../src/realm/index.js';
import * as Market from '../src/services/market-exchange.js';
import * as Guardian from '../src/services/guardian-sigil.js';
import { makeGear } from '../src/game/gear.js';
import { insertEquipStmt } from '../src/db.js';

const SEASON = 'season_2026_01', BOT = 'exchange-actions-synthetic-token', SECRET = 'exchange-actions-synthetic-service';
const clone = value => JSON.parse(JSON.stringify(value));
const scalar = (db, sql, ...args) => db.sqlite.prepare(sql).get(...args);
const wallet = (db, id) => scalar(db, 'SELECT gold FROM rpg_characters WHERE tg_id=?', id).gold;
const inventory = (db, id, item = 'scroll_w') => scalar(db, 'SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?', id, item)?.quantity || 0;
const pin = (account = '111', extra = {}) => ({ accountId: account, realmId: 'permanent', selectedCharacterId: account, contextEpoch: 7, ...extra });
const intent = (kind, account = '111', extra = {}) => ({ ...pin(account), kind, requestId: crypto.randomUUID(), characterId: account, recovery: false, ...extra });
function initData(account) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(account), first_name: 'ExchangeActions' }) });
  const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join('\n');
  params.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(BOT).digest()).update(data).digest('hex'));
  return params.toString();
}
async function fixture(t, { realms = false } = {}) {
  const env = realms ? await initialized(t) : { DB: freshDb() };
  if (!realms) t.after(() => env.DB.sqlite.close());
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'false', ALLOW_DEBUG_TIME: 'true', BOT_TOKEN: BOT, SERVICE_SECRET: SECRET });
  const dbs = { permanent: env.DB, ...(realms ? { [SEASON]: env.DB_SEASON } : {}) }, alts = {};
  for (const [realm, db] of Object.entries(dbs)) {
    const scoped = realms ? scopeEnvForRealm(env, await resolveRealm(env, realm)) : env;
    for (const tgId of ['111', '222', '333'])
      await createCharacter(scoped, { tgId, name: '交易驗收' + tgId, gender: 'f', baseClass: 'sword' }, NOW);
    alts[realm] = (await createCharacter(scoped, { tgId: '111', name: '原帳號另一角色', gender: 'm', baseClass: 'mage' }, NOW)).char.tg_id;
    await selectAccountCharacter(scoped, '111', '111', NOW);
    db.sqlite.exec('UPDATE rpg_characters SET gold=100000,level=120');
    for (const id of ['111', '222', '333'])
      db.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,100) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=100').run(id, 'scroll_w');
    db.sqlite.exec('DELETE FROM rpg_ledger');
  }
  return { env, dbs, alts };
}
function snapshot(f) {
  return Object.fromEntries(Object.entries(f.dbs).map(([realm, db]) => {
    const schema = db.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      .map(({ name }) => [name, db.sqlite.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]);
    return [realm, { sha256: createHash('sha256').update(JSON.stringify({ schema, tables })).digest('hex'),
      changes: scalar(db, 'SELECT total_changes() AS n').n }];
  }));
}
function unchanged(f, before) { assert.deepEqual(snapshot(f), before, 'all realm tables/schema and total_changes remain unchanged'); }
function rowsUnchanged(f, before) {
  const after = snapshot(f);
  for (const realm of Object.keys(before)) assert.equal(after[realm].sha256, before[realm].sha256);
}
async function call(f, route, body, { mode = 'app', account = body.accountId, realm = body.realmId, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Debug-Now': String(NOW) };
  if (realm != null) headers['X-Realm-Id'] = realm;
  if (auth) {
    if (mode === 'app') headers['X-Telegram-Init-Data'] = initData(account);
    else headers['X-Service-Secret'] = SECRET;
  }
  const payload = mode === 'service' ? { ...body, tgId: account } : body;
  const response = await handle(new CurrentClientRequest('http://local/' + (mode === 'app' ? 'app/api/' : 'rpg/') + 'exchange/' + route,
    { method: 'POST', headers, body: JSON.stringify(payload) }), f.env);
  return { httpStatus: response.status, ...await response.json() };
}
function success(result) {
  assert.equal(result.httpStatus, 200, JSON.stringify(result)); assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 1); return result;
}
function committed(result, body) {
  success(result); assert.equal(result.found, true); assert.equal(result.status, 'committed');
  assert.equal(result.requestId, body.requestId.toLowerCase()); assert.equal(result.kind, body.kind);
  assert.equal(result.accountId, body.accountId); assert.equal(result.realmId, body.realmId);
  assert.equal(result.characterId, body.characterId); assert.equal(result.contextEpoch, body.contextEpoch);
  assert.deepEqual(result.receipt.scope, { accountId: body.accountId, realmId: body.realmId, characterId: body.characterId });
  assert.equal(result.signature, JSON.stringify({ kind: body.kind, payload: result.receipt.payload }));
  assert.equal(result.receipt.signature, result.signature); assert.equal(result.recoveryAllowed, false);
  return result;
}
function failure(result, error, status = 409) {
  assert.equal(result.httpStatus, status, JSON.stringify(result)); assert.equal(result.ok, false);
  assert.equal(result.error, error, JSON.stringify(result)); return result;
}
async function listing(f, account = '111', extra = {}) {
  const body = intent('create', account, { item: 'scroll_w', qty: 3, price: 101, ...extra });
  return { body, result: committed(await call(f, 'action-scoped', body), body) };
}
async function gear(db, id, { owner = '111', enhance = 7, bound = 0 } = {}) {
  const row = { ...makeGear({ id, tgId: owner, cls: 'sword', slot: 'helmet', tier: 4, forceRarity: 'epic', rng: () => .5, now: NOW }), enhance_level: enhance, bound };
  await insertEquipStmt(db, row).run(); return row;
}
function intercept(db, predicate, hook) {
  const prepare = db.prepare.bind(db);
  function wrapped(stmt) {
    const bind = stmt.bind.bind(stmt);
    stmt.bind = (...args) => wrapped(bind(...args));
    if (predicate(stmt.sql)) {
      const exec = stmt._exec.bind(stmt); stmt._exec = () => hook(stmt, exec);
    }
    return stmt;
  }
  db.prepare = sql => wrapped(prepare(sql));
  return () => { db.prepare = prepare; };
}
const recordSQL = sql => sql.startsWith('SELECT account_tg_id,request_id,char_id,action,payload_json,result_json,created_at FROM rpg_exchange_operations');

test('sellable uses its original candidate projection and kind:ref cursor, with pure reads in both realms', async t => {
  const f = await fixture(t, { realms: true });
  for (let n = 0; n < 33; n++) await gear(f.env.DB, 'candidate-' + String(n).padStart(2, '0'));
  await gear(f.env.DB, 'protected-candidate', { bound: 1 });
  f.env.DB.sqlite.exec("UPDATE rpg_characters SET idle_state='fighting',last_settle_at=" + (NOW - 3600000));
  const before = snapshot(f), seen = [];
  let cursor = null, first;
  do {
    const page = success(await call(f, 'sellable-scene', pin('111', { filters: { category: 'equipment' }, cursor })));
    first ||= page; assert.equal(page.tab, 'sellable'); assert.equal(page.role, null); assert.equal(page.pageSize, 30);
    assert.equal(page.meta.taxPct, .05); assert.equal(page.meta.maxPrice, 1000000);
    assert.ok(page.items.length <= 30);
    for (const item of page.items) {
      assert.equal(item.kind, 'equip'); assert.equal(item.ref, item.equipId); assert.equal(item.enhance, 7);
      assert.equal(Object.hasOwn(item, 'id'), false); assert.equal(Object.hasOwn(item, 'price'), false);
      assert.ok(item.equipment && item.art); seen.push(item.kind + ':' + item.ref);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 33); assert.equal(new Set(seen).size, 33);
  assert.deepEqual(success(await call(f, 'sellable-scene', pin('111', { filters: { category: 'equipment' } }), { mode: 'service' })).items, first.items);
  failure(await call(f, 'sellable-scene', pin('111', { filters: { category: 'scroll' }, cursor: first.nextCursor })), 'exchange_cursor', 400);
  failure(await call(f, 'sellable-scene', pin('111', { contextEpoch: 8, cursor: first.nextCursor })), 'exchange_cursor', 400);
  failure(await call(f, 'sellable-scene', pin('111', { realmId: SEASON, cursor: first.nextCursor })), 'exchange_cursor', 400);
  failure(await call(f, 'scene', { ...pin(), tab: 'browse', cursor: first.nextCursor }), 'exchange_cursor', 400);
  const seasonal = success(await call(f, 'sellable-scene', pin('111', { realmId: SEASON }), { mode: 'service' }));
  assert.ok(seasonal.items.every(item => item.kind === 'item')); unchanged(f, before);
});

test('all new routes pin authenticated account, realm, selected actor and caller epoch before any mutation', async t => {
  const f = await fixture(t), body = intent('create', '111', { item: 'scroll_w', qty: 2, price: 101 }), before = snapshot(f);
  for (const mode of ['app', 'service']) for (const route of ['sellable-scene', 'receipt', 'action-scoped']) {
    const input = route === 'sellable-scene' ? pin() : body;
    assert.equal((await call(f, route, input, { mode, auth: false })).httpStatus, 401);
    failure(await call(f, route, input, { mode, realm: null }), 'realm_required', 400);
    failure(await call(f, route, { ...input, realmId: undefined }, { mode, realm: 'permanent' }), 'realm_required', 400);
    failure(await call(f, route, { ...input, selectedCharacterId: '222' }, { mode }), 'character_changed');
    failure(await call(f, route, { ...input, accountId: '222' }, { mode, account: '111' }), 'account_changed');
    failure(await call(f, route, { ...input, contextEpoch: -1 }, { mode }), 'exchange_context', 400);
  }
  for (const bad of [{ ...body, requestId: 'scene:app:' + body.requestId }, { ...body, price: 1.5 }, { ...body, qty: 0 }, { ...body, item: undefined }, { ...body, namespace: 'app' }]) {
    const result = await call(f, 'action-scoped', bad);
    assert.ok(result.httpStatus >= 400); assert.equal(Object.hasOwn(result, 'definitiveRejection'), false);
  }
  unchanged(f, before);
});

test('raw UUID create, purchase and cancellation receipts recover without replaying or changing any database row', async t => {
  const f = await fixture(t), body = intent('create', '111', { item: 'scroll_w', qty: 3, price: 101 });
  body.requestId = body.requestId.toUpperCase();
  const created = committed(await call(f, 'action-scoped', body), body);
  assert.equal(inventory(f.env.DB, '111'), 97); assert.equal(created.result.fee, 6);
  assert.deepEqual(created.receipt.payload, { kind: 'item', ref: 'scroll_w', qty: 3, price: 101, characterId: '111' });
  const pay = intent('buy', '222', { listingId: created.result.listingId });
  const bought = committed(await call(f, 'action-scoped', pay, { mode: 'service' }), pay);
  assert.equal(wallet(f.env.DB, '222'), 99899); assert.equal(wallet(f.env.DB, '111'), 100095);
  assert.equal(inventory(f.env.DB, '222'), 103); assert.equal(bought.result.listing.status, 'sold');
  const next = await listing(f), undo = intent('cancel', '111', { listingId: next.result.result.listingId });
  const cancelled = committed(await call(f, 'action-scoped', undo), undo);
  assert.equal(cancelled.result.fee, 0); assert.equal(cancelled.result.netGold, 0); assert.equal(cancelled.result.returnedCharacterId, '111');
  const before = snapshot(f);
  for (const [original, expected] of [[body, created], [pay, bought], [undo, cancelled]]) {
    const readBody = { ...original, contextEpoch: 19, recovery: true };
    for (const mode of ['app', 'service']) {
      const read = committed(await call(f, 'receipt', readBody, { mode }), readBody);
      assert.deepEqual(read.result, expected.result); assert.deepEqual(read.receipt.payload, expected.receipt.payload);
    }
  }
  unchanged(f, before);
  assert.equal(created.result.listing.status, 'active', 'original receipt keeps the creation snapshot after sale');
  const replay = committed(await call(f, 'action-scoped', { ...pay, recovery: true }), pay);
  assert.equal(replay.replayed, true); unchanged(f, before);
  assert.equal(scalar(f.env.DB, 'SELECT COUNT(*) n FROM rpg_exchange_operations').n, 4);
  assert.equal(scalar(f.env.DB, 'SELECT request_id FROM rpg_exchange_operations WHERE action=?', 'buy').request_id, pay.requestId);
});

test('pre-existing original authority receipts use the same payload and require no additional ledger or schema', async t => {
  const f = await fixture(t), body = intent('create', '111', { item: 'scroll_w', qty: 5, price: 20 });
  const original = await Market.create(f.env, '111', body, NOW), before = snapshot(f);
  const read = committed(await call(f, 'receipt', body), body);
  assert.deepEqual(read.result, original.result); unchanged(f, before);
});

test('same UUID cannot change economic payload, action or actor, or read another authenticated account receipt', async t => {
  const f = await fixture(t), { body, result } = await listing(f), before = snapshot(f);
  for (const changed of [{ ...body, price: 102 }, { ...body, qty: 4 }, { ...body, item: 'scroll_a' },
    intent('cancel', '111', { requestId: body.requestId, listingId: result.result.listingId })])
    for (const route of ['receipt', 'action-scoped']) failure(await call(f, route, changed), 'request_reused');
  failure(await call(f, 'receipt', { ...body, accountId: '222' }, { account: '111' }), 'account_changed');
  const foreign = success(await call(f, 'receipt', { ...body, accountId: '222', selectedCharacterId: '222', characterId: '222' }, { account: '222' }));
  assert.equal(foreign.found, false); assert.equal(foreign.result, null); unchanged(f, before);
  await selectAccountCharacter(f.env, '111', f.alts.permanent, NOW);
  const switched = snapshot(f), otherActor = { ...body, selectedCharacterId: f.alts.permanent, characterId: f.alts.permanent };
  failure(await call(f, 'receipt', otherActor), 'request_reused'); unchanged(f, switched);
});

test('missing receipt remains pure pending; explicit same intent recovery commits once and frozen realms still permit original reads', async t => {
  const f = await fixture(t, { realms: true }), body = intent('create', '111', { realmId: SEASON, item: 'scroll_w', qty: 3, price: 101 });
  const before = snapshot(f), missing = success(await call(f, 'receipt', body));
  assert.equal(missing.found, false); assert.equal(missing.status, 'missing'); assert.equal(missing.result, null);
  assert.equal(missing.receipt, null); assert.equal(missing.recoveryAllowed, true); unchanged(f, before);
  const recovered = committed(await call(f, 'action-scoped', { ...body, recovery: true }), body);
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW + 1000, now: NOW + 1000 });
  const frozen = snapshot(f);
  assert.deepEqual(committed(await call(f, 'receipt', body), body).result, recovered.result);
  const absent = success(await call(f, 'receipt', { ...body, requestId: crypto.randomUUID() }));
  assert.equal(absent.status, 'missing'); assert.equal(absent.recoveryAllowed, false);
  success(await call(f, 'sellable-scene', pin('111', { realmId: SEASON })));
  const rejected = failure(await call(f, 'action-scoped', { ...body, recovery: true }), 'realm_read_only');
  assert.equal(Object.hasOwn(rejected, 'definitiveRejection'), false); unchanged(f, frozen);
});

test('same-ID parallel create, buy and cancel preserve one receipt and one economic effect', async t => {
  for (const kind of ['create', 'buy', 'cancel']) await t.test(kind, async t => {
    const f = await fixture(t);
    const setup = kind === 'create' ? null : await listing(f);
    const account = kind === 'buy' ? '222' : '111';
    const body = kind === 'create' ? intent(kind, account, { item: 'scroll_w', qty: 3, price: 101 })
      : intent(kind, account, { listingId: setup.result.result.listingId });
    const results = await Promise.all([call(f, 'action-scoped', body), call(f, 'action-scoped', { ...body, recovery: true }, { mode: 'service' })]);
    for (const result of results) committed(result, body);
    assert.deepEqual(results[0].result, results[1].result);
    assert.equal(scalar(f.env.DB, 'SELECT COUNT(*) n FROM rpg_exchange_operations WHERE request_id=?', body.requestId).n, 1);
    assert.equal(inventory(f.env.DB, '111'), kind === 'cancel' ? 100 : 97);
    assert.equal(inventory(f.env.DB, '222'), kind === 'buy' ? 103 : 100);
    assert.equal(wallet(f.env.DB, '111'), kind === 'buy' ? 100095 : 100000);
    assert.equal(wallet(f.env.DB, '222'), kind === 'buy' ? 99899 : 100000);
  });
});

test('new scoped two-buyer and buy/cancel races retain the original single winner and conservation', async t => {
  for (const race of ['buyers', 'cancel']) await t.test(race, async t => {
    const f = await fixture(t), created = await listing(f), id = created.result.result.listingId;
    const a = intent('buy', '222', { listingId: id }), b = race === 'buyers' ? intent('buy', '333', { listingId: id }) : intent('cancel', '111', { listingId: id });
    const results = await Promise.all([call(f, 'action-scoped', a), call(f, 'action-scoped', b)]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(scalar(f.env.DB, 'SELECT COUNT(*) n FROM rpg_exchange_operations').n, 2);
    assert.equal(inventory(f.env.DB, '111') + inventory(f.env.DB, '222') + inventory(f.env.DB, '333'), 300);
    const row = scalar(f.env.DB, 'SELECT status,buyer_char FROM rpg_exchange_listings WHERE id=?', id);
    assert.ok(['sold', 'cancelled'].includes(row.status));
    assert.equal(wallet(f.env.DB, '111') + wallet(f.env.DB, '222') + wallet(f.env.DB, '333'), row.status === 'sold' ? 299994 : 300000);
  });
});

test('same-account alternate cancellation returns assets to the original seller and self-buy remains forbidden', async t => {
  const f = await fixture(t), created = await listing(f), alt = f.alts.permanent;
  await selectAccountCharacter(f.env, '111', alt, NOW);
  const buy = intent('buy', '111', { selectedCharacterId: alt, characterId: alt, listingId: created.result.result.listingId });
  failure(await call(f, 'action-scoped', buy), 'self_trade');
  const cancel = { ...buy, kind: 'cancel', requestId: crypto.randomUUID() };
  const result = committed(await call(f, 'action-scoped', cancel), cancel);
  assert.equal(result.result.returnedCharacterId, '111'); assert.equal(inventory(f.env.DB, '111'), 100); assert.equal(inventory(f.env.DB, alt), 0);
});

test('equipment +N and guardian ability snapshots transfer unchanged, while protected assets stay rejected', async t => {
  const f = await fixture(t), equipment = await gear(f.env.DB, 'exact-enhanced-gear');
  const body = intent('create', '111', { equipId: equipment.id, qty: 1, price: 101 });
  const created = committed(await call(f, 'action-scoped', body), body);
  assert.equal(created.result.listing.enhance, 7); assert.ok(created.result.listing.equipment);
  const pay = intent('buy', '222', { listingId: created.result.listingId });
  committed(await call(f, 'action-scoped', pay), pay);
  const moved = scalar(f.env.DB, 'SELECT * FROM rpg_equipment WHERE id=?', equipment.id);
  assert.equal(moved.tg_id, '222'); assert.equal(moved.enhance_level, 7); assert.equal(moved.affixes_json, equipment.affixes_json);
  const protectedGear = await gear(f.env.DB, 'bound-gear', { bound: 1 });
  const protectedBody = intent('create', '111', { equipId: protectedGear.id, qty: 1, price: 10 });
  assert.equal((await call(f, 'action-scoped', protectedBody)).ok, false);
  assert.equal(scalar(f.env.DB, 'SELECT COUNT(*) n FROM rpg_exchange_operations WHERE request_id=?', protectedBody.requestId).n, 0);
  await Guardian.ensureWelcome(f.env, '111', NOW);
  const summoned = await Guardian.summon(f.env, '111', { pool: 'normal', count: 1, requestId: 'actions_sigil_' + crypto.randomUUID().replaceAll('-', '') }, NOW);
  const guardianId = summoned.operation.results[0].id;
  f.env.DB.sqlite.prepare("UPDATE rpg_guardian_sigils SET type='magic',quality=6 WHERE id=?").run(guardianId);
  const candidate = (await Market.sellable(f.env, '111', { filters: { category: 'guardian' } })).items.find(item => item.guardianId === guardianId);
  assert.ok(candidate.guardian.ability && candidate.guardian.damageBonus > 0);
  const offer = intent('create', '111', { guardianId, qty: 1, price: 101 });
  const listed = committed(await call(f, 'action-scoped', offer), offer);
  const purchase = intent('buy', '222', { listingId: listed.result.listingId });
  const bought = committed(await call(f, 'action-scoped', purchase), purchase);
  for (const key of ['ability', 'quality', 'damageBonus', 'lootBonus'])
    assert.equal(bought.result.listing.guardian[key], candidate.guardian[key]);
  const guardian = scalar(f.env.DB, 'SELECT char_id,type,quality,exchange_id FROM rpg_guardian_sigils WHERE id=?', guardianId);
  assert.deepEqual({ ...guardian }, { char_id: '222', type: 'magic', quality: 6, exchange_id: null });
  assert.deepEqual(f.env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('fresh definite business rejection is scope/signature bound; recovery and generic errors have no clearance marker', async t => {
  const f = await fixture(t), created = await listing(f);
  f.env.DB.sqlite.prepare('UPDATE rpg_characters SET gold=0 WHERE tg_id=?').run('222');
  const body = intent('buy', '222', { listingId: created.result.result.listingId }), before = snapshot(f);
  const rejected = failure(await call(f, 'action-scoped', body), 'gold', 400);
  assert.equal(rejected.definitiveRejection, true); assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.accountId, '222'); assert.equal(rejected.realmId, 'permanent'); assert.equal(rejected.characterId, '222');
  assert.equal(rejected.contextEpoch, body.contextEpoch); assert.equal(rejected.kind, 'buy'); assert.equal(rejected.requestId, body.requestId);
  assert.equal(rejected.signature, JSON.stringify({ kind: 'buy', payload: { listingId: body.listingId, characterId: '222' } }));
  assert.equal(rejected.found, false); assert.equal(rejected.result, null); assert.equal(rejected.receipt, null); assert.equal(rejected.recoveryAllowed, false);
  const recovery = failure(await call(f, 'action-scoped', { ...body, recovery: true }), 'gold', 400);
  assert.equal(Object.hasOwn(recovery, 'definitiveRejection'), false);
  const generic = failure(await call(f, 'action-scoped', { ...body, accountId: '333' }, { account: '222' }), 'account_changed');
  assert.equal(Object.hasOwn(generic, 'definitiveRejection'), false);
  const read = success(await call(f, 'receipt', body));
  assert.equal(read.status, 'missing'); assert.equal(Object.hasOwn(read, 'definitiveRejection'), false);
  unchanged(f, before);
});

test('receipt lookup failure after a business rejection never yields a definite rejection or clears an unknown outcome', async t => {
  const f = await fixture(t), created = await listing(f);
  f.env.DB.sqlite.prepare('UPDATE rpg_characters SET gold=0 WHERE tg_id=?').run('222');
  const body = intent('buy', '222', { listingId: created.result.result.listingId }), before = snapshot(f);
  let lookups = 0;
  const restore = intercept(f.env.DB, recordSQL, (_stmt, exec) => {
    if (++lookups === 2) throw new Error('synthetic receipt lookup outage');
    return exec();
  });
  const result = await call(f, 'action-scoped', body); restore();
  assert.equal(result.httpStatus, 500); assert.equal(result.error, 'internal');
  assert.equal(Object.hasOwn(result, 'definitiveRejection'), false); unchanged(f, before);
  const read = success(await call(f, 'receipt', { ...body, recovery: true }));
  assert.equal(read.status, 'missing'); unchanged(f, before);
});

test('a final receipt insertion failure rolls back the original escrow, revision, listing and ledger batch', async t => {
  const f = await fixture(t), body = intent('create', '111', { item: 'scroll_w', qty: 3, price: 101 });
  f.env.DB.sqlite.exec("CREATE TRIGGER actions_receipt_failure BEFORE INSERT ON rpg_exchange_operations BEGIN SELECT RAISE(ABORT,'synthetic_receipt_failure'); END");
  const before = snapshot(f), result = await call(f, 'action-scoped', body);
  assert.equal(result.httpStatus, 500); assert.equal(Object.hasOwn(result, 'definitiveRejection'), false);
  rowsUnchanged(f, before); assert.equal(inventory(f.env.DB, '111'), 100);
  assert.equal(scalar(f.env.DB, 'SELECT COUNT(*) n FROM rpg_exchange_listings').n, 0);
  const after = snapshot(f), read = success(await call(f, 'receipt', { ...body, recovery: true }));
  assert.equal(read.status, 'missing'); unchanged(f, after);
});

test('the original 20 active listings limit still applies inside the scoped transaction', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 20; n++) await Market.create(f.env, '111', { characterId: '111', requestId: crypto.randomUUID(), item: 'scroll_w', qty: 1, price: 1 }, NOW);
  const before = snapshot(f), body = intent('create', '111', { item: 'scroll_w', qty: 1, price: 1 });
  failure(await call(f, 'action-scoped', body), 'conflict');
  rowsUnchanged(f, before); assert.equal(inventory(f.env.DB, '111'), 80);
  assert.equal(scalar(f.env.DB, "SELECT COUNT(*) n FROM rpg_exchange_listings WHERE status='active'").n, 20);
});

test('captured actor revision rejects A-B-A selection changes before the original write batch', async t => {
  const f = await fixture(t), created = await listing(f, '222'), body = intent('buy', '111', { listingId: created.result.result.listingId });
  const batch = f.env.DB.batch.bind(f.env.DB); let injected = false;
  f.env.DB.batch = async statements => {
    if (!injected && statements.some(statement => statement.sql.includes("SET status='sold'"))) {
      injected = true;
      await selectAccountCharacter(f.env, '111', f.alts.permanent, NOW);
      await selectAccountCharacter(f.env, '111', '111', NOW);
    }
    return batch(statements);
  };
  const rejected = await call(f, 'action-scoped', body); f.env.DB.batch = batch;
  assert.equal(injected, true); assert.equal(rejected.httpStatus, 409);
  assert.equal(Object.hasOwn(rejected, 'definitiveRejection'), false);
  assert.equal(wallet(f.env.DB, '111'), 100000); assert.equal(wallet(f.env.DB, '222'), 100000);
  assert.equal(scalar(f.env.DB, 'SELECT status FROM rpg_exchange_listings WHERE id=?', body.listingId).status, 'active');
  assert.equal(scalar(f.env.DB, 'SELECT COUNT(*) n FROM rpg_exchange_operations WHERE request_id=?', body.requestId).n, 0);
});

test('realm fence change before commit rejects the scoped action while frozen receipt lookup remains pure', async t => {
  const f = await fixture(t, { realms: true }), created = await listing(f, '222', { realmId: SEASON });
  const body = intent('buy', '111', { realmId: SEASON, listingId: created.result.result.listingId });
  const db = f.dbs[SEASON], batch = db.batch.bind(db); let injected = false;
  db.batch = async statements => {
    if (!injected && statements.some(statement => statement.sql.includes("SET status='sold'"))) {
      injected = true;
      await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW + 1000, now: NOW + 1000 });
    }
    return batch(statements);
  };
  const result = await call(f, 'action-scoped', body); db.batch = batch;
  failure(result, 'realm_fence_changed'); assert.equal(Object.hasOwn(result, 'definitiveRejection'), false);
  assert.equal(wallet(db, '111'), 100000); assert.equal(wallet(db, '222'), 100000);
  assert.equal(scalar(db, 'SELECT status FROM rpg_exchange_listings WHERE id=?', body.listingId).status, 'active');
  const before = snapshot(f), read = success(await call(f, 'receipt', { ...body, recovery: true }));
  assert.equal(read.status, 'missing'); assert.equal(read.recoveryAllowed, false); unchanged(f, before);
});

test('a character change during final receipt SELECT cannot return a stale success envelope after commit or caught response failure', async t => {
  for (const responseFailure of [false, true]) await t.test(responseFailure ? 'caught-response' : 'success-tail', async t => {
    const f = await fixture(t), body = intent('create', '111', { item: 'scroll_w', qty: 3, price: 101 });
    let committedBatch = false, dropped = false, lookups = 0, injected = false;
    const batch = f.env.DB.batch.bind(f.env.DB);
    f.env.DB.batch = async statements => {
      const result = await batch(statements);
      if (statements.some(statement => statement.sql.startsWith('INSERT INTO rpg_exchange_operations'))) committedBatch = true;
      return result;
    };
    const restore = intercept(f.env.DB, sql => recordSQL(sql) || sql.startsWith('SELECT c.*,a.active_char_id'), (statement, exec) => {
      if (responseFailure && committedBatch && !dropped && statement.sql.startsWith('SELECT c.*,a.active_char_id')) {
        dropped = true; throw new Error('synthetic response actor read failed after commit');
      }
      const result = exec();
      if (recordSQL(statement.sql) && ++lookups === 2) {
        injected = true;
        f.env.DB.sqlite.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=?').run('111');
      }
      return result;
    });
    const result = await call(f, 'action-scoped', body); restore(); f.env.DB.batch = batch;
    assert.equal(injected, true); if (responseFailure) assert.equal(dropped, true);
    failure(result, 'character_changed'); assert.equal(Object.hasOwn(result, 'definitiveRejection'), false);
    assert.equal(scalar(f.env.DB, 'SELECT COUNT(*) n FROM rpg_exchange_operations WHERE request_id=?', body.requestId).n, 1);
    assert.equal(inventory(f.env.DB, '111'), 97);
    const before = snapshot(f), read = committed(await call(f, 'receipt', { ...body, recovery: true }), body);
    assert.equal(read.result.qty, 3); unchanged(f, before);
  });
});

test('damaged original result rows cannot be reported committed or replayed through the scoped adapter', async t => {
  const f = await fixture(t), { body } = await listing(f);
  f.env.DB.sqlite.prepare('UPDATE rpg_exchange_operations SET result_json=? WHERE request_id=?').run('{"action":"create","qty":999}', body.requestId);
  const before = snapshot(f);
  for (const route of ['receipt', 'action-scoped']) {
    const result = failure(await call(f, route, body), 'exchange_receipt_corrupt');
    assert.equal(Object.hasOwn(result, 'definitiveRejection'), false);
  }
  unchanged(f, before);
});
