// v3 only. Separate private loot streams never consume combat/encounter RNG.
import {rngFor} from './rng.js';
import {guardianChance} from './guardian-effects.js';
export const RANK_REWARDS=Object.freeze({eliteMinutes:2,bossMinutes:8,elitePerHour:2,bossPerHour:1,eliteScrollChance:.20,eliteScrollCap:6,bossLuckyChance:.003,bossLuckyAdvancedChance:.005,bossLuckyCap:1,coreCost:60,maxBonusMinutes:144});
export const hasRankRewards=s=>s.engineVersion===3;
export const CORE='star_ring_core';
// Only completed server combat defeats count. Sightings, retreats, projections
// and remaining HP can never create an entitlement. Limits are per run/hour.
export function creditedDefeats(result){
 const seen=new Set(),hours=new Map(),out=[];
 for(const d of result.defeats||[]){
  if(!['elite','boss'].includes(d.rank)||!Number.isInteger(d.hourIndex)||d.hourIndex<0||d.hourIndex>11||!Number.isInteger(d.serial)||d.serial<1)continue;
  const key=`${d.hourIndex}:${d.serial}`;if(seen.has(key))continue;seen.add(key);
  const count=hours.get(d.hourIndex)||{elite:0,boss:0},cap=d.rank==='elite'?RANK_REWARDS.elitePerHour:RANK_REWARDS.bossPerHour;
  if(count[d.rank]>=cap)continue;count[d.rank]++;hours.set(d.hourIndex,count);out.push(d);
 }return out;
}
export function rankReward(state,actor,index,result){
 const bonus={exp:0,expMinutes:0,eliteKills:0,bossKills:0,items:{}};
 let scrolls=0,lucky=0;
 for(let stage=0;stage<=index;stage++){
  const battle=stage===index?result:state.results[stage];if(!battle)continue;
  for(const d of creditedDefeats(battle)){
   if(Math.floor(d.hourIndex/2)!==stage)continue;
   const current=stage===index,add=(key,n=1)=>{if(current)bonus.items[key]=(bonus.items[key]||0)+n;};
   const rng=rngFor(`${state.seed}:rank-rewards-v3:${actor.id}:${stage}:${d.hourIndex}:${d.serial}`);
   if(d.rank==='elite'){
    if(current){bonus.eliteKills++;bonus.expMinutes+=RANK_REWARDS.eliteMinutes;}
    if(scrolls<RANK_REWARDS.eliteScrollCap&&rng()<guardianChance(RANK_REWARDS.eliteScrollChance,actor)){scrolls++;add(['scroll_w','scroll_a','scroll_r'][Math.floor(rng()*3)]);}
   }else{
    if(current){bonus.bossKills++;bonus.expMinutes+=RANK_REWARDS.bossMinutes;}add(CORE);
    const chance=state.difficulty==='advanced'?RANK_REWARDS.bossLuckyAdvancedChance:RANK_REWARDS.bossLuckyChance;
    if(lucky<RANK_REWARDS.bossLuckyCap&&rng()<guardianChance(chance,actor)){lucky++;add(rng()<.5?'guaranteed_scroll_w':'guaranteed_scroll_a');}
   }
  }
 }
 bonus.exp=Math.round(actor.baselineExpPerMinute*bonus.expMinutes);return bonus;
}
