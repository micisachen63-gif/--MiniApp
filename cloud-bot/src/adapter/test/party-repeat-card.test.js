import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyFlow} from '../rpg-party-flow.js';

const party=(id,run,rev=0)=>({id,cardRootId:'original',cardLatestId:id,cardRun:run,rev,battleTurn:{id:'turn-'+rev},status:'combat',kind:'dungeon',name:'愛琴深窟',round:1,floor:1,enemy:{hp:100,maxHp:100},members:[],log:[]});
function fixture(extra={}){
 let state=extra.state||{},clock=100000;const sends=[],edits=[],calls=[];
 const make=()=>createPartyFlow({api:{sendAnimation:async b=>{sends.push(b);return {message_id:88};},sendPhoto:async b=>{sends.push(b);return {message_id:88};},editMessageMedia:async b=>{edits.push(b);await extra.edit?.(b);},call:async(method,b)=>{calls.push({method,b});await extra.caption?.(method,b);}},client:{call:async(path,b)=>extra.call?.(path,b)||{ok:true}},send:async()=>assert.fail('unexpected new text'),popup:async()=>{},st:()=>state,save:()=>{},chatId:'fixture',deepLink:s=>'https://example.test/'+s,appBtn:()=>null,now:()=>clock,warn:()=>{},animationRenderer:async()=>new Uint8Array([71,73,70]),renderPartyCard:async()=>new Uint8Array([137,80,78,71]),...extra.options});
 return {make,sends,edits,calls,state,tick:()=>clock+=11000};
}

test('a new battle with a lower revision edits the existing card and stale high-revision old battle cannot overwrite it',async()=>{
 const f=fixture(),flow=f.make();await flow.deliver({kind:'party_card',payload:{party:party('original',1,80)}});f.tick();await flow.deliver({kind:'party_card',payload:{party:party('second',2,0)}});
 assert.equal(f.sends.length,1);assert.equal(f.edits.length,1);assert.match(f.edits[0].caption,/第 2 場/);assert.equal(f.edits[0].messageId,88);
 f.tick();await flow.deliver({kind:'party_card',payload:{party:party('original',1,100)}});assert.equal(f.edits.length,1);assert.equal(f.state.partyCards.original.lastPartyId,'second');
});

test('an in-flight old edit queues the next battle under the same card and flush after restart uses the new callbacks',async()=>{
 let release,started;const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);let hold=false;
 const f=fixture({edit:async()=>{if(hold){started();await gate;}}}),flow=f.make();await flow.deliver({kind:'party_card',payload:{party:party('original',1,1)}});f.tick();hold=true;
 const pending=flow.deliver({kind:'party_card',payload:{party:party('original',1,2)}});await begun;await flow.deliver({kind:'party_card',payload:{party:party('second',2,0)}});assert.equal(f.state.dirtyParty[0][1].id,'second');release();await pending;
 f.tick();await f.make().flush();assert.equal(f.sends.length,1);assert.equal(f.state.dirtyParty.length,0);assert.equal(f.state.partyCards.original.lastRun,2);assert.match(JSON.stringify(f.edits.at(-1).replyMarkup),/pv:second/);assert.doesNotMatch(JSON.stringify(f.edits.at(-1).replyMarkup),/pv:original/);
});

test('a deferred animation edit must not replace a queued newer battle',async()=>{
 let release,started;const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);let hold=false;
 const f=fixture({edit:async()=>{if(hold){started();await gate;}}}),flow=f.make();await flow.deliver({kind:'party_card',payload:{party:party('original',1,1)}});
 // Force refresh avoids the five-second throttle, but the ten-second GIF defer remains.
 f.state.partyCards.original.lastEdit=0;f.state.partyCards.original.animation=false;f.state.partyCards.original.lastAnimationKey='different';hold=true;
 const pending=flow.deliver({kind:'party_card',payload:{party:party('original',1,2)}});await begun;await flow.deliver({kind:'party_card',payload:{party:party('second',2)}});release();await pending;
 assert.equal(f.state.dirtyParty[0][1].id,'second');f.tick();await f.make().flush();assert.match(f.edits.at(-1).caption,/第 2 場/);assert.equal(f.sends.length,1);
});

test('restoring only the server message address edits the old message and duplicate persisted dirty work is drained',async()=>{
 const f=fixture(),flow=f.make(),p={...party('second',2),chatId:'fixture',messageId:88};await flow.deliver({kind:'party_card',payload:{party:p}});assert.equal(f.sends.length,0);assert.equal(f.edits.length,1);
 f.state.dirtyParty=[['original',p]];f.tick();await f.make().flush();assert.equal(f.edits.length,1);assert.equal(f.state.dirtyParty.length,0);
});

test('a missing or uncertain Telegram edit does not repost a second group card',async()=>{
 for(const definite of [true,false]){
  const f=fixture({edit:async()=>{throw Object.assign(Error('message missing or uncertain'),{definite});},caption:async()=>{throw Error('caption unavailable');}}),p={...party('second',2),chatId:'fixture',messageId:88};
  await assert.rejects(f.make().deliver({kind:'party_card',payload:{party:p}}));assert.equal(f.sends.length,0);assert(f.calls.every(x=>x.method.startsWith('edit')));
 }
});
