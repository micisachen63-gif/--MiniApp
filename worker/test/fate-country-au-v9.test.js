import test from 'node:test';
import assert from 'node:assert/strict';
import pack,{COUNTRY_PACK_AU} from '../public/fate/country-packs-v9/au.js';
import us from '../public/fate/country-packs-v9/us.js';
import ca from '../public/fate/country-packs-v9/ca.js';
import {TAIWAN_MEMORIES_V8} from '../public/fate/taiwan-content-v8.js';
import {TAIWAN_EXTRA_MEMORIES_V8} from '../public/fate/taiwan-days-extra-v8.js';
import {TAIWAN_RESERVE_MEMORIES_V8} from '../public/fate/taiwan-days-reserve-v8.js';

test('AU Sydney NSW scope and fictional AUD household resources',()=>{
 assert.equal(pack,COUNTRY_PACK_AU);assert.equal(pack.id,'AU');assert.equal(pack.currency,'AUD');assert.equal(pack.cityId,'sydney');assert.match(pack.scope,/新南威爾斯州雪梨/);assert.match(pack.scope,/City of Sydney/);
 assert.deepEqual(pack.families.map(f=>f.id),['tight','ordinary','small-business','comfortable']);for(const f of pack.families){assert.ok(f.label&&f.text.length>30);assert.ok(Number.isSafeInteger(f.money)&&f.money>=0);assert.doesNotMatch(f.text,/真實平均|全球前|收入中位/);}
});
test('AU exact 1500 unique daily scenes, no other-country copied lines or unearned relationships',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(pack.daily).map(([k,v])=>[k,v.length])),{child:120,youth:100,adult:720,late:420,any:140});
 const all=Object.values(pack.daily).flat();assert.equal(new Set(all).size,1500);assert.ok(all.every(t=>t.length>=12&&!/[{}]/.test(t)));
 const others=new Set([...Object.values(us.daily).flat(),...Object.values(ca.daily).flat(),...[...TAIWAN_MEMORIES_V8,...TAIWAN_EXTRA_MEMORIES_V8,...TAIWAN_RESERVE_MEMORIES_V8].map(x=>x.text)]);assert.deepEqual(all.filter(t=>others.has(t)),[]);
 assert.ok(all.filter(t=>/雪梨|港邊|港岸|環形碼頭|Opal|薩里山|朱鷺|達令港|皮爾蒙特|皇家植物園|海市場|海關大樓|渡輪/.test(t)).length>=120);
 for(const t of [...pack.daily.adult,...pack.daily.late])assert.doesNotMatch(t,/你的(?:丈夫|妻子|兒子|女兒)|診斷出|開始服藥|付租金|繳房貸|拿到學士|當上護理師/);
 for(const t of pack.daily.any)assert.doesNotMatch(t,/上班|下班|畢業|駕駛|房貸|信用卡|你的孩子/);
});
test('AU 12 careers and 48 distinct scenario choices have native integer consequences',()=>{
 assert.equal(pack.careers.length,12);assert.equal(new Set(pack.careers.map(c=>c.id)).size,12);const chapters=[],questions=[];
 for(const c of pack.careers){assert.match(c.id,/^[a-z0-9-]{1,20}$/);assert.ok([18,21].includes(c.minAge));assert.ok(c.practice.length>25&&c.entry.length>25);assert.equal(c.chapters.length,10);assert.equal(c.dilemmas.length,4);chapters.push(...c.chapters);questions.push(...c.dilemmas);}
 assert.equal(new Set(chapters).size,120);assert.equal(new Set(questions.map(q=>q.id)).size,48);assert.equal(new Set(questions.map(q=>q.text)).size,48);
 for(const q of questions){assert.match(q.id,/^au-[a-z0-9-]{1,21}$/);assert.ok([1,2,3].includes(q.minStage));assert.equal(q.choices.length,2);assert.notEqual(q.choices[0].outcome,q.choices[1].outcome);for(const c of q.choices){assert.ok(c.label&&c.reason&&c.outcome);assert.deepEqual(Object.keys(c.delta).sort(),['bonds','energy','money','reputation']);assert.ok(Object.values(c.delta).every(Number.isSafeInteger));assert.equal(typeof c.exit,'boolean');}}
 assert.ok(pack.careers.find(c=>c.id==='craft-trader').dilemmas.some(q=>q.choices.some(c=>c.exit)));assert.match(pack.careers.find(c=>c.id==='household-care').entry,/家務協調/);assert.match(pack.careers.find(c=>c.id==='marine-store').entry,/技術|航行/);
});
test('AU 24 neutral relations have complete safe player-name chapters',()=>{
 assert.equal(pack.social.length,24);assert.equal(new Set(pack.social.map(s=>s.id)).size,24);const all=[];
 for(const s of pack.social){assert.match(s.id,/^[a-z0-9-]{1,16}$/);assert.ok(['neighbor','friend','colleague'].includes(s.role));assert.equal(typeof s.requiresCareer,'boolean');if(s.role==='colleague')assert.equal(s.requiresCareer,true);assert.equal(s.chapters.length,6);for(const t of s.chapters){assert.match(t,/\{name\}/);assert.ok([...t.matchAll(/\{([^}]+)\}/g)].every(m=>m[1]==='name'));assert.doesNotMatch(t,/外遇|背叛|欠你錢|犯罪|被捕|精神疾病/);}all.push(...s.chapters);}assert.equal(new Set(all).size,144);
});
test('AU reciprocal stories preserve identities through both outcomes',()=>{
 assert.deepEqual(pack.shared.map(s=>s.id),['moving','parcel','repair','market','umbrella','bookstore']);for(const s of pack.shared){assert.ok(s.title.length>5);assert.equal(s.choices.length,2);for(const t of [s.text,...s.choices.map(c=>c.outcome)]){assert.match(t,/\{owner\}/);assert.match(t,/\{guest\}/);assert.ok([...t.matchAll(/\{([^}]+)\}/g)].every(m=>['owner','guest'].includes(m[1])));}}
});
test('AU scoped education and seven primary sources do not award unearned qualifications',()=>{
 for(const key of ['name','description','startLabel','startOutcome','pauseOutcome','completeLabel','completeOutcome'])assert.equal(typeof pack.education[key],'string');assert.match(pack.education.description,/Year 10.*17歲/);assert.match(pack.education.description,/TAFE NSW/);assert.match(pack.education.completeOutcome,/完整資格.*全部要求/);
 assert.equal(pack.sources.length,7);assert.equal(new Set(pack.sources.map(s=>s.id)).size,7);for(const s of pack.sources){assert.equal(s.checkedAt,'2026-10-16');assert.ok(s.supports&&s.title);assert.match(s.url,/^https:\/\//);assert.match(new URL(s.url).hostname,/(?:nsw\.gov\.au|tafensw\.edu\.au|transportnsw\.info|botanicgardens\.org\.au)$/);}
});
