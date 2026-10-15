(() => {
 'use strict';
 const icon=item=>/^collection_(?:[1-9]|1[0-2])$/.test(String(item))?`art/collections-20261013/${item}.webp?v=1`:/^hunt_(?:[1-9]|1[0-2])_(?:[123]|sigil|core)$/.test(String(item))?`art/collection-materials-20261014/${item}.webp?v=1`:null;
 const titles=['','月桂月印','百柱智印','聖林森印','愛琴潮印','迷宮秘印','熔爐炎印','冥河魂印','神諭日印','泰坦岩印','雲門雷印','至福聖印','星穹夜印'];
 function render({me,meta},{esc,fmt,itemName}){
  const recipes=me.collection?.recipes||[];if(!recipes.length)return '';const active=me.collection.activeBlessing,activeMap=me.collection.activeMapId||0,inParty=!!me.character.partyId;
  const selected=active?`<img src="${icon(active.item)}" alt=""><div><strong>${esc(active.name)}</strong><span>${esc(active.summary)}</span></div>`:'<span class="collection-idle-seal" aria-hidden="true">✦</span><div><strong>尚未啟用祝福</strong><span>完成地圖收藏後，選擇適合你的能力。</span></div>';
  return `<section class="card monster-collection collection-gallery" aria-label="地圖圖鑑"><h3>✦ 地圖圖鑑 <small>${recipes.filter(r=>r.owned).length} / ${recipes.length}</small></h3><p class="muted">將旅途材料鑄成永久徽記，解鎖諸神的祝福。<br>全職業通用 · 只作用於自身 · 一次啟用一種</p><div class="collection-equipped" role="status" aria-label="目前收藏祝福">${selected}${active?`<button class="btn sm ghost" data-collection-activate="0" ${inParty?'disabled':''}>停用</button>`:''}</div>${inParty?'<p class="collection-party-note">組隊戰鬥期間，祝福維持出發時的設定。</p>':''}<div class="collection-intro"><span>點圖看詳情 · 完成收藏後免費切換祝福</span></div><div class="monster-recipes">${recipes.map(r=>{
   const can=!r.owned&&me.character.gold>=r.gold&&r.ingredients.every(i=>i.have>=i.qty)&&me.character.level>=(meta.maps[r.mapId]?.min||1),ready=r.ingredients.filter(i=>i.have>=i.qty).length,on=activeMap===r.mapId;
   const materialRows=r.ingredients.map(i=>`<div class="${i.have>=i.qty?'enough':''}"><button class="collection-material" data-collection-material="${esc(i.item)}" aria-label="查看 ${esc(itemName(i.item))}"><img src="${icon(i.item)}" alt="" loading="lazy" decoding="async"><span>${esc(itemName(i.item))}</span></button><b>${fmt(i.have)} / ${fmt(i.qty)}</b></div>`).join('');
   return `<article class="monster-recipe collection-card ${on?'is-active':r.owned?'is-owned':can?'is-ready':'is-locked'}" data-collection-id="${esc(r.item)}"><div class="collection-card-head"><button class="collection-art" type="button" data-collection-preview="${esc(r.item)}" aria-label="查看 ${esc(r.name)}"><img src="${icon(r.item)}" alt="${esc(r.name)}" loading="lazy" decoding="async"><span class="collection-seal" aria-hidden="true">${on?'✦':r.owned?'✓':'◇'}</span></button><div class="collection-title"><strong>${esc(titles[r.mapId]||r.name)}</strong><small>${esc(meta.maps[r.mapId]?.name||'地圖 '+r.mapId)}</small><span>${on?'祝福已啟用':r.owned?'已收藏 · 永久解鎖':'魔法徽記 · '+fmt(r.gold)+' 金幣'}</span></div></div><div class="collection-blessing"><strong>${esc(r.blessing?.name||'收藏祝福')}</strong><span>${esc(r.blessing?.summary||'完成收藏後解鎖')}</span></div>${r.owned?`<div class="collection-actions"><button class="btn sm collection-action ${on?'gold':''}" data-collection-activate="${r.mapId}" aria-pressed="${on}" ${on||inParty?'disabled':''}>${on?'已啟用':'啟用祝福'}</button></div>`:`<details class="collection-materials"><summary><span>材料進度</span><b>${ready} / ${r.ingredients.length}</b></summary><div class="monster-ingredients">${materialRows}</div></details><button class="btn sm collection-action ${can?'gold':''}" data-monster-exchange="${esc(r.id)}" ${can&&!inParty?'':'disabled'}>製作徽記</button>`}</article>`;
  }).join('')}</div></section>`;
 }
 function bind(view,show,showMaterial){
  view.querySelectorAll('[data-collection-preview]').forEach(b=>b.onclick=()=>show(b.dataset.collectionPreview));
  view.querySelectorAll('[data-collection-material]').forEach(b=>b.onclick=()=>showMaterial?.(b.dataset.collectionMaterial));
  view.querySelectorAll('.inv [data-collection-icon]').forEach(image=>{const item=image.dataset.collectionIcon,cell=image.closest('.inv>div');if(!cell)return;cell.setAttribute('role','button');cell.tabIndex=0;cell.setAttribute('aria-label','查看 '+(image.alt||'收藏道具'));const open=()=>item.startsWith('hunt_')?showMaterial?.(item):show(item);cell.onclick=open;cell.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};});
 }
 function place(view){const hero=view.querySelector('#my-panel-bag-wardrobe'),skills=hero?.querySelector('.skill-widget'),collection=view.querySelector('.monster-collection');if(skills&&collection)skills.after(collection);}
 window.RpgCollectionUI={icon,render,bind,place};
})();

(() => {
 const UI=window.RpgCollectionUI;let filters={charId:null,map:0,q:''};
 const mapOf=item=>Number(item.match(/^(?:hunt|collection)_(\d+)/)?.[1])||0;
 UI.inventory=({me,meta},{esc,fmt,itemName})=>{
  if(filters.charId!==me.character.tgId)filters={charId:me.character.tgId,map:0,q:''};
  const entries=Object.entries(me.inventory).filter(([item,qty])=>qty>0&&/^(?:hunt_\d+_(?:[123]|sigil|core)|collection_\d+)$/.test(item)).sort((a,b)=>mapOf(a[0])-mapOf(b[0])||a[0].localeCompare(b[0]));
  const options=Object.entries(meta.maps).filter(([,m])=>m.id>0&&m.id<=12).map(([,m])=>'<option value="'+m.id+'" '+(filters.map===m.id?'selected':'')+'>'+esc(m.name)+'</option>').join('');
  return '<section class="card collection-inventory"><h3>✦ 圖鑑收集 <small>'+entries.length+' 種</small></h3><p class="muted">地圖材料與永久徽記，集中收納於此。</p><div class="collection-inventory-filters"><label>地圖<select data-collection-map><option value="0">全部地圖</option>'+options+'</select></label><label>搜尋<input data-collection-search type="search" maxlength="50" placeholder="找材料或徽記" value="'+esc(filters.q)+'"></label></div><p class="collection-inventory-count" data-collection-count></p><div class="inv collection-item-grid">'+entries.map(([item,qty])=>'<div data-collection-item="'+esc(item)+'" data-map="'+mapOf(item)+'" data-name="'+esc(itemName(item))+'" title="'+esc(itemName(item))+'"><b><img src="'+UI.icon(item)+'" data-collection-icon="'+esc(item)+'" alt="'+esc(itemName(item))+'" loading="lazy" decoding="async"></b><i>'+fmt(qty)+'</i><span>'+esc(itemName(item))+'</span></div>').join('')+'</div><p class="collection-inventory-empty" data-collection-empty>尚未取得圖鑑材料，前往地圖冒險或切換篩選看看。</p></section>';
 };
 UI.bindInventory=view=>{
  const root=view.querySelector('.collection-inventory');if(!root)return;const map=root.querySelector('[data-collection-map]'),search=root.querySelector('[data-collection-search]');
  function apply(){const rows=[...root.querySelectorAll('[data-collection-item]')],query=filters.q.trim().toLocaleLowerCase();let visible=0;for(const row of rows){const on=(!filters.map||Number(row.dataset.map)===filters.map)&&(!query||row.dataset.name.toLocaleLowerCase().includes(query));row.hidden=!on;if(on)visible++;}root.querySelector('[data-collection-count]').textContent='顯示 '+visible+' / '+rows.length+' 種 · 點圖查看詳情';root.querySelector('[data-collection-empty]').hidden=visible>0;}
  map.onchange=()=>{filters.map=Number(map.value)||0;apply();};search.oninput=()=>{filters.q=search.value.slice(0,50);apply();};apply();
 };
})();
