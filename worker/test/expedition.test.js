import test from 'node:test';import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';import {T0} from './helpers.js';
import * as P from '../src/services/player.js';import * as S from '../src/services/special.js';import * as G from '../src/services/party.js';
import {loadPlayer} from '../src/db.js';import {computeStats} from '../src/game/stats.js';
import {advance} from '../src/game/classes.js';import {settleIdle} from '../src/game/idle.js';
import {SKILL_MAP,MECHANICS,eligible,performSkill,specialState} from '../src/game/special.js';
import {isTradeableItem} from '../src/game/trade.js';
let request=0;const req=()=>`exp-test-${++request}`;
async function setup(level=60,path='B1'){
 const env={DB:freshDb()};for(const id of ['111','222','333','444']){await P.createCharacter(env,{tgId:id,name:'角色'+id,gender:'m',baseClass:'sword'},T0);await env.DB.prepare('UPDATE rpg_characters SET level=?,class_path=? WHERE tg_id=?').bind(level,path,id).run();const p=await loadPlayer(env.DB,id),s=computeStats(p.char,p.equipment);await env.DB.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').bind(s.maxHp,s.maxMp,id).run();}return env;
}
const action=(env,tg,b,now=T0)=>S.action(env,tg,{...b,requestId:req()},now);
async function team(env,dungeonId='pillar',now=T0){const r=await G.create(env,'111',{kind:'dungeon',dungeonId},now);const id=r.party.id;for(const tg of ['222','333'])await G.action(env,tg,{partyId:id,op:'join',requestId:req()},now);for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'ready',requestId:req()},now);await G.action(env,'111',{partyId:id,op:'start',requestId:req()},now);return id;}
async function win(env,id,now=T0){for(let i=0;i<40;i++){const p=await G.view(env,id,'111',now);if(p.status!=='combat')return {p,now};for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'submit',skillId:'attack',round:p.round,requestId:req()},now);now+=30000;}throw Error('No end');}
test('all 54 skills have explicit mechanics and correct route qualifications',()=>{
 assert.equal(Object.keys(SKILL_MAP).length,54);for(const id of Object.keys(SKILL_MAP))assert.ok(MECHANICS[id]);
 assert.equal(eligible({base_class:'sword',class_path:'B1',level:60},SKILL_MAP.skill_02_1),true);
 assert.equal(eligible({base_class:'sword',class_path:'B1',level:60},SKILL_MAP.skill_01_1),false);
 assert.equal(isTradeableItem('book_skill_02_1'),true);assert.equal(isTradeableItem('trial_3'),false);
 for(const cls of ['sword','archer','mage'])for(const path of ['A1','A2','B1','B2']){
  const c={base_class:cls,class_path:path,level:70};
  assert.equal(Object.values(SKILL_MAP).filter(s=>s.advancementTier===1&&eligible(c,s)).length,3);
  assert.equal(Object.values(SKILL_MAP).filter(s=>s.advancementTier===2&&eligible(c,s)).length,2);
 }
});
test('learning is character-owned, one-time and consumes exactly one tradeable book',async()=>{
 const env=await setup();await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111','book_skill_02_1',1).run();
 const r=await action(env,'111',{op:'learn',skillId:'skill_02_1'});assert.ok(r.special.learned.includes('skill_02_1'));assert.equal(r.inventory.book_skill_02_1,0);
 await assert.rejects(action(env,'111',{op:'learn',skillId:'skill_02_1'}));assert.equal((await S.view(env,'222',T0)).special.learned.length,0);
 await action(env,'111',{op:'loadout',loadout:['skill_02_1']});const cast=await action(env,'111',{op:'cast',skillId:'skill_02_1'});assert.equal(cast.special.pending,'skill_02_1');const mp=cast.character.mp;
 await assert.rejects(action(env,'111',{op:'cast',skillId:'skill_02_1'}));const next=await S.view(env,'111',T0+60000);assert.equal(next.special.pending,undefined);assert.ok(next.character.mp<mp);assert.ok(next.special.cooldowns.skill_02_1>T0+60000);
});
test('three accounts are required; one account cannot join through another character',async()=>{
 const env=await setup();const r=await G.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},T0);const id=r.party.id;
 await assert.rejects(G.action(env,'111',{partyId:id,op:'start',requestId:req()},T0));
 await P.createCharacter(env,{tgId:'111',name:'角色分身',gender:'f',baseClass:'sword'},T0);
 const alt=(await env.DB.prepare('SELECT tg_id FROM rpg_characters WHERE account_tg_id=? AND char_slot=2').bind('111').first()).tg_id;
 await env.DB.prepare('UPDATE rpg_characters SET level=60,class_path=? WHERE tg_id=?').bind('B1',alt).run();
 await assert.rejects(G.action(env,alt,{partyId:id,op:'join',requestId:req()},T0));
 assert.equal((await G.view(env,id,'111',T0)).members.length,1);
});
test('combat pauses idle; only team members submit; no browser can resolve a stale round',async()=>{
 const env=await setup(),id=await team(env);const p=await loadPlayer(env.DB,'111');const result=settleIdle(p.char,p.inv,p.equipment,T0+60000);assert.equal(result.report.ticks,0);assert.equal(result.char.mp,p.char.mp);
 await assert.rejects(G.action(env,'444',{partyId:id,op:'submit',skillId:'attack',round:1,requestId:req()},T0));
 await assert.rejects(G.action(env,'111',{partyId:id,op:'submit',skillId:'attack',round:99,requestId:req()},T0));
});
test('real damage completes dungeon; reward and duplicate claim are atomic and idempotent',async()=>{
 const env=await setup(),id=await team(env);const {p,now}=await win(env,id);assert.equal(p.status,'won');assert.equal((await loadPlayer(env.DB,'111')).char.party_id,null);
 const [a,b]=await Promise.all([G.reward(env,'111',{partyId:id,requestId:req()},now),G.reward(env,'111',{partyId:id,requestId:req()},now)]);
 assert.deepEqual(a.reward,b.reward);assert.equal((await loadPlayer(env.DB,'111')).inv.research_fragment,8);
});
test('no daily cap: every cleared dungeon run pays the full reward, and each run still pays only once',async()=>{
  const env=await setup();let expected=0;
  for(let i=0;i<4;i++){for(const tg of ['111','222','333']){const q=await loadPlayer(env.DB,tg),st=computeStats(q.char,q.equipment);await env.DB.prepare("UPDATE rpg_characters SET hp=?,mp=?,idle_state='fighting' WHERE tg_id=?").bind(st.maxHp,st.maxMp,tg).run();}const id=await team(env);const {now}=await win(env,id);const a=await G.reward(env,'111',{partyId:id,requestId:req()},now);const again=await G.reward(env,'111',{partyId:id,requestId:req()},now);assert.equal(a.reward.items.research_fragment,8);assert.deepEqual(again.reward,a.reward);expected+=8;assert.equal((await loadPlayer(env.DB,'111')).inv.research_fragment,expected);}
});
test('claimed runs are recorded per player and listed newest first with mode, floor and items',async()=>{
  const env=await setup();const ids=[];
  for(let i=0;i<3;i++){for(const tg of ['111','222','333']){const q=await loadPlayer(env.DB,tg),st=computeStats(q.char,q.equipment);await env.DB.prepare("UPDATE rpg_characters SET hp=?,mp=?,idle_state='fighting' WHERE tg_id=?").bind(st.maxHp,st.maxMp,tg).run();}const id=await team(env);const {now}=await win(env,id,T0+i*100000);await G.reward(env,'111',{partyId:id,requestId:req()},now+i*1000);ids.push(id);}
  const l=await G.list(env,'111',T0+10);assert.equal(l.drops.length,3);assert.deepEqual(l.drops.map(d=>d.partyId),[...ids].reverse());for(const d of l.drops){assert.equal(d.mode,'dungeon');assert.equal(d.items.research_fragment,8);assert.ok(d.name&&d.at>0);}
  assert.equal((await G.list(env,'222',T0+10)).drops.length,3);assert.equal((await G.list(env,'999',T0+10)).drops.length,0);
});
test('third advancement accepts only a bound three-person trial item; boss mat cannot bypass',async()=>{
 const c={base_class:'sword',class_path:'B1',level:90};assert.throws(()=>advance(c,{mat_3:10},'1'));
 const r=advance(c,{trial_3:1},'1');assert.equal(r.tier,3);assert.equal(c.class_path,'B11');
 const env=await setup(90,'B1'),id=await team(env,'trial3');const {p,now}=await win(env,id);assert.equal(p.status,'won');const reward=await G.reward(env,'111',{partyId:id,requestId:req()},now);assert.equal(reward.reward.items.trial_3,1);
});
test('revive is once per encounter and shield/interrupt/heal mechanics change combat',()=>{
 const mk=(id,hp=500)=>({id,hp,maxHp:500,mp:200,maxMp:200,atk:100,def:0,buffs:[],special:{cooldowns:{}}});const a=mk('a'),b=mk('b',0),enemy={hp:5000,maxHp:5000,def:0,buffs:[],interruptible:true,windup:true},ctx={};
 performSkill(a,[a,b],enemy,SKILL_MAP.skill_24_2,'b',T0,()=>1,ctx);assert.equal(b.hp,125);b.hp=0;assert.throws(()=>performSkill(a,[a,b],enemy,SKILL_MAP.skill_24_2,'b',T0,()=>1,ctx));
 b.hp=200;performSkill(a,[a,b],enemy,SKILL_MAP.skill_04_2,'b',T0,()=>1,{});assert.equal(b.hp,440);
 performSkill(a,[a,b],enemy,SKILL_MAP.skill_02_1,'a',T0,()=>1,{});assert.equal(enemy.interrupted,true);
});
test('books enter existing escrow and cancel returns them; a buyer cannot escrow an owner book',async()=>{
 const env=await setup();await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111','book_skill_02_1',1).run();
 const opened=await S.tradeBook(env,'111',{skillId:'skill_02_1',target:{name:'角色222'},requestId:req()},T0);
 assert.equal(opened.trade.a.lines[0].ref,'book_skill_02_1');assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,0);
 const T=await import('../src/services/trade.js');await T.cancel(env,{tgId:'111',tradeId:opened.tradeId},T0);
 assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,1);
 const requested=await S.tradeBook(env,'222',{ownerId:'111',skillId:'skill_02_1',requestId:req()},T0);
 assert.equal(requested.trade.a.lines.length,0);assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,1);
});
test('tower boss at five does not finish the run; tenth floor persists progress and one daily reward',async()=>{
 const env=await setup(),now=T0;const r=await G.create(env,'111',{kind:'tower',startFloor:1},now),id=r.party.id;
 for(const tg of ['222','333'])await G.action(env,tg,{partyId:id,op:'join',requestId:req()},now);
 for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'ready',requestId:req()},now);
 await G.action(env,'111',{partyId:id,op:'start',requestId:req()},now);let time=now;
 for(let i=0;i<80;i++){time+=30000;const p=await G.view(env,id,'111',time);if(p.status!=='combat')break;if(p.floor%5===0)for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'submit',skillId:'attack',round:p.round,requestId:req()},time);}
 const done=await G.view(env,id,'111',time);assert.equal(done.status,'won');assert.equal(done.floor,10);
 await G.reward(env,'111',{partyId:id,requestId:req()},time);const p=await loadPlayer(env.DB,'111');assert.equal(specialState(p.char).towerBest,10);assert.equal(p.inv.tower_fragment,10);
});
test('group animation timeline contains only resolved damage and final HP snapshots',async()=>{const env=await setup(),id=await team(env);for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'submit',skillId:'attack',round:1,requestId:req()},T0);const p=await G.view(env,id,'111',T0+30000);const t=p.battleTurn;assert.equal(t.round,1);assert.equal(t.events.filter(e=>e.skillId==='attack').length,3);assert.equal(t.before.enemyHp-t.events.reduce((n,e)=>n+(e.damage||0),0),t.after.enemyHp);assert.equal(t.after.enemyHp,p.enemy.hp);assert.deepEqual(t.after.members.map(m=>m.hp),p.members.map(m=>m.hp));assert.ok(t.events.find(e=>e.actorId==='boss').hits.every(h=>h.damage>=0));});

test('completed dungeon frees group slot before old rewards are claimed',async()=>{const env=await setup();const id=await team(env);const ended=await win(env,id);assert.equal(ended.p.status,'won');assert.equal(ended.p.me.rewarded,true);assert.equal(ended.p.me.reward.items.research_fragment,8);assert.equal((await G.create(env,'444',{kind:'tower'},ended.now)).party.status,'lobby');assert.ok((await G.reward(env,'111',{partyId:id,requestId:req()},ended.now)).reward);});
test('expired combat frees the group slot automatically',async()=>{const env=await setup();const id=await team(env);const next=await G.create(env,'444',{kind:'tower'},T0+1800001);assert.equal(next.party.status,'lobby');assert.equal((await G.view(env,id,'111',T0+1800001)).status,'ended');});

test('won party rewards every member who acted automatically and exactly once; manual claim is a no-op',async()=>{const env=await setup();const id=await team(env);const {p,now}=await win(env,id);assert.equal(p.status,'won');for(const tg of ['111','222','333']){const v=await G.view(env,id,tg,now);assert.equal(v.me.rewarded,true);assert.equal(v.me.reward.items.research_fragment,8);assert.equal((await loadPlayer(env.DB,tg)).inv.research_fragment,8);}for(let k=0;k<2;k++){for(const tg of ['111','222','333']){await G.view(env,id,tg,now+1000);const r=await G.reward(env,tg,{partyId:id,requestId:req()},now+2000);assert.equal(r.reward.items.research_fragment,8);assert.equal((await loadPlayer(env.DB,tg)).inv.research_fragment,8);}}const n=await env.DB.prepare('SELECT COUNT(*) c FROM rpg_party_rewards WHERE party_id=?').bind(id).first();assert.equal(n.c,3);});
