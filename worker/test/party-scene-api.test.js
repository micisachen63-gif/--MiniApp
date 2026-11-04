import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW, gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';

const OWNER = '18951', OTHER = '18952', SEASON = 'season_2026_01', SECRET = 'local-party-scene-fixture';
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
    const result = await call('app', 'create', { name, baseClass, gender: 'f', charSlot: slot, requestId: 'party-char-' + account + '-' + slot }, { account, realm, now: NOW });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.characters.find(character => character.name === name);
  }
  const first = await create(OWNER, 'permanent', '隊伍角色甲', 'sword');
  const season = await create(OWNER, SEASON, '賽季隊員', 'mage');
  const foreign = await create(OTHER, 'permanent', '其他隊員', 'archer');
  for (const [db, character, name] of [[env.DB, first, '永久場'], [env.DB_SEASON, season, '賽季場']]) {
    const state = { name, dungeonId: 'pillar', level: 30, map: 2, floor: 1, round: 1, actors: [], actions: {}, log: [], rewarded: [] };
    db.sqlite.prepare("INSERT INTO rpg_parties(id,leader_id,kind,status,state_json,created_at,updated_at,expires_at) VALUES(?,?,'dungeon','lobby',?,?,?,?)")
      .run('same-party-id', character.charId, JSON.stringify(state), NOW, NOW, NOW + 200000000);
    db.sqlite.prepare('INSERT INTO rpg_party_members(party_id,char_id,account_id,joined_at) VALUES(?,?,?,?)').run('same-party-id', character.charId, OWNER, NOW);
    db.sqlite.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').run(OWNER, 'same-party-id', character.charId);
  }
  return { env, call, create, first, season, foreign };
}

test('App party scene uses authenticated account, selected character and realm without settlement, rewards or behavior writes', async t => {
  const f = await fixture(t), before = writes(f.env), data = snapshots(f.env);
  for (const [realm, character, name] of [['permanent', f.first, '永久場'], [SEASON, f.season, '賽季場']]) {
    const result = await f.call('app', 'party/scene', { selectedCharacterId: character.charId, tgId: OTHER, accountId: OTHER, partyId: 'same-party-id' }, { realm });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.accountId, OWNER); assert.equal(result.realmId, realm);
    assert.equal(result.characterId, character.charId); assert.equal(result.character.tgId, character.charId);
    assert.equal(result.party.name, name); assert.equal(result.active.name, name);
    assert.equal(result.party.me.id, character.charId); assert.equal(result.readOnly, false);
    assert.ok(Array.isArray(result.skills)); assert.ok(!('scene' in result));
  }
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});

test('App party scene rejects missing auth, mismatched or unknown realms and stale or foreign selections without writes', async t => {
  const f = await fixture(t), before = writes(f.env);
  for (const [body, options, status, error] of [
    [{}, { auth: false }, 401, 'auth'],
    [{}, { realm: null }, 400, 'realm_required'],
    [{ realmId: SEASON }, {}, 409, 'realm_mismatch'],
    [{}, { realm: 'unknown_realm' }, 404, 'realm_unknown'],
    [{ selectedCharacterId: f.foreign.charId }, {}, 409, 'character_changed'],
    [{ selectedCharacterId: f.first.charId }, { account: OTHER }, 409, 'character_changed'],
  ]) {
    const result = await f.call('app', 'party/scene', body, options);
    assert.equal(result.status, status, JSON.stringify(result));
    if (error !== 'auth') assert.equal(result.error, error);
  }
  assert.deepEqual(writes(f.env), before);
});

test('character switching invalidates old party windows and does not let a forged body keep ownership of the previous character', async t => {
  const f = await fixture(t), second = await f.create(OWNER, 'permanent', '隊伍角色乙', 'thief', 2);
  const selected = await f.call('app', 'select', { charId: second.charId }, { now: NOW });
  assert.equal(selected.status, 200, JSON.stringify(selected));
  const before = writes(f.env), stale = await f.call('app', 'party/scene', { selectedCharacterId: f.first.charId });
  assert.equal(stale.status, 409); assert.equal(stale.error, 'character_changed');
  const current = await f.call('app', 'party/scene', { selectedCharacterId: second.charId, tgId: f.first.charId, partyId: 'same-party-id' });
  assert.equal(current.status, 200, JSON.stringify(current)); assert.equal(current.characterId, second.charId);
  assert.equal(current.party.me, null); assert.equal(current.active, null);
  assert.equal(current.canCreate, false); assert.equal(current.blockedReason.code, 'party');
  assert.deepEqual(writes(f.env), before);
});

test('frozen realms retain due parties and pure reads while existing mutation routes remain fenced', async t => {
  const f = await fixture(t);
  f.env.DB_SEASON.sqlite.prepare('UPDATE rpg_parties SET expires_at=? WHERE id=?').run(NOW, 'same-party-id');
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
  const before = writes(f.env), data = snapshots(f.env);
  for (const surface of ['app', 'service']) {
    const result = await f.call(surface, 'party/scene', { tgId: OWNER, selectedCharacterId: f.season.charId, partyId: 'same-party-id' }, { realm: SEASON });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.readOnly, true); assert.equal(result.canCreate, false);
    assert.equal(result.party.status, 'lobby'); assert.equal(result.party.expired, true); assert.equal(result.party.pendingSettlement, true);
    assert.ok(result.readOnlyReason);
  }
  const mutation = await f.call('app', 'party/create', { kind: 'dungeon', dungeonId: 'pillar', requestId: 'frozen-party-create', selectedCharacterId: f.season.charId }, { realm: SEASON });
  assert.equal(mutation.status, 409, JSON.stringify(mutation)); assert.equal(mutation.error, 'realm_read_only');
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});

test('Service party scene requires authentication and explicit realm and resolves an owned active account character', async t => {
  const f = await fixture(t), second = await f.create(OWNER, 'permanent', '服務隊員乙', 'mage', 2);
  await f.call('app', 'select', { charId: second.charId }, { now: NOW });
  const before = writes(f.env), body = { tgId: OWNER, selectedCharacterId: second.charId, partyId: 'same-party-id' };
  const result = await f.call('service', 'party/scene', body);
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.characterId, second.charId);
  assert.equal(result.accountId, OWNER); assert.equal(result.party.me, null);
  for (const [payload, options, status, error] of [
    [body, { realm: null }, 400, 'realm_required'],
    [{ ...body, realmId: SEASON }, {}, 409, 'realm_mismatch'],
    [{ ...body, selectedCharacterId: f.first.charId }, {}, 409, 'character_changed'],
    [{ ...body, tgId: second.charId }, {}, 404, 'no_character'],
    [{ ...body, tgId: OTHER }, {}, 409, 'character_changed'],
  ]) {
    const denied = await f.call('service', 'party/scene', payload, options);
    assert.equal(denied.status, status, JSON.stringify(denied)); assert.equal(denied.error, error);
  }
  const denied = await f.call('service', 'party/scene', body, { secret: 'invalid-fixture-secret' });
  assert.equal(denied.status, 401);
  assert.deepEqual(writes(f.env), before);
});

test('a legacy identifier fallback cannot expose a character whose recorded owner is another account', async t => {
  const f = await fixture(t);
  assert.equal(f.first.charId, OWNER);
  f.env.DB.sqlite.prepare('UPDATE rpg_characters SET account_tg_id=?,char_slot=3 WHERE tg_id=?').run(OTHER, f.first.charId);
  const before = writes(f.env), data = snapshots(f.env);
  for (const surface of ['app', 'service']) {
    const result = await f.call(surface, 'party/scene', { tgId: OWNER, partyId: 'same-party-id' });
    assert.equal(result.status, 404, JSON.stringify(result)); assert.equal(result.error, 'no_character');
  }
  assert.deepEqual(writes(f.env), before); assert.deepEqual(snapshots(f.env), data);
});
