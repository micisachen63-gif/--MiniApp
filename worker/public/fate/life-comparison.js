import {WORLD_REFERENCES,COMPARISON_EDITION} from './world-comparison-data.js';
import {replayTaiwanLife} from './decision-engine-v8.js';
import {replayCountryLife} from './country-engine-v9.js';

export function convertMoney(value,currency){
 const quote=WORLD_REFERENCES.fx.quotes[currency];
 if(!Number.isFinite(value)||!quote)return null;
 const usd=quote.direction==='usd-per-unit'?value*quote.value:value/quote.value;
 return {native:value,currency,usd,twd:currency==='TWD'?value:usd*WORLD_REFERENCES.fx.quotes.TWD.value,date:WORLD_REFERENCES.fx.date};
}
export const formatTwd=value=>Number.isFinite(value)?'NT$ '+Math.round(value).toLocaleString('zh-TW'):'尚無換算資料';
export function compactTwd(value){
 if(!Number.isFinite(value))return '尚無換算資料';
 const a=Math.abs(value),sign=value<0?'-':'';
 return sign+'NT$ '+(a>=1e8?(a/1e8).toLocaleString('zh-TW',{maximumFractionDigits:1})+' 億':a>=1e4?(a/1e4).toLocaleString('zh-TW',{maximumFractionDigits:1})+' 萬':Math.round(a).toLocaleString('zh-TW'));
}
export function wealthBand(usd,{age=0}={}){
 if(!Number.isFinite(usd)||age<20)return null;
 // Negative balances are separate: the published four-band figure does not
 // supply a negative-net-worth percentage. Never interpolate a percentile.
 if(usd<0)return {id:'negative',label:'帳面負債超過資產',share:null};
 return WORLD_REFERENCES.wealth.bands.find(b=>usd>=b.min&&(b.max===null||usd<b.max))||null;
}
export function educationStatus(state){
 if(state.education==='bachelor'&&state.teacherDegreeCompleted===true)return {label:'已完成學士學位',tertiary:true};
 if(state.education==='course-completed')return {label:'已完成進修課程',tertiary:null};
 if(state.education==='studying'||state.trainingStarted||state.teacherStudyStarted)return {label:'仍在學習與實作',tertiary:null};
 if(state.education==='paused'||state.trainingPaused)return {label:'學習暫停，生活先行',tertiary:null};
 if(state.education==='college-course')return {label:'正在試讀課程',tertiary:null};
 if(state.education==='work-study')return {label:'工作與進修並行',tertiary:null};
 return {label:'求學路線尚在展開',tertiary:null};
}
export function compareLifeState(state,{country='TW',age=0,completed=false}={}){
 const currency=state.currency||(country==='TW'?'TWD':null),money=state.moneyNtd??state.money,debt=state.debtNtd??state.debt;
 const cash=convertMoney(money,currency),liability=convertMoney(debt,currency),net=convertMoney(Number.isFinite(money)&&Number.isFinite(debt)?money-debt:NaN,currency);
 const band=wealthBand(net?.usd,{age}),education=educationStatus(state),children=Number.isSafeInteger(state.children)&&state.children>0?state.children:0;
 const financeTitle=age<16?'家裡正在替你守住日常':!net?'先把生活的帳慢慢理清':net.twd<0?'手上的錢，還追不上帳單':debt>0?'有存款，也有還沒放下的帳單':net.usd>=100000?'有餘裕，能把時間留給自己':net.usd>=10000?'終於能對生活說：讓我想想':net.twd>0?'錢有留下，花之前還是會想一下':'口袋見底，日子仍要往前走';
 const paceTitle=age<16?'慢慢長大，日常就是整個世界':state.energy>=70?'忙完以後，還有力氣做自己':state.energy>=40?'日子排滿了，自己卻排在最後':'先把自己接住，再談下一步';
 const familyTitle=age<16&&!children?'你還在長大，也正在被照顧':children?`${children} 個孩子，把日子填得很滿`:state.childfreeByChoice?'這一段，選擇把時間留給自己':state.married?'有個人，和你一起面對日常':state.partnerCommitted?'開始習慣，做決定前想到另一個人':'一個人，也在學著把日子過好';
 const question=age<16?'如果能重來，你想把哪一段童年多留一點？':net?.twd<0?'如果能重來，你會先追夢，還是先留退路？':children?'忙著照顧別人時，你還留了多少時間給自己？':state.energy<40?'這一生你最想換回的，是存款還是時間？':'如果能重來，你想多存一點錢，還是多陪一個人？';
 return {edition:COMPARISON_EDITION,state,country,age,completed,cash,debt:liability,net,band,education,children,financeTitle,paceTitle,familyTitle,question,
  lifespan:completed?{age,reference:WORLD_REFERENCES.longevity.years,difference:Math.round((age-WORLD_REFERENCES.longevity.years)*10)/10}:null,
  shareLines:[financeTitle,net?`扣掉債務，約 ${compactTwd(net.twd)}`:'把生活的帳，慢慢理清',`走過 ${age} 歲 · ${children?`養育 ${children} 名孩子`:education.label}`]};
}
const results=new Map();
export function resultComparison(result){
 if(![8,9].includes(result?.version))return null;
 const key=JSON.stringify([result.version,result.country,result.seed,result.orbit,result.answers,result.auto]);
 if(results.has(key))return results.get(key);
 try{
  const run=(result.version===9?replayCountryLife:replayTaiwanLife)(result,{activeMs:7200000,autoFill:false});
  if(!run.completed)return null;
  const comparison=compareLifeState(run.state,{country:result.country,age:run.profile.deathAge,completed:true});
  results.set(key,comparison);if(results.size>128)results.delete(results.keys().next().value);return comparison;
 }catch{return null;}
}
