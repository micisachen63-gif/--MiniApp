// Fixed, auditable reference edition. Never fetch exchange rates while replaying a life.
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const COMPARISON_EDITION='20261018-world1';
export const WORLD_REFERENCES=freeze({
 checkedAt:'2026-10-18',
 fx:{date:'2026-10-09',releaseDate:'2026-10-13',source:'https://www.federalreserve.gov/releases/h10/current/',title:'Federal Reserve H.10 · 2026-10-13 發布',
  // H.10 asterisk quotes are USD per foreign unit, all others foreign units per USD.
  quotes:{USD:{value:1,direction:'usd-per-unit'},TWD:{value:31.94,direction:'units-per-usd'},JPY:{value:158.34,direction:'units-per-usd'},KRW:{value:1342.13,direction:'units-per-usd'},CAD:{value:1.4269,direction:'units-per-usd'},GBP:{value:1.3229,direction:'usd-per-unit'},EUR:{value:1.1193,direction:'usd-per-unit'},AUD:{value:.6979,direction:'usd-per-unit'},INR:{value:96.73,direction:'units-per-usd'}}},
 wealth:{year:2024,published:2025,title:'UBS Global Wealth Report 2025 · p.22',source:'https://www.ubs.com/content/dam/assets/wm/static/noindex/wm-germany/2024/doodownload/GWR-2025-FullReport.pdf',scope:'56 個市場的成人樣本，涵蓋約 92% 全球財富；並非全世界人口普查。',
  bands:[{id:'under10k',min:0,max:10000,share:41.3,label:'未滿 US$1 萬'},{id:'10k100k',min:10000,max:100000,share:40.7,label:'US$1 萬–未滿 10 萬'},{id:'100k1m',min:100000,max:1000000,share:16.4,label:'US$10 萬–未滿 100 萬'},{id:'over1m',min:1000000,max:null,share:1.6,label:'US$100 萬以上'}]},
 longevity:{year:2023,years:73.3,title:'WHO · 全球出生時平均餘命',source:'https://www.who.int/data/gho/data/themes/mortality-and-global-health-estimates/ghe-life-expectancy-and-healthy-life-expectancy'},
 education:{year:2024,ageGroup:'25–34 歲',tertiaryShare:24,title:'UNESCO GEM Report 2026 · Access and equity',source:'https://www.unesco.org/reports/gem-report/en/2026-access-equity'}
});
