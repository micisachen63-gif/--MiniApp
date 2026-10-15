import test from 'node:test';
import assert from 'node:assert/strict';
import {natal} from '../src/game/fate-chart.js';
import {makeReminders,REMINDER_CATALOG} from '../src/game/fate-reminders.js';
const NOW=Date.parse('2026-10-16T12:00:00Z'),birth={date:'1998-11-03',time:'10:30',placeId:'taipei',sex:'f'},day='2026-10-16';
test('daily notes keep health/work/love order and each offers a specific conditional scene, action and reason',()=>{
 const notes=makeReminders(natal(birth,NOW),day);assert.deepEqual(notes.map(n=>n.topic),['health','work','love']);
 for(const n of notes){assert.equal(n.kind,'個人旅箋');assert.match(n.basis,/完整出生檔案/);assert.match(n.reason,/文化推演/);assert.match(n.scene,/^如果/);assert.ok(n.title.length>=8);assert.ok(n.action.length>=20);assert.ok(n.reason.length>=30);assert.ok(!n.action.includes(n.scene));}
 // Explicit scene anchors keep the catalog grounded in ordinary situations rather than abstract luck scores.
 const content=Object.values(REMINDER_CATALOG).flat();assert.ok(content.some(n=>n.scene.includes('同一份東西改了幾次')&&n.action.includes('A、B')));assert.ok(content.some(n=>n.scene.includes('有空再約')&&n.action.includes('兩個實際可行的時間')));
 assert.equal(new Set(content.map(n=>n.id)).size,content.length);assert.equal(new Set(content.map(n=>n.title)).size,content.length);
});
test('same chart and Taipei day produce stable notes; changed birth signals and changed days can select different scenes',()=>{
 const chart=natal(birth,NOW),notes=makeReminders(chart,day);assert.deepEqual(makeReminders(JSON.parse(JSON.stringify(chart)),day),notes);
 const other=natal({...birth,date:'1985-07-12'},NOW);assert.notDeepEqual(makeReminders(other,day).map(n=>n.id),notes.map(n=>n.id));
 const next=makeReminders(chart,'2026-10-17');assert.notDeepEqual(next.map(n=>n.id),notes.map(n=>n.id));
});
test('missing data and no profile expose only life inspiration while keeping useful daily actions',()=>{
 for(const chart of [null,natal({...birth,time:null},NOW),natal({...birth,placeId:null},NOW),natal({...birth,sex:null},NOW)]){
  const notes=makeReminders(chart,day);assert.equal(notes.length,3);
  for(const note of notes){assert.equal(note.kind,'生活靈感');assert.match(note.basis,/資料未齊/);assert.ok(!note.reason.includes('完整出生檔案'));assert.ok(!note.reason.includes('長期取向'));assert.ok(note.scene&&note.action&&note.reason);}
 }
});
test('recent seven days are avoided per category without changing the fixed unlock ordering',()=>{
 const chart=natal(birth,NOW),history=[];
 for(let i=0;i<30;i++){
  const date=new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10),recent=history.slice(-7).flatMap(row=>row.map(n=>n.id)),notes=makeReminders(chart,date,recent);
  assert.deepEqual(notes.map(n=>n.topic),['health','work','love']);assert.ok(notes.every(n=>!recent.includes(n.id)));assert.deepEqual(makeReminders(chart,date,recent),notes);history.push(notes);
 }
});
test('player-facing catalog and composed notes avoid chart jargon, certainty and medical treatment claims',()=>{
 const content=[...Object.values(REMINDER_CATALOG).flat(),...makeReminders(natal(birth,NOW),day),...makeReminders(null,day)];
 for(const note of content){const text=[note.title,note.scene,note.action,note.reason].join(' ');assert.doesNotMatch(text,/八字|紫微|四化|化忌|官殺|印星|比劫|命宮|官祿|土星|木星|Lahiri|Dasha|必定發生|保證準確|精準預言|診斷|治療|服藥|停藥|血光|厄運|百分之百|100%/i);}
});
