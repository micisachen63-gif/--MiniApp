import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createHash} from 'node:crypto';import {MONSTER_DATA} from '../src/game/monster-data.js';
const source=fs.readFileSync(new URL('../tools/build-monster-expansion-catalog.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\r?\n/,'');
const base='art-production/monster-expansion-20261013',hash=data=>createHash('sha256').update(data).digest('hex');
async function buildFixture({release=true,incomplete=false,duplicate=false,badFormat=false,changedSource=false,changedAtlas=false,changedStill=false,missingScene=false}={}){
 const all=MONSTER_DATA.filter(m=>m.expansion),jobs=all.map(m=>({key:m.spriteKey,map:m.mapId,name:m.name,role:m.role,behavior:m.behavior,spell:m.spell,attackDirection:-1,cols:4,rows:4,frames:16,folder:'monster-expansion-20261013'}));
 if(incomplete)jobs.pop();if(duplicate)jobs[jobs.length-1]={...jobs[0]};if(badFormat)jobs[0].cols=5;
 const files=new Map(),writes=new Map();files.set(base+'/manifest.json',JSON.stringify({jobs}));files.set('public/monster-layout.json','{}');
 const rendererFiles=['app.js','battle.js','battle.css','monster-expansion.js','cinematic-fx.js','styles.css'];
 for(const f of rendererFiles)files.set('public/'+f,Buffer.from('fixture renderer:'+f));
 const rendererHash=hash(Buffer.concat(rendererFiles.map(f=>Buffer.concat([Buffer.from(f+'\n'),files.get('public/'+f)]))));
 for(const [i,m]of all.entries()){
  const key=m.spriteKey,src=Buffer.from('source:'+key),atlas=Buffer.from('atlas:'+key),still=Buffer.from('still:'+key),sourceHash=hash(src),assetHash=hash(atlas),stillHash=hash(still),meta={key,map:m.mapId,name:m.name,role:m.role,source:'fixture/'+key+'.png',sourceHash,stillHash,ready:true,qaApproved:true,sceneQAApproved:true,cols:4,rows:4,frames:16,folder:'monster-expansion-20261013',bodyHeight:.8,feet:.9375,frameBounds:Array.from({length:16},()=>[.2,.1375,.9375,.9375]),idle:[0,1,2,3],move:[4,5,6,7],attack:[8,9,10,11],cast:[12,13],hurt:[14],death:[15],technicalQA:{pass:true,sourceHash,assetHash,stillHash,frames:16,distinct:16,minMargin:24},sceneQA:{sourceHash,assetHash,stillHash,desktop:true,mobile:true}};
  Object.assign(meta,{behavior:m.behavior,spell:m.spell,attackDirection:-1});
  const signature={key:meta.key,map:meta.map,name:meta.name,role:meta.role,folder:meta.folder,cols:meta.cols,rows:meta.rows,frames:meta.frames,ratio:meta.ratio,bodyHeight:meta.bodyHeight,feet:meta.feet,frameBounds:meta.frameBounds,idle:meta.idle,move:meta.move,attack:meta.attack,cast:meta.cast,hurt:meta.hurt,death:meta.death,spell:meta.spell,behavior:meta.behavior,attackDirection:meta.attackDirection};
  Object.assign(meta.sceneQA,{rendererHash,signature:hash(JSON.stringify(signature))});
  if(i===0&&missingScene)meta.sceneQA.mobile=false;
  files.set(base+'/packed/'+key+'.json',JSON.stringify(meta));files.set(meta.source,i===0&&changedSource?Buffer.from('changed-source'):src);files.set('public/art/monster-expansion-20261013/'+key+'_attack.webp',i===0&&changedAtlas?Buffer.from('changed-atlas'):atlas);files.set('public/art/monster-expansion-20261013/'+key+'.webp',i===0&&changedStill?Buffer.from('changed-still'):still);
 }
 const fakeFs={async readFile(path,encoding){if(!files.has(path))throw Error('missing fixture '+path);const value=files.get(path);return encoding?Buffer.isBuffer(value)?value.toString():value:Buffer.isBuffer(value)?value:Buffer.from(value);},async access(path){if(!files.has(path))throw Error('missing fixture '+path);},async writeFile(path,data){writes.set(path,String(data));}};
 const c=vm.createContext({fs:fakeFs,createHash,Buffer,process:{argv:['node','build',...(release?['--release-gate']:[])]},console:{log(){},warn(){}}});await vm.runInContext('(async()=>{'+source+'})()',c);return writes;
}
test('default catalogue builds do not activate server readiness while full108 current hashes+both screen QAs release matching digest',async()=>{
 const partial=await buildFixture({release:false,incomplete:true});assert.equal(partial.has('src/game/monster-readiness.js'),false);
 const full=await buildFixture(),ctx=vm.createContext({window:{}});vm.runInContext(full.get('public/monster-expansion-catalog.js'),ctx);assert.equal(ctx.window.RpgMonsterExpansionCatalog.length,108);assert.match(ctx.window.RpgMonsterExpansionArtRevision,/^monster16-v2-[0-9a-f]+$/);assert.ok(full.get('src/game/monster-readiness.js').includes(ctx.window.RpgMonsterExpansionArtRevision));
});
test('release rejects incomplete count, stale source/atlas hash and missing current mobile QA',async()=>{
 for(const options of [{incomplete:true},{changedSource:true},{changedAtlas:true},{missingScene:true}])await assert.rejects(buildFixture(options),/108|QA|hash|changed|missing/i);
});
test('release cannot substitute a duplicate monster for a missing unique approved identity',async()=>{
 await assert.rejects(buildFixture({duplicate:true}),/unique|duplicate|identity|108/i);
});
test('release rejects a5-column metadata overwrite even when4x4 pixels and old scene hashes are unchanged',async()=>{
 await assert.rejects(buildFixture({badFormat:true}),/4|column|cols|frame|atlas|format/i);
});
test('release rejects an overwritten idle still even when source and attack hashes remain approved',async()=>{
 await assert.rejects(buildFixture({changedStill:true}),/still|hash|changed|static/i);
});
