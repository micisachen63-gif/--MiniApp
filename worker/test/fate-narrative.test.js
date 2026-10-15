import test from 'node:test';
import assert from 'node:assert/strict';
import {formalEvents,plannedContent,formalScenes,narrativeProfile,contentInventory,EVENT_INTERVAL_MS,narrativeActiveBetween} from '../public/fate/formal-events.js';
import {endingForLife} from '../public/fate/ending-story.js';
import {almanac,worldYear,hash} from '../public/fate/world.js';
import {activeBetween,addActive,LIFE_MS} from '../public/fate/life.js';
import {seedForNextLife} from '../public/fate/cycles.js';
import {encodeResult} from '../public/fate/model.js';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const start=Date.parse('2026-10-16T02:00:00Z');
const life=(seed='deadbeef',answers=[0,1,0])=>({version:4,seed,orbit:11,answers,sources:answers.map(()=> 'manual'),startedAt:start,clockAt:start});
const seedAt=i=>hash('narrative-audit-'+i).toString(16).padStart(8,'0');

test('v4 supplies exactly one original memory per 30 active seconds through 90 years',()=>{
 const l=life();assert.equal(formalEvents(l,start).length,1);
 for(const tick of [1,2,47,48,51,110,179,239,240]){
  const events=formalEvents(l,start+tick*EVENT_INTERVAL_MS);
  assert.equal(events.length,tick+1);assert.equal(events.at(-1).age,tick*.375);
  assert.equal(new Set(events.map(e=>e.id)).size,events.length);
  assert.equal(new Set(events.map(e=>e.text)).size,events.length);
  assert.ok(events.every(e=>e.worldYear===worldYear(l.seed,e.age)));
 }
 assert.equal(formalEvents(l,start+LIFE_MS+999999).length,241);
 assert.deepEqual(formalEvents(l,start+LIFE_MS),plannedContent(l));
 assert.deepEqual(formalEvents({...l,version:3},start+LIFE_MS),[]);
});

test('independent narrative clock agrees across midnight, night pause and a multi-day return',()=>{
 const night=Date.parse('2026-10-16T15:00:00Z'),l={...life(),startedAt:night};
 const before=Date.parse('2026-10-16T16:00:00Z'),during=Date.parse('2026-10-16T20:00:00Z');
 assert.deepEqual(formalEvents(l,before),formalEvents(l,during));
 assert.equal(formalEvents(l,Date.parse('2026-10-16T23:00:00Z')).length,241);
 for(let i=0;i<40;i++){const a=night+i*771777,b=a+i*8123456;assert.equal(narrativeActiveBetween(a,b),activeBetween(a,b));}
 assert.equal(narrativeActiveBetween(start,start-1),0);
});

test('answer arrival cannot rewrite pre-deadline memories or expose future chapters',()=>{
 const a=life('cafebabe',[]),b=life('cafebabe',[1]),c=life('cafebabe',[1,0]),d=life('cafebabe',[1,0,1]);
 for(const [early,later,deadline] of [[a,b,1530000],[b,c,3290000],[c,d,5370000]]){
  assert.deepEqual(formalEvents(early,start+deadline-1),formalEvents(later,start+deadline-1));
  const prefix=formalEvents(later,start+deadline-1);
  assert.deepEqual(formalEvents(later,start+deadline+900000).slice(0,prefix.length),prefix);
 }
 const full=plannedContent(d);
 for(let tick=0;tick<=240;tick+=7)assert.deepEqual(formalEvents(d,start+tick*30000),full.slice(0,tick+1));
 const f=life('cafebabe',[0,1,0]);assert.notDeepEqual(full.filter(e=>e.age>67.125),plannedContent(f).filter(e=>e.age>67.125));
});

test('stateful career, relationships and objects require their actual previous chapters',()=>{
 const professions=new Set(),people=new Set(),objects=new Set();
 for(let i=0;i<48;i++){
  const l=life(seedAt(i),[i%2,i>>1&1,i>>2&1]),events=plannedContent(l),seen=new Set();
  assert.equal(events.filter(e=>e.kind==='career').length,10);
  assert.equal(events.filter(e=>e.kind==='relationship').length,24);
  assert.equal(events.filter(e=>e.kind==='object').length,12);
  assert.equal(events.filter(e=>e.kind==='commitment').length,6);
  assert.equal(events.filter(e=>e.kind==='legacy').length,4);
  for(const e of events){if(e.requires)assert.ok(seen.has(e.requires),e.id+' missing '+e.requires);seen.add(e.id);for(const value of Object.values(e.state))assert.ok(Number.isInteger(value)&&value>=0&&value<=100);}
  professions.add(narrativeProfile(l).career.id);events.filter(e=>e.kind==='relationship').forEach(e=>people.add(e.thread));events.filter(e=>e.kind==='object').forEach(e=>objects.add(e.thread));
 }
 assert.equal(professions.size,8);assert.equal(people.size,12);assert.equal(objects.size,8);
 const complete=plannedContent(life()),incomplete=plannedContent(life('deadbeef',[]));
 assert.equal(incomplete.filter(e=>['career','commitment','legacy'].includes(e.kind)).length,0);
 assert.ok(complete.some(e=>e.stateCause));
});

test('the same fictional world year is shared and its actual numeric thresholds change encounters',()=>{
 const conditions=new Set();
 for(let i=0;i<30;i++)for(const e of plannedContent(life(seedAt(i))))if(e.kind==='world'){
  assert.deepEqual(e.world,almanac(e.worldYear));
  if(e.condition){conditions.add(e.condition);const match=e.condition.match(/^(\w+)(>=|<=)(\d+)$/);assert.ok(match);assert.ok(match[2]==='>='?e.world[match[1]]>=+match[3]:e.world[match[1]]<=+match[3]);}
 }
 assert.ok(conditions.size>=7);
 const a=almanac(900);a.harvest=-999;assert.notEqual(almanac(900).harvest,-999);
 const birth=plannedContent(life())[0].text;assert.match(birth,/架空/);assert.match(birth,/不增減實際RPG金幣或戰力/);
});

test('finite authored catalogue has varied multi-life content with measured repetition limits',()=>{
 const inventory=contentInventory();assert.equal(inventory.ambient,504);assert.equal(inventory.careerChapters,80);assert.equal(inventory.relationshipChapters,72);assert.equal(inventory.objectChapters,32);assert.equal(inventory.worldReactions,48);
 // Four different seeds, same soul and identical decisions. No reliance on DB history to reconstruct.
 const seeds=[],seen=new Set(),rates=[],entries=[],shelves=new Set();
 for(let i=0;i<4;i++){const seed=seedForNextLife('deadbeef',entries,4);seeds.push(seed);shelves.add(parseInt(seed.slice(6),16)%4);const l=life(seed),rows=plannedContent(l),texts=rows.map(e=>e.text);assert.equal(new Set(texts).size,241);const repeated=texts.filter(t=>seen.has(t)).length;rates.push(repeated/241);texts.forEach(t=>seen.add(t));entries.push({code:encodeResult({...l,auto:[0,0,0]}),at:i+1});}
 assert.ok(rates[1]<.25,JSON.stringify(rates));assert.ok(rates[3]<.40,JSON.stringify(rates));assert.ok(seen.size>=750);assert.equal(shelves.size,4);
 const latest=entries.at(-1),naiveRows=plannedContent(life('deadbeef')),optimized=seedForNextLife('deadbeef',[latest],4);
 const lastTexts=new Set(plannedContent(life(seeds.at(-1))).map(e=>e.text));
 assert.ok(plannedContent(life(optimized)).filter(e=>lastTexts.has(e.text)).length<=naiveRows.filter(e=>lastTexts.has(e.text)).length);
 assert.equal(seedForNextLife('deadbeef',[latest],4),optimized);
 // This is a bounded catalogue; a replay of the same seed and answers is intentionally identical.
 assert.deepEqual(plannedContent(life(seeds[0])),plannedContent(life(seeds[0])));
});

test('literary endings are six paragraphs of 600–1000 characters grounded in actual experiences',()=>{
 const pictures=new Set(),titles=new Set();
 for(let i=0;i<96;i++){
  const l=life(seedAt(i),[i%2,i>>1&1,i>>2&1]),ending=endingForLife(l),rows=plannedContent(l),text=ending.paragraphs.join('');
  assert.equal(ending.paragraphs.length,6);assert.ok(text.length>=600&&text.length<=1000,`${l.seed}: ${text.length}`);
  assert.ok(!/第一幕|第二幕|第三幕|→|\n- /.test(text));
  const career=rows.filter(e=>e.kind==='career');assert.ok(text.includes(career[2].text));assert.ok(text.includes(career.at(-1).text));
  for(const e of rows.filter(e=>e.kind==='choice'))assert.ok(text.includes(e.text.split('這一頁')[0]));
  assert.equal(ending.stats.events,241);assert.equal(ending.worldYear,worldYear(l.seed,90));
  assert.ok(existsSync(fileURLToPath(new URL('../public'+ending.illustration,import.meta.url))));
  pictures.add(ending.illustration);titles.add(ending.title);
 }
 assert.equal(pictures.size,4);assert.equal(titles.size,4);
});

test('public code fields reproduce the full ending and retain manual versus automatic choices',()=>{
 const a={...life(),sources:['manual','auto','manual']},b={version:4,seed:a.seed,orbit:a.orbit,answers:a.answers,auto:[0,1,0]};
 assert.deepEqual(endingForLife(a),endingForLife(b));assert.equal(endingForLife(b).stats.autoChoices,1);
 assert.equal(endingForLife(b).stats.manualChoices,2);
 const shifted={...a,startedAt:start+1000000000,clockAt:start+1000000001};assert.deepEqual(endingForLife(a),endingForLife(shifted));
 const noAnswers=endingForLife(life('deadbeef',[]));assert.equal(noAnswers.stats.career,null);assert.ok(!noAnswers.summary.includes('成為'));
});

test('formal scenes are seed-only, stable and have independent immutable identities',()=>{
 for(let i=0;i<3;i++){const ids=new Set();for(let value=0;value<256;value++){const seed='01010101'.slice(0,i*2)+value.toString(16).padStart(2,'0')+'01010101'.slice(i*2+2),scenes=formalScenes({seed});assert.equal(scenes.length,3);assert.deepEqual(scenes.map(s=>s.age),[18,40,66]);assert.ok(scenes.every(s=>s.choices.length===2));ids.add(scenes[i].id);}assert.equal(ids.size,[8,12,8][i]);}
});
