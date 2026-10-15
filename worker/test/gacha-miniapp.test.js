import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {handle} from '../src/index.js';
import {createCharacter} from '../src/services/player.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';
import {canEquip} from '../src/game/gear.js';
const TOKEN='123456789:test-only-miniapp-gacha-token';
function initData(tgId){const fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(tgId),first_name:'測試'})};const secret=createHmac('sha256','WebAppData').update(TOKEN).digest();const data=Object.keys(fields).sort().map(k=>`${k}=${fields[k]}`).join('\n');return new URLSearchParams({...fields,hash:createHmac('sha256',secret).update(data).digest('hex')}).toString();}
for(const type of ['weapon','armor'])test(`Telegram MiniApp ${type}: buy then open using verified current character`,async()=>{
 const tgId='919191',env={DB:freshDb(),BOT_TOKEN:TOKEN,ENVIRONMENT:'production'},key='gacha_'+type,price=type==='weapon'?10000:5000;
 const first=await createCharacter(env,{tgId,name:'轉蛋角色甲',gender:'f',baseClass:'archer'},Date.now());
 const second=await createCharacter(env,{tgId,name:'轉蛋角色乙',gender:'f',baseClass:'mage'},Date.now());
 const secondId=second.char.tg_id;assert.notEqual(first.char.tg_id,secondId);
 await env.DB.prepare("UPDATE rpg_characters SET level=53,class_path='A',gold=20000 WHERE tg_id=?").bind(secondId).run();
 const signed=initData(tgId);
 const call=async(action,body={},auth=signed)=>{const r=await handle(new Request('https://rpg.example/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Init-Data':auth,'X-Monster-Art-Revision':MONSTER_ART_REVISION},body:JSON.stringify(body)}),env);return {status:r.status,...await r.json()};};
 assert.equal((await call('select',{charId:secondId})).ok,true);
 const bought=await call('gacha',{type,selectedCharacterId:secondId,requestId:'purchase-gacha-001'});
 assert.equal(bought.ok,true,JSON.stringify(bought));assert.equal(bought.inventory[key],1);assert.equal(bought.equipment.length,2);assert.equal(bought.character.gold,20000-price);
 // Invalid Telegram auth cannot consume an owned capsule.
 assert.equal((await call('gacha/open',{type,requestId:'invalid-auth-001'},'invalid')).status,401);
 const body={type,selectedCharacterId:secondId,tgId:first.char.tg_id,requestId:'open-gacha-001'};
 const opened=await call('gacha/open',body);
 assert.equal(opened.status,200,JSON.stringify(opened));assert.equal(opened.ok,true);assert.equal(opened.inventory[key],0);assert.equal(opened.equipment.length,3);assert.equal(opened.character.gold,20000-price);
 assert.equal(opened.character.tgId,secondId);assert.equal(opened.result.item.tg_id,secondId);assert.equal(opened.result.item.tier,6);assert.ok(['legendary','supreme'].includes(opened.result.item.element_tier));
 assert.equal(canEquip({tg_id:secondId,base_class:'mage',class_path:'A',level:53},opened.result.item),null);
 // Even with another capsule, repeating the same opening cannot consume or issue twice.
 assert.equal((await call('gacha',{type,selectedCharacterId:secondId,requestId:'purchase-gacha-002'})).ok,true);
 const retry=await call('gacha/open',body);assert.equal(retry.error,'duplicate');
 assert.equal((await env.DB.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').bind(secondId,key).first()).quantity,1);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_equipment WHERE tg_id=?').bind(secondId).first()).n,3);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_equipment WHERE tg_id=?').bind(first.char.tg_id).first()).n,2);
});
