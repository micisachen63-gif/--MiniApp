import { GameError } from '../game/classes.js';
import { computeStats } from '../game/stats.js';
import { applyExp } from '../game/idle.js';
import { POTIONS } from '../game/constants.js';
import { getAtlasCatalog, getAtlasBuild, getAtlasMap, ATLAS_AUTOMATION, ATLAS_SUPPORTS, ATLAS_MAX_MAP_COUNT, ATLAS_QUEUE_MODES } from '../game/atlas-catalog.js';
import { createAtlasRun, advanceAtlasRun, finalizeAtlasActivities, AtlasRuleError } from '../game/atlas-engine.js';
import { loadPlayer, clonePlayer, persistStatements, guardStmt, ledgerBatchStmts, classifyDbError } from '../db.js';
import { withPlayer } from './player.js';
import { requireBackpackAccess } from './party-presence.js';
import { applyEquipmentAbilityPatch } from '../realm/asset-preservation.js';
import { questEventStatements, activityEventStatements, isPermanentQuestRealm } from './atlas-quests.js';
import {readAtlasTalents} from './atlas-talents.js';
import { projectAtlasScene } from '../game/atlas-scene.js';
import { materializeAtlasEquipment, atlasInventoryDrops } from '../game/atlas-loot.js';

export const ATLAS_RECIPES=Object.freeze([
 {id:'temper',name:'精鐵淬鍊',description:'提高這件裝備的基礎能力 3%；強化值原樣保留。',cost:{atlas_shard:12,atlas_iron:4},stat:'base_stat'},
 {id:'focus',name:'餘燼專注',description:'增加 1% 法力效率；下一次出征生效。',cost:{atlas_shard:12,atlas_ember:4},stat:'mpEfficiencyPct'},
 {id:'venom',name:'毒晶銘刻',description:'增加 1% 持續傷害；下一次出征生效。',cost:{atlas_shard:12,atlas_venom:4},stat:'dotPct'},
]);
const enabled=env=>String(env.ATLAS_ENABLED)==='true';
const realmId=env=>env.REALM_CONTEXT?.id||'permanent';
const canStart=(env,now)=>enabled(env)&&(!env.REALM_CONTEXT?.phase||env.REALM_CONTEXT.phase==='ACTIVE')&&(env.REALM_CONTEXT?.cutoffAt==null||now<env.REALM_CONTEXT.cutoffAt);
const ensure=(env,now)=>{if(!enabled(env))throw new GameError('atlas_unavailable','星圖尚未開放，既有冒險仍可正常遊玩',503);if(!canStart(env,now))throw new GameError('realm_closed','這個環境已停止新的星圖操作',409);};
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw new GameError('atlas_input',`${label}超出有效範圍`);return value;};
const requestId=body=>{const id=String(body.requestId||'');if(!/^[\w:-]{6,96}$/.test(id))throw new GameError('request','需要有效的操作編號');return id;};
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const profileFor=(row,baseClass)=>{
 const build=getAtlasBuild(row?.build_id)||getAtlasCatalog().builds.find(x=>x.baseClass===baseClass);
 return {buildId:build.id,supportIds:row?parse(row.supports_json):[...build.recommendedSupports],automation:row?.automation||build.recommendedAutomation||'balanced',revision:row?.rev||0};
};
async function playerFor(env,charId){const p=await loadPlayer(env.DB,charId,env);if(!p)throw new GameError('no_character','請先選擇這個環境的角色',404);return p;}
async function receipt(db,account,id,kind,signature){
 const row=await db.prepare('SELECT kind,signature,result_json FROM rpg_atlas_operations WHERE account_id=? AND request_id=?').bind(account,id).first();
 if(!row)return null;
 if(row.kind!==kind||row.signature!==signature)throw new GameError('request_reused','操作編號已用於不同的星圖操作',409);
 return parse(row.result_json);
}
const receiptStmt=(db,account,id,kind,signature,result,now)=>db.prepare('INSERT INTO rpg_atlas_operations(account_id,request_id,kind,signature,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(account,id,kind,signature,JSON.stringify(result),now);
function ruleError(error){if(error instanceof AtlasRuleError)return new GameError(error.code,error.message,error.status);return classifyDbError(error)||error;}
function questEvents(env,db,accountId,charId,events,now){
 return isPermanentQuestRealm(env)?questEventStatements(db,{accountId,charId,events},now):[];
}

export async function catalog(env,charId=null,now=Date.now()){
 const open=enabled(env);
 const old=!open&&charId?await env.DB.prepare('SELECT * FROM rpg_live_characters WHERE tg_id=?').bind(charId).first():null;
 const visible=open||!!old?.atlas_run_id;
 return {ok:true,enabled:visible,canStart:canStart(env,now),realmId:realmId(env),catalog:{...getAtlasCatalog(),enabled:visible,canStart:canStart(env,now),recipes:ATLAS_RECIPES,maxCraftsPerItem:3}};
}

export function runView(row,now,realmCutoff=null){
 if(!row)return null;
 const s=parse(row.state_json),endsAt=Math.min((s.startedAt+s.durationSeconds)*1000,realmCutoff??Infinity,row.stop_at??Infinity);
 const target=Math.min(s.durationSeconds,Math.max(0,Math.floor(Math.min(now,endsAt)/1000)-s.startedAt));
 return {id:row.id,status:row.status,mapId:s.mapId,buildId:s.buildId,queueMode:s.queueMode||'count',mapCount:s.mapCount,completedMaps:s.metrics.mapsCompleted,
  startedAt:s.startedAt*1000,endsAt,processedAt:s.processedAt*1000,
  progress:{ratio:row.status==='completed'?1:Math.min(1,s.elapsedSeconds/s.durationSeconds),elapsedSeconds:target,processedSeconds:s.elapsedSeconds,catchingUp:row.status==='running'&&s.elapsedSeconds<target},
  report:{gold:s.totals.gold,exp:s.totals.exp,materials:{...s.totals.materials},...(s.ruleset_version==='atlas-v4'?{equipment:s.totals.equipment||0,items:{...s.totals.items}}:{}),kills:s.metrics.kills,deaths:row.status==='failed'?1:0,used:{hp:s.supplies.hpUsed,mp:s.supplies.mpUsed},reason:s.stopReason,metrics:s.metrics},
  supplies:{hp:s.supplies.hp,mp:s.supplies.mp},stopRequested:row.stop_at!=null};
}

export async function status(env,charId,now){
 const db=env.DB,p=await playerFor(env,charId);
 if(!enabled(env)&&!Object.hasOwn(p.char,'atlas_run_id'))return {ok:true,enabled:false,canStart:false,realmId:realmId(env),characterId:charId,run:null,materials:{},now,scene:projectAtlasScene({player:p,realmId:realmId(env),now})};
 const [profile,run,materials,progress,crafts]=await Promise.all([
  db.prepare('SELECT * FROM rpg_atlas_profiles WHERE char_id=?').bind(charId).first(),
  db.prepare('SELECT * FROM rpg_atlas_runs WHERE char_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').bind(charId).first(),
  db.prepare('SELECT material,quantity FROM rpg_atlas_materials WHERE char_id=?').bind(charId).all(),
  db.prepare('SELECT map_id,completions FROM rpg_atlas_progress WHERE char_id=?').bind(charId).all(),
  db.prepare('SELECT f.item_id,f.crafts FROM rpg_atlas_forges f JOIN rpg_equipment e ON e.id=f.item_id WHERE e.tg_id=?').bind(charId).all(),
 ]);
 const completed=Object.fromEntries(progress.results.map(r=>[r.map_id,r.completions]));
 const counts=Object.fromEntries(crafts.results.map(r=>[r.item_id,r.crafts]));
 const scene=projectAtlasScene({player:p,run,realmId:realmId(env),now});
 return {ok:true,scene,enabled:enabled(env)||!!p.char.atlas_run_id,canStart:canStart(env,now),realmId:realmId(env),characterId:charId,profile:profileFor(profile,p.char.base_class),run:runView(run,now,env.REALM_CONTEXT?.cutoffAt),
  materials:Object.fromEntries(materials.results.map(r=>[r.material,r.quantity])),completedMaps:completed,talents:await readAtlasTalents(db,p.char),profileSaved:!!profile,
  availableMapIds:getAtlasCatalog().maps.filter(m=>m.minLevel<=p.char.level&&m.prerequisites.every(id=>completed[id]>0)).map(m=>m.id),
  supplies:{hp:p.inv.red_1||0,mp:p.inv.blue_1||0},
  equipment:p.equipment.map(e=>({id:e.id,name:e.name,slot:e.slot,enhanceLevel:e.enhance_level,baseStat:e.base_stat,crafts:counts[e.id]||0,tradeLocked:!!e.trade_id})),now};
}

export async function configure(env,charId,body,now){
 const db=env.DB,p=await playerFor(env,charId),account=p.char.account_tg_id||charId,id=requestId(body);
 if(!Object.hasOwn(p.char,'atlas_run_id'))ensure(env,now);
 const build=getAtlasBuild(body.buildId),supports=body.supportIds??[],automation=body.automation||'balanced';
 if(!build||build.baseClass!==p.char.base_class)throw new GameError('atlas_build','流派與角色職業不符');
 if(!Array.isArray(supports)||supports.length>2||new Set(supports).size!==supports.length||supports.some(id=>{const s=ATLAS_SUPPORTS.find(s=>s.id===id);return !s||(s.requires&&!s.requires.some(tag=>build.tags.includes(tag)));}))throw new GameError('atlas_support','請選擇最多兩個適用的輔助');
 if(!ATLAS_AUTOMATION.some(a=>a.id===automation))throw new GameError('atlas_automation','自動施放策略無效');
 const signature=JSON.stringify({charId,buildId:build.id,supports,automation});
 if(await receipt(db,account,id,'configure',signature))return status(env,charId,now);
 ensure(env,now);
 try{await withPlayer(env,charId,now,(work,ctx)=>({extra:[
   ctx.db.prepare('INSERT INTO rpg_atlas_profiles(char_id,account_id,build_id,supports_json,automation,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(char_id) DO UPDATE SET build_id=excluded.build_id,supports_json=excluded.supports_json,automation=excluded.automation,rev=rev+1,updated_at=excluded.updated_at').bind(charId,account,build.id,JSON.stringify(supports),automation,now),
   ...questEvents(env,ctx.db,account,charId,[{sourceId:`atlas:configure:${account}:${id}`,kind:'configure',buildId:build.id,occurredAt:now}],now),
   receiptStmt(ctx.db,account,id,'configure',signature,{characterId:charId},now),
 ]}));}catch(error){if(!await receipt(db,account,id,'configure',signature))throw ruleError(error);}
 return status(env,charId,now);
}

export async function start(env,charId,body,now){
 const db=env.DB,p=await playerFor(env,charId),account=p.char.account_tg_id||charId,id=requestId(body);
 if(!Object.hasOwn(p.char,'atlas_run_id'))ensure(env,now);
 const map=getAtlasMap(body.mapId);if(!map?.available)throw new GameError('atlas_map','星圖尚未開放');
 const queueMode=body.queueMode??'count';
 if(!ATLAS_QUEUE_MODES.some(mode=>mode.id===queueMode))throw new GameError('atlas_invalid_queue','不支援的出征方式');
 if(queueMode==='duration'&&body.mapCount!=null)throw new GameError('atlas_invalid_queue','持續探索不使用張數上限');
 const mapCount=queueMode==='count'?integer(body.mapCount??1,1,ATLAS_MAX_MAP_COUNT,'地圖數量'):null,durationMinutes=integer(body.durationMinutes??60,1,480,'出征時間');
 const supplies={hp:integer(body.supplies?.hp??0,0,500,'紅水數量'),mp:integer(body.supplies?.mp??0,0,500,'藍水數量')};
 // Keep the exact legacy signature for count runs, including response-loss retries.
 const signature=JSON.stringify({...(queueMode==='duration'?{queueMode}:{}),charId,mapId:map.id,mapCount,durationMinutes,supplies});
 if(await receipt(db,account,id,'start',signature))return status(env,charId,now);
 ensure(env,now);
 // New permanent v4 runs need activity storage before reserving supplies.
 // Keep prior receipts and legacy v1-v3 settlement available during rollout.
 if(isPermanentQuestRealm(env)&&!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rpg_atlas_activity_events'").first())throw new GameError('atlas_schema_pending','星圖新內容尚未準備完成，請稍後再出征',503);
 const cutoffAt=env.REALM_CONTEXT?.cutoffAt;
 const durationSeconds=Math.min(durationMinutes*60,cutoffAt==null?Infinity:Math.floor(cutoffAt/1000)-Math.floor(now/1000));
 if(durationSeconds<=0)throw new GameError('realm_closed','這個賽季已停止新的出征',409);
 const runId=crypto.randomUUID(),seed=crypto.getRandomValues(new Uint32Array(1))[0];
 try{await withPlayer(env,charId,now,async(work,ctx)=>{
  if(work.char.active_char_id&&String(work.char.active_char_id)!==charId)throw new GameError('character_changed','請先選擇要出征的角色',409);
  if(work.char.atlas_run_id||work.char.party_id)throw new GameError('atlas_active','請先結束目前的出征或隊伍',409);
  const presence=await ctx.db.prepare('SELECT 1 FROM rpg_party_presence pp JOIN rpg_live_characters pc ON pc.tg_id=pp.char_id WHERE pc.account_tg_id=? LIMIT 1').bind(account).first();
  if(presence)throw new GameError('atlas_active','請先離開目前招募或進行中的隊伍',409);
  if(work.char.idle_state==='reviving')throw new GameError('atlas_recovery','請先等角色恢復再出征');
  if(work.char.level<map.minLevel)throw new GameError('atlas_level',`這張星圖需要 ${map.minLevel} 級`);
  const cleared=(await ctx.db.prepare('SELECT map_id FROM rpg_atlas_progress WHERE char_id=? AND completions>0').bind(charId).all()).results.map(r=>r.map_id);
  if(map.prerequisites.some(key=>!cleared.includes(key)))throw new GameError('atlas_locked','請先完成前一張教學星圖');
  if((work.inv.red_1||0)<supplies.hp||(work.inv.blue_1||0)<supplies.mp)throw new GameError('insufficient','攜帶的紅水或藍水超過背包數量');
  const row=await ctx.db.prepare('SELECT * FROM rpg_atlas_profiles WHERE char_id=?').bind(charId).first(),profile=profileFor(row,work.char.base_class);
  const stats=computeStats(work.char,work.equipment.filter(e=>e.is_equipped));
  let balanceProfile;
  if(env.ATLAS_PROFILE_JSON){try{balanceProfile=JSON.parse(env.ATLAS_PROFILE_JSON);}catch{throw new GameError('atlas_config','星圖平衡設定無效',503);}}
  const talentState=await readAtlasTalents(ctx.db,work.char);
  const state=createAtlasRun({runId,realmId:realmId(env),seed,startAt:Math.floor(now/1000),durationSeconds,queueMode,mapCount,mapId:map.id,buildId:profile.buildId,supports:profile.supportIds,automation:profile.automation,profile:balanceProfile,talentIds:talentState.allocatedIds,
   snapshot:{...stats,characterId:charId,baseClass:work.char.base_class,classPath:work.char.class_path||'',hp:Math.max(1,Math.min(work.char.hp,stats.maxHp)),mp:Math.max(0,Math.min(work.char.mp,stats.maxMp))},
   supplies:{...supplies,hpRestore:POTIONS.red_1.heal,mpRestore:POTIONS.blue_1.heal}});
  work.inv.red_1=(work.inv.red_1||0)-supplies.hp;work.inv.blue_1=(work.inv.blue_1||0)-supplies.mp;
  return {ledger:[...['hp','mp'].filter(k=>supplies[k]>0).map(k=>({event_id:`atlas:${runId}:reserve:${k}`,tg_id:charId,type:'星圖補給保留',item:k==='hp'?'red_1':'blue_1',item_delta:-supplies[k]}))],extra:[
   ctx.db.prepare('INSERT INTO rpg_atlas_runs(id,realm_id,account_id,char_id,status,state_json,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(runId,realmId(env),account,charId,'running',JSON.stringify(state),state.startedAt*1000,now),
   ctx.db.prepare('UPDATE rpg_characters SET atlas_run_id=? WHERE tg_id=? AND atlas_run_id IS NULL').bind(runId,charId),guardStmt(ctx.db),
   receiptStmt(ctx.db,account,id,'start',signature,{runId},now),
   ...questEvents(env,ctx.db,account,charId,[{sourceId:`atlas:${runId}:start`,kind:'start',mapId:map.id,buildId:state.buildId,occurredAt:now}],now),
  ]};
 });}catch(error){if(!await receipt(db,account,id,'start',signature)){
  if(/rpg_atlas_one_active_account|rpg_atlas_runs.account_id|atlas_character_busy/.test(String(error.message)))throw new GameError('atlas_active','這個環境已有出征，請先完成或停止',409);
  throw ruleError(error);
 }}
 return status(env,charId,now);
}

export async function settle(env,charId,body,now){
 const db=env.DB;
 for(let attempt=0;attempt<3;attempt++){
  const loaded=await playerFor(env,charId);
  const run=loaded.char.atlas_run_id?await db.prepare('SELECT * FROM rpg_atlas_runs WHERE id=? AND char_id=?').bind(loaded.char.atlas_run_id,charId).first():null;
  if(!run||run.status!=='running')return status(env,charId,now);
  if(body.runId&&body.runId!==run.id)throw new GameError('atlas_changed','這次出征已改變，請重新查看',409);
  const previous=parse(run.state_json),realmCutoff=env.REALM_CONTEXT?.cutoffAt??Infinity,stopCutoff=run.stop_at??Infinity,cutoff=Math.min(now,stopCutoff,realmCutoff);
  let advanced;try{advanced=advanceAtlasRun(previous,Math.floor(cutoff/1000),{maxSteps:2000});}catch(error){throw ruleError(error);}
  const next=advanced.state;
  const reachedBoundary=!advanced.stillCatchingUp&&next.processedAt>=Math.floor(Math.min(stopCutoff,realmCutoff)/1000);
  if(reachedBoundary&&(next.status==='running'||next.status==='expired')){
   next.status='stopped';next.stopReason=realmCutoff<=stopCutoff?'realm_ended':'player_stopped';next.endedAt=next.processedAt;
   finalizeAtlasActivities(next,advanced.activities);
  }
  if(next.elapsedSeconds===previous.elapsedSeconds&&next.status===previous.status)return status(env,charId,now);
  const work=clonePlayer(loaded),extra=[],entries=[],events=[];const materials={};let gold=0,exp=0,completions=0;
  for(const reward of advanced.rewards){
   gold+=reward.gold;exp+=reward.exp;if(reward.kind==='completion')completions++;
   if(reward.kind==='completion')events.push({sourceId:`atlas:${reward.id}:completion`,kind:'completion',mapId:reward.mapId,buildId:previous.buildId,occurredAt:(previous.startedAt+reward.elapsedSeconds)*1000});
   for(const [key,qty]of Object.entries(reward.materials))materials[key]=(materials[key]||0)+qty;
   for(const item of materializeAtlasEquipment(previous,reward,charId)){
    work.equipment.push(item);entries.push({event_id:'atlas:'+realmId(env)+':'+item.id,tg_id:charId,type:'星圖裝備掉落',item:'equip:'+item.id,item_delta:1,note:JSON.stringify({runId:run.id,mapId:reward.mapId,tier:item.tier,source:'atlas'})});
   }
   for(const [key,qty]of Object.entries(atlasInventoryDrops(previous,reward))){
    work.inv[key]=(work.inv[key]||0)+qty;entries.push({event_id:'atlas:'+realmId(env)+':'+reward.id+':'+key,tg_id:charId,type:'星圖卷軸掉落',item:key,item_delta:qty,note:JSON.stringify({runId:run.id,mapId:reward.mapId})});
   }
   entries.push({event_id:`atlas:${realmId(env)}:${reward.id}`,tg_id:charId,type:'星圖掉落',gold_delta:reward.gold,exp_delta:reward.exp,note:JSON.stringify({runId:run.id,mapId:reward.mapId,materials:reward.materials})});
  }
  work.char.gold+=gold;work.char.exp+=exp;
  if(exp)applyExp(work.char,level=>computeStats(work.char,work.equipment.filter(e=>e.is_equipped),level));
  work.char.last_settle_at=Math.max(Number(work.char.last_settle_at)||0,now);
  const done=next.status!=='running';
  if(done){
   work.inv.red_1=(work.inv.red_1||0)+next.supplies.hp;work.inv.blue_1=(work.inv.blue_1||0)+next.supplies.mp;
   const finalStats=computeStats(work.char,work.equipment.filter(e=>e.is_equipped));
   const talentLife=next.talentSnapshot?.spent>0;
   work.char.hp=Math.max(1,Math.min(finalStats.maxHp,Math.floor(talentLife?next.hero.hp/next.snapshot.maxHp*finalStats.maxHp:next.hero.hp)));
   work.char.mp=Math.max(0,Math.min(finalStats.maxMp,Math.floor(talentLife&&next.snapshot.maxMp?next.hero.mp/next.snapshot.maxMp*finalStats.maxMp:next.hero.mp)));
   for(const [kind,key]of [['hp','red_1'],['mp','blue_1']])if(next.supplies[kind])entries.push({event_id:`atlas:${run.id}:refund:${kind}`,tg_id:charId,type:'星圖補給歸還',item:key,item_delta:next.supplies[kind]});
  }
  const persistedStatus=next.status==='dead'?'failed':next.status;
  extra.push(db.prepare('UPDATE rpg_atlas_runs SET status=?,state_json=?,updated_at=?,rev=rev+1 WHERE id=? AND rev=? AND status=\'running\'').bind(persistedStatus,JSON.stringify(next),now,run.id,run.rev),guardStmt(db));
  if(done)extra.push(db.prepare('UPDATE rpg_characters SET atlas_run_id=NULL WHERE tg_id=? AND atlas_run_id=?').bind(charId,run.id),guardStmt(db));
  for(const [key,qty]of Object.entries(materials))extra.push(db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,?) ON CONFLICT(char_id,material) DO UPDATE SET quantity=quantity+excluded.quantity').bind(charId,key,qty));
  if(completions)extra.push(db.prepare('INSERT INTO rpg_atlas_progress(char_id,map_id,completions,first_completed_at,last_completed_at) VALUES(?,?,?,?,?) ON CONFLICT(char_id,map_id) DO UPDATE SET completions=completions+excluded.completions,last_completed_at=excluded.last_completed_at').bind(charId,next.mapId,completions,now,now));
  extra.push(...questEvents(env,db,loaded.char.account_tg_id||charId,charId,events,now));
  if(advanced.activities?.length)extra.push(...activityEventStatements(db,{accountId:loaded.char.account_tg_id||charId,charId,realmId:realmId(env),events:advanced.activities},now));
  extra.push(...ledgerBatchStmts(db,entries,now));
  try{await db.batch(persistStatements(db,loaded,work,{extra},now));return status(env,charId,now);}catch(error){const classified=classifyDbError(error);if((classified?.code==='conflict'||classified?.code==='duplicate')&&attempt<2)continue;throw classified||error;}
 }
}

export async function stop(env,charId,body,now){
 const db=env.DB,p=await playerFor(env,charId),account=p.char.account_tg_id||charId,id=requestId(body);
 if(!Object.hasOwn(p.char,'atlas_run_id'))ensure(env,now);
 const target=String(body.runId||'');if(!target)throw new GameError('atlas_input','需要指定這次出征');
 const signature=JSON.stringify({charId,runId:target});
 const saved=await receipt(db,account,id,'stop',signature);
 if(!saved){
  const run=await db.prepare('SELECT id,status,stop_at,started_at FROM rpg_atlas_runs WHERE id=? AND char_id=?').bind(target,charId).first();
  if(!run)throw new GameError('atlas_changed','找不到這次出征',404);
  const at=Math.max(run.started_at,Math.floor(now/1000)*1000);
  try{await db.batch([db.prepare('UPDATE rpg_atlas_runs SET stop_at=COALESCE(stop_at,?),rev=rev+1 WHERE id=? AND char_id=?').bind(at,target,charId),guardStmt(db),receiptStmt(db,account,id,'stop',signature,{runId:target,stopAt:run.stop_at??at},now)]);}catch(error){if(!await receipt(db,account,id,'stop',signature))throw ruleError(error);}
 }
 if(p.char.atlas_run_id&&p.char.atlas_run_id!==target)return status(env,charId,now);
 return settle(env,charId,{runId:target},now);
}

export async function craft(env,charId,body,now){
 const db=env.DB,p=await playerFor(env,charId),account=p.char.account_tg_id||charId,id=requestId(body);
 if(!Object.hasOwn(p.char,'atlas_run_id'))ensure(env,now);
 const recipe=ATLAS_RECIPES.find(r=>r.id===body.recipeId),itemId=String(body.itemId||'');
 if(!recipe||!itemId)throw new GameError('atlas_recipe','請選擇裝備與製作配方');
 const signature=JSON.stringify({charId,itemId,recipeId:recipe.id});
 if(await receipt(db,account,id,'craft',signature))return status(env,charId,now);
 ensure(env,now);
 try{await withPlayer(env,charId,now,async(work,ctx)=>{
  requireBackpackAccess(work.char,ctx);
  const item=work.equipment.find(e=>e.id===itemId);if(!item)throw new GameError('not_owned','找不到這件裝備');
  if(item.trade_id||ctx.lockedEquipment.includes(itemId))throw new GameError('atlas_locked_item','請先取回託管裝備或結束背景作業');
  const previous=await ctx.db.prepare('SELECT crafts FROM rpg_atlas_forges WHERE item_id=?').bind(itemId).first();
  if((previous?.crafts||0)>=3)throw new GameError('atlas_craft_cap','這件裝備已完成三次星圖銘刻');
  const extra=[];
  for(const [key,cost]of Object.entries(recipe.cost)){
   const row=await ctx.db.prepare('SELECT quantity FROM rpg_atlas_materials WHERE char_id=? AND material=?').bind(charId,key).first();
   if((row?.quantity||0)<cost)throw new GameError('insufficient','星圖材料不足');
   extra.push(ctx.db.prepare('UPDATE rpg_atlas_materials SET quantity=quantity-? WHERE char_id=? AND material=? AND quantity>=?').bind(cost,charId,key,cost),guardStmt(ctx.db));
  }
  const patch=recipe.stat==='base_stat'?{base_stat:item.base_stat+Math.max(1,Math.round(item.base_stat*.03))}:{bonus_json:{...parse(item.bonus_json||'{}'),[recipe.stat]:(parse(item.bonus_json||'{}')[recipe.stat]||0)+.01}};
  const updated=applyEquipmentAbilityPatch(item,patch);work.equipment[work.equipment.indexOf(item)]=updated;
  extra.push(ctx.db.prepare('INSERT INTO rpg_atlas_forges(item_id,crafts,updated_at) VALUES(?,1,?) ON CONFLICT(item_id) DO UPDATE SET crafts=crafts+1,updated_at=excluded.updated_at').bind(itemId,now),receiptStmt(ctx.db,account,id,'craft',signature,{itemId,enhanceLevel:item.enhance_level},now));
  extra.push(...questEvents(env,ctx.db,account,charId,[{sourceId:`atlas:craft:${account}:${id}`,kind:'craft',occurredAt:now}],now));
  return {extra,ledger:[{event_id:`atlas:craft:${account}:${id}`,tg_id:charId,type:'星圖銘刻',note:JSON.stringify({itemId,recipeId:recipe.id,cost:recipe.cost,enhanceLevel:item.enhance_level})}]};
 });}catch(error){if(!await receipt(db,account,id,'craft',signature))throw ruleError(error);}
 return status(env,charId,now);
}
