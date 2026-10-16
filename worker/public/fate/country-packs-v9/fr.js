import {FR_CHILD,FR_YOUTH} from './fr-early.js';
import {FR_ADULT_A} from './fr-adult-a.js';
import {FR_ADULT_B} from './fr-adult-b.js';
import {FR_ADULT_C} from './fr-adult-c.js';
import {FR_ADULT_D} from './fr-adult-d.js';
import {FR_ADULT_E} from './fr-adult-e.js';
import {FR_ADULT_F} from './fr-adult-f.js';
import {FR_LATE_A} from './fr-late-a.js';
import {FR_LATE_B} from './fr-late-b.js';
import {FR_LATE_C} from './fr-late-c.js';
import {FR_ANY} from './fr-any.js';
import {FR_CAREERS_A} from './fr-careers-a.js';
import {FR_CAREERS_B} from './fr-careers-b.js';
import {FR_CAREERS_C} from './fr-careers-c.js';
import {FR_SOCIAL} from './fr-social.js';

export const COUNTRY_PACK_FR={
 id:'FR',name:'法國',cityId:'paris',cityName:'巴黎',scope:'法蘭西島的巴黎市及東側明確近郊蒙特勒伊（Montreuil，Seine-Saint-Denis）；不是全法國通用日常。巴黎與蒙特勒伊公共服務分別按各自規則確認，未將其他近郊或海外地區混入。',currency:'EUR',
 families:[
  {id:'tight',label:'先把必要開支排好的家庭',text:'你在巴黎生活圈出生，照顧你的人把交通、食物與學習需要一項項排好，有限的餘裕也留下彼此商量的時間。',money:260},
  {id:'ordinary',label:'在日常安排裡慢慢前進的家庭',text:'你在巴黎與東側近郊的街道聲中長大，家裡常談接送與下一段學習，也會為臨時改變的計畫重新找方法。',money:1750},
  {id:'small-business',label:'隨著小店周轉起伏的家庭',text:'你在巴黎生活圈出生，家裡的採購單與帳目經常攤在一起，有人教你把成本先留好，也留一段不談生意的日常。',money:4900},
  {id:'comfortable',label:'能替探索預留緩衝的家庭',text:'你在巴黎生活圈出生，家裡能支持更多學習與嘗試，也願意讓你慢慢想清楚真正想走的路。',money:15800}
 ],
 careers:[...FR_CAREERS_A,...FR_CAREERS_B,...FR_CAREERS_C],
 daily:{child:FR_CHILD,youth:FR_YOUTH,adult:[...FR_ADULT_A,...FR_ADULT_B,...FR_ADULT_C,...FR_ADULT_D,...FR_ADULT_E,...FR_ADULT_F],late:[...FR_LATE_A,...FR_LATE_B,...FR_LATE_C],any:FR_ANY},
 education:{name:'法國的普通、技術與職業學習路線',description:'你比較普通與技術高中、職業路線及學徒培訓。CAP、bac professionnel與高等教育各有內容及完成要求，CFA／UFA與企業交替實作也需要具體安排；16至18歲期間仍須按適用規定接續教育、培訓、就業或其他受承認路線。',startLabel:'比較課程與交替實作的選擇',startOutcome:'你向學校與正式諮詢窗口確認目前條件，再比較課程、通勤、企業與CFA的安排，開始準備適合自己的申請。',pauseOutcome:'你記下已完成與待補的部分，向學校或正式窗口確認接續方案，並把仍適用的培訓與就學安排一起排好。',completeLabel:'完成所選路線的課程及評核',completeOutcome:'你完成這段已確認的課程與相應評核，把實際取得的成果記進學習紀錄；CAP、bac professionnel與大學學位分別依各自的課程、資格和修業要求完成。'},
 social:FR_SOCIAL,
 shared:[
  {id:'moving',title:'巴黎樓梯轉角的一次小分工',text:'巴黎一場經住戶同意的搬物協助中，{owner}和{guest}被請來整理少量箱子。負責搬運的人正等清楚標籤，{guest}想怎麼讓這段幫忙容易一點？',choices:[{label:'在樓下核對箱號與方向',outcome:'{guest}把可公開的箱號核對好，{owner}交給負責人確認。箱子各自送到位，兩人記住那句很認真的謝謝。'},{label:'先確認空箱收放的位置',outcome:'{guest}向負責人問清指定處，{owner}協助收攏空箱。狹窄入口重新能通行，這段小忙也留進兩人的巴黎日常。'}]},
  {id:'parcel',title:'取件櫃臺前的相近名字',text:'巴黎一處包裹取件點前，{owner}與{guest}發現兩個相近名字需要店員再核對。包裹都未拆開，{guest}想選哪一種處理方式？',choices:[{label:'請店員按流程再確認一次',outcome:'{guest}與{owner}留在櫃臺等候，店員核對完成才交出包裹。兩人沒有拆看內容，卻一起記住把細節讀清的耐心。'},{label:'問清保管安排與再來時段',outcome:'{guest}請店員說明保管方式，{owner}記下可再來時間。事情釐清後，你們都覺得先問比急著猜更省心。'}]},
  {id:'repair',title:'街區公共入口的照明',text:'{owner}與{guest}經過巴黎一處公共活動空間，看到入口燈光忽明忽暗。值班窗口還在，{guest}想先把什麼資訊說清？',choices:[{label:'記下位置與觀察時間',outcome:'{guest}把位置和時間告知值班者，{owner}指向現場。檢修由合適人員接手，兩人之後看見恢復的照明，也記得那次停留。'},{label:'請值班者確認可用替代入口',outcome:'{guest}找到負責窗口，{owner}依對方安排說明可通行入口。兩人留下互相照應的記憶，也讓設備問題得到正式處理。'}]},
  {id:'market',title:'蒙特勒伊的公共交換桌',text:'蒙特勒伊一場由主辦方安排的街區交換活動裡，{owner}與{guest}受邀整理公共桌上的二手書與小物。{guest}想先讓哪件事情清楚一點？',choices:[{label:'依主題整理書與交換說明',outcome:'{guest}把書按主題放好，{owner}依活動規則補上說明。有人找到想讀的一本，也和你們接上一段新的閱讀話題。'},{label:'先確認桌面位置與通道',outcome:'{guest}核對動線，{owner}協助把公共桌分區標清。那張被指過好多次的位置圖，後來成了兩人共同完成的小作品。'}]},
  {id:'umbrella',title:'塞納河小雨裡的等待',text:'塞納河邊一陣小雨讓{owner}和{guest}停在可遮蔽的位置，兩人都不急著離開。{guest}想怎麼度過這段短短等候？',choices:[{label:'在不擋入口處聊天等雨小',outcome:'{guest}與{owner}移到不妨礙通行的一側，從橋影聊到巴黎喜歡的轉角。雨小下來時，這段等待已多了一點溫度。'},{label:'一起確認可遮雨的返程路線',outcome:'{guest}查看地圖，{owner}核對當日可用入口。兩人把傘留給沒有遮蔽的一段，沿確認過的路慢慢走到站旁。'}]},
  {id:'bookstore',title:'書店留給城市的一張卡',text:'巴黎一間書店的公開留言桌還有空白卡，店員邀請{owner}與{guest}留一段願意分享的閱讀或街景感受。{guest}會選哪種寫法？',choices:[{label:'留一個書名與想問的問題',outcome:'{guest}寫下書名與問題，{owner}補上一句自己的不同理解。之後有人留下回應，兩人發現紙上的對話也能慢慢接下去。'},{label:'各寫一個普通城市片刻',outcome:'{guest}寫河邊風聲，{owner}記下書箱旁的光。卡片被店員放到公開架上，兩段普通巴黎日常因而有了被閱讀的位置。'}]}
 ],
 sources:[
  {id:'fr-training-duty',title:'Ministère de l’Éducation nationale — Obligation de formation 16–18 ans',url:'https://www.education.gouv.fr/l-obligation-de-formation-des-16-18-ans-306954',checkedAt:'2026-10-16',supports:'16至18歲適用教育、培訓、就業與其他受承認接續方案，未把未滿18歲暫停學習寫成不需安排。'},
  {id:'fr-alternance',title:'Onisep — Apprentissage se former en alternance',url:'https://www.onisep.fr/formation/apres-la-3-la-voie-professionnelle/apprentissage-se-former-en-alternance',checkedAt:'2026-10-16',supports:'CFA／UFA與企業交替培訓；CAP、bac pro等有實際課程與完成條件，不自動等同大學學位。'},
  {id:'fr-apprentice-qa',title:'Onisep — Alternance apprentissage questions réponses',url:'https://www.onisep.fr/vers-l-emploi/alternance/alternance-apprentissage-vos-questions-nos-reponses',checkedAt:'2026-10-16',supports:'申請需確認企業、培訓機構與課程安排，開放活動或短試讀不構成完成資格。'},
  {id:'fr-food-hygiene',title:'Service Public Entreprendre — Hygiène restauration commerces alimentaires',url:'https://entreprendre.service-public.gouv.fr/vosdroits/F32189',checkedAt:'2026-10-16',supports:'按實際職務提供適當食品衛生訓練，商業餐飲的專項訓練另有適用對象與條件；未把14小時套用每名食品助手。'},
  {id:'fr-baker-regulated',title:'Service Public Entreprendre — Boulanger-pâtissier accès et exercice',url:'https://entreprendre.service-public.gouv.fr/vosdroits/F38497',checkedAt:'2026-10-16',supports:'麵包糕點製作有受管制資格與認可要求，本包不從咖啡館或食品販售助手推定取得麵包師職業資格。'},
  {id:'fr-book-career',title:'Onisep — Libraire',url:'https://www.onisep.fr/ressources/univers-metier/metiers/libraire',checkedAt:'2026-10-16',supports:'初階書店銷售、書目與補貨工作路線，聘用依作品與店家要求，不假造專業學位。'},
  {id:'fr-flower-career',title:'Onisep — Fleuriste',url:'https://www.onisep.fr/ressources/univers-metier/metiers/fleuriste',checkedAt:'2026-10-16',supports:'花材照護、銷售與設計有專門技能，現職使用受帶領初階助手範圍。'},
  {id:'fr-flower-cap',title:'Onisep — CAP fleuriste',url:'https://www.onisep.fr/ressources/univers-formation/formations/lycees/cap-fleuriste',checkedAt:'2026-10-16',supports:'CAP花藝有實際課程內容與完成要求；抉擇只查詢與準備，不在未完成時賦予文憑。'},
  {id:'fr-costume-dtms',title:'Onisep — DTMS techniques de l’habillage',url:'https://www.onisep.fr/ressources/univers-formation/formations/lycees/dtms-metiers-du-spectacle-option-techniques-de-l-habillage',checkedAt:'2026-10-16',supports:'演出服裝整備的正式技術訓練路線；助手只做受訓分工，詢問課程不直接取得技術文憑。'},
  {id:'fr-paris-markets',title:'Ville de Paris — Vendre sur les marchés découverts',url:'https://www.paris.fr/pages/exercer-sur-les-marches-alimentaires-3508',checkedAt:'2026-10-16',supports:'市場經營與位置由負責人按類型、管理者和許可確認，攤務助手不自動擁有營業或場地資格。'},
  {id:'fr-montreuil-markets',title:'Ville de Montreuil — Les marchés',url:'https://www.montreuil.fr/la-ville/les-marches',checkedAt:'2026-10-16',supports:'明確東側近郊蒙特勒伊市場與Croix de Chavaux日常，不編造固定每一天的活動。'},
  {id:'fr-paris-library',title:'Ville de Paris — Bibliothèques infos pratiques',url:'https://www.paris.fr/pages/bibliotheques-infos-pratiques-2507',checkedAt:'2026-10-16',supports:'巴黎借閱、專門館及服務有不同權限與登記要求；未把所有資料都寫成免登記免費外借。'},
  {id:'fr-montreuil-library',title:'Ville de Montreuil — Bibliothèque Robert Desnos',url:'https://www.montreuil.fr/bibliotheque-robert-desnos',checkedAt:'2026-10-16',supports:'蒙特勒伊獨立公共圖書館背景，與巴黎市借閱網分別確認服務。'},
  {id:'fr-ratp-stations',title:'RATP — Gares et stations accessibles',url:'https://www.ratp.fr/aide-contact/questions/preparer-mon-trajet/information-trafic/gares-stations-accessibles',checkedAt:'2026-10-16',supports:'巴黎及近郊交通可及性依實際出發到達與網路確認，不宣稱歷史地鐵全可通行。'},
  {id:'fr-ratp-journey',title:'RATP — Vous êtes en fauteuil roulant',url:'https://www.ratp.fr/accessibilite/fauteuil-roulant',checkedAt:'2026-10-16',supports:'確認整段路程及當日電梯狀態，不能僅因單站有電梯就保證全程獨立可達。'}
 ]
};
export default COUNTRY_PACK_FR;
