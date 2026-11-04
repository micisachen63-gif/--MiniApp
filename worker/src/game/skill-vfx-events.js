// Presentation descriptors are authored only at real resolver branches.
// Callers may expose "committed-combat" only after their existing atomic commit;
// star-ring's uncommitted deterministic view uses its distinct projection source.
// This module never consumes randomness, changes combat values, or chooses targets.
import {SPECIAL_SKILLS} from './special-data.js';
const specialIds=new Set(SPECIAL_SKILLS.map(s=>'special:'+s.id));
const bases=new Set(['sword','archer','mage','thief']);
const ids=value=>[...new Set((value||[]).filter(v=>typeof v==='string'||typeof v==='number').map(String).filter(Boolean))];
const actorId=a=>String(a?.id??a?.tg_id??'');
export function nativeSkillIdentity(actor){
 const base=actor?.base??actor?.base_class,path=String(actor?.path??actor?.class_path??'');
 return bases.has(base)&&(/^(?:[AB][12]{0,3})?$/.test(path))?'native:'+base+':'+(path||'base'):null;
}
export function validSkillVfxIdentity(id){
 if(specialIds.has(id))return true;
 const m=/^native:(sword|archer|mage|thief):(base|[AB][12]{0,3})$/.exec(String(id));
 return !!m;
}
function descriptor(actor,skillId,resolution,observation){
 if(!observation||!observation.eventId||!validSkillVfxIdentity(skillId))return null;
 const source=observation.source||'committed-combat';
 if(!['committed-combat','deterministic-projection'].includes(source))return null;
 const who=actorId(actor);if(!who)return null;
 const targetIds=ids(resolution.targetIds),enemyTargetIds=ids(resolution.enemyTargetIds),allyTargetIds=ids(resolution.allyTargetIds);
 return {schemaVersion:1,source,eventId:String(observation.eventId),skillId,kind:resolution.kind||'cast',actorId:who,atMs:Number(observation.atMs??0),
  targetKind:resolution.targetKind,targetIds,presentationMode:resolution.presentationMode,
  enemyTargetIds,allyTargetIds,...(resolution.effectKind?{effectKind:resolution.effectKind}:{}),
  ...(resolution.recipientEffects?.length?{recipientEffects:resolution.recipientEffects.map(e=>({kind:e.kind,targetIds:ids(e.targetIds)})).filter(e=>e.targetIds.length)}:{}),
  ...(observation.damageModel?{damageModel:observation.damageModel}:{}),
  ...(observation.encounterId?{encounterId:String(observation.encounterId)}:{})};
}
export function nativeCastVfx(actor,observation){
 const targetIds=ids(observation?.enemyIds||[observation?.enemyId]);
 if(!targetIds.length)return null;
 return descriptor(actor,nativeSkillIdentity(actor),{targetKind:'enemy',targetIds,enemyTargetIds:targetIds,allyTargetIds:[],presentationMode:'full'},observation);
}
export function specialCastVfx(actor,skill,m,resolution,observation){
 if(!observation)return null;
 const who=actorId(actor),targets=ids((resolution.targets||[]).map(actorId)),chosen=actorId(resolution.target);
 const recipients=[],add=(kind,targetIds)=>{targetIds=ids(targetIds);if(targetIds.length)recipients.push({kind,targetIds});};
 if(m.heal||m.healDamage||m.revive)add('heal',targets);
 if(m.leech)add('heal',[who]);
 if(m.shield||m.overflow)add('shield',targets);
 if(['atkUp','takenUp','reduce','nextReduce','nextDamage','damageUp','echo','critUp','cleanse','shieldSlow','lastStand','thiefCounter','accelerate','reflect'].some(k=>m[k]))add('buff',targets);
 if(m.guard)add('buff',[who,chosen]);
 if(m.summon)add('summon',[who]);
 const allyTargetIds=ids(recipients.flatMap(x=>x.targetIds));
 const direct=Number(resolution.coefficient)>0;
 const enemyTargetIds=direct?ids([observation.enemyId]):[];
 const targetIds=direct?enemyTargetIds:allyTargetIds;
 const targetKind=direct?'enemy':targetIds.length===1&&targetIds[0]===who?'self':'ally';
 return descriptor(actor,'special:'+skill.id,{targetKind,targetIds,enemyTargetIds,allyTargetIds,presentationMode:direct?'full':m.summon?'summon':'support',recipientEffects:direct?recipients:[]},observation);
}
export function vfxOrigin(vfx){return vfx?{skillId:vfx.skillId,actorId:vfx.actorId,eventId:vfx.eventId}:null;}
export function effectVfx(origin,observation){
 if(!origin||!observation||!observation.enemyId||!(observation.damage>0))return null;
 return descriptor({id:origin.actorId},origin.skillId,{kind:'effect',effectKind:observation.effectKind||'dot',targetKind:'enemy',targetIds:[observation.enemyId],enemyTargetIds:[observation.enemyId],allyTargetIds:[],presentationMode:'impact'},observation);
}
