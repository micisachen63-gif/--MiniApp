import test from 'node:test';
import assert from 'node:assert/strict';
import {V5_CHOICE_VARIANTS} from '../public/fate/formal-choices-v5.js';
import {V5_CAREERS,V5_THREADS,V5_OBJECTS,V5_COMMUNITY,V5_REFLECTIONS} from '../public/fate/formal-catalog-v5.js';
const context=i=>({career:V5_CAREERS[i],thread:V5_THREADS[i],object:V5_OBJECTS[i],community:V5_COMMUNITY[V5_THREADS[i].id],reflection:V5_REFLECTIONS[V5_OBJECTS[i].id]});
test('v5 offers eight complete authored decisions per life stage with unique premises, options and consequences',()=>{
 assert.deepEqual(V5_CHOICE_VARIANTS.map(stage=>stage.length),[8,8,8]);const ids=new Set(),titles=new Set(),premises=new Set(),pairs=new Set(),outcomes=new Set();
 for(const stage of V5_CHOICE_VARIANTS)for(const variant of stage){assert.match(variant.id,/^[a-z0-9-]{1,18}$/);assert.equal(ids.has(variant.id),false);ids.add(variant.id);assert.equal(typeof variant.build,'function');const scene=variant.build(context(0));assert.equal(scene.choices.length,2);
  for(const key of ['tag','title','text']){assert.equal(typeof scene[key],'string');assert.ok(scene[key].length>5);assert.doesNotMatch(scene[key],/undefined|\[object Object\]|TODO|待補/);}
  for(const [value,set]of [[scene.title,titles],[scene.text,premises],[JSON.stringify(scene.choices.map(c=>c[0])),pairs]]){assert.equal(set.has(value),false);set.add(value);}
  for(const choice of scene.choices){assert.equal(choice.length,3);for(const value of choice){assert.equal(typeof value,'string');assert.ok(value.length>5);assert.doesNotMatch(value,/undefined|\[object Object\]|TODO|待補/);}assert.equal(outcomes.has(choice[2]),false);outcomes.add(choice[2]);}
 }
 assert.equal(ids.size,24);assert.equal(outcomes.size,48);
});
test('every decision builds for all eight new careers/relationships/objects without changing immutable story inputs',()=>{
 for(let i=0;i<8;i++)for(const [stage,variants]of V5_CHOICE_VARIANTS.entries())for(const variant of variants){const ctx=context(i),snapshot=JSON.stringify(ctx),a=variant.build(ctx),b=variant.build(ctx);assert.deepEqual(a,b);assert.equal(JSON.stringify(ctx),snapshot);for(const choice of a.choices)assert.doesNotMatch(choice.join(''),/undefined|\[object Object\]/);
  assert.notEqual(a.choices[0][2],a.choices[1][2]);
 }
});
