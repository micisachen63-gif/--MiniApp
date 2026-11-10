// Scene mutations call the original authorities with private receipt hooks.
import * as Guardian from './guardian-sigil.js';
import * as Shop from './guardian-shop.js';
import * as Auto from './guardian-auto.js';
import { activeSettings } from '../game/guardian-sigil-config.js';
import { GameError } from '../game/classes.js';
import { actorContext, operation, record, receiptStatement, projectionReceiptStatements, requireActiveRealm, scopedGuardianEnv } from './guardian-receipt.js';

const envelope=(context,op,saved,replayed)=>({...context,kind:op.kind,requestId:op.requestId,signature:op.signature,result:saved.result,receipt:saved.receipt,replayed});
export async function run(env,tg,body={},now=Date.now(),namespace='service') {
 const op=operation(body.kind,body,namespace),{actor,context}=await actorContext(env,tg,now,body);
 requireActiveRealm(env);
 const before=await record(env,context,op);
 if(before.found)return envelope(context,op,before,true);
 if(!before.recoveryAllowed)throw new GameError('guardian_receipt_unverified','已有未完整核對的原操作，請保留原編號查詢',409);
 const kind=op.kind;
 // Recovery and stop/seen do not depend on today's guardian configuration.
 if(!['auto-stop','auto-seen'].includes(kind)) {
  const cfg=Guardian.requireApprovedConfig(activeSettings(env));
  if(op.fields.configVersion!==cfg.configVersion)throw new GameError('config_changed','天使規則已更新，請重新確認',409);
  if(actor.level<cfg.limits.unlockLevel)throw new GameError('guardian_level','守護天使系統於15級開放',403);
 }
 if(['summon','auto-start'].includes(kind)&&!await env.DB.prepare('SELECT 1 FROM rpg_guardian_welcome WHERE account_id=?').bind(context.accountId).first())
  throw new GameError('guardian_welcome_required','請先明確領取首次召喚贈禮',409);
 if(['auto-stop','auto-seen'].includes(kind)) {
  const job=await env.DB.prepare('SELECT status FROM rpg_guardian_auto WHERE id=? AND owner=?').bind(op.fields.jobId,context.accountId).first();
  if(!job)throw new GameError('guardian_auto_not_found','找不到這個帳號的原背景召喚',404);
  if(kind==='auto-seen'&&job.status!=='ended')throw new GameError('guardian_auto_running','背景召喚尚未結束，請先停止後再標記已讀',409);
 }
 const scoped=scopedGuardianEnv(env,actor),payload={...op.fields,requestId:op.request};
 const options={scoped:true,skipWelcome:true,
  receipt:result=>receiptStatement(scoped.DB,context,op,{operation:result},now),
  saleReceipt:result=>receiptStatement(scoped.DB,context,op,{sale:result},now),
  projectionReceipt:details=>projectionReceiptStatements(scoped.DB,context,op,now,details)};
 try {
  if(kind==='welcome')await Guardian.ensureWelcome(scoped,tg,now,options);
  else if(kind==='sale')await Shop.sell(scoped,tg,payload,now,options);
  else if(kind==='auto-start')await Auto.start(scoped,tg,payload,now,options);
  else if(kind==='auto-stop')await Auto.stop(scoped,tg,payload,now,options);
  else if(kind==='auto-seen')await Auto.seen(scoped,tg,payload,now,options);
  else await Guardian[kind](scoped,tg,payload,now,options);
 } catch(error) {
  const {context:current}=await actorContext(env,tg,now,body),saved=await record(env,current,op);
  if(saved.found)return envelope(current,op,saved,true);
  throw error;
 }
 const {context:current}=await actorContext(env,tg,now,body),saved=await record(env,current,op);
 if(!saved.found)throw new GameError('guardian_receipt_pending','原操作結果尚待核對，請保留原操作編號',409);
 // Wake the unchanged runner only after a new exact start receipt commits.
 if(kind==='auto-start')env.guardianAutoWake?.(saved.result.job.id);
 return envelope(current,op,saved,false);
}
