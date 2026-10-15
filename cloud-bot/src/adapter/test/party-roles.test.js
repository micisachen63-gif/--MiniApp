import test from 'node:test';import assert from 'node:assert/strict';
import {partyCaption} from '../party-caption.js';
import {createPartyFlow} from '../rpg-party-flow.js';
const p={id:'p123456789012345',kind:'dungeon',status:'combat',rev:1,name:'星穹神藏',floor:1,round:4,roundSeconds:15,enemy:{hp:6000,maxHp:9000},log:['先支援，再壓制'],briefing:{ready:true,phases:[]},members:[{id:'111',name:'試煉旅人',level:120,hp:800,maxHp:1000,roles:['breach','control']}],cooperation:{name:'失序咒印',cleared:1,total:3,roles:['aid','control'],progress:{aid:'222'},roundsLeft:2},me:{actor:{id:'111',name:'試煉旅人',hp:800,mp:100,maxMp:100,special:{loadout:[]}},roleSkills:[{id:'role_breach',name:'拆解要害',mp:10},{id:'role_control',name:'暗影截脈',mp:10}]}};
test('group caption exposes duties, progress and real timing without obsolete default-defense text',()=>{
 const text=partyCaption(p);assert.match(text,/破解 1\/3/);assert.match(text,/✅支援 ○壓制/);assert.match(text,/尚餘 2 回合/);assert.match(text,/15 秒/);assert.doesNotMatch(text,/預設防禦/);assert.ok(text.length<=1024);
 assert.match(partyCaption({...p,status:'won',cooperation:{...p.cooperation,complete:true}}),/自動存入背包/);
 assert.match(partyCaption({...p,status:'lobby',cooperation:null,briefing:{ready:false,phases:[{roles:['guard','aid','control']}]}}),/分工待補/);
});
test('group skill menu has direct role callbacks and forwards server-validated round and request id',async()=>{
 const sent=[],calls=[],state={};
 const flow=createPartyFlow({api:{call:async()=>true},client:{call:async(path,b)=>{calls.push({path,b});return path.endsWith('/get')?{party:p}:path.endsWith('/me')?{skills:[]}:{ok:true};}},send:async(text,options,tg)=>{sent.push({text,options,tg});return {message_id:1};},popup:async()=>{},st:()=>state,save:()=>{},chatId:'fixture',deepLink:()=>null,appBtn:()=>null,now:()=>1,warn:()=>{}});
 const cq={id:'unique',from:{id:111},message:{chat:{id:111},message_id:2}};
 await flow.handle(cq,'ps',p.id);assert.equal(sent[0].tg,'111');assert.match(sent[0].options.reply_markup.inline_keyboard[1][0].callback_data,/\.4\.role_control\.0$/);
 await flow.handle(cq,'pz',`${p.id}.4.role_control.0`);const action=calls.find(c=>c.path.endsWith('/action'));
 assert.equal(action.b.skillId,'role_control');assert.equal(action.b.round,4);assert.equal(action.b.tgId,'111');assert.equal(action.b.requestId,'party-cq-unique');
});
