// The first localized, immutable modern-life edition. Real setting, fictional life.
// Only actual replayed state opens work, qualification, family and social chapters.
import {replayTaiwanLife,TAIWAN_CAREERS_V8} from './decision-engine-v8.js';
import {TAIWAN_MEMORIES_V8,TAIWAN_CAREER_CHAPTERS_V8,TAIWAN_TEACHER_CHAPTERS_V8} from './taiwan-content-v8.js';
import {TAIWAN_EXTRA_MEMORIES_V8} from './taiwan-days-extra-v8.js';
import {TAIWAN_RESERVE_MEMORIES_V8} from './taiwan-days-reserve-v8.js';
import {hash} from './world.js';
import {validSocialCast} from './social-cast.js';
import {sharedMemories} from './shared-story.js';
const DURATION=7200000,INTERVAL=30000,DAY=86400000,OFFSET=28800000;
const MEMORIES=[...TAIWAN_MEMORIES_V8,...TAIWAN_EXTRA_MEMORIES_V8,...TAIWAN_RESERVE_MEMORIES_V8];
const SHELVES=Array.from({length:4},(_,shelf)=>MEMORIES.filter(row=>(Number(row.id.match(/(\d+)$/)?.[1])-1)%4===shelf));
const mixedHash=text=>{let v=hash(text);v=Math.imul(v^(v>>>16),0x7feb352d);v=Math.imul(v^(v>>>15),0x846ca68b);return (v^(v>>>16))>>>0;};
const activeBetween=(from,to)=>{if(to<=from)return 0;const first=Math.floor((from+OFFSET)/DAY),last=Math.floor((to+OFFSET)/DAY),overlap=d=>Math.max(0,Math.min(to,d*DAY-OFFSET+DAY)-Math.max(from,d*DAY-OFFSET+21600000));return first===last?overlap(first):overlap(first)+overlap(last)+Math.max(0,last-first-1)*64800000;};
const elapsed=(life,activeMs)=>Math.max(0,Math.min(DURATION,Number.isFinite(activeMs)?activeMs:Number.isFinite(life.startedAt)?activeBetween(life.startedAt,life.clockAt||life.startedAt):DURATION));
const replay=(life,at)=>replayTaiwanLife({...life,auto:life.sources?.map(s=>s==='auto'?1:0)||life.auto},{activeMs:Math.floor(at),autoFill:true});
const stateAt=(run,at)=>({...([...run.resolved].reverse().find(row=>row.atMs<=at)?.stateAfter||run.initialState)});
const phase=age=>age<13?'child':age<18?'youth':age<60?'adult':'late';
const INFANCY=[
 '清晨的巷口開始有人走動，你在熟悉的聲音裡醒來，還分不清外面是哪一條路。',
 '照顧你的人把濕毛巾擰乾，擦去手上的米糊，又把小碗推回你面前。',
 '雨點打在窗外的遮雨棚，你在被子裡翻了個身，家裡有人把聲音放輕。',
 '你扶著矮桌站起來，走了幾步又坐回地板，大人沒有急著替你完成。',
 '家人把客廳的尖角包起來，你能探索的地方多了一點，抽屜卻還是關得緊緊的。',
 '傍晚的飯香飄進房間，你認得那個抱你起來的人，也開始認得回家的腳步。',
 '你把積木塞進小盒子，再一塊塊倒出來，窗外的車聲沒有打斷這個重要的遊戲。',
 '家人帶你到附近的公園，推車停在樹蔭下，你伸手去抓從葉縫漏下來的光。',
 '你不願意穿上襪子，坐在門口抗議了一會兒，最後被抱著慢慢穿好。',
 '你把第一個能說清楚的字喊了好幾次，家裡每個人都聽過，仍願意再回答。',
 '颱風消息傳來，家人把窗邊的東西收進屋裡，你的小床也往裡挪了一點。',
 '白天熱得不太好睡，照顧你的人換掉汗濕的衣服，陪你重新安靜下來。',
 '你第一次自己拿湯匙，飯粒掉在桌邊，旁邊的人替你留出慢慢學的時間。',
 '公車停靠時的聲音把你吵醒，你趴在熟悉的肩膀上，又慢慢閉上眼睛。',
 '你跟著音樂拍手，節拍對不上也沒有關係，旁邊的人照樣笑著陪你拍。',
 '家人替你量身高，在牆邊留下一個小記號；你還不知道，那條線往後會一直往上。',
 '你把喜歡的小布巾帶到每個房間，睡前找不到時，全家跟著翻了一遍。',
 '巷口早餐店的袋子被放在桌上，你伸出手，先得到一小塊適合吃的食物。',
 '你學著說不要，也學著伸手要抱抱，照顧你的人慢慢分辨這兩種聲音。',
 '洗好的小衣服晾在窗邊，風把袖子吹得鼓起來，你看了很久才移開視線。'
];
// Age windows keep recognizable developmental actions out of newborn passages.
const INFANT_MIN_AGE=[0,.5,0,1,.5,0,.8,0,1,1,0,0,1,0,.7,0,.5,1,1,0];
const safeRoles=['隔壁鄰居','一起長大的朋友','社區裡熟悉的人'];
function socialRows(life,death,until){return (validSocialCast(life.socialCast)?.people||[]).flatMap((person,i)=>{const age=7+hash('tw8-person:'+life.seed+person.thread)%16,at=Math.floor(age/death*DURATION);if(at>until)return [];return [{id:'tw8-person-'+i,at,thread:person.thread,actor:person.name,role:safeRoles[i],text:`這一世，「${person.name}」是你${safeRoles[i]}。你們在常走的街口打過招呼，後來慢慢認得彼此的生活節奏。`}];});}
function memoryEligible(row,age,state){
 age=Math.floor(age);
 if(row.phase!=='any'&&row.phase!==phase(age)||age<(row.minAge??3)||age>(row.maxAge??104))return false;
 if(row.requires?.some(key=>state[key]!==true))return false;
 if(row.excludes?.some(key=>state[key]===true))return false;
 if(row.careerId&&(state.careerId!==row.careerId||!state.workActive))return false;
 if(row.needsChildren&&!(state.children>0)||row.needsMarried&&!state.married)return false;
 return true;
}
function chapterEligible(chapter,state,age){
 if(typeof chapter==='string')return !!state.workActive;
 if(chapter.minAge&&age<chapter.minAge||chapter.maxAge&&age>chapter.maxAge)return false;
 if(chapter.requires?.some(key=>state[key]!==true)||chapter.excludes?.some(key=>state[key]===true))return false;
 if(chapter.needsChildren&&!(state.children>0)||chapter.needsMarried&&!state.married)return false;
 if(chapter.gate&&typeof chapter.gate==='object'){
  const g=chapter.gate;
  if(g.careerId&&state.careerId!==g.careerId||g.workActive&&!state.workActive||state.careerStage<(g.minCareerStage||0))return false;
  if(g.requires?.some(key=>state[key]!==true))return false;
  if(g.teacherHired&&!state.teacherHired)return false;
  return true;
 }
 if(chapter.gate==='practice')return state.practiceCompleted===true;
 if(chapter.gate==='retired')return state.retired===true;
 return state.workActive===true&&(chapter.minStage===undefined||state.careerStage>=chapter.minStage);
}
export function plannedV8Content(life,{activeMs}={}){
 if(life?.version!==8)return [];
 const until=elapsed(life,activeMs),run=replay(life,until),p=run.profile,death=p.deathAge,rows=[],used=new Set(),usedTexts=new Set(),chapterProgress=new Map(),shelf=parseInt(life.seed.slice(6,8),16)&3;
 const push=(id,at,text,kind,extra={})=>rows.push({id,age:at/DURATION*death,activeMs:at,kind,text,state:stateAt(run,at),...extra});
 push('tw8-origin',0,`這一世，你在${p.countryName}${p.cityName}，以${p.gender==='f'?'女孩':'男孩'}的身分出生。${p.familyText}`,'origin');
 for(let tick=1;tick*INTERVAL<=until;tick++){
  const at=tick*INTERVAL,age=at/DURATION*death,current=stateAt(run,at),chapterKey=current.teacherHired?'qualified-teacher':current.careerId,chapters=current.teacherHired?TAIWAN_TEACHER_CHAPTERS_V8:current.careerId?TAIWAN_CAREER_CHAPTERS_V8[current.careerId]||[]:[],next=chapterProgress.get(chapterKey)||0;
  // Work chapters are part of time passing, not promotions awarded by age.
  if(tick%6===0&&next<chapters.length&&chapterEligible(chapters[next],current,age)){
   const chapter=chapters[next],text=typeof chapter==='string'?chapter:chapter.text,id='tw8-job-'+chapterKey.replaceAll('_','-').slice(0,18)+'-'+next;
   if(!usedTexts.has(text)){usedTexts.add(text);used.add(id);push(id,at,text,'career',{careerId:current.careerId});chapterProgress.set(chapterKey,next+1);continue;}
  }
  const pool=age<3?INFANCY.map((text,i)=>({id:'tw8-infant-'+i,text,minAge:INFANT_MIN_AGE[i]})).filter(row=>age>=row.minAge):SHELVES[shelf].filter(row=>memoryEligible(row,age,current));
  const eligible=pool.filter(row=>!used.has(row.id)&&!usedTexts.has(row.text));
  if(!eligible.length)throw Error('Taiwan authored memory pool exhausted at age '+age.toFixed(1));
  const salt=life.seed+':'+life.orbit+':'+tick+':'+(current.careerId||'home'),chosen=eligible[mixedHash(salt)%eligible.length];
  used.add(chosen.id);usedTexts.add(chosen.text);push(chosen.id,at,chosen.text,'memory');
 }
 for(const row of run.resolved)push('tw8-choice-'+row.id,row.atMs,row.outcome,'choice',{choiceIndex:row.index,answer:row.answer,source:row.source,scenarioId:row.id,thread:row.family,state:{...row.stateAfter}});
 for(const row of socialRows(life,death,until))push(row.id,row.at,row.text,'relationship',{thread:row.thread,actor:row.actor,role:row.role});
 if(Number.isFinite(life.startedAt))for(const memory of sharedMemories(life.sharedMemories)){const at=activeBetween(life.startedAt,memory.at);if(memory.at<life.startedAt||at>until||at>DURATION)continue;push('tw8-shared-'+mixedHash(memory.id+':'+memory.at).toString(16),at,memory.text,'shared',{source:memory.source});}
 return rows.sort((a,b)=>a.activeMs-b.activeMs||(a.kind==='choice'?-1:b.kind==='choice'?1:0)||a.id.localeCompare(b.id));
}
export function profileV8(life,{activeMs}={}){
 const run=replay(life,elapsed(life,activeMs)),p=run.profile;
 return {...p,seed:life.seed,orbit:life.orbit,region:`${p.countryName} · ${p.cityName}`,career:{id:run.state.careerId||'undetermined',name:run.state.careerLabel||'仍在尋找生活方向',steps:[],place:p.cityName},state:{...run.state},threads:socialRows(life,p.deathAge,elapsed(life,activeMs)).map(row=>({id:row.thread,actor:row.actor,role:row.role,steps:[row.text]})),objects:[],scenes:run.scenes,terminalOutcome:run.terminalOutcome};
}
export function endingV8(life,{activeMs}={}){
 const until=elapsed(life,activeMs),run=replay(life,until),rows=plannedV8Content(life,{activeMs:until}),p=run.profile,complete=run.completed,focus=run.endingFocus;
 const scenes=new Map(run.scenes.map(row=>[row.id,row]));
 const timeline=rows.filter(row=>['origin','choice','career','shared','relationship'].includes(row.kind)).map(row=>({id:row.id,age:Math.floor(row.age),activeMs:row.activeMs,kind:row.kind,label:row.kind==='origin'?'出生':row.kind==='choice'?scenes.get(row.scenarioId)?.title||'人生抉擇':row.kind==='career'?'工作與生活':row.kind==='shared'?'共同寫下的一頁':`${row.role} · ${row.actor}`,text:row.text}));
 if(complete)timeline.push({id:'tw8-ending',age:p.deathAge,activeMs:DURATION,kind:'ending',label:'此生落款',text:focus.summary});
 const paragraphs=[timeline[0].text];
 const milestones=timeline.slice(1).filter(row=>row.kind!=='ending');
 for(let i=0;i<milestones.length;i+=3)paragraphs.push(milestones.slice(i,i+3).map(row=>`${row.age}歲｜${row.text}`).join(''));
 if(complete)paragraphs.push(`${p.deathAge}歲｜${focus.summary}熟悉的公車站、巷口的燈和窗邊晾過的雨衣，也都留在這一冊生活裡。`);
 else paragraphs.push('這一世仍在展開，尚未走到的日子，仍然留著可以選擇的位置。');
 const last=run.resolved.at(-1),manual=run.resolved.filter(row=>row.source==='manual').length;
 return {title:complete?focus.title:'街巷裡，仍有新的故事',illustration:'/art/fate-taiwan-v8/river-memory.webp',paragraphs,chapters:timeline.map(row=>({age:row.age,label:row.label,text:row.text})),timeline,
  summary:complete?`${p.countryName}${p.cityName}，${p.familyLabel}。${focus.summary}${last?.outcome||''}`:`你正在${p.cityName}度過這一世，已經做出的回應，正改變接下來遇見的事。`,
  quote:complete?'日子不只有一種走法，這一段確實被你生活過。':'先過好眼前這一天，下一頁還等著你。',question:run.state.ventureFailed?'如果一次認真的嘗試沒有成功，你會先保住什麼？':run.state.caregiver?'為家人留下時間時，你會怎麼替自己留一點空間？':'如果換一個出身，你還會做出同樣的選擇嗎？',
  gender:p.gender,country:'TW',city:p.city,worldYear:null,color:'#e3bd77',terminalOutcome:run.terminalOutcome,stats:{...run.state,events:rows.length,career:run.state.careerLabel,manualChoices:manual,autoChoices:run.resolved.length-manual},endingFocus:focus,tags:run.tags};
}
export function narrativeV8Inventory(){return {country:'TW',memoryCount:MEMORIES.length+INFANCY.length,careerCount:TAIWAN_CAREERS_V8.length,careerChapters:Object.values(TAIWAN_CAREER_CHAPTERS_V8).reduce((n,rows)=>n+rows.length,0)+TAIWAN_TEACHER_CHAPTERS_V8.length,intervalMs:INTERVAL};}
