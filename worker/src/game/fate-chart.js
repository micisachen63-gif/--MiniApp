import lunar from 'lunar-javascript';
import iztro from 'iztro';
import * as Astronomy from 'astronomy-engine';
import {normalizeBirth} from './fate-birth.js';
import {taipeiDay} from './time.js';
export const CHART_VERSION='fate-cultural-1';
const GAN='甲乙丙丁戊己庚辛壬癸',ZHI='子丑寅卯辰巳午未申酉戌亥',ELEMENT_GAN=[0,0,1,1,2,2,3,3,4,4],ELEMENT_ZHI=[4,2,0,0,2,1,1,2,3,3,2,4];
const norm=n=>(n%360+360)%360,rad=Math.PI/180;
const toSolar=(s,t='12:00')=>lunar.Solar.fromYmdHms(...s.split('-').map(Number),...t.split(':').map(Number),0);
const sexValue=b=>b.sex==='m'?1:0;
const tpeParts=at=>new Date(at+28800000).toISOString();
function pillars(b){
 const e=toSolar(b.date,b.time||'00:00').getLunar().getEightChar();e.setSect(2);
 const stamp=b.instant!==null?tpeParts(b.instant):null,j=stamp?toSolar(stamp.slice(0,10),stamp.slice(11,16)).getLunar().getEightChar():null;
 return [(j||e).getYear(),(j||e).getMonth(),e.getDay(),...(b.time?[e.getTime()]:[])];
}
export function ayanamsa(at){
 // Lahiri J2000 anchor from Astrodienst documentation, IAU mean precession in longitude.
 // Approximate mean model, not Swiss Ephemeris; precision limitations are recorded below.
 const T=(at-Date.UTC(2000,0,1,12))/86400000/36525;
 return 23+51/60+25.5324/3600+(5028.796195*T+1.1054348*T*T+.00007964*T*T*T)/3600;
}
export function sky(at){const date=new Date(at),a=ayanamsa(at),out={};for(const name of ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn'])out[name]=norm(Astronomy.Ecliptic(Astronomy.GeoVector(name,date,true)).elon-a);return out;}
export function ascendant(at,lat,lon){
 const T=(at-Date.UTC(2000,0,1,12))/86400000/36525,epsilon=(23.43929111-.013004167*T-.000000164*T*T)*rad,theta=(Astronomy.SiderealTime(new Date(at))*15+lon)*rad;
 return norm(Math.atan2(-Math.cos(theta),Math.sin(epsilon)*Math.tan(lat*rad)+Math.cos(epsilon)*Math.sin(theta))/rad+180-ayanamsa(at));
}
const daPeriods=[['Ketu',7],['Venus',20],['Sun',6],['Moon',10],['Mars',7],['Rahu',18],['Jupiter',16],['Saturn',19],['Mercury',17]],YEAR=365.2425*86400000;
export function dasha(birthAt,moon,now){let index=Math.floor(moon/(40/3))%9,start=birthAt-daPeriods[index][1]*(moon%(40/3))/(40/3)*YEAR,end=birthAt+daPeriods[index][1]*(1-(moon%(40/3))/(40/3))*YEAR;
 for(let n=0;n<30&&now>=end;n++){start=end;index=(index+1)%9;end+=daPeriods[index][1]*YEAR;}
 return {lord:daPeriods[index][0],start:Math.round(start),end:Math.round(end)};
}
export function natal(raw,now=Date.now()){
 const birth=normalizeBirth(raw,now),p=pillars(birth),counts=[0,0,0,0,0];for(const pair of p){counts[ELEMENT_GAN[GAN.indexOf(pair[0])]]++;counts[ELEMENT_ZHI[ZHI.indexOf(pair[1])]]++;}
 let purple=null,vedic=null;
 if(birth.complete){const h=Number(birth.time.slice(0,2)),a=iztro.astro.bySolar(birth.date,Math.floor((h+1)/2),birth.sex==='m'?'男':'女',true,'zh-TW');
  purple={soul:a.soul,body:a.body,palaces:a.palaces.map(p=>({name:p.name,branch:p.earthlyBranch,stem:p.heavenlyStem,stars:[...p.majorStars,...p.minorStars].map(s=>({name:s.name,type:s.type,mutagen:s.mutagen||null}))}))};
  const s=sky(birth.instant),asc=ascendant(birth.instant,birth.place.lat,birth.place.lon);vedic={planets:s,ascendant:asc,moonMansion:Math.floor(s.Moon/(40/3)),boundary:Object.values(s).some(v=>Math.min(v%30,30-v%30)<.08),model:'Lahiri mean approximation + Astronomy Engine 2.1.19; ~2 arcmin conservative tolerance'};
 }
 return {version:CHART_VERSION,birth,bazi:{pillars:p,dayElement:ELEMENT_GAN[GAN.indexOf(p[2][0])],counts},purple,vedic,coverage:birth.complete?'three-traditions':'inspiration',conventions:{bazi:'civil local day/hour, UTC-correct solar-term year/month; midnight day boundary',ziwei:'civil two-hour birth slot; lunar new year, leap-month split',vedic:'geocentric apparent planets, approximate Lahiri, whole-sign ascendant; no precision guarantee'}};
}
const palaceFor={health:'疾厄',work:'官祿',love:'夫妻'};
const relation=(a,b)=>(b-a+5)%5;
export function dailySignals(chart,day){
 const at=Date.parse(day+'T12:00:00+08:00'),e=toSolar(day).getLunar().getEightChar(),flow=[e.getYear(),e.getMonth(),e.getDay()],dayMaster=chart.bazi.dayElement;
 const bazi=flow.map(p=>({stem:relation(dayMaster,ELEMENT_GAN[GAN.indexOf(p[0])]),branch:relation(dayMaster,ELEMENT_ZHI[ZHI.indexOf(p[1])])}));
 let purple=null,vedic=null;
 if(chart.coverage==='three-traditions'){
  const b=chart.birth,a=iztro.astro.bySolar(b.date,Math.floor((Number(b.time.slice(0,2))+1)/2),b.sex==='m'?'男':'女',true,'zh-TW'),f=a.horoscope(day,6);
  purple=Object.fromEntries(Object.entries(palaceFor).map(([key,name])=>[key,['yearly','monthly','daily'].map(scope=>{const p=f.palace(name,scope),stars=p?[...p.majorStars,...p.minorStars]:[];return {palace:p?.name||null,index:f[scope].index,soft:stars.filter(s=>s.type==='soft').length,tough:stars.filter(s=>s.type==='tough').length,mutagen:f[scope].mutagen.map(name=>stars.some(s=>s.name===name))};})]));
  const s=sky(at),bSky=chart.vedic.planets;
  vedic={dasha:dasha(b.instant,bSky.Moon,at),houses:Object.fromEntries(Object.entries(s).map(([name,lon])=>[name,1+(Math.floor(lon/30)-Math.floor(chart.vedic.ascendant/30)+12)%12])),moonDistance:Math.min(norm(s.Moon-bSky.Moon),norm(bSky.Moon-s.Moon))};
 }
 const dominant=chart.bazi.counts.indexOf(Math.max(...chart.bazi.counts));
 return {day,flow,bazi,purple,vedic,dominant,dayStem:GAN.indexOf(flow[2][0]),dayBranch:ZHI.indexOf(flow[2][1]),coverage:chart.coverage};
}
export const currentDay=now=>taipeiDay(now);
