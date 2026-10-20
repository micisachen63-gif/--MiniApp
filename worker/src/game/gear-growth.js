// Derived growth only: retain original rolls, enhancement levels and all inventory rows.
// Base growth carries the tier ladder; the existing risky enhancement curve is unchanged.
import {ARMOR_FAMILIES,SHARED_SLOTS,SLOT_SPEC} from './constants.js';
export const GEAR_GROWTH = Object.freeze({
 version:2,
 tierBase:Object.freeze([0,0,0,24,65,125,220,310,410,520,640,770]),
 slotWeight:Object.freeze({weapon:1.25,armor:1.3,helmet:1,gloves:.85,boots:.85,belt:.85,undershirt:.85,ring:.85,earring:1}),
 legacyExpeditionMult:1.15,
 farmingEfficiencyCap:1.10,
 referenceArmorFamily:.75,
});
export function tierBaseBonus(item,version=GEAR_GROWTH.version,wearerClass=null){
 if(version<2)return 0;
 const tier=Math.max(1,Math.min(12,Math.floor(Number(item.tier)||1)));
 // Shared DEF already receives the wearer's family multiplier in itemStat.
 // Class-specific pieces need it on their new foundation too: cloth/light
 // leather must not become plate when the flat tier term dominates old rolls.
 const family=SLOT_SPEC[item.slot]?.main==='def'&&!SHARED_SLOTS.includes(item.slot)
  ?(ARMOR_FAMILIES[item.class_req||wearerClass]?.defMult??GEAR_GROWTH.referenceArmorFamily)/GEAR_GROWTH.referenceArmorFamily:1;
 return Math.round(GEAR_GROWTH.tierBase[tier-1]*(GEAR_GROWTH.slotWeight[item.slot]||0)*family);
}
