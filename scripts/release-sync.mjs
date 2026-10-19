// GitHub-first publication. Checks use only GETs and local dry-run builds.
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {assertKnownRelease} from './release-lock.mjs';
import {isStaticAsset} from './static-assets.mjs';
import {retryRead} from './read-only-network.mjs';
import {readDeploymentRecords,appendDeploymentReceipt} from './deployment-records.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const REPO='https://github.com/micisachen63-gif/--MiniApp';
const ACCOUNT='48259a9f84c8307f8de8ceaf704b9f8f';
const SERVICES={worker:{dir:'worker',name:'elf-rpg-api',test:'test:worker',crons:['* * * * *','*/30 * * * *']},bot:{dir:'cloud-bot',name:'star-journal-rpg-bot',test:'test:bot',crons:['* * * * *']}};
const sha=b=>createHash('sha256').update(b).digest('hex');
const WORK=path.join(ROOT,'.release-sync');
const agent=new https.Agent({keepAlive:true,maxSockets:4});
const cli=process.env.RPG_WRANGLER_CLI||path.join(ROOT,'node_modules/wrangler/bin/wrangler.js');
let deploymentRecords;
function run(command,args,cwd=ROOT){const r=spawnSync(command,args,{cwd,windowsHide:true,encoding:'utf8',maxBuffer:32e6});assert.equal(r.status,0,`${command} ${args.join(' ')} failed\n${r.stderr||r.stdout||r.error?.message}`);return r.stdout.trim()}
const git=(...args)=>run('git',args);
const sorted=a=>[...a].sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
async function save(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n')}
async function digest(file){const h=createHash('sha256'),handle=await fs.open(file);try{for await(const chunk of handle.createReadStream())h.update(chunk)}finally{await handle.close()}return h.digest('hex')}
async function request(url,token){
 const target=new URL(url);assert.equal(target.protocol,'https:');
 if(token)assert.equal(target.hostname,'api.cloudflare.com');
 return retryRead(()=>new Promise((resolve,reject)=>{
  const req=https.get(target,{agent,family:4,headers:{accept:'*/*','accept-encoding':'identity',...(token?{Authorization:'Bearer '+token}:{})}},res=>{
   const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',reject);
   res.on('end',()=>{clearTimeout(timer);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers}));});
  });
  const timer=setTimeout(()=>req.destroy(Object.assign(new Error('Read-only request timed out'),{code:'ETIMEDOUT'})),90000);
  req.on('error',e=>{clearTimeout(timer);reject(e);});
 }));
}

async function credentials(){
 if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
 // Wrangler owns credential storage/refresh, including OS keyrings and named profiles.
 // Never print or persist its credential response, including on CLI errors.
 const result=spawnSync(process.execPath,[cli,'auth','token','--json'],{cwd:ROOT,windowsHide:true,encoding:'utf8',maxBuffer:1e6});
 assert.equal(result.status,0,'Wrangler authentication unavailable; run wrangler login');
 const output=(result.stdout||'').split(/\r?\n/).filter(line=>!line.startsWith('[CF transport]')).join('\n');
 let auth;try{auth=JSON.parse(output)}catch{throw Error('Wrangler authentication response was not valid JSON')}
 assert(['oauth','api_token'].includes(auth.type)&&auth.token,'Use wrangler login or CLOUDFLARE_API_TOKEN');return auth.token;
}
async function api(service,suffix,token){const r=await request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${service.name}/${suffix}`,token);assert(r.ok,`Cloudflare GET ${suffix}: HTTP ${r.status}`);return r}
async function state(service,token){
 const [settings,deployment,schedules]=await Promise.all(['settings','deployments','schedules'].map(async p=>(await api(service,p,token)).json()));for(const r of [settings,deployment,schedules])assert(r.success,'Cloudflare control read failed');
 const b=settings.result.bindings;assert.equal(b.find(x=>x.name==='GROUP_CHAT_ID')?.text,'-1004342516953');assert(b.some(x=>x.name==='BOT_TOKEN'&&x.type==='secret_text'));
 if(service.dir==='worker'){assert.equal(b.find(x=>x.name==='DB')?.id,'bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4');assert.equal(b.find(x=>x.name==='AUTO_ENHANCE_RUNNER')?.namespace_id,'e9663e6cc0844358893b28f1b613228c')}
 else{assert.equal(b.find(x=>x.name==='RPG_API')?.service,'elf-rpg-api');assert(b.find(x=>x.name==='BOT_COORDINATOR')?.namespace_id)}
 const crons=(Array.isArray(schedules.result)?schedules.result:schedules.result.schedules).map(x=>x.cron).sort();assert.deepEqual(crons,[...service.crons].sort());
 // Store no secret values or plain-text configuration values.
 const bindings=sorted(b.map(x=>{const {text,json,...rest}=x;return {...rest,...(text!==undefined?{valueSHA256:sha(text)}:{}),...(json!==undefined?{valueSHA256:sha(JSON.stringify(json))}:{})}}));
 return {versions:deployment.result.deployments[0].versions,bindings,crons};
}
async function modules(service,token){const form=await(await api(service,'content/v2',token)).formData(),out={};for(const [,value]of form)if(typeof value!=='string'&&!value.name.endsWith('.map')){const name=value.name.replace(/^(?:\.\/)+/,'');assert(!Object.hasOwn(out,name),'Duplicate live runtime module');out[name]=sha(Buffer.from(await value.arrayBuffer()))}assert(Object.keys(out).length,'No live runtime modules');return out}
function ready(){
 assert.equal(git('remote','get-url','origin').replace(/\.git$/,''),REPO,'Unexpected GitHub origin');git('fetch','origin','main');
 assert.equal(git('rev-parse','HEAD'),git('rev-parse','origin/main'),'Push this exact source commit to GitHub before checking/deploying');
 assert.equal(git('status','--porcelain'),'','Commit changes before checking/deploying');return git('rev-parse','HEAD');
}
async function source(service){const files=git('ls-files','-z','--',service.dir).split('\0').filter(Boolean).filter(f=>!/(^|\/)(?:test|smoke|tools)\//.test(f)&&!/(?:AGENTS|README)\.md$/.test(f));const hashes=[];for(const file of files)hashes.push({file,sha256:await digest(path.join(ROOT,file))});return {fileCount:hashes.length,sha256:sha(JSON.stringify(hashes)),files:hashes}}
async function publicInventory(service){const prefix=service.dir+'/public/',tracked=git('ls-files','-z','--',prefix).split('\0').filter(Boolean).sort(),actual=[];async function walk(dir,relative){for(const e of await fs.readdir(dir,{withFileTypes:true})){assert(!e.isSymbolicLink(),'Public symlink is not portable: '+relative+e.name);if(e.isDirectory())await walk(path.join(dir,e.name),relative+e.name+'/');else actual.push(relative+e.name)}}await walk(path.join(ROOT,prefix),prefix);assert.deepEqual(actual.sort(),tracked,'Public contains missing or untracked/ignored files: commit complete assets before release')}
async function build(service){await publicInventory(service);await fs.access(cli);const folder=path.join(WORK,service.name,'build-'+randomUUID());await fs.mkdir(folder,{recursive:true});const output=run(process.execPath,[cli,'deploy','--dry-run','--outdir',folder,'--config','wrangler.toml'],path.join(ROOT,service.dir));await fs.writeFile(path.join(WORK,service.name,'build.log'),output);const out={};for(const entry of await fs.readdir(folder)){if(entry.endsWith('.map')||entry==='README.md')continue;const file=path.join(folder,entry);if((await fs.stat(file)).isFile())out[entry]=await digest(file)}return out}
async function publicRead(url){for(let i=0;i<4;i++){const r=await request(url);if([301,302,303,307,308].includes(r.status)){const next=new URL(r.headers.get('location'),url);assert.equal(next.origin,new URL(url).origin);url=next.href;continue}assert(r.ok,'Public GET failed '+new URL(url).pathname+' HTTP '+r.status);return Buffer.from(await r.arrayBuffer())}throw Error('Excessive public redirects')}
async function assets(service,commit){
 const prefix=service.dir+'/public/',all=git('ls-files','-z','--',prefix).split('\0').filter(Boolean).filter(isStaticAsset);let previous;
 previous=deploymentRecords.receipts[service.name];
 const chosen=new Set(all.filter(f=>!f.slice(prefix.length).includes('/')&&/\.(?:js|css|json|html)$/.test(f)));for(const f of all.filter(f=>/\.(?:png|webp|jpg|wasm)$/.test(f)).filter((_,i)=>i%Math.max(1,Math.floor(all.length/4))===0).slice(0,4))chosen.add(f);
 if(previous?.sourceCommit){for(const file of git('diff','--name-only',previous.sourceCommit,commit,'--',prefix).split(/\r?\n/).filter(Boolean))if(all.includes(file))chosen.add(file)}
 const queue=[...chosen],verified=[];await Promise.all(Array.from({length:4},async()=>{for(;;){const file=queue.shift();if(!file)return;const actual=sha(await publicRead(`https://${service.name}.micisachen.workers.dev/${file.slice(prefix.length)}?sync=${commit}`));assert.equal(actual,await digest(path.join(ROOT,file)),'Live asset differs: '+file);verified.push(file)}}));return {scope:'Root JS/CSS/JSON/HTML entrypoints, representative binary assets, and every added/modified public file since the recorded source commit; initial adoption is not a full historical binary download.',verifiedCount:verified.length,files:verified.sort()};
}
async function verify(service,commit,built,before){const token=await credentials(),live=await state(service,token);assert.equal(live.versions.length,1);assert.equal(live.versions[0].percentage,100);if(before){assert.deepEqual(live.bindings,before.bindings,'Production bindings changed');assert.deepEqual(live.crons,before.crons,'Production schedules changed')}
 const runtime=await modules(service,token);assert.deepEqual(runtime,built,'Live runtime differs from GitHub build; inspect the newer release, never overwrite it to make a check pass');const verifiedAssets=await assets(service,commit);const health=JSON.parse((await publicRead(`https://${service.name}.micisachen.workers.dev/health`)).toString());assert.equal(health.ok,true);assert.deepEqual((await state(service,token)).versions,live.versions,'Concurrent publication during verification');assert.equal(git('rev-parse','HEAD'),commit);assert.equal(git('status','--porcelain'),'','Source changed during verification');
 const report={status:'VERIFIED',repository:REPO,sourceCommit:commit,service:service.name,productionVersion:live.versions[0].version_id,activePercentage:100,verifiedAt:new Date().toISOString(),runtimeSHA256:runtime,source:await source(service),assets:verifiedAssets,protectedState:live,noPlayerMutations:true};assert.equal(ready(),commit,'GitHub advanced during verification');await save(path.join(WORK,service.name,'verified.json'),report);console.log(`${service.name}: VERIFIED ${report.productionVersion} @100, GitHub ${commit.slice(0,12)}, ${verifiedAssets.verifiedCount} public files`);return report;
}
async function main(){const [mode='check',target='all']=process.argv.slice(2);assert(['check','deploy','record'].includes(mode),'Use check, deploy or record');assert(['all','worker','bot'].includes(target),'Use worker, bot, or all');assert(mode==='check'||target!=='all','Publish or record one service at a time');const commit=ready();deploymentRecords=readDeploymentRecords(ROOT);
 for(const key of target==='all'?['worker','bot']:[target]){const service=SERVICES[key],before=await state(service,await credentials());if(mode==='deploy')assertKnownRelease(deploymentRecords.receipts[service.name],before);const built=await build(service);assert.equal(ready(),commit);
  if(mode==='deploy'){
   const npm=process.env.npm_execpath;assert(npm,'Use npm run deploy:worker or npm run deploy:bot');console.log(run(process.execPath,[npm,'run',service.test]));assert.equal(ready(),commit);assert.deepEqual(await state(service,await credentials()),before,'Concurrent production change');
   await save(path.join(WORK,service.name,'pending.json'),{sourceCommit:commit,before,built,startedAt:new Date().toISOString()});
   // On any CLI error leave pending.json, inspect current state with sync:check;
   // never retry an uncertain publication automatically.
   const result=spawnSync(process.execPath,[cli,'deploy','--config','wrangler.toml','--tag','git-'+commit.slice(0,12),'--message',REPO+'/commit/'+commit],{cwd:path.join(ROOT,service.dir),windowsHide:true,encoding:'utf8',maxBuffer:32e6}),output=(result.stdout||'')+'\n'+(result.stderr||'');await fs.writeFile(path.join(WORK,service.name,'deploy.log'),output);assert.equal(result.status,0,'Deployment failed/uncertain: inspect live state and deploy.log; do not blindly retry');assert(output.includes('Current Version ID:'),'No version receipt: inspect live state');
  }
  const report=await verify(service,commit,built,mode==='deploy'||mode==='record'?before:null);
  if(mode==='deploy'||mode==='record'){const receipt=appendDeploymentReceipt(ROOT,service.name,report,deploymentRecords);assert.equal(ready(),commit);console.log(`Verified receipt: ${receipt.url}`);console.log(mode==='deploy'?'PUBLISHED_AND_GITHUB_SYNCED':'RECEIPT_RECORDED_AND_GITHUB_SYNCED')}
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>agent.destroy());
