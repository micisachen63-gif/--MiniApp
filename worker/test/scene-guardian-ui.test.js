import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scene-guardian-ui.js',import.meta.url),'utf8');
const style = fs.readFileSync(new URL('../public/scene-guardian-ui.css',import.meta.url),'utf8');
const social = fs.readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const drain = () => new Promise(resolve => setImmediate(resolve));
const NOW = 1793836800000;
const QUALITY = ['white','green','blue','purple','red','gold','pink','cyan'];
const TYPES = ['melee','ranged','magic','loot'];
const SCOPE = {accountId:'owner',realmId:'permanent',characterId:'actor'};
const CONFIG = 'guardian-approved-custom-v1';
function item(id,index = 0,extra = {}) { return {id,type:'magic',typeName:'天使・秘曜',quality:'white',rank:1,qualityName:'白色',bound:false,active:false,locked:false,inTrade:false,inExchange:false,revision:0,sellPrice:10,sellBlock:null,protection:{fuse:null,activate:null,unbind:'尚未綁定',lock:null,sale:null},createdAt:NOW - index,...extra}; }
function fixture({revision = 1,welcome = true,scope = {},items = [1,2,3,4].map(n => item('a-'+n)),phase = 'ACTIVE',enabled = true,level = 30} = {}) {
  const context = {...SCOPE,...scope};
  const stages = QUALITY.slice(0,7).map((from,i) => ({from,to:QUALITY[i+1],materials:i < 5 ? 4 : 6,refundOnFailure:1,successRate:.75,goldFee:321 + i,mixedTypes:i >= 3}));
  const config = {configVersion:CONFIG,enabled,status:'approved',types:TYPES.map(id => ({id,name:id,artUrl:'/art/guardian-sigil-20261013/'+id+'.webp'})),limits:{unlockLevel:15,dailyVouchers:4},rules:{upgradeStages:stages,unbindScrollCost:[2,3,4,5,6,7,8,9]},pools:{normal:{name:'普通召喚',allowedCounts:[1,5,10],singleGoldPrice:113,tenGoldPrice:999,rates:[{quality:'white',percent:76.5}]},featured:{name:'精選召喚',allowedCounts:[1,5,10],drawsPerVoucher:5,rates:[{quality:'green',percent:61.5}]}},assist:{stoneGold:1234,battlesPerStone:71}};
  const counts = Object.fromEntries(QUALITY.map((quality,i) => [quality,i === 0 ? 64 : 0]));
  const state = {schemaVersion:1,charId:context.characterId,level,unlocked:level >= 15,revision,balances:{gold:999999,voucherCount:4,remainder:4,availableDraws:24,freeNormalDraws:welcome ? 3 : 0,unbindScrolls:20},welcome:{claimed:welcome,granted:welcome ? 200 : 0,freeDraws:welcome ? 3 : 0,recipientCharId:welcome ? context.characterId : null,accountId:context.accountId,eligible:!welcome && level >= 15},daily:{granted:1,remaining:3},activeGuardian:null,assist:{itemId:null,remainingBattles:0,enabled:false,autoRenew:false,autoBuy:false,stoneCount:5,battlesPerStone:71,stoneGold:1234},inventory:{items,nextCursor:items.length ? items.at(-1).id : null,quality:'all',qualityCounts:counts,eligibleCounts:counts,totalCount:67}};
  const summon = {normal:[1,5,10].map(count => { const free = Math.min(count,state.balances.freeNormalDraws), paid = count-free; return {pool:'normal',count,expectedCosts:{gold:Math.floor(paid/10)*999+(paid%10)*113,vouchers:0,credits:0,freeNormalDraws:free},affordable:true,after:{freeNormalDraws:state.balances.freeNormalDraws-free}}; }),featured:[1,5,10].map(count => ({pool:'featured',count,expectedCosts:{gold:0,vouchers:Math.ceil(Math.max(0,count-4)/5),credits:count,freeNormalDraws:0},affordable:true,after:{voucherCount:4-Math.ceil(Math.max(0,count-4)/5),remainder:(4-count+10)%5,availableDraws:24-count}}))};
  return {ok:true,now:NOW,...context,revision,guardian:{config,state,shop:{characterId:context.characterId,revision,gold:999999,quality:'all',items,nextCursor:state.inventory.nextCursor},auto:{job:null,sourceCharacter:null,ownerAccountId:context.accountId,intervalMs:3000},history:{operations:[],receipts:[]},control:{realmPhase:phase,writable:phase === 'ACTIVE' && enabled && level >= 15,characterId:context.characterId,accountId:context.accountId,unlocked:level >= 15,welcomeRequired:!welcome,partyLocked:false},quotes:{summon,fuse:stages,assist:{stoneGold:1234,battlesPerStone:71,stoneCount:5,start:{expectedCosts:{gold:0,stones:1}},resume:{expectedCosts:{gold:0,stones:0}},buy:Array.from({length:10},(_,i) => ({quantity:i+1,expectedCosts:{gold:1234*(i+1),stones:0},affordable:true}))},unbind:[2,3,4,5,6,7,8,9],sale:[10,30,100,350,1000,3000,9000,27000]}}};
}
function harness(extra = {},options = {}) {
  let context = {...SCOPE,epoch:0,...options.context};
  const calls = [],states = [],changed = [],values = options.values || new Map();
  const storage = options.storage || {getItem:key => values.has(key) ? values.get(key) : null,setItem:(key,value) => values.set(key,String(value)),removeItem:key => values.delete(key)};
  const sandbox = {AbortController,URL,console,...extra};
  vm.runInNewContext(source,sandbox,{filename:'scene-guardian-ui.js'});
  const host = {getContext:() => context,current:() => true,storage,actor:{name:'目前角色',level:30},draft:{},onState:state => states.push(plain(state)),onChanged:(value,operation) => changed.push({value:plain(value),operation:plain(operation)}),
    request:(action,body,options) => new Promise((resolve,reject) => calls.push({action,body:plain(body),options,resolve,reject}))};
  return {api:sandbox.RpgSceneGuardian,host,calls,states,changed,values,storage,create() { return sandbox.RpgSceneGuardian.createClient(host); },setContext(next) { context = {...context,...next}; },getContext:() => context};
}
async function read(h,c,value = fixture(),query) { const task = c.refresh(query); assert.equal(h.calls.at(-1).action,'guardian/scene'); h.calls.at(-1).resolve(value); assert.equal(await task,true,c.state.error); }
async function lose(h,c,prepare = () => c.prepareSummon('normal',5),error = Error('lost reply')) {
  assert.equal(prepare(),true,c.state.error); const task = c.submit(); assert.equal(h.calls.at(-1).action,'guardian/action-scoped'); h.calls.at(-1).reject(error); assert.equal(await task,false); return plain(c.pending());
}
function job(extra = {}) { return {id:'original-job-id',characterId:'actor',pool:'normal',count:5,targetType:'any',targetRank:1,maxGold:0,status:'running',reason:null,matchId:null,batches:0,totalDraws:0,spentGold:0,spentVouchers:0,usedFree:0,counts:Array(8).fill(0),nextAt:NOW+3000,updatedAt:NOW,seen:false,...extra}; }
function result(record,overrides = {}) {
  const body = record.body;
  if (record.kind === 'welcome') return {welcome:{accountId:'owner',recipientCharacterId:'actor',draws:200,createdAt:NOW},...overrides};
  if (record.kind === 'sale') return {sale:{count:body.itemIds.length,gold:body.expectedGold,items:body.itemIds.map(id => ({id,type:'magic',quality:'white',gold:10}))},...overrides};
  if (record.kind.startsWith('auto-')) return {job:job(record.kind === 'auto-start' ? {...body} : {id:body.jobId,status:'ended',seen:record.kind === 'auto-seen'}),...overrides};
  const operation = {operationId:'operation-'+record.id,requestId:'scene:app:'+record.id,charId:'actor',action:record.kind,status:'committed',configVersion:body.configVersion,consumed:{gold:0,vouchers:0,credits:0,...body.expectedCosts},results:[],createdAt:NOW};
  if (record.kind === 'summon') Object.assign(operation,{pool:body.pool,count:body.count,results:Array.from({length:body.count},(_,i) => item('draw-'+record.id+'-'+i))});
  if (record.kind === 'fuse') Object.assign(operation,{success:false,primaryId:body.primaryId,refundedId:body.primaryId,consumedIds:body.itemIds.filter(id => id !== body.primaryId),results:[item(body.primaryId,0,{bound:true})]});
  if (record.kind === 'activate' && body.itemId !== null) operation.results = [item(body.itemId,0,{bound:true,active:true})];
  if (record.kind === 'unbind') Object.assign(operation,{usedUnbindScrolls:body.expectedCosts.unbind,results:[item(body.itemId)]});
  if (record.kind === 'assist') Object.assign(operation,{mode:body.mode,resumed:body.mode === 'start' && body.expectedCosts.stones === 0,guardianAssist:{itemId:body.itemId,remainingBattles:71,autoRenew:body.autoRenew}});
  return {operation,...overrides};
}
function receipt(record,{found = true,recoveryAllowed = false,revision = 1,context = {},result:original, ...extra} = {}) {
  return {ok:true,now:NOW,...SCOPE,...context,revision,kind:record.kind,requestId:record.id,signature:record.signature,found,recoveryAllowed,result:found ? original || result(record) : null,receipt:found ? {version:1,kind:record.kind,requestId:record.id,requestKey:'scene:app:'+record.id,signature:record.signature,scope:{...SCOPE,...context},createdAt:NOW,costs:plain(record.kind === 'sale' ? {sigils:record.body.itemIds.length} : record.body.expectedCosts || {}),authority:{type:record.kind}} : null,...extra};
}
async function check(h,c,record,value = receipt(record),snapshot = fixture()) {
  const task = c.checkPending(record.id); h.calls.at(-1).resolve(snapshot); await drain(); assert.equal(h.calls.at(-1).action,'guardian/receipt'); h.calls.at(-1).resolve(value); return task;
}

test('first open, refresh, and frozen/locked projections read only and never claim welcome',async t => {
  for (const options of [{welcome:false},{welcome:false,phase:'FROZEN'},{welcome:false,level:14}]) await t.test(JSON.stringify(options),async() => {
    const h = harness(), c = h.create(); await read(h,c,fixture(options)); await read(h,c,fixture(options));
    assert.equal(c.prepareSummon('normal',1),false); assert.equal(c.prepareAutoStart({pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold:0}),false);
    if (options.phase || options.level) assert.equal(c.prepareWelcome(),false); else { assert.equal(c.prepareWelcome(),true); c.cancel(); }
    assert.ok(h.calls.every(call => call.action === 'guardian/scene')); c.dispose();
  });
});
test('canonical values keep explicit false/null/zero, reject absent/coerced values and sort only item IDs',() => {
  const h = harness(), api = h.api;
  assert.equal(api.signature('activate',{configVersion:CONFIG,itemId:null}),JSON.stringify({kind:'activate',configVersion:CONFIG,itemId:null}));
  assert.equal(api.canonical('activate',{configVersion:CONFIG}),null);
  assert.equal(api.canonical('lock',{configVersion:CONFIG,itemId:'a-1',locked:null}),null);
  assert.equal(api.signature('lock',{locked:false,itemId:'a-1',configVersion:CONFIG}),JSON.stringify({kind:'lock',configVersion:CONFIG,itemId:'a-1',locked:false}));
  for (const maxGold of [null,0]) assert.equal(api.canonical('auto-start',{configVersion:CONFIG,pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold}).maxGold,maxGold);
  for (const maxGold of ['',undefined,false,'0',-1]) assert.equal(api.canonical('auto-start',{configVersion:CONFIG,pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold}),null);
  const fuse = plain(api.canonical('fuse',{configVersion:CONFIG,itemIds:['d','b','a','c'],primaryId:'c',expectedCosts:{gold:321}}));
  assert.deepEqual(fuse.itemIds,['a','b','c','d']); assert.equal(fuse.primaryId,'c');
  assert.equal(api.canonical('summon',{configVersion:CONFIG,pool:'normal',count:1,expectedCosts:{gold:0,vouchers:0,credits:0}}),null);
  assert.equal(api.canonical('welcome',{configVersion:CONFIG,namespace:'service'}),null);
  assert.equal(api.canonical('lock',{configVersion:CONFIG,itemId:'a'.repeat(129),locked:false}),null);
  assert.equal(api.canonical('lock',{configVersion:CONFIG,itemId:'a\n',locked:false}),null);
  assert.equal(api.canonical('sale',{configVersion:CONFIG,characterId:'actor',itemIds:['a'.repeat(65)],expectedGold:10}),null);
  assert.equal(api.canonical('welcome',{configVersion:'v'.repeat(129)}),null);
});
test('server quotes preserve custom prices, normal free draws and featured voucher/remainder costs',async() => {
  const h = harness(), c = h.create(); await read(h,c);
  assert.equal(c.prepareSummon('normal',10),true); assert.deepEqual(plain(c.state.confirm.body.expectedCosts),{gold:791,vouchers:0,credits:0,freeNormalDraws:3}); c.cancel();
  assert.equal(c.prepareSummon('featured',5),true); assert.deepEqual(plain(c.state.confirm.body.expectedCosts),{gold:0,vouchers:1,credits:5,freeNormalDraws:0}); c.cancel();
  const unaffordable = fixture(); unaffordable.guardian.quotes.summon.featured[0].affordable = false; await read(h,c,unaffordable);
  assert.equal(c.prepareSummon('featured',1),false); assert.equal(h.calls.some(call => call.action === 'guardian/action-scoped'),false); c.dispose();
});
test('fusion includes explicit primary across ID cursor pages and consumes exact configured fee',async() => {
  const h = harness(), c = h.create(); await read(h,c,fixture({items:[item('a-1'),item('a-2')]}),{quality:'white',cursor:null});
  const next = fixture({items:[item('b-1'),item('b-2')]}); next.guardian.state.inventory.quality = 'white'; await read(h,c,next,{quality:'white',cursor:'a-2'});
  assert.equal(c.prepareFuse('a-2',['b-2','a-2','a-1','b-1']),true,c.state.error); assert.deepEqual(plain(c.state.confirm.body),{configVersion:CONFIG,itemIds:['a-1','a-2','b-1','b-2'],primaryId:'a-2',expectedCosts:{gold:321}}); assert.match(c.state.confirm.details,/75%/); c.cancel();
  assert.equal(c.prepareSale(['a-1','b-1']),true,c.state.error); assert.equal(c.state.confirm.body.expectedGold,20); c.cancel();
  await read(h,c,fixture({revision:2,items:[item('b-1'),item('b-2')]})); assert.equal(c.prepareFuse('a-2',['a-1','a-2','b-1','b-2']),false); c.dispose();
});
test('assist resume, stop, continuation false, supply false and custom stone quotes remain explicit',async() => {
  const h = harness(), c = h.create(), value = fixture(); value.guardian.state.assist = {...value.guardian.state.assist,itemId:'a-1',remainingBattles:27,enabled:false,autoRenew:true,autoBuy:true}; await read(h,c,value);
  assert.equal(c.prepareAssist('start',{itemId:'a-1'}),true); assert.deepEqual(plain(c.state.confirm.body.expectedCosts),{gold:0,stones:0}); assert.match(c.state.confirm.details,/27 場保留次數/); c.cancel();
  assert.equal(c.prepareAssist('start',{itemId:'a-2'}),true); assert.deepEqual(plain(c.state.confirm.body.expectedCosts),{gold:0,stones:1}); c.cancel();
  assert.equal(c.prepareAssist('continuation',{autoRenew:false}),true); assert.equal(c.state.confirm.body.autoRenew,false); c.cancel();
  assert.equal(c.prepareAssist('supply',{autoBuy:false}),true); assert.equal(c.state.confirm.body.autoBuy,false); c.cancel();
  assert.equal(c.prepareAssist('buy',{quantity:3}),true); assert.deepEqual(plain(c.state.confirm.body.expectedCosts),{gold:3702,stones:0}); c.cancel();
  assert.equal(c.prepareAssist('stop'),true); assert.match(c.state.confirm.details,/保留剩餘 27 場/); c.dispose();
});
test('account job source stays distinct; explicit stop and seen work with config disabled in active realm',async() => {
  const h = harness(), c = h.create(), value = fixture({enabled:false}); value.guardian.auto = {job:job({characterId:'other-owned'}),sourceCharacter:{id:'other-owned',name:'另一角色'},ownerAccountId:'owner'}; await read(h,c,value);
  assert.equal(c.prepareAutoStop(),true,c.state.error); assert.deepEqual(plain(c.state.confirm.body),{jobId:'original-job-id'}); assert.match(c.state.confirm.details,/來源角色 other-owned/); c.cancel(); assert.equal(c.prepareWelcome(),false);
  value.guardian.auto.job.status = 'ended'; await read(h,c,value); assert.equal(c.prepareAutoSeen(),true,c.state.error); c.cancel();
  value.guardian.control.realmPhase = 'FROZEN'; await read(h,c,value); assert.equal(c.prepareAutoSeen(),false); c.dispose();
});
test('write requires storage set/readback and corrupt pending blocks without silent deletion',async t => {
  for (const kind of ['throw','mismatch','corrupt','unavailable']) await t.test(kind,async() => {
    const values = new Map(), base = {getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value),removeItem:key => values.delete(key)};
    const storage = kind === 'throw' ? {...base,setItem() { throw Error('quota'); }} : kind === 'mismatch' ? {...base,setItem() {}} : kind === 'unavailable' ? {} : base;
    if (kind === 'corrupt') values.set('rpg-sg-pending:'+JSON.stringify(['owner','permanent','actor']),'{broken');
    const h = harness({}, {storage,values}), c = h.create(); await read(h,c);
    if (['corrupt','unavailable'].includes(kind)) assert.equal(c.prepareSummon('normal',1),false); else { assert.equal(c.prepareSummon('normal',1),true); assert.equal(await c.submit(),false); }
    assert.equal(h.calls.length,1); if (kind === 'corrupt') assert.equal([...values.values()][0],'{broken'); c.dispose();
  });
});
test('cached pending never overwrites damaged storage when revealed or deletes it when a verified receipt is acknowledged',async t => {
  for (const corrupted of ['{broken JSON',JSON.stringify({version:1,id:'damaged-record',body:{}})]) await t.test(corrupted,async() => {
    const values = new Map(),writes = [],storage = {getItem:key => values.get(key) ?? null,setItem:(key,value) => { writes.push(['set',key,value]); values.set(key,value); },removeItem:key => { writes.push(['remove',key]); values.delete(key); }};
    const h = harness({}, {values,storage}), c = h.create(); await read(h,c); const record = await lose(h,c);
    assert.equal(await check(h,c,record),true); assert.equal(c.state.receipt.found,true); assert.equal(c.markRevealed(record.id),true);
    const storageKey = [...values.keys()][0]; values.set(storageKey,corrupted); const count = writes.length;
    assert.equal(c.pending().id,record.id,'cached original remains visible for investigation'); assert.ok(c.state.storageError);
    assert.equal(c.markRevealed(record.id),false); assert.equal(c.acknowledge(record.id),false);
    assert.equal(values.get(storageKey),corrupted,'damaged bytes remain exactly preserved'); assert.equal(writes.length,count,'neither setItem nor removeItem can use a fallback cache'); assert.equal(c.state.lastResult,null); assert.equal(h.changed.length,0);
    values.set(storageKey,JSON.stringify(record)); assert.equal(c.acknowledge(record.id),true,'acknowledgement is allowed only after the same canonical pending is readable again'); assert.equal(c.pending(),null); c.dispose();
  });
});
test('cached unrevealed pending cannot replace a corrupt blob on markRevealed',async() => {
  const h = harness(), c = h.create(); await read(h,c); const record = await lose(h,c), storageKey = [...h.values.keys()][0], damaged = '["not a pending record"]';
  assert.equal(record.revealed,undefined); h.values.set(storageKey,damaged); assert.equal(c.markRevealed(record.id),false); assert.equal(h.values.get(storageKey),damaged); assert.equal(c.pending().id,record.id); assert.ok(c.state.storageError); c.dispose();
});
test('late committed response keeps damaged storage; same ID with another valid canonical body cannot be cleared',async t => {
  for (const damaged of [true,false]) await t.test(damaged ? 'damaged bytes' : 'different canonical body',async() => {
    const h = harness(), c = h.create(); await read(h,c); assert.equal(c.prepareSummon('normal',1),true); const task = c.submit(), call = h.calls.at(-1), record = plain(c.pending()), storageKey = [...h.values.keys()][0];
    let replacement = '{damaged during request';
    if (!damaged) { const next = plain(record); next.body = {...next.body,count:5,expectedCosts:{gold:226,vouchers:0,credits:0,freeNormalDraws:3}}; next.wireBody = {kind:next.kind,...next.body,realmId:'permanent',selectedCharacterId:'actor'}; next.signature = h.api.signature(next.kind,next.body); replacement = JSON.stringify(next); }
    h.values.set(storageKey,replacement); call.resolve(receipt(record)); await drain();
    if (damaged) { assert.equal(h.calls.at(-1).action,'guardian/scene'); h.calls.at(-1).resolve(fixture()); }
    assert.equal(await task,damaged); assert.equal(h.values.get(storageKey),replacement); assert.equal(c.acknowledge(record.id),false); assert.equal(h.values.get(storageKey),replacement); assert.equal(h.calls.filter(value => value.action === 'guardian/action-scoped').length,1); c.dispose();
  });
});
test('welcome recovery accepts the original same-account recipient after another owned character claimed first',async() => {
  const h = harness(), c = h.create(); await read(h,c,fixture({welcome:false})); const record = await lose(h,c,() => c.prepareWelcome());
  const snapshot = fixture(); snapshot.guardian.state.welcome.recipientCharId = 'other-owned'; snapshot.guardian.state.balances.freeNormalDraws = 0;
  const originalGift = {welcome:{accountId:'owner',recipientCharacterId:'other-owned',draws:200,createdAt:NOW - 60000}};
  assert.equal(await check(h,c,record,receipt(record,{found:false,recoveryAllowed:true}),snapshot),true); assert.equal(c.prepareRecovery(record.id),true,c.state.error);
  const task = c.submit(), call = h.calls.at(-1); assert.deepEqual(call.body,record.wireBody); call.reject(Error('lost original account receipt again')); assert.equal(await task,false);
  assert.equal(await check(h,c,record,receipt(record,{result:originalGift}),snapshot),true,c.state.error); assert.equal(c.acknowledge(record.id),true,c.state.error); assert.deepEqual(plain(c.state.lastResult.result),originalGift); assert.equal(c.pending(),null); assert.equal(c.state.data.guardian.state.balances.freeNormalDraws,0); c.dispose();
});
test('welcome still rejects another account, missing recipient or altered original entitlement',async t => {
  for (const welcome of [{accountId:'wrong-owner',recipientCharacterId:'other-owned',draws:200,createdAt:NOW},{accountId:'owner',recipientCharacterId:null,draws:200,createdAt:NOW},{accountId:'owner',recipientCharacterId:'other-owned',draws:201,createdAt:NOW}]) await t.test(JSON.stringify(welcome),async() => {
    const h = harness(), c = h.create(); await read(h,c,fixture({welcome:false})); const record = await lose(h,c,() => c.prepareWelcome());
    assert.equal(await check(h,c,record,receipt(record,{result:{welcome}})),false); assert.equal(c.acknowledge(record.id),false); assert.equal(c.pending().id,record.id); c.dispose();
  });
});
test('unknown retains complete original ID, scope, JSON wire body, quotes and signature across refresh/reload',async() => {
  const h = harness(), c = h.create(); await read(h,c); const record = await lose(h,c);
  assert.deepEqual(record.context,SCOPE); assert.deepEqual(record.wireBody,{kind:record.kind,...record.body,realmId:'permanent',selectedCharacterId:'actor'}); assert.equal(record.signature,h.api.signature(record.kind,record.body));
  assert.deepEqual(h.calls.at(-1).body,record.wireBody); await read(h,c); assert.deepEqual(plain(c.pending()),record); c.dispose();
  const reopened = harness({}, {values:h.values}), next = reopened.create(); await read(reopened,next); assert.deepEqual(plain(next.pending()),record); assert.equal(next.prepareSummon('normal',1),false); assert.equal(reopened.calls.length,1); next.dispose();
});
test('not_found never clears or automatically retries; explicit recovery preserves the full original body',async() => {
  const h = harness(), c = h.create(); await read(h,c); const record = await lose(h,c);
  assert.equal(await check(h,c,record,receipt(record,{found:false,recoveryAllowed:true})),true); assert.deepEqual(plain(c.pending()),record); assert.equal(h.calls.filter(call => call.action === 'guardian/action-scoped').length,1);
  assert.equal(c.prepareRecovery(record.id),true); c.cancel(); assert.equal(h.calls.filter(call => call.action === 'guardian/action-scoped').length,1);
  assert.equal(c.prepareRecovery(record.id),true); const task = c.submit(); assert.deepEqual(h.calls.at(-1).body,record.wireBody); h.calls.at(-1).resolve(receipt(record)); await drain(); h.calls.at(-1).resolve(fixture()); assert.equal(await task,true,c.state.error); assert.equal(c.pending(),null); c.dispose();
});
test('typed original summon, fusion, activation, lock, unbind, assist, sale, welcome and auto results are accepted',async t => {
  const cases = [
    ['welcome',(c) => c.prepareWelcome(),fixture({welcome:false})],
    ['summon',c => c.prepareSummon('normal',5)],
    ['fuse',c => c.prepareFuse('a-2',['a-1','a-2','a-3','a-4'])],
    ['activate',c => c.prepareActivate(null)],['lock',c => c.prepareLock('a-1',false)],
    ['unbind',c => c.prepareUnbind('a-1'),fixture({items:[item('a-1',0,{bound:true,protection:{unbind:null}})]})],
    ['assist',c => c.prepareAssist('buy',{quantity:2})],['sale',c => c.prepareSale(['a-1','a-2'])],
    ['auto-start',c => c.prepareAutoStart({pool:'normal',count:5,targetType:'any',targetRank:1,maxGold:0})],
    ['auto-stop',c => c.prepareAutoStop()],['auto-seen',c => c.prepareAutoSeen()]
  ];
  for (const [kind,prepare,snapshot = fixture()] of cases) await t.test(kind,async() => {
    if (kind === 'auto-stop' || kind === 'auto-seen') snapshot.guardian.auto.job = job({status:kind === 'auto-seen' ? 'ended' : 'running'});
    const h = harness(), c = h.create(); await read(h,c,snapshot); const record = await lose(h,c,() => prepare(c));
    assert.equal(await check(h,c,record,receipt(record),snapshot),true,c.state.error); assert.equal(c.acknowledge(record.id),true,c.state.error); assert.equal(c.pending(),null); assert.deepEqual(plain(c.state.lastResult.result),result(record)); assert.equal(h.changed.length,1); c.dispose();
  });
});
test('partial, wrong-cost, wrong-scope and corrupted original receipts keep pending untouched',async t => {
  for (const corrupt of ['signature','scope','costs','rawKey','originalId','count','missingReceipt','missingResults']) await t.test(corrupt,async() => {
    const h = harness(), c = h.create(); await read(h,c); const record = await lose(h,c); const value = receipt(record);
    if (corrupt === 'signature') value.signature += ' ';
    if (corrupt === 'scope') value.receipt.scope.realmId = 'season';
    if (corrupt === 'costs') value.receipt.costs.gold++;
    if (corrupt === 'rawKey') value.receipt.requestKey = 'scene:app:other_id';
    if (corrupt === 'originalId') value.result.operation.charId = 'other-owned';
    if (corrupt === 'count') value.result.operation.count = 1;
    if (corrupt === 'missingReceipt') value.receipt = null;
    if (corrupt === 'missingResults') value.result.operation.results = [];
    assert.equal(await check(h,c,record,value),false); assert.equal(c.acknowledge(record.id),false); assert.deepEqual(plain(c.pending()),record); assert.equal(h.changed.length,0); c.dispose();
  });
});
test('revision floor, config changes and pending receipt refresh invalidate stale confirmations',async() => {
  const h = harness(), c = h.create(); await read(h,c); assert.equal(c.prepareSummon('normal',1),true);
  const next = fixture({revision:2}); next.guardian.config.configVersion = 'updated'; await read(h,c,next); assert.equal(c.state.confirm,null); assert.equal(await c.submit(),false);
  const pending = c.refresh(); h.calls.at(-1).resolve(fixture({revision:1})); assert.equal(await pending,false); assert.equal(c.state.revision,2); c.dispose();
});
test('A/B/A late success and 409 cannot repaint, clear a later pending, trigger changed, or lower the revision floor',async t => {
  for (const reply of ['200','409']) await t.test(reply,async() => {
    const h = harness(), c = h.create(); await read(h,c); assert.equal(c.prepareSummon('normal',1),true); const task = c.submit(), firstCall = h.calls.at(-1), original = plain(c.pending()), before = h.states.length;
    h.setContext({characterId:'other',epoch:1}); h.setContext({characterId:'actor',epoch:2});
    const current = h.create(); await read(h,current,fixture({revision:12})); assert.deepEqual(plain(current.pending()),original);
    const later = {...original,id:'later_request_123',body:{...original.body,requestId:'later_request_123'}}; later.wireBody = {...original.wireBody,requestId:later.id}; h.values.set([...h.values.keys()][0],JSON.stringify(later));
    if (reply === '200') firstCall.resolve(receipt(original,{revision:13})); else firstCall.reject(Object.assign(Error('late conflict'),{status:409,code:'guardian_request_reused'}));
    assert.equal(await task,false); assert.equal(current.pending().id,later.id); assert.equal(current.state.revision,12); assert.equal(h.changed.length,0); assert.equal(h.states.length,before+2); c.dispose(); current.dispose();
  });
});
test('A/B/A late receipt is ignored and a missing receipt with recovery disabled never allows replay',async() => {
  const h = harness(), c = h.create(); await read(h,c); const record = await lose(h,c);
  const task = c.checkPending(record.id); h.calls.at(-1).resolve(fixture()); await drain(); const late = h.calls.at(-1), before = h.states.length;
  h.setContext({characterId:'other',epoch:1}); h.setContext({characterId:'actor',epoch:2}); late.resolve(receipt(record)); assert.equal(await task,false); assert.equal(h.states.length,before); assert.equal(c.state.receipt,null);
  const next = h.create(); await read(h,next); assert.equal(await check(h,next,record,receipt(record,{found:false,recoveryAllowed:false})),true); assert.equal(next.prepareRecovery(record.id),false); assert.equal(next.pending().id,record.id); c.dispose(); next.dispose();
});
test('explicit history receipt reads use the original canonical body without creating, clearing, retrying or marking pending',async() => {
  const h = harness(), c = h.create(); await read(h,c); const pending = await lose(h,c);
  const historical = {...pending,id:'sg_historical_original_1',body:{...pending.body,requestId:'sg_historical_original_1'}}, snapshot = fixture();
  snapshot.guardian.history.receipts = [{kind:historical.kind,requestKey:'scene:app:'+historical.id,signature:historical.signature,scope:SCOPE,createdAt:NOW,costs:historical.body.expectedCosts}];
  await read(h,c,snapshot); const task = c.readHistoryReceipt('scene:app:'+historical.id);
  assert.equal(h.calls.at(-1).action,'guardian/receipt'); assert.deepEqual(h.calls.at(-1).body,{kind:historical.kind,...historical.body,realmId:'permanent',selectedCharacterId:'actor'});
  h.calls.at(-1).resolve(receipt(historical)); assert.equal(await task,true,c.state.error); assert.equal(c.state.historyReceipt.id,historical.id); assert.deepEqual(plain(c.pending()),pending); assert.equal(h.changed.length,0); assert.equal(h.calls.filter(value => value.action === 'guardian/action-scoped').length,1); c.dispose();
});
test('history receipt requires same context, app namespace and exact canonical signature, with late ABA rejected',async() => {
  const h = harness(), c = h.create(); await read(h,c); const record = await lose(h,c), snapshot = fixture();
  snapshot.guardian.history.receipts = [{kind:record.kind,requestKey:'scene:app:'+record.id,signature:record.signature,scope:SCOPE,createdAt:NOW,costs:record.body.expectedCosts}];
  await read(h,c,snapshot); assert.equal(await c.readHistoryReceipt('scene:service:'+record.id),false);
  const task = c.readHistoryReceipt('scene:app:'+record.id), call = h.calls.at(-1), count = h.states.length;
  h.setContext({characterId:'other',epoch:1}); h.setContext({characterId:'actor',epoch:2}); call.resolve(receipt(record)); assert.equal(await task,false); assert.equal(c.state.historyReceipt,null); assert.equal(h.states.length,count); c.dispose();
});

class GuardianRoot {
  constructor() {
    this.isConnected = true; this.scrollTop = 0; this.reveals = 0; this.focuses = []; this.controls = []; this.panels = []; this.events = new Map(); this.html = ''; this.visibility = new Map();
    this.ownerDocument = {body:{kind:'body'},hidden:false,baseURI:'http://127.0.0.1/scene/',head:{append() {}},createElement() { return {}; },addEventListener:(name,fn) => this.visibility.set(name,fn),removeEventListener:name => this.visibility.delete(name)}; this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  contains(node) { return node?.root === this && this.controls.includes(node); }
  addEventListener(name,fn) { this.events.set(name,fn); } removeEventListener(name) { this.events.delete(name); }
  get innerHTML() { return this.html; }
  set innerHTML(html) {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.html = html; this.controls = []; this.panels = [];
    for (const match of html.matchAll(/<section[^>]*data-sg-pending="([^"]+)"[^>]*>/g)) this.panels.push({id:match[1],start:match.index,end:html.indexOf('</section>',match.index),scrollIntoView:() => { this.reveals++; this.scrollTop = 0; }});
    for (const match of html.matchAll(/<(button|input|select)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)) {
      const attributes = match[2],dataset = {}; for (const attribute of attributes.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g)) dataset[attribute[1].replace(/-([a-z])/g,(_,value) => value.toUpperCase())] = attribute[2];
      const root = this,panel = this.panels.find(value => match.index > value.start && match.index < value.end);
      this.controls.push({root,dataset,tagName:match[1].toUpperCase(),value:attributes.match(/value="([^"]*)"/)?.[1] || '',disabled:/(?:^|\s)disabled(?:\s|$)/.test(attributes),selectionStart:null,selectionEnd:null,setAttribute() {},setSelectionRange(start,end) { this.selectionStart = start; this.selectionEnd = end; },
        closest(selector) { return selector === '[data-sg-action]' ? this : selector === '[data-sg-pending]' ? panel : null; },
        focus() { if (!this.disabled) { root.ownerDocument.activeElement = this; root.focuses.push({...dataset}); } }});
    }
  }
  querySelectorAll(selector) { if (selector === 'button, input, select') return this.controls; const action = selector.match(/^\[data-sg-action="([^"]+)"\]$/)?.[1]; return action ? this.controls.filter(control => control.dataset.sgAction === action) : []; }
  querySelector(selector) { if (selector === '[data-sg-confirm]') return this.html.includes('data-sg-confirm') ? {scrollIntoView() {}} : null; return this.querySelectorAll(selector)[0] || null; }
  button(action,fields = {}) { return this.controls.find(control => control.dataset.sgAction === action && Object.entries(fields).every(([field,value]) => control.dataset[field] === String(value))); }
  field(name) { return this.controls.find(control => control.dataset.sgField === name); }
  async click(action,fields = {}) { const target = this.button(action,fields); assert.ok(target,'missing control '+action); if (!target.disabled) target.focus(); return this.events.get('click')?.({target}); }
  async change(field,value) { const target = this.field(field); assert.ok(target,'missing field '+field); target.value = String(value); target.focus(); return this.events.get('change')?.({target}); }
}
async function mountHarness(data = fixture(),options = {},params = {}) {
  const frames = new Map(),intervals = new Map(); let next = 0;
  const h = harness({requestAnimationFrame(fn) { const id = ++next; frames.set(id,{fn,cancelled:false}); return id; },cancelAnimationFrame(id) { if (frames.has(id)) frames.get(id).cancelled = true; },setInterval(fn) { const id = ++next; intervals.set(id,fn); return id; },clearInterval(id) { intervals.delete(id); }},options);
  const root = new GuardianRoot(),view = h.api.mount(root,h.host,params); h.calls.at(-1).resolve(data); await drain();
  return {h,root,view,frames,intervals,flush(ignoreCancel = false) { const batch = [...frames.values()]; frames.clear(); for (const frame of batch) if (ignoreCancel || !frame.cancelled) frame.fn(); }};
}
async function loseSummon(m) { await m.root.click('tab',{sgTab:'summon'}); await m.root.click('summon',{pool:'normal',count:1}); const task = m.root.click('confirm'); m.h.calls.at(-1).reject(Error('reply lost')); await task; return JSON.parse([...m.h.values.values()][0]); }
test('single host routes, responsive transparent metal, and touch targets retain the original guardian art',() => {
  assert.match(social,/guardian:\{title:'守護天使',group:'character'\}/); assert.match(social,/'guardian-summon':\{title:'天使召喚與補給',group:'camp'\}/); assert.match(social,/loadSceneModule\('scene-guardian-ui','RpgSceneGuardian'\)/);
  assert.match(style,/min-height:44px/); assert.match(style,/@media\(max-width:600px\)/); assert.match(style,/@media\(max-width:360px\)/); assert.match(style,/prefers-reduced-motion/); assert.doesNotMatch(source,/guardian\/(?:inventory|auto\/step|share)'/);
});
test('Cancel is default and Back returns to exact trigger; opening and cancelling never write',async() => {
  const m = await mountHarness(fixture({welcome:false})); assert.equal(m.h.calls.length,1); await m.root.click('welcome'); assert.equal(m.root.ownerDocument.activeElement.dataset.sgAction,'cancel'); assert.equal(m.view.handleBack(),true); assert.equal(m.root.ownerDocument.activeElement.dataset.sgAction,'welcome');
  await m.root.click('welcome'); await m.root.click('cancel'); assert.equal(m.root.ownerDocument.activeElement.dataset.sgAction,'welcome'); assert.equal(m.h.calls.length,1); m.view.dispose();
});
test('inventory shows whole eligible counts, exact IDs, protection and original assets; fusion shows 75 percent',async() => {
  const m = await mountHarness(fixture(),{}, {tab:'inventory'}); assert.match(m.root.html,/整個背包共 67 件/); assert.match(m.root.html,/白色 · 可融合 64/); assert.match(m.root.html,/guardian-sigil-20261013\/magic.webp/);
  await m.root.click('fusion-primary',{itemId:'a-2'}); assert.match(m.root.html,/成功率 75%/); assert.match(m.root.html,/a-2/);
  for (const id of ['a-1','a-3','a-4']) await m.root.click('fusion-material',{itemId:id}); await m.root.click('fuse'); assert.match(m.root.html,/主羽毛：天使・秘曜/); assert.match(m.root.html,/a-2/); assert.match(m.root.html,/321 金幣/); await m.root.click('cancel'); assert.equal(m.h.calls.length,1); m.view.dispose();
});
test('auto UI distinguishes other source, zero and explicit unlimited; blank budget cannot start',async() => {
  const value = fixture(); value.guardian.auto = {job:job({characterId:'other-owned',status:'ended',maxGold:0}),sourceCharacter:{id:'other-owned',name:'其他來源'},ownerAccountId:'owner'};
  const m = await mountHarness(value,{}, {tab:'auto'}); assert.match(m.root.html,/其他自有角色/); assert.match(m.root.html,/不使用金幣/); assert.match(m.root.html,/目前角色/); await m.root.change('autoBudget',''); await m.root.click('auto-start'); assert.doesNotMatch(m.root.html,/data-sg-confirm/); assert.match(m.root.html,/留白不代表不設上限/);
  await m.root.change('autoBudget','0'); await m.root.click('auto-start'); assert.match(m.root.html,/金幣預算上限 0/); await m.root.click('cancel');
  await m.root.change('autoBudgetMode','unlimited'); await m.root.click('auto-start'); assert.match(m.root.html,/明確選擇不設金幣上限/); await m.root.click('cancel'); assert.equal(m.h.calls.length,1); m.view.dispose();
});
test('unknown reveal focuses pure receipt lookup once; poll, visibility and reopen do not resend or steal focus',async() => {
  const m = await mountHarness(); const record = await loseSummon(m); m.flush(); assert.equal(m.root.reveals,1); assert.equal(m.root.ownerDocument.activeElement.dataset.sgAction,'check-pending');
  m.root.scrollTop = 480; m.root.button('tab',{sgTab:'history'}).focus(); [...m.intervals.values()][0](); m.h.calls.at(-1).resolve(fixture()); await drain(); m.flush(); assert.equal(m.root.reveals,1); assert.equal(m.root.scrollTop,480); assert.equal(m.root.ownerDocument.activeElement.dataset.sgTab,'history');
  m.root.visibility.get('visibilitychange')(); m.h.calls.at(-1).resolve(fixture()); await drain(); assert.equal(m.h.calls.filter(call => call.action === 'guardian/action-scoped').length,1); m.view.dispose();
  const reopened = await mountHarness(fixture(),{values:m.h.values}); reopened.flush(); assert.equal(reopened.root.reveals,0); assert.match(reopened.root.html,new RegExp(record.id)); assert.equal(reopened.h.calls.length,1); reopened.view.dispose();
});
test('queued unknown focus cannot override later focus, Back route disposal, hidden document, detach, or A/B/A',async t => {
  for (const mode of ['focus','dispose','hidden','detach','context']) await t.test(mode,async() => {
    const m = await mountHarness(); await loseSummon(m); const outside = {kind:'new-focus'}; m.root.ownerDocument.activeElement = outside;
    if (mode === 'dispose') m.view.dispose(); if (mode === 'hidden') m.root.ownerDocument.hidden = true; if (mode === 'detach') m.root.isConnected = false; if (mode === 'context') { m.h.setContext({characterId:'other',epoch:1}); m.h.setContext({characterId:'actor',epoch:2}); }
    m.flush(true); assert.equal(m.root.reveals,0); assert.equal(m.root.ownerDocument.activeElement,outside); m.view.dispose();
  });
});
test('polling keeps in-progress budget input and focus while invalidating changed inventory selections',async() => {
  const m = await mountHarness(fixture(),{}, {tab:'auto'}), input = m.root.field('autoBudget'); input.value = '14321'; input.focus(); m.root.events.get('input')({target:input});
  [...m.intervals.values()][0](); m.h.calls.at(-1).resolve(fixture({revision:2})); await drain(); assert.equal(m.root.field('autoBudget').value,'14321'); assert.equal(m.root.ownerDocument.activeElement.dataset.sgField,'autoBudget'); m.view.dispose();
});
test('explicit pending receipt lookup preserves its focused trigger without clearing or replaying an unresolved request',async() => {
  const m = await mountHarness(), record = await loseSummon(m); m.flush();
  const task = m.root.click('check-pending',{pendingId:record.id}); m.h.calls.at(-1).resolve(fixture()); await drain();
  assert.equal(m.h.calls.at(-1).action,'guardian/receipt'); assert.equal(m.root.ownerDocument.activeElement.dataset.sgAction,'check-pending');
  m.h.calls.at(-1).resolve(receipt(record,{found:false,recoveryAllowed:true})); await task;
  assert.equal(m.root.ownerDocument.activeElement.dataset.sgAction,'check-pending'); assert.equal(m.h.calls.filter(value => value.action === 'guardian/action-scoped').length,1); assert.equal(JSON.parse([...m.h.values.values()][0]).id,record.id); m.view.dispose();
});
test('recovered welcome result displays the original other-owned recipient without attributing another grant to the current actor',async() => {
  const m = await mountHarness(fixture({welcome:false})); await m.root.click('welcome'); const lost = m.root.click('confirm'); m.h.calls.at(-1).reject(Error('lost welcome')); await lost;
  const record = JSON.parse([...m.h.values.values()][0]), snapshot = fixture(); snapshot.guardian.state.welcome.recipientCharId = 'other-owned'; snapshot.guardian.state.balances.freeNormalDraws = 0;
  const task = m.root.click('check-pending',{pendingId:record.id}); m.h.calls.at(-1).resolve(snapshot); await drain();
  m.h.calls.at(-1).resolve(receipt(record,{result:{welcome:{accountId:'owner',recipientCharacterId:'other-owned',draws:200,createdAt:NOW - 60000}}})); await task;
  assert.match(m.root.html,/實際領取角色：[\s\S]*other-owned/); assert.match(m.root.html,/已由另一自有角色領取/); assert.match(m.root.html,/不會再次發放/); await m.root.click('acknowledge',{pendingId:record.id}); assert.equal(m.h.values.size,0); assert.equal(m.h.calls.filter(value => value.action === 'guardian/action-scoped').length,1); m.view.dispose();
});
test('tab clicks and quality changes preserve a damaged pending blob even when the mounted UI still has a complete cached record',async() => {
  const m = await mountHarness(), record = await loseSummon(m), storageKey = [...m.h.values.keys()][0], damaged = '{preserve these broken bytes';
  m.h.values.set(storageKey,damaged); await m.root.click('tab',{sgTab:'inventory'}); assert.equal(m.h.values.get(storageKey),damaged); assert.match(m.root.html,/無法讀取待核對操作紀錄/);
  const task = m.root.change('quality','white'); assert.equal(m.h.calls.at(-1).action,'guardian/scene'); m.h.calls.at(-1).resolve(fixture()); await task;
  assert.equal(m.h.values.get(storageKey),damaged); assert.match(m.root.html,new RegExp(record.id)); assert.equal(m.h.calls.filter(value => value.action === 'guardian/action-scoped').length,1); m.view.dispose();
});
