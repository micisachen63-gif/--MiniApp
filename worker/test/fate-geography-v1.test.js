import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {birthGeography,BIRTH_GEOGRAPHIES,GEOGRAPHY_COVERAGE} from '../public/fate/geography-v1.js';
import {buildPopulationSnapshot,TAIWAN_POPULATION_2024} from '../../scripts/build-fate-geography-v1.mjs';

const country=(id,iso2Code,extra={})=>({id,iso2Code,name:id+' country',region:{id:'EAS'},incomeLevel:{id:'HIC',value:'High income'},...extra});
const population=(iso3,year,value)=>({countryiso3code:iso3,date:String(year),value,indicator:{id:'SP.POP.TOTL'}});

test('snapshot builder excludes aggregates, missing or zero population, and never substitutes an older unspecified year',()=>{
 const countries=[country('AAA','JP'),country('BBB','US'),country('CCC','GB'),country('DDD','FR'),country('WLD','WO',{region:{id:'NA'}})];
 const observations=[population('AAA',2024,0),population('AAA',2023,50),population('AAA',2022,999),population('BBB',2023,7),population('BBB',2024,10),population('CCC',2024,null),population('DDD',2022,30),population('WLD',2024,9000000000)];
 const result=buildPopulationSnapshot(countries,observations);
 assert.deepEqual(result.rows.map(row=>[row.iso3,row.population,row.year]),[['AAA',50,2023],['BBB',10,2024]]);
 assert.equal(result.coverage.totalPopulation,60);
 assert.deepEqual(result.coverage.excluded,[{iso3:'CCC',reason:'no-positive-population-2024-or-2023'},{iso3:'DDD',reason:'no-positive-population-2024-or-2023'},{iso3:'WLD',reason:'aggregate'}]);
});

test('the frozen official snapshot contains safe unique country/economy records with attributed coverage',()=>{
 assert.equal(BIRTH_GEOGRAPHIES.length,218);
 assert.equal(GEOGRAPHY_COVERAGE.totalPopulation,8140884844);
 assert.equal(BIRTH_GEOGRAPHIES.filter(row=>row.source==='world-bank').reduce((sum,row)=>sum+row.population,0),8117484624);
 assert.equal(BIRTH_GEOGRAPHIES.reduce((sum,row)=>sum+row.population,0),GEOGRAPHY_COVERAGE.totalPopulation);
 assert.equal(new Set(BIRTH_GEOGRAPHIES.map(row=>row.iso3)).size,BIRTH_GEOGRAPHIES.length);
 assert.equal(new Set(BIRTH_GEOGRAPHIES.map(row=>row.iso2)).size,BIRTH_GEOGRAPHIES.length);
 const aggregateIds=new Set(GEOGRAPHY_COVERAGE.excluded.filter(row=>row.reason==='aggregate').map(row=>row.iso3));
 assert.ok(aggregateIds.has('WLD'));assert.ok(aggregateIds.has('AFE'));
 for(const row of BIRTH_GEOGRAPHIES){
  assert.match(row.iso2,/^[A-Z]{2}$/);assert.match(row.iso3,/^[A-Z]{3}$/);
  assert.ok(!aggregateIds.has(row.iso3));assert.notEqual(row.region,'NA');
  assert.ok(Number.isSafeInteger(row.population)&&row.population>0);assert.equal(row.year,2024);
  for(const key of ['name','nameEnglish','incomeGroupName'])assert.ok(row[key].length>0&&!/[<>\u0000-\u001f\u007f]/u.test(row[key]));
  assert.ok(Object.isFrozen(row));
 }
 assert.equal(GEOGRAPHY_COVERAGE.completeGlobalCoverage,false);
 assert.equal(GEOGRAPHY_COVERAGE.includesTaiwan,true);
 assert.equal(BIRTH_GEOGRAPHIES.filter(row=>row.iso2==='TW').length,1);
 assert.match(GEOGRAPHY_COVERAGE.sources.population,/api\.worldbank\.org/);
 assert.match(GEOGRAPHY_COVERAGE.indicator,/SP\.POP\.TOTL/);
 assert.match(GEOGRAPHY_COVERAGE.sha256.population,/^[a-f0-9]{64}$/);
 assert.ok(Object.isFrozen(BIRTH_GEOGRAPHIES));assert.ok(Object.isFrozen(GEOGRAPHY_COVERAGE));
});

test('country draws remain stable for an existing seed and cannot read a birth profile',()=>{
 for(const [seed,iso3]of [['00000000','IND'],['deadbeef','THA'],['ffffffff','CHN'],['12345678','PHL']]){
  assert.equal(birthGeography(seed).iso3,iso3);assert.equal(birthGeography(seed),birthGeography(seed));
  assert.equal(birthGeography(seed.toUpperCase()).iso3,iso3);
 }
 for(const input of [null,0,{}, {seed:'deadbeef',birthDate:'2000-01-01'},'','abc','notaseed'])assert.throws(()=>birthGeography(input),TypeError);
 assert.throws(()=>{birthGeography('deadbeef').population=1;},TypeError);
 const source=readFileSync(new URL('../public/fate/geography-v1.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|birthDate|birthPlace/);
});

test('a broad deterministic seed sample follows population weights rather than equal country odds',()=>{
 const count=65536,tallies=new Map();
 for(let i=0;i<count;i++){const row=birthGeography(i.toString(16).padStart(8,'0'));tallies.set(row.iso3,(tallies.get(row.iso3)||0)+1);}
 for(const iso3 of ['IND','CHN','USA']){
  const row=BIRTH_GEOGRAPHIES.find(row=>row.iso3===iso3),expected=row.population/GEOGRAPHY_COVERAGE.totalPopulation,observed=tallies.get(iso3)/count;
  assert.ok(Math.abs(expected-observed)<0.006,`${iso3}: expected ${expected}, observed ${observed}`);
 }
 assert.ok(tallies.get('IND')>tallies.get('USA')*3);
});

test('unsafe metadata is excluded instead of becoming executable display content',()=>{
 const countries=[country('AAA','JP',{name:'<img src=x onerror=alert(1)>'}),country('BBB','US')];
 const result=buildPopulationSnapshot(countries,[population('AAA',2024,100),population('BBB',2024,200)],{displayNames:{of:()=>'<unsafe>'}});
 assert.deepEqual(result.rows.map(row=>row.iso3),['BBB']);assert.equal(result.rows[0].name,'BBB country');
 assert.equal(result.coverage.excluded[0].reason,'invalid-country-metadata');
});

test('Taiwan is an explicit official year-end supplement, never a replacement or fabricated World Bank income group',()=>{
 const countries=[country('JPN','JP')],observations=[population('JPN',2024,100)];
 const original=buildPopulationSnapshot(countries,observations),supplemented=buildPopulationSnapshot(countries,observations,{supplements:[TAIWAN_POPULATION_2024]});
 assert.deepEqual(supplemented.rows.find(row=>row.iso3==='JPN'),original.rows[0]);
 assert.equal(supplemented.coverage.totalPopulation-original.coverage.totalPopulation,23400220);
 assert.throws(()=>buildPopulationSnapshot(countries,observations,{supplements:[{...TAIWAN_POPULATION_2024,iso3:'JPN',iso2:'JP'}]}),/must not replace/);
 const taiwan=BIRTH_GEOGRAPHIES.find(row=>row.iso2==='TW');
 assert.deepEqual(taiwan,TAIWAN_POPULATION_2024);assert.equal(taiwan.name,'臺灣');assert.equal(taiwan.population,23400220);assert.equal(taiwan.incomeGroup,'INX');
 assert.equal(taiwan.populationBasis,'registered-year-end');assert.equal(taiwan.source,'taiwan-moi');
 assert.equal(birthGeography('00000447').iso3,'TWN');
 assert.match(GEOGRAPHY_COVERAGE.sources.taiwan,/^https:\/\/www\.ris\.gov\.tw\//);
 assert.match(GEOGRAPHY_COVERAGE.populationBasisNote,/de facto.*midyear.*registered.*different definitions/);
 assert.match(GEOGRAPHY_COVERAGE.sha256.taiwan,/^[a-f0-9]{64}$/);
});
