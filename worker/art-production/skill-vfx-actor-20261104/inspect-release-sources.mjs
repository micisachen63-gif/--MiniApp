import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const output = path.resolve('worker/art-production/skill-vfx-actor-20261104');
const grok = path.resolve('../../grok-assets');
const root = path.join(grok,'ui-generated-20261030/characters-v1');
const actors = ['sword','archer','mage','thief'];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const assets = {};
const inventory = {schemaVersion:1,generatedAt:new Date().toISOString(),sourceRoot:root,readOnlySources:true,actors:[],assets};
for(const actorId of actors){
  const file = path.join(root,'character-preview-actors',actorId+'.json');
  const raw = fs.readFileSync(file), data = JSON.parse(raw);
  const actor = {id:actorId,key:data.key,gender:data.gender,approved:data.approved,readiness:data.readiness,metadataUrl:'/ui-generated-20261030/characters-v1/character-preview-actors/'+actorId+'.json',metadataSha256:hash(raw),attack:{}};
  for(const direction of ['up','down','right','left']){
    const clip = data.clips.attack[direction];
    const out = {};
    for(const key of ['approved','readiness','bodyHeight','loop','mirrorX','hitFrame','releaseFrame','releaseAnchorPx','perSourceReferenceScale','timingSource','authoredEffects','sourceFacing'])if(key in clip)out[key]=clip[key];
    out.frames=clip.frames.map(frame=>{
      const result={};for(const key of ['url','rect','anchor','bodyHeight','durationMs','mirrorX','label','sourceFrameIndex','sourceClipPolygon'])if(key in frame)result[key]=frame[key];
      const url=new URL(frame.url,'http://127.0.0.1');
      if(url.origin!=='http://127.0.0.1'||!url.pathname.startsWith('/ui-generated-20261030/characters-v1/assets/'))throw Error('Unexpected source URL');
      if(!assets[url.pathname]){
        const local=path.join(grok,url.pathname.slice(1)), actual=fs.realpathSync(local), relative=path.relative(grok,actual);
        if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Source outside grok root');
        const bytes=fs.readFileSync(actual);
        assets[url.pathname]={path:actual,sha256:hash(bytes),bytes:bytes.length};
      }
      return result;
    });
    const durations=out.frames.map(f=>f.durationMs);
    out.frameCount=out.frames.length;out.durationMs=durations.reduce((a,b)=>a+b,0);
    out.uniformFps=durations.every(x=>x===durations[0])?1000/durations[0]:null;
    actor.attack[direction]=out;
  }
  inventory.actors.push(actor);
}
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'source-inventory.json'),JSON.stringify(inventory,null,2)+'\n','utf8');
console.log(JSON.stringify({ok:true,actors:inventory.actors.map(a=>({id:a.id,metadataSha256:a.metadataSha256,attack:Object.fromEntries(Object.entries(a.attack).map(([d,c])=>[d,{frames:c.frameCount,durationMs:c.durationMs,uniformFps:c.uniformFps,marker:c.releaseFrame??c.hitFrame??null,anchor:c.releaseAnchorPx??null,mirrorX:!!c.mirrorX,sources:[...new Set(c.frames.map(f=>f.url))]}]))})),assets}));
