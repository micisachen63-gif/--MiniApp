// Join manual review and one complete frozen-input browser run. Updates docs only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {THIEF_RELEASE_READY} from '../src/game/thief-data.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(root);
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const runtimeFile=process.argv[2];
assert(runtimeFile?.startsWith('docs/thief/full-ui/')&&runtimeFile.endsWith('/matrix.json'),'Choose one preserved full matrix');
const runtime=json(runtimeFile),visual=json('docs/thief/visual-acceptance.json');
const registry=json('worker/public/hero-art-registry.json'),readiness=json('docs/thief/art-readiness.json');
assert.equal(runtime.status,'PASS');assert.equal(runtime.fullRegistryMatrix,true);assert.equal(runtime.identities,62);assert.equal(runtime.cases,2852);assert.deepEqual(runtime.errors,[]);
assert.equal(runtime.productionWrites,false);assert.equal(runtime.isolatedInMemoryFixture,true);
assert.equal(visual.status,'PASS');assert.equal(visual.count,62);assert.equal(visual.runtimeVerified,false);
assert.equal(visual.registrySHA256,runtime.registrySHA256);
assert.equal(sha(fs.readFileSync('worker/public/hero-art-registry.json')),runtime.registrySHA256);
for(const [file,digest]of Object.entries(runtime.sourceSHA256))assert.equal(sha(fs.readFileSync(file)),digest,'Frozen public file changed: '+file);
const reviews=new Map(visual.identities.map(r=>[r.key,r]));
const runs=new Map(runtime.results.map(r=>[r.identity,r]));
assert.equal(reviews.size,62);assert.equal(runs.size,62);assert.equal(readiness.identities.length,62);
for(const entry of readiness.identities){
 const review=reviews.get(entry.key),run=runs.get(entry.key);assert(review?.visualAccepted&&run?.passed,entry.key);
 assert.equal(run.entrySHA256,sha(JSON.stringify(registry.heroes[entry.key])),entry.key+' exact render entry');
 assert.equal(run.stages.length,3);
 for(const [stage,count]of [['fields',28],['actions',16],['pk',2]]){const result=run.stages.find(s=>s.name===stage);assert(result?.passed);assert.equal(result.cases,count);}
 for(const [file,digest]of Object.entries(entry.outputs)){
  assert.equal(sha(fs.readFileSync('worker/public/art/thief-20261015/'+entry.key+'/'+file)),digest,entry.key+'/'+file);
  assert.equal(review.outputSHA256[file],digest,entry.key+' reviewed output '+file);
 }
 entry.visualAccepted=true;entry.runtimeAccepted=true;entry.visualEvidence=review.reviewFile;entry.runtimeEvidence=runtimeFile;
}
readiness.visualAcceptedIdentities=62;readiness.runtimeAcceptedIdentities=62;readiness.completedIdentities=62;
readiness.artAcceptanceReady=true;readiness.releaseReady=false;readiness.realPlayerEventsVerified=false;
readiness.reviewScope='Actual app bootstrap, renderers and Canvas animations with explicit isolated in-memory characters; no real player mutations.';
readiness.finalRuntimeEvidence={file:runtimeFile,cases:2852,registrySHA256:runtime.registrySHA256,completedAt:runtime.completedAt};
readiness.finalVisualEvidence='docs/thief/visual-acceptance.json';
if(THIEF_RELEASE_READY&&fs.existsSync('docs/thief/production-schema-release.json'))readiness.releaseReady=json('docs/thief/production-schema-release.json').status==='VERIFIED';
fs.writeFileSync('docs/thief/art-readiness.json',JSON.stringify(readiness,null,2)+'\n');
console.log(JSON.stringify({nativePacked:62,visualAccepted:62,runtimeAccepted:62,browserCases:2852,registryUnchanged:true,releaseReady:readiness.releaseReady}));
