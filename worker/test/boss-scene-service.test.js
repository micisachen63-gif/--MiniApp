import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { gameplaySnapshot } from './realm-test-helpers.js';
import * as P from '../src/services/player.js';
import * as B from '../src/services/boss.js';
import * as SCENE from '../src/services/boss-scene.js';
import * as RECEIPT from '../src/services/boss-receipt.js';
import { BOSS, ITEMS } from '../src/game/constants.js';
import { BOSS_EXCHANGES } from '../src/game/boss-economy.js';
import { taipeiDay, taipeiAt } from '../src/game/time.js';

const OWNER = '19201', OTHER = '19202';
const writes = db => db.sqlite.prepare('SELECT total_changes() AS n').get().n;
async function fixture(t) {
  const env = { DB: freshDb() }; t.after(() => env.DB.sqlite.close());
  await P.createCharacter(env, { tgId: OWNER, name: '首領讀取甲', gender: 'f', baseClass: 'sword' }, T0);
  await P.createCharacter(env, { tgId: OTHER, name: '首領讀取乙', gender: 'm', baseClass: 'mage' }, T0);
  const { id } = await B.spawnDue(env, T0, { force: { tier: 3 } });
  return { env, db: env.DB, id };
}
function put(db, tg, item, n) {
  db.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(tg, item, n);
}
function hit(db, id, tg, win, damage, now = T0) {
  db.sqlite.prepare('INSERT INTO rpg_boss_attacks(boss_id,tg_id,win,damage,created_at) VALUES(?,?,?,?,?)').run(id, tg, win, damage, now);
}

test('Boss scene and original attack receipt remain SELECT-only across expiry and pending settlement', async t => {
  const { env, db, id } = await fixture(t);
  hit(db, id, OWNER, 0, 27);
  db.sqlite.prepare("UPDATE rpg_boss_instances SET hp=0,status='active' WHERE id=?").run(id);
  for (const status of ['active', 'settling']) {
    db.sqlite.prepare('UPDATE rpg_boss_instances SET status=? WHERE id=?').run(status, id);
    const before = gameplaySnapshot(db), count = writes(db), statements = [];
    const prepare = db.prepare.bind(db); db.prepare = sql => { statements.push(sql); return prepare(sql); };
    const now = T0 + BOSS.durationMs + 1;
    const scene = await SCENE.view(env, OWNER, {}, now);
    const receipt = await RECEIPT.view(env, OWNER, { kind: 'attack', bossId: id, win: 0 }, now, 'app');
    db.prepare = prepare;
    assert.equal(scene.boss.id, id); assert.equal(scene.boss.status, status);
    assert.equal(scene.boss.expired, true); assert.equal(scene.boss.settlementPending, true);
    assert.equal(scene.boss.me.canAttack, false); assert.equal(receipt.found, true);
    assert.ok(statements.length > 10); assert.ok(statements.every(sql => /^\s*SELECT\b/i.test(sql)));
    assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
  }
});

test('Boss scene selects the newest persisted instance and retains an explicitly selected old boss', async t => {
  const { env, db, id } = await fixture(t);
  const newer = await B.spawnDue(env, T0 + 1000, { force: { tier: 4 } });
  const before = gameplaySnapshot(db), count = writes(db);
  assert.equal((await SCENE.view(env, OWNER, {}, T0 + 2000)).boss.id, newer.id);
  const old = await SCENE.view(env, OWNER, { bossId: id }, T0 + 2000);
  assert.equal(old.boss.id, id); assert.equal(old.history.length, 2);
  assert.equal(old.history.find(row => row.id === id).selected, true);
  await assert.rejects(SCENE.view(env, OWNER, { bossId: 'not-present' }, T0), { code: 'no_boss' });
  assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

test('Boss scene reports exact personal windows, damage, recovery time and account cap without disabling attacks at the cap', async t => {
  const { env, db, id } = await fixture(t), now = T0 + BOSS.attackWindowMs;
  hit(db, id, OWNER, 0, 31); hit(db, id, OWNER, 1, 47, now); hit(db, id, OTHER, 1, 100, now);
  db.sqlite.prepare('UPDATE rpg_characters SET boss_down_until=? WHERE tg_id=?').run(T0 + 4 * BOSS.attackWindowMs, OWNER);
  db.sqlite.prepare("INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(?,?,'boss_essence',4)").run(OWNER, taipeiDay(now));
  const scene = await SCENE.view(env, OWNER, {}, now);
  assert.equal(scene.boss.me.hits, 2); assert.equal(scene.boss.me.damage, 78);
  assert.equal(scene.boss.me.window, 1); assert.equal(scene.boss.me.attackedThisWindow, true);
  assert.equal(scene.boss.me.nextAttackAt, T0 + 4 * BOSS.attackWindowMs);
  assert.equal(scene.boss.me.reason.code, 'down'); assert.equal(scene.essence.daily.remaining, 0);
  db.sqlite.prepare('UPDATE rpg_characters SET boss_down_until=NULL WHERE tg_id=?').run(OWNER);
  const next = await SCENE.view(env, OWNER, {}, T0 + 2 * BOSS.attackWindowMs);
  assert.equal(next.boss.me.canAttack, true); assert.equal(next.essence.daily.used, 4);
  assert.equal(next.essence.daily.limit, 4);
});

test('Essence inventory belongs to the selected character while daily kills belong to the account and reset at Taipei midnight', async t => {
  const { env, db } = await fixture(t);
  const second = await P.createCharacter(env, { tgId: OWNER, name: '首領另一角', gender: 'm', baseClass: 'archer', charSlot: 2 }, T0);
  const secondId = second.char.tg_id;
  db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(secondId, OWNER);
  put(db, OWNER, 'boss_essence', 99); put(db, secondId, 'boss_essence', 7); put(db, secondId, 'relic_fragment', 12);
  const now = taipeiAt('2026-10-08', 23) + 59 * 60000;
  db.sqlite.prepare("INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(?,?,'boss_essence',3)").run(OWNER, taipeiDay(now));
  db.sqlite.prepare("INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(?,?,'boss_essence',9)").run(secondId, taipeiDay(now));
  const before = gameplaySnapshot(db), count = writes(db);
  const scene = await SCENE.view(env, secondId, {}, now);
  assert.equal(scene.accountId, OWNER); assert.equal(scene.characterId, secondId);
  assert.equal(scene.essence.quantity, 7); assert.equal(scene.essence.fragments, 12);
  assert.equal(scene.essence.daily.used, 3); assert.equal(scene.essence.daily.remaining, 1);
  assert.equal(scene.essence.daily.resetsAt, taipeiAt('2026-10-09', 0));
  assert.equal((await SCENE.view(env, secondId, {}, scene.essence.daily.resetsAt)).essence.daily.used, 0);
  await assert.rejects(SCENE.view(env, OWNER, {}, now), { code: 'character_changed' });
  assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

test('Boss exchange scene preserves original catalog and exact whole-inventory legacy confirmation', async t => {
  const { env, db } = await fixture(t);
  put(db, OWNER, 'boss_essence', 80); put(db, OWNER, 'relic_fragment', 30);
  put(db, OWNER, 'mat_3', 2); put(db, OWNER, 'mat_4', 1);
  const before = gameplaySnapshot(db), count = writes(db), scene = await SCENE.view(env, OWNER, {}, T0);
  for (const [id, offer] of Object.entries(BOSS_EXCHANGES)) {
    const projected = scene.exchange.offers.find(row => row.id === id);
    assert.equal(projected.cost, offer.cost); assert.equal(projected.qty, offer.qty);
    assert.equal(projected.item, offer.item || null); assert.equal(projected.currency, offer.currency || 'boss_essence');
    assert.equal(projected.canExchange, true);
  }
  assert.equal(scene.exchange.canOperate, true);
  assert.deepEqual(scene.exchange.legacy.expectedMaterials, { mat_3: 2, mat_4: 1 });
  assert.equal(scene.exchange.legacy.essence, 40);
  assert.deepEqual(scene.exchange.legacy.materials.map(row => [row.key, row.quantity, row.essenceEach]), [['mat_3', 2, 12], ['mat_4', 1, 16]]);
  assert.ok(scene.character.stats.maxHp > 0); assert.ok(scene.character.stats.maxMp > 0);
  assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

test('Frozen boss scene and receipts remain readable with all mutation choices fenced', async t => {
  const { env, db, id } = await fixture(t);
  put(db, OWNER, 'boss_essence', 200); put(db, OWNER, 'relic_fragment', 200); put(db, OWNER, 'mat_3', 2);
  const frozen = { ...env, REALM_CONTEXT: { id: 'season-test', phase: 'FREEZE' } };
  const before = gameplaySnapshot(db), count = writes(db);
  const scene = await SCENE.view(frozen, OWNER, {}, T0);
  assert.equal(scene.readOnly, true); assert.equal(scene.boss.me.canAttack, false);
  assert.equal(scene.exchange.canOperate, false); assert.equal(scene.exchange.blockedReason.code, 'realm_read_only');
  assert.ok(scene.exchange.offers.every(offer => !offer.canExchange));
  assert.equal(scene.exchange.legacy.canExchange, false);
  for (const body of [{ kind: 'attack', bossId: id, win: 0 }, { kind: 'exchange', requestId: 'missing-receipt', offer: 'reroll' }]) {
    const receipt = await RECEIPT.view(frozen, OWNER, body, T0, 'app');
    assert.equal(receipt.found, false); assert.equal(receipt.recoveryAllowed, false);
  }
  assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

test('Committed monster materials gain display names only in the scene projection', async t => {
  const { env, db, id } = await fixture(t);
  const result = { monsterMaterials: [{ tgId: OWNER, item: 'mat_3', qty: 2 }], essences: [{ tgId: OWNER, account: OWNER, qty: 7 }] };
  db.sqlite.prepare("UPDATE rpg_boss_instances SET status='killed',result_json=? WHERE id=?").run(JSON.stringify(result), id);
  const before = gameplaySnapshot(db), count = writes(db), scene = await SCENE.view(env, OWNER, {}, T0);
  assert.deepEqual(scene.boss.result.monsterMaterials[0], { ...result.monsterMaterials[0], itemName: ITEMS.mat_3.name });
  assert.deepEqual(scene.boss.result.essences, result.essences);
  assert.equal(JSON.parse(db.sqlite.prepare('SELECT result_json FROM rpg_boss_instances WHERE id=?').get(id).result_json).monsterMaterials[0].itemName, undefined);
  assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

test('Attack receipt exposes only facts in the original tuple and never reconstructs battle details', async t => {
  const { env, db, id } = await fixture(t);
  hit(db, id, OWNER, 0, 123, T0 + 100); hit(db, id, OTHER, 1, 777);
  const before = gameplaySnapshot(db), count = writes(db);
  const receipt = await RECEIPT.view(env, OWNER, { kind: 'attack', bossId: id, win: 0 }, T0 + 2 * BOSS.attackWindowMs, 'app');
  assert.equal(receipt.found, true); assert.equal(receipt.recoveryAllowed, false);
  assert.deepEqual(receipt.result, { bossId: id, win: 0, damage: 123, createdAt: T0 + 100 });
  for (const key of ['counter', 'crit', 'hp', 'mp', 'bossHp', 'killed', 'kill']) assert.equal(key in receipt.result, false);
  const foreignWindow = await RECEIPT.view(env, OWNER, { kind: 'attack', bossId: id, win: 1 }, T0, 'app');
  assert.equal(foreignWindow.found, false); assert.equal(foreignWindow.recoveryAllowed, false);
  assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});

test('Missing attack receipts permit only explicit original-window recovery while that boss remains attackable', async t => {
  const { env, db, id } = await fixture(t), body = { kind: 'attack', bossId: id, win: 0 };
  const initial = await RECEIPT.view(env, OWNER, body, T0, 'app');
  assert.equal(initial.found, false); assert.equal(initial.recoveryAllowed, true); assert.equal(initial.currentWin, 0);
  assert.equal((await RECEIPT.view(env, OWNER, body, T0 + BOSS.attackWindowMs, 'app')).recoveryAllowed, false);
  db.sqlite.prepare('UPDATE rpg_characters SET boss_down_until=? WHERE tg_id=?').run(T0 + 10000, OWNER);
  assert.equal((await RECEIPT.view(env, OWNER, body, T0, 'app')).recoveryAllowed, false);
  db.sqlite.prepare('UPDATE rpg_characters SET boss_down_until=NULL WHERE tg_id=?').run(OWNER);
  db.sqlite.prepare('UPDATE rpg_boss_instances SET hp=0 WHERE id=?').run(id);
  assert.equal((await RECEIPT.view(env, OWNER, body, T0, 'app')).recoveryAllowed, false);
});

test('Receipt inputs require typed original identities and explicit canonical legacy counts', async t => {
  const { env, db, id } = await fixture(t), before = gameplaySnapshot(db), count = writes(db);
  for (const win of [-1, 0.5, '0', NaN, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(RECEIPT.view(env, OWNER, { kind: 'attack', bossId: id, win }, T0), { code: 'boss_receipt_input' });
  for (const body of [
    { kind: 'attack', bossId: 'bad id', win: 0 },
    { kind: 'exchange', requestId: 'app:original-123', offer: 'reroll' },
    { kind: 'exchange', requestId: 'original-123', offer: 'legacy' },
    { kind: 'exchange', requestId: 'original-123', offer: 'legacy', expectedMaterials: { mat_3: '1', mat_4: 0 } },
    { kind: 'exchange', requestId: 'original-123', offer: 'legacy', expectedMaterials: { mat_3: 1, mat_4: 0, extra: 0 } },
    { kind: 'unknown' },
  ]) await assert.rejects(RECEIPT.view(env, OWNER, body, T0, 'app'), { code: 'boss_receipt_input' });
  const missing = await RECEIPT.view(env, OWNER, { kind: 'exchange', requestId: 'original-123', offer: 'reroll' }, T0, 'app');
  assert.equal(missing.signature, JSON.stringify({ offer: 'reroll' }));
  assert.equal(missing.found, false); assert.equal(missing.recoveryAllowed, true);
  assert.equal(RECEIPT.exchangeSignature({ offer: 'legacy', expectedMaterials: { mat_4: 2, mat_3: 1 } }, { scoped: true }),
    JSON.stringify({ offer: 'legacy', expectedMaterials: { mat_3: 1, mat_4: 2 } }));
  assert.equal(writes(db), count); assert.deepEqual(gameplaySnapshot(db), before);
});
