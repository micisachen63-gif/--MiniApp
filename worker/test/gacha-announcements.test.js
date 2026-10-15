import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import * as P from '../src/services/player.js';
import {shareView} from '../src/services/share.js';
import {T0} from './helpers.js';
for(const type of ['weapon','armor'])for(const red of [false,true])test(`${type} ${red?'red':'purple'} capsule announcement is atomic and deduplicated`,async()=>{
 const env={DB:freshDb()};await P.createCharacter(env,{tgId:'991',name:'轉蛋勇者',gender:'f',baseClass:'mage'},T0);
 await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,2)').bind('991','gacha_'+type).run();
 const random=()=>{let n=0;return()=>n++===0?0:n===2?(red?.99:.1):.5;};
 const open=()=>P.withPlayer(env,'991',T0,(w,c)=>P.openGacha(w,c,{type,requestId:'announce-once'},random()));
 await open();
 const shares=(await env.DB.prepare('SELECT id,equip_id FROM rpg_shares').all()).results;
 assert.equal(shares.length,red?1:0);
 if(red){const sh=await shareView(env,shares[0].id);assert.equal(sh.context.source,'gacha');assert.equal(sh.context.type,type);assert.equal(sh.ownerName,'轉蛋勇者');assert.equal(sh.item.rarity,'supreme');assert.match(sh.item.photo,/supreme\.jpg$/);assert.equal(sh.showcase,true);assert.equal(sh.requestable,false);}
 const count=async()=>env.DB.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='share' AND target='group'").first();
 assert.equal((await count()).n,red?1:0);
 await assert.rejects(open(),e=>e.code==='duplicate');
 assert.equal((await count()).n,red?1:0);
 assert.equal((await env.DB.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').bind('991','gacha_'+type).first()).quantity,1);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_equipment WHERE tg_id=?').bind('991').first()).n,3);
});
