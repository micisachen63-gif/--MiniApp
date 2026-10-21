import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {skillExpedition,NOW} from './star-ring-skill-fixture.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import * as R from '../src/services/star-ring.js';
import * as E from '../src/game/star-ring.js';
import app from '../src/index.js';
import {loadPlayer,insertEquipStmt} from '../src/db.js';
import {computeStats,standardSet} from '../src/game/stats.js';
import {makeGear} from '../src/game/gear.js';
import {autoPartyAction,castSpecial,validateCast,SKILL_MAP,valueOf} from '../src/game/special.js';

const skills=['skill_03_1','skill_03_2','skill_12_1'];
const config=()=>({learned:skills,loadout:skills,auto:Object.fromEntries(skills.map(id=>[id,'ready'])),cooldowns:{},autoBluePotion:'blue_3',autoBluePct:50});
async function cron(env,at){let pending;app.scheduled({cron:'* * * * *',scheduledTime:at},env,{waitUntil:p=>pending=p});await pending;}
async function team(t,kind,roles=false){
 const env={DB:freshDb()},db=env.DB.sqlite,ids=['6101','6102','6103'],level=roles?120:75,specs=roles?['sword:B2','mage:A1','archer:A2']:['archer:A2','archer:A2','archer:A2'];t.after(()=>db.close());
 for(const [position,id]of ids.entries()){
  const [base,path]=specs[position].split(':');
  await P.createCharacter(env,{tgId:id,name:'三技驗收'+id,baseClass:base,gender:'f'},T0);
  db.prepare('UPDATE rpg_characters SET level=?,class_path=?,special_json=? WHERE tg_id=?').run(level,path,JSON.stringify({...base==='archer'?config():{},towerBest:roles?20:0}),id);
  db.prepare('DELETE FROM rpg_equipment WHERE tg_id=?').run(id);
  for(const [i,slot]of standardSet(base,level).entries()){
   const e=makeGear({id:id+'-gear-'+i,tgId:id,cls:base,slot:slot.slot,kind:slot.kind,tier:Math.ceil(level/10),forceRarity:'epic',source:'shop',rng:()=>.5,now:T0});
   e.enhance_level=4;e.is_equipped=slot.is_equipped;await insertEquipStmt(env.DB,e).run();
  }
  const p=await loadPlayer(env.DB,id),stats=computeStats(p.char,p.equipment);
  db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,id);
  for(const item of ['red_3','blue_3'])db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,1000) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=1000').run(id,item);
 }
 const id=(await G.create(env,ids[0],{kind,dungeonId:roles?'stars':'river',startFloor:roles?21:1},T0)).party.id;
 for(const who of ids.slice(1))await G.action(env,who,{partyId:id,op:'join'},T0);
 for(const who of ids)await G.action(env,who,{partyId:id,op:'ready'},T0);
 await G.action(env,ids[0],{partyId:id,op:'start'},T0);
 const row=()=>db.prepare('SELECT * FROM rpg_parties WHERE id=?').get(id),state=()=>JSON.parse(row().state_json);
 return {env,db,ids,id,row,state,caster:ids[roles?2:0]};
}
const normalized=(value,id)=>JSON.parse(JSON.stringify(value).replaceAll(id,'RUN'));
const rewards=f=>f.db.prepare('SELECT char_id,reward_json FROM rpg_party_rewards WHERE party_id=? ORDER BY char_id').all(f.id).map(x=>({char:x.char_id,reward:normalized(JSON.parse(x.reward_json),f.id)}));

for(const kind of ['dungeon','tower'])for(const roles of [false,true])test(`${kind} ${roles?'15s roles':'5s ordinary'}: all three actual equipped skills cast; no browser for two hours equals online turns, mana, potions and one award`,async t=>{
 t.mock.method(crypto,'getRandomValues',a=>{a.fill(0x80000000);return a;});
 const live=await team(t,kind,roles),offline=await team(t,kind,roles),seen=new Set();
 while(live.row().status==='combat'){
  await G.view(live.env,live.id,live.ids[0],live.state().deadline);
  for(const event of live.state().lastTurn.events)if(event.actorId===live.caster&&skills.includes(event.skillId))seen.add(event.skillId);
 }
 assert.deepEqual([...seen].sort(),[...skills].sort(),'three successful cast events, not merely equipped slots');
 await cron(offline.env,T0+7200000);
 assert.equal(live.row().status,'won');assert.equal(offline.row().status,'won');
 assert.deepEqual(normalized(offline.state(),offline.id),normalized(live.state(),live.id));
 assert.deepEqual(rewards(offline),rewards(live));assert.equal(rewards(offline).length,3);
 for(const id of live.ids){
  const a=await loadPlayer(live.env.DB,id),b=await loadPlayer(offline.env.DB,id);
  assert.deepEqual(b.inv,a.inv);assert.deepEqual(JSON.parse(b.char.special_json),JSON.parse(a.char.special_json));
  if(id===offline.caster)for(const skill of skills)assert.ok(JSON.parse(b.char.special_json).cooldowns[skill]>T0);
 }
 const before=JSON.stringify(rewards(offline));await cron(offline.env,T0+7260000);
 assert.equal(JSON.stringify(rewards(offline)),before);
 assert.equal(offline.db.prepare("SELECT count(*) n FROM rpg_ledger WHERE event_id LIKE ?").get('party-reward:'+offline.id+':%').n,3);
 t.diagnostic(JSON.stringify({kind,roles,skills:[...seen],rounds:live.state().turnSequence,endedAt:live.state().endedAt-T0,receipts:3}));
});

function battleResults(f){
 const results=structuredClone(f.state().results);
 // Separate legal fixtures own different starter-item IDs; equipment attributes stay compared.
 for(const stage of results)for(const a of stage.actors)for(const e of a.equipment||[])e.id='fixture-owned-'+e.slot+'-'+e.is_equipped;
 return normalized(results,f.id);
}
async function ring(t,version){
 const f=await skillExpedition({version,prepare:async({env,db,ids})=>{
  db.prepare('UPDATE rpg_characters SET base_class=?,class_path=?,special_json=? WHERE tg_id=?').run('archer','A2',JSON.stringify(config()),ids[0]);
  for(const id of ids){
   const c=db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(id);db.prepare('DELETE FROM rpg_equipment WHERE tg_id=?').run(id);
   for(const [i,slot]of standardSet(c.base_class,80).entries()){
    const e=makeGear({id:id+'-ring-gear-'+i,tgId:id,cls:c.base_class,slot:slot.slot,kind:slot.kind,tier:8,forceRarity:'epic',source:'shop',rng:()=>.5,now:NOW});
    e.enhance_level=4;e.is_equipped=slot.is_equipped;
    // Same legal gear rolls in both isolated databases; random starter affixes must not differ.
    await insertEquipStmt(env.DB,e).run();
   }
  }
 }});t.after(f.close);
 const s=f.state();s.seed='three-skills-offline-'+version;f.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(s),f.id);return f;
}
for(const version of [1,2,3])test(`expedition v${version}: slots two and three actually cast and a full offline 12h has identical six-stage combat and thirty receipts`,async t=>{
 const live=await ring(t,version),offline=await ring(t,version),seen=new Set(),original=offline.character().special_json;
 for(let beat=1;beat<=20;beat++){
  const view=await R.view(live.env,live.id,live.ids[0],NOW+beat*E.BEAT_MS);
  for(const event of view.battle.events)if(event.actorId===live.ids[0]&&skills.includes(event.skillId)){seen.add(event.skillId);assert.equal(event.label,SKILL_MAP[event.skillId].name);}
 }
 assert.deepEqual([...seen].sort(),[...skills].sort());
 for(let stage=1;stage<=6;stage++)await R.view(live.env,live.id,live.ids[0],NOW+stage*E.STAGE_MS);
 await cron(offline.env,NOW+E.DURATION);
 assert.equal(offline.state().results.length,6);assert.deepEqual(battleResults(offline),battleResults(live));
 const receipts=f=>f.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id).map(x=>({...x,reward_json:normalized(JSON.parse(x.reward_json),f.id)}));
 assert.equal(receipts(offline).length,30);assert.deepEqual(receipts(offline),receipts(live));
 for(const stage of offline.state().results){const actor=stage.actors.find(a=>a.id===offline.ids[0]);for(const id of skills)assert.ok(actor.special.cooldowns[id]>NOW,'skill cast inside departure snapshot');}
 for(const id of live.ids){
  const a=await loadPlayer(live.env.DB,id),b=await loadPlayer(offline.env.DB,id);assert.deepEqual(b.inv,a.inv);assert.equal(b.char.gold,a.char.gold);assert.equal(b.char.exp,a.char.exp);
  assert.deepEqual(normalized(b.equipment,offline.id),normalized(a.equipment,live.id));
 }
 assert.equal(offline.character().special_json,original,'expedition cooldowns cannot overwrite the current live configuration');
 const before=JSON.stringify(receipts(offline));await cron(offline.env,NOW+E.DURATION+60000);assert.equal(JSON.stringify(receipts(offline)),before);
 t.diagnostic(JSON.stringify({version,skills:[...seen],stages:6,receipts:30,offlineCron:true}));
});

test('all specials cooling down use native attack; unavailable skills do not consume mana or advance cooldowns',()=>{
 const a={id:'a',base:'archer',path:'A2',level:75,hp:100,maxHp:100,mp:1000,maxMp:1000,atk:100,affixPct:{skillHastePct:.25},buffs:[],special:config()},enemy={hp:1e9,maxHp:1e9,def:0,buffs:[],windup:false,interruptible:true};
 const selected=[];for(let turn=0;turn<4;turn++){
  const now=T0+turn*5000,action=autoPartyAction(a,[a],enemy,now);selected.push(action.skillId);
  if(action.skillId!=='attack'){const skill=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp,affixPct:a.affixPct},a.special,action.skillId,now);castSpecial(a,[a],enemy,skill,action.targetId,now,()=>1);}
 }
 assert.deepEqual(selected,[...skills,'attack']);const before=JSON.stringify(a),mp=a.mp;a.mp=0;assert.equal(autoPartyAction(a,[a],enemy,T0+120000).skillId,'attack');a.mp=mp;assert.equal(JSON.stringify(a),before);
});

// The original failure was a conditional secondary effect being mistaken for a cast restriction.
test('Wind Binding can auto-cast its 1.8A damage against a boss without applying the adds-only damage debuff',()=>{
 const a={id:'a',base:'archer',path:'A2',level:75,hp:100,maxHp:100,mp:1000,maxMp:1000,atk:100,affixPct:{},buffs:[],special:{...config(),loadout:[skills[1]]}},e={hp:10000,maxHp:10000,def:0,buffs:[],windup:false,interruptible:true};
 const at=T0,action=autoPartyAction(a,[a],e,at);assert.equal(action.skillId,skills[1]);
 const s=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp},a.special,action.skillId,at),r=castSpecial(a,[a],e,s,a.id,at,()=>1);
 assert.equal(r.damage,180);assert.equal(valueOf(e,'enemyNextReduce',at),0);assert.equal(a.mp,976);assert.equal(a.special.cooldowns[skills[1]],at+120000);
});
