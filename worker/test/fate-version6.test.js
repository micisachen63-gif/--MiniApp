import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeResult,encodeResult,publicUrl,telegramUrl} from '../public/fate/model.js';
import {createLife,validLife,advanceLife,lifeSchedule,chooseLife,lifeAge,addActive,LIFE_MS,CHOICE_MS} from '../public/fate/life.js';
import {lifeTiming} from '../public/fate/timing-v5.js';
import {plannedContent,formalEvents,formalScenes} from '../public/fate/formal-events.js';
import {seedForNextLife,readSoul} from '../public/fate/cycles.js';
import {narrativeEvents} from '../public/fate/event-catalog-v1.js';
const START=Date.parse('2026-10-16T09:00:00+08:00');

test('v6 public codec replays all decision/source bits with the seed clock, retaining no personal or client metric fields',()=>{
 for(let answers=0;answers<8;answers++)for(let sources=0;sources<8;sources++){
  const input={version:6,orbit:11,zodiac:10,seed:'deadbeef',answers:[answers>>2&1,answers>>1&1,answers&1],auto:[sources>>2&1,sources>>1&1,sources&1],birthDate:'1990-01-01',accountId:'not-public',wealthTwd:999999999,children:99,deathAge:1};
  const code=encodeResult(input),result=decodeResult(code);
  assert.equal(code.length,18);assert.equal(result.version,6);assert.equal(encodeResult(result),code);assert.deepEqual(result.answers,input.answers);assert.deepEqual(result.auto,input.auto);
  assert.equal(result.deathAge,lifeTiming(input).deathAge);assert.deepEqual(result,decodeResult(code));assert.ok(publicUrl(code).endsWith('/fate/r/'+code));assert.ok(telegramUrl(code).endsWith('?start=fate_'+code));
  assert.doesNotMatch(JSON.stringify(result),/1990-01-01|not-public|999999999|"children":99|"deathAge":1[,}]/);
 }
 for(const invalid of ['f7b101101xdeadbeef','f6b101xdeadbeef','f6c101101xdeadbeef','f6b101102xdeadbeef'])assert.equal(decodeResult(invalid),null);
});

test('new v6 lives persist the exact two-hour clock and manual deadlines; reopening cannot reroll timing or inject stats',()=>{
 let draft=createLife({version:6,orbit:3,seed:'12345678',startedAt:START}),schedule=lifeSchedule(START,draft);
 assert.deepEqual(lifeTiming(draft),lifeTiming({...draft,version:5}));
 assert.deepEqual(formalScenes(draft).map(s=>s.age),lifeTiming(draft).choiceAges);
 for(let i=0;i<3;i++){
  assert.throws(()=>chooseLife(draft,1,schedule[i]-1,i));draft=chooseLife(draft,i%2,schedule[i]+CHOICE_MS-1,i).draft;
  const reopened=validLife({...JSON.parse(JSON.stringify(draft)),deathAge:1,children:99,wealthTwd:999999999,choiceOffsets:[0,1,2]});
  assert.deepEqual(reopened,draft);assert.deepEqual(lifeSchedule(START,reopened),schedule);
 }
 const endAt=addActive(START,LIFE_MS),completed=advanceLife(draft,endAt);
 assert.equal(advanceLife(draft,endAt-1).completed,false);assert.equal(completed.completed,true);assert.equal(completed.code[1],'6');assert.deepEqual(decodeResult(completed.code).auto,[0,0,0]);assert.equal(lifeAge(draft,endAt),lifeTiming(draft).deathAge);
 assert.deepEqual(narrativeEvents(completed.draft,endAt),formalEvents(completed.draft,endAt));
 const record=readSoul({draft:completed.draft,entries:[{code:completed.code,at:endAt,memories:[{id:'late-memory',age:lifeTiming(draft).deathAge,text:'此生最後的記憶。'}]}]});assert.equal(record.draft.version,6);assert.equal(record.entries[0].memories.length,1);
});

test('v6 next-life candidates avoid the prior three same-stage scenario families and retain deterministic bounded seed selection',()=>{
 const entries=[];
 for(let n=0;n<12;n++){
  const seed=seedForNextLife('deadbeef',entries,6),life={version:6,seed,orbit:3,zodiac:10,answers:[1,0,1],auto:[0,1,0]},scenes=formalScenes(life);
  assert.equal(seedForNextLife('deadbeef',entries,6),seed);
  for(const entry of entries.slice(-3)){const previous=formalScenes(decodeResult(entry.code));for(let i=0;i<3;i++)assert.notEqual(scenes[i].scenarioId,previous[i].scenarioId);}
  entries.push({code:encodeResult(life)});
 }
});

test('fixed pre-v6 public results, full stories, pending clocks and completed codes retain their released byte baseline',()=>{
 const rows=[];
 for(let version=1;version<=5;version++)for(let n=0;n<32;n++){
  const seed=(Math.imul(n+1,2654435761)>>>0).toString(16).padStart(8,'0'),code=encodeResult({version,seed,orbit:n%12,zodiac:n%3?null:n%12,answers:[n>>2&1,n>>1&1,n&1],auto:version>=3?[n&1,n>>1&1,n>>2&1]:[]});
  const result=decodeResult(code);rows.push(result);if(version>=4)rows.push(plannedContent(result));
  if(version>=3){const draft=createLife({version,seed,orbit:n%12,startedAt:START});rows.push(lifeSchedule(START,draft),advanceLife(draft,START+1234567),advanceLife(draft,addActive(START,LIFE_MS)));}
 }
 assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),'86a111f7af3ef1aa3c04740b999d3533966bee12635d522622a6228b3cfb7aac');
});

test('released v4/v5 cross-life anti-repeat seed sequences stay unchanged after adding v6',()=>{
 const expected={4:['deadbeef','497a5a31','c0750558','4c7b5fea','477c580b','497a5a31','c0750558','337d7626'],5:['deadbeef','b8f3170c','77d6a0b1','8ce6c892','c90338a3','b8f3170c','7dd6aa25','8fe6cd4a']};
 for(const version of [4,5]){const entries=[];for(let n=0;n<8;n++){const seed=seedForNextLife('deadbeef',entries,version);assert.equal(seed,expected[version][n]);entries.push({code:encodeResult({version,seed,orbit:3,answers:[1,0,1],auto:[0,1,0],zodiac:10})});}}
});
