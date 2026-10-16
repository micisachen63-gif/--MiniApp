import {DE_CHILD,DE_YOUTH} from './de-early.js';
import {DE_ADULT_A} from './de-adult-a.js';
import {DE_ADULT_B} from './de-adult-b.js';
import {DE_ADULT_C} from './de-adult-c.js';
import {DE_ADULT_D} from './de-adult-d.js';
import {DE_ADULT_E} from './de-adult-e.js';
import {DE_ADULT_F} from './de-adult-f.js';
import {DE_LATE_A} from './de-late-a.js';
import {DE_LATE_B} from './de-late-b.js';
import {DE_LATE_C} from './de-late-c.js';
import {DE_ANY} from './de-any.js';
import {DE_CAREERS_A} from './de-careers-a.js';
import {DE_CAREERS_B} from './de-careers-b.js';
import {DE_CAREERS_C} from './de-careers-c.js';
import {DE_SOCIAL} from './de-social.js';

export const COUNTRY_PACK_DE={
 id:'DE',name:'德國',cityId:'cologne',cityName:'科隆',scope:'德國北萊茵－西發利亞邦（NRW）科隆市範圍；教育以NRW規則為準，日常限科隆市區與萊茵河兩岸，不套用其他德國邦的制度。',currency:'EUR',
 families:[
  {id:'tight',label:'常把必要開支排在最前的家庭',text:'你在科隆出生，照顧你的人先把交通、食物和需要的物品列好，有限的周轉仍留著彼此商量的空間。',money:280},
  {id:'ordinary',label:'靠清楚安排維持日常的家庭',text:'你在科隆的街區長大，家裡常談接送、學習與採買；生活不總順利，但有人願意一起把問題理清。',money:1850},
  {id:'small-business',label:'隨著小生意節奏周轉的家庭',text:'你在科隆出生，家裡會核對貨單與收支，也提醒你把做生意的成本和能自由使用的錢分開。',money:5200},
  {id:'comfortable',label:'能替嘗試留下緩衝的家庭',text:'你在科隆出生，家裡有條件支持更多學習與探索，也總有人提醒你自己想清楚要走哪一條路。',money:16500}
 ],
 careers:[...DE_CAREERS_A,...DE_CAREERS_B,...DE_CAREERS_C],
 daily:{child:DE_CHILD,youth:DE_YOUTH,adult:[...DE_ADULT_A,...DE_ADULT_B,...DE_ADULT_C,...DE_ADULT_D,...DE_ADULT_E,...DE_ADULT_F],late:[...DE_LATE_A,...DE_LATE_B,...DE_LATE_C],any:DE_ANY},
 education:{name:'北威州的學校與職業培訓路線',description:'你在科隆比較繼續學校教育、職業學校與雙軌職業培訓的路線。雙軌培訓把企業實作與職業學校結合，入職條件、合約與考核需要逐項確認；大學路線另有入學與修業要求。',startLabel:'比較學校與實作路線',startOutcome:'你帶著目前的學習記錄詢問學校與正式諮詢窗口，確認自己適用的北威州安排，再開始準備申請與所需課程。',pauseOutcome:'你把已完成與待完成的部分分開記下，向學校確認接續安排；仍適用的就學與培訓義務，也一起排進新的計畫。',completeLabel:'完成這段課程及相應評核',completeOutcome:'你完成所選路線這一段的課程與相應評核，把實際取得的成果記清，繼續準備下一段申請；職業培訓、課程成果與大學學位各有自己的完成條件。'},
 social:DE_SOCIAL,
 shared:[
  {id:'moving',title:'科隆樓梯口的紙箱標籤',text:'科隆一場經住戶同意的搬物協助中，{owner}與{guest}被請來整理少量紙箱。樓梯轉角狹窄，負責搬運的人正在等清楚標籤，{guest}想先做哪一件？',choices:[{label:'在樓下核對紙箱標籤',outcome:'{guest}在樓下核對可公開的箱號，{owner}把確認結果交給負責人。箱子各自到位，兩人都記住那句認真說出的謝謝。'},{label:'和負責人確認空箱存放處',outcome:'{guest}先問清指定位置，{owner}協助收攏空箱，樓梯入口恢復通暢。這段短幫忙成為兩人的科隆街區記憶。'}]},
  {id:'parcel',title:'取件點的相似名字',text:'科隆包裹取件點裡，{owner}與{guest}注意到兩個相近姓名需要店員再核對。包裹都未拆開，{guest}想怎麼讓這段等待更清楚？',choices:[{label:'請店員依流程核對取件資料',outcome:'{guest}和{owner}留在櫃臺等核對，店員確認後才交付對應包裹。你們沒有拆看內容，卻一起記住了把小字讀清的耐心。'},{label:'確認保管方式與再來時段',outcome:'{guest}問清店員的保管安排，{owner}記下可再來的時間。事情釐清後，你們笑說這次最有用的不是猜對，而是先問。'}]},
  {id:'repair',title:'社區入口的照明回報',text:'{owner}與{guest}經過科隆公共社區空間，發現入口一盞燈忽亮忽暗。值班窗口仍在，{guest}想先把哪一段資訊說清？',choices:[{label:'記下位置與觀察時間再回報',outcome:'{guest}把位置和時間告知值班者，{owner}指向現場。檢修交給合適人員，你們後來看見修好的照明，知道那次停留幫上了忙。'},{label:'請值班者確認並安排替代入口',outcome:'{guest}找到值班者，{owner}依其安排指向已確認可通行的入口。兩人留下的是一段互相照應的記憶，設備也得到正式處理。'}]},
  {id:'market',title:'街區交換桌的兩種整理法',text:'科隆一場由主辦方安排的街區交換活動裡，{owner}和{guest}被邀整理公共書桌。空間有限，{guest}想先讓哪件事情容易一點？',choices:[{label:'按主題整理書並標明交換方式',outcome:'{guest}整理書的主題，{owner}照主辦方規則補上說明。有人找到想讀的那一本，你們也因此接上一段閱讀話題。'},{label:'先整理通道與桌面位置',outcome:'{guest}核對動線，{owner}幫忙將桌面分區標清。活動結束時，那張被指過許多次的位置圖成了你們共同完成的小作品。'}]},
  {id:'umbrella',title:'萊茵河風裡的一把傘',text:'萊茵河邊忽然飄雨，{owner}與{guest}停在可通行的遮蔽處，兩人都不急著離開。{guest}想怎麼度過這段等待？',choices:[{label:'找不擋入口的位置等雨小',outcome:'{guest}和{owner}站到不妨礙通行的一側，從橋影聊到科隆喜歡的街角。雨小下來時，這段等待已不只是等候。'},{label:'一起確認通往車站的遮雨路線',outcome:'{guest}查看地圖，{owner}核對當日可用的入口。你們把傘留給沒有遮蔽的一段，沿著確認過的方向走回站旁。'}]},
  {id:'bookstore',title:'科隆書店的一張城市問題卡',text:'科隆一間書店的公開留言桌還有空白卡，店員邀請{owner}與{guest}留一段願意分享的閱讀或城市感受。{guest}想選哪種寫法？',choices:[{label:'留一本推薦書和一個問題',outcome:'{guest}寫下書名與想問的事，{owner}補上一句不同看法。下次經過有人留下回應，兩人發現一張卡也能讓對話繼續。'},{label:'寫下萊茵河邊的一個小片刻',outcome:'{guest}記住河光，{owner}寫下橋下的回音。店員將卡片放到公開架上，兩段普通的科隆日常因此有了被看見的位置。'}]}
 ],
 sources:[
  {id:'de-nrw-school',title:'NRW 法規入口 — Schulgesetz NRW',url:'https://recht.nrw.de/lrgv/gesetz/01082025-schulgesetz-fuer-das-land-nordrhein-westfalen-schulgesetz-nrw-schulg/',checkedAt:'2026-10-16',supports:'教育明確限北威州；全日制與其後就學義務按適用條文與路線確認，不以單一年數概括全德。'},
  {id:'de-dual-training',title:'Bundesagentur für Arbeit — Wege in die Ausbildung',url:'https://www.arbeitsagentur.de/bildung/einfach-erklaert/wege-in-die-ausbildung',checkedAt:'2026-10-16',supports:'企業實作與職業學校的雙軌培訓，並與學校型培訓區分；入職與完成不能由試讀直接推定。'},
  {id:'de-dual-study',title:'Bundesagentur für Arbeit — Duales Studium',url:'https://www.arbeitsagentur.de/bildung/studium/duales-studium',checkedAt:'2026-10-16',supports:'雙軌高等教育不同於一般職業培訓；大學學位需要另行入學與完成要求。'},
  {id:'de-food-instruction',title:'Stadt Köln — Bescheinigung-Belehrung',url:'https://www.stadt-koeln.de/service/produkte/00206/index.html',checkedAt:'2026-10-16',supports:'特定食品工作依實際活動須先完成IfSG第43條告知及相應證明；麵包販售按適用工作與雇主訓練安排。'},
  {id:'de-food-memo',title:'Stadt Köln — Schulung und Belehrung',url:'https://www.stadt-koeln.de/mediaasset/content/pdf57/schulung_und_belehrung_-_merkblatt.pdf',checkedAt:'2026-10-16',supports:'食品衛生訓練與法定告知是需分別核對的要求，未捏造一張通用職業資格。'},
  {id:'de-business',title:'Stadt Köln — Gewerbebetrieb anmelden',url:'https://www.stadt-koeln.de/service/produkte/00554/index.html',checkedAt:'2026-10-16',supports:'小生意的營業登記與變更有正式程序；角色先做既有營運協作，自營僅準備與諮詢，不直接宣稱完成許可。'},
  {id:'de-ihk-assessment',title:'IHK Köln — Abschlussprüfung Ergebnisse',url:'https://www.ihk.de/koeln/hauptnavigation/ausbildung/pruefungen/pruefungsergebnisse-der-abschlusspruefung-5015046',checkedAt:'2026-10-16',supports:'職業培訓有實際結業考核，助手任職及短課程不直接寫成通過正式考試。'},
  {id:'de-kvb-access',title:'KVB — Barrierefreiheit',url:'https://www.kvb.koeln/service/barrierefreiheit.html',checkedAt:'2026-10-16',supports:'科隆交通無障礙需按車站、車輛與當日狀態查詢，沒有宣稱全部站點皆可通行。'},
  {id:'de-kvb-stations',title:'KVB — Haltestellen',url:'https://www.kvb.koeln/haltestellen/index.html',checkedAt:'2026-10-16',supports:'當地站點、路線及方向查詢背景；不固定即時票價。'},
  {id:'de-packaging',title:'Umweltbundesamt — Verpackungen Fragen und Antworten',url:'https://www.umweltbundesamt.de/themen/abfall-ressourcen/produktverantwortung-in-der-abfallwirtschaft/verpackungen/fragen-antworten-verpackungen-verpackungsabfaelle',checkedAt:'2026-10-16',supports:'退瓶與一次性／可重用包裝需看標示，未把單一押金金額套用所有容器。'},
  {id:'de-library',title:'Stadt Köln — Stadtbibliothek',url:'https://www.stadt-koeln.de/leben-in-koeln/stadtbibliothek/',checkedAt:'2026-10-16',supports:'科隆市圖書館及公共閱讀活動背景，使用服務前確認權限與當期資訊。'},
  {id:'de-library-rules',title:'Stadt Köln — Bibliothek Benutzungsordnung',url:'https://www.stadt-koeln.de/mediaasset/content/satzungen/benutzungs-und-entgeltordnung-stadtbibliothekt-koeln_2025-12-16.pdf',checkedAt:'2026-10-16',supports:'未滿7歲圖書館活動由成人陪同；幼年日常未安排自行進館使用受限服務。'},
  {id:'de-ludwig',title:'Museum Ludwig — Besuch',url:'https://www.museum-ludwig.de/de/besuch',checkedAt:'2026-10-16',supports:'科隆路德維希博物館參觀背景，未固定票價或假造每日活動。'},
  {id:'de-ludwig-access',title:'Museum Ludwig — Barrierefreiheit',url:'https://www.museum-ludwig.de/de/besuch/informationen/barrierefreiheit',checkedAt:'2026-10-16',supports:'參觀動線與可及資訊由場館確認，不用印象承諾個別入口。'}
 ]
};
export default COUNTRY_PACK_DE;
