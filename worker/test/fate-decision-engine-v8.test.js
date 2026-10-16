import test from 'node:test';
import assert from 'node:assert/strict';
import {TAIWAN_CAREERS_V8,TAIWAN_RECIPE_V8,taiwanProfile,replayTaiwanLife,taiwanDecisionInventory} from '../public/fate/decision-engine-v8.js';
import {TAIWAN_CAREER_CHOICES_V8} from '../public/fate/taiwan-choices-v8.js';

const seedFor=i=>i.toString(16).padStart(8,'0');
function manual(seed,policy=()=>0,orbit=11){
 const life={version:8,country:'TW',seed,orbit,answers:[],auto:[]};
 for(let n=0;n<9;n++){const snapshot=replayTaiwanLife(life,{autoFill:false});if(!snapshot.pending)break;life.answers.push(policy(snapshot.pending,n,snapshot));life.auto.push(0);}
 return {life,result:replayTaiwanLife(life,{autoFill:false})};
}

test('v8 freezes only the completed Taiwan metro pack and deterministic birth profile',()=>{
 assert.equal(TAIWAN_RECIPE_V8,'v8-tw-metro-1');
 const a=taiwanProfile('1234abcd',3),b=taiwanProfile('1234abcd',3);
 assert.deepEqual(a,b);assert.equal(a.country,'TW');assert.equal(a.region,'雙北都市生活');assert.equal(a.durationMs,7200000);assert.equal(a.responseMs,90000);assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(a.careerOptions));
 assert.ok(['TPE','NWT'].includes(a.city));assert.ok(a.identityLabel.includes(a.cityName));
 for(const country of ['JP','US','IN','tw',''])assert.throws(()=>taiwanProfile('1234abcd',3,country),/not open/);
 for(const seed of ['xyz','1234ABCD',12,null])assert.throws(()=>taiwanProfile(seed));
 for(const orbit of [-1,12,1.2,'3'])assert.throws(()=>taiwanProfile('1234abcd',orbit));
 const profiles=Array.from({length:100},(_,i)=>taiwanProfile(seedFor(i),i%12));assert.deepEqual(new Set(profiles.map(p=>p.gender)),new Set(['m','f']));assert.ok(new Set(profiles.map(p=>p.familyId)).size===4);assert.ok(new Set(profiles.map(p=>p.deathAge)).size>25);
});

test('v8 birth sex does not lock any of the sixteen career pools',()=>{
 const genders={m:new Set(),f:new Set()};
 for(let i=0;i<1200;i++){const p=taiwanProfile(seedFor(i),i%12);p.careerOptions.forEach(id=>genders[p.gender].add(id));if(p.city!=='TPE')assert.ok(!p.careerOptions.includes('night_reception'));}
 assert.equal(TAIWAN_CAREERS_V8.length,16);assert.equal(genders.m.size,16);assert.equal(genders.f.size,16);
 assert.ok(TAIWAN_CAREERS_V8.some(c=>c.id==='night_reception'&&c.minAge===21));
 assert.ok(!TAIWAN_CAREERS_V8.some(c=>/^(幼兒園教師|教保員|護理師|照服員|會計師)$/.test(c.label)));
});

test('v8 replays exact answer vectors and rejects forged auto bits, future padding and unavailable answers',()=>{
 const base={version:8,seed:'1234abcd',orbit:3,country:'TW'},completed=replayTaiwanLife(base);
 assert.ok(completed.completed);assert.ok(completed.answers.length<=9);
 const encoded={...base,answers:completed.answers,auto:completed.auto};assert.deepEqual(replayTaiwanLife(encoded,{autoFill:false}),completed);
 const wrong=[...completed.answers];wrong[0]=1-wrong[0];assert.throws(()=>replayTaiwanLife({...encoded,answers:wrong}),/automatic answer/);
 assert.throws(()=>replayTaiwanLife({...base,answers:[0],auto:[]}),/vectors/);
 assert.throws(()=>replayTaiwanLife({...base,answers:[2]}),/vectors/);
 assert.throws(()=>replayTaiwanLife({...base,answers:new Array(1)}),/vectors/);
 assert.throws(()=>replayTaiwanLife({...base,answers:[0],auto:new Array(1)}),/vectors/);
 assert.throws(()=>replayTaiwanLife({...base,answers:[],auto:[0]}),/vectors/);
 assert.throws(()=>replayTaiwanLife({...base,country:null}),/not open/);
 assert.throws(()=>replayTaiwanLife({...base,orbit:null}),/identity/);
 assert.throws(()=>replayTaiwanLife({...base,answers:[0],auto:[0]},{activeMs:0}),/unavailable or future/);
 assert.throws(()=>replayTaiwanLife({...base,version:7}));
 for(const clock of [-1,7200001,1.5,NaN])assert.throws(()=>replayTaiwanLife(base,{activeMs:clock}));
 assert.throws(()=>replayTaiwanLife(base,{autoFill:'true'}));
 const actual=manual('1234abcd');assert.throws(()=>replayTaiwanLife({...actual.life,answers:[...actual.life.answers,0],auto:[...actual.life.auto,0]}),/unavailable|vectors/);
});

test('v8 resolves choices only at the fixed effective 90-second deadline',()=>{
 const base={version:8,seed:'b123abcd',orbit:2,country:'TW'},full=replayTaiwanLife(base),first=full.scenes[0];
 const before=replayTaiwanLife(base,{activeMs:first.openedMs-1});assert.equal(before.pending,null);assert.equal(before.nextAtMs,first.openedMs);
 const open=replayTaiwanLife(base,{activeMs:first.openedMs});assert.equal(open.pending.available,true);assert.equal(open.pending.remainingMs,90000);
 const answered={...base,answers:[0],auto:[0]},early=replayTaiwanLife(answered,{activeMs:first.openedMs+1}),late=replayTaiwanLife(answered,{activeMs:first.deadlineMs-1});
 assert.equal(early.pending.answered,true);assert.deepEqual(early.state,late.state);assert.deepEqual(early.state,early.initialState);assert.equal(early.resolved.length,0);
 const resolved=replayTaiwanLife(answered,{activeMs:first.deadlineMs});assert.equal(resolved.resolved.length,1);assert.equal(resolved.resolved[0].atMs,first.openedMs+90000);
 assert.throws(()=>replayTaiwanLife({...base,answers:[full.answers[0]],auto:[1]},{activeMs:first.deadlineMs-1}),/automatic answer/);
 const strict=replayTaiwanLife(base,{activeMs:first.deadlineMs,autoFill:false});assert.equal(strict.pending.missingAnswer,true);assert.equal(strict.completed,false);assert.equal(strict.resolved.length,0);
});

test('v8 1200 lives vary actual event order, count and time while preserving occupational and family prerequisites',()=>{
 const careers=new Set(),counts=new Set(),orders=new Set(),starts=new Set(),firstAges=new Set(),gendersByCareer=new Map();let childLives=0,careLives=0,riskLives=0;
 for(let i=0;i<1200;i++){
  const {result}=manual(seedFor(i),()=>0,i%12);assert.ok(result.completed);assert.ok(result.answers.length<=result.profile.eventLimit);assert.ok(result.answers.length<=9);
  counts.add(result.answers.length);orders.add(result.resolved.map(r=>r.id).join(','));starts.add(result.scenes[0]?.openedMs);firstAges.add(result.scenes[0]?.age);
  let previous=null;for(const row of result.resolved){
   assert.ok(row.atMs<=7200000);assert.equal(row.atMs,row.deadlineMs);assert.ok(row.stateAfter.moneyNtd>=0);assert.ok(row.stateAfter.debtNtd>=0);assert.equal(row.stateAfter.netWorthNtd,row.stateAfter.moneyNtd-row.stateAfter.debtNtd);
   const state=row.stateAfter;assert.equal(state.isTeacherWorking,state.workActive&&state.careerId==='early_childhood_assistant'&&state.teacherHired);assert.equal(state.caregiver,state.workActive&&state.careerId==='household_care');
   if(!state.workActive){assert.equal(state.careerId,null);assert.equal(state.careerLabel,null);assert.equal(state.employed,false);assert.equal(state.selfEmployed,false);assert.equal(state.teacherHired,false);assert.equal(state.licensedNightReception,false);assert.equal(state.careerStage,0);}
   if(previous)assert.ok(row.atMs>previous.atMs+90000);
   if(row.id==='career-entry'&&row.answer===0){assert.ok(previous&&result.resolved.some(p=>p.id==='career-practice'&&p.answer===0&&p.atMs<row.atMs));assert.ok(row.stateAfter.practiceCompleted);const id=row.stateAfter.careerId;careers.add(id);if(!gendersByCareer.has(id))gendersByCareer.set(id,new Set());gendersByCareer.get(id).add(result.profile.gender);if(id==='night_reception')assert.ok(result.scenes.find(s=>s.id==='career-entry').age>=21);}
   if(row.id==='business-pressure'){riskLives++;assert.ok(result.resolved.some(p=>p.id==='business-start'&&p.answer===0&&p.atMs<row.atMs));assert.ok(!row.stateAfter.caregiver);}
   if(row.id==='parenthood'){childLives++;assert.ok(row.stateAfter.partnerCommitted);assert.ok(result.resolved.some(p=>p.id==='partner-meet'&&p.answer===0&&p.atMs<row.atMs));}
   if(row.stateAfter.children>0)assert.ok(result.resolved.some(p=>p.id==='parenthood'&&p.answer===0&&p.atMs<=row.atMs));
   if(row.id==='family-care'){careLives++;assert.ok(result.profile.careOpportunity);}
   previous=row;
  }
 }
 assert.equal(careers.size,16);for(const values of gendersByCareer.values())assert.equal(values.size,2);
 assert.ok(counts.size>=5);assert.ok(orders.size>150);assert.ok(starts.size>1000);assert.ok(firstAges.size>15);assert.ok(childLives>0&&careLives>0&&riskLives>0);
});

test('v8 one expansion decision can produce a genuinely different ending and NTD asset/debt state',()=>{
 let found=null;for(let i=0;i<300&&!found;i++){const aggressive=manual(seedFor(i));if(aggressive.result.terminalOutcome==='debt-rebuilding'){const exit=manual(seedFor(i),scene=>scene.id==='business-pressure'?1:0);if(exit.result.terminalOutcome==='steady-exit')found={aggressive,exit};}}
 assert.ok(found,'a same-seed fork must reach debt failure versus clean exit');
 const {aggressive,exit}=found;assert.equal(aggressive.result.state.ventureFailed,true);assert.ok(aggressive.result.state.debtNtd>exit.result.state.debtNtd);assert.equal(aggressive.result.state.careerId,null);assert.equal(aggressive.result.state.workActive,false);assert.equal(exit.result.state.ventureExited,true);assert.ok(!exit.result.state.ventureFailed);
 const pressureA=aggressive.result.resolved.find(row=>row.id==='business-pressure'),pressureB=exit.result.resolved.find(row=>row.id==='business-pressure');assert.equal(pressureA.atMs,pressureB.atMs);
 assert.deepEqual(aggressive.result.resolved.slice(0,pressureA.index),exit.result.resolved.slice(0,pressureB.index));
});

test('v8 pause, no partnership and no parenthood decisions never earn unseen milestones',()=>{
 for(let i=0;i<300;i++){
  const {result}=manual(seedFor(i),scene=>['career-practice','career-restart','partner-meet','parenthood'].includes(scene.id)?1:0,i%12);
  assert.equal(result.state.children,0);assert.equal(result.state.married,false);assert.equal(result.state.partnerCommitted,false);
  assert.ok(!result.resolved.some(row=>row.id==='career-entry'));
  assert.ok(!result.resolved.some(row=>row.id==='business-start'));
 }
});

test('v8 kindergarten teacher requires three separate chosen milestones over actual years, then hiring',()=>{
 const policy=scene=>scene.id==='career-change'?1:0;
 const qualified=manual('0000001d',policy),rows=qualified.result.resolved;
 const start=rows.find(r=>r.id==='teacher-study'),degree=rows.find(r=>r.id==='teacher-degree'),certificate=rows.find(r=>r.id==='teacher-certificate');
 assert.ok(start&&degree&&certificate);assert.ok(degree.atMs-start.atMs>=4/qualified.result.profile.deathAge*7200000);assert.ok(certificate.atMs-degree.atMs>=.6/qualified.result.profile.deathAge*7200000);
 assert.equal(start.stateAfter.teacherDegreeCompleted,false);assert.equal(start.stateAfter.teacherCertificateGranted,false);assert.equal(start.stateAfter.careerLabel,'幼兒園活動與行政支援');
 for(const key of ['teacherDegreeCompleted','teacherPreEducationCompleted','teacherExamPassed'])assert.equal(degree.stateAfter[key],true);
 assert.equal(degree.stateAfter.teacherCertificateGranted,false);assert.equal(degree.stateAfter.teacherHired,false);assert.equal(degree.stateAfter.education,'bachelor');
 for(const key of ['teacherInternshipPassed','teacherCertificateGranted','teacherHired'])assert.equal(certificate.stateAfter[key],true);
 assert.equal(certificate.stateAfter.careerId,'early_childhood_assistant');assert.equal(certificate.stateAfter.careerLabel,'幼兒園教師');assert.equal(qualified.result.terminalOutcome,'teacher-journey');
 for(const decline of ['teacher-study','teacher-degree','teacher-certificate']){
  const skipped=manual('0000001d',scene=>scene.id===decline?1:policy(scene)).result;
  assert.equal(skipped.state.teacherHired,false);assert.equal(skipped.state.teacherCertificateGranted,false);assert.notEqual(skipped.state.careerLabel,'幼兒園教師');
 }
});

test('v8 adult venue route remains a Taipei-only permit-checked, consensual reception story',()=>{
 let visits=0;for(let i=0;i<500;i++){
  const profile=taiwanProfile(seedFor(i),i%12);if(!profile.careerOptions.includes('night_reception'))continue;
  const result=manual(seedFor(i),scene=>scene.id==='career-training'?profile.careerOptions.indexOf('night_reception'):scene.id==='career-change'?1:0,i%12).result;
  const entry=result.resolved.find(r=>r.id==='career-entry'&&r.answer===0);if(!entry)continue;visits++;
  assert.equal(result.profile.city,'TPE');assert.equal(entry.stateAfter.licensedNightReception,true);assert.equal(entry.stateAfter.careerLabel,'酒家陪侍接待');assert.ok(entry.age>=21);assert.match(entry.text,/許可/);assert.match(entry.text,/同意/);assert.ok(!result.resolved.some(r=>r.id==='business-start'));
 }
 assert.ok(visits>5);
});

test('v8 leaving teaching clears employment while retaining earned qualifications, for caregiving and career change',()=>{
 for(const [seed,answers,target,career]of [
  ['0000009f',[0,0,0,0,0,0,0,0],'family-care','household_care'],
  ['00002563',[1,0,0,0,0,0,0,0,0],'career-change',null]
 ]){
  const result=replayTaiwanLife({version:8,country:'TW',seed,orbit:11,answers,auto:answers.map(()=>0)},{autoFill:false}),hire=result.resolved.find(r=>r.id==='teacher-certificate'),departure=result.resolved.find(r=>r.id===target);
  assert.ok(hire&&departure&&departure.atMs>hire.atMs);assert.equal(hire.stateAfter.teacherHired,true);assert.equal(hire.stateAfter.isTeacherWorking,true);
  assert.equal(departure.stateAfter.teacherHired,false);assert.equal(departure.stateAfter.isTeacherWorking,false);assert.equal(departure.stateAfter.teacherCertificateGranted,true);assert.equal(departure.stateAfter.teacherInternshipPassed,true);assert.equal(departure.stateAfter.teacherDegreeCompleted,true);assert.equal(departure.stateAfter.careerId,career);assert.equal(departure.consequences.flags.teacherHired,false);
  assert.notEqual(result.terminalOutcome,'teacher-journey');assert.equal(result.state.teacherHired,false);assert.equal(result.state.teacherCertificateGranted,true);
 }
});

test('v8 inventory has 90 unique bounded event IDs, including 64 individually authored career dilemmas',()=>{
 const inventory=taiwanDecisionInventory();assert.equal(inventory.length,90);assert.equal(new Set(inventory.map(row=>row.id)).size,90);assert.ok(inventory.every(row=>row.id.length<=20&&row.choiceCount===2));
 assert.equal(TAIWAN_CAREER_CHOICES_V8.length,64);assert.equal(new Set(TAIWAN_CAREER_CHOICES_V8.map(row=>row.title)).size,64);assert.equal(new Set(TAIWAN_CAREER_CHOICES_V8.map(row=>row.text)).size,64);assert.ok(Object.isFrozen(TAIWAN_CAREER_CHOICES_V8));
 for(const career of TAIWAN_CAREERS_V8)assert.equal(TAIWAN_CAREER_CHOICES_V8.filter(row=>row.careerId===career.id).length,4);
 for(const row of TAIWAN_CAREER_CHOICES_V8){
  assert.ok(row.requires.includes('workActive'));assert.ok(row.chance>=.1&&row.chance<=.25);assert.equal(row.choices.length,2);assert.notEqual(row.choices[0].label,row.choices[1].label);assert.notEqual(row.choices[0].outcome,row.choices[1].outcome);
  for(const choice of row.choices){assert.ok(Object.keys(choice.set).length);assert.ok(Object.values(choice.set).every(value=>typeof value==='boolean'));assert.ok(Object.values(choice.delta).every(value=>typeof value==='number'&&Number.isFinite(value)));}
 }
 const teacher=TAIWAN_CAREER_CHOICES_V8.filter(row=>row.careerId==='early_childhood_assistant');assert.equal(teacher.filter(row=>row.requiresTeacher).length,2);assert.equal(teacher.filter(row=>row.teacherMode==='support').length,2);
});

test('v8 all 64 career dilemmas actually occur, never cross careers or exceed the per-life detail limit',()=>{
 const triggered=new Set(),index=new Map(TAIWAN_CAREER_CHOICES_V8.map(row=>[row.id,row]));
 for(let i=0;i<6000;i++){
  const {result}=manual(seedFor(i),scene=>scene.id==='career-training'?i%2:['career-change','family-care','business-start'].includes(scene.id)?1:scene.id==='teacher-study'?(i%4<2?1:0):0,i%12);
  const details=result.resolved.filter(row=>index.has(row.id));assert.ok(details.length<=2);let before=result.initialState;
  for(const row of result.resolved){
   const definition=index.get(row.id);if(definition){triggered.add(row.id);assert.equal(before.workActive,true);assert.equal(before.careerId,definition.careerId);assert.ok(before.careerStage>=definition.minCareerStage);if(definition.requiresTeacher)assert.equal(before.isTeacherWorking,true);if(definition.teacherMode==='support'){assert.equal(before.teacherHired,false);assert.ok(before.teacherStudyDeclined||before.teacherStudyPaused||before.teacherCertificationDeferred);}if(definition.careerId==='night_reception'){assert.equal(result.profile.city,'TPE');assert.ok(row.age>=21);}}
   before=row.stateAfter;
  }
 }
 assert.equal(triggered.size,64);
});

test('v8 the reported stopped-training life has later conditional decisions and no automatic job award',()=>{
 const result=replayTaiwanLife({version:8,country:'TW',seed:'00000001',orbit:11}),paused=result.resolved.find(row=>row.id==='career-practice');assert.equal(paused.answer,1);
 const retry=result.resolved.find(row=>row.id==='career-restart'),practice=result.resolved.find(row=>row.id==='restart-practice'),offer=result.resolved.find(row=>row.id==='restart-entry');
 assert.ok(retry&&practice&&offer);assert.ok(retry.atMs>paused.atMs);assert.ok(practice.atMs>retry.atMs);assert.ok(offer.atMs>practice.atMs);assert.notEqual(retry.stateAfter.careerTarget,paused.stateAfter.careerTarget);
 assert.equal(retry.stateAfter.workActive,false);assert.equal(practice.stateAfter.workActive,false);assert.equal(offer.answer,1);assert.equal(offer.stateAfter.workActive,false);assert.ok(result.resolved.some(row=>row.id==='fresh-life-plan'&&row.atMs>offer.atMs));assert.equal(result.state.communityActive,true);
 const entered=manual('00000001',scene=>scene.id==='career-practice'?1:0).result,entry=entered.resolved.find(row=>row.id==='restart-entry');assert.ok(entry&&entry.answer===0);assert.equal(entry.stateAfter.workActive,true);assert.ok(entry.stateAfter.restartPracticeCompleted);assert.equal(entry.stateAfter.careerId,entry.stateAfter.careerTarget);
 const declined=manual('00000001',scene=>['career-practice','career-restart'].includes(scene.id)?1:0).result;assert.ok(!declined.resolved.some(row=>row.id==='restart-entry'));assert.equal(declined.state.workActive,false);assert.ok(declined.resolved.some(row=>row.id==='fresh-life-plan'));
});
