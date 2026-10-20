import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/party.js';
import app from '../src/index.js';
import {loadPlayer,insertEquipStmt} from '../src/db.js';
import {computeStats,standardSet} from '../src/game/stats.js';
import {makeGear} from '../src/game/gear.js';
const T=Date.parse('2026-10-19T00:00:00Z');
async function fixture(t,{kind='dungeon',roles=false,env=null,base=100,start=true}={}){
 if(!env){env={DB:freshDb()};t.after(()=>env.DB.sqlite.close());}
 const ids=Array.from({length:3},(_,i)=>String(base+i));
 for(const[i,tgId]of ids.entries()){
  const [baseClass,path]=(roles?['sword:B2','mage:A1','thief:A1']:['sword:B1','sword:B1','sword:B1'])[i].split(':');
  await P.createCharacter(env,{tgId,name:'離線旅人'+tgId,baseClass,gender:'f'},T);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET level=120,class_path=?,special_json=?,last_settle_at=? WHERE tg_id=?').run(path,JSON.stringify({towerBest:20}),T,tgId);
  // The high-level ordinary dungeon now expects a real entry-tier loadout,
  // rather than the two Lv1 starter items used by the old normalized boss.
  if(roles&&kind==='dungeon'){
   env.DB.sqlite.prepare('DELETE FROM rpg_equipment WHERE tg_id=?').run(tgId);
   for(const[i,e]of standardSet(baseClass,120).entries())await insertEquipStmt(env.DB,{...makeGear({id:tgId+'-pve-'+i,tgId,cls:baseClass,slot:e.slot,kind:e.kind,tier:12,forceRarity:'epic',source:'shop',rng:()=>.5,now:T}),enhance_level:4,is_equipped:e.is_equipped}).run();
   env.DB.sqlite.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'red_4',100)").run(tgId);
  }
  const p=await loadPlayer(env.DB,tgId),stats=computeStats(p.char,p.equipment);
  env.DB.sqlite.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,tgId);
 }
 const id=(await G.create(env,ids[0],{kind,dungeonId:roles?'stars':'pillar',startFloor:roles?21:1},T)).party.id;
 for(const tg of ids.slice(1))await G.action(env,tg,{partyId:id,op:'join'},T);
 for(const tg of ids)await G.action(env,tg,{partyId:id,op:'ready'},T);
 if(start)await G.action(env,ids[0],{partyId:id,op:'start'},T);
 return {env,id,ids};
}
const state=f=>JSON.parse(f.env.DB.sqlite.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(f.id).state_json);
const status=f=>f.env.DB.sqlite.prepare('SELECT status FROM rpg_parties WHERE id=?').get(f.id).status;
const edit=(f,fn)=>{const s=state(f);fn(s);f.env.DB.sqlite.prepare('UPDATE rpg_parties SET state_json=? WHERE id=?').run(JSON.stringify(s),f.id);};
function stableRandom(t){t.mock.method(crypto,'getRandomValues',a=>{a.fill(0x80000000);return a;});}
const normalized=f=>JSON.parse(JSON.stringify(state(f)).replaceAll(f.id,'PARTY'));
async function online(f,until){let s=state(f);while(status(f)==='combat'&&s.deadline<=until){await G.view(f.env,f.id,f.ids[0],s.deadline);s=state(f);}return s;}
const rewards=f=>f.env.DB.sqlite.prepare('SELECT char_id,reward_json FROM rpg_party_rewards WHERE party_id=? ORDER BY char_id').all(f.id);

for(const roles of [false,true])test(`${roles?'15':'5'} second turns: a thirty-second background tick matches punctual online combat exactly`,async t=>{
 stableRandom(t);const a=await fixture(t,{roles}),b=await fixture(t,{roles});
 for(const f of[a,b])edit(f,s=>{s.enemy.hp=s.enemy.maxHp=1e12;for(const x of s.actors){x.hp=x.maxHp=1e9;x.def=1e12;}});
 await online(a,T+30000);await G.sweep(b.env,T+30000);
 assert.deepEqual(normalized(b),normalized(a));assert.equal(state(b).turnSequence,roles?2:6);
 assert.equal(state(b).lastTurn.at,T+30000);assert.equal(state(b).deadline,T+30000+(roles?15000:5000));
});

for(const kind of ['dungeon','tower'])for(const roles of[false,true])test(`${kind} ${roles?'with role mechanics':'ordinary'}: no viewer for two hours still resolves the same fight, floors and rewards as online`,async t=>{
 stableRandom(t);const a=await fixture(t,{kind,roles}),b=await fixture(t,{kind,roles});
 // Existing live teams may still carry the old thirty-minute expiry.
 for(const f of[a,b])f.env.DB.sqlite.prepare('UPDATE rpg_parties SET expires_at=? WHERE id=?').run(T+1800000,f.id);
 await online(a,T+7200000);await G.sweep(b.env,T+7200000);
 assert.equal(status(a),'won');assert.equal(status(b),'won');assert.deepEqual(normalized(b),normalized(a));
 assert.deepEqual(rewards(b),rewards(a));assert.equal(rewards(b).length,3);
 if(kind==='tower'){assert.equal(state(b).floor,roles?30:10);assert.equal(state(b).journalFloors.length,10);}
 assert.ok(state(b).endedAt<T+1800000,'the true finish time survives a delayed scheduler');
 for(const tg of b.ids){const offline=await loadPlayer(b.env.DB,tg),live=await loadPlayer(a.env.DB,tg);assert.equal(offline.char.party_id,null);assert.equal(offline.char.last_settle_at,live.char.last_settle_at);}
 const before=JSON.stringify(rewards(b));await G.sweep(b.env,T+7200001);await G.view(b.env,b.id,b.ids[0],T+7200001);
 assert.equal(JSON.stringify(rewards(b)),before);
 assert.equal(b.env.DB.sqlite.prepare('SELECT count(*) n FROM rpg_ledger WHERE event_id LIKE ?').get('party-reward:'+b.id+':%').n,3);
});

test('no future turn runs early, and a stale manual command cannot change an elapsed round',async t=>{
 const f=await fixture(t);const before=normalized(f);await G.sweep(f.env,T+4999);assert.deepEqual(normalized(f),before);
 edit(f,s=>{s.enemy.hp=s.enemy.maxHp=1e12;});
 await assert.rejects(G.action(f.env,f.ids[0],{partyId:f.id,op:'submit',round:1,skillId:'defend'},T+30000),e=>e.code==='round');
 assert.equal(state(f).round,7);assert.equal(state(f).actors[0].manualActions||0,0);
 const snapshot=normalized(f);await G.view(f.env,f.id,f.ids[0],T+30000);assert.deepEqual(normalized(f),snapshot);
});

test('catch-up spends the same potions and skill cooldowns as online; one optimistic conflict rolls back all rounds and potion deductions',async t=>{
 stableRandom(t);const a=await fixture(t),b=await fixture(t);
 for(const f of[a,b]){
  for(const tg of f.ids){f.env.DB.sqlite.prepare('UPDATE rpg_characters SET auto_blue=1,special_json=? WHERE tg_id=?').run(JSON.stringify({autoBluePct:100,autoBluePotion:'blue_2'}),tg);f.env.DB.sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,100) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=100').run(tg,'blue_2');}
  edit(f,s=>{s.enemy.hp=s.enemy.maxHp=1e12;for(const x of s.actors){x.hp=x.maxHp=1e9;x.def=1e12;x.mp=0;x.maxMp=100;x.special.learned=['skill_02_1'];x.special.loadout=['skill_02_1'];}});
 }
 const batch=b.env.DB.batch.bind(b.env.DB);let conflicted=false;
 b.env.DB.batch=async stmts=>{if(!conflicted&&stmts[0]?.sql.startsWith('UPDATE rpg_parties')){conflicted=true;b.env.DB.sqlite.prepare('UPDATE rpg_characters SET rev=rev+1 WHERE tg_id=?').run(b.ids[0]);}return batch(stmts);};
 await online(a,T+150000);await G.sweep(b.env,T+150000);assert.equal(conflicted,true);
 assert.deepEqual(normalized(b),normalized(a));
 for(const tg of a.ids){const x=await loadPlayer(a.env.DB,tg),y=await loadPlayer(b.env.DB,tg);assert.deepEqual(y.inv,x.inv);assert.ok(x.inv.blue_2<99,'multiple due turns consume actual potions');assert.deepEqual(JSON.parse(y.char.special_json),JSON.parse(x.char.special_json));}
 const inventory=(await loadPlayer(b.env.DB,b.ids[0])).inv;await G.sweep(b.env,T+150000);assert.deepEqual((await loadPlayer(b.env.DB,b.ids[0])).inv,inventory);
});

test('background sweep retries unbanked wins after a reward write fails, without a player opening any view',async t=>{
 const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);let fail=true;
 f.env.DB.batch=async stmts=>{if(fail&&stmts.some(s=>s.sql.startsWith('INSERT INTO rpg_party_rewards')))throw Error('isolated reward write failure');return batch(stmts);};
 await G.sweep(f.env,T+1800000);assert.equal(status(f),'won');assert.equal(rewards(f).length,0);
 fail=false;await G.sweep(f.env,T+1800001);assert.equal(rewards(f).length,3);
 await Promise.all([G.sweep(f.env,T+1800002),G.sweep(f.env,T+1800002)]);assert.equal(rewards(f).length,3);
});

test('simultaneous background sweeps and a returning browser cannot resolve the same turns or grant a win twice',async t=>{
 stableRandom(t);const a=await fixture(t),b=await fixture(t);await online(a,T+60000);
 await Promise.allSettled([G.sweep(b.env,T+60000),G.view(b.env,b.id,b.ids[0],T+60000),G.sweep(b.env,T+60000)]);
 await G.sweep(b.env,T+60001);
 assert.equal(status(b),'won');assert.deepEqual(normalized(b),normalized(a));assert.deepEqual(rewards(b),rewards(a));
 assert.equal(b.env.DB.sqlite.prepare('SELECT count(*) n FROM rpg_ledger WHERE event_id LIKE ?').get('party-reward:'+b.id+':%').n,3);
});

test('the forty-round defeat rule remains enforced and does not become a wall-clock timeout',async t=>{
 const f=await fixture(t);edit(f,s=>{s.enemy.hp=s.enemy.maxHp=1e12;for(const x of s.actors){x.hp=x.maxHp=1e9;x.def=1e12;}});
 await G.sweep(f.env,T+7200000);assert.equal(status(f),'lost');assert.equal(state(f).lastTurn.round,40);
 assert.equal(state(f).endedAt,T+200000);assert.equal(rewards(f).length,0);assert.match(state(f).log.join(''),/狂暴/);
});

test('a full ready lobby starts in the background, without backdating combat over already settled idle time',async t=>{
 const f=await fixture(t,{start:false});await G.sweep(f.env,T+7200000);
 assert.equal(status(f),'combat');assert.equal(state(f).combatStartedAt,T+7200000);assert.equal(rewards(f).length,0);
 await G.sweep(f.env,T+7260000);assert.equal(status(f),'won');assert.equal(rewards(f).length,3);
});

test('the independent minute cron advances and awards an offline party without Telegram delivery or browser requests',async t=>{
 const f=await fixture(t);let pending;
 app.scheduled({cron:'* * * * *',scheduledTime:T+60000},f.env,{waitUntil:p=>{pending=p;}});await pending;
 assert.equal(status(f),'won');assert.equal(rewards(f).length,3);
});

test('six offline parties catch up with bounded D1 work and one combat card each, without per-round writes',async t=>{
 const first=await fixture(t),runs=[first];for(let i=1;i<6;i++)runs.push(await fixture(t,{env:first.env,base:100+i*10}));
 const beforeCards=new Map(runs.map(f=>[f.id,f.env.DB.sqlite.prepare('SELECT count(*) n FROM rpg_outbox WHERE dedupe_key LIKE ?').get('party:'+f.id+':%').n]));
 let queries=0;const prepare=first.env.DB.prepare.bind(first.env.DB);
 const wrap=s=>{const exec=s._exec.bind(s),bind=s.bind.bind(s);s._exec=()=>{queries++;return exec();};s.bind=(...p)=>wrap(bind(...p));return s;};
 first.env.DB.prepare=sql=>wrap(prepare(sql));
 await G.sweep(first.env,T+7200000,30);const used=queries;t.diagnostic('D1 statements for six full offline wins including rewards: '+used);
 assert.ok(used<700,'D1 work remains bounded, leaving capacity for other jobs');
 for(const f of runs){assert.equal(status(f),'won');assert.equal(rewards(f).length,3);assert.equal(state(f).recentTurns.length<=5,true);assert.equal(f.env.DB.sqlite.prepare('SELECT count(*) n FROM rpg_outbox WHERE dedupe_key LIKE ?').get('party:'+f.id+':%').n-beforeCards.get(f.id),4,'one combat update plus three existing reward updates, no per-round card flood');}
});
