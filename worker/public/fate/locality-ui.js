import {taiwanProfile,replayTaiwanLife} from './decision-engine-v8.js';
import {activeBetween,LIFE_MS} from './life.js';

const developing=[['JP','日本'],['KR','韓國'],['US','美國'],['CA','加拿大'],['GB','英國'],['DE','德國'],['FR','法國'],['AU','澳洲'],['IN','印度']];
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}

// This is the fictional life's setting, independent of private birth profiles.
export function renderLifeCountry(p){
 const box=el('section','fate-life-country');box.setAttribute('aria-label','這一世的出生地');
 const label=el('label','fate-field','這一世，從哪裡開始？');label.htmlFor='fate-life-country';
 const select=el('select','fate-date');select.id='fate-life-country';select.setAttribute('aria-label','這一世的出生地');
 const taiwan=el('option','','台灣 · 台北／新北');taiwan.value='TW';select.append(taiwan);
 for(const[code,name]of developing){const option=el('option','',`${name} · 製作中`);option.value=code;option.disabled=true;select.append(option);}
 select.value='TW';box.append(label,select,el('p','fate-note','先從雙北的街巷開始。這一世的性別與家境由命運抽選；出生地會改變求學、工作與日常遇見。'));p.append(box);
 return {read:()=> 'TW'};
}

export function lifeIdentity(life){
 if(life?.version!==8)return null;
 const profile=taiwanProfile(life.seed,life.orbit,life.country||'TW');
 return {profile,gender:profile.gender==='f'?'女性':'男性',place:`${profile.countryName} · ${profile.cityName}`,family:profile.familyLabel,title:profile.identityLabel};
}

export function renderLifeIdentity(p,life){
 const identity=lifeIdentity(life);if(!identity)return null;
 const card=el('section','fate-local-identity');card.setAttribute('aria-label','這一世的出身');
 card.append(el('small','fate-eyebrow','A LIFE, CLOSE TO HOME'),el('h3','',identity.title));
 const rows=el('dl');for(const[label,value]of[['出生地',identity.place],['性別',identity.gender],['家境',identity.family]]){const row=el('div');row.append(el('dt','',label),el('dd','',value));rows.append(row);}card.append(rows);p.append(card);return card;
}

const ntd=value=>'NT$ '+Math.trunc(Number.isFinite(value)?value:0).toLocaleString('zh-TW');
export function taiwanLifeState(life){
 if(life?.version!==8)return null;
 const at=Number.isSafeInteger(life.clockAt)?life.clockAt:life.startedAt,activeMs=Math.max(0,Math.min(LIFE_MS,activeBetween(life.startedAt,at)));
 // A stale cloud draft cannot invent an unconfirmed timeout answer. Submitted
 // answers affect state only after their fixed deadline, exactly as in replay.
 return replayTaiwanLife({...life,auto:life.sources?.map(source=>source==='auto'?1:0)||life.auto},{activeMs,autoFill:false}).state;
}

export function taiwanStatusCards(state){
 const energy=state.energy,study=state.education,money=Number.isFinite(state.moneyNtd)?state.moneyNtd:0,debt=Number.isFinite(state.debtNtd)?state.debtNtd:0;
 const pace=energy>=70?'今天還有力氣，能把想做的小事排進日常。':energy>=40?'一天的事排得有點滿，留一段不用趕路的空白。':'忙碌已經累積，眼前的生活需要慢一點的節奏。';
 const education=study==='bachelor'&&state.teacherDegreeCompleted===true?'學士學位已完成，走過的課程和練習都有了落點。':state.trainingPaused||study==='paused'?'暫停原本的學習安排，先把眼前生活安頓好。':study==='college-course'?'正在試讀有興趣的課程，還在摸索適合自己的方向。':study==='work-study'?'把工作和進修排在同一張月曆上，一步一步累積。':state.trainingStarted||state.teacherStudyStarted?'正為選定的路線上課與實作，這一段仍在學習。':'求學路線還沒選定，下一段方向等生活慢慢展開。';
 const finance=debt>0?`手邊有 ${ntd(money)}，也有 ${ntd(debt)} 的債務要慢慢整理。`:money>0?`手邊留下 ${ntd(money)}，給下一段生活留一點餘裕。`:money<0?`劇情帳暫有 ${ntd(Math.abs(money))} 的缺口，接下來需要重新安排。`:'手邊的餘裕暫時用完，下一步要更仔細安排。';
 const children=Number.isInteger(state.children)&&state.children>0?state.children:0;
 const family=children?`正在照顧 ${children} 名孩子，日常多了真正需要分配的時間。`:state.childfreeByChoice===true?'這一段已選擇暫不育兒，把時間留給眼前的生活。':state.married===true?'已走進婚姻與共同生活；育兒篇章還沒有開始。':state.partnerCommitted===true?'已確認伴侶關係，正在學著把彼此放進生活裡。':'還沒寫進伴侶／育兒篇章，這段日子先照顧好自己的生活。';
 return [{key:'pace',label:'體力與節奏',text:pace},{key:'education',label:'求學路線',text:education},{key:'finance',label:'手邊餘裕',text:finance},{key:'family',label:'身邊的人',text:family}];
}

export function renderLifeStatus(p,life){
 if(life?.version!==8)return null;
 const box=el('section','fate-local-status');box.setAttribute('aria-label','這一世的生活近況');const grid=el('div','fate-status-grid');
 for(const card of taiwanStatusCards(taiwanLifeState(life))){const node=el('article','fate-status-card');node.dataset.statusKey=card.key;node.append(el('h3','',card.label),el('p','',card.text));grid.append(node);}box.append(grid);
 const detail=el('details','fate-status-ledger');detail.append(el('summary','','翻開此世的生活帳'),el('dl'));box.append(detail,el('p','fate-note','金額是這一世的劇情帳，與玩家現實財務及星穹旅誌金幣分開。'));p.append(box);paintLifeStatus(p,life);return box;
}

export function paintLifeStatus(p,life){
 if(life?.version!==8)return;
 const box=p.querySelector('.fate-local-status');if(!box)return;const state=taiwanLifeState(life),signature=JSON.stringify(state);if(box.dataset.state===signature)return;box.dataset.state=signature;
 for(const card of taiwanStatusCards(state)){const node=[...box.querySelectorAll('.fate-status-card')].find(item=>item.dataset.statusKey===card.key);if(node)node.querySelector('p').textContent=card.text;}
 const money=Number.isFinite(state.moneyNtd)?state.moneyNtd:0,debt=Number.isFinite(state.debtNtd)?state.debtNtd:0,ledger=box.querySelector('dl');ledger.replaceChildren();for(const[label,value]of[['可用資產',money],['待還債務',debt],['資產減債務',money-debt]]){const row=el('div');row.append(el('dt','',label),el('dd','',ntd(value)));ledger.append(row);}
}
