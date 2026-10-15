import {CurrentClientRequest} from './client-request.js';
// Mini App: Telegram initData verification + /app/api/* (auth, tgId override, dev bypass gating, boss attack → boss_update outbox).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { freshDb } from './d1-shim.js';
import { handle } from '../src/index.js';
import { verifyInitData } from '../src/auth.js';
import { appAuth, APP_ACTIONS } from '../src/app.js';
import { taipeiAt } from '../src/game/time.js';

const TOKEN = '123456789:TEST_ONLY_fake_bot_token_abcdef';
const SECRET = 'test-secret-0123456789';
/** sign like Telegram does (independent implementation with node:crypto) */
function sign(fields, token = TOKEN) {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
const user = (id = 777001, first = 'Mika') => JSON.stringify({ id, first_name: first, username: 'mika_test', language_code: 'zh-hant' });
const nowS = () => Math.floor(Date.now() / 1000);
const initFor = (id, first, ageSec = 10) => sign({ auth_date: String(nowS() - ageSec), query_id: 'AAE1', user: user(id, first) });

test('verifyInitData: valid / tampered / wrong token / stale / future / missing hash', async () => {
  const good = initFor(777001, 'Mika');
  assert.equal((await verifyInitData(good, TOKEN)).id, 777001);
  const tampered = good.replace('777001', '777002'); assert.notEqual(tampered, good);
  assert.equal(await verifyInitData(tampered, TOKEN), null, 'changed user id → rejected');
  assert.equal(await verifyInitData(good, '123456789:other_token'), null, 'other bot token → rejected');
  assert.equal(await verifyInitData(initFor(1, 'a', 25 * 3600), TOKEN), null, '25h old → rejected');
  assert.ok(await verifyInitData(initFor(1, 'a', 23 * 3600), TOKEN), '23h old → ok');
  assert.equal(await verifyInitData(initFor(1, 'a', -600), TOKEN), null, '10 min in the future → rejected');
  assert.ok(await verifyInitData(initFor(1, 'a', -60), TOKEN), '1 min clock skew → ok');
  assert.equal(await verifyInitData(good.replace(/&?hash=[0-9a-f]+/, ''), TOKEN), null, 'no hash → rejected');
  assert.equal(await verifyInitData(good, ''), null, 'no token → rejected');
  assert.equal(await verifyInitData('', TOKEN), null);
});

function mk(over = {}) {
  const env = { DB: freshDb(), SERVICE_SECRET: SECRET, BOT_TOKEN: TOKEN, ENVIRONMENT: 'production', GROUP_CHAT_ID: '-100123', ...over };
  const app = async (action, body = {}, headers = {}, method = 'POST') => {
    const res = await handle(new CurrentClientRequest(`http://rpg/app/api/${action}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, ...(await res.json()) };
  };
  const svc = async (path, body = {}, headers = {}) => { const res = await handle(new CurrentClientRequest(`http://rpg${path}`, { method: 'POST', headers: { 'X-Service-Secret': SECRET, ...headers }, body: JSON.stringify(body) }), env); return { status: res.status, ...(await res.json()) }; };
  return { env, app, svc, one: (q, ...p) => env.DB.sqlite.prepare(q).get(...p), all: (q, ...p) => env.DB.sqlite.prepare(q).all(...p) };
}
const H = (init) => ({ 'X-Telegram-Init-Data': init });

test('app api: initData required; bad/forged → 401; token unset → 503; GET → 405', async () => {
  const { app } = mk();
  assert.equal((await app('me')).status, 401);
  assert.equal((await app('me', {}, H('user=%7B%22id%22%3A1%7D&auth_date=1&hash=00'))).status, 401);
  assert.equal((await app('me', {}, H(sign({ auth_date: String(nowS()), user: user(5) }, '1:other')))).error, 'bad_init_data');
  assert.equal((await app('me', {}, H(initFor(5, 'x', 2 * 86400)))).status, 401, 'stale initData');
  assert.equal((await mk({ BOT_TOKEN: '' }).app('me', {}, H(initFor(5, 'x')))).status, 503);
  assert.equal((await app('me', {}, H(initFor(5, 'x')), 'GET')).status, 405);
  assert.equal((await app('nope', {}, H(initFor(5, 'x')))).status, 404);
});

test('app api: player id comes ONLY from initData (body tgId ignored); create uses Telegram name', async () => {
  const { app, svc, one } = mk(); const h = H(initFor(777001, 'Mika'));
  assert.equal((await app('me', { tgId: '1' }, h)).error, 'no_character');
  const np = await app('create', { name: '白雪', baseClass: 'mage', gender: 'f' }, h);
  assert.equal(np.status, 403); assert.equal(np.error, 'no_pass', 'no create pass from 小精靈 (membership check) → refused');
  assert.equal((await svc('/rpg/app/grant', { tgId: '777001' })).ok, true);
  const c = await app('create', { tgId: '424242', name: '白雪', baseClass: 'mage', gender: 'f' }, h);
  assert.equal(c.ok, true); assert.equal((await app('me', {}, h)).character.tgId, '777001');
  assert.equal(one('SELECT COUNT(*) n FROM rpg_characters WHERE tg_id = ?', '424242').n, 0);
  assert.equal(one('SELECT tg_name FROM rpg_characters WHERE tg_id = ?', '777001').tg_name, 'Mika');
  // another user cannot act on 777001 by passing its tgId
  const other = await app('daily', { tgId: '777001' }, H(initFor(888, 'Eve')));
  assert.equal(other.error, 'no_character');
  const d = await app('daily', {}, h); assert.equal(d.ok, true); assert.ok(d.result.gold > 0);
  assert.equal((await app('daily', {}, h)).error, 'claimed');
  // same D1 rows as the bot's service routes
  assert.equal((await svc('/rpg/me', { tgId: '777001' })).character.name, '白雪');
  // service routes still demand the secret (initData is not accepted there)
  const res = await handle(new CurrentClientRequest('http://rpg/rpg/me', { method: 'POST', headers: H(initFor(777001, 'Mika')), body: JSON.stringify({ tgId: '777001' }) }), mk().env);
  assert.equal(res.status, 401);
});

test('dev bypass X-Dev-Tg-Id works only with ENVIRONMENT=development AND ALLOW_DEV_AUTH=true', async () => {
  const req = () => new CurrentClientRequest('http://rpg/app/api/me', { method: 'POST', headers: { 'X-Dev-Tg-Id': '9001' }, body: '{}' });
  assert.equal((await appAuth(req(), { ENVIRONMENT: 'production', ALLOW_DEV_AUTH: 'true' })).status, 401);
  assert.equal((await appAuth(req(), { ENVIRONMENT: 'development' })).status, 401);
  assert.equal((await appAuth(req(), { ALLOW_DEV_AUTH: 'true' })).status, 401);
  assert.equal((await appAuth(req(), { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true' })).tgId, '9001');
  const { app } = mk({ ENVIRONMENT: 'production', ALLOW_DEV_AUTH: 'true' });
  assert.equal((await app('me', {}, { 'X-Dev-Tg-Id': '9001' })).status, 401, 'production ignores the dev header end-to-end');
  // initData always wins over the dev header
  const dev = mk({ ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true' });
  await dev.app('create', { name: '開發者', baseClass: 'sword', gender: 'm' }, { 'X-Dev-Tg-Id': '9001' });
  assert.equal((await dev.app('me', {}, { 'X-Dev-Tg-Id': '9001', ...H(initFor(12, 'z')) })).error, 'no_character');
});

test('app api: every action maps to a real service route; meta has branches with skill MP costs', async () => {
  const { app } = mk(); const h = H(initFor(31, 'm'));
  for (const p of Object.values(APP_ACTIONS)) assert.match(p, /^\/rpg\//);
  const m = await app('meta', {}, h);
  assert.equal(m.ok, true); assert.equal(m.dev, false);
  for (const c of Object.values(m.meta.classes)) { assert.ok(c.skill.cost > 0); for (const b of Object.values(c.branches)) { assert.ok(b.skill.cost > 0); assert.ok(b.name); } }
  assert.deepEqual(m.meta.bossSlots, [0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
});

test('boss via Mini App: status, attack, cooldown, boss_update outbox (deduped per window)', async () => {
  const { app, svc, all } = mk({ ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true' });
  const now = taipeiAt('2026-10-08', 12) + 60_000; const T = { 'X-Debug-Now': String(now) };
  const h = { ...H(initFor(501, 'A')), ...T };
  await svc('/rpg/app/grant', { tgId: '501' }, T);
  await app('create', { name: '甲甲', baseClass: 'sword', gender: 'f' }, h);
  assert.equal((await app('boss', {}, h)).boss, null);
  assert.equal((await svc('/rpg/dev/spawn-now', { tier: 1 }, T)).ok, true);
  const b = await app('boss', {}, h); assert.ok(b.boss.id); assert.equal(b.boss.me.attackedThisWindow, false); assert.equal(b.boss.me.hasCharacter, true);
  const a = await app('boss/attack', { bossId: b.boss.id }, h);
  assert.equal(a.ok, true); assert.ok(a.result.damage > 0); assert.equal(a.boss.me.attackedThisWindow, true); assert.ok(a.boss.me.nextAttackAt > now); assert.equal(a.boss.top[0].name, '甲甲');
  assert.equal((await app('boss/attack', { bossId: b.boss.id }, h)).error, 'cooldown');
  const ob = all("SELECT kind FROM rpg_outbox WHERE kind = 'boss_update'"); assert.equal(ob.length, 1);
  // no character → can view but attack is refused
  const v = await app('boss', {}, { ...H(initFor(502, 'B')), ...T }); assert.equal(v.boss.me.hasCharacter, false);
  assert.equal((await app('boss/attack', { bossId: b.boss.id }, { ...H(initFor(502, 'B')), ...T })).ok, false);
});

test('create pass expires after 24h and is only issued through the service secret', async () => {
  const { app, svc } = mk({ ENVIRONMENT: 'development', ALLOW_DEBUG_TIME: 'true' });
  const t0 = taipeiAt('2026-10-08', 10); const h = (t) => ({ ...H(initFor(61, 'P')), 'X-Debug-Now': String(t) });
  const noSecret = await handle(new CurrentClientRequest('http://rpg/rpg/app/grant', { method: 'POST', headers: H(initFor(61, 'P')), body: JSON.stringify({ tgId: '61' }) }), mk().env);
  assert.equal(noSecret.status, 401);
  await svc('/rpg/app/grant', { tgId: '61' }, { 'X-Debug-Now': String(t0) });
  assert.equal((await app('create', { name: '過期', baseClass: 'archer', gender: 'm' }, h(t0 + 25 * 3600e3))).error, 'no_pass');
  assert.equal((await app('create', { name: '準時', baseClass: 'archer', gender: 'm' }, h(t0 + 3600e3))).ok, true);
});
