import test from 'node:test';
import assert from 'node:assert/strict';
import {pveTeam} from './pve-balance-fixture.js';
import {mkChar,T0} from './helpers.js';
import {idleStats,standardSet,computeStats} from '../src/game/stats.js';
import {settleIdle} from '../src/game/idle.js';
import {armIdleBalance,idleBalanceVersion,dungeonProfile,DUNGEON_BALANCE} from '../src/game/pve-balance.js';
import {POTIONS} from '../src/game/constants.js';
import * as G from '../src/services/party.js';
import * as P from '../src/services/player.js';
import {loadPlayer} from '../src/db.js';
const H=3600000,stock=Object.fromEntries(Object.keys(POTIONS).map(k=>[k,10000]));
const stable=t=>t.mock.method(crypto,'getRandomValues',a=>{a.fill(0x80000000);return a;});
const make=(level=65)=>{const c=mkChar({level,class_path:'B1',special_json:JSON.stringify({towerBest:20,autoRedPotion:'red_3'})}),eq=standardSet('sword',level),s=computeStats(c,eq);return {c:{...c,hp:s.maxHp,mp:s.maxMp},eq};};
test('Lv1–30 encounters, gear stats, EXP and farming efficiency retain their original values',()=>{
 for(const level of [1,15,30,31,65,105,120]){
  const {c,eq}=make(level),a=idleStats(c,eq,level,{balanceVersion:1}),b=idleStats(c,eq,level,{balanceVersion:2});
  for(const key of ['atk','def','maxHp','maxMp','power','g','expFactor','killsPerTick','mpRegen'])assert.equal(a[key],b[key],key+' at '+level);
  if(level<=30)assert.deepEqual(a,b);else {assert.ok(b.hpLoss>a.hpLoss);assert.equal(b.balanceVersion,2);}
 }
});
test('new idle boundary protects all accrued offline minutes and preserves other character state',()=>{
 const {c,eq}=make(),now=T0+12*H,armed=armIdleBalance(c,now),a=settleIdle(c,stock,eq,now),b=settleIdle(armed,stock,eq,now);
 assert.deepEqual(b.report,a.report);assert.deepEqual(b.inv,a.inv);assert.deepEqual(b.events,a.events);assert.equal(b.char.hp,a.char.hp);
 assert.equal(JSON.parse(armed.special_json).towerBest,20);assert.equal(idleBalanceVersion(armed,now),1);assert.equal(idleBalanceVersion(armed,now+1),2);
 assert.equal(armIdleBalance(armed,now+H),armed);assert.equal(armIdleBalance({...c,party_id:'existing'},now).special_json,c.special_json);
 assert.equal(armIdleBalance({...c,level:30},now).special_json,c.special_json);
 const future=settleIdle(b.char,b.inv,eq,now+H),forced=settleIdle(b.char,b.inv,eq,now+H,{balanceVersion:2});assert.deepEqual(future,forced);
});
test('first real player settlement persists the boundary atomically; retries do not debit new pressure on old hours',async t=>{
 const f=await pveTeam({start:false});t.after(f.close);const who=f.ids[0];
 f.db.prepare("UPDATE rpg_characters SET special_json=json_remove(special_json,'$.idleBalance') WHERE tg_id=?").run(who);
 // A lobby alone does not pause ordinary idle. Compare the actual persisted result.
 const loaded=await loadPlayer(f.env.DB,who),expected=settleIdle(loaded.char,loaded.inv,loaded.equipment,T0+H);
 let conflict=false;const batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=async stmts=>{if(!conflict&&stmts.some(s=>s.sql.startsWith('UPDATE rpg_characters SET'))){conflict=true;f.db.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=?').run(who);}return batch(stmts);};
 await P.withPlayer(f.env,who,T0+H);assert.equal(conflict,true);const after=await loadPlayer(f.env.DB,who);
 assert.deepEqual(after.inv,expected.inv);assert.equal(after.char.hp,expected.char.hp);assert.equal(JSON.parse(after.char.special_json).idleBalance.from,T0+H);
 await P.withPlayer(f.env,who,T0+H);assert.deepEqual((await loadPlayer(f.env.DB,who)).inv,after.inv);
});
test('fixed boss strength does not scale to better equipment; upgrades improve clear speed and potion cost',async t=>{
 stable(t);const weak=await pveTeam({profile:'common0'}),strong=await pveTeam({profile:'ring7'});t.after(weak.close);t.after(strong.close);
 assert.deepEqual(weak.state().enemy,strong.state().enemy);assert.equal(weak.state().enemy.maxHp,DUNGEON_BALANCE.forge.hp);
 for(const f of[weak,strong]){assert.equal((await f.finish()).status,'won');for(let i=0;i<2;i++){await f.repeat();assert.equal((await f.finish()).status,'won');}}
 assert.ok(strong.state().lastTurn.sequence<weak.state().lastTurn.sequence);assert.ok(strong.costs().red<weak.costs().red);assert.ok(strong.state().actors.every(a=>a.hp>0));
});
test('legacy departed dungeon keeps its stored enemy, defense and potion rules; the next run opts into v2',async t=>{
 stable(t);const f=await pveTeam({legacy:true});t.after(f.close);const original=f.state();
 assert.equal(original.dungeonBalanceVersion,undefined);assert.equal(original.actors[0].defenseScale,undefined);
 f.edit(s=>{s.actors.forEach(a=>a.hp=a.maxHp*.4);});await f.step();assert.equal(f.turns[0].events.some(e=>e.label==='自動喝紅水'),false);
 assert.equal(f.state().enemy.maxHp,original.enemy.maxHp);assert.equal((await f.finish()).status,'won');await f.repeat();
 assert.equal(f.state().dungeonBalanceVersion,2);assert.deepEqual(f.state().dungeonBalance,DUNGEON_BALANCE.forge);
 assert.equal(f.state().enemy.maxHp,36000);assert.equal(f.state().actors[0].defenseScale,800);
});
test('tower, trials and entry dungeon stay outside this difficulty pass',async t=>{
 for(const p of[{kind:'tower',state:{dungeonId:'stars'}},{kind:'dungeon',state:{dungeonId:'trial3',trial:3}},{kind:'dungeon',state:{dungeonId:'pillar'}}])assert.equal(dungeonProfile(p),null);
 const f=await pveTeam({dungeon:'pillar'});t.after(f.close);assert.equal(f.state().dungeonBalanceVersion,1);assert.equal((await G.view(f.env,f.id(),f.ids[0],T0)).challenge,null);
});
test('automatic red follows selected stock, threshold and atomic inventory; never buys or substitutes',async t=>{
 stable(t);const f=await pveTeam({profile:'common0'});t.after(f.close);
 for(const who of f.ids){const c=await loadPlayer(f.env.DB,who),s=JSON.parse(c.char.special_json);s.autoRedPotion='red_1';f.db.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?').run(JSON.stringify(s),who);f.db.prepare("UPDATE rpg_inventory SET quantity=2 WHERE tg_id=? AND item='red_1'").run(who);}
 f.edit(s=>{s.enemy.hp=s.enemy.maxHp=1e12;s.actors.forEach(a=>{a.hp=a.maxHp*.1;a.mp=0;});});const gold=f.db.prepare('SELECT sum(gold) n FROM rpg_characters').get().n;
 await f.step();const used=f.turns[0].events.filter(e=>e.label==='自動喝紅水');assert.equal(used.length,3);for(const e of used)assert.deepEqual(e.used,{red_1:2});
 for(const who of f.ids){const p=await loadPlayer(f.env.DB,who);assert.equal(p.inv.red_1,0);assert.equal(p.inv.red_2,1000);assert.equal(p.inv.red_3,1000);}
 assert.equal(f.db.prepare('SELECT sum(gold) n FROM rpg_characters').get().n,gold);await f.step();assert.equal(f.turns[1].events.some(e=>e.label==='自動喝紅水'),false);
});
test('no red potion is wasted when the boss is already killed or a teammate is dead',async t=>{
 stable(t);const f=await pveTeam();t.after(f.close);f.edit(s=>{s.enemy.hp=1;s.actors[0].hp=0;s.actors[1].hp=s.actors[1].maxHp*.1;});
 await f.step();assert.equal(f.turns[0].events.some(e=>e.label==='自動喝紅水'),false);assert.equal(f.costs().red,0);
});
test('v2 red and blue deductions, combat, rewards and cooldowns match offline catch-up after a transaction conflict',async t=>{
 stable(t);const a=await pveTeam(),b=await pveTeam();t.after(a.close);t.after(b.close);
 for(const f of[a,b]){for(const who of f.ids){const p=await loadPlayer(f.env.DB,who),s=JSON.parse(p.char.special_json);s.autoBluePct=100;s.autoBluePotion='blue_2';f.db.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?').run(JSON.stringify(s),who);}f.edit(s=>{s.actors.forEach(a=>{a.hp=a.maxHp*.15;a.mp=0;});});}
 const batch=b.env.DB.batch.bind(b.env.DB);let conflict=false;b.env.DB.batch=async stmts=>{if(!conflict&&stmts[0]?.sql.startsWith('UPDATE rpg_parties')){conflict=true;b.db.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=?').run(b.ids[0]);}return batch(stmts);};
 assert.equal((await a.finish()).status,'won');await Promise.allSettled([G.sweep(b.env,T0+2*H),G.view(b.env,b.id(),b.ids[0],T0+2*H)]);await G.sweep(b.env,T0+2*H+1);assert.equal(conflict,true);
 const normalized=f=>JSON.parse(JSON.stringify(f.state()).replaceAll(f.id(),'PARTY'));assert.deepEqual(normalized(b),normalized(a));
 for(const who of a.ids){const x=await loadPlayer(a.env.DB,who),y=await loadPlayer(b.env.DB,who);assert.deepEqual(x.inv,y.inv);assert.deepEqual(JSON.parse(x.char.special_json),JSON.parse(y.char.special_json));}
 assert.ok(a.costs().red>0);assert.ok(a.costs().blue>0);assert.equal(b.db.prepare('SELECT count(*) n FROM rpg_party_rewards WHERE party_id=?').get(b.id()).n,3);
 const costs=b.costs();await G.sweep(b.env,T0+3*H);assert.deepEqual(b.costs(),costs);
});
