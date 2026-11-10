import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, NOW, changes, snapshot, sqlRows, shortParty } from './star-ring-scene-fixture.js';
import * as Scene from '../src/services/star-ring-scene.js';
import * as Ring from '../src/services/star-ring.js';
import * as Receipt from '../src/services/star-ring-receipt.js';
import * as Engine from '../src/game/star-ring.js';
import { COSMETICS } from '../src/game/star-ring-cosmetics.js';
import { taipeiDay } from '../src/game/time.js';

async function pure(f, fn) {
  const before = snapshot(f.db), count = changes(f.db), statements = [];
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => { statements.push(sql); return prepare(sql); };
  try {
    const result = await fn();
    assert.ok(statements.length > 0);
    assert.ok(statements.every(sql => /^\s*SELECT\b/i.test(sql)), statements.find(sql => !/^\s*SELECT\b/i.test(sql)));
    assert.equal(changes(f.db), count); assert.deepEqual(snapshot(f.db), before); return result;
  } finally { f.db.prepare = prepare; }
}

for (const version of [1, 2, 3]) test('Star Ring v' + version + ' scene never settles a due stage or twelve-hour completion', async t => {
  const f = await fixture(t, { version, start: true });
  for (const now of [NOW + Engine.STAGE_MS, NOW + Engine.DURATION + 1]) {
    const scene = await pure(f, () => Scene.view(f.env, f.ids[0], {}, now));
    assert.equal(scene.active.id, f.id); assert.equal(scene.active.engineVersion, version);
    assert.equal(scene.active.status, 'running'); assert.equal(scene.active.completedStages, 0);
    assert.equal(scene.active.nextAt, NOW + Engine.STAGE_MS); assert.equal(scene.active.endsAt, NOW + Engine.DURATION);
    assert.equal(scene.active.settlementPending, true); assert.equal(scene.active.battle.preview, true);
    assert.equal(scene.active.projection.rewards, 'committed-rows-only');
    assert.deepEqual(scene.active.me.rewards, { exp: 0, items: {}, equipment: [] });
    assert.equal(scene.active.stages.filter(stage => stage.status === 'complete').length, 0);
    assert.equal(scene.daily.scope, 'character'); assert.equal(scene.daily.used, true);
    assert.equal(sqlRows(f.db, 'rpg_star_ring_rewards').length, 0);
  }
  await Ring.sweep(f.env, NOW + Engine.STAGE_MS);
  const scene = await pure(f, () => Scene.view(f.env, f.ids[0], {}, NOW + Engine.DURATION + 1));
  assert.equal(scene.active.completedStages, 1); assert.equal(scene.active.status, 'running');
  assert.ok(scene.active.me.rewards.exp > 0); assert.equal(sqlRows(f.db, 'rpg_star_ring_rewards').length, 5);
  assert.equal(scene.active.stages.filter(stage => stage.status === 'complete').length, 1);
  assert.equal(scene.active.projection.settledStages, 1);
});

test('Expired lobby remains persisted and frozen worlds allow only pure scene and receipt evidence', async t => {
  const f = await fixture(t), now = NOW + 1800001;
  for (const phase of ['ACTIVE', 'FREEZING', 'FROZEN']) {
    const env = { ...f.env, REALM_CONTEXT: { id: 'season_test', phase } };
    const result = await pure(f, async () => ({
      scene: await Scene.view(env, f.ids[0], { partyId: f.id }, now),
      missing: await Receipt.view(env, f.ids[0], { kind: 'action', partyId: f.id, action: 'start', requestId: 'never-started-01' }, now, 'app'),
    }));
    assert.equal(result.scene.party.status, 'lobby'); assert.equal(result.scene.party.settlementPending, true);
    assert.equal(result.scene.party.controls.start.allowed, false); assert.equal(result.scene.parties.length, 0);
    assert.equal(result.scene.party.readonly, phase !== 'ACTIVE');
    assert.equal(result.missing.found, false); assert.equal(result.missing.recoveryAllowed, phase === 'ACTIVE');
    assert.equal(result.missing.result, null); assert.equal(result.missing.receipt, null);
  }
});

test('Pure departure controls reflect original active character, HP, revival, presence, daily and guardian-trade gates', async t => {
  const f = await fixture(t, { second: true }), tg = f.ids[0];
  const read = async () => (await pure(f, () => Scene.view(f.env, tg, {}, NOW))).party.controls.start;
  assert.deepEqual(await read(), { allowed: true, reason: null });
  const other = f.ids[1], char = f.sql.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(other);
  f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.secondId, other);
  assert.equal((await read()).reason.code, 'changed');
  f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(other, other);
  f.sql.prepare('UPDATE rpg_characters SET hp=0 WHERE tg_id=?').run(other);
  assert.equal((await read()).reason.code, 'changed');
  f.sql.prepare("UPDATE rpg_characters SET hp=?,idle_state='reviving' WHERE tg_id=?").run(char.hp, other);
  assert.equal((await read()).reason.code, 'changed');
  f.sql.prepare('UPDATE rpg_characters SET idle_state=? WHERE tg_id=?').run(char.idle_state, other);
  f.sql.prepare('UPDATE rpg_party_presence SET account_id=? WHERE char_id=?').run('wrong-seat', other);
  assert.equal((await read()).reason.code, 'changed');
  f.sql.prepare('UPDATE rpg_party_presence SET account_id=? WHERE char_id=?').run('ring:' + other, other);
  f.sql.prepare('INSERT INTO rpg_star_ring_starts(char_id,day,run_id,started_at) VALUES(?,?,?,?)').run(other, taipeiDay(NOW), f.id, NOW);
  assert.equal((await read()).reason.code, 'daily');
  f.sql.prepare('DELETE FROM rpg_star_ring_starts WHERE char_id=?').run(other);
  f.sql.prepare('INSERT INTO rpg_trades(id,a_tg,b_tg,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?)')
    .run('ring-scene-guardian-trade', other, tg, NOW, NOW, NOW + 60000);
  f.sql.prepare("INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,'summon',?,'fixture','{}','{}',?)")
    .run('ring-scene-guardian-op', other, other, 'ring-scene-guardian', '0'.repeat(64), NOW);
  f.sql.prepare("INSERT INTO rpg_guardian_sigils(id,char_id,type,quality,trade_id,source_operation_id,created_at,updated_at) VALUES(?,?,'melee',1,?,?,?,?)")
    .run('ring-scene-guardian', other, 'ring-scene-guardian-trade', 'ring-scene-guardian-op', NOW, NOW);
  assert.equal((await read()).reason.code, 'guardian_trade');
  f.sql.prepare('UPDATE rpg_guardian_sigils SET trade_id=NULL WHERE id=?').run('ring-scene-guardian');
  assert.equal((await read()).allowed, true);
});

test('Same-account old-character reports preserve current actor identity and reject foreign or nonparticipant recipients', async t => {
  const f = await fixture(t, { start: true, second: true });
  f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.secondId, f.ids[0]);
  const scene = await pure(f, () => Scene.view(f.env, f.secondId, { partyId: f.id, recipientCharId: f.ids[0] }, NOW + 60000));
  assert.equal(scene.accountId, f.ids[0]); assert.equal(scene.characterId, f.secondId); assert.equal(scene.character.id, f.secondId);
  assert.equal(scene.active, null); assert.equal(scene.party.me.id, f.ids[0]); assert.equal(scene.party.recipientCharId, f.ids[0]);
  assert.equal(scene.party.readonly, true); assert.equal(scene.party.controls.tactic.reason.code, 'read_only_report');
  assert.ok(Object.values(scene.party.controls).every(value => !value.allowed));
  await assert.rejects(Scene.view(f.env, f.secondId, { partyId: f.id, recipientCharId: f.ids[1] }, NOW), { code: 'character_not_owned' });
  await assert.rejects(Scene.view(f.env, f.secondId, { partyId: f.id, recipientCharId: f.secondId }, NOW), { code: 'member' });
  await assert.rejects(Scene.view(f.env, f.secondId, { recipientCharId: f.ids[0] }, NOW), { code: 'star_ring_receipt_input' });
});

for (const kind of ['dungeon', 'tower']) test('Pure scene keeps running membership and live ' + kind + ' HP/MP separate', async t => {
  const f = await fixture(t, { start: true }), foreground = await shortParty(f, kind);
  f.sql.prepare('UPDATE rpg_characters SET hp=123,mp=45 WHERE tg_id=?').run(f.ids[0]);
  const scene = await pure(f, () => Scene.view(f.env, f.ids[0], {}, NOW + Engine.STAGE_MS));
  assert.equal(scene.presence.backgroundRunId, f.id); assert.equal(scene.presence.foregroundPartyId, foreground);
  assert.equal(scene.active.id, f.id); assert.equal(scene.character.hp, 123); assert.equal(scene.character.mp, 45);
  assert.equal(scene.presence.canCreate, false); assert.equal(scene.active.parallelActivities, true);
  assert.notEqual(scene.active.members[0].maxHp, 123); assert.equal(sqlRows(f.db, 'rpg_star_ring_rewards').length, 0);
});

test('Shop projection uses original currencies, prices and already-owned zero-cost rules without inventory repair', async t => {
  const f = await fixture(t, { lobby: false }), tg = f.ids[0], owned = COSMETICS[0];
  f.sql.prepare('INSERT INTO rpg_star_ring_cosmetics(char_id,cosmetic_id,unlocked_at) VALUES(?,?,?)').run(tg, owned.id, NOW);
  const scene = await pure(f, () => Scene.view(f.env, tg, {}, NOW + 86400000));
  assert.deepEqual(scene.shop.balances, { star_ring_token: 500, star_ring_core: 120 });
  assert.equal(scene.shop.offers.length, Engine.SHOP.length);
  for (const original of Engine.SHOP) {
    const offer = scene.shop.offers.find(item => item.id === original.id);
    assert.equal(offer.cost, original.cost); assert.equal(offer.currency, original.currency || 'star_ring_token');
    assert.equal(offer.effectiveCost, original.cosmetic === owned.id ? 0 : original.cost);
    assert.deepEqual(offer.costs, original.cosmetic === owned.id ? {} : { [offer.currency]: original.cost });
  }
  assert.equal(scene.shop.cosmetics.catalog.find(item => item.id === owned.id).canEquip, true);
  assert.equal(scene.shop.cosmetics.catalog.find(item => item.id === COSMETICS[1].id).reason.code, 'not_owned');
  assert.equal(scene.catalog.duration, 12 * 3600000); assert.equal(scene.catalog.stageMs, 2 * 3600000);
});
