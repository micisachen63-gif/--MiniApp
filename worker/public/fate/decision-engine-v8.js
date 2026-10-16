// Frozen Taiwan metropolitan recipe. Money is fictional NTD story accounting,
// not salary statistics, economic advice or a claim to professional credentials.
// Service authentication, effective day/night time and CAS remain server-owned.
import {hash} from './world.js';
import {TAIWAN_CAREER_CHOICES_V8} from './taiwan-choices-v8.js';

export const TAIWAN_RECIPE_V8='v8-tw-metro-1';
export const TAIWAN_DURATION_MS=7200000;
export const TAIWAN_RESPONSE_MS=90000;
const MAX=9;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const ratio=(seed,tag)=>{let x=hash(TAIWAN_RECIPE_V8+':'+seed+':'+tag);x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return ((x^(x>>>16))>>>0)/4294967296;};
const integer=(seed,tag,a,b)=>a+Math.floor(ratio(seed,tag)*(b-a+1));
const fail=message=>{throw new Error('v8 Taiwan life: '+message);};
const validSeed=seed=>typeof seed==='string'&&/^[a-f0-9]{8}$/.test(seed);
export const TAIWAN_CAREERS_V8=freeze([
 {id:'early_childhood_assistant',label:'幼兒園活動與行政支援',track:'care',minAge:18,practice:'你完成活動材料、出入紀錄與交接演練，跟著園所同事熟悉一天的節奏。'},
 {id:'care_support',label:'照顧行政與生活支援',track:'care',minAge:18,practice:'你完成預約、用品及轉介流程演練；沒有把這段訓練當成照服員或護理師資格。'},
 {id:'engineering_assistant',label:'工程文書與專案助理',track:'technical',minAge:18,practice:'你依指導整理圖面版本與工程紀錄，不簽認依法應由專業人員負責的文件。'},
 {id:'software',label:'軟體開發助理',track:'technical',minAge:18,practice:'你修好一個小功能、補上操作紀錄，讓同事實際檢查後再合併。'},
 {id:'restaurant_service',label:'餐飲外場服務',track:'service',minAge:18,practice:'你練習點單、清潔與過敏資訊交接，尖峰時段先跟著前輩熟悉動線。'},
 {id:'retail',label:'門市零售服務',track:'service',minAge:18,practice:'你核對收銀、庫存與退換貨流程，開始能在交班時說清楚待處理的事。'},
 {id:'night_market_vendor',label:'夜市攤位經營',track:'business',minAge:18,practice:'你先跟攤核對原料、清潔與擺攤安排，確認場地及適用規定後才準備小規模試賣。'},
 {id:'logistics',label:'物流理貨與調度助理',track:'technical',minAge:18,practice:'你練習貨件掃碼、錯件查核與調度交接，沒有在未具資格時操作需證照的車輛。'},
 {id:'freelance_design',label:'設計接案',track:'creative',minAge:18,practice:'你完成可讓客戶檢查的設計樣稿，先說清修改次數、授權範圍與付款節點。'},
 {id:'creative_content',label:'影像與內容創作',track:'creative',minAge:18,practice:'你完成一段有權使用素材的作品，留下製作與授權紀錄，先從小型委託開始。'},
 {id:'household_care',label:'家庭照顧與家務協調',track:'care',minAge:21,practice:'你和需要協助的家人談過意願，試行採買、陪同與可輪替的家務分工。'},
 {id:'night_reception',label:'酒家陪侍接待',track:'service',minAge:21,practice:'你核對臺北場館營業許可、排班與報酬，練習席間陪談、點單及同事交接；是否喝酒、互動與離席，都先說清自己的界線。'},
 {id:'administrative',label:'行政與帳務助理',track:'service',minAge:18,practice:'你核對單據、排程與個資權限，先由負責同事複核，不冒稱會計師資格。'},
 {id:'beauty_assistant',label:'美髮與造型助理',track:'creative',minAge:18,practice:'你練習工具清潔、預約和非侵入式造型協助，不進行醫療美容或未具資格的處置。'},
 {id:'repair_assistant',label:'維修接待與檢測助理',track:'technical',minAge:18,practice:'你先做收件、外觀檢查與維修紀錄；需要專業資格的工程交由合格人員處理。'},
 {id:'hospitality',label:'旅宿接待與房務協調',track:'service',minAge:18,practice:'你完成訂房核對、交班與緊急聯繫演練，讓來自不同地方的人知道可以向誰求助。'}
]);
const FAMILIES=freeze([
 {id:'tight',label:'精打細算的家庭',money:24000,support:38,text:'家人把生活費一筆一筆記在便條紙上，也會為你多留一份早餐。'},
 {id:'ordinary',label:'靠日常工作維持的家庭',money:90000,support:58,text:'家裡的時間跟著輪班與上下課移動，晚餐常等到最後一個人回來才收桌。'},
 {id:'small_business',label:'做小生意的家庭',money:160000,support:50,text:'家中有人做小生意；你很早知道，今天收進來的錢不全是可以花掉的收入。'},
 {id:'comfortable',label:'有些餘裕的家庭',money:480000,support:72,text:'家裡有一點可以應付突發狀況的餘裕，長輩也會問你真正想試的是什麼。'}
]);
export function taiwanProfile(seed,orbit=11,country='TW'){
 if(!validSeed(seed)||!Number.isInteger(orbit)||orbit<0||orbit>11)fail('invalid identity');
 if(country!=='TW')fail('country pack is not open');
 const identity=seed+':orbit:'+orbit,family=FAMILIES[integer(identity,'family',0,FAMILIES.length-1)],cities=[['TPE','臺北'],['NWT','新北']],city=cities[integer(identity,'city',0,1)],gender=ratio(identity,'gender')<.5?'f':'m';
 const pool=TAIWAN_CAREERS_V8.filter(c=>city[0]==='TPE'||c.id!=='night_reception'),first=integer(identity,'career-first',0,pool.length-1),second=(first+1+integer(identity,'career-alt',0,pool.length-2))%pool.length;
 return freeze({version:8,recipe:TAIWAN_RECIPE_V8,durationMs:TAIWAN_DURATION_MS,responseMs:TAIWAN_RESPONSE_MS,country:'TW',countryName:'臺灣',region:'雙北都市生活',city:city[0],cityName:city[1],gender,genderLabel:gender==='f'?'女性':'男性',deathAge:integer(identity,'lifespan',59,103),eventLimit:integer(identity,'event-limit',6,9),familyId:family.id,familyLabel:family.label,familyText:family.text,identityLabel:city[1]+'・'+(gender==='f'?'都市之女':'都市之子'),careerOptions:[pool[first].id,pool[second].id],careOpportunity:ratio(identity,'family-care')<.65});
}
const choice=(label,reason,outcome,set={},delta={})=>({label,reason,outcome,set,delta});
const event=(id,ages,chance,requires,title,text,choices,extra={})=>({id,family:id,ages,chance,requires,title,text,choices,...extra});
function catalogue(profile){
 const careers=profile.careerOptions.map(id=>TAIWAN_CAREERS_V8.find(row=>row.id===id));
 return [
 event('school-friend',[7,15],.35,[],'放學後的那段路，想怎麼走？','同學約你在圖書館一起準備報告，你也有一件想自己完成的小作品。',[
  choice('留在圖書館，一起把報告做完','建立合作關係，少一點獨處時間。','你們搭公車回家前把分工寫清楚，從同學慢慢成為可以開口求助的朋友。',{trustedPeer:true},{bonds:12}),
  choice('先完成自己的小作品','練習獨立，不保證作品會帶來職涯。','你帶著材料回家，試了一次又一次；沒有得獎，也留下第一件真正完成的小東西。',{independentProject:true},{knowledge:9})]),
 event('learning-choice',[15,24],.45,[],'升學和生活費，要怎麼一起安排？','你查了學校、技職與進修資訊；家裡能負擔的時間和支出，必須一起算進去。',[
  choice('試讀有興趣的課程','投入劇情學習費用，不等於取得學位。','你安排一段試讀與練習，先用實際內容判斷方向；這不是一張畢業證書。',{education:'college-course',courseRoute:true},{moneyNtd:-18000,knowledge:12}),
  choice('先工作，再留時間進修','保留生活費，後續仍需實際完成訓練。','你把打工和學習時間排在同一張月曆上，先照顧能繼續走下去的條件。',{education:'work-study'},{moneyNtd:12000,energy:-5})]),
 event('career-training',[18,31],1,[],'下一段生活，想先靠近哪一種工作？','你問過工作內容，把訓練、交通與能負擔的生活費排在一起，選一條願意實際練習的路。',careers.map(c=>choice('先準備'+c.label,'需要完成練習，再尋找第一個能負責的機會。','你選擇先接觸'+c.label+'，開始詢問實際入門方式，也為練習排出時間。',{trainingStarted:true,trainingTrack:c.track,careerTarget:c.id},{moneyNtd:-12000,knowledge:5})),{minAgeByOptions:true}),
 event('career-practice',[20,47],1,['trainingStarted'],'第一段練習卡住了，要不要繼續？','花時間準備以後，真正的工作仍和想像有落差；你需要決定是否完成這一段實作。',[
  choice('請人檢查，完成這次練習','需要真的完成修改，才打開入門工作。','你接受具體回饋，修正一次可被檢查的實作，知道自己接下來能負責到哪裡。',{practiceCompleted:true},{knowledge:12,energy:-6}),
  choice('先暫停，換一種生活安排','這條職涯暫不開啟，可以走照顧、社區或其他支線。','你承認眼前方向不適合，先停下費用與時間投入，沒有把未完成的練習算成資格。',{trainingStarted:false,trainingPaused:true,education:'paused'},{moneyNtd:3000})],{afterYears:.7}),
 event('career-entry',[21,54],1,['practiceCompleted'],'第一個能負責的工作機會來了。','有人願意讓你在明確指導與交接範圍內開始工作，你也可以先觀察、暫不承諾。',[
  choice('接受入門工作，照範圍累積經驗','先從助理、服務或受指導任務開始。','你接受入門工作，先確認分工、報酬與求助對象；尚未能獨立負責的部分沒有硬接。',{workActive:true,employed:true,careerStage:1},{moneyNtd:80000,energy:-7}),
  choice('不接這份工作，保留轉換空間','不取得這份收入，也不補發不存在的職稱。','你婉拒眼前安排，整理已完成的練習，保留重新尋找工作的空間。',{careerTransition:true},{moneyNtd:-5000})],{afterYears:.6}),
 event('career-restart',[24,66],1,[],'停下一條路之後，想不想試另一個方向？','上次暫停的原因已經比較清楚。你重新查了能負擔的入門方式，這次可以先用另一種工作的小任務試試。',[
  choice('重新排出時間，試另一條工作路線','從不同的職涯重新練習，不沿用上次的工作資格。','你把生活費與能投入的時間重新算過，選擇從另一條工作路線開始練習。',{restartTrainingStarted:true,trainingPaused:false,practiceCompleted:false,portfolioAccepted:false},{moneyNtd:-10000,knowledge:5}),
  choice('暫不入行，先安頓生活與自己的計畫','不立刻取得工作，之後仍能回應生活中的邀請。','你這次沒有報新的訓練，先安頓生活費與自己的計畫；暫停沒有把剩下的人生一起關掉。',{restartIndependent:true},{energy:6})],{requiresAny:['trainingPaused','careerTransition'],excludes:['workActive'],afterYears:2}),
 event('restart-practice',[26,74],1,['restartTrainingStarted'],'換了一條路，練習中遇見的新問題怎麼辦？','新的入門任務和先前不同。你可以把反覆卡住的部分拿去請人檢查，也可以承認現在仍不適合投入。',[
  choice('完成一次可檢查的實作，再接受回饋','需要實際修改完成，才有新的入門機會。','你把新路線的入門任務做完，依照回饋修改，再確認自己能承擔的工作範圍。',{restartPracticeCompleted:true},{knowledge:12,energy:-5}),
  choice('停下這段練習，改留時間給生活','不取得這條職涯的入門進展，也不抹去已試過的經驗。','你停下這段練習，把投入的時間與費用整理清楚，先回應眼前能承擔的生活安排。',{restartTrainingStarted:false,restartPracticePaused:true},{energy:6})],{afterYears:1.5}),
 event('restart-entry',[28,82],1,['restartPracticeCompleted'],'這一次，有人願意讓你從新的工作開始。','你已完成另一條路線的實作。工作條件與上次不同，接受之前仍要把報酬、時段與交接範圍說清楚。',[
  choice('接受新的入門工作，重新累積交付','從新的職涯開始，不直接承接超過能力的責任。','你確認工作條件，接受新的入門工作，把已練習過的部分一項項落進真正的日常。',{workActive:true,employed:true,careerStage:1,careerTransition:false},{moneyNtd:55000,energy:-6}),
  choice('不接這份安排，保留自己的步調','沒有這份收入，仍可繼續參與生活與人際。','你沒有接下眼前的工作安排，也把原因說清楚；這次練習仍留在經驗裡，沒有被改寫成失敗證明。',{restartEntryDeclined:true},{energy:4})],{afterYears:.7}),
 event('restart-delivery',[30,87],1,['restartPracticeCompleted','workActive'],'新的工作第一次交班，你想留下什麼？','同事開始把一小段工作交給你。你可以先把交付做穩，也可以先縮小範圍，讓每個人知道你能負責到哪裡。',[
  choice('完成交付，把能核對的紀錄留下','多花一段整理時間，建立新職涯的可信經驗。','你完成新工作的一次交付，留下同事能核對的紀錄，這份熟練來自重新做過，而不只是換了職稱。',{careerStage:2,portfolioAccepted:true,restartedDelivery:true},{moneyNtd:95000,reputation:9}),
  choice('先縮小承接，補好需要確認的地方','少一部分收入，把新工作的界線談清楚。','你先縮小這次承接，把需要確認的地方問清楚，再完成可負責的部分，不用逞強證明自己選對了路。',{careerStage:2,restartedScopeBounded:true},{moneyNtd:30000,support:7})],{afterYears:1,excludes:['caregiver']}),
 event('fresh-life-plan',[31,83],1,[],'工作先擱著，這段生活想留給什麼？','你沒有接續上次的工作路線，但生活裡仍有一件能開始的小事，也有願意邀你一起參與的人。',[
  choice('留固定時間，完成自己的小作品','不保證帶來收入，先保有能持續的事情。','你留下固定時間，把照片、文字或手作慢慢做完；這件事沒有先變成工作，仍然佔住人生的一角。',{creativePractice:true,independentProject:true},{knowledge:10,energy:-3}),
  choice('加入社區一段能持續的分工','要投入時間，也可能重新建立支持與關係。','你加入一段確實能到場的分工，和附近的人一起整理、輪值或互相支援，日子不再只剩等待下一份工作。',{communityActive:true,trustedPeer:true},{support:13,bonds:10})],{requiresAny:['restartIndependent','restartPracticePaused','restartEntryDeclined'],afterYears:2}),
 // Qualification source checked 2026-10-16: MOE licence 477 and GL001814.
 // Starting preparation never awards a degree or teaching title. Each later
 // milestone needs a separate decision, years of elapsed life and prior flags.
 event('teacher-study',[23,48],1,['teacherTrackEligible','workActive'],'看著孩子們的課堂，你想不想往教學再走一步？','你已熟悉園所活動與行政，若想成為幼兒園教師，必須另走學位與師資培育路線；讀書的時間和費用都要重新安排。',[
  choice('申請進入學士與幼兒園師資培育路線','需要多年完成學位與認可課程，仍保留原支援身分。','你確認入學與師資培育資格後開始修讀，白天工作、課後讀書，尚未拿到教師證書。',{teacherStudyStarted:true},{moneyNtd:-180000,energy:-12}),
  choice('把活動與行政工作繼續做深','保留原職涯，不因待得久就自動變成教師。','你選擇先把園所行政與活動支援做穩，讓每一次交接都能照顧到孩子和家長。',{teacherStudyDeclined:true},{moneyNtd:40000})],{afterYears:1,excludes:['careerTransition','caregiver']}),
 event('teacher-degree',[27,62],1,['teacherStudyStarted'],'多年課程走到最後，這次還要繼續嗎？','學士與幼兒園師資職前課程的最後一段，碰上工作最忙的時候；你需要決定是否把修業、考試準備都完成。',[
  choice('完成學位與師資職前課程，通過教師資格考試','完成這一階段後，還需要教育實習及格與申請取證。','你完成學士學位及認可的幼兒園師資職前課程，取得修畢證明，也通過教師資格考試；接下來是教育實習。',{teacherDegreeCompleted:true,teacherPreEducationCompleted:true,teacherExamPassed:true,education:'bachelor'},{moneyNtd:-140000,knowledge:24}),
  choice('先暫停修業，回到原來的工作','未完成的學位、考試與教師證書都不會補發。','你先停下這段修業，回到原本能負責的活動與行政工作，把生活費和休息重新安頓。',{teacherStudyStarted:false,teacherStudyPaused:true},{energy:8})],{afterYears:4,excludes:['careerTransition','caregiver']}),
 event('teacher-certificate',[28,68],1,['teacherDegreeCompleted','teacherPreEducationCompleted','teacherExamPassed'],'實習與取證的最後一段，你想怎麼走？','你已具學位、師資職前教育證明與教師資格考試成績，現在需要把教育實習、申請文件與求職安排一起完成。',[
  choice('完成教育實習、申請核發證書，再接受聘任','實習成績及格、經申請審核取得證書後，才以教師身分受聘。','你完成教育實習並取得及格文件，透過師資培育大學申請，經審查核發幼兒園教師證書；之後應徵並受聘，第一次以幼兒園教師身分帶班。',{teacherInternshipPassed:true,teacherCertificateGranted:true,teacherHired:true,careerLabel:'幼兒園教師',careerStage:3},{moneyNtd:120000,reputation:18}),
  choice('暫不實習取證，保留目前的工作安排','已有學位與考試進展，不等於已取得教師證書。','你決定暫不進入實習與取證，繼續原來的園所支援工作，沒有用尚未核發的證書替自己改職稱。',{teacherCertificationDeferred:true},{energy:7})],{afterYears:.6,excludes:['careerTransition','caregiver']}),
 event('work-delivery',[23,62],1,['workActive'],'工作出了差錯，這次要怎麼交代？','一項交接出了落差，顧客與同事都在等答案。你可以提早說明，也可以先停下不確定的承諾。',[
  choice('說清錯誤，完成可查核的修正','能建立可靠交付，也要承擔補做成本。','你把問題與修正方式說清楚，完成對方能核對的交付；信任不是只靠一句抱歉留下的。',{portfolioAccepted:true,careerStage:2},{moneyNtd:140000,reputation:15}),
  choice('暫停這一單，退回可處理的費用','收入減少，先保住能承擔的範圍。','你退回可處理的費用，停下這次超出範圍的承諾，重新確認自己能負責到哪裡。',{projectDeferred:true,careerStage:2},{moneyNtd:-30000,reputation:3})],{afterYears:1.1,excludes:['caregiver']}),
 event('business-start',[25,65],.8,['workActive','portfolioAccepted'],'熟悉的客人問，要不要自己接著做？','你已有完成交付的經驗。自己承接需要資金、場地或合作安排，並不保證比原工作穩定。',[
  choice('先確認規則與成本，小規模開始','投入劇情本金，之後可能成功、倒閉或退出。','你確認適用規則與可用場地，寫清合作、帳目及退出方式，用小規模開始承接。',{ventureOpen:true,selfEmployed:true,employed:false,careerStage:3},{moneyNtd:-100000}),
  choice('留在原團隊，把工作做穩','保留原工作安排，不走創業風險。','你決定先把原來的工作做穩，重新確認分工，沒有因為別人催促就開店。',{careerRenewed:true},{moneyNtd:180000,support:8})],{afterYears:1.5,excludes:['caregiver','teacherTrackEligible','licensedNightReception']}),
 event('business-pressure',[28,77],1,['ventureOpen'],'訂單變多，但先付出去的錢也變多。','擴張要先墊成本，回款還不能保證；你也看見現在收手的機會。',[
  {...choice('承擔借款，接下擴張','結果可能資產成長，也可能停業並留下債務。','你核對借款與回款風險後，決定承擔擴張。',{expansionTaken:true}),risk:true},
  choice('結清能處理的帳，退出經營','結束自營，不會再自動寫成店主。','你停止接新單，結清可處理的帳目並完成交接，讓這段經營在還能選擇的時候收尾。',{ventureOpen:false,selfEmployed:false,workActive:false,ventureExited:true,careerId:null,careerLabel:null},{moneyNtd:40000})],{afterYears:1.5}),
 event('debt-rebuild',[31,88],1,['repaymentActive'],'倒閉後留下的帳，怎麼面對？','停業沒有抹掉借款。你要重新談可履行的安排，或出售仍能處分的資產。',[
  choice('重新協商分期，再找能負責的工作','不會神奇免除所有債務。','你和相關人重新談可履行的分期，也開始尋找能交接清楚的工作；欠款仍記在帳上。',{repaymentShared:true,careerTransition:true},{debtNtd:-160000,energy:-8}),
  choice('處分可售資產，先縮小生活','資產與債務一起減少，不把負債改成成功。','你處分仍能出售的設備，搬到較能負擔的住處；少了累積，也換回可以面對明天的節奏。',{assetsReleased:true},{moneyNtd:-60000,debtNtd:-260000})],{afterYears:.8}),
 event('career-change',[34,73],.4,['workActive'],'熟悉的工作，還想照原來的方式做嗎？','你看見另一個方向，但轉換仍需要準備，不能把尚未完成的訓練當成新職位。',[
  choice('先完成交接，再準備轉職','原職涯停止，不直接取得下一份職稱。','你完成交接，暫停原來的工作，開始準備轉職；收入空窗也成為真實負擔。',{workActive:false,employed:false,selfEmployed:false,careerTransition:true,careerId:null,careerLabel:null},{moneyNtd:-70000}),
  choice('留下，重新談分工與工時','延續原職涯，保護可承擔的生活。','你留下調整職責與工時，讓熟練不必只等於再多接一點工作。',{careerRenewed:true,protectedRest:true},{moneyNtd:120000,energy:8})],{afterYears:4,excludes:['ventureOpen','caregiver']}),
 event('family-care',[25,78],.35,[],'家人需要一段協助，工作要怎麼安排？','家中一位長輩希望有人協助採買與往返門診；你先和當事人談意願，再盤點可輪替的人手。',[
  choice('協調資源，暫以家庭照顧為主','會離開原工作或縮減收入；不是取得專業照顧資格。','你和家人說清分工與自己的休息，暫以家務、採買及陪同為主；需要專業處置時尋求合適支援。',{caregiver:true,workActive:true,employed:false,selfEmployed:false,careerId:'household_care',careerLabel:'家庭照顧與家務協調',careerStage:2},{moneyNtd:-80000,bonds:10,energy:-9}),
  choice('保留工作，和家人分擔一部分','不默認把照顧丟給某一種性別。','你說清自己能負責的時段，和家人查詢合適支援，讓照顧不只落在同一個人身上。',{careShared:true},{moneyNtd:-30000,support:12})],{careGate:true,excludes:['ventureOpen']}),
 event('partner-meet',[22,53],.45,[],'一段關係，想不想認真往前？','你和一位已相處一段時間的人談到未來；彼此都可以選擇靠近，也可以保持朋友。',[
  choice('確認彼此意願，開始伴侶關係','先建立關係，沒有直接結婚或生小孩。','你們確認願意以伴侶身分相處，也把工作、金錢與相處界線慢慢談清楚。',{partnerCommitted:true},{bonds:14,support:6}),
  choice('坦白想法，繼續當朋友','沒有伴侶關係，也不會自動生出婚姻章節。','你坦白說出自己的想法，沒有為了趕上別人的進度承諾；彼此保有合適的距離。',{trustedPeer:true,relationshipDistant:true},{bonds:3})]),
 event('partner-future',[26,62],.65,['partnerCommitted'],'一起生活，接下來想怎麼安排？','相處一段時間後，你們討論婚姻與各自的生活，不把任何一種形式視為必須。',[
  choice('雙方同意，準備婚姻與共同生活','會增加共同支出，不附送子女。','你們確認彼此意願並完成結婚安排，談清家務、金錢與和家人往來的界線。',{married:true,relationshipClose:true},{moneyNtd:-60000,bonds:12}),
  choice('保留伴侶關係，暫不結婚','持續伴侶生活，不寫成夫妻。','你們決定保留現在的關係，先照顧實際相處，不用一場儀式替彼此回答所有問題。',{relationshipClose:true},{support:8})],{afterYears:2}),
 event('parenthood',[29,46],.55,['partnerCommitted','relationshipClose'],'你們想把下一段時間留給育兒嗎？','你們重新確認照顧、收入與雙方的意願；不打算育兒，同樣是一種完整的共同生活。',[
  choice('確認共同意願，開始照顧一名孩子','增加照顧與支出，沒有以性別分配責任。','你們在確認共同意願與照顧安排後成為一名孩子的家長，夜裡輪流起身，生活也真正改變。',{children:1,parentActive:true},{moneyNtd:-160000,energy:-12,bonds:14}),
  choice('暫不育兒，保留現在的生活','孩子數維持零，不把關係寫成遺憾。','你們決定暫不育兒，把時間留給眼前的人與計畫，也學會一起回應外界的追問。',{childfreeByChoice:true},{moneyNtd:30000,energy:6})],{afterYears:2}),
 event('friend-distance',[23,78],.4,['trustedPeer'],'很久沒回的訊息，這次要怎麼說？','朋友傳來一句「最近還好嗎」。你們的班表與生活節奏，已經和放學那時不一樣。',[
  choice('約一段確實能見面的時間','需要空出時間，不保證任何人永遠有空。','你們約在捷運站附近吃頓飯，說完近況才發現，有些話不必等到成功才敢說。',{relationshipClose:true},{bonds:15}),
  choice('說清近況，也尊重彼此的距離','關係不消失，但頻率與親密程度會改變。','你把近況說清楚，也允許彼此不再天天聯絡；這段關係換了形狀，沒有被硬留在原地。',{relationshipDistant:true},{bonds:-6})],{afterYears:2}),
 event('community-help',[17,75],.3,[],'社區有件小事，需要有人一起處理。','巷口公共空間需要整理，鄰居在群組徵求可以負責一小段時間的人。',[
  choice('接下一段能持續的分工','用時間換來支持，不等於社區領袖。','你加入輪值，和鄰居把工具、時間與交接寫清楚；巷口因此多了能相互打招呼的人。',{communityActive:true,trustedPeer:true},{support:12,energy:-4}),
  choice('這次提供一次具體協助','不承諾長期參與，仍然幫上一點忙。','你帶去可用的工具，幫忙一段確實能到場的時間，再把東西收好交回去。',{helpedOnce:true},{bonds:4})]),
 event('creative-space',[16,69],.25,[],'一件和工作無關的小作品，要不要繼續？','下班或下課後，你把照片、畫稿和幾段文字排在桌上，還沒有打算靠它賺錢。',[
  choice('每週留一小段時間繼續做','先保有創作，不直接成為職業創作者。','你替作品留一段固定時間，不急著拿觀看數證明這件事值得。',{creativePractice:true},{knowledge:8,energy:-2}),
  choice('先收好，讓生活留一點空白','不開創作後續支線，保有休息。','你把材料收好，先讓日子留一點空白；暫停沒有把已做過的東西變成白費。',{personalSpace:true},{energy:8})]),
 event('late-handover',[49,88],.45,[],'走過的經驗，想留成什麼樣子？','有人問起你怎麼撐過那段忙亂的日子；你可以談具體方法，也可以先陪對方走一段。',[
  choice('寫下可以公開的經驗','只記實際做過的事，不補發頭銜與成就。','你把做過與仍不確定的部分分開寫下，讓後來的人可以接著確認、接著修改。',{experiencePublished:true},{reputation:8}),
  choice('留一段時間，陪他一起試','不替對方決定人生，提供可承擔的支持。','你約好一段能持續的時間，陪對方實際試一次，也讓他保有不同於你的選擇。',{mentorActive:true},{bonds:10})],{requiresAny:['workActive','creativePractice','communityActive','caregiver'],afterYears:3}),
 ...TAIWAN_CAREER_CHOICES_V8
 ];
}

// Inventory for QA and handover only; this is not a player endpoint.
export function taiwanDecisionInventory(){return freeze(catalogue(taiwanProfile('00000000')).map(({id,title,careerId,isCareerDetail,minCareerStage,requiresTeacher,teacherMode,ages,requires,requiresAny,choices})=>({id,title,careerId:careerId||null,isCareerDetail:!!isCareerDetail,minCareerStage:minCareerStage||0,requiresTeacher:!!requiresTeacher,teacherMode:teacherMode||null,ages:[...ages],requires:[...requires],requiresAny:[...(requiresAny||[])],choiceCount:choices.length})));}
function restartedCareer(profile,state){return TAIWAN_CAREERS_V8.find(c=>c.id===(profile.careerOptions.find(id=>id!==state.careerTarget)||profile.careerOptions[0]));}

function initialState(profile){const family=FAMILIES.find(row=>row.id===profile.familyId);return {country:'TW',city:profile.city,careerId:null,careerLabel:null,careerStage:0,careerTarget:null,trainingTrack:null,education:'school',children:0,trainingStarted:false,practiceCompleted:false,workActive:false,employed:false,selfEmployed:false,caregiver:false,ventureOpen:false,ventureSucceeded:false,ventureFailed:false,ventureExited:false,partnerCommitted:false,married:false,trustedPeer:false,teacherTrackEligible:false,teacherStudyStarted:false,teacherDegreeCompleted:false,teacherPreEducationCompleted:false,teacherExamPassed:false,teacherInternshipPassed:false,teacherCertificateGranted:false,teacherHired:false,isTeacherWorking:false,licensedNightReception:false,moneyNtd:family.money,debtNtd:0,netWorthNtd:family.money,energy:78,knowledge:16,bonds:45,reputation:8,support:family.support,wealth:Math.min(100,Math.round(family.money/10000)),debt:0};}
function stateFinance(state){state.moneyNtd=Math.max(0,Math.round(state.moneyNtd));state.debtNtd=Math.max(0,Math.round(state.debtNtd));state.netWorthNtd=state.moneyNtd-state.debtNtd;state.wealth=Math.min(300,Math.floor(state.moneyNtd/10000));state.debt=Math.min(300,Math.floor(state.debtNtd/10000));state.netWorth=state.wealth-state.debt;}
function apply(event,answer,state,profile,identity,atMs,flagAt){const selected=event.choices[answer],flags={...selected.set},delta={...selected.delta};let text=selected.outcome,riskResult=null;
 if(event.id==='career-restart'&&answer===0){const career=restartedCareer(profile,state);Object.assign(flags,{careerTarget:career.id,trainingTrack:career.track});text+=' 這次準備的是「'+career.label+'」，仍要完成相應練習才有後續工作機會。';}
 if(['career-practice','restart-practice'].includes(event.id)&&answer===0){const career=TAIWAN_CAREERS_V8.find(row=>row.id===state.careerTarget);text+=' '+career.practice;}
 if(['career-entry','restart-entry'].includes(event.id)&&answer===0){const career=TAIWAN_CAREERS_V8.find(row=>row.id===state.careerTarget);Object.assign(flags,{careerId:career.id,careerLabel:career.label,caregiver:career.id==='household_care',careerTransition:false,teacherTrackEligible:career.id==='early_childhood_assistant',licensedNightReception:career.id==='night_reception',...(career.id==='household_care'?{employed:false,careerStage:2}:{}),...(career.id==='night_market_vendor'?{selfEmployed:true,employed:false}:{}),...(['freelance_design','creative_content'].includes(career.id)?{selfEmployed:true,employed:false}:{})});text=career.id==='household_care'?'你和需要協助的家人確認意願，開始家庭採買、陪同及家務協調，和家人約好能輪替的分工。':career.id==='night_reception'?'你再次核對臺北酒家的營業許可、排班、報酬與離席安排，在同意的範圍內開始席間陪談、點單與接待。':text;text+=' 這一段工作的身分是「'+career.label+'」。';}
 if(selected.risk){const failureChance=Math.max(.18,Math.min(.8,.52+state.debtNtd/1000000-state.support/400-(state.portfolioAccepted?.08:0))),failed=ratio(identity,'business-result')<failureChance;riskResult=failed?'setback':'success';
  if(failed){Object.assign(flags,{ventureOpen:false,selfEmployed:false,employed:false,workActive:false,ventureFailed:true,repaymentActive:true,careerId:null,careerLabel:null});Object.assign(delta,{moneyNtd:-420000,debtNtd:920000,energy:-18});text='你借款擴張後，回款沒跟上原料、人事與場地成本，最後停業。設備折價處分後仍有借款要還，經營失敗沒有因為年紀往前就被抹掉。';}
  else{Object.assign(flags,{ventureSucceeded:true,careerStage:3});Object.assign(delta,{moneyNtd:2450000,debtNtd:90000,energy:-12});text='你分批完成交付，也收回約定款項；扣除投入後，經營真的留下餘裕。你仍保留未清的設備借款，沒有把營收全寫成可花的存款。';}}
 // A qualification remains a historical achievement; a job is a current role.
 // Keep current employment flags in the same consequences record as departure,
 // so later memory selection cannot keep assigning shifts to a former worker.
 const nextWorking=Object.hasOwn(flags,'workActive')?flags.workActive:state.workActive,nextCareer=Object.hasOwn(flags,'careerId')?flags.careerId:state.careerId;
 if(!nextWorking)Object.assign(flags,{careerId:null,careerLabel:null,careerStage:0,employed:false,selfEmployed:false});
 if(!nextWorking||nextCareer!=='early_childhood_assistant')Object.assign(flags,{teacherHired:false,teacherTrackEligible:false});
 if(!nextWorking||nextCareer!=='night_reception')flags.licensedNightReception=false;
 flags.caregiver=nextWorking&&nextCareer==='household_care';
 if(flags.caregiver)Object.assign(flags,{employed:false,selfEmployed:false});
 flags.isTeacherWorking=nextWorking&&nextCareer==='early_childhood_assistant'&&(Object.hasOwn(flags,'teacherHired')?flags.teacherHired:state.teacherHired)===true;
 for(const [key,value]of Object.entries(flags)){state[key]=value;if(value!==false&&value!==null)flagAt[key]=atMs;else delete flagAt[key];}
 for(const [key,value]of Object.entries(delta)){if(key==='moneyNtd'&&state.moneyNtd+value<0){state.debtNtd+=-(state.moneyNtd+value);state.moneyNtd=0;}else state[key]=Math.max(0,['moneyNtd','debtNtd'].includes(key)?(state[key]||0)+value:Math.min(100,(state[key]||0)+value));}
 stateFinance(state);return {text,consequences:{flags,delta,tags:Object.keys(flags).filter(key=>flags[key]===true),...(riskResult?{riskResult}:{})},stateAfter:{...state}};
}
function ending(state){let id='open-road',title='沒有同一張地圖，也走過自己的生活',summary='你沒有集齊所有里程碑；留下的是實際做過的選擇，以及沒有被硬補成另一種樣子的人生。';
 if(state.ventureFailed){id='debt-rebuilding';title='店門關了，日子仍要重新站穩';summary='你真的試過經營，也真的遇到回款跟不上成本而停業。借款沒有憑空消失，接下來的生活建立在承認缺口、重新安排責任之上。';}
 else if(state.ventureSucceeded){id='venture-builder';title='把一間小生意，做到有人願意再來';summary='你先完成能被查核的工作，再走向自營與擴張。這次確實接住回款，留下超過投入的餘裕，也保有未結清的責任。';}
 else if(state.ventureExited){id='steady-exit';title='結清一段經營，留住重新選擇的路';summary='你沒有接下更大的借款，選擇完成交接並結束經營。沒有無限成長的店，也留下能重新安排的生活。';}
 else if(state.caregiver){id='family-care';title='把一天留給照顧，也替自己留一盞燈';summary='你的生活確實轉向家庭照顧、陪同與家務協調。這份投入有時間與收入代價，也有需要一起分擔的責任。';}
 else if(state.careerTransition){id='career-transition';title='離開熟悉的班表，再練習一次開始';summary='你暫停原來的職涯，承受收入空窗，沒有假裝轉職只要換一個稱呼。帶得走的，是實際完成過的練習與交接。';}
 else if(state.isTeacherWorking){id='teacher-journey';title='從課堂邊的支援者，到孩子們的老師';summary='你沒有只靠年資換一個頭銜；多年完成學位與師資職前教育、通過教師資格考試，再走完教育實習、申請取證與受聘。每一次準備，最後都落在孩子們走進教室的那個早晨。';}
 else if(state.relationshipDistant&&!state.relationshipClose){id='quiet-independent';title='各自向前，也把曾經同行好好收著';summary='你曾經靠近，也選擇坦白面對不同的節奏。沒有把每段關係留成同一種樣子，仍然記得一起走過的日子。';}
 else if(state.workActive){id='steady-work';title='把每一次交班，做成能放心的日常';summary='你先經過練習，再接下能負責的工作。留在這一世的，不只是一個職稱，還有說清楚的界線與完成的交接。';}
 else if(state.communityActive){id='community-anchor';title='巷口多了一群，願意一起想辦法的人';summary='你選擇參與能持續的共同事務，支持與關係來自實際到場，而不是一張寫好名字的英雄清單。';}
 return {id,title,quote:summary.split('。')[0]+'。',summary};
}
export function replayTaiwanLife(life,{activeMs=TAIWAN_DURATION_MS,autoFill=true}={}){
 if(life?.version!==8)fail('expected a version 8 life');
 if(!Number.isSafeInteger(activeMs)||activeMs<0||activeMs>TAIWAN_DURATION_MS||typeof autoFill!=='boolean')fail('invalid replay clock');
 const orbit=life.orbit===undefined?11:life.orbit,profile=taiwanProfile(life.seed,orbit,life.country===undefined?'TW':life.country),identity=life.seed+':orbit:'+orbit;
 if(life.answers!==undefined&&!Array.isArray(life.answers)||life.auto!==undefined&&!Array.isArray(life.auto))fail('invalid answer vectors');
 const supplied=Array.from(life.answers||[]),bits=life.auto===undefined?supplied.map(()=>0):Array.from(life.auto);if(supplied.length>MAX||bits.length!==supplied.length||supplied.some(bit=>bit!==0&&bit!==1)||bits.some(bit=>bit!==0&&bit!==1))fail('invalid answer vectors');
 const initial=initialState(profile),state={...initial},flagAt={},seen=new Set(),scenes=[],resolved=[],answers=[],auto=[];
 const plans=catalogue(profile).map(ev=>{const max=Math.min(ev.ages[1],profile.deathAge-2),base=ev.requires.length||ev.requiresAny?.length?ev.ages[0]:ev.ages[0]+ratio(identity,ev.id+':age')*(max-ev.ages[0]);return {ev,present:ratio(identity,ev.id+':present')<ev.chance,base:Math.ceil(base/profile.deathAge*TAIWAN_DURATION_MS),latest:Math.min(TAIWAN_DURATION_MS-TAIWAN_RESPONSE_MS,Math.floor(max/profile.deathAge*TAIWAN_DURATION_MS)),tie:hash(identity+ev.id)};});
 let lastResolved=0,lastId='',pending=null,nextScene=null,nextAtMs=null,consumed=0;
 for(let index=0;index<Math.min(MAX,profile.eventLimit);index++){
  const detailCount=[...seen].filter(id=>id.startsWith('tw-')).length,detailCap=integer(identity,'detail-cap',1,2);
  const detailEligible=ev=>!ev.isCareerDetail||(
   state.workActive&&ev.careerId===state.careerId&&state.careerStage>=ev.minCareerStage&&detailCount<detailCap&&(!state.ventureOpen||state.ventureSucceeded)&&
   (!ev.requiresTeacher||state.isTeacherWorking)&&
   (ev.teacherMode!=='support'||(!state.teacherHired&&(state.teacherStudyDeclined||state.teacherStudyPaused||state.teacherCertificationDeferred)))
  );
  const ready=plans.filter(({ev,present})=>present&&!seen.has(ev.id)&&ev.requires.every(key=>state[key]===true)&&(!ev.requiresAny||ev.requiresAny.some(key=>state[key]===true))&&!(ev.excludes||[]).some(key=>state[key]===true)&&(!ev.careGate||profile.careOpportunity)&&detailEligible(ev)).map(plan=>{
   const {ev}=plan,anyTimes=(ev.requiresAny||[]).filter(key=>state[key]===true).map(key=>flagAt[key]||0),dep=Math.max(0,...ev.requires.map(key=>flagAt[key]||0),anyTimes.length?Math.min(...anyTimes):0),lag=ev.requires.length||ev.requiresAny?.length?(ev.afterYears||.5)+ratio(identity,ev.id+':lag')*3.8:0;
   let minAge=ev.ages[0];if(ev.minAgeByOptions)minAge=Math.max(...profile.careerOptions.map(id=>TAIWAN_CAREERS_V8.find(c=>c.id===id).minAge));
   const at=Math.max(plan.base,Math.ceil(minAge/profile.deathAge*TAIWAN_DURATION_MS),dep+Math.ceil(lag/profile.deathAge*TAIWAN_DURATION_MS),lastResolved+(lastId?integer(identity,'gap:'+lastId,80000,250000):0));
   return {...plan,at};}).filter(plan=>plan.at<=plan.latest).sort((a,b)=>a.at-b.at||a.tie-b.tie);
  if(!ready.length)break;const plan=ready[0],ev=plan.ev,deadline=plan.at+TAIWAN_RESPONSE_MS;
  const current={id:ev.id,scenarioId:'v8-tw-'+ev.id,family:ev.family,index,title:ev.title,text:ev.text,choices:ev.choices.map(c=>[c.label,c.reason,c.outcome]),openedMs:plan.at,deadlineMs:deadline,age:Math.floor(plan.at/TAIWAN_DURATION_MS*profile.deathAge)};
  if(ev.id==='career-restart'){const next=restartedCareer(profile,state);current.text+=' 這次可詢問的方向是「'+next.label+'」。';current.choices[0][0]='重新準備'+next.label;}
  scenes.push(current);
  if(plan.at>activeMs){nextScene=current;nextAtMs=plan.at;break;}seen.add(ev.id);const submitted=index<supplied.length,timeout=integer(identity,'timeout:'+ev.id,0,1);
  if(submitted){if(bits[index]&&(activeMs<deadline||supplied[index]!==timeout))fail('invalid automatic answer');consumed++;}
  if(activeMs<deadline){if(submitted){answers.push(supplied[index]);auto.push(bits[index]);}pending={...current,answered:submitted,...(submitted?{chosenAnswer:supplied[index]}:{}),remainingMs:deadline-activeMs,available:!submitted};nextScene=current;nextAtMs=submitted?deadline:current.openedMs;break;}
  if(!submitted&&!autoFill){pending={...current,answered:false,remainingMs:0,available:false,missingAnswer:true};nextScene=current;nextAtMs=deadline;break;}
  const answer=submitted?supplied[index]:timeout,source=submitted?(bits[index]?'auto':'manual'):'auto',result=apply(ev,answer,state,profile,identity,deadline,flagAt);answers.push(answer);auto.push(source==='auto'?1:0);resolved.push({id:ev.id,eventId:ev.id,index,family:ev.family,age:Math.floor(deadline/TAIWAN_DURATION_MS*profile.deathAge),atMs:deadline,deadlineMs:deadline,answer,source,text:result.text,outcome:result.text,consequences:result.consequences,stateAfter:result.stateAfter});lastResolved=deadline;lastId=ev.id;
 }
 if(consumed!==supplied.length)fail('answer vector includes an unavailable or future event');const endingFocus=ending(state),tags=[...new Set(resolved.flatMap(row=>row.consequences.tags))];
 return {version:8,profile,answers,auto,scenes,resolved,pending,nextScene,nextAtMs,state:{...state},initialState:initial,terminalOutcome:endingFocus.id,endingFocus,tags,completed:activeMs===TAIWAN_DURATION_MS&&!pending&&!nextScene,activeMs};
}
