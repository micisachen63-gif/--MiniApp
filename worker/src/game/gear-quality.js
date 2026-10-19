import {RARITY_KEYS,RELIC,STAR_RING_GEAR} from './constants.js';

// Legacy relic rows and escrow snapshots can predate the quality guarantee.
// Resolve them at every live read without rewriting locked or historical rows.
export function gearRarity(item){
 const rolled=item.element_tier||'common';
 const floor=item.grade==='relic'?RELIC.rarityFloor:item.source==='star_ring'?STAR_RING_GEAR.rarityFloor:null;
 return floor&&RARITY_KEYS.indexOf(rolled)<RARITY_KEYS.indexOf(floor)?floor:rolled;
}
// Same rule before SQL pagination, so legacy relics belong in legendary filters.
export const gearRaritySql=alias=>`CASE WHEN (${alias}.grade='relic' OR ${alias}.source='star_ring') AND ${alias}.element_tier IN ('common','advanced','epic') THEN 'legendary' ELSE ${alias}.element_tier END`;
