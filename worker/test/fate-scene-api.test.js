import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';
import { NOW } from './fate-scene-fixture.js';
import { LIFE_MS } from '../public/fate/life.js';

const OWNER = '19871', OTHER = '19872', SEASON = 'season_2026_01', SECRET = 'local-fate-scene-fixture';
const ACTIONS = ['fate/scene', 'fate/receipt', 'fate/action-scoped'];
const writes = env => [env.DB, env.DB_SEASON].map(db => db.sqlite.prepare('SELECT total_changes() n').get().n);
const snapshots = env => [env.DB, env.DB_SEASON].map(gameplaySnapshot);
async function fixture(t) {
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', SERVICE_SECRET: SECRET });
  async function call(surface, action, body = {}, options = {}) {
    const realm = options.realm === undefined ? 'permanent' : options.realm;
    const headers = { 'content-type': 'application/json', 'X-Debug-Now': String(options.now ?? NOW),
      ...(surface === 'app' ? options.auth === false ? {} : { 'X-Dev-Tg-Id': options.account || OWNER } :
        { 'X-Service-Secret': options.secret ?? SECRET }), ...(realm ? { 'X-Realm-Id': realm } : {}) };
    const C = surface === 'app' ? CurrentClientRequest : Request;
    const response = await handle(new C('https://local/' + (surface === 'app' ? 'app/api/' : 'rpg/') + action,
      { method: 'POST', headers, body: JSON.stringify(body) }), env);
    return { status: response.status, ...await response.json() };
  }
  async function create(account, realm, name) {
    const r = await call('app', 'create', { name, gender: 'f', baseClass: 'mage', requestId: 'fate-api-create-' + account },
      { account, realm });
    assert.equal(r.status, 200, JSON.stringify(r));
    return r.characters.find(c => c.name === name);
  }
  const first = await create(OWNER, 'permanent', '命運API甲'),
    season = await create(OWNER, SEASON, '命運API季'), foreign = await create(OTHER, 'permanent', '命運API乙');
  for (const [db, c, gold] of [[env.DB, first, 10000], [env.DB_SEASON, season, 22222]])
    db.sqlite.prepare('UPDATE rpg_characters SET level=30,gold=?,last_settle_at=? WHERE tg_id=?').run(gold, NOW, c.charId);
  const scope = (realm = 'permanent') => ({ realmId: realm,
    selectedCharacterId: realm === SEASON ? season.charId : first.charId, tgId: OWNER });
  const fields = { kind: 'start', requestId: 'fate-api-start-0001', mode: 'random', country: 'TW', showSign: false, socialInvite: false };
  return { env, call, first, season, foreign, scope, fields };
}

test('App and Service Fate scene/receipt leave both databases untouched with overdue lives and idle settlement', async t => {
  const f = await fixture(t);
  for (const realm of ['permanent', SEASON]) {
    const r = await f.call('app', 'fate/action-scoped', { ...f.scope(realm), ...f.fields }, { realm });
    assert.equal(r.status, 200, JSON.stringify(r));
  }
  const before = snapshots(f.env), n = writes(f.env);
  for (const realm of ['permanent', SEASON]) for (const surface of ['app', 'service']) {
    const forged = surface === 'app' ? { tgId: OTHER, accountId: OTHER } : { accountId: OTHER };
    const body = { ...f.scope(realm), ...forged, readSequence: 17 };
    const scene = await f.call(surface, 'fate/scene', body, { realm, now: NOW + LIFE_MS });
    assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.accountId, OWNER);
    assert.equal(scene.characterId, body.selectedCharacterId); assert.equal(scene.realmId, realm);
    assert.equal(scene.readSequence, 17); assert.equal('scene' in scene, false);
    assert.equal(scene.fate.state.active.status, 'active'); assert.equal(scene.fate.state.active.timing.completionDue, true);
    assert.equal(scene.fate.state.active.timing.persistedAnswerCount, 0);
    assert.equal(scene.fate.state.active.draft.answers.length, 0);
    assert.equal(scene.fate.state.completed, 0); assert.equal(scene.fate.state.startedToday, 1);
    assert.equal(scene.fate.state.last, null); assert.equal(scene.fate.gifts.claimable, 0);
    const receipt = await f.call(surface, 'fate/receipt', { ...body, ...f.fields }, { realm, now: NOW + LIFE_MS });
    assert.equal(receipt.status, 200, JSON.stringify(receipt));
    assert.equal(receipt.found, surface === 'app');
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('all three scoped Fate routes enforce authentication and exact realm/current actor before any write', async t => {
  const f = await fixture(t), before = snapshots(f.env), n = writes(f.env);
  for (const action of ACTIONS) for (const surface of ['app', 'service']) {
    const body = { ...f.scope(), ...f.fields };
    for (const [change, options, status, error] of [
      [{}, { realm: null }, 400, 'realm_required'], [{ realmId: undefined }, {}, 400, 'realm_required'],
      [{ realmId: SEASON }, {}, 409, 'realm_mismatch'], [{ realmId: 'unknown-realm' }, { realm: 'unknown-realm' }, 404, 'realm_unknown'],
      [{ selectedCharacterId: undefined }, {}, 400, 'selected_character_required'],
      [{ selectedCharacterId: f.foreign.charId }, {}, 409, 'character_changed']
    ]) {
      const r = await f.call(surface, action, { ...body, ...change }, options);
      assert.equal(r.status, status, JSON.stringify(r)); assert.equal(r.error, error);
    }
    const unauthorized = await f.call(surface, action, body, surface === 'app' ? { auth: false } : { secret: 'wrong' });
    assert.equal(unauthorized.status, 401, JSON.stringify(unauthorized));
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('frozen Fate scene and durable receipts remain SELECT-only while every F1 write kind is fenced', async t => {
  const f = await fixture(t), base = { ...f.scope(SEASON), ...f.fields };
  const first = await f.call('app', 'fate/action-scoped', base, { realm: SEASON });
  assert.equal(first.status, 200, JSON.stringify(first));
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
  const before = snapshots(f.env), n = writes(f.env);
  const bodies = [base, { ...base, kind: 'choice', lifeId: first.result.lifeId, index: 0, answer: 0 },
    { ...base, kind: 'keep', code: 'existing-code' }, { ...base, kind: 'gift-claim', expectedMilestones: [] },
    { ...base, kind: 'gift-open', giftId: 'exact-gift-id' }];
  for (const surface of ['app', 'service']) {
    const scene = await f.call(surface, 'fate/scene', base, { realm: SEASON, now: NOW + LIFE_MS });
    assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.fate.control.writable, false);
    assert.equal(scene.fate.control.startAllowed, false);
    const receipt = await f.call(surface, 'fate/receipt', base, { realm: SEASON, now: NOW + LIFE_MS });
    assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.recoveryAllowed, false);
    assert.equal(receipt.found, surface === 'app');
    for (const body of bodies) {
      const r = await f.call(surface, 'fate/action-scoped', body, { realm: SEASON });
      assert.equal(r.status, 409, JSON.stringify(r)); assert.equal(r.error, 'realm_read_only');
    }
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('Fate transport cannot forge namespace/account and same-ID recovery keeps original result without settlement', async t => {
  const f = await fixture(t);
  const body = { ...f.scope(), ...f.fields, tgId: OTHER, accountId: OTHER, namespace: 'service' };
  const first = await f.call('app', 'fate/action-scoped', body);
  assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.accountId, OWNER);
  assert.equal(first.receipt.requestKey, 'scene:app:' + body.requestId);
  assert.deepEqual(first.receipt.result, first.result); assert.deepEqual(first.receipt.costs, { dailyStarts: 1 });
  const before = snapshots(f.env), n = writes(f.env);
  const receipt = await f.call('app', 'fate/receipt', body, { now: NOW + LIFE_MS });
  assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.found, true);
  assert.deepEqual(receipt.result, first.result);
  const other = await f.call('service', 'fate/receipt', { ...body, tgId: OWNER, namespace: 'app' });
  assert.equal(other.status, 200, JSON.stringify(other)); assert.equal(other.found, false);
  const replay = await f.call('app', 'fate/action-scoped', body, { now: NOW + LIFE_MS });
  assert.equal(replay.status, 200, JSON.stringify(replay)); assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  const changed = await f.call('app', 'fate/action-scoped', { ...body, country: 'JP' }, { now: NOW + LIFE_MS });
  assert.equal(changed.status, 409, JSON.stringify(changed)); assert.equal(changed.error, 'request_reused');
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});

test('a realm freeze between routing and original Fate authority batch rolls back all gameplay and receipts', async t => {
  const f = await fixture(t), db = f.env.DB_SEASON, original = db.batch.bind(db),
    before = snapshots(f.env); let froze = false;
  db.batch = async statements => {
    if (!froze && statements.some(s => s.sql.startsWith('INSERT INTO rpg_fate_starts'))) {
      froze = true;
      await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0,
        nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
    }
    return original(statements);
  };
  const r = await f.call('app', 'fate/action-scoped', { ...f.scope(SEASON), ...f.fields }, { realm: SEASON });
  assert.equal(froze, true); assert.equal(r.status, 409, JSON.stringify(r)); assert.equal(r.error, 'realm_fence_changed');
  assert.deepEqual(snapshots(f.env), before);
  const scene = await f.call('app', 'fate/scene', f.scope(SEASON), { realm: SEASON });
  assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.fate.state.active, null);
  const receipt = await f.call('app', 'fate/receipt', { ...f.scope(SEASON), ...f.fields }, { realm: SEASON });
  assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.found, false);
  assert.equal(receipt.recoveryAllowed, false);
});

test('F1 API rejects birthday/profile, missing explicit policy and invalid cursor without changing the original game', async t => {
  const f = await fixture(t), before = snapshots(f.env), n = writes(f.env);
  for (const fields of [{ mode: 'birth' }, { birthDate: '1990-01-01' }, { profile: {} }, { showSign: undefined },
    { socialInvite: true }, { country: 'invalid' }]) {
    const r = await f.call('app', 'fate/action-scoped', { ...f.scope(), ...f.fields, ...fields });
    assert.equal(r.status, 400, JSON.stringify(r)); assert.equal(r.error, 'fate_scene_input');
  }
  for (const fields of [{ before: -1 }, { giftAfter: 3 }, { giftStatus: 'pending' }, { readSequence: -1 }]) {
    const r = await f.call('app', 'fate/scene', { ...f.scope(), ...fields });
    assert.equal(r.status, 400, JSON.stringify(r)); assert.equal(r.error, 'fate_scene_input');
  }
  assert.deepEqual(writes(f.env), n); assert.deepEqual(snapshots(f.env), before);
});
