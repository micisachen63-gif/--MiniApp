import {KR_CHILD, KR_YOUTH, KR_ANY} from './kr-young.js';
import {KR_ADULT_A} from './kr-adult-a.js';
import {KR_ADULT_B} from './kr-adult-b.js';
import {KR_ADULT_C} from './kr-adult-c.js';
import {KR_LATE} from './kr-late.js';
import {KR_CAREERS} from './kr-careers.js';
import {KR_SOCIAL, KR_SHARED} from './kr-social.js';
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const COUNTRY_PACK_KR = freeze({
  id: 'KR', name: '韓國', cityId: 'seoul', cityName: '首爾',
  scope: '首爾特別市25區都市生活；不代表全韓國，不含仁川或京畿道生活包。', currency: 'KRW',
  families: [
    {id: 'tight', label: '採買總要多想一次的家', text: '你在首爾普通街區長大，家人先算必要支出，也會把剩下的一點餘裕留給你喜歡的點心。', money: 90000},
    {id: 'ordinary', label: '努力讓日程接得上的家', text: '門邊的傘與交通卡各有位置，家人依不同時段來去，仍想在一頓平常晚餐裡問問彼此今天如何。', money: 550000},
    {id: 'small-business', label: '與街區小店相伴的家', text: '家裡的安排常跟著小店開關門變動，忙碌時要一起想辦法，安靜時也會談下一次該怎麼準備。', money: 1400000},
    {id: 'comfortable', label: '能為嘗試多留一點餘裕的家', text: '家人能留較多生活緩衝，你有機會試不同興趣，也逐漸明白選擇不只關於能不能，更關於想成為什麼樣的人。', money: 4200000},
  ],
  careers: KR_CAREERS,
  daily: {child: KR_CHILD, youth: KR_YOUTH, adult: [...KR_ADULT_A, ...KR_ADULT_B, ...KR_ADULT_C], late: KR_LATE, any: KR_ANY},
  education: {
    name: '首爾的學校、職業課程與持續學習',
    description: '一般學制有六年小學、三年初中與三年高中，之後可按條件走大學、專科或其他學習途徑。此支線記錄實際完成的課程與實作，學位與專業資格仍依各自正式要求取得。',
    startLabel: '核對課程，再開始一段練習',
    startOutcome: '你查清課程內容、參與條件與時間安排，選了真正能開始的一段學習。第一份練習還生疏，問題也開始變得具體。',
    pauseOutcome: '你先把目前的時間與費用安排好，將課程暫緩。資料與做過的練習留下，往後想接續時，仍知道可以從哪裡開始。',
    completeLabel: '完成這段課程與實作',
    completeOutcome: '你完成課程與實作，整理出能讓人看懂的成果。下一段學習或工作，終於有了可以拿出來討論的起點。',
  },
  social: KR_SOCIAL, shared: KR_SHARED,
  sources: [
    {id: 'KR9-S1', title: '韓國教育部：Education System Overview', url: 'https://english.moe.go.kr/sub/infoRenewal.do?m=0301&page=0301&s=english', checkedAt: '2026-10-16', supports: '6-3-3-4一般學制、專科等路線，小學與初中義務教育；首學期三月，不沿用日本四月敘事。'},
    {id: 'KR9-S2', title: '首爾市：地鐵與城市交通入口', url: 'https://english.seoul.go.kr/service/movement/public-transportation/2-subway/', checkedAt: '2026-10-16', supports: '地鐵地圖、無障礙與站內設施等官方查詢入口；不編造固定站口、時刻或個人優惠資格。'},
    {id: 'KR9-S3', title: '首爾市：巴士模式', url: 'https://english.seoul.go.kr/policy/transportation/modes-of-transport/bus/', checkedAt: '2026-10-16', supports: '城市巴士類型、路線與轉乘背景；劇情只使用核對方向、站牌與當次公告等日常行為。'},
    {id: 'KR9-S4', title: '首爾TOPIS：公共交通資訊', url: 'https://topis.seoul.go.kr/eng/page/transInfo_1_1.jsp', checkedAt: '2026-10-16', supports: '交通卡、路線與乘車資訊來源，價格及個別政策未作真實收益或固定票價設定。'},
    {id: 'KR9-S5', title: '首爾觀光官方：望遠市場', url: 'https://english.visitseoul.net/shopping/Mangwon%20Market/ENP037950', checkedAt: '2026-10-16', supports: '麻浦區望遠市場及小吃採買場景；頁面2026-09-10更新，未硬編營業時間與車站出口。'},
    {id: 'KR9-S6', title: '首爾觀光官方：首爾林', url: 'https://english.visitseoul.net/nature/seoul-forest/ENP001838', checkedAt: '2026-10-16', supports: '城東區首爾林的公園空間背景；步行路線依當次開放資訊，不假定所有人必然進行相同活動。'},
    {id: 'KR9-S7', title: '韓國雇用勞動部：書面勞動契約FAQ', url: 'https://www.moel.go.kr/faq/faqView.do?seqRepeat=169', checkedAt: '2026-10-16', supports: '雇用時確認工資、工時、休息、工作與契約內容；本包劇情金額不是實際法定薪資。'},
    {id: 'KR9-S8', title: '韓國雇用勞動部：標準勞動契約與重要條件', url: 'https://www.moel.go.kr/mainpop2.do', checkedAt: '2026-10-16', supports: '勞動條件書面確認與現行官方查詢入口；不推導所有職涯都有同一工時、報酬或資格。'},
    {id: 'KR9-S9', title: '首爾市：生活廢棄物減量行動', url: 'https://english.seoul.go.kr/seoul-effectively-reduces-daily-household-waste-by-29-tons-with-waste-reduction-campaign/', checkedAt: '2026-10-16', supports: '2026-05-15市府資料顯示各區減廢與分類背景；清運具體方式按所在區資訊確認，不通用化單區日程。'},
    {id: 'KR9-S10', title: '首爾市：多語廚餘分類說明發布', url: 'https://english.seoul.go.kr/seoul-distributes-outline-of-food-waste-disposal-standard-in-ten-languages-for-foreign-residents/', checkedAt: '2026-10-16', supports: '2020歷史資料用於廚餘並非所有食物殘渣的背景；目前操作一律核對現場與所在區最新標示。'},
  ],
});
export default COUNTRY_PACK_KR;
