import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initialized, NOW } from './realm-test-helpers.js';
import { createCharacter } from '../src/services/player.js';
import { selectAccountCharacter } from '../src/accounts.js';
import { resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';
import * as Exchange from '../src/services/market-exchange.js';
import { seedLedgerQa } from '../tools/ledger-qa-fixture.mjs';
import { seedExchangeActionsQa, exchangeActionsQaState } from '../tools/exchange-actions-qa-fixture.mjs';

async function setup(t) {
  const env=await initialized(t);
  Object.assign(env,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true'});
  const permanent=scopeEnvForRealm(env,await resolveRealm(env,'permanent'));
  for(const [index,baseClass]of ['sword','archer','mage','thief'].entries())
    await createCharacter(permanent,{tgId:'90101',charSlot:index+1,name:'合成'+baseClass,baseClass,gender:'f'},NOW);
  await seedLedgerQa(env,NOW);
  const seed=await seedExchangeActionsQa(env,NOW);
  return {env,seed,permanent};
}
const amount=(state,id,item)=>state.inventory.find(row=>row.characterId===id&&row.item===item)?.quantity||0;
const balance=(state,id)=>state.characters.find(row=>row.characterId===id).gold;
const stableGear=row=>{const {tg_id,trade_id,is_equipped,...rest}=row;return rest;};

test('action fixture produces setup listings through original escrow and receipts in both independent realms',async t=>{
  const f=await setup(t),state=exchangeActionsQaState(f.env,f.seed);
  assert.equal(state.noDispatcher,true);assert.equal(state.realNotificationsSent,false);
  for(const [realmId,key]of [['permanent','permanent'],['season_2026_01','season']]){
    const manifest=f.seed.realms[realmId],raw=state[key];
    assert.equal(raw.acceptanceOperationCount,0);
    assert.equal(raw.setupOperationCount,manifest.setupOperations.length);
    assert.equal(raw.operations.length,manifest.setupRequestIds.length);
    for(const setup of manifest.setupOperations){
      const op=raw.operations.find(row=>row.requestId===setup.requestId);
      assert.equal(op.accountId,setup.accountId);assert.equal(op.characterId,setup.characterId);
      assert.equal(op.action,'create');assert.deepEqual(op.payload,setup.payload);
      assert.deepEqual(op.result,setup.result);
      const listing=raw.listings.find(row=>row.id===setup.listingId);
      assert.equal(listing.status,'active');assert.equal(listing.fee,Math.ceil(listing.price/20));
      if(listing.kind==='equip')assert.equal(raw.equipment.find(row=>row.id===listing.ref).trade_id,'exchange:'+listing.id);
      if(listing.kind==='guardian')assert.equal(raw.guardians.find(row=>row.id===listing.ref).exchange_id,listing.id);
      if(listing.kind==='item'&&setup.label==='buyStack')assert.equal(amount(raw,listing.seller_char,listing.ref),0);
      assert.equal(raw.exchangeLedger.filter(row=>row.event_id==='exchange:'+listing.id+':escrow').length,1);
    }
  }
  assert.deepEqual(exchangeActionsQaState(f.env,f.seed),state,'observation reads no writes or clock');
  await assert.rejects(seedExchangeActionsQa(f.env,NOW),/reseeding is forbidden/);
  assert.deepEqual(exchangeActionsQaState(f.env,f.seed),state,'reseed rejection preserves original setup');
});

test('sellable fixture has real kind:ref pagination and excludes bound, equipped, locked and escrow assets',async t=>{
  const f=await setup(t),manifest=f.seed.realms.permanent,before=exchangeActionsQaState(f.env,f.seed);
  const found=[],cursors=[];let cursor=null;
  do{
    const page=await Exchange.sellable(f.permanent,manifest.mainCharacterId,{cursor});
    found.push(...page.items);cursor=page.nextCursor;
    if(cursor){assert.match(cursor,/^(equip|guardian|item):.+$/);assert(!cursors.includes(cursor));cursors.push(cursor);}
  }while(cursor);
  assert(cursors.length>=1,'more than 30 real candidates require pagination');
  for(const id of manifest.assets.availableEquipment)assert(found.some(row=>row.kind==='equip'&&row.equipId===id));
  for(const id of [manifest.protected.boundEquipment,...manifest.protected.equipped])
    assert(!found.some(row=>row.equipId===id));
  for(const id of [manifest.protected.lockedGuardian,manifest.protected.boundGuardian])
    assert(!found.some(row=>row.guardianId===id));
  assert(!found.some(row=>row.item===manifest.protected.boundItem));
  assert.equal(found.find(row=>row.equipId===manifest.assets.createEquipment).enhance,7);
  assert.equal(found.find(row=>row.item===manifest.assets.fullStack.item).qty,17);
  assert(found.find(row=>row.guardianId===manifest.assets.createGuardian).guardian.damageBonus>0);
  assert.deepEqual(exchangeActionsQaState(f.env,f.seed).databases,before.databases);
});

test('setup buy targets transfer actual enhanced gear, whole stack and guardian with original fee conservation exactly once',async t=>{
  const f=await setup(t),manifest=f.seed.realms.permanent,actor=manifest.mainCharacterId;
  for(const name of ['buyEquipment','buyStack','buyGuardian']){
    const target=manifest.listingTargets[name],before=exchangeActionsQaState(f.env,f.seed),old=before.permanent;
    const body={characterId:actor,requestId:crypto.randomUUID(),listingId:target.listingId};
    const result=await Exchange.buy(f.permanent,actor,body,NOW);
    const after=exchangeActionsQaState(f.env,f.seed),raw=after.permanent;
    assert.equal(result.result.fee,target.fee);
    assert.equal(balance(raw,actor),balance(old,actor)-target.price);
    assert.equal(balance(raw,target.sellerCharacterId),balance(old,target.sellerCharacterId)+target.price-target.fee);
    assert.equal(raw.acceptanceOperationCount,old.acceptanceOperationCount+1);
    assert.equal(raw.listings.find(row=>row.id===target.listingId).status,'sold');
    if(target.kind==='equip'){
      const a=raw.equipment.find(row=>row.id===target.ref),b=old.equipment.find(row=>row.id===target.ref);
      assert.equal(a.tg_id,actor);assert.equal(a.trade_id,null);assert.equal(a.enhance_level,7);assert.deepEqual(stableGear(a),stableGear(b));
    }else if(target.kind==='item'){
      assert.equal(amount(raw,actor,target.ref),amount(old,actor,target.ref)+target.qty);
    }else{
      const row=raw.guardians.find(row=>row.id===target.ref);
      assert.equal(row.char_id,actor);assert.equal(row.exchange_id,null);assert.equal(row.quality,3);
    }
    assert.deepEqual(after.databases.season,before.databases.season);
    await Exchange.buy(f.permanent,actor,body,NOW);
    assert.deepEqual(exchangeActionsQaState(f.env,f.seed),after,'replay has no extra writes');
  }
});

test('setup owned listings cancel once and alternate-character assets return to the original owner',async t=>{
  const f=await setup(t),manifest=f.seed.realms.permanent,actor=manifest.mainCharacterId;
  for(const name of ['cancelStack','cancelAlternateEquipment']){
    const target=manifest.listingTargets[name],before=exchangeActionsQaState(f.env,f.seed),old=before.permanent;
    const body={characterId:actor,requestId:crypto.randomUUID(),listingId:target.listingId};
    const response=await Exchange.cancel(f.permanent,actor,body,NOW);
    const after=exchangeActionsQaState(f.env,f.seed),raw=after.permanent;
    assert.equal(response.result.returnedCharacterId,target.sellerCharacterId);
    assert.equal(response.result.fee,0);assert.equal(balance(raw,actor),balance(old,actor));
    assert.equal(balance(raw,target.sellerCharacterId),balance(old,target.sellerCharacterId));
    assert.equal(raw.listings.find(row=>row.id===target.listingId).status,'cancelled');
    if(target.kind==='item')assert.equal(amount(raw,target.sellerCharacterId,target.ref),amount(old,target.sellerCharacterId,target.ref)+target.qty);
    else{
      const row=raw.equipment.find(row=>row.id===target.ref);
      assert.equal(row.tg_id,manifest.alternateCharacterId);assert.equal(row.trade_id,null);assert.equal(row.enhance_level,6);
    }
    await Exchange.cancel(f.permanent,actor,body,NOW);
    assert.deepEqual(exchangeActionsQaState(f.env,f.seed),after);
  }
});

test('fixture refuses production or reused realm handles and modified seed identity',async t=>{
  const f=await setup(t),before=exchangeActionsQaState(f.env,f.seed);
  await assert.rejects(seedExchangeActionsQa({...f.env,ENVIRONMENT:'production'},NOW),/isolated development/);
  await assert.rejects(seedExchangeActionsQa({...f.env,DB_SEASON:f.env.DB},NOW),/isolated development/);
  assert.throws(()=>exchangeActionsQaState(f.env,{...f.seed,manifestSha256:'0'.repeat(64)}),/manifest changed/);
  assert.deepEqual(exchangeActionsQaState(f.env,f.seed),before);
});

test('action preview schedules no sweeps and permits only scoped actions plus pure reads',()=>{
 const input="import assert from 'node:assert/strict';\nimport http from 'node:http';\nimport { Readable } from 'node:stream';\nconst scheduled=[];globalThis.setInterval=(fn,delay)=>{scheduled.push(delay);return {unref(){}};};\nlet handler,clientRevision;\nhttp.createServer=fn=>{handler=fn;const server={on(){return server;},listen(port,host,callback){assert.equal(port,9872);assert.equal(host,'127.0.0.1');callback();return server;},closeAllConnections(){},close(callback){callback();}};return server;};\nprocess.argv=[process.execPath,'atlas-local-preview.mjs','--port=9872','--preview-origin=http://127.0.0.1:9873'];\nawait import('./worker/tools/atlas-local-preview.mjs');\nasync function request(url,method='GET',body=null,origin){\n return new Promise((resolve,reject)=>{\n  const req=Readable.from(body===null?[]:[JSON.stringify(body)]);\n  Object.assign(req,{url,method,headers:{'content-type':'application/json','x-dev-tg-id':'90101','x-realm-id':'permanent',...(clientRevision?{'x-monster-art-revision':clientRevision}:{}),...(origin?{origin}:{})}});\n  let status;const headers={};\n  const res={setHeader(key,value){headers[key.toLowerCase()]=value;},writeHead(code,values={}){status=code;for(const[key,value]of Object.entries(values))headers[key.toLowerCase()]=value;},end(value=''){resolve({status,headers,text:String(value)});}};\n  Promise.resolve(handler(req,res)).catch(reject);\n });\n}\nconst health=JSON.parse((await request('/__preview/health')).text);\nassert.equal(health.exchangeActionsQa,true);assert.equal(health.exchangeQa,false);\nassert.deepEqual(scheduled,[]);assert.deepEqual(health.exchangeActionsQaPolicy.backgroundTimersDisabled,{atlas:true,workshop:true,party:true});\nconst before=JSON.parse((await request('/__preview/exchange-actions-state')).text),manifest=before.seed.realms.permanent;\nfor(const action of ['exchange/create','exchange/buy','exchange/cancel','trade/open','trade/confirm','me','atlas/settle','chat/send','outbox/send']){\n const response=await request('/app/api/'+action,'POST',{},'http://127.0.0.1:9873');\n assert.equal(response.status,403,action);assert.equal(JSON.parse(response.text).error,'exchange_actions_preview_scoped_only');\n}\nconst metadata=JSON.parse((await request('/app/api/meta','POST',{})).text);clientRevision=metadata.meta.monsterArtRevision;assert(clientRevision);\nconst common={accountId:'90101',realmId:'permanent',selectedCharacterId:manifest.mainCharacterId,contextEpoch:0};\nconst query={...common,filters:{},cursor:null};\nfor(const action of ['exchange/sellable-scene','exchange/receipt','exchange/action-scoped']){\n const options=await request('/app/api/'+action,'OPTIONS',null,'http://127.0.0.1:9873');\n assert.equal(options.status,204,action);assert(options.headers['access-control-allow-headers'].includes('X-Monster-Art-Revision'));assert.equal(options.headers['access-control-allow-origin'],'http://127.0.0.1:9873');\n}\nconst page=await request('/app/api/exchange/sellable-scene','POST',query,'http://127.0.0.1:9873');\nassert.equal(page.status,200,page.text);assert.equal(JSON.parse(page.text).items.length,30);\nconst setup=manifest.setupOperations.find(row=>row.characterId===manifest.mainCharacterId);\nconst receipt=await request('/app/api/exchange/receipt','POST',{...common,kind:'create',...setup.body},'http://127.0.0.1:9873');\nassert.equal(receipt.status,200,receipt.text);assert.equal(JSON.parse(receipt.text).status,'committed');\nconst after=JSON.parse((await request('/__preview/exchange-actions-state')).text);\nassert.deepEqual(after,before,'pure reads and denied legacy paths leave both complete databases unchanged');\nconsole.log(JSON.stringify({test:'exchange-actions-preview-boundary',socketsOpened:0,timers:scheduled,deniedLegacyActions:9,pureScopes:2,setupNotAcceptance:true}));\nprocess.emit('SIGTERM');";
 const child=spawnSync(process.execPath,['--input-type=module','-'],{cwd:fileURLToPath(new URL('../..',import.meta.url)),
  input,encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,
   RPG_EXCHANGE_ACTIONS_QA:'1',RPG_EXCHANGE_QA:'0',RPG_LEDGER_QA:'1',RPG_SKILL_CAREER_QA:'1',
   RPG_PARTY_QA:'0',RPG_TOWER_QA:'0',RPG_BOSS_QA:'0',RPG_STAR_RING_QA:'0',RPG_GUARDIAN_QA:'0',RPG_FATE_QA:'0',RPG_FATE_PRIVATE_QA:'0'}});
 assert.equal(child.status,0,child.stdout+'\n'+child.stderr);assert.equal(child.signal,null);assert.equal(child.error,undefined);
 console.log(child.stdout.trim().split('\n').at(-1));
});
