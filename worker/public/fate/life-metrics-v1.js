import {hash} from './world.js';
import {birthGeography} from './geography-v1.js';

// Immutable simulation recipe 1. Sources are frozen snapshots, never runtime API calls.
// Survey bands, educational completion rates and fertility are different measures.
// The generated biography is fiction; these anchors are not individual predictions.
export const METRIC_REFERENCE=Object.freeze({
 version:1,usdTwd:31.438,fxDate:'2025-12-31',monthlyLivingTwd:319676/12,
 wealth:Object.freeze([{min:0,max:10000,share:40.7},{min:10000,max:100000,share:41.3},{min:100000,max:1000000,share:16.4},{min:1000000,max:Infinity,share:1.6}].map(Object.freeze)),
 education:Object.freeze([{label:'國小',rate:88},{label:'國中',rate:78},{label:'高中職',rate:61},{label:'大專以上',rate:24}].map(Object.freeze)),
 fertility:2.25,
 sources:Object.freeze([
  {label:'UBS 全球財富報告 2025',year:'2024',url:'https://www.ubs.com/content/dam/assets/wm/static/noindex/gwr-2025-digital-updated.pdf',detail:'第22頁：成人淨資產四級距，40.7／41.3／16.4／1.6%；報告樣本市場，並非全球所有人口。'},
  {label:'UNESCO 全球教育監測報告',year:'2024',url:'https://www.unesco.org/reports/gem-report/en/2026-monitoring-sdg4',detail:'國小88%、國中78%、高中61%是各對應年齡群完成率，不能相加為學歷分布。'},
  {label:'UNESCO 大專教育取得',year:'2024',url:'https://www.unesco.org/reports/gem-report/en/2026-access-equity',detail:'25–34歲大專取得24%；與基礎教育完成率不是同一批人。'},
  {label:'聯合國 世界人口展望',year:'2024',url:'https://www.un.org/en/global-issues/population',detail:'全球總生育率2.25作為家庭模型參數；不是實際子女人數分布、不是每戶平均。'},
  {label:'臺灣中央銀行 美元收盤匯率',year:'2025-12-31',url:'https://www.cbc.gov.tw/tw/cp-645-189617-bdbd0-1.html',detail:'1美元＝31.438新臺幣，固定歷史換算，不是即時匯率或遊戲金幣匯率。'},
  {label:'主計總處 家庭收支調查',year:'2024',url:'https://ws.dgbas.gov.tw/001/Upload/463/ebook/ebook_357928/pdf/full.pdf',detail:'表1平均每人全年消費319,676元，除12為每月26,639.67元。包含設算與非現金消費，不是最低生活費，也不是玩家所在地開銷。'},
  {label:'世界銀行 人口資料',year:'2024',url:'https://data.worldbank.org/indicator/SP.POP.TOTL',detail:'依已收錄國家與地區人口加權抽取出生地，排除全球／區域總計；不是新生兒出生機率或完整全球普查。'},
  {label:'臺灣內政部 戶口統計',year:'2024',url:'https://www.ris.gov.tw/info-liferay/app/channel/newsDetail/25010858',detail:'臺灣補充2024年底戶籍人口23,400,220；與世界銀行年中常住人口口徑不同。'}
 ].map(Object.freeze))
});
const unit=(seed,key)=>hash('life-facts-v1:'+seed+':'+key)/4294967296;
const finite=(v,fallback)=>Number.isFinite(v)?v:fallback;
const bounded=(n,min,max)=>Math.max(min,Math.min(max,n));
const SCHOOL=[{label:'未完成小學',age:0},{label:'國小',age:12},{label:'國中',age:15},{label:'高中職',age:18},{label:'大專以上',age:22}];
function schoolTarget(seed){const u=unit(seed,'education');return u<.12?0:u<.22?1:u<.39?2:u<.76?3:4;}
function familyTarget(seed){let term=Math.exp(-METRIC_REFERENCE.fertility),cdf=term,u=unit(seed,'family-count'),n=0;while(u>cdf&&n<8){n++;term*=METRIC_REFERENCE.fertility/n;cdf+=term;}return n;}
function familyAges(seed){const count=familyTarget(seed),first=24+Math.floor(unit(seed,'family-age')*13);return Array.from({length:count},(_,i)=>first+i*(2+Math.floor(unit(seed,'family-spacing')*3)));}
function initialWealth(seed){
 const u=unit(seed,'wealth-band'),v=unit(seed,'wealth-value');
 if(u<.407)return v<.08?-Math.round(500+v/.08*19500):Math.round((v-.08)/.92*9999);
 if(u<.82)return Math.round(10000*Math.pow(10,v));
 if(u<.984)return Math.round(100000*Math.pow(10,v));
 return Math.round(1000000*Math.pow(100,v));
}
export function initialWealthScore(seed){const usd=initialWealth(seed);return Math.round(usd<0?15:usd<10000?18+usd/10000*17:usd<100000?35+Math.log10(usd/10000)*25:usd<1000000?60+Math.log10(usd/100000)*25:Math.min(100,85+Math.log10(usd/1000000)*7.5));}
export function metricMilestones(life){
 if(life?.version!==6)return [];
 const seed=life.seed,target=schoolTarget(seed),rows=[];
 for(let i=1;i<=target;i++){const school=SCHOOL[i];rows.push({id:'facts-v1-school-'+i,age:school.age,kind:'education',educationIndex:i,text:[
  '',
  '你完成了家鄉學舍的基礎課程。離開教室那天，你把第一本寫滿字的簿子收進行囊，這段學習相當於國小畢業。',
  '你完成下一階段的學舍課程，第一次獨自交出整份作業與計畫。這段修業相當於國中畢業，往後仍有不同的學習道路。',
  '你在工作與課業間排出自己的節奏，完成了進階學舍的修業。這段經歷相當於高中職畢業，沒有替你決定人生只能往哪裡去。',
  '你在高等學舍完成專題，將多年學習整理成一份可以被追問的成果。這段修業相當於大專畢業；文憑之外，生活還有許多題目。'
 ][i]});}
 familyAges(seed).forEach((age,i)=>rows.push({id:'facts-v1-child-'+i,age,kind:'family',childCount:i+1,text:i===0?'你迎來第一個孩子，家中多了一份需要共同照顧的日常。你學著在工作之後留下時間，也在不熟悉的事上開口求助。':`家裡迎來第${i+1}個孩子。你們重新安排空間、時間與開銷，讓每個孩子都能分到一份被好好聽見的日常。`}));
 if(target===0)rows.push({id:'facts-v1-school-alternative',age:12,kind:'education',educationIndex:0,text:'你沒能完成基礎學舍的課程，卻仍從工作、借來的書與願意教你的人身上學習。沒有文憑，並不表示這一生沒有值得被聽見的經驗。'});
 rows.push({id:'facts-v1-own-finances',age:18,kind:'finance',text:'你開始分開記錄自己的資產、借款與日常開銷。往後的家計有起有落，你想知道的，不只是賺進多少，還有扣除負擔後能留下什麼。'});
 return rows.sort((a,b)=>a.age-b.age||a.id.localeCompare(b.id));
}
export function metricsForLife(life,rows=[],age=0){
 if(life?.version!==6)return null;
 age=Math.max(0,finite(age,0));const state=[...rows].reverse().find(e=>e.age<=age&&e.state)?.state||{};
 // Replay witnessed structured milestones only, never infer parenthood from an NPC's children.
 const witnessed=rows.filter(e=>e.age<=age),educationIndex=witnessed.filter(e=>e.kind==='education').reduce((n,e)=>Math.max(n,Number.isInteger(e.educationIndex)?e.educationIndex:0),0),children=witnessed.filter(e=>e.kind==='family').reduce((n,e)=>Math.max(n,Number.isInteger(e.childCount)?e.childCount:0),0);
 const initial=initialWealth(life.seed),wealth=bounded(finite(state.wealth,40),0,100);
 // A fictional net-asset path anchored to observed adult bands. No exact within-band global rank is claimed.
 const grown=age<18?0:bounded((age-17)/18,.08,1),response=Math.pow(2,(wealth-initialWealthScore(life.seed))/30);
 const wealthUsd=age<18?Math.round((initial>0?Math.min(initial,1000):0)*Math.min(age,17)/17):Math.round(initial*grown*(initial<0?1/response:response));
 return {version:1,birth:birthGeography(life.seed),seed:life.seed,age,health:Math.round(bounded(finite(state.energy,70)-Math.max(0,age-30)*.6,0,100)),education:{index:educationIndex,label:age<6?'尚未入學':educationIndex===0?(age<12?'國小在學':'未完成小學'):SCHOOL[educationIndex].label},wealthUsd,wealthTwd:Math.round(wealthUsd*METRIC_REFERENCE.usdTwd),children};
}
export function metricPortrait(m){
 const months=Math.abs(m.wealthTwd)/METRIC_REFERENCE.monthlyLivingTwd,n=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:1}),currency=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0}),wealthMonths=Math.round(months*10)/10;
 const comparison=`${m.wealthTwd<0?'淨負債':'淨資產'} NT$ ${currency.format(Math.abs(m.wealthTwd))}，等值約 ${n.format(months)} 個月臺灣平均每人消費。這是淨資產對照，不是存款可支撐月數。`;
 const cards=[
  {key:'health',title:'健康',status:m.health>=75?'還有力氣，走想走的路':m.health>=50?'步調慢一點，也能走遠':m.health>=25?'把自己放回待辦清單':'這一站，先好好休息',detail:m.health>=75?'忙完生活，仍留得下一點自己的時間。':m.health>=50?'不是每個邀約都得趕上，留點餘力給明天。':'有些事情可以晚一點，照顧自己值得排在前面。',question:'如果人生重來，你會先存錢，還是先留時間給自己？'},
  {key:'education',title:'學歷',status:m.age<6?'世界，還是一間大教室':m.education.index===0?'沒被一張文憑定義':m.education.index<3?'在生活裡，繼續長本事':m.education.index===3?'學會一門本事，再走遠一點':'把疑問，走成自己的答案',detail:m.age<6?'每個第一次，都有人陪你慢慢試。':`目前修業：${m.education.label}。課堂以外的努力，也留在這一世裡。`,question:'一張文憑和一門手藝，你覺得哪個更能改變人生？'},
  {key:'wealth',title:'財富',status:m.age<18?'還在學會，錢從哪裡來':m.wealthTwd<0?'還在填補生活的缺口':months<3?'每一步，都要算仔細':months<24?'終於，攢下一點底氣':months<120?'有了能說「不」的餘裕':'讓錢，替自己留住時間',detail:m.age<18?'這是個人零用與積蓄；不是家裡的全部財產。':`${m.wealthTwd<0?'淨負債':'淨資產'}折合 NT$ ${currency.format(Math.abs(m.wealthTwd))}，約 ${n.format(months)} 個月臺灣平均每人消費的等值。`,question:'多存一點錢，還是少錯過幾個人，你會怎麼選？'},
  {key:'children',title:'子女',status:m.age<18?'屬於自己的家，還在遠方':m.children===0?'把牽掛，留成不同的模樣':m.children===1?'有個人，叫你一聲家人':'熱鬧的家，各有各的牽掛',detail:m.age<18?'先慢慢長大，還不用急著替未來作答。':m.children===0?'此刻還沒有子女的記憶；陪伴也能有許多種樣子。':`這一世已迎來 ${m.children} 個孩子，家裡的時間要分給不同的人。`,question:'你想留給下一段人生的，是家人、作品，還是一段被記住的陪伴？'}
 ];
 return {cards,question:cards[hash('portrait-question-v1:'+m.seed)%cards.length].question,comparison,wealthMonths};
}
