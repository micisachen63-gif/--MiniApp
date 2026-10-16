import test from 'node:test';
import assert from 'node:assert/strict';
import pack,{COUNTRY_PACK_FR} from '../public/fate/country-packs-v9/fr.js';
import gb from '../public/fate/country-packs-v9/gb.js';
import de from '../public/fate/country-packs-v9/de.js';
import {TAIWAN_MEMORIES_V8} from '../public/fate/taiwan-content-v8.js';
const daily=Object.values(pack.daily).flat();

test('FR has 1500 independent memories scoped explicitly to Paris and Montreuil',()=>{
 assert.equal(pack,COUNTRY_PACK_FR);assert.equal(pack.id,'FR');assert.equal(pack.cityId,'paris');assert.equal(pack.currency,'EUR');assert.match(pack.scope,/巴黎市/);assert.match(pack.scope,/蒙特勒伊/);assert.match(pack.scope,/Seine-Saint-Denis/);
 assert.deepEqual(Object.fromEntries(Object.entries(pack.daily).map(([key,items])=>[key,items.length])),{child:120,youth:100,adult:720,late:420,any:140});assert.equal(daily.length,1500);assert.equal(new Set(daily).size,1500);
 const other=new Set([...TAIWAN_MEMORIES_V8.map(row=>row.text),...Object.values(gb.daily).flat(),...Object.values(de.daily).flat()]);assert.ok(daily.every(text=>typeof text==='string'&&text.length>=12&&!other.has(text)));
 assert.doesNotMatch(daily.join('\n'),/星曆|城邦|白石神殿|英鎊|泰晤士|萊茵|科隆|感恩節|聖誕節到了|國慶日到了|普羅旺斯|馬賽海港/);
});

test('FR has four story budgets, twelve jobs, 120 chapters and 48 strict dilemmas',()=>{
 assert.deepEqual(pack.families.map(row=>row.id),['tight','ordinary','small-business','comfortable']);assert.ok(pack.families.every(row=>row.label&&row.text&&Number.isSafeInteger(row.money)&&row.money>=0));
 assert.equal(pack.careers.length,12);assert.equal(new Set(pack.careers.map(row=>row.id)).size,12);const ids=new Set(),chapters=[];
 for(const career of pack.careers){assert.match(career.id,/^[a-z][a-z-]{0,19}$/);assert.ok([18,21].includes(career.minAge));assert.ok(career.label&&career.practice&&career.entry);assert.equal(career.chapters.length,10);assert.equal(career.dilemmas.length,4);chapters.push(...career.chapters);
  for(const row of career.dilemmas){assert.match(row.id,/^[a-z][a-z-]{0,23}$/);assert.ok(!ids.has(row.id));ids.add(row.id);assert.ok(row.title&&row.text);assert.ok([1,2,3].includes(row.minStage));assert.equal(row.choices.length,2);assert.notEqual(row.choices[0].label,row.choices[1].label);
   for(const choice of row.choices){assert.deepEqual(Object.keys(choice).sort(),['delta','exit','label','outcome','reason']);assert.ok(choice.label&&choice.reason&&choice.outcome);assert.equal(typeof choice.exit,'boolean');assert.deepEqual(Object.keys(choice.delta).sort(),['bonds','energy','money','reputation']);assert.ok(Object.values(choice.delta).every(Number.isSafeInteger));assert.ok(Math.abs(choice.delta.money)<10000);}
  }
 }
 assert.equal(ids.size,48);assert.equal(new Set(chapters).size,120);assert.match(pack.careers.find(row=>row.id==='household-care').entry,/無薪/);assert.ok(pack.careers.some(row=>row.dilemmas.some(d=>d.choices.some(c=>c.exit))));assert.match(pack.careers.find(row=>row.id==='cafe-counter').entry,/訓練/);
});

test('FR relationships have 24 safe six-chapter chains and six reciprocal shared plots',()=>{
 assert.equal(pack.social.length,24);assert.equal(new Set(pack.social.map(row=>row.id)).size,24);const texts=[];
 for(const chain of pack.social){assert.match(chain.id,/^[a-z][a-z-]{0,15}$/);assert.ok(['neighbor','friend','colleague','relative-neutral'].includes(chain.role));assert.equal(typeof chain.requiresCareer,'boolean');assert.equal(chain.chapters.length,6);assert.ok(chain.chapters.every(text=>text.includes('{name}')));if(chain.role==='colleague')assert.equal(chain.requiresCareer,true);texts.push(...chain.chapters);}
 assert.equal(new Set(texts).size,144);assert.doesNotMatch(texts.join('\n'),/出軌|欠你|偷走|結婚|與你生下|詐騙你/);
 assert.deepEqual(pack.shared.map(row=>row.id),['moving','parcel','repair','market','umbrella','bookstore']);for(const row of pack.shared){assert.ok(row.title&&row.text.includes('{owner}')&&row.text.includes('{guest}'));assert.equal(row.choices.length,2);for(const choice of row.choices)assert.ok(choice.label&&choice.outcome.includes('{owner}')&&choice.outcome.includes('{guest}'));}
});

test('FR official sources keep training, qualifications and actual private states distinct',()=>{
 for(const key of ['name','description','startLabel','startOutcome','pauseOutcome','completeLabel','completeOutcome'])assert.ok(pack.education[key]);assert.match(pack.education.description,/16至18歲/);assert.match(pack.education.description,/CFA/);assert.match(pack.education.completeOutcome,/各自的課程/);
 assert.ok(pack.sources.length>=12);assert.equal(new Set(pack.sources.map(row=>row.id)).size,pack.sources.length);const domains=['education.gouv.fr','onisep.fr','service-public.gouv.fr','paris.fr','montreuil.fr','ratp.fr'];
 for(const source of pack.sources){assert.equal(source.checkedAt,'2026-10-16');assert.ok(source.title&&source.supports);assert.equal(new URL(source.url).protocol,'https:');assert.ok(domains.some(domain=>new URL(source.url).hostname===domain||new URL(source.url).hostname.endsWith('.'+domain)));}
 assert.doesNotMatch([...pack.daily.adult,...pack.daily.late].join('\n'),/你(?:的)?(?:妻子|丈夫|配偶|孫子|孫女)|你(?:已|終於)?(?:結婚|生下|取得學位|罹患|退休了)|你下班|你的房貸|你的月薪|你租的房|你的孩子/);
 assert.doesNotMatch(JSON.stringify(pack),/全球前\d|超過全球\d|法定月薪|必定取得學位|每名助手都需14小時/);
});

test('FR employment modes distinguish authored independent work from hired assistants and unpaid household care',()=>{
 const independent=pack.careers.filter(c=>c.employmentMode==='self-employed').map(c=>c.id);
 assert.deepEqual(independent,[]);
 for(const career of pack.careers){assert.ok(career.employmentMode===undefined||career.employmentMode==='self-employed');if(!independent.includes(career.id))assert.equal(career.employmentMode,undefined);}
 assert.equal(pack.careers.find(c=>c.id==='household-care').employmentMode,undefined);
});