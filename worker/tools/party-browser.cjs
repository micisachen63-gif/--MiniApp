/* Real Chrome and real isolated API acceptance for the three-person party window.
 * Start the opt-in RPG_PARTY_QA scene/API on 9743/9742 before running this tool.
 * node worker/tools/party-browser.cjs [--cases=layout,workflow,races]
 * No production hosts, fixture edits, migrations, or outbound notifications.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..');
const args=process.argv.slice(2),names=['layout','workflow','races','focus','history'];
assert(args.length<=1&&args.every(x=>/^--cases=[a-z,]+$/.test(x)),'Use [--cases=layout,workflow,races]');
const selected=(args[0]?.slice(8)||'layout,workflow,focus,races').split(',');
assert(selected.length&&new Set(selected).size===selected.length&&selected.every(x=>names.includes(x)),'Invalid cases');
function local(value){const u=new URL(value);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&Number(u.port)>=1024,'Loopback only');return u.origin;}
const origin=local(process.env.PARTY_SCENE_ORIGIN||'http://127.0.0.1:9743');
const api=local(process.env.PARTY_API_ORIGIN||'http://127.0.0.1:9742');
assert.notEqual(origin,api);
const dir=path.join(repo,'.release-sync/party-20261104/browser',new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid);
const sourceFiles=['worker/public/scene-party-ui.js','worker/public/scene-party-ui.css','worker/public/scene-social-preview.js','worker/public/scene-window-manager.js','worker/public/scene-live-session.js','worker/src/services/party-scene.js','worker/src/services/party.js','worker/src/app.js','worker/src/index.js','worker/src/realm/index.js','worker/tools/scene-live-preview.mjs','worker/tools/atlas-local-preview.mjs','worker/tools/party-qa-fixture.mjs','worker/tools/party-browser.cjs'];
const q=x=>JSON.stringify(String(x)),sp=a=>'[data-sp-action='+q(a)+']';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const delay=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
async function deadline(promise,label,ms=30000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]);}finally{clearTimeout(timer);}}
async function hashes(){return Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,crypto.createHash('sha256').update(await fs.readFile(path.join(repo,f))).digest('hex')])));}
function playwright(){
 const candidates=[process.env.RPG_PLAYWRIGHT_MODULE,path.join(repo,'.release-sync/browser-tools/node_modules/playwright'),
  path.join(repo,'../star-journal-skill-career-integration-20261104/.release-sync/browser-tools/node_modules/playwright'),
  'playwright',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean);
 for(const p of candidates){try{return require(require.resolve(p));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}}
 throw Error('Set RPG_PLAYWRIGHT_MODULE to the existing Playwright installation');
}
(async()=>{
 await fs.mkdir(dir,{recursive:true});
 const evidence={startedAt:new Date().toISOString(),origin,api,cases:selected,checks:[],screenshots:[],requests:[],directRequests:[],pageErrors:[],httpErrors:[],externalRequests:[],routeErrors:[],injectedFaults:[],realChrome:true,realLocalApi:true,productionWrites:false};
 const note=(name,detail={})=>{evidence.checks.push({name,passed:true,...detail});console.log(JSON.stringify({check:name,passed:true}));};
 let browser,page,frame,mage,sword,thief,peerSword,peerThief,mainNavigations=0;
 const expectedHttp=new WeakSet(),releases=new Set();
 const writes=()=>evidence.requests.filter(r=>['party/create','party/action','party/reward'].includes(r.action));
 const writesFor=id=>writes().filter(r=>r.body.requestId===id);
 const btn=a=>frame.locator(sp(a)),refresh=()=>frame.locator('.sp-header '+sp('refresh'));
 const ctx=()=>frame.evaluate(()=>window.RpgSceneSession.getContext());
 const call=(action,body={})=>frame.evaluate(({action,body})=>window.RpgSceneSession.request(action,body),{action,body});
 const read=(partyId)=>call('party/scene',partyId?{partyId}:{});
 const ready=()=>frame.waitForFunction(()=>{const p=document.querySelector('.sp-panel');return p?.dataset.spReady==='1'&&p.getAttribute('aria-busy')==='false';});
 const routeIs=route=>frame.waitForFunction(route=>document.querySelector('.scene-unified-dialog')?.dataset.route===route,route);
 const state=()=>fetch(api+'/__preview/party-qa/state',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
 const shot=async name=>{const file=name+'.png';await page.screenshot({path:path.join(dir,file),fullPage:true});evidence.screenshots.push(file);};
 const single=async()=>{assert.equal(await frame.locator('.scene-unified-dialog').count(),1);assert.equal(page.context().pages().length,1);};
 async function open(tab='current'){
  await frame.locator('[data-scene-primary="adventure"]').click();await routeIs('adventure');
  await frame.locator('[data-scene-route="party"]').first().click();await routeIs('party');await ready();await single();
  if((await frame.locator('.sp-panel').getAttribute('data-sp-tab'))!==tab)await setTab(tab);
 }
 async function setTab(tab){await frame.locator('.sp-tabs '+sp('tab')+'[data-tab='+q(tab)+']').click();await ready();assert.equal(await frame.locator('.sp-panel').getAttribute('data-sp-tab'),tab);}
 async function choose(actor){
  if(String((await ctx()).characterId)===String(actor.characterId))return;
  await frame.locator('[data-scene-primary="character"]').click();await routeIs('character');
  await frame.locator('[data-scene-route="characters"]').click();await routeIs('characters');
  const b=frame.locator('.scene-social-body button.scene-atlas-entry').filter({hasText:actor.name});
  await b.waitFor();assert.equal(await b.count(),1);await b.click();
  await frame.waitForFunction(id=>String(window.RpgSceneSession.getSnapshot()?.characterId)===id,String(actor.characterId));
 }
 async function rpc(actor,action,body={},allowed=[]){
  const payload={...body,selectedCharacterId:actor.characterId};
  if(['party/action','party/reward'].includes(action)&&!payload.requestId)payload.requestId='qa-party-'+crypto.randomUUID();
  const r=await fetch(api+'/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','x-dev-tg-id':actor.accountId,'x-realm-id':'permanent'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  const json=await r.json();evidence.directRequests.push({action,accountId:actor.accountId,body:payload,status:r.status,error:json.error,at:new Date().toISOString()});
  if(allowed.length)assert(allowed.includes(json.error),action+' expected '+allowed+' got '+JSON.stringify(json));
  else {assert.equal(r.status,200,action+' HTTP '+JSON.stringify(json));assert.notEqual(json.ok,false,JSON.stringify(json));}
  return json;
 }
 async function pureRead(label,body={}){
  const before=await state(),count=writes().length;
  for(let i=0;i<3;i++)await call('party/scene',body);
  const after=await state();
  assert.deepEqual(after.databases,before.databases,label+' reads leave both real SQLite databases unchanged');
  assert.equal(writes().length,count);
  note(label+' uses only reads; all tables in both SQLite realms remain identical',{sha256:after.databases.permanent.sha256});
 }
 async function geometry(label){
  const result=await frame.evaluate(()=>{
   const card=document.querySelector('.scene-social-card'),body=document.querySelector('.scene-social-body');
   const rect=card.getBoundingClientRect(),items=[...document.querySelectorAll('.sp-panel button,.sp-panel select,.sp-panel summary')].map(el=>({text:el.textContent?.trim().slice(0,40),tag:el.tagName,rect:el.getBoundingClientRect().toJSON()})).filter(x=>x.rect.width&&x.rect.height);
   return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,card:rect.toJSON(),bodyWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,items};
  });
  assert(result.card.left>=-1&&result.card.right<=result.viewport+1,label+' within viewport');
  assert(result.scrollWidth<=result.viewport+1&&result.bodyScrollWidth<=result.bodyWidth+1,label+' no horizontal overflow');
  for(const item of result.items){assert(item.rect.height>=43.5,label+' target height '+JSON.stringify(item));assert(item.rect.width>=43.5,label+' target width '+JSON.stringify(item));}
  await single();return result;
 }
 async function confirmation(){
  await frame.locator('[data-sp-confirm]').waitFor();
  const result=await frame.evaluate(()=>{
   const c=document.querySelector('[data-sp-confirm]'),b=c.querySelector('[data-sp-action="cancel"]'),r=c.getBoundingClientRect(),p=document.querySelector('.scene-social-body').getBoundingClientRect();
   return {rect:r.toJSON(),scroll:p.toJSON(),visible:r.top>=Math.max(0,p.top)-1&&r.bottom<=Math.min(innerHeight,p.bottom)+1,focusOnCancel:document.activeElement===b};
  });
  assert(result.visible,'confirmation visible '+JSON.stringify(result));assert(result.focusOnCancel,'confirmation begins on cancel');
  return result;
 }
 async function clickWrite(action,op,click){
  const response=page.waitForResponse(r=>r.url()===api+'/app/api/'+action&&r.request().method()==='POST'&&(!op||r.request().postDataJSON().op===op));
  await click();const r=await response,json=await r.json();assert.equal(r.status(),200,JSON.stringify(json));assert.notEqual(json.ok,false);await ready();return json;
 }
 async function confirmWrite(op){await confirmation();return clickWrite('party/action',op,()=>btn('confirm').click());}
 async function createUi(dungeonId='pillar'){
  await setTab(dungeonId.startsWith('trial')?'trials':'dungeons');
  const b=frame.locator(sp('create')+'[data-dungeon-id='+q(dungeonId)+']');
  const result=await clickWrite('party/create',null,()=>b.click());assert.equal(result.party.dungeonId,dungeonId);
  assert.equal(await frame.locator('[data-sp-confirm]').count(),0,'creating a lobby is a single action');
  return result.party;
 }
 async function showCurrent(partyId){
  await setTab('current');
  if(partyId&&!(await frame.locator('[data-sp-party='+q(partyId)+']').count())){
   await frame.evaluate(partyId=>window.RpgSceneNavigation.navigate('party',{tab:'current',partyId}),partyId);await ready();
  }
 }
 async function cleanup(){
  const data=await read(),p=data.active;
  if(p&&['lobby','combat'].includes(p.status)){
   assert(p.me?.leader,'QA cleanup must own its synthetic party');await rpc(mage,'party/action',{partyId:p.id,op:'end'});
   evidence.fixtureCleanup={partyId:p.id,status:p.status};await refresh().click();await ready();
  }
 }
 async function layout(){
  await choose(mage);await open('dungeons');const before=writes().length,views=[];
  for(const width of [320,390,1280]){
   await page.setViewportSize({width,height:width<500?844:960});
   for(const tab of ['dungeons','trials','current','lobby']){
    await setTab(tab);views.push({width,tab,geometry:await geometry(width+' '+tab)});await shot(width+'-'+tab);
   }
  }
  await pureRead('Opening and refreshing the party directory');
  assert.equal(writes().length,before,'tab, pool and layout browsing do not write');
  await frame.locator('.scene-window-close').focus();await page.keyboard.press('Tab');
  assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)),'forward focus trap');
  await page.keyboard.press('Shift+Tab');assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)),'reverse focus trap');
  await frame.locator('.scene-window-close').click();
  assert(await frame.evaluate(()=>document.querySelector('.scene-primary-nav').contains(document.activeElement)),'close returns navigation focus');
  note('320/390/1280 four tabs fit one window; visible controls meet 44px and keyboard focus stays contained',{views});
 }
 async function lose(action,op,click){
  const endpoint=api+'/app/api/'+action,committed=gate();let body,result,used=false;
  const handler=async route=>{
   const input=route.request().postDataJSON();
   if(used||(op&&input.op!==op))return route.continue();used=true;body=input;
   try{const response=await route.fetch({maxRetries:0,timeout:15000});assert.equal(response.status(),200);result=await response.json();assert.notEqual(result.ok,false);await route.abort('failed');committed.resolve();}
   catch(error){committed.reject(error);try{await route.abort('failed');}catch{}}
  };
  await page.route(endpoint,handler);
  try{await click();await deadline(committed.promise,'committed '+action+' lost response');
   await frame.waitForFunction(()=>document.querySelector('[data-sp-pending]')&&document.querySelector('.sp-panel')?.getAttribute('aria-busy')==='false');
   assert.equal(writesFor(body.requestId).length,1,'the original unknown POST was sent once');
   await shot('unknown-'+action.replaceAll('/','-')+'-'+(op||'create'));
  }finally{await page.unroute(endpoint,handler);}
  evidence.injectedFaults.push({kind:'committed-response-aborted',action,op,requestId:body.requestId});
  return {body,result};
 }
 async function acknowledge(){
  await refresh().click();await ready();assert.equal(await btn('acknowledge').isDisabled(),false);
  const before=writes().length;await btn('acknowledge').click();await frame.locator('[data-sp-pending]').waitFor({state:'detached'});
  assert.equal(writes().length,before,'acknowledge is not a gameplay write');
 }
 async function lobbyChecks(p){
  await rpc(peerSword,'party/action',{partyId:p.id,op:'join'});
  await rpc(peerThief,'party/action',{partyId:p.id,op:'join'});
  await rpc(peerSword,'party/action',{partyId:p.id,op:'start'},['leader']);
  await rpc(mage,'party/action',{partyId:p.id,op:'start'},['ready']);
  await refresh().click();await ready();
  assert.equal(await btn('start').isDisabled(),true,'all-ready gate disabled in UI');
  await rpc(peerSword,'party/action',{partyId:p.id,op:'ready',ready:true});
  await rpc(peerThief,'party/action',{partyId:p.id,op:'ready',ready:true});
  await clickWrite('party/action','ready',()=>btn('ready').click());
  const current=(await read(p.id)).party;
  assert.equal(current.members.length,3);assert(current.members.every(m=>m.ready));
  assert.equal(new Set([mage.accountId,peerSword.accountId,peerThief.accountId]).size,3);
  note('three real synthetic accounts join and ready; nonleader and incomplete ready start are rejected',{partyId:p.id});
 }
 async function tactic(skillId,targetId){
  if(!await frame.locator('[data-sp-tactics]').count())await btn('tactics').click();
  await frame.locator(sp('choose-skill')+'[data-skill-id='+q(skillId)+']').click();
  if(targetId){const select=frame.locator('[name="partyTarget"]');const options=await select.locator('option').evaluateAll(nodes=>nodes.map(x=>({value:x.value,label:x.textContent})));const choice=options.find(o=>o.value===targetId||o.value.endsWith(':'+targetId));assert(choice,'ally target option '+JSON.stringify(options));await select.selectOption(choice.value);}
 }
 async function nextRound(partyId,previous){
  for(let i=0;i<30;i++){const d=await read(partyId),p=d.party;if(p.status!=='combat'||p.round>previous)return p;await delay(250);}
  throw Error('The real scheduled round did not advance');
 }
 async function workflow(){
  await page.setViewportSize({width:390,height:844});await choose(mage);await open('dungeons');await cleanup();
  let beforeCreate=await state(),otherPartyId=beforeCreate.parties.find(p=>['won','lost','ended'].includes(p.status))?.id;
  if(!otherPartyId){const old=await rpc(mage,'party/create',{kind:'dungeon',dungeonId:'pillar'});otherPartyId=old.party.id;await rpc(mage,'party/action',{partyId:otherPartyId,op:'end'});await refresh().click();await ready();beforeCreate=await state();evidence.pendingIsolationFixture={partyId:otherPartyId,createdAndEndedThroughRealApi:true};}
  const lost=await lose('party/create',null,()=>frame.locator(sp('create')+'[data-dungeon-id="pillar"]').click());
  const partyId=lost.result.party.id;
  assert.equal((await state()).parties.length,beforeCreate.parties.length+1,'unknown create creates exactly one party');
  assert.equal((await read()).active.id,partyId);
  await frame.locator('.scene-window-close').click();await open('current');
  assert.equal(await frame.locator('[data-sp-pending]').count(),1,'pending survives close/reopen');await acknowledge();
  assert.equal(writesFor(lost.body.requestId).length,1);await showCurrent(partyId);
  note('lost create response is reconciled by pure reads after reopen; only one party and one original POST exist',{partyId,requestId:lost.body.requestId});
  await pureRead('Recruiting-party refresh',{partyId});
  await lobbyChecks(lost.result.party);
  await btn('start').click();await confirmation();await shot('390-start-confirmation');
  const beforeCancel=writes().length;await btn('cancel').click();assert.equal(writes().length,beforeCancel);
  await btn('start').click();const started=await confirmWrite('start');assert.equal(started.party.status,'combat');
  await rpc(peerSword,'party/action',{partyId,op:'submit',round:started.party.round,skillId:'defend',targetId:peerSword.characterId});
  await rpc(peerThief,'party/action',{partyId,op:'submit',round:started.party.round,skillId:'defend',targetId:peerThief.characterId});
  await tactic('skill_06_2',peerSword.characterId);
  const submitted=await clickWrite('party/action','submit',()=>btn('submit').click());
  const submittedView=(await read(partyId)).party;
  assert.equal(submittedView.me.submission.skillId,'skill_06_2');assert.equal(submittedView.me.submission.targetId,peerSword.characterId);
  const chosenBody=writes().filter(x=>x.action==='party/action'&&x.body.op==='submit').at(-1).body;
  await rpc(mage,'party/action',chosenBody);
  const round=await nextRound(partyId,started.party.round);
  const raw=(await state()).parties.find(p=>p.id===partyId).state,turn=(raw.recentTurns||[raw.lastTurn]).find(t=>t?.round===started.party.round);
  const events=turn.events.filter(e=>e.actorId===mage.characterId&&e.skillId==='skill_06_2');
  assert.equal(events.length,1,'idempotent replay yields one real skill event');assert.equal(events[0].targetId,peerSword.characterId);assert(events[0].shielded>0,'actual teammate shield');
  assert(events[0].spentMp>0,'actual spell spends mana');
  assert(raw.actors.find(a=>a.id===mage.characterId).special.cooldowns.skill_06_2>turn.at,'actual cooldown stored');
  const beforeMp=turn.before.members.find(m=>m.id===mage.characterId).mp,afterMp=events[0].after.members.find(m=>m.id===mage.characterId).mp;
  assert(afterMp<beforeMp,'observed caster MP decreases');assert(raw.actors.find(a=>a.id===peerSword.characterId).buffs.some(b=>b.type==='shield'&&b.value>0),'shield remains on chosen teammate');
  note('manual teammate shield uses the real scheduled turn, MP and cooldown; same requestId replay does not double cast',{partyId,round:started.party.round,event:events[0],beforeMp,afterMp});
  await refresh().click();await ready();await shot('390-combat-shield-result');
  if(round.status==='combat'){
   await rpc(peerSword,'party/action',{partyId,op:'submit',round:round.round,skillId:'defend',targetId:peerSword.characterId});
   await rpc(peerThief,'party/action',{partyId,op:'submit',round:round.round,skillId:'defend',targetId:peerThief.characterId});
   await tactic('defend');
   const unknown=await lose('party/action','submit',()=>btn('submit').click());
   await setTab('lobby');await frame.locator(sp('directory')+'[data-tab="ended"]').click();await ready();
   await frame.locator('[data-sp-list-party='+q(otherPartyId)+'] '+sp('view')).click();await ready();
   assert.equal(await frame.locator('[data-sp-party]').getAttribute('data-sp-party'),otherPartyId);
   assert.equal(await btn('acknowledge').isDisabled(),true,'another party cannot unlock acknowledgement of the pending submission');
   await btn('pending-view').click();await ready();assert.equal(await frame.locator('[data-sp-party]').getAttribute('data-sp-party'),partyId);
   await acknowledge();assert.equal(writesFor(unknown.body.requestId).length,1);
   note('pending tactical submission stays unresolved while viewing another party; returning to its exact party uses only reads',{pendingPartyId:partyId,otherPartyId});
   const next=await nextRound(partyId,unknown.body.round),stateAfter=(await state()).parties.find(p=>p.id===partyId).state;
   const t=(stateAfter.recentTurns||[stateAfter.lastTurn]).find(t=>t?.round===unknown.body.round);
   assert.equal(t.events.filter(e=>e.actorId===mage.characterId&&e.skillId==='defend').length,1);
   note('committed tactical action with lost response is checked without retransmitting; one scheduled action is executed',{partyId,round:unknown.body.round,requestId:unknown.body.requestId});
   await rpc(mage,'party/action',{partyId,op:'submit',round:unknown.body.round,skillId:'defend',targetId:mage.characterId},next.status==='combat'?['round']:['closed']);
  }
  let finished;
  for(let i=0;i<100;i++){finished=(await read(partyId)).party;if(finished.status!=='combat')break;await delay(500);}
  assert.equal(finished.status,'won','real combat reaches victory');await refresh().click();await ready();
  const beforeReward=await state(),mineBefore=beforeReward.inventory.find(x=>x.tg_id===mage.characterId&&x.item==='research_fragment')?.quantity||0;
  const first=await rpc(mage,'party/reward',{partyId}),second=await rpc(mage,'party/reward',{partyId});
  assert.deepEqual(second.reward,first.reward);
  const afterReward=await state(),mineAfter=afterReward.inventory.find(x=>x.tg_id===mage.characterId&&x.item==='research_fragment')?.quantity||0;
  assert.equal(mineAfter,mineBefore,'already granted victory reward is not duplicated');
  assert.equal(afterReward.rewards.filter(r=>r.party_id===partyId).length,3);
  await pureRead('Won-party history and reward refresh',{partyId});
  await shot('390-victory-rewards');
  note('real victory pays all three accounts once; repeated reward requests return the same receipt',{partyId,reward:first.reward,receipts:afterReward.rewards.filter(r=>r.party_id===partyId)});
  await setTab('trials');await shot('390-trial-catalogue');assert(await frame.locator('[data-sp-dungeon="trial3"]').count());assert(await frame.locator('[data-sp-dungeon="trial4"]').count());
  const abortParty=await createUi('pillar');await lobbyChecks(abortParty);await btn('start').click();await confirmWrite('start');
  await btn('end').click();const confirm=await confirmation();assert((await frame.locator('[data-sp-confirm]').innerText()).includes('整支三人隊伍'));await shot('390-combat-end-confirmation');
  const ended=await confirmWrite('end');assert.equal(ended.party.status,'ended');assert.equal((await read()).active,null);
  const endState=await state();assert.equal(endState.rewards.filter(x=>x.party_id===abortParty.id).length,0);
  note('combat abort explicitly confirms ending the whole team, releases presence, and gives no unearned win rewards',{partyId:abortParty.id,confirmation:confirm});
  await historyViews();
 }
 async function historyViews(){
  await choose(mage);await open('lobby');const views=[];
  for(const width of [320,1280]){
   await page.setViewportSize({width,height:width<500?844:960});await setTab('lobby');
   const ended=frame.locator(sp('directory')+'[data-tab="ended"]'),active=frame.locator(sp('directory')+'[data-tab="active"]');
   if(!await ended.isDisabled())await ended.click();
   await ready();
   assert.equal(await frame.locator('.sp-panel').getAttribute('data-sp-tab'),'lobby');
   assert.equal(await ended.isDisabled(),true,'ended tab is selected');assert.equal(await active.isDisabled(),false,'active tab is not selected');
   const lastUiRead=evidence.requests.filter(r=>r.action==='party/scene').at(-1);assert.equal(lastUiRead.body.tab,'ended','the UI requests the ended directory');
   const expected=(await call('party/scene',{tab:'ended',page:1})).directory.parties.map(p=>p.id).sort();
   const actual=(await frame.locator('[data-sp-list-party]').evaluateAll(nodes=>nodes.map(n=>n.dataset.spListParty))).sort();
   assert.deepEqual(actual,expected,'rendered parties match the server ended directory');
   views.push({width,selectedTab:'ended',partyIds:actual,geometry:await geometry('ended hall '+width)});await shot(width+'-ended-hall');
  }
  note('320/1280 ended directory preserves its actual selected tab and displays matching server party IDs',{views});
 }
 async function focusAndPool(){
  await page.setViewportSize({width:390,height:844});await choose(mage);await open('dungeons');
  async function retained(selector,label){
   const control=frame.locator(selector);await control.focus();
   const expected=await control.evaluate(el=>({...el.dataset}));
   const polling=page.waitForRequest(r=>r.url()===api+'/app/api/party/scene'&&r.method()==='POST',{timeout:10000});
   await polling;await ready();
   const actual=await frame.evaluate(()=>({...document.activeElement?.dataset}));assert.deepEqual(actual,expected,label+' keeps the exact focused control through loading and repaint');
   return {label,expected,actual};
  }
  const focus=[];focus.push(await retained('.sp-tabs '+sp('tab')+'[data-tab="trials"]','third tab'));
  focus.push(await retained(sp('create')+'[data-dungeon-id="aegean"]','nonfirst dungeon create'));
  note('background polling restores the exact tab and dungeon control focus',{focus});
  const pools=[];
  for(const actor of [mage,thief]){
   await choose(actor);await open('dungeons');
   for(const dungeonId of ['pillar','aegean']){
    const data=await read(),d=data.dungeons.find(d=>d.id===dungeonId);assert(Array.isArray(d.dropSkillIds),'server sends exact drop identities');
    await frame.locator(sp('pool')+'[data-dungeon-id='+q(dungeonId)+']').click();await frame.locator('[data-sp-pool='+q(dungeonId)+']').waitFor();
    const actual=await frame.locator('[data-sp-pool] .sp-card h4').allTextContents(),expected=d.dropSkillIds.map(id=>data.skills.find(s=>s.id===id)?.name).filter(Boolean);
    assert.deepEqual([...actual].sort(),[...expected].sort(),'pool follows exact server-authoritative skill IDs');pools.push({actor:actor.characterId,base:actor.baseClass,dungeonId,ids:d.dropSkillIds,names:actual});
    await btn('pool-back').click();
   }
  }
  await choose(mage);await open('current');note('mage and thief dungeon loot previews match authoritative dropSkillIds, including fallback rules',{pools});
 }
 async function lateRead(mode){
  await choose(mage);await open('dungeons');const old=await ctx(),captured=gate(),processRead=gate(),responseReady=gate(),release=gate(),delivered=gate();
  releases.add(processRead.resolve);releases.add(release.resolve);let used=false,status,result;
  const handler=async route=>{
   const body=route.request().postDataJSON();if(used||String(body.selectedCharacterId)!==String(mage.characterId))return route.continue();used=true;captured.resolve();
   try{if(mode==='same-actor-error')await processRead.promise;const response=await route.fetch({maxRetries:0,timeout:15000});status=response.status();result=await response.json();responseReady.resolve();await release.promise;if(status>=400)expectedHttp.add(route.request());await route.fulfill({response});delivered.resolve();}
   catch(e){evidence.routeErrors.push({mode,message:e.message});captured.reject(e);responseReady.reject(e);delivered.reject(e);try{await route.abort('failed');}catch{}}
  };
  const serial=await frame.evaluate(id=>{const t=window.__PartyQATransport;t.armed=id;return t.sequence+1;},String(mage.characterId));
  await page.route(api+'/app/api/party/scene',handler);
  try{
   await refresh().click();await deadline(captured.promise,'capture party read');
   if(mode==='success'){await deadline(responseReady.promise,'captured party success');assert.equal(status,200);}
   await choose(sword);await open('current');assert.equal(await frame.locator('.sp-header p').innerText(),sword.name);
   if(mode==='same-actor-error'){processRead.resolve();await deadline(responseReady.promise,'real delayed old-character rejection');assert.equal(status,409);assert.equal(result.error,'character_changed');await choose(mage);await open('current');}
   release.resolve();await deadline(delivered.promise,'old party read delivery');await frame.waitForFunction(i=>window.__PartyQATransport.completed>=i,serial);
   const expected=mode==='success'?sword:mage;
   assert.equal(String((await ctx()).characterId),String(expected.characterId));assert.equal(await frame.locator('.sp-header p').innerText(),expected.name);
   assert.equal(await frame.locator('.sp-error').count(),0,'old party read cannot paint an error');assert.equal(await frame.locator('[data-sp-pending]').count(),0);
   assert((await ctx()).epoch>old.epoch);await single();await shot('1280-late-party-'+mode);
   evidence.injectedFaults.push({kind:'delayed-real-party-read',mode,status,oldEpoch:old.epoch,newEpoch:(await ctx()).epoch,transport:'one armed read ignores AbortSignal; payload and response unchanged'});
   note(mode==='success'?'A-to-B delayed successful party read cannot repaint B':'A-to-B-to-A real delayed 409 cannot clear the newer A context');
  }finally{processRead.resolve();release.resolve();releases.delete(processRead.resolve);releases.delete(release.resolve);await page.unroute(api+'/app/api/party/scene',handler);}
 }
 try{
  evidence.sourceSHA256Before=await hashes();
  const health=await fetch(origin+'/__preview/health').then(r=>r.json()),apiHealth=await fetch(api+'/__preview/health').then(r=>r.json());
  assert(health.isolated&&health.ephemeral&&health.productionAccess===false&&health.apiReady);assert.equal(health.apiOrigin,api);assert(apiHealth.partyQa);evidence.health={scene:health,api:apiHealth};
  const fixtures=(await state()).fixtures;thief=fixtures.find(x=>x.accountId==='90101'&&x.baseClass==='thief');mage=fixtures.find(x=>x.accountId==='90101'&&x.baseClass==='mage');sword=fixtures.find(x=>x.accountId==='90101'&&x.baseClass==='sword');peerSword=fixtures.find(x=>x.accountId==='90102');peerThief=fixtures.find(x=>x.accountId==='90103');
  assert(mage&&sword&&peerSword&&peerThief);evidence.fixtures={mage,sword,peerSword,peerThief};
  browser=await playwright().chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});evidence.browserVersion=browser.version();
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  await context.addInitScript(()=>{
   const native=window.fetch;if(typeof native!=='function')return;const transport={armed:null,sequence:0,completed:0};Object.defineProperty(window,'__PartyQATransport',{value:transport});
   window.fetch=function(input,init){let body,url;try{url=String(input?.url||input);body=JSON.parse(init?.body||'{}');}catch{}
    if(transport.armed&&url?.endsWith('/app/api/party/scene')&&String(body?.selectedCharacterId)===transport.armed){transport.armed=null;const serial=++transport.sequence,{signal,...options}=init||{};
     return native.call(this,input,options).then(response=>{const json=response.json.bind(response);response.json=async()=>{try{return await json();}finally{transport.completed=serial;}};return response;},error=>{transport.completed=serial;throw error;});}
    return native.call(this,input,init);
   };
  });
  page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('framenavigated',f=>{if(f===page.mainFrame())mainNavigations++;});
  page.on('pageerror',e=>evidence.pageErrors.push({message:e.message,stack:e.stack}));
  page.on('request',r=>{if(r.url().startsWith(api+'/app/api/')&&r.method()==='POST')evidence.requests.push({action:r.url().slice((api+'/app/api/').length),body:r.postDataJSON(),at:new Date().toISOString()});});
  page.on('response',r=>{if(r.status()>=400)evidence.httpErrors.push({url:r.url(),status:r.status(),expected:expectedHttp.has(r.request())});});
  await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith(api+'/'))return route.continue();evidence.externalRequests.push(url);return route.abort('blockedbyclient');});
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  frame=page.frames().find(f=>f.url().includes('/scene-bound-20261102/scene.html'))||await page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/scene-bound-20261102/scene.html'),timeout:30000});
  await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot()?.characterId,null,{timeout:30000});
  await frame.waitForFunction(()=>window.RpgSceneLiveView?.inspect?.()[0]?.characterVisible,null,{timeout:45000});
  for(const c of selected){if(c==='layout')await layout();else if(c==='workflow')await workflow();else if(c==='focus')await focusAndPool();else if(c==='history')await historyViews();else{await page.setViewportSize({width:1280,height:960});await lateRead('success');await lateRead('same-actor-error');}}
  assert.equal(mainNavigations,1,'all actions stay within the initial scene page');
  assert.equal(evidence.requests.filter(r=>['party/get','party/list','party/hall','party/hall/get'].includes(r.action)).length,0,'never call legacy settling reads');
  assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.httpErrors.filter(x=>!x.expected),[]);assert.deepEqual(evidence.routeErrors,[]);assert.deepEqual(evidence.externalRequests,[]);
  evidence.sourceSHA256After=await hashes();assert.deepEqual(evidence.sourceSHA256After,evidence.sourceSHA256Before,'all tested sources remain stable');
  evidence.pageNavigations=mainNavigations;evidence.ok=true;
 }catch(e){evidence.ok=false;evidence.error={message:e.message,stack:e.stack};process.exitCode=1;try{if(page)await shot('failure');if(frame)evidence.visibleText=await frame.locator('.scene-unified-dialog').innerText({timeout:2000});}catch{}}
 finally{for(const release of releases)release();evidence.finishedAt=new Date().toISOString();evidence.requestCounts=Object.fromEntries([...new Set(evidence.requests.map(r=>r.action))].map(a=>[a,evidence.requests.filter(r=>r.action===a).length]));await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({ok:evidence.ok,checks:evidence.checks.length,dir,error:evidence.error,pageErrors:evidence.pageErrors,httpErrors:evidence.httpErrors,routeErrors:evidence.routeErrors}));if(browser)await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
