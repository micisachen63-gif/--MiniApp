import {COLLECTION_BLESSINGS,collectionBlessingView} from './collection-blessings.js';
import {MONSTER_DATA,MONSTER_RECIPES,MONSTER_ITEMS} from './monster-data.js';
import {READY_MONSTER_KEYS} from './monster-readiness.js';
import {mapForLevel} from './formulas.js';
// Map boss core exchange: priced well above farming (a boss kill gives 1 core/day-capped), scaled by map.
export const CORE_EXCHANGE=Object.freeze({goldPerMap:2000,fragmentsPerMap:15});
export const coreExchangePrice=n=>({gold:CORE_EXCHANGE.goldPerMap*n,fragments:CORE_EXCHANGE.fragmentsPerMap*n});
export function coreExchangeOffers(inv={},char={}) {
  const reach=mapForLevel(char.level||1);
  return MONSTER_RECIPES.filter(r=>r.mapId<=reach).map(r=>{const need=r.ingredients.find(x=>x.item===`hunt_${r.mapId}_core`);return need?{mapId:r.mapId,item:need.item,name:MONSTER_ITEMS[need.item]?.name||need.item,have:inv[need.item]||0,need:need.qty,owned:(inv[r.item]||0)>0,...coreExchangePrice(r.mapId)}:null;}).filter(Boolean);
}
const ready = new Set(READY_MONSTER_KEYS);
const pools=new Map(), identities=new Map();
for(const m of MONSTER_DATA){const key=`${m.mapId}:${m.role}`;if(!pools.has(key))pools.set(key,[]);pools.get(key).push(m);identities.set(`${key}:${m.name}`,m);}
const livePools=new Map([...pools].map(([key,pool])=>[key,pool.filter(m=>!m.expansion||ready.has(m.spriteKey))]));
export {MONSTER_RECIPES};
export function monsterPool(mapId,role='normal',{includePending=false,readyKeys=ready}={}) {
  const key=`${Number(mapId)}:${role}`;
  if(includePending)return pools.get(key)||[];
  if(readyKeys===ready)return livePools.get(key)||[];
  return (pools.get(key)||[]).filter(m=>!m.expansion||readyKeys.has(m.spriteKey));
}
export function monsterIdentity(mapId,name,role='normal') {
  return identities.get(`${Number(mapId)}:${role}:${name}`)||monsterPool(mapId,role)[0];
}
export function chooseMonster(mapId,role,serial,options) {
  const pool=monsterPool(mapId,role,options);return pool[((Math.floor(serial)%pool.length)+pool.length)%pool.length];
}
export function monsterMeta() {
  return {monsters:MONSTER_DATA.map(m=>({...m,ready:!m.expansion||ready.has(m.spriteKey)})),recipes:MONSTER_RECIPES};
}
// Drops can only be earned by the authoritative HP resolver, never animation/UI counters.
// One material maximum per fighting minute, independent RNG and per-map/day caps.
export function monsterMaterialPlan(round,rng,counts={},inv={}) {
  const kills=round.defeated||[],out={};
  const award=(key,cap)=>{if(!materialUseful(inv,key)||(counts[key]||0)>=cap)return;counts[key]=(counts[key]||0)+1;out[key]=(out[key]||0)+1;};
  const normal=kills.filter(e=>!e.elite&&e.hp===0);
  if(normal.length&&rng()<.15){const e=normal[Math.floor(rng()*normal.length)],m=monsterIdentity(e.mapId,e.name);award(m.material,24);}
  if(kills.some(e=>e.elite&&e.hp===0))award(`hunt_${round.mapId}_sigil`,4);
  return out;
}
export function bossCorePlan(boss,attackers) {
  if(boss.hp!==0||!['settling','killed'].includes(boss.status))return [];
  const seen=new Set();return [...attackers].sort((a,b)=>b.damage-a.damage).filter(a=>{const account=String(a.char.account_tg_id||a.tg_id);if(a.damage<=0||a.lootToday>=4||seen.has(account))return false;seen.add(account);return true;}).filter(a=>materialUseful(a.inv||{},`hunt_${boss.map_id}_core`)).map(a=>({tgId:a.tg_id,item:`hunt_${boss.map_id}_core`,qty:1}));
}
export function materialPair(source,target) {
  const parse=item=>/^hunt_(\d+)_(1|2|3|sigil|core)$/.exec(item);
  const a=parse(source),b=parse(target);
  return !!(a&&b&&MONSTER_ITEMS[source]&&MONSTER_ITEMS[target]&&Number(a[1])>Number(b[1])&&a[2]===b[2]);
}
export function materialPurposes(item) {
  if(!MONSTER_ITEMS[item]||!item.startsWith('hunt_'))return [];
  return MONSTER_RECIPES.flatMap(recipe=>recipe.ingredients.filter(x=>x.item===item||materialPair(item,x.item)).map(x=>({collection:recipe.item,item:x.item,qty:x.qty})));
}
export function materialUseful(inv,item) {
  return materialPurposes(item).some(p=>(inv[p.collection]||0)<1&&(inv[p.item]||0)<p.qty);
}
export function refineOptions(inv) {
  const out=[];
  for(const recipe of MONSTER_RECIPES){if((inv[recipe.item]||0)>0)continue;
    for(const x of recipe.ingredients){if((inv[x.item]||0)>=x.qty)continue;
      for(const [source,have]of Object.entries(inv))if(have>=3&&materialPair(source,x.item))out.push({source,target:x.item,have,qty:3,gain:1});
    }
  }
  return out;
}
export function collectionView(inv,char={}) {const active=collectionBlessingView(char,inv);return {coreExchange:coreExchangeOffers(inv,char),activeMapId:active?.mapId||0,activeBlessing:active,universal:true,unlocked:MONSTER_RECIPES.filter(r=>(inv[r.item]||0)>0).map(r=>({mapId:r.mapId,item:r.item,name:r.name,spell:r.spell})),recipes:MONSTER_RECIPES.map(r=>({...r,blessing:COLLECTION_BLESSINGS.find(x=>x.mapId===r.mapId),active:active?.mapId===r.mapId,owned:(inv[r.item]||0)>0,ingredients:r.ingredients.map(x=>({...x,have:inv[x.item]||0}))})),refineOptions:refineOptions(inv)};}
