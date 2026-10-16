import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife,advanceLife,lifeAge} from '../public/fate/life.js';
import {lifeTiming} from '../public/fate/timing-v5.js';
import {formalEvents,plannedContent} from '../public/fate/formal-events.js';
import {metricsForLife,metricMilestones,metricPortrait,METRIC_REFERENCE} from '../public/fate/life-metrics-v1.js';
import {endingForLife} from '../public/fate/ending-story.js';
const start=Date.parse('2026-10-16T06:00:00+08:00');
const draft=seed=>createLife({version:6,orbit:3,seed,startedAt:start});
test('current facts never infer schooling or children from NPC prose or future milestones',()=>{
 const d=draft('deadbeef'),rows=[{age:3,state:{energy:81,wealth:30},kind:'memory',text:'鄰人的三個孩子一起來玩。'}];
 const at3=metricsForLife(d,rows,3);assert.equal(at3.education.label,'尚未入學');assert.equal(at3.children,0);assert.equal(at3.health,81);
 const fake=[...rows,{age:25,kind:'education',educationIndex:4},{age:30,kind:'family',childCount:4}];assert.equal(metricsForLife(d,fake,24).children,0);assert.equal(metricsForLife(d,fake,24).education.index,0);
 assert.equal(metricsForLife({...d,version:5},fake,40),null);
});
test('school and family facts enter at their real narrative ages and replay on reload and public result',()=>{
 for(let n=0;n<80;n++){const seed=(Math.imul(n+1,2654435761)>>>0).toString(16).padStart(8,'0'),d=draft(seed),timing=lifeTiming(d),milestones=metricMilestones(d);
  for(const age of [0,11,12,18,23,30,45,timing.deathAge]){const now=start+Math.ceil(age/timing.deathAge*7200000),current=advanceLife(d,now).draft,rows=formalEvents(current,now),m=metricsForLife(current,rows,lifeAge(current,now));
   assert.equal(m.children,milestones.filter(e=>e.kind==='family'&&e.age<=lifeAge(current,now)).length);assert.ok(m.children>=0&&Number.isInteger(m.children));assert.ok(rows.filter(e=>e.kind==='family'||e.kind==='education').every(e=>e.age<=age+.0001));
   assert.deepEqual(m,metricsForLife(JSON.parse(JSON.stringify(current)),rows,lifeAge(current,now)));assert.equal(m.wealthTwd,Math.round(m.wealthUsd*31.438));
  }
  const complete=advanceLife(d,start+7200000).draft,rows=plannedContent(complete),m=metricsForLife(complete,rows,timing.deathAge),ending=endingForLife(complete);
  assert.equal(ending.lifeMetrics.children,m.children);assert.equal(ending.lifeMetrics.education.index,m.education.index);assert.ok(ending.paragraphs.join('').includes(m.birth.name));if(m.children)assert.match(ending.paragraphs.join(''),/孩子/);
 }
});
test('the model uses sourced adult wealth bands, fixed historical FX and reproducible school and family recipes',()=>{
 assert.equal(METRIC_REFERENCE.wealth.reduce((n,b)=>n+b.share,0),100);assert.equal(METRIC_REFERENCE.fertility,2.25);assert.equal(METRIC_REFERENCE.monthlyLivingTwd,319676/12);
 const wealths=new Set(),school=new Set(),families=new Set();let debt=false;
 for(let i=0;i<1200;i++){const d=draft(i.toString(16).padStart(8,'0')),rows=plannedContent({...d,answers:[0,0,0],sources:['manual','manual','manual']}),m=metricsForLife(d,rows,lifeTiming(d).deathAge);wealths.add(METRIC_REFERENCE.wealth.findIndex((b,k)=>m.wealthUsd<b.max||k===3));school.add(m.education.index);families.add(m.children);debt||=m.wealthUsd<0;assert.ok(m.health>=0&&m.health<=100);}
 assert.equal(wealths.size,4);assert.equal(school.size,5);assert.ok(families.has(0)&&families.has(1)&&families.has(2)&&families.has(4));assert.ok(debt);
});
test('story portraits use actual milestones and net assets without inventing friends, savings or world percentiles',()=>{
 const d=advanceLife(draft('00000447'),start+7200000).draft,rows=plannedContent(d),m=metricsForLife(d,rows,lifeTiming(d).deathAge),p=metricPortrait(m);
 assert.equal(p.cards.length,4);assert.match(p.comparison,/淨資產|淨負債/);assert.match(p.comparison,/不是存款/);assert.equal(p.wealthMonths,Math.round(Math.abs(m.wealthTwd)/METRIC_REFERENCE.monthlyLivingTwd*10)/10);assert.ok(p.cards.some(c=>c.question===p.question));assert.doesNotMatch(JSON.stringify(p),/超過.*%|半夜.*陪你|加盟/);
 assert.deepEqual(p,metricPortrait(structuredClone(m)));assert.equal(m.birth.iso2,'TW');
});
