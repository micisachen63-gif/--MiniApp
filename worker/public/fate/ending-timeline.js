// Presentation only: retain immutable old story prose while making its actual
// chronology readable. Never infer ages, qualifications or family milestones.
export function endingTimeline(life,events=[]){
 const rows=events.filter(e=>e&&Number.isFinite(e.age)&&typeof e.text==='string'),selected=new Map();
 const add=e=>{if(e)selected.set(e.id||e.kind+':'+e.age+':'+e.text,e);};
 add(rows.find(e=>e.kind==='birth'||e.kind==='origin'));
 for(const e of rows.filter(e=>e.kind==='choice'||e.kind==='shared'))add(e);
 for(const kind of ['career','relationship','consequence','legacy']){const found=rows.filter(e=>e.kind===kind);add(found[0]);if(kind==='career'||kind==='legacy')add(found.at(-1));}
 const labels={birth:'此生啟程',origin:'此生啟程',choice:'命運的岔路',shared:'交織的相逢',career:'工作與生活',relationship:'身邊的人',consequence:'選擇的迴響',legacy:'留下的事物'};
 const ordered=[...selected.values()].sort((a,b)=>a.age-b.age||String(a.id).localeCompare(String(b.id))).map(e=>({age:Math.floor(e.age),label:labels[e.kind]||'此世紀事',text:e.text.replace(/這一頁(?:在期限到達時，由命運代你翻過|由你親自選定)。$/,'')}));
 if(Number.isInteger(life?.deathAge))ordered.push({age:life.deathAge,label:'此生落款',text:`這一世在${life.deathAge}歲合上旅誌，已經走過的選擇與相逢，留在這位靈魂的記憶裡。`});
 return ordered;
}
