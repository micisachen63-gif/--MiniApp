/* Scoped exchange intent and receipt recovery. Reads never replay a write. */
(() => {
  'use strict';
  const KINDS = ['create','buy','cancel'];
  const IDENTITY = ['accountId','realmId','characterId'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const REJECTED = new Set(['gold','closed','not_found','not_owned','self_trade','protected','untradeable','item','party','guardian_level','auto_active','insufficient','in_exchange']);
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const positive = value => integer(value) && value > 0;
  const ref = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f]/.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const fields = (value,keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
  const scopeOf = value => Object.fromEntries(IDENTITY.map(key => [key,value?.[key]]));
  const scopeKey = value => JSON.stringify(IDENTITY.map(key => value?.[key]));
  const liveKey = value => JSON.stringify([...IDENTITY,'epoch'].map(key => value?.[key]));
  const storageKeyFor = context => 'rpg-exchange-scoped-pending:' + scopeKey(context);
  function canonicalPayload(kind,body) {
    if (!plain(body) || !ref(body.characterId) || !KINDS.includes(kind)) return null;
    if (kind !== 'create') return ref(body.listingId) ? {listingId:body.listingId,characterId:body.characterId} : null;
    const refs = [['equip','equipId'],['item','item'],['guardian','guardianId']].filter(([,key]) => Object.hasOwn(body,key));
    if (refs.length !== 1 || !ref(body[refs[0][1]]) || !positive(body.qty) || body.qty > 99999 || !positive(body.price) || body.price > 1000000 || refs[0][0] !== 'item' && body.qty !== 1) return null;
    return {kind:refs[0][0],ref:body[refs[0][1]],qty:body.qty,price:body.price,characterId:body.characterId};
  }
  function signature(kind,body) {
    const payload = canonicalPayload(kind,body);
    return payload ? JSON.stringify({kind,payload}) : null;
  }
  function payloadKeys(kind,body) {
    if (kind !== 'create') return ['listingId'];
    return [...['equipId','item','guardianId'].filter(key => Object.hasOwn(body,key)),'qty','price'];
  }
  function makeRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toLowerCase();
    if (!globalThis.crypto?.getRandomValues) throw Error('目前瀏覽器無法建立交易編號，請重新開啟。');
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes,byte => byte.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function validExpected(value) {
    return fields(value,['kind','ref','qty','price','sellerCharacterId','sellerName','name']) && ['equip','item','guardian'].includes(value.kind) &&
      ref(value.ref) && positive(value.qty) && positive(value.price) && ref(value.sellerCharacterId) && typeof value.sellerName === 'string' && value.sellerName.length <= 500 && typeof value.name === 'string' && value.name.length <= 500;
  }
  function validRecord(record,context) {
    if (!fields(record,['schemaVersion','scope','kind','requestId','body','signature','expected','createdAt','attempts']) ||
      record.schemaVersion !== 1 || !fields(record.scope,IDENTITY) || IDENTITY.some(key => record.scope[key] !== context[key]) ||
      !KINDS.includes(record.kind) || !UUID.test(record.requestId) || !positive(record.attempts) || !integer(record.createdAt) || !validExpected(record.expected)) return false;
    const body = record.body, keys = ['accountId','realmId','selectedCharacterId','contextEpoch','characterId','kind','requestId','recovery',...payloadKeys(record.kind,body || {})];
    if (!fields(body,keys) || body.accountId !== context.accountId || body.realmId !== context.realmId ||
      body.selectedCharacterId !== context.characterId || body.characterId !== context.characterId || !integer(body.contextEpoch) ||
      body.kind !== record.kind || body.requestId !== record.requestId || body.recovery !== false || record.signature !== signature(record.kind,body)) return false;
    const payload = canonicalPayload(record.kind,body);
    if (!payload) return false;
    return record.kind !== 'create' || record.expected.kind === payload.kind && record.expected.ref === payload.ref &&
      record.expected.qty === payload.qty && record.expected.price === payload.price && record.expected.sellerCharacterId === context.characterId;
  }
  function resultMatches(record,result) {
    if (!plain(result) || result.action !== record.kind || !ref(result.listingId) || !positive(result.price) || !positive(result.qty) ||
      !integer(result.fee) || !integer(result.netGold) || !plain(result.listing)) return false;
    const row = result.listing, expected = record.expected, payload = canonicalPayload(record.kind,record.body);
    if (row.id !== result.listingId || !['equip','item','guardian'].includes(row.kind) || row.kind !== expected.kind ||
      row[row.kind === 'equip' ? 'equipId' : row.kind === 'guardian' ? 'guardianId' : 'item'] !== expected.ref ||
      row.qty !== result.qty || row.price !== result.price || result.qty !== expected.qty || result.price !== expected.price ||
      !plain(row.seller) || row.seller.characterId !== expected.sellerCharacterId || typeof row.name !== 'string' ||
      row.status !== ({create:'active',buy:'sold',cancel:'cancelled'})[record.kind] || row.canBuy !== false ||
      row.ownedByMe !== (record.kind !== 'buy') || !integer(row.createdAt) || !integer(row.updatedAt) ||
      row.fee !== Math.ceil(result.price / 20) || row.netGold !== result.price - row.fee) return false;
    if (record.kind === 'create' && (row.kind !== payload.kind || result.qty !== payload.qty || result.price !== payload.price)) return false;
    if (record.kind !== 'create' && result.listingId !== payload.listingId) return false;
    return record.kind === 'cancel' ? result.returnedCharacterId === row.seller.characterId && result.fee === 0 && result.netGold === 0 :
      result.fee === Math.ceil(result.price / 20) && result.netGold === result.price - result.fee;
  }
  function createClient(host) {
    const context = {...host.getContext?.()}, liveScope = liveKey(context), stableScope = scopeOf(context), storageKey = storageKeyFor(context);
    if (!IDENTITY.every(key => ref(context[key])) || !integer(context.epoch)) throw Error('請先選擇角色與世界。');
    let storage = host.storage;
    if (!storage) { try { storage = globalThis.localStorage; } catch {} }
    const locks = host.locks === undefined ? globalThis.navigator?.locks : host.locks;
    const lockError = typeof locks?.request === 'function' ? '' : '此瀏覽器無法安全協調多視窗交易，請使用支援的瀏覽器。原交易紀錄會保留。';
    const state = {busy:false,checking:false,confirm:null,pending:null,receipt:null,lastResult:null,error:'',notice:'',storageError:'',lockError,minRevision:0};
    let disposed = false, generation = 0, writeController = null, receiptController = null;
    const current = () => !disposed && host.current?.() !== false && liveKey(host.getContext?.()) === liveScope;
    const notify = () => { if (current()) host.onState?.(state); };
    const feedback = message => { if (current()) { state.error = message; notify(); } return false; };
    function inspect() {
      try {
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw Error('storage unavailable');
        const raw = storage.getItem(storageKey);
        if (raw === null) { state.storageError = ''; state.pending = null; return {raw:null,record:null}; }
        if (typeof raw !== 'string' || raw.length > 20000) throw Error('invalid stored transaction');
        const record = JSON.parse(raw);
        if (!validRecord(record,context)) throw Error('invalid stored transaction');
        state.storageError = ''; state.pending = clone(record); return {raw,record};
      } catch {
        state.storageError = '無法安全讀取原交易紀錄，交易已暫停。請保留瀏覽器資料並重新開啟核對。';
        return null;
      }
    }
    function pending() { const value = inspect(); return value?.record ? clone(value.record) : state.pending ? clone(state.pending) : null; }
    function matchesStored(record) {
      const found = inspect();
      return found && found.record && same(found.record,record) ? found : null;
    }
    function persist(record,previous=null) {
      const found = inspect();
      if (!found || (previous ? !found.record || !same(found.record,previous) : found.record !== null)) throw Error(state.storageError || '另一筆原交易紀錄尚待核對。');
      if (!validRecord(record,context)) throw Error('交易內容未通過核對，尚未送出。');
      const raw = JSON.stringify(record);
      try {
        storage.setItem(storageKey,raw);
        if (storage.getItem(storageKey) !== raw) throw Error('write not retained');
      } catch { throw Error('無法保存原交易紀錄，這筆交易尚未送出。'); }
      state.pending = clone(record);
    }
    function clearPendingLocked(record) {
      const found = inspect();
      if (!found) return false;
      if (found.record === null) return true;
      if (!same(found.record,record)) { state.error = '本機原交易紀錄已變更，已保留資料，請重新開啟核對。'; return false; }
      try {
        storage.removeItem(storageKey);
        if (storage.getItem(storageKey) !== null) throw Error('pending changed while clearing');
        state.pending = null; return true;
      } catch {
        state.storageError = '交易已核對，但原交易紀錄尚未清除；請稍後再次核對，勿重送新交易。';
        return false;
      }
    }
    async function withLock(task,ticket=generation) {
      if (state.lockError) throw Error(state.lockError);
      return locks.request(storageKey,{mode:'exclusive'},() => {
        if (!current() || ticket !== generation) throw Error('角色或世界已切換，原交易紀錄會保留。');
        return task();
      });
    }
    const clearPending = (record,ticket) => withLock(() => clearPendingLocked(record),ticket);
    function wire(record,recovery=true) {
      // The persisted economic intent is immutable. Only this caller's epoch is rebound after reopening.
      return {...clone(record.body),contextEpoch:context.epoch,recovery};
    }
    function verifyEnvelope(record,value,mutation=false) {
      if (!plain(value) || value.ok !== true || value.schemaVersion !== 1 || IDENTITY.some(key => value[key] !== context[key]) ||
        value.contextEpoch !== context.epoch || !integer(value.revision) || !integer(value.serverNow) || value.kind !== record.kind ||
        value.requestId !== record.requestId || value.signature !== record.signature || typeof value.found !== 'boolean' || typeof value.recoveryAllowed !== 'boolean') throw Error('收據與原交易或目前角色不符，待核對紀錄已保留。');
      if (mutation && (value.found !== true || typeof value.replayed !== 'boolean')) throw Error('尚未收到完整的交易完成收據。');
      if (!value.found) {
        if (value.status !== 'missing' || value.result !== null || value.receipt !== null) throw Error('原交易狀態尚未完整，請再次查詢。');
        return clone(value);
      }
      const receipt = value.receipt;
      if (value.status !== 'committed' || value.recoveryAllowed !== false || !plain(receipt) || receipt.schemaVersion !== 1 ||
        !fields(receipt.scope,IDENTITY) || IDENTITY.some(key => receipt.scope[key] !== context[key]) || receipt.kind !== record.kind ||
        receipt.requestId !== record.requestId || receipt.signature !== record.signature || !integer(receipt.createdAt) ||
        !same(receipt.payload,canonicalPayload(record.kind,record.body)) || !resultMatches(record,value.result)) throw Error('原交易結果與收據內容不符，待核對紀錄已保留。');
      // Historical receipt validity does not depend on a newer scene's revision or a successful refresh.
      return clone(value);
    }
    function definitiveRejection(record,error) {
      const value = error?.exchangeRejection;
      return plain(value) && value.ok === false && value.schemaVersion === 1 && value.definitiveRejection === true &&
        IDENTITY.every(key => value[key] === context[key]) && value.contextEpoch === context.epoch && integer(value.revision) && integer(value.serverNow) &&
        value.kind === record.kind && value.requestId === record.requestId && value.signature === record.signature && value.found === false &&
        value.status === 'rejected' && value.result === null && value.receipt === null && value.recoveryAllowed === false &&
        value.error === error.code && REJECTED.has(value.error) && typeof value.message === 'string';
    }
    function available() {
      if (!current() || state.busy || state.checking) return false;
      if (state.lockError) return feedback(state.lockError);
      const value = inspect();
      if (!value) return feedback(state.storageError);
      if (value.record) return feedback('請先核對上一筆交易結果，再開始新的交易。');
      return true;
    }
    function prepare(kind,payload,quote,revision) {
      if (!available()) return false;
      if (!KINDS.includes(kind) || !plain(payload) || !fields(payload,payloadKeys(kind,payload)) ||
        !integer(revision) || revision < state.minRevision) return feedback('角色或交易所資料已更新，請重新整理後確認。');
      const body = {...clone(payload),characterId:context.characterId};
      const canonical = canonicalPayload(kind,body);
      const expected = quote && {kind:quote.kind,ref:quote.ref,qty:quote.qty,price:quote.price,sellerCharacterId:quote.sellerCharacterId,sellerName:typeof quote.sellerName === 'string' ? quote.sellerName : '',name:quote.name};
      if (!canonical || !validExpected(expected) || kind === 'create' && (expected.kind !== canonical.kind || expected.ref !== canonical.ref || expected.qty !== canonical.qty || expected.price !== canonical.price || expected.sellerCharacterId !== context.characterId)) return feedback('交易內容不完整，請重新選擇物品。');
      state.error = ''; state.notice = ''; state.confirm = {kind,payload:clone(payload),expected:clone(expected),revision,recovery:false}; notify(); return true;
    }
    function cancel() {
      if (!current() || state.busy) return false;
      state.confirm = null; notify(); return true;
    }
    function prepareRecovery() {
      if (!current() || state.busy || state.checking) return false;
      if (state.lockError) return feedback(state.lockError);
      const record = inspect()?.record;
      if (!record || state.receipt?.found !== false || state.receipt.recoveryAllowed !== true) return feedback('請先查詢原交易收據，再決定是否重試同一筆。');
      try { verifyEnvelope(record,state.receipt); } catch (error) { return feedback(error.message); }
      state.confirm = {kind:record.kind,expected:clone(record.expected),record:clone(record),recovery:true}; state.error = ''; notify(); return true;
    }
    function changed(value,record,recovered) {
      try { host.onChanged?.(clone(value),{kind:record.kind,recovered,requestId:record.requestId}); } catch {}
    }
    async function submit() {
      if (!current() || state.busy || state.checking || !state.confirm) return false;
      if (state.lockError) return feedback(state.lockError);
      const confirmation = clone(state.confirm), ticket = ++generation;
      state.busy = true; state.confirm = null; state.error = ''; state.notice = ''; notify();
      let record, completed = false;
      try {
        // Every storage write uses the same cross-window exclusive lock. Never hold it across a request.
        record = await withLock(() => {
          if (confirmation.recovery) {
            const previous = inspect()?.record;
            if (!previous || !same(previous,confirmation.record) || state.receipt?.found !== false || state.receipt.recoveryAllowed !== true) throw Error('原交易紀錄已變更，請重新查詢。');
            verifyEnvelope(previous,state.receipt);
            const next = {...previous,attempts:previous.attempts+1};
            persist(next,previous); return next;
          }
          const existing = inspect();
          if (!existing) throw Error(state.storageError);
          if (existing.record) throw Error('另一個視窗已有待核對交易，請先核對原交易結果。');
          if (confirmation.revision < state.minRevision) throw Error('角色狀態已更新，請重新確認交易。');
          const id = (host.requestId || makeRequestId)();
          if (typeof id !== 'string' || !UUID.test(id)) throw Error('交易編號格式不正確，尚未送出。');
          const body = {accountId:context.accountId,realmId:context.realmId,selectedCharacterId:context.characterId,contextEpoch:context.epoch,
            characterId:context.characterId,kind:confirmation.kind,requestId:id,recovery:false,...confirmation.payload};
          const next = {schemaVersion:1,scope:stableScope,kind:confirmation.kind,requestId:id,body,signature:signature(confirmation.kind,body),
            expected:confirmation.expected,createdAt:Date.now(),attempts:1};
          persist(next); return next;
        },ticket);
        if (!current() || ticket !== generation || !matchesStored(record)) return false;
        state.receipt = null; receiptController?.abort(); writeController = new AbortController(); notify();
        let value;
        try {
          value = await host.request('exchange/action-scoped',wire(record,confirmation.recovery),{signal:writeController.signal});
        } catch (error) {
          if (!current() || ticket !== generation) return false;
          const sameIntent = matchesStored(record), status = Number(error?.status);
          const rejected = sameIntent && !confirmation.recovery && record.attempts === 1 && error?.uncertain === false &&
            Number.isInteger(status) && status >= 400 && status < 500 && definitiveRejection(record,error);
          if (rejected && await clearPending(record,ticket)) {
            if (!current() || ticket !== generation) return false;
            state.error = error.message || '交易尚未成立，請調整條件後再試。';
          } else state.error = '交易結果待核對。請查詢原交易收據；重新整理不會再次送出交易。';
          return false;
        }
        if (!current() || ticket !== generation || !matchesStored(record)) return false;
        const accepted = verifyEnvelope(record,value,true);
        state.receipt = accepted;
        const cleared = await clearPending(record,ticket);
        if (!current() || ticket !== generation) return false;
        completed = true; state.lastResult = {record:clone(record),receipt:accepted};
        if (cleared) { state.receipt = null; state.notice = ({create:'寶物已上架。',buy:'成交完成，物品已送入目前角色的行囊。',cancel:'刊登已取回，物品回到原刊登角色。'})[record.kind]; }
        else state.notice = '交易已完成，請保留原紀錄並再次核對。';
        changed(accepted,record,confirmation.recovery);
      } catch (error) {
        if (!current() || ticket !== generation) return false;
        state.error = record ? '交易結果待核對。請查詢原交易收據；原交易紀錄會保留。' : error.message || '無法保存原交易紀錄，尚未送出。';
      } finally {
        if (current() && ticket === generation) { state.busy = false; writeController = null; notify(); }
      }
      return completed;
    }
    async function checkPending() {
      if (!current() || state.busy || state.checking) return false;
      const record = inspect()?.record;
      if (!record) return feedback(state.storageError || '沒有待核對的原交易。');
      const ticket = ++generation; receiptController?.abort(); receiptController = new AbortController();
      state.checking = true; state.receipt = null; state.confirm = null; state.error = ''; state.notice = ''; notify();
      try {
        const value = await host.request('exchange/receipt',wire(record),{signal:receiptController.signal});
        if (!current() || ticket !== generation || !matchesStored(record)) return false;
        state.receipt = verifyEnvelope(record,value);
        state.notice = state.receipt.found ? '已找到這筆原交易的完成收據，請核對結果。' : '尚未查到完成收據，原請求可能仍在處理。待核對紀錄會保留。';
        return true;
      } catch (error) {
        if (!current() || ticket !== generation) return false;
        state.receipt = null; state.error = error.message || '暫時無法查詢原交易，請稍後再試。'; return false;
      } finally {
        if (current() && ticket === generation) { state.checking = false; receiptController = null; notify(); }
      }
    }
    async function acknowledge() {
      if (!current() || state.busy || state.checking || state.receipt?.found !== true) return false;
      if (state.lockError) return feedback(state.lockError);
      const ticket = ++generation, record = inspect()?.record, value = state.receipt;
      if (!record) return feedback(state.storageError || '原交易紀錄已變更，請重新核對。');
      let receipt;
      try { receipt = verifyEnvelope(record,value); } catch (error) { return feedback(error.message); }
      state.busy = true; notify();
      try {
        const cleared = await clearPending(record,ticket);
        if (!current() || ticket !== generation || !cleared) return false;
        state.lastResult = {record:clone(record),receipt}; state.receipt = null; state.error = ''; state.notice = '已核對原交易完成結果。';
        changed(receipt,record,true); return true;
      } catch (error) {
        if (current() && ticket === generation) state.error = error.message || '原交易紀錄已保留，請稍後再核對。';
        return false;
      } finally {
        if (current() && ticket === generation) { state.busy = false; notify(); }
      }
    }
    function update(snapshot) {
      if (!current() || !plain(snapshot) || IDENTITY.some(key => snapshot[key] !== context[key]) || !integer(snapshot.live?.revision)) return false;
      const next = Math.max(state.minRevision,snapshot.live.revision);
      if (next === state.minRevision) return true;
      state.minRevision = next;
      if (state.confirm && !state.confirm.recovery && state.confirm.revision < next) {
        state.confirm = null; state.notice = '角色狀態已更新，請重新確認交易。';
      }
      notify(); return true;
    }
    function storageChanged(event) {
      if (!current() || event?.key !== storageKey) return;
      state.confirm = null; state.receipt = null; inspect(); notify();
    }
    globalThis.addEventListener?.('storage',storageChanged);
    inspect();
    return {state,context,current,pending,prepare,cancel,prepareRecovery,submit,checkPending,acknowledge,update,storageKey,
      dispose() {
        if (disposed) return;
        disposed = true; generation++; receiptController?.abort(); writeController?.abort();
        globalThis.removeEventListener?.('storage',storageChanged); state.confirm = null;
      }
    };
  }
  globalThis.RpgSceneExchangeActions = Object.freeze({createClient,canonicalPayload,signature,storageKeyFor});
})();
