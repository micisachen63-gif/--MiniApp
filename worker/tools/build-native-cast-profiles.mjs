// Local-only sidecar generation. Original character files are never changed.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {createActorReleaseResolver} from '../public/skill-vfx-actor-bridge.mjs';
import {nativeClipShape} from '../public/scene-native-cast.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public'),origin='http://packaged-scene.invalid';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function asset(value){const u=new URL(value,origin),file=path.resolve(root,'.'+u.pathname),relative=path.relative(root,file);if(u.origin!==origin||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Source escapes public');return fs.readFile(file);}
const fetcher=async value=>{try{return new Response(await asset(value));}catch{return new Response('',{status:404});}};
const indexBytes=await asset('/ui-generated-20261030/characters-v1/character-preview-index.json'),index=JSON.parse(indexBytes),resolver=createActorReleaseResolver({origin,fetch:fetcher}),profiles=[];
const hashes=new Map();
for(const ref of index.actors){const metadata=await asset(ref.actorUrl),actor=JSON.parse(metadata);
 for(const direction of ['up','down','right','left']){
  const source=actor.clips.attack[direction],clip={source,durations:source.frames.map(f=>f.durationMs||125)},animator={ready:true,actor,generation:actor.id,clips:{attack:{[direction]:clip}}};
  try{await resolver.resolve({animator,actorId:actor.id,direction,requireOrigin:true});continue;}catch(error){if(!['missing-release-origin','missing-release-marker'].includes(error.code))throw error;}
  const urls=[...new Set(source.frames.map(f=>f.url))],sources=[];
  for(const url of urls){if(!hashes.has(url))hashes.set(url,sha(await asset(url)));sources.push({url,sha256:hashes.get(url)});}
  profiles.push({actorId:actor.id,family:actor.family,direction,status:'integration-choreography',strategy:'native-cast-and-target',timing:'source-marker-or-authored-skill-phase',sourcePixelsModified:false,metadataUrl:ref.actorUrl,metadataSha256:sha(metadata),clip:nativeClipShape(source),sources});
 }}
const data={schemaVersion:1,scope:'Presentation only: original actor clips plus committed target impacts; no fabricated weapon emitter, gameplay changes or final-art approval.',catalogSha256:sha(indexBytes),profiles};
await fs.writeFile(path.join(root,'scene-native-cast-profiles.json'),JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({profiles:profiles.length,sourcePixelsModified:false,reviewApprovalPromoted:false}));
