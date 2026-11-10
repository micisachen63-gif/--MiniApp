/* Durable original-intent direct-trade client. A lost response is never an
 * instruction to POST again; only an explicit same-UUID/body recovery is allowed.
 * All local intent writes are serialized by the browser's native Web Locks. */
(() => {
  'use strict';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KINDS=new Set(['gold','add','remove','lock','confirm','cancel']);
  const SCOPE=['accountId','realmId','characterId','tradeId'];
  const CTX=['accountId','realmId','characterId','epoch'];
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f]/.test(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const keyOf=value=>JSON.stringify(CTX.map(key=>value?.[key]));
  const stable=value=>Object.fromEntries(SCOPE.map(key=>[key,value?.[key]]));
  const storageKeyFor=value=>'rpg-direct-trade-scoped-pending:'+JSON.stringify(SCOPE.map(key=>value?.[key]));
  function payloadOf(kind,fields) {
    if(!KINDS.has(kind)||!plain(fields))return null;
    const keys=Object.keys(fields);
    if(['lock','confirm','cancel'].includes(kind))return keys.length===0?{}:null;
    if(kind==='gold')return keys.length===1&&has(fields,'gold')&&integer(fields.gold)&&fields.gold<=1000000?{gold:fields.gold}:null;
    const asset=['equipId','sigilId','item'].filter(key=>has(fields,key));
    if(asset.length!==1||!id(fields[asset[0]]))return null;
    const key=asset[0],assetKind=key==='equipId'?'equip':key==='sigilId'?'sigil':'item',ref=fields[key];
    if(assetKind!=='item')return keys.length===1?{assetKind,ref,qty:1}:null;
    if(kind==='add')return keys.length===2&&has(fields,'qty')&&integer(fields.qty)&&fields.qty>=1&&fields.qty<=99999
      ?{assetKind,ref,qty:fields.qty}:null;
    if(keys.length===1)return {assetKind,ref,qty:null};
    return keys.length===2&&has(fields,'qty')&&(fields.qty===null||integer(fields.qty)&&fields.qty>=1)
      ?{assetKind,ref,qty:fields.qty}:null;
  }
  function makeId() {
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID().toLowerCase();
    if(!globalThis.crypto?.getRandomValues)throw Error('此瀏覽器無法產生交易 UUID；交易已停止');
    const b=globalThis.crypto.getRandomValues(new Uint8Array(16));
    b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const s=Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
    return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
  }
  const signature=(scope,kind,requestId,offerRev,payload)=>JSON.stringify({
    accountId:scope.accountId,realmId:scope.realmId,characterId:scope.characterId,
    tradeId:scope.tradeId,kind,offerRev,requestId,payload
  });
  function createClient(host) {
    const ctx=clone(host.getContext?.()||{}),tradeId=host.tradeId,scope=stable({...ctx,tradeId});
    if(!SCOPE.every(key=>id(scope[key]))||!integer(ctx.epoch))
      throw Error('請先選定帳號、世界、角色與交易視窗');
    const liveKey=keyOf(ctx),storageKey=storageKeyFor(scope);
    let storage=host.storage; if(!storage)try{storage=globalThis.localStorage;}catch{}
    const locks=host.locks===undefined?globalThis.navigator?.locks:host.locks;
    const lockError=typeof locks?.request==='function'?'':'此瀏覽器不支援跨視窗交易鎖，已停用交易寫入。';
    const state={busy:false,checking:false,confirm:null,pending:null,receipt:null,lastResult:null,
      notice:'',error:'',storageError:'',lockError,offerRev:null};
    let generation=0,disposed=false,receiptController=null,writeController=null;
    const current=()=>!disposed&&host.current?.()!==false&&keyOf(host.getContext?.())===liveKey;
    const notify=()=>{if(current())host.onState?.(state);};
    const message=text=>{if(current()){state.error=text;notify();}return false;};
    function validateStored(r){
      if(!plain(r)||r.schemaVersion!==1||!plain(r.scope)||SCOPE.some(key=>r.scope[key]!==scope[key])||
        !KINDS.has(r.kind)||typeof r.requestId!=='string'||!UUID.test(r.requestId)||
        !integer(r.createdAt)||!integer(r.attempts)||r.attempts<1||!plain(r.fields)||!plain(r.body))return false;
      const payload=payloadOf(r.kind,r.fields);
      if(!payload)return false;
      const b=r.body,allowed=['accountId','realmId','selectedCharacterId','contextEpoch','tradeId','kind','requestId','offerRev','recovery',...Object.keys(r.fields)];
      if(Object.keys(b).length!==allowed.length||allowed.some(key=>!has(b,key))||
        b.accountId!==scope.accountId||b.realmId!==scope.realmId||b.selectedCharacterId!==scope.characterId||
        b.tradeId!==scope.tradeId||b.kind!==r.kind||b.requestId!==r.requestId||
        !integer(b.contextEpoch)||!integer(b.offerRev)||b.recovery!==false||b.offerRev!==r.offerRev||
        !Object.entries(r.fields).every(([key,value])=>same(b[key],value))||
        r.signature!==signature(scope,r.kind,r.requestId,r.offerRev,payload))return false;
      return true;
    }
    function inspect(){
      try{
        if(!storage||['getItem','setItem','removeItem'].some(name=>typeof storage[name]!=='function'))
          throw Error('durable storage unavailable');
        const raw=storage.getItem(storageKey);
        if(raw===null){state.storageError='';state.pending=null;return {raw:null,record:null};}
        if(typeof raw!=='string'||raw.length>12000)throw Error('invalid stored transaction');
        const record=JSON.parse(raw);
        if(!validateStored(record))throw Error('invalid original transaction identity');
        state.storageError='';state.pending=clone(record);return {raw,record};
      }catch{
        state.storageError='原始交易資料無法安全讀取；已停用寫入，請保留目前瀏覽器資料。';
        notify();return null;
      }
    }
    function pending(){const found=inspect();return found?.record?clone(found.record):state.pending?clone(state.pending):null;}
    function match(record){const found=inspect();return found&&found.record&&same(found.record,record)?found:null;}
    function persist(record,previous=null){
      const existing=inspect();
      if(!existing||(previous? !existing.record||!same(existing.record,previous):existing.record!==null))
        throw Error(state.storageError||'另一視窗已有未核對交易');
      if(!validateStored(record))throw Error('本次交易內容不完整，已停止送出');
      const raw=JSON.stringify(record);
      try{storage.setItem(storageKey,raw);if(storage.getItem(storageKey)!==raw)throw Error('storage changed');}
      catch{throw Error('無法確認原交易已可靠儲存，本次不送出');}
      state.pending=clone(record);
    }
    function clearLocked(record){
      const found=inspect();if(!found)return false;
      if(found.record===null)return true;
      if(!same(found.record,record)){state.error='另一視窗已變更交易紀錄，請重新查詢';return false;}
      try{
        storage.removeItem(storageKey);
        if(storage.getItem(storageKey)!==null)throw Error('storage remove failed');
        state.pending=null;return true;
      }catch{
        state.storageError='收據已確認，但交易紀錄尚未安全清除；請再次核對';
        return false;
      }
    }
    async function withLock(work,ticket=generation){
      if(lockError)throw Error(lockError);
      return locks.request(storageKey,{mode:'exclusive'},()=>{
        if(!current()||ticket!==generation)throw Error('交易畫面已切換，原始意圖仍保留');
        return work();
      });
    }
    const clearPending=(record,ticket)=>withLock(()=>clearLocked(record),ticket);
    const wire=(record,recovery)=>({...clone(record.body),contextEpoch:ctx.epoch,recovery:recovery===true});
    function validResult(record,result){
      if(!plain(result))return false;
      const payload=payloadOf(record.kind,record.fields),kind=record.kind;
      if(kind==='gold')return result.gold===payload.gold||result.unchanged===true;
      if(kind==='add'||kind==='remove'){
        if(result[kind==='add'?'added':'removed']!==payload.ref)return false;
        if(payload.assetKind!=='item')return true;
        return kind==='add'?result.qty===payload.qty:integer(result.qty)&&result.qty>0&&
          (payload.qty===null||result.qty<=payload.qty);
      }
      if(kind==='lock')return result.locked===true;
      if(kind==='confirm')return result.confirmed===true&&typeof result.done==='boolean';
      return kind==='cancel'&&result.status==='cancelled';
    }
    function verify(record,value,mutation=false){
      if(!plain(value)||value.ok!==true||value.schemaVersion!==1||
        SCOPE.slice(0,3).some(key=>value[key]!==scope[key])||
        value.contextEpoch!==ctx.epoch||value.tradeId!==scope.tradeId||
        !integer(value.revision)||!integer(value.serverNow)||
        value.kind!==record.kind||value.requestId!==record.requestId||
        value.offerRev!==record.offerRev||value.signature!==record.signature||
        typeof value.found!=='boolean'||typeof value.recoveryAllowed!=='boolean')
        throw Error('交易收據與本次角色或原始內容不符，資料已保留');
      if(mutation&&(value.found!==true||typeof value.replayed!=='boolean'))
        throw Error('尚未取得可核對的已提交交易收據');
      if(!value.found){
        if(value.status!=='missing'||value.result!==null||value.receipt!==null)throw Error('缺少可靠的交易查詢結果');
        return clone(value);
      }
      const receipt=value.receipt,payload=payloadOf(record.kind,record.fields);
      if(value.status!=='committed'||value.recoveryAllowed!==false||!plain(receipt)||
        receipt.schemaVersion!==1||SCOPE.some(key=>receipt[key]!==scope[key])||
        receipt.kind!==record.kind||receipt.requestId!==record.requestId||
        receipt.offerRev!==record.offerRev||receipt.signature!==record.signature||
        !integer(receipt.createdAt)||!same(receipt.payload,payload)||!validResult(record,value.result))
        throw Error('交易收據無法證明原始操作，紀錄已保留');
      return clone(value);
    }
    function available(){
      if(!current()||state.busy||state.checking)return false;
      if(lockError)return message(lockError);
      const existing=inspect();
      if(!existing)return message(state.storageError);
      if(existing.record)return message('此交易仍有待核對的原始請求，請先查詢收據');
      return true;
    }
    function update(trade){
      if(!current()||!plain(trade)||trade.id!==scope.tradeId||!integer(trade.offerRev))return false;
      state.offerRev=trade.offerRev;
      if(state.confirm&&!state.confirm.recovery&&state.confirm.offerRev!==trade.offerRev){
        state.confirm=null;state.notice='交易報價已變更，請重新確認';
      }
      notify();return true;
    }
    function prepare(kind,fields,trade){
      if(!available())return false;
      if(!plain(trade)||trade.id!==scope.tradeId||trade.status!=='open'||trade.expiryPendingMaintenance||
        !integer(trade.offerRev)||!plain(trade.a)||!plain(trade.b))
        return message('交易狀態已變更，請刷新後重新確認');
      const payload=payloadOf(kind,fields);
      if(!payload)return message('操作內容不符合原始交易限制');
      if(state.offerRev!==null&&trade.offerRev!==state.offerRev)
        return message('報價版本已更新，請重新確認');
      state.confirm={kind,fields:clone(fields),payload,offerRev:trade.offerRev};
      state.error='';state.notice='';notify();return true;
    }
    function cancelReview(){
      if(!current()||state.busy)return false;
      state.confirm=null;notify();return true;
    }
    function prepareRecovery(){
      if(!current()||state.busy||state.checking)return false;
      if(lockError)return message(lockError);
      const record=inspect()?.record;
      if(!record||state.receipt?.found!==false||state.receipt.recoveryAllowed!==true)
        return message('請先用原始 UUID 查詢並確認該筆仍缺少收據');
      try{verify(record,state.receipt);}catch(error){return message(error.message);}
      state.confirm={kind:record.kind,fields:clone(record.fields),payload:payloadOf(record.kind,record.fields),
        offerRev:record.offerRev,recovery:true,record:clone(record)};
      state.error='';notify();return true;
    }
    async function submit(){
      if(!current()||state.busy||state.checking||!state.confirm)return false;
      if(lockError)return message(lockError);
      const confirmation=clone(state.confirm),ticket=++generation;
      state.busy=true;state.confirm=null;state.error='';state.notice='';notify();
      let record,completed=false;
      try{
        record=await withLock(()=>{
          if(confirmation.recovery){
            const existing=inspect()?.record;
            if(!existing||!same(existing,confirmation.record)||state.receipt?.found!==false||
              state.receipt.recoveryAllowed!==true)throw Error('原始請求已變更，請重新查詢');
            verify(existing,state.receipt);
            const next={...existing,attempts:existing.attempts+1};persist(next,existing);return next;
          }
          const found=inspect();if(!found)throw Error(state.storageError);
          if(found.record)throw Error('另一視窗存在同一交易未確認的原始請求');
          if(state.offerRev!==null&&state.offerRev!==confirmation.offerRev)
            throw Error('交易版本已更新，請重新確認');
          const requestId=(host.requestId||makeId)();
          if(typeof requestId!=='string'||!UUID.test(requestId))throw Error('無法建立可靠的原始交易 UUID');
          const body={accountId:scope.accountId,realmId:scope.realmId,selectedCharacterId:scope.characterId,
            contextEpoch:ctx.epoch,tradeId:scope.tradeId,kind:confirmation.kind,
            requestId:requestId.toLowerCase(),offerRev:confirmation.offerRev,recovery:false,
            ...clone(confirmation.fields)};
          const next={schemaVersion:1,scope:clone(scope),kind:confirmation.kind,requestId:requestId.toLowerCase(),
            offerRev:confirmation.offerRev,fields:clone(confirmation.fields),body,
            signature:signature(scope,confirmation.kind,requestId.toLowerCase(),confirmation.offerRev,confirmation.payload),
            createdAt:Date.now(),attempts:1};
          persist(next);return next;
        },ticket);
        if(!current()||ticket!==generation||!match(record))return false;
        receiptController?.abort();state.receipt=null;writeController=new AbortController();notify();
        let value;
        try{
          value=await host.request('trade/action-scoped',wire(record,confirmation.recovery),{signal:writeController.signal});
        }catch(error){
          if(current()&&ticket===generation)
            state.error='交易回覆未能確定，請查詢原始收據；不得直接重新送出操作。';
          return false;
        }
        if(!current()||ticket!==generation||!match(record))return false;
        const accepted=verify(record,value,true);state.receipt=accepted;
        const cleared=await clearPending(record,ticket);
        if(!current()||ticket!==generation)return false;
        completed=true;state.lastResult={record:clone(record),receipt:accepted};
        if(cleared){state.receipt=null;state.notice='原始交易已提交並核對收據。';}
        else state.notice='交易已提交，但本機紀錄尚未安全清除；請再次查詢';
        try{host.onChanged?.(clone(accepted),{kind:record.kind,recovery:confirmation.recovery});}catch{}
      }catch(error){
        if(current()&&ticket===generation)
          state.error=record?'交易結果待查證；原始 UUID 與內容均已保留':error.message||'交易尚未送出';
      }finally{
        if(current()&&ticket===generation){state.busy=false;writeController=null;notify();}
      }
      return completed;
    }
    async function checkPending(){
      if(!current()||state.busy||state.checking)return false;
      const record=inspect()?.record;
      if(!record)return message(state.storageError||'沒有待查詢的原始交易');
      const ticket=++generation;receiptController?.abort();receiptController=new AbortController();
      state.checking=true;state.confirm=null;state.receipt=null;state.error='';state.notice='';notify();
      try{
        const result=await host.request('trade/receipt',wire(record,false),{signal:receiptController.signal});
        if(!current()||ticket!==generation||!match(record))return false;
        state.receipt=verify(record,result);
        state.notice=state.receipt.found?'已找到原始交易收據，請確認後結案':'目前沒有已提交的同筆收據；原始資料仍保留。';
        return true;
      }catch(error){
        if(current()&&ticket===generation){state.receipt=null;state.error=error.message||'無法核對原始交易收據';}
        return false;
      }finally{
        if(current()&&ticket===generation){state.checking=false;receiptController=null;notify();}
      }
    }
    async function acknowledge(){
      if(!current()||state.busy||state.checking||state.receipt?.found!==true)return false;
      if(lockError)return message(lockError);
      const record=inspect()?.record,ticket=++generation;
      if(!record)return message(state.storageError||'原始交易資料已變更');
      let accepted;try{accepted=verify(record,state.receipt);}catch(error){return message(error.message);}
      state.busy=true;notify();
      try{
        const cleared=await clearPending(record,ticket);
        if(!current()||ticket!==generation||!cleared)return false;
        state.lastResult={record:clone(record),receipt:accepted};
        state.receipt=null;state.error='';state.notice='已核對原始交易並安全結案。';
        try{host.onChanged?.(clone(accepted),{kind:record.kind,recovery:true});}catch{}
        return true;
      }catch(error){
        if(current()&&ticket===generation)state.error=error.message||'原始交易資料尚未安全清除';
        return false;
      }finally{if(current()&&ticket===generation){state.busy=false;notify();}}
    }
    function storageChanged(event){
      if(!current()||event?.key!==storageKey)return;
      state.confirm=null;state.receipt=null;inspect();notify();
    }
    globalThis.addEventListener?.('storage',storageChanged);
    inspect();
    return {state,current,storageKey,pending,prepare,cancelReview,prepareRecovery,submit,checkPending,
      acknowledge,update,dispose(){
        if(disposed)return;disposed=true;generation++;
        receiptController?.abort();writeController?.abort();
        globalThis.removeEventListener?.('storage',storageChanged);
        state.confirm=null;
      }};
  }
  globalThis.RpgSceneDirectTradeActions=Object.freeze({createClient,payloadOf,signature,storageKeyFor});
})();
