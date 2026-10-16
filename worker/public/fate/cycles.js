import {replayTaiwanLife} from './decision-engine-v8.js';
import {SCENES,decodeResult} from './model.js';
import {EXTRA_CHOICES} from './choices-extra-v1.js';
import {validLife} from './life.js';
import {formalScenes,plannedContent} from './formal-events.js';
import {hash as narrativeHash} from './world.js';
import {replayDecisionLife} from './decision-engine-v7.js';
// Original short story pools. V1 links retain their original scenes.
const POOLS=[
 [SCENES[0],
 {tag:'第一幕 · 爐邊',title:'碎裂的星石，還能成為什麼？',text:'成年那天，鍛匠把一塊碎星石交給你。你可以留下，替故鄉修好守夜的燈；也可以把它帶向海港，尋找失傳的點燈方法。',choices:[['留下學會修燈','在熟悉的地方，也能學會讓世界明亮。','你在爐邊度過第一個冬天，替故鄉一盞盞修好舊燈。'],['去海港找答案','你願意把未知，慢慢走成自己的路。','你把碎星石收進行囊，循著一張舊航圖走向海港。']]},
 {tag:'第一幕 · 來信',title:'沒有署名的信，你會送去哪裡？',text:'你在舊旅誌裡發現一封未寄出的信。信裡寫著燈塔的地址，也畫著一座無人知曉的島。這是你第一次替自己決定方向。',choices:[['先去信上的燈塔','也許有人，還在等一句遲來的話。','你敲開燈塔的門，替一封舊信找到了願意讀完的人。'],['尋找畫裡的島','那些沒有被寫下的事，也值得追尋。','你照著信上的星圖，第一次踏上沒有名字的航路。']]}],
 [SCENES[1],
 {tag:'第二幕 · 林間',title:'霧裡有兩條路，你先照亮哪一條？',text:'你帶著星燈穿過迷霧森林。一群旅人停在斷橋前，而另一條狹窄的山徑，似乎能通向更高處的觀測臺。',choices:[['陪旅人把橋修好','讓走得慢的人，也能一起抵達。','你在霧裡多留了三日，與陌生旅人一起把木橋重新架好。'],['上山尋找新路','也許站得高一點，就能為大家找到方向。','你獨自爬上觀測臺，再帶著新畫的路線回到旅人身邊。']]},
 {tag:'第二幕 · 遠行',title:'有人請你留下，你怎麼回答？',text:'沿海小鎮邀你留下看守冬夜的燈塔。同一晚，老船長帶來一艘即將出航的船，說遠方有一整片尚未點亮的海。',choices:[['留下一個冬天','有些遠方，可以等一個約定完成。','你替小鎮守過一季寒夜，和居民一起等到了春潮。'],['把火種帶去遠方','如果能點亮更多地方，也值得試一次。','你帶著小鎮託付的火種出航，沿途替陌生的港口點燈。']]}],
 [SCENES[2],
 {tag:'第三幕 · 雪線',title:'雪停以前，最後一盞燈留在哪裡？',text:'大雪封住山路，你與同伴只剩一盞星燈。山下的旅人需要一個方向，而山脊另一頭，也有人等著你帶光抵達。',choices:[['放在回山下的路口','願每個折返的人，都有一個可辨認的方向。','你把星燈留在雪線路口，讓後來的人看得見回去的路。'],['與同伴帶過山脊','我們把光帶過去，再一起找回來的路。','你與同伴輪流提燈，走過山脊，讓光第一次抵達另一側。']]},
 {tag:'第三幕 · 新月',title:'港口熄燈了，你願意留下嗎？',text:'新月之夜，港口的燈一盞盞熄滅。你的船就要離岸，手裡最後一盞星燈，能成為岸上的等待，也能成為海上的約定。',choices:[['留下，等最後一艘船','總有人需要知道，還有誰願意等。','你留在岸上，直到最後一艘晚歸的船看見星燈。'],['出航，把星燈傳下去','也許這一點光，能陪更多人走遠。','你讓星燈在船員手中傳遞，把同行的約定帶向下一片海。']]}],
];
export function scenesFor(result){if(result.version>=4)return formalScenes(result);if(result.version===1)return SCENES;return POOLS.map((pool,i)=>{if(result.version>=3)pool=[...pool,...EXTRA_CHOICES[i]];const v=parseInt(result.seed.slice(i*2,i*2+2),16);return {...pool[v%pool.length],age:result.version===3?[18,40,66][i]:[18+v%7,30+v%13,55+v%19][i]};});}
export function seedForNextLife(seed,entries=[],version=3,orbit=11,country='TW'){
 if(!/^[a-f0-9]{8}$/.test(seed))throw Error('Invalid seed');
 if(version===8){
  if(country!=='TW')throw Error('Country pack is not open');
  const past=entries.slice(-3).map(e=>decodeResult(e?.code)).filter(r=>r?.version===8);if(!past.length)return seed;
  const usedShelves=new Set(past.map(p=>parseInt(p.seed.slice(6,8),16)&3)),availableShelves=[0,1,2,3].filter(shelf=>!usedShelves.has(shelf));
  const seen=new Set(past.flatMap(p=>replayTaiwanLife(p).resolved.map(row=>row.id))),seenCareers=new Set(past.map(p=>replayTaiwanLife(p).state.careerId));
  const seenText=new Set(past.flatMap(p=>plannedContent(p).filter(e=>e.kind==='memory').map(e=>e.text))),baseline=replayTaiwanLife({version:8,country,seed,orbit}).resolved.length,ranked=[];let fallback=null;
  for(let i=0;i<64;i++){let candidate=i?narrativeHash('fate-tw-v8-next:'+seed+':'+i).toString(16).padStart(8,'0'):seed;const shelf=availableShelves[narrativeHash('tw8-shelf:'+candidate)%availableShelves.length];candidate=candidate.slice(0,6)+((parseInt(candidate.slice(6,8),16)&252)|shelf).toString(16).padStart(2,'0');const v=replayTaiwanLife({version:8,country,seed:candidate,orbit});if(!fallback||v.resolved.length>fallback.v.resolved.length)fallback={candidate,v,score:1};if(v.resolved.length<baseline)continue;const score=v.resolved.reduce((n,row)=>n+(seen.has(row.id)?1:0),0)/Math.max(1,v.resolved.length)+(seenCareers.has(v.state.careerId)?.4:0);ranked.push({candidate,v,score});}
  if(!ranked.length&&fallback)ranked.push(fallback);
  let best=seed,bestScore=Infinity;for(const {candidate,v,score}of ranked.sort((a,b)=>a.score-b.score).slice(0,4)){const memories=plannedContent({version:8,country,seed:candidate,orbit,answers:v.answers,auto:v.auto}).filter(e=>e.kind==='memory'),repeat=memories.filter(row=>seenText.has(row.text)).length/Math.max(1,memories.length),total=.35*score+.65*repeat;if(total<bestScore){best=candidate;bestScore=total;}}
  return best;
 }
 if(version===7){
  const past=entries.slice(-3).map(e=>decodeResult(e?.code)).filter(r=>r?.version===7);if(!past.length)return seed;
  const seen=new Set(past.flatMap(p=>replayDecisionLife(p,{activeMs:7200000}).resolved.map(s=>s.id))),seenText=new Set(past.flatMap(p=>plannedContent(p).filter(e=>e.kind==='memory').map(e=>e.text))),project=candidate=>replayDecisionLife({version:7,seed:candidate,orbit,answers:[],auto:[]},{activeMs:7200000}),baseline=project(seed).resolved.length;
  const ranked=[];for(let i=0;i<16;i++){const candidate=i?narrativeHash('fate-v7-next:'+seed+':'+i).toString(16).padStart(8,'0'):seed,v=project(candidate);if(v.resolved.length>=baseline)ranked.push({candidate,v,choiceScore:v.resolved.reduce((n,s)=>n+(seen.has(s.id)?1:0),0)/Math.max(1,v.resolved.length)});}
  // Only four promising candidates need the full prose replay. History chooses
  // a seed at start; it is never an unencoded input to the public story itself.
  let best=seed,score=Infinity;for(const {candidate,v,choiceScore} of ranked.sort((a,b)=>a.choiceScore-b.choiceScore).slice(0,4)){const memories=plannedContent({version:7,seed:candidate,orbit,answers:v.answers,auto:v.auto}).filter(e=>e.kind==='memory'),n=.65*choiceScore+.35*memories.reduce((n,e)=>n+(seenText.has(e.text)?1:0),0)/Math.max(1,memories.length);if(n<score){score=n;best=candidate;}}return best;
 }
 if(version>=4){
  const previous=entries.slice(-3).map(e=>decodeResult(e?.code)).filter(r=>version===4?r?.version===4:r?.version>=4);
  if(!previous.length)return seed;
  const sceneKey=scene=>version===5?scene.scenarioId||scene.id:scene.id;
  const sceneSets=[0,1,2].map(i=>new Set(previous.map(p=>sceneKey(formalScenes(p)[i]))));
  const avoidScenes=candidate=>{for(let i=0;i<3;i++){let b=parseInt(candidate.slice(i*2,i*2+2),16);for(let n=0;n<(version===5?16:256)&&sceneSets[i].has(sceneKey(formalScenes({seed:candidate,version})[i]));n++){b=(b+(version===5?16:1))%256;candidate=candidate.slice(0,i*2)+b.toString(16).padStart(2,'0')+candidate.slice(i*2+2);}}return candidate;};
  const previousRows=previous.flatMap(p=>plannedContent(p)),texts=new Set(previousRows.map(e=>e.text)),ids=new Set(previousRows.map(e=>e.id));
  const usedShelves=new Set(previous.map(p=>parseInt(p.seed.slice(6,8),16)%4)),openShelves=[0,1,2,3].filter(s=>!usedShelves.has(s));
  const shelf=version===5?openShelves[narrativeHash('fate-v5-shelf:'+seed)%openShelves.length]:null;
  // The next decisions do not yet exist. Score a projection using the most recent path;
  // only the selected seed is saved. Replay never consults history or this projection.
  const projection={...previous.at(-1),version},seenCandidates=new Set();let best=null,bestScore=Infinity;
  for(let i=0;i<(version===5?12:64);i++){
   let candidate=i===0?seed:narrativeHash('fate-v'+version+'-next:'+seed+':'+i).toString(16).padStart(8,'0');
   if(version===5)candidate=candidate.slice(0,6)+((parseInt(candidate.slice(6,8),16)&252)|shelf).toString(16).padStart(2,'0');
   candidate=avoidScenes(candidate);
   if(seenCandidates.has(candidate))continue;seenCandidates.add(candidate);
   const score=plannedContent({...projection,seed:candidate}).reduce((n,e)=>n+(texts.has(e.text)?1000:0)+(ids.has(e.id)?1:0),0);
   if(score<bestScore){best=candidate;bestScore=score;}
  }
  return best;
 }
 const recent=entries.slice(-3).map(e=>decodeResult(e?.code)).filter(Boolean).map(scenesFor);
 const key=scene=>version===4?scene.id||scene.text:scene.title;
 for(let i=0;i<3;i++){let byte=parseInt(seed.slice(i*2,i*2+2),16);for(let tries=0;tries<(version===4?256:6)&&recent.some(rows=>key(rows[i])===key(scenesFor({version,seed})[i]));tries++){byte=(byte+1)%256;seed=seed.slice(0,i*2)+byte.toString(16).padStart(2,'0')+seed.slice(i*2+2);}}
 return seed;
}
export const SOUL_ACHIEVEMENTS=[{at:1,title:'初醒之魂'},{at:5,title:'拾光之魂'},{at:10,title:'星痕之魂'},{at:25,title:'千途之魂'},{at:50,title:'循星之魂'},{at:100,title:'萬象之魂'}];
export function readSoul(value){
 let raw;try{raw=typeof value==='string'?JSON.parse(value):value}catch{return {entries:[]}};
 if(!Array.isArray(raw?.entries))return {entries:[]};const seen=new Set(),entries=[];
 for(const e of raw.entries){const result=decodeResult(e?.code);if(!result||seen.has(e.code))continue;const maxAge=[5,7,8].includes(result.version)?result.deathAge:90;seen.add(e.code);entries.push({code:e.code,at:Number.isSafeInteger(e.at)&&e.at>0?e.at:0,...(Array.isArray(e.memories)?{memories:e.memories.filter(m=>m&&Number.isInteger(m.age)&&m.age>=0&&m.age<=maxAge&&typeof m.text==='string'&&m.text.length<=400&&typeof m.id==='string'&&/^[a-z0-9-]{1,32}$/.test(m.id)).slice(0,32).map(m=>({id:m.id,age:m.age,text:m.text}))}:{})});if(entries.length>=2000)break;}
 const draft=validLife(raw?.draft);return draft?{entries,draft}:{entries};
}
export function rememberSoul(record,code,at=Date.now(),memories=[]){
 const r=readSoul(record),result=decodeResult(code);if(!result)return r;
 if([7,8].includes(result.version)&&Array.isArray(memories)){const important=memories.filter(m=>['origin','choice','shared','relationship'].includes(m?.kind)),others=memories.filter(m=>!important.includes(m));memories=[...important,...others.slice(0,Math.max(0,32-important.length))].slice(0,32).map(m=>({...m,age:Math.floor(m.age)})).sort((a,b)=>a.age-b.age);}
 if(!r.entries.some(e=>e.code===code)&&r.entries.length<2000)r.entries.push({code,at,...(Array.isArray(memories)&&memories.length?{memories}:{})});return readSoul(r);
}
export function soulMilestone(record){const count=readSoul(record).entries.length;return {count,current:[...SOUL_ACHIEVEMENTS].reverse().find(a=>count>=a.at)||null,next:SOUL_ACHIEVEMENTS.find(a=>count<a.at)||null};}
