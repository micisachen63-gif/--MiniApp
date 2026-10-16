import {hash} from './world.js';
import {getCountryPack} from './country-runtime-v9.js';
export const COUNTRY_RECIPE_V9='v9-local-life-1';
const DURATION=7200000,RESPONSE=90000,MAX=9;
const ratio=(seed,key)=>{let x=hash(COUNTRY_RECIPE_V9+':'+seed+':'+key);x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return ((x^(x>>>16))>>>0)/4294967296;};
const integer=(seed,key,min,max)=>min+Math.floor(ratio(seed,key)*(max-min+1));
const error=message=>{throw Error('v9 local life: '+message);};
const option=(label,reason,outcome,flags={},delta={})=>({label,reason,outcome,flags,delta});
const event=(id,ages,chance,requires,title,text,choices,extra={})=>({id,ages,chance,requires,title,text,choices,family:id,...extra});
export function countryProfile(seed,orbit=11,country){
 if(typeof seed!=='string'||!/^[a-f0-9]{8}$/.test(seed)||!Number.isInteger(orbit)||orbit<0||orbit>11)error('invalid identity');
 const pack=getCountryPack(country),key=country+':'+seed+':'+orbit,family=pack.families[integer(key,'family',0,3)],gender=ratio(key,'gender')<.5?'f':'m';
 const first=integer(key,'career-first',0,11),second=(first+1+integer(key,'career-second',0,10))%12,arc=['career','family','business','community'][integer(key,'arc',0,3)];
 return {country,countryName:pack.name,city:pack.cityId,cityName:pack.cityName,scope:pack.scope,currency:pack.currency,gender,genderLabel:gender==='f'?'女性':'男性',familyId:family.id,familyLabel:family.label,familyText:family.text,startingMoney:family.money,identityLabel:pack.cityName+'・'+(gender==='f'?'都市之女':'都市之子'),deathAge:integer(key,'death',59,103),arc,eventLimit:integer(key,'limit',arc==='business'?8:6,9),careerOptions:[pack.careers[first].id,pack.careers[second].id],careOpportunity:ratio(key,'care-opportunity')<.45};
}
const initialState=p=>({money:p.startingMoney,debt:0,netWorth:p.startingMoney,currency:p.currency,energy:72,knowledge:30,bonds:48,reputation:28,support:45,education:'not-selected',children:0,married:false,partnerCommitted:false,workActive:false,careerId:null,careerLabel:null,careerStage:0,trainingStarted:false,practiceCompleted:false,caregiver:false,ventureOpen:false,ventureFailed:false,ventureSucceeded:false,careerTransition:false});
function catalogue(profile){
 const pack=getCountryPack(profile.country),careers=profile.careerOptions.map(id=>pack.careers.find(c=>c.id===id)),education=pack.education;
 // Unit is a fictional story-budget scale, never a national salary statistic.
 const budgets=pack.families.map(f=>f.money).sort((a,b)=>a-b),unit=Math.max(10,Math.round(budgets[1]/5));
 const businessArc=profile.arc==='business';
 const rows=[
 event('school-friend',[7,15],.65,[],'放學以後，你想把時間留在哪裡？','一段同學間的相處，和一件想自己完成的小事，剛好排在同一個下午。',[
  option('和同學一起完成約好的事','花一些時間陪伴，關係從真正到場開始。','你和同學把分工說清楚，事情沒有全照計畫完成，卻開始知道怎樣向彼此求助。',{friendshipStarted:true},{bonds:12}),
  option('先完成自己想試的小作品','保留獨處的時間，也把下次再見說清楚。','你沒有勉強自己加入，把小作品慢慢做完，也向同學說清楚這次不能一起去。',{independentInterest:true},{knowledge:9})]),
 event('study-plan',[15,24],businessArc?.25:.8,[],'下一段求學，想怎麼和生活放在一起？',education.description,[
  option(education.startLabel,'先問清課程，再為學費和上課時間留出位置。',education.startOutcome,{studyStarted:true,education:'studying'},{money:-unit,knowledge:8}),
  option('先安頓眼前的生活，再回來看課程','先顧眼前的生活，把想學的方向留在筆記裡。',education.pauseOutcome,{studyPaused:true,education:'paused'},{energy:6})]),
 event('study-practice',[19,45],1,['studyStarted'],'課程比想像中難，這一段還繼續嗎？','課業、生活費和交通開始擠在一起；你可以把卡住的地方拿去討論，也可以先暫停。',[
  option('把問題說清楚，調整進度繼續','完成眼前練習，不跳過後續考核。','你帶著做不下去的作業找人討論，調整進度後，終於完成了卡住很久的實作。',{studyPractice:true},{knowledge:12,money:-unit}),
  option('先暫停，保留已完成的紀錄','停止這次修課，生活仍有其他路。','你收好做過的作業與課程紀錄，暫時把書本放回架上，先處理生活裡更急的事。',{studyStarted:false,studyPaused:true,education:'paused'},{energy:9})],{afterYears:1}),
 event('study-complete',[21,60],1,['studyPractice'],'最後一段課程，你要怎麼收尾？','前面做過的練習都留有紀錄，現在需要把尚未完成的部分和正式程序分清楚。',[
  option(education.completeLabel,'依這一條課程路徑完成，不延伸成其他職業執照。',education.completeOutcome,{education:'course-completed',studyCompleted:true},{knowledge:18,money:-unit}),
  option('先保留進度，暫不完成這一階段','先把進度收好，等能專心時再回來。','你把已完成與尚未完成的項目分開記下，先回到能承擔的日常。',{education:'paused',studyPaused:true},{energy:8})],{afterYears:2}),
 event('career-training',[18,31],1,[],'下一段生活，先靠近哪一種工作？','你核對工作內容、當地入門方式與可負擔的交通，把兩個真正想試的方向放在面前。',careers.map(c=>option('先準備'+c.label,'先完成能被檢查的練習，再接下能負責的工作。','你開始接觸'+c.label+'，問清要做哪些練習，也第一次認真想像自己站在那個位置的樣子。',{trainingStarted:true,careerTarget:c.id},{money:-unit,knowledge:5})),{minAgeByOptions:true}),
 event('career-practice',[20,49],1,['trainingStarted'],'第一次練習卡住了，要不要再試？','做過才知道，這段工作和想像不完全一樣。你需要決定是否接受具體回饋繼續練習。',[
  option('請人檢查，完成這一段實作','完成入門練習，仍需核對正式工作條件。','你把不懂的部分說清楚，接受可以檢查的回饋，完成這一段練習。',{practiceCompleted:true},{knowledge:10,money:-unit}),
  option('停下這條路，先照顧眼前生活','把已做過的練習收好，這次先停在這裡。','你承認目前不適合繼續投入，保存做到哪裡的紀錄，先把時間和支出安頓。',{trainingStarted:false,trainingPaused:true,education:'paused'},{energy:10})],{afterYears:1}),
 event('career-entry',[21,58],1,['practiceCompleted'],'第一個能負責的工作機會來了。','有人願意讓你在明確分工和交接範圍內開始，也願意把報酬、時段和求助方式說清楚。',[
  option('核對條件，接受這次工作','只接下已完成準備且有權負責的部分。','你確認分工後接下工作，把不確定的部分交給能負責的人。',{workActive:true,employed:true,careerStage:1},{money:unit*3,reputation:6}),
  option('這次先不接，保留重新選擇的時間','沒有上工就不會有這條職涯的工作章。','你拒絕目前不適合的條件，把原因記下，沒有把尚未到職寫成一份工作。',{jobDeclined:true},{energy:5})],{afterYears:.7}),
 event('career-restart',[25,69],1,[],'一條路停下以後，想不想換個方向？','先前卡住的原因已經比較清楚；另一種工作願意讓你先做一段能被檢查的小任務。',[
  option('重新準備另一條路','仍需完成練習與入門條件。','你重新查詢能負擔的方式，決定試另一段入門練習。',{restartTraining:true},{money:-unit,knowledge:7}),
  option('先把生活重心留在工作以外','日常不只由一份職業決定。','你沒有急著替自己填上一個職稱，開始安排能長久參與的小事。',{nonWorkPlan:true},{energy:8,bonds:6})],{requiresAny:['trainingPaused','jobDeclined','jobLeft'],excludes:['workActive','restartTraining','restartDeclined'],afterYears:2}),
 event('restart-practice',[27,78],1,['restartTraining'],'新的練習，這次想怎樣完成？','新的方向需要重新熟悉，你可以請人檢查實作，也可以先停在自己能承擔的位置。',[
  option('完成檢查，再尋找工作','換方向不等於跳過入門要求。','你接受回饋、完成實作，再把下一段能負責的工作條件問清楚。',{restartPractice:true},{money:-unit,knowledge:9}),
  option('先退出這次安排','保留已做過的練習，不自動開始工作。','你停下這次練習，把眼前生活重新排好，也留下以後能回頭看的紀錄。',{restartTraining:false,restartDeclined:true,nonWorkPlan:true},{energy:9})],{afterYears:1}),
 event('restart-entry',[29,84],1,['restartPractice'],'另一個工作機會，你準備接下嗎？','這次的工作內容和第一次不同。你已完成準備，仍要把能負責的範圍說清楚。',[
  option('接受新工作，從明確分工開始','換一張班表，也重新認識一起做事的人。','你接受新的安排，從能檢查與交接的部分開始，沒有假裝過去的空窗不存在。',{workActive:true,employed:true,careerStage:1,restartedWork:true},{money:unit*3}),
  option('先不接受，保留其他生活安排','把空下來的時間留給眼前更在意的事。','你決定先不接下，把理由說清楚，繼續眼前能承擔的生活。',{restartDeclined:true,nonWorkPlan:true},{energy:8})],{afterYears:.8}),
 event('work-delivery',[23,65],1,['workActive'],'這次交接出了差錯，要怎麼回應？','有人正在等你把落差說清楚；提早交代和先停下承諾，都有各自的代價。',[
  option('說清問題，完成可查核的修正','承擔補做時間，留下真正完成的交付。','你把錯誤和修正方式說清楚，再讓對方實際核對；信任從這次交付慢慢恢復。',{portfolioAccepted:true,careerStage:2},{money:unit*4,reputation:15,energy:-6}),
  option('先停下這次承諾，完成必要退回','少一些收入，也保住能承擔的範圍。','你停止這次超出能力的承諾，完成能處理的退回與交接，重新確認接案範圍。',{projectDeferred:true,careerStage:2},{money:-unit,reputation:3})],{afterYears:1.2,excludeCare:true}),
 event('work-renewal',[28,69],.75,['workActive'],'熟悉的工作，還想照同樣的節奏走嗎？','能力慢慢增加，別人也開始把更多事交過來；你想調整分工，或離開這段工作。',[
  option('留任，重新談清分工與休息','熟練不等於無限制增加工作。','你把能承擔的事和休息時間一起談清楚，留下來調整工作方式。',{careerRenewed:true,careerStage:3},{money:unit*5,energy:5}),
  option('完成交接，離開這份工作','交回熟悉的工作，也要承受一段收入空窗。','你交回需要交接的事，承受收入空窗，也替新的生活留出位置。',{workActive:false,jobLeft:true,careerTransition:true},{money:-unit*2,energy:13})],{afterYears:2,excludeCare:true}),
 event('care-rearrange',[28,80],1,['workActive','caregiver'],'家中的照顧分工，該怎麼重新安排？','原本說好的分工已走過一段時間，你發現有些責任可以輪替，也有一些事情需要重新談清楚。',[
  option('安排輪替，留下自己能持續承擔的一段','照顧仍在生活裡，也開始有休息的位置。','你和家人重新確認意願與輪替，留下能持續承擔的部分，也替自己排回休息與外出的時間。',{careerStage:3,careArrangementRenewed:true},{money:-unit,energy:12,bonds:10}),
  option('完成交接，把主要照顧交給其他安排','這段家務重心會收尾，後續不再寫成你仍負責。','你和相關的人談妥交接，把主要照顧轉交給能接續的安排，重新尋找自己的日常節奏。',{workActive:false,caregiver:false,jobLeft:true,nonWorkPlan:true},{energy:15})],{afterYears:2}),
 event('business-start',[27,67],businessArc?1:.7,['workActive','portfolioAccepted'],'有人問，願不願意自己承接一小段？','已有交付經驗，不代表自己經營一定更穩；資金、場所、合規與退出安排都要先確認。',[
  option('確認規則與成本，小規模開始','拿出積蓄開始，接下收入與虧損的可能。','你核對當地適用規則、分工和可用場地，把成本及退出方式寫清楚，先從小量開始。',{ventureOpen:true,selfEmployed:true,employed:false,careerStage:3},{money:-unit*4}),
  option('先留在原團隊，把已有工作做穩','保留工作，不承擔這次經營風險。','你沒有因別人催促就接下經營，先把現有分工和生活安頓好。',{steadyTeam:true},{money:unit*6,support:7})],{afterYears:2,excludeCare:true}),
 event('business-pressure',[31,80],1,['ventureOpen'],'工作量增加，先付出去的成本也增加。','擴張需要墊付，回款仍有風險；你也可以在目前還能選擇時退出。',[
  {...option('確認風險，承擔借款擴張','可能留下大筆餘裕，也可能停業還債。','你核對借款與回款風險後，決定承擔擴張。',{expansionTaken:true}),risk:true},
  option('停止接新單，結清能處理的帳','結束自營，不再自動寫成經營者。','你完成可處理的交接並退出經營，沒有把收尾假裝成另一場勝利。',{ventureOpen:false,workActive:false,ventureExited:true},{money:unit*2})],{afterYears:2}),
 event('close-relationship',[20,55],businessArc?.3:.75,[],'有個人願意靠近，你想怎麼回應？','你們開始分享日常，也發現作息和期待不同；這次可以把關係說清楚。',[
  option('確認彼此的意願，試著一起生活','把曖昧說清楚，也聽聽對方真正的想法。','你們談到各自的期待，也說出不容易開口的擔心，最後決定認真走近彼此的生活。',{partnerCommitted:true},{bonds:18}),
  option('坦白保留距離，維持各自的步調','坦白比勉強靠近更難，卻也少留一點誤會。','你把不適合的地方說清楚，沒有用模糊承諾拖住對方，兩人各自向前。',{relationshipDistant:true},{energy:5})]),
 event('shared-home',[25,67],.8,['partnerCommitted'],'共同生活的下一段，你們怎麼安排？','兩人已確認彼此的意願，現在需要討論法律程序、費用與日常分工。',[
  option('依當地可適用的程序，確認婚姻與分工','只寫你們實際同意並完成的這段安排。','你們確認當地適用條件並完成這段婚姻安排，也把家務與需要協助的事說清楚。',{married:true},{money:-unit*2,bonds:10}),
  option('先不進入婚姻，保持目前的相處','伴侶關係不等於已婚。','你們暫不進入婚姻，確認仍願意如何陪伴，沒有把不同的選擇當作背叛。',{marriageDeferred:true},{energy:5})],{afterYears:2}),
 event('child-plan',[28,54],.7,['married'],'談到育兒，你們想把時間怎麼安排？','一次關於孩子的談話延續到深夜。你們開始算支出、排時間，也問彼此是否真的願意承擔。',[
  option('確認意願與照顧安排，迎接孩子','生活會增加真實的時間與支出責任。','你們確認願意承擔育兒，也找到可以求助的支持；一名孩子來到生活裡，分工從此需要反覆調整。',{children:1,parenthood:true},{money:-unit*3,energy:-12,bonds:12}),
  option('這一段暫不育兒','不由這次選擇判斷人生價值。','你們決定這一段先不育兒，把時間留給目前能承擔的生活與彼此。',{childfreeByChoice:true},{energy:8,money:unit})],{afterYears:2}),
 event('second-child',[32,56],.35,['parenthood'],'生活還能再多接住一名孩子嗎？','已有的照顧分工運作了一段時間，現在需要重新確認意願與能承擔的安排。',[
  option('重新分工，迎接另一名孩子','增加照顧責任，不保證關係因此更順利。','你們確認新的照顧意願並重新安排支持，第二名孩子來到這段人生，日常的時間更需要一起分擔。',{children:2},{money:-unit*4,energy:-10,bonds:8}),
  option('維持現在的家庭安排','把已有照顧責任先做穩。','你們決定維持現在的照顧安排，把能提供的時間和支持留給眼前的生活。',{familyPlanSettled:true},{energy:5})],{afterYears:3}),
 event('family-care',[35,78],.7,[],'家人需要陪同，原本的生活怎麼調整？','家人最近需要有人陪同外出，幾通電話打亂了原本的班表。你得決定，這段時間要怎樣分配。',[
  option('暫停原工作，轉向家庭照顧','收入與作息會改變，原工作章就此停止。','你和家人確認意願後暫停原工作，開始承擔陪同與家務協調，也把可以輪替的支持找出來。',{workActive:false,caregiver:true,familyCareStarted:true},{money:-unit*4,energy:-8,bonds:14}),
  option('保留原安排，協調能輪替的協助','不把所有照顧責任默認給一個人。','你沒有一個人接下全部事情，而是和相關的人協調輪替、聯繫與能負擔的協助。',{careSupportArranged:true},{money:-unit*2,support:12})],{careGate:true}),
 event('community-start',[28,80],businessArc?.2:.6,[],'社區裡有一件小事，願不願意一起做？','一個可以長期參與的共同活動正在找幫手，也有人願意把清楚的分工交給新來的人。',[
  option('先接一小段，持續到場','關係來自實際參與，不先替別人承諾。','你確認能投入的時間，接下一小段工作並持續到場，慢慢認得常在附近出現的人。',{communityActive:true},{bonds:12,reputation:8}),
  option('這次不接，替自己保留休息','不參加並不等於孤獨或失敗。','你說清楚這次無法承擔的原因，把休息時間保留下來，也感謝願意邀請你的人。',{communityDeclined:true},{energy:12})]),
 event('care-community',[43,88],1,[],'新的生活重心，想留下什麼？','當工作不再填滿整張月曆，你仍有能分配的時間，也有一件願意慢慢整理的小事。',[
  option('參與附近可以持續的小活動','把陪伴放在實際能到場的時間裡。','你選擇可以持續參與的小活動，不急著成為誰眼中的重要人物，先把說好的時間留下來。',{communityActive:true},{bonds:13}),
  option('整理自己的記錄，留一份能重讀的筆記','保留私人回憶，不公開別人的資料。','你把自己的經歷和可分享的部分分開，留下一份以後能重讀、也不越過別人界線的筆記。',{memoryKeeper:true},{knowledge:12})],{requiresAny:['nonWorkPlan','caregiver','jobLeft'],afterYears:2}),
 event('repayment',[40,92],1,['repaymentActive'],'留下的借款，這一段想怎麼整理？','當年的經營已結束，未清的責任仍在；重新安排不會讓欠款自動消失。',[
  option('把能負擔的部分排成計畫','先確認可動用的錢，不用新的風險蓋住舊帳。','你列清現有責任，把能負擔的償還逐步完成，也保留基本生活的安排。',{repaymentPlan:true},{energy:4}),
  option('先尋求合適協助，重新核對安排','求助不是自動免除債務。','你帶著真實帳目尋求合適協助，把已知與未知分開，沒有假裝借款已經不存在。',{repaymentHelp:true},{support:10})],{afterYears:2}),
 event('late-mentoring',[57,94],.7,[],'有人想聽你的經驗，你願意留下哪一段？','對方不是要一份完美的人生答案，只想知道你當年遇到困難時做過什麼。',[
  option('把做過與沒做到的都說清楚','不把自己的路當作每個人的標準答案。','你把做過的選擇和仍有遺憾的地方一起說明，對方終於能接著問更具體的問題。',{mentoring:true},{reputation:12,bonds:8}),
  option('先整理筆記，保留不方便說的部分','分享經驗也能保有自己的界線。','你留下一份有脈絡的筆記，說清哪些是親身做過、哪些仍不確定，沒有替別人的人生作結。',{memoryKeeper:true},{knowledge:9})]),
 ];
 for(const c of pack.careers)for(const d of c.dilemmas)rows.push(event('job-'+d.id,[23,83],.85,['workActive'],d.title,d.text,d.choices.map(o=>option(o.label,o.reason,o.outcome,o.exit?{workActive:false,jobLeft:true,careerTransition:true}:{careerStage:Math.max(2,d.minStage)},o.delta||{})),{careerId:c.id,minCareerStage:d.minStage,isCareerDetail:true,afterYears:1.1}));
 return {rows,unit};
}
function apply(ev,answer,state,profile,identity,atMs,flagAt,unit){
 const pack=getCountryPack(profile.country),selected=ev.choices[answer],flags={...selected.flags},delta={...selected.delta};let text=selected.outcome;
 const currentCareer=pack.careers.find(c=>c.id===state.careerTarget);
 if(ev.id==='career-practice'&&answer===0)text+=' '+currentCareer.practice;
 if(ev.id==='career-entry'&&answer===0){const care=currentCareer.id==='household-care';Object.assign(flags,{careerId:currentCareer.id,careerLabel:currentCareer.label,caregiver:care,employed:!care});if(care){delta.money=-unit;text='你和家人確認意願、可以承擔的時段與輪替安排，開始接下這一段家務協調。';}text+=' '+currentCareer.entry;}
 if(ev.id==='career-restart'&&answer===0){const next=pack.careers.find(c=>c.id!==state.careerTarget&&c.id===profile.careerOptions.find(id=>id!==state.careerTarget))||pack.careers.find(c=>c.id!==state.careerTarget);flags.restartTarget=next.id;text+=' 這次重新準備的是「'+next.label+'」。';}
 if(ev.id==='restart-practice'&&answer===0)text+=' '+pack.careers.find(c=>c.id===state.restartTarget).practice;
 if(ev.id==='restart-entry'&&answer===0){const next=pack.careers.find(c=>c.id===state.restartTarget),care=next.id==='household-care';Object.assign(flags,{careerId:next.id,careerLabel:next.label,careerTransition:false,caregiver:care,employed:!care});if(care){delta.money=-unit;text='你和家人重新談妥能承擔的分工，從一段有輪替安排的家務協調開始。';}text+=' '+next.entry;}
 if(selected.risk){const failed=ratio(identity,ev.id+':risk')<.5;if(failed){Object.assign(flags,{ventureOpen:false,ventureFailed:true,workActive:false,repaymentActive:true});Object.assign(delta,{money:-unit*18,debt:unit*42,energy:-18});text='你承擔擴張後，回款沒有跟上成本，最後停止經營。能處分的設備已交接，留下的借款仍需要慢慢整理；時間往前走，沒有把失敗與責任一起抹掉。';}else{Object.assign(flags,{ventureSucceeded:true,careerStage:3});Object.assign(delta,{money:unit*110,debt:unit*4,energy:-12});text='你完成分批交付，也收回約定款項。扣除投入後，這段經營真的留下明顯餘裕；仍未結清的設備借款，也另外留在帳上。';}}
 if(Object.hasOwn(flags,'workActive')&&!flags.workActive)Object.assign(flags,{careerId:null,careerLabel:null,careerStage:0,employed:false,selfEmployed:false,ventureOpen:false,...(flags.caregiver!==true?{caregiver:false}:{})});
 if(flags.caregiver)Object.assign(flags,{employed:false,selfEmployed:false});
 for(const [key,value]of Object.entries(flags)){state[key]=value;if(value!==false&&value!==null)flagAt[key]=atMs;else delete flagAt[key];}
 for(const [key,amount]of Object.entries(delta)){if(key==='money'&&state.money+amount<0){state.debt+=-(state.money+amount);state.money=0;}else if(key==='debt'||key==='money')state[key]=Math.max(0,(state[key]||0)+amount);else state[key]=Math.max(0,Math.min(100,(state[key]||0)+amount));}
 if(ev.id==='repayment'&&answer===0){const paid=Math.min(state.money,Math.round(state.debt*.3));state.money-=paid;state.debt-=paid;}
 state.netWorth=state.money-state.debt;return {text,stateAfter:{...state},consequences:{flags,delta,tags:Object.keys(flags).filter(k=>flags[k]===true)}};
}
function ending(s){
 if(s.ventureFailed)return {id:'debt-rebuilding',title:'生意收了，生活仍要重新站穩',summary:'你實際承擔過經營風險，也遇到回款追不上成本而收尾。留下的借款仍在，之後的生活要從承認缺口、重新分配責任開始。'};
 if(s.ventureSucceeded)return {id:'venture-builder',title:'從一小段工作，走到能自己承擔的生意',summary:'從準備、交付到承擔擴張，你確實把一段經營做出餘裕；留下的不只有收入，也有尚未結清、需要繼續負責的事。'};
 if(s.ventureExited)return {id:'steady-exit',title:'結清一段經營，保留重新開始的路',summary:'你在還能選擇時完成交接，沒有繼續擴張；工作停了下來，已做過的選擇與能帶走的經驗仍在。'};
 if(s.caregiver)return {id:'family-care',title:'把時間留給照顧，也留一點給自己',summary:'你確實重新安排了生活，把陪同和家務放進日常；照顧帶來關係，也帶來需要有人一起分擔的責任。'};
 if(s.careerTransition)return {id:'career-transition',title:'走出熟悉的班表，再練習一次開始',summary:'你離開實際做過的工作，承受收入與節奏改變，沒有把換方向寫成毫無代價的一句話。'};
 if(s.children>0)return {id:'family-days',title:'生活多了幾雙手，也多了需要分配的時間',summary:'你曾明確選擇靠近伴侶與承擔育兒，日常不是從此圓滿，而是開始需要反覆談分工、支持與自己的位置。'};
 if(s.workActive)return {id:'steady-work',title:'把一份工作，做成有人能放心的日常',summary:'你走過準備與練習，再接下能負責的工作。這一世留下的不只是職稱，也有交接、界線和那些真正完成的事。'};
 if(s.communityActive)return {id:'community-anchor',title:'有些熟悉，是一次一次到場留下的',summary:'你在工作以外找到能持續參與的事，關係不是憑空增加，而是來自答應後真正到場的日子。'};
 return {id:'open-road',title:'沒有走完所有路，也確實生活過',summary:'這一世沒有替你集齊固定的里程碑；留下的是實際選擇過的路、停下來的原因，以及仍值得記住的平常日子。'};
}
export function replayCountryLife(life,{activeMs=DURATION,autoFill=true}={}){
 if(life?.version!==9||!Number.isSafeInteger(activeMs)||activeMs<0||activeMs>DURATION||typeof autoFill!=='boolean')error('invalid life or clock');
 const orbit=life.orbit??11,profile=countryProfile(life.seed,orbit,life.country),identity=life.country+':'+life.seed+':'+orbit,pack=getCountryPack(life.country),{rows,unit}=catalogue(profile);
 const supplied=life.answers===undefined?[]:life.answers,bits=life.auto===undefined?supplied.map(()=>0):life.auto;
 if(!Array.isArray(supplied)||!Array.isArray(bits)||supplied.length>MAX||supplied.length!==bits.length||[...supplied,...bits].some(n=>n!==0&&n!==1))error('invalid answers');
 const initial=initialState(profile),state={...initial},flagAt={},seen=new Set(),scenes=[],resolved=[],answers=[],auto=[];
 const plans=rows.map(ev=>{const max=Math.min(ev.ages[1],profile.deathAge-2),base=ev.requires.length||ev.requiresAny?.length?ev.ages[0]:ev.ages[0]+ratio(identity,ev.id+':age')*(max-ev.ages[0]);return {ev,present:ratio(identity,ev.id+':present')<ev.chance,base:Math.ceil(base/profile.deathAge*DURATION),latest:Math.min(DURATION-RESPONSE,Math.floor(max/profile.deathAge*DURATION)),tie:hash(identity+ev.id)};});
 let lastResolved=0,lastId='',consumed=0,pending=null,nextScene=null,nextAtMs=null;
 for(let index=0;index<profile.eventLimit;index++){
  const details=[...seen].filter(id=>id.startsWith('job-')).length,detailCap=profile.arc==='business'?1:2,detailCandidates=pack.careers.find(c=>c.id===state.careerId)?.dilemmas.map(d=>'job-'+d.id).sort((a,b)=>ratio(identity,'detail-order:'+a)-ratio(identity,'detail-order:'+b)).slice(0,detailCap)||[];
  const ready=plans.filter(({ev,present})=>present&&!seen.has(ev.id)&&ev.requires.every(k=>state[k]===true)&&(!ev.requiresAny||ev.requiresAny.some(k=>state[k]===true))&&!(ev.excludes||[]).some(k=>state[k]===true)&&(!ev.careGate||profile.careOpportunity)&&(!ev.excludeCare||!state.caregiver)&&(!ev.isCareerDetail||detailCandidates.includes(ev.id)&&state.workActive&&state.careerId===ev.careerId&&state.careerStage>=ev.minCareerStage&&details<detailCap&&(!state.ventureOpen||state.ventureSucceeded))).map(plan=>{
   const {ev}=plan,anyTimes=(ev.requiresAny||[]).filter(k=>state[k]===true).map(k=>flagAt[k]||0),dep=Math.max(0,...ev.requires.map(k=>flagAt[k]||0),anyTimes.length?Math.min(...anyTimes):0),lag=ev.requires.length||ev.requiresAny?.length?(ev.afterYears||.6)+ratio(identity,ev.id+':lag')*3.8:0;
   const minAge=ev.minAgeByOptions?Math.max(...profile.careerOptions.map(id=>pack.careers.find(c=>c.id===id).minAge)):ev.ages[0];
   const at=Math.max(plan.base,Math.ceil(minAge/profile.deathAge*DURATION),dep+Math.ceil(lag/profile.deathAge*DURATION),lastResolved+(lastId?integer(identity,'gap:'+lastId,80000,250000):0));return {...plan,at};
  }).filter(p=>p.at<=p.latest).sort((a,b)=>a.at-b.at||a.tie-b.tie);
  if(!ready.length)break;const plan=ready[0],ev=plan.ev,deadline=plan.at+RESPONSE,current={id:ev.id,scenarioId:'v9-'+profile.country.toLowerCase()+'-'+ev.id,family:ev.family,index,title:ev.title,text:ev.text,choices:ev.choices.map(o=>[o.label,o.reason,o.outcome]),openedMs:plan.at,deadlineMs:deadline,age:Math.floor(plan.at/DURATION*profile.deathAge)};
  if(['career-entry','restart-entry'].includes(ev.id)&&(ev.id==='career-entry'?state.careerTarget:state.restartTarget)==='household-care'){current.title='家中的日常協調，你願意接下這一段嗎？';current.text='你和家人把需要協助的事、彼此意願與輪替方式放在一起談，確認能投入多少時間和用品。';current.choices[0]=['確認意願，接下這一段分工','會投入時間與用品，這是未受雇的家庭分工。','你和家人談妥意願與輪替安排，接下這一段家務協調。'];}
  scenes.push(current);if(plan.at>activeMs){nextScene=current;nextAtMs=plan.at;break;}seen.add(ev.id);
  const submitted=index<supplied.length,timeout=integer(identity,'timeout:'+ev.id,0,1);if(submitted){if(bits[index]&&(activeMs<deadline||supplied[index]!==timeout))error('invalid automatic answer');consumed++;}
  if(activeMs<deadline){if(submitted){answers.push(supplied[index]);auto.push(bits[index]);}pending={...current,answered:submitted,...(submitted?{chosenAnswer:supplied[index]}:{}),remainingMs:deadline-activeMs,available:!submitted};nextScene=current;nextAtMs=submitted?deadline:current.openedMs;break;}
  if(!submitted&&!autoFill){pending={...current,answered:false,remainingMs:0,available:false,missingAnswer:true};nextScene=current;nextAtMs=deadline;break;}
  const answer=submitted?supplied[index]:timeout,source=submitted?(bits[index]?'auto':'manual'):'auto',result=apply(ev,answer,state,profile,identity,deadline,flagAt,unit);answers.push(answer);auto.push(source==='auto'?1:0);resolved.push({id:ev.id,index,family:ev.family,age:Math.floor(deadline/DURATION*profile.deathAge),atMs:deadline,deadlineMs:deadline,answer,source,outcome:result.text,text:result.text,consequences:result.consequences,stateAfter:result.stateAfter});lastResolved=deadline;lastId=ev.id;
 }
 if(consumed!==supplied.length)error('unavailable future answers');const endingFocus=ending(state);endingFocus.quote=endingFocus.summary.split('。')[0]+'。';
 return {version:9,profile,answers,auto,scenes,resolved,pending,nextScene,nextAtMs,state:{...state},initialState:initial,endingFocus,terminalOutcome:endingFocus.id,tags:[...new Set(resolved.flatMap(r=>r.consequences.tags))],completed:activeMs===DURATION&&!pending&&!nextScene,activeMs};
}
