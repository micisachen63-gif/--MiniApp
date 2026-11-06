// Local integrated Worker/BOT gate. Mirrors scripts/run-tests.mjs file selection.
// Bounded concurrency changes resource use only; no tests are filtered or skipped.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const git='C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe';
const target=process.argv[2]||'all';
if(!['worker','bot','all'].includes(target))throw Error('Use worker, bot or all');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const reportOnlyPaths=new Set(['worker/public/skill-vfx-coverage.json']);
const dir=path.join(root,'.release-sync/skill-vfx-all-20261104/full-gate-'+stamp);
fs.mkdirSync(dir,{recursive:true});
function gitRead(args){const r=spawnSync(git,args,{cwd:root,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
function hashFile(rel){const bytes=fs.readFileSync(path.join(root,rel));return {path:rel.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
function fingerprints(){const paths=[];function walk(rel){for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){const p=path.join(rel,e.name);if(e.isDirectory()&&e.name!=='node_modules'&&e.name!=='.release-sync')walk(p);else if(e.isFile()&&/\.(?:js|mjs|cjs|json|css|html)$/.test(e.name))paths.push(p);}}for(const p of ['worker/src','worker/public','worker/test','worker/tools','cloud-bot/src','cloud-bot/test','scripts'])walk(p);for(const p of ['package.json','package-lock.json','worker/package.json','worker/package-lock.json','cloud-bot/package.json','cloud-bot/package-lock.json'])if(fs.existsSync(path.join(root,p)))paths.push(p);return [...new Set(paths)].sort().filter(p=>!reportOnlyPaths.has(p.replaceAll('\\','/'))).map(hashFile);}
if(Number(process.versions.node.split('.')[0])!==24)throw Error('Expected Node 24');
const receipt={schemaVersion:1,startedAt:new Date().toISOString(),node:process.version,target,branch:gitRead(['branch','--show-current']),head:gitRead(['rev-parse','HEAD']),concurrency:2,sourceFingerprintExclusions:{paths:[...reportOnlyPaths],reason:'Generated verification report only; does not drive combat/rendering. Validated separately after browser evidence completes.'},selection:'Exact directory/extension/sort enumeration of scripts/run-tests.mjs; no exclusions',sourceFilesBefore:fingerprints(),services:[],status:'running'};
const receiptPath=path.join(dir,'validation.json');
const save=()=>fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');save();
for(const service of target==='all'?['worker','bot']:[target]){
 const cwd=path.join(root,service==='worker'?'worker':'cloud-bot'),folder=service==='worker'?'test':'src/adapter/test';
 const files=fs.readdirSync(path.join(cwd,folder)).filter(n=>n.endsWith('.test.js')).sort().map(n=>path.join(folder,n));
 if(service==='bot')files.push(...fs.readdirSync(path.join(cwd,'test')).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>path.join('test',n)));
 const args=['--test','--test-reporter=tap','--test-concurrency=2',...files],tap=path.join(dir,service+'.tap'),stderr=path.join(dir,service+'-stderr.log');
 const out=fs.openSync(tap,'w'),err=fs.openSync(stderr,'w'),startedAt=new Date().toISOString();
 const result=spawnSync(process.execPath,args,{cwd,stdio:['ignore',out,err],windowsHide:true,timeout:1200000});
 fs.closeSync(out);fs.closeSync(err);
 const raw=fs.readFileSync(tap,'utf8'),counts={};
 for(const label of ['tests','suites','pass','fail','cancelled','skipped','todo','duration_ms']){const m=raw.match(new RegExp('^# '+label+' ([0-9.]+)$','m'));counts[label]=m?Number(m[1]):null;}
 const entry={service,startedAt,finishedAt:new Date().toISOString(),files:files.map(p=>p.replaceAll('\\','/')),command:[process.execPath,...args],exitCode:result.status,signal:result.signal,error:result.error?.message||null,counts,tap:hashFile(path.relative(root,tap)),stderr:hashFile(path.relative(root,stderr))};
 receipt.services.push(entry);save();console.log(JSON.stringify({service,exitCode:result.status,counts,receiptPath}));
 if(result.status!==0||!(counts.tests>0)||counts.fail!==0||counts.cancelled!==0||counts.skipped!==0||counts.todo!==0){receipt.status='failed';break;}
}
receipt.sourceFilesAfter=fingerprints();
const after=new Map(receipt.sourceFilesAfter.map(r=>[r.path,r.sha256]));
receipt.sourceChangedDuring=receipt.sourceFilesBefore.filter(r=>after.get(r.path)!==r.sha256).map(r=>r.path);
const beforeSet=new Set(receipt.sourceFilesBefore.map(r=>r.path));
receipt.sourceAddedDuring=receipt.sourceFilesAfter.filter(r=>!beforeSet.has(r.path)).map(r=>r.path);
receipt.headAfter=gitRead(['rev-parse','HEAD']);receipt.branchAfter=gitRead(['branch','--show-current']);
if(receipt.status==='running')receipt.status=receipt.sourceChangedDuring.length||receipt.sourceAddedDuring.length||receipt.head!==receipt.headAfter||receipt.branch!==receipt.branchAfter?'source-drift':'passed';
receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:receipt.status,receiptPath,sourceChangedDuring:receipt.sourceChangedDuring,sourceAddedDuring:receipt.sourceAddedDuring,services:receipt.services.map(s=>({service:s.service,counts:s.counts}))}));
if(receipt.status!=='passed')process.exitCode=1;
