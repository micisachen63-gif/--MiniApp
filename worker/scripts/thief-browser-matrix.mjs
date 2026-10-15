// Real application bootstrap, local memory fixtures and local public files only.
// Default is the existing single thief_f pilot. Use --all only after registry freeze.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {THIEF_PATHS} from '../src/game/thief-data.js';
import {thiefQaIdentity,thiefQaOutput,thiefQaEvidence} from './thief-preview.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
const getArg=name=>{const exact=args.indexOf(name);return exact>=0?args[exact+1]:args.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);};
const allKeys=THIEF_PATHS.flatMap(classPath=>['m','f'].map(gender=>classPath?`adv${classPath.length}_thief_${classPath}_${gender}`:`thief_${gender}`));
const requested=getArg('--keys')||process.env.THIEF_QA_KEYS||process.env.THIEF_QA_KEY||'thief_f';
const full=args.includes('--all')||requested==='all';
const keys=full?allKeys:requested.split(',').map(key=>key.trim()).filter(Boolean);
assert.ok(keys.length&&new Set(keys).size===keys.length,'QA keys must be nonempty and unique');
assert.ok(keys.every(key=>allKeys.includes(key)),'QA matrix accepts only exact thief identities');
if(full)assert.equal(keys.length,62);
const identities=keys.map(key=>thiefQaIdentity(key));
assert.equal(new Set(identities.map(x=>x.registrySHA256)).size,1,'Registry changed while capturing entries');
const output=thiefQaOutput('docs/thief/full-ui/run-'+new Date().toISOString().replace(/[:.]/g,'-'));
assert.equal(fs.readdirSync(output).length,0,'Matrix output directory must be empty; preserve prior evidence and choose a new THIEF_QA_DIR');
const relative=file=>path.relative(root,file).replaceAll('\\','/');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const startedAt=new Date().toISOString(),results=[],errors=[],sourceSHA256={};
const stages=[
 {name:'fields',script:'worker/test/thief-browser-pilot.mjs',report:'verified.json',count:28},
 {name:'actions',script:'worker/test/thief-browser-actions.mjs',report:'actions.json',count:16},
 {name:'pk',script:'worker/test/thief-browser-pk.mjs',report:'pk-actions.json',count:2},
];
fs.writeFileSync(path.join(output,'inputs.json'),JSON.stringify({startedAt,full,concurrency:4,keys,fixtures:identities.map(thiefQaEvidence)},null,2));
function runChild(stage,identity,dir){
 return new Promise(resolve=>{
  const stdout=fs.createWriteStream(path.join(dir,stage.name+'-stdout.log')),stderr=fs.createWriteStream(path.join(dir,stage.name+'-stderr.log'));
  const start=Date.now(),child=spawn(process.execPath,[path.join(root,stage.script)],{cwd:root,env:{...process.env,THIEF_QA_KEY:identity.key,THIEF_QA_DIR:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);
  let timedOut=false,settled=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill();},240000);
  const finish=(code,signal,error)=>{if(settled)return;settled=true;clearTimeout(timer);stdout.end();stderr.end();resolve({exitCode:code,signal,error:error?String(error):null,timedOut,durationMs:Date.now()-start,stdout:relative(path.join(dir,stage.name+'-stdout.log')),stderr:relative(path.join(dir,stage.name+'-stderr.log'))});};
  child.once('error',error=>finish(null,null,error));child.once('close',(code,signal)=>finish(code,signal));
 });
}
function checkReport(stage,identity,dir,child){
 assert.equal(child.exitCode,0,stage.name+' process failed: '+JSON.stringify(child));
 assert.equal(child.timedOut,false);
 const file=path.join(dir,stage.report);
 assert.ok(fs.existsSync(file),'Missing '+stage.report);
 const raw=fs.readFileSync(file),report=JSON.parse(raw);
 assert.equal(report.passed,true);assert.equal(report.identity,identity.key);
 assert.equal(report.cases.length,stage.count,'Incomplete '+stage.name+' cases');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses||[],[]);
 assert.equal(report.productionWrites,false);
 const fixture=report.fixture;
 assert.equal(fixture.entrySHA256,identity.entrySHA256,'Wrong entry digest');
 assert.equal(fixture.registrySHA256,identity.registrySHA256,'Registry drift');
 assert.equal(fixture.classPath,identity.classPath);assert.equal(fixture.gender,identity.gender);assert.equal(fixture.level,identity.level);
 assert.equal(fixture.nativeSkillName,identity.nativeSkillName);
 assert.equal(fixture.productReleaseReady,false);assert.equal(fixture.fixtureMetaOverride,true);
 for(const [file,expected] of Object.entries({...fixture.publicSourceSHA256,...report.sourceSHA256})){
  const absolute=path.resolve(root,file),publicBase=path.join(root,'worker/public');
  assert.ok(absolute.startsWith(publicBase+path.sep),'Non-public source evidence '+file);
  if(sourceSHA256[file])assert.equal(sourceSHA256[file],expected,'Inputs changed between identities: '+file);
  sourceSHA256[file]=expected;
 }
 return {passed:true,cases:report.cases.length,report:relative(file),reportSHA256:sha(raw)};
}
let next=0;
async function worker(){
 while(next<identities.length){
  const identity=identities[next++],dir=path.join(output,identity.key);fs.mkdirSync(dir,{recursive:true});
  const item={identity:identity.key,classPath:identity.classPath,gender:identity.gender,level:identity.level,nativeSkillName:identity.nativeSkillName,entrySHA256:identity.entrySHA256,publicSourceSHA256:identity.publicSourceSHA256,stages:[],passed:true};
  for(const stage of stages){
   console.log(JSON.stringify({identity:identity.key,stage:stage.name,status:'start'}));
   const child=await runChild(stage,identity,dir);
   let checked;
   try{checked=checkReport(stage,identity,dir,child);}
   catch(error){item.passed=false;const detail={identity:identity.key,stage:stage.name,error:String(error)};errors.push(detail);checked={passed:false,...detail};}
   item.stages.push({name:stage.name,...child,...checked});
   console.log(JSON.stringify({identity:identity.key,stage:stage.name,passed:checked.passed}));
  }
  results.push(item);fs.writeFileSync(path.join(dir,'identity-summary.json'),JSON.stringify(item,null,2));
 }
}
await Promise.all(Array.from({length:Math.min(4,identities.length)},()=>worker()));
for(const identity of identities){
 try{const current=thiefQaIdentity(identity.key);assert.equal(current.entrySHA256,identity.entrySHA256);assert.equal(current.registrySHA256,identity.registrySHA256);}
 catch(error){errors.push({identity:identity.key,stage:'final-input-check',error:String(error)});}
}
for(const [file,expected] of Object.entries(sourceSHA256)){
 try{assert.equal(sha(fs.readFileSync(path.join(root,file))),expected,'Public source changed: '+file);}
 catch(error){errors.push({stage:'final-input-check',file,error:String(error)});}
}
results.sort((a,b)=>keys.indexOf(a.identity)-keys.indexOf(b.identity));
const passed=errors.length===0&&results.length===identities.length&&results.every(item=>item.passed);
const report={passed,status:passed?'PASS':'FAIL',startedAt,completedAt:new Date().toISOString(),fullRegistryMatrix:full,concurrency:4,identities:results.length,expectedIdentities:keys.length,expectedCasesPerIdentity:{fields:28,actions:16,pk:2,total:46},cases:results.flatMap(item=>item.stages).reduce((sum,stage)=>sum+(stage.cases||0),0),actualAppBootstrap:true,isolatedInMemoryFixture:true,productionWrites:false,productReleaseReady:false,fixtureMetaOverride:true,registrySHA256:identities[0].registrySHA256,sourceSHA256,results,errors};
fs.writeFileSync(path.join(output,'matrix.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed,identities:report.identities,cases:report.cases,errors:errors.length,report:relative(path.join(output,'matrix.json'))}));
if(!passed)process.exitCode=1;

