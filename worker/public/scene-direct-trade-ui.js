/* Scoped read-only person-to-person trade views in the existing HUD-v2 window.
 * Intent-bearing actions are not exposed here until durable pending/Web Locks
 * and full browser recovery acceptance exist. */
(() => {
  'use strict';
  const KEYS=['accountId','realmId','characterId','epoch'];
  const scoped=value=>JSON.stringify(KEYS.map(key=>value?.[key]));
  const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const active=value=>typeof value==='string'&&value.length>0;
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const fmt=value=>new Intl.NumberFormat('zh-TW').format(Number(value)||0);
  const clock=value=>integer(value)?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'未知時間';
  function createClient(host){
    const context={...host.getContext?.()},scope=scoped(context);
    if(!KEYS.slice(0,3).every(key=>active(context[key]))||!integer(context.epoch))
      throw Error('請先確認目前帳號、世界與角色');
    const state={data:null,loading:false,error:'',selectedId:host.params?.tradeId||null,stale:false};
    let disposed=false,controller=null,version=0;
    const current=()=>!disposed&&host.current?.()!==false&&scoped(host.getContext?.())===scope;
    const notify=()=>{if(current())host.onState?.(state);};
    function verify(data){
      if(!plain(data)||data.ok!==true||data.schemaVersion!==1||data.pureRead!==true
          ||data.accountId!==context.accountId||data.realmId!==context.realmId
          ||data.characterId!==context.characterId||data.contextEpoch!==context.epoch
          ||!integer(data.revision)||!plain(data.trades)||!plain(data.requests)
          ||!Array.isArray(data.trades.open)||!Array.isArray(data.trades.history)
          ||!Array.isArray(data.requests.incoming)||!Array.isArray(data.requests.outgoing))
        throw Error('交易資料與目前角色不一致，請重新開啟');
      const trades=[...data.trades.open,...data.trades.history];
      if(trades.length>20||data.requests.incoming.length+data.requests.outgoing.length>30)
        throw Error('交易資料筆數超出既有限制，請重新整理');
      for(const trade of trades)if(!active(trade.id)||!plain(trade.a)||!plain(trade.b)||!['open','done','cancelled','expired'].includes(trade.status))
        throw Error('交易清單資料不完整，請重新整理');
      if(state.selectedId&&data.selected&&data.selected.id!==state.selectedId)
        throw Error('所選交易與收據不一致');
      return data;
    }
    async function refresh(){
      if(!current()||state.loading)return false;
      const ticket=++version;
      if(controller)controller.abort();controller=new AbortController();
      state.loading=true;state.error='';notify();
      try{
        const next=await host.request('trade/scene-scoped',{
          accountId:context.accountId,realmId:context.realmId,
          selectedCharacterId:context.characterId,contextEpoch:context.epoch,
          ...(state.selectedId?{tradeId:state.selectedId}:{})
        },{signal:controller.signal});
        if(!current()||ticket!==version)return false;
        state.data=verify(next);state.stale=false;
        notify();return true;
      }catch(error){
        if(current()&&ticket===version){state.error=error?.message||'交易資料暫時無法讀取';notify();}
        return false;
      }finally{
        if(current()&&ticket===version){state.loading=false;controller=null;notify();}
      }
    }
    function selectTrade(id){
      if(!current()||!state.data||!active(id))return false;
      const options=[...state.data.trades.open,...state.data.trades.history];
      if(!options.some(t=>t.id===id))return false;
      state.selectedId=id;notify();return true;
    }
    function back(){if(!current()||!state.selectedId)return false;state.selectedId=null;notify();return true;}
    function update(snapshot){
      if(!current()||!state.data||!snapshot||!integer(snapshot.live?.revision))return false;
      if(snapshot.live.revision>state.data.revision){state.stale=true;notify();return true;}
      return false;
    }
    function dispose(){disposed=true;version++;controller?.abort();controller=null;}
    return {state,current,refresh,selectTrade,back,update,dispose};
  }
  function mount(root,host){
    const doc=root.ownerDocument;
    if(!doc.querySelector('link[data-scene-direct-trade-style]')){
      const link=doc.createElement('link'),source=doc.querySelector('script[src*="scene-direct-trade-ui.js"]');
      link.rel='stylesheet';link.dataset.sceneDirectTradeStyle='true';
      link.href=new URL('scene-direct-trade-ui.css?v=direct-trade-20261106',source?.src||doc.baseURI).href;
      doc.head.append(link);
    }
    root.classList.add('scene-direct-trade');
    const client=createClient({...host,onState:()=>paint()});
    const node=(tag,cls='',text='')=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
    const control=(label,onClick,cls='')=>{const el=node('button',cls,label);el.type='button';el.onclick=onClick;return el;};
    const state=client.state;
    function sidePanel(label,side){
      const card=node('section','sdt-side'),h=node('h4','',label+' · '+(side?.name||'未知角色'));
      card.append(h,node('p','sdt-meta','已保管金幣 '+fmt(side?.gold)+' · '+(side?.locked?'已鎖定':'未鎖定')+' · '+(side?.ok?'已確認':'待確認')));
      const list=node('ul','sdt-assets');
      for(const item of side?.lines||[]){
        const name=String(item?.name||item?.ref||item?.kind||'道具');
        list.append(node('li','',name+' ×'+fmt(item?.qty||1)+(integer(item?.enhance)&&item.enhance?' · +'+item.enhance:'')));
      }
      if(!list.children.length)list.append(node('li','sdt-muted','沒有放入物品'));
      card.append(list);return card;
    }
    function paint(){
      if(!client.current())return;
      root.replaceChildren();
      const header=node('section','sdt-header');
      header.append(node('h3','','雙方交易 · 查詢'));
      const refresh=control('重新讀取',()=>void client.refresh(),'sdt-refresh');
      refresh.dataset.directTradeRefresh='true';refresh.disabled=state.loading;
      header.append(refresh);root.append(header);
      root.append(node('p','sdt-intro','此視窗只讀取原始交易與請求，不會清算逾時交易，也不會執行金幣或物品操作。'));
      const status=node('p','sdt-status',state.loading?'讀取交易中…':state.stale?'角色資料已更新，請重新讀取':'');
      status.setAttribute('role','status');root.append(status);
      if(state.error){const alert=node('p','sdt-error',state.error);alert.setAttribute('role','alert');root.append(alert);}
      if(!state.data)return;
      const data=state.data,all=[...data.trades.open,...data.trades.history];
      const selected=state.selectedId?(data.selected||all.find(row=>row.id===state.selectedId)):null;
      if(selected){
        root.append(control('返回交易清單',()=>client.back(),'sdt-back'));
        root.append(node('h4','','交易 '+selected.id));
        root.append(node('p','sdt-meta','狀態：'+selected.status+' · 報價版本 '+fmt(selected.offerRev)+' · 截止 '+clock(selected.expiresAt)));
        if(selected.expiryPendingMaintenance)
          root.append(node('p','sdt-warning','此交易已過期，等待原系統執行退款清算；本畫面不會代為結算。'));
        const sides=node('div','sdt-sides');sides.append(sidePanel('甲方',selected.a),sidePanel('乙方',selected.b));root.append(sides);
        root.append(node('p','sdt-warning','交易寫入功能須經持久化收據、跨視窗鎖及斷線恢復驗收後才會開放。'));
        return;
      }
      const trades=node('section','sdt-section');trades.append(node('h4','','進行中 · '+data.trades.open.length));
      const list=node('div','sdt-list');
      for(const trade of all){
        const button=control((trade.a?.name||'甲方')+' ↔ '+(trade.b?.name||'乙方')+' · '+trade.status+
          (trade.expiryPendingMaintenance?' · 逾時待清算':''),()=>client.selectTrade(trade.id),'sdt-card');
        button.dataset.directTradeId=trade.id;list.append(button);
      }
      if(!all.length)list.append(node('p','sdt-muted','此角色目前沒有雙方交易。'));
      trades.append(list);root.append(trades);
      const requests=node('section','sdt-section');
      const allRequests=[...data.requests.incoming.map(row=>({row,direction:'收到'})),...data.requests.outgoing.map(row=>({row,direction:'送出'}))];
      requests.append(node('h4','','交易請求 · '+allRequests.length));
      for(const {row,direction} of allRequests)
        requests.append(node('p','sdt-request',direction+' · '+(row.owner?.name||'?')+' ↔ '+(row.requester?.name||'?')+' · '+row.status+
          (row.expiryPendingMaintenance?' · 逾時待更新':'')));
      if(!allRequests.length)requests.append(node('p','sdt-muted','沒有近期交易請求。'));
      root.append(requests);
    }
    paint();void client.refresh();
    return {client,handleBack:()=>client.back(),update:snapshot=>client.update(snapshot),
      dispose:()=>{client.dispose();root.classList.remove('scene-direct-trade');}};
  }
  globalThis.RpgSceneDirectTrade={createClient,mount};
})();
