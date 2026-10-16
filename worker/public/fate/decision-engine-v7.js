// PROTOTYPE ONLY. Not connected to production life.js, formal-events.js or codecs.
// The server must load the persisted run, authenticate the role, derive effectiveMs
// with the existing activeBetween clock, enforce isOpenTime for manual replies,
// and CAS-save the returned run with its notification outbox in one transaction.
// Never trust a client-supplied run, context, clock, journal or consequence.
// v7 needs a variable-length decision archive / opaque shared-record URL, NOT the
// legacy three answer bits. No f7 link is registered by this independent module.
import {hash} from './world.js';

export const DECISION_RECIPE_V7='v7-conditional-1';
export const DECISION_DURATION_MS=7200000;
export const DECISION_RESPONSE_MS=90000;
const MAX_ACTIONS=9;
const ratio=(seed,tag)=>{let x=hash(DECISION_RECIPE_V7+':'+seed+':'+tag);x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return ((x^(x>>>16))>>>0)/4294967296;};
const integer=(seed,tag,min,max)=>min+Math.floor(ratio(seed,tag)*(max-min+1));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const has=(state,key)=>state[key]===true;
const choice=(label,outcome,set)=>({label,outcome,set});
// These are neutral situation prototypes, not completed country content or laws.
// Ages are eligibility WINDOWS; prerequisites and past choices determine whether
// an event is actually present. No milestone or qualification is awarded by age.
export const DECISION_CATALOGUE_V7=freeze([
 {id:'child-circle',family:'belonging',ages:[6,15],chance:.8,requires:[],title:'這一次，要不要一起試？',text:'同伴邀你參加一件還不熟悉的小事，你也有想獨自完成的計畫。',choices:[choice('和同伴一起嘗試','你加入同伴，開始學會說出自己的想法，也聽見別人的顧慮。',{trustedPeer:true}),choice('先完成自己的小計畫','你把注意力放回自己的小計畫，為它留出能慢慢試錯的時間。',{independentProject:true})]},
 {id:'child-voice',family:'speaking-up',ages:[8,17],chance:.55,requires:[],title:'有人誤會你的時候，你想怎麼說？',text:'一件小事被說成另一個樣子，你可以當面說明，也可以先找願意聽的人整理思緒。',choices:[choice('找當事人好好說清楚','你把事情一段段說清楚，第一次發現，開口不必先變得很大聲。',{speaksDirectly:true}),choice('先和信任的人談談','你先找人整理思緒，知道自己不是只能獨自承受誤會。',{trustedPeer:true})]},
 {id:'school-direction',family:'learning-direction',ages:[14,25],chance:.7,requires:[],context:['trainingAccess'],title:'接下來想把時間投在哪種學習？',text:'你看見不同的學習方式，決定先投入能持續參與的一條路。這次承諾還不等於完成修業。',choices:[choice('留時間試一段系統課程','你替一段課程排出時間，準備用實際練習確認是否適合自己。',{trainingCommitted:true,courseRoute:true}),choice('從自己的題目慢慢探索','你先從想做的題目開始探索，沒有因為暫時不報課程就停止學習。',{independentProject:true})]},
 {id:'skill-practice',family:'practice',ages:[17,42],chance:1,requires:['trainingCommitted'],afterYears:1.5,title:'練習遇到瓶頸，接下來怎麼做？',text:'第一段練習並不順利。你可以把問題帶回去請人看，也可以先暫停這條路，重新安排負擔。',choices:[choice('完成練習並接受回饋','你完成一件可供檢查的小作品，從回饋裡找到下一步能改進的地方。',{skillReady:true}),choice('暫停這條訓練路線','你承認眼前安排還不合適，先把負擔調整好，沒有替尚未完成的訓練蓋上合格章。',{trainingPaused:true,trainingCommitted:false})]},
 {id:'work-offer',family:'first-work',ages:[19,54],chance:1,requires:['skillReady'],excludes:['ventureOpen'],afterYears:.7,title:'有人願意給你一個長期機會。',text:'一份長期工作與一個小型合作同時出現，你想先在哪種環境累積經驗？',choices:[choice('接受團隊裡的長期工作','你接受長期工作，先從能被確認與交接的任務開始。',{workActive:true,employed:true,freelance:false}),choice('先接能承擔的小型合作','你選擇小型合作，先把範圍與交付說清楚，不承諾自己還做不到的事。',{workActive:true,employed:false,freelance:true})]},
 {id:'first-project',family:'work-boundary',ages:[21,60],chance:1,requires:['workActive'],afterYears:1,title:'第一件重要工作，要怎麼交出去？',text:'工作做到一半出現限制。你可以提早和對方談調整，也可以暫緩這次交付，先把問題弄清楚。',choices:[choice('說清限制，協商可交付的版本','你提早說明限制，和合作的人找到可以共同確認的交付方式。',{portfolioAccepted:true}),choice('先暫緩這份工作，重新確認','你暫緩這份工作，承認還需要查清的地方，沒有用勉強交付來換表面順利。',{projectDeferred:true})]},
 {id:'partnership',family:'partnership',ages:[25,65],chance:1,requires:['skillReady','trustedPeer'],afterYears:1.2,title:'熟悉的人提出一起經營的邀請。',text:'你已經完成可接受檢查的實作，也有一位願意談清楚責任的熟人。這次要共擔經營責任，還是保留清楚分開的安排？',choices:[choice('先談清責任，再一起經營','你們先把責任與退出方式說清楚，才開始一起經營。',{ventureOpen:true,founder:true,workActive:true,employed:false,freelance:false}),choice('保留各自的安排，繼續交流','你保留各自的工作與生活安排，讓關係不必靠共同經營才能延續。',{separatePractice:true})]},
 {id:'first-helper',family:'venture-growth',ages:[29,82],chance:.8,requires:['ventureOpen','ventureSucceeded'],afterYears:1.5,title:'工作變多，要不要請人加入？',text:'有人願意加入你們的小團隊。增加人手會帶來新的責任，你想先擴大，還是縮小承接範圍？',choices:[choice('準備好安排，再讓新人加入','你先確認交接、工時與能承擔的成本，才邀請新人加入。',{teamExpanded:true}),choice('先少接一點，把步調顧好','你們減少承接的工作，先把現有的合作與休息安排照料好。',{ventureStabilized:true})]},
 {id:'shared-space',family:'community',ages:[12,72],chance:.65,requires:[],title:'熟悉的地方需要有人搭把手。',text:'附近有人邀你協助改善一件日常小事。你可以加入分工，也可以提供一次性的具體協助。',choices:[choice('加入一段能持續的分工','你承擔自己能持續做到的部分，也認識幾位願意一起商量的人。',{communityActive:true,trustedPeer:true}),choice('提供一次合適的協助','你提供一次確實做得到的協助，沒有為了不好意思答應超出能力的安排。',{helpedOnce:true})]},
 {id:'work-rest',family:'work-rhythm',ages:[25,71],chance:.65,requires:['workActive'],afterYears:1,title:'工作開始佔去原本留給自己的時間。',text:'事情變多了，你需要替接下來的生活重新排出界線。',choices:[choice('減少承接，把休息排回去','你重新安排承接範圍，讓休息不再只剩忙完以後才可能出現。',{protectedRest:true}),choice('先談好期限，再完成這一段','你和相關的人談好這段工作的期限與分工，答應結束後重新檢視。',{limitedCommitment:true})]},
 {id:'creative-project',family:'personal-project',ages:[14,68],chance:.55,requires:[],title:'一件只屬於自己的事，要不要繼續？',text:'你做了一件不一定能換來收入的小作品。接下來要繼續試，還是先收進抽屜等待合適的時候？',choices:[choice('留下固定時間繼續試','你留下能持續投入的一點時間，不急著替作品證明價值。',{creativePractice:true}),choice('先收好，讓日子留一點空白','你把作品收好，先照顧當下的安排；暫停沒有抹掉已經做過的事。',{projectArchived:true})]},
 {id:'later-study',family:'return-to-learning',ages:[29,66],chance:.6,requires:[],context:['trainingAccess'],title:'再坐回學習的位置，現在合適嗎？',text:'有一項能配合不同經歷的學習機會。你要重新安排時間參與，還是先完成眼前的責任？',choices:[choice('調整安排，重新開始一段學習','你重新排出時間開始學習。這是新的起點，完成修業仍需要後續的努力。',{trainingCommitted:true,laterLearning:true}),choice('先照顧眼前的安排','你先照顧眼前不能省略的安排，也把未來能再查詢的方法記下。',{learningDeferred:true})]},
 {id:'care-circle',family:'caregiving',ages:[25,77],chance:.75,requires:[],context:['careCircle'],title:'在意的人需要協助，怎麼一起安排？',text:'一位已在生活裡的人需要一段協助。你想先召集能分工的人，或先處理自己確實能做的一項？',choices:[choice('找大家談清楚分工','你先確認每個人能做的部分，讓照料不必一直落在同一個人身上。',{careShared:true}),choice('先做好眼前能負責的一項','你先負責一項確實做得到的事，也說清楚自己需要什麼協助。',{careSpecific:true})]},
 {id:'relocation',family:'new-place',ages:[18,62],chance:.7,requires:[],context:['mobilityOffer'],title:'另一個生活圈寄來一份邀請。',text:'新的地方可能帶來機會，也需要重新建立日常。你願意搬過去試試，還是留在熟悉的生活裡調整？',choices:[choice('準備好交通與住處，再過去試試','你先確認住處與往來方式，才開始在新的生活圈建立日常。',{relocated:true}),choice('留下，改變目前的安排','你留在熟悉的地方，替想做的事重新安排一種開始方式。',{rootedByChoice:true})]},
 {id:'friendship-distance',family:'friendship-change',ages:[18,79],chance:.55,requires:['trustedPeer'],afterYears:1,title:'彼此的步調不同了，關係怎麼繼續？',text:'你和熟悉的人很久沒好好說話。要主動約一段能相聚的時間，還是先確認彼此需要的距離？',choices:[choice('約一段彼此都能到的時間','你們替相聚留下一段確定的時間，不只把想念放在改天。',{friendshipRenewed:true}),choice('說清近況，也尊重不同的距離','你們說清各自的近況，允許關係換一種頻率繼續。',{friendshipRespected:true})]},
 {id:'experience-handover',family:'later-legacy',ages:[46,88],chance:.85,requires:[],requiresAny:['workActive','creativePractice','communityActive'],afterYears:2,title:'累積的經驗，想留成什麼樣子？',text:'有人想接著嘗試你做過的事。你可以留時間陪他練習，也可以把可公開的經驗整理成記錄。',choices:[choice('留一段時間陪後來的人練習','你留下能持續的時間陪後來的人練習，也讓他保有不同的做法。',{mentorActive:true}),choice('把能公開的部分整理留下','你整理已確認與仍不確定的部分，讓未曾見面的人也能接著修正。',{experiencePublished:true})]},
 {id:'independent-practice',family:'independent-skill',ages:[16,49],chance:.9,requires:['independentProject'],afterYears:1,title:'自己試過一段時間，願意讓別人看看嗎？',text:'你獨自摸索的東西漸漸有了形狀。要帶去請人檢查，還是繼續保留一個只為自己的角落？',choices:[choice('請人檢查，再完成一次修改','你把作品交給懂得方法的人檢查，依照具體回饋完成了可再嘗試的版本。',{skillReady:true}),choice('保留自己的節奏繼續做','你保留適合自己的節奏，讓創作先是一件願意回來的事。',{creativePractice:true})]},
 {id:'community-responsibility',family:'community-boundary',ages:[22,76],chance:.7,requires:['communityActive'],afterYears:2,title:'大家想把更多共同事務交給你。',text:'被信任很珍貴，但你的時間有限。這次要接下協調，還是先把工作拆成更多人能接手的部分？',choices:[choice('接下有限度的協調','你接下說得清楚的協調範圍，也替需要休息或退出的時候留好安排。',{communityCoordinator:true}),choice('把事情分開，邀更多人加入','你把工作拆成可輪值的小部分，讓共同事務不必依靠同一個人。',{sharedLeadership:true})]},
 {id:'new-place-roots',family:'relocation-followup',ages:[23,75],chance:.85,requires:['relocated'],afterYears:2,title:'新地方漸漸熟悉，要把關係留在哪裡？',text:'你在新的生活圈有了日常，也仍惦記原來的人。這次要安排往來，還是先把眼前的生活安頓穩？',choices:[choice('留出能持續的往來安排','你替遠近的關係留出確實做得到的往來，不把想念全放在忙完以後。',{connectedPlaces:true}),choice('先把現在的生活照料好','你先把眼前的生活安頓清楚，也向遠方的人說明自己的近況。',{newRoots:true})]},
 {id:'publish-project',family:'creative-sharing',ages:[22,80],chance:.8,requires:['creativePractice'],afterYears:2,title:'有人問，能不能把作品分享出去？',text:'作品吸引了幾位讀者。你想公開可分享的部分，還是先和少數願意細看的人交流？',choices:[choice('整理能公開的版本','你核對權利與還沒確認的地方，才把能公開的版本放出去。',{publishedProject:true}),choice('先留在小範圍交流','你先邀願意細看的人交流，讓作品保有可以繼續改變的空間。',{smallCreativeCircle:true})]},
 {id:'care-followup',family:'care-adjustment',ages:[32,81],chance:.8,requiresAny:['careShared','careSpecific'],requires:[],afterYears:2,title:'照料的安排需要再談一次。',text:'原先的分工有了變化，你也感到自己的負擔不同。要重新協調，還是先請合適的人一起釐清可用的支持？',choices:[choice('把變化帶回大家面前商量','你說出負擔與變化，和相關的人重新分配可以承擔的部分。',{careRebalanced:true}),choice('先釐清有哪些正式支持','你和當事人一起查詢可用支持，保留對方的意願，也不再把所有責任攬在自己身上。',{supportMapped:true})]},
 {id:'career-change',family:'career-reorientation',ages:[34,72],chance:.7,requires:['workActive'],excludes:['ventureOpen'],afterYears:4,title:'熟練的工作，還想照原樣繼續嗎？',text:'你開始想像另一種工作安排。新的方向還需要準備，原有的經驗也不必全部丟掉。',choices:[choice('帶著經驗，準備轉換方向','你先交接手上的責任，再開始準備不同的工作方向，沒有把轉換當成一夜之間的重來。',{workActive:false,employed:false,freelance:false,careerTransition:true}),choice('留下，調整目前的工作方式','你留在熟悉的工作裡，重新調整承接與分工，讓經驗仍有新的用法。',{careerRenewed:true})]},
 {id:'mentor-boundary',family:'mentoring-followup',ages:[50,94],chance:.85,requires:['mentorActive'],afterYears:2,title:'後輩的做法和你不同，要怎麼回應？',text:'你陪伴的人提出另一種方法。有些部分還不熟練，也有些地方確實比原來更合適。',choices:[choice('讓他試，也一起確認結果','你讓後輩完整試過，再一起檢查結果；被傳下去的經驗也有了新的樣子。',{mentorAdapted:true}),choice('先說清不能省略的界線','你說清需要共同確認的界線，也承認界線之外可以有不同的做法。',{mentorScopeClear:true})]},
 {id:'personal-time',family:'life-space',ages:[27,82],chance:.6,requires:[],title:'突然空下來的一段時間，想留給什麼？',text:'一項安排取消了。你可以把空白留給自己，也可以約一位一直想見的人。',choices:[choice('留給自己，做一件不趕時間的事','你保留這段空白，沒有立刻用新的責任把它填滿。',{personalSpace:true}),choice('約那位一直想見的人','你主動約了一次見面，讓在意的人不必總排在事情都忙完之後。',{trustedPeer:true})]},
 {id:'venture-pressure',family:'venture-risk',ages:[29,76],chance:1,requires:['ventureOpen'],afterYears:2,title:'接下更大的訂單，還是到這裡就好？',text:'新訂單需要先投入材料與人手，回款卻還不能保證。你已經有一段經營經驗，也知道身邊能分擔的資源有限。',choices:[
  {...choice('承擔借款，試著擴大經營','你決定承擔一段有回收風險的擴張。',{expansionTaken:true}),risk:{base:.43,success:{outcome:'你先談清交付與回款，再和夥伴分批完成訂單。這次擴張接住了機會，經營開始留下超過當期開銷的餘裕。',set:{ventureSucceeded:true},delta:{wealth:115,debt:-20,energy:-12,reputation:25}},failure:{outcome:'你選擇擴張後，實際回款沒有跟上先投入的成本。你們承認無法照原計畫繼續，結束原來的經營，帶著尚未清償的借款重新安排生活。',set:{ventureFailed:true,ventureOpen:false,founder:false,workActive:false,employed:false,freelance:false,repaymentActive:true},delta:{wealth:-65,debt:90,energy:-20,reputation:-10}}}},
  choice('縮小承接，穩定結束這段經營','你把能完成與不能再接的事說清楚，結清可處理的責任後，穩定結束這段經營。沒有擴成大事業，也留下能重新安排的生活。',{ventureOpen:false,ventureExited:true,founder:false,workActive:false,employed:false,freelance:false})
 ]},
 {id:'repayment-choice',family:'debt-rebuilding',ages:[33,86],chance:1,requires:['repaymentActive'],afterYears:1,title:'留下的債務，要怎麼一起面對？',text:'之前擴張留下的借款還需要處理。你可以在取得相關人同意後重新談分期與工作安排，或出售仍能處分的資產，先大幅縮小生活規模。',choices:[choice('重新協調，分段重建生活','你和相關的人談清可承擔的安排，開始分段處理債務。還沒有回到寬裕，至少不用再用沉默掩蓋缺口。',{repaymentShared:true}),choice('出售可處分資產，降低負擔','你出售仍能處分的資產，縮小生活與工作規模。失去一些累積，也換回較能承擔的節奏。',{assetsReleased:true,ventureOpen:false})]}
]);

const REASONS={
 'child-circle':['可能認識之後願意合作的人，也要練習共同安排。','保留獨自探索的時間，同行的機會可能較少。'],
 'child-voice':['直接釐清誤會，也需要面對不一樣的回應。','先取得支持，再決定之後怎麼表達。'],
 'school-direction':['需投入時間與費用，可能開啟後續訓練機會。','保留彈性，職涯要由作品與實際經驗另找入口。'],
 'skill-practice':['需要完成修改，才可能取得第一份工作的機會。','暫時不取得這條訓練的進展，先降低負擔。'],
 'work-offer':['收入與分工較穩定，也需配合團隊安排。','能保留接案彈性，收入與責任波動也較大。'],
 'first-project':['提早協商，可能建立之後合作所需的信任。','可能失去當期收入，但不把未確認的成果交出去。'],
 partnership:['需投入資源並共擔經營責任，之後可能成功，也可能留下債務。','保留分開的責任與收入，不走共同創業路線。'],
 'first-helper':['人手增加，也增加培訓、固定支出與交接責任。','成長可能較慢，先降低固定負擔。'],
 'shared-space':['需持續投入時間，可能形成之後的合作與支持。','讓協助留在可承擔範圍，不承諾長期參與。'],
 'work-rest':['收入機會可能減少，換取較確實的休息。','當期收入可能增加，也要承擔更多疲憊。'],
 'creative-project':['會佔用資源，可能累積可分享的作品。','先騰出空間，這條創作暫不向外發展。'],
 'later-study':['重新投入時間與費用，不等於立刻取得學歷。','暫緩這次機會，先完成當前責任。'],
 'care-circle':['需要協調與投入，但可能增加能共同分擔的支持。','先承擔具體一項，也要留意自身負荷。'],
 relocation:['要承擔安頓與重新認識人的成本。','保留熟悉的支持，另找改變的方式。'],
 'friendship-distance':['需要雙方留下時間，可能恢復較親近的往來。','容許互動變少，不把較遠的關係判成失敗。'],
 'experience-handover':['需持續陪伴，也可能得到後來者的回應。','公開部分經驗，影響可能延伸到不曾見面的人。'],
 'independent-practice':['接受檢查與修改，才可能開啟工作的入口。','優先保留創作本身，不急著讓它負責收入。'],
 'community-responsibility':['需要承擔協調責任，也可能累積公共事務的影響。','分散責任，進度需要更多人一起商量。'],
 'new-place-roots':['保留兩地的聯繫，也要分配往來成本與時間。','先鞏固新生活，舊關係可能換成較慢的頻率。'],
 'publish-project':['需確認權利與內容，可能得到更廣的回應。','回應範圍較小，保留更多修改空間。'],
 'care-followup':['說清負擔，分工可能變動，也需要大家重新同意。','先核對可用資源，不把協助等同放棄自主。'],
 'career-change':['短期收入可能下降，換取重新準備的空間。','保留既有收入與經驗，但需要真正調整工作方式。'],
 'mentor-boundary':['允許結果不同，也共同檢查實際效果。','先說清必要界線，保留界線之外的自主。'],
 'personal-time':['保留休息與自主，這次不增加見面安排。','投入一段陪伴，可能讓關係重新靠近。'],
 'venture-pressure':['要先投入並承擔借款；回款不順可能失去資產、留下債務，有支持與準備也不能保證成功。','放棄擴張機會，先縮減責任，保留重新安排生活的餘裕。'],
 'repayment-choice':['需要相關人同意與長期履行，不會一夜清償。','會失去部分資產，換取較低的負擔。']
};
const DELTAS={
 'school-direction':[{knowledge:18,wealth:-12,energy:-4},{knowledge:8,energy:3}],
 'skill-practice':[{knowledge:22,energy:-7},{energy:12}],
 'work-offer':[{wealth:22,energy:-8,support:5},{wealth:12,energy:-12}],
 'first-project':[{reputation:20,wealth:8},{wealth:-18,reputation:-5,energy:4}],
 partnership:[{wealth:-20,debt:15,energy:-10,support:12},{wealth:8,energy:5}],
 'first-helper':[{wealth:-20,debt:20,support:20,energy:5},{wealth:7,energy:10}],
 'work-rest':[{wealth:-10,energy:22,support:5},{wealth:15,energy:-14}],
 'creative-project':[{wealth:-8,energy:8,knowledge:10},{energy:10}],
 'later-study':[{knowledge:20,wealth:-15,energy:-7},{energy:7}],
 'care-circle':[{wealth:-8,support:25,energy:10},{wealth:-12,energy:-18,support:5}],
 'friendship-distance':[{bonds:25,support:15},{bonds:-22,support:-6}],
 'personal-time':[{energy:15},{bonds:20,support:8,energy:-4}],
 'community-responsibility':[{support:20,reputation:25,energy:-10},{support:12,energy:8}],
 'publish-project':[{reputation:30,wealth:8},{bonds:12,energy:8}],
 'care-followup':[{support:18,energy:12},{support:24,energy:7}],
 'career-change':[{wealth:-20,energy:18},{wealth:12,energy:5}],
 'venture-pressure':[{debt:35},{wealth:12,debt:-15,energy:20}],
 'repayment-choice':[{debt:-40,wealth:10,energy:-8,support:15},{debt:-65,wealth:-35,energy:10}]
};

const FLAGS=new Set(DECISION_CATALOGUE_V7.flatMap(event=>event.choices.flatMap(item=>[...Object.keys(item.set),...Object.keys(item.risk?.success?.set||{}),...Object.keys(item.risk?.failure?.set||{})])));
const CONTEXT_KEYS=['trainingAccess','careCircle','mobilityOffer'];
function fail(message){throw new Error('v7 decision prototype: '+message);}
function validSeed(seed){return typeof seed==='string'&&/^[a-f0-9]{8}$/.test(seed);}
function contextFor(seed,input={},orbit=11){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid immutable context');
 const identity=seed+':orbit:'+orbit,defaults={trainingAccess:ratio(identity,'training-access')<.85,careCircle:ratio(identity,'care-circle')<.7,mobilityOffer:ratio(identity,'mobility-offer')<.55};
 for(const key of CONTEXT_KEYS)if(Object.hasOwn(input,key)){if(typeof input[key]!=='boolean')fail('invalid context '+key);defaults[key]=input[key];}
 return defaults;
}
export function createDecisionRun({seed,orbit=11,context={}}={}){
 if(!validSeed(seed))fail('invalid seed');
 if(!Number.isInteger(orbit)||orbit<0||orbit>11)fail('invalid identity');
 return {version:7,recipe:DECISION_RECIPE_V7,seed,orbit,context:contextFor(seed,context,orbit),clockMs:0,actions:[]};
}
export function decisionProfile(seed,orbit=11){
 if(!validSeed(seed))fail('invalid seed');
 if(!Number.isInteger(orbit)||orbit<0||orbit>11)fail('invalid identity');
 const identity=seed+':orbit:'+orbit;
 return freeze({version:7,recipe:DECISION_RECIPE_V7,durationMs:DECISION_DURATION_MS,responseMs:DECISION_RESPONSE_MS,deathAge:integer(identity,'life-span',57,104),eventLimit:integer(identity,'event-limit',5,9),gender:ratio(identity,'incarnation-gender')<.5?'f':'m'});
}
function normalize(raw){
 if(raw?.version!==7||raw.recipe!==DECISION_RECIPE_V7||!validSeed(raw.seed)||!Number.isSafeInteger(raw.clockMs)||raw.clockMs<0||raw.clockMs>DECISION_DURATION_MS||!Array.isArray(raw.actions)||raw.actions.length>MAX_ACTIONS)fail('invalid persisted run');
 if(!Number.isInteger(raw.orbit)||raw.orbit<0||raw.orbit>11)fail('invalid identity');
 const context=contextFor(raw.seed,raw.context,raw.orbit),actions=[],ids=new Set(),requests=new Set();let previous=-1;
 for(const input of raw.actions){
  if(!input||!DECISION_CATALOGUE_V7.some(e=>e.id===input.eventId)||![0,1].includes(input.answer)||!Number.isSafeInteger(input.atMs)||input.atMs<previous||input.atMs>raw.clockMs||typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(input.requestId)||ids.has(input.eventId)||requests.has(input.requestId))fail('invalid decision log');
  ids.add(input.eventId);requests.add(input.requestId);previous=input.atMs;actions.push({eventId:input.eventId,answer:input.answer,atMs:input.atMs,requestId:input.requestId});
 }
 return {version:7,recipe:DECISION_RECIPE_V7,seed:raw.seed,orbit:raw.orbit,context,clockMs:raw.clockMs,actions};
}
function plansFor(run,profile){
 return DECISION_CATALOGUE_V7.map(event=>{
  const maxAge=Math.min(event.ages[1],profile.deathAge-2),minAge=event.ages[0],dependent=event.requires.length||event.requiresAny?.length,age=dependent||maxAge<minAge?minAge:minAge+ratio(run.seed+':orbit:'+run.orbit,event.id+':age')*(maxAge-minAge);
  return {event,present:ratio(run.seed+':orbit:'+run.orbit,event.id+':present')<event.chance,baseMs:Math.ceil(age/profile.deathAge*DECISION_DURATION_MS),latestMs:Math.min(DECISION_DURATION_MS-DECISION_RESPONSE_MS,Math.floor(maxAge/profile.deathAge*DECISION_DURATION_MS)),tie:hash(run.seed+':tie:'+event.id)};
 });
}
function eligibility(plan,{run,profile,state,flagAt,seen,lastResolved,lastEvent}){
 const event=plan.event,reasons=[];
 if(!plan.present)reasons.push('not-drawn');
 if(seen.has(event.id))reasons.push('already-opened');
 if(seen.size>=profile.eventLimit)reasons.push('life-limit');
 for(const key of event.context||[])if(!run.context[key])reasons.push('context:'+key);
 for(const key of event.requires)if(!has(state,key))reasons.push('requires:'+key);
 if(event.requiresAny?.length&&!event.requiresAny.some(key=>has(state,key)))reasons.push('requires-any:'+event.requiresAny.join('|'));
 for(const key of event.excludes||[])if(has(state,key))reasons.push('excludes:'+key);
 const allTimes=event.requires.map(key=>flagAt[key]??0),anyTimes=(event.requiresAny||[]).filter(key=>has(state,key)).map(key=>flagAt[key]??0),dependencyAt=Math.max(0,...allTimes,anyTimes.length?Math.min(...anyTimes):0),dependent=event.requires.length||event.requiresAny?.length,lagYears=(event.afterYears||0)+(dependent?ratio(run.seed+':orbit:'+run.orbit,event.id+':lag')*5:0),delayMs=Math.ceil(lagYears/profile.deathAge*DECISION_DURATION_MS),gapMs=lastEvent?integer(run.seed,'gap-after:'+lastEvent,120000,420000):0;
 const atMs=Math.max(plan.baseMs,dependencyAt+delayMs,lastResolved+gapMs);
 if(atMs>plan.latestMs)reasons.push('age-window-closed');
 return {eligible:reasons.length===0,reasons,atMs,gapMs,dependencyAt};
}
function initialState(run){return {...Object.fromEntries([...FLAGS].map(key=>[key,false])),energy:integer(run.seed,'energy',65,85),wealth:integer(run.seed,'wealth',30,65),debt:0,knowledge:integer(run.seed,'knowledge',10,25),bonds:integer(run.seed,'bonds',25,55),reputation:integer(run.seed,'reputation',5,18),support:integer(run.seed,'support',25,55)};}
function scene(plan,atMs,profile,index){return {id:plan.event.id,scenarioId:'v7-'+plan.event.id,family:plan.event.family,index,title:plan.event.title,text:plan.event.text,choices:plan.event.choices.map((item,answer)=>[item.label,REASONS[plan.event.id]?.[answer]||'先確認能承擔的安排，再看往後的機會。',item.outcome]),openedMs:atMs,deadlineMs:atMs+DECISION_RESPONSE_MS,age:Math.floor(atMs/DECISION_DURATION_MS*profile.deathAge)};}
function applyChoice(event,answer,run,state,flagAt,atMs){
 const selected=event.choices[answer],flags={...selected.set},delta={...(DELTAS[event.id]?.[answer]||{})};let text=selected.outcome,riskResult=null;
 if(event.id==='friendship-distance')flags[answer?'relationshipDistant':'relationshipClose']=true;
 if(selected.risk){
  const risk=Math.max(.08,Math.min(.8,selected.risk.base+state.debt/(state.wealth+20)*.12-state.support/500-(has(state,'portfolioAccepted')?.08:0))),failed=ratio(run.seed+':orbit:'+run.orbit,'risk:'+event.id+':'+answer)<risk,branch=failed?selected.risk.failure:selected.risk.success;
  riskResult=failed?'setback':'success';text=branch.outcome;Object.assign(flags,branch.set);for(const [key,value]of Object.entries(branch.delta))delta[key]=(delta[key]||0)+value;
 }
 for(const [key,value]of Object.entries(flags)){state[key]=value;if(value)flagAt[key]=atMs;else delete flagAt[key];}
 for(const [key,value]of Object.entries(delta))state[key]=Math.max(0,Math.min(['wealth','debt'].includes(key)?300:100,(state[key]||0)+value));
 state.netWorth=state.wealth-state.debt;
 return {text,consequences:{flags,delta,tags:Object.entries(flags).filter(([,value])=>value).map(([key])=>key),...(riskResult?{riskResult}:{})},stateAfter:{...state}};
}
function endingForState(state){
 let id,title,quote,summary;
 if(has(state,'ventureFailed')&&state.debt>state.wealth){id='debt-rebuilding';title='帶著缺口，重新站穩';quote='這次沒有大獲全勝，你仍把難處說清楚，開始面對留下來的責任。';summary='你曾選擇把經營做大，也實際承受回款跟不上投入的後果。資產縮減，債務沒有因為故事走到最後就憑空消失。這一段人生的重量，落在你如何面對尚未填平的缺口，而不是一張漂亮的成功證明。';}
 else if(has(state,'ventureSucceeded')){id='venture-builder';title='把一次冒險，做成能延續的事';quote='承擔風險沒有保證回報；這一次，你和夥伴把機會接住了。';summary='你先累積實際作品與合作，再決定一起經營，之後又承擔了先投入、再等待回款的擴張。這次訂單與合作接住了成本，經營真正留下超過眼前開銷的餘裕。你所走出的路，有做成的事，也有為它付出的時間和體力。';}
 else if(has(state,'ventureExited')){id='steady-exit';title='在還能選的時候，為自己留一條路';quote='沒有把事業做得更大，也可以是認真想過以後的選擇。';summary='你曾和信任的人一起經營，也遇到可以擴大的邀請。這一次，你看見投入與責任，選擇縮減承接，處理能完成的交代，再穩定結束這段經營。留下的不是一間無限成長的事業，而是重新安排生活的空間。';}
 else if(has(state,'communityCoordinator')||has(state,'sharedLeadership')){id='community-anchor';title='讓一群人的日子，變得比較好走';quote='你留下的影響，不只在自己名下，也在別人能接著做的事情裡。';summary='你選擇參與熟悉地方的共同事務，之後又面對更多責任如何分配的問題。有人需要你協調，也有人因為工作被拆得更清楚而能加入。這條人生留下的不是獨自完成一切的身影，而是一群人能繼續商量與接手的方法。';}
 else if(has(state,'publishedProject')||has(state,'experiencePublished')){id='creative-legacy';title='讓沒見過你的人，也能接續一頁';quote='有些作品沒有替你回答一切，卻替後來的人留下了開始的地方。';summary='你先留下時間做一件願意持續的事，再整理其中可以分享、仍需確認的部分。經驗不再只靠記得你的人保存，也可能來到你未曾見過的人手上。這一世的影響，越過了原本生活圈的邊界。';}
 else if(has(state,'relationshipDistant')){id='quiet-independent';title='走得不同，也把彼此好好放下';quote='不再常常相聚，不代表那些曾經同行的日子沒有重量。';summary='你和熟悉的人真的走過一段路，後來也選擇承認彼此的節奏不同。你沒有用勉強見面證明感情，而是說清近況，保留適合的距離。這條人生比較安靜，也留下了不必把每段關係都留成原樣的自由。';}
 else if(has(state,'workActive')){id='steady-work';title='把生活，一件件做到能交接';quote='不必每一次都走向最大的一條路，日常也能留下可靠的分量。';summary='你先完成練習，才接下真正能負責的工作。後來的生活並不只由職稱決定，還有交付時說清楚的限制、安排時間時留下的界線。這一條路的重量，來自那些確實做過、也能被別人接手的事情。';}
 else{id='open-road';title='沒有照同一張地圖，也走過了自己的路';quote='這一世沒有集齊所有里程碑，仍有已經發生、值得留下的片刻。';summary='有些機會沒有出現，有些邀請來過而你選擇另一種安排。這一條路沒有被補成人人相同的升學、工作、家庭與成功清單；留下來的，是你實際回應過的人與事，以及那些回應之後才打開或關上的門。';}
 return {id,title,quote,summary};
}

function replay(raw,effectiveMs){
 const run=normalize(raw);if(!Number.isSafeInteger(effectiveMs)||effectiveMs<0||effectiveMs>DECISION_DURATION_MS)fail('effective clock must be within two hours');
 const now=Math.max(run.clockMs,effectiveMs),profile=decisionProfile(run.seed,run.orbit),plans=plansFor(run,profile),state=initialState(run),flagAt={},seen=new Set(),journal=[];
 let actionIndex=0,lastResolved=0,lastEvent=null,pending=null,nextAtMs=null;
 const env=()=>({run,profile,state,flagAt,seen,lastResolved,lastEvent});
 for(let step=0;step<MAX_ACTIONS;step++){
  const ready=plans.map(plan=>({plan,gate:eligibility(plan,env())})).filter(item=>item.gate.eligible).sort((a,b)=>a.gate.atMs-b.gate.atMs||a.plan.tie-b.plan.tie||a.plan.event.id.localeCompare(b.plan.event.id));
  const selected=ready[0];if(!selected)break;
  const {plan,gate}=selected,event=plan.event,atMs=gate.atMs,deadlineMs=atMs+DECISION_RESPONSE_MS;
  if(atMs>now){nextAtMs=atMs;break;}
  seen.add(event.id);journal.push({type:'opened',eventId:event.id,family:event.family,atMs,deadlineMs,age:atMs/DECISION_DURATION_MS*profile.deathAge});
  const action=run.actions[actionIndex];let answer,source,resolvedMs;
  if(action&&action.atMs<deadlineMs){
   if(action.eventId!==event.id||action.atMs<atMs||action.atMs>now)fail('decision log violates the active event or window');
   answer=action.answer;source='manual';resolvedMs=deadlineMs;actionIndex++;
   if(now<deadlineMs){pending={...scene(plan,atMs,profile),remainingMs:deadlineMs-now,answered:true,chosenAnswer:answer};break;}
  }else if(now>=deadlineMs){
   // Auto results exist only at their effective deadline; never in a public pending scene.
   answer=integer(run.seed,'timeout:'+event.id,0,1);source='auto';resolvedMs=deadlineMs;
  }else{pending={...scene(plan,atMs,profile),remainingMs:deadlineMs-now,answered:false};break;}
  const result=applyChoice(event,answer,run,state,flagAt,resolvedMs);
  journal.push({type:'resolved',eventId:event.id,family:event.family,atMs:resolvedMs,answer,source,outcome:result.text,consequences:result.consequences,stateAfter:result.stateAfter});lastResolved=resolvedMs;lastEvent=event.id;
 }
 if(actionIndex!==run.actions.length)fail('decision log contains an unavailable, expired or future answer');
 return {run:{...run,clockMs:now},profile,state,journal,pending,nextAtMs,now,plans,env};
}

// Return ONLY snapshot.view to a player. run/state/journal are authoritative
// server-side persistence/replay material, not an authenticated client save API.
export function advanceDecisions(raw,effectiveMs){
 const result=replay(raw,effectiveMs),{run,profile,state,journal,pending,nextAtMs,now}=result;
 return {run,profile,state:{...state},journal,view:{version:7,clockMs:now,completed:now===DECISION_DURATION_MS,pending,nextAtMs,resolved:journal.filter(row=>row.type==='resolved').map(({set,...row})=>row)}};
}

// Internal diagnostics intentionally expose candidate rules. Do not return this
// endpoint to clients: it includes untriggered possibilities and seed windows.
export function inspectDecisionCandidates(raw,effectiveMs){
 const result=replay(raw,effectiveMs);
 return result.plans.map(plan=>{const gate=eligibility(plan,result.env());return {id:plan.event.id,family:plan.event.family,ageWindow:[...plan.event.ages],conditions:{all:[...plan.event.requires],any:[...(plan.event.requiresAny||[])],none:[...(plan.event.excludes||[])],context:[...(plan.event.context||[])]},...gate,eligibleNow:gate.eligible&&gate.atMs<=result.now&&!result.pending};});
}

// Request IDs support identical retries; a changed event/answer with the same ID
// is rejected. DB CAS, role authorization, request HMAC and atomic outbox writes
// remain the integrating service's responsibility, not this pure prototype.
export function chooseDecision(raw,{eventId,answer,requestId}={},effectiveMs,{allowManual=true}={}){
 const normalized=normalize(raw);
 if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)||typeof eventId!=='string'||![0,1].includes(answer))fail('invalid reply');
 const previous=normalized.actions.find(action=>action.requestId===requestId);
 if(previous){if(previous.eventId!==eventId||previous.answer!==answer)fail('request ID conflict');return advanceDecisions(normalized,effectiveMs);}
 if(!allowManual)fail('manual replies are paused');
 const snapshot=advanceDecisions(normalized,effectiveMs),pending=snapshot.view.pending;
 if(!pending||pending.answered||pending.id!==eventId||snapshot.view.completed)fail('event is not available');
 const run={...snapshot.run,actions:[...snapshot.run.actions,{eventId,answer,atMs:snapshot.run.clockMs,requestId}]};
 return advanceDecisions(run,snapshot.run.clockMs);
}

// Stable integration API for variable-length persisted answer vectors. Times and
// dependencies depend on answers at FIXED DEADLINES, never when a manual click
// happened. Auto-fill only resolves windows whose deadline has actually elapsed.
// autoFill:false is the strict completed-code validator: stop at the first
// unanswered deadline and never invent an answer to make a code look complete.
export function replayDecisionLife(life,{activeMs=DECISION_DURATION_MS,autoFill=true}={}){
 if(life?.version!==7||!validSeed(life.seed))fail('expected a version 7 life');
 if(!Number.isSafeInteger(activeMs)||activeMs<0||activeMs>DECISION_DURATION_MS||typeof autoFill!=='boolean')fail('invalid replay clock');
 if(life.answers!==undefined&&!Array.isArray(life.answers)||life.auto!==undefined&&!Array.isArray(life.auto))fail('invalid answer vectors');
 const supplied=Array.from(life.answers||[]),sourceBits=life.auto===undefined?supplied.map(()=>0):Array.from(life.auto);
 if(supplied.length>MAX_ACTIONS||sourceBits.length!==supplied.length||supplied.some(value=>value!==0&&value!==1)||sourceBits.some(value=>value!==0&&value!==1))fail('invalid answer vectors');
 const run=createDecisionRun({seed:life.seed,orbit:life.orbit??11}),profile=decisionProfile(run.seed,run.orbit),initial=initialState(run),state={...initial},flagAt={},seen=new Set(),plans=plansFor(run,profile),scenes=[],resolved=[],answers=[],auto=[];
 let lastResolved=0,lastEvent=null,pending=null,nextScene=null,nextAtMs=null,consumed=0;
 const env=()=>({run,profile,state,flagAt,seen,lastResolved,lastEvent});
 for(let index=0;index<MAX_ACTIONS;index++){
  const ready=plans.map(plan=>({plan,gate:eligibility(plan,env())})).filter(item=>item.gate.eligible).sort((a,b)=>a.gate.atMs-b.gate.atMs||a.plan.tie-b.plan.tie||a.plan.event.id.localeCompare(b.plan.event.id));
  if(!ready.length)break;
  const {plan,gate}=ready[0],current=scene(plan,gate.atMs,profile,index),deadline=current.deadlineMs;scenes.push(current);
  if(current.openedMs>activeMs){nextScene=current;nextAtMs=current.openedMs;break;}
  seen.add(plan.event.id);
  const submitted=index<supplied.length;
  if(submitted){
   if(sourceBits[index]&&activeMs<deadline)fail('an automatic answer cannot exist before its deadline');
   if(sourceBits[index]&&supplied[index]!==integer(run.seed,'timeout:'+plan.event.id,0,1))fail('automatic answer does not match its deterministic timeout');
   consumed++;
  }
  if(activeMs<deadline){
   if(submitted){answers.push(supplied[index]);auto.push(sourceBits[index]);}
   pending={...current,answered:submitted,...(submitted?{chosenAnswer:supplied[index]}:{}),remainingMs:deadline-activeMs,available:!submitted};nextScene=current;nextAtMs=submitted?deadline:current.openedMs;break;
  }
  if(!submitted&&!autoFill){pending={...current,answered:false,remainingMs:0,available:false,missingAnswer:true};nextScene=current;nextAtMs=deadline;break;}
  const answer=submitted?supplied[index]:integer(run.seed,'timeout:'+plan.event.id,0,1),source=submitted?(sourceBits[index]?'auto':'manual'):'auto',result=applyChoice(plan.event,answer,run,state,flagAt,deadline);
  answers.push(answer);auto.push(source==='auto'?1:0);resolved.push({id:plan.event.id,eventId:plan.event.id,index,family:plan.event.family,age:Math.floor(deadline/DECISION_DURATION_MS*profile.deathAge),atMs:deadline,deadlineMs:deadline,answer,source,text:result.text,outcome:result.text,consequences:result.consequences,stateAfter:result.stateAfter});
  lastResolved=deadline;lastEvent=plan.event.id;
 }
 if(consumed!==supplied.length)fail('answer vector includes an unavailable or future event');
 const endingFocus=endingForState(state),tags=[...new Set(resolved.flatMap(row=>row.consequences.tags))];
 return {version:7,profile,answers,auto,scenes,resolved,pending,nextScene,nextAtMs,state:{...state},initialState:initial,terminalOutcome:endingFocus.id,endingFocus,tags,completed:activeMs===DECISION_DURATION_MS&&!pending&&!nextScene,activeMs};
}
