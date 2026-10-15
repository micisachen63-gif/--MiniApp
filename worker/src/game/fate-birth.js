import {PLACES} from '../../public/fate/places.js';
import {validBirth} from '../../public/fate/model.js';
import {GameError} from './classes.js';
const parts=(at,zone)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
export function localInstant(date,time,zone,fold='earlier'){
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number),wall=Date.UTC(y,m-1,d,h,min);
 let formatter;try{formatter=new Intl.DateTimeFormat('en',{timeZone:zone});formatter.format();}catch{throw new GameError('birth_zone','請選擇有效的出生地時區');}
 const candidates=new Set();
 for(const shift of [-2,-1,0,1,2]){const sample=wall+shift*86400000,p=parts(sample,zone),offset=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-sample,c=wall-offset,q=parts(c,zone);if(q.year===y&&q.month===m&&q.day===d&&q.hour===h&&q.minute===min)candidates.add(c);}
 const sorted=[...candidates].sort((a,b)=>a-b);if(!sorted.length)throw new GameError('birth_gap','這個出生時間位於夏令時間跳時空檔，請核對當地鐘錶時間');
 return {at:fold==='later'?sorted.at(-1):sorted[0],ambiguous:sorted.length>1};
}
export function normalizeBirth(raw,now=Date.now()){
 if(!raw||!validBirth(raw.date,{getFullYear:()=>9999,getMonth:()=>11,getDate:()=>31}))throw new GameError('birth_date','請填寫有效的出生年月日');
 const time=raw.time||null;if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new GameError('birth_time','出生時間請使用 00:00–23:59');
 const found=PLACES.find(p=>p[0]===raw.placeId);let place=null;
 if(found)place={id:found[0],label:found[1],zone:found[2],lat:found[3],lon:found[4]};
 else if(raw.placeId==='custom'){
  const lat=Number(raw.lat),lon=Number(raw.lon),zone=String(raw.zone||'');
  if([raw.lat,raw.lon].some(v=>!['number','string'].includes(typeof v)||typeof v==='string'&&!v.trim())||!Number.isFinite(lat)||Math.abs(lat)>65||!Number.isFinite(lon)||Math.abs(lon)>180||!zone)throw new GameError('birth_place','請填寫有效經緯度及時區；目前支援南北緯 65 度以內');
  try{new Intl.DateTimeFormat('en',{timeZone:zone}).format()}catch{throw new GameError('birth_zone','請填寫有效的 IANA 時區，例如 Asia/Taipei');}
  place={id:'custom',label:String(raw.placeLabel||'自訂出生地').trim().slice(0,50),zone,lat,lon};
 }
 const today=parts(now,place?.zone||'Asia/Taipei'),dateToday=`${today.year}-${String(today.month).padStart(2,'0')}-${String(today.day).padStart(2,'0')}`;if(raw.date>dateToday)throw new GameError('birth_future','出生日期不能晚於當地今天');
 const sex=['m','f'].includes(raw.sex)?raw.sex:null,fold=raw.fold==='later'?'later':'earlier';
 const instant=time&&place?localInstant(raw.date,time,place.zone,fold):null;
 if(instant?.at>now)throw new GameError('birth_future','出生時間不能晚於現在');
 return {date:raw.date,time,place,sex,fold,instant:instant?.at??null,ambiguous:instant?.ambiguous||false,complete:!!(time&&place&&sex)};
}
