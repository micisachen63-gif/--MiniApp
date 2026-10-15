import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness(){
 const S={me:{character:{tgId:'111',revision:1,state:'fighting'}},session:{kills:0,exp:0,gold:0,ticks:0}},reports=[];
 const ctx=vm.createContext({S,BATTLE:{sync:(j,r)=>reports.push(r)},autoBanner(){},resetFight(){}});
 vm.runInContext(app.slice(app.indexOf('  const idleReportWindows'),app.indexOf('  async function act('))+';this.absorb=absorb;',ctx);
 return {S,reports,absorb:ctx.absorb};
}
const response=(from,to,tg='111',revision=2)=>({character:{tgId:tg,revision,state:'fighting'},report:{from_at:from,to_at:to,ticks:1,kills:4,exp_gained:15,exp_lost:2,gold_gained:20,drops:{red_1:2}}});
test('retransmitted idle result does not duplicate session gains or drop accounting',()=>{
 const h=harness(),r=response(0,60000);h.absorb(r);h.absorb(r);
 assert.equal(h.S.session.kills,4);assert.equal(h.S.session.exp,13);assert.equal(h.S.session.gold,20);assert.equal(h.S.pending.drops.red_1,2);assert.equal(h.reports[1],null);
 h.absorb(response(60000,120000));assert.equal(h.S.session.kills,8);
});
test('older or overlapping report windows never rewind accounting',()=>{
 const h=harness();h.absorb(response(60000,120000));h.absorb(response(0,60000));h.absorb(response(90000,150000));
 assert.equal(h.S.session.kills,4);assert.equal(h.S.lastReport.to_at,120000);
});
test('changing hero clears old totals and only counts the new character report',()=>{
 const h=harness();h.absorb(response(0,60000));h.absorb(response(0,60000,'222'),true);
 assert.equal(h.S.session.kills,4);assert.equal(h.S.pending.drops.red_1,2);
 h.absorb({character:{tgId:'333',revision:1,state:'fighting'}},true);
 assert.equal(h.S.lastReport,null);assert.equal(h.S.pending,null);assert.equal(h.S.session.kills,0);
});
