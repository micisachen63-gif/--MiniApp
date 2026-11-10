import {GENERAL_WEAPON,WEAPON_KINDS,TIER_PREFIX,TIER_LEVEL_REQ,RARITY_KEYS,RARITIES} from './constants.js';
import {gearName} from './gear.js';
import {gearRarity} from './gear-quality.js';

export const EQUIPMENT_COLLECTION_VERSION='equipment-collection-v1';
const cache=new Map();
const bonusCache=new Map(),emptyBonuses=Object.freeze({});
const labels={atkPct:'攻擊',defPct:'防禦',maxHpPct:'生命上限',maxMpPct:'魔力上限',critPct:'暴擊機率'};
export const equipmentCollectionText=bonuses=>Object.entries(bonuses).map(([key,value])=>`${labels[key]} +${Number((value*100).toFixed(2))}${key==='critPct'?' 個百分點':'%'}`).join(' · ')||'尚未獲得永久能力';
export function equipmentCollectionCatalog(baseClass){
 if(cache.has(baseClass))return structuredClone(cache.get(baseClass));
 const weapon=GENERAL_WEAPON[baseClass];if(!weapon)throw new Error('Invalid collection class');
 const definitions=[['journey','征途',['weapon','armor','boots'],{atkPct:.003}],['watch','守望',['helmet','gloves','undershirt'],{defPct:.003,maxHpPct:.005}],['relics','秘藏',['belt','ring','earring'],{maxMpPct:.005,critPct:.001}]];
 const catalog=[];for(let tier=1;tier<=12;tier++)for(const [key,title,slots,bonuses]of definitions){
  const enhance=[2,3,3,4,4,5,5,6,6,7,7,8][tier-1],rarity=tier>=10?'legendary':tier>=7?'epic':tier>=4?'advanced':'common';
  catalog.push({id:`${baseClass}:t${tier}:${key}`,version:EQUIPMENT_COLLECTION_VERSION,name:`${TIER_PREFIX[tier]}${title}`,tier,minLevel:TIER_LEVEL_REQ[tier],category:key,bonuses:{...bonuses},rewardText:equipmentCollectionText(bonuses),requirements:slots.map(slot=>({id:slot,slot,tier,baseClass:slot==='weapon'||['armor','helmet','gloves','boots'].includes(slot)?baseClass:'any',kind:slot==='weapon'?weapon:null,name:slot==='weapon'?WEAPON_KINDS[weapon].names[tier]:gearName(baseClass,slot,tier),minEnhance:enhance,minRarity:rarity,rarityName:RARITIES[rarity].name}))});
 }
 cache.set(baseClass,catalog);return structuredClone(catalog);
}
export function matchesCollectionRequirement(item,requirement){
 return !!item&&item.slot===requirement.slot&&item.tier===requirement.tier&&item.class_req===requirement.baseClass&&(!requirement.kind||item.kind===requirement.kind)&&Number.isInteger(item.enhance_level)&&item.enhance_level>=requirement.minEnhance&&RARITY_KEYS.indexOf(gearRarity(item))>=RARITY_KEYS.indexOf(requirement.minRarity);
}
export function equipmentCollectionBonuses(char){
 const raw=char?.equipment_collection_json;if(!raw||raw==='[]'||typeof raw!=='string'||raw.length>8192)return emptyBonuses;
 const key=char.base_class+'|'+raw;if(bonusCache.has(key))return bonusCache.get(key);
 let ids;try{ids=JSON.parse(raw);}catch{return emptyBonuses;}
 if(!Array.isArray(ids)||!ids.length)return emptyBonuses;
 if(!cache.has(char.base_class))equipmentCollectionCatalog(char.base_class);
 const known=new Map(cache.get(char.base_class).map(c=>[c.id,c])),bonuses={};
 for(const id of new Set(ids)){const row=known.get(id);if(!row)continue;for(const [key,value]of Object.entries(row.bonuses))bonuses[key]=Math.round(((bonuses[key]||0)+value)*10000)/10000;}
 if(bonusCache.size>=256)bonusCache.delete(bonusCache.keys().next().value);
 const frozen=Object.freeze(bonuses);bonusCache.set(key,frozen);return frozen;
}
