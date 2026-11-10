/* Private Fate controls: birth inputs remain in memory; durable pending contains public intent only. */
import {PLACES} from './fate/places.js';

const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value,key) => Object.prototype.hasOwnProperty.call(value || {},key);
const exact = (value,keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => own(value,key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const stable = value => Array.isArray(value) ? value.map(stable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
const same = (a,b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const textId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
const requestId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
const nonceValid = value => typeof value === 'string' && /^[a-f0-9]{32,64}$/.test(value);
const dayValid = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year,month,day] = value.split('-').map(Number), date = new Date(Date.UTC(year,month-1,day));
  return year >= 1900 && year <= 9999 && date.getUTCFullYear() === year && date.getUTCMonth() === month-1 && date.getUTCDate() === day;
};
const scopeKey = (context,epoch = false) => JSON.stringify((epoch ? ['accountId','realmId','characterId','epoch'] : ['accountId','realmId','characterId']).map(key => String(context?.[key] ?? '')));
const scopeOf = context => Object.fromEntries(['accountId','realmId','characterId'].map(key => [key,String(context?.[key] ?? '')]));
const KINDS = ['profile-save','profile-delete','birthday-start','daily-sync'];
const COUNTRIES = ['TW','JP','KR','US','CA','GB','DE','FR','AU','IN'];
const COVERAGES = ['inspiration','three-traditions'];
const LABELS = {'profile-save':'保存出生檔案','profile-delete':'刪除出生檔案與旅箋','birthday-start':'用生日展開一世','daily-sync':'同步今日旅箋'};
const clients = new Set();
const SIGNAL = 'fate-private-invalidated';
const PENDING_PREFIX = 'rpg-sfp-pending:';
function expectedValid(value) {
  if (!exact(value,['generation','profile','daily']) || !integer(value.generation)) return false;
  const p = value.profile, d = value.daily;
  return exact(p,['saved','rev','updatedAt']) && typeof p.saved === 'boolean' && integer(p.rev) && (p.saved ? p.rev >= 1 && integer(p.updatedAt) : p.rev === 0 && p.updatedAt === null)
    && exact(d,['day','materialized','rev','createdAt']) && dayValid(d.day) && typeof d.materialized === 'boolean' && integer(d.rev) && (d.materialized ? integer(d.createdAt) : d.rev === 0 && d.createdAt === null);
}
export function canonicalPublic(value) {
  if (!plain(value) || !KINDS.includes(value.kind) || !nonceValid(value.intentNonce) || !expectedValid(value.expected)) return null;
  const base = ['kind','intentNonce','expected'], fields = value.kind === 'profile-save' ? ['consent'] : value.kind === 'birthday-start' ? ['source','country','showSign','socialInvite','day'] : value.kind === 'daily-sync' ? ['day'] : [];
  if (!exact(value,[...base,...fields])) return null;
  if (value.kind === 'profile-save' && value.consent !== true) return null;
  if (value.kind === 'birthday-start' && (!['temporary','saved'].includes(value.source) || !COUNTRIES.includes(value.country) || typeof value.showSign !== 'boolean' || value.socialInvite !== false || value.day !== value.expected.daily.day)) return null;
  if (value.kind === 'daily-sync' && value.day !== value.expected.daily.day) return null;
  return stable(clone(value));
}
export function signature(value) { const clean = canonicalPublic(value); return clean ? JSON.stringify(clean) : null; }
function privateBody(kind,value,intent) {
  if (!plain(value)) return null;
  if (kind === 'profile-save') {
    if (!exact(value,['birth']) || !plain(value.birth) || !dayValid(value.birth.date)) return null;
    const b = value.birth, allowed = ['date','time','placeId','lat','lon','zone','placeLabel','sex','fold'];
    if (Object.keys(b).some(key => !allowed.includes(key))) return null;
    if (own(b,'time') && b.time !== null && (typeof b.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time))) return null;
    if (own(b,'placeId') && b.placeId !== null && b.placeId !== 'custom' && !PLACES.some(place => place[0] === b.placeId)) return null;
    if (own(b,'sex') && b.sex !== null && !['m','f'].includes(b.sex)) return null;
    if (own(b,'fold') && !['earlier','later'].includes(b.fold)) return null;
    if (b.placeId === 'custom') {
      if (![b.lat,b.lon].every(n => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n))) || Math.abs(Number(b.lat)) > 65 || Math.abs(Number(b.lon)) > 180 || typeof b.zone !== 'string' || !b.zone.trim() || b.zone.length > 80) return null;
      if (own(b,'placeLabel') && (typeof b.placeLabel !== 'string' || b.placeLabel.length > 60)) return null;
    } else if (['lat','lon','zone','placeLabel'].some(key => own(b,key))) return null;
    return clone(value);
  }
  if (kind === 'birthday-start' && intent.source === 'temporary') return exact(value,['birthDate']) && dayValid(value.birthDate) ? clone(value) : null;
  return exact(value,[]) ? {} : null;
}
function needsMemory(record) { return record.kind === 'profile-save' || record.kind === 'birthday-start' && record.intent.source === 'temporary'; }
export function validRecord(record,identity) {
  if (!exact(record,['version','scope','context','id','kind','intent','signature','at','cancelRequested','revealed']) || record.version !== 1 || record.scope !== identity || !requestId(record.id) || !integer(record.at) || typeof record.cancelRequested !== 'boolean' || typeof record.revealed !== 'boolean') return false;
  const intent = canonicalPublic(record.intent);
  if (!intent || record.kind !== intent.kind || record.signature !== signature(intent)) return false;
  let values; try { values = JSON.parse(identity); } catch { return false; }
  return Array.isArray(values) && values.length === 3 && same(record.context,{accountId:values[0],realmId:values[1],characterId:values[2]});
}
function sameRecord(a,b) { return !!a && !!b && same(a,b); }
export function resultMatches(record,result,outcome) {
  if (outcome === 'cancelled') return exact(result,['cancelled']) && result.cancelled === true;
  if (outcome !== 'committed' || !plain(result)) return false;
  if (record.kind === 'profile-save') return exact(result,['saved','coverage']) && result.saved === true && COVERAGES.includes(result.coverage);
  if (record.kind === 'profile-delete') return exact(result,['deleted']) && result.deleted === true;
  if (record.kind === 'birthday-start') return exact(result,['lifeId',...(own(result,'already') ? ['already'] : [])]) && textId(result.lifeId) && (!own(result,'already') || result.already === true);
  return exact(result,['day','materialized','created','unlocked','added','revision']) && result.day === record.intent.day && result.materialized === true && typeof result.created === 'boolean' && integer(result.unlocked) && result.unlocked <= 3 && integer(result.added) && result.added <= result.unlocked && integer(result.revision);
}
export function receiptMatches(record,value,context) {
  const r = value?.receipt;
  if (!exact(r,['version','kind','requestId','requestKey','intentNonce','signature','scope','createdAt','outcome','result','costs','authority']) || r.version !== 1 || r.kind !== record.kind || r.requestId !== record.id || r.requestKey !== 'private:app:' + record.id || r.intentNonce !== record.intent.intentNonce || r.signature !== record.signature || !same(r.scope,scopeOf(context)) || !integer(r.createdAt) || r.createdAt > value.now || r.outcome !== value.outcome || !resultMatches(record,r.result,r.outcome) || !same(r.result,value.result)) return false;
  const costs = r.outcome === 'committed' && record.kind === 'birthday-start' ? {dailyStarts:r.result.already === true ? 0 : 1} : {};
  return same(r.costs,costs) && exact(r.authority,['family','requestKey','proofId']) && r.authority.family === 'life-operations' && r.authority.requestKey === r.requestKey && typeof r.authority.proofId === 'string' && /^[a-f0-9]{32}$/.test(r.authority.proofId);
}
function storageFor(host) { if (host.storage) return host.storage; try { return globalThis.sessionStorage; } catch { return null; } }
export function storedPendingBlock(host) {
  try { const storage = storageFor(host); if (!storage) return '無法讀取待核對紀錄，請恢復瀏覽器儲存後再操作。'; return storage.getItem(PENDING_PREFIX + scopeKey(host.getContext?.())) === null ? '' : '出生與旅箋有一筆操作待核對，請先開啟該區段。'; }
  catch { return '無法讀取待核對紀錄，請恢復瀏覽器儲存後再操作。'; }
}
const safeError = error => ({
  birth_consent:'請先勾選同意保存出生資料。', birth_date:'請填寫有效的出生日期。', birth_time:'出生時間請使用 00:00–23:59。',
  birth_place:'請核對出生地名稱、時區與經緯度。',birth_zone:'請填寫有效的 IANA 時區。',birth_gap:'這個出生時間位於夏令時間跳時空檔，請核對當地鐘錶時間。',birth_future:'出生日期或時間不能晚於所選地點的現在。',
  character_changed:'目前角色已切換，請重新開啟出生與旅箋。',context_changed:'目前角色或世界已切換，請重新開啟。',
  fate_night:'星穹已入夜，06:00 再開啟下一世。',fate_limit:'今天已展開四世，明天再開啟新的旅程。',
  conflict:'資料剛有更新，請重新整理並確認。',request_changed:'這個原操作編號的內容不一致，請保留紀錄並重新核對。',
  fate_private_changed:'出生檔案或旅箋剛有更新，請重新整理並確認。',fate_private_day:'台北日期已更新，請核對原操作後重新整理。',
  realm_frozen:'目前世界只能查看資料。'
}[error?.code] || '暫時無法完成核對，請稍後重新整理。');
function newId() {
  if (globalThis.crypto?.randomUUID) return 'sfp_' + globalThis.crypto.randomUUID().replaceAll('-','');
  if (globalThis.crypto?.getRandomValues) return 'sfp_' + [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2,'0')).join('');
  throw Error('identity');
}
function newNonce() { return newId().slice(4); }
export function createClient(host) {
  const context = {...host.getContext?.()}, identity = scopeKey(context), capturedEpoch = scopeKey(context,true), storage = storageFor(host), storageKey = PENDING_PREFIX + identity, now = host.now || Date.now;
  const state = {data:null,profile:null,loading:false,profileLoading:false,busy:false,checking:false,stale:true,error:'',notice:'',storageError:'',confirm:null,receipt:null,historyReceipt:null,lastResult:null,revision:-1,minRevision:-1,minObservedAt:0,minGeneration:0,readSequence:0,receivedAt:0};
  let disposed = false, sequence = 0, generation = 0, receiptSequence = 0, controller = null, receiptController = null, knownRecord = null, memory = null, preparedPrivate = null, channel = null, observedDomain = null;
  const inScope = () => !disposed && scopeKey(host.getContext?.(),true) === capturedEpoch && host.current?.() !== false;
  const clearValues = () => { memory = null; preparedPrivate = null; state.profile = null; state.data = null; state.confirm = null; state.stale = true; try { host.onPrivateCleared?.(); } catch {} };
  const current = () => { if (inScope()) return true; clearValues(); return false; };
  const notify = () => { if (inScope()) host.onState?.({loading:state.loading,profileLoading:state.profileLoading,busy:state.busy,checking:state.checking,stale:state.stale,revision:state.revision,readSequence:state.readSequence,hasProfileView:!!state.profile}); };
  function invalidate(reason = 'changed') {
    generation++; sequence++; controller?.abort(); receiptController?.abort(); clearValues(); state.loading = false; state.profileLoading = false; state.checking = false;
    state.notice = reason === 'changed' ? '出生檔案或旅箋已在另一處更新，本頁的私人輸入已清除；請重新整理。' : '本頁的私人資料已清除。'; notify();
  }
  const signalMatches = value => exact(value,['type','version','accountId','realmId']) && value.type === SIGNAL && value.version === 1 && value.accountId === String(context.accountId) && value.realmId === String(context.realmId);
  const entry = {context,onSignal:value => { if (inScope() && signalMatches(value)) invalidate(); }};
  clients.add(entry);
  try {
    const factory = host.createChannel || (globalThis.window && globalThis.BroadcastChannel ? name => new BroadcastChannel(name) : null);
    if (factory) { channel = factory('rpg-fate-private-invalidation'); channel.onmessage = event => entry.onSignal(event.data); }
  } catch {}
  function broadcast() {
    const message = {type:SIGNAL,version:1,accountId:String(context.accountId),realmId:String(context.realmId)};
    for (const other of clients) if (other !== entry) other.onSignal(message);
    try { channel?.postMessage(message); } catch {}
  }
  function pending() {
    try {
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw Error('storage');
      const raw = storage.getItem(storageKey);
      if (raw === null) { knownRecord = null; state.storageError = ''; return null; }
      const record = JSON.parse(raw);
      if (!validRecord(record,identity)) { state.storageError = '保存的待核對紀錄不完整，請保留資料；目前暫停新操作。'; return knownRecord; }
      knownRecord = record; state.storageError = ''; return record;
    } catch { state.storageError = '無法讀取待核對操作，請恢復瀏覽器儲存後再操作。'; return knownRecord; }
  }
  function verifiedPending(expected) { const record = pending(); if (state.storageError) return null; if (!sameRecord(record,expected)) { state.storageError = '原操作紀錄已變更，請保留目前資料並重新核對。'; return null; } return record; }
  function savePending(record,expected = null) {
    const old = pending(); if (state.storageError || !validRecord(record,identity)) return false;
    if (expected ? !sameRecord(old,expected) : old !== null) { state.storageError = '原操作紀錄已變更，尚未覆寫或送出。'; return false; }
    try { const raw = JSON.stringify(record); storage.setItem(storageKey,raw); if (storage.getItem(storageKey) !== raw) throw Error('readback'); knownRecord = record; state.storageError = ''; return true; }
    catch { state.storageError = '無法完整保存原操作編號，尚未送出這次操作。'; return false; }
  }
  function clearPending(record) {
    if (!current() || !verifiedPending(record)) return false;
    try { storage.removeItem(storageKey); if (storage.getItem(storageKey) !== null) throw Error('remove'); knownRecord = null; state.storageError = ''; state.receipt = null; memory = null; return true; }
    catch { state.storageError = '原結果已核對，但本機紀錄尚未清除；請再次核對同一筆收據。'; return false; }
  }
  function markRevealed(id) { const record = pending(); return current() && record?.id === id && !state.storageError ? record.revealed || savePending({...record,revealed:true},record) : false; }
  function feedback(message,error = false) { if (!current()) return; state[error ? 'error' : 'notice'] = message; notify(); }
  function verifyCommon(value,fresh = true) {
    if (!value || value.ok !== true || !same(scopeOf(value),scopeOf(context)) || !integer(value.revision) || !positive(value.now) || fresh && (value.revision < Math.max(state.revision,state.minRevision) || value.now < state.minObservedAt)) throw Error('envelope');
  }
  function domainValid(domain) {
    if (!exact(domain,['version','generation','profile','daily','token']) || domain.version !== 1 || typeof domain.token !== 'string' || !domain.token || domain.token.length > 256 || !expectedValid({generation:domain.generation,profile:domain.profile,daily:domain.daily}) || domain.generation < state.minGeneration) return false;
    if (observedDomain && domain.generation === observedDomain.generation) {
      if (!same(domain.profile,observedDomain.profile)) return false;
      const before = observedDomain.daily, next = domain.daily;
      if (next.day < before.day) return false;
      if (next.day === before.day && before.materialized && (!next.materialized || next.createdAt !== before.createdAt || next.rev < before.rev)) return false;
    }
    return true;
  }
  function verifyRead(value,ticket,profile = false) {
    verifyCommon(value); const part = profile ? value.privateProfile : value.privateFate;
    if (value.readSequence !== ticket || !plain(part) || !domainValid(part.domain) || part.domain.daily.day !== new Date(value.now + 8*3600000).toISOString().slice(0,10) || !plain(part.control) || typeof part.control.writable !== 'boolean' || typeof part.control.realmPhase !== 'string') throw Error('private snapshot');
    if (profile) {
      const p = part.profile;
      if (!plain(p) || typeof p.saved !== 'boolean' || p.saved !== part.domain.profile.saved || p.rev !== part.domain.profile.rev || !COVERAGES.includes(p.coverage) || p.saved && (!plain(p.birth) || !dayValid(p.birth.date))) throw Error('private profile');
      if (!p.saved && own(p,'birth')) throw Error('absent profile');
      return part;
    }
    const p = part.profile, d = part.daily;
    if (part.day !== part.domain.daily.day || !plain(p) || !same({saved:p.saved,rev:p.rev,updatedAt:p.updatedAt},part.domain.profile) || !COVERAGES.includes(p.coverage) || own(p,'birth') || own(p,'chart') || !plain(d) || !same({day:d.day,materialized:d.materialized,rev:d.rev,createdAt:d.createdAt},part.domain.daily) || !integer(d.profileRevision) || !integer(d.unlocked) || d.unlocked > 3 || !Array.isArray(d.unlocks) || d.unlocks.length !== d.unlocked || !Array.isArray(d.notes) || !plain(part.evidence) || !Array.isArray(part.evidence.available) || !Array.isArray(part.evidence.pending)) throw Error('private scene');
    if (d.materialized ? d.notes.length !== 3 : d.notes.length || d.unlocked !== 0) throw Error('daily shape');
    const topics = ['health','work','love'];
    for (let i = 0; i < d.notes.length; i++) {
      const n = d.notes[i]; if (!plain(n) || n.topic !== topics[i] || typeof n.locked !== 'boolean' || n.locked !== (i >= d.unlocked) || n.locked && !exact(n,['topic','locked'])) throw Error('private note');
    }
    if (part.history && (!plain(part.history) || !Array.isArray(part.history.receipts))) throw Error('private history');
    return part;
  }
  function expected() { const domain = state.data?.privateFate?.domain; return domain ? clone({generation:domain.generation,profile:domain.profile,daily:domain.daily}) : null; }
  const fingerprint = () => JSON.stringify(stable({revision:state.revision,domain:state.data?.privateFate?.domain,control:state.data?.privateFate?.control,readOnly:state.data?.readOnly}));
  function applyFloor(value,domain) { if (domain) state.revision = Math.max(state.revision,value.revision); state.minRevision = Math.max(state.minRevision,value.revision); state.minObservedAt = Math.max(state.minObservedAt,value.now); if (domain) { state.minGeneration = Math.max(state.minGeneration,domain.generation); observedDomain = clone(domain); } }
  async function refresh() {
    if (!current() || state.busy || state.checking || state.profileLoading) return false;
    const ticket = ++sequence, guard = ++generation, before = fingerprint(); controller?.abort(); controller = new AbortController(); state.loading = true; state.error = ''; notify();
    try {
      const value = await host.request('fate/private/scene',{readSequence:ticket},{signal:controller.signal});
      if (!current() || guard !== generation || ticket !== sequence) return false;
      const part = verifyRead(value,ticket), oldGeneration = state.data?.privateFate?.domain?.generation;
      if (oldGeneration !== undefined && oldGeneration !== part.domain.generation) { preparedPrivate = null; memory = null; state.profile = null; state.confirm = null; try { host.onPrivateCleared?.(); } catch {} }
      applyFloor(value,part.domain); state.data = clone(value); state.readSequence = ticket; state.receivedAt = now(); state.stale = false;
      if (state.confirm && before !== fingerprint()) { preparedPrivate = null; state.confirm = null; state.notice = '出生檔案、旅箋或角色狀態已更新，請重新確認。'; }
      pending(); return true;
    } catch (error) {
      if (!current() || guard !== generation) return false;
      state.stale = true; state.confirm = null; preparedPrivate = null; state.error = safeError(error);
      if (['character_changed','context_changed','forbidden','unauthorized'].includes(error?.code)) clearValues();
      return false;
    } finally { if (inScope() && guard === generation) { state.loading = false; notify(); } }
  }
  async function viewProfile() {
    if (!current() || state.busy || state.checking) return false;
    const ticket = ++sequence, guard = ++generation; controller?.abort(); controller = new AbortController(); state.profileLoading = true; state.loading = false; state.error = ''; state.profile = null; notify();
    try {
      const value = await host.request('fate/private/profile',{readSequence:ticket},{signal:controller.signal});
      if (!current() || guard !== generation || ticket !== sequence) return false;
      const part = verifyRead(value,ticket,true), prior = state.data?.privateFate?.domain;
      if (prior && (!same(part.domain,prior) || !same(part.control,state.data.privateFate.control) || value.revision > state.data.revision)) { preparedPrivate = null; memory = null; state.confirm = null; state.data = null; state.stale = true; try { host.onPrivateCleared?.(); } catch {} }
      applyFloor(value,part.domain); state.profile = clone(part.profile); state.readSequence = ticket; return true;
    } catch (error) { if (!current() || guard !== generation) return false; state.profile = null; state.error = safeError(error); return false; }
    finally { if (inScope() && guard === generation) { state.profileLoading = false; notify(); } }
  }
  function readiness({recover = false} = {}) {
    if (!current()) return '角色或世界已切換。';
    if (state.busy || state.loading || state.profileLoading || state.checking) return '正在核對出生檔案與旅箋。';
    if (!state.data || state.stale || state.revision < state.minRevision) return '請先重新整理出生與旅箋。';
    const record = pending(); if (state.storageError) return state.storageError;
    if (!recover && record) return '請先核對上次操作的原結果。';
    if (!recover) { const external = host.mutationBlock?.(); if (external) return external; }
    const p = state.data.privateFate;
    if (state.data.readOnly === true || p.control.writable !== true || p.control.realmPhase !== 'ACTIVE') return '這個世界目前只能查看資料。';
    return '';
  }
  function prepare(kind,publicFields,privateFields,label,details) {
    const blocked = readiness(), exp = expected(), candidate = {kind,intentNonce:'0'.repeat(32),expected:exp,...publicFields}, clean = canonicalPublic(candidate), secret = clean && privateBody(kind,privateFields,clean);
    if (blocked || !clean || secret === null) { feedback(blocked || '請核對表單內容；尚未送出或保存。',true); return false; }
    preparedPrivate = secret; state.error = ''; state.notice = ''; state.confirm = {kind,publicFields:clone(publicFields),expected:exp,label,details,fingerprint:fingerprint(),mode:'action'}; notify(); return true;
  }
  function prepareSave(birth,consent) {
    if (consent !== true) { feedback('請先勾選同意保存；未勾選時，可只用這次生日啟程。',true); return false; }
    return prepare('profile-save',{consent:true},{birth},'保存這份出生檔案','只有明確同意後才保存到目前世界的帳號。已建立的今日旅箋維持原內容，新資料自下一天套用。');
  }
  function prepareDelete() { return prepare('profile-delete',{}, {},'刪除出生檔案與旅箋','將刪除目前世界這個帳號保存的出生資料與全部旅箋。已完成的旅章與星輝匣保持原紀錄。'); }
  function prepareBirthday(source,country,showSign,birthDate) {
    if (!['temporary','saved'].includes(source)) { feedback('請選擇這次填寫或已保存的生日。',true); return false; }
    if (source === 'saved' && state.data?.privateFate?.profile.saved !== true) { feedback('目前沒有已保存的出生檔案。',true); return false; }
    const f = host.getFateState?.();
    if (f && (f.control?.writable !== true || f.control.startAllowed !== true)) { feedback(f.control?.startBlock ? '目前尚無法開啟下一世，請查看命運旅章。' : '請先更新命運旅章。',true); return false; }
    return prepare('birthday-start',{source,country,showSign,socialInvite:false,day:expected()?.daily.day},source === 'temporary' ? {birthDate} : {},'用生日展開新的一世',(source === 'temporary' ? '只使用這次填寫的生日，不保存出生檔案。' : '使用目前已確認版本的出生檔案。') + ' 將使用本帳號今日一次啟程額度；一世 2 小時，00:00–06:00 暫停成長。不消耗金幣。');
  }
  function prepareDaily() { return prepare('daily-sync',{day:expected()?.daily.day},{},state.data?.privateFate?.daily.materialized ? '同步今日同行任務' : '建立今日旅箋','按原有規則保存這一天的三則旅箋，並核對已完成的同行任務。這個操作沒有金幣或道具獎勵。'); }
  function cancel() { if (!current() || state.busy) return; preparedPrivate = null; state.confirm = null; notify(); }
  const wire = record => ({realmId:String(context.realmId),selectedCharacterId:String(context.characterId),requestId:record.id,...clone(record.intent)});
  function memoryFor(record) { return !needsMemory(record) ? {} : memory?.id === record.id && memory.signature === record.signature ? clone(memory.body) : null; }
  function immutableMatches(record,value) {
    try { verifyCommon(value,false); } catch { return false; }
    return value.kind === record.kind && value.requestId === record.id && value.intentNonce === record.intent.intentNonce && value.signature === record.signature && resultMatches(record,value.result,value.outcome) && receiptMatches(record,value,context);
  }
  function networkMatches(record,value) { try { verifyCommon(value); } catch { return false; } return immutableMatches(record,value); }
  const publicReply = value => ({ok:true,now:value.now,...scopeOf(value),revision:value.revision,kind:value.kind,requestId:value.requestId,intentNonce:value.intentNonce,signature:value.signature,outcome:value.outcome,result:clone(value.result),receipt:clone(value.receipt),found:true});
  function changed(record,value,details = {}) {
    preparedPrivate = null; memory = null; state.profile = null; state.data = null; state.stale = true; try { host.onPrivateCleared?.(); } catch {}
    if (value.outcome === 'committed') broadcast();
    try { host.onChanged?.(publicReply(value),{kind:record.kind,intent:clone(record.intent),...details}); } catch {}
  }
  async function send(record,mode) {
    if (!current() || !verifiedPending(record)) return false;
    const secret = mode === 'cancel' ? {} : memoryFor(record);
    if (secret === null) { feedback('私人輸入已清除，無法重送原內容；請查詢或結束這筆原請求。',true); return false; }
    state.confirm = null; preparedPrivate = null; state.busy = true; state.error = ''; state.notice = ''; state.receipt = null; generation++; sequence++; receiptSequence++; controller?.abort(); receiptController?.abort(); notify();
    let accepted = false;
    try {
      const value = await host.request(mode === 'cancel' ? 'fate/private/cancel' : 'fate/private/action-scoped',{...wire(record),...secret});
      if (!current() || !sameRecord(pending(),record)) return false;
      if (!networkMatches(record,value)) throw Error('receipt');
      applyFloor(value); state.lastResult = {id:record.id,kind:record.kind,outcome:value.outcome,result:clone(value.result),costs:clone(value.receipt.costs)};
      const cleared = clearPending(record); if (!cleared) state.receipt = publicReply(value);
      state.notice = value.outcome === 'cancelled' ? '原請求已結束，這個編號不會再執行操作；已產生的背景旅章進度仍保留。' : '這筆原操作已完成，可以核對原始結果。';
      changed(record,value,{cancelled:mode === 'cancel'}); accepted = true;
    } catch (error) {
      if (!current()) return false;
      state.stale = true; state.error = '操作結果待核對。' + safeError(error) + ' 重新整理不會重送；請查詢原操作收據。';
    } finally { if (inScope()) { state.busy = false; notify(); if (accepted) await refresh(); } }
    return accepted;
  }
  function recoveryReason(id) {
    const record = pending(); if (!record || record.id !== id) return '找不到這筆原操作。';
    const blocked = readiness({recover:true}); if (blocked) return blocked;
    if (record.cancelRequested) return '已要求結束這筆請求，請繼續查詢或確認結束。';
    const r = state.receipt;
    if (!r || r.found !== false || r.recoveryAllowed !== true || r.signature !== record.signature || r.requestId !== record.id) return '請先查詢這筆原操作的收據。';
    return memoryFor(record) === null ? '私人輸入已清除，無法重送原內容；可結束這筆請求後重新填寫。' : '';
  }
  function cancellationReason(id) {
    const record = pending(); if (!record || record.id !== id) return '找不到這筆原操作。';
    const blocked = readiness({recover:true}); if (blocked) return blocked;
    const r = state.receipt; return r?.found === false && r.cancellationAllowed === true && r.signature === record.signature && r.requestId === record.id ? '' : '請先查詢完整的原操作收據。';
  }
  function prepareRecovery(id) {
    const blocked = recoveryReason(id); if (blocked) { feedback(blocked,true); return false; }
    const record = clone(pending()); state.confirm = {kind:record.kind,label:'以原內容再送同一筆',details:'尚未找到完整收據，請求可能仍在處理。確認後只重送同一編號與原內容；已完成時取回原結果。',record,mode:'recovery',fingerprint:fingerprint()}; notify(); return true;
  }
  function prepareCancel(id) {
    const blocked = cancellationReason(id); if (blocked) { feedback(blocked,true); return false; }
    const record = clone(pending()); state.confirm = {kind:record.kind,label:'結束這筆未決請求',details:'先核對原編號；若已完成，就顯示既有結果。若尚未完成，封存此編號，阻止同筆稍後執行。已產生的背景旅章進度仍會保留。',record,mode:'cancel',fingerprint:fingerprint()}; notify(); return true;
  }
  async function submit() {
    if (!current() || !state.confirm) return false;
    const plan = state.confirm;
    if (plan.fingerprint !== fingerprint()) { cancel(); feedback('資料已更新，請重新確認。',true); return false; }
    if (plan.mode !== 'action') {
      const blocked = plan.mode === 'cancel' ? cancellationReason(plan.record.id) : recoveryReason(plan.record.id), old = pending();
      if (blocked || !sameRecord(old,plan.record)) { cancel(); feedback(blocked || '原操作紀錄已變更，請重新核對。',true); return false; }
      if (plan.mode === 'cancel') {
        const record = {...old,cancelRequested:true}; if (!savePending(record,old)) { feedback(state.storageError,true); return false; }
        memory = null; return send(record,'cancel');
      }
      return send(clone(old),'action');
    }
    const blocked = readiness(); if (blocked) { cancel(); feedback(blocked,true); return false; }
    let id,nonce; try { id = host.newRequestId ? host.newRequestId() : newId(); nonce = host.newIntentNonce ? host.newIntentNonce() : newNonce(); } catch { feedback('瀏覽器無法產生唯一操作編號，尚未送出。',true); return false; }
    const intent = canonicalPublic({kind:plan.kind,intentNonce:nonce,expected:plan.expected,...plan.publicFields}), secret = intent && privateBody(plan.kind,preparedPrivate || {},intent);
    const record = intent && {version:1,scope:identity,context:scopeOf(context),id,kind:plan.kind,intent,signature:signature(intent),at:now(),cancelRequested:false,revealed:false};
    if (!record || !validRecord(record,identity) || secret === null) { feedback('原操作內容不完整，尚未送出。',true); return false; }
    if (!savePending(record)) { feedback(state.storageError,true); return false; }
    memory = {id,signature:record.signature,body:secret}; return send(record,'action');
  }
  async function lookup(record,{history = false} = {}) {
    if (!current() || state.busy || state.loading || state.profileLoading || state.checking) return false;
    const ticket = ++receiptSequence; receiptController?.abort(); receiptController = new AbortController(); state.checking = true; state.error = ''; if (history) state.historyReceipt = null; else state.receipt = null; notify();
    try {
      const value = await host.request('fate/private/receipt',{...wire(record),readSequence:ticket},{signal:receiptController.signal});
      if (!current() || ticket !== receiptSequence || !history && !sameRecord(pending(),record)) return false;
      verifyCommon(value);
      if (value.readSequence !== ticket || typeof value.found !== 'boolean' || value.kind !== record.kind || value.requestId !== record.id || value.intentNonce !== record.intent.intentNonce || value.signature !== record.signature || value.found && !networkMatches(record,value) || !value.found && (value.outcome !== null || value.result !== null || value.receipt !== null || typeof value.recoveryAllowed !== 'boolean' || typeof value.cancellationAllowed !== 'boolean')) throw Error('lookup');
      applyFloor(value); if (value.revision > state.revision) state.stale = true;
      if (history) {
        if (!value.found) throw Error('history missing');
        state.historyReceipt = {id:record.id,kind:record.kind,outcome:value.outcome,result:clone(value.result),costs:clone(value.receipt.costs)};
      } else {
        state.receipt = value.found ? publicReply(value) : {ok:true,now:value.now,...scopeOf(value),revision:value.revision,kind:value.kind,requestId:value.requestId,intentNonce:value.intentNonce,signature:value.signature,found:false,outcome:null,result:null,receipt:null,recoveryAllowed:value.recoveryAllowed,cancellationAllowed:value.cancellationAllowed};
        state.notice = value.found ? '已找到這筆原操作的已提交紀錄。' : '尚未找到完整結果，請求可能仍在處理；請先保留原編號。';
      }
      return true;
    } catch (error) { if (!current() || ticket !== receiptSequence) return false; if (!history) state.receipt = null; state.error = safeError(error); return false; }
    finally { if (inScope() && ticket === receiptSequence) { state.checking = false; notify(); } }
  }
  async function checkPending(id) {
    const record = pending(); if (!current() || !record || record.id !== id || state.busy || state.checking || state.profileLoading) return false;
    if (!await refresh() || !current() || !sameRecord(pending(),record)) return false;
    return lookup(record);
  }
  function historyRecord(row) {
    if (!exact(row,['version','kind','requestId','requestKey','intentNonce','signature','scope','createdAt','outcome','intent']) || row.version !== 1 || !requestId(row.requestId) || row.requestKey !== 'private:app:' + row.requestId || !same(row.scope,scopeOf(context)) || !integer(row.createdAt) || !['committed','cancelled'].includes(row.outcome)) return null;
    const intent = canonicalPublic(row.intent);
    return intent && intent.kind === row.kind && intent.intentNonce === row.intentNonce && signature(intent) === row.signature ? {id:row.requestId,kind:row.kind,intent,signature:row.signature} : null;
  }
  async function readHistoryReceipt(id) { const row = state.data?.privateFate?.history?.receipts.find(item => item.requestId === id), record = row && historyRecord(row); if (!record) { feedback('這筆紀錄缺少完整的原操作內容，請保留並重新核對。',true); return false; } return lookup(record,{history:true}); }
  function acknowledge(id) {
    const record = pending(), value = state.receipt;
    if (!current() || state.storageError || !record || record.id !== id || state.busy || state.loading || state.profileLoading || state.checking || value?.found !== true || !immutableMatches(record,value)) return false;
    if (!clearPending(record)) { feedback(state.storageError,true); return false; }
    state.lastResult = {id:record.id,kind:record.kind,outcome:value.outcome,result:clone(value.result),costs:clone(value.receipt.costs)}; state.error = ''; state.notice = '已核對這筆原操作的結果。'; changed(record,value,{acknowledged:true}); notify(); void refresh(); return true;
  }
  function update(scene) {
    if (!current()) return;
    if (['accountId','realmId','characterId'].some(key => scene?.[key] != null && String(scene[key]) !== String(context[key]))) return;
    const rev = scene?.live?.revision ?? scene?.character?.revision ?? scene?.revision;
    if (!integer(rev)) return; state.minRevision = Math.max(state.minRevision,rev);
    if (rev > state.revision) { state.stale = true; state.confirm = null; preparedPrivate = null; if (!state.busy && !state.loading && !state.profileLoading && !state.checking) void refresh(); else notify(); }
  }
  return {state,context,current,pending,markRevealed,feedback,refresh,viewProfile,expected,readiness,prepareSave,prepareDelete,prepareBirthday,prepareDaily,cancel,submit,checkPending,readHistoryReceipt,acknowledge,recoveryReason,cancellationReason,prepareRecovery,prepareCancel,update,
    hasPrivatePayload(id) { const record = pending(); return !!record && record.id === id && memoryFor(record) !== null; },
    clearPrivate() { invalidate('clear'); },
    dispose() { if (disposed) return; disposed = true; generation++; sequence++; receiptSequence++; controller?.abort(); receiptController?.abort(); clearValues(); clients.delete(entry); try { channel?.close(); } catch {} channel = null; },
  };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt = value => integer(value) ? value.toLocaleString('zh-TW') : '—';
const when = value => integer(value) ? new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
const sheets = new WeakMap();
function ensureStyle(root) {
  const doc = root.ownerDocument; if (!doc || sheets.has(doc)) return;
  const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./scene-fate-private-ui.css?v=fate-f2-20261105',import.meta.url).href; doc.head.append(link); sheets.set(doc,link);
}
export function mount(root,host,options = {}) {
  ensureStyle(root);
  const doc = root.ownerDocument, scope = scopeKey(host.getContext?.(),true);
  let disposed = false, painting = false, composing = false, explicitActions = 0, tab = options.tab === 'daily' ? 'daily' : 'profile', focusedConfirm = null, confirmationOrigin = null, returnFocus = null, pendingFrame = null;
  const draft = {date:'',time:'',placeId:'',placeLabel:'',zone:'',lat:'',lon:'',sex:'',fold:'earlier',consent:false,source:'temporary',country:'TW',showSign:true,more:false};
  const clearDraft = () => { for (const field of ['date','time','placeId','placeLabel','zone','lat','lon','sex']) draft[field] = ''; draft.fold = 'earlier'; draft.consent = false; draft.source = 'temporary'; draft.more = false; };
  const clearPrivateView = () => {
    clearDraft(); composing = false; root.innerHTML = '';
    host.onPrivateCleared?.();
  };
  const client = createClient({...host,onPrivateCleared:clearPrivateView,onState:value => { paint(); host.onState?.(value); }}), state = client.state;
  const sameScope = () => !disposed && scopeKey(host.getContext?.(),true) === scope && host.current?.() !== false;
  const editing = () => composing || !!(root.contains?.(doc?.activeElement) && doc?.activeElement?.dataset?.sfpField);
  const locked = () => !client.current() || state.busy;
  const reading = () => state.loading || state.profileLoading || state.checking;
  const blocked = () => !!client.readiness();
  const note = text => '<p class="sfp-muted">' + esc(text) + '</p>';
  const button = (action,label,attrs = '',disabled = false,klass = '') => '<button type="button" class="sfp-button ' + klass + '" data-sfp-action="' + esc(action) + '" ' + attrs + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
  const card = (title,body,klass = '',attrs = '') => '<section class="sfp-card ' + klass + '" ' + attrs + '><h3>' + esc(title) + '</h3>' + body + '</section>';
  const part = () => state.data?.privateFate;
  const field = (key,label,type = 'text',attrs = '',disabled = false) => '<label class="sfp-field">' + esc(label) + '<input type="' + type + '" data-sfp-field="' + key + '" value="' + esc(draft[key]) + '" ' + attrs + ' autocomplete="off"' + (disabled ? ' disabled' : '') + '></label>';
  const select = (key,label,items,disabled = false) => '<label class="sfp-field">' + esc(label) + '<select data-sfp-field="' + key + '"' + (disabled ? ' disabled' : '') + '>' + items.map(([value,label,off]) => '<option value="' + esc(value) + '"' + (draft[key] === value ? ' selected' : '') + (off ? ' disabled' : '') + '>' + esc(label) + '</option>').join('') + '</select></label>';
  function readBirth() {
    return {date:draft.date,time:draft.time || null,placeId:draft.placeId || null,sex:draft.sex || null,fold:draft.fold,
      ...(draft.placeId === 'custom' ? {placeLabel:draft.placeLabel.trim(),zone:draft.zone.trim(),lat:draft.lat.trim() === '' ? null : Number(draft.lat),lon:draft.lon.trim() === '' ? null : Number(draft.lon)} : {})};
  }
  function applyProfile(profile) {
    clearDraft(); if (!profile?.saved || !profile.birth) return;
    const b = profile.birth; draft.date = b.date || ''; draft.time = b.time || ''; draft.placeId = b.place?.id || ''; draft.placeLabel = b.place?.label || ''; draft.zone = b.place?.zone || ''; draft.lat = b.place?.lat == null ? '' : String(b.place.lat); draft.lon = b.place?.lon == null ? '' : String(b.place.lon); draft.sex = b.sex || ''; draft.fold = b.fold || 'earlier'; draft.more = !!(draft.time || draft.placeId || draft.sex);
  }
  function resultView(entry) {
    if (!entry?.result) return '';
    const result = entry.result;
    let copy;
    if (entry.outcome === 'cancelled') copy = '<p>這筆原請求已結束，此編號不會再執行操作。</p>' + note('已產生的背景旅章進度仍保留。核對結果後，可重新填寫新的操作。');
    else if (entry.kind === 'profile-save') copy = '<p>這筆出生檔案保存已完成。</p>' + note('目前檔案狀態請以上方重新整理後的資料為準。既有當日旅箋維持原內容。');
    else if (entry.kind === 'profile-delete') copy = '<p>這筆操作當時已刪除出生檔案與保存的旅箋。</p>' + note('收據保留操作結果，無法還原已刪除的出生資料或旅箋。');
    else if (entry.kind === 'birthday-start') copy = '<p>' + esc(result.already === true ? '已核對原本仍在進行的一世，這筆操作沒有再次使用啟程額度。' : '這筆生日啟程已完成，使用了今日一次啟程額度。') + '</p>' + note('旅章編號：' + result.lifeId);
    else copy = '<p>已同步 ' + esc(result.day) + ' 的旅箋；這筆操作當時共解鎖 <strong>' + fmt(result.unlocked) + ' / 3</strong> 則。</p>' + note('旅箋內容只從目前仍保存的資料讀取。此操作沒有金幣或道具獎勵。');
    return card('已核對的原始結果',copy,'sfp-result','data-sfp-result');
  }
  function notices() {
    let html = '';
    if (state.error) html += '<div class="sfp-notice sfp-error" data-sfp-error role="alert">' + esc(state.error) + '</div>';
    if (state.storageError) html += '<div class="sfp-notice sfp-error" data-sfp-error role="alert">' + esc(state.storageError) + '</div>';
    if (state.notice) html += '<p class="sfp-notice" role="status" aria-live="polite">' + esc(state.notice) + '</p>';
    if (state.stale && state.data && !state.loading) html += '<p class="sfp-notice">目前保留上次讀到的資料，請重新整理後再操作。</p>';
    const external = host.mutationBlock?.();
    if (external) html += '<div class="sfp-notice">' + esc(external) + '<div class="sfp-actions">' + button('life','前往命運旅章核對','',locked()) + '</div></div>';
    const record = client.pending();
    if (record) {
      const r = state.receipt, found = r?.found === true;
      let body = '<p><strong>' + esc(LABELS[record.kind]) + '</strong></p>' + note('原操作編號：' + record.id);
      if (found) body += resultView({...record,outcome:r.outcome,result:r.result});
      else if (!client.hasPrivatePayload(record.id) && needsMemory(record)) body += note('私人輸入已清除，無法重送原內容。可先核對，或結束這筆請求後重新填寫。');
      if (record.cancelRequested) body += note('已要求結束這筆請求；後續只核對結果或再次確認結束。');
      body += '<div class="sfp-actions">' + button('check-pending',state.checking ? '核對中…' : '查詢原操作收據','data-sfp-pending-id="' + esc(record.id) + '"',locked() || reading(),'sfp-primary');
      if (found) body += button('acknowledge','確認已收到原結果','data-sfp-pending-id="' + esc(record.id) + '"',locked() || reading() || !!state.storageError);
      else if (r?.found === false) {
        if (r.recoveryAllowed && !record.cancelRequested && client.hasPrivatePayload(record.id)) body += button('retry','確認以原內容再送一次','data-sfp-pending-id="' + esc(record.id) + '"',!!client.recoveryReason(record.id));
        if (r.cancellationAllowed) body += button('end-pending',record.cancelRequested ? '再次確認結束原請求' : '結束這筆未決請求','data-sfp-pending-id="' + esc(record.id) + '"',!!client.cancellationReason(record.id),'sfp-danger');
      }
      body += '</div>' + note('重新整理只讀取資料；不會重送、補猜私人輸入或換用新編號。');
      html += card('上次操作結果待核對',body,'sfp-pending','data-sfp-pending');
    }
    if (state.confirm) html += card(state.confirm.label,'<p>' + esc(state.confirm.details) + '</p><div class="sfp-actions">' + button('cancel','先返回','',locked()) + button('confirm',locked() ? '送出中…' : state.confirm.mode === 'cancel' ? '確認結束原請求' : '確認送出','',locked(),state.confirm.kind === 'profile-delete' || state.confirm.mode === 'cancel' ? 'sfp-danger' : 'sfp-primary') + '</div>','sfp-confirm','data-sfp-confirm');
    if (state.lastResult && !record) html += resultView(state.lastResult);
    if (state.historyReceipt) html += resultView(state.historyReceipt);
    return html;
  }
  function profilePage() {
    const p = part(), profile = p.profile, disabled = blocked();
    let html = '<section class="sfp-intro"><span class="sfp-seal" aria-hidden="true">✦</span><div><p class="sfp-eyebrow">A PRIVATE PAGE OF YOUR OWN</p><h3>把自己的節奏，留在這一頁。</h3><p>生日可只用於這次啟程；出生檔案由你決定是否保存。</p></div></section>';
    html += card('出生檔案', '<div class="sfp-status"><span class="sfp-badge">' + (profile.saved ? '已保存' : '尚未保存') + '</span><span>' + (profile.coverage === 'three-traditions' ? '完整出生檔案' : '生活靈感') + '</span></div>' + note('同一世界的同帳號角色共用。生日、時間、地點與排盤用性別不會寫入分享圖卡。') + '<div class="sfp-actions">' + (profile.saved ? button('view-profile',state.profileLoading ? '讀取中…' : '載入已保存資料','',locked() || reading()) : '') + button('clear-private','清空本頁私人輸入','',locked()) + '</div>');
    let form = '<form class="sfp-form" data-sfp-private="birth" autocomplete="off">' + field('date','出生年月日','date','min="1900-01-01"',disabled) + '<details class="sfp-details" data-sfp-details="more"' + (draft.more ? ' open' : '') + '><summary>出生時間、地點與排盤用性別 · 選填</summary><div class="sfp-form">' + field('time','出生時間 · 當地鐘錶時間','time','step="60"',disabled) + select('placeId','出生地',[['','不知道／暫不提供'],...PLACES.map(place => [place[0],place[1]]),['custom','其他地點 · 自行填寫']],disabled);
    if (draft.placeId === 'custom') form += '<div class="sfp-custom">' + field('placeLabel','地點名稱','text','maxlength="60"',disabled) + field('zone','IANA 時區（例如 America/New_York）','text','maxlength="80" spellcheck="false"',disabled) + '<div class="sfp-pair">' + field('lat','緯度 · -65 至 65','number','min="-65" max="65" step="any"',disabled) + field('lon','經度 · -180 至 180','number','min="-180" max="180" step="any"',disabled) + '</div></div>';
    form += select('fold','夏令時間重複鐘點的對應',[['earlier','較早一次'],['later','較晚一次']],disabled) + select('sex','排盤用性別 · 與角色性別無關',[['','暫不提供'],['m','男'],['f','女']],disabled) + note('不確定的資料可以留白，不會自動猜測。時間、地點或排盤用性別未齊時，提供生活靈感。') + '</div></details><label class="sfp-check"><input type="checkbox" data-sfp-field="consent"' + (draft.consent ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span>我同意保存這份出生資料供每日旅箋使用，並知道可以隨時刪除。</span></label><div class="sfp-actions">' + button('save-profile','同意並保存出生檔案','',disabled,'sfp-primary') + '</div></form>';
    html += card('自願填寫與保存',form);
    const countries = host.getFateState?.()?.countries || COUNTRIES.map(country => ({id:country,name:({TW:'臺灣',JP:'日本',KR:'韓國',US:'美國',CA:'加拿大',GB:'英國',DE:'德國',FR:'法國',AU:'澳洲',IN:'印度'})[country]}));
    let start = '<div class="sfp-form">' + select('source','這次使用哪一份生日？',[['temporary','只用這次填寫的生日'],['saved','使用目前已保存檔案',!profile.saved]],disabled) + select('country','這一世，從哪裡開始？',countries.map(country => [country.id,country.name + (country.cityName ? ' · ' + country.cityName : '')]),disabled) + '<label class="sfp-check"><input type="checkbox" data-sfp-field="showSign"' + (draft.showSign ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span>在旅章中顯示這一世的星座</span></label></div>' + note('啟程與保存是兩個獨立操作。未勾選保存同意，也能只用這次生日啟程。') + '<div class="sfp-actions">' + button('birthday-start','用生日展開一世','',disabled || host.getFateState?.()?.control?.startAllowed === false,'sfp-primary') + button('life','回到正在展開的旅章','',locked()) + '</div><div class="sfp-rule"><span>一世 2 小時</span><span>同帳號每天最多 4 世</span><span>00:00–06:00 暫停成長</span></div>';
    html += card('用生日重新啟程',start);
    if (profile.saved || p.daily.materialized) html += card('刪除保存的資料',note('刪除出生檔案與這個帳號在目前世界保存的全部旅箋；既有旅章與星輝匣保持原紀錄。') + '<div class="sfp-actions">' + button('delete-profile','刪除出生檔案與旅箋','',disabled,'sfp-danger') + '</div>','sfp-delete');
    return html;
  }
  function dailyPage() {
    const p = part(), d = p.daily, disabled = blocked(), names = ['健康','工作','感情'], english = ['CARE FOR YOURSELF','CHOOSE YOUR NEXT STEP','MAKE ROOM FOR CLOSENESS'];
    let html = '<section class="sfp-intro"><span class="sfp-seal" aria-hidden="true">✧</span><div><p class="sfp-eyebrow">LET THE STARS WRITE BACK</p><h3>今日旅箋 · ' + esc(p.day) + '</h3><p>每完成一項同行任務，便能揭開一則今日提醒。</p></div></section>';
    html += card(d.materialized ? '今天已保存的旅箋' : '今天的旅箋尚未建立','<div class="sfp-daily-count"><strong>' + fmt(d.unlocked) + '<small> / 3</small></strong><span>已啟封</span><span class="sfp-badge">' + (d.materialized ? '已保存今日內容' : '尚未建立') + '</span></div>' + note(d.materialized ? '開窗與重新整理只顯示保存的內容。按同步才核對新的同行任務；同一天不重抽旅箋。' : '按建立後才保存今日三則旅箋；尚未保存出生檔案也可以取得生活靈感。') + '<div class="sfp-actions">' + button('sync-daily',d.materialized ? '同步已完成的同行任務' : '建立今日旅箋','',disabled,'sfp-primary') + '</div>');
    const tasks = [{id:'boss',name:'並肩迎戰首領',detail:'對本群已擊倒的世界首領造成有效傷害。'},{id:'dungeon',name:'完成三人副本',detail:'三個不同帳號通關一般副本，且自己有手動行動。'},{id:'tower',name:'同行攻克五層',detail:'三人爬塔中參與五個成功樓層，且自己有手動行動。'}];
    html += card('同行任務','<div class="sfp-tasks">' + tasks.map(task => { const saved = d.unlocks.some(row => row.id === task.id), available = p.evidence.available.some(row => row.id === task.id); return '<article><span class="sfp-task-mark" aria-hidden="true">' + (saved ? '✓' : available ? '✧' : '○') + '</span><div><h4>' + esc(task.name) + '</h4><p>' + esc(task.detail) + '</p></div><span class="sfp-task-state">' + (saved ? '已同步' : available ? '可同步' : '未完成') + '</span></article>'; }).join('') + '</div>' + note('每類任務一天計一次，依實際戰鬥紀錄核對；沒有金幣或道具領取。'));
    html += '<div class="sfp-notes">';
    for (let i = 0; i < 3; i++) {
      const n = d.notes[i], opened = n?.locked === false;
      let body = '<header><span class="sfp-note-number" aria-hidden="true">' + ['Ⅰ','Ⅱ','Ⅲ'][i] + '</span><div><p class="sfp-eyebrow">' + english[i] + '</p><h3>' + names[i] + '</h3></div><span class="sfp-badge">' + (opened ? '已啟封' : '待啟封') + '</span></header>';
      if (opened) body += '<div class="sfp-note-copy" data-sfp-private="note"><p class="sfp-note-kind">' + esc(n.kind) + '</p><h4>' + esc(n.title) + '</h4><p>' + esc(n.scene) + '</p><section><strong>今天可以試著</strong><p>' + esc(n.action) + '</p></section><p>' + esc(n.reason) + '</p>' + note(n.basis) + '</div>';
      else body += note(d.materialized ? '完成同行任務後按同步，依序啟封這一則提醒。' : '建立今日旅箋後，依完成的同行任務啟封。');
      html += '<article class="sfp-note ' + (opened ? 'is-open' : 'is-locked') + '">' + body + '</article>';
    }
    html += '</div>' + note('旅箋沿用原有生活靈感與文化推演內容；不作現實結果的保證。');
    return html;
  }
  function history() {
    const rows = part()?.history?.receipts || [];
    return card('最近的私人操作紀錄',note('紀錄只保留當時操作的結果。查詢不重送，也不還原已刪除的出生資料或旅箋。') + (rows.length ? '<div class="sfp-history">' + rows.map(row => '<article><div><h4>' + esc(LABELS[row.kind] || '待核對的原操作') + '</h4><p>' + esc(when(row.createdAt)) + (row.outcome === 'cancelled' ? ' · 已結束請求' : '') + '</p></div>' + button('history-receipt','核對原結果','data-sfp-request-id="' + esc(requestId(row.requestId) ? row.requestId : '') + '"',locked() || reading() || row.corrupt === true) + '</article>').join('') + '</div>' : note('目前還沒有這個入口的紀錄。')));
  }
  function focusIdentity(element) {
    if (!element || !root.contains?.(element)) return null;
    const data = element.dataset || {}; if (!data.sfpAction && !data.sfpField) return null;
    return {data:Object.fromEntries(['sfpAction','sfpField','sfpTab','sfpPendingId','sfpRequestId'].filter(key => data[key] !== undefined).map(key => [key,data[key]])),start:element.selectionStart,end:element.selectionEnd};
  }
  function restoreFocus(value) {
    if (!value || !sameScope() || doc?.hidden || root.isConnected === false) return;
    const element = [...root.querySelectorAll('button,input,select,textarea')].find(row => Object.entries(value.data).every(([key,val]) => row.dataset?.[key] === val));
    if (!element || element.disabled) return; element.focus?.({preventScroll:true}); if (typeof value.start === 'number') { try { element.setSelectionRange?.(value.start,value.end); } catch {} }
  }
  function revealPending() {
    const record = client.pending(); if (!record || record.revealed || state.storageError || locked() || reading() || state.confirm || pendingFrame !== null) return;
    const focus = doc?.activeElement, id = record.id;
    const run = () => {
      pendingFrame = null;
      if (!sameScope() || doc?.hidden || root.isConnected === false || doc?.activeElement !== focus || client.pending()?.id !== id || client.pending()?.revealed || locked() || reading() || state.confirm || state.storageError) return;
      const target = root.querySelector('[data-sfp-action="check-pending"]'); if (!target || target.disabled) return;
      client.markRevealed(id); target.closest?.('[data-sfp-pending]')?.scrollIntoView?.({block:'nearest',behavior:'auto'}); target.focus?.({preventScroll:true});
    };
    if (globalThis.requestAnimationFrame) pendingFrame = globalThis.requestAnimationFrame(run); else run();
  }
  function paint(force = false) {
    if (!sameScope() || painting) return;
    // Pure reads can update freshness without replacing an active input or IME.
    // Explicit actions may paint; private invalidation clears the DOM above first.
    if (!force && !explicitActions && editing()) {
      root.querySelector('[data-sfp-ready]')?.setAttribute('data-sfp-ready',String(!!part() && !state.stale));
      if (!state.confirm) root.querySelector('[data-sfp-confirm]')?.remove?.();
      return;
    }
    painting = true;
    try {
      const position = root.scrollTop, focus = returnFocus || focusIdentity(doc?.activeElement); returnFocus = null;
      let html = '<div class="sfp-window" data-sfp-ready="' + String(!!part() && !state.stale) + '"><header class="sfp-header"><div><p class="sfp-eyebrow">BIRTH & DAILY LETTERS</p><h2>出生與旅箋</h2><p>' + esc(client.context.realmId === 'permanent' ? '永久世界' : '賽季世界') + ' · 同帳號共用</p></div>' + button('refresh',state.loading ? '同步中…' : '重新整理','',locked() || state.profileLoading || state.checking) + '</header><nav class="sfp-tabs" aria-label="出生與旅箋頁籤">' + [['profile','出生檔案'],['daily','今日旅箋']].map(([key,label]) => button('tab',label,'data-sfp-tab="' + key + '" aria-selected="' + String(tab === key) + '"',locked(),tab === key ? 'is-active' : '')).join('') + '</nav>' + notices();
      html += part() ? (tab === 'profile' ? profilePage() : dailyPage()) + history() : note(state.loading ? '正在讀取目前世界的出生檔案狀態與旅箋…' : '尚未取得完整資料，請重新整理；不會自動建立或保存。');
      root.innerHTML = html + '</div>'; root.scrollTop = position;
      if (state.confirm && focusedConfirm !== state.confirm) { focusedConfirm = state.confirm; if (!doc?.hidden) root.querySelector('[data-sfp-action="cancel"]')?.focus?.({preventScroll:true}); root.querySelector('[data-sfp-confirm]')?.scrollIntoView?.({block:'nearest',behavior:'auto'}); }
      else { if (!state.confirm) focusedConfirm = null; restoreFocus(focus); }
      revealPending();
    } finally { painting = false; }
  }
  async function click(event) {
    const target = event.target.closest?.('[data-sfp-action]'); if (!target || !root.contains?.(target) || target.disabled || !sameScope()) return;
    explicitActions++;
    try {
      const action = target.dataset.sfpAction, record = client.pending();
      if (pendingFrame !== null) { globalThis.cancelAnimationFrame?.(pendingFrame); pendingFrame = null; }
      if (record && action !== 'check-pending') client.markRevealed(record.id);
      if (action === 'cancel') { returnFocus = confirmationOrigin; client.cancel(); return; }
      if (action === 'confirm') { await client.submit(); return; }
      if (action === 'check-pending') { await client.checkPending(target.dataset.sfpPendingId); return; }
      if (action === 'acknowledge') { client.acknowledge(target.dataset.sfpPendingId); return; }
      if (action === 'history-receipt') { await client.readHistoryReceipt(target.dataset.sfpRequestId); return; }
      if (action === 'refresh') { await client.refresh(); return; }
      if (locked()) return;
      if (action === 'life') { host.onNavigateLife?.(); return; }
      if (action === 'tab') { if (!['profile','daily'].includes(target.dataset.sfpTab)) return; tab = target.dataset.sfpTab; client.cancel(); clearDraft(); state.profile = null; paint(); return; }
      if (action === 'clear-private') { clearDraft(); client.clearPrivate(); await client.refresh(); return; }
      if (action === 'view-profile') { if (await client.viewProfile() && sameScope()) { applyProfile(state.profile); if (state.stale) await client.refresh(); paint(); } return; }
      confirmationOrigin = focusIdentity(target);
      if (action === 'save-profile') client.prepareSave(readBirth(),draft.consent);
      else if (action === 'delete-profile') client.prepareDelete();
      else if (action === 'birthday-start') client.prepareBirthday(draft.source,draft.country,draft.showSign,draft.source === 'temporary' ? draft.date : undefined);
      else if (action === 'sync-daily') client.prepareDaily();
      else if (action === 'retry') client.prepareRecovery(target.dataset.sfpPendingId);
      else if (action === 'end-pending') client.prepareCancel(target.dataset.sfpPendingId);
    } finally { explicitActions--; paint(); }
  }
  function input(event) {
    const key = event.target.dataset?.sfpField; if (!key || !own(draft,key) || !sameScope() || locked() || !!client.pending() || !!state.storageError) return;
    draft[key] = ['consent','showSign'].includes(key) ? event.target.checked === true : event.target.value;
    if (['date','time','placeId','placeLabel','zone','lat','lon','sex','fold'].includes(key)) { draft.consent = false; const box = root.querySelector('[data-sfp-field="consent"]'); if (box) box.checked = false; }
    if (state.confirm) client.cancel();
  }
  function change(event) {
    input(event);
    if (event.target.dataset?.sfpField === 'placeId' && sameScope()) {
      // Native expansion can change before its queued toggle event is delivered.
      const details = root.querySelector('[data-sfp-details="more"]');
      if (details) draft.more = details.open === true;
      paint(true);
    }
  }
  function compositionStart(event) { if (sameScope() && event.target.dataset?.sfpField && root.contains?.(event.target)) composing = true; }
  function compositionEnd(event) { if (!sameScope()) return; composing = false; input(event); }
  function toggle(event) { if (event.target.dataset?.sfpDetails === 'more' && sameScope()) draft.more = event.target.open === true; }
  const submit = event => event.preventDefault();
  const visibility = () => { if (sameScope() && !doc?.hidden && !locked() && !reading() && !state.confirm && !editing()) void client.refresh(); };
  root.addEventListener('click',click); root.addEventListener('input',input); root.addEventListener('change',change); root.addEventListener('compositionstart',compositionStart); root.addEventListener('compositionend',compositionEnd); root.addEventListener('toggle',toggle,true); root.addEventListener('submit',submit); doc?.addEventListener?.('visibilitychange',visibility);
  paint(); void client.refresh(); const timer = globalThis.setInterval?.(visibility,15000);
  return {client,refresh:() => client.refresh(),update:client.update,
    handleBack() { if (!sameScope() || !state.confirm || state.busy) return false; returnFocus = confirmationOrigin; client.cancel(); return true; },
    dispose() { if (disposed) return; disposed = true; if (pendingFrame !== null) globalThis.cancelAnimationFrame?.(pendingFrame); globalThis.clearInterval?.(timer); client.dispose(); clearDraft(); root.removeEventListener('click',click); root.removeEventListener('input',input); root.removeEventListener('change',change); root.removeEventListener('compositionstart',compositionStart); root.removeEventListener('compositionend',compositionEnd); root.removeEventListener('toggle',toggle,true); root.removeEventListener('submit',submit); doc?.removeEventListener?.('visibilitychange',visibility); root.innerHTML = ''; },
  };
}
globalThis.RpgSceneFatePrivate = {createClient,mount,canonicalPublic,signature,validRecord,resultMatches,receiptMatches,storedPendingBlock};
