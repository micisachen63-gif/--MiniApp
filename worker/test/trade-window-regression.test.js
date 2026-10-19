import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {freshDb} from './d1-shim.js';
import {CurrentClientRequest} from './client-request.js';
import * as P from '../src/services/player.js';
import * as T from '../src/services/trade.js';
import {handle} from '../src/index.js';
import {loadPlayer} from '../src/db.js';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const now=Date.parse('2026-10-19T00:00:00Z');
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function fixture(t){
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};t.after(()=>env.DB.sqlite.close());
 for(const tgId of ['111','222'])await P.createCharacter(env,{tgId,name:'交易旅人'+tgId,gender:'m',baseClass:'sword'},now);
 const gear=(await loadPlayer(env.DB,'111')).equipment.find(e=>e.slot==='weapon');
 const lines=[{key:'meleePct',score:96,value:.0423},{key:'critPct',score:87,value:.0212},{key:'lifestealPct',score:75,value:.0111}];
 await env.DB.prepare('UPDATE rpg_equipment SET bound=0,is_equipped=0,tier=6,enhance_level=7,grade=?,affix_json=?,affixes_json=?,bonus_json=? WHERE id=?').bind('relic',JSON.stringify({atkPct:.07,maxHpPct:.06}),JSON.stringify(lines),JSON.stringify({hp:100}),gear.id).run();
 let seq=0;const calls=[];
 const api=async(action,body={},who='111')=>{calls.push(action);const response=await handle(new CurrentClientRequest('http://local/app/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':who,'X-Debug-Now':String(now)},body:JSON.stringify({requestId:'trade-regression-'+(++seq),...body})}),env);const j=await response.json();if(!response.ok)throw Object.assign(Error(j.message||j.error),{code:j.error,status:response.status});return j;};
 return {env,gear,api,calls};
}
function ui(api){
 const S={tab:'bag',social:'trade',apiEpoch:0,meta:{},me:{character:{tgId:'111'}}};let shown='',sheetNode=null,rendered='',closed=0;const messages=[];
 const ctx=vm.createContext({S,api,crypto,esc,fmt:x=>Number(x||0).toLocaleString('en-US'),fmtBonus:(k,v)=>`${k} +${v*100}%`,gearIcon:()=>'<img>',iconHtml:()=>'',SLOT_EMOJI:{},sNow:()=>now,mmss:()=>'',window:{},
  $:()=>({hidden:true}),haptic(){},refreshMe(){},toast:msg=>messages.push(msg),loadTradeLog(){},
  render(){rendered=S.trade?ctx.tradeWindowHtml(S.trade):'交易清單';},
  closeSheet(){closed++;},sheet(html){shown=html;const nodes={'[data-x]':{},'[data-go]':{disabled:false},'#gear-trade-name':{value:'交易旅人222'}};sheetNode={querySelector:s=>nodes[s]};return sheetNode;}
 });
 const pieces=[app.slice(app.indexOf('  const TSTATUS'),app.indexOf('  function reqItemHtml')),app.slice(app.indexOf('  let tradeListFlight='),app.indexOf('  function hallPortrait')),app.slice(app.indexOf('  function tradeGear(e)'),app.indexOf('  async function shareItem'))];
 vm.runInContext(pieces.join('\n')+';this.start=tradeGear;this.select=selectTrade;this.poll=loadTrade;',ctx);
 return {S,ctx,get rendered(){return rendered},get shown(){return shown},get messages(){return messages},get closed(){return closed},start:e=>ctx.start(e),submit:()=>sheetNode.querySelector('[data-go]').onclick()};
}
test('backpack creates real escrow then opens its new window and renders every affix; polling never selects another trade',async t=>{
 const f=await fixture(t),u=ui(f.api);u.start({id:f.gear.id,name:f.gear.name});await u.submit();
 assert.ok(u.S.trade?.id);assert.equal(u.S.tab,'trade');assert.equal(u.closed,1);assert.deepEqual(f.calls.slice(0,2),['trade/open','trade/get']);
 assert.match(u.rendered,/與 交易旅人222 交易/);for(const text of ['近戰傷害 +4.23%','爆擊機率 +2.12%','攻擊吸血 +1.11%','SS','遺物能力','裝備加成'])assert.ok(u.rendered.includes(text),text);
 const row=await f.env.DB.prepare('SELECT trade_id FROM rpg_equipment WHERE id=?').bind(f.gear.id).first();assert.equal(row.trade_id,u.S.trade.id);
 const count=f.calls.length;await u.ctx.poll('another-trade');assert.equal(f.calls.length,count);assert.equal(u.S.trade.id,row.trade_id);
});
test('both sides and history retain identical affixes through locks, final confirmation and escrow fallback',async t=>{
 const f=await fixture(t),u=ui(f.api);u.start({id:f.gear.id,name:f.gear.name});await u.submit();const id=u.S.trade.id;
 const original=u.S.trade.a.lines[0];assert.equal(original.affixes.lines.length,3);
 for(const who of ['111','222'])await f.api('trade/lock',{tradeId:id},who);
 for(const who of ['111','222']){
  const j=await f.api('trade/get',{tradeId:id},who);assert.deepEqual(j.trade.a.lines[0],original);
  const mine=who==='111'?j.trade.a:j.trade.b,theirs=who==='111'?j.trade.b:j.trade.a;
  const confirmation=u.ctx.tradeConfirmSideHtml(mine)+u.ctx.tradeConfirmSideHtml(theirs);
  for(const text of ['近戰傷害 +4.23%','爆擊機率 +2.12%','攻擊吸血 +1.11%'])assert.ok(confirmation.includes(text));
  await f.api('trade/confirm',{tradeId:id,offerRev:j.trade.offerRev},who);
 }
 assert.equal((await loadPlayer(f.env.DB,'222')).equipment.find(e=>e.id===f.gear.id).enhance_level,7);
 const done=await T.tradeView(f.env,id,'111',now);assert.equal(done.status,'done');assert.deepEqual(done.a.lines[0],original);
 await f.env.DB.prepare('UPDATE rpg_equipment SET enhance_level=8,affixes_json=? WHERE id=?').bind('[]',f.gear.id).run();assert.deepEqual((await T.tradeView(f.env,id,'111',now)).a.lines[0],original);
 // A subsequently sold item still has its immutable escrow snapshot in history.
 await f.env.DB.prepare('DELETE FROM rpg_equipment WHERE id=?').bind(f.gear.id).run();assert.deepEqual((await T.tradeView(f.env,id,'222',now)).a.lines[0],original);
});
test('failed new-window read keeps the created escrow accessible from the trade list',async t=>{
 const f=await fixture(t),u=ui((action,body)=>action==='trade/get'?Promise.reject(Error('暫時無法讀取')):f.api(action,body));u.start({id:f.gear.id,name:f.gear.name});await u.submit();
 assert.equal(u.S.trade,null);assert.equal(u.S.trades.open.length,1);assert.equal(u.messages.at(-1),'交易已建立，可從交易清單重新開啟');assert.ok(!u.messages.includes('已建立交易，裝備已放入'));
});
test('changing characters while trade creation is pending cannot select it in the new character',async t=>{
 const f=await fixture(t);let resolve;const u=ui(async(a,b)=>{const j=await f.api(a,b);if(a==='trade/open')await new Promise(r=>resolve=r);return j;});u.start({id:f.gear.id,name:f.gear.name});const p=u.submit();while(!resolve)await new Promise(r=>setImmediate(r));u.S.me.character.tgId='222';resolve();await p;assert.equal(u.S.trade,undefined);assert.ok(!f.calls.includes('trade/get'));
});
test('equipment details escape player-controlled text and handle unappraised or non-equipment items',()=>{
 const u=ui(()=>{}),html=u.ctx.tradeGearDetailsHtml({kind:'equip',name:'<img onerror="bad">',slotName:'武器',affix:{'<script>':.1},affixes:{slots:3,lines:[]}});
 assert.ok(!html.includes('<img onerror'));assert.ok(!html.includes('<script>'));assert.match(html,/尚無重鑄詞條/);assert.match(html,/0\/3/);assert.equal(u.ctx.tradeGearDetailsHtml({kind:'item'}),'');
});
