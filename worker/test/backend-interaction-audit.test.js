import {CurrentClientRequest} from './client-request.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as P from '../src/services/player.js';
import * as B from '../src/services/boss.js';
import {loadPlayer,outboxStmt} from '../src/db.js';
import {settleIdle} from '../src/game/idle.js';
import {GameError} from '../src/game/classes.js';
import {selectAccountCharacter} from '../src/accounts.js';
import {handle} from '../src/index.js';

async function setup(){
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
 await P.createCharacter(env,{tgId:'111',name:'主角色',gender:'m',baseClass:'sword'},T0);
 return env;
}
const appCall=async(env,action,body={},now=T0)=>{
 const r=await handle(new CurrentClientRequest('http://local/app/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'111','X-Debug-Now':String(now)},body:JSON.stringify(body)}),env);
 const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;
};
test('repeated unchanged reads do not bump revision or write a character row',async()=>{
 const env=await setup(),before=await loadPlayer(env.DB,'111');
 await P.withPlayer(env,'111',T0);await P.withPlayer(env,'111',T0+1000);await P.withPlayer(env,'111',T0+2000);
 const after=await loadPlayer(env.DB,'111');assert.equal(after.char.rev,before.char.rev);assert.deepEqual(after,before);
});
test('equivalent serialized state does not produce a meaningless write',async()=>{
 const env=await setup();await env.DB.prepare("UPDATE rpg_characters SET special_json=? WHERE tg_id='111'").bind('{"x":1,"y":2}').run();
 const before=await loadPlayer(env.DB,'111');await P.withPlayer(env,'111',T0,work=>{work.char.special_json='{"y":2,"x":1}';});
 assert.equal((await loadPlayer(env.DB,'111')).char.rev,before.char.rev);
});
test('a failed action persists elapsed idle once, without persisting partial action changes',async()=>{
 const env=await setup(),before=await loadPlayer(env.DB,'111'),now=T0+120000;
 const expected=settleIdle(before.char,before.inv,before.equipment.filter(e=>e.is_equipped),now);
 await assert.rejects(P.withPlayer(env,'111',now,(work)=>{work.char.gold+=12345;throw new GameError('test_failure','預期失敗');}),/預期失敗/);
 const after=await loadPlayer(env.DB,'111');assert.equal(after.char.gold,expected.char.gold);assert.equal(after.char.exp,expected.char.exp);assert.equal(after.char.last_settle_at,expected.char.last_settle_at);assert.deepEqual(after.inv,expected.inv);
 const revision=after.char.rev;await assert.rejects(P.withPlayer(env,'111',now,()=>{throw new GameError('test_failure','預期失敗');}),/預期失敗/);
 assert.equal((await loadPlayer(env.DB,'111')).char.rev,revision);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_idle_reports').first()).n,1);
});
test('no combat ticks still persists party timestamp and pure side effects',async()=>{
 const env=await setup();await env.DB.prepare("UPDATE rpg_characters SET party_id='test-party' WHERE tg_id='111'").run();
 const r=await P.withPlayer(env,'111',T0+1000);assert.equal(r.report.ticks,0);assert.equal((await loadPlayer(env.DB,'111')).char.last_settle_at,T0+1000);
 await P.withPlayer(env,'111',T0+1000,(_w,{db,now})=>({extra:[outboxStmt(db,{dedupe:'test-side-effect',target:'dm',tgId:'111',kind:'test'},now)]}));
 assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE dedupe_key='test-side-effect'").first()).n,1);
});
test('midnight counters and idle state transitions still commit with no combat rewards',async()=>{
 const env=await setup(),midnight=Date.parse('2026-10-08T16:00:00Z');
 await env.DB.prepare("UPDATE rpg_characters SET idle_state='town_no_red',last_settle_at=?,penalty_day='2026-10-08',penalties_today=3,drop_day='2026-10-08',drops_today='{}' WHERE tg_id='111'").bind(midnight-60000).run();
 await env.DB.prepare("UPDATE rpg_inventory SET quantity=0 WHERE tg_id='111' AND item LIKE 'red_%'").run();
 const r=await P.withPlayer(env,'111',midnight);assert.equal(r.report.exp_gained,0);
 const after=await loadPlayer(env.DB,'111');assert.equal(after.char.penalty_day,'2026-10-09');assert.equal(after.char.penalties_today,0);assert.equal(after.char.drop_day,'2026-10-09');assert.equal(after.char.last_settle_at,midnight);
});
test('an inactive character receives no idle rewards while active character still earns',async()=>{
 const env=await setup();await env.DB.prepare("UPDATE rpg_characters SET level=60,class_path='B1' WHERE tg_id='111'").run();
 const alt=await P.createCharacter(env,{tgId:'111',name:'副角色',gender:'f',baseClass:'mage',charSlot:2},T0);
 await selectAccountCharacter(env,'111',alt.char.tg_id,T0);const before=await loadPlayer(env.DB,'111');
 const r=await P.withPlayer(env,'111',T0+300000),after=await loadPlayer(env.DB,'111');
 assert.equal(r.report.ticks,0);assert.equal(r.report.exp_gained,0);assert.equal(after.char.exp,before.char.exp);assert.equal(after.char.gold,before.char.gold);assert.deepEqual(after.inv,before.inv);assert.equal(after.char.last_settle_at,T0+300000);
 const active=await P.withPlayer(env,alt.char.tg_id,T0+300000);assert.ok(active.report.exp_gained>0);assert.ok(active.report.gold_gained>0);
});
test('Mini App boss attacks, cooldown and damage belong to the selected alternate character',async()=>{
 const env=await setup(),alt=await P.createCharacter(env,{tgId:'111',name:'副角色',gender:'f',baseClass:'mage',charSlot:2},T0);
 await selectAccountCharacter(env,'111',alt.char.tg_id,T0);
 const spawn=await B.spawnDue(env,T0,{force:{tier:1}}),before=await loadPlayer(env.DB,'111');
 const attacked=await appCall(env,'boss/attack',{bossId:spawn.id,selectedCharacterId:alt.char.tg_id});assert.ok(attacked.result.damage>0);
 const rows=(await env.DB.prepare('SELECT tg_id FROM rpg_boss_attacks WHERE boss_id=?').bind(spawn.id).all()).results;
 assert.deepEqual(rows.map(r=>r.tg_id),[alt.char.tg_id]);
 const after=await loadPlayer(env.DB,'111');assert.equal(after.char.hp,before.char.hp);assert.equal(after.char.mp,before.char.mp);assert.deepEqual(after.inv,before.inv);
 const status=await appCall(env,'boss',{selectedCharacterId:alt.char.tg_id});assert.equal(status.boss.me.hits,1);assert.equal(status.boss.me.attackedThisWindow,true);assert.equal(status.boss.me.damage,attacked.result.damage);
});
test('summary polling omits equipment cards while retaining live character and inventory state',async()=>{
 const env=await setup(),full=await appCall(env,'me'),summary=await appCall(env,'me',{summary:true});
 assert.ok(Array.isArray(full.equipment));assert.equal('equipment' in summary,false);assert.equal(summary.compact,true);assert.deepEqual(summary.character,full.character);assert.deepEqual(summary.inventory,full.inventory);
});
