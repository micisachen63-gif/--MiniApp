import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW } from './realm-test-helpers.js';

// 2026-11-10 player report: an alt on 星圖派遣 could not switch back ("我的切不回來"),
// reopening did not help and 停止返營 did not bring it home after a long backlog.
const OWNER = '18311', MINUTE = 60000;
test('the 選擇角色 API switches away from and back to a character on an Atlas dispatch, and 返營 ends it at once', async t => {
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true', ATLAS_ENABLED: 'true' });
  const app = async (action, body = {}, now = NOW) => {
    const r = await handle(new CurrentClientRequest('https://local/app/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Dev-Tg-Id': OWNER, 'X-Debug-Now': String(now), 'X-Realm-Id': 'permanent' }, body: JSON.stringify(body) }), env);
    return { status: r.status, body: await r.json() };
  };
  const main = (await app('create', { name: '主角色', baseClass: 'sword', gender: 'm', requestId: 'switch-create-1' })).body.characters[0];
  const alt = (await app('create', { name: '小號', baseClass: 'mage', gender: 'f', charSlot: 2, requestId: 'switch-create-2' })).body.characters.find(c => c.name === '小號');
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=30 WHERE tg_id=?').run(alt.charId);
  assert.equal((await app('select', { charId: alt.charId })).status, 200);
  const start = await app('atlas/start', { requestId: 'switch-start-1', mapId: 'laurel_intro', queueMode: 'duration', durationMinutes: 480, supplies: { items: { red_1: 150 } }, selectedCharacterId: alt.charId });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.run.status, 'running');

  const away = await app('select', { charId: main.charId }, NOW + MINUTE);
  assert.equal(away.status, 200, JSON.stringify(away.body));
  assert.equal(away.body.selected, main.charId);
  assert.equal(away.body.characters.find(c => c.charId === main.charId).active, true);
  assert.equal(env.DB.sqlite.prepare('SELECT atlas_run_id FROM rpg_characters WHERE tg_id=?').get(alt.charId).atlas_run_id, start.body.run.id);

  const back = await app('select', { charId: alt.charId }, NOW + 400 * MINUTE);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  const stop = await app('atlas/stop', { requestId: 'switch-stop-1', runId: start.body.run.id, selectedCharacterId: alt.charId }, NOW + 400 * MINUTE);
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  assert.notEqual(stop.body.run.status, 'running');
  assert.equal(env.DB.sqlite.prepare('SELECT atlas_run_id FROM rpg_characters WHERE tg_id=?').get(alt.charId).atlas_run_id, null);
  assert.equal((await app('select', { charId: main.charId }, NOW + 401 * MINUTE)).status, 200);
});
