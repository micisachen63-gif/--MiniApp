import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpgFlow} from '../rpg-flow.js';
const APP='https://elf-rpg-api.micisachen.workers.dev/',AT=Date.parse('2026-10-16T10:00:00+08:00');
function setup({status,error,main=false,olderJournal=false}={}){
 let clock=AT,fail=error;const calls=[],sent=[],store={data:{rpg:{}},save(){}},event={eventId:'social_abc',ownerAccountId:'123456789',guestAccountId:'223456789',ownerName:'星<燈>',guestName:'羽&"翼',title:'屋頂<花園>',text:'把<種子>留給誰？',deadline:AT+600000};
 const item={id:1,target:'group',kind:'fate_social',claimToken:'claim',payload:{eventId:event.eventId,ownerAccountId:'888',guestAccountId:'999',ownerName:'STALE',date:'1998-11-03'}};
 const api={call:async(method,body)=>{sent.push({method,body});if(fail){const e=fail;fail=null;throw e;}return {message_id:71};}};
 const rpgApi={call:async(path,body)=>{calls.push({path,body});if(path==='/rpg/outbox/claim')return {items:[...(olderJournal?[{id:2,target:'group',kind:'journal_card',claimToken:'claim',payload:{day:'2026-10-16'}}]:[]),item]};if(path==='/rpg/fate/social/notification')return status||{ok:true,valid:true,night:false,pending:true,remainingMs:event.deadline-clock,payload:event};return {ok:true};}};
 const make=()=>createRpgFlow({api,rpgApi,send:async()=>assert.fail('social invitation fell back to text'),answer:async()=>{},chatId:'-100123',appUrl:APP,botUsername:()=>'StarJournalRpgBot',mainMiniApp:main,tgStore:store,log:{warn(){},info(){}},now:()=>clock,inGroup:()=>true,inUserPrivate:()=>false});
 return {make,calls,sent,store,event,clock:value=>{clock=value;}};
}
test('shared fate revalidates live participants and sends one illustrated invitation with escaped genuine mentions',async()=>{
 const t=setup();await t.make().tick({forceOutbox:true});const photo=t.sent[0];assert.equal(photo.method,'sendPhoto');assert.equal(photo.body.photo,APP+'art/fate-chapter-20261016/share.jpg');
 assert.match(photo.body.caption,/tg:\/\/user\?id=123456789/);assert.match(photo.body.caption,/tg:\/\/user\?id=223456789/);assert.match(photo.body.caption,/星&lt;燈&gt;/);assert.match(photo.body.caption,/羽&amp;&quot;翼/);assert.match(photo.body.caption,/屋頂&lt;花園&gt;/);assert.match(photo.body.caption,/剩餘 600 秒/);assert.ok(!/1998|STALE|888|999/.test(photo.body.caption));
 assert.deepEqual(t.calls.find(c=>c.path==='/rpg/fate/social/notification').body,{eventId:'social_abc'});
 assert.deepEqual(photo.body.reply_markup.inline_keyboard.map(row=>row[0].url),['https://t.me/StarJournalRpgBot?start=rpgfate','https://t.me/StarJournalRpgBot?start=rpg']);
 await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,1);assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/ack'));
});
test('shared fate discards stale, mismatched, expired and non-authoritative participants without mentioning anyone',async()=>{
 const base=setup().event;
 for(const status of [{valid:false,pending:false},{valid:true,pending:false,payload:base,remainingMs:600000},{valid:true,pending:true,payload:{...base,eventId:'other'},remainingMs:600000},{valid:true,pending:true,payload:{...base,guestAccountId:base.ownerAccountId},remainingMs:600000},{valid:true,pending:true,payload:{...base,guestAccountId:'7" onmouseover="bad'},remainingMs:600000},{valid:true,pending:true,payload:base,remainingMs:0}]){
  const t=setup({status});await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,0);assert.ok(t.calls.some(c=>c.path==='/rpg/outbox/ack'));
 }
});
test('shared fate night pause defers delivery, and main MiniApp link still opens fate',async()=>{
 const night=Date.parse('2026-10-17T02:00:00+08:00'),retryAt=Date.parse('2026-10-17T06:00:00+08:00');
 const t=setup({status:{valid:false,night:true,pending:true,retryAt,remainingMs:30000}});t.clock(night);await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,0);assert.equal(t.calls.find(c=>c.path==='/rpg/outbox/fail').body.retryAfterSeconds,14400);assert.ok(!t.calls.some(c=>c.path==='/rpg/outbox/ack'));
 const m=setup({main:true});await m.make().tick({forceOutbox:true});assert.equal(m.sent[0].body.reply_markup.inline_keyboard[0][0].url,'https://t.me/StarJournalRpgBot?startapp=fate');
});
test('shared fate persists uncertain send before Telegram and never retries a lost response after restart',async()=>{
 const t=setup({error:Object.assign(Error('response lost'),{definite:false})});await t.make().tick({forceOutbox:true});await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,1);assert.equal(t.store.data.rpg.fateCards['social:social_abc'].uncertain,true);assert.ok(!t.calls.some(c=>c.path==='/rpg/outbox/ack'));
});
test('shared fate only definite Telegram rejection releases the durable intent for leased backoff',async()=>{
 const t=setup({error:Object.assign(Error('rate limited'),{definite:true,errorCode:429,parameters:{retry_after:5}})});await t.make().tick({forceOutbox:true});assert.equal(t.store.data.rpg.fateCards['social:social_abc'],undefined);await t.make().tick({forceOutbox:true});assert.equal(t.sent.length,2);assert.equal(t.store.data.rpg.fateCards['social:social_abc'].messageId,71);
});
test('deadline cards precede older nonurgent cards and expensive housekeeping; fast drain preserves maintenance cadence',async()=>{
 const t=setup({olderJournal:true});await t.make().tick({forceOutbox:true});assert.match(t.sent[0].body.caption,/交織命運/);assert.match(t.sent[1].body.caption,/旅團日誌/);
 assert.ok(t.calls.findIndex(c=>c.path==='/rpg/fate/social/notification')<t.calls.findIndex(c=>c.path==='/rpg/party/tick'));
 t.clock(AT+1000);await t.make().tick({forceOutbox:true});assert.equal(t.calls.filter(c=>c.path==='/rpg/party/tick').length,1);
 t.clock(AT+31000);await t.make().tick({forceOutbox:true});assert.equal(t.calls.filter(c=>c.path==='/rpg/party/tick').length,2);
});
