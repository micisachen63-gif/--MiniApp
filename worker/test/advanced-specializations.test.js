import test from 'node:test';
import assert from 'node:assert/strict';
import {CLASSES,BRANCHES2} from '../src/game/constants.js';
import {specializationFor} from '../src/game/advanced-specializations.js';
import {branchChoices} from '../src/game/classes.js';
import {nodeFor,computeStats,standardSet,idleStats} from '../src/game/stats.js';
import {simulateDuel} from '../src/game/pk.js';
import {performAttack} from '../src/game/boss.js';
import {combatActor,receiveDamage,validateCast,SKILL_MAP,eligible} from '../src/game/special.js';
import {specialCost} from '../src/game/combat-passives.js';
import {mkChar,T0} from './helpers.js';
import {freshDb} from './d1-shim.js';
import * as P from '../src/services/player.js';
import * as Party from '../src/services/party.js';
import {loadPlayer} from '../src/db.js';

const classes=['sword','archer','mage','thief'],parents=['A1','A2','B1','B2'];
const routes=parents.flatMap(p=>['1','2'].flatMap(a=>[p+a,p+a+'1',p+a+'2']));
const derived=(cls,path)=>computeStats(mkChar({base_class:cls,class_path:path,level:120}),standardSet(cls,120));
const signature=s=>JSON.stringify([s.atk,s.def,s.maxHp,s.maxMp,s.taken,s.skill.cost,s.skill.mult,s.skill.targets,s.pct]);

test('all 96 advanced paths have numerical identities and siblings differ at identical level and equipment',()=>{
 assert.equal(routes.length*classes.length,96);
 for(const cls of classes)for(const parent of parents){
  for(const prefix of [parent,parent+'1',parent+'2']){
   const a=derived(cls,prefix+'1'),b=derived(cls,prefix+'2');
   assert.notEqual(signature(a),signature(b),cls+'/'+prefix);
   // Prevent an accidental order-of-magnitude jump while specializing.
   const output=s=>s.atk*s.skill.mult*(1+(Math.min(.8,.05+s.pct.critPct))*.5);
   assert.ok(Math.max(output(a),output(b))/Math.min(output(a),output(b))<1.3,cls+'/'+prefix+' sibling budget');
  }
  for(const path of routes.filter(p=>p.startsWith(parent))){
   const n=nodeFor(cls,path),s=derived(cls,path),spec=specializationFor(cls,path);
   assert.ok(spec);assert.ok(n.passiveText.includes(spec.role));assert.ok(s.skill.cost>0);assert.ok(s.skill.targets>=1&&s.skill.targets<=5);
   assert.ok(s.taken>=.2&&s.taken<=1.5);assert.ok(s.pct.mpEfficiencyPct<=.3&&s.pct.skillHastePct<=.25);
   const choice=branchChoices(cls,path.length,path.slice(0,-1)).find(x=>x.path===path);
   assert.equal(choice.name,n.name);assert.deepEqual(choice.skill,n.skill);assert.ok(choice.passive.text.includes(spec.role));
  }
 }
 assert.ok(specializationFor('thief','A111'));assert.equal(specializationFor('sword','A1'),null);assert.equal(specializationFor('mage','A1x1'),null);
});
test('base, first and second advancement keep the released numerical definitions',()=>{
 for(const cls of classes){assert.deepEqual(nodeFor(cls,'').skill,CLASSES[cls].node.skill);
  for(const p of ['A','B'])assert.deepEqual(nodeFor(cls,p).skill,CLASSES[cls].branches[p].skill);
  for(const p of parents)assert.deepEqual(nodeFor(cls,p).skill,BRANCHES2[cls][p[0]][p[1]].skill);
 }
});
test('all advanced routes reach actual PK and group-boss actions with authoritative MP, mitigation and damage caps',()=>{
 const defender=derived('sword','B2');
 for(const cls of classes)for(const path of routes){
  const s=derived(cls,path),c=mkChar({base_class:cls,class_path:path,level:120,hp:s.maxHp,mp:s.maxMp});
  const duel=simulateDuel(s,defender,()=>.99,{a:c,b:mkChar({base_class:'sword',class_path:'B2',level:120})});
  const first=duel.log.find(x=>x.by==='a');assert.ok(first);assert.equal(first.label,s.skill.name);assert.equal(first.spentMp,s.skill.cost);
  assert.equal(first.before.mp.a-first.after.mp.a,first.spentMp);assert.ok(first.dmg>0);
  const hit=performAttack({c:{...c},inv:{},stats:s,boss:{id:'advanced-test',map_id:12,element:'earth',hp:1e7,max_hp:1e7},rng:()=>.99,now:T0});
  assert.equal(hit.actions[0].label,s.skill.name);assert.equal(hit.actions[0].spentMp,s.skill.cost);assert.ok(hit.damage>0&&hit.damage<=2.5e6);
  const a=combatActor(c,s);assert.equal(receiveDamage(a,1000,[a],{},T0),Math.round(1000*s.taken*100/(100+s.def)));
  const idle=idleStats(c,standardSet(cls,120));assert.deepEqual(idle.skill,s.skill);assert.deepEqual(idle.pct,s.pct);
  const book=Object.values(SKILL_MAP).find(k=>eligible(c,k));
  const ready={...a,mp:10000};const x={learned:[book.id],loadout:[book.id],cooldowns:{}};
  assert.equal(validateCast({...c,mp:ready.mp,affixPct:s.pct},x,book.id,T0).mp,specialCost(book,s.pct).mp);
 }
});
test('a real party departure snapshots current advanced skills and passives without changing existing stored encounters',async()=>{
 const env={DB:freshDb()},paths=['A111','B121','B212'];let req=0;
 for(let i=0;i<3;i++){
  const id=String(111+i);await P.createCharacter(env,{tgId:id,name:'專精'+id,gender:'m',baseClass:classes[i]},T0);
  await env.DB.prepare('UPDATE rpg_characters SET class_path=?,level=120,hp=1000,mp=1000 WHERE tg_id=?').bind(paths[i],id).run();
 }
 const r=await Party.create(env,'111',{kind:'dungeon',dungeonId:'pillar'},T0),partyId=r.party.id;
 for(const id of ['112','113'])await Party.action(env,id,{partyId,op:'join',requestId:'advanced-'+(++req)},T0);
 for(const id of ['111','112','113'])await Party.action(env,id,{partyId,op:'ready',requestId:'advanced-'+(++req)},T0);
 await Party.action(env,'111',{partyId,op:'start',requestId:'advanced-'+(++req)},T0);
 const stored=JSON.parse((await env.DB.prepare('SELECT state_json FROM rpg_parties WHERE id=?').bind(partyId).first()).state_json);
 for(const a of stored.actors){const p=await loadPlayer(env.DB,a.id),s=computeStats(p.char,p.equipment);assert.deepEqual(a.skill,s.skill);assert.deepEqual(a.affixPct,s.pct);assert.equal(a.taken,s.taken);}
});
