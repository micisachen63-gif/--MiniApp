import test from 'node:test';import assert from 'node:assert/strict';
import {configurationExpedition} from './star-ring-configuration-fixture.js';import {shortParty,NOW} from './star-ring-skill-fixture.js';
import * as Tower from '../src/services/tower.js';import * as Ring from '../src/services/star-ring.js';import * as Party from '../src/services/party.js';import * as Engine from '../src/game/star-ring.js';import {loadPlayer} from '../src/db.js';import {imprintLevel} from '../src/game/tower-progression.js';
const awards=f=>f.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id);
for(const version of [1,2,3])test(`published expedition v${version}: imprint changes new tower/dungeon configuration only; all twelve-hour results and thirty rewards stay identical`,async t=>{
 const f=await configurationExpedition({version}),control=await configurationExpedition({version});t.after(f.close);t.after(control.close);const departure=f.state();departure.seed='tower-imprint-isolation-'+version;
 for(const run of [f,control])run.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(departure),run.id);
 const owner=f.ids[0];f.db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'tower_fragment',500)").run(owner);
 const crafted=await f.post('tower/action',{op:'imprint',itemId:'configuration-b',from:0,requestId:'one-imprint'},NOW+1);assert.equal(crafted.status,200);assert.equal(crafted.j.result.to,1);assert.deepEqual(f.state(),departure);
 const equip=await f.post('equip',{itemId:'configuration-b'},NOW+2);assert.equal(equip.status,200);assert.deepEqual(f.state(),departure);
 let at=NOW+1000;
 for(const kind of ['dungeon','tower']){
  const current=Engine.snapshot(await loadPlayer(f.env.DB,owner)),id=await shortParty(f,kind,at),state=()=>JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json),actor=state().actors.find(a=>a.id===owner);
  for(const key of ['atk','def','maxHp','maxMp'])assert.equal(actor[key],current[key],kind+':'+key);
  const badges=(await loadPlayer(f.env.DB,owner)).inv.tower_fragment;await assert.rejects(Tower.action(f.env,owner,{op:'imprint',itemId:'configuration-c',from:0,requestId:'blocked-'+kind},at),e=>e.code==='party');assert.equal((await loadPlayer(f.env.DB,owner)).inv.tower_fragment,badges);
  let p=await Party.view(f.env,id,owner,state().deadline);for(let i=0;p.status==='combat'&&i<400;i++)p=await Party.view(f.env,id,owner,p.deadline);assert.equal(p.status,'won');at=state().endedAt+1;assert.equal(imprintLevel(f.db.prepare("SELECT * FROM rpg_equipment WHERE id='configuration-b'").get()),1);
 }
 const title=JSON.parse(f.character().special_json).towerTitle;assert.equal(title,'tower_10');assert.deepEqual((await Ring.sweep(f.env,NOW+Engine.DURATION)).errors,[]);await Ring.sweep(control.env,NOW+Engine.DURATION);await Ring.sweep(f.env,NOW+Engine.DURATION+1);
 assert.deepEqual(f.state().actors,departure.actors);assert.deepEqual(f.state().results,control.state().results);assert.deepEqual(awards(f),awards(control));assert.equal(awards(f).length,30);
 assert.equal(imprintLevel(f.db.prepare("SELECT * FROM rpg_equipment WHERE id='configuration-b'").get()),1);assert.equal(JSON.parse(f.character().special_json).towerTitle,title);assert.equal(f.db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='tower_fragment'").get(owner).quantity,490);
});
