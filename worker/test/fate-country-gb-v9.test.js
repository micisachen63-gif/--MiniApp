import test from 'node:test';
import assert from 'node:assert/strict';
import pack,{COUNTRY_PACK_GB} from '../public/fate/country-packs-v9/gb.js';
import {TAIWAN_MEMORIES_V8} from '../public/fate/taiwan-content-v8.js';
const daily=Object.values(pack.daily).flat();
test('GB authors exactly 1500 distinct literal daily memories in the contracted windows',()=>{
 assert.equal(pack,COUNTRY_PACK_GB);assert.equal(pack.id,'GB');assert.equal(pack.cityId,'london');assert.equal(pack.currency,'GBP');assert.match(pack.scope,/英格蘭大倫敦/);assert.match(pack.scope,/蘇格蘭/);
 assert.deepEqual(Object.fromEntries(Object.entries(pack.daily).map(([key,items])=>[key,items.length])),{child:120,youth:100,adult:720,late:420,any:140});assert.equal(daily.length,1500);assert.equal(new Set(daily).size,daily.length);
 const taiwan=new Set(TAIWAN_MEMORIES_V8.map(row=>row.text));assert.ok(daily.every(text=>typeof text==='string'&&text.length>=12&&!taiwan.has(text)));assert.doesNotMatch(daily.join('\n'),/星曆|城邦|白石神殿|感恩節|健保卡|捷運/);
});
test('GB has four fictional family budgets and twelve staged careers with 120 gated chapters and 48 authored dilemmas',()=>{
 assert.deepEqual(pack.families.map(row=>row.id),['tight','ordinary','small-business','comfortable']);assert.ok(pack.families.every(row=>row.label&&row.text&&Number.isSafeInteger(row.money)&&row.money>=0));assert.equal(pack.careers.length,12);assert.equal(new Set(pack.careers.map(row=>row.id)).size,12);
 const ids=new Set(),texts=[];for(const career of pack.careers){assert.match(career.id,/^[a-z][a-z-]{0,19}$/);assert.ok([18,21].includes(career.minAge));assert.ok(career.label&&career.practice&&career.entry);assert.equal(career.chapters.length,10);assert.equal(career.dilemmas.length,4);texts.push(...career.chapters);
  for(const row of career.dilemmas){assert.match(row.id,/^[a-z][a-z-]{0,23}$/);assert.ok(!ids.has(row.id));ids.add(row.id);assert.ok(row.title&&row.text);assert.ok([1,2,3].includes(row.minStage));assert.equal(row.choices.length,2);assert.notEqual(row.choices[0].label,row.choices[1].label);for(const choice of row.choices){assert.deepEqual(Object.keys(choice).sort(),['delta','exit','label','outcome','reason']);assert.ok(choice.label&&choice.reason&&choice.outcome);assert.equal(typeof choice.exit,'boolean');assert.deepEqual(Object.keys(choice.delta).sort(),['bonds','energy','money','reputation']);assert.ok(Object.values(choice.delta).every(Number.isSafeInteger));}}
 }
 assert.equal(ids.size,48);assert.equal(texts.length,120);assert.equal(new Set(texts).size,120);assert.ok(pack.careers.find(row=>row.id==='household-care').entry.includes('無薪'));
});
test('GB relationships have 24 neutral six-chapter chains and six safe reciprocal shared stories',()=>{
 assert.equal(pack.social.length,24);assert.equal(new Set(pack.social.map(row=>row.id)).size,24);const texts=[];for(const chain of pack.social){assert.match(chain.id,/^[a-z][a-z-]{0,15}$/);assert.ok(['neighbor','friend','colleague','relative-neutral'].includes(chain.role));assert.equal(typeof chain.requiresCareer,'boolean');assert.equal(chain.chapters.length,6);assert.ok(chain.chapters.every(text=>text.includes('{name}')));texts.push(...chain.chapters);}
 assert.equal(texts.length,144);assert.equal(new Set(texts).size,144);assert.deepEqual(pack.shared.map(row=>row.id),['moving','parcel','repair','market','umbrella','bookstore']);for(const row of pack.shared){assert.ok(row.title&&row.text.includes('{owner}')&&row.text.includes('{guest}'));assert.equal(row.choices.length,2);for(const choice of row.choices)assert.ok(choice.label&&choice.outcome.includes('{owner}')&&choice.outcome.includes('{guest}'));}
});
test('GB education is scoped to England, official sources are attributable and daily life never grants private milestones',()=>{
 for(const key of ['name','description','startLabel','startOutcome','pauseOutcome','completeLabel','completeOutcome'])assert.ok(pack.education[key]);assert.match(pack.education.description,/18歲/);assert.match(pack.education.completeOutcome,/不一概等同大學學位/);assert.ok(pack.sources.length>=12);assert.equal(new Set(pack.sources.map(row=>row.id)).size,pack.sources.length);
 const domains=['gov.uk','nationalcareers.service.gov.uk','food.gov.uk','hackney.gov.uk','tfl.gov.uk','royalparks.org.uk','southbankcentre.co.uk','londonmuseum.org.uk','bl.uk','jobs.nationaltheatre.org.uk'];for(const source of pack.sources){assert.ok(source.title&&source.supports);assert.equal(source.checkedAt,'2026-10-16');assert.equal(new URL(source.url).protocol,'https:');assert.ok(domains.some(domain=>new URL(source.url).hostname===domain||new URL(source.url).hostname.endsWith('.'+domain)));}
 assert.doesNotMatch([...pack.daily.adult,...pack.daily.late].join('\n'),/你(?:的)?(?:妻子|丈夫|配偶|孫子|孫女)|你(?:已|終於)?(?:結婚|生下|取得學位|罹患|退休了)|你下班|你的房貸|你的薪水/);
});

test('GB employment modes distinguish authored independent work from hired assistants and unpaid household care',()=>{
 const independent=pack.careers.filter(c=>c.employmentMode==='self-employed').map(c=>c.id);
 assert.deepEqual(independent,['textile-mender']);
 for(const career of pack.careers){assert.ok(career.employmentMode===undefined||career.employmentMode==='self-employed');if(!independent.includes(career.id))assert.equal(career.employmentMode,undefined);}
 assert.equal(pack.careers.find(c=>c.id==='household-care').employmentMode,undefined);
});