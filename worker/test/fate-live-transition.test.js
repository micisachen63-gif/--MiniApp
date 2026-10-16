import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLife,advanceLife,chooseLife,lifeSchedule,validLife} from '../public/fate/life.js';

const START=Date.parse('2026-10-16T09:00:00+08:00');
// Execute the shipped syncCloud function, rather than a reimplementation of its
// comparison predicate. A server refresh can infer availability on both old and
// new drafts while the currently rendered DOM still has no response buttons.
function fixture({previous,next,now,question=null}){
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8'),start=source.indexOf('async function syncCloud('),end=source.indexOf('function paintCloudLife(',start);
 assert.ok(start>=0&&end>start);
 const stats={renders:0,paints:0,requests:0},context={
  embedded:true,syncing:false,pendingFull:false,lastSync:0,sharedUI:{sync(){}},client:{request:async()=>{stats.requests++;return structuredClone(next);}},
  cloudOffset:0,cloud:structuredClone(previous),heroName:'驗收旅人',cloudError:'',soul:{entries:[]},currentLife:structuredClone(previous.active.draft),result:null,stage:'life',qs:new URLSearchParams(),
  advanceLife,validLife,cloudNow:()=>now,Date,window:{scrollY:120,scrollTo(){}},render:()=>stats.renders++,paintCloudLife:()=>stats.paints++,
  document:{querySelector:selector=>selector==='.fate-live-question'?question:null},requestAnimationFrame:()=>assert.fail('not a notification-entry test'),showCloudError:()=>assert.fail('unexpected sync error'),stats
 };
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {stats,context,run:()=>context.syncCloud(false,false)};
}
function draft(){return createLife({version:7,seed:'bb8c13f5',orbit:3,startedAt:START});}
function cloud(d,now){const v=advanceLife(d,now);return {now,heroName:'驗收旅人',active:{id:'offline-life',rev:1,draft:v.draft,nextAt:v.available?v.slots[v.index]+90000:v.nextAt}};}

test('real cloud sync creates response buttons when an open event was inferred on both drafts but is absent from the rendered page',async()=>{
 const d=draft(),opened=lifeSchedule(START,d)[0],previous=cloud(d,opened-1000),next=cloud(d,opened+1000),t=fixture({previous,next,now:opened+1000});
 assert.equal(advanceLife(previous.active.draft,opened+1000).available,true);assert.equal(advanceLife(next.active.draft,opened+1000).available,true);
 assert.deepEqual(previous.active.draft.answers,next.active.draft.answers);
 await t.run();assert.equal(t.stats.requests,1);assert.equal(t.context.cloudError,'');assert.equal(t.stats.renders,1,'new buttons require render even when before/after authority gates are both available');
});

test('real cloud sync preserves an already rendered matching question during an ordinary progress refresh',async()=>{
 const d=draft(),opened=lifeSchedule(START,d)[0],previous=cloud(d,opened+1000),next=cloud(d,opened+2000),t=fixture({previous,next,now:opened+2000,question:{dataset:{choiceIndex:'0'}}});
 await t.run();assert.equal(t.context.cloudError,'');assert.equal(t.stats.renders,0);assert.equal(t.stats.paints,1);
});

test('real cloud sync replaces a stale question with the actual available index, even when the persisted answer arrays match',async()=>{
 const d=draft(),opened=lifeSchedule(START,d)[0],previous=cloud(d,opened+1000),next=cloud(d,opened+2000),t=fixture({previous,next,now:opened+2000,question:{dataset:{choiceIndex:'99'}}});
 await t.run();assert.equal(t.context.cloudError,'');assert.equal(t.stats.renders,1);
});

test('a submitted v7 answer waits for its deadline without recreating the same question on ordinary cloud sync',async()=>{
 const d=draft(),opened=lifeSchedule(START,d)[0],chosen=chooseLife(d,0,opened+1000,0).draft,now=opened+89000,previous=cloud(chosen,opened+1000),next=cloud(chosen,now),t=fixture({previous,next,now});
 assert.equal(advanceLife(chosen,now).available,false);assert.equal(next.active.draft.answers.length,1);
 await t.run();assert.equal(t.context.cloudError,'');assert.equal(t.stats.renders,0);assert.equal(t.stats.paints,1);
});

test('real cloud sync removes rendered options after a manual answer has already been persisted',async()=>{
 const d=draft(),opened=lifeSchedule(START,d)[0],chosen=chooseLife(d,0,opened+1000,0).draft,now=opened+5000,previous=cloud(chosen,opened+1000),next=cloud(chosen,now),t=fixture({previous,next,now,question:{dataset:{choiceIndex:'0'}}});
 await t.run();assert.equal(t.context.cloudError,'');assert.equal(t.stats.renders,1,'answered question cannot retain active-looking choices');
});
