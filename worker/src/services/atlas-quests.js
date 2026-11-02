import { GameError } from '../game/classes.js';
import { taipeiDay, isoWeek } from '../game/time.js';
import { getAtlasBuild, getAtlasMap } from '../game/atlas-catalog.js';
import {
  ATLAS_QUEST_RULES_VERSION, questTimestamp, questInstance, questInstances, questClaimWindowOpen,
} from '../game/atlas-quests.js';
import { ledgerStmt, classifyDbError } from '../db.js';

const open = env => String(env.ATLAS_ENABLED) === 'true';
const realmId = env => env.REALM_CONTEXT?.id || 'permanent';
export const isPermanentQuestRealm = env => realmId(env) === 'permanent' && (env.REALM_CONTEXT?.type || 'permanent') === 'permanent';
const unavailable = () => new GameError('atlas_quests_unavailable', '永久委託尚未開放', 503);
const onlyPermanent = () => new GameError('atlas_quest_permanent_only', '這項委託只屬於永久世界', 409);
function id(value, label, maximum = 160) {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value)) || !String(value).trim() || String(value).length > maximum) throw new GameError('atlas_quest_input', `${label}無效`);
  return String(value);
}
async function actorFor(db, charId) {
  const row = await db.prepare('SELECT c.tg_id,c.account_tg_id,a.active_char_id FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?').bind(charId).first();
  if (!row) throw new GameError('no_character', '找不到這個角色', 404);
  return { charId: String(row.tg_id), accountId: String(row.account_tg_id || row.tg_id), activeCharId: row.active_char_id };
}
async function actualPermanent(env) {
  if (!isPermanentQuestRealm(env)) return false;
  const identity = await env.DB.prepare('SELECT realm_id,realm_type FROM rpg_realm_identity WHERE singleton=1').first();
  return !identity || (identity.realm_id === 'permanent' && identity.realm_type === 'permanent');
}

/** Append these statements to the SAME batch as the source operation.
 * Timestamps are milliseconds. A completion uses
 * (run.startedAt + reward.elapsedSeconds) * 1000, never the polling time.
 * The root service calls this only for the permanent realm. SQL also rejects an
 * identified season DB. This helper does not execute anything on its own.
 */
export function questEventStatements(db, { accountId, charId, events, realmId: eventRealm = 'permanent' }, now) {
  if (eventRealm !== 'permanent') throw onlyPermanent();
  questTimestamp(now);
  accountId = id(accountId, '帳號'); charId = id(charId, '角色');
  if (!Array.isArray(events) || events.length > 200) throw new GameError('atlas_quest_event', '任務事件批次無效');
  if (!events.length) return [];
  const normalized = events.map(event => {
    if (!event || !['configure', 'start', 'completion', 'craft'].includes(event.kind)) throw new GameError('atlas_quest_event', '任務事件種類無效');
    const sourceId = id(event.sourceId, '事件來源', 240), occurredAt = questTimestamp(event.occurredAt, '事件時間');
    if (occurredAt > now) throw new GameError('atlas_quest_event', '不能記錄尚未發生的任務事件');
    const map = event.mapId == null ? null : getAtlasMap(event.mapId);
    const build = event.buildId == null ? null : getAtlasBuild(event.buildId);
    if ((event.mapId != null && !map) || (event.buildId != null && !build) ||
      (['start', 'completion'].includes(event.kind) && !map) || (event.kind !== 'craft' && !build) ||
      (event.themeId != null && event.themeId !== map?.themeId)) throw new GameError('atlas_quest_event', '任務事件的地圖、主題或流派無效');
    const row = { sourceId, accountId, charId, kind: event.kind, mapId: map?.id || null,
      themeId: map?.themeId || null, buildId: build?.id || null, occurredAt,
      dayKey: taipeiDay(occurredAt), weekKey: isoWeek(occurredAt), recordedAt: now };
    row.signature = JSON.stringify([accountId, charId, row.kind, row.mapId, row.themeId, row.buildId, occurredAt]);
    return row;
  });
  const json = JSON.stringify(normalized);
  return [
    db.prepare(`INSERT INTO rpg_atlas_quest_events(source_id,account_id,char_id,kind,map_id,theme_id,build_id,occurred_at,day_key,week_key,signature,recorded_at)
      SELECT json_extract(value,'$.sourceId'),json_extract(value,'$.accountId'),json_extract(value,'$.charId'),json_extract(value,'$.kind'),
       json_extract(value,'$.mapId'),json_extract(value,'$.themeId'),json_extract(value,'$.buildId'),json_extract(value,'$.occurredAt'),
       json_extract(value,'$.dayKey'),json_extract(value,'$.weekKey'),json_extract(value,'$.signature'),json_extract(value,'$.recordedAt')
      FROM json_each(?) WHERE 1 ON CONFLICT(source_id) DO NOTHING`).bind(json),
    db.prepare(`INSERT INTO rpg_atlas_quest_guard(ok) SELECT NULL WHERE EXISTS(
      SELECT 1 FROM json_each(?) j LEFT JOIN rpg_atlas_quest_events e ON e.source_id=json_extract(j.value,'$.sourceId')
      WHERE e.signature IS NOT json_extract(j.value,'$.signature'))`).bind(json),
  ];
}

function progressSQL(accountId, instance) {
  const criteria = instance.criteria, where = ['account_id=?', 'kind=?'], bindings = [accountId, criteria.kind];
  if (instance.endAt !== null) { where.push('occurred_at>=?', 'occurred_at<?'); bindings.push(instance.startAt, instance.endAt); }
  if (criteria.mapId) { where.push('map_id=?'); bindings.push(criteria.mapId); }
  if (criteria.themeId) { where.push('theme_id=?'); bindings.push(criteria.themeId); }
  const count = criteria.mode === 'distinct_theme' ? 'COUNT(DISTINCT theme_id)' : criteria.mode === 'distinct_build' ? 'COUNT(DISTINCT build_id)' : 'COUNT(*)';
  return { sql: `SELECT ${count} AS progress FROM rpg_atlas_quest_events WHERE ${where.join(' AND ')}`, bindings };
}
const claimKey = (questId, period) => `${questId}:${period}`;
function publicQuest(instance, progress, claimed, now) {
  return {
    id: instance.id, questId: instance.id, title: instance.title, description: instance.description,
    category: instance.category, action: instance.action, mapId: instance.mapId,
    periodKey: instance.periodKey, progress, target: instance.target, unit: instance.unit,
    completed: progress >= instance.target, claimed,
    claimable: !claimed && progress >= instance.target && questClaimWindowOpen(instance, now),
    rewards: structuredClone(instance.rewards), expiresAt: instance.expiresAt,
  };
}

/** Read-only projection. Visiting this endpoint never counts as playing. */
export async function view(env, charId, now) {
  questTimestamp(now);
  const actor = await actorFor(env.DB, charId);
  const base = { ok: true, enabled: false, realmId: realmId(env), accountId: actor.accountId, characterId: actor.charId,
    rulesVersion: ATLAS_QUEST_RULES_VERSION, balanceStatus: 'prototype', quests: [], materials: {}, now };
  if (!open(env) || !await actualPermanent(env)) return base;
  const instances = questInstances(now);
  const statements = instances.map(instance => { const query = progressSQL(actor.accountId, instance); return env.DB.prepare(query.sql).bind(...query.bindings); });
  const periods = [...new Set(instances.map(row => row.periodKey))];
  const [progress, claims, materials] = await Promise.all([
    env.DB.batch(statements),
    env.DB.prepare(`SELECT quest_id,period_key FROM rpg_atlas_quest_claims WHERE account_id=? AND period_key IN (${periods.map(() => '?').join(',')})`).bind(actor.accountId, ...periods).all(),
    env.DB.prepare('SELECT material,quantity FROM rpg_atlas_materials WHERE char_id=?').bind(actor.charId).all(),
  ]);
  const claimed = new Set(claims.results.map(row => claimKey(row.quest_id, row.period_key)));
  return { ...base, enabled: true,
    quests: instances.map((instance, index) => publicQuest(instance, Number(progress[index].results[0]?.progress || 0), claimed.has(claimKey(instance.id, instance.periodKey)), now)),
    materials: Object.fromEntries(materials.results.map(row => [row.material, row.quantity])),
  };
}

async function existingClaim(db, accountId, questId, periodKey) {
  return db.prepare('SELECT * FROM rpg_atlas_quest_claims WHERE account_id=? AND quest_id=? AND period_key=?').bind(accountId, questId, periodKey).first();
}
async function operationReceipt(db, actor, requestId, questId, periodKey) {
  const request = await db.prepare('SELECT * FROM rpg_atlas_quest_requests WHERE account_id=? AND request_id=?').bind(actor.accountId, requestId).first();
  if (!request) return null;
  if (request.quest_id !== questId || request.period_key !== periodKey) throw new GameError('request_reused', '這個操作編號已用於其他任務領獎', 409);
  const saved = await existingClaim(db, actor.accountId, questId, periodKey);
  if (!saved || saved.receipt_id !== request.receipt_id) throw new GameError('atlas_quest_receipt', '任務收據不完整，請聯絡管理員', 503);
  return saved;
}
const requestStatement = (db, actor, requestId, saved, now) => db.prepare('INSERT INTO rpg_atlas_quest_requests(account_id,request_id,quest_id,period_key,receipt_id,requested_char_id,created_at) VALUES(?,?,?,?,?,?,?)')
  .bind(actor.accountId, requestId, saved.quest_id, saved.period_key, saved.receipt_id, actor.charId, now);
async function response(env, actor, saved, now, alreadyClaimed) {
  return { ...await view(env, actor.charId, now), questId: saved.quest_id, periodKey: saved.period_key,
    receiptId: saved.receipt_id, rewardCharacterId: saved.reward_char_id, claimedAt: saved.claimed_at,
    rewards: JSON.parse(saved.rewards_json), alreadyClaimed };
}
async function recordReplay(env, actor, requestId, saved, now) {
  try { await env.DB.batch([requestStatement(env.DB, actor, requestId, saved, now)]); }
  catch (error) { if (!await operationReceipt(env.DB, actor, requestId, saved.quest_id, saved.period_key)) throw classifyDbError(error) || error; }
  return response(env, actor, saved, now, true);
}

/** Account-scoped receipt + material grant in one transaction. Claim progress is
 * recalculated from server events; client progress/rewards are never accepted.
 */
export async function claim(env, charId, body, now) {
  questTimestamp(now);
  if (!isPermanentQuestRealm(env)) throw onlyPermanent();
  if (!open(env)) {
    const schema = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rpg_atlas_quest_requests'").first();
    if (!schema) throw unavailable();
  }
  if (!await actualPermanent(env)) throw onlyPermanent();
  const actor = await actorFor(env.DB, charId), db = env.DB;
  const requestId = String(body?.requestId || '');
  if (!/^[\w:-]{6,96}$/.test(requestId)) throw new GameError('request', '需要有效的操作編號');
  const questId = id(body?.questId, '任務', 96), periodKey = id(body?.periodKey, '期別', 32);
  const previous = await operationReceipt(db, actor, requestId, questId, periodKey);
  if (previous) return response(env, actor, previous, now, true);
  const earned = await existingClaim(db, actor.accountId, questId, periodKey);
  if (earned) return recordReplay(env, actor, requestId, earned, now);
  if (!open(env)) throw unavailable();
  const instance = questInstance(questId, periodKey);
  if (!questClaimWindowOpen(instance, now)) throw new GameError('atlas_quest_expired', '這期委託尚未開始或已超過補領期限');
  if (actor.activeCharId !== actor.charId) throw new GameError('character_changed', '請先選擇要收取材料的角色', 409);
  const query = progressSQL(actor.accountId, instance);
  const progress = Number((await db.prepare(query.sql).bind(...query.bindings).first())?.progress || 0);
  if (progress < instance.target) throw new GameError('atlas_quest_incomplete', '任務尚未完成');
  const saved = { account_id: actor.accountId, quest_id: questId, period_key: periodKey,
    receipt_id: `atlas:quest:${actor.accountId}:${questId}:${periodKey}`,
    reward_char_id: actor.charId, rules_version: ATLAS_QUEST_RULES_VERSION,
    rewards_json: JSON.stringify(instance.rewards), claimed_at: now };
  const statements = [
    db.prepare(`INSERT INTO rpg_atlas_quest_guard(ok) SELECT NULL WHERE NOT EXISTS(
      SELECT 1 FROM rpg_live_characters c JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id
      WHERE c.tg_id=? AND c.account_tg_id=? AND a.active_char_id=c.tg_id)`).bind(actor.charId, actor.accountId),
    db.prepare(`INSERT INTO rpg_atlas_quest_guard(ok) SELECT NULL WHERE (${query.sql})<?`).bind(...query.bindings, instance.target),
    db.prepare('INSERT INTO rpg_atlas_quest_claims(account_id,quest_id,period_key,receipt_id,reward_char_id,rules_version,rewards_json,claimed_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(saved.account_id, questId, periodKey, saved.receipt_id, actor.charId, saved.rules_version, saved.rewards_json, now),
    requestStatement(db, actor, requestId, saved, now),
    ...Object.entries(instance.rewards.materials).map(([material, quantity]) => db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,?) ON CONFLICT(char_id,material) DO UPDATE SET quantity=quantity+excluded.quantity').bind(actor.charId, material, quantity)),
    ledgerStmt(db, { event_id: saved.receipt_id, tg_id: actor.charId, type: '永久委託獎勵',
      note: JSON.stringify({ questId, periodKey, accountId: actor.accountId, rewards: instance.rewards, rulesVersion: saved.rules_version }) }, now),
  ];
  try { await db.batch(statements); }
  catch (error) {
    const replay = await operationReceipt(db, actor, requestId, questId, periodKey);
    if (replay) return response(env, actor, replay, now, true);
    const winner = await existingClaim(db, actor.accountId, questId, periodKey);
    if (winner) return recordReplay(env, actor, requestId, winner, now);
    if (/atlas_quest_permanent_only/.test(String(error.message))) throw onlyPermanent();
    if (/rpg_atlas_quest_guard/.test(String(error.message))) throw new GameError('character_changed', '角色或任務狀態已更新，請重新查看', 409);
    throw classifyDbError(error) || error;
  }
  return response(env, actor, saved, now, false);
}
