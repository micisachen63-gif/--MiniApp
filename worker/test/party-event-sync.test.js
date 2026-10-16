import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {specialCost} from '../src/game/combat-passives.js';
import {SKILL_MAP} from '../src/game/special.js';

async function team(kind='dungeon'){
 const env={DB:freshDb()};
 for(const tg of ['111','222','333']){
  await P.createCharacter(env,{tgId:tg,name:'同步'+tg,gender:'m',baseClass:'sword'},T0);
  await env.DB.prepare("UPDATE rpg_characters SET level=60,class_path='B1' WHERE tg_id=?").bind(tg).run();
  const p=await loadPlayer(env.DB,tg),stats=computeStats(p.char,p.equipment);
  await env.DB.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').bind(stats.maxHp,stats.maxMp,tg).run();
 }
 const {party:{id}}=await G.create(env,'111',{kind,dungeonId:'pillar',startFloor:1},T0);
 for(const tg of ['222','333'])await G.action(env,tg,{partyId:id,op:'join'},T0);
 for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'ready'},T0);
 await G.action(env,'111',{partyId:id,op:'start'},T0);
 return {env,id};
}
async function edit(env,id,fn){
 const row=await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first(),state=JSON.parse(row.state_json);
 fn(state);await env.DB.prepare('UPDATE rpg_parties SET state_json=? WHERE id=?').bind(JSON.stringify(state),id).run();
}
test('party replay retains only five turns and a completed cursor returns only new turns',async()=>{
 const {env,id}=await team();
 await edit(env,id,s=>{s.enemy.hp=s.enemy.maxHp=1000000000;s.actors.forEach(a=>{a.hp=a.maxHp=1000000;a.def=1000000000;});});
 const first=await G.view(env,id,'111',T0+5001),cursor=first.battleTurn.id;
 const repeated=await G.view(env,id,'111',T0+5001,cursor);assert.equal(repeated.battleTurns.length,0);assert.equal(repeated.battleSync.hasGap,false);
 const second=await G.view(env,id,'111',T0+10002,cursor);assert.equal(second.battleTurns.length,1);assert.equal(second.battleTurns[0].sequence,2);
 for(let i=3;i<=7;i++)await G.view(env,id,'111',T0+i*5001);
 const late=await G.view(env,id,'111',T0+35007,cursor);assert.equal(late.battleTurns.length,5);assert.equal(late.battleSync.hasGap,true);
 assert.deepEqual(late.battleTurns.map(t=>t.sequence),[3,4,5,6,7]);
 const row=await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first();assert.equal(JSON.parse(row.state_json).recentTurns.length,5);
});
test('snapshots include exact HP and MP before skill cost and after recovery',async()=>{
 const {env,id}=await team();
 let cost;await edit(env,id,s=>{s.enemy.hp=s.enemy.maxHp=1000000;for(const a of s.actors){a.mp=a.maxMp=1000;a.special.learned=['skill_02_1'];a.special.loadout=['skill_02_1'];a.special.cooldowns={};}cost=specialCost(SKILL_MAP.skill_02_1,s.actors[0].affixPct).mp;});
 const p=await G.view(env,id,'111',T0+5001),turn=p.battleTurn;
 assert.equal(turn.before.members[0].mp,1000);
 const cast=turn.events.find(e=>e.actorId==='111');assert.equal(cast.after.members[0].mp,1000-cost);assert.equal(cast.spentMp,cost);
 assert.equal(turn.after.members[0].mp,1000);assert.equal(turn.final.members[0].mp,p.members[0].mp);
 for(const snap of [turn.before,...turn.events.map(e=>e.after),turn.after,turn.final])for(const a of snap.members){assert(Number.isFinite(a.hp));assert(Number.isFinite(a.maxHp));assert(Number.isFinite(a.mp));assert(Number.isFinite(a.maxMp));}
});
test('floor-clear replay keeps defeated enemy identity separate from next floor',async()=>{
 const {env,id}=await team('tower');
 await edit(env,id,s=>{s.floor=4;s.enemy.hp=1;s.enemy.name='第四層舊敵';for(const a of s.actors){a.hp=Math.ceil(a.maxHp/2);a.mp=Math.ceil(a.maxMp/2);}});
 const p=await G.view(env,id,'111',T0+5001),turn=p.battleTurn;
 assert.equal(turn.floor,4);assert.equal(turn.before.floor,4);assert.equal(turn.after.floor,4);assert.equal(turn.after.enemyName,'第四層舊敵');assert.equal(turn.after.enemyHp,0);
 assert.equal(turn.final.floor,5);assert.equal(p.floor,5);assert.equal(turn.final.enemyHp,p.enemy.hp);assert.equal(turn.final.enemyMaxHp,p.enemy.maxHp);assert.notEqual(turn.final.enemyName,'第四層舊敵');
 assert.deepEqual(turn.final.members,p.members.map(({id,hp,maxHp,mp,maxMp})=>({id,hp,maxHp,mp,maxMp})));
});
for(const kind of ['dungeon','tower'])test(`${kind}: live MP threshold refills before skill selection and repeated views never double spend`,async()=>{
 const {env,id}=await team(kind);
 await env.DB.prepare("UPDATE rpg_characters SET auto_blue=1,special_json=? WHERE tg_id='111'").bind(JSON.stringify({autoBluePct:70})).run();
 await env.DB.prepare("UPDATE rpg_inventory SET quantity=20 WHERE tg_id='111' AND item='blue_1'").run();
 await env.DB.prepare("UPDATE rpg_characters SET auto_blue=0 WHERE tg_id='222'").run();
 await edit(env,id,s=>{s.enemy.hp=s.enemy.maxHp=1000000;for(const a of s.actors){a.mp=0;a.maxMp=1000;a.special.learned=['skill_02_1'];a.special.loadout=['skill_02_1'];a.special.cooldowns={};}});
 const result=await G.view(env,id,'111',T0+5001),turn=result.battleTurn;
 const water=turn.events.find(e=>e.actorId==='111'&&e.used);assert.ok(water);assert.equal(water.used.blue_1,18);
 assert.equal(turn.events.find(e=>e.actorId==='111'&&e.skillId).skillId,'skill_02_1');
 assert.equal(turn.events.some(e=>e.actorId==='222'&&e.used),false);
 const count=async()=> (await env.DB.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id='111' AND item='blue_1'").first()).quantity;
 assert.equal(await count(),2);await G.view(env,id,'111',T0+5001);assert.equal(await count(),2);
 const c=await loadPlayer(env.DB,'111');assert.equal(JSON.parse(c.char.special_json).autoBluePct,70);
});
