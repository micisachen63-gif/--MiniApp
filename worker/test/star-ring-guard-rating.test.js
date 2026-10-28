import test from 'node:test';import assert from 'node:assert/strict';
import * as E from '../src/game/star-ring.js';import {mkChar,T0} from './helpers.js';
function state(engineVersion=3,factor=1){
 const actors=['archer:A1','mage:A1','thief:A1','archer:A2','mage:B1'].map((x,i)=>{const[base_class,class_path]=x.split(':');const a=E.snapshot({char:mkChar({tg_id:String(i+1),base_class,class_path,level:90}),equipment:[]});return {...a,atk:a.atk*factor,departureAtk:a.atk*factor};});
 return {id:'rating-probe',engineVersion,optionalGuard:true,tier:90,tactic:'balanced',difficulty:'advanced',seed:'guard-rating-a',startedAt:T0,endsAt:T0+E.DURATION,actors,results:[],stageTactics:['balanced'],departed:{}};
}
for(const engineVersion of [1,2,3])test(`v${engineVersion}: no-guard A performance earns full A EXP and the same personal grade drop chance`,()=>{
 const s=state(engineVersion,engineVersion===1?4.7:3.95),r=E.simulateStage(s,5),early=E.simulateStage(s,5,Math.floor(E.BEATS*.65));
 assert.ok(r.coverage.missing.includes('guard'));assert.equal(r.defeated,true);assert.equal(early.defeated,false);assert.equal(r.grade,'A');assert.equal(r.expHours,22/6);
 let extras=0;for(let n=0;n<1000;n++){
  const sample={...s,seed:'guard-grade-loot-'+n},a=s.actors[0],actual=E.stageReward(sample,a,5,r),reference=E.stageReward({...sample,optionalGuard:false},a,5,r);
  assert.deepEqual(actual,reference);assert.equal(actual.baseExp??actual.exp-(actual.bonus?.exp||0),Math.round(a.baselineExpPerMinute*220));extras+=actual.equipment.length-1;
 }assert.ok(extras>210&&extras<290,`A grade extras: ${extras}/1000`);
});
test('optional guard does not grant free high grades to a weak team or waive missing aid; old policy remains B',()=>{
 const weak=state(3,.01);assert.equal(E.simulateStage(weak,5).grade,'B');
 const strong=state(1,1e5),missingAid={...strong,actors:strong.actors.filter(a=>a.base!=='mage')};assert.ok(E.simulateStage(missingAid,5).coverage.missing.includes('aid'));assert.equal(E.simulateStage(missingAid,5).grade,'B');
 assert.equal(E.simulateStage({...strong,optionalGuard:undefined},5).grade,'B');
});
