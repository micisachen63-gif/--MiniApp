import test from 'node:test';
import assert from 'node:assert/strict';
import pack,{COUNTRY_PACK_US} from '../public/fate/country-packs-v9/us.js';
import {TAIWAN_MEMORIES_V8} from '../public/fate/taiwan-content-v8.js';
import {TAIWAN_EXTRA_MEMORIES_V8} from '../public/fate/taiwan-days-extra-v8.js';
import {TAIWAN_RESERVE_MEMORIES_V8} from '../public/fate/taiwan-days-reserve-v8.js';

test('US v9 is an explicit California Los Angeles scope with four fictional native-currency family budgets',()=>{
 assert.equal(pack,COUNTRY_PACK_US);assert.equal(pack.id,'US');assert.equal(pack.currency,'USD');assert.equal(pack.cityId,'los-angeles');assert.match(pack.scope,/加利福尼亞.*洛杉磯市/);assert.equal(pack.families.length,4);assert.deepEqual(pack.families.map(r=>r.id),['tight','ordinary','small-business','comfortable']);
 for(const family of pack.families){assert.ok(family.label.length>3&&family.text.length>30);assert.ok(Number.isSafeInteger(family.money)&&family.money>=0);assert.doesNotMatch(family.text,/百分位|全球前|平均薪資|中位數/);}
});

test('US v9 has 1500 unique independently stored daily observations in exact age windows without Taiwanese line reuse',()=>{
 const counts=Object.fromEntries(Object.entries(pack.daily).map(([phase,rows])=>[phase,rows.length]));assert.deepEqual(counts,{child:120,youth:100,adult:720,late:420,any:140});
 const all=Object.values(pack.daily).flat();assert.equal(all.length,1500);assert.equal(new Set(all).size,1500);assert.ok(all.every(text=>typeof text==='string'&&text.length>=12&&!/[{}]/.test(text)));
 const taiwan=new Set([...TAIWAN_MEMORIES_V8,...TAIWAN_EXTRA_MEMORIES_V8,...TAIWAN_RESERVE_MEMORIES_V8].map(row=>row.text));assert.ok(all.every(text=>!taiwan.has(text)));
 assert.ok(all.filter(text=>/洛杉磯|Metro|TAP|格里菲斯|中央圖書館|奧維拉|小東京|韓國城|博伊爾/.test(text)).length>=35);
 for(const text of [...pack.daily.adult,...pack.daily.late])assert.doesNotMatch(text,/你的(?:丈夫|妻子|兒子|女兒)|(?:診斷出|開始服藥|繳房貸|付租金|拿到學士|當上護理師)/);
 for(const text of pack.daily.any)assert.doesNotMatch(text,/上班|下班|畢業|駕駛|房貸|你的孩子|信用卡/);
});

test('US v9 has twelve distinct supervised-entry careers, 120 chronological chapters and 48 actual dilemmas',()=>{
 assert.equal(pack.careers.length,12);assert.equal(new Set(pack.careers.map(c=>c.id)).size,12);
 const chapterTexts=[],dilemmas=[];
 for(const career of pack.careers){assert.match(career.id,/^[a-z0-9-]{1,20}$/);assert.ok([18,21].includes(career.minAge));assert.ok(career.practice.length>25&&career.entry.length>25);assert.equal(career.chapters.length,10);assert.equal(career.dilemmas.length,4);chapterTexts.push(...career.chapters);dilemmas.push(...career.dilemmas);}
 assert.equal(new Set(chapterTexts).size,120);assert.equal(new Set(dilemmas.map(d=>d.id)).size,48);assert.equal(new Set(dilemmas.map(d=>d.text)).size,48);
 for(const d of dilemmas){assert.match(d.id,/^us-[a-z0-9-]{1,21}$/);assert.ok([1,2,3].includes(d.minStage));assert.equal(d.choices.length,2);assert.notEqual(d.choices[0].label,d.choices[1].label);assert.notEqual(d.choices[0].outcome,d.choices[1].outcome);for(const choice of d.choices){assert.ok(choice.reason&&choice.outcome);assert.deepEqual(Object.keys(choice.delta).sort(),['bonds','energy','money','reputation']);assert.ok(Object.values(choice.delta).every(Number.isSafeInteger));assert.equal(typeof choice.exit,'boolean');}}
 const vendor=pack.careers.find(c=>c.id==='street-vendor');assert.match(vendor.practice,/洛杉磯市.*許可/);assert.match(vendor.entry,/完成.*許可/);assert.ok(vendor.dilemmas.some(d=>d.choices.some(c=>c.exit)));
 assert.match(pack.careers.find(c=>c.id==='production-assist').entry,/助理|支援/);assert.doesNotMatch(pack.careers.map(c=>c.entry).join(''),/立即取得.*執照|自動成為.*教師/);
});

test('US v9 social cast is 24 six-step neutral fictional chains with safe name placeholders',()=>{
 assert.equal(pack.social.length,24);assert.equal(new Set(pack.social.map(s=>s.id)).size,24);
 const chapters=[];for(const chain of pack.social){assert.match(chain.id,/^[a-z0-9-]{1,16}$/);assert.ok(['neighbor','friend','colleague'].includes(chain.role));assert.equal(typeof chain.requiresCareer,'boolean');if(chain.role==='colleague')assert.equal(chain.requiresCareer,true);assert.equal(chain.chapters.length,6);for(const text of chain.chapters){assert.match(text,/\{name\}/);assert.ok(!text.includes('{owner}')&&!text.includes('{guest}'));assert.doesNotMatch(text,/欠你錢|偷竊|背叛|外遇|精神疾病|被捕|犯罪/);}chapters.push(...chain.chapters);}
 assert.equal(new Set(chapters).size,144);
});

test('US v9 has six reciprocal stories with only owner and guest placeholders',()=>{
 assert.deepEqual(pack.shared.map(s=>s.id),['moving','parcel','repair','market','umbrella','bookstore']);
 for(const story of pack.shared){assert.ok(story.title.length>5);assert.match(story.text,/\{owner\}/);assert.match(story.text,/\{guest\}/);assert.equal(story.choices.length,2);for(const text of [story.text,...story.choices.map(c=>c.outcome)]){assert.ok([...text.matchAll(/\{([^}]+)\}/g)].every(m=>['owner','guest'].includes(m[1])));assert.match(text,/\{owner\}/);assert.match(text,/\{guest\}/);assert.doesNotMatch(text,/偷|外遇|欠債|性騷擾/);}}
});

test('US v9 education and scoped research sources do not award unearned degrees or claim current salary statistics',()=>{
 for(const key of ['name','description','startLabel','startOutcome','pauseOutcome','completeLabel','completeOutcome'])assert.equal(typeof pack.education[key],'string');
 assert.match(pack.education.description,/社區學院/);assert.match(pack.education.description,/不等於|不保證/);assert.match(pack.education.completeOutcome,/不|沒有/);
 assert.ok(pack.sources.length>=6);assert.equal(new Set(pack.sources.map(s=>s.id)).size,pack.sources.length);for(const source of pack.sources){assert.equal(source.checkedAt,'2026-10-16');assert.ok(source.title&&source.supports);assert.match(source.url,/^https:\/\//);assert.match(new URL(source.url).hostname,/(?:universityofcalifornia\.edu|metro\.net|lapl\.org|lacity\.gov|ca\.gov)$/);}
});
