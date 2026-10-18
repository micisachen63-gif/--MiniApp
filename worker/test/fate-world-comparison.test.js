import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_REFERENCES} from '../public/fate/world-comparison-data.js';
import {convertMoney,wealthBand,educationStatus,compareLifeState,resultComparison,formatTwd,compactTwd} from '../public/fate/life-comparison.js';
import {ensureCountryPack,COUNTRY_METADATA_V9} from '../public/fate/country-runtime-v9.js';
import {replayCountryLife} from '../public/fate/country-engine-v9.js';
import {replayTaiwanLife} from '../public/fate/decision-engine-v8.js';
import {encodeResult,decodeResult,shareText} from '../public/fate/model.js';
import {cardConversation} from '../public/fate/share-card-layout.js';
import {drawShareCard} from '../public/fate/share-ui.js';
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const state={money:100000,debt:20000,currency:'TWD',energy:72,education:'not-selected',children:0};
function complete(country,seed='deadbeef'){
 const life={version:country==='TW'?8:9,country,orbit:3,seed,answers:[],auto:[]},run=(life.version===8?replayTaiwanLife:replayCountryLife)(life,{activeMs:7200000,autoFill:true});
 return {run,result:decodeResult(encodeResult({...life,answers:run.answers,auto:run.auto,zodiac:8}))};
}
test('exchange snapshot handles both Fed quote directions for all ten country currencies and preserves signs',()=>{
 for(const [currency,quote]of Object.entries(WORLD_REFERENCES.fx.quotes)){
  const hundredDollars=quote.direction==='usd-per-unit'?100/quote.value:100*quote.value;
  const value=convertMoney(hundredDollars,currency);approx(value.usd,100);approx(value.twd,3194);assert.equal(value.date,'2026-10-09');approx(convertMoney(-hundredDollars,currency).twd,-3194);
 }
 assert.equal(convertMoney(1000,'TWD').twd,1000);approx(convertMoney(100,'GBP').twd,100*1.3229*31.94);approx(convertMoney(100,'AUD').twd,100*.6979*31.94);
 for(const n of [NaN,Infinity,-Infinity,undefined])assert.equal(convertMoney(n,'USD'),null);assert.equal(convertMoney(50,'FAKE'),null);
});
test('wealth bands use exact published boundaries, age gate and separate unranked negative balances',()=>{
 for(const [value,id]of [[0,'under10k'],[9999.99,'under10k'],[10000,'10k100k'],[99999.99,'10k100k'],[100000,'100k1m'],[999999.99,'100k1m'],[1000000,'over1m']])assert.equal(wealthBand(value,{age:20}).id,id);
 assert.equal(wealthBand(-1,{age:40}).share,null);assert.equal(wealthBand(1e9,{age:19}),null);assert.equal(wealthBand(NaN,{age:40}),null);
 assert.equal(WORLD_REFERENCES.wealth.bands.reduce((n,b)=>n+b.share,0),100);assert.deepEqual(WORLD_REFERENCES.wealth.bands.map(b=>b.share),[41.3,40.7,16.4,1.6]);assert.equal(Object.isFrozen(WORLD_REFERENCES.fx.quotes),true);
});
test('net balance subtracts debt once, supports all source accounting fields and never substitutes a missing currency',()=>{
 const tw=compareLifeState({...state,moneyNtd:125000,debtNtd:85000},{country:'TW',age:30});assert.equal(tw.net.twd,40000);assert.equal(tw.cash.twd,125000);assert.equal(tw.debt.twd,85000);
 const us=compareLifeState({...state,money:10000,debt:20000,currency:'USD'},{country:'US',age:30});assert.equal(us.net.twd,-319400);assert.equal(us.band.id,'negative');assert.match(us.financeTitle,/追不上帳單/);
 assert.equal(compareLifeState({...state,currency:undefined},{country:'JP',age:40}).net,null);assert.doesNotMatch(JSON.stringify(compareLifeState({...state,currency:'FAKE'})),/NaN|Infinity/);
 assert.equal(formatTwd(125000),'NT$ 125,000');assert.equal(compactTwd(-125000),'-NT$ 12.5 萬');
});
test('education references cannot convert knowledge or an unfinished course into a degree',()=>{
 for(const patch of [{knowledge:100},{education:'bachelor'},{education:'course-completed'},{education:'studying'},{teacherDegreeCompleted:true}])assert.notEqual(educationStatus({...state,...patch}).tertiary,true);
 assert.equal(educationStatus({...state,education:'bachelor',teacherDegreeCompleted:true}).tertiary,true);
});
test('living comparisons do not expose the future death age or invent a health percentile',()=>{
 const living=compareLifeState(state,{country:'TW',age:12});assert.equal(living.lifespan,null);assert.equal(living.band,null);assert.match(living.financeTitle,/家裡/);assert.match(living.question,/童年/);assert.doesNotMatch(JSON.stringify(living),/deathAge|percentile|排名/);
 const ended=compareLifeState(state,{country:'TW',age:80,completed:true});assert.equal(ended.lifespan.difference,6.7);assert.equal(ended.lifespan.reference,73.3);
});
test('family descriptions follow the actual story facts without assigning a child or partner',()=>{
 assert.match(compareLifeState(state,{age:30}).familyTitle,/一個人/);assert.match(compareLifeState({...state,children:2}).familyTitle,/2 個孩子/);
 assert.match(compareLifeState({...state,married:true},{age:30}).familyTitle,/一起/);assert.match(compareLifeState({...state,childfreeByChoice:true},{age:30}).familyTitle,/留給自己/);
});
test('all ten completed country lives use their own currency and the same public snapshot across PNG, caption and replay',async()=>{
 for(const country of ['TW',...Object.keys(COUNTRY_METADATA_V9)]){
  if(country!=='TW')await ensureCountryPack(country);
  const {run,result}=complete(country),copy=resultComparison(result);assert.ok(copy,country);assert.equal(copy.age,run.profile.deathAge);assert.equal(copy.completed,true);
  const currency=country==='TW'?'TWD':COUNTRY_METADATA_V9[country].currency;assert.equal(copy.cash.currency,currency);approx(copy.net.twd,convertMoney((run.state.moneyNtd??run.state.money)-(run.state.debtNtd??run.state.debt),currency).twd);
  assert.deepEqual(cardConversation(result).lines,copy.shareLines);assert.ok(shareText(result).includes(copy.question));assert.ok(shareText(result).includes(copy.shareLines[1]));
  assert.deepEqual(resultComparison({...result,birthDate:'1990-01-01',birthTime:'08:35',tgId:'secret-account'}),copy);assert.doesNotMatch(shareText(result),/1990-01-01|08:35|secret-account|百分位/);
 }
});
test('legacy results keep their original share layout and unknown future answers cannot produce a comparison',()=>{
 const old=decodeResult('f43010001x9c61a7d2');assert.equal(resultComparison(old),null);assert.equal(cardConversation(old),null);assert.ok(shareText(old).includes(old.ending.quote));
 assert.equal(resultComparison({version:8,country:'TW',orbit:3,seed:'deadbeef',answers:[],auto:[]}),null);
});
test('completed browser card draws the actual three life lines and discussion question without chart data or private profile',async()=>{
 const {result}=complete('TW'),comparison=resultComparison(result),drawn=[];
 const gradient={addColorStop(){}},ctx={fillRect(){},drawImage(){},strokeRect(){},createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,beginPath(){},moveTo(){},lineTo(){},stroke(){},measureText:text=>({width:[...text].length*20}),fillText:(...args)=>drawn.push(args)};
 class Picture{constructor(){this.width=1080;this.height=900;}async decode(){}}
 const document={fonts:{ready:Promise.resolve()},createElement:()=>({getContext:()=>ctx,toBlob:fn=>fn(new Blob(['png']))})};
 for(const format of ['post','story']){await drawShareCard(result,format,{ImageType:Picture,document});for(const line of comparison.shareLines)assert.ok(drawn.some(x=>x[0]===line));assert.ok(drawn.some(x=>x[0]===comparison.question));}
 assert.ok(drawn.filter(x=>comparison.shareLines.includes(x[0])).every(x=>x[3]===880));assert.ok(!drawn.some(x=>/UBS|WHO|41\.3%/.test(x[0])));
});
test('result pages mount the same collapsible statistics and both public caches use the new version',()=>{
 const app=readFileSync(new URL('../public/fate/app.js',import.meta.url),'utf8'),index=readFileSync(new URL('../public/fate/index.html',import.meta.url),'utf8'),publicPage=readFileSync(new URL('../src/fate-public.js',import.meta.url),'utf8');
 assert.match(app,/renderLifeStatus\(p,result\)/);assert.match(index,/20261018-world1/);assert.match(publicPage,/20261018-world1/);
});
