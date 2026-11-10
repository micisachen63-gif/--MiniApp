import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW, gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';
import * as B from '../src/services/boss.js';
import { BOSS } from '../src/game/constants.js';

const OWNER = '19401', OTHER = '19402', SEASON = 'season_2026_01', SECRET = 'local-boss-scene-fixture';
const READS = ['boss/scene', 'boss/receipt'];
const ACTIONS = [...READS, 'boss/attack-scoped', 'boss/exchange-scoped'];
const writes = env => [env.DB, env.DB_SEASON].map(db => db.sqlite.prepare('SELECT total_changes() AS n').get().n);
const snapshots = env => [env.DB, env.DB_SEASON].map(gameplaySnapshot);

async function fixture(t) {
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', SERVICE_SECRET: SECRET });
  async function call(surface, action, body = {}, options = {}) {
    const realm = options.realm === undefined ? 'permanent' : options.realm;
    const headers = {
      'content-type': 'application/json', 'X-Debug-Now': String(options.now ?? NOW),
      ...(surface === 'app' ? (options.auth === false ? {} : { 'X-Dev-Tg-Id': options.account || OWNER }) : { 'X-Service-Secret': options.secret ?? SECRET }),
      ...(realm ? { 'X-Realm-Id': realm } : {}),
    };
    const C = surface === 'app' ? CurrentClientRequest : Request;
    const response = await handle(new C('https://local/' + (surface === 'app' ? 'app/api/' : 'rpg/') + action, {
      method: 'POST', headers, body: JSON.stringify(body),
    }), env);
    return { status: response.status, ...await response.json() };
  }
  async function create(account, realm, name, slot = 1) {
    const result = await call('app', 'create', { name, gender: 'f', baseClass: 'sword', charSlot: slot, requestId: 'boss-create-' + account + '-' + slot }, { account, realm });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.characters.find(character => character.name === name);
  }
  const first = await create(OWNER, 'permanent', '首領API甲');
  const season = await create(OWNER, SEASON, '首領API季');
  const foreign = await create(OTHER, 'permanent', '首領API乙');
  let bossId;
  for (const [db, character, amount] of [[env.DB, first, 200], [env.DB_SEASON, season, 60]]) {
    db.sqlite.prepare("UPDATE rpg_characters SET level=60,class_path='A1',last_settle_at=? WHERE tg_id=?").run(NOW, character.charId);
    for (const [item, n] of [['boss_essence', amount], ['relic_fragment', 60], ['mat_3', 1], ['mat_4', 1]])
      db.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(character.charId, item, n);
    const spawned = await B.spawnDue({ DB: db }, NOW, { force: { tier: 1 } }); bossId = spawned.id;
    db.sqlite.prepare('UPDATE rpg_boss_instances SET hp=1000000000,max_hp=1000000000 WHERE id=?').run(bossId);
  }
  const body = (realm = 'permanent') => ({ realmId: realm, selectedCharacterId: realm === SEASON ? season.charId : first.charId, tgId: OWNER });
  return { env, call, create, first, season, foreign, bossId, body };
}

test('Boss pure routes use authenticated accounts and explicit realm/character scope without behavior or gameplay writes', async t => {
  const f = await fixture(t), before = snapshots(f.env), count = writes(f.env);
  for (const [realm, amount] of [['permanent', 200], [SEASON, 60]]) for (const surface of ['app', 'service']) {
    const scope = f.body(realm), forged = surface === 'app' ? { tgId: OTHER, accountId: OTHER } : { accountId: OTHER };
    const scene = await f.call(surface, 'boss/scene', { ...scope, ...forged }, { realm, now: NOW + BOSS.durationMs + 1 });
    assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.realmId, realm);
    assert.equal(scene.accountId, OWNER); assert.equal(scene.characterId, scope.selectedCharacterId);
    assert.equal(scene.essence.quantity, amount); assert.equal(scene.boss.status, 'active');
    assert.equal(scene.boss.expired, true); assert.equal(scene.boss.settlementPending, true);
    const missing = await f.call(surface, 'boss/receipt', { ...scope, ...forged, kind: 'attack', bossId: f.bossId, win: 0 }, { realm });
    assert.equal(missing.status, 200, JSON.stringify(missing)); assert.equal(missing.found, false);
    assert.equal(missing.bossId, f.bossId); assert.equal(missing.win, 0);
    assert.equal(missing.recoveryAllowed, true); assert.equal(missing.result, null);
  }
  assert.deepEqual(writes(f.env), count); assert.deepEqual(snapshots(f.env), before);
});

test('All scoped Boss routes require authorization, explicit realm and selected character before any write', async t => {
  const f = await fixture(t), before = snapshots(f.env), count = writes(f.env);
  for (const action of ACTIONS) {
    const payload = { ...f.body(), kind: 'attack', bossId: f.bossId, win: 0, expectedWin: 0, offer: 'reroll', requestId: 'boss-validation-001' };
    for (const surface of ['app', 'service']) {
      for (const [change, options, status, error] of [
        [{}, { realm: null }, 400, 'realm_required'],
        [{ realmId: undefined }, {}, 400, 'realm_required'],
        [{ realmId: SEASON }, {}, 409, 'realm_mismatch'],
        [{ realmId: 'unknown-realm' }, { realm: 'unknown-realm' }, 404, 'realm_unknown'],
        [{ selectedCharacterId: undefined }, {}, 400, 'selected_character_required'],
        [{ selectedCharacterId: f.foreign.charId }, {}, 409, 'character_changed'],
      ]) {
        const response = await f.call(surface, action, { ...payload, ...change }, options);
        assert.equal(response.status, status, JSON.stringify(response)); assert.equal(response.error, error);
      }
    }
    assert.equal((await f.call('app', action, payload, { auth: false })).status, 401);
    assert.equal((await f.call('service', action, payload, { secret: 'wrong-local-secret' })).status, 401);
  }
  assert.deepEqual(writes(f.env), count); assert.deepEqual(snapshots(f.env), before);
});

test('Boss service routing resolves the account active character and rejects stale or foreign identifiers', async t => {
  const f = await fixture(t), second = await f.create(OWNER, 'permanent', '首領API丙', 2);
  assert.equal((await f.call('app', 'select', { charId: second.charId })).status, 200);
  const before = snapshots(f.env), count = writes(f.env);
  for (const surface of ['app', 'service']) for (const action of READS) {
    const payload = { ...f.body(), selectedCharacterId: second.charId, kind: 'attack', bossId: f.bossId, win: 0 };
    const response = await f.call(surface, action, payload);
    assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.characterId, second.charId);
    assert.equal(response.accountId, OWNER);
    const stale = await f.call(surface, action, { ...payload, selectedCharacterId: f.first.charId });
    assert.equal(stale.status, 409, JSON.stringify(stale)); assert.equal(stale.error, 'character_changed');
    if (surface === 'service') {
      const opaqueAccount = await f.call(surface, action, { ...payload, tgId: second.charId });
      assert.equal(opaqueAccount.status, 404); assert.equal(opaqueAccount.error, 'no_character');
      const other = await f.call(surface, action, { ...payload, tgId: OTHER });
      assert.equal(other.status, 409); assert.equal(other.error, 'character_changed');
    }
  }
  assert.deepEqual(writes(f.env), count); assert.deepEqual(snapshots(f.env), before);
});

test('Frozen Boss reads stay pure across due state and all scoped mutations are fenced on both surfaces', async t => {
  const f = await fixture(t);
  f.env.DB_SEASON.sqlite.prepare("UPDATE rpg_boss_instances SET hp=0,status='settling' WHERE id=?").run(f.bossId);
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW });
  const before = snapshots(f.env), count = writes(f.env), scope = f.body(SEASON);
  for (const surface of ['app', 'service']) {
    const scene = await f.call(surface, 'boss/scene', scope, { realm: SEASON, now: NOW + BOSS.durationMs + 1 });
    assert.equal(scene.status, 200, JSON.stringify(scene)); assert.equal(scene.readOnly, true);
    assert.equal(scene.boss.status, 'settling'); assert.equal(scene.boss.settlementPending, true);
    assert.equal(scene.boss.me.canAttack, false); assert.equal(scene.exchange.canOperate, false);
    for (const payload of [
      { kind: 'attack', bossId: f.bossId, win: 0 },
      { kind: 'exchange', requestId: 'frozen-exchange-001', offer: 'reroll' },
    ]) {
      const receipt = await f.call(surface, 'boss/receipt', { ...scope, ...payload }, { realm: SEASON });
      assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.found, false); assert.equal(receipt.recoveryAllowed, false);
    }
    for (const [action, payload] of [
      ['boss/attack-scoped', { bossId: f.bossId, expectedWin: 0 }],
      ['boss/exchange-scoped', { offer: 'reroll', requestId: 'frozen-exchange-001' }],
    ]) {
      const response = await f.call(surface, action, { ...scope, ...payload }, { realm: SEASON });
      assert.equal(response.status, 409, JSON.stringify(response)); assert.equal(response.error, 'realm_read_only');
    }
  }
  assert.deepEqual(writes(f.env), count); assert.deepEqual(snapshots(f.env), before);
});

test('A committed-but-disconnected attack is confirmed by its original tuple after a window boundary and cannot be resent into the next one', async t => {
  const f = await fixture(t), original = { ...f.body(), bossId: f.bossId, expectedWin: 0 };
  const posted = await f.call('app', 'boss/attack-scoped', original);
  assert.equal(posted.status, 200, JSON.stringify(posted)); assert.equal(posted.bossId, f.bossId); assert.equal(posted.win, 0);
  assert.equal(posted.resultEvidence, 'response');
  const before = snapshots(f.env), count = writes(f.env), later = NOW + BOSS.attackWindowMs + 1;
  const receipt = await f.call('app', 'boss/receipt', { ...f.body(), kind: 'attack', bossId: f.bossId, win: 0 }, { now: later });
  assert.equal(receipt.status, 200, JSON.stringify(receipt)); assert.equal(receipt.found, true);
  assert.equal(receipt.bossId, f.bossId); assert.equal(receipt.win, 0); assert.equal(receipt.currentWin, 1);
  assert.deepEqual(receipt.result, { bossId: f.bossId, win: 0, damage: posted.result.damage, createdAt: NOW });
  assert.equal(receipt.recoveryAllowed, false);
  const refused = await f.call('app', 'boss/attack-scoped', original, { now: later });
  assert.equal(refused.status, 409, JSON.stringify(refused)); assert.equal(refused.error, 'boss_window_changed');
  assert.deepEqual(writes(f.env), count); assert.deepEqual(snapshots(f.env), before);
  const fresh = await f.call('app', 'boss/attack-scoped', { ...original, expectedWin: 1 }, { now: later });
  assert.equal(fresh.status, 200, JSON.stringify(fresh));
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM rpg_boss_attacks WHERE boss_id=? AND tg_id=?').get(f.bossId, f.first.charId).n, 2);
});

test('Exchange routes return and verify the exact original signature with trusted App/Service namespaces and same-ID recovery', async t => {
  const f = await fixture(t), original = { ...f.body(), offer: 'relic', requestId: 'boss-api-relic-001' };
  const missing = await f.call('app', 'boss/receipt', { ...original, kind: 'exchange', namespace: 'service' });
  assert.equal(missing.status, 200, JSON.stringify(missing)); assert.equal(missing.found, false);
  assert.equal(missing.signature, JSON.stringify({ offer: 'relic' })); assert.equal(missing.recoveryAllowed, true);
  const [a, b] = await Promise.all([f.call('app', 'boss/exchange-scoped', original), f.call('app', 'boss/exchange-scoped', original)]);
  for (const result of [a, b]) {
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.signature, missing.signature);
    assert.equal(result.requestId, original.requestId); assert.equal(result.characterId, f.first.charId);
  }
  assert.deepEqual(a.result, b.result); assert.equal(a.essence.fragments, 30); assert.equal(b.essence.fragments, 30);
  const before = snapshots(f.env), count = writes(f.env);
  const receipt = await f.call('app', 'boss/receipt', { ...original, kind: 'exchange', namespace: 'service', tgId: OTHER });
  assert.equal(receipt.found, true); assert.equal(receipt.signature, a.signature); assert.deepEqual(receipt.result, a.result);
  assert.equal(receipt.recoveryAllowed, false);
  const service = await f.call('service', 'boss/receipt', { ...original, kind: 'exchange', namespace: 'app' });
  assert.equal(service.status, 200, JSON.stringify(service)); assert.equal(service.found, false);
  const prefix = await f.call('service', 'boss/receipt', { ...original, kind: 'exchange', requestId: 'app:' + original.requestId });
  assert.equal(prefix.status, 400); assert.equal(prefix.error, 'boss_receipt_input');
  const season = await f.call('app', 'boss/receipt', { ...original, ...f.body(SEASON), kind: 'exchange' }, { realm: SEASON });
  assert.equal(season.found, false);
  const reused = await f.call('app', 'boss/exchange-scoped', { ...original, offer: 'armor' });
  assert.equal(reused.status, 409); assert.equal(reused.error, 'request_reused');
  assert.deepEqual(writes(f.env), count); assert.deepEqual(snapshots(f.env), before);
});

test('Legacy route confirmation uses exact quantities and reports the same typed signature on commit and receipt', async t => {
  const f = await fixture(t);
  const scene = await f.call('app', 'boss/scene', f.body());
  const expectedMaterials = scene.exchange.legacy.expectedMaterials;
  const body = { ...f.body(), offer: 'legacy', requestId: 'boss-api-legacy-001', expectedMaterials };
  const wrong = await f.call('app', 'boss/exchange-scoped', { ...body, expectedMaterials: { mat_3: '1', mat_4: 1 } });
  assert.equal(wrong.status, 400); assert.equal(wrong.error, 'boss_receipt_input');
  const posted = await f.call('app', 'boss/exchange-scoped', body);
  assert.equal(posted.status, 200, JSON.stringify(posted));
  assert.equal(posted.signature, JSON.stringify({ offer: 'legacy', expectedMaterials }));
  assert.equal(posted.essence.quantity, 228); assert.deepEqual(posted.result.items, { boss_essence: 28 });
  const receipt = await f.call('app', 'boss/receipt', { ...body, kind: 'exchange' });
  assert.equal(receipt.found, true); assert.equal(receipt.signature, posted.signature); assert.deepEqual(receipt.result, posted.result);
});

test('Old App Boss routes continue working without the new mandatory scene body fields', async t => {
  const f = await fixture(t);
  const exchange = await f.call('app', 'boss-exchange', { offer: 'reroll', requestId: 'boss-old-api-001' });
  assert.equal(exchange.status, 200, JSON.stringify(exchange)); assert.deepEqual(exchange.result, { items: { scroll_r: 5 } });
  const attack = await f.call('app', 'boss/attack', { bossId: f.bossId });
  assert.equal(attack.status, 200, JSON.stringify(attack)); assert.ok(attack.result.damage > 0);
  assert.equal('signature' in exchange, false); assert.equal('win' in attack.result, false);
  assert.equal(f.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='首領精華操作收據'").get().n, 0);
});

test('Service scoped exchange uses its own raw ID namespace and exact body while App cannot claim that receipt', async t => {
  const f = await fixture(t), body = { ...f.body(), offer: 'armor', requestId: 'service-scoped-001', namespace: 'app' };
  const posted = await f.call('service', 'boss/exchange-scoped', body);
  assert.equal(posted.status, 200, JSON.stringify(posted));
  assert.deepEqual(posted.result.items, { scroll_a: 4 }); assert.equal(posted.signature, JSON.stringify({ offer: 'armor' }));
  const before = snapshots(f.env), count = writes(f.env);
  const record = await f.call('service', 'boss/receipt', { ...body, kind: 'exchange' });
  assert.equal(record.found, true); assert.equal(record.signature, posted.signature);
  const app = await f.call('app', 'boss/receipt', { ...body, kind: 'exchange' });
  assert.equal(app.status, 200, JSON.stringify(app)); assert.equal(app.found, false); assert.equal(app.recoveryAllowed, true);
  const replay = await f.call('service', 'boss/exchange-scoped', body);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.result, posted.result);
  assert.deepEqual(writes(f.env), count); assert.deepEqual(snapshots(f.env), before);
});
