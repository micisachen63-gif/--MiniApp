import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {createCharacter} from '../src/services/player.js';
import {loadPlayer} from '../src/db.js';
import * as G from '../src/services/guardian-sigil.js';
import * as A from '../src/services/guardian-auto.js';
import * as N from '../src/services/background-operations.js';

async function fixture({welcome=false,gold=100000}={}) {
 const db=freshDb(),env={DB:db};
 await createCharacter(env,{tgId:'880',name:'天使審查甲',baseClass:'sword',gender:'m'},T0);
 await db.prepare("UPDATE rpg_characters SET level=30,gold=? WHERE tg_id='880'").bind(gold).run();
 if(welcome)await G.inventory(env,'880',{},T0);
 return {db,env};
}
const count=async(db,table)=>(await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n;
const auto={pool:'normal',count:5,targetType:'any',targetRank:1,requestId:'audit-auto-request'};
function awaitBothAutoInserts(db) {
 const original=db.batch.bind(db);let n=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 db.batch=async statements=>{
  if(statements.some(s=>s.sql?.startsWith('INSERT INTO rpg_guardian_auto('))) {
   if(++n===2)release();
   await gate;
  }
  return original(statements);
 };
}

test('simultaneous identical manual requests award and charge exactly once',async()=>{
 const {db,env}=await fixture(),b={pool:'normal',count:10,requestId:'audit-manual-same'};
 const replies=await Promise.all([G.summon(env,'880',b,T0),G.summon(env,'880',b,T0)]);
 assert.deepEqual(replies[0].operation,replies[1].operation);
 assert.equal((await loadPlayer(db,'880')).char.gold,100000-8500);
 assert.equal(await count(db,'rpg_guardian_operations'),1);
 assert.equal(await count(db,'rpg_guardian_sigils'),10);
});

test('two different manual requests competing for one draw never overspend',async()=>{
 const {db,env}=await fixture({gold:850});
 const replies=await Promise.allSettled(['audit-last-gold-a','audit-last-gold-b'].map(requestId=>G.summon(env,'880',{pool:'normal',count:1,requestId},T0)));
 assert.equal(replies.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(replies.find(r=>r.status==='rejected').reason.code,'gold');
 assert.equal((await loadPlayer(db,'880')).char.gold,0);
 assert.equal(await count(db,'rpg_guardian_operations'),1);
 assert.equal(await count(db,'rpg_guardian_sigils'),1);
});

test('a failure after a reward insert rolls back gold, receipt and the entire batch',async()=>{
 const {db,env}=await fixture();
 db.sqlite.exec("CREATE TRIGGER audit_abort_second BEFORE INSERT ON rpg_guardian_sigils WHEN NEW.id LIKE '%-1' BEGIN SELECT RAISE(ABORT,'audit_simulated_failure'); END;");
 await assert.rejects(G.summon(env,'880',{pool:'normal',count:5,requestId:'audit-late-failure'},T0),/audit_simulated_failure/);
 assert.equal((await loadPlayer(db,'880')).char.gold,100000);
 assert.equal(await count(db,'rpg_guardian_operations'),0);
 assert.equal(await count(db,'rpg_guardian_sigils'),0);
});

test('lost response after commit recovers the same reward and never charges a second time',async()=>{
 const {db,env}=await fixture(),originalBatch=db.batch.bind(db),b={pool:'normal',count:5,requestId:'audit-lost-response'};
 let committed=false,failed=false;
 db.batch=async statements=>{
  if(committed&&!failed&&statements[0]?.sql?.startsWith('SELECT c.*, a.active_char_id')) {failed=true;throw Error('audit_response_lost');}
  const result=await originalBatch(statements);
  if(statements.some(s=>s.sql?.startsWith('INSERT INTO rpg_guardian_operations(')))committed=true;
  return result;
 };
 await assert.rejects(G.summon(env,'880',b,T0),/audit_response_lost/);
 const receipt=(await G.operation(env,'880',{requestId:b.requestId})).operation;
 const recovered=await G.summon(env,'880',b,T0+1000);
 assert.deepEqual(recovered.operation,receipt);
 assert.equal((await loadPlayer(db,'880')).char.gold,100000-4250);
 assert.equal(await count(db,'rpg_guardian_sigils'),5);
});

test('featured mixed single/five/ten draws conserve each voucher and every remaining draw',async()=>{
 const {db,env}=await fixture();
 await db.prepare("INSERT INTO rpg_inventory VALUES('880','guardian_voucher',4)").run();
 let remaining=20,total=0;
 for(const [i,size]of [1,5,10,1,1,1,1].entries()) {
  const r=await G.summon(env,'880',{pool:'featured',count:size,requestId:'audit-featured-'+i},T0+i);
  remaining-=size;total+=size;
  assert.equal(r.state.balances.availableDraws,remaining);
  assert(r.state.balances.remainder>=0&&r.state.balances.remainder<=4);
  assert(r.operation.results.every(x=>x.rank>=2));
 }
 assert.equal(remaining,0);assert.equal(await count(db,'rpg_guardian_sigils'),total);
 const before=await loadPlayer(db,'880');
 await assert.rejects(G.summon(env,'880',{pool:'featured',count:1,requestId:'audit-featured-empty'},T0+99),{code:'insufficient'});
 assert.deepEqual(await loadPlayer(db,'880'),before);
});

test('simultaneous alternate character entries grant account welcome only once',async()=>{
 const {db,env}=await fixture();
 await createCharacter(env,{tgId:'880',charSlot:2,name:'天使審查乙',baseClass:'mage',gender:'f'},T0);
 const second=(await db.prepare("SELECT tg_id FROM rpg_characters WHERE account_tg_id='880' AND char_slot=2").first()).tg_id;
 await db.prepare('UPDATE rpg_characters SET level=30 WHERE tg_id=?').bind(second).run();
 await Promise.all([G.inventory(env,'880',{},T0),G.inventory(env,second,{},T0)]);
 assert.equal(await count(db,'rpg_guardian_welcome'),1);
 assert.equal((await db.prepare("SELECT SUM(quantity) n FROM rpg_inventory WHERE item='guardian_free_normal'").first()).n,200);
});

test('parallel identical auto start creates one job, one queued notification and one draw batch',async()=>{
 const {db,env}=await fixture({welcome:true});awaitBothAutoInserts(db);
 const results=await Promise.all([A.start(env,'880',auto,T0),A.start(env,'880',auto,T0)]);
 assert.equal(results[0].job.id,results[1].job.id);
 assert.equal(await count(db,'rpg_guardian_auto'),1);
 assert.equal((await N.list(env,'880')).length,1);
 await Promise.all([A.step(env,results[0].job.id,T0),A.step(env,results[0].job.id,T0)]);
 assert.equal((await A.view(env,'880')).totalDraws,5);
 assert.equal((await loadPlayer(db,'880')).inv.guardian_free_normal,195);
 assert.equal(await count(db,'rpg_guardian_sigils'),5);
});

test('parallel auto requests reusing the same ID with different settings must reject the losing payload',async()=>{
 const {db,env}=await fixture({welcome:true});awaitBothAutoInserts(db);
 const results=await Promise.allSettled([A.start(env,'880',auto,T0),A.start(env,'880',{...auto,count:10},T0)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'request_reused');
 assert.equal(await count(db,'rpg_guardian_auto'),1);
});

test('auto request IDs cannot be replayed for another character of the same account',async()=>{
 const {db,env}=await fixture({welcome:true});
 await createCharacter(env,{tgId:'880',charSlot:2,name:'天使收據乙',baseClass:'mage',gender:'f'},T0);
 const other=(await db.prepare("SELECT tg_id FROM rpg_characters WHERE account_tg_id='880' AND char_slot=2").first()).tg_id;
 await db.prepare('UPDATE rpg_characters SET level=30 WHERE tg_id=?').bind(other).run();
 const first=(await A.start(env,'880',auto,T0)).job;
 await A.step(env,first.id,T0);
 await assert.rejects(A.start(env,other,auto,T0+3000),{code:'request_reused',status:409});
 assert.equal(await count(db,'rpg_guardian_auto'),1);
 assert.equal((await loadPlayer(db,other)).inv.guardian_free_normal||0,0);
});

test('an auto-start revision race reports retryable conflict without creating an orphan job',async()=>{
 const {db,env}=await fixture({welcome:true}),original=db.batch.bind(db);let interfered=false;
 db.batch=async statements=>{
  if(!interfered&&statements.some(s=>s.sql?.startsWith('INSERT INTO rpg_guardian_auto('))) {
   interfered=true;await db.prepare("UPDATE rpg_characters SET rev=rev+1 WHERE tg_id='880'").run();
  }
  return original(statements);
 };
 await assert.rejects(A.start(env,'880',auto,T0),{code:'conflict'});
 assert.equal(await count(db,'rpg_guardian_auto'),0);
 const retry=await A.start(env,'880',auto,T0);
 assert.equal(retry.job.status,'running');
 assert.equal(await count(db,'rpg_guardian_auto'),1);
});

test('manual stop at the commit boundary cancels the auto batch without awarding or consuming anything',async()=>{
 const {db,env}=await fixture({welcome:true}),started=(await A.start(env,'880',auto,T0)).job,original=db.batch.bind(db);let stopped=false;
 db.batch=async statements=>{
  if(!stopped&&statements.some(s=>s.sql?.startsWith('INSERT INTO rpg_guardian_operations('))) {
   stopped=true;await A.stop(env,'880',{jobId:started.id},T0+1);
  }
  return original(statements);
 };
 await A.step(env,started.id,T0);
 assert.equal((await A.view(env,'880')).reason,'stopped');
 assert.equal((await loadPlayer(db,'880')).inv.guardian_free_normal,200);
 assert.equal(await count(db,'rpg_guardian_sigils'),0);
 assert.equal(await count(db,'rpg_guardian_operations'),0);
});
