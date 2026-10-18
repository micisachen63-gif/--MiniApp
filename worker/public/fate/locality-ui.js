import {taiwanProfile,replayTaiwanLife} from './decision-engine-v8.js';
import {countryProfile,replayCountryLife} from './country-engine-v9.js';
import {COUNTRY_METADATA_V9} from './country-runtime-v9.js';
import {activeBetween,LIFE_MS,lifeAge} from './life.js';
import {compareLifeState,resultComparison,formatTwd} from './life-comparison.js';
import {renderComparisonDetail,paintComparisonDetail} from './life-statistics-ui.js';

const developing=[['JP','日本'],['KR','韓國'],['US','美國'],['CA','加拿大'],['GB','英國'],['DE','德國'],['FR','法國'],['AU','澳洲'],['IN','印度']];
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}

// This is the fictional life's setting, independent of private birth profiles.
export function renderLifeCountry(p,{value='TW',onChange=()=>{}}={}){
 const box=el('section','fate-life-country');box.setAttribute('aria-label','這一世的出生地');
 const label=el('label','fate-field','這一世，從哪裡開始？');label.htmlFor='fate-life-country';
 const select=el('select','fate-date');select.id='fate-life-country';select.setAttribute('aria-label','這一世的出生地');
 const taiwan=el('option','','台灣 · 台北／新北');taiwan.value='TW';select.append(taiwan);
 for(const[code,name]of developing){const option=el('option','',`${name} · ${COUNTRY_METADATA_V9[code].cityName}`);option.value=code;option.disabled=false;select.append(option);}
 select.value=value;select.onchange=()=>onChange(select.value);box.append(label,select,el('p','fate-note','從一座真實城市開始。這一世的性別與家境由命運抽選；出生地會改變求學、工作與日常遇見。'));p.append(box);
 return {read:()=> select.value};
}

export function lifeIdentity(life){
 if(![8,9].includes(life?.version))return null;
 const profile=life.version===9?countryProfile(life.seed,life.orbit,life.country):taiwanProfile(life.seed,life.orbit,life.country||'TW');
 return {profile,gender:profile.gender==='f'?'女性':'男性',place:`${profile.countryName} · ${profile.cityName}`,family:profile.familyLabel,title:profile.identityLabel};
}

export function renderLifeIdentity(p,life){
 const identity=lifeIdentity(life);if(!identity)return null;
 const card=el('section','fate-local-identity');card.setAttribute('aria-label','這一世的出身');
 card.append(el('small','fate-eyebrow','A LIFE, CLOSE TO HOME'),el('h3','',identity.title));
 const rows=el('dl');for(const[label,value]of[['出生地',identity.place],['性別',identity.gender],['家境',identity.family]]){const row=el('div');row.append(el('dt','',label),el('dd','',value));rows.append(row);}card.append(rows);p.append(card);return card;
}

const amount=(currency,value)=>currency&&currency!=='TWD'?currency+' '+Math.trunc(Number.isFinite(value)?value:0).toLocaleString('zh-TW'):ntd(value);
const ntd=value=>'NT$ '+Math.trunc(Number.isFinite(value)?value:0).toLocaleString('zh-TW');
export function taiwanLifeState(life){
 if(![8,9].includes(life?.version))return null;
 if(life.code&&!Number.isSafeInteger(life.startedAt))return resultComparison(life)?.state||null;
 const at=Number.isSafeInteger(life.clockAt)?life.clockAt:life.startedAt,activeMs=Math.max(0,Math.min(LIFE_MS,activeBetween(life.startedAt,at)));
 // A stale cloud draft cannot invent an unconfirmed timeout answer. Submitted
 // answers affect state only after their fixed deadline, exactly as in replay.
 return (life.version===9?replayCountryLife:replayTaiwanLife)({...life,auto:life.sources?.map(source=>source==='auto'?1:0)||life.auto},{activeMs,autoFill:false}).state;
}

export function taiwanStatusCards(state){
 const energy=state.energy,study=state.education,money=Number.isFinite(state.moneyNtd??state.money)?(state.moneyNtd??state.money):0,debt=Number.isFinite(state.debtNtd??state.debt)?(state.debtNtd??state.debt):0;
 const pace=energy>=70?'今天還有力氣，能把想做的小事排進日常。':energy>=40?'一天的事排得有點滿，留一段不用趕路的空白。':'忙碌已經累積，眼前的生活需要慢一點的節奏。';
 const education=study==='course-completed'?'已完成這條路線的課程，新的工作仍要另外核對入門條件。':study==='studying'?'正依當地課程路線學習，尚未完成的資格不會先寫進人生。':study==='bachelor'&&state.teacherDegreeCompleted===true?'學士學位已完成，走過的課程和練習都有了落點。':state.trainingPaused||study==='paused'?'暫停原本的學習安排，先把眼前生活安頓好。':study==='college-course'?'正在試讀有興趣的課程，還在摸索適合自己的方向。':study==='work-study'?'把工作和進修排在同一張月曆上，一步一步累積。':state.trainingStarted||state.teacherStudyStarted?'正為選定的路線上課與實作，這一段仍在學習。':'求學路線還沒選定，下一段方向等生活慢慢展開。';
 const finance=debt>0?`手邊有 ${amount(state.currency,money)}，也有 ${amount(state.currency,debt)} 的債務要慢慢整理。`:money>0?`手邊留下 ${amount(state.currency,money)}，給下一段生活留一點餘裕。`:money<0?`劇情帳暫有 ${amount(state.currency,Math.abs(money))} 的缺口，接下來需要重新安排。`:'手邊的餘裕暫時用完，下一步要更仔細安排。';
 const children=Number.isInteger(state.children)&&state.children>0?state.children:0;
 const family=children?`正在照顧 ${children} 名孩子，日常多了真正需要分配的時間。`:state.childfreeByChoice===true?'這一段已選擇暫不育兒，把時間留給眼前的生活。':state.married===true?'已走進婚姻與共同生活；育兒篇章還沒有開始。':state.partnerCommitted===true?'已確認伴侶關係，正在學著把彼此放進生活裡。':'還沒寫進伴侶／育兒篇章，這段日子先照顧好自己的生活。';
 return [{key:'pace',label:'體力與節奏',text:pace},{key:'education',label:'求學路線',text:education},{key:'finance',label:'手邊餘裕',text:finance},{key:'family',label:'身邊的人',text:family}];
}

function statusModel(life){
 if(life.code&&!Number.isSafeInteger(life.startedAt))return resultComparison(life);
 const state=taiwanLifeState(life);return state?compareLifeState(state,{country:life.country||'TW',age:lifeAge(life,life.clockAt??life.startedAt)}):null;
}
export function renderLifeStatus(p,life){
 if(![8,9].includes(life?.version))return null;
 const model=statusModel(life);if(!model)return null;
 const box=el('section','fate-local-status');box.setAttribute('aria-label','這一世的生活近況');box.append(el('small','fate-eyebrow','A LIFE BEYOND THE NUMBERS'));
 const grid=el('div','fate-status-grid');
 for(const card of taiwanStatusCards(model.state)){const node=el('article','fate-status-card');node.dataset.statusKey=card.key;node.append(el('h3','',card.label),el('strong','fate-status-title',''),el('p','',card.text));grid.append(node);}box.append(grid,el('p','fate-life-question',''));
 renderComparisonDetail(box);p.append(box);paintLifeStatus(p,life);return box;
}
export function paintLifeStatus(p,life){
 if(![8,9].includes(life?.version))return;
 const box=p.querySelector('.fate-local-status');if(!box)return;const model=statusModel(life);if(!model)return;
 const state=model.state,signature=JSON.stringify([state,model.age,model.completed,model.edition]);if(box.dataset.state===signature)return;box.dataset.state=signature;
 const titles={pace:model.paceTitle,education:model.education.label,finance:model.financeTitle,family:model.familyTitle};
 const learning=model.age<6?'在街角、餐桌和家人的聲音裡，你慢慢認識這個世界。':state.education==='course-completed'?'曾經卡住的練習，現在能自己完成；這段努力終於有了落點。':model.education.tertiary?'那些上課、熬夜和反覆練習的日子，留成一份真正走過的證明。':state.education==='paused'||state.trainingPaused?'書先闔上了，眼前的生活還得繼續照顧。':state.education==='studying'||state.trainingStarted?'日常的忙碌和桌上的筆記，還在爭同一段時間。':'方向還沒完全定下來，路也還能慢慢摸索。';
 for(const card of taiwanStatusCards(state)){const node=[...box.querySelectorAll('.fate-status-card')].find(item=>item.dataset.statusKey===card.key);if(!node)continue;node.querySelector('strong').textContent=titles[card.key];node.querySelector('p').textContent=card.key==='finance'&&model.net?`${model.age<16?'家裡的生活帳結餘':'帳面淨餘額'}折合約 ${formatTwd(model.net.twd)}。`+(model.debt.native>0?`仍有約 ${formatTwd(model.debt.twd)} 的債務在慢慢整理。`:'每一筆留下的錢，都有自己的來處。'):card.key==='education'?learning:card.key==='family'&&model.age<16?'有人替你記得上下課、天氣和晚餐，世界從這些小事開始。':card.text;}
 box.querySelector('.fate-life-question').textContent=model.question;
 paintComparisonDetail(box.querySelector('.fate-statistics'),model);
}
