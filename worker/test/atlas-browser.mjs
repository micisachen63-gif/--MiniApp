// Full frontend with the real API and two isolated in-memory D1 databases.
// Run manually: node worker/test/atlas-browser.mjs. Never contacts production.
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

const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'', 'playwright'));}
const browser=await playwright.chromium.launch({headless:true,...(process.env.ATLAS_BROWSER_EXECUTABLE?{executablePath:process.env.ATLAS_BROWSER_EXECUTABLE}:{})});
const root=path.resolve('worker/public'),output=path.resolve('.release-sync/atlas-ui'),results=[],includeQuests=process.env.ATLAS_BROWSER_SCOPE!=='legacy';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.mp4':'video/mp4','.json':'application/json'};
await fs.mkdir(output,{recursive:true});
try {
  for(const width of [1280,390]) {
    const env={DB:freshDb(),DB_SEASON:freshDb(),REALM_CATALOG_JSON:JSON.stringify(CATALOG),CURRENT_SEASON_ID:'season_2026_01',ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true',ATLAS_ENABLED:'true'};
    await initializeRealmIdentity(env,'permanent',{now:NOW});await initializeRealmIdentity(env,'season_2026_01',{now:NOW});
    const permanent=scopeEnvForRealm(env,await resolveRealm(env,'permanent'));
    const a=(await Player.createCharacter(permanent,{tgId:'90101',charSlot:1,name:'月桂旅人',baseClass:'sword',gender:'f'},NOW)).char.tg_id;
    const b=(await Player.createCharacter(permanent,{tgId:'90101',charSlot:2,name:'祕法旅人',baseClass:'mage',gender:'m'},NOW)).char.tg_id;
    const db=env.DB.sqlite;db.prepare('UPDATE rpg_characters SET level=15,last_settle_at=? WHERE tg_id=?').run(NOW,a);
    db.prepare('UPDATE rpg_equipment SET enhance_level=7 WHERE tg_id=? AND slot=\'weapon\'').run(a);
    for(const item of ['red_1','blue_1'])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,20) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=20').run(a,item);
    for(const material of ['atlas_shard','atlas_iron','atlas_ember','atlas_venom'])db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,50)').run(a,material);
    const weapon=db.prepare("SELECT id FROM rpg_equipment WHERE tg_id=? AND slot='weapon'").get(a).id;
    let clock=NOW;const calls=[],errors=[];
    const server=http.createServer(async(req,res)=>{
      try {
        const url=new URL(req.url,'http://local');
        if(url.pathname.startsWith('/app/api/')){
          let body='';for await(const part of req)body+=part;
          const response=await handle(new CurrentClientRequest('http://local'+req.url,{method:req.method,headers:{...req.headers,'X-Debug-Now':String(clock)},body}),env);
          const text=await response.text();calls.push({action:url.pathname.slice('/app/api/'.length),realm:req.headers['x-realm-id'],body:JSON.parse(body||'{}'),status:response.status});
          res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(text);return;
        }
        const requested=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname,file=path.resolve(root,'.'+decodeURIComponent(requested));
        if(!file.startsWith(root+path.sep))throw Error('Invalid path');
        const content=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
      }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end(error.message);}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
    const page=await browser.newPage({viewport:{width,height:width===390?844:960}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.__atlasErrorToasts=[];document.addEventListener('DOMContentLoaded',()=>{const toast=document.getElementById('toast');if(toast)new MutationObserver(()=>{if(!toast.hidden&&toast.classList.contains('err')&&toast.textContent)window.__atlasErrorToasts.push(toast.textContent);}).observe(toast,{attributes:true,childList:true,subtree:true});},{once:true});});
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    const closePanel=()=>page.locator('#atlas-panel .atlas-close').click();
    const choose=async id=>{await page.locator(`[data-select="${id}"]`).click();await page.waitForFunction(()=>document.querySelector('[data-atlas-sync]')?.textContent.startsWith('更新於'));};
    const group=async name=>{await page.locator(`[data-atlas-group="${name}"]`).click();await page.locator('#atlas-panel').waitFor({state:'visible'});};
    try {
      await page.goto(origin+'/?devTg=90101');await choose(a);
      assert.equal(await page.locator('[data-atlas-group]').count(),6);assert.match(await page.locator('[data-atlas-stats]').innerText(),/月桂旅人/);
      if(includeQuests)await page.locator('.atlas-quest-preview strong').filter({hasText:'選好你的流派'}).waitFor();
      await page.screenshot({path:path.join(output,`camp-${width}.png`)});

      await group('companions');assert.equal(await page.locator('[data-atlas-route^="guardian:"]').count(),2);await page.locator('[data-atlas-route="guardian:inventory"]').click();
      await page.locator('#guardian-root .guardian-inventory').waitFor();await page.locator('[data-atlas-legacy-close]').click();assert.equal(await page.locator('#atlas-legacy').isHidden(),true);
      await page.locator('[data-atlas-direct="guardian:summon"]').click();await page.waitForFunction(()=>{const button=document.querySelector('#guardian-root [data-guardian-action="summon"]:not([data-guardian-count])');return button&&!button.disabled;});
      await page.screenshot({path:path.join(output,`guardian-${width}.png`)});
      await page.locator('#guardian-root [data-guardian-start-pull]').press('Enter');await page.waitForFunction(()=>document.querySelector('#guardian-root .guardian-stage-notice')?.textContent.includes('已取得 1 根守護羽毛'));
      assert.equal(calls.filter(call=>call.action==='guardian/summon').length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE char_id=?').get(a).n,1);await page.locator('[data-atlas-legacy-close]').click();
      await group('companions');await page.locator('[data-atlas-route="guardian:inventory"]').click();await page.locator('#guardian-root .guardian-item-management summary').click();await page.locator('#guardian-root [data-guardian-action="activate"]').click();await page.locator('#sheet [data-x="1"]').click();
      await page.waitForFunction(()=>document.querySelector('#guardian-root [data-guardian-action="activate"]')?.textContent==='取消守護');assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE char_id=? AND active=1').get(a).n,1);await page.locator('[data-atlas-legacy-close]').click();
      await page.locator('[data-atlas-direct="fate"]').click();await page.locator('.fate-overlay iframe').waitFor();const birth=page.frameLocator('.fate-overlay iframe').locator('#fate-birth');await birth.fill('2000-01-01');assert.equal(await birth.inputValue(),'2000-01-01');await page.frameLocator('.fate-overlay iframe').getByRole('button',{name:'展開我的旅章'}).waitFor();await birth.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`fate-${width}.png`),animations:'disabled'});await page.locator('.fate-overlay-close').click();await page.locator('.fate-overlay').waitFor({state:'detached'});assert.equal(await page.locator('#atlas-legacy').isHidden(),true);
      await group('build');await page.locator('[data-atlas-route="skills"]').click();await page.frameLocator('#expedition-overlay iframe').locator('#profile-button').filter({hasText:'月桂旅人'}).waitFor();await page.screenshot({path:path.join(output,`skills-${width}.png`),animations:'disabled'});await page.locator('#expedition-overlay>header button').click();await page.locator('#expedition-overlay').waitFor({state:'detached'});

      await group('expedition');await page.locator('[name="mapId"][value="laurel_intro"]').check();
      assert.equal(await page.locator('[name="queueMode"]').inputValue(),'duration');assert.equal(await page.locator('[name="mapCount"]').isDisabled(),true);
      await page.locator('[name="queueMode"]').evaluate(node=>node.scrollIntoView({block:'center'}));
      await page.screenshot({path:path.join(output,`duration-options-${width}.png`)});
      await page.locator('[name="queueMode"]').selectOption('count');await page.locator('[name="mapCount"]').fill('1');await page.locator('[name="durationMinutes"]').fill('60');await page.locator('[name="hp"]').fill('3');await page.locator('[name="mp"]').fill('4');
      await page.locator('[data-atlas-expedition] button[type="submit"]').click();await page.locator('[data-atlas-stop]').waitFor();
      assert.equal(calls.filter(call=>call.action==='atlas/start').length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_atlas_runs').get().n,1);assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='red_1'").get(a).quantity,17);
      env.ATLAS_ENABLED='false';await page.locator('[data-atlas-refresh]').click();await page.getByText('新星圖出征與製作暫停開放；現有探索仍可同步或停止，結束時退還剩餘補給。').waitFor();
      clock+=600000;await page.locator('[data-atlas-settle]').click();await page.locator('[data-atlas-stop]').waitFor({state:'detached'});await page.locator('[data-atlas-settle]').waitFor({state:'visible'});
      await page.screenshot({path:path.join(output,`report-${width}.png`)});const reportCount=db.prepare('SELECT COUNT(*) n FROM rpg_ledger WHERE event_id LIKE \'atlas:%\'').get().n;
      await page.locator('[data-atlas-settle]').click();await page.waitForFunction(()=>!document.querySelector('[data-atlas-settle]')?.disabled);assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_ledger WHERE event_id LIKE \'atlas:%\'').get().n,reportCount);await closePanel();

      env.ATLAS_ENABLED='true';await group('expedition');await page.locator('[name="queueMode"]').selectOption('duration');
      assert.equal(await page.locator('[name="mapCount"]').isDisabled(),true);
      await page.locator('[name="durationMinutes"]').fill('1');await page.locator('[name="hp"]').fill('5');await page.locator('[name="mp"]').fill('5');
      await page.locator('[data-atlas-expedition] button[type="submit"]').click();await page.locator('[data-atlas-stop]').waitFor();
      const durationCall=calls.filter(call=>call.action==='atlas/start').at(-1);assert.equal(durationCall.body.queueMode,'duration');assert.equal(Object.hasOwn(durationCall.body,'mapCount'),false);
      clock+=60000;await page.locator('[data-atlas-settle]').click();await page.locator('[data-atlas-stop]').waitFor({state:'detached'});
      const durationState=JSON.parse(db.prepare('SELECT state_json FROM rpg_atlas_runs ORDER BY rowid DESC LIMIT 1').get().state_json);
      assert.equal(durationState.status,'completed');assert.equal(durationState.elapsedSeconds,60);assert.equal(durationState.stopReason,'duration_reached');
      await page.screenshot({path:path.join(output,`duration-report-${width}.png`)});await closePanel();

      await group('workshop');await page.locator('[name="craftItemId"]').selectOption(weapon);await page.locator('[name="recipeId"][value="temper"]').check();await page.screenshot({path:path.join(output,`workshop-${width}.png`)});
      const before=db.prepare('SELECT base_stat,enhance_level FROM rpg_equipment WHERE id=?').get(weapon);await page.locator('[data-atlas-craft] button[type="submit"]').click();await page.locator('#sheet [data-x="1"]').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('銘刻完成'));
      const after=db.prepare('SELECT base_stat,enhance_level FROM rpg_equipment WHERE id=?').get(weapon);assert.equal(after.enhance_level,7);assert.ok(after.base_stat>before.base_stat);assert.equal(db.prepare('SELECT crafts FROM rpg_atlas_forges WHERE item_id=?').get(weapon).crafts,1);await closePanel();

      if(includeQuests){await page.locator('[data-atlas-open-quests]').click();await page.locator('.atlas-quest-card').first().waitFor();assert.equal(await page.locator('[data-atlas-group]').count(),6);assert.equal(await page.locator('.atlas-quest-group').count(),4);
      await page.locator('#toast').waitFor({state:'hidden'});assert.equal(await page.locator('.atlas-panel-body').evaluate(node=>node.scrollTop),0);await page.screenshot({path:path.join(output,`quests-${width}.png`),animations:'disabled'});const materialsBefore=db.prepare('SELECT SUM(quantity) n FROM rpg_atlas_materials WHERE char_id=?').get(a).n;
      await page.locator('[data-quest-claim]').first().evaluate(button=>{button.click();button.click();});await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('委託獎勵已送入'));
      assert.equal(calls.filter(call=>call.action==='atlas/quests/claim').length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM rpg_atlas_quest_claims').get().n,1);assert.ok(db.prepare('SELECT SUM(quantity) n FROM rpg_atlas_materials WHERE char_id=?').get(a).n>materialsBefore);await closePanel();}

      await page.locator('#atlas-realm').selectOption('season_2026_01');await page.getByRole('heading',{name:'此環境還沒有角色'}).waitFor();assert.equal(await page.locator('[data-select]').count(),0);assert.doesNotMatch(await page.locator('#view').innerText(),/月桂旅人|祕法旅人/);
      await page.screenshot({path:path.join(output,`empty-season-${width}.png`)});assert.equal(await page.locator('[data-atlas-open-quests]').count(),0);await page.locator('#atlas-realm').selectOption('permanent');await choose(b);assert.match(await page.locator('[data-atlas-stats]').innerText(),/祕法旅人/);assert.doesNotMatch(await page.locator('.atlas-tracker').innerText(),/已完成/);

      env.ATLAS_ENABLED='false';await group('expedition');await page.getByRole('heading',{name:'星圖尚未開放'}).waitFor();await page.locator('[data-atlas-route="home"]').click();await page.locator('#view .lc-profile').waitFor();assert.equal(await page.locator('#atlas-legacy').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__atlasErrorToasts),[]);assert.ok(calls.every(call=>call.realm));
      assert.ok(calls.some(call=>call.action==='characters'&&call.realm==='season_2026_01'));assert.ok(calls.filter(call=>call.action.startsWith('atlas/')&&(includeQuests||!call.action.startsWith('atlas/quests'))).every(call=>call.status===200));
      results.push({width,scope:includeQuests?'complete':'legacy-and-atlas',sixEntrances:true,originalGuardian:true,guardianSummonOnce:true,guardianActivate:true,originalFate:true,originalSkills:true,oneStart:true,durationDefault:true,durationPayload:true,durationSettlementSeconds:60,realSettlement:true,disabledActiveRunCanFinish:true,noDuplicateReward:true,craftPreservesEnhance:7,permanentQuestProgress:includeQuests?true:null,questDoubleClickOneClaim:includeQuests?true:null,emptySeason:true,realmIsolation:true,disabledAtlasKeepsLegacy:true,pageErrors:errors,errorToasts:[]});
    }catch(error){await page.screenshot({path:path.join(output,`failure-${width}.png`)});console.error(JSON.stringify({width,errors,lastCalls:calls.slice(-12)}));throw error;}
    finally{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();env.DB_SEASON.sqlite.close();}
  }
  await fs.writeFile(path.join(output,includeQuests?'results.json':'legacy-results.json'),JSON.stringify({isolated:true,productionRequests:0,results},null,2));console.log(JSON.stringify(results));
} finally {await browser.close();}
