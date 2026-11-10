'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {chromium}=require('D:/StarJournal/worktree-snapshots/star-journal-button-polish-20261104/.release-sync/browser-tools/node_modules/playwright');
const origin='http://127.0.0.1:9664';
const out=path.resolve('.release-sync/skill-vfx-targets-20261104/five-target-replay');
const receiptFile='.release-sync/skill-vfx-targets-20261104/five-target/results.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inputs=['worker/public/skill-vfx-engine.mjs','worker/public/skill-vfx-combat-adapter.mjs','worker/public/skill-vfx-catalog.json','worker/public/skill-vfx-preview.mjs','worker/public/skill-vfx-preview.css','worker/public/preview-skill-vfx.html','worker/public/art/skill-vfx-20261104/mage-atlas.webp'];
const fingerprint=()=>Object.fromEntries(inputs.map(p=>[p,{bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))}]));
fs.mkdirSync(out,{recursive:true});
const bytes=fs.readFileSync(receiptFile),receipt=JSON.parse(bytes);
assert.equal(sha(bytes),'a1f54e465f158beaab9593ecd0c07183ec0912142fe39ca0f1c6c5ee171ff5b9');
const trace=receipt.originalCombatTrace,event=receipt.selectedEvent;
assert.equal(receipt.status,'passed');
assert.equal(trace.source,'committed-combat');
assert.equal(event.skillId,'atlas:mage_chain');
assert.equal(event.targetIds.length,5);
assert.equal(new Set(event.targetIds).size,5);
assert.deepEqual(trace.events.find(e=>e.eventId===event.eventId),event);
assert.deepEqual(event.hits.map(h=>h.targetId),event.targetIds);
const report={
 schemaVersion:1,startedAt:new Date().toISOString(),classification:'true-SQLite-receipt-to-controlled-adapter-to-real-Canvas-RAF-replay',
 limitation:'The original receipt and hits are unchanged, but replay admission time and target coordinates are controlled. This is not a full five-enemy MiniApp UI run or physical-device GPU test.',
 inputReceipt:receiptFile,receiptSha256:sha(bytes),originalCombatTrace:trace,selectedEvent:event,
 sourceFiles:fingerprint(),cases:[],pageErrors:[],httpErrors:[],requestFailures:[],blockedRequests:[],networkPolicy:'GET/HEAD only, exact origin http://127.0.0.1:9664; no API calls or writes.',
};
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,channel:'chrome'});
 report.browserVersion=browser.version();
 for(const width of [1280,390]){
  const name=width===390?'phone':'desktop',height=width===390?844:900;
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'no-preference'});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror',e=>report.pageErrors.push({name,message:e.message}));
  page.on('requestfailed',r=>report.requestFailures.push({name,url:r.url(),failure:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({name,status:r.status(),url:r.url()});});
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin||!['GET','HEAD'].includes(request.method())||url.pathname.includes('/api/')){
    report.blockedRequests.push({name,url:request.url(),method:request.method()});
    return route.abort();
   }
   return route.continue();
  });
  await page.goto(origin+'/preview-skill-vfx.html',{waitUntil:'networkidle'});
  await page.evaluate(()=>window.__VFX_PREVIEW__.ready);
  const setup=await page.evaluate(async({trace,event})=>{
   const qa=window.__VFX_PREVIEW__;
   for(const result of [await qa.selectSkill(event.skillId),await qa.setTargetCount(5),await qa.setDirection('right')])
    if(!result?.accepted)throw new Error('Workshop setup did not accept selected input.');
   const view=qa.inspect(),canvas=document.querySelector(view.canvasSelector);
   const cssSize={width:canvas.clientWidth,height:canvas.clientHeight};
   const geometry={from:structuredClone(view.layout.from),to:structuredClone(view.layout.to),targets:structuredClone(view.layout.targets),bodyHeight:view.bodyHeight,direction:view.direction};
   if(geometry.targets.length!==event.targetIds.length)throw new Error('Geometry count differs from original target count.');
   const mapping=event.targetIds.map((targetId,index)=>({targetId,point:structuredClone(geometry.targets[index])}));
   qa.destroy();
   const priorPlayer=qa.inspect().player;
   const [{createVfxPlayer},{createCombatVfxAdapter},catalog]=await Promise.all([
    import('/skill-vfx-engine.mjs'),import('/skill-vfx-combat-adapter.mjs'),
    fetch('/skill-vfx-catalog.json').then(r=>{if(!r.ok)throw new Error('catalog fetch');return r.json();})
   ]);
   const digest=async p=>{const r=await fetch(p);if(!r.ok)throw new Error('Source fetch failed '+p);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');};
   const servedHashes={engine:await digest('/skill-vfx-engine.mjs'),adapter:await digest('/skill-vfx-combat-adapter.mjs')};
   const ctx=canvas.getContext('2d'),native={beginPath:ctx.beginPath,ellipse:ctx.ellipse,stroke:ctx.stroke};
   let ellipse=null,playStarted=0,strokeCalls=0,ellipseCalls=0,pendingResolve,pendingReject,done=false,deadline;
   const proof={mapping,geometry,priorPlayer,servedHashes,clock:{admissionNow:event.atMs,originalEventAtMs:event.atMs,source:'explicit replay-only adapter now() override',animation:'unmodified real requestAnimationFrame/performance.now'},frames:[],contacts:{},pixels:{},playerErrors:[],snapshots:[]};
   ctx.beginPath=function(...args){ellipse=null;return native.beginPath.apply(this,args);};
   ctx.ellipse=function(...args){
    const m=this.getTransform(),ratio=canvas.width/cssSize.width;
    ellipse={x:(m.a*args[0]+m.c*args[1]+m.e)/ratio,y:(m.b*args[0]+m.d*args[1]+m.f)/ratio,alpha:this.globalAlpha};
    ellipseCalls++;return native.ellipse.apply(this,args);
   };
   ctx.stroke=function(...args){
    const result=native.stroke.apply(this,args);strokeCalls++;
    if(ellipse&&ellipse.alpha>.004)for(const target of mapping){
     if(Math.hypot(target.point.x-ellipse.x,target.point.y-ellipse.y)>.35)continue;
     const record=proof.contacts[target.targetId]||(proof.contacts[target.targetId]={targetId:target.targetId,point:target.point,firstAtMs:performance.now()-playStarted,lastAtMs:0,strokeCount:0,firstFrame:proof.frames.length});
     record.lastAtMs=performance.now()-playStarted;record.strokeCount++;
    }
    return result;
   };
   let player,adapter;
   const completion=new Promise((resolve,reject)=>{pendingResolve=resolve;pendingReject=reject;});
   function finish(error){if(done)return;done=true;clearTimeout(deadline);error?pendingReject(error):pendingResolve();}
   player=createVfxPlayer(canvas,{catalog,quality:'high',maxActive:1,reducedMotion:false,onError:e=>{proof.playerErrors.push(e.message);finish(e);},onRender:stats=>{
    if(!playStarted)return;
    proof.frames.push({atMs:performance.now()-playStarted,active:stats.active,drawCalls:stats.drawCalls,frameMs:stats.frameMs});
    for(const target of mapping){
     if(!proof.contacts[target.targetId]||proof.pixels[target.targetId])continue;
     const ratio=canvas.width/cssSize.width,x=Math.max(0,Math.floor((target.point.x-12)*ratio)),y=Math.max(0,Math.floor((target.point.y-12)*ratio));
     const w=Math.min(canvas.width-x,Math.ceil(24*ratio)),h=Math.min(canvas.height-y,Math.ceil(24*ratio));
     const data=ctx.getImageData(x,y,w,h).data;let nontransparent=0,maxAlpha=0;
     for(let i=3;i<data.length;i+=4){if(data[i]>8)nontransparent++;maxAlpha=Math.max(maxAlpha,data[i]);}
     if(nontransparent)proof.pixels[target.targetId]={targetId:target.targetId,atMs:performance.now()-playStarted,frame:proof.frames.length,nontransparentPixels:nontransparent,maxAlpha,sampleRect:{x,y,w,h}};
    }
    if(Object.keys(proof.pixels).length===mapping.length&&!proof.snapshots.length)
     proof.snapshots.push({label:'all-five-confirmed-contacts-real-RAF',atMs:performance.now()-playStarted,frame:proof.frames.length,png:canvas.toDataURL('image/png')});
    if(proof.frames.length>1&&stats.active===0)finish();
   }});
   player.resize(cssSize.width,cssSize.height,1);
   await player.prepare('mage');
   adapter=createCombatVfxAdapter(player,{context:structuredClone(trace.context),now:()=>event.atMs});
   const raw={...structuredClone(event),schemaVersion:trace.schemaVersion,source:trace.source,context:structuredClone(trace.context),revision:trace.revision,...geometry};
   proof.adapterInput=structuredClone(raw);
   window.__FIVE_TARGET_RECEIPT_PROOF__={proof,done:null};
   deadline=setTimeout(()=>finish(new Error('Actual RAF playback did not complete within 8 seconds.')),8000);
   playStarted=performance.now();
   const admission=await adapter.ingest(raw);
   proof.admission=admission;
   if(!admission.accepted)finish(new Error('Adapter rejected original receipt: '+admission.reason));
   window.__FIVE_TARGET_RECEIPT_PROOF__.done=(async()=>{
    try{
     await completion;
     proof.strokeCalls=strokeCalls;proof.ellipseCalls=ellipseCalls;
     proof.playerAfterPlayback=player.stats();
     const beforeDuplicate={strokeCalls,frames:proof.frames.length};
     proof.duplicate=await adapter.ingest(raw);
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     proof.duplicateCausedNoDraw=beforeDuplicate.strokeCalls===strokeCalls&&beforeDuplicate.frames===proof.frames.length;
     proof.adapterAfterDuplicate=adapter.stats();
     adapter.clear();
     proof.adapterAfterClear=adapter.stats();
     proof.playerAfterClear=player.stats();
     proof.duplicateAfterClear=await adapter.ingest(raw);
     proof.seenTargetIds=mapping.filter(t=>proof.contacts[t.targetId]&&proof.pixels[t.targetId]).map(t=>t.targetId);
     proof.pass=proof.admission.accepted&&proof.seenTargetIds.length===5&&proof.snapshots.length===1
      &&proof.duplicate.accepted===false&&proof.duplicate.reason==='duplicate'&&proof.duplicateCausedNoDraw
      &&proof.duplicateAfterClear.accepted===false&&proof.duplicateAfterClear.reason==='duplicate'
      &&proof.playerAfterPlayback.active===0&&proof.playerAfterClear.active===0&&proof.playerErrors.length===0;
    }finally{
     adapter.destroy();player.destroy();
     proof.adapterAfterDestroy=adapter.stats();proof.playerAfterDestroy=player.stats();
     ctx.beginPath=native.beginPath;ctx.ellipse=native.ellipse;ctx.stroke=native.stroke;
     proof.canvasAfterDestroy={width:canvas.width,height:canvas.height};
    }
    return proof;
   })();
   return {admission,geometry,mapping,cssSize,servedHashes,priorPlayer};
  },{trace,event});
  assert.equal(setup.admission.accepted,true);
  const result=await page.evaluate(()=>window.__FIVE_TARGET_RECEIPT_PROOF__.done);
  for(const snap of result.snapshots){
   const file=name+'-raf-all-five.png',data=Buffer.from(snap.png.split(',')[1],'base64');
   fs.writeFileSync(path.join(out,file),data);delete snap.png;Object.assign(snap,{file,bytes:data.length,sha256:sha(data),capture:'Actual canvas pixels captured in the real player onRender callback; no seek or manual frame override.'});
  }
  const row={name,viewport:{width,height},...result};
  report.cases.push(row);
  assert.deepEqual(row.seenTargetIds,event.targetIds,name+': every original target had an actual stroked contact and visible pixels');
  assert.equal(row.servedHashes.engine,report.sourceFiles['worker/public/skill-vfx-engine.mjs'].sha256);
  assert.equal(row.servedHashes.adapter,report.sourceFiles['worker/public/skill-vfx-combat-adapter.mjs'].sha256);
  assert.deepEqual(Object.fromEntries(Object.keys(event).map(k=>[k,row.adapterInput[k]])),event);
  assert.deepEqual(row.adapterInput.context,trace.context);
  assert.equal(row.adapterInput.revision,trace.revision);
  assert.equal(row.adapterInput.source,trace.source);
  assert.equal(row.pass,true,name+' replay proof failed');
  assert.equal(row.priorPlayer.destroyed,true);
  assert.equal(row.adapterAfterDestroy.destroyed,true);
  assert.equal(row.playerAfterDestroy.destroyed,true);
  assert.equal(row.canvasAfterDestroy.width,1);
  assert.equal(row.canvasAfterDestroy.height,1);
  await context.close();
 }
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.requestFailures,[]);assert.deepEqual(report.blockedRequests,[]);
 report.sourceFilesAfter=fingerprint();assert.deepEqual(report.sourceFilesAfter,report.sourceFiles);
 report.receiptSha256After=sha(fs.readFileSync(receiptFile));assert.equal(report.receiptSha256After,report.receiptSha256);
 report.status='passed';
})().catch(error=>{report.status='failed';report.error=error.stack||String(error);process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,error:report.error,startedAt:report.startedAt,finishedAt:report.finishedAt,classification:report.classification,receiptSha256:report.receiptSha256,engineSha256:report.sourceFiles['worker/public/skill-vfx-engine.mjs'].sha256,cases:report.cases.map(c=>({name:c.name,viewport:c.viewport,pass:c.pass,frames:c.frames.length,seenTargetIds:c.seenTargetIds,duplicate:c.duplicate,duplicateCausedNoDraw:c.duplicateCausedNoDraw,snapshots:c.snapshots})),pageErrors:report.pageErrors,httpErrors:report.httpErrors,requestFailures:report.requestFailures,blockedRequests:report.blockedRequests,results:path.join(out,'results.json')},null,2));
});
