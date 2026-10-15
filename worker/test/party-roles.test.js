import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import {loadPlayer} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
import {damageEnemy,periodic,performThiefNativeStrikes} from '../src/game/special.js';
import {encounterPlan,roleSkills,assignRoles,briefing,initCooperation,prepareMechanic,castRole,creditMechanic,resolveMechanic,roleEvidence,validateRole} from '../src/game/party-roles.js';
const archetypes=['sword:A1','sword:A2','sword:B1','sword:B2','archer:A1','archer:A2','archer:B1','archer:B2','mage:A1','mage:A2','mage:B1','mage:B2','thief:A1','thief:A2','thief:B1','thief:B2'];
const actor=(spec,id='a')=>{const [base,path]=spec.split(':');return {id,base,path,level:120,hp:800,maxHp:1000,mp:100,maxMp:100,atk:200,def:10,crit:0,buffs:[],affixPct:{},special:{learned:[],loadout:[],cooldowns:{}}};};
const plan=()=>encounterPlan('dungeon','stars');
function battle(specs=['sword:B2','mage:A1','thief:A1']){const s={actors:specs.map((v,i)=>actor(v,String(i))),round:1,actions:{},enemy:{hp:10000,maxHp:10000,def:100,buffs:[],dots:[],windup:false,interruptible:true}};initCooperation(s,plan());prepareMechanic(s,T0);return s;}
async function setup(specs=['sword:B2','mage:A1','thief:A1'],dungeonId='stars',kind='dungeon'){
 const env={DB:freshDb()},ids=['111','222','333'];
 for(let i=0;i<3;i++){
  const [baseClass,path]=specs[i].split(':');await P.createCharacter(env,{tgId:ids[i],name:'配隊'+ids[i],baseClass,gender:'f'},T0);
  await env.DB.prepare('UPDATE rpg_characters SET level=120,class_path=?,special_json=?,last_settle_at=? WHERE tg_id=?').bind(path,JSON.stringify({towerBest:20}),T0+600001,ids[i]).run();
  const q=await loadPlayer(env.DB,ids[i]),st=computeStats(q.char,q.equipment);await env.DB.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').bind(st.maxHp,st.maxMp,ids[i]).run();
 }
 const {party:{id}}=await G.create(env,ids[0],{kind,dungeonId,startFloor:21},T0);
 for(const tg of ids.slice(1))await G.action(env,tg,{partyId:id,op:'join'},T0);
 for(const tg of ids)await G.action(env,tg,{partyId:id,op:'ready'},T0);
 return {env,id};
}
async function edit(env,id,fn){const s=JSON.parse((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(id).first()).state_json);fn(s);await env.DB.prepare('UPDATE rpg_parties SET state_json=? WHERE id=?').bind(JSON.stringify(s),id).run();}
async function run(env,id){let p=await G.action(env,'111',{partyId:id,op:'start'},T0);p=p.party;for(let n=0;n<40&&p.status==='combat';n++)p=await G.view(env,id,'111',p.deadline+1);return p;}

test('four classes and all second-tier routes have explicit native duties; no early-level or unpromoted bypass',()=>{
 const expected=[['guard','breach'],['guard','breach'],['guard','aid'],['guard','control'],['control','breach'],['control','breach'],['control','aid'],['control','guard'],['aid','breach'],['aid','guard'],['aid','control'],['aid','guard'],['breach','control'],['breach','control'],['breach','control'],['breach','control']];
 archetypes.forEach((v,i)=>{for(const suffix of ['','1','12']){const a=actor(v+suffix);assert.deepEqual(roleSkills(a).map(x=>x.role),expected[i]);assert.ok(roleSkills(a).every(x=>x.name&&x.mp===10));}assert.equal(roleSkills({...actor(v),level:89}).length,0);});
 assert.equal(roleSkills({...actor('mage:A1'),path:'A'}).length,0);
 for(const id of ['pillar','aegean','forge','river'])assert.equal(encounterPlan('dungeon',id),null);
 for(const f of [1,5,10,15,20,21,24,26,29])assert.equal(encounterPlan('tower',null,f),null);
 assert.ok(encounterPlan('tower',null,25));assert.equal(encounterPlan('tower',null,30).phases.length,3);
});

test('4096 branch compositions use distinct heroes per phase and are invariant to roster ordering',()=>{
 let allowed=0,denied=0;const represented=new Set();
 for(const a of archetypes)for(const b of archetypes)for(const c of archetypes){
  const actors=[a,b,c].map((v,i)=>actor(v,String(i))),check=briefing(plan(),actors),reverse=briefing(plan(),[...actors].reverse());
  assert.equal(check.ready,reverse.ready);
  if(check.ready){allowed++;actors.forEach(x=>represented.add(x.base));for(const p of check.phases)assert.equal(new Set(Object.values(p.assignment)).size,p.roles.length);}else denied++;
 }
 assert.ok(allowed>100&&denied>100);assert.equal(represented.size,4);
 for(const base of ['thief:A1','sword:A1','mage:A1','archer:A1'])assert.equal(briefing(plan(),[0,1,2].map(i=>actor(base,String(i)))).ready,false);
 assert.equal(assignRoles(['guard','aid'],[actor('mage:A2')]),null);
});

test('same hero cannot solo a phase; three-round failure has an actionable reason',()=>{
 const s=battle();creditMechanic(s,s.actors[0],['guard']);creditMechanic(s,s.actors[0],['breach']);
 assert.deepEqual(s.cooperation.progress,{guard:'0'});s.round=3;const r=resolveMechanic(s);assert.equal(r.success,false);assert.match(r.text,/破陣/);assert.equal(s.cooperation.failed,true);
});

test('real DOT, reflect damage adapter and thief multi-strikes cannot bypass checkpoints even at enormous ATK',()=>{
 const s=battle();for(const a of s.actors)a.atk=1e12;
 const before=s.enemy.hp;assert.equal(damageEnemy(s.enemy,1e20,{},T0,s.actors[0]),0);
 s.enemy.dots=[{left:3,next:T0,damage:1e20,owner:'0',source:s.actors[0]}];periodic(s.actors,s.enemy,T0+90000);
 assert.equal(performThiefNativeStrikes(s.actors[2],s.enemy,T0,{baseRaw:1e20,rng:()=>1}).damage,0);assert.equal(s.enemy.hp,before);
 creditMechanic(s,s.actors[0],['guard']);creditMechanic(s,s.actors[2],['breach']);assert.equal(resolveMechanic(s).success,true);
 s.round=2;prepareMechanic(s,T0+15000);damageEnemy(s.enemy,1e20,{},T0,s.actors[0]);assert.equal(s.enemy.hp,Math.ceil(s.enemy.maxHp*.5));
 s.round=4;prepareMechanic(s,T0+45000);assert.equal(s.enemy.damageBudget,0);
});

test('native duties spend mana once, enforce per-role cooldown, shield/heal/cleanse/interrupt and inherit effect affixes',()=>{
 const s=battle(['sword:B1','mage:A2','thief:A2']);const [sword,mage,thief]=s.actors;
 const g=castRole(sword,s,'role_guard',T0);assert.equal(g.shielded,300);assert.equal(sword.mp,90);assert.throws(()=>castRole(sword,s,'role_guard',T0));
 s.round=4;assert.ok(validateRole(sword,'role_guard',s));
 mage.affixPct.healingPct=.5;s.actors.forEach(a=>a.debuffs=[{type:'party-curse'},{type:'poison'}]);const heal=castRole(mage,s,'role_aid',T0);assert.equal(heal.healed,540);assert.ok(s.actors.every(a=>!a.debuffs.length));
 s.enemy.windup=true;s.enemy.interruptible=true;castRole(thief,s,'role_control',T0);assert.equal(s.enemy.interrupted,true);assert.equal(s.enemy.buffs.find(b=>b.type==='enemyNextReduce').value,.2);
 thief.mp=0;assert.throws(()=>castRole(thief,s,'role_breach',T0),e=>e.code==='mp');
 assert.throws(()=>castRole(mage,s,'role_breach',T0),e=>e.code==='role');
 assert.deepEqual(roleEvidence('skill_20_1',{},s),['control']);assert.deepEqual(roleEvidence('skill_13_2',{healed:30},s),['aid']);
});

test('invalid composition is rejected at departure without freezing presence; auto-start releases an invalid lobby',async()=>{
 const {env,id}=await setup(['thief:A1','thief:A2','thief:B2']);try{
  const before=await G.view(env,id,'111',T0);assert.equal(before.briefing.ready,false);
  await assert.rejects(G.action(env,'111',{partyId:id,op:'start'},T0),e=>e.code==='party_roles');
  assert.equal((await loadPlayer(env.DB,'111')).char.party_id,null);
  await G.sweep(env,T0+600001);const ended=await G.view(env,id,'111',T0+600001);assert.equal(ended.status,'ended');assert.match(ended.log.join(''),/分工不足/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_party_presence').first()).n,0);
 }finally{env.DB.sqlite.close();}
});

test('different complementary compositions including thief really clear all three gates and receive one reward each',async()=>{
 for(const specs of [['sword:B2','mage:A1','thief:A1'],['archer:B1','mage:A2','thief:B1'],['sword:B2','archer:A1','mage:A1'],['sword:A1','sword:B1','sword:B2']]){
  const {env,id}=await setup(specs);try{
   const p=await run(env,id);assert.equal(p.status,'won',specs.join(',')+' '+p.log.join(','));assert.equal(p.cooperation.cleared,3);
   for(const phase of p.cooperation.history)assert.equal(new Set(Object.values(phase.progress)).size,Object.keys(phase.progress).length);
   for(const tg of ['111','222','333'])assert.equal((await loadPlayer(env.DB,tg)).inv.research_fragment,8);
   await G.reward(env,'111',{partyId:id,requestId:'repeat'},p.deadline+1);assert.equal((await loadPlayer(env.DB,'111')).inv.research_fragment,8);
  }finally{env.DB.sqlite.close();}
 }
});

test('manual attacks override automatic cooperation and fail despite overwhelming ATK, with no reward and no stuck lock',async()=>{
 const {env,id}=await setup();try{
  let p=(await G.action(env,'111',{partyId:id,op:'start'},T0)).party;
  await edit(env,id,s=>s.actors.forEach(a=>a.atk=1e20));
  for(let r=1;r<=3;r++){for(const tg of ['111','222','333'])await G.action(env,tg,{partyId:id,op:'submit',round:r,skillId:'attack',requestId:'attack'+r+tg},p.deadline-1);p=await G.view(env,id,'111',p.deadline+1);}
  assert.equal(p.status,'lost');assert.equal(p.enemy.hp,p.enemy.maxHp);assert.match(p.log.join(''),/失守/);
  await assert.rejects(G.reward(env,'111',{partyId:id},p.deadline+1));assert.equal((await loadPlayer(env.DB,'111')).char.party_id,null);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM rpg_party_presence').first()).n,0);
 }finally{env.DB.sqlite.close();}
});

test('a lost response and duplicate view/submit cannot cast twice, charge twice or resolve two rounds',async()=>{
 const {env,id}=await setup();try{
  await G.action(env,'111',{partyId:id,op:'start'},T0);
  const b={partyId:id,op:'submit',round:1,skillId:'role_guard',requestId:'one-action'};await G.action(env,'111',b,T0+1);await G.action(env,'111',b,T0+1);
  await assert.rejects(G.action(env,'222',{...b,requestId:'late'},T0+15000),e=>e.code==='round');
  const p=await G.view(env,id,'111',T0+15001);assert.equal(p.battleTurn.events.filter(e=>e.actorId==='111').length,1);
  const mp=p.me.actor.mp;const again=await G.view(env,id,'111',T0+15001,p.battleTurn.id);assert.equal(again.battleTurns.length,0);assert.equal(again.me.actor.mp,mp);assert.equal(again.round,2);
 }finally{env.DB.sqlite.close();}
});

test('legacy running encounters remain five-second combat and cannot inject new native role actions',async()=>{
 const {env,id}=await setup();try{
  await edit(env,id,s=>delete s.roleRules);let p=(await G.action(env,'111',{partyId:id,op:'start'},T0)).party;
  assert.equal(p.roundSeconds,5);assert.equal(p.cooperation,null);await assert.rejects(G.action(env,'111',{partyId:id,op:'submit',round:1,skillId:'role_guard'},T0+1));
  p=await G.view(env,id,'111',T0+5001);assert.equal(p.battleTurn.events.filter(e=>e.skillId==='attack').length,3);
 }finally{env.DB.sqlite.close();}
});

test('new high-tower runs snapshot full roster requirements and only enable mechanics at floors 25 and 30',async()=>{
 const {env,id}=await setup(undefined,undefined,'tower');try{
  let p=(await G.action(env,'111',{partyId:id,op:'start'},T0)).party;assert.equal(p.floor,21);assert.equal(p.cooperation,null);assert.equal(p.briefing.phases.length,3);
  await edit(env,id,s=>{s.floor=24;s.enemy.hp=1;s.actors.forEach(a=>a.atk=1e8);});p=await G.view(env,id,'111',T0+5001);assert.equal(p.floor,25);assert.equal(p.roundSeconds,15);assert.equal(p.cooperation.total,1);assert.equal(p.enemy.damageBudget,0);
  await edit(env,id,s=>{s.floor=29;delete s.cooperation;delete s.enemy.damageBudget;s.enemy.hp=1;s.actors.forEach(a=>a.roleCooldowns={role_guard:999,role_aid:999,role_control:999});});p=await G.view(env,id,'111',p.deadline+1);assert.equal(p.floor,30);assert.equal(p.cooperation.total,3);assert.deepEqual(p.me.actor.roleCooldowns,{});
 }finally{env.DB.sqlite.close();}
});
