import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW } from './realm-test-helpers.js';

const OWNER = '18301';
const FOREIGN = '18302';
const SEASON = 'season_2026_01';
const changes = env => [env.DB, env.DB_SEASON].map(db => db.sqlite.prepare('SELECT total_changes() AS n').get().n);

async function fixture(t) {
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', ATLAS_ENABLED: 'true' });
  async function app(account, realm, action, body = {}, now = NOW) {
    const response = await handle(new CurrentClientRequest('https://local/app/api/' + action, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'X-Dev-Tg-Id': account, 'X-Debug-Now': String(now),
        ...(realm === undefined ? {} : { 'X-Realm-Id': realm }),
      },
      body: JSON.stringify(body),
    }), env);
    return { status: response.status, body: await response.json() };
  }
  async function create(account, realm, name, baseClass, gender, charSlot) {
    const result = await app(account, realm, 'create', { name, baseClass, gender, ...(charSlot ? { charSlot } : {}), requestId: 'scene-create-' + account + '-' + (charSlot || 1) });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.characters.find(character => character.name === name);
  }
  return { env, app, create };
}

test('HTTP scene polling keeps realm and authenticated character identity and performs zero writes', async t => {
  const { env, app, create } = await fixture(t);
  const permanent = await create(OWNER, 'permanent', '常駐場景角色', 'sword', 'm');
  const seasonal = await create(OWNER, SEASON, '賽季場景角色', 'mage', 'f');
  await create(FOREIGN, SEASON, '外帳號場景角色', 'thief', 'm');
  env.DB.sqlite.prepare('UPDATE rpg_characters SET hp=17,gold=111 WHERE tg_id=?').run(permanent.charId);
  env.DB_SEASON.sqlite.prepare('UPDATE rpg_characters SET hp=9,gold=222 WHERE tg_id=?').run(seasonal.charId);
  const before = changes(env);
  for (const [realm, character, expectedHp, expectedGold, actor] of [
    ['permanent', permanent, 17, 111, 'sword_m'],
    [SEASON, seasonal, 9, 222, 'mage'],
  ]) {
    const result = await app(OWNER, realm, 'atlas/status', { selectedCharacterId: character.charId, tgId: FOREIGN, account_tg_id: FOREIGN }, NOW + 3600000);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const scene = result.body.scene;
    assert.equal(scene.realmId, realm);
    assert.equal(scene.accountId, OWNER);
    assert.equal(scene.characterId, character.charId);
    assert.equal(scene.character.appearanceKey, actor);
    assert.equal(scene.live.hp, expectedHp);
    assert.equal(scene.live.gold, expectedGold);
    assert.equal(scene.run, null);
  }
  const missing = await app(OWNER, undefined, 'atlas/status');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'realm_required');
  const foreign = await app(OWNER, SEASON, 'atlas/status', { selectedCharacterId: FOREIGN });
  assert.equal(foreign.status, 409);
  assert.equal(foreign.body.error, 'character_changed');
  assert.deepEqual(changes(env), before, 'even the HTTP wrapper and analytics must remain read-only');
});

test('a stale scene context is rejected and read-only discovery follows an explicit real character selection', async t => {
  const { env, app, create } = await fixture(t);
  const first = await create(OWNER, 'permanent', '場景角色甲', 'sword', 'f', 1);
  const second = await create(OWNER, 'permanent', '場景角色乙', 'archer', 'm', 2);
  const selected = await app(OWNER, 'permanent', 'select', { charId: second.charId });
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  assert.equal(selected.body.selected, second.charId);
  const before = changes(env);
  const stale = await app(OWNER, 'permanent', 'atlas/status', { selectedCharacterId: first.charId });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'character_changed');
  const discovered = await app(OWNER, 'permanent', 'atlas/status');
  assert.equal(discovered.status, 200, JSON.stringify(discovered.body));
  assert.equal(discovered.body.scene.characterId, second.charId);
  assert.equal(discovered.body.scene.character.appearanceKey, 'archer_m');
  assert.deepEqual(changes(env), before);
});
