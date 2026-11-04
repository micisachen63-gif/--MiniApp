import { GameError } from './classes.js';
import { taipeiDay, taipeiAt, isoWeek, TPE_OFFSET_MS } from './time.js';
import { getAtlasMap } from './atlas-catalog.js';

export const ATLAS_QUEST_RULES_VERSION = 'atlas-quests-v2';
export const ATLAS_ACTIVITY_KINDS = Object.freeze(['kill','elite','encounter','loot_equipment','loot_scroll','completion','safe_completion','survival','collection','reclaim']);
export const QUEST_DAY_MS = 86400000;
export const ATLAS_QUEST_DAILY_CLAIM_DAYS = 3;
export const ATLAS_QUEST_WEEKLY_GRACE_DAYS = 7;
const THEMES = Object.freeze([
  Object.freeze({ themeId: 1, mapId: 'laurel_intro' }),
  Object.freeze({ themeId: 2, mapId: 'pillar_intro' }),
  Object.freeze({ themeId: 3, mapId: 'grove_intro' }),
]);
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const reward = materials => ({ materials, gold: 0, exp: 0 });
const quest = (id, title, description, category, criteria, target, rewards, action = 'maps', mapId = null) => ({
  id, title, description, category, criteria, target, rewards: reward(rewards), action, mapId, rulesVersion: 'atlas-quests-v1',
  period: category === 'daily' ? 'day' : category === 'weekly' ? 'week' : 'lifetime',
  unit: criteria.mode?.startsWith('distinct') ? '種' : '次',
});

/** Small prototype material bonuses. No streak multipliers, gold, experience,
 * login event, or account-wide battle power. Balance awaits production baselines.
 */
export const LEGACY_ATLAS_QUESTS = freeze([
  quest('intro_build', '選好你的流派', '保存一組主技能、輔助與自動施放配置。', 'tutorial', { kind: 'configure' }, 1, { atlas_shard: 2 }, 'loadout'),
  quest('intro_departure', '第一次星圖派遣', '攜帶補給，完成一次出征登記。', 'tutorial', { kind: 'start' }, 1, { atlas_shard: 2 }),
  quest('intro_clear', '帶回首張戰報', '完整通過任一星圖。', 'tutorial', { kind: 'completion' }, 1, { atlas_shard: 2, atlas_iron: 1 }),
  quest('intro_craft', '第一次定向鍛造', '以星圖材料完成一次裝備銘刻，保留原本強化值。', 'tutorial', { kind: 'craft' }, 1, { atlas_shard: 2 }, 'craft'),
  quest('intro_boss', '守望者的試煉', '擊敗月桂試煉首領。', 'tutorial', { kind: 'completion', mapId: 'laurel_warden' }, 1, { atlas_shard: 3 }, 'maps', 'laurel_warden'),
  quest('daily_workshop', '每日工坊整備', '完成一次定向鍛造；這是少量額外材料，不必每日報到。', 'daily', { kind: 'craft' }, 1, { atlas_shard: 1 }, 'craft'),
  quest('daily_theme', '每日指定主題星圖', '通過今日指定主題的星圖。', 'daily', { kind: 'completion', mode: 'daily_theme' }, 1, { atlas_shard: 2 }),
  quest('weekly_three_themes', '每週三域巡禮', '本週通過月桂林、百柱神殿與聖林三種主題。', 'weekly', { kind: 'completion', mode: 'distinct_theme' }, 3, { atlas_shard: 3, atlas_iron: 1 }),
  quest('weekly_three_builds', '每週三種流派試煉', '本週使用三種不同流派完成星圖；同帳號角色共同累計。', 'weekly', { kind: 'completion', mode: 'distinct_build' }, 3, { atlas_shard: 3, atlas_ember: 1 }),
  ...THEMES.flatMap(({ mapId, themeId }) => [10, 50].map(target => {
    const material = ['atlas_iron', 'atlas_ember', 'atlas_venom'][themeId - 1];
    return quest(`explore_${themeId}_${target}`, `${getAtlasMap(mapId).themeName}踏查 ${target}`,
      `累計完整通過這張教學星圖 ${target} 次；進度永久保留。`, 'longterm', { kind: 'completion', mapId }, target,
      { atlas_shard: target === 10 ? 3 : 5, [material]: target === 10 ? 1 : 2 }, 'maps', mapId);
  })),
  ...[3, 15].map(target => quest(`warden_${target}`, `守望者征服 ${target}`, `累計擊敗月桂試煉首領 ${target} 次。`, 'longterm',
    { kind: 'completion', mapId: 'laurel_warden' }, target, { atlas_shard: target === 3 ? 3 : 5, atlas_core: 1 }, 'maps', 'laurel_warden')),
  quest('atlas_100', '百圖旅人', '累計完成一百張星圖；跨日與換角色仍會累計。', 'longterm', { kind: 'completion' }, 100, { atlas_shard: 6 }),
]);

/** Activity objectives have their own append-only event table. Legacy definitions
 * and reward IDs above remain unchanged; no polling or fabricated UI events count.
 */
const activityQuest = (id, title, description, category, criteria, target, rewards, options = {}) => ({
  ...quest(id, title, description, category, { ...criteria, activity: true }, target, rewards, options.action || 'maps', options.mapId || null),
  rulesVersion: ATLAS_QUEST_RULES_VERSION,
  unit: criteria.kind === 'survival' && !criteria.mode ? '秒' : criteria.mode?.includes('theme') ? '區' : criteria.mode?.includes('build') ? '種' : ['collection','reclaim','loot_equipment'].includes(criteria.kind) ? '件' : criteria.kind === 'loot_scroll' ? '張' : '次',
  prerequisites: [], ...options,
});
export const ATLAS_ACTIVITY_QUESTS = freeze([
  activityQuest('daily_hunt', '清理探索路線', '今日實際擊倒四十隻星圖敵人；菁英與首領也計入。', 'daily', { kind: 'kill' }, 40, { atlas_shard: 1 }),
  activityQuest('daily_elite', '突破菁英封鎖', '今日實際擊倒一名菁英或首領。', 'daily', { kind: 'elite' }, 1, { atlas_iron: 1 }),
  activityQuest('daily_exploration', '三十分鐘的旅程', '今日累積三十分鐘實際存活探索時間；倒地後的等待不計入。', 'daily', { kind: 'survival' }, 1800, { atlas_shard: 1 }),
  activityQuest('daily_encounter', '路途中的變數', '今日成功完成一次特殊遭遇；只看見事件或途中倒下不計入。', 'daily', { kind: 'encounter' }, 1, { atlas_shard: 1 }),
  activityQuest('daily_equipment', '帶回可用戰利品', '今日從星圖實際取得三件裝備；商店購買與交易不計入。', 'daily', { kind: 'loot_equipment' }, 3, { atlas_iron: 1 }),
  activityQuest('daily_scroll', '補充工坊物資', '今日從星圖實際取得兩張卷軸；以已入袋數量計算。', 'daily', { kind: 'loot_scroll' }, 2, { atlas_ember: 1 }),
  activityQuest('daily_safe_route', '毫髮無傷的路線', '今日完整通過一張星圖且全圖未受到生命傷害；護盾或格擋完全吸收可計入，回復生命不會消除受傷紀錄。', 'daily', { kind: 'safe_completion' }, 1, { atlas_shard: 2 }),
  activityQuest('weekly_region_encounters', '三域異象追蹤', '本週在月桂、神殿與聖林各成功完成特殊遭遇；教學圖與探索圖屬同一區。', 'weekly', { kind: 'encounter', mode: 'distinct_theme' }, 3, { atlas_shard: 3, atlas_venom: 1 }),
  activityQuest('weekly_stable_builds', '兩種穩定構築', '本週使用兩種不同流派達成全圖無生命傷害通關；只保存配置不計入。', 'weekly', { kind: 'safe_completion', mode: 'distinct_build' }, 2, { atlas_shard: 3, atlas_iron: 1 }),
  activityQuest('weekly_region_survey', '三域實地測繪', '本週在三個地區各累積至少十分鐘實際存活探索；每區達標才計一區。', 'weekly', { kind: 'survival', mode: 'qualified_theme', minimumQuantity: 600 }, 3, { atlas_shard: 3, atlas_ember: 1 }),
  activityQuest('weekly_collection', '替舊裝留下位置', '本週實際收錄三件裝備；已收錄欄位的重送不重複計算。', 'weekly', { kind: 'collection' }, 3, { atlas_shard: 2, atlas_iron: 1 }, { action: 'recovery' }),
  activityQuest('weekly_reclaim', '工坊循環補給', '本週實際回收十二件裝備；僅已提交的消耗計入，出售不計入。', 'weekly', { kind: 'reclaim' }, 12, { atlas_shard: 2, atlas_ember: 1 }, { action: 'recovery' }),
  activityQuest('weekly_supply_routes', '三域物資路線', '本週在三個地區各取得卷軸戰利品；依真實掉落地區計算。', 'weekly', { kind: 'loot_scroll', mode: 'distinct_theme' }, 3, { atlas_shard: 3, atlas_venom: 1 }),
  ...THEMES.flatMap(({ themeId, mapId }) => {
    const name = getAtlasMap(mapId).themeName, material = ['atlas_iron','atlas_ember','atlas_venom'][themeId - 1];
    const steps = [
      ['勘查足跡', '在此區累積五分鐘實際存活探索。', { kind: 'survival' }, 300, { atlas_shard: 2 }],
      ['排除威脅', '在此區實際擊倒兩名菁英或首領。', { kind: 'elite' }, 2, { [material]: 1 }],
      ['追索異象', '在此區成功完成一次特殊遭遇。', { kind: 'encounter' }, 1, { atlas_shard: 2, [material]: 1 }],
      ['完成調查', '在此區達成一次全圖無生命傷害通關；回復生命不會消除受傷紀錄。', { kind: 'safe_completion' }, 1, { atlas_shard: 3, [material]: 2 }],
    ];
    return steps.map(([title, description, criteria, target, rewards], index) => activityQuest(
      'investigate_' + themeId + '_' + (index + 1), name + '調查 ' + (index + 1) + '/4：' + title,
      description + ' 教學圖與探索圖合併計算，既有活動可追認；須先領取前一步才能領取下一步。',
      'investigation', { ...criteria, themeId }, target, rewards,
      { mapId, chainId: 'region_' + themeId, chainTitle: name + '調查', chainStep: index + 1, prerequisites: index ? ['investigate_' + themeId + '_' + index] : [] }
    ));
  }),
]);
export const ATLAS_QUESTS = freeze([...LEGACY_ATLAS_QUESTS, ...ATLAS_ACTIVITY_QUESTS]);


export function questTimestamp(value, label = '時間') {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402214400000) throw new GameError('atlas_quest_time', `${label}無效`);
  return value;
}
function dayStart(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new GameError('atlas_quest_period', '每日任務日期無效');
  const start = taipeiAt(key, 0);
  if (!Number.isFinite(start) || taipeiDay(start) !== key) throw new GameError('atlas_quest_period', '每日任務日期無效');
  return start;
}
function weekStart(key) {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) throw new GameError('atlas_quest_period', '每週任務週別無效');
  const january4 = Date.UTC(Number(match[1]), 0, 4);
  const monday = january4 - ((new Date(january4).getUTCDay() + 6) % 7) * QUEST_DAY_MS;
  const start = monday + (Number(match[2]) - 1) * 7 * QUEST_DAY_MS - TPE_OFFSET_MS;
  if (isoWeek(start + 12 * 3600000) !== key) throw new GameError('atlas_quest_period', '每週任務週別無效');
  return start;
}
export function dailyQuestTheme(dayKey) {
  dayStart(dayKey);
  const ordinal = Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / QUEST_DAY_MS);
  return { ...THEMES[((ordinal % THEMES.length) + THEMES.length) % THEMES.length] };
}

export function questInstance(questId, periodKey) {
  const definition = ATLAS_QUESTS.find(row => row.id === questId);
  if (!definition) throw new GameError('atlas_quest_unknown', '找不到這個永久任務');
  let startAt = 0, endAt = null, expiresAt = null;
  if (definition.period === 'lifetime') {
    if (periodKey !== 'lifetime') throw new GameError('atlas_quest_period', '長期任務期別無效');
  } else if (definition.period === 'day') {
    startAt = dayStart(periodKey); endAt = startAt + QUEST_DAY_MS;
    expiresAt = startAt + ATLAS_QUEST_DAILY_CLAIM_DAYS * QUEST_DAY_MS;
  } else {
    startAt = weekStart(periodKey); endAt = startAt + 7 * QUEST_DAY_MS;
    expiresAt = endAt + ATLAS_QUEST_WEEKLY_GRACE_DAYS * QUEST_DAY_MS;
  }
  const instance = { ...structuredClone(definition), questId, periodKey, startAt, endAt, expiresAt };
  if (definition.criteria.mode === 'daily_theme') {
    const theme = dailyQuestTheme(periodKey);
    instance.criteria.themeId = theme.themeId;
    instance.mapId = theme.mapId;
    instance.description = `在 ${periodKey} 通過${getAtlasMap(theme.mapId).themeName}主題的星圖；以實際通關時間計算。`;
  }
  return instance;
}

export function questInstances(now) {
  questTimestamp(now);
  const instances = [];
  for (const definition of ATLAS_QUESTS) {
    const periods = definition.period === 'lifetime' ? ['lifetime']
      : definition.period === 'day' ? Array.from({ length: ATLAS_QUEST_DAILY_CLAIM_DAYS }, (_, index) => taipeiDay(now - index * QUEST_DAY_MS))
      : [isoWeek(now), isoWeek(now - 7 * QUEST_DAY_MS)];
    for (const period of periods) instances.push(questInstance(definition.id, period));
  }
  return instances;
}

export function questClaimWindowOpen(instance, now) {
  return now >= instance.startAt && (instance.expiresAt === null || now < instance.expiresAt);
}
