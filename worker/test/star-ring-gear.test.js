import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {makeStarRingGear,repairStarRingGear,legacyStarRingGear,STAR_RING_GEAR,starRingGearDropPlan} from '../src/game/star-ring-gear.js';
import {makeGear,gearOffers,convertWeapon} from '../src/game/gear.js';import {itemStat,itemExtras} from '../src/game/stats.js';
import {starRingArtId} from '../public/star-ring-gear-art.js';
import {gearArt,cardPhoto} from '../src/game/share.js';import {CLASS_KEYS,SLOTS,RARITIES,TIER_LEVEL_REQ,GENERAL_WEAPON} from '../src/game/constants.js';
import {mapForLevel,expToNext} from '../src/game/formulas.js';import {affixLines,affixSlots} from '../src/game/affixes.js';import {rngFor} from '../src/game/rng.js';
import {skillExpedition,shortParty,NOW} from './star-ring-skill-fixture.js';import * as Ring from '../src/services/star-ring.js';import * as Engine from '../src/game/star-ring.js';
import * as P from '../src/services/player.js';import * as Party from '../src/services/party.js';import * as Trade from '../src/services/trade.js';import * as Auto from '../src/services/auto-enhance.js';
import {insertEquipStmt,loadPlayer} from '../src/db.js';
const legacy=(id,owner,over={})=>({...makeGear({id,tgId:owner,cls:'sword',slot:'boots',tier:4,forceRarity:'advanced',rng:()=>.5,now:NOW}),source:'star_ring',name:'星征海神鐵靴',enhance_level:7,...over});
async function seed(f,over={}){const e=legacy('legacy-ring-gear',f.ids[0],over);await insertEquipStmt(f.env.DB,e).run();return e;}
const row=f=>f.db.prepare("SELECT * FROM rpg_equipment WHERE id='legacy-ring-gear'").get();
const count=f=>f.db.prepare("SELECT count(*) n FROM rpg_ledger WHERE event_id='star-ring-gear-v1:legacy-ring-gear'").get().n;
async function fixture(t,opts={}){const f=await skillExpedition(opts);t.after(f.close);return f;}

for(const cls of CLASS_KEYS)test(`${cls}: every level boundary generates own-class wearable legendary expedition equipment with correct affix slots`,()=>{
 for(const level of [40,41,49,50,51,55,60,61,70,71,80,81,90,91,100,101,110,111,120])for(let n=0;n<24;n++){
  const e=makeStarRingGear({id:'g',tgId:'1',cls,classPath:'A1',level,rng:rngFor(cls+level+':'+n),now:NOW});
  assert.equal(e.tier,mapForLevel(level));assert.equal(e.level_req,TIER_LEVEL_REQ[e.tier]);assert.ok(e.level_req<=level);assert.ok(['any',cls].includes(e.class_req));
  assert.ok(['legendary','supreme'].includes(e.element_tier));assert.equal(affixLines(e).length,affixSlots(e));assert.equal(legacyStarRingGear(e),false);
 }
});

for(const cls of CLASS_KEYS)test(`${cls}: expedition main, enhancement, element and flat bonuses outperform equal-tier equal-roll ordinary gear without changing normal/relic stats`,()=>{
 for(const slot of SLOTS)for(const tier of [4,6,8,10,12])for(const quality of ['legendary','supreme'])for(const level of [0,7,15]){
  const normal={...makeGear({id:'n',tgId:'1',cls,slot,kind:slot==='weapon'?GENERAL_WEAPON[cls]:null,tier,forceRarity:quality,rng:()=>.5,now:NOW}),enhance_level:level},expedition={...normal,source:'star_ring'};
  const a=itemStat(normal,cls),b=itemStat(expedition,cls);assert.ok(b.main>a.main,`${slot}/T${tier}/+${level}`);assert.ok(Math.abs(b.main-a.main*STAR_RING_GEAR.statMult)<2);assert.ok(b.elem>=a.elem);
  const x=itemExtras(normal),y=itemExtras(expedition);for(const key of ['hp','mp','atk','def'])assert.ok(y.flat[key]>=x.flat[key]);assert.deepEqual(x.pct,y.pct);
  assert.deepEqual(itemStat({...normal,grade:'relic'},cls),itemStat({...expedition,grade:'relic'},cls),'never stack expedition multiplier on relics');
 }
});

test('every class, branch and slot uses the exact tier art and existing real share-card file, never a generic chestplate for boots',()=>{
 for(const cls of CLASS_KEYS)for(const branch of ['A','B'])for(const e of gearOffers({base_class:cls,class_path:branch,level:120})){
  const source={...e,source:'star_ring',class_req:cls,name:'星征'+e.name},expected='star_ring_'+starRingArtId(source),actual=gearArt(source);assert.equal(actual,expected,e.name);assert.notEqual(actual,gearArt({...e,class_req:cls}));
  const photo=cardPhoto({...source,element_tier:'legendary'});assert.ok(fs.existsSync(new URL('../public'+photo,import.meta.url)),photo);
  if(e.slot==='boots')assert.match(actual,/boots/);if(e.slot==='gloves')assert.match(actual,/gloves/);
 }
});

for(const version of [1,2,3])for(const online of [false,true])test(`v${version} ${online?'checkpoint':'offline'} existing Lv40 run gives Lv80 members T8 instead of T4; combat, other rewards and receipts stay unchanged`,async t=>{
 const f=await fixture(t,{version,runTier:40}),departure=f.state(),reference=structuredClone(departure);
 for(let stage=0;stage<6;stage++){const result=Engine.simulateStage(reference,stage);reference.results.push(result);if(online)await Ring.view(f.env,f.id,f.ids[0],NOW+(stage+1)*Engine.STAGE_MS);}
 const done=await Ring.view(f.env,f.id,f.ids[0],NOW+Engine.DURATION);assert.equal(done.status,'complete');assert.deepEqual(f.state().results,reference.results);assert.deepEqual(f.state().actors,departure.actors);
 for(const owner of f.ids){const records=f.db.prepare('SELECT stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? AND char_id=? ORDER BY stage').all(f.id,owner),a=reference.actors.find(a=>a.id===owner),c=f.db.prepare('SELECT level FROM rpg_characters WHERE tg_id=?').get(owner);
  assert.equal(records.length,6);for(const record of records){const r=JSON.parse(record.reward_json),old=Engine.stageReward(reference,a,record.stage,reference.results[record.stage]);assert.equal(r.exp,old.exp);assert.deepEqual(r.items,old.items);assert.deepEqual(r.equipment.map(e=>e.id),starRingGearDropPlan(reference,a,record.stage,reference.results[record.stage],old.equipment).ids);assert.ok(r.equipment.length>=1);
   for(const e of r.equipment){assert.equal(e.tier,mapForLevel(c.level));assert.ok(e.tier>=8);assert.ok(['legendary','supreme'].includes(e.element_tier));assert.equal(legacyStarRingGear(e),false);assert.equal(f.db.prepare('SELECT tier FROM rpg_equipment WHERE id=?').get(e.id).tier,e.tier);}
  }
 }
 const receipts=f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=?').all(f.id);await Ring.sweep(f.env,NOW+Engine.DURATION+60000);await Ring.view(f.env,f.id,f.ids[0],NOW+Engine.DURATION+60001);assert.deepEqual(f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=?').all(f.id),receipts);assert.equal(receipts.length,30);
});

test('final stage EXP level-up happens before equipment tier selection',async t=>{
 const f=await fixture(t,{runTier:40});await Ring.sweep(f.env,NOW+5*Engine.STAGE_MS);
 f.db.prepare("UPDATE rpg_characters SET class_path='A11',exp=? WHERE tg_id=?").run(expToNext(80)-1,f.ids[0]);
 const p=await Ring.view(f.env,f.id,f.ids[0],NOW+Engine.DURATION),c=f.character();assert.ok(c.level>=81);assert.ok(p.me.rewards.equipment.length);const final=JSON.parse(f.db.prepare('SELECT reward_json FROM rpg_star_ring_rewards WHERE run_id=? AND char_id=? AND stage=5').get(f.id,f.ids[0]).reward_json);assert.ok(final.equipment.every(e=>e.tier===mapForLevel(c.level)&&e.level_req<=c.level));
});

test('legacy worn T4 repair is atomic and once only, retaining enhancement, binding, element and affix identity through future levels',async t=>{
 const f=await fixture(t),e=await seed(f,{is_equipped:1,bound:1}),before=affixLines(e),snapshot=f.state();
 await P.withPlayer(f.env,f.ids[0],NOW+1);const fixed=row(f);assert.equal(fixed.tier,8);assert.equal(fixed.enhance_level,7);assert.equal(fixed.bound,1);assert.equal(fixed.is_equipped,1);assert.equal(fixed.element,e.element);
 assert.equal(affixLines(fixed).length,3);for(const[i,line]of before.entries()){assert.equal(affixLines(fixed)[i].key,line.key);assert.equal(affixLines(fixed)[i].score,line.score);assert.ok(affixLines(fixed)[i].value>=line.value);}
 assert.equal(itemExtras(fixed).pct.starRingGearVersion,undefined);assert.equal(count(f),1);assert.deepEqual(f.state(),snapshot);
 f.db.prepare('UPDATE rpg_characters SET level=100 WHERE tg_id=?').run(f.ids[0]);await P.withPlayer(f.env,f.ids[0],NOW+2);assert.deepEqual(row(f),fixed);assert.equal(count(f),1);
});

test('concurrent legacy reads produce one correction receipt and no new equipment, currency or ownership',async t=>{
 const f=await fixture(t);await seed(f);const c=f.character(),n=f.db.prepare('SELECT count(*) n FROM rpg_equipment').get().n;
 await Promise.all([P.withPlayer(f.env,f.ids[0],NOW+1),P.withPlayer(f.env,f.ids[0],NOW+1)]);assert.equal(count(f),1);assert.equal(row(f).tier,8);assert.equal(row(f).tg_id,f.ids[0]);assert.equal(f.character().gold,c.gold);assert.equal(f.db.prepare('SELECT count(*) n FROM rpg_equipment').get().n,n);
});

test('legacy escrow is untouched until returned, including its immutable offer snapshot',async t=>{
 const f=await fixture(t),e=await seed(f),opened=await Trade.openTradeStmts(f.env,{aTg:f.ids[0],bTg:f.ids[1],preEquip:e},NOW);await f.env.DB.batch(opened.stmts);
 const before=row(f),snapshot=f.db.prepare('SELECT snapshot_json FROM rpg_trade_items WHERE trade_id=?').get(opened.id).snapshot_json;
 await P.withPlayer(f.env,f.ids[0],NOW+1);assert.deepEqual(row(f),before);assert.equal(count(f),0);assert.equal(f.db.prepare('SELECT snapshot_json FROM rpg_trade_items WHERE trade_id=?').get(opened.id).snapshot_json,snapshot);
 await Trade.cancel(f.env,{tgId:f.ids[0],tradeId:opened.id},NOW+2);await P.withPlayer(f.env,f.ids[0],NOW+3);assert.equal(row(f).tier,8);assert.equal(count(f),1);
});

test('background enhancement holds legacy gear unchanged; it repairs safely once the existing job stops',async t=>{
 const f=await fixture(t),e=await seed(f),j=(await Auto.start(f.env,f.ids[0],{itemId:e.id,target:8},NOW)).job,before=row(f);
 await P.withPlayer(f.env,f.ids[0],NOW+1);assert.deepEqual(row(f),before);assert.equal(count(f),0);await Auto.stop(f.env,f.ids[0],{jobId:j.id},NOW+2);await P.withPlayer(f.env,f.ids[0],NOW+3);assert.equal(row(f).tier,8);assert.equal(row(f).enhance_level,7);assert.equal(count(f),1);
});

test('foreground combat holds legacy gear unchanged; returning to the expedition repairs without touching either battle snapshot',async t=>{
 const f=await fixture(t),id=await shortParty(f,'dungeon'),e=await seed(f),s=f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json,ring=f.state();
 await P.withPlayer(f.env,f.ids[0],NOW+1001);assert.equal(row(f).tier,4);assert.equal(count(f),0);assert.equal(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json,s);
 await Party.action(f.env,f.ids[0],{partyId:id,op:'end'},NOW+1002);await P.withPlayer(f.env,f.ids[0],NOW+1003);assert.equal(row(f).tier,8);assert.equal(count(f),1);assert.deepEqual(f.state(),ring);
});

test('branch weapon conversion preserves repair version so later reads cannot grant another tier upgrade',()=>{
 for(let seed=0;seed<100;seed++){const w=makeStarRingGear({id:'w',tgId:'1',cls:'sword',classPath:'A1',level:80,rng:rngFor('branch'+seed),now:NOW});if(w.branch_req){const converted=convertWeapon(w);assert.ok(converted);assert.equal(legacyStarRingGear(converted),false);assert.equal(repairStarRingGear(converted,{level:120,base_class:'sword'}).tier,8);return;}}
 assert.fail('fixture must select a branch weapon');
});

test('owned legacy repair never rewrites already-committed expedition rewards or completion notifications',async t=>{
 const f=await fixture(t,{runTier:40});await Ring.sweep(f.env,NOW+Engine.DURATION);
 const receipts=f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=?').all(f.id),outbox=f.db.prepare("SELECT * FROM rpg_outbox WHERE kind='star_ring_complete'").all();
 await seed(f);await P.withPlayer(f.env,f.ids[0],NOW+Engine.DURATION);
 assert.equal(row(f).tier,8);assert.deepEqual(f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=?').all(f.id),receipts);assert.deepEqual(f.db.prepare("SELECT * FROM rpg_outbox WHERE kind='star_ring_complete'").all(),outbox);
});

test('a trade entering escrow during repair forces a revision retry, retaining the old offer and deferring correction',async t=>{
 const f=await fixture(t),e=await seed(f),batch=f.env.DB.batch.bind(f.env.DB);let injected=false;
 f.env.DB.batch=async stmts=>{if(!injected&&stmts.some(s=>s.sql.startsWith('UPDATE rpg_equipment SET')&&s.sql.includes('tier = ?'))){injected=true;const t=await Trade.openTradeStmts(f.env,{aTg:f.ids[0],bTg:f.ids[1],preEquip:e},NOW+1);await batch(t.stmts);}return batch(stmts);};
 await P.withPlayer(f.env,f.ids[0],NOW+2);assert.equal(injected,true);assert.equal(row(f).tier,4);assert.ok(row(f).trade_id);assert.equal(count(f),0);
});

test('background-job commit race leaves legacy gear unchanged and retries without partial correction',async t=>{
 const f=await fixture(t),e=await seed(f),batch=f.env.DB.batch.bind(f.env.DB);let injected=false;
 f.env.DB.batch=async stmts=>{if(!injected&&stmts.some(s=>s.sql.startsWith('UPDATE rpg_equipment SET')&&s.sql.includes('tier = ?'))){injected=true;await Auto.start(f.env,f.ids[0],{itemId:e.id,target:8},NOW+1);}return batch(stmts);};
 await P.withPlayer(f.env,f.ids[0],NOW+2);assert.equal(injected,true);assert.equal(row(f).tier,4);assert.equal(count(f),0);
});

test('repairing a higher-tier transferred item never downgrades it to its current holder level',()=>{
 const e=legacy('higher','1',{tier:12,level_req:111,base_stat:100});const fixed=repairStarRingGear(e,{level:55,base_class:'sword'});assert.equal(fixed.tier,12);assert.equal(fixed.level_req,111);assert.ok(fixed.base_stat>=e.base_stat);assert.equal(fixed.enhance_level,e.enhance_level);
});
