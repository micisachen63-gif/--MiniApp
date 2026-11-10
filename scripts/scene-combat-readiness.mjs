// Read-only integration check against the exact resolver used by live combat.
// Populated art frames alone do not prove that a cast can release its effect.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createActorReleaseResolver} from '../worker/public/skill-vfx-actor-bridge.mjs';
const directions=['up','down','right','left'];
export async function auditCombatActors(actors,options={}){
 const resolver=createActorReleaseResolver(options),rows=[];
 for(const actor of actors){
  for(const direction of directions){
   const source=actor.clips?.attack?.[direction];
   const clip={source,durations:source?.frames?.map(frame=>frame.durationMs||125)||[]};
   const animator={ready:true,actor,generation:actor.id,clips:{attack:{[direction]:clip}}};
   const row={actorId:actor.id,family:actor.family,direction};
   try{const result=await resolver.resolve({animator,actorId:actor.id,direction,requireOrigin:true});row.ok=true;row.authority=result.authority;}
   catch(error){row.ok=false;row.reason=error.code||error.message;}
   rows.push(row);
  }
 }
 return {slots:rows.length,ready:rows.filter(row=>row.ok).length,failures:rows.filter(row=>!row.ok),rows};
}
export async function packagedCombatReadiness(publicRoot,index){
 const origin='http://packaged-scene.invalid';
 const local=async input=>{
  const url=new URL(input,origin),file=path.resolve(publicRoot,'.'+url.pathname),relative=path.relative(publicRoot,file);
  if(url.origin!==origin||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return new Response('',{status:400});
  try{return new Response(await fs.readFile(file));}catch(error){if(error.code==='ENOENT')return new Response('',{status:404});throw error;}
 };
 const actors=[];
 for(const ref of index.actors){const response=await local(ref.actorUrl);if(!response.ok)throw Error('Missing actor metadata: '+ref.id);actors.push(await response.json());}
 return auditCombatActors(actors,{origin,fetch:local});
}
