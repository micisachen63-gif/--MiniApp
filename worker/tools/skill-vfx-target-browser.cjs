/* Local read-only browser checks for multi-target VFX workshop presentation. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
let playwright;
for(const root of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,path.resolve('.release-sync/browser-tools/node_modules')].filter(Boolean)){
 try{playwright=require(path.join(root,'playwright'));break;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
}
if(!playwright)playwright=require('playwright');
const origin='http://127.0.0.1:9664',out=path.resolve(process.env.VFX_TARGET_QA_DIR||'.release-sync/skill-vfx-targets-20261104/target-browser');
const inputs=['worker/public/skill-vfx-engine.mjs','worker/public/skill-vfx-catalog.json','worker/public/skill-vfx-recipes.json','worker/public/skill-vfx-preview.mjs','worker/public/skill-vfx-preview.css','worker/public/preview-skill-vfx.html','worker/tools/skill-vfx-target-browser.cjs'];
const fingerprint=()=>Object.fromEntries(inputs.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const catalog=JSON.parse(fs.readFileSync('worker/public/skill-vfx-catalog.json','utf8'));
const report={schemaVersion:1,startedAt:new Date().toISOString(),origin,scope:'Read-only workshop target rendering; not a game API or damage test.',sourcesBefore:fingerprint(),cases:[],controls:[],screenshots:[],pageErrors:[],httpErrors:[],blockedRequests:[]};
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const health=await(await fetch(origin+'/__vfx/health')).json();assert(health.readOnly&&health.productionAccess===false&&health.api===false);
 const browser=await playwright.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  for(const [width,height] of [[320,740],[390,844],[1280,900]]){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
   page.setDefaultTimeout(20000);
   page.on('pageerror',e=>report.pageErrors.push({width,message:e.message}));
   page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({width,status:r.status(),url:r.url()});});
   await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin&&['GET','HEAD'].includes(request.method()))return route.continue();
    if(['data:','blob:'].includes(url.protocol))return route.continue();
    report.blockedRequests.push({url:url.href,method:request.method()});return route.abort();
   });
   await page.goto(origin+'/preview-skill-vfx.html',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__VFX_PREVIEW__?.inspect().ready===true);
   for(const skillId of ['native:archer:A22','atlas:mage_chain'])for(const quality of ['high','low'])for(const targetCount of [1,5])for(const direction of ['right','up']){
    const setup=await page.evaluate(async ({skillId,quality,targetCount,direction})=>{
     const qa=window.__VFX_PREVIEW__;await qa.selectSkill(skillId);
     const select=document.querySelector('[data-quality]');select.value=quality;select.dispatchEvent(new Event('change',{bubbles:true}));
     await qa.setDirection(direction);await qa.setTargetCount(targetCount);return qa.inspect();
    },{skillId,quality,targetCount,direction});
    assert.equal(setup.effectiveTargetCount,targetCount);
    const pixels=Array(targetCount).fill(0);
    for(const progress of [.39,.44,.5,.57,.61,.65,.69,.73,.78,.84]){
     const sample=await page.evaluate(async progress=>{
      const qa=window.__VFX_PREVIEW__;await qa.seek(progress);const state=qa.inspect(),canvas=document.querySelector('[data-vfx-canvas]'),ctx=canvas.getContext('2d');
      const scale=canvas.width/canvas.clientWidth;
      return state.layout.targets.map(p=>{
       const x=Math.max(0,Math.floor((p.x-12)*scale)),y=Math.max(0,Math.floor((p.y-12)*scale));
       const w=Math.min(Math.ceil(24*scale),canvas.width-x),h=Math.min(Math.ceil(24*scale),canvas.height-y);
       if(w<=0||h<=0)return 0;
       const data=ctx.getImageData(x,y,w,h).data;let n=0;for(let i=3;i<data.length;i+=4)if(data[i]>12)n++;return n;
      });
     },progress);
     sample.forEach((n,i)=>pixels[i]=Math.max(pixels[i],n));
    }
    assert(pixels.every(n=>n>0),'Every displayed target has rendered VFX pixels: '+JSON.stringify({width,skillId,quality,targetCount,direction,pixels}));
    const layout=await page.evaluate(()=>{
     const r=document.querySelector('[data-stage]').getBoundingClientRect(),nodes=[...document.querySelectorAll('[data-target-marker]')].filter(n=>!n.hidden);
     return {overflow:document.documentElement.scrollWidth>innerWidth+1,markers:nodes.map(n=>{const b=n.getBoundingClientRect(),label=n.querySelector('small').getBoundingClientRect();return {inside:b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&label.bottom<=r.bottom};}),control:document.querySelector('[data-target-count]').getBoundingClientRect().toJSON()};
    });
    assert(!layout.overflow);assert(layout.markers.every(m=>m.inside),'Target marker/label clipped');
    assert(layout.control.width>=44&&layout.control.height>=44);
    report.cases.push({width,height,skillId,quality,targetCount,direction,pixels,layout,passed:true});
   }
   // Exercise the actual select, playback and direction controls.
   await page.selectOption('[data-target-count]','3');await page.waitForFunction(()=>window.__VFX_PREVIEW__.inspect().effectiveTargetCount===3);
   await page.locator('[data-play]').click();await page.waitForFunction(()=>window.__VFX_PREVIEW__.inspect().playing);
   await page.waitForTimeout(220);const live=await page.evaluate(()=>window.__VFX_PREVIEW__.inspect());assert(live.player.active>0&&live.player.drawCalls>0);
   await page.locator('[data-pause]').click();await page.waitForFunction(()=>!window.__VFX_PREVIEW__.inspect().playing);
   const invalid=await page.evaluate(()=>window.__VFX_PREVIEW__.setTargetCount(32));assert.equal(invalid.accepted,false,'Workshop offers artistic samples1/3/5;32 remains engine contract QA only.');
   report.controls.push({width,selectThree:true,playRaf:true,pause:true,rejectUnsupportedCount:true});
   for(const skillId of ['native:archer:A22','atlas:mage_chain']){
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced=await page.evaluate(async skillId=>{
     const qa=window.__VFX_PREVIEW__;await qa.selectSkill(skillId);await qa.setDirection('right');await qa.setTargetCount(5);await qa.seek(.5);
     const state=qa.inspect(),canvas=document.querySelector('[data-vfx-canvas]'),ctx=canvas.getContext('2d');
     const pixels=state.layout.targets.map(p=>{const data=ctx.getImageData(Math.round(p.x)-12,Math.round(p.y)-12,24,24).data;let n=0;for(let i=3;i<data.length;i+=4)if(data[i]>12)n++;return n;});
     return{state,pixels};
    },skillId);
    assert(reduced.state.player.reducedMotion&&reduced.pixels.every(n=>n>0));
    report.controls.push({width,skillId,reducedMotionTargets:5,pixels:reduced.pixels});
   }
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const supportId=catalog.skills.find(s=>s.kind==='heal').id;
   const support=await page.evaluate(async id=>{const qa=window.__VFX_PREVIEW__;await qa.selectSkill(id);return {state:qa.inspect(),disabled:document.querySelector('[data-target-count]').disabled};},supportId);
   assert(support.disabled);assert.equal(support.state.effectiveTargetCount,1);report.controls.push({width,supportLocal:true});
   await page.selectOption('[data-quality]','high');
   for(const [skillId,name,progress] of [['native:archer:A22','volley',.66],['atlas:mage_chain','chain',.67]]){
    await page.evaluate(async ({skillId,progress})=>{const qa=window.__VFX_PREVIEW__;await qa.selectSkill(skillId);await qa.setTargetCount(5);await qa.setDirection('right');await qa.seek(progress);},{skillId,progress});
    const capture=await page.evaluate(async progress=>{
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     await window.__VFX_PREVIEW__.seek(progress);
     const state=window.__VFX_PREVIEW__.inspect(),canvas=document.querySelector('[data-vfx-canvas]'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
     let nonTransparent=0;for(let i=3;i<data.length;i+=4)if(data[i]>0)nonTransparent++;
     return {drawCalls:state.player.drawCalls,nonTransparent,progress:state.progress};
    },progress);
    assert(capture.drawCalls>0&&capture.nonTransparent>0,'Captured VFX frame must be nonempty after media-change callbacks.');
    (report.screenshotChecks ||= []).push({width,skillId,...capture});
    await page.locator('[data-stage]').screenshot({path:path.join(out,width+'-'+name+'-stage.png')});
    report.screenshots.push(width+'-'+name+'-stage.png');
    if(name==='chain'){await page.screenshot({path:path.join(out,width+'-workshop.png'),fullPage:true});report.screenshots.push(width+'-workshop.png');}
   }
   await page.close();
  }
  report.sourcesAfter=fingerprint();assert.deepEqual(report.sourcesAfter,report.sourcesBefore);
  assert.equal(report.pageErrors.length,0);assert.equal(report.httpErrors.length,0);assert.equal(report.blockedRequests.length,0);
  report.status='passed';
 }finally{await browser.close();}
}
main().catch(e=>{report.status='failed';report.error={message:e.message,stack:e.stack};process.exitCode=1;}).finally(()=>{
 report.finishedAt=new Date().toISOString();report.summary={cases:report.cases.length,controls:report.controls.length,pageErrors:report.pageErrors.length,httpErrors:report.httpErrors.length,blockedRequests:report.blockedRequests.length,status:report.status};
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
});
