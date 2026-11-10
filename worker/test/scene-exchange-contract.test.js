import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { freshDb } from './d1-shim.js';
import { CurrentClientRequest } from './client-request.js';
import { initialized, NOW } from './realm-test-helpers.js';
import { handle } from '../src/index.js';
import { createCharacter } from '../src/services/player.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { resolveRealm, scopeEnvForRealm, transitionRealmPhase } from '../src/realm/index.js';
import * as Exchange from '../src/services/market-exchange.js';
import { history as originalHistory } from '../src/services/market-exchange-history.js';
import { makeGear } from '../src/game/gear.js';
import { SPECIAL_SKILLS } from '../src/game/special.js';

const SEASON = 'season_2026_01';
const BOT = 'exchange-scene-synthetic-bot-token';
const SECRET = 'exchange-scene-synthetic-service-secret';
const DEFAULT_FILTERS = { category: 'all', classReq: 'all', tier: null, quality: 'all', enhanceMin: null, enhanceMax: null };
const pin = (tab = 'browse', extra = {}) => ({ realmId: 'permanent', selectedCharacterId: '111', contextEpoch: 7, tab, ...extra });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function initData(account, token = BOT) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(account), first_name: 'ExchangeContract' }) });
  const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return params.toString();
}
async function fixture(t, { realms = false } = {}) {
  const env = realms ? await initialized(t) : { DB: freshDb() };
  if (!realms) t.after(() => env.DB.sqlite.close());
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'false', ALLOW_DEBUG_TIME: 'true', BOT_TOKEN: BOT, SERVICE_SECRET: SECRET });
  const dbs = { permanent: env.DB, ...(realms ? { [SEASON]: env.DB_SEASON } : {}) }, alternates = {};
  for (const [realm, db] of Object.entries(dbs)) {
    const scoped = realms ? scopeEnvForRealm(env, await resolveRealm(env, realm)) : env;
    for (const tgId of ['111', '222', '333'])
      await createCharacter(scoped, { tgId, name: '旅人' + tgId, gender: 'f', baseClass: 'sword' }, NOW);
    alternates[realm] = (await createCharacter(scoped, { tgId: '111', name: '另一旅人', gender: 'f', baseClass: 'mage' }, NOW)).char.tg_id;
    await selectAccountCharacter(scoped, '111', '111', NOW);
    // Synthetic seed only. Old idle time would expose an accidental settle/me call.
    db.sqlite.prepare("UPDATE rpg_characters SET last_settle_at=?,idle_state='fighting',level=120").run(NOW - 3600000);
    db.sqlite.exec('DELETE FROM rpg_ledger');
  }
  return { env, dbs, alternates };
}
function snapshot(f) {
  return Object.fromEntries(Object.entries(f.dbs).map(([realm, db]) => {
    const sql = db.sqlite;
    const schema = sql.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const tables = sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      .map(({ name }) => [name, sql.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]);
    return [realm, { sha256: digest({ schema, tables }), totalChanges: sql.prepare('SELECT total_changes() AS n').get().n, tableCount: tables.length }];
  }));
}
function unchanged(f, before) {
  assert.deepEqual(snapshot(f), before, 'every database row/schema and total_changes must remain unchanged');
}
function putListing(f, options = {}) {
  const { realm = 'permanent', seller = '222', sellerAccount = seller.startsWith('c') ? '111' : seller,
    buyer = null, status = 'active', kind = 'item', ref = 'scroll_w', qty = kind === 'item' ? 2 : 1,
    price = 101, category = 'scroll', classReq = 'any', tier = null, quality = null, enhance = null,
    time = NOW, itemSnapshot = { item: ref } } = options;
  const id = crypto.randomUUID(), fee = Math.ceil(price / 20), db = f.dbs[realm].sqlite;
  const inserted = db.prepare('INSERT INTO rpg_exchange_listings(id,seller_account,seller_char,buyer_char,kind,ref,qty,price,fee,category,class_req,tier,quality,enhance,snapshot_json,status,created_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, sellerAccount, seller, buyer, kind, ref, qty, price, fee, category, classReq, tier, quality, enhance,
      typeof itemSnapshot === 'string' ? itemSnapshot : JSON.stringify(itemSnapshot), status, time, time, status === 'active' ? null : time);
  return { id, seq: Number(inserted.lastInsertRowid), seller, sellerAccount, buyer, price, fee, qty, time, realm };
}
function putSale(f, options = {}) {
  const row = putListing(f, { buyer: '111', ...options, status: 'sold' }), db = f.dbs[row.realm].sqlite;
  const insert = db.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at) VALUES(?,?,?,?,NULL,0,0,?,?)');
  insert.run('exchange:' + row.id + ':buy', row.buyer, '交易所購買', -row.price, '{"private":"SYNTHETIC_RECEIPT_PRIVATE"}', row.time);
  insert.run('exchange:' + row.id + ':payout', row.seller, '交易所售出入帳', row.price - row.fee, '{"private":"SYNTHETIC_RECEIPT_PRIVATE"}', row.time);
  insert.run('exchange:' + row.id + ':fee', row.seller, '交易所手續費', 0, '{"private":"SYNTHETIC_FEE_PRIVATE"}', row.time);
  return row;
}
async function request(f, { mode = 'app', account = '111', body = pin(), realm = 'permanent', auth = 'valid', raw } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Debug-Now': String(NOW + 3600000) };
  if (realm !== null) headers['X-Realm-Id'] = realm;
  if (mode === 'service' && auth !== 'none') headers['X-Service-Secret'] = auth === 'valid' ? SECRET : 'incorrect-synthetic-service-secret';
  if (mode === 'app' && auth === 'valid') headers['X-Telegram-Init-Data'] = initData(account);
  if (mode === 'app' && auth === 'wrong') headers['X-Telegram-Init-Data'] = initData(account, 'wrong-synthetic-bot-token');
  if (mode === 'app' && auth === 'dev-spoof') headers['X-Dev-Tg-Id'] = account;
  const payload = mode === 'service' ? { ...body, tgId: account } : body;
  const response = await handle(new CurrentClientRequest('http://local/' + (mode === 'app' ? 'app/api/' : 'rpg/') + 'exchange/scene',
    { method: 'POST', headers, body: raw ?? JSON.stringify(payload) }), f.env);
  return { status: response.status, ...await response.json() };
}
function ok(result) {
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 1); assert.equal(result.pageSize, 30);
  return result;
}
function bad(result, error, status = 400) {
  assert.equal(result.status, status, JSON.stringify(result)); assert.equal(result.error, error, JSON.stringify(result));
  assert.equal(Object.hasOwn(result, 'items'), false, 'a rejected page must not be returned');
}

test('real signed MiniApp and service bind their authenticated account and all three reads leave every table unchanged', async t => {
  const f = await fixture(t), own = putListing(f, { seller: '111' }), other = putListing(f);
  const bought = putSale(f), sold = putSale(f, { seller: '111', buyer: '222' }), before = snapshot(f);
  for (const mode of ['app', 'service']) for (const tab of ['browse', 'mine', 'history']) {
    const result = ok(await request(f, { mode, body: pin(tab, { tgId: '222', accountId: '222', characterId: '222', action: 'buy', listingId: other.id }) }));
    assert.equal(result.accountId, '111'); assert.equal(result.characterId, '111'); assert.equal(result.realmId, 'permanent');
    assert.equal(result.contextEpoch, 7); assert.equal(result.serverNow, NOW + 3600000); assert.ok(Number.isSafeInteger(result.revision));
    assert.equal(result.tab, tab);
    if (tab === 'browse') { assert.deepEqual(new Set(result.items.map(row => row.id)), new Set([own.id, other.id])); assert.deepEqual(result.filters, DEFAULT_FILTERS); }
    if (tab === 'mine') { assert.deepEqual(new Set(result.items.map(row => row.id)), new Set([own.id, sold.id])); assert.equal(result.filters, null); }
    if (tab === 'history') {
      assert.deepEqual(new Set(result.items.map(row => row.listingId)), new Set([bought.id, sold.id]));
      assert.equal(result.role, 'all'); assert.equal(result.meta, null); assert.equal(result.filters, null);
    } else { assert.equal(result.role, null); assert.equal(result.meta.pageSize, 30); }
  }
  for (const auth of ['none', 'wrong', 'dev-spoof']) assert.equal((await request(f, { auth })).status, 401);
  for (const auth of ['none', 'wrong']) assert.equal((await request(f, { mode: 'service', auth })).status, 401);
  unchanged(f, before);
});

test('both API surfaces require explicit matching header/body realm and selected character pins', async t => {
  const f = await fixture(t); putListing(f); const before = snapshot(f);
  for (const mode of ['app', 'service']) {
    bad(await request(f, { mode, realm: null }), 'realm_required');
    bad(await request(f, { mode, body: pin('browse', { realmId: undefined }) }), 'realm_required');
    bad(await request(f, { mode, body: pin('browse', { selectedCharacterId: undefined }) }), 'selected_character_required');
    bad(await request(f, { mode, body: pin('browse', { selectedCharacterId: '222' }) }), 'character_changed', 409);
    bad(await request(f, { mode, body: pin('browse', { realmId: SEASON }) }), 'realm_mismatch', 409);
    bad(await request(f, { mode, account: '444', body: pin('browse', { selectedCharacterId: '444' }) }), 'no_character', 404);
  }
  unchanged(f, before);
});

test('mine keeps account-wide original ownership while history remains limited to the selected character', async t => {
  const f = await fixture(t), alt = f.alternates.permanent;
  const own = putListing(f, { seller: '111' }), sibling = putListing(f, { seller: alt, sellerAccount: '111', status: 'cancelled' });
  const foreign = putListing(f, { seller: '222' }), mainSale = putSale(f, { seller: '222', buyer: '111' });
  const alternateSale = putSale(f, { seller: '222', buyer: alt }), before = snapshot(f);
  const mine = ok(await request(f, { body: pin('mine') }));
  assert.deepEqual(new Set(mine.items.map(row => row.id)), new Set([own.id, sibling.id]));
  assert.ok(mine.items.every(row => row.ownedByMe)); assert.equal(mine.items.some(row => row.id === foreign.id), false);
  assert.deepEqual(ok(await request(f, { body: pin('history') })).items.map(row => row.listingId), [mainSale.id]);
  unchanged(f, before);
  await selectAccountCharacter(f.env, '111', alt, NOW);
  const switched = snapshot(f);
  for (const mode of ['app', 'service']) {
    bad(await request(f, { mode, body: pin('history') }), 'character_changed', 409);
    const history = ok(await request(f, { mode, body: pin('history', { selectedCharacterId: alt }) }));
    assert.equal(history.accountId, '111'); assert.equal(history.characterId, alt);
    assert.deepEqual(history.items.map(row => row.listingId), [alternateSale.id]);
    assert.deepEqual(new Set(ok(await request(f, { mode, body: pin('mine', { selectedCharacterId: alt }) })).items.map(row => row.id)), new Set([own.id, sibling.id]));
  }
  unchanged(f, switched);
});

test('all three original keysets keep 30, 31 and 65 same-time rows without missing or duplicate pages', async t => {
  for (const tab of ['browse', 'mine', 'history']) for (const count of [30, 31, 65]) await t.test(tab + ':' + count, async t => {
    const f = await fixture(t), expected = [];
    for (let n = 0; n < count; n++) {
      const row = tab === 'history' ? putSale(f, { price: n + 1, time: NOW })
        : putListing(f, { seller: tab === 'mine' ? '111' : '222', price: n + 1, time: NOW });
      expected.push(tab === 'history' ? 'exchange:' + row.id + ':buy' : row.id);
    }
    const before = snapshot(f), seen = []; let cursor = null, first, pages = 0;
    do {
      const result = ok(await request(f, { mode: pages % 2 ? 'service' : 'app', body: pin(tab, { cursor }) }));
      first ||= result; pages++; assert.ok(pages <= 3); assert.ok(result.items.length > 0 && result.items.length <= 30);
      seen.push(...result.items.map(row => row.id)); cursor = result.nextCursor;
    } while (cursor !== null);
    assert.equal(pages, Math.ceil(count / 30)); assert.deepEqual(seen, expected.reverse()); assert.equal(new Set(seen).size, count);
    assert.deepEqual(ok(await request(f, { body: pin(tab) })).items, first.items, 'returning to the first page reuses the same original query');
    unchanged(f, before);
  });
});

test('newer and equal-time arrivals between pages do not shift the original sequence or history keysets', async t => {
  for (const tab of ['browse', 'history']) await t.test(tab, async t => {
    const f = await fixture(t), rows = [];
    for (let n = 0; n < 65; n++) rows.push(tab === 'history' ? putSale(f) : putListing(f));
    const firstBefore = snapshot(f), first = ok(await request(f, { body: pin(tab) })); unchanged(f, firstBefore);
    const newer = tab === 'history' ? putSale(f, { time: NOW + 100 }) : putListing(f, { time: NOW + 100 });
    const tied = tab === 'history' ? putSale(f) : putListing(f), afterArrivals = snapshot(f);
    const second = ok(await request(f, { body: pin(tab, { cursor: first.nextCursor }) }));
    const third = ok(await request(f, { body: pin(tab, { cursor: second.nextCursor }) }));
    const ids = [...first.items, ...second.items, ...third.items].map(row => tab === 'history' ? row.listingId : row.id);
    assert.deepEqual(ids, rows.map(row => row.id).reverse()); assert.equal(third.items.length, 5); assert.equal(third.nextCursor, null);
    const refreshed = ok(await request(f, { body: pin(tab) }));
    assert.deepEqual(refreshed.items.slice(0, 2).map(row => tab === 'history' ? row.listingId : row.id),
      tab === 'history' ? [newer.id, tied.id] : [tied.id, newer.id]);
    unchanged(f, afterArrivals);
  });
});

test('the adapter preserves original normalized filters, equipment/guardian/book projections and market metadata', async t => {
  const f = await fixture(t);
  const gear = makeGear({ id: 'scene-contract-gear', tgId: '222', cls: 'sword', slot: 'helmet', tier: 4, forceRarity: 'epic', rng: () => .5, now: NOW });
  gear.enhance_level = 7;
  putListing(f, { kind: 'equip', ref: gear.id, category: 'equipment', classReq: gear.class_req, tier: 4, quality: 'epic', enhance: 7, itemSnapshot: gear });
  const guardian = { id: 'scene-contract-guardian', char_id: '222', type: 'magic', quality: 6, bound: 0, active: 0, locked: 0, rev: 2, created_at: NOW };
  putListing(f, { kind: 'guardian', ref: guardian.id, category: 'guardian', classReq: 'mage', quality: 'gold', itemSnapshot: guardian });
  putListing(f); putListing(f, { ref: 'hunt_4_core', category: 'collection' });
  const skill = SPECIAL_SKILLS.find(row => row.level === 120) || SPECIAL_SKILLS.at(-1);
  putListing(f, { ref: 'book_' + skill.id, category: 'skillbook', quality: skill.rarity, classReq: skill.base || 'any' });
  const before = snapshot(f);
  for (const filters of [{}, { category: 'equipment', tier: 4, enhanceMin: 7, enhanceMax: 7 },
    { category: 'guardian', quality: 'gold', classReq: 'mage' }, { category: 'collection' }, { category: 'skillbook' }, { classReq: 'thief' }]) {
    const legacy = await Exchange.list(f.env, '111', { filters }), current = ok(await request(f, { body: pin('browse', { filters }) }));
    assert.deepEqual(current.items, clone(legacy.items)); assert.deepEqual(current.filters, legacy.filters); assert.deepEqual(current.meta, clone(legacy.meta));
  }
  unchanged(f, before);
});

test('history retains only the original immutable public snapshot and committed debit/fee values', async t => {
  const f = await fixture(t), gear = makeGear({ id: 'scene-history-belt', tgId: '222', cls: 'sword', slot: 'belt', tier: 4, forceRarity: 'epic', rng: () => .5, now: NOW });
  const bought = putSale(f, { kind: 'equip', ref: gear.id, category: 'equipment', classReq: gear.class_req, tier: 4, quality: 'epic', enhance: 0, itemSnapshot: gear });
  const sold = putSale(f, { seller: '111', buyer: '222', qty: 7, price: 101 }), before = snapshot(f);
  for (const role of ['all', 'buy', 'sell']) {
    const current = ok(await request(f, { body: pin('history', { role }) })), legacy = await originalHistory(f.env, '111', { characterId: '111', role });
    assert.deepEqual(current.items, clone(legacy.items)); assert.equal(current.role, role);
    assert.doesNotMatch(JSON.stringify(current), /SYNTHETIC_.*PRIVATE|snapshot_json|seller_account|payload_json/);
  }
  const all = ok(await request(f, { body: pin('history') })).items;
  const b = all.find(row => row.listingId === bought.id), s = all.find(row => row.listingId === sold.id);
  assert.equal(b.paidGold, 101); assert.equal(b.goldDelta, -101); assert.equal(b.feePaidBy, 'seller');
  assert.equal(b.item.equipment.stat, gear.base_stat); assert.equal(b.item.equipment.elemStat, gear.element_stat);
  assert.match(b.item.equipment.statName, /^基礎 /);
  assert.equal(s.price, 101); assert.equal(s.fee, 6); assert.equal(s.netGold, 95); assert.equal(s.qty, 7);
  unchanged(f, before);
});

test('opaque cursors bind account, realm, character, epoch, tab and the original normalized filter or history role', async t => {
  const f = await fixture(t, { realms: true });
  for (let n = 0; n < 31; n++) { putListing(f, { seller: '111' }); putSale(f); }
  const first = {};
  for (const tab of ['browse', 'mine', 'history']) first[tab] = ok(await request(f, { body: pin(tab) }));
  const before = snapshot(f);
  for (const tab of ['browse', 'mine', 'history']) {
    const cursor = first[tab].nextCursor; assert.equal(typeof cursor, 'string'); assert.ok(cursor);
    for (const options of [
      { account: '222', body: pin(tab, { selectedCharacterId: '222', cursor }) },
      { realm: SEASON, body: pin(tab, { realmId: SEASON, cursor }) },
      { body: pin(tab, { contextEpoch: 8, cursor }) },
      { body: pin(tab === 'browse' ? 'mine' : 'browse', { cursor }) },
    ]) bad(await request(f, options), 'exchange_cursor');
    for (const value of [{}, '31', NOW + ':1', "1;DELETE FROM rpg_exchange_listings", 'xs1.' + 'a'.repeat(1601), 'xs1._w', 'xs1.' + Buffer.from('{}').toString('base64url')])
      bad(await request(f, { body: pin(tab, { cursor: value }) }), 'exchange_cursor');
  }
  bad(await request(f, { body: pin('browse', { cursor: first.browse.nextCursor, filters: { category: 'scroll' } }) }), 'exchange_cursor');
  bad(await request(f, { body: pin('history', { cursor: first.history.nextCursor, role: 'buy' }) }), 'exchange_cursor');
  unchanged(f, before);
  const scoped = scopeEnvForRealm(f.env, await resolveRealm(f.env, 'permanent'));
  await selectAccountCharacter(scoped, '111', f.alternates.permanent, NOW);
  const switched = snapshot(f);
  for (const tab of ['browse', 'mine', 'history'])
    bad(await request(f, { body: pin(tab, { selectedCharacterId: f.alternates.permanent, cursor: first[tab].nextCursor }) }), 'exchange_cursor');
  unchanged(f, switched);
});

test('hostile or unknown filters, invalid epoch/tab and oversized page requests never dispatch a mutation or return an invalid page', async t => {
  const f = await fixture(t); for (let n = 0; n < 31; n++) putListing(f);
  const before = snapshot(f);
  for (const tab of [undefined, null, '', 'buy', 'sellable', [], {}])
    bad(await request(f, { body: pin('browse', { tab }) }), 'exchange_tab');
  for (const contextEpoch of [undefined, null, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1])
    bad(await request(f, { body: pin('browse', { contextEpoch }) }), 'exchange_context');
  for (const filters of [[], 'all', { unknown: 1 }, JSON.parse('{"__proto__":{"category":"all"}}')])
    bad(await request(f, { body: pin('browse', { filters }) }), 'exchange_filters');
  for (const filters of [{ category: '__proto__' }, { category: [] }, { classReq: {} }, { tier: 0 }, { quality: 'invalid' }, { enhanceMin: 9, enhanceMax: 1 }, { enhanceMax: 16 }])
    bad(await request(f, { body: pin('browse', { filters }) }), 'filters');
  for (const role of ['__proto__', [], {}]) bad(await request(f, { body: pin('history', { role }) }), 'history_filters');
  bad(await request(f, { body: pin('mine', { filters: {} }) }), 'exchange_filters');
  bad(await request(f, { body: pin('browse', { role: 'all' }) }), 'exchange_filters');
  bad(await request(f, { raw: '{' }), 'bad_json');
  const bounded = ok(await request(f, { body: pin('browse', { limit: 999999, pageSize: 999999, offset: 'UNION SELECT', action: 'create', price: 1 }) }));
  assert.equal(bounded.items.length, 30); assert.equal(bounded.pageSize, 30);
  unchanged(f, before);
});

test('selection and revision changing inside each real authority query reject the stale page without extra writes', async t => {
  for (const tab of ['browse', 'mine', 'history']) for (const change of ['selection', 'revision']) await t.test(tab + ':' + change, async t => {
    const f = await fixture(t);
    if (tab === 'history') putSale(f); else putListing(f, { seller: tab === 'mine' ? '111' : '222' });
    const db = f.env.DB, prepare = db.prepare.bind(db); let fired = false, expected;
    db.prepare = sql => {
      const stmt = prepare(sql), bind = stmt.bind.bind(stmt);
      stmt.bind = (...params) => {
        const bound = bind(...params);
        if (sql.includes('FROM rpg_exchange_listings l') || sql.includes('INDEXED BY idx_rpg_ledger_owner')) {
          const all = bound.all.bind(bound);
          bound.all = async () => {
            const result = await all();
            if (!fired) {
              fired = true;
              if (change === 'selection') db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.alternates.permanent, '111');
              else db.sqlite.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=?').run('111');
              expected = snapshot(f);
            }
            return result;
          };
        }
        return bound;
      };
      return stmt;
    };
    t.after(() => { db.prepare = prepare; });
    bad(await request(f, { body: pin(tab) }), 'character_changed', 409);
    assert.equal(fired, true, 'the competing change occurred within the real SELECT');
    unchanged(f, expected);
  });
});

test('permanent and seasonal reads stay isolated and all tabs remain SELECT-only after the season freezes', async t => {
  const f = await fixture(t, { realms: true });
  for (const [realm, price] of [['permanent', 111], [SEASON, 222]]) {
    putListing(f, { realm, seller: '111', price }); putSale(f, { realm, price });
  }
  const before = snapshot(f);
  for (const mode of ['app', 'service']) for (const tab of ['browse', 'mine', 'history']) {
    const permanent = ok(await request(f, { mode, body: pin(tab) }));
    const season = ok(await request(f, { mode, realm: SEASON, body: pin(tab, { realmId: SEASON }) }));
    assert.ok(permanent.items.every(row => row.price === 111));
    assert.ok(season.items.length > 0 && season.items.every(row => row.price === 222)); assert.equal(season.realmId, SEASON);
  }
  for (const mode of ['app', 'service'])
    bad(await request(f, { mode, realm: 'season_unknown', body: pin('browse', { realmId: 'season_unknown' }) }), 'realm_unknown', 404);
  unchanged(f, before);
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW + 1000, now: NOW + 1000 });
  const frozen = snapshot(f);
  for (const mode of ['app', 'service']) for (const tab of ['browse', 'mine', 'history']) {
    const result = ok(await request(f, { mode, realm: SEASON, body: pin(tab, { realmId: SEASON }) }));
    assert.ok(result.items.length > 0 && result.items.every(row => row.price === 222));
  }
  unchanged(f, frozen);
});

test('malformed historical snapshots retain the original safe fallback without exposing raw receipt data', async t => {
  const f = await fixture(t);
  const sale = putSale(f, { itemSnapshot: '{"secret":"SYNTHETIC_BROKEN_PRIVATE"' }), before = snapshot(f);
  const result = ok(await request(f, { body: pin('history') }));
  assert.equal(result.items[0].listingId, sale.id); assert.equal(result.items[0].item.snapshotAvailable, false);
  assert.equal(result.items[0].paidGold, 101);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_BROKEN_PRIVATE|snapshot_json|SyntaxError/);
  unchanged(f, before);
});
