import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const authSource=fs.readFileSync(new URL('../public/scene-live-auth.js',import.meta.url),'utf8');
const sessionSource=fs.readFileSync(new URL('../public/scene-live-session.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const wireData=new URLSearchParams({user:JSON.stringify({id:12345678,first_name:'旅人'}),hash:'server-verifies-this'}).toString();
function harness({initData=wireData,endpoint='https://game.example/app/api/',accountId='90101',parentApp=false}={}){
 const nodes=[],listeners=new Map(),events=[],calls=[];
 const element=tag=>{const e={tagName:tag,children:[],hidden:false,textContent:'',attributes:{},append(...children){this.children.push(...children);},setAttribute(k,v){this.attributes[k]=v;}};nodes.push(e);return e;};
 const body=element('body'),ui=element('div');body.append(ui);
 const document={body,createElement:element,getElementById:id=>id==='ui'?ui:null,addEventListener:(k,v)=>listeners.set(k,v),hidden:false};
 let options,snapshot=null;
 const client={request:async action=>{calls.push(action);return {characters:[]};},getSnapshot:()=>snapshot,getContext:()=>({accountId:'12345678',realmId:'permanent',characterId:null,epoch:0}),refresh:async()=>null,sync:async()=>null,start(){calls.push('start');},dispose(){calls.push('dispose');}};
 const webapp={initData,ready(){calls.push('ready');},expand(){calls.push('expand');}};
 const env={document,location:{origin:'https://game.example'},URLSearchParams,JSON,Error,Promise,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  __RpgScenePreviewConfig:{live:true,telegram:true,endpoint,accountId},RpgSceneSession:{create(o){options=o;return client;}},
  RpgSceneNavigation:{navigate(...v){calls.push(v);}},addEventListener:(k,v)=>listeners.set(k,v),dispatchEvent:e=>events.push(e)};
 env.window=env;env.parent=parentApp?{location:env.location,Telegram:{WebApp:webapp}}:env;
 if(!parentApp)env.Telegram={WebApp:webapp};
 vm.runInNewContext(authSource,env);
 return {env,ui,nodes,calls,events,listeners,client,options:()=>options,snapshot:value=>snapshot=value,panel:()=>nodes.find(e=>e.className==='scene-login-status')};
}
test('production bootstrap without Telegram data exposes no synthetic identity and cannot issue a game request',async()=>{
 const h=harness({initData:''});assert.equal(h.options(),undefined);assert.deepEqual(h.calls,[]);
 assert.equal(h.env.RpgSceneSession.getContext().accountId,'');
 await assert.rejects(h.env.RpgSceneSession.request('atlas/start'),e=>e.code==='auth_required'&&e.uncertain===false);
 let snapshot='not-called';h.env.RpgSceneSession.subscribe(value=>snapshot=value);assert.equal(snapshot,null);
 assert.equal(h.panel().hidden,false);assert.match(h.nodes.map(e=>e.textContent).join(' '),/請從 Telegram/);
});
test('a cross-origin endpoint is rejected before creating an authenticated client',()=>{
 const h=harness({endpoint:'https://another.example/app/api/'});assert.equal(h.options(),undefined);assert.deepEqual(h.calls,[]);
});
test('same-origin parent Telegram identity overrides preview account settings and stays out of rendered text',()=>{
 const h=harness({parentApp:true});const o=h.options();assert.equal(o.accountId,'12345678');assert.equal(o.realmId,'permanent');assert.equal(o.telegramInitData,wireData);
 assert.deepEqual(h.calls,['ready','expand','start']);assert.equal(h.env.Telegram.WebApp.initData,wireData);
 assert.ok(!h.nodes.some(e=>e.textContent.includes(wireData)));
 o.onSnapshot({accountId:'12345678'});assert.equal(h.panel().hidden,true);assert.equal(h.events.at(-1).type,'rpg:scene-state');
 h.listeners.get('pagehide')();assert.equal(h.calls.at(-1),'dispose');
});
test('a first-time player can open the existing character form without polling hiding that form',async()=>{
 const h=harness();h.options().onError({message:'尚未建立角色'});await tick();
 assert.equal(h.calls.filter(v=>v==='characters').length,1);
 const choose=h.nodes.find(e=>e.textContent==='建立／選擇角色');assert.equal(choose.hidden,false);choose.onclick();
 assert.equal(h.panel().hidden,true);assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),['characters',{}]);
 h.options().onError({message:'尚未建立角色'});await tick();assert.equal(h.panel().hidden,true);assert.equal(h.calls.filter(v=>v==='characters').length,1);
});
test('a network error for an already selected character retains the error instead of opening onboarding',async()=>{
 const h=harness();h.env.RpgSceneSession.request=async()=>({characters:[{active:true}]});
 h.options().onError({message:'服務暫時無法連線'});await tick();
 assert.equal(h.nodes.find(e=>e.textContent==='建立／選擇角色').hidden,true);
 assert.match(h.nodes.map(e=>e.textContent).join(' '),/服務暫時無法連線/);
});
test('expired Telegram authentication stops the session and never probes a roster with stale credentials',async()=>{
 const h=harness();h.snapshot({accountId:'12345678'});h.options().onError({status:401,message:'unauthorized'});await tick();
 assert.equal(h.calls.at(-1),'dispose');assert.ok(!h.calls.includes('characters'));
 assert.equal(h.panel().hidden,false);assert.match(h.nodes.map(e=>e.textContent).join(' '),/登入已失效/);
 assert.equal(h.nodes.find(e=>e.textContent==='重新連接').hidden,true);
});
test('signed-session requests carry Telegram credentials and never a development identity header',async()=>{
 const requests=[];const env={URLSearchParams,AbortController,Set,Promise,Error,Date,Number,String,JSON,setTimeout,clearTimeout,queueMicrotask,
  fetch:async(url,init)=>{requests.push({url,init});return {ok:true,status:200,json:async()=>({ok:true})};}};
 env.globalThis=env;vm.runInNewContext(sessionSource,env);
 const session=env.RpgSceneSession.create({endpoint:'https://game.example/app/api/',accountId:'12345678',telegramInitData:wireData});
 await session.request('characters');assert.equal(requests.length,1);
 assert.equal(requests[0].init.headers['X-Telegram-Init-Data'],wireData);assert.equal(requests[0].init.headers['X-Dev-Tg-Id'],undefined);
 await session.request('realms');assert.equal(requests.length,2,'Realm catalog must not probe a nonexistent character');assert.ok(requests[1].url.endsWith('/realms'));
 session.dispose();
});
