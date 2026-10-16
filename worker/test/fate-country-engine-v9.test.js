import test from 'node:test';
import assert from 'node:assert/strict';
import {registerCountryPack,getCountryPack,countryFromCode} from '../public/fate/country-runtime-v9.js';
import {countryProfile,replayCountryLife} from '../public/fate/country-engine-v9.js';
import {plannedCountryContent,endingCountryLife} from '../public/fate/country-narrative-v9.js';
import {encodeResult,decodeResult} from '../public/fate/model.js';
import {createLife,advanceLife,chooseLife,lifeAge} from '../public/fate/life.js';
import {seedForNextLife} from '../public/fate/cycles.js';
// Synthetic unit fixture; these numbered texts are never shipped as game data.
const fixture={id:'JP',name:'日本',cityId:'tokyo',cityName:'東京',scope:'東京都範圍的隔離測試資料',currency:'JPY',families:['tight','ordinary','small-business','comfortable'].map((id,i)=>({id,label:'測試家庭'+i,text:'僅供隔離測試的家庭情境。'+i,money:100000*(i+1)})),careers:Array.from({length:12},(_,i)=>({id:'career-'+i,label:'測試工作'+i,minAge:18,practice:'這是隔離測試的受指導練習。',entry:'完成測試準備才接受這段工作。',chapters:Array.from({length:10},(_,j)=>'測試工作'+i+'的實際在職章節第'+j+'段。'),dilemmas:Array.from({length:4},(_,j)=>({id:'fixture-'+i+'-'+j,minStage:j<2?1:2,title:'測試交接問題'+j,text:'這是隔離測試中的實際工作情境。',choices:[{label:'完成交接',reason:'確認實際責任',outcome:'你完成這次可以核對的工作交接。',delta:{money:1000,reputation:4}},{label:'離開工作',reason:'停止在職章節',outcome:'你結束這段工作並完成必要交接。',exit:true,delta:{energy:5}}]}))})),daily:Object.fromEntries(Object.entries({child:120,youth:100,adult:720,late:420,any:140}).map(([key,n])=>[key,Array.from({length:n},(_,i)=>'這是僅供單元測試的'+key+'年齡層獨立紀事'+i+'。')])),education:{name:'測試課程',description:'這是測試用的課程路徑，不發專業執照。',startLabel:'開始課程',startOutcome:'你依測試條件開始課程。',pauseOutcome:'你暫緩這次測試課程安排。',completeLabel:'完成課程',completeOutcome:'你完成這次測試課程，沒有獲得額外執照。'},social:Array.from({length:24},(_,i)=>({id:'social-'+i,role:'鄰居',requiresCareer:false,chapters:Array.from({length:6},(_,j)=>'你和「{name}」在測試情境'+i+'的第'+j+'段相遇。')})),shared:['moving','parcel','repair','market','umbrella','bookstore'].map(id=>({id,title:'測試共同故事',text:'僅供測試情境',choices:[{label:'甲',outcome:'測試甲'},{label:'乙',outcome:'測試乙'}]})),sources:Array.from({length:3},(_,i)=>({id:'fixture-'+i,title:'隔離測試來源',url:'https://fixture.invalid/'+i,checkedAt:'2026-10-16',supports:'Not production research'}))};
registerCountryPack(fixture);
const life=(seed='00000001',orbit=11)=>({version:9,country:'JP',seed,orbit});

test('country identity is explicit and cannot fall back to another country or silently register malformed books',()=>{
 assert.equal(getCountryPack('JP'),fixture);assert.ok(Object.isFrozen(fixture));assert.equal(countryFromCode('f9jpb800000100000000000040000001d'),'JP');assert.equal(countryFromCode('f9zzbad'),null);
 assert.throws(()=>countryProfile('00000001',11,'ZZ'));assert.throws(()=>countryProfile('broken',11,'JP'));assert.throws(()=>registerCountryPack({...fixture}));assert.throws(()=>replayCountryLife({...life(),country:'TW'}));
});

test('country life answers stay hidden until the same fixed deadline and automatic answers are validated',()=>{
 const next=replayCountryLife(life(),{activeMs:0}).nextScene;assert.ok(next);
 const before=replayCountryLife({...life(),answers:[0],auto:[0]},{activeMs:next.openedMs});assert.equal(before.pending.answered,true);assert.equal(before.resolved.length,0);assert.deepEqual(before.state,before.initialState);
 const after=replayCountryLife({...life(),answers:[0],auto:[0]},{activeMs:next.deadlineMs});assert.equal(after.resolved.length,1);
 assert.throws(()=>replayCountryLife({...life(),answers:[0],auto:[1]},{activeMs:next.openedMs}));assert.throws(()=>replayCountryLife({...life(),answers:Array(10).fill(0)}));assert.throws(()=>replayCountryLife(life(),{activeMs:-1}));
});

test('a thousand full country lives exhaust neither age shelves nor deterministic causal decisions',()=>{
 const shelves=new Set(),ages=new Set(),orders=new Set(),careers=new Set(),endings=new Set();
 for(let i=0;i<1000;i++){
  const seed=(Math.imul(i+1,2654435761)>>>0).toString(16).padStart(8,'0'),raw=life(seed,i%12),run=replayCountryLife(raw),d={...raw,answers:run.answers,auto:run.auto},again=replayCountryLife(d,{autoFill:false});
  assert.equal(again.completed,true);assert.deepEqual(again.resolved,run.resolved);assert.ok(run.resolved.length<=9);assert.ok(run.resolved.every((r,j)=>r.atMs>=r.deadlineMs&&r.age>=0&&r.age<run.profile.deathAge&&(!j||r.atMs>run.resolved[j-1].atMs)));
  const rows=plannedCountryContent(d),daily=rows.filter(r=>['memory','career'].includes(r.kind));assert.equal(daily.length,240);assert.equal(new Set(daily.map(r=>r.text)).size,240);assert.ok(rows.every(r=>/^[a-z0-9-]{1,32}$/.test(r.id)));assert.ok(rows.filter(r=>r.kind==='career').every(r=>r.state.workActive));
  const story=endingCountryLife(d);assert.equal(story.chapters[0].age,0);assert.equal(story.chapters.at(-1).age,run.profile.deathAge);assert.ok(story.chapters.every((r,j)=>!j||r.age>=story.chapters[j-1].age));
  shelves.add(parseInt(seed.slice(6),16)&3);ages.add(run.profile.deathAge);orders.add(run.resolved.map(r=>r.id).join(','));if(run.state.careerId)careers.add(run.state.careerId);endings.add(run.terminalOutcome);
 }
 assert.equal(shelves.size,4);assert.equal(ages.size,45);assert.ok(orders.size>150);assert.equal(careers.size,12);assert.ok(endings.size>=5);
});

test('manual choices can diverge strongly while no unavailable or false qualification is added',()=>{
 let different=0;for(let i=0;i<200;i++){
  const raw=life(i.toString(16).padStart(8,'0'),i%12),manual=bit=>{let supplied=[];for(let j=0;j<9;j++){const run=replayCountryLife({...raw,answers:supplied,auto:supplied.map(()=>0)},{autoFill:false});if(run.completed)return run;supplied.push(bit);}return replayCountryLife({...raw,answers:supplied,auto:supplied.map(()=>0)});};
  const a=manual(0),b=manual(1);if(a.state.netWorth!==b.state.netWorth||a.terminalOutcome!==b.terminalOutcome)different++;
  assert.equal(a.state.teacherHired,undefined);assert.equal(b.state.teacherHired,undefined);for(const run of [a,b]){assert.ok(run.state.money>=0&&run.state.debt>=0);if(!run.state.workActive)assert.equal(run.state.careerId,null);}
 }assert.ok(different>150);
});

test('country public codes and clocked drafts preserve actual choices and distinguish an explicit country',()=>{
 const startedAt=Date.parse('2026-10-16T06:00:00+08:00'),d=createLife({...life(),zodiac:4,startedAt}),next=replayCountryLife(d,{activeMs:0}).nextScene;
 const chosen=chooseLife(d,0,startedAt+next.openedMs,0);assert.equal(chosen.draft.sources[0],'manual');
 const done=advanceLife(chosen.draft,startedAt+7200000),decoded=decodeResult(done.code);assert.equal(done.code.length,33);assert.equal(decoded.version,9);assert.equal(decoded.country,'JP');assert.equal(encodeResult(decoded),done.code);assert.equal(lifeAge(done.draft,done.draft.clockAt),decoded.deathAge);
 assert.deepEqual(plannedCountryContent(decoded).filter(r=>r.kind==='choice').map(r=>r.text),plannedCountryContent(done.draft).filter(r=>r.kind==='choice').map(r=>r.text));assert.equal(decodeResult(done.code.replace('f9jp','f9tw')),null);
 const history=[],shelves=[];for(let i=0;i<12;i++){const seed=seedForNextLife((0xabc000+i*7919).toString(16).padStart(8,'0'),history,9,i%12,'JP'),run=replayCountryLife(life(seed,i%12)),shelf=parseInt(seed.slice(6),16)&3;assert.ok(shelves.slice(-3).every(s=>s!==shelf));shelves.push(shelf);history.push({code:encodeResult({...life(seed,i%12),answers:run.answers,auto:run.auto,zodiac:4})});}
});
