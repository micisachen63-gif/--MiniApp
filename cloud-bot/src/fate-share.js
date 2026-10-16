import {ensureCountryCodes,COUNTRY_METADATA_V9} from '../../worker/public/fate/country-runtime-v9.js';
import jpeg from 'jpeg-js';
import {Resvg} from './renderer/deps/resvg.mjs';
import {createRpgMediaRenderer} from './renderer/media.mjs';
import {verifyInitData} from '../../worker/src/auth.js';
import {decodeResult,publicUrl,shareText} from '../../worker/public/fate/model.js';
import {cardLayout,cardIdentity,cardIdentityLines,TAIWAN_CARD_WEBP,TAIWAN_CARD_JPEG,countryCardPath} from '../../worker/public/fate/share-card-layout.js';

export const GAME_ORIGIN='https://elf-rpg-api.micisachen.workers.dev';
export const CARD_ORIGIN='https://star-journal-rpg-bot.micisachen.workers.dev';
export const CARD_VERSION='20261016-countries9';
const corsOrigins=new Set([GAME_ORIGIN,'https://web.telegram.org']);
const illustrations=new Set(['harbor','voyage','atelier','garden']);
export function illustrationPath(name){
 if(/^country-(jp|kr|us|ca|gb|de|fr|au|in)$/.test(name))return countryCardPath(name.slice(8).toUpperCase(),'jpg');
 if(name==='taiwan-river')return TAIWAN_CARD_JPEG;
 if(illustrations.has(name))return `/art/fate-ending-20261016/${name}.jpg`;
 throw Error('Invalid illustration');
}
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const bytes=x=>x instanceof Uint8Array?x:new Uint8Array(x);
function base64(data){let s='';for(let i=0;i<data.length;i+=16384)s+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(s);}
function lines(s,limit=24){const words=[...s],out=[];while(words.length)out.push(words.splice(0,limit).join(''));return out;}
export function cardDetails(code,format='post'){
 const result=decodeResult(code);if(!result||!['post','story'].includes(format))return null;
 const art=/\/([a-z]+)\.webp$/.exec(result.ending.illustration||'')?.[1];
 return {result,format,width:1080,height:format==='story'?1920:1350,illustration:result.version===9?'country-'+result.country.toLowerCase():result.version===8&&result.country==='TW'&&result.ending.illustration===TAIWAN_CARD_WEBP?'taiwan-river':illustrations.has(art)?art:'harbor',fileName:`star-journal-${code}-${format}.jpg`,imageUrl:`${CARD_ORIGIN}/fate-card/${code}/${format}.jpg?v=${CARD_VERSION}`};
}
function crestFragment(source,seal){
 if(typeof source!=='string'||!source.startsWith('<svg ')||!source.endsWith('</svg>')||/<(?:script|foreignObject|image|use)\b|\bon[a-z]+\s*=|\bhref\s*=|<!DOCTYPE|<!ENTITY/i.test(source))throw Error('Invalid crest');
 return source.replace(/<svg[^>]*>/,`<svg x="${seal.x}" y="${seal.y}" width="${seal.size}" height="${seal.size}" viewBox="0 0 240 240">`).replaceAll('id="gold"','id="crest-gold"').replaceAll('url(#gold)','url(#crest-gold)').replaceAll('id="wash"','id="crest-wash"').replaceAll('url(#wash)','url(#crest-wash)');
}
export function cardSvg(card,art,crest){
 const {result:r}=card,l=cardLayout(card.format),i=cardIdentity(r),{width:w,height:h}=l,localized=r.version===9||r.version===8&&r.country==='TW',ornamentY=l.identityY-(localized?67:22);
 const text=(s,y,size=30,fill='#ecdfc7')=>`<text x="540" y="${y}" text-anchor="middle" font-size="${size}" fill="${fill}">${xml(s)}</text>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07111e" stop-opacity=".85"/><stop offset=".16" stop-color="#07111e" stop-opacity="0"/><stop offset=".34" stop-color="#0a1425" stop-opacity=".32"/><stop offset=".56" stop-color="#0a1425" stop-opacity=".93"/><stop offset=".72" stop-color="#091322"/><stop offset="1" stop-color="#091322"/></linearGradient><radialGradient id="seal-halo"><stop stop-color="#dfb963" stop-opacity=".16"/><stop offset="1" stop-color="#dfb963" stop-opacity="0"/></radialGradient></defs><rect width="1080" height="${h}" fill="#091322"/><image href="data:image/jpeg;base64,${base64(bytes(art))}" x="0" y="0" width="1080" height="${l.artHeight}" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="${h}" fill="url(#shade)"/><rect x="32" y="32" width="1016" height="${h-64}" stroke="#c8a76a" stroke-width="2" fill="none"/><rect x="44" y="44" width="992" height="${h-88}" stroke="#b69b5a" stroke-opacity=".4" fill="none"/><circle cx="540" cy="${l.crest.y+l.crest.size/2}" r="${l.crest.size*.65}" fill="url(#seal-halo)"/>${crestFragment(crest,l.crest)}<path d="M238 ${ornamentY}H335 M745 ${ornamentY}H842" stroke="#b99a5e" stroke-opacity=".55"/><g font-family="Noto Sans TC">${text('星 穹 旅 誌 · 命 運 旅 章',111,28,'#e9cd95')}${text('THE LAST STAR LANTERN',153,18,'#d1c3a9')}${text(i.name,l.signY,44,'#f2d99f')}${text(i.latin,l.latinY,18,'#b9a578')}${cardIdentityLines(r,l).map(line=>text(line.text,line.y,line.size,'#f5e5bd')).join('')}${text(r.ending.title,l.endingY,30,r.ending.color)}${lines('「'+r.ending.quote+'」',26).map((s,n)=>text(s,l.quoteY+n*l.quoteLine,31,'#d9dbdc')).join('')}${text('如果重啟一世，你會成為誰？',l.invitationY,27,'#edcf8d')}${text(publicUrl(r.code).replace('https://',''),l.urlY,15,'#8e9db3')}${text('Game Producer · ミカサ',l.creditY,15,'#b39d73')}</g></svg>`;
}
export function createCardRenderer({wasmModule,loadFont,loadIllustration,loadCrest}){
 // Use the battle renderer's one shared WASM initialization. Cache only static public assets.
 const media=createRpgMediaRenderer({wasmModule,loadFont,loadPartyAsset:async()=>new Uint8Array()}),crests=new Map();
 const crestFor=id=>{if(!crests.has(id)){const p=Promise.resolve().then(()=>loadCrest(id)).then(s=>String(s).trim()).catch(e=>{crests.delete(id);throw e});crests.set(id,p);}return crests.get(id)};
 return async card=>{
  const [font,art,crest]=await Promise.all([media.initialize(),loadIllustration(card.illustration),crestFor(cardIdentity(card.result).crestId)]);
  let instance,image;
  try{instance=new Resvg(cardSvg(card,art,crest),{font:{fontBuffers:[bytes(font)],defaultFontFamily:'Noto Sans TC'}});image=instance.render();return jpeg.encode({data:image.pixels,width:card.width,height:card.height},90).data;}
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
   await ensureCountryCodes([match[1]]);const card=cardDetails(match[1],match[2]);if(!card)return json({ok:false,error:'invalid_story'},404,headers);
   const store=cache??globalThis.caches?.default,key=new Request(card.imageUrl);
   const hit=await store?.match(key);if(hit){const res=new Response(request.method==='HEAD'?null:hit.body,{status:hit.status,headers:hit.headers});for(const[k,v]of Object.entries(headers))res.headers.set(k,v);return res;}
   if(!renderer&&!renderCard)renderer=createCardRenderer({wasmModule,loadFont:async()=>{
    const res=await env.ASSETS.fetch(new Request('https://assets.internal/fonts/NotoSansTC.ttf'));if(!res.ok)throw Error('Font unavailable');return new Uint8Array(await res.arrayBuffer());
   },loadIllustration:async name=>{const res=await env.RPG_API.fetch(new Request(`${GAME_ORIGIN}${illustrationPath(name)}`));if(!res.ok)throw Error('Illustration unavailable');return new Uint8Array(await res.arrayBuffer());},loadCrest:async id=>{const res=await env.RPG_API.fetch(new Request(`${GAME_ORIGIN}/fate/zodiac/${id}.svg`));if(!res.ok)throw Error('Crest unavailable');return res.text();}});
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
  await ensureCountryCodes([body?.code]);const card=cardDetails(body?.code,body?.format);if(!card)return json({ok:false,error:'invalid_story'},400,headers);
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
