import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudBot} from '../src/adapter/cloud-bot.js';
import {hasCountryPack} from '../../worker/public/fate/country-runtime-v9.js';

test('a cold Telegram adapter loads a valid country prologue before the join gate',async()=>{
 const code='f9jp660110010001111110004538453d7';assert.equal(hasCountryPack('JP'),false);
 let member=false;const sent=[],calls=[],state={data:{rpg:{}},save(){}};
 const bot=createCloudBot({config:{active:true,chatId:'-100TEST',botUsername:'StarJournalRpgBot',appUrl:'https://elf-rpg-api.micisachen.workers.dev/',inviteLink:'https://t.me/example'},api:{async call(method,body){sent.push({method,body});return method==='getChatMember'?{status:member?'member':'left'}:{message_id:1};}},store:state,log:{warn(){},info(){}},rpgApi:{async call(path,body){calls.push({path,body});return {ok:true}}},renderBattleAnimation:async()=>[],renderPartyCard:async()=>[]});
 await bot.handle({update_id:1,message:{chat:{id:7,type:'private'},from:{id:7},text:'/start fate_'+code}});
 assert.equal(hasCountryPack('JP'),true);assert.equal(calls.length,0);
 assert.equal(sent.find(x=>x.method==='sendMessage').body.reply_markup.inline_keyboard[1][0].callback_data,'fate_resume:'+code);
 member=true;await bot.handle({update_id:2,callback_query:{id:'resume',from:{id:7},message:{chat:{id:7,type:'private'}},data:'fate_resume:'+code}});
 assert.deepEqual(calls,[{path:'/rpg/app/grant',body:{tgId:'7'}}]);
 const url=new URL(sent.filter(x=>x.method==='sendMessage').at(-1).body.reply_markup.inline_keyboard[0][0].web_app.url);assert.equal(url.searchParams.get('fate'),code);assert.equal(url.searchParams.get('screen'),'fate');
});
