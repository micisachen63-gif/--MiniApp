import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../public/fate/world.js';
import {activeBetween,addActive} from '../public/fate/life.js';
import {DECISION_CATALOGUE_V7,DECISION_DURATION_MS,DECISION_RESPONSE_MS,decisionProfile,createDecisionRun,advanceDecisions,inspectDecisionCandidates,chooseDecision,replayDecisionLife} from '../public/fate/decision-engine-v7.js';
const seedAt=n=>hash('decision-audit-'+n).toString(16).padStart(8,'0');
function play(seed,policy=()=>0,orbit=3){
 const life={version:7,seed,orbit,answers:[],auto:[]};let replay=replayDecisionLife(life,{activeMs:0,autoFill:false});
 for(let n=0;n<9&&replay.nextScene;n++){
  const scene=replay.nextScene;life.answers.push(policy(scene,replay));life.auto.push(0);
  replay=replayDecisionLife(life,{activeMs:scene.deadlineMs,autoFill:false});
 }
 return {life,replay:replayDecisionLife(life,{autoFill:false})};
}
const valueOf=record=>({energy:record.energy,wealth:record.wealth,debt:record.debt,support:record.support,bonds:record.bonds});

test('twenty-six distinct conditional scenes have usable two-option reasons and strictly gated career/venture followups',()=>{
 assert.equal(DECISION_CATALOGUE_V7.length,26);assert.equal(new Set(DECISION_CATALOGUE_V7.map(e=>e.id)).size,26);
 const journey=play('bb8c13f5'),all=journey.replay;
 for(const scene of all.scenes){assert.equal(scene.choices.length,2);assert.ok(scene.choices.every(option=>option.length===3&&option.every(text=>typeof text==='string'&&text.length>4)));assert.notEqual(scene.choices[0][0],scene.choices[1][0]);}
 const run=createDecisionRun({seed:'bb8c13f5',orbit:3}),diagnostics=inspectDecisionCandidates(run,0),partnership=diagnostics.find(e=>e.id==='partnership');
 assert.equal(partnership.eligible,false);assert.ok(partnership.reasons.includes('requires:skillReady'));assert.ok(partnership.conditions.all.includes('trustedPeer'));assert.ok(partnership.conditions.all.includes('skillReady'));
 const opened=all.scenes.find(e=>e.id==='partnership'),prior=all.resolved.filter(e=>e.atMs<opened.openedMs).at(-1).stateAfter;assert.equal(prior.skillReady,true);assert.equal(prior.trustedPeer,true);
});

test('many seeds vary actual event counts, identity, order, first age and gaps; the five-to-nine budget is not a quota',()=>{
 const counts=new Set(),limits=new Set(),firstAges=new Set(),orders=new Set(),gaps=new Set();let short=false;
 for(let n=0;n<384;n++){
  const {replay}=play(seedAt(n));limits.add(replay.profile.eventLimit);counts.add(replay.answers.length);orders.add(replay.scenes.map(s=>s.id).join(','));
  assert.ok(replay.profile.eventLimit>=5&&replay.profile.eventLimit<=9);assert.ok(replay.answers.length<=replay.profile.eventLimit);assert.equal(replay.completed,true);if(replay.answers.length<5)short=true;
  assert.equal(new Set(replay.scenes.map(s=>s.id)).size,replay.scenes.length);
  if(replay.scenes.length)firstAges.add(replay.scenes[0].age);
  replay.scenes.forEach((scene,i)=>{assert.ok(Number.isInteger(scene.openedMs)&&Number.isInteger(scene.deadlineMs));assert.equal(scene.deadlineMs-scene.openedMs,DECISION_RESPONSE_MS);assert.ok(scene.deadlineMs<=DECISION_DURATION_MS);if(i){const gap=scene.openedMs-replay.scenes[i-1].deadlineMs;assert.ok(gap>=120000);gaps.add(gap);}});
 }
 assert.equal(limits.size,5);assert.ok(counts.size>=6);assert.ok(orders.size>200);assert.ok(gaps.size>200);assert.ok(firstAges.size>20);assert.ok(Math.min(...firstAges)<10);assert.ok(Math.max(...firstAges)>30);assert.equal(short,true);
 assert.notDeepEqual(decisionProfile('deadbeef',0),decisionProfile('deadbeef',11),'identity participates in the fixed context/profile');
});

test('three thousand seeded lives reach distinct route endings in practice; venture consequences are not merely theoretical rare branches',()=>{
 const terminals=[new Map(),new Map()],genders=new Map();let pressure=0,failures=0,successes=0;
 for(let n=0;n<1500;n++){
  const seed=hash('distribution-v7-'+n).toString(16).padStart(8,'0');
  for(const strategy of [0,1]){
   const {replay}=play(seed,()=>strategy);terminals[strategy].set(replay.terminalOutcome,(terminals[strategy].get(replay.terminalOutcome)||0)+1);
   for(const row of replay.resolved){if(row.id==='venture-pressure'){pressure++;if(row.consequences.riskResult==='setback')failures++;else successes++;assert.equal(row.stateAfter.careerTransition,false,'an active venture cannot simultaneously be described as a departed job');}
    if(row.id==='career-change'){assert.equal(row.stateAfter.ventureOpen,false);if(row.answer===0){assert.equal(row.stateAfter.employed,false);assert.equal(row.stateAfter.freelance,false);}}
   }
   if(strategy===0)genders.set(replay.profile.gender,(genders.get(replay.profile.gender)||0)+1);
  }
 }
 assert.ok(terminals[0].size>=6);assert.ok(terminals[1].size>=3);assert.ok(pressure>=100,'at least a meaningful group of the 1500 committed paths must reach the venture pressure question');assert.ok(failures>=30);assert.ok(successes>=50);assert.ok(terminals[1].get('quiet-independent')>=100);assert.ok(terminals[1].get('creative-legacy')>=100);
 for(const gender of ['f','m'])assert.ok(genders.get(gender)>600&&genders.get(gender)<900,'this is the configured approximately 50/50 game draw, not a national demographic claim');
 assert.equal(DECISION_CATALOGUE_V7.some(event=>event.context?.includes('gender')||event.requires.includes('gender')),false,'gender never hard-locks a career');
});

test('an earlier refusal can remove an entire later work/venture chain instead of merely changing its wording',()=>{
 const accept=play('bb8c13f5'),decline=play('bb8c13f5',scene=>scene.id==='skill-practice'?1:0);
 assert.ok(accept.replay.scenes.some(s=>s.id==='work-offer'));assert.ok(accept.replay.scenes.some(s=>s.id==='partnership'));
 assert.equal(decline.replay.scenes.some(s=>['work-offer','first-project','partnership','first-helper','venture-pressure','repayment-choice'].includes(s.id)),false);
 assert.notDeepEqual(accept.replay.scenes.map(s=>s.id),decline.replay.scenes.map(s=>s.id));assert.equal(decline.replay.state.trainingPaused,true);assert.equal(decline.replay.state.workActive,false);
});

test('same seed produces causal debt versus steady exit with distinct facts, consequences and a different full ending',()=>{
 const venture=play('bb8c13f5'),exit=play('bb8c13f5',scene=>scene.id==='venture-pressure'?1:0),risk=venture.replay.scenes.find(s=>s.id==='venture-pressure');
 assert.ok(risk);assert.match(risk.choices[0][1],/借款|債務/);assert.match(risk.choices[1][1],/放棄擴張/);
 assert.equal(venture.replay.terminalOutcome,'debt-rebuilding');assert.equal(exit.replay.terminalOutcome,'steady-exit');
 assert.ok(venture.replay.state.debt>venture.replay.state.wealth);assert.equal(exit.replay.state.debt,0);assert.ok(venture.replay.state.netWorth<exit.replay.state.netWorth-100);assert.notDeepEqual(valueOf(venture.replay.state),valueOf(exit.replay.state));
 const failure=venture.replay.resolved.find(e=>e.id==='venture-pressure');assert.equal(failure.consequences.riskResult,'setback');assert.ok(failure.consequences.delta.debt>=90);assert.match(failure.text,/回款|成本/);assert.equal(failure.stateAfter.ventureFailed,true);
 assert.notEqual(venture.replay.endingFocus.title,exit.replay.endingFocus.title);assert.notEqual(venture.replay.endingFocus.summary,exit.replay.endingFocus.summary);assert.match(venture.replay.endingFocus.summary,/債務/);assert.match(exit.replay.endingFocus.summary,/穩定結束/);assert.equal(venture.replay.profile.deathAge,exit.replay.profile.deathAge);
 const success=play('ba8c1262');assert.equal(success.replay.terminalOutcome,'venture-builder');assert.ok(success.replay.state.wealth>success.replay.state.debt);assert.match(success.replay.endingFocus.summary,/回款|訂單/);assert.equal(success.replay.resolved.find(e=>e.id==='venture-pressure').consequences.riskResult,'success','the risky choice is not a guaranteed punishment');
});

test('partial replay exposes just one causally scheduled next scene and never credits its future outcome or risk',()=>{
 const life={version:7,seed:'bb8c13f5',orbit:3,answers:[],auto:[]},initial=replayDecisionLife(life,{activeMs:0,autoFill:false}),next=initial.nextScene;
 assert.equal(initial.scenes.length,1);assert.equal(initial.pending,null);assert.ok(next.openedMs>0);assert.equal(initial.nextAtMs,next.openedMs);assert.equal(initial.resolved.length,0);assert.deepEqual(initial.state,initial.initialState);assert.equal(initial.state.trustedPeer,false);
 const open=replayDecisionLife(life,{activeMs:next.openedMs,autoFill:false});assert.equal(open.pending.available,true);assert.equal(open.pending.answered,false);assert.equal(open.pending.index,0);assert.equal(open.pending.remainingMs,90000);assert.equal(open.resolved.length,0);
 const submitted={...life,answers:[0],auto:[0]},answered=replayDecisionLife(submitted,{activeMs:next.openedMs+1,autoFill:false});assert.equal(answered.pending.answered,true);assert.equal(answered.pending.available,false);assert.equal(answered.pending.chosenAnswer,0);assert.deepEqual(answered.state,answered.initialState);assert.equal(answered.resolved.length,0);assert.equal(answered.scenes.length,1);
 const resolved=replayDecisionLife(submitted,{activeMs:next.deadlineMs,autoFill:false});assert.equal(resolved.resolved.length,1);assert.equal(resolved.resolved[0].atMs,next.deadlineMs);assert.equal(resolved.resolved[0].stateAfter.trustedPeer,true);assert.equal(initial.state.trustedPeer,false,'snapshots are independent objects');
});

test('auto-fill is deterministic across restart and coarse/fine polling while strict replay never fills a missing answer',()=>{
 const life={version:7,seed:'deadbeef',orbit:3,answers:[],auto:[]},whole=replayDecisionLife(life),again=replayDecisionLife(JSON.parse(JSON.stringify(life)));assert.deepEqual(whole,again);assert.ok(whole.resolved.every(e=>e.source==='auto'));assert.equal(whole.completed,true);
 const strict=replayDecisionLife(life,{autoFill:false});assert.equal(strict.completed,false);assert.equal(strict.answers.length,0);assert.equal(strict.pending.missingAnswer,true);assert.equal(strict.resolved.length,0);
 let current={...life};for(let activeMs=0;activeMs<=DECISION_DURATION_MS;activeMs+=30000){const step=replayDecisionLife(current,{activeMs});current={...current,answers:step.answers,auto:step.auto};}
 const chunked=replayDecisionLife(current);assert.deepEqual(chunked,whole);const decoded=replayDecisionLife({...life,answers:whole.answers,auto:whole.auto},{autoFill:false});assert.equal(decoded.completed,true);assert.deepEqual(decoded.resolved,whole.resolved);
 const short={...life,answers:whole.answers.slice(0,-1),auto:whole.auto.slice(0,-1)};assert.equal(replayDecisionLife(short,{autoFill:false}).completed,false);
});

test('malformed, future, extra and forged automatic answer vectors fail closed rather than inventing a valid public code',()=>{
 const life={version:7,seed:'bb8c13f5',orbit:3,answers:[],auto:[]},done=play(life.seed).life,next=replayDecisionLife(life,{activeMs:0,autoFill:false}).nextScene;
 for(const broken of [{...life,version:5},{...life,seed:'oops'},{...life,orbit:12},{...life,answers:[2],auto:[0]},{...life,answers:[0],auto:[]},{...life,answers:'000',auto:[]},{...life,answers:[0],auto:[2]},{...life,answers:Array(10).fill(0),auto:Array(10).fill(0)}])assert.throws(()=>replayDecisionLife(broken));
 assert.throws(()=>replayDecisionLife({...life,answers:[0],auto:[0]},{activeMs:next.openedMs-1}));assert.throws(()=>replayDecisionLife({...life,answers:[0],auto:[1]},{activeMs:next.openedMs}));
 const automatic=replayDecisionLife(life),wrong={...life,answers:[1-automatic.answers[0]],auto:[1]};assert.throws(()=>replayDecisionLife(wrong),/automatic answer/);
 if(done.answers.length<9)assert.throws(()=>replayDecisionLife({...done,answers:[...done.answers,0],auto:[...done.auto,0]},{autoFill:false}));
 for(const activeMs of [-1,DECISION_DURATION_MS+1,NaN,1.5])assert.throws(()=>replayDecisionLife(life,{activeMs}));
});

test('persisted action logs support identical retries, block changed requests and make early/late manual answers converge at the fixed deadline',()=>{
 const run=createDecisionRun({seed:'bb8c13f5',orbit:3}),first=advanceDecisions(run,0).view.nextAtMs;
 const early=chooseDecision(run,{eventId:'child-circle',answer:0,requestId:'request-early'},first+1),late=chooseDecision(run,{eventId:'child-circle',answer:0,requestId:'request-late'},first+89999);
 assert.equal(early.view.pending.answered,true);assert.equal(early.state.trustedPeer,false);assert.equal(early.journal.filter(e=>e.type==='resolved').length,0);
 const earlyEnd=advanceDecisions(early.run,DECISION_DURATION_MS),lateEnd=advanceDecisions(late.run,DECISION_DURATION_MS);assert.deepEqual(earlyEnd.journal,lateEnd.journal);assert.deepEqual(earlyEnd.state,lateEnd.state);
 const retry=chooseDecision(early.run,{eventId:'child-circle',answer:0,requestId:'request-early'},first+100);assert.equal(retry.run.actions.length,1);
 assert.throws(()=>chooseDecision(early.run,{eventId:'child-circle',answer:1,requestId:'request-early'},first+100),/conflict/);assert.throws(()=>chooseDecision(early.run,{eventId:'child-circle',answer:1,requestId:'request-other'},first+100),/not available/);
 assert.throws(()=>chooseDecision(run,{eventId:'child-circle',answer:0,requestId:'request-night'},first,{allowManual:false}),/paused/);assert.throws(()=>chooseDecision(run,{eventId:'child-circle',answer:0,requestId:'request-expired'},first+90000),/not available/);
 const high=advanceDecisions(run,first+90000);assert.equal(advanceDecisions(high.run,0).view.clockMs,high.view.clockMs);
});

test('existing effective clock pauses choices across midnight and never extends the two-hour life duration',()=>{
 const life={version:7,seed:'bb8c13f5',orbit:3,answers:[],auto:[]},next=replayDecisionLife(life,{activeMs:0,autoFill:false}).nextScene;
 const start=Date.parse('2026-10-16T23:59:00+08:00')-next.openedMs,midnight=Date.parse('2026-10-17T00:00:00+08:00'),night=Date.parse('2026-10-17T05:59:59+08:00'),resume=Date.parse('2026-10-17T06:00:00+08:00');
 assert.deepEqual(replayDecisionLife(life,{activeMs:activeBetween(start,midnight)}),replayDecisionLife(life,{activeMs:activeBetween(start,night)}));
 assert.equal(replayDecisionLife(life,{activeMs:activeBetween(start,resume)}).pending.remainingMs,30000);
 assert.equal(activeBetween(start,addActive(start,DECISION_DURATION_MS)),DECISION_DURATION_MS);
 assert.equal(replayDecisionLife(life).profile.durationMs,DECISION_DURATION_MS);
});
