// Pure, realm-scoped projection for the main battle party window.
// Legacy party queries still settle. This endpoint reads only committed state.
import { loadPlayer } from '../db.js';
import { GameError } from '../game/classes.js';
import { DUNGEONS, snapshot } from './party.js';
import { stateView } from './special.js';
import { runningRingId } from './party-presence.js';
import { DUNGEON_BALANCE } from '../game/pve-balance.js';
import { briefing, encounterPlan } from '../game/party-roles.js';
import { towerTitle } from '../game/tower-progression.js';
import { MECHANICS, SPECIAL_SKILLS, eligible, skillCoefficient } from '../game/special.js';
import { dungeonSkillPool } from '../game/thief-skill-catalog.js';
import { masteredSkill } from '../game/skill-mastery.js';
import { specialCost } from '../game/combat-passives.js';

const RETENTION_MS = 7 * 86400000;
const PAGE_SIZE = 20;
const READ_ONLY_MESSAGE = '這個世界已停止接受新操作，目前僅供查看';
const rows = async (db, sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];
const ended = status => ['won', 'lost', 'ended'].includes(status);
const reason = (code, message) => ({ code, message });

function targetFor(skill) {
  const mechanics = MECHANICS[skill.id] || {};
  if (mechanics.revive) return 'downed_ally';
  if (mechanics.target || mechanics.guard) return 'ally';
  if (mechanics.all) return 'all_allies';
  if (mechanics.lowest) return 'auto_ally';
  return (mechanics.singleCoefficient ?? skillCoefficient(skill)) > 0 || mechanics.dot || mechanics.summon || mechanics.thiefPoison ? 'enemy' : 'self';
}

function skillsFor(state, party, char) {
  const actor = party?.me?.actor;
  const skills = actor
    ? SPECIAL_SKILLS.map(skill => specialCost(masteredSkill(skill, actor.special), actor.affixPct || {}))
    : state.skills;
  const character = actor ? { base_class: actor.base, class_path: actor.path, level: actor.level } : char;
  return skills.map(skill => ({ ...skill, target: targetFor(skill), eligible: eligible(character, skill) }));
}

function summary(row, members, tg, now) {
  const state = JSON.parse(row.state_json);
  return {
    id: row.id, name: state.name, kind: row.kind, status: row.status,
    dungeonId: state.dungeonId, trial: state.trial || null, level: state.level,
    floor: state.floor, round: state.round, leaderId: row.leader_id,
    createdAt: row.created_at, endedAt: ended(row.status) ? Number(state.endedAt) || row.updated_at : null,
    deadline: state.deadline || row.expires_at,
    pendingSettlement: row.status === 'combat' && now >= Math.min(state.deadline, state.challengeEndsAt || Infinity),
    mine: members.some(member => member.char_id === tg),
    members: members.map(member => ({
      id: member.char_id, name: member.name, title: towerTitle(member), level: member.level,
      base: member.base_class, classPath: member.class_path, gender: member.gender,
      ready: !!member.ready, leader: member.char_id === row.leader_id,
    })),
  };
}

async function directory(db, tg, body, now) {
  const isEnded = body.tab === 'ended';
  const requestedPage = Math.max(1, Math.min(1000000, Math.floor(Number(body.page) || 1)));
  const where = "kind='dungeon' AND " + (isEnded
    ? "status IN ('won','lost','ended') AND COALESCE(json_extract(state_json,'$.endedAt'),updated_at)>=?"
    : "(status='combat' OR (status='lobby' AND expires_at>?))");
  const cutoff = isEnded ? now - RETENTION_MS : now;
  const total = Number((await db.prepare('SELECT COUNT(*) AS total FROM rpg_parties WHERE ' + where).bind(cutoff).first())?.total) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)), page = Math.min(requestedPage, pages);
  const order = isEnded ? "COALESCE(json_extract(state_json,'$.endedAt'),updated_at) DESC" : 'created_at DESC';
  const parties = await rows(db, 'SELECT * FROM rpg_parties WHERE ' + where + ' ORDER BY ' + order + ',id DESC LIMIT ? OFFSET ?', cutoff, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const members = parties.length ? await rows(db,
    'SELECT m.party_id,m.char_id,m.ready,c.name,c.level,c.base_class,c.class_path,c.gender,c.special_json ' +
    'FROM rpg_party_members m JOIN rpg_live_characters c ON c.tg_id=m.char_id WHERE m.party_id IN (' + parties.map(() => '?').join(',') + ') ORDER BY m.joined_at,m.char_id',
    ...parties.map(party => party.id)) : [];
  return {
    tab: isEnded ? 'ended' : 'active', total, page, pages, pageSize: PAGE_SIZE, retentionDays: 7,
    parties: parties.map(party => summary(party, members.filter(member => member.party_id === party.id), tg, now)),
  };
}

async function detail(db, env, id, tg, now, sinceTurnId, readOnly) {
  const row = await db.prepare('SELECT kind,status,state_json,updated_at FROM rpg_parties WHERE id=?').bind(id).first();
  if (!row) throw new GameError('party', '找不到隊伍', 404);
  if (row.kind !== 'dungeon') throw new GameError('party_scope', '此頁目前提供三人副本與轉職試煉', 400);
  if (ended(row.status)) {
    const state = JSON.parse(row.state_json);
    if ((Number(state.endedAt) || row.updated_at) < now - RETENTION_MS) {
      const member = await db.prepare('SELECT 1 FROM rpg_party_members WHERE party_id=? AND char_id=?').bind(id, tg).first();
      if (!member) throw new GameError('hall_expired', '組隊大廳僅展示近7天；自己的紀錄仍可查看。', 404);
    }
  }
  const party = await snapshot(env, id, tg, now, sinceTurnId);
  // Transport notification identifiers are unnecessary in the main battle window.
  delete party.chatId;
  delete party.messageId;
  const rewardReason = readOnly ? reason('realm_read_only', READ_ONLY_MESSAGE)
    : !party.me ? reason('member', '只有實際參與的隊員能領取')
    : party.me.rewarded ? reason('rewarded', '已領取本場戰利品')
    : party.status !== 'won' ? reason('win', '尚未通關')
    : !(party.me.actor?.actions > 0) ? reason('participation', '需要實際參與戰鬥才能領取')
    : null;
  return { ...party, canReward: rewardReason === null, rewardReason };
}

async function dropsFor(db, party) {
  if (!party) return [];
  const rewards = await rows(db, 'SELECT char_id,reward_json,created_at FROM rpg_party_rewards WHERE party_id=? ORDER BY char_id', party.id);
  return party.members.map(member => {
    const receipt = rewards.find(row => row.char_id === member.id);
    let items = {};
    try { items = JSON.parse(receipt?.reward_json || '{}').items || {}; } catch {}
    return {
      characterId: member.id, name: member.name, received: !!receipt,
      items: Object.fromEntries(Object.entries(items).filter(([, quantity]) => Number.isSafeInteger(quantity) && quantity > 0)),
      at: receipt?.created_at || null,
    };
  });
}

export async function view(env, tg, body = {}, now) {
  const characterId = String(tg), player = await loadPlayer(env.DB, characterId, env);
  if (!player) throw new GameError('no_character', '請先選擇這個環境的角色', 404);
  if (body.partyId != null && (typeof body.partyId !== 'string' || !body.partyId || body.partyId.length > 128))
    throw new GameError('party', '隊伍編號無效', 400);
  if (body.sinceTurnId != null && (typeof body.sinceTurnId !== 'string' || body.sinceTurnId.length > 128))
    throw new GameError('party', '戰況游標無效', 400);
  const { char } = player, db = env.DB, accountId = String(char.account_tg_id || char.tg_id);
  const readOnly = (env.REALM_CONTEXT?.phase || 'ACTIVE') !== 'ACTIVE';
  const readOnlyReason = readOnly ? READ_ONLY_MESSAGE : null;
  const state = stateView(player, now);
  const presence = await rows(db,
    'SELECT x.party_id,x.char_id,p.kind,p.status FROM rpg_party_presence x LEFT JOIN rpg_parties p ON p.id=x.party_id WHERE x.account_id=? OR x.char_id=? ORDER BY x.party_id LIMIT 8',
    accountId, characterId);
  const ringId = await runningRingId(db, characterId);
  const current = presence.find(entry => entry.char_id === characterId && entry.kind === 'dungeon');
  const cache = new Map();
  const read = (id, cursor = null) => {
    const key = id + ':' + (cursor || '');
    if (!cache.has(key)) cache.set(key, detail(db, env, id, characterId, now, cursor, readOnly));
    return cache.get(key);
  };
  let activeId = current?.party_id || null;
  if (!activeId && char.party_id && !String(char.party_id).startsWith('ring:')) {
    const stored = await db.prepare('SELECT id,kind FROM rpg_parties WHERE id=?').bind(char.party_id).first();
    if (stored?.kind === 'dungeon') activeId = stored.id;
  }
  const active = activeId ? await read(activeId, activeId === body.partyId ? body.sinceTurnId : null) : null;
  const party = body.partyId ? await read(body.partyId, body.sinceTurnId) : active;
  const occupied = presence.find(entry => !(entry.char_id === characterId && ringId && entry.party_id === ringId));
  const blockedReason = readOnly ? reason('realm_read_only', READ_ONLY_MESSAGE)
    : char.atlas_run_id ? reason('atlas_active', '請先完成或停止目前的星圖出征，再建立或加入隊伍')
    : occupied || (char.party_id && char.party_id !== ringId) ? reason('party', occupied?.kind === 'tower' ? '請先完成目前的爬塔挑戰' : '此帳號已有隊伍，請先完成或離開')
    : null;
  const historyRows = await rows(db,
    "SELECT p.id FROM rpg_parties p JOIN rpg_party_members m ON m.party_id=p.id WHERE m.char_id=? AND p.kind='dungeon' AND p.status IN ('won','lost','ended') ORDER BY p.updated_at DESC,p.id DESC LIMIT 10",
    characterId);
  const dungeons = DUNGEONS.map(dungeon => {
    const unavailable = blockedReason || (char.level < dungeon.level ? reason('level', '需要 Lv.' + dungeon.level)
      : dungeon.trial && String(char.class_path || '').length < dungeon.trial - 1 ? reason('trial', '轉職階段不符合此試煉') : null);
    return {
      ...dungeon, challenge: !!DUNGEON_BALANCE[dungeon.id],
      dropSkillIds: dungeon.trial ? [] : dungeonSkillPool(SPECIAL_SKILLS, dungeon.skillLevels, char).map(skill => skill.id),
      cooperation: briefing(encounterPlan('dungeon', dungeon.id), []),
      canCreate: unavailable === null, reason: unavailable,
    };
  });
  return {
    ok: true, now, accountId, realmId: env.REALM_CONTEXT?.id || 'permanent', characterId,
    readOnly, readOnlyReason, canCreate: blockedReason === null, blockedReason,
    character: { ...state.character, id: characterId, rev: Number(char.rev) || 0, atlasRunId: char.atlas_run_id || null },
    stamina: state.stamina, skills: skillsFor(state, party, char),
    dungeons, active, party, directory: await directory(db, characterId, body, now),
    history: await Promise.all(historyRows.map(row => read(row.id))),
    drops: await dropsFor(db, party),
  };
}
