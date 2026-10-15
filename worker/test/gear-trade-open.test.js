import test from 'node:test';import assert from 'node:assert/strict';import {freshDb} from './d1-shim.js';import {T0} from './helpers.js';import * as P from '../src/services/player.js';import {loadPlayer} from '../src/db.js';import {handle} from '../src/index.js';import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';
async function setup(){const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};for(const id of ['111','222'])await P.createCharacter(env,{tgId:id,name:'Hero'+id,gender:'m',baseClass:'sword'},T0);await env.DB.prepare("UPDATE rpg_equipment SET bound=0,is_equipped=0 WHERE tg_id='111' AND slot='weapon'").run();const gear=(await loadPlayer(env.DB,'111')).equipment.find(e=>e.slot==='weapon');
const call=async(tg,path,body)=>{const r=await handle(new Request('http://local/app/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':tg,'X-Debug-Now':String(T0),'X-Monster-Art-Revision':MONSTER_ART_REVISION},body:JSON.stringify(body)}),env);return {status:r.status,j:await r.json()};};return {env,gear,call};}
test('trade/open escrows the gear on side a, a repeated tap cannot open a second window, and rejects equipped/bound gear',async()=>{
 const {env,gear,call}=await setup();
 const r=await call('111','trade/open',{equipId:gear.id,target:{name:'Hero222'},requestId:'r1'});assert.equal(r.status,200,JSON.stringify(r.j));assert.equal(r.j.trade.a.lines.length,1);assert.equal(r.j.trade.a.lines[0].ref,gear.id);
 const again=await call('111','trade/open',{equipId:gear.id,target:{name:'Hero222'},requestId:'r1'});assert.notEqual(again.status,200);
 const n=await env.DB.prepare('SELECT COUNT(*) c FROM rpg_trades').first();assert.equal(n.c,1);
 const dup=await call('111','trade/open',{equipId:gear.id,target:{name:'Hero222'},requestId:'r2'});assert.notEqual(dup.status,200);
 const eq=(await loadPlayer(env.DB,'111')).equipment.find(e=>e.id!==gear.id&&e.slot!=='weapon');
 await env.DB.prepare('UPDATE rpg_equipment SET is_equipped=1 WHERE id=?').bind(eq.id).run();
 const bad=await call('111','trade/open',{equipId:eq.id,target:{name:'Hero222'},requestId:'r3'});assert.notEqual(bad.status,200);
 const self=await call('111','trade/open',{equipId:gear.id,target:{name:'Hero111'},requestId:'r4'});assert.notEqual(self.status,200);
});
