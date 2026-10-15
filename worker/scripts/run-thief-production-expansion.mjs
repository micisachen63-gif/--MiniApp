// One authorized, fixed atomic expansion. Never accepts SQL, prints rows, or retries a write.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(root);
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const candidate=json('docs/thief/live-schema-candidate.json');
const hosted=json('docs/thief/hosted-d1-rehearsal.json');
const endpoint='https://star-journal-thief-schema-release-20261016.micisachen.workers.dev';
const token=fs.readFileSync('.release-sync/thief-production-schema-token','utf8').trim();
const apply=process.argv.includes('--apply');
assert(process.argv.length===3&&['--schema','--apply'].includes(process.argv[2]),'Choose --schema or the already-authorized --apply');
const git=(...args)=>{const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'Git preflight failed');return r.stdout.trim();};
const sourceCommit=git('rev-parse','HEAD');
const agent=new https.Agent({keepAlive:true,maxSockets:1});
async function post(route,body){
 const bytes=Buffer.from(JSON.stringify(body));
 return new Promise((resolve,reject)=>{
  const req=https.request(endpoint+route,{family:4,agent,method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':bytes.length}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{clearTimeout(timer);try{const data=JSON.parse(Buffer.concat(chunks));assert(res.statusCode===200&&data.ok,'Fixed executor rejected request: '+res.statusCode+' '+(data.reason||''));resolve(data);}catch(error){reject(error);}});res.on('error',reject);
  });
  const timer=setTimeout(()=>req.destroy(Error('Executor response uncertain; inspect schema, never blindly retry apply')),60000);
  req.on('error',error=>{clearTimeout(timer);reject(error);});req.end(bytes);
 });
}
async function schema(){let last;for(let i=0;i<3;i++){try{return await post('/schema',{});}catch(error){last=error;}}throw last;}
const healthy=state=>{assert.equal(state.objects,135);assert.equal(state.tables,41);assert.equal(state.foreignKeyErrors,0);assert.deepEqual(state.quickCheck,['ok']);};
try{
 const before=await schema();healthy(before);
 if(!apply){console.log(JSON.stringify({mode:'read-only',...before}));}
 else{
  assert.equal(git('status','--porcelain'),'','Apply requires a clean reviewed source');
  assert.equal(git('ls-remote','origin','refs/heads/main').split(/\s+/)[0],sourceCommit,'Source must be exact GitHub main');
  assert.equal(hosted.status,'PASS');assert.equal(hosted.apply.statements,165);
  assert.equal(hosted.apply.schemaSHA256,candidate.schemaSha256ExpectedAfter);
  assert.equal(hosted.rollbackProofs.length,3);assert(hosted.rollbackProofs.every(p=>p.ok&&p.rolledBack&&p.schemaSHA256===candidate.schemaSha256Before));
  const art=json('docs/thief/art-readiness.json');
  assert.equal(art.visualAcceptedIdentities,62);assert.equal(art.runtimeAcceptedIdentities,62);assert.equal(art.completedIdentities,62);
  const backup=json('docs/thief/backup-restore-verification.json');
  assert.equal(backup.status,'private-export-offline-restore-and-candidate-pass');assert(backup.allRowsTypesBytesRowidsAndSequencesPreserved);
  const backupFile='.release-sync/thief-before-backup.sql';
  assert.equal(createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex'),backup.backupSHA256);
  for(const file of [backupFile,'.release-sync/thief-bookmark.log'])assert(Date.now()-fs.statSync(file).mtimeMs<20*60*1000,'Fresh backup and Time Travel bookmark must be less than 20 minutes old');
  assert.equal(before.schemaSHA256,candidate.schemaSha256Before,'Schema changed or expansion already ran; do not resend');
  const attempt={sourceCommit,startedAt:new Date().toISOString(),before,writeAttempts:1};
  fs.writeFileSync('.release-sync/thief-production-schema-attempt.json',JSON.stringify(attempt,null,2));
  // Exactly one mutating HTTPS request. On an uncertain response only read schema.
  let result,uncertain=false;
  try{result=await post('/apply',{sourceCommit,expectedBeforeSHA256:candidate.schemaSha256Before});}catch{uncertain=true;}
  const after=await schema();healthy(after);
  if(after.schemaSHA256!==candidate.schemaSha256ExpectedAfter){
   fs.writeFileSync('.release-sync/thief-production-schema-inspection.json',JSON.stringify({...attempt,after,responseUncertain:uncertain},null,2));
   throw Error('Expansion not verified. Inspect the private attempt and schema; no automatic write retry.');
  }
  const receipt={status:'VERIFIED',sourceCommit,authorization:'User approved after backup, restore and hosted D1 rehearsal',databaseId:'bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4',startedAt:attempt.startedAt,verifiedAt:new Date().toISOString(),statements:165,writeAttempts:1,responseUncertain:uncertain,durationMs:result?.durationMs??null,before,after,backupSHA256:backup.backupSHA256,hostedProof:'hosted-d1-rehearsal.json',migrationTracking:'pending',gameRelease:'pending'};
  const persist=()=>fs.writeFileSync('docs/thief/production-schema-release.json',JSON.stringify(receipt,null,2)+'\n');persist();
  // One separate metadata-only request marks the guarded fresh-database initializer
  // as already satisfied. Production must never run that initializer's DROP statements.
  receipt.migrationTrackingAttempts=1;
  try{await post('/record-migration',{sourceCommit});}catch{receipt.migrationTrackingResponseUncertain=true;}
  const tracked=await schema();healthy(tracked);assert.equal(tracked.schemaSHA256,candidate.schemaSha256ExpectedAfter);
  receipt.migrationTracking=tracked.initializerRecorded?'0025_thief_empty_database.sql recorded':'unverified';persist();
  assert(tracked.initializerRecorded,'Schema expanded; inspect migration tracking separately without reapplying expansion');
  console.log(JSON.stringify({status:'VERIFIED',statements:165,writeAttempts:1,responseUncertain:uncertain,migrationTracking:receipt.migrationTracking,schemaSHA256:after.schemaSHA256,foreignKeyErrors:0,quickCheck:'ok'}));
 }
}finally{agent.destroy();}
