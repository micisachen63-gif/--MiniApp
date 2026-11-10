/* Original-intent invitation actions: request, accept, reject, withdraw, gear-open.
 * A durable same-UUID/body record is persisted before the first POST. Native
 * Web Locks serialize local writes and an unknown outcome never auto-resends.
 */
(() => {
  'use strict';
  const TYPES=['request','accept','reject','withdraw','open'];
  const SCOPE=['accountId','realmId','characterId'];
  const LIVE=[...SCOPE,'epoch'];
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const integer=v=>Number.isSafeInteger(v)&&v>=0;
  const identity=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\u0000-\u001f]/.test(v);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const fields=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
  const scopeOf=ctx=>Object.fromEntries(SCOPE.map(k=>[k,ctx?.[k]]));
  const storageKeyFor=ctx=>'rpg-direct-trade-invite-pending:'+JSON.stringify(SCOPE.map(k=>ctx?.[k]));
  const liveKey=ctx=>JSON.stringify(LIVE.map(k=>ctx?.[k]));
  function payloadOf(kind,source){
    if(!TYPES.includes(kind)||!plain(source))return null;
    const keys=kind==='request'?['shareId']:kind==='open'?['equipId','targetCharId']:['reqId'];
    if(!fields(source,keys)||keys.some(k=>!identity(source[k])))return null;
    return Object.fromEntries(keys.map(k=>[k,source[k]]));
  }
  const signature=(scope,kind,requestId,payload)=>JSON.stringify({
    accountId:scope.accountId,realmId:scope.realmId,characterId:scope.characterId,
    kind,requestId,payload
  });
  function uuid(){
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID().toLowerCase();
    if(!globalThis.crypto?.getRandomValues)throw Error('瀏覽器無法建立唯一交易邀請 UUID，已停用寫入');
    const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function createClient(host){
    const ctx=clone(host.getContext?.()||{}),scope=scopeOf(ctx),capture=liveKey(ctx),storageKey=storageKeyFor(ctx);
    if(!SCOPE.every(k=>identity(scope[k]))||!integer(ctx.epoch))
      throw Error('交易邀請需要目前帳號、世界與角色');
    let storage=host.storage;
    if(!storage)try{storage=globalThis.localStorage;}catch{}
    const locks=host.locks===undefined?globalThis.navigator?.locks:host.locks;
    const lockError=typeof locks?.request==='function'?'':'瀏覽器未支援跨視窗安全鎖，交易邀請寫入已停用';
    const state={busy:false,checking:false,pending:null,confirm:null,receipt:null,lastResult:null,
      error:'',notice:'',storageError:'',lockError};
    let disposed=false,generation=0,writeController=null,receiptController=null;
    const current=()=>!disposed&&host.current?.()!==false&&liveKey(host.getContext?.())===capture;
    const notify=()=>{if(current())host.onState?.(state);};
    const report=message=>{if(current()){state.error=message;notify();}return false;};
    function validRecord(record){
      if(!fields(record,['schemaVersion','scope','kind','requestId','payload','body','signature','createdAt','attempts'])||
        record.schemaVersion!==1||!fields(record.scope,SCOPE)||SCOPE.some(k=>record.scope[k]!==scope[k])||
        !TYPES.includes(record.kind)||typeof record.requestId!=='string'||!UUID.test(record.requestId)||
        !integer(record.createdAt)||!integer(record.attempts)||record.attempts<1)return false;
      const payload=payloadOf(record.kind,record.payload);
      if(!payload||!same(record.payload,payload))return false;
      const body=record.body;
      if(!fields(body,['accountId','realmId','selectedCharacterId','contextEpoch','kind','requestId','recovery',...Object.keys(payload)])||
        body.accountId!==scope.accountId||body.realmId!==scope.realmId||
        body.selectedCharacterId!==scope.characterId||!integer(body.contextEpoch)||
        body.kind!==record.kind||body.requestId!==record.requestId||body.recovery!==false||
        Object.keys(payload).some(k=>body[k]!==payload[k]))return false;
      return record.signature===signature(scope,record.kind,record.requestId,payload);
    }
    function inspect(){
      try{
        if(!storage||['getItem','setItem','removeItem'].some(k=>typeof storage[k]!=='function'))throw Error('no storage');
        const raw=storage.getItem(storageKey);
        if(raw===null){state.storageError='';state.pending=null;return {record:null,raw:null};}
        if(typeof raw!=='string'||raw.length>12000)throw Error('invalid length');
        const record=JSON.parse(raw);
        if(!validRecord(record))throw Error('invalid pending');
        state.storageError='';state.pending=clone(record);return {record,raw};
      }catch{
        state.storageError='無法可靠讀取原始邀請紀錄；請保留瀏覽器資料，本次不再寫入';
        return null;
      }
    }
    const pending=()=>{const found=inspect();return found?.record?clone(found.record):state.pending?clone(state.pending):null;};
    const matches=record=>{const found=inspect();return found&&found.record&&same(found.record,record)?found:null;};
    function persist(record,previous=null){
      const found=inspect();
      if(!found||(previous?!found.record||!same(found.record,previous):found.record!==null))
        throw Error('已有未結案邀請，請先查詢原收據');
      if(!validRecord(record))throw Error('邀請內容不完整，已停止交易');
      const raw=JSON.stringify(record);
      try{
        storage.setItem(storageKey,raw);
        if(storage.getItem(storageKey)!==raw)throw Error('storage did not retain record');
      }catch{throw Error('無法確認原始邀請已保存，尚未送出任何請求');}
      state.pending=clone(record);
    }
    function clearLocked(record){
      const found=inspect();
      if(!found)return false;
      if(found.record===null)return true;
      if(!same(found.record,record)){state.error='原始邀請已被其他視窗更新，請重新查詢';return false;}
      try{
        storage.removeItem(storageKey);
        if(storage.getItem(storageKey)!==null)throw Error('clear failed');
        state.pending=null;return true;
      }catch{
        state.storageError='已查到收據，但無法安全清除本機紀錄，請再次查詢';
        return false;
      }
    }
    async function withLock(fn,ticket=generation){
      if(lockError)throw Error(lockError);
      return locks.request(storageKey,{mode:'exclusive'},()=>{
        if(!current()||ticket!==generation)throw Error('已切換角色，原始邀請仍保留');
        return fn();
      });
    }
    const clearPending=(record,ticket)=>withLock(()=>clearLocked(record),ticket);
    const wire=(record,recovery=false)=>({...clone(record.body),contextEpoch:ctx.epoch,recovery:recovery===true});
    function validResult(record,result){
      if(!plain(result))return false;
      if(record.kind==='request')return result.reqId==='q'+record.requestId.replaceAll('-','')&&result.shareId===record.payload.shareId&&result.requesterTg===scope.characterId&&identity(result.ownerTg)&&result.status==='pending';
      if(record.kind==='accept')return result.reqId===record.payload.reqId&&result.ownerTg===scope.characterId&&identity(result.tradeId)&&result.status==='accepted';
      if(record.kind==='reject')return result.reqId===record.payload.reqId&&result.ownerTg===scope.characterId&&result.status==='rejected';
      if(record.kind==='withdraw')return result.reqId===record.payload.reqId&&result.requesterTg===scope.characterId&&result.status==='cancelled';
      return record.kind==='open'&&identity(result.tradeId)&&result.equipId===record.payload.equipId&&result.targetCharId===record.payload.targetCharId&&result.ownerTg===scope.characterId&&result.status==='open';
    }
    function verify(record,value,mutating=false){
      if(!plain(value)||value.ok!==true||value.schemaVersion!==1||
        SCOPE.some(k=>value[k]!==scope[k])||value.contextEpoch!==ctx.epoch||
        value.kind!==record.kind||value.requestId!==record.requestId||
        value.signature!==record.signature||!integer(value.revision)||!integer(value.serverNow)||
        typeof value.found!=='boolean'||typeof value.recoveryAllowed!=='boolean')
        throw Error('邀請收據與原始角色或操作內容不一致，紀錄已保留');
      if(mutating&&(value.found!==true||typeof value.replayed!=='boolean'))
        throw Error('尚未取得已提交邀請的完整收據');
      if(!value.found){
        if(value.status!=='missing'||value.result!==null||value.receipt!==null)
          throw Error('邀請查詢回覆格式有誤，請保留原始 UUID');
        return clone(value);
      }
      const r=value.receipt,payload=payloadOf(record.kind,record.payload);
      if(value.status!=='committed'||value.recoveryAllowed!==false||!plain(r)||
        r.schemaVersion!==1||SCOPE.some(k=>r[k]!==scope[k])||
        r.kind!==record.kind||r.requestId!==record.requestId||
        r.signature!==record.signature||!same(r.payload,payload)||
        !integer(r.createdAt)||!validResult(record,value.result))
        throw Error('邀請收據不能證明原始操作，資料已保留');
      return clone(value);
    }
    function available(){
      if(!current()||state.busy||state.checking)return false;
      if(lockError)return report(lockError);
      const found=inspect();
      if(!found)return report(state.storageError);
      if(found.record)return report('上筆邀請尚未核對，請先查詢原始收據');
      return true;
    }
    function prepare(kind,payload){
      if(!available())return false;
      const canonical=payloadOf(kind,payload);
      if(!canonical)return report('邀請種類或參數不正確');
      state.confirm={kind,payload:clone(canonical),recovery:false};
      state.notice='';state.error='';notify();return true;
    }
    function cancelReview(){
      if(!current()||state.busy)return false;
      state.confirm=null;notify();return true;
    }
    function prepareRecovery(){
      if(!current()||state.busy||state.checking)return false;
      if(lockError)return report(lockError);
      const record=inspect()?.record;
      if(!record||state.receipt?.found!==false||state.receipt.recoveryAllowed!==true)
        return report('請先查明同筆原始邀請的收據仍不存在，才能確認恢復');
      try{verify(record,state.receipt);}catch(e){return report(e.message);}
      state.confirm={kind:record.kind,payload:clone(record.payload),record:clone(record),recovery:true};
      state.error='';notify();return true;
    }
    async function submit(){
      if(!current()||state.busy||state.checking||!state.confirm)return false;
      if(lockError)return report(lockError);
      const review=clone(state.confirm),ticket=++generation;
      state.busy=true;state.confirm=null;state.notice='';state.error='';notify();
      let record,completed=false;
      try{
        record=await withLock(()=>{
          if(review.recovery){
            const original=inspect()?.record;
            if(!original||!same(original,review.record)||state.receipt?.found!==false||
              state.receipt.recoveryAllowed!==true)throw Error('原始邀請已改變，請重新查詢');
            verify(original,state.receipt);
            const next={...original,attempts:original.attempts+1};persist(next,original);return next;
          }
          const found=inspect();
          if(!found)throw Error(state.storageError);
          if(found.record)throw Error('其他視窗存在待核對的原始邀請');
          const requestId=(host.requestId||uuid)();
          if(typeof requestId!=='string'||!UUID.test(requestId))throw Error('無法取得唯一邀請 UUID');
          const id=requestId.toLowerCase(),payload=payloadOf(review.kind,review.payload);
          if(!payload)throw Error('邀請參數已變更，請重新確認');
          const body={accountId:scope.accountId,realmId:scope.realmId,
            selectedCharacterId:scope.characterId,contextEpoch:ctx.epoch,kind:review.kind,
            requestId:id,recovery:false,...clone(payload)};
          const next={schemaVersion:1,scope:clone(scope),kind:review.kind,requestId:id,
            payload:clone(payload),body,signature:signature(scope,review.kind,id,payload),
            createdAt:Date.now(),attempts:1};
          persist(next);return next;
        },ticket);
        if(!current()||ticket!==generation||!matches(record))return false;
        receiptController?.abort();state.receipt=null;writeController=new AbortController();notify();
        let value;
        try{
          value=await host.request('trade/invitation-scoped',wire(record,review.recovery),{signal:writeController.signal});
        }catch(error){
          if(current()&&ticket===generation)
            state.error='邀請結果不明，請先查詢原始 UUID 收據；禁止直接重新送出';
          return false;
        }
        if(!current()||ticket!==generation||!matches(record))return false;
        const accepted=verify(record,value,true);state.receipt=accepted;
        const cleared=await clearPending(record,ticket);
        if(!current()||ticket!==generation)return false;
        completed=true;state.lastResult={record:clone(record),receipt:accepted};
        if(cleared){state.receipt=null;state.notice='原始邀請已提交並核對收據';}
        else state.notice='原始邀請已提交，但紀錄尚未安全清除；請再次查詢';
        try{host.onChanged?.(clone(accepted),{kind:record.kind,recovered:review.recovery});}catch{}
      }catch(e){
        if(current()&&ticket===generation)
          state.error=record?'邀請結果待核對，原始 UUID 與參數已保留':e.message||'邀請尚未送出';
      }finally{
        if(current()&&ticket===generation){state.busy=false;writeController=null;notify();}
      }
      return completed;
    }
    async function checkPending(){
      if(!current()||state.busy||state.checking)return false;
      const record=inspect()?.record;
      if(!record)return report(state.storageError||'目前沒有待核對的邀請');
      const ticket=++generation;receiptController?.abort();receiptController=new AbortController();
      state.checking=true;state.receipt=null;state.confirm=null;state.error='';state.notice='';notify();
      try{
        const value=await host.request('trade/invitation-receipt',wire(record),{signal:receiptController.signal});
        if(!current()||ticket!==generation||!matches(record))return false;
        state.receipt=verify(record,value);
        state.notice=state.receipt.found?'已找到這筆原始邀請的提交收據':'未找到原始收據，請選擇是否明確恢復同一筆';
        return true;
      }catch(e){
        if(current()&&ticket===generation){state.receipt=null;state.error=e.message||'無法查詢邀請收據';}
        return false;
      }finally{
        if(current()&&ticket===generation){state.checking=false;receiptController=null;notify();}
      }
    }
    async function acknowledge(){
      if(!current()||state.busy||state.checking||state.receipt?.found!==true)return false;
      if(lockError)return report(lockError);
      const ticket=++generation,record=inspect()?.record;
      if(!record)return report(state.storageError||'原始邀請紀錄已變更');
      let receipt;
      try{receipt=verify(record,state.receipt);}catch(e){return report(e.message);}
      state.busy=true;notify();
      try{
        const cleared=await clearPending(record,ticket);
        if(!current()||ticket!==generation||!cleared)return false;
        state.lastResult={record:clone(record),receipt};
        state.receipt=null;state.error='';state.notice='邀請已查證並安全結案';
        try{host.onChanged?.(clone(receipt),{kind:record.kind,recovered:true});}catch{}
        return true;
      }catch(e){
        if(current()&&ticket===generation)state.error=e.message||'本機邀請紀錄尚未安全清除';
        return false;
      }finally{if(current()&&ticket===generation){state.busy=false;notify();}}
    }
    function storageChanged(event){
      if(!current()||event?.key!==storageKey)return;
      state.confirm=null;state.receipt=null;inspect();notify();
    }
    globalThis.addEventListener?.('storage',storageChanged);
    inspect();
    return {state,context:clone(ctx),storageKey,current,pending,prepare,cancelReview,
      prepareRecovery,submit,checkPending,acknowledge,dispose(){
        if(disposed)return;disposed=true;generation++;
        writeController?.abort();receiptController?.abort();
        globalThis.removeEventListener?.('storage',storageChanged);
        state.confirm=null;
      }};
  }
  globalThis.RpgSceneDirectTradeInvitations=Object.freeze({createClient,payloadOf,signature,storageKeyFor});
})();
