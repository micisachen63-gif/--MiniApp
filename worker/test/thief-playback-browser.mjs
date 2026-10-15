import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),pub=path.join(root,'worker/public');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.css':'text/css'};
const html=`<!doctype html><html><head><meta charset="utf-8"><script src="/thief-fx.js"></script><script src="/hero-art-registry.js"></script><style>
body{margin:0;background:#171923;color:#eee;font:14px sans-serif}.party-layout{width:390px}.scene{position:relative;width:390px;height:260px;overflow:hidden;background:#21283c}.scene-hero{position:absolute;left:18px;bottom:0;width:120px;height:190px;object-fit:contain}.scene-boss{position:absolute;left:285px;top:105px;width:60px;height:105px;background:#725778}.boss-meter{position:absolute;right:10px;top:10px;z-index:5}.boss-meter .meter{width:160px;height:7px;background:#333}.boss-meter i{display:block;height:7px;background:#d86973}.scene-floor{position:absolute;top:5px;left:5px}.combat-label{position:absolute;bottom:0;left:160px}.combat-number{position:absolute;font-size:16px}
</style></head><body><div class="party-layout"><div class="scene"><div class="scene-floor">盜賊雙擊 · 隔離假回合</div><img class="scene-hero" data-member-id="fixture"><div class="scene-boss"></div><div class="boss-meter"><small></small><div class="meter"><i></i></div></div></div><div class="members"><div data-member-id="fixture"><b data-member-hp></b><b data-member-mp></b></div></div></div></body></html>`;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://fixture');if(url.pathname==='/fixture.html'){res.writeHead(200,{'content-type':'text/html'});return res.end(html);}const file=path.resolve(pub,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(pub+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,channel:'msedge'});
let result;
try{
 const page=await browser.newPage({viewport:{width:390,height:360},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.stack||String(e)));page.on('console',m=>{if(m.type()==='warning')console.log('browser warning: '+m.text());});
 await page.goto(origin+'/fixture.html');
 result=await page.evaluate(async()=>{
  if(!window.RpgThiefFX)throw new Error('Fixture did not load thief Canvas FX');
  const {playCombat,combatView,combatCursor,combatStrikeSteps}=await import('/expedition/combat-playback.js'),{playbackStats}=await import('/expedition/hero-art-playback.js?v=20261014-art-6125dca91d72');
  const scene=document.querySelector('.scene'),member={id:'fixture',name:'盜賊女候選',base:'thief',classPath:'',gender:'f',hp:100,maxHp:100,mp:50,maxMp:50};document.querySelector('.scene-hero').src='/'+window.RpgHeroArtRegistry.get('thief_f').hero;
  const snap=(hp,mp=50)=>({floor:1,enemyHp:hp,enemyMaxHp:1000,enemyName:'假回合目標',members:[{...member,mp}]}),before=snap(1000),after=snap(800,46);
  const event={actorId:'fixture',base:'thief',skillId:'attack',nativeSkill:'迅刃突刺',label:'迅刃突刺',damage:200,spentMp:4,attackSpeedMultiplier:1.8,strikes:[{index:0,crit:false,damage:100,beforeHp:1000,afterHp:900},{index:1,crit:false,damage:100,beforeHp:900,afterHp:800}],after};
  const turn={id:'thief-fixture:1',sequence:1,round:1,floor:1,before,events:[event],after,final:after};
  const p={id:'thief-fixture',rev:1,kind:'dungeon',dungeonId:'pillar',floor:1,round:2,status:'combat',enemy:{name:'假回合目標',hp:800,maxHp:1000},members:[member],battleTurn:turn,battleTurns:[turn],battleSync:{hasGap:false}};
  const malformed={...event,strikes:[{...event.strikes[0],damage:300},event.strikes[1]]},fallback=combatStrikeSteps(malformed,before).length;
  combatView(p);const start=performance.now();await playCombat(scene,p);const elapsed=performance.now()-start,receipts=structuredClone(playbackStats.cycleReceipts),canvasCount=scene.querySelectorAll('canvas').length;
  const count=playbackStats.started;await playCombat(scene,p);const replayStarts=playbackStats.started-count;
  const cancelledTurn={...turn,id:'thief-fixture:2',sequence:2},cancelledParty={...p,id:'thief-cancelled',rev:2,battleTurn:cancelledTurn,battleTurns:[cancelledTurn]};
  combatView(cancelledParty);const job=playCombat(scene,cancelledParty);setTimeout(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}),150);await job;Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
  return {elapsed,receipts,canvasCount,replayStarts,fallback,cursor:combatCursor(p.id),cancelledCanvasCount:scene.querySelectorAll('canvas').length,actorVisibility:scene.querySelector('.scene-hero').style.visibility,hpLabel:scene.querySelector('.boss-meter small').textContent,finalHp:800,frames:playbackStats.seenFrames.thief_f,fixture:'isolated mock server turn; actual production registry, native atlas, Canvas playback modules; no player/API writes'};
 });
 if(errors.length)console.log(JSON.stringify({errors,result}));
 await page.addStyleTag({url:origin+'/styles.css'});await page.addStyleTag({url:origin+'/battle.css'});await page.addScriptTag({url:origin+'/skill-fx.js'});await page.addScriptTag({url:origin+'/elf-adv2-skill-fx.js'});await page.addScriptTag({url:origin+'/battle.js'});
 const main=await page.evaluate(async()=>{
  const record=window.RpgHeroArtRegistry.get('thief_f'),trace=[],impacts=[],battle=window.RpgBattle.create({groupSize:1,src:(kind)=>['hero','portrait','monster','elite'].includes(kind)?record.hero:'',heroKey:()=> 'thief_f',heroMeta:()=>record.heroMeta,heroAnim:()=>record.animation,fmt:String,items:{},stateInfo:()=>({text:'隔離真hit fixture',cls:''})});
  document.body.append(battle.el);const stage=battle.el,sheet=stage.querySelector('.hero-sheet'),style=sheet.style;
  Object.defineProperty(style,'backgroundPosition',{configurable:true,get(){return style.getPropertyValue('background-position')},set(value){style.setProperty('background-position',value);if(stage.dataset.playingRound==='idle-thief-fixture'&&trace.at(-1)?.frame!==battle.state.heroSheet?.frameIndex)trace.push({frame:battle.state.heroSheet?.frameIndex,at:performance.now()});}});
  const observer=new MutationObserver(records=>{for(const record of records)if(record.attributeName==='data-last-hit')impacts.push({at:performance.now(),frame:battle.state.heroSheet?.frameIndex,hit:JSON.parse(stage.dataset.lastHit)});});observer.observe(stage,{attributes:true,attributeFilter:['data-last-hit']});
  const enemy={id:'native-target',name:'假回合目標',mapId:1,hp:1000,maxHp:1000},round={id:'idle-thief-fixture',mapId:1,before:[enemy,{...enemy,id:'native-target-2'}],after:[{...enemy,hp:800},{...enemy,id:'native-target-2'}],events:[{type:'hit',targetId:enemy.id,enemy:{...enemy,hp:800},beforeHp:1000,afterHp:800,damage:200,crit:false,skill:true,skillName:'迅刃突刺',strike:0,attackSpeedMultiplier:1.8}]};
  const me={character:{tgId:'native-fixture',revision:1,baseClass:'thief',classPath:'',gender:'f',mapId:1,mapName:'假回合',level:20,state:'fighting',hp:100,maxHp:100,mp:46,maxMp:50},battle:{attackSpeedMultiplier:1.8,idleCombat:{enemies:round.after,round},monsters:['假回合目標','假回合目標2'],elite:'假回合目標',atk:100,crit:.05,hpLossPerTick:0,eliteBurst:0,skill:{name:'迅刃突刺',mult:1.7,cost:4,targets:1}}};
  battle.sync(me,{from_at:0,to_at:60000,ticks:1,kills:0,exp_gained:0,gold_gained:0,elites:0,drops:{},used:{},relics:[],combat:round});battle.attach();
  const heightSamples=[],heightTimer=setInterval(()=>heightSamples.push(stage.getBoundingClientRect().height),30);const started=performance.now();while(stage.dataset.completedRound!==round.id){if(performance.now()-started>10000)throw Error('native main battle did not complete fixture '+JSON.stringify({dataset:stage.dataset,queue:battle.state.queue,hero:battle.state.heroSheet,trace}));await new Promise(r=>setTimeout(r,20));}
  clearInterval(heightTimer);const geometry={stageHeight:stage.getBoundingClientRect().height,maxSampledStageHeight:Math.max(...heightSamples),heroHeight:stage.querySelector('.hero').getBoundingClientRect().height,monsterCount:battle.state.group.length};const actionDuration=parseFloat(stage.querySelector('.hero').style.getPropertyValue('--action-duration')),data={trace,impacts,geometry,actionDuration,expectedDuration:1000/1.8,sourceDuration:record.animation.durationMs,releaseAtMs:record.animation.releaseAtMs,finalHp:battle.state.mon?.hp,completedRound:stage.dataset.completedRound};observer.disconnect();stage.remove();await new Promise(r=>setTimeout(r,50));return data;
 });
 result.mainBattle=main;assert.equal(main.impacts.length,1);assert.equal(main.impacts[0].hit.hp,800);assert.equal(main.impacts[0].frame,6);assert.ok(Math.abs(main.actionDuration-1000/1.8)<.001);assert.ok(main.trace.some(f=>f.frame===0)&&main.trace.some(f=>f.frame===11));assert.equal(main.finalHp,800);assert.equal(main.geometry.monsterCount,2);assert.ok(main.geometry.maxSampledStageHeight<1500);assert.ok(main.geometry.heroHeight<=170.1);
 assert.equal(result.receipts.length,2);assert.ok(result.receipts.every(r=>r.completed&&r.duration===260&&r.strikeCount===2));
 assert.ok(result.receipts.every(r=>r.sourceFrames[0]===0&&r.sourceFrames.at(-1)===11));
 assert.equal(result.canvasCount,0);assert.equal(result.cancelledCanvasCount,0);assert.equal(result.actorVisibility,'');assert.equal(result.replayStarts,0);assert.equal(result.fallback,1);assert.equal(result.cursor,'thief-fixture:1');assert.deepEqual(errors,[]);
 result.pageErrors=errors;result.status='PASS';result.cycleScope='complete time-scaled native 0..11 sequences; requestAnimationFrame samples may skip poses under frame pressure, no source cells or recovery removed';
 fs.writeFileSync(path.join(root,'docs/thief/playback-browser.json'),JSON.stringify(result,null,2)+'\n');await page.screenshot({path:path.join(root,'docs/thief/playback-browser.png')});
 console.log(JSON.stringify({status:result.status,cycles:result.receipts.map(r=>({frames:r.sourceFrames,duration:r.duration})),canvasCount:result.canvasCount,replayStarts:result.replayStarts,pageErrors:errors}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
