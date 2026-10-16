import {JP_CHILD, JP_YOUTH, JP_ANY} from './jp-young.js';
import {JP_ADULT_A} from './jp-adult-a.js';
import {JP_ADULT_B} from './jp-adult-b.js';
import {JP_ADULT_C} from './jp-adult-c.js';
import {JP_LATE} from './jp-late.js';
import {JP_CAREERS} from './jp-careers.js';
import {JP_SOCIAL, JP_SHARED} from './jp-social.js';
const frozen = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) frozen(entry);
    Object.freeze(value);
  }
  return value;
};
export const COUNTRY_PACK_JP = frozen({
  id: 'JP', name: '日本', cityId: 'tokyo', cityName: '東京',
  scope: '東京都23區都市生活；不代表全日本，不含多摩及島嶼生活包。', currency: 'JPY',
  families: [
    {id: 'tight', label: '仔細分配每一份生活費的家', text: '你在東京街區長大，家人常把採買清單重寫一遍，會留一點位置給真正想吃的小點心。', money: 35000},
    {id: 'ordinary', label: '靠日常安排穩住生活的家', text: '門邊放著交通卡與雨傘，家人依各自時段來去，也努力在普通晚餐裡留一段能說話的時間。', money: 180000},
    {id: 'small-business', label: '和一間小店一起過日子的家', text: '家裡的日程常跟著一間小店開關門移動，營收有起伏，熟客的招呼也成為你認識街區的方式。', money: 420000},
    {id: 'comfortable', label: '留得出學習與選擇空間的家', text: '家人能替生活留較多緩衝，你有機會試不同課程，也慢慢明白，能選擇仍需要自己想清楚。', money: 1200000},
  ],
  careers: JP_CAREERS,
  daily: {child: JP_CHILD, youth: JP_YOUTH, adult: [...JP_ADULT_A, ...JP_ADULT_B, ...JP_ADULT_C], late: JP_LATE, any: JP_ANY},
  education: {
    name: '東京的學校、專門課程與持續學習',
    description: '一般學制有六年小學與三年初中，之後有高中、高專及其他路線；高中後亦有專門學校、短大、大學等不同選擇。此支線完成的是核對條件後實際參與的課程，不把進修直接記成學位或專業資格。',
    startLabel: '先了解課程，再安排一段學習',
    startOutcome: '你核對課程內容、入學條件與自己能安排的時間，選了一段實際能開始的學習。先試做、提問，也慢慢認清想走的方向。',
    pauseOutcome: '你把目前能負擔的時間與費用看清楚，暫緩這段學習。留下資料與已完成的練習，往後仍能依實際條件再作安排。',
    completeLabel: '完成這段課程與實作',
    completeOutcome: '你完成約定的課程與實作，整理出能讓人檢查的成果。學會的內容開始用得上，接下來仍要看實際職務與條件一步步累積。',
  },
  social: JP_SOCIAL, shared: JP_SHARED,
  sources: [
    {id: 'JP9-S1', title: '文部科學省 School System', url: 'https://www.mext.go.jp/en/policy/education/overview/index.htm', checkedAt: '2026-10-16', supports: '6-3義務教育、3年普通高中、初中後高專與高中後其他高等教育途徑；此處未將課程完成等同學位。'},
    {id: 'JP9-S2', title: '東京都教育委員會：學校生活與必要資訊', url: 'https://www.metro.tokyo.lg.jp/documents/d/tosei/74_03', checkedAt: '2026-10-16', supports: '學校用品、室內鞋、學校聯絡與生活資訊可能依學校安排，兒童片段不假設所有學校同一清單。'},
    {id: 'JP9-S3', title: '東京Metro：車內手機與通話', url: 'https://ssl.tokyometro.jp/support/faq_answer?faqno=OpenFAQ-000346&lang=ja', checkedAt: '2026-10-16', supports: '車內通話與設備使用的乘車禮儀；未虛構列車時刻或全國禁令。'},
    {id: 'JP9-S4', title: '新宿區：資源與垃圾收集日期', url: 'https://www.city.shinjuku.lg.jp/seikatsu/file09_01_00001.html', checkedAt: '2026-10-16', supports: '清運按所在地町名及類別查詢；故事不將新宿一個地址的日程套到東京都23區。'},
    {id: 'JP9-S5', title: '東京觀光官方GO TOKYO：商店街', url: 'https://www.gotokyo.org/jp/see-and-do/culture/local-market/index.html', checkedAt: '2026-10-16', supports: '商店街、街區與日常採買背景，非全體居民必然有相同消費文化。'},
    {id: 'JP9-S6', title: '東京都：東京型錢湯', url: 'https://www.toshiseibi.metro.tokyo.lg.jp/ryokuchi_keikan/kekan_kese/keikan/machinami_09/miryokuhasshin/tokyo-sento', checkedAt: '2026-10-16', supports: '公共浴場文化與先清潔等設施使用禮儀；不宣稱人人固定參與，也不編造統一價格。'},
    {id: 'JP9-S7', title: '厚生勞動省：採用時勞動條件明示', url: 'https://www.mhlw.go.jp/bunya/roudoukijun/faq_kijyunhou_4.html', checkedAt: '2026-10-16', supports: '入職確認業務、工時、報酬及契約資訊；不把一般原則擴張為每項個案法律結論。'},
    {id: 'JP9-S8', title: '厚生勞動省：勞動條件明示規則更新', url: 'https://www.mhlw.go.jp/stf/newpage_32105.html', checkedAt: '2026-10-16', supports: '確認現行契約資訊與變更範圍的研究入口；故事不填虛構法定薪資。'},
    {id: 'JP9-S9', title: '東京都防災：日常備蓄', url: 'https://www.bousai.metro.tokyo.lg.jp/taisaku/topics/1031089/index.html', checkedAt: '2026-10-16', supports: '平日使用、補充備品與依情境確認安全，不將一種避難方式套用所有住宅。'},
    {id: 'JP9-S10', title: '日本郵便：郵遞區號與地址範例', url: 'https://www.post.japanpost.jp/kids/doc/template_atena.pdf', checkedAt: '2026-10-16', supports: '寄件時核對收寄件者地址、姓名及郵遞區號，未編造郵資或時效。'},
    {id: 'JP9-S11', title: '東京觀光官方GO TOKYO：交通資訊', url: 'https://www.gotokyo.org/jp/plan/getting-around/index.html', checkedAt: '2026-10-16', supports: '東京鐵路、地下鐵、巴士與IC等多種交通背景，具體路線與票種仍需當次核實。'},
    {id: 'JP9-S12', title: '厚生勞動省：地域包括支援中心', url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/kaigo_koureisha/chiiki-houkatsu/', checkedAt: '2026-10-16', supports: '家人照顧需求可向所在地正式諮詢；家庭協調者與普通行政助理不被授予專業照護資格。'},
  ],
});
export default COUNTRY_PACK_JP;
