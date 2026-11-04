// Real loopback UI/API verification for Atlas tiered supplies. No clock jumps or production access.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require(path.resolve(process.env.SUPPLY_PLAYWRIGHT_PATH||'.release-sync/browser-tools/node_modules/playwright'));
const origin=process.env.SUPPLY_SCENE_ORIGIN||'http://127.0.0.1:9713';
const api=process.env.SUPPLY_API_ORIGIN||'http://127.0.0.1:9712';
for(const endpoint of [origin,api]){
 const url=new URL(endpoint);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
 assert(!['9652','9653','9682','9683','9692','9693','9702','9703'].includes(url.port),'Use a dedicated supply preview, not another work line');
}
const keys=['red_1','red_2','red_3','red_4','blue_1','blue_2','blue_3','blue_4'];
const baseDir=path.resolve('.release-sync/atlas-supply-20261104/browser');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const dir=path.join(baseDir,stamp);
const sources=['worker/public/scene-atlas-guide.js','worker/public/scene-supply-ui.js','worker/public/scene-social-preview.css','worker/public/scene-live-view.js','worker/src/services/atlas.js','worker/src/game/atlas-engine.js','worker/src/game/atlas-scene.js','worker/tools/atlas-local-preview.mjs','worker/tools/atlas-supply-browser.cjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async file=>[file,crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
(async()=>{
 await fs.mkdir(dir,{recursive:true});
 const evidence={startedAt:new Date().toISOString(),origin,api,checks:[],screenshots:[],ownedRunIds:[],actions:[]};
 const sourceBefore=await hashes();let browser,page,frame,failed=null;
 const errors=[],badResponses=[];
 const note=(name,detail={})=>{const value={name,pass:true,...detail};evidence.checks.push(value);console.log(JSON.stringify(value));};
 const shot=async name=>{const file=path.join(dir,name);await page.screenshot({path:file,fullPage:true});evidence.screenshots.push(file);};
 const call=(action,body={})=>frame.evaluate(({action,body})=>window.RpgSceneSession.request(action,body),{action,body});
 const routeIs=route=>frame.waitForFunction(route=>document.querySelector('.scene-unified-dialog')?.dataset.route===route,route);
 const ready=selector=>frame.waitForFunction(selector=>{const el=document.querySelector(selector);return el&&!el.disabled&&!el.closest('[inert]');},selector);
 const openRoute=async route=>{
  const group=route==='expedition'?'adventure':'camp';
  await frame.locator('[data-scene-primary="'+group+'"]').click();
  await routeIs(group);await frame.locator('[data-scene-route="'+route+'"]').click();await routeIs(route);
  await ready(route==='expedition'?'[data-guide-refresh]':'[data-supply-refresh]');
  if(route==='expedition')await frame.locator('[data-guide-start]').waitFor();
 };
 const setControl=async(name,value)=>{
  const field=frame.locator('[name="'+name+'"]'),kind=await field.evaluate(el=>el.tagName==='SELECT'?'select':el.type);
  if(kind==='select')await field.selectOption(String(value));else if(kind==='checkbox')await field.setChecked(!!value);else await field.fill(String(value));
 };
 const mutate=async(action,trigger)=>{
  const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===api+'/app/api/'+action);
  await trigger();const response=await responsePromise,data=await response.json();
  assert.equal(response.status(),200,action+' HTTP');assert.notEqual(data.ok,false,action+' response');return data;
 };
 const inventory=data=>Object.fromEntries(keys.map(key=>[key,Number(data.inventory?.[key]||0)]));
 const itemPlan=async values=>{for(const key of keys)await setControl('item_'+key,values[key]||0);};
 const readPlan=()=>frame.locator('[data-guide-supply-item]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.guideSupplyItem,node.value])));
 const saveSettings=async desired=>{
  await openRoute('supplies');for(const [name,value]of Object.entries(desired))await setControl(name,value);
  await frame.locator('[data-supply-settings] button[type="submit"]').click();await frame.locator('[data-supply-confirm]').waitFor();
  const result=await mutate('settings',()=>frame.locator('[data-supply-confirm]').click());await ready('[data-supply-refresh]');
  for(const [name,value]of Object.entries(desired))assert.equal(result.character[name],value,'saved '+name);
  return result;
 };
 const start=async(label,items)=>{
  await openRoute('expedition');await frame.locator('[data-guide-supply-item]').first().waitFor();
  await setControl('minutes',3);await itemPlan(items);
  await frame.locator('[data-guide-dispatch]').click();
  const result=await mutate('atlas/start',()=>frame.locator('[data-guide-confirm]').click());
  const status=await call('atlas/status');assert.equal(status.run.status,'running');assert(status.run.id);
  evidence.ownedRunIds.push(status.run.id);await fs.writeFile(path.join(dir,'owned-runs.json'),JSON.stringify(evidence.ownedRunIds));
  const action=evidence.actions.filter(row=>row.action==='atlas/start').at(-1);
  assert.deepEqual(action.body.supplies,{items:Object.fromEntries(keys.map(key=>[key,items[key]||0]))});
  assert.equal(Object.hasOwn(action.body,'policy'),false);
  assert.deepEqual(Object.fromEntries(keys.map(key=>[key,status.run.supplies.initialItems[key]||0])),Object.fromEntries(keys.map(key=>[key,items[key]||0])));
  note(label+' starts with exact per-item reservation',{runId:status.run.id,requestId:action.body.requestId,initialItems:status.run.supplies.initialItems,policy:status.run.supplies.policy});
  return {result,status};
 };
 const stop=async runId=>{
  await openRoute('expedition');await ready('[data-guide-stop]');await frame.locator('[data-guide-stop]').click();
  await mutate('atlas/stop',()=>frame.locator('[data-guide-confirm]').click());
  const status=await call('atlas/status');assert.equal(status.run.id,runId);assert.notEqual(status.run.status,'running');
  return {status,inventory:inventory(await call('me',{summary:false}))};
 };
 const waitCommitted=async(runId,minSeconds=1)=>{
  await frame.waitForFunction(({runId,minSeconds})=>{
   const run=window.RpgSceneSession?.getSnapshot()?.run;
   return run?.id===runId&&Number(run.processedSeconds)>=minSeconds;
  },{runId,minSeconds},{timeout:55000});
  return call('atlas/status');
 };
 try{
  for(const endpoint of [origin+'/__preview/health',api+'/__preview/health']){
   const response=await fetch(endpoint),health=await response.json();
   assert.equal(response.status,200);assert.equal(health.isolated,true);assert.equal(health.ephemeral,true);assert.equal(health.productionAccess,false);
   if(endpoint.startsWith(origin))assert.equal(health.apiReady,true);
  }
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));
  page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  page.on('request',request=>{if(request.method()==='POST'&&request.url().startsWith(api+'/app/api/'))evidence.actions.push({action:request.url().slice((api+'/app/api/').length),body:request.postDataJSON(),at:new Date().toISOString()});});
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('iframe');
  await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.getAttribute('src')?.includes('scene-bound')));
  frame=page.frames().find(f=>f.url().includes('/scene-bound-20261102/scene.html'));
  if(!frame){await page.locator('iframe').first().waitFor();frame=await page.locator('iframe').first().contentFrame();}
  assert(frame,'main battle frame');
  await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot()?.characterId,{},{timeout:40000});
  await frame.waitForFunction(()=>window.RpgSceneLiveView?.inspect?.()[0]?.characterVisible,{},{timeout:55000});
  evidence.context=await frame.evaluate(()=>window.RpgSceneSession.getContext());
  const initial=await call('atlas/status');assert.notEqual(initial.run?.status,'running','A fresh dedicated preview is required');
  assert(initial.supplies.items&&initial.supplies.totals);const definition=(await call('atlas/catalog')).catalog.supplyRules;
  assert.equal(definition.version,'atlas-supplies-v1');assert.equal(definition.potions.length,8);
  const campModel=await frame.evaluate(()=>window.RpgSceneLiveView.normalize(window.RpgSceneSession.getSnapshot()));
  assert.equal(campModel.supplies.hp,initial.supplies.totals.hp);assert.equal(campModel.supplies.mp,initial.supplies.totals.mp);
  assert.equal(initial.supplies.hp,initial.supplies.items.red_1);assert.equal(initial.supplies.mp,initial.supplies.items.blue_1);
  note('camp HUD shows all-tier totals while starter counters stay compatible',{totals:initial.supplies.totals,starter:{hp:initial.supplies.hp,mp:initial.supplies.mp}});
  const chosen={autoRedPct:80,autoBlue:true,autoBluePct:80,autoRedPotion:'red_2',autoBluePotion:'blue_2'};
  await saveSettings(chosen);const expectedPolicy={hpPreference:'red_2',mpPreference:'blue_2',hpThresholdPct:80,mpThresholdPct:80,autoBlue:true};
  const saved=await call('atlas/status');assert.deepEqual(saved.supplies.policy,expectedPolicy);
  note('real settings select owned higher-tier potions and custom thresholds',{policy:saved.supplies.policy});
  await openRoute('expedition');const draft={red_1:1,red_2:4,red_4:2,blue_1:1,blue_2:6,blue_4:2};
  await itemPlan(draft);await setControl('minutes',3);
  const originalDraft=await readPlan(),startsBefore=evidence.actions.filter(row=>row.action==='atlas/start').length;
  const focused=frame.locator('[name="item_blue_4"]');await focused.focus();await focused.press('Enter');
  await frame.locator('[data-guide-cancel]').click();
  assert.deepEqual(await readPlan(),originalDraft);
  assert.equal(await frame.evaluate(()=>document.activeElement?.name),'item_blue_4');
  assert.equal(evidence.actions.filter(row=>row.action==='atlas/start').length,startsBefore);
  await frame.locator('[data-guide-supply-settings]').click();await routeIs('supplies');await ready('[data-supply-refresh]');
  await frame.locator('.scene-window-back').click();await routeIs('expedition');
  await frame.locator('[data-guide-supply-item]').first().waitFor();assert.deepEqual(await readPlan(),originalDraft);
  note('draft cancellation and return preserve all eight values and focused input');
  for(const [width,height]of [[390,844],[320,780],[1280,900]]){
   await page.setViewportSize({width,height});await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const layout=await frame.evaluate(()=>{
    const dialog=document.querySelector('.scene-unified-dialog'),body=document.querySelector('.scene-social-body'),form=document.querySelector('[data-guide-start]');
    const inputs=[...form.querySelectorAll('[data-guide-supply-item]')].map(el=>{const r=el.getBoundingClientRect();return {key:el.dataset.guideSupplyItem,width:r.width,height:r.height};});
    return {inputs,overflow:{dialog:dialog.scrollWidth-dialog.clientWidth,body:body.scrollWidth-body.clientWidth,form:form.scrollWidth-form.clientWidth}};
   });
   assert.equal(layout.inputs.length,8);for(const row of layout.inputs){assert(row.width>=44&&row.height>=44,JSON.stringify(row));}
   for(const [name,overflow]of Object.entries(layout.overflow))assert(overflow<=1,name+' has horizontal overflow at '+width);
   await frame.locator('.scene-social-body').evaluate(el=>{el.scrollTop=0;});await shot(width+'-dispatch-top.png');
   await frame.locator('[name="item_blue_4"]').scrollIntoViewIfNeeded();await shot(width+'-dispatch-supplies.png');
   note(width+'px dispatch is readable with eight 44px inputs and no horizontal overflow',{layout});
  }
  await page.setViewportSize({width:390,height:844});
  const before=inventory(await call('me',{summary:false}));
  const first=await start('Specific-type expedition',draft),runId=first.status.run.id;
  assert.deepEqual(first.status.run.supplies.policy,expectedPolicy);
  const reserved=inventory(await call('me',{summary:false}));
  for(const key of keys)assert.equal(reserved[key],before[key]-(draft[key]||0),'exact reserve '+key);
  await saveSettings({autoRedPct:75,autoBlue:false,autoBluePct:35,autoRedPotion:'auto',autoBluePotion:'auto'});
  const changed=await call('atlas/status'),nextPolicy={hpPreference:'auto',mpPreference:'auto',hpThresholdPct:75,mpThresholdPct:35,autoBlue:false};
  assert.deepEqual(changed.supplies.policy,nextPolicy);assert.deepEqual(changed.run.supplies.policy,expectedPolicy);
  const reservedText=await frame.locator('[data-supply-reserved]').innerText();
  assert(reservedText.includes('80%'));assert(!reservedText.includes('75%'));
  assert((await frame.locator('.scene-supply').innerText()).includes('關閉則不使用'));
  await frame.locator('[data-supply-reserved]').scrollIntoViewIfNeeded();await shot('390-running-policy-freeze.png');
  note('saved auto/off preferences apply next run; current exact policy stays frozen',{current:changed.run.supplies.policy,next:changed.supplies.policy});
  const committed=await waitCommitted(runId,15),used=committed.run.supplies.usedItems;
  assert(Object.values(used).some(n=>n>0),'the live preview must actually consume a reserved bottle');
  for(const key of keys.filter(key=>!['red_2','blue_2'].includes(key)))assert.equal(Number(used[key]||0),0,'specific choice never substitutes '+key);
  await openRoute('expedition');await frame.locator('[data-guide-run-items]').waitFor();await shot('390-running-items.png');
  note('normal foreground commits consume actual selected-tier bottles',{processedSeconds:committed.run.progress.processedSeconds,usedItems:used});
  const finished=await stop(runId);
  for(const key of keys)assert.equal(finished.inventory[key],before[key]-Number(finished.status.run.supplies.usedItems[key]||0),'exact used/reserve/refund conservation '+key);
  assert.equal(finished.inventory.red_4,before.red_4);assert.equal(finished.inventory.blue_4,before.blue_4);
  note('return refunds every unused item to its exact tier without double deduction',{initial:before,remaining:finished.inventory,used:finished.status.run.supplies.usedItems});
  const beforeSecond=inventory(await call('me',{summary:false})),secondPlan={red_1:1,red_2:4,blue_1:2,blue_2:3};
  const second=await start('Automatic-type expedition',secondPlan),secondId=second.status.run.id;
  assert.deepEqual(second.status.run.supplies.policy,nextPolicy);
  const secondCommitted=await waitCommitted(secondId,15);
  assert.equal(secondCommitted.run.supplies.mp,5);
  for(const key of keys.filter(key=>key.startsWith('blue_')))assert.equal(Number(secondCommitted.run.supplies.usedItems[key]||0),0,'disabled blue consumes no tier');
  const redUsed=secondCommitted.run.supplies.usedItems;
  if(Number(redUsed.red_2||0)>0)assert.equal(Number(secondCommitted.run.supplies.items.red_1||0),0,'automatic red uses lower tier before higher');
  await openRoute('expedition');await frame.locator('[data-guide-run-policy]').waitFor();await shot('390-auto-blue-disabled.png');
  note('next expedition uses saved automatic choice and disabled blue consumption',{policy:secondCommitted.run.supplies.policy,usedItems:secondCommitted.run.supplies.usedItems});
  const secondDone=await stop(secondId);
  for(const key of keys)assert.equal(secondDone.inventory[key],beforeSecond[key]-Number(secondDone.status.run.supplies.usedItems[key]||0),'second conservation '+key);
  await page.setViewportSize({width:1280,height:900});await openRoute('supplies');await shot('1280-returned-supply-settings.png');
  assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);evidence.finalInventory=secondDone.inventory;
 }catch(error){
  failed=error;evidence.error={message:error.message,stack:error.stack};
  try{if(page)await shot('failure.png');}catch{}
 }finally{
  evidence.pageErrors=errors;evidence.badResponses=badResponses;evidence.finishedAt=new Date().toISOString();
  try{evidence.sourceAfter=await hashes();evidence.sourceBefore=sourceBefore;evidence.sourceStable=JSON.stringify(sourceBefore)===JSON.stringify(evidence.sourceAfter);}catch(error){evidence.sourceError=error.message;}
  evidence.pass=!failed&&evidence.sourceStable===true;
  await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(evidence,null,2)+'\n');
  await fs.writeFile(path.join(baseDir,'latest.json'),JSON.stringify({path:path.join(dir,'results.json'),pass:evidence.pass,checks:evidence.checks.length,finishedAt:evidence.finishedAt})+'\n');
  if(browser)await browser.close();
  console.log(JSON.stringify({pass:evidence.pass,checks:evidence.checks.length,sourceStable:evidence.sourceStable,result:path.join(dir,'results.json'),screenshots:evidence.screenshots,error:evidence.error||null}));
  if(!evidence.pass)process.exitCode=1;
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
