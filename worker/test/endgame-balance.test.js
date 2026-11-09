import test from 'node:test';import assert from 'node:assert/strict';
import {ATLAS_BUILDS,getAtlasMap} from '../src/game/atlas-catalog.js';
import {computeStats,itemStat} from '../src/game/stats.js';
import {makeGear} from '../src/game/gear.js';
import {WORLD_MODES,stampMode} from '../src/game/endgame.js';
import {SLOTS,GENERAL_WEAPON} from '../src/game/constants.js';
import {benchmarkAtlasRun} from '../src/game/atlas-balance.js';
import {createAtlasRun,advanceAtlasRun} from '../src/game/atlas-engine.js';

function loadout(build,mode,chapter,invested=false,weak=false){
 const level=mode.minLevel+(chapter-1)*10+4,character={base_class:build.baseClass,class_path:'A111',level},equipment=[];
 for(const slot of SLOTS)for(let pos=1;pos<=(['ring','earring'].includes(slot)?2:1);pos++){
  const item=makeGear({id:slot+pos,tgId:'calibration',cls:build.baseClass,slot,kind:GENERAL_WEAPON[build.baseClass],tier:weak?12:chapter,forceRarity:weak?'common':invested?'legendary':'epic',source:'shop',mode:weak?'normal':mode.id,rng:()=>.5,now:1});item.enhance_level=weak?0:invested?7:4;item.is_equipped=pos;equipment.push(item);
 }
 return {snapshot:{...computeStats(character,equipment),characterId:'calibration',baseClass:build.baseClass},equipment};
}
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const samples=[];
for(const mode of WORLD_MODES.slice(1))for(const cls of ['sword','archer','mage','thief'])test(`${mode.id}/${cls}: native gear, three builds and seed samples remain viable; upgrades improve pace`,()=>{
 const ordinary=[],upgraded=[];let net=0;
 for(const build of ATLAS_BUILDS.filter(b=>b.baseClass===cls))for(const chapter of [1,5,6,12])for(const seed of ['risk-a','risk-b','risk-c'])for(const invested of [false,true]){
  const {snapshot}=loadout(build,mode,chapter,invested),input={runId:'calibration',realmId:'benchmark',startedAt:0,seed,mapId:`cycle_${mode.id}_${String(chapter).padStart(2,'0')}`,buildId:build.id,supports:build.recommendedSupports,automation:build.recommendedAutomation,durationSeconds:1800,mapCount:1,snapshot,supplies:{items:{red_4:100,blue_4:100},policy:{hpPreference:'red_4',mpPreference:'blue_4',hpThresholdPct:60,mpThresholdPct:60,autoBlue:true}}};
  const {summary,state}=benchmarkAtlasRun(input);assert.equal(summary.status,'completed',`${build.id}/${chapter}/${seed}/${invested}`);assert.ok(summary.elapsedSeconds<600,'appropriate gear cannot hide a half-hour stall');assert.ok(state.awakening.casts>0);assert.ok(summary.supplyGoldSpent>=0);if(!invested){ordinary.push(summary.elapsedSeconds);net+=summary.netGold;}else upgraded.push(summary.elapsedSeconds);
 }
 assert.ok(net>0,'the sampled farming loop pays for its actual itemized potion use');assert.ok(median(upgraded)<=median(ordinary)*1.1,'upgrading cannot systematically make the same sample slower');samples.push({mode:mode.id,cls,seconds:median(ordinary)});
});

test('all four mature class samples stay within a bounded clear-time range instead of the old twofold gap',()=>{
 for(const mode of WORLD_MODES.slice(1)){const xs=samples.filter(s=>s.mode===mode.id).map(s=>s.seconds);assert.equal(xs.length,4);assert.ok(Math.max(...xs)/Math.min(...xs)<1.6,mode.id);}
});

test('fresh later-cycle T1 has a carried foundation while existing saved gear and enhancement values remain exact',()=>{
 for(const mode of WORLD_MODES.slice(1))for(const cls of ['sword','archer','mage','thief']){
  const base=makeGear({id:'unmodified',tgId:'calibration',cls,slot:'weapon',kind:GENERAL_WEAPON[cls],tier:1,forceRarity:'epic',source:'shop',rng:()=>.5,now:1}),before=JSON.stringify(base),next=stampMode(base,mode.id);
  assert.equal(JSON.stringify(base),before);assert.equal(next.enhance_level,0);assert.ok(itemStat(next,cls).main>itemStat(base,cls).main*10);assert.equal(JSON.parse(next.bonus_json).endgameOrigin.balanceVersion,2);
 }
});

test('frozen pre-calibration gear generation keeps exact legacy mode rolls and metadata',()=>{
 const common={id:'frozen',tgId:'calibration',cls:'mage',slot:'weapon',kind:GENERAL_WEAPON.mage,tier:1,forceRarity:'epic',source:'atlas',rng:()=>.5,now:1};
 const normal=makeGear(common),old=makeGear({...common,mode:'hell',modeBalanceVersion:1}),current=makeGear({...common,mode:'hell'});
 assert.equal(old.base_stat,Math.round(normal.base_stat*8.5));assert.equal(old.element_stat,Math.round(normal.element_stat*8.5));assert.deepEqual(JSON.parse(old.bonus_json).endgameOrigin,{version:'endgame-v1',mode:'hell'});assert.ok(current.base_stat>old.base_stat*10);
});

test('a late boss is not a guaranteed clear with unupgraded original-cycle gear and no supplies',()=>{
 for(const cls of ['sword','archer','mage','thief']){
  const build=ATLAS_BUILDS.find(b=>b.baseClass===cls),{snapshot}=loadout(build,WORLD_MODES[4],12,false,true),{summary}=benchmarkAtlasRun({runId:'undergeared',realmId:'benchmark',startedAt:0,seed:'risk',mapId:'cycle_hell_12',buildId:build.id,supports:build.recommendedSupports,automation:build.recommendedAutomation,durationSeconds:1800,mapCount:1,snapshot,supplies:{hp:0,mp:0}});
  assert.equal(summary.status,'dead',cls);
 }
});

test('new balance never re-resolves an existing saved map or loses offline determinism',()=>{
 const build=ATLAS_BUILDS.find(b=>b.id==='mage_arcane'),{snapshot}=loadout(build,WORLD_MODES[4],12),run=createAtlasRun({runId:'frozen-cycle',realmId:'benchmark',startedAt:0,seed:'same',mapId:'cycle_hell_12',buildId:build.id,supports:build.recommendedSupports,automation:build.recommendedAutomation,durationSeconds:300,mapCount:2,snapshot,supplies:{hp:100,mp:100}});
 run.map.progression.balanceVersion=1;run.map.enemy.hp=777777;run.map.elite.hp=888888;const original=JSON.stringify(run.map),whole=advanceAtlasRun(run,300).state;let split=run;for(const at of [10,47,83,150,231,300])split=advanceAtlasRun(JSON.parse(JSON.stringify(split)),at).state;assert.deepEqual(split,whole);assert.equal(JSON.stringify(whole.map),original);assert.notEqual(getAtlasMap('cycle_hell_12').elite.hp,888888);
});

test('all twelve late-game build keystones change real combat without invalidating their viable native loadout',()=>{
 for(const build of ATLAS_BUILDS){
  const {snapshot}=loadout(build,WORLD_MODES[4],6),base={runId:'keystone',realmId:'benchmark',startedAt:0,seed:'native-talent',mapId:'cycle_hell_06',buildId:build.id,supports:build.recommendedSupports,automation:build.recommendedAutomation,durationSeconds:1800,mapCount:1,snapshot,supplies:{hp:100,mp:100}},plain=benchmarkAtlasRun(base),talented=benchmarkAtlasRun({...base,talentIds:Array.from({length:10},(_,i)=>build.id+'_'+(i+1))});
  assert.equal(talented.summary.status,'completed',build.id);assert.equal(talented.state.talentSnapshot.spent,10);assert.notDeepEqual(talented.state.snapshot,plain.state.snapshot);assert.ok(talented.state.metrics.damage>0);assert.ok(talented.state.awakening.casts>0);
 }
});
