import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {commandResult,schemaRows,schemaState,applyReviewedSchema} from '../tools/admin-console-schema-lib.mjs';

const migration=readFileSync(new URL('../migrations/0033_admin_console.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
function reviewedSchema(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE rpg_ledger(created_at INTEGER); CREATE TABLE rpg_characters(created_at INTEGER); CREATE TABLE rpg_admin_audit(created_at INTEGER)');db.exec(migration);
 const names=[...migration.matchAll(/^CREATE (?:TABLE|INDEX) (\w+)/gm)].map(match=>match[1]);
 return db.prepare(`SELECT name,type,sql FROM sqlite_master WHERE name IN (${names.map(()=>'?').join(',')}) ORDER BY name`).all(...names);
}
const remote=(rows,receipt=true)=>[{success:true,results:JSON.parse(JSON.stringify(rows))},{success:true,results:receipt?[{name:'0033_admin_console.sql'}]:[]}];
const result=stdout=>({status:0,stdout,stderr:'',signal:null});

test('Wrangler file writes accept successful non-JSON upload progress without treating stdout as a receipt',()=>{
 const progress='├ Checking if file needs uploading\nUploading reviewed DDL…\n';
 assert.equal(commandResult(result(progress),{json:false}),undefined);
 assert.equal(commandResult(result(''),{json:false}),undefined);
 assert.throws(()=>commandResult(result(progress)),SyntaxError);
});
test('schema reads still require strict JSON and permit only a leading UTF8 BOM',()=>{
 const response=remote([] ,false),json=JSON.stringify(response);
 assert.deepEqual(commandResult(result(json)),response);
 assert.deepEqual(commandResult(result('\uFEFF'+json)),response);
 for(const invalid of ['', 'upload progress\n'+json, json+'\ncompleted', '{broken'])assert.throws(()=>commandResult(result(invalid)),SyntaxError);
});
test('nonzero, signaled or spawn-error CLI results are failures even if stdout resembles success',()=>{
 for(const failed of [{status:1},{status:null,signal:'SIGTERM'},{status:0,error:new Error('spawn failed')}]){
  let diagnostic;
  assert.throws(()=>commandResult({...result('[{"success":true}]'),...failed,stderr:'isolated CLI failure'},{json:false,onFailure:message=>diagnostic=message}),/D1 command failed/);
  assert.equal(diagnostic,'isolated CLI failure');
 }
});
test('real node SQLite null-prototype schema rows match identical Wrangler plain objects without weakening exact values',t=>{
 const expected=reviewedSchema(t),response=remote(expected);
 assert.equal(expected.length,10);assert.equal(Object.getPrototypeOf(expected[0]),null);
 assert.equal(Object.getPrototypeOf(response[0].results[0]),Object.prototype);
 assert.deepEqual(schemaState(response,expected),{installed:true,objects:10});
 assert.deepEqual(schemaRows(expected),response[0].results);
 assert.equal(Object.getPrototypeOf(expected[0]),null,'normalization must not mutate source rows');
});
test('partial or changed name/type/SQL remains rejected after row-prototype normalization',t=>{
 const expected=reviewedSchema(t);
 for(const field of ['name','type','sql']){
  const response=remote(expected);response[0].results[0][field]+=' changed';
  assert.throws(()=>schemaState(response,expected),/Partial or different admin schema/);
 }
 const partial=remote(expected.slice(1));assert.throws(()=>schemaState(partial,expected),/Partial or different admin schema/);
 const reordered=remote([...expected].reverse());assert.throws(()=>schemaState(reordered,expected),/Partial or different admin schema/);
 const extra=remote(expected);extra[0].results[0].unexpected='value';assert.throws(()=>schemaState(extra,expected),/Partial or different admin schema/);
});
test('schema acceptance requires exactly one correct migration receipt and rejects inconsistent or malformed reads',t=>{
 const expected=reviewedSchema(t);
 assert.deepEqual(schemaState(remote([],false),expected),{installed:false,objects:0});
 assert.throws(()=>schemaState(remote(expected,false),expected),/without its migration receipt/);
 assert.throws(()=>schemaState(remote([],true),expected),/receipt exists but admin objects are absent/);
 const duplicate=remote(expected);duplicate[1].results.push({name:'0033_admin_console.sql'});assert.throws(()=>schemaState(duplicate,expected),/without its migration receipt/);
 const wrong=remote(expected);wrong[1].results[0].name='another_migration.sql';assert.throws(()=>schemaState(wrong,expected),/Unexpected admin migration receipt/);
 for(const invalid of [null,{},[],[{results:[]}], [{success:false,results:[]},{results:[]}], [{results:{}},{results:[]}]])
  assert.throws(()=>schemaState(invalid,expected),/Invalid schema inspection/);
});
test('successful file write with upload progress verifies authoritative postcondition once and reports installed state',t=>{
 const expected=reviewedSchema(t);let reads=0,writes=0;
 const installed=applyReviewedSchema({inspect:()=>schemaState(++reads===1?remote([],false):remote(expected),expected),write:()=>{
  writes++;commandResult(result('├ Checking if file needs uploading\nDDL executed successfully'),{json:false});
 }});
 assert.deepEqual(installed,{installed:true,objects:10,changed:true});assert.equal(reads,2);assert.equal(writes,1);
});
test('an already installed schema is read-only and never repeats DDL or migration insertion',t=>{
 const expected=reviewedSchema(t);let reads=0,writes=0;
 const state=applyReviewedSchema({inspect:()=>{reads++;return schemaState(remote(expected),expected);},write:()=>writes++});
 assert.deepEqual(state,{installed:true,objects:10,changed:false});assert.equal(reads,1);assert.equal(writes,0);
});
test('partial schema before a write stops safely without attempting any repair or DDL',t=>{
 const expected=reviewedSchema(t);let writes=0;
 assert.throws(()=>applyReviewedSchema({inspect:()=>schemaState(remote(expected.slice(1)),expected),write:()=>writes++}),/Partial or different admin schema/);
 assert.equal(writes,0);
});
test('successful CLI exit without a verified installed schema is not reported as a successful install and is never retried',()=>{
 let reads=0,writes=0;
 assert.throws(()=>applyReviewedSchema({inspect:()=>{reads++;return {installed:false,objects:0};},write:()=>{writes++;commandResult(result('progress'),{json:false});}}),/without verified admin schema/);
 assert.equal(reads,2);assert.equal(writes,1);
});
test('failed command or failed post-write read never triggers another write or a false installed result',t=>{
 const expected=reviewedSchema(t);
 for(const failure of ['cli','read-json','read-drift']){
  let reads=0,writes=0;
  assert.throws(()=>applyReviewedSchema({inspect:()=>{
   if(++reads===1)return schemaState(remote([],false),expected);
   if(failure==='read-json')return commandResult(result('├ non-JSON read response'));
   const drift=remote(expected);drift[0].results[0].sql+=' changed';return schemaState(drift,expected);
  },write:()=>{writes++;if(failure==='cli')commandResult({...result(''),status:1},{json:false});}}));
  assert.equal(writes,1,failure);assert.equal(reads,failure==='cli'?1:2,failure);
 }
});
