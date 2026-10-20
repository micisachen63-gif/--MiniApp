import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {configurationExpedition} from './star-ring-configuration-fixture.js';
import {shortParty,NOW} from './star-ring-skill-fixture.js';
import * as Ring from '../src/services/star-ring.js';import * as Party from '../src/services/party.js';import * as Engine from '../src/game/star-ring.js';
import {loadPlayer} from '../src/db.js';import {computeStats} from '../src/game/stats.js';
import * as Trade from '../src/services/trade.js';import {expToNext} from '../src/game/formulas.js';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.j));return r.j;};
const special=f=>JSON.parse(f.character().special_json),stones=f=>f.db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='guardian_summon_stone'").get(f.ids[0]).quantity;
const shortState=(f,id)=>JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json);
const awards=f=>f.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id);
async function fixture(t,version=3){const f=await configurationExpedition({version});t.after(f.close);return f;}
async function replace(f,label,feather,at=NOW+1){
 ok(await f.post('unequip',{slot:'helmet'},at));ok(await f.post('equip',{itemId:'configuration-'+label},at+1));
 ok(await f.post('guardian/assist',{mode:'stop'},at+2));const body={mode:'start',itemId:f.feathers[feather],autoRenew:false,requestId:'configuration-'+label+'-'+at},n=stones(f);
 const receipt=ok(await f.post('guardian/assist',body,at+3));assert.equal(stones(f),n-1);
 assert.deepEqual(ok(await f.post('guardian/assist',body,at+4)).operation,receipt.operation);assert.equal(stones(f),n-1,'receipt replay never consumes another stone');
 assert.equal(f.active().id,f.feathers[feather]);assert.equal(f.active().bound,1);assert.equal(special(f).guardianAssist.itemId,f.feathers[feather]);
}
async function assertActor(f,id,expected){
 const a=shortState(f,id).actors.find(a=>a.id===f.ids[0]);for(const key of ['atk','def','maxHp','maxMp','guardian'])assert.deepEqual(a[key],expected[key],key);
}
async function expectedActor(f){return Engine.snapshot(await loadPlayer(f.env.DB,f.ids[0]));}

for(const version of [1,2,3])for(const kind of ['dungeon','tower'])for(const ringFirst of [false,true])test(`v${version} ${kind}: equipment/guardian persist through a real win and ${ringFirst?'concurrent':'later'} expedition completion`,async t=>{
 const f=await fixture(t,version),control=await fixture(t,version),departure=f.state();departure.seed='gear-guardian-'+version+kind+ringFirst;
 for(const run of [f,control])run.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(departure),run.id);
 await replace(f,'b',1);assert.deepEqual(f.state(),departure);
 const before=await expectedActor(f),at=ringFirst?NOW+Engine.DURATION-1000:NOW+1000,id=await shortParty(f,kind,at);await assertActor(f,id,before);
 assert.notDeepEqual(before.guardian,departure.actors[0].guardian);assert.notEqual(before.def,departure.actors[0].def);
 if(ringFirst){const live=f.character();assert.deepEqual((await Ring.sweep(f.env,NOW+Engine.DURATION)).errors,[]);for(const key of ['hp','mp','party_id'])assert.equal(f.character()[key],live[key]);}
 let p=await Party.view(f.env,id,f.ids[0],shortState(f,id).deadline);
 for(let turn=0;p.status==='combat'&&turn<400;turn++)p=await Party.view(f.env,id,f.ids[0],p.deadline);
 assert.equal(p.status,'won');assert.ok(p.me.reward);assert.equal(f.db.prepare('SELECT count(*) n FROM rpg_party_rewards WHERE party_id=?').get(id).n,3);
 const won=shortState(f,id);assert.equal(f.active().id,f.feathers[1]);assert.ok(f.equipped().some(e=>e.id==='configuration-b'));
 const afterAt=won.endedAt+1;await replace(f,'c',2,afterAt);const latest=await expectedActor(f),equipped=f.equipped(),active=f.active(),assist=special(f).guardianAssist,n=stones(f);
 for(let retry=0;retry<2;retry++){await Party.view(f.env,id,f.ids[0],afterAt+10+retry);await Party.reward(f.env,f.ids[0],{partyId:id},afterAt+10+retry);}
 const end=Math.max(NOW+Engine.DURATION,afterAt+20);assert.deepEqual((await Ring.sweep(f.env,end)).errors,[]);await Ring.sweep(control.env,NOW+Engine.DURATION);
 await Ring.sweep(f.env,end+60000);await Party.sweep(f.env,end+60000);await Party.view(f.env,id,f.ids[0],end+60000);await Party.reward(f.env,f.ids[0],{partyId:id},end+60000);
 assert.deepEqual(f.equipped(),equipped);assert.deepEqual(f.active(),active);assert.deepEqual(special(f).guardianAssist,assist);assert.equal(stones(f),n);assert.equal(f.character().party_id,null);
 assert.deepEqual(f.state().actors,departure.actors);assert.deepEqual(f.state().results,control.state().results);assert.deepEqual(awards(f),awards(control));assert.equal(awards(f).length,30);
 const nextId=await shortParty(f,kind==='tower'?'dungeon':kind,end+60001),current=await expectedActor(f);await assertActor(f,nextId,current);assert.equal(current.guardian.id,latest.guardian.id);
 await Party.action(f.env,f.ids[0],{partyId:nextId,op:'end'},end+60002);
});

test('permanent activation, deactivation, legacy selection and assist toggles are future configuration only',async t=>{
 const f=await fixture(t),departure=f.state(),n=stones(f);
 ok(await f.post('guardian/activate',{itemId:f.feathers[2]}));assert.equal(f.active().id,f.feathers[2]);assert.equal(special(f).guardianAssist,undefined);
 ok(await f.post('guardian/activate',{itemId:null}));assert.equal(f.active(),undefined);
 ok(await f.post('expedition/action',{op:'settings',mode:'safe',budget:0,guardianId:f.feathers[3]}));assert.equal(f.active().id,f.feathers[3]);
 for(const body of [{mode:'continuation',autoRenew:false},{mode:'supply',autoBuy:true},{mode:'renew',autoRenew:false},{mode:'select',itemId:f.feathers[4]},{mode:'stop'}])ok(await f.post('guardian/assist',body));
 assert.equal(stones(f),n);assert.equal(f.active().id,f.feathers[4]);assert.equal(special(f).guardianSummonEnabled,false);assert.deepEqual(f.state(),departure);
});

for(const mode of ['fake','left','finished','foreground'])test(`${mode} membership cannot edit gear or guardian configuration`,async t=>{
 const f=await fixture(t),equipment=f.equipped(),active=f.active(),x=special(f),n=stones(f);
 if(mode==='foreground'){await shortParty(f,'dungeon');assert.equal(special(f).partyStamina.points,80);x.partyStamina={...special(f).partyStamina};}
 if(mode==='fake')f.db.prepare("UPDATE rpg_characters SET party_id='ring:fake' WHERE tg_id=?").run(f.ids[0]);
 if(mode==='left')f.db.prepare('UPDATE rpg_star_ring_members SET left_at=? WHERE run_id=? AND char_id=?').run(NOW,f.id,f.ids[0]);
 if(mode==='finished')f.db.prepare("UPDATE rpg_star_ring_runs SET status='complete' WHERE id=?").run(f.id);
 for(const [path,body] of [['equip',{itemId:'configuration-b'}],['unequip',{slot:'helmet'}],['guardian/activate',{itemId:f.feathers[1]}],['guardian/assist',{mode:'stop'}],['expedition/action',{op:'settings',mode:'safe',budget:0,guardianId:f.feathers[2]}]])assert.equal((await f.post(path,body)).j.error,'party');
 assert.deepEqual(f.equipped(),equipment);assert.deepEqual(f.active(),active);assert.deepEqual(special(f),x);assert.equal(stones(f),n);
});

for(const path of ['equip','unequip','guardian/activate','guardian/assist','expedition/action'])test(`${path} rechecks a newly started foreground party inside the atomic commit`,async t=>{
 const f=await fixture(t),equipment=f.equipped(),active=f.active(),n=stones(f),batch=f.env.DB.batch.bind(f.env.DB);let fired=false;
 f.env.DB.batch=async stmts=>{if(!fired&&stmts.some(s=>s.sql.startsWith('INSERT INTO rpg_guard(ok) SELECT NULL'))){fired=true;await shortParty(f,'dungeon');}return batch(stmts);};
 const bodies={equip:{itemId:'configuration-b'},unequip:{slot:'helmet'},'guardian/activate':{itemId:f.feathers[1]},'guardian/assist':{mode:'stop'},'expedition/action':{op:'settings',mode:'safe',budget:0,guardianId:f.feathers[2]}};
 assert.notEqual((await f.post(path,bodies[path])).status,200);assert.equal(fired,true);assert.deepEqual(f.equipped(),equipment);assert.deepEqual(f.active(),active);assert.equal(stones(f),n);
});

test('gear and guardian ownership, escrow, requirements and existing summon costs remain enforced',async t=>{
 const f=await fixture(t),equipment=f.equipped(),active=f.active();
 const opened=await Trade.openWithEquip(f.env,{tgId:f.ids[0],target:{tgId:f.ids[1]},equipId:'configuration-b',requestId:'configuration-escrow'},NOW+1);
 await Trade.addLine(f.env,{tgId:f.ids[0],tradeId:opened.tradeId,sigilId:f.feathers[1]},NOW+2);
 assert.notEqual((await f.post('equip',{itemId:'configuration-b'})).status,200);assert.notEqual((await f.post('guardian/activate',{itemId:f.feathers[1]})).status,200);
 assert.notEqual((await f.post('guardian/assist',{mode:'start',itemId:f.feathers[2]})).status,200,'must stop the old summon first');
 f.db.prepare("UPDATE rpg_equipment SET level_req=200 WHERE id='configuration-c'").run();assert.notEqual((await f.post('equip',{itemId:'configuration-c'})).status,200);
 assert.notEqual((await f.post('equip',{itemId:'configuration-a'},NOW+1,f.ids[1])).status,200);assert.notEqual((await f.post('guardian/activate',{itemId:f.feathers[2]},NOW+1,f.ids[1])).status,200);
 assert.deepEqual(f.equipped(),equipment);assert.deepEqual(f.active(),active);
});

for(const label of ['b','c'])test(`level-up healing uses current ${label==='b'?'lower':'higher'} HP/MP equipment while expedition actors stay frozen`,async t=>{
 const f=await fixture(t),departure=f.state();ok(await f.post('equip',{itemId:'configuration-'+label}));const live=f.character();
 f.db.prepare("UPDATE rpg_characters SET class_path='A11',exp=? WHERE tg_id=?").run(expToNext(80)-1,f.ids[0]);
 assert.ok(live.hp<=departure.actors[0].maxHp,'equipping never grants free healing');
 const sweep=await Ring.sweep(f.env,NOW+Engine.DURATION);assert.deepEqual(sweep.errors,[]);assert.ok(f.character().level>80,'fixture must actually level up');
 const player=await loadPlayer(f.env.DB,f.ids[0]),s=computeStats(player.char,player.equipment.filter(e=>e.is_equipped));assert.equal(player.char.hp,s.maxHp);assert.equal(player.char.mp,s.maxMp);assert.deepEqual(f.state().actors,departure.actors);
});

test('0032 preserves every populated row, sequence and all other schema; active transfer/delete and false memberships stay protected',async t=>{
 const f=await fixture(t),db=f.db,name='guardian_sigil_party_update',old=readFileSync(new URL('../migrations/0031_star_ring_guardian_backpack.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n'),sql=readFileSync(new URL('../migrations/0032_star_ring_guardian_configuration.sql',import.meta.url),'utf8');
 db.exec('DROP TRIGGER '+name);db.exec(old.match(/CREATE TRIGGER guardian_sigil_party_update[\s\S]*?END;/)[0]);assert.throws(()=>db.prepare('UPDATE rpg_guardian_sigils SET active=0 WHERE id=?').run(f.feathers[0]),/guardian_party_locked/);
 const objects=()=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name<>? ORDER BY name").all(name),rows=()=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r=>[r.name,db.prepare('SELECT rowid,* FROM '+JSON.stringify(r.name)+' ORDER BY rowid').all()]));
 const before=rows(),schema=objects();db.exec('BEGIN');db.exec(sql);db.exec('COMMIT');assert.deepEqual(rows(),before);assert.deepEqual(objects(),schema);
 assert.throws(()=>db.prepare('UPDATE rpg_guardian_sigils SET char_id=? WHERE id=?').run(f.ids[1],f.feathers[0]),/guardian_party_locked|guardian_sigil_protected/);assert.throws(()=>db.prepare('DELETE FROM rpg_guardian_sigils WHERE id=?').run(f.feathers[0]),/guardian_party_locked|guardian_sigil_protected/);
 db.prepare('UPDATE rpg_guardian_sigils SET active=0 WHERE id=?').run(f.feathers[0]);db.prepare('UPDATE rpg_guardian_sigils SET active=1,bound=1 WHERE id=?').run(f.feathers[1]);
 f.db.prepare("UPDATE rpg_characters SET party_id='ring:fake' WHERE tg_id=?").run(f.ids[0]);assert.throws(()=>db.prepare('UPDATE rpg_guardian_sigils SET active=0 WHERE id=?').run(f.feathers[1]),/guardian_party_locked/);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
