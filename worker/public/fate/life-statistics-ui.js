import {WORLD_REFERENCES} from './world-comparison-data.js';
import {formatTwd,convertMoney} from './life-comparison.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function source(parent,ref){const link=el('a','fate-reference-link',ref.title);link.href=ref.source;link.target='_blank';link.rel='noopener noreferrer';parent.append(link);}
function bar(parent,{label,value,max=100,copy,selected=false}){
 const row=el('div','fate-stat-row'+(selected?' is-current':'')),head=el('div','fate-stat-row-head');
 head.append(el('span','',label),el('strong','',copy));row.append(head);
 const track=el('div','fate-stat-track'),fill=el('span','fate-stat-fill');fill.style.width=Math.max(0,Math.min(100,value/max*100))+'%';track.setAttribute('aria-hidden','true');track.append(fill);row.append(track);
 if(selected)row.append(el('small','fate-stat-current','✦ 此世落在這個區間'));parent.append(row);
}
function section(body,title,text){const box=el('section','fate-stat-section');box.append(el('h4','',title));if(text)box.append(el('p','fate-stat-copy',text));body.append(box);return box;}
export function renderComparisonDetail(parent){
 const details=el('details','fate-status-ledger fate-statistics');details.append(el('summary','','翻開統計圖表與台幣換算'),el('div','fate-stat-body'));parent.append(details);return details;
}
export function paintComparisonDetail(details,model){
 const {cash,debt,net,age,completed,band}=model,body=details.querySelector('.fate-stat-body');body.replaceChildren();
 body.append(el('p','fate-stat-intro','同一段人生，換個尺度看。以下比較此世故事與公開統計，資料年份與比較範圍都留在圖表旁。'));
 const ledger=section(body,'把手邊的餘裕，換成台幣'),dl=el('dl');
 for(const[label,value]of [['帳上資產',cash],['待還債務',debt],['帳面淨餘額',net]]){
  const row=el('div'),native=value?value.currency+' '+Math.round(value.native).toLocaleString('zh-TW'):'尚無金額資料';
  row.append(el('dt','',label),el('dd','',value?.currency==='TWD'?formatTwd(value.twd):native+' ≈ '+formatTwd(value?.twd)));dl.append(row);
 }ledger.append(dl,el('p','fate-stat-method',`匯率日 ${WORLD_REFERENCES.fx.date}，經美元交叉換算；固定參考匯率，不是即時銀行成交價。未調整通膨或購買力。`));source(ledger,WORLD_REFERENCES.fx);
 const wealth=section(body,'這筆餘裕，放在國際財富圖裡',age<20?'此世未滿 20 歲，先看分布，暫不把成長中的生活帳排進成人財富區間。':band?.id==='negative'?'此世帳面負債大於資產；公開分組未單獨提供負淨值比例，因此不替它編造排名。':band?`帳面模擬淨值落在「${band.label}」；該組約占樣本成人 ${band.share}%。`:'目前沒有足夠資料定位區間。');
 for(const b of WORLD_REFERENCES.wealth.bands)bar(wealth,{label:b.label,value:b.share,copy:b.share+'%',selected:band?.id===b.id});
 const threshold=convertMoney(10000,'USD');wealth.append(el('p','fate-stat-method',`US$1 萬約為 ${formatTwd(threshold.twd)}；橫條長度代表各組成人占比，不是你的百分位。`),el('p','fate-stat-method',`2024 年資料。${WORLD_REFERENCES.wealth.scope}此世以帳上資產減債務模擬淨值；未建模的房產與其他資產不會憑空估價。僅作故事參照，不表示你的現實財富名次。`));source(wealth,WORLD_REFERENCES.wealth);
 const longevity=section(body,completed?'一生的長度，與世界相望':'走到這個年紀，故事還沒寫完',completed?`這一世走過 ${age} 歲。相較 WHO 2023 年全球出生時平均餘命 ${WORLD_REFERENCES.longevity.years} 歲，${model.lifespan.difference>=0?'多':'少'}了約 ${Math.abs(model.lifespan.difference)} 年。`:`此世正走到 ${age} 歲。結局尚未到來，不預告壽命，也不提前排死亡年齡的名次。`);
 bar(longevity,{label:completed?'此世終年':'此世目前年齡',value:age,max:120,copy:age+' 歲'});
 bar(longevity,{label:'全球出生時平均餘命 · 2023',value:WORLD_REFERENCES.longevity.years,max:120,copy:WORLD_REFERENCES.longevity.years+' 歲'});
 longevity.append(el('p','fate-stat-method','平均餘命是當期人口死亡率的統計摘要，不是個人死亡年齡排名或健康診斷。生活卡的體力只反映故事狀態。'));source(longevity,WORLD_REFERENCES.longevity);
 const education=section(body,'學歷之外，也有走過的路',`此世紀錄：${model.education.label}。`);
 bar(education,{label:'全球 25–34 歲人口完成高等教育',value:24,copy:'24%'});bar(education,{label:'其餘同齡人口',value:76,copy:'76%'});
 education.append(el('p','fate-stat-method','UNESCO 2024 年資料、2026 年報告。這是特定年齡群的教育完成比例；進修課程、工作技能與見識分數不會換成大學學位，也不推算你的學歷百分位。'));source(education,WORLD_REFERENCES.education);
 const family=section(body,'家，不只有一種樣子',model.children?`這一世已寫下養育 ${model.children} 名孩子的篇章。`:'這一段尚未寫下養育孩子的篇章。');
 const familyTrack=el('div','fate-family-scale');for(const label of ['尚無子女','1 名','2 名','3 名以上']){const n=el('span','',label);if(['尚無子女','1 名','2 名','3 名以上'].indexOf(label)===Math.min(3,model.children))n.className='is-current';familyTrack.append(n);}family.append(familyTrack,el('p','fate-stat-method','這一格呈現故事事實；未使用總生育率替個人子女數編造百分位。沒有孩子不代表關係或人生價值較低。'));
 body.append(el('p','fate-stat-footer',`真實資料參照 · 查核 ${WORLD_REFERENCES.checkedAt}。此世金額與玩家現實財務、遊戲金幣分開。`));
}
