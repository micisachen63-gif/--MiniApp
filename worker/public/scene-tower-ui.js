/* Tower workshop in the shared battle window.
 * Reads: tower/scene and tower/receipt. Mutations: original tower/action only.
 * Selectors: data-st-action, data-item-id, data-offer-id, data-title-id, data-tab;
 * data-st-ready, data-st-tab, data-st-confirm, data-st-pending, data-st-receipt-found.
 * Unknown operations are never replayed by reads. Explicit recovery reuses the exact original body/ID.
 */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const identityKey=c=>JSON.stringify(['accountId','realmId','characterId'].map(k=>String(c?.[k]??'')));
  const scopeKey=c=>JSON.stringify(['accountId','realmId','characterId','epoch'].map(k=>String(c?.[k]??'')));
  const reasonText=value=>typeof value==='string'?value:value?.message||'';
  const pendingMemory=new Map(),sheets=new WeakMap(),scriptUrl=globalThis.document?.currentScript?.src;
  const TABS=[['imprint','塔印淬鍊'],['offers','徽記兌換'],['titles','登塔稱號']];
  const requestId=()=> 'st_'+(globalThis.crypto?.randomUUID?.().replaceAll('-','')||Date.now().toString(36)+Math.random().toString(36).slice(2,14));
  function validBody(body,withId=false) {
    if(!body||typeof body!=='object'||Array.isArray(body))return false;
    const fields={imprint:['itemId','from'],redeem:['offerId'],title:['titleId']}[body.op];
    if(!fields||Object.keys(body).some(k=>!['op','requestId',...fields].includes(k)))return false;
    if(withId&&(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(body.requestId)))return false;
    if(body.op==='imprint')return typeof body.itemId==='string'&&body.itemId.length>0&&body.itemId.length<=160&&Number.isInteger(body.from)&&body.from>=0&&body.from<5;
    if(body.op==='redeem')return typeof body.offerId==='string'&&body.offerId.length>0&&body.offerId.length<=80;
    return typeof body.titleId==='string'&&body.titleId.length<=80;
  }
  function validPending(record,identity) {
    return !!record&&record.version===1&&record.scope===identity&&record.action==='tower/action'&&validBody(record.body,true)
      &&record.body.requestId===record.id&&typeof record.label==='string'&&record.label.length<=180&&typeof record.details==='string'&&record.details.length<=1800;
  }
  function resultMatches(record,result) {
    const body=record.body;
    if(!result||result.op!==body.op||!Number.isSafeInteger(result.cost)||result.cost<0)return false;
    if(body.op==='imprint')return String(result.itemId)===body.itemId&&result.from===body.from&&result.to===body.from+1;
    if(body.op==='redeem')return typeof result.item==='string'&&Number.isSafeInteger(result.quantity)&&result.quantity>0&&(!record.expectedItem||result.item===record.expectedItem);
    return String(result.title?.id||'')===body.titleId&&result.cost===0;
  }
  function createClient(host) {
    const context={...host.getContext?.()},identity=identityKey(context),scope=scopeKey(context);
    let storage=host.storage; if(!storage){try{storage=globalThis.sessionStorage;}catch{}}
    const storageKey='rpg-st-workshop-pending:'+identity;
    const state={data:null,loading:false,checking:false,busy:false,stale:true,error:'',notice:'',confirm:null,receipt:null,checkedPending:null,revision:-1,minRevision:-1,receivedAt:0};
    let disposed=false,generation=0,receiptGeneration=0,controller=null,receiptController=null;
    const current=()=>!disposed&&scopeKey(host.getContext?.())===scope&&host.current?.()!==false;
    const notify=()=>{if(current())host.onState?.(state);};
    function pending(){
      if(pendingMemory.has(identity))return pendingMemory.get(identity);
      let value=null;try{const record=JSON.parse(storage?.getItem?.(storageKey)||'null');if(validPending(record,identity))value=record;}catch{}
      pendingMemory.set(identity,value);return value;
    }
    function savePending(value){pendingMemory.set(identity,value);try{if(value)storage?.setItem?.(storageKey,JSON.stringify(value));else storage?.removeItem?.(storageKey);}catch{}}
    function clearPending(id){if(pending()?.id===id){savePending(null);state.receipt=null;state.checkedPending=null;}}
    const fingerprint=()=>JSON.stringify([state.data?.character,state.data?.tower,state.data?.readOnly]);
    function feedback(message,error=false){if(!current())return;state[error?'error':'notice']=message;notify();}
    function verifyIdentity(value,required=true){
      for(const k of ['accountId','realmId','characterId'])if((required||value?.[k]!=null)&&String(value?.[k])!==String(context[k]))throw Error('角色或世界已切換，請重新開啟塔印工坊');
    }
    function accept(value){
      if(!value||value.ok!==true||!value.character||!value.tower||!['equipment','offers','titles','areas'].every(k=>Array.isArray(value.tower[k])))throw Error('塔印資料尚未完整，請重新整理');
      verifyIdentity(value);if(String(value.character.tgId??value.character.id)!==String(context.characterId))throw Error('收到其他角色的塔印資料');
      const revision=Number(value.character.revision??value.character.rev);
      if(!Number.isFinite(revision)||revision<Math.max(state.revision,state.minRevision))throw Error('收到較早的角色資料，請重新整理');
      return revision;
    }
    // A revision-only re-read keeps the current buttons until the answer arrives.
    var backgroundRead=false;
    async function refresh(){
      const quiet=backgroundRead;backgroundRead=false;
      if(!current()||state.busy||state.checking)return false;
      const ticket=++generation,before=fingerprint();controller?.abort();controller=new AbortController();
      state.loading=true;state.error='';if(!quiet)notify();
      try{
        const value=await host.request('tower/scene',{}, {signal:controller.signal});
        if(!current()||ticket!==generation)return false;
        state.revision=accept(value);state.data=clone(value);state.receivedAt=Date.now();state.stale=false;
        if(state.confirm&&before!==fingerprint()){state.confirm=null;state.notice='角色或持有量已更新，請重新確認操作。';}
        return true;
      }catch(error){if(!current()||ticket!==generation)return false;state.stale=true;state.confirm=null;state.error=error?.message||'暫時無法讀取塔印工坊';return false;}
      finally{if(current()&&ticket===generation){state.loading=false;notify();}}
    }
    function readiness(){
      if(!current())return '角色或世界已切換';
      if(state.busy||state.loading||state.checking)return '正在更新工坊資料';
      if(state.data?.readOnly)return state.data.readOnlyReason||'這個世界目前只能查看資料';
      if(pending())return '請先核對上次操作結果';
      if(!state.data||state.stale||state.revision<state.minRevision)return '請先更新工坊資料';
      if(state.data.tower.canOperate!==true)return reasonText(state.data.tower.blockedReason)||'目前無法使用塔印工坊';
      return '';
    }
    function prepare(body,label,details,{quiet=false}={}){
      const reason=readiness();if(reason){feedback(reason,true);return false;}
      if(!validBody(body)||body.requestId!=null)throw Error('不支援的塔印操作');
      const expectedItem=body.op==='redeem'?state.data.tower.offers.find(x=>x.id===body.offerId)?.item:null;
      state.error='';state.notice='';state.confirm={body:clone(body),label,details,expectedItem,fingerprint:fingerprint(),recovery:false};
      if(!quiet)notify();return true;
    }
    function cancel(){if(!current()||state.busy)return;state.confirm=null;notify();}
    function recoveryReason(){
      if(!current())return '角色或世界已切換';
      if(state.busy||state.loading||state.checking)return '正在核對上次操作';
      if(state.data?.readOnly)return state.data.readOnlyReason||'這個世界目前只能查看資料';
      if(!state.data||state.stale||state.revision<state.minRevision)return '請先更新工坊資料';
      const record=pending();if(!record||!validPending(record,identity))return '沒有可恢復的原操作';
      if(state.receipt?.requestId!==record.id||state.receipt?.found!==false)return '請先以原操作編號查詢收據';
      return '';
    }
    function prepareRecovery(){
      const reason=recoveryReason();if(reason){feedback(reason,true);return false;}
      const record=clone(pending());
      state.error='';state.confirm={body:record.body,label:'重試這筆原操作',details:record.label+'。'+record.details+' 尚未查到收據，原操作可能仍在處理。確認後會以完全相同的操作編號與內容再送一次；若已完成，會取得同一份結果。',record,recovery:true,fingerprint:fingerprint()};
      notify();return true;
    }
    async function send(record,recovery){
      savePending(record);state.confirm=null;state.busy=true;state.checkedPending=null;state.receipt=null;state.error='';state.notice='';
      generation++;receiptGeneration++;controller?.abort();receiptController?.abort();notify();let acknowledged=false;
      try{
        const value=await host.request('tower/action',clone(record.body));
        if(!current())return false;
        if(!value||value.ok!==true||!value.tower||!resultMatches(record,value.result))throw Object.assign(Error('未收到匹配的塔印操作收據'),{uncertain:true});
        verifyIdentity(value,false);clearPending(record.id);acknowledged=true;state.stale=true;
        state.notice=record.label+'已完成。';
        if(Number.isFinite(Number(value.character?.revision)))state.minRevision=Math.max(state.minRevision,Number(value.character.revision));
        try{host.onChanged?.(value,{body:clone(record.body),recovery});}catch{}
      }catch(error){
        if(!current())return false;
        const status=Number(error?.status),uncertain=recovery||error?.uncertain||!Number.isInteger(status)||status<400||status>=500||/duplicate|request|character_changed|stale|context/i.test(String(error?.code||''));
        if(!uncertain)clearPending(record.id);
        state.stale=true;state.error=uncertain?'操作結果待核對。請查詢原操作收據；畫面更新不會再次送出。':error?.message||'操作尚未完成，請重新確認條件';
      }finally{
        if(current()){state.busy=false;notify();if(acknowledged||!pending()){const error=state.error;await refresh();if(error&&!state.error){state.error=error;notify();}}}
      }
      return acknowledged;
    }
    async function submit(){
      if(!current()||!state.confirm)return false;
      const plan=state.confirm;
      if(plan.fingerprint!==fingerprint()){state.confirm=null;feedback('資料已更新，請重新確認這次操作。',true);return false;}
      if(plan.recovery){
        const reason=recoveryReason(),record=pending();
        if(reason||!record||record.id!==plan.record.id||JSON.stringify(record)!==JSON.stringify(plan.record)){state.confirm=null;feedback(reason||'待核對操作已變更，請重新查詢。',true);return false;}
        return send(clone(record),true);
      }
      const reason=readiness();if(reason){feedback(reason,true);return false;}
      const id=requestId(),record={version:1,scope:identity,id,action:'tower/action',body:{...clone(plan.body),requestId:id},label:plan.label,details:plan.details,expectedItem:plan.expectedItem||null,at:Date.now()};
      if(!validPending(record,identity))throw Error('塔印操作內容不完整');
      return send(record,false);
    }
    async function execute(body,label,details=''){if(!prepare(body,label,details,{quiet:true}))return false;return submit();}
    async function checkPending(){
      const record=pending();if(!current()||!record||state.busy||state.loading||state.checking)return false;
      if(!await refresh()||!current()||pending()?.id!==record.id)return false;
      const ticket=++receiptGeneration;receiptController?.abort();receiptController=new AbortController();state.checking=true;state.receipt=null;state.checkedPending=null;state.error='';notify();
      try{
        const value=await host.request('tower/receipt',clone(record.body),{signal:receiptController.signal});
        if(!current()||ticket!==receiptGeneration||pending()?.id!==record.id)return false;
        verifyIdentity(value);
        if(value?.ok!==true||value.requestId!==record.id||typeof value.found!=='boolean')throw Error('未收到這筆原操作的有效收據');
        if(value.found&&(!resultMatches(record,value.result)||!value.receipt||value.receipt.item!=='tower_fragment'||!Number.isSafeInteger(value.receipt.itemDelta)||value.receipt.itemDelta!==-value.result.cost))throw Error('收據與原操作不一致，請稍後重新核對');
        if(!value.found&&(value.result!=null||value.receipt!=null))throw Error('收據狀態不一致，請重新查詢');
        state.receipt=clone(value);state.checkedPending=value.found?record.id:null;
        state.notice=value.found?'已找到這筆原操作的完成收據。':'尚未查到完成收據；原操作可能仍在處理。';
        return true;
      }catch(error){if(!current()||ticket!==receiptGeneration)return false;state.receipt=null;state.checkedPending=null;state.error=error?.message||'暫時無法核對原操作';return false;}
      finally{if(current()&&ticket===receiptGeneration){state.checking=false;notify();}}
    }
    function acknowledge(){
      const record=pending();
      if(!current()||!record||state.busy||state.loading||state.checking||state.stale||state.revision<state.minRevision||state.checkedPending!==record.id||state.receipt?.found!==true)return false;
      clearPending(record.id);state.error='';state.notice='已核對原操作收據。';notify();return true;
    }
    function update(scene){
      if(!current())return;
      for(const k of ['accountId','realmId','characterId'])if(scene?.[k]!=null&&String(scene[k])!==String(context[k]))return;
      const revision=Number(scene?.live?.revision??scene?.character?.revision??scene?.actor?.revision);if(!Number.isFinite(revision))return;
      state.minRevision=Math.max(state.minRevision,revision);
      if(revision>state.revision&&!state.busy&&!state.loading&&!state.checking){state.stale=true;if(state.confirm){state.confirm=null;state.notice='角色狀態已更新，請重新確認。';}backgroundRead=true;void refresh();}
    }
    return {state,context,current,pending,readiness,recoveryReason,feedback,refresh,prepare,prepareRecovery,cancel,submit,execute,checkPending,acknowledge,update,
      dispose(){if(disposed)return;disposed=true;generation++;receiptGeneration++;controller?.abort();receiptController?.abort();}};
  }
  function ensureStyle(root){
    const doc=root.ownerDocument;if(!doc?.head||!doc.createElement||sheets.has(doc))return;
    const link=doc.createElement('link');link.rel='stylesheet';link.href=scriptUrl?new URL('scene-tower-ui.css?v=20261105',scriptUrl).href:'scene-tower-ui.css?v=20261105';
    link.onerror=()=>{sheets.delete(doc);link.remove?.();};doc.head.appendChild(link);sheets.set(doc,link);
  }
  function mount(root,host,options={}){
    ensureStyle(root);const draft=host.draft||{};draft.tab=TABS.some(([key])=>key===(options.tab||draft.tab))?options.tab||draft.tab:'imprint';draft.itemId=options.itemId||draft.itemId||'';
    let disposed=false,timer=null,focusConfirm=false,savedFocus=null,confirmationOrigin=null,focusAfterCancel=null,revealFrame=null,revealId=null,revealedId=null;
    const client=createClient({...host,onState:()=>paint(),onChanged:(value,operation)=>{if(client.current())host.onChanged?.(value,operation);}});
    const state=client.state,data=()=>state.data,tower=()=>data()?.tower,disabled=()=>!!client.readiness();
    const muted=value=>'<p class="st-muted">'+esc(value)+'</p>',art=path=>host.artUrl?.(path)||'/'+path;
    const button=(action,label,{itemId,offerId,titleId,tab,primary=false,disabled:locked=false}={})=>'<button type="button" data-st-action="'+action+'"'+(itemId?' data-item-id="'+esc(itemId)+'"':'')+(offerId?' data-offer-id="'+esc(offerId)+'"':'')+(titleId!=null?' data-title-id="'+esc(titleId)+'"':'')+(tab?' data-tab="'+esc(tab)+'"':'')+(locked?' disabled':'')+(primary?' class="st-primary is-primary"':'')+'>'+esc(label)+'</button>';
    function resultText(record,result){
      if(!result)return '';
      if(record.body.op==='imprint')return '原裝備的塔印 '+fmt(result.from)+' → '+fmt(result.to)+' 階，消耗 '+fmt(result.cost)+' 枚徽記。';
      if(record.body.op==='redeem')return '取得 '+(tower()?.offers?.find(x=>x.item===result.item)?.name||result.item)+' × '+fmt(result.quantity)+'，消耗 '+fmt(result.cost)+' 枚徽記。';
      return result.title?'已佩戴「'+result.title.name+'」。':'已卸下登塔稱號。';
    }
    function notices(){
      let html=state.error?'<p class="st-feedback st-error" role="alert">'+esc(state.error)+'</p>':'';
      if(state.notice)html+='<p class="st-feedback" role="status">'+esc(state.notice)+'</p>';
      if(data()?.readOnly)html+='<p class="st-feedback">'+esc(data().readOnlyReason||'這個世界目前只能查看資料')+'</p>';
      if(state.stale&&data())html+=muted('目前顯示上次取得的資料；更新成功後才能繼續操作。');
      const record=client.pending();if(!record)return html;
      const receipt=state.receipt,waiting=state.busy||state.loading||state.checking;
      html+='<section class="st-pending" data-st-pending role="status"><h3>上次操作待核對</h3><p>'+esc(record.label)+'。</p>'+muted(record.details)+
        '<p>請用原操作編號查詢收據。重新開窗、換頁與背景更新都不會再次送出。</p>'+
        (receipt?'<div data-st-receipt-found="'+receipt.found+'">'+(receipt.found?'<p>'+esc(resultText(record,receipt.result))+'</p>':muted('目前尚無完成收據，可能仍在處理。可稍後重查，或明確確認後用原操作編號重試。'))+'</div>':'')+
        '<div class="st-actions">'+button('check-pending',state.checking?'核對中…':'查詢原操作收據',{disabled:waiting})+
        (receipt?.found===true?button('acknowledge','已核對收據',{primary:true,disabled:waiting||state.stale||state.checkedPending!==record.id}):receipt?.found===false?button('retry','重試這筆原操作',{disabled:!!client.recoveryReason()}):'')+'</div></section>';
      return html;
    }
    function confirmation(){
      const c=state.confirm;if(!c)return '';
      return '<section class="st-confirm" data-st-confirm aria-labelledby="st-confirm-title"><h3 id="st-confirm-title">'+esc(c.label)+'？</h3><p>'+esc(c.details)+'</p><div class="st-actions">'+button('confirm',c.recovery?'確認重試原操作':'確認'+c.label,{primary:true,disabled:!!(c.recovery?client.recoveryReason():client.readiness())})+button('cancel','取消',{disabled:state.busy})+'</div></section>';
    }
    function summary(){
      const t=tower();if(!t)return '';
      return '<section class="st-summary"><div><span class="st-kicker">每一步，都留下刻印</span><h3>最高通關 '+fmt(t.best)+' 層</h3>'+muted(t.daily?.used?'今日已使用登塔機會；台灣時間 00:00 重置。':'今日尚可挑戰一次，出發時才使用。')+
        '<p>目前稱號：<strong>'+esc(t.title?.name||'尚未佩戴')+'</strong></p></div><div class="st-badges"><img src="'+esc(art('art/ui/item-tower_fragment-20261012.webp'))+'" alt=""><strong data-st-badges>'+fmt(t.badges)+'</strong><span>星穹徽記</span></div></section>'+
        (t.canOperate!==true?'<p class="st-feedback">'+esc(reasonText(t.blockedReason)||'目前無法使用工坊；仍可查看登塔紀錄。')+'</p>':'');
    }
    function imprint(){
      const items=tower()?.equipment||[],item=items.find(x=>x.id===draft.itemId)||items.find(x=>x.canImprint)||items.find(x=>!x.equipped)||items[0];
      if(!item)return '<section class="st-empty"><h3>將旅程刻入既有裝備</h3>'+muted('持有裝備後，就能用徽記淬鍊塔印。')+button('equipment','查看持有裝備')+'</section>';
      draft.itemId=item.id;const x=item.towerImprint;if(!x)return muted('裝備塔印資料尚未完整，請更新後再查看。');
      return '<section data-st-imprint="'+esc(item.id)+'"><label class="st-select">選擇現有裝備<select name="towerEquipment"'+(state.busy?' disabled':'')+'>'+items.map(i=>'<option value="'+esc(i.id)+'"'+(i.id===item.id?' selected':'')+'>+'+fmt(i.enhance)+' '+esc(i.name)+' · 塔印 '+fmt(i.towerImprint?.level)+'／'+fmt(i.towerImprint?.max)+(i.equipped?' · 裝備中':'')+'</option>').join('')+'</select></label>'+
        '<article class="st-imprint-card"><div><span class="st-kicker">塔印 '+fmt(x.level)+'／'+fmt(x.max)+' · 主能力 +'+fmt(x.bonusPct)+'%</span><h3>+'+fmt(item.enhance)+' '+esc(item.name)+'</h3><p class="st-stat">'+esc(item.statName)+' <b>'+fmt(item.stat)+'</b>'+(x.nextStat!=null?' → <strong>'+fmt(x.nextStat)+'</strong>':'')+'</p></div><span class="st-seal" aria-hidden="true">'+(['✧','Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ'][x.level]||'✧')+'</span></article>'+
        muted('每階增加 2% 裝備主能力，最高 10%。保留現有強化、詞條、元素與外觀。請先卸下裝備；交易或背景作業中的裝備需先解除占用。')+
        (item.imprintReason?'<p class="st-feedback">'+esc(reasonText(item.imprintReason))+'</p>':'')+
        '<div class="st-actions">'+button('imprint',Number(x.level)>=Number(x.max)?'塔印已圓滿':'刻下第 '+fmt(Number(x.level)+1)+' 階 · '+fmt(x.cost)+' 徽記',{itemId:item.id,primary:true,disabled:disabled()||item.canImprint!==true})+button('equipment','查看持有裝備')+'</div>'+
        muted('塔印附著於這件裝備，無法移轉；裝備破碎時塔印也會消失。')+'</section>';
    }
    function offers(){
      return '<section><h3>為下一次突破準備</h3>'+muted('使用已取得的星穹徽記，將卷軸存入目前角色背包。每次張數以這裡顯示的角色資料為準。')+
        '<div class="st-card-grid">'+(tower()?.offers||[]).map(o=>'<article class="st-card" data-st-offer="'+esc(o.id)+'"><img class="st-item-icon" src="'+esc(art('art/items-scrolls-cutout-20261011/'+o.item+'.webp'))+'" alt=""><h4>'+esc(o.name)+'</h4><p>每次 '+fmt(o.quantity)+' 張 · '+fmt(o.cost)+' 枚徽記</p>'+
          (o.reason?muted(reasonText(o.reason)):'')+button('redeem','兌換',{offerId:o.id,primary:true,disabled:disabled()||o.canRedeem!==true})+'</article>').join('')+'</div></section>';
    }
    function titles(){
      const t=tower();
      return '<section><h3>你的登塔足跡</h3>'+muted('稱號隨最高通關層數解鎖，僅改變外觀，不增加戰力。')+
        '<div class="st-card-grid">'+(t?.titles||[]).map(v=>'<article class="st-card" data-st-title="'+esc(v.id)+'"><span class="st-kicker">通關 '+fmt(v.floor)+' 層</span><h4>'+esc(v.name)+'</h4>'+(v.reason?muted(reasonText(v.reason)):'')+
          button('title',t.title?.id===v.id?'佩戴中':v.unlocked?'佩戴稱號':'尚未解鎖',{titleId:v.id,disabled:disabled()||v.canEquip!==true})+'</article>').join('')+'</div>'+
        (t?.title?'<div class="st-actions">'+button('title','卸下登塔稱號',{titleId:'',disabled:disabled()})+'</div>':'')+'</section>';
    }
    function cancelReveal(){if(revealFrame!==null)globalThis.cancelAnimationFrame?.(revealFrame);revealFrame=null;revealId=null;}
    function revealPendingOnce(){
      const record=client.pending();if(!record){cancelReveal();return;}
      if(state.busy||state.loading||state.checking||state.confirm||record.id===revealedId||typeof globalThis.requestAnimationFrame!=='function')return;
      if(revealFrame!==null&&revealId===record.id)return;cancelReveal();const id=record.id;revealId=id;
      revealFrame=globalThis.requestAnimationFrame(()=>{if(revealId!==id)return;revealFrame=null;revealId=null;if(disposed||!client.current()||!root.isConnected||root.ownerDocument?.hidden||state.busy||state.loading||state.checking||state.confirm||client.pending()?.id!==id)return;
        const panel=root.querySelector?.('[data-st-pending]'),entry=root.querySelector?.('[data-st-action="check-pending"]');if(!panel||!entry||entry.disabled)return;
        revealedId=id;savedFocus=null;panel.scrollIntoView?.({block:'nearest',behavior:'auto'});entry.focus?.({preventScroll:true});});
    }
    function paint(){
      if(disposed||!client.current())return;
      const top=root.scrollTop,doc=root.ownerDocument,active=doc?.activeElement;
      if(focusAfterCancel){savedFocus=focusAfterCancel;focusAfterCancel=null;}
      else if(root.contains?.(active))savedFocus=focusIdentity(active);
      else if(active&&active!==doc?.body&&active!==doc?.documentElement)savedFocus=null;
      const focus=savedFocus;
      root.innerHTML='<div class="st-panel" data-st-ready="'+(!state.loading&&!state.stale&&!!data()?'1':'0')+'" data-st-tab="'+draft.tab+'" aria-busy="'+(state.loading||state.busy||state.checking)+'">'+
        '<header class="st-header"><div><h2>塔印工坊</h2><p>'+esc(data()?.character?.name||host.getActor?.()?.name||'')+'</p></div>'+button('refresh',state.loading?'更新中…':'更新資料',{disabled:state.loading||state.busy||state.checking})+'</header>'+
        '<nav class="st-tabs" aria-label="塔印工坊">'+TABS.map(([key,label])=>'<button type="button" data-st-action="tab" data-tab="'+key+'" aria-pressed="'+(draft.tab===key)+'"'+(state.busy?' disabled':'')+'>'+label+'</button>').join('')+'</nav>'+
        notices()+confirmation()+(!data()?muted('正在讀取登塔紀錄與徽記…'):summary()+(draft.tab==='offers'?offers():draft.tab==='titles'?titles():imprint()))+
        '<div class="st-footer">'+button('tower','前往三人爬塔')+'</div></div>';
      root.scrollTop=top;
      if(state.confirm&&focusConfirm){focusConfirm=false;root.scrollTop=0;root.querySelector?.('[data-st-confirm]')?.scrollIntoView?.({block:'nearest'});root.querySelector?.('[data-st-action="cancel"]')?.focus?.({preventScroll:true});}
      else if(focus){const node=[...root.querySelectorAll?.('button,select')||[]].find(n=>focus.name?n.name===focus.name:n.dataset.stAction===focus.action&&n.dataset.itemId===focus.item&&n.dataset.offerId===focus.offer&&n.dataset.titleId===focus.title&&n.dataset.tab===focus.tab&&!!n.closest?.('[data-st-pending]')===focus.pending);node?.focus?.({preventScroll:true});}
      revealPendingOnce();
    }
    function focusIdentity(node){return node?{name:node.name,action:node.dataset?.stAction,item:node.dataset?.itemId,offer:node.dataset?.offerId,title:node.dataset?.titleId,tab:node.dataset?.tab,pending:!!node.closest?.('[data-st-pending]')}:null;}
    function cancelConfirmation(){if(state.confirm&&!state.busy){focusAfterCancel=confirmationOrigin;confirmationOrigin=null;}client.cancel();}
    function prepare(body,label,details,origin){confirmationOrigin=focusIdentity(origin);focusConfirm=true;if(!client.prepare(body,label,details)){focusConfirm=false;confirmationOrigin=null;}}
    async function click(event){
      const b=event.target?.closest?.('[data-st-action]');if(!b||b.disabled||!root.contains?.(b)||!client.current())return;
      const action=b.dataset.stAction;
      if(action==='refresh')return client.refresh();
      if(action==='cancel')return cancelConfirmation();
      if(action==='confirm')return client.submit();
      if(action==='check-pending')return client.checkPending();
      if(action==='acknowledge')return client.acknowledge();
      if(action==='retry'){confirmationOrigin=focusIdentity(b);focusConfirm=true;if(!client.prepareRecovery()){focusConfirm=false;confirmationOrigin=null;}return;}
      if(state.busy||state.checking)return;
      if(action==='tower'){host.navigate?.('tower',{tab:'areas'});return;}
      if(action==='equipment'){host.navigate?.('inventory',{});return;}
      if(action==='tab'){if(!TABS.some(([key])=>key===b.dataset.tab))return;draft.tab=b.dataset.tab;client.cancel();paint();return;}
      const reason=client.readiness();if(reason)return client.feedback(reason,true);
      const t=tower();
      if(action==='imprint'){
        const item=t.equipment.find(i=>i.id===b.dataset.itemId),x=item?.towerImprint;
        if(!item||!x||item.canImprint!==true)return client.feedback(reasonText(item?.imprintReason)||'這件裝備目前無法淬鍊。',true);
        return prepare({op:'imprint',itemId:item.id,from:x.level},'刻下第 '+fmt(Number(x.level)+1)+' 階塔印','+'+fmt(item.enhance)+' '+item.name+'，'+item.statName+' '+fmt(item.stat)+' → '+fmt(x.nextStat)+'。消耗 '+fmt(x.cost)+' 枚星穹徽記，確定成功；保留既有強化、詞條與元素。塔印無法移轉，裝備破碎時也會消失。',b);
      }
      if(action==='redeem'){
        const offer=t.offers.find(o=>o.id===b.dataset.offerId);
        if(!offer||offer.canRedeem!==true)return client.feedback(reasonText(offer?.reason)||'目前無法兌換此項目。',true);
        return prepare({op:'redeem',offerId:offer.id},'兌換'+offer.name,'消耗 '+fmt(offer.cost)+' 枚星穹徽記，取得 '+fmt(offer.quantity)+' 張'+offer.name+'，存入目前角色背包。',b);
      }
      if(action==='title'){
        const title=t.titles.find(v=>v.id===b.dataset.titleId);
        if(b.dataset.titleId&&(!title||title.canEquip!==true))return client.feedback(reasonText(title?.reason)||'尚未解鎖這個稱號。',true);
        return client.execute({op:'title',titleId:b.dataset.titleId||''},title?'佩戴「'+title.name+'」':'卸下登塔稱號','稱號僅改變外觀，不消耗徽記、不增加戰力。');
      }
    }
    function change(event){if(!client.current()||!root.contains?.(event.target)||state.busy)return;if(event.target.name==='towerEquipment'){draft.itemId=event.target.value;client.cancel();paint();}}
    const visibility=()=>{if(!root.ownerDocument?.hidden&&client.current()&&!state.busy&&!state.loading&&!state.checking&&!state.confirm)void client.refresh();};
    root.addEventListener('click',click);root.addEventListener('change',change);root.ownerDocument?.addEventListener?.('visibilitychange',visibility);
    timer=globalThis.setInterval?.(()=>{if(client.current()&&!root.ownerDocument?.hidden&&!state.busy&&!state.loading&&!state.checking&&!state.confirm&&root.ownerDocument?.activeElement?.name!=='towerEquipment')void client.refresh();},15000);
    paint();void client.refresh();
    return {refresh:client.refresh,update:client.update,handleBack(){if(state.confirm){cancelConfirmation();return true;}return false;},
      dispose(){if(disposed)return;disposed=true;cancelReveal();client.dispose();if(timer!==null)globalThis.clearInterval?.(timer);root.removeEventListener('click',click);root.removeEventListener('change',change);root.ownerDocument?.removeEventListener?.('visibilitychange',visibility);}};
  }
  globalThis.RpgSceneTower={createClient,mount};
})();
