import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initialized, NOW } from './realm-test-helpers.js';
import { createCharacter } from '../src/services/player.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';
import { view } from '../src/services/exchange-scene.js';
import { seedLedgerQa } from '../tools/ledger-qa-fixture.mjs';
import { seedExchangeQa, exchangeQaState } from '../tools/exchange-qa-fixture.mjs';

async function setup(t) {
  const env = await initialized(t);
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true' });
  const permanent = scopeEnvForRealm(env, await resolveRealm(env, 'permanent'));
  for (const [index, baseClass] of ['sword', 'archer', 'mage', 'thief'].entries())
    await createCharacter(permanent, { tgId: '90101', charSlot: index + 1, name: '合成' + baseClass, baseClass, gender: 'f' }, NOW);
  await seedLedgerQa(env, NOW);
  const seed = await seedExchangeQa(env, NOW);
  return { env, seed };
}

async function readPages(f, character, tab, selector = {}) {
  const scoped = scopeEnvForRealm(f.env, await resolveRealm(f.env, character.realmId));
  const body = { realmId: character.realmId, selectedCharacterId: character.characterId,
    contextEpoch: 1, tab, ...selector };
  const pages = [], seen = new Set();
  let cursor = null;
  do {
    const result = await view(scoped, character.characterId, { ...body, cursor }, NOW);
    assert.equal(result.pageSize, 30);
    assert(result.items.length <= 30);
    assert.equal(result.accountId, character.accountId);
    assert.equal(result.characterId, character.characterId);
    assert.equal(result.realmId, character.realmId);
    pages.push(result);
    cursor = result.nextCursor;
    if (cursor) { assert(!seen.has(cursor), 'cursor cannot cycle'); seen.add(cursor); }
    assert(pages.length <= 10, 'finite synthetic pagination');
  } while (cursor);
  return pages;
}
const ids = pages => pages.flatMap(page => page.items.map(row => row.id));
const listingsFor = (manifest, accountId) => manifest.listings
  .filter(row => accountId ? row.sellerAccount === accountId : row.status === 'active')
  .sort((a, b) => b.seq - a.seq);
const historyFor = (manifest, characterId, role = 'all') => manifest.history
  .filter(row => row.characterId === characterId && (role === 'all' || row.role === role))
  .sort((a, b) => b.settledAt - a.settledAt || b.ledgerId - a.ledgerId);

test('isolated fixture retains real account-mine / character-history ownership and exact 30/31/65 boundaries', async t => {
  const f = await setup(t), state = exchangeQaState(f.env, f.seed), p = f.seed.realms.permanent;
  assert.equal(listingsFor(p).length, 65);
  assert.equal(listingsFor(p, '90101').length, 65);
  assert.equal(p.listings.filter(row => row.status === 'active' && row.category === 'equipment').length, 30);
  assert.equal(p.listings.filter(row => row.status === 'active' && row.category === 'scroll').length, 31);
  assert.equal(historyFor(p, p.mainCharacterId).length, 61);
  assert.equal(historyFor(p, p.mainCharacterId, 'sell').length, 30);
  assert.equal(historyFor(p, p.mainCharacterId, 'buy').length, 31);
  assert.equal(historyFor(p, p.alternateCharacterId).length, 3);
  assert.equal(new Set(p.listings.filter(row => row.status === 'active').map(row => row.createdAt)).size, 1);
  assert.equal(new Set(historyFor(p, p.mainCharacterId).map(row => row.settledAt)).size, 1);
  for (const realm of Object.values(f.seed.realms)) {
    const activeByAccount = new Map();
    for (const row of realm.listings.filter(row => row.status === 'active'))
      activeByAccount.set(row.sellerAccount, (activeByAccount.get(row.sellerAccount) || 0) + 1);
    assert([...activeByAccount.values()].every(count => count <= 20), 'seed respects original maxActive per account');
    assert.equal(new Set(realm.listings.map(row => row.id)).size, realm.listings.length);
    assert(realm.listings.every(row => /^[0-9a-f-]{36}$/.test(row.id) && row.fee === Math.ceil(row.price / 20)));
  }
  const permanentIds = new Set(p.listings.map(row => row.id));
  assert(f.seed.realms.season_2026_01.listings.every(row => !permanentIds.has(row.id)));
  assert.equal(listingsFor(f.seed.realms.season_2026_01).length, 31);
  assert.equal(f.seed.realms.season_2026_01.alternateCharacterId, null);
  assert.equal(listingsFor(f.seed.realms.season_2026_01, '90101').length, 31);
  assert.equal(historyFor(f.seed.realms.season_2026_01, f.seed.realms.season_2026_01.mainCharacterId).length, 31);
  assert(p.listings.filter(row => row.kind === 'equip').every(row => ['common','advanced'].includes(row.quality)));
  assert.equal(state.characters.find(c => c.realmId === 'permanent' && c.baseClass === 'mage').counts.all, 0);
  assert.deepEqual(exchangeQaState(f.env, f.seed).databases, state.databases, 'state observation is pure');
  await assert.rejects(seedExchangeQa(f.env, NOW), /reseeding is forbidden/);
  assert.deepEqual(exchangeQaState(f.env, f.seed).databases, state.databases, 'reseed rejection is pure');
});

test('real exchange projections match independently seeded order across every fixture scope without any writes', async t => {
  const f = await setup(t), state = exchangeQaState(f.env, f.seed);
  for (const realmId of ['permanent', 'season_2026_01']) {
    const manifest = f.seed.realms[realmId];
    const characters = state.characters.filter(c => c.realmId === realmId &&
      (c.accountId === '90101' || c.accountId === '90201'));
    for (const character of characters) {
      const scoped = scopeEnvForRealm(f.env, await resolveRealm(f.env, realmId));
      await selectAccountCharacter(scoped, character.accountId, character.characterId, NOW);
      const before = exchangeQaState(f.env, f.seed).databases;
      const browse = await readPages(f, character, 'browse');
      assert.deepEqual(ids(browse), listingsFor(manifest).map(row => row.id));
      const mine = await readPages(f, character, 'mine');
      assert.deepEqual(ids(mine), listingsFor(manifest, character.accountId).map(row => row.id));
      assert(mine.flatMap(page => page.items).every(row => row.ownedByMe));
      for (const role of ['all', 'buy', 'sell']) {
        const pages = await readPages(f, character, 'history', { role });
        const expected = historyFor(manifest, character.characterId, role);
        assert.deepEqual(ids(pages), expected.map(row => row.id), 'same-time history uses ledger ID descending');
        for (const [index, row] of pages.flatMap(page => page.items).entries()) {
          const sample = expected[index];
          assert.equal(row.listingId, sample.listingId);
          assert.equal(row.goldDelta, sample.goldDelta);
          assert.equal(row.price, sample.price);
          assert.equal(row.qty, sample.qty);
          assert.equal(row.role, sample.role);
          assert.equal(row.item.snapshotAvailable, sample.snapshotAvailable);
          if (row.role === 'sell') { assert.equal(row.fee, sample.fee); assert.equal(row.netGold, sample.price - sample.fee); }
          else { assert.equal(row.paidGold, sample.price); assert.equal(row.feePaidBy, 'seller'); }
          assert(!JSON.stringify(row).includes('EXCHANGE_QA_PRIVATE_NOTE_MUST_NOT_RENDER'));
        }
      }
      assert.deepEqual(exchangeQaState(f.env, f.seed).databases, before,
        'all rows, schema, sqlite_sequence and total_changes remain unchanged for ' + realmId + '/' + character.characterId);
    }
  }
});

test('equipment 30, scroll 31, combined 65 and empty filters use their original read cursor boundaries', async t => {
  const f = await setup(t), manifest = f.seed.realms.permanent;
  const character = exchangeQaState(f.env, f.seed).characters.find(c => c.characterId === manifest.mainCharacterId && c.realmId === 'permanent');
  const scoped = scopeEnvForRealm(f.env, await resolveRealm(f.env, 'permanent'));
  await selectAccountCharacter(scoped, character.accountId, character.characterId, NOW);
  const before = exchangeQaState(f.env, f.seed).databases;
  for (const [filters, lengths] of [[{}, [30,30,5]], [{ category: 'equipment' }, [30]], [{ category: 'scroll' }, [30,1]], [{ tier: 12 }, [0]]]) {
    const pages = await readPages(f, character, 'browse', { filters });
    assert.deepEqual(pages.map(page => page.items.length), lengths);
    assert.equal(pages.at(-1).nextCursor, null);
    const expected = listingsFor(manifest).filter(row =>
      (!filters.category || row.category === filters.category) && (!filters.tier || row.tier === filters.tier));
    assert.deepEqual(ids(pages), expected.map(row => row.id));
  }
  assert.deepEqual(exchangeQaState(f.env, f.seed).databases, before);
});

test('fixture refuses non-development or non-isolated database handles before seeding', async t => {
  const env = await initialized(t);
  await assert.rejects(seedExchangeQa(env, NOW), /isolated development/);
  await assert.rejects(seedExchangeQa({ ...env, ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', DB_SEASON: env.DB }, NOW), /isolated development/);
});

test('exchange preview startup schedules no sweeps and enforces the read/setup and CORS boundary before handlers', () => {
  // A fresh child imports the real launcher with only its HTTP listener replaced.
  // No socket is opened. Count actual timer registrations, then exercise its real request handler.
  const input = String.raw`
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
const scheduled = [];
globalThis.setInterval = (fn, delay) => { scheduled.push(delay); return { unref() {} }; };
let handler;
http.createServer = fn => {
  handler = fn;
  const server = { on() { return server; }, listen(port, host, callback) {
    assert.equal(port, 9862); assert.equal(host, '127.0.0.1'); callback(); return server;
  }, closeAllConnections() {}, close(callback) { callback(); } };
  return server;
};
process.argv = [process.execPath, 'atlas-local-preview.mjs', '--port=9862', '--preview-origin=http://127.0.0.1:9863'];
await import('./worker/tools/atlas-local-preview.mjs');
assert.deepEqual(scheduled, [], 'exchange mode must not register Atlas/workshop/party timers');
async function request(url, method = 'GET', body = null, origin) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === null ? [] : [JSON.stringify(body)]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', 'x-dev-tg-id': '90101', 'x-realm-id': 'permanent', ...(origin ? { origin } : {}) } });
    const headers = {};
    let status;
    const res = { setHeader(key, value) { headers[key.toLowerCase()] = value; },
      writeHead(code, values = {}) { status = code; for (const [key, value] of Object.entries(values)) headers[key.toLowerCase()] = value; },
      end(data = '') { resolve({ status, headers, text: String(data) }); } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
const health = JSON.parse((await request('/__preview/health')).text);
assert.equal(health.exchangeQa, true);
assert.deepEqual(health.exchangeQaPolicy.backgroundTimersDisabled, { atlas: true, workshop: true, party: true });
assert.deepEqual(health.exchangeQaPolicy.actions.filter(action => /create|buy|cancel|send|settle|dispatch|trade\/|^me$/.test(action)), []);
const before = JSON.parse((await request('/__preview/exchange-state')).text);
assert.equal(before.seed.realms.season_2026_01.alternateCharacterId, null);
for (const action of ['exchange/create','exchange/buy','exchange/cancel','trade/list','trade/requests','me','atlas/settle','chat/send','behavior','dispatch','native','outbox/send']) {
  for (const origin of [undefined, 'http://127.0.0.1:9863']) {
    const response = await request('/app/api/' + action, 'POST', {}, origin);
    assert.equal(response.status, 403, action);
    assert.equal(JSON.parse(response.text).error, 'exchange_preview_read_only');
  }
}
const options = await request('/app/api/exchange/scene', 'OPTIONS', null, 'http://127.0.0.1:9863');
assert.equal(options.status, 204);
assert.equal(options.headers['access-control-allow-origin'], 'http://127.0.0.1:9863');
const wrongOrigin = await request('/app/api/exchange/scene', 'POST', {}, 'http://127.0.0.1:9999');
assert.equal(wrongOrigin.status, 403);
const query = { realmId: 'permanent', selectedCharacterId: before.seed.realms.permanent.mainCharacterId,
  contextEpoch: 0, tab: 'browse', cursor: null, filters: {} };
const response = await request('/app/api/exchange/scene', 'POST', query, 'http://127.0.0.1:9863');
assert.equal(response.status, 200, response.text);
assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:9863');
const data = JSON.parse(response.text);
assert.equal(data.items.length, 30); assert.equal(data.pageSize, 30);
const after = JSON.parse((await request('/__preview/exchange-state')).text);
assert.deepEqual(after.databases, before.databases, 'successful reads and denied requests cannot mutate either SQLite database');
console.log(JSON.stringify({ test: 'preview-boundary', pid: process.pid, socketsOpened: 0, timersScheduled: scheduled,
  rejectedActions: 12, corsOptionsStatus: options.status, corsReadStatus: response.status,
  season: { alternate: null, browse: before.seed.realms.season_2026_01.listings.filter(row => row.status === 'active').length,
    mine: before.seed.realms.season_2026_01.listings.filter(row => row.sellerAccount === '90101').length } }));
process.emit('SIGTERM');
`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)), input, encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, RPG_EXCHANGE_QA: '1', RPG_LEDGER_QA: '1', RPG_SKILL_CAREER_QA: '1',
      RPG_PARTY_QA: '0', RPG_TOWER_QA: '0', RPG_BOSS_QA: '0', RPG_STAR_RING_QA: '0', RPG_GUARDIAN_QA: '0', RPG_FATE_QA: '0', RPG_FATE_PRIVATE_QA: '0' }
  });
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  assert.equal(child.signal, null); assert.equal(child.error, undefined);
  console.log(child.stdout.trim().split('\n').at(-1));
});
