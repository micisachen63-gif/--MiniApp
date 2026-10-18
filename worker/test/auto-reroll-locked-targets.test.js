import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
import{targetConfig,targetReached,targetState}from'../src/game/auto-reroll-targets.js';
import{AFFIXES,affixLines,affixCost}from'../src/game/affixes.js';
import{freshDb}from'./d1-shim.js';import{T0}from'./helpers.js';import * as P from'../src/services/player.js';import * as R from'../src/services/auto-reroll.js';import{makeGear}from'../src/game/gear.js';import{insertEquipStmt,loadPlayer}from'../src/db.js';
const fixed={key:'meleePct',score:100,value:.035},crit={key:'critPct',score:0,value:.004},hp={key:'maxHpPct',score:0,value:.01};
const char={base_class:'sword',class_path:''},item=(lines=[fixed,crit,hp])=>({tier:6,class_req:'sword',affixes_json:JSON.stringify(lines)});
const config=(extra={})=>({functions:['attack'],quality:'SS',locks:[0],...extra});
function client(document){const window={},ctx=vm.createContext({window,Map,Set,document});vm.runInContext(readFileSync(new URL('../public/auto-reroll-ui.js',import.meta.url),'utf8'),ctx);return window.RpgAutoRerollUI;}
test('actual configuration controls allow locked attack plus SS, explain remaining two rows and submit full locks unchanged',async()=>{
 const names=['auto','body','quality','budget','kind','rule','error'],nodes=Object.fromEntries(names.map(k=>['[data-ar-'+k+']',{checked:false,value:'',textContent:''}])),choice={checked:false,dataset:{arFunction:'attack'}},button={},cost={};
 nodes['.ar-functions']={innerHTML:''};const box={querySelector:s=>nodes[s],querySelectorAll:s=>s.endsWith(':checked')?(choice.checked?[choice]:[]):[choice]},c={isConnected:true,querySelector:s=>s==='[data-affix-roll]'?button:s==='.reroll-cost'?cost:null,append(){}};
 let submitted;const ui=client({createElement:()=>box});ui.mount(c,{key:'locked-config',item:{id:'test',tier:6,inTrade:false,affixes:{slots:3,lines:[fixed,crit,hp]}},locks:[0],actor:{baseClass:'sword'},gold:100000,scrolls:24,api:async()=>({functions:[{id:'attack',key:'meleePct',name:'攻擊'}]}),onConfigure(){},onError:message=>{throw Error(message);},onStart:async b=>submitted=b});
 await new Promise(r=>setImmediate(r));nodes['[data-ar-auto]'].checked=true;nodes['[data-ar-auto]'].onchange();choice.checked=true;choice.onchange();assert.equal(button.disabled,true);assert.match(nodes['[data-ar-error]'].textContent,/已完整鎖定/);
 nodes['[data-ar-quality]'].value='SS';nodes['[data-ar-quality]'].onchange();assert.equal(button.disabled,false);assert.equal(button.textContent,'開始自動洗');assert.match(nodes['[data-ar-rule]'].textContent,/其餘 2 條.*SS/);
 await button.onclick();assert.deepEqual(JSON.parse(JSON.stringify(submitted)),{functions:['attack'],quality:'SS',locks:[0],typeLocks:[],maxGold:null});
});
test('a matching fully locked ability never stops the remaining two quality targets; client and server agree',()=>{
 const ui=client();for(const locks of [[0],[1],[2],[]])for(const functions of [['attack'],['attack','critical'],[]])for(const quality of ['SS','S',null])for(const scores of [[100,0,0],[100,100,0],[100,100,100]]){
  const lines=[fixed,crit,hp].map((x,i)=>({...x,score:scores[i]})),cfg={keys:functions.map(x=>x==='attack'?'meleePct':'critPct'),quality,locks};
  assert.deepEqual(JSON.parse(JSON.stringify(ui.targetState(lines,3,cfg))),targetState(lines,3,cfg));
 }
 const cfg=targetConfig(char,item(),config());assert.equal(targetReached(item(),cfg),false);assert.equal(targetReached(item([fixed,{...crit,score:100},hp]),cfg),false);assert.equal(targetReached(item([fixed,{...crit,score:100},{...hp,score:100}]),cfg),true);
 assert.match(ui.targetRule(ui.targetState([fixed,crit,hp],3,cfg),cfg),/已完整鎖定.*不計入.*其餘 2 條.*SS/);
});
test('new abilities still match only mutable lines; type locks remain quality targets and low full locks stay untouched',()=>{
 const cfg=targetConfig(char,item(),config({functions:['attack','critical']}));assert.equal(targetReached(item(),cfg),false);assert.equal(targetReached(item([fixed,{...crit,score:100},hp]),cfg),true);
 const typed=targetConfig(char,item([{...fixed,score:0},crit,hp]),config({locks:[],typeLocks:[0]}));assert.equal(targetReached(item([{...fixed,score:0},crit,hp]),typed),false);assert.equal(targetReached(item(),typed),true);
 const low=[{...fixed,score:0}, {...crit,score:100},{...hp,score:100}],lowCfg=targetConfig(char,item(low),config());assert.equal(targetReached(item(low),lowCfg),true);
 assert.throws(()=>targetConfig(char,item(),config({quality:null})),e=>e.code==='target');
});
function forceMutable(keys,scores){let pool=Object.keys(AFFIXES).filter(k=>!AFFIXES[k].classes||AFFIXES[k].classes.includes('sword')).filter(k=>k!==fixed.key),values=[];for(let i=0;i<keys.length;i++){values.push((pool.indexOf(keys[i])+.1)/pool.length,scores[i]>=95?.99:0,scores[i]>=95?.99:0);pool=pool.filter(k=>k!==keys[i]);}return()=>values.shift()??.5;}
async function fixture(t){const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());await P.createCharacter(env,{tgId:'97777',name:'鎖定測試',gender:'m',baseClass:'sword'},T0);await env.DB.prepare('UPDATE rpg_characters SET level=60,gold=100000 WHERE tg_id=?').bind('97777').run();const gear={...makeGear({id:'lock-regression',tgId:'97777',cls:'sword',slot:'helmet',tier:6,rng:()=>.5,now:T0}),affixes_json:item().affixes_json};await insertEquipStmt(env.DB,gear).run();await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'scroll_r',24)").bind('97777').run();return{env,gear};}
test('three-line background job really rolls twice, preserves exact locked row, charges actual attempts and stops only when both remaining rows qualify',async t=>{
 const{env,gear}=await fixture(t),b={itemId:gear.id,requestId:'lock-regression-1',...config()},first=(await R.start(env,'97777',b,T0)).job;
 assert.equal(first.status,'running');assert.equal(first.attempts,0);assert.equal((await R.start(env,'97777',b,T0)).job.id,first.id);
 const cost=affixCost(gear,[0]);assert.equal(cost.scrolls,12);assert.equal(cost.fee,720);
 await R.step(env,first.id,T0,forceMutable(['critPct','maxHpPct'],[100,0]));let job=await R.view(env,'97777');assert.equal(job.status,'running');assert.equal(job.attempts,1);assert.equal(job.spentGold,720);
 let player=await loadPlayer(env.DB,'97777');assert.deepEqual(affixLines(player.equipment.find(x=>x.id===gear.id))[0],fixed);assert.equal(player.inv.scroll_r,12);
 await R.step(env,first.id,T0+3000,forceMutable(['critPct','maxHpPct'],[100,100]));job=await R.view(env,'97777');assert.equal(job.status,'ended');assert.equal(job.reason,'target');assert.equal(job.attempts,2);assert.equal(job.spentGold,1440);assert.equal(job.spentScrolls,24);
 player=await loadPlayer(env.DB,'97777');assert.deepEqual(affixLines(player.equipment.find(x=>x.id===gear.id))[0],fixed);assert.equal(player.char.gold,100000-1440);assert.equal(player.inv.scroll_r,0);
 assert.equal(await R.step(env,first.id,T0+6000),false);assert.equal((await loadPlayer(env.DB,'97777')).char.gold,player.char.gold);
});
test('already good remaining lines and invalid function-only locked targets never consume a scroll',async t=>{
 const{env,gear}=await fixture(t);await assert.rejects(R.start(env,'97777',{itemId:gear.id,requestId:'invalid-lock-only',...config({quality:null})},T0),e=>e.code==='target');
 await env.DB.prepare('UPDATE rpg_equipment SET affixes_json=? WHERE id=?').bind(item([fixed,{...crit,score:100},{...hp,score:100}]).affixes_json,gear.id).run();
 const job=(await R.start(env,'97777',{itemId:gear.id,requestId:'already-good-lock',...config()},T0)).job;assert.equal(job.reason,'target');assert.equal(job.spentGold,0);assert.equal(job.spentScrolls,0);assert.equal((await loadPlayer(env.DB,'97777')).inv.scroll_r,24);
});
