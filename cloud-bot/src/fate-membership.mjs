import {createTelegramApi,equalSecret} from './telegram-api.mjs';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const canonicalId=value=>{
 const id=String(value);
 return /^[1-9]\d{0,15}$/.test(id)&&Number.isSafeInteger(Number(id))?id:null;
};
// Fixed group only; never accept Telegram method, group or URL from the caller.
// Unknown membership is deliberately false, without leaking Telegram responses.
export async function fateMembership(request,env,{apiFactory=createTelegramApi}={}){
 if(new URL(request.url).pathname!=='/internal/fate-membership')return null;
 if(request.method!=='POST')return json({ok:false,error:'not_found'},404);
 if(!env.SERVICE_SECRET||!equalSecret(request.headers.get('Authorization'),'Bearer '+env.SERVICE_SECRET))return json({ok:false,error:'forbidden'},403);
 if(!env.BOT_TOKEN||!/^-[1-9]\d{0,18}$/.test(String(env.GROUP_CHAT_ID)))return json({ok:false,error:'unavailable'},503);
 if(Number(request.headers.get('content-length')||0)>2048)return json({ok:false,error:'too_large'},413);
 const raw=await request.text();if(raw.length>2048)return json({ok:false,error:'too_large'},413);
 let input;try{input=JSON.parse(raw);}catch{return json({ok:false,error:'invalid_body'},400);}
 const ids=input?.accountIds;
 if(!Array.isArray(ids)||ids.length<1||ids.length>4||ids.some(id=>!['number','string'].includes(typeof id)||!canonicalId(id)))return json({ok:false,error:'invalid_accounts'},400);
 const accounts=ids.map(canonicalId);if(new Set(accounts).size!==accounts.length)return json({ok:false,error:'invalid_accounts'},400);
 const api=apiFactory(env.BOT_TOKEN);
 const members=await Promise.all(accounts.map(async accountId=>{
  let member=false;
  try{
   const value=await api.call('getChatMember',{chat_id:env.GROUP_CHAT_ID,user_id:accountId},{timeoutMs:5000,retries429:0});
   member=['member','administrator','creator'].includes(value?.status)||(value?.status==='restricted'&&value.is_member===true);
  }catch{/* Fail closed; no exception text, secrets or account data in logs. */}
  return {accountId,member};
 }));
 return json({ok:true,members});
}
