import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {simulateDuel} from '../src/game/pk.js';
import {mulberry32} from '../src/game/rng.js';

const stats = (pct={}) => ({level:40, atk:100, def:20, maxHp:1500, maxMp:23, taken:1,
  element:'fire', pct, skill:{cost:8,mult:1.8}});
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(app.slice(app.indexOf('  function pkFrame('),app.indexOf('  function pkReplay('))+';this.frame=pkFrame;',context);

test('every PK impact conserves authoritative HP/MP snapshots and final values',()=>{
  const a=stats({lifestealPct:.5,healPerCastPct:.1}),b=stats({lifestealPct:.15});
  const original=JSON.stringify([a,b]);
  for(let seed=0;seed<40;seed++){
    const sim=simulateDuel(a,b,mulberry32(seed));
    let state=sim.initial;
    for(const hit of sim.log){
      assert.deepEqual(hit.before,state);
      const actor=hit.by,target=actor==='a'?'b':'a';
      assert.equal(hit.after.hp[target],Math.max(0,hit.before.hp[target]-hit.dmg));
      assert.equal(hit.healed,hit.after.hp[actor]-hit.before.hp[actor]);
      assert.ok(hit.after.mp[actor]>=0&&hit.after.mp[actor]<=sim.maxMp[actor]);
      const played=context.frame(state,hit);
      assert.deepEqual(JSON.parse(JSON.stringify(played.hp)),hit.after.hp);
      assert.deepEqual(JSON.parse(JSON.stringify(played.mp)),hit.after.mp);
      assert.equal(played.healed,hit.healed);
      assert.equal(played.damage,hit.before.hp[target]-hit.after.hp[target]);
      state=hit.after;
    }
    assert.deepEqual(state.hp,sim.hp);assert.deepEqual(state.mp,sim.mp);
  }
  assert.equal(JSON.stringify([a,b]),original,'a replay must not mutate character stats');
});

test('PK healing numbers are actual restored HP, including caps and lethal blows',()=>{
  const sim=simulateDuel(stats({lifestealPct:50}),stats(),()=>.4);
  assert.equal(sim.log[0].healed,0,'full-health actor does not show fictitious healing');
  const last=sim.log.at(-1);assert.equal(sim.ko,true);
  assert.equal(last.healed,0,'the existing rule skips sustain on a lethal attack');
  assert.ok(sim.log.some(hit=>hit.healed>0&&hit.healed<hit.heal),'over-heal is clamped to actual recovered HP');
});

test('older PK records still replay damage and clipped self healing accurately',()=>{
  const state={hp:{a:90,b:100},mp:{}};
  const hit={by:'a',dmg:20,hp:80,heal:50,self:100};
  const played=context.frame(state,hit);
  assert.equal(played.hp.a,100);assert.equal(played.hp.b,80);assert.equal(played.healed,10);assert.equal(played.damage,20);
  assert.equal(state.hp.a,90,'input state remains immutable');
});
test('PK overkill floating damage equals the HP actually removed',()=>{
  const played=context.frame({hp:{a:90,b:7},mp:{}},{by:'a',dmg:500,hp:0});
  assert.equal(played.damage,7);assert.equal(played.hp.b,0);
});

test('PK basic attacks show true mana regeneration instead of guessed costs',()=>{
  const sim=simulateDuel(stats(),stats(),mulberry32(15));
  const basic=sim.log.find(s=>!s.skill);assert.ok(basic);
  assert.ok(basic.after.mp[basic.by]>basic.before.mp[basic.by]);
  const played=context.frame(basic.before,basic);assert.equal(played.mp[basic.by],basic.after.mp[basic.by]);
});
