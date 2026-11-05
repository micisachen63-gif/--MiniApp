// Explicit opt-in, disposable Guardian QA. Synthetic inputs are labelled;
// every observed summon/fusion/sale/job result still comes from original services.
import {createHash,randomUUID} from 'node:crypto';
import * as Player from '../src/services/player.js';
import * as Guardian from '../src/services/guardian-sigil.js';
import * as GuardianAuto from '../src/services/guardian-auto.js';
import * as Exchange from '../src/services/market-exchange.js';
import {activeSettings} from '../src/game/guardian-sigil-config.js';
import {ASSIST_ITEM} from '../src/game/guardian-assist.js';
import {taipeiDay} from '../src/game/time.js';
import {resolveRealm,scopeEnvForRealm,transitionRealmPhase} from '../src/realm/index.js';

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function isolated(env){
 if(env.ENVIRONMENT!=='development'||env.ALLOW_DEV_AUTH!=='true')throw Error('Guardian QA requires isolated development authentication');
 for(const db of [env.DB,env.DB_SEASON])if(!db?.sqlite||db.sqlite.prepare('PRAGMA database_list').all().some(x=>x.file))throw Error('Guardian QA refuses any persistent database');
}
export function guardianDatabaseSnapshot(db){
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),rows={},counts={},tableHashes={};
 for(const name of names){rows[name]=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort();counts[name]=rows[name].length;tableHashes[name]=digest(rows[name]);}
 return {sha256:digest(rows),tableHashes,counts,totalChanges:db.prepare('SELECT total_changes() n').get().n,outboxHash:tableHashes.rpg_outbox};
}
const inventory=(db,id,item,quantity)=>db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id,item,quantity);
function actor(db,char,now,{level=30,gold=100000,role='owned-alt',realmId='permanent'}={}){
 db.prepare("UPDATE rpg_characters SET level=?,gold=?,party_id=NULL,idle_state='gate',last_settle_at=?,guardian_draw_remainder=0 WHERE tg_id=?").run(level,gold,now,char.tg_id);
 for(const [item,quantity]of [['guardian_voucher',4],['guardian_free_normal',0],[ASSIST_ITEM,5],['unbind',60]])inventory(db,char.tg_id,item,quantity);
 return {accountId:String(char.account_tg_id||char.tg_id),characterId:String(char.tg_id),name:char.name,baseClass:char.base_class,level,role,realmId};
}
async function seedSigils(scope,db,who,now,{main=false}={}){
 // The FK requires a source operation. This explicitly non-committed anchor
 // is only synthetic initial input, has no typed receipt and no cost ledger.
 const prefix='qa_'+digest(who.characterId).slice(0,10),anchor=prefix+'_initial_input',anchorAt=now-86400000,items=[],roles={};
 const input={fixtureOnly:true,notAReceipt:true,status:'synthetic-initial-input',operationId:anchor,charId:who.characterId,action:'QA 合成初始素材（非已提交召喚；非收據）',results:[],createdAt:anchorAt,explanation:'Initial QA inventory, never a submitted gameplay outcome'};
 db.prepare("INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(anchor,who.accountId,who.characterId,prefix+'_seed_input','summon',digest(input),'qa-initial-input','{}',JSON.stringify(input),anchorAt);
 const add=(role,quality,type='magic',bound=0,extra={})=>{
  const id=prefix+'_'+role,row={id,char_id:who.characterId,type,quality,bound,source_operation_id:anchor,created_at:now,updated_at:now,...extra};
  db.prepare('INSERT INTO rpg_guardian_sigils(id,char_id,type,quality,bound,active,locked,source_operation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,who.characterId,type,quality,bound,row.active||0,row.locked||0,anchor,now,now);items.push(row);roles[role]=id;return id;
 };
 add('a_active',2,'magic',1,{active:1});add('b_locked',2,'ranged',0,{locked:1});add('c_unbind',3,'melee',1);
 add('d_kept_support',3,'magic',1);add('e_support_a',3);add('f_support_b',3,'loot');add('g_sale_a',2);add('h_sale_b',3,'loot');
 if(main){
  add('i_escrow',2,'ranged');
  for(let i=0;i<4;i++)add('j_fuse_white_'+i,1,'magic',i===0?1:0);
  for(let i=0;i<4;i++)add('k_fuse_red_'+i,5,'magic',i===0?1:0);
  for(let i=0;i<6;i++)add('l_fuse_gold_'+i,6,i===0?'magic':i%2?'loot':'melee',i===0?1:0);
  for(let i=0;i<45;i++)add('z_page_'+String(i).padStart(2,'0'),1,i%2?'melee':'magic');
 }
 const original=JSON.parse(db.prepare('SELECT special_json FROM rpg_characters WHERE tg_id=?').get(who.characterId).special_json||'{}');
 const special={...original,guardianSummonEnabled:false,guardianStoneSupply:false,guardianAssist:{itemId:roles.d_kept_support,remainingBattles:37,battlesPerStone:activeSettings(scope).assist.battlesPerStone,autoRenew:false}};
 db.prepare('UPDATE rpg_characters SET special_json=? WHERE tg_id=?').run(JSON.stringify(special),who.characterId);
 return {actor:who,anchor:{id:anchor,status:input.status,fixtureOnly:true,notAReceipt:true,typedReceiptCreated:false},roles,items,sha256:digest({input,items,special})};
}
export async function seedGuardianQa(env,permanent,now){
 isolated(env);const db=env.DB.sqlite,fixtures=[],initialInputs=[],setupReceipts=[];
 const existing=db.prepare("SELECT * FROM rpg_characters WHERE account_tg_id='90101' ORDER BY char_slot").all();
 if(existing.length!==4)throw Error('Guardian QA expects the original four preview characters');
 for(const char of existing)fixtures.push(actor(db,char,now,{level:char.base_class==='thief'?14:char.base_class==='sword'?15:30,role:char.base_class==='mage'?'primary-first-welcome':char.base_class==='thief'?'below-level':char.base_class==='sword'?'first-lv15':'owned-alt'}));
 for(const [accountId,name,gold,role]of [['90102','天使付費驗收',100000,'paid-source'],['90103','天使資源邊界',0,'resources-boundary'],['90104','天使預算邊界',10000,'budget-boundary']]){
  const made=await Player.createCharacter(permanent,{tgId:accountId,charSlot:1,name,baseClass:'mage',gender:'f'},now),who=actor(db,made.char,now,{gold,role});
  fixtures.push(who);await Guardian.ensureWelcome(permanent,who.characterId,now);inventory(db,who.characterId,'guardian_free_normal',0);
  if(accountId!=='90102'){inventory(db,who.characterId,'guardian_voucher',0);inventory(db,who.characterId,ASSIST_ITEM,0);}
  setupReceipts.push({kind:'original-welcome-initial-setup',actor:who,authority:db.prepare('SELECT * FROM rpg_guardian_welcome WHERE account_id=?').get(accountId),freeDrawsExplicitlySeededTo:0,reason:'Initial already-welcomed resource boundary; no prior consumption is claimed'});
 }
 const primary=fixtures.find(x=>x.role==='primary-first-welcome'),alternate=fixtures.find(x=>x.baseClass==='archer'&&x.accountId==='90101');
 db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(primary.characterId,primary.accountId);
 for(const who of [primary,alternate,fixtures.find(x=>x.role==='paid-source')])initialInputs.push(await seedSigils(permanent,db,who,now,{main:who===primary}));
 const primaryInput=initialInputs.find(x=>x.actor.characterId===primary.characterId);
 const escrow=await Exchange.create(permanent,primary.characterId,{guardianId:primaryInput.roles.i_escrow,price:100,qty:1,characterId:primary.characterId,requestId:randomUUID()},now);
 setupReceipts.push({kind:'original-exchange-initial-escrow',actor:primary,itemId:primaryInput.roles.i_escrow,result:escrow});
 // This is initial counter input only, not four fabricated boss awards.
 db.prepare("INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(?,?,'guardian_voucher',4)").run(primary.accountId,taipeiDay(now));
 const season=scopeEnvForRealm(env,await resolveRealm(env,'season_2026_01')),created=await Player.createCharacter(season,{tgId:'90101',charSlot:1,name:'凍結世界天使驗收',baseClass:'mage',gender:'f'},now);
 const seasonActor=actor(env.DB_SEASON.sqlite,created.char,now,{realmId:'season_2026_01',role:'frozen-first-welcome'});
 initialInputs.push(await seedSigils(season,env.DB_SEASON.sqlite,seasonActor,now));
 await transitionRealmPhase(env,'season_2026_01',{expectedPhase:'ACTIVE',expectedFenceEpoch:0,nextPhase:'FREEZE',cutoffAt:now,now});
 const seed={schemaVersion:1,fixtures,primary,alternate,seasonFixtures:[seasonActor],initialInputs,setupReceipts,seededAt:now,syntheticInitialInputOnly:true,probabilitiesAndPricesUnmodified:true,realNotificationsSent:false};
 return {...seed,initialInputSha256:digest(seed)};
}
export function createGuardianQaController(env,permanent,seed,initialNow){
 isolated(env);let now=initialNow;const commands=[],receipts=new Map(),fixtureIds=new Set(seed.fixtures.map(x=>x.characterId));
 const info=()=>({mode:'manual-development-clock',now,wallTime:Date.now(),debugOnly:true,deadlinesUnmodified:true,guardianIntervalMs:GuardianAuto.INTERVAL_MS,automaticGuardianSweep:false,method:'Explicit QA clock plus original GuardianAuto.step/sweep; not natural waiting'});
 const databases=()=>({permanent:guardianDatabaseSnapshot(env.DB.sqlite),season:guardianDatabaseSnapshot(env.DB_SEASON.sqlite)});
 const rows=(db,table,order)=>db.prepare('SELECT * FROM '+table+' ORDER BY '+order).all();
 const realmSnapshot=db=>({
  welcomes:rows(db,'rpg_guardian_welcome','account_id'),sigils:rows(db,'rpg_guardian_sigils','char_id,id'),operations:rows(db,'rpg_guardian_operations','created_at,operation_id'),
  jobs:rows(db,'rpg_guardian_auto','created_at,id'),ledger:rows(db,'rpg_ledger','event_id'),
  accounts:rows(db,'rpg_accounts','account_tg_id'),characters:db.prepare('SELECT tg_id,account_tg_id,name,base_class,level,gold,hp,mp,rev,party_id,idle_state,last_settle_at,special_json,guardian_draw_remainder FROM rpg_characters ORDER BY tg_id').all(),
  inventory:rows(db,'rpg_inventory','tg_id,item'),daily:rows(db,'rpg_daily_counters','tg_id,day,key'),outbox:rows(db,'rpg_outbox','id'),
  exchange:rows(db,'rpg_exchange_listings','id'),backgroundOperations:rows(db,'rpg_background_operations','seq'),
 });
 const ownedJob=id=>{
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Guardian QA requires an exact original UUID job ID');
  const job=env.DB.sqlite.prepare('SELECT * FROM rpg_guardian_auto WHERE id=?').get(id);
  if(!job||!fixtureIds.has(String(job.char_id)))throw Error('Guardian QA only controls its original fixture jobs');
  return job;
 };
 return {
  now:()=>now,info,
  snapshot(){isolated(env);return {ok:true,isolated:true,ephemeral:true,productionAccess:false,readOnly:true,qaClock:info(),commands,...seed,databases:databases(),permanent:realmSnapshot(env.DB.sqlite),season:realmSnapshot(env.DB_SEASON.sqlite),realmIdentities:{permanent:rows(env.DB.sqlite,'rpg_realm_identity','singleton'),season:rows(env.DB_SEASON.sqlite,'rpg_realm_identity','singleton')}};},
  async advance(body){
   isolated(env);const requestId=String(body.requestId||'');if(!/^[\w:-]{1,120}$/.test(requestId))throw Error('Guardian QA requires requestId');
   const signature=JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key])=>key!=='requestId').sort(([a],[b])=>a.localeCompare(b)))),previous=receipts.get(requestId);
   if(previous){if(previous.signature!==signature)throw Error('Guardian QA request ID changed content');return previous.result;}
   const job=ownedJob(body.jobId),before=databases(),from=now;let result=null,clockOnly=false;
   if(body.op==='due'||body.op==='before-due'){
    if(job.status!=='running')throw Error('Original running job required');const target=job.next_at-(body.op==='before-due'?1:0);
    if(target<now)throw Error('Guardian QA refuses to rewind');now=target;clockOnly=true;
   }else if(body.op==='step')result=await GuardianAuto.step(permanent,job.id,now);
   else if(body.op==='sweep'){
    const due=env.DB.sqlite.prepare("SELECT * FROM rpg_guardian_auto WHERE status='running' AND next_at<=?").all(now);
    if(due.some(j=>!fixtureIds.has(String(j.char_id))))throw Error('Sweep would reach an unowned actor');
    result=await GuardianAuto.sweep(permanent,now);
   }else throw Error('Unknown Guardian QA command');
   const after=databases(),afterJob=ownedJob(job.id);
   if(clockOnly&&JSON.stringify(before)!==JSON.stringify(after))throw Error('Clock changed gameplay data');
   const receipt={ok:true,isolated:true,debugOnly:true,productionAccess:false,deadlinesUnmodified:true,requestId,op:body.op,jobId:job.id,actor:seed.fixtures.find(x=>x.characterId===String(job.char_id)),from,to:now,originalIntervalMs:GuardianAuto.INTERVAL_MS,beforeJob:job,afterJob,before,after,result,qaClock:info()};
   commands.push({...receipt,recordedAt:new Date().toISOString()});receipts.set(requestId,{signature,result:receipt});return receipt;
  }
 };
}
