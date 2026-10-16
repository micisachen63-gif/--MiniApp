import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fatePublic} from '../src/fate-public.js';
import {createLife,advanceLife,chooseLife,lifeSchedule,lifeAge,addActive,LIFE_MS,CHOICE_MS} from '../public/fate/life.js';
import {decodeResult,encodeResult,telegramUrl} from '../public/fate/model.js';
import {replayDecisionLife,decisionProfile} from '../public/fate/decision-engine-v7.js';
import {formalEvents,plannedContent} from '../public/fate/formal-events.js';
import {endingTimeline} from '../public/fate/ending-timeline.js';
import {rememberSoul,readSoul,seedForNextLife} from '../public/fate/cycles.js';
const T=Date.parse('2026-10-16T06:00:00+08:00');
const draft=(seed='1a2b3c4d',orbit=3)=>createLife({version:7,seed,orbit,zodiac:4,startedAt:T});

test('public shared v7 pages use the same current interface cache tags as the game entry',async()=>{
 const entry=readFileSync(new URL('../public/fate/index.html',import.meta.url),'utf8'),response=fatePublic(new Request('https://game.test/fate/r/f7360000000000000000008bb8c13f5')),html=await response.text();assert.equal(response.status,200);assert.match(html,/把欠下的日子/);
 for(const name of ['style.css','daily.css','app.js']){const re=new RegExp('/fate/'+name.replace('.','\\.')+'\\?v=([^"<>]+)'),tag=entry.match(re)?.[1];assert.ok(tag);assert.equal(html.match(re)?.[1],tag,name+' public shares must not reuse a stale pre-v7 script URL');}
});

test('v7 life clocks have varying choice counts, ordering and intervals and finish at exactly two active hours',()=>{
 const counts=new Set(),firstTimes=new Set(),orders=new Set();
 for(let i=0;i<100;i++){
  const life=draft(i.toString(16).padStart(8,'0'),i%12),v=advanceLife(life,T+LIFE_MS),replay=replayDecisionLife({...v.draft,auto:v.draft.sources.map(s=>s==='auto'?1:0)},{activeMs:LIFE_MS,autoFill:false});
  assert.equal(v.completed,true);assert.equal(v.endAt,T+LIFE_MS);assert.equal(lifeAge(v.draft,v.endAt),decisionProfile(life.seed,life.orbit).deathAge);assert.ok(v.draft.answers.length<=9);
  assert.equal(decodeResult(v.code).answers.length,v.draft.answers.length);assert.deepEqual(decodeResult(v.code).answers,v.draft.answers);assert.deepEqual(decodeResult(v.code).auto,v.draft.sources.map(s=>s==='auto'?1:0));
  for(let n=1;n<replay.scenes.length;n++)assert.ok(replay.scenes[n].openedMs>=replay.scenes[n-1].deadlineMs);
  counts.add(v.draft.answers.length);firstTimes.add(replay.scenes[0]?.openedMs);orders.add(replay.scenes.map(s=>s.id).join(','));
 }
 assert.ok(counts.size>=3);assert.ok(firstTimes.size>90);assert.ok(orders.size>80);
});

test('manual v7 decisions persist once, wait for deadline effects and cannot be replaced after reply or timeout',()=>{
 const life=draft(),at=lifeSchedule(T,life)[0],open=advanceLife(life,at);assert.equal(open.available,true);
 const chosen=chooseLife(life,0,at,0);assert.equal(chosen.available,false);assert.deepEqual(chosen.draft.sources,['manual']);
 assert.throws(()=>chooseLife(chosen.draft,1,at+1,0));
 assert.equal(formalEvents(chosen.draft,at+1).some(e=>e.kind==='choice'),false);
 const done=advanceLife(chosen.draft,addActive(at,CHOICE_MS));assert.ok(formalEvents(done.draft,done.draft.clockAt).some(e=>e.kind==='choice'&&e.choiceIndex===0));
 const late=advanceLife(life,addActive(at,CHOICE_MS));assert.equal(late.draft.sources[0],'auto');assert.throws(()=>chooseLife(late.draft,0,addActive(at,CHOICE_MS),0));
});

test('v7 variable windows retain remaining seconds across the midnight pause and never start the next life',()=>{
 const seed='3f4e5d6c',profile=replayDecisionLife({...draft(seed),auto:[]},{activeMs:0}),first=profile.nextScene.openedMs;
 const midnight=Date.parse('2026-10-17T00:00:00+08:00'),start=midnight-first-30000,life=createLife({version:7,seed,orbit:3,zodiac:null,startedAt:start}),slot=lifeSchedule(start,life)[0];
 const night=advanceLife(life,midnight+3*3600000);assert.equal(night.night,true);assert.equal(night.available,false);assert.deepEqual(night.draft.answers,[]);
 const dawn=Date.parse('2026-10-17T06:00:00+08:00');assert.equal(night.nextAt,dawn,'night sweep must sleep until dawn rather than continually resave an old opened time');assert.equal(advanceLife(night.draft,dawn).available,true);
 const deadline=addActive(slot,CHOICE_MS);assert.equal(deadline,dawn+60000);const timeout=advanceLife(night.draft,deadline);assert.equal(timeout.draft.sources[0],'auto');
 const ending=advanceLife(timeout.draft,addActive(start,LIFE_MS));assert.equal(ending.completed,true);assert.equal(ending.draft.startedAt,start);
});

test('v7 public codec roundtrips actual variable decisions and rejects padding, count and incomplete claims',()=>{
 const v=advanceLife(draft(),T+LIFE_MS),r=decodeResult(v.code);assert.equal(r.version,7);assert.equal(r.code.length,31);assert.ok(telegramUrl(v.code).split('start=')[1].length<=64);
 assert.equal(encodeResult({...r}),v.code);assert.equal(decodeResult(v.code.slice(0,3)+'0'+v.code.slice(4)),null);
 assert.throws(()=>encodeResult({...draft(),answers:[],auto:[]}));assert.equal(decodeResult(v.code+'0'),null);
 const events=plannedContent(r);assert.equal(events.filter(e=>e.kind==='choice').length,r.answers.length);
 const timeline=endingTimeline(r,events);assert.equal(timeline[0].age,0);assert.equal(timeline.at(-1).age,r.deathAge);assert.ok(timeline.every((e,i)=>!i||e.age>=timeline[i-1].age));
 assert.doesNotMatch(v.code,/birthday|account|char|TG/);
});

test('old v5 timeline annotates actual event ages without changing the immutable original prose',()=>{
 const r=decodeResult(encodeResult({version:5,orbit:3,zodiac:8,seed:'1a2b3c4d',answers:[0,1,0],auto:[0,1,0]})),before=JSON.stringify(r.ending.paragraphs),events=plannedContent(r),timeline=endingTimeline(r,events);
 for(const row of events.filter(e=>e.kind==='choice'))assert.ok(timeline.some(e=>e.age===Math.floor(row.age)&&e.text===row.text.replace(/這一頁(?:在期限到達時，由命運代你翻過|由你親自選定)。$/,'')));
 assert.equal(timeline.at(-1).age,r.deathAge);assert.equal(JSON.stringify(r.ending.paragraphs),before);
});

test('guest archives retain all v7 chronological decisions instead of dropping fractional ages or truncating late life',()=>{
 const v=advanceLife(draft('bb8c13f5'),T+LIFE_MS),events=plannedContent(v.draft),record=rememberSoul({entries:[]},v.code,T+LIFE_MS,events),loaded=readSoul(JSON.stringify(record)).entries[0];
 const decisions=events.filter(e=>e.kind==='choice');assert.ok(decisions.some(e=>!Number.isInteger(e.age)));assert.ok(events.length>240);assert.ok(loaded.memories.length<=32);
 for(const choice of decisions){const kept=loaded.memories.find(e=>e.id===choice.id);assert.ok(kept,choice.id);assert.equal(kept.age,Math.floor(choice.age));assert.equal(kept.text,choice.text);}
 assert.ok(loaded.memories.every(e=>Number.isInteger(e.age)&&e.age<=decodeResult(v.code).deathAge));
});

test('next-life variety evaluates the actual identity and cannot win by selecting fewer decision opportunities',()=>{
 const history=['00000000','12345678','deadbeef'].map(seed=>({code:advanceLife(draft(seed),T+LIFE_MS).code}));
 for(let i=0;i<24;i++){const seed=i.toString(16).padStart(8,'0'),orbit=i%12,raw=replayDecisionLife({version:7,seed,orbit}),chosen=seedForNextLife(seed,history,7,orbit),after=replayDecisionLife({version:7,seed:chosen,orbit});assert.ok(after.resolved.length>=raw.resolved.length);assert.equal(seedForNextLife(seed,[],7,orbit),seed);}
});
