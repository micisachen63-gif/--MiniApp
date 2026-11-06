/* Single HUD-v2 window for person-to-person trades.
 * Original trade actions are gated by explicit review, durable UUID, pure
 * receipt recovery, and cross-tab Web Locks in scene-direct-trade-client.js. */
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
    const doc=root.ownerDocument,actionFactory=globalThis.RpgSceneDirectTradeActions;
    if(!actionFactory || typeof actionFactory.createClient!=='function')
      throw Error('安全交易模組尚未載入；此視窗不開放任何交易操作');
    if(!doc.querySelector('link[data-scene-direct-trade-style]')){
      const link=doc.createElement('link'),source=doc.querySelector('script[src*="scene-direct-trade-ui.js"]');
      link.rel='stylesheet';link.dataset.sceneDirectTradeStyle='true';
      link.href=new URL('scene-direct-trade-ui.css?v=direct-trade-actions-20261106',source?.src||doc.baseURI).href;
      doc.head.append(link);
    }
    root.classList.add('scene-direct-trade');
    const client=createClient({...host,onState:()=>paint()}),state=client.state;
    let actionClient=null,actionTradeId=null,rendering=false,goldDraft=null;
    let eligibleState=null,eligibleController=null,eligibleGeneration=0;
    const quantityDrafts=new Map();
    const node=(tag,cls='',text='')=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
    const control=(label,onClick,cls='')=>{const el=node('button',cls,label);el.type='button';el.onclick=onClick;return el;};
    const statusText=(label,cls='sdt-status')=>{const el=node('p',cls,label);el.setAttribute('role','status');return el;};
    const names={gold:'調整保管金幣',add:'放入資產',remove:'取回保管資產',lock:'鎖定報價',confirm:'確認交換',cancel:'取消並退回託管'};
    const summary=(kind,fields)=>kind==='gold'?names[kind]+' · '+fmt(fields.gold)
      :['add','remove'].includes(kind)?names[kind]+' · '+(fields.equipId||fields.sigilId||fields.item||'')+
        (fields.qty==null?'':(' × '+fmt(fields.qty))):names[kind]||'未知操作';
    function resetEligible(){
      eligibleGeneration++;eligibleController?.abort();eligibleController=null;eligibleState=null;quantityDrafts.clear();
    }
    const destroyActions=()=>{actionClient?.dispose();actionClient=null;actionTradeId=null;goldDraft=null;resetEligible();};
    const eligibleKey=trade=>{
      const ctx=host.getContext?.()||{};
      return JSON.stringify([ctx.accountId,ctx.realmId,ctx.characterId,ctx.epoch,trade.id,trade.offerRev]);
    };
    function eligibleRequest(trade,{reset=false}={}){
      const state=eligibleState,key=eligibleKey(trade);
      if(!state||state.key!==key||!client.current()||state.loading)return;
      if(!reset&&(!state.loaded||!state.nextCursor))return;
      const ticket=++eligibleGeneration,ctx=host.getContext?.()||{};
      eligibleController?.abort();eligibleController=new AbortController();
      const cursor=reset?null:state.nextCursor;
      state.loading=true;state.error='';if(!rendering)paint();
      void host.request('trade/eligible-scoped',{
        accountId:ctx.accountId,realmId:ctx.realmId,selectedCharacterId:ctx.characterId,
        contextEpoch:ctx.epoch,tradeId:trade.id,kind:state.kind,...(cursor?{cursor}:{})
      },{signal:eligibleController.signal}).then(reply=>{
        if(!client.current()||ticket!==eligibleGeneration||eligibleState!==state||eligibleKey(trade)!==state.key)return;
        if(!reply||reply.ok!==true||reply.schemaVersion!==1||reply.pureRead!==true||
          reply.accountId!==ctx.accountId||reply.realmId!==ctx.realmId||
          reply.characterId!==ctx.characterId||reply.contextEpoch!==ctx.epoch||
          reply.tradeId!==trade.id||reply.offerRev!==trade.offerRev||reply.kind!==state.kind||
          !Array.isArray(reply.items)||reply.items.length>30||
          reply.items.some(item=>!['equip','item','guardian'].includes(item.kind)||
            typeof item.ref!=='string'||!item.ref||!Number.isSafeInteger(item.qty)||item.qty<1)||
          reply.nextCursor!==null&&(typeof reply.nextCursor!=='string'||reply.nextCursor.length>1600))
          throw Error('可交易物品清單與目前交易版本不符，請重新整理');
        const records=reset?[]:state.items.slice();
        for(const item of reply.items)if(!records.some(x=>x.kind===item.kind&&x.ref===item.ref))records.push(item);
        state.items=records;state.nextCursor=reply.nextCursor;state.loaded=true;state.canAdd=reply.canAdd===true;
      }).catch(error=>{
        if(client.current()&&ticket===eligibleGeneration&&eligibleState===state)
          state.error=error?.message||'可交易物品讀取失敗，請重試';
      }).finally(()=>{
        if(client.current()&&ticket===eligibleGeneration&&eligibleState===state){
          state.loading=false;eligibleController=null;if(!rendering)paint();
        }
      });
    }
    function ensureEligible(trade){
      const key=eligibleKey(trade);
      if(!eligibleState||eligibleState.key!==key){
        resetEligible();
        eligibleState={key,kind:'all',items:[],nextCursor:null,loading:false,loaded:false,error:'',canAdd:false};
        eligibleRequest(trade,{reset:true});
      }
      return eligibleState;
    }
    function chooseEligibleKind(kind,trade){
      if(!['all','equip','item','guardian'].includes(kind)||!eligibleState||eligibleState.loading)return;
      if(eligibleState.kind===kind)return;
      eligibleState.kind=kind;eligibleState.items=[];eligibleState.nextCursor=null;eligibleState.loaded=false;
      quantityDrafts.clear();eligibleRequest(trade,{reset:true});
    }
    function ensureActions(trade){
      if(actionTradeId!==trade.id){
        destroyActions();
        const tradeId=trade.id;
        actionClient=actionFactory.createClient({...host,tradeId,
          current:()=>client.current()&&state.selectedId===tradeId&&host.current?.()!==false,
          onState:()=>{if(!rendering)paint();},
          onChanged:(receipt,meta)=>{goldDraft=null;resetEligible();if(client.current()&&state.selectedId===tradeId)void client.refresh();host.onChanged?.(receipt,meta);}
        });
        actionTradeId=tradeId;
      }
      if(actionClient.state.offerRev!==trade.offerRev)actionClient.update(trade);
      return actionClient;
    }
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
    function reviewPanel(ops,view){
      const container=node('section','sdt-operation sdt-review'),kind=view.kind;
      container.append(node('h4','','確認原始交易操作'),node('p','sdt-meta',summary(kind,view.fields)));
      container.append(node('p','sdt-meta','交易：'+(ops.state.pending?.scope?.tradeId||actionTradeId||'')));
      container.append(node('p','sdt-meta','報價版本：'+fmt(view.offerRev)));
      if(view.recovery){
        container.append(node('p','sdt-warning','本次只使用已保存的同一 UUID 與原始參數；不得改成新的交易意圖。'));
        container.append(node('p','sdt-meta','原始 UUID：'+(view.record?.requestId||'')));
      }else{
        container.append(node('p','sdt-warning','確認後將提交原始交易，可能實際移動物品或金幣。回覆不明時只查原收據，不會自動再送出。'));
      }
      const buttons=node('div','sdt-buttons');
      const submit=control(view.recovery?'確認同筆恢復':'確認送出',()=>void ops.submit(),'sdt-primary');
      submit.dataset.directTradeSubmit='true';
      buttons.append(submit,control('返回修改',()=>ops.cancelReview(),'sdt-secondary'));
      container.append(buttons);return container;
    }
    function pendingPanel(ops,record){
      const section=node('section','sdt-operation sdt-pending');
      section.append(node('h4','','上筆交易待核對'));
      section.append(node('p','sdt-meta',summary(record.kind,record.fields)));
      section.append(node('p','sdt-meta','原始 UUID：'+record.requestId));
      section.append(node('p','sdt-meta','提交次數：'+fmt(record.attempts)));
      section.append(node('p','sdt-warning','此筆未核對前，禁止在同一交易視窗建立新操作，也不會自動重送。'));
      const buttons=node('div','sdt-buttons'),check=control('查詢原始收據',()=>void ops.checkPending(),'sdt-primary');
      check.dataset.directTradeCheck='true';check.disabled=ops.state.checking||ops.state.busy;
      buttons.append(check);
      const receipt=ops.state.receipt;
      if(receipt?.found===true){
        section.append(statusText('已核對：這筆原始交易已提交。','sdt-success'));
        const ack=control('確認已完成並結案',()=>void ops.acknowledge(),'sdt-secondary');
        ack.dataset.directTradeAck='true';ack.disabled=ops.state.busy;buttons.append(ack);
      }else if(receipt?.found===false){
        section.append(statusText(receipt.recoveryAllowed?'尚未找到原收據；可在確認後恢復原筆操作。':'尚未找到原收據，且目前不允許恢復，請保留原紀錄。'));
        if(receipt.recoveryAllowed){
          const recover=control('檢視同筆恢復內容',()=>ops.prepareRecovery(),'sdt-secondary');
          recover.dataset.directTradeRecover='true';buttons.append(recover);
        }
      }
      section.append(buttons);return section;
    }
    function eligiblePanel(trade,ops){
      const eligible=ensureEligible(trade),panel=node('section','sdt-eligible');
      panel.append(node('h5','','選擇可放入的裝備、道具或守護羽毛'));
      panel.append(node('p','sdt-muted','可選清單只讀取現有背包；按「檢視放入」不會立即扣除資產，仍需再次確認。'));
      const tabs=node('div','sdt-eligible-tabs');
      for(const [kind,title] of [['all','全部'],['equip','裝備'],['item','道具'],['guardian','守護羽毛']]){
        const button=control(title,()=>chooseEligibleKind(kind,trade),'sdt-secondary');
        button.dataset.directTradeEligibleKind=kind;button.setAttribute('aria-pressed',String(eligible.kind===kind));
        button.disabled=eligible.loading;tabs.append(button);
      }
      panel.append(tabs);
      if(eligible.error){
        const error=node('p','sdt-error',eligible.error);error.setAttribute('role','alert');panel.append(error);
        const retry=control('重新載入可選資產',()=>eligibleRequest(trade,{reset:true}),'sdt-secondary');
        retry.dataset.directTradeEligibleRetry='true';panel.append(retry);
      }
      if(eligible.loading)panel.append(statusText('正在讀取可交易資產…'));
      const list=node('div','sdt-eligible-list');
      for(const item of eligible.items){
        const row=node('article','sdt-eligible-item'),ref=String(item.ref);
        row.append(node('p','sdt-eligible-name',String(item.name||ref)));
        row.append(node('p','sdt-meta',(item.kind==='equip'?'裝備':item.kind==='guardian'?'守護羽毛':'道具')+
          ' · 可用 '+fmt(item.qty)+(item.kind==='equip'?' · 強化 +'+fmt(item.enhance||0):'')));
        const button=control('檢視放入',()=>{},'sdt-secondary');
        button.dataset.directTradeEligibleRef=ref;
        button.dataset.directTradeEligibleType=item.kind;
        button.disabled=ops.state.busy||!eligible.canAdd;
        if(item.kind==='item'){
          const label=node('label','sdt-eligible-quantity','放入數量');
          const input=node('input'),draftKey=item.kind+':'+ref;
          input.type='number';input.min='1';input.step='1';input.inputMode='numeric';
          input.max=String(Math.min(item.qty,99999));input.value=quantityDrafts.get(draftKey)||'1';
          input.dataset.directTradeEligibleQty=ref;
          input.oninput=()=>quantityDrafts.set(draftKey,input.value);
          label.append(input);row.append(label);
          button.onclick=()=>{
            const raw=quantityDrafts.get(draftKey)||input.value;
            const qty=/^\d+$/.test(raw)?Number(raw):NaN;
            if(!Number.isSafeInteger(qty)||qty<1||qty>Math.min(99999,item.qty)){
              const error=node('p','sdt-error','放入數量超出目前可用庫存');error.setAttribute('role','alert');
              row.append(error);return;
            }
            ops.prepare('add',{item:ref,qty},trade);
          };
        }else button.onclick=()=>ops.prepare('add',
          item.kind==='equip'?{equipId:ref}:{sigilId:ref},trade);
        row.append(button);list.append(row);
      }
      if(!eligible.loading&&eligible.loaded&&!eligible.items.length)
        list.append(node('p','sdt-muted',eligible.nextCursor?'此頁沒有符合條件的資產，可繼續下一頁。':'目前沒有可交易資產。'));
      panel.append(list);
      if(eligible.nextCursor){
        const more=control('載入下一頁可交易資產',()=>eligibleRequest(trade),'sdt-secondary');
        more.dataset.directTradeEligibleNext='true';more.disabled=eligible.loading;panel.append(more);
      }
      return panel;
    }
    function mutationPanel(trade,ops){
      const rootPanel=node('section','sdt-operation');
      const st=ops.state;
      rootPanel.append(node('h4','','安全交易操作'));
      if(st.error){const err=node('p','sdt-error',st.error);err.setAttribute('role','alert');rootPanel.append(err);}
      if(st.notice)rootPanel.append(statusText(st.notice));
      if(st.lockError)rootPanel.append(node('p','sdt-error',st.lockError));
      if(st.storageError)rootPanel.append(node('p','sdt-error',st.storageError));
      const pending=ops.pending();
      if(st.busy||st.checking)rootPanel.append(statusText(st.checking?'正在核對原收據…':'正在核對交易提交結果…'));
      if(st.confirm){
        rootPanel.append(reviewPanel(ops,st.confirm));
        return rootPanel;
      }
      if(pending){
        rootPanel.append(pendingPanel(ops,pending));
        return rootPanel;
      }
      if(trade.status!=='open'||trade.expiryPendingMaintenance||st.lockError||st.storageError){
        rootPanel.append(node('p','sdt-muted','這筆交易目前不適合送出操作，請先確認交易狀態。'));
        return rootPanel;
      }
      if(!['a','b'].includes(trade.me)||!plain(trade[trade.me])){
        rootPanel.append(node('p','sdt-error','此交易沒有可驗證的本人權限，操作已停用。'));
        return rootPanel;
      }
      const mine=trade[trade.me],bothLocked=trade.a.locked===true&&trade.b.locked===true;
      if(!mine.locked){
        const form=node('form','sdt-gold-form'),label=node('label','','保管金幣（整數，0～1,000,000）'),input=node('input');
        input.type='number';input.min='0';input.max='1000000';input.step='1';input.inputMode='numeric';
        if(!goldDraft||goldDraft.tradeId!==trade.id||goldDraft.offerRev!==trade.offerRev)
          goldDraft={tradeId:trade.id,offerRev:trade.offerRev,raw:String(mine.gold??0)};
        input.value=goldDraft.raw;
        input.oninput=()=>{goldDraft={tradeId:trade.id,offerRev:trade.offerRev,raw:input.value};};
        input.dataset.directTradeGold='true';input.setAttribute('aria-label','保管金幣');
        label.append(input);form.append(label);
        const submit=control('檢視金幣調整',()=>{},'sdt-secondary');submit.type='submit';
        submit.dataset.directTradeGoldReview='true';form.append(submit);
        form.onsubmit=event=>{
          event.preventDefault();
          const raw=goldDraft?.tradeId===trade.id&&goldDraft.offerRev===trade.offerRev?goldDraft.raw:input.value;
          const n=/^\d+$/.test(raw)?Number(raw):NaN;
          if(Number.isSafeInteger(n)&&n>=0&&n<=1000000)ops.prepare('gold',{gold:n},trade);
          else ops.prepare('gold',{gold:NaN},trade);
        };
        rootPanel.append(form);
        rootPanel.append(eligiblePanel(trade,ops));
        if(Array.isArray(mine.lines)&&mine.lines.length){
          const returned=node('section','sdt-return'),group=node('div','sdt-buttons');
          returned.append(node('h5','','取回自己已託管的物品'));
          for(const line of mine.lines){
            const key=line.kind==='equip'?'equipId':line.kind==='sigil'?'sigilId':line.kind==='item'?'item':null;
            if(!key||!active(line.ref))continue;
            const fields={[key]:line.ref};
            const label='檢視取回 '+(line.name||line.ref)+(key==='item'?'（全部）':'');
            const btn=control(label,()=>ops.prepare('remove',fields,trade),'sdt-secondary');
            btn.dataset.directTradeRemove=line.ref;group.append(btn);
          }
          if(group.children.length){returned.append(group);rootPanel.append(returned);}
        }
      }
      const actions=node('div','sdt-buttons');
      if(!mine.locked){
        const lock=control('檢視鎖定報價',()=>ops.prepare('lock',{},trade),'sdt-secondary');
        lock.dataset.directTradeLock='true';actions.append(lock);
      }
      if(bothLocked&&!mine.ok){
        const confirm=control('檢視最後交換確認',()=>ops.prepare('confirm',{},trade),'sdt-primary');
        confirm.dataset.directTradeConfirm='true';actions.append(confirm);
      }
      const cancel=control('檢視取消交易與退款',()=>ops.prepare('cancel',{},trade),'sdt-danger');
      cancel.dataset.directTradeCancel='true';actions.append(cancel);
      rootPanel.append(actions);return rootPanel;
    }
    function paint(){
      if(!client.current()||rendering)return;
      rendering=true;
      try{
        root.replaceChildren();
        const header=node('section','sdt-header');
        header.append(node('h3','','雙方交易 · 原始收據'));
        const refresh=control('重新讀取',()=>void client.refresh(),'sdt-refresh');
        refresh.dataset.directTradeRefresh='true';refresh.disabled=state.loading;
        header.append(refresh);root.append(header);
        root.append(node('p','sdt-intro','先檢視雙方託管與報價。操作必須再次確認，並使用原始 UUID 紀錄；任何不明回覆都只查收據，不會自動重送。'));
        const status=statusText(state.loading?'讀取交易中…':state.stale?'角色資料已更新，請重新讀取':'');
        root.append(status);
        if(state.error){const alert=node('p','sdt-error',state.error);alert.setAttribute('role','alert');root.append(alert);}
        if(!state.data)return;
        const data=state.data,all=[...data.trades.open,...data.trades.history];
        const selected=state.selectedId?(data.selected?.id===state.selectedId?data.selected:all.find(row=>row.id===state.selectedId)):null;
        if(selected){
          root.append(control('返回交易清單',()=>client.back(),'sdt-back'));
          root.append(node('h4','','交易 '+selected.id));
          root.append(node('p','sdt-meta','狀態：'+selected.status+' · 報價版本 '+fmt(selected.offerRev)+' · 截止 '+clock(selected.expiresAt)));
          if(selected.expiryPendingMaintenance)root.append(node('p','sdt-warning','交易已過期，等待原系統執行退款清算；此視窗不會自動結算。'));
          const sides=node('div','sdt-sides');sides.append(sidePanel('甲方',selected.a),sidePanel('乙方',selected.b));root.append(sides);
          const ops=ensureActions(selected);
          root.append(mutationPanel(selected,ops));
          return;
        }
        destroyActions();
        const trades=node('section','sdt-section');trades.append(node('h4','','進行中 · '+data.trades.open.length));
        const list=node('div','sdt-list');
        for(const trade of all){
          const button=control((trade.a?.name||'甲方')+' ↔ '+(trade.b?.name||'乙方')+' · '+trade.status+
            (trade.expiryPendingMaintenance?' · 逾時待清算':''),()=>{
              if(client.selectTrade(trade.id))void client.refresh();
            },'sdt-card');
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
      }finally{rendering=false;}
    }
    paint();void client.refresh();
    return {client,
      handleBack:()=>{
        if(actionClient?.state.confirm)return actionClient.cancelReview();
        return client.back();
      },
      update:snapshot=>client.update(snapshot),
      dispose:()=>{destroyActions();client.dispose();root.classList.remove('scene-direct-trade');}
    };
  }
  globalThis.RpgSceneDirectTrade={createClient,mount};
})();
