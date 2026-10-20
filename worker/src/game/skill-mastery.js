export const SKILL_MASTERY=Object.freeze({max:10,outputStep:.02,utilityStep:.01});
export const researchCost=s=>({普通:80,高級:160,稀有:320,史詩:640,傳說:960}[s.rarity]||320);
export function masteryLevel(state,id){if(!state.learned?.includes(id))return 0;return Math.max(1,Math.min(SKILL_MASTERY.max,Math.floor(Number(state.mastery?.[id])||1)));}
export function masteryView(skill,state){const level=masteryLevel(state,skill.id),extra=Math.max(0,level-1);return {level,max:SKILL_MASTERY.max,outputPct:extra*2,utilityPct:extra,nextCost:level===0?1:level>=SKILL_MASTERY.max?null:1+Math.floor((level-1)/3),recycleValue:Math.floor(researchCost(skill)/4)};}
export function masteredSkill(skill,state){return {...skill,mastery:masteryView(skill,state)};}
export const outputMultiplier=s=>1+(s.mastery?.outputPct||0)/100;
export const utilityMultiplier=s=>1+(s.mastery?.utilityPct||0)/100;
const OUTPUT=new Set(['coefficient','singleCoefficient','heal','shield','reflect','dot','summon','healDamage','healCap','leech','leechCap','overflowCap']);
const UTILITY=new Set(['breakDef','atkUp','takenUp','executeBonus','penetrate','enemyNextReduce','nextDamage','nextReduce','mark','guard','reduce','shieldBonus','echo','critUp','damageUp','overflow','shieldSlow','thiefCounter']);
export function masteredMechanics(skill,mechanics){const m={...mechanics};for(const key of Object.keys(m))if(typeof m[key]==='number'){if(OUTPUT.has(key))m[key]*=outputMultiplier(skill);else if(UTILITY.has(key))m[key]*=utilityMultiplier(skill);}return m;}
