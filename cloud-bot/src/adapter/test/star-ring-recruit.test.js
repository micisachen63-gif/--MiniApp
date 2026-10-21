import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpgFlow} from '../rpg-flow.js';
import {createStarRingRecruitFlow} from '../star-ring-recruit.js';

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
 const button=body.reply_markup.inline_keyboard[0][0];assert.equal(button.text,'加入並準備');assert.equal(button.web_app,undefined);assert.equal(button.url,undefined);assert.equal(button.callback_data,'rpg:rj:'+'a'.repeat(32));
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
 assert.equal(h.texts.length,1);assert.equal(h.texts[0].chat,'-100777');assert.equal(h.texts[0].options.reply_markup.inline_keyboard[0][0].callback_data,'rpg:rj:'+'a'.repeat(32));
 h.party.rev++;await h.make().tick({forceOutbox:true});assert.equal(h.requests.at(-1).method,'editMessageText');
});
test('uncertain sends cannot duplicate across persisted restarts and are not acknowledged as delivered',async()=>{
 const h=setup({error:Error('connection lost')});await h.make().tick({forceOutbox:true});await h.make().tick({forceOutbox:true});
 assert.equal(h.requests.length,1);assert.equal(h.texts.length,0);assert.ok(!h.calls.some(x=>x.path==='/rpg/outbox/ack'));assert.ok(h.calls.some(x=>x.path==='/rpg/outbox/fail'));
});
test('existing legacy URL button is repaired in place at the same room revision, and not re-edited on subsequent maintenance',async()=>{
 const h=setup(),state={starRingRecruitCards:{[id]:{chatId:'-100777',messageId:42,photo:true,rev:0,at:1}}},edits=[],reads=[];
 const flow=createStarRingRecruitFlow({st:()=>state,save(){},chatId:'-100777',botUsername:()=>'StarJournalRpgBot',appUrl:'https://game.test/',deepLink:s=>'https://t.me/StarJournalRpgBot?start=rpg'+s,now:()=>180000,warn(){},client:{call:async(path,b)=>{reads.push(path);return {ok:true,party:h.party};}},api:{call:async(method,b)=>edits.push({method,b})},send:async()=>assert.fail('must edit original card')});
 await flow.repair();assert.equal(edits.length,1);assert.equal(edits[0].method,'editMessageCaption');assert.equal(edits[0].b.message_id,42);assert.equal(edits[0].b.reply_markup.inline_keyboard[0][0].callback_data,'rpg:rj:'+'a'.repeat(32));await flow.repair();assert.equal(edits.length,1);assert.equal(reads.length,1);
});
test('running cards use supported private start link when Main Mini App is disabled',async()=>{const h=setup();await h.make().tick({forceOutbox:true});h.party.status='running';h.party.rev++;await h.make().tick({forceOutbox:true});const b=h.requests.at(-1).body.reply_markup.inline_keyboard[0][0];assert.equal(b.callback_data,undefined);assert.equal(new URL(b.url).searchParams.get('start'),'rpgring_'+'a'.repeat(32));});
test('private ring start retains exact target room in a normal authenticated web_app button without joining in the BOT',async()=>{const sent=[],calls=[],flow=createRpgFlow({api:{call:async()=>true},rpgApi:{call:async(path)=>{calls.push(path);return {character:{name:'旅人',className:'劍士',level:60,mapName:'神殿',state:'fighting'}};}},send:async(text,options,chat)=>{sent.push({options,chat});return {message_id:2};},answer:async()=>{},chatId:'-100777',inGroup:()=>false,inUserPrivate:()=>true,appUrl:'https://game.test/',botUsername:()=>'StarJournalRpgBot',mainMiniApp:false,log:{warn(){},info(){}}});await flow.onMessage({chat:{id:111,type:'private'},from:{id:111}},'/start rpgring_'+'a'.repeat(32));assert.equal(new URL(sent[0].options.reply_markup.inline_keyboard[0][0].web_app.url).searchParams.get('screen'),'ring_'+'a'.repeat(32));assert.deepEqual(calls,['/rpg/me']);});
test('foreign chat and nonmember callbacks never call the game admission API',async()=>{for(const inGroup of [false,true]){let calls=0;const flow=createRpgFlow({api:{call:async()=>true},rpgApi:{call:async()=>{calls++;throw Error('must not mutate');}},send:async()=>assert.fail('no new posts'),answer:async()=>{},chatId:'-100777',inGroup:()=>inGroup,inUserPrivate:()=>false,isGroupMember:async()=>false,log:{warn(){},info(){}}});await flow.onCallback({id:'outside',from:{id:111},message:{chat:{id:111},message_id:42}},'rj','a'.repeat(32));assert.equal(calls,0);}});
