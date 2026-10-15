import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createThiefPreview} from '../scripts/thief-preview.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'docs/thief/pilot-ui');fs.mkdirSync(output,{recursive:true});
const preview=await createThiefPreview(),browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage();page.setDefaultTimeout(12000);
const errors=[],badResponses=[],cases=[],actions=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('response',async response=>{if(response.url().startsWith(preview.origin)&&response.status()>=400)badResponses.push({url:response.url().slice(preview.origin.length),status:response.status(),body:(await response.text().catch(()=>'' )).slice(0,500)});});
await page.route('**/*',async route=>{
 const url=route.request().url();if(!url.startsWith(preview.origin))return route.abort();
 if(url.includes('/app.js?')){
  const source=fs.readFileSync(path.join(root,'worker/public/app.js'),'utf8');
  return route.fulfill({status:200,contentType:'text/javascript',body:source.replace('  boot();','  window.__ThiefQA={battle:BATTLE,state:S,heroKey,artSrc,lineagePortrait};\n  boot();')});
 }
 return route.continue();
});
async function measure(scope,selector,surface,width,screenshotSelector){
 const locator=scope.locator(selector).first();await locator.waitFor({state:'visible'});await locator.scrollIntoViewIfNeeded();
 await locator.evaluate(image=>image.decode());
 await scope.waitForFunction(selector=>{const image=document.querySelector(selector);return image?.naturalWidth>0&&image.classList.contains('hero-size-normalized');},selector,{timeout:15000});
 const result=await locator.evaluate(image=>{
  const r=image.getBoundingClientRect(),parent=image.parentElement.getBoundingClientRect(),canvas=document.createElement('canvas');
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const g=canvas.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0);
  const pixels=g.getImageData(0,0,canvas.width,canvas.height).data;let left=canvas.width,top=canvas.height,right=-1,bottom=-1,transparent=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const alpha=pixels[(y*canvas.width+x)*4+3];if(alpha<=8){transparent++;continue;}left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const absolute={left:r.left+left*r.width/canvas.width,top:r.top+top*r.height/canvas.height,right:r.left+(right+1)*r.width/canvas.width,bottom:r.top+(bottom+1)*r.height/canvas.height};
  const visible={left:absolute.left-parent.left,top:absolute.top-parent.top,right:absolute.right-parent.left,bottom:absolute.bottom-parent.top};
  return {src:image.getAttribute('src'),native:{width:canvas.width,height:canvas.height,alphaBounds:{left,top,right:right+1,bottom:bottom+1},transparentFraction:transparent/(canvas.width*canvas.height)},parent:{width:parent.width,height:parent.height},visible,absolute,normalized:true,clipped:visible.left<-.8||visible.top<-.8||visible.right>parent.width+.8||visible.bottom>parent.height+.8,overflow:document.documentElement.scrollWidth>innerWidth+1};
 });
 const registry=JSON.parse(fs.readFileSync(path.join(root,'worker/public/hero-art-registry.json'),'utf8')).heroes.thief_f;
 assert.ok([registry.hero,registry.portrait,'/'+registry.hero,'/'+registry.portrait].includes(result.src),'wrong thief image '+surface);
 assert.ok(!result.clipped,surface+' alpha clips '+JSON.stringify(result));assert.ok(!result.overflow,surface+' horizontal overflow');assert.ok(result.native.transparentFraction>.1,'opaque background');
 const file=`${width}-${surface}.png`;await scope.locator(screenshotSelector||selector).first().screenshot({path:path.join(output,file)});
 const record={surface,width,screenshot:'docs/thief/pilot-ui/'+file,...result};cases.push(record);return record;
}
try{
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:1050});await page.goto(preview.origin+'/?devTg=811');
  await page.locator('[data-select="811"]').click();await page.waitForFunction(()=>window.__ThiefQA?.state.me?.character.baseClass==='thief');
  await measure(page,'#pt','home',width,'.my-vitals');
  await page.locator('[data-tab="class"]').click();await page.locator('[data-panel="destiny"]').click();
  await measure(page,'#cpt','lineage-current',width,'.lc-class-screen');
  await page.locator('[data-panel="lineage"]').click();
  await measure(page,'[data-lineage-key="thief_f"]','lineage-tree',width,'.thief-ancestry .elf-tier');
  await page.locator('[data-tab="bag"]').click();
  const own=await measure(page,'.hero-armory .fig>img','own-armory',width,'.hero-armory');
  await page.waitForFunction(()=>document.querySelector('.hero-armory .hero-guardian-companion img')?.naturalWidth>0);
  const angel=await page.evaluate(()=>{
   const stage=document.querySelector('.hero-armory .doll'),figure=stage.querySelector('.fig'),guardian=stage.querySelector('.hero-guardian-companion'),gi=guardian.querySelector('img');
   const dr=stage.getBoundingClientRect(),fr=figure.getBoundingClientRect(),gr=guardian.getBoundingClientRect(),ir=gi.getBoundingClientRect();
   const box=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
   return {guardianSrc:gi.getAttribute('src'),summoned:stage.classList.contains('has-hero-companion'),guardianOutsideFigure:guardian.parentElement===stage,headGap:fr.top-gr.bottom,inside:gr.left>=dr.left-.5&&gr.top>=dr.top-.5&&gr.right<=dr.right+.5&&gr.bottom<=dr.bottom+.5&&ir.top>=dr.top-.5&&ir.bottom<=dr.bottom+.5,stage:box(dr),figure:box(fr),guardian:box(gr)};
  });
  assert.ok(angel.summoned&&angel.guardianOutsideFigure&&angel.inside);assert.ok(angel.headGap>=5,'angel gap');own.angel=angel;
  await page.locator('[data-tab="trade"]').click();await page.locator('[data-soc="hall"]').click();
  await measure(page,'[data-hall-hero="812"] img','hero-hall',width,'.hero-hall');
  await page.locator('[data-hall-hero="812"]').click();await measure(page,'.hall-loadout .fig>img','other-armory',width,'.hall-loadout');console.log('closing hall '+width);await page.locator('[data-hall-close]').evaluate(button=>button.click());console.log('closed hall '+width);
  console.log('home before iframe '+width);await page.locator('[data-tab="home"]').click({force:true});
  console.log('opening expedition '+width);
  await page.evaluate(()=>{window.Telegram={WebApp:{initData:'thief-local-ui-fixture'}};RpgExpeditionOpen('skills');});
  console.log('opened expedition '+width);
  const frame=page.frameLocator('#expedition-overlay iframe');
  const inner=await page.locator('#expedition-overlay iframe').elementHandle();const content=await inner.contentFrame();
  await measure(content,'.expedition-hero-portrait img','expedition-card',width,'#main>.hero');
  await page.locator('#expedition-overlay>header button').click();
  console.log(JSON.stringify({width,surfaces:'passed',angelGap:angel.headGap}));
 }
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(badResponses.length,0,JSON.stringify(badResponses));
 const sources=Object.fromEntries([...preview.served].filter(([file])=>/\.(js|css|html|json|png|webp)$/.test(file)).map(([file,bytes])=>[path.relative(root,file).replaceAll('\\','/'),crypto.createHash('sha256').update(bytes).digest('hex')]));
 sources['worker/public/app.js']=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'worker/public/app.js'))).digest('hex');
 fs.writeFileSync(path.join(output,'verified.json'),JSON.stringify({passed:true,actualAppBootstrap:true,isolatedInMemoryFixture:true,productionWrites:false,productReleaseReady:false,mockMetaOverride:true,identity:'thief_f',widths:[320,390,768,1280],cases,actions,errors,badResponses,sourceSHA256:sources,apiRequests:preview.requests},null,2));
 console.log(JSON.stringify({passed:true,cases:cases.length}));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,cases,errors,badResponses,body:await page.locator('body').innerText().catch(()=>'' ),apiRequests:preview.requests},null,2));throw error;}
finally{await browser.close();await preview.close();}
