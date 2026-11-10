import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { NOW, initialized, gameplaySnapshot } from './realm-test-helpers.js';
import { transitionRealmPhase } from '../src/realm/index.js';

const TOKEN = '12345:realm-http-test-only-token';
const SECRET = 'realm-http-test-only-service-secret';
const SEASON = 'season_2026_01';
const OWNER = '17001';
const FOREIGN = '17002';

function signed(account) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(account), first_name: 'HTTP測試旅人' }) };
  const text = Object.keys(fields).sort().map(key => key + '=' + fields[key]).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', key).update(text).digest('hex') }).toString();
}

async function fixture(t) {
  t.mock.method(Date, 'now', () => NOW);
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', BOT_TOKEN: TOKEN, SERVICE_SECRET: SECRET, ATLAS_ENABLED: 'true' });
  async function app(account, realm, action, body = {}, { telegram = false, now = NOW } = {}) {
    const headers = { 'content-type': 'application/json', 'X-Debug-Now': String(now),
      ...(telegram ? { 'X-Telegram-Init-Data': signed(account) } : { 'X-Dev-Tg-Id': account }),
      ...(realm === undefined ? {} : { 'X-Realm-Id': realm }) };
    const response = await handle(new CurrentClientRequest('https://local/app/api/' + action, { method: 'POST', headers, body: JSON.stringify(body) }), env);
    return { status: response.status, ...await response.json() };
  }
  async function service(realm, action, body = {}) {
    const response = await handle(new Request('https://local/rpg/' + action, { method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Service-Secret': SECRET, 'X-Debug-Now': String(NOW), ...(realm === undefined ? {} : { 'X-Realm-Id': realm }) }, body: JSON.stringify(body) }), env);
    return { status: response.status, ...await response.json() };
  }
  async function create(account, realm, name, extra = {}, auth = {}) {
    const result = await app(account, realm, 'create', { name, gender: 'm', baseClass: 'sword', requestId: 'create-' + account + '-' + name, ...extra }, auth);
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.characters.find(character => character.name === name);
  }
  return { env, app, service, create };
}

async function dual(t) {
  const f = await fixture(t);
  await f.create(OWNER, 'permanent', '永久主角');
  await f.create(OWNER, SEASON, '賽季主角');
  return f;
}

test('HTTP reads and purchases isolate identical numeric character IDs and return the actual selected realm', async t => {
  const { env, app } = await dual(t);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET gold = 50000 WHERE tg_id = ?').run(OWNER);
  env.DB_SEASON.sqlite.prepare('UPDATE rpg_characters SET gold = 600 WHERE tg_id = ?').run(OWNER);
  env.DB.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').run(OWNER, 'relic_fragment', 777);
  const permanent = await app(OWNER, 'permanent', 'me'), season = await app(OWNER, SEASON, 'me');
  assert.equal(permanent.status, 200); assert.equal(season.status, 200);
  assert.equal(permanent.character.tgId, OWNER); assert.equal(season.character.tgId, OWNER);
  assert.equal(permanent.realmId, 'permanent'); assert.equal(season.realmId, SEASON);
  assert.equal(permanent.character.gold, 50000); assert.equal(season.character.gold, 600);
  assert.equal(permanent.inventory.relic_fragment, 777); assert.equal(season.inventory.relic_fragment, undefined);
  const preserved = gameplaySnapshot(env.DB), redBefore = season.inventory.red_1;
  const purchase = await app(OWNER, SEASON, 'buy', { item: 'red_1', qty: 2, selectedCharacterId: OWNER, realmId: SEASON, requestId: 'season-buy-001' });
  assert.equal(purchase.status, 200, JSON.stringify(purchase));
  assert.equal(purchase.character.gold, 588); assert.equal(purchase.inventory.red_1, redBefore + 2);
  assert.equal(purchase.realmId, SEASON);
  assert.deepEqual(gameplaySnapshot(env.DB), preserved);
  const legacy = await app(OWNER, undefined, 'me');
  assert.equal(legacy.realmId, 'permanent'); assert.equal(legacy.character.gold, 50000);
});

test('HTTP unknown realm and header/body mismatches reject without touching either economy', async t => {
  const { env, app, service } = await dual(t), before = [gameplaySnapshot(env.DB), gameplaySnapshot(env.DB_SEASON)];
  const body = { item: 'red_1', qty: 1, selectedCharacterId: OWNER, requestId: 'reject-buy-001' };
  for (const realm of ['current', 'season', 'season_2099_01']) {
    const result = await app(OWNER, realm, 'buy', body);
    assert.equal(result.status, 404); assert.equal(result.error, 'realm_unknown');
  }
  for (const [header, declared] of [[SEASON, 'permanent'], ['permanent', SEASON], [undefined, SEASON]]) {
    const result = await app(OWNER, header, 'buy', { ...body, realmId: declared });
    assert.equal(result.status, 409); assert.equal(result.error, 'realm_mismatch');
  }
  const serviceUnknown = await service('season_2099_01', 'buy', { ...body, tgId: OWNER });
  assert.equal(serviceUnknown.status, 404); assert.equal(serviceUnknown.error, 'realm_unknown');
  const serviceMismatch = await service(SEASON, 'buy', { ...body, tgId: OWNER, realmId: 'permanent' });
  assert.equal(serviceMismatch.status, 409); assert.equal(serviceMismatch.error, 'realm_mismatch');
  assert.deepEqual([gameplaySnapshot(env.DB), gameplaySnapshot(env.DB_SEASON)], before);
});

test('both new Atlas HTTP entries require an explicit realm while explicit requests use the scoped character', async t => {
  const { env, app, service } = await dual(t);
  const appMissing = await app(OWNER, undefined, 'atlas/status');
  assert.equal(appMissing.status, 400); assert.equal(appMissing.error, 'realm_required');
  const serviceMissing = await service(undefined, 'atlas/status', { tgId: OWNER });
  assert.equal(serviceMissing.status, 400); assert.equal(serviceMissing.error, 'realm_required');
  env.DB.sqlite.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,?)').run(OWNER, 'atlas_shard', 41);
  env.DB_SEASON.sqlite.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,?)').run(OWNER, 'atlas_shard', 7);
  const permanent = await app(OWNER, 'permanent', 'atlas/status', { selectedCharacterId: OWNER });
  const season = await app(OWNER, SEASON, 'atlas/status', { selectedCharacterId: OWNER });
  assert.equal(permanent.status, 200); assert.equal(season.status, 200);
  assert.equal(permanent.characterId, OWNER); assert.equal(season.characterId, OWNER);
  assert.equal(permanent.materials.atlas_shard, 41); assert.equal(season.materials.atlas_shard, 7);
  const explicitService = await service(SEASON, 'atlas/status', { tgId: OWNER });
  assert.equal(explicitService.status, 200); assert.equal(explicitService.materials.atlas_shard, 7);
});

test('HTTP character lists and active selection are independent per realm and a foreign-realm alt cannot be selected', async t => {
  const { env, app, create } = await dual(t);
  const permanentAlt = await create(OWNER, 'permanent', '永久分身', { baseClass: 'mage' });
  const seasonAlt = await create(OWNER, SEASON, '賽季分身', { baseClass: 'thief' });
  const list = async realm => (await app(OWNER, realm, 'characters')).characters;
  assert.deepEqual((await list('permanent')).map(character => character.name), ['永久主角', '永久分身']);
  assert.deepEqual((await list(SEASON)).map(character => character.name), ['賽季主角', '賽季分身']);
  assert.equal((await app(OWNER, 'permanent', 'select', { charId: permanentAlt.charId })).status, 200);
  assert.equal((await list(SEASON)).find(character => character.active).charId, OWNER);
  assert.equal((await app(OWNER, SEASON, 'select', { charId: seasonAlt.charId })).status, 200);
  assert.equal((await list('permanent')).find(character => character.active).charId, permanentAlt.charId);
  const before = gameplaySnapshot(env.DB_SEASON);
  const wrongRealm = await app(OWNER, SEASON, 'select', { charId: permanentAlt.charId });
  assert.equal(wrongRealm.status, 404); assert.equal(wrongRealm.error, 'character_not_owned');
  const staleActor = await app(OWNER, SEASON, 'buy', { item: 'red_1', qty: 1, selectedCharacterId: permanentAlt.charId });
  assert.equal(staleActor.status, 409); assert.equal(staleActor.error, 'character_changed');
  assert.deepEqual(gameplaySnapshot(env.DB_SEASON), before);
});

test('HTTP character ownership comes from authentication inside the chosen realm, never body tgId or another account selection', async t => {
  const { env, app, create } = await dual(t);
  await create(FOREIGN, SEASON, '別人的賽季');
  env.DB_SEASON.sqlite.prepare('UPDATE rpg_characters SET gold = 800000 WHERE tg_id = ?').run(FOREIGN);
  const foreignBefore = env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_characters WHERE tg_id = ?').get(FOREIGN);
  const select = await app(OWNER, SEASON, 'select', { charId: FOREIGN });
  assert.equal(select.status, 404); assert.equal(select.error, 'character_not_owned');
  const stale = await app(OWNER, SEASON, 'buy', { tgId: FOREIGN, selectedCharacterId: FOREIGN, item: 'red_1', qty: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.error, 'character_changed');
  const forged = await app(OWNER, SEASON, 'buy', { tgId: FOREIGN, account_tg_id: FOREIGN, selectedCharacterId: OWNER, item: 'red_1', qty: 1, requestId: 'owned-http-buy' });
  assert.equal(forged.status, 200); assert.equal(forged.character.tgId, OWNER); assert.equal(forged.character.gold, 994);
  assert.deepEqual(env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_characters WHERE tg_id = ?').get(FOREIGN), foreignBefore);
  const stranger = await app('17003', SEASON, 'me', { tgId: FOREIGN });
  assert.equal(stranger.status, 404); assert.equal(stranger.error, 'no_character');
  assert.deepEqual((await app(FOREIGN, SEASON, 'characters', { account_tg_id: OWNER })).characters.map(character => character.charId), [FOREIGN]);
});

test('closed realm HTTP rejects all asset-changing actions while preserving readable character lists and permanent play', async t => {
  const { env, app } = await dual(t);
  await transitionRealmPhase(env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW, now: NOW + 1 });
  const before = [gameplaySnapshot(env.DB), gameplaySnapshot(env.DB_SEASON)];
  for (const [action, body] of [
    ['buy', { item: 'red_1', qty: 1, selectedCharacterId: OWNER }],
    ['daily', { selectedCharacterId: OWNER }],
    ['create', { name: '不能新增角色', gender: 'f', baseClass: 'mage' }],
    ['select', { charId: OWNER }],
  ]) {
    const result = await app(OWNER, SEASON, action, body);
    assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(result.error, 'realm_read_only');
  }
  const list = await app(OWNER, SEASON, 'characters');
  assert.equal(list.status, 200); assert.equal(list.characters.length, 1);
  const catalog = await app(OWNER, SEASON, 'realms');
  assert.equal(catalog.realms.find(realm => realm.id === SEASON).available, false);
  assert.equal(catalog.realms.find(realm => realm.id === SEASON).phase, 'FREEZE');
  assert.deepEqual([gameplaySnapshot(env.DB), gameplaySnapshot(env.DB_SEASON)], before);
  assert.equal((await app(OWNER, 'permanent', 'buy', { item: 'red_1', qty: 1 })).status, 200);
});

test('signed first seasonal creation reads permanent membership without copying money, +N, guardians, materials or progress', async t => {
  const { env, app, service, create } = await fixture(t), auth = { telegram: true };
  assert.equal((await service(undefined, 'app/grant', { tgId: OWNER })).status, 200);
  await create(OWNER, 'permanent', '正式資格角色', {}, auth);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET gold = 987654, level = 15, exp = 42 WHERE tg_id = ?').run(OWNER);
  env.DB.sqlite.prepare('UPDATE rpg_equipment SET enhance_level = 12 WHERE tg_id = ?').run(OWNER);
  env.DB.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').run(OWNER, 'relic_fragment', 345);
  const summon = await app(OWNER, 'permanent', 'guardian/summon', { pool: 'normal', count: 1, requestId: 'permanent-angel-001' }, auth);
  assert.equal(summon.status, 200, JSON.stringify(summon));
  assert(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE char_id = ?').get(OWNER).n > 0);
  const before = gameplaySnapshot(env.DB), permanentEquipmentIds = new Set(env.DB.sqlite.prepare('SELECT id FROM rpg_equipment WHERE tg_id = ?').all(OWNER).map(row => row.id));
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_app_access WHERE tg_id = ?').get(OWNER).n, 0);
  const body = { name: '從零開始賽季', gender: 'm', baseClass: 'sword', requestId: 'season-first-character' };
  const made = await app(OWNER, SEASON, 'create', body, auth);
  assert.equal(made.status, 200, JSON.stringify(made)); assert.equal(made.characters.length, 1);
  assert.equal((await app(OWNER, SEASON, 'create', body, auth)).status, 200);
  const character = env.DB_SEASON.sqlite.prepare('SELECT * FROM rpg_characters WHERE tg_id = ?').get(OWNER);
  assert.equal(character.account_tg_id, OWNER); assert.equal(character.level, 1); assert.equal(character.exp, 0); assert.equal(character.gold, 1000);
  assert.deepEqual(env.DB_SEASON.sqlite.prepare('SELECT item,quantity FROM rpg_inventory WHERE tg_id = ? ORDER BY item').all(OWNER).map(row => ({ ...row })), [{ item: 'blue_1', quantity: 150 }, { item: 'red_1', quantity: 150 }]);
  const equipment = env.DB_SEASON.sqlite.prepare('SELECT id,enhance_level FROM rpg_equipment WHERE tg_id = ?').all(OWNER);
  assert.equal(equipment.length, 2); assert(equipment.every(row => row.enhance_level === 0 && !permanentEquipmentIds.has(row.id)));
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils').get().n, 0);
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_atlas_progress').get().n, 0);
  assert.equal(env.DB_SEASON.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type = '新手禮包'").get().n, 1);
  assert.equal(env.DB_SEASON.sqlite.prepare('SELECT COUNT(*) n FROM rpg_app_access WHERE tg_id = ?').get(OWNER).n, 0);
  assert.deepEqual(gameplaySnapshot(env.DB), before);
});

test('signed outsider cannot borrow another permanent account membership through create payload fields', async t => {
  const { env, app, create } = await fixture(t);
  await create(OWNER, 'permanent', '已有入會角色');
  const before = [gameplaySnapshot(env.DB), gameplaySnapshot(env.DB_SEASON)];
  const denied = await app(FOREIGN, SEASON, 'create', { tgId: OWNER, account_tg_id: OWNER, selectedCharacterId: OWNER, name: '不能借用資格', gender: 'm', baseClass: 'thief' }, { telegram: true });
  assert.equal(denied.status, 403); assert.equal(denied.error, 'no_pass');
  assert.deepEqual([gameplaySnapshot(env.DB), gameplaySnapshot(env.DB_SEASON)], before);
});
