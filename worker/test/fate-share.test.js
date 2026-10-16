import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {decodeResult,encodeResult} from '../public/fate/model.js';
import {shareDetails,telegramShareUrl,threadsShareUrl,validNative,CARD_ORIGIN} from '../public/fate/share-model.js';
import {createNativeShareHost,nativeCapabilities} from '../public/fate/native-share-host.js';
import {mountSharePanel} from '../public/fate/share-ui.js';
const code=encodeResult({version:4,orbit:3,answers:[0,1,0],auto:[0,0,1],zodiac:5,seed:'9c61a7d2'}),result=decodeResult(code),uuid='12345678-1234-1234-1234-123456789abc';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.className='';this.textContent='';this.isConnected=true;this.hidden=false;this._value=undefined;}
 set value(value){this._value=String(value);}
 get value(){return this._value??(this.tagName==='SELECT'?this.children[0]?.value:'')??'';}
 append(...items){for(const item of items){this.children.push(item);item.parent=this;}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 setAttribute(key,value){this.attributes[key]=value;}
 matches(s){return s[0]==='.'?this.className.split(' ').includes(s.slice(1)):s[0]==='#'?this.id===s.slice(1):this.tagName.toLowerCase()===s;}
 querySelectorAll(s){return this.children.flatMap(e=>[...(e.matches(s)?[e]:[]),...e.querySelectorAll(s)]);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 click(){this.clicked=true;return this.onclick?.();}
 remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
 select(){this.selected=true;}
}
function ui({draw=async()=>new Blob(['offline-image']),client,navigator={}}={}){
 const document={createElement:tag=>new Element(tag),body:new Element('body')};globalThis.document=document;
 const revoked=[],opened=[],created=[];const host={document,File,navigator:{clipboard:{writeText:async()=>{}},...navigator},URL:{createObjectURL:blob=>{created.push(blob);return 'blob:offline-'+created.length;},revokeObjectURL:url=>revoked.push(url)},open:(...args)=>{opened.push(args);return {};}},panel=new Element('section');
 const privacy=[],share=mountSharePanel(panel,{result,draw,client,host,onPrivacyChange:value=>privacy.push(value)});
 return {panel,host,share,privacy,revoked,created,opened,button:text=>panel.querySelectorAll('button').find(e=>e.textContent===text),status:()=>panel.querySelector('#fate-status').textContent};
}
test('share URLs are canonical on localhost, contain cosmetic code only, and native payloads bind action/role/UUID',()=>{
 const s=shareDetails(code);assert.match(s.url,/^https:\/\/elf-rpg-api\.micisachen\.workers\.dev\/fate\/r\//);assert.doesNotMatch(s.caption,/127\.0\.0\.1|localhost/);assert.match(s.imageUrl,/\/post\.jpg/);
 assert.equal(new URL(telegramShareUrl(code)).searchParams.get('url'),s.url);assert.equal(new URL(threadsShareUrl(code)).searchParams.get('url'),s.url);
 const m={type:'star-fate-native',id:uuid,charId:'hero-a',action:'download-image',body:{code}};assert.ok(validNative(m,'hero-a'));assert.ok(!validNative(m,'hero-b'));assert.ok(!validNative({...m,id:'injected'},'hero-a'));assert.ok(!validNative({...m,action:'sendMessage'},'hero-a'));assert.ok(!validNative({...m,body:[]},'hero-a'));
});
test('parent native bridge rejects cross-origin/wrong-window/wrong-role, never includes token in iframe context',async()=>{
 const source=readFileSync(new URL('../public/fate-entry.js',import.meta.url),'utf8'),start=source.indexOf('  const message=async e=>{'),end=source.indexOf("  window.addEventListener('message',message)",start),sent=[],calls=[];
 const child={postMessage:(value,origin)=>sent.push({value,origin})},context={location:{origin:'https://game.invalid'},frame:{contentWindow:child},pinned:'hero-a',window:{RpgFateHost:{characterId:()=>context.current,characterName:()=> '旅人'}},current:'hero-a',nativeHost:{capabilities:{telegram:true,prepared:true,download:true},act:async(...a)=>{calls.push(a);return {accepted:true};}},nativeModel:{validNative},protocol:{validRpc:()=>false,validRpcId:()=>true},exit(){}};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.receive=message;',context);
 const data={type:'star-fate-native',id:uuid,charId:'hero-a',action:'download-image',body:{code}};
 await context.receive({origin:'https://evil.invalid',source:child,data});await context.receive({origin:context.location.origin,source:{},data});await context.receive({origin:context.location.origin,source:child,data:{...data,charId:'hero-b'}});assert.equal(calls.length,0);
 await context.receive({origin:context.location.origin,source:child,data});assert.equal(calls.length,1);assert.equal(sent[0].value.value.accepted,true);assert.equal(sent[0].origin,context.location.origin);
 await context.receive({origin:context.location.origin,source:child,data:{type:'star-fate-context'}});assert.doesNotMatch(JSON.stringify(sent),/initData|BOT_TOKEN|token/i);
 context.current='hero-b';await context.receive({origin:context.location.origin,source:child,data});assert.equal(calls.length,1);
});
test('native preparation sends only code/format and initData only to trusted Bot; arbitrary and expired ids cannot share',async()=>{
 let clock=Date.now(),sdkCalls=0;const requests=[],downloads=[],tg={initData:'private-auth-value',isVersionAtLeast:()=>true,shareMessage:(id,callback)=>{sdkCalls++;callback(false);},downloadFile:(opts,cb)=>{downloads.push(opts);cb(false);}};
 const native=createNativeShareHost({tg,now:()=>clock,fetcher:async(url,opts)=>{requests.push({url,opts});return Response.json({ok:true,id:'prepared-only',expirationDate:Math.floor(clock/1000)+120,imageUrl:shareDetails(code,'post').imageUrl});}});
 await assert.rejects(native.act('share-message',{id:'arbitrary'}),/過期/);assert.equal(sdkCalls,0);
 const prepared=await native.act('prepare-share',{code,format:'post',url:'https://evil.invalid',initData:'forged'});assert.equal(requests[0].url,CARD_ORIGIN+'/fate/share/prepare');assert.equal(requests[0].opts.headers['X-Telegram-Init-Data'],tg.initData);assert.deepEqual(JSON.parse(requests[0].opts.body),{code,format:'post'});assert.doesNotMatch(JSON.stringify(prepared),/private-auth-value/);
 assert.deepEqual(await native.act('share-message',{id:prepared.id}),{sent:false,cancelled:true});clock+=121000;await assert.rejects(native.act('share-message',{id:prepared.id}),/過期/);assert.equal(sdkCalls,1);
 assert.deepEqual(await native.act('download-image',{code,format:'story',url:'https://evil.invalid'}),{accepted:false});
 assert.equal(downloads[0].url,shareDetails(code,'story').imageUrl);assert.match(downloads[0].file_name,/-story\.jpg$/);
});
test('TG7 fallback cannot prepare/download, prepare endpoint cannot substitute a foreign image, and SDK errors stay actionable',async()=>{
 const old={initData:'auth',isVersionAtLeast:()=>false,shareMessage(){throw Error('unexpected');},downloadFile(){throw Error('unexpected');}};assert.deepEqual(nativeCapabilities(old),{telegram:true,prepared:false,download:false});
 const native=createNativeShareHost({tg:old,fetcher:()=>{throw Error('unexpected fetch');}});await assert.rejects(native.act('prepare-share',{code}),/未支援/);await assert.rejects(native.act('download-image',{code}),/未支援/);
 const modern={...old,isVersionAtLeast:()=>true},bad=createNativeShareHost({tg:modern,fetcher:async()=>Response.json({ok:true,id:'bad',expirationDate:Date.now()/1000+3600,imageUrl:'https://evil.invalid/card.jpg'})});await assert.rejects(bad.act('prepare-share',{code}),/無法準備/);await assert.rejects(bad.act('share-message',{id:'bad'}),/過期/);
 const down=createNativeShareHost({tg:modern});await assert.rejects(down.act('download-image',{code}),/未能開啟下載/);
});
test('delayed old PNG is discarded after privacy/size toggles; fresh PNG alone becomes shareable',async()=>{
 let resolveOld;const draws=[],f=ui({draw:(r,size)=>{draws.push({r,size});return draws.length===1?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve(new Blob(['fresh']));}});
 const first=f.button('製作我的旅人名帖').click(),check=f.panel.querySelector('input');check.checked=false;check.onchange();assert.deepEqual(f.privacy,[false]);resolveOld(new Blob(['old']));await first;assert.equal(f.share.getFile(),null);assert.equal(f.created.length,0);
 const format=f.panel.querySelector('select');format.value='story';format.onchange();await f.button('製作我的旅人名帖').click();assert.equal(draws[1].r.zodiac,null);assert.equal(draws[1].size,'story');assert.ok(f.share.getFile());assert.match(f.share.getFile().name,/-story\.png$/);assert.equal(f.panel.querySelectorAll('img').length,1);f.share.dispose();assert.equal(f.revoked.length,1);
});
test('clipboard denial retains image and exposes manual canonical text, while unsupported IG keeps download fallback',async()=>{
 const f=ui({navigator:{clipboard:{writeText:async()=>{throw Error('denied');}},canShare:()=>false}});await f.button('製作我的旅人名帖').click();await f.button('複製文案').click();assert.equal(f.panel.querySelectorAll('img').length,1);const text=f.panel.querySelector('textarea');assert.ok(text.selected);assert.match(text.value,/https:\/\/elf-rpg-api\.micisachen\.workers\.dev\/fate\/r\//);assert.doesNotMatch(text.value,/127\.0\.0\.1/);
 await f.button('IG 分享').click();assert.match(f.status(),/未提供圖片分享選單/);assert.equal(f.panel.querySelector('a').href,'https://www.instagram.com/');assert.equal(f.panel.querySelectorAll('img').length,1);
});
test('WebShare is file-only and user-initiated, cancellation retains PNG, Threads opens a draft without posting',async()=>{
 const shared=[],f=ui({navigator:{canShare:()=>true,share:async data=>{shared.push(data);throw Object.assign(Error('cancel'),{name:'AbortError'});}}});assert.equal(shared.length,0);await f.button('製作我的旅人名帖').click();assert.equal(shared.length,0);await f.button('IG 分享').click();assert.equal(shared.length,1);assert.deepEqual(Object.keys(shared[0]).sort(),['files','title']);assert.ok(shared[0].files[0] instanceof File);assert.match(f.status(),/已取消分享/);assert.equal(f.panel.querySelectorAll('img').length,1);
 await f.button('脆草稿').click();assert.equal(f.opened.length,1);assert.match(f.opened[0][0],/^https:\/\/www\.threads\.com\/intent\/post\?/);assert.match(f.status(),/最後發佈由你決定/);
});
test('TG old-version path opens only link composer; native download error retains image and exact original link',async()=>{
 const calls=[],client={connect:async()=>({native:{telegram:true,prepared:false,download:false}}),native:async(action,body)=>{calls.push({action,body});return {opened:true};}};
 const f=ui({client});await turn();await f.button('製作我的旅人名帖').click();await f.button('TG 連結').click();assert.equal(calls.length,1);assert.equal(calls[0].action,'telegram-link');assert.match(f.status(),/尚未代你送出/);
 client.connect=async()=>({native:{telegram:true,prepared:false,download:true}});client.native=async()=>{throw Error('download failed');};const failed=ui({client});await turn();await failed.button('製作我的旅人名帖').click();await failed.button('儲存圖片').click();assert.match(failed.status(),/下載未能開啟/);assert.equal(failed.panel.querySelectorAll('img').length,1);assert.equal(failed.panel.querySelector('a').href,shareDetails(code).imageUrl);
});
test('native TG cancellations/download acceptance never claim saved album and failed prepare never claims updated',async()=>{
 let failure=false;const calls=[],client={connect:async()=>({native:{telegram:true,prepared:true,download:true}}),native:async(action,body)=>{calls.push({action,body});if(action==='prepare-share'){if(failure)throw Error('準備失敗，請重試');return {id:'offline',expirationDate:Date.now()/1000+3600};}if(action==='share-message')return {sent:false,cancelled:true};if(action==='download-image')return {accepted:true};}};
 const f=ui({client});await turn();await f.button('製作我的旅人名帖').click();await f.button('TG 圖卡').click();assert.match(f.status(),/已取消TG分享/);await f.button('儲存圖片').click();assert.match(f.status(),/已接受下載請求/);assert.match(f.status(),/不表示已存進相簿/);assert.equal(f.panel.querySelectorAll('img').length,1);
 const format=f.panel.querySelector('select');format.value='story';format.onchange();failure=true;await f.button('製作我的旅人名帖').click();await f.button('TG 圖卡').click();assert.match(f.status(),/失敗|無法|重試/);assert.doesNotMatch(f.status(),/已更新/);
});
test('result rerender restores each story privacy choice from bounded in-memory map',()=>{
 const source=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8'),line=source.split('\n').find(s=>s.includes('sharePanel=mountSharePanel(p,')),map=new Map(),mounted=[],context={p:{},result,sharePrivacy:map,client:null,mountSharePanel:(_,opts)=>{mounted.push(opts);return {};}};
 assert.match(source,/const sharePrivacy=new Map\(\)/);assert.doesNotMatch(line,/localStorage/);vm.createContext(context);vm.runInContext(line,context);assert.equal(mounted[0].initialShow,true);mounted[0].onPrivacyChange(false);vm.runInContext(line,context);assert.equal(mounted[1].initialShow,false);
 context.result=decodeResult(encodeResult({...result,seed:'deadbeef'}));vm.runInContext(line,context);assert.equal(mounted[2].initialShow,true);for(let i=0;i<70;i++){context.result={...result,code:String(i)};vm.runInContext(line,context);mounted.at(-1).onPrivacyChange(false);}assert.equal(map.size,64);
});
