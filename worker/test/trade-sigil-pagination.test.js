import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import {handle} from '../src/index.js';
import * as P from '../src/services/player.js';
import * as G from '../src/services/guardian-sigil.js';
import * as T from '../src/services/trade.js';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('  function tradeSigilSheet('),app.indexOf('  function bindPk('));
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const tick=()=>new Promise(r=>setImmediate(r));
const page=(items,nextCursor=null)=>({state:{inventory:{items,nextCursor}}});
const feather=(id,extra={})=>({id,quality:'white',type:'melee',...extra});
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};

// The production sheet card stays connected when closed or reused. Model that
// explicitly; a simple isConnected stub would miss late-response contamination.
function ui(api,initialTrade={id:'trade-a',status:'open'}){
 const S={me:{character:{tgId:'111'}},apiEpoch:0,trade:initialTrade};
 const host={hidden:true},mutations=[];let panel,close,html='';
 const card={isConnected:true,querySelector:key=>key==='[data-x]'?close:key==='[data-guardian-trade-picker]'?panel:null};
 const node=()=>({isConnected:true,hidden:false,disabled:false,textContent:'',setAttribute(k,v){this[k]=v;}});
 const ctx=vm.createContext({S,api,esc,tradeSelection:0,guardianTradeIcon:()=>'<img alt="羽毛">',window:{RpgGuardianContract:{QUALITY_NAMES:{white:'白'},TYPE_NAMES:{melee:'近戰'}}},
  $:()=>host,tradeCall:async(action,body)=>{mutations.push({action,body});},
  closeSheet(){host.hidden=true;},sheet(markup){
   if(panel){panel.isConnected=false;panel.list.isConnected=false;}
   html=markup;host.hidden=false;close=node();const list=node();list.buttons=[];list.html='';
   list.insertAdjacentHTML=(_where,markup)=>{list.html+=markup;for(const match of markup.matchAll(/data-guardian-trade="([^"]*)"/g))list.buttons.push({dataset:{guardianTrade:match[1]}});};
   list.querySelectorAll=()=>list.buttons;
   const status=node(),more=node();panel={...node(),list,status,more,querySelector:key=>({'[data-guardian-trade-list]':list,'[data-guardian-trade-status]':status,'[data-guardian-trade-more]':more})[key]};return card;
  }
 });
 vm.runInContext(source,ctx);
 return {S,ctx,host,mutations,get panel(){return panel;},get html(){return html;},open(){ctx.tradeAddSheet('sigil');},close(){close.onclick();},more:()=>panel.more.onclick(),reuse(){ctx.sheet('<h2>其他視窗</h2>');}};
}

const now=Date.parse('2026-10-19T08:00:00Z');
async function fixture(t,n,protectedFront=false){
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};t.after(()=>env.DB.sqlite.close());
 for(const tgId of ['111','222'])await P.createCharacter(env,{tgId,name:'羽毛分頁'+tgId,baseClass:'sword',gender:'m'},now);
 await env.DB.prepare('UPDATE rpg_characters SET level=35').run();
 await G.ensureWelcome(env,'111',now);
 await env.DB.prepare("INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES('page-seed','111','111','page-seed','summon',?,'fixture','{}','{}',?)").bind('0'.repeat(64),now).run();
 for(let i=1;i<=n;i++)await G.insertSigil(env.DB,{id:'page-'+String(i).padStart(3,'0'),char_id:'111',type:'melee',quality:1,bound:protectedFront&&i<=40?1:0,source_operation_id:'page-seed',created_at:now}).run();
 const opened=await T.openTradeStmts(env,{aTg:'111',bTg:'222'},now);await env.DB.batch(opened.stmts);
 const trade=await T.tradeView(env,opened.id,'111',now),calls=[];
 const api=async(action,body={})=>{
  calls.push({action,body:JSON.parse(JSON.stringify(body))});
  const response=await handle(new CurrentClientRequest('http://local/app/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'111','X-Debug-Now':String(now)},body:JSON.stringify(body)}),env),json=await response.json();
  assert.equal(response.status,200,JSON.stringify(json));return json;
 };
 return {env,trade,calls,api};
}
for(const n of [41,80,81])test(`real inventory API exposes all ${n} feathers on explicit pages, then the last can enter escrow`,async t=>{
 const f=await fixture(t,n),u=ui(f.api,f.trade);u.open();await tick();
 assert.equal(f.calls.length,1);assert.equal(u.panel.list.buttons.length,40);assert.equal(u.panel.more.hidden,false);
 const first=u.panel.list.buttons[0];
 while(!u.panel.more.hidden)await u.more();
 assert.equal(u.panel.list.buttons[0],first,'appending retains existing DOM items');
 assert.equal(u.panel.list.buttons.length,n);assert.equal(new Set(u.panel.list.buttons.map(b=>b.dataset.guardianTrade)).size,n);
 assert.deepEqual(f.calls.map(c=>c.body),Array.from({length:Math.ceil(n/40)},(_,i)=>i?{cursor:'page-'+String(i*40).padStart(3,'0')}:{}));
 assert.equal(u.mutations.length,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM rpg_trade_items').first()).n,0);
 u.panel.list.buttons.at(-1).onclick();assert.equal(u.mutations.length,1);
 const {body}=u.mutations[0];await f.api('trade/add',{...body,requestId:crypto.randomUUID()});
 assert.equal((await f.env.DB.prepare('SELECT trade_id FROM rpg_guardian_sigils WHERE id=?').bind(body.sigilId).first()).trade_id,f.trade.id);
});
test('a protected first page does not hide the eligible 41st feather or claim the whole inventory is empty',async t=>{
 const f=await fixture(t,41,true),u=ui(f.api,f.trade);u.open();await tick();assert.equal(u.panel.list.buttons.length,0);
 assert.match(u.panel.status.textContent,/載入更多/);assert.doesNotMatch(u.panel.status.textContent,/沒有可交易羽毛：/);
 await u.more();assert.equal(u.panel.list.buttons.length,1);assert.equal(u.panel.list.buttons[0].dataset.guardianTrade,'page-041');
});
test('all protections and HTML escaping remain; duplicate pages cannot duplicate entries',async()=>{
 let count=0;const id='safe&lt;';const u=ui(async()=>++count===1?page([feather(id),...['bound','active','locked','inTrade'].map(key=>feather(key,{[key]:true}))],'cursor'):page([feather(id),feather('next')]));
 u.open();await tick();assert.equal(u.panel.list.buttons.length,1);assert.match(u.panel.list.html,/safe&amp;lt;/);await u.more();assert.equal(u.panel.list.buttons.length,2);
});
for(const first of [true,false])test(`failed ${first?'initial':'next'} page retries its original cursor without clearing loaded items or submitting`,async()=>{
 const calls=[];let fail=true;const u=ui(async(_action,body)=>{calls.push(JSON.parse(JSON.stringify(body)));if((first||body.cursor)&&fail){fail=false;throw Error('暫時斷線');}return body.cursor?page([feather('last')]):page([feather('first')],'next');});
 u.open();await tick();if(!first)await u.more();assert.equal(u.panel.status.role,'alert');assert.equal(u.panel.more.disabled,false);assert.equal(u.panel.more.textContent,'重試載入');
 const existing=u.panel.list.buttons[0];await u.more();assert.equal(u.mutations.length,0);
 if(first){assert.deepEqual(calls,[{},{ }]);assert.equal(u.panel.list.buttons.length,1);}else{assert.deepEqual(calls,[{},{cursor:'next'},{cursor:'next'}]);assert.equal(u.panel.list.buttons[0],existing);assert.equal(u.panel.list.buttons.length,2);}
});
test('double tapping more issues one page read; existing choices remain usable while it is pending',async()=>{
 const wait=deferred();let calls=0;const u=ui(async()=>++calls===1?page([feather('first')],'next'):wait.promise);u.open();await tick();
 const pending=u.more();await u.more();assert.equal(calls,2);assert.equal(u.panel.more.disabled,true);
 u.panel.list.buttons[0].onclick();assert.equal(u.mutations.length,1);assert.equal(u.host.hidden,true);wait.resolve(page([feather('late')]));await pending;assert.equal(u.panel.list.buttons.length,1);
});
for(const change of ['character','epoch','trade','selection','close','reuse','completed'])for(const failure of [false,true])test(`late page ${failure?'failure':'success'} and old buttons are ignored after ${change}`,async()=>{
 const wait=deferred();let calls=0;const u=ui(async()=>++calls===1?page([feather('first')],'next'):wait.promise);u.open();await tick();
 const old=u.panel,button=old.list.buttons[0],pending=u.more();
 if(change==='character')u.S.me.character.tgId='222';else if(change==='epoch')u.S.apiEpoch++;else if(change==='trade')u.S.trade={id:'trade-b',status:'open'};else if(change==='selection')u.ctx.tradeSelection++;else if(change==='close')u.close();else if(change==='completed')u.S.trade.status='done';else u.reuse();
 const snapshot=JSON.stringify({status:old.status.textContent,items:old.list.html,newStatus:u.panel.status.textContent});
 if(failure)wait.reject(Error('stale error'));else wait.resolve(page([feather('stale')]));await pending;
 assert.equal(JSON.stringify({status:old.status.textContent,items:old.list.html,newStatus:u.panel.status.textContent}),snapshot);button.onclick();assert.equal(u.mutations.length,0);await old.more.onclick();assert.equal(calls,2);
});
