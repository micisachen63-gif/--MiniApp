import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpgFlow} from '../rpg-flow.js';

const id='ring:'+'a'.repeat(32);
function setup({error=null}={}){
 let clock=180000;
 const party={id,status:'lobby',name:'星環遠征 · 初星征途',tier:40,difficulty:'normal',rev:0,expiresAt:clock+1800000,leaderId:'leader',members:[{id:'leader',name:'遠征隊長',level:64,ready:false}]};
 const item={id:991,target:'group',kind:'star_ring_recruit',claimToken:'ring-claim',payload:{partyId:id,party}};
 const requests=[],texts=[],calls=[],store={data:{rpg:{}},save(){}};
 const make=()=>createRpgFlow({api:{call:async(method,body)=>{requests.push({method,body});if(error&&method==='sendPhoto')throw error;return {message_id:42};}},rpgApi:{call:async(path,body)=>{calls.push({path,body});return path==='/rpg/outbox/claim'?{items:[item]}:{ok:true};}},send:async(text,options,chat)=>{texts.push({text,options,chat});return {message_id:43};},answer:async()=>{},chatId:'-100777',appUrl:'https://elf-rpg-api.micisachen.workers.dev/',botUsername:()=>'StarJournalRpgBot',tgStore:store,log:{warn(){},info(){}},now:()=>clock,inGroup:()=>true,inUserPrivate:()=>false});
 return {party,item,requests,texts,calls,make,advance:()=>{clock+=30000;}};
}
test('recruitment sends original art to the group with the exact authenticated room deep link; restart/retry does not repost',async()=>{
 const h=setup();await h.make().tick({forceOutbox:true});assert.equal(h.requests.length,1);
 const {method,body}=h.requests[0];assert.equal(method,'sendPhoto');assert.equal(body.chat_id,'-100777');assert.match(body.caption,/同行 1／5 · 尚缺 4 人/);assert.match(body.caption,/遠征隊長/);assert.match(body.caption,/十二小時/);
 assert.match(body.photo,/star-ring-20261018\/background.jpg$/);
 const button=body.reply_markup.inline_keyboard[0][0];assert.equal(button.text,'加入並準備');assert.equal(button.web_app,undefined);assert.equal(new URL(button.url).searchParams.get('startapp'),'ring_'+'a'.repeat(32));
 await h.make().tick({forceOutbox:true});assert.equal(h.requests.length,1);assert.equal(h.texts.length,0);assert.ok(h.calls.some(x=>x.path==='/rpg/outbox/ack'));
});
test('joins, readiness and closure edit one group card rather than sending new posts',async()=>{
 const h=setup(),flow=h.make();await flow.tick({forceOutbox:true});
 h.party.rev++;h.party.members.push({id:'two',name:'法師夥伴',level:45,ready:true});await flow.tick({forceOutbox:true});
 assert.equal(h.requests[1].method,'editMessageCaption');assert.equal(h.requests[1].body.message_id,42);assert.match(h.requests[1].body.caption,/同行 2／5/);assert.match(h.requests[1].body.caption,/✓ 法師夥伴/);
 h.party.rev++;h.party.status='ended';await h.make().tick({forceOutbox:true});assert.equal(h.requests[2].method,'editMessageCaption');assert.match(h.requests[2].body.caption,/遠征已結束/);assert.equal(h.requests.filter(r=>r.method==='sendPhoto').length,1);
});
test('expired, closed, invalid and private-target recruitment rows never broadcast a fresh invite',async()=>{
 for(const change of [h=>h.party.status='ended',h=>h.party.expiresAt=1,h=>h.item.target='dm',h=>h.item.payload.partyId='ring:bad']){
  const h=setup();change(h);await h.make().tick({forceOutbox:true});assert.equal(h.requests.length+h.texts.length,0);
 }
});
test('definitely rejected images fall back to group text retaining the room link',async()=>{
 const h=setup({error:Object.assign(Error('image'),{definite:true,errorCode:400,description:'Bad Request: failed to get HTTP URL content'})});await h.make().tick({forceOutbox:true});
 assert.equal(h.texts.length,1);assert.equal(h.texts[0].chat,'-100777');assert.match(h.texts[0].options.reply_markup.inline_keyboard[0][0].url,/startapp=ring_/);
 h.party.rev++;await h.make().tick({forceOutbox:true});assert.equal(h.requests.at(-1).method,'editMessageText');
});
test('uncertain sends cannot duplicate across persisted restarts and are not acknowledged as delivered',async()=>{
 const h=setup({error:Error('connection lost')});await h.make().tick({forceOutbox:true});await h.make().tick({forceOutbox:true});
 assert.equal(h.requests.length,1);assert.equal(h.texts.length,0);assert.ok(!h.calls.some(x=>x.path==='/rpg/outbox/ack'));assert.ok(h.calls.some(x=>x.path==='/rpg/outbox/fail'));
});
