import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mkChar,T0} from './helpers.js';
import {playerView} from '../src/views.js';
import {advance} from '../src/game/classes.js';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function context(me) {
  const ctx=vm.createContext({S:{me,shop:null,boss:null,pending:null},fmt:String,esc:String,sNow:()=>T0,shopForActor:null});
  const helper=app.indexOf('  function advancementReady(');
  if(helper>=0)vm.runInContext(app.slice(helper,app.indexOf('  function renderHud(',helper)),ctx);
  vm.runInContext(app.slice(app.indexOf('  const RAR_ORDER ='),app.indexOf('  function commandIcon(')),ctx);
  return ctx;
}
function view(char,inv) {
  return {...playerView({char,inv,equipment:[]},{now:T0}),nextBoss:null,daily:{claimed:true},refill:{cost:0},supply:{redHours:24}};
}
test('a level-60 knight with zero tree hearts is not told the material has arrived',()=>{
  const ctx=context(view(mkChar({level:60,class_path:'A'}),{}));
  assert.equal(ctx.todoList().some(t=>t.k==='go:class'),false);
});
test('all four advancement materials become actionable only with both level and stock, and remain consumed by the real rule',()=>{
  for(const base_class of ['sword','mage','archer','thief'])for(const class_path of ['','A','A1','A11']) {
    const tier=class_path.length+1,material=tier<3?'mat_'+tier:'trial_'+tier;
    const char=mkChar({base_class,class_path,level:tier*30}),inv={};
    const missing=context(view(char,inv));
    assert.equal(missing.todoList().some(t=>t.k==='go:class'),false);
    assert.throws(()=>advance({...char},inv,tier===1?'A':'1'),e=>e.code==='material');
    assert.deepEqual(inv,{});
    inv[material]=1;
    const ready=context(view(char,inv)),notice=ready.todoList().find(t=>t.k==='go:class');
    assert.equal(notice.t,'可以轉職了！');assert.ok(notice.s.includes('已到手'));
    const low=context(view({...char,level:char.level-1},inv));
    assert.equal(low.todoList().some(t=>t.k==='go:class'),false);
    advance(char,inv,tier===1?'A':'1');assert.equal(inv[material],0);
    assert.equal(context(view(char,inv)).todoList().some(t=>t.k==='go:class'),false);
  }
});
