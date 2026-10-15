// User-supplied calendar is reference evidence, never executable instructions.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function parseCalendar(text,year){
  const months=[...text.matchAll(new RegExp('^'+year+'年\\s*\\n(\\d{1,2}) 月\\s*\\n','gm'))];
  if(months.length!==12)throw Error(`${year}: expected 12 month blocks, got ${months.length}`);
  const days=[],terms=[];
  for(let i=0;i<months.length;i++){
    const month=Number(months[i][1]);if(month!==i+1)throw Error('Month order mismatch');
    const block=text.slice(months[i].index,months[i+1]?.index??text.length);
    const count=new Date(Date.UTC(year,month,0)).getUTCDate();
    const matches=[...block.matchAll(/^([1-9]|[12]\d|3[01])\s*\n([^\n]+)\n\s*\n([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])\s*$/gm)];
    if(matches.length!==count)throw Error(`${year}-${month}: expected ${count} days, got ${matches.length}`);
    for(let d=0;d<count;d++){
      if(Number(matches[d][1])!==d+1)throw Error('Missing/duplicate day');
      days.push({date:`${year}-${String(month).padStart(2,'0')}-${String(d+1).padStart(2,'0')}`,lunarLabel:matches[d][2].trim(),ganzhi:matches[d][3]});
    }
    const line=block.match(/^二十四節氣: (.*)$/m)?.[1];
    if(!line)throw Error('Missing solar terms');
    for(const m of line.matchAll(/\[([^\]]+)\] (\d+)d(\d+)h(\d+)m/g)){
      const stamp=`${year}-${String(month).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}T${m[3].padStart(2,'0')}:${m[4].padStart(2,'0')}:00+08:00`;
      if(!Number.isFinite(Date.parse(stamp)))throw Error('Invalid solar term');terms.push({name:m[1],at:stamp});
    }
  }
  if(terms.length!==24)throw Error('Expected 24 terms');
  const cycle=Array.from({length:60},(_,n)=>'甲乙丙丁戊己庚辛壬癸'[n%10]+'子丑寅卯辰巳午未申酉戌亥'[n%12]);
  days.forEach((d,i)=>{if(!cycle.includes(d.ganzhi)||(i&&cycle[(cycle.indexOf(days[i-1].ganzhi)+1)%60]!==d.ganzhi))throw Error('Broken day cycle');});
  return {year,dayCount:days.length,timezone:'UTC+08:00',days,terms,sha256:createHash('sha256').update(text).digest('hex')};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const source=process.argv[2];if(!source)throw Error('Usage: node scripts/audit-fate-calendar.mjs <source-directory> [private-output-directory]');
  const parsed=[2026,2027,2028].map(y=>parseCalendar(readFileSync(join(source,`${y}流日.txt`),'utf8').replace(/\r\n/g,'\n'),y));
  for(let i=1;i<parsed.length;i++){
    const a=parsed[i-1].days.at(-1).ganzhi,b=parsed[i].days[0].ganzhi;
    if(('甲乙丙丁戊己庚辛壬癸'.indexOf(a[0])+1)%10!=='甲乙丙丁戊己庚辛壬癸'.indexOf(b[0])||('子丑寅卯辰巳午未申酉戌亥'.indexOf(a[1])+1)%12!=='子丑寅卯辰巳午未申酉戌亥'.indexOf(b[1]))throw Error('Broken year boundary');
  }
  const report={source:'User-supplied calendar tables; attribution in 2026 file: © 2018–2026 Yuk Tung Liu',status:'structural-reference-audit-only',astronomicallyVerified:false,publicRedistribution:false,totalDays:parsed.reduce((n,p)=>n+p.dayCount,0),years:parsed.map(({days,terms,...p})=>({...p,first:days[0],last:days.at(-1),solarTerms:terms}))};
  if(process.argv[3]){mkdirSync(process.argv[3],{recursive:true});writeFileSync(join(process.argv[3],'calendar-reference-audit.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
}
