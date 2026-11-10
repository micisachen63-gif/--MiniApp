import {SLOTS,WEAPON_KINDS,CLASS_KEYS,ARMOR_FAMILIES,SHARED_SLOTS,RARITY_KEYS,RARITIES} from './constants.js';
import {gearRarity} from './gear-quality.js';
import {affixCost} from './affixes.js';

export const EQUIPMENT_RECOVERY_VERSION='equipment-recovery-v1';
export const RECOVERY_BATCH_LIMIT=50;
export const RECOVERY_SOURCES=Object.freeze([
 {id:'ordinary',name:'旅途裝備'}, {id:'elite',name:'菁英戰利品'},
 {id:'star_ring',name:'星環遠征'}, {id:'atlas',name:'星圖探索'}, {id:'relic',name:'傳承遺物'},
]);
export function recoverySource(item){
 return item.grade==='relic'?'relic':item.source==='atlas'?'atlas':item.source==='star_ring'?'star_ring':String(item.source||'').includes('elite')?'elite':'ordinary';
}
export function archiveIdentity(item){
 if(!item||!SLOTS.includes(item.slot)||!Number.isInteger(item.tier)||item.tier<1||item.tier>12)return null;
 const rarity=gearRarity(item);if(!RARITY_KEYS.includes(rarity))return null;
 if(item.slot==='weapon'){
  const w=WEAPON_KINDS[item.kind];
  if(!w||w.cls!==item.class_req||!w.names[item.tier])return null;
 }else if(SHARED_SLOTS.includes(item.slot)){
  if(item.class_req!=='any'||item.kind!==item.slot)return null;
 }else if(!CLASS_KEYS.includes(item.class_req)||ARMOR_FAMILIES[item.class_req].key!==item.kind)return null;
 const sourceGroup=recoverySource(item);
 return {entryId:['archive-v1',sourceGroup,item.class_req,item.slot,item.kind,item.tier,rarity].join(':'),
  sourceGroup,sourceName:RECOVERY_SOURCES.find(s=>s.id===sourceGroup).name,tier:item.tier,
  rarity,rarityName:RARITIES[rarity]?.name||rarity};
}
export function recoveryYield(item){
 if(!archiveIdentity(item)||item.source==='starter')return 0;
 // Quality has a deliberately small cap. No tradable currency or scroll is minted.
 return item.tier*(RARITY_KEYS.indexOf(gearRarity(item))>=1?2:1);
}
export function highValueEquipment(item){
 return item.grade==='relic'||Number(item.enhance_level)>0||RARITY_KEYS.indexOf(gearRarity(item))>=2;
}
export function recoveryReforgeCost(item){
 if(!archiveIdentity(item))return null;
 return {dust:item.tier*10,gold:affixCost(item).fee};
}
