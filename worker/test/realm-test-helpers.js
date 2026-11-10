import { freshDb } from './d1-shim.js';
import { initializeRealmIdentity } from '../src/realm/index.js';

export const NOW = Date.parse('2026-11-01T00:00:00Z');
export const CATALOG = Object.freeze([
  { id: 'permanent', type: 'permanent', name: '永久世界', binding: 'DB', rulesVersion: 'poe-v1', databaseToken: 'permanent-d1-instance-001' },
  { id: 'season_2026_01', type: 'season', name: '第一賽季', binding: 'DB_SEASON', rulesVersion: 'poe-v1', databaseToken: 'season-d1-instance-2026-01' },
]);

export function fixture(t, catalog = CATALOG) {
  const DB = freshDb(), DB_SEASON = freshDb();
  t.after(() => { DB.sqlite.close(); DB_SEASON.sqlite.close(); });
  return { DB, DB_SEASON, REALM_CATALOG_JSON: JSON.stringify(catalog), CURRENT_SEASON_ID: catalog.find(entry => entry.type === 'season')?.id };
}

export async function initialized(t) {
  const env = fixture(t);
  await initializeRealmIdentity(env, 'permanent', { now: NOW });
  await initializeRealmIdentity(env, 'season_2026_01', { now: NOW });
  return env;
}

export function gameplaySnapshot(DB) {
  const tables = DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rpg_%' AND name NOT LIKE 'rpg_realm_%' ORDER BY name").all();
  return tables.map(({ name }) => [name, DB.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
}
