/* Segmented real Chrome Guardian acceptance. One claimed case can never be
 * replayed. Successful operations are persisted before UI assertions.
 * --receipt-only bridges inspect exact originals; --resume-run is forbidden.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),args=new Map(),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),q=value=>JSON.stringify(String(value));
for(const input of process.argv.slice(2)){const m=/^--(case|run-id|bridge-run|job-run|job-bridge-run|resume-run)=([A-Za-z0-9][A-Za-z0-9_.-]{0,110})$/.exec(input);assert(m&&!args.has(m[1]),'Use --case=... --run-id=... [--bridge-run=...] [--job-run=...] [--job-bridge-run=...]');args.set(m[1],m[2]);}
assert(!args.has('resume-run'),'Never resume/replay a whole mutation case. Read the exact saved receipt and continue only an explicitly different case.');
const selected=args.get('case')||'layout';
const cases=['layout','pure','welcome','summon-normal-1','summon-normal-5','summon-normal-10','summon-featured-1','summon-featured-5','summon-featured-10','paid-normal-10','fuse-white','fuse-red','fuse-gold','activate','activate-null','lock','unlock','unbind','assist-start','assist-pause','assist-resume','assist-pause-switch','assist-switch','assist-continuation-on','assist-continuation-off','assist-supply-on','assist-supply-off','assist-buy','assist-select','sale-lost','not-found-recovery','auto-start-null','auto-step-first','auto-step-next','auto-stop-alt','auto-seen-alt','auto-zero-start','auto-zero-step','auto-zero-seen','auto-resources-start','auto-resources-step','auto-resources-seen','auto-target-start','auto-target-step','auto-target-seen','races','receipt-only','gallery','pure-tail'];
assert(cases.includes(selected),'Unknown exact case');
const readOnly=['layout','pure','races','receipt-only','gallery','pure-tail'].includes(selected),bridge=args.has('bridge-run');
assert(!bridge||['receipt-only','gallery','pure-tail'].includes(selected),'A bridge only reads exact prior evidence');assert(!['receipt-only','pure-tail'].includes(selected)||bridge,'This precise bridge requires original --bridge-run');
const local=value=>{const u=new URL(value);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&Number(u.port)>=1024,'Loopback only');return u.origin;};
const origin=local(process.env.GUARDIAN_SCENE_ORIGIN||'http://127.0.0.1:9783'),api=local(process.env.GUARDIAN_API_ORIGIN||'http://127.0.0.1:9782');assert.notEqual(origin,api);
const runId=args.get('run-id')||new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid,base=path.join(repo,'.release-sync/angel-20261105'),dir=path.join(base,'browser',runId),route='guardian/action-scoped';
const FRONT=['scene-guardian-ui.js','scene-guardian-ui.css','scene-live-session.js','scene-social-preview.js','scene-social-preview.css','scene-window-manager.js'];
const ART=['melee','ranged','magic','loot'].map(type=>'art/guardian-sigil-20261013/'+type+'.webp');
function hashes(){
 const listed=execFileSync('C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:repo,encoding:'utf8',maxBuffer:8*1024*1024}).split('\0').filter(Boolean);
 const fixed=[...FRONT,...ART].map(p=>'worker/public/'+p).concat(['guardian-browser.cjs','guardian-qa-fixture.mjs','atlas-local-preview.mjs','scene-live-preview.mjs','scene-preview-bindings.mjs'].map(p=>'worker/tools/'+p),['d1-shim.js','client-request.js','realm-test-helpers.js'].map(p=>'worker/test/'+p));
 const files=[...new Set([...listed.filter(p=>/^worker\/(?:src|migrations)\//.test(p)&&/\.(?:[cm]?js|json|sql)$/.test(p)),...fixed])].sort();
 return Object.fromEntries(files.map(p=>[p,sha(fs.readFileSync(path.join(repo,p)))]));
}
function playwright(){for(const p of [process.env.RPG_PLAYWRIGHT_MODULE,path.join(repo,'.release-sync/browser-tools/node_modules/playwright'),path.join(repo,'../star-journal-party-integration-20261104/.release-sync/browser-tools/node_modules/playwright'),path.join(repo,'../star-journal-skill-career-integration-20261104/.release-sync/browser-tools/node_modules/playwright'),'playwright',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)){try{return require(require.resolve(p));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}throw Error('Existing Playwright installation required');}

const RECORDED_FIELDS={
 welcome:['configVersion'],summon:['configVersion','pool','count','expectedCosts'],fuse:['configVersion','itemIds','primaryId','expectedCosts'],activate:['configVersion','itemId'],lock:['configVersion','itemId','locked'],unbind:['configVersion','itemId','expectedCosts'],assist:['configVersion','mode','itemId','quantity','autoRenew','autoBuy','expectedCosts'],sale:['configVersion','characterId','itemIds','expectedGold'],'auto-start':['configVersion','pool','count','targetType','targetRank','maxGold'],'auto-stop':['jobId'],'auto-seen':['jobId']
};
const RECORDED_COSTS={summon:['gold','vouchers','credits','freeNormalDraws'],fuse:['gold'],unbind:['unbind'],assist:['gold','stones']};
function mergeRecordedTarget(targets,body,actor,expected,source){
 assert(body&&typeof body==='object'&&!Array.isArray(body),'Recorded full body is required');
 const fields=RECORDED_FIELDS[body.kind];assert(fields,'Recorded kind must be canonical');
 const required=['kind','realmId','selectedCharacterId','requestId',...fields];assert.deepEqual(Object.keys(body).sort(),required.sort(),'Recorded body must contain every exact field, with no guessed or extra fields');
 assert(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId),'Exact original request ID required');
 for(const key of ['accountId','realmId','characterId'])assert(typeof actor?.[key]==='string'&&actor[key],'Exact captured actor required');
 assert.equal(body.realmId,actor.realmId,'Recorded realm/actor mismatch');assert.equal(body.selectedCharacterId,actor.characterId,'Recorded selected actor mismatch');
 if(RECORDED_COSTS[body.kind]){assert(body.expectedCosts&&typeof body.expectedCosts==='object'&&!Array.isArray(body.expectedCosts));assert.deepEqual(Object.keys(body.expectedCosts).sort(),[...RECORDED_COSTS[body.kind]].sort(),'Recorded costs must be complete');}
 const original=targets.get(body.requestId),identity=JSON.stringify([actor.accountId,actor.realmId,actor.characterId]),wire=JSON.stringify(body);
 if(original){assert.equal(JSON.stringify([original.actor.accountId,original.actor.realmId,original.actor.characterId]),identity,'Same ID has conflicting captured actor');assert.equal(JSON.stringify(original.body),wire,'Same ID has conflicting kind or full body');if(expected&&original.expected)assert.deepEqual(expected,original.expected,'Same ID has conflicting original response');if(expected&&!original.expected)original.expected=expected;original.sources.push(source);}
 else targets.set(body.requestId,{body,actor,expected:expected||null,sources:[source]});
}


function isRetiredCharacterBodyGap(record,error,source){
 if(source||record.status<200||record.status>=300||!String(record.type||'').toLowerCase().startsWith('image/'))return false;
 let url;try{url=new URL(record.url);}catch{return false;}
 if(url.origin!==origin||!url.pathname.startsWith('/ui-generated-20261030/characters-v1/assets/')||!/\.(?:png|webp)$/i.test(url.pathname))return false;
 const message=String(error?.message||'');
 return message.includes('Network.getResponseBody')&&message.includes('No data found for resource with given identifier')&&message.includes('Response body is not available for a response that was navigated away from');
}

function original(id){const file=path.join(base,'browser',id,'results.json'),bytes=fs.readFileSync(file),value=JSON.parse(bytes);assert.equal(value.runId,id);return {file,sha256:sha(bytes),value};}
const bridgeSource=bridge?original(args.get('bridge-run')):null,jobSource=args.has('job-run')?original(args.get('job-run')):null,jobBridgeSource=args.has('job-bridge-run')?original(args.get('job-bridge-run')):null;
assert(!jobBridgeSource||(jobSource&&selected.startsWith('auto-')&&!selected.endsWith('-start')&&selected!=='auto-start-null'),'Job receipt bridge is explicit and only valid for an original job continuation');
assert(!fs.existsSync(dir),'Do not overwrite prior evidence');fs.mkdirSync(dir,{recursive:true});
const evidence={schemaVersion:1,runId,case:selected,origin,api,pid:process.pid,startedAt:new Date().toISOString(),status:'starting',realChrome:true,realLocalApi:true,productionAccess:false,randomness:'Original service RNG only; no reroll or probability override',clockMethod:'Explicit development clock invokes original GuardianAuto.step/sweep at original due time; not natural waiting',checks:[],operations:[],submissions:[],requests:[],responses:[],directRequests:[],clockCommands:[],screenshots:[],pageErrors:[],httpErrors:[],routeErrors:[],assetCaptureGaps:[],externalRequests:[],loadedSources:{},servedAssets:{},faults:[]};
function save(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);}
function persist(step){if(step)evidence.step=step;save(path.join(dir,'results.json'),evidence);save(path.join(dir,'progress.json'),{runId,status:evidence.status,step:evidence.step,updatedAt:new Date().toISOString(),operations:evidence.operations.length});save(path.join(base,'browser/latest.json'),{runId,dir,status:evidence.status,step:evidence.step,updatedAt:new Date().toISOString()});}
async function deadline(promise,label,ms=30000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]);}finally{clearTimeout(timer);}}
const note=(name,detail={})=>{evidence.checks.push({name,passed:true,...detail});persist(name);console.log(JSON.stringify({check:name,passed:true}));};
let claimed=false;
function claim(){assert(!readOnly,'Read-only case cannot mutate');if(claimed)return;const root=path.join(base,'case-claims');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,selected+'.json'),JSON.stringify({case:selected,runId,startedAt:new Date().toISOString(),policy:'Do not replay this case even if browser assertions fail; inspect captured original operations'},null,2)+'\n',{flag:'wx'});claimed=true;}
const action=value=>'[data-sg-action='+q(value)+']',field=value=>'[data-sg-field='+q(value)+']';
persist('before browser start');
(async()=>{
 let browser,page,frame,fixture,actor,main,alt,paid,budget,resources,season,roles,mainNavigations=0,expectedNavigations=0,preparedSubmission=null;
 const pendingAssets=[],releases=new Set(),expectedErrors=new Set(),writes=()=>evidence.requests.filter(x=>x.action===route);
 const state=async()=>{const r=await fetch(api+'/__preview/guardian-qa/state',{signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);return r.json();};
 const raw=(s,a)=>s[a.realmId==='season_2026_01'?'season':'permanent'],char=(s,a)=>raw(s,a).characters.find(c=>String(c.tg_id)===a.characterId),amount=(s,a,item)=>raw(s,a).inventory.find(i=>String(i.tg_id)===a.characterId&&i.item===item)?.quantity||0;
 const button=(name,id)=>frame.locator(action(name)+(id===undefined?'':'[data-item-id='+q(id)+']'));
 const raf=()=>frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const context=()=>frame.evaluate(()=>window.RpgSceneSession.getContext());
 async function ready(){await frame.waitForFunction(()=>{const root=document.querySelector('.sg-window'),refresh=root?.querySelector('[data-sg-action="refresh"]');return root&&refresh&&!refresh.disabled&&refresh.textContent.trim()!=='更新中…'&&root.querySelector('.sg-card');});await raf();assert.equal(await frame.locator('.sg-window .sg-error').count(),0,'Guardian view should have no unresolved read error');}
 async function pendingReady(){await frame.waitForFunction(()=>{const p=document.querySelector('[data-sg-pending]'),check=p?.querySelector('[data-sg-action="check-pending"]'),refresh=document.querySelector('.sg-window [data-sg-action="refresh"]');return p&&check&&!check.disabled&&check.textContent.trim()!=='查詢中…'&&refresh?.textContent.trim()!=='更新中…';});await raf();}
 async function single(){assert.equal(await frame.locator('.scene-unified-dialog').count(),1);assert.equal(page.context().pages().length,1);assert.equal(mainNavigations,expectedNavigations);}
 async function shot(name){await page.screenshot({path:path.join(dir,name+'.png'),fullPage:true});evidence.screenshots.push({name,file:name+'.png'});persist();}
 async function routeIs(value){await frame.waitForFunction(route=>document.querySelector('.scene-unified-dialog')?.dataset.route===route,value);}
 async function open(tab='overview'){await frame.evaluate(tab=>window.RpgSceneNavigation.navigate('guardian',{tab}),tab);await routeIs('guardian');await ready();await setTab(tab);await single();}
 async function setTab(tab){const b=frame.locator('.sg-tabs [data-sg-tab='+q(tab)+']');if(await b.getAttribute('aria-selected')!=='true')await b.click();await frame.waitForFunction(tab=>document.querySelector('.sg-tabs [data-sg-tab="'+tab+'"]')?.getAttribute('aria-selected')==='true',tab);await ready();}
 async function choose(next){
  let ctx=await context();
  if(String(ctx.accountId)!==next.accountId||ctx.realmId!==next.realmId){await frame.evaluate(async a=>{window.RpgSceneSession.setContext({accountId:a.accountId,realmId:a.realmId,characterId:null});await window.RpgSceneSession.refresh({force:true});},next);ctx=await context();}
  if(String(ctx.characterId)!==next.characterId){
   await frame.locator('[data-scene-primary="character"]').click();await routeIs('character');await frame.locator('[data-scene-route="characters"]').click();await routeIs('characters');
   const entry=frame.locator('.scene-social-body button.scene-atlas-entry').filter({hasText:next.name});await entry.waitFor();assert.equal(await entry.count(),1);await entry.click();
  }
  await frame.waitForFunction(id=>String(window.RpgSceneSession.getSnapshot()?.characterId)===id,next.characterId);actor=next;await raf();
 }
 async function rpc(who,endpoint,body={},allowError){
  assert(endpoint!==route,'Browser acceptance consumes through UI only');
  const payload={...body,realmId:who.realmId,selectedCharacterId:who.characterId},entry={endpoint,actor:who,body:payload,state:'sending'};evidence.directRequests.push(entry);persist('read '+endpoint);
  const r=await fetch(api+'/app/api/'+endpoint,{method:'POST',headers:{'content-type':'application/json','x-dev-tg-id':who.accountId,'x-realm-id':who.realmId},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)}),json=await r.json();Object.assign(entry,{status:r.status,result:json,state:'completed'});persist();
  if(allowError)assert.equal(json.error,allowError);else{assert.equal(r.status,200,JSON.stringify(json));assert.equal(json.ok,true);}return json;
 }
 async function pure(label,who=actor,query={},receiptBodies=[]){
  const before=await state(),count=writes().length;assert.equal(Object.keys(before.databases.permanent.counts).length,96);assert.equal(Object.keys(before.databases.season.counts).length,96);let projection;
  for(let i=0;i<2;i++){projection=await rpc(who,'guardian/scene',query);for(const body of receiptBodies)await rpc(who,'guardian/receipt',body);}
  const after=await state();assert.deepEqual(after.databases,before.databases,label+' all 96 tables, total_changes and outbox remain unchanged in both realms');assert.equal(writes().length,count);evidence.pureReads??=[];evidence.pureReads.push({label,actor:who,before:before.databases,after:after.databases});persist();return projection;
 }
 async function geometry(label){
  const result=await frame.evaluate(()=>{const card=document.querySelector('.scene-social-card'),body=document.querySelector('.scene-social-body'),root=document.querySelector('.sg-window');return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,card:card.getBoundingClientRect().toJSON(),bodyWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,controls:[...root.querySelectorAll('button,select,input,summary')].map(el=>({text:el.textContent?.trim().slice(0,45),rect:el.getBoundingClientRect().toJSON()})).filter(x=>x.rect.width&&x.rect.height)};});
  assert(result.card.left>=-1&&result.card.right<=result.viewport+1,label+' fits viewport');assert(result.scrollWidth<=result.viewport+1&&result.bodyScrollWidth<=result.bodyWidth+1,label+' no horizontal overflow');for(const c of result.controls){assert(c.rect.width>=43.5,label+' target width '+JSON.stringify(c));assert(c.rect.height>=43.5,label+' target height '+JSON.stringify(c));}await single();return result;
 }
 async function confirmation(){await frame.locator('[data-sg-confirm]').waitFor();await raf();const result=await frame.evaluate(()=>{const p=document.querySelector('[data-sg-confirm]'),body=document.querySelector('.scene-social-body'),r=p.getBoundingClientRect(),v=body.getBoundingClientRect();return {text:p.textContent,rect:r.toJSON(),viewport:v.toJSON(),visible:r.top>=Math.max(0,v.top)-1&&r.bottom<=Math.min(innerHeight,v.bottom)+1,cancelFocused:document.activeElement===p.querySelector('[data-sg-action="cancel"]')};});assert(result.visible,'confirm must be visible '+JSON.stringify(result));assert(result.cancelFocused,'cancel is initial focus');return result;}
 async function inventoryEntry(name,id){
  const before=await state(),seen=new Set(),record={action:name,itemId:id,actor:{...actor},before:before.databases,pages:[],status:'searching'};
  assert.equal(Object.keys(before.databases.permanent.counts).length,96);assert.equal(Object.keys(before.databases.season.counts).length,96);
  evidence.inventoryNavigation??=[];evidence.inventoryNavigation.push(record);persist('before visible inventory navigation');
  for(let index=0;index<64;index++){
   await ready();const entry=button(name,id),count=await entry.count();assert(count<=1,'Exact inventory action is unique');
   if(count===1){record.after=(await state()).databases;assert.deepEqual(record.after,record.before,'Visible inventory navigation preserves both complete databases');record.status='found';persist('exact original item found through visible inventory');return entry;}
   const next=button('inventory-next');assert.equal(await next.count(),1,'Exact original item is absent and no next inventory page exists');assert(await next.isEnabled(),'Next inventory page is available');
   const cursor=await next.getAttribute('data-cursor');assert(typeof cursor==='string'&&cursor&&!seen.has(cursor),'Visible inventory cursor must advance without a cycle');seen.add(cursor);
   const waiting=page.waitForResponse(r=>{if(r.url()!==api+'/app/api/guardian/scene'||r.request().method()!=='POST')return false;const b=r.request().postDataJSON();return b.cursor===cursor&&b.realmId===actor.realmId&&b.selectedCharacterId===actor.characterId;});
   await next.click();const response=await waiting,result=await response.json();record.pages.push({cursor,body:response.request().postDataJSON(),status:response.status(),result});persist('original next inventory page received');assert.equal(response.status(),200);assert.equal(result.ok,true);await ready();
  }
  throw Error('Exact inventory item not found within the bounded visible cursor traversal');
 }
 async function stageEntry(entry){await entry.click();await confirmation();const n=writes().length;await button('cancel').click();await raf();assert.equal(writes().length,n);assert(await entry.evaluate(e=>e===document.activeElement),'cancel restores original action focus');await entry.click();evidence.confirmation=await confirmation();await shot('390-confirm');}
 function prepareSubmission(before,label){
  const entry={label,actor:{...actor},before,sourceSHA256:evidence.sourceSHA256Before,preparedAt:new Date().toISOString(),body:null,state:'prepared-before-send'};
  evidence.submissions.push(entry);preparedSubmission=entry;persist('full actor and DB checkpoint before send '+label);return entry;
 }
 async function capture(body,result,before,label,status=200){
  const entry={label,body,result,status,actor:{...actor},sourceSHA256:evidence.sourceSHA256Before,recordedAt:new Date().toISOString(),before,after:null,authority:null};evidence.operations.push(entry);if(preparedSubmission?.body?.requestId===body.requestId){preparedSubmission.state='original-response-saved';preparedSubmission.operationIndex=evidence.operations.length-1;}persist('original response saved '+label);
  entry.after=await state();persist('original response and complete DB snapshot saved '+label);assert.equal(status,200,JSON.stringify(result));assert.equal(result.ok,true);
  assert.equal(result.requestId,body.requestId);assert.equal(result.kind,body.kind);assert.equal(String(result.characterId),actor.characterId);assert.equal(result.realmId,actor.realmId);
  const realm=raw(entry.after,actor),value=result.result;
  assert(result.receipt&&result.receipt.requestId===body.requestId);assert.equal(result.receipt.scope.characterId,actor.characterId);assert.equal(result.receipt.scope.accountId,actor.accountId);assert.equal(result.receipt.scope.realmId,actor.realmId);
  if(value.operation){entry.authority=realm.operations.find(x=>x.operation_id===value.operation.operationId);assert(entry.authority,'Exact original operation exists');assert.deepEqual(JSON.parse(entry.authority.result_json),value.operation);assert.equal(value.operation.status,'committed');assert(!value.operation.fixtureOnly);assert.equal(value.operation.charId,actor.characterId);}
  else if(value.welcome){entry.authority=realm.welcomes.find(x=>x.account_id===actor.accountId);assert(entry.authority);assert.equal(entry.authority.recipient_char_id,value.welcome.recipientCharacterId);assert.equal(realm.welcomes.filter(x=>x.account_id===actor.accountId).length,1);}
  else if(value.sale){entry.authority=realm.ledger.find(x=>{try{return JSON.stringify(JSON.parse(x.note).result)===JSON.stringify(value.sale);}catch{return false;}});assert(entry.authority,'Exact original sale ledger exists');}
  else if(value.job){entry.authority=realm.jobs.find(x=>x.id===value.job.id);assert(entry.authority);assert.equal(entry.authority.owner,actor.accountId);assert.equal(entry.authority.char_id,value.job.characterId);}
  else assert.fail('Unknown original authority family');
  persist('original authority locked '+label);return entry;
 }
 async function submit(entry,label){
  await stageEntry(entry);claim();const before=await state(),waiting=page.waitForResponse(r=>r.url()===api+'/app/api/'+route&&r.request().method()==='POST');prepareSubmission(before,label);await button('confirm').click();
  const response=await waiting,result=await response.json(),body=response.request().postDataJSON(),op=await capture(body,result,before,label,response.status());await ready();return op;
 }
 async function verifyReceipt(op){
  const before=await state(),r=await rpc(op.actor,'guardian/receipt',op.body),after=await state();assert.deepEqual(after.databases,before.databases,'Exact typed receipt is pure');assert.equal(r.found,true);assert.deepEqual(r.result,op.result.result);assert.deepEqual(r.receipt,op.result.receipt);assert.equal(r.signature,op.result.signature);op.queriedReceipt=r;persist('original receipt verified '+op.label);return r;
 }
 async function finishOperation(op,name){await verifyReceipt(op);await geometry(name);await shot('390-original-result');note(name,{requestId:op.body.requestId,kind:op.body.kind,authority:op.result.receipt.authority});}
 async function lostSubmit(entry,label,{unsent=false,aba=false}={}){
  await stageEntry(entry);claim();const before=await state(),endpoint=api+'/app/api/'+route;let used=false,resolve,reject;const completed=new Promise((a,b)=>{resolve=a;reject=b;});completed.catch(()=>{});let op,body;
  const fault={type:unsent?'not-sent':'committed-response-lost',label,state:'armed',before,actor:{...actor}};evidence.faults.push(fault);persist();
  const handler=async request=>{if(used)return request.continue();used=true;body=request.request().postDataJSON();fault.body=body;fault.state='intercepted';persist('fault captured exact original body');try{if(!unsent){const response=await request.fetch({maxRetries:0,timeout:20000}),result=await response.json();op=await capture(body,result,before,label,response.status());fault.operationIndex=evidence.operations.length-1;fault.state='committed-original-saved';persist();}await request.abort('failed');fault.state='unknown-delivered';persist();resolve();}catch(error){fault.error=error.message;persist();reject(error);try{await request.abort('failed');}catch{}}};
  await page.route(endpoint,handler);try{prepareSubmission(before,label);await button('confirm').click();await deadline(completed,'lost response');await pendingReady();}finally{await page.unroute(endpoint,handler);}
  assert.equal(writes().filter(x=>x.body.requestId===body.requestId).length,1);fault.before=before;fault.after=await state();persist();
  if(unsent)assert.deepEqual(fault.after.databases,before.databases,'Unsent fault has no database effect');
  if(aba){const savedActor=actor;await choose(alt);await open();assert.equal(await frame.locator('[data-sg-pending]').count(),0,'other actor does not inherit unknown');await choose(savedActor);await open();await pendingReady();}
  return {op,body,fault};
 }
 async function checkPending(body,found){
  const before=await state(),count=writes().length,selector='[data-sg-pending='+q(body.requestId)+']',panel=frame.locator(selector),waiter=page.waitForResponse(r=>r.url()===api+'/app/api/guardian/receipt'&&r.request().method()==='POST');
  await panel.locator(action('check-pending')).click();const result=await(await waiter).json();await pendingReady();assert.equal(result.found,found);assert.equal(writes().length,count);assert.deepEqual((await state()).databases,before.databases);persist('pending lookup is pure');return result;
 }
 async function unknownFocus(){await frame.waitForFunction(()=>{const p=document.querySelector('[data-sg-pending]');return p&&document.activeElement===p.querySelector('[data-sg-action="check-pending"]');});await shot('390-unknown-focused');}
 async function acknowledge(body){const count=writes().length,p=frame.locator('[data-sg-pending='+q(body.requestId)+']');await p.locator(action('acknowledge')).click();await p.waitFor({state:'detached'});assert.equal(writes().length,count);}
 async function command(op,jobId){
  claim();const before=await state(),input={op,jobId,requestId:'qa-'+crypto.randomUUID()},record={input,before,state:'sending'};evidence.clockCommands.push(record);persist('before exact original runner command');
  const r=await fetch(api+'/__preview/guardian-qa/advance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)}),text=await r.text();record.httpStatus=r.status;record.rawResponse=text;persist('original runner response saved');
  const result=JSON.parse(text);record.result=result;record.after=await state();record.state='completed';persist('original runner DB result saved');assert.equal(r.status,200,text);assert.equal(result.originalIntervalMs,3000);assert.equal(result.deadlinesUnmodified,true);return record;
 }
 function originalJob(){
  assert(jobSource,'Pass exact --job-run from the accepted original auto-start case');
  assert.equal(jobSource.value.health.api.pid,evidence.health.api.pid,'Same original in-memory API required');
  const matches=jobSource.value.operations.filter(x=>x.body.kind==='auto-start');assert.equal(matches.length,1);const start=matches[0];
  if(jobSource.value.ok!==true){
   assert.equal(jobSource.value.status,'failed');assert.equal(jobSource.value.ok,false);
   assert(jobBridgeSource,'A failed original start requires explicit --job-bridge-run, never a restart');
   const verified=jobBridgeSource.value;assert.equal(verified.ok,true);assert.equal(verified.status,'passed');assert.equal(verified.case,'receipt-only');
   assert.equal(verified.bridgeSource?.runId,jobSource.value.runId);assert.equal(verified.bridgeSource?.sha256,jobSource.sha256,'Bridge must bind the unchanged failed original artifact');
   assert.equal(path.resolve(verified.bridgeSource.file),path.resolve(jobSource.file));assert.equal(verified.bridgeSource.originalStatus,'failed');
   assert.equal(verified.health.api.pid,evidence.health.api.pid);assert.deepEqual(verified.fixture,jobSource.value.fixture);assert.deepEqual(verified.fixture,evidence.fixture,'Same immutable fixture lineage');
   const clockKeys=['mode','now','debugOnly','deadlinesUnmodified','guardianIntervalMs','automaticGuardianSweep','method'];
   for(const key of clockKeys){const expected=start.after?.qaClock?.[key];assert.notEqual(expected,undefined,'Original clock field required: '+key);assert.deepEqual(verified.health.api.qaClock[key],expected);assert.deepEqual(verified.finalState.qaClock[key],expected);assert.deepEqual(evidence.health.api.qaClock[key],expected,'No clock reset or unreviewed advance');}
   for(const key of ['operations','submissions','clockCommands']){assert(Array.isArray(verified[key]));assert.equal(verified[key].length,0,'Receipt bridge cannot consume or run a job');}
   assert(Array.isArray(verified.requests));assert.equal(verified.requests.filter(x=>x.action===route).length,0);assert.equal(verified.requestCounts?.[route]||0,0);
   assert(Array.isArray(verified.directRequests));assert(verified.directRequests.every(x=>['guardian/scene','guardian/receipt'].includes(x.endpoint)),'Only pure Guardian reads in bridge');
   assert.equal(verified.sourcesStable,true);assert.deepEqual(verified.sourceSHA256Before,verified.sourceSHA256After);
   function completeDatabases(value){for(const realm of ['permanent','season']){const db=value?.[realm];assert(db);assert.equal(Object.keys(db.counts||{}).length,96);assert.equal(Object.keys(db.tableHashes||{}).length,96);assert(Number.isInteger(db.totalChanges)&&db.totalChanges>=0);assert(/^[a-f0-9]{64}$/.test(db.sha256));assert(/^[a-f0-9]{64}$/.test(db.outboxHash));}}
   for(const value of [start.after?.databases,verified.initialDatabases,verified.finalState?.databases,evidence.initialDatabases])completeDatabases(value);
   assert.deepEqual(verified.initialDatabases,start.after.databases,'Bridge begins from the captured committed original');
   assert.deepEqual(verified.finalState.databases,verified.initialDatabases,'All96 tables, total_changes and outbox unchanged through bridge');
   assert.deepEqual(evidence.initialDatabases,verified.finalState.databases,'No unreviewed database mutation since receipt verification');
   assert(Array.isArray(verified.pureReads)&&verified.pureReads.length===1);const pureRead=verified.pureReads[0];assert.deepEqual(pureRead.actor,start.actor);completeDatabases(pureRead.before);completeDatabases(pureRead.after);assert.deepEqual(pureRead.after,pureRead.before);
   assert(Array.isArray(verified.bridgeResults)&&verified.bridgeResults.length===1);const original=verified.bridgeResults[0];
   mergeRecordedTarget(new Map(),start.body,start.actor,start.result,'captured-original-auto-start');
   assert.equal(start.status,200);assert.equal(start.result.ok,true);assert.equal(start.body.kind,'auto-start');
   assert.deepEqual(original.body,start.body);assert.deepEqual(original.actor,start.actor);assert.equal(original.result.ok,true);assert.equal(original.result.found,true);
   for(const key of ['kind','requestId','signature','realmId','accountId','characterId'])assert.deepEqual(original.result[key],start.result[key],'Exact original identity: '+key);
   assert.deepEqual(original.result.result,start.result.result);assert.deepEqual(original.result.receipt,start.result.receipt);
   assert.equal(original.result.result.job.id,start.result.result.job.id);assert.equal(original.result.receipt.authority.id,start.result.result.job.id);
   evidence.jobBridgeSource={file:jobBridgeSource.file,sha256:jobBridgeSource.sha256,runId:verified.runId,originalStatus:jobSource.value.status,guardianWrites:0,runnerCommands:0,allDatabasesUnchanged:true};
  }else{assert.equal(jobSource.value.status,'passed');assert(!jobBridgeSource,'Do not attach a recovery exception to an already accepted original');}
  for(const[p,h]of Object.entries(jobSource.value.sourceSHA256Before))if(p.startsWith('worker/src/')||FRONT.some(x=>p==='worker/public/'+x))assert.equal(evidence.sourceSHA256Before[p],h,'Original job product source remains frozen '+p);
  evidence.jobSource={file:jobSource.file,sha256:jobSource.sha256,requestId:start.body.requestId,jobId:start.result.result.job.id,originalStatus:jobSource.value.status};return start;
 }

 async function layouts(){
  await choose(main);await frame.locator('[data-scene-primary="character"]').click();await routeIs('character');await frame.locator('[data-scene-route="guardian"]').click();await routeIs('guardian');await ready();
  const before=await state(),views=[];
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:width<500?844:960});for(const tab of ['overview','summon','inventory','fusion','auto','history']){await setTab(tab);views.push({width,tab,geometry:await geometry(width+' '+tab)});await shot(width+'-'+tab);}}
  await frame.locator('[data-scene-primary="camp"]').click();await routeIs('camp');await frame.locator('[data-scene-route="guardian-summon"]').click();await routeIs('guardian-summon');await ready();assert.equal(await frame.locator('[data-sg-tab="summon"]').getAttribute('aria-selected'),'true');await shot('1280-camp-summon-entry');
  await open('inventory');await frame.locator(field('quality')).selectOption('white');await ready();const first=await rpc(main,'guardian/scene',{quality:'white'});assert(first.guardian.state.inventory.items.length===40&&first.guardian.state.inventory.nextCursor);const next=await rpc(main,'guardian/scene',{quality:'white',cursor:first.guardian.state.inventory.nextCursor});assert(next.guardian.state.inventory.items.length>0);assert.deepEqual(next.guardian.state.inventory.eligibleCounts,first.guardian.state.inventory.eligibleCounts);await button('inventory-next').click();await ready();await shot('1280-quality-cursor-second-page');
  await pure('Six tabs and quality cursor remain SELECT-only',main);assert.deepEqual((await state()).databases,before.databases,'All layout interactions preserve both complete databases');
  await frame.locator('.scene-window-close').focus();await page.keyboard.press('Tab');assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)));await page.keyboard.press('Shift+Tab');assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)));
  note('Real Character and Camp entrances, six tabs, original feather art, 320/390/1280 widths, 44px controls and whole-inventory cursor counts',{views});
 }
 async function pureCases(){
  const lv15=fixture.fixtures.find(x=>x.role==='first-lv15'),low=fixture.fixtures.find(x=>x.role==='below-level');assert(lv15&&low);
  await choose(lv15);await open();let p=await pure('First exact-Lv15 scene never grants entitlement',lv15);await pure('Absent welcome receipt uses the actual live config and never grants entitlement',lv15,{},[{kind:'welcome',configVersion:p.guardian.config.configVersion,requestId:'qa_absent_welcome_01'}]);assert.equal(p.guardian.state.level,15);assert.equal(p.guardian.state.welcome.claimed,false);assert.equal(p.guardian.state.balances.freeNormalDraws,0);
  await choose(low);await open();p=await pure('Lv14 scene does not unlock or grant entitlement',low);assert.equal(p.guardian.state.unlocked,false);assert.equal(await button('welcome').isDisabled(),true);
  await choose(season);await open();p=await pure('Frozen first-visit scene preserves all authority',season);await pure('Frozen absent receipt preserves all authority',season,{},[{kind:'welcome',configVersion:p.guardian.config.configVersion,requestId:'qa_absent_frozen_01'}]);assert.equal(p.guardian.control.realmPhase,'FREEZE');assert.equal(p.guardian.state.welcome.claimed,false);assert.equal(await button('welcome').isDisabled(),true);await shot('390-frozen-first-visit');
  await choose(main);await open('inventory');p=await pure('Protected original inventory and initial input provenance',main);const items=p.guardian.state.inventory.items;
  for(const name of ['a_active','b_locked','d_kept_support','i_escrow'])assert(items.find(i=>i.id===roles[name])?.sellBlock,'Original protection '+name);
  await button('sale-mode').click();for(const name of ['a_active','b_locked','d_kept_support','i_escrow'])assert.equal(await button('sale-select',roles[name]).isDisabled(),true);await shot('390-original-sale-protections');
  note('First Lv15/Lv14/frozen scenes and receipts preserve both 96-table databases, total_changes and outbox; original sale protections remain');
 }
 async function pureTail(){
  assert(bridgeSource,'Exact failed pure run required');const old=bridgeSource.value;
  assert.equal(old.case,'pure');assert.equal(old.status,'failed');assert.equal(old.ok,false);assert.equal(old.operations.length,0);assert.equal(old.clockCommands.length,0);assert.equal(old.requests.filter(x=>x.action===route).length,0);assert.equal(old.sourcesStable,true);assert(old.error?.stack?.includes('at choose '));assert.equal(old.health.api.pid,evidence.health.api.pid);
  const labels=['First exact-Lv15 scene never grants entitlement','Absent welcome receipt uses the actual live config and never grants entitlement','Lv14 scene does not unlock or grant entitlement','Frozen first-visit scene preserves all authority','Frozen absent receipt preserves all authority'];
  assert.deepEqual(old.pureReads.map(x=>x.label),labels);
  for(const group of old.pureReads){assert.deepEqual(group.after,group.before);for(const realm of ['permanent','season'])assert.equal(Object.keys(group.before[realm].tableHashes).length,96);}
  for(const[file,hash]of Object.entries(old.sourceSHA256Before))if(file!=='worker/tools/guardian-browser.cjs')assert.equal(evidence.sourceSHA256Before[file],hash,'Only the diagnosed harness changed');
  evidence.continuedPureSource={file:bridgeSource.file,sha256:bridgeSource.sha256,status:old.status,completedReadGroups:labels,originalFailure:old.error,guardianConsumption:0};persist('verified exact failed pure predecessor without reclassifying it');
  await choose(season);await open();await choose(main);await open('inventory');
  const projection=await pure('Remaining original protection tail after real cross-realm active discovery',main),items=projection.guardian.state.inventory.items;
  for(const name of ['a_active','b_locked','d_kept_support','i_escrow'])assert(items.find(x=>x.id===roles[name])?.sellBlock,'Original protection '+name);
  await button('sale-mode').click();for(const name of ['a_active','b_locked','d_kept_support','i_escrow'])assert.equal(await button('sale-select',roles[name]).isDisabled(),true);
  await shot('390-original-sale-protections');assert.equal(writes().length,0);note('Exact failed pure-run tail verifies actual active discovery across realms and protected sale controls; five original pure groups remain separately preserved');
 }
 async function regularOperation(){
  const paidCase=selected==='paid-normal-10';await choose(paidCase?paid:main);await open();
  let op;
  if(selected==='welcome'){
   assert(!(await state()).permanent.welcomes.some(x=>x.account_id===main.accountId),'Welcome case cannot replay');op=await submit(button('welcome'),'explicit account welcome');assert.equal(amount(op.after,main,'guardian_free_normal')-amount(op.before,main,'guardian_free_normal'),200);assert.equal(amount(op.after,alt,'guardian_free_normal'),0);await finishOperation(op,'Explicit original account-wide welcome grants 200 once to the captured character');
  }else if(selected.startsWith('summon-')||paidCase){
   const [pool,count]=paidCase?['normal',10]:[selected.split('-')[1],Number(selected.split('-')[2])];await setTab('summon');op=await submit(frame.locator(action('summon')+'[data-pool='+q(pool)+'][data-count='+q(count)+']'),selected);
   const expected=op.body.expectedCosts,result=op.result.result.operation;assert.equal(op.body.pool,pool);assert.equal(op.body.count,count);assert.equal(char(op.before,actor).gold-char(op.after,actor).gold,expected.gold);assert.equal(amount(op.before,actor,'guardian_voucher')-amount(op.after,actor,'guardian_voucher'),expected.vouchers);assert.equal(amount(op.before,actor,'guardian_free_normal')-amount(op.after,actor,'guardian_free_normal'),expected.freeNormalDraws);
   assert.equal(result.results.length,count);assert.equal(new Set(result.results.map(x=>x.id)).size,count);for(const item of result.results)assert(raw(op.after,actor).sigils.some(x=>x.id===item.id&&x.char_id===actor.characterId));
   if(pool==='featured'){const before=amount(op.before,actor,'guardian_voucher')*5+char(op.before,actor).guardian_draw_remainder,after=amount(op.after,actor,'guardian_voucher')*5+char(op.after,actor).guardian_draw_remainder;assert.equal(before-after,count);assert(char(op.after,actor).guardian_draw_remainder>=0&&char(op.after,actor).guardian_draw_remainder<=4);assert(result.results.every(x=>x.rank>=2));}
   else if(!paidCase){assert.equal(expected.gold,0);assert.equal(expected.freeNormalDraws,count);}else assert(expected.gold>0&&expected.freeNormalDraws===0);
   await finishOperation(op,'Original '+pool+' '+count+' draw preserves live quote, free/paid/credit conservation and exact random IDs');
  }else if(selected.startsWith('fuse-')){
   const quality=selected.slice(5),prefix={white:'j_fuse_white_',red:'k_fuse_red_',gold:'l_fuse_gold_'}[quality],ids=Object.keys(roles).filter(k=>k.startsWith(prefix)).sort().map(k=>roles[k]);await setTab('fusion');await frame.locator(field('quality')).selectOption(quality);await ready();await button('fusion-primary',ids[0]).click();for(const id of ids.slice(1))await button('fusion-material',id).click();op=await submit(button('fuse'),selected);
   assert.deepEqual([...op.body.itemIds].sort(),[...ids].sort());assert.equal(op.body.primaryId,ids[0]);const result=op.result.result.operation,beforeItems=raw(op.before,main).sigils,afterItems=raw(op.after,main).sigils,primary=beforeItems.find(x=>x.id===ids[0]);assert.equal(result.primaryId,ids[0]);assert.equal(char(op.before,main).gold-char(op.after,main).gold,op.body.expectedCosts.gold);assert.equal(result.results.length,1);assert.equal(result.results[0].type,primary.type);assert.equal(result.results[0].bound,true);
   if(result.success){assert.deepEqual([...result.consumedIds].sort(),[...ids].sort());assert(ids.every(id=>!afterItems.some(x=>x.id===id)));assert.equal(result.results[0].rank,primary.quality+1);assert(afterItems.some(x=>x.id===result.results[0].id));}else{assert.equal(result.refundedId,ids[0]);assert.equal(result.results[0].id,ids[0]);assert(afterItems.some(x=>x.id===ids[0]));assert.deepEqual([...result.consumedIds].sort(),ids.slice(1).sort());assert(ids.slice(1).every(id=>!afterItems.some(x=>x.id===id)));}
   if(quality==='white')assert.equal(result.success,true);await finishOperation(op,'Original '+ids.length+'-material '+quality+' fusion retains explicit primary, exact consumed/refunded IDs, binding and one natural outcome');
  }else if(['activate','activate-null','lock','unlock','unbind'].includes(selected)){
   const item=selected==='activate'?roles.g_sale_a:roles.c_unbind;await setTab(selected==='activate-null'?'overview':'inventory');const entry=selected==='activate-null'?button('activate','none'):await inventoryEntry(selected==='unlock'?'lock':selected,item);op=await submit(entry,selected);
   const after=raw(op.after,main).sigils;
   if(selected==='activate'){assert(after.find(x=>x.id===item)?.active===1);assert(after.find(x=>x.id===item)?.bound===1);}
   if(selected==='activate-null'){assert.equal(op.body.itemId,null);assert.equal(op.actor.characterId,main.characterId);assert.equal(op.body.selectedCharacterId,op.actor.characterId);assert(!after.some(x=>x.char_id===op.actor.characterId&&x.active===1));assert.deepEqual(after.filter(x=>x.char_id!==op.actor.characterId),raw(op.before,main).sigils.filter(x=>x.char_id!==op.actor.characterId),'Other characters retain their exact original sigils');}
   if(selected==='lock'||selected==='unlock'){assert.equal(op.body.locked,selected==='lock');assert.equal(after.find(x=>x.id===item).locked,selected==='lock'?1:0);}
   if(selected==='unbind'){assert.equal(after.find(x=>x.id===item).bound,0);assert.equal(amount(op.before,main,'unbind')-amount(op.after,main,'unbind'),op.body.expectedCosts.unbind);}
   await finishOperation(op,'Original '+selected+' preserves explicit ID/null/boolean and exact original costs');
  }else if(selected.startsWith('assist-')){
   let entry;
   if(['assist-start','assist-switch','assist-select'].includes(selected)){await setTab('inventory');entry=await inventoryEntry(selected==='assist-select'?'assist-select':'assist-start',roles[selected==='assist-switch'?'f_support_b':'e_support_a']);}
   else{await setTab('overview');if(selected==='assist-resume')entry=button('assist-start',roles.e_support_a);else if(selected.startsWith('assist-pause'))entry=button('assist-stop');else if(selected.includes('continuation'))entry=button('continuation');else if(selected.includes('supply'))entry=button('supply');else{await frame.locator(field('stoneQuantity')).selectOption('2');entry=button('buy-stones');}}
   op=await submit(entry,selected);const result=op.result.result.operation,cost=op.body.expectedCosts,beforeSpecial=JSON.parse(char(op.before,main).special_json),afterSpecial=JSON.parse(char(op.after,main).special_json);assert.equal(char(op.before,main).gold-char(op.after,main).gold,cost.gold);
   if(op.body.mode==='buy')assert.equal(amount(op.after,main,'guardian_summon_stone')-amount(op.before,main,'guardian_summon_stone'),op.body.quantity);
   else assert.equal(amount(op.before,main,'guardian_summon_stone')-amount(op.after,main,'guardian_summon_stone'),cost.stones);
   if(selected==='assist-start'||selected==='assist-switch'){assert.equal(cost.stones,1);assert.equal(result.guardianAssist.remainingBattles,1440);}
   if(selected==='assist-resume'){assert.equal(result.resumed,true);assert.equal(cost.stones,0);assert.equal(result.guardianAssist.remainingBattles,beforeSpecial.guardianAssist.remainingBattles);}
   if(selected.startsWith('assist-pause')){assert.equal(afterSpecial.guardianSummonEnabled,false);assert.equal(afterSpecial.guardianAssist.remainingBattles,beforeSpecial.guardianAssist.remainingBattles);}
   if(selected.includes('continuation'))assert.equal(afterSpecial.guardianAssist.autoRenew,selected.endsWith('-on'));
   if(selected.includes('supply'))assert.equal(afterSpecial.guardianStoneSupply,selected.endsWith('-on'));
   if(selected==='assist-select'){assert.equal(cost.stones,0);assert.equal(result.guardianAssist.pendingFirstStone,true);}
   await finishOperation(op,'Original '+selected+' preserves stone/gold costs, retained battles and explicit supply/continuation flags');
  }else if(selected==='sale-lost'){
   await setTab('inventory');await button('sale-mode').click();for(const id of [roles.g_sale_a,roles.h_sale_b])await(await inventoryEntry('sale-select',id)).click();const lost=await lostSubmit(button('sale'),'original sale with lost response',{aba:true});op=lost.op;const result=op.result.result.sale;assert.equal(result.count,2);assert.deepEqual(result.items.map(i=>i.id).sort(),[roles.g_sale_a,roles.h_sale_b].sort());assert.equal(char(op.after,main).gold-char(op.before,main).gold,result.gold);assert(result.items.every(i=>!raw(op.after,main).sigils.some(row=>row.id===i.id)));
   const found=await checkPending(lost.body,true);assert.deepEqual(found.result,op.result.result);await shot('390-sale-recovered-original');await acknowledge(lost.body);await finishOperation(op,'Committed sale survives response loss and A/B/A; original ledger and consumed IDs remain readable without a second sale');
  }else if(selected==='not-found-recovery'){
   await setTab('summon');const lost=await lostSubmit(frame.locator(action('summon')+'[data-pool="normal"][data-count="1"]'),'explicit not-found recovery',{unsent:true});await unknownFocus();const r=await checkPending(lost.body,false);assert.equal(r.recoveryAllowed,true);assert(await frame.locator('[data-sg-pending='+q(lost.body.requestId)+']').count());await shot('390-not-found-preserved');
   const pending=frame.locator('[data-sg-pending='+q(lost.body.requestId)+']');await pending.locator(action('retry')).click();await confirmation();const before=await state(),waiter=page.waitForResponse(r=>r.url()===api+'/app/api/'+route&&r.request().method()==='POST');prepareSubmission(before,'explicit same-ID recovery');await button('confirm').click();const response=await waiter,result=await response.json();assert.deepEqual(response.request().postDataJSON(),lost.body);op=await capture(lost.body,result,before,'explicit identical-ID complete-body recovery',response.status());await ready();await finishOperation(op,'not_found preserves pending; only explicit confirmed same-ID/full-body recovery commits once');
  }else throw Error('No regular operation implementation for '+selected);
 }
 async function autoCases(){
  const starters={
   'auto-start-null':{who:main,pool:'normal',target:'6',mode:'unlimited',max:null},
   'auto-zero-start':{who:budget,pool:'normal',target:'6',mode:'limited',max:0},
   'auto-resources-start':{who:resources,pool:'normal',target:'6',mode:'unlimited',max:null},
   'auto-target-start':{who:paid,pool:'featured',target:'1',mode:'limited',max:0}
  };
  const start=starters[selected];
  if(start){await choose(start.who);await open('auto');for(const[key,value]of [['autoPool',start.pool],['autoCount','1'],['autoTargetType','any'],['autoTargetRank',start.target],['autoBudgetMode',start.mode]])await frame.locator(field(key)).selectOption(value);if(start.max!==null)await frame.locator(field('autoBudget')).fill(String(start.max));const op=await submit(button('auto-start'),selected);assert.equal(op.body.maxGold,start.max);assert.equal(op.result.result.job.characterId,start.who.characterId);assert.equal(op.result.result.job.batches,0);assert.equal(op.result.result.job.nextAt,op.after.qaClock.now);await finishOperation(op,'Original '+selected+' stores source actor, target and explicit null/zero budget without drawing during start');return;}
  const source=originalJob(),jobId=source.result.result.job.id;await choose(selected.endsWith('-alt')?alt:source.actor);await open('auto');
  if(selected==='auto-stop-alt'||selected==='auto-seen-alt'||selected.endsWith('-seen')){
   if(selected.endsWith('-alt'))assert((await frame.locator('[data-sg-auto-source]').innerText()).includes('其他自有角色'));
   const mode=selected==='auto-stop-alt'?'auto-stop':'auto-seen',op=await submit(button(mode),selected);assert.equal(op.body.jobId,jobId);assert.equal(op.result.result.job.characterId,source.actor.characterId);assert.equal(op.result.receipt.scope.characterId,actor.characterId);if(mode==='auto-stop')assert.equal(op.result.result.job.reason,'stopped');else assert.equal(op.result.result.job.seen,true);await finishOperation(op,'Original '+mode+' controls exact account-owned source job and preserves captured current actor receipt');return;
  }
  const initial=await state(),job=initial.permanent.jobs.find(x=>x.id===jobId);assert(job);assert.equal(job.status,'running');await pure('Due original auto job is never advanced or marked seen by scene',actor);
  await frame.locator('.scene-window-close').click();assert.equal(await frame.locator('.scene-unified-dialog').count(),0);
  let final;
  if(selected==='auto-step-next'){
   assert.equal(job.batches,1,'Do not replay any successful original batch');assert.equal(job.next_at-initial.qaClock.now,3000);
   await command('before-due',jobId);const noStep=await command('step',jobId);assert.equal(noStep.result.result,false);assert.deepEqual(noStep.result.before,noStep.result.after);await pure('Job one millisecond before deadline remains pure',actor);await command('due',jobId);final=await command('step',jobId);assert.equal(final.result.afterJob.batches,2);
  }else{
   assert.equal(job.batches,0,'Do not replay an already completed first batch');assert(job.next_at<=initial.qaClock.now);final=await command('step',jobId);
  }
  const result=final.result,before=result.beforeJob,after=result.afterJob;
  if(selected==='auto-zero-step'){assert.equal(after.reason,'budget');assert.equal(after.batches,0);assert.equal(after.spent_gold,0);}
  else if(selected==='auto-resources-step'){assert.equal(after.reason,'resources');assert.equal(after.batches,0);}
  else{assert.equal(after.batches,before.batches+1);assert.equal(after.total_draws,before.total_draws+1);assert.equal(amount(final.before,source.actor,'guardian_free_normal')-amount(final.after,source.actor,'guardian_free_normal'),after.used_free-before.used_free);assert.equal(char(final.before,source.actor).gold-char(final.after,source.actor).gold,after.spent_gold-before.spent_gold);assert.equal(amount(final.before,source.actor,'guardian_voucher')-amount(final.after,source.actor,'guardian_voucher'),after.spent_vouchers-before.spent_vouchers);if(after.status==='running')assert.equal(after.next_at-final.after.qaClock.now,3000);}
  if(selected==='auto-target-step'){assert.equal(after.reason,'target');assert(after.match_id);assert(final.after.permanent.sigils.some(x=>x.id===after.match_id&&x.char_id===source.actor.characterId));}
  evidence.originalRunner={jobId,result};persist('exact original auto result preserved');await open('auto');await shot('390-'+selected);await pure('Original auto status/history remains pure after runner',actor);note('Original '+selected+' runs with the window closed; exact source costs/IDs, natural target/resources/budget reason and original 3000ms cadence preserved',{jobId,status:after.status,reason:after.reason,batches:after.batches});
 }

 async function lateRead(mode){
  await choose(main);await open('summon');const endpoint=api+'/app/api/guardian/scene';let used=false,resolveHeld,resolveRelease;const held=new Promise(resolve=>{resolveHeld=resolve;}),release=new Promise(resolve=>{resolveRelease=resolve;});releases.add(resolveRelease);
  const fault={type:'late-'+mode+'-after-ABA',endpoint,state:'armed',renderOnly:true,doesNotRepresentGameplayResult:true};evidence.faults.push(fault);
  const expectedSequence=await frame.evaluate(characterId=>{window.__GuardianQATransport.armed={action:'guardian/scene',characterId};return window.__GuardianQATransport.sequence+1;},main.characterId);
  const handler=async request=>{
   const body=request.request().postDataJSON();if(used||body.selectedCharacterId!==main.characterId)return request.continue();used=true;const original=await request.fetch({maxRetries:0,timeout:20000}),json=await original.json();fault.originalRead=json;fault.body=body;fault.state='held';persist('original scene response held');resolveHeld();await release;
   if(mode==='409'){expectedErrors.add(request.request());await request.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'character_changed',message:'QA_LATE_409_SENTINEL'})});}
   else{const mutated=JSON.parse(JSON.stringify(json));mutated.guardian.state.balances.gold=777777777;fault.injectedField='guardian.state.balances.gold=777777777';await request.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mutated)});}
   fault.state='delivered-after-ABA';persist();
  };
  await page.route(endpoint,handler);
  try{
   await button('refresh').click();await deadline(held,'held read');await choose(alt);await open('summon');await choose(main);await open('summon');const before=await state();resolveRelease();await frame.waitForFunction(serial=>window.__GuardianQATransport.completed===serial,expectedSequence);await raf();assert(!(await frame.locator('.sg-window').innerText()).includes('777,777,777'));assert(!(await frame.locator('.sg-window').innerText()).includes('QA_LATE_409_SENTINEL'));assert.equal((await context()).characterId,main.characterId);assert.deepEqual((await state()).databases,before.databases,'late render-only reply has no DB effect');await shot('390-late-'+mode+'-aba');note('Late '+mode+' scene response cannot repaint or error a newer A/B/A scope',{fault});
  }finally{resolveRelease();releases.delete(resolveRelease);await page.unroute(endpoint,handler);}
 }
 async function receiptBridge(){
  assert(bridgeSource);assert.equal(bridgeSource.value.health.api.pid,evidence.health.api.pid,'Same original in-memory API required');
  for(const[p,h]of Object.entries(bridgeSource.value.sourceSHA256Before))if(p.startsWith('worker/src/')||FRONT.some(x=>p==='worker/public/'+x))assert.equal(evidence.sourceSHA256Before[p],h,'Original product must remain frozen');
  evidence.bridgeSource={file:bridgeSource.file,sha256:bridgeSource.sha256,runId:bridgeSource.value.runId,originalStatus:bridgeSource.value.status};
  const targets=new Map();
  for(const op of bridgeSource.value.operations||[])mergeRecordedTarget(targets,op.body,op.actor,op.result,'captured-original-operation');
  const originalActors=[...(bridgeSource.value.fixture?.fixtures||[]),...(bridgeSource.value.fixture?.seasonFixtures||[])];
  const exactActor=(body,accountId)=>{assert(typeof accountId==='string'&&accountId,'Original request account must be recorded, never inferred');const found=originalActors.filter(x=>x.characterId===body.selectedCharacterId&&x.realmId===body.realmId&&x.accountId===accountId);assert.equal(found.length,1,'Exact original realm/account/actor proof required');return found[0];};
  for(const submission of bridgeSource.value.submissions||[])if(submission.body){assert(submission.before&&submission.actor,'Original pre-send DB/actor checkpoint required');mergeRecordedTarget(targets,submission.body,submission.actor,null,'pre-send-checkpoint');}
  for(const fault of bridgeSource.value.faults||[])if(fault.body?.kind){assert(fault.actor,'Fault actor must be captured, never guessed');mergeRecordedTarget(targets,fault.body,fault.actor,null,'captured-transport-fault');}
  for(const request of bridgeSource.value.requests||[])if(request.action===route){const who=exactActor(request.body,request.accountId);if(request.actor)for(const key of ['accountId','realmId','characterId'])assert.equal(request.actor[key],who[key],'Request actor conflicts with original fixture');mergeRecordedTarget(targets,request.body,who,null,'exact-original-browser-request');}
  assert(targets.size,'Original exact request body required');evidence.bridgeResults=[];
  for(const target of targets.values()){
   await choose(target.actor);await open('history');await pure('Exact original receipt bridge '+target.body.requestId,target.actor,{},[target.body]);const result=evidence.directRequests.at(-1).result;
   if(target.expected){assert.equal(result.found,true);assert.deepEqual(result.result,target.expected.result);assert.deepEqual(result.receipt,target.expected.receipt);}evidence.bridgeResults.push({body:target.body,actor:target.actor,result});persist('exact original receipt bridge preserved');
  }
  assert.equal(writes().length,0);assert.equal(evidence.clockCommands.length,0);await shot('390-read-only-original-receipts');note('Exact prior typed receipts verified without any Guardian write or runner command; original run status remains unchanged');
 }
 async function gallery(){await choose(main);await open('history');
  const historyButton=button('history-receipt').first();if(await historyButton.count()){
   const projection=await rpc(main,'guardian/scene'),before=await state(),count=writes().length,key=await historyButton.getAttribute('data-request-key'),summary=projection.guardian.history.receipts.find(x=>x.requestKey===key),waiter=page.waitForResponse(r=>r.url()===api+'/app/api/guardian/receipt'&&r.request().method()==='POST');await historyButton.click();const response=await waiter,result=await response.json();assert(summary);const canonical=JSON.parse(summary.signature),expected={...canonical,requestId:key.slice('scene:app:'.length),realmId:main.realmId,selectedCharacterId:main.characterId};assert.deepEqual(response.request().postDataJSON(),expected);assert.equal(result.signature,summary.signature);await frame.locator('.sg-result').filter({hasText:'歷史原操作 · '+canonical.kind}).waitFor();await ready();const after=await state();assert.equal(result.found,true);assert.equal(result.receipt.requestKey,key);assert.equal(writes().length,count);assert.deepEqual(after.databases,before.databases,'History drilldown is pure including auto seen');
   evidence.historyDrilldown={requestKey:key,body:response.request().postDataJSON(),result,before:before.databases,after:after.databases};persist('actual history receipt drilldown');await shot('390-history-original-receipt');
  }
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:width<500?844:960});for(const tab of ['overview','summon','inventory','fusion','auto','history']){await setTab(tab);await geometry('gallery '+width+' '+tab);await shot('gallery-'+width+'-'+tab);}}await pure('Final gallery, original history and status remain pure',main);note('Final three-width gallery retains original results, costs, provenance and one common window without any Guardian write');}
 try{
  evidence.sourceSHA256Before=hashes();
  const [ui,service]=await Promise.all([fetch(origin+'/__preview/health',{signal:AbortSignal.timeout(10000)}).then(r=>r.json()),fetch(api+'/__preview/health',{signal:AbortSignal.timeout(10000)}).then(r=>r.json())]);
  evidence.health={ui,api:service};assert(ui.apiReady&&ui.isolated&&service.isolated&&service.ephemeral&&service.guardianQa&&service.productionAccess===false);assert.equal(ui.apiPid,service.pid);assert.equal(service.qaClock.guardianIntervalMs,3000);assert.equal(service.qaClock.automaticGuardianSweep,false);assert.equal(ui.generatedInputSnapshot.mode,'pinned-qa-text');assert.equal(ui.generatedInputSnapshot.sourceCount,9);
  const inputManifestPath=path.resolve(ui.generatedInputSnapshot.manifestPath),relative=path.relative(base,inputManifestPath);assert(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'Snapshot belongs to this evidence tree');
  const inputManifest=JSON.parse(fs.readFileSync(inputManifestPath,'utf8'));assert.equal(inputManifest.status,'passed');assert.equal(inputManifest.id,ui.generatedInputSnapshot.id);assert.equal(inputManifest.binderSha256,evidence.sourceSHA256Before['worker/tools/scene-preview-bindings.mjs']);evidence.inputSnapshot={manifestPath:inputManifestPath,manifestSha256:sha(fs.readFileSync(inputManifestPath)),id:inputManifest.id,scope:inputManifest.scope,sourceCount:inputManifest.sourceCount};evidence.boundHttpInputs=[];
  for(const [index,input]of inputManifest.sources.entries()){
   const r=await fetch(origin+input.requestPath,{signal:AbortSignal.timeout(10000)}),bytes=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200);assert.equal(r.headers.get('x-scene-input-snapshot'),inputManifest.id);assert.equal(r.headers.get('x-scene-generated-mode'),'pinned-qa-text');
   const saved=fs.readFileSync(path.join(path.dirname(inputManifestPath),'bound',input.requestPath.slice(1)));assert.equal(sha(saved),input.boundSha256);if(!input.type.startsWith('text/html'))assert.equal(sha(bytes),input.boundSha256);
   const file='bound-http-'+String(index).padStart(2,'0')+(input.type.startsWith('text/html')?'.html':'.js');fs.writeFileSync(path.join(dir,file),bytes,{flag:'wx'});evidence.boundHttpInputs.push({requestPath:input.requestPath,status:r.status,type:r.headers.get('content-type'),headers:Object.fromEntries(r.headers),sha256:sha(bytes),bytes:bytes.length,file,boundSha256:input.boundSha256,stage:input.type.startsWith('text/html')?'Actual HTTP after config/window injection':'Actual pinned bound response'});
  }
  fixture=await state();evidence.fixture={initialInputSha256:fixture.initialInputSha256,fixtures:fixture.fixtures,seasonFixtures:fixture.seasonFixtures,initialInputs:fixture.initialInputs,setupReceipts:fixture.setupReceipts,seededAt:fixture.seededAt};evidence.initialDatabases=fixture.databases;
  main=fixture.primary;alt=fixture.alternate;paid=fixture.fixtures.find(x=>x.role==='paid-source');budget=fixture.fixtures.find(x=>x.role==='budget-boundary');resources=fixture.fixtures.find(x=>x.role==='resources-boundary');season=fixture.seasonFixtures[0];roles=fixture.initialInputs.find(x=>x.actor.characterId===main.characterId&&x.actor.realmId==='permanent').roles;actor=main;
  browser=await playwright().chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});evidence.browserVersion=browser.version();const browserContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  await browserContext.addInitScript(()=>{const native=window.fetch;if(typeof native!=='function')return;const transport={armed:null,sequence:0,completed:0};Object.defineProperty(window,'__GuardianQATransport',{value:transport});window.fetch=function(input,init){let url,body;try{url=String(input?.url||input);body=JSON.parse(init?.body||'{}');}catch{}if(transport.armed&&url?.endsWith('/app/api/'+transport.armed.action)&&String(body.selectedCharacterId)===transport.armed.characterId){transport.armed=null;const serial=++transport.sequence,{signal,...options}=init||{};return native.call(this,input,options).then(response=>{const json=response.json.bind(response);response.json=async()=>{try{return await json();}finally{transport.completed=serial;}};return response;},error=>{transport.completed=serial;throw error;});}return native.call(this,input,init);};});
  page=await browserContext.newPage();page.setDefaultTimeout(20000);page.on('framenavigated',f=>{if(f===page.mainFrame())mainNavigations++;});page.on('pageerror',error=>evidence.pageErrors.push({message:error.message,stack:error.stack}));
  page.on('request',r=>{if(r.url().startsWith(api+'/app/api/')&&r.method()==='POST'){const endpoint=r.url().slice((api+'/app/api/').length),entry={action:endpoint,body:r.postDataJSON(),accountId:r.headers()['x-dev-tg-id'],at:new Date().toISOString()};evidence.requests.push(entry);if(endpoint===route){if(preparedSubmission){entry.actor={...preparedSubmission.actor};if(!preparedSubmission.body){preparedSubmission.body=entry.body;preparedSubmission.sentAt=entry.at;preparedSubmission.state='sent';}else if(JSON.stringify(preparedSubmission.body)!==JSON.stringify(entry.body)){preparedSubmission.conflictingObservedRequest=entry;preparedSubmission.state='conflicting-request-stop';}}persist('browser POST exact full body');}}});
  page.on('response',r=>{
   if(r.status()>=400)evidence.httpErrors.push({url:r.url(),status:r.status(),expected:expectedErrors.has(r.request())});
   const url=new URL(r.url()),name=url.pathname.split('/').at(-1),source=FRONT.includes(name)?'worker/public/'+name:ART.some(p=>url.pathname.endsWith('/'+p))?'worker/public/'+ART.find(p=>url.pathname.endsWith('/'+p)):null;
   if(source||/\.(?:js|mjs|css|html|webp|png|jpg|svg|mp4)(?:$|\?)/.test(url.pathname)){
    const record={url:r.url(),observedAt:new Date().toISOString(),status:r.status(),type:r.headers()['content-type'],headers:r.headers(),sha256:null,bytes:null,actualBodyRead:false};evidence.servedAssets[r.url()]=record;
    const p=r.body().then(bytes=>{Object.assign(record,{sha256:sha(bytes),bytes:bytes.length,actualBodyRead:true});if(source)evidence.loadedSources[source]=record;}).catch(error=>{if(isRetiredCharacterBodyGap(record,error,source)){const gap={...record,error:error.message,sha256:null,limitation:'Only this retired original character PNG/WebP body was unavailable through CDP; no original bytes or global asset freeze are claimed',refetched:false};evidence.assetCaptureGaps.push(gap);persist('original character response metadata retained with explicit CDP body gap');}else evidence.routeErrors.push({...record,message:error.message});});pendingAssets.push(p);
   }
  });
  await page.route('**/*',request=>{const url=request.request().url();if(readOnly&&url===api+'/app/api/'+route){evidence.routeErrors.push({message:'Read-only case blocked a Guardian write',url});return request.abort('blockedbyclient');}if(url.startsWith(origin+'/')||url.startsWith(api+'/'))return request.continue();evidence.externalRequests.push(url);return request.abort('blockedbyclient');});
  evidence.status='running';persist('launch exact pinned scene');expectedNavigations++;await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  frame=page.frames().find(f=>f.url().includes('/scene-bound-20261102/scene.html'))||await page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/scene-bound-20261102/scene.html'),timeout:30000});await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot()?.characterId,null,{timeout:30000});await frame.waitForFunction(()=>window.RpgSceneLiveView?.inspect?.()[0]?.characterVisible,null,{timeout:45000});
  if(selected==='layout')await layouts();else if(selected==='pure')await pureCases();else if(selected==='pure-tail')await pureTail();else if(selected.startsWith('auto-'))await autoCases();else if(selected==='receipt-only')await receiptBridge();else if(selected==='races'){await lateRead('200');await lateRead('409');}else if(selected==='gallery')await gallery();else await regularOperation();
  await Promise.all(pendingAssets);
  for(const[source,record]of Object.entries(evidence.loadedSources))assert.equal(record.sha256,evidence.sourceSHA256Before[source],'Actual served product bytes match source '+source);
  assert(evidence.loadedSources['worker/public/scene-guardian-ui.js']&&evidence.loadedSources['worker/public/scene-guardian-ui.css'],'Chrome loaded the actual new Guardian product');
  assert.equal(evidence.requests.filter(x=>x.action.startsWith('guardian/')&&!['guardian/scene','guardian/receipt',route].includes(x.action)).length,0,'No legacy settling inventory route');
  assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.httpErrors.filter(x=>!x.expected),[]);assert.deepEqual(evidence.routeErrors,[]);assert.deepEqual(evidence.externalRequests,[]);assert.equal(mainNavigations,expectedNavigations);
  evidence.sourceSHA256After=hashes();assert.deepEqual(evidence.sourceSHA256After,evidence.sourceSHA256Before,'All product and QA sources remain frozen during this case');evidence.finalState=await state();evidence.ok=true;evidence.status='passed';
 }catch(error){
  evidence.ok=false;evidence.status='failed';evidence.error={message:error.message,stack:error.stack};process.exitCode=1;
  try{if(page)await shot('failure');if(frame)evidence.visibleText=await frame.locator('.scene-unified-dialog').innerText({timeout:2000});}catch{}
 }finally{
  for(const release of releases)release();await Promise.allSettled(pendingAssets);
  try{if(frame)evidence.pendingStorage=await frame.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).filter(k=>k.startsWith('rpg-sg-pending:')).map(k=>[k,sessionStorage.getItem(k)])));evidence.sourceSHA256After=hashes();evidence.sourcesStable=JSON.stringify(evidence.sourceSHA256Before)===JSON.stringify(evidence.sourceSHA256After);}catch{}
  evidence.finishedAt=new Date().toISOString();evidence.requestCounts=Object.fromEntries([...new Set(evidence.requests.map(x=>x.action))].map(name=>[name,evidence.requests.filter(x=>x.action===name).length]));persist();console.log(JSON.stringify({ok:evidence.ok,status:evidence.status,case:selected,operations:evidence.operations.length,checks:evidence.checks.length,dir,error:evidence.error}));if(browser)await browser.close();
 }
})().catch(error=>{evidence.ok=false;evidence.status='failed';evidence.error={message:error.message,stack:error.stack};evidence.finishedAt=new Date().toISOString();persist();console.error(error.stack);process.exitCode=1;});
