const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert');
const {chromium}=require('D:/StarJournal/worktree-snapshots/star-journal-button-polish-20261104/.release-sync/browser-tools/node_modules/playwright');
const origin='http://127.0.0.1:9664',dir='.release-sync/skill-vfx-targets-20261104/visual-final';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const runtimePaths=cp.execFileSync('rg',['--files','worker/public','-g','*skill-vfx*'],{encoding:'utf8'}).trim().split(/\r?\n/).map(p=>p.replace(/\\/g,'/')).filter(p=>p&&!/skill-vfx-(coverage|recipes)\.json$/.test(p));
runtimePaths.push('worker/public/art/skill-vfx-20261104/archer-atlas.webp','worker/public/art/skill-vfx-20261104/mage-atlas.webp');
const sourcePaths=[...new Set(runtimePaths)].sort();
const hashes=()=>Object.fromEntries(sourcePaths.map(p=>[p,sha(p)]));
fs.mkdirSync(dir,{recursive:true});
const report={schemaVersion:1,startedAt:new Date().toISOString(),scope:'Controlled manual workshop frames; not live combat evidence. Fresh pages without media changes; read-only loopback GET/HEAD.',origin,sourceBefore:hashes(),cases:[],wholeWorkshop:[],pageErrors:[],httpErrors:[],requestFailures:[],blockedRequests:[],pass:false};
let browser;
async function inspectCanvas(page){
  return page.evaluate(()=>{
    const q=window.__VFX_PREVIEW__,canvas=document.querySelector('[data-vfx-canvas]'),state=q.inspect();
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let alphaPixels=0,alphaSum=0,maxAlpha=0;
    for(let i=3;i<data.length;i+=4){const a=data[i];if(a)alphaPixels++;alphaSum+=a;if(a>maxAlpha)maxAlpha=a;}
    return {state,canvas:{width:canvas.width,height:canvas.height,alphaPixels,alphaSum,maxAlpha},mediaReduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
  });
}
function imageRecord(p){
 const data=fs.readFileSync(p);assert.equal(data.toString('hex',0,8),'89504e470d0a1a0a');
 return {path:p,bytes:data.length,sha256:sha(p),width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
}
(async()=>{
 browser=await chromium.launch({headless:true,channel:'chrome'});
 report.browserVersion=browser.version();
 for(const width of [1280,390])for(const item of [
  {family:'volley',id:'native:archer:A22',phases:[.50,.66,.74]},
  {family:'chain',id:'atlas:mage_chain',phases:[.48,.57,.67]}
 ]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
  page.setDefaultTimeout(20000);
  page.on('pageerror',e=>report.pageErrors.push({width,family:item.family,error:e.message}));
  page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({width,family:item.family,url:r.url(),status:r.status()});});
  page.on('requestfailed',request=>report.requestFailures.push({width,family:item.family,url:request.url(),error:request.failure()?.errorText}));
  await page.route('**/*',route=>{
   const request=route.request(),url=request.url();let allowed=false;
   try{allowed=new URL(url).origin===origin&&['GET','HEAD'].includes(request.method());}catch{}
   if(allowed)return route.continue();
   report.blockedRequests.push({width,family:item.family,url,method:request.method()});return route.abort();
  });
  try{
   await page.goto(origin+'/preview-skill-vfx.html',{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.__VFX_PREVIEW__?.inspect().ready===true);
   await page.evaluate(async id=>{
    const q=window.__VFX_PREVIEW__;await q.ready;
    const quality=document.querySelector('[data-quality]');if(!quality)throw new Error('Quality control missing');
    quality.value='high';quality.dispatchEvent(new Event('change',{bubbles:true}));
    await q.selectSkill(id);await q.setTargetCount(5);await q.setDirection('right');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   },item.id);
   for(const progress of item.phases){
    await page.evaluate(async progress=>{await window.__VFX_PREVIEW__.seek(progress);},progress);
    const before=await inspectCanvas(page),label=width+'-'+item.family+'-'+String(Math.round(progress*100)).padStart(2,'0');
    assert.equal(before.state.selectedSkillId,item.id,label+': selected identity');
    assert.equal(before.state.effectiveTargetCount,5,label+': five targets');
    assert.equal(before.state.direction,'right',label+': direction');
    assert.equal(before.mediaReduced,false,label+': fresh page is normal motion');
    assert.ok(Math.abs(before.state.progress-progress)<1e-6,label+': intended phase');
    assert.ok(before.state.player.drawCalls>0&&before.canvas.alphaPixels>0,label+': nonblank canvas immediately before screenshot');
    const screenshot=dir+'/'+label+'-stage.png';
    await page.locator('[data-stage]').screenshot({path:screenshot});
    const after=await inspectCanvas(page);
    assert.ok(after.state.player.drawCalls>0&&after.canvas.alphaPixels>0,label+': canvas remains visible after capture');
    report.cases.push({width,skillId:item.id,family:item.family,progress,captureMode:'controlled-frame',before,after,image:imageRecord(screenshot),pass:true});
   }
   const file=dir+'/'+width+'-'+item.family+'-workshop.png';
   await page.screenshot({path:file,fullPage:true});
   const finalState=await inspectCanvas(page);
   assert.ok(finalState.canvas.alphaPixels>0&&finalState.state.player.drawCalls>0,'whole workshop remains visible');
   report.wholeWorkshop.push({width,skillId:item.id,captureMode:'controlled-frame',state:finalState,image:imageRecord(file)});
  }finally{await page.close();}
 }
 report.sourceAfter=hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 assert(report.sourceStable,'Runtime source changed during screenshot supplement');
 assert.equal(report.cases.length,12);assert.equal(report.pageErrors.length,0);assert.equal(report.httpErrors.length,0);assert.equal(report.blockedRequests.length,0);assert.equal(report.requestFailures.length,0);
 report.pass=true;
})().catch(error=>{report.failure={message:error.message,stack:error.stack};process.exitCode=1;}).finally(async()=>{
 await browser?.close();
 report.finishedAt=new Date().toISOString();
 if(!report.sourceAfter){report.sourceAfter=hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);}
 fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({pass:report.pass,startedAt:report.startedAt,finishedAt:report.finishedAt,cases:report.cases.length,wholeWorkshop:report.wholeWorkshop.length,sourceStable:report.sourceStable,pageErrors:report.pageErrors,httpErrors:report.httpErrors,blockedRequests:report.blockedRequests,requestFailures:report.requestFailures,failure:report.failure,frames:report.cases.map(c=>({width:c.width,family:c.family,progress:c.progress,alphaPixels:c.before.canvas.alphaPixels,drawCalls:c.before.state.player.drawCalls,afterAlphaPixels:c.after.canvas.alphaPixels,path:c.image.path})),report:dir+'/report.json'},null,2));
});
