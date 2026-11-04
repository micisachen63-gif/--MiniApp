import { POTIONS } from './constants.js';
import { potionPreference } from './potion-choice.js';
import { autoBluePct } from './auto-blue.js';

// Independent of exploration/loot versions: saved v1-v4 runs without this
// snapshot continue their original starter-only supply rules unchanged.
export const ATLAS_SUPPLY_RULES_VERSION = 'atlas-supplies-v1';
export const ATLAS_POTION_KEYS = Object.freeze([
  'red_1', 'red_2', 'red_3', 'red_4', 'blue_1', 'blue_2', 'blue_3', 'blue_4',
]);
const RED_KEYS = ATLAS_POTION_KEYS.slice(0, 4);
const BLUE_KEYS = ATLAS_POTION_KEYS.slice(4);
const POLICY_KEYS = ['hpPreference', 'mpPreference', 'hpThresholdPct', 'mpThresholdPct', 'autoBlue'];
const SNAPSHOT_KEYS = ['supplyRulesVersion', 'items', 'initialItems', 'usedItems', 'restoreByItem', 'priceByItem', 'policy'];
const owns = (value, key) => value != null && Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sum = (items, keys) => keys.reduce((total, key) => total + items[key], 0);
const round = value => Math.round(value * 1000) / 1000;

export class AtlasSupplyError extends Error {
  constructor(code, message) { super(message); this.name = 'AtlasSupplyError'; this.code = code; this.status = 400; }
}
const invalid = message => { throw new AtlasSupplyError('atlas_invalid_supplies', message); };
const unsupported = () => { throw new AtlasSupplyError('atlas_supply_rules_unsupported', '不支援的星圖補給規則版本'); };
const quantity = value => Number.isInteger(value) && value >= 0 && value <= 500;
const percentage = value => Number.isInteger(value) && value >= 20 && value <= 80;

/** Read saved native settings only. Never accept these values from a start body. */
export function atlasSupplyPolicyForCharacter(character = {}) {
  const char = character || {};
  return {
    hpPreference: potionPreference(char, 'red'),
    mpPreference: potionPreference(char, 'blue'),
    hpThresholdPct: percentage(char.auto_red_pct) ? char.auto_red_pct : 50,
    mpThresholdPct: autoBluePct(char),
    autoBlue: !!char.auto_blue,
  };
}

function policySnapshot(input) {
  if (!record(input) || Object.keys(input).some(key => !POLICY_KEYS.includes(key)) ||
      POLICY_KEYS.some(key => !owns(input, key))) invalid('缺少完整的星圖喝水設定');
  if (input.hpPreference !== 'auto' && !RED_KEYS.includes(input.hpPreference)) invalid('生命藥水種類無效');
  if (input.mpPreference !== 'auto' && !BLUE_KEYS.includes(input.mpPreference)) invalid('魔力藥水種類無效');
  if (!percentage(input.hpThresholdPct) || !percentage(input.mpThresholdPct)) invalid('喝水門檻要在 20–80%');
  if (typeof input.autoBlue !== 'boolean') invalid('自動魔力藥水設定無效');
  return Object.fromEntries(POLICY_KEYS.map(key => [key, input[key]]));
}

function quantitySnapshot(input, complete = false) {
  if (!record(input) || Object.keys(input).some(key => !ATLAS_POTION_KEYS.includes(key))) invalid('星圖補給只能包含八種既有藥水');
  const items = {};
  for (const key of ATLAS_POTION_KEYS) {
    if (complete && !owns(input, key)) invalid('星圖補給快照不完整');
    const value = owns(input, key) ? input[key] : 0;
    if (!quantity(value)) invalid('星圖藥水數量超出有效範圍');
    items[key] = value;
  }
  if (sum(items, RED_KEYS) > 500 || sum(items, BLUE_KEYS) > 500) invalid('每種顏色最多攜帶 500 瓶藥水');
  return items;
}

/** Returns null only for a completely unversioned legacy input. Restore values
 * and shop prices are copied from the server catalog, never caller overrides. */
export function createAtlasSupplyState(input) {
  if (!SNAPSHOT_KEYS.some(key => owns(input, key))) return null;
  if (owns(input, 'supplyRulesVersion') && input.supplyRulesVersion !== ATLAS_SUPPLY_RULES_VERSION) unsupported();
  if (!owns(input, 'items') || !owns(input, 'policy')) invalid('新補給需要完整的藥水與喝水設定');
  const items = quantitySnapshot(input.items), policy = policySnapshot(input.policy);
  const hp = sum(items, RED_KEYS), mp = sum(items, BLUE_KEYS);
  return {
    supplyRulesVersion: ATLAS_SUPPLY_RULES_VERSION,
    items, initialItems: { ...items }, usedItems: Object.fromEntries(ATLAS_POTION_KEYS.map(key => [key, 0])),
    restoreByItem: Object.fromEntries(ATLAS_POTION_KEYS.map(key => [key, POTIONS[key].heal])),
    priceByItem: Object.fromEntries(ATLAS_POTION_KEYS.map(key => [key, POTIONS[key].price])),
    policy,
    hp, mp, hpInitial: hp, mpInitial: mp, hpUsed: 0, mpUsed: 0,
    // Kept for existing readers; versioned consumption uses restoreByItem.
    hpRestore: POTIONS.red_1.heal, mpRestore: POTIONS.blue_1.heal,
    lastHpAt: -1, lastMpAt: -1,
  };
}

export const isVersionedAtlasSupplies = supplies => supplies?.supplyRulesVersion === ATLAS_SUPPLY_RULES_VERSION;

/** A serialized run is authoritative but must remain internally consistent.
 * Unknown versions and partial snapshots must never fall through to legacy
 * starter refunds or gain quantity by changing aggregate counters. */
export function validateAtlasSupplyState(supplies, elapsedSeconds) {
  if (!SNAPSHOT_KEYS.some(key => owns(supplies, key))) return false;
  if (!isVersionedAtlasSupplies(supplies)) unsupported();
  policySnapshot(supplies.policy);
  const items = quantitySnapshot(supplies.items, true);
  const initial = quantitySnapshot(supplies.initialItems, true);
  const used = quantitySnapshot(supplies.usedItems, true);
  for (const key of ATLAS_POTION_KEYS) {
    if (items[key] + used[key] !== initial[key]) invalid('星圖補給餘額與使用紀錄不一致');
    const restore = supplies.restoreByItem?.[key], price = supplies.priceByItem?.[key];
    if (!Number.isFinite(restore) || restore <= 0 || restore > 100000000 ||
        !Number.isInteger(price) || price < 0 || price > 100000000) invalid('星圖藥水效果或價格快照無效');
  }
  for (const [kind, keys] of [['hp', RED_KEYS], ['mp', BLUE_KEYS]]) {
    if (supplies[kind] !== sum(items, keys) || supplies[kind + 'Initial'] !== sum(initial, keys) ||
        supplies[kind + 'Used'] !== sum(used, keys)) invalid('星圖補給總數與逐項紀錄不一致');
    const last = supplies[kind === 'hp' ? 'lastHpAt' : 'lastMpAt'];
    if (!Number.isInteger(last) || last < -1 || last > elapsedSeconds) invalid('星圖喝水時間紀錄無效');
  }
  return true;
}

function chosenPotion(supplies, kind) {
  const keys = kind === 'hp' ? RED_KEYS : BLUE_KEYS;
  const preferred = supplies.policy[kind === 'hp' ? 'hpPreference' : 'mpPreference'];
  // A selected empty tier stays empty. Auto exhausts each stocked tier before
  // moving upwards, regardless of the map or the character's shopping tier.
  return preferred === 'auto' ? keys.find(key => supplies.items[key] > 0) : supplies.items[preferred] > 0 ? preferred : null;
}

function consume(state, kind, key) {
  const supplies = state.supplies;
  supplies.items[key]--; supplies.usedItems[key]++;
  supplies[kind]--; supplies[kind + 'Used']++;
  supplies[kind === 'hp' ? 'lastHpAt' : 'lastMpAt'] = state.elapsedSeconds;
}

export function drinkAtlasHp(state) {
  const { hero, snapshot, supplies } = state;
  if (hero.hp <= 0 || hero.hp >= snapshot.maxHp * supplies.policy.hpThresholdPct / 100 ||
      supplies.hp <= 0 || supplies.lastHpAt === state.elapsedSeconds) return false;
  const key = chosenPotion(supplies, 'hp');
  if (!key) return false;
  const restored = Math.min(supplies.restoreByItem[key], snapshot.maxHp - hero.hp);
  hero.hp += restored; state.metrics.hpRestored += restored;
  consume(state, 'hp', key);
  return true;
}

export function drinkAtlasMp(state, required = 0) {
  const { hero, snapshot, supplies } = state;
  const policy = supplies.policy;
  // The native needsBlue predicate, evaluated from frozen settings: disabling
  // auto blue also disables emergency skill refills, not only threshold use.
  if (hero.hp <= 0 || !policy.autoBlue || hero.mp >= snapshot.maxMp || supplies.mp <= 0 ||
      supplies.lastMpAt === state.elapsedSeconds ||
      !(hero.mp <= snapshot.maxMp * policy.mpThresholdPct / 100 || hero.mp < Math.min(snapshot.maxMp, required))) return false;
  const key = chosenPotion(supplies, 'mp');
  if (!key) return false;
  const restored = Math.min(supplies.restoreByItem[key], snapshot.maxMp - hero.mp);
  hero.mp = round(hero.mp + restored); state.metrics.mpRestored = round(state.metrics.mpRestored + restored);
  consume(state, 'mp', key);
  return true;
}
