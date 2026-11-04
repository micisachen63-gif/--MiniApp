// Read committed tower, equipment and ledger-derived state without settling.
import { loadPlayer } from '../db.js';
import { readPartyScene, readReason, READ_ONLY_MESSAGE } from './party-scene-common.js';
import { towerEntry } from './tower-daily.js';
import { canManageBackpackInParty, runningRingId } from './party-presence.js';
import { TOWER_RULES, TOWER_TITLES, TOWER_OFFERS, towerTitle } from '../game/tower-progression.js';
import { specialState } from '../game/special.js';
import { mapForLevel } from '../game/formulas.js';
import { MAX_OPEN_MAP } from '../game/constants.js';
import { briefing, encounterPlan } from '../game/party-roles.js';
import { equipmentView } from '../views.js';

export async function view(env, tg, body = {}, now) {
  const player = await loadPlayer(env.DB, String(tg), env);
  const scene = await readPartyScene(env, player, body, now, 'tower'), { char } = player, db = env.DB;
  const special = specialState(char), best = special.towerBest || 0, badges = player.inv.tower_fragment || 0;
  const daily = await towerEntry(db, String(tg), now);
  const blockedReason = scene.blockedReason
    || (char.level < 30 ? readReason('level', '爬塔需要 Lv.30')
      : daily.used ? readReason('tower_daily', '這隻角色今天已挑戰爬塔，台灣時間 00:00 後可再次出發') : null);
  const areaGate = startFloor => char.level < 30 + (startFloor - 1) * 3 ? readReason('level', '需要 Lv.' + (30 + (startFloor - 1) * 3))
    : best < startFloor - 1 ? readReason('tower', '請先通關上一區爬塔') : null;
  const areas = [1, 11, 21].map((startFloor, index) => {
    const reason = blockedReason || areaGate(startFloor);
    return {
      id: 'tower_' + startFloor, name: '星穹爬塔 · 第 ' + startFloor + '–' + (startFloor + 9) + ' 層',
      startFloor, endFloor: startFloor + 9, level: 30 + (startFloor - 1) * 3, requiredBest: startFloor - 1,
      fullClearBadges: TOWER_RULES.badgesByArea[index],
      cooperation: briefing(encounterPlan('tower', undefined, startFloor === 21 ? 30 : startFloor), []),
      canCreate: reason === null, reason,
    };
  });
  const join = party => {
    if (!party) return null;
    const reason = party.me || party.mine || party.members.some(member => member.id === scene.characterId) ? readReason('member', '你已在這支隊伍中')
      : blockedReason || (party.status !== 'lobby' || party.expired || party.deadline <= now ? readReason('closed', '隊伍已出發、結束或過期')
        : party.members.length >= 3 ? readReason('full', '隊伍已滿')
        : areaGate(party.startFloor || party.towerProgress?.startFloor || 1));
    return { ...party, canJoin: reason === null, joinReason: reason };
  };
  const ringId = char.party_id ? await runningRingId(db, scene.characterId) : null;
  const workshopBlocked = scene.readOnly ? readReason('realm_read_only', READ_ONLY_MESSAGE)
    : !canManageBackpackInParty(char, ringId) ? readReason('party', '請先結束目前的組隊戰鬥；星環遠征期間可管理背包物品')
    : char.level < 30 ? readReason('level', '爬塔與徽記工坊需要等級30') : null;
  const busy = new Set((await db.prepare(
    "SELECT item_id FROM rpg_auto_enhance WHERE status IN ('running','processing') AND item_id IN (SELECT id FROM rpg_equipment WHERE tg_id=?) " +
    "UNION SELECT item_id FROM rpg_auto_reroll WHERE status IN ('running','processing') AND item_id IN (SELECT id FROM rpg_equipment WHERE tg_id=?)"
  ).bind(scene.characterId, scene.characterId).all()).results?.map(row => row.item_id) || []);
  const equipment = player.equipment.map(item => {
    const view = equipmentView(char, item), imprint = view.towerImprint;
    const imprintReason = workshopBlocked
      || (item.is_equipped ? readReason('equipped', '請先卸下裝備，再進行塔印淬鍊')
        : item.trade_id ? readReason('in_trade', '請先取回交易中的裝備')
        : busy.has(item.id) ? readReason('auto_active', '請先停止這件裝備的背景作業')
        : imprint.level >= imprint.max ? readReason('imprint_max', '塔印已達最高五階')
        : badges < imprint.cost ? readReason('tower_badges', '需要星穹徽記 ' + imprint.cost + ' 個') : null);
    return { ...view, canImprint: imprintReason === null, imprintReason };
  });
  const tier = Math.min(MAX_OPEN_MAP, mapForLevel(char.level));
  const offers = TOWER_OFFERS.map(offer => {
    const reason = workshopBlocked || (badges < offer.cost ? readReason('tower_badges', '需要星穹徽記 ' + offer.cost + ' 個') : null);
    return { ...offer, quantity: offer.qty || tier * offer.perTier, canRedeem: reason === null, reason };
  });
  const titles = TOWER_TITLES.map(title => {
    const unlocked = best >= title.floor, reason = workshopBlocked || (!unlocked ? readReason('tower_title', '尚未達到這個稱號的通關層數') : null);
    return { ...title, unlocked, canEquip: reason === null, reason };
  });
  return {
    ...scene, canCreate: blockedReason === null, blockedReason,
    active: join(scene.active), party: join(scene.party),
    directory: { ...scene.directory, parties: scene.directory.parties.map(join) }, history: scene.history.map(join),
    tower: {
      rules: TOWER_RULES, daily, badges, best, title: towerTitle(char), titles, offers, equipment, areas,
      canOperate: workshopBlocked === null, blockedReason: workshopBlocked,
    },
  };
}
