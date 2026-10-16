import test from 'node:test';
import assert from 'node:assert/strict';
import pack,{COUNTRY_PACK_DE} from '../public/fate/country-packs-v9/de.js';
import gb from '../public/fate/country-packs-v9/gb.js';
import {TAIWAN_MEMORIES_V8} from '../public/fate/taiwan-content-v8.js';
const daily=Object.values(pack.daily).flat();

test('DE has 1500 independently stored unique memories scoped to NRW Cologne',()=>{
 assert.equal(pack,COUNTRY_PACK_DE);assert.equal(pack.id,'DE');assert.equal(pack.cityId,'cologne');assert.equal(pack.currency,'EUR');assert.match(pack.scope,/北萊茵/);assert.match(pack.scope,/科隆市範圍/);
 assert.deepEqual(Object.fromEntries(Object.entries(pack.daily).map(([key,items])=>[key,items.length])),{child:120,youth:100,adult:720,late:420,any:140});assert.equal(daily.length,1500);assert.equal(new Set(daily).size,1500);
 const other=new Set([...TAIWAN_MEMORIES_V8.map(row=>row.text),...Object.values(gb.daily).flat()]);assert.ok(daily.every(text=>typeof text==='string'&&text.length>=12&&!other.has(text)));
 assert.doesNotMatch(daily.join('\n'),/星曆|城邦|白石神殿|英鎊|泰晤士|感恩節|中秋|聖誕節到了|狂歡節到了|慕尼黑啤酒節/);
});

test('DE has four fictional EUR budgets, twelve staged careers and 48 genuinely selectable dilemmas',()=>{
 assert.deepEqual(pack.families.map(row=>row.id),['tight','ordinary','small-business','comfortable']);assert.ok(pack.families.every(row=>row.label&&row.text&&Number.isSafeInteger(row.money)&&row.money>=0));
 assert.equal(pack.careers.length,12);assert.equal(new Set(pack.careers.map(row=>row.id)).size,12);const ids=new Set(),chapters=[];
 for(const career of pack.careers){assert.match(career.id,/^[a-z][a-z-]{0,19}$/);assert.ok([18,21].includes(career.minAge));assert.ok(career.label&&career.practice&&career.entry);assert.equal(career.chapters.length,10);assert.equal(career.dilemmas.length,4);chapters.push(...career.chapters);
  for(const row of career.dilemmas){assert.match(row.id,/^[a-z][a-z-]{0,23}$/);assert.ok(!ids.has(row.id));ids.add(row.id);assert.ok(row.title&&row.text);assert.ok([1,2,3].includes(row.minStage));assert.equal(row.choices.length,2);assert.notEqual(row.choices[0].label,row.choices[1].label);
   for(const choice of row.choices){assert.deepEqual(Object.keys(choice).sort(),['delta','exit','label','outcome','reason']);assert.ok(choice.label&&choice.reason&&choice.outcome);assert.equal(typeof choice.exit,'boolean');assert.deepEqual(Object.keys(choice.delta).sort(),['bonds','energy','money','reputation']);assert.ok(Object.values(choice.delta).every(Number.isSafeInteger));assert.ok(Math.abs(choice.delta.money)<10000);}
  }
 }
 assert.equal(ids.size,48);assert.equal(new Set(chapters).size,120);assert.match(pack.careers.find(row=>row.id==='household-care').entry,/無薪/);assert.ok(pack.careers.some(row=>row.dilemmas.some(d=>d.choices.some(c=>c.exit))));assert.match(pack.careers.find(row=>row.id==='bakery-sales').entry,/衛生告知/);
});

test('DE social chains are neutral, literal and participant-complete',()=>{
 assert.equal(pack.social.length,24);assert.equal(new Set(pack.social.map(row=>row.id)).size,24);const texts=[];
 for(const chain of pack.social){assert.match(chain.id,/^[a-z][a-z-]{0,15}$/);assert.ok(['neighbor','friend','colleague','relative-neutral'].includes(chain.role));assert.equal(typeof chain.requiresCareer,'boolean');assert.equal(chain.chapters.length,6);assert.ok(chain.chapters.every(text=>text.includes('{name}')));if(chain.role==='colleague')assert.equal(chain.requiresCareer,true);texts.push(...chain.chapters);}
 assert.equal(new Set(texts).size,144);assert.doesNotMatch(texts.join('\n'),/出軌|欠你|偷走|結婚|與你生下|詐騙你/);
 assert.deepEqual(pack.shared.map(row=>row.id),['moving','parcel','repair','market','umbrella','bookstore']);for(const row of pack.shared){assert.ok(row.title&&row.text.includes('{owner}')&&row.text.includes('{guest}'));assert.equal(row.choices.length,2);for(const choice of row.choices)assert.ok(choice.label&&choice.outcome.includes('{owner}')&&choice.outcome.includes('{guest}'));}
});

test('DE sources and education distinguish actual local training from degrees and private milestones',()=>{
 for(const key of ['name','description','startLabel','startOutcome','pauseOutcome','completeLabel','completeOutcome'])assert.ok(pack.education[key]);assert.match(pack.education.name,/北威州/);assert.match(pack.education.description,/職業學校/);assert.match(pack.education.completeOutcome,/各有自己的完成條件/);
 assert.ok(pack.sources.length>=12);assert.equal(new Set(pack.sources.map(row=>row.id)).size,pack.sources.length);const domains=['recht.nrw.de','arbeitsagentur.de','stadt-koeln.de','ihk.de','kvb.koeln','umweltbundesamt.de','museum-ludwig.de'];
 for(const source of pack.sources){assert.equal(source.checkedAt,'2026-10-16');assert.ok(source.title&&source.supports);assert.equal(new URL(source.url).protocol,'https:');assert.ok(domains.some(domain=>new URL(source.url).hostname===domain||new URL(source.url).hostname.endsWith('.'+domain)));}
 assert.doesNotMatch([...pack.daily.adult,...pack.daily.late].join('\n'),/你(?:的)?(?:妻子|丈夫|配偶|孫子|孫女)|你(?:已|終於)?(?:結婚|生下|取得學位|罹患|退休了)|你下班|你的房貸|你的月薪|你租的房|你的孩子/);
 assert.doesNotMatch(JSON.stringify(pack),/全球前\d|超過全球\d|法定月薪|必定取得學位|全德國一律/);
});

test('DE employment modes distinguish authored independent work from hired assistants and unpaid household care',()=>{
 const independent=pack.careers.filter(c=>c.employmentMode==='self-employed').map(c=>c.id);
 assert.deepEqual(independent,[]);
 for(const career of pack.careers){assert.ok(career.employmentMode===undefined||career.employmentMode==='self-employed');if(!independent.includes(career.id))assert.equal(career.employmentMode,undefined);}
 assert.equal(pack.careers.find(c=>c.id==='household-care').employmentMode,undefined);
});