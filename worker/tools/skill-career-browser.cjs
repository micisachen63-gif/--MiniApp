/* Real Chrome acceptance for the skills/career unified window.
 * Start the isolated scene/API separately with RPG_SKILL_CAREER_QA=1.
 * This script never starts a preview, edits fixtures, or accesses production.
 * node worker/tools/skill-career-browser.cjs [--cases=layout,workflow,races]
 * SKILL_CAREER_SCENE_ORIGIN / SKILL_CAREER_API_ORIGIN default to 9733 / 9732.
 * Each invocation preserves its own screenshots, requests and results.json.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');

const repo=path.resolve(__dirname,'../..');
const names=['layout','workflow','races'];
const args=process.argv.slice(2);
assert(args.length<=1&&args.every(value=>/^--cases=[a-z,]+$/.test(value)),
  'Use node worker/tools/skill-career-browser.cjs [--cases=layout,workflow,races]');
const selected=(args[0]?.slice('--cases='.length)||names.join(',')).split(',');
assert(selected.length&&new Set(selected).size===selected.length&&selected.every(value=>names.includes(value)),
  'Cases must be a unique subset of layout,workflow,races');
function localOrigin(value) {
  const url=new URL(value);
  assert(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password
    &&url.pathname==='/'&&!url.search&&!url.hash&&Number(url.port)>=1024,'Only a loopback preview origin is allowed');
  return url.origin;
}
const origin=localOrigin(process.env.SKILL_CAREER_SCENE_ORIGIN||'http://127.0.0.1:9733');
const api=localOrigin(process.env.SKILL_CAREER_API_ORIGIN||'http://127.0.0.1:9732');
assert.notEqual(origin,api,'The scene and API use separate preview ports');
const runLabel=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const dir=path.join(repo,'.release-sync/skill-career-20261104/browser',runLabel);
const sourceFiles=[
  'worker/public/scene-skills-ui.js','worker/public/scene-skills-ui.css',
  'worker/public/scene-social-preview.js','worker/public/scene-window-manager.js',
  'worker/public/scene-live-session.js','worker/src/services/skill-career.js',
  'worker/src/app.js','worker/tools/scene-live-preview.mjs','worker/tools/atlas-local-preview.mjs',
  'worker/tools/skill-career-browser.cjs',
];
const skillIds={first:'skill_01_1',second:'skill_01_2',third:'skill_01_3',advanced:'skill_07_1',otherBranch:'skill_02_1'};
const q=value=>JSON.stringify(String(value));
const sc=(action,id)=>'[data-sc-action='+q(action)+']'+(id?'[data-skill-id='+q(id)+']':'');
const skillDetail=id=>'[data-sc-detail='+q(id)+']';
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};};
async function deadline(promise,label,ms=30000) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]); }
  finally { clearTimeout(timer); }
}
async function hashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[
    file,crypto.createHash('sha256').update(await fs.readFile(path.join(repo,file))).digest('hex'),
  ])));
}
function playwright() {
  const candidates=[
    process.env.RPG_PLAYWRIGHT_MODULE,
    path.join(repo,'.release-sync/browser-tools/node_modules/playwright'),
    'playwright',
    path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
  ].filter(Boolean);
  for(const candidate of candidates) {
    let resolved;
    try { resolved=require.resolve(candidate); } catch(error) { if(error.code==='MODULE_NOT_FOUND')continue;throw error; }
    return require(resolved);
  }
  throw Error('Playwright is unavailable; set RPG_PLAYWRIGHT_MODULE or provide the existing browser-tools junction');
}

(async()=>{
  await fs.mkdir(dir,{recursive:true});
  const evidence={
    startedAt:new Date().toISOString(),origin,api,cases:selected,checks:[],screenshots:[],
    realChrome:true,realLocalApi:true,isolatedInMemoryFixture:true,productionWrites:false,
    injectedFaults:[],requests:[],pageErrors:[],httpErrors:[],externalRequests:[],routeErrors:[],
  };
  let browser,page,frame,sword,archer;
  const releases=new Set(),expectedHttp=new WeakSet(),unexpectedFailures=[];
  const note=(name,detail={})=>{
    evidence.checks.push({name,passed:true,...detail});
    console.log(JSON.stringify({check:name,passed:true}));
  };
  const requests=()=>evidence.requests;
  const writes=()=>requests().filter(r=>['expedition/action','advance','reselect'].includes(r.action));
  const writesFor=requestId=>writes().filter(r=>r.body?.requestId===requestId);
  const writeCount=(action,op)=>writes().filter(r=>r.action===action&&(!op||r.body.op===op)).length;
  const shot=async label=>{
    const filename=label+'.png';
    await page.screenshot({path:path.join(dir,filename),fullPage:true});
    evidence.screenshots.push(filename);
  };
  const call=(action,body={})=>frame.evaluate(({action,body})=>window.RpgSceneSession.request(action,body),{action,body});
  const context=()=>frame.evaluate(()=>window.RpgSceneSession.getContext());
  const read=async()=>{
    const value=await call('skill-career'),ctx=await context();
    assert.notEqual(value.ok,false);assert.equal(String(value.characterId),String(ctx.characterId));
    assert.equal(value.realmId,ctx.realmId);assert.equal(String(value.character.tgId),String(ctx.characterId));
    assert(Array.isArray(value.skills)&&Array.isArray(value.eligible)&&value.special&&value.career,'complete pure-read projection');
    return value;
  };
  const ready=()=>frame.waitForFunction(()=>{
    const panel=document.querySelector('[data-sc-ready]');
    return panel?.dataset.scReady==='1'&&panel.getAttribute('aria-busy')==='false';
  });
  const btn=(action,id)=>frame.locator(sc(action,id));
  const refreshButton=()=>frame.locator('.sc-header '+sc('refresh'));
  const routeIs=route=>frame.waitForFunction(route=>document.querySelector('.scene-unified-dialog')?.dataset.route===route,route);
  const single=async()=>{
    assert.equal(await frame.locator('.scene-unified-dialog').count(),1,'one unified window');
    assert.equal(page.context().pages().length,1,'no extra browser tabs');
  };
  async function open(route) {
    await frame.locator('[data-scene-primary="character"]').click();
    await routeIs('character');
    if(route!=='character') {
      await frame.locator('[data-scene-route='+q(route)+']').click();
      await routeIs(route);
    }
    if(['skills','career'].includes(route))await ready();
    await single();
  }
  async function choose(actor) {
    if(String((await context()).characterId)===String(actor.charId))return;
    await open('characters');
    const button=frame.locator('.scene-social-body button.scene-atlas-entry').filter({hasText:actor.name});
    await button.waitFor();assert.equal(await button.count(),1,'unambiguous fixture character');
    assert.equal(await button.isDisabled(),false);
    await button.click();
    await frame.waitForFunction(id=>String(window.RpgSceneSession.getSnapshot()?.characterId)===id,String(actor.charId));
  }
  async function list({reset=true}={}) {
    if(await frame.locator('[data-sc-detail]').count())await btn('list').click();
    await frame.locator('[name="skillSearch"]').waitFor();
    if(reset) {
      await frame.locator('[name="skillSearch"]').fill('');
      await frame.locator('[name="skillScope"]').selectOption('mine');
      await frame.locator('[name="skillFilter"]').selectOption('all');
    }
  }
  async function detail(id) {
    if(await frame.locator(skillDetail(id)).count())return;
    await list();
    await frame.locator('.sc-skill-grid '+sc('detail',id)).click();
    await frame.locator(skillDetail(id)).waitFor();
  }
  async function confirmationVisible() {
    // DOM measurements and focus are checked before Playwright can scroll the confirm button.
    const inspect=(requireReady=false)=>{
      const panel=document.querySelector('[data-sc-confirm]'),cancel=document.querySelector('[data-sc-action="cancel"]');
      const body=document.querySelector('.scene-social-body');
      if(!panel||!cancel||!body)return null;
      const rect=panel.getBoundingClientRect(),clip=body.getBoundingClientRect();
      const measured={rect:rect.toJSON(),clip:clip.toJSON(),viewport:{width:innerWidth,height:innerHeight},
        focusOnCancel:document.activeElement===cancel,
        visible:rect.width>0&&rect.height>0&&rect.left>=-1&&rect.right<=innerWidth+1
          &&rect.top>=-1&&rect.bottom<=innerHeight+1&&rect.top>=clip.top-1&&rect.bottom<=clip.bottom+1};
      return requireReady&&(!measured.visible||!measured.focusOnCancel)?false:measured;
    };
    let measured;
    try {
      const handle=await frame.waitForFunction(inspect,true,{timeout:3000});
      measured=await handle.jsonValue();await handle.dispose();
    } catch(error) {
      const measured=await frame.evaluate(inspect);
      throw Error('Confirmation must be entirely visible with focus on cancel before clicking confirm: '+JSON.stringify(measured),{cause:error});
    }
    evidence.confirmations=(evidence.confirmations||[]);
    evidence.confirmations.push(measured);
    return measured;
  }
  async function preview(action,id,extra='') {
    await frame.locator(sc(action,id)+extra).click();
    await frame.locator('[data-sc-confirm]').waitFor();
    await single();await confirmationVisible();
  }
  async function cancel() {
    await btn('cancel').click();
    await frame.locator('[data-sc-confirm]').waitFor({state:'detached'});
  }
  async function confirm(action,op) {
    await confirmationVisible();
    const before=writeCount(action,op);
    const responsePromise=page.waitForResponse(response=>{
      if(response.url()!==api+'/app/api/'+action||response.request().method()!=='POST')return false;
      return !op||response.request().postDataJSON()?.op===op;
    });
    await btn('confirm').click();
    const response=await responsePromise,data=await response.json();
    assert.equal(response.status(),200,action+' HTTP');
    assert.notEqual(data.ok,false,action+' result');
    assert(data.result!=null,action+' receipt');
    await ready();
    assert.equal(await frame.locator('[data-sc-pending]').count(),0,'known success clears pending operation');
    assert.equal(writeCount(action,op),before+1,'one confirmed POST');
    const body=response.request().postDataJSON();
    assert(body.requestId&&String(body.selectedCharacterId)===String((await context()).characterId),'scoped operation request');
    return {data,state:await read(),body};
  }
  const level=(state,id)=>Number(state.skills.find(s=>s.id===id)?.mastery?.level)||0;
  const quantity=(state,id)=>Number(state.inventory[id])||0;
  const book=(state,id)=>quantity(state,'book_'+id);
  async function learn(id) {
    await detail(id);const before=await read(),from=level(before,id);
    const cost=before.skills.find(s=>s.id===id).mastery.nextCost;
    await preview('learn',id);const result=await confirm('expedition/action','learn');
    assert.equal(result.body.skillId,id);assert.equal(result.body.fromLevel,from);
    assert.equal(level(result.state,id),from+1);assert.equal(book(result.state,id),book(before,id)-cost);
    return result.state;
  }
  async function loadout(action,id,expected) {
    if(action==='equip')await detail(id);
    await preview(action,id);
    const result=await confirm('expedition/action','loadout');
    assert.deepEqual(result.state.special.loadout,expected);
    return result.state;
  }
  async function auto(id,mode) {
    await frame.locator('[name="skillAuto"][data-skill-id='+q(id)+']').selectOption(mode);
    await preview('auto',id);
    const result=await confirm('expedition/action','auto');
    assert.equal(result.body.skillId,id);assert.equal(result.body.mode,mode);
    assert.equal(result.state.special.auto[id],mode==='manual'?undefined:mode);
    return result.state;
  }
  async function settings(mode,budget) {
    await frame.locator('[name="skillMode"]').selectOption(mode);
    await frame.locator('[name="skillBudget"]').fill(String(budget));
    await preview('settings');
    const result=await confirm('expedition/action','settings');
    assert.deepEqual(Object.keys(result.body).sort(),['budget','mode','op','requestId','selectedCharacterId'].sort(),
      'skill settings only writes its own mode and budget');
    assert.equal(result.body.mode,mode);assert.equal(result.body.budget,budget);
    assert.equal(result.state.special.mode,mode);assert.equal(result.state.special.budget,budget);
    return result.state;
  }
  async function geometry(label) {
    const value=await frame.evaluate(()=>{
      const card=document.querySelector('.scene-social-card'),body=document.querySelector('.scene-social-body');
      const rect=card.getBoundingClientRect();
      return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,card:rect.toJSON(),
        bodyWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth};
    });
    assert(value.card.left>=-1&&value.card.right<=value.viewport+1,label+' window stays within viewport');
    assert(value.bodyScrollWidth<=value.bodyWidth+1,label+' content has no horizontal overflow');
    assert(value.scrollWidth<=value.viewport+1,label+' frame has no horizontal overflow');
    await single();
    return value;
  }
  async function actorVisible(actor) {
    assert.equal(String((await context()).characterId),String(actor.charId));
    assert.equal(await frame.locator('.sc-header p').innerText(),actor.name,'module header belongs to current character');
    assert((await frame.locator('.scene-window-context').innerText()).includes(actor.name));
    const state=await read();assert.equal(state.character.name,actor.name);return state;
  }

  async function layout() {
    await choose(sword);const before=writes().length,views=[];
    for(const width of [320,390,1280]) {
      await page.setViewportSize({width,height:width<500?844:960});
      await open('skills');await list();
      await frame.locator('.scene-unified-dialog').evaluate(el=>{el.__skillCareerWindow='same-window';});
      views.push({width,view:'skills',geometry:await geometry('skills '+width)});
      await shot(width+'-skills');
      await detail(skillIds.first);
      views.push({width,view:'detail',geometry:await geometry('detail '+width)});
      await shot(width+'-skill-detail');
      if(!(await btn('learn',skillIds.first).isDisabled())) {
        await preview('learn',skillIds.first);
        views.push({width,view:'confirmation',geometry:await geometry('confirmation '+width)});
        await shot(width+'-skill-confirmation');await cancel();
      }
      await frame.locator(sc('navigate')+'[data-route="career"]').click();await routeIs('career');await ready();
      assert.equal(await frame.locator('.scene-unified-dialog').evaluate(el=>el.__skillCareerWindow),'same-window');
      views.push({width,view:'career',geometry:await geometry('career '+width)});
      await shot(width+'-career');
      const candidate=frame.locator(sc('advance')+':not(:disabled)').first();
      if(await candidate.count()) {
        await candidate.click();await frame.locator('[data-sc-confirm]').waitFor();await confirmationVisible();
        views.push({width,view:'career-confirmation',geometry:await geometry('career confirmation '+width)});
        await shot(width+'-career-confirmation');await cancel();
      }
    }
    assert.equal(writes().length,before,'layout previews and cancellations send no gameplay writes');
    await frame.locator('.scene-window-close').focus();
    await page.keyboard.press('Tab');
    assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)),'forward focus trap');
    await page.keyboard.press('Shift+Tab');
    assert(await frame.evaluate(()=>document.querySelector('.scene-unified-dialog').contains(document.activeElement)),'reverse focus trap');
    await frame.locator('.scene-window-close').click();
    assert(await frame.evaluate(()=>document.querySelector('.scene-primary-nav').contains(document.activeElement)),'close restores primary navigation focus');
    note('320/390/1280 layouts, details and confirmations share one window; cancel is read-only',{views});
  }

  async function lostRecycle() {
    const id=skillIds.first;await detail(id);
    const before=await read(),recycleValue=before.skills.find(s=>s.id===id).mastery.recycleValue;
    await frame.locator('[name="recycleQuantity"]').fill('2');
    await preview('recycle',id);
    const committed=gate();let used=false,lostBody,lostResult;
    const endpoint=api+'/app/api/expedition/action';
    const handler=async route=>{
      const body=route.request().postDataJSON();
      if(used||body.op!=='recycle'||body.skillId!==id)return route.continue();
      used=true;lostBody=body;
      try {
        const response=await route.fetch({maxRetries:0,timeout:15000});
        assert.equal(response.status(),200);lostResult=await response.json();assert.notEqual(lostResult.ok,false);
        await route.abort('failed');committed.resolve();
      } catch(error) { committed.reject(error);try{await route.abort('failed');}catch{} }
    };
    await page.route(endpoint,handler);
    try {
      await confirmationVisible();await btn('confirm').click();await deadline(committed.promise,'committed recycle with lost response');
      await frame.waitForFunction(()=>{
        const panel=document.querySelector('[data-sc-ready]');
        return document.querySelector('[data-sc-pending]')&&panel?.getAttribute('aria-busy')==='false'&&panel.dataset.scReady==='0';
      });
      assert.equal(await btn('acknowledge').isDisabled(),true,'unknown result needs a fresh read');
      assert.equal(writesFor(lostBody.requestId).length,1);
      await shot('390-unknown-committed-recycle');
    } finally { await page.unroute(endpoint,handler); }
    const committedState=await read();
    assert.equal(book(committedState,id),book(before,id)-2);
    assert.equal(quantity(committedState,'research_fragment'),quantity(before,'research_fragment')+2*recycleValue);
    assert.equal(level(committedState,id),level(before,id),'recycling preserves learned mastery');
    await frame.locator('.scene-window-close').click();await open('skills');
    assert.equal(await frame.locator('[data-sc-pending]').count(),1,'unknown survives closing/reopening');
    await choose(archer);await open('skills');await actorVisible(archer);
    assert.equal(await frame.locator('[data-sc-pending]').count(),0,'unknown operation belongs only to its character');
    await choose(sword);await open('skills');
    assert.equal(await frame.locator('[data-sc-pending]').count(),1,'returning to the same character keeps its unknown operation');
    assert.equal(await btn('acknowledge').isDisabled(),false,'fresh state allows explicit acknowledgement');
    const beforeAcknowledge=writes().length;
    await btn('acknowledge').click();await frame.locator('[data-sc-pending]').waitFor({state:'detached'});
    assert.equal(writes().length,beforeAcknowledge,'acknowledgement sends no gameplay write');
    assert.equal(writesFor(lostBody.requestId).length,1,'lost response recovery never repeats the original POST');
    const after=await read();
    assert.equal(book(after,id),book(committedState,id));
    assert.equal(quantity(after,'research_fragment'),quantity(committedState,'research_fragment'));
    evidence.injectedFaults.push({kind:'committed-response-aborted',action:'expedition/action',op:'recycle',
      requestId:lostBody.requestId,result:lostResult.result,originalPostCount:writesFor(lostBody.requestId).length});
    note('committed recycle loses its response; reopen, switch and acknowledgement only read state without resubmitting',
      {requestId:lostBody.requestId,booksSpent:2,fragmentsGained:2*recycleValue});
  }

  async function workflow() {
    await page.setViewportSize({width:390,height:844});await choose(sword);await open('skills');
    const initial=await read(),ids=[skillIds.first,skillIds.second,skillIds.third];
    assert.equal(initial.career.current.path,'A','workflow needs the fresh RPG_SKILL_CAREER_QA fixture');
    assert.equal(initial.character.level,60);assert.deepEqual(initial.special.learned,[]);
    assert(book(initial,skillIds.first)>=4&&ids.slice(1).every(id=>book(initial,id)>=1));
    assert(book(initial,skillIds.advanced)>=1&&book(initial,skillIds.otherBranch)>=1);
    assert.equal(quantity(initial,'mat_2'),1);assert.equal(quantity(initial,'reselect_2'),1);
    assert(initial.career.next.canAdvance&&!initial.eligible.includes(skillIds.otherBranch));
    evidence.initialSkillState=initial;
    await detail(skillIds.otherBranch);
    assert.equal(await btn('learn',skillIds.otherBranch).isDisabled(),true,'owned book does not bypass career eligibility');
    await detail(skillIds.first);const count=writes().length;
    await preview('learn',skillIds.first);await cancel();assert.equal(writes().length,count);
    await learn(skillIds.first);await learn(skillIds.first);
    await learn(skillIds.second);await learn(skillIds.third);
    note('learn and advance mastery consume the authoritative book cost; cancellation and ineligible books do not write');
    const equipped=[];
    for(const id of ids){equipped.push(id);await loadout('equip',id,[...equipped]);}
    await loadout('move-left',skillIds.third,[skillIds.first,skillIds.third,skillIds.second]);
    await loadout('move-right',skillIds.third,ids);
    await auto(skillIds.first,'ready');await auto(skillIds.second,'elite');await auto(skillIds.third,'lowHp');
    await shot('390-three-equipped-auto-skills');
    note('three real skills equip, reorder and retain their ready/elite/lowHp conditions');
    const removed=await loadout('remove',skillIds.third,[skillIds.first,skillIds.second]);
    assert.equal(removed.special.auto[skillIds.third],undefined);
    await loadout('equip',skillIds.third,ids);
    assert.equal(await frame.locator('[name="skillAuto"][data-skill-id='+q(skillIds.third)+']').inputValue(),'manual',
      're-equipping shows the saved manual state, not the old removed auto condition');
    await auto(skillIds.first,'manual');await auto(skillIds.first,'ready');
    await frame.locator('.scene-window-close').click();await open('skills');
    const persisted=await read();assert.deepEqual(persisted.special.loadout,ids);
    assert.equal(persisted.special.auto[skillIds.first],'ready');assert.equal(persisted.special.auto[skillIds.second],'elite');
    assert.equal(persisted.special.auto[skillIds.third],undefined);
    note('removing a skill clears its automatic condition; re-equip and reopen reflect saved state');
    const strong=await settings('strong',137);
    assert.deepEqual(strong.special.loadout,persisted.special.loadout);
    assert.deepEqual(strong.special.auto,persisted.special.auto);
    await frame.locator('.scene-window-close').click();await open('skills');
    assert.equal(await frame.locator('[name="skillMode"]').inputValue(),'strong');
    assert.equal(await frame.locator('[name="skillBudget"]').inputValue(),'137');
    await frame.locator('[data-sc-settings]').scrollIntoViewIfNeeded();await shot('390-skill-mode-budget');
    const safe=await settings('safe',0);
    assert.deepEqual(safe.special.loadout,persisted.special.loadout);
    assert.deepEqual(safe.special.auto,persisted.special.auto);
    note('original skill settings persist strong/137 and safe/0 through expedition/action without altering loadout or auto conditions');

    await lostRecycle();
    await detail(skillIds.second);
    const beforeRedeem=await read(),redeemCost=beforeRedeem.skills.find(s=>s.id===skillIds.second).researchCost;
    assert(Number.isFinite(redeemCost)&&redeemCost>0);
    await preview('redeem',skillIds.second);const redeemed=await confirm('expedition/action','redeem');
    assert.equal(book(redeemed.state,skillIds.second),book(beforeRedeem,skillIds.second)+1);
    assert.equal(quantity(redeemed.state,'research_fragment'),quantity(beforeRedeem,'research_fragment')-redeemCost);
    note('research redemption uses the server-provided cost and creates exactly one real book',{redeemCost});

    await open('career');const beforeAdvance=await read();
    await preview('advance',null,'[data-branch="1"][data-tier="2"]');
    const advanceCount=writeCount('advance');await cancel();assert.equal(writeCount('advance'),advanceCount);
    await preview('advance',null,'[data-branch="1"][data-tier="2"]');
    await shot('390-advance-confirmation');
    const advanced=await confirm('advance');
    assert.equal(advanced.state.career.current.path,'A1');
    assert.equal(quantity(advanced.state,'mat_2'),quantity(beforeAdvance,'mat_2')-1);
    assert(advanced.state.eligible.includes(skillIds.advanced));
    assert(!advanced.state.eligible.includes(skillIds.otherBranch));
    assert.equal(advanced.state.career.next.canAdvance,false);
    note('actual A-to-A1 advancement spends one material and immediately refreshes eligibility');

    await open('skills');await learn(skillIds.advanced);
    await loadout('remove',skillIds.third,[skillIds.first,skillIds.second]);
    await loadout('equip',skillIds.advanced,[skillIds.first,skillIds.second,skillIds.advanced]);
    await auto(skillIds.advanced,'ready');
    await open('career');const beforeReselect=await read();
    await preview('reselect',null,'[data-tier="2"][data-branch="2"]');
    const reselectCount=writeCount('reselect');await cancel();assert.equal(writeCount('reselect'),reselectCount);
    await preview('reselect',null,'[data-tier="2"][data-branch="2"]');
    const changed=await confirm('reselect');
    assert.equal(changed.state.career.current.path,'A2');
    assert.equal(quantity(changed.state,'reselect_2'),quantity(beforeReselect,'reselect_2')-1);
    assert(changed.state.career.reselect.cooldownRemainingMs>0);
    assert(changed.state.special.learned.includes(skillIds.advanced),'reselect preserves learned skill ownership');
    assert(!changed.state.eligible.includes(skillIds.advanced),'A1 skill becomes ineligible on A2');
    await open('skills');
    const invalid=frame.locator('.sc-slot').filter({has:frame.locator(sc('remove',skillIds.advanced))});
    assert.equal(await invalid.locator('[data-sc-ineligible]').count(),1);
    assert.equal(await invalid.locator('[name="skillAuto"]').isDisabled(),true);
    assert.equal(await invalid.locator(sc('cast',skillIds.advanced)).isDisabled(),true);
    await shot('390-reselected-ineligible-skill');
    const cleaned=await loadout('remove',skillIds.advanced,[skillIds.first,skillIds.second]);
    assert.equal(cleaned.special.auto[skillIds.advanced],undefined);
    note('A1-to-A2 reselect consumes one book, starts cooldown and safely exposes/removes an ineligible learned skill');

    await choose(archer);await open('career');const missing=await actorVisible(archer);
    assert.equal(missing.career.current.path,'A');assert.equal(missing.career.next.material.have,0);
    assert.equal(missing.career.next.canAdvance,false);
    assert.equal(await frame.locator(sc('advance')+':not(:disabled)').count(),0);
    assert(await frame.locator('[data-sc-advance-reason]').count());
    await shot('390-career-missing-material');
    await choose(sword);await open('career');evidence.finalSkillState=await read();
    await page.setViewportSize({width:1280,height:960});await geometry('final career');await shot('1280-career-complete');
    note('missing-material character stays blocked and carries none of the sword character mutations');
  }

  async function armRead() {
    return frame.evaluate(id=>{
      const transport=window.__SkillCareerQATransport;
      if(transport.armed)throw Error('A delayed read is already armed');
      transport.armed=id;return transport.sequence+1;
    },String(sword.charId));
  }
  async function lateRead(mode) {
    await choose(sword);await open('skills');await list();
    const marker='前一角色尚未送出的搜尋';
    await frame.locator('[name="skillSearch"]').fill(marker);
    const beforeA=await read(),oldContext=await context();
    const captured=gate(),processRead=gate(),responseReady=gate(),release=gate(),delivered=gate();
    releases.add(processRead.resolve);releases.add(release.resolve);
    let used=false,capturedStatus,capturedData;
    const endpoint=api+'/app/api/skill-career';
    const handler=async route=>{
      const body=route.request().postDataJSON();
      if(used||String(body.selectedCharacterId)!==String(sword.charId))return route.continue();
      used=true;captured.resolve();
      try {
        if(mode==='same-actor-error')await processRead.promise;
        const response=await route.fetch({maxRetries:0,timeout:15000});
        capturedStatus=response.status();capturedData=await response.json();responseReady.resolve();
        await release.promise;
        if(capturedStatus>=400)expectedHttp.add(route.request());
        await route.fulfill({response});delivered.resolve();
      } catch(error) {
        evidence.routeErrors.push({mode,message:error.message});
        captured.reject(error);responseReady.reject(error);delivered.reject(error);
        try{await route.abort('failed');}catch{}
      }
    };
    const serial=await armRead();await page.route(endpoint,handler);
    try {
      await refreshButton().click();await deadline(captured.promise,'capture '+mode);
      if(mode==='success') {
        await deadline(responseReady.promise,'old success response');
        assert.equal(capturedStatus,200);assert.equal(String(capturedData.characterId),String(sword.charId));
      }
      await choose(archer);await open('skills');const expectedB=await actorVisible(archer);
      assert.equal(await frame.locator('[name="skillSearch"]').inputValue(),'','new character clears old draft');
      if(mode==='same-actor-error') {
        processRead.resolve();await deadline(responseReady.promise,'real old-character conflict');
        assert.equal(capturedStatus,409);assert.equal(capturedData.error,'character_changed');
        await choose(sword);await open('skills');await list();
        assert((await context()).epoch>oldContext.epoch);
        await actorVisible(sword);
      }
      release.resolve();await deadline(delivered.promise,'deliver '+mode);
      await frame.waitForFunction(serial=>window.__SkillCareerQATransport.completed>=serial,serial);
      const expectedActor=mode==='success'?archer:sword;
      const after=await actorVisible(expectedActor);
      assert.equal(await frame.locator('[name="skillSearch"]').inputValue(),'');
      assert.equal(await frame.locator('[data-sc-pending]').count(),0);
      assert.equal(await frame.locator('.sc-feedback[role="alert"]').count(),0,'old response does not paint an error');
      assert.deepEqual(after.special.loadout,(mode==='success'?expectedB:beforeA).special.loadout);
      assert.equal(after.career.current.path,(mode==='success'?expectedB:beforeA).career.current.path);
      await single();await shot('1280-late-read-'+mode);
      evidence.injectedFaults.push({kind:'delayed-real-read',mode,status:capturedStatus,oldCharacterId:String(sword.charId),
        finalCharacterId:String(expectedActor.charId),oldEpoch:oldContext.epoch,newEpoch:(await context()).epoch,
        transport:'only one armed skill-career read ignores AbortSignal; request and response payloads are unchanged'});
      note(mode==='success'?'old successful skill read cannot paint the newly selected character':
        'a real delayed 409 from A survives A-to-B-to-A without clearing the newer A context');
    } finally {
      processRead.resolve();release.resolve();releases.delete(processRead.resolve);releases.delete(release.resolve);
      await page.unroute(endpoint,handler);
    }
  }

  try {
    evidence.sourceSHA256Before=await hashes();
    const health=await fetch(origin+'/__preview/health',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
    assert(health.isolated&&health.ephemeral&&health.productionAccess===false&&health.apiReady,'isolated preview must be ready');
    assert.equal(health.apiOrigin,api,'scene must use this exact isolated API');
    evidence.health=health;
    browser=await playwright().chromium.launch({channel:'chrome',headless:true,
      args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    evidence.browserVersion=browser.version();
    const browserContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
    await browserContext.addInitScript(()=>{
      const native=window.fetch;
      if(typeof native!=='function')return;
      const transport={armed:null,sequence:0,completed:0};
      Object.defineProperty(window,'__SkillCareerQATransport',{value:transport});
      window.fetch=function(input,init) {
        let body,url;
        try {url=String(input?.url||input);body=JSON.parse(init?.body||'{}');}catch{}
        if(transport.armed&&url?.endsWith('/app/api/skill-career')&&String(body?.selectedCharacterId)===transport.armed) {
          transport.armed=null;const serial=++transport.sequence,{signal,...options}=init||{};
          return native.call(this,input,options).then(response=>{
            const json=response.json.bind(response);
            response.json=async()=>{try{return await json();}finally{transport.completed=serial;}};
            return response;
          },error=>{transport.completed=serial;throw error;});
        }
        return native.call(this,input,init);
      };
    });
    page=await browserContext.newPage();page.setDefaultTimeout(15000);
    let mainNavigations=0;
    page.on('framenavigated',f=>{if(f===page.mainFrame())mainNavigations++;});
    page.on('pageerror',error=>evidence.pageErrors.push({message:error.message,stack:error.stack}));
    page.on('request',request=>{
      if(!request.url().startsWith(api+'/app/api/')||request.method()!=='POST')return;
      evidence.requests.push({action:request.url().slice((api+'/app/api/').length),body:request.postDataJSON(),at:new Date().toISOString()});
    });
    page.on('response',response=>{
      if(response.status()<400)return;
      const record={url:response.url(),status:response.status(),expected:expectedHttp.has(response.request())};
      evidence.httpErrors.push(record);if(!record.expected)unexpectedFailures.push(record);
    });
    await page.route('**/*',route=>{
      const value=route.request().url();
      if(value.startsWith(origin+'/')||value.startsWith(api+'/'))return route.continue();
      evidence.externalRequests.push(value);return route.abort('blockedbyclient');
    });
    await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
    frame=page.frames().find(f=>f.url().includes('/scene-bound-20261102/scene.html'));
    if(!frame)frame=await page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/scene-bound-20261102/scene.html'),timeout:30000});
    await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot()?.characterId,null,{timeout:30000});
    await frame.waitForFunction(()=>window.RpgSceneLiveView?.inspect?.()[0]?.characterVisible,null,{timeout:45000});
    const chars=(await call('characters')).characters;
    sword=chars.find(c=>c.baseClass==='sword');archer=chars.find(c=>c.baseClass==='archer');
    assert(sword&&archer,'two distinct fixture characters are required');assert.notEqual(sword.charId,archer.charId);
    evidence.characters={sword,archer};await choose(sword);
    const beforeOpen=writes().length;await open('skills');const initial=await read();
    assert.equal(initial.readOnly,false);assert.equal(writes().length,beforeOpen);
    assert.equal(await frame.locator('link[href*="scene-skills-ui.css"]').count(),1,'one skills stylesheet');
    note('the real scene opens the new pure-read projection without an expedition/me settlement call');
    for(const name of selected) {
      if(name==='layout')await layout();
      else if(name==='workflow')await workflow();
      else {await page.setViewportSize({width:1280,height:960});await lateRead('success');await lateRead('same-actor-error');}
    }
    assert.equal(mainNavigations,1,'no page reload is needed for any actor or panel change');
    assert.equal(requests().filter(r=>r.action==='expedition/me').length,0,'new UI never calls settling legacy skill read');
    assert.equal(requests().filter(r=>r.action==='atlas/settle').length,0,'no preview run should settle during skills-only acceptance');
    assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(unexpectedFailures,[]);assert.deepEqual(evidence.routeErrors,[]);
    evidence.sourceSHA256After=await hashes();
    assert.deepEqual(evidence.sourceSHA256After,evidence.sourceSHA256Before,'tested source files stay unchanged during this run');
    evidence.pageNavigations=mainNavigations;evidence.ok=true;
  } catch(error) {
    evidence.ok=false;evidence.error={message:error.message,stack:error.stack};process.exitCode=1;
    try { if(page)await shot('failure');if(frame)evidence.visibleText=await frame.locator('.scene-unified-dialog').innerText({timeout:2000}); } catch {}
  } finally {
    for(const release of releases)release();
    evidence.finishedAt=new Date().toISOString();
    evidence.requestCounts=Object.fromEntries([...new Set(requests().map(r=>r.action))].map(action=>[action,requests().filter(r=>r.action===action).length]));
    await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify({ok:evidence.ok,checks:evidence.checks.length,dir,error:evidence.error,
      pageErrors:evidence.pageErrors,httpErrors:evidence.httpErrors,routeErrors:evidence.routeErrors}));
    if(browser)await browser.close();
  }
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
