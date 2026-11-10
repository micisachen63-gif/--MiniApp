// Full talent UI + actual service, disposable D1 only. No production requests.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import * as Player from '../src/services/player.js';
import {initializeRealmIdentity,resolveRealm,scopeEnvForRealm} from '../src/realm/index.js';
import {CATALOG,NOW} from './realm-test-helpers.js';
const require=createRequire(import.meta.url);let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'', 'playwright'));}
const browser=await playwright.chromium.launch({headless:true,...(process.env.ATLAS_BROWSER_EXECUTABLE?{executablePath:process.env.ATLAS_BROWSER_EXECUTABLE}:{})});
const root=path.resolve('worker/public'),output=path.resolve('.release-sync/atlas-talents-ui'),results=[];
await fs.mkdir(output,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.mp4':'video/mp4','.json':'application/json'};
try{for(const width of [1280,390]){
 const env={DB:freshDb(),DB_SEASON:freshDb(),REALM_CATALOG_JSON:JSON.stringify(CATALOG),CURRENT_SEASON_ID:'season_2026_01',ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true',ATLAS_ENABLED:'true'};
 await initializeRealmIdentity(env,'permanent',{now:NOW});await initializeRealmIdentity(env,'season_2026_01',{now:NOW});
 const permanent=scopeEnvForRealm(env,await resolveRealm(env,'permanent')),db=env.DB.sqlite,players=[];
 for(const [i,baseClass] of ['sword','archer','mage','thief'].entries()){
  const owner=String(91901+i),p=await Player.createCharacter(permanent,{tgId:owner,name:'天賦試玩'+i,baseClass,gender:'f'},NOW);
  db.prepare('UPDATE rpg_characters SET level=15,gold=12345,last_settle_at=? WHERE tg_id=?').run(NOW,owner);
  db.prepare('UPDATE rpg_equipment SET enhance_level=12 WHERE tg_id=?').run(owner);
  players.push({owner,baseClass,branch:{sword:'sword_whirlwind',archer:'archer_pierce',mage:'mage_chain',thief:'thief_poison'}[baseClass]});
 }
 const calls=[];
 const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://local');
  if(u.pathname.startsWith('/app/api/')){let body='';for await(const c of req)body+=c;const r=await handle(new CurrentClientRequest('http://local'+req.url,{method:req.method,headers:{...req.headers,'X-Debug-Now':String(NOW)},body}),env);const text=await r.text();calls.push({action:u.pathname.slice('/app/api/'.length),body:JSON.parse(body||'{}'),status:r.status});res.writeHead(r.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(text);return;}
  const file=path.resolve(root,'.'+decodeURIComponent(u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname));if(!file.startsWith(root+path.sep))throw Error('Invalid path');res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await fs.readFile(file));
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end(e.message)}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const p of players){
  const page=await browser.newPage({viewport:{width,height:width===390?844:960}}),errors=[],popups=[];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',pop=>{popups.push(pop.url());pop.close()});
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const gearBefore=JSON.stringify(db.prepare('SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id').all(p.owner));
  try{
   await page.goto(origin+'/?devTg='+p.owner);await page.locator('[data-select]').first().click();await page.locator('[data-atlas-sync]').filter({hasText:'更新於'}).waitFor();
   const portrait=await page.locator('[data-atlas-actor] img').getAttribute('src'),url=page.url();
   await page.locator('#atlas-world [data-atlas-open-talents]').click();await page.locator('[data-talent-guide="tutorial_start"]').waitFor();
   assert.equal(await page.locator('[data-talent-node]').count(),31);assert.equal(await page.locator('[data-talent-points]').innerText(),'3');
   await page.locator('[data-talent-guide="tutorial_start"]').click();await page.getByRole('heading',{name:'第 1／3 步：找到可用節點'}).waitFor();
   await page.locator(`[data-talent-node="${p.branch}_10"]`).click();assert.equal(await page.locator('[data-talent-allocate]').isDisabled(),true);assert.match(await page.locator('.atlas-talent-detail').innerText(),/關鍵天賦|等級未達/);
   await page.screenshot({path:path.join(output,`keystone-${p.baseClass}-${width}.png`)});
   await page.locator(`[data-talent-node="${p.branch}_1"]`).click();await page.locator('[data-talent-allocate]').evaluate(b=>{b.click();b.click()});await page.locator('#sheet [data-x="1"]').click();
   await page.getByRole('heading',{name:'第 2／3 步：確認你的選擇'}).waitFor();assert.equal(await page.locator('[data-talent-points]').innerText(),'2');
   assert.equal(JSON.parse(db.prepare('SELECT allocated_json FROM rpg_atlas_talents WHERE char_id=?').get(p.owner).allocated_json).length,1);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE tg_id=? AND type='星圖天賦' AND note LIKE '%\"kind\":\"allocate\"%'").get(p.owner).n,1);
   await page.locator('[data-talent-review]').click();await page.getByRole('heading',{name:'第 3／3 步：準備下一次出征'}).waitFor();await page.locator('[data-talent-guide="tutorial_complete"]').click();await page.getByText('✓ 引導教學已完成。仍可在下方展開配點規則。').waitFor();
   assert.equal(db.prepare('SELECT tutorial_step FROM rpg_atlas_talents WHERE char_id=?').get(p.owner).tutorial_step,2);
   await page.locator('.atlas-talent-summary').evaluate(n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(output,`tree-${p.baseClass}-${width}.png`)});
   assert.equal(await page.locator('#atlas-world').isVisible(),true);assert.equal(await page.locator('[data-atlas-actor] img').getAttribute('src'),portrait);assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.locator('[data-talent-reset]').click();await page.locator('#sheet [data-x="1"]').click();await page.waitForFunction(()=>document.querySelector('[data-talent-points]')?.textContent==='3');assert.equal(JSON.parse(db.prepare('SELECT allocated_json FROM rpg_atlas_talents WHERE char_id=?').get(p.owner).allocated_json).length,0);
   assert.equal(db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(p.owner).gold,12345);assert.equal(JSON.stringify(db.prepare('SELECT * FROM rpg_equipment WHERE tg_id=? ORDER BY id').all(p.owner)),gearBefore);
   await page.reload();await page.locator('[data-select]').first().click();await page.locator('[data-atlas-sync]').filter({hasText:'更新於'}).waitFor();await page.locator('#atlas-world [data-atlas-open-talents]').click();await page.getByText('✓ 引導教學已完成。仍可在下方展開配點規則。').waitFor();assert.equal(await page.locator('[data-talent-points]').innerText(),'3');
   assert.deepEqual(errors,[]);assert.deepEqual(popups,[]);results.push({width,baseClass:p.baseClass,nodes:31,pointBudget:3,tutorialComplete:true,oneAllocationOnDoubleClick:true,resetRefund:true,enhancePreserved:12,scenePreserved:true,reloadPersists:true,pageErrors:errors});
  }catch(e){await page.screenshot({path:path.join(output,`failure-${p.baseClass}-${width}.png`)});console.error(JSON.stringify({width,baseClass:p.baseClass,errors,lastCalls:calls.slice(-8)}));throw e;}finally{await page.close()}
 }}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();env.DB_SEASON.sqlite.close()}
}
await fs.writeFile(path.join(output,'results.json'),JSON.stringify({isolated:true,productionRequests:0,results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close()}
