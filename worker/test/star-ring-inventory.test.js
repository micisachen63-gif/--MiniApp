import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import * as R from '../src/services/star-ring.js';
import * as E from '../src/game/star-ring.js';
import * as G from '../src/services/guardian-sigil.js';
import * as Shop from '../src/services/guardian-shop.js';
import * as Trade from '../src/services/trade.js';
import * as Share from '../src/services/share.js';
import * as Auto from '../src/services/auto-reroll.js';
import {insertEquipStmt,loadPlayer} from '../src/db.js';
import {makeGear} from '../src/game/gear.js';
import {computeStats} from '../src/game/stats.js';
import {MONSTER_RECIPES} from '../src/game/monsters.js';
import {BOSS_EXCHANGES} from '../src/game/boss-economy.js';
import {SPECIAL_SKILLS,eligible} from '../src/game/special.js';
const now=Date.parse('2026-10-19T00:00:00Z'),ids=['8911','8912','8913','8914','8915'],outside='8999';
async function fixture(t,version=3){
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'},db=env.DB.sqlite;t.after(()=>db.close());
 for(const[i,tgId]of [...ids,outside].entries()){
  await P.createCharacter(env,{tgId,name:'行囊旅人'+i,baseClass:['sword','mage','archer','thief','sword','sword'][i],gender:'m'},now);
  db.prepare("UPDATE rpg_characters SET level=80,class_path='A1',gold=100000000 WHERE tg_id=?").run(tgId);
  const p=await loadPlayer(env.DB,tgId),s=computeStats(p.char,p.equipment.filter(e=>e.is_equipped));db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(s.maxHp,s.maxMp,tgId);
 }
 await G.summon(env,ids[0],{pool:'normal',count:10,requestId:'inventory-fixture'},now);
 db.prepare("UPDATE rpg_guardian_sigils SET type='melee',quality=1 WHERE char_id=?").run(ids[0]);
 const feathers=db.prepare('SELECT id FROM rpg_guardian_sigils WHERE char_id=? ORDER BY id').all(ids[0]).map(r=>r.id);
 await G.activate(env,ids[0],{itemId:feathers[0],requestId:'fixture-guardian-active'},now);
 await insertEquipStmt(env.DB,{...makeGear({id:'inventory-bag',tgId:ids[0],cls:'sword',slot:'helmet',tier:3,rng:()=>.5,source:'shop',now}),is_equipped:0,bound:0}).run();
 for(const item of ['scroll_r','scroll_w','unbind','research_fragment','guardian_summon_stone','boss_essence'])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,1000) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=1000').run(ids[0],item);
 const id=(await R.create(env,ids[0],{tier:80},now)).party.id,s=JSON.parse(db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(id).state_json);s.engineVersion=version;db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(s),id);
 for(const who of ids.slice(1))await R.action(env,who,{partyId:id,action:'join'},now);for(const who of ids)await R.action(env,who,{partyId:id,action:'ready'},now);await R.action(env,ids[0],{partyId:id,action:'start'},now);
 const api=async(action,body={},who=ids[0],at=now+1)=>{const r=await handle(new CurrentClientRequest('https://local/app/api/'+action,{method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':who,'X-Debug-Now':String(at)},body:JSON.stringify({characterId:who,requestId:crypto.randomUUID(),...body})}),env);return {status:r.status,j:await r.json()};};
 return {env,db,id,feathers,api};
}
const state=f=>JSON.parse(f.db.prepare('SELECT state_json FROM rpg_star_ring_runs WHERE id=?').get(f.id).state_json);
const character=f=>f.db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(ids[0]);
const feather=(f,id)=>f.db.prepare('SELECT * FROM rpg_guardian_sigils WHERE id=?').get(id);
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.j));return r.j;};
async function windowWithFeather(f,who=ids[1]){
 const post=await G.share(f.env,ids[0],{itemId:f.feathers[1],requestId:'inventory-share-'+crypto.randomUUID()},now+1);
 const request=await Share.requestTrade(f.env,{tgId:who,shareId:post.operation.shareId},now+2);
 const accepted=await Share.acceptRequest(f.env,{tgId:ids[0],requestId:request.id},now+3);return {...accepted,tradeId:accepted.trade.id};
}
async function confirm(f,id){await Trade.lock(f.env,{tgId:ids[0],tradeId:id},now+4);await Trade.lock(f.env,{tgId:ids[1],tradeId:id},now+5);await Trade.confirm(f.env,{tgId:ids[0],tradeId:id},now+6);return Trade.confirm(f.env,{tgId:ids[1],tradeId:id},now+7);}
for(const version of [1,2,3])test(`v${version}: guardian fusion, binding inheritance and recovery work during existing expedition without touching active companion`,async t=>{
 const f=await fixture(t,version),before=state(f),c=character(f),materials=f.feathers.slice(2,6);f.db.prepare('UPDATE rpg_guardian_sigils SET bound=1 WHERE id=?').run(materials[0]);
 const input={itemIds:materials,primaryId:materials[0],requestId:crypto.randomUUID()},a=ok(await f.api('guardian/fuse',input));const again=ok(await f.api('guardian/fuse',input));assert.equal(again.operation.operationId,a.operation.operationId);assert.equal(a.operation.results[0].bound,true);
 assert.deepEqual(state(f),before);assert.equal(feather(f,f.feathers[0]).active,1);assert.equal(character(f).hp,c.hp);assert.equal(character(f).mp,c.mp);assert.equal(character(f).party_id,f.id);
});
for(const buyer of [ids[1],outside])test(`market guardian sale settles for ${buyer===outside?'outside':'expedition'} buyer while seller remains on expedition`,async t=>{
 const f=await fixture(t),before=state(f),id=f.feathers[1];const candidates=ok(await f.api('exchange/sellable',{filters:{category:'guardian'}}));assert.ok(candidates.items.some(x=>x.guardianId===id));
 const listing=ok(await f.api('exchange/create',{guardianId:id,price:101})).result.listingId;
 const buy={listingId:listing,requestId:crypto.randomUUID()};ok(await f.api('exchange/buy',buy,buyer));ok(await f.api('exchange/buy',buy,buyer));assert.equal(feather(f,id).char_id,buyer);assert.equal(feather(f,id).bound,0);assert.deepEqual(state(f),before);
});
test('expedition buyer can purchase gear and stack items, and withdraw a guardian listing',async t=>{
 const f=await fixture(t),before=state(f);for(const body of [{equipId:'inventory-bag'},{item:'scroll_w',qty:3}]){const listing=ok(await f.api('exchange/create',{...body,price:101})).result.listingId;ok(await f.api('exchange/buy',{listingId:listing},ids[1]));}
 const listing=ok(await f.api('exchange/create',{guardianId:f.feathers[1],price:101})).result.listingId;ok(await f.api('exchange/cancel',{listingId:listing}));assert.equal(feather(f,f.feathers[1]).exchange_id,null);assert.deepEqual(state(f),before);
});
test('two expedition players share, accept, escrow a guardian and complete both confirmations exactly once',async t=>{
 const f=await fixture(t),before=state(f),opened=await windowWithFeather(f);assert.ok(opened.tradeId);assert.equal(feather(f,f.feathers[1]).trade_id,opened.tradeId);
 assert.equal((await confirm(f,opened.tradeId)).done,true);assert.equal(feather(f,f.feathers[1]).char_id,ids[1]);assert.equal(feather(f,f.feathers[1]).active,0);assert.deepEqual(state(f),before);
});
test('cancel and expiry return guardian escrow during expedition',async t=>{
 for(const cancel of [true,false]){const f=await fixture(t),opened=await windowWithFeather(f);if(cancel)await Trade.cancel(f.env,{tgId:ids[0],tradeId:opened.tradeId},now+5);else await Trade.expireDue(f.env,now+31*60000);assert.equal(feather(f,f.feathers[1]).char_id,ids[0]);assert.equal(feather(f,f.feathers[1]).trade_id,null);}
});
test('guardian shop permits bound unused cards and idempotent sale during expedition',async t=>{
 const f=await fixture(t),before=state(f),id=f.feathers[1];f.db.prepare('UPDATE rpg_guardian_sigils SET bound=1 WHERE id=?').run(id);const input={itemIds:[id],expectedGold:10,requestId:crypto.randomUUID()};ok(await f.api('guardian/shop/sell',input));ok(await f.api('guardian/shop/sell',input));assert.equal(feather(f,id),undefined);assert.deepEqual(state(f),before);
});
test('guardian lock, unbind and stone purchase affect only unused inventory',async t=>{
 const f=await fixture(t),before=state(f),id=f.feathers[1];ok(await f.api('guardian/lock',{itemId:id,locked:true}));ok(await f.api('guardian/lock',{itemId:id,locked:false}));f.db.prepare('UPDATE rpg_guardian_sigils SET bound=1 WHERE id=?').run(id);ok(await f.api('guardian/unbind',{itemId:id}));assert.equal(feather(f,id).bound,0);ok(await f.api('guardian/assist',{mode:'buy',quantity:2}));assert.deepEqual(state(f),before);
});
test('manual and scheduled automatic reroll preserve current HP MP and departure stats',async t=>{
 const f=await fixture(t),before=state(f);f.db.prepare('UPDATE rpg_characters SET hp=123,mp=45 WHERE tg_id=?').run(ids[0]);ok(await f.api('reroll',{itemId:'inventory-bag'}));
 // The preceding manual roll can legitimately reach SS. This regression must
 // exercise a scheduled attempt, so start that phase below target explicitly.
 f.db.prepare("UPDATE rpg_equipment SET affixes_json='[]' WHERE id='inventory-bag'").run();
 const j=ok(await f.api('auto-reroll/start',{itemId:'inventory-bag',functions:['attack'],quality:'SS',maxGold:1000000})).job;assert.equal(j.status,'running');assert.equal(await Auto.step(f.env,j.id,now+2,()=>.01),true);assert.ok((await Auto.view(f.env,ids[0])).attempts>0);await Auto.stop(f.env,ids[0],{jobId:j.id},now+3);assert.equal(character(f).hp,123);assert.equal(character(f).mp,45);assert.deepEqual(state(f),before);
});
test('material crafting, refining, boss exchange and skillbook redemption remain available during expedition',async t=>{
 const f=await fixture(t),before=state(f),recipe=MONSTER_RECIPES[0];for(const m of recipe.ingredients)f.db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(ids[0],m.item,m.qty);
 ok(await f.api('monster-exchange',{recipe:recipe.id}));f.db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'hunt_2_1',3)").run(ids[0]);ok(await f.api('monster-exchange',{action:'refine',sourceItem:'hunt_2_1',refineTarget:'hunt_1_1',count:1}));
 const offer=Object.keys(BOSS_EXCHANGES).find(k=>k!=='relic'&&(BOSS_EXCHANGES[k].currency||'boss_essence')==='boss_essence');ok(await f.api('boss-exchange',{offer}));const c=character(f),skill=SPECIAL_SKILLS.find(s=>eligible(c,s));ok(await f.api('expedition/action',{op:'redeem',skillId:skill.id}));ok(await f.api('expedition/share',{skillId:skill.id}));ok(await f.api('expedition/action',{op:'learn',skillId:skill.id}));assert.deepEqual(state(f),before);
});
for(const protection of ['active','locked','trade','exchange'])test(`${protection} guardian cannot be fused, sold or double-listed while expedition runs`,async t=>{
 const f=await fixture(t),id=f.feathers[protection==='active'?0:1];if(protection==='locked')f.db.prepare('UPDATE rpg_guardian_sigils SET locked=1 WHERE id=?').run(id);else if(protection==='trade')await windowWithFeather(f);else if(protection==='exchange')ok(await f.api('exchange/create',{guardianId:id,price:101}));
 const before=feather(f,id);assert.notEqual((await f.api('guardian/fuse',{itemIds:[id,...f.feathers.slice(2,5)]})).status,200);assert.notEqual((await f.api('guardian/shop/sell',{itemIds:[id],expectedGold:10,requestId:crypto.randomUUID()})).status,200);assert.notEqual((await f.api('exchange/create',{guardianId:id,price:101})).status,200);assert.deepEqual(feather(f,id),before);
});
test('bound guardian is excluded from market and direct trade, but remains a valid fusion or merchant material',async t=>{
 const f=await fixture(t),id=f.feathers[1];f.db.prepare('UPDATE rpg_guardian_sigils SET bound=1 WHERE id=?').run(id);assert.equal((await f.api('exchange/create',{guardianId:id,price:101})).j.error,'protected');const rows=ok(await f.api('exchange/sellable',{filters:{category:'guardian'}})).items;assert.ok(!rows.some(r=>r.guardianId===id));assert.equal((await Shop.list(f.env,ids[0],{})).items.find(x=>x.id===id).sellBlock,null);
});
for(const mode of ['fake','left','finished','short-party'])test(`${mode} cannot spoof remote backpack permissions`,async t=>{
 const f=await fixture(t);if(mode==='fake'||mode==='short-party')f.db.prepare('UPDATE rpg_characters SET party_id=? WHERE tg_id=?').run(mode==='fake'?'ring:fake':'dungeon:foreground',ids[0]);if(mode==='left')f.db.prepare('UPDATE rpg_star_ring_members SET left_at=? WHERE run_id=? AND char_id=?').run(now,f.id,ids[0]);if(mode==='finished')f.db.prepare("UPDATE rpg_star_ring_runs SET status='complete' WHERE id=?").run(f.id);
 for(const [action,body]of [['guardian/fuse',{itemIds:f.feathers.slice(2,6)}],['guardian/shop/sell',{itemIds:[f.feathers[1]],expectedGold:10,requestId:crypto.randomUUID()}],['exchange/create',{guardianId:f.feathers[1],price:10}],['reroll',{itemId:'inventory-bag'}]])assert.equal((await f.api(action,body)).j.error,'party');
});
test('guardian transaction checks real expedition membership again in the commit batch',async t=>{
 const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);let fired=false;f.env.DB.batch=async stmts=>{if(!fired&&stmts.some(x=>x.sql.startsWith('DELETE FROM rpg_guardian_sigils'))){fired=true;f.db.prepare("UPDATE rpg_star_ring_runs SET status='complete' WHERE id=?").run(f.id);}return batch(stmts);};const r=await f.api('guardian/fuse',{itemIds:f.feathers.slice(2,6)});assert.equal(fired,true);assert.notEqual(r.status,200);for(const id of f.feathers.slice(2,6))assert.ok(feather(f,id));
});
test('inventory transactions preserve every twelve-hour battle result and all 30 reward receipts',async t=>{
 const f=await fixture(t),control=await fixture(t),s=state(f);s.seed='inventory-work-independent-of-combat';for(const x of [f,control])x.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(s),x.id);
 ok(await f.api('guardian/fuse',{itemIds:f.feathers.slice(2,6)}));const opened=await windowWithFeather(f);await confirm(f,opened.tradeId);ok(await f.api('reroll',{itemId:'inventory-bag'}));
 await R.sweep(f.env,now+E.DURATION);await R.sweep(control.env,now+E.DURATION);assert.deepEqual(state(f).actors,s.actors);assert.deepEqual(state(f).results,state(control).results);const rewards=x=>x.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(x.id);assert.equal(rewards(f).length,30);assert.deepEqual(rewards(f),rewards(control));
});
import {readFileSync} from 'node:fs';
test('populated 0031 upgrade changes only the two trigger definitions and preserves every row and sequence',async t=>{
 const f=await fixture(t),db=f.db,migration=readFileSync(new URL('../migrations/0031_star_ring_guardian_backpack.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n'),legacy=readFileSync(new URL('../migrations/0016_guardian_sigils.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 for(const name of ['guardian_sigil_party_update','guardian_sigil_party_delete']){db.exec('DROP TRIGGER '+name);db.exec(legacy.match(new RegExp('CREATE TRIGGER '+name+'[\\s\\S]*?END;'))[0]);}
 assert.throws(()=>db.prepare('UPDATE rpg_guardian_sigils SET locked=1 WHERE id=?').run(f.feathers[1]),/guardian_party_locked/);
 const schema=()=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT IN ('guardian_sigil_party_update','guardian_sigil_party_delete') ORDER BY name").all(),data=()=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r=>[r.name,db.prepare('SELECT rowid,* FROM '+JSON.stringify(r.name)+' ORDER BY rowid').all()]));
 const before=data(),objects=schema();db.exec('BEGIN');db.exec(migration);db.exec('COMMIT');assert.deepEqual(data(),before);assert.deepEqual(schema(),objects);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 db.prepare('UPDATE rpg_guardian_sigils SET locked=1 WHERE id=?').run(f.feathers[1]);assert.throws(()=>db.prepare('UPDATE rpg_guardian_sigils SET active=1 WHERE id=?').run(f.feathers[2]),/guardian_party_locked/);assert.throws(()=>db.prepare('DELETE FROM rpg_guardian_sigils WHERE id=?').run(f.feathers[0]),/guardian_party_locked|guardian_sigil_protected/);
});
test('mixed direct trade can add and remove guardians, equipment, items and gold during expedition',async t=>{
 const f=await fixture(t),before=state(f),opened=await Trade.openWithEquip(f.env,{tgId:ids[0],target:{tgId:ids[1]},equipId:'inventory-bag',requestId:'inventory-mixed'},now+1),tradeId=opened.tradeId;
 await Trade.addLine(f.env,{tgId:ids[0],tradeId,sigilId:f.feathers[1]},now+2);await Trade.removeLine(f.env,{tgId:ids[0],tradeId,sigilId:f.feathers[1]},now+3);await Trade.addLine(f.env,{tgId:ids[0],tradeId,sigilId:f.feathers[1]},now+4);await Trade.addLine(f.env,{tgId:ids[0],tradeId,item:'scroll_w',qty:2},now+5);await Trade.setGold(f.env,{tgId:ids[1],tradeId,gold:101},now+6);await confirm(f,tradeId);assert.equal(feather(f,f.feathers[1]).char_id,ids[1]);assert.equal(f.db.prepare("SELECT tg_id FROM rpg_equipment WHERE id='inventory-bag'").get().tg_id,ids[1]);assert.deepEqual(state(f),before);
});
test('final guardian confirmation cannot complete after a participant enters a foreground combat',async t=>{
 const f=await fixture(t),opened=await windowWithFeather(f),tradeId=opened.tradeId;await Trade.lock(f.env,{tgId:ids[0],tradeId},now+4);await Trade.lock(f.env,{tgId:ids[1],tradeId},now+5);await Trade.confirm(f.env,{tgId:ids[0],tradeId},now+6);f.db.prepare("UPDATE rpg_characters SET party_id='foreground' WHERE tg_id=?").run(ids[1]);await assert.rejects(Trade.confirm(f.env,{tgId:ids[1],tradeId},now+7));assert.equal(feather(f,f.feathers[1]).char_id,ids[0]);assert.equal((await Trade.tradeView(f.env,tradeId,ids[0],now+8)).status,'open');
});
test('missing automatic reroll item ends cleanly on an expedition without charging',async t=>{
 const f=await fixture(t),j=ok(await f.api('auto-reroll/start',{itemId:'inventory-bag',functions:['attack'],quality:'SS'})).job;f.db.prepare("UPDATE rpg_auto_reroll SET status='processing' WHERE id=?").run(j.id);f.db.prepare("DELETE FROM rpg_equipment WHERE id='inventory-bag'").run();f.db.prepare("UPDATE rpg_auto_reroll SET status='running' WHERE id=?").run(j.id);const gold=character(f).gold;assert.equal(await Auto.step(f.env,j.id,now+2,()=>.1),true);assert.equal((await Auto.view(f.env,ids[0])).reason,'missing');assert.equal(character(f).gold,gold);
});
