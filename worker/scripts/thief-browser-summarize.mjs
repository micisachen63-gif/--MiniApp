// Preserve compact reviewed evidence without checking every raw screenshot into Git.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),folder=path.resolve(root,process.argv[2]||''),base=path.join(root,'docs/thief/full-ui');
assert.ok(folder.startsWith(base+path.sep),'Pass one raw matrix folder under docs/thief/full-ui');
const relative=f=>path.relative(root,f).replaceAll('\\','/'),sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const file=path.join(folder,'matrix.json'),matrix=read(file);assert.equal(matrix.passed,true);assert.equal(matrix.identities,62);assert.equal(matrix.cases,2852);assert.deepEqual(matrix.errors,[]);
assert.equal(matrix.fullRegistryMatrix,true);assert.equal(matrix.concurrency,4);assert.equal(matrix.productionWrites,false);
for(const [file,expected]of Object.entries(matrix.sourceSHA256))assert.equal(sha(path.join(root,file)),expected,'Source changed after matrix: '+file);
const summaries=[];
for(const row of matrix.results){
 assert.equal(row.passed,true);const dir=path.join(folder,row.identity),fields=read(path.join(dir,'verified.json')),actions=read(path.join(dir,'actions.json')),pk=read(path.join(dir,'pk-actions.json'));
 for(const report of [fields,actions,pk]){assert.equal(report.identity,row.identity);assert.equal(report.fixture.entrySHA256,row.entrySHA256);assert.equal(report.fixture.registrySHA256,matrix.registrySHA256);assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses||[],[]);}
 assert.equal(fields.cases.length,28);assert.equal(actions.cases.length,16);assert.equal(pk.cases.length,2);
 const angels=fields.cases.filter(x=>x.angel).map(x=>({width:x.width,headGap:x.angel.headGap,inside:x.angel.inside,guardianSrc:x.angel.guardianSrc}));assert.equal(angels.length,4);assert.ok(angels.every(a=>a.headGap>=5&&a.inside));
 const fits=actions.cases.filter(x=>x.bodyFit).map(x=>({width:x.width,kind:x.kind,heightDelta:Math.abs(x.bodyFit.portraitHeight-x.bodyFit.attackHeight),feetDelta:Math.abs(x.bodyFit.portraitFeet-x.bodyFit.attackFeet)}));assert.equal(fits.length,8);assert.ok(fits.every(x=>x.heightDelta<1&&x.feetDelta<1));
 summaries.push({identity:row.identity,classPath:row.classPath,gender:row.gender,level:row.level,nativeSkillName:row.nativeSkillName,entrySHA256:row.entrySHA256,publicSourceSHA256:row.publicSourceSHA256,cases:{fields:28,actions:16,pk:2,total:46},sevenSurfacesAtFourWidths:true,allImagesCorrect:true,noClippingOrOverflow:true,guardians:angels,bodyFit:fits,receipts:row.stages.map(s=>({stage:s.name,report:s.report,SHA256:s.reportSHA256,cases:s.cases}))});
}
const representative=path.join(base,'representative-443422e86d2a');fs.mkdirSync(representative,{recursive:true});const images=[];
for(const key of ['adv4_thief_A111_m','adv4_thief_B221_f','adv4_thief_B221_m','adv4_thief_B222_f','adv4_thief_B222_m'])for(const surface of ['own-armory','lineage-current']){
 const source=path.join(folder,key,'390-'+surface+'.png'),target=path.join(representative,key+'-'+surface+'.png');fs.copyFileSync(source,target);images.push({identity:key,surface,width:390,file:relative(target),SHA256:sha(target)});
}
const evidence={passed:true,status:'PASS',singleCompleteRun:true,rawRun:relative(folder),rawMatrixSHA256:sha(file),identities:62,cases:2852,concurrency:4,counts:{fields:1736,actions:992,pk:124},errors:[],productReleaseReady:false,productionWrites:false,registrySHA256:matrix.registrySHA256,sourceSHA256:matrix.sourceSHA256,testToolsSHA256:Object.fromEntries(['worker/scripts/thief-preview.mjs','worker/scripts/thief-browser-matrix.mjs','worker/test/thief-browser-pilot.mjs','worker/test/thief-browser-actions.mjs','worker/test/thief-browser-pk.mjs'].map(f=>[f,sha(path.join(root,f))])),results:summaries,representativeImages:images,rawEvidencePolicy:'All per-identity reports/logs/screenshots retained locally in rawRun. Commit this summary and ten representative images only; prior failed/interrupted runs remain locally preserved.'};
fs.writeFileSync(path.join(base,'final-summary.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,identities:62,cases:2852,summary:'docs/thief/full-ui/final-summary.json',representativeImages:images.length}));
