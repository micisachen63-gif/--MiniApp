import {BotCoordinator} from './coordinator.mjs';
import {webhookSecret,equalSecret} from './telegram-api.mjs';
import {createFateShare} from './fate-share.js';
import {fateMembership} from './fate-membership.mjs';
import wasmModule from './renderer/deps/resvg.wasm';
const fateShare=createFateShare({wasmModule});
export {BotCoordinator};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export default {
 async fetch(request,env,ctx){
  const membership=await fateMembership(request,env);if(membership)return membership;
  const shared=await fateShare(request,env,ctx);if(shared)return shared;
  const url=new URL(request.url),bot=env.BOT_COORDINATOR.get(env.BOT_COORDINATOR.idFromName('StarJournalRpgBot-v1'));
  if(url.pathname==='/health'&&request.method==='GET')return bot.fetch('https://internal/status');
  if(url.pathname==='/telegram/webhook'&&request.method==='POST'){
   if(!env.SERVICE_SECRET||!env.BOT_TOKEN)return reply({ok:false},503);
   if(!equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),await webhookSecret(env.SERVICE_SECRET)))return reply({ok:false},403);
   if(Number(request.headers.get('content-length')||0)>262144)return reply({ok:false},413);
   const raw=await request.text();if(raw.length>262144)return reply({ok:false},413);
   let update;try{update=JSON.parse(raw);}catch{return reply({ok:false},400);}
   if(!Number.isSafeInteger(update.update_id)||update.update_id<0)return reply({ok:false},400);
   return bot.fetch(new Request('https://internal/receive',{method:'POST',body:raw}));
  }
  if(url.pathname==='/telegram/admin'&&request.method==='POST'){
   if(!env.SERVICE_SECRET||!equalSecret(request.headers.get('X-Service-Secret'),env.SERVICE_SECRET))return reply({ok:false},403);
   return bot.fetch(new Request('https://internal/admin',{method:'POST',body:await request.text()}));
  }
  return reply({ok:false,error:'not_found'},404);
 },
 scheduled(event,env,ctx){ctx.waitUntil(env.BOT_COORDINATOR.get(env.BOT_COORDINATOR.idFromName('StarJournalRpgBot-v1')).fetch(new Request('https://internal/wake',{method:'POST'})));}
};
