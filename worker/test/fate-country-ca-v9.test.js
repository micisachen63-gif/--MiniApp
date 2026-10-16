import test from 'node:test';
import assert from 'node:assert/strict';
import pack,{COUNTRY_PACK_CA} from '../public/fate/country-packs-v9/ca.js';
import us from '../public/fate/country-packs-v9/us.js';
import {TAIWAN_MEMORIES_V8} from '../public/fate/taiwan-content-v8.js';
import {TAIWAN_EXTRA_MEMORIES_V8} from '../public/fate/taiwan-days-extra-v8.js';
import {TAIWAN_RESERVE_MEMORIES_V8} from '../public/fate/taiwan-days-reserve-v8.js';

test('CA scope and fictional native currency household inputs',()=>{
 assert.equal(pack,COUNTRY_PACK_CA);assert.equal(pack.id,'CA');assert.equal(pack.cityId,'toronto');assert.equal(pack.currency,'CAD');assert.match(pack.scope,/安大略省多倫多市/);
 assert.deepEqual(pack.families.map(f=>f.id),['tight','ordinary','small-business','comfortable']);for(const f of pack.families){assert.ok(f.label&&f.text.length>30);assert.ok(Number.isSafeInteger(f.money)&&f.money>=0);assert.doesNotMatch(f.text,/真實平均|全球前|收入中位/);}
});
test('CA 1500 unique original daily entries, exact phases and no unearned adult relationships',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(pack.daily).map(([k,v])=>[k,v.length])),{child:120,youth:100,adult:720,late:420,any:140});
 const all=Object.values(pack.daily).flat();assert.equal(new Set(all).size,1500);assert.ok(all.every(t=>typeof t==='string'&&t.length>=12&&!/[{}]/.test(t)));
 const others=new Set([...Object.values(us.daily).flat(),...[...TAIWAN_MEMORIES_V8,...TAIWAN_EXTRA_MEMORIES_V8,...TAIWAN_RESERVE_MEMORIES_V8].map(x=>x.text)]);assert.deepEqual(all.filter(t=>others.has(t)),[]);
 assert.ok(all.filter(t=>/多倫多|TTC|街車|安大略|北約克|湖岸|聖勞倫斯|肯辛頓|士嘉堡/.test(t)).length>=40);
 for(const t of [...pack.daily.adult,...pack.daily.late])assert.doesNotMatch(t,/你的(?:丈夫|妻子|兒子|女兒)|開始服藥|診斷出|繳房貸|付租金|拿到學士|當上護理師/);
 for(const t of pack.daily.any)assert.doesNotMatch(t,/上班|下班|畢業|駕駛|房貸|信用卡|你的孩子/);
});
test('CA twelve distinct careers with 120 chapters and 48 concrete two-way choices',()=>{
 assert.equal(pack.careers.length,12);assert.equal(new Set(pack.careers.map(c=>c.id)).size,12);
 const chapter=[],dilemmas=[];for(const c of pack.careers){assert.match(c.id,/^[a-z0-9-]{1,20}$/);assert.ok([18,21].includes(c.minAge));assert.ok(c.practice.length>25&&c.entry.length>25);assert.equal(c.chapters.length,10);assert.equal(c.dilemmas.length,4);chapter.push(...c.chapters);dilemmas.push(...c.dilemmas);}
 assert.equal(new Set(chapter).size,120);assert.equal(new Set(dilemmas.map(d=>d.id)).size,48);assert.equal(new Set(dilemmas.map(d=>d.text)).size,48);
 for(const d of dilemmas){assert.match(d.id,/^ca-[a-z0-9-]{1,21}$/);assert.ok([1,2,3].includes(d.minStage));assert.equal(d.choices.length,2);assert.notEqual(d.choices[0].outcome,d.choices[1].outcome);for(const c of d.choices){assert.ok(c.label&&c.reason&&c.outcome);assert.deepEqual(Object.keys(c.delta).sort(),['bonds','energy','money','reputation']);assert.ok(Object.values(c.delta).every(Number.isSafeInteger));assert.equal(typeof c.exit,'boolean');}}
 assert.ok(pack.careers.find(c=>c.id==='craft-market').dilemmas.some(d=>d.choices.some(c=>c.exit)));assert.match(pack.careers.find(c=>c.id==='household-care').entry,/家庭協調/);
});
test('CA 24 safe named relation chains each have six usable chapters',()=>{
 assert.equal(pack.social.length,24);assert.equal(new Set(pack.social.map(s=>s.id)).size,24);const texts=[];
 for(const s of pack.social){assert.match(s.id,/^[a-z0-9-]{1,16}$/);assert.ok(['neighbor','friend','colleague'].includes(s.role));assert.equal(typeof s.requiresCareer,'boolean');if(s.role==='colleague')assert.equal(s.requiresCareer,true);assert.equal(s.chapters.length,6);for(const t of s.chapters){assert.match(t,/\{name\}/);assert.deepEqual([...t.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]).filter(x=>x!=='name'),[]);assert.doesNotMatch(t,/欠你錢|外遇|背叛|犯罪|被捕|精神疾病/);}texts.push(...s.chapters);}assert.equal(new Set(texts).size,144);
});
test('CA six reciprocal interactions preserve owner and guest through both outcomes',()=>{
 assert.deepEqual(pack.shared.map(s=>s.id),['moving','parcel','repair','market','umbrella','bookstore']);
 for(const s of pack.shared){assert.ok(s.title.length>5);assert.equal(s.choices.length,2);for(const t of [s.text,...s.choices.map(c=>c.outcome)]){assert.match(t,/\{owner\}/);assert.match(t,/\{guest\}/);assert.ok([...t.matchAll(/\{([^}]+)\}/g)].every(m=>['owner','guest'].includes(m[1])));}}
});
test('CA education does not promise OSSD or admission and seven primary sources are scoped',()=>{
 for(const k of ['name','description','startLabel','startOutcome','pauseOutcome','completeLabel','completeOutcome'])assert.equal(typeof pack.education[k],'string');assert.match(pack.education.description,/OSSD/);assert.match(pack.education.description,/不等於.*保證/);assert.match(pack.education.completeOutcome,/完整要求/);
 assert.equal(pack.sources.length,7);assert.equal(new Set(pack.sources.map(s=>s.id)).size,7);for(const s of pack.sources){assert.equal(s.checkedAt,'2026-10-16');assert.ok(s.supports&&s.title);assert.match(s.url,/^https:\/\//);assert.match(new URL(s.url).hostname,/(?:ontario\.ca|georgebrown\.ca|ttc\.ca|tpl\.ca|toronto\.ca)$/);}
});
