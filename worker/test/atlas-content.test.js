import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {computeStats,standardSet} from '../src/game/stats.js';
import {ATLAS_BUILDS,ATLAS_MAPS,ATLAS_SUPPORTED_RULESETS,getAtlasBuild,getAtlasMap} from '../src/game/atlas-catalog.js';
import {createAtlasRun,advanceAtlasRun,finalizeAtlasActivities} from '../src/game/atlas-engine.js';

const START=1800000000;
function nativeSnapshot(baseClass='sword',level=75,enhance=4,classPath='') {
  const character={id:'native-'+baseClass,base_class:baseClass,class_path:classPath,level};
  const gear=standardSet(baseClass,level).map(item=>({...item,enhance_level:enhance}));
  return {...computeStats(character,gear),characterId:character.id,baseClass,classPath};
}
function make(overrides={}) {
  const build=getAtlasBuild(overrides.buildId||'sword_whirlwind');
  return createAtlasRun({
    runId:'content-run',realmId:'permanent',seed:'content-seed',startAt:START,
    durationSeconds:1800,queueMode:'duration',mapId:'grove_survey',buildId:build.id,
    supports:build.recommendedSupports,automation:build.recommendedAutomation,
    snapshot:nativeSnapshot(build.baseClass),supplies:{hp:50,mp:50,hpRestore:50,mpRestore:40},
    ...overrides,
  });
}
function finish(state,now=state.startedAt+state.durationSeconds,maxSteps=2000) {
  const rewards=[],activities=[];let part;
  do {part=advanceAtlasRun(state,now,{maxSteps});state=part.state;rewards.push(...part.rewards);activities.push(...part.activities);}
  while(part.stillCatchingUp);
  return {state,rewards,activities};
}
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function forcedEncounter(run,id) {
  const row=run.map.encounters.pool.find(item=>item.id===id);
  assert.ok(row,id);
  run.map.encounters={chance:1,maxPerMap:1,pool:[{...row,weight:1}]};
  return run;
}
const count=(rows,kind)=>rows.filter(row=>row.kind===kind).reduce((n,row)=>n+row.quantity,0);

test('v4 adds three fixed-tier survey maps without replacing the original tutorial unlock chain',()=>{
  assert.deepEqual(ATLAS_SUPPORTED_RULESETS,['atlas-v1','atlas-v2','atlas-v3','atlas-v4']);
  assert.equal(ATLAS_MAPS.length,67);
  assert.deepEqual(getAtlasMap('pillar_intro').prerequisites,['laurel_intro']);
  assert.deepEqual(getAtlasMap('grove_intro').prerequisites,['pillar_intro']);
  assert.deepEqual(getAtlasMap('laurel_warden').prerequisites,['grove_intro']);
  for(const[id,level,tier,previous,theme]of [
    ['laurel_survey',20,2,'laurel_warden',1],['pillar_survey',45,5,'laurel_survey',2],['grove_survey',75,8,'pillar_survey',3],
  ]) {
    const map=getAtlasMap(id),original=ATLAS_MAPS.find(row=>row.themeId===theme&&row.kind==='tutorial');
    assert.equal(map.minLevel,level);assert.equal(map.dropTier,tier);assert.equal(map.kind,'survey');
    assert.deepEqual(map.prerequisites,[previous]);assert.equal(map.enemyName,original.enemyName);assert.equal(map.eliteName,original.eliteName);
    assert.equal(map.loot.equipmentEverySeconds,600);assert.equal(map.loot.scrollEverySeconds,300);
  }
});

test('saved v1/v2/v3 states and reward hashes remain exactly the pre-v4 engine result',()=>{
  const golden=JSON.parse(fs.readFileSync(new URL('./fixtures/atlas-legacy-replay-20261104.json',import.meta.url)));
  assert.equal(golden.baseline,'b633c3cdf4b8df6d8e689b21a8e585cc320bba3e');
  for(const fixture of golden.fixtures) {
    const before=JSON.stringify(fixture.run),result=finish(fixture.run,fixture.now,137);
    assert.equal(sha(result.state),fixture.expected.stateSha256,fixture.id+' state');
    assert.equal(sha(result.rewards),fixture.expected.rewardsSha256,fixture.id+' rewards');
    assert.deepEqual(result.activities,[],fixture.id);
    assert.equal(JSON.stringify(fixture.run),before);
    assert.equal(Object.hasOwn(result.state,'content'),false);
    assert.equal(Object.hasOwn(result.state.totals,'equipment'),false);
  }
});

test('the historical cf85f48 v1 fixture keeps its original full final state and reward list',()=>{
  const golden=JSON.parse(fs.readFileSync(new URL('./fixtures/atlas-v1-resume.json',import.meta.url)));
  const result=finish(golden.partial,golden.partial.startedAt+3600,19);
  assert.deepEqual(result.state,golden.expectedFinal);
  assert.deepEqual([...golden.alreadyEarned,...result.rewards],golden.expectedRewards);
  assert.deepEqual(result.activities,[]);
});

test('all twelve v4 builds replay identical state, rewards and activities across arbitrary JSON-persisted partitions',()=>{
  for(const build of ATLAS_BUILDS) {
    const run=make({buildId:build.id,seed:'partitions-'+build.id,snapshot:nativeSnapshot(build.baseClass)});
    const whole=finish(run),before=JSON.stringify(run);
    let state=run;const rewards=[],activities=[];
    for(const elapsed of [0,.5,1,14,15,27.8,60,60,91,301,603,899.9,1217,1800]) {
      const part=finish(JSON.parse(JSON.stringify(state)),START+elapsed,31);
      state=part.state;rewards.push(...part.rewards);activities.push(...part.activities);
    }
    assert.deepEqual({state,rewards,activities},whole,build.id);
    assert.equal(JSON.stringify(run),before,build.id+' input untouched');
    assert.equal(new Set(activities.map(row=>row.kind+'|'+row.sourceId)).size,activities.length);
    for(const row of activities) {
      assert.ok(Number.isSafeInteger(row.quantity)&&row.quantity>0);
      assert.ok(Number.isSafeInteger(row.occurredAt)&&row.occurredAt>=START*1000&&row.occurredAt<=(START+1800)*1000);
      assert.equal(row.mapId,run.mapId);assert.equal(row.buildId,build.id);
    }
    assert.ok(state.events.length<=24);
    assert.deepEqual(advanceAtlasRun(state,START+99999).activities,[]);
  }
});

test('the twelve survey reference builds use real server stats and +4 equipment to clear their advertised level',()=>{
  for(const[mapId,level]of [['laurel_survey',20],['pillar_survey',45],['grove_survey',75]]) {
    for(const buildId of ['sword_whirlwind','archer_beast','mage_frost','thief_poison']) {
      const cls=buildId.split('_')[0],snapshot=nativeSnapshot(cls,level,4);
      const result=finish(make({runId:mapId+'-'+cls,seed:'native-sample-'+mapId+'-'+cls,
        mapId,buildId,snapshot,queueMode:'count',mapCount:1}));
      assert.equal(result.state.status,'completed',mapId+' '+buildId);
      assert.equal(result.state.metrics.mapsCompleted,1);
      assert.ok(result.state.elapsedSeconds<1800);
      assert.ok(result.state.supplies.hpUsed<=50&&result.state.supplies.mpUsed<=50);
      assert.equal(result.state.snapshot.atk,snapshot.atk);
    }
  }
});

test('regional encounters change combat, restoration and earned rewards; merely discovering one grants no success activity',()=>{
  const base=()=>make({mapId:'laurel_survey',queueMode:'count',mapCount:1,snapshot:nativeSnapshot('sword',75,4)});
  const normal=base();normal.map.encounters.chance=0;
  const ordinary=advanceAtlasRun(normal,START+normal.map.entrySeconds).state;
  const hunt=forcedEncounter(base(),'elite_hunt'),huntStart=advanceAtlasRun(hunt,START+hunt.map.entrySeconds);
  assert.equal(huntStart.state.enemies.length,1);assert.equal(huntStart.state.enemies[0].rank,'elite');
  assert.ok(huntStart.state.enemies[0].maxHp>ordinary.enemies[0].maxHp);
  assert.equal(count(huntStart.activities,'encounter'),0);
  const ambush=forcedEncounter(base(),'ambush'),ambushStart=advanceAtlasRun(ambush,START+ambush.map.entrySeconds).state;
  assert.equal(ambushStart.enemies.length,ordinary.enemies.length+1);
  assert.ok(ambushStart.enemies[0].attackInterval<ordinary.enemies[0].attackInterval);
  assert.ok(ambushStart.enemies[0].nextAttackAt<ordinary.enemies[0].nextAttackAt);
  const injured=nativeSnapshot('sword',75,4);injured.hp=Math.floor(injured.maxHp/2);injured.mp=0;
  const spring=forcedEncounter(make({mapId:'laurel_survey',snapshot:injured}),'spring');
  const springStart=advanceAtlasRun(spring,START+spring.map.entrySeconds).state;
  assert.ok(springStart.hero.hp>injured.hp);assert.ok(springStart.metrics.mpRestored>0);
  assert.equal(springStart.supplies.hpUsed,0);
  const treasure=finish(forcedEncounter(base(),'treasure')),plain=finish(normal);
  assert.ok(treasure.state.totals.gold>plain.state.totals.gold);
  assert.ok(treasure.state.totals.materials.atlas_shard>plain.state.totals.materials.atlas_shard);
  assert.equal(count(treasure.activities,'encounter'),1);
  assert.equal(treasure.activities.find(row=>row.kind==='encounter').tag,'treasure');
  assert.equal(treasure.state.metrics.encountersCompleted,1);
});

test('a failed encountered room grants neither the success activity nor its treasure',()=>{
  const snapshot=nativeSnapshot('thief',75,4);snapshot.hp=1;
  const run=forcedEncounter(make({buildId:'thief_poison',snapshot,supplies:{hp:0,mp:0}}),'treasure');
  const result=finish(run);
  assert.equal(result.state.status,'dead');assert.equal(result.state.metrics.encountersSeen,1);
  assert.equal(result.state.metrics.encountersCompleted,0);assert.equal(count(result.activities,'encounter'),0);
  assert.deepEqual(result.rewards,[]);
  assert.equal(result.state.metrics.survivalSeconds,result.state.elapsedSeconds-1);
  assert.equal(count(result.activities,'survival'),result.state.metrics.survivalSeconds);
});

test('equipment and normal scroll drops are capped by earned time, fixed to the map tier and represented exactly in receipts',()=>{
  const snapshot=nativeSnapshot('mage',120,15,'A111');
  const run=make({mapId:'laurel_intro',buildId:'mage_chain',snapshot,durationSeconds:28800,seed:'loot-eight-hours'});
  const result=finish(run,START+10*365*86400);
  const gear=result.rewards.flatMap(row=>row.equipment||[]);
  const scrolls=result.rewards.reduce((n,row)=>n+Object.values(row.items||{}).reduce((a,b)=>a+b,0),0);
  assert.ok(gear.length>0&&gear.length<=48);assert.ok(scrolls>0&&scrolls<=96);
  assert.equal(result.state.totals.equipment,gear.length);assert.equal(count(result.activities,'loot_equipment'),gear.length);
  assert.equal(count(result.activities,'loot_scroll'),scrolls);
  assert.equal(Object.values(result.state.totals.items).reduce((a,b)=>a+b,0),scrolls);
  assert.equal(new Set(gear.map(item=>item.id)).size,gear.length);
  let earnedGear=0,earnedScrolls=0;
  for(const reward of result.rewards) {
    earnedGear+=reward.equipment.length;earnedScrolls+=Object.values(reward.items).reduce((a,b)=>a+b,0);
    assert.ok(earnedGear<=Math.floor(reward.elapsedSeconds/600));
    assert.ok(earnedScrolls<=Math.floor(reward.elapsedSeconds/300));
    for(const item of reward.equipment) {
      assert.equal(item.tier,1);assert.equal(item.baseClass,'mage');assert.equal(item.classPath,'A111');
      assert.equal(item.source,'atlas');assert.equal(item.rulesVersion,'atlas-loot-v1');
      assert.ok(Number.isInteger(item.seed)&&item.seed>=0&&item.seed<=0xffffffff);
      assert.ok(['common','advanced'].includes(item.rarityFloor));
    }
    assert.ok(Object.keys(reward.items).every(key=>['scroll_w','scroll_a'].includes(key)));
  }
  assert.deepEqual(advanceAtlasRun(result.state,START+20*365*86400).rewards,[]);
});

test('survey loot tiers use the dispatched map rather than a high-level character tier',()=>{
  const snapshot=nativeSnapshot('mage',120,15);
  for(const[mapId,tier]of [['laurel_survey',2],['pillar_survey',5],['grove_survey',8]]) {
    const result=finish(make({mapId,buildId:'mage_chain',snapshot,durationSeconds:1800,seed:'tier-'+mapId}));
    const gear=result.rewards.flatMap(row=>row.equipment);
    assert.ok(gear.length>0,mapId);assert.ok(gear.every(item=>item.tier===tier),mapId);
  }
});

test('item streams cannot alter combat, material RNG or each other',()=>{
  const original=make({mapId:'laurel_intro',buildId:'mage_chain',snapshot:nativeSnapshot('mage',120,15),seed:'independent-streams'});
  const noGear=structuredClone(original);noGear.map.loot.roomEquipmentChance=0;noGear.map.loot.completionEquipmentChance=0;
  noGear.map.encounters.pool.forEach(row=>row.equipmentChanceBonus=0);
  const yes=finish(original),no=finish(noGear);
  assert.ok(yes.state.totals.equipment>0);assert.equal(no.state.totals.equipment,0);
  for(const key of ['combatRng','encounterRng','lootRng','metrics','hero','enemies','supplies'])assert.deepEqual(yes.state[key],no.state[key],key);
  assert.deepEqual(yes.state.totals.materials,no.state.totals.materials);assert.equal(yes.state.totals.gold,no.state.totals.gold);
  assert.equal(yes.state.content.rng.encounter,no.state.content.rng.encounter);
  assert.equal(yes.state.content.rng.scroll,no.state.content.rng.scroll);
  assert.deepEqual(yes.rewards.map(row=>({id:row.id,items:row.items})),no.rewards.map(row=>({id:row.id,items:row.items})));
});

test('restarting short runs does not reset a free first equipment or scroll allowance',()=>{
  for(let i=0;i<3;i++) {
    const result=finish(make({runId:'short-'+i,mapId:'laurel_intro',buildId:'mage_chain',
      snapshot:nativeSnapshot('mage',120,15),durationSeconds:299,seed:'short-'+i}));
    assert.equal(result.state.totals.equipment,0);assert.deepEqual(result.state.totals.items,{});
    assert.equal(count(result.activities,'loot_equipment'),0);assert.equal(count(result.activities,'loot_scroll'),0);
  }
});

test('safe completion requires zero life damage across the whole map, even when healing restored health',()=>{
  const calm=make({mapId:'laurel_intro',buildId:'mage_chain',snapshot:nativeSnapshot('mage',120,15),queueMode:'count',mapCount:1});
  calm.map.encounters.chance=0;
  const safe=finish(calm);
  assert.equal(safe.state.metrics.damageTaken,0);assert.equal(count(safe.activities,'safe_completion'),1);
  const danger=make({mapId:'laurel_survey',snapshot:nativeSnapshot('sword',20,4),queueMode:'count',mapCount:1,seed:'native-sample-laurel_survey-sword'});
  const hurt=finish(danger);
  assert.equal(hurt.state.status,'completed');assert.ok(hurt.state.metrics.damageTaken>0);
  assert.equal(count(hurt.activities,'completion'),1);assert.equal(count(hurt.activities,'safe_completion'),0);
});

test('survival receipts split at Taipei midnight and Monday boundary with identical arbitrary catch-up partitions',()=>{
  const start=Date.parse('2026-11-08T15:59:30.000Z')/1000;
  const run=make({mapId:'laurel_intro',buildId:'mage_chain',snapshot:nativeSnapshot('mage',120,15),startAt:start,durationSeconds:125});
  const all=finish(run),survival=all.activities.filter(row=>row.kind==='survival');
  assert.deepEqual(survival.map(row=>row.quantity),[30,60,35]);
  assert.deepEqual(survival.map(row=>new Date(row.occurredAt).toISOString()),[
    '2026-11-08T15:59:59.000Z','2026-11-08T16:00:59.000Z','2026-11-08T16:01:34.000Z',
  ]);
  let state=run;const activities=[],rewards=[];
  for(const elapsed of [1,29,30,31,59,60,89,90,124,125]) {
    const part=finish(JSON.parse(JSON.stringify(state)),start+elapsed,7);
    state=part.state;activities.push(...part.activities);rewards.push(...part.rewards);
  }
  assert.deepEqual({state,rewards,activities},all);assert.equal(count(activities,'survival'),125);
  const days={};for(const row of survival){const day=new Date(row.occurredAt+8*3600000).toISOString().slice(0,10);days[day]=(days[day]||0)+row.quantity;}
  assert.deepEqual(days,{'2026-11-08':30,'2026-11-09':95});
});

test('only terminal stop finalization flushes pending survival seconds and it is idempotent',()=>{
  const run=make({mapId:'laurel_intro',buildId:'mage_chain',snapshot:nativeSnapshot('mage',120,15)});
  const part=advanceAtlasRun(run,START+95);assert.equal(count(part.activities,'survival'),60);
  const untouched=JSON.stringify(part);finalizeAtlasActivities(part.state,part.activities);assert.equal(JSON.stringify(part),untouched);
  part.state.status='stopped';part.state.stopReason='player_stopped';part.state.endedAt=START+95;
  finalizeAtlasActivities(part.state,part.activities);assert.equal(count(part.activities,'survival'),95);
  const tail=part.activities.filter(row=>row.kind==='survival').at(-1);assert.equal(tail.quantity,35);assert.equal(tail.occurredAt,(START+94)*1000);
  const once=JSON.stringify(part);finalizeAtlasActivities(part.state,part.activities);assert.equal(JSON.stringify(part),once);
  assert.deepEqual(advanceAtlasRun(part.state,START+999).activities,[]);
});

test('very fast v4 catch-up yields before the 4096-activity persistence bound without losing time or receipts',()=>{
  const run=make({mapId:'grove_survey',buildId:'mage_chain',snapshot:nativeSnapshot('mage',120,15),durationSeconds:2400,
    profile:{travelMultiplier:.05,enemyHpMultiplier:.05,enemyDefenseMultiplier:.05}});
  // Exercise supported timing extremes; damage still comes from actual +15 gear.
  run.snapshot.attackSpeedMultiplier=4;run.skill.cooldown=.25;
  const ambush=run.map.encounters.pool.find(row=>row.id==='ambush');
  run.map.encounters={chance:1,maxPerMap:2,pool:[{...ambush,weight:1}]};
  const first=advanceAtlasRun(run,START+2400,{maxSteps:2000});
  assert.ok(first.activities.length<=4096);assert.ok(first.steps<2000);assert.equal(first.stillCatchingUp,true);
  const rest=finish(first.state,START+2400,2000),small=finish(run,START+2400,73);
  assert.deepEqual({state:rest.state,rewards:[...first.rewards,...rest.rewards],activities:[...first.activities,...rest.activities]},small);
});
