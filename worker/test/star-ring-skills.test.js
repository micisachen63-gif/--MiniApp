import test from 'node:test';import assert from 'node:assert/strict';
import {skillExpedition,shortParty,NOW} from './star-ring-skill-fixture.js';
import * as Ring from '../src/services/star-ring.js';
import * as Party from '../src/services/party.js';
import * as Engine from '../src/game/star-ring.js';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.j));return r.j;};
async function fixture(t,options){const f=await skillExpedition(options);t.after(f.close);return f;}
const special=f=>JSON.parse(f.character().special_json);
async function replace(f,at=NOW+1){const [a,b,c,d]=f.choices;ok(await f.api({op:'loadout',loadout:[b,c]},at));ok(await f.api({op:'loadout',loadout:[b,c,d]},at+1));return [b,c,d];}

for(const version of [1,2,3])test(`v${version} existing expedition allows skill replacement and all automatic conditions while preserving departure actors and live resources`,async t=>{
 const f=await fixture(t,{version}),before=f.state(),char=f.character(),x=special(f),loadout=await replace(f);
 assert.deepEqual(special(f).loadout,loadout);assert.equal(special(f).auto[f.choices[0]],undefined);
 for(const mode of ['ready','elite','lowHp','manual']){ok(await f.api({op:'auto',skillId:loadout[2],mode}));assert.equal(special(f).auto[loadout[2]],mode==='manual'?undefined:mode);}
 const learned=ok(await f.api({op:'learn',skillId:f.choices[4]}));assert.ok(learned.special.learned.includes(f.choices[4]));
 assert.equal(f.db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').get(f.ids[0],'book_'+f.choices[4])?.quantity||0,0);
 assert.deepEqual(special(f).cooldowns,x.cooldowns);for(const key of ['hp','mp','gold','party_id'])assert.equal(f.character()[key],char[key]);
 assert.deepEqual(f.state(),before);
});
test('normal loadout and automatic validations still reject invalid configurations during expedition',async t=>{
 const f=await fixture(t),before=special(f),[a,b,c,d,unlearned]=f.choices;
 for(const body of [{op:'loadout',loadout:[a,b,c,d]},{op:'loadout',loadout:[a,a]},{op:'loadout',loadout:[unlearned]},{op:'loadout',loadout:['missing']},{op:'auto',skillId:d,mode:'ready'},{op:'auto',skillId:a,mode:'always'}]){
  const r=await f.api(body);assert.notEqual(r.status,200);assert.deepEqual(special(f),before);
 }
});
for(const kind of ['dungeon','tower'])test(`new ${kind} uses the changed skills, blocks edits in combat and restores expedition editing after ending`,async t=>{
 const f=await fixture(t),before=f.state(),loadout=await replace(f);ok(await f.api({op:'auto',skillId:loadout[2],mode:'ready'}));
 const id=await shortParty(f,kind),stored=f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json,actor=JSON.parse(stored).actors.find(a=>a.id===f.ids[0]);
 assert.deepEqual(actor.special.loadout,loadout);assert.equal(actor.special.auto[loadout[2]],'ready');
 const live=special(f);
 for(const op of [{op:'loadout',loadout:[]},{op:'auto',skillId:loadout[2],mode:'manual'}])assert.equal((await f.api(op,NOW+1001)).j.error,'party');
 assert.deepEqual(special(f),live);assert.equal(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json,stored);assert.deepEqual(f.state(),before);
 await Party.action(f.env,f.ids[0],{partyId:id,op:'end'},NOW+1002);assert.equal(f.character().party_id,f.id);
 ok(await f.api({op:'auto',skillId:loadout[2],mode:'manual'},NOW+1003));
});
for(const mode of ['fake','left','finished','foreground'])test(`${mode} membership cannot grant expedition skill edit permissions`,async t=>{
 const f=await fixture(t),before=special(f);
 if(mode==='fake'||mode==='foreground')f.db.prepare('UPDATE rpg_characters SET party_id=? WHERE tg_id=?').run(mode==='fake'?'ring:fake':'foreground-party',f.ids[0]);
 if(mode==='left')f.db.prepare('UPDATE rpg_star_ring_members SET left_at=? WHERE run_id=? AND char_id=?').run(NOW,f.id,f.ids[0]);
 if(mode==='finished')f.db.prepare("UPDATE rpg_star_ring_runs SET status='complete' WHERE id=?").run(f.id);
 for(const op of [{op:'loadout',loadout:[]},{op:'auto',skillId:f.choices[0],mode:'manual'}])assert.equal((await f.api(op)).j.error,'party');
 assert.deepEqual(special(f),before);
});
for(const mode of ['finished','foreground'])test(`skill edit rechecks ${mode} race inside the atomic commit`,async t=>{
 const f=await fixture(t),before=special(f),batch=f.env.DB.batch.bind(f.env.DB);let fired=false;
 f.env.DB.batch=async stmts=>{if(!fired&&stmts.some(s=>s.sql.startsWith('INSERT INTO rpg_guard(ok) SELECT NULL'))){fired=true;if(mode==='finished')f.db.prepare("UPDATE rpg_star_ring_runs SET status='complete' WHERE id=?").run(f.id);else{await shortParty(f,'dungeon',NOW+1000);assert.equal(special(f).partyStamina.points,80);before.partyStamina={...special(f).partyStamina};}}return batch(stmts);};
 const r=await f.api({op:'loadout',loadout:[]});assert.equal(fired,true);assert.notEqual(r.status,200);assert.deepEqual(special(f),before);
});
test('manual casting and cancellation retain their original party locks',async t=>{
 const f=await fixture(t),before=special(f);
 for(const body of [{op:'cast',skillId:f.choices[0]},{op:'cancel'}])assert.equal((await f.api(body)).j.error,'party');
 assert.deepEqual(special(f),before);
});
for(const version of [1,2,3])test(`v${version} changing live skills between all six checkpoints preserves every twelve-hour battle, 30 awards and the saved new configuration`,async t=>{
 const f=await fixture(t,{version}),control=await fixture(t,{version}),departure=f.state();departure.seed='unchanged-rewards-while-editing-skills-v'+version;
 for(const x of [f,control])x.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(departure),x.id);
 const rewards=x=>x.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(x.id);
 const originalInventory=x=>Object.fromEntries(x.db.prepare('SELECT item,quantity FROM rpg_inventory WHERE tg_id=?').all(x.ids[0]).map(r=>[r.item,r.quantity]));const inventoryBefore=originalInventory(f);
 for(let stage=0;stage<6;stage++){
  const at=NOW+stage*Engine.STAGE_MS+1,loadout=stage%2?f.choices.slice(0,3):f.choices.slice(1,4);ok(await f.api({op:'loadout',loadout},at));ok(await f.api({op:'auto',skillId:loadout[0],mode:stage%2?'ready':'elite'},at+1));const saved=special(f);
  const due=NOW+(stage+1)*Engine.STAGE_MS;assert.deepEqual((await Ring.sweep(f.env,due)).errors,[]);await Ring.sweep(control.env,due);
  assert.deepEqual(f.state().actors,departure.actors);assert.deepEqual(f.state().results,control.state().results);assert.deepEqual(rewards(f),rewards(control));assert.deepEqual(special(f),saved);
  assert.equal(rewards(f).length,5*(stage+1));
 }
 assert.equal(f.character().party_id,null);const done=await Ring.view(f.env,f.id,f.ids[0],NOW+Engine.DURATION+1),inv=originalInventory(f);
 for(const item of new Set([...Object.keys(inventoryBefore),...Object.keys(inv),...Object.keys(done.me.rewards.items)]))assert.equal(inv[item]||0,(inventoryBefore[item]||0)+(done.me.rewards.items[item]||0));
 assert.equal(f.db.prepare('SELECT count(*) n FROM rpg_ledger WHERE event_id LIKE ?').get('star-ring:'+f.id+':%').n,30);
 await Ring.sweep(f.env,NOW+Engine.DURATION+60000);assert.equal(rewards(f).length,30);
});
