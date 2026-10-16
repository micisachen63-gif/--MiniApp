import {replayDecisionLife,DECISION_DURATION_MS} from './decision-engine-v7.js';
import {hash,worldYear} from './world.js';
import {sharedMemories} from './shared-story.js';
import {validSocialCast,SOCIAL_ROLES} from './social-cast.js';

// Version 7 presentation recipe 1. This module interprets the conditional event
// ledger; it does not run legacy career chains or invent jobs from answer bits.
// Freeze all ordering/content after publication to preserve public replay.
const DURATION=DECISION_DURATION_MS,INTERVAL=30000,DAY=86400000,OFFSET=28800000;
const lines=text=>Object.freeze(text.trim().split('\n').map(s=>s.trim()).filter(Boolean));
const INFANCY=lines(`
光落在牆邊，你追著那道緩慢移動的亮，伸出還不太穩的手。
你聽見熟悉的聲音靠近，原本繃緊的小身體慢慢放鬆下來。
有人替你把衣角拉平，你抓住那隻手，暫時不肯放開。
窗外下起雨，你先聽見聲音，再看見玻璃上一顆顆水珠。
你學著扶住矮凳，站起來之後，第一次看見桌面的另一邊。
一塊軟布從手裡滑下，你撿起來，又很認真地試了一次。
你把兩件小東西放在一起，敲出的聲音讓自己笑了很久。
有人蹲下來等你走近，短短幾步，也值得慢慢完成。
你開始用自己的聲音呼喚，字還不完整，已有人願意回應。
門邊多了一層軟墊，你還不懂原因，只知道好奇可以再往前一點。
你看見自己的影子，停下來伸手，影子也跟著停下。
一陣風掀起窗簾，你抬頭看了很久，像發現了新的遊戲。
有人把水杯放到你碰得到的地方，等你慢慢學會拿穩。
你把東西藏到布底下，再揭開確認，世界似乎仍在原來的位置。
熟悉的旋律又響起，你不記得所有聲音，卻記得被輕輕抱住的感覺。
你在午睡醒來後發了一會兒呆，才重新認出房間裡的光。
一片葉子落到面前，你翻來翻去，兩面都想看清楚。
你第一次試著自己穿好衣服，歪了一點，仍值得被耐心等候。
你把鞋子擺成不同方向，又蹲下來重新排好。
門外有人說話，你靠近聽，一個還不懂的詞讓你反覆模仿。
你把一小塊食物分到旁邊，像在替還沒到的人留位置。
一顆小球滾進角落，你試了幾種方法，最後終於把它找回。
你跟著指尖認不同形狀，不太確定的時候，又抬頭問了一次。
夜裡醒來時，有人先陪你坐一會兒，再把窗邊的光放暗。
你把一段短短的話說完，身旁的人沒有急著替你接下後半句。
一張紙被你揉出許多皺摺，攤開來看，又像一個新的地方。
你開始記得哪一扇門通向外面，也記得出門前有人會等你。
你把手裡的小物交出去，很快又伸手要回，正在學習分享和捨不得。
你試著沿同一條線走，偏了幾次，仍想知道下一次會不會不同。
一天快結束時，你靠在熟悉的地方，看著屋裡的聲音慢慢安靜。
`);
const CHILDHOOD=lines(`
你用紙折出一個小盒子，歪斜的邊也能裝下今天撿到的東西。
你替一段普通的小路取名字，下一次走過時，心裡有了自己的記號。
你花了一下午畫地圖，畫到最後，最熟悉的轉角反而占了最大一塊。
一個不太懂的詞留在心裡，你找機會問清楚，答案比想像中平常。
你以為一件事只能照原樣做，試過另一種方法後，先笑了出來。
你把弄亂的東西重新排好，第一次感到整齊也能出自自己的手。
你想把一個小發現告訴別人，練習了好幾次，才找到合適的開頭。
你和旁邊的人玩了一場不太正式的遊戲，規則邊玩邊改，笑聲沒有少。
一張被你留了很久的紙，背面其實還空著，今天又有了新的用途。
你仔細比較兩片葉子，發現一樣的名字底下，也有許多不同。
你第一次主動道歉，聲音有點小，說完卻覺得胸口沒有那麼緊。
你把一件做不好的小事重試幾次，還不熟練，已經知道哪裡需要慢。
你在路邊停下看影子，發現同一個地方，早晚竟像兩張不同的圖。
你記住一個回家的標記，下次走到附近時，腳步比以前篤定一些。
你把一段聽來的故事重新說了一遍，說到忘記的地方，老實承認不記得。
你替自己的小收藏留出位置，開始明白珍惜也包含好好收回原處。
一個原本以為很高的地方，如今已經伸手碰得到，你站著看了好一會兒。
你試著聽完不同的說法，才發現先前那場爭執，並不是只有一個人難過。
你留下一個還沒找到答案的問題，沒有因為今天答不出來就把它丟掉。
你把今天最開心的事記住，事情不大，卻讓普通的一天有了名字。
`);
const YOUTH=lines(`
你開始在意別人怎麼看自己，也試著分清哪些聲音其實不必照單全收。
你把喜歡的東西收進自己的角落，第一次很想替那個角落保留一點安靜。
一個曾經深信的答案有了裂縫，你沒有立刻補上，先讓新的問題留下來。
你想說的話和最後說出口的不太一樣，回去後仍在心裡慢慢重排。
你發現不必每次都和大家一樣，但也還在學習，如何不把不同說成對立。
一個小小的肯定讓你記了很久，後來練習時，偶爾還會想到那句話。
你把一段不順利的嘗試收好，暫時不想重看，卻沒有否認它曾經認真。
你第一次說出自己其實不喜歡的事，空氣安靜了一會兒，日子仍然繼續。
你對某個方向產生興趣，先找來能看得懂的資料，沒有急著替一生下結論。
你發現以前常聊的話題漸漸不同，有些沉默需要時間，也需要新的開頭。
你把想做的事列成一小張清單，刪去幾項後，剩下的反而更想開始。
一個新方法起初很不順手，你決定多試幾次，再判斷它適不適合自己。
你在熱鬧中忽然想安靜一下，離開片刻，再回來時已沒那麼勉強。
你練習說明自己為什麼在意，才發現把感受講清楚，也是一種本事。
你把別人的建議記下來，留下可用的部分，也保留最後替自己決定的空間。
一件原本害怕被知道的小事說出口後，並沒有讓整個世界如想像般倒下。
你試著完成一個不為證明給誰看的小計畫，過程裡多了一點自己的節奏。
你不再每次都急著接話，有些時候，聽完比漂亮地回應更不容易。
你重新翻到早先寫下的願望，有些已經不同，仍有幾個字讓你想再試一次。
你承認自己還不知道將來會怎樣，那份不確定裡，也有尚未被關上的門。
`);
const ADULT=lines(`
你開始替自己的安排留出餘裕，讓一件臨時的事不至於推倒整個星期。
你把原本含糊的約定說清楚，少了一點想像，多了一點能共同確認的踏實。
你重新比較投入和能得到的東西，有些看起來划算的安排，其實占去太多自己。
你第一次不再只問能不能做到，也問做完以後，還剩多少力氣過生活。
你把一段不好意思開口的困難說出來，事情沒有立刻解決，至少不再只有猜測。
你發現別人的步調和自己不同，學著在比較之外，辨認自己真正想維持的事。
一項計畫比預想慢，你重新分配時間，接受認真也需要符合現實的速度。
你把做得到和暫時做不到的部分分開，說出口之後，承諾反而比較可靠。
你留了一段時間整理舊資料，先前只靠記憶的東西，終於有了能再次查閱的位置。
你對一件熟悉的事提出新問題，原來長大也不表示什麼都只能照原樣繼續。
你重新練習怎麼拒絕，讓不答應某一件事，不必變成對整段關係的否定。
你發現安定不是所有事情都不變，而是變動出現時，仍有幾個可以確認的安排。
你先把眼前能完成的事做好，沒有再用想像裡的完美開頭延後所有開始。
你替一個被延誤的安排重新確認時間，這次沒有只留下一句含糊的改天。
你把疲倦和失敗分開看，有些做不動的時刻，需要的是休息而不是責備。
你看見自己曾經很努力隱藏的笨拙，如今也能成為理解別人的一種方式。
你重新聽完一段意見，承認其中有不想面對、卻確實能改進自己的部分。
你發現生活裡不少重要的事沒有標準進度，仍然值得用自己的方式慢慢做好。
你為一件小成果高興了一會兒，沒有立刻拿下一個目標蓋過它。
你把一個不能保證的承諾收回，換成具體能做到的事，雖然不漂亮，卻比較誠實。
`);
const MIDDLE=lines(`
你重新檢查多年來的習慣，有些仍然合用，有些只是因為一直沒停下來想。
你發現自己越來越能辨認什麼值得投入，也更願意承認力氣並不是無限。
一段重複很久的日常稍有變化，你沒有急著補回原樣，先看看新的空間能放什麼。
你看見一位正在摸索的人，想起自己也曾把不懂的事藏在看似熟練的表情後面。
你替接下來的安排少留一點逞強，多留一點可以商量和調整的餘地。
你重新翻閱以前的紀錄，才發現有些改變不是突然發生，而是一天一天慢慢累積。
你不再急著用一句話總結一段關係，留下那些相處裡還沒被說完的複雜。
你把幾項總在同時出現的責任攤開，第一次認真想想，哪些其實可以分開處理。
你發現經驗讓某些事情容易，也會讓自己太快以為已經知道答案。
你試著把熟悉的方法說給別人聽，才看見自己平常省略了多少需要解釋的細節。
你為一段延後的相處留出確切空檔，沒有再等事情全部忙完才開始安排。
你重新衡量一個保留很久的目標，它還重要，只是實現的方式可以不同。
你把先前不願承認的損失寫下來，日子沒有因此更輕，卻比較知道下一步往哪裡放。
你允許某些未完成停在原處，先把還願意珍惜的部分照料好。
你發現有些可靠的關係，不需要每天熱鬧，只需要說好的事能被好好記住。
你替一直在做的事找到更省力的方法，原來認真不一定要以疲憊來證明。
你開始主動問別人需要什麼，少用自己多年來習慣的答案替對方決定。
你把往後想保留的日常寫得具體一些，這份想像終於不再只有遙遠的以後。
你重新安排一個屬於自己的角落，不為誰展示，只是希望回來時有地方能坐下。
你發現有些遺憾不必一直追趕，仍能帶著它，把眼前的日子過得更清楚。
`);
const LATER=lines(`
你把幾件舊物重新拿出來，有些已沒有原本的用途，仍留著一段不想急著抹去的記憶。
你發現慢下來之後，熟悉的聲音裡多了幾個過去總沒聽清楚的細節。
你重新挑選想留下的紀錄，不求每一頁完整，只希望重要的地方仍能讀懂。
你不再為每個問題都準備答案，有時陪著想一會兒，也是一種可以給出的時間。
你把一段往事說得比以前簡單，省去證明自己有多厲害的部分，留下當時真正的感受。
一項新工具起初不熟悉，你願意慢慢問，沒有讓年紀替好奇先關上門。
你重新安排一天裡最舒服的時段，讓想做的事不必全擠在別人的時間後面。
你發現有些相聚不需要很長，能把話聽完的一小段，也值得期待。
你把最常使用的東西放得順手，細小調整讓普通的一天少了幾次勉強。
你重新聽到一段熟悉的旋律，先想到的已不是歌名，而是一個很久以前的下午。
你把一件還能做好的小事認真完成，沒有因為它不轟動就覺得不值得。
你願意讓別人的方法試一次，也願意在不合適時，平和地說出自己的需要。
你發現回憶並不總照順序出現，有些細小的片刻，反而比重要日期更清楚。
你把一段想念寫成能送出的話，沒有再要求每一次聯絡都得準備很充分。
你重新看待一個沒能達成的願望，它留在過去，也曾認真帶你往前一段路。
你把曾經受過的幫助記下，才發現一生裡不少轉角，都有人替自己留過一點空間。
你為今天仍然喜歡的事多停了一會兒，沒有急著把普通的快樂講成大道理。
你允許有些事交給不同的人做，自己保留能休息、能繼續好奇的位置。
你重新讀一頁很早以前的字，認得那個人，也看見自己後來慢慢變成的樣子。
你把這一天收進記憶，沒有替它寫下盛大的名字，只記得自己確實在其中生活過。
`);
const COMMON=lines(`
雨停後，地面留著零碎的倒影，你走慢了一點，讓眼睛先認清腳下的路。
你在一個熟悉的轉角停下，才發現牆邊多了一道以前沒有留意的顏色。
有人替後來的人留住門，你接過那一小段方便，也記得回頭看了一眼。
你把常找不到的小東西放回固定位置，第二天少了一場手忙腳亂。
一陣風打亂桌上的紙，你重新排好，順手把最重要的一頁放在上面。
你用一段不趕時間的空檔，做完一件一直想整理的小事。
一杯水慢慢放涼，你終於記得，在下一件事開始前先坐下來。
你聽完一段不熟悉的說法，暫時沒能同意，仍把對方的意思記清。
你把一個容易忘記的細節寫下，讓明天不必再次從猜測開始。
熟悉的路短暫繞行，你看見一扇以前從來沒有經過的窗。
你替一件小小的不方便找到辦法，沒有改變大事，日常卻順了一點。
你留意到光在下午換了方向，同一個房間因此有了不同的樣子。
你把還能使用的東西擦乾淨，發現不必每次都用添新來重新開始。
有人把話說到一半停住，你沒有急著補上，先留了一點等待。
你重新看一個先前的問題，今天終於想到可以再試的一小步。
一段安靜的路讓思緒慢下來，原本混在一起的事，漸漸各有位置。
你把一個含糊的時間問清楚，對方也鬆了一口氣。
你為眼前的一點方便說了謝謝，沒有等到幫助很大才願意承認。
你看見路旁的新芽，想起有些改變，確實需要一段沒人看見的等待。
你把一句太急的回應收住，改用比較能被聽懂的方式再說一次。
你整理一個裝滿零碎物件的角落，找到一件早以為遺失的東西。
你重新確認一項安排，發現雙方原來以為的是不同的時間。
風聲蓋過一句話，你請對方再說一次，這次沒有假裝自己已經聽見。
你在一段普通的等待裡，注意到旁邊有人也在認真照料自己的小事。
你把不再需要的紙分出來，空出的位置讓桌面沒有那麼擁擠。
你留了一個可以更改的空白，沒有把接下來的日子全部排滿。
一個問候比預想來得及時，沒有解決事情，卻讓那一刻比較不孤單。
你先查清楚再回應，少了一次很快的結論，也少了一次不必要的誤會。
你為一件做到的小事高興，沒有立刻把它和別人的成果放在一起比較。
窗邊的聲音變了，你花了一點時間，才找到今天與昨天不同的地方。
你把一段容易混淆的說明分成幾步，原本的難處終於有了入口。
一個沒能完成的安排被你重新記下，這次連需要的時間也一起留下。
你發現自己的想法改變了，於是重新說明，而不是繼續假裝和以前一樣。
你把借來的小物按約歸還，連同一份確實記得的感謝。
你為一段需要專心的時間減少干擾，做得沒有更快，卻比較知道自己正在做什麼。
你坐在熟悉的位置上，重新看見過去常被自己略過的窗外。
一個簡單的提問讓事情變清楚，原來先前的困難有一部分只是沒有人開口。
你把幾項混在一起的小事分開，終於能先做好其中一件。
你留心一個快要被忽略的需求，沒有替對方回答，先問他想怎麼做。
你替自己的東西做了小小的記號，下一次需要時，更容易找回。
你慢慢聽完不同的意見，才發現對方在意的，和自己起初猜的不太一樣。
你在走過的路上認出一點熟悉，陌生的地方開始有可以辨認的方向。
你把一件小失誤說清楚，修正花了時間，往後卻不必再靠隱瞞維持。
你為一個不太敢問的問題找到了開頭，答案沒有想像中難以靠近。
一道平常的聲音讓你想起舊事，你沒有急著追完，只讓記憶留了一會兒。
你重新把東西收妥，發現整理也能替明天省下一點力氣。
你把能確認的部分和仍不知道的部分分開，談話因此沒有再越說越遠。
你在忙亂之前先停一下，才看見有件事情其實還不用立刻答應。
你替一份等待留下明確回覆，不讓對方只能一直猜你是否還記得。
你看見日光慢慢退出牆角，想做的那件小事，今天終於開始了一點。
你為一段不同的步調讓出位置，沒有要求每個人都和自己同時完成。
你把一項需要的東西先備好，接下來的安排少了一次臨時尋找。
你承認剛才沒有弄懂，重新問過之後，才真的能往下一步走。
一個小改動讓原本卡住的地方鬆開，你把原因記住，留給下一次使用。
你把一個只在心裡打轉的念頭寫下，才看見它其實可以分成幾個問題。
你給還沒想清楚的事一點時間，沒有把暫時的困惑急著說成最後的答案。
你聽見一句不太起眼的稱讚，後來再遇到難處時，仍記得那份肯定。
你留意到自己今天比較疲倦，便把其中一項非必要安排往後挪。
你把已經說好的事重新確認，讓關係不必只靠記性撐住。
你在一個熟悉的地方等候，看見平常匆忙經過時沒留意的細節。
你先處理了一件可以完成的小事，原本沉重的清單終於少了一行。
你換一個角度看自己的做法，發現有些堅持只是太久沒有被問過原因。
你把一句感謝說得具體，對方終於知道，原來那件小事曾被認真記住。
你替今天留下一個安靜的結尾，沒有讓每段空白都被新的事情占滿。
你發現一件舊物仍然合用，重新放回身邊，便不再急著尋找替代。
你把想問的事按順序寫清楚，談話時終於少漏掉一個重要的部分。
你為一次遲來的回應補上說明，沒有讓沉默代替所有意思。
你在陌生的說法裡找到一個懂得的詞，先從那裡慢慢問下去。
你把一件不該自己猜的事情直接確認，原本擔心的情節並沒有發生。
你留意到有人需要多一點時間，便不再用催促填滿整段等待。
你替已經完成的事留下一份清楚紀錄，讓後來不必重新從頭證明。
你重新整理一個常用的方法，把可省略與不能省略的部分分開。
你把一段想說的話讀了一次，刪掉幾句逞強，留下比較真實的意思。
你為一個沒有答案的問題保留位置，讓下一次的自己還能接著想。
你在普通的一天裡看見一點進步，沒有因為它很小就假裝不算數。
你把容易打斷自己的事情先放遠，終於能聽清楚眼前的人正在說什麼。
你替一段失約補上道歉和新的安排，接受對方也需要時間重新相信。
你發現原先擔心的事只完成了一半，便先把另一半所需的協助問清楚。
你把一個小地方修整好，生活仍然普通，回來時卻比較順手。
你看見同一件事的不同難處，第一次不那麼急著判斷誰比較用心。
你替一段需要協作的安排說明自己的限制，事情反而比較容易分配。
你把放了很久的小計畫重新拿出來，今天只做一點，也仍然算開始。
你為一個新的習慣留出固定位置，沒有要求自己一次就完全改好。
你把已經不再合適的安排說明白，讓對方不必在舊約定裡一直等下去。
你在短短的休息裡，終於發現自己其實已經把肩膀繃緊很久。
你替一件小事尋求協助，說清楚需要的部分，也留下自己能做的責任。
你重新讀到一句以前不懂的話，這次沒有全懂，卻比從前多明白一點。
你把一場不愉快拆開來想，發現其中也有可以親自修正的部分。
你為一段相處選了一個比較從容的時刻，不再讓每次談話都擠在離開之前。
你把最需要先做的事放到眼前，其餘的暫時安放，不再同時追趕自己。
你看見有人換了一種方法，便先問原因，而不是立刻拿自己的習慣去比。
你替眼前的空間留一點整潔，讓下一個來到這裡的人比較容易開始。
你把不太確定的消息再核對一次，沒有讓轉述比理解跑得更快。
你為一段認真的嘗試留下一點紀念，即使結果沒有完全照期待發展。
你重新想起一件忘記很久的小事，細節不齊，當時的心情卻仍然清楚。
你把能答應的時間說得明確，少一點好聽，卻多一點真正能依靠的安排。
你在一場平常的交談裡，被提醒了一個自己先前沒有想到的角度。
你替一個容易錯過的步驟做了提醒，第二次就少了一段重來。
你把一點不舒服說成具體的需求，對方終於不用只猜哪裡出了問題。
你為接下來的一件事先留下準備時間，沒有把從容全部交給運氣。
你看見自己熟悉的地方有了新變化，便慢慢問清楚它為什麼出現。
你把幾句太重的話收回，重新說明真正需要討論的事情。
你替一個新的問題找來不同的說法，暫時不急著挑出最漂亮的一個。
你把常用的東西分門放好，生活裡一點很小的秩序，讓心情也有了著落。
你為一次不完美的完成留下肯定，知道往後仍能從這裡改進。
你聽見別人承認不懂，便也比較願意說出自己還需要確認的地方。
你替一個一直拖延的聯絡找到開頭，不再要求每一句都先準備得完美。
你把一件看來簡單的事做得仔細，才知道別人先前的辛苦藏在哪裡。
你為今天的一點好心情多停了片刻，沒有急著把它換成下一項目標。
你看見一段需要繞行的路，也找到一個可以稍作停留的地方。
你把一個不太順手的安排重新試過，終於分清是需要練習，還是需要改變。
你替未完成的部分留下清楚標記，下次回來時，不必再猜自己停在哪裡。
你把能修正的小誤會先說開，沒有等到它長成更難靠近的沉默。
你為一場需要等待的事情找了合適節奏，沒有一直盯著還沒發生的結果。
你重新核對一個舊結論，發現當時成立的條件，如今已經有些不同。
你把一件實際發生的好事記下來，讓糟糕的一刻不至於替整天蓋章。
你替一個常被忽視的細節多問一句，原本不清楚的責任終於有了名字。
你把一項不必立刻決定的事放回原處，先完成眼前真正需要回應的部分。
你為一段已經盡力的安排畫下暫時的句點，保留以後重新開始的空間。
你看見一個可以改進的小地方，沒有等到有人交代才願意動手。
你把一場交談裡重要的部分記牢，也允許不重要的誤差慢慢過去。
你替一份來得太快的邀請問清楚條件，讓答應之前也有自己的時間。
你把反覆想著的一件事說給自己聽，終於分清在意的和只是害怕的部分。
你為一個需要重新學習的步驟多留耐心，沒有因為以前會做就要求現在立刻做好。
你看見平常的一個動作原來有不同方法，試過後留下適合自己的那一種。
你把一段沒有被打斷的時間留住，做完之後，才重新打開其他事情。
你替一個人把話聽完，沒有急著讓自己的相似經驗接走整段談話。
你把一件想得很大的事拆小，今天能做到的部分，終於落到手裡。
你為一個不在預期裡的小變動重新排程，接受日子本來就有需要調整的時候。
你看見一份舊紀錄裡自己的改變，原來有些進步，需要隔一段距離才看得清。
你把暫時的情緒和長久的決定分開，先讓自己有時間聽清兩者的差別。
你替一個容易讓人誤解的地方補上說明，後續的合作少了一點猜疑。
你把今天最想留住的細節記下，不求它特別，只因自己確實在意。
你為一個空下來的位置重新想用途，也允許它暫時什麼都不放。
你看見熟悉的東西被照顧得很好，忽然理解日常其實需要許多重複的心意。
你把一段需要告別的安排說清楚，讓結束不必只剩忽然失去聯絡。
你為一件重新開始的小事留下時間，沒有要求它一次補回所有耽擱。
你把一個值得信任的做法記住，往後遇到相似的難處，也知道可以從哪裡問起。
你替今天做過的事留下一點肯定，沒有再用沒完成的部分抹去全部努力。
你看見眼前的光逐漸變暗，收好手邊的東西，讓這一天有一個可以停下的地方。
`);
const memoryPools=Object.freeze({infancy:INFANCY,child:CHILDHOOD,youth:YOUTH,adult:ADULT,middle:MIDDLE,late:LATER,common:COMMON});
const phase=age=>age<6?'infancy':age<13?'child':age<18?'youth':age<35?'adult':age<60?'middle':'late';
function activeBetween(from,to){
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return 0;
 const first=Math.floor((from+OFFSET)/DAY),last=Math.floor((to+OFFSET)/DAY),overlap=day=>Math.max(0,Math.min(to,day*DAY-OFFSET+DAY)-Math.max(from,day*DAY-OFFSET+21600000));
 return first===last?overlap(first):overlap(first)+overlap(last)+Math.max(0,last-first-1)*64800000;
}
function elapsed(life,explicit){
 if(Number.isFinite(explicit))return Math.max(0,Math.min(DURATION,Math.floor(explicit)));
 if(Number.isFinite(life?.startedAt)&&Number.isFinite(life?.clockAt))return Math.min(DURATION,activeBetween(life.startedAt,life.clockAt));
 for(const key of ['activeMs','clockMs'])if(Number.isFinite(life?.[key]))return Math.max(0,Math.min(DURATION,Math.floor(life[key])));
 return DURATION; // Public completed replay has its immutable answers but no private dates.
}
const replay=(life,activeMs)=>replayDecisionLife({...life,...(Array.isArray(life.sources)?{auto:life.sources.map(source=>source==='auto'?1:0)}:{})},{activeMs,autoFill:true});
const eventTime=row=>row.deadlineMs??row.atMs;
const copyState=state=>({...state});
const stateAt=(run,at)=>copyState([...run.resolved].reverse().find(row=>eventTime(row)<=at)?.stateAfter||run.initialState);
function contextId(state){return state.ventureOpen?'venture':state.debt>0?'debt':state.workActive?'work':state.communityActive?'community':state.creativePractice?'creative':'personal';}
function socialEntries(life,death,until){
 return (validSocialCast(life.socialCast)?.people||[]).flatMap(person=>{
  const role=SOCIAL_ROLES[person.thread].role,young=['rooftop','stairs','brother'].includes(person.thread),age=(young?6:18)+hash('v7-cast-age:'+life.seed+':'+person.thread)%8,at=Math.round(age/death*DURATION);
  if(at>until)return [];
  return [{id:'v7-person-'+person.thread,at,thread:person.thread,actor:person.name,role,text:`這一世的旅誌裡，「${person.name}」是你的${role}。一次普通的相遇，讓名字接上了可以彼此認出的日常。`}];
 });
}
const birthGender=run=>run.profile.gender==='f'?'女孩':run.profile.gender==='m'?'男孩':null;

export function plannedV7Content(life,{activeMs}={}){
 if(life?.version!==7)return [];
 const until=elapsed(life,activeMs),run=replay(life,until),death=run.profile.deathAge,rows=[],used=new Set();
 const push=(id,at,text,kind,extra={})=>rows.push({id,age:at/DURATION*death,activeMs:at,worldYear:worldYear(life.seed,at/DURATION*death),kind,text,state:stateAt(run,at),...extra});
 push('v7-origin',0,`${birthGender(run)?'這一世，你以'+birthGender(run)+'的身分出生。':''}尋常的聲音與光線靠近，你還不懂它們的名字，日子已經慢慢向前。`,'origin');
 for(let tick=1;tick*INTERVAL<=until;tick++){
  const at=tick*INTERVAL,age=at/DURATION*death,key=phase(age),pool=memoryPools[key],eligible=pool.map((text,i)=>({id:`v7-day-${key}-${i}`,text})).filter(row=>!used.has(row.id));
  // Each life uses an authored line once. Reserve memories apply after infancy;
  // the infant shelf alone covers the shortest supported life-span window.
  const candidates=eligible.length?eligible:COMMON.map((text,i)=>({id:`v7-day-common-${i}`,text})).filter(row=>!used.has(row.id));
  if(!candidates.length)throw new Error('v7 authored memory pool exhausted');
  const current=stateAt(run,at),salt=life.seed+':'+tick+':'+contextId(current),chosen=candidates.reduce((a,b)=>hash(salt+':'+b.id)<hash(salt+':'+a.id)?b:a);
  used.add(chosen.id);push(chosen.id,at,chosen.text,'memory');
 }
 for(const resolved of run.resolved){
  const at=eventTime(resolved);if(at>until)continue;
  push('v7-choice-'+resolved.eventId,at,resolved.outcome||resolved.text,'choice',{choiceIndex:resolved.index,answer:resolved.answer,source:resolved.source,scenarioId:resolved.id||resolved.eventId,thread:resolved.family,state:copyState(resolved.stateAfter)});
 }
 for(const person of socialEntries(life,death,until))push(person.id,person.at,person.text,'relationship',{thread:person.thread,actor:person.actor,role:person.role});
 if(Number.isFinite(life.startedAt))for(const memory of sharedMemories(life.sharedMemories)){
  const at=activeBetween(life.startedAt,memory.at);if(memory.at<life.startedAt||at>until||at>DURATION)continue;
  push(memory.id+'-'+memory.at,at,memory.text,'shared',{thread:memory.id,source:memory.source});
 }
 return rows.sort((a,b)=>a.activeMs-b.activeMs||(a.kind==='choice'?-1:b.kind==='choice'?1:0)||a.id.localeCompare(b.id));
}

function actualCareer(state){
 if(state.ventureOpen)return {id:'venture',name:'共同經營者',place:'已建立的共同事業',steps:[]};
 if(state.employed&&state.workActive)return {id:'employed',name:'團隊工作者',place:'已建立的工作團隊',steps:[]};
 if(state.freelance&&state.workActive)return {id:'freelance',name:'合作接案者',place:'已建立的合作工作',steps:[]};
 if(state.careerTransition)return {id:'transition',name:'正在轉換方向的旅人',place:'自己的生活',steps:[]};
 return {id:'undetermined',name:'仍在尋找方向的旅人',place:'自己的生活',steps:[]};
}
export function profileV7(life,{activeMs}={}){
 if(life?.version!==7)return null;
 const run=replay(life,elapsed(life,activeMs));
 const threads=socialEntries(life,run.profile.deathAge,elapsed(life,activeMs)).map(person=>({id:person.thread,actor:person.actor,role:person.role,steps:[person.text]}));
 return {seed:life.seed,version:7,gender:run.profile.gender,genderLabel:run.profile.gender==='f'?'女性':run.profile.gender==='m'?'男性':null,region:'星穹世界',career:actualCareer(run.state),threads,objects:[],scenes:run.scenes,
  terminalOutcome:run.terminalOutcome,endingFocus:run.endingFocus,tags:[...run.tags],state:copyState(run.state),completed:run.completed};
}

const ENDINGS=Object.freeze({
 'debt-rebuilding':{art:'harbor',title:'把欠下的日子，一點點還給自己',question:'當生活出了缺口，你會先保住什麼？',quote:'重新站穩，也值得被記成一種抵達。',opening:'你沒有把這一生寫成一路上升的線。曾經的投入留下負擔，接下來的日子，需要先分清能處理的部分，再決定哪一步還走得動。',closing:'回看時，最清楚的並非一個漂亮成果，而是你曾停下來核對、承認限制，仍願意把日常重新接好。那些沒有立刻解決的事，沒有抹去已經做過的努力。'},
 'venture-builder':{art:'atelier',title:'那扇門，後來真的有人一起推開',question:'如果要和別人一起經營，你最想先談清哪件事？',quote:'一起承擔之後，夢想才有了日常的重量。',opening:'從把事情說清楚開始，你和別人共同承擔了一份經營。它不只包含想做的事，也包含需要核對、分配，和沒有人能一直替大家完成的部分。',closing:'這一生留下的是一段確實被共同做過的事。成果未必要用規模來證明；那些能交接的責任、能坦白討論的限制，也讓一份經營有了繼續的可能。'},
 'steady-exit':{art:'harbor',title:'收好桌上的東西，也算好好走完',question:'如果繼續已經不合適，你願意為新的生活留出位置嗎？',quote:'把事情交代清楚，也是在替自己留下明天。',opening:'你走進過一段認真投入的安排，後來也承認它需要改變。轉身不是一夜之間消失，而是把還在手上的責任逐一說清，替下一種日常騰出位置。',closing:'旅誌沒有把留下才算成功寫成唯一答案。你確實做過，也確實調整過；能把結束做得清楚，讓別人和自己都有往後，是這一生另一種可靠。'},
 'community-anchor':{art:'garden',title:'你的名字，留在有人能依靠的日常裡',question:'一個人能做的有限，你願意把什麼變成可以共同承擔的事？',quote:'被記住，有時只是因為說好的那天真的在。',opening:'這一生有幾段時間，你把自己能做到的部分放進共同生活。你沒有替所有人回答，只是讓一些原本各自面對的事情，開始能坐下來商量。',closing:'最後留下的未必是屬於你一個人的成果。那些能輪值、能說出需要、也能在疲倦時請人接手的安排，讓關係不必只靠某個人一直有力氣。'},
 'creative-legacy':{art:'atelier',title:'抽屜裡的那一頁，終於走到了別人手上',question:'如果一件作品不保證帶來收入，你還願意為它留時間嗎？',quote:'有人接著嘗試，便是另一種沒有結束。',opening:'你曾為不一定有答案的創作留下一段時間。它從自己的角落開始，經過修改與重新確認，慢慢有了能與別人相遇的形狀。',closing:'旅誌合上時，不需要替作品補上一個從未發生的轟動。你確實做過、分享過，或保留過能繼續修改的空間；那些被認真留住的部分，已經屬於這一生。'},
 'quiet-independent':{art:'voyage',title:'沒有跟上所有人，卻慢慢認得自己的路',question:'少一點別人的答案，你會把哪段時間留給自己？',quote:'自己的步調，也能走成值得記住的人生。',opening:'你並沒有把每個邀請都接下，也沒有替所有空白急著安上名稱。幾次選擇之後，你開始比較清楚，自己願意把時間留給什麼。',closing:'這冊旅誌沒有強替你補上某個職銜、婚姻或熱鬧的家。它記下的是你實際回應過的時刻，以及在一些尋常的空檔裡，仍然願意繼續理解自己的耐心。'},
 'steady-work':{art:'atelier',title:'不是每一天都耀眼，仍把事情好好接住',question:'穩定和新的可能之間，你會怎麼替自己留下餘地？',quote:'把能做到的事說清，也是一種長久的本事。',opening:'工作在這一生裡占有實際的位置。你從能被確認的事情開始，學著面對交付、分工和自己能承擔的範圍，沒有一開始就知道所有答案。',closing:'回看這些日子，你留下的不只是做過多少事情。哪些承諾可以信任、哪些限制需要早點說清，那些平常看不見的細節，也曾替生活留下一點穩定。'},
 'open-road':{art:'voyage',title:'還沒取好名字的人生，也曾認真走過',question:'若再有一次開始，你最想親自回應哪一種時刻？',quote:'沒有預先寫好的名字，也能留下自己的痕跡。',opening:'這一生沒有照一張固定的清單發生。有些機會曾出現，有些條件沒有湊齊，真正留下來的，是你在已經走到的地方作過的回應。',closing:'沒有發生的關係與成果，旅誌替它們保留空白。已經發生的部分則不必縮小：那些想清楚、說出口、重新安排，或讓時間代為翻過的一頁，確實都曾改變往後的日常。'}
});
export function endingV7(life,{activeMs}={}){
 if(life?.version!==7)return null;
 const until=elapsed(life,activeMs),run=replay(life,until),rows=plannedV7Content(life,{activeMs:until}),complete=run.completed;
 const outcome=typeof run.terminalOutcome==='string'?run.terminalOutcome:run.terminalOutcome?.id;
 const theme=ENDINGS[outcome]||ENDINGS['open-road'],choices=run.resolved,shared=rows.filter(row=>row.kind==='shared'),relationships=rows.filter(row=>row.kind==='relationship');
 const opening=outcome==='creative-legacy'&&!run.state.creativePractice?'你把實際走過的經驗整理成能讓別人接續的紀錄。那些曾經需要反覆確認的細節，開始有了可以公開討論、也能繼續修正的位置。':theme.opening;
 const paragraphs=[(birthGender(run)?`0歲｜這一世，你以${birthGender(run)}的身分出生。`:'0歲｜這一世從尋常的日子開始。')+(complete?opening:'這一冊旅誌還在展開。已經發生的片刻留在紙上，接下來的回應仍未落筆。')];
 const manual=choices.filter(row=>row.source==='manual').length,career=actualCareer(run.state),last=rows.at(-1),lastChoice=choices.at(-1),sceneById=new Map(run.scenes.map(scene=>[scene.id,scene]));
 const timeline=rows.filter(row=>['origin','choice','shared','relationship'].includes(row.kind)).map(row=>({id:row.id,age:Math.floor(row.age),activeMs:row.activeMs,kind:row.kind,label:row.kind==='origin'?'出生':row.kind==='choice'?sceneById.get(row.id.slice('v7-choice-'.length))?.title||'人生抉擇':row.kind==='shared'?'共同寫下的相逢':`${row.role} · ${row.actor}`,text:row.text,...(row.source?{source:row.source}:{})}));
 if(complete)timeline.push({id:'v7-life-ending',age:run.profile.deathAge,activeMs:DURATION,kind:'ending',label:'此生落款',text:theme.closing});
 const milestones=timeline.filter(row=>row.kind!=='origin'&&row.kind!=='ending');
 for(let i=0;i<milestones.length;i+=3)paragraphs.push(milestones.slice(i,i+3).map(row=>`${row.age}歲｜${row.text}`).join(''));
 if(!milestones.length)paragraphs.push('此刻還沒有已落筆的重大抉擇。旅誌只記下已經度過的尋常片刻，沒有替未來先作回答。');
 if(complete)paragraphs.push(theme.closing,`這一世在${run.profile.deathAge}歲落款。曾認真回應過的日常，已在這冊旅誌留下了痕跡。`);
 const chapters=timeline.map(row=>({age:row.age,label:row.label,text:row.text}));
 return {title:complete?theme.title:'尚未合上的旅誌',illustration:'/art/fate-ending-20261016/'+theme.art+'.webp',paragraphs,
  summary:complete?`${theme.title}。${choices.length}次重大回應，${manual}次親自落筆。${lastChoice?.outcome||lastChoice?.text||'尋常日子也曾被認真度過。'}`:'這一世仍在展開，故事只寫到目前已確認的片刻。',
  quote:complete?theme.quote:'還沒抵達的地方，仍留著可以親自回應的位置。',question:theme.question,
  chapters,timeline,gender:run.profile.gender,stats:{...run.state,events:rows.length,career:career.id==='undetermined'?null:career.name,relationships:relationships.length,objects:0,manualChoices:manual,autoChoices:choices.length-manual},
  worldYear:last?.worldYear||worldYear(life.seed),color:theme.art==='garden'?'#a8c9a0':theme.art==='voyage'?'#9cbde0':'#e3bd77',terminalOutcome:outcome||null,endingFocus:run.endingFocus,tags:[...run.tags]};
}

export function narrativeV7Inventory(){return {memoryCount:Object.values(memoryPools).reduce((n,pool)=>n+pool.length,0),phaseMemoryCounts:Object.fromEntries(Object.entries(memoryPools).map(([key,pool])=>[key,pool.length])),endingThemes:Object.keys(ENDINGS).length,intervalMs:INTERVAL};}
