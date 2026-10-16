// Version 1 is immutable: public links retain their original story, without a database.
// A code contains cosmetic story indices and random entropy ONLY. Never encode DOB.
import {endingForLife} from './ending-story.js';
export const ART='/art/fate-chapter-20261016/';
export const ZODIAC=['摩羯','水瓶','雙魚','牡羊','金牛','雙子','巨蟹','獅子','處女','天秤','天蠍','射手'];
export const ORBITS=[
 ['夜行者','別人入夢時，你替遠方留著一點光。','夜海邊，你在燈塔長大，學會聽懂風裡的腳步。'],
 ['守誓者','你記得的承諾，比星光還長。','山城鐘樓下，你第一次明白，一句約定可以陪人走很遠。'],
 ['流浪者','每一次離開，都替世界多開一扇窗。','你的童年在旅途度過，行囊不重，沿途的名字卻越記越多。'],
 ['港灣之子','你把陌生人的遠方，接成自己的日常。','潮水漲落的港口養大了你；每一艘船都帶來另一種生活。'],
 ['神殿學徒','你願意低下身，聽見微小的願望。','白石神殿裡，你從抄寫祈願開始，慢慢看見人們沒有說出口的心事。'],
 ['傭兵之子','你不常說溫柔，卻總把它帶在身上。','營火旁的故事陪你長大；你學會的第一件事，是替身邊的人留一個位置。'],
 ['觀星者','你望向天空，也記得腳下的路。','山頂的觀測臺是你的童年；你相信未知，也習慣替每一步留下記號。'],
 ['碎星鍛匠','有些碎裂，是另一種光的開始。','舊工坊裡，你把失去形狀的金屬重新打亮，也學著慢慢修補自己。'],
 ['荒野獵人','你聽見寂靜裡，生命正在靠近。','林間溪水教你辨認季節；你懂得等待，也知道何時該向前。'],
 ['沉默書記','沒有人記得的片刻，你替他們收好。','在塵封的圖書館長大，你替散落的信件找回收件人，也收下許多未完的故事。'],
 ['風暴舵手','浪頭很高，你仍願意為同伴掌舵。','海上的日子教你：勇敢不是沒有猶豫，而是猶豫過後依然握緊船舵。'],
 ['無名旅人','還沒有名字的明天，正等你親手寫下。','沒有誰替你的出身寫好註腳。你帶著一本空白旅誌，來到星燈亮起的海岸。'],
];
export const ENDINGS=[
 {title:'燈火守望者',quote:'世界不一定記得你，歸途卻永遠有光。',body:'你把最後一盞星燈留在岸邊。風停之後，人們沿著它回到家，而你終於有了願意守候的地方。',question:'如果沒有人知道，你還會留下那盞燈嗎？',color:'#e3bd77'},
 {title:'歸途守誓者',quote:'你想抵達的遠方，也有一個人正在等你。',body:'你帶著星燈走過風雨，也沒有忘記折返的約定。多年後，旅誌裡最亮的一頁，仍是那個有人等你的夜晚。',question:'遠方與約定之間，你會怎麼選？',color:'#9fcec8'},
 {title:'織星同行者',quote:'你帶走的不是星光，是一起走過黑夜的人。',body:'你將星燈交到同伴手裡，一起修好了通往山城的小路。後來你才發現，真正照亮旅途的，是願意同行的人。',question:'你的最後一盞星燈，會交給誰？',color:'#aebfe5'},
 {title:'逐星尋路人',quote:'沒有寫好的結局，也值得你出發。',body:'你提著星燈登上船，航向地圖之外。你不知道下一座島叫什麼，只知道每一次選擇，都讓這段人生更像自己。',question:'如果能重新出發，你還會選同一條路嗎？',color:'#c6a4df'},
];
export const SCENES=[
 {tag:'第一幕 · 初逢',title:'風起之前，你遇見了誰？',text:'成年那年，你在海岸遇見一位修燈的旅人。他要前往山城，卻把一張通向未知島嶼的船票遞給了你。',choices:[['留下幫他修燈','先把眼前的光修好，再決定遠方。','你記下了燈匠的名字，替一盞舊燈重新點火。'],['收下船票同行','有些答案，得走出去才會知道。','你收下船票，也約好要把海上的故事帶回來。']]},
 {tag:'第二幕 · 風雨',title:'只能帶走一樣，你選什麼？',text:'暴風雨來得比預期更快。渡船只能再裝一件行李：一箱修橋的工具，或一幅指向新航道的星圖。',choices:[['帶上修橋工具','讓後來的人，也能平安走過。','你留下的是一條能讓陌生人安全通過的路。'],['帶上未知星圖','也許另一條路，會帶來新的可能。','你替船員找到一條沒有人標記過的航道。']]},
 {tag:'第三幕 · 星燈',title:'最後一盞星燈，留給誰？',text:'夜色降臨，只剩最後一盞星燈。港口需要引路的光，同伴也正等著你搭上駛向遠方的船。',choices:[['留給岸上的人','願每一個晚歸的人，都認得回家的路。','你把星燈放在岸上，向船上的同伴揮手約定再見。'],['帶著同伴出航','我們一起，去照亮還沒走過的地方。','你提起星燈，與同伴一同走向尚未命名的明天。']]},
];
export function validBirth(value,today=new Date()){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const [y,m,d]=value.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d));
 if(y<1900||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d||value>`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`)return null;
 return {year:y,month:m,day:d};
}
export function zodiacFor(month,day){const edges=[20,19,21,20,21,22,23,23,23,24,23,22];return day<edges[month-1]?month-1:month%12;}
export function encodeResult({orbit,answers,zodiac=null,seed,version=1,auto=[]}){
 const code=`f${version}${orbit.toString(36)}${answers.join('')}${version>=3?auto.join(''):''}${zodiac===null?'x':zodiac.toString(36)}${seed}`;
 if(!decodeResult(code))throw Error('Invalid story');return code;
}
export function decodeResult(code){
 if(typeof code!=='string'||!/^(?:f[12][0-9ab][01]{3}[0-9abx][a-f0-9]{8}|f[34][0-9ab][01]{6}[0-9abx][a-f0-9]{8})$/.test(code))return null;
 const version=Number(code[1]),orbit=parseInt(code[2],36),answers=[...code.slice(3,6)].map(Number),z=version>=3?9:6,zodiac=code[z]==='x'?null:parseInt(code[z],36),ending=answers.reduce((a,b)=>a+b,0);
 const end=version>=3?{...ENDINGS[ending]}:version>=2&&ending===2?{...ENDINGS[ending],body:'你將星燈交到同伴手裡，沿途替彼此照亮下一步。多年後你才發現，真正留下來的，是那些願意與你一起走過黑夜的人。'}:ENDINGS[ending];
 if(version>=3)end.body=['你把許多重要的片刻留給身邊的人。那些不起眼的守候，後來成了別人願意回來的理由；這一生，你也找到了願意安放星燈的地方。','你在熟悉的地方與未知的遠方之間，慢慢走出自己的步調。有些約定一直帶在身上，有些答案，是在回望時才終於明白。','你與許多人交換過方向，也曾替彼此照亮下一步。這一生最鮮明的記憶，不只關於抵達哪裡，更關於那些願意一起走過的人。','你一次次走向尚未明朗的道路，把疑問留在旅誌，把星光帶向下一個相遇。世界仍有許多空白，而這一生的每一步，都留下了屬於你的筆跡。'][ending];
 const result={version,code,orbit,answers,auto:version>=3?[...code.slice(6,9)].map(Number):answers.map(()=>0),zodiac,seed:code.slice(z+1),identity:ORBITS[orbit],ending:end,endingIndex:ending};
 if(version===4){const formal=endingForLife(result);result.ending={...end,...formal,body:formal.summary};}
 return result;
}
export function newSeed(){const b=new Uint8Array(4);crypto.getRandomValues(b);return [...b].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function generatedZodiac(seed){return /^[a-f0-9]{8}$/.test(seed||'')?parseInt(seed.slice(0,4),16)%12:0;}
export function randomOrbit(zodiac=null){const b=new Uint32Array(2);crypto.getRandomValues(b);return zodiac!==null&&b[0]%2===0?zodiac:b[1]%12;}
export function publicUrl(code,origin='https://elf-rpg-api.micisachen.workers.dev'){if(!decodeResult(code))throw Error('Invalid story');return `${origin}/fate/r/${code}`;}
export function telegramUrl(code){if(!decodeResult(code))throw Error('Invalid story');return `https://t.me/StarJournalRpgBot?start=fate_${code}`;}
export function shareText(result,includeZodiac=true){return `這一世，我是「${includeZodiac&&result.zodiac!==null?ZODIAC[result.zodiac]+'座 · ':''}${result.identity[0]}」。\n在星穹旅誌，留下了《${result.ending.title}》。\n「${result.ending.quote}」\n${result.ending.question}\n不用登入，讓人生隨時間展開，寫下你的命運旅章。`;}
