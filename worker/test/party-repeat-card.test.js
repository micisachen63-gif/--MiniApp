import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {createPartyFlow} from '../../cloud-bot/src/adapter/rpg-party-flow.js';

async function setup(t){
 const env={DB:freshDb(),SERVICE_SECRET:'card-test-secret',ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true'};
 t.after(()=>env.DB.sqlite.close());let now=T0;
 for(const id of ['111','222','333']){
  await P.createCharacter(env,{tgId:id,name:'連刷'+id,baseClass:'sword',gender:'m'},now);
  env.DB.sqlite.prepare("UPDATE rpg_characters SET level=60,class_path='B1' WHERE tg_id=?").run(id);
  const p=await loadPlayer(env.DB,id),s=computeStats(p.char,p.equipment);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(s.maxHp,s.maxMp,id);
 }
 const call=async(path,b={})=>{const res=await handle(new Request('http://local'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Service-Secret':env.SERVICE_SECRET,'X-Debug-Now':String(now)},body:JSON.stringify(b)}),env);const r=await res.json();assert.equal(res.status,200,JSON.stringify(r));return r;};
 const create=async()=>{const id=(await G.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},now)).party.id;for(const id2 of ['222','333'])await G.action(env,id2,{partyId:id,op:'join'},now);for(const id2 of ['111','222','333'])await G.action(env,id2,{partyId:id,op:'ready'},now);return (await G.action(env,'111',{partyId:id,op:'start'},now)).party;};
 const win=async id=>{for(let i=0;i<50;i++){const p=await G.view(env,id,'111',now);if(p.status!=='combat'){assert.equal(p.status,'won');return p;}now=p.deadline;}assert.fail('not finished');};
 return {env,call,create,win,view:id=>G.view(env,id,'111',now),repeat:(id,key)=>G.action(env,'111',{partyId:id,op:'repeat',requestId:key},now),tick:()=>now+=11000,clock:()=>now};
}

test('three real battles edit one Telegram card, use current buttons, and retain all independent rewards across BOT restart',async t=>{
 const f=await setup(t),sent=[],edits=[];let state={};
 const make=()=>createPartyFlow({api:{sendPhoto:async b=>{sent.push(b);return {message_id:88};},editMessageMedia:async b=>edits.push(b)},client:{call:f.call},send:async()=>assert.fail('new text message'),popup:async()=>{},st:()=>state,save:()=>{},chatId:'fixture',deepLink:s=>'https://example.test/'+s,appBtn:()=>null,now:f.clock,warn:()=>{},renderPartyCard:async()=>new Uint8Array([137,80,78,71])});
 let flow=make(),p=await f.create(),root=p.id;await flow.deliver({kind:'party_card',payload:{party:p}});assert.equal(sent.length,1);assert.match(sent[0].caption,/第 1 場/);
 for(let n=1;n<=3;n++){
  p=await f.win(p.id);f.tick();await flow.deliver({kind:'party_card',payload:{party:p}});
  assert.equal(p.cardRun,n);assert.equal(p.cardRootId,root);
  if(n<3){const before=f.env.DB.sqlite.prepare('SELECT * FROM rpg_party_rewards ORDER BY party_id,char_id').all();p=(await f.repeat(p.id,'again-'+n)).party;f.tick();state=JSON.parse(JSON.stringify(state));flow=make();await flow.deliver({kind:'party_card',payload:{party:p}});assert.deepEqual(f.env.DB.sqlite.prepare('SELECT * FROM rpg_party_rewards ORDER BY party_id,char_id').all(),before);}
 }
 assert.equal(sent.length,1);assert(edits.length>=5);assert(edits.every(e=>e.messageId===88));assert.match(edits.at(-1).caption,/第 3 場/);
 assert(edits.at(-1).replyMarkup.inline_keyboard.flat().some(b=>b.callback_data==='rpg:pr:'+p.id));assert(edits.at(-1).replyMarkup.inline_keyboard.flat().some(b=>b.url?.endsWith('party_'+p.id)));
 const rows=f.env.DB.sqlite.prepare('SELECT * FROM rpg_party_rewards').all();assert.equal(rows.length,9);assert.equal(new Set(rows.map(r=>r.party_id+':'+r.char_id)).size,9);
 for(const id of ['111','222','333'])assert.equal((await loadPlayer(f.env.DB,id)).inv.research_fragment,24);
 const old=(await f.call('/rpg/party/get',{partyId:root,currentCard:true})).party;assert.equal(old.id,p.id);assert.equal((await f.view(root)).id,root);
 const before=edits.length;f.tick();await flow.handle({id:'refresh-old',from:{id:111},message:{chat:{id:'fixture'},message_id:88}},'pv',root);assert(edits.length>=before);assert.equal(sent.length,1);
 const fresh=(await f.create());f.tick();await flow.deliver({kind:'party_card',payload:{party:fresh}});assert.equal(sent.length,2);assert.match(sent.at(-1).caption,/第 1 場/);assert.equal(fresh.cardRootId,fresh.id);
});

test('delayed first message association and queued old outbox cards resolve to the latest battle',async t=>{
 const f=await setup(t),first=await f.create();await f.win(first.id);const next=(await f.repeat(first.id,'next')).party;
 await G.setMessage(f.env,{partyId:first.id,chatId:'fixture',messageId:77});assert.equal((await f.view(next.id)).messageId,77);
 const claimed=await f.call('/rpg/outbox/claim',{limit:50});const cards=claimed.items.filter(x=>x.kind==='party_card');assert(cards.length>0);assert(cards.every(x=>x.payload.party.id===next.id));
 await G.setMessage(f.env,{partyId:next.id,chatId:'fixture',messageId:77});assert.equal((await f.view(first.id)).messageId,77);
});

test('overlapping repeat requests create one successor and one monotonically numbered card; a failed repeat does not move it',async t=>{
 const f=await setup(t),first=await f.create();await f.win(first.id);const next=await Promise.all([f.repeat(first.id,'a'),f.repeat(first.id,'b')]);assert.equal(next[0].party.id,next[1].party.id);assert.equal(next[0].party.cardRun,2);
 await f.win(next[0].party.id);const state=JSON.parse(f.env.DB.sqlite.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(first.id).state_json);assert.equal(state.cardLatestId,next[0].party.id);
 await f.env.DB.prepare("UPDATE rpg_characters SET hp=0 WHERE tg_id='222'").run();await assert.rejects(f.repeat(next[0].party.id,'bad'),e=>e.code==='down');assert.equal((await G.cardView(f.env,first.id,null,f.clock())).id,next[0].party.id);
 assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_parties').get().n,2);
});
