// SELECT-only Fate projection. Display clocks never commit answers or gifts.
import * as Fate from './fate.js';
import * as Gifts from './fate-gifts.js';
import { GameError } from '../game/classes.js';
import { taipeiDay } from '../game/time.js';
import { COUNTRY_METADATA_V9, ensureCountryPack } from '../../public/fate/country-runtime-v9.js';
import { advanceLife, addActive, isOpenTime, CHOICE_MS } from '../../public/fate/life.js';
import { SOUL_ACHIEVEMENTS } from '../../public/fate/cycles.js';
import { actorContext, hashJSON, same, RECEIPT_TYPE } from './fate-receipt.js';

const invalid = message => { throw new GameError('fate_scene_input', message, 400); };
const decode = text => { try { return JSON.parse(text); } catch {
  throw new GameError('fate_scene_corrupt', '原旅章資料目前無法完整核對，請稍後重新整理', 409); } };
function parameters(body) {
  const before = body.before ?? null, giftStatus = body.giftStatus ?? 'claimed',
    giftAfter = body.giftAfter ?? null, readSequence = body.readSequence ?? 0;
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) invalid('旅章分頁已失效，請重新開啟紀錄');
  if (!['claimed', 'opened', 'all'].includes(giftStatus)) invalid('請選擇有效的星輝匣狀態');
  if (giftAfter !== null && (!Number.isSafeInteger(giftAfter) || giftAfter <= 0 || giftAfter % Gifts.GIFT_INTERVAL))
    invalid('星輝匣分頁已失效，請重新開啟');
  if (!Number.isSafeInteger(readSequence) || readSequence < 0) invalid('讀取序號無效');
  return { before, giftStatus, giftAfter, readSequence };
}
async function metadata(db, context, now) {
  const tg = context.characterId, account = context.accountId, day = taipeiDay(now);
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) count,COALESCE(SUM(rev),0) totalRevision,COALESCE(MAX(started_at),0) lastStartedAt,COALESCE(MAX(completed_at),0) lastCompletedAt,COALESCE(SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END),0) completed FROM rpg_fate_lives WHERE char_id=?").bind(tg),
    db.prepare("SELECT id,rev,status FROM rpg_fate_lives WHERE char_id=? AND status='active'").bind(tg),
    db.prepare('SELECT count FROM rpg_fate_starts WHERE account_id=? AND day=?').bind(account, day),
    db.prepare('SELECT rev,updated_at FROM rpg_fate_profiles WHERE account_id=?').bind(account),
    db.prepare('SELECT rev,created_at FROM rpg_fate_daily WHERE account_id=? AND day=?').bind(account, day),
    db.prepare('SELECT COUNT(*) count,COALESCE(SUM(rev),0) totalRevision,COALESCE(MAX(created_at),0) latestCreatedAt,COALESCE(SUM(profile_rev),0) profileRevisionSum FROM rpg_fate_daily WHERE account_id=?').bind(account),
    db.prepare('SELECT COUNT(*) count,COALESCE(SUM(rev),0) totalRevision,COALESCE(MAX(opened_at),0) latestOpenedAt,COALESCE(MAX(resolved_at),0) latestResolvedAt FROM rpg_fate_social_choices WHERE owner_account=? OR guest_account=?').bind(account, account),
    db.prepare('SELECT rev,updated_at,active_at,quiet_until,enabled,allow_mentions FROM rpg_fate_social_preferences WHERE account_id=?').bind(account),
    db.prepare("SELECT COUNT(*) claimed,COALESCE(SUM(CASE WHEN status='opened' THEN 1 ELSE 0 END),0) opened,COALESCE(MAX(created_at),0) latestCreatedAt,COALESCE(MAX(opened_at),0) latestOpenedAt,COALESCE(SUM(milestone),0) milestoneSum FROM rpg_fate_gifts WHERE char_id=?").bind(tg),
    db.prepare('SELECT COUNT(*) count,COALESCE(MAX(created_at),0) lastCreatedAt FROM rpg_fate_memorials WHERE char_id=?').bind(tg),
    db.prepare('SELECT (SELECT COUNT(*) FROM rpg_fate_operations WHERE account_id=?) lifeCount,(SELECT COUNT(*) FROM rpg_fate_gift_operations WHERE account_id=?) giftCount,(SELECT COUNT(*) FROM rpg_ledger WHERE tg_id=? AND type=?) receiptCount').bind(account, account, tg, RECEIPT_TYPE)
  ]);
  const first = index => results[index]?.results?.[0] ?? null, lives = first(0);
  return { scope: { realmId: context.realmId, accountId: account, characterId: tg }, day,
    life: first(1), lifeRevision: { count: lives.count, totalRevision: lives.totalRevision,
      lastStartedAt: lives.lastStartedAt, lastCompletedAt: lives.lastCompletedAt },
    completed: lives.completed, startedToday: first(2)?.count ?? 0,
    profile: { rev: first(3)?.rev ?? 0, updatedAt: first(3)?.updated_at ?? null },
    daily: { day, rev: first(4)?.rev ?? 0, createdAt: first(4)?.created_at ?? null, ...first(5) },
    social: first(6), preferences: first(7), gifts: first(8), memorials: first(9), operations: first(10) };
}
async function activeProjection(row, now) {
  if (!row) return null;
  const draft = decode(row.state_json);
  if (draft?.version === 9) await ensureCountryPack(draft.country);
  let calculated;
  try { calculated = advanceLife(draft, now); } catch {
    throw new GameError('fate_scene_corrupt', '原人生時序目前無法完整核對，請稍後重新整理', 409);
  }
  const storedAnswers = draft.answers.length, calculatedAnswers = calculated.draft.answers.length,
    slot = calculated.slots[calculated.index],
    deadline = Number.isSafeInteger(slot) ? addActive(slot, CHOICE_MS) : null;
  let storyAt = Math.min(now, calculated.completed ? calculated.endAt - 1 : now);
  if (calculatedAnswers > storedAnswers) {
    const uncommittedSlot = calculated.slots[storedAnswers];
    storyAt = Math.min(storyAt, Number.isSafeInteger(uncommittedSlot) ?
      addActive(uncommittedSlot, CHOICE_MS) - 1 : draft.clockAt ?? draft.startedAt);
  }
  storyAt = Math.max(draft.startedAt, storyAt);
  const settlementPending = calculated.completed || calculatedAnswers !== storedAnswers ||
    row.next_at <= now || calculated.available && row.notified_index < calculated.index;
  return { id: row.id, rev: row.rev, status: row.status, startedAt: row.started_at,
    nextAt: row.next_at, draft, timing: { displayAt: now, storyAt, index: calculated.index,
      available: calculated.available, opensAt: Number.isSafeInteger(slot) ? slot : null,
      deadline, nextAt: calculated.nextAt, endAt: calculated.endAt, night: calculated.night,
      completionDue: calculated.completed, settlementPending,
      persistedAnswerCount: storedAnswers, projectedAnswerCount: calculatedAnswers } };
}
async function project(env, tg, body, now, namespace, attempt) {
  const params = parameters(body), { actor, context } = await actorContext(env, tg, now, body),
    db = env.DB, before = await metadata(db, context, now);
  const activeRow = await db.prepare("SELECT * FROM rpg_fate_lives WHERE char_id=? AND status='active'")
    .bind(context.characterId).first();
  const active = await activeProjection(activeRow, now);
  const history = await Fate.history(env, tg, params.before === null ? {} : { before: params.before }, now);
  const last = await db.prepare("SELECT id,code,completed_at,state_json FROM rpg_fate_lives WHERE char_id=? AND status='complete' ORDER BY started_at DESC LIMIT 1")
    .bind(context.characterId).first();
  const giftSummary = await Gifts.summary(env, tg);
  const owned = (await db.prepare('SELECT milestone FROM rpg_fate_gifts WHERE char_id=? ORDER BY milestone')
    .bind(context.characterId).all()).results || [];
  const seen = new Set(owned.map(row => row.milestone)), claimMilestones = [];
  for (let n = 1; n <= giftSummary.earned && claimMilestones.length < 25; n++)
    if (!seen.has(n * Gifts.GIFT_INTERVAL)) claimMilestones.push(n * Gifts.GIFT_INTERVAL);
  const giftRows = (await db.prepare("SELECT id,milestone,status,created_at,opened_at,rewards_json FROM rpg_fate_gifts WHERE char_id=? AND (?='all' OR status=?) AND milestone>? ORDER BY milestone LIMIT 41")
    .bind(context.characterId, params.giftStatus, params.giftStatus, params.giftAfter ?? 0).all()).results || [];
  const receiptPrefix = 'fate-scene-receipt:' + context.characterId + ':';
  const receiptRows = (await db.prepare('SELECT event_id,note,created_at FROM rpg_ledger WHERE tg_id=? AND type=? AND event_id LIKE ? ORDER BY created_at DESC,event_id DESC LIMIT 20')
    .bind(context.characterId, RECEIPT_TYPE, receiptPrefix + 'scene:' + namespace + ':%').all()).results || [];
  const receipts = receiptRows.map(row => {
    try {
      const saved = JSON.parse(row.note);
      return { version: saved.version, kind: saved.kind, signature: saved.signature, scope: saved.scope,
        createdAt: row.created_at, requestKey: row.event_id.slice(receiptPrefix.length) };
    } catch { return { createdAt: row.created_at, corrupt: true }; }
  });
  const blocked = await db.prepare("SELECT 1 blocked FROM rpg_outbox WHERE failed_at IS NOT NULL AND failed_at>? AND target='dm' AND tg_id=? AND last_error_code=403 AND COALESCE(last_error,'') NOT LIKE 'cleared:%' LIMIT 1")
    .bind(now - 30 * 86400000, context.accountId).first();
  const after = await metadata(db, context, now), { context: current } = await actorContext(env, tg, now, body);
  if (current.revision !== context.revision || !same(before, after) ||
      (active ? !same({ id: active.id, rev: active.rev, status: active.status }, after.life) : after.life !== null) ||
      giftSummary.completed !== after.completed || giftSummary.opened !== after.gifts.opened ||
      giftSummary.unopened !== after.gifts.claimed - after.gifts.opened) {
    if (attempt < 1) return project(env, tg, body, now, namespace, attempt + 1);
    throw new GameError('fate_snapshot_changed', '命運資料正在更新，請重新整理目前角色', 409);
  }
  const phase = env.REALM_CONTEXT?.phase || 'ACTIVE', writable = phase === 'ACTIVE', night = !isOpenTime(now);
  const startBlock = !writable ? '這個世界目前僅供查看' : active ?
    active.timing.completionDue ? '這一世正在等待背景結算' : '這一世仍在進行中' :
    night ? '星穹已入夜，06:00 再展開下一世' : after.startedToday >= 4 ? '今天已展開四世，明天再開啟新的旅程' : null;
  const token = await hashJSON(after);
  return { ...current, readSequence: params.readSequence, fate: {
    state: { heroName: actor.name, active, completed: after.completed, startedToday: after.startedToday,
      limit: 4, night, dmBlocked: !!blocked, milestone: [...SOUL_ACHIEVEMENTS].reverse().find(row => after.completed >= row.at) || null,
      last: last ? { id: last.id, code: last.code, at: last.completed_at, draft: decode(last.state_json) } : null },
    history: { entries: history.entries, next: history.next, memorials: history.memorials, receipts },
    gifts: { ...giftSummary, claimMilestones, entries: giftRows.slice(0, 40).map(row => ({
      id: row.id, milestone: row.milestone, status: row.status, createdAt: row.created_at,
      openedAt: row.opened_at, items: row.rewards_json === null ? null : decode(row.rewards_json)
    })), nextCursor: giftRows.length > 40 ? giftRows[39].milestone : null, filter: params.giftStatus },
    countries: [{ id: 'TW', name: '臺灣', cityName: '臺北', currency: 'TWD' },
      ...Object.entries(COUNTRY_METADATA_V9).map(([id, entry]) => ({ id, ...entry }))],
    control: { realmPhase: phase, writable, startAllowed: startBlock === null, startBlock },
    domain: { version: 1, token, life: after.life, lifeRevision: after.lifeRevision,
      completed: after.completed, startedToday: after.startedToday, profile: after.profile, daily: after.daily,
      social: { count: after.social.count, totalRevision: after.social.totalRevision },
      gifts: { claimed: after.gifts.claimed, opened: after.gifts.opened }, memorials: after.memorials,
      operations: after.operations }
  } };
}
export async function view(env, tg, body = {}, now = Date.now(), namespace = 'service') {
  if (!['app', 'service'].includes(namespace)) invalid('命運讀取來源無效');
  return project(env, tg, body, now, namespace, 0);
}
