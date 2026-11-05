// Local real-receipt VFX QA. It never writes outside the disposable preview API.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const roots=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,path.resolve('.release-sync/browser-tools/node_modules')].filter(Boolean);
let playwright;for(const root of roots){try{playwright=require(path.join(root,'playwright'));break;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}}
if(!playwright)playwright=require('playwright');
const args=process.argv.slice(2);if(args.some(a=>!/^--(?:smoke|inspect-only|phone|build=[a-z_]+)$/.test(a)))throw Error('Use [--smoke] [--inspect-only] [--build=atlas_build_id] [--phone]');
const phone=args.includes('--phone');
const inspectOnly=args.includes('--inspect-only'),smoke=args.includes('--smoke'),chosen=args.find(a=>a.startsWith('--build='))?.slice(8);
const sceneOrigin=process.env.SKILL_VFX_SCENE_ORIGIN||'http://127.0.0.1:9667',apiOrigin=process.env.SKILL_VFX_API_ORIGIN||'http://127.0.0.1:9666';
for(const [value,ports]of [[sceneOrigin,['9667','9867']],[apiOrigin,['9666','9866']]]){const url=new URL(value);assert(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&ports.includes(url.port)&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password,'Only explicit isolated loopback VFX previews are allowed');}
const evidenceDir=path.resolve(process.env.SKILL_VFX_LIVE_QA_DIR||'.release-sync/skill-vfx-20261104/live-'+new Date().toISOString().replace(/[:.]/g,'-'));
const builds=['sword_whirlwind','sword_bleed','sword_counter','archer_pierce','archer_beast','archer_trap','mage_chain','mage_frost','mage_arcane','thief_poison','thief_execute','thief_combo'];
if(chosen&&!builds.includes(chosen))throw Error('Unknown Atlas build');
if(phone&&!chosen)throw Error('--phone requires --build to select one focused case');
const passive={sword_bleed:'dot',archer_beast:'pet',archer_trap:'trap',thief_poison:'dot'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sourcePaths=[
 'worker/src/game/atlas-engine.js','worker/src/game/atlas-combat-observer.js','worker/src/game/atlas-catalog.js','worker/src/game/atlas-talents.js','worker/src/services/atlas.js',
 'worker/public/scene-live-session.js','worker/public/scene-live-view.js','worker/public/scene-live-view.css',
 'worker/public/skill-vfx-engine.mjs', 'worker/public/skill-vfx-semantics.mjs', 'worker/public/art/skill-vfx-20261104/semantic-atlas.webp','worker/public/skill-vfx-combat-adapter.mjs','worker/public/skill-vfx-actor-bridge.mjs',
 'worker/public/skill-vfx-catalog.json','worker/public/skill-vfx-recipes.json','worker/public/skill-vfx-actor-profiles.json',
 'worker/tools/skill-vfx-live-browser.cjs'
];
async function sourceFingerprints(){const rows=[];for(const file of sourcePaths){const bytes=await fs.readFile(file);rows.push({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}return rows;}
(async()=>{
 await fs.mkdir(evidenceDir,{recursive:true});
 const sourceFiles=await sourceFingerprints();
 const health=await(await fetch(sceneOrigin+'/__preview/health')).json(),apiHealth=await(await fetch(apiOrigin+'/__preview/health')).json();
 assert(health.isolated&&health.ephemeral&&health.productionAccess===false&&health.apiReady&&health.apiOrigin===apiOrigin,'Only the matching isolated VFX preview is allowed');
 assert(apiHealth.isolated&&apiHealth.ephemeral&&apiHealth.productionAccess===false);
 if(!inspectOnly)assert.equal(apiHealth.vfxFixture,'long-targets','Start scene-live-preview with --vfx-fixture=long-targets for reproducible live targets');
 const browser=await playwright.chromium.launch({...process.env.ATLAS_BROWSER_EXECUTABLE?{executablePath:process.env.ATLAS_BROWSER_EXECUTABLE}:{channel:'chrome'},headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 const errors=[],badResponses=[],cases=[],receipts=[];
 page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));page.on('response',r=>{if(r.status()>=400)badResponses.push({status:r.status(),url:r.url()});});
 let frame,currentRun=null;
 const call=(action,body={})=>frame.evaluate(({action,body})=>window.RpgSceneSession.request(action,body),{action,body});
 const state=()=>frame.evaluate(()=>window.RpgSceneSession.getSnapshot());
 const view=()=>frame.evaluate(()=>window.RpgSceneLiveView.inspect()[0]);
 async function ready(id){await frame.waitForFunction(id=>{const v=window.RpgSceneLiveView?.inspect?.()[0];return v?.characterId===id&&v.characterVisible&&v.actorIssue==='';},String(id),{timeout:45000});}
 async function stop(){const s=await state();if(s.run?.active)await call('atlas/stop',{runId:s.run.id,requestId:crypto.randomUUID()});currentRun=null;}
 try{
  await page.goto(sceneOrigin+'/',{waitUntil:'domcontentloaded',timeout:30000});
  frame=await(await page.locator('#demo').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>window.RpgSceneSession?.getSnapshot?.()&&window.RpgSceneLiveView?.inspect?.().length,{},{timeout:45000});
  const characters=(await call('characters')).characters;assert.equal(characters.length,4);
  await ready((await state()).characterId);
  if(inspectOnly){cases.push({name:'initial-inspection',passed:true,snapshot:await state(),view:await view()});await page.screenshot({path:path.join(evidenceDir,'initial-scene.png'),fullPage:true});return;}
  await frame.waitForFunction(()=>window.RpgSceneLiveView.inspect()[0]?.vfx?.ready,{},{timeout:45000});
  const attachQa=()=>frame.evaluate(()=>{
   window.__skillVfxQa={traces:[],samples:[]};
   window.RpgSceneSession.subscribeCombatTrace((trace,scene)=>{window.__skillVfxQa.traces.push({trace,sceneRevision:scene?.run?.revision,receivedAt:Date.now()});});
   window.__skillVfxQa.timer=setInterval(()=>{const v=window.RpgSceneLiveView.inspect()[0];if(v?.vfx?.activeCast||v?.vfx?.player?.active){const q=window.__skillVfxQa.samples;q.push({at:Date.now(),actor:v.actorAnimation,vfx:v.vfx});if(q.length>600)q.shift();}},40);
  });
  await attachQa();
  await stop();
  const selected=chosen?[chosen]:smoke?builds.slice(0,1):builds;
  const plan=selected.map(build=>({build,width:phone?390:1280,height:phone?844:900}));
  if(!chosen&&!smoke)for(const build of ['sword_whirlwind','archer_beast','mage_chain','thief_combo'])plan.push({build,width:390,height:844});
  let priorWidth=1280;
  for(const item of plan){
   const char=characters.find(c=>c.baseClass===item.build.split('_')[0]);assert(char);
   await page.setViewportSize({width:item.width,height:item.height});
   if(item.width!==priorWidth){
    await page.reload({waitUntil:'domcontentloaded'});
    frame=await(await page.locator('#demo').elementHandle()).contentFrame();
    await frame.waitForFunction(()=>window.RpgSceneLiveView?.inspect?.()[0]?.vfx?.ready,{},{timeout:45000});
    await attachQa();
   }
   priorWidth=item.width;
   if((await state()).characterId!==String(char.charId))await frame.evaluate(id=>window.RpgSceneSession.selectCharacter(id),String(char.charId));
   await ready(char.charId);await stop();
   await call('atlas/configure',{buildId:item.build,supportIds:['economy'],automation:'burst',requestId:crypto.randomUUID()});
   const started=await call('atlas/start',{mapId:'laurel_intro',queueMode:'duration',durationMinutes:2,supplies:{hp:40,mp:40},requestId:crypto.randomUUID()});
   currentRun=(await state()).run.id;
   const foregroundAuto=!chosen&&!smoke&&cases.length===0;
   const entry={...item,trigger:foregroundAuto?'foreground-auto':'explicit-settle',characterId:String(char.charId),runId:currentRun,startedAt:new Date().toISOString(),casts:[],effects:[],traceCount:0};
   console.log(JSON.stringify({stage:'start-live-case',build:item.build,width:item.width,runId:currentRun}));
   const beforeRead=JSON.stringify((await state()).run),traceBefore=await frame.evaluate(()=>window.__skillVfxQa.traces.length);
   await frame.evaluate(()=>window.RpgSceneSession.refresh());
   assert.equal(JSON.stringify((await state()).run),beforeRead,'Read-only refresh changed combat');
   assert.equal(await frame.evaluate(()=>window.__skillVfxQa.traces.length),traceBefore,'Read-only refresh replayed combat trace');
   entry.panel=await frame.evaluate(()=>{const panel=document.querySelector('#scene-live-status');return {collapsed:panel?.dataset.collapsed,expanded:panel?.querySelector('[data-live-collapse]')?.getAttribute('aria-expanded'),rect:panel?.getBoundingClientRect().toJSON()};});
   if(item.width<600)assert.equal(entry.panel.collapsed,'true','Fresh phone scene must begin with compact status');
   const observed=new Map();let release=null,effect=null,releaseReceipt=null,subscriptionCursor=traceBefore;
   // Foreground sync is throttled and can skip one 15s boundary while its read is in flight.
   // Observe multiple real cadences; committed event age limits remain unchanged.
   const deadline=Date.now()+(foregroundAuto?80000:36000);
   let nextManualSettle=0;
   while(Date.now()<deadline&&(!release||(passive[item.build]&&!effect))){
    await sleep(60);
    if(!foregroundAuto&&Date.now()>=nextManualSettle){
     await call('atlas/settle',{runId:currentRun});nextManualSettle=Date.now()+900;
    }
    const traceBatch=await frame.evaluate(cursor=>window.__skillVfxQa.traces.slice(cursor),subscriptionCursor);subscriptionCursor+=traceBatch.length;
    for(const itemTrace of traceBatch){const receipt={build:item.build,width:item.width,trigger:entry.trigger,...itemTrace};receipts.push(receipt);entry.traceCount++;for(const e of receipt.trace.events)observed.set(e.eventId,{event:e,receipt});}
    // Poll the real player continuously even when no NEW receipt arrives:
    // asset verification and the authored actor marker may finish later.
    const v=await view(),last=v.vfx?.lastRelease,lastEffect=v.vfx?.lastEffect;
    if(!effect&&lastEffect&&observed.has(lastEffect.eventId)&&observed.get(lastEffect.eventId).event.type==='skill_effect'
      &&v.vfx.acceptedEffects>0&&v.vfx.player.active>0&&v.vfx.player.drawCalls>0){
     effect={...lastEffect,actor:v.actorAnimation,player:v.vfx.player};
     if(passive[item.build])await page.screenshot({path:path.join(evidenceDir,item.width+'-'+item.build+'-effect.png'),fullPage:true});
    }
    if(!release&&last&&observed.has(last.eventId)&&v.vfx.player.active>0&&v.vfx.player.drawCalls>0){
     const found=observed.get(last.eventId);
     if(found.event.type==='skill_cast'&&found.event.skillId==='atlas:'+item.build){
      release={...last,actor:v.actorAnimation,player:v.vfx.player,geometry:v.geometry};releaseReceipt=found.receipt.trace;
      assert(last.actorElapsedMs>=last.markerMs,'Effect began before authored release marker');
      assert(last.actorElapsedMs-last.markerMs<150,'Unexpected release-marker overshoot');
      assert(Number.isFinite(last.from?.x)&&Number.isFinite(last.from?.y)&&last.bodyHeight>0,'Missing projected release geometry');
      assert.equal(last.startProgress,.22,'Recipe must begin at release phase');
      assert(v.vfx.player.active>0&&v.vfx.player.drawCalls>0,'No actual drawn VFX instance after release');
      assert(v.geometry.enemies.length>0||item.build==='archer_trap','No real target sprites');
      await page.screenshot({path:path.join(evidenceDir,item.width+'-'+item.build+'-release.png'),fullPage:true});
     }
    }
    const s=await state();assert(s.run.active,'Fixture run ended before visual verification');
   }
   assert(release,'No actual committed cast reached actor release: '+JSON.stringify((await view()).vfx));
   if(passive[item.build])assert(effect,'Expected actual delayed '+passive[item.build]+' effect was not presented');
   entry.release=release;entry.effect=effect;
   entry.casts=[...observed.values()].filter(x=>x.event.type==='skill_cast').map(x=>x.event);
   entry.effects=[...observed.values()].filter(x=>x.event.type==='skill_effect').map(x=>x.event);
   if(item.build==='archer_trap'){assert(entry.casts.every(e=>e.targetIds.length===0&&e.hits.length===0));assert.equal(release.mode,'placement');}
   if(effect){const real=observed.get(effect.eventId).event;assert(real.targetIds.length&&real.hits.length);assert.equal(effect.mode,'impact');}
   const realSnapshot=await state(),rendered=await view();
   if(item.width<600){
    entry.phoneGeometry={canvas:rendered.geometry.canvas,enemies:rendered.geometry.enemies};
    await frame.locator('[data-live-collapse]').click();
    assert.equal(await frame.locator('[data-live-collapse]').getAttribute('aria-expanded'),'true');
    await frame.locator('[data-live-collapse]').click();
    assert.equal(await frame.locator('[data-live-collapse]').getAttribute('aria-expanded'),'false');
   }
   assert.equal(rendered.hp,realSnapshot.run.hero.hp);assert.equal(rendered.mp,realSnapshot.run.hero.mp);
   assert.equal(rendered.activeRunId,currentRun);
   assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Horizontal overflow');
   // Re-submit the exact receipt only to the rendering adapter, never to game state.
   const replay=await frame.evaluate(async trace=>{const before=window.RpgSceneLiveView.inspect()[0].vfx;const result=await window.RpgSceneLiveView.ingestCombatTrace(trace);return {before,result,after:window.RpgSceneLiveView.inspect()[0].vfx};},releaseReceipt);
   entry.duplicate=replay;
   assert.equal(replay.after.accepted,replay.before.accepted,'Duplicate committed receipt started another presentation');
   await stop();await sleep(120);
   const cleared=await view();assert.equal(cleared.activeRunId,null);assert.equal(cleared.vfx.player.active,0);assert.equal(cleared.vfx.pendingCasts,0);
   entry.clear=cleared.vfx;entry.passed=true;cases.push(entry);
   console.log(JSON.stringify({stage:'passed-live-case',build:item.build,width:item.width,traceCount:entry.traceCount,releaseId:release.eventId,effectId:effect?.eventId||null}));
  }
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(badResponses.length,0,JSON.stringify(badResponses));
  console.log(JSON.stringify({stage:'complete',cases:cases.length,evidenceDir,pageErrors:errors.length,badResponses:badResponses.length}));
 }catch(error){
  const failure={message:error.message,stack:error.stack,current:frame?await frame.evaluate(()=>({snapshot:window.RpgSceneSession?.getSnapshot?.(),view:window.RpgSceneLiveView?.inspect?.(),qa:window.__skillVfxQa,body:document.body.innerText.slice(0,1500)})).catch(()=>null):null};
  cases.push({passed:false,failure});console.log(JSON.stringify({stage:'failed',message:error.message,evidenceDir}));
  await page.screenshot({path:path.join(evidenceDir,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;
 }finally{
  const samples=frame?await frame.evaluate(()=>{const q=window.__skillVfxQa;if(q?.timer)clearInterval(q.timer);return q?.samples||[];}).catch(()=>[]):[];
  if(currentRun&&frame)await stop().catch(()=>{});
  const sourceFilesAfter=await sourceFingerprints(),sourceChangedDuring=sourceFiles.filter((file,i)=>file.sha256!==sourceFilesAfter[i]?.sha256).map(file=>file.path);
  await fs.writeFile(path.join(evidenceDir,'results.json'),JSON.stringify({generatedAt:new Date().toISOString(),sourceFiles,sourceFilesAfter,sourceChangedDuring,mode:inspectOnly?'inspection':smoke?'smoke':chosen?'selected':'full',health,apiHealth,cases,receipts,samples,errors,badResponses},null,2));
  await browser.close();
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
