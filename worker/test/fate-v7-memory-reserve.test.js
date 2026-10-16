import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {V7_MEMORY_RESERVE,eligibleV7MemoryReserve,memoryReserveInventory} from '../public/fate/v7-memory-reserve.js';
import {LEGACY_MEMORIES} from '../public/fate/formal-ambient-v4.js';
import {NEW_MEMORIES} from '../public/fate/formal-catalog-v4.js';
import {FURTHER_MEMORIES} from '../public/fate/formal-days-v4.js';
import {V5_MEMORIES} from '../public/fate/formal-days-v5.js';

const sources=new Map(LEGACY_MEMORIES.map(row=>['v4-'+row.id,row]));
for(const [prefix,groups] of [['v4-new-',NEW_MEMORIES],['v4-day-',FURTHER_MEMORIES],['v5-day-',V5_MEMORIES]])
 for(const [phase,texts]of Object.entries(groups))texts.forEach((text,index)=>sources.set(prefix+phase+'-'+index,{phase,text}));

test('reserve preserves every reviewed original ID, phase and complete authored text',()=>{
 assert.equal(sources.size,804);
 assert.equal(V7_MEMORY_RESERVE.length,397);
 assert.equal(new Set(V7_MEMORY_RESERVE.map(row=>row.id)).size,397);
 assert.equal(new Set(V7_MEMORY_RESERVE.map(row=>row.text)).size,397);
 for(const row of V7_MEMORY_RESERVE){const original=sources.get(row.id);assert.ok(original,row.id);assert.equal(row.text,original.text);assert.equal(row.phase,original.phase);}
});

test('published pool and metadata cannot be changed by a caller',()=>{
 assert.ok(Object.isFrozen(V7_MEMORY_RESERVE));
 const row=V7_MEMORY_RESERVE[0];assert.ok(Object.isFrozen(row));assert.ok(Object.isFrozen(row.requiresAll));assert.ok(Object.isFrozen(row.requiresAny));
 assert.throws(()=>{row.text='rewritten';},TypeError);
 const returned=eligibleV7MemoryReserve(8);returned.pop();assert.equal(V7_MEMORY_RESERVE.length,397);
 const inventory=memoryReserveInventory();inventory.byPhase.child=0;assert.equal(memoryReserveInventory().byPhase.child,75);
});

test('age windows are disjoint and conservatively keep adult prose out of childhood',()=>{
 assert.deepEqual(eligibleV7MemoryReserve(5.999),[]);assert.deepEqual(eligibleV7MemoryReserve(14),[]);
 for(const [age,phase]of [[6,'child'],[12.99,'child'],[18,'youth'],[23.99,'youth'],[24,'adult'],[40,'middle'],[56,'late'],[74,'elder'],[104.99,'elder']]){
  const rows=eligibleV7MemoryReserve(age,{trustedPeer:true});assert.ok(rows.length);assert.ok(rows.every(row=>row.phase===phase));
 }
 assert.deepEqual(eligibleV7MemoryReserve(105),[]);assert.deepEqual(eligibleV7MemoryReserve(NaN),[]);assert.deepEqual(eligibleV7MemoryReserve(45,null),[]);
});

test('friendship memories require an actual true peer flag without inferred career gates',()=>{
 for(const row of V7_MEMORY_RESERVE){assert.deepEqual(row.requiresAny,[]);assert.ok(row.requiresAll.every(flag=>flag==='trustedPeer'));}
 const friend=V7_MEMORY_RESERVE.find(row=>row.id==='v4-youth-04');assert.ok(friend);
 for(const state of [{},{trustedPeer:false},{trustedPeer:1},{workActive:true,mentorActive:true}])assert.ok(!eligibleV7MemoryReserve(20,state).some(row=>row.id===friend.id));
 assert.ok(eligibleV7MemoryReserve(20,{trustedPeer:true}).some(row=>row.id===friend.id));
 for(const age of [8,20,30,45,65,85])assert.ok(eligibleV7MemoryReserve(age).every(row=>row.requiresAll.length===0));
});

test('unsupported major biographies are excluded even when unrelated flags are true',()=>{
 const rejected=['v4-youth-08','v4-adult-01','v4-adult-05','v4-new-adult-1','v4-new-middle-9','v4-day-late-18','v5-day-middle-44','v5-day-late-35','v4-elder-05'];
 for(const id of rejected){assert.ok(sources.has(id));assert.ok(!V7_MEMORY_RESERVE.some(row=>row.id===id),id);}
 // Guard explicit high-risk domains as well as the manually checked source IDs.
 for(const row of V7_MEMORY_RESERVE)assert.doesNotMatch(row.text,/精靈|矮人|魔法|咒文|記憶水晶|留聲石|雲羊|龍蛋|結婚|伴侶|妻子|丈夫|生下|懷孕|女兒|兒子|你的孩子|孫子|教師證|執照|畢業|臺灣|印度|工錢|酬勞|職業|同事|學徒|教學/);
});

test('pool replay depends only on age and actual flags, never private recent-life history',()=>{
 const state={trustedPeer:true},before=eligibleV7MemoryReserve(45,state).map(row=>row.id);
 const withPrivateHistory={...state,recentEventIds:before.slice(0,10),priorLifeId:'private'};
 assert.deepEqual(eligibleV7MemoryReserve(45,withPrivateHistory).map(row=>row.id),before);
 const source=readFileSync(new URL('../public/fate/v7-memory-reserve.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/fetch\s*\(|Math\.random|Date\.now|localStorage|sessionStorage|state\.recentEventIds/);
});

test('inventory counts unique prose honestly and states the coverage limit',()=>{
 const inventory=memoryReserveInventory();assert.equal(inventory.reviewedSourceRows-inventory.excludedAfterReview-inventory.duplicateSourceIds.length,397);
 assert.deepEqual(inventory.byPhase,{child:75,youth:47,adult:48,middle:58,late:74,elder:95});
 assert.equal(inventory.conditional,58);assert.equal(inventory.noCondition,339);
 assert.equal(Object.values(inventory.sources).reduce((a,b)=>a+b,0),397);
 assert.match(inventory.limits,/not researched country localization/);assert.match(inventory.limits,/No cross-life overlap target/);
});
