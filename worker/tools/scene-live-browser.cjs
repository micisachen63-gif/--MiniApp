const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
// Run against the dedicated ephemeral preview after scene-live-preview.mjs starts.
// Playwright may be installed separately; this tool never changes project dependencies.
const packageRoots=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,path.resolve('.release-sync/browser-tools/node_modules')].filter(Boolean);
let playwright;
for(const root of packageRoots){try{playwright=require(path.join(root,'playwright'));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}
if(!playwright)playwright=require('playwright');
const {chromium}=playwright;
const evidenceDir=path.resolve(process.env.SCENE_LIVE_QA_DIR||'.release-sync/scene-live-20261104');
const geometryOnly=process.argv.includes('--geometry-only');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await fs.mkdir(evidenceDir,{recursive:true});
 const health=await (await fetch('http://127.0.0.1:9653/__preview/health')).json();
 assert(health.isolated&&health.ephemeral&&health.productionAccess===false&&health.apiReady,'Start the isolated scene-live-preview.mjs on its default ports first');
 const executable=process.env.ATLAS_BROWSER_EXECUTABLE?{executablePath:process.env.ATLAS_BROWSER_EXECUTABLE}:{channel:'chrome'};
 const browser=await chromium.launch({...executable,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 const errors=[],badResponses=[],cases=[];
 page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
 page.on('response',r=>{if(r.status()>=400)badResponses.push({status:r.status(),url:r.url()});});
 let frame,characters;
 const call=(action,body={})=>frame.evaluate(({action,body})=>window.RpgSceneSession.request(action,body),{action,body});
 const state=()=>frame.evaluate(()=>window.RpgSceneSession.getSnapshot());
 const view=()=>frame.evaluate(()=>window.RpgSceneLiveView.inspect()[0]);
 async function ready(id){
  await frame.waitForFunction(id=>{const s=window.RpgSceneLiveView?.inspect?.()[0];return s?.characterId===id&&s.characterVisible&&s.actorIssue==='';},String(id),{timeout:45000});
 }
 async function assertGeometry(){
  await frame.waitForFunction(()=>{const g=window.RpgSceneLiveView?.inspect?.()[0]?.geometry,h=g?.hero?.screenBounds;if(!h||!g.hud)return false;return h.x>=-1&&h.right<=innerWidth+1&&h.y>=-1&&h.bottom<g.hud.y&&Math.abs(g.hero.screenAnchor.x-innerWidth/2)<2&&Math.abs(g.hero.screenAnchor.y-innerHeight/2)<2;},{},{timeout:10000});
  const g=(await view()).geometry;
  assert.equal(Math.round(g.camera.viewport.width),Math.round(g.canvas.width));
  assert.equal(Math.round(g.camera.viewport.height),Math.round(g.canvas.height));
  return g;
 }
 async function closeDialog(){
  const close=frame.locator('.scene-social-dialog header button');
  if(await close.count())await close.click();
 }
 async function choose(character){
  const current=await state();if(current.characterId===String(character.charId)){await closeDialog();return;}
  await frame.locator('[data-live-characters]').click();
  const button=frame.locator('.scene-social-body button').filter({hasText:character.name});
  await button.waitFor({state:'visible',timeout:15000});await button.click();
  await ready(character.charId);
 }
 async function inspectPanel(id,expected){
  await frame.evaluate(id=>window.UI.toggle(id),id);
  await frame.waitForFunction(text=>document.querySelector('.scene-social-body')?.innerText.includes(text),expected,{timeout:15000});
  const text=await frame.locator('.scene-social-body').innerText();
  assert(!text.includes('攻擊 1284'),'prototype equipment leaked');
  if(id==='eq'){
   const manage=frame.locator('.scene-social-body a').filter({hasText:'完整管理'});
   await manage.focus();await page.keyboard.press('Tab');
   assert(await frame.locator('.scene-social-dialog header button').evaluate(el=>document.activeElement===el),'dialog focus did not wrap from management link');
   await page.keyboard.press('Shift+Tab');
   assert(await manage.evaluate(el=>document.activeElement===el),'management link is unreachable from reverse focus trap');
  }
  await closeDialog();return text.slice(0,800);
 }
 try{
  await page.goto('http://127.0.0.1:9653/',{waitUntil:'domcontentloaded',timeout:30000});
  frame=await (await page.locator('#demo').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot?.(),{},{timeout:45000});
  characters=(await call('characters')).characters;
  assert.equal(characters.length,4);
  const leftover=await state();if(leftover.run?.active){await call('atlas/stop',{runId:leftover.run.id,requestId:crypto.randomUUID()});}

  for(const size of [{width:390,height:844},{width:1280,height:900}]){
   await page.setViewportSize(size);
   for(const character of (geometryOnly?characters.slice(0,1):characters)){
    const entry={width:size.width,class:character.baseClass,characterId:String(character.charId)};
    console.log(JSON.stringify({stage:'start-case',...entry}));
    await choose(character);await ready(character.charId);
    await frame.waitForFunction(()=>{const stage=document.querySelector('#stage'),canvas=document.querySelector('#game canvas');if(!stage||!canvas)return false;const a=stage.getBoundingClientRect(),b=canvas.getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1;},{},{timeout:10000});
    entry.geometry=await assertGeometry();
    let snapshot=await state(),actual=await view();
    assert.equal(actual.hp,snapshot.run?.active?snapshot.run.hero.hp:snapshot.live.hp);
    assert.equal(actual.mp,snapshot.run?.active?snapshot.run.hero.mp:snapshot.live.mp);
    assert.equal(actual.appearance,snapshot.character.appearanceKey);
    if(size.width===390){
     entry.equipment=await inspectPanel('eq','已穿戴裝備');
     assert(entry.equipment.includes('+7'),'real enhancement missing');
     entry.inventory=await inspectPanel('inv','道具與材料');
     entry.supplies=await inspectPanel('sup','背包補給');
     await frame.locator('[data-live-expedition]').click();
     const form=frame.locator('[data-guide-start]');
     await form.waitFor({state:'visible',timeout:15000});
     const mapIds=await form.locator('select[name=mapId] option').evaluateAll(nodes=>nodes.map(n=>n.value));
     assert(mapIds.every(id=>!/(expert|nightmare|hell|elite)-/.test(id)),'art-only map exposed as playable');
     await form.locator('[name=minutes]').fill('1');await form.locator('[name=hp]').fill('5');await form.locator('[name=mp]').fill('5');
     await form.locator('button').click();await frame.locator('[data-guide-confirm]').click();
     await frame.waitForFunction(()=>window.RpgSceneSession.getSnapshot()?.run?.active,{},{timeout:15000});
     await closeDialog();
     await frame.waitForFunction(()=>{const v=window.RpgSceneLiveView.inspect()[0];return v.mapReady&&v.mapIssue==='';},{},{timeout:30000});
     snapshot=await state();actual=await view();
     assert.equal(actual.activeRunId,snapshot.run.id);assert.equal(actual.mapId,snapshot.run.map.id);
     assert.equal(actual.hp,snapshot.run.hero.hp);assert.equal(actual.mp,snapshot.run.hero.mp);
     assert.equal(actual.enemies.length,snapshot.run.enemies.length,'renderer invented an initial enemy');
     const before=JSON.stringify(snapshot.run);
     await frame.evaluate(()=>window.RpgSceneSession.refresh());await sleep(13200);
     await frame.evaluate(()=>window.RpgSceneSession.refresh());
     assert.equal(JSON.stringify((await state()).run),before,'read-only sync advanced or changed committed combat');
     await frame.locator('[data-live-expedition]').click();
     await frame.locator('[data-guide-settle]').waitFor({state:'visible',timeout:15000});
     await frame.locator('[data-guide-settle]').click();
     await frame.waitForFunction(old=>window.RpgSceneSession.getSnapshot()?.run?.revision>old,snapshot.run.revision,{timeout:15000});
     await closeDialog();await sleep(300);
     const settled=await state();
     if(settled.run.enemies.some(e=>e.hp>0))await frame.waitForFunction(()=>window.RpgSceneLiveView.inspect()[0].spriteCount>0,{},{timeout:20000});
     const rendered=await view();assert(rendered.enemies.every(e=>e.mapped),'expected known monsters not mapped');
     assert(settled.run.processedSeconds>0);assert.equal(rendered.hp,settled.run.active?settled.run.hero.hp:settled.live.hp);
     entry.committed={runId:settled.run.id,revision:settled.run.revision,processedSeconds:settled.run.processedSeconds,kills:settled.run.report.kills,gold:settled.run.report.gold,exp:settled.run.report.exp};
     await assertGeometry();
     if(geometryOnly)for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
      await page.setViewportSize(viewport);const geometry=await assertGeometry();
      await page.screenshot({path:path.join(evidenceDir,viewport.width+'-expedition-camera-final.png'),fullPage:true});
      console.log(JSON.stringify({stage:'geometry',viewport,hero:geometry.hero.screenBounds,hud:geometry.hud}));
     }
     await page.screenshot({path:path.join(evidenceDir,'phone-'+character.baseClass+'-expedition.png'),fullPage:true});
     if(settled.run.active){
      await frame.locator('[data-live-expedition]').click();await frame.locator('[data-guide-stop]').waitFor({state:'visible',timeout:15000});
      await frame.locator('[data-guide-stop]').click();await frame.locator('[data-guide-confirm]').click();
      await frame.waitForFunction(()=>!window.RpgSceneSession.getSnapshot()?.run?.active,{},{timeout:15000});await closeDialog();
     }
     snapshot=await state();actual=await view();
     assert.equal(actual.activeRunId,null);assert.equal(actual.hp,snapshot.live.hp);assert.equal(actual.mp,snapshot.live.mp);assert.equal(actual.spriteCount,0);
     entry.returned={hp:actual.hp,mp:actual.mp,supplies:snapshot.live.supplies,status:snapshot.run.status};
    }
    await page.screenshot({path:path.join(evidenceDir,size.width+'-'+character.baseClass+'-camp.png'),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert(!overflow,'horizontal overflow');
    entry.passed=true;cases.push(entry);console.log(JSON.stringify({stage:'passed-case',width:size.width,class:character.baseClass}));
   }
  }
  await page.setViewportSize({width:390,height:844});await choose(characters[0]);
  const before=await state(),target=characters[1];
  const external=await fetch('http://127.0.0.1:9652/app/api/select',{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'90101','X-Realm-Id':'permanent'},body:JSON.stringify({charId:target.charId})});
  assert.equal(external.status,200);
  await frame.evaluate(()=>window.RpgSceneSession.refresh().catch(()=>null));
  await ready(target.charId);
  assert.notEqual((await state()).characterId,before.characterId);
  cases.push({name:'external-character-switch',passed:true});
  await choose(characters[0]);await ready(characters[0].charId);
  await page.screenshot({path:path.join(evidenceDir,'phone-final.png'),fullPage:true});
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(badResponses.filter(r=>r.status!==409).length,0,JSON.stringify(badResponses));
  console.log(JSON.stringify({stage:'finished',passed:cases.length,pageErrors:errors.length,badResponses}));
 }catch(error){
  const failure={message:error.message,stack:error.stack,current:frame?await frame.evaluate(()=>({snapshot:window.RpgSceneSession?.getSnapshot?.(),view:window.RpgSceneLiveView?.inspect?.(),body:document.body.innerText.slice(0,4000)})).catch(()=>null):null};
  cases.push({passed:false,failure});console.log(JSON.stringify({stage:'failed',failure}));
  await page.screenshot({path:path.join(evidenceDir,'flow-failure.png'),fullPage:true}).catch(()=>{});
  process.exitCode=1;
 }finally{
  await fs.writeFile(path.join(evidenceDir,geometryOnly?'browser-geometry-results.json':'browser-results.json'),JSON.stringify({mode:geometryOnly?'geometry':'full',cases,errors,badResponses},null,2));
  await browser.close();
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});