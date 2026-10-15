// Private, offline restore verification. Never prints player rows or contacts D1.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {schemaRows,ident,literal} from './prepare-thief-schema-candidate.mjs';
const backup=process.argv[2];
assert(backup&&backup.replaceAll('\\','/').includes('/.release-sync/'),'Private backup path required');
const candidate=JSON.parse(fs.readFileSync('docs/thief/live-schema-candidate.json','utf8'));
const sha=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const db=new DatabaseSync(':memory:');
let phase='restore-private-export';
try {
  const raw=fs.readFileSync(backup);db.exec('PRAGMA foreign_keys=OFF');
  db.exec(raw.toString('utf8').replace(/^\uFEFF/,''));
  db.exec('PRAGMA foreign_keys=ON');
  phase='verify-restored-schema';assert.equal(sha(schemaRows(db)),candidate.schemaSha256Before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const tables=schemaRows(db).filter(r=>r.type==='table');
  function capture(){
    const results={};
    for(const {name} of tables){
      const columns=db.prepare(`PRAGMA table_info(${literal(name)})`).all().map(c=>c.name);
      const fields=['rowid AS saved_rowid',...columns.flatMap((c,i)=>[`typeof(${ident(c)}) AS t${i}`,`hex(${ident(c)}) AS b${i}`])].join(',');
      const h=createHash('sha256');let rows=0;
      for(const row of db.prepare(`SELECT ${fields} FROM ${ident(name)} ORDER BY rowid`).iterate()){h.update(JSON.stringify({...row})+'\n');rows++;}
      results[name]={rows,sha256:h.digest('hex')};
    }
    results.sqlite_sequence={sha256:sha(db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all())};
    return results;
  }
  phase='capture-restored-byte-proof';const before=capture(),rollbacks=[];
  for(const faultPhase of ['drop-table-leaf-first','restore-data-before-triggers','verify-all-columns-rowid-types-bytes']){
    phase='fault-rehearsal-'+faultPhase;db.exec('BEGIN IMMEDIATE');let injected=false;
    try{for(const statement of candidate.statements){db.exec(statement.sql);if(statement.phase===faultPhase){injected=true;db.exec('INSERT INTO "_thief_review_guard" (ok) VALUES(0)');}}throw Error('fault missing');}
    catch(error){db.exec('ROLLBACK');assert(injected&&/CHECK constraint failed/.test(error.message));}
    assert.deepEqual(capture(),before);assert.equal(sha(schemaRows(db)),candidate.schemaSha256Before);rollbacks.push(faultPhase);
  }
  phase='complete-local-candidate';db.exec('BEGIN IMMEDIATE');
  try{for(const statement of candidate.statements)db.exec(statement.sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  assert.deepEqual(capture(),before);assert.equal(sha(schemaRows(db)),candidate.schemaSha256ExpectedAfter);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const receipt={status:'private-export-offline-restore-and-candidate-pass',productionWrites:0,hostedD1Rehearsal:false,
    backupBytes:raw.length,backupSHA256:createHash('sha256').update(raw).digest('hex'),businessTables:tables.length,
    exactSchemaMatch:true,allRowsTypesBytesRowidsAndSequencesPreserved:true,rollbackProofPhases:rollbacks,
    foreignKeyCheck:'pass',integrityCheck:'ok',restoredDataNeverPrinted:true};
  fs.writeFileSync('.release-sync/thief-private-backup-digest.json',JSON.stringify({receipt,tables:before},null,2));
  fs.writeFileSync('docs/thief/backup-restore-verification.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
}catch(error){fs.writeFileSync('.release-sync/thief-backup-error.json',JSON.stringify({phase,message:error.message,code:error.code,errcode:error.errcode}));console.error(JSON.stringify({status:'FAIL',phase,errorClass:error.name,code:error.code,errcode:error.errcode,productionWrites:0,detailsWithheld:true}));process.exitCode=1;}
finally{db.close();}
