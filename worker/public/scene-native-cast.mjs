// Exact-source choreography for original attack clips without a weapon emitter.
// It preserves the authored actor animation and uses the real committed target
// for impact art. It never fabricates a projectile origin or a damage event.
const ROOT='/ui-generated-20261030/characters-v1/';
const finite=Number.isFinite;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function nativeClipShape(source){
 return {mirrorX:!!source?.mirrorX,loop:!!source?.loop,releaseFrame:source?.releaseFrame??null,hitFrame:source?.hitFrame??null,releaseAtMs:source?.releaseAtMs??null,frames:(source?.frames||[]).map(f=>({url:f.url,rect:f.rect,anchor:f.anchor,bodyHeight:f.bodyHeight,mirrorX:!!f.mirrorX,durationMs:f.durationMs||125}))};
}
export function nativeCastTiming(source,recipe,placement=false){
 const durations=source?.frames?.map(f=>f.durationMs||125);
 if(!durations?.length||!durations.every(n=>finite(n)&&n>0))fail('native-cast-timing');
 const duration=durations.reduce((a,b)=>a+b,0),index=source.releaseFrame??source.hitFrame;
 if(Number.isSafeInteger(index)&&index>=0&&index<durations.length)return {index,delayMs:durations.slice(0,index).reduce((a,b)=>a+b,0),duration,nativeMarker:true,timingAuthority:'source-marker'};
 if(finite(source.releaseAtMs)&&source.releaseAtMs>=0&&source.releaseAtMs<=duration)return {index:null,delayMs:source.releaseAtMs,duration,nativeMarker:true,timingAuthority:'source-marker'};
 const phase=recipe?.phases?.find(p=>p.id===(placement?'release':'impact'));
 if(!phase||!finite(phase.from)||phase.from<0||phase.from>=1)fail('native-cast-recipe-phase');
 // Explicit game choreography: map the authored skill phase onto the original
 // clip clock. This is not a claimed artist-authored weapon-release marker.
 return {index:null,delayMs:duration*phase.from,duration,nativeMarker:false,timingAuthority:'skill-recipe-'+phase.id};
}
export function createNativeCastResolver(options={}){
 const origin=options.origin||globalThis.location?.origin,fetcher=options.fetch||globalThis.fetch?.bind(globalThis),crypto=options.crypto||globalThis.crypto;
 const profilesUrl=options.nativePresentationsUrl||'/scene-native-cast-profiles.json';
 let profilesPromise;const proven=new Map();
 function url(value,characterOnly=true){
  let u,decoded;try{u=new URL(value,origin+'/');decoded=decodeURIComponent(u.pathname);}catch{fail('native-cast-source-url');}
  if(typeof value!=='string'||u.origin!==origin||u.username||u.password||decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').includes('..')||(characterOnly&&!decoded.startsWith(ROOT)))fail('native-cast-source-url');return u.href;
 }
 async function bytes(value,signal,maxBytes,characterOnly=true,cache='force-cache'){
  if(!fetcher)fail('native-cast-source-unavailable');const response=await fetcher(url(value,characterOnly),{credentials:'same-origin',signal,cache});
  if(!response.ok)fail('native-cast-source-unavailable');const data=await response.arrayBuffer();if(data.byteLength>maxBytes)fail('native-cast-source-too-large');return data;
 }
 async function digest(data){if(!crypto?.subtle)fail('native-cast-verification-unavailable');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 async function profiles(signal){
  if(options.nativePresentations)return options.nativePresentations;
  if(!profilesPromise)profilesPromise=bytes(profilesUrl,signal,4*1024*1024,false,'no-cache').then(data=>JSON.parse(new TextDecoder().decode(data))).catch(error=>{profilesPromise=null;throw error;});
  return profilesPromise;
 }
 async function verify(profile,source,actorId,direction,signal){
  if(profile.strategy!=='native-cast-and-target'||profile.status!=='integration-choreography'||profile.sourcePixelsModified!==false||!equal(nativeClipShape(source),profile.clip))fail('stale-native-cast-profile');
  const validHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
  if(!validHash(profile.metadataSha256)||!Array.isArray(profile.sources)||!profile.sources.length||profile.sources.length>128||profile.sources.some(s=>!validHash(s.sha256)))fail('invalid-native-cast-profile');
  const expected=[...new Set(profile.clip.frames.map(f=>url(f.url)))].sort(),sources=profile.sources.map(s=>url(s.url)).sort();if(!equal(expected,sources))fail('invalid-native-cast-profile');
  const metadataUrl=url(profile.metadataUrl);
  const key=actorId+':'+direction+':'+metadataUrl+':'+profile.metadataSha256+':'+JSON.stringify(profile.clip)+':'+profile.sources.map(s=>url(s.url)+':'+s.sha256).join(':');let proof=proven.get(key);
  if(!proof){
   proof=(async()=>{
    const data=await bytes(metadataUrl,signal,8*1024*1024,true,'no-cache');
    if(await digest(data)!==profile.metadataSha256)fail('stale-native-cast-profile');
    const actor=JSON.parse(new TextDecoder().decode(data));if(actor.id!==actorId||!equal(nativeClipShape(actor.clips?.attack?.[direction]),profile.clip))fail('stale-native-cast-profile');
    for(const source of profile.sources)if(await digest(await bytes(source.url,signal,64*1024*1024))!==source.sha256)fail('stale-native-cast-profile');
   })().catch(error=>{if(proven.get(key)===proof)proven.delete(key);throw error;});
   if(proven.size>=512)proven.delete(proven.keys().next().value);proven.set(key,proof);
  }
  await proof;if(signal?.aborted)fail('cast-cancelled');
 }
 async function resolve({animator,actorId,direction,recipe,placement=false,signal}){
  if(signal?.aborted)fail('cast-cancelled');const clip=animator?.clips?.attack?.[direction];
  if(!animator?.ready||!clip?.source?.frames?.length)fail('missing-attack-clip');
  if(!equal(clip.durations,clip.source.frames.map(f=>f.durationMs||125)))fail('stale-native-cast-profile');
  const data=await profiles(signal);if(data?.schemaVersion!==1||!Array.isArray(data.profiles)||data.profiles.length>992)fail('invalid-native-cast-profile');
  const matches=data.profiles.filter(p=>p.actorId===actorId&&p.direction===direction);if(matches.length!==1)fail('missing-native-cast-profile');
  await verify(matches[0],clip.source,actorId,direction,signal);
  return {clip,...nativeCastTiming(clip.source,recipe,placement),origin:null,nativeOrigin:false,presentation:'native-target',authority:'source-bound-native-target'};
 }
 return {resolve,clear(){/* Completed content-addressed proofs remain reusable across rooms. */},destroy(){proven.clear();profilesPromise=null;}};
}
