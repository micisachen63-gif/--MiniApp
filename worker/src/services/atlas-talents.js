import { GameError } from '../game/classes.js';
import { ATLAS_TALENT_VERSION,getAtlasTalentCatalog,validateAtlasTalents } from '../game/atlas-talents.js';
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
  if(!['allocate','reset','tutorial_start','tutorial_complete'].includes(kind))throw new GameError('atlas_talent','不支援的天賦操作');
  const p=await loadPlayer(env.DB,charId,env);if(!p)throw new GameError('no_character','請先選擇角色',404);
  const db=env.DB,account=p.char.account_tg_id||charId;
  const signature=JSON.stringify({charId,kind,nodeId:kind==='allocate'?body.nodeId:null});
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
    }else if(kind==='reset')ids=[];
    else if(kind==='tutorial_start')tutorial=Math.max(1,tutorial);
    else {if(tutorial<1||!ids.length)throw new GameError('atlas_talent','請先開始教學並完成一次實際配點',409);tutorial=2;}
    return {extra:[
      ctx.db.prepare('INSERT INTO rpg_atlas_talents(char_id,rules_version,allocated_json,tutorial_step,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(char_id) DO UPDATE SET allocated_json=excluded.allocated_json,tutorial_step=excluded.tutorial_step,rev=rev+1,updated_at=excluded.updated_at WHERE rev=? AND rules_version=excluded.rules_version').bind(charId,ATLAS_TALENT_VERSION,JSON.stringify(ids),tutorial,now,state.revision),guardStmt(ctx.db),
      ctx.db.prepare('INSERT INTO rpg_atlas_operations(account_id,request_id,kind,signature,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(account,requestId,'talent',signature,JSON.stringify({charId,kind}),now),
    ],ledger:[{event_id:`atlas:talent:${account}:${requestId}`,tg_id:charId,type:'星圖天賦',note:JSON.stringify({kind,nodeId:kind==='allocate'?body.nodeId:null,spent:ids.length,tutorialStep:tutorial})}]};
  });}catch(error){if(!await replay())throw classifyDbError(error)||error;}
  return viewAfterReplay();
  async function viewAfterReplay(){const player=await loadPlayer(db,charId,env);return {ok:true,realmId:env.REALM_CONTEXT?.id||'permanent',characterId:charId,talentOnly:true,talents:await readAtlasTalents(db,player.char),now};}
}
