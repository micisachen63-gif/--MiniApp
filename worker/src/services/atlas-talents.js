import { GameError } from '../game/classes.js';
import { ATLAS_TALENT_VERSION,getAtlasTalentCatalog,validateAtlasTalents,planAtlasTalentPath } from '../game/atlas-talents.js';
import { computeStats } from '../game/stats.js';
import { createAtlasRun } from '../game/atlas-engine.js';
import { getAtlasCatalog,getAtlasBuild } from '../game/atlas-catalog.js';
import { loadPlayer,guardStmt,classifyDbError } from '../db.js';
import { withPlayer } from './player.js';

export async function readAtlasTalents(db,char){
  const row=await db.prepare('SELECT * FROM rpg_atlas_talents WHERE char_id=?').bind(char.tg_id).first();
  if(row&&row.rules_version!==ATLAS_TALENT_VERSION)throw new GameError('atlas_talent_version','天賦版本尚未完成轉換，請保留原配置並稍後再試',409);
  const selected=row?JSON.parse(row.allocated_json):[];
  return {...validateAtlasTalents(char.base_class,char.level,selected),revision:row?.rev||0,tutorialStep:row?.tutorial_step||0,catalog:getAtlasTalentCatalog(char.base_class)};
}
export async function view(env,charId,now){
  const p=await loadPlayer(env.DB,charId,env);if(!p)throw new GameError('no_character','請先選擇角色',404);
  if(String(env.ATLAS_ENABLED)!=='true')throw new GameError('atlas_unavailable','天賦試作尚未開放',503);
  return {ok:true,realmId:env.REALM_CONTEXT?.id||'permanent',characterId:charId,talentOnly:true,talents:await readAtlasTalents(env.DB,p.char),now};
}
export async function action(env,charId,body,now){
  const requestId=body.requestId,kind=body.kind;
  if(!/^[A-Za-z0-9_:-]{6,96}$/.test(requestId||''))throw new GameError('request','需要有效的操作編號');
  if(!['allocate','allocate_path','reset','tutorial_start','tutorial_complete'].includes(kind))throw new GameError('atlas_talent','不支援的天賦操作');
  if(kind==='allocate_path'&&(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0))throw new GameError('atlas_talent','請先預覽這條路線');
  const p=await loadPlayer(env.DB,charId,env);if(!p)throw new GameError('no_character','請先選擇角色',404);
  const db=env.DB,account=p.char.account_tg_id||charId;
  const signature=JSON.stringify({charId,kind,nodeId:['allocate','allocate_path'].includes(kind)?body.nodeId:null,...(kind==='allocate_path'?{expectedRevision:body.expectedRevision}:{})});
  async function replay(){
    const row=await db.prepare('SELECT kind,signature FROM rpg_atlas_operations WHERE account_id=? AND request_id=?').bind(account,requestId).first();
    if(!row)return false;if(row.kind!=='talent'||row.signature!==signature)throw new GameError('request_reused','操作編號已用於其他操作',409);return true;
  }
  if(await replay())return viewAfterReplay();
  if(String(env.ATLAS_ENABLED)!=='true')throw new GameError('atlas_unavailable','天賦試作尚未開放',503);
  if(env.REALM_CONTEXT?.phase&&env.REALM_CONTEXT.phase!=='ACTIVE'||env.REALM_CONTEXT?.cutoffAt!=null&&now>=env.REALM_CONTEXT.cutoffAt)throw new GameError('realm_closed','這個環境已停止新的操作',409);
  try{await withPlayer(env,charId,now,async(work,ctx)=>{
    if(work.char.atlas_run_id||work.char.party_id)throw new GameError('atlas_active','請先結束目前出征或隊伍再調整天賦',409);
    const state=await readAtlasTalents(ctx.db,work.char);
    let ids=[...state.allocatedIds],tutorial=state.tutorialStep;
    if(kind==='allocate'){
      if(ids.includes(body.nodeId))throw new GameError('atlas_talent','這個節點已配置',409);
      ids.push(body.nodeId);validateAtlasTalents(work.char.base_class,work.char.level,ids);
    }else if(kind==='allocate_path'){
      if(body.expectedRevision!==state.revision)throw new GameError('atlas_talent_changed','天賦已在其他視窗更新，請重新預覽',409);
      const plan=planAtlasTalentPath(work.char.base_class,work.char.level,ids,body.nodeId);if(!plan.canApply)throw new GameError('atlas_talent',plan.reason,409);ids=plan.after.allocatedIds;
    }else if(kind==='reset')ids=[];
    else if(kind==='tutorial_start')tutorial=Math.max(1,tutorial);
    else {if(tutorial<1||!ids.length)throw new GameError('atlas_talent','請先開始教學並完成一次實際配點',409);tutorial=2;}
    return {extra:[
      ctx.db.prepare('INSERT INTO rpg_atlas_talents(char_id,rules_version,allocated_json,tutorial_step,rev,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(char_id) DO UPDATE SET allocated_json=excluded.allocated_json,tutorial_step=excluded.tutorial_step,rev=rev+1,updated_at=excluded.updated_at WHERE rev=? AND rules_version=excluded.rules_version').bind(charId,ATLAS_TALENT_VERSION,JSON.stringify(ids),tutorial,state.revision+1,now,state.revision),guardStmt(ctx.db),
      ctx.db.prepare('INSERT INTO rpg_atlas_operations(account_id,request_id,kind,signature,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(account,requestId,'talent',signature,JSON.stringify({charId,kind}),now),
    ],ledger:[{event_id:`atlas:talent:${account}:${requestId}`,tg_id:charId,type:'星圖天賦',note:JSON.stringify({kind,nodeId:['allocate','allocate_path'].includes(kind)?body.nodeId:null,spent:ids.length,tutorialStep:tutorial})}]};
  });}catch(error){if(!await replay())throw classifyDbError(error)||error;}
  return viewAfterReplay();
  async function viewAfterReplay(){const player=await loadPlayer(db,charId,env);return {ok:true,realmId:env.REALM_CONTEXT?.id||'permanent',characterId:charId,talentOnly:true,talents:await readAtlasTalents(db,player.char),now};}
}

/** Read-only, computed by the same snapshot and skill adapter as a real start. */
export async function preview(env,charId,body,now){
  if(String(env.ATLAS_ENABLED)!=='true')throw new GameError('atlas_unavailable','天賦試作尚未開放',503);
  const p=await loadPlayer(env.DB,charId,env);if(!p)throw new GameError('no_character','請先選擇角色',404);
  const current=await readAtlasTalents(env.DB,p.char),plan=planAtlasTalentPath(p.char.base_class,p.char.level,current.allocatedIds,body.nodeId);
  const stored=await env.DB.prepare('SELECT * FROM rpg_atlas_profiles WHERE char_id=?').bind(charId).first();
  const build=getAtlasBuild(stored?.build_id)||getAtlasCatalog().builds.find(b=>b.baseClass===p.char.base_class);
  const supports=stored?JSON.parse(stored.supports_json):build.recommendedSupports,stats=computeStats(p.char,p.equipment.filter(e=>e.is_equipped));
  const snapshot={...stats,characterId:charId,baseClass:p.char.base_class,hp:Math.max(1,Math.min(p.char.hp,stats.maxHp)),mp:Math.max(0,Math.min(p.char.mp,stats.maxMp))};
  function project(ids){const run=createAtlasRun({runId:'talent-readonly-preview',realmId:env.REALM_CONTEXT?.id||'permanent',seed:1,startAt:0,durationSeconds:60,mapCount:1,mapId:'laurel_intro',buildId:build.id,supports,automation:stored?.automation||'balanced',snapshot,talentIds:ids});return {atk:run.snapshot.atk,def:run.snapshot.def,maxHp:run.snapshot.maxHp,maxMp:run.snapshot.maxMp,takenMultiplier:run.snapshot.taken,attackSpeedMultiplier:run.snapshot.attackSpeedMultiplier,critBonus:run.snapshot.pct.critPct,dotBonus:run.snapshot.pct.dotPct,summonBonus:run.snapshot.pct.summonPct,shieldBonus:run.snapshot.pct.shieldPct,skillName:run.skill.mainSkill,skillCost:run.skill.cost,skillCooldown:run.skill.cooldown,skillDamageMultiplier:run.skill.damageMultiplier};}
  return {ok:true,realmId:env.REALM_CONTEXT?.id||'permanent',characterId:charId,nodeId:body.nodeId,baseRevision:current.revision,plan,
    comparison:{before:project(current.allocatedIds),after:plan.after?project(plan.after.allocatedIds):null},locked:!!p.char.atlas_run_id||!!p.char.party_id,now};
}
