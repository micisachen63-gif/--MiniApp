import test from 'node:test';import assert from 'node:assert/strict';
import {skillExpedition,shortParty,NOW} from './star-ring-skill-fixture.js';
import * as Ring from '../src/services/star-ring.js';
import * as Party from '../src/services/party.js';
import * as Engine from '../src/game/star-ring.js';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.j));return r.j;};
const skills=f=>JSON.parse(f.character().special_json);
const shortState=(f,id)=>JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(id).state_json);
const rewards=f=>f.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id);

for(const version of [1,2,3])for(const kind of ['dungeon','tower'])for(const ringFirst of [false,true])test(`v${version} ${kind}: new configuration survives a real win, ${ringFirst?'expedition completes during combat':'expedition completes after the win'}, and stale result reads`,async t=>{
 const f=await skillExpedition({version}),control=await skillExpedition({version});t.after(f.close);t.after(control.close);
 const departure=f.state();departure.seed='skill-persistence-'+version+'-'+kind+'-'+ringFirst;
 for(const run of [f,control])run.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(departure),run.id);
 const owner=f.ids[0],old=departure.actors.find(a=>a.id===owner).special,newSkill=f.choices[3],newBook=f.choices[4],loadout=[newSkill,f.choices[1],newBook];
 ok(await f.api({op:'learn',skillId:newBook}));ok(await f.api({op:'loadout',loadout},NOW+2));
 ok(await f.api({op:'auto',skillId:newSkill,mode:'ready'},NOW+3));ok(await f.api({op:'auto',skillId:newBook,mode:'elite'},NOW+4));
 const configured=skills(f),at=ringFirst?NOW+Engine.DURATION-1000:NOW+1000;
 assert.ok(!old.loadout.includes(newSkill));assert.ok(!old.learned.includes(newBook));
 const id=await shortParty(f,kind,at),started=shortState(f,id),actor=started.actors.find(a=>a.id===owner);
 assert.deepEqual(actor.special,configured,'newly started battle snapshots the actual new character configuration');
 assert.deepEqual(actor.special.loadout,loadout);assert.ok(actor.special.learned.includes(newBook));
 // Use the replacement skill in a real turn, rather than merely inspecting it.
 await Party.action(f.env,owner,{partyId:id,op:'submit',round:1,skillId:newSkill,targetId:owner},at+1);
 if(ringFirst){
  const live=f.character();assert.deepEqual((await Ring.sweep(f.env,NOW+Engine.DURATION)).errors,[]);
  assert.equal(f.character().party_id,id);assert.equal(f.character().hp,live.hp);assert.equal(f.character().mp,live.mp);assert.deepEqual(skills(f),configured);
 }
 let p=await Party.view(f.env,id,owner,started.deadline);
 const first=shortState(f,id),event=first.lastTurn.events.find(e=>e.actorId===owner&&e.skillId===newSkill);
 assert.ok(event,'replacement skill was actually cast');assert.ok(first.actors.find(a=>a.id===owner).special.cooldowns[newSkill]>first.lastTurn.at);
 for(let turns=0;p.status==='combat'&&turns<400;turns++)p=await Party.view(f.env,id,owner,p.deadline);
 assert.equal(p.status,'won','complete the real encounter; do not force a victory or end the party');assert.ok(p.me.reward);
 const ended=shortState(f,id),finishedAt=ended.endedAt,settled=skills(f),finalActor=ended.actors.find(a=>a.id===owner);
 assert.deepEqual(settled.loadout,loadout);assert.deepEqual(settled.auto,configured.auto);assert.deepEqual(settled.learned,configured.learned);
 assert.deepEqual(settled.cooldowns,finalActor.special.cooldowns,'persist legitimate new battle cooldowns rather than old expedition cooldowns');
 if(kind==='tower')assert.equal(settled.towerBest,10);
 assert.equal(f.character().party_id,ringFirst?null:f.id);assert.equal(f.db.prepare('SELECT count(*) n FROM rpg_party_rewards WHERE party_id=?').get(id).n,3);
 // Change again after winning, so the old short-battle snapshot differs from
 // BOTH the current live configuration and the expedition's departure data.
 const latest=[newBook,f.choices[0]],afterAt=finishedAt+1;
 ok(await f.api({op:'loadout',loadout:latest},afterAt));ok(await f.api({op:'auto',skillId:newBook,mode:'lowHp'},afterAt+1));const saved=skills(f);
 for(let retry=0;retry<2;retry++){
  await Party.view(f.env,id,owner,afterAt+2+retry);await Party.reward(f.env,owner,{partyId:id},afterAt+2+retry);
  assert.deepEqual(skills(f),saved,'old completed party views/reward retries cannot restore its obsolete loadout');
 }
 const endAt=Math.max(NOW+Engine.DURATION,afterAt+5);assert.deepEqual((await Ring.sweep(f.env,endAt)).errors,[]);await Ring.sweep(control.env,NOW+Engine.DURATION);
 assert.equal((await Ring.view(f.env,f.id,owner,endAt)).status,'complete');assert.equal(f.character().party_id,null);assert.deepEqual(skills(f),saved);
 assert.deepEqual(f.state().actors,departure.actors);assert.deepEqual(f.state().results,control.state().results);assert.deepEqual(rewards(f),rewards(control));assert.equal(rewards(f).length,30);
 await Ring.sweep(f.env,endAt+60000);await Party.sweep(f.env,endAt+60000);await Party.view(f.env,id,owner,endAt+60000);await Party.reward(f.env,owner,{partyId:id},endAt+60000);
 assert.deepEqual(skills(f),saved,'duplicate cleanup/settlement also retains the newest configuration');assert.equal(rewards(f).length,30);assert.equal(f.db.prepare('SELECT count(*) n FROM rpg_party_rewards WHERE party_id=?').get(id).n,3);
 const nextId=await shortParty(f,kind,endAt+60001),next=shortState(f,nextId).actors.find(a=>a.id===owner);
 assert.deepEqual(next.special.loadout,latest);assert.deepEqual(next.special.auto,saved.auto);assert.deepEqual(next.special.learned,saved.learned);
 await Party.action(f.env,owner,{partyId:nextId,op:'end'},endAt+60002);
});
