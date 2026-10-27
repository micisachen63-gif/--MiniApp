import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mkChar,starterGear,T0} from './helpers.js';
import {playerView,shopView} from '../src/views.js';
import {metaView} from '../src/app.js';
import * as P from '../src/services/player.js';
import {freshDb} from './d1-shim.js';
import {spawnDue} from '../src/services/boss.js';
import {handle} from '../src/index.js';
import {CurrentClientRequest} from './client-request.js';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const range=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function fixture({gold=10000,inv={},party=null}={}) {
  const char=mkChar({level:40,class_path:'A',gold,party_id:party}),equipment=starterGear(char,2);
  const me=playerView({char,inv,equipment},{now:T0});me.daily.claimed=true;me.refill.cost=0;
  const S={me,tab:'home',apiEpoch:0,shop:null,boss:null,bossPersonalActor:null,backgroundJobs:[],pending:null};
  const messages=[],opened=[],actions=[],rows=[],ctx=vm.createContext({S,fmt:String,esc:String,sNow:()=>T0,shopForActor:String(char.tg_id),
    toast:m=>messages.push(m),haptic(){},render(){},$:(s)=>({hidden:true}),
    itemEmoji:String,itemName:String,loadShop:async()=>{},api:async()=>({shop:shopView(char)}),absorb:j=>{if(j.shop)S.shop=j.shop;},
    refreshMe:async()=>({ok:true}),act:async(a)=>actions.push(a),itemSheet:id=>opened.push(id)});
  S.meta=metaView();
  vm.runInContext(range('  function advancementReady(','  function renderHud(')+range('  const RAR_ORDER =','  function commandIcon(')+range('  function bindTodo(','  /** coins fly'),ctx);
  const board=()=>ctx.todoList(),has=b=>board().some(n=>n.b===b);
  function bind(){rows.splice(0);for(const [i,t]of board().entries())rows.push({dataset:{todo:String(i)},t,querySelector:()=>({disabled:false,isConnected:true})});ctx.bindTodo({querySelectorAll:()=>rows});return rows;}
  return {S,ctx,char,equipment,inv,board,has,bind,rows,messages,opened,actions,work:()=>structuredClone({char,inv,equipment})};
}

test('enhance suggestions pay for exactly the missing tier scrolls, and the shown operation succeeds under the real rule',()=>{
  for(const [gold,scrolls,expected]of [[149,0,false],[150,0,true],[74,1,false],[75,1,true],[0,2,true]]) {
    const f=fixture({gold,inv:{scroll_w:scrolls}});f.S.me.equipment=f.S.me.equipment.filter(e=>e.slot==='weapon');
    assert.equal(f.has('強化'),expected,JSON.stringify({gold,scrolls}));
    if(expected){const before=f.work(),r=P.doEnhance(before,{now:T0},{itemId:'w1',requestId:'one'},()=>0);assert.equal(r.result.result,'success');assert.equal(before.char.gold,gold-Math.max(0,2-scrolls)*75);}
  }
});
test('reroll suggestions include labor even with all scrolls, and missing-scroll purchase plus fee matches the real debit',()=>{
  for(const [gold,scrolls,expected]of [[59,2,false],[60,2,true],[119,1,false],[120,1,true],[179,0,false],[180,0,true]]) {
    const f=fixture({gold,inv:{scroll_r:scrolls}});f.S.me.equipment=f.S.me.equipment.filter(e=>e.slot==='weapon');
    assert.equal(f.has('洗'),expected,JSON.stringify({gold,scrolls}));
    if(expected){const w=f.work(),r=P.doReroll(w,{now:T0},{itemId:'w1',requestId:'one'},()=>.5);assert.equal(w.char.gold,gold-60-Math.max(0,2-scrolls)*60);assert.equal(r.result.goldCost,60+Math.max(0,2-scrolls)*60);assert.match(f.board().find(n=>n.b==='洗').s,/工費/);}
  }
});
test('equipped gear in any party, escrow, or an own-character background job cannot be recommended; other-character jobs do not block',()=>{
  for(const party of ['ring:running','short:combat','short:lobby']){const f=fixture({party});assert.equal(f.has('強化'),false);assert.equal(f.has('洗'),false);}
  for(const kind of ['auto_enhance_end','auto_reroll_end']){
    const f=fixture();f.S.me.equipment=f.S.me.equipment.slice(0,1);const item=f.S.me.equipment[0];
    item.inTrade='escrow';assert.equal(f.has('強化'),false);assert.equal(f.has('洗'),false);item.inTrade=null;
    f.S.backgroundJobs=[{kind,job:{characterId:'111',itemId:item.id,status:'running'}}];assert.equal(f.has('強化'),false);assert.equal(f.has('洗'),false);
    f.S.backgroundJobs[0].job.characterId='other';assert.equal(f.has('強化'),true);assert.equal(f.has('洗'),true);
    f.S.backgroundJobs[0].job.characterId='111';f.S.backgroundJobs[0].job.status='ended';assert.equal(f.has('強化'),true);
  }
});
test('reroll uses affix quality, can address +15 gear and never promises a rarity upgrade',()=>{
  const f=fixture();f.S.me.equipment=f.S.me.equipment.slice(0,1);const e=f.S.me.equipment[0];e.rarity='supreme';e.enhance=15;e.enhanceNext=null;
  assert.equal(f.has('強化'),false);assert.equal(f.has('洗'),true);assert.doesNotMatch(f.board().find(n=>n.b==='洗').s,/極品|傳說/);
  e.affixes.quality='SS';assert.equal(f.has('洗'),false);
});
test('full-refill prompts require the displayed full cost and both selected potions to be sold',()=>{
  const f=fixture({gold:99});Object.assign(f.S.me,{refill:{red_1:5,blue_1:5,cost:100},supply:{redHours:1,redKey:'red_1',blueKey:'blue_1',redOptions:[{key:'red_1',unlocked:true}],blueOptions:[{key:'blue_1',unlocked:true}]}});
  assert.equal(f.has('補水'),false);f.S.me.character.gold=100;assert.equal(f.has('補水'),true);
  f.S.me.supply.blueOptions[0].unlocked=false;assert.equal(f.has('補水'),false);
  f.S.me.refill.blue_1=0;assert.equal(f.has('補水'),true);
  f.S.me.refill.cost=0;assert.equal(f.has('補水'),false);
});
test('shop suggestions reject stale character catalogs, wrong routes, unavailable levels and unaffordable offers',()=>{
  const f=fixture({gold:500}),offer={slot:'weapon',tier:3,levelReq:31,price:500,branch:'A',name:'路線武器'};f.S.shop={gear:[offer]};
  assert.equal(f.has('商店'),true);f.ctx.shopForActor='other';assert.equal(f.has('商店'),false);f.ctx.shopForActor='111';
  offer.branch='B';assert.equal(f.has('商店'),false);offer.branch='A';offer.levelReq=41;assert.equal(f.has('商店'),false);offer.levelReq=31;offer.price=501;assert.equal(f.has('商店'),false);
  offer.price=500;const w=f.work(),real=shopView(w.char).gear.find(o=>o.branch==='A'&&o.tier===3);assert.ok(real);w.char.gold=real.price;P.buyGear(w,{now:T0},{code:real.code},()=>.5);assert.equal(w.char.gold,0);
});
test('boss readiness requires current-character personal state, live HP, time, recovery and an unused attack window',()=>{
  const f=fixture(),b={id:'boss',name:'首領',status:'active',hp:1,endsAt:T0+1000,me:{hasCharacter:true,attackedThisWindow:false,nextAttackAt:T0,downUntil:null}};f.S.boss=b;
  assert.equal(f.has('去打'),false);f.S.bossPersonalActor='111';assert.equal(f.has('去打'),true);
  b.me.attackedThisWindow=true;b.me.nextAttackAt=T0+1;assert.equal(f.has('去打'),false);b.me.nextAttackAt=T0;assert.equal(f.has('去打'),true);
  b.me.downUntil=T0+1;assert.equal(f.has('去打'),false);b.me.downUntil=null;f.S.me.character.bossDownUntil=T0+1;assert.equal(f.has('去打'),false);f.S.me.character.bossDownUntil=null;
  b.endsAt=T0;assert.equal(f.has('去打'),false);b.endsAt=T0+1000;b.hp=0;assert.equal(f.has('去打'),false);b.hp=1;b.status='killed';assert.equal(f.has('去打'),false);
  f.S.boss=null;assert.equal(f.board().some(n=>n.k==='go:boss'),false);
});
test('daily and transfer notices disappear after completion and advancement cannot be recommended in a party',()=>{
  const f=fixture();f.S.me.daily={claimed:false,total:100};assert.equal(f.has('領取'),true);f.S.me.daily.claimed=true;assert.equal(f.has('領取'),false);
  f.S.me.gate={canAdvance:true,have:1,materialName:'樹王之心'};assert.equal(f.board().some(n=>n.k==='go:class'),true);f.S.me.character.partyId='ring:running';assert.equal(f.board().some(n=>n.k==='go:class'),false);
});
test('click preflight stops stale money, materials and jobs before opening any item or issuing a mutation',async()=>{
  for(const change of [f=>f.S.me.character.gold=0,f=>f.S.me.character.partyId='short',f=>f.S.backgroundJobs=[{job:{characterId:'111',itemId:'w1',status:'running'}}]]) {
    const f=fixture();f.S.me.equipment=f.S.me.equipment.slice(0,1);const row=f.bind().find(r=>r.t.k==='item:w1'&&r.t.b==='強化');f.ctx.refreshMe=async()=>{change(f);return {ok:true};};await row.onclick();assert.deepEqual(f.opened,[]);assert.deepEqual(f.actions,[]);assert.equal(f.S.todoChecking,false);assert.equal(f.messages.length,1);
  }
});
test('late preflight, failures and double clicks never operate after character or page changes',async()=>{
  for(const change of [f=>f.S.me.character.tgId='222',f=>f.S.apiEpoch++,f=>f.S.tab='bag']) {
    const f=fixture();f.S.me.equipment=f.S.me.equipment.slice(0,1);let done;f.ctx.refreshMe=()=>new Promise(r=>done=r);const row=f.bind().find(r=>r.t.b==='強化'),pending=row.onclick();await row.onclick();change(f);done({ok:true});await pending;assert.deepEqual(f.opened,[]);assert.deepEqual(f.actions,[]);assert.equal(f.S.todoChecking,false);
  }
  const f=fixture();f.S.me.equipment=f.S.me.equipment.slice(0,1);f.ctx.refreshMe=async()=>null;await f.bind().find(r=>r.t.b==='強化').onclick();assert.deepEqual(f.opened,[]);assert.equal(f.messages.length,1);
  f.ctx.refreshMe=async()=>({ok:true});await f.bind().find(r=>r.t.b==='強化').onclick();assert.deepEqual(f.opened,['w1']);
});
test('freshly missing advancement material or a daily claimed elsewhere cannot execute the old board row',async()=>{
  for(const kind of ['advance','daily']) {
    const f=fixture();f.S.me.gate={canAdvance:true,have:1,materialName:'樹王之心'};f.S.me.daily={claimed:false,total:100};
    const row=f.bind().find(r=>kind==='advance'?r.t.k==='go:class':r.t.k==='daily');
    f.ctx.refreshMe=async()=>{if(kind==='advance')f.S.me.gate.have=0;else f.S.me.daily.claimed=true;return {ok:true};};
    await row.onclick();assert.deepEqual(f.actions,[]);assert.equal(f.S.tab,'home');assert.equal(f.messages.length,1);
  }
});
test('a removed shop offer or a late catalog response cannot navigate into a stale purchase',async()=>{
  for(const mode of ['removed','character','epoch','failed']) {
    const f=fixture();f.S.shop={gear:[{slot:'weapon',tier:3,levelReq:31,price:100,name:'高階武器'}]};
    const row=f.bind().find(r=>r.t.k==='go:shop');
    f.ctx.api=async()=>{if(mode==='character')f.S.me.character.tgId='222';if(mode==='epoch')f.S.apiEpoch++;if(mode==='failed')throw Error('network');return {shop:{gear:[]}};};
    await row.onclick();assert.equal(f.S.tab,'home');assert.deepEqual(f.actions,[]);assert.equal(f.S.todoChecking,false);
  }
});
test('a refill actually advertised from the real projection buys the full displayed plan without partial scaling',()=>{
  const f=fixture({gold:1000000000}),w=f.work();f.S.me=playerView(w,{now:T0});f.S.me.daily.claimed=true;
  assert.ok(f.S.me.refill.cost>0);assert.equal(f.has('補水'),true);
  const total=f.S.me.refill.cost,r=P.refill(w,{now:T0},{requestId:'full'});
  assert.equal(r.result.cost,total);assert.equal(r.result.partial,false);assert.equal(w.char.gold,f.char.gold-total);
});
test('the normal and compact me API include the current character boss window and recovery, rather than another player status',async()=>{
  const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'},db=env.DB.sqlite;
  try {
    for(const id of ['111','222'])await P.createCharacter(env,{tgId:id,name:'清單驗收'+id,gender:'m',baseClass:'sword'},T0);
    await spawnDue(env,T0);const boss=db.prepare('SELECT id FROM rpg_boss_instances').get();assert.ok(boss);
    const read=async(id,now,summary=false)=>{const r=await handle(new CurrentClientRequest('http://local/app/api/me',{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':id,'X-Debug-Now':String(now)},body:JSON.stringify({summary})}),env);assert.equal(r.status,200);return r.json();};
    const before=await read('111',T0+1);assert.equal(before.boss.me.hasCharacter,true);assert.equal(before.boss.me.attackedThisWindow,false);
    db.prepare('INSERT INTO rpg_boss_attacks(boss_id,tg_id,win,damage,created_at) VALUES(?,?,?,?,?)').run(boss.id,'111',0,1,T0+1);
    db.prepare('UPDATE rpg_characters SET boss_down_until=? WHERE tg_id=?').run(T0+60000,'111');
    const cooling=await read('111',T0+2,true);assert.equal(cooling.boss.me.attackedThisWindow,true);assert.equal(cooling.boss.me.nextAttackAt,T0+180000);assert.equal(cooling.boss.me.downUntil,T0+60000);
    const other=await read('222',T0+2);assert.equal(other.boss.me.attackedThisWindow,false);assert.equal(other.boss.me.downUntil,null);
    const ready=await read('111',T0+180000);assert.equal(ready.boss.me.attackedThisWindow,false);assert.equal(ready.boss.me.downUntil,null);
  } finally {db.close();}
});
