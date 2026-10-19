import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {freshDb,D1Shim} from './d1-shim.js';
import * as P from '../src/services/player.js';
import * as R from '../src/services/star-ring.js';
import * as C from '../src/services/star-ring-cosmetics.js';
import * as Hall from '../src/services/hero-hall.js';
import * as SP from '../src/services/special.js';
import * as Party from '../src/services/party.js';
import * as E from '../src/game/star-ring.js';
import {COSMETICS,equippedAura} from '../src/game/star-ring-cosmetics.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {playerView} from '../src/views.js';
import {handle} from '../src/index.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';
import {selectAccountCharacter} from '../src/accounts.js';
const T=Date.parse('2026-10-18T08:00:00Z'),dawn=COSMETICS[0].id,moon=COSMETICS[1].id,eclipse=COSMETICS[2].id;
async function fixture(t,{level=40,balance=1000}={}){
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'},db=env.DB.sqlite;t.after(()=>db.close());
 for(const [id,name]of [['97601','星環旅人'],['97602','另一旅人']]){
  await P.createCharacter(env,{tgId:id,name,gender:'f',baseClass:'sword'},T);
  db.prepare("UPDATE rpg_characters SET level=?,class_path='A',last_settle_at=? WHERE tg_id=?").run(level,T,id);
  db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'star_ring_token',?)").run(id,balance);
 }
 return {env,db,tg:'97601',other:'97602'};
}
const buy=(env,tg,id,request)=>R.shop(env,tg,{offerId:id,requestId:request},T);
const wear=(env,tg,id,request)=>C.equip(env,tg,{cosmeticId:id,requestId:request},T);
test('three permanent bound visual catalogs carry dedicated art; no stat values enter combat',async t=>{
 const {env,tg}=await fixture(t),before=await loadPlayer(env.DB,tg),stats=computeStats(before.char,before.equipment);
 assert.deepEqual(COSMETICS.map(x=>x.cost),[60,120,180]);assert.equal(COSMETICS.every(x=>x.bound&&x.visualOnly&&x.slot==='aura'&&x.level===40),true);
 for(const c of COSMETICS){assert.match(c.art,/^\/art\/star-ring-rewards-20261018\/aura-/);assert.match(c.icon,/\/icon-/);assert.equal(E.SHOP.find(o=>o.id===c.id).cosmetic,c.id);}
 await buy(env,tg,dawn,'buy');await wear(env,tg,dawn,'wear');const after=await loadPlayer(env.DB,tg);
 assert.deepEqual(computeStats(after.char,after.equipment),stats);
 assert.equal(after.inv.star_ring_token,940);assert.equal(after.inv[dawn],undefined);
 assert.equal(E.snapshot(after).aura.id,dawn);assert.equal(E.snapshot(after).baselineExpPerMinute,E.snapshot(before).baselineExpPerMinute);
});
test('purchase receipt replay and new duplicate request unlock once without a second debit',async t=>{
 const {env,db,tg}=await fixture(t),first=await buy(env,tg,dawn,'buy');
 assert.equal(first.cosmetic,dawn);assert.deepEqual(first.cosmetics.owned,[dawn]);
 assert.deepEqual(await buy(env,tg,dawn,'buy'),first);
 const duplicate=await buy(env,tg,dawn,'duplicate');assert.equal(duplicate.alreadyOwned,true);
 assert.equal(duplicate.cosmetics.balance,940);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_cosmetics').get().n,1);
 assert.equal(db.prepare("SELECT count(*) n FROM rpg_ledger WHERE type='星征徽記兌換'").get().n,1);
 await assert.rejects(buy(env,tg,moon,'duplicate'),e=>e.code==='request');
});
test('parallel same and different request purchases cannot duplicate cost or unlock',async t=>{
 const {env,db,tg}=await fixture(t);
 const out=await Promise.all([buy(env,tg,dawn,'a'),buy(env,tg,dawn,'a'),buy(env,tg,dawn,'b')]);
 assert.equal(out.every(r=>r.ok),true);assert.equal((await C.state(env,tg)).balance,940);
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_cosmetics').get().n,1);
 assert.equal(db.prepare("SELECT sum(item_delta) n FROM rpg_ledger WHERE type='星征徽記兌換'").get().n,-60);
});
test('insufficient balance rolls back unlock and receipt; underlevel purchase/equip cannot bypass Lv40',async t=>{
 const {env,db,tg,other}=await fixture(t,{balance:59});
 await assert.rejects(buy(env,tg,dawn,'poor'),e=>e.code==='currency');
 assert.equal((await C.state(env,tg)).balance,59);assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_cosmetics').get().n,0);
 assert.equal(db.prepare('SELECT count(*) n FROM rpg_star_ring_purchases').get().n,0);
 db.prepare('UPDATE rpg_characters SET level=39 WHERE tg_id=?').run(other);
 await assert.rejects(buy(env,other,dawn,'low'),e=>e.code==='level');await assert.rejects(wear(env,other,null,'low-wear'),e=>e.code==='level');
});
test('equip rejects unknown/unowned and another character ownership; state is permanent across unequip',async t=>{
 const {env,tg,other}=await fixture(t);await buy(env,tg,dawn,'buy');
 await assert.rejects(wear(env,tg,'not-a-cosmetic','invalid'),e=>e.code==='cosmetic');
 await assert.rejects(wear(env,tg,moon,'locked'),e=>e.code==='not_owned');
 await assert.rejects(wear(env,other,dawn,'foreign'),e=>e.code==='not_owned');
 const equipped=await wear(env,tg,dawn,'wear');assert.equal(equipped.equipped.id,dawn);
 const off=await wear(env,tg,null,'off');assert.equal(off.equipped,null);assert.deepEqual(off.owned,[dawn]);assert.equal(off.balance,940);
 await wear(env,tg,dawn,'wear');assert.equal((await C.state(env,tg)).equipped,null,'replaying old equip cannot resurrect a removed aura');
 await assert.rejects(wear(env,tg,moon,'wear'),e=>e.code==='request');
 assert.equal((await wear(env,tg,dawn,'wear-again')).equipped.id,dawn);
});
test('parallel equip operations are serialized by character revision and do not touch balance',async t=>{
 const {env,tg}=await fixture(t);await buy(env,tg,dawn,'d');await buy(env,tg,moon,'m');
 await Promise.all([wear(env,tg,dawn,'one'),wear(env,tg,moon,'two'),wear(env,tg,moon,'two')]);
 const state=await C.state(env,tg);assert.ok([dawn,moon].includes(state.equipped.id));assert.equal(state.balance,820);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM rpg_star_ring_cosmetic_operations').get().n,2);
});
test('existing scroll/gear shop remains usable and never manufactures cosmetic inventory items',async t=>{
 const {env,tg}=await fixture(t);const scroll=await buy(env,tg,'weapon','old-scroll');assert.equal(scroll.items.scroll_w,4);
 const gear=await buy(env,tg,'gear','old-gear');assert.equal(gear.equipment[0].source,'star_ring');
 const list=await R.shop(env,tg,{},T);assert.equal(list.offers.filter(o=>!o.currency).length,9);assert.equal(list.offers.filter(o=>o.currency==='star_ring_core').length,2);assert.equal(list.balance,955);assert.equal(list.cosmetics.equipped,null);
});
test('main player, hero hall and expedition skill views expose the same equipped catalog object',async t=>{
 const {env,tg}=await fixture(t);await buy(env,tg,eclipse,'b');await wear(env,tg,eclipse,'w');
 const p=await loadPlayer(env.DB,tg);assert.equal(playerView(p,{now:T}).character.aura.id,eclipse);
 assert.equal((await Hall.get(env,tg,T)).hero.aura.id,eclipse);assert.equal((await Hall.list(env,T)).heroes.find(h=>h.id===tg).aura.id,eclipse);
 assert.equal((await SP.view(env,tg,T)).character.aura.id,eclipse);
 assert.equal(equippedAura({special_json:'invalid'}),null);assert.equal(equippedAura({special_json:'{"starRingAura":"unknown"}'}),null);
});
test('long expedition lobby and live cached battle projections reflect current visual without changing snapshot stats',async t=>{
 const {env,db,tg}=await fixture(t);await buy(env,tg,dawn,'buy');await wear(env,tg,dawn,'wear');
 const made=await R.create(env,tg,{tier:40},T);assert.equal(made.party.members[0].aura.id,dawn);
 const actor=E.snapshot(await loadPlayer(env.DB,tg)),state=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(made.party.id).state_json);
 Object.assign(state,{actors:[actor],startedAt:T,endsAt:T+E.DURATION,seed:'cosmetic-live',stageTactics:['balanced']});
 db.prepare("UPDATE rpg_star_ring_runs SET state_json=?,status='running',next_at=? WHERE id=?").run(JSON.stringify(state),T+E.STAGE_MS,made.party.id);
 const first=await R.view(env,made.party.id,tg,T+30000);assert.equal(first.battle.members[0].aura.id,dawn);
 await wear(env,tg,null,'off');const second=await R.view(env,made.party.id,tg,T+30000);
 assert.equal(second.battle.members[0].aura,null);assert.equal(second.battle.enemy.hp,first.battle.enemy.hp);assert.equal(second.battle.members[0].hp,first.battle.members[0].hp);
});
for(const initial of [null,dawn])test(`short party actual turns preserve mid-combat equip/unequip with ${initial?'an old equipped':'a legacy empty'} snapshot while saving skill cooldowns and HP/MP`,async t=>{
 const {env,db,tg,other}=await fixture(t);await buy(env,tg,dawn,'start-d');await buy(env,tg,moon,'start-m');
 if(initial)await wear(env,tg,initial,'initial-wear');
 const third='97603';await P.createCharacter(env,{tgId:third,name:'第三旅人',gender:'m',baseClass:'sword'},T);
 db.prepare("UPDATE rpg_characters SET level=40,class_path='A' WHERE tg_id=?").run(third);
 const {party:{id}}=await Party.create(env,tg,{kind:'dungeon',dungeonId:'pillar'},T);
 for(const who of [other,third])await Party.action(env,who,{partyId:id,op:'join'},T);
 for(const who of [tg,other,third])await Party.action(env,who,{partyId:id,op:'ready'},T);
 await Party.action(env,tg,{partyId:id,op:'start'},T);
 const s=JSON.parse(db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json);
 s.enemy.hp=s.enemy.maxHp=1000000000;
 for(const a of s.actors){a.hp=a.maxHp=1000000;a.mp=a.maxMp=1000;a.special.learned=['skill_01_1'];a.special.loadout=['skill_01_1'];a.special.cooldowns={};if(!initial)delete a.aura;}
 db.prepare('UPDATE rpg_parties SET state_json=? WHERE id=?').run(JSON.stringify(s),id);
 await C.equip(env,tg,{cosmeticId:moon,requestId:'midparty-wear'},T+1000);
 const first=await Party.view(env,id,tg,T+5001),row=db.prepare('SELECT hp,mp,special_json FROM rpg_characters WHERE tg_id=?').get(tg),special=JSON.parse(row.special_json);
 assert.equal(special.starRingAura,moon);assert.equal(first.members.find(m=>m.id===tg).aura.id,moon);
 assert.ok(special.cooldowns.skill_01_1>T+5001);assert.equal(row.hp,Math.max(1,first.members.find(m=>m.id===tg).hp));assert.equal(row.mp,first.members.find(m=>m.id===tg).mp);
 assert.equal(first.battleTurn.events.some(e=>e.actorId===tg&&e.skillId==='skill_01_1'),true);
 await C.equip(env,tg,{cosmeticId:null,requestId:'midparty-off'},T+6000);
 const second=await Party.view(env,id,tg,T+10002),current=JSON.parse(db.prepare('SELECT special_json FROM rpg_characters WHERE tg_id=?').get(tg).special_json);
 assert.equal(Object.hasOwn(current,'starRingAura'),false);assert.equal(second.members.find(m=>m.id===tg).aura,null);
 assert.deepEqual(current.cooldowns,special.cooldowns);assert.ok(second.battleTurn.sequence>first.battleTurn.sequence);
 assert.equal((await C.state(env,tg)).balance,820);
});
test('authenticated HTTP actions use selected character and ignore forged tgId ownership',async t=>{
 const {env,tg,other}=await fixture(t);
 const call=async(account,path,body={})=>{const r=await handle(new Request(`http://rpg/app/api/${path}`,{method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':account,'X-Debug-Now':String(T),'X-Monster-Art-Revision':MONSTER_ART_REVISION},body:JSON.stringify(body)}),env);return {status:r.status,body:await r.json()};};
 let r=await call(tg,'star-ring/shop',{offerId:dawn,requestId:'http-buy',tgId:other});assert.equal(r.status,200);
 r=await call(other,'star-ring/cosmetics/equip',{cosmeticId:dawn,requestId:'forged',tgId:tg});assert.equal(r.status,403);
 r=await call(tg,'star-ring/cosmetics/equip',{cosmeticId:dawn,requestId:'http-wear'});assert.equal(r.status,200);assert.equal(r.body.equipped.id,dawn);
 assert.equal((await call(tg,'me')).body.character.aura.id,dawn);assert.deepEqual((await call(other,'star-ring/cosmetics')).body.owned,[]);
 await P.createCharacter(env,{tgId:tg,name:'帳號分身',gender:'m',baseClass:'mage',charSlot:2},T);
 const alt=(await env.DB.prepare('SELECT tg_id FROM rpg_characters WHERE account_tg_id=? AND char_slot=2').bind(tg).first()).tg_id;
 await selectAccountCharacter(env,tg,alt,T);
 r=await call(tg,'star-ring/cosmetics/equip',{selectedCharacterId:tg,cosmeticId:dawn,requestId:'stale'});assert.equal(r.status,409);
 assert.equal((await C.state(env,tg)).equipped.id,dawn);assert.equal((await C.state(env,alt)).equipped,null);
});
test('0030 is additive and preserves every previous row/schema and foreign keys',async()=>{
 const db=new D1Shim(),dir=new URL('../migrations/',import.meta.url);for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<'0030').sort())db.sqlite.exec(readFileSync(new URL(name,dir),'utf8').replace(/\r\n/g,'\n'));
 await P.createCharacter({DB:db},{tgId:'97899',name:'保存旅人',gender:'m',baseClass:'sword'},T);
 const names=db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
 const snapshot=()=>({schema:db.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name NOT LIKE 'rpg_star_ring_cosmetic%' ORDER BY name").all(),rows:names.map(name=>[name,db.sqlite.prepare(`SELECT * FROM "${name}"`).all()])});
 const before=snapshot(),migration=readFileSync(new URL('0030_star_ring_cosmetics.sql',dir),'utf8');db.sqlite.exec(migration);
 assert.deepEqual(snapshot(),before);assert.doesNotMatch(migration,/\b(?:DROP|ALTER|DELETE|UPDATE|REPLACE)\b/i);assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.sqlite.close();
});
