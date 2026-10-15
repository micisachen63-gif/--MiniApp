(() => {
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number.isSafeInteger(n)&&n>=0?n.toLocaleString('en-US'):'—';
 const pct=n=>typeof n==='number'&&Number.isFinite(n)?`${(n*100).toLocaleString('zh-TW',{maximumFractionDigits:2})}%`:'—';
 const stone='/art/guardian-sigil-20261013/guardian-summon-stone.webp';
 const handles=new WeakMap();
 function mount(root,data){
  handles.get(root)?.cleanup();
  const C=window.RpgGuardianContract,host=window.RpgGuardianHost,actor=String(host.characterId()),key='guardianAssistPending:'+actor;
  let config=null,state=null,items=[],cursor=null,busy=false,loading=true,disposed=false,notice='',draft=false,pending=null,readController=null;
  const current=()=>!disposed&&root.isConnected&&actor===String(host.characterId());
  const parent=root.closest?.('.skill-widget');
  function save(value){pending=value;try{if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);}catch{}}
  const modes=['start','stop','continuation','buy','select','renew','supply'];
  try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value?.characterId===actor&&value.action==='assist'&&/^[A-Za-z0-9_-]{6,64}$/.test(value.requestId||'')&&(value.payload?.characterId===actor||value.legacy===true&&value.payload?.characterId===undefined)&&value.payload.requestId===value.requestId&&modes.includes(value.payload.mode))pending=value;}catch{}
  // Preserve an unresolved operation saved by the previous widget, including
  // its original legacy mode and body. A receipt check never creates a write.
  if(!pending&&typeof sessionStorage!=='undefined')try{const legacy=JSON.parse(sessionStorage.getItem(key)||'null');if(legacy&&/^[A-Za-z0-9_-]{6,64}$/.test(legacy.requestId||'')&&modes.includes(legacy.mode)&&(!legacy.characterId||String(legacy.characterId)===actor)){save({characterId:actor,action:'assist',requestId:legacy.requestId,legacy:true,payload:legacy});if(localStorage.getItem(key))sessionStorage.removeItem(key);}}catch{}
  const assist=()=>state?.assist||{};
  const canAct=()=>current()&&!busy&&!loading&&!pending&&state?.unlocked&&config?.enabled===true&&config.status==='approved';
  function setBusy(value){busy=value;if(parent)parent.busy=value;}
  function decorated(item){const type=config.types.find(row=>row.id===item.type),quality=config.qualities.find(row=>row.id===item.quality);return {...item,typeName:type?.name||C.TYPE_NAMES[item.type],qualityName:quality?.name||C.QUALITY_NAMES[item.quality],artUrl:type?.artUrl,ability:type?.ability,damageBonus:quality?.damageBonus,lootBonus:quality?.lootBonus};}
  function effect(item){return `${{melee:'近戰傷害',ranged:'遠程傷害',magic:'魔法傷害',loot:'隨機掉寶率'}[item.type]} +${pct(item.type==='loot'?item.lootBonus:item.damageBonus)}`;}
  function paint(){
   if(!current())return;
   const oldGrid=root.querySelector('.assist-grid'),scroll=oldGrid?.scrollTop||0,a=assist(),blocked=!canAct();
   const active=state?.activeGuardian,rows=active?[active,...items.filter(row=>row.id!==active.id)]:items;
   root.innerHTML=`<div class="assist-status"><img src="${stone}" alt="天使召喚石"><div><b>天使召喚石 · ${fmt(a.stoneCount)} 顆</b><small>每顆支援 ${fmt(a.battlesPerStone)} 戰</small></div><button type="button" class="assist-supply" data-assist-buy ${blocked?'disabled':''}>補給</button><button type="button" class="assist-refresh" data-assist-refresh aria-label="更新守護天使" ${busy||loading||pending?'disabled':''}>↻</button></div>${loading&&!state?'<p class="skill-widget-copy" role="status">正在尋找你的守護天使…</p>':''}<div class="assist-grid">${config?rows.map(raw=>{const item=decorated(raw),participating=a.enabled&&a.itemId===item.id,resume=!a.enabled&&a.itemId===item.id&&a.remainingBattles>0,disabled=blocked||!participating&&(item.inTrade||item.locked||a.enabled&&a.itemId!==item.id);return `<article class="assist-card guardian-quality-${item.quality}" data-assist-item="${esc(item.id)}"><div class="assist-card-art">${item.artUrl?`<img src="${esc(item.artUrl)}" alt="${esc(item.typeName)}" loading="lazy" decoding="async">`:''}</div><div class="assist-card-copy"><small>${esc(item.qualityName)}色 · ${item.bound?'已綁定':'召喚後綁定'}</small><b class="guardian-name">${esc(item.typeName)}</b><span>${esc(effect(item))}</span><small>${participating?`參戰中 · 剩餘 ${fmt(a.remainingBattles)} 戰`:resume?`已暫停 · 剩餘 ${fmt(a.remainingBattles)} 戰 · 續接不耗石`:item.inTrade?'交易保管中':item.locked?'已鎖定':item.active?'永久守護中':'等待同行'}</small></div><button type="button" class="assist-card-toggle ${participating?'is-active':''}" data-assist-toggle="${esc(item.id)}" ${disabled?'disabled':''}>${participating?'取消':'召喚'}</button></article>`;}).join(''):''}</div>${state&&!rows.length?'<p class="skill-widget-copy">尚未持有天使，前往守護天使頁面託付祈願。</p>':''}${cursor?`<button type="button" class="assist-more" data-assist-more ${busy||loading||pending?'disabled':''}>更多天使</button>`:''}<div class="assist-continuation"><label class="assist-auto"><input type="checkbox" data-assist-continuation ${(a.itemId?a.autoRenew:draft)?'checked':''} ${blocked?'disabled':''}> 自動續召</label><small>剩餘戰數用完，以 1 顆召喚石繼續；石不足就停止。${a.autoBuy?`<br>已開啟金幣補給：缺石時以 ${fmt(a.stoneGold)} 金幣補充 1 顆。`:''}</small></div><p class="assist-message" role="status">${esc(notice||'同時一位天使參戰；取消保留剩餘戰數，永久守護仍生效。')}</p>${pending?'<div class="assist-recovery"><button type="button" data-assist-recover>確認結果</button><button type="button" data-assist-retry>重試原操作</button></div>':''}`;
   if(busy)root.querySelectorAll('button,input').forEach(node=>node.disabled=true);
   const grid=root.querySelector('.assist-grid');if(grid)grid.scrollTop=scroll;
  }
  function accept(raw,next=false){
   const snapshot=C.state(raw,actor);if(state&&snapshot.revision<state.revision)return false;
   items=next&&snapshot.revision===state?.revision?[...new Map([...items,...snapshot.inventory.items].map(item=>[item.id,item])).values()]:snapshot.inventory.items;
   state=snapshot;cursor=snapshot.inventory.nextCursor;return true;
  }
  async function load(next){
   if(!current()||busy||readController)return null;
   const controller=new AbortController();readController=controller;loading=true;paint();
   try{const [rawConfig,rawState]=await Promise.all([config||host.config({signal:controller.signal}),host.state({...(next?{cursor:next}:{}),signal:controller.signal})]);if(!current()||controller.signal.aborted)return null;config=C.config(rawConfig);accept(rawState,!!next);notice='';return state;}
   catch(error){if(current()&&!controller.signal.aborted)notice=error.message||'天使暫時無法載入，請更新重試。';return null;}
   finally{if(readController===controller)readController=null;loading=false;paint();}
  }
  function receipt(raw,requestId){const operation=C.operation(raw,actor);if(operation.requestId!==requestId||operation.action!=='assist'||operation.status!=='committed')throw Object.assign(Error('召喚結果尚待確認，請保留原操作。'),{uncertain:true});return operation;}
  async function act(body,prompt=null,retry=false){
   if(!current()||busy||loading||!retry&&!canAct()||retry&&!pending)return null;
   setBusy(true);notice='';paint();
   try{
    if(prompt&&!await host.confirm(prompt.title,prompt.text))return null;
    if(!current())return null;
    if(!retry){const requestId=host.requestId();save({characterId:actor,action:'assist',requestId,payload:{...body,characterId:actor,requestId}});}
    const saved=pending,result=await host.mutate('assist',{...saved.payload});if(!current())return null;
    const operation=receipt(result.operation,saved.requestId);accept(result.state);save(null);
    notice=operation.assistMode==='stop'?'天使暫時退下，剩餘戰數已保留。':operation.assistMode==='continuation'?'續召設定已保存。':operation.assistMode==='buy'?'召喚石已放入背包。':'天使已加入這段旅程。';host.onChanged?.(state);return operation;
   }catch(error){if(current()){if(error.status>=400&&error.status<500&&!error.uncertain)save(null);notice=error.message||'連線暫時中斷，請確認原操作結果。';}return null;}
   finally{setBusy(false);paint();if(current()&&!pending)window.dispatchEvent(new Event('elf-skills-refresh'));}
  }
  async function recover(){
   if(!current()||busy||loading||!pending)return null;
   setBusy(true);notice='';paint();const saved=pending;
   try{const operation=receipt(await host.recover({requestId:saved.requestId}),saved.requestId);if(!current())return null;const raw=await host.state();if(!current())return null;accept(raw);save(null);notice='原操作已結算，沒有再次扣除資源。';host.onChanged?.(state);return operation;}
   catch(error){if(current())notice=error.message||'結果尚未確認，請稍後再查詢原操作。';return null;}
   finally{setBusy(false);paint();if(current()&&!pending)window.dispatchEvent(new Event('elf-skills-refresh'));}
  }
  function click(event){
   const button=event.target.closest?.('button');if(!button||!root.contains(button)||button.disabled||!current())return;
   if(button.hasAttribute('data-assist-retry')){void act(null,null,true);return;}
   if(button.hasAttribute('data-assist-recover')){void recover();return;}
   if(button.hasAttribute('data-assist-refresh')){void load();return;}
   if(button.hasAttribute('data-assist-more')){if(cursor)void load(cursor);return;}
   if(button.hasAttribute('data-assist-buy')){void act({mode:'buy',quantity:1},{title:'補充召喚石',text:`以 ${fmt(assist().stoneGold)} 金幣購買 1 顆天使召喚石。`});return;}
   const itemId=button.dataset.assistToggle,item=items.find(row=>row.id===itemId)||(state?.activeGuardian?.id===itemId?state.activeGuardian:null),a=assist();
   if(!item||!canAct())return;
   if(a.enabled&&a.itemId===item.id){void act({mode:'stop',itemId:item.id});return;}
   if(item.inTrade||item.locked||a.enabled)return;
   const resume=a.itemId===item.id&&a.remainingBattles>0;
   if(!resume&&!(a.stoneCount>0)){notice='需要 1 顆天使召喚石，請先補給。';paint();return;}
   void act({mode:'start',itemId:item.id,autoRenew:a.itemId?a.autoRenew:draft},resume?null:{title:'召喚天使參戰',text:`消耗 1 顆天使召喚石，支援 ${fmt(a.battlesPerStone)} 戰；天使會綁定。${a.itemId&&a.itemId!==item.id&&a.remainingBattles>0?`更換將放棄原天使剩餘 ${fmt(a.remainingBattles)} 戰。`:''}`});
  }
  function change(event){if(!event.target.hasAttribute('data-assist-continuation')||!canAct())return;draft=event.target.checked;if(assist().itemId)void act({mode:'continuation',autoRenew:draft});else paint();}
  const handle={update(next){if(!current()||busy)return;data=next;const revision=next.character?.revision;if(state&&Number.isSafeInteger(revision)&&revision>=state.revision){const a=next.special?.guardianAssist;state=C.state({...state,revision,balances:{...state.balances,gold:next.character.gold},activeGuardian:next.guardian?{...next.guardian,id:next.guardian.id||a?.itemId,bound:next.guardian.bound??true,active:true}:null,assist:{...state.assist,itemId:a?.itemId||null,remainingBattles:a?.remainingBattles||0,enabled:next.special?.guardianSummonEnabled===true,autoRenew:a?a.autoRenew!==false:false,autoBuy:next.special?.guardianStoneSupply===true,stoneCount:next.inventory?.guardian_summon_stone||0}},actor);}paint();},cleanup(){disposed=true;readController?.abort();root.removeEventListener('click',click);root.removeEventListener('change',change);if(!busy&&parent)parent.busy=false;handles.delete(root);}};
  handles.set(root,handle);root.addEventListener('click',click);root.addEventListener('change',change);
  if(data.character.level<15){loading=false;root.innerHTML='<p class="skill-widget-copy">守護天使參戰於 15 級開放。</p>';return handle;}
  paint();void load();return handle;
 }
 window.RpgGuardianAssistWidget=Object.freeze({mount});
})();
