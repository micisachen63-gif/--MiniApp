import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {POOL_MONSTERS} from '../src/game/star-ring-pools.js';
const worker=new URL('../',import.meta.url),source=new URL('../art-production/star-ring-pools-20261019/',import.meta.url),out=new URL('../public/art/star-ring-pools-20261019/',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
let sceneQA=null;try{sceneQA=JSON.parse(await readFile(new URL('../../docs/art/STAR_RING_POOL_SCENE_QA_20261019.json',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const entries=(await Promise.all(['maps-01-04','maps-05-08','maps-09-12'].map(async group=>JSON.parse(await readFile(new URL(group+'/manifest.json',source),'utf8')).monsters.map(e=>({...e,source:e.source.startsWith('source/')?`art-production/star-ring-pools-20261019/${group}/${e.source}`:e.source,technicalQA:{...e.technicalQA,hasAlpha:e.technicalQA.hasAlpha===true||e.technicalQA.alphaZeroFraction>0}}))))).flat();
assert.equal(entries.length,36,'All three authored sets are required');assert.equal(new Set(entries.map(e=>e.key)).size,36);
for(const def of POOL_MONSTERS){const e=entries.find(x=>x.key===def.enemyId);assert.ok(e,def.enemyId);assert.equal(e.name,def.enemyName);assert.equal(e.hourIndex,def.hourIndex);assert.equal(e.role,def.rank);assert.equal(e.cols,4);assert.equal(e.rows,4);assert.equal(e.frames,16);assert.equal(e.attackDirection,-1);assert.equal(e.technicalQA.pass,true);assert.equal(e.technicalQA.distinct,16);assert.ok(e.technicalQA.minMargin>=24);assert.equal(new Set(e.technicalQA.frameHashes).size,16);
 assert.equal(e.still,def.artUrl.split('/').at(-1));assert.equal(e.atlas,def.atlasUrl.split('/').at(-1));
 assert.match(e.source,/^art-production\/star-ring-pools-20261019\/maps-(?:01-04|05-08|09-12)\/source\/[a-z0-9-]+\.png$/);
 assert.equal(sha(await readFile(new URL(e.source,worker))),e.sourceHash);assert.equal(sha(await readFile(new URL(e.atlas,out))),e.technicalQA.assetHash);assert.equal(sha(await readFile(new URL(e.still,out))),e.technicalQA.stillHash);
 const scenes=sceneQA?.records?.filter(x=>x.key===e.key)||[];
 const desktop=scenes.find(x=>x.surface==='desktop'),mobile=scenes.find(x=>x.surface==='mobile');
 const passed=x=>x&&x.pass===true&&x.atlasHash===e.technicalQA.assetHash&&x.sourceHash===e.sourceHash&&x.stillHash===e.technicalQA.stillHash;
 if(passed(desktop)&&passed(mobile)){e.ready=e.qaApproved=e.sceneQAApproved=true;e.sceneQA={sourceHash:e.sourceHash,assetHash:e.technicalQA.assetHash,stillHash:e.technicalQA.stillHash,desktop:true,mobile:true,evidence:'docs/art/STAR_RING_POOL_SCENE_QA_20261019.json'};}
}
await writeFile(new URL('manifest.json',out),JSON.stringify({schema:1,revision:'star-ring-pools-v2-20261019',monsters:entries.sort((a,b)=>a.key.localeCompare(b.key))},null,2)+'\n');
