import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEquipmentAbilityPatch, planEquipmentRebalance, assertRebalanceSnapshotPreserved } from '../src/realm/asset-preservation.js';

const snapshot = () => ({
  characters: [{ tg_id:'test-player', name:'測試旅人', level:120, exp:9876, class_path:'A111', gold:456789, special_json:'{"mastery":71}', future_progress:{unlocks:['a','b']} }],
  equipment: [{ id:'test-weapon', tg_id:'test-player', base_stat:520, enhance_level:12, is_equipped:1, tier:12, slot:'weapon', source:'star_ring', bonus_json:'{"atk":8,"towerImprint":{"rank":5}}', trade_id:null }],
  inventory: [{item:'scroll_w',quantity:600}],
  guardians: [{id:'test-angel',rank:8}],
  claims: [{id:'already-claimed'}],
});

test('a numerical rebalance preserves a +12 item, ownership and every character field', () => {
  const before=snapshot(), after=structuredClone(before);
  after.equipment[0]=applyEquipmentAbilityPatch(before.equipment[0],{base_stat:460,bonus_json:{atk:12,towerImprint:{rank:5}}});
  assert.equal(assertRebalanceSnapshotPreserved(before,after).enhancementChanges,0);
  assert.equal(after.equipment[0].enhance_level,12);
  assert.deepEqual(after.characters,before.characters);
  assert.equal(before.equipment[0].base_stat,520);
});

test('ability patch cannot reset enhancement, replace ownership, tier or equipped state', () => {
  const item=snapshot().equipment[0];
  for(const [key,value] of [['enhance_level',0],['id','new'],['tg_id','other'],['tier',1],['is_equipped',0],['source','starter']])
    assert.throws(()=>applyEquipmentAbilityPatch(item,{[key]:value}),{code:'asset_preservation'});
  assert.throws(()=>applyEquipmentAbilityPatch(item,{bonus_json:{atk:15}}),{code:'asset_preservation'});
});

test('complete snapshot audit rejects loss of characters, materials, angels or future progress', () => {
  const before=snapshot();
  const changes=[s=>s.characters=[],s=>s.characters[0].level=1,s=>s.characters[0].future_progress.unlocks=[],s=>s.equipment[0].enhance_level=11,s=>s.equipment[0].bonus_json='{"atk":15}',s=>s.equipment=[],s=>s.inventory[0].quantity=0,s=>s.guardians=[],s=>s.claims=[]];
  for(const mutate of changes){const after=structuredClone(before);mutate(after);assert.throws(()=>assertRebalanceSnapshotPreserved(before,after),{code:'asset_preservation'});}
});

test('rebalance plan is deterministic, protects +0 as well as high enhancement and rejects missing items', () => {
  const item=snapshot().equipment[0], items=[item,{...item,id:'zero',enhance_level:0}];
  const changes=[{id:item.id,abilities:{base_stat:480}},{id:'zero',abilities:{base_stat:450}}];
  const plan=planEquipmentRebalance(items,changes);
  assert.deepEqual(plan,planEquipmentRebalance(items,changes));
  assert.deepEqual(plan.updates.map(u=>u.expectedEnhanceLevel),[12,0]);
  assert.throws(()=>planEquipmentRebalance(items,[{id:'missing',abilities:{base_stat:10}}]),{code:'asset_preservation'});
  assert.throws(()=>planEquipmentRebalance(items,[changes[0],changes[0]]),{code:'asset_preservation'});
  assert.throws(()=>applyEquipmentAbilityPatch(item,{base_stat:NaN}),{code:'asset_preservation'});
  assert.throws(()=>applyEquipmentAbilityPatch(item,{bonus_json:{atk:Infinity,towerImprint:{rank:5}}}),{code:'asset_preservation'});
});
