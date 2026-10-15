// Reorder an exported private dump for FK-enabled hosted D1. No network access.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {schemaRows,ident,literal} from './prepare-thief-schema-candidate.mjs';
const file=process.argv[2];assert(file&&file.replaceAll('\\','/').includes('/.release-sync/'));
const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const source=new DatabaseSync(':memory:');source.exec('PRAGMA foreign_keys=OFF');source.exec(raw);source.exec('PRAGMA foreign_keys=ON');
// SQLite statement splitter: semicolons inside strings, quoted names and comments are retained.
function splitSql(sql){
 const statements=[];let start=0,state='',trigger=false;
 for(let i=0;i<sql.length;i++){
  const c=sql[i],n=sql[i+1];
  if(state==='line'){if(c==='\n')state='';continue;}
  if(state==='block'){if(c==='*'&&n==='/'){state='';i++;}continue;}
  if(state){if(c===state){if(n===state)i++;else state='';}continue;}
  if(c==='-'&&n==='-'){state='line';i++;continue;}if(c==='/'&&n==='*'){state='block';i++;continue;}
  if(c==="'"||c==='"'||c==='`'){state=c;continue;}
  if(c==='['){state=']';continue;}
  if(c===';'){
   const piece=sql.slice(start,i+1).trim();
   if(/^CREATE\s+TRIGGER\b/i.test(piece)&&!(/\bEND\s*;\s*$/i.test(piece)))continue;
   if(piece)statements.push(piece);start=i+1;
  }
 }
 assert(!sql.slice(start).trim(),'Unterminated dump statement');return statements;
}
const statements=splitSql(raw),tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name").all().map(r=>r.name);
const order=[],visiting=new Set(),done=new Set();
function visit(table){if(done.has(table))return;assert(!visiting.has(table),'Restore FK cycle needs explicit review');visiting.add(table);for(const fk of source.prepare(`PRAGMA foreign_key_list(${literal(table)})`).all())if(fk.table!==table)visit(fk.table);visiting.delete(table);done.add(table);order.push(table);}
tables.forEach(visit);
const leading=sql=>sql.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/,'');
const tableName=sql=>leading(sql).match(/^(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|DELETE\s+FROM)\s+["`\[]?([A-Za-z0-9_]+)/i)?.[1];
const byOrder=(a,b)=>order.indexOf(tableName(a))-order.indexOf(tableName(b));
const creates=statements.filter(s=>/^CREATE\s+TABLE\b/i.test(leading(s))).sort(byOrder);
const inserts=statements.filter(s=>/^(INSERT\s+INTO|DELETE\s+FROM)\b/i.test(leading(s))).sort(byOrder);
const post=statements.filter(s=>/^CREATE\s+(?:UNIQUE\s+)?(?:INDEX|VIEW|TRIGGER)\b/i.test(leading(s)));
const ignored=statements.filter(s=>!creates.includes(s)&&!inserts.includes(s)&&!post.includes(s));
assert(ignored.every(s=>/^PRAGMA\s+defer_foreign_keys/i.test(leading(s))),'Unknown dump statement must not be silently dropped');
const ordered=['PRAGMA defer_foreign_keys=TRUE;',...creates,...inserts,...post,'PRAGMA defer_foreign_keys=FALSE;'].join('\n');
const chunks=[];let chunk=[],chunkBytes=0;
for(const statement of [...creates,...inserts,...post]){
 if(chunkBytes+Buffer.byteLength(statement)>4000000&&chunk.length){chunks.push(chunk);chunk=[];chunkBytes=0;}
 chunk.push(statement);chunkBytes+=Buffer.byteLength(statement)+1;
}if(chunk.length)chunks.push(chunk);
const target=new DatabaseSync(':memory:');target.exec('PRAGMA foreign_keys=ON;BEGIN');target.exec(ordered);target.exec('COMMIT');
assert.deepEqual(schemaRows(target),schemaRows(source));
const sha=v=>createHash('sha256').update(v).digest('hex');
function digest(db){const output={};for(const name of tables){const columns=db.prepare(`PRAGMA table_info(${literal(name)})`).all().map(c=>c.name),fields=['CAST(rowid AS TEXT) AS saved_rowid',...columns.flatMap((c,i)=>[`typeof(${ident(c)}) AS t${i}`,`hex(${ident(c)}) AS b${i}`])];const h=createHash('sha256');let rows=0;for(const row of db.prepare(`SELECT ${fields.join(',')} FROM ${ident(name)} ORDER BY rowid`).iterate()){h.update(JSON.stringify({...row})+'\n');rows++;}output[name]={rows,sha256:h.digest('hex')};}output.sqlite_sequence=db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all().map(r=>({...r}));return output;}
const before=digest(source);assert.deepEqual(digest(target),before);assert.deepEqual(target.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(target.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
const incremental=new DatabaseSync(':memory:');incremental.exec('PRAGMA foreign_keys=ON; CREATE TABLE _thief_restore_progress (chunk_index INTEGER PRIMARY KEY, sha TEXT NOT NULL)');
fs.mkdirSync('.release-sync/thief-restore-chunks',{recursive:true});
for(const [index,pieces] of chunks.entries()){
 const marker=sha(pieces.join('\n'));
 const sql=['PRAGMA defer_foreign_keys=TRUE;',...pieces,`INSERT INTO _thief_restore_progress (chunk_index,sha) VALUES(${index},'${marker}');`,'PRAGMA defer_foreign_keys=FALSE;'].join('\n');
 incremental.exec('BEGIN');incremental.exec(sql);incremental.exec('COMMIT');
 fs.writeFileSync(`.release-sync/thief-restore-chunks/${String(index).padStart(3,'0')}.sql`,sql);
}
assert.deepEqual(digest(incremental),before);assert.deepEqual(schemaRows(incremental),schemaRows(source));incremental.close();
fs.writeFileSync('.release-sync/thief-d1-restore-ordered.sql',ordered);
fs.writeFileSync('.release-sync/thief-d1-restore-offline-digests.json',JSON.stringify(before,null,2));
const receipt={status:'FK-enabled-ordered-restore-pass',sourceSHA256:sha(raw),orderedSHA256:sha(ordered),tables:tables.length,statements:statements.length,largestStatementBytes:statements.reduce((m,s)=>Math.max(m,Buffer.byteLength(s)),0),restoreOnlyChunks:chunks.length,chunkedOfflineRestoreAlsoByteEqual:true,allTablesCreatedBeforeData:true,parentDataBeforeChildren:true,triggersAfterData:true,schemaAndEveryRowBytePreserved:true,productionWrites:0};
fs.writeFileSync('docs/thief/ordered-restore-verification.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
source.close();target.close();
