import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';
import { NOW } from './fate-private-fixture.js';

const OWNER = '19891', OTHER = '19892', SEASON = 'season_2026_01', SECRET = 'local-fate-f2-api-fixture';
const ACTIONS = ['fate/private/scene', 'fate/private/profile', 'fate/private/receipt', 'fate/private/action-scoped', 'fate/private/cancel'];
const writes = env => [env.DB, env.DB_SEASON].map(db => db.sqlite.prepare('SELECT total_changes() n').get().n);
const publicBody = body => { const { birth, birthDate, ...safe } = body; return safe; };
const noPrivate = value => assert.ok(!/1998-11-03|2017-06-21|payload_hash|payloadHash|birth_json|chart_json|notes_json/.test(JSON.stringify(value)),
  'private material escaped metadata response');
async function fixture(t) {
  const env = await initialized(t), key = randomBytes(32); let sequence = 0;
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', SERVICE_SECRET: SECRET });
  async function call(surface, action, body = {}, options = {}) {
    const realm = options.realm === undefined ? 'permanent' : options.realm,
      headers = { 'content-type': 'application/json', 'X-Debug-Now': String(options.now ?? NOW),
        ...(surface === 'app' ? options.auth === false ? {} : { 'X-Dev-Tg-Id': options.account || OWNER } :
          { 'X-Service-Secret': options.secret ?? SECRET }), ...(realm ? { 'X-Realm-Id': realm } : {}) },
      C = surface === 'app' ? CurrentClientRequest : Request,
      response = await handle(new C('https://local/' + (surface === 'app' ? 'app/api/' : 'rpg/') + action,
        { method: 'POST', headers, body: JSON.stringify(body) }), env);
    return { status: response.status, ...await response.json() };
  }
  async function create(account, realm, name) {
    const r = await call('app', 'create', { name, gender: 'f', baseClass: 'mage', requestId: 'f2-api-create-' + account },
      { account, realm });
    assert.equal(r.status, 200, 'test account creation failed');
    return r.characters.find(c => c.name === name);
  }
  const first = await create(OWNER, 'permanent', '私人API甲'),
    season = await create(OWNER, SEASON, '私人API季'), foreign = await create(OTHER, 'permanent', '私人API乙');
  const scope = (realm = 'permanent') => ({ realmId: realm,
    selectedCharacterId: realm === SEASON ? season.charId : first.charId, tgId: OWNER });
  async function prepare(kind, fields = {}, realm = 'permanent', now = NOW) {
    const scene = await call('app', 'fate/private/scene', scope(realm), { realm, now });
    assert.equal(scene.status, 200, 'private scene route unavailable');
    const d = scene.privateFate.domain, n = ++sequence;
    return { ...scope(realm), kind, requestId: 'f2-api-' + kind + '-' + String(n).padStart(6, '0'),
      intentNonce: n.toString(16).padStart(32, '0'),
      expected: { generation: d.generation, profile: d.profile, daily: d.daily },
      ...(kind === 'profile-save' ? { consent: true } : {}),
      ...(kind === 'birthday-start' ? { source: 'temporary', country: 'TW', showSign: false, socialInvite: false, day: d.daily.day } : {}),
      ...(kind === 'daily-sync' ? { day: d.daily.day } : {}), ...fields };
  }
  const digest = () => createHmac('sha256', key).update(JSON.stringify([env.DB, env.DB_SEASON].map(gameplaySnapshot))).digest('hex');
  const pure = async fn => {
    const before = digest(), n = writes(env), result = await fn();
    assert.equal(digest(), before, 'pure API changed gameplay contents');
    assert.deepEqual(writes(env), n, 'pure API performed writes'); return result;
  };
  return { env, call, first, season, foreign, scope, prepare, digest, pure };
}

test('all five F2 App and Service routes enforce auth, exact header realm and captured owned active character', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: { date: '1998-11-03' } });
  await f.pure(async () => {
    for (const action of ACTIONS) for (const surface of ['app', 'service']) {
      const base = action.endsWith('/scene') || action.endsWith('/profile') ? f.scope() :
        action.endsWith('/action-scoped') ? b : publicBody(b);
      for (const [change, options, status, error] of [
        [{}, { realm: null }, 400, 'realm_required'], [{ realmId: undefined }, {}, 400, 'realm_required'],
        [{ realmId: SEASON }, {}, 409, 'realm_mismatch'],
        [{ realmId: 'unknown-realm' }, { realm: 'unknown-realm' }, 404, 'realm_unknown'],
        [{ selectedCharacterId: undefined }, {}, 400, 'selected_character_required'],
        [{ selectedCharacterId: f.foreign.charId }, {}, 409, 'character_changed']
      ]) {
        const r = await f.call(surface, action, { ...base, ...change }, options);
        assert.equal(r.status, status, action + ' rejected incorrect scope with wrong status');
        assert.equal(r.error, error); noPrivate(r);
      }
      const unauthorized = await f.call(surface, action, base, surface === 'app' ? { auth: false } : { secret: 'wrong' });
      assert.equal(unauthorized.status, 401);
    }
  });
});

test('App/service pure scene/profile/receipt keep both realms unchanged and reveal birth only by explicit owner profile view', async t => {
  const f = await fixture(t), records = [];
  for (const realm of ['permanent', SEASON]) {
    const b = await f.prepare('profile-save', { birth: { date: realm === 'permanent' ? '1998-11-03' : '2017-06-21' } }, realm);
    const r = await f.call('app', 'fate/private/action-scoped', b, { realm });
    assert.equal(r.status, 200); records.push([realm, b, r]);
  }
  await f.pure(async () => {
    for (const [realm, b, original] of records) for (const surface of ['app', 'service']) {
      const scene = await f.call(surface, 'fate/private/scene', { ...f.scope(realm), readSequence: 27 }, { realm });
      assert.equal(scene.status, 200); assert.equal(scene.readSequence, 27); noPrivate(scene);
      assert.equal(scene.privateFate.daily.materialized, false); assert.equal('birth' in scene.privateFate.profile, false);
      const profile = await f.call(surface, 'fate/private/profile', { ...f.scope(realm), readSequence: 28 }, { realm });
      assert.equal(profile.status, 200); assert.equal(profile.readSequence, 28);
      assert.ok(profile.privateProfile.profile.birth.date === b.birth.date, 'cross-realm private birth mismatch');
      const receipt = await f.call(surface, 'fate/private/receipt', { ...publicBody(b), readSequence: 29 }, { realm });
      assert.equal(receipt.status, 200); assert.equal(receipt.readSequence, 29); noPrivate(receipt);
      assert.equal(receipt.found, surface === 'app');
      if (surface === 'app') assert.deepEqual(receipt.receipt, original.receipt);
    }
    const foreign = await f.call('app', 'fate/private/profile',
      { realmId: 'permanent', selectedCharacterId: f.foreign.charId }, { account: OTHER });
    assert.equal(foreign.status, 200); assert.equal(foreign.privateProfile.profile.saved, false);
  });
});

test('forged namespace/account and trusted-hook extras cannot change authority or expose private fingerprint', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: { date: '1998-11-03' } }),
    first = await f.call('app', 'fate/private/action-scoped', { ...b, accountId: OTHER, tgId: OTHER, namespace: 'service' });
  assert.equal(first.status, 200); assert.equal(first.accountId, OWNER);
  assert.equal(first.receipt.requestKey, 'private:app:' + b.requestId); noPrivate(first);
  await f.pure(async () => {
    const r = await f.call('app', 'fate/private/receipt', { ...publicBody(b), accountId: OTHER, tgId: OTHER, namespace: 'service' });
    assert.equal(r.status, 200); assert.equal(r.found, true); noPrivate(r);
    const wrong = await f.call('service', 'fate/private/receipt', { ...publicBody(b), namespace: 'app' });
    assert.equal(wrong.status, 200); assert.equal(wrong.found, false);
    const changed = await f.call('app', 'fate/private/action-scoped', { ...b, birth: { date: '2017-06-21' } });
    assert.equal(changed.status, 409); assert.equal(changed.error, 'request_changed'); noPrivate(changed);
    for (const extra of [{ operationResult: {} }, { privateIntent: {} }, { guards: [] }, { privateHash: 'guess' }]) {
      const denied = await f.call('app', 'fate/private/action-scoped', { ...b, ...extra });
      assert.equal(denied.status, 400); assert.equal(denied.error, 'fate_private_input'); noPrivate(denied);
    }
    for (const action of ['fate/private/receipt', 'fate/private/cancel']) {
      const leaked = await f.call('app', action, b);
      assert.equal(leaked.status, 400); assert.equal(leaked.error, 'fate_private_input'); noPrivate(leaked);
    }
  });
});

test('stale private intent cancellation is explicit unique authority and returns original commit if it already won', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: { date: '1998-11-03' } }),
    c = await f.call('app', 'fate/private/cancel', publicBody(b), { now: NOW + 86400000 });
  assert.equal(c.status, 200); assert.equal(c.outcome, 'cancelled'); assert.deepEqual(c.result, { cancelled: true });
  await f.pure(async () => {
    const late = await f.call('app', 'fate/private/action-scoped', b);
    assert.equal(late.status, 200); assert.equal(late.outcome, 'cancelled'); assert.deepEqual(late.receipt, c.receipt);
  });
  const fresh = await f.prepare('profile-save', { birth: { date: '2017-06-21' } }),
    first = await f.call('app', 'fate/private/action-scoped', fresh);
  assert.equal(first.status, 200);
  await f.pure(async () => {
    const cancel = await f.call('app', 'fate/private/cancel', publicBody(fresh));
    assert.equal(cancel.status, 200); assert.equal(cancel.outcome, 'committed'); assert.deepEqual(cancel.receipt, first.receipt);
  });
});

test('frozen realm permits all private pure views and blocks every mutation kind and cancellation', async t => {
  const f = await fixture(t), b = await f.prepare('profile-save', { birth: { date: '1998-11-03' } }, SEASON);
  assert.equal((await f.call('app', 'fate/private/action-scoped', b, { realm: SEASON })).status, 200);
  const bodies = [
    await f.prepare('profile-save', { birth: { date: '2017-06-21' } }, SEASON),
    await f.prepare('profile-delete', {}, SEASON),
    await f.prepare('daily-sync', {}, SEASON),
    await f.prepare('birthday-start', { birthDate: '1998-11-03' }, SEASON)
  ];
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
  await f.pure(async () => {
    for (const surface of ['app', 'service']) {
      for (const action of ['fate/private/scene', 'fate/private/profile']) {
        const r = await f.call(surface, action, f.scope(SEASON), { realm: SEASON });
        assert.equal(r.status, 200); assert.equal((r.privateFate || r.privateProfile).control.writable, false);
      }
      const found = await f.call(surface, 'fate/private/receipt', publicBody(b), { realm: SEASON });
      assert.equal(found.status, 200); assert.equal(found.recoveryAllowed, false);
      for (const body of bodies) {
        for (const action of ['fate/private/action-scoped', 'fate/private/cancel']) {
          const r = await f.call(surface, action, action.endsWith('/cancel') ? publicBody(body) : body, { realm: SEASON });
          assert.equal(r.status, 409); assert.equal(r.error, 'realm_read_only');
        }
      }
    }
  });
});

for (const kind of ['profile-save', 'profile-delete', 'daily-sync', 'birthday-start']) test('realm freeze inside ' + kind + ' original authority transaction rolls back rows, operation and typed receipt', async t => {
  const f = await fixture(t);
  if (kind === 'profile-delete') {
    const s = await f.prepare('profile-save', { birth: { date: '1998-11-03' } }, SEASON);
    assert.equal((await f.call('app', 'fate/private/action-scoped', s, { realm: SEASON })).status, 200);
  }
  const fields = kind === 'profile-save' ? { birth: { date: '2017-06-21' } } : kind === 'birthday-start' ? { birthDate: '1998-11-03' } : {},
    body = await f.prepare(kind, fields, SEASON), db = f.env.DB_SEASON, original = db.batch.bind(db), before = f.digest();
  let froze = false;
  db.batch = async statements => {
    if (!froze && statements.some(s => s.sql.startsWith('INSERT INTO rpg_fate_operations') && s.params[1] === 'private:app:' + body.requestId)) {
      froze = true;
      await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
    }
    return original(statements);
  };
  t.after(() => { db.batch = original; });
  const r = await f.call('app', 'fate/private/action-scoped', body, { realm: SEASON });
  assert.equal(froze, true); assert.equal(r.status, 409); assert.equal(r.error, 'realm_fence_changed');
  assert.equal(f.digest(), before);
  const read = await f.call('app', 'fate/private/receipt', publicBody(body), { realm: SEASON });
  assert.equal(read.status, 200); assert.equal(read.found, false); assert.equal(read.recoveryAllowed, false);
});

test('scoped private route rejects client-provided unlock flags and /rpg/daily remains outside Fate', async t => {
  const f = await fixture(t), body = await f.prepare('daily-sync');
  await f.pure(async () => {
    for (const extra of [{ completed: true }, { reward: 100 }, { unlocks: ['boss'] }, { evidence: ['tower'] }]) {
      const r = await f.call('app', 'fate/private/action-scoped', { ...body, ...extra });
      assert.equal(r.status, 400); assert.equal(r.error, 'fate_private_input');
    }
  });
  const r = await f.call('app', 'fate/private/action-scoped', body);
  assert.equal(r.status, 200); assert.equal(r.result.unlocked, 0); assert.deepEqual(r.receipt.costs, {});
  const count = f.env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='每日補給金'").get().n;
  assert.equal(count, 0);
});

test('reserved private namespace rejects direct App/Service legacy route replay without exposing internal authority wrapper', async t => {
  const f = await fixture(t);
  for (const [kind, action, fields] of [
    ['profile-save', 'fate/profile/save', { birth: { date: '1998-11-03' } }],
    ['profile-delete', 'fate/profile/delete', {}],
    ['birthday-start', 'fate/start', { birthDate: '2017-06-21' }]
  ]) {
    const b = await f.prepare(kind, fields), first = await f.call('app', 'fate/private/action-scoped', b);
    assert.equal(first.status, 200);
    const raw = { ...f.scope(), requestId: first.receipt.requestKey, privateIntent: JSON.parse(first.signature),
      ...(kind === 'profile-save' ? { consent: true, birth: b.birth } : {}),
      ...(kind === 'birthday-start' ? { mode: 'birthday', country: b.country, showSign: b.showSign,
        socialInvite: false, birthDate: b.birthDate } : {}) };
    await f.pure(async () => {
      for (const surface of ['app', 'service']) {
        const reply = await f.call(surface, action, raw, { now: NOW + 7200000 });
        noPrivate(reply);
        assert.equal(reply.status, 400); assert.equal(reply.error, surface === 'app' ? 'request' : 'fate_private_namespace');
      }
      const found = await f.call('app', 'fate/private/receipt', publicBody(b));
      assert.equal(found.status, 200); assert.deepEqual(found.receipt, first.receipt);
    });
  }
});
