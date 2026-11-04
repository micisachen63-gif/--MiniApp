'use strict';
// Run only after the button-polish preview and CSS are ready:
// node worker/tools/button-polish-browser.cjs
// This harness uses disposable local data, permits read APIs plus synthetic /me,
// and blocks every mutation. It does not start/restart a server or install tools.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const origin = 'http://127.0.0.1:9703';
const api = 'http://127.0.0.1:9702';
const runName=process.env.BUTTON_POLISH_QA_RUN||'browser';
assert(/^[a-z0-9-]+$/.test(runName),'QA run name must be a simple directory name.');
const output = path.resolve('.release-sync/button-polish-20261104',runName);
const sizes = [{width:320,height:740},{width:390,height:844},{width:1280,height:900}];
const reads = new Set([
  'me','meta','characters','shop','atlas/status','atlas/catalog','atlas/quests',
  'atlas/talents','atlas/talents/preview','equipment-collection','equipment-collection/preview',
  'equipment-recovery','equipment-recovery/preview','background/status','auto-enhance/status',
  'auto-reroll/status','auto-reroll/options','forge/receipt','ledger','fate/gifts/summary','chat/state'
]);
const sourcePaths = [
  'worker/tools/button-polish-browser.cjs','worker/tools/scene-live-preview.mjs',
  'worker/public/scene-social-preview.css','worker/public/scene-window-manager.js'
];
const evidence = {
  startedAt:new Date().toISOString(),origin,api,viewports:sizes,
  scope:'Button/layout/navigation QA only; no gameplay mutations or chat sends.',
  checks:[],screenshots:[],apiRequests:[],blockedRequests:[],pageErrors:[],
  httpErrors:[],requestFailures:[],materials:[],sourceBefore:{},sourceAfter:{}
};
let browser, page, frame, size, currentCase;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const q = value => JSON.stringify(String(value));
const actionSelector = action => '[data-inv-action='+q(action)+']';
const overlap = (a,b) => !!(a&&b&&Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1);
const stylesDiffer = (a,b) => ['backgroundColor','backgroundImage','borderColor','boxShadow','transform','filter','color','opacity','paddingTop','paddingBottom','paddingLeft','paddingRight','beforeTransform','afterTransform','beforeTop','afterTop']
  .some(key => a[key]!==undefined&&b[key]!==undefined&&a[key]!==b[key]);

async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file,hash(await fs.readFile(file))])));
}
async function persist() {
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(evidence,null,2)+'\n');
}
function issue(kind,detail) {
  currentCase.issues.push({kind,...detail});
}
async function shot(name) {
  const filename = size.width+'-'+name+'.png';
  await page.screenshot({path:path.join(output,filename),fullPage:true});
  evidence.screenshots.push(filename);
  if(currentCase)currentCase.screenshots.push(filename);
}
async function check(name,run) {
  const record = {width:size.width,height:size.height,name,pass:false,issues:[],screenshots:[]};
  currentCase=record;evidence.checks.push(record);
  try { await run(record);record.pass=record.issues.length===0; }
  catch(error) {
    record.issues.push({kind:'interaction',message:error.message,stack:error.stack});
    try { await shot(name+'-failure'); } catch(capture) { record.captureError=capture.message; }
  }
  console.log(JSON.stringify({width:size.width,check:name,pass:record.pass,issues:record.issues.length}));
  await persist();currentCase=null;
}
async function enabled(selector) {
  await frame.waitForFunction(selector=>{
    const el=document.querySelector(selector);
    return el&&!el.disabled&&!el.closest('[inert]')&&el.getClientRects().length>0;
  },selector,{timeout:20000});
}
async function routeIs(route) {
  await frame.waitForFunction(route=>document.querySelector('.scene-unified-dialog')?.dataset.route===route,route);
}
async function primary(group) {
  await frame.locator('[data-scene-primary='+q(group)+']').click();
  await routeIs(group==='social'?'chat':group);
}
async function hub(group,route) {
  await primary(group);
  await frame.locator('[data-scene-route='+q(route)+']').click();
  await routeIs(route);
}
async function close() {
  if(await frame.locator('.scene-window-close').count())await frame.locator('.scene-window-close').click();
  await frame.waitForFunction(()=>!document.querySelector('.scene-unified-dialog'));
}
async function settled() {
  await frame.evaluate(async()=>{
    await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
}
async function heroReady() {
  try {
    await frame.waitForFunction(()=>{
      const value=window.RpgSceneLiveView?.inspect?.()[0];
      return value?.characterVisible&&value.actorIssue===''&&(!value.mapId||value.mapReady)&&!value.mapIssue&&value.assetIssues.length===0;
    },{}, {timeout:45000});
  } catch(error) {
    const state=await frame.evaluate(()=>window.RpgSceneLiveView?.inspect?.()[0]||null);
    evidence.renderFailures ||= [];evidence.renderFailures.push({width:size.width,state});
    try { await shot('render-readiness-failure'); } catch {}
    throw new Error('Scene art did not become ready: '+JSON.stringify({actorIssue:state?.actorIssue,mapIssue:state?.mapIssue,assetIssues:state?.assetIssues}),{cause:error});
  }
}
async function inventoryReady() {
  await enabled(actionSelector('refresh'));
  await frame.waitForFunction(()=>getComputedStyle(document.querySelector('.si-summary')).display==='flex');
}
async function buttonStyle(locator) {
  return locator.evaluate(el=>{
    const s=getComputedStyle(el);
    const result=Object.fromEntries(['backgroundColor','backgroundImage','borderColor','boxShadow','transform','filter','color','opacity','outlineStyle','outlineWidth','outlineOffset','borderRadius','paddingTop','paddingBottom','paddingLeft','paddingRight'].map(key=>[key,s[key]]));
    for(const part of ['before','after']){const pseudo=getComputedStyle(el,'::'+part);result[part+'Transform']=pseudo.transform;result[part+'Top']=pseudo.top;}
    return result;
  });
}
async function selected(selector,attribute,value) {
  const locator=frame.locator(selector);
  assert.equal(await locator.getAttribute(attribute),value);
  await page.waitForTimeout(160);
  const chosen=await buttonStyle(locator);
  const sibling=await locator.evaluate((el,{attribute,value})=>{
    const other=[...el.parentElement.querySelectorAll('button')].find(node=>node!==el&&node.getAttribute(attribute)!==value);
    if(!other)return null;
    const s=getComputedStyle(other);
    return Object.fromEntries(['backgroundColor','backgroundImage','borderColor','boxShadow','transform','filter','color','opacity'].map(k=>[k,s[k]]));
  },{attribute,value});
  if(sibling&&!stylesDiffer(chosen,sibling))issue('selected-style',{selector,message:'Selected and unselected controls have identical computed visual styles.'});
  currentCase.states ||= [];currentCase.states.push({kind:'selected',selector,attribute,value,style:chosen});
}
async function disabled(selector) {
  const locator=frame.locator(selector);
  assert(await locator.isDisabled(),selector+' must represent a genuine disabled state');
  const detail=await locator.evaluate(el=>{
    const old=document.activeElement;el.focus({preventScroll:true});
    const focused=document.activeElement===el;if(old&&old!==el)old.focus({preventScroll:true});
    const s=getComputedStyle(el);
    return {focused,opacity:s.opacity,cursor:s.cursor,filter:s.filter,color:s.color,background:s.backgroundImage};
  });
  assert(!detail.focused,'disabled native button must not receive focus');
  if(Number(detail.opacity)>=1&&detail.filter==='none'&&!/default|not-allowed/.test(detail.cursor))
    issue('disabled-style',{selector,message:'Disabled control has no opacity/filter/cursor distinction.',detail});
  currentCase.states ||= [];currentCase.states.push({kind:'disabled',selector,...detail});
}
async function pressed(selector) {
  const locator=frame.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();await page.waitForTimeout(140);
  const before=await buttonStyle(locator);
  const b=await locator.boundingBox();assert(b);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
  await page.mouse.down();
  let during;
  try {
    await page.waitForTimeout(140);
    assert(await locator.evaluate(el=>el.matches(':active')),selector+' must enter :active');
    during=await buttonStyle(locator);
    await shot('pressed-navigation');
  } finally {
    // Mouse-up away from the control does not activate its action.
    await page.mouse.move(1,1);await page.mouse.up();
  }
  if(!stylesDiffer(before,during))issue('pressed-style',{selector,message:'Pointer-down has no computed visual response.',before,during});
  currentCase.states ||= [];currentCase.states.push({kind:'pressed',selector,before,during});
}
async function keyboardTrap() {
  const last=frame.locator('[data-scene-primary="social"]');
  await last.focus();await page.keyboard.press('Tab');
  assert(await frame.locator('.scene-window-back').evaluate(el=>document.activeElement===el),'Tab must wrap to the first window control');
  const focus=await frame.locator('.scene-window-back').evaluate(el=>{
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return {visible:el.matches(':focus-visible'),outlineStyle:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),outlineColor:s.outlineColor,
      rect:{x:r.x,y:r.y,width:r.width,height:r.height},pointTarget:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el};
  });
  assert(focus.visible&&focus.outlineStyle!=='none'&&focus.outlineWidth>=1,'Keyboard focus must be visibly outlined');
  assert(focus.pointTarget,'Focused header button must not be obscured');
  currentCase.states ||= [];currentCase.states.push({kind:'keyboard-focus',...focus});
  await shot('keyboard-focus');
  await page.keyboard.press('Shift+Tab');
  assert(await last.evaluate(el=>document.activeElement===el),'Shift+Tab must wrap to the last window control');
}

async function measure(label,{battle=false}={}) {
  if(battle)await heroReady();
  await settled();
  const metrics=await frame.evaluate(()=>{
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const visible=el=>{
      const s=getComputedStyle(el);
      return el.getClientRects().length>0&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('[hidden],[inert]')&&(!el.checkVisibility||el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
    };
    const name=el=>el.getAttribute('aria-label')||el.textContent.replace(/\s+/g,' ').trim().slice(0,150);
    const identify=el=>{
      const attrs=[...el.attributes].filter(a=>a.name.startsWith('data-')||a.name==='name').map(a=>a.name+'='+JSON.stringify(a.value));
      return el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className?'.'+String(el.className).trim().replace(/\s+/g,'.'):'')+(attrs.length?'['+attrs.join(' ')+']':'');
    };
    const textClips=el=>{
      const r=el.getBoundingClientRect(),out=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      for(let node=walker.nextNode();node;node=walker.nextNode()){
        if(!node.textContent.trim()||!visible(node.parentElement))continue;
        const range=document.createRange();range.selectNodeContents(node);
        const bad=[...range.getClientRects()].filter(x=>x.width&&x.height&&(x.left<r.left-1.5||x.right>r.right+1.5||x.top<r.top-1.5||x.bottom>r.bottom+1.5));
        if(bad.length)out.push({text:node.textContent.trim().slice(0,120),rects:bad.map(x=>({x:x.x,y:x.y,width:x.width,height:x.height}))});
      }
      return out;
    };
    const buttons=[...document.querySelectorAll('#ui button,#ui [role="button"]')].filter(visible).map(el=>{
      const r=rect(el),s=getComputedStyle(el),body=el.closest('.scene-social-body'),clip=body?.getBoundingClientRect();
      const entirelyVisible=r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&(!clip||(r.y>=clip.top&&r.bottom<=clip.bottom));
      const target=entirelyVisible?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;
      return {selector:identify(el),label:name(el),rect:r,disabled:!!el.disabled,
        style:{fontSize:s.fontSize,lineHeight:s.lineHeight,borderRadius:s.borderRadius,boxShadow:s.boxShadow,padding:s.padding,opacity:s.opacity},
        textClips:textClips(el),obscured:entirelyVisible&&!el.contains(target),obscuredBy:target?identify(target):null,entirelyVisible,
        horizontalOverflow:el.scrollWidth>el.clientWidth+1};
    });
    const hitLabels=[...document.querySelectorAll('.si-select,.sw-scroll-modes label,.sw-toggle,.sw-ack,.recovery-ack,.gearbook-ack')].filter(visible)
      .map(el=>({selector:identify(el),label:name(el),rect:rect(el)}));
    const card=document.querySelector('.scene-unified-dialog .scene-social-card'),header=card?.querySelector(':scope>header');
    return {
      viewport:{width:innerWidth,height:innerHeight},
      page:{width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight},
      nav:rect(document.querySelector('.scene-primary-nav')),hud:rect(document.getElementById('bottom')),
      card:rect(card),body:rect(document.querySelector('.scene-social-body')),
      header:header?[...header.children].map(el=>({tag:el.tagName,label:name(el),rect:rect(el)})):[],
      buttons,hitLabels,
      bodyOverflow:(()=>{const b=document.querySelector('.scene-social-body');return b?{clientWidth:b.clientWidth,scrollWidth:b.scrollWidth}:null;})()
    };
  });
  const outer=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
  currentCase.measurements ||= [];currentCase.measurements.push({label,...metrics,outer});
  if(metrics.viewport.width!==size.width||metrics.viewport.height!==size.height)
    issue('viewport',{label,expected:size,actual:metrics.viewport});
  for(const [name,p] of [['scene',metrics.page],['wrapper',outer]]) {
    if(p.scrollWidth>p.width+2)issue('page-overflow',{label,surface:name,axis:'horizontal',...p});
    if(p.scrollHeight>p.height+2)issue('page-overflow',{label,surface:name,axis:'vertical',...p});
  }
  if(metrics.bodyOverflow?.scrollWidth>metrics.bodyOverflow?.clientWidth+2)
    issue('body-overflow',{label,...metrics.bodyOverflow});
  for(const button of metrics.buttons) {
    if(button.rect.width<43.5||button.rect.height<43.5)issue('small-button',{label,control:button.selector,text:button.label,width:button.rect.width,height:button.rect.height,minimum:44});
    if(button.textClips.length)issue('button-label-clipped',{label,control:button.selector,text:button.label,clips:button.textClips});
    // scrollWidth also includes ornamental pseudo-elements and the original image HUD.
    // Text ranges plus page/body overflow are the clipping gates; retain scrollWidth as a diagnostic.
    if(button.obscured)issue('obscured-button',{label,control:button.selector,text:button.label,rect:button.rect,obscuredBy:button.obscuredBy});
    if(button.rect.x<-.5||button.rect.right>metrics.viewport.width+.5)
      issue('button-outside-width',{label,control:button.selector,text:button.label,rect:button.rect});
  }
  for(const hit of metrics.hitLabels)if(hit.rect.width<43.5||hit.rect.height<43.5)
    issue('small-choice-target',{label,control:hit.selector,text:hit.label,width:hit.rect.width,height:hit.rect.height,minimum:44});
  if(battle&&overlap(metrics.hud,metrics.nav))issue('hud-navigation-overlap',{label,hud:metrics.hud,nav:metrics.nav});
  if(metrics.card) {
    if(overlap(metrics.card,metrics.nav))issue('window-navigation-overlap',{label,card:metrics.card,nav:metrics.nav});
    if(metrics.card.x<-.5||metrics.card.right>metrics.viewport.width+.5||metrics.card.y<-.5||metrics.card.bottom>metrics.viewport.height+.5)
      issue('window-outside-viewport',{label,card:metrics.card});
    for(let i=0;i<metrics.header.length;i++)for(let j=i+1;j<metrics.header.length;j++)
      if(overlap(metrics.header[i].rect,metrics.header[j].rect))
        issue('header-overlap',{label,first:metrics.header[i],second:metrics.header[j]});
  }
  await shot(label);
}

async function exerciseViewport(context) {
  page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>evidence.pageErrors.push({width:size.width,message:error.message,stack:error.stack}));
  page.on('requestfailed',request=>evidence.requestFailures.push({width:size.width,url:request.url(),method:request.method(),resourceType:request.resourceType(),error:request.failure()?.errorText}));
  const materialReads=[];
  page.on('response',response=>{
    const url=new URL(response.url());
    if(response.status()>=400)evidence.httpErrors.push({width:size.width,url:response.url(),status:response.status()});
    if(url.origin===origin&&url.pathname.startsWith('/ui/button-materials/'))materialReads.push((async()=>{
      const body=await response.body();
      evidence.materials.push({width:size.width,url:response.url(),status:response.status(),type:response.headers()['content-type'],bytes:body.length,sha256:hash(body)});
    })().catch(error=>evidence.materials.push({width:size.width,url:response.url(),error:error.message})));
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    if(url.origin===api&&url.pathname.startsWith('/app/api/')) {
      if(method==='OPTIONS')return route.continue();
      const action=url.pathname.slice('/app/api/'.length);
      evidence.apiRequests.push({width:size.width,action,method});
      if(method==='POST'&&reads.has(action)&&request.headers()['x-dev-tg-id']==='90101')return route.continue();
      evidence.blockedRequests.push({width:size.width,action,method,url:request.url()});
      return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'button_qa_read_only',message:'Button QA blocks gameplay writes.'})});
    }
    if(!['GET','HEAD','OPTIONS'].includes(method)) {
      evidence.blockedRequests.push({width:size.width,method,url:request.url()});
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  try {
    await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
    await page.locator('#demo').waitFor();
    frame=await (await page.locator('#demo').elementHandle()).contentFrame();
    assert(frame,'existing scene iframe');
    await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot()?.characterId,{}, {timeout:45000});
    const contextInfo=await frame.evaluate(()=>window.RpgSceneSession.getContext());
    assert.equal(String(contextInfo.accountId),'90101','only disposable preview account');
    assert.equal(contextInfo.realmId,'permanent');
    const snapshot=await frame.evaluate(()=>window.RpgSceneSession.getSnapshot());
    assert(!snapshot.run?.active,'Use a fresh idle fixture; this harness will not stop or settle a run.');
    const me=await frame.evaluate(()=>window.RpgSceneSession.request('me'));
    assert(me.equipment.some(item=>String(item.id).startsWith('recovery-fixture:')),'synthetic equipment fixtures must be present');
    const valuable=me.equipment.find(item=>String(item.id).startsWith('collection-fixture:')&&item.slot==='weapon');
    assert(valuable&&valuable.enhance===4,'known synthetic +4 item for harmless confirmation-state inspection');
    await heroReady();
    evidence.contexts ||= [];evidence.contexts.push({width:size.width,...contextInfo});

    await check('battle',async()=>{
      assert.equal(await frame.locator('[data-scene-primary]').count(),5);
      assert.deepEqual(await frame.locator('[data-scene-primary]').evaluateAll(nodes=>nodes.map(el=>el.textContent)),['角色','背包','冒險','營地','社交']);
      await measure('battle',{battle:true});
      await pressed('[data-scene-primary="character"]');
    });
    await check('character-and-keyboard',async()=>{
      await primary('character');
      await frame.locator('[data-scene-route="equipment"]').waitFor();
      assert.equal(await frame.locator('.scene-unified-dialog').count(),1);
      await selected('[data-scene-primary="character"]','aria-current','page');
      await measure('character');
      await keyboardTrap();
      await page.keyboard.press('Escape');
      await frame.waitForFunction(()=>!document.querySelector('.scene-unified-dialog'));
      assert(await frame.locator('[data-scene-primary="character"]').evaluate(el=>document.activeElement===el),'closing restores the primary trigger focus');
    });
    await check('equipment',async()=>{
      await hub('character','equipment');await inventoryReady();
      await measure('equipment');
      await frame.locator('.scene-window-back').click();await routeIs('character');
    });
    await check('inventory-and-valuable-confirmation',async()=>{
      await primary('inventory');await inventoryReady();
      await selected('[data-scene-primary="inventory"]','aria-current','page');
      await frame.locator('[name="inventoryCategory"]').selectOption('equipment');
      await measure('inventory');
      const item=frame.locator('[data-inv-action="detail"][data-item-id='+q(valuable.id)+']');
      await item.click();await routeIs('item');await inventoryReady();
      await frame.locator('.si-detail-actions').scrollIntoViewIfNeeded();
      await measure('item-actions');
      await frame.locator(actionSelector('preview-sell')).click();
      await frame.locator('[name="inventoryPreciousAck"]').waitFor();
      await disabled(actionSelector('confirm'));
      await measure('valuable-confirmation-disabled');
      await frame.locator('[name="inventoryPreciousAck"]').check();
      assert(!(await frame.locator(actionSelector('confirm')).isDisabled()));
      await frame.locator(actionSelector('cancel')).click();
      assert.equal(await frame.locator('[data-inv-confirm]').count(),0);
    });
    await check('workshop-options',async()=>{
      await hub('camp','workshop');await enabled('[data-sw-refresh]');
      await selected('[data-scene-primary="camp"]','aria-current','page');
      await selected('[data-sw-tab="enhance"]','aria-pressed','true');
      await measure('workshop-enhance');
      await frame.locator('[data-sw-tab="reroll"]').click();
      await selected('[data-sw-tab="reroll"]','aria-pressed','true');
      await measure('workshop-reroll');
    });
    await check('shop-and-preview',async()=>{
      await hub('camp','shop');await enabled('[data-supply-refresh]');
      await frame.locator('[data-supply-buy="item:red_1"]').waitFor();
      await selected('[data-supply-route="shop"]','aria-current','page');
      await measure('shop');
      await frame.locator('[data-supply-buy="item:red_1"]').click();
      await frame.locator('[data-supply-confirm]').waitFor();
      await measure('shop-confirmation');
      await frame.locator('[data-supply-cancel]').click();
      assert.equal(await frame.locator('[data-supply-confirm]').count(),0);
    });
    await check('recovery-tabs',async()=>{
      await hub('camp','recovery');await enabled('[data-recovery-refresh]');
      await selected('[data-recovery-mode="archive"]','aria-pressed','true');
      await disabled('[data-recovery-preview]');
      await measure('recovery-archive');
      await frame.locator('[data-recovery-mode="salvage"]').click();
      await selected('[data-recovery-mode="salvage"]','aria-pressed','true');
      await measure('recovery-salvage');
    });
    await check('legacy-collection',async()=>{
      await hub('camp','gearbook');await enabled('[data-gearbook-refresh]');
      await frame.locator('.gearbook-grid').waitFor();
      await disabled('[data-gearbook-page="-1"]');
      await measure('gearbook');
    });
    await check('expedition-preview',async()=>{
      await hub('adventure','expedition');
      await frame.locator('[data-guide-start]').waitFor();await enabled('[data-guide-refresh]');
      await selected('[data-scene-primary="adventure"]','aria-current','page');
      await measure('expedition');
      await frame.locator('[data-guide-start] button').click();
      await frame.locator('[data-guide-confirm]').waitFor();
      await measure('expedition-confirmation');
      await page.keyboard.press('Escape');
      assert.equal(await frame.locator('[data-guide-confirm]').count(),0);
      await frame.locator('[data-guide-start]').waitFor();
    });
    await check('social-tabs-and-disabled',async()=>{
      await primary('social');await frame.locator('.scene-chat-panel').waitFor();
      await selected('[data-scene-primary="social"]','aria-current','page');
      await frame.locator('.scene-chat-tabs [data-channel="world"]').click();
      await selected('.scene-chat-tabs [data-channel="world"]','aria-selected','true');
      await measure('social-world');
      await frame.locator('.scene-chat-tabs [data-channel="guild"]').click();
      await selected('.scene-chat-tabs [data-channel="guild"]','aria-selected','true');
      await disabled('.scene-chat-compose [type="submit"]');
      await measure('social-disabled');
      await close();
      await measure('battle-after-windows',{battle:true});
    });
  } finally {
    await Promise.allSettled(materialReads);
    await page.close();
  }
}

(async()=>{
  await fs.mkdir(output,{recursive:true});
  evidence.sourceBefore=await sourceHashes();
  const health=await fetch(origin+'/__preview/health',{signal:AbortSignal.timeout(10000)}).then(response=>response.json());
  assert(health.isolated&&health.ephemeral&&health.productionAccess===false&&health.apiReady,'New isolated preview must already be ready.');
  assert.equal(health.sceneOrigin,origin);assert.equal(health.apiOrigin,api);
  const apiHealth=await fetch(api+'/__preview/health',{signal:AbortSignal.timeout(10000)}).then(response=>response.json());
  assert(apiHealth.isolated&&apiHealth.ephemeral&&apiHealth.productionAccess===false,'API must use disposable local data.');
  evidence.health={scene:health,api:apiHealth};
  const playwrightRoot=process.env.BUTTON_PLAYWRIGHT_NODE_MODULES||path.resolve('.release-sync/browser-tools/node_modules');
  const {chromium}=require(path.join(playwrightRoot,'playwright'));
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const viewport of sizes) {
    size=viewport;
    const context=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block'});
    try { await exerciseViewport(context); }
    catch(error) {
      evidence.checks.push({width:size.width,height:size.height,name:'viewport-setup',pass:false,issues:[{kind:'setup',message:error.message,stack:error.stack}]});
      console.error(JSON.stringify({width:size.width,setupError:error.message}));
    } finally { await context.close();await persist(); }
  }
  evidence.sourceAfter=await sourceHashes();
  evidence.sourceStable=JSON.stringify(evidence.sourceBefore)===JSON.stringify(evidence.sourceAfter);
  const uniqueMaterials=[...new Set(evidence.materials.filter(asset=>asset.status===200&&asset.bytes>0).map(asset=>asset.url))];
  const failedAssets=evidence.requestFailures.filter(request=>['image','stylesheet','script','font'].includes(request.resourceType)&&request.error!=='net::ERR_ABORTED');
  evidence.summary={
    cases:evidence.checks.length,passed:evidence.checks.filter(check=>check.pass).length,
    failed:evidence.checks.filter(check=>!check.pass).length,
    blockedWrites:evidence.blockedRequests.length,pageErrors:evidence.pageErrors.length,
    httpErrors:evidence.httpErrors.length,failedAssets:failedAssets.length,materials:uniqueMaterials.length,sourceStable:evidence.sourceStable
  };
  evidence.pass=evidence.summary.failed===0&&evidence.blockedRequests.length===0&&evidence.pageErrors.length===0&&evidence.httpErrors.length===0&&failedAssets.length===0&&uniqueMaterials.length>=2&&evidence.sourceStable;
  if(!evidence.pass)process.exitCode=1;
  console.log(JSON.stringify({pass:evidence.pass,...evidence.summary,output}));
})().catch(error=>{
  evidence.fatal={message:error.message,stack:error.stack};evidence.pass=false;process.exitCode=1;
  console.error(error.stack||error.message);
}).finally(async()=>{
  evidence.finishedAt=new Date().toISOString();
  try { await browser?.close(); } finally { await persist(); }
});
