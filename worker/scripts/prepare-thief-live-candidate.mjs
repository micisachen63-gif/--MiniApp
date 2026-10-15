// Review-only generation from a captured SCHEMA-ONLY response. Never contacts or writes a live DB.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {buildThiefSchemaCandidate,schemaRows,ident,literal} from './prepare-thief-schema-candidate.mjs';
import {seedThiefSchemaFixture} from '../test/thief-schema-fixture.mjs';
const raw=fs.readFileSync(process.argv[2]),text=raw.toString(raw[0]===255&&raw[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');
const rows=JSON.parse(text).flatMap(result=>result.results||[]).filter(r=>!r.name.startsWith('sqlite_')&&!r.name.startsWith('_cf_')&&!r.name.startsWith('_thief_')&&r.name!=='d1_migrations');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
for(const type of ['table','index','view','trigger'])for(const row of rows.filter(r=>r.type===type))db.exec(row.sql);
assert.deepEqual(schemaRows(db),rows,'Replaying the exact captured SQL must preserve every schema object');
const candidate=buildThiefSchemaCandidate(db);
candidate.status='review-only-live-schema-source; hosted-D1-backup-and-authorization-pending';
candidate.sourceCaptureSHA256=createHash('sha256').update(raw).digest('hex');
candidate.sourceIsSchemaOnly=true;candidate.productionWrites=0;candidate.productionReady=false;
candidate.executionSource='Structured JSON statements only; the .sql file is for human review. Preserve literal newlines in schema guards.';
assert.equal(candidate.schemaSha256Before,sha(rows));
const capture=()=>Object.fromEntries(schemaRows(db).filter(r=>r.type==='table').map(table=>{
 const columns=db.prepare(`PRAGMA table_info(${literal(table.name)})`).all().map(c=>c.name);
 const fields=['rowid',...columns.flatMap(c=>[`typeof(${ident(c)})`,`hex(${ident(c)})`])].join(',');
 const values=db.prepare(`SELECT ${fields} FROM ${ident(table.name)} ORDER BY rowid`).all();
 return [table.name,{rows:values.length,sha256:sha(values)}];
}).concat([['sqlite_sequence',{sha256:sha(db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all())}]]));
seedThiefSchemaFixture(db);const before=capture(),rollbacks=[];
for(const phase of [...new Set(candidate.statements.map(s=>s.phase))].filter(p=>p.startsWith('drop-')||p.startsWith('restore-')||p.startsWith('verify-all-'))){
 db.exec('BEGIN IMMEDIATE');let injected=false;
 try{for(const statement of candidate.statements){db.exec(statement.sql);if(statement.phase===phase){injected=true;db.exec('INSERT INTO "_thief_review_guard"(ok) VALUES(0)');}}throw new Error('Fault injection did not abort');}
 catch(error){db.exec('ROLLBACK');assert(injected&&/CHECK constraint failed/.test(error.message),error.message);}
 assert.deepEqual(capture(),before);assert.deepEqual(schemaRows(db),rows);rollbacks.push({phase,allDataAndSchemaRestored:true});
}
db.exec('BEGIN IMMEDIATE');try{for(const statement of candidate.statements)db.exec(statement.sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
assert.deepEqual(capture(),before);assert.equal(sha(schemaRows(db)),candidate.schemaSha256ExpectedAfter);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
const receipt={status:'SQLite-memory-pass; hosted-D1-not-rehearsed',productionReady:false,productionWrites:0,
 schemaOnlySource:true,capturedSchemaSHA256:sha(rows),sourceObjects:rows.length,sourceTables:Object.keys(before).length-1,
 exactSourceGuardVerified:true,syntheticDataOnly:true,allTableRowBytesTypesRowidsAndSequencePreserved:true,
 faultRollbacks:rollbacks,foreignKeyCheck:[],integrityCheck:'ok',statements:candidate.statements.length,
 requiredBeforeProduction:['Hosted D1 atomic rehearsal and rollback proof','Verified recoverable backup and restore rehearsal','Final fresh schema match','Write quiescence plan','Explicit authorization under AGENTS.md'],releaseReady:false};
fs.writeFileSync('docs/thief/live-schema-source.json',JSON.stringify({scope:'Schema only, no player rows',objects:rows},null,2)+'\n');
fs.writeFileSync('docs/thief/live-schema-candidate.json',JSON.stringify(candidate,null,2)+'\n');
fs.writeFileSync('docs/thief/live-schema-candidate.sql','-- REVIEW ONLY. DO NOT EXECUTE THIS FILE. Display whitespace is normalized. Use the structured JSON statements after required approvals.\n'+candidate.statements.map((s,i)=>`-- ${i+1}. ${s.phase}: ${s.target||''}\n${s.sql};`).join('\n\n').replace(/[ \t]+$/gm,'')+'\n');
fs.writeFileSync('docs/thief/live-schema-rehearsal.json',JSON.stringify(receipt,null,2)+'\n');
db.close();console.log(JSON.stringify({status:receipt.status,sourceObjects:rows.length,tables:receipt.sourceTables,faultRollbacks:rollbacks.length,productionWrites:0}));
