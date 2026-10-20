import {verifyInitData,timingSafeEqual} from '../auth.js';
import {GameError} from '../game/classes.js';
const encoder=new TextEncoder(),COOKIE='__Secure-rpg_admin',TTL=3600_000;
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export async function sign(env,value){
 if(!env.BOT_TOKEN)throw new GameError('admin_unavailable','管理者驗證尚未就緒',503);
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.BOT_TOKEN),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode('star-admin-v1:'+value)));
}
export const cookie=(token='',maxAge=3600)=>`${COOKIE}=${token}; Path=/admin/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export function sameOrigin(request){
 if(request.headers.get('Origin')!==new URL(request.url).origin)throw new GameError('admin_origin','請從管理後台網站操作',403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new GameError('admin_content','需要 JSON 請求',415);
}
export async function adminRole(env,id){
 if(!/^\d{1,20}$/.test(String(id)))throw new GameError('admin_denied','沒有管理者權限',403);
 if(!env.BOT_TOKEN||!env.GROUP_CHAT_ID)throw new GameError('admin_unavailable','管理者驗證尚未就緒',503);
 const restricted=String(env.ADMIN_TG_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(restricted.length&&!restricted.includes(String(id)))throw new GameError('admin_denied','沒有管理者權限',403);
 let data;
 try{const r=await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember`,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:env.GROUP_CHAT_ID,user_id:String(id)}),signal:AbortSignal.timeout(8000),
 });data=await r.json();if(!r.ok||!data.ok)throw Error('unavailable');}
 catch{throw new GameError('admin_unavailable','暫時無法核對 Telegram 管理權限，請稍後再試',503);}
 const member=data.result;
 if(!['creator','administrator'].includes(member?.status)||String(member.user?.id)!==String(id)||member.user?.is_bot)throw new GameError('admin_denied','僅限冒險者之庭群組管理者登入',403);
 return {id:String(id),role:member.status,name:[member.user.first_name,member.user.last_name].filter(Boolean).join(' ')||'管理者'};
}
export async function telegramAdmin(request,env,now){
 const init=request.headers.get('X-Telegram-Init-Data');
 if(!init||init.length>16000)throw new GameError('admin_login','請透過 Telegram 驗證登入',401);
 const user=await verifyInitData(init,env.BOT_TOKEN,now,300);
 if(!user?.id)throw new GameError('admin_login','登入驗證已過期，請重新從 Telegram 開啟',401);
 return adminRole(env,String(user.id));
}
function sessionToken(request){const raw=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return /^[a-f0-9]{64}$/.test(raw||'')?raw:null;}
export async function session(request,env,now,{csrf=false}={}){
 const token=sessionToken(request);if(!token)throw new GameError('admin_login','請先登入管理後台',401);
 const hash=await digest(token),row=await env.DB.prepare('SELECT * FROM rpg_admin_sessions WHERE token_hash=?').bind(hash).first();
 if(!row||row.revoked_at!==null||row.expires_at<=now)throw new GameError('admin_login','登入已過期，請重新驗證',401);
 const csrfToken=await sign(env,'csrf:'+token);
 if(csrf&&!timingSafeEqual(request.headers.get('X-Admin-CSRF'),csrfToken))throw new GameError('admin_csrf','操作驗證已過期，請重新載入',403);
 const admin=await adminRole(env,row.admin_tg_id);
 return {...admin,hash,csrf:csrfToken,expiresAt:row.expires_at};
}
export async function newSession(env,admin,now,pre=[]){
 const token=randomToken(),hash=await digest(token),expiresAt=now+TTL;
 await env.DB.batch([...pre,
  env.DB.prepare('INSERT INTO rpg_admin_sessions(token_hash,admin_tg_id,created_at,expires_at) VALUES(?,?,?,?)').bind(hash,admin.id,now,expiresAt),
  env.DB.prepare('INSERT INTO rpg_admin_audit(id,admin_tg_id,action,details,created_at) VALUES(?,?,?,?,?)').bind('console:login:'+hash,admin.id,'後台登入','{}',now),
 ]);
 return {cookie:cookie(token),admin:{id:admin.id,name:admin.name,role:admin.role,expiresAt,csrf:await sign(env,'csrf:'+token)}};
}
