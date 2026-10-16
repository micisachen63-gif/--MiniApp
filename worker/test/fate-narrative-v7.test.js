import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {plannedV7Content,profileV7,endingV7,narrativeV7Inventory} from '../public/fate/narrative-v7.js';
import {replayDecisionLife,DECISION_DURATION_MS as DURATION} from '../public/fate/decision-engine-v7.js';
const life=(seed='deadbeef',extra={})=>({version:7,seed,orbit:3,answers:[],auto:[],...extra});
function manualLife(seed,branch=()=>0){const d=life(seed);for(let i=0;i<=9;i++){const r=replayDecisionLife(d,{activeMs:DURATION,autoFill:false});if(r.completed)return d;assert.ok(r.pending?.missingAnswer);d.answers.push(branch(r.pending));d.auto.push(0);}throw Error('Too many decisions');}

test('v7 has a finite authored daily pool and no unconditional career or qualification chain',()=>{
 const inventory=narrativeV7Inventory();assert.equal(inventory.newMemoryCount,270);assert.equal(inventory.reserveMemoryCount,397);assert.equal(inventory.memoryCount,667);assert.equal(inventory.endingThemes,8);assert.equal(inventory.intervalMs,30000);
 for(const version of [1,2,3,4,5,6]){assert.deepEqual(plannedV7Content({...life(),version}),[]);assert.equal(endingV7({...life(),version}),null);assert.equal(profileV7({...life(),version}),null);}
 const source=readFileSync(new URL('../public/fate/narrative-v7.js',import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"].*(?:formal-events|model\.js|life\.js|cycles\.js|geography|life-metrics)/);assert.doesNotMatch(source,/answers\??\.\[[12]\]/);
});

test('an authored 30-second feed remains distinct, chronological and available across short and long lifespans',()=>{
 for(let i=0;i<96;i++){const d=life(i.toString(16).padStart(8,'0')),run=replayDecisionLife(d,{activeMs:DURATION,autoFill:true}),rows=plannedV7Content(d),memory=rows.filter(row=>row.kind==='memory');
  assert.equal(memory.length,240);assert.equal(new Set(memory.map(row=>row.id)).size,240);assert.equal(new Set(memory.map(row=>row.text)).size,240);
  assert.equal(rows.filter(row=>row.kind==='choice').length,run.resolved.length);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
  for(let n=0;n<rows.length;n++){assert.ok(rows[n].age<=run.profile.deathAge);if(n)assert.ok(rows[n].activeMs>=rows[n-1].activeMs);}
 }
});

test('a manual answer cannot leak its outcome or changed state before its fixed deadline',()=>{
 const d=life(),pending=replayDecisionLife(d,{activeMs:DURATION,autoFill:false}).pending,answered={...d,answers:[1],auto:[0]};
 const before=plannedV7Content(answered,{activeMs:pending.deadlineMs-1});assert.equal(before.filter(row=>row.kind==='choice').length,0);
 const initial=replayDecisionLife(d,{activeMs:0,autoFill:true}).initialState;for(const row of before)assert.deepEqual(row.state,initial);
 const after=plannedV7Content(answered,{activeMs:pending.deadlineMs}),saved=replayDecisionLife(answered,{activeMs:pending.deadlineMs,autoFill:true}).resolved[0],choice=after.find(row=>row.kind==='choice');
 assert.equal(choice.activeMs,pending.deadlineMs);assert.equal(choice.text,saved.outcome);assert.equal(choice.choiceIndex,0);assert.deepEqual(choice.state,saved.stateAfter);assert.equal(choice.source,'manual');
 assert.deepEqual(before.filter(row=>row.kind==='memory'),after.filter(row=>row.kind==='memory'&&row.activeMs<pending.deadlineMs));
});

test('every displayed score comes from the initial state or the most recent actual resolved state',()=>{
 const d=manualLife('bb8c13f5'),run=replayDecisionLife(d,{activeMs:DURATION,autoFill:false});
 for(const row of plannedV7Content(d)){const prior=[...run.resolved].reverse().find(choice=>choice.deadlineMs<=row.activeMs);assert.deepEqual(row.state,prior?.stateAfter||run.initialState);}
 assert.equal(endingV7(d).stats.debt,run.state.debt);assert.equal(endingV7(d).stats.wealth,run.state.wealth);
});

test('authoritative draft source strings retain auto decisions instead of silently becoming manual',()=>{
 const d=life(),run=replayDecisionLife(d,{activeMs:DURATION,autoFill:true}),draft={version:7,seed:d.seed,orbit:d.orbit,answers:run.answers,sources:run.auto.map(bit=>bit?'auto':'manual')},book=endingV7(draft);
 assert.equal(book.stats.autoChoices,run.resolved.length);assert.equal(book.stats.manualChoices,0);
 assert.ok(plannedV7Content(draft).filter(row=>row.kind==='choice').every(row=>row.source==='auto'));
 assert.deepEqual(book.timeline.filter(row=>row.kind==='choice').map(row=>row.source),run.resolved.map(row=>row.source));
});

test('one real venture decision yields visibly different debt and stable-exit short stories',()=>{
 const debt=manualLife('bb8c13f5'),exit=manualLife('bb8c13f5',scene=>scene.id==='venture-pressure'?1:0),a=endingV7(debt),b=endingV7(exit);
 assert.equal(a.terminalOutcome,'debt-rebuilding');assert.equal(b.terminalOutcome,'steady-exit');
 for(const key of ['title','summary','question'])assert.notEqual(a[key],b[key]);assert.notDeepEqual(a.paragraphs,b.paragraphs);
 assert.match(a.paragraphs.join(''),/負擔|缺口/);assert.ok(a.stats.debt>a.stats.wealth);assert.ok(b.stats.ventureExited);
 for(const book of [a,b])assert.match(book.illustration,/^\/art\/fate-ending-20261016\/(?:harbor|atelier|garden|voyage)\.webp$/);
});

test('ending chapters and timeline show actual ages and choices in order, including the true death age',()=>{
 const d=manualLife('ba8c1262'),run=replayDecisionLife(d,{activeMs:DURATION,autoFill:false}),book=endingV7(d),choices=book.timeline.filter(row=>row.kind==='choice');
 assert.equal(choices.length,run.resolved.length);
 for(const [i,choice]of choices.entries()){assert.equal(choice.age,Math.floor(run.resolved[i].deadlineMs/DURATION*run.profile.deathAge));assert.equal(choice.text,run.resolved[i].outcome);assert.ok(book.paragraphs.some(text=>text.includes(choice.age+'歲｜'+choice.text)));}
 assert.equal(book.timeline.at(-1).age,run.profile.deathAge);assert.equal(book.timeline.at(-1).kind,'ending');assert.deepEqual(book.chapters,book.timeline.map(({age,label,text})=>({age,label,text})));
 for(let i=1;i<book.timeline.length;i++)assert.ok(book.timeline[i].activeMs>=book.timeline[i-1].activeMs);
});

test('an unfinished life never receives its future ending, job, spouse, children, certificate or country',()=>{
 const d=life('00000000',{clockMs:60000}),book=endingV7(d),profile=profileV7(d);
 assert.equal(book.title,'尚未合上的旅誌');assert.equal(profile.career.id,'undetermined');assert.equal(book.timeline.filter(row=>row.kind==='ending').length,0);assert.equal(book.timeline.filter(row=>row.kind==='choice').length,0);
 assert.doesNotMatch(book.paragraphs.join(''),/歲落款|結婚|丈夫|妻子|兒子|女兒|教師證|護理師|臺灣|印度/);
 assert.equal(book.stats.career,null);assert.equal(book.stats.manualChoices,0);assert.equal(book.stats.autoChoices,0);
});

test('birth gender follows the core seed identity without changing career availability',()=>{
 const found=new Map();for(let i=0;i<32;i++){const d=life(i.toString(16).padStart(8,'0')),run=replayDecisionLife(d,{activeMs:0,autoFill:true});found.set(run.profile.gender,d);assert.equal(profileV7(d,{activeMs:0}).gender,run.profile.gender);assert.match(plannedV7Content(d,{activeMs:0})[0].text,new RegExp(run.profile.gender==='f'?'女孩':'男孩'));}
 assert.deepEqual([...found.keys()].sort(),['f','m']);for(const [gender,d]of found)assert.match(endingV7(d).paragraphs[0],new RegExp(gender==='f'?'女孩':'男孩'));
});

test('existing public-role snapshots enter the feed and ending safely, without leaking private cast data',()=>{
 const d=life('deadbeef',{socialCast:{v:1,people:[{thread:'rooftop',name:'白色毛衣',tgId:'secret-player'},{thread:'rival',name:'55688',accountId:'secret-account'},{thread:'brother',name:'<script>'}]}}),rows=plannedV7Content(d),people=rows.filter(row=>row.kind==='relationship'),book=endingV7(d);
 assert.equal(people.length,2);assert.match(people[0].text,/白色毛衣|55688/);assert.ok(people.every(row=>row.activeMs>0));assert.ok(book.chapters.some(row=>row.text.includes('白色毛衣')));assert.ok(book.chapters.some(row=>row.text.includes('55688')));
 assert.doesNotMatch(JSON.stringify([rows,book,profileV7(d)]),/secret-player|secret-account|<script>|tgId|accountId/);
 assert.equal(plannedV7Content(d,{activeMs:0}).filter(row=>row.kind==='relationship').length,0);
});

test('shared outcomes enter only after their actual clock and remain in the chronological ending',()=>{
 const start=Date.parse('2026-10-16T06:00:00+08:00'),offset=3000000,d=life('deadbeef',{startedAt:start,clockAt:start+DURATION,sharedMemories:[{id:'shared-garden',at:start+offset,ownerName:'白色毛衣',guestName:'55688',answer:1,source:'manual',text:'55688寄回了一袋種子，這段共同選擇被收進旅誌。',tgId:'secret'}]});
 assert.equal(plannedV7Content(d,{activeMs:offset-1}).filter(row=>row.kind==='shared').length,0);
 const shared=plannedV7Content(d,{activeMs:offset}).filter(row=>row.kind==='shared');assert.equal(shared.length,1);assert.equal(shared[0].activeMs,offset);
 const book=endingV7(d);assert.equal(book.timeline.filter(row=>row.kind==='shared').length,1);assert.ok(book.paragraphs.some(text=>text.includes('寄回了一袋種子')));assert.doesNotMatch(JSON.stringify(book),/secret|tgId/);
});
