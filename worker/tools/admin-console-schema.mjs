// Explicit single-migration installer. Never runs the historical migration chain.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {withReleaseLock} from '../../scripts/release-lock.mjs';
import {commandResult,schemaState,applyReviewedSchema} from './admin-console-schema-lib.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),mode=process.argv[2]||'check';
assert(['check','apply'].includes(mode),'Use check or apply');
const file='worker/migrations/0033_admin_console.sql',migration=fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const statements=migration.replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);
assert(statements.every(x=>/^CREATE (TABLE|INDEX) rpg_[a-z_]+\b/.test(x)),'Only the reviewed additive DDL is allowed');
const local=new DatabaseSync(':memory:');local.exec('CREATE TABLE rpg_ledger(created_at INTEGER); CREATE TABLE rpg_characters(created_at INTEGER); CREATE TABLE rpg_admin_audit(created_at INTEGER)');local.exec(migration);
const names=statements.map(x=>/^CREATE (?:TABLE|INDEX) (\w+)/.exec(x)[1]),expected=local.prepare(`SELECT name,type,sql FROM sqlite_master WHERE name IN (${names.map(()=>'?').join(',')}) ORDER BY name`).all(...names);local.close();
const work=path.join(root,'.release-sync');fs.mkdirSync(work,{recursive:true});
function run(args,{json=true}={}){const r=spawnSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','elf-rpg','--remote','--config',path.join(root,'worker/wrangler.toml'),'--json',...args],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8e6});
 return commandResult(r,{json,onFailure:message=>fs.writeFileSync(path.join(work,'admin-schema-error.txt'),message)});
}
function inspect(){
 const response=run(['--command',`SELECT name,type,sql FROM sqlite_master WHERE name IN (${names.map(n=>"'"+n+"'").join(',')}) ORDER BY name; SELECT name FROM d1_migrations WHERE name='0033_admin_console.sql';`]);
 fs.writeFileSync(path.join(work,'admin-schema-'+Date.now()+'.json'),JSON.stringify(response,null,2));
 return schemaState(response,expected);
}
function git(...args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'Git inspection failed');return r.stdout.trim();}
if(mode==='check')console.log(JSON.stringify(inspect()));
else{
 assert.equal(git('status','--porcelain'),'','Apply only from a clean committed checkout');assert.equal(git('rev-parse','HEAD'),git('rev-parse','origin/main'),'Apply only the merged main source');
 const common=path.resolve(root,git('rev-parse','--git-common-dir'));
 await withReleaseLock(path.join(common,'rpg-release.lock'),{service:'admin-schema',checkout:root},async()=>{
  const result=applyReviewedSchema({inspect,write:()=>{
   const executable=path.join(work,'admin-console-0033-reviewed.sql');
   fs.writeFileSync(executable,migration+"\nINSERT INTO d1_migrations(name) VALUES('0033_admin_console.sql');\n");
   run(['--file',executable,'--yes'],{json:false});
  }});
  console.log(JSON.stringify({...result,...(result.changed?{scope:'0033 additive tables/indexes only; no player row updates',source:git('rev-parse','HEAD')}:{})}));
 });
}
