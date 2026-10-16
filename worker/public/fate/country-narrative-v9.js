import {getCountryPack} from './country-runtime-v9.js';
import {replayCountryLife} from './country-engine-v9.js';
import {validSocialCast} from './social-cast.js';
import {sharedMemories} from './shared-story.js';
import {hash} from './world.js';
const DURATION=7200000,INTERVAL=30000,DAY=86400000,OFFSET=28800000;
const mixed=text=>{let x=hash(text);x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return (x^(x>>>16))>>>0;};
const activeBetween=(from,to)=>{if(to<=from)return 0;const first=Math.floor((from+OFFSET)/DAY),last=Math.floor((to+OFFSET)/DAY),overlap=d=>Math.max(0,Math.min(to,d*DAY-OFFSET+DAY)-Math.max(from,d*DAY-OFFSET+21600000));return first===last?overlap(first):overlap(first)+overlap(last)+Math.max(0,last-first-1)*64800000;};
const untilMs=(life,activeMs)=>Math.max(0,Math.min(DURATION,Number.isFinite(activeMs)?activeMs:Number.isFinite(life.startedAt)?activeBetween(life.startedAt,life.clockAt||life.startedAt):DURATION));
const replay=(life,at)=>replayCountryLife({...life,auto:life.sources?.map(s=>s==='auto'?1:0)||life.auto},{activeMs:Math.floor(at),autoFill:true});
const stateAt=(run,at)=>({...([...run.resolved].reverse().find(r=>r.atMs<=at)?.stateAfter||run.initialState)});
const BABY=[
 [0,'窗邊的光換了一個方向，你在熟悉的懷抱裡醒來，又慢慢閉上眼睛。'],
 [0,'你還分不清門外的聲音，卻會在熟悉的人靠近時安靜一點。'],
 [0,'有人把你的衣服重新拉好，房裡的說話聲也跟著放輕。'],
 [0,'午後的風從窗邊經過，照顧你的人把薄被的角收回床上。'],
 [0,'一段重複的旋律在房裡響起，你不知道名字，卻開始認得它。'],
 [0,'你在半夢半醒間伸出手，旁邊的人停下手裡的事，回握了一下。'],
 [.5,'小碗被放到面前，你用手碰一碰，又抬頭看了看照顧你的人。'],
 [.5,'有人把小玩具放近一些，你伸手摸到它，開心得又試了一次。'],
 [.5,'你把布巾抓得很緊，睡著以後才慢慢鬆開手指。'],
 [.5,'客廳裡多了一張小墊子，你翻身以後，停下來看剛才離開的地方。'],
 [.8,'你把一塊積木從手裡放開，落地聲讓你又找了另一塊來試。'],
 [.8,'推車在樹影下停住，你看著頭頂晃動的葉子，忘了剛才在找什麼。'],
 [1,'你扶著矮桌試走兩步，坐回地上後，旁邊的人等你自己再站起來。'],
 [1,'你喊出一個還不太清楚的字，家裡有人回應，你於是又喊了一次。'],
 [1,'你試著把湯匙送到嘴邊，桌上留了幾粒飯，也留著讓你慢慢試的空間。'],
 [1,'一隻襪子被你藏到坐墊下，出門前找了好一會兒，才重新湊成一對。'],
 [1,'你跟著熟悉的人拍手，節奏總慢一點，笑聲卻沒有少一點。'],
 [1,'你把盒子裡的東西一件件拿出來，最後又很認真地放回另一個地方。'],
 [1,'照顧你的人在牆邊留下一條身高記號，你好奇地伸手摸那條新線。'],
 [1,'你開始說不要，也開始知道，想被抱起來時可以怎樣伸出手。'],
];
const phase=age=>age<13?'child':age<18?'youth':age<60?'adult':'late';
const catalogues=new WeakMap();
function dailyRows(pack,shelf){
 if(!catalogues.has(pack))catalogues.set(pack,Array.from({length:4},(_,s)=>Object.entries(pack.daily).flatMap(([phase,texts])=>texts.flatMap((text,i)=>i%4===s?[{id:'v9-'+pack.id.toLowerCase()+'-'+phase+'-'+i,phase,text,minAge:phase==='child'?6:phase==='youth'?13:phase==='adult'?18:phase==='late'?60:3,maxAge:phase==='child'?12:phase==='youth'?17:phase==='adult'?59:110}]:[]))));
 return catalogues.get(pack)[shelf];
}
export function plannedCountryContent(life,{activeMs}={}){
 if(life?.version!==9)return [];
 const until=untilMs(life,activeMs),pack=getCountryPack(life.country),run=replay(life,until),p=run.profile,death=p.deathAge,rows=[],usedIds=new Set(),usedText=new Set(),progress=new Map(),shelf=parseInt(life.seed.slice(6),16)&3,candidates=dailyRows(pack,shelf);
 const push=(id,at,text,kind,extra={})=>rows.push({id,age:at/DURATION*death,activeMs:at,kind,text,state:stateAt(run,at),...extra});
 push('v9-'+p.country.toLowerCase()+'-origin',0,`這一世，你在${p.countryName}${p.cityName}，以${p.gender==='f'?'女孩':'男孩'}的身分出生。${p.familyText}`,'origin');
 for(let tick=1;tick*INTERVAL<=until;tick++){
  const at=tick*INTERVAL,age=at/DURATION*death,state=stateAt(run,at),career=pack.careers.find(c=>c.id===state.careerId),next=progress.get(career?.id)||0;
  if(tick%6===0&&state.workActive&&career&&next<career.chapters.length&&state.careerStage>=(next<3?1:next<7?2:3)){
   const text=career.chapters[next],id='v9-job-'+mixed(p.country+':'+career.id+':'+next).toString(16);if(!usedText.has(text)){usedText.add(text);usedIds.add(id);progress.set(career.id,next+1);push(id,at,text,'career',{careerId:career.id});continue;}
  }
  const eligible=age<3?BABY.flatMap(([min,text],i)=>age>=min?[{id:'v9-baby-'+i,text}]:[]):candidates.filter(r=>Math.floor(age)>=r.minAge&&Math.floor(age)<=r.maxAge&&(r.phase==='any'||r.phase===phase(age)));
  const unseen=eligible.filter(r=>!usedIds.has(r.id)&&!usedText.has(r.text));if(!unseen.length)throw Error('v9 country daily shelf exhausted: '+p.country+' at '+age);
  const chosen=unseen[mixed(life.seed+':'+tick+':daily')%unseen.length];usedIds.add(chosen.id);usedText.add(chosen.text);push(chosen.id,at,chosen.text,'memory');
 }
 for(const row of run.resolved)push('v9-choice-'+mixed(p.country+':'+row.id).toString(16),row.atMs,row.outcome,'choice',{choiceIndex:row.index,answer:row.answer,source:row.source,scenarioId:row.id,thread:row.family,state:{...row.stateAfter}});
 // A person is cast into a safe fictional role, never assumed to hold an actual
 // profession/relationship. Work-only chains require this life's current job.
 const people=validSocialCast(life.socialCast)?.people||[],usedChains=new Set();
 for(let i=0;i<people.length;i++){
  const person=people[i],chains=pack.social.filter(c=>!usedChains.has(c.id)&&(!c.requiresCareer||run.resolved.some(r=>r.stateAfter.workActive&&r.stateAfter.careerId!=='household-care')));if(!chains.length)continue;
  const chain=chains[mixed(life.seed+':chain:'+person.thread)%chains.length];usedChains.add(chain.id);
  const firstJob=chain.requiresCareer?run.resolved.find(r=>r.stateAfter.workActive&&r.stateAfter.careerId!=='household-care'):null;
  const base=firstJob?firstJob.atMs/DURATION*death+.2:7+mixed(life.seed+':meeting:'+person.thread)%14;
  const jobEnd=firstJob?run.resolved.find(r=>r.atMs>firstJob.atMs&&(!r.stateAfter.workActive||r.stateAfter.careerId!==firstJob.stateAfter.careerId))?.atMs??DURATION:DURATION;
  for(let chapter=0;chapter<chain.chapters.length;chapter++){
   const age=base+(death-base-2)*(chapter+.3)/chain.chapters.length,at=Math.floor(age/death*DURATION),state=stateAt(run,at);if(at>until||chain.requiresCareer&&(!firstJob||at>=jobEnd||!state.workActive||state.careerId!==firstJob.stateAfter.careerId))continue;
   const text=chain.chapters[chapter].replaceAll('{name}',person.name);push('v9-person-'+i+'-'+chapter,at,text,'relationship',{thread:person.thread,actor:person.name,role:chain.role});
  }
 }
 if(Number.isFinite(life.startedAt))for(const memory of sharedMemories(life.sharedMemories)){const at=activeBetween(life.startedAt,memory.at);if(memory.at<life.startedAt||at>until||at>DURATION)continue;push('v9-shared-'+mixed(memory.id+':'+memory.at).toString(16),at,memory.text,'shared',{source:memory.source});}
 return rows.sort((a,b)=>a.activeMs-b.activeMs||a.id.localeCompare(b.id));
}
export function profileCountryLife(life){const run=replay(life,untilMs(life));return {...run.profile,career:{id:run.state.careerId,label:run.state.careerLabel||'仍在尋找生活方向'},state:run.state,threads:[],region:{name:run.profile.cityName},storyTitle:run.endingFocus.title};}
export function endingCountryLife(life){
 const until=untilMs(life),run=replay(life,until),p=run.profile,content=plannedCountryContent(life),complete=until===DURATION,focus=run.endingFocus;
 const selected=new Set();for(const[min,max]of [[3,6],[6,13],[13,18],[18,30],[30,45],[45,60],[60,75],[75,90],[90,111]]){const pool=content.filter(r=>r.kind==='memory'&&r.age>=min&&r.age<max);if(pool.length)selected.add(pool[mixed(life.seed+':remember:'+min)%pool.length].id);}
 const timeline=content.filter(r=>['origin','choice','career','relationship','shared'].includes(r.kind)||selected.has(r.id)).map(r=>({...r,age:Math.floor(r.age),label:r.kind==='origin'?'出生':r.kind==='choice'?run.scenes[r.choiceIndex]?.title||'人生抉擇':r.kind==='career'?'工作與生活':r.kind==='shared'?'交織命運':r.kind==='memory'?'那些平常的日子':'身邊的人'}));
 if(complete)timeline.push({id:'v9-ending',age:p.deathAge,activeMs:DURATION,kind:'ending',label:'此生落款',text:focus.summary});
 const paragraphs=[];for(let i=0;i<timeline.length;i+=3)paragraphs.push(timeline.slice(i,i+3).map(r=>`${r.age}歲｜${r.text}`).join(''));
 return {...focus,quote:focus.quote,summary:`${p.countryName}${p.cityName}，${p.familyLabel}。${focus.summary}`,color:'#e3bd77',question:'如果換一個出身，你還會做出同樣的選擇嗎？',worldYear:null,deathAge:p.deathAge,chapters:timeline,paragraphs,illustration:`/art/fate-countries-v9/${p.country.toLowerCase()}-memory.webp`,complete};
}
