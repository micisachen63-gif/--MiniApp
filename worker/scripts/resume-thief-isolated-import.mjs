// Fixed isolated target only. Native IPv4 transport for Wrangler's official import flow.
import fs from 'node:fs';
import https from 'node:https';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const database='b5c6665a-c830-4b60-b451-3933851b07c9';
assert.notEqual(database,'bbfb81bb-c6bc-453f-948a-2dc38f4a6ec4');
const cli=process.env.RPG_WRANGLER_CLI||'C:/Users/User/Documents/ChatGPT/star-journal-rpg/node_modules/wrangler/bin/wrangler.js';
const authResult=spawnSync(process.execPath,[cli,'auth','token','--json'],{windowsHide:true,encoding:'utf8',maxBuffer:1e6});
assert.equal(authResult.status,0,'Wrangler authentication unavailable');
const auth=JSON.parse(authResult.stdout.split(/\r?\n/).filter(line=>!line.startsWith('[CF transport]')).join('\n'));
assert(auth.token,'Missing Wrangler token');
const chunk=process.argv[2];assert(/^\d{3}$/.test(chunk),'A fixed private restore chunk index is required');
const file=`.release-sync/thief-restore-chunks/${chunk}.sql`,contents=fs.readFileSync(file),etag=createHash('md5').update(contents).digest('hex');
const marker=contents.toString('utf8').match(/INSERT INTO _thief_restore_progress \(chunk_index,sha\) VALUES\(\d+,'([a-f0-9]{64})'\)/)?.[1];assert(marker);
const endpoint=`https://api.cloudflare.com/client/v4/accounts/48259a9f84c8307f8de8ceaf704b9f8f/d1/database/${database}/import`;
async function request(url,method,headers,body){return new Promise((resolve,reject)=>{
 const req=https.request(new URL(url),{method,family:4,headers},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{clearTimeout(timer);resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)});});res.on('error',reject);});
 const timer=setTimeout(()=>req.destroy(Error('Isolated import transport timeout')),90000);req.on('error',e=>{clearTimeout(timer);reject(e);});if(body?.pipe)body.pipe(req);else req.end(body);
});}
async function api(body){let last;for(let attempt=0;attempt<(body.action==='ingest'?1:3);attempt++){try{const raw=Buffer.from(JSON.stringify(body));const res=await request(endpoint,'POST',{'Content-Type':'application/json','Content-Length':raw.length,Authorization:'Bearer '+auth.token},raw);const json=JSON.parse(res.body);fs.writeFileSync('.release-sync/thief-isolated-import-last-response.json',JSON.stringify(json));assert(res.status===200&&json.success,'Official isolated import API rejected; private response saved');return json.result;}catch(error){last=error;}}throw last;}
async function committed(){let last;for(let attempt=0;attempt<3;attempt++){try{const raw=Buffer.from(JSON.stringify({sql:`SELECT sha FROM _thief_restore_progress WHERE chunk_index=${Number(chunk)}`}));const res=await request(endpoint.replace(/\/import$/,'/query'),'POST',{'Content-Type':'application/json','Content-Length':raw.length,Authorization:'Bearer '+auth.token},raw);const json=JSON.parse(res.body);assert(res.status===200&&json.success,'Restore marker query failed');const found=json.result[0].results[0];if(found)assert.equal(found.sha,marker,'Restore chunk marker mismatch');return !!found;}catch(error){last=error;}}throw last;}
let phase='marker-preflight';
try{
 if(await committed()){console.log(JSON.stringify({chunk,status:'already-committed',productionWrites:0}));process.exit(0);}
 phase='init';let result=await api({action:'init',etag});console.log(JSON.stringify({phase:'init',uploadRequired:!!result.upload_url,status:result.status||null}));
 if(result.upload_url){
  phase='upload';let uploaded;
  for(let attempt=0;attempt<3;attempt++){try{uploaded=await request(result.upload_url,'PUT',{'Content-Length':fs.statSync(file).size},fs.createReadStream(file));if(uploaded.status>=200&&uploaded.status<300)break;}catch(error){if(attempt===2)throw error;}}
  assert(uploaded.status>=200&&uploaded.status<300,'Isolated upload failed');assert.equal(String(uploaded.headers.etag).replaceAll('"',''),etag);console.log(JSON.stringify({phase:'upload',status:'PASS'}));
  phase='ingest';
  result=await api({action:'ingest',filename:result.filename,etag});
 }
 while(!['complete','error'].includes(result.status)){
  fs.writeFileSync('.release-sync/thief-isolated-import-progress.json',JSON.stringify(result));console.log(JSON.stringify({phase:'import',status:result.status||'pending'}));
  phase='poll';result=await api({action:'poll',current_bookmark:result.at_bookmark});
 }
 assert.equal(result.status,'complete','Isolated import failed; private response retained');
 assert(await committed(),'Import completed without its atomic progress marker');
 fs.writeFileSync(`.release-sync/thief-isolated-import-completed-${chunk}.json`,JSON.stringify(result));console.log(JSON.stringify({phase:'import',chunk,status:'complete',productionWrites:0}));
}catch(error){fs.writeFileSync(`.release-sync/thief-isolated-import-error-${chunk}.json`,JSON.stringify({phase,message:error.message,code:error.code,stack:error.stack}));console.error(JSON.stringify({status:'FAIL',phase,chunk,name:error.name,code:error.code||null,productionWrites:0,privateDetailsRetained:true}));process.exitCode=1;}
