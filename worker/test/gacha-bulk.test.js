import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {freshDb} from './d1-shim.js';import {CurrentClientRequest} from './client-request.js';import {handle} from '../src/index.js';import * as P from '../src/services/player.js';
const now=Date.parse('2026-10-19T00:00:00Z');
async function fixture(t){const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};t.after(()=>env.DB.sqlite.close());await P.createCharacter(env,{tgId:'111',name:'複數轉蛋',gender:'m',baseClass:'sword'},now);env.DB.sqlite.prepare("UPDATE rpg_characters SET gold=100000000 WHERE tg_id='111'").run();return {env,db:env.DB.sqlite,call:async body=>{const r=await handle(new CurrentClientRequest('https://local/app/api/gacha',{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':'111','X-Debug-Now':String(now)},body:JSON.stringify({requestId:crypto.randomUUID(),...body})}),env);return {status:r.status,j:await r.json()};}};}
for(const type of ['weapon','armor'])test(`${type}: bulk purchase has exact price, inventory and ledger and replays cannot double charge`,async t=>{
 const f=await fixture(t),unit=type==='weapon'?10000:5000,key='gacha_'+type,requestId=crypto.randomUUID();
 const r=await f.call({type,qty:10,requestId});assert.equal(r.status,200,JSON.stringify(r.j));assert.equal(r.j.character.gold,100000000-unit*10);assert.equal(r.j.inventory[key],10);assert.equal(r.j.equipment.length,2);assert.deepEqual(r.j.result,{itemKey:key,price:unit,total:unit*10,type,quantity:10});
 assert.equal((await f.call({type,qty:10,requestId})).j.error,'duplicate');
 const l=f.db.prepare("SELECT gold_delta,item_delta FROM rpg_ledger WHERE type='購買轉蛋'").all();assert.deepEqual(l.map(x=>({...x})),[{gold_delta:-unit*10,item_delta:10}]);
 const old=await f.call({type});assert.equal(old.j.result.quantity,1);assert.equal(old.j.inventory[key],11);
});
test('bulk quantity rejects invalid inputs and insufficient funds without losing gold or issuing partial capsules',async t=>{
 const f=await fixture(t);for(const qty of [0,-1,1.5,10000,'10',true,null]){const r=await f.call({type:'weapon',qty});assert.equal(r.j.error,'qty');}
 f.db.prepare("UPDATE rpg_characters SET gold=99999 WHERE tg_id='111'").run();const r=await f.call({type:'weapon',qty:10});assert.equal(r.j.error,'gold');assert.equal(f.db.prepare("SELECT gold FROM rpg_characters WHERE tg_id='111'").get().gold,99999);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_inventory WHERE item='gacha_weapon'").get().n,0);
});
test('maximum bulk request and concurrent purchases cannot overspend or overwrite capsule counts',async t=>{
 const f=await fixture(t);const r=await f.call({type:'weapon',qty:9999});assert.equal(r.j.inventory.gacha_weapon,9999);assert.equal(r.j.character.gold,10000);
 const both=await Promise.all([f.call({type:'weapon',qty:1}),f.call({type:'weapon',qty:1})]);assert.equal(both.filter(r=>r.j.ok).length,1);assert.equal(f.db.prepare("SELECT gold FROM rpg_characters WHERE tg_id='111'").get().gold,0);assert.equal(f.db.prepare("SELECT quantity FROM rpg_inventory WHERE item='gacha_weapon'").get().quantity,10000);
});
function ui(act){
 const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),nodes=Object.fromEntries(['qty','buy','cancel','total'].map(k=>['[data-gacha-'+k+']',{value:k==='qty'?'1':'',textContent:'',disabled:false}])),buttons=[1,10,100,'max'].map(x=>({dataset:{gachaCount:String(x)}}));let closed=0;const messages=[],S={me:{character:{tgId:'111',gold:250000}},shop:{gacha:[{type:'weapon',name:'武器轉蛋',price:10000}]}};
 const ctx=vm.createContext({S,act,esc:x=>x,fmt:x=>Number(x).toLocaleString('en-US'),toast:m=>messages.push(m),closeSheet:()=>closed++,sheet:()=>({querySelector:q=>nodes[q],querySelectorAll:()=>buttons})});vm.runInContext(code.slice(code.indexOf('  function openGachaPurchase('),code.indexOf('  function bindShop('))+';this.open=openGachaPurchase;',ctx);ctx.open('weapon');return {S,nodes,buttons,messages,get closed(){return closed}};
}
test('quantity UI previews exact total, validates and submits the selected count through the real Mini App API',async t=>{
 const f=await fixture(t);let calls=0;const h=ui(async(action,b)=>{assert.equal(action,'gacha');calls++;const r=await f.call(b);return r.j;});h.buttons[1].onclick();assert.match(h.nodes['[data-gacha-total]'].textContent,/10 顆.*100,000/);await h.nodes['[data-gacha-buy]'].onclick();assert.equal(calls,1);assert.equal(h.closed,1);assert.equal(f.db.prepare("SELECT quantity FROM rpg_inventory WHERE item='gacha_weapon'").get().quantity,10);
});
test('quantity sheet cancels cleanly, blocks invalid totals, and cannot submit twice or after a character switch',async()=>{
 let calls=0,resolve;const h=ui(async()=>{calls++;return new Promise(r=>resolve=r);}),q=h.nodes['[data-gacha-qty]'],buy=h.nodes['[data-gacha-buy]'];
 for(const value of ['','0','1.5','26']){q.value=value;q.oninput();assert.equal(buy.disabled,true);await buy.onclick();}assert.equal(calls,0);
 h.buttons[3].onclick();assert.equal(q.value,'25');assert.match(h.nodes['[data-gacha-total]'].textContent,/250,000/);const p=buy.onclick();await buy.onclick();assert.equal(calls,1);resolve({result:{quantity:25}});await p;
 const switched=ui(async()=>{calls++;});switched.S.me.character.tgId='222';await switched.nodes['[data-gacha-buy]'].onclick();assert.equal(calls,1);
 const cancelled=ui(async()=>{calls++;});cancelled.nodes['[data-gacha-cancel]'].onclick();assert.equal(cancelled.closed,1);assert.equal(calls,1);
});
