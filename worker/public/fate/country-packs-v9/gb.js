import {GB_CHILD,GB_YOUTH} from './gb-early.js';
import {GB_ADULT_A} from './gb-adult-a.js';
import {GB_ADULT_B} from './gb-adult-b.js';
import {GB_ADULT_C} from './gb-adult-c.js';
import {GB_ADULT_D} from './gb-adult-d.js';
import {GB_ADULT_E} from './gb-adult-e.js';
import {GB_ADULT_F} from './gb-adult-f.js';
import {GB_LATE_A} from './gb-late-a.js';
import {GB_LATE_B} from './gb-late-b.js';
import {GB_LATE_C} from './gb-late-c.js';
import {GB_ANY} from './gb-any.js';
import {GB_CAREERS_A} from './gb-careers-a.js';
import {GB_CAREERS_B} from './gb-careers-b.js';
import {GB_CAREERS_C} from './gb-careers-c.js';
import {GB_SOCIAL} from './gb-social.js';

export const COUNTRY_PACK_GB={
 id:'GB',name:'英國',cityId:'london',cityName:'倫敦',scope:'英格蘭大倫敦範圍；不是蘇格蘭、威爾斯或北愛爾蘭制度的通用包；港區、泰晤士河南北岸、運河及具名街區皆限大倫敦。',currency:'GBP',
 families:[
  {id:'tight',label:'每筆開支都得先商量的家庭',text:'你在倫敦出生，照顧你的人把交通和生活需要寫在紙上，有限的餘裕並沒有替這個家決定一切。',money:350},
  {id:'ordinary',label:'按日常節奏慢慢安排的家庭',text:'你在倫敦的街巷長大，家裡會討論接送、採買與下一段學習，生活有忙亂，也有人願意把話聽完。',money:2200},
  {id:'small-business',label:'靠一門小生意周轉的家庭',text:'你在倫敦出生，家裡常談材料、訂單和收尾；大人教你把經手的錢算清，也記得留一段不談生意的時間。',money:6400},
  {id:'comfortable',label:'有條件替選擇留餘裕的家庭',text:'你在倫敦出生，家裡能替學習和嘗試多留一些空間；有人仍提醒你，資源讓選擇增加，不會替你做好每個決定。',money:18000}
 ],
 careers:[...GB_CAREERS_A,...GB_CAREERS_B,...GB_CAREERS_C],
 daily:{child:GB_CHILD,youth:GB_YOUTH,adult:[...GB_ADULT_A,...GB_ADULT_B,...GB_ADULT_C,...GB_ADULT_D,...GB_ADULT_E,...GB_ADULT_F],late:[...GB_LATE_A,...GB_LATE_B,...GB_LATE_C],any:GB_ANY},
 education:{name:'英格蘭的繼續教育與技能路線',description:'英格蘭的離校規則與其他英國構成國不同。一般離校年齡後仍須參與教育或培訓至18歲，可依實際條件考慮全日制教育、學徒，或工作／志願服務配合部分時間教育或培訓。GCSE後的選擇、A levels、T Levels及學徒並非同一種成果；申請條件、評核和取得的資格須逐項確認。',startLabel:'比較繼續教育與實作訓練',startOutcome:'你把課程內容、通勤和申請條件攤開，和適合的課程窗口確認可走的路線；開始學習不等於已經畢業。',pauseOutcome:'你重新安排眼前的課程與實作，把未完成部分記清；若仍未滿18歲，繼續按英格蘭適用要求安排教育或培訓。',completeLabel:'完成所選課程的要求與評核',completeOutcome:'你完成這一段已確認的課程與評核，依實際路線記錄取得的成果；這不一概等同大學學位，也不自動取得需另行確認的職業資格。'},
 social:GB_SOCIAL,
 shared:[
  {id:'moving',title:'窄樓梯前的一次分工',text:'倫敦一棟建築有住戶正搬動紙箱，主辦協調者邀請路過的{owner}與{guest}幫一小段忙。轉角狹窄，{guest}想怎麼讓人和箱子都好通行？',choices:[{label:'在樓下核對箱子的標籤與方向',outcome:'{guest}留在樓下確認標籤，{owner}把資訊傳給負責搬運的人。沒送錯的那一箱裡是一排書，住戶認真向你們說了謝謝。'},{label:'先和負責人整理出通行動線',outcome:'{guest}和負責人確認擺放位置，{owner}協助把空紙箱收攏。路過的人終於能自在通過，你們也把這段小幫忙留成街區記憶。'}]},
  {id:'parcel',title:'取件櫃臺的相近名字',text:'包裹取件點前，{owner}與{guest}注意到兩個相似名字讓核對卡住了。包裹都還沒拆，店員請大家等一下，{guest}打算如何處理？',choices:[{label:'留在櫃臺，讓店員逐項核對',outcome:'{guest}耐心等店員核對，{owner}幫忙把需要確認的資訊指清。正確包裹交到對的人手中後，大家都鬆了一口氣。'},{label:'先請店員保留，再確認回來時間',outcome:'{guest}與店員確認未拆包裹的保管安排，{owner}記下能再來的時段。再見面時事情已釐清，你們笑說這次最有用的是多問了一句。'}]},
  {id:'repair',title:'社區入口的照明回報',text:'{owner}和{guest}經過倫敦社區空間的入口，發現一盞照明忽亮忽暗。值班窗口還在，{guest}想先把什麼資訊交過去？',choices:[{label:'記清位置與出現時間再回報',outcome:'{guest}把燈的位置和觀察時間說清，{owner}指給值班人員看。之後維修通知貼出來，你們知道那次停留真的幫上了一點忙。'},{label:'請值班人員現場確認並協助引導',outcome:'{guest}找到值班人員，{owner}在對方安排下提醒剛來的人換走較亮的入口。檢修由相應人員接手，你們留下的是一段互相照應的記憶。'}]},
  {id:'market',title:'社區交換桌的新位置',text:'倫敦一場已由主辦方安排的社區交換活動裡，{owner}與{guest}獲邀整理一張公共桌。桌上有二手書與小物，{guest}想先把哪件事做好？',choices:[{label:'把書按主題排好，標清交換方式',outcome:'{guest}按主題整理書，{owner}依主辦方規則寫清交換說明。有人找到正想讀的一本，你們因此聽到一段意外的閱讀分享。'},{label:'先畫桌面位置圖與通道提示',outcome:'{guest}畫出簡單位置圖，{owner}確認出入口沒有被物品擋住。活動結束時，那張被指過好多次的紙也成了你們的共同紀念。'}]},
  {id:'umbrella',title:'巴士站旁，雨還沒停',text:'一陣倫敦小雨讓{owner}和{guest}停在巴士站旁，手邊只有一把傘，兩人也都不急著離開。{guest}想把這段等待怎麼過？',choices:[{label:'在不擋排隊的位置等雨小，再聊一會',outcome:'{guest}找了不擋排隊的地方，{owner}收好手中的紙張。你們從路線聊到喜歡的城市角落，等到雨小才發現這段等待並不漫長。'},{label:'一起查看有遮蔽的步行替代路線',outcome:'{guest}看清地圖上的轉角，{owner}核對了下一處能停留的地方。你們把傘留給最沒有遮蔽的一段，帶著一點雨味走到約好的位置。'}]},
  {id:'bookstore',title:'獨立書店的城市推薦卡',text:'倫敦巷內書店的留言架上還有空白推薦卡，店員邀請{owner}與{guest}留下一段願意公開分享的閱讀感受。{guest}會選哪一種寫法？',choices:[{label:'推薦一本書，也留下一個想討論的問題',outcome:'{guest}寫下推薦與問題，{owner}補上一句自己的不同看法。下次經過時有人留下回應，你們發現一張小卡也能把對話接出去。'},{label:'寫下在城市裡記住的一個普通片刻',outcome:'{guest}寫了一段河岸的光，{owner}記下街角的聲音。店員把卡片放回架上，兩段很小的倫敦日常因此有了能被別人讀到的位置。'}]}
 ],
 sources:[
  {id:'gb-education',title:'GOV.UK — School leaving age',url:'https://www.gov.uk/know-when-you-can-leave-school',checkedAt:'2026-10-16',supports:'英格蘭離校後須教育或培訓至18歲；不將此規則套用蘇格蘭、威爾斯、北愛爾蘭。'},
  {id:'gb-apprentice',title:'GOV.UK — How apprenticeships work',url:'https://www.gov.uk/become-apprentice',checkedAt:'2026-10-16',supports:'英格蘭學徒有實際入職、雇主與培訓安排；不能從一次試讀推定完成學徒或學位。'},
  {id:'gb-library',title:'National Careers Service — Library assistant',url:'https://nationalcareers.service.gov.uk/job-profiles/library-assistant',checkedAt:'2026-10-16',supports:'圖書館助理的入職路線與背景查核；助理不是自動取得專業圖書館員資格。'},
  {id:'gb-food',title:'Food Standards Agency — Food hygiene',url:'https://www.food.gov.uk/food-hygiene',checkedAt:'2026-10-16',supports:'食品處理者按工作內容接受適當監督與衛生訓練；不虛構一律必須持有的食安證照。'},
  {id:'gb-food-training',title:'Food Standards Agency — Food hygiene for your business',url:'https://www.food.gov.uk/print/pdf/node/219',checkedAt:'2026-10-16',supports:'咖啡店與廚房角色的適當訓練及監督，未宣稱短訓即有全部專業能力。'},
  {id:'gb-web',title:'National Careers Service — Web developer',url:'https://nationalcareers.service.gov.uk/job-profiles/web-developer',checkedAt:'2026-10-16',supports:'網站開發可有不同教育及實作入職路線，未把任一課程固定寫成大學畢業。'},
  {id:'gb-print',title:'National Careers Service — Print operator',url:'https://nationalcareers.service.gov.uk/job-profiles/pre-press-operator',checkedAt:'2026-10-16',supports:'印刷與印前助理的實際職涯範圍；機具實作依雇主培訓，不自動授予技師身分。'},
  {id:'gb-gallery',title:'National Careers Service — Museum attendant',url:'https://nationalcareers.service.gov.uk/job-profiles/museum-assistant',checkedAt:'2026-10-16',supports:'訪客服務助理的入職、可能背景查核與工作內容；不等同修復或策展資格。'},
  {id:'gb-theatre',title:'National Theatre — Recruitment',url:'https://jobs.nationaltheatre.org.uk/',checkedAt:'2026-10-16',supports:'倫敦劇場有不同實際招聘職位；接待角色按場館要求入職與受訓，不推定藝術專業學位。'},
  {id:'gb-market',title:'GOV.UK — Market stall licence',url:'https://www.gov.uk/find-licences/market-stall-licence',checkedAt:'2026-10-16',supports:'市場或街頭營運須確認地方許可；攤務助手不自動取得個人營業許可。'},
  {id:'gb-hackney-market',title:'Hackney Council — Market trading licence',url:'https://www.hackney.gov.uk/business-and-licensing/markets-and-street-trading/market-trading-licence',checkedAt:'2026-10-16',supports:'倫敦自治市有各自市場許可及營運條件，不能以一區安排概括全部倫敦。'},
  {id:'gb-sole-trader',title:'GOV.UK — Set up as a sole trader',url:'https://www.gov.uk/set-up-as-sole-trader',checkedAt:'2026-10-16',supports:'衣物修補接案需確認適用登記及稅務安排；文案不固定報稅門檻或假造免稅權利。'},
  {id:'gb-tfl',title:'Transport for London — Using buses in London',url:'https://tfl.gov.uk/modes/buses/using-buses-in-london',checkedAt:'2026-10-16',supports:'倫敦巴士、站點、路線及服務狀態查詢的生活背景；不把即時票價寫進固定故事。'},
  {id:'gb-royalparks',title:'The Royal Parks — Kensington Gardens',url:'https://www.royalparks.org.uk/visit/parks/kensington-gardens',checkedAt:'2026-10-16',supports:'海德公園與肯辛頓花園周邊的倫敦步行與公共園景背景，不推定特殊活動或商業許可。'},
  {id:'gb-southbank',title:'Southbank Centre — Riverside Terrace',url:'https://www.southbankcentre.co.uk/venues/outdoor-spaces/riverside-terrace/',checkedAt:'2026-10-16',supports:'南岸中心河邊露臺的地理背景，未編造固定免費活動時間。'},
  {id:'gb-docklands',title:'London Museum — Docklands',url:'https://www.londonmuseum.org.uk/docklands/',checkedAt:'2026-10-16',supports:'港區博物館與倫敦河港歷史的參觀背景。'},
  {id:'gb-british-library',title:'British Library — Reader Pass',url:'https://www.bl.uk/visit/reader-pass',checkedAt:'2026-10-16',supports:'閱覽室使用有讀者證與申請條件，未把一般參觀等同已獲閱覽室權限。'}
 ]
};
export default COUNTRY_PACK_GB;
