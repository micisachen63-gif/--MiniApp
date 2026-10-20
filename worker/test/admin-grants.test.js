import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import * as P from '../src/services/player.js';
import * as G from '../src/admin/grants.js';
import {GRANT_ITEM_IDS,grantable} from '../src/admin/catalog.js';
import {ITEMS} from '../src/game/constants.js';
import {loadPlayer,persistStatements} from '../src/db.js';
const NOW=Date.parse('2026-10-20T10:00:00+08:00'),ADMIN={id:'900'},OTHER={id:'901'};
async function fixture(t){const env={DB:freshDb(),BOT_TOKEN:'test-administration-token'},db=env.DB.sqlite;t.after(()=>db.close());for(const id of ['101','102'])await P.createCharacter(env,{tgId:id,name:'測試'+id,baseClass:'sword',gender:'f'},NOW);return {env,db};}
const body=over=>({charIds:['101','102'],gold:100,item:'scroll_w',qty:2,reason:'活動測試獎勵',...over});
async function prepared(f,over={}){const preview=await G.preview(f.env,ADMIN,body(over),NOW);return {requestId:crypto.randomUUID(),ticket:preview.ticket,payload:preview.payload};}
const quantity=(f,id,item)=>f.db.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').get(id,item)?.quantity||0;
const gold=(f,id)=>f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(id).gold;
test('preview is read-only, names exact characters and totals per-person rewards without changing game state',async t=>{
 const f=await fixture(t),before=gold(f,'101'),out=await G.preview(f.env,ADMIN,body(),NOW);
 assert.deepEqual(out.targets.map(x=>x.id),['101','102']);assert.deepEqual(out.totals,{players:2,gold:200,qty:4});assert.equal(out.payload.reason,'活動測試獎勵');assert.equal(gold(f,'101'),before);assert.equal(quantity(f,'101','scroll_w'),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_grants').get().n,0);
});
test('one confirmed batch atomically credits both exact characters and creates a single matching audit plus ledger per recipient',async t=>{
 const f=await fixture(t),b=await prepared(f),before=['101','102'].map(x=>gold(f,x));const result=await G.commit(f.env,ADMIN,b,NOW+1);
 for(const[i,id]of ['101','102'].entries()){assert.equal(gold(f,id),before[i]+100);assert.equal(quantity(f,id,'scroll_w'),2);}
 assert.equal(result.id,b.requestId);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_ledger WHERE type='管理者發獎'").get().n,2);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_admin_audit WHERE action='後台發獎'").get().n,1);assert.deepEqual(await G.status(f.env,ADMIN,b),result);assert.equal(await G.status(f.env,OTHER,b),null);
});
test('same committed operation replays original receipt even after preview expiry without crediting again',async t=>{
 const f=await fixture(t),b=await prepared(f),first=await G.commit(f.env,ADMIN,b,NOW+1),after=gold(f,'101');assert.deepEqual(await G.commit(f.env,ADMIN,b,NOW+3600000),first);assert.equal(gold(f,'101'),after);assert.equal(quantity(f,'101','scroll_w'),2);
});
test('same request with different content is rejected, not mistaken for the original successful gift',async t=>{
 const f=await fixture(t),b=await prepared(f);await G.commit(f.env,ADMIN,b,NOW+1);await assert.rejects(G.commit(f.env,ADMIN,{...b,payload:{...b.payload,gold:101}},NOW+2),e=>e.code==='grant_reused');assert.equal(quantity(f,'101','scroll_w'),2);
});
test('overlapping submissions at the commit barrier grant only once and both return the same committed receipt',async t=>{
 const f=await fixture(t),b=await prepared(f),batch=f.env.DB.batch.bind(f.env.DB);let reached,release;const gate=new Promise(r=>release=r),entered=new Promise(r=>reached=r);let first=true;
 f.env.DB.batch=async stmts=>{if(first&&stmts[0].sql.startsWith('INSERT INTO rpg_admin_grants')){first=false;reached();await gate;}return batch(stmts);};
 const a=G.commit(f.env,ADMIN,b,NOW+1);await entered;const second=await G.commit(f.env,ADMIN,b,NOW+1);release();assert.deepEqual(await a,second);assert.equal(quantity(f,'101','scroll_w'),2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_grants').get().n,1);
});
test('failure in the middle of a multi-recipient grant rolls back every player, receipt, inventory and audit and allows same-id retry',async t=>{
 const f=await fixture(t),b=await prepared(f),before=gold(f,'101'),batch=f.env.DB.batch.bind(f.env.DB);let failed=false;
 f.env.DB.batch=async stmts=>{if(!failed&&stmts[0].sql.startsWith('INSERT INTO rpg_admin_grants')){failed=true;return batch([...stmts.slice(0,4),f.env.DB.prepare('INSERT INTO nonexistent_admin_table VALUES(1)'),...stmts.slice(4)]);}return batch(stmts);};
 await assert.rejects(G.commit(f.env,ADMIN,b,NOW+1));assert.equal(gold(f,'101'),before);assert.equal(quantity(f,'101','scroll_w'),0);assert.equal(await G.status(f.env,ADMIN,b),null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_audit').get().n,0);await G.commit(f.env,ADMIN,b,NOW+2);assert.equal(quantity(f,'102','scroll_w'),2);
});
for(const [label,over]of Object.entries({empty:{gold:0,item:null},negative:{gold:-1},fraction:{gold:1.5},excess:{gold:1000001},quantity:{qty:1000},duplicate:{charIds:['101','101']},missing:{charIds:['101','999']},reason:{reason:'a'},control:{reason:'活動\n獎勵'},entitlement:{item:'fate_cycle_gift'},welcome:{item:'guardian_free_normal'},prototype:{item:'__proto__'}}))test(`unsafe reward ${label} is rejected before any mutation`,async t=>{const f=await fixture(t);await assert.rejects(G.preview(f.env,ADMIN,body(over),NOW));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_admin_grants').get().n,0);});
test('preview ticket is bound to administrator, expiry, exact rewards and recipient list',async t=>{
 const f=await fixture(t),b=await prepared(f);
 for(const [admin,input,time]of [[OTHER,b,NOW+1],[ADMIN,{...b,ticket:'0.'+'a'.repeat(64)},NOW+1],[ADMIN,{...b,payload:{...b.payload,charIds:['101']}},NOW+1],[ADMIN,b,NOW+300001]])await assert.rejects(G.commit(f.env,admin,input,time),e=>e.code==='grant_preview');assert.equal(quantity(f,'101','scroll_w'),0);
});
test('holding caps are enforced in preview and again atomically if inventory changes after validation',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('101','ward',4)").run();await assert.rejects(G.preview(f.env,ADMIN,body({item:'ward',qty:2}),NOW),e=>e.code==='grant_capacity');const b=await prepared(f,{item:'ward',qty:1}),batch=f.env.DB.batch.bind(f.env.DB);
 f.env.DB.batch=async stmts=>{if(stmts[0].sql.startsWith('INSERT INTO rpg_admin_grants'))f.db.prepare("UPDATE rpg_inventory SET quantity=5 WHERE tg_id='101' AND item='ward'").run();return batch(stmts);};
 await assert.rejects(G.commit(f.env,ADMIN,b,NOW+1));assert.equal(quantity(f,'101','ward'),5);assert.equal(quantity(f,'102','ward'),0);assert.equal(await G.status(f.env,ADMIN,b),null);
});
test('item-only grant bumps character revision and prevents an old whole-player write from erasing rewards',async t=>{
 const f=await fixture(t),before=await loadPlayer(f.env.DB,'101'),after=structuredClone(before),b=await prepared(f,{gold:0});await G.commit(f.env,ADMIN,b,NOW+1);
 await assert.rejects(f.env.DB.batch(persistStatements(f.env.DB,before,after,{},NOW+2)));assert.equal(quantity(f,'101','scroll_w'),2);
});
test('awards do not change running expedition state, combat configuration, HP, MP, skills, equipped gear or guardians',async t=>{
 const f=await fixture(t),b=await prepared(f),state=JSON.stringify({actors:[{charId:'101',atk:999}],tier:40,frozen:'untouched'});
 f.db.prepare("INSERT INTO rpg_star_ring_runs(id,leader_id,status,state_json,created_at,updated_at,expires_at,next_at) VALUES('ring:test','101','running',?,?,?,?,?)").run(state,NOW,NOW,NOW+43200000,NOW+1);
 f.db.prepare("UPDATE rpg_characters SET party_id='ring:test',special_json=? WHERE tg_id='101'").run('{"loadout":["skill01"]}');
 const char=f.db.prepare("SELECT hp,mp,party_id,special_json FROM rpg_characters WHERE tg_id='101'").get(),equipment=f.db.prepare('SELECT * FROM rpg_equipment ORDER BY id').all();await G.commit(f.env,ADMIN,b,NOW+1);
 assert.deepEqual(f.db.prepare("SELECT hp,mp,party_id,special_json FROM rpg_characters WHERE tg_id='101'").get(),char);assert.equal(f.db.prepare("SELECT state_json FROM rpg_star_ring_runs WHERE id='ring:test'").get().state_json,state);assert.deepEqual(f.db.prepare('SELECT * FROM rpg_equipment ORDER BY id').all(),equipment);
});
test('curated award catalog has no duplicates, unknown ids or entitlement-backed fake gifts',()=>{
 assert.equal(new Set(GRANT_ITEM_IDS).size,GRANT_ITEM_IDS.length);for(const id of GRANT_ITEM_IDS)assert.ok(ITEMS[id],id);assert.equal(grantable('fate_cycle_gift'),false);assert.equal(grantable('guardian_free_normal'),false);assert.equal(grantable('future_dangerous_item'),false);
});
