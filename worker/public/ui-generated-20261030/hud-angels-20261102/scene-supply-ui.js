/* Main-battle supplies and shop. Legacy operations keep their existing server rules. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('zh-TW').format(Number(value)) : '—';
  const copy = value => JSON.parse(JSON.stringify(value));
  const memory = new Map();
  const PURCHASES = new Set(['buy','buy-gear','gacha']);
  const ACTIONS = new Set([...PURCHASES,'refill','settings']);
  const FIELDS = ['autoRedPct','autoBlue','autoBluePct','autoRedPotion','autoBluePotion'];
  const SUPPLY_KEYS = ['red_1','red_2','red_3','red_4','blue_1','blue_2','blue_3','blue_4'];
  const hasSupplyItems = supplies => !!supplies?.items&&typeof supplies.items==='object'&&!Array.isArray(supplies.items);
  const CATEGORIES = [['all','全部'],['potion','藥水'],['scroll','卷軸'],['gacha','轉蛋'],['weapon','武器'],['armor','防具'],['accessory','飾品'],['special','其他']];
  const scopeOf = context => ({accountId:String(context?.accountId || ''),realmId:String(context?.realmId || ''),characterId:String(context?.characterId || ''),epoch:context?.epoch ?? 0});
  const same = (a,b,epoch=true) => a.accountId===b.accountId && a.realmId===b.realmId && a.characterId===b.characterId && (!epoch || a.epoch===b.epoch);
  const settingsOf = me => ({autoRedPct:String(me.character.autoRedPct ?? 50),autoBlue:!!me.character.autoBlue,
    autoBluePct:String(me.character.autoBluePct ?? 50),autoRedPotion:me.character.autoRedPotion || 'auto',autoBluePotion:me.character.autoBluePotion || 'auto'});
  function error(message,code='supply_input'){return Object.assign(new Error(message),{code,status:400,uncertain:false});}
  function catalogEntries(shop={},metadata={}) {
    const defs=metadata.meta?.items || metadata.items || {};
    return [
      ...(shop.items || []).map(offer=>{
        const def=defs[offer.item] || {},kind=def.kind;
        const category=/^(red|blue)_/.test(offer.item)||['red','blue','potion'].includes(kind)?'potion':
          kind==='scroll'||/scroll|^unbind$/.test(offer.item)?'scroll':'special';
        return {...offer,key:'item:'+offer.item,action:'buy',category,item:offer.item,
          iconSrc:def.iconSrc || null,description:offer.desc || def.desc || '',maxHold:def.maxHold || null,dailyBuy:def.dailyBuy || null};
      }),
      ...(shop.gacha || []).map(offer=>({...offer,key:'gacha:'+offer.type,action:'gacha',category:'gacha',
        item:'gacha_'+offer.type,iconSrc:defs['gacha_'+offer.type]?.iconSrc || null,description:offer.description || '',rates:shop.gachaRates || []})),
      ...(shop.gear || []).map(offer=>({...offer,key:'gear:'+offer.code,action:'buy-gear',
        category:offer.group || (offer.slot==='weapon'?'weapon':'armor'),description:offer.desc || '',item:null})),
    ].filter(offer=>typeof offer.key==='string' && Number.isSafeInteger(offer.price) && offer.price>0);
  }
  function purchasePlan(entry,value,me) {
    if(!entry)throw error('這個商品目前不能購買，請重新同步商店。');
    const quantity=entry.action==='buy-gear'?1:Number(value),text=String(value ?? '').trim();
    if(entry.action!=='buy-gear'&&(!text || !Number.isSafeInteger(quantity)||quantity<1||quantity>9999))throw error('請輸入 1 至 9,999 的整數數量。');
    const total=entry.price*quantity;
    if(!Number.isSafeInteger(total)||total>Number(me.character.gold || 0))throw error('目前金幣不足，請調整數量。');
    if(entry.maxHold&&(Number(me.inventory?.[entry.item] || 0)+quantity)>entry.maxHold)throw error('超過持有上限 '+fmt(entry.maxHold)+'。');
    if(entry.dailyBuy&&quantity>entry.dailyBuy)throw error('單次數量超過每日限購 '+fmt(entry.dailyBuy)+'。');
    const body=entry.action==='buy-gear'?{code:entry.code}:entry.action==='gacha'?{type:entry.type,qty:quantity}:{item:entry.item,qty:quantity};
    return {action:entry.action,key:entry.key,name:entry.name,quantity,price:entry.price,total,body,
      description:entry.action==='buy-gear'?'購買時隨機決定屬性與品質，完成後存入背包。':
        entry.action==='gacha'?'購買後存入背包；開啟時依角色當下等級、職業與路線決定裝備。':'購入物品會加入目前角色的背包。'};
  }
  function refillPreview(me,shop) {
    const refill=me.refill || {},supply=me.supply || {};
    if(!Number.isFinite(refill.cost)||refill.cost<=0)throw error('背包中的補給已足夠原版掛機 24 小時。','full');
    const rows=['red','blue'].map(kind=>{
      const item=supply[kind+'Key'],quantity=Number(refill[item] || 0),offer=(shop.items || []).find(x=>x.item===item);
      if(!Number.isSafeInteger(quantity)||quantity<0)throw error('補給方案已變動，請重新同步。');
      if(quantity>0&&!offer)throw error('指定的藥水尚未解鎖購買，請改選已解鎖種類。','not_sold');
      return {item,name:offer?.name || item,quantity,price:offer?.price || 0};
    });
    const fullTotal=rows.reduce((sum,row)=>sum+row.quantity*row.price,0);
    if(fullTotal!==refill.cost)throw error('補給價格已變動，請重新同步。');
    const gold=Number(me.character.gold || 0),partial=gold<fullTotal;
    if(partial)for(const row of rows)row.quantity=Math.floor(row.quantity*gold/fullTotal);
    const total=rows.reduce((sum,row)=>sum+row.quantity*row.price,0),quantity=rows.reduce((sum,row)=>sum+row.quantity,0);
    if(!quantity)throw error('金幣不足，無法購買補給。','gold');
    return {action:'refill',name:partial?'依目前金幣補充藥水':'補滿原版掛機 24 小時',quantity,total,fullTotal,partial,rows,body:{},
      description:'只補充背包；伺服器依確認時的實際持有與金幣結算，不增加進行中星圖已預留的補給。'};
  }
  function settingsPlan(me,draft,atlas) {
    const desired=draft.settings || settingsOf(me),current=settingsOf(me),body={};
    for(const field of FIELDS){
      if(!draft.settingsTouched?.[field])continue;
      let value=desired[field];
      if(field.endsWith('Pct')){
        value=Number(value);if(!Number.isInteger(value)||value<20||value>80)throw error('自動喝水門檻需為 20–80% 的整數。');
      }else if(field==='autoBlue')value=!!value;
      else if(value!=='auto'){
        const kind=field==='autoRedPotion'?'red':'blue',option=me.supply?.[kind+'Options']?.find(p=>p.key===value);
        if(!option||(!option.unlocked&&!(option.count>0)))throw error('所選藥水尚未解鎖，背包中也沒有庫存。');
      }
      const previous=field.endsWith('Pct')?Number(current[field]):current[field];
      if(value!==previous)body[field]=value;
    }
    if(!Object.keys(body).length)throw error('設定與目前角色相同，無需再次保存。','unchanged');
    return {action:'settings',name:'保存自動喝水設定',quantity:0,total:0,body,
      description:hasSupplyItems(atlas?.supplies)?'這些設定同時供原版玩法與下一趟 Atlas 使用；進行中的出征維持原設定與已預留補給。':'這些設定供原版玩法使用；進行中的 Atlas 沿用出發時的快照與已預留補給。'};
  }
  function comparable(plan){return JSON.stringify([plan.action,plan.name,plan.body,plan.quantity,plan.total,plan.rows || null]);}
  function createClient(host,options={},changed=()=>{}) {
    const scope=scopeOf(host.getContext?.()),draft=host.draft || {};
    if(!scope.accountId||!scope.realmId||!scope.characterId)throw error('請先選擇角色。','no_character');
    const tab=options.tab==='shop'?'shop':'supplies',key='scene:supply-pending:'+scope.accountId+':'+scope.realmId+':'+scope.characterId;
    let storage=null;try{storage=host.storage || window.sessionStorage;}catch{}
    let disposed=false,loadSequence=0;
    const state={tab,loading:false,busy:false,me:null,shop:null,meta:null,atlas:null,atlasError:'',error:'',notice:'',confirmation:null,pending:null,result:null,ledger:[],checked:false};
    draft.quantities ||= {};draft.category ||= 'all';draft.search ||= '';draft.page=Number.isInteger(draft.page)?draft.page:0;draft.settingsTouched ||= {};
    function current(){return !disposed && host.current?.()!==false && same(scope,scopeOf(host.getContext?.()));}
    function notify(){if(current())changed(state);}
    function savePending(value){
      state.pending=value;state.checked=false;
      if(value)memory.set(key,copy(value));else memory.delete(key);
      try{if(value)storage?.setItem(key,JSON.stringify(value));else storage?.removeItem(key);}catch{}
    }
    try{
      const pending=memory.get(key) || JSON.parse(storage?.getItem(key) || 'null');
      if(pending?.version===1&&same(scope,pending.scope,false)&&ACTIONS.has(pending.action)&&/^[A-Za-z0-9_-]{6,64}$/.test(pending.body?.requestId || ''))state.pending=copy(pending);
    }catch{}
    function checkScope(data,player=false){
      if(!current())throw error('角色或世界已切換，已忽略先前回應。','context_changed');
      if(data?.ok===false)throw error(data.message || '操作未完成。',data.error);
      if((data?.realmId&&String(data.realmId)!==scope.realmId)||
         (data?.characterId&&String(data.characterId)!==scope.characterId)||
         (data?.character?.tgId&&String(data.character.tgId)!==scope.characterId)||
         (player&&!data?.character?.tgId))throw Object.assign(error('回應角色不一致，請重新同步。','context_mismatch'),{uncertain:true});
    }
    function syncSettings(force=false){
      if(!state.me)return;
      const actual=settingsOf(state.me);draft.settings ||= {};
      for(const field of FIELDS)if(force||!draft.settingsTouched[field])draft.settings[field]=actual[field];
      if(force)draft.settingsTouched={};
    }
    async function readPlayer(shop=false){
      const data=await host.request(shop?'shop':'me',shop?{}:{summary:false});checkScope(data,true);
      state.me=data;if(data.shop)state.shop=data.shop;syncSettings();return data;
    }
    async function refresh(internal=false) {
      if(!current()||state.loading||(!internal&&state.busy))return false;
      const sequence=++loadSequence;state.loading=true;state.error='';notify();
      try{
        await readPlayer(tab==='shop');
        if(!current()||sequence!==loadSequence)return false;
        if(!state.meta){try{const meta=await host.request('meta',{});checkScope(meta);state.meta=meta;}catch(e){if(!current())return false;state.notice='商品名稱與條件以商店當次回應為準。';}}
        try{const atlas=await host.request('atlas/status',{});checkScope(atlas);if(current()&&sequence===loadSequence){state.atlas=atlas;state.atlasError='';}}
        catch(e){if(current()&&sequence===loadSequence)state.atlasError='暫時無法同步本趟星圖預留補給。';}
        return current()&&sequence===loadSequence;
      }catch(e){if(current()&&sequence===loadSequence)state.error=e.message;return false;}
      finally{if(current()&&sequence===loadSequence){state.loading=false;notify();}}
    }
    async function makePlan(kind,keyValue) {
      await readPlayer(kind!=='settings');
      if(kind==='settings')return settingsPlan(state.me,draft,state.atlas);
      if(kind==='refill')return refillPreview(state.me,state.shop || {});
      const entry=catalogEntries(state.shop,state.meta || {}).find(row=>row.key===keyValue);
      return purchasePlan(entry,draft.quantities[keyValue] ?? '1',state.me);
    }
    async function prepare(kind,keyValue=null) {
      if(!current()||state.busy||state.loading||state.pending)return false;
      state.busy=true;state.error='';state.notice='';state.result=null;notify();
      try{const plan=await makePlan(kind,keyValue);if(!current())return false;state.confirmation=plan;return true;}
      catch(e){if(current())state.error=e.message;return false;}
      finally{if(current()){state.busy=false;notify();}}
    }
    async function tellChanged(result){if(!current())return;try{await host.onChanged?.(result);}catch{}}
    function successMessage(operation,data) {
      if(operation.action==='settings')return '自動喝水設定已保存。';
      if(operation.action==='refill')return '已補充紅水 '+fmt(data.result?.red || 0)+' 瓶、藍水 '+fmt(data.result?.blue || 0)+' 瓶，實際花費 '+fmt(data.result?.cost)+' 金幣'+(data.result?.partial?'（本次為部分補充）。':'。');
      return '已購買 '+operation.plan.name+' × '+fmt(operation.plan.quantity)+'，請在背包查看。';
    }
    async function perform(operation,retry=false) {
      try{
        const data=await host.request(operation.action,copy(operation.body));checkScope(data,true);
        state.me=data;syncSettings(operation.action==='settings');
        state.result={message:successMessage(operation,data),itemId:data.result?.item?.id || null};
        state.confirmation=null;savePending(null);
        await tellChanged(data);if(current())await refresh(true);return true;
      }catch(e){
        if(!current())return false;
        if(e.code==='duplicate'&&PURCHASES.has(operation.action)){
          savePending(null);state.confirmation=null;state.result={message:'這筆購買已處理過，已停止重送並同步目前背包。'};
          await tellChanged({ok:true,replayed:true,action:operation.action});await refresh(true);return true;
        }
        const definite=Number(e.status)>=400&&Number(e.status)<500&&e.uncertain!==true;
        if(definite&&!retry&&!operation.uncertain){savePending(null);state.error=e.message;await refresh(true);state.error=e.message;}
        else{operation.uncertain=true;savePending(operation);state.error=e.message || '尚未收到明確結果，請先核對上一筆操作。';}
        return false;
      }
    }
    async function confirm() {
      if(!current()||state.busy||state.loading||state.pending||!state.confirmation)return false;
      state.busy=true;state.error='';notify();
      try{
        const approved=state.confirmation;
        const fresh=await makePlan(approved.action==='settings'?'settings':approved.action==='refill'?'refill':'purchase',approved.key);
        if(!current())return false;
        if(comparable(fresh)!==comparable(approved)){
          state.confirmation=fresh;state.notice='數量、價格或補給方案已變動，請核對後再次確認。';return false;
        }
        const operation={version:1,scope:copy(scope),action:approved.action,
          body:{...approved.body,requestId:'supply-'+crypto.randomUUID()},plan:copy(approved),
          before:{gold:state.me.character.gold,inventory:copy(state.me.inventory || {}),settings:settingsOf(state.me)},uncertain:false};
        savePending(operation);state.confirmation=null;notify();return await perform(operation);
      }catch(e){if(current())state.error=e.message;return false;}
      finally{if(current()){state.busy=false;notify();}}
    }
    async function retry(){
      if(!current()||state.busy||state.loading||!state.pending||!PURCHASES.has(state.pending.action))return false;
      state.busy=true;state.error='';notify();
      try{return await perform(copy(state.pending),true);}
      finally{if(current()){state.busy=false;notify();}}
    }
    async function checkResult(){
      if(!current()||state.busy||state.loading||!state.pending)return false;
      state.busy=true;state.error='';notify();
      try{
        await readPlayer(tab==='shop');const ledger=await host.request('ledger',{});checkScope(ledger);
        state.ledger=Array.isArray(ledger.ledger)?ledger.ledger:[];state.checked=true;
        const pending=state.pending;
        if(pending.action==='settings'&&Object.entries(pending.body).filter(([k])=>FIELDS.includes(k)).every(([k,v])=>String(settingsOf(state.me)[k])===String(v))){
          savePending(null);syncSettings(true);state.result={message:'目前角色設定與送出的內容一致，已讀回核對。'};await tellChanged(state.me);
        }else state.notice='已讀回目前金幣、背包及最近紀錄。以下是現況核對，不會重新送出設定或補滿。';
        return true;
      }catch(e){if(current())state.error=e.message;return false;}
      finally{if(current()){state.busy=false;notify();}}
    }
    function acknowledge(){
      if(!current()||state.busy||!state.pending||!state.checked)return false;
      savePending(null);state.notice='已結束這筆結果核對，沒有再次送出操作。';notify();return true;
    }
    function cancel(){if(!current()||state.busy||!state.confirmation)return false;state.confirmation=null;state.notice='';notify();return true;}
    function setSetting(field,value){if(FIELDS.includes(field)){draft.settings ||= {};draft.settings[field]=value;draft.settingsTouched[field]=true;}}
    function update(snapshot){
      if(!current()||!snapshot)return false;
      if(String(snapshot.realmId)!==scope.realmId||String(snapshot.characterId)!==scope.characterId)return false;
      if(snapshot.run!==undefined){
        const incoming=snapshot.supplies||snapshot.live?.supplies;
        let run=snapshot.run;
        if(run?.id===state.atlas?.run?.id&&hasSupplyItems(state.atlas?.run?.supplies)&&!hasSupplyItems(run?.supplies))run={...run,supplies:state.atlas.run.supplies};
        state.atlas={...state.atlas,realmId:scope.realmId,characterId:scope.characterId,run,
          ...(incoming&&(!hasSupplyItems(state.atlas?.supplies)||hasSupplyItems(incoming))?{supplies:incoming}:{})};
      }
      return true;
    }
    return {state,draft,scope,refresh,preparePurchase:key=>prepare('purchase',key),prepareRefill:()=>prepare('refill'),
      prepareSettings:()=>prepare('settings'),confirm,retry,checkResult,acknowledge,cancel,setSetting,update,current,
      entries:()=>catalogEntries(state.shop || {},state.meta || {}),dispose(){disposed=true;loadSequence++;}};
  }
  function reservedHtml(state){
    const run=state.atlas?.run,active=!!run&&(run.active===true||run.status==='running');
    const defs=state.meta?.meta?.items || state.meta?.items || {};
    const name=key=>defs[key]?.name||((String(key).startsWith('red_')?'紅水':'藍水')+' '+String(key).slice(-1)+' 階');
    const summary=(items,empty)=>SUPPLY_KEYS.filter(key=>Number(items?.[key])>0).map(key=>name(key)+' × '+fmt(items[key])).join('、')||empty;
    let details='';
    if(active&&hasSupplyItems(run.supplies)){
      details='<p>剩餘：'+esc(summary(run.supplies.items,'皆已用完'))+'</p><p>已用：'+esc(summary(run.supplies.usedItems,'尚未使用'))+'</p>';
      const policy=run.supplies.policy;
      if(policy){
        const choice=key=>key==='auto'?'最低階優先':name(key);
        const setting='紅水低於'+fmt(policy.hpThresholdPct)+'% · '+choice(policy.hpPreference)+'；藍水 '+(policy.autoBlue?fmt(policy.mpThresholdPct)+'% 以下或技能魔力不足時 · '+choice(policy.mpPreference):'自動使用關閉');
        details+='<p>本趟設定：'+esc(setting)+'。</p>';
      }
    }
    return '<h4>本趟星圖已預留</h4><p>'+(active?'紅水 <b>'+fmt(run.supplies?.hp || 0)+'</b> 瓶 · 藍水 <b>'+fmt(run.supplies?.mp || 0)+'</b> 瓶':
      state.atlasError?esc(state.atlasError):'目前沒有進行中的星圖出征。')+'</p>'+details+'<small>已預留的補給不在背包中。購買與設定修改不改變當趟快照；返營後退回未用部分。</small>';
  }
  function confirmationHtml(plan,metadata={}){
    if(!plan)return '';
    const defs=metadata.meta?.items || metadata.items || {};
    const labels={autoRedPct:'紅水門檻',autoBlue:'自動藍水',autoBluePct:'藍水門檻',autoRedPotion:'指定紅水',autoBluePotion:'指定藍水'};
    let detail=plan.action==='settings'?'<dl>'+Object.entries(plan.body).map(([key,value])=>'<div><dt>'+esc(labels[key])+'</dt><dd>'+esc(key.endsWith('Pct')?value+'%':key==='autoBlue'?(value?'開啟':'關閉'):value==='auto'?'最低階優先':defs[value]?.name || value)+'</dd></div>').join('')+'</dl>':
      plan.rows?'<ul>'+plan.rows.filter(row=>row.quantity).map(row=>'<li>'+esc(row.name)+' × '+fmt(row.quantity)+'</li>').join('')+'</ul>':
      '<p>'+esc(plan.name)+' × '+fmt(plan.quantity)+' · 單價 '+fmt(plan.price)+' 金幣</p>';
    return '<section class="supply-confirm" aria-labelledby="supply-confirm-title"><h3 id="supply-confirm-title">'+esc(plan.name)+'</h3>'+detail+
      (plan.action!=='settings'?'<strong class="supply-cost">本次總計 '+fmt(plan.total)+' 金幣</strong>':'')+
      (plan.partial?'<p>金幣不足以補滿 24 小時，本次只購買上述數量。</p>':'')+'<p>'+esc(plan.description)+'</p>'+
      '<div class="supply-actions"><button type="button" data-supply-cancel>返回修改</button><button type="button" class="is-primary" data-supply-confirm>確認'+(plan.action==='settings'?'保存':'購買')+'</button></div></section>';
  }
  function pendingHtml(state){
    const pending=state.pending;if(!pending)return '';
    const labels={buy:'購買道具','buy-gear':'購買裝備',gacha:'購買轉蛋',refill:'補滿藥水',settings:'保存設定'};
    return '<section class="supply-pending" role="status"><h3>上一筆'+esc(labels[pending.action])+'尚待核對</h3><p>'+esc(pending.plan?.name || '')+
      ' · 原操作編號 <small>'+esc(pending.body.requestId)+'</small></p><p>請先核對結果，再進行下一筆。'+
      (PURCHASES.has(pending.action)?'重試只會使用原編號與原數量。':'這個舊版操作沒有完整收據查詢，不會自動或手動重送。')+'</p>'+
      '<div class="supply-actions"><button type="button" data-supply-check '+(state.busy?'disabled':'')+'>讀回背包與最近紀錄</button>'+
      (PURCHASES.has(pending.action)?'<button type="button" data-supply-retry '+(state.busy?'disabled':'')+'>以原編號確認購買結果</button>':'')+'</div>'+
      (state.checked?'<div class="supply-check-result"><p>送出前金幣 '+fmt(pending.before?.gold)+' → 目前 '+fmt(state.me?.character?.gold)+'</p>'+
        '<ul>'+Object.keys(pending.before?.inventory || {}).concat(Object.keys(state.me?.inventory || {})).filter((key,index,all)=>all.indexOf(key)===index&&(pending.before.inventory[key]||0)!==(state.me.inventory[key]||0)).map(key=>'<li>'+esc(state.meta?.meta?.items?.[key]?.name || state.meta?.items?.[key]?.name || key)+'：'+fmt(pending.before.inventory[key] || 0)+' → '+fmt(state.me.inventory[key] || 0)+'</li>').join('')+'</ul>'+
        '<p>掛機或其他操作也可能改變餘額，請配合下方最近紀錄核對。</p><div class="supply-ledger">'+state.ledger.slice(0,8).map(row=>'<p>'+esc(row.type)+' · 金幣 '+fmt(row.gold_delta)+' · '+esc(row.item || '')+' '+fmt(row.item_delta)+'</p>').join('')+'</div>'+
        '<button type="button" data-supply-ack>我已核對，結束本次確認</button></div>':'')+'</section>';
  }
  function createArt(host,src,alt=''){
    if(!src)return '';
    let resolved;try{resolved=host.artUrl?host.artUrl(src):src;}catch{return '';}
    if(typeof resolved!=='string'||/^(?:javascript|data|vbscript):/i.test(resolved))return '';
    return '<img src="'+esc(resolved)+'" alt="'+esc(alt)+'" loading="lazy">';
  }
  function render(state,draft,host={}){
    const me=state.me,blocked=state.busy||state.loading||!!state.pending||!!state.confirmation;
    const toolbar='<div class="supply-toolbar"><button type="button" data-supply-route="supplies" '+(state.tab==='supplies'?'aria-current="page"':'')+'>補給設定</button><button type="button" data-supply-route="shop" '+(state.tab==='shop'?'aria-current="page"':'')+'>商店</button><button type="button" data-supply-refresh '+(state.busy||state.loading?'disabled':'')+'>重新同步</button></div>';
    const notices=(state.error?'<p class="supply-error" role="alert">'+esc(state.error)+'</p>':'')+(state.notice?'<p class="supply-note" role="status">'+esc(state.notice)+'</p>':'')+
      (state.result?'<section class="supply-result" role="status"><p>'+esc(state.result.message)+'</p><button type="button" data-supply-result-item="'+esc(state.result.itemId || '')+'">'+(state.result.itemId?'查看購入裝備':'前往背包')+'</button></section>':'');
    if(!me)return '<section class="scene-supply">'+toolbar+notices+'<p role="status">'+(state.loading?'正在同步目前角色的補給…':'尚未讀取角色，請重新同步。')+'</p></section>';
    const settings=draft.settings || settingsOf(me),supply=me.supply || {},defs=state.meta?.meta?.items || state.meta?.items || {};
    const header='<header class="supply-header"><div><small>營地 · '+(state.tab==='shop'?'商店':'補給')+'</small><h3>'+esc(me.character.name)+'</h3></div><p>金幣 <strong data-supply-gold>'+fmt(me.character.gold)+'</strong></p></header>';
    const reserves='<aside class="supply-reserved" data-supply-reserved>'+reservedHtml(state)+'</aside>';
    let content='';
    if(state.tab==='supplies'){
      const potionCard=kind=>{
        const red=kind==='red',pct=red?'autoRedPct':'autoBluePct',field=red?'autoRedPotion':'autoBluePotion',label=red?'生命藥水':'魔力藥水';
        const options=supply[kind+'Options'] || [],held=options.reduce((sum,p)=>sum+Number(me.inventory?.[p.key] || 0),0);
        return '<section class="supply-potion"><h4>'+label+' <small>背包共 '+fmt(held)+' 瓶</small></h4>'+
          (red?'<p>紅水依門檻自動使用。</p>':'<label class="supply-check"><input type="checkbox" name="autoBlue" '+(settings.autoBlue?'checked':'')+'> 自動使用藍水</label>')+
          '<label>'+(kind==='red'?'低於':'低於或等於')+'此比例時使用<div class="supply-percent"><input type="number" name="'+pct+'" min="20" max="80" step="1" inputmode="numeric" value="'+esc(settings[pct])+'"><span>%</span></div></label>'+
          '<label>自動飲用種類<select name="'+field+'"><option value="auto" '+(settings[field]==='auto'?'selected':'')+'>自動選擇（最低階先喝）</option>'+
          options.map(p=>'<option value="'+esc(p.key)+'" '+(settings[field]===p.key?'selected ':'')+(!p.unlocked&&!(p.count>0)?'disabled':'')+'>'+esc(p.name)+' · '+(red?'生命':'魔力')+' +'+fmt(p.heal)+' · 持有 '+fmt(me.inventory?.[p.key] || 0)+(!p.unlocked?'（未解鎖購買）':'')+'</option>').join('')+'</select></label>'+
          '<small>'+(supply[kind+'LowUse']?'原版掛機目前消耗極低，達門檻才使用。':'原版掛機預估可用 '+fmt(supply[kind+'Hours'])+' 小時。')+'</small></section>';
      };
      content='<p class="supply-note">'+(hasSupplyItems(state.atlas?.supplies)?'已保存設定會供原版玩法與下一趟 Atlas 使用，攜帶數量於派遣時選擇。':'原版自動喝水設定與 Atlas 攜帶量分開。')+'自動藍水開啟時，達門檻或技能魔力不足才補水；關閉則不使用。指定種類只使用該藥水。</p>'+
        '<form data-supply-settings><div class="supply-potion-grid">'+potionCard('red')+potionCard('blue')+'</div>'+
        '<button type="submit" class="is-primary">保存喝水設定</button></form>'+
        '<section class="supply-refill"><h4>補充背包藥水</h4><p>以已保存的飲用種類補滿原版掛機 24 小時；金幣不足時可按比例補充。先預覽實際種類、數量與總價。</p>'+
        '<button type="button" data-supply-refill '+(!(me.refill?.cost>0)?'disabled':'')+'>'+(me.refill?.cost>0?'預覽補滿方案':'背包補給已充足')+'</button></section>'+
        '<div class="supply-actions"><button type="button" data-supply-route="expedition">配置 Atlas 攜帶補給</button><button type="button" data-supply-route="inventory">查看背包</button></div>';
    }else{
      const entries=catalogEntries(state.shop || {},state.meta || {}),search=String(draft.search || '').trim().toLocaleLowerCase();
      const filtered=entries.filter(e=>(draft.category==='all'||e.category===draft.category)&&(!search||(e.name+' '+e.description).toLocaleLowerCase().includes(search)));
      const pages=Math.max(1,Math.ceil(filtered.length/16));draft.page=Math.min(pages-1,Math.max(0,draft.page || 0));
      content='<div class="supply-filters"><label>商品種類<select name="supplyCategory">'+CATEGORIES.map(([value,label])=>'<option value="'+value+'" '+(draft.category===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
        '<label>名稱搜尋<input type="search" name="supplySearch" value="'+esc(draft.search || '')+'" placeholder="搜尋目前可買商品"></label></div>'+
        '<p class="supply-note">顯示目前職業、路線與等級可購買的商品。價格與限購條件沿用原商店；已用每日額度由伺服器確認。</p>'+
        '<div class="supply-offers">'+filtered.slice(draft.page*16,(draft.page+1)*16).map(entry=>{
          const value=draft.quantities[entry.key] ?? '1',quantity=entry.action==='buy-gear'?1:Number(value);
          let problem='';try{purchasePlan(entry,value,me);}catch(e){problem=e.message;}
          const icon=entry.iconSrc?createArt(host,entry.iconSrc):/^(red|blue)_[1-4]$/.test(entry.item || '')?createArt(host,'/art/potions-20261019/'+entry.item+'.webp'):'';
          return '<article class="supply-offer" data-supply-offer="'+esc(entry.key)+'">'+(icon?'<div class="supply-icon">'+icon+'</div>':'')+
            '<div class="supply-offer-info"><h4>'+esc(entry.name)+'</h4><p>'+esc(entry.description)+'</p>'+
            (entry.action==='buy-gear'?'<small>T'+fmt(entry.tier)+' · Lv.'+fmt(entry.levelReq)+(entry.branch?' · '+esc(entry.branch)+' 路線':'')+'</small>':'<small>目前持有 '+fmt(me.inventory?.[entry.item] || 0)+(entry.maxHold?' · 上限 '+fmt(entry.maxHold):'')+(entry.dailyBuy?' · 每日限購 '+fmt(entry.dailyBuy):'')+'</small>')+
            (entry.rates?.length?'<small>'+entry.rates.map(rate=>esc(({legendary:'傳說',supreme:'霸主'})[rate.rarity] || rate.rarity)+' '+fmt(rate.pct)+'%').join(' · ')+'</small>':'')+
            '<p class="supply-unit-price">單價 '+fmt(entry.price)+' 金幣</p></div><div class="supply-order">'+
            (entry.action==='buy-gear'?'<span>每次購買 1 件</span>':'<label>數量<input type="number" name="quantity:'+esc(entry.key)+'" data-supply-quantity="'+esc(entry.key)+'" min="1" max="9999" step="1" inputmode="numeric" value="'+esc(value)+'"></label>')+
            '<span data-supply-total>'+(problem?esc(problem):'總計 '+fmt(quantity*entry.price)+' 金幣')+'</span><button type="button" data-supply-buy="'+esc(entry.key)+'" '+(problem?'disabled':'')+'>預覽購買</button></div></article>';
        }).join('')+(filtered.length?'':'<p class="supply-empty">目前篩選沒有可購買的商品。</p>')+'</div>'+
        '<nav class="supply-pages" aria-label="商店分頁"><button type="button" data-supply-page="-1" '+(!draft.page?'disabled':'')+'>上一頁</button><span>'+fmt(draft.page+1)+'／'+fmt(pages)+'</span><button type="button" data-supply-page="1" '+(draft.page>=pages-1?'disabled':'')+'>下一頁</button></nav>';
    }
    return '<section class="scene-supply">'+header+toolbar+notices+reserves+pendingHtml(state)+confirmationHtml(state.confirmation,state.meta || {})+
      '<div class="supply-workspace" '+(blocked?'inert':'')+'>'+content+'</div></section>';
  }
  function mount(root,host,options={}){
    if(typeof document!=='undefined'&&!document.querySelector('link[data-scene-supply-style]')){
      const sheet=document.createElement('link'),script=document.querySelector('script[src*="scene-supply-ui.js"]');
      sheet.rel='stylesheet';sheet.dataset.sceneSupplyStyle='true';sheet.href=new URL('scene-supply-ui.css?v=unified-ui-20261104',script?.src || document.baseURI).href;document.head.append(sheet);
    }
    let disposed=false,client,previousConfirmation=null,confirmationScroll=0,composing=null,painting=false;
    function paint(){
      if(disposed||painting||!client?.current()||(composing&&root.contains(composing)))return;
      painting=true;
      try{
        const active=root.contains(document.activeElement)?document.activeElement:null,name=active?.name,start=active?.selectionStart,end=active?.selectionEnd,scroll=root.scrollTop;
        const opening=!!client.state.confirmation&&!previousConfirmation,closing=!client.state.confirmation&&!!previousConfirmation;if(opening)confirmationScroll=scroll;
        root.innerHTML=render(client.state,client.draft,host);root.scrollTop=closing?confirmationScroll:scroll;
        previousConfirmation=client.state.confirmation;
        if(opening){root.querySelector('.supply-confirm')?.scrollIntoView?.({block:'nearest'});root.querySelector('[data-supply-cancel]')?.focus({preventScroll:true});}
        if(name){const target=[...root.querySelectorAll('[name]')].find(node=>node.name===name);target?.focus({preventScroll:true});try{if(start!=null)target?.setSelectionRange(start,end);}catch{}}
      }finally{painting=false;}
    }
    client=createClient(host,options,paint);
    function input(event){
      if(disposed||painting||!client?.current())return;
      const node=event.target;
      if(node.dataset.supplyQuantity){
        const key=node.dataset.supplyQuantity;client.draft.quantities[key]=node.value;
        const entry=client.entries().find(row=>row.key===key),card=node.closest('[data-supply-offer]');let issue='';
        try{purchasePlan(entry,node.value,client.state.me);}catch(e){issue=e.message;}
        const total=card?.querySelector('[data-supply-total]'),buy=card?.querySelector('[data-supply-buy]');
        if(total)total.textContent=issue || '總計 '+fmt(Number(node.value)*entry.price)+' 金幣';if(buy)buy.disabled=!!issue;return;
      }
      // Removing a focused search input can synchronously fire change during innerHTML replacement.
      if(node.name==='supplySearch'){if(event.type==='change')return;client.draft.search=node.value;client.draft.page=0;if(!event.isComposing&&composing!==node)paint();return;}
      if(node.name==='supplyCategory'){client.draft.category=node.value;client.draft.page=0;paint();return;}
      if(FIELDS.includes(node.name))client.setSetting(node.name,node.type==='checkbox'?node.checked:node.value);
    }
    function compositionStart(event){if(!disposed&&client.current()&&event.target?.name==='supplySearch')composing=event.target;}
    function compositionEnd(event){if(event.target!==composing)return;composing=null;input(event);}
    function click(event){
      const node=event.target.closest?.('button');if(!node||!root.contains(node)||node.disabled)return;
      if(node.dataset.supplyRoute){if(!client.state.busy)host.navigate?.(node.dataset.supplyRoute);return;}
      if(node.hasAttribute('data-supply-result-item')){host.navigate?.(node.dataset.supplyResultItem?'item':'inventory',node.dataset.supplyResultItem?{itemId:node.dataset.supplyResultItem}:{});return;}
      if(node.hasAttribute('data-supply-refresh')){void client.refresh();return;}
      if(node.hasAttribute('data-supply-refill')){void client.prepareRefill();return;}
      if(node.dataset.supplyBuy){void client.preparePurchase(node.dataset.supplyBuy);return;}
      if(node.hasAttribute('data-supply-confirm')){void client.confirm();return;}
      if(node.hasAttribute('data-supply-cancel')){client.cancel();return;}
      if(node.hasAttribute('data-supply-retry')){void client.retry();return;}
      if(node.hasAttribute('data-supply-check')){void client.checkResult();return;}
      if(node.hasAttribute('data-supply-ack')){client.acknowledge();return;}
      if(node.dataset.supplyPage){client.draft.page=Math.max(0,client.draft.page+Number(node.dataset.supplyPage));paint();}
    }
    function submit(event){if(event.target.matches('[data-supply-settings]')){event.preventDefault();void client.prepareSettings();}}
    root.addEventListener('input',input);root.addEventListener('change',input);root.addEventListener('click',click);root.addEventListener('submit',submit);
    root.addEventListener('compositionstart',compositionStart);root.addEventListener('compositionend',compositionEnd);
    paint();void client.refresh();
    return {update(snapshot){if(client.update(snapshot)){const reserved=root.querySelector('[data-supply-reserved]');if(reserved)reserved.innerHTML=reservedHtml(client.state);}},
      handleBack(){if(client.state.busy)return true;return client.cancel();},
      dispose(){disposed=true;composing=null;client.dispose();root.removeEventListener('input',input);root.removeEventListener('change',input);root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);}};
  }
  window.RpgSceneSupply={mount,createClient,catalogEntries,purchasePlan,refillPreview,settingsPlan,render,confirmationHtml,reservedHtml};
})();
