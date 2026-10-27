// Real local API/SQLite with deliberately late old-character reads; no production access.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import * as AUTO from '../src/services/auto-enhance.js';
import {selectAccountCharacter} from '../src/accounts.js';
import {makeGear} from '../src/game/gear.js';
import {insertEquipStmt} from '../src/db.js';
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve('worker/public'),cases=[],errors=[],browser=await chromium.launch({headless:true,channel:'chrome'});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4'};
try {
  for(const [width,mode]of [[390,'success'],[390,'error'],[1280,'success'],[1280,'same-actor-error']]) {
    const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'},db=env.DB.sqlite,now=T0+1;
    const a=(await P.createCharacter(env,{tgId:'111',charSlot:1,name:'甲旅人',gender:'m',baseClass:'sword'},T0)).char.tg_id;
    const b=(await P.createCharacter(env,{tgId:'111',charSlot:2,name:'乙旅人',gender:'f',baseClass:'sword'},T0)).char.tg_id;
    for(const id of [a,b]) {
      db.prepare("UPDATE rpg_characters SET level=60,class_path='A',gold=?,exp=0,last_settle_at=?,last_daily_gold_day='2026-10-08' WHERE tg_id=?").run(id===a?10000:0,now,id);
      db.prepare('DELETE FROM rpg_equipment WHERE tg_id=?').run(id);db.prepare('DELETE FROM rpg_inventory WHERE tg_id=?').run(id);
      for(const item of ['red_2','blue_2'])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,10000)').run(id,item);
      const e=makeGear({id:id+'-weapon',tgId:id,cls:'sword',slot:'weapon',kind:'sword',tier:6,forceRarity:'common',rng:()=>.5,now:T0});e.name=id===a?'甲旅戰刃':'乙旅戰刃';e.is_equipped=1;await insertEquipStmt(env.DB,e).run();
    }
    db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'mat_2',1)").run(a);
    await selectAccountCharacter(env,'111',a,now);const job=(await AUTO.start(env,a,{itemId:a+'-weapon',target:2,requestId:'switch-board'},now)).job;
    const reached={me:gate(),shop:gate(),background:gate()},release=gate(),processError=gate(),processed=gate(),used=new Set();const bGold=width===1280?1000:0;db.prepare('UPDATE rpg_characters SET gold=? WHERE tg_id=?').run(bGold,b);
    const server=http.createServer(async(req,res)=>{
      try {
        const u=new URL(req.url,'http://local');
        if(u.pathname.startsWith('/app/api/')) {
          let body='';for await(const chunk of req)body+=chunk;const data=body?JSON.parse(body):{};
          const name=u.pathname.endsWith('/me')?'me':u.pathname.endsWith('/shop')?'shop':u.pathname.endsWith('/background/status')?'background':null;
          const delay=name&&data.selectedCharacterId===a&&!used.has(name);if(delay)used.add(name);
          if(delay&&name==='me'&&mode!=='success'){reached.me.resolve();await processError.promise;}
          const r=await handle(new CurrentClientRequest('http://local'+req.url,{method:req.method,headers:{...req.headers,'Content-Type':'application/json','X-Debug-Now':String(now)},...(req.method==='GET'?{}:{body})}),env);
          const response=await r.text();
          if(delay){reached[name].resolve();if(name==='me')processed.resolve(r.status);await release.promise;}
          res.writeHead(r.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(response);return;
        }
        const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!file.startsWith(root+path.sep))throw Error('path');
        res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await fs.readFile(file));
      }catch(e){res.writeHead(500);res.end(e.message);}
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
    const page=await browser.newPage({viewport:{width,height:width===390?844:1000}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));let navigations=0;
    page.on('framenavigated',f=>{if(f===page.mainFrame())navigations++;});await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
    async function choose(id,name) {
      if(await page.locator('#charSwitch').isVisible())await page.locator('#charSwitch').click();
      await page.locator('[data-select="'+id+'"]').waitFor();assert.equal(await page.locator('.bw-main:visible').count(),0);
      await page.locator('[data-select="'+id+'"]').click();await page.locator('#hud .nm').filter({hasText:name}).waitFor();await page.locator('.todo').waitFor();
    }
    async function expectB() {
      assert.equal(await page.locator('#hud .nm').innerText(),'乙旅人');assert.equal(Number((await page.locator('#hud .chip.gold').innerText()).replace(/[^0-9]/g,'')),bGold);
      assert.equal(Number((await page.locator('.command-balance').innerText()).replace(/[^0-9]/g,'')),bGold);if(bGold)await page.locator('.todo-row').filter({hasText:'可強化 +1：乙旅戰刃'}).waitFor();else assert.equal(await page.locator('.todo-row').count(),0);assert.doesNotMatch(await page.locator('.todo').innerText(),/甲旅|樹王之心/);assert.equal(await page.locator('.bw-main:visible').count(),0);
    }
    try {
      await page.goto(origin+'/?devTg=111');await choose(a,'甲旅人');await page.locator('.todo-row').filter({hasText:'可以轉職了！'}).waitFor();await page.locator('.bw-main').filter({hasText:'甲旅戰刃'}).waitFor();
      let waitTimer;try{await Promise.race([Promise.all(Object.values(reached).map(g=>g.promise)),new Promise((_,reject)=>{waitTimer=setTimeout(()=>reject(Error('old reads did not start')),15000);})]);}finally{clearTimeout(waitTimer);}
      await choose(b,'乙旅人');await expectB();
      if(mode!=='success'){processError.resolve();assert.equal(await processed.promise,409);if(mode==='same-actor-error')await choose(a,'甲旅人');}
      release.resolve();await page.waitForTimeout(1000);
      if(mode==='same-actor-error'){assert.equal(await page.locator('#hud .nm').innerText(),'甲旅人');await page.locator('.todo-row').filter({hasText:'可以轉職了！'}).waitFor();await choose(b,'乙旅人');}
      await expectB();await choose(a,'甲旅人');await page.locator('.todo-row').filter({hasText:'可以轉職了！'}).waitFor();await page.locator('.bw-main').filter({hasText:'甲旅戰刃'}).waitFor();await choose(b,'乙旅人');await expectB();
      assert.equal(db.prepare('SELECT status FROM rpg_auto_enhance WHERE id=?').get(job.id).status,'running');assert.equal(db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(b).gold,bGold);
      assert.equal(db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='mat_2'").get(a).quantity,1);assert.equal(navigations,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await page.locator('.todo').screenshot({path:'.release-sync/character-board-'+width+'-'+mode+'.png'});cases.push({width,mode,immediateBoard:true,currentGold:true,noPreviousMaterials:true,currentWorkshopOnly:true,lateReadsIgnored:true,accountJobPreserved:true,rapidRoundTrip:true,pageReloads:0});
    }catch(e){await page.screenshot({path:'.release-sync/character-board-failure-'+width+'-'+mode+'.png'});throw e;}
    finally{processError.resolve();release.resolve();await page.close();await new Promise(r=>server.close(r));db.close();}
  }
  assert.deepEqual(errors,[]);await fs.writeFile('.release-sync/character-board-browser-results.json',JSON.stringify({cases,errors,isolated:true,productionMutations:false},null,2));console.log(JSON.stringify({cases,errors}));
}finally{await browser.close();}
