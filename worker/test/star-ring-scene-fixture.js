import { freshDb } from './d1-shim.js';
import * as Player from '../src/services/player.js';
import * as Ring from '../src/services/star-ring.js';
import * as Party from '../src/services/party.js';
import { loadPlayer } from '../src/db.js';
import { computeStats } from '../src/game/stats.js';
import { gameplaySnapshot } from './realm-test-helpers.js';
export const NOW = Date.parse('2026-11-02T00:00:00Z');
export const IDS = ['19501', '19502', '19503', '19504', '19505'];
export const changes = db => db.sqlite.prepare('SELECT total_changes() AS n').get().n;
export const snapshot = gameplaySnapshot;
export const sqlRows = (db, table) => db.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all();
export const put = (db, tg, item, n) => db.sqlite.prepare(
  'INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity'
).run(tg, item, n);
export async function fixture(t, { version = 3, start = false, lobby = true, second = false, difficulty = 'normal' } = {}) {
  const env = { DB: freshDb() }, db = env.DB.sqlite, ids = [...IDS];
  t.after(() => db.close());
  for (const [i, tgId] of ids.entries()) {
    await Player.createCharacter(env, { tgId, name: '星環收據' + i, baseClass: ['sword', 'mage', 'archer', 'thief', 'sword'][i], gender: 'f' }, NOW);
    db.prepare("UPDATE rpg_characters SET level=80,class_path='A1',last_settle_at=? WHERE tg_id=?").run(NOW, tgId);
    const player = await loadPlayer(env.DB, tgId), stats = computeStats(player.char, player.equipment.filter(item => item.is_equipped));
    db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp, stats.maxMp, tgId);
    put(env.DB, tgId, 'star_ring_token', 500); put(env.DB, tgId, 'star_ring_core', 120);
  }
  let secondId = null;
  if (second) {
    const result = await Player.createCharacter(env, { tgId: ids[0], name: '同帳另一角色', baseClass: 'mage', gender: 'm', charSlot: 2 }, NOW);
    secondId = result.char.tg_id;
    db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(ids[0], ids[0]);
  }
  let id = null;
  if (lobby) {
    id = (await Ring.create(env, ids[0], { tier: 80, difficulty }, NOW)).party.id;
    const state = JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);
    state.engineVersion = version; state.seed = 'star-ring-scene-fixture-' + version;
    db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(state), id);
    for (const tg of ids.slice(1)) await Ring.action(env, tg, { partyId: id, action: 'join' }, NOW);
    for (const tg of ids) await Ring.action(env, tg, { partyId: id, action: 'ready' }, NOW);
    if (start) await Ring.action(env, ids[0], { partyId: id, action: 'start' }, NOW);
  }
  return { env, db: env.DB, sql: db, ids, id, secondId };
}
export async function shortParty(f, kind = 'dungeon', now = NOW + 1000) {
  const ids = f.ids.slice(0, 3), id = (await Party.create(f.env, ids[0], { kind, dungeonId: 'pillar', startFloor: 1 }, now)).party.id;
  for (const tg of ids.slice(1)) await Party.action(f.env, tg, { partyId: id, op: 'join' }, now);
  for (const tg of ids) await Party.action(f.env, tg, { partyId: id, op: 'ready' }, now);
  await Party.action(f.env, ids[0], { partyId: id, op: 'start' }, now); return id;
}
