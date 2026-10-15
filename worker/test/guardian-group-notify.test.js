// Offline only: real SQLite/API/adapter, synthetic accounts, fake Telegram.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {createCharacter} from '../src/services/player.js';
import {loadPlayer} from '../src/db.js';
import {handle} from '../src/index.js';
import * as G from '../src/services/guardian-sigil.js';
import * as S from '../src/services/share.js';
import * as M from '../src/services/market-exchange.js';
import {activeSettings,TYPES,QUALITY_ORDER} from '../src/game/guardian-sigil-config.js';
import {mulberry32} from '../src/game/rng.js';
const runtime=process.env.GUARDIAN_NOTIFY_COMPILED_URL?(await import(process.env.GUARDIAN_NOTIFY_COMPILED_URL)).default.fetch:handle;
const Adapter=await import('../../cloud-bot/src/adapter/rpg-flow.js');
async function fixture(){
 const db=freshDb();db.sqlite.exec('PRAGMA foreign_keys=ON');
 const env={DB:db,ENVIRONMENT:'development',ALLOW_DEBUG_TIME:'true',SERVICE_SECRET:'offline-test-secret-0001',GROUP_CHAT_ID:'-1001234567890'};
 for(const [tgId,name] of [['790','羽羽'],['791','星星']]){await createCharacter(env,{tgId,name,baseClass:'sword',gender:'m'},T0);await db.prepare('UPDATE rpg_characters SET level=50,gold=100000,last_settle_at=? WHERE tg_id=?').bind(T0,tgId).run();}
 return {db,env};
}
async function service(env,path,body){const response=await runtime(new Request('https://offline.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Service-Secret':env.SERVICE_SECRET,'X-Debug-Now':String(T0)},body:JSON.stringify(body)}),env,{waitUntil(p){void Promise.resolve(p).catch(()=>{});}}),data=await response.json();if(!response.ok)throw Object.assign(Error(data.message),{code:data.error,status:response.status});return data;}
function draws(seed,count){const rng=mulberry32(seed),weights=activeSettings().normalWeights;return Array.from({length:count},()=>{const type=TYPES[Math.floor(rng()*TYPES.length)];let n=rng()*1000000,rank=0;do{n-=weights[rank++];}while(n>=0);return {type,rank};});}
function drawSeed(count,predicate){for(let seed=0;seed<100000;seed++)if(predicate(draws(seed,count)))return seed;throw Error('No deterministic actual draw seed');}
async function withSeed(seed,fn){const original=crypto.getRandomValues;crypto.getRandomValues=array=>array instanceof Uint32Array&&array.length===1?(array[0]=seed,array):original.call(crypto,array);try{return await fn();}finally{crypto.getRandomValues=original;}}
async function summon(env,count,seed,requestId='offline_summon_001'){return withSeed(seed,()=>service(env,'/rpg/guardian/summon',{tgId:'790',pool:'normal',count,requestId}));}
async function claim(env){return (await service(env,'/rpg/outbox/claim',{limit:50})).items.filter(item=>item.kind==='guardian_sigil_obtained');}
function flow(env,{telegramFailure=null,failAck=false,store={data:{},save(){}}}={}){
 const calls=[],serviceCalls=[],warnings=[];let nextMessage=50;
 const client={call:async(path,body)=>{serviceCalls.push({path,body});if(['/rpg/journal/publish','/rpg/boss/spawn-due','/rpg/party/tick'].includes(path))return {ok:true};if(failAck&&path==='/rpg/outbox/ack')throw Error('offline lost ACK');return service(env,path,body);}};
 const api={call:async(method,body)=>{calls.push({method,body});if(method==='sendPhoto'&&telegramFailure)throw telegramFailure;if(method==='sendPhoto'||method==='sendMessage')return {message_id:++nextMessage};return true;}};
 const rpg=Adapter.createRpgFlow({api,rpgApi:client,configFile:'offline-memory',send:(text,extra={},chatId)=>api.call('sendMessage',{chat_id:chatId,text,...extra}),answer:async()=>{},log:{info(){},warn(s){warnings.push(s)}},now:()=>T0,tgStore:store,chatId:env.GROUP_CHAT_ID,inGroup:chat=>String(chat.id)===env.GROUP_CHAT_ID,inUserPrivate:()=>false,isGroupMember:async()=>true,botUsername:()=> 'StarJournalRpgBot',appUrl:'https://elf-rpg-api.micisachen.workers.dev/',mainMiniApp:true,outboxEveryMs:0});
 return {rpg,calls,serviceCalls,warnings,store};
}
test('single summon posts each true angel art, authoritative ability and safe HTML with both group buttons',async()=>{
 for(const type of TYPES){const {db,env}=await fixture();await db.prepare("UPDATE rpg_characters SET name='<b>&羽羽' WHERE tg_id='790'").run();const result=await summon(env,1,drawSeed(1,r=>r[0].type===type&&r[0].rank===4));const f=flow(env);await f.rpg.tick();
  const photos=f.calls.filter(c=>c.method==='sendPhoto');assert.equal(photos.length,1);const photo=photos[0].body;
  assert.equal(photo.photo,`https://elf-rpg-api.micisachen.workers.dev/art/guardian-sigil-20261013/${type}-share.jpg`);assert.equal(photo.parse_mode,'HTML');assert.match(photo.caption,/&lt;b&gt;&amp;羽羽/);assert.ok(!photo.caption.includes('<b>&羽羽'));assert.match(photo.caption,type==='loot'?/隨機掉寶率 \+18%/:new RegExp(({melee:'近戰',ranged:'遠程',magic:'魔法'})[type]+'傷害 \\+7%'));
  const buttons=photo.reply_markup.inline_keyboard.flat();assert.equal(buttons[0].text,'🤝 我要交易');assert.match(buttons[0].callback_data,/^rpg:sq:s[0-9a-f]{12}$/);assert.equal(buttons[1].text,'✦ 我也來抽');assert.equal(buttons[1].url,'https://t.me/StarJournalRpgBot?startapp=guardian');assert.ok(!buttons.some(b=>b.web_app));
  assert.equal(result.operation.results[0].type,type);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE delivered_at IS NOT NULL AND kind='guardian_sigil_obtained'").get().n,1);
 }
});
test('five/ten draw batches announce only the actual highest quality once; same UUID cannot add a photo/share/reward',async()=>{
 for(const count of [5,10]){const {db,env}=await fixture(),seed=drawSeed(count,rows=>rows.filter(r=>r.rank>=4).length>=2&&Math.max(...rows.map(r=>r.rank))===5),a=await summon(env,count,seed),b=await summon(env,count,seed);
  assert.deepEqual(a.operation,b.operation);const items=await claim(env);assert.equal(items.length,1);const payload=items[0].payload,highest=a.operation.results.reduce((best,r)=>r.rank>best.rank?r:best,a.operation.results[0]);
  assert.equal(payload.itemId,highest.id);assert.equal(payload.type,highest.type);assert.equal(payload.quality,highest.quality);assert.equal(payload.rank,5);assert.equal(payload.count,count);assert.equal(payload.damageBonus,highest.type==='loot'?0:.11);assert.equal(payload.lootBonus,highest.type==='loot'?.30:0);
  assert.equal(Object.values(payload.qualityCounts).reduce((a,b)=>a+b,0),count);for(const color of QUALITY_ORDER)assert.equal(payload.qualityCounts[color],a.operation.results.filter(r=>r.quality===color).length);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_shares').get().n,1);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM rpg_daily_counters WHERE key='share'").get().n,0);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM rpg_shares WHERE kind='share'").get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils').get().n,count);
 }
});
test('existing purple announcement threshold is preserved and failed fusion is silent',async()=>{
 const {db,env}=await fixture();await summon(env,1,drawSeed(1,r=>r[0].rank===3));assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_shares').get().n,0);assert.equal((await claim(env)).length,0);
 await db.prepare("INSERT INTO rpg_guardian_operations VALUES('materials','790','790','offline_material','summon',?,'test','{}','{}',?)").bind('a'.repeat(64),T0).run();for(let i=0;i<4;i++)await G.insertSigil(db,{id:'m'+i,char_id:'790',type:'melee',quality:4,source_operation_id:'materials',created_at:T0}).run();
 let seed=0;while(mulberry32(seed)()<activeSettings().upgradeSuccess[3])seed++;
 const result=await withSeed(seed,()=>service(env,'/rpg/guardian/fuse',{tgId:'790',itemIds:['m0','m1','m2','m3'],primaryId:'m0',requestId:'offline_failure'}));assert.equal(result.operation.success,false);assert.equal(result.operation.results[0].id,'m0');assert.equal((await claim(env)).length,0);
});
test('fusion inherits binding; photo trade callback explains binding and creates no request/escrow',async()=>{
 const {db,env}=await fixture();await db.prepare("INSERT INTO rpg_guardian_operations VALUES('materials','790','790','offline_material','summon',?,'test','{}','{}',?)").bind('a'.repeat(64),T0).run();for(let i=0;i<4;i++)await G.insertSigil(db,{id:'m'+i,char_id:'790',type:'magic',quality:3,bound:i===3?1:0,source_operation_id:'materials',created_at:T0}).run();
 let seed=0;while(mulberry32(seed)()>=activeSettings().upgradeSuccess[2])seed++;
 const result=await withSeed(seed,()=>service(env,'/rpg/guardian/fuse',{tgId:'790',itemIds:['m0','m1','m2','m3'],primaryId:'m0',requestId:'offline_success'}));assert.equal(result.operation.success,true);assert.equal(result.operation.results[0].bound,true);const f=flow(env);await f.rpg.tick();const p=f.calls.find(c=>c.method==='sendPhoto').body;assert.match(p.caption,/已綁定/);const data=p.reply_markup.inline_keyboard[0][0].callback_data,shareId=data.split(':')[2];
 const response=await f.rpg.onCallback({id:'offline-callback',from:{id:791},data,message:{message_id:51,chat:{id:env.GROUP_CHAT_ID,type:'supergroup'}}},'sq',shareId);assert.equal(response.error,'untradeable');assert.match(f.calls.filter(c=>c.method==='answerCallbackQuery').at(-1).body.text,/已綁定/);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_trade_requests').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_trades').get().n,0);assert.equal((await loadPlayer(db,'790')).char.gold,100000-activeSettings().upgradeGoldFees[2]);
});
test('unbound announced angel follows original request/accept workflow; later activation and exchange escrow reject stale cards',async()=>{
 const {db,env}=await fixture();const a=await summon(env,1,drawSeed(1,r=>r[0].rank===4));let item=(await claim(env))[0],shareId=item.payload.shareId;const r=await S.requestTrade(env,{tgId:'791',shareId},T0);assert.equal(r.objectKind,'sigil');
 await G.activate(env,'790',{itemId:a.operation.results[0].id,requestId:'offline_activate'},T0);await assert.rejects(S.acceptRequest(env,{tgId:'790',requestId:r.id},T0),e=>e.code==='untradeable');await assert.rejects(S.requestTrade(env,{tgId:'791',shareId},T0),e=>e.code==='untradeable'&&/已綁定/.test(e.message));
 await G.activate(env,'790',{itemId:null,requestId:'offline_off'},T0);await db.prepare("INSERT INTO rpg_inventory VALUES('790','unbind',10)").run();await G.unbind(env,'790',{itemId:a.operation.results[0].id,requestId:'offline_unbind'},T0);
 await M.create(env,'790',{guardianId:a.operation.results[0].id,qty:1,price:100,characterId:'790',requestId:crypto.randomUUID()},T0);await assert.rejects(S.requestTrade(env,{tgId:'791',shareId},T0),e=>e.code==='untradeable'&&/保管/.test(e.message));assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_trades').get().n,0);
});
test('successful group delivery cached before lost ACK does not post twice and keeps the draw link during updates',async()=>{
 const {db,env}=await fixture();await summon(env,1,drawSeed(1,r=>r[0].rank===4));const f=flow(env,{failAck:true});await f.rpg.tick();const share=db.sqlite.prepare('SELECT id FROM rpg_shares').get();assert.ok(db.sqlite.prepare('SELECT message_id FROM rpg_shares').get().message_id);
 db.sqlite.prepare('UPDATE rpg_outbox SET claimed_at=NULL').run();await f.rpg.tick();assert.equal(f.calls.filter(c=>c.method==='sendPhoto').length,1);
 const updated=await S.shareView(env,share.id),keyboard=Adapter.shareKeyboard(updated,{guardianLink:'https://t.me/StarJournalRpgBot?startapp=guardian'});assert.deepEqual(keyboard[0].map(b=>b.text),['🤝 我要交易','✦ 我也來抽']);
});
test('definite photo rejection falls back safely; ambiguous Telegram network failure stays unacknowledged',async()=>{
 for(const definite of [true,false]){const {db,env}=await fixture();await summon(env,1,drawSeed(1,r=>r[0].rank===4));const error=Object.assign(Error('offline rejection'),definite?{definite:true,httpStatus:400,errorCode:400,description:'Bad Request: failed to get HTTP URL content'}:{name:'TelegramNetworkError',definite:false}),f=flow(env,{telegramFailure:error});await f.rpg.tick();
  assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,definite?1:0);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='guardian_sigil_obtained' AND delivered_at IS NOT NULL").get().n,definite?1:0);assert.equal(f.serviceCalls.some(c=>c.path==='/rpg/outbox/fail'),!definite);
 }
});
test('429, 5xx, unknown transport and non-photo rejections use original outbox backoff without text fallback',async()=>{
 for(const props of [{definite:true,errorCode:429,httpStatus:429,description:'Too Many Requests: retry after 30',parameters:{retry_after:30}},{definite:true,errorCode:500,httpStatus:500,description:'Internal Server Error'},{definite:false,description:'connection ended'},{definite:true,errorCode:400,httpStatus:400,description:"Bad Request: can't parse entities"},{definite:true,errorCode:404,httpStatus:404,description:'Not Found'}]){
  const {db,env}=await fixture();await summon(env,1,drawSeed(1,r=>r[0].rank===4));const f=flow(env,{telegramFailure:Object.assign(Error('offline transport'),props)});await f.rpg.tick();
  assert.equal(f.calls.filter(c=>c.method==='sendPhoto').length,1);assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,0);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM rpg_outbox WHERE kind='guardian_sigil_obtained' AND delivered_at IS NOT NULL").get().n,0);
  const failure=f.serviceCalls.find(c=>c.path==='/rpg/outbox/fail');assert.ok(failure);assert.equal(failure.body.errorCode,props.errorCode||0);assert.equal(failure.body.retryAfterSeconds,props.parameters?.retry_after||0);assert.equal(db.sqlite.prepare("SELECT claim_token FROM rpg_outbox WHERE kind='guardian_sigil_obtained'").get().claim_token,null);
 }
});
test('announcement/share/receipt/materials all roll back together if the final outbox write fails',async()=>{
 const {db,env}=await fixture(),gold=(await loadPlayer(db,'790')).char.gold;db.sqlite.exec("CREATE TRIGGER offline_reject_notice BEFORE INSERT ON rpg_outbox WHEN NEW.kind='guardian_sigil_obtained' BEGIN SELECT RAISE(ABORT,'offline simulated failure'); END");
 await assert.rejects(summon(env,10,drawSeed(10,r=>r.some(x=>x.rank>=4))));assert.equal((await loadPlayer(db,'790')).char.gold,gold);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_operations').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_guardian_sigils').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_shares').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_outbox').get().n,0);
});
test('legacy queued guardian events still show correct type art and guardian deep link without inventing ability values',async()=>{
 const {db,env}=await fixture();await db.prepare("INSERT INTO rpg_outbox(dedupe_key,target,kind,payload_json,created_at) VALUES('legacy','group','guardian_sigil_obtained',?,?)").bind(JSON.stringify({operationId:'old-queued',type:'ranged',typeName:'天使・星弦',quality:'purple',qualityName:'紫',name:'旅人',source:'normal'}),T0).run();const f=flow(env);await f.rpg.tick();const photo=f.calls.find(c=>c.method==='sendPhoto').body;assert.match(photo.photo,/ranged-share\.jpg$/);assert.ok(!photo.caption.includes('undefined'));assert.ok(!photo.caption.includes('+7%'));assert.equal(photo.reply_markup.inline_keyboard[0][0].url,'https://t.me/StarJournalRpgBot?startapp=guardian');assert.equal(f.calls.filter(c=>c.method==='sendPhoto').length,1);
});
