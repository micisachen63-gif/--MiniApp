// Public metadata is small; the authored country books are fetched only when
// needed. Registration is explicit so a missing/invalid book cannot start a life.
export const COUNTRY_METADATA_V9=Object.freeze({
 JP:{name:'日本',cityName:'東京',currency:'JPY'},KR:{name:'韓國',cityName:'首爾',currency:'KRW'},
 US:{name:'美國',cityName:'洛杉磯',currency:'USD'},CA:{name:'加拿大',cityName:'多倫多',currency:'CAD'},
 GB:{name:'英國',cityName:'倫敦',currency:'GBP'},DE:{name:'德國',cityName:'科隆',currency:'EUR'},
 FR:{name:'法國',cityName:'巴黎',currency:'EUR'},AU:{name:'澳洲',cityName:'雪梨',currency:'AUD'},
 IN:{name:'印度',cityName:'班加羅爾',currency:'INR'},
});
const loaded=new Map(),pending=new Map();
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export function registerCountryPack(pack){
 if(!pack||!Object.hasOwn(COUNTRY_METADATA_V9,pack.id))throw Error('Unsupported country book');
 if(loaded.has(pack.id)){if(loaded.get(pack.id)!==pack)throw Error('Country book already registered');return pack;}
 const check=(ok,message)=>{if(!ok)throw Error(pack.id+' country book: '+message);};
 check(pack.name===COUNTRY_METADATA_V9[pack.id].name&&pack.currency===COUNTRY_METADATA_V9[pack.id].currency,'identity mismatch');
 check(typeof pack.scope==='string'&&pack.scope.length>4&&typeof pack.cityName==='string','explicit geographic scope missing');
 check(Array.isArray(pack.families)&&pack.families.length===4&&pack.families.every(f=>typeof f.text==='string'&&Number.isSafeInteger(f.money)&&f.money>=0),'family origins');
 check(Array.isArray(pack.careers)&&pack.careers.length===12,'twelve career routes required');
 const careerIds=new Set();for(const c of pack.careers){check(/^[a-z0-9-]{1,20}$/.test(c.id)&&!careerIds.has(c.id),'career ID');careerIds.add(c.id);check([18,21].includes(c.minAge)&&typeof c.practice==='string'&&typeof c.entry==='string','career entry');check(c.chapters?.length===10&&c.chapters.every(t=>typeof t==='string'&&t.length>10),'ten authored career chapters');check(c.dilemmas?.length===4,'four career dilemmas');for(const d of c.dilemmas){check(/^[a-z0-9-]{1,24}$/.test(d.id)&&[1,2,3].includes(d.minStage)&&typeof d.title==='string'&&typeof d.text==='string','career dilemma');check(d.choices?.length===2&&d.choices.every(o=>typeof o.label==='string'&&typeof o.reason==='string'&&typeof o.outcome==='string'&&Object.entries(o.delta||{}).every(([k,v])=>['money','energy','bonds','reputation'].includes(k)&&Number.isSafeInteger(v))),'career choices');}}
 const all=[];for(const [phase,count]of Object.entries({child:120,youth:100,adult:720,late:420,any:140})){const rows=pack.daily?.[phase];check(Array.isArray(rows)&&rows.length===count&&rows.every(t=>typeof t==='string'&&t.length>10),'daily '+phase);all.push(...rows);}check(new Set(all).size===all.length,'repeated daily text');
 check(pack.social?.length===24&&pack.social.every(s=>/^[a-z0-9-]{1,16}$/.test(s.id)&&s.chapters?.length===6&&s.chapters.every(t=>typeof t==='string'&&t.includes('{name}'))),'authored relationship chains');
 check(new Set(pack.families.map(f=>f.id)).size===4&&pack.families.every(f=>typeof f.label==='string'),'family IDs and labels');
 const dilemmaIds=pack.careers.flatMap(c=>c.dilemmas.map(d=>d.id));check(new Set(dilemmaIds).size===48,'career dilemma IDs must be unique across routes');
 check(new Set(pack.social.map(s=>s.id)).size===24&&pack.social.every(s=>typeof s.role==='string'&&typeof s.requiresCareer==='boolean'&&(s.role!=='colleague'||s.requiresCareer)),'relationship IDs and work gates');
 const sharedIds=['moving','parcel','repair','market','umbrella','bookstore'];
 check(pack.shared?.length===6&&new Set(pack.shared.map(s=>s.id)).size===6&&pack.shared.every(s=>sharedIds.includes(s.id)&&typeof s.title==='string'&&typeof s.text==='string'&&s.choices?.length===2&&s.choices.every(o=>typeof o.label==='string'&&typeof o.outcome==='string')),'shared story set');
 check(pack.sources?.length>=3&&pack.sources.every(s=>typeof s.url==='string'&&s.url.startsWith('https://')),'official sources');
 check(['name','description','startLabel','startOutcome','pauseOutcome','completeLabel','completeOutcome'].every(k=>typeof pack.education?.[k]==='string'&&pack.education[k].length>0),'education pathway');
 freeze(pack);loaded.set(pack.id,pack);return pack;
}
export function getCountryPack(country){const pack=loaded.get(country);if(!pack)throw Error('Country book has not loaded: '+country);return pack;}
export function hasCountryPack(country){return loaded.has(country);}
const loaders={JP:()=>import('./country-packs-v9/jp.js'),KR:()=>import('./country-packs-v9/kr.js'),US:()=>import('./country-packs-v9/us.js'),CA:()=>import('./country-packs-v9/ca.js'),GB:()=>import('./country-packs-v9/gb.js'),DE:()=>import('./country-packs-v9/de.js'),FR:()=>import('./country-packs-v9/fr.js'),AU:()=>import('./country-packs-v9/au.js'),IN:()=>import('./country-packs-v9/in.js')};
export async function ensureCountryPack(country){if(loaded.has(country))return loaded.get(country);if(!Object.hasOwn(loaders,country))throw Error('Country book is not open');if(!pending.has(country))pending.set(country,loaders[country]().then(m=>registerCountryPack(m.default||m['COUNTRY_PACK_'+country])).catch(e=>{pending.delete(country);throw e;}));return pending.get(country);}
export function countryFromCode(code){return typeof code==='string'&&/^f9(?:jp|kr|us|ca|gb|de|fr|au|in)[0-9ab][0-9][01]{18}[0-9abx][a-f0-9]{8}$/.test(code)?code.slice(2,4).toUpperCase():null;}
export async function ensureCountryCodes(codes){return Promise.all([...new Set(codes.map(countryFromCode).filter(Boolean))].map(ensureCountryPack));}
