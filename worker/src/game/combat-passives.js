import {CLASSES} from './constants.js';

// Shared by every encounter adapter. `taken` already includes mitigation in computeStats.
export const combatPct = actor => actor.affixPct || actor.pct || {};
export function takenMultiplier(actor) {
  if (Number.isFinite(actor.taken)) return actor.taken;
  const p=combatPct(actor),base=CLASSES[actor.base||actor.base_class]?.taken??1;
  return Math.max(.2,base*(1+(p.takenPct||0))*(1-(p.mitigationPct||0)));
}
export function specialCost(skill,pct={}) {
  return {...skill,mp:Math.max(1,Math.round(skill.mp*(1+(pct.mpCostPct||0))*(1-Math.min(.3,pct.mpEfficiencyPct||0)))),
    cooldownSeconds:Math.max(1,Math.round(skill.cooldownSeconds*(1-Math.min(.25,pct.skillHastePct||0))))};
}
export function spendMana(actor,cost,rng=Math.random) {
  const free=Math.min(1,Math.max(0,combatPct(actor).freeCastPct||0));
  const spent=free&&rng()<free?0:cost;
  actor.mp=Math.max(0,actor.mp-spent);return spent;
}
export function restoreOnAction(actor,damage,{cast=false,enabled=true}={}) {
  const p=combatPct(actor);
  const heal=enabled&&actor.hp>0?Math.round(Math.max(0,damage)*(p.lifestealPct||0)+(cast?actor.maxHp*(p.healPerCastPct||0):0)):0;
  const healed=Math.min(Math.max(0,actor.maxHp-actor.hp),Math.max(0,heal));actor.hp+=healed;
  return {heal,healed};
}
