import { RealmError } from './errors.js';

export const PERMANENT_REALM_ID = 'permanent';
export const REALM_PHASES = Object.freeze(['ACTIVE', 'FREEZE', 'DRAIN', 'SEALED', 'IMPORTING', 'COMPLETE']);
const ID = /^[a-z][a-z0-9_-]{2,63}$/;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$/;
const BINDING = /^[A-Z][A-Z0-9_]{0,63}$/;
const configError = () => new RealmError('realm_config_invalid', '世界設定無效，請聯絡管理員', 503);

/** Configuration is server-owned. It is never read from a request body/header. */
export function readRealmConfiguration(env) {
  const raw = env.REALM_CATALOG_JSON;
  if (raw == null || raw === '') {
    // Do not silently ignore a partial rollout or an accidentally rebound season.
    if (env.CURRENT_SEASON_ID || env.DB_SEASON) throw configError();
    return Object.freeze({ legacy: true, currentSeasonId: null, entries: Object.freeze([
      Object.freeze({ id: PERMANENT_REALM_ID, type: 'permanent', name: '永久世界', binding: 'DB', rulesVersion: 'legacy-v1', databaseToken: null }),
    ]) });
  }
  let entries;
  try { entries = JSON.parse(raw); } catch { throw configError(); }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 2) throw configError();
  const ids = new Set(), bindings = new Set(), tokens = new Set();
  entries = entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.id !== 'string' || !ID.test(entry.id) || !['permanent', 'season'].includes(entry.type)
      || typeof entry.binding !== 'string' || !BINDING.test(entry.binding)
      || typeof entry.rulesVersion !== 'string' || !VERSION.test(entry.rulesVersion)
      || typeof entry.databaseToken !== 'string' || !TOKEN.test(entry.databaseToken)
      || ids.has(entry.id) || bindings.has(entry.binding) || tokens.has(entry.databaseToken)) throw configError();
    if (entry.type === 'permanent' && (entry.id !== PERMANENT_REALM_ID || entry.binding !== 'DB')) throw configError();
    if (entry.type === 'season' && (['permanent', 'season', 'current', 'latest'].includes(entry.id) || entry.binding === 'DB')) throw configError();
    if (entry.name != null && (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80)) throw configError();
    ids.add(entry.id); bindings.add(entry.binding); tokens.add(entry.databaseToken);
    return Object.freeze({ id: entry.id, type: entry.type, name: entry.name || (entry.type === 'permanent' ? '永久世界' : entry.id), binding: entry.binding, rulesVersion: entry.rulesVersion, databaseToken: entry.databaseToken });
  });
  if (entries.filter(entry => entry.type === 'permanent').length !== 1 || entries.filter(entry => entry.type === 'season').length > 1) throw configError();
  const currentSeasonId = env.CURRENT_SEASON_ID || entries.find(entry => entry.type === 'season')?.id || null;
  if (currentSeasonId !== null && !entries.some(entry => entry.type === 'season' && entry.id === currentSeasonId)) throw configError();
  return Object.freeze({ legacy: false, currentSeasonId, entries: Object.freeze(entries) });
}

/** Public catalog: no database bindings, instance nonces or configuration tokens. */
export function listRealmCatalog(env) {
  const config = readRealmConfiguration(env);
  return config.entries.map(entry => ({ id: entry.id, type: entry.type, name: entry.name, rulesVersion: entry.rulesVersion, isCurrent: entry.id === config.currentSeasonId, legacy: config.legacy }));
}

export function configuredRealm(env, realmId) {
  if (typeof realmId !== 'string' || !realmId) throw new RealmError('realm_required', '請指定世界', 400);
  const config = readRealmConfiguration(env);
  const entry = config.entries.find(entry => entry.id === realmId);
  if (!entry) throw new RealmError('realm_unknown', '找不到指定的世界', 404);
  const DB = env[entry.binding];
  if (!DB || typeof DB.prepare !== 'function' || typeof DB.batch !== 'function') throw new RealmError('realm_binding_missing', '這個世界尚未完成資料庫設定', 503);
  if (entry.type === 'season' && DB === env.DB) throw new RealmError('realm_binding_mismatch', '世界資料庫身分不符', 503);
  return { config, entry, DB };
}
