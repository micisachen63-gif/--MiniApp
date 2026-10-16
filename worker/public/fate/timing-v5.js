// Immutable v5 clock recipe. Only the persisted version and eight-hex seed are
// inputs: refreshes, devices, birthday settings and client fields cannot reroll it.
const DURATION=7200000,COUNT=240,MIN=18000,MAX=43000;
const cache=new Map();
const hash=s=>{let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function lifeTiming(life){
 // v6 deliberately reuses the immutable v5 clock, while its story is versioned separately.
 if(![5,6].includes(life?.version)||!/^[a-f0-9]{8}$/.test(life.seed||''))return null;
 const seed=life.seed;if(cache.has(seed))return cache.get(seed);
 const roll=tag=>hash('fate-clock-v5:'+seed+':'+tag);
 const deathAge=roll('short')%50===0?55+roll('short-age')%10:65+roll('age')%40;
 const first=17+roll('first')%6;
 const middle=clamp(Math.round(deathAge*.43)+roll('middle')%7-3,first+10,deathAge-18);
 const final=clamp(Math.round(deathAge*.76)+roll('final')%7-3,middle+10,deathAge-5);
 const choiceAges=[first,middle,final],choiceOffsets=choiceAges.map(age=>Math.ceil(age*DURATION/deathAge));
 const intervals=Array.from({length:COUNT},(_,i)=>MIN+roll('event-'+i)%(MAX-MIN+1));
 // Bounded water filling normalizes the random intervals to exactly two hours.
 // No final oversized interval, accumulated drift or timing chosen by a client.
 let difference=DURATION-intervals.reduce((a,b)=>a+b,0);
 while(difference){
  const free=intervals.map((n,i)=>i).filter(i=>difference>0?intervals[i]<MAX:intervals[i]>MIN);
  const step=Math.max(1,Math.floor(Math.abs(difference)/free.length)),direction=Math.sign(difference);
  for(const i of free){const delta=Math.min(step,Math.abs(difference),direction>0?MAX-intervals[i]:intervals[i]-MIN);intervals[i]+=direction*delta;difference-=direction*delta;if(!difference)break;}
 }
 const eventOffsets=[0];for(const interval of intervals)eventOffsets.push(eventOffsets.at(-1)+interval);
 const result=Object.freeze({version:5,deathAge,choiceAges:Object.freeze(choiceAges),choiceOffsets:Object.freeze(choiceOffsets),eventOffsets:Object.freeze(eventOffsets)});
 if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(seed,result);return result;
}
export function ageAtActive(life,ms){return clamp(Number.isFinite(ms)?ms:0,0,DURATION)*(lifeTiming(life)?.deathAge||90)/DURATION;}
export function activeAtVirtualAge(life,age){
 const p=lifeTiming(life),tick=clamp(age,0,90)/90*COUNT;if(!p)return tick/COUNT*DURATION;
 const i=Math.floor(tick);return i===COUNT?DURATION:p.eventOffsets[i]+(p.eventOffsets[i+1]-p.eventOffsets[i])*(tick-i);
}
export function narrativeTickAt(life,ms){
 const p=lifeTiming(life);if(!p)return clamp(Math.floor(ms/30000),0,COUNT);
 const at=clamp(Number.isFinite(ms)?ms:0,0,DURATION);let lo=0,hi=COUNT;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(p.eventOffsets[mid]<=at)lo=mid;else hi=mid-1;}return lo;
}
