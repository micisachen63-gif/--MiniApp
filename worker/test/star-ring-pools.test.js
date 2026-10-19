import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as E from '../src/game/star-ring.js';
import {POOL_MONSTERS,encounterSchedule,selectEncounter} from '../src/game/star-ring-pools.js';
import {mkChar,T0} from './helpers.js';
function state(tier=90,version=2,seed='pool-test',tactic='balanced'){
 const actors=['sword:B2','mage:A1','thief:A1','archer:B1','sword:A1'].map((spec,i)=>{const[base_class,class_path]=spec.split(':');return E.snapshot({char:mkChar({tg_id:String(i+1),base_class,class_path:tier>=90?class_path:class_path[0],level:tier}),equipment:[]});});
 return {id:'golden-v1',engineVersion:version,tier,tactic,difficulty:'normal',seed,startedAt:T0,endsAt:T0+E.DURATION,actors,results:[],stageTactics:[tactic],departed:{}};
}
test('published v1 full twelve-hour snapshots remain byte-for-byte identical at low, high and final tiers',()=>{
 const cases=JSON.parse(readFileSync(new URL('star-ring-v1-golden.json',import.meta.url)));
 for(const c of cases){const s=state(c.tier,1,`legacy-${c.tier}-${c.tactic}`,c.tactic);for(let i=0;i<6;i++){const r=E.simulateStage(s,i);assert.equal(createHash('sha256').update(JSON.stringify(r)).digest('hex'),c.hash[i],`${c.tier}/${c.tactic}/${i}`);s.results.push(r);}}
});
test('twelve exclusive four-species pools contain two normals, an elite and the original map boss',()=>{
 assert.equal(POOL_MONSTERS.length,36);const ids=new Set();for(let h=0;h<12;h++){const p=E.encounterPool(h);assert.deepEqual(p.map(x=>x.rank),['normal','normal','elite','boss']);assert.equal(p[3].enemyId,E.HOURLY_ENCOUNTERS[h].enemyId);for(const m of p){assert.ok(!ids.has(m.enemyId));ids.add(m.enemyId);assert.ok(m.spell&&m.behavior&&m.mechanic);}}assert.equal(ids.size,48);
});
test('independent encounter seeds vary first species, elite/boss timings and subsequent order without adjacent identical species',()=>{
 const schedules=new Set(),orders=new Set(),first=new Set();for(let n=0;n<32;n++){const s=state(90,2,`expedition-${n}`),seen={elite:false,boss:false},seq=[];let prev=null;const schedule=encounterSchedule(s.seed,0);schedules.add(JSON.stringify(schedule));for(let w=0;w<24;w++){const e=selectEncounter(s,0,w,seen,0,E.HOURLY_ENCOUNTERS,prev);assert.notEqual(e.enemyId,prev);seq.push(e.enemyId);if(e.rank!=='normal')seen[e.rank]=true;prev=e.enemyId;}first.add(seq[0]);orders.add(seq.join(','));assert.ok(seen.elite&&seen.boss);}assert.equal(first.size,2);assert.ok(schedules.size>28);assert.ok(orders.size>25);
});
test('projection and complete replay see the same real species, stats and actions; previewing next wave never mutates a snapshot',()=>{
 const s=state(),saved=JSON.stringify(s),full=E.simulateStage(s,0);assert.equal(JSON.stringify(s),saved);assert.equal(full.encounters.length,2);
 for(const e of full.encounters){const ranks=new Set(e.enemies.map(x=>x.rank));assert.ok(ranks.has('normal')&&ranks.has('elite')&&ranks.has('boss'));assert.ok(e.enemies.every(x=>x.hourIndex===e.hourIndex));}
 let found=false;for(let beat=1;beat<120;beat++){const b=E.simulateStage(s,0,beat);if(b.enemy.hp===0){found=true;const old=JSON.stringify(b),next=E.nextWaveEnemy(s,b),actual=E.simulateStage(s,0,beat+1);assert.equal(JSON.stringify(b),old);assert.equal(next.id,actual.enemy.id);assert.equal(next.maxHp,actual.enemy.maxHp);assert.ok(next.hp>0);break;}}assert.ok(found);
 assert.ok(full.sightings.some(x=>x.rank==='boss'));assert.equal(full.expHours>=3&&full.expHours<=4,true);
});
test('low damage parties still encounter an elite and boss via seeded time windows, and old runs do not enter a pool',()=>{
 const s=state();s.actors=s.actors.map(a=>({...a,atk:1,departureAtk:1}));const b=E.simulateStage(s,0,120);const seen=b.encounters[0].enemies;assert.ok(seen.some(x=>x.rank==='elite'));assert.ok(seen.some(x=>x.rank==='boss'));const elite=seen.find(x=>x.rank==='elite'),boss=seen.find(x=>x.rank==='boss');assert.ok(elite.at<boss.at);assert.ok(boss.at<T0+E.HOUR_MS);
 const old=E.simulateStage({...s,engineVersion:1},0,100);assert.equal(old.enemy.id,'star_ring_scorpion');assert.equal(old.sightings,undefined);assert.equal(old.enemy.rank,undefined);
});
test('full v2 twelve-hour settlement remains bounded and preserves the six checkpoints and reward caps',()=>{
 const s=state(40),start=performance.now();for(let i=0;i<6;i++){const r=E.simulateStage(s,i);s.results.push(r);assert.equal(r.encounters.length,2);assert.equal(r.encounters.reduce((n,x)=>n+x.waves,0),r.waves);assert.ok(r.expHours>=3&&r.expHours<=4);}assert.ok(performance.now()-start<5000);const all=s.results.flatMap(r=>r.sightings);assert.equal(new Set(all.map(e=>e.hourIndex)).size,12);assert.equal(new Set(all.filter(e=>e.rank==='boss').map(e=>e.id)).size,12);
 const rewards=s.results.map((r,i)=>E.stageReward(s,s.actors[0],i,r));assert.equal(rewards.length,6);assert.ok(rewards.reduce((n,r)=>n+r.expHours,0)<=24);assert.ok(rewards.at(-1).items.star_ring_token<=11);
});

test('every next-wave preview agrees with the subsequent actual spawn, including the final combat beat before an hourly transition',()=>{
 const s=state(90,2,'all-wave-boundaries');s.actors=s.actors.map(a=>({...a,atk:1e7,departureAtk:1e7}));
 for(let beat=1;beat<240;beat++){const b=E.simulateStage(s,0,beat);if(b.enemy.hp>0)continue;const shown=E.nextWaveEnemy(s,b),next=E.simulateStage(s,0,beat+1);const actual=next.sightings.find(x=>x.at===T0+beat*E.BEAT_MS);assert.ok(actual,`spawn at beat ${beat}`);assert.equal(shown.id,actual.id,`next species at beat ${beat}`);}
});
