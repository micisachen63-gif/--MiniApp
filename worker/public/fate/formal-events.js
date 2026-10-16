import {hash,worldYear,almanac,REGIONS} from './world.js';
import {LEGACY_MEMORIES} from './formal-ambient-v4.js';
import {CAREERS,THREADS,OBJECTS,NEW_MEMORIES} from './formal-catalog-v4.js';
import {FURTHER_MEMORIES} from './formal-days-v4.js';
import {socialThread,SOCIAL_ROLES} from './social-cast.js';
import {sharedMemories} from './shared-story.js';
import {lifeTiming,ageAtActive,narrativeTickAt} from './timing-v5.js';
import {V5_MEMORIES} from './formal-days-v5.js';
import {V5_CAREERS,V5_THREADS,V5_OBJECTS,V5_COMMUNITY,V5_REFLECTIONS} from './formal-catalog-v5.js';
import {V5_CHOICE_VARIANTS} from './formal-choices-v5.js';

export const NARRATIVE_VERSION=4;
export const EVENT_INTERVAL_MS=30000;
const DURATION=7200000,DAY=86400000,OFFSET=28800000;
const TURN_AGES=[18,40,66],RESOLVED_AGES=TURN_AGES.map(a=>a+1.125);
const clamp=n=>Math.max(0,Math.min(100,Math.round(n)));
const validSeed=s=>typeof s==='string'&&/^[a-f0-9]{8}$/.test(s);
const seedOf=l=>validSeed(l?.seed)?l.seed:'00000000';
const byte=(seed,i)=>parseInt(seed.slice(i*2,i*2+2),16);
const phases=['child','youth','adult','middle','late','elder'];
const phaseFor=a=>a<12?'child':a<24?'youth':a<40?'adult':a<56?'middle':a<74?'late':'elder';
const ambient=[...LEGACY_MEMORIES.map(e=>({...e,id:'v4-'+e.id})),...Object.entries(NEW_MEMORIES).flatMap(([phase,rows])=>rows.map((text,i)=>({id:`v4-new-${phase}-${i}`,phase,text}))),...Object.entries(FURTHER_MEMORIES).flatMap(([phase,rows])=>rows.map((text,i)=>({id:`v4-day-${phase}-${i}`,phase,text})))];
const v5Ambient=[...ambient,...Object.entries(V5_MEMORIES).flatMap(([phase,rows])=>rows.map((text,i)=>({id:`v5-day-${phase}-${i}`,phase,text})))].map(e=>({...e,shelf:hash('v4-shelf:'+e.id)%4}));
const v5ByPhase=Object.fromEntries(phases.map(phase=>[phase,v5Ambient.filter(e=>e.phase===phase)]));
const v5Careers=[...CAREERS,...V5_CAREERS],v5Threads=[...THREADS,...V5_THREADS],v5Objects=[...OBJECTS,...V5_OBJECTS];
const catalogues=life=>life?.version===5?{careers:v5Careers,threads:v5Threads,objects:v5Objects}:{careers:CAREERS,threads:THREADS,objects:OBJECTS};
const origins=[
 '你出生在守夜人輪流照看的海岸，最早認得的是燈影在牆上緩慢搖動。',
 '你出生在鐘樓下的山城，一天的開始由鐘聲告知，一天的結束由家門裡的飯香告知。',
 '你的家隨著商隊遷移，家人把睡過的地方畫在布上，讓漂泊也能有一幅自己的地圖。',
 '你的童年靠近卸貨的港口，不同口音的問早，替你打開了世界最初的門。',
 '你在白石神殿旁長大，最先學會照料的，是門邊供路人歇腳的一張矮凳。',
 '你的家人常在營地間行走，每到一處便先問哪裡能取水，也替下一戶留下乾柴。',
 '你出生在山頂觀測臺附近，家裡留著許多星圖，也留著一雙總沾著泥土的鞋。',
 '你在老工坊的敲擊聲裡長大，家人收下別人不要的零件，替尋常日子慢慢修出形狀。',
 '你在林地邊緣長大，家人教你先辨認路，再辨認花，最後才學著替它們取名字。',
 '你的家靠近舊檔案館，紙張晾曬的氣味與街角炊煙，一同留在最早的記憶裡。',
 '你在常有風浪的海灣出生，家裡的門閂很牢，也總有人替尚未回來的人留一盞燈。',
 '你出生在一條普通的小街，沒有人預先替你寫好傳奇，只有一張留給你慢慢長大的床。',
];
const infancy=[
 '你還不懂語言，已經會在熟悉的聲音靠近時安靜下來。有人把窗簾拉開一角，讓早晨先落在床邊。',
 '你伸手去抓牆上的光，握住的只有空氣。照顧你的人沒有急著教會你，只坐在旁邊看你重試。',
 '你扶著矮凳站起來，屋裡的人都放輕聲音，像怕驚動一件正在發生的大事。',
 '你跌坐在地上，哭了一會兒，伸手要人抱。那一天有人把手上的工作放下，先走向你。',
 '你開始用自己的聲音呼喚人，字還沒有完整，家人卻已經知道你想找誰。',
 '你的腳步還不穩，大人把門邊的尖角包起來，讓世界替你的好奇多讓出一點地方。',
 '你把兩塊積木疊在一起又推倒，屋外的城市也在建造，只是沒有人像你這樣放聲笑。',
];

export function formalScenes(life={}){
 const seed=seedOf(life),pool=catalogues(life),career=pool.careers[byte(seed,0)%pool.careers.length],thread=pool.threads[byte(seed,1)%pool.threads.length],object=pool.objects[byte(seed,2)%pool.objects.length];
 const community={
  ferry:['渡口的下一程','碼頭準備改建，常走舊路的人與盼望新路的人，各有不能輕忽的生活。街坊希望有人願意長期聽完兩邊的聲音。'],
  rooftop:['屋頂的一點綠','街坊想讓屋頂與窗臺留住更多花草，住得近的人卻有不同顧慮，需要有人協調每一個小小的位置。'],
  theatre:['散場以後的戲臺','一群人想保留街坊戲臺，願意看戲的人很多，能長期分擔整理、修繕與借用安排的人卻不夠。'],
  brother:['市場裡的公用桌','市場想增設共用桌與遮雨棚，攤販、來客和搬運者的需要並不一樣，街坊請你加入長期討論。'],
  weaver:['能容下不同手藝的屋','街坊希望騰出一間共享工作室，讓沒有自己店面的人也能學藝，需要有人安排借用與材料的分攤。'],
  stairs:['每個人都能走的路','街坊正盤點不容易通行的臺階與窄路，希望有耐心的人參與測量，讓改善不只停在一張漂亮的提案。'],
  letter:['讓問候能抵達的地方','街坊想設一處代讀與代寫書信的桌位，也要替不願公開的心事訂好保密規矩，需要穩定的協作者。'],
  dog:['院門外的相處','街坊想改善流浪動物與住戶的相處，餵食、清潔與安全都得有人長期負責，幾種聲音一直難以坐到一起。'],
  archive:['普通人的檔案室','有人提議替普通居民保留口述記錄，也有人擔心私事被任意傳閱，街坊請你協助建立能讓人安心的方式。'],
  rival:['把分歧留在桌上','街坊幾場合作因分帳與署名不明而破局，大家想重訂共同規則，卻需要有人願意面對不討喜的細節。'],
  bread:['長桌上的下一餐','街坊想把臨時的互助餐桌固定下來，除了食材，也需要仔細分配採買、清潔與休息的時間。'],
  gardeners:['空地能長出什麼','一塊公共空地的用途仍未決定，種菜、歇腳與往來通行都有人需要，大家希望有人把想法完整收集。'],
  ...(life.version===5?V5_COMMUNITY:{}),
 }[thread.id];
 const objectReflection={
  'brass-key':'無齒銅鑰匙曾讓你追問一扇不存在的門。到了安排交棒的時候，你知道留下答案與陪人學會發問，是兩種不同的工作。',
  'blue-bowl':'藍邊舊碗已不再只靠原先的用途被留下。你也開始思考，自己的經驗離開熟悉的手，還能不能在別處接住一些生活。',
  'red-thread':'朱紅線團一圈圈減少，留下的記號卻去過不同地方。你開始安排日後，想把有限的時間用在親自陪伴，或讓方法走得更遠。',
  bell:'啞聲小鈴沒有變成你最初以為的樣子，仍找到被珍惜的方法。當別人準備接過你的經驗，你希望親自陪伴，還是交出可以自由重寫的記錄？',
  atlas:'空頁小冊留下過許多問號。到了交棒的年紀，你想繼續坐在人身邊一起追問，或把那些問號送給未曾見面的讀者。',
  stone:'半透明河石曾讓你在用途與價值之間想了很久。如今要安排經驗的去處，你明白親自陪伴與公開記錄都需要認真的時間。',
  spoon:'缺角木匙記得笨拙的開頭。如今輪到別人開始，你想留在身邊慢慢示範，還是把開頭與失敗都寫清，讓更遠的人也能嘗試。',
  ticket:'舊市集票把一次相遇接回了後來的日子。安排交棒時，你想陪熟悉的人繼續工作，也看見未曾相識的人可能需要那些記錄。',
  ...(life.version===5?V5_REFLECTIONS:{}),
 }[object.id];
 const timing=lifeTiming({...life,seed});
 if(timing){
  const actualThread=socialThread(thread,life.socialCast),npc=SOCIAL_ROLES[thread.id]?.npc;
  const actualCommunity=actualThread.actor&&npc?community.map(text=>text.split(npc).join('「'+actualThread.actor+'」')):community;
  const context={career,thread:actualThread,object,community:actualCommunity,reflection:objectReflection};
  return V5_CHOICE_VARIANTS.map((variants,i)=>{
   const variant=variants[(byte(seed,i)>>4)%variants.length],scene=variant.build(context);
   return {...scene,id:`v5-scene-${i}-${variant.id}`,scenarioId:`v5-${i}-${variant.id}`,age:timing.choiceAges[i]};
  });
 }
 const scenes=[
  {id:`v4-scene-apprentice-${career.id}`,age:18,tag:'第一章 · 手藝與遠方',title:`成為${career.name}，從哪裡開始？`,text:`${career.place}願意收你為學徒，巡迴師傅也能傳授同一門手藝。你只能接受其中一份長期約定；兩條路都要從最笨拙的基本功開始。`,choices:[['留在本地學藝','在熟悉的街道，建立能長久往來的信任。',`你留在本地學習，開始了${career.name}的生涯，也答應把手藝留給街坊。`],['隨巡迴師傅學藝','在陌生的地方，學習不同的人怎樣生活。',`你隨巡迴師傅離開故鄉，開始了${career.name}的生涯，將陌生街道慢慢走成日常。`]]},
  {id:`v4-scene-time-${thread.id}`,age:40,tag:'第二章 · 有限的時間',title:`${community[0]}，或更遠的邀請？`,text:`${community[1]}同時，外地的手藝交流會也寄來邀請。你無法把兩份長期工作都做好，必須親自決定，把接下來的時間交給哪一邊。`,choices:[['承擔街坊的共同事務','少接幾份工作，與人一起把生活照料好。','你減少手上的工作，開始參與街坊事務，答應把聽見的意見帶回同一張桌上。'],['加入外地交流會','帶著手藝交換方法，也練習尊重差異。','你接受外地交流會的邀請，開始交換工作方法，承諾回來時留下可供人查閱的記錄。']]},
  {id:`v4-scene-legacy-${object.id}`,age:66,tag:'第三章 · 如何交棒',title:`${object.name}之後，經驗往哪裡去？`,text:objectReflection,choices:[['留在身邊慢慢教','讓接手的人能反覆問，也能走出自己的方法。','你留下固定的時間陪伴後輩，答應不把自己的習慣當成唯一正確的做法。'],['整理記錄公開送出','讓不曾見過面的人，也能接著嘗試。','你整理並公開自己的經驗記錄，標清已知與未知，讓遠方的人也能接著修正。']]},
 ];
 return scenes;
}

// Independent reactions to the same immutable fictional year. Their consequences are narrative-only.
export const WORLD_REACTIONS={
 canal:[['你沿新水渠幫忙測試分水閘，原本搶在清晨取水的幾戶人家，第一次能照約定輪流。',{bonds:3,energy:-1}],['新水渠減少了枯水時的奔波，你把省下的半日拿來學會修理家中的漏桶。',{energy:3,knowledge:1}]],
 storm:[['七日風暴讓送來的材料滯港，你改接修補的工作，生活餘裕少了一點，舊物卻多撐過一季。',{wealth:-4,knowledge:2}],['封航延長等待，你幫街坊整理誰還在等回信，讓焦急的人至少知道自己並不孤單。',{bonds:3,energy:-2}]],
 library:[['圖書館開放平民後，你坐到原本只隔窗看過的長桌旁，抄下一頁與工作有關的方法。',{knowledge:5}],['圖書館新增的閱覽時間讓你遇見不同年紀的讀者，討論往往從一個沒看懂的字開始。',{knowledge:3,bonds:2}]],
 fair:[['共同市集讓外地貨不再昂貴得難以接近，你買來一小份材料，先試做再決定是否替換舊方法。',{wealth:2,knowledge:2}],['共同市集擠滿不同口音，你幫一位攤主解釋標價，也學會自己曾誤讀的習俗。',{bonds:3,knowledge:1}]],
 winter:[['雪線南移，家中提早添置燃料，你把原訂的非必要採買延後，留出一點過冬的餘裕。',{wealth:-3,energy:-2}],['山路提早封閉，你與鄰人把需要共用的物資列清，免得有人得在大雪裡白跑一趟。',{bonds:3,energy:-1}]],
 beacon:[['新燈塔讓晚到的貨船也能靠岸，等候材料的工作終於接續，你把拖延的交付逐一補上。',{wealth:4,reputation:2}],['外海航道亮起新的光，你讀懂港務圖上的標記，第一次能向等待的人說明船會從哪邊來。',{knowledge:3,bonds:1}]],
 quarrel:[['關稅爭端推高了材料成本，你和同行交換剩料，讓同樣的東西不用各買一份。',{wealth:-3,bonds:3}],['跨境貨漲價，你重新核算一份委託，提早向對方說清，沒有把帳單上的難處拖到最後。',{wealth:-2,reputation:3}]],
 music:[['巡迴樂團來到街口，你替演奏者搬開一張桌子，在工作以外認識了另一種耐心。',{energy:3,bonds:1}],['樂團留下的新旋律很快被人改寫，你記下兩種版本，發現文化從來不只由第一個唱的人保存。',{knowledge:3}]],
 crop:[['久旱後的春雨讓菜攤重新便宜起來，你把晚飯添得豐富些，也替隔壁捎了一份。',{wealth:3,energy:3,bonds:1}],['雨後的土地重新翻動，你去幫忙把泡壞的木架移開，手上多出幾道小傷，也多認得幾戶人。',{bonds:3,energy:-1}]],
 bridge:[['跨河石橋通了，你去對岸辦事少用半日，卻仍在舊渡口向熟悉的人問一聲好。',{energy:3,wealth:2}],['新石橋把兩邊的市場連起來，你看見生意增加，也聽見有人擔心往後靠什麼生活。',{knowledge:2,bonds:2}]],
 pirate:[['劫掠傳聞改了船期，你取消一次不必要的催貨，與對方約定等可靠的消息再安排。',{wealth:-2,reputation:2}],['商隊開始結伴，你幫忙整理共同路程的補給清單，發現風險也需要人坐下來分擔。',{bonds:3,energy:-1}]],
 school:[['山村夜校開班，你捐出幾張能再用的紙，看見第一次寫名字的人把紙角壓得格外平整。',{knowledge:3,bonds:2}],['夜校讓鄰人能自己讀告示，你不必再替他逐字解釋，兩人終於能談談告示以外的事情。',{knowledge:2,bonds:3}]],
 observatory:[['新星圖公布，你照著圖辨認晚空，沒有因此知道未來，卻更清楚腳下的位置。',{knowledge:4}],['星圖改進了航行記錄，你學會查閱修訂日期，不再把印在紙上的事都當成永遠正確。',{knowledge:4,reputation:1}]],
 repair:[['震後重建佔用了人力，你的委託延後，空出的時間被你拿來搬運街坊需要的木板。',{wealth:-3,bonds:4,energy:-2}],['重建會議上，你請大家先讓仍無處歇息的人說話，再討論廣場要鋪什麼顏色的石頭。',{reputation:3,bonds:2}]],
 peace:[['邊境道路重開，你收到一份曾被退回的問候，信紙有些舊，說話的人卻仍願意再等一次回覆。',{bonds:4,energy:2}],['和平信物的消息傳來，市場多了幾種久未見的貨，你沒有囤積，只買回當週確實用得到的份量。',{wealth:3}]],
 grain:[['平價糧倉開放後，你把生活帳上的餘額重新分配，終於能修好一件拖了很久的小東西。',{wealth:4,energy:2}],['領糧的隊伍排得很長，你替行動不便的街坊留住位置，也問清楚下次可以代領的辦法。',{bonds:4,energy:-1}]],
 craft:[['工會公開圖樣，你照著做了一回，再把不適合本地材料的部分仔細註明。',{knowledge:4,reputation:1}],['新的工藝圖樣進了學堂，你看見原本買不起拜師機會的人，也能從同一頁開始。',{knowledge:3,bonds:2}]],
 migration:[['北境旅人來到南境，你幫忙辨認出租告示，也第一次知道熟悉的租屋規矩對外人有多難懂。',{bonds:4,knowledge:2}],['新住民增加了市場的買賣，也拉緊住屋供給，你參與討論，主張先把空置房的情況列清。',{wealth:-1,reputation:3,bonds:2}]],
 river:[['支流改道露出古碑，你陪人讀那些缺字的刻痕，把不確定的解讀留在括號裡。',{knowledge:4}],['古碑吸引許多訪客，你聽見船夫擔心河床變化，於是替遊人指路時也提醒不要踩進新露的濕泥。',{reputation:2,knowledge:2}]],
 festival:[['歸帆祭重新舉行，你沒有寫宏大的願望，只把一句平安回來繫在燈上。',{bonds:3,energy:3}],['節慶散場後，你和幾位街坊留下收拾，地上未亮完的小燈被一盞盞帶回可用的地方。',{bonds:3,reputation:1}]],
 drought:[['輪流取水的日子裡，你重排洗滌的時刻，把最後一盆清水先留給喝水與做飯。',{energy:-3,wealth:-2}],['旱年讓街坊需要共用水桶，你替桶身標上容量，不讓說話最大聲的人每次都多拿一份。',{bonds:3,reputation:2}]],
 medicine:[['草種交流會讓你遇見不同地區的照護者，你幫忙抄錄種植資料，並清楚標明這些記錄不等於療效證明。',{knowledge:4,bonds:1}],['交換來的草種先留在小畦試種，你看著照護者記下失敗，學會對不熟悉的方法多問一句。',{knowledge:4}]],
 market:[['固定郵船開航，你把原先捨不得寄的普通問候也送出去，回覆不再非得等到下一個節慶。',{bonds:4,wealth:1}],['郵船帶來更穩定的貨期，你重新安排採買，不必再為了害怕缺貨而把住處塞滿。',{wealth:3,energy:2}]],
 quiet:[['年鑑沒有記下轟動的大事，你卻記得巷口修好了路燈，晚歸時不必再摸黑找門。',{energy:2,bonds:1}],['平靜的一年讓許多小事得以完成，你把拖延的清單縮短幾行，沒有為生活不夠精彩而著急。',{energy:3,knowledge:1}]],
};

const civic=[
 '你第一次參加街坊議事，帶著空白紙而非現成答案，先把每位來者最在意的事寫下。',
 '街坊想改善公共空間，有人提長椅、有人提遮雨棚，你與大家先量出行人真正能通過的寬度。',
 '共同事務佔去更多時間，你承認自己做不完，把工作拆小，讓願意幫忙的人能接上一角。',
 '一位平常不肯出席的鄰人寫了反對意見，你在會議裡完整讀出，沒有因為難聽便省略。',
 '第一項共同工程完成後，你公開每筆用度與尚未解決的問題，請街坊自行查閱。',
 '你辭去街坊議事的固定職務，留下輪值與紀錄，讓共同行動不必繼續依靠同一個人。',
];
const exchange=[
 '你抵達外地交流會，先參觀對方怎樣工作，發現自己最習慣的規矩並非處處適用。',
 '你示範一項方法時出了錯，索性把失敗攤開，反而引出一場比成功時更實用的討論。',
 '交流會有人提出交換資料，你先確認原作者同意，再把能分享的部分整理成兩份。',
 '不同地方的材料讓同一個做法得到不同結果，你把限制和方法一起記下，不只帶回漂亮的樣品。',
 '你回來舉辦一次公開分享，先說哪些還沒驗證，讓沒能遠行的人也能提出質疑。',
 '你收到外地同伴的修正信，把原來發出的記錄一份份更新，沒有因為已經印好就放任錯誤。',
];
const legacyHome=['你把教學的第一天留給後輩提問，最久的問題竟是：你當年也這樣害怕做不好嗎。','接手的人沒有採用你的習慣，你耐心看完他的方法，承認有一處確實做得更好。','你取消一次原訂的長課，陪疲累的後輩把工具收好，讓他知道休息不需要先表現出色。','後輩開始帶自己的學生，你退到一旁，讓屋裡多出不必經過你同意的對話。'];
const legacyAway=['你把經驗記錄分成能確定、仍存疑與已失效三部分，讓讀者能知道應從哪裡接手。','遠方讀者寄來不同的實作結果，你把回信附在原稿後面，沒有把例外刪成整齊的結論。','你的記錄被譯成另一種文字，你和譯者逐項核對，特別留意那些看似相同卻意思不同的詞。','你收到未曾見面的後輩寄來的新版本，改動之處很多，讀完後仍覺得自己的工作有了去處。'];

// Same clock math as life.js, deliberately independent: model -> ending -> narrative must not cycle.
export function narrativeActiveBetween(from,to){
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return 0;
 const first=Math.floor((from+OFFSET)/DAY),last=Math.floor((to+OFFSET)/DAY);
 const overlap=d=>Math.max(0,Math.min(to,d*DAY-OFFSET+DAY)-Math.max(from,d*DAY-OFFSET+21600000));
 return first===last?overlap(first):overlap(first)+overlap(last)+Math.max(0,last-first-1)*64800000;
}

export function narrativeProfile(life={}){
 const seed=seedOf(life),orbit=Number.isInteger(life.orbit)&&life.orbit>=0&&life.orbit<12?life.orbit:11;
 const pool=catalogues(life);
 const rank=(items,tag)=>[...items].sort((a,b)=>hash(seed+tag+a.id)-hash(seed+tag+b.id));
 const primaryThread=pool.threads[byte(seed,1)%pool.threads.length],primaryObject=pool.objects[byte(seed,2)%pool.objects.length];
 return {seed,orbit,region:REGIONS[(byte(seed,3)+orbit)%REGIONS.length],career:pool.careers[byte(seed,0)%pool.careers.length],threads:[primaryThread,...rank(pool.threads,'people').filter(t=>t!==primaryThread).slice(0,3)].map(thread=>socialThread(thread,life.socialCast)),objects:[primaryObject,...rank(pool.objects,'objects').filter(o=>o!==primaryObject).slice(0,2)]};
}

export function plannedContent(life={},options={}){
 const profile=narrativeProfile(life),{seed,orbit,career}=profile;
 const timing=lifeTiming(life),isV5=!!timing;
 const limit=Math.max(0,Math.min(240,Number.isFinite(options.ticks)?Math.floor(options.ticks):240));
 const answers=Array.isArray(life.answers)?life.answers.slice(0,3):[],used=new Set(),rows=[],state={energy:65,knowledge:15,wealth:36,bonds:24,reputation:10};
 const progress=new Map(),worldSeen=new Set(),scenes=formalScenes(life);
 const push=(id,age,text,kind,delta={},extra={})=>{if(used.has(id))throw Error('Duplicate narrative id '+id);used.add(id);for(const k of Object.keys(state))state[k]=clamp(state[k]+(delta[k]||0));rows.push({id,age,text,worldYear:worldYear(seed,age),kind,state:{...state},...(isV5?{activeMs:Math.round(age/timing.deathAge*DURATION)}:{}),...extra});};
 push('v4-birth-'+orbit,0,`${origins[orbit]}星曆${worldYear(seed)}年，${profile.region}的風，翻開了你此生的第一頁。`,'birth');
 // Schedule chain chapters in age order; all prerequisites are replayed, never inferred from the ending.
 const resolvedTicks=isV5?timing.choiceOffsets.map(at=>{const deadline=at+90000,tick=narrativeTickAt(life,deadline);return timing.eventOffsets[tick]<deadline?tick+1:tick;}):RESOLVED_AGES.map(a=>Math.ceil(a/.375));
 const scheduled=new Map(resolvedTicks.map(tick=>[tick,null]));
 const schedule=(tick,item)=>{while(scheduled.has(tick))tick++;if(tick<=240)scheduled.set(tick,item);};
 if(isV5){
  // Reserve consequence chains after their own actual deadline. A late first
  // apprenticeship must not silently skip its opening chapter and every sequel.
  const spread=(start,end,count,fn)=>Array.from({length:count},(_,i)=>schedule(Math.round(start+(end-start)*i/(count-1)),fn(i)));
  spread(resolvedTicks[0]+1,225,10,j=>({type:'career',text:career.steps[j],chapter:j}));
  spread(resolvedTicks[1]+1,227,6,j=>({type:'commitment',chapter:j}));
  spread(resolvedTicks[2]+1,236,4,j=>({type:'legacy',chapter:j}));
  const tickForAge=age=>{const at=age/timing.deathAge*DURATION,tick=narrativeTickAt(life,at);return timing.eventOffsets[tick]<at?tick+1:tick;};
  profile.threads.forEach((thread,i)=>{const start=Math.max(8,tickForAge(thread.min))+i*2,end=tickForAge(Math.min(thread.max,timing.deathAge-2));thread.steps.forEach((text,j)=>schedule(Math.round(start+(end-start)*j/5),{type:'relationship',thread,text,chapter:j}));});
  profile.objects.forEach((object,i)=>object.steps.forEach((text,j)=>schedule(14+i*7+j*52,{type:'object',object,text,chapter:j})));
 }else{
  profile.threads.forEach((thread,i)=>{const start=Math.max(2,Math.ceil(thread.min/.375))+i*2,end=Math.floor(thread.max/.375);thread.steps.forEach((text,j)=>schedule(Math.floor(start+(end-start)*j/5),{type:'relationship',thread,text,chapter:j}));});
  profile.objects.forEach((object,i)=>object.steps.forEach((text,j)=>schedule(14+i*7+j*52,{type:'object',object,text,chapter:j})));
  [52,66,81,97,117,135,153,171,201,225].forEach((tick,j)=>schedule(tick,{type:'career',text:career.steps[j],chapter:j}));
  [113,128,146,164,186,211].forEach((tick,j)=>schedule(tick,{type:'commitment',chapter:j}));
  [184,200,218,236].forEach((tick,j)=>schedule(tick,{type:'legacy',chapter:j}));
 }
 for(let tick=1;tick<=limit;tick++){
  const age=isV5?ageAtActive(life,timing.eventOffsets[tick]):tick*.375,w=almanac(worldYear(seed,age)),item=scheduled.get(tick),resolved=resolvedTicks.map((at,i)=>tick>=at&&[0,1].includes(answers[i]));
  const choiceIndex=resolvedTicks.indexOf(tick);
  if(choiceIndex>=0&&resolved[choiceIndex]){const i=choiceIndex,a=answers[i],scene=scenes[i],source=life.sources?.[i]||(life.auto?.[i]?'auto':'manual');push(isV5?`v5-choice-${scene.scenarioId.slice(3)}-${a}`:`v4-choice-${i}-${a}`,age,scene.choices[a][2]+(source==='auto'?'這一頁在期限到達時，由命運代你翻過。':'這一頁由你親自選定。'),'choice',a===0?{bonds:4,reputation:2,wealth:-1}:{knowledge:4,energy:-1}, {choiceIndex:i,answer:a,source,...(isV5?{scenarioId:scene.scenarioId}:{})});continue;}
  if(tick<=7){push('v4-infancy-'+tick,age,infancy[tick-1],'memory',{energy:1,bonds:1});continue;}
  if(item){
   const key=item.thread?.id||item.object?.id||(item.type==='career'?`career-${career.id}`:item.type==='commitment'?`commitment-${answers[1]}`:item.type==='legacy'?`legacy-${answers[2]}`:item.type),chapter=item.chapter,previous=progress.get(key)||0;
   if(chapter===previous&&(!['career','commitment','legacy'].includes(item.type)||resolved[item.type==='career'?0:item.type==='commitment'?1:2])){
    let text=item.text,delta={};
    if(item.type==='career')delta={knowledge:3,wealth:chapter<3?1:2,reputation:2,energy:-1};
    if(item.type==='relationship')delta={bonds:3,energy:chapter===5?2:-1};
    if(item.type==='object')delta={knowledge:2,bonds:1};
    if(item.type==='commitment'){text=(answers[1]===0?civic:exchange)[chapter];delta=answers[1]===0?{bonds:4,reputation:2,wealth:-1}:{knowledge:4,reputation:1,energy:-1};}
    if(item.type==='legacy'){text=(answers[2]===0?legacyHome:legacyAway)[chapter];delta=answers[2]===0?{bonds:3,energy:1}:{knowledge:3,reputation:2};}
    progress.set(key,previous+1);push(`v4-${key}-${chapter}`,age,text,item.type,delta,{thread:key,chapter,requires:chapter?`v4-${key}-${chapter-1}`:null,...(item.object?{object:item.object.name}:{}),...(item.type==='career'?{career:career.name}:{})});continue;
   }
  }
  if(age>=7&&tick%3===0){const reactions=WORLD_REACTIONS[w.news.id]||WORLD_REACTIONS.quiet;const index=hash(seed+tick)%2,id=`v4-world-${w.news.id}-${index}`;if(!worldSeen.has(id)){worldSeen.add(id);const [reaction,baseDelta]=reactions[index],delta={...baseDelta};if(w.prices>=125)delta.wealth=(delta.wealth||0)-2;if(w.harvest<45)delta.energy=(delta.energy||0)-1;if(w.learning>=80)delta.knowledge=(delta.knowledge||0)+1;const metric=w.news.theme==='harvest'?`收成指數${w.harvest}、物價指數${w.prices}`:w.news.theme==='shipping'?`海運指數${w.shipping}`:w.news.theme==='learning'?`學識開放指數${w.learning}`:w.news.theme==='population'?`城邦總人口${w.population.toLocaleString('en-US')}人`:`物價指數${w.prices}、學識開放指數${w.learning}`;push(id,age,`${w.news.title}。這一年${metric}。${reaction}`,'world',delta,{worldCause:w.news.id,world:w});continue;}}
  if(age>=18&&tick%4===0){
   const dataEvents=[
    ['prices-high',w.prices>=125,'物價指數攀高，你把一份採買分成必要與可延後兩欄，這次先替日後可能的缺口留下一點餘地。',{wealth:-3,knowledge:1},'prices>=125'],
    ['prices-low',w.prices<=85,'物價回落，你終於買齊拖了很久的修繕材料，也把一部分省下的餘裕留下，沒有全數花盡。',{wealth:3,energy:2},'prices<=85'],
    ['shipping-low',w.shipping<=50,'海運指數偏低，工作需要的貨物遲遲未到，你主動調整交付順序，先完成不必等待外地材料的部分。',{wealth:-3,reputation:2},'shipping<=50'],
    ['shipping-high',w.shipping>=92,'海運暢通讓材料按時抵達，你比原定早完成一份工作，把多出的時間留給休息。',{wealth:2,energy:4},'shipping>=92'],
    ['learning-open',w.learning>=85,'學識開放指數升高，原本只能內部傳閱的資料可以借讀了，你帶著工作中的疑問逐頁查證。',{knowledge:5},'learning>=85'],
    ['harvest-low',w.harvest<=40,'收成指數偏低，街坊把長桌上的菜改成耐存的食材，你學會在選擇變少時仍把一頓飯做得仔細。',{wealth:-2,bonds:3},'harvest<=40'],
    ['harvest-high',w.harvest>=90,'豐收讓市場堆滿當季作物，你與鄰人合買一批，學著把吃不完的部分曬乾，留給之後的日子。',{wealth:4,knowledge:2},'harvest>=90'],
    ['population',w.population>=5500000,'城邦人口增加，空屋變得難找，你幫一位新來者逐項確認租約，沒有把陌生人的急迫當成抬價的理由。',{bonds:4,reputation:2},'population>=5500000'],
   ];
   const data=dataEvents.find(([id,condition])=>condition&&!used.has('v4-data-'+id));
   if(data){const [id,,text,delta,condition]=data;push('v4-data-'+id,age,text,'world',delta,{worldCause:'metric',world:w,condition});continue;}
  }
  // Actual state gates, with specific consequence and follow-up instead of cosmetic stat labels.
  if(age>=24&&state.wealth<24&&!used.has('v4-reserve-low')){push('v4-reserve-low',age,'生活餘裕不足以承受一次返工，你暫停非必要的採買，向合作的人說明狀況，沒有再假裝一切寬裕。','consequence',{wealth:4,bonds:2},{stateCause:'wealth<24'});continue;}
  if(used.has('v4-reserve-low')&&!used.has('v4-reserve-recover')&&state.wealth>=34){push('v4-reserve-recover',age,'先前縮減採買的日子過去了，你把第一筆真正剩下的餘裕留作備用，也記下當時願意等待的人。','consequence',{energy:3},{requires:'v4-reserve-low'});continue;}
  if(age>=30&&state.reputation>=55&&!used.has('v4-trusted')){push('v4-trusted',age,'因為幾次把難處提早說清，同行請你協調一份共同委託。你先公布自己也有利益在其中，讓信任不必靠誰盲目相信。','consequence',{reputation:2,energy:-2},{stateCause:'reputation>=55'});continue;}
  if(age>=50&&state.knowledge>=70&&!used.has('v4-method-revision')){push('v4-method-revision',age,`多年學習${career.name}的經驗，讓你看出一份常用說明的漏洞。你公開修正，也把自己過去照做時的錯誤一併寫出。`,'consequence',{knowledge:2,reputation:3},{stateCause:'knowledge>=70'});continue;}
  if(age>=55&&state.energy<=30&&!used.has('v4-rest')){push('v4-rest',age,'連續奔忙讓你終於無法忽略疲憊，你減少安排，請人分擔一部分事，讓休息成為往後日程中真正的一項。','consequence',{energy:12,wealth:-2},{stateCause:'energy<=30'});continue;}
  const phase=phaseFor(age),memoryPool=isV5?v5Ambient:ambient,eligible=isV5?v5ByPhase[phase].filter(e=>!used.has(e.id)):memoryPool.filter(e=>e.phase===phase&&!used.has(e.id));
  // Adjacent life stages are a reserve only; the authored stage supply normally remains sufficient.
  const reserve=eligible.length?eligible:memoryPool.filter(e=>!used.has(e.id)&&Math.abs(phases.indexOf(e.phase)-phases.indexOf(phase))<=1);
  // Four authored memory shelves spread a day's four lives across genuinely different prose.
  // The shelf is fully encoded by the seed; history is only used when selecting the next seed.
  const shelf=byte(seed,3)%4,preferred=reserve.filter(e=>(isV5?e.shelf:hash('v4-shelf:'+e.id)%4)===shelf);
  const candidates=preferred.length?preferred:reserve;
  if(!candidates.length)throw Error('Narrative catalogue exhausted at '+age);
  const prefix=answers.filter((_,i)=>resolved[i]).join('');
  const pick=candidates.reduce((a,b)=>hash(seed+tick+prefix+b.id)<hash(seed+tick+prefix+a.id)?b:a);
  const ageEnergy=age>74?-1:age<18?1:0,roll=hash(seed+'state'+tick);
  push(pick.id,age,pick.text,'memory',{energy:ageEnergy+(roll%3)-1,knowledge:roll%4===0?1:0,bonds:roll%3===0?1:0,wealth:age>=18&&age<70?(roll%5===0?-2:roll%5===1?1:0):0});
 }
 for(const m of sharedMemories(life.sharedMemories)){
  const elapsed=narrativeActiveBetween(life.startedAt,m.at),age=isV5?ageAtActive(life,elapsed):elapsed/DURATION*90;
  const cutoff=isV5?(Number.isFinite(options.activeMs)?options.activeMs:timing.eventOffsets[limit]):limit*EVENT_INTERVAL_MS;
  if(m.at<life.startedAt||elapsed>cutoff||elapsed>DURATION)continue;
  const state=[...rows].reverse().find(e=>e.age<=age)?.state;
  rows.push({id:m.id+'-'+m.at,age,kind:'shared',thread:m.id,source:m.source,text:m.text,state:{...state},worldYear:worldYear(seed,age),...(isV5?{activeMs:elapsed}:{})});
 }
 rows.sort((a,b)=>a.age-b.age||a.id.localeCompare(b.id));
 return rows;
}

export function formalEvents(life,now=life?.clockAt){
 if(![4,5].includes(life?.version)||!validSeed(life.seed)||!Number.isFinite(life.startedAt))return [];
 const at=Math.max(life.startedAt,Number.isFinite(now)?now:life.clockAt||life.startedAt);
 const elapsed=Math.min(DURATION,narrativeActiveBetween(life.startedAt,at)),ticks=life.version===5?narrativeTickAt(life,elapsed):Math.min(240,Math.floor(elapsed/EVENT_INTERVAL_MS));
 return plannedContent(life,{ticks,...(life.version===5?{activeMs:elapsed}:{})});
}

export function contentInventory({version=4}={}){const pool=catalogues({version}),topics=pool.careers.length+pool.threads.length+pool.objects.length,families=V5_CHOICE_VARIANTS.reduce((n,rows)=>n+rows.length,0);return {ambient:version===5?v5Ambient.length:ambient.length,infancy:infancy.length,careers:pool.careers.length,careerChapters:pool.careers.reduce((n,c)=>n+c.steps.length,0),relationshipChains:pool.threads.length,relationshipChapters:pool.threads.reduce((n,c)=>n+c.steps.length,0),objects:pool.objects.length,objectChapters:pool.objects.reduce((n,c)=>n+c.steps.length,0),worldReactions:Object.values(WORLD_REACTIONS).reduce((n,r)=>n+r.length,0),worldMetricEvents:8,commitmentChapters:civic.length+exchange.length,legacyChapters:legacyHome.length+legacyAway.length,originChapters:origins.length,choiceScenes:version===5?families:topics,...(version===5?{choiceFamilies:families,choiceContextTopics:topics,newAmbient:Object.values(V5_MEMORIES).reduce((n,rows)=>n+rows.length,0),newChainChapters:V5_CAREERS.reduce((n,c)=>n+c.steps.length,0)+V5_THREADS.reduce((n,c)=>n+c.steps.length,0)+V5_OBJECTS.reduce((n,c)=>n+c.steps.length,0)}:{})};}
