import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeTiming,ageAtActive,narrativeTickAt,activeAtVirtualAge} from '../public/fate/timing-v5.js';
import {createLife,validLife,advanceLife,chooseLife,lifeSchedule,lifeAge,activeBetween,addActive,LIFE_MS,CHOICE_MS} from '../public/fate/life.js';
import {encodeResult,decodeResult} from '../public/fate/model.js';
import {formalEvents,formalScenes,plannedContent,narrativeProfile,contentInventory} from '../public/fate/formal-events.js';
import {V5_MEMORIES} from '../public/fate/formal-days-v5.js';
import {V5_CAREERS,V5_THREADS,V5_OBJECTS} from '../public/fate/formal-catalog-v5.js';
import {narrativeEvents} from '../public/fate/event-catalog-v1.js';
import {endingForLife} from '../public/fate/ending-story.js';
import {scenesFor,seedForNextLife,readSoul} from '../public/fate/cycles.js';
import {worldYear,almanac,hash} from '../public/fate/world.js';
const at=s=>Date.parse(s+'+08:00'),START=at('2026-10-16T09:00:00');
const seed=n=>hash('fate-clock-audit-'+n).toString(16).padStart(8,'0');
const life=(n=0,extra={})=>createLife({version:5,orbit:3,seed:seed(n),startedAt:START,...extra});
const complete=d=>advanceLife(d,addActive(d.startedAt,LIFE_MS));

test('v5 profile reopens identically from persisted version and seed, ignoring client timing or death fields',()=>{
 const d=life(),profile=lifeTiming(d),reopened=validLife(JSON.parse(JSON.stringify({...d,deathAge:3,choiceOffsets:[0,1,2],eventOffsets:[0,2]})));
 assert.deepEqual(lifeTiming(reopened),profile);assert.equal('deathAge' in reopened,false);assert.equal('choiceOffsets' in reopened,false);
 assert.throws(()=>{profile.eventOffsets[1]=2});assert.throws(()=>{profile.deathAge=3});
 assert.equal(lifeTiming({...d,version:4}),null);assert.equal(lifeTiming({...d,seed:'invalid'}),null);
});

test('a thousand seed profiles keep exactly two hours with 18–43s varied intervals, varied life spans and three adult choices',()=>{
 const deaths=new Set(),firstIntervals=new Set(),schedules=new Set();let shorter=0;
 for(let i=0;i<1024;i++){
  const d=life(i),p=lifeTiming(d);deaths.add(p.deathAge);if(p.deathAge<65)shorter++;
  assert.ok(p.deathAge>=55&&p.deathAge<=104);assert.equal(p.eventOffsets.length,241);assert.equal(p.eventOffsets[0],0);assert.equal(p.eventOffsets.at(-1),LIFE_MS);
  p.eventOffsets.slice(1).forEach((at,i)=>assert.ok(Number.isInteger(at)&&at-p.eventOffsets[i]>=18000&&at-p.eventOffsets[i]<=43000));
  assert.ok(p.choiceAges[0]>=17);assert.ok(p.choiceAges[1]>p.choiceAges[0]);assert.ok(p.choiceAges[2]>p.choiceAges[1]);assert.ok(p.choiceAges[2]<=p.deathAge-5);
  p.choiceOffsets.forEach((offset,j)=>{assert.equal(Math.floor(ageAtActive(d,offset)),p.choiceAges[j]);assert.ok(offset+CHOICE_MS<LIFE_MS);if(j)assert.ok(offset>p.choiceOffsets[j-1]+CHOICE_MS);});
  firstIntervals.add(p.eventOffsets[1]);schedules.add(p.choiceOffsets.join(','));
 }
 assert.ok(deaths.size>=35);assert.ok(Math.min(...deaths)<65);assert.ok(Math.max(...deaths)>100);assert.ok(shorter>0&&shorter<1024*.1);assert.ok(firstIntervals.size>100);assert.ok(schedules.size>100);
});

test('f5 public codes reproduce the exact completed life and source bits without birth, timing arrays or social participants',()=>{
 for(let bits=0;bits<8;bits++)for(let sources=0;sources<8;sources++){
  const d=life(bits),code=encodeResult({...d,answers:[bits>>2&1,bits>>1&1,bits&1],auto:[sources>>2&1,sources>>1&1,sources&1],birthDate:'1990-01-01',deathAge:2,accountId:'101'}),r=decodeResult(code);
  assert.equal(code.length,18);assert.equal(r.version,5);assert.equal(r.deathAge,lifeTiming(d).deathAge);assert.equal(encodeResult(r),code);assert.equal(r.ending.worldYear,worldYear(d.seed,r.deathAge));
  assert.ok(!/1990|accountId|choiceOffsets|eventOffsets/.test(JSON.stringify(r)));assert.deepEqual(decodeResult(code),r);
 }
 for(const code of ['f6b101101xdeadbeef','f5b101xdeadbeef','f5c101101xdeadbeef'])assert.equal(decodeResult(code),null);
});

test('legacy v3/v4 life schedules, fixed ages and thirty-second records remain unchanged',()=>{
 for(const version of [3,4]){
  const d=createLife({version,orbit:3,seed:'deadbeef',startedAt:START}),end=complete(d);
  assert.deepEqual(lifeSchedule(START,d),[1440000,3200000,5280000].map(ms=>START+ms));assert.equal(lifeAge(d,end.endAt),90);assert.deepEqual(scenesFor(d).map(s=>s.age),[18,40,66]);assert.equal(decodeResult(end.code).deathAge,undefined);
  if(version===4){const records=formalEvents(d,START+60000);assert.deepEqual(records.map(e=>e.age),[0,.375,.75]);assert.ok(records.every(e=>!('activeMs' in e)));}
 }
 assert.deepEqual(lifeSchedule(START),[START+1440000,START+3200000,START+5280000]);
});

test('seeded choice times preserve one-way manual decisions and the original ninety effective seconds',()=>{
 for(let n=0;n<16;n++){
  let d=life(n);const p=lifeTiming(d),slots=lifeSchedule(d.startedAt,d);assert.deepEqual(scenesFor(d).map(s=>s.age),p.choiceAges);
  for(let i=0;i<3;i++){
   assert.throws(()=>chooseLife(d,1,slots[i]-1,i));const chosen=chooseLife(d,i%2,slots[i]+CHOICE_MS-1,i);assert.equal(chosen.draft.sources[i],'manual');assert.equal(chosen.draft.answers[i],i%2);assert.throws(()=>chooseLife(d,1,slots[i]+CHOICE_MS,i));d=chosen.draft;
  }
  const end=complete(d);assert.deepEqual(end.draft.sources,['manual','manual','manual']);assert.equal(lifeAge(d,end.endAt),p.deathAge);assert.equal(advanceLife(end.draft,end.endAt+86400000).code,end.code);
 }
});

test('v5 seeded deadlines and displayed age pause across midnight, while completion still requires two active hours',()=>{
 const reference=life(),offset=lifeTiming(reference).choiceOffsets[0],start=at('2026-10-16T23:58:45')-offset,d=life(0,{startedAt:start}),slot=lifeSchedule(start,d)[0],deadline=addActive(slot,CHOICE_MS);
 assert.equal(slot,at('2026-10-16T23:58:45'));assert.equal(deadline,at('2026-10-17T06:00:15'));
 const midnight=at('2026-10-17T00:00:00'),night=at('2026-10-17T05:59:59');assert.equal(lifeAge(d,night),lifeAge(d,midnight));assert.equal(advanceLife(d,night).available,false);
 assert.throws(()=>chooseLife(d,1,night,0));assert.equal(chooseLife(d,1,deadline-1,0).draft.sources[0],'manual');assert.equal(advanceLife(d,deadline).draft.sources[0],'auto');
 const end=addActive(start,LIFE_MS);assert.equal(activeBetween(start,end),LIFE_MS);assert.equal(advanceLife(d,end-1).completed,false);assert.equal(advanceLife(d,end).completed,true);
 assert.deepEqual(formalEvents(d,midnight),formalEvents(d,night));
});

test('variable event boundaries are stable, have no future rows and agree with visible age and the world almanac',()=>{
 for(let n=0;n<16;n++){
  const d=complete(life(n)).draft,p=lifeTiming(d),full=plannedContent(d);assert.equal(full.length,241);assert.equal(full.at(-1).age,p.deathAge);assert.equal(new Set(full.map(e=>e.id)).size,241);assert.equal(new Set(full.map(e=>e.text)).size,241);
  for(const tick of [0,1,47,110,179,239,240]){
   const elapsed=p.eventOffsets[tick],rows=formalEvents(d,START+elapsed);assert.equal(rows.length,tick+1);assert.deepEqual(rows,full.slice(0,tick+1));assert.equal(narrativeTickAt(d,elapsed),tick);if(tick)assert.equal(formalEvents(d,START+elapsed-1).length,tick);
   assert.ok(rows.every(e=>e.activeMs<=elapsed&&e.worldYear===worldYear(d.seed,e.age)));assert.equal(Math.floor(rows.at(-1).age),lifeAge(d,START+elapsed));
  }
  for(const row of full.filter(e=>e.kind==='world'))assert.deepEqual(row.world,almanac(row.worldYear));
  assert.deepEqual(narrativeEvents(d,START+LIFE_MS),full);assert.equal(activeAtVirtualAge(d,90),LIFE_MS);
 }
});

test('manual answers do not rewrite memories before their seeded deadline or reveal future choices',()=>{
 const d=life(27),p=lifeTiming(d);
 for(let i=0;i<3;i++){
  const a={...d,answers:[1,0,1].slice(0,i),sources:Array(i).fill('manual')},b={...d,answers:[1,0,1].slice(0,i+1),sources:Array(i+1).fill('manual')},deadline=p.choiceOffsets[i]+CHOICE_MS;
  assert.deepEqual(formalEvents(a,START+deadline-1),formalEvents(b,START+deadline-1));const before=formalEvents(b,START+deadline-1),after=formalEvents(b,START+deadline+60000);assert.deepEqual(after.slice(0,before.length),before);
  assert.ok(after.some(e=>e.kind==='choice'&&e.choiceIndex===i));
 }
});

test('short and long lives retain full ordered career, commitment, legacy, relationship and object chains after the right decisions',()=>{
 for(let n=0;n<64;n++){
  const d=complete(life(n)).draft,p=lifeTiming(d),rows=plannedContent(d),profile=narrativeProfile(d),seen=new Set();
  assert.equal(rows.filter(e=>e.kind==='career').length,10);assert.equal(rows.filter(e=>e.kind==='commitment').length,6);assert.equal(rows.filter(e=>e.kind==='legacy').length,4);assert.equal(rows.filter(e=>e.kind==='relationship').length,24);assert.equal(rows.filter(e=>e.kind==='object').length,profile.objects.reduce((n,o)=>n+o.steps.length,0));
  for(const e of rows){if(e.requires)assert.ok(seen.has(e.requires),e.id+' missing '+e.requires);seen.add(e.id);if(e.kind==='choice')assert.ok(e.activeMs>=p.choiceOffsets[e.choiceIndex]+CHOICE_MS);if(['career','commitment','legacy'].includes(e.kind))assert.ok(e.activeMs>p.choiceOffsets[['career','commitment','legacy'].indexOf(e.kind)]+CHOICE_MS);}
 }
});

test('a live v5 ending stays unfinished after all answers until the two-hour clock ends, with no future lifespan disclosure',()=>{
 const d=life(9),p=lifeTiming(d),clock=START+p.choiceOffsets[2]+CHOICE_MS+1,live={...d,answers:[1,0,1],sources:['manual','manual','manual'],clockAt:clock},ending=endingForLife(live);
 assert.equal(ending.title,'尚未合上的旅誌');assert.ok(!ending.paragraphs.join('').includes(`在${p.deathAge}歲合上`));assert.ok(ending.stats.events<241);
 const completed=endingForLife(complete(live).draft);assert.ok(completed.paragraphs.at(-1).includes(`${p.deathAge}歲`));assert.equal(completed.worldYear,worldYear(d.seed,p.deathAge));
});

test('shared outcomes enter exactly at their fixed active deadline with the v5 actual age, including a night pause',()=>{
 const d=life(17,{startedAt:at('2026-10-16T23:30:00')}),deadline=addActive(d.startedAt,50*60000),shared={id:'shared-garden',at:deadline,ownerName:'甲旅人',guestName:'乙旅人',answer:1,source:'manual',text:'乙旅人選擇出發，將沿途的種子寄回花園。'},withMemory={...d,sharedMemories:[shared]};
 assert.equal(validLife(withMemory).sharedMemories.length,1);assert.equal(formalEvents(withMemory,deadline-1).some(e=>e.kind==='shared'),false);const row=formalEvents(withMemory,deadline).find(e=>e.kind==='shared');assert.ok(row);assert.equal(row.age,ageAtActive(d,50*60000));assert.equal(row.worldYear,worldYear(d.seed,row.age));assert.equal(row.activeMs,50*60000);
 const ended=complete(withMemory),publicResult=decodeResult(ended.code);assert.ok(!JSON.stringify(publicResult).includes('乙旅人'));assert.ok(!JSON.stringify(publicResult).includes('shared-garden'));
});

test('v5 soul records retain legitimate ages above ninety but reject an age beyond that life span',()=>{
 let d;for(let n=0;n<1024;n++)if(lifeTiming(life(n)).deathAge>=100){d=life(n);break;}assert.ok(d);const p=lifeTiming(d),code=complete(d).code;
 const record=readSoul({entries:[{code,at:START,memories:[{id:'late-memory',age:99,text:'你把多年以前的信重新收好。'},{id:'future-memory',age:p.deathAge+1,text:'尚未發生。'}]}],draft:d});assert.equal(record.draft.version,5);assert.deepEqual(record.entries[0].memories.map(m=>m.age),[99]);
});

test('v5 next-life selection avoids the previous three actual expanded scene identities while every stored seed replays itself',()=>{
 const entries=[],shelves=[];
 for(let n=0;n<5;n++){
  const s=seedForNextLife(seed(n),entries,5),result=decodeResult(encodeResult({...life(n),seed:s,answers:[1,0,1],auto:[0,1,0]})),scenes=formalScenes(result);
  for(const prior of entries.slice(-3).map(e=>formalScenes(decodeResult(e.code))))scenes.forEach((s,i)=>assert.notEqual(s.id,prior[i].id));assert.deepEqual(scenesFor(result),scenes);assert.deepEqual(decodeResult(result.code),result);
  const shelf=parseInt(s.slice(6),16)%4;assert.ok(!shelves.slice(-3).includes(shelf));shelves.push(shelf);entries.push({code:result.code});
 }
});

test('v5 inventory counts authored additions honestly and all expanded careers, people and objects are actually reachable',()=>{
 const old=contentInventory(),next=contentInventory({version:5}),newMemories=Object.values(V5_MEMORIES).flat(),newChains=[...V5_CAREERS,...V5_THREADS,...V5_OBJECTS].flatMap(x=>x.steps);
 assert.equal(newMemories.length,300);assert.ok(Object.values(V5_MEMORIES).every(rows=>rows.length===50));assert.equal(newChains.length,160);assert.equal(new Set([...newMemories,...newChains]).size,460);
 assert.equal(next.ambient-old.ambient,300);assert.equal(next.careerChapters-old.careerChapters,80);assert.equal(next.relationshipChapters-old.relationshipChapters,48);assert.equal(next.objectChapters-old.objectChapters,32);assert.equal(next.newAmbient,300);assert.equal(next.newChainChapters,160);
 const careers=new Set(),threads=new Set(),objects=new Set(),newActual=new Set();
 for(let n=0;n<256;n++){
  const d=complete(life(n)).draft,profile=narrativeProfile(d);careers.add(profile.career.id);profile.threads.forEach(t=>threads.add(t.id));profile.objects.forEach(o=>objects.add(o.id));
  for(const e of plannedContent(d))if(e.id.startsWith('v5-day-'))newActual.add(e.text);
 }
 assert.equal(careers.size,next.careers);assert.equal(threads.size,next.relationshipChains);assert.equal(objects.size,next.objects);assert.ok(newActual.size>=250,'new authored memories must be selected, not merely declared in a file');
});
