import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW, gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';
import { TOWER_OFFERS } from '../src/game/tower-progression.js';

const OWNER = '19151', OTHER = '19152', SEASON = 'season_2026_01', SECRET = 'local-tower-scene-fixture';
const ENDPOINTS = ['tower/scene', 'tower/receipt'];
const original = { op: 'redeem', offerId: TOWER_OFFERS[0].id, requestId: 'tower-api-original' };
const writes = env => [env.DB, env.DB_SEASON].map(db => db.sqlite.prepare('SELECT total_changes() AS n').get().n);
const snapshots = env => [env.DB, env.DB_SEASON].map(gameplaySnapshot);

async function fixture(t) {
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', SERVICE_SECRET: SECRET });
  async function call(surface, action, body = {}, options = {}) {
    const realm = options.realm === undefined ? 'permanent' : options.realm;
    const headers = {
      'content-type': 'application/json', 'X-Debug-Now': String(options.now ?? NOW + 86400000),
      ...(surface === 'app' ? (options.auth === false ? {} : { 'X-Dev-Tg-Id': options.account || OWNER }) : { 'X-Service-Secret': options.secret ?? SECRET }),
      ...(realm ? { 'X-Realm-Id': realm } : {}),
    };
    const C = surface === 'app' ? CurrentClientRequest : Request;
    const response = await handle(new C('https://local/' + (surface === 'app' ? 'app/api/' : 'rpg/') + action, { method: 'POST', headers, body: JSON.stringify(body) }), env);
    return { status: response.status, ...await response.json() };
  }
  async function create(account, realm, name, baseClass, slot = 1) {
    const result = await call('app', 'create', { name, baseClass, gender: 'f', charSlot: slot, requestId: 'tower-char-' + account + '-' + slot }, { account, realm, now: NOW });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.characters.find(character => character.name === name);
  }
  const first = await create(OWNER, 'permanent', '登塔角色甲', 'sword');
  const season = await create(OWNER, SEASON, '賽季塔隊員', 'mage');
  const foreign = await create(OTHER, 'permanent', '另一塔隊員', 'archer');
  for (const [db, character, name] of [[env.DB, first, '永久塔'], [env.DB_SEASON, season, '賽季塔']]) {
    db.sqlite.prepare('UPDATE rpg_characters SET level=120,last_settle_at=?,special_json=? WHERE tg_id=?')
      .run(NOW, JSON.stringify({ towerBest: 20 }), character.charId);
    db.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'tower_fragment',100) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity")
      .run(character.charId);
    const state = { name, level: 30, map: 2, floor: 1, startFloor: 1, towerVersion: 2, clearedFloor: 0, round: 1, actors: [], actions: {}, log: [], rewarded: [] };
    db.sqlite.prepare("INSERT INTO rpg_parties(id,leader_id,kind,status,state_json,created_at,updated_at,expires_at) VALUES(?,?,'tower','lobby',?,?,?,?)")
      .run('same-tower-id', character.charId, JSON.stringify(state), NOW, NOW, NOW + 200000000);
    db.sqlite.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').run('same-tower-id', character.charId, OWNER, NOW);
    db.sqlite.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').run(OWNER, 'same-tower-id', character.charId);
  }
  return { env, call, create, first, season, foreign };
}

test('App tower scene isolates authenticated account, selected character and realm without settlement, rewards or behavior writes', async t => {
  const f = await fixture(t), before = writes(f.env), data = snapshots(f.env);
  for (const [realm, character, name] of [['permanent', f.first, '永久塔'], [SEASON, f.season, '賽季塔']]) {
    const result = await f.call('app', 'tower/scene', { selectedCharacterId: character.charId, tgId: OTHER, accountId: OTHER, partyId: 'same-tower-id', kind: 'dungeon' }, { realm });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.accountId, OWNER); assert.equal(result.realmId, realm);
    assert.equal(result.characterId, character.charId); assert.equal(result.character.tgId, character.charId);
    assert.equal(result.party.name, name); assert.equal(result.active.name, name);
    assert.equal(result.party.kind, 'tower'); assert.equal(result.party.me.id, character.charId);
    assert.equal(result.tower.badges, 100); assert.equal(result.tower.canOperate, true); assert.equal(result.readOnly, false);
    assert.ok(!('dungeons' in result)); assert.ok(!('scene' in result));
    const unknown = await f.call('app', 'tower/receipt', { ...original, tgId: OTHER, accountId: OTHER, selectedCharacterId: character.charId }, { realm });
    assert.equal(unknown.status, 200, JSON.stringify(unknown)); assert.equal(unknown.found, false);
    assert.equal(unknown.accountId, OWNER); assert.equal(unknown.characterId, character.charId); assert.equal(unknown.realmId, realm);
  }
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});

test('both App tower reads reject missing auth, mismatched realms and stale or foreign selections without writes', async t => {
  const f = await fixture(t), before = writes(f.env);
  for (const action of ENDPOINTS) for (const [body, options, status, error] of [
    [{}, { auth: false }, 401, 'auth'],
    [{}, { realm: null }, 400, 'realm_required'],
    [{ realmId: SEASON }, {}, 409, 'realm_mismatch'],
    [{}, { realm: 'unknown_realm' }, 404, 'realm_unknown'],
    [{ selectedCharacterId: f.foreign.charId }, {}, 409, 'character_changed'],
    [{ selectedCharacterId: f.first.charId }, { account: OTHER }, 409, 'character_changed'],
  ]) {
    const result = await f.call('app', action, { ...original, ...body }, options);
    assert.equal(result.status, status, JSON.stringify(result));
    if (error !== 'auth') assert.equal(result.error, error);
  }
  assert.deepEqual(writes(f.env), before);
});

test('both tower reads resolve the current owned account character on Service and reject stale windows after switching', async t => {
  const f = await fixture(t), second = await f.create(OWNER, 'permanent', '登塔角色乙', 'thief', 2);
  assert.equal((await f.call('app', 'select', { charId: second.charId }, { now: NOW })).status, 200);
  const before = writes(f.env), data = snapshots(f.env);
  for (const action of ENDPOINTS) {
    const body = { ...original, tgId: OWNER, selectedCharacterId: second.charId, partyId: 'same-tower-id' };
    for (const surface of ['app', 'service']) {
      const result = await f.call(surface, action, body);
      assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.characterId, second.charId); assert.equal(result.accountId, OWNER);
      const stale = await f.call(surface, action, { ...body, selectedCharacterId: f.first.charId });
      assert.equal(stale.status, 409, JSON.stringify(stale)); assert.equal(stale.error, 'character_changed');
      if (action === 'tower/scene') {
        assert.equal(result.party.me, null); assert.equal(result.active, null); assert.equal(result.canCreate, false); assert.equal(result.blockedReason.code, 'party');
      } else assert.equal(result.found, false);
    }
    for (const [payload, options, status, error] of [
      [body, { realm: null }, 400, 'realm_required'],
      [{ ...body, realmId: SEASON }, {}, 409, 'realm_mismatch'],
      [body, { realm: 'unknown_realm' }, 404, 'realm_unknown'],
      [{ ...body, tgId: second.charId }, {}, 404, 'no_character'],
      [{ ...body, tgId: OTHER }, {}, 409, 'character_changed'],
    ]) {
      const denied = await f.call('service', action, payload, options);
      assert.equal(denied.status, status, JSON.stringify(denied)); assert.equal(denied.error, error);
    }
    assert.equal((await f.call('service', action, body, { secret: 'wrong-local-secret' })).status, 401);
  }
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});

test('frozen tower reads keep due rows and pending settlement unchanged while native mutations remain fenced', async t => {
  const f = await fixture(t);
  f.env.DB_SEASON.sqlite.prepare('UPDATE rpg_parties SET expires_at=? WHERE id=?').run(NOW, 'same-tower-id');
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
  const before = writes(f.env), data = snapshots(f.env), body = { ...original, tgId: OWNER, selectedCharacterId: f.season.charId, partyId: 'same-tower-id' };
  for (const surface of ['app', 'service']) {
    const result = await f.call(surface, 'tower/scene', body, { realm: SEASON });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.readOnly, true); assert.ok(result.readOnlyReason);
    assert.equal(result.canCreate, false); assert.equal(result.tower.canOperate, false);
    assert.equal(result.party.status, 'lobby'); assert.equal(result.party.expired, true); assert.equal(result.party.pendingSettlement, true);
    assert.ok(result.tower.areas.every(area => !area.canCreate));
    const lookup = await f.call(surface, 'tower/receipt', body, { realm: SEASON });
    assert.equal(lookup.status, 200, JSON.stringify(lookup)); assert.equal(lookup.found, false);
    const write = await f.call(surface, 'tower/action', body, { realm: SEASON });
    assert.equal(write.status, 409, JSON.stringify(write)); assert.equal(write.error, 'realm_read_only');
  }
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});

test('App receipt matches only the raw original request in its own namespace; explicit same-ID recovery charges once', async t => {
  const f = await fixture(t), body = { ...original, selectedCharacterId: f.first.charId };
  const beforeMissing = writes(f.env);
  assert.equal((await f.call('app', 'tower/receipt', body)).found, false);
  assert.deepEqual(writes(f.env), beforeMissing);
  // Explicit recovery uses the original operation and ID, even if a late first request also arrives.
  const results = await Promise.all([f.call('app', 'tower/action', body, { now: NOW }), f.call('app', 'tower/action', body, { now: NOW })]);
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(results[0].result, results[1].result);
  const row = f.env.DB.sqlite.prepare("SELECT COUNT(*) AS n,SUM(item_delta) AS delta FROM rpg_ledger WHERE event_id=? AND tg_id=?")
    .get('tower-action:' + f.first.charId + ':app:' + original.requestId, f.first.charId);
  assert.equal(row.n, 1); assert.equal(row.delta, -TOWER_OFFERS[0].cost);
  const before = writes(f.env), data = snapshots(f.env);
  const lookup = await f.call('app', 'tower/receipt', { ...body, namespace: 'service', tgId: OTHER });
  assert.equal(lookup.status, 200, JSON.stringify(lookup)); assert.equal(lookup.found, true);
  assert.equal(lookup.requestId, original.requestId); assert.equal(lookup.characterId, f.first.charId);
  assert.deepEqual(lookup.result, results[0].result);
  assert.equal(lookup.receipt.type, '星穹徽記工坊'); assert.equal(lookup.receipt.item, 'tower_fragment'); assert.equal(lookup.receipt.itemDelta, -lookup.result.cost);
  const service = await f.call('service', 'tower/receipt', { ...body, tgId: OWNER, namespace: 'app' });
  assert.equal(service.status, 200, JSON.stringify(service)); assert.equal(service.found, false);
  const otherRealm = await f.call('app', 'tower/receipt', { ...original, selectedCharacterId: f.season.charId }, { realm: SEASON });
  assert.equal(otherRealm.status, 200, JSON.stringify(otherRealm)); assert.equal(otherRealm.found, false);
  const reused = await f.call('app', 'tower/receipt', { ...body, offerId: TOWER_OFFERS[1].id });
  assert.equal(reused.status, 409, JSON.stringify(reused)); assert.equal(reused.error, 'request_reused');
  const invalid = await f.call('app', 'tower/receipt', { ...body, requestId: 'app:' + original.requestId });
  assert.equal(invalid.status, 400, JSON.stringify(invalid)); assert.equal(invalid.error, 'tower_receipt_input');
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
  const retryChanged = await f.call('app', 'tower/action', { ...body, offerId: TOWER_OFFERS[1].id }, { now: NOW });
  assert.equal(retryChanged.status, 409, JSON.stringify(retryChanged)); assert.equal(retryChanged.error, 'request_reused');
  assert.equal(f.env.DB.sqlite.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='tower_fragment'").get(f.first.charId).quantity, 100 - TOWER_OFFERS[0].cost);
});

test('corrupt historical receipt results remain explicit errors without writes on both HTTP surfaces', async t => {
  const f = await fixture(t), signature = JSON.stringify({ op: original.op, offerId: original.offerId, itemId: null, from: null, titleId: null });
  for (const prefix of ['', 'app:']) {
    f.env.DB.sqlite.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('tower-action:' + f.first.charId + ':' + prefix + original.requestId, f.first.charId, '星穹徽記工坊', 'tower_fragment', 0, JSON.stringify({ signature, result: {} }), NOW);
  }
  const before = writes(f.env), data = snapshots(f.env);
  for (const surface of ['app', 'service']) {
    const result = await f.call(surface, 'tower/receipt', { ...original, tgId: OWNER, selectedCharacterId: f.first.charId });
    assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(result.error, 'tower_receipt_corrupt');
  }
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});

test('a legacy identifier fallback cannot expose tower or workshop receipts for a character owned by another account', async t => {
  const f = await fixture(t);
  assert.equal(f.first.charId, OWNER);
  f.env.DB.sqlite.prepare('UPDATE rpg_characters SET account_tg_id=?,char_slot=3 WHERE tg_id=?').run(OTHER, f.first.charId);
  const before = writes(f.env), data = snapshots(f.env);
  for (const surface of ['app', 'service']) for (const action of ENDPOINTS) {
    const result = await f.call(surface, action, { ...original, tgId: OWNER, partyId: 'same-tower-id' });
    assert.equal(result.status, 404, JSON.stringify(result)); assert.equal(result.error, 'no_character');
  }
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});
