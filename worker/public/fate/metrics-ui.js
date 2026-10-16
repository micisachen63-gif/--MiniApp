import {METRIC_REFERENCE,metricsForLife,metricPortrait} from './life-metrics-v1.js';

const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,finite(n)));
const number=n=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0}).format(Math.round(finite(n)));
const money=n=>{const value=finite(n),abs=Math.abs(value),unit=abs>=1e8?1e8:abs>=1e4?1e4:1,suffix=unit===1e8?'億':unit===1e4?'萬':'';return 'NT$ '+new Intl.NumberFormat('zh-TW',{maximumFractionDigits:unit===1?0:1}).format(value/unit)+suffix;};
const percent=n=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:1}).format(finite(n))+'%';
function element(doc,tag,cls,text){const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;}
function card(doc,kicker,title,value,unit){
 const box=element(doc,'section','fate-metric-card'),head=element(doc,'div','fate-metric-head');
 head.append(element(doc,'small','fate-metric-kicker',kicker),element(doc,'h3','',title));
 const reading=element(doc,'p','fate-metric-reading');reading.append(element(doc,'strong','',value));if(unit)reading.append(element(doc,'span','',unit));box.append(head,reading);return box;
}
function chart(doc,rows,label){
 const list=element(doc,'ul','fate-metric-chart');list.setAttribute('aria-label',label);
 for(const row of rows){
  const item=element(doc,'li','fate-metric-bar'+(row.selected?' is-current':'')),heading=element(doc,'div','fate-metric-bar-heading');
  if(row.selected)item.setAttribute('aria-current','true');
  const name=element(doc,'span','fate-metric-bar-label',row.label);if(row.selected)name.append(element(doc,'b','fate-metric-here','此世'));
  heading.append(name,element(doc,'span','fate-metric-bar-value',percent(row.value)));
  const track=element(doc,'span','fate-metric-track'),fill=element(doc,'span','fate-metric-fill');track.setAttribute('aria-hidden','true');fill.style.width=clamp(row.value,0,100)+'%';track.append(fill);item.append(heading,track);list.append(item);
 }
 return list;
}
function educationRank(value){const label=value?.label||'';if(/尚未|未完成|在學/.test(label))return -1;return /大專|大學|研究所/.test(label)?3:/高中|高職|高中職/.test(label)?2:/國中|初中/.test(label)?1:/國小|小學/.test(label)?0:-1;}
function childModel(mean){const lambda=Math.max(.01,finite(mean,2.25)),rows=[];let p=Math.exp(-lambda),used=0;for(let n=0;n<4;n++){if(n)p=p*lambda/n;rows.push({label:String(n)+' 名',value:p*100});used+=p;}rows.push({label:'4 名以上',value:Math.max(0,1-used)*100});return rows;}
function healthCard(doc,m){
 const health=Math.round(clamp(m.health,0,100)),state=health>=75?'身心有餘裕':health>=50?'步調尚穩':health>=25?'需要多些照料':'正在休養';
 const box=card(doc,'VITALITY','健康',String(health),'／100'),meter=element(doc,'div','fate-metric-health');
 meter.setAttribute('role','meter');meter.setAttribute('aria-label','這一世目前的健康');meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');meter.setAttribute('aria-valuenow',String(health));meter.setAttribute('aria-valuetext',`${health}／100，${state}`);
 const fill=element(doc,'span','fate-metric-health-fill');fill.style.width=health+'%';meter.append(fill);
 const scale=element(doc,'div','fate-metric-scale');for(const label of ['0','25','50','75','100'])scale.append(element(doc,'span','',label));
 box.append(element(doc,'p','fate-metric-status',state),meter,scale,element(doc,'p','fate-metric-note','此世身心狀態，隨人生際遇起伏。'));return box;
}
function wealthCard(doc,m){
 const wealth=finite(m.wealthUsd),twd=finite(m.wealthTwd),fx=finite(METRIC_REFERENCE.usdTwd,31.438),ranges=METRIC_REFERENCE.wealth||[],adult=finite(m.age)>=18;
 const box=card(doc,'FORTUNE','財富',money(twd),adult?'淨資產':'個人零用積蓄'),selected=Math.max(0,ranges.findIndex((r,i)=>wealth>=r.min&&(wealth<r.max||i===ranges.length-1))),rows=ranges.map((r,i)=>({label:i===0?`未滿 ${money(r.max*fx)}`:!Number.isFinite(r.max)?`${money(r.min*fx)} 以上`:`${money(r.min*fx)}–${money(r.max*fx).replace('NT$ ','')}`,value:r.share,selected:adult&&i===selected}));
 box.append(chart(doc,rows,adult?'UBS 財富報告樣本成人的四個淨資產級距；此世標記為目前資產所在級距':'UBS 成人淨資產級距背景資料；未成年個人積蓄不作成人級距對照'),element(doc,'p','fate-metric-note',adult?'條長為 UBS 報告樣本成人占比；「此世」是目前所在區間。':'這是自己的零用與積蓄，尚不與成人淨資產對照；下方成人樣本僅作背景。'));return box;
}
function educationCard(doc,m){
 const rank=educationRank(m.education),rows=(METRIC_REFERENCE.education||[]).map((r,i)=>({label:r.label,value:r.rate,selected:i===rank})),box=card(doc,'LEARNING','學歷',m.education?.label||'尚未入學','目前完成');
 box.append(element(doc,'p','fate-metric-status','教育完成率參照'),chart(doc,rows,'各教育階段的全球完成率參照；不同階段樣本，不是互斥的學歷人口分布'),element(doc,'p','fate-metric-note','各級完成率採不同年齡群體；不相加，也不代表學歷排名。'));return box;
}
function childrenCard(doc,m){
 const children=Math.max(0,Math.floor(finite(m.children))),selected=Math.min(4,children),adult=finite(m.age)>=18,rows=childModel(METRIC_REFERENCE.fertility).map((r,i)=>({...r,selected:adult&&i===selected})),box=card(doc,'FAMILY','子女',number(children),'名 · 目前');
 box.append(element(doc,'p','fate-metric-status',adult?'家庭規模 · 模型參照':'尚未到家庭階段'),chart(doc,rows,adult?'以全球總生育率為均值的簡化 Poisson 模型；不是實際家庭人數調查':'家庭規模模型背景資料；未成年不作家庭規模區間對照'),element(doc,'p','fate-metric-note',adult?`以總生育率 ${METRIC_REFERENCE.fertility} 作均值的簡化模型，並非真實家庭分布。`:'先慢慢長大。下方僅為家庭規模的簡化模型背景，此刻不作區間對照。'));return box;
}
function sources(doc,open){
 const details=element(doc,'details','fate-metric-sources');details.open=open;details.append(element(doc,'summary','','數據與這一世的刻度'));
 details.append(element(doc,'p','',`現實統計是故事的機率背景；此世的人物與際遇屬虛構。財富以 1 美元＝NT$ ${METRIC_REFERENCE.usdTwd} 換算，匯率日期 ${METRIC_REFERENCE.fxDate}。`));
 for(const source of METRIC_REFERENCE.sources||[]){const row=element(doc,'p','fate-metric-source');let url;try{url=new URL(source.url);}catch{}if(url?.protocol==='https:'){const link=element(doc,'a','',source.label||url.hostname);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';row.append(link);}else row.append(element(doc,'span','',source.label||'參考資料'));if(source.year)row.append(element(doc,'span','',` · ${source.year}`));if(source.detail)row.append(element(doc,'small','',source.detail));details.append(row);}
 return details;
}
function portraitCards(doc,portrait){
 const grid=element(doc,'div','fate-metric-portraits');
 for(const item of portrait.cards||[]){
  const box=element(doc,'article','fate-metric-portrait');box.dataset.metric=String(item.key||'');
  box.append(element(doc,'h3','fate-metric-portrait-title',item.title||''),element(doc,'p','fate-metric-portrait-status',item.status||''),element(doc,'p','fate-metric-portrait-detail',item.detail||''));grid.append(box);
 }
 return grid;
}

// Legacy lives have no historical education/family facts: leave their caller-owned UI intact.
export function renderMetrics(target,life,rows=[],age=0,{doc=document}={}){
 if(!target||life?.version!==6)return false;
 const metrics=metricsForLife(life,rows,age),portrait=metricPortrait(metrics),signature=JSON.stringify({portrait,birth:metrics.birth?.name,age:Math.floor(Math.max(0,finite(metrics.age,age))),health:Math.round(clamp(metrics.health,0,100)),education:metrics.education?.label,wealth:money(metrics.wealthTwd),wealthRange:(METRIC_REFERENCE.wealth||[]).findIndex((r,i,a)=>finite(metrics.wealthUsd)>=r.min&&(finite(metrics.wealthUsd)<r.max||i===a.length-1)),children:Math.max(0,Math.floor(finite(metrics.children)))});
 if(target.dataset.signature===signature)return true;
 const open=target.querySelector('.fate-metric-sources')?.open===true,chartOpen=target.querySelector('.fate-metric-comparison')?.open===true,section=element(doc,'section','fate-metrics'),head=element(doc,'div','fate-metrics-heading');
 head.append(element(doc,'small','fate-metric-kicker','THE MEASURE OF A LIFE'),element(doc,'h2','','此生的模樣'));
 if(metrics.birth?.name)head.append(element(doc,'p','fate-metrics-origin',`${metrics.birth.name} · ${Math.floor(Math.max(0,finite(metrics.age,age)))} 歲的人生刻度`));
 section.append(head,portraitCards(doc,portrait));
 if(portrait.question)section.append(element(doc,'p','fate-metric-question',portrait.question));
 const comparison=element(doc,'details','fate-metric-comparison');comparison.open=chartOpen;comparison.append(element(doc,'summary','','看看這一世落在哪裡'));
 if(portrait.comparison&&finite(metrics.age)>=18)comparison.append(element(doc,'p','fate-metric-living',portrait.comparison));
 const grid=element(doc,'div','fate-metrics-grid');grid.append(healthCard(doc,metrics),educationCard(doc,metrics),wealthCard(doc,metrics),childrenCard(doc,metrics));
 comparison.append(grid,sources(doc,open));section.append(comparison);target.replaceChildren(section);target.dataset.signature=signature;return true;
}

const LEGACY_INDICATORS=[['energy','健康'],['knowledge','學習'],['wealth','家計'],['bonds','情誼'],['reputation','聲望']];
// Old stories store narrative scores, not the structured facts introduced in v6.
// Giving them presentable portraits must never invent diplomas, money or children.
export function renderLegacyMetrics(target,life,rows=[],age=0,{doc=document}={}){
 if(!target||![1,2,3,4,5].includes(life?.version))return false;
 const state=[...rows].reverse().find(row=>(!Number.isFinite(row.age)||row.age<=age)&&row.state)?.state||{},scores=Object.fromEntries(LEGACY_INDICATORS.map(([key])=>[key,Number.isFinite(state[key])?Math.round(clamp(state[key],0,100)):null])),signature='legacy:'+JSON.stringify(scores);
 if(target.dataset.signature===signature)return true;
 const open=target.querySelector('.fate-metric-comparison')?.open===true,health=scores.energy,wealth=scores.wealth,section=element(doc,'section','fate-metrics'),head=element(doc,'div','fate-metrics-heading');
 head.append(element(doc,'small','fate-metric-kicker','THE MEASURE OF A LIFE'),element(doc,'h2','','此生的模樣'));
 const cards=[
  {key:'health',title:'健康',status:health===null?'聽見身體，還沒說完的話':health>=75?'還有力氣，走想走的路':health>=50?'步調慢一點，也能走遠':'這一站，先留些時間休息',detail:health===null?'這冊沒有留下健康刻度，沿途的心情仍在故事裡。':health>=75?'忙完生活，也還留得下一點自己的時間。':health>=50?'把步調走穩，讓明天也有繼續前行的餘裕。':'有些事情可以晚一點，照顧自己值得排在前面。'},
  {key:'education',title:'學歷',status:'這冊未記錄學歷',detail:'一路所學留在故事裡，這一冊沒有文憑紀錄。'},
  {key:'wealth',title:'財富',status:wealth===null?'生活的底氣，藏在故事裡':wealth>=75?'有了能說「不」的餘裕':wealth>=50?'終於，攢下一點生活底氣':wealth>=25?'每一步，都要算仔細':'先把眼前的日子安頓好',detail:wealth===null?'這冊沒有留下家計刻度，仍能回望一路的得失。':wealth>=75?'有些選擇，終於不用只為了眼前的開銷。':wealth>=50?'生活仍有起伏，但慢慢有了自己的步調。':'日常需要仔細打理，也有值得為自己留下的小事。'},
  {key:'children',title:'子女',status:'這冊未記錄家庭',detail:'這一冊沒有留下子女資料，牽掛仍能從故事裡讀見。'}
 ];
 section.append(head,portraitCards(doc,{cards}));
 const comparison=element(doc,'details','fate-metric-comparison fate-metric-legacy');comparison.open=open;comparison.append(element(doc,'summary','','看看這一世落在哪裡'));
 const grid=element(doc,'div','fate-legacy-indicators');grid.setAttribute('aria-label','此世留存的五項故事指數');
 for(const [key,label]of LEGACY_INDICATORS){
  const reading=scores[key],row=element(doc,'div','fate-legacy-indicator'),heading=element(doc,'div','fate-metric-bar-heading');heading.append(element(doc,'span','',label),element(doc,'span','fate-metric-bar-value',reading===null?'未記錄':String(reading)+'／100'));
  const track=element(doc,'div','fate-metric-health');
  if(reading===null)track.setAttribute('aria-hidden','true');else{track.setAttribute('role','meter');track.setAttribute('aria-label',label+'故事指數');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(reading));track.setAttribute('aria-valuetext',String(reading)+'／100，故事指數');const fill=element(doc,'span','fate-metric-health-fill');fill.style.width=reading+'%';track.append(fill);}
  row.append(heading,track);grid.append(row);
 }
 comparison.append(grid,element(doc,'p','fate-metric-note','舊旅章僅留存故事指數，學習不等於學歷，家計也不是實際資產。新一世起，才會逐步記錄學歷、子女與出生背景。'));section.append(comparison);target.replaceChildren(section);target.dataset.signature=signature;return true;
}
