import test from 'node:test';
import assert from 'node:assert/strict';
import {shareCaption,shareKeyboard,createRpgFlow} from '../rpg-flow.js';
const sh={id:'s01234567890',kind:'share',ownerName:'幸運玩家',context:{source:'gacha',type:'armor',showcase:true},showcase:true,requestable:false,likes:3,item:{name:'霸主戰甲',rarity:'supreme',rarityName:'霸主',slot:'armor',slotName:'盔甲',classReq:'mage',tier:4,levelReq:31,photo:'/art/cards/test_supreme.jpg'}};
test('red capsule notice has photo caption and exactly like/draw buttons',()=>{
 const caption=shareCaption(sh);assert.match(caption,/幸運玩家.*防具轉蛋/);assert.match(caption,/霸主戰甲/);assert.doesNotMatch(caption,/我要交易/);
 const buttons=shareKeyboard(sh,{gachaLink:'https://t.me/StarJournalRpgBot?startapp=gacha'}).flat();assert.equal(buttons.length,2);assert.match(buttons[0].text,/超讚/);assert.equal(buttons[0].callback_data,'rpg:sl:'+sh.id);assert.match(buttons[1].text,/我也要抽/);assert.match(buttons[1].url,/startapp=gacha$/);
});
test('group outbox sends the real equipment photo once with a usable gacha link',async()=>{
 const photos=[],calls=[],state={data:{rpg:{}},save(){}},APP='https://rpg.example/';let clock=100000;
 const item={id:81,target:'group',kind:'share',claimToken:'claim',payload:{share:sh}};
 const make=()=>createRpgFlow({api:{call:async(method,body)=>{calls.push({method,body});return {message_id:44}},sendPhoto:async body=>{photos.push(body);return {message_id:44}}},rpgApi:{call:async path=>path==='/rpg/outbox/claim'?{items:[item]}:{ok:true}},send:async()=>assert.fail('photo unexpectedly became text'),answer:async()=>{},chatId:-100123,appUrl:APP,mainMiniApp:true,botUsername:()=>'StarJournalRpgBot',tgStore:state,log:{info(){},warn(){}},now:()=>clock,inGroup:()=>true,inUserPrivate:()=>false});
 await make().tick();const photo=photos[0]||calls.find(c=>c.method==='sendPhoto')?.body;assert.ok(photo);assert.equal(photo.photoUrl,APP+'art/cards/test_supreme.jpg');assert.match(photo.caption,/防具轉蛋/);const buttons=photo.replyMarkup.inline_keyboard[0];assert.equal(buttons.length,2);assert.equal(buttons[1].url,'https://t.me/StarJournalRpgBot?startapp=gacha');
 clock+=31000;await make().tick();assert.equal(photos.length+calls.filter(c=>c.method==='sendPhoto').length,1);
});

test('liking a gacha announcement keeps its draw link and updates the count',async()=>{
 const calls=[],state={data:{rpg:{scards:{[sh.id]:{chatId:-100123,messageId:44,lastEdit:0}}}},save(){}};
 const updated={...sh,likes:4};
 const flow=createRpgFlow({api:{call:async(method,body)=>{calls.push({method,body});return true;}},rpgApi:{call:async()=>({ok:true,liked:true,likes:4,share:updated})},send:async()=>{},answer:async()=>{},chatId:-100123,appUrl:'https://rpg.example/',mainMiniApp:true,botUsername:()=>'StarJournalRpgBot',tgStore:state,log:{info(){},warn(){}},now:()=>100000,inGroup:()=>true,inUserPrivate:()=>false});
 const result=await flow.onCallback({id:'like-gacha',from:{id:992},message:{chat:{id:-100123},message_id:44}},'sl',sh.id);
 assert.equal(result.likes,4);const edit=calls.find(x=>x.method==='editMessageReplyMarkup');assert.ok(edit);const buttons=edit.body.reply_markup.inline_keyboard[0];assert.equal(buttons.length,2);assert.match(buttons[0].text,/超讚 4/);assert.match(buttons[1].url,/startapp=gacha$/);
});
