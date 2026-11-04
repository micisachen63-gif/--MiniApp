import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/scene-window-manager.js',import.meta.url),'utf8');
function fixture(){const box={};vm.runInNewContext(source,box);let context={accountId:'a',realmId:'permanent',characterId:'a1',epoch:1};const state=box.RpgSceneWindows.createState({routes:['inventory','item','camp'],getContext:()=>context});return {state,setContext(value){context={...context,...value};}};}
test('returning to a list preserves its draft and separates item details',()=>{
 const {state}=fixture();state.navigate('inventory');state.draft().search='月桂';state.draft().selected=['gear-a'];state.navigate('item',{itemId:'gear-a'});state.draft().position='ring1';state.navigate('item',{itemId:'gear-b'});state.draft().position='ring2';assert.equal(state.back().params.itemId,'gear-a');assert.equal(state.draft().position,'ring1');assert.equal(state.back().route,'inventory');assert.equal(state.draft().search,'月桂');assert.equal(state.draft().selected[0],'gear-a');
});
test('closing and reopening retains a draft but invalidates late responses',()=>{
 const {state}=fixture();state.navigate('inventory');state.draft().quantity='7';const old=state.ticket();state.close();assert.equal(old(),false);state.navigate('inventory');assert.equal(state.draft().quantity,'7');assert.equal(old(),false);assert.equal(state.ticket()(),true);
});
test('A to B to A navigation cannot accept the first A response',()=>{
 const {state}=fixture();state.navigate('item',{itemId:'gear-a'});const old=state.ticket();state.navigate('camp',{},{reset:true});state.navigate('item',{itemId:'gear-a'});assert.equal(old(),false);assert.equal(state.depth(),2);state.back();assert.equal(state.current().route,'camp');assert.equal(state.back(),null);
});
test('account, world, character and epoch changes each isolate pending views and drafts',()=>{
 for(const change of [{accountId:'b'},{realmId:'season'},{characterId:'a2'},{epoch:2}]){
  const {state,setContext}=fixture();state.navigate('inventory');state.draft().search='私人草稿';const old=state.ticket();setContext(change);assert.equal(old(),false);assert.equal(state.syncContext(),true);assert.equal(state.current(),null);state.navigate('inventory');assert.equal(state.draft().search,undefined);
 }
});
test('unknown routes and mutable caller params cannot corrupt navigation',()=>{
 const {state}=fixture(),params={itemId:'gear-a',unsafe:{nested:true}};state.navigate('item',params);params.itemId='gear-b';assert.equal(state.current().params.itemId,'gear-a');assert.equal(state.current().params.unsafe,undefined);assert.throws(()=>state.navigate('missing'),/未知/);assert.equal(state.current().route,'item');assert.equal(state.depth(),1);
});
