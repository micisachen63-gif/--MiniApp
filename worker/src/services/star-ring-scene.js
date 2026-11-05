// Pure Star Ring projection: no sweep, advance, withPlayer, maintenance or outbox.
import { loadPlayer } from '../db.js';
import { GameError } from '../game/classes.js';
import { ITEMS } from '../game/constants.js';
import { idleStats } from '../game/stats.js';
import { taipeiDay, taipeiAt } from '../game/time.js';
import * as Engine from '../game/star-ring.js';
import { readView, STAR_RING_CATALOG } from './star-ring.js';
import { state as cosmeticState } from './star-ring-cosmetics.js';
import { runningRingId } from './party-presence.js';
import { actorContext, partyIdentity, characterIdentity } from './star-ring-receipt.js';

const rows = async (db, sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];
const reason = (code, message) => ({ code, message });
const control = blocked => ({ allowed: !blocked, reason: blocked || null });
const frozen = () => reason('realm_read_only', '這個世界已停止接受新操作，目前僅供查看');

function admission(char, tier) {
  if (char.level < tier || !Engine.rolesOf(char).length)
    return reason('level', '需要 Lv.' + tier + (tier >= 90 ? ' 並完成二轉' : ''));
  return null;
}
function closed(party, now) {
  if (!['lobby', 'running'].includes(party.status)) return reason('closed', '這趟遠征已結束，請查看已結算戰果');
  if (party.status === 'lobby' && party.expiresAt <= now
    || party.status === 'running' && party.endsAt <= now)
    return reason('settlement_pending', '已到原期限，等待伺服器完成結算');
  return null;
}

async function startReason(db, party, characterId, day, now) {
  if (party.leaderId !== characterId) return reason('leader', '只有隊長能出發');
  if (party.status !== 'lobby') return reason('started', '遠征已經出發');
  if (party.expiresAt <= now) return reason('settlement_pending', '招募已到期，等待伺服器更新');
  const active = party.members.filter(member => !member.left);
  if (active.length !== 5 || active.some(member => !member.ready))
    return reason('ready', '需要五個不同帳號，且全員準備');
  const placeholders = active.map(() => '?').join(',');
  const live = await rows(db,
    'SELECT c.tg_id,c.name,c.account_tg_id,a.active_char_id,c.party_id,c.hp,c.idle_state,c.level,c.base_class,c.class_path,' +
    'EXISTS(SELECT 1 FROM rpg_star_ring_starts st WHERE st.char_id=c.tg_id AND st.day=?) AS used,' +
    'EXISTS(SELECT 1 FROM rpg_guardian_sigils g WHERE g.char_id=c.tg_id AND g.trade_id IS NOT NULL) AS guardian_trade,' +
    '(SELECT rp.party_id FROM rpg_party_presence rp WHERE rp.char_id=c.tg_id) AS presence_party,' +
    '(SELECT rp.account_id FROM rpg_party_presence rp WHERE rp.char_id=c.tg_id) AS presence_account ' +
    'FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id IN (' + placeholders + ')', day, ...active.map(member => member.id));
  if (live.length !== 5 || new Set(live.map(char => String(char.account_tg_id || char.tg_id))).size !== 5)
    return reason('ready', '需要五個不同帳號，且全員準備');
  for (const char of live) {
    const name = char.name || '隊員';
    if (String(char.active_char_id) !== String(char.tg_id)) return reason('changed', name + '已切換角色，請重新準備');
    if (char.party_id || char.presence_party !== party.id || char.presence_account !== 'ring:' + char.tg_id)
      return reason('changed', name + '已進入其他隊伍，請重新準備');
    if (char.hp <= 0 || char.idle_state === 'reviving') return reason('changed', name + '目前倒地或復活中');
    const level = admission(char, party.tier); if (level) return reason(level.code, name + '：' + level.message);
    if (char.used) return reason('daily', name + '今日已出發過');
    if (char.guardian_trade) return reason('guardian_trade', name + '需先完成守護天使交易');
  }
  if (party.difficulty === 'advanced' && Engine.coverage(live.map(char => ({
    id: char.tg_id, base: char.base_class, path: char.class_path, level: char.level, roles: Engine.rolesOf(char),
  })), ['breach', 'aid', 'control']).missing.length)
    return reason('party_roles', '深入遠征需要不同隊員分擔破陣、支援與壓制');
  return null;
}

export async function view(env, tg, body = {}, now) {
  const { context } = await actorContext(env, tg, now), db = env.DB, characterId = context.characterId;
  const player = await loadPlayer(db, characterId, env);
  if (!player) throw new GameError('no_character', '找不到目前帳號的角色', 404);
  const { char, inv } = player, realmPhase = env.REALM_CONTEXT?.phase || 'ACTIVE', readOnly = realmPhase !== 'ACTIVE';
  const selectedId = body.partyId == null ? null : partyIdentity(body.partyId);
  const recipient = body.recipientCharId == null ? characterId : characterIdentity(body.recipientCharId);
  if (body.recipientCharId != null && !selectedId)
    throw new GameError('star_ring_receipt_input', '查看角色戰報時需要原遠征識別', 400);
  if (recipient !== characterId) {
    const owned = await db.prepare('SELECT 1 FROM rpg_live_characters WHERE tg_id=? AND account_tg_id=?')
      .bind(recipient, context.accountId).first();
    if (!owned) throw new GameError('character_not_owned', '找不到這個角色的遠征戰報', 403);
  }
  if (body.recipientCharId != null) {
    const member = await db.prepare('SELECT 1 FROM rpg_star_ring_members WHERE run_id=? AND char_id=?')
      .bind(selectedId, recipient).first();
    if (!member) throw new GameError('member', '這個角色沒有參加這趟遠征', 403);
  }
  const day = taipeiDay(now), used = !!await db.prepare(
    'SELECT 1 FROM rpg_star_ring_starts WHERE char_id=? AND day=?'
  ).bind(characterId, day).first();
  const seat = await db.prepare('SELECT party_id FROM rpg_party_presence WHERE char_id=?').bind(characterId).first();
  const backgroundRunId = await runningRingId(db, characterId);
  const lobbyCandidate = seat?.party_id?.startsWith('ring:') ? seat.party_id : null;
  const lobbyRunId = lobbyCandidate && (await db.prepare('SELECT status FROM rpg_star_ring_runs WHERE id=?').bind(lobbyCandidate).first())?.status === 'lobby'
    ? lobbyCandidate : null;
  const foregroundPartyId = char.party_id && char.party_id !== backgroundRunId ? char.party_id
    : seat?.party_id && !seat.party_id.startsWith('ring:') ? seat.party_id : null;
  const occupied = backgroundRunId || lobbyRunId || foregroundPartyId || seat?.party_id || char.party_id;
  const occupancyReason = occupied ? reason('party', backgroundRunId
    ? '此角色已在星環遠征中，可另參與原本允許的短程組隊'
    : '此角色已有隊伍，請先完成或離隊') : null;
  const createReason = readOnly ? frozen() : occupancyReason
    || (used ? reason('daily', '這個角色今日已出發過') : admission(char, 40));
  const ownIds = new Set((await rows(db, 'SELECT tg_id FROM rpg_live_characters WHERE account_tg_id=?', context.accountId)).map(row => String(row.tg_id)));
  const projected = new Map();
  async function party(id, viewer = characterId) {
    const key = id + ':' + viewer;
    if (!projected.has(key)) projected.set(key, (async () => {
      const value = await readView(env, id, viewer, now), reportOnly = viewer !== characterId;
      const readonly = readOnly || reportOnly, baseBlock = readOnly ? frozen()
        : reportOnly ? reason('read_only_report', '這是同帳號另一角色的戰報，僅供查看') : closed(value, now);
      const me = value.me, activeMember = !!me && !me.left;
      let joinBlock = baseBlock;
      if (!joinBlock) {
        if (value.status !== 'lobby') joinBlock = reason('started', '招募已結束');
        else if (activeMember) joinBlock = me.ready ? reason('already_ready', '已加入並準備') : null;
        else if (value.members.filter(member => !member.left).length >= 5) joinBlock = reason('full', '遠征隊伍已滿');
        else if (value.members.some(member => !member.left && member.id !== characterId && ownIds.has(member.id)))
          joinBlock = reason('account', '同帳號只能派一名角色參加同一隊伍');
        else joinBlock = occupancyReason || (used ? reason('daily', '這個角色今日已出發過') : admission(char, value.tier));
      }
      const membershipBlock = activeMember ? null : reason('member', '你不在這支遠征隊伍中');
      const readyBlock = baseBlock || membershipBlock || (value.status !== 'lobby' ? reason('started', '遠征已經出發') : null);
      const tacticBlock = baseBlock || membershipBlock || (value.leaderId !== characterId ? reason('leader', '只有隊長能設定戰術') : null);
      const leaveBlock = baseBlock || membershipBlock;
      const startBlock = baseBlock || membershipBlock || await startReason(db, value, characterId, day, now);
      const settlementPending = value.status === 'lobby' && value.expiresAt <= now
        || value.status === 'running' && value.nextAt <= now;
      return { ...value, readonly, recipientCharId: viewer, settlementPending,
        ...(value.battle ? { battle: { ...value.battle, preview: value.status === 'running' } } : {}),
        ...(value.pendingRankReward ? { pendingRankReward: { ...value.pendingRankReward, preview: true } } : {}),
        projection: { battle: value.status === 'running' ? 'deterministic-preview' : 'saved-stage',
          rewards: 'committed-rows-only', settledStages: value.completedStages, checkpointDue: settlementPending },
        controls: { join: control(joinBlock), ready: control(readyBlock), start: control(startBlock),
          tactic: control(tacticBlock), leave: control(leaveBlock) } };
    })());
    return projected.get(key);
  }
  const currentId = backgroundRunId || lobbyRunId;
  const open = await rows(db, "SELECT id FROM rpg_star_ring_runs WHERE status='lobby' AND expires_at>? ORDER BY created_at DESC LIMIT 20", now);
  const past = await rows(db,
    "SELECT r.id FROM rpg_star_ring_runs r JOIN rpg_star_ring_members m ON m.run_id=r.id WHERE m.char_id=? AND " +
    "(r.status IN('complete','ended') OR m.left_at IS NOT NULL) ORDER BY r.updated_at DESC LIMIT 8", characterId);
  const active = currentId ? await party(currentId) : null;
  const selected = selectedId ? await party(selectedId, recipient) : active;
  const cosmetics = await cosmeticState(env, characterId), balances = {
    star_ring_token: inv.star_ring_token || 0, [Engine.CORE]: inv[Engine.CORE] || 0,
  };
  const offers = Engine.SHOP.map(offer => {
    const currency = offer.currency || 'star_ring_token', owned = !!offer.cosmetic && cosmetics.owned.includes(offer.cosmetic);
    const effectiveCost = owned ? 0 : offer.cost;
    const blocked = readOnly ? frozen() : (offer.cosmetic || currency === Engine.CORE) && char.level < 40
      ? reason('level', '星環外觀與星冕核心兌換需要 Lv.40')
      : (balances[currency] || 0) < effectiveCost ? reason('currency', (ITEMS[currency]?.name || currency) + '不足') : null;
    return { ...offer, currency, currencyName: ITEMS[currency]?.name || currency, owned, effectiveCost,
      costs: effectiveCost ? { [currency]: effectiveCost } : {}, canExchange: !blocked, reason: blocked };
  });
  const cosmeticBlock = readOnly ? frozen() : char.level < 40 ? reason('level', '星環外觀需要 Lv.40') : null;
  return { ...context, revision: Number(char.rev || 0), realmPhase, readOnly,
    character: { id: characterId, name: char.name, level: char.level, baseClass: char.base_class,
      classPath: char.class_path, hp: char.hp, mp: char.mp, stats: idleStats(char, player.equipment.filter(item => item.is_equipped)) },
    catalog: { ...STAR_RING_CATALOG, tiers: STAR_RING_CATALOG.tiers.map(tier => {
      const blocked = readOnly ? frozen() : occupancyReason || (used ? reason('daily', '這個角色今日已出發過') : admission(char, tier.id));
      return { ...tier, canCreate: !blocked, reason: blocked };
    }) },
    active, party: selected, parties: await Promise.all(open.map(row => party(row.id))),
    history: await Promise.all(past.map(row => party(row.id))),
    daily: { scope: 'character', day, used, limit: 1, remaining: used ? 0 : 1, resetsAt: taipeiAt(taipeiDay(now + 86400000), 0) },
    presence: { backgroundRunId: backgroundRunId || null, lobbyRunId, foregroundPartyId: foregroundPartyId || null,
      canCreate: !createReason, reason: createReason },
    shop: { offers, balances, canOperate: !readOnly, reason: readOnly ? frozen() : null,
      cosmetics: { ...cosmetics, canUnequip: !cosmeticBlock, reason: cosmeticBlock,
        catalog: cosmetics.catalog.map(cosmetic => {
          const blocked = cosmeticBlock || (!cosmetics.owned.includes(cosmetic.id) ? reason('not_owned', '尚未解鎖此星紋') : null);
          return { ...cosmetic, owned: cosmetics.owned.includes(cosmetic.id), canEquip: !blocked, reason: blocked };
        }) } },
  };
}
