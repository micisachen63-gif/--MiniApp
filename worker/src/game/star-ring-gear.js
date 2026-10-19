import {makeEliteGear,makeGear,gearName} from './gear.js';
import {mapForLevel} from './formulas.js';
import {TIER_LEVEL_REQ,WEAPON_KINDS,STAR_RING_GEAR} from './constants.js';
import {rollAffixes,affixLines,affixSlots,rangeFor} from './affixes.js';
import {rngFor} from './rng.js';

export {STAR_RING_GEAR} from './constants.js';
const bonusOf=e=>{try{return JSON.parse(e.bonus_json||'{}');}catch{return {};}};
export const legacyStarRingGear=e=>e.source==='star_ring'&&(bonusOf(e).starRingGearVersion||0)<STAR_RING_GEAR.version;
export function makeStarRingGear({level,...options}){
 const e=makeEliteGear({...options,tier:mapForLevel(level),rarityFloor:STAR_RING_GEAR.rarityFloor});
 e.source='star_ring';e.name=e.name.replace(/^菁英/,'星征');
 e.bonus_json=JSON.stringify({...bonusOf(e),starRingGearVersion:STAR_RING_GEAR.version});return e;
}
// Keep the published personal extra-drop roll/count. Only the equipment recipe
// changes, using an isolated stream and the recipient's post-EXP live level.
export function starRingEquipmentReward(state,actor,index,old,level){
 const rng=rngFor(`${state.seed}:equipment-v1:${actor.id}:${index}`);
 return old.map(e=>makeStarRingGear({id:e.id,tgId:actor.id,cls:actor.base,classPath:actor.path,level,rng,now:state.endsAt}));
}
// One-time repair, never an item that automatically levels forever. Preserve
// enhancements, ownership, binding, element and all authored affix keys/scores.
export function repairStarRingGear(item,char){
 if(!legacyStarRingGear(item))return item;
 const tier=Math.max(item.tier,mapForLevel(char.level)),cls=item.class_req==='any'?char.base_class:item.class_req;
 const reference=t=>makeGear({id:item.id,tgId:item.tg_id,cls,slot:item.slot,kind:item.kind,tier:t,rng:()=>.5,forceRarity:item.element_tier,now:item.created_at});
 const before=reference(item.tier),after=reference(tier),bonus=bonusOf(item),oldBonus=bonusOf(before),newBonus=bonusOf(after);
 for(const key of ['hp','mp','atk','def'])if(newBonus[key]!=null||oldBonus[key]!=null)bonus[key]=(bonus[key]||0)+(newBonus[key]||0)-(oldBonus[key]||0);
 bonus.starRingGearVersion=STAR_RING_GEAR.version;
 const base=Math.max(item.base_stat,Math.round(item.base_stat*after.base_stat/Math.max(1,before.base_stat))),e={...item,tier,level_req:TIER_LEVEL_REQ[tier],base_stat:base,
  element_stat:Math.max(item.element_stat,Math.round(item.element_stat*base/Math.max(1,item.base_stat))),bonus_json:JSON.stringify(bonus),
  element_tier:item.element_tier==='supreme'?'supreme':'legendary',name:'星征'+(item.slot==='weapon'?WEAPON_KINDS[item.kind].names[tier]:gearName(cls,item.slot,tier))};
 const lines=affixLines(item).map(line=>{const [lo,hi]=rangeFor(e,line.key);return {...line,value:Math.max(line.value,Math.round((lo+(hi-lo)*line.score/100)*10000)/10000)};});
 e.affixes_json=JSON.stringify(lines);
 if(lines.length<affixSlots(e))e.affixes_json=JSON.stringify(rollAffixes(e,rngFor('star-ring-gear-repair-v1:'+item.id),lines.map((_,i)=>i)));
 return e;
}
