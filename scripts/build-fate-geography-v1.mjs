// Explicit development-time snapshot refresh only. Never imported by the game.
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const GEOGRAPHY_SOURCES=Object.freeze({
 countries:'https://api.worldbank.org/v2/country?format=json&per_page=400',
 population:'https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=1000&date=2023:2024',
 indicator:'https://data.worldbank.org/indicator/SP.POP.TOTL',
 populationDefinition:'https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.POP.TOTL',
 documentation:'https://datahelpdesk.worldbank.org/knowledgebase/articles/898590-country-api-queries',
 taiwan:'https://www.ris.gov.tw/info-liferay/app/channel/newsDetail/25010858',
 license:'https://creativecommons.org/licenses/by/4.0/'
});
// Verified in MOI Department of Household Registration's 2025-01-10 release,
// "民國113年12月戶口統計資料分析", paragraph 2. This is a separate source,
// not a guessed World Bank row or an income classification.
export const TAIWAN_POPULATION_2024=Object.freeze({iso2:'TW',iso3:'TWN',name:'臺灣',nameEnglish:'Taiwan',population:23400220,year:2024,incomeGroup:'INX',incomeGroupName:'Not classified',region:'EAS',source:'taiwan-moi',populationBasis:'registered-year-end'});
const cleanName=value=>typeof value==='string'&&value.length>0&&value.length<120&&!/[<>\u0000-\u001f\u007f]/u.test(value);
const positivePopulation=value=>Number.isSafeInteger(value)&&value>0;

export function buildPopulationSnapshot(countries,observations,{displayNames=new Intl.DisplayNames(['zh-Hant'],{type:'region'}),supplements=[]}={}){
 if(!Array.isArray(countries)||!Array.isArray(observations))throw new TypeError('Expected World Bank country and population arrays');
 const rows=[],excluded=[];
 for(const country of [...countries].sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0)){
  if(country.region?.id==='NA'){excluded.push({iso3:country.id,reason:'aggregate'});continue;}
  if(!/^[A-Z]{3}$/.test(country.id)||!/[A-Z]/.test(country.region?.id||'')||!/^[A-Z]{2}$/.test(country.iso2Code)||!cleanName(country.name)){
   excluded.push({iso3:country.id,reason:'invalid-country-metadata'});continue;
  }
  const values=observations.filter(row=>row.countryiso3code===country.id&&row.indicator?.id==='SP.POP.TOTL'&&positivePopulation(row.value));
  const chosen=values.find(row=>String(row.date)==='2024')||values.find(row=>String(row.date)==='2023');
  if(!chosen){excluded.push({iso3:country.id,reason:'no-positive-population-2024-or-2023'});continue;}
  const translated=displayNames.of(country.iso2Code),name=cleanName(translated)?translated:country.name;
  rows.push({iso2:country.iso2Code,iso3:country.id,name,nameEnglish:country.name,population:chosen.value,year:Number(chosen.date),incomeGroup:country.incomeLevel?.id||'INX',incomeGroupName:country.incomeLevel?.value||'Not classified',region:country.region.id,source:'world-bank',populationBasis:'de-facto-midyear'});
 }
 for(const supplement of supplements){
  if(!/^[A-Z]{2}$/.test(supplement.iso2)||!/^[A-Z]{3}$/.test(supplement.iso3)||!positivePopulation(supplement.population)||![2023,2024].includes(supplement.year)||!cleanName(supplement.name)||!cleanName(supplement.nameEnglish))throw new Error('Invalid supplemental population');
  if(rows.some(row=>row.iso2===supplement.iso2||row.iso3===supplement.iso3))throw new Error('Supplement must not replace a World Bank country/economy');
  rows.push({...supplement});
 }
 rows.sort((a,b)=>a.iso3<b.iso3?-1:a.iso3>b.iso3?1:0);
 if(new Set(rows.map(row=>row.iso3)).size!==rows.length||new Set(rows.map(row=>row.iso2)).size!==rows.length)throw new Error('Duplicate country identifier');
 const totalPopulation=rows.reduce((sum,row)=>sum+row.population,0);
 if(!Number.isSafeInteger(totalPopulation)||totalPopulation<=0)throw new Error('Empty or unsafe population total');
 return {rows,coverage:{primaryYear:2024,fallbackYear:2023,years:[...new Set(rows.map(row=>row.year))].sort(),countryCount:rows.length,totalPopulation,excluded,
  includesTaiwan:rows.some(row=>row.iso2==='TW'),completeGlobalCoverage:false,
  weighting:'population stock; not annual births or a forecast',
  populationBasisNote:'World Bank SP.POP.TOTL uses de facto residents and midyear estimates. Taiwan MOI supplement uses 2024-12-31 household-registered population. These different definitions and dates are combined only as approximate game sampling weights, not a harmonized census or birth-rate distribution.',
  limitation:'World Bank countries/economies with a positive 2024 population, falling back to 2023, plus explicitly attributed official supplements. Aggregates and missing populations are excluded; this is not a complete global census. Country income groups are metadata and do not determine an individual life. Taiwan has no invented World Bank income classification.'}};
}

export function renderGeographyModule(rows,coverage){
 return `// Frozen geography-v1 snapshot. Do not reorder or refresh in place after release.\n// New data or sampling changes require geography-v2 so old life seeds remain reproducible.\n// CC BY 4.0: World Bank, World Development Indicators, SP.POP.TOTL.\n// Taiwan supplement: Ministry of the Interior, Department of Household Registration, 2025-01-10.\nconst records=${JSON.stringify(rows,null,1)};\nexport const BIRTH_GEOGRAPHIES=Object.freeze(records.map(Object.freeze));\nconst coverage=${JSON.stringify(coverage,null,1)};\nObject.freeze(coverage.sources);Object.freeze(coverage.sha256);Object.freeze(coverage.years);for(const row of coverage.excluded)Object.freeze(row);Object.freeze(coverage.excluded);\nexport const GEOGRAPHY_COVERAGE=Object.freeze(coverage);\nconst cumulative=[];let total=0;for(const row of BIRTH_GEOGRAPHIES)cumulative.push(total+=row.population);\n// A salted 32-bit avalanche: one deterministic population-weighted draw per seed.\nfunction geographyUnit(seed){\n if(typeof seed!=='string'||!/^[a-f0-9]{8}$/i.test(seed))throw new TypeError('Expected an eight-digit life seed');\n let x=(Number.parseInt(seed,16)^0x6f726269)>>>0;\n x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);\n return ((x^(x>>>16))>>>0)/4294967296;\n}\nexport function birthGeography(seed){\n const point=geographyUnit(seed)*total;let low=0,high=cumulative.length-1;\n while(low<high){const mid=(low+high)>>>1;if(point<cumulative[mid])high=mid;else low=mid+1;}\n return BIRTH_GEOGRAPHIES[low];\n}\n`;
}

async function main(){
 const urls=[GEOGRAPHY_SOURCES.countries,GEOGRAPHY_SOURCES.population,GEOGRAPHY_SOURCES.taiwan];
 const responses=await Promise.all(urls.map(async(url,index)=>{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Official source response '+response.status);const body=await response.text();if(index===2){if(!body.includes('23,400,220')||!body.includes('113年12月'))throw new Error('Taiwan official source no longer confirms frozen 2024 value');return {body};}const data=JSON.parse(body);if(data[0]?.pages!==1||data[0]?.total!==data[1]?.length)throw new Error('Snapshot pagination incomplete');return {body,data};}));
 const built=buildPopulationSnapshot(responses[0].data[1],responses[1].data[1],{supplements:[TAIWAN_POPULATION_2024]});
 const coverage={...built.coverage,source:'World Bank · World Development Indicators + Taiwan Ministry of the Interior',indicator:'SP.POP.TOTL + MOI household registration',license:'World Bank: CC BY 4.0; Taiwan: attributed official population statistic',retrievedAt:new Date().toISOString(),populationSourceUpdatedAt:responses[1].data[0].lastupdated,taiwanSourcePublishedAt:'2025-01-10',sources:GEOGRAPHY_SOURCES,sha256:Object.fromEntries(['countries','population','taiwan'].map((key,i)=>[key,createHash('sha256').update(responses[i].body).digest('hex')]))};
 await writeFile(new URL('../worker/public/fate/geography-v1.js',import.meta.url),renderGeographyModule(built.rows,coverage));
 process.stdout.write(JSON.stringify({countries:coverage.countryCount,totalPopulation:coverage.totalPopulation,years:coverage.years,includesTaiwan:coverage.includesTaiwan,fallbacks:built.rows.filter(row=>row.year===2023).map(row=>row.iso3),excludedMissing:coverage.excluded.filter(row=>row.reason!=='aggregate'),updated:coverage.populationSourceUpdatedAt})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
