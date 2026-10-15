import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),read=file=>fs.readFileSync(new URL(file,root)),digest=b=>createHash('sha256').update(b).digest('hex');
test('pilot registry preserves all existing identities and cannot substitute other classes for missing thief assets',()=>{
 const registry=JSON.parse(read('worker/public/hero-art-registry.json'));
 const baseline=JSON.parse(execFileSync('git',['show','HEAD:worker/public/hero-art-registry.json'],{cwd:root,maxBuffer:16*1024*1024,windowsHide:true}));
 for(const [key,entry]of Object.entries(baseline.heroes))if(entry.baseClass!=='thief')assert.deepEqual(registry.heroes[key],entry,key);
 const ctx={window:{}};vm.runInNewContext(read('worker/public/thief-fx.js').toString(),ctx);vm.runInNewContext(read('worker/public/hero-art-registry.js').toString(),ctx);
 const api=ctx.window.RpgHeroArtRegistry;assert.equal(api.get({baseClass:'thief',classPath:'',gender:'f'}).key,'thief_f');
 for(const [key,entry]of Object.entries(baseline.heroes))if(entry.baseClass!=='thief')assert.equal(JSON.stringify(api.get(key)),JSON.stringify(entry),key);
 for(const key of ['thief_m','adv1_thief_A_f','adv2_thief_B2_m','adv4_thief_A111_f']){
  if(registry.heroes[key])assert.equal(api.get(key).key,key);else assert.equal(api.get(key),null,key);
 }
 assert.equal(api.key({baseClass:'thief',classPath:'A1111',gender:'f'}),null);
 assert.equal(typeof api.fx('thief_f','normal').draw,'function');assert.equal(typeof api.fx('thief_f','skill').draw,'function');
 assert.equal(api.fx('thief_f','normal').kind,'dagger');assert.equal(api.fx('thief_f','skill').kind,'cross');
 assert.equal(ctx.window.RpgThiefFX.profile('','B',{basic:true}).kind,'pierce');
 assert.equal(ctx.window.RpgThiefFX.profile('','B1',{basic:false}).kind,'flying');
 assert.equal(ctx.window.RpgThiefFX.profile('','B2',{basic:false}).kind,'mirror');
});
test('the pilot is twelve authored native poses with reviewed bounds, fixed feet, exact URLs and no upscaling',()=>{
 const qa=JSON.parse(read('docs/thief/pilot-native-pack.json')),registry=JSON.parse(read('worker/public/hero-art-registry.json')),entry=registry.heroes.thief_f;
 assert.equal(qa.frames.length,12);assert.equal(new Set(qa.frames.map(x=>x.rgbaSHA256)).size,12);assert(qa.noUpscaling&&qa.noBackgroundEditing&&qa.nativePixelsPreserved);
 for(const frame of qa.frames){assert.equal(frame.footBaseline,600);assert(frame.nativePixelsPreserved);assert(frame.alphaBounds[0]>=20&&frame.alphaBounds[2]<=620);assert(frame.alphaBounds[1]>=20&&frame.alphaBounds[3]<=620)}
 for(const [file,sha]of Object.entries(qa.outputs))assert.equal(digest(read('worker/public/art/thief-20261015/thief_f/'+file)),sha);
 assert.equal(entry.animation.durationsMs.reduce((n,x)=>n+x,0),1000);assert.equal(entry.animation.releaseFrameIndex,6);assert.equal(entry.animation.releaseAtMs,440);
 assert.equal(entry.guardianCategory,'melee');assert.equal(entry.animation.castAnchorsPx.length,12);
 assert.equal(entry.animation.useAsIdle,false);
 assert(Math.abs(entry.animation.heightScale*(entry.animation.bodyBounds[3]-entry.animation.bodyBounds[1])-(entry.heroBounds[3]-entry.heroBounds[1]))<1e-8);
 for(const src of [entry.hero,entry.portrait,entry.animation.src])assert.match(src,/^art\/thief-20261015\/thief_f\/[^?]+\?v=[a-f0-9]{12}$/);
});
