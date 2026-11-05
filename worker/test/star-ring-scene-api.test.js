import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW, gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';
import * as Ring from '../src/services/star-ring.js';

const OWNER = '19601', OTHER = '19602', SEASON = 'season_2026_01', SECRET = 'local-star-ring-scene-fixture';
const READS = ['star-ring/scene', 'star-ring/receipt'];
const WRITES = ['star-ring/create-scoped', 'star-ring/action-scoped', 'star-ring/shop-scoped', 'star-ring/cosmetics/equip-scoped'];
const ACTIONS = [...READS, ...WRITES];
const writes = env => [env.DB, env.DB_SEASON].map(db => db.sqlite.prepare('SELECT total_changes() AS n').get().n);
const snapshots = env => [env.DB, env.DB_SEASON].map(gameplaySnapshot);

async function fixture(t) {
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', SERVICE_SECRET: SECRET });
  async function call(surface, action, body = {}, options = {}) {
    const realm = options.realm === undefined ? 'permanent' : options.realm;
    const headers = { 'content-type': 'application/json', 'X-Debug-Now': String(options.now ?? NOW),
      ...(surface === 'app' ? options.auth === false ? {} : { 'X-Dev-Tg-Id': options.account || OWNER } : { 'X-Service-Secret': options.secret ?? SECRET }),
      ...(realm ? { 'X-Realm-Id': realm } : {}) };
    const C = surface === 'app' ? CurrentClientRequest : Request;
    const response = await handle(new C('https://local/' + (surface === 'app' ? 'app/api/' : 'rpg/') + action,
      { method: 'POST', headers, body: JSON.stringify(body) }), env);
    return { status: response.status, ...await response.json() };
  }
  async function create(account, realm, name, slot = 1) {
    const result = await call('app', 'create', { name, gender: 'f', baseClass: 'sword', charSlot: slot, requestId: 'ring-create-' + account + '-' + slot }, { account, realm });
    assert.equal(result.status, 200, JSON.stringify(result)); return result.characters.find(character => character.name === name);
  }
  const first = await create(OWNER, 'permanent', '星環API甲'), season = await create(OWNER, SEASON, '星環API季'), foreign = await create(OTHER, 'permanent', '星環API乙');
  const partyIds = {};
  for (const [realm, db, character, amount] of [['permanent', env.DB, first, 500], [SEASON, env.DB_SEASON, season, 120]]) {
    db.sqlite.prepare("UPDATE rpg_characters SET level=80,class_path='A1',last_settle_at=? WHERE tg_id=?").run(NOW, character.charId);
    db.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'star_ring_token',?)").run(character.charId, amount);
    partyIds[realm] = (await Ring.create({ DB: db }, character.charId, { tier: 80 }, NOW)).party.id;
  }
  const scope = (realm = 'permanent') => ({ realmId: realm, selectedCharacterId: realm === SEASON ? season.charId : first.charId, tgId: OWNER });
  return { env, call, create, first, season, foreign, partyIds, scope };
}
const fields = (f, realm = 'permanent') => ({ partyId: f.partyIds[realm], action: 'ready', ready: true,
  tier: 80, difficulty: 'normal', tactic: 'balanced', kind: 'action', offerId: 'reroll', cosmeticId: null, requestId: 'api-star-ring-001' });

test('App and Service scene/receipt resolve captured realm and authenticated current actor without behavior or gameplay writes', async t => {
  const f = await fixture(t), before = snapshots(f.env), n = writes(f.env);
  for (const [realm, balance] of [['permanent', 500], [SEASON, 120]]) for (const surface of ['app', 'service']) {
    const forged = surface === 'app' ? { tgId: OTHER, accountId: OTHER } : { accountId: OTHER };
    const body = { ...f.scope(realm), ...forged }, scene = await f.call(surface, 'star-ring/scene', body, { realm, now: NOW + 1800001 });
    assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.realmId, realm);
    assert.equal(scene.accountId, OWNER); assert.equal(scene.characterId, body.selectedCharacterId);
    assert.equal(scene.shop.balances.star_ring_token, balance); assert.equal(scene.active.id, f.partyIds[realm]);
    assert.equal(scene.active.status, 'lobby'); assert.equal(scene.active.settlementPending, true);
    assert.equal('scene' in scene, false);
    const receipt = await f.call(surface, 'star-ring/receipt', { ...body, ...fields(f, realm) }, { realm });
    assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.found, false); assert.equal(receipt.recoveryAllowed, true);
    assert.equal(receipt.result, null); assert.equal(receipt.receipt, null);
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('All six routes require authorization, matching realm header/body and explicit selected character before any write', async t => {
  const f = await fixture(t), before = snapshots(f.env), n = writes(f.env);
  for (const action of ACTIONS) {
    const payload = { ...f.scope(), ...fields(f) };
    for (const surface of ['app', 'service']) for (const [change, options, status, error] of [
      [{}, { realm: null }, 400, 'realm_required'], [{ realmId: undefined }, {}, 400, 'realm_required'],
      [{ realmId: SEASON }, {}, 409, 'realm_mismatch'], [{ realmId: 'unknown-realm' }, { realm: 'unknown-realm' }, 404, 'realm_unknown'],
      [{ selectedCharacterId: undefined }, {}, 400, 'selected_character_required'],
      [{ selectedCharacterId: f.foreign.charId }, {}, 409, 'character_changed'],
    ]) {
      const result = await f.call(surface, action, { ...payload, ...change }, options);
      assert.equal(result.status, status, JSON.stringify(result)); assert.equal(result.error, error);
    }
    assert.equal((await f.call('app', action, payload, { auth: false })).status, 401);
    assert.equal((await f.call('service', action, payload, { secret: 'wrong-fixture-secret' })).status, 401);
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('Selected old-character report is read-only while identity stays on the current actor', async t => {
  const f = await fixture(t), second = await f.create(OWNER, 'permanent', '星環API丙', 2);
  assert.equal((await f.call('app', 'select', { charId: second.charId })).status, 200);
  const before = snapshots(f.env), n = writes(f.env);
  for (const surface of ['app', 'service']) {
    const payload = { ...f.scope(), selectedCharacterId: second.charId, partyId: f.partyIds.permanent, recipientCharId: f.first.charId };
    const scene = await f.call(surface, 'star-ring/scene', payload);
    assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.accountId, OWNER); assert.equal(scene.characterId, second.charId);
    assert.equal(scene.party.me.id, f.first.charId); assert.equal(scene.party.readonly, true);
    const stale = await f.call(surface, 'star-ring/scene', { ...payload, selectedCharacterId: f.first.charId });
    assert.equal(stale.status, 409); assert.equal(stale.error, 'character_changed');
    const foreign = await f.call(surface, 'star-ring/scene', { ...payload, recipientCharId: f.foreign.charId });
    assert.equal(foreign.status, 403); assert.equal(foreign.error, 'character_not_owned');
    const mutation = await f.call(surface, 'star-ring/action-scoped', { ...payload, action: 'ready', ready: true, requestId: 'report-cannot-act-001' });
    assert.equal(mutation.status, 409); assert.equal(mutation.error, 'read_only_report');
    if (surface === 'service') {
      const opaqueAccount = await f.call(surface, 'star-ring/scene', { ...payload, tgId: second.charId });
      assert.equal(opaqueAccount.status, 404); assert.equal(opaqueAccount.error, 'no_character');
    }
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('Frozen realm scene/receipt remain pure across due deadlines and all four mutations are fenced', async t => {
  const f = await fixture(t);
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
  const before = snapshots(f.env), n = writes(f.env), payload = { ...f.scope(SEASON), ...fields(f, SEASON) };
  for (const surface of ['app', 'service']) {
    const scene = await f.call(surface, 'star-ring/scene', payload, { realm: SEASON, now: NOW + 1800001 });
    assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.readOnly, true);
    assert.equal(scene.party.status, 'lobby'); assert.equal(scene.party.settlementPending, true);
    assert.equal(scene.party.controls.ready.allowed, false); assert.equal(scene.shop.canOperate, false);
    const receipt = await f.call(surface, 'star-ring/receipt', payload, { realm: SEASON });
    assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.found, false); assert.equal(receipt.recoveryAllowed, false);
    for (const action of WRITES) {
      const result = await f.call(surface, action, payload, { realm: SEASON });
      assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(result.error, 'realm_read_only');
    }
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('Disconnected purchases recover exact original result with trusted App/Service namespaces and no second debit', async t => {
  const f = await fixture(t), body = { ...f.scope(), offerId: 'gear', requestId: 'api-recover-gear-001', namespace: 'service', tgId: OTHER };
  const posted = await f.call('app', 'star-ring/shop-scoped', body);
  assert.equal(posted.status, 200, JSON.stringify(posted)); assert.equal(posted.accountId, OWNER); assert.equal(posted.characterId, f.first.charId);
  assert.equal(posted.result.equipment.length, 1); assert.deepEqual(posted.receipt.costs, { star_ring_token: 40 });
  const before = snapshots(f.env), n = writes(f.env);
  const receipt = await f.call('app', 'star-ring/receipt', { ...body, kind: 'shop' }, { now: NOW + 86400000 });
  assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.found, true); assert.deepEqual(receipt.result, posted.result);
  const serviceMissing = await f.call('service', 'star-ring/receipt', { ...body, tgId: OWNER, kind: 'shop', namespace: 'app' });
  assert.equal(serviceMissing.status, 200); assert.equal(serviceMissing.found, false); assert.equal(serviceMissing.recoveryAllowed, true);
  const repeated = await f.call('app', 'star-ring/shop-scoped', body, { now: NOW + 86400000 });
  assert.equal(repeated.status, 200, JSON.stringify(repeated)); assert.equal(repeated.replayed, true); assert.deepEqual(repeated.result, posted.result);
  const changed = await f.call('app', 'star-ring/shop-scoped', { ...body, offerId: 'reroll' });
  assert.equal(changed.status, 409); assert.equal(changed.error, 'request_reused');
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});
