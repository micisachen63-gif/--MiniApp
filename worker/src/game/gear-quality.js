import {RARITY_KEYS,RELIC} from './constants.js';

// Legacy relic rows and escrow snapshots can predate the quality guarantee.
// Resolve them at every live read without rewriting locked or historical rows.
export function gearRarity(item){
 const rolled=item.element_tier||'common';
 return item.grade==='relic'&&RARITY_KEYS.indexOf(rolled)<RARITY_KEYS.indexOf(RELIC.rarityFloor)?RELIC.rarityFloor:rolled;
}
// Same rule before SQL pagination, so legacy relics belong in legendary filters.
export const gearRaritySql=alias=>`CASE WHEN ${alias}.grade='relic' AND ${alias}.element_tier IN ('common','advanced','epic') THEN 'legendary' ELSE ${alias}.element_tier END`;
