import {encodeResult,newSeed} from './model.js';
import {validSocialCast} from './social-cast.js';
import {sharedMemories} from './shared-story.js';
import {lifeTiming,ageAtActive} from './timing-v5.js';
import {replayDecisionLife,decisionProfile} from './decision-engine-v7.js';
import {replayTaiwanLife,taiwanProfile} from './decision-engine-v8.js';
import {replayCountryLife,countryProfile} from './country-engine-v9.js';
import {hasCountryPack} from './country-runtime-v9.js';
const dynamicReplay=life=>life.version===9?replayCountryLife:life.version===8?replayTaiwanLife:replayDecisionLife;
export const LIFE_MS=2*3600000;
export const CHOICE_MS=90000;
const DAY=86400000,OFFSET=8*3600000;
export const taipeiDay=at=>new Date(at+OFFSET).toISOString().slice(0,10);
export function isOpenTime(at){return (at+OFFSET)%DAY>=6*3600000;}
export function activeBetween(from,to){
 if(to<=from)return 0;
 const first=Math.floor((from+OFFSET)/DAY),last=Math.floor((to+OFFSET)/DAY),overlap=(day)=>Math.max(0,Math.min(to,day*DAY-OFFSET+DAY)-Math.max(from,day*DAY-OFFSET+6*3600000));
 return first===last?overlap(first):overlap(first)+overlap(last)+Math.max(0,last-first-1)*18*3600000;
}
export function addActive(from,ms){
 let at=from,left=ms;for(let n=0;n<4;n++){const day=Math.floor((at+OFFSET)/DAY),open=day*DAY-OFFSET+6*3600000,end=day*DAY-OFFSET+DAY;at=Math.max(at,open);if(left<=end-at)return at+left;left-=end-at;at=end+6*3600000;}throw Error('Active duration exceeds preview bounds');
}
export function startStatus(starts,now){const used=(Array.isArray(starts)?starts:[]).filter(t=>Number.isSafeInteger(t)&&taipeiDay(t)===taipeiDay(now)).length;return {allowed:isOpenTime(now)&&used<4,night:!isOpenTime(now),used,limit:4};}
export function lifeSchedule(startedAt,life){
 if([7,8,9].includes(life?.version)){const v=dynamicReplay(life)({...life,auto:life.sources?.map(s=>s==='auto'?1:0)||life.auto},{activeMs:Math.min(LIFE_MS,activeBetween(startedAt,life.clockAt||startedAt)),autoFill:true});return v.scenes.length?v.scenes.map(s=>addActive(startedAt,s.openedMs)):[addActive(startedAt,LIFE_MS)];}
 return (lifeTiming(life)?.choiceOffsets||[1440000,3200000,5280000]).map(ms=>addActive(startedAt,ms));
}
export function validLife(raw){
 if(!raw||![3,4,5,7,8,9].includes(raw.version)||!Number.isSafeInteger(raw.startedAt)||raw.startedAt<1||raw.startedAt>4102444800000||!Number.isInteger(raw.orbit)||raw.orbit<0||raw.orbit>11||!(raw.zodiac===null||Number.isInteger(raw.zodiac)&&raw.zodiac>=0&&raw.zodiac<12)||!/^[a-f0-9]{8}$/.test(raw.seed)||!Array.isArray(raw.answers)||raw.answers.length>([7,8,9].includes(raw.version)?9:3)||raw.answers.some(a=>a!==0&&a!==1)||!Array.isArray(raw.sources)||raw.sources.length!==raw.answers.length||raw.sources.some(s=>!['manual','auto'].includes(s)))return null;
 if(raw.version===8&&raw.country!=='TW'||raw.version===9&&!hasCountryPack(raw.country))return null;
 const socialCast=raw.version>=4?validSocialCast(raw.socialCast):null,shared=raw.version>=4?sharedMemories(raw.sharedMemories):[];
 return {version:raw.version,...([8,9].includes(raw.version)?{country:raw.country}:{}),startedAt:raw.startedAt,orbit:raw.orbit,zodiac:raw.zodiac,seed:raw.seed,answers:[...raw.answers],sources:[...raw.sources],clockAt:Number.isSafeInteger(raw.clockAt)?Math.max(raw.startedAt,Math.min(addActive(raw.startedAt,LIFE_MS),raw.clockAt)):raw.startedAt,recentEventIds:Array.isArray(raw.recentEventIds)?raw.recentEventIds.filter(v=>typeof v==='string'&&/^[a-z0-9-]{1,32}$/.test(v)).slice(-96):[],eventIds:Array.isArray(raw.eventIds)?raw.eventIds.filter(v=>typeof v==='string'&&/^[a-z0-9-]{1,32}$/.test(v)).slice(0,32):[],...(socialCast?{socialCast}:{}),...(shared.length?{sharedMemories:shared}:{}),...(raw.version>=4&&Number.isInteger(raw.identityZodiac)&&raw.identityZodiac>=0&&raw.identityZodiac<12?{identityZodiac:raw.identityZodiac}:{})};
}
export function createLife({version=3,country,orbit,zodiac=null,seed=newSeed(),startedAt=Date.now()}){const d=validLife({version,country,orbit,zodiac,seed,startedAt,clockAt:startedAt,answers:[],sources:[]});if(!d||!isOpenTime(startedAt))throw Error('Invalid life or night start');return d;}
export function advanceLife(raw,now){
 const d=validLife(raw);if(!d||!Number.isSafeInteger(now)||now<d.startedAt)throw Error('Invalid life clock');
 if([7,8,9].includes(d.version)){
  now=Math.max(now,d.clockAt);const elapsed=Math.min(LIFE_MS,activeBetween(d.startedAt,now)),v=dynamicReplay(d)({...d,auto:d.sources.map(s=>s==='auto'?1:0)},{activeMs:elapsed,autoFill:true}),endAt=addActive(d.startedAt,LIFE_MS);
  d.answers=[...v.answers];d.sources=v.auto.map(a=>a?'auto':'manual');d.clockAt=Math.min(now,endAt);
  const index=d.answers.length,slots=v.scenes.map(s=>addActive(d.startedAt,s.openedMs)),available=!!v.pending&&!v.pending.answered&&isOpenTime(now),completed=now>=endAt&&v.completed;
  const night=!isOpenTime(now),nextAt=Math.max(addActive(d.startedAt,Math.min(LIFE_MS,v.nextAtMs??LIFE_MS)),night?addActive(now,0):0);
  return {draft:d,slots,endAt,completed,code:completed?encodeResult({...d,auto:v.auto}):null,index,night,available,nextAt};
 }
 now=Math.max(now,d.clockAt);const slots=lifeSchedule(d.startedAt,d),endAt=addActive(d.startedAt,LIFE_MS);let index=d.answers.length;
 while(index<3&&now>=addActive(slots[index],CHOICE_MS)){
  d.answers.push((parseInt(d.seed.slice(index%4*2,index%4*2+2),16)>>(index%7))&1);d.sources.push('auto');index++;
 }
 d.clockAt=Math.min(now,endAt);const completed=now>=endAt;
 return {draft:d,slots,endAt,completed,code:completed?encodeResult({...d,auto:d.sources.map(s=>s==='auto'?1:0)}):null,index,night:!isOpenTime(now),available:index<3&&isOpenTime(now)&&now>=slots[index]&&now<addActive(slots[index],CHOICE_MS),nextAt:index<3?Math.max(slots[index],isOpenTime(now)?now:addActive(now,0)):endAt};
}
export function chooseLife(raw,answer,now,index){
 const v=advanceLife(raw,now);if(![0,1].includes(answer)||v.completed||!v.available||v.index!==index)throw Error('事件尚未開始，或已經由時間帶往下一頁。');
 v.draft.answers.push(answer);v.draft.sources.push('manual');return advanceLife(v.draft,now);
}
export function lifeAge(raw,now){return raw.version===9?Math.floor(Math.min(LIFE_MS,activeBetween(raw.startedAt,now))/LIFE_MS*countryProfile(raw.seed,raw.orbit,raw.country).deathAge):raw.version===8?Math.floor(Math.min(LIFE_MS,activeBetween(raw.startedAt,now))/LIFE_MS*taiwanProfile(raw.seed,raw.orbit,raw.country).deathAge):raw.version===7?Math.floor(Math.min(LIFE_MS,activeBetween(raw.startedAt,now))/LIFE_MS*decisionProfile(raw.seed,raw.orbit).deathAge):raw.version===5?Math.floor(ageAtActive(raw,activeBetween(raw.startedAt,now))):Math.min(90,Math.floor(activeBetween(raw.startedAt,now)/LIFE_MS*90));}
export function lifeGrowth(raw){if([8,9].includes(raw.version)){const v=dynamicReplay(raw)({...raw,auto:raw.sources?.map(s=>s==='auto'?1:0)||raw.auto},{activeMs:Math.min(LIFE_MS,activeBetween(raw.startedAt,raw.clockAt||raw.startedAt))});return {home:0,away:0,label:v.state.careerLabel?`正在走過${v.state.careerLabel}的日常`:'在熟悉的街巷，慢慢找到自己的步調'};}const home=raw.answers.filter(a=>a===0).length,away=raw.answers.length-home;return {home,away,label:home===away?'仍在尋找自己的方向':home>away?'在守候中學會堅定':'在探索中學會勇敢'};}
