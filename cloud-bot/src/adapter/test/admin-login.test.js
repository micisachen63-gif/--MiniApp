import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudBot} from '../cloud-bot.js';
import {encodeAdminChallenge} from '../../../../worker/public/admin/pairing.js';

const CHAT='-1004342516953',APP='https://elf-rpg-api.micisachen.workers.dev/';
const CHALLENGE='abcdef0123456789'.repeat(4),TOKEN=encodeAdminChallenge(CHALLENGE),ACCOUNT=712345678;
const start=(id=1,text='/start admin_'+TOKEN,chat={id:ACCOUNT,type:'private'},user={id:ACCOUNT,is_bot:false})=>({update_id:id,message:{message_id:20,chat,from:user,text}});
const callback=(id=2,data='adm:approve:'+TOKEN,chat={id:ACCOUNT,type:'private'},user={id:ACCOUNT,is_bot:false})=>({update_id:id,callback_query:{id:'approval-'+id,from:user,message:{message_id:21,chat},data}});
function fixture({member={status:'administrator',user:{id:ACCOUNT,is_bot:false}},lookupError,worker,telegram}={}){
 const sent=[],calls=[],receipts=new Map(),durable={data:{rpg:{}},save(){},operations:{get:k=>receipts.get(k),put:(k,v)=>receipts.set(k,structuredClone(v))}};
 const api={async call(method,body,options){sent.push({method,body,options});if(telegram)return telegram(method,body,options);if(method==='getChatMember'){if(lookupError)throw lookupError;return structuredClone(member);}return {message_id:21};}};
 const rpgApi={async call(path,body){calls.push({path,body});if(worker)return worker(path,body);return {ok:true,approved:true};}};
 const make=()=>createCloudBot({config:{active:true,chatId:CHAT,botUsername:'StarJournalRpgBot',appUrl:APP,inviteLink:'https://t.me/example'},api,rpgApi,store:durable,log:{warn(){},info(){}},renderBattleAnimation:async()=>[],renderPartyCard:async()=>[]});
 const bot=make(),initial=structuredClone(durable.data.rpg);return {sent,calls,durable,make,bot,initial};
}

for(const command of ['/start','/start@StarJournalRpgBot','/START@starjournalrpgbot'])test('admin link '+command+' sends private matching-code approval without game entry',async()=>{
 const f=fixture();await f.bot.handle(start(1,command+' admin_'+TOKEN));
 assert.equal(f.calls.length,0);assert.equal(f.sent.filter(x=>x.method==='getChatMember').length,1);
 const lookup=f.sent.find(x=>x.method==='getChatMember');assert.deepEqual(lookup.body,{chat_id:CHAT,user_id:ACCOUNT});assert.deepEqual(lookup.options,{timeoutMs:5000,retries429:0});
 const card=f.sent.find(x=>x.method==='sendMessage');assert.equal(card.body.chat_id,ACCOUNT);assert.match(card.body.text,/ABCDEF01/);assert.match(card.body.text,/本人/);assert.match(card.body.text,/瀏覽器/);
 const button=card.body.reply_markup.inline_keyboard[0][0];assert.equal(button.callback_data,'adm:approve:'+TOKEN);assert.ok(new TextEncoder().encode(button.callback_data).length<=64);assert.ok(('admin_'+TOKEN).length<=64);
 assert.deepEqual(f.durable.data.rpg,f.initial);assert.equal(f.durable.operations.get('anything'),undefined);
});
test('admin start for another bot is ignored before membership or gameplay',async()=>{const f=fixture();await f.bot.handle(start(1,'/start@OtherBot admin_'+TOKEN));assert.deepEqual(f.sent,[]);assert.deepEqual(f.calls,[]);});
test('admin login group entry never reveals challenge or creates an approval button',async()=>{
 const f=fixture();await f.bot.handle(start(1,undefined,{id:CHAT,type:'supergroup'}));
 assert.equal(f.calls.length,0);assert.equal(f.sent.length,1);assert.equal(f.sent[0].method,'sendMessage');assert.ok(!f.sent[0].body.text.includes('ABCDEF01'));assert.equal(f.sent[0].body.reply_markup,undefined);
 await f.bot.handle(callback(2,undefined,{id:CHAT,type:'supergroup'}));assert.equal(f.calls.length,0);assert.ok(f.sent.slice(1).every(x=>x.method==='answerCallbackQuery'));
});
test('foreign private chat and bot identities cannot approve',async()=>{
 const f=fixture();await f.bot.handle(callback(1,undefined,{id:800,type:'private'}));await f.bot.handle(callback(2,undefined,undefined,{id:ACCOUNT,is_bot:true}));assert.deepEqual(f.calls,[]);assert.deepEqual(f.sent,[]);
});
for(const member of [{status:'member',user:{id:ACCOUNT,is_bot:false}},{status:'left',user:{id:ACCOUNT,is_bot:false}},{status:'restricted',is_member:true,user:{id:ACCOUNT,is_bot:false}},{status:'administrator',user:{id:999,is_bot:false}},{status:'creator',user:{id:ACCOUNT,is_bot:true}},{status:'administrator'},null])test('fresh start refuses non-authoritative administrator identity '+JSON.stringify(member),async()=>{
 const f=fixture({member});await f.bot.handle(start());assert.equal(f.calls.length,0);const card=f.sent.find(x=>x.method==='sendMessage');assert.match(card.body.text,/管理員/);assert.equal(card.body.reply_markup,undefined);
});
test('creator is allowed and repeated links freshly recheck permissions instead of ordinary membership cache',async()=>{
 let role='creator',lookups=0;const f=fixture({telegram:async method=>method==='getChatMember'?(lookups++,{status:role,user:{id:ACCOUNT,is_bot:false}}):{message_id:21}});
 await f.bot.handle(start(1));role='member';await f.bot.handle(start(2));assert.equal(lookups,2);assert.equal(f.calls.length,0);assert.equal(f.sent.filter(x=>x.method==='sendMessage'&&x.body.reply_markup).length,1);
});
test('failed membership lookup is private, retry-friendly and has no approval/game calls',async()=>{
 const f=fixture({lookupError:Error('secret token must not leak')});await f.bot.handle(start());assert.equal(f.calls.length,0);const card=f.sent.find(x=>x.method==='sendMessage');assert.match(card.body.text,/稍後/);assert.ok(!card.body.text.includes('secret'));assert.equal(card.body.reply_markup,undefined);
});
for(const payload of ['admin_','admin_'+TOKEN.slice(1),'admin_'+TOKEN+'x','admin_'+TOKEN.slice(0,-1)+'R','admin:'+TOKEN,'admin'])test('malformed/noncanonical start payload is consumed without gameplay: '+payload.slice(0,20),async()=>{
 const f=fixture();await f.bot.handle(start(1,'/start '+payload));assert.equal(f.calls.length,0);assert.ok(f.sent.every(x=>x.method==='sendMessage'));assert.match(f.sent[0].body.text,/重新開始/);
});
for(const data of ['adm:approve:','adm:old:'+TOKEN,'adm:approve:'+TOKEN+'x','adm:approve:'+TOKEN.slice(0,-1)+'R'])test('malformed or obsolete approval button is consumed privately: '+data.slice(0,18),async()=>{
 const f=fixture();await f.bot.handle(callback(1,data));assert.equal(f.calls.length,0);assert.ok(f.sent.every(x=>x.method==='answerCallbackQuery'));assert.match(f.sent.at(-1).body.text,/重新開始/);
});
test('approval forwards original Telegram account and exact challenge only, then removes private button',async()=>{
 const f=fixture();f.durable.data.rpg.drafts={[ACCOUNT]:{name:'未完成創角'}};
 await f.bot.handle(callback());assert.deepEqual(f.calls,[{path:'/rpg/admin/login/approve',body:{adminTgId:String(ACCOUNT),challenge:CHALLENGE}}]);
 const edit=f.sent.find(x=>x.method==='editMessageText');assert.equal(edit.body.chat_id,ACCOUNT);assert.equal(edit.body.message_id,21);assert.match(edit.body.text,/已批准/);assert.deepEqual(edit.body.reply_markup,{inline_keyboard:[]});assert.ok(!edit.body.text.includes(CHALLENGE));assert.equal(f.durable.data.rpg.drafts[ACCOUNT].name,'未完成創角');
});
for(const error of [Object.assign(Error('sensitive'),{status:403,code:'forbidden'}),Object.assign(Error('sensitive'),{status:409,code:'challenge'}),Error('sensitive network exception')])test('Worker refusal or uncertain reply never shows approved and preserves retry without game entry '+(error.status||0),async()=>{
 const f=fixture({worker:async()=>{throw error;}});await f.bot.handle(callback());assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/rpg/admin/login/approve');
 const edit=f.sent.find(x=>x.method==='editMessageText');assert.ok(!edit.body.text.includes('已批准'));assert.ok(!edit.body.text.includes('sensitive'));assert.equal(edit.body.reply_markup.inline_keyboard[0][0].callback_data,'adm:approve:'+TOKEN);
});
test('malformed success body cannot produce approved UI',async()=>{
 for(const response of [null,{ok:true},{approved:true},{ok:false,approved:true}]){const f=fixture({worker:async()=>response});await f.bot.handle(callback());assert.ok(!f.sent.find(x=>x.method==='editMessageText').body.text.includes('已批准'));}
});
test('lost approval response may retry same exact challenge after adapter restart without reward/game operation',async()=>{
 let attempt=0;const f=fixture({worker:async()=>{if(++attempt===1)throw Error('reply lost after commit');return {ok:true,approved:true};}});
 await f.bot.handle(callback(1));assert.ok(!f.sent.find(x=>x.method==='editMessageText').body.text.includes('已批准'));
 await f.make().handle(callback(2));assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);assert.ok(f.sent.filter(x=>x.method==='editMessageText').at(-1).body.text.includes('已批准'));assert.deepEqual(f.durable.data.rpg,f.initial);
});
test('duplicate approval delivery is idempotent same challenge/account and only edits original private card',async()=>{
 const f=fixture();await f.bot.handle(callback(9));await f.bot.handle(callback(9));assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);assert.ok(f.sent.every(x=>['answerCallbackQuery','editMessageText'].includes(x.method)));assert.ok(f.sent.filter(x=>x.method==='editMessageText').every(x=>x.body.message_id===21&&x.body.chat_id===ACCOUNT));
});
test('expired Telegram callbacks do not attempt Worker authorization',async()=>{
 const f=fixture({telegram:async method=>{if(method==='answerCallbackQuery')throw Object.assign(Error('query is too old'),{definite:true});return {message_id:21};}});
 assert.deepEqual(await f.bot.handle(callback()),{ignored:'expired callback'});assert.equal(f.calls.length,0);
});
