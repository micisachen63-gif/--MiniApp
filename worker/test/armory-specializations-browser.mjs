// Full Mini App, exact job art and styles; UI snapshots use a disposable memory DB.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createThiefPreview} from '../scripts/thief-preview.mjs';
import {metaView} from '../src/app.js';
import {nodeFor,computeStats} from '../src/game/stats.js';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.RPG_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'docs/armory-specializations');
const rows=JSON.parse(fs.readFileSync(path.join(out,'designs.json'),'utf8')).profiles;
const sourceFiles=['worker/public/hero-fx.js','worker/public/hero-fx.css','worker/public/armory-specializations.js','worker/public/app.js','worker/public/index.html','worker/public/hero-size.js','worker/public/hero-armory.css','worker/public/hero-art-registry.json',...rows.flatMap(r=>['worker/public/'+r.art,'worker/public/'+r.particleArt])];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const frozenSources=sourceHashes();
const registry=JSON.parse(fs.readFileSync(path.join(root,'worker/public/hero-art-registry.json'),'utf8'));
const identities=rows.flatMap(row=>['m','f'].map(gender=>({...row,gender})));
const meta=metaView(),preview=await createThiefPreview({identity:{classPath:'',gender:'f',level:20,className:'盜賊'}});
const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
const cases=[],lifecycle=[],pixels=[],errors=[];
async function session(width) {
 const page=await browser.newPage({viewport:{width,height:1050}});let selected=null,angel=true;
 page.on('pageerror',e=>errors.push({width,message:e.message}));
 await page.route('**/*',async route=>{
  const url=route.request().url();if(!url.startsWith(preview.origin))return route.abort();
  if(url.includes('/app.js?'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'worker/public/app.js'),'utf8').replace('  boot();','  window.__ArmoryQA={state:S,waitRefresh:()=>refreshFlight};\n  boot();')});
  if(url.endsWith('/app/api/meta'))return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,meta,now:Date.now()})});
  if(url.endsWith('/app/api/me')&&selected) {
   const identity=selected,enabled=angel,response=await route.fetch(),data=await response.json();
   const node=nodeFor(identity.baseClass,identity.path),stats=computeStats({base_class:identity.baseClass,class_path:identity.path,level:120});
   Object.assign(data.character,{baseClass:identity.baseClass,gender:identity.gender,classPath:identity.path,classTier:identity.path.length,className:node.name,name:node.name,level:120});
   Object.assign(data.stats,stats,{passive:node.passiveText});
   if(!enabled){data.guardian=null;data.guardianAssist=null;}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  return route.continue();
 });
 await page.goto(preview.origin+'/?devTg=811');await page.locator('[data-select="811"]').click();await page.waitForFunction(()=>window.__ArmoryQA?.state.me?.character);
 async function select(identity,enabled=true) {
  selected=identity;angel=enabled;
  await page.evaluate(()=>window.__ArmoryQA.state.tab='home');await page.locator('[data-tab="bag"]').evaluate(el=>el.click());
  await page.evaluate(async()=>{await window.__ArmoryQA.waitRefresh();});
  await page.locator('.hero-armory .doll').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForFunction(id=>{const d=document.querySelector('.hero-armory .doll'),img=d?.querySelector('.fig>img');return d?.dataset.advancedArmoryFx===id&&d.dataset.fxRunning==='true'&&img?.naturalWidth>0&&img.classList.contains('hero-size-normalized');},identity.id);
 }
 async function measure(identity,{enabled=true,moving=true}={}) {
  const state=await page.evaluate(()=>{
   const el=document.querySelector('.hero-armory .doll');
   const box=n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
   const front=el.querySelector('.hero-fx--front'),img=el.querySelector('.fig>img'),animations=front.getAnimations({subtree:true});
   return {id:el.dataset.advancedArmoryFx,motion:el.dataset.fxMotion,theme:el.dataset.heroFx,art:el.style.getPropertyValue('--fx-art'),particle:el.style.getPropertyValue('--mote-art'),
    layers:el.querySelectorAll('.hero-fx').length,particles:front.querySelectorAll('.hero-fx-mote').length,animationNames:[...new Set(animations.map(a=>a.animationName))],running:animations.filter(a=>a.playState==='running').length,
    fx:box(front),frame:box(el.querySelector('.fig')),angel:el.querySelector('.hero-guardian-companion')?box(el.querySelector('.hero-guardian-companion')):null,
    pointer:getComputedStyle(front).pointerEvents,image:img.getAttribute('src'),overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  const key=`adv${identity.path.length}_${identity.baseClass}_${identity.path}_${identity.gender}`;
  assert.equal(state.id,identity.id);assert.equal(state.motion,identity.motion);assert.equal(state.theme,identity.theme);
  assert.ok(state.art.includes(identity.art));assert.ok(state.particle.includes(identity.particleArt));
  assert.ok([registry.heroes[key].hero,registry.heroes[key].portrait].includes(state.image),'Exact identity image '+key+': '+state.image);
  assert.equal(state.layers,2);assert.equal(state.particles,identity.density);assert.equal(state.pointer,'none');assert.equal(state.overflow,false);
  assert.equal(state.running,moving?identity.density+1:0);
  if(moving)assert.ok(state.animationNames.includes('armory-'+identity.motion));
  for(const k of ['left','right','top','bottom'])assert.ok(Math.abs(state.fx[k]-state.frame[k])<.1,'Frame '+k);
  if(enabled){assert.ok(state.angel);assert.ok(state.fx.top-state.angel.bottom>=5.9,'Angel gap '+key);}else assert.equal(state.angel,null);
  return {id:identity.id,gender:identity.gender,width,angelEnabled:enabled,moving,...state};
 }
 try {
  for(const [i,identity] of identities.entries()) {
   await select(identity);cases.push(await measure(identity));
   if(width===390&&identity.gender==='f') {
    const motion=await page.locator('.hero-fx--front .hero-fx-mote').first().evaluate(el=>({time:el.getAnimations()[0].currentTime,transform:getComputedStyle(el).transform}));
    await page.waitForFunction(before=>{const el=document.querySelector('.hero-fx--front .hero-fx-mote');return el.getAnimations()[0].currentTime>before.time+120&&getComputedStyle(el).transform!==before.transform;},motion);
    lifecycle.push({id:identity.id,check:'motion-advances',passed:true});
    if(['A11','A111','B12','B112','B21','B222'].includes(identity.path))await page.locator('.hero-armory .doll').screenshot({type:'jpeg',quality:78,path:path.join(out,identity.id+'.jpg')});
    await select(identity,false);cases.push(await measure(identity,{enabled:false}));
    await page.emulateMedia({reducedMotion:'reduce'});await measure(identity,{enabled:false,moving:false});
    await page.emulateMedia({reducedMotion:'no-preference'});lifecycle.push({id:identity.id,check:'reduced-motion',passed:true});
    await page.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
    await page.waitForFunction(()=>document.querySelector('.hero-armory .doll').dataset.fxRunning==='false');
    await measure(identity,{enabled:false,moving:false});lifecycle.push({id:identity.id,check:'offscreen-paused',passed:true});
    await page.locator('[data-tab="home"]').evaluate(el=>el.click());assert.equal(await page.locator('.hero-fx').count(),0);lifecycle.push({id:identity.id,check:'leave-armory',passed:true});
   }
   if((i+1)%48===0)console.log(JSON.stringify({width,identities:i+1}));
  }
  if(width===390) {
   for(const row of rows) {
    const result=await page.evaluate(async row=>{
     const image=new Image();image.src='/'+row.art;await image.decode();const c=document.createElement('canvas');c.width=400;c.height=600;const g=c.getContext('2d');g.drawImage(image,0,0,400,600);
     const rgba=g.getImageData(0,0,400,600).data;let center=0,edge=0;
     for(let y=0;y<500;y++)for(let x=0;x<400;x++)if(rgba[(y*400+x)*4+3]>8){if(x>=140&&x<260)center++;else edge++;}
     const particle=new Image();particle.src='/'+row.particleArt;await particle.decode();
     g.clearRect(0,0,400,600);g.drawImage(particle,0,0,76,76);const p=g.getImageData(0,0,76,76).data;let particlePixels=0;for(let i=3;i<p.length;i+=4)if(p[i]>8)particlePixels++;
     return {center,edge,particleLoaded:particle.naturalWidth>0,particlePixels};
    },row);assert.equal(result.center,0);assert.ok(result.edge>500&&result.particleLoaded&&result.particlePixels>80);pixels.push({id:row.id,...result});
   }
   // Review sheet: all 24 original ornaments per class, with exact job labels.
   await page.unroute('**/*');
   await page.route('**/__armory-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
   await page.goto(preview.origin+'/__armory-review');
   for(const cls of ['sword','archer','mage','thief']) {
    await page.setViewportSize({width:1200,height:1800});
    await page.setContent(`<body style="margin:0;padding:16px;background:#101b2e;color:#eee4cc;font:14px sans-serif"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px">${rows.filter(r=>r.baseClass===cls).map(r=>`<article style="background:#18283c;border:1px solid #7c704f;padding:6px"><b>${r.path} · ${r.name}</b><div style="height:300px;background:url('${preview.origin}/${r.art}') center/contain no-repeat"></div><small>${r.brief} · ${r.motion}</small></article>`).join('')}</div></body>`);
    await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));
    // Decode CSS image sources explicitly before taking the review sheet.
    await page.evaluate(async urls=>Promise.all(urls.map(url=>{const img=new Image();img.src=url;return img.decode();})),rows.filter(r=>r.baseClass===cls).map(r=>preview.origin+'/'+r.art));
    await page.screenshot({fullPage:true,type:'jpeg',quality:85,path:path.join(out,cls+'-all-24.jpg')});
   }
  }
 }catch(e){await page.screenshot({path:path.join(root,'.release-sync',`advanced-armory-failure-${width}.png`)});throw e;}
 finally {await page.close();}
}
try {
 const result=await Promise.allSettled([320,390,768,1280].map(session));for(const r of result)if(r.status==='rejected')throw r.reason;
 assert.equal(cases.length,864);assert.equal(lifecycle.length,384);assert.equal(pixels.length,96);assert.deepEqual(errors,[]);
 const sourceSHA256=sourceHashes();assert.deepEqual(sourceSHA256,frozenSources,'Source changed during the browser run');
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,actualAppBootstrap:true,isolatedInMemoryFixture:true,mockUiCharacterOverride:true,productionWrites:false,jobs:96,identities:192,widths:[320,390,768,1280],cases,lifecycle,pixels,errors,sourceSHA256})+'\n');
 console.log(JSON.stringify({passed:true,cases:cases.length,lifecycle:lifecycle.length,pixels:pixels.length}));
}finally {await browser.close();await preview.close();}
