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

const SEASON = 'season_2026_01';
const BOT = 'ledger-contract-synthetic-bot-token';
const SECRET = 'ledger-contract-synthetic-service-secret';
const pin = (selectedCharacterId = '111', extra = {}) =>
  ({ realmId: 'permanent', selectedCharacterId, contextEpoch: 7, category: 'all', ...extra });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function initData(account, token = BOT) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(account), first_name: 'LedgerContract' }) });
  const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return params.toString();
}

async function fixture(t, { realms = false } = {}) {
  const env = realms ? await initialized(t) : { DB: freshDb() };
  if (!realms) t.after(() => env.DB.sqlite.close());
  Object.assign(env, { ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'false', ALLOW_DEBUG_TIME: 'true', BOT_TOKEN: BOT, SERVICE_SECRET: SECRET });
  const dbs = { permanent: env.DB, ...(realms ? { [SEASON]: env.DB_SEASON } : {}) };
  let alternate;
  for (const [realm, db] of Object.entries(dbs)) {
    const scoped = realms ? scopeEnvForRealm(env, await resolveRealm(env, realm)) : env;
    for (const tgId of ['111', '222'])
      await createCharacter(scoped, { tgId, name: '旅人' + tgId, gender: 'f', baseClass: 'sword' }, NOW);
    if (realm === 'permanent')
      alternate = (await createCharacter(scoped, { tgId: '111', name: '另一旅人', gender: 'f', baseClass: 'mage' }, NOW)).char.tg_id;
    await selectAccountCharacter(scoped, '111', '111', NOW);
    // Fixture-only setup. Old idle time would expose any accidental settle/me call.
    db.sqlite.prepare("UPDATE rpg_characters SET last_settle_at=?,idle_state='fighting'").run(NOW - 3600000);
    db.sqlite.exec('DELETE FROM rpg_ledger');
  }
  return { env, dbs, alternate };
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
  assert.deepEqual(snapshot(f), before, 'all database rows/schema and total_changes must remain unchanged');
}
function put(f, { owner = '111', realm = 'permanent', type = '契約入帳', gold = 0, item = null, itemDelta = 0, exp = 0, note = '', time = NOW } = {}) {
  const result = f.dbs[realm].sqlite.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('ledger-contract:' + crypto.randomUUID(), owner, type, gold, item, itemDelta, exp, note, time);
  return { id: 'ledger:' + result.lastInsertRowid, time, gold, item, itemDelta, exp };
}
async function request(f, { mode = 'app', account = '111', body = pin(), realm = 'permanent', path = 'ledger/history', auth = 'valid', raw } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Debug-Now': String(NOW + 3600000) };
  if (realm !== null) headers['X-Realm-Id'] = realm;
  if (mode === 'service' && auth !== 'none') headers['X-Service-Secret'] = auth === 'valid' ? SECRET : 'incorrect-synthetic-service-secret';
  if (mode === 'app' && auth === 'valid') headers['X-Telegram-Init-Data'] = initData(account);
  if (mode === 'app' && auth === 'wrong') headers['X-Telegram-Init-Data'] = initData(account, 'wrong-synthetic-bot-token');
  if (mode === 'app' && auth === 'dev-spoof') headers['X-Dev-Tg-Id'] = account;
  const payload = mode === 'service' ? { ...body, tgId: account } : body;
  const response = await handle(new CurrentClientRequest('http://local/' + (mode === 'app' ? 'app/api/' : 'rpg/') + path,
    { method: 'POST', headers, body: raw ?? JSON.stringify(payload) }), f.env);
  return { status: response.status, ...await response.json() };
}
function ok(result) { assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.ok, true); return result; }
function bad(result, error, status = 400) {
  assert.equal(result.status, status, JSON.stringify(result)); assert.equal(result.error, error);
  assert.equal(Object.hasOwn(result, 'entries'), false);
}

test('real signed MiniApp and authenticated service bind the account, ignore identity spoofing and read without any database writes', async t => {
  const f = await fixture(t), own = put(f, { gold: 15 }), foreign = put(f, { owner: '222', note: 'FOREIGN_ACCOUNT_ONLY', gold: 900 });
  const before = snapshot(f);
  const app = ok(await request(f, { body: pin('111', { tgId: '222', accountId: '222', characterId: '222', namespace: 'service' }) }));
  const service = ok(await request(f, { mode: 'service' }));
  for (const result of [app, service]) {
    assert.equal(result.accountId, '111'); assert.equal(result.characterId, '111'); assert.equal(result.realmId, 'permanent');
    assert.equal(result.contextEpoch, 7); assert.equal(result.serverNow, NOW + 3600000);
    assert.deepEqual(result.entries.map(row => row.id), [own.id]);
    assert.doesNotMatch(JSON.stringify(result), new RegExp('FOREIGN_ACCOUNT_ONLY|' + foreign.id));
  }
  for (const auth of ['none', 'wrong', 'dev-spoof']) assert.equal((await request(f, { auth })).status, 401);
  for (const auth of ['none', 'wrong']) assert.equal((await request(f, { mode: 'service', auth })).status, 401);
  unchanged(f, before);
});

test('both API surfaces require explicit realm/selected pins and isolate alternate and foreign characters', async t => {
  const f = await fixture(t);
  put(f, { note: 'MAIN_ONLY' }); const alt = put(f, { owner: f.alternate, note: 'ALTERNATE_ONLY', gold: 5 });
  put(f, { owner: '222', note: 'FOREIGN_ONLY' });
  const before = snapshot(f);
  for (const mode of ['app', 'service']) {
    bad(await request(f, { mode, realm: null }), 'realm_required');
    bad(await request(f, { mode, body: pin('111', { realmId: undefined }) }), 'realm_required');
    bad(await request(f, { mode, body: pin(undefined, { selectedCharacterId: undefined }) }), 'selected_character_required');
    bad(await request(f, { mode, body: pin('222') }), 'character_changed', 409);
    bad(await request(f, { mode, body: pin('111', { realmId: SEASON }) }), 'realm_mismatch', 409);
    bad(await request(f, { mode, account: '444', body: pin('444') }), 'no_character', 404);
  }
  unchanged(f, before);
  await selectAccountCharacter(f.env, '111', f.alternate, NOW);
  const selected = snapshot(f);
  for (const mode of ['app', 'service']) {
    bad(await request(f, { mode, body: pin('111') }), 'character_changed', 409);
    const current = ok(await request(f, { mode, body: pin(f.alternate) }));
    assert.equal(current.accountId, '111'); assert.equal(current.characterId, f.alternate);
    assert.deepEqual(current.entries.map(row => row.id), [alt.id]);
  }
  unchanged(f, selected);
});

test('real permanent and season databases stay isolated and frozen-season history remains SELECT-only', async t => {
  const f = await fixture(t, { realms: true });
  put(f, { note: 'PERMANENT_ONLY', gold: 11 });
  put(f, { realm: SEASON, note: 'SEASON_ONLY', gold: -22 });
  const before = snapshot(f);
  for (const mode of ['app', 'service']) {
    const permanent = ok(await request(f, { mode }));
    const season = ok(await request(f, { mode, realm: SEASON, body: pin('111', { realmId: SEASON }) }));
    assert.equal(permanent.entries[0].goldDelta, 11); assert.equal(season.entries[0].goldDelta, -22);
    assert.equal(season.realmId, SEASON); assert.doesNotMatch(JSON.stringify(season), /PERMANENT_ONLY/);
    bad(await request(f, { mode, realm: 'season_unknown', body: pin('111', { realmId: 'season_unknown' }) }), 'realm_unknown', 404);
  }
  unchanged(f, before);
  await transitionRealmPhase(f.env, SEASON, { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: NOW + 1000, now: NOW + 1000 });
  const frozen = snapshot(f);
  for (const mode of ['app', 'service'])
    assert.equal(ok(await request(f, { mode, realm: SEASON, body: pin('111', { realmId: SEASON }) })).entries[0].goldDelta, -22);
  unchanged(f, frozen);
});

test('30-row keyset pages preserve 65 same-millisecond records when newer and tied arrivals are inserted between pages', async t => {
  const f = await fixture(t), expected = [];
  for (let n = 0; n < 65; n++) expected.push(put(f, { gold: n + 1, time: NOW }).id);
  const initial = snapshot(f), first = ok(await request(f));
  assert.equal(first.pageSize, 30); assert.equal(first.entries.length, 30); assert.ok(first.nextCursor);
  unchanged(f, initial);
  const newer = put(f, { gold: 999, time: NOW + 100 }), tied = put(f, { gold: 888, time: NOW });
  const afterArrivals = snapshot(f);
  const second = ok(await request(f, { body: pin('111', { cursor: first.nextCursor }) }));
  const third = ok(await request(f, { body: pin('111', { cursor: second.nextCursor }) }));
  assert.equal(second.entries.length, 30); assert.equal(third.entries.length, 5); assert.equal(third.nextCursor, null);
  const seen = [...first.entries, ...second.entries, ...third.entries].map(row => row.id);
  assert.deepEqual(seen, expected.reverse()); assert.equal(new Set(seen).size, 65);
  const refreshed = ok(await request(f));
  assert.deepEqual(refreshed.entries.slice(0, 2).map(row => row.id), [newer.id, tied.id]);
  unchanged(f, afterArrivals);
});

test('categories retain signed gold/item/EXP deltas, zero entries and safe names for known, retired and prototype-key items', async t => {
  const f = await fixture(t), rows = [
    put(f, { gold: 12, item: 'scroll_w', itemDelta: 3, exp: 40 }),
    put(f, { gold: -7, item: 'scroll_w', itemDelta: -2, exp: -9 }),
    put(f, { item: 'constructor', itemDelta: 1 }),
    put(f, { item: 'retired_unknown_item', itemDelta: -4 }),
    put(f, { exp: -3 }), put(f, { note: '沒有數值變更的已入帳事件' }),
  ];
  const before = snapshot(f), all = ok(await request(f));
  assert.deepEqual(all.entries.map(row => row.id), rows.map(row => row.id).reverse());
  for (const row of rows) {
    const projected = all.entries.find(entry => entry.id === row.id);
    assert.equal(projected.goldDelta, row.gold); assert.equal(projected.itemDelta, row.itemDelta); assert.equal(projected.expDelta, row.exp);
  }
  assert.equal(all.entries.find(row => row.item === 'scroll_w').itemName, '武器強化捲');
  for (const item of ['constructor', 'retired_unknown_item'])
    assert.equal(all.entries.find(row => row.item === item).itemName, '其他道具');
  for (const [category, field] of [['gold', 'gold'], ['items', 'itemDelta'], ['experience', 'exp']]) {
    const page = ok(await request(f, { body: pin('111', { category }) }));
    assert.deepEqual(page.entries.map(row => row.id), rows.filter(row => row[field] !== 0).map(row => row.id).reverse());
  }
  unchanged(f, before);
});

test('cursors are isolated by account, character, realm, category and epoch; hostile filters cannot expand or mutate history', async t => {
  const f = await fixture(t, { realms: true });
  for (let n = 0; n < 32; n++) put(f, { gold: n + 1 });
  const first = ok(await request(f)), cursor = first.nextCursor, before = snapshot(f);
  assert.ok(cursor);
  for (const options of [
    { account: '222', body: pin('222', { cursor }) },
    { realm: SEASON, body: pin('111', { realmId: SEASON, cursor }) },
    { body: pin('111', { category: 'gold', cursor }) },
    { body: pin('111', { contextEpoch: 8, cursor }) },
  ]) bad(await request(f, options), 'ledger_cursor');
  const encoded = value => 'lh1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
  const scope = ['111', 'permanent', '111', 'all', 7];
  for (const value of [{}, '0:0', "1;DELETE FROM rpg_ledger", 'lh1.' + 'a'.repeat(641), 'lh1._w',
    encoded({ private: 'not-an-array' }), encoded([...scope, -1, 1]), encoded([...scope, NOW, 0]), encoded([...scope, NOW, 1.5]), encoded([...scope, NOW, Number.MAX_SAFE_INTEGER + 1])])
    bad(await request(f, { body: pin('111', { cursor: value }) }), 'ledger_cursor');
  for (const category of [[], {}, '__proto__', "gold') OR 1=1 --"])
    bad(await request(f, { body: pin('111', { category }) }), 'ledger_filters');
  for (const contextEpoch of [undefined, null, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1])
    bad(await request(f, { body: pin('111', { contextEpoch }) }), 'ledger_context');
  bad(await request(f, { raw: '{' }), 'bad_json');
  const bounded = ok(await request(f, { body: pin('111', { limit: 999999, pageSize: 999999, offset: 'UNION SELECT', sort: 'tg_id' }) }));
  assert.equal(bounded.entries.length, 30); assert.equal(bounded.pageSize, 30);
  unchanged(f, before);
  const scoped = scopeEnvForRealm(f.env, await resolveRealm(f.env, 'permanent'));
  await selectAccountCharacter(scoped, '111', f.alternate, NOW);
  const switched = snapshot(f);
  bad(await request(f, { body: pin(f.alternate, { cursor }) }), 'ledger_cursor');
  unchanged(f, switched);
});

test('typed, structured and malformed JSON notes expose only display summaries, never private receipts or internal row keys', async t => {
  const f = await fixture(t);
  for (const [type, note] of [
    ['原操作收據', 'PRIVATE_TYPED_PLAINTEXT'],
    ['系統事件', '{"requestId":"PRIVATE_REQUEST","birth":"PRIVATE_BIRTH"}'],
    ['系統事件', ' \n {"private":"PRIVATE_BROKEN_OBJECT"'],
    ['系統事件', '["PRIVATE_BROKEN_ARRAY"'],
    ['系統事件', '"PRIVATE_BROKEN_STRING'],
    ['系統事件', '"PRIVATE_JSON_STRING"'],
  ]) put(f, { type, note });
  const ordinary = put(f, { type: '一般入帳', note: '正常說明\n控制字元\u0001保留安全文字' });
  const before = snapshot(f), result = ok(await request(f));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|requestId|event_id|account_tg_id|signature|birth/);
  for (const entry of result.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'createdAt', 'type', 'goldDelta', 'item', 'itemName', 'itemDelta', 'expDelta', 'summary'].sort());
    assert.equal(Object.hasOwn(entry, 'note'), false);
    assert.doesNotMatch(entry.summary, /[\u0000-\u001f\u007f]/);
    if (entry.id !== ordinary.id) assert.equal(entry.summary, '操作細節請至對應功能查看。');
  }
  assert.match(result.entries.find(row => row.id === ordinary.id).summary, /正常說明.*保留安全文字/);
  unchanged(f, before);
});

test('selection or revision changing during the real ledger query rejects the stale response without extra writes', async t => {
  for (const change of ['selection', 'revision']) await t.test(change, async t => {
    const f = await fixture(t); put(f, { gold: 88 });
    const db = f.env.DB, prepare = db.prepare.bind(db); let fired = false, expected;
    db.prepare = sql => {
      const stmt = prepare(sql), bind = stmt.bind.bind(stmt);
      stmt.bind = (...params) => {
        const bound = bind(...params);
        if (sql.includes('FROM rpg_ledger INDEXED BY idx_rpg_ledger_owner')) {
          const all = bound.all.bind(bound);
          bound.all = async () => {
            const result = await all();
            if (!fired) {
              fired = true;
              if (change === 'selection') db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.alternate, '111');
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
    bad(await request(f), 'character_changed', 409);
    assert.equal(fired, true, 'the concurrency change occurred inside the actual ledger SELECT');
    unchanged(f, expected);
  });
});

test('invalid persisted deltas fail closed instead of inventing zero values or leaking malformed record details', async t => {
  const f = await fixture(t);
  put(f, { gold: 1.25, note: '{"private":"PRIVATE_INVALID_ROW"}' });
  const before = snapshot(f), result = await request(f);
  bad(result, 'ledger_data', 500); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_INVALID_ROW|rpg_ledger|SELECT|SyntaxError/);
  unchanged(f, before);
});

test('the original ledger endpoints retain their 15-row snake_case contract and insertion ordering', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 20; n++) put(f, { type: '原紀錄' + n, gold: n - 10, item: 'scroll_w', itemDelta: n % 2 ? -1 : 1, exp: n, note: '原文字' + n, time: NOW - n });
  const expected = f.env.DB.sqlite.prepare('SELECT type,gold_delta,item,item_delta,note,created_at FROM rpg_ledger WHERE tg_id=? ORDER BY id DESC LIMIT 15').all('111').map(row => ({ ...row }));
  const before = snapshot(f);
  for (const mode of ['app', 'service']) {
    const legacy = ok(await request(f, { mode, path: 'ledger', body: {} }));
    assert.equal(legacy.ledger.length, 15); assert.deepEqual(legacy.ledger, expected);
    assert.equal(Object.hasOwn(legacy, 'entries'), false); assert.equal(Object.hasOwn(legacy.ledger[0], 'expDelta'), false);
  }
  const modern = ok(await request(f)); assert.equal(modern.entries.length, 20); assert.equal(modern.entries[0].type, '原紀錄0');
  unchanged(f, before);
});

test('the actual keyset SQL uses the owner index without OFFSET, full-table scan or temporary sorting', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 32; n++) put(f, { gold: n + 1 });
  const prepare = f.env.DB.prepare.bind(f.env.DB), queries = [];
  f.env.DB.prepare = sql => {
    const stmt = prepare(sql), bind = stmt.bind.bind(stmt);
    stmt.bind = (...params) => { if (sql.includes('FROM rpg_ledger INDEXED BY idx_rpg_ledger_owner')) queries.push({ sql, params }); return bind(...params); };
    return stmt;
  };
  t.after(() => { f.env.DB.prepare = prepare; });
  const before = snapshot(f), first = ok(await request(f, { body: pin('111', { category: 'gold' }) }));
  const next = ok(await request(f, { body: pin('111', { category: 'gold', cursor: first.nextCursor }) }));
  assert.equal(next.entries.length, 2); assert.equal(queries.length, 2);
  for (const { sql, params } of queries) {
    const plan = f.env.DB.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map(row => row.detail).join('\n');
    assert.match(plan, /SEARCH rpg_ledger USING INDEX idx_rpg_ledger_owner \(tg_id=\?/);
    assert.doesNotMatch(plan, /SCAN rpg_ledger|TEMP B-TREE/);
    assert.doesNotMatch(sql, /OFFSET|json_extract|rpg_outbox|rpg_behavior_daily/);
    assert.equal(params[0], '111'); assert.ok(params.length === 1 || params.length === 4);
  }
  unchanged(f, before);
});
