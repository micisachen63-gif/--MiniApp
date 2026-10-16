import {endingV8} from './narrative-v8.js';
import {plannedContent,formalEvents,narrativeProfile,narrativeActiveBetween} from './formal-events.js';
import {worldYear,hash} from './world.js';
import {lifeTiming} from './timing-v5.js';
import {endingV7} from './narrative-v7.js';

const ART='/art/fate-ending-20261016/';
const choiceProse=e=>e?.text.replace(/這一頁(?:在期限到達時，由命運代你翻過|由你親自選定)。$/,'')||'';
const one=(rows,tag)=>rows.length?rows[hash(tag)%rows.length]:null;

// A local, deterministic literary composition from actual replayed chapters. No external model/API.
// Descriptive bridges interpret memories; all concrete decisions and relationships come from the log.
export function endingForLife(life={}){
 if(life.version===8)return endingV8(life);
 if(life.version===7)return endingV7(life);
 const profile=narrativeProfile(life),{seed,career}=profile,timing=lifeTiming(life),complete=life.answers?.length===3&&(!timing||!Number.isFinite(life.startedAt)||narrativeActiveBetween(life.startedAt,life.clockAt)>=7200000);
 const events=complete?plannedContent(life):(Number.isFinite(life.startedAt)?formalEvents({...life,version:life.version===5?5:4},life.clockAt):plannedContent(life,{ticks:0}));
 const rows=events.length?events:plannedContent(life,{ticks:0}),last=rows.at(-1);
 const memories=rows.filter(e=>e.kind==='memory'&&e.age>=3),early=one(memories.filter(e=>e.age<18),seed+'early');
 const work=rows.filter(e=>e.kind==='career'),object=rows.filter(e=>e.kind==='object'),objectFirst=object[0],objectLast=object.filter(e=>e.thread===objectFirst?.thread).at(-1);
 const relationships=rows.filter(e=>e.kind==='relationship'),people=profile.threads.filter(t=>relationships.some(e=>e.thread===t.id)),socialPeople=people.filter(t=>t.actor),person=one(socialPeople.length?socialPeople:people,seed+'person'),relation=relationships.filter(e=>e.thread===person?.id);
 const world=one(rows.filter(e=>e.kind==='world'&&e.worldCause!=='metric'),seed+'world');
 const consequence=one(rows.filter(e=>e.kind==='consequence'),seed+'cost');
 const choices=rows.filter(e=>e.kind==='choice'),first=choices.find(e=>e.choiceIndex===0),middle=choices.find(e=>e.choiceIndex===1),final=choices.find(e=>e.choiceIndex===2);
 const legacies=rows.filter(e=>e.kind==='legacy'),legacy=legacies.at(-1);
 const old=one(memories.filter(e=>e.age>=74),seed+'old');
 const focus=life.answers?.[2]===1?'voyage':career.id==='garden'?'garden':['lamp','book','pot'].includes(career.id)?'atelier':'harbor';
 const titles={voyage:'紙頁以外，仍有海風',garden:'春天留在別人的手裡',atelier:'那些慢慢修好的日子',harbor:'潮水記得尋常的岸'};
 const paragraphs=[
  `${rows[0].text.split('星曆')[0]}許多年以後，回看這一生，最先浮起的仍是這些聲音與氣味。它們沒有替你決定將來，只給了你一個可以開始的地方。星曆${worldYear(seed)}年的${profile.region}，因此從年鑑裡的名字，變成這冊旅誌最貼近掌心的一頁。`,
  `${early?early.text:'最初的記憶還很輕，許多事都來不及取名字。'}${objectFirst?objectFirst.text:''}那時你未必懂得，一件東西為何值得留下。有時為了用途，有時，只因它替一段快要模糊的日子，保住了可以觸摸的邊緣。`,
  `${first?choiceProse(first):'關於往後方向的答覆，還沒有寫進這冊旅誌。'}${work.length?work[Math.min(2,work.length-1)].text:''}${work.length>7?work.at(-1).text:''}手藝沒有讓每個難題都變容易，卻讓你知道，做不好時仍能回來，把原因找出。這份笨拙而誠實的重來，後來比任何稱呼都更接近你。`,
  `${relation[0]?.text||'人與人的相遇尚未在紙上展開，空白仍留著可以坐下的位置。'}${relation.length>2?relation[Math.floor(relation.length/2)].text:''}${relation.length>1?relation.at(-1).text:''}有些關係並非一路順遂才留下，而是話語走偏時，仍有人願意多問一句。你記住的，正是那些沒有被結論草草收走的時刻。`,
  `${world?.text.replace(/這一年[^。]*。/,'')||'年鑑仍在繼續，旅誌尚未走到能讀懂它的地方。'}${choiceProse(middle)}${consequence?.text||''}城邦的變化進入家門，往往只是多等幾日、少買一樣東西。大世界因此有了日常的重量；你能做的，是在伸手可及的地方，認真回應一次。`,
  `${final?choiceProse(final):'最後如何交棒，仍要等這一世親自走到那裡。'}${legacy?.text||''}${objectLast&&objectLast!==objectFirst?objectLast.text:old?.text||''}有些遺憾仍是遺憾，沒有走過的路，也不必冒充抵達的遠方。但留下的這些，確實曾被你生活過。紙頁可以合起，屬於別人的明天仍然開著。`,
 ];
 const shared=rows.filter(e=>e.kind==='shared');if(shared.length)paragraphs.splice(4,0,...shared.map(e=>e.text+'有些路，並非只有自己的選擇留下痕跡。那一頁收到的回音，也成了你日後認得彼此的方式。'));
 if(timing&&complete)paragraphs.push(`星曆${worldYear(seed,timing.deathAge)}年，這一世在${timing.deathAge}歲合上了旅誌。那些親手修好的東西、認真回應過的人，仍在你留下的日常裡，接續下一段光。`);
 const auto=choices.filter(e=>e.source==='auto').length;
 const summary=complete?`在${profile.region}長大，成為${career.name}；${life.answers[1]===0?'把時間交給街坊的共同生活':'帶著手藝與外地人交換方法'}，最後${life.answers[2]===0?'留在身邊陪後輩慢慢學會':'把經驗公開交給更遠的讀者'}。`:'這一冊旅誌仍在展開，已發生的片刻正在慢慢接成一生。';
 return {illustration:ART+focus+'.webp',title:complete?titles[focus]:'尚未合上的旅誌',paragraphs,summary,stats:{...last.state,events:rows.length,career:work.length?career.name:null,relationships:new Set(relationships.map(e=>e.thread)).size,objects:new Set(object.map(e=>e.thread)).size,manualChoices:choices.length-auto,autoChoices:auto},worldYear:last.worldYear,quote:'願曾經認真生活過的片刻，也能替後來的人留一點光。',question:'若再走一世，你願意把時間留給什麼？',color:focus==='garden'?'#a8c9a0':focus==='voyage'?'#9cbde0':'#e3bd77'};
}
