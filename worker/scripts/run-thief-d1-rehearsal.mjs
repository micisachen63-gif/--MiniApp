// Client for the fixed isolated worker. Keeps all player rows and private digests off stdout/Git.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import https from 'node:https';
import {ident,literal,schemaRows} from './prepare-thief-schema-candidate.mjs';
const url='https://star-journal-thief-schema-rehearsal-20261015.micisachen.workers.dev';
const token=fs.readFileSync('.release-sync/thief-rehearsal-token','utf8').trim();
const candidate=JSON.parse(fs.readFileSync('docs/thief/live-schema-candidate.json'));
const sha=s=>createHash('sha256').update(s).digest('hex');
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=OFF');db.exec(fs.readFileSync('.release-sync/thief-before-backup.sql','utf8'));db.exec('PRAGMA foreign_keys=ON');
const pages=[];
for(const {name} of schemaRows(db).filter(r=>r.type==='table')){
 const columns=db.prepare(`PRAGMA table_info(${literal(name)})`).all().map(c=>c.name),fields=['CAST(rowid AS TEXT) AS saved_rowid',...columns.flatMap((c,i)=>[`typeof(${ident(c)}) AS t${i}`,`hex(${ident(c)}) AS b${i}`])];
 for(let offset=0;;offset+=250){const rows=db.prepare(`SELECT ${fields.join(',')} FROM ${ident(name)} ORDER BY rowid LIMIT 250 OFFSET ?`).all(offset);pages.push({table:name,offset,rows:rows.length,sha256:sha(rows.map(r=>JSON.stringify({...r})+'\n').join(''))});if(rows.length<250)break;}
}
const sequence=db.prepare('SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name').all().map(r=>({...r}));db.close();
const receipt={status:'running',isolatedDatabase:true,productionWrites:0,restoredFromVerifiedPrivateExport:true,pages:pages.length,rollbackProofs:[],checks:[]};
const persist=()=>fs.writeFileSync('docs/thief/hosted-d1-rehearsal.json',JSON.stringify(receipt,null,2)+'\n');
const agent=new https.Agent({keepAlive:true,maxSockets:4});
async function post(path,body){const payload=Buffer.from(JSON.stringify(body));return new Promise((resolve,reject)=>{
 const request=https.request(url+path,{agent,family:4,method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':payload.length}},response=>{const chunks=[];response.on('data',b=>chunks.push(b));response.on('end',()=>{clearTimeout(timer);try{resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,json:JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});response.on('error',reject);});
 const timer=setTimeout(()=>request.destroy(Error('Isolated rehearsal HTTPS timeout')),60000);request.on('error',e=>{clearTimeout(timer);reject(e);});request.end(payload);
});}
async function call(path,body={},readOnly=false){
 let last;
 for(let attempt=0;attempt<(readOnly?3:1);attempt++){
  try{const response=await post(path,body);const json=response.json;assert(response.ok&&json.ok,'Rehearsal endpoint failed '+path+' status '+response.status+' reason '+(json.reason||'unknown'));return json;}
  catch(error){last=error;}
 }throw last;
}
async function verify(expected,label,affectedOnly=false){
 console.log(JSON.stringify({phase:label,status:'start',scope:affectedOnly?'all-seven-affected-tables':'all-41-business-tables'}));
 const schema=await call('/schema',{},true);assert.equal(schema.schemaSHA256,expected);assert.equal(schema.tables,41);assert.equal(schema.foreignKeyErrors,0);assert.deepEqual(schema.quickCheck,['ok']);
 const selected=affectedOnly?pages.filter(p=>candidate.createOrder.includes(p.table)):pages;
 let next=0,verified=0;
 async function worker(){while(next<selected.length){const page=selected[next++],actual=await call('/page-digest',{table:page.table,offset:page.offset},true);assert.equal(actual.rows,page.rows);assert.equal(actual.sha256,page.sha256,'Private restored page mismatch; details withheld');verified++;if(verified%100===0)console.log(JSON.stringify({phase:label,pagesVerified:verified,totalPages:selected.length}));}}
 await Promise.all(Array.from({length:4},worker));
 const seq=await call('/sequence-digest',{},true);assert.equal(seq.sha256,sha(JSON.stringify(sequence)));assert.equal(seq.entries,sequence.length);
 receipt.checks.push({label,schemaSHA256:expected,tables:affectedOnly?candidate.createOrder.length:41,pagesVerified:verified,allRowsTypesBytesAndRowidsPreserved:true,sequencePreserved:true,foreignKeyCheck:'pass',quickCheck:'ok'});persist();console.log(JSON.stringify({phase:label,status:'PASS',pagesVerified:verified}));
}
try{
 await verify(candidate.schemaSha256Before,'full-backup-restore');
 for(const phase of ['drop-table-leaf-first','restore-data-before-triggers','verify-all-columns-rowid-types-bytes']){
  const result=await call('/rollback',{phase,expectedBeforeSHA256:candidate.schemaSha256Before});assert.equal(result.rolledBack,true);assert.equal(result.schemaSHA256,candidate.schemaSha256Before);receipt.rollbackProofs.push(result);
  await verify(candidate.schemaSha256Before,'rollback-'+phase,true);
 }
 receipt.apply=await call('/apply',{expectedBeforeSHA256:candidate.schemaSha256Before});assert.equal(receipt.apply.rolledBack,false);
 await verify(candidate.schemaSha256ExpectedAfter,'complete-atomic-expansion');
 receipt.status='PASS';receipt.completedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:'PASS',productionWrites:0,businessTables:41,rollbackProofs:receipt.rollbackProofs.length,atomicStatements:receipt.apply.statements,executionMs:receipt.apply.durationMs}));
}catch(error){receipt.status='FAIL';receipt.error=String(error);persist();console.error(JSON.stringify({status:'FAIL',message:String(error),productionWrites:0}));process.exitCode=1;}
finally{agent.destroy();}
