import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {freshDb} from './d1-shim.js';import {T0} from './helpers.js';import * as P from '../src/services/player.js';import {handle} from '../src/index.js';import {CurrentClientRequest} from './client-request.js';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness(){
 const S={me:null,session:{kills:0,exp:0,gold:0,ticks:0}},battle=[];
 const ctx=vm.createContext({S,Intl,Date,fmt:n=>Number(n).toLocaleString('zh-TW'),esc:s=>s,equipmentSync:null,scheduleEquipmentSync(){},BATTLE:{sync:(j,r)=>battle.push(r)},resetFight(){}});
 vm.runInContext(app.slice(app.indexOf('  const idleReportWindows'),app.indexOf('  async function act('))+';this.absorb=absorb;this.markup=expSettlementHtml;',ctx);
 return {S,battle,absorb:ctx.absorb,markup:()=>ctx.markup(S.me.character)};
}
const receipt=(actor='111',to=T0+60000,gain=31)=>({characterId:actor,from_at:to-60000,to_at:to,ticks:1,exp_gained:gain,exp_lost:0,levels_gained:0});
const view=(actor='111',revision=1,idleSettlement=null)=>({character:{tgId:actor,revision,state:'fighting',exp:533,expNeed:1084},idleSettlement});
test('cron settlement displays exact gain, duplicates do not replay battle or count drops',()=>{
 const h=harness(),j=view('111',2,receipt());h.absorb(j);assert.match(h.markup(),/經驗 <strong>\+31<\/strong>/);assert.match(h.markup(),/1 分鐘/);
 h.absorb(j);h.absorb(view('111',3));assert.equal(h.S.expSettlement.exp_gained,31);assert.equal(h.S.session.exp,0);assert.deepEqual(h.battle,[null,null,null]);
});
test('switch resets gain, rejects old actor/revision, and restores only current actor receipt',()=>{
 const h=harness();h.absorb(view('111',9,receipt()));h.absorb(view('222',2),true);assert.equal(h.S.expSettlement,null);assert.match(h.markup(),/每分鐘/);
 h.absorb(view('111',10,receipt('111',T0+120000,99)));assert.equal(h.S.expSettlement,null);
 h.absorb(view('222',3,receipt('111')));assert.equal(h.S.expSettlement,null);
 h.absorb(view('222',4,receipt('222',T0+120000,7)));h.absorb(view('222',3,receipt('222',T0+180000,88)));assert.equal(h.S.expSettlement.exp_gained,7);
 h.absorb(view('111',11,receipt('111',T0+180000,40)),true);assert.equal(h.S.expSettlement.exp_gained,40);assert.equal(h.S.session.exp,0);
});
test('direct settlement, level-up and death display without losing gross gain or replaying a receipt',()=>{
 const h=harness(),r={...receipt(),exp_lost:4,levels_gained:1};delete r.characterId;
 h.absorb({...view(),report:r});assert.match(h.markup(),/\+31/);assert.match(h.markup(),/死亡損失 −4/);assert.match(h.markup(),/升了 1 級/);assert.equal(h.S.session.exp,27);
 h.absorb(view('111',2,{...receipt(),exp_lost:4,levels_gained:1}));assert.equal(h.S.session.exp,27);assert.equal(h.battle[1],null);
 h.absorb(view('111',3,receipt('111',T0,999)));assert.equal(h.S.expSettlement.exp_gained,31);
});
test('API returns committed cron receipt on no-op polls, scoped to actor and snapshot without writes',async()=>{
 const env={DB:freshDb(),ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};const db=env.DB.sqlite;
 try{
 await P.createCharacter(env,{tgId:'111',name:'經驗旅人',gender:'m',baseClass:'thief'},T0);
 const r=await P.withPlayer(env,'111',T0+60000,null,{source:'cron'});assert.ok(r.report.exp_gained>0);
 const before=db.prepare('SELECT count(*) n FROM rpg_idle_reports').get().n,rev=r.player.char.rev;
 const request=async()=>{const response=await handle(new CurrentClientRequest('http://rpg/app/api/me',{method:'POST',headers:{'X-Dev-Tg-Id':'111','X-Debug-Now':String(T0+60001)},body:JSON.stringify({summary:true})}),env);assert.equal(response.status,200);return response.json();};
 const a=await request(),b=await request();assert.equal(a.report,null);assert.equal(a.idleSettlement.exp_gained,r.report.exp_gained);assert.equal(a.idleSettlement.characterId,'111');assert.equal(a.character.exp,r.player.char.exp);assert.deepEqual(a.idleSettlement,b.idleSettlement);assert.equal(b.character.revision,rev);assert.equal(db.prepare('SELECT count(*) n FROM rpg_idle_reports').get().n,before);
 assert.equal(await P.latestIdleSettlement(env.DB,{tg_id:'222',last_settle_at:T0+60000}),null);assert.equal(await P.latestIdleSettlement(env.DB,{tg_id:'111',last_settle_at:T0}),null);
 }finally{db.close();}
});
