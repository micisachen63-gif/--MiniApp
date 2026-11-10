// Opt-in synthetic ledger rows for a NEW disposable local preview only.
import { createHash } from 'node:crypto';
import * as Player from '../src/services/player.js';
import { resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';

function addRows(db, characterId, count, now, realmId) {
  const insert = db.sqlite.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,gold_delta,item,item_delta,exp_delta,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < count; i++) {
    const item = i % 3 === 1 ? 'red_1' : i % 11 === 0 ? 'qa_unknown_item' : null;
    const note = i === 17 ? '{"private":"QA_PRIVATE_PAYLOAD_MUST_NOT_RENDER"' :
      i === 18 ? JSON.stringify({ accountId: 'QA_OTHER_ACCOUNT', fingerprint: 'QA_PRIVATE_PAYLOAD_MUST_NOT_RENDER' }) :
      '合成入帳範例 ' + (i + 1);
    insert.run('ledger-qa:' + realmId + ':' + characterId + ':' + i, characterId,
      i === 18 ? 'QA 操作收據' : 'QA 已入帳紀錄',
      i % 3 === 0 ? (i % 2 ? -1 : 1) * (i + 1) : 0,
      item, item ? i % 2 ? -2 : 3 : 0, i % 3 === 2 ? i % 2 ? -4 : 5 : 0,
      note, now - 60000 + Math.floor(i / 15) * 1000);
  }
}
export async function seedLedgerQa(env, now) {
  const characters = env.DB.sqlite.prepare('SELECT tg_id,base_class FROM rpg_live_characters WHERE account_tg_id=? ORDER BY char_slot').all('90101');
  const counts = { sword: 75, archer: 4, mage: 0, thief: 1 };
  for (const char of characters) addRows(env.DB, char.tg_id, counts[char.base_class] || 0, now, 'permanent');
  const season = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  const player = await Player.createCharacter(season, { tgId: '90101', charSlot: 1, name: '帳務測試季旅', baseClass: 'mage', gender: 'f' }, now);
  env.DB_SEASON.sqlite.prepare('UPDATE rpg_characters SET level=40,last_settle_at=? WHERE tg_id=?').run(now, player.char.tg_id);
  addRows(env.DB_SEASON, player.char.tg_id, 35, now, 'season_2026_01');
  return { synthetic: true, seededAt: now, permanentRows: 80, seasonalRows: 35, seasonCharacterId: player.char.tg_id };
}
function snapshot(db) {
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const content = tables.map(({ name }) => [name, db.sqlite.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]);
  return { sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'), tableCount: tables.length,
    totalChanges: db.sqlite.prepare('SELECT total_changes() AS n').get().n,
    ledgerCount: db.sqlite.prepare('SELECT COUNT(*) AS n FROM rpg_ledger').get().n };
}
export function ledgerQaState(env, seed) {
  const characters = [];
  for (const [realmId, db] of [['permanent', env.DB], ['season_2026_01', env.DB_SEASON]]) {
    for (const char of db.sqlite.prepare('SELECT tg_id,name,account_tg_id FROM rpg_live_characters ORDER BY tg_id').all()) {
      const counts = db.sqlite.prepare('SELECT COUNT(*) AS allCount,SUM(gold_delta<>0) AS gold,SUM(item_delta<>0) AS items,SUM(exp_delta<>0) AS experience FROM rpg_ledger WHERE tg_id=?').get(char.tg_id);
      characters.push({ realmId, accountId: char.account_tg_id, characterId: char.tg_id, name: char.name,
        counts: { all: counts.allCount, gold: counts.gold || 0, items: counts.items || 0, experience: counts.experience || 0 } });
    }
  }
  return { ok: true, synthetic: true, productionAccess: false, seed, characters,
    databases: { permanent: snapshot(env.DB), season: snapshot(env.DB_SEASON) } };
}
