// A fictional, immutable almanac. Never real-world news, prices, population or game economy.
export const hash=s=>{let v=2166136261;for(const ch of String(s))v=Math.imul(v^ch.charCodeAt(0),16777619);return v>>>0;};
export const WORLD_VERSION=1;
export const REGIONS=['月桂丘陵','百柱山城','銀潮海岸','琥珀河谷','霧杉高地','白帆群島','星火平原','藍鹽港','銅鐘古城','橄欖南境','雪線關隘','鏡湖城邦'];
const CLIMATES=[['溫暖多雨',8,3],['長夏乾旱',-23,-5],['寒冬提早',-14,-13],['海風溫和',12,15],['季風猛烈',-8,-24],['春霜未退',-16,-8],['晴朗少風',7,12],['潮汐異常',-5,-18]];
const NEWS=[
 ['canal','新水渠接通了三座城邦','長年缺水的村莊第一次能在夏末留下種子。','harvest',16],
 ['storm','七日風暴迫使海港封航','商隊改走山路，岸上的人開始等一封遲到的信。','shipping',-25],
 ['library','百柱圖書館向平民開門','抄寫員、學徒與第一次識字的老人坐在同一排長桌前。','learning',20],
 ['fair','十二城邦舉行共同市集','遠方的工藝、口音和新食材湧進了熟悉的廣場。','trade',18],
 ['winter','雪線比往年向南推移','山路要提早封閉，過冬的柴薪成了街坊之間最常談的事。','harvest',-18],
 ['beacon','新燈塔點亮了外海航道','從未在夜裡進港的船，如今也能沿星光找到岸。','shipping',22],
 ['quarrel','兩座城邦的關稅協議破裂','跨境的布匹與銅材變貴了，工坊重新學著珍惜舊料。','trade',-19],
 ['music','巡迴樂團走遍內陸小鎮','沒有看過海的人，也開始哼唱一首關於遠方的歌。','culture',20],
 ['crop','久旱後迎來第一場春雨','農人把收好的犁重新拖出倉房，酒館裡的笑聲也多了。','harvest',24],
 ['bridge','跨河石橋完成最後一道拱','擺渡人的生活改變了，河兩岸卻第一次有了共同的早市。','trade',15],
 ['pirate','外海航線出現劫掠傳聞','船長改變航期，幾支陌生商隊開始結伴同行。','shipping',-20],
 ['school','山村夜校迎來第一批學生','孩子替大人念告示，大人替孩子補好漏雨的屋頂。','learning',17],
 ['observatory','觀星臺完成百年星圖','航海者不再只靠祖輩口傳的路線尋找方向。','learning',15],
 ['repair','震後的舊城開始共同重建','工匠和居民一起搬回石材，臨時的長桌每天都有人添菜。','trade',-10],
 ['peace','邊境城邦交換和平信物','幾條封閉的山徑重新開放，失散的家書終於能寄出去。','shipping',16],
 ['grain','穀倉聯盟開放平價糧食','原本只買得起半袋的人，第一次替鄰人也捎了一份。','harvest',15],
 ['craft','星燈工會公開失傳圖樣','年輕學徒不必遠赴大城，也能從一頁圖紙開始學藝。','learning',18],
 ['migration','北境旅人抵達橄欖南境','市集多了不同的香料，空置的小屋再次飄起炊煙。','population',14],
 ['river','冥河支流改道露出古碑','考據者與船夫爭論了整個月，誰也沒有急著先離開。','culture',18],
 ['festival','停辦多年的歸帆祭重新舉行','人們把沒有寄出的祝福繫在燈上，送向同一片夜空。','culture',22],
 ['drought','南境開始輪流取水','街坊把一天的用水重新排好，許多事因此需要彼此商量。','harvest',-26],
 ['medicine','旅人藥圃開始交換草種','山地與海邊的照護者坐在一起，記下彼此習慣的方法。','learning',12],
 ['market','銀潮港開通固定郵船','不用等到節慶，一封普通的問候也能跨海抵達。','shipping',19],
 ['quiet','這一年沒有轟動城邦的大事','街角換了新招牌，孩子長高了一點，平凡的日子仍然值得記下。','culture',6],
];
const clamp=(n,min=5,max=100)=>Math.max(min,Math.min(max,Math.round(n)));
export function worldYear(seed,age=0){return 600+parseInt(seed.slice(0,4),16)%600+Math.floor(age);}
export function almanac(year){
 const n=hash('star-world-v1:'+year),climate=CLIMATES[n%CLIMATES.length],news=NEWS[(n>>>5)%NEWS.length];
 const harvest=clamp(65+climate[1]+(n>>>11)%25-12+(news[3]==='harvest'?news[4]:0));
 const shipping=clamp(74+climate[2]+(n>>>17)%20-10+(news[3]==='shipping'?news[4]:0));
 const prices=clamp(100+(65-harvest)*.7+(75-shipping)*.3,65,160),learning=clamp(56+(n>>>9)%23+(news[3]==='learning'?news[4]:0));
 return {year,climate:climate[0],harvest,shipping,prices,learning,population:Math.round(4200000+(year-600)*1800+Math.sin(year/8)*28000),news:{id:news[0],title:news[1],detail:news[2],theme:news[3]},region:REGIONS[(n>>>22)%REGIONS.length]};
}
