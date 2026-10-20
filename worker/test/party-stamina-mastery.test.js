import test from 'node:test';import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';import {T0} from './helpers.js';
import * as P from '../src/services/player.js';import * as G from '../src/services/party.js';import * as SP from '../src/services/special.js';
import {loadPlayer} from '../src/db.js';import {computeStats} from '../src/game/stats.js';
import {partyStamina,spentStamina} from '../src/game/party-stamina.js';
import {masteredSkill,masteryView,masteredMechanics} from '../src/game/skill-mastery.js';
import {SKILL_MAP,MECHANICS,performSkill,autoPartyAction,castSpecial,valueOf,receiveDamage} from '../src/game/special.js';
import {homeActivity} from '../src/services/home-activity.js';
let serial=0;const ids=['111','222','333'];
async function setup(t){const env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());for(const id of ids){await P.createCharacter(env,{tgId:id,name:'驗收'+id,baseClass:'sword',gender:'m'},T0);env.DB.sqlite.prepare("UPDATE rpg_characters SET level=60,class_path='B1' WHERE tg_id=?").run(id);const p=await loadPlayer(env.DB,id),s=computeStats(p.char,p.equipment);env.DB.sqlite.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(s.maxHp,s.maxMp,id);}return env;}
function energy(env,id,points,at=T0){env.DB.sqlite.prepare("UPDATE rpg_characters SET special_json=json_set(special_json,'$.partyStamina',json(?)) WHERE tg_id=?").run(JSON.stringify({points,at}),id);}
const points=async(env,id,now=T0)=>partyStamina((await loadPlayer(env.DB,id)).char,now).points;
async function lobby(env,dungeon='pillar'){const p=(await G.create(env,'111',{kind:'dungeon',dungeonId:dungeon},T0)).party;for(const id of ids.slice(1))await G.action(env,id,{partyId:p.id,op:'join'},T0);for(const id of ids)await G.action(env,id,{partyId:p.id,op:'ready'},T0);return p.id;}
const start=(env,id)=>G.action(env,'111',{partyId:id,op:'start'},T0);
async function win(env,id){let now=T0;for(let i=0;i<50;i++){const p=await G.view(env,id,'111',now);if(p.status!=='combat'){assert.equal(p.status,'won');return {p,now};}now=p.deadline;}assert.fail('combat did not finish');}
const learn=(env,fromLevel,requestId='learn-'+ ++serial)=>SP.action(env,'111',{op:'learn',skillId:'skill_02_1',fromLevel,requestId},T0);

test('stamina restores each six minutes, retains fractions, caps, and pauses overflow recovery',()=>{
 const c={special_json:JSON.stringify({partyStamina:{points:0,at:T0}})};
 assert.equal(partyStamina(c,T0+359999).points,0);assert.equal(partyStamina(c,T0+360000).points,1);assert.equal(partyStamina(c,T0+3600000).points,10);
 assert.deepEqual(spentStamina({special_json:JSON.stringify({partyStamina:{points:30,at:T0}})},T0+390000),{points:11,at:T0+360000});
 const full=partyStamina(c,T0+100*360000+12345);assert.equal(full.points,100);assert.equal(full.nextAt,null);assert.equal(full.at,T0+100*360000+12345);
 assert.equal(partyStamina({special_json:'invalid'},T0).points,100);
});
test('recruiting is free; successful departure debits three characters exactly once',async t=>{
 const env=await setup(t),id=await lobby(env);for(const who of ids)assert.equal(await points(env,who),100);
 const p=(await start(env,id)).party;assert.equal(p.status,'combat');for(const who of ids)assert.equal(await points(env,who),80);
 await assert.rejects(start(env,id));for(const who of ids)assert.equal(await points(env,who),80);
 assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,3);
 await G.action(env,'111',{partyId:id,op:'end'},T0+1);for(const who of ids)assert.equal(await points(env,who),80);
});
test('overlapping start requests cannot double-charge or consume another departure',async t=>{
 const env=await setup(t),id=await lobby(env),r=await Promise.allSettled([start(env,id),start(env,id)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);for(const who of ids)assert.equal(await points(env,who),80);assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,3);
});
test('expired fully-ready lobby without energy closes safely without partial charges or retry starvation',async t=>{
 const env=await setup(t),id=await lobby(env);energy(env,'333',0);const at=env.DB.sqlite.prepare('SELECT expires_at FROM rpg_parties WHERE id=?').get(id).expires_at;
 await G.sweep(env,at);assert.equal((await G.view(env,id,'111',at)).status,'ended');for(const who of ids.slice(0,2))assert.equal(await points(env,who,at),100);assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,0);
});
test('one insufficient member rolls back all debits, battle, and ledgers; retry after recovery works',async t=>{
 const env=await setup(t),id=await lobby(env);energy(env,'333',19);await assert.rejects(start(env,id),e=>e.code==='stamina');
 assert.equal(await points(env,'111'),100);assert.equal(await points(env,'222'),100);assert.equal(await points(env,'333'),19);
 assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,0);assert.equal((await G.view(env,id,'111',T0)).status,'lobby');
 const p=(await G.action(env,'111',{partyId:id,op:'start'},T0+360000)).party;assert.equal(p.status,'combat');assert.equal(await points(env,'333',T0+360000),0);
});
test('five full-energy runs retain rewards; sixth fails atomically; departure is not retrocharged',async t=>{
 const env=await setup(t);let p=(await start(env,await lobby(env))).party;
 for(let i=0;i<5;i++){const r=await win(env,p.id);p=r.p;for(const who of ids)await G.reward(env,who,{partyId:p.id},r.now);if(i<4)p=(await G.action(env,'111',{partyId:p.id,op:'repeat'},r.now)).party;}
 const count=env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_parties').get().n;
 await assert.rejects(G.action(env,'111',{partyId:p.id,op:'repeat'},T0+180000),e=>e.code==='stamina');assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rpg_parties').get().n,count);
 for(const who of ids){assert.equal((await loadPlayer(env.DB,who)).inv.research_fragment,40);assert.equal(await points(env,who),0);}
 assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,15);
 // Legacy running battle has no debit marker and must advance without a new charge.
 const fresh=await setup(t),id=await lobby(fresh);await start(fresh,id);fresh.DB.sqlite.prepare("DELETE FROM rpg_ledger WHERE type='打寶體力'").run();for(const who of ids)energy(fresh,who,100);await win(fresh,id);assert.equal(fresh.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,0);
});
test('tower and advancement trials do not use dungeon energy',async t=>{
 const env=await setup(t);for(const who of ids)energy(env,who,0);
 const p=(await G.create(env,'111',{kind:'tower',startFloor:1},T0)).party;for(const who of ids.slice(1))await G.action(env,who,{partyId:p.id,op:'join'},T0);for(const who of ids)await G.action(env,who,{partyId:p.id,op:'ready'},T0);assert.equal((await start(env,p.id)).party.stamina,null);
 await G.action(env,'111',{partyId:p.id,op:'end'},T0);env.DB.sqlite.prepare("UPDATE rpg_characters SET level=90,class_path='B1'").run();env.DB.sqlite.prepare("UPDATE rpg_characters SET class_path='A1' WHERE tg_id='222'").run();const trial=await lobby(env,'trial3');assert.equal((await start(env,trial)).party.stamina,null);for(const who of ids)assert.equal(await points(env,who),0);
});
test('skill levels use real books, increasing costs, cap, and one receipt per confirmed level',async t=>{
 const env=await setup(t);env.DB.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','book_skill_02_1',40)").run();
 let total=0;for(let level=0;level<10;level++){const before=await SP.view(env,'111',T0),cost=before.skills.find(s=>s.id==='skill_02_1').mastery.nextCost;total+=cost;const r=await learn(env,level);assert.equal(r.result.level,level+1);assert.equal(r.inventory.book_skill_02_1,40-total);}
 assert.equal(total,19);await assert.rejects(learn(env,10),e=>e.code==='skill_max');assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,21);
 const r=await SP.action(env,'111',{op:'recycle',skillId:'skill_02_1',quantity:2,requestId:'recycle'},T0);assert.equal(r.result.fragments,40);assert.equal(r.inventory.research_fragment,40);assert.equal(r.inventory.book_skill_02_1,19);
 const replay=await SP.action(env,'111',{op:'recycle',skillId:'skill_02_1',quantity:2,requestId:'recycle'},T0);assert.deepEqual(replay.result,r.result);assert.equal(replay.inventory.research_fragment,40);
});
test('overlapping learning recovers matching committed result; stale/different requests cannot spend again',async t=>{
 const env=await setup(t);env.DB.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','book_skill_02_1',4)").run();
 const both=await Promise.all([learn(env,0,'same'),learn(env,0,'same')]);assert.deepEqual(both[0].result,both[1].result);assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,3);
 await assert.rejects(learn(env,1,'same'),e=>e.code==='request_reused');await assert.rejects(learn(env,0,'stale'),e=>e.code==='skill_changed');assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,3);
 await assert.rejects(SP.action(env,'111',{op:'recycle',skillId:'skill_02_1',quantity:1.5,requestId:'bad'},T0),e=>e.code==='quantity');
});
test('learning recovers a receipt committed after its initial empty lookup and before validating state',async t=>{
 const env=await setup(t);env.DB.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('111','book_skill_02_1',1)").run();
 const prepare=env.DB.prepare.bind(env.DB);let held=false,resume,arrived;const wait=new Promise(r=>resume=r),paused=new Promise(r=>arrived=r);
 env.DB.prepare=sql=>{const q=prepare(sql);if(sql.startsWith('SELECT note FROM rpg_ledger')){const bind=q.bind.bind(q);q.bind=(...args)=>{const stmt=bind(...args),first=stmt.first.bind(stmt);stmt.first=async()=>{const old=await first();if(!held&&!old){held=true;arrived();await wait;}return old;};return stmt;};}return q;};
 const a=learn(env,0,'early-read');await paused;const b=await learn(env,0,'early-read');resume();assert.deepEqual((await a).result,b.result);assert.equal((await loadPlayer(env.DB,'111')).inv.book_skill_02_1,0);assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE event_id='special:111:early-read'").get().n,1);
});
test('mastery scales damage, healing, shields and buffs, preserving authored cooldown/count/control bounds',()=>{
 const state={learned:Object.keys(SKILL_MAP),mastery:Object.fromEntries(Object.keys(SKILL_MAP).map(id=>[id,10]))};
 for(const s of Object.values(SKILL_MAP)){const m=masteredSkill(s,state),out=masteredMechanics(m,MECHANICS[s.id]);assert.equal(m.cooldownSeconds,s.cooldownSeconds);assert.equal(m.mp,s.mp);for(const key of ['dotCount','summonCount','critUses','duration','interrupt','revive','execute'])assert.equal(out[key],MECHANICS[s.id][key]);}
 const mk=()=>({id:'a',hp:100,maxHp:1000,mp:1000,maxMp:1000,atk:100,def:0,buffs:[],special:{cooldowns:{}}}),enemy=()=>({hp:100000,maxHp:100000,def:0,buffs:[]});
 const basic=performSkill(mk(),[mk()],enemy(),SKILL_MAP.skill_08_1,'a',T0,()=>1),better=performSkill(mk(),[mk()],enemy(),masteredSkill(SKILL_MAP.skill_08_1,state),'a',T0,()=>1);assert(better.damage>basic.damage*1.17);
 const a=mk();performSkill(a,[a],enemy(),masteredSkill(SKILL_MAP.skill_04_2,state),'a',T0,()=>1);assert.equal(a.hp,383);
 const b=mk();performSkill(b,[b],enemy(),masteredSkill(SKILL_MAP.skill_06_2,state),'a',T0,()=>1);assert.equal(b.buffs.find(x=>x.type==='shield').value,236);
 const protectedActor=mk();performSkill(protectedActor,[protectedActor],enemy(),masteredSkill(SKILL_MAP.skill_07_2,state),'a',T0,()=>1);assert.equal(valueOf(protectedActor,'lastStand',T0+62000),1);receiveDamage(protectedActor,100000,[protectedActor],enemy(),T0+62000);assert.equal(protectedActor.hp,1);assert.equal(valueOf(protectedActor,'lastStand',T0+62000),0);
 const lvl1=masteredSkill(SKILL_MAP.skill_08_1,{learned:['skill_08_1']});assert.deepEqual(performSkill(mk(),[mk()],enemy(),lvl1,'a',T0,()=>1),basic);
});
test('special cooldown selects native attack rather than a skipped action',()=>{
 const a={id:'a',base:'sword',path:'B1',level:60,hp:100,maxHp:100,mp:1000,atk:100,buffs:[],special:{learned:['skill_02_1'],loadout:['skill_02_1'],cooldowns:{skill_02_1:T0+60000}}},e={hp:10000,maxHp:10000,def:0,buffs:[],windup:true,interruptible:true};
 assert.equal(autoPartyAction(a,[a],e,T0).skillId,'attack');a.special.cooldowns={};const s=masteredSkill(SKILL_MAP.skill_02_1,a.special);castSpecial(a,[a],e,s,'a',T0,()=>1);assert.equal(autoPartyAction(a,[a],e,T0+1).skillId,'attack');
});
test('home activity detects running expedition through a borrowed foreground party and clears on actual completion',async t=>{
 const env=await setup(t),db=env.DB;await db.prepare("INSERT INTO rpg_star_ring_runs(id,leader_id,status,state_json,created_at,updated_at,expires_at,next_at) VALUES('ring:home','111','running',?,0,0,0,0)").bind(JSON.stringify({name:'遠征',startedAt:T0,endsAt:T0+43200000})).run();
 await db.prepare("INSERT INTO rpg_star_ring_members(run_id,char_id,account_id,ready,joined_at) VALUES('ring:home','111','111',1,0)").run();
 const c=(await loadPlayer(db,'111')).char;c.party_id='party:short';assert.equal((await homeActivity(db,c)).kind,'star-ring');await db.prepare("UPDATE rpg_star_ring_runs SET status='complete'").run();assert.deepEqual(await homeActivity(db,c),{kind:'party',id:'party:short'});c.party_id=null;assert.equal(await homeActivity(db,c),null);
});

for(const version of [1,2,3])test(`v${version} expedition keeps its original strength and all awards while mastery applies to the next short party`,async t=>{
 const {skillExpedition,shortParty,NOW}=await import('./star-ring-skill-fixture.js'),Ring=await import('../src/services/star-ring.js'),{DURATION}=await import('../src/game/star-ring.js');
 const f=await skillExpedition({version}),control=await skillExpedition({version});t.after(f.close);t.after(control.close);const departure=f.state();departure.seed='mastery-departure-'+version;for(const run of [f,control])run.db.prepare('UPDATE rpg_star_ring_runs SET state_json=? WHERE id=?').run(JSON.stringify(departure),run.id);
 const id=f.choices[0];f.db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,2)').run(f.ids[0],'book_'+id);
 const r=await f.api({op:'learn',skillId:id,fromLevel:1});assert.equal(r.status,200);assert.equal(r.j.skills.find(s=>s.id===id).mastery.level,2);assert.deepEqual(f.state().actors,departure.actors);
 const at=NOW+61000,short=await shortParty(f,'dungeon',at);let battle=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(short).state_json);assert.equal(battle.actors[0].special.mastery[id],2);
 await G.action(f.env,f.ids[0],{partyId:short,op:'submit',round:1,skillId:id,targetId:f.ids[0]},at+1);let p=await G.view(f.env,short,f.ids[0],battle.deadline);battle=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(short).state_json);assert(battle.lastTurn.events.some(e=>e.actorId===f.ids[0]&&e.skillId===id&&e.damage>0));for(let i=0;i<400&&p.status==='combat';i++)p=await G.view(f.env,short,f.ids[0],p.deadline);assert.equal(p.status,'won');
 await Ring.sweep(f.env,NOW+DURATION);await Ring.sweep(control.env,NOW+DURATION);assert.deepEqual(f.state().actors,departure.actors);assert.deepEqual(f.state().results,control.state().results);const rewards=x=>x.db.prepare('SELECT char_id,stage,reward_json FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(x.id);assert.equal(rewards(f).length,30);assert.deepEqual(rewards(f),rewards(control));assert.equal(JSON.parse(f.character().special_json).mastery[id],2);
});
