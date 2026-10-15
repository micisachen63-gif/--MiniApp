import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/guardian-sigil.js';
import {activeSettings} from '../src/game/guardian-sigil-config.js';

async function fixture() {
  const env={DB:freshDb()};await P.createCharacter(env,{tgId:'790',name:'支援快照',baseClass:'sword',gender:'m'},T0);
  await env.DB.prepare("UPDATE rpg_characters SET level=35,gold=100000 WHERE tg_id='790'").run();
  const op='snapshot-origin';await env.DB.prepare('INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(op,'790','790','snapshot_source','summon','0'.repeat(64),activeSettings(env).configVersion,'{}','{}',T0).run();
  await G.insertSigil(env.DB,{id:'snapshot-angel',char_id:'790',type:'melee',quality:4,bound:0,source_operation_id:op,created_at:T0}).run();
  return env;
}
const snapshot=db=>JSON.stringify(db.sqlite.prepare("SELECT tg_id,gold,rev,special_json FROM rpg_characters ORDER BY tg_id").all())+JSON.stringify(db.sqlite.prepare('SELECT * FROM rpg_inventory ORDER BY tg_id,item').all())+JSON.stringify(db.sqlite.prepare('SELECT * FROM rpg_guardian_sigils ORDER BY id').all())+JSON.stringify(db.sqlite.prepare('SELECT * FROM rpg_ledger ORDER BY rowid').all());

test('assist snapshot exposes existing balances and pauses without conflating permanent guardian activation',async()=>{
  const env=await fixture(),before=snapshot(env.DB),first=await G.state(env,'790',T0);assert.equal(snapshot(env.DB),before);
  assert.deepEqual(first.assist,{itemId:null,remainingBattles:0,enabled:false,autoRenew:false,autoBuy:false,stoneCount:0,battlesPerStone:1440,stoneGold:3000});
  await G.assist(env,'790',{mode:'buy',quantity:2,requestId:'snapshot_buy'},T0);
  await G.assist(env,'790',{mode:'start',itemId:'snapshot-angel',autoRenew:true,requestId:'snapshot_start'},T0);
  const started=await G.state(env,'790',T0);assert.equal(started.assist.enabled,true);assert.equal(started.assist.itemId,'snapshot-angel');assert.equal(started.assist.remainingBattles,1440);assert.equal(started.assist.stoneCount,1);assert.equal(started.assist.autoRenew,true);
  await G.assist(env,'790',{mode:'stop',requestId:'snapshot_stop'},T0);
  const afterStop=snapshot(env.DB),paused=await G.state(env,'790',T0),again=await G.state(env,'790',T0);
  assert.equal(snapshot(env.DB),afterStop);assert.deepEqual(again.assist,paused.assist);assert.equal(paused.assist.enabled,false);assert.equal(paused.assist.remainingBattles,1440);assert.equal(paused.activeGuardian.id,'snapshot-angel');assert.equal(paused.activeGuardian.active,true);assert.equal(paused.assist.stoneCount,1);
});

test('assist state is per character and adds no SQL read or mutation to the existing snapshot path',async()=>{
  const env=await fixture();const second=(await P.createCharacter(env,{tgId:'790',name:'另一支援快照',baseClass:'mage',gender:'f'},T0)).char.tg_id;
  await G.assist(env,'790',{mode:'buy',quantity:1,requestId:'snapshot_buy2'},T0);
  await G.assist(env,'790',{mode:'start',itemId:'snapshot-angel',requestId:'snapshot_start2'},T0);
  let prepared=0;const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=(sql)=>{prepared++;return prepare(sql);};
  const original=await G.state(env,'790',T0);assert.equal(prepared,8);assert.equal(original.assist.enabled,true);
  prepared=0;const inactive=await G.state(env,second,T0);assert.equal(prepared,8);assert.equal(inactive.assist.itemId,null);assert.equal(inactive.assist.stoneCount,0);assert.equal(inactive.assist.enabled,false);
});
