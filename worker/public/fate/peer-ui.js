// Requested by the player, never part of the background progress polling.
export function mountPeerComparison(parent,{lifeId,client,doc=document}){
 if(!lifeId||!client)return;
 const el=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const panel=el('details','fate-peer-comparison fate-journal'),body=el('div');panel.append(el('summary','','與同期旅人比一比'),body);parent.append(panel);
 let loading=false,loaded=false;
 async function load(){if(loading)return;loading=true;body.replaceChildren(el('p','fate-note','正在翻閱同一天落款的旅章…'));
  try{const result=await client.request('fate/peers',{lifeId});body.replaceChildren(el('p','fate-note',`${result.date} · ${result.sampleCount} 位同期旅人 · 每個帳號只計一世`));
   if(!result.available)body.append(el('p','',result.reason||'等更多旅人落款後，再一起比較。'));
   else{const number=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0});for(const [key,label,unit]of [['wealth','財富','NT$ '],['bonds','情誼','']]){const value=result.comparison[key];body.append(el('p','fate-peer-rank',`${label} · 並列第 ${value.rank} 名／${result.sampleCount} 人`),el('p','fate-note',`本世 ${unit}${number.format(value.value)} · 同期平均 ${unit}${number.format(value.average)}${key==='bonds'?'／100（故事指數）':'（淨資產）'}`));}}
   loaded=true;
  }catch{body.replaceChildren(el('p','fate-note','這一刻還沒對上旅人的來信，稍後可以重試。'));}
  finally{loading=false;const retry=el('button','fate-quiet',loaded?'更新比較':'重試比較');retry.type='button';retry.onclick=load;body.append(retry);}
 }
 panel.ontoggle=()=>{if(panel.open&&!loaded)load();};return panel;
}
