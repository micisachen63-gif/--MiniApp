// Run after node worker/tools/atlas-local-preview.mjs --port=9642. Synthetic local data only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'', 'playwright'));}
const {chromium}=playwright;
const origin=new URL(process.env.ATLAS_PREVIEW_ORIGIN||'http://127.0.0.1:9642').origin;
if(new URL(origin).protocol!=='http:'||new URL(origin).hostname!=='127.0.0.1')throw Error('Only loopback previews are allowed');
const health=await (await fetch(origin+'/__preview/health')).json();
if(health.isolated!==true||health.productionAccess!==false||health.ephemeral!==true)throw Error('Expected disposable isolated Atlas preview');
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.ATLAS_BROWSER_EXECUTABLE?{executablePath:process.env.ATLAS_BROWSER_EXECUTABLE}:{})});
const out='.release-sync/scene-windows';fs.mkdirSync(out,{recursive:true});const results=[];
try{for(const [width,height] of [[1280,960],[390,844],[844,390]]){
 const page=await browser.newPage({viewport:{width,height}}),errors=[],popups=[];
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',p=>{popups.push(p.url());p.close()});
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin+'/?devTg=90101');await page.locator('[data-select]').first().click();await page.locator('[data-atlas-sync]').filter({hasText:'更新於'}).waitFor();
 const originalUrl=page.url(),portrait=await page.locator('[data-atlas-actor] img').getAttribute('src'),states=[];
 async function checkWindow(selector){
  const state=await page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,right:innerWidth-r.right,bottom:innerHeight-r.bottom,bg:s.backgroundColor,alpha:Number(s.backgroundColor.match(/,\s*([\d.]+)\)$/)?.[1]??1)}});
  assert.ok(state.x>=10&&state.right>=10,JSON.stringify(state));assert.ok(state.y>=20&&state.bottom>=20,JSON.stringify(state));assert.ok(state.alpha<.86,JSON.stringify(state));
  assert.equal(await page.locator('#atlas-world').isVisible(),true);assert.equal(await page.locator('[data-atlas-actor] img').getAttribute('src'),portrait);assert.equal(page.url(),originalUrl);
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);return state;
 }
 for(const group of ['expedition','build','workshop','companions','social','records']){
  await page.locator(`[data-atlas-group="${group}"]`).click();await page.locator('#atlas-panel:not([hidden])').waitFor();states.push({group,...await checkWindow('.atlas-panel-card')});
  assert.equal(await page.locator('#atlas-world').evaluate(n=>n.inert),true);
  if(group==='build')await page.screenshot({path:`${out}/build-${width}.png`});
  await page.locator('#atlas-panel .atlas-close').click();assert.equal(await page.locator('#atlas-world').evaluate(n=>n.inert),false);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 }
 for(const [group,route] of [['build','bag'],['workshop','shop'],['companions','guardian:summon'],['social','hall']]){
  await page.locator(`[data-atlas-group="${group}"]`).click();await page.locator(`[data-atlas-route="${route}"]`).click();await page.locator('#atlas-legacy:not([hidden])').waitFor();states.push({route,...await checkWindow('#atlas-legacy')});
  if(route==='bag'){
    await page.screenshot({path:`${out}/equipment-${width}.png`});
    await page.evaluate(()=>window.RpgExpeditionOpen('skills'));await page.locator('#expedition-overlay').waitFor();await page.locator('#expedition-overlay>header button').click();
    assert.equal(await page.locator('#atlas-legacy').isVisible(),true);assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  }
  await page.locator('[data-atlas-legacy-close]').click();await page.locator('#atlas-legacy').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.equal(await page.locator('#atlas-world').evaluate(n=>n.inert),false);
 }
 await page.locator('[data-atlas-group="build"]').click();await page.locator('[data-atlas-route="skills"]').click();const skill=page.frameLocator('#expedition-overlay iframe');await skill.locator('html.atlas-scene-frame').waitFor();await skill.locator('#profile-button').waitFor();
 await page.waitForFunction(()=>{const f=document.querySelector('#expedition-overlay iframe');return f?.contentDocument?.querySelector('#atlas-scene-frame-style')?.sheet});
 states.push({route:'skills',...await checkWindow('#expedition-overlay')});assert.equal(await skill.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');await page.screenshot({path:`${out}/skills-${width}.png`});await page.locator('#expedition-overlay>header button').click();assert.equal(await page.locator('#app').evaluate(n=>n.inert),false);
 await page.locator('[data-atlas-direct="fate"]').click();const fate=page.frameLocator('.fate-overlay iframe');await fate.locator('html.atlas-scene-frame').waitFor();await fate.locator('#fate-birth').waitFor();states.push({route:'fate',...await checkWindow('.fate-overlay')});await page.waitForFunction(()=>{const f=document.querySelector('.fate-overlay iframe');return f?.contentDocument?.querySelector('#atlas-scene-frame-style')?.sheet});assert.equal(await fate.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');await page.screenshot({path:`${out}/fate-${width}.png`});await page.locator('.fate-overlay-close').click();
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.equal(await page.locator('#app').evaluate(n=>n.inert),false);assert.equal(page.url(),originalUrl);assert.deepEqual(errors,[]);assert.deepEqual(popups,[]);
 results.push({width,height,states,pageErrors:errors,popups,scenePreserved:true});await page.close();
}}finally{await browser.close()}
fs.writeFileSync(`${out}/results.json`,JSON.stringify({isolated:true,productionRequests:0,results},null,2));console.log(JSON.stringify(results.map(({width,height,states,...rest})=>({width,height,windows:states.length,...rest}))));
})().catch(e=>{console.error(e);process.exitCode=1});
