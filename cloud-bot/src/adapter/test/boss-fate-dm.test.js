import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpgFlow,bossLootText} from '../rpg-flow.js';
const APP='https://elf-rpg-api.micisachen.workers.dev/',AT=Date.parse('2026-10-17T10:00:00+08:00'),CHAT='-100123';
function setup(item,{status,failWith,photoErrors=[],now=AT}={}){
 let clock=now,fail=failWith,errs=[...photoErrors];const calls=[],sent=[],texts=[],photos=[],store={data:{rpg:{}},save(){}};
 const api={call:async(method,body)=>{sent.push({method,body});if(fail){const e=fail;fail=null;throw e;}return {message_id:71};},sendPhoto:async input=>{photos.push(input);const e=errs.shift();if(e)throw e;return {message_id:88};}};
 const rpgApi={call:async(path,body)=>{calls.push({path,body});if(path==='/rpg/outbox/claim')return {items:[item]};if(path==='/rpg/fate/notification')return status;return {ok:true};}};
 const make=()=>createRpgFlow({api,rpgApi,send:async(text,opts,chat)=>{texts.push({text,opts,chat});return {message_id:72};},answer:async()=>{},chatId:CHAT,appUrl:APP,botUsername:()=>'StarJournalRpgBot',tgStore:store,log:{warn(){},info(){}},now:()=>clock,inGroup:()=>true,inUserPrivate:()=>false});
 return {make,calls,sent,texts,photos,store,clock:v=>{clock=v;}};
}
const event={lifeId:'life1',charId:'char1',accountId:'123456789',name:'星<燈>',index:1,age:18,title:'要把信送去哪裡？',text:'遠方有一封未寄出的信。',deadline:AT+90000};
const okStatus={ok:true,valid:true,night:false,pending:true,remainingMs:90000,payload:event};
test('general fate events are private messages: sent to the account chat, no mention tag, acked once',async()=>{
 const t=setup({id:1,target:'dm',tgId:'123456789',kind:'fate_event',claimToken:'c',payload:{lifeId:'life1',index:1}},{status:okStatus});
 await t.make().tick({forceOutbox:true});const p=t.sent[0];assert.equal(p.method,'sendPhoto');assert.equal(p.body.chat_id,'123456789');assert.ok(!/tg:\/\/user/.test(p.body.caption));assert.match(p.body.caption,/星&lt;燈&gt;/);assert.match(p.body.caption,/18 歲/);
 assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/ack'));await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,1);
});
test('a private notice for another account is dropped; 403 is reported as a permanent failure and key is released',async()=>{
 const wrong=setup({id:1,target:'dm',tgId:'999',kind:'fate_event',claimToken:'c',payload:{lifeId:'life1',index:1}},{status:okStatus});await wrong.make().tick({forceOutbox:true});assert.equal(wrong.sent.length,0);
 const e=Object.assign(Error('Forbidden'),{definite:true,errorCode:403,description:'Forbidden: bot can\'t initiate conversation with a user'});
 const t=setup({id:1,target:'dm',tgId:'123456789',kind:'fate_event',claimToken:'c',payload:{lifeId:'life1',index:1}},{status:okStatus,failWith:e});await t.make().tick({forceOutbox:true});
 const failed=t.calls.find(c=>c.path==='/rpg/outbox/fail');assert.equal(failed.body.errorCode,403);assert.ok(!t.calls.some(c=>c.path==='/rpg/outbox/ack'));assert.equal(t.store.data.rpg.fateCards?.['life1:1'],undefined);
});
test('legacy queued group fate events still deliver with a mention',async()=>{
 const t=setup({id:1,target:'group',kind:'fate_event',claimToken:'c',payload:{lifeId:'life1',index:1}},{status:okStatus});await t.make().tick({forceOutbox:true});assert.equal(t.sent[0].body.chat_id,CHAT);assert.match(t.sent[0].body.caption,/tg:\/\/user\?id=123456789/);
});
const cast={lifeId:'life-aaaa0001',accountId:'202',castName:'旅<人>',ownerName:'星燈',thread:'ferry',role:'擺渡人'};
test('cast notice tags the player in the group once, quiet at night',async()=>{
 const t=setup({id:2,target:'group',kind:'fate_cast',claimToken:'c',payload:cast});await t.make().tick({forceOutbox:true});
 assert.equal(t.texts.length,1);assert.equal(t.texts[0].chat,CHAT);assert.match(t.texts[0].text,/tg:\/\/user\?id=202/);assert.match(t.texts[0].text,/旅&lt;人&gt;/);assert.match(t.texts[0].text,/「星燈」/);assert.match(t.texts[0].text,/擺渡人/);assert.equal(t.texts[0].opts.parse_mode,'HTML');
 await t.make().tick({forceOutbox:true});assert.equal(t.texts.length,1);assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/ack'));
 const night=setup({id:2,target:'group',kind:'fate_cast',claimToken:'c',payload:cast},{now:Date.parse('2026-10-17T02:00:00+08:00')});await night.make().tick({forceOutbox:true});
 assert.equal(night.texts.length,0);const failed=night.calls.find(c=>c.path==='/rpg/outbox/fail');assert.equal(failed.body.errorCode,429);assert.equal(failed.body.retryAfterSeconds,14400);
 const bad=setup({id:3,target:'group',kind:'fate_cast',claimToken:'c',payload:{...cast,accountId:'x<1>'}});await bad.make().tick({forceOutbox:true});assert.equal(bad.texts.length,0);
});
const bossBase={id:'b1',mapId:1,name:'月蝕狼王',mapName:'古殿',status:'active',hp:900,maxHp:1000,secondsLeft:600,participants:1,attackWindowMinutes:3,top:[],elementEmoji:'🔥',elementName:'火'};
test('boss spawn card uses the exact boss art by spriteKey and adds the collection material line',async()=>{
 const t=setup({id:1,target:'group',kind:'boss_spawn',claimToken:'c',payload:{boss:{...bossBase,spriteKey:'boss_x13_m01_boss_secondary',collectionMaterialName:'阿耳忒彌斯月桂林首領核心'}}});await t.make().tick({forceOutbox:true});
 assert.equal(t.photos[0].photoUrl,APP+'telegram-media/boss/boss_x13_m01_boss_secondary.jpg');assert.match(t.photos[0].caption,/阿耳忒彌斯月桂林首領核心/);
 const old=setup({id:1,target:'group',kind:'boss_spawn',claimToken:'c',payload:{boss:{...bossBase,id:'b2'}}});await old.make().tick({forceOutbox:true});assert.equal(old.photos[0].photoUrl,APP+'telegram-media/boss-1.jpg');assert.ok(!/首領核心/.test(old.photos[0].caption));
 const evil=setup({id:1,target:'group',kind:'boss_spawn',claimToken:'c',payload:{boss:{...bossBase,id:'b3',spriteKey:'../../x'}}});await evil.make().tick({forceOutbox:true});assert.equal(evil.photos[0].photoUrl,APP+'telegram-media/boss-1.jpg');
});
test('a rejected boss art URL falls back to the old per-map image instead of failing the card',async()=>{
 const e=Object.assign(Error('x'),{definite:true,errorCode:400,description:'Bad Request: failed to get HTTP URL content'});
 const t=setup({id:1,target:'group',kind:'boss_spawn',claimToken:'c',payload:{boss:{...bossBase,spriteKey:'boss_x13_m01_boss_secondary'}}},{photoErrors:[e]});await t.make().tick({forceOutbox:true});
 assert.deepEqual(t.photos.map(p=>p.photoUrl),[APP+'telegram-media/boss/boss_x13_m01_boss_secondary.jpg',APP+'telegram-media/boss-1.jpg']);assert.equal(t.store.data.rpg.cards.b1.messageId,88);
});
test('boss loot text shows the map collection material only when present',()=>{assert.match(bossLootText({mapId:2,collectionMaterialName:'核心甲'}),/🔮 核心甲/);assert.doesNotMatch(bossLootText({mapId:2}),/🔮/);});
