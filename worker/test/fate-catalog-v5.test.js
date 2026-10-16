import test from 'node:test';
import assert from 'node:assert/strict';
import {CAREERS,THREADS,OBJECTS} from '../public/fate/formal-catalog-v4.js';
import {V5_CAREERS,V5_THREADS,V5_OBJECTS,V5_COMMUNITY,V5_REFLECTIONS,V5_SOCIAL_ROLES} from '../public/fate/formal-catalog-v5.js';
import {SOCIAL_ROLES,validSocialCast,socialThread} from '../public/fate/social-cast.js';
import {narrativeProfile,plannedContent,formalScenes} from '../public/fate/formal-events.js';
test('v5 adds 160 distinct authored chain chapters without changing any v4 catalogue',()=>{
 const originals=[...CAREERS,...THREADS,...OBJECTS],oldIds=new Set(originals.map(x=>x.id)),oldTexts=new Set(originals.flatMap(x=>x.steps)),added=[...V5_CAREERS,...V5_THREADS,...V5_OBJECTS];
 assert.deepEqual([V5_CAREERS.length,V5_THREADS.length,V5_OBJECTS.length],[8,8,8]);assert.deepEqual([CAREERS.length,THREADS.length,OBJECTS.length],[8,12,8]);assert.equal(new Set(added.map(x=>x.id)).size,24);
 for(const [pool,count]of [[V5_CAREERS,10],[V5_THREADS,6],[V5_OBJECTS,4]])for(const entry of pool){assert.equal(oldIds.has(entry.id),false);assert.equal(entry.steps.length,count);for(const text of entry.steps){assert.equal(typeof text,'string');assert.ok(text.length>=26&&text.length<=100,entry.id+':'+text);assert.equal(oldTexts.has(text),false);assert.doesNotMatch(text,/undefined|TODO|INSERT|待補/);}}
 const texts=added.flatMap(x=>x.steps);assert.equal(texts.length,160);assert.equal(new Set(texts).size,160);
 for(const c of V5_CAREERS)for(const key of ['id','name','object','place'])assert.ok(c[key]);
});
test('every new relationship has its own community decision, valid lifecycle bounds and six fully replaceable NPC references',()=>{
 assert.equal(Object.keys(V5_COMMUNITY).length,8);assert.equal(Object.keys(V5_SOCIAL_ROLES).length,8);
 for(const thread of V5_THREADS){assert.ok(thread.min>=3&&thread.max<=87&&thread.min<thread.max);const scene=V5_COMMUNITY[thread.id];assert.equal(scene.length,2);assert.ok(scene.every(t=>typeof t==='string'&&t.length>3));const role=V5_SOCIAL_ROLES[thread.id];assert.equal(SOCIAL_ROLES[thread.id].npc,role.npc);assert.ok(role.role);
  const cast=validSocialCast({v:1,people:[{thread:thread.id,name:'白色毛衣'}]}),replaced=socialThread(thread,cast);assert.equal(replaced.role,role.role);assert.equal(replaced.actor,'白色毛衣');assert.equal(replaced.steps.length,6);for(let i=0;i<6;i++){assert.ok(thread.steps[i].includes(role.npc));assert.ok(replaced.steps[i].includes('「白色毛衣」'));assert.equal(replaced.steps[i].includes(role.npc),false);}assert.equal(socialThread(thread,null),thread);
 }
});
test('every new object has a bespoke handover reflection and the original four chapters remain ordered',()=>{
 assert.equal(Object.keys(V5_REFLECTIONS).length,8);for(const object of V5_OBJECTS){const text=V5_REFLECTIONS[object.id];assert.equal(typeof text,'string');assert.ok(text.includes(object.name),object.id);assert.ok(text.length>40);assert.equal(object.steps.length,4);}
 assert.equal(new Set(Object.values(V5_REFLECTIONS)).size,8);assert.equal(new Set(Object.values(V5_COMMUNITY).map(v=>v[1])).size,8);
});
test('all additive careers, people and objects participate in completed v5 stories with every prerequisite, while v4 keeps its old pools',()=>{
 for(let i=0;i<8;i++){const seed=[8+i,12+i,8+i,1].map(n=>n.toString(16).padStart(2,'0')).join(''),life={version:5,seed,orbit:0,answers:[0,0,0],sources:['manual','manual','manual']},profile=narrativeProfile(life),rows=plannedContent(life),scenes=formalScenes(life);
  assert.equal(profile.career.id,V5_CAREERS[i].id);assert.equal(profile.threads[0].id,V5_THREADS[i].id);assert.equal(profile.objects[0].id,V5_OBJECTS[i].id);assert.ok(V5_COMMUNITY[V5_THREADS[i].id].some(part=>scenes[1].text.includes(part)));const reflectionSeed=seed.slice(0,4)+(parseInt(seed.slice(4,6),16)|16).toString(16).padStart(2,'0')+seed.slice(6);assert.ok(formalScenes({...life,seed:reflectionSeed})[2].text.includes(V5_REFLECTIONS[V5_OBJECTS[i].id]));assert.doesNotMatch(scenes.map(s=>s.text).join(''),/undefined/);
  for(const chain of [rows.filter(r=>r.career===profile.career.name),rows.filter(r=>r.thread===profile.threads[0].id),rows.filter(r=>r.object===profile.objects[0].name)]){assert.ok(chain.length>=4);assert.deepEqual(chain.map(r=>r.chapter),Array.from({length:chain.length},(_,j)=>j));for(let j=1;j<chain.length;j++)assert.equal(chain[j].requires,chain[j-1].id);}
  const legacy=narrativeProfile({...life,version:4});assert.ok(!legacy.career.id.startsWith('v5-'));assert.ok(legacy.threads.every(t=>!t.id.startsWith('v5-')));assert.ok(legacy.objects.every(o=>!o.id.startsWith('v5-')));
 }
});
