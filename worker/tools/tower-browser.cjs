/* Real Chrome acceptance for the isolated tower / imprint scene.
 * Start RPG_TOWER_QA=1 on 9753/9752. Only loopback and synthetic SQLite data.
 * node worker/tools/tower-browser.cjs --cases=layout,workshop,tower,races --run-id=review-01
 * Every run has fixed results/progress files and preserves its failures. QA clock moves
 * to real stored deadlines before pure reads, then uses the original Party.sweep.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),args=new Map();
for(const value of process.argv.slice(2)){const m=/^--(cases|run-id|resume-run)=([a-zA-Z0-9,_.-]+)$/.exec(value);assert(m&&!args.has(m[1]),'Use --cases=... --run-id=...');args.set(m[1],m[2]);}
const selected=(args.get('cases')||'layout,workshop,tower,races').split(',');
assert(selected.length&&new Set(selected).size===selected.length&&selected.every(x=>['layout','workshop','workshop-recovery','focus','tower','races'].includes(x)),'Unknown case');
function local(value){const u=new URL(value);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&Number(u.port)>=1024,'Loopback only');return u.origin;}
const origin=local(process.env.TOWER_SCENE_ORIGIN||'http://127.0.0.1:9753'),api=local(process.env.TOWER_API_ORIGIN||'http://127.0.0.1:9752');assert.notEqual(origin,api);
const runId=args.get('run-id')||new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const base=path.join(repo,'.release-sync/tower-20261105'),dir=path.join(base,'browser',runId);
assert(!fs.existsSync(path.join(dir,'results.json')),'Do not overwrite an existing browser run');
fs.mkdirSync(dir,{recursive:true});
const q=x=>JSON.stringify(String(x)),sp=a=>'[data-sp-action='+q(a)+']',st=a=>'[data-st-action='+q(a)+']';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function deadline(p,label,ms=30000){let t;try{return await Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error(label+' timed out')),ms);})]);}finally{clearTimeout(t);}}
function hashes(){
 const git='C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe';
 const files=execFileSync(git,['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:repo,encoding:'utf8',maxBuffer:8*1024*1024}).split('\0').filter(Boolean);
 const front=['scene-tower-ui.js','scene-tower-ui.css','scene-party-ui.js','scene-party-ui.css','scene-live-session.js','scene-social-preview.js','scene-window-manager.js'].map(x=>'worker/public/'+x);
 const helpers=['worker/tools/tower-browser.cjs','worker/tools/tower-qa-fixture.mjs','worker/tools/party-qa-fixture.mjs','worker/tools/atlas-local-preview.mjs','worker/tools/scene-live-preview.mjs','worker/tools/scene-preview-bindings.mjs','worker/test/d1-shim.js','worker/test/client-request.js','worker/test/realm-test-helpers.js'];
 const owned=[...new Set(files)].filter(f=>/^worker\/(?:src|migrations)\//.test(f)&&/\.(?:[cm]?js|sql)$/.test(f)||front.includes(f)||helpers.includes(f)).sort();
 for(const file of [...front,...helpers])assert(owned.includes(file),'Required source exists: '+file);
 return Object.fromEntries(owned.map(f=>[f,sha(fs.readFileSync(path.join(repo,f)))]));
}
function playwright(){
 const candidates=[process.env.RPG_PLAYWRIGHT_MODULE,path.join(repo,'.release-sync/browser-tools/node_modules/playwright'),path.join(repo,'../star-journal-party-integration-20261104/.release-sync/browser-tools/node_modules/playwright'),path.join(repo,'../star-journal-skill-career-integration-20261104/.release-sync/browser-tools/node_modules/playwright'),'playwright',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean);
 for(const p of candidates){try{return require(require.resolve(p));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}}throw Error('Existing Playwright installation not found');
}
const evidence={startedAt:new Date().toISOString(),pid:process.pid,runId,origin,api,cases:selected,status:'starting',checks:[],screenshots:[],requests:[],directRequests:[],clockCommands:[],pageErrors:[],httpErrors:[],routeErrors:[],externalRequests:[],injectedFaults:[],loadedSources:{},realChrome:true,realLocalApi:true,productionWrites:false,clockMethod:'Explicit development X-Debug-Now; original deadlines unchanged; pure reads before original sweep. Not a natural wall-clock 15 minute test.'};
if(args.has('resume-run')){const resumePath=path.join(base,'browser',args.get('resume-run'),'results.json'),bytes=fs.readFileSync(resumePath),old=JSON.parse(bytes),entries=Object.entries(old.pendingStorage||{});assert.equal(old.status,'failed');assert.equal(entries.length,1,'Resume exactly one captured pending record');const pending=JSON.parse(entries[0][1]);assert.equal(pending.body.op,'redeem');const attempts=old.requests.filter(r=>r.action==='tower/action'&&r.body.requestId===pending.id);assert.equal(attempts.length,1);assert(old.injectedFaults.some(x=>x.requestId===pending.id&&x.mode==='not-sent'),'Resume only known never-sent action');evidence.resumedFrom={runId:old.runId,path:resumePath,sha256:sha(bytes),loadedSources:old.loadedSources};evidence.resumedPendingStorage=Object.fromEntries(entries);evidence.resumedPending=pending;evidence.resumedAttempts=attempts;}
function saveJson(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);}
function persist(step){if(step)evidence.step=step;saveJson(path.join(dir,'results.json'),evidence);saveJson(path.join(dir,'progress.json'),{startedAt:evidence.startedAt,updatedAt:new Date().toISOString(),pid:process.pid,status:evidence.status,step:evidence.step,checks:evidence.checks.length,runId,dir});saveJson(path.join(base,'browser/latest.json'),{runId,dir,status:evidence.status,step:evidence.step,updatedAt:new Date().toISOString()});}
const note=(name,detail={})=>{evidence.checks.push({name,passed:true,...detail});persist(name);console.log(JSON.stringify({check:name,passed:true}));};
persist('before browser start');
(async()=>{
 let browser,page,frame,mage,sword,archer,thief,peerSword,peerThief,mainNavigations=0;
 const expectedHttp=new WeakSet(),releases=new Set(),loadedPending=[];
 const gameplay=['tower/action','party/create','party/action','party/reward'];
 const writes=()=>evidence.requests.filter(r=>gameplay.includes(r.action));
 const writesFor=id=>[...(evidence.resumedAttempts||[]),...writes()].filter(r=>r.body.requestId===id);
 const pbtn=a=>frame.locator(sp(a)),sbtn=a=>frame.locator(st(a));
 const refresh=kind=>frame.locator((kind==='workshop'?'.st-header ':'.sp-header ')+(kind==='workshop'?st('refresh'):sp('refresh')));
 const ctx=()=>frame.evaluate(()=>window.RpgSceneSession.getContext());
 const call=(action,body={})=>frame.evaluate(({action,body})=>window.RpgSceneSession.request(action,body),{action,body});
 const read=partyId=>call('tower/scene',partyId?{partyId}:{});
 const state=()=>fetch(api+'/__preview/tower-qa/state',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
 const rawItem=(s,id)=>s.equipment.find(x=>x.id===id);
 const amount=(s,actor,item)=>s.inventory.find(x=>x.tg_id===actor.characterId&&x.item===item)?.quantity||0;
 const ownLedger=(s,id)=>s.ledger.filter(x=>x.event_id==='tower-action:'+mage.characterId+':app:'+id);
 const routeIs=route=>frame.waitForFunction(route=>document.querySelector('.scene-unified-dialog')?.dataset.route===route,route);
 async function ready(kind='tower'){await frame.waitForFunction(kind=>{const p=document.querySelector(kind==='workshop'?'.st-panel':'.sp-panel');return p?.dataset[kind==='workshop'?'stReady':'spReady']==='1'&&p.getAttribute('aria-busy')==='false';},kind);}
 async function pendingReady(){await frame.waitForFunction(()=>document.querySelector('[data-st-pending]')&&document.querySelector('.st-panel')?.getAttribute('aria-busy')==='false');}
 async function shot(name){const file=name+'.png';await page.screenshot({path:path.join(dir,file),fullPage:true});evidence.screenshots.push(file);persist();}
 async function single(){assert.equal(await frame.locator('.scene-unified-dialog').count(),1);assert.equal(page.context().pages().length,1);}
 async function choose(actor){
  if(String((await ctx()).characterId)===String(actor.characterId))return;
  await frame.locator('[data-scene-primary="character"]').click();await routeIs('character');await frame.locator('[data-scene-route="characters"]').click();await routeIs('characters');
  const b=frame.locator('.scene-social-body button.scene-atlas-entry').filter({hasText:actor.name});await b.waitFor();assert.equal(await b.count(),1);await b.click();
  await frame.waitForFunction(id=>String(window.RpgSceneSession.getSnapshot()?.characterId)===id,String(actor.characterId));
 }
 async function tab(kind,name){
  const panel=frame.locator(kind==='workshop'?'.st-panel':'.sp-panel'),attr=kind==='workshop'?'data-st-tab':'data-sp-tab';
  if(await panel.getAttribute(attr)!==name)await frame.locator((kind==='workshop'?'.st-tabs '+st('tab'):'.sp-tabs '+sp('tab'))+'[data-tab='+q(name)+']').click();
  await ready(kind);assert.equal(await panel.getAttribute(attr),name);
 }
 async function openTower(name='areas'){
  await frame.locator('[data-scene-primary="adventure"]').click();await routeIs('adventure');await frame.locator('[data-scene-route="tower"]').first().click();await routeIs('tower');await ready();assert.equal(await frame.locator('.sp-panel').getAttribute('data-sp-kind'),'tower');await tab('tower',name);await single();
 }
 async function openWorkshop(name='imprint'){
  await frame.locator('[data-scene-primary="camp"]').click();await routeIs('camp');await frame.locator('[data-scene-route="tower-imprint"]').first().click();await routeIs('tower-imprint');await ready('workshop');await tab('workshop',name);await single();
 }
 async function selectItem(id){await tab('workshop','imprint');await frame.locator('[name="towerEquipment"]').selectOption(id);await frame.locator('[data-st-imprint='+q(id)+']').waitFor();}
 async function rpc(actor,action,body={},allowed=[]){
  const payload={...body,selectedCharacterId:actor.characterId};if(['tower/action','party/action','party/reward'].includes(action)&&!payload.requestId)payload.requestId='tower-qa-'+crypto.randomUUID();
  const record={action,accountId:actor.accountId,body:payload,at:new Date().toISOString(),state:'sending'};evidence.directRequests.push(record);if(gameplay.includes(action))persist('direct '+action);
  const response=await fetch(api+'/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','x-dev-tg-id':actor.accountId,'x-realm-id':'permanent'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}),json=await response.json();Object.assign(record,{state:'completed',status:response.status,error:json.error});
  if(allowed.length)assert(allowed.includes(json.error),action+' expected '+allowed+' got '+JSON.stringify(json));else{assert.equal(response.status,200,action+' '+JSON.stringify(json));assert.notEqual(json.ok,false);}persist();return json;
 }
 async function pure(label,body={},receiptBody){
  const before=await state(),n=writes().length;let projection;
  for(let i=0;i<3;i++){projection=await call('tower/scene',body);if(receiptBody)await call('tower/receipt',receiptBody);}
  const after=await state();assert.deepEqual(after.databases,before.databases,label+' leaves every table in both SQLite databases unchanged');assert.equal(writes().length,n);
  evidence.pureReads??=[];evidence.pureReads.push({label,sha256:after.databases.permanent.sha256,tables:Object.keys(after.databases.permanent.counts).length,qaNow:after.qaClock.now});persist();return projection;
 }
 async function moveClock(op,body={}){
  const input={...body,op,requestId:'clock-'+crypto.randomUUID()};evidence.clockCommands.push({input,status:'sending'});persist('QA clock '+op);
  const r=await fetch(api+'/__preview/tower-qa/advance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,200,await r.clone().text());const result=await r.json();assert(result.debugOnly&&result.deadlinesUnmodified&&result.productionAccess===false);Object.assign(evidence.clockCommands.at(-1),{status:'completed',result});persist();return result;
 }
 async function geometry(kind,label){
  const result=await frame.evaluate(kind=>{const card=document.querySelector('.scene-social-card'),body=document.querySelector('.scene-social-body'),panel=document.querySelector(kind==='workshop'?'.st-panel':'.sp-panel');return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,card:card.getBoundingClientRect().toJSON(),bodyWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,items:[...panel.querySelectorAll('button,select,summary')].map(el=>({text:el.textContent?.trim().slice(0,40),rect:el.getBoundingClientRect().toJSON()})).filter(x=>x.rect.width&&x.rect.height)};},kind);
  assert(result.card.left>=-1&&result.card.right<=result.viewport+1,label+' fits viewport');assert(result.scrollWidth<=result.viewport+1&&result.bodyScrollWidth<=result.bodyWidth+1,label+' no horizontal overflow');
  for(const x of result.items){assert(x.rect.width>=43.5,label+' width '+JSON.stringify(x));assert(x.rect.height>=43.5,label+' height '+JSON.stringify(x));}await single();return result;
 }
 async function confirmation(kind){
  const prefix=kind==='workshop'?'st':'sp';await frame.locator('[data-'+prefix+'-confirm]').waitFor();
  const result=await frame.evaluate(prefix=>{const panel=document.querySelector('[data-'+prefix+'-confirm]'),cancel=panel.querySelector('[data-'+prefix+'-action="cancel"]'),r=panel.getBoundingClientRect(),p=document.querySelector('.scene-social-body').getBoundingClientRect();return {rect:r.toJSON(),viewport:p.toJSON(),visible:r.top>=Math.max(0,p.top)-1&&r.bottom<=Math.min(innerHeight,p.bottom)+1,focusOnCancel:document.activeElement===cancel};},prefix);
  assert(result.visible,'confirmation visible '+JSON.stringify(result));assert(result.focusOnCancel,'confirmation starts on cancel');return result;
 }
 async function clickWrite(kind,action,op,click){
  const response=page.waitForResponse(r=>r.url()===api+'/app/api/'+action&&r.request().method()==='POST'&&(!op||r.request().postDataJSON().op===op));await click();const r=await response,json=await r.json();assert.equal(r.status(),200,JSON.stringify(json));assert.notEqual(json.ok,false);await ready(kind);return json;
 }
 async function lostWorkshop(op,mode,click){
  const endpoint=api+'/app/api/tower/action',finished=gate();let used=false,body,result;
  const handler=async route=>{const input=route.request().postDataJSON();if(used||input.op!==op)return route.continue();used=true;body=input;try{if(mode==='committed'){const response=await route.fetch({maxRetries:0,timeout:15000});assert.equal(response.status(),200);result=await response.json();assert.notEqual(result.ok,false);}await route.abort('failed');finished.resolve();}catch(error){finished.reject(error);try{await route.abort('failed');}catch{}}};
  await page.route(endpoint,handler);
  try{await click();await deadline(finished.promise,'lost '+op+' '+mode);await pendingReady();assert.equal(writesFor(body.requestId).length,1,'one original action attempt');}finally{await page.unroute(endpoint,handler);}
  evidence.injectedFaults.push({action:'tower/action',op,mode,requestId:body.requestId});persist();return {body,result};
 }
 async function checkPending(found){
  await sbtn('check-pending').click();await pendingReady();await frame.locator('[data-st-receipt-found='+q(String(found))+']').waitFor();assert.equal(await sbtn('acknowledge').count(),found?1:0,'Only a found receipt offers acknowledgement');if(found)assert.equal(await sbtn('acknowledge').isDisabled(),false);
 }
 async function acknowledge(){const before=writes().length;await sbtn('acknowledge').click();await frame.locator('[data-st-pending]').waitFor({state:'detached'});assert.equal(writes().length,before,'acknowledgement only clears a verified receipt');}
 async function pendingVisible(){
  await frame.waitForFunction(()=>{const panel=document.querySelector('[data-st-pending]'),entry=panel?.querySelector('[data-st-action="check-pending"]');return entry&&document.activeElement===entry;},null,{timeout:3000});
  const x=await frame.evaluate(()=>{const panel=document.querySelector('[data-st-pending]'),entry=panel?.querySelector('[data-st-action="check-pending"]'),p=document.querySelector('.scene-social-body').getBoundingClientRect(),r=panel?.getBoundingClientRect();return {visible:!!r&&r.top>=p.top-1&&r.bottom<=p.bottom+1,focusOnRead:document.activeElement===entry,rect:r?.toJSON(),viewport:p.toJSON()};});
  assert(x.visible&&x.focusOnRead,'unknown result is visible and focuses pure read '+JSON.stringify(x));return x;
 }
 async function layout(){
  await choose(mage);const before=writes().length,views=[];
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:width<500?844:960});await openTower();
   for(const name of ['areas','current','lobby']){await tab('tower',name);views.push({width,route:'tower',tab:name,geometry:await geometry('tower',width+' tower '+name)});await shot(width+'-tower-'+name);}
   await openWorkshop();await selectItem(mage.equipment.imprint);
   for(const name of ['imprint','offers','titles']){await tab('workshop',name);views.push({width,route:'tower-imprint',tab:name,geometry:await geometry('workshop',width+' workshop '+name)});await shot(width+'-workshop-'+name);}
  }
  await pure('Opening tower and workshop',{},{requestId:'qa-layout-absent',op:'imprint',itemId:mage.equipment.imprint,from:0});assert.equal(writes().length,before);
  await frame.locator('.scene-window-close').focus();await page.keyboard.press('Tab');assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)));await page.keyboard.press('Shift+Tab');assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)));
  await frame.locator('.scene-window-close').click();assert(await frame.evaluate(()=>document.querySelector('.scene-primary-nav').contains(document.activeElement)));
  note('320/390/1280 tower and workshop fit one window with 44px controls, pure reads and trapped/returned focus',{views});
  const gates=[];
  for(const actor of [sword,archer,mage]){await choose(actor);await openTower();const data=await read();assert.deepEqual(data.tower.areas.map(x=>x.startFloor),[1,11,21]);for(const area of data.tower.areas)assert.equal(await frame.locator(sp('create-tower')+'[data-start-floor='+q(area.startFloor)+']').isDisabled(),!area.canCreate);gates.push({actor:actor.characterId,level:actor.level,best:actor.towerBest,areas:data.tower.areas});}
  assert(gates[0].areas[0].canCreate&&!gates[0].areas[1].canCreate);assert.equal(gates[0].areas[1].reason.code,'level');assert.equal(gates[1].areas[1].reason.code,'tower');assert(gates[2].areas.every(x=>x.canCreate));note('Three area controls follow authoritative level and previous-area gates',{gates});
  await openWorkshop();
  for(const [type,id]of Object.entries(mage.equipment)){await selectItem(id);const item=(await read()).tower.equipment.find(x=>x.id===id);assert(item,'fixture equipment remains inspectable');assert.equal(await frame.locator(st('imprint')+'[data-item-id='+q(id)+']').isDisabled(),!item.canImprint);if(type==='imprint')assert(item.canImprint);else assert(!item.canImprint);}
  note('Unworn gear is available; worn, traded and processing gear show original protection gates');
 }
 async function workshop(){
  await page.setViewportSize({width:390,height:844});await choose(mage);await openWorkshop();await selectItem(mage.equipment.imprint);
  const originalState=await state(),original=rawItem(originalState,mage.equipment.imprint),baseProjection=(await read()).tower.equipment.find(x=>x.id===original.id);assert.equal(baseProjection.towerImprint.level,0,'workshop phase starts from fresh imprint fixture');
  await sbtn('imprint').click();await confirmation('workshop');await shot('390-imprint-confirmation');const beforeCancel=writes().length;await sbtn('cancel').click();assert.equal(writes().length,beforeCancel);
  await sbtn('imprint').click();await confirmation('workshop');const lost=await lostWorkshop('imprint','committed',()=>sbtn('confirm').click());await pendingVisible();await shot('390-imprint-unknown-visible');
  await frame.locator('.scene-window-close').click();await openWorkshop();await checkPending(true);const receiptState=await state();assert.equal(ownLedger(receiptState,lost.body.requestId).length,1);assert.equal(amount(receiptState,mage,'tower_fragment'),amount(originalState,mage,'tower_fragment')-20);assert.equal(JSON.parse(rawItem(receiptState,original.id).bonus_json).towerImprint,1);await acknowledge();assert.equal(writesFor(lost.body.requestId).length,1);
  note('Committed imprint with lost response survives reopen and reconciles by pure receipt reads without another POST',{requestId:lost.body.requestId,itemId:original.id});
  for(let from=1;from<5;from++){await tab('workshop','imprint');await selectItem(original.id);const view=(await read()).tower.equipment.find(x=>x.id===original.id);assert.equal(view.towerImprint.level,from);await sbtn('imprint').click();await confirmation('workshop');const result=await clickWrite('workshop','tower/action','imprint',()=>sbtn('confirm').click());assert.equal(result.result.from,from);assert.equal(result.result.to,from+1);}
  const afterImprints=await state(),finalItem=rawItem(afterImprints,original.id),finalView=(await read()).tower.equipment.find(x=>x.id===original.id);assert.equal(finalView.towerImprint.level,5);assert.equal(finalView.stat,Math.round(baseProjection.stat*1.1));assert.equal(finalView.towerImprint.nextStat,null);assert(await sbtn('imprint').isDisabled());for(const key of Object.keys(original).filter(x=>x!=='bonus_json'))assert.deepEqual(finalItem[key],original[key],key+' investment preserved');const bonus=JSON.parse(finalItem.bonus_json);delete bonus.towerImprint;assert.deepEqual(bonus,JSON.parse(original.bonus_json));assert.equal(amount(afterImprints,mage,'tower_fragment'),amount(originalState,mage,'tower_fragment')-250);await shot('390-imprint-five-steps');
  note('Five real UI imprint steps preserve +9, original gear and bonuses, charge 250 badges and stop at +10 percent',{itemId:original.id,before:baseProjection.stat,after:finalView.stat});
  await workshopRecovery();
 }
 async function workshopRecovery(){
  await page.setViewportSize({width:320,height:844});await choose(mage);await openWorkshop(evidence.resumedPending?'imprint':'offers');
  const before=await state(),offer=(await read()).tower.offers.find(x=>x.id==='scroll_w');let unsent;
  if(evidence.resumedPending){unsent={body:evidence.resumedAttempts[0].body};assert.equal(ownLedger(before,unsent.body.requestId).length,0);assert.equal(writesFor(unsent.body.requestId).length,1);evidence.restoredPending={requestId:unsent.body.requestId,method:'Exact captured browser sessionStorage restored; no new original POST'};}else{await frame.locator(st('redeem')+'[data-offer-id="scroll_w"]').click();await confirmation('workshop');unsent=await lostWorkshop('redeem','not-sent',()=>sbtn('confirm').click());}
  await pendingVisible();await shot('320-redeem-unknown-visible');await checkPending(false);
  assert.equal(ownLedger(await state(),unsent.body.requestId).length,0);assert.equal(amount(await state(),mage,'tower_fragment'),amount(before,mage,'tower_fragment'));
  await frame.locator('.scene-window-close').click();await openWorkshop('offers');await checkPending(false);
  const automaticRead=page.waitForResponse(r=>r.url()===api+'/app/api/tower/scene'&&r.request().method()==='POST',{timeout:22000});await automaticRead;await pendingReady();assert.equal(writesFor(unsent.body.requestId).length,1,'reopen and automatic refresh never resubmit not-found action');
  await sbtn('retry').click();await confirmation('workshop');const retryCount=writes().length;await frame.locator('.scene-window-back').click();await returnsFocus(st('retry'));assert.equal(writes().length,retryCount,'Back from recovery makes no request');
  await sbtn('retry').click();await confirmation('workshop');await sbtn('cancel').click();await returnsFocus(st('retry'));assert.equal(writes().length,retryCount,'cancelled recovery makes no request');
  await sbtn('retry').click();await confirmation('workshop');await shot('390-explicit-same-request-retry');await clickWrite('workshop','tower/action','redeem',()=>sbtn('confirm').click());const same=writesFor(unsent.body.requestId);assert.equal(same.length,2);assert.deepEqual(same[1].body,same[0].body,'explicit retry retains exact original request body');
  const after=await state();assert.equal(ownLedger(after,unsent.body.requestId).length,1);assert.equal(amount(after,mage,'tower_fragment'),amount(before,mage,'tower_fragment')-offer.cost);assert.equal(amount(after,mage,'scroll_w'),amount(before,mage,'scroll_w')+offer.quantity);
  note('A request that never reached the API stays pending; cancelled retry is inert and explicit same-ID retry charges once',{requestId:unsent.body.requestId,browserAttempts:2,committedLedgerRows:1,quantity:offer.quantity});
  await tab('workshop','titles');assert(await frame.locator(st('title')+'[data-title-id="tower_30"]').isDisabled());
  await clickWrite('workshop','tower/action','title',()=>frame.locator(st('title')+'[data-title-id="tower_20"]').click());assert.equal((await read()).tower.title.id,'tower_20');await shot('390-tower-title');
  await clickWrite('workshop','tower/action','title',()=>frame.locator(st('title')+'[data-title-id=""]').click());assert.equal((await read()).tower.title,null);assert.equal(amount(await state(),mage,'tower_fragment'),amount(after,mage,'tower_fragment'));
  await pure('Completed workshop refresh');note('Unlocked titles equip and unequip through the real API without badge cost; locked title stays unavailable');
 }
 async function returnsFocus(selector){
  await frame.locator('[data-st-confirm]').waitFor({state:'detached'});
  await frame.waitForFunction(selector=>document.activeElement===document.querySelector(selector),selector,{timeout:3000});
 }
 async function focusChecks(){
  await page.setViewportSize({width:320,height:844});await choose(thief);await openWorkshop();await selectItem(thief.equipment.imprint);const before=writes().length;
  const scroll=await frame.evaluate(()=>{const body=document.querySelector('.scene-social-body'),before=body.scrollTop;body.scrollTop=0;return {before,after:body.scrollTop,height:body.clientHeight,scrollHeight:body.scrollHeight};});assert.equal(scroll.after,0);await shot('320-workshop-summary-at-top');
  for(const which of ['imprint','redeem']){
   if(which==='redeem')await tab('workshop','offers');else await selectItem(thief.equipment.imprint);
   const selector=which==='imprint'?st('imprint')+'[data-item-id='+q(thief.equipment.imprint)+']':st('redeem')+'[data-offer-id="scroll_w"]';
   for(const exit of ['cancel','back']){await frame.locator(selector).click();await confirmation('workshop');if(which==='imprint'&&exit==='cancel')await shot('320-imprint-safe-confirmation');await (exit==='cancel'?sbtn('cancel'):frame.locator('.scene-window-back')).click();await returnsFocus(selector);assert.equal(writes().length,before);}
  }
  note('320px workshop can scroll back to the full summary; cancelling or backing out of imprint/redeem returns focus to its exact source without a gameplay POST',{scroll,actor:thief.characterId});
 }
 async function tactic(skillId,targetId){
  if(!await frame.locator('[data-sp-tactics]').count())await pbtn('tactics').click();
  await frame.locator(sp('choose-skill')+'[data-skill-id='+q(skillId)+']').click();
  if(targetId){const select=frame.locator('[name="partyTarget"]'),options=await select.locator('option').evaluateAll(nodes=>nodes.map(x=>x.value)),choice=options.find(x=>x===targetId||x.endsWith(':'+targetId));assert(choice,'expected ally target');await select.selectOption(choice);}
 }
 async function advanceRound(partyId){
  const before=(await read(partyId)).party,move=await moveClock('due',{partyId});assert.equal(move.originalDeadline,before.deadline);const due=await pure('Due tower remains unmodified until explicit original sweep',{partyId});assert.equal(due.party.round,before.round);assert(due.party.pendingSettlement);
  await moveClock('settle',{partyId});await refresh('tower').click();await ready();return (await read(partyId)).party;
 }
 async function tower(){
  await page.setViewportSize({width:390,height:844});await choose(mage);await openTower();const initial=await read();assert(!initial.active,'tower phase requires no ongoing team');assert(!initial.tower.daily.used,'tower phase requires unused daily fixture');
  const created=await clickWrite('tower','party/create',null,()=>frame.locator(sp('create-tower')+'[data-start-floor="1"]').click()),partyId=created.party.id;assert.equal(created.party.kind,'tower');assert.equal(created.party.startFloor,1);assert.equal((await read()).tower.daily.used,false);
  await pure('Recruiting tower reads',{partyId});await rpc(peerSword,'party/action',{partyId,op:'join'});await rpc(peerThief,'party/action',{partyId,op:'join'});await rpc(peerSword,'party/action',{partyId,op:'start'},['leader']);await rpc(mage,'party/action',{partyId,op:'start'},['ready']);
  await rpc(peerSword,'party/action',{partyId,op:'ready',ready:true});await rpc(peerThief,'party/action',{partyId,op:'ready',ready:true});await refresh('tower').click();await ready();await clickWrite('tower','party/action','ready',()=>pbtn('ready').click());
  await pbtn('start').click();await confirmation('tower');const cancelled=writes().length;await pbtn('cancel').click();assert.equal(writes().length,cancelled);await pbtn('start').click();await confirmation('tower');await shot('390-tower-start-confirmation');const started=await clickWrite('tower','party/action','start',()=>pbtn('confirm').click());assert.equal(started.party.status,'combat');
  const rawStart=(await state()).parties.find(p=>p.id===partyId);assert.equal(rawStart.state.challengeEndsAt-rawStart.state.combatStartedAt,900000);for(const actor of [mage,peerSword,peerThief])assert((await rpc(actor,'tower/scene',{partyId})).tower.daily.used);
  note('Three distinct accounts join and ready; only departure spends each character daily entry and keeps the real 15 minute deadline',{partyId,combatStartedAt:rawStart.state.combatStartedAt,challengeEndsAt:rawStart.state.challengeEndsAt});
  await rpc(peerSword,'party/action',{partyId,op:'submit',round:started.party.round,skillId:'defend'});await rpc(peerThief,'party/action',{partyId,op:'submit',round:started.party.round,skillId:'defend'});await tactic('skill_06_2',peerSword.characterId);await clickWrite('tower','party/action','submit',()=>pbtn('submit').click());
  let current=await advanceRound(partyId),raw=(await state()).parties.find(p=>p.id===partyId).state,turn=(raw.recentTurns||[raw.lastTurn]).find(t=>t?.round===started.party.round);
  const event=turn.events.find(x=>x.actorId===mage.characterId&&x.skillId==='skill_06_2');assert(event&&event.targetId===peerSword.characterId&&event.shielded>0&&event.spentMp>0);await shot('390-tower-ally-shield');
  note('Tower tactics use the real actor skill, teammate target, MP and original scheduled turn',{partyId,event});
  for(let step=0;step<12&&current.status==='combat'&&(current.towerProgress?.cleared||0)<2;step++){
   for(const actor of [peerSword,peerThief])await rpc(actor,'party/action',{partyId,op:'submit',round:current.round,skillId:'attack'});
   await tactic('attack');await clickWrite('tower','party/action','submit',()=>pbtn('submit').click());current=await advanceRound(partyId);
  }
  assert.equal(current.status,'combat','partial tower still running');assert(current.towerProgress.cleared>=2&&current.towerProgress.cleared<10,'actual partial clears, not fabricated full victory');
  const beforeEnd=await state();await pbtn('end').click();await confirmation('tower');await shot('390-tower-partial-end-confirmation');await clickWrite('tower','party/action','end',()=>pbtn('confirm').click());const ended=(await read(partyId)).party;assert.equal(ended.status,'ended');assert(ended.towerProgress.rewardable);const expectedBadges=Math.floor(ended.towerProgress.cleared*10/10),afterEnd=await state();
  for(const actor of [mage,peerSword,peerThief]){const reward=afterEnd.rewards.find(x=>x.party_id===partyId&&x.char_id===actor.characterId);assert(reward,'partial reward receipt for '+actor.characterId);assert.equal(JSON.parse(reward.reward_json).items.tower_fragment,expectedBadges);assert.equal(amount(afterEnd,actor,'tower_fragment')-amount(beforeEnd,actor,'tower_fragment'),expectedBadges);}
  await rpc(mage,'party/reward',{partyId});await rpc(mage,'party/reward',{partyId});const afterRepeat=await state();assert.deepEqual(afterRepeat.rewards,afterEnd.rewards);assert.deepEqual(afterRepeat.inventory,afterEnd.inventory);assert.equal(afterRepeat.characters.find(x=>x.tg_id===mage.characterId).party_id,null);await pure('Ended partial rewards stay pure',{partyId});await shot('390-tower-partial-rewards');
  note('Explicitly ending a real partially cleared tower awards proportional badges once to all three participants',{partyId,cleared:ended.towerProgress.cleared,badges:expectedBadges,endingStatus:ended.status});
  assert((await read()).tower.daily.used);await rpc(mage,'party/create',{kind:'tower',startFloor:1},['tower_daily']);await moveClock('midnight-before',{characterId:mage.characterId});const last=await pure('Last millisecond before Taipei midnight');assert(last.tower.daily.used);await moveClock('midnight',{characterId:mage.characterId});const next=await pure('Taipei midnight resets derived entry without writes');assert(!next.tower.daily.used);assert(next.tower.areas.every(x=>x.canCreate));await refresh('tower').click();await ready();
  note('Daily entry is unavailable after departure and resets at Taipei midnight without changing gameplay tables',{beforeDay:last.tower.daily.day,afterDay:next.tower.daily.day,qaClock:(await state()).qaClock});
  await tab('tower','lobby');const endedTab=frame.locator(sp('directory')+'[data-tab="ended"]');if(!(await endedTab.isDisabled())){await endedTab.click();await ready();}assert(await frame.locator('[data-sp-list-party='+q(partyId)+']').count());await shot('390-tower-ended-directory');
 }
 async function lateRead(mode){
  await choose(mage);await openTower();const old=await ctx(),captured=gate(),processRead=gate(),responseReady=gate(),release=gate(),delivered=gate();releases.add(processRead.resolve);releases.add(release.resolve);let used=false,status,result;
  const handler=async route=>{const body=route.request().postDataJSON();if(used||String(body.selectedCharacterId)!==String(mage.characterId))return route.continue();used=true;captured.resolve();try{if(mode==='same-actor-error')await processRead.promise;const response=await route.fetch({maxRetries:0,timeout:15000});status=response.status();result=await response.json();responseReady.resolve();await release.promise;if(status>=400)expectedHttp.add(route.request());await route.fulfill({response});delivered.resolve();}catch(error){evidence.routeErrors.push({mode,message:error.message});captured.reject(error);responseReady.reject(error);delivered.reject(error);try{await route.abort('failed');}catch{}}};
  const serial=await arm('tower/scene',mage.characterId);await page.route(api+'/app/api/tower/scene',handler);
  try{await refresh('tower').click();await deadline(captured.promise,'capture tower read');if(mode==='success'){await deadline(responseReady.promise,'capture tower success');assert.equal(status,200);}await choose(sword);await openTower();if(mode==='same-actor-error'){processRead.resolve();await deadline(responseReady.promise,'old actor rejection');assert.equal(status,409);assert.equal(result.error,'character_changed');await choose(mage);await openTower();}
   release.resolve();await deadline(delivered.promise,'deliver old tower read');await transportCompleted(serial);const expected=mode==='success'?sword:mage;assert.equal(String((await ctx()).characterId),String(expected.characterId));assert((await frame.locator('.sp-header p').innerText()).includes(expected.name));assert.equal(await frame.locator('.sp-error').count(),0);assert.equal(await frame.locator('[data-sp-pending]').count(),0);assert((await ctx()).epoch>old.epoch);await single();
   note(mode==='success'?'A-to-B late tower read cannot repaint the new actor':'A-to-B-to-A real late 409 cannot clear the newer context',{status,oldEpoch:old.epoch,newEpoch:(await ctx()).epoch});
  }finally{processRead.resolve();release.resolve();releases.delete(processRead.resolve);releases.delete(release.resolve);await page.unroute(api+'/app/api/tower/scene',handler);}
 }
 async function arm(action,characterId){return frame.evaluate(({action,characterId})=>{const t=window.__TowerQATransport;t.armed={action,characterId:String(characterId)};return t.sequence+1;},{action,characterId});}
 async function transportCompleted(serial){await frame.waitForFunction(serial=>window.__TowerQATransport.completed>=serial,serial);}
 async function lateWorkshop(){
  await choose(mage);await openWorkshop('titles');const responseReady=gate(),release=gate(),delivered=gate();releases.add(release.resolve);let used=false,body;
  const handler=async route=>{const input=route.request().postDataJSON();if(used||input.op!=='title')return route.continue();used=true;body=input;try{const r=await route.fetch({maxRetries:0,timeout:15000});assert.equal(r.status(),200);responseReady.resolve();await release.promise;await route.abort('failed');delivered.resolve();}catch(error){responseReady.reject(error);delivered.reject(error);try{await route.abort('failed');}catch{}}};
  await page.route(api+'/app/api/tower/action',handler);const serial=await arm('tower/action',mage.characterId);
  const focus=()=>frame.evaluate(()=>({characterId:String(window.RpgSceneSession.getContext().characterId),route:document.querySelector('.scene-unified-dialog')?.dataset.route||null,active:{tag:document.activeElement?.tagName,id:document.activeElement?.id||null,sp:document.activeElement?.dataset?.spAction||null,st:document.activeElement?.dataset?.stAction||null,tab:document.activeElement?.dataset?.tab||null}}));
  try{await frame.locator(st('title')+'[data-title-id="tower_20"]').click();await deadline(responseReady.promise,'committed title before switch');await frame.locator('.scene-window-close').click();await choose(sword);await openTower();await frame.locator('.sp-tabs '+sp('tab')+'[data-tab="lobby"]').focus();const before=await focus();release.resolve();await deadline(delivered.promise,'lost old title response');await transportCompleted(serial);assert.deepEqual(await focus(),before,'late disposed action does not steal new actor focus or route');assert.equal(await frame.locator('[data-st-pending]').count(),0);assert.equal(await frame.locator('[data-sp-pending]').count(),0);
   await choose(mage);await openWorkshop();await checkPending(true);assert.equal(ownLedger(await state(),body.requestId).length,1);await acknowledge();assert.equal(writesFor(body.requestId).length,1);await shot('390-tower-workshop-recovered-after-switch');
   note('A committed workshop response lost after close and switch leaves the new actor alone; returning reads its one receipt',{requestId:body.requestId,focusBefore:before});
  }finally{release.resolve();releases.delete(release.resolve);await page.unroute(api+'/app/api/tower/action',handler);}
 }
 try{
  evidence.sourceSHA256Before=hashes();const preview=JSON.parse(fs.readFileSync(path.join(base,'preview-backend-sources.json'),'utf8'));for(const [f,h]of Object.entries(preview.sources))assert.equal(evidence.sourceSHA256Before[f],h,'running preview backend matches disk: '+f);evidence.previewBackendManifest={capturedAt:preview.capturedAt,sourceCount:Object.keys(preview.sources).length,pid:preview.pid};
  const health=await fetch(origin+'/__preview/health').then(r=>r.json()),apiHealth=await fetch(api+'/__preview/health').then(r=>r.json());assert(health.apiReady&&health.isolated&&health.ephemeral&&health.productionAccess===false);assert.equal(health.apiOrigin,api);assert(apiHealth.towerQa&&apiHealth.qaClock.debugOnly&&apiHealth.qaClock.deadlinesUnmodified);evidence.health={scene:health,api:apiHealth};
  const fixtures=(await state()).fixtures;mage=fixtures.find(x=>x.accountId==='90101'&&x.baseClass==='mage');sword=fixtures.find(x=>x.accountId==='90101'&&x.baseClass==='sword');archer=fixtures.find(x=>x.accountId==='90101'&&x.baseClass==='archer');thief=fixtures.find(x=>x.accountId==='90101'&&x.baseClass==='thief');peerSword=fixtures.find(x=>x.accountId==='90102');peerThief=fixtures.find(x=>x.accountId==='90103');assert(mage&&sword&&archer&&thief&&peerSword&&peerThief);evidence.fixtures={mage,sword,archer,thief,peerSword,peerThief};
  browser=await playwright().chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});evidence.browserVersion=browser.version();
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  await context.addInitScript(()=>{const native=window.fetch;if(typeof native!=='function')return;const t={armed:null,sequence:0,completed:0};Object.defineProperty(window,'__TowerQATransport',{value:t});window.fetch=function(input,init){let url,body;try{url=String(input?.url||input);body=JSON.parse(init?.body||'{}');}catch{}if(t.armed&&url?.endsWith('/app/api/'+t.armed.action)&&String(body?.selectedCharacterId)===t.armed.characterId){t.armed=null;const serial=++t.sequence,{signal,...options}=init||{};return native.call(this,input,options).then(response=>{const json=response.json.bind(response);response.json=async()=>{try{return await json();}finally{t.completed=serial;}};return response;},error=>{t.completed=serial;throw error;});}return native.call(this,input,init);};});
  if(evidence.resumedPendingStorage)await context.addInitScript(({origin,pending})=>{if(location.origin===origin)for(const [key,value]of Object.entries(pending))sessionStorage.setItem(key,value);},{origin,pending:evidence.resumedPendingStorage});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('framenavigated',f=>{if(f===page.mainFrame())mainNavigations++;});page.on('pageerror',e=>evidence.pageErrors.push({message:e.message,stack:e.stack}));
  page.on('request',r=>{if(r.url().startsWith(api+'/app/api/')&&r.method()==='POST'){const action=r.url().slice((api+'/app/api/').length);evidence.requests.push({action,body:r.postDataJSON(),at:new Date().toISOString()});if(gameplay.includes(action))persist('browser POST '+action);}});
  page.on('response',r=>{if(r.status()>=400)evidence.httpErrors.push({url:r.url(),status:r.status(),expected:expectedHttp.has(r.request())});const name=new URL(r.url()).pathname.split('/').at(-1);if(['scene-tower-ui.js','scene-tower-ui.css','scene-party-ui.js','scene-party-ui.css','scene-live-session.js'].includes(name)){const p=r.body().then(bytes=>{evidence.loadedSources[name]={url:r.url(),sha256:sha(bytes),bytes:bytes.length};}).catch(error=>evidence.routeErrors.push({asset:name,message:error.message}));loadedPending.push(p);}});
  await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith(api+'/'))return route.continue();evidence.externalRequests.push(url);return route.abort('blockedbyclient');});
  evidence.status='running';persist('launch scene');await page.goto(origin+'/',{waitUntil:'domcontentloaded'});frame=page.frames().find(f=>f.url().includes('/scene-bound-20261102/scene.html'))||await page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/scene-bound-20261102/scene.html'),timeout:30000});await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot()?.characterId,null,{timeout:30000});await frame.waitForFunction(()=>window.RpgSceneLiveView?.inspect?.()[0]?.characterVisible,null,{timeout:45000});
  for(const name of selected){persist('case '+name);if(name==='layout')await layout();else if(name==='workshop')await workshop();else if(name==='workshop-recovery')await workshopRecovery();else if(name==='focus')await focusChecks();else if(name==='tower')await tower();else{await page.setViewportSize({width:1280,height:960});await lateRead('success');await lateRead('same-actor-error');await page.setViewportSize({width:390,height:844});await lateWorkshop();}}
  await Promise.all(loadedPending);for(const [name,loaded]of Object.entries(evidence.loadedSources))assert.equal(loaded.sha256,evidence.sourceSHA256Before['worker/public/'+name],'actual Chrome asset equals source '+name);
  assert.equal(mainNavigations,1);assert.equal(evidence.requests.filter(r=>['tower/status','party/get','party/list','party/hall','party/hall/get'].includes(r.action)).length,0,'no settling legacy reads');
  assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.httpErrors.filter(x=>!x.expected),[]);assert.deepEqual(evidence.routeErrors,[]);assert.deepEqual(evidence.externalRequests,[]);
  evidence.sourceSHA256After=hashes();assert.deepEqual(evidence.sourceSHA256After,evidence.sourceSHA256Before,'all tested sources stay unchanged');evidence.finalState={qaClock:(await state()).qaClock,context:await ctx()};evidence.ok=true;evidence.status='passed';
 }catch(error){evidence.ok=false;evidence.status='failed';evidence.error={message:error.message,stack:error.stack};process.exitCode=1;try{if(page)await shot('failure');if(frame){evidence.visibleText=await frame.locator('.scene-unified-dialog').innerText({timeout:2000});evidence.pendingStorage=await frame.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).filter(k=>k.startsWith('rpg-st-workshop-pending:')).map(k=>[k,sessionStorage.getItem(k)])));}}catch{}}
 finally{for(const release of releases)release();await Promise.allSettled(loadedPending);try{evidence.sourceSHA256After=hashes();evidence.sourcesStable=JSON.stringify(evidence.sourceSHA256Before)===JSON.stringify(evidence.sourceSHA256After);}catch{}evidence.finishedAt=new Date().toISOString();evidence.requestCounts=Object.fromEntries([...new Set(evidence.requests.map(r=>r.action))].map(a=>[a,evidence.requests.filter(r=>r.action===a).length]));persist();console.log(JSON.stringify({ok:evidence.ok,status:evidence.status,checks:evidence.checks.length,dir,error:evidence.error,pageErrors:evidence.pageErrors,httpErrors:evidence.httpErrors.filter(x=>!x.expected),routeErrors:evidence.routeErrors}));if(browser)await browser.close();}
})().catch(error=>{evidence.status='failed';evidence.ok=false;evidence.error={message:error.message,stack:error.stack};evidence.finishedAt=new Date().toISOString();persist();console.error(error.stack);process.exitCode=1;});
