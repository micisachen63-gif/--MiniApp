// Synthetic exchange rows for a NEW disposable local preview only.
// Never use this module with remote D1, a persisted database, or a live account.
import { createHash } from 'node:crypto';
import * as Player from '../src/services/player.js';
import { makeGear } from '../src/game/gear.js';
import { ITEMS } from '../src/game/constants.js';
import { resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';

const ACCOUNT = '90101';
const PEERS = ['90201', '90202', '90203', '90204'];
const REALMS = [['permanent', 'DB'], ['season_2026_01', 'DB_SEASON']];
const PRIVATE_NOTE = 'EXCHANGE_QA_PRIVATE_NOTE_MUST_NOT_RENDER';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (realm, n) => (realm === 'permanent' ? 'e1000000' : 'e2000000') + '-0000-4000-8000-' + String(n).padStart(12, '0');

function snapshot(db) {
  const sql = db.sqlite;
  const schema = sql.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  const tables = sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, sql.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]);
  return { sha256: digest({ schema, tables }), tableCount: tables.length,
    totalChanges: sql.prepare('SELECT total_changes() AS n').get().n,
    listingCount: sql.prepare('SELECT COUNT(*) AS n FROM rpg_exchange_listings').get().n,
    ledgerCount: sql.prepare('SELECT COUNT(*) AS n FROM rpg_ledger').get().n };
}

function listingFactory(db, realmId, now, manifests) {
  const sql = db.sqlite;
  let sequence = 0;
  const insert = sql.prepare('INSERT INTO rpg_exchange_listings(id,seller_account,seller_char,buyer_char,kind,ref,qty,price,fee,category,class_req,tier,quality,enhance,snapshot_json,status,created_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const ledger = sql.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at) VALUES(?,?,?,?,NULL,0,0,?,?)');
  function add(options) {
    const n = ++sequence, id = uuid(realmId, n);
    const { sellerAccount, sellerCharacterId, buyerCharacterId = null, status = 'active',
      kind = 'item', ref = 'scroll_w', qty = kind === 'item' ? 2 : 1, price = 101 + n,
      category = 'scroll', classReq = 'any', tier = null, quality = null, enhance = null,
      itemSnapshot = { item: ref }, displayName = ITEMS[ref]?.name || '合成珍藏', settledAt = now - 120000 } = options;
    const fee = Math.ceil(price / 20);
    const result = insert.run(id, sellerAccount, sellerCharacterId, buyerCharacterId, kind, ref, qty, price, fee,
      category, classReq, tier, quality, enhance, JSON.stringify(itemSnapshot), status, settledAt, settledAt,
      status === 'active' ? null : settledAt);
    const row = { id, seq: Number(result.lastInsertRowid), realmId, sellerAccount, sellerCharacterId,
      buyerCharacterId, kind, ref, qty, price, fee, category, classReq, tier, quality, enhance, status,
      createdAt: settledAt, updatedAt: settledAt, displayName };
    manifests.listings.push(row);
    return row;
  }
  function sale(options) {
    const row = add({ ...options, status: 'sold' });
    for (const role of ['buy', 'sell']) {
      const characterId = role === 'buy' ? row.buyerCharacterId : row.sellerCharacterId;
      const eventId = 'exchange:' + row.id + (role === 'buy' ? ':buy' : ':payout');
      const goldDelta = role === 'buy' ? -row.price : row.price - row.fee;
      const result = ledger.run(eventId, characterId, role === 'buy' ? '交易所購買' : '交易所售出入帳',
        goldDelta, JSON.stringify({ private: PRIVATE_NOTE, sellerAccount: row.sellerAccount }), row.createdAt);
      manifests.history.push({ id: eventId, listingId: row.id, ledgerId: Number(result.lastInsertRowid),
        characterId, role, settledAt: row.createdAt, qty: row.qty, price: row.price, fee: row.fee,
        goldDelta, snapshotAvailable: options.historySnapshotAvailable !== false });
    }
    ledger.run('exchange:' + row.id + ':fee', row.sellerCharacterId, '交易所手續費', 0,
      JSON.stringify({ private: PRIVATE_NOTE }), row.createdAt);
    return row;
  }
  return { add, sale };
}

async function seedRealm(env, realmId, binding, now) {
  const scoped = scopeEnvForRealm(env, await resolveRealm(env, realmId));
  const db = env[binding], sql = db.sqlite;
  const existing = sql.prepare('SELECT tg_id,base_class,name FROM rpg_live_characters WHERE account_tg_id=? ORDER BY char_slot').all(ACCOUNT);
  if (!existing.length) throw Error('Exchange QA requires the existing isolated main characters');
  const main = existing.find(c => c.base_class === 'sword') || existing[0];
  const alternate = existing.find(c => c.base_class === 'archer') || null;
  const peers = [];
  for (const [i, accountId] of PEERS.entries()) {
    const player = await Player.createCharacter(scoped, { tgId: accountId, charSlot: 1,
      name: (realmId === 'permanent' ? '常駐' : '季旅') + '合成商旅' + (i + 1), baseClass: 'sword', gender: 'f' }, now);
    sql.prepare('UPDATE rpg_characters SET level=60,last_settle_at=? WHERE tg_id=?').run(now, player.char.tg_id);
    peers.push({ accountId, characterId: player.char.tg_id });
  }
  const manifest = { realmId, mainAccountId: ACCOUNT, mainCharacterId: main.tg_id,
    alternateCharacterId: alternate?.tg_id || null, peers, listings: [], history: [] };
  const { add, sale } = listingFactory(db, realmId, now, manifest);
  const activeCount = realmId === 'permanent' ? 65 : 31;
  const ownedActive = realmId === 'permanent' ? 5 : 1;
  for (let i = 0; i < activeCount; i++) {
    const owned = i < ownedActive, peer = peers[(i - ownedActive + PEERS.length * 10) % peers.length];
    const sellerAccount = owned ? ACCOUNT : peer.accountId;
    const sellerCharacterId = owned ? (alternate && i % 2 ? alternate.tg_id : main.tg_id) : peer.characterId;
    const base = { sellerAccount, sellerCharacterId };
    if (i < 30) {
      const gear = makeGear({ id: 'exchange-qa-gear:' + realmId + ':' + i, tgId: sellerCharacterId,
        cls: i % 2 ? 'archer' : 'sword', slot: 'weapon', kind: i % 2 ? 'longbow' : 'sword', tier: i % 3 + 1,
        rng: () => 0.2, now, source: 'local-exchange-qa', forceRarity: i % 2 ? 'advanced' : 'common' });
      gear.enhance_level = i % 10;
      if (i === 29) gear.name = '晨星長路・' + '長名稱展示與換行'.repeat(9);
      add({ ...base, kind: 'equip', ref: gear.id, category: 'equipment', classReq: gear.class_req,
        tier: gear.tier, quality: gear.element_tier, enhance: gear.enhance_level,
        itemSnapshot: gear, displayName: gear.name });
    } else if (i < 61) {
      add({ ...base, ref: 'scroll_w', category: 'scroll' });
    } else if (i === 61) {
      const id = 'exchange-qa-guardian:' + realmId;
      add({ ...base, kind: 'guardian', ref: id, category: 'guardian', classReq: 'sword', quality: 'white',
        itemSnapshot: { id, char_id: sellerCharacterId, type: 'melee', quality: 1,
          bound: 0, active: 0, locked: 0, trade_id: null, exchange_id: null, created_at: now },
        displayName: '白・天使・熾刃' });
    } else if (i === 62) {
      add({ ...base, ref: 'hunt_1_1', category: 'collection' });
    } else if (i === 63) {
      add({ ...base, ref: 'book_skill_01_1', category: 'skillbook', classReq: 'sword', quality: '普通' });
    } else {
      add({ ...base, ref: 'red_1', category: 'other' });
    }
  }
  // Exactly 30 sell + 31 buy rows at one timestamp in the permanent world.
  // The second world intentionally reuses account IDs but has distinct listing/event IDs.
  const historyCount = realmId === 'permanent' ? 61 : 31;
  for (let i = 0; i < historyCount; i++) {
    const selling = i < 30, peer = peers[i % peers.length];
    const common = { sellerAccount: selling ? ACCOUNT : peer.accountId,
      sellerCharacterId: selling ? main.tg_id : peer.characterId,
      buyerCharacterId: selling ? peer.characterId : main.tg_id, price: 200 + i, qty: i % 3 + 1 };
    if (i === historyCount - 1) {
      // Valid JSON with an unavailable historical snapshot exercises the original safe fallback.
      sale({ ...common, itemSnapshot: { item: 'missing-snapshot-ref' }, historySnapshotAvailable: false });
    } else if (i === historyCount - 2) {
      const gear = makeGear({ id: 'exchange-qa-history-gear:' + realmId, tgId: common.sellerCharacterId,
        cls: 'sword', slot: 'weapon', kind: 'sword', tier: 2, rng: () => 0.2, now,
        source: 'local-exchange-qa', forceRarity: 'advanced' });
      gear.enhance_level = 7;
      sale({ ...common, kind: 'equip', qty: 1, ref: gear.id, category: 'equipment', classReq: 'sword',
        tier: 2, quality: gear.element_tier, enhance: 7, itemSnapshot: gear, displayName: gear.name });
    } else sale(common);
  }
  if (alternate) {
    for (let i = 0; i < 3; i++) sale({ sellerAccount: ACCOUNT, sellerCharacterId: alternate.tg_id,
      buyerCharacterId: peers[i].characterId, price: 801 + i });
  }
  const desiredMine = realmId === 'permanent' ? 65 : 31;
  while (manifest.listings.filter(row => row.sellerAccount === ACCOUNT).length < desiredMine)
    add({ sellerAccount: ACCOUNT, sellerCharacterId: alternate && manifest.listings.length % 2 ? alternate.tg_id : main.tg_id,
      status: 'cancelled', price: 501 + manifest.listings.length });
  // Other-account-only history must never appear under a main account character.
  sale({ sellerAccount: peers[0].accountId, sellerCharacterId: peers[0].characterId,
    buyerCharacterId: peers[1].characterId, price: 987, qty: 3 });
  return manifest;
}

export async function seedExchangeQa(env, now) {
  if (env.ENVIRONMENT !== 'development' || env.ALLOW_DEV_AUTH !== 'true'
      || !env.DB?.sqlite || !env.DB_SEASON?.sqlite || env.DB.sqlite === env.DB_SEASON.sqlite
      || !Number.isSafeInteger(now) || now <= 0) throw Error('Exchange QA requires two isolated development SQLite fixtures');
  for (const [, binding] of REALMS) {
    const sql = env[binding].sqlite;
    if (sql.prepare('SELECT COUNT(*) AS n FROM rpg_exchange_listings').get().n !== 0)
      throw Error('Exchange QA requires an empty exchange fixture; reseeding is forbidden');
    if (!sql.prepare('SELECT 1 FROM rpg_live_characters WHERE account_tg_id=?').get(ACCOUNT))
      throw Error('Exchange QA requires the existing isolated main characters in both worlds');
  }
  const realms = {};
  for (const [realmId, binding] of REALMS) realms[realmId] = await seedRealm(env, realmId, binding, now);
  return { synthetic: true, seededAt: now, accountId: ACCOUNT, pageSize: 30,
    fixtureVersion: 1, realms, manifestSha256: digest(realms) };
}

export function exchangeQaState(env, seed) {
  const characters = [];
  for (const [realmId, binding] of REALMS) {
    for (const row of env[binding].sqlite.prepare('SELECT tg_id,account_tg_id,name,base_class FROM rpg_live_characters ORDER BY account_tg_id,char_slot').all()) {
      const history = seed.realms[realmId].history.filter(entry => entry.characterId === row.tg_id);
      characters.push({ realmId, accountId: row.account_tg_id, characterId: row.tg_id,
        name: row.name, baseClass: row.base_class,
        counts: { all: history.length, buy: history.filter(entry => entry.role === 'buy').length,
          sell: history.filter(entry => entry.role === 'sell').length } });
    }
  }
  return { ok: true, synthetic: true, productionAccess: false, seed, characters,
    databases: { permanent: snapshot(env.DB), season: snapshot(env.DB_SEASON) } };
}
