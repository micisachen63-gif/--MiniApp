import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpgFlow} from '../rpg-flow.js';

function setup({target='dm',error=null,recipient='123456789'}={}){
 const item={id:991,target,tgId:recipient,kind:'star_ring_complete',claimToken:'claim-ring',payload:{partyId:'ring:test',recipientCharId:'hero-two',name:'白色毛衣',completedStages:6,rewards:{exp:12000,items:{star_ring_token:12,scroll_w:2},equipment:[{id:'gear'}]}}};
 const photos=[],texts=[],calls=[],store={data:{rpg:{}},save(){}};
 const flow=createRpgFlow({api:{call:async(method,body)=>{photos.push({method,body});if(error)throw error;return {message_id:42};}},rpgApi:{call:async(path,body)=>{calls.push({path,body});return path==='/rpg/outbox/claim'?{items:[item]}:{ok:true};}},send:async(text,options,chat)=>{texts.push({text,options,chat});return {message_id:43};},answer:async()=>{},chatId:'-100777',appUrl:'https://elf-rpg-api.micisachen.workers.dev/',botUsername:()=>'StarJournalRpgBot',tgStore:store,log:{warn(){},info(){}},now:()=>180000,inGroup:()=>true,inUserPrivate:()=>false});
 return {flow,photos,texts,calls};
}
test('long expedition completion privately sends original art, rewards and a direct battle-screen button only once',async()=>{
 const h=setup();await h.flow.tick({forceOutbox:true});assert.equal(h.photos.length,1);
 const {body}=h.photos[0];assert.equal(body.chat_id,'123456789');assert.match(body.photo,/star-ring-20261018\/background.jpg$/);
 assert.match(body.caption,/白色毛衣/);assert.match(body.caption,/12,000/);assert.match(body.caption,/星征徽記 ×12/);assert.match(body.caption,/裝備 ×1/);
 const link=new URL(body.reply_markup.inline_keyboard[0][0].web_app.url);assert.equal(link.searchParams.get('screen'),'star-ring');assert.equal(link.searchParams.get('ringParty'),'ring:test');assert.equal(link.searchParams.get('ringChar'),'hero-two');
 await h.flow.tick({forceOutbox:true});assert.equal(h.photos.length,1);assert.equal(h.texts.length,0);assert.ok(h.calls.some(c=>c.path==='/rpg/outbox/ack'));
});
test('group or invalid expedition destinations are never broadcast',async()=>{
 for(const options of [{target:'group'},{recipient:'hero-two'}]){const h=setup(options);await h.flow.tick({forceOutbox:true});assert.equal(h.photos.length+h.texts.length,0);}
});
test('private 403 and uncertain sends never fall back to the group or duplicate an uncertain photo',async()=>{
 for(const error of [Object.assign(Error('Forbidden'),{definite:true,errorCode:403,description:'Forbidden: bot cannot initiate conversation'}),Error('network lost')]){
  const h=setup({error});await h.flow.tick({forceOutbox:true});assert.equal(h.photos.length,1);assert.equal(h.texts.length,0);
  assert.ok(!h.calls.some(c=>c.path==='/rpg/outbox/ack'));assert.equal(h.photos[0].body.chat_id,'123456789');
  if(!error.definite){await h.flow.tick({forceOutbox:true});assert.equal(h.photos.length,1);}
 }
});
test('a definitely rejected image falls back to readable private text with the same button',async()=>{
 const h=setup({error:Object.assign(Error('image'),{definite:true,errorCode:400,description:'Bad Request: failed to get HTTP URL content'})});
 await h.flow.tick({forceOutbox:true});assert.equal(h.texts.length,1);assert.equal(h.texts[0].chat,'123456789');assert.match(h.texts[0].text,/星環遠征/);
});
