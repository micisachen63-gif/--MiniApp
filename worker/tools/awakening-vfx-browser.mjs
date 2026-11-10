import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {AWAKENING_ASSETS} from '../public/awakening-vfx-data.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
const value=(key,fallback)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3)||fallback;
const base=value('base','http://127.0.0.1:9894');
const pwRoot=value('playwright-root',process.env.AWAKENING_PLAYWRIGHT_ROOT||'D:/StarJournal/worktree-snapshots/star-journal-scene-integration-20261104/.release-sync/browser-tools/node_modules');
const smoke=process.argv.includes('--smoke');
const frostReview=process.argv.includes('--frost-review');
const outputRelative=value('out',frostReview?'.release-sync/awakening-vfx-20261105/ornate-v2-frost-review':smoke?'.release-sync/awakening-vfx-20261105/ornate-v2-visual-review':'.release-sync/awakening-vfx-20261105/ornate-v2-browser');
const output=path.resolve(root,outputRelative);if(!output.startsWith(root))throw new Error('Output must remain inside this checkout');fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['worker/public/skill-vfx-engine.mjs','worker/public/skill-vfx-semantics.mjs','worker/public/skill-vfx-catalog.json','worker/public/awakening-vfx-data.mjs','worker/public/awakening-vfx-engine.mjs','worker/public/awakening-vfx-preview.html','worker/public/awakening-vfx-preview.css','worker/public/awakening-vfx-preview.mjs','worker/tools/awakening-vfx-preview-server.mjs','worker/test/awakening-vfx-engine.test.js','worker/tools/awakening-vfx-browser.mjs',...Object.values(AWAKENING_ASSETS).map(url=>'worker/public'+url)];
const fingerprints=()=>files.map(p=>{const b=fs.readFileSync(path.join(root,p));return {path:p,bytes:b.length,sha256:hash(b)};});
const receipt={scope:'awakening-vfx-browser',presentationRevision:'ornate-v2',startedAt:new Date().toISOString(),finishedAt:null,base,complete:false,pass:false,previewOnly:true,sourceId:null,liveCatalogSkills:196,sources:fingerprints(),counts:{desktopDirections:0,desktopStages:0,lowQualityDirections:0,reducedDirections:0,mobileDirections:0,endpointChecks:0},checks:[],screenshots:[],browserErrors:[],networkFailures:[],notes:['These are automated canvas, layout, identity and control checks. A screenshot contact sheet is supplied for independent visual review.','No awakening gameplay event is generated.','The rejected-v1 geometry-only presentation has no browser approval. This receipt covers dedicated painted ornate-v2 only.']};
const checkpoint=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const screenshot=async(page,name,options={})=>{const file=path.join(output,name);await page.screenshot({path:file,...options});const bytes=fs.readFileSync(file);receipt.screenshots.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});};
let browser;
try{
  const {chromium}=require(path.join(pwRoot,'playwright'));
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1,reducedMotion:'no-preference'}),page=await context.newPage();
  page.setDefaultTimeout(30000);page.on('pageerror',e=>receipt.browserErrors.push(e.stack||String(e)));page.on('requestfailed',r=>receipt.networkFailures.push({url:r.url(),failure:r.failure()}));
  const requested=[];page.on('request',r=>requested.push({url:r.url(),method:r.method()}));
  const health=await (await fetch(base+'/__awakening/health')).json();assert(health.previewOnly&&health.readOnly&&health.plannedSkills===16&&health.sourceId===null,'Wrong preview server');
  await page.goto(base+'/awakening-vfx-preview.html',{waitUntil:'networkidle'});await page.waitForFunction(()=>document.documentElement.dataset.awakeningReady==='true');
  const profiles=await page.evaluate(()=>window.__awakeningVfxPreview.profiles.map(p=>({id:p.id,name:p.name,baseClass:p.baseClass,modeLabel:p.modeLabel})));
  assert(profiles.length===16,'Expected 16 awakening previews');const readiness=await page.evaluate(()=>window.__awakeningVfxPreview.stats());assert(readiness.presentationRevision==='ornate-v2','Outdated awakening revision');assert(readiness.loadedAssets.filter(k=>k.startsWith('awakening-')).length===4,'Missing dedicated awakening atlases');
  const capture=async(args)=>page.evaluate(({id,direction,t,quality='high',reducedMotion=false,targetCount=1})=>{
    const api=window.__awakeningVfxPreview,previous=api.stats();if(previous.id!==id)api.select(id);if(previous.direction!==direction)api.setDirection(direction);if(previous.quality!==quality)api.setQuality(quality);if(previous.reducedMotion!==reducedMotion)api.setReducedMotion(reducedMotion);if(previous.targetCount!==targetCount)api.setTargetCount(targetCount);api.seek(t);
    const canvas=document.getElementById('effectCanvas'),ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let visible=0,edge=0,h=2166136261,minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
    for(let y=0;y<canvas.height;y+=2)for(let x=0;x<canvas.width;x+=2){const i=(y*canvas.width+x)*4,a=pixels[i+3];if(a>10){visible++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);if(x<3||y<3||x>canvas.width-4||y>canvas.height-4)edge++;}h=Math.imul(h^pixels[i]^pixels[i+1]^pixels[i+2]^a,16777619);}
    const s=api.stats(),rect=canvas.getBoundingClientRect();return {id,direction,t,quality,reducedMotion,targetCount,name:document.getElementById('skillName').textContent,phase:document.getElementById('phaseLabel').textContent,visible,edge,pixelHash:(h>>>0).toString(16),bounds:visible?[minX,minY,maxX,maxY]:null,canvas:[canvas.width,canvas.height],css:[rect.width,rect.height],pageOverflow:document.documentElement.scrollWidth>innerWidth+1,...s};
  },args);
  if(frostReview){
    receipt.scope='awakening-vfx-frost-visual-review';receipt.cases=[];
    for(const t of [.29,.68,.8]){const r=await capture({id:'preview:awakening:mage:expert',direction:'right',t});assert(r.edge===0&&r.visible>10,'Frost desktop clipping');receipt.cases.push(r);await screenshot(page,'desktop-frost-'+Math.round(t*100)+'.png',{clip:await page.locator('#stage').boundingBox()});}
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>Math.abs(window.__awakeningVfxPreview.stats().width-document.getElementById('stage').getBoundingClientRect().width)<1);
    for(const direction of ['right','left','up','down'])for(const t of [.29,.68,.8]){const r=await capture({id:'preview:awakening:mage:expert',direction,t});assert(r.edge===0&&r.visible>10&&!r.pageOverflow,'Frost phone clipping '+direction+' '+t);receipt.cases.push(r);if(t===.68)await screenshot(page,'mobile-frost-'+direction+'.png',{fullPage:true});}
    receipt.requiresIndependentVisualReview=true;
  }else if(smoke){
    const desktop=await capture({id:'preview:awakening:sword:hell',direction:'right',t:.52});await screenshot(page,'desktop-divine-verdict.png',{fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>Math.abs(window.__awakeningVfxPreview.stats().width-document.getElementById('stage').getBoundingClientRect().width)<1);
    const mobile=await capture({id:'preview:awakening:mage:expert',direction:'right',t:.55});await screenshot(page,'mobile-frost-return.png',{fullPage:true});
    receipt.scope='awakening-vfx-visual-review';receipt.cases=[desktop,mobile];receipt.requiresIndependentVisualReview=true;
  }else{
  const rows=[],pictures=[];
  for(const p of profiles){
    const cases=[];
    for(const direction of ['right','left','up','down']){
      for(const t of [.15,.36,.63,.88]){const r=await capture({id:p.id,direction,t});assert(r.name===p.name&&r.sourceId===null&&r.previewOnly&&!r.implemented,'Preview identity drift: '+p.id);assert(r.visible>10,'Empty stage '+p.name+' '+direction+' '+t);assert(r.edge===0,'Canvas clipping '+p.name+' '+direction+' '+t);assert(!r.pageOverflow,'Desktop overflow');cases.push(r);receipt.counts.desktopStages++;}receipt.counts.desktopDirections++;
      const low=await capture({id:p.id,direction,t:.63,quality:'low'});assert(low.visible>10&&low.edge===0,'Low-quality missing/cropped '+p.name);receipt.counts.lowQualityDirections++;
      const reduced=await capture({id:p.id,direction,t:.63,quality:'low',reducedMotion:true});assert(reduced.visible>10&&reduced.edge===0,'Reduced-motion missing/cropped '+p.name);receipt.counts.reducedDirections++;
    }
    for(const t of [0,1]){const end=await capture({id:p.id,direction:'right',t});assert(end.visible===0,'Nontransparent endpoint '+p.name);receipt.counts.endpointChecks++;}
    const staticA=await capture({id:p.id,direction:'right',t:.3,reducedMotion:true}),staticB=await capture({id:p.id,direction:'right',t:.7,reducedMotion:true});assert(staticA.pixelHash===staticB.pixelHash,'Reduced geometry moved '+p.name);
    await capture({id:p.id,direction:'right',t:p.id.includes('mage:hell')?.72:.59,targetCount:p.id.includes('archer:hell')?3:1});
    pictures.push(await page.evaluate(()=>({name:document.getElementById('skillName').textContent,mode:document.getElementById('skillMode').textContent,image:document.getElementById('effectCanvas').toDataURL('image/png')})));
    const stage=page.locator('#stage'),file='stage-'+p.id.split(':').slice(-2).join('-')+'.png';await stage.screenshot({path:path.join(output,file)});const b=fs.readFileSync(path.join(output,file));receipt.screenshots.push({path:path.relative(root,path.join(output,file)).replaceAll('\\','/'),bytes:b.length,sha256:hash(b)});
    rows.push({id:p.id,name:p.name,cases});receipt.checks.push({name:'desktop four-direction multistage + low/reduced + boundaries',id:p.id,pass:true});fs.writeFileSync(path.join(output,'desktop-matrix.json'),JSON.stringify(rows,null,2)+'\n');checkpoint();console.log(JSON.stringify({checkpoint:'desktop',done:rows.length,total:16,id:p.id}));
  }
  await capture({id:'preview:awakening:mage:hell',direction:'right',t:.72});await screenshot(page,'desktop-full.png',{fullPage:true});
  // Full-sized paired moments allow a person to assess actual action, not only
  // a changed pixel hash or a scaling painted badge.
  receipt.motionExamples=[];
  for(const [id,times] of [['sword:hell',[.32,.66]],['archer:expert',[.34,.66]],['mage:expert',[.29,.68,.8]],['mage:hell',[.32,.72]],['thief:hell',[.32,.65]]]){
    for(const t of times){const r=await capture({id:'preview:awakening:'+id,direction:'right',t});const clip=await page.locator('#stage').boundingBox(),name='motion-'+id.replace(':','-')+'-'+String(Math.round(t*100))+'.png';await screenshot(page,name,{clip});receipt.motionExamples.push({id:r.id,name:r.name,time:t,phase:r.phase,pixelHash:r.pixelHash,movingActors:r.metrics.movingActorCount,screenshot:name,visualReview:'requires independent inspection'});}
  }
  await capture({id:'preview:awakening:mage:hell',direction:'right',t:.1});
  // Verify actual controls rather than only calling the inspection API.
  await page.evaluate(()=>window.__awakeningVfxPreview.seek(.1));await page.locator('#playButton').click();await page.waitForTimeout(120);await page.locator('#playButton').click();const paused=await page.evaluate(()=>window.__awakeningVfxPreview.stats());assert(!paused.playing&&paused.progress>.1,'Play / pause did not advance');
  await page.locator('#stepButton').click();const stepped=await page.evaluate(()=>window.__awakeningVfxPreview.stats());assert(stepped.progress>paused.progress&&!stepped.playing,'Single step failed');
  await page.locator('#phaseButtons button').nth(0).click();const phase=await page.evaluate(()=>window.__awakeningVfxPreview.stats());assert(phase.progress<.2&&!phase.playing,'Phase seek failed');
  await page.locator('#directionButtons button[data-direction="up"]').click();assert((await page.evaluate(()=>window.__awakeningVfxPreview.stats())).direction==='up','Direction control failed');
  await page.locator('#quality').selectOption('low');await page.locator('#reducedMotion').check();await page.locator('#targetCount').selectOption('3');const controls=await page.evaluate(()=>window.__awakeningVfxPreview.stats());assert(controls.quality==='low'&&controls.reducedMotion&&controls.targetCount===3,'Settings controls failed');
  receipt.checks.push({name:'play/pause, single step, phase seek, direction, quality, reduced motion and targets controls',pass:true});
  // Independent phone viewport: all subjects and directions must remain visible.
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>Math.abs(window.__awakeningVfxPreview.stats().width-document.getElementById('stage').getBoundingClientRect().width)<1);const mobile=[];
  for(const p of profiles){for(const direction of ['right','left','up','down']){const r=await capture({id:p.id,direction,t:.63,quality:'low',reducedMotion:false});assert(!r.pageOverflow,'390px horizontal overflow '+p.name);assert(r.visible>10&&r.edge===0,'390px missing/cropped '+p.name+' '+direction);mobile.push(r);receipt.counts.mobileDirections++;}if(p.modeLabel==='地獄'){await capture({id:p.id,direction:'up',t:.63,quality:'low'});await screenshot(page,'mobile-'+p.baseClass+'.png',{fullPage:true});}checkpoint();}
  fs.writeFileSync(path.join(output,'mobile-matrix.json'),JSON.stringify(mobile,null,2)+'\n');
  await page.locator('#mobileSkill').selectOption('preview:awakening:archer:expert');assert((await page.evaluate(()=>window.__awakeningVfxPreview.stats())).id==='preview:awakening:archer:expert','Mobile picker failed');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.__awakeningVfxPreview.stats().reducedMotion===true);receipt.checks.push({name:'390px mobile all16×4, mobile picker and OS reduced-motion preference',pass:true});
  // Check read-only routes without hitting any real game service.
  assert((await fetch(base+'/api/encounter')).status===404,'Unexpected API route');assert((await fetch(base+'/awakening-vfx-preview.html',{method:'POST'})).status===405,'Unexpected mutation route');
  assert(requested.every(r=>r.method==='GET'&&(r.url.startsWith(base+'/')||r.url.startsWith('data:'))),'Unexpected request outside preview');
  assert(receipt.browserErrors.length===0,'Browser errors');assert(receipt.networkFailures.length===0,'Network failures');receipt.checks.push({name:'no browser errors, no failed assets, local GET-only requests, no API route',pass:true});
  // Navigation runs the preview's existing pagehide disposal and destroys its
  // ResizeObserver before the contact sheet replaces the DOM. setContent alone
  // leaves the old application alive and must never be used as a teardown.
  await page.goto('about:blank',{waitUntil:'load'});
  // Contact sheet preserves the canvas output; text labels identify every exact name.
  await page.setViewportSize({width:1440,height:1120});await page.setContent('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#080e1b;color:#e8e9ef;font-family:"Microsoft JhengHei",sans-serif}h1{font-size:25px;font-weight:500;letter-spacing:.13em;margin:0 0 8px}p{font-size:12px;color:#a1aec3;margin:0 0 22px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{border:1px solid #ffffff15;border-radius:12px;overflow:hidden;background:radial-gradient(ellipse,#182b4433,#0c1423)}.head{padding:13px 15px 0;font-size:14px;letter-spacing:.07em}.head small{display:block;font-size:9px;color:#a18d70;letter-spacing:.1em;margin:6px 0 0}img{display:block;width:100%;height:200px;object-fit:contain}</style><h1>覺醒星圖 · 十六式</h1><p>獨立覺醒視覺預覽 ／ 待機制接入 ／ 每格為實際 Canvas 演出截圖</p><div class="grid"></div></html>');
  await page.evaluate(items=>{const grid=document.querySelector('.grid');for(const item of items){const card=document.createElement('div');card.className='card';const head=document.createElement('div');head.className='head';head.textContent=item.name;const small=document.createElement('small');small.textContent=item.mode;head.append(small);const img=document.createElement('img');img.src=item.image;card.append(head,img);grid.append(card);}},pictures);await page.waitForFunction(()=>[...document.images].every(i=>i.complete));await screenshot(page,'awakening-contact-sheet.png',{fullPage:true});
  }
  // No passing receipt may be written before every screenshot and browser cleanup.
  // Event listeners remain attached through close, so late page/asset errors count.
  await browser.close();browser=null;await new Promise(resolve=>setImmediate(resolve));
  assert(receipt.browserErrors.length===0,'Browser errors after all screenshots and cleanup');
  assert(receipt.networkFailures.length===0,'Network failures after all screenshots and cleanup');
  assert(requested.every(r=>r.method==='GET'&&(r.url.startsWith(base+'/')||r.url.startsWith('data:'))),'Unexpected request outside preview');
  const after=fingerprints();assert(JSON.stringify(receipt.sources)===JSON.stringify(after),'Sources changed during browser verification');
  receipt.checks.push({name:'final error/network assertion after contact sheet and browser cleanup',pass:true});
  receipt.sourcesAfter=after;receipt.finishedAt=new Date().toISOString();receipt.complete=true;receipt.pass=smoke?null:true;checkpoint();
  console.log(JSON.stringify({mode:frostReview?'frost-review-only':smoke?'visual-review-only':'full-matrix',pass:receipt.pass,receipt:path.relative(root,path.join(output,'receipt.json')).replaceAll('\\','/'),counts:receipt.counts,cases:receipt.cases?.length,screenshots:receipt.screenshots.length,sourceStable:true,browserErrors:receipt.browserErrors.length,networkFailures:receipt.networkFailures.length}));
}catch(error){receipt.complete=false;receipt.pass=false;receipt.failure=error.stack||String(error);receipt.finishedAt=new Date().toISOString();checkpoint();console.error(receipt.failure);process.exitCode=1;}finally{await browser?.close();}
