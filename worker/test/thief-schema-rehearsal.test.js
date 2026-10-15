import test from 'node:test';
import assert from 'node:assert/strict';
import rehearsal from '../tools/thief-schema-rehearsal/index.js';
import {readFileSync} from 'node:fs';
import {D1Shim} from './d1-shim.js';
const source=JSON.parse(readFileSync(new URL('../../docs/thief/live-schema-source.json',import.meta.url)));
const candidate=JSON.parse(readFileSync(new URL('../../docs/thief/live-schema-candidate.json',import.meta.url)));
const db={prepare(){throw Error('Unauthorised request reached DB');},batch(){throw Error('Unauthorised request reached DB');}};
const request=(path,token,body={})=>new Request('https://isolated.invalid'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('rehearsal requires the isolated mode and secret before accessing any database',async()=>{
 for(const env of [{DB:db},{DB:db,MODE:'production',REHEARSAL_TOKEN:'correct'},{DB:db,MODE:'isolated-rehearsal',REHEARSAL_TOKEN:'correct'}]){
  const response=await rehearsal.fetch(request('/apply','wrong',{sql:'DROP TABLE players'}),env);assert.equal(response.status,404);
 }
});
test('authenticated rehearsal has no arbitrary SQL endpoint and restricts digest tables and candidate',async()=>{
 const env={DB:db,MODE:'isolated-rehearsal',REHEARSAL_TOKEN:'correct'};
 for(const [path,body,status] of [['/query',{sql:'DROP TABLE players'},404],['/page-digest',{table:'sqlite_master'},400],['/page-digest',{table:'rpg_characters',offset:-1},400],['/apply',{expectedBeforeSHA256:'invented',sql:'anything'},409]]){
  const response=await rehearsal.fetch(request(path,'correct',body),env);assert.equal(response.status,status);
 }
});
test('authorized production executor cannot fault-inject, expose row digests, or apply a different source',async()=>{
 const env={DB:db,MODE:'authorized-production-expansion',REHEARSAL_TOKEN:'correct',EXPECTED_DATABASE_ID:'bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4',AUTHORIZATION:'human-approved-thief-expansion-20261015',SOURCE_COMMIT:'a'.repeat(40)};
 for(const path of ['/rollback','/page-digest','/sequence-digest'])assert.equal((await rehearsal.fetch(request(path,'correct'),env)).status,404);
 assert.equal((await rehearsal.fetch(request('/apply','correct',{sourceCommit:'b'.repeat(40)}),env)).status,409);
 assert.equal((await rehearsal.fetch(request('/record-migration','correct',{sourceCommit:'b'.repeat(40)}),env)).status,409);
});

test('production tracking refuses the old schema and records only the exact expanded schema idempotently',async()=>{
 const fixture=new D1Shim();
 try{
  for(const type of ['table','index','view','trigger'])for(const object of source.objects.filter(r=>r.type===type))fixture.sqlite.exec(object.sql);
  fixture.sqlite.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const env={DB:fixture,MODE:'authorized-production-expansion',REHEARSAL_TOKEN:'correct',EXPECTED_DATABASE_ID:'bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4',AUTHORIZATION:'human-approved-thief-expansion-20261015',SOURCE_COMMIT:'a'.repeat(40)};
  const body={sourceCommit:env.SOURCE_COMMIT};
  assert.equal((await rehearsal.fetch(request('/record-migration','correct',body),env)).status,409);
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,0);
  await fixture.batch(candidate.statements.map(s=>fixture.prepare(s.sql)));
  for(let i=0;i<2;i++){
   const response=await rehearsal.fetch(request('/record-migration','correct',body),env);
   assert.equal(response.status,200);assert.equal((await response.json()).initializerRecorded,true);
  }
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,1);
  const checked=await (await rehearsal.fetch(request('/schema','correct'),env)).json();
  assert.equal(checked.schemaSHA256,candidate.schemaSha256ExpectedAfter);assert.equal(checked.initializerRecorded,true);assert.equal(checked.foreignKeyErrors,0);
 }finally{fixture.sqlite.close();}
});
