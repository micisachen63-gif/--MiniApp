// Explicit private views are SELECT-only; opening this pane never creates or unlocks a note.
import { GameError } from '../game/classes.js';
import { taipeiDay } from '../game/time.js';
import { fateEvidence } from './fate-quests.js';
import { actorContext, readParameters, snapshot, expectedOf, domainOf, decode, same, scopeOf, history } from './fate-private-receipt.js';

function profileView(row, full) {
  if (!row) return { saved: false, rev: 0, coverage: 'inspiration', ...(!full ? { updatedAt: null } : {}) };
  const chart = decode(row.chart_json), result = { saved: true, rev: row.rev,
    coverage: chart.coverage, updatedAt: row.updated_at };
  if (!['inspiration', 'three-traditions'].includes(result.coverage))
    throw new GameError('fate_private_state_corrupt', '出生檔案目前無法完整讀取', 409);
  return full ? { ...result, birth: decode(row.birth_json) } : result;
}
function dailyView(row, day) {
  if (!row) return { day, materialized: false, rev: 0, createdAt: null, profileRevision: 0,
    unlocked: 0, unlocks: [], notes: [] };
  const notes = decode(row.notes_json), unlocks = decode(row.unlocks_json);
  if (!Array.isArray(notes) || notes.length !== 3 || !Array.isArray(unlocks) || unlocks.length > 3 ||
      !notes.every((note, i) => note?.topic === ['health', 'work', 'love'][i]) ||
      !unlocks.every(item => ['boss', 'dungeon', 'tower'].includes(item?.id) && Number.isSafeInteger(item.at)) ||
      new Set(unlocks.map(item => item.id)).size !== unlocks.length)
    throw new GameError('fate_private_state_corrupt', '今日旅箋目前無法完整讀取', 409);
  return { day, materialized: true, rev: row.rev, createdAt: row.created_at, profileRevision: row.profile_rev,
    unlocked: unlocks.length, unlocks,
    notes: notes.map((note, i) => i < unlocks.length ? { ...note, locked: false } : { topic: note.topic, locked: true }) };
}
async function project(env, tg, body, now, namespace, fullProfile, attempt) {
  const params = readParameters(body, namespace), { context } = await actorContext(env, tg, now, body),
    day = taipeiDay(now), before = await snapshot(env.DB, context, day);
  const available = fullProfile ? null : await fateEvidence(env, context.accountId, now),
    recent = fullProfile ? null : await history(env.DB, context, namespace),
    after = await snapshot(env.DB, context, day), { context: current } = await actorContext(env, tg, now, body);
  if (!same(scopeOf(context), scopeOf(current)) || current.revision !== context.revision || !same(before, after)) {
    if (attempt < 1) return project(env, tg, body, now, namespace, fullProfile, attempt + 1);
    throw new GameError('fate_private_snapshot_changed', '私人資料正在更新，請重新整理目前角色', 409);
  }
  const domain = await domainOf(after), phase = env.REALM_CONTEXT?.phase || 'ACTIVE',
    control = { realmPhase: phase, writable: phase === 'ACTIVE' };
  if (fullProfile) return { ...current, readSequence: params.readSequence,
    privateProfile: { profile: profileView(after.profile, true), domain, control } };
  const daily = dailyView(after.daily, day);
  return { ...current, readSequence: params.readSequence, privateFate: { day, profile: profileView(after.profile, false),
    daily, evidence: { available, pending: available.filter(item => !daily.unlocks.some(saved => saved.id === item.id)) },
    domain, control, history: recent } };
}
export const view = (env, tg, body = {}, now = Date.now(), namespace = 'service') =>
  project(env, tg, body, now, namespace, false, 0);
export const profile = (env, tg, body = {}, now = Date.now(), namespace = 'service') =>
  project(env, tg, body, now, namespace, true, 0);
