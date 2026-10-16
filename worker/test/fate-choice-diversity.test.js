import test from 'node:test';
import assert from 'node:assert/strict';
import {V5_CHOICE_VARIANTS} from '../public/fate/formal-choices-v5.js';
import {createLife,validLife,advanceLife,chooseLife,lifeSchedule,addActive,LIFE_MS,CHOICE_MS} from '../public/fate/life.js';
import {decodeResult} from '../public/fate/model.js';
import {formalScenes,formalEvents,plannedContent} from '../public/fate/formal-events.js';
import {seedForNextLife,scenesFor} from '../public/fate/cycles.js';
import {lifeTiming} from '../public/fate/timing-v5.js';
import {hash} from '../public/fate/world.js';

const START=Date.parse('2026-10-16T09:00:00+08:00');
const seedAt=n=>n<8?[n*16+1,n*16+2,n*16+3,1].map(b=>b.toString(16).padStart(2,'0')).join(''):hash('choice-diversity-'+n).toString(16).padStart(8,'0');
const start=n=>createLife({version:5,orbit:3,seed:seedAt(n),startedAt:START});
const finish=life=>advanceLife(life,addActive(START,LIFE_MS));

test('v5 offers twenty-four distinct complete decisions with two genuinely separate labels per scenario',()=>{
 assert.equal(V5_CHOICE_VARIANTS.length,3);
 const titles=[new Set(),new Set(),new Set()],labels=[new Set(),new Set(),new Set()],families=[new Set(),new Set(),new Set()];
 for(let n=0;n<64;n++){
  const life=start(n),scenes=formalScenes(life);assert.equal(scenes.length,3);
  scenes.forEach((scene,i)=>{
   assert.ok(scene.scenarioId?.startsWith('v5-'+i+'-'));assert.equal(scene.choices.length,2);assert.ok(scene.title.length>5&&scene.text.length>20);assert.ok(Number.isInteger(scene.age));
   const [a,b]=scene.choices;assert.notEqual(a[0],b[0]);assert.notEqual(a[2],b[2]);
   for(const option of scene.choices){assert.equal(option.length,3);assert.ok(option.every(s=>typeof s==='string'&&s.length>3));assert.doesNotMatch(option.join(''),/undefined|TODO|待補/);labels[i].add(option[0]);}
   titles[i].add(scene.title);families[i].add(scene.scenarioId);
  });
 }
 for(let i=0;i<3;i++){assert.equal(V5_CHOICE_VARIANTS[i].length,8);assert.equal(families[i].size,8);assert.ok(titles[i].size>=8);assert.ok(labels[i].size>=12,'players need new actions, not only renamed backgrounds');}
});

test('the selected scenario survives draft reload and public f5 replay without relying on later account history',()=>{
 for(let n=0;n<8;n++){
  const initial=start(n),finished=finish(initial),reopened=validLife(JSON.parse(JSON.stringify(finished.draft))),decoded=decodeResult(finished.code),before=formalScenes(initial);
  assert.deepEqual(formalScenes(reopened),before);assert.deepEqual(formalScenes(decoded),before);assert.deepEqual(scenesFor(decoded),before);
  assert.equal(decoded.version,5);assert.deepEqual(decoded.auto,[1,1,1]);
 }
});

test('both options in every family become the actual manual outcome and automatic sources retain their real outcome',()=>{
 for(let n=0;n<8;n++){
  const initial=start(n),scenes=formalScenes(initial),slots=lifeSchedule(START,initial);
  for(const answer of [0,1]){
   let draft=initial;
   for(let stage=0;stage<3;stage++)draft=chooseLife(draft,answer,slots[stage]+1000,stage).draft;
   const completed=finish(draft),decoded=decodeResult(completed.code),choices=plannedContent(completed.draft).filter(e=>e.kind==='choice');
   assert.deepEqual(decoded.auto,[0,0,0]);assert.equal(choices.length,3);
   for(let stage=0;stage<3;stage++){const choice=choices.find(e=>e.choiceIndex===stage);assert.equal(choice.answer,answer);assert.equal(choice.source,'manual');assert.ok(choice.text.startsWith(scenes[stage].choices[answer][2]));assert.match(choice.text,/由你親自選定/);}
   assert.deepEqual(plannedContent(decoded).filter(e=>e.kind==='choice'),choices);
  }
  const automatic=finish(initial),automaticChoices=plannedContent(automatic.draft).filter(e=>e.kind==='choice');assert.equal(automaticChoices.length,3);
  for(const choice of automaticChoices){assert.equal(choice.source,'auto');assert.equal(choice.answer,automatic.draft.answers[choice.choiceIndex]);assert.ok(choice.text.startsWith(scenes[choice.choiceIndex].choices[choice.answer][2]));assert.match(choice.text,/命運代你翻過/);}
 }
});

test('no family reveals a pending choice consequence or lets an early click rewrite preceding memories',()=>{
 for(let n=0;n<8;n++){
  const initial=start(n),timing=lifeTiming(initial),answers=[1,0,1],sources=['manual','manual','manual'];
  for(let stage=0;stage<3;stage++){
   const deadline=timing.choiceOffsets[stage]+CHOICE_MS,prefix={...initial,answers:answers.slice(0,stage),sources:sources.slice(0,stage)},chosen={...initial,answers,sources};
   const before=formalEvents(chosen,START+deadline-1);assert.deepEqual(before,formalEvents(prefix,START+deadline-1));assert.ok(!before.some(e=>e.kind==='choice'&&e.choiceIndex===stage));
   const later=formalEvents(chosen,START+deadline+45000);assert.deepEqual(later.slice(0,before.length),before);assert.ok(later.some(e=>e.kind==='choice'&&e.choiceIndex===stage));
  }
 }
});

test('twelve successive lives never reuse any stage family from the preceding three lives',()=>{
 const entries=[];
 for(let n=0;n<12;n++){
  const seed=seedForNextLife(seedAt(37+n),entries,5),completed=finish({...start(n),seed}),decoded=decodeResult(completed.code),scenes=formalScenes(decoded);
  for(const previous of entries.slice(-3)){const old=formalScenes(decodeResult(previous.code));for(let stage=0;stage<3;stage++)assert.notEqual(scenes[stage].scenarioId,old[stage].scenarioId);}
  entries.push({code:completed.code});assert.deepEqual(formalScenes(decodeResult(completed.code)),scenes);
 }
});
