/**
 * Name-semantic visual acceptance. Uses an isolated loopback server and exact
 * current sources. Does not call game APIs or claim physical-device validation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createSkillVfxPreviewServer } from './skill-vfx-preview-server.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),pub=path.join(root,'worker/public');
const out=path.join(root,'.release-sync/skill-vfx-semantics-20261105/semantic-browser');
const require=createRequire(import.meta.url);
let playwright;
for(const base of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,path.join(root,'.release-sync/browser-tools/node_modules'),path.resolve(root,'../star-journal-scene-integration-20261104/.release-sync/browser-tools/node_modules')].filter(Boolean)){
 try{playwright=require(path.join(base,'playwright'));break;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
}
if(!playwright)throw Error('Existing Playwright dependency is required.');
const catalog=JSON.parse(await fs.readFile(path.join(pub,'skill-vfx-catalog.json'),'utf8'));
const sources=['worker/public/skill-vfx-engine.mjs','worker/public/skill-vfx-semantics.mjs','worker/public/skill-vfx-catalog.json','worker/public/skill-vfx-recipes.json','worker/public/skill-vfx-preview.mjs','worker/public/preview-skill-vfx.html','worker/public/skill-vfx-preview.css','worker/tools/skill-vfx-semantic-browser.mjs',...['sword-atlas','archer-atlas','mage-atlas','thief-atlas','hawk','fire-spirit','semantic-atlas'].map(n=>'worker/public/art/skill-vfx-20261104/'+n+'.webp')];
const fingerprint=async()=>Promise.all(sources.map(async p=>({path:p,sha256:createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')})));
const sourceFiles=await fingerprint();
const report={schemaVersion:1,status:'running',startedAt:new Date().toISOString(),scope:'current-name-semantic-workshop-pixels',sourceFiles,coverage:[],phaseChecks:[],mobileChecks:[],reducedChecks:[],screenshots:[],errors:[],httpErrors:[],consoleErrors:[],limitations:['Local headless Chrome and viewport emulation; not Telegram or physical mobile GPU validation.','Gallery stills show controlled frame progress; live RAF is separately sampled.','Profile uniqueness is data coverage; pixel checks and named visual review are separate evidence.']};
let server,browser,page,failure;
await fs.mkdir(out,{recursive:true});
const representatives=['special:skill_13_1','native:mage:B21','native:mage:B22','native:mage:B222','special:skill_19_2','special:skill_thief_02','special:skill_18_2','special:skill_thief_06','special:skill_16_2','native:archer:base','native:thief:B','native:thief:B121','native:thief:B122','native:mage:B121','native:thief:A211','special:skill_20_1','special:skill_23_2','native:archer:B122','special:skill_01_2','native:sword:A1','native:sword:B112','native:sword:B111','native:mage:A111','special:skill_05_3'];
try{
 server=await createSkillVfxPreviewServer({publicRoot:pub});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 report.origin=origin;
 browser=await playwright.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 report.browser=browser.version();
 page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
 page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 await page.goto(origin+'/preview-skill-vfx.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__VFX_PREVIEW__?.inspect().ready);
 for(const skill of catalog.skills){
  const samples=await page.evaluate(async id=>{
   const qa=window.__VFX_PREVIEW__,results=[];
   await qa.selectSkill(id);
   for(const direction of ['right','left','up','down']){
    await qa.setDirection(direction);await qa.seek(.66);
    const c=document.querySelector('[data-vfx-canvas]'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let pixels=0,signature=2166136261;
    for(let i=3;i<p.length;i+=4)if(p[i]>12){pixels++;signature=Math.imul(signature^(p[i]+p[i-1]*3+p[i-2]*5+i),16777619);}
    results.push({id,direction,pixels,signature:signature>>>0,recipe:qa.inspect().recipe.id});
   }
   await qa.setDirection('right');await qa.seek(.28);
   const c=document.querySelector('[data-vfx-canvas]'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let signature=2166136261,pixels=0;
   for(let i=3;i<p.length;i+=4)if(p[i]>12){pixels++;signature=Math.imul(signature^(p[i]+p[i-1]*3+p[i-2]*5+i),16777619);}
   return {results,early:{id,pixels,signature:signature>>>0}};
  },skill.id);
  for(const item of samples.results){assert(item.pixels>20,skill.id+' '+item.direction+' visible');assert.equal(item.recipe,skill.id);report.coverage.push(item);}
  assert(samples.early.pixels>0,skill.id+' visible charge');
  assert.notEqual(samples.early.signature,samples.results[0].signature,skill.id+' temporal change');
  report.phaseChecks.push(samples.early);
 }
 await page.evaluate(async()=>{const qa=window.__VFX_PREVIEW__;await qa.selectSkill('special:skill_13_1');await qa.play();});
 await page.waitForFunction(()=>window.__VFX_PREVIEW__.inspect().player.active>0&&window.__VFX_PREVIEW__.inspect().player.drawCalls>0);
 report.liveRaf=await page.evaluate(()=>window.__VFX_PREVIEW__.inspect().player);
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  for(const id of representatives){
   const sample=await page.evaluate(async id=>{const qa=window.__VFX_PREVIEW__;await qa.selectSkill(id);await qa.setDirection('right');await qa.seek(.66);const c=document.querySelector('[data-vfx-canvas]'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let pixels=0;for(let i=3;i<p.length;i+=4)if(p[i]>12)pixels++;return {id,pixels,body:qa.inspect().bodyHeight,overflow:document.documentElement.scrollWidth>innerWidth+1};},id);
   assert(sample.pixels>20,id+' mobile visible');assert.equal(sample.overflow,false,id+' mobile overflow');
   report.mobileChecks.push({width,...sample});
  }
  await page.evaluate(async()=>{await __VFX_PREVIEW__.selectSkill('special:skill_13_1');await __VFX_PREVIEW__.seek(.66);});
  const name='workshop-'+width+'.png';await page.screenshot({path:path.join(out,name),fullPage:true});report.screenshots.push(name);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const id of representatives.filter((_,i)=>i%3===0)){
  const sample=await page.evaluate(async id=>{const qa=window.__VFX_PREVIEW__;await qa.selectSkill(id);await qa.seek(.5);return{id,...qa.inspect().player};},id);
  assert(sample.reducedMotion&&sample.drawCalls>0,id+' reduced visible');report.reducedChecks.push(sample);
 }
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.setViewportSize({width:1080,height:900});
 await page.evaluate(()=>window.__VFX_PREVIEW__.destroy());
 const baseCss='body{margin:0;padding:26px;background:#0b101c;color:#eae7df;font-family:"Microsoft JhengHei",Arial,sans-serif}h1{margin:0 0 6px;font-size:25px;font-weight:700}p{color:#9cacc8;font-size:13px;margin:0 0 22px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{border:1px solid #283753;border-radius:13px;background:linear-gradient(135deg,#142237,#101621);overflow:hidden}.card h2{font-size:14px;margin:12px 12px 5px}.card small{display:block;color:#a6b5cd;font-size:10px;margin:0 12px 5px}.card canvas{display:block;width:100%;height:auto}';
 async function gallery(rows,title,file,phase=.66){
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>'+baseCss+'</style></head><body><h1></h1><p>逐技能名稱與畫面核對 · '+Math.round(phase*100)+'% 動畫階段</p><main class="grid"></main></body></html>');
  await page.evaluate(async({rows,title,phase})=>{
   document.querySelector('h1').textContent=title;
   const {buildEffectFrame,drawEffectFrame}=await import('/skill-vfx-engine.mjs');
   const {semanticFor}=await import('/skill-vfx-semantics.mjs');
   const images={};
   for(const key of ['sword','archer','mage','thief','hawk','fire-spirit','semantic']){
    const image=new Image();image.src='/art/skill-vfx-20261104/'+(key==='semantic'?'semantic-atlas':['hawk','fire-spirit'].includes(key)?key:key+'-atlas')+'.webp';await image.decode();images[key]=image;
   }
   const grid=document.querySelector('.grid');
   for(const skill of rows){
    const sem=semanticFor(skill),card=document.createElement('section');card.className='card';
    const name=document.createElement('h2');name.textContent=skill.name;card.append(name);
    const detail=document.createElement('small');detail.textContent=skill.id+' · '+sem.style;card.append(detail);
    const canvas=document.createElement('canvas');canvas.width=330;canvas.height=206;card.append(canvas);grid.append(card);
    const ctx=canvas.getContext('2d');ctx.fillStyle='#44536e';for(const x of [86,236]){ctx.beginPath();ctx.ellipse(x,151,22,6,0,0,Math.PI*2);ctx.fill();}
    const frame=buildEffectFrame(skill,phase,{from:{x:86,y:108},to:{x:236,y:108},targets:[{x:236,y:108}],bodyHeight:68,direction:'right',quality:'high',seed:skill.id});
    drawEffectFrame(ctx,images[skill.baseClass],frame,{'hawk':images.hawk,'fire-spirit':images['fire-spirit'],semantic:images.semantic});
   }
  },{rows,title,phase});
  await page.screenshot({path:path.join(out,file),fullPage:true});report.screenshots.push(file);
 }
 for(const base of ['sword','archer','mage','thief']){
  const rows=catalog.skills.filter(s=>s.baseClass===base);
  for(let i=0;i<rows.length;i+=18)await gallery(rows.slice(i,i+18),({sword:'劍士',archer:'弓箭手',mage:'法師',thief:'盜賊'}[base])+' · 技能語意 '+(Math.floor(i/18)+1),'catalog-'+base+'-'+(Math.floor(i/18)+1)+'.png');
 }
 const problemRows=representatives.slice(0,18).map(id=>catalog.skills.find(s=>s.id===id));
 for(const phase of [.32,.57,.76])await gallery(problemRows,'名稱專屬效果 · 重點複核','semantic-focus-'+Math.round(phase*100)+'.png',phase);
 assert.equal(report.errors.length,0,'page errors');assert.equal(report.httpErrors.length,0,'HTTP errors');assert.equal(report.consoleErrors.length,0,'console errors');
 report.sourceFilesAfter=await fingerprint();assert.deepEqual(report.sourceFilesAfter,sourceFiles,'sources changed during acceptance');
 report.status='passed';report.completedAt=new Date().toISOString();
 report.summary={identities:catalog.skills.length,directionCases:report.coverage.length,temporalCases:report.phaseChecks.length,mobileCases:report.mobileChecks.length,reducedMotionCases:report.reducedChecks.length,screenshots:report.screenshots.length,pageErrors:report.errors.length,httpErrors:report.httpErrors.length,sourceDrift:0};
}catch(error){failure=error;report.status='failed';report.error=String(error);report.stack=error.stack;await page?.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,out,summary:report.summary,error:report.error}));}
if(failure){console.error(failure.stack);process.exitCode=1;}
