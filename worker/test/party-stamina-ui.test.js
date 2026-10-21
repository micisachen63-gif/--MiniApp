import test from 'node:test';
import assert from 'node:assert/strict';
import {pveTeam} from './pve-balance-fixture.js';
import {T0} from './helpers.js';
import * as G from '../src/services/party.js';
import {partyStamina} from '../src/game/party-stamina.js';
import {partyStaminaMarkup,memberStaminaMarkup,staminaWait} from '../public/expedition/party-stamina-ui.js';
const energy=(f,id,points)=>f.db.prepare("UPDATE rpg_characters SET special_json=json_set(special_json,'$.partyStamina',json(?)) WHERE tg_id=?").run(JSON.stringify({points,at:T0}),id);
async function fixture(t){const f=await pveTeam({start:false});t.after(f.close);return f;}

test('readiness time keeps the existing partial recovery interval and never extends after repeated reads',()=>{
 const c={special_json:JSON.stringify({partyStamina:{points:19,at:T0}})};
 for(const elapsed of [0,300000,359999]){const s=partyStamina(c,T0+elapsed);assert.equal(s.points,19);assert.equal(s.readyAt,T0+360000);}
 assert.equal(partyStamina(c,T0+360000).readyAt,null);assert.equal(partyStamina(c,T0+360000).points,20);
 assert.equal(partyStamina({special_json:JSON.stringify({partyStamina:{points:0,at:T0}})},T0+360000).readyAt,T0+7200000);
});
test('all-ready lobby exposes each member actual stamina, deficit and recovery time while refusing unpaid departure',async t=>{
 const f=await fixture(t);energy(f,f.ids[1],12);energy(f,f.ids[2],19);
 const p=await G.view(f.env,f.id(),f.ids[0],T0+1);assert.ok(p.members.every(m=>m.ready));assert.equal(p.stamina.ready,false);
 assert.equal(p.members[1].stamina.points,12);assert.equal(p.members[1].stamina.readyAt,T0+2880000);assert.equal(p.members[2].stamina.readyAt,T0+360000);
 const html=partyStaminaMarkup(p,T0+1);assert.match(html,/暫時無法出發/);assert.match(html,/12／100 · 還差 8 點/);assert.match(html,/48 分鐘/);assert.match(html,/19／100 · 還差 1 點/);assert.match(html,/6 分鐘/);assert.match(html,/晚於本隊招募期限/);
 assert.match(memberStaminaMarkup(p.members[1]),/體力 12／100 · 出發需 20/);
 await assert.rejects(G.action(f.env,f.ids[0],{partyId:f.id(),op:'start'},T0+1),e=>e.code==='stamina');
 assert.equal(f.db.prepare("SELECT count(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,0);
 assert.equal(partyStamina(f.db.prepare('SELECT * FROM rpg_characters WHERE tg_id=?').get(f.ids[1]),T0+1).points,12);
});
test('next server projection at the true recovery boundary becomes startable and one departure charges exactly once',async t=>{
 const f=await fixture(t);energy(f,f.ids[1],19);
 const before=await G.view(f.env,f.id(),f.ids[0],T0+359999);assert.equal(before.stamina.ready,false);
 const ready=await G.view(f.env,f.id(),f.ids[0],T0+360000);assert.equal(ready.stamina.ready,true);assert.equal(ready.members[1].stamina.points,20);assert.match(partyStaminaMarkup(ready,T0+360000),/全員體力足夠/);
 const r=await G.action(f.env,f.ids[0],{partyId:f.id(),op:'start',requestId:'stamina-ready-boundary'},T0+360000);
 assert.equal(r.party.status,'combat');assert.match(partyStaminaMarkup(r.party,T0+360000),/本場體力已扣除/);assert.equal(r.party.members[1].stamina.points,0);
 await G.action(f.env,f.ids[0],{partyId:f.id(),op:'start',requestId:'stamina-ready-boundary'},T0+360000);
 assert.equal(f.db.prepare("SELECT count(*) n FROM rpg_ledger WHERE type='打寶體力'").get().n,3);
});
test('trial and tower have no stamina display; historical departed members are not reported as blockers',()=>{
 assert.equal(partyStaminaMarkup({stamina:null},T0),'');assert.equal(memberStaminaMarkup({stamina:null}),'');
 const s={points:0,max:100,cost:20,perHour:10,ready:false,readyAt:T0+7200000};
 assert.equal(memberStaminaMarkup({stamina:s,left:true}),'');
 assert.doesNotMatch(partyStaminaMarkup({status:'won',stamina:{cost:20,ready:true},members:[{name:'離隊者',left:true,stamina:s}]},T0),/離隊者|無法再戰/);
});
test('stamina text escapes names, explains legacy incomplete data and never claims readiness before server confirmation',()=>{
 const p={status:'won',stamina:{cost:20,ready:false},members:[{name:'<img onerror=x>',staminaReady:false}]};
 const html=partyStaminaMarkup(p,T0);assert.match(html,/暫時無法再戰/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/請更新進度/);
 assert.equal(staminaWait(T0,T0),'正在同步恢復狀態…');assert.match(staminaWait(T0+7200000,T0),/2 小時/);assert.equal(staminaWait(null,T0),'等待體力恢復');
});
