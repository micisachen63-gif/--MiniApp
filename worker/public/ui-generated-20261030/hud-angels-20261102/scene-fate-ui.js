/* Personal Fate lives in the shared battle window.
 * Reads never advance a life, generate a gift or dispatch a notification.
 * Complete canonical intent is persisted and verified before every explicit write.
 */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const own = (value,field) => Object.prototype.hasOwnProperty.call(value || {},field);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
  const codeValid = value => typeof value === 'string' && /^f(?:[1-5][a-f0-9x]{10,30}|7[a-f0-9x]{29}|(?:8tw|9(?:jp|kr|us|ca|gb|de|fr|au|in))[0-9ab][0-9][01]{18}[0-9abx][a-f0-9]{8})$/.test(value);
  const key = (context,epoch = false) => JSON.stringify((epoch ? ['accountId','realmId','characterId','epoch'] : ['accountId','realmId','characterId']).map(field => String(context?.[field] ?? '')));
  const KINDS = ['start','choice','keep','gift-claim','gift-open'];
  const COUNTRIES = ['TW','JP','KR','US','CA','GB','DE','FR','AU','IN'];
  const TABS = [['overview','旅章'],['current','此世'],['archive','旅誌'],['gifts','星輝匣'],['history','紀錄']];
  const ITEM_NAMES = {fate_cycle_gift:'四世星輝匣',guaranteed_scroll_w:'必過的武器強化卷',guaranteed_scroll_a:'必過的防具強化卷',scroll_w:'武器強化卷',scroll_a:'防具強化卷'};
  const REWARDS = {weapon:{guaranteed_scroll_w:1},armor:{guaranteed_scroll_a:1},scrolls:{scroll_w:2,scroll_a:2}};
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => integer(value) ? value.toLocaleString('zh-TW') : '—';
  const when = value => positive(value) ? new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
  const reason = error => typeof error === 'string' ? error : error?.message || '';
  const scriptUrl = globalThis.document?.currentScript?.src, sheets = new WeakMap();
  let storyFlight = null, privateFlight = null;
  const milestoneList = value => Array.isArray(value) && value.length <= 25 && value.every((n,i) => positive(n) && n % 4 === 0 && (i === 0 || n > value[i-1]));
  function canonical(kind,input,withId = false) {
    if (!KINDS.includes(kind) || !plain(input)) return null;
    let fields,body;
    if (kind === 'start') {
      if (input.mode !== 'random' || !COUNTRIES.includes(input.country) || typeof input.showSign !== 'boolean' || input.socialInvite !== false) return null;
      fields = ['mode','country','showSign','socialInvite']; body = {mode:'random',country:input.country,showSign:input.showSign,socialInvite:false};
    } else if (kind === 'choice') {
      if (!id(input.lifeId) || !integer(input.index) || ![0,1].includes(input.answer)) return null;
      fields = ['lifeId','index','answer']; body = {lifeId:input.lifeId,index:input.index,answer:input.answer};
    } else if (kind === 'keep') {
      if (!codeValid(input.code)) return null;
      fields = ['code']; body = {code:input.code};
    } else if (kind === 'gift-claim') {
      if (!milestoneList(input.expectedMilestones)) return null;
      fields = ['expectedMilestones']; body = {expectedMilestones:[...input.expectedMilestones]};
    } else {
      if (!id(input.giftId)) return null;
      fields = ['giftId']; body = {giftId:input.giftId};
    }
    if (withId) { if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(input.requestId)) return null; fields.push('requestId'); }
    if (Object.keys(input).length !== fields.length || Object.keys(input).some(field => !fields.includes(field))) return null;
    return body;
  }
  const signature = (kind,body) => { const value = canonical(kind,body,own(body,'requestId')); return value ? JSON.stringify({kind,...value}) : null; };
  function validRecord(record,identity) {
    if (!plain(record) || Object.keys(record).some(field => !['version','scope','context','id','kind','body','wireBody','signature','label','details','at','revealed'].includes(field)) || own(record,'revealed') && typeof record.revealed !== 'boolean' || record.version !== 1 || record.scope !== identity || !KINDS.includes(record.kind) || record.body?.requestId !== record.id || !canonical(record.kind,record.body,true) || record.signature !== signature(record.kind,record.body) || typeof record.label !== 'string' || record.label.length > 240 || typeof record.details !== 'string' || record.details.length > 5000 || !integer(record.at)) return false;
    const [accountId,realmId,characterId] = JSON.parse(identity);
    return same(record.context,{accountId,realmId,characterId}) && same(record.wireBody,{kind:record.kind,...record.body,realmId,selectedCharacterId:characterId});
  }
  function validQuery(input = {}) {
    if (!plain(input) || Object.keys(input).some(field => !['before','giftStatus','giftAfter'].includes(field))) throw Error('旅章查詢內容不完整。');
    const before = own(input,'before') ? input.before : null, giftStatus = own(input,'giftStatus') ? input.giftStatus : 'claimed', giftAfter = own(input,'giftAfter') ? input.giftAfter : null;
    if (before !== null && !positive(before) || !['claimed','opened','all'].includes(giftStatus) || giftAfter !== null && (!positive(giftAfter) || giftAfter % 4 !== 0)) throw Error('旅章分頁內容不正確。');
    return {before,giftStatus,giftAfter};
  }
  function resultMatches(record,result) {
    if (!plain(result)) return false;
    const expected = record.kind === 'start' ? ['lifeId',...(own(result,'already') ? ['already'] : [])] : record.kind === 'choice' ? ['lifeId','index','answer'] : record.kind === 'keep' ? ['saved','countsAsLife'] : record.kind === 'gift-claim' ? ['claimed','giftIds','remaining'] : ['giftId','milestone','reward','items'];
    if (Object.keys(result).length !== expected.length || expected.some(field => !own(result,field))) return false;
    const body = record.body;
    if (record.kind === 'start') return id(result.lifeId) && (!own(result,'already') || result.already === true);
    if (record.kind === 'choice') return result.lifeId === body.lifeId && result.index === body.index && result.answer === body.answer;
    if (record.kind === 'keep') return result.saved === true && result.countsAsLife === false;
    if (record.kind === 'gift-claim') return result.claimed === body.expectedMilestones.length && integer(result.remaining) && Array.isArray(result.giftIds) && result.giftIds.length === result.claimed && result.giftIds.every(id) && new Set(result.giftIds).size === result.giftIds.length;
    return result.giftId === body.giftId && positive(result.milestone) && result.milestone % 4 === 0 && own(REWARDS,result.reward) && same(result.items,REWARDS[result.reward]);
  }
  function receiptMatches(record,value,context) {
    const receipt = value?.receipt, expectedCosts = record.kind === 'start' ? {dailyStarts:value.result?.already === true ? 0 : 1} : record.kind === 'gift-open' ? {fate_cycle_gift:1} : {};
    if (!plain(receipt) || receipt.version !== 1 || receipt.kind !== record.kind || receipt.requestId !== record.id || receipt.requestKey !== 'scene:app:' + record.id || receipt.signature !== record.signature || !integer(receipt.createdAt) || receipt.createdAt > value.now || !plain(receipt.authority) || !plain(receipt.scope) || ['realmId','accountId','characterId'].some(field => String(receipt.scope[field]) !== String(context[field])) || !same(receipt.result,value.result) || !same(receipt.costs,expectedCosts)) return false;
    if (record.kind === 'gift-claim') return plain(receipt.proof) && same(receipt.proof.milestones,record.body.expectedMilestones);
    return true;
  }
  function makeRequestId() {
    if (globalThis.crypto?.randomUUID) return 'sf_' + globalThis.crypto.randomUUID().replaceAll('-','');
    if (globalThis.crypto?.getRandomValues) return 'sf_' + [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2,'0')).join('');
    throw Error('瀏覽器暫時無法保存唯一操作編號，尚未送出操作。');
  }
  function createClient(host) {
    const context = {...host.getContext?.()}, identity = key(context), scope = key(context,true), now = host.now || Date.now;
    let storage = host.storage;
    if (!storage) { try { storage = globalThis.sessionStorage; } catch {} }
    const storageKey = 'rpg-sf-pending:' + identity;
    const state = {data:null,loading:false,busy:false,checking:false,stale:true,error:'',notice:'',storageError:'',confirm:null,receipt:null,historyReceipt:null,lastResult:null,revision:-1,minRevision:-1,minObservedAt:0,receivedAt:0,readSequence:0};
    let disposed = false, sequence = 0, generation = 0, receiptGeneration = 0, controller = null, receiptController = null, query = validQuery(), knownRecord = null;
    const lifeFloors = new Map();
    const current = () => !disposed && key(host.getContext?.(),true) === scope && host.current?.() !== false;
    const notify = () => { if (current()) host.onState?.(state); };
    function pending() {
      try {
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw Error('storage unavailable');
        const raw = storage.getItem(storageKey);
        if (raw === null) { knownRecord = null; state.storageError = ''; return null; }
        const record = JSON.parse(raw);
        if (!validRecord(record,identity)) { state.storageError = '保存的待核對內容不完整，請保留這份資料；目前暫停新操作。'; return knownRecord; }
        knownRecord = record; state.storageError = ''; return record;
      } catch { state.storageError = '無法讀取待核對操作；請恢復瀏覽器儲存後再操作。'; return knownRecord; }
    }
    const samePending = (a,b) => !!a && !!b && a.id === b.id && a.scope === b.scope && a.signature === b.signature && same(a.context,b.context) && same(a.body,b.body) && same(a.wireBody,b.wireBody);
    function verifiedPending(expected) {
      const record = pending(); if (state.storageError) return null;
      if (!samePending(record,expected)) { state.storageError = '原操作內容已變更，請保留目前資料並重新核對。'; return null; }
      return record;
    }
    function savePending(record,expected = null) {
      const existing = pending(); if (state.storageError) return false;
      if (expected ? !samePending(existing,expected) : existing !== null) { state.storageError = '原操作內容已變更，尚未送出或覆寫任何紀錄。'; return false; }
      try { const raw = JSON.stringify(record); storage.setItem(storageKey,raw); if (storage.getItem(storageKey) !== raw) throw Error('write verification'); knownRecord = record; state.storageError = ''; return true; }
      catch { state.storageError = '無法完整保存原操作編號與內容，尚未送出這次操作。'; return false; }
    }
    function clearPending(expected) {
      if (!current() || !verifiedPending(expected)) return false;
      const original = knownRecord;
      try { storage.removeItem(storageKey); if (storage.getItem(storageKey) !== null) throw Error('remove verification'); knownRecord = null; state.storageError = ''; state.receipt = null; return true; }
      catch { knownRecord = original; state.storageError = '原操作已完成，但儲存紀錄尚未更新；請保留並再次核對原收據。'; return false; }
    }
    function markRevealed(id) {
      if (!current()) return false; const record = pending();
      if (state.storageError || !record || record.id !== id) return false;
      return record.revealed ? true : savePending({...record,revealed:true},record);
    }
    function feedback(message,error = false) { if (!current()) return; state[error ? 'error' : 'notice'] = message; notify(); }
    function verifyIdentity(value) {
      for (const field of ['accountId','realmId','characterId']) if (String(value?.[field]) !== String(context[field])) throw Error('角色或世界已切換，請重新開啟命運旅章。');
    }
    function verifyEnvelope(value) {
      verifyIdentity(value);
      if (value?.ok !== true || !integer(value.revision) || value.revision < Math.max(state.revision,state.minRevision) || !positive(value.now) || value.now < state.minObservedAt) throw Error('收到較早的旅章狀態，請重新同步。');
    }
    function accept(value,ticket) {
      verifyEnvelope(value);
      const fate = value.fate, active = fate?.state?.active, domain = fate?.domain, gifts = fate?.gifts;
      if (value.readSequence !== ticket || !plain(fate) || !plain(fate.state) || !integer(fate.state.completed) || !integer(fate.state.startedToday) || fate.state.limit !== 4 || typeof fate.state.night !== 'boolean' || !plain(fate.history) || !Array.isArray(fate.history.entries) || !Array.isArray(fate.history.memorials) || !Array.isArray(fate.history.receipts) || !plain(gifts) || !Array.isArray(gifts.entries) || !Array.isArray(gifts.pool) || !milestoneList(gifts.claimMilestones) || !plain(fate.control) || typeof fate.control.writable !== 'boolean' || !Array.isArray(fate.countries) || !plain(domain) || domain.version !== 1 || typeof domain.token !== 'string' || !domain.token || domain.token.length > 256) throw Error('命運旅章資料尚未完整，請重新整理。');
      if (!plain(domain.lifeRevision) || !['count','totalRevision','lastStartedAt','lastCompletedAt'].every(field => integer(domain.lifeRevision[field])) || domain.completed !== fate.state.completed || domain.startedToday !== fate.state.startedToday || !plain(domain.profile) || !plain(domain.daily) || !plain(domain.social) || !plain(domain.gifts) || !plain(domain.memorials) || !plain(domain.operations)) throw Error('旅章領域版本尚未完整。');
      if (active !== null) {
        if (!plain(active) || !id(active.id) || !integer(active.rev) || active.status !== 'active' || !plain(active.draft) || !Array.isArray(active.draft.answers) || active.draft.answers.some(answer => answer !== 0 && answer !== 1) || !plain(active.timing) || !integer(active.timing.index) || typeof active.timing.available !== 'boolean' || !positive(active.timing.displayAt) || !positive(active.timing.storyAt) || !plain(domain.life) || domain.life.id !== active.id || domain.life.rev !== active.rev || domain.life.status !== 'active') throw Error('目前這一世的紀錄尚未完整。');
        if (active.rev < (lifeFloors.get(active.id) ?? -1)) throw Error('收到較早的人生版本，請重新同步。');
      } else if (domain.life !== null) throw Error('目前旅章與領域版本不符。');
      if (!['completed','earned','claimable','unopened','opened','nextIn'].every(field => integer(gifts[field])) || gifts.interval !== 4 || gifts.completed !== fate.state.completed || gifts.entries.some(entry => !id(entry.id) || !positive(entry.milestone) || entry.milestone % 4 !== 0 || !['claimed','opened'].includes(entry.status)) || gifts.nextCursor !== null && (!positive(gifts.nextCursor) || gifts.nextCursor % 4 !== 0)) throw Error('星輝匣資料尚未完整。');
      if (fate.history.entries.some(entry => !id(entry.id) || !codeValid(entry.code) || !positive(entry.at) || !plain(entry.draft)) || fate.history.next !== null && !positive(fate.history.next)) throw Error('正式旅誌分頁尚未完整。');
      if (active) lifeFloors.set(active.id,active.rev);
      if (lifeFloors.size > 64) lifeFloors.delete(lifeFloors.keys().next().value);
      return value.revision;
    }
    const fingerprint = () => JSON.stringify([state.revision,query,state.data?.readOnly,state.data?.fate?.domain?.token,state.data?.fate?.control,state.data?.fate?.state?.active?.timing,state.data?.fate?.gifts?.claimMilestones]);
    const clockNow = () => state.data ? state.data.now + Math.max(0,now() - state.receivedAt) : 0;
    function choiceOpen(active = state.data?.fate?.state.active) {
      const timing = active?.timing, at = clockNow();
      return !!active && timing?.available === true && timing.completionDue !== true && timing.index === active.draft.answers.length && positive(timing.deadline) && at < timing.deadline && (at + 8*3600000) % 86400000 >= 6*3600000;
    }
    async function refresh(nextQuery = query) {
      if (!current() || state.busy || state.checking) return false;
      const ticket = ++sequence, guard = ++generation, before = fingerprint(); controller?.abort(); controller = new AbortController(); state.loading = true; state.error = ''; notify();
      try {
        const next = validQuery(nextQuery), value = await host.request('fate/scene',{...next,readSequence:ticket},{signal:controller.signal});
        if (!current() || guard !== generation || ticket !== sequence) return false;
        const revision = accept(value,ticket);
        state.revision = revision; state.minObservedAt = Math.max(state.minObservedAt,value.now); state.readSequence = ticket;
        query = next; state.data = clone(value); state.receivedAt = now(); state.stale = false;
        if (state.confirm && before !== fingerprint()) { state.confirm = null; state.notice = '旅章、資源或回應期限已更新，請重新確認。'; }
        pending(); return true;
      } catch (error) { if (!current() || guard !== generation) return false; state.stale = true; state.confirm = null; state.error = reason(error) || '暫時無法讀取旅章。'; return false; }
      finally { if (current() && guard === generation) { state.loading = false; notify(); } }
    }
    function readiness(kind,body,{recover = false} = {}) {
      if (!current()) return '角色或世界已切換。';
      if (state.busy || state.loading || state.checking) return '正在核對旅章。';
      if (!state.data || state.stale || state.revision < state.minRevision) return '請先更新旅章。';
      const record = pending(); if (state.storageError) return state.storageError;
      if (!recover && record) return '請先核對上次操作結果。';
      if (!recover) { const external = host.mutationBlock?.(); if (external) return external; }
      const fate = state.data.fate;
      if (state.data.readOnly === true || fate.control.writable !== true || fate.control.realmPhase !== 'ACTIVE') return reason(state.data.readOnlyReason) || '這個世界目前只能查看資料。';
      if (recover) return '';
      if (kind === 'start' && fate.control.startAllowed !== true) return reason(fate.control.startBlock) || '目前無法開啟下一世。';
      if (kind === 'choice' && (!choiceOpen() || body?.lifeId !== fate.state.active?.id || body.index !== fate.state.active.timing.index)) return '這個抉擇尚未開啟、已截止或仍待背景同步。';
      if (kind === 'gift-claim' && (!same(body?.expectedMilestones,fate.gifts.claimMilestones) || !body.expectedMilestones.length)) return '請更新可領取的正式輪迴里程碑。';
      if (kind === 'gift-open' && !fate.gifts.entries.some(entry => entry.id === body?.giftId && entry.status === 'claimed')) return '請重新選擇這位角色尚未開啟的星輝匣。';
      return '';
    }
    function prepare(kind,body,label,details) {
      const clean = canonical(kind,body), blocked = readiness(kind,body);
      if (!clean || blocked) { feedback(blocked || '操作內容不完整，尚未送出。',true); return false; }
      state.error = ''; state.notice = ''; state.confirm = {kind,body:clean,label,details,fingerprint:fingerprint(),recovery:false}; notify(); return true;
    }
    function prepareStart(country,showSign) {
      const selected = state.data?.fate.countries.find(entry => entry.id === country);
      if (!selected) { feedback('請選擇已開放的出生地。',true); return false; }
      return prepare('start',{mode:'random',country,showSign,socialInvite:false},'展開新的一世',
        '從' + selected.name + ' · ' + selected.cityName + '開始，由命運決定這一世的出身。將使用本帳號今日一次啟程額度；一世 2 小時，00:00–06:00 暫停成長。不消耗金幣。');
    }
    function prepareChoice(index,answer) {
      const active = state.data?.fate.state.active;
      return prepare('choice',{lifeId:active?.id,index,answer},'回應此世的抉擇','確認第 ' + (index + 1) + ' 個抉擇的選項' + (answer === 0 ? 'Ⅰ' : 'Ⅱ') + '。提交後沿用原旅章繼續，選擇不會改送至另一世。');
    }
    function prepareKeep(code) { return prepare('keep',{code},'收藏這封旅人來信','將這份旅章收進目前角色的紀念收藏；正式完成世數與星輝匣資格不會增加。'); }
    function prepareClaim() {
      const milestones = state.data?.fate.gifts.claimMilestones || [];
      return prepare('gift-claim',{expectedMilestones:[...milestones]},'領取四世星輝匣','領取完成 ' + milestones.join('、') + ' 世的 ' + milestones.length + ' 份星輝匣，不消耗金幣。尚未完成的人生與紀念收藏不計入。');
    }
    function prepareOpen(giftId) {
      const entry = state.data?.fate.gifts.entries.find(row => row.id === giftId);
      return prepare('gift-open',{giftId},'開啟這一份星輝匣','將開啟完成 ' + (entry?.milestone ?? '—') + ' 世所得的指定星輝匣，只消耗這一匣。原結果會保留，連線中斷後可核對同一筆結果。');
    }
    function cancel() { if (!current() || state.busy) return; state.confirm = null; notify(); }
    // Original receipts stay valid when later pure reads observe a newer scene.
    // Freshness floors apply when accepting network replies, not when acknowledging
    // an already verified immutable result for the same durable pending intent.
    function immutableResponseMatches(record,value) { return value?.ok === true && integer(value.revision) && positive(value.now) && ['accountId','realmId','characterId'].every(field => String(value[field]) === String(context[field])) && value.kind === record.kind && value.requestId === record.id && value.signature === record.signature && resultMatches(record,value.result) && receiptMatches(record,value,context); }
    function responseMatches(record,value) { return immutableResponseMatches(record,value) && value.revision >= Math.max(state.revision,state.minRevision) && value.now >= state.minObservedAt; }
    function recoveryReason(id) {
      const record = pending(); if (!record || record.id !== id) return '找不到這筆原操作。';
      const blocked = readiness(record.kind,record.body,{recover:true}); if (blocked) return blocked;
      const receipt = state.receipt;
      return receipt?.found === false && receipt.recoveryAllowed === true && receipt.kind === record.kind && receipt.requestId === record.id && receipt.signature === record.signature && ['accountId','realmId','characterId'].every(field => String(receipt[field]) === String(context[field])) ? '' : '請先核對這筆原操作的完整收據。';
    }
    function prepareRecovery(id) {
      const blocked = recoveryReason(id); if (blocked) { feedback(blocked,true); return false; }
      const record = clone(pending()); state.error = ''; state.confirm = {...record,label:'重試這筆原操作',details:record.label + '。' + record.details + ' 尚未找到完整收據，原請求可能仍在處理。確認後只送出同一編號與完全相同內容；已完成時取回原結果。',record,recovery:true,fingerprint:fingerprint()}; notify(); return true;
    }
    async function send(record,recovery) {
      if (!savePending(record,recovery ? record : null)) { state.confirm = null; feedback(state.storageError,true); return false; }
      state.confirm = null; state.busy = true; state.receipt = null; state.error = ''; state.notice = ''; generation++; receiptGeneration++; controller?.abort(); receiptController?.abort(); notify();
      let acknowledged = false;
      try {
        const value = await host.request('fate/action-scoped',clone(record.wireBody));
        if (!current() || !samePending(pending(),record)) return false;
        verifyIdentity(value); if (!responseMatches(record,value)) throw Error('回覆未包含符合原操作的完整收據。');
        state.minRevision = Math.max(state.minRevision,value.revision); state.minObservedAt = Math.max(state.minObservedAt,value.now);
        state.lastResult = {...clone(record),result:clone(value.result),costs:clone(value.receipt.costs)};
        const cleared = clearPending(record); if (!cleared) state.receipt = {...clone(value),found:true};
        state.stale = true; state.notice = cleared ? '已完成，可核對這次原始結果。' : state.storageError; acknowledged = true;
        try { host.onChanged?.(clone(value),{kind:record.kind,body:clone(record.body),recovery}); } catch {}
      } catch (error) {
        if (!current()) return false;
        state.stale = true; state.error = '操作結果待核對。' + (reason(error) ? ' ' + reason(error) : '') + ' 請查詢原操作收據；重新整理不會再次送出。';
      } finally { if (current()) { state.busy = false; notify(); if (acknowledged) await refresh(); } }
      return acknowledged;
    }
    async function submit() {
      if (!current() || !state.confirm) return false;
      const plan = state.confirm;
      if (plan.fingerprint !== fingerprint()) { state.confirm = null; feedback('旅章與資源已更新，請重新確認。',true); return false; }
      if (plan.recovery) {
        const blocked = recoveryReason(plan.record.id), record = pending();
        if (blocked || !record || !same(record,plan.record)) { state.confirm = null; feedback(blocked || '原操作紀錄已變更，請重新核對。',true); return false; }
        return send(clone(record),true);
      }
      const blocked = readiness(plan.kind,plan.body); if (blocked) { state.confirm = null; feedback(blocked,true); return false; }
      let requestId; try { requestId = host.newRequestId ? host.newRequestId() : makeRequestId(); } catch (error) { feedback(reason(error),true); return false; }
      const body = {...clone(plan.body),requestId}, record = {version:1,scope:identity,context:{accountId:String(context.accountId),realmId:String(context.realmId),characterId:String(context.characterId)},id:requestId,kind:plan.kind,body,wireBody:{kind:plan.kind,...body,realmId:String(context.realmId),selectedCharacterId:String(context.characterId)},signature:signature(plan.kind,plan.body),label:plan.label,details:plan.details,at:now()};
      if (!validRecord(record,identity)) { feedback('原操作紀錄不完整，尚未送出。',true); return false; }
      return send(record,false);
    }
    async function checkPending(id) {
      const record = pending(); if (!current() || !record || record.id !== id || state.busy || state.loading || state.checking) return false;
      if (!await refresh() || !current() || !samePending(pending(),record)) return false;
      const ticket = ++receiptGeneration; receiptController?.abort(); receiptController = new AbortController(); state.checking = true; state.receipt = null; state.error = ''; notify();
      try {
        const value = await host.request('fate/receipt',clone(record.wireBody),{signal:receiptController.signal});
        if (!current() || ticket !== receiptGeneration || !samePending(pending(),record)) return false;
        verifyEnvelope(value);
        if (typeof value.found !== 'boolean' || value.kind !== record.kind || value.requestId !== id || value.signature !== record.signature || value.found && !responseMatches(record,value) || !value.found && (value.result !== null || value.receipt !== null || typeof value.recoveryAllowed !== 'boolean')) throw Error('收據與原操作內容不符。');
        state.minRevision = Math.max(state.minRevision,value.revision); state.minObservedAt = Math.max(state.minObservedAt,value.now);
        if (value.revision > state.revision) state.stale = true;
        state.receipt = clone(value); state.notice = value.found ? '已找到原操作的已提交紀錄。' : value.recoveryAllowed ? '尚未找到完成收據。完整原操作會保留；需要時可明確確認同一筆恢復。' : '尚未取得完整收據，先前流程可能已有進度；請保留紀錄並稍後重新核對。';
        return true;
      } catch (error) { if (!current() || ticket !== receiptGeneration) return false; state.receipt = null; state.error = reason(error) || '暫時無法核對原操作。'; return false; }
      finally { if (current() && ticket === receiptGeneration) { state.checking = false; notify(); } }
    }
    async function readHistoryReceipt(requestKey) {
      if (!current() || state.busy || state.loading || state.checking || !state.data) return false;
      const summary = state.data.fate.history.receipts.find(row => row.requestKey === requestKey), match = /^scene:app:([A-Za-z0-9_-]{8,64})$/.exec(String(requestKey));
      let record;
      try {
        if (!summary || !match || summary.corrupt || summary.version !== 1 || !plain(summary.scope) || ['accountId','realmId','characterId'].some(field => String(summary.scope[field]) !== String(context[field]))) throw Error('這筆歷史收據不屬於目前角色。');
        const input = JSON.parse(summary.signature), kind = input.kind; delete input.kind;
        const body = canonical(kind,input);
        if (!body || signature(kind,body) !== summary.signature || kind !== summary.kind) throw Error('歷史紀錄缺少完整的原操作內容。');
        record = {kind,id:match[1],body:{...body,requestId:match[1]},signature:summary.signature,label:'原操作紀錄'};
      } catch (error) { feedback(reason(error),true); return false; }
      const ticket = ++receiptGeneration; receiptController?.abort(); receiptController = new AbortController(); state.checking = true; state.error = ''; state.historyReceipt = null; notify();
      try {
        const value = await host.request('fate/receipt',{kind:record.kind,...clone(record.body),realmId:String(context.realmId),selectedCharacterId:String(context.characterId)},{signal:receiptController.signal});
        if (!current() || ticket !== receiptGeneration) return false;
        verifyEnvelope(value); if (value.found !== true || !responseMatches(record,value)) throw Error('尚未取得完整的原收據。');
        state.minRevision = Math.max(state.minRevision,value.revision); state.minObservedAt = Math.max(state.minObservedAt,value.now); if (value.revision > state.revision) state.stale = true;
        state.historyReceipt = {...record,result:clone(value.result),costs:clone(value.receipt.costs)}; return true;
      } catch (error) { if (!current() || ticket !== receiptGeneration) return false; state.error = reason(error); return false; }
      finally { if (current() && ticket === receiptGeneration) { state.checking = false; notify(); } }
    }
    function acknowledge(id) {
      const record = pending(), receipt = state.receipt; if (state.storageError) { feedback(state.storageError,true); return false; }
      if (!current() || !record || record.id !== id || state.busy || state.loading || state.checking || receipt?.found !== true || !immutableResponseMatches(record,receipt)) return false;
      if (!clearPending(record)) { feedback(state.storageError,true); return false; }
      state.lastResult = {...clone(record),result:clone(receipt.result),costs:clone(receipt.receipt.costs)}; state.error = ''; state.notice = '已核對原操作的已提交紀錄。';
      try { host.onChanged?.(clone(receipt),{kind:record.kind,body:clone(record.body),acknowledged:true}); } catch {}
      notify(); if (!state.busy && !state.loading && !state.checking) void refresh(); return true;
    }
    function update(scene) {
      if (!current()) return;
      for (const field of ['accountId','realmId','characterId']) if (scene?.[field] != null && String(scene[field]) !== String(context[field])) return;
      const revision = scene?.live?.revision ?? scene?.character?.revision ?? scene?.revision;
      if (!integer(revision)) return; state.minRevision = Math.max(state.minRevision,revision);
      if (revision > state.revision) { state.stale = true; if (state.confirm) { state.confirm = null; state.notice = '角色狀態已更新，請重新確認。'; } if (!state.busy && !state.loading && !state.checking) void refresh(); else notify(); }
    }
    return {state,context,current,pending,markRevealed,feedback,refresh,getQuery:() => clone(query),clockNow,choiceOpen,readiness,prepare,prepareStart,prepareChoice,prepareKeep,prepareClaim,prepareOpen,cancel,submit,checkPending,readHistoryReceipt,acknowledge,recoveryReason,prepareRecovery,update,
      dispose() { if (disposed) return; disposed = true; generation++; receiptGeneration++; controller?.abort(); receiptController?.abort(); }};
  }

  function ensureStyle(root) {
    const doc = root.ownerDocument;
    if (!doc || sheets.has(doc)) return;
    const link = doc.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('scene-fate-ui.css?v=fate-f1-20261105',scriptUrl || doc.baseURI).href;
    doc.head.append(link); sheets.set(doc,link);
  }
  function loadStory(host,doc) {
    if (host.story) return Promise.resolve(host.story);
    if (!storyFlight) storyFlight = import(new URL('/scene-fate-story.js?v=fate-f1-20261105',doc.location?.href || doc.baseURI).href).catch(() => { storyFlight = null; throw Error('原故事暫時無法載入，請重新載入；已保存的旅章與選擇會保留。'); });
    return storyFlight;
  }
  function loadPrivate(host,doc) {
    if (host.privateFate) return Promise.resolve(host.privateFate);
    if (!privateFlight) privateFlight = import(new URL('/scene-fate-private-ui.js?v=fate-f2-20261105',doc.location?.href || doc.baseURI).href).catch(() => { privateFlight = null; throw Error('出生與旅箋暫時無法載入，請稍後重試。'); });
    return privateFlight;
  }
  function mount(root,host,options = {}) {
    ensureStyle(root);
    const scope = key(host.getContext?.(),true), identity = key(host.getContext?.()), doc = root.ownerDocument;
    const draft = host.draft ? (host.draft.fate ||= {}) : {};
    if (draft.scope !== identity) { for (const field of Object.keys(draft)) delete draft[field]; draft.scope = identity; }
    draft.section = options.section === 'private' ? 'private' : options.tab ? 'life' : draft.section === 'private' ? 'private' : 'life';
    draft.tab = TABS.some(([tab]) => tab === options.tab) ? options.tab : TABS.some(([tab]) => tab === draft.tab) ? draft.tab : 'overview';
    draft.country = COUNTRIES.includes(draft.country) ? draft.country : 'TW';
    draft.showSign = typeof draft.showSign === 'boolean' ? draft.showSign : true;
    draft.importCode ||= ''; draft.eventLimit = positive(draft.eventLimit) ? draft.eventLimit : 20;
    let disposed = false, painting = false, pendingFrame = null, focusedConfirm = null, confirmationOrigin = null, returnFocus = null;
    let storyApi = null, storyKey = '', storyGeneration = 0, storyBusy = false, storyError = '';
    const stories = new Map(), locallyRevealed = new Set();
    let privateMount = null, privateRoot = null, privateLoading = false, privateError = '', privateGeneration = 0;
    const sameScope = () => !disposed && key(host.getContext?.(),true) === scope && host.current?.() !== false;
    const privatePendingBlock = () => {
      try { let storage = host.storage; if (!storage) storage = globalThis.sessionStorage; return storage?.getItem('rpg-sfp-pending:' + identity) != null ? '出生與旅箋有一筆操作待核對，請先開啟該區段。' : ''; }
      catch { return '無法讀取出生與旅箋的待核對紀錄，請恢復儲存後再操作。'; }
    };
    const externalBlock = () => host.mutationBlock?.() || privatePendingBlock();
    const client = createClient({...host,mutationBlock:externalBlock,onState:() => paint()}), state = client.state;
    const locked = () => !client.current() || state.busy || privateMount?.client.state.busy === true;
    const blocked = () => locked() || state.loading || state.checking || state.stale || !!client.pending() || !!state.storageError || state.data?.readOnly === true || state.data?.fate?.control.writable !== true || !!externalBlock();
    const button = (action,label,attrs = '',disabled = false,klass = '') => '<button type="button" class="sf-button ' + klass + '" data-sf-action="' + esc(action) + '" ' + attrs + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
    const note = text => '<p class="sf-muted">' + esc(text) + '</p>';
    const card = (title,body,klass = '',attrs = '') => '<section class="sf-card ' + klass + '" ' + attrs + '><h3>' + esc(title) + '</h3>' + body + '</section>';
    const fate = () => state.data?.fate;
    const itemText = items => Object.entries(items || {}).map(([item,amount]) => (ITEM_NAMES[item] || item) + ' ×' + fmt(amount)).join('、');
    const picture = (path,alt,klass = '',loading = 'lazy') => path && /^\/art\/[A-Za-z0-9_./-]+\.webp$/.test(path) && !path.includes('..') ? '<img class="' + esc(klass) + '" src="' + esc(host.artUrl ? host.artUrl(path) : path) + '" alt="' + esc(alt) + '" loading="' + loading + '">' : '';
    const currentStoryKey = () => fate()?.state.active ? 'current:' + JSON.stringify(fate().state.active) : null;
    const entryStoryKey = (entry,real) => (real ? 'complete:' : 'memory:') + entry.code + ':' + (real ? JSON.stringify(entry.draft) : '');
    function entryForResult() {
      if (!draft.result) return null;
      const f = fate(); if (!f) return null;
      if (draft.result.kind === 'completed') return f.history.entries.find(entry => entry.id === draft.result.id && entry.code === draft.result.code) || (f.state.last?.id === draft.result.id && f.state.last.code === draft.result.code ? f.state.last : null);
      return {code:draft.result.code,at:draft.result.at || null};
    }
    function selectedStory() { const entry = entryForResult(); return entry ? stories.get(entryStoryKey(entry,draft.result.kind === 'completed')) : null; }
    function storyRequests() {
      const f = fate(), tasks = [];
      if (!f || draft.section === 'private' || ['gifts','history'].includes(draft.tab)) return tasks;
      const active = f.state.active;
      if (active && ['overview','current'].includes(draft.tab)) tasks.push({key:currentStoryKey(),run:api => api.projectCurrent(clone(active))});
      if (draft.tab === 'archive') for (const entry of f.history.entries) tasks.push({key:entryStoryKey(entry,true),run:api => api.projectCompleted(clone(entry))});
      const selected = entryForResult();
      if (selected) { const completed = draft.result.kind === 'completed'; tasks.push({key:entryStoryKey(selected,completed),run:api => completed ? api.projectCompleted(clone(selected)) : api.projectMemorial(clone(selected))}); }
      return tasks;
    }
    function ensureStories() {
      const tasks = storyRequests(), nextKey = JSON.stringify([state.readSequence,draft.tab,draft.result?.code,tasks.map(task => task.key)]);
      if (!tasks.length) { storyGeneration++; storyKey = nextKey; storyBusy = false; storyError = ''; return; }
      if (nextKey === storyKey) return;
      storyKey = nextKey; const ticket = ++storyGeneration, missing = tasks.filter(task => !stories.has(task.key));
      if (!missing.length) { storyBusy = false; storyError = ''; return; }
      storyBusy = true; storyError = '';
      void loadStory(host,doc).then(async api => {
        const values = await Promise.all(missing.map(async task => ({key:task.key,value:await task.run(api)})));
        if (!sameScope() || ticket !== storyGeneration || storyKey !== nextKey) return;
        storyApi = api; for (const row of values) stories.set(row.key,row.value);
        while (stories.size > 64) stories.delete(stories.keys().next().value);
      }).catch(error => { if (sameScope() && ticket === storyGeneration) storyError = reason(error) || '這一世的原故事暫時未載入。'; })
        .finally(() => { if (sameScope() && ticket === storyGeneration) { storyBusy = false; paint(); } });
    }
    function resultView(entry) {
      if (!entry?.result) return '';
      const result = entry.result; let body;
      if (entry.kind === 'start') body = '<p>' + esc(result.already === true ? '已核對原本仍在進行的這一世，沒有再使用今日啟程額度。' : '新的一世已展開，使用今日一次啟程額度。') + '</p>' + note('原旅章編號：' + result.lifeId);
      else if (entry.kind === 'choice') body = '<p>已回應第 ' + fmt(result.index + 1) + ' 個抉擇 · 選項' + (result.answer === 0 ? 'Ⅰ' : 'Ⅱ') + '</p>' + note('原旅章編號：' + result.lifeId);
      else if (entry.kind === 'keep') body = '<p>旅人來信已收藏。</p>' + note('這份紀念不增加正式完成世數與星輝匣資格。');
      else if (entry.kind === 'gift-claim') body = '<p>已領取 <strong>' + fmt(result.claimed) + '</strong> 匣' + (result.remaining ? '，另有 ' + fmt(result.remaining) + ' 匣可繼續領取。' : '。') + '</p><details class="sf-details"><summary>查看原星輝匣編號</summary><p class="sf-id">' + esc(result.giftIds.join(' · ') || '本次沒有新增星輝匣') + '</p></details>';
      else body = '<p>完成 ' + fmt(result.milestone) + ' 世的星輝匣已開啟。</p><div class="sf-awards">' + Object.entries(result.items).map(([item,amount]) => '<div>' + picture('/art/' + (item.startsWith('guaranteed_') ? 'items-scrolls-pink-20261018/' : 'items-scrolls-cutout-20261011/') + item + '.webp',ITEM_NAMES[item],'sf-scroll') + '<span>' + esc(ITEM_NAMES[item] || item) + '<strong>×' + fmt(amount) + '</strong></span></div>').join('') + '</div>' + note('原星輝匣編號：' + result.giftId);
      return card('已核對的原始結果',body,'sf-result','data-sf-result');
    }
    function notices() {
      let html = '';
      if (externalBlock()) html += '<div class="sf-notice">' + esc(externalBlock()) + '<div class="sf-actions">' + button('section','前往出生與旅箋核對','data-sf-section="private"',locked()) + '</div></div>';
      if (state.error) html += '<div class="sf-notice sf-error" role="alert">' + esc(state.error) + '</div>';
      if (state.storageError) html += '<div class="sf-notice sf-error" role="alert">' + esc(state.storageError) + '</div>';
      if (state.notice) html += '<p class="sf-notice" role="status" aria-live="polite">' + esc(state.notice) + '</p>';
      if (state.stale && state.data && !state.loading) html += '<div class="sf-notice">目前保留上次已同步的旅章；請重新整理後再操作。</div>';
      if (storyError) html += '<div class="sf-notice sf-error" role="alert">' + esc(storyError) + '<div class="sf-actions">' + button('retry-story','重新載入原故事','',locked()) + '</div></div>';
      const record = client.pending();
      if (record) {
        const receipt = state.receipt, found = receipt?.found === true;
        let copy = '<p><strong>' + esc(record.label) + '</strong></p><p>' + esc(record.details) + '</p>' + note('原操作編號：' + record.id);
        if (found) copy += resultView({...record,result:receipt.result});
        copy += '<div class="sf-actions">' + button('check-pending',state.checking ? '核對中…' : '查詢原操作收據','data-sf-pending-id="' + esc(record.id) + '"',locked() || state.loading || state.checking,'sf-primary');
        if (found) copy += button('acknowledge','確認已收到原結果','data-sf-pending-id="' + esc(record.id) + '"',locked() || state.loading || state.checking || !!state.storageError);
        else if (receipt?.found === false && receipt.recoveryAllowed === true) copy += button('retry','確認同一筆恢復','data-sf-pending-id="' + esc(record.id) + '"',!!client.recoveryReason(record.id));
        copy += '</div>' + note('重新整理只讀取最新資料，不會重送或改用新編號。');
        html += card('上次操作結果待核對',copy,'sf-pending','data-sf-pending');
      }
      if (state.confirm) html += card(state.confirm.label,'<p>' + esc(state.confirm.details) + '</p><div class="sf-actions">' + button('cancel','先返回','',locked()) + button('confirm',locked() ? '送出中…' : '確認送出','',locked(),'sf-primary') + '</div>','sf-confirm','data-sf-confirm');
      if (state.lastResult && !record) html += resultView(state.lastResult);
      if (state.historyReceipt) html += resultView(state.historyReceipt);
      return html;
    }
    function metrics() {
      const f = fate(); return '<div class="sf-metrics"><span>正式完成<strong>' + fmt(f.state.completed) + '<small> 世</small></strong></span><span>今日啟程<strong>' + fmt(f.state.startedToday) + '<small> / 4</small></strong></span><span>可領星輝<strong>' + fmt(f.gifts.claimable) + '<small> 匣</small></strong></span><span>持有星輝<strong>' + fmt(f.gifts.unopened) + '<small> 匣</small></strong></span></div>';
    }
    function overview() {
      const f = fate(), active = f.state.active, story = stories.get(currentStoryKey());
      let html = '<section class="sf-hero">' + picture(story?.image || '/art/fate-taiwan-v8/taipei-dusk.webp','暮色中的命運旅章','sf-hero-art','eager') + '<div><p class="sf-eyebrow">THE LAST STAR LANTERN</p><h3>每一世，都值得被記得。</h3><p>從一座城市開始，沿著選擇與日常，走過屬於這位英雄的一生。</p></div></section>' + metrics();
      if (active) html += card('這一世仍在展開','<p>' + esc(story?.identity.title || '旅章已由背景持續推進。') + '</p>' + (story ? note(story.identity.place + ' · ' + story.age + ' 歲') : '') + '<div class="sf-actions">' + button('tab','繼續這一世','data-sf-tab="current"','', 'sf-primary') + '</div>');
      else if (f.state.last) html += card('上一世已落款','<p>完整走過的人生已收進這位角色的正式旅誌。</p><div class="sf-actions">' + button('view-life','翻閱上一世','data-sf-life-id="' + esc(f.state.last.id) + '" data-sf-code="' + esc(f.state.last.code) + '"',locked()) + '</div>');
      let fields = '<div class="sf-form"><label>這一世，從哪裡開始？<select data-sf-field="country"' + (blocked() ? ' disabled' : '') + '>' + f.countries.map(country => '<option value="' + esc(country.id) + '"' + (draft.country === country.id ? ' selected' : '') + '>' + esc(country.name + ' · ' + country.cityName) + '</option>').join('') + '</select></label><label class="sf-checkbox"><input type="checkbox" data-sf-field="showSign"' + (draft.showSign ? ' checked' : '') + (blocked() ? ' disabled' : '') + '><span>在旅章中顯示這一世的星座</span></label></div>';
      fields += note('交給命運：這一世的性別、家境與星座沿用原旅章規則抽選。出生地會改變求學、工作與日常遇見。') + '<div class="sf-actions">' + button('start','展開新的一世','',blocked() || f.control.startAllowed !== true,'sf-primary') + '</div>';
      if (f.control.startBlock) fields += note(f.control.startBlock);
      fields += '<div class="sf-rule"><span>一世 2 小時</span><span>同帳號每天最多 4 世</span><span>00:00–06:00 暫停成長</span></div>' + note('未回應的抉擇會由命運代選；落款後由你親自開啟下一世。');
      html += card('交給命運，重新啟程',fields);
      return html;
    }
    function storyEvents(story) {
      const count = Math.min(draft.eventLimit,story.events.length), rows = story.events.slice(-count);
      return '<ol class="sf-timeline">' + rows.map(row => '<li><span>' + esc(row.ageLabel || row.age + ' 歲') + '</span><p>' + esc(row.text) + '</p></li>').join('') + '</ol>' + (count < story.events.length ? button('more-events','再往前翻閱紀事','',locked()) : '') + note('已顯示 ' + fmt(count) + ' / ' + fmt(story.events.length) + ' 則原旅章紀事。');
    }
    function currentView() {
      const f = fate(), active = f.state.active, story = stories.get(currentStoryKey());
      if (!active) return card(f.state.last ? '這一世已落款' : '旅章等待啟程',note(f.state.last ? '正式完成紀錄與星輝匣資格已由背景保存。' : '回到旅章選擇出生地，展開第一世。') + '<div class="sf-actions">' + (f.state.last ? button('view-life','翻閱此生落款','data-sf-life-id="' + esc(f.state.last.id) + '" data-sf-code="' + esc(f.state.last.code) + '"',locked(),'sf-primary') : '') + button('tab','回到旅章','data-sf-tab="overview"',locked()) + '</div>');
      if (!story) return card('此世紀事',note(storyBusy ? '正在載入這一世的原故事…' : '原故事尚未完整載入；已保存的旅章不會改變。'));
      let html = '<section class="sf-current-hero">' + picture(story.image,story.identity.place,'sf-current-art') + '<div><p class="sf-eyebrow">第 ' + fmt(f.state.completed + 1) + ' 世 · 正在展開</p><h3>' + esc(story.identity.title) + '</h3><p>' + esc([story.identity.place,story.identity.gender,story.identity.family,story.identity.zodiac].filter(Boolean).join(' · ')) + '</p><strong class="sf-age">' + fmt(story.age) + '<small> 歲</small></strong><p>' + esc(story.growth) + '</p></div></section>';
      html += '<div class="sf-progress" role="progressbar" aria-label="已同步的人生成長" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(story.progress) + '"><span style="width:' + Math.max(0,Math.min(100,story.progress)) + '%"></span></div>';
      html += note(story.night ? '夜間休息中，06:00 接續這一世。' : '已同步至 ' + when(story.storyAt) + ' · 此世剩餘約 ' + Math.ceil(story.remainingMs/60000) + ' 分鐘。');
      if (story.settlementPending) html += '<div class="sf-notice">背景旅章正在同步。這裡保留已確認的故事，完成世數與獎勵以已保存紀錄為準。</div>';
      if (story.question) {
        const q = story.question;
        html += card(q.ageLabel + ' · ' + q.title,'<p class="sf-question-copy">' + esc(q.text) + '</p><div class="sf-choices">' + q.choices.map(choice => '<button type="button" class="sf-choice" data-sf-action="choice" data-sf-index="' + q.index + '" data-sf-answer="' + choice.answer + '"' + (blocked() || !client.choiceOpen() ? ' disabled' : '') + '><span>' + (choice.answer === 0 ? 'Ⅰ' : 'Ⅱ') + '</span><span><strong>' + esc(choice.label) + '</strong><small>' + esc(choice.reason) + '</small></span></button>').join('') + '</div><p class="sf-countdown" data-sf-countdown></p>' + note('90 秒內可以親自回應。沒有回應也會繼續，並留下命運代選的記憶。'),'sf-question','data-sf-question');
      }
      if (story.status.length) html += '<div class="sf-life-status">' + story.status.map(row => '<section><h4>' + esc(row.label) + '</h4><p>' + esc(row.text) + '</p></section>').join('') + '</div>';
      html += card('此世紀事',storyEvents(story));
      return html;
    }
    function resultPage() {
      const entry = entryForResult(), story = selectedStory();
      if (!entry) return card('旅章已更新',note('請從目前旅誌重新選擇這一世。') + button('close-result','回到旅誌','',locked()));
      if (!story) return card('翻閱原旅章',note(storyBusy ? '正在載入原本的人生故事…' : '原故事暫時尚未就緒。') + button('close-result','回到旅誌','',locked()));
      const real = story.countsAsLife === true;
      let body = picture(story.image,story.title,'sf-ending-art') + '<p class="sf-eyebrow">' + (real ? '正式完成的人生' : '旅人來信 · 紀念收藏') + '</p><h2>' + esc(story.title) + '</h2><p>' + esc([story.identity.place,story.identity.zodiac].filter(Boolean).join(' · ')) + '</p>';
      body += note(real ? '完成於 ' + when(story.at) + '；已計入目前角色的正式世數。' : '這份故事可作紀念收藏，不增加目前角色的正式世數或贈禮資格。');
      body += '<ol class="sf-timeline sf-ending-timeline">' + story.timeline.map(row => '<li><span>' + esc(row.age + ' 歲') + '</span><div><strong>' + esc(row.label) + '</strong><p>' + esc(row.text) + '</p></div></li>').join('') + '</ol>';
      body += '<details class="sf-details"><summary>讀成一篇短篇故事</summary><div class="sf-prose">' + story.paragraphs.map(text => '<p>' + esc(text) + '</p>').join('') + '</div></details><p class="sf-ending-summary">' + esc(story.summary) + '</p><blockquote>' + esc(story.quote) + '</blockquote>';
      body += '<details class="sf-details"><summary>翻閱原始選擇與紀事</summary>' + storyEvents(story) + '</details><details class="sf-details"><summary>旅人來信代碼</summary><p class="sf-id">' + esc(story.code) + '</p></details>';
      body += '<div class="sf-actions">' + button('close-result','回到旅誌','',locked()) + button('keep','收藏這封旅人來信','data-sf-code="' + esc(story.code) + '"',blocked(),'sf-primary') + '</div>';
      return '<section class="sf-card sf-ending" data-sf-story-result>' + body + '</section>';
    }
    function archive() {
      if (draft.result) return resultPage();
      const f = fate();
      let body = '<p>這位角色已完整走過 <strong>' + fmt(f.state.completed) + '</strong> 世。正式人生由背景保存，來信收藏另行保留。</p>';
      if (!f.history.entries.length) body += note('這一頁還沒有正式完成的旅章。');
      for (const entry of f.history.entries) {
        const story = stories.get(entryStoryKey(entry,true));
        body += '<article class="sf-memory"><div><small>' + esc(when(entry.at)) + ' · 正式完成</small><h4>' + esc(story?.title || '一世已落款') + '</h4><p>' + esc(story?.summary || '原旅章已保存，可以翻閱當時的選擇與記憶。') + '</p></div><div class="sf-actions">' + button('view-life','翻閱這一世','data-sf-life-id="' + esc(entry.id) + '" data-sf-code="' + esc(entry.code) + '"',locked()) + button('keep','收藏來信','data-sf-code="' + esc(entry.code) + '"',blocked()) + '</div></article>';
      }
      body += '<div class="sf-actions">' + (client.getQuery().before !== null ? button('archive-first','回到最新十世','',locked() || state.loading) : '') + (f.history.next !== null ? button('archive-next','再往前翻十世','data-sf-cursor="' + f.history.next + '"',locked() || state.loading) : '') + '</div>';
      let html = card('靈魂旅誌',body);
      let memories = f.history.memorials.length ? f.history.memorials.map(entry => '<article class="sf-memory"><p>收藏於 ' + esc(when(entry.at)) + '</p>' + button('view-memorial','翻閱紀念來信','data-sf-code="' + esc(entry.code) + '" data-sf-at="' + esc(entry.at) + '"',locked()) + '</article>').join('') : note('還沒有紀念來信。');
      html += card('紀念收藏',note('紀念收藏不增加正式完成世數，也不產生星輝匣。') + memories);
      html += card('收藏旅人來信','<label>旅人來信代碼<textarea rows="2" data-sf-field="importCode" spellcheck="false" autocomplete="off"' + (blocked() ? ' disabled' : '') + '>' + esc(draft.importCode) + '</textarea></label><div class="sf-actions">' + button('preview-code','先翻閱這封來信','',locked() || !draft.importCode.trim()) + '</div>' + note('翻閱僅顯示故事。需要收藏時，再按收藏來信確認。'));
      return html;
    }
    function gifts() {
      const f = fate(), g = f.gifts;
      let html = '<section class="sf-gift-hero">' + picture('/art/ui/command-collect-20261012.webp','四世星輝匣','sf-gift-art','eager') + '<div><p class="sf-eyebrow">MEMORIES INTO STARDUST</p><h3>四世星輝匣</h3><p>每四度完整走過人生，留下一份星輝。</p></div></section>' + metrics();
      html += card('凝成星輝','<p>' + (g.claimable ? '目前可領 ' + fmt(g.claimable) + ' 匣。' : '再完整走過 ' + fmt(g.nextIn) + ' 世，即達下一個里程碑。') + '</p><div class="sf-actions">' + button('claim',g.claimMilestones.length ? '領取 ' + fmt(g.claimMilestones.length) + ' 份星輝' : '目前沒有可領星輝','',blocked() || !g.claimMilestones.length,'sf-primary') + '</div>' + note('每批最多領取 25 份，累積未領的星輝會保留。訪客體驗與紀念收藏不計入。'));
      const filter = '<label class="sf-filter">查看星輝匣<select data-sf-field="giftStatus"' + (locked() || state.loading ? ' disabled' : '') + '>' + [['claimed','尚未開啟'],['opened','已開啟'],['all','全部']].map(([value,label]) => '<option value="' + value + '"' + (client.getQuery().giftStatus === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
      let rows = filter;
      for (const entry of g.entries) rows += '<article class="sf-gift-row"><div><h4>第 ' + fmt(entry.milestone) + ' 世的星輝</h4><p>' + esc(entry.status === 'opened' ? '已開啟 · ' + itemText(entry.items) : '完整保存，等待開啟') + '</p><small>' + esc(when(entry.status === 'opened' ? entry.openedAt : entry.createdAt)) + '</small><details class="sf-details"><summary>星輝匣編號</summary><p class="sf-id">' + esc(entry.id) + '</p></details></div>' + (entry.status === 'claimed' ? button('open','開啟這一匣','data-sf-gift-id="' + esc(entry.id) + '"',blocked(),'sf-primary') : '<span class="sf-badge">已開啟</span>') + '</article>';
      if (!g.entries.length) rows += note('這個分類目前沒有星輝匣。');
      rows += '<div class="sf-actions">' + (client.getQuery().giftAfter !== null ? button('gifts-first','回到第一頁','',locked() || state.loading) : '') + (g.nextCursor !== null ? button('gifts-next','查看下一頁','data-sf-cursor="' + g.nextCursor + '"',locked() || state.loading) : '') + '</div>';
      html += card('持有與開匣紀錄',rows);
      html += card('每匣的原獎勵機率','<div class="sf-pool">' + g.pool.map(row => '<div><strong>' + esc(row.chance) + '%</strong><span>' + esc(itemText(row.items)) + '</span></div>').join('') + '</div>' + note('開啟時只消耗指定的一匣；獎勵送入目前角色的道具庫。必過強化卷請在工坊手動選用。'));
      return html;
    }
    function history() {
      const rows = fate().history.receipts, names = {start:'啟程',choice:'人生抉擇',keep:'收藏來信','gift-claim':'領取星輝','gift-open':'開啟星輝'};
      return card('最近的原操作紀錄',note('查詢只核對當時已提交的結果，不會重送操作，也不會把原結果覆蓋目前的人生。') + (rows.length ? rows.map(row => '<article class="sf-history-row"><div><h4>' + esc(names[row.kind] || row.kind) + '</h4><p>' + esc(when(row.createdAt)) + '</p><details class="sf-details"><summary>原操作編號</summary><p class="sf-id">' + esc(row.requestKey) + '</p></details></div>' + button('history-receipt','核對原結果','data-sf-request-key="' + esc(row.requestKey) + '"',locked() || state.loading || state.checking || row.corrupt === true) + '</article>').join('') : note('目前還沒有這個入口的已提交紀錄。')));
    }
    function focusIdentity(element) {
      if (!element || !root.contains?.(element)) return null;
      const data = element.dataset || {}; if (!data.sfAction && !data.sfField) return null;
      return {data:Object.fromEntries(['sfAction','sfField','sfTab','sfLifeId','sfCode','sfGiftId','sfIndex','sfAnswer','sfPendingId','sfRequestKey'].filter(field => data[field] !== undefined).map(field => [field,data[field]])),start:element.selectionStart,end:element.selectionEnd};
    }
    function restoreFocus(identity) {
      if (!identity || !sameScope() || doc?.hidden || root.isConnected === false) return;
      const element = [...root.querySelectorAll('button,input,select,textarea')].find(row => Object.entries(identity.data).every(([field,value]) => row.dataset?.[field] === value));
      if (!element || element.disabled) return; element.focus?.({preventScroll:true});
      if (typeof identity.start === 'number') { try { element.setSelectionRange?.(identity.start,identity.end); } catch {} }
    }
    function cancelReveal() { if (pendingFrame !== null) globalThis.cancelAnimationFrame?.(pendingFrame); pendingFrame = null; }
    function revealPendingOnce() {
      const record = client.pending();
      if (!record || state.storageError || record.revealed || locallyRevealed.has(record.id) || pendingFrame !== null || locked() || state.loading || state.checking || state.confirm) return;
      const originalFocus = doc?.activeElement, id = record.id;
      const run = () => {
        pendingFrame = null;
        if (!sameScope() || root.isConnected === false || doc?.hidden || locked() || state.loading || state.checking || state.confirm || client.pending()?.id !== id || state.storageError || client.pending()?.revealed || locallyRevealed.has(id) || doc?.activeElement !== originalFocus) return;
        const target = [...root.querySelectorAll('[data-sf-action="check-pending"]')].find(row => row.dataset.sfPendingId === id), panel = target?.closest?.('[data-sf-pending]');
        if (!target || target.disabled || !panel) return;
        locallyRevealed.add(id); client.markRevealed(id); panel.scrollIntoView?.({block:'nearest',behavior:'auto'}); target.focus?.({preventScroll:true});
      };
      if (globalThis.requestAnimationFrame) pendingFrame = globalThis.requestAnimationFrame(run); else run();
    }
    function tickChoice() {
      if (!sameScope() || doc?.hidden) return;
      const active = fate()?.state.active, target = root.querySelector('[data-sf-countdown]');
      if (!active || !target) return;
      const at = client.clockNow(), remaining = storyApi?.remainingChoice(active.timing,at), open = client.choiceOpen();
      target.textContent = remaining?.night ? '夜間暫停回應 · 06:00 接續' : open && remaining ? '抉擇剩餘 ' + remaining.seconds + ' 秒' : '此頁回應已截止或待同步，請重新整理旅章。';
      for (const choice of root.querySelectorAll('[data-sf-action="choice"]')) choice.disabled = blocked() || !open;
    }
    function leavePrivate() {
      privateGeneration++; privateLoading = false; privateMount?.dispose(); privateMount = null; privateRoot = null; privateError = '';
    }
    function openSection(section) {
      if (!['life','private'].includes(section) || locked()) return;
      if (section === draft.section) return;
      if (section === 'life') leavePrivate();
      draft.section = section; client.cancel(); paint();
    }
    function ensurePrivate() {
      if (draft.section !== 'private' || !sameScope()) return;
      if (!privateRoot) { privateRoot = doc.createElement('div'); privateRoot.setAttribute('data-sf-private-host',''); }
      if (privateMount || privateLoading || privateError) return;
      privateLoading = true; const ticket = ++privateGeneration, capturedRoot = privateRoot;
      void loadPrivate(host,doc).then(api => {
        if (!sameScope() || ticket !== privateGeneration || draft.section !== 'private' || privateRoot !== capturedRoot) return;
        privateMount = api.mount(privateRoot,{...host,getFateState:() => fate(),onState:() => paint(),
          mutationBlock:() => {
            const external = host.mutationBlock?.(); if (external) return external;
            const record = client.pending();
            return state.storageError || (record ? '命運旅章有一筆操作待核對，請先返回核對原結果。' : '');
          },
          onNavigateLife:() => openSection('life'),onChanged:(value,operation) => { host.onChanged?.(value,operation); void client.refresh(); },
        });
      }).catch(() => { if (sameScope() && ticket === privateGeneration) privateError = '出生與旅箋暫時無法載入，請稍後重試。'; })
        .finally(() => { if (sameScope() && ticket === privateGeneration) { privateLoading = false; paint(); } });
    }
    function paint() {
      if (!sameScope() || painting) return; painting = true;
      try {
        ensureStories();
        const privateSlot = draft.section === 'private' && privateMount && privateRoot && root.contains(privateRoot) ? root.querySelector('[data-sf-private-slot]') : null;
        if (privateSlot) {
          // Keep the private subtree connected: detaching/re-focusing cancels IME.
          for (const node of [...privateSlot.childNodes]) if (node !== privateRoot) node.remove();
          for (const button of root.querySelectorAll('[data-sf-action="section"]')) button.disabled = locked();
          return;
        }
        const privateFocus = privateRoot?.contains?.(doc?.activeElement) ? {element:doc.activeElement,start:doc.activeElement.selectionStart,end:doc.activeElement.selectionEnd} : null;
        const position = root.scrollTop, focus = returnFocus || focusIdentity(doc?.activeElement); returnFocus = null;
        const f = fate(), actor = host.getActor?.() || host.actor || {}, realm = client.context.realmId === 'permanent' ? '永久世界' : '賽季世界';
        let html = '<div class="sf-window"><header class="sf-header"><div><p class="sf-eyebrow">A LIFE BEYOND THE STARS</p><h2>命運旅章</h2><p>' + esc(f?.state.heroName || actor.name || client.context.characterId) + ' · ' + esc(realm) + (state.data ? ' · ' + esc(when(state.data.now)) : '') + '</p></div>' + (draft.section === 'life' ? button('refresh',state.loading ? '同步中…' : '重新整理','',locked() || state.checking) : '') + '</header><nav class="sf-sections" aria-label="命運旅章區段">' + [['life','命運旅章'],['private','出生與旅箋']].map(([section,label]) => button('section',label,'data-sf-section="' + section + '" aria-selected="' + String(section === draft.section) + '"',locked(),section === draft.section ? 'is-active' : '')).join('') + '</nav>';
        if (draft.section === 'private') {
          ensurePrivate(); html += privateError ? '<div class="sf-notice sf-error" role="alert">' + esc(privateError) + '<div class="sf-actions">' + button('retry-private','重新載入出生與旅箋','',locked()) + '</div></div>' : '<div data-sf-private-slot>' + (privateMount ? '' : note('正在開啟出生與旅箋…')) + '</div>';
        } else {
          html += '<nav class="sf-tabs" aria-label="命運旅章頁籤">' + TABS.map(([tab,label]) => button('tab',label,'data-sf-tab="' + tab + '" aria-selected="' + String(tab === draft.tab) + '"',locked(),tab === draft.tab ? 'is-active' : '')).join('') + '</nav>' + notices();
          html += f ? ({overview,current:currentView,archive,gifts,history})[draft.tab]() : note(state.loading ? '正在讀取目前角色的旅章…' : '尚未取得完整旅章資料。');
        }
        html += '</div>'; root.innerHTML = html;
        if (draft.section === 'private' && privateRoot) root.querySelector('[data-sf-private-slot]')?.append(privateRoot);
        root.scrollTop = position;
        if (privateFocus && draft.section === 'private' && privateRoot?.contains(privateFocus.element) && !privateFocus.element.disabled && !doc?.hidden) { privateFocus.element.focus?.({preventScroll:true}); if (typeof privateFocus.start === 'number') { try { privateFocus.element.setSelectionRange?.(privateFocus.start,privateFocus.end); } catch {} } }
        if (state.confirm && focusedConfirm !== state.confirm) { focusedConfirm = state.confirm; if (sameScope() && !doc?.hidden) root.querySelector('[data-sf-action="cancel"]')?.focus?.({preventScroll:true}); root.querySelector('[data-sf-confirm]')?.scrollIntoView?.({block:'nearest',behavior:'auto'}); }
        else { if (!state.confirm) focusedConfirm = null; restoreFocus(focus); }
        tickChoice(); revealPendingOnce();
      } finally { painting = false; }
    }
    async function click(event) {
      const target = event.target.closest?.('[data-sf-action]'); if (!target || !root.contains?.(target) || target.disabled || !sameScope()) return;
      const action = target.dataset.sfAction, record = client.pending();
      if (record && action !== 'check-pending') { locallyRevealed.add(record.id); client.markRevealed(record.id); } cancelReveal();
      if (action === 'cancel') { returnFocus = confirmationOrigin; client.cancel(); return; }
      if (action === 'confirm') { await client.submit(); return; }
      if (action === 'check-pending') { await client.checkPending(target.dataset.sfPendingId); return; }
      if (action === 'acknowledge') { client.acknowledge(target.dataset.sfPendingId); return; }
      if (action === 'retry') { confirmationOrigin = focusIdentity(target); client.prepareRecovery(target.dataset.sfPendingId); return; }
      if (action === 'history-receipt') { await client.readHistoryReceipt(target.dataset.sfRequestKey); return; }
      if (action === 'refresh') { await client.refresh(); return; }
      if (action === 'section') { openSection(target.dataset.sfSection); return; }
      if (action === 'retry-private') { privateError = ''; paint(); return; }
      if (locked()) return;
      if (action === 'tab') { if (!TABS.some(([tab]) => tab === target.dataset.sfTab)) return; draft.tab = target.dataset.sfTab; client.cancel(); paint(); return; }
      if (action === 'retry-story') { storyKey = ''; paint(); return; }
      if (action === 'archive-first' || action === 'archive-next') { draft.result = null; client.cancel(); await client.refresh({...client.getQuery(),before:action === 'archive-next' ? Number(target.dataset.sfCursor) : null}); return; }
      if (action === 'gifts-first' || action === 'gifts-next') { client.cancel(); await client.refresh({...client.getQuery(),giftAfter:action === 'gifts-next' ? Number(target.dataset.sfCursor) : null}); return; }
      if (action === 'more-events') { draft.eventLimit += 20; paint(); return; }
      if (action === 'view-life') { const entry = fate().history.entries.find(row => row.id === target.dataset.sfLifeId && row.code === target.dataset.sfCode) || (fate().state.last?.id === target.dataset.sfLifeId && fate().state.last.code === target.dataset.sfCode ? fate().state.last : null); if (!entry) return; draft.result = {kind:'completed',id:entry.id,code:entry.code}; draft.tab = 'archive'; draft.eventLimit = 20; client.cancel(); paint(); return; }
      if (action === 'view-memorial') { const entry = fate().history.memorials.find(row => row.code === target.dataset.sfCode); if (!entry) return; draft.result = {kind:'memorial',code:entry.code,at:entry.at}; draft.tab = 'archive'; client.cancel(); paint(); return; }
      if (action === 'preview-code') { const code = draft.importCode.trim(); if (!codeValid(code)) { client.feedback('這張旅人來信代碼無法辨識，請核對完整內容。',true); return; } draft.result = {kind:'memorial',code}; draft.tab = 'archive'; client.cancel(); paint(); return; }
      if (action === 'close-result') { draft.result = null; draft.eventLimit = 20; client.cancel(); paint(); return; }
      confirmationOrigin = focusIdentity(target);
      if (action === 'start') client.prepareStart(draft.country,draft.showSign);
      else if (action === 'choice') {
        const index = Number(target.dataset.sfIndex), answer = Number(target.dataset.sfAnswer), story = stories.get(currentStoryKey()), q = story?.question;
        if (!q || q.index !== index || !q.choices.some(row => row.answer === answer)) { client.feedback('原抉擇已更新，請重新整理。',true); return; }
        const choice = q.choices.find(row => row.answer === answer);
        client.prepare('choice',{lifeId:fate().state.active.id,index,answer},q.title,'選擇「' + choice.label + '」。' + choice.reason + ' 提交後依原旅章繼續，這個選擇只屬於目前這一世。');
      } else if (action === 'keep') client.prepareKeep(target.dataset.sfCode);
      else if (action === 'claim') client.prepareClaim();
      else if (action === 'open') client.prepareOpen(target.dataset.sfGiftId);
    }
    async function change(event) {
      const field = event.target.dataset?.sfField; if (!field || !sameScope() || locked()) return;
      if (field === 'country') { draft.country = event.target.value; client.cancel(); }
      else if (field === 'showSign') { draft.showSign = event.target.checked === true; client.cancel(); }
      else if (field === 'giftStatus') { client.cancel(); await client.refresh({...client.getQuery(),giftStatus:event.target.value,giftAfter:null}); }
      else if (field === 'importCode') draft.importCode = event.target.value;
    }
    function input(event) {
      if (event.target.dataset?.sfField !== 'importCode' || !sameScope() || locked()) return;
      draft.importCode = event.target.value; if (state.confirm) client.cancel();
      const preview = root.querySelector('[data-sf-action="preview-code"]'); if (preview) preview.disabled = locked() || !draft.importCode.trim();
    }
    const visibility = () => { if (sameScope() && !doc?.hidden && !locked() && !state.loading && !state.checking && !state.confirm) void client.refresh(); };
    root.addEventListener('click',click); root.addEventListener('change',change); root.addEventListener('input',input); doc?.addEventListener?.('visibilitychange',visibility);
    paint(); void client.refresh();
    const timer = globalThis.setInterval?.(visibility,15000), clock = globalThis.setInterval?.(tickChoice,1000);
    return {client,refresh:() => draft.section === 'private' && privateMount ? privateMount.refresh() : client.refresh(),update:scene => { client.update(scene); privateMount?.update(scene); },
      handleBack() { if (draft.section === 'private' && privateMount?.handleBack()) return true; if (!sameScope() || !state.confirm || state.busy) return false; returnFocus = confirmationOrigin; client.cancel(); return true; },
      dispose() { if (disposed) return; disposed = true; storyGeneration++; leavePrivate(); cancelReveal(); globalThis.clearInterval?.(timer); globalThis.clearInterval?.(clock); client.dispose(); root.removeEventListener('click',click); root.removeEventListener('change',change); root.removeEventListener('input',input); doc?.removeEventListener?.('visibilitychange',visibility); }};
  }
  globalThis.RpgSceneFate = {createClient,mount,canonical,signature,resultMatches,receiptMatches,validRecord};
})();
