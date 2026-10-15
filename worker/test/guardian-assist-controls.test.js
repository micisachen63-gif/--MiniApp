import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0,mkChar} from './helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/guardian-sigil.js';
import * as X from '../src/services/market-exchange.js';
import {loadPlayer} from '../src/db.js';
import {specialState} from '../src/game/special.js';
import {beginAssistBattle,idleGuardianActor} from '../src/game/guardian-assist.js';
import {guardianEffect,guardianDamageMultiplier} from '../src/game/guardian-effects.js';

async function fixture() {
  const env={DB:freshDb()};await P.createCharacter(env,{tgId:'790',name:'召喚交互',baseClass:'sword',gender:'m'},T0);
  await env.DB.prepare("UPDATE rpg_characters SET level=35,gold=100000 WHERE tg_id='790'").run();
  await env.DB.prepare("INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES('source','790','790','source_fixture','summon',?,'fixture','{}','{}',?)").bind('0'.repeat(64),T0).run();
  for(const id of ['first','second'])await G.insertSigil(env.DB,{id,char_id:'790',type:'melee',quality:6,source_operation_id:'source',created_at:T0}).run();
  await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('790','guardian_summon_stone',3)").run();
  return env;
}
const invoke=(env,mode,fields={},key=crypto.randomUUID())=>G.assist(env,'790',{mode,...fields,requestId:key},T0);
const goldAndStones=async env=>{const p=await loadPlayer(env.DB,'790');return {gold:p.char.gold,stones:p.inv.guardian_summon_stone,special:specialState(p.char)};};
async function remaining(env,n) {const p=await loadPlayer(env.DB,'790'),x=specialState(p.char);x.guardianAssist.remainingBattles=n;await env.DB.prepare("UPDATE rpg_characters SET special_json=? WHERE tg_id='790'").bind(JSON.stringify(x)).run();}

test('paused same-card start resumes its exact remainder with zero stones, gold or duplicate receipt charges',async()=>{
  const env=await fixture();await invoke(env,'start',{itemId:'first',autoRenew:false});await remaining(env,321);await invoke(env,'stop');
  const before=await goldAndStones(env),request={mode:'start',itemId:'first',autoRenew:false,requestId:'resume_same_once'};
  const a=await G.assist(env,'790',request,T0),b=await G.assist(env,'790',request,T0),after=await goldAndStones(env);
  assert.deepEqual(a.operation,b.operation);assert.equal(a.operation.resumed,true);assert.equal(a.operation.consumed.stones||0,0);assert.equal(after.stones,before.stones);assert.equal(after.gold,before.gold);assert.equal(after.special.guardianAssist.remainingBattles,321);assert.equal(after.special.guardianSummonEnabled,true);
  assert.equal((await env.DB.prepare("SELECT item_delta FROM rpg_ledger WHERE event_id='guardian-assist:790:resume_same_once'").first()).item_delta,0);
});
test('an enabled card must be cancelled before switching; a paused switch consumes one stone exactly once',async()=>{
  const env=await fixture();await invoke(env,'start',{itemId:'first',autoRenew:false});await remaining(env,88);
  const before=await goldAndStones(env);await assert.rejects(invoke(env,'start',{itemId:'second',autoRenew:true}),{code:'assist_active'});assert.deepEqual(await goldAndStones(env),before);
  await invoke(env,'stop');const switched=await invoke(env,'start',{itemId:'second',autoRenew:false},'switch_once');await invoke(env,'start',{itemId:'second',autoRenew:false},'switch_once');
  assert.equal(switched.operation.consumed.stones,1);assert.equal(switched.operation.replacedRemainingBattles,88);
  const after=await goldAndStones(env);assert.equal(after.stones,before.stones-1);assert.equal(after.gold,before.gold);assert.equal(after.special.guardianAssist.itemId,'second');assert.equal(after.special.guardianAssist.remainingBattles,1440);
});
test('failed paused switch without a stone preserves the old remainder and active guardian',async()=>{
  const env=await fixture();await invoke(env,'start',{itemId:'first',autoRenew:false});await remaining(env,59);await invoke(env,'stop');await env.DB.prepare("UPDATE rpg_inventory SET quantity=0 WHERE item='guardian_summon_stone'").run();
  const before=await goldAndStones(env);await assert.rejects(invoke(env,'start',{itemId:'second',autoRenew:false}),{code:'insufficient'});assert.deepEqual(await goldAndStones(env),before);assert.equal((await G.state(env,'790',T0)).activeGuardian.id,'first');
});
test('continuation controls only its flag; it neither starts a paused angel nor changes supply opt-in',async()=>{
  const env=await fixture();await assert.rejects(invoke(env,'continuation',{autoRenew:true}),{code:'assist'});
  await invoke(env,'start',{itemId:'first',autoRenew:false});await invoke(env,'stop');const before=await goldAndStones(env);
  await invoke(env,'continuation',{autoRenew:true},'continue_once');await invoke(env,'continuation',{autoRenew:true},'continue_once');const after=await goldAndStones(env);
  assert.equal(after.gold,before.gold);assert.equal(after.stones,before.stones);assert.equal(after.special.guardianSummonEnabled,false);assert.equal(after.special.guardianAssist.remainingBattles,before.special.guardianAssist.remainingBattles);assert.equal(after.special.guardianAssist.autoRenew,true);assert.equal(after.special.guardianStoneSupply,undefined);
  await assert.rejects(invoke(env,'continuation',{autoRenew:false},'continue_once'),{code:'request_reused'});await assert.rejects(invoke(env,'continuation',{autoRenew:'true'}),{code:'assist'});
});
test('unchecked continuation preserves the last battle bonus and stops before any next stone or opted-in gold purchase',()=>{
  const c=mkChar({level:35,gold:9000,guardian:guardianEffect({id:'g',type:'melee',quality:6}),guardianAssistSettings:{stoneGold:3000,battlesPerStone:1440},special_json:JSON.stringify({guardianSummonEnabled:true,guardianStoneSupply:true,guardianAssist:{itemId:'g',remainingBattles:1,autoRenew:false}})}),inv={guardian_summon_stone:1},uses=[],buys=[];
  beginAssistBattle(c,inv,key=>{uses.push(key);inv[key]--;},amount=>buys.push(amount));assert.equal(guardianDamageMultiplier(idleGuardianActor(c)),1.32);assert.equal(specialState(c).guardianSummonEnabled,false);assert.equal(specialState(c).guardianAssist.remainingBattles,0);
  beginAssistBattle(c,inv,key=>{uses.push(key);inv[key]--;},amount=>buys.push(amount));assert.equal(inv.guardian_summon_stone,1);assert.equal(c.gold,9000);assert.equal(uses.length,0);assert.equal(buys.length,0);assert.equal(guardianDamageMultiplier(idleGuardianActor(c)),1.16);
});
test('checked continuation uses one owned stone; missing stock stops and never silently buys',()=>{
  const setup=(stock,supply)=>({c:mkChar({level:35,gold:9000,guardian:guardianEffect({id:'g',type:'melee',quality:6}),guardianAssistSettings:{stoneGold:3000,battlesPerStone:1440},special_json:JSON.stringify({guardianSummonEnabled:true,guardianStoneSupply:supply,guardianAssist:{itemId:'g',remainingBattles:0,autoRenew:true}})}),inv:{guardian_summon_stone:stock}});
  for(const [stock,supply] of [[2,false],[0,false],[0,true]]) {
    const {c,inv}=setup(stock,supply),uses=[],buys=[];const use=key=>{uses.push(key);inv[key]--;};beginAssistBattle(c,inv,use,amount=>buys.push(amount));beginAssistBattle(c,inv,use,amount=>buys.push(amount));
    if(stock>0||supply){assert.equal(uses.length,1);assert.equal(specialState(c).guardianAssist.remainingBattles,1438);}else{assert.equal(uses.length,0);assert.equal(specialState(c).guardianSummonEnabled,false);}
    assert.deepEqual(buys,supply?[3000]:[]);assert.equal(c.gold,supply?6000:9000);
  }
});
test('explicit-false legacy selection may fund its first round once, while undefined legacy continuation remains compatible',async()=>{
  const env=await fixture();await invoke(env,'select',{itemId:'first',autoRenew:false});let p=await loadPlayer(env.DB,'790'),uses=0;
  assert.equal(specialState(p.char).guardianAssist.pendingFirstStone,true);
  beginAssistBattle(p.char,p.inv,key=>{p.inv[key]--;uses++;});assert.equal(uses,1);assert.equal(specialState(p.char).guardianAssist.pendingFirstStone,false);
  const x=specialState(p.char);x.guardianAssist.remainingBattles=1;p.char.special_json=JSON.stringify(x);beginAssistBattle(p.char,p.inv,key=>{p.inv[key]--;uses++;});beginAssistBattle(p.char,p.inv,key=>{p.inv[key]--;uses++;});assert.equal(uses,1);assert.equal(specialState(p.char).guardianSummonEnabled,false);
  const old={...x,guardianSummonEnabled:true,guardianAssist:{itemId:'first',remainingBattles:0}};p.char.special_json=JSON.stringify(old);beginAssistBattle(p.char,p.inv,key=>{p.inv[key]--;uses++;});assert.equal(uses,2);assert.equal(specialState(p.char).guardianAssist.remainingBattles,1439);
});
test('first-stone exhaustion stops cleanly, and exchange escrow cannot consume a stone via direct assist',async()=>{
  const env=await fixture();await invoke(env,'select',{itemId:'first',autoRenew:false});let p=await loadPlayer(env.DB,'790');p.inv.guardian_summon_stone=0;beginAssistBattle(p.char,p.inv,()=>assert.fail('no stone'),()=>assert.fail('no opt-in'));assert.equal(specialState(p.char).guardianSummonEnabled,false);
  await invoke(env,'stop');const offered=await X.create(env,'790',{guardianId:'second',price:100,qty:1,characterId:'790',requestId:crypto.randomUUID()},T0);const before=await goldAndStones(env);
  await assert.rejects(invoke(env,'start',{itemId:'second',autoRenew:false}),{code:'not_found'});assert.deepEqual(await goldAndStones(env),before);assert.equal((await env.DB.prepare('SELECT status FROM rpg_exchange_listings WHERE id=?').bind(offered.result.listingId).first()).status,'active');
});
