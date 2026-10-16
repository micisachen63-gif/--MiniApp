import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import jpeg from 'jpeg-js';
import {createFateShare,createCardRenderer,cardDetails,CARD_ORIGIN,GAME_ORIGIN} from '../src/fate-share.js';
import {encodeResult} from '../../worker/public/fate/model.js';
import {cardIdentity,cardLayout} from '../../worker/public/fate/share-card-layout.js';
const code='f43010001x9c61a7d2',now=Date.UTC(2026,9,16,4),token='123456:offline-only-test-token';
function init(user=123,at=now,secret=token){
 const params=new URLSearchParams({auth_date:String(Math.floor(at/1000)),user:JSON.stringify({id:user,first_name:'旅人'})});
 const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const key=createHmac('sha256','WebAppData').update(secret).digest();params.set('hash',createHmac('sha256',key).update(check).digest('hex'));return params.toString();
}
const request=(body={code,format:'post'},headers={})=>new Request(CARD_ORIGIN+'/fate/share/prepare',{method:'POST',headers:{Origin:GAME_ORIGIN,'content-type':'application/json','X-Telegram-Init-Data':init(),...headers},body:JSON.stringify(body)});
test('prepared TG photo uses the HMAC account, no chat-send API and no private birth data',async()=>{
 const calls=[],handle=createFateShare({now:()=>now,telegramFetch:async(url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});return Response.json({ok:true,result:{id:'offline-prepared',expiration_date:now/1000+3600}});}});
 const r=await handle(request({code,format:'story',tgId:999,birthDate:'1900-01-01'}),{BOT_TOKEN:token}),out=await r.json();
 assert.equal(r.status,200);assert.equal(out.id,'offline-prepared');assert.equal(calls.length,1);assert.match(calls[0].url,/\/savePreparedInlineMessage$/);
 const b=calls[0].body;assert.equal(b.user_id,123);assert.equal(b.result.type,'photo');assert.equal(b.result.photo_height,1920);assert.match(b.result.photo_url,/\/story\.jpg/);assert.equal(b.allow_group_chats,true);assert.equal(b.result.reply_markup.inline_keyboard.length,2);assert.ok(calls[0].opts.signal instanceof AbortSignal);assert.doesNotMatch(JSON.stringify(b),/1900-01-01|tgId/);assert.equal(r.headers.get('access-control-allow-origin'),GAME_ORIGIN);
 assert.equal((await handle(request({code,format:'story'}),{BOT_TOKEN:token})).status,200);assert.equal(calls.length,1,'duplicate preparations reuse an unexpired id');
 await handle(request({code,format:'post'},{'X-Telegram-Init-Data':init(456)}),{BOT_TOKEN:token});assert.equal(calls[1].body.user_id,456,'prepared ids never cross accounts');
});
test('preparation rejects forged/stale/future HMAC, wrong origin, invalid story/format without Telegram calls',async()=>{
 let n=0;const handle=createFateShare({now:()=>now,telegramFetch:async()=>{n++;throw Error('not reached');}}),env={BOT_TOKEN:token};
 for(const data of [init(1,now,'wrong'),init(1,now-86401e3),init(1,now+301e3),'garbage'])assert.equal((await handle(request(undefined,{'X-Telegram-Init-Data':data}),env)).status,401);
 assert.equal((await handle(request(undefined,{Origin:'https://evil.invalid'}),env)).status,403);
 for(const body of [{code:'<script>',format:'post'},{code,format:'huge'}])assert.equal((await handle(request(body),env)).status,400);
 assert.equal((await handle(request({code,format:'post',large:'字'.repeat(1500)}),env)).status,413,'streamed UTF-8 body is bounded in bytes without trusting Content-Length');
 assert.equal((await handle(request(),{})).status,503);assert.equal(n,0);
});
test('TG errors and network failures are sanitized; only prepare is ever called',async()=>{
 for(const telegramFetch of [async()=>{throw Error(token);},async()=>Response.json({ok:false,description:token},{status:429}),async()=>new Response(token)]){
  const handle=createFateShare({now:()=>now,telegramFetch}),r=await handle(request(),{BOT_TOKEN:token}),body=await r.text();assert.ok([429,502].includes(r.status));assert.ok(!body.includes(token));
 }
});
test('JPEG GET/HEAD/OPTIONS expose download headers, deterministic cache and strict formats',async()=>{
 let renders=0;const map=new Map(),cache={match:async r=>map.get(r.url)?.clone(),put:async(r,res)=>{map.set(r.url,res.clone());}};
 const handle=createFateShare({cache,renderCard:async()=>{renders++;return new Uint8Array([255,216,255,217]);}}),path=CARD_ORIGIN+`/fate-card/${code}/post.jpg`;
 const first=await handle(new Request(path,{headers:{Origin:GAME_ORIGIN}}),{});assert.equal(first.status,200);assert.equal(first.headers.get('content-type'),'image/jpeg');assert.match(first.headers.get('content-disposition'),/attachment; filename="star-journal-/);assert.equal(first.headers.get('access-control-allow-origin'),GAME_ORIGIN);
 const second=await handle(new Request(path,{headers:{Origin:'https://web.telegram.org'}}),{});assert.equal(second.headers.get('access-control-allow-origin'),'https://web.telegram.org');assert.equal(renders,1);
 const head=await handle(new Request(path,{method:'HEAD'}),{});assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(head.headers.get('content-length'),'4');assert.equal(head.headers.get('access-control-allow-origin'),null);
 const options=await handle(new Request(path,{method:'OPTIONS',headers:{Origin:'https://web.telegram.org'}}),{});assert.equal(options.status,204);
 assert.equal((await handle(new Request(path,{method:'POST'}),{})).status,405);
 assert.equal((await handle(new Request(path.replace(code,'bad')),{})).status,404);
 assert.equal(await handle(new Request(CARD_ORIGIN+'/unrelated'),{}),null);
 assert.equal(cardDetails(code,'gigantic'),null);
});
test('actual shared WASM renderer produces decodable 1080px JPEG for both formats under Telegram limit',async()=>{
 const module=await WebAssembly.compile(await readFile(new URL('../src/renderer/deps/resvg.wasm',import.meta.url)));
 const render=createCardRenderer({wasmModule:module,loadFont:()=>readFile(new URL('../public/fonts/NotoSansTC.ttf',import.meta.url)),loadCrest:id=>readFile(new URL(`../../worker/public/fate/zodiac/${id}.svg`,import.meta.url),'utf8'),loadIllustration:name=>readFile(new URL(`../../worker/public/art/fate-ending-20261016/${name}.jpg`,import.meta.url))});
 let hidden;
 for(const format of ['post','story']){
  const data=await render(cardDetails(code,format));assert.ok(data.length<5_000_000);assert.equal(data[0],255);assert.equal(data[1],216);const decoded=jpeg.decode(data,{useTArray:true});assert.equal(decoded.width,1080);assert.equal(decoded.height,format==='story'?1920:1350);assert.ok(new Set(decoded.data.subarray(1080*200*4,1080*400*4)).size>150,'art is not an empty image');
  if(format==='post')hidden=decoded;
 }
 const visible=jpeg.decode(await render(cardDetails(encodeResult({...cardDetails(code).result,zodiac:10}),'post')),{useTArray:true}),seal=cardLayout('post').crest;
 let difference=0;for(let y=seal.y+80;y<seal.y+seal.size-80;y++)for(let x=seal.x+80;x<seal.x+seal.size-80;x++){const p=(y*1080+x)*4;difference+=Math.abs(visible.data[p]-hidden.data[p]);}
 assert.ok(difference>100000,'visible zodiac paints a distinct crest, not the hidden wheel');
});

test('TG card metadata retains each public zodiac and incarnation while hidden code remains anonymous',()=>{
 const base=cardDetails(code).result;
 for(let zodiac=0;zodiac<12;zodiac++){const c=cardDetails(encodeResult({...base,zodiac}));assert.equal(c.result.zodiac,zodiac);assert.equal(cardIdentity(c.result).identity,base.identity[0]);assert.match(c.imageUrl,/20261016-zodiac2/);}
 assert.equal(cardIdentity(base).hasSign,false);assert.equal(cardIdentity(base).crestId,'wheel');
});
