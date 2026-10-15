import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {handle} from '../src/index.js';
import {taipeiAt} from '../src/game/time.js';
import {canEquip} from '../src/game/gear.js';
const SECRET='gacha-test-secret',NOW=taipeiAt('2026-10-10',14);
function fixture(){const env={DB:freshDb(),SERVICE_SECRET:SECRET,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true',GROUP_CHAT_ID:'-100123'};return {sql:(q,...v)=>env.DB.sqlite.prepare(q).run(...v),one:(q,...v)=>env.DB.sqlite.prepare(q).get(...v),call:async(path,body)=>{const r=await handle(new Request('http://rpg'+path,{method:'POST',headers:{'content-type':'application/json','X-Service-Secret':SECRET,'X-Debug-Now':String(NOW)},body:JSON.stringify(body)}),env);return r.json();}}}
for(const type of ['weapon','armor'])test(`${type}: sealed purchase, current-level opening and idempotency`,async()=>{
 const {call,sql,one}=fixture(),tgId='91001',price=type==='weapon'?10000:5000,key='gacha_'+type;
 assert.equal((await call('/rpg/create',{tgId,name:'轉蛋測試',gender:'f',baseClass:'mage'})).ok,true);
 sql('UPDATE rpg_characters SET gold=100000 WHERE tg_id=?',tgId);
 const buy={tgId,type,requestId:'purchase'};
 const bought=await call('/rpg/gacha',buy);assert.equal(bought.ok,true);assert.equal(bought.character.gold,100000-price);assert.equal(bought.inventory[key],1);assert.equal(bought.equipment.length,2);assert.equal(bought.result.item,undefined);
 assert.equal((await call('/rpg/gacha',buy)).error,'duplicate');assert.equal(one('SELECT gold FROM rpg_characters WHERE tg_id=?',tgId).gold,100000-price);
 assert.equal(one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?',tgId,key).quantity,1);
 // Buying at level 1 and opening at level 35 must use tier 4 and the current mage branch.
 sql("UPDATE rpg_characters SET level=35,class_path='A' WHERE tg_id=?",tgId);
 const open={tgId,type,requestId:'open'},opened=await call('/rpg/gacha/open',open);
 assert.equal(opened.ok,true);assert.equal(opened.inventory[key],0);assert.equal(opened.character.gold,100000-price);assert.equal(opened.equipment.length,3);
 const item=opened.result.item;assert.equal(item.tier,4);assert.ok(['legendary','supreme'].includes(item.element_tier));assert.equal(canEquip({tg_id:tgId,base_class:'mage',class_path:'A',level:35},item),null);
 if(type==='weapon')assert.equal(item.slot,'weapon');else assert.ok(['armor','helmet','gloves','boots','belt','undershirt'].includes(item.slot));
 assert.equal((await call('/rpg/gacha/open',open)).error,'no_gacha');
 // Retrying the old opening while another capsule exists must roll back consumption and equipment creation.
 assert.equal((await call('/rpg/gacha',{...buy,requestId:'purchase2'})).ok,true);
 assert.equal((await call('/rpg/gacha/open',open)).error,'duplicate');
 assert.equal(one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?',tgId,key).quantity,1);
 assert.equal(one('SELECT COUNT(*) n FROM rpg_equipment WHERE tg_id=?',tgId).n,3);
 sql('UPDATE rpg_characters SET gold=0 WHERE tg_id=?',tgId);
 assert.equal((await call('/rpg/gacha',{tgId,type,requestId:'poor'})).error,'gold');
 assert.equal((await call('/rpg/gacha/open',{tgId,type:'relic',requestId:'invalid'})).error,'gacha_type');
});
