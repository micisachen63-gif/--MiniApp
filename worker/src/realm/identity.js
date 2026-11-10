import { configuredRealm, PERMANENT_REALM_ID, REALM_PHASES } from './catalog.js';
import { RealmError } from './errors.js';
import { createRealmGuardedDB } from './guarded-db.js';

const contexts = new WeakMap();
const fields = ['realm_id', 'realm_type', 'database_token', 'instance_nonce', 'rules_version'];
const HASH = /^[a-f0-9]{64}$/;
const fail = (code, message, cause) => new RealmError(code, message, 503, { cause });

async function readIdentity(DB, { allowAbsent = false, allowMissingSchema = false } = {}) {
  let row;
  try { row = await DB.prepare('SELECT * FROM rpg_realm_identity WHERE singleton = 1').first(); }
  catch (cause) {
    if (allowMissingSchema && /no such table:\s*rpg_realm_identity\b/i.test(String(cause?.message || cause))) return null;
    throw fail('realm_identity_missing', '世界資料庫尚未安裝身分驗證', cause);
  }
  if (!row && !allowAbsent) throw fail('realm_identity_missing', '世界資料庫尚未初始化身分');
  return row;
}

function matchesEntry(row, entry) {
  return row && row.realm_id === entry.id && row.realm_type === entry.type && row.database_token === entry.databaseToken && row.rules_version === entry.rulesVersion;
}

function validateIdentity(row, entry) {
  if (!matchesEntry(row, entry) || !fields.every(field => typeof row[field] === 'string' && row[field])
    || !REALM_PHASES.includes(row.phase) || !Number.isSafeInteger(row.fence_epoch) || row.fence_epoch < 0
    || (row.realm_type === 'permanent' && row.phase !== 'ACTIVE')) throw fail('realm_identity_mismatch', '世界資料庫身分、類型或規則版本不符');
  return row;
}

async function validateRegistry(DB, identity) {
  let row;
  try { row = await DB.prepare('SELECT * FROM rpg_realm_registry WHERE realm_id = ?').bind(identity.realm_id).first(); }
  catch (cause) { throw fail('realm_registry_missing', '世界尚未完成永久登記', cause); }
  if (!row || !fields.every(field => row[field] === identity[field])) throw fail('realm_registry_mismatch', '世界身分尚未登記或已被其他資料庫使用');
  return row;
}

/** Explicit ID only: aliases such as current/season never resolve at runtime. */
export async function resolveRealm(env, realmId) {
  const { config, entry, DB } = configuredRealm(env, realmId);
  if (config.legacy) {
    // An old DB without this additive schema remains usable. An already
    // initialized seasonal DB cannot become "permanent" by removing config.
    const existing = await readIdentity(DB, { allowAbsent: true, allowMissingSchema: true });
    const identity = existing ? Object.freeze(validateIdentity(existing, { ...entry, databaseToken: existing.database_token, rulesVersion: existing.rules_version })) : null;
    if (identity) await validateRegistry(DB, identity);
    const context = Object.freeze({ id: entry.id, type: entry.type, name: entry.name, rulesVersion: identity?.rules_version || entry.rulesVersion, phase: 'ACTIVE', fenceEpoch: identity?.fence_epoch || 0, cutoffAt: null, legacy: true, identityVerified: Boolean(identity), DB: identity ? createRealmGuardedDB(DB, identity) : DB });
    contexts.set(context, { env, config, entry, rawDB: DB, identity });
    return context;
  }
  const identity = Object.freeze(validateIdentity(await readIdentity(DB), entry));
  const permanent = configuredRealm(env, PERMANENT_REALM_ID);
  if (entry.type === 'season') validateIdentity(await readIdentity(permanent.DB), permanent.entry);
  await validateRegistry(permanent.DB, identity);
  const context = Object.freeze({ id: entry.id, type: entry.type, name: entry.name, rulesVersion: identity.rules_version, phase: identity.phase, fenceEpoch: identity.fence_epoch, cutoffAt: identity.cutoff_at, manifestHash: identity.manifest_hash, legacy: false, identityVerified: true, DB: createRealmGuardedDB(DB, identity) });
  contexts.set(context, { env, config, entry, rawDB: DB, identity });
  return context;
}

/** Old services receive their ordinary env.DB API, now pinned to one realm. */
export function scopeEnvForRealm(env, context) {
  const source = contexts.get(context);
  if (!source || source.env !== env) throw new RealmError('realm_context_invalid', '世界驗證內容無效', 403);
  const scoped = { ...env, DB: context.DB, REALM_CONTEXT: context };
  // A service cannot accidentally bypass its wrapper via another catalog binding.
  for (const entry of source.config.entries) if (entry.binding !== 'DB') delete scoped[entry.binding];
  return scoped;
}

/** Internal maintenance capability. Never take a DB or identity from HTTP input.
 * Only DRAIN gains gameplay writes, fenced to the freshly verified identity. */
export async function realmMaintenanceContext(env,realmId){
  const context=await resolveRealm(env,realmId),source=contexts.get(context);
  if(context.legacy)throw new RealmError('realm_configuration_required','維護需要明確世界設定',400);
  const scoped=scopeEnvForRealm(env,context);
  if(context.type==='season'&&context.phase==='DRAIN')scoped.DB=createRealmGuardedDB(source.rawDB,source.identity,{maintenance:true});
  return {context,env:scoped,rawDB:source.rawDB,identity:source.identity};
}

function assertNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new RealmError('realm_time_invalid', '世界維護時間無效', 400);
}

async function gameTables(DB) {
  const result = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rpg_%' AND name NOT LIKE 'rpg_realm_%' ORDER BY name").all();
  const names = (result.results || []).map(row => row.name);
  if (!names.includes('rpg_characters') || !names.includes('rpg_equipment')) throw fail('realm_schema_missing', '請先完整安裝遊戲結構，不能只初始化世界身分');
  if (names.some(name => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))) throw fail('realm_schema_invalid', '世界資料庫結構無效');
  return names;
}

function emptyGuard(DB, tables) {
  return DB.prepare(`INSERT INTO rpg_realm_commit_guard(ok) SELECT NULL WHERE ${tables.map(name => `EXISTS (SELECT 1 FROM "${name}")`).join(' OR ')}`);
}

function registryInsert(DB, identity, now) {
  return DB.prepare('INSERT INTO rpg_realm_registry (realm_id, realm_type, database_token, instance_nonce, rules_version, registered_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(...fields.map(field => identity[field]), now);
}

async function registerIdentity(DB, identity, now) {
  try { await registryInsert(DB, identity, now).run(); }
  catch (cause) {
    try { await validateRegistry(DB, identity); }
    catch { throw fail('realm_id_reused', '這個世界 ID 或資料庫身分已被使用，不可重用', cause); }
  }
}

/**
 * MAINTENANCE ONLY. No request path calls this and no schema/player seed is run.
 * Permanent adoption requires an explicit flag. A season must contain no game
 * rows at its atomic identity insert. Its nonce is committed BEFORE registration,
 * so a crash can resume, but a new DB cannot reuse a previously registered ID.
 */
export async function initializeRealmIdentity(env, realmId, { now = Date.now(), adoptExistingPermanent = false } = {}) {
  assertNow(now);
  const { config, entry, DB } = configuredRealm(env, realmId);
  if (config.legacy) throw new RealmError('realm_configuration_required', '初始化前必須先明確設定世界目錄', 400);
  const permanent = configuredRealm(env, PERMANENT_REALM_ID);
  if (entry.type === 'season') {
    const permanentIdentity = validateIdentity(await readIdentity(permanent.DB), permanent.entry);
    await validateRegistry(permanent.DB, permanentIdentity);
  }
  let identity = await readIdentity(DB, { allowAbsent: true });
  if (identity) validateIdentity(identity, entry);
  else {
    const tables = await gameTables(DB);
    identity = { realm_id: entry.id, realm_type: entry.type, database_token: entry.databaseToken, instance_nonce: crypto.randomUUID(), rules_version: entry.rulesVersion };
    const insert = DB.prepare("INSERT INTO rpg_realm_identity (singleton, realm_id, realm_type, database_token, instance_nonce, rules_version, phase, fence_epoch, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)")
      .bind(...fields.map(field => identity[field]), now, now);
    const statements = [];
    if (entry.type === 'season' || !adoptExistingPermanent) statements.push(emptyGuard(DB, tables));
    statements.push(insert);
    if (entry.type === 'permanent') statements.push(registryInsert(DB, identity, now));
    try { await DB.batch(statements); }
    catch (cause) {
      const existing = await readIdentity(DB, { allowAbsent: true });
      if (!existing) {
        if (/rpg_realm_commit_guard\.ok/.test(String(cause?.message || cause))) throw fail('realm_not_empty', entry.type === 'season' ? '賽季資料庫已有遊戲資料，不能作為新賽季初始化' : '永久資料庫已有遊戲資料，必須明確選擇原地承接', cause);
        throw cause;
      }
      validateIdentity(existing, entry);
    }
    identity = validateIdentity(await readIdentity(DB), entry);
  }
  await registerIdentity(permanent.DB, identity, now);
  return resolveRealm(env, realmId);
}

/**
 * Records an audited lifecycle step; it does not drain jobs, build a manifest or
 * import characters. Later stages require evidence hashes from those tools.
 * This function must remain inaccessible to ordinary gameplay HTTP routes.
 */
export async function transitionRealmPhase(env, realmId, { expectedPhase, expectedFenceEpoch, nextPhase, cutoffAt, manifestHash, completionHash, now = Date.now() } = {}) {
  assertNow(now);
  const context = await resolveRealm(env, realmId);
  const { rawDB: DB, identity } = contexts.get(context);
  if (context.legacy || context.type !== 'season') throw new RealmError('realm_transition_invalid', '只有已驗證的賽季環境可進行季末移轉', 400);
  if (identity.phase !== expectedPhase || identity.fence_epoch !== expectedFenceEpoch) throw new RealmError('realm_fence_changed', '世界狀態已更新，請重新核對', 409);
  const index = REALM_PHASES.indexOf(expectedPhase);
  if (index < 0 || index === REALM_PHASES.length - 1 || REALM_PHASES[index + 1] !== nextPhase) throw new RealmError('realm_transition_invalid', '世界狀態不能跳步或回退', 400);
  const nextCutoff = nextPhase === 'FREEZE' ? cutoffAt : identity.cutoff_at;
  if (!Number.isSafeInteger(nextCutoff) || nextCutoff < identity.created_at || nextCutoff > now) throw new RealmError('realm_cutoff_required', '凍結時必須指定世界建立後、且不晚於現在的結算截止時間', 400);
  if (nextPhase === 'SEALED' && !HASH.test(manifestHash || '')) throw new RealmError('realm_manifest_required', '封存前必須提供已核對的清單雜湊', 400);
  if (nextPhase === 'COMPLETE' && !HASH.test(completionHash || '')) throw new RealmError('realm_completion_required', '完成前必須提供目標端核對收據的雜湊', 400);
  const nextManifest = nextPhase === 'SEALED' ? manifestHash : identity.manifest_hash;
  const nextCompletion = nextPhase === 'COMPLETE' ? completionHash : identity.completion_hash;
  try {
    await DB.batch([
      DB.prepare('UPDATE rpg_realm_identity SET phase = ?, fence_epoch = fence_epoch + 1, cutoff_at = ?, manifest_hash = ?, completion_hash = ?, updated_at = ? WHERE singleton = 1 AND realm_id = ? AND instance_nonce = ? AND phase = ? AND fence_epoch = ?')
        .bind(nextPhase, nextCutoff, nextManifest, nextCompletion, now, identity.realm_id, identity.instance_nonce, expectedPhase, expectedFenceEpoch),
      DB.prepare('INSERT INTO rpg_realm_commit_guard(ok) SELECT NULL WHERE changes() <> 1'),
      DB.prepare('INSERT INTO rpg_realm_phase_history (realm_id, from_phase, to_phase, fence_epoch, cutoff_at, evidence_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(identity.realm_id, expectedPhase, nextPhase, expectedFenceEpoch + 1, nextCutoff, nextPhase === 'COMPLETE' ? nextCompletion : nextManifest, now),
    ]);
  } catch (cause) {
    if (/rpg_realm_commit_guard\.ok/.test(String(cause?.message || cause))) throw new RealmError('realm_fence_changed', '世界狀態已更新，請重新核對', 409, { cause });
    throw cause;
  }
  return resolveRealm(env, realmId);
}
