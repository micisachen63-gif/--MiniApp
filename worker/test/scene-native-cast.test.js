import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto,createHash} from 'node:crypto';
import {createNativeCastResolver,nativeClipShape,nativeCastTiming} from '../public/scene-native-cast.mjs';
const origin='http://cast.test',url='/ui-generated-20261030/characters-v1/assets/cast.webp',meta='/ui-generated-20261030/characters-v1/character-preview-actors/cast.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const source={mirrorX:false,frames:Array.from({length:4},(_,i)=>({url,rect:[i*100,0,100,100],anchor:[50,90],bodyHeight:80,durationMs:100}))};
 const actor={id:'original-actor',clips:{attack:{right:source}}},metadata=Buffer.from(JSON.stringify(actor)),image=Buffer.from('unchanged original source bytes');
 const profile={actorId:actor.id,direction:'right',status:'integration-choreography',strategy:'native-cast-and-target',sourcePixelsModified:false,metadataUrl:meta,metadataSha256:sha(metadata),clip:nativeClipShape(source),sources:[{url,sha256:sha(image)}]};
 const files=new Map([[meta,metadata],[url,image]]),requests=[];
 const policies={schemaVersion:1,profiles:[profile]},resolver=createNativeCastResolver({origin,crypto:webcrypto,nativePresentations:policies,fetch:async input=>{requests.push(input);const data=files.get(new URL(input).pathname);return data?new Response(data):new Response('',{status:404});}});
 const animator={ready:true,clips:{attack:{right:{source,durations:[100,100,100,100]}}}},recipe={phases:[{id:'release',from:.22},{id:'impact',from:.57}]};
 return {source,actor,metadata,image,profile,policies,files,requests,resolver,animator,recipe,resolve:()=>resolver.resolve({animator,actorId:actor.id,direction:'right',recipe})};
}
test('native choreography uses authored skill impact or placement phase without inventing a weapon emitter',async()=>{
 const f=fixture(),r=await f.resolve();assert.ok(Math.abs(r.delayMs-228)<.001);assert.equal(r.origin,null);assert.equal(r.nativeOrigin,false);assert.equal(r.nativeMarker,false);assert.equal(r.presentation,'native-target');assert.equal(r.timingAuthority,'skill-recipe-impact');
 const placement=nativeCastTiming(f.source,f.recipe,true);assert.equal(placement.delayMs,88);assert.equal(placement.timingAuthority,'skill-recipe-release');
});
test('an original source marker wins over the skill choreography clock',()=>{
 const f=fixture();f.source.hitFrame=1;const r=nativeCastTiming(f.source,f.recipe);assert.equal(r.delayMs,100);assert.equal(r.nativeMarker,true);assert.equal(r.timingAuthority,'source-marker');
});
test('successful source proofs are reused, while a changed actor clip or timeline is rejected',async()=>{
 const f=fixture();await f.resolve();const n=f.requests.length;await f.resolve();assert.equal(f.requests.length,n);
 f.source.frames[0].anchor[0]++;await assert.rejects(f.resolve(),e=>e.code==='stale-native-cast-profile');
 const g=fixture();g.animator.clips.attack.right.durations[0]=80;await assert.rejects(g.resolve(),e=>e.code==='stale-native-cast-profile');
});
test('metadata and image source changes cannot borrow an existing native choreography policy',async()=>{
 for(const which of [meta,url]){const f=fixture();f.files.set(which,Buffer.from('changed'));await assert.rejects(f.resolve(),e=>e.code==='stale-native-cast-profile');}
});
test('cross-origin and traversing source URLs are rejected before they are fetched',async()=>{
 for(const field of ['metadataUrl','image']){const f=fixture();if(field==='metadataUrl')f.profile.metadataUrl='https://other.example/meta.json';else f.profile.sources[0].url='https://other.example/image.webp';await assert.rejects(f.resolve(),e=>e.code==='native-cast-source-url');assert.equal(f.requests.length,0);}
});
test('an absent or duplicate exact actor-direction policy cannot enable arbitrary casts',async()=>{
 const f=fixture();await assert.rejects(f.resolver.resolve({animator:f.animator,actorId:'another',direction:'right',recipe:f.recipe}),e=>e.code==='missing-native-cast-profile');f.policies.profiles.push(f.profile);await assert.rejects(f.resolve(),e=>e.code==='missing-native-cast-profile');
});
test('invalid recipe clocks cannot silently fall back to half of the actor animation',()=>{
 const f=fixture();for(const recipe of [{}, {phases:[{id:'impact',from:1}]},{phases:[{id:'impact',from:-.1}]}])assert.throws(()=>nativeCastTiming(f.source,recipe),e=>e.code==='native-cast-recipe-phase');
});
test('a cancelled source verification cannot produce a cast',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.resolver.resolve({animator:f.animator,actorId:f.actor.id,direction:'right',recipe:f.recipe,signal:controller.signal}),e=>e.code==='cast-cancelled');assert.equal(f.requests.length,0);
});
