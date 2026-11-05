import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCurrent,projectCompleted,projectMemorial,remainingChoice} from '../public/scene-fate-story.js';
import {createLife,advanceLife,chooseLife,addActive,activeBetween,LIFE_MS,CHOICE_MS,isOpenTime} from '../public/fate/life.js';
import {scenesFor} from '../public/fate/cycles.js';
import {encodeResult,decodeResult,ZODIAC} from '../public/fate/model.js';
import {endingForLife} from '../public/fate/ending-story.js';
import {ensureCountryPack,COUNTRY_METADATA_V9} from '../public/fate/country-runtime-v9.js';
import {formalEvents} from '../public/fate/formal-events.js';

const NOW=Date.parse('2026-11-05T02:00:00Z');
const copy=value=>JSON.parse(JSON.stringify(value));
const life=(version=3,extra={})=>createLife({version,country:version===8?'TW':undefined,orbit:2,zodiac:null,seed:'1234abcd',startedAt:NOW,...extra});
function envelope(draft,at,{storyAt:forced,...extra}={}) {
  const view=advanceLife(draft,at),slot=view.slots[view.index];let storyAt=Math.min(at,view.completed?view.endAt-1:at);
  if(view.draft.answers.length>draft.answers.length)storyAt=Math.min(storyAt,addActive(view.slots[draft.answers.length],CHOICE_MS)-1);
  return {id:'original-life',rev:2,status:'active',startedAt:draft.startedAt,nextAt:view.nextAt,draft:copy(draft),timing:{
    displayAt:at,storyAt:forced??storyAt,index:view.index,available:view.available,opensAt:slot??null,deadline:slot?addActive(slot,CHOICE_MS):null,nextAt:view.nextAt,endAt:view.endAt,night:view.night,completionDue:view.completed,settlementPending:view.completed||view.draft.answers.length!==draft.answers.length,persistedAnswerCount:draft.answers.length,projectedAnswerCount:view.draft.answers.length,...extra}};
}
function formalEntry(draft) { const end=advanceLife(draft,addActive(draft.startedAt,LIFE_MS));return {id:'original-completed',code:end.code,at:end.endAt,draft:end.draft}; }
test('current projection uses original question labels, false/zero answers and immutable raw seed without advancing storage',async()=>{
  const draft=life(),first=advanceLife(draft,NOW).slots[0],input=envelope(draft,first),before=copy(input),story=await projectCurrent(input),scene=scenesFor(draft)[0];
  assert.deepEqual(input,before);assert.equal(story.committed,false);assert.equal(story.countsAsLife,false);assert.deepEqual(story.persistedAnswers,[]);
  assert.equal(story.question.index,0);assert.equal(story.question.text,scene.text);assert.deepEqual(story.question.choices,scene.choices.map((row,answer)=>({answer,label:row[0],reason:row[1]})));
  assert.ok(!story.question.choices.some(row=>Object.hasOwn(row,'outcome')),'future results are not presented as choices already taken');
  for(const answer of [0,1]){const chosen=chooseLife(draft,answer,first,0).draft,projected=await projectCurrent(envelope(chosen,first));assert.deepEqual(projected.persistedAnswers,[answer]);assert.deepEqual(projected.persistedSources,['manual']);assert.equal(projected.question,null);assert.equal(chosen.seed,draft.seed);}
});
test('uncommitted original 90 second timeout never becomes a saved answer or completed life in presentation',async()=>{
  const draft=life(),slot=advanceLife(draft,NOW).slots[0],at=addActive(slot,CHOICE_MS),input=envelope(draft,at),before=copy(input),story=await projectCurrent(input);
  assert.equal(advanceLife(draft,at).draft.answers.length,1);assert.deepEqual(input,before);assert.deepEqual(story.persistedAnswers,[]);assert.equal(story.question,null);assert.equal(story.settlementPending,true);assert.equal(story.storyAt,at-1);
  assert.equal(story.events.filter(row=>row.kind==='choice').length,0);assert.equal(story.countsAsLife,false);
  const unsafe=await projectCurrent(envelope(draft,at,{storyAt:at}));assert.equal(unsafe.storyAt,draft.clockAt);assert.deepEqual(unsafe.persistedAnswers,[]);
});
test('current raw clock that already implies missing automatic answers fails closed without fabricated story',async()=>{
  const draft=life(),slot=advanceLife(draft,NOW).slots[0],at=addActive(slot,CHOICE_MS);draft.clockAt=at;
  await assert.rejects(projectCurrent(envelope(draft,at)),/同步/);
});
test('late scene cannot display complete until original completed row exists',async()=>{
  const draft=life(8),input=envelope(draft,addActive(draft.startedAt,LIFE_MS)+1000),story=await projectCurrent(input);
  assert.equal(story.committed,false);assert.equal(story.countsAsLife,false);assert.equal(story.settlementPending,true);assert.ok(story.progress<100);assert.deepEqual(story.persistedAnswers,[]);
  const entry=formalEntry(draft),done=await projectCompleted(entry);assert.equal(done.committed,true);assert.equal(done.countsAsLife,true);assert.equal(done.code,entry.code);assert.equal(done.question,endingForLife(entry.draft).question);
});
test('original cross-night timeline pauses six hours; countdown uses active time without shortening choice',async()=>{
  const startedAt=Date.parse('2026-11-05T15:35:00Z'),draft=life(3,{startedAt}),slot=advanceLife(draft,startedAt).slots[0],deadline=addActive(slot,CHOICE_MS);
  assert.equal(new Date(slot).toISOString(),'2026-11-05T15:59:00.000Z');
  assert.equal(new Date(deadline).toISOString(),'2026-11-05T22:00:30.000Z');
  const before=await projectCurrent(envelope(draft,slot)),midnight=await projectCurrent(envelope(draft,Date.parse('2026-11-05T16:00:00Z'))),wake=await projectCurrent(envelope(draft,Date.parse('2026-11-05T22:00:00Z')));
  assert.equal(before.question.index,0);assert.equal(midnight.night,true);assert.equal(midnight.question,null);assert.equal(wake.question.index,0);
  assert.equal(remainingChoice(envelope(draft,slot).timing,slot).seconds,90);
  assert.deepEqual(remainingChoice(envelope(draft,slot).timing,Date.parse('2026-11-05T16:00:00Z')),{open:false,night:true,seconds:30});
  assert.equal(remainingChoice(envelope(draft,slot).timing,Date.parse('2026-11-05T22:00:00Z')).seconds,30);
  assert.equal(activeBetween(startedAt,addActive(startedAt,LIFE_MS)),LIFE_MS);
});
test('saved timeout source and original manual choice prose are preserved after background synchronization',async()=>{
  const draft=life(5),slot=advanceLife(draft,NOW).slots[0],advanced=advanceLife(draft,addActive(slot,CHOICE_MS)),input=envelope(advanced.draft,advanced.draft.clockAt),story=await projectCurrent(input);
  assert.deepEqual(story.persistedAnswers,advanced.draft.answers);assert.deepEqual(story.persistedSources,['auto']);assert.equal(story.events.filter(row=>row.kind==='choice').length,1);assert.equal(story.events.find(row=>row.kind==='choice').source,'auto');
  const expected=scenesFor(advanced.draft)[0].choices[advanced.draft.answers[0]][2];assert.ok(story.events.find(row=>row.kind==='choice').text.endsWith(expected));
});
test('original legacy and dynamic versions retain formal endings and memorial is cosmetic',async t=>{
  for(const version of [3,4,5,7,8])await t.test('v'+version,async()=>{
    const entry=formalEntry(life(version)),before=copy(entry),story=await projectCompleted(entry),memory=await projectMemorial({code:entry.code,at:entry.at});
    assert.deepEqual(entry,before);assert.equal(story.code,encodeResult({...entry.draft,auto:entry.draft.sources.map(source=>source==='auto'?1:0)}));
    assert.equal(story.countsAsLife,true);assert.equal(memory.countsAsLife,false);assert.equal(memory.committed,false);assert.equal(memory.id,null);assert.equal(memory.code,entry.code);
    const original=version>=4?endingForLife(entry.draft):decodeResult(entry.code).ending;
    assert.equal(story.title,original.title);assert.deepEqual(story.paragraphs,original.paragraphs||[original.body]);assert.ok(story.events.length>=entry.draft.answers.length);
  });
});
test('each original v9 country is loaded deterministically with unchanged seed/country, narration, and ending',async t=>{
  for(const country of Object.keys(COUNTRY_METADATA_V9))await t.test(country,async()=>{
    await ensureCountryPack(country);const draft=life(9,{country}),input=envelope(draft,NOW+30000),before=copy(input),current=await projectCurrent(input);
    assert.deepEqual(input,before);assert.equal(current.image,'/art/fate-countries-v9/'+country.toLowerCase()+'-memory.webp');assert.ok(current.identity.place.includes(COUNTRY_METADATA_V9[country].cityName));
    const rows=formalEvents({...draft,clockAt:current.storyAt},current.storyAt);assert.deepEqual(current.events.map(row=>row.text),rows.sort((a,b)=>a.age-b.age||String(a.id).localeCompare(String(b.id))).map(row=>row.text));
    const entry=formalEntry(draft),original=endingForLife(entry.draft),story=await projectCompleted(entry),memory=await projectMemorial({code:entry.code});
    assert.equal(story.title,original.title);assert.deepEqual(story.paragraphs,original.paragraphs);assert.deepEqual(story.timeline,original.chapters);assert.equal(memory.code,entry.code);assert.equal(memory.countsAsLife,false);assert.equal(entry.draft.seed,draft.seed);
  });
});
test('formal completion validates original encoded choices; hidden zodiac remains hidden and explicit zero zodiac displays',async()=>{
  const entry=formalEntry(life(8,{zodiac:0})),story=await projectCompleted(entry);assert.equal(story.identity.zodiac,ZODIAC[0]+'座');
  const hidden=await projectCurrent(envelope(life(8),NOW));assert.equal(hidden.identity.zodiac,'');
  const altered=copy(entry);altered.draft.seed='deadbeef';await assert.rejects(projectCompleted(altered),/代碼|紀錄/);
  await assert.rejects(projectCompleted({code:entry.code,draft:entry.draft}),/完成紀錄/);
  await assert.rejects(projectMemorial({code:entry.code+'bad'}),/辨識/);
});
