// Explicit single-migration installer. Never runs the historical migration chain.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {withReleaseLock} from '../../scripts/release-lock.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),mode=process.argv[2]||'check';
assert(['check','apply'].includes(mode),'Use check or apply');
const file='worker/migrations/0033_admin_console.sql',migration=fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const statements=migration.replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);
assert(statements.every(x=>/^CREATE (TABLE|INDEX) rpg_[a-z_]+\b/.test(x)),'Only the reviewed additive DDL is allowed');
const local=new DatabaseSync(':memory:');local.exec('CREATE TABLE rpg_ledger(created_at INTEGER); CREATE TABLE rpg_characters(created_at INTEGER); CREATE TABLE rpg_admin_audit(created_at INTEGER)');local.exec(migration);
const names=statements.map(x=>/^CREATE (?:TABLE|INDEX) (\w+)/.exec(x)[1]),expected=local.prepare(`SELECT name,type,sql FROM sqlite_master WHERE name IN (${names.map(()=>'?').join(',')}) ORDER BY name`).all(...names);local.close();
const work=path.join(root,'.release-sync');fs.mkdirSync(work,{recursive:true});
function run(args){const r=spawnSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','elf-rpg','--remote','--config',path.join(root,'worker/wrangler.toml'),'--json',...args],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8e6});
 if(r.status!==0){fs.writeFileSync(path.join(work,'admin-schema-error.txt'),r.stderr||r.stdout||'CLI failed');throw Error('D1 command failed; inspect .release-sync/admin-schema-error.txt and live schema before continuing. Do not blindly retry.');}
 return JSON.parse(r.stdout.replace(/^\uFEFF/,''));
}
function inspect(){
 const response=run(['--command',`SELECT name,type,sql FROM sqlite_master WHERE name IN (${names.map(n=>"'"+n+"'").join(',')}) ORDER BY name; SELECT name FROM d1_migrations WHERE name='0033_admin_console.sql';`]);
 fs.writeFileSync(path.join(work,'admin-schema-'+Date.now()+'.json'),JSON.stringify(response,null,2));
 const present=response[0].results,recorded=response[1].results.length===1;
 if(present.length){assert.deepEqual(present,expected,'Partial or different admin schema detected; stop for inspection');assert(recorded,'Schema exists without its migration receipt; inspect before recording');return {installed:true,objects:present.length};}
 assert(!recorded,'Migration receipt exists but admin objects are absent');return {installed:false,objects:0};
}
function git(...args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'Git inspection failed');return r.stdout.trim();}
if(mode==='check')console.log(JSON.stringify(inspect()));
else{
 assert.equal(git('status','--porcelain'),'','Apply only from a clean committed checkout');assert.equal(git('rev-parse','HEAD'),git('rev-parse','origin/main'),'Apply only the merged main source');
 const common=path.resolve(root,git('rev-parse','--git-common-dir'));
 await withReleaseLock(path.join(common,'rpg-release.lock'),{service:'admin-schema',checkout:root},async()=>{
  const before=inspect();if(before.installed){console.log(JSON.stringify({...before,changed:false}));return;}
  const executable=path.join(work,'admin-console-0033-reviewed.sql');
  fs.writeFileSync(executable,migration+"\nINSERT INTO d1_migrations(name) VALUES('0033_admin_console.sql');\n");
  run(['--file',executable,'--yes']);
  console.log(JSON.stringify({...inspect(),changed:true,scope:'0033 additive tables/indexes only; no player row updates',source:git('rev-parse','HEAD')}));
 });
}
