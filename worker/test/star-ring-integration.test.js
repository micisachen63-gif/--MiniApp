import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as P from '../src/services/player.js';
import * as Party from '../src/services/party.js';
import {selectAccountCharacter} from '../src/accounts.js';
import {APP_ACTIONS} from '../src/app.js';
import {settleIdle} from '../src/game/idle.js';
import {loadPlayer} from '../src/db.js';
import {ITEMS,TRADE} from '../src/game/constants.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';
import {handle} from '../src/index.js';
import * as Ring from '../src/services/star-ring.js';

async function twoCharacters(){
 const env={DB:freshDb()};
 await P.createCharacter(env,{tgId:'87001',name:'遠征劍士',gender:'m',baseClass:'sword'},T0);
 await P.createCharacter(env,{tgId:'87001',name:'留守法師',gender:'f',baseClass:'mage',charSlot:2},T0);
 const all=(await env.DB.prepare('SELECT tg_id FROM rpg_characters WHERE account_tg_id=? ORDER BY char_slot').bind('87001').all()).results;
 return {env,a:all[0].tg_id,b:all[1].tg_id};
}
test('owner can switch away from and back into a snapshot expedition without clearing its lock or awarding ordinary idle EXP',async()=>{
 const {env,a,b}=await twoCharacters();await selectAccountCharacter(env,'87001',a,T0);
 await env.DB.prepare("UPDATE rpg_characters SET party_id='ring:fixture' WHERE tg_id=?").bind(a).run();
 await selectAccountCharacter(env,'87001',b,T0+60000);
 assert.equal((await loadPlayer(env.DB,a)).char.party_id,'ring:fixture');
 const player=await loadPlayer(env.DB,a),settled=settleIdle(player.char,player.inv,player.equipment,T0+3600000);
 assert.equal(settled.report.exp_gained,0);
 await selectAccountCharacter(env,'87001',a,T0+120000);
 assert.equal((await env.DB.prepare('SELECT active_char_id FROM rpg_accounts WHERE account_tg_id=?').bind('87001').first()).active_char_id,a);
 assert.equal((await loadPlayer(env.DB,a)).char.party_id,'ring:fixture');
});
test('short combat still locks character switching and foreign characters remain inaccessible',async()=>{
 const {env,a,b}=await twoCharacters();await selectAccountCharacter(env,'87001',a,T0);
 await env.DB.prepare("UPDATE rpg_characters SET party_id='short-party' WHERE tg_id=?").bind(a).run();
 await assert.rejects(selectAccountCharacter(env,'87001',b,T0+1000),e=>e.code==='party');
 await assert.rejects(selectAccountCharacter(env,'other-account',a,T0+1000),e=>e.code==='character_not_owned');
});
test('existing three-person lobby listing recognizes a long expedition instead of trying to load a nonexistent short-party row',async()=>{
 const {env,a}=await twoCharacters();await env.DB.prepare('INSERT INTO rpg_party_presence(account_id,party_id,char_id) VALUES(?,?,?)').bind('87001','ring:fixture',a).run();
 const result=await Party.list(env,a,T0);assert.equal(result.active,null);assert.equal(result.starRingId,'ring:fixture');
});
test('only authenticated application actions expose expedition controls and currency stays bound',()=>{
 for(const action of ['list','me','get','create','action','shop'])assert.equal(APP_ACTIONS['star-ring/'+action],'/rpg/star-ring/'+action);
 assert.equal(APP_ACTIONS['star-ring/tick'],undefined);
 assert.equal(ITEMS.star_ring_token.tradeable,false);assert.equal(ITEMS.star_ring_token.kind,'bound');assert.ok(!TRADE.tradeableItems.includes('star_ring_token'));
});
test('a completion link opens its exact owned character rewards read-only after switching, and rejects another account',async()=>{
 const {env,a,b}=await twoCharacters();Object.assign(env,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'});
 await selectAccountCharacter(env,'87001',a,T0);await env.DB.prepare("UPDATE rpg_characters SET level=40,class_path='A' WHERE tg_id=?").bind(a).run();
 const {party}=await Ring.create(env,a,{tier:40,requestId:'notify-create'},T0);
 await env.DB.prepare("UPDATE rpg_star_ring_runs SET status='complete' WHERE id=?").bind(party.id).run();
 await env.DB.prepare('INSERT INTO rpg_star_ring_rewards(run_id,char_id,stage,reward_json,created_at) VALUES(?,?,?,?,?)').bind(party.id,a,0,JSON.stringify({exp:123,items:{star_ring_token:10},equipment:[]}),T0).run();
 await selectAccountCharacter(env,'87001',b,T0);
 const call=(account,recipient,selected)=>handle(new Request('http://rpg/app/api/star-ring/get',{method:'POST',headers:{'content-type':'application/json','X-Dev-Tg-Id':account,'X-Debug-Now':String(T0),'X-Monster-Art-Revision':MONSTER_ART_REVISION},body:JSON.stringify({partyId:party.id,recipientCharId:recipient,selectedCharacterId:selected,tgId:a})}),env);
 const response=await call('87001',a,b);assert.equal(response.status,200);const result=await response.json();assert.equal(result.party.id,party.id);assert.equal(result.party.readonly,true);assert.equal(result.party.me.rewards.exp,123);assert.equal(result.party.me.rewards.items.star_ring_token,10);
 assert.equal((await env.DB.prepare('SELECT active_char_id FROM rpg_accounts WHERE account_tg_id=?').bind('87001').first()).active_char_id,b);
 await P.createCharacter(env,{tgId:'87002',name:'其他旅人',gender:'m',baseClass:'sword'},T0);
 assert.equal((await call('87002',a,'87002')).status,403);
 assert.equal((await call('87001',a,a)).status,409);
});
