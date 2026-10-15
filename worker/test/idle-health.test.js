import test from 'node:test';import assert from 'node:assert/strict';
import {MAPS} from '../src/game/constants.js';
import {idleCombatState,resolveIdleCombat} from '../src/game/idle-combat.js';
import {settleIdle} from '../src/game/idle.js';
import {idleBattleHarness,idleMe,idleReport} from './idle-battle-harness.js';
import {mkChar,starterGear,T0} from './helpers.js';
import {freshDb} from './d1-shim.js';import * as P from '../src/services/player.js';
import {playerView} from '../src/views.js';

for(const map of Object.values(MAPS)){
 test(`map ${map.id}: authoritative normal and elite HP conserves every hit`,()=>{
  const c=mkChar({level:map.min}),state=idleCombatState(c);
  assert.equal(state.enemies.length,2);assert.ok(state.enemies.every(e=>e.hp===e.maxHp&&map.monsters.includes(e.name)));
  const r=resolveIdleCombat(state,c,{at:T0+60000,killsBudget:2.4,cast:true,skillName:'測試技能',elite:true});
  for(const hit of r.events.filter(e=>e.type==='hit')){assert.equal(hit.beforeHp-hit.afterHp,hit.damage);assert.ok(hit.afterHp>=0);assert.ok(hit.damage<=hit.beforeHp);}
  assert.equal(r.events.filter(e=>e.type==='hit'&&e.afterHp===0).length,r.kills+r.eliteKills);
  const elite=r.events.find(e=>e.type==='elite');assert.ok(map.elitePool.some(m=>m.name===elite.enemy.name));assert.ok(elite.enemy.maxHp>state.enemies[0].maxHp);
  assert.ok(state.enemies.every(e=>e.hp>0&&e.hp<=e.maxHp));
 });
 test(`map ${map.id}: all visible monster meters use server values and do not change between rounds`,async()=>{
  const c=mkChar({level:map.min}),feed=idleCombatState(c);
  const h=idleBattleHarness(),me=idleMe({mapId:map.id,level:map.min});me.battle.idleCombat=feed;h.battle.sync(me);await h.advance(5000);
  assert.equal(h.battle.state.group.length,2);
  for(const e of h.battle.state.group){assert.equal(e.refs.mBar.style.display,'block');assert.equal(e.refs.mBar.getAttribute('aria-valuenow'),String(e.mon.hp));assert.equal(e.refs.mHpText.textContent,`${e.mon.hp}／${e.mon.max}`);}
  const hp=h.battle.state.group.map(e=>e.mon.hp);await h.advance(10000);assert.deepEqual(h.battle.state.group.map(e=>e.mon.hp),hp);
  assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,['monster-layout.json']);
 });
}
test('partial HP and fractional damage persist across minutes without resetting or granting guessed kills',()=>{
 const c=mkChar({level:15});let state=idleCombatState(c),kills=0,totalDamage=0;
 const hp=state.enemies[0].maxHp;
 for(let i=1;i<=25;i++){
  const r=resolveIdleCombat(state,c,{at:T0+i*60000,killsBudget:.35});kills+=r.kills;totalDamage+=r.events.filter(e=>e.type==='hit').reduce((n,e)=>n+e.damage,0);
  const persisted=JSON.stringify(state);state=idleCombatState({...c,idle_combat_json:persisted});assert.deepEqual(state,JSON.parse(persisted));
 }
 assert.equal(kills,Math.floor(25*.35));assert.equal(totalDamage,Math.floor(hp*25*.35));
});
test('a replay updates the bar and damage on impact, then exactly matches the committed current enemies',async()=>{
 const c=mkChar(),feed=idleCombatState(c),round=resolveIdleCombat(feed,c,{at:T0+60000,killsBudget:1.3,cast:true,skillName:'真實技能'});
 const h=idleBattleHarness(),me=idleMe();me.battle.idleCombat=feed;h.battle.sync(me,idleReport({combat:round,kills:round.kills,elites:0,used:{}}));await h.advance(15000);
 assert.equal(h.root.dataset.completedRound,round.id);
 for(let i=0;i<2;i++){const actual=h.battle.state.group[i];assert.equal(actual.mon.id,feed.enemies[i].id);assert.equal(actual.mon.hp,feed.enemies[i].hp);assert.equal(actual.refs.mBar.getAttribute('aria-valuenow'),String(actual.mon.hp));}
 const hit=round.events.filter(e=>e.type==='hit').at(-1),last=JSON.parse(h.root.dataset.lastHit);assert.equal(last.damage,hit.damage);assert.equal(last.hp,hit.afterHp);
 const epoch=h.battle.state.visualEpoch;h.battle.sync(me,idleReport({combat:round}));await h.advance(3000);assert.equal(h.battle.state.visualEpoch,epoch);assert.deepEqual(h.errors,[]);
});
test('minute settlement persists its real encounter and no-op reads do not write again',async()=>{
 const env={DB:freshDb()};await P.createCharacter(env,{tgId:'111',name:'血量測試',gender:'m',baseClass:'sword'},T0);
 const me=async now=>{const r=await P.withPlayer(env,'111',now);return playerView(r.player,{now,report:r.report});};
 const before=await me(T0),first=await me(T0+60000),same=await me(T0+60000);
 assert.ok(first.report.combat);assert.deepEqual(first.battle.idleCombat.round,first.report.combat);
 assert.equal(first.character.revision,before.character.revision+1);assert.equal(same.character.revision,first.character.revision);
 assert.deepEqual(same.battle.idleCombat.enemies,first.battle.idleCombat.enemies);assert.equal(same.character.gold,first.character.gold);
 const row=await env.DB.prepare('SELECT idle_combat_json FROM rpg_characters WHERE tg_id=?').bind('111').first();assert.deepEqual(JSON.parse(row.idle_combat_json).enemies,first.battle.idleCombat.enemies);
});
test('offline calculation is bounded, inactive combat does not invent hits and map transitions reset identity',()=>{
 const c=mkChar({level:25,class_path:'A'}),r=settleIdle(c,{red_2:100000,blue_2:100000},starterGear(c),T0+86400000);
 assert.ok(Buffer.byteLength(r.char.idle_combat_json)<20000);assert.ok(JSON.parse(r.char.idle_combat_json).round?.events.length<=60);
 const noTime=settleIdle(r.char,r.inv,starterGear(c),T0+86400000);assert.equal(noTime.char.idle_combat_json,r.char.idle_combat_json);
 const next=idleCombatState({...r.char,level:31});assert.equal(next.mapId,4);assert.ok(next.enemies.every(e=>e.mapId===4&&e.hp===e.maxHp));
 const party=settleIdle({...r.char,party_id:'p'},r.inv,starterGear(c),T0+86460000);assert.equal(party.report.ticks,0);assert.equal(party.char.idle_combat_json,r.char.idle_combat_json);
});
