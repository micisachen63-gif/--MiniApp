import test from 'node:test';
import assert from 'node:assert/strict';
import {REAL_CAREERS,REAL_CAREER_PAIRS,realLifeIdentity,realCareer,realScenes} from '../public/fate/real-life-careers-v1.js';

const life=(seed='deadbeef',answers=[])=>({version:6,seed,answers});
test('prototype has sixteen distinct ten-chapter adult careers and qualification metadata',()=>{
 assert.equal(REAL_CAREERS.length,16);assert.equal(new Set(REAL_CAREERS.map(c=>c.id)).size,16);
 assert.equal(new Set(REAL_CAREERS.flatMap(c=>c.steps)).size,160);
 for(const career of REAL_CAREERS){assert.equal(career.steps.length,10);assert.ok(career.steps.every(text=>typeof text==='string'&&text.length>25));assert.ok(career.minAge>=18);if(career.adultOnly)assert.ok(career.minAge>=21);}
 for(const id of ['early-education','nursing']){const c=REAL_CAREERS.find(c=>c.id===id);assert.equal(c.requiredEducationIndex,4);assert.match(c.steps[0],/培訓|專業訓練/);assert.match(c.steps[0],/資格確認/);}
});
test('first decision changes an actual career identity in every pair and does not require marriage or children',()=>{
 for(let i=0;i<16;i++){const seed='000000'+i.toString(16).padStart(2,'0'),a=realCareer(life(seed,[0])),b=realCareer(life(seed,[1]));assert.deepEqual([a.id,b.id],REAL_CAREER_PAIRS[i]);assert.notEqual(a.id,b.id);assert.equal(realCareer(life(seed)).id,a.id);}
 const care=REAL_CAREERS.find(c=>c.id==='home-care');assert.match(care.steps[0],/長輩/);assert.doesNotMatch(care.steps[0],/丈夫|妻子|孩子/);
});
test('gender is a seed-only story identity, balanced and independent from real birth data or career eligibility',()=>{
 let women=0;const eligible={f:new Set(),m:new Set()};
 for(let i=0;i<4096;i++){const d=life(i.toString(16).padStart(8,'0')),id=realLifeIdentity(d);women+=id.gender==='f'?1:0;for(const answer of [0,1])eligible[id.gender].add(realCareer({...d,answers:[answer]}).id);assert.deepEqual(realLifeIdentity({...d,profile:{gender:'other',birthDate:'2000-01-01'}}),id);}
 assert.ok(women>1900&&women<2200);assert.equal(eligible.f.size,16);assert.equal(eligible.m.size,16);
});
test('eight scenario families per stage fit high-nibble rotation without changing the career pair',()=>{
 for(let stage=0;stage<3;stage++){const seen=new Set();let pair;
  for(let family=0;family<8;family++){const parts=['00','00','00','0d'];parts[stage]=(family*16).toString(16).padStart(2,'0');const scenes=realScenes(life(parts.join('')));seen.add(scenes[stage].scenarioId);pair??=scenes[0].careerIds;assert.deepEqual(scenes[0].careerIds,pair);for(const scene of scenes){assert.equal(scene.choices.length,2);assert.ok(scene.choices.every(c=>c.length===3&&c.every(s=>typeof s==='string'&&s.length)));assert.doesNotMatch(JSON.stringify(scene),/undefined|\{\w+\}/);}}
  assert.equal(seen.size,8);
 }
});
test('later answers cannot rewrite an already seen first scene; adult and professional beginnings describe preparation',()=>{
 for(let i=0;i<256;i++){const d=life(i.toString(16).padStart(8,'0')),first=realScenes(d)[0];assert.deepEqual(realScenes({...d,answers:[1,0,1]})[0],first);
  for(const [n,id]of first.careerIds.entries()){const c=realCareer({...d,answers:[n]});if(c.adultOnly){assert.match(first.choices[n][1],/二十一歲後/);assert.ok(c.minAge>=21);}if(c.requiredEducationIndex){assert.match(first.choices[n][1],/補修進修/);assert.ok(c.qualificationAge>=first.age+4);}}
 }
});
test('prototype cannot change any old-version identity or career',()=>{
 for(const version of [1,2,3,4,5]){const d={...life(),version};assert.equal(realCareer(d),null);assert.equal(realLifeIdentity(d),null);assert.deepEqual(realScenes(d),[]);}
});
