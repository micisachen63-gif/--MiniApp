import {activeSettings,QUALITY_ORDER,TYPE_NAMES,TYPE_ABILITIES,QUALITY_NAMES} from './guardian-sigil-config.js';

// A separate PvE multiplier: base ATK and PK snapshots are never changed.
export function guardianEffect(row,env={}) {
 if(!row)return null;const cfg=activeSettings(env),rank=Number(row.quality);
 return {id:row.id,type:row.type,typeName:TYPE_NAMES[row.type],ability:TYPE_ABILITIES[row.type],rank,quality:QUALITY_ORDER[rank-1],qualityName:QUALITY_NAMES[rank-1],artUrl:`/art/guardian-sigil-20261013/${row.type}.webp`,damageBonus:row.type==='loot'?0:cfg.damageBonuses[rank-1],lootBonus:row.type==='loot'?cfg.lootBonuses[rank-1]:0,visual:rank>=cfg.limits.visualMinimumRank};
}
export function guardianDamageMultiplier(actor) {
 const effect=actor?.guardian;if(!effect)return 1;
 const category=(actor.base_class||actor.base)==='thief'?'melee':actor.damageType||({sword:'melee',archer:'ranged',mage:'magic',thief:'melee'})[actor.base_class||actor.base];
 return category===effect.type?1+effect.damageBonus:1;
}
/** PvE ability panel uses the same authoritative multiplier as actual damage.
 * Keep combat's base stats intact so its existing damage step applies it once. */
export function guardianStatsView(stats,actor){
 const multiplier=guardianDamageMultiplier(actor),atk=Math.round(stats.atk*multiplier);
 return {atk,power:Math.round(atk*stats.skill.mult*(stats.attackSpeedMultiplier||1)+stats.def*1.5+stats.maxHp/10+stats.maxMp/20),baseAtk:stats.atk,basePower:stats.power,guardianAttackPct:multiplier-1};
}
export const guardianLootMultiplier=actor=>1+(actor?.guardian?.lootBonus||0);
export const guardianChance=(chance,actor)=>Math.min(1,Math.max(0,chance*guardianLootMultiplier(actor)));
export function groupGuardianChance(chance,actors){return Math.min(1,chance*(actors.length?actors.reduce((n,a)=>n+guardianLootMultiplier(a.char||a),0)/actors.length:1));}
export function guardianLootWinner(actors,rng){let roll=rng()*actors.reduce((n,a)=>n+guardianLootMultiplier(a.char||a),0);for(const actor of actors){roll-=guardianLootMultiplier(actor.char||actor);if(roll<0)return actor;}return actors.at(-1);}
