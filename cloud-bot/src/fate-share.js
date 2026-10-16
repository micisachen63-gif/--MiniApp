import jpeg from 'jpeg-js';
import {Resvg} from './renderer/deps/resvg.mjs';
import {createRpgMediaRenderer} from './renderer/media.mjs';
import {verifyInitData} from '../../worker/src/auth.js';
import {decodeResult,ZODIAC,publicUrl,shareText} from '../../worker/public/fate/model.js';

export const GAME_ORIGIN='https://elf-rpg-api.micisachen.workers.dev';
export const CARD_ORIGIN='https://star-journal-rpg-bot.micisachen.workers.dev';
export const CARD_VERSION='20261016-share1';
const corsOrigins=new Set([GAME_ORIGIN,'https://web.telegram.org']);
const illustrations=new Set(['harbor','voyage','atelier','garden']);
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const bytes=x=>x instanceof Uint8Array?x:new Uint8Array(x);
function base64(data){let s='';for(let i=0;i<data.length;i+=16384)s+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(s);}
function lines(s,limit=24){const words=[...s],out=[];while(words.length)out.push(words.splice(0,limit).join(''));return out;}
export function cardDetails(code,format='post'){
 const result=decodeResult(code);if(!result||!['post','story'].includes(format))return null;
 const art=/\/([a-z]+)\.webp$/.exec(result.ending.illustration||'')?.[1];
 return {result,format,width:1080,height:format==='story'?1920:1350,illustration:illustrations.has(art)?art:'harbor',fileName:`star-journal-${code}-${format}.jpg`,imageUrl:`${CARD_ORIGIN}/fate-card/${code}/${format}.jpg?v=${CARD_VERSION}`};
}
export function cardSvg(card,art){
 const {result:r,width:w,height:h}=card,y=card.format==='story'?1010:650;
 const text=(s,yy,size=30,fill='#ecdfc7')=>`<text x="540" y="${yy}" text-anchor="middle" font-size="${size}" fill="${fill}">${xml(s)}</text>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1425" stop-opacity=".05"/><stop offset=".35" stop-color="#0a1425" stop-opacity=".2"/><stop offset=".56" stop-color="#0a1425" stop-opacity=".78"/><stop offset=".67" stop-color="#0a1425"/><stop offset="1" stop-color="#0a1425"/></linearGradient></defs><rect width="1080" height="${h}" fill="#0a1425"/><image href="data:image/jpeg;base64,${base64(bytes(art))}" x="0" y="0" width="1080" height="${Math.round(h*.67)}" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="${h}" fill="url(#shade)"/><rect x="32" y="32" width="1016" height="${h-64}" stroke="#c0a167" stroke-width="2" fill="none"/><rect x="44" y="44" width="992" height="${h-88}" stroke="#b69b5a" stroke-opacity=".4" fill="none"/><g font-family="Noto Sans TC">${text('星 穹 旅 誌 · 命 運 旅 章',110,28,'#e4c58a')}${text('THE LAST STAR LANTERN',153,20,'#d7dce2')}${text((r.zodiac===null?'':ZODIAC[r.zodiac]+'座 · ')+r.identity[0],y,28,'#cbd1d7')}${lines(r.ending.title,15).map((s,i)=>text(s,y+100+i*64,56,r.ending.color)).join('')}${lines('「'+r.ending.quote+'」',23).map((s,i)=>text(s,y+220+i*52,34)).join('')}${lines(r.ending.question,27).map((s,i)=>text(s,y+370+i*44,27,'#aebccf')).join('')}${text('你的故事，尚未寫定。',h-190,27,'#dfc994')}${text('不用登入，讓下一段人生找到你。',h-142,22,'#aab6c9')}${text('星穹旅誌 · '+r.code,h-96,18,'#8f9db0')}</g></svg>`;
}
export function createCardRenderer({wasmModule,loadFont,loadIllustration}){
 // Reuse the renderer's shared initialization promise; calling resvg.initWasm
 // separately would break when a battle render follows a share render.
 const media=createRpgMediaRenderer({wasmModule,loadFont,loadPartyAsset:async()=>new Uint8Array()});
 return async card=>{
  const [font,art]=await Promise.all([media.initialize(),loadIllustration(card.illustration)]);
  let instance,image;
  try{instance=new Resvg(cardSvg(card,art),{font:{fontBuffers:[bytes(font)],defaultFontFamily:'Noto Sans TC'}});image=instance.render();return jpeg.encode({data:image.pixels,width:card.width,height:card.height},90).data;}
  finally{image?.free();instance?.free();}
 };
}
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
function cors(request){const origin=request.headers.get('Origin');return {'vary':'Origin',...(corsOrigins.has(origin)?{'access-control-allow-origin':origin}:{})};}
async function boundedBody(request,limit){
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return null;}chunks.push(value);}}
 finally{reader.releaseLock();}
 const all=new Uint8Array(size);let at=0;for(const c of chunks){all.set(c,at);at+=c.byteLength;}return new TextDecoder().decode(all);
}
export function createFateShare({wasmModule,renderCard,telegramFetch=fetch,now=()=>Date.now(),cache}={}){
 let renderer;
 const prepared=new Map();
 return async function fateShare(request,env,ctx={}){
  const url=new URL(request.url),match=/^\/fate-card\/([^/]+)\/(post|story)\.jpg$/.exec(url.pathname),prepare=url.pathname==='/fate/share/prepare';
  if(!match&&!prepare)return null;
  const headers=cors(request),origin=request.headers.get('Origin');
  if(request.method==='OPTIONS'){
   if(!corsOrigins.has(origin)||prepare&&origin!==GAME_ORIGIN)return json({ok:false,error:'origin'},403,headers);
   return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':prepare?'POST, OPTIONS':'GET, HEAD, OPTIONS','access-control-allow-headers':'Content-Type, X-Telegram-Init-Data','access-control-max-age':'600'}});
  }
  if(match){
   if(!['GET','HEAD'].includes(request.method))return json({ok:false,error:'method'},405,{...headers,allow:'GET, HEAD, OPTIONS'});
   const card=cardDetails(match[1],match[2]);if(!card)return json({ok:false,error:'invalid_story'},404,headers);
   const store=cache??globalThis.caches?.default,key=new Request(card.imageUrl);
   const hit=await store?.match(key);if(hit){const res=new Response(request.method==='HEAD'?null:hit.body,{status:hit.status,headers:hit.headers});for(const[k,v]of Object.entries(headers))res.headers.set(k,v);return res;}
   if(!renderer&&!renderCard)renderer=createCardRenderer({wasmModule,loadFont:async()=>{
    const res=await env.ASSETS.fetch(new Request('https://assets.internal/fonts/NotoSansTC.ttf'));if(!res.ok)throw Error('Font unavailable');return new Uint8Array(await res.arrayBuffer());
   },loadIllustration:async name=>{const res=await env.RPG_API.fetch(new Request(`${GAME_ORIGIN}/art/fate-ending-20261016/${name}.jpg`));if(!res.ok)throw Error('Illustration unavailable');return new Uint8Array(await res.arrayBuffer());}});
   try{
    const data=bytes(await(renderCard||renderer)(card));
    if(data.length>5_000_000||data[0]!==255||data[1]!==216)throw Error('Invalid card');
    const response=new Response(data,{headers:{'content-type':'image/jpeg','content-length':String(data.length),'content-disposition':`attachment; filename="${card.fileName}"`,'cache-control':'public, max-age=86400','x-content-type-options':'nosniff',...headers}});
    if(store){const copy=response.clone();copy.headers.delete('access-control-allow-origin');const saving=store.put(key,copy);if(ctx.waitUntil)ctx.waitUntil(saving);else await saving;}
    return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
   }catch{return json({ok:false,error:'card_unavailable',message:'旅章圖卡暫時無法製作，請稍後再試。'},503,headers);}
  }
  if(request.method!=='POST')return json({ok:false,error:'method'},405,{...headers,allow:'POST, OPTIONS'});
  if(origin!==GAME_ORIGIN)return json({ok:false,error:'origin'},403,headers);
  if(!env.BOT_TOKEN)return json({ok:false,error:'not_configured'},503,headers);
  const init=request.headers.get('X-Telegram-Init-Data');if(!init||init.length>8192)return json({ok:false,error:'unauthorized'},401,headers);
  const user=await verifyInitData(init,env.BOT_TOKEN,now());if(!Number.isSafeInteger(user?.id)||user.id<=0)return json({ok:false,error:'unauthorized'},401,headers);
  if(Number(request.headers.get('content-length')||0)>4096)return json({ok:false,error:'body_too_large'},413,headers);
  let body;try{const raw=await boundedBody(request,4096);if(raw===null)return json({ok:false,error:'body_too_large'},413,headers);body=JSON.parse(raw);}catch{return json({ok:false,error:'bad_json'},400,headers);}
  const card=cardDetails(body?.code,body?.format);if(!card)return json({ok:false,error:'invalid_story'},400,headers);
  const k=`${user.id}:${card.result.code}:${card.format}`,old=prepared.get(k);
  if(old&&old.expirationDate*1000>now()+60000)return json(old,200,headers);
  try{
   const response=await telegramFetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({user_id:user.id,result:{type:'photo',id:`fate-${card.result.code}-${card.format}`,photo_url:card.imageUrl,thumbnail_url:card.imageUrl,photo_width:card.width,photo_height:card.height,title:card.result.ending.title,caption:(shareText(card.result)+'\n'+publicUrl(card.result.code)).slice(0,1024),reply_markup:{inline_keyboard:[[{text:'展開這頁旅章',url:publicUrl(card.result.code)}],[{text:'我也來寫一世',url:GAME_ORIGIN+'/fate/'}]]}},allow_user_chats:true,allow_bot_chats:true,allow_group_chats:true,allow_channel_chats:true})});
   const data=await response.json();
   if(!data.ok||typeof data.result?.id!=='string'||!Number.isFinite(data.result?.expiration_date)||data.result.expiration_date*1000<=now())return json({ok:false,error:'prepare_failed',message:'Telegram 暫時無法準備分享，請稍後再試。'},response.status===429||data.error_code===429?429:502,headers);
   const result={ok:true,id:data.result.id,expirationDate:data.result.expiration_date,imageUrl:card.imageUrl,fileName:card.fileName};
   for(const[key,value]of prepared)if(value.expirationDate*1000<=now())prepared.delete(key);
   if(prepared.size>=128)prepared.delete(prepared.keys().next().value);prepared.set(k,result);
   return json(result,200,headers);
  }catch{return json({ok:false,error:'prepare_unavailable',message:'Telegram 分享連線暫時中斷，圖卡仍可儲存。'},502,headers);}
 };
}
