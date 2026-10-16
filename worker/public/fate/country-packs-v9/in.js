import {IN_CHILD, IN_YOUTH, IN_ANY} from './in-young.js';
import {IN_ADULT_A} from './in-adult-a.js';
import {IN_ADULT_B} from './in-adult-b.js';
import {IN_ADULT_C} from './in-adult-c.js';
import {IN_LATE} from './in-late.js';
import {IN_CAREERS} from './in-careers.js';
import {IN_SOCIAL, IN_SHARED} from './in-social.js';
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const COUNTRY_PACK_IN = freeze({
  id: 'IN', name: '印度', cityId: 'bengaluru', cityName: '班加羅爾',
  scope: 'Karnataka州Bengaluru Urban都市生活包；不代表全印度，不將一座城市等同所有語言、宗教或家庭。', currency: 'INR',
  families: [
    {id: 'tight', label: '每次採買都仔細安排的家', text: '你在班加羅爾的街區長大，家人把交通與日常支出寫得仔細，也努力為一次喜歡的早餐留出小小餘裕。', money: 2200},
    {id: 'ordinary', label: '把不同作息接在一起的家', text: '門邊放著出門要用的袋子，家人依各自時間來去，會在能相聚的普通晚餐裡，慢慢接上彼此今天的故事。', money: 15000},
    {id: 'small-business', label: '與一間小店共同過日子的家', text: '家裡的日程常跟著小店開關門移動，你看見貨款與真正能花的錢不一樣，也記得忙完之後一起整理的時光。', money: 42000},
    {id: 'comfortable', label: '能替探索留一些緩衝的家', text: '家人有條件替生活多做一點準備，你能試不同興趣，也逐漸學會問自己，想將這份選擇空間用在哪一條路上。', money: 135000},
  ],
  careers: IN_CAREERS,
  daily: {child: IN_CHILD, youth: IN_YOUTH, adult: [...IN_ADULT_A, ...IN_ADULT_B, ...IN_ADULT_C], late: IN_LATE, any: IN_ANY},
  education: {
    name: '班加羅爾的學校、技能課程與進修',
    description: '當地有不同學校體系，升學與課程須按實際機構要求核對；高中階段亦有PUC等途徑。你可以探索技能課程與後續學習，本支線只記完成的課程與實作，學位和專業資格另依正式條件。',
    startLabel: '核對語言、內容與時間，再開始學習',
    startOutcome: '你查清課程需要的基礎、授課語言、費用與交通，選了一段真正能開始的學習。第一份練習還生疏，問題卻開始變得具體。',
    pauseOutcome: '你先把目前生活安排穩住，將這段學習暫緩。課程資料與做過的練習留下，往後若想接續，仍知道可以從哪裡再問起。',
    completeLabel: '完成課程並整理實作成果',
    completeOutcome: '你完成約定的課程與實作，整理出能讓人看懂的成果。接下來不論繼續學習或申請工作，都多了一個真實起點。',
  },
  social: IN_SOCIAL, shared: IN_SHARED,
  sources: [
    {id: 'IN9-S1', title: 'Bengaluru Urban District：About District', url: 'https://bengaluruurban.nic.in/en/aboutdistrict/', checkedAt: '2026-10-16', supports: 'Karnataka州Bengaluru Urban行政及城市研究範圍；故事不將全國人口、宗教或地方規範套用每個家庭。'},
    {id: 'IN9-S2', title: 'Bengaluru Urban District：Education', url: 'https://bengaluruurban.nic.in/en/education/', checkedAt: '2026-10-16', supports: '地方初等與中等教育服務背景；學童片段不自動指定單一校制、私校、補習或相同授課語言。'},
    {id: 'IN9-S3', title: 'Bengaluru Urban District：Public Instruction Department', url: 'https://bengaluruurban.nic.in/en/department/public-instruction-department/', checkedAt: '2026-10-16', supports: '地方教育及Pre University正式窗口的存在；課程完成不等同獲得學位、正式教師資格或錄取。'},
    {id: 'IN9-S4', title: '印度教育部：National Education Policy 2020', url: 'https://www.education.gov.in/sites/upload_files/mhrd/files/NEP_Final_English_0.pdf', checkedAt: '2026-10-16', supports: '教育政策提出5+3+3+4課程階段與語言多樣性；只作政策背景，不宣稱所有學校已同步全面採用同一制度。'},
    {id: 'IN9-S5', title: 'BMRCL：Namma Metro官方', url: 'https://english.bmrc.co.in/', checkedAt: '2026-10-16', supports: '城市地鐵、路線圖、票務與乘車資訊查詢入口；不固定票價、已通車線段、時刻與個人優惠資格。'},
    {id: 'IN9-S6', title: 'Karnataka Tourism：Bengaluru', url: 'https://karnatakatourism.org/en/destinations/bengaluru', checkedAt: '2026-10-16', supports: '班加羅爾都市場景、KR市場、darshini及idli/dosa/filter coffee等可選飲食背景，並非全民共同習慣。'},
    {id: 'IN9-S7', title: 'Karnataka Tourism：Cubbon Park', url: 'https://karnatakatourism.org/en/attractions/cubbon-park/', checkedAt: '2026-10-16', supports: '卡本公園、中央圖書館建築與公共綠地背景；頁面不同段落開放時間不一致，故故事不硬寫時刻與費用。'},
    {id: 'IN9-S8', title: 'Karnataka Tourism：Lalbagh Botanical Garden', url: 'https://karnatakatourism.org/en/attractions/lalbagh-botanical-garden/', checkedAt: '2026-10-16', supports: '拉爾巴格植物園、植物牌與園藝背景；設施開放仍看當次公告，不在隨機月份硬套花展。'},
    {id: 'IN9-S9', title: 'Bengaluru Urban District：Kannada and Culture', url: 'https://bengaluruurban.nic.in/en/kannadaculture/', checkedAt: '2026-10-16', supports: 'Ranga Shankara、劇場、藝廊、音樂與公開文化活動背景；人物不自動獲授藝術學歷或特定文化信仰。'},
    {id: 'IN9-S10', title: 'Visvesvaraya Industrial and Technological Museum官方', url: 'https://vismuseum.gov.in/', checkedAt: '2026-10-16', supports: 'VITM屬NCSM/印度文化部，含引擎、電學、電子、太空等展示與科學活動；當次項目按官方資訊確認。'},
    {id: 'IN9-S11', title: 'BBMP資源頁：Waste Segregation', url: 'https://apps.bbmpgov.in/SWM/Home/Forms/PublicInformation.aspx?page=SEGREGATION', checkedAt: '2026-10-16', supports: '官方乾濕與其他廢棄物分類圖資訊背景；現行地方組織與收運依所在地最新規則核對，沒有套用舊單區日程。'},
    {id: 'IN9-S12', title: 'FSSAI：Hygiene Requirements', url: 'https://www.fssai.gov.in/inspection/hygiene-requirements', checkedAt: '2026-10-16', supports: '食品業登記/許可與Schedule4衛生要求研究入口；備製協作不被寫成自動取得食品安全資格或營業許可。'},
    {id: 'IN9-S13', title: 'FSSAI：Food Safety Training and Certification', url: 'https://fostac.fssai.gov.in/', checkedAt: '2026-10-16', supports: '食品處理相關培訓與正式課程入口；只核對單位實際要求，不因一般課程支線完成而授予監督或培訓師資格。'},
  ],
});
export default COUNTRY_PACK_IN;
