// Actual Mini App and CSS, with read-only APIs backed by a disposable memory fixture.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createThiefPreview} from '../scripts/thief-preview.mjs';
import {metaView} from '../src/app.js';
import {THIEF_IDENTITIES} from '../src/game/thief-data.js';
import {nodeFor,computeStats} from '../src/game/stats.js';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.RPG_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'docs/thief/armory-fx-20261016');fs.mkdirSync(output,{recursive:true});
const meta=metaView(),preview=await createThiefPreview({identity:{classPath:'',gender:'f',level:20,className:'盜賊'}});
const browser=await playwright.chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
const errors=[],cases=[],lifecycle=[],artChecks=[];page.on('pageerror',e=>errors.push(e.message));
let selectedIdentity=null,selectedAngel=true;
await page.route('**/*',async route=>{
  const url=route.request().url();if(!url.startsWith(preview.origin))return route.abort();
  if(url.includes('/app.js?'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'worker/public/app.js'),'utf8').replace('  boot();','  window.__ArmoryQA={state:S,waitRefresh:()=>refreshFlight};\n  boot();')});
  if(url.endsWith('/app/api/meta'))return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,meta,now:Date.now()})});
  if(url.endsWith('/app/api/me')&&selectedIdentity) {
    const identity=selectedIdentity,angel=selectedAngel,response=await route.fetch(),data=await response.json();
    const node=nodeFor('thief',identity.classPath),stats=computeStats({base_class:'thief',class_path:identity.classPath,level:120});
    Object.assign(data.character,{baseClass:'thief',gender:identity.gender,classPath:identity.classPath,classTier:identity.classPath.length,className:node.name,level:120});
    Object.assign(data.stats,stats,{passive:node.passiveText});
    if(!angel){data.guardian=null;data.guardianAssist=null;}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  return route.continue();
});
async function select(identity,width,{angel=true}={}) {
  selectedIdentity=identity;selectedAngel=angel;
  const classPath=identity.classPath,node=nodeFor('thief',classPath),stats=computeStats({base_class:'thief',class_path:classPath,level:120});
  await page.setViewportSize({width,height:1050});
  await page.evaluate(({identity,node,stats,angel})=>{
    const s=window.__ArmoryQA.state;s.tab='home';
    s.me.guardian=angel?s.fixtureGuardian:null;s.me.guardianAssist=angel?s.fixtureAssist:null;
    Object.assign(s.me.character,{baseClass:'thief',gender:identity.gender,classPath:identity.classPath,classTier:identity.classPath.length,className:node.name,level:120});
    Object.assign(s.me.stats,stats,{passive:node.passiveText});
  },{identity,node,stats,angel});
  await page.locator('[data-tab="bag"]').click();
  await page.evaluate(async()=>{await window.__ArmoryQA.waitRefresh();});
  await page.locator('.hero-armory .doll').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForFunction(()=>{const doll=document.querySelector('.hero-armory .doll'),image=doll?.querySelector('.fig>img');return doll?.dataset.fxRunning==='true'&&image?.naturalWidth>0&&image.classList.contains('hero-size-normalized');});
}
async function measure(identity,width,angel=true) {
  const state=await page.locator('.hero-armory .doll').evaluate(el=>{
    const rect=n=>{const b=n.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
    const front=el.querySelector('.hero-fx--front'),frame=el.querySelector('.fig'),companion=el.querySelector('.hero-guardian-companion');
    const animations=front.getAnimations({subtree:true});
    return {theme:el.dataset.heroFx,motif:el.dataset.thiefArmoryFx,running:el.dataset.fxRunning,art:el.style.getPropertyValue('--fx-art'),
      particles:front.querySelectorAll('.hero-fx-mote').length,animationNames:[...new Set(animations.map(a=>a.animationName))],runningAnimations:animations.filter(a=>a.playState==='running').length,
      pointerEvents:getComputedStyle(front).pointerEvents,fx:rect(front),frame:rect(frame),angel:companion?rect(companion):null,
      image:frame.querySelector('img').getAttribute('src'),pageOverflow:document.documentElement.scrollWidth>innerWidth+1,
      layers:el.querySelectorAll('.hero-fx').length};
  });
  const p=identity.classPath,motif=p.startsWith('A2')?'venom':p.startsWith('B2')?'mirror':p.startsWith('B')?'flying':'shadow';
  assert.equal(state.theme,'thief-'+motif);assert.equal(state.motif,motif);assert.equal(state.pointerEvents,'none');
  assert.equal(state.layers,2);assert.equal(state.particles,p.length>=2?8:6);assert.equal(state.pageOverflow,false);
  assert.ok(state.art.includes('/thief-'+motif+'.svg'));assert.ok(state.image.includes(p?`adv${p.length}_thief_${p}_${identity.gender}`:`thief_${identity.gender}`));
  for(const key of ['left','top','right','bottom'])assert.ok(Math.abs(state.fx[key]-state.frame[key])<.1,'effect frame '+key);
  if(angel){assert.ok(state.angel);assert.ok(state.fx.top-state.angel.bottom>=5.9,'angel overlap');}else assert.equal(state.angel,null);
  return {identity:`${p||'base'}:${identity.gender}`,width,angelEnabled:angel,...state};
}
try {
  await page.goto(preview.origin+'/?devTg=811');await page.locator('[data-select="811"]').click();await page.waitForFunction(()=>window.__ArmoryQA?.state.me?.character);
  await page.evaluate(()=>{const s=window.__ArmoryQA.state;s.fixtureGuardian=s.me.guardian;s.fixtureAssist=s.me.guardianAssist;});
  for(const width of [320,390,768,1280])for(const identity of THIEF_IDENTITIES) {
    await select(identity,width);const state=await measure(identity,width);assert.equal(state.runningAnimations,state.particles+1);cases.push(state);
    if(width===390&&identity.gender==='f'&&['A111','A211','B111','B211'].includes(identity.classPath)) {
      // Prove that the CSS animation timeline actually advances.
      const motion=await page.locator('.hero-fx--front .hero-fx-mote').first().evaluate(el=>{const a=el.getAnimations()[0];return {time:a.currentTime,transform:getComputedStyle(el).transform};});
      await page.waitForFunction(before=>{const el=document.querySelector('.hero-fx--front .hero-fx-mote');return el.getAnimations()[0].currentTime>before.time+150&&getComputedStyle(el).transform!==before.transform;},motion);
      await page.locator('.hero-armory .doll').screenshot({type:'jpeg',quality:82,path:path.join(output,state.motif+'.jpg')});
    }
  }
  for(const p of ['A111','A211','B111','B211']) {
    const identity=THIEF_IDENTITIES.find(n=>n.classPath===p&&n.gender==='f');
    await select(identity,390,{angel:false});cases.push(await measure(identity,390,false));
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced=await measure(identity,390,false);assert.equal(reduced.runningAnimations,0);
    lifecycle.push({motif:reduced.motif,check:'reduced-motion',passed:true});await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
    await page.waitForFunction(()=>document.querySelector('.hero-armory .doll').dataset.fxRunning==='false');
    assert.equal((await measure(identity,390,false)).runningAnimations,0);
    lifecycle.push({motif:reduced.motif,check:'offscreen-paused',passed:true});
    await page.locator('[data-tab="home"]').click();assert.equal(await page.locator('.hero-fx').count(),0);
    lifecycle.push({motif:reduced.motif,check:'leave-armory',passed:true});
  }
  assert.deepEqual(errors,[]);
  for(const motif of ['shadow','venom','flying','mirror']) {
    const pixels=await page.evaluate(async motif=>{
      const img=new Image();img.src='/art/ui/thief-armory-fx-20261016/thief-'+motif+'.svg';await img.decode();
      const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;const g=canvas.getContext('2d');g.drawImage(img,0,0,400,600);
      const data=g.getImageData(0,0,400,600).data;let center=0,sides=0;
      for(let y=0;y<500;y++)for(let x=0;x<400;x++)if(data[(y*400+x)*4+3]>8){if(x>=140&&x<260)center++;else sides++;}
      return {center,sides};
    },motif);
    assert.equal(pixels.center,0);assert.ok(pixels.sides>500);artChecks.push({motif,...pixels});
  }
  const sources=['worker/public/hero-fx.js','worker/public/hero-fx.css','worker/public/hero-armory.css','worker/public/hero-size.js','worker/public/app.js','worker/public/index.html',...['shadow','venom','flying','mirror'].map(m=>'worker/public/art/ui/thief-armory-fx-20261016/thief-'+m+'.svg')];
  const sourceSHA256=Object.fromEntries(sources.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,actualAppBootstrap:true,isolatedInMemoryFixture:true,mockUiCharacterOverride:true,productionWrites:false,identities:62,widths:[320,390,768,1280],cases,lifecycle,artChecks,errors,sourceSHA256},null,2)+'\n');
  console.log(JSON.stringify({passed:true,cases:cases.length,lifecycle:lifecycle.length}));
}catch(e){await page.screenshot({path:path.join(output,'failure.png')});throw e;}
finally {await browser.close();await preview.close();}
