import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function apiFixture() {
  const S={me:{character:{tgId:'a'}},apiEpoch:0,choosing:false};let resolve,selectionPrompts=0;
  const ctx=vm.createContext({S,expansion:null,initData:'',devTg:'111',tg:null,
    window:{RpgRequest:{request:()=>new Promise(r=>resolve=r)}},refreshMe(){},openCharacterSelect(){selectionPrompts++;},setTimeout:fn=>fn()});
  vm.runInContext(source.slice(source.indexOf('  const readActions='),source.indexOf('  function mutationKey(')),ctx);
  return {S,run:ctx.api,reply:()=>resolve({res:{status:409},j:{ok:false,error:'character_changed',message:'角色已切換'}}),prompts:()=>selectionPrompts};
}
test('late character-changed errors from an old actor cannot clear the new actor or reopen selection',async()=>{
  const f=apiFixture(),p=f.run('me');f.S.me={character:{tgId:'b'}};f.S.apiEpoch+=2;f.reply();
  await assert.rejects(p,e=>e.code==='character_changed');assert.equal(f.S.me.character.tgId,'b');assert.equal(f.S.choosing,false);assert.equal(f.prompts(),0);
});
test('A to B to A still rejects an older session error even when the character ID matches again',async()=>{
  const f=apiFixture(),p=f.run('background/status');f.S.apiEpoch+=4;f.S.me={character:{tgId:'a',gold:7}};f.reply();
  await assert.rejects(p,e=>e.code==='character_changed');assert.equal(f.S.me.character.gold,7);assert.equal(f.S.choosing,false);assert.equal(f.prompts(),0);
});
test('a real current-session character mismatch still clears stale state and requests selection',async()=>{
  for(const action of ['me','daily']){const f=apiFixture(),p=f.run(action);f.reply();await assert.rejects(p,e=>e.code==='character_changed');assert.equal(f.S.me,null);assert.equal(f.S.choosing,true);assert.equal(f.prompts(),1);}
});
test('workshop notices follow the displayed actor and disappear in selection without discarding account jobs',()=>{
  const a={job:{characterId:'a',itemName:'甲的強化',status:'running'}},b={job:{characterId:'b',itemName:'乙的重鑄',status:'ended'}};
  const S={me:{character:{tgId:'a'}},backgroundJobs:[a,b],choosing:false,creating:false};let rows;
  const ctx=vm.createContext({S,backgroundWorkshop:{render:r=>rows=r}});
  vm.runInContext(source.slice(source.indexOf('  function renderBackground('),source.indexOf('  function setBackground(')),ctx);
  ctx.renderBackground();assert.deepEqual([...rows],[a]);S.me.character.tgId='b';ctx.renderBackground();assert.deepEqual([...rows],[b]);
  S.choosing=true;ctx.renderBackground();assert.equal(rows.length,0);S.choosing=false;S.creating=true;ctx.renderBackground();assert.equal(rows.length,0);
  S.creating=false;S.me.character.tgId='a';ctx.renderBackground();assert.deepEqual([...rows],[a]);assert.deepEqual(S.backgroundJobs,[a,b]);
});
