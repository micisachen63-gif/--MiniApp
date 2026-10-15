// Additional immutable fixture proofs; no network, live player or bot calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {createCharacter} from '../src/services/player.js';
import {handle} from '../src/index.js';
import {insertSigil} from '../src/services/guardian-sigil.js';
import {activeSettings,QUALITY_ORDER} from '../src/game/guardian-sigil-config.js';
import {mulberry32} from '../src/game/rng.js';
const runtime=process.env.GUARDIAN_NOTIFY_COMPILED_URL?(await import(process.env.GUARDIAN_NOTIFY_COMPILED_URL)).default.fetch:handle;
async function api(env,path,body){const response=await runtime(new Request('https://offline.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Service-Secret':env.SERVICE_SECRET,'X-Debug-Now':String(T0)},body:JSON.stringify(body)}),env,{waitUntil(p){void Promise.resolve(p).catch(()=>{});}});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.message),{code:data.error});return data;}
async function fixture(){const db=freshDb();db.sqlite.exec('PRAGMA foreign_keys=ON');const env={DB:db,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true',SERVICE_SECRET:'offline-secret-value-0001'};for(const [tgId,name]of[['790','羽羽'],['791','星星']]){await createCharacter(env,{tgId,name,baseClass:'sword',gender:'m'},T0);await db.prepare('UPDATE rpg_characters SET level=50,gold=100000,last_settle_at=? WHERE tg_id=?').bind(T0,tgId).run();}return {db,env};}
async function seedMaterials(env,rank,type,bound=0){await env.DB.prepare("INSERT INTO rpg_guardian_operations VALUES('material','790','790','offline_material','summon',?,'test','{}','{}',?)").bind('a'.repeat(64),T0).run();const ids=Array.from({length:activeSettings(env).upgradeMaterials[rank-1]},(_,i)=>'material_'+i);for(const id of ids)await insertSigil(env.DB,{id,char_id:'790',type,quality:rank,bound,source_operation_id:'material',created_at:T0}).run();return ids;}
async function seeded(seed,fn){const original=crypto.getRandomValues;crypto.getRandomValues=array=>array instanceof Uint32Array&&array.length===1?(array[0]=seed,array):original.call(crypto,array);try{return await fn();}finally{crypto.getRandomValues=original;}}
test('all eight real ranks obey original announcement threshold and exact configuration ability precision',async()=>{
 for(let rank=1;rank<=8;rank++){
  const {db,env}=await fixture();env.GUARDIAN_SETTINGS=JSON.stringify({damageBonuses:activeSettings().damageBonuses.map((value,i)=>i===3?.075:value)});
  let result;
  if(rank===1){let seed=0;while(true){const rng=mulberry32(seed);rng();if(rng()<activeSettings(env).normalWeights[0]/1000000)break;seed++;}result=await seeded(seed,()=>api(env,'/rpg/guardian/summon',{tgId:'790',pool:'normal',count:1,requestId:'offline_rank_1'}));}
  else{const inputRank=rank-1,type=rank===7?'loot':'magic',ids=await seedMaterials(env,inputRank,type);let seed=0;while(mulberry32(seed)()>=activeSettings(env).upgradeSuccess[inputRank-1])seed++;result=await seeded(seed,()=>api(env,'/rpg/guardian/fuse',{tgId:'790',itemIds:ids,primaryId:ids[0],requestId:'offline_rank_'+rank}));}
  assert.equal(result.operation.results[0].rank,rank);const notices=(await api(env,'/rpg/outbox/claim',{limit:50})).items.filter(item=>item.kind==='guardian_sigil_obtained');assert.equal(notices.length,rank>=4?1:0);
  if(rank>=4){const item=notices[0].payload,expected=result.operation.results[0];assert.equal(item.rank,rank);assert.equal(item.quality,QUALITY_ORDER[rank-1]);assert.equal(item.share.item.rank,rank);assert.equal(item.share.item.bound,false);assert.equal(item.type,expected.type);assert.equal(item.ability,rank===7?'隨機掉寶率':'魔法傷害');assert.equal(item.damageBonus,rank===7?0:activeSettings(env).damageBonuses[rank-1]);assert.equal(item.lootBonus,rank===7?activeSettings(env).lootBonuses[rank-1]:0);assert.equal(item.count,1);}
 }
});
test('automatic achievement trade request accepts real sigil escrow and final swap exactly once; same-account request stays rejected',async()=>{
 const {db,env}=await fixture(),ids=await seedMaterials(env,3,'magic');const fused=await seeded(0,()=>api(env,'/rpg/guardian/fuse',{tgId:'790',itemIds:ids,primaryId:ids[0],requestId:'offline_true_trade'}));assert.equal(fused.operation.success,true);
 const notice=(await api(env,'/rpg/outbox/claim',{limit:50})).items.find(item=>item.kind==='guardian_sigil_obtained'),shareId=notice.payload.shareId,id=fused.operation.results[0].id;
 await assert.rejects(api(env,'/rpg/trade/request',{tgId:'790',shareId}),{code:'self'});
 const requested=await api(env,'/rpg/trade/request',{tgId:'791',shareId});const accepted=await api(env,'/rpg/trade/accept',{tgId:'790',reqId:requested.request.id}),tradeId=accepted.trade.id;assert.equal(accepted.trade.a.lines[0].kind,'sigil');assert.equal(accepted.trade.a.lines[0].ref,id);assert.equal(db.sqlite.prepare('SELECT trade_id FROM rpg_guardian_sigils WHERE id=?').get(id).trade_id,tradeId);
 for(const tgId of ['790','791'])await api(env,'/rpg/trade/lock',{tgId,tradeId});for(const tgId of ['790','791'])await api(env,'/rpg/trade/confirm',{tgId,tradeId});
 const guardian=db.sqlite.prepare('SELECT char_id,bound,active,locked,trade_id,exchange_id FROM rpg_guardian_sigils WHERE id=?').get(id);assert.equal(guardian.char_id,'791');assert.equal(guardian.bound,0);assert.equal(guardian.active,0);assert.equal(guardian.locked,0);assert.equal(guardian.trade_id,null);assert.equal(guardian.exchange_id,null);assert.equal(db.sqlite.prepare('SELECT status FROM rpg_shares WHERE id=?').get(shareId).status,'traded');assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE id=?').get(id).n,1);
});
