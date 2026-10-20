import {ENHANCE} from './constants.js';
import {itemStat,mainStatOf} from './stats.js';

// Display-only projection through the real stat formula. No RNG, payments or
// item mutation. A compact table also supports any automatic-enhancement goal.
export function enhancementGrowth(item,wearerClass){
 if((item.enhance_level||0)>=ENHANCE.max)return null;
 return {statName:({atk:'攻擊力',def:'防禦力',mp:'魔力',hp:'生命值'})[mainStatOf(item.slot)],
  byLevel:Array.from({length:ENHANCE.max+1},(_,enhance_level)=>itemStat({...item,enhance_level},wearerClass).main)};
}
