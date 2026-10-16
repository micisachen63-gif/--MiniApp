import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpgFlow} from '../rpg-flow.js';
const APP='https://elf-rpg-api.micisachen.workers.dev/',AT=Date.parse('2026-10-16T10:00:00+08:00');
function setup({status,error,main=false,index=0}={}){
 let clock=AT,fail=error;const calls=[],sent=[],store={data:{rpg:{}},save(){}},event={lifeId:'life1',charId:'char1',accountId:'123456789',name:'星<燈>',index,age:18,title:'要把信送去哪裡？',text:'遠方有一封未寄出的信。',deadline:AT+90000};
 const item={id:1,target:'group',kind:'fate_event',claimToken:'claim',payload:{...event,name:'STALE',accountId:'888',date:'1998-11-03',time:'10:30',place:'台北'}};
 const api={call:async(method,body)=>{sent.push({method,body});if(fail){const e=fail;fail=null;throw e;}return {message_id:71};}};
 const rpgApi={call:async(path,body)=>{calls.push({path,body});if(path==='/rpg/outbox/claim')return {items:[item]};if(path==='/rpg/fate/notification')return status||{ok:true,valid:true,night:false,pending:true,remainingMs:event.deadline-clock,payload:event};return {ok:true};}};
 const make=()=>createRpgFlow({api,rpgApi,send:async()=>assert.fail('photo notification fell back to text'),answer:async()=>{},chatId:'-100123',appUrl:APP,botUsername:()=>'StarJournalRpgBot',mainMiniApp:main,tgStore:store,log:{warn(){},info(){}},now:()=>clock,inGroup:()=>true,inUserPrivate:()=>false});
 return {make,calls,sent,store,event,clock:value=>{clock=value;}};
}
test('fate sends canonical illustrated event with account mention, live countdown and game links once across restart',async()=>{
 const t=setup();await t.make().tick({forceOutbox:true});const photo=t.sent[0];assert.equal(photo.method,'sendPhoto');assert.equal(photo.body.photo,APP+'art/fate-chapter-20261016/share.jpg');
 assert.match(photo.body.caption,/tg:\/\/user\?id=123456789/);assert.match(photo.body.caption,/星&lt;燈&gt;/);assert.match(photo.body.caption,/18 歲/);assert.match(photo.body.caption,/剩餘 90 秒/);assert.ok(!/1998|10:30|台北|STALE|888/.test(photo.body.caption));
 assert.deepEqual(photo.body.reply_markup.inline_keyboard.map(row=>row[0].url),['https://t.me/StarJournalRpgBot?start=rpgfate','https://t.me/StarJournalRpgBot?start=rpg']);
 await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,1);assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/ack'));
});
test('main MiniApp fate card opens fate directly',async()=>{const t=setup({main:true});await t.make().tick({forceOutbox:true});assert.equal(t.sent[0].body.reply_markup.inline_keyboard[0][0].url,'https://t.me/StarJournalRpgBot?startapp=fate');});

test('v7 fourth through ninth decisions are actually delivered once; out-of-range notices are rejected',async()=>{for(const index of [3,5,8]){const t=setup({index});await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,1);await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,1);assert.ok(t.store.data.rpg.fateCards['life1:'+index]);}const bad=setup({index:9});await bad.make().tick({forceOutbox:true});assert.equal(bad.sent.length,0);});
test('answered, mismatched and expired fate events are acknowledged without sending',async()=>{
 for(const status of [{valid:false,night:false,pending:false},{valid:true,remainingMs:0,payload:{deadline:AT}},{valid:true,remainingMs:90000,payload:{deadline:AT-1,accountId:'123'}}]){const t=setup({status});await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,0);assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/ack'));}
});
test('night pending event waits until six without being discarded; answered night event is discarded',async()=>{
 const night=Date.parse('2026-10-17T02:00:00+08:00'),retryAt=Date.parse('2026-10-17T06:00:00+08:00');
 const t=setup({status:{valid:false,night:true,pending:true,retryAt,remainingMs:30000}});t.clock(night);await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,0);const failed=t.calls.find(c=>c.path==='/rpg/outbox/fail');assert.equal(failed.body.errorCode,429);assert.equal(failed.body.retryAfterSeconds,14400);assert.ok(!t.calls.some(c=>c.path==='/rpg/outbox/ack'));
 const done=setup({status:{valid:false,night:false,pending:false}});done.clock(night);await done.make().tick({forceOutbox:true});assert.ok(done.calls.some(c=>c.path==='/rpg/outbox/ack'));
});
test('unknown Telegram delivery persists uncertainty and never sends fallback or duplicate after restart',async()=>{
 const t=setup({error:Object.assign(Error('response lost'),{definite:false})});await t.make().tick({forceOutbox:true});await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,1);assert.equal(t.store.data.rpg.fateCards['life1:0'].uncertain,true);assert.equal(t.calls.filter(c=>c.path==='/rpg/outbox/fail').length,2);assert.ok(!t.calls.some(c=>c.path==='/rpg/outbox/ack'));
});
test('definite Telegram rejection leaves event retryable under outbox backoff',async()=>{
 const t=setup({error:Object.assign(Error('rate limited'),{definite:true,errorCode:429,parameters:{retry_after:5}})});await t.make().tick({forceOutbox:true});assert.equal(t.store.data.rpg.fateCards['life1:0'],undefined);await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,2);assert.equal(t.store.data.rpg.fateCards['life1:0'].messageId,71);
});
test('delayed fate notification displays actual deadline remainder instead of restarting its 90-second choice',async()=>{
 const t=setup({status:{ok:true,valid:true,night:false,pending:true,remainingMs:90000,payload:{lifeId:'life1',index:0,accountId:'123456789',name:'旅人',deadline:AT+90000}}});
 t.clock(AT+62000);await t.make().tick({forceOutbox:true});assert.match(t.sent[0].body.caption,/剩餘 28 秒/);assert.ok(!/剩餘 90 秒/.test(t.sent[0].body.caption));
 assert.ok(t.calls.findIndex(c=>c.path==='/rpg/fate/notification')<t.calls.findIndex(c=>c.path==='/rpg/party/tick'));
});
test('variable-lifespan fate notification preserves the actual age beyond ninety',async()=>{
 const t=setup();t.event.age=103;await t.make().tick({forceOutbox:true});assert.match(t.sent[0].body.caption,/103 歲/);assert.doesNotMatch(t.sent[0].body.caption,/90 歲/);
});
