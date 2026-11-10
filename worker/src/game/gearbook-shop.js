import { ARMOR_PRICE, GENERAL_WEAPON, RARITIES, WEAPON_PRICE } from './constants.js';
import { armorPrice, weaponPrice } from './gear.js';
import { equipmentCollectionCatalog, matchesCollectionRequirement } from './equipment-collection.js';
import { modeForLevel } from './endgame.js';

export const GEARBOOK_SHOP_VERSION = 'gearbook-shop-v1';

// Gold = 1.2 × expected net shop cost to roll the collection minimum rarity,
// rounded; dust = 8 × tier. See the 2026-11-10 approved spec.
const GOLD = Object.freeze({
  weapon: Object.freeze({ 1:1800, 2:3000, 3:4200, 4:9600, 5:12500, 6:16000, 7:44000, 8:53500, 9:64500, 10:206000, 11:241000, 12:280000 }),
  armor: Object.freeze({ 1:1200, 2:1900, 3:2800, 4:6200, 5:8200, 6:10500, 7:28500, 8:35000, 9:42000, 10:132000, 11:155000, 12:180000 }),
  piece: Object.freeze({ 1:700, 2:1200, 3:1700, 4:3800, 5:5000, 6:6400, 7:17500, 8:21500, 9:26000, 10:83000, 11:97000, 12:112000 }),
  belt: Object.freeze({ 1:550, 2:900, 3:1300, 4:3000, 5:4000, 6:5000, 7:13500, 8:16500, 9:20000, 10:62500, 11:73500, 12:85000 }),
  undershirt: Object.freeze({ 1:500, 2:800, 3:1200, 4:2700, 5:3500, 6:4400, 7:12000, 8:14500, 9:17500, 10:55500, 11:65000, 12:75500 }),
  earring: Object.freeze({ 1:600, 2:1000, 3:1400, 4:3300, 5:4300, 6:5400, 7:14500, 8:18000, 9:21500, 10:68500, 11:80500, 12:93500 }),
  ring: Object.freeze({ 1:700, 2:1100, 3:1600, 4:3700, 5:4800, 6:6100, 7:16500, 8:20000, 9:24000, 10:77000, 11:90000, 12:104000 }),
});

export const gearbookShopDust = tier => 8 * tier;

function slotTable(slot) {
  if (slot === 'weapon') return GOLD.weapon;
  if (slot === 'armor') return GOLD.armor;
  if (slot === 'belt') return GOLD.belt;
  if (slot === 'undershirt') return GOLD.undershirt;
  if (slot === 'earring') return GOLD.earring;
  if (slot === 'ring') return GOLD.ring;
  return GOLD.piece;
}

export function gearbookShopGold(slot, tier) {
  return slotTable(slot)[tier] ?? null;
}

export function gearbookShopCost(requirement) {
  const gold = gearbookShopGold(requirement.slot, requirement.tier);
  if (gold == null) return null;
  return { gold, dust: gearbookShopDust(requirement.tier) };
}

export function findGearbookShopRequirement(baseClass, collectionId, requirementId) {
  const collection = equipmentCollectionCatalog(baseClass).find(row => row.id === collectionId);
  const requirement = collection?.requirements.find(row => row.id === requirementId);
  if (!collection || !requirement) return null;
  return { collection, requirement, cost: gearbookShopCost(requirement) };
}

export function gearbookShopOffer(collection, requirement, { gold = 0, dust = 0, level = 1, registered = false, lockedReason = null } = {}) {
  const cost = gearbookShopCost(requirement);
  if (!cost) return null;
  const levelLocked = level < collection.minLevel;
  const blocked = registered ? '此收藏欄位已填入' : lockedReason || (levelLocked ? `需要 Lv.${collection.minLevel} 才能兌換` : null);
  return {
    collectionId: collection.id,
    requirementId: requirement.id,
    name: requirement.name,
    slot: requirement.slot,
    tier: requirement.tier,
    minRarity: requirement.minRarity,
    rarityName: requirement.rarityName,
    minEnhance: requirement.minEnhance,
    minLevel: collection.minLevel,
    gold: cost.gold,
    dust: cost.dust,
    bound: true,
    tradeable: false,
    wearable: true,
    enhanceLevel: 0,
    registered,
    levelLocked,
    blockedReason: blocked,
    affordable: !blocked && gold >= cost.gold && dust >= cost.dust,
  };
}

/** Shop list price used only as a sanity check against the approved table. */
export function gearbookShopReferencePrice(requirement) {
  return requirement.slot === 'weapon' ? weaponPrice(GENERAL_WEAPON[requirement.baseClass] || requirement.kind, requirement.tier) : armorPrice(requirement.slot, requirement.tier);
}

export { WEAPON_PRICE, ARMOR_PRICE, RARITIES, modeForLevel, matchesCollectionRequirement };
