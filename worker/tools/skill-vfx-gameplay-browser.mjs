// Full existing Mini App, real handle()/SQLite and a fixed, explicit test clock.
// Synthetic local players only; no production/Telegram/network access.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {freshDb} from '../test/d1-shim.js';
import {T0} from '../test/helpers.js';
import {pveTeam} from '../test/pve-balance-fixture.js';
import {CurrentClientRequest} from '../test/client-request.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import * as Party from '../src/services/party.js';
import * as Ring from '../src/services/star-ring.js';
import * as RingEngine from '../src/game/star-ring.js';
import * as PK from '../src/services/pk.js';
import * as Boss from '../src/services/boss.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';

const require=createRequire(import.meta.url);
const dependencyRoot=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||path.resolve('../star-journal-scene-integration-20261104/.release-sync/browser-tools/node_modules');
const {chromium}=require(path.join(dependencyRoot,'playwright'));
const argv=process.argv.slice(2),group=argv.find(a=>a.startsWith('--modes='))?.slice(8),selected=argv.find(a=>a.startsWith('--mode='))?.slice(7),phone=argv.includes('--phone'),smoke=argv.includes('--smoke');
if(argv.some(a=>!/^--(?:mode=(?:idle-native|idle-summon|idle-support|party|pk|pk-support|boss|ring)|modes=(?:idle-native|idle-summon|idle-support|party|pk|pk-support|boss|ring)(?:,(?:idle-native|idle-summon|idle-support|party|pk|pk-support|boss|ring))*|phone|smoke)$/.test(a)))throw Error('Use --mode=... [--phone] or --smoke');
if(group&&selected)throw Error('Choose --mode or --modes');
const modes=group?group.split(','):selected?[selected]:smoke?['idle-native']:['idle-native','idle-summon','idle-support','party','pk','pk-support','boss','ring'];
const widths=selected?[phone?390:1280]:smoke?[390]:[390,1280];
const root=path.resolve('worker/public'),out=path.resolve(process.env.SKILL_VFX_GAMEPLAY_QA_DIR||'.release-sync/skill-vfx-all-20261104/gameplay-'+new Date().toISOString().replace(/[:.]/g,'-'));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.woff2':'font/woff2'};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);if(url.hostname!=='127.0.0.1')throw Error('Outbound requests disabled in VFX fixture');return nativeFetch(input,init);};
async function seed(env,id,baseClass,classPath,specialId=null){
 await P.createCharacter(env,{tgId:id,name:'特效驗收'+id,baseClass,gender:'m'},T0);
 const db=env.DB.sqlite,special={learned:specialId?[specialId]:[],loadout:specialId?[specialId]:[],auto:specialId?{[specialId]:'ready'}:{},cooldowns:{},mode:'safe'};
 db.prepare('UPDATE rpg_characters SET level=120,class_path=?,exp=0,gold=50000,map_id=2,last_settle_at=?,special_json=? WHERE tg_id=?').run(classPath,T0,JSON.stringify(special),id);
 for(const item of ['red_1','blue_1'])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,1000) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=1000').run(id,item);
 const p=await loadPlayer(env.DB,id),st=computeStats(p.char,p.equipment.filter(e=>e.is_equipped));
 db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(st.maxHp,st.maxMp,id);
}
async function fixture(mode){
 let f,clock=T0,who='111',runId=null;
 if(mode==='party'){
  f=await pveTeam({start:false,profile:'epic4'});
  f.db.prepare("UPDATE rpg_characters SET special_json=? WHERE tg_id=?").run(JSON.stringify({learned:['skill_05_1'],loadout:['skill_05_1'],auto:{skill_05_1:'ready'},cooldowns:{},mode:'safe'}),f.ids[2]);
  runId=f.id();
 }else{
  const env={DB:freshDb()},db=env.DB.sqlite;f={env,db,close:()=>db.close()};
  if(mode==='idle-native')await seed(env,'111','sword','A111');
  if(mode==='idle-summon')await seed(env,'111','mage','B211','skill_18_1');
  if(mode==='idle-support')await seed(env,'111','archer','A111','skill_03_3');
  if(mode==='boss')await seed(env,'111','mage','A111','skill_05_1');
  if(mode==='pk'||mode==='pk-support'){
   if(mode==='pk-support'){
    await seed(env,'111','sword','B111','skill_02_3');
    await seed(env,'222','sword','B111');
   }else{
    await seed(env,'111','thief','A211','skill_thief_04');
    await seed(env,'222','sword','B111','skill_02_1');
   }
   who='222';
   runId=(await PK.challenge(env,{tgId:'111',target:{tgId:'222'},origin:'app'},clock)).id;
  }
  if(mode==='ring'){
   const specs=[['sword','B111','skill_02_1'],['archer','A111','skill_03_1'],['mage','A111','skill_05_1'],['thief','A211',null],['mage','B211','skill_18_1']];
   for(let i=0;i<specs.length;i++)await seed(env,String((i+1)*111),...specs[i]);
   runId=(await Ring.create(env,'111',{tier:40,difficulty:'normal',requestId:'vfx-ring-browser'},clock)).party.id;
   for(const id of ['222','333','444','555'])await Ring.action(env,id,{partyId:runId,action:'join'},clock);
   for(const id of ['111','222','333','444','555'])await Ring.action(env,id,{partyId:runId,action:'ready'},clock);
  }
 }
 Object.assign(f.env,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true',ATLAS_ENABLED:'true'});
 if(mode==='boss')await Boss.spawnDue(f.env,clock);
 return {...f,qaMode:mode,who,runId,clock:()=>clock,advance(ms){clock+=ms;},setClock(value){clock=value;}};
}
function descriptors(value,out=[]){
 if(!value||typeof value!=='object')return out;
 if(value.schemaVersion===1&&typeof value.skillId==='string'&&typeof value.eventId==='string'&&value.presentationMode)out.push({skillId:value.skillId,eventId:value.eventId,source:value.source,kind:value.kind,actorId:value.actorId,targetIds:value.targetIds,presentationMode:value.presentationMode});
 for(const [key,v]of Object.entries(value))if(key!=='sourceFiles'&&typeof v==='object')descriptors(v,out);
 return out;
}
async function serve(f,receiptLog){
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://127.0.0.1');
   if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:'+server.address().port){res.writeHead(403);res.end('Local fixture only');return;}
   if(u.pathname==='/__preview/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,isolated:true,ephemeral:true,productionAccess:false,clockMode:'fixed-test',now:f.clock()}));return;}
   if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
   if(u.pathname.startsWith('/app/api/')){
    let body='';for await(const b of req){body+=b;if(body.length>1048576)throw Error('Request too large');}
    const response=await handle(new CurrentClientRequest('http://local'+req.url,{method:req.method,headers:{...req.headers,'Content-Type':'application/json','X-Debug-Now':String(f.clock())},...(req.method==='GET'?{}:{body})}),f.env);
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{}
    receiptLog.push({action:u.pathname.slice('/app/api/'.length),status:response.status,at:f.clock(),vfx:descriptors(data),...(f.qaMode==='pk-support'&&u.pathname.endsWith('/pk/accept')&&data?.pk?{pkReceipt:{id:data.pk.id,status:data.pk.status,log:data.pk.log}}:{}),...(data?.error?{error:data.error,message:data.message}:{})});
    res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(text);return;
   }
   const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
   if(!file.startsWith(root+path.sep))throw Error('Invalid asset path');
   let bytes=await fs.readFile(file);
   if(file===path.join(root,'app.js')){
    const source=bytes.toString('utf8'),marker='  boot();';assert(source.includes(marker));
    bytes=Buffer.from(source.replace(marker,'  window.__SkillVfxQA={state:S,render,pkReplay,refreshMe,loadBoss,api,battle:BATTLE};\n'+marker));
   }
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500,{'Content-Type':'text/plain'});res.end(error.stack||error.message);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {origin:'http://127.0.0.1:'+server.address().port,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
async function frameFor(page){let frame;for(let i=0;i<100;i++){frame=page.frames().find(f=>f.url().includes('/expedition/index.html'));if(frame)return frame;await page.waitForTimeout(50);}throw Error('Missing expedition frame');}
async function inspect(frame){return frame.evaluate(()=>window.RpgLegacySkillVFX?.inspect?.()||null);}
async function waitDraw(frame,mode){
 const deadline=Date.now()+25000;let value;
 while(Date.now()<deadline){value=await inspect(frame);const rows=[...(value?.active||[]),...(value?.completed||[])];if(rows.some(r=>r.mode===mode&&r.accepted>0&&r.drawCalls>0))return value;await frame.waitForTimeout(80);}
 throw Error('No actual VFX draw for '+mode+': '+JSON.stringify(value));
}

async function scrollBattle(field,page){
 // Animated battle containers never become "stable" for locator auto-wait.
 // Native instant scrolling changes only viewport position, not the simulation.
 await field.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
 const box=await field.boundingBox();
 assert(box&&box.width>0&&box.height>0,'visible battle geometry');
 const viewport=page.viewportSize(),x=Math.max(0,box.x),y=Math.max(0,box.y);
 const clip={x,y,width:Math.min(box.x+box.width,viewport.width)-x,height:Math.min(box.y+box.height,viewport.height)-y};
 assert(clip.width>40&&clip.height>40,'battle intersects the real viewport');
 return {box,clip};
}
async function verifyPkSupport(page,f,pk){
 const steps=pk?.log?.steps||[];
 const target=steps.find(step=>step.vfx?.skillId==='special:skill_02_3'&&step.vfx.kind==='cast'&&step.vfx.presentationMode==='support');
 assert(target,'true pk/accept must resolve the equipped pure-shield skill');
 const descriptor=target.vfx,actor=descriptor.actorId,enemy=actor==='a'?'b':'a';
 assert.equal(descriptor.source,'committed-combat');
 assert.deepEqual(descriptor.targetIds,[actor]);
 assert.equal(target.after.hp[enemy],target.before.hp[enemy],'the pure shield cast must not damage the opponent');
 const actualSelfHealing=target.after.hp[actor]-target.before.hp[actor];
 assert(actualSelfHealing>=0,'a shield cast does not inflict self damage');
 const stored=f.db.prepare('SELECT id,status,log_json FROM rpg_pk WHERE id=?').get(pk.id);
 assert.equal(stored.status,'done');
 const persisted=JSON.parse(stored.log_json),persistedSteps=persisted.steps||persisted.log||[];
 const storedStep=persistedSteps.find(step=>step.vfx?.eventId===descriptor.eventId);
 assert(storedStep,'accepted cast exists in committed SQLite log_json');
 assert.deepEqual(storedStep.vfx,descriptor);assert.deepEqual(storedStep.after,target.after);
 await page.evaluate(async()=>{window.__SkillVfxQAGeometry=(await import('/skill-vfx-legacy.mjs')).legacyDomGeometry;window.__SkillVfxSupportProbe=null;});
 const handle=await page.waitForFunction(({eventId,actor,enemy})=>{
  const row=(window.RpgLegacySkillVFX?.inspect?.().active||[]).find(row=>row.mode==='pk'&&row.lastEvent?.eventId===eventId);
  if(!row||!row.player?.active)return false;
  const previous=window.__SkillVfxSupportProbe;
  if(!previous||previous.eventId!==eventId){window.__SkillVfxSupportProbe={eventId,drawFrames:row.drawFrames};return false;}
  if(row.drawFrames<=previous.drawFrames||!row.lastRender?.drawCalls)return false;
  // Snapshot identity, DOM, geometry and pixels in this same browser callback.
  // Returning the value avoids a later evaluate racing the following replay step.
  const arena=document.querySelector('.pkarena');
  const targets=['a','b'].map(id=>({id,node:document.querySelector('#pk_'+id+' img')}));
  const geometry=window.__SkillVfxQAGeometry(arena,document.querySelector('#pk_'+actor+' img'),targets,{actorId:actor});
  const sides=Object.fromEntries(['a','b'].map(id=>{
   const node=document.querySelector('#pk_'+id),damage=node.querySelector('.pkdmg'),hp=node.querySelector('.bar.hp');
   return [id,{className:node.className,attack:node.classList.contains('atk'),hit:node.classList.contains('hitme'),
    hpText:hp.querySelector('b').textContent,hpWidth:Number.parseFloat(hp.querySelector('i').style.width),
    damageText:damage.textContent,damageVisible:damage.classList.contains('on')}];
  }));
  const canvas=arena.querySelector('.legacy-skill-vfx'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let alphaPixels=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)alphaPixels++;
  if(!alphaPixels)return false;
  return {event:row.lastEvent,drawCalls:row.drawCalls,lastRender:row.lastRender,geometry,sides,alphaPixels,label:document.querySelector('#pkres').textContent};
 },{eventId:descriptor.eventId,actor,enemy},{timeout:30000});
 const frame=await handle.jsonValue();await handle.dispose();
 assert.equal(frame.sides[actor].attack,false,'support must not use an offensive portrait pose');
 for(const id of ['a','b']){
  assert.equal(frame.sides[id].hit,false,'pure shield causes no hit cue');
  const visibleHeal=id===actor&&actualSelfHealing>0;
  assert.equal(frame.sides[id].damageVisible,visibleHeal,'floating numbers must match actual HP changes');
  if(visibleHeal){assert(frame.sides[id].damageText.startsWith('+'));assert.equal(Number(frame.sides[id].damageText.replace(/[^0-9.]/g,'')),actualSelfHealing);}
  const expected=target.after.hp[id]/pk.log.max[id]*100;
  assert(Math.abs(frame.sides[id].hpWidth-expected)<.001,'DOM HP bar equals the actual receipt for '+id);
 }
 assert(frame.label.includes('施展支援技能'));assert(frame.alphaPixels>0,'actual VFX alpha is visible');
 const beneficiary=frame.geometry.targets.find(value=>value.id===actor).point;
 for(const command of frame.event.commands){assert.equal(command.mode,'support');assert(Math.hypot(command.from.x-beneficiary.x,command.from.y-beneficiary.y)<.01);assert.deepEqual(command.from,command.to);}
 return {skillId:descriptor.skillId,eventId:descriptor.eventId,actorId:actor,enemyId:enemy,
  source:'committed-combat',actualSelfHealing,before:target.before,after:target.after,max:pk.log.max,
  sqlite:{id:stored.id,status:stored.status,matchingEventId:storedStep.vfx.eventId,
   logSha256:createHash('sha256').update(stored.log_json).digest('hex')},frame};
}

await fs.mkdir(out,{recursive:true});
const sourcePaths=["worker/tools/skill-vfx-gameplay-browser.mjs","worker/public/index.html","worker/public/skill-vfx-legacy.mjs","worker/public/skill-vfx-engine.mjs","worker/public/skill-vfx-catalog.json","worker/public/skill-vfx-recipes.json","worker/public/app.js","worker/public/battle.js","worker/public/expedition/combat-playback.js","worker/public/expedition/hero-art-playback.js","worker/public/star-ring-heroes.js","worker/src/game/skill-vfx-events.js","worker/src/game/special.js","worker/src/game/idle.js","worker/src/game/idle-combat.js","worker/src/game/special-idle.js","worker/src/game/boss.js","worker/src/game/pk.js","worker/src/game/star-ring.js","worker/src/services/party.js","worker/src/services/pk.js","worker/src/services/star-ring.js"];
const fingerprint=async()=>Promise.all(sourcePaths.map(async file=>({path:file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
const sourceFiles=await fingerprint();
const evidence={schemaVersion:1,sourceFiles,source:'real-isolated-api',isolated:true,ephemeral:true,productionAccess:false,clockMode:'fixed-test',startedAt:new Date().toISOString(),cases:[],errors:[],badResponses:[],instrumentation:'Expose existing app controllers and read-only renderer geometry for QA; no response or combat/event substitution.'};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const mode of modes)for(const width of widths){
  const name=mode+'-'+width,f=await fixture(mode),receipts=[],server=await serve(f,receipts),page=await browser.newPage({viewport:{width,height:width===390?844:900},deviceScaleFactor:1});
  const errors=[],badResponses=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(server.origin)&&r.status()>=400)badResponses.push({url:r.url().slice(server.origin.length),status:r.status()});});
  await page.route('**/*',route=>route.request().url().startsWith(server.origin)?route.continue():route.abort());
  page.setDefaultTimeout(20000);let stage=page,supportEvidence=null;
  try{
   await page.goto(server.origin+'/?devTg='+f.who,{waitUntil:'domcontentloaded'});
   await page.locator('[data-select]').first().click();
   await page.waitForFunction(()=>window.__SkillVfxQA?.state.me?.character);
   if(mode.startsWith('idle-')){
    await page.evaluate(()=>window.RpgExpeditionHost.openTab('home'));
    await page.locator('#bslot').waitFor();
    f.advance(60001);await page.evaluate(()=>__SkillVfxQA.refreshMe({full:true}));
    await waitDraw(page,'idle');
   }else if(mode==='party'){
    await page.evaluate(()=>window.RpgExpeditionOpen('dungeons'));stage=await frameFor(page);
    await stage.locator('[data-party-op="start"]').click();await stage.locator('[data-party-status="combat"]').waitFor();
    const state=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(f.runId).state_json);
    f.setClock(state.deadline);
    await stage.locator('[data-refresh]').first().click();
    await waitDraw(stage,'party');
   }else if(mode==='ring'){
    await page.evaluate(()=>window.RpgExpeditionOpen('star-ring'));stage=await frameFor(page);
    await stage.locator('[data-sr-action="start"]').click();await stage.locator('.sr-battle').waitFor();
    f.advance(RingEngine.BEAT_MS*3);await stage.locator('[data-sr-action="refresh"]').click();
    await waitDraw(stage,'star-ring');
   }else if(mode==='pk'||mode==='pk-support'){
    await page.evaluate(async()=>{__SkillVfxQA.state.tab='trade';__SkillVfxQA.state.social='pk';const data=await __SkillVfxQA.api('pk/list');__SkillVfxQA.state.pks={pending:data.pending,history:data.history,today:data.today};__SkillVfxQA.render();});
    await page.locator('[data-pacc]').first().click();
    // The existing confirmation sheet, when present, is part of the real accept action.
    const acceptance=page.waitForResponse(response=>response.url().endsWith('/app/api/pk/accept'));
    await page.locator('#sheet').getByRole('button',{name:'開打！',exact:true}).click();
    const accepted=await (await acceptance).json();
    if(mode==='pk-support')supportEvidence=await verifyPkSupport(page,f,accepted.pk);
    else await waitDraw(page,'pk');
   }else if(mode==='boss'){
    await page.evaluate(async()=>{__SkillVfxQA.state.tab='boss';await __SkillVfxQA.loadBoss();__SkillVfxQA.render();});
    await page.locator('#atk').click();await waitDraw(page,'boss');
   }
   const battlefield=stage.locator('[data-legacy-vfx]').first();
   let battleCapture=null;if(await battlefield.count())battleCapture=await scrollBattle(battlefield,page);
   const first=await inspect(stage);
   if(battleCapture)await page.screenshot({path:path.join(out,name+'-battle.png'),clip:battleCapture.clip});
   await page.screenshot({path:path.join(out,name+'-release.png'),fullPage:true});
   await page.waitForTimeout(400);
   await page.screenshot({path:path.join(out,name+'-effect.png'),fullPage:true});
   const result=await inspect(stage);
   assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(badResponses.length,0,JSON.stringify(badResponses));
   assert(receipts.some(r=>r.vfx.length),'actual API response contains canonical descriptors');
   const record={mode:mode==='pk-support'?'pk':mode,...(mode==='pk-support'?{variant:'pure-support',sourceMode:mode}:{}),width,status:'passed',testClock:f.clock(),first,result,receipts,errors,badResponses,battleCapture,...(supportEvidence?{supportEvidence}:{}),screenshots:[name+'-battle.png',name+'-release.png',name+'-effect.png']};
   evidence.cases.push(record);console.log(JSON.stringify({mode,width,passed:true,apiDescriptors:receipts.reduce((n,r)=>n+r.vfx.length,0)}));
  }catch(error){
   await page.screenshot({path:path.join(out,name+'-failure.png'),fullPage:true}).catch(()=>{});
   evidence.cases.push({mode:mode==='pk-support'?'pk':mode,...(mode==='pk-support'?{variant:'pure-support',sourceMode:mode}:{}),width,status:'failed',error:String(error),stack:error.stack,inspect:await inspect(stage).catch(()=>null),receipts,errors,badResponses,body:(await page.locator('body').innerText().catch(()=>'' )).slice(-8000)});
   throw error;
  }finally{
   evidence.errors.push(...errors);evidence.badResponses.push(...badResponses);
   await fs.writeFile(path.join(out,'results.json'),JSON.stringify(evidence,null,2));
   await page.close();await server.close();f.close();
  }
 }
 evidence.status='passed';evidence.completedAt=new Date().toISOString();
} catch(error){evidence.status='failed';evidence.error=String(error);process.exitCode=1;console.error(error.stack);}
finally{evidence.sourceFilesAfter=await fingerprint();evidence.sourceChangedDuring=sourceFiles.filter((row,i)=>row.sha256!==evidence.sourceFilesAfter[i].sha256).map(row=>row.path);await browser.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,out,cases:evidence.cases.length,errors:evidence.errors.length,httpErrors:evidence.badResponses.length}));}
