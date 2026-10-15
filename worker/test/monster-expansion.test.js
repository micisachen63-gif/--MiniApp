import test from 'node:test';import assert from 'node:assert/strict';
import {MAPS,ITEMS,TRADE} from '../src/game/constants.js';
import {MONSTER_DATA,MONSTER_RECIPES} from '../src/game/monster-data.js';
import {monsterPool,chooseMonster,monsterMaterialPlan,bossCorePlan,collectionView,materialPair,materialUseful} from '../src/game/monsters.js';
import {idleCombatState,resolveIdleCombat} from '../src/game/idle-combat.js';
import {newBoss,lootPlan} from '../src/game/boss.js';
import {settleIdle} from '../src/game/idle.js';
import {monsterExchange} from '../src/services/monster-exchange.js';
import {mkChar,starterGear,T0} from './helpers.js';import {freshDb} from './d1-shim.js';import {loadPlayer} from '../src/db.js';import * as P from '../src/services/player.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';
import {bossView} from '../src/views.js';
for(const map of Object.values(MAPS)){
 test(`expansion map ${map.id}: ten normals, three elites, two bosses, legacy sources and readiness`,()=>{
  assert.equal(map.monsters.length,10);assert.equal(map.normalPool.length,10);assert.equal(map.elitePool.length,3);assert.equal(map.bossPool.length,2);
  assert.equal(map.elitePool[0].name,map.elite);assert.equal(map.bossPool[0].name,map.boss.name);assert.ok(map.bossPool.every(b=>b.mat===map.boss.mat));
  for(const [role,count]of [['normal',10],['elite',3],['boss',2]]){
   const full=monsterPool(map.id,role,{includePending:true});assert.equal(full.length,count);
   const keys=new Set(full.map(m=>m.spriteKey)),active=monsterPool(map.id,role,{readyKeys:keys});assert.equal(active.length,count);
   for(let i=0;i<count;i++){const selected=chooseMonster(map.id,role,i,{readyKeys:keys});assert.equal(selected,full[i]);assert.equal(selected.attackDirection,-1);assert.ok(selected.behavior);assert.ok(selected.spell);assert.ok(ITEMS[selected.material]);}
   assert.ok(monsterPool(map.id,role,{readyKeys:new Set()}).every(m=>!m.expansion));
  }
  const state=idleCombatState(mkChar({level:map.min}));assert.ok(state.enemies.every(e=>e.spriteKey&&e.spell&&e.hp===e.maxHp));
  const boss=newBoss({id:'fixture',hour:9,start:T0,end:T0+1800000},map.id,()=>.2,'group');assert.ok(monsterPool(map.id,'boss').some(m=>m.name===boss.name));
 });
}
test('unique 180 identities and every bound material has an actual consumption recipe',()=>{
 assert.equal(MONSTER_DATA.length,180);assert.equal(new Set(MONSTER_DATA.map(x=>x.spriteKey)).size,180);assert.equal(MONSTER_DATA.filter(x=>x.expansion).length,108);
 for(const [key,item]of Object.entries(ITEMS).filter(([k])=>k.startsWith('hunt_'))){assert.ok(MONSTER_RECIPES.some(r=>r.ingredients.some(x=>x.item===key)));assert.equal(item.kind,'bound');assert.equal(TRADE.tradeableItems.includes(key),false);}
});
test('materials require true zero-HP defeats, never partial strikes or client counters; capped and separate RNG',()=>{
 const c=mkChar(),state=idleCombatState(c),partial=resolveIdleCombat(state,c,{at:T0,killsBudget:.2});
 assert.deepEqual(monsterMaterialPlan(partial,()=>0),{});
 const kill=resolveIdleCombat(state,c,{at:T0+60000,killsBudget:1,elite:true});assert.equal(kill.defeated.length,kill.kills+kill.eliteKills);
 assert.ok(kill.defeated.every(e=>e.hp===0));const counts={},drops=monsterMaterialPlan(kill,()=>0,counts);assert.equal(Object.values(drops).reduce((a,b)=>a+b,0),2);
 const full=Object.fromEntries(Object.keys(drops).map(k=>[k,k.endsWith('sigil')?4:24]));assert.deepEqual(monsterMaterialPlan(kill,()=>0,full),{});
 assert.deepEqual(monsterMaterialPlan({...kill,defeated:kill.defeated.map(e=>({...e,hp:1}))},()=>0),{});
 const a=settleIdle(c,{red_1:1000,blue_1:1000},starterGear(c),T0+600000),b=settleIdle(c,{red_1:1000,blue_1:1000},starterGear(c),T0+600000);assert.deepEqual(a,b);
 const noTime=settleIdle(a.char,a.inv,starterGear(c),a.char.last_settle_at);assert.deepEqual(noTime.inv,a.inv);assert.equal(noTime.report.kills,0);
});
test('boss core requires killed HP, actual contribution, under-cap account, preserves existing conserved gold',()=>{
 const boss={map_id:4,hp:0,status:'settling'},a=(id,account,damage,lootToday=0)=>({tg_id:id,char:{...mkChar({level:35}),account_tg_id:account},inv:{},damage,lootToday});
 const attackers=[a('a','1',10),a('b','1',20),a('c','2',0),a('d','3',20,4),a('e','4',20)];
 assert.deepEqual(bossCorePlan(boss,attackers).map(x=>x.tgId),['b','e']);assert.deepEqual(bossCorePlan({...boss,hp:1},attackers),[]);assert.deepEqual(bossCorePlan({...boss,status:'fled'},attackers),[]);
 const p=lootPlan(boss,attackers.filter(x=>x.damage>0&&x.lootToday===0),()=>.1);assert.equal(Object.values(p.gold).reduce((a,b)=>a+b,0),1500*4*3);
});
test('recipe is paid and consumed atomically, cannot duplicate unlocks or requests, and insufficient payment changes nothing',async()=>{
 const env={DB:freshDb()};await P.createCharacter(env,{tgId:'111',name:'收藏測試',gender:'f',baseClass:'mage'},T0);
 const recipe=MONSTER_RECIPES[0];for(const x of recipe.ingredients)await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111',x.item,x.qty*2).run();
 const run=b=>P.withPlayer(env,'111',T0,(w,c)=>monsterExchange(w,c,b)),before=await loadPlayer(env.DB,'111');
 await assert.rejects(run({recipe:'bogus',requestId:'test-0000'}));await assert.rejects(run({recipe:'collection-2',requestId:'test-0001'}));assert.deepEqual(await loadPlayer(env.DB,'111'),before);
 await run({recipe:recipe.id,requestId:'test-0002'});const after=await loadPlayer(env.DB,'111');assert.equal(after.char.gold,before.char.gold-recipe.gold);for(const x of recipe.ingredients)assert.equal(after.inv[x.item],x.qty);assert.equal(after.inv[recipe.item],1);assert.equal(collectionView(after.inv).unlocked.length,1);
 await assert.rejects(run({recipe:recipe.id,requestId:'test-0002'}));await assert.rejects(run({recipe:recipe.id,requestId:'test-0003'}));assert.deepEqual(await loadPlayer(env.DB,'111'),after);
 const work={char:mkChar({gold:0}),inv:{},equipment:[]},saved=structuredClone(work);assert.throws(()=>monsterExchange(work,{now:T0},{recipe:recipe.id,requestId:'test-0004'}));assert.deepEqual(work,saved);
});
test('boss core settlement shares kill transaction, retry grants zero additional materials',async()=>{
 const {spawnDue,settleKill}=await import('../src/services/boss.js');const env={DB:freshDb()};await P.createCharacter(env,{tgId:'111',name:'核心測試',gender:'m',baseClass:'sword'},T0);
 const b=await spawnDue(env,T0,{force:{tier:1}});await env.DB.prepare('INSERT INTO rpg_boss_attacks(boss_id,tg_id,win,damage,created_at) VALUES(?,?,?,?,?)').bind(b.id,'111',0,100,T0).run();assert.equal((await settleKill(env,b.id,T0)).claimed,false);
 await env.DB.prepare('UPDATE rpg_boss_instances SET hp=0 WHERE id=?').bind(b.id).run();const r=await settleKill(env,b.id,T0);assert.equal(r.monsterMaterials.length,1);await settleKill(env,b.id,T0);const p=await loadPlayer(env.DB,'111');assert.equal(p.inv.hunt_1_core,1);
});
test('reused recipe request across two maps rolls back all materials, gold, unlock and revision',async()=>{
 const env={DB:freshDb()};await P.createCharacter(env,{tgId:'111',name:'操作測試',gender:'m',baseClass:'sword'},T0);await env.DB.prepare("UPDATE rpg_characters SET level=15 WHERE tg_id='111'").run();
 for(const r of MONSTER_RECIPES.slice(0,2))for(const x of r.ingredients)await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111',x.item,x.qty).run();
 const run=recipe=>P.withPlayer(env,'111',T0,(w,c)=>monsterExchange(w,c,{recipe,requestId:'one-operation-01'}));await run('collection-1');const before=await loadPlayer(env.DB,'111');await assert.rejects(run('collection-2'),e=>e.code==='duplicate');assert.deepEqual(await loadPlayer(env.DB,'111'),before);
});
test('real Mini App exchange route uses verified player identity and returns unlock to its owner',async()=>{
 const {handle}=await import('../src/index.js');const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
 for(const [tgId,name]of [['111','路由玩家'],['222','別人玩家']])await P.createCharacter(env,{tgId,name,gender:'m',baseClass:'sword'},T0);
 const r=MONSTER_RECIPES[0];for(const x of r.ingredients)await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111',x.item,x.qty).run();
 const call=headers=>handle(new Request('http://rpg/app/api/monster-exchange',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Now':String(T0),...headers},body:JSON.stringify({recipe:r.id,requestId:'api-exchange-001',tgId:'222'})}),env);
 assert.equal((await call({})).status,401);const response=await call({'X-Dev-Tg-Id':'111','X-Monster-Art-Revision':MONSTER_ART_REVISION});assert.equal(response.status,200);const body=await response.json();assert.equal(body.result.item,r.item);assert.equal(body.collection.unlocked.length,1);assert.equal((await loadPlayer(env.DB,'222')).inv[r.item]||0,0);
});
test('committed monster presentation references real before-wave identity without inventing damage or persisting offline history',()=>{
 const c=mkChar(),state=idleCombatState(c),round=resolveIdleCombat(state,c,{at:T0+60000,killsBudget:.2});
 const action=round.presentation.monsterActions[0],enemy=round.before.find(e=>e.id===action.sourceId);assert.ok(enemy);assert.equal(action.spriteKey,enemy.spriteKey);assert.equal(action.spell,enemy.spell);assert.equal(action.attackDirection,-1);assert.equal(action.cosmetic,true);assert.equal(action.damage,undefined);assert.equal(action.hp,undefined);
 assert.ok(round.events.every(e=>['hit','spawn','elite'].includes(e.type)));const offline=resolveIdleCombat(state,c,{at:T0+120000,killsBudget:.2,record:false});assert.equal(offline.presentation,undefined);assert.equal(state.round,null);
});
test('all five material slots refine strictly downward 3:1, remain bound and cannot yield currency or gear',()=>{
 for(const slot of ['1','2','3','sigil','core']){
  const source=`hunt_12_${slot}`,target=`hunt_1_${slot}`,w={char:mkChar({level:115,gold:1234}),inv:{[source]:9},equipment:[]};assert.equal(materialPair(source,target),true);
  const r=monsterExchange(w,{now:T0},{refineTarget:target,sourceItem:source,count:3,requestId:`refine-slot-${slot}`});assert.equal(w.inv[source],0);assert.equal(w.inv[target],3);assert.equal(w.char.gold,1234);assert.deepEqual(w.equipment,[]);assert.equal(r.result.targetQty,3);assert.equal(TRADE.tradeableItems.includes(target),false);
  for(const [a,b]of [[target,source],[source,source],[source,`hunt_1_${slot==='1'?'2':'1'}`],['scroll_w',target],[source,'boss_essence'],['hunt_99_1',target]])assert.equal(materialPair(a,b),false);
 }
});
test('refine validation failure does not mutate state; quantities are integer1..100 and missing materials are not minted',()=>{
 const w={char:mkChar({level:115,gold:1234}),inv:{hunt_12_1:3},equipment:[]},saved=structuredClone(w),base={refineTarget:'hunt_1_1',sourceItem:'hunt_12_1',requestId:'refine-invalid-001'};
 for(const count of [0,-1,1.2,101,'not-a-number',Infinity]){assert.throws(()=>monsterExchange(w,{now:T0},{...base,count}));assert.deepEqual(w,saved);}
 assert.throws(()=>monsterExchange(w,{now:T0},{...base,count:2}),e=>e.code==='insufficient');assert.deepEqual(w,saved);
 const hundred={...w,inv:{hunt_12_1:300}};monsterExchange(hundred,{now:T0},{...base,count:100});assert.equal(hundred.inv.hunt_1_1,100);assert.equal(hundred.inv.hunt_12_1,0);
});
test('refine is transactional and request replay cannot repeat consumption or mint output',async()=>{
 const env={DB:freshDb()};await P.createCharacter(env,{tgId:'111',name:'精煉測試',gender:'m',baseClass:'sword'},T0);await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','hunt_12_core',12)").run();
 const body={action:'refine',refineTarget:'hunt_1_core',sourceItem:'hunt_12_core',count:2,requestId:'refine-request-001'},run=b=>P.withPlayer(env,'111',T0,(w,c)=>monsterExchange(w,c,b));await run(body);const first=await loadPlayer(env.DB,'111');assert.equal(first.inv.hunt_12_core,6);assert.equal(first.inv.hunt_1_core,2);assert.equal(first.char.gold,1000);
 await assert.rejects(run(body),e=>e.code==='duplicate');assert.deepEqual(await loadPlayer(env.DB,'111'),first);
 await assert.rejects(run({...body,refineTarget:'hunt_2_core'}),e=>e.code==='duplicate');assert.deepEqual(await loadPlayer(env.DB,'111'),first);
 await assert.rejects(run({...body,count:3,requestId:'refine-request-002'}),e=>e.code==='insufficient');assert.deepEqual(await loadPlayer(env.DB,'111'),first);
});
test('missing collection ingredients advertise only affordable downward same-slot refine options',()=>{
 const inv={hunt_12_1:12,hunt_12_sigil:2,hunt_12_core:3,hunt_1_1:12,collection_2:1};const view=collectionView(inv);
 assert.ok(view.refineOptions.some(x=>x.source==='hunt_12_core'&&x.target==='hunt_1_core'&&x.qty===3&&x.gain===1&&x.have===3));
 assert.ok(view.refineOptions.every(x=>materialPair(x.source,x.target)&&x.have>=3));assert.ok(view.refineOptions.every(x=>x.target!=='hunt_1_1'&&!x.target.startsWith('hunt_2_')));
});
test('same-map boss alternates by last recorded name across dates and other map spawns, with no added context query',async()=>{
 const {spawnContext}=await import('../src/services/boss.js'),db=freshDb(),allKeys=new Set(MONSTER_DATA.filter(m=>m.role==='boss').map(m=>m.spriteKey)),pool=monsterPool(1,'boss',{includePending:true});
 const insert=async(id,tier,name,time)=>db.prepare('INSERT INTO rpg_boss_instances(id,chat_id,map_id,name,element,base_hp,max_hp,hp,started_at,ends_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,'group',tier,name,'fire',3000,3000,0,time,time+1800000,'killed').run();
 await insert('b-old-primary',1,pool[0].name,T0-86400000);await insert('b-old-secondary',1,pool[1].name,T0-10800000);await insert('b-other-map',2,MAPS[2].boss.name,T0-3600000);
 let queries=0;const watched={prepare(sql){queries++;return db.prepare(sql);}},slot={id:'b-fixture-next',day:'2026-10-08',hour:9,start:T0,end:T0+1800000};const context=await spawnContext(watched,slot);assert.equal(queries,2);assert.equal(context.prevTier,2);assert.equal(context.lastBossNames[1],pool[1].name);
 const next=newBoss(slot,1,()=>.2,'group',{previousName:context.lastBossNames[1],readyKeys:allKeys});assert.equal(next.name,pool[0].name);assert.equal(next.base_hp,MAPS[1].boss.baseHp);
 await insert('b-new-primary',1,next.name,T0);const later=await spawnContext(db,{...slot,start:T0+7200000,hour:11});assert.equal(newBoss({...slot,hour:11},1,()=>.2,'group',{previousName:later.lastBossNames[1],readyKeys:allKeys}).name,pool[1].name);
 assert.equal(newBoss(slot,1,()=>.2,'group',{previousName:pool[0].name,readyKeys:new Set()}).name,pool[0].name);
});
test('all12 completed collections stop all60 extra materials without advancing daily drop counters or changing material RNG consumption',()=>{
 const done=Object.fromEntries(MONSTER_RECIPES.map(r=>[r.item,1]));for(const key of Object.keys(ITEMS).filter(k=>k.startsWith('hunt_')))assert.equal(materialUseful(done,key),false);
 const c=mkChar(),round=resolveIdleCombat(idleCombatState(c),c,{at:T0+60000,killsBudget:2,elite:true}),counts={};let calls=0;assert.deepEqual(monsterMaterialPlan(round,()=>{calls++;return 0;},counts,done),{});assert.deepEqual(counts,{});assert.equal(calls,2);
 let uncompletedCalls=0;monsterMaterialPlan(round,()=>{uncompletedCalls++;return 0;},{},{});assert.equal(uncompletedCalls,calls);
 assert.deepEqual(bossCorePlan({map_id:1,hp:0,status:'settling'},[{tg_id:'111',damage:1,lootToday:0,char:c,inv:done}]),[]);
});
test('a completed high map still supplies only missing lower-map same-slot ingredients, stopping once existing ingredients cover recipes',()=>{
 const inv=Object.fromEntries(MONSTER_RECIPES.map(r=>[r.item,1]));delete inv.collection_1;inv.hunt_1_2=12;inv.hunt_1_3=12;inv.hunt_1_sigil=2;inv.hunt_1_core=1;
 assert.equal(materialUseful(inv,'hunt_12_1'),true);assert.equal(materialUseful(inv,'hunt_12_2'),false);assert.equal(materialUseful(inv,'hunt_12_sigil'),false);assert.equal(materialUseful(inv,'hunt_12_core'),false);assert.equal(materialUseful(inv,'scroll_w'),false);
 inv.hunt_1_1=12;assert.equal(materialUseful(inv,'hunt_12_1'),false);delete inv.hunt_1_core;assert.equal(materialUseful(inv,'hunt_12_core'),true);
});
test('stopping cosmetic drops leaves real HP, EXP/gold, old scroll/gear/relic streams and potion use exactly unchanged',()=>{
 const c=mkChar({level:25,class_path:'A'}),base={red_2:100000,blue_2:100000},done={...base,...Object.fromEntries(MONSTER_RECIPES.map(r=>[r.item,1]))},a=settleIdle(c,base,starterGear(c),T0+86400000),b=settleIdle(c,done,starterGear(c),T0+86400000);
 for(const key of ['hp','mp','level','exp','gold','idle_state','last_settle_at','idle_combat_json'])assert.equal(b.char[key],a.char[key],key);
 for(const key of ['exp_gained','exp_lost','gold_gained','gold_kills','gold_elites','kills','deaths','elites','used','eliteGear','relics'])assert.deepEqual(b.report[key],a.report[key],key);
 for(const key of Object.keys(ITEMS).filter(k=>!k.startsWith('hunt_')&&!k.startsWith('collection_')))assert.equal(b.inv[key]||0,a.inv[key]||0,key);
 assert.ok(Object.keys(a.report.drops).some(k=>k.startsWith('hunt_')));assert.ok(!Object.keys(b.report.drops).some(k=>k.startsWith('hunt_')));
});
test('boss kill rechecks completed collection inside its existing batch and records no phantom core when completion raced its inventory read',async()=>{
 const {spawnDue,settleKill}=await import('../src/services/boss.js'),env={DB:freshDb()};await P.createCharacter(env,{tgId:'111',name:'停給測試',gender:'m',baseClass:'sword'},T0);
 const b=await spawnDue(env,T0,{force:{tier:1}});await env.DB.prepare('INSERT INTO rpg_boss_attacks(boss_id,tg_id,win,damage,created_at) VALUES(?,?,?,?,?)').bind(b.id,'111',0,100,T0).run();await env.DB.prepare('UPDATE rpg_boss_instances SET hp=0 WHERE id=?').bind(b.id).run();
 const original=env.DB.batch.bind(env.DB);let raced=false;
 env.DB.batch=async stmts=>{if(!raced&&stmts.some(s=>s.sql?.startsWith('INSERT INTO rpg_inventory(tg_id,item,quantity) SELECT'))){raced=true;for(const recipe of MONSTER_RECIPES)env.DB.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,1)').run('111',recipe.item);}return original(stmts);};
 const result=await settleKill(env,b.id,T0);assert.equal(raced,true);assert.deepEqual(result.monsterMaterials,[]);const p=await loadPlayer(env.DB,'111');assert.equal(p.inv.hunt_1_core||0,0);assert.equal(p.char.gold,2500);assert.equal(p.inv.boss_essence,5);
 const persisted=await env.DB.prepare('SELECT result_json FROM rpg_boss_instances WHERE id=?').bind(b.id).first();assert.deepEqual(JSON.parse(persisted.result_json).monsterMaterials,[]);assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM rpg_ledger WHERE type='首領收藏材料'").first()).n,0);
 await settleKill(env,b.id,T0);assert.equal((await loadPlayer(env.DB,'111')).char.gold,2500);
});
test('all180 advertised material identities match actual normal/sigil/core drops while legacy advancement MAT stays separate',()=>{
 for(const m of MONSTER_DATA){const expected=m.role==='elite'?`hunt_${m.mapId}_sigil`:m.role==='boss'?`hunt_${m.mapId}_core`:m.material;assert.equal(m.material,expected);assert.ok(ITEMS[m.material]);if(m.role==='normal')assert.match(m.material,new RegExp(`^hunt_${m.mapId}_[123]$`));
  if(m.role==='boss'){const view=bossView({id:'fixture',map_id:m.mapId,name:m.name,hp:0,max_hp:1,started_at:T0,ends_at:T0+1800000,status:'killed'},[],T0);assert.equal(view.collectionMaterial,expected);assert.equal(view.material,ITEMS[MAPS[m.mapId].boss.mat]?.name);}
 }
 assert.equal(MONSTER_DATA.filter(m=>m.role!=='normal').length,60);assert.equal(MAPS[3].boss.mat,'mat_1');assert.equal(MAPS[6].boss.mat,'mat_2');assert.equal(MAPS[9].boss.mat,'mat_3');assert.equal(MAPS[12].boss.mat,'mat_4');
});
