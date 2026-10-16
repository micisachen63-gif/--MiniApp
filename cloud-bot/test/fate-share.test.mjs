import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import jpeg from 'jpeg-js';
import {createFateShare,createCardRenderer,cardDetails,cardSvg,illustrationPath,CARD_VERSION,CARD_ORIGIN,GAME_ORIGIN} from '../src/fate-share.js';
import {encodeResult} from '../../worker/public/fate/model.js';
import {cardIdentity,cardLayout,TAIWAN_CARD_JPEG} from '../../worker/public/fate/share-card-layout.js';
import {CARD_VERSION as BROWSER_CARD_VERSION} from '../../worker/public/fate/share-model.js';
import {replayTaiwanLife} from '../../worker/public/fate/decision-engine-v8.js';
import {COUNTRY_METADATA_V9,ensureCountryPack} from '../../worker/public/fate/country-runtime-v9.js';
import {replayCountryLife} from '../../worker/public/fate/country-engine-v9.js';
const code='f43010001x9c61a7d2',now=Date.UTC(2026,9,16,4),token='123456:offline-only-test-token';
function init(user=123,at=now,secret=token){
 const params=new URLSearchParams({auth_date:String(Math.floor(at/1000)),user:JSON.stringify({id:user,first_name:'旅人'})});
 const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const key=createHmac('sha256','WebAppData').update(secret).digest();params.set('hash',createHmac('sha256',key).update(check).digest('hex'));return params.toString();
}
const request=(body={code,format:'post'},headers={})=>new Request(CARD_ORIGIN+'/fate/share/prepare',{method:'POST',headers:{Origin:GAME_ORIGIN,'content-type':'application/json','X-Telegram-Init-Data':init(),...headers},body:JSON.stringify(body)});
function taiwanCode(){const life={version:8,country:'TW',seed:'deadbeef',orbit:3,answers:[],auto:[]},run=replayTaiwanLife(life,{activeMs:7200000,autoFill:true});return encodeResult({...life,answers:run.answers,auto:run.auto,zodiac:8});}

for(const country of Object.keys(COUNTRY_METADATA_V9))test(country+' real illustrated JPEG and prepared Telegram share preserve country, sign and privacy',async()=>{
 await ensureCountryPack(country);const raw={version:9,country,seed:'deadbeef',orbit:3},run=replayCountryLife(raw),code=encodeResult({...raw,answers:run.answers,auto:run.auto,zodiac:8}),module=await WebAssembly.compile(await readFile(new URL('../src/renderer/deps/resvg.wasm',import.meta.url)));
 const render=createCardRenderer({wasmModule:module,loadFont:()=>readFile(new URL('../public/fonts/NotoSansTC.ttf',import.meta.url)),loadCrest:id=>readFile(new URL(`../../worker/public/fate/zodiac/${id}.svg`,import.meta.url),'utf8'),loadIllustration:name=>readFile(new URL(`../../worker/public${illustrationPath(name)}`,import.meta.url))});
 for(const format of ['post','story']){const card=cardDetails(code,format);assert.equal(card.illustration,'country-'+country.toLowerCase());assert.equal(card.result.zodiac,8);assert.match(card.result.identity[0],new RegExp(COUNTRY_METADATA_V9[country].cityName));const data=await render(card),pixels=jpeg.decode(data,{useTArray:true});assert.equal(pixels.width,1080);assert.equal(pixels.height,format==='story'?1920:1350);assert.ok(data.length<5_000_000);assert.ok(new Set(pixels.data.subarray(1080*200*4,1080*400*4)).size>150);}
 const calls=[],handle=createFateShare({now:()=>now,telegramFetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return Response.json({ok:true,result:{id:'isolated-'+country,expiration_date:now/1000+3600}});}}),response=await handle(request({code,format:'story',birthDate:'1900-01-01',birthTime:'12:34',birthPlace:'PRIVATE_TEST_PLACE'}),{BOT_TOKEN:token});
 assert.equal(response.status,200);assert.equal(calls.length,1);assert.match(calls[0].url,/savePreparedInlineMessage$/);assert.equal(calls[0].body.user_id,123);assert.match(calls[0].body.result.photo_url,new RegExp('/'+code+'/story.jpg'));assert.doesNotMatch(JSON.stringify(calls),/1900-01-01|12:34|PRIVATE_TEST_PLACE|sendPhoto|sendMessage/);
});
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
 const render=createCardRenderer({wasmModule:module,loadFont:()=>readFile(new URL('../public/fonts/NotoSansTC.ttf',import.meta.url)),loadCrest:id=>readFile(new URL(`../../worker/public/fate/zodiac/${id}.svg`,import.meta.url),'utf8'),loadIllustration:name=>readFile(new URL(`../../worker/public${illustrationPath(name)}`,import.meta.url))});
 let hidden;
 for(const format of ['post','story']){
  const data=await render(cardDetails(code,format));assert.ok(data.length<5_000_000);assert.equal(data[0],255);assert.equal(data[1],216);const decoded=jpeg.decode(data,{useTArray:true});assert.equal(decoded.width,1080);assert.equal(decoded.height,format==='story'?1920:1350);assert.ok(new Set(decoded.data.subarray(1080*200*4,1080*400*4)).size>150,'art is not an empty image');
  if(format==='post')hidden=decoded;
 }
 const visible=jpeg.decode(await render(cardDetails(encodeResult({...cardDetails(code).result,zodiac:10}),'post')),{useTArray:true}),seal=cardLayout('post').crest;
 let difference=0;for(let y=seal.y+80;y<seal.y+seal.size-80;y++)for(let x=seal.x+80;x<seal.x+seal.size-80;x++){const p=(y*1080+x)*4;difference+=Math.abs(visible.data[p]-hidden.data[p]);}
 assert.ok(difference>100000,'visible zodiac paints a distinct crest, not the hidden wheel');
 const variable=cardDetails('f5b101101adeadbeef','post'),variableJpeg=await render(variable),decodedVariable=jpeg.decode(variableJpeg,{useTArray:true});
 assert.equal(variable.result.version,5);assert.ok(variableJpeg.length<5_000_000);assert.equal(decodedVariable.width,1080);assert.equal(decodedVariable.height,1350);assert.ok(new Set(decodedVariable.data.subarray(1080*200*4,1080*400*4)).size>150);
 const dynamic=cardDetails('f7360000000000000000008bb8c13f5','post');assert.equal(dynamic.result.version,7);assert.match(cardIdentity(dynamic.result).identity,/男性/);const dynamicJpeg=await render(dynamic),dynamicPixels=jpeg.decode(dynamicJpeg,{useTArray:true});assert.ok(dynamicJpeg.length<5_000_000);assert.equal(dynamicPixels.width,1080);assert.equal(dynamicPixels.height,1350);
 for(const format of ['post','story']){const localized=cardDetails(taiwanCode(),format);assert.equal(localized.result.version,8);assert.equal(localized.result.country,'TW');assert.equal(localized.illustration,'taiwan-river');const data=await render(localized),pixels=jpeg.decode(data,{useTArray:true});assert.equal(pixels.width,1080);assert.equal(pixels.height,format==='story'?1920:1350);assert.ok(data.length<5_000_000);assert.ok(new Set(pixels.data.subarray(1080*200*4,1080*400*4)).size>150,'Taiwan river illustration paints nonempty artwork');}
});

test('TG card metadata retains each public zodiac and incarnation while hidden code remains anonymous',()=>{
 const base=cardDetails(code).result;
 for(let zodiac=0;zodiac<12;zodiac++){const c=cardDetails(encodeResult({...base,zodiac}));assert.equal(c.result.zodiac,zodiac);assert.equal(cardIdentity(c.result).identity,base.identity[0]);assert.equal(new URL(c.imageUrl).searchParams.get('v'),CARD_VERSION);}
 assert.equal(cardIdentity(base).hasSign,false);assert.equal(cardIdentity(base).crestId,'wheel');
});

test('Taiwan JPEG asset path is explicitly whitelisted and shares a cache revision with browser native downloads',()=>{
 assert.equal(illustrationPath('taiwan-river'),TAIWAN_CARD_JPEG);assert.equal(illustrationPath('harbor'),'/art/fate-ending-20261016/harbor.jpg');
 for(const bad of ['https://evil.invalid/river-memory.jpg','../river-memory','river-memory','taiwan-river?url=evil','../../fonts/NotoSansTC.ttf'])assert.throws(()=>illustrationPath(bad),/Invalid illustration/);
 assert.equal(CARD_VERSION,BROWSER_CARD_VERSION);assert.equal(CARD_VERSION,'20261016-countries9');
});

test('Taiwan JPEG SVG paints the same two fitted identity rows while legacy identities stay on one line',async()=>{
 const card=cardDetails(code),crest=await readFile(new URL('../../worker/public/fate/zodiac/wheel.svg',import.meta.url),'utf8'),art=new Uint8Array([255,216,255,217]),localized={...card,result:{...card.result,version:8,country:'TW',identity:['女性 · 台北市 · 設計接案工作室經營者']}};
 const svg=cardSvg(localized,art,crest);assert.match(svg,/>臺灣 · 台北市 · 女性<\/text>/);assert.match(svg,/>設計接案工作室經營者<\/text>/);assert.doesNotMatch(svg,/>女性 · 台北市 · 設計接案工作室經營者<\/text>/);assert.match(svg,/font-size="43"/);
 const legacy=cardSvg(card,art,crest);assert.ok(legacy.includes(`font-size="58" fill="#f5e5bd">${card.result.identity[0]}</text>`));
});
test('v5 variable-life JPEG routes and native preparation use the same public codec without exposing player data',async()=>{
 const code='f5b101101adeadbeef',card=cardDetails(code);assert.equal(card.result.version,5);assert.equal(card.result.code,code);assert.equal(cardIdentity(card.result).crestId,'scorpio');
 const calls=[],handle=createFateShare({now:()=>now,telegramFetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return Response.json({ok:true,result:{id:'v5-prepared',expiration_date:now/1000+3600}});},renderCard:async input=>{assert.equal(input.result.code,code);return new Uint8Array([255,216,255,217]);}});
 const photo=await handle(new Request(card.imageUrl),{});assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/jpeg');
 const prepared=await handle(request({code,format:'post',birthDate:'1900-01-01',guestAccountId:'987654321'}),{BOT_TOKEN:token});assert.equal(prepared.status,200);assert.equal(calls.length,1);assert.match(calls[0].url,/savePreparedInlineMessage$/);assert.equal(calls[0].body.user_id,123);assert.match(calls[0].body.result.photo_url,/f5b101101adeadbeef/);assert.doesNotMatch(JSON.stringify(calls[0].body),/1900-01-01|987654321/);
});

test('v7 variable-length life shares its gender, zodiac and actual ending through JPEG/native preparation without private data',async()=>{
 const code='f7360000000000000000008bb8c13f5',card=cardDetails(code);assert.equal(card.result.version,7);assert.equal(card.result.answers.length,6);assert.equal(card.result.ending.terminalOutcome,'debt-rebuilding');assert.match(card.result.identity[0],/男性/);assert.equal(cardIdentity(card.result).crestId,'virgo');
 const calls=[],handle=createFateShare({now:()=>now,telegramFetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return Response.json({ok:true,result:{id:'v7-prepared',expiration_date:now/1000+3600}});},renderCard:async input=>{assert.equal(input.result.code,code);return new Uint8Array([255,216,255,217]);}});
 assert.equal((await handle(new Request(card.imageUrl),{})).status,200);assert.equal((await handle(request({code,format:'post',birthDate:'1900-01-01',guestAccountId:'987654321'}),{BOT_TOKEN:token})).status,200);assert.equal(calls.length,1);assert.match(calls[0].url,/savePreparedInlineMessage$/);assert.match(calls[0].body.result.photo_url,/f7360000000000000000008bb8c13f5/);assert.doesNotMatch(JSON.stringify(calls[0].body),/1900-01-01|987654321/);
});

test('v8 Taiwan code uses the local JPEG route and prepared TG image without exposing private birth information',async()=>{
 const code=taiwanCode(),card=cardDetails(code);assert.match(code,/^f8tw/);assert.equal(card.result.country,'TW');assert.equal(card.illustration,'taiwan-river');assert.match(card.result.identity[0],/男性|女性/);assert.match(card.result.identity[0],/[臺台]北|新北/);
 const calls=[],handle=createFateShare({now:()=>now,telegramFetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return Response.json({ok:true,result:{id:'v8-prepared',expiration_date:now/1000+3600}});},renderCard:async input=>{assert.equal(input.illustration,'taiwan-river');return new Uint8Array([255,216,255,217]);}});
 assert.equal((await handle(new Request(card.imageUrl),{})).status,200);assert.equal((await handle(request({code,format:'post',birthDate:'1900-01-01',time:'08:35',placeId:'taipei'}),{BOT_TOKEN:token})).status,200);assert.equal(calls.length,1);assert.match(calls[0].url,/savePreparedInlineMessage$/);assert.ok(calls[0].body.result.photo_url.includes(code));assert.equal(new URL(calls[0].body.result.photo_url).searchParams.get('v'),CARD_VERSION);assert.doesNotMatch(JSON.stringify(calls[0].body),/1900-01-01|08:35|placeId/);
});
