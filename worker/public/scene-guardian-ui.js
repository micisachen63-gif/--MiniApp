/* Guardian operations inside the shared scene window.
 * Scene/receipt reads never grant welcome draws, run jobs, or mark results seen.
 * Every mutation retains its complete original body until its typed receipt is known.
 */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const own = (value, field) => Object.prototype.hasOwnProperty.call(value || {}, field);
  const fmt = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', {maximumFractionDigits:0}) : '—';
  const percent = value => typeof value === 'number' && Number.isFinite(value) ? (value * 100).toLocaleString('zh-TW',{maximumFractionDigits:2}) : '—';
  const key = (context, epoch = false) => JSON.stringify((epoch ? ['accountId','realmId','characterId','epoch'] : ['accountId','realmId','characterId']).map(field => String(context?.[field] ?? '')));
  const reason = value => typeof value === 'string' ? value : value?.message || '';
  const itemId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
  const jobId = itemId;
  const requestId = () => 'sg_' + (globalThis.crypto?.randomUUID?.().replaceAll('-', '') || Date.now().toString(36) + Math.random().toString(36).slice(2, 16));
  const QUALITIES = ['white','green','blue','purple','red','gold','pink','cyan'];
  const QUALITY_NAMES = ['白色','綠色','藍色','紫色','紅色','金色','粉色','青色'];
  const TYPE_NAMES = {melee:'天使・熾刃',ranged:'天使・星弦',magic:'天使・秘曜',loot:'天使・豐穗'};
  const TABS = [['overview','守護'],['summon','召喚'],['inventory','背包'],['fusion','融合'],['auto','背景'],['history','紀錄']];
  const KINDS = ['welcome','summon','fuse','activate','lock','unbind','assist','sale','auto-start','auto-stop','auto-seen'];
  const ASSIST_MODES = ['start','select','stop','renew','continuation','supply','buy'];
  const COST_NAMES = {gold:'金幣',vouchers:'召喚憑證',credits:'精選抽次',freeNormalDraws:'免費普通抽次',unbind:'解綁卷軸',stones:'天使石',sigils:'天使羽毛'};
  const AUTO_REASONS = {target:'已達目標',resources:'資源不足',budget:'到達金幣上限',missing:'來源角色不存在',rules:'召喚規則已變更',stopped:'手動停止'};
  const BLOCK_NAMES = {active:'永久守護中',locked:'已鎖定',trade:'交易中',exchange:'交換中',assist:'參戰中或仍有保留戰鬥次數',bound:'已綁定'};
  const sheets = new WeakMap(), scriptUrl = globalThis.document?.currentScript?.src;
  const when = value => Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toLocaleString('zh-TW', {timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
  const qualityName = value => QUALITY_NAMES[typeof value === 'number' ? value - 1 : QUALITIES.indexOf(value)] || String(value ?? '—');
  const itemName = value => (value?.typeName || TYPE_NAMES[value?.type] || value?.type || '天使羽毛') + ' · ' + (value?.qualityName || qualityName(value?.quality));
  const costText = costs => Object.entries(costs || {}).filter(([,value]) => value > 0).map(([name,value]) => fmt(value) + ' ' + (COST_NAMES[name] || name)).join('、') || '不消耗資源';

  function exactCosts(value, fields) {
    if (!plain(value) || Object.keys(value).length !== fields.length || fields.some(field => !own(value, field) || !integer(value[field]))) return null;
    return Object.fromEntries(fields.map(field => [field, value[field]]));
  }
  function canonical(kind, input, withId = false) {
    if (!KINDS.includes(kind) || !plain(input)) return null;
    const fields = [], output = {};
    if (!['auto-stop','auto-seen'].includes(kind)) {
      if (typeof input.configVersion !== 'string' || !input.configVersion || input.configVersion.length > 128) return null;
      fields.push('configVersion'); output.configVersion = input.configVersion;
    }
    const add = (field, value = input[field]) => { fields.push(field); output[field] = value; };
    if (kind === 'summon') {
      const costs = exactCosts(input.expectedCosts, ['gold','vouchers','credits','freeNormalDraws']);
      if (!['normal','featured'].includes(input.pool) || ![1,5,10].includes(input.count) || !costs) return null;
      add('pool'); add('count'); add('expectedCosts', costs);
    } else if (kind === 'fuse') {
      const costs = exactCosts(input.expectedCosts, ['gold']);
      if (!Array.isArray(input.itemIds) || ![4,6].includes(input.itemIds.length) || input.itemIds.some(id => !itemId(id)) || new Set(input.itemIds).size !== input.itemIds.length || !itemId(input.primaryId) || !input.itemIds.includes(input.primaryId) || !costs) return null;
      add('itemIds', [...input.itemIds].sort()); add('primaryId'); add('expectedCosts', costs);
    } else if (kind === 'activate') {
      if (!own(input, 'itemId') || input.itemId !== null && !itemId(input.itemId)) return null;
      add('itemId');
    } else if (kind === 'lock') {
      if (!itemId(input.itemId) || typeof input.locked !== 'boolean') return null;
      add('itemId'); add('locked');
    } else if (kind === 'unbind') {
      const costs = exactCosts(input.expectedCosts, ['unbind']);
      if (!itemId(input.itemId) || !costs) return null;
      add('itemId'); add('expectedCosts', costs);
    } else if (kind === 'assist') {
      const costs = exactCosts(input.expectedCosts, ['gold','stones']);
      if (!ASSIST_MODES.includes(input.mode) || input.itemId !== '' && !itemId(input.itemId) || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10 || typeof input.autoRenew !== 'boolean' || typeof input.autoBuy !== 'boolean' || !costs) return null;
      if (['start','select'].includes(input.mode) && !itemId(input.itemId)) return null;
      add('mode'); add('itemId'); add('quantity'); add('autoRenew'); add('autoBuy'); add('expectedCosts', costs);
    } else if (kind === 'sale') {
      if (!itemId(input.characterId) || !Array.isArray(input.itemIds) || !input.itemIds.length || input.itemIds.length > 50 || input.itemIds.some(id => !itemId(id) || id.length > 64) || new Set(input.itemIds).size !== input.itemIds.length || !integer(input.expectedGold) || input.expectedGold === 0) return null;
      add('characterId'); add('itemIds', [...input.itemIds].sort()); add('expectedGold');
    } else if (kind === 'auto-start') {
      if (!['normal','featured'].includes(input.pool) || ![1,5,10].includes(input.count) || !['any','attack','melee','ranged','magic','loot'].includes(input.targetType) || !integer(input.targetRank) || input.targetRank > 6 || !own(input, 'maxGold') || input.maxGold !== null && !integer(input.maxGold) || input.targetType === 'any' && input.targetRank === 0) return null;
      add('pool'); add('count'); add('targetType'); add('targetRank'); add('maxGold');
    } else if (kind === 'auto-stop' || kind === 'auto-seen') {
      if (!jobId(input.jobId)) return null;
      add('jobId');
    }
    if (withId) {
      if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(input.requestId)) return null;
      fields.push('requestId');
    }
    if (Object.keys(input).length !== fields.length || Object.keys(input).some(field => !fields.includes(field))) return null;
    return output;
  }
  const signature = (kind, body) => { const value = canonical(kind, body, own(body, 'requestId')); return value ? JSON.stringify({kind, ...value}) : null; };
  function validRecord(record, identity) {
    if (!plain(record) || record.version !== 1 || record.scope !== identity || !KINDS.includes(record.kind) || typeof record.id !== 'string' || record.body?.requestId !== record.id || !canonical(record.kind,record.body,true) || record.signature !== signature(record.kind,record.body) || typeof record.label !== 'string' || record.label.length > 240 || typeof record.details !== 'string' || record.details.length > 6000 || !plain(record.expected) || !integer(record.at)) return false;
    const [accountId,realmId,characterId] = JSON.parse(identity);
    return same(record.context,{accountId,realmId,characterId}) && same(record.wireBody,{kind:record.kind,...record.body,realmId,selectedCharacterId:characterId});
  }
  function validQuery(input = {}) {
    if (!plain(input) || Object.keys(input).some(field => !['quality','cursor','limit','historyLimit'].includes(field))) throw Error('天使背包查詢內容不完整');
    const out = {};
    if (own(input, 'quality')) { if (!['all', ...QUALITIES].includes(input.quality)) throw Error('品質篩選不正確'); out.quality = input.quality; }
    if (own(input, 'cursor')) { if (input.cursor !== null && !itemId(input.cursor)) throw Error('背包分頁編號不正確'); out.cursor = input.cursor; }
    if (own(input, 'limit')) { if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 40) throw Error('背包分頁數量不正確'); out.limit = input.limit; }
    if (own(input, 'historyLimit')) { if (!Number.isSafeInteger(input.historyLimit) || input.historyLimit < 1 || input.historyLimit > 50) throw Error('紀錄筆數不正確'); out.historyLimit = input.historyLimit; }
    return out;
  }
  function resultMatches(record, result, context) {
    if (!plain(result)) return false;
    const body = record.body;
    if (record.kind === 'sale') {
      const sale = result.sale;
      return plain(sale) && sale.count === body.itemIds.length && sale.gold === body.expectedGold && Array.isArray(sale.items) && same(sale.items.map(item => item.id).sort(), body.itemIds) && sale.items.every(item => itemId(item.id) && integer(item.gold)) && sale.items.reduce((total,item) => total + item.gold, 0) === body.expectedGold;
    }
    if (record.kind.startsWith('auto-')) {
      const job = result.job;
      if (!plain(job) || !jobId(job.id) || !itemId(job.characterId) || !['running','ended'].includes(job.status) || typeof job.seen !== 'boolean' || !own(job,'maxGold') || job.maxGold !== null && !integer(job.maxGold)) return false;
      if (record.kind === 'auto-start') return String(job.characterId) === String(context.characterId) && ['pool','count','targetType','targetRank','maxGold'].every(field => job[field] === body[field]);
      return job.id === body.jobId && (record.kind === 'auto-stop' ? job.status === 'ended' : job.seen === true);
    }
    if (record.kind === 'welcome') {
      const welcome = result.welcome;
      return plain(welcome) && String(welcome.accountId) === String(context.accountId) && itemId(welcome.recipientCharacterId) && welcome.draws === 200 && integer(welcome.createdAt);
    }
    const operation = result.operation;
    if (!plain(operation) || !itemId(operation.operationId) || !itemId(operation.requestId) || String(operation.charId) !== String(context.characterId) || operation.action !== record.kind || operation.status !== 'committed' || operation.configVersion !== body.configVersion || !Array.isArray(operation.results) || !plain(operation.consumed) || !integer(operation.createdAt)) return false;
    if (operation.results.some(item => !itemId(item?.id) || !QUALITIES.includes(item.quality) || !own(TYPE_NAMES,item.type))) return false;
    if (record.kind === 'summon') return operation.pool === body.pool && operation.count === body.count && operation.results.length === body.count && Object.entries(body.expectedCosts).every(([field,value]) => operation.consumed[field] === value);
    if (record.kind === 'fuse') {
      if (typeof operation.success !== 'boolean' || operation.primaryId !== body.primaryId || !Array.isArray(operation.consumedIds) || operation.results.length !== 1 || operation.consumed.gold !== body.expectedCosts.gold) return false;
      return operation.success ? operation.refundedId === null && same([...operation.consumedIds].sort(), body.itemIds) : operation.refundedId === body.primaryId && operation.results[0].id === body.primaryId && same([...operation.consumedIds].sort(), body.itemIds.filter(id => id !== body.primaryId));
    }
    if (record.kind === 'activate') return body.itemId === null ? operation.results.length === 0 : operation.results.some(item => item.id === body.itemId);
    if (record.kind === 'unbind') return operation.usedUnbindScrolls === body.expectedCosts.unbind && operation.results.some(item => item.id === body.itemId && item.bound === false);
    if (record.kind === 'assist') return operation.mode === body.mode && operation.consumed.gold === body.expectedCosts.gold && Number(operation.consumed.stones || 0) === body.expectedCosts.stones;
    return true;
  }
  function receiptMatches(record, value, context) {
    const receipt = value?.receipt;
    if (!plain(receipt) || receipt.version !== 1 || receipt.kind !== record.kind || receipt.requestId !== record.id || !integer(receipt.createdAt) || !plain(receipt.costs)) return false;
    if (receipt.signature !== record.signature || !plain(receipt.scope) || ['realmId','accountId','characterId'].some(field => String(receipt.scope[field]) !== String(context[field])) || !['scene:app:' + record.id,'scene:service:' + record.id].includes(receipt.requestKey)) return false;
    const expected = record.kind === 'sale' ? {sigils:record.body.itemIds.length} : record.body.expectedCosts || {};
    return same(Object.keys(receipt.costs).sort(), Object.keys(expected).sort()) && Object.entries(expected).every(([field,cost]) => receipt.costs[field] === cost);
  }

  function createClient(host) {
    const context = {...host.getContext?.()}, identity = key(context), scope = key(context,true);
    let storage = host.storage;
    if (!storage) { try { storage = globalThis.sessionStorage; } catch {} }
    const storageKey = 'rpg-sg-pending:' + identity;
    const state = {data:null,loading:false,busy:false,checking:false,stale:true,error:'',notice:'',storageError:'',confirm:null,receipt:null,historyReceipt:null,lastResult:null,revision:-1,minRevision:-1,receivedAt:0};
    let disposed = false, generation = 0, receiptGeneration = 0, controller = null, receiptController = null, query = {}, knownRecord = null;
    const itemIndex = new Map(), shopIndex = new Map();
    const current = () => !disposed && key(host.getContext?.(),true) === scope && host.current?.() !== false;
    const notify = () => { if (current()) host.onState?.(state); };
    function pending() {
      try {
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw Error('storage unavailable');
        const raw = storage.getItem(storageKey);
        if (raw === null) { knownRecord = null; state.storageError = ''; return null; }
        const record = JSON.parse(raw);
        if (!validRecord(record,identity)) { state.storageError = '保存的待核對操作內容不完整，請保留這份資料；目前暫停新操作。'; return knownRecord; }
        knownRecord = record; state.storageError = ''; return record;
      } catch { state.storageError = '無法讀取待核對操作紀錄；請恢復瀏覽器儲存後再操作。'; return knownRecord; }
    }
    const samePendingOperation = (a,b) => !!a && !!b && a.id === b.id && a.scope === b.scope && a.signature === b.signature && same(a.context,b.context) && same(a.body,b.body) && same(a.wireBody,b.wireBody);
    function verifiedPending(expected) {
      const record = pending();
      if (state.storageError) return null;
      if (!samePendingOperation(record,expected)) { state.storageError = '保存的原操作內容已變更，請保留目前資料並重新核對。'; return null; }
      return record;
    }
    function savePending(record,expected = null) {
      const existing = pending();
      if (state.storageError) return false;
      if (expected ? !samePendingOperation(existing,expected) : existing !== null) { state.storageError = '保存的原操作內容已變更，尚未送出或覆寫任何紀錄。'; return false; }
      try {
        const stored = JSON.stringify(record);
        storage.setItem(storageKey,stored);
        if (storage.getItem(storageKey) !== stored) throw Error('storage verification');
        knownRecord = record; state.storageError = ''; return true;
      } catch { state.storageError = '無法完整保存原操作編號與內容，尚未送出這次操作。'; return false; }
    }
    function clearPending(expected) {
      if (!current() || !verifiedPending(expected)) return false;
      const original = knownRecord;
      try {
        storage.removeItem(storageKey);
        if (storage.getItem(storageKey) !== null) throw Error('storage verification');
        knownRecord = null; state.storageError = ''; state.receipt = null; return true;
      } catch { knownRecord = original; state.storageError = '原操作已完成，但無法更新本機待核對紀錄；請恢復儲存後再確認收據。'; return false; }
    }
    function markRevealed(id) {
      if (!current()) return false;
      const record = pending();
      if (state.storageError || !record || record.id !== id) return false;
      if (!record.revealed) return savePending({...record,revealed:true},record);
      return true;
    }
    function feedback(message, error = false) { if (!current()) return; state[error ? 'error' : 'notice'] = message; notify(); }
    function verifyIdentity(value) { for (const field of ['accountId','realmId','characterId']) if (String(value?.[field]) !== String(context[field])) throw Error('角色或世界已切換，請重新開啟守護天使'); }
    function accept(value) {
      verifyIdentity(value);
      const guardian = value?.guardian, inventory = guardian?.state?.inventory;
      if (value?.ok !== true || !plain(guardian) || !plain(guardian.config) || typeof guardian.config.configVersion !== 'string' || !plain(guardian.state) || String(guardian.state.charId) !== String(context.characterId) || !plain(inventory) || !Array.isArray(inventory.items) || !plain(inventory.qualityCounts) || !plain(inventory.eligibleCounts) || !plain(guardian.quotes) || !plain(guardian.history) || !Array.isArray(guardian.history.operations) || !Array.isArray(guardian.history.receipts) || !plain(guardian.control) || typeof guardian.control.writable !== 'boolean') throw Error('天使資料尚未完整，請重新整理');
      if (!integer(value.revision) || value.revision < Math.max(state.revision,state.minRevision)) throw Error('收到較早的角色資料，請重新整理');
      if (inventory.items.some(item => !itemId(item?.id) || !QUALITIES.includes(item.quality) || !own(TYPE_NAMES,item.type))) throw Error('天使背包資料不完整，請重新整理');
      if (inventory.nextCursor !== null && !itemId(inventory.nextCursor)) throw Error('天使背包分頁資料不完整');
      return value.revision;
    }
    const fingerprint = () => JSON.stringify([state.revision,query,state.data?.readOnly,state.data?.guardian]);
    // A revision-only re-read keeps the current buttons until the answer arrives.
    var backgroundRead = false;
    async function refresh(nextQuery = query) {
      const quiet = backgroundRead; backgroundRead = false;
      if (!current() || state.busy || state.checking) return false;
      const ticket = ++generation, before = fingerprint(); controller?.abort(); controller = new AbortController(); state.loading = true; state.error = ''; if (!quiet) notify();
      try {
        const next = validQuery(nextQuery), value = await host.request('guardian/scene',clone(next),{signal:controller.signal});
        if (!current() || ticket !== generation) return false;
        const revision = accept(value);
        if (revision !== state.revision) { itemIndex.clear(); shopIndex.clear(); }
        for (const item of value.guardian.state.inventory.items) itemIndex.set(item.id,clone(item));
        for (const item of value.guardian.shop?.items || []) shopIndex.set(item.id,clone(item));
        state.revision = revision; query = next; state.data = clone(value); state.receivedAt = Date.now(); state.stale = false;
        if (state.confirm && before !== fingerprint()) { state.confirm = null; state.notice = '角色、背包或費用已更新，請重新確認操作。'; }
        pending(); return true;
      } catch (error) { if (!current() || ticket !== generation) return false; state.stale = true; state.confirm = null; state.error = error?.message || '暫時無法讀取天使資料'; return false; }
      finally { if (current() && ticket === generation) { state.loading = false; notify(); } }
    }
    function readiness(kind, body, {recover = false} = {}) {
      if (!current()) return '角色或世界已切換';
      if (state.busy || state.loading || state.checking) return '正在更新天使資料';
      if (!state.data || state.stale || state.revision < state.minRevision) return '請先更新天使資料';
      const record = pending();
      if (state.storageError) return state.storageError;
      if (!recover && record) return '請先核對上次操作結果';
      const guardian = state.data.guardian;
      if (state.data.readOnly || guardian.control.realmPhase !== 'ACTIVE') return reason(state.data.readOnlyReason) || '這個世界目前只能查看資料';
      if (['auto-stop','auto-seen'].includes(kind)) return '';
      if (guardian.config.enabled !== true) return reason(guardian.config.status) || '天使系統目前無法操作';
      if (guardian.state.unlocked !== true) return '守護天使需要 Lv.' + fmt(guardian.config.limits?.unlockLevel ?? 15);
      if (recover) return '';
      if (['summon','auto-start'].includes(kind) && guardian.state.welcome?.claimed !== true) return '請先在守護頁明確領取首次免費普通召喚';
      if (kind === 'welcome' && guardian.state.welcome?.claimed === true) return '這個帳號已領取首次召喚額度';
      if (body?.configVersion !== undefined && body.configVersion !== guardian.config.configVersion) return '召喚規則已更新，請重新確認';
      if (guardian.control.partyLocked && !['welcome','summon','assist','auto-start','auto-stop','auto-seen'].includes(kind)) return '目前隊伍活動鎖定背包操作';
      return '';
    }
    function prepare(kind, body, label, details, expected = {}) {
      const canonicalBody = canonical(kind,body), blocked = readiness(kind,body);
      if (blocked || !canonicalBody) { feedback(blocked || '操作內容不完整，請重新選擇。',true); return false; }
      state.error = ''; state.notice = ''; state.confirm = {kind,body:canonicalBody,label,details,expected:clone(expected),fingerprint:fingerprint(),recovery:false}; notify(); return true;
    }
    const configVersion = () => state.data?.guardian?.config.configVersion;
    const item = id => itemIndex.get(id) || (state.data?.guardian?.state.activeGuardian?.id === id ? state.data.guardian.state.activeGuardian : null);
    const shopItem = id => shopIndex.get(id);
    const summonQuote = (pool,count) => { const quotes = state.data?.guardian?.quotes?.summon?.[pool]; return Array.isArray(quotes) ? quotes.find(value => value.count === count) : quotes?.[count]; };
    function prepareWelcome() {
      return prepare('welcome',{configVersion:configVersion()},'領取首次普通召喚額度','這個帳號只能領取一次 200 次免費普通召喚，全部發給目前角色。領取後不會自動召喚。',{});
    }
    function prepareSummon(pool,count) {
      const quote = summonQuote(pool,count);
      if (!quote || quote.affordable !== true) { feedback(reason(quote?.reason) || '目前資源不足或召喚報價尚未完整',true); return false; }
      const costs = quote.expectedCosts || quote.costs;
      return prepare('summon',{configVersion:configVersion(),pool,count,expectedCosts:costs},(pool === 'normal' ? '普通' : '精選') + fmt(count) + ' 次召喚','目前角色消耗：' + costText(costs) + '。' + (pool === 'normal' ? '優先使用免費普通抽次；剩餘付費抽次依目前規則計價。' : '每張憑證可換 ' + fmt(state.data.guardian.config.pools?.featured?.drawsPerVoucher) + ' 抽，未用完的抽次會保留。') + '結果由原召喚服務產生，完成後可核對這次原羽毛編號。',{pool,count});
    }
    function prepareActivate(id) {
      const selected = id === null ? null : item(id);
      if (id !== null && (!selected || selected.inTrade || selected.inExchange || selected.protection?.activate)) { feedback(reason(selected?.protection?.activate) || '找不到可啟用的天使羽毛',true); return false; }
      return prepare('activate',{configVersion:configVersion(),itemId:id},id === null ? '卸下永久守護' : '啟用永久守護',id === null ? '取消目前角色的永久守護。若參戰天使不同步，原參戰設定及保留次數會依原規則清除。' : itemName(selected) + '，編號 ' + id + '。啟用後綁定目前角色；替換不同天使時，既有參戰設定及保留次數會依原規則清除。',{item:selected});
    }
    function prepareLock(id,locked) {
      const selected = item(id);
      if (!selected || selected.inTrade || selected.inExchange || selected.protection?.lock) { feedback(reason(selected?.protection?.lock) || '這件羽毛目前無法變更鎖定',true); return false; }
      return prepare('lock',{configVersion:configVersion(),itemId:id,locked},locked ? '鎖定羽毛' : '解除羽毛鎖定',itemName(selected) + '，編號 ' + id + '。' + (locked ? '鎖定後會受到融合、販售與解綁保護。' : '解除鎖定後可依原條件融合、販售或解綁。'),{item:selected});
    }
    function prepareUnbind(id) {
      const selected = item(id), cost = state.data?.guardian?.config.rules?.unbindScrollCost?.[Number(selected?.rank) - 1];
      if (!selected || selected.bound !== true || selected.active || selected.locked || selected.inTrade || selected.inExchange || selected.protection?.unbind || !integer(cost)) { feedback(reason(selected?.protection?.unbind) || '這件羽毛不符合解綁條件',true); return false; }
      return prepare('unbind',{configVersion:configVersion(),itemId:id,expectedCosts:{unbind:cost}},'解綁羽毛',itemName(selected) + '，編號 ' + id + '。消耗 ' + fmt(cost) + ' 張解綁卷軸，解除與目前角色的綁定。',{item:selected});
    }
    function prepareFuse(primaryId,ids) {
      const values = [...new Set(ids)].map(item), primary = item(primaryId), stage = state.data?.guardian?.config.rules?.upgradeStages?.find(value => value.from === primary?.quality);
      if (!primary || !stage || values.some(value => !value) || values.length !== stage.materials || !ids.includes(primaryId) || values.some(value => value.quality !== primary.quality || value.active || value.locked || value.inTrade || value.inExchange || value.protection?.fuse) || !stage.mixedTypes && values.some(value => value.type !== primary.type)) { feedback('請明確選擇主羽毛與符合這階規則的完整素材',true); return false; }
      const body = {configVersion:configVersion(),itemIds:[...ids],primaryId,expectedCosts:{gold:stage.goldFee}};
      return prepare('fuse',body,'融合天使羽毛','主羽毛：' + itemName(primary) + '（' + primaryId + '）。素材共 ' + fmt(ids.length) + ' 張（含主羽毛）：' + [...ids].sort().join('、') + '。消耗 ' + fmt(stage.goldFee) + ' 金幣，成功率 ' + percent(stage.successRate) + '%。成功產物沿用主羽毛類型；失敗保留這張原主羽毛。任一素材已綁定，結果也綁定。',{primary,items:values,stage});
    }
    function prepareAssist(mode,options = {}) {
      const assist = state.data?.guardian?.state.assist;
      const id = own(options,'itemId') ? options.itemId : assist?.itemId || '';
      const quantity = own(options,'quantity') ? options.quantity : 1;
      const autoRenew = own(options,'autoRenew') ? options.autoRenew : assist?.autoRenew === true;
      const autoBuy = own(options,'autoBuy') ? options.autoBuy : assist?.autoBuy === true;
      const resumed = mode === 'start' && id === assist?.itemId && assist?.enabled === false && assist.remainingBattles > 0;
      const quotes = state.data?.guardian?.quotes.assist;
      const costs = mode === 'buy' ? quotes?.buy?.find(value => value.quantity === quantity)?.expectedCosts : mode === 'start' ? quotes?.[resumed ? 'resume' : 'start']?.expectedCosts : {gold:0,stones:0};
      const labels = {start:resumed ? '恢復天使參戰' : '開始天使參戰',select:'選定參戰天使',stop:'暫停天使參戰',renew:'設定參戰',continuation:autoRenew ? '開啟自動續召' : '關閉自動續召',supply:autoBuy ? '開啟金幣購石' : '關閉金幣購石',buy:'購買天使石'};
      if (['start','select'].includes(mode) && !item(id)) { feedback('請先選擇一張目前可用的天使羽毛',true); return false; }
      let detail = labels[mode] + '。';
      if (mode === 'start') detail += resumed ? '恢復同一張羽毛的 ' + fmt(assist.remainingBattles) + ' 場保留次數，本次不再消耗天使石。' : '立即消耗 1 顆天使石，提供 ' + fmt(assist?.battlesPerStone) + ' 場參戰。替換不同羽毛時，原保留次數會依原規則清除。';
      if (mode === 'select') detail += '啟用並綁定所選羽毛；沒有保留次數時，由下一場戰鬥依原規則使用第一顆天使石。';
      if (mode === 'stop') detail += '保留剩餘 ' + fmt(assist?.remainingBattles) + ' 場，永久守護不變。';
      if (mode === 'continuation') detail += autoRenew ? '次數用完後，原戰鬥服務會使用下一顆天使石續召。' : '次數用完後停止續召。';
      if (mode === 'supply') detail += autoBuy ? '天使石不足且需要參戰時，允許原戰鬥服務以每顆 ' + fmt(assist?.stoneGold) + ' 金幣購買。' : '天使石不足時不再自動花費金幣購石。';
      if (mode === 'buy') detail += '目前角色消耗 ' + fmt(costs?.gold) + ' 金幣，取得 ' + fmt(quantity) + ' 顆天使石。';
      if (['start','select'].includes(mode)) detail += '羽毛編號：' + id + '。';
      return prepare('assist',{configVersion:configVersion(),mode,itemId:id,quantity,autoRenew,autoBuy,expectedCosts:costs},labels[mode],detail,{resumed});
    }
    function prepareSale(ids) {
      const unique = [...new Set(ids)], values = unique.map(shopItem);
      if (!values.length || values.length > 50 || values.some(value => !value || value.sellBlock || !integer(value.sellPrice) || value.sellPrice === 0)) { feedback('販售僅限 1 至 50 件目前可販售的羽毛',true); return false; }
      const gold = values.reduce((total,value) => total + value.sellPrice,0);
      return prepare('sale',{configVersion:configVersion(),characterId:String(context.characterId),itemIds:unique,expectedGold:gold},'販售選取的天使羽毛','販售 ' + fmt(unique.length) + ' 件羽毛，取得 ' + fmt(gold) + ' 金幣。原物品會移出目前角色背包，請核對編號：' + unique.sort().join('、') + '。',{items:values});
    }
    function prepareAutoStart(options) {
      return prepare('auto-start',{configVersion:configVersion(),...options},'開始背景召喚','由目前角色作為來源，每批 ' + fmt(options.count) + ' 次' + (options.pool === 'normal' ? '普通' : '精選') + '召喚；符合目標、資源不足或達到金幣上限時結束。' + (options.maxGold === null ? '本次明確選擇不設金幣上限。' : '金幣預算上限 ' + fmt(options.maxGold) + '；0 表示不使用金幣。') + '切換自有角色後仍顯示原來源角色；關閉浮窗不會停止背景作業。',{});
    }
    function autoJob() { const value = state.data?.guardian?.auto; return value?.job || (value?.id ? value : null); }
    function prepareAutoStop() {
      const job = autoJob(); if (!job || job.status !== 'running') { feedback('目前沒有可停止的背景召喚',true); return false; }
      return prepare('auto-stop',{jobId:job.id},'停止背景召喚','停止這個帳號的背景作業 ' + job.id + '，來源角色 ' + job.characterId + '。已提交的召喚結果與消耗保留；不會開始新的作業。',{sourceCharacterId:job.characterId});
    }
    function prepareAutoSeen() {
      const job = autoJob(); if (!job || job.status === 'running' || job.seen === true) { feedback('目前沒有尚未讀取的背景結果',true); return false; }
      return prepare('auto-seen',{jobId:job.id},'標記背景結果已閱','將原作業 ' + job.id + ' 的結果標記已閱；已取得的羽毛與原召喚紀錄保留。',{});
    }
    function cancel() { if (!current() || state.busy) return; state.confirm = null; notify(); }
    function recoveryReason(id) {
      const record = pending(); if (!record || record.id !== id) return '找不到這筆原操作';
      const blocked = readiness(record.kind,record.body,{recover:true}); if (blocked) return blocked;
      return state.receipt?.found === false && state.receipt.recoveryAllowed === true ? '' : '請先查詢這筆原操作的完整收據';
    }
    function prepareRecovery(id) {
      const blocked = recoveryReason(id); if (blocked) { feedback(blocked,true); return false; }
      const record = clone(pending()); state.error = ''; state.confirm = {...record,label:'重試這筆原操作',details:record.label + '。' + record.details + ' 尚未查到完成收據，原請求可能仍在處理。確認後只送出完全相同的編號與完整內容；已完成時取回原結果。',record,recovery:true,fingerprint:fingerprint()}; notify(); return true;
    }
    function responseMatches(record,value) {
      return value?.ok === true && integer(value.revision) && value.revision >= Math.max(state.revision,state.minRevision) && value.kind === record.kind && value.requestId === record.id && value.signature === record.signature && resultMatches(record,value.result,context) && receiptMatches(record,value,context);
    }
    async function send(record,recovery) {
      if (!savePending(record,recovery ? record : null)) { state.confirm = null; feedback(state.storageError,true); return false; }
      state.confirm = null; state.busy = true; state.receipt = null; state.error = ''; state.notice = ''; generation++; receiptGeneration++; controller?.abort(); receiptController?.abort(); notify();
      let acknowledged = false;
      try {
        const value = await host.request('guardian/action-scoped',clone(record.wireBody));
        if (!current() || pending()?.id !== record.id) return false;
        if (!samePendingOperation(pending(),record)) throw Object.assign(Error('保存的原操作內容已變更，請保留紀錄並重新核對'),{uncertain:true});
        verifyIdentity(value); if (!responseMatches(record,value)) throw Object.assign(Error('回覆未包含符合原操作的完整收據'),{uncertain:true});
        state.minRevision = Math.max(state.minRevision,value.revision); state.lastResult = {...clone(record),result:clone(value.result),costs:clone(value.receipt.costs)};
        const cleared = clearPending(record); if (!cleared) state.receipt = {...clone(value),found:true};
        state.stale = true; state.notice = cleared ? '已完成，可核對這次原始結果。' : state.storageError; acknowledged = true;
        try { host.onChanged?.(value,{kind:record.kind,body:clone(record.body),recovery}); } catch {}
      } catch (error) {
        if (!current()) return false;
        // A missing receipt or 4xx response does not prove the original preflight made no changes.
        // Retain all sent requests until the typed receipt is resolved or explicitly retried.
        state.stale = true; state.error = '操作結果待核對。' + (reason(error) ? ' ' + reason(error) : '') + ' 請查詢原操作收據；重新整理不會再次送出。';
      } finally { if (current()) { state.busy = false; notify(); if (acknowledged) { const message = state.error; await refresh(); if (message && !state.error) { state.error = message; notify(); } } } }
      return acknowledged;
    }
    async function submit() {
      if (!current() || !state.confirm) return false;
      const plan = state.confirm;
      if (plan.fingerprint !== fingerprint()) { state.confirm = null; feedback('角色、背包或費用已變更，請重新確認。',true); return false; }
      if (plan.recovery) {
        const blocked = recoveryReason(plan.record.id), record = pending();
        if (blocked || !record || !same(record,plan.record)) { state.confirm = null; feedback(blocked || '原操作紀錄已變更，請重新核對。',true); return false; }
        return send(clone(record),true);
      }
      const blocked = readiness(plan.kind,plan.body); if (blocked) { state.confirm = null; feedback(blocked,true); return false; }
      const id = requestId(), body = {...clone(plan.body),requestId:id};
      const record = {version:1,scope:identity,context:{accountId:String(context.accountId),realmId:String(context.realmId),characterId:String(context.characterId)},id,kind:plan.kind,body,wireBody:{kind:plan.kind,...body,realmId:String(context.realmId),selectedCharacterId:String(context.characterId)},signature:signature(plan.kind,plan.body),label:plan.label,details:plan.details,expected:clone(plan.expected),at:Date.now()};
      if (!validRecord(record,identity)) { feedback('原操作紀錄不完整，尚未送出',true); return false; }
      return send(record,false);
    }
    async function checkPending(id) {
      const record = pending(); if (!current() || !record || record.id !== id || state.busy || state.loading || state.checking) return false;
      if (!await refresh() || !current() || !samePendingOperation(pending(),record)) return false;
      const ticket = ++receiptGeneration; receiptController?.abort(); receiptController = new AbortController(); state.checking = true; state.receipt = null; state.error = ''; notify();
      try {
        const value = await host.request('guardian/receipt',clone(record.wireBody),{signal:receiptController.signal});
        if (!current() || ticket !== receiptGeneration || !samePendingOperation(pending(),record)) return false;
        verifyIdentity(value);
        if (value?.ok !== true || typeof value.found !== 'boolean' || value.kind !== record.kind || value.requestId !== id || value.signature !== record.signature || !integer(value.revision) || value.revision < Math.max(state.revision,state.minRevision)) throw Error('收據與原操作、角色或版本不符');
        if (value.found && !responseMatches(record,value)) throw Error('收據缺少完整的原始結果或成本');
        if (!value.found && (value.result !== null || value.receipt !== null || typeof value.recoveryAllowed !== 'boolean')) throw Error('收據狀態不一致，請重新查詢');
        if (value.revision > state.revision) { state.minRevision = Math.max(state.minRevision,value.revision); state.stale = true; }
        state.receipt = clone(value); state.notice = value.found ? '已找到原操作的已提交紀錄。' : '尚未查到原操作紀錄。原請求可能仍在處理，完整待核對內容會保留。'; return true;
      } catch (error) { if (!current() || ticket !== receiptGeneration) return false; state.receipt = null; state.error = reason(error) || '暫時無法核對原操作'; return false; }
      finally { if (current() && ticket === receiptGeneration) { state.checking = false; notify(); } }
    }
    async function readHistoryReceipt(requestKey) {
      if (!current() || state.busy || state.loading || state.checking || !state.data) return false;
      const summary = state.data.guardian.history.receipts.find(value => value.requestKey === requestKey), match = /^scene:app:([A-Za-z0-9_-]{8,64})$/.exec(String(requestKey));
      let record;
      try {
        if (!summary || !match || summary.corrupt || !plain(summary.scope) || ['realmId','accountId','characterId'].some(field => String(summary.scope[field]) !== String(context[field]))) throw Error('歷史收據不屬於目前角色與世界');
        const parsed = JSON.parse(summary.signature), kind = parsed.kind; delete parsed.kind;
        const body = canonical(kind,parsed);
        if (!body || signature(kind,body) !== summary.signature) throw Error('歷史收據缺少完整的原操作內容');
        record = {kind,id:match[1],signature:summary.signature,body:{...body,requestId:match[1]},label:'歷史原操作 · ' + kind,expected:{}};
      } catch (error) { feedback(reason(error) || '歷史收據格式不完整',true); return false; }
      const ticket = ++receiptGeneration; receiptController?.abort(); receiptController = new AbortController(); state.checking = true; state.error = ''; state.historyReceipt = null; notify();
      try {
        const value = await host.request('guardian/receipt',{kind:record.kind,...clone(record.body),realmId:String(context.realmId),selectedCharacterId:String(context.characterId)},{signal:receiptController.signal});
        if (!current() || ticket !== receiptGeneration) return false;
        verifyIdentity(value);
        if (value?.found !== true || !responseMatches(record,value)) throw Error('尚未取得這筆歷史操作完整、可驗證的原收據');
        if (value.revision > state.revision) { state.minRevision = Math.max(state.minRevision,value.revision); state.stale = true; }
        state.historyReceipt = {...record,result:clone(value.result),costs:clone(value.receipt.costs)}; return true;
      } catch (error) { if (!current() || ticket !== receiptGeneration) return false; state.error = reason(error) || '暫時無法讀取原收據'; return false; }
      finally { if (current() && ticket === receiptGeneration) { state.checking = false; notify(); } }
    }
    function acknowledge(id) {
      const record = pending(), receipt = state.receipt;
      if (state.storageError) { feedback(state.storageError,true); return false; }
      if (!current() || !record || record.id !== id || state.busy || state.loading || state.checking || state.stale || state.revision < state.minRevision || receipt?.found !== true || !responseMatches(record,receipt)) return false;
      if (!clearPending(record)) { feedback(state.storageError,true); return false; }
      state.lastResult = {...clone(record),result:clone(receipt.result),costs:clone(receipt.receipt.costs)};
      state.error = ''; state.notice = '已核對原操作的已提交紀錄。';
      try { host.onChanged?.(clone(receipt),{kind:record.kind,body:clone(record.body),recovery:false,acknowledged:true}); } catch {}
      notify(); return true;
    }
    function update(scene) {
      if (!current()) return; for (const field of ['accountId','realmId','characterId']) if (scene?.[field] != null && String(scene[field]) !== String(context[field])) return;
      const revision = scene?.live?.revision ?? scene?.character?.revision ?? scene?.revision; if (!integer(revision)) return;
      state.minRevision = Math.max(state.minRevision,revision);
      if (revision > state.revision) { state.stale = true; if (state.confirm) { state.confirm = null; state.notice = '角色狀態已更新，請重新確認。'; } if (!state.busy && !state.loading && !state.checking) { backgroundRead = true; void refresh(); } else notify(); }
    }
    return {state,context,current,pending,markRevealed,readiness,recoveryReason,feedback,refresh,getQuery:() => clone(query),getItem:item,getShopItem:shopItem,prepare,prepareWelcome,prepareSummon,prepareFuse,prepareActivate,prepareLock,prepareUnbind,prepareAssist,prepareSale,prepareAutoStart,prepareAutoStop,prepareAutoSeen,prepareRecovery,summonQuote,autoJob,cancel,submit,checkPending,readHistoryReceipt,acknowledge,update,
      dispose() { if (disposed) return; disposed = true; generation++; receiptGeneration++; controller?.abort(); receiptController?.abort(); }};
  }

  function ensureStyle(root) {
    const doc = root.ownerDocument;
    if (!doc || sheets.has(doc)) return;
    const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('scene-guardian-ui.css?v=angel-20261105',scriptUrl || doc.baseURI).href; doc.head.append(link); sheets.set(doc,link);
  }
  function mount(root,host,options = {}) {
    ensureStyle(root);
    const scope = key(host.getContext?.(),true), identity = key(host.getContext?.());
    const draft = host.draft || {};
    if (draft.guardianScope !== identity) { for (const field of Object.keys(draft)) delete draft[field]; draft.guardianScope = identity; }
    draft.tab = TABS.some(([tab]) => tab === options.tab) ? options.tab : TABS.some(([tab]) => tab === draft.tab) ? draft.tab : 'overview';
    draft.quality = ['all',...QUALITIES].includes(draft.quality) ? draft.quality : 'all';
    draft.primaryId ||= ''; draft.materialIds ||= []; draft.saleIds ||= []; draft.saleMode = draft.saleMode === true;
    draft.autoPool ||= 'normal'; draft.autoCount ||= '5'; draft.autoTargetType ||= 'any'; draft.autoTargetRank ||= '1'; draft.autoBudgetMode ||= 'limited'; if (!own(draft,'autoBudget')) draft.autoBudget = '0'; draft.stoneQuantity ||= '1';
    let ritual=null;
    let disposed = false, painting = false, pendingFrame = null, focusedConfirm = null, confirmationOrigin = null, returnFocus = null, locallyRevealed = new Set();
    const doc = root.ownerDocument;
    const sameScope = () => !disposed && key(host.getContext?.(),true) === scope && host.current?.() !== false;
    const client = createClient({...host,onState:() => paint()});
    const state = client.state;
    const locked = () => !client.current() || state.busy;
    const blocked = () => locked() || state.stale || !!client.pending() || !!state.storageError || state.data?.readOnly === true || !!state.data && state.data.guardian.control.realmPhase !== 'ACTIVE';
    const button = (action,label,attrs = '',disabled = false,klass = '') => '<button type="button" class="sg-button ' + klass + '" data-sg-action="' + esc(action) + '" ' + attrs + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
    const idAttrs = id => 'data-item-id="' + esc(id) + '"';
    const note = text => '<p class="sg-muted">' + esc(text) + '</p>';
    const card = (title,content,klass = '') => '<section class="sg-card ' + klass + '"><h3>' + esc(title) + '</h3>' + content + '</section>';
    const actionBlocked = (kind,body) => blocked() || !!client.readiness(kind,body);
    const guardian = () => state.data?.guardian;
    const art = selected => guardian()?.config.types?.find(type => type.id === selected?.type)?.artUrl;
    const image = selected => { const url = art(selected); return url ? '<img class="sg-feather" src="' + esc(host.artUrl ? host.artUrl(url) : url) + '" alt="' + esc(selected.typeName || TYPE_NAMES[selected.type]) + '" loading="lazy">' : ''; };
    function itemSummary(selected,actions = '') {
      return '<article class="sg-item" data-item-id="' + esc(selected.id) + '">' + image(selected) + '<div class="sg-item-copy"><strong>' + esc(itemName(selected)) + '</strong><span class="sg-id">' + esc(selected.id) + '</span><div class="sg-chips">' + [selected.active ? '永久守護中' : '',selected.bound ? '已綁定' : '未綁定',selected.locked ? '已鎖定' : '',selected.inTrade ? '交易中' : '',selected.inExchange ? '交換中' : ''].filter(Boolean).map(text => '<span>' + esc(text) + '</span>').join('') + '</div>' + actions + '</div></article>';
    }
    function resultView(entry) {
      if (!entry?.result) return '';
      const result = entry.result, operation = result.operation;
      let body = '<p>' + esc(entry.label || '原操作結果') + '</p>' + (entry.id ? '<p class="sg-id">原請求：' + esc(entry.id) + '</p>' : '') + '<p>原成本：' + esc(costText(entry.costs || operation?.consumed)) + '</p>';
      if (operation) {
        body += '<p class="sg-id">原操作：' + esc(operation.operationId) + '</p>';
        if (operation.action === 'fuse') body += '<p>' + (operation.success ? '融合成功' : '融合失敗，保留原主羽毛') + ' · 主羽毛 ' + esc(operation.primaryId) + (operation.refundedId ? ' · 退回 ' + esc(operation.refundedId) : '') + '</p><p class="sg-id">已消耗素材：' + esc((operation.consumedIds || []).join('、')) + '</p>';
        if (operation.action === 'assist') body += '<p>' + (operation.resumed ? '已恢復同一天使的保留次數' : '參戰設定已更新') + (operation.guardianAssist ? ' · 剩餘 ' + fmt(operation.guardianAssist.remainingBattles) + ' 場' : '') + '</p>';
        body += (operation.results || []).map(value => itemSummary(value)).join('');
      }
      if (result.sale) body += '<p>已販售 ' + fmt(result.sale.count) + ' 件，取得 ' + fmt(result.sale.gold) + ' 金幣。</p><ul class="sg-original-list">' + result.sale.items.map(value => '<li><span class="sg-id">' + esc(value.id) + '</span> · ' + esc(TYPE_NAMES[value.type] || value.type) + ' · ' + esc(qualityName(value.quality)) + ' · ' + fmt(value.gold) + ' 金幣</li>').join('') + '</ul>';
      if (result.welcome) body += '<p>帳號首次召喚額度：' + fmt(result.welcome.draws) + ' 次免費普通召喚。實際領取角色：<span class="sg-id">' + esc(result.welcome.recipientCharacterId) + '</span>。</p>' + (String(result.welcome.recipientCharacterId) !== String(client.context.characterId) ? note('這份帳號額度已由另一自有角色領取；本次核對保留原領取角色與原時間，不會再次發放。') : '');
      if (result.job) body += jobSummary(result.job,false);
      return card('原始已提交結果',body,'sg-result');
    }
    function notices() {
      const record = client.pending(); let out = '';
      if (state.error) out += '<p class="sg-notice sg-error" role="status">' + esc(state.error) + '</p>';
      if (state.storageError) out += '<p class="sg-notice sg-error" role="status">' + esc(state.storageError) + '</p>';
      if (state.notice) out += '<p class="sg-notice" role="status">' + esc(state.notice) + '</p>';
      if (state.data?.readOnly || state.data && state.data.guardian.control.realmPhase !== 'ACTIVE') out += '<p class="sg-notice">' + esc(reason(state.data.readOnlyReason) || '目前世界僅供查看。') + '</p>';
      if (state.data?.guardian.state.unlocked === false) out += '<p class="sg-notice">守護天使需要 Lv.' + fmt(state.data.guardian.config.limits?.unlockLevel) + '；目前可以查看原有資料。</p>';
      if (state.data?.guardian.config.enabled === false) out += '<p class="sg-notice">天使系統目前暫停新操作；仍可查看原紀錄，在開放世界停止原背景作業或標記已閱。</p>';
      if (state.data && state.stale && !state.loading && !state.busy && !state.checking) out += '<p class="sg-notice">角色資料需要更新。請重新整理後再確認操作或已取得的原收據。</p>';
      if (record) {
        const receipt = state.receipt;
        out += '<section class="sg-card sg-pending" data-sg-pending="' + esc(record.id) + '"><h3>原操作待核對</h3><p>' + esc(record.label) + '</p><p class="sg-id">' + esc(record.id) + '</p><p>' + esc(record.details) + '</p><p>完整編號與內容已保存。開窗、重新整理、切換頁籤與查詢收據均不會再次送出。</p><div class="sg-actions">' + button('check-pending',state.checking ? '查詢中…' : '查詢原操作收據','data-pending-id="' + esc(record.id) + '"',locked(),'sg-primary');
        if (receipt?.found === true) out += button('acknowledge','確認已收到原結果','data-pending-id="' + esc(record.id) + '"',locked() || state.stale);
        if (receipt?.found === false) out += button('retry','重試原編號與完整內容','data-pending-id="' + esc(record.id) + '"',!!client.recoveryReason(record.id));
        out += '</div>' + (receipt?.found === false ? note('尚未找到收據不代表原請求已取消。待核對紀錄會保留；重試前仍需另行確認。') : '') + '</section>';
        if (receipt?.found) out += resultView({...record,result:receipt.result,costs:receipt.receipt.costs});
      }
      if (state.confirm) out += '<section class="sg-card sg-confirm" data-sg-confirm tabindex="-1"><h3>' + esc(state.confirm.label) + '</h3><p>' + esc(state.confirm.details) + '</p><p class="sg-muted">目前操作角色：' + esc(host.getActor?.()?.name || host.actor?.name || client.context.characterId) + ' · ' + esc(client.context.realmId) + '</p><div class="sg-actions">' + button('cancel','取消','',state.busy) + button('confirm','確認執行','',state.busy,'sg-primary') + '</div></section>';
      if (state.lastResult && !record) out += resultView(state.lastResult);
      return out;
    }
    function overview() {
      const g = guardian(), s = g.state, assist = s.assist || {}, welcome = s.welcome || {};
      let out = card('永久守護',s.activeGuardian ? itemSummary(s.activeGuardian,button('activate','卸下永久守護','data-item-id="none"',actionBlocked('activate',{configVersion:g.config.configVersion,itemId:null}))) : note('尚未啟用永久守護。從背包選擇一張天使羽毛，啟用後綁定目前角色。'));
      out += card('首次普通召喚',welcome.claimed ? '<p>帳號已領取一次 200 次普通召喚。</p><p>領取角色：<span class="sg-id">' + esc(welcome.recipientCharId) + '</span> · 目前角色免費抽次 ' + fmt(s.balances.freeNormalDraws) + '</p>' : '<p>帳號首次可領取 200 次免費普通召喚，發給目前角色。領取與召喚分別確認。</p>' + button('welcome','領取首次 200 次普通召喚','',actionBlocked('welcome',{configVersion:g.config.configVersion}),'sg-primary'));
      const currentItem = s.inventory.items.find(value => value.id === assist.itemId) || (s.activeGuardian?.id === assist.itemId ? s.activeGuardian : null);
      let content = '<p><strong>' + (assist.enabled ? '正在參戰' : assist.remainingBattles > 0 ? '已暫停，保留次數' : '尚未參戰') + '</strong> · 剩餘 ' + fmt(assist.remainingBattles) + ' 場</p>' + (currentItem ? '<p>' + esc(itemName(currentItem)) + '</p>' : '') + (assist.itemId ? '<p class="sg-id">參戰羽毛：' + esc(assist.itemId) + '</p>' : '') + '<p>天使石 ' + fmt(assist.stoneCount) + ' 顆 · 每顆 ' + fmt(assist.battlesPerStone) + ' 場 · ' + fmt(assist.stoneGold) + ' 金幣</p><div class="sg-actions">';
      if (assist.enabled) content += button('assist-stop','暫停參戰','',actionBlocked('assist'));
      else if (assist.itemId) content += button('assist-start',assist.remainingBattles > 0 ? '恢復保留次數' : '開始參戰',idAttrs(assist.itemId),actionBlocked('assist'));
      else if (s.activeGuardian) content += button('assist-start','使用目前守護參戰',idAttrs(s.activeGuardian.id),actionBlocked('assist'));
      content += button('inventory-tab','選擇參戰天使','',locked()) + '</div><div class="sg-setting"><span>次數用完自動續召：<strong>' + (assist.autoRenew ? '開啟' : '關閉') + '</strong></span>' + button('continuation',assist.autoRenew ? '關閉自動續召' : '開啟自動續召','data-value="' + String(!assist.autoRenew) + '"',actionBlocked('assist') || !assist.itemId) + '</div><div class="sg-setting"><span>缺石時花金幣購買：<strong>' + (assist.autoBuy ? '開啟' : '關閉') + '</strong></span>' + button('supply',assist.autoBuy ? '關閉金幣購石' : '開啟金幣購石','data-value="' + String(!assist.autoBuy) + '"',actionBlocked('assist')) + '</div>' + note('暫停會保留剩餘場次；恢復同一張羽毛不再扣石。切換不同天使會依原規則替換保留次數。') + '<div class="sg-field-row"><label>購石數量<select data-sg-field="stoneQuantity"' + (locked() ? ' disabled' : '') + '>' + Array.from({length:10},(_,i) => '<option value="' + (i + 1) + '"' + (String(i + 1) === draft.stoneQuantity ? ' selected' : '') + '>' + (i + 1) + ' 顆</option>').join('') + '</select></label>' + button('buy-stones','購買天使石','',actionBlocked('assist')) + '</div>';
      out += card('參戰與天使石',content);
      return out;
    }
    function summon() {
      const g = guardian(), s = g.state;
      let out = (s.welcome?.claimed ? '' : card('首次召喚額度',note('請先到守護頁，明確領取帳號一次性的 200 次免費普通召喚。')+button('tab','前往領取','data-sg-tab="overview"'))) + card('目前角色召喚資源','<div class="sg-metrics"><span>金幣<strong>' + fmt(s.balances.gold) + '</strong></span><span>免費普通抽次<strong>' + fmt(s.balances.freeNormalDraws) + '</strong></span><span>召喚憑證<strong>' + fmt(s.balances.voucherCount) + '</strong></span><span>精選剩餘抽次<strong>' + fmt(s.balances.remainder) + '</strong></span></div>' + note('憑證與剩餘抽次合計可用 ' + fmt(s.balances.availableDraws) + ' 抽；每日取得憑證 ' + fmt(s.daily?.granted) + ' / ' + fmt(g.config.limits?.dailyVouchers) + '。'));
      for (const pool of ['normal','featured']) {
        const config = g.config.pools?.[pool]; if (!config) continue;
        let body = '<p>' + (pool === 'normal' ? '免費普通抽次優先使用，付費部分依目前伺服器價格計算。' : '每張憑證提供 ' + fmt(config.drawsPerVoucher) + ' 抽；未用完的 0 至 ' + fmt(config.drawsPerVoucher - 1) + ' 抽保留。') + '</p><div class="sg-summon-options">';
        for (const count of config.allowedCounts || []) {
          const quote = client.summonQuote(pool,count), costs = quote?.expectedCosts || quote?.costs;
          body += '<div class="sg-summon-option"><strong>' + fmt(count) + ' 次召喚</strong><p>' + esc(costs ? costText(costs) : '報價尚未完整') + '</p>' + button('summon','確認 ' + fmt(count) + ' 次','data-pool="' + pool + '" data-count="' + count + '"',actionBlocked('summon') || quote?.affordable !== true,'sg-primary') + (quote?.reason ? note(reason(quote.reason)) : '') + '</div>';
        }
        body += '</div><details class="sg-details"><summary>目前品質機率與規則</summary><div class="sg-rates">' + (config.rates || []).map(rate => '<span>' + esc(qualityName(rate.quality)) + '<strong>' + esc(rate.percent) + '%</strong></span>').join('') + '</div><p>不提供保底。規則版本：<span class="sg-id">' + esc(g.config.configVersion) + '</span></p></details>';
        out += card(config.name || (pool === 'normal' ? '普通召喚' : '精選召喚'),body);
      }
      return out;
    }
    function inventoryHeader() {
      const inventory = guardian().state.inventory;
      return '<div class="sg-field-row"><label>羽毛品質<select data-sg-field="quality"' + (locked() ? ' disabled' : '') + '><option value="all"' + (draft.quality === 'all' ? ' selected' : '') + '>全部品質</option>' + QUALITIES.map(quality => '<option value="' + quality + '"' + (draft.quality === quality ? ' selected' : '') + '>' + esc(qualityName(quality)) + ' · 可融合 ' + fmt(inventory.eligibleCounts[quality]) + '</option>').join('') + '</select></label>' + button('inventory-first','回第一頁','',locked() || !client.getQuery().cursor) + '</div><p class="sg-muted">整個背包共 ' + fmt(inventory.totalCount) + ' 件；下列可融合數量為完整背包統計，並非目前這一頁。</p><div class="sg-counts">' + QUALITIES.map(quality => '<span>' + esc(qualityName(quality)) + ' · 可融合 ' + eligibleCount(inventory.eligibleCounts[quality]) + '</span>').join('') + '</div>';
    }
    function eligibleCount(value) { return plain(value) ? fmt(Object.values(value).filter(integer).reduce((total,n) => total + n,0)) : fmt(value); }
    function inventoryFooter() {
      const next = guardian().state.inventory.nextCursor;
      return '<div class="sg-actions">' + button('inventory-next','下一頁','data-cursor="' + esc(next || '') + '"',locked() || !next) + '</div>' + (next ? note('依原羽毛編號繼續載入，選取不會自動販售或融合。') : note('已到目前篩選的最後一頁。'));
    }
    function inventory() {
      const g = guardian(), inventory = g.state.inventory;
      let body = inventoryHeader() + '<div class="sg-actions">' + button('sale-mode',draft.saleMode ? '退出販售選取' : '進入販售選取','',locked()) + '</div>';
      if (draft.saleMode) body += '<div class="sg-notice"><p>已選取 ' + fmt(draft.saleIds.length) + ' / 50 件。僅在完整確認後販售；啟用、鎖定、交易、交換或保留參戰次數的羽毛受到保護。</p>' + button('sale','確認販售選取羽毛','',actionBlocked('sale') || !draft.saleIds.length,'sg-primary') + button('sale-clear','清除選取','',locked() || !draft.saleIds.length) + '</div>';
      body += inventory.items.length ? inventory.items.map(selected => {
        const shop = g.shop?.items?.find(value => value.id === selected.id);
        let actions = '';
        if (draft.saleMode) {
          const chosen = draft.saleIds.includes(selected.id), protectedReason = shop?.sellBlock;
          actions = '<p>販售價 ' + fmt(shop?.sellPrice) + ' 金幣' + (protectedReason ? ' · ' + esc(BLOCK_NAMES[protectedReason] || reason(protectedReason) || protectedReason) : '') + '</p>' + button('sale-select',chosen ? '取消選取販售' : '選取販售',idAttrs(selected.id) + ' aria-pressed="' + chosen + '"',blocked() || !shop || !!protectedReason || !chosen && draft.saleIds.length >= 50);
        } else {
          const protectedItem = selected.inTrade || selected.inExchange;
          actions = '<div class="sg-actions">' + button('activate',selected.active ? '卸下守護' : '永久守護',idAttrs(selected.active ? 'none' : selected.id),actionBlocked('activate') || protectedItem) + button('lock',selected.locked ? '解除鎖定' : '鎖定',idAttrs(selected.id) + ' data-value="' + String(!selected.locked) + '"',actionBlocked('lock') || protectedItem) + button('unbind','解綁',idAttrs(selected.id),actionBlocked('unbind') || !selected.bound || selected.active || selected.locked || protectedItem) + button('assist-start','開始／恢復參戰',idAttrs(selected.id),actionBlocked('assist') || protectedItem) + button('assist-select','下場再用石',idAttrs(selected.id),actionBlocked('assist') || protectedItem) + button('fusion-primary','設為融合主羽毛',idAttrs(selected.id),blocked() || selected.active || selected.locked || protectedItem || selected.rank >= 8) + '</div>';
        }
        return itemSummary(selected,actions);
      }).join('') : note('目前篩選沒有羽毛。');
      return card('天使背包',body + inventoryFooter());
    }
    function fusion() {
      const g = guardian(), items = g.state.inventory.items, primary = client.getItem(draft.primaryId);
      const stage = g.config.rules?.upgradeStages?.find(value => value.from === primary?.quality);
      let body = '<p>先指定主羽毛，再明確選擇其餘素材。成功的類型沿用主羽毛；失敗保留同一個原主羽毛編號。</p>' + inventoryHeader();
      if (primary && stage) body += '<div class="sg-notice"><strong>主羽毛：' + esc(itemName(primary)) + '</strong><p class="sg-id">' + esc(primary.id) + '</p><p>素材 ' + fmt(draft.materialIds.length) + ' / ' + fmt(stage.materials) + '（含主羽毛） · 成功率 ' + percent(stage.successRate) + '% · 費用 ' + fmt(stage.goldFee) + ' 金幣</p><p>' + (stage.mixedTypes ? '此階允許混合天使類型。' : '此階所有素材必須與主羽毛相同類型。') + '任一素材綁定，結果也會綁定。</p><p class="sg-id">已選素材：' + esc(draft.materialIds.join('、')) + '</p>' + button('fuse','確認融合','',actionBlocked('fuse') || draft.materialIds.length !== stage.materials,'sg-primary') + button('fusion-clear','重選主羽毛','',locked()) + '</div>';
      else body += note('尚未選擇主羽毛。青色品質無下一階融合。');
      body += items.map(selected => {
        const protectedItem = selected.active || selected.locked || selected.inTrade || selected.inExchange || selected.rank >= 8;
        const chosen = draft.materialIds.includes(selected.id), eligible = !protectedItem && (!primary || selected.quality === primary.quality && (stage?.mixedTypes || selected.type === primary.type));
        let actions = '<div class="sg-actions">' + button('fusion-primary',selected.id === draft.primaryId ? '目前主羽毛' : '設為主羽毛',idAttrs(selected.id),blocked() || protectedItem || selected.id === draft.primaryId);
        if (primary) actions += button('fusion-material',chosen ? '移除素材' : '選為素材',idAttrs(selected.id) + ' aria-pressed="' + chosen + '"',blocked() || !eligible || selected.id === draft.primaryId || !chosen && draft.materialIds.length >= stage?.materials);
        return itemSummary(selected,actions + '</div>');
      }).join('');
      return card('融合天使羽毛',body + inventoryFooter());
    }
    function jobSummary(job,showSource = true) {
      const auto = guardian()?.auto, source = auto?.sourceCharacter, other = String(job.characterId) !== String(client.context.characterId);
      return '<div class="sg-job" data-sg-job="' + esc(job.id) + '"><p><strong>' + (job.status === 'running' ? '背景召喚進行中' : AUTO_REASONS[job.reason] || '背景召喚已結束') + '</strong></p><p class="sg-id">原作業：' + esc(job.id) + '</p>' + (showSource ? '<p data-sg-auto-source>來源角色：' + esc(source?.name || job.characterId) + ' <span class="sg-id">' + esc(job.characterId) + '</span> · ' + (other ? '其他自有角色' : '目前選取角色') + '</p>' : '') + '<p>' + (job.pool === 'normal' ? '普通召喚' : '精選召喚') + ' · 每批 ' + fmt(job.count) + ' 抽 · 目標 ' + esc(job.targetType === 'any' ? '所有類型' : job.targetType === 'attack' ? '攻擊天使' : TYPE_NAMES[job.targetType] || job.targetType) + ' / ' + (job.targetRank ? esc(QUALITY_NAMES[job.targetRank - 1] || job.targetRank) + '以上' : '不限品質') + '</p><div class="sg-metrics"><span>已提交批次<strong>' + fmt(job.batches) + '</strong></span><span>已召喚<strong>' + fmt(job.totalDraws) + '</strong></span><span>已用金幣<strong>' + fmt(job.spentGold) + '</strong></span><span>已用憑證<strong>' + fmt(job.spentVouchers) + '</strong></span></div><p>已用免費普通抽次 ' + fmt(job.usedFree) + ' · 金幣上限 ' + (job.maxGold === null ? '不設上限' : fmt(job.maxGold) + (job.maxGold === 0 ? '（不使用金幣）' : '')) + '</p>' + (job.matchId ? '<p class="sg-id">命中原羽毛：' + esc(job.matchId) + '</p>' : '') + (Array.isArray(job.counts) ? '<div class="sg-counts">' + job.counts.map((n,i) => '<span>' + esc(QUALITY_NAMES[i]) + ' ' + fmt(n) + '</span>').join('') + '</div>' : '') + '<p class="sg-muted">更新於 ' + esc(when(job.updatedAt)) + ' · ' + (job.seen ? '已閱' : '尚未標記已閱') + '</p></div>';
    }
    function auto() {
      const job = client.autoJob(); let out = '';
      if (job) out += card('帳號背景召喚',jobSummary(job) + '<div class="sg-actions">' + (job.status === 'running' ? button('auto-stop','停止這個背景作業','',actionBlocked('auto-stop'),'sg-danger') : button('auto-seen','結果已閱','',actionBlocked('auto-seen') || job.seen === true)) + '</div>' + note('背景進度由原召喚服務處理。查看與重新整理不會推進抽次，也不會自動標記已閱。'));
      else out += card('帳號背景召喚',note('目前沒有執行中或尚未讀取的背景作業。'));
      const disabled = locked() || !!client.pending() || !!state.storageError || guardian().control.realmPhase !== 'ACTIVE' || job?.status === 'running';
      const select = (field,label,values) => '<label>' + esc(label) + '<select data-sg-field="' + field + '"' + (disabled ? ' disabled' : '') + '>' + values.map(([value,text]) => '<option value="' + esc(value) + '"' + (String(draft[field]) === String(value) ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
      const form = '<div class="sg-form">' + select('autoPool','召喚池',[['normal','普通召喚'],['featured','精選召喚']]) + select('autoCount','每批次數',[[1,'1 次'],[5,'5 次'],[10,'10 次']]) + select('autoTargetType','目標類型',[['any','不限類型'],['attack','攻擊天使'],...Object.entries(TYPE_NAMES)]) + select('autoTargetRank','目標品質',[[0,'不限品質'],...QUALITY_NAMES.slice(0,6).map((name,i) => [i + 1,name + '以上'])]) + select('autoBudgetMode','金幣預算',[['limited','設定金幣上限'],['unlimited','明確不設上限']]) + '<label>金幣上限（0＝不使用金幣）<input data-sg-field="autoBudget" inputmode="numeric" type="number" min="0" step="1" value="' + esc(draft.autoBudget) + '"' + (disabled || draft.autoBudgetMode === 'unlimited' ? ' disabled' : '') + '></label></div><p>來源角色：' + esc(host.getActor?.()?.name || host.actor?.name || client.context.characterId) + ' · <span class="sg-id">' + esc(client.context.characterId) + '</span>。每個帳號同時只能執行一個背景召喚。</p>' + note('類型或品質至少設定一個目標。金幣預算為 0 仍可使用免費普通抽次；留白不會被當成不設上限。') + button('auto-start','確認開始背景召喚','',disabled || actionBlocked('auto-start'),'sg-primary');
      return out + card('開始新背景召喚',form);
    }
    function history() {
      const entries = guardian().history.operations, receipts = guardian().history.receipts;
      let content = note('以下為目前角色已提交的原召喚與管理紀錄。歷史羽毛可能已裝備、融合或販售；仍顯示當時結果與原編號。') + (entries.length ? entries.map(operation => resultView({label:({summon:'召喚',fuse:'融合',activate:'永久守護',lock:'鎖定',unbind:'解綁',assist:'參戰'})[operation.action] || operation.action,id:operation.requestId,result:{operation},costs:operation.consumed})).join('') : note('目前沒有已提交的天使操作紀錄。'));
      if (state.historyReceipt) content += resultView(state.historyReceipt);
      if (receipts.length) content += '<h4>整合操作收據</h4>' + receipts.map(value => '<article class="sg-history-receipt"><p>' + esc(value.kind || '收據資料不完整') + ' · ' + esc(when(value.createdAt)) + '</p><p class="sg-id">' + esc(value.requestId || value.requestKey || '收據資料不完整') + '</p><p>原成本：' + esc(costText(value.costs)) + '</p>' + (/^scene:app:[A-Za-z0-9_-]{8,64}$/.test(value.requestKey || '') && !value.corrupt ? button('history-receipt','查看這筆原收據','data-request-key="' + esc(value.requestKey) + '"',locked() || state.loading) : '') + '</article>').join('');
      return card('原操作紀錄',content);
    }
    function focusIdentity(element) {
      if (!element || !root.contains?.(element)) return null;
      const d = element.dataset || {};
      if (!d.sgAction && !d.sgField) return null;
      return {data:Object.fromEntries(['sgAction','sgField','sgTab','itemId','pool','count','value','pendingId','requestKey'].filter(field => d[field] !== undefined).map(field => [field,d[field]])),start:element.selectionStart,end:element.selectionEnd};
    }
    function findFocus(identity) {
      if (!identity) return null;
      return [...root.querySelectorAll('button, input, select')].find(element => Object.entries(identity.data).every(([field,value]) => element.dataset?.[field] === value));
    }
    function restoreFocus(identity) {
      if (!sameScope() || doc?.hidden || root.isConnected === false) return;
      const element = findFocus(identity); if (!element || element.disabled) return;
      element.focus?.({preventScroll:true});
      if (typeof identity.start === 'number') { try { element.setSelectionRange?.(identity.start,identity.end); } catch {} }
    }
    function revealPendingOnce() {
      const record = client.pending();
      if (!record || state.storageError || record.revealed || locallyRevealed.has(record.id) || pendingFrame !== null || locked() || state.loading || state.checking || state.confirm) return;
      const originalFocus = doc?.activeElement, id = record.id;
      const run = () => {
        pendingFrame = null;
        if (!sameScope() || root.isConnected === false || doc?.hidden || locked() || state.loading || state.checking || state.confirm || client.pending()?.id !== id || state.storageError || client.pending()?.revealed || locallyRevealed.has(id) || doc?.activeElement !== originalFocus) return;
        const target = [...root.querySelectorAll('[data-sg-action="check-pending"]')].find(element => element.dataset.pendingId === id);
        if (!target || target.disabled) return;
        const panel = target.closest?.('[data-sg-pending]'); if (!panel) return;
        locallyRevealed.add(id); client.markRevealed(id); panel.scrollIntoView?.({block:'nearest',behavior:'auto'}); target.focus?.({preventScroll:true});
      };
      if (globalThis.requestAnimationFrame) pendingFrame = globalThis.requestAnimationFrame(run); else run();
    }
    function cancelReveal() { if (pendingFrame !== null) globalThis.cancelAnimationFrame?.(pendingFrame); pendingFrame = null; }
    function paint() {
      if (!sameScope() || painting) return;
      painting = true;
      try {
        const position = root.scrollTop, focus = returnFocus || focusIdentity(doc?.activeElement); returnFocus = null;
        const g = guardian(), actor = host.getActor?.() || host.actor || {};
        if (g && draft.selectionRevision !== state.revision) {
          if (draft.selectionRevision !== undefined) { draft.primaryId = ''; draft.primarySnapshot = null; draft.materialIds = []; draft.saleIds = []; }
          draft.selectionRevision = state.revision;
        }
        let html = '<div class="sg-window"><header class="sg-header"><div><p class="sg-eyebrow">GUARDIAN ANGELS</p><h2>守護天使</h2><p>目前角色：' + esc(actor.name || client.context.characterId) + ' · Lv.' + fmt(g?.state.level ?? actor.level) + ' · ' + esc(client.context.realmId) + '</p></div>' + button('refresh',state.loading ? '更新中…' : '重新整理','',locked()) + '</header><nav class="sg-tabs" aria-label="守護天使頁籤">' + TABS.map(([tab,label]) => button('tab',label,'data-sg-tab="' + tab + '" aria-selected="' + String(tab === draft.tab) + '"',locked(),tab === draft.tab ? 'is-active' : '')).join('') + '</nav>' + notices();
        if (g) html += ({overview,summon,inventory,fusion,auto,history})[draft.tab]();
        else html += note(state.loading ? '正在讀取目前角色的天使資料…' : '尚未取得完整天使資料。');
        html += '</div>'; root.innerHTML = html; root.scrollTop = position;
        if (state.confirm && focusedConfirm !== state.confirm) { focusedConfirm = state.confirm; const cancel = root.querySelector('[data-sg-action="cancel"]'); if (sameScope() && !doc?.hidden) cancel?.focus?.({preventScroll:true}); root.querySelector('[data-sg-confirm]')?.scrollIntoView?.({block:'nearest',behavior:'auto'}); }
        else { if (!state.confirm) focusedConfirm = null; restoreFocus(focus); }
        revealPendingOnce();
      } finally { painting = false; }
    }
    async function click(event) {
      const target = event.target.closest?.('[data-sg-action]'); if (!target || !root.contains?.(target) || target.disabled || !sameScope()) return;
      const {sgAction:action,itemId:id} = target.dataset;
      const record = client.pending(); if (record && action !== 'check-pending') { locallyRevealed.add(record.id); client.markRevealed(record.id); } cancelReveal();
      if (action === 'cancel') { returnFocus = confirmationOrigin; client.cancel(); return; }
      if (action === 'confirm') {
        if(ritual)return;
        if(state.confirm?.kind==='summon'&&!state.confirm.recovery&&globalThis.RpgSceneRituals){
          ritual=globalThis.RpgSceneRituals.summon(root,{config:guardian().config,current:sameScope,commit:async()=>{const ok=await client.submit();return ok?state.lastResult?.result?.operation:null;}});
          ritual.done.then(()=>{ritual=null;if(sameScope())paint();});return;
        }
        await client.submit(); return;
      }
      if (action === 'check-pending') { await client.checkPending(target.dataset.pendingId); return; }
      if (action === 'history-receipt') { await client.readHistoryReceipt(target.dataset.requestKey); return; }
      if (action === 'acknowledge') { client.acknowledge(target.dataset.pendingId); return; }
      if (action === 'retry') { confirmationOrigin = focusIdentity(target); client.prepareRecovery(target.dataset.pendingId); return; }
      if (action === 'refresh') { await client.refresh(); return; }
      if (locked()) return;
      if (action === 'tab' || action === 'inventory-tab') { client.cancel(); draft.tab = action === 'tab' ? target.dataset.sgTab : 'inventory'; paint(); return; }
      if (action === 'inventory-first' || action === 'inventory-next') { client.cancel(); await client.refresh({quality:draft.quality,cursor:action === 'inventory-next' ? target.dataset.cursor : null}); return; }
      if (action === 'sale-mode') { client.cancel(); draft.saleMode = !draft.saleMode; draft.saleIds = []; paint(); return; }
      if (action === 'sale-clear') { draft.saleIds = []; client.cancel(); paint(); return; }
      if (action === 'sale-select') { draft.saleIds = draft.saleIds.includes(id) ? draft.saleIds.filter(value => value !== id) : [...draft.saleIds,id]; client.cancel(); paint(); return; }
      if (action === 'fusion-primary') { const selected = guardian()?.state.inventory.items.find(value => value.id === id); if (!selected) return; draft.primaryId = id; draft.primarySnapshot = clone(selected); draft.materialIds = [id]; draft.tab = 'fusion'; client.cancel(); paint(); return; }
      if (action === 'fusion-material') { draft.materialIds = draft.materialIds.includes(id) ? draft.materialIds.filter(value => value !== id) : [...draft.materialIds,id]; client.cancel(); paint(); return; }
      if (action === 'fusion-clear') { draft.primaryId = ''; draft.primarySnapshot = null; draft.materialIds = []; client.cancel(); paint(); return; }
      confirmationOrigin = focusIdentity(target);
      if (action === 'welcome') client.prepareWelcome();
      else if (action === 'summon') client.prepareSummon(target.dataset.pool,Number(target.dataset.count));
      else if (action === 'activate') client.prepareActivate(id === 'none' ? null : id);
      else if (action === 'lock') client.prepareLock(id,target.dataset.value === 'true');
      else if (action === 'unbind') client.prepareUnbind(id);
      else if (action === 'fuse') client.prepareFuse(draft.primaryId,draft.materialIds);
      else if (action === 'sale') client.prepareSale(draft.saleIds);
      else if (action === 'assist-start') client.prepareAssist('start',{itemId:id});
      else if (action === 'assist-select') client.prepareAssist('select',{itemId:id});
      else if (action === 'assist-stop') client.prepareAssist('stop');
      else if (action === 'continuation') client.prepareAssist('continuation',{autoRenew:target.dataset.value === 'true'});
      else if (action === 'supply') client.prepareAssist('supply',{autoBuy:target.dataset.value === 'true'});
      else if (action === 'buy-stones') client.prepareAssist('buy',{quantity:Number(draft.stoneQuantity)});
      else if (action === 'auto-stop') client.prepareAutoStop();
      else if (action === 'auto-seen') client.prepareAutoSeen();
      else if (action === 'auto-start') {
        if (draft.autoBudgetMode !== 'unlimited' && !/^\d+$/.test(draft.autoBudget)) { client.feedback('請填寫整數金幣上限；0 表示不使用金幣，留白不代表不設上限。',true); return; }
        client.prepareAutoStart({pool:draft.autoPool,count:Number(draft.autoCount),targetType:draft.autoTargetType,targetRank:Number(draft.autoTargetRank),maxGold:draft.autoBudgetMode === 'unlimited' ? null : Number(draft.autoBudget)});
      }
    }
    async function change(event) {
      const target = event.target, field = target.dataset?.sgField; if (!field || !sameScope() || locked()) return;
      const record = client.pending(); if (record) { locallyRevealed.add(record.id); client.markRevealed(record.id); } cancelReveal();
      if (!['quality','stoneQuantity','autoPool','autoCount','autoTargetType','autoTargetRank','autoBudgetMode','autoBudget'].includes(field)) return;
      draft[field] = target.value; client.cancel();
      if (field === 'quality') { draft.saleIds = []; await client.refresh({quality:draft.quality,cursor:null}); }
      else paint();
    }
    function input(event) {
      const target = event.target; if (target.dataset?.sgField !== 'autoBudget' || !sameScope() || locked()) return;
      draft.autoBudget = target.value; if (state.confirm) client.cancel();
    }
    const visibility = () => { if (sameScope() && !doc?.hidden && !locked() && !state.loading && !state.checking && !state.confirm) void client.refresh(); };
    root.addEventListener('click',click); root.addEventListener('change',change); root.addEventListener('input',input); doc?.addEventListener?.('visibilitychange',visibility);
    paint(); void client.refresh({quality:draft.quality,cursor:null});
    const timer = globalThis.setInterval?.(() => { if (sameScope() && !doc?.hidden && !locked() && !state.loading && !state.checking && !state.confirm) void client.refresh(); },15000);
    return {refresh:() => client.refresh(),update:client.update,
      handleBack() { if(ritual){ritual.close();return true;} if (!sameScope() || !state.confirm || state.busy) return false; returnFocus = confirmationOrigin; client.cancel(); return true; },
      dispose() { ritual?.close(true); if (disposed) return; disposed = true; cancelReveal(); globalThis.clearInterval?.(timer); client.dispose(); root.removeEventListener('click',click); root.removeEventListener('change',change); root.removeEventListener('input',input); doc?.removeEventListener?.('visibilitychange',visibility); }};
  }
  globalThis.RpgSceneGuardian = {createClient,mount,canonical,signature};
})();
