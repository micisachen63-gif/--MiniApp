import {GameError} from '../game/classes.js';
import {guardStmt} from '../db.js';
import * as AUTH from './auth.js';
import * as DATA from './data.js';
import * as GRANTS from './grants.js';
import {approvePair} from './pairing.js';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'};
const json=(body,status=200,extra={})=>new Response(JSON.stringify({ok:true,...body}),{status,headers:{...headers,...extra}});
const publicAdmin=({id,name,role,csrf,expiresAt})=>({id,name,role,csrf,expiresAt});
async function readBody(request){
 const reader=request.body?.getReader();if(!reader)return '';
 const parts=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>20000){await reader.cancel();throw new GameError('too_large','請求過大',413);}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return new TextDecoder().decode(bytes);
}
export async function handleAdmin(request,env,now=Date.now()){
 try{
  const action=new URL(request.url).pathname.slice('/admin/api/'.length);
  if(request.method==='GET'&&action==='session')return json({admin:publicAdmin(await AUTH.session(request,env,now))});
  if(request.method!=='POST')throw new GameError('method','POST only',405);
  AUTH.sameOrigin(request);
  if(Number(request.headers.get('Content-Length')||0)>20000)throw new GameError('too_large','請求過大',413);
  const text=await readBody(request);
  let b;try{b=JSON.parse(text);}catch{throw new GameError('json','無效 JSON');}
  if(!b||typeof b!=='object'||Array.isArray(b))throw new GameError('json','無效請求');
  if(action==='login/tg'){
   const admin=await AUTH.telegramAdmin(request,env,now),created=await AUTH.newSession(env,admin,now);
   return json({admin:created.admin},200,{'set-cookie':created.cookie});
  }
  if(action==='login/approve'){
   if(!/^[0-9a-f]{64}$/.test(b.challenge||''))throw new GameError('challenge','登入代碼無效');
   const admin=await AUTH.telegramAdmin(request,env,now);
   return json(await approvePair(env,admin,b.challenge,now));
  }
  if(action==='login/redeem'){
   if(!/^[0-9a-f]{64}$/.test(b.verifier||''))throw new GameError('challenge','登入代碼無效');
   const challenge=await AUTH.digest(b.verifier),row=await env.DB.prepare('SELECT * FROM rpg_admin_login_approvals WHERE challenge=?').bind(challenge).first();
   if(!row)return json({pending:true},202);
   if(row.expires_at<=now||row.used_at!==null)throw new GameError('challenge','登入代碼已失效，請重新登入',401);
   const admin=await AUTH.adminRole(env,row.admin_tg_id);
   const created=await AUTH.newSession(env,admin,now,[env.DB.prepare('UPDATE rpg_admin_login_approvals SET used_at=? WHERE challenge=? AND used_at IS NULL AND expires_at>?').bind(now,challenge,now),guardStmt(env.DB)]);
   return json({admin:created.admin},200,{'set-cookie':created.cookie});
  }
  const admin=await AUTH.session(request,env,now,{csrf:true});
  if(action==='logout'){
   await env.DB.prepare('UPDATE rpg_admin_sessions SET revoked_at=? WHERE token_hash=?').bind(now,admin.hash).run();
   return json({},200,{'set-cookie':AUTH.cookie('',0)});
  }
  if(action==='dashboard')return json(await DATA.dashboard(env,b,now));
  if(action==='players')return json(await DATA.players(env,b));
  if(action==='player')return json(await DATA.player(env,b,now));
  if(action==='segments')return json(await DATA.segment(env,b,now));
  if(action==='teams')return json(await DATA.teams(env));
  if(action==='audit')return json(await DATA.audit(env,b));
  if(action==='catalog')return json({items:DATA.catalog()});
  if(action==='grant/preview')return json({preview:await GRANTS.preview(env,admin,b,now)});
  if(action==='grant/commit')return json({grant:await GRANTS.commit(env,admin,b,now)});
  if(action==='grant/status')return json({grant:await GRANTS.status(env,admin,b)});
  throw new GameError('not_found','找不到此功能',404);
 }catch(e){
  if(e instanceof GameError)return new Response(JSON.stringify({ok:false,error:e.code,message:e.message}),{status:e.status||400,headers});
  // Avoid request bodies, Telegram credentials and raw DB exceptions in logs/responses.
  console.error('admin request failed');
  return new Response(JSON.stringify({ok:false,error:'admin_internal',message:'暫時無法完成，請保留操作編號並重試或查核紀錄'}),{status:503,headers});
 }
}
