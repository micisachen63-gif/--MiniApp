/* Dungeon and tower parties in the shared battle window.
 * Pure reads: party/scene and tower/scene. Existing writes are explicit, never replayed.
 * Selectors: data-sp-action, data-party-id, data-dungeon-id, data-skill-id;
 * data-sp-ready, data-sp-tab, data-sp-party, data-sp-confirm, data-sp-pending.
 */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW',{maximumFractionDigits:1}) : '—';
  const clone = value => JSON.parse(JSON.stringify(value));
  const identityKey = c => JSON.stringify(['accountId','realmId','characterId'].map(k=>String(c?.[k] ?? '')));
  const scopeKey = c => JSON.stringify(['accountId','realmId','characterId','epoch'].map(k=>String(c?.[k] ?? '')));
  const STATUS = {lobby:'招募中',combat:'戰鬥中',won:'挑戰成功',lost:'挑戰失敗',ended:'已結束'};
  const ROLES = {guard:'守護',breach:'破陣',aid:'支援',control:'壓制'};
  const TABS = [['current','目前隊伍'],['dungeons','三人副本'],['trials','轉職試煉'],['lobby','組隊大廳']];
  const TOWER_TABS = [['current','目前隊伍'],['areas','登塔區域'],['lobby','爬塔大廳']];
  const OPS = new Set(['join','ready','start','leave','end','submit']);
  const pendingMemory = new Map(), sheets = new WeakMap();
  const scriptUrl = globalThis.document?.currentScript?.src;
  const requestKey = () => 'sp_' + (globalThis.crypto?.randomUUID?.().replaceAll('-','') || Date.now().toString(36) + Math.random().toString(36).slice(2,14));
  function validPending(p,key,kind='dungeon') {
    return !!p && p.version === 1 && p.scope === key && (p.kind || 'dungeon') === kind && typeof p.id === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(p.id)
      && typeof p.label === 'string' && p.label.length <= 240 && p.body && typeof p.body === 'object'
      && (p.action === 'party/create' && p.body.kind === kind && (kind === 'tower' ? [1,11,21].includes(p.body.startFloor) : typeof p.body.dungeonId === 'string')
        || p.action === 'party/action' && OPS.has(p.body.op) && typeof p.body.partyId === 'string'
        || p.action === 'party/reward' && typeof p.body.partyId === 'string');
  }
  function partyRevision(p) { return Number(p?.revision ?? p?.rev); }
  function targetChoices(p,skill,characterId) {
    const own = String(p?.me?.actor?.id || characterId || ''), members = (p?.members || []).filter(m=>!m.left);
    const mode = skill?.target || (skill?.id === 'attack' ? 'enemy' : 'self');
    const choices = list => list.map(m=>({value:String(m.id),targetId:String(m.id),label:m.name + (Number(m.hp) === 0 ? '（倒地）' : ' · 生命 ' + fmt(m.hp) + '／' + fmt(m.maxHp))}));
    if (mode === 'ally') return choices(members.filter(m=>typeof m.hp === 'number' && Number.isFinite(m.hp) && m.hp > 0));
    if (mode === 'downed_ally') return choices(members.filter(m=>typeof m.hp === 'number' && m.hp === 0));
    if (mode === 'enemy') return p?.enemy && Number(p.enemy.hp) > 0 ? [{value:'enemy',targetId:own,label:p.enemy.name || '目前敵人'}] : [];
    if (mode === 'role') return [{value:'role',targetId:own,label:'依職責戰技的指定效果'}];
    if (mode === 'all_allies') return [{value:'all_allies',targetId:own,label:'全體存活隊友'}];
    if (mode === 'auto_ally') return [{value:'auto_ally',targetId:own,label:'自動選擇生命比例最低的隊友'}];
    return [{value:own,targetId:own,label:p?.me?.actor?.name || members.find(m=>String(m.id) === own)?.name || '自己'}];
  }
  function dropSkills(dungeon,skills) {
    if (!Array.isArray(dungeon?.dropSkillIds) || !Array.isArray(skills)) return null;
    const byId = new Map(skills.map(s=>[s.id,s])), ids = [...new Set(dungeon.dropSkillIds)];
    if (ids.some(id=>typeof id !== 'string' || !byId.has(id))) return null;
    return ids.map(id=>byId.get(id));
  }
  function tacticReason(p,s,at,characterId) {
    const a=p?.me?.actor;if(!a||p.me?.left||p.status!=='combat')return '目前不能選擇戰術';
    if(!s)return '請先選擇技能';
    if(Number(a.hp)<=0)return '已倒地，等待隊友復活';
    if(p.pendingSettlement||Number(p.deadline)<=at)return '本回合已到時，請等待戰況更新';
    if(!s.native&&!s.roleSkill&&!['attack','defend'].includes(s.id)){
      if(s.eligible!==true)return s.eligible===false?'目前職業或等級不符合此技能':'技能資格尚未取得，請更新戰況';
      if(!Array.isArray(a.special?.learned)||!a.special.learned.includes(s.id))return '尚未學會此技能';
    }
    if(!s.native&&Number(a.mp)<Number(s.mp))return '魔力不足';
    const cd=s.roleSkill?Math.max(0,Number(a.roleCooldowns?.[s.id]||0)-Number(p.round)):Math.max(0,Math.ceil((Number(a.special?.cooldowns?.[s.id]||0)-at)/1000));
    if(cd)return '冷卻 '+fmt(cd)+(s.roleSkill?' 回合':' 秒');
    if(!targetChoices(p,s,characterId).length)return s.target==='downed_ally'?'目前沒有倒地隊友':'目前沒有可選目標';
    return '';
  }
  function createClient(host,options={}) {
    const kind=options.kind || 'dungeon';if(!['dungeon','tower'].includes(kind))throw Error('不支援的隊伍種類');
    const readAction=kind==='tower'?'tower/scene':'party/scene';
    const context = {...host.getContext?.()}, scope = scopeKey(context), identity = identityKey(context);
    let storage = host.storage;
    if (!storage) { try { storage = globalThis.sessionStorage; } catch {} }
    const pendingKey=kind==='tower'?'tower:'+identity:identity;
    const storageKey = (kind==='tower'?'rpg-sp-tower-pending:':'rpg-sp-pending:') + identity, revisions = new Map();
    const state = {data:null,loading:false,busy:false,stale:true,error:'',notice:'',confirm:null,revision:-1,minRevision:-1,checkedPending:null,receivedAt:0};
    let disposed = false, generation = 0, controller = null, query = {tab:'active',page:1};
    const current = () => !disposed && scopeKey(host.getContext?.()) === scope && host.current?.() !== false;
    const notify = () => { if (current()) host.onState?.(state); };
    function pending() {
      if (pendingMemory.has(pendingKey)) return pendingMemory.get(pendingKey);
      let value = null;
      try { const p = JSON.parse(storage?.getItem?.(storageKey) || 'null');if (validPending(p,identity,kind)) value = p; } catch {}
      pendingMemory.set(pendingKey,value);return value;
    }
    function savePending(value) {
      pendingMemory.set(pendingKey,value);
      try { if (value) storage?.setItem?.(storageKey,JSON.stringify(value));else storage?.removeItem?.(storageKey); } catch {}
    }
    function clearPending(id) { if (pending()?.id === id) savePending(null); }
    const fingerprint = () => JSON.stringify([state.data?.character,state.data?.party,state.data?.active,state.data?.canCreate,state.data?.readOnly,state.data?.tower?.daily]);
    const now = () => (Number(state.data?.now) || Date.now()) + Math.max(0,Date.now() - state.receivedAt);
    function readiness() {
      if (!current()) return '角色或世界已切換';
      if (state.busy || state.loading) return '正在更新隊伍資料';
      if (state.data?.readOnly) return state.data.readOnlyReason || '這個世界目前只能查看資料';
      if (pending()) return '請先核對上次操作結果';
      if (!state.data || state.stale || state.revision < state.minRevision) return '請先更新隊伍資料';
      return '';
    }
    function feedback(message,error = false) { if (!current()) return;state[error ? 'error' : 'notice'] = message;notify(); }
    function accept(data) {
      if (!data || data.ok === false || !data.character || (kind==='tower' ? !data.tower || !Array.isArray(data.tower.areas) : !Array.isArray(data.dungeons)) || !Array.isArray(data.skills) || !data.directory || !Array.isArray(data.directory.parties)) throw Error('隊伍資料尚未完整，請重新整理');
      for (const k of ['accountId','realmId','characterId']) if (String(data[k]) !== String(context[k])) throw Error('角色或世界已切換，請重新開啟隊伍視窗');
      if (String(data.character.tgId ?? data.character.id) !== String(context.characterId)) throw Error('收到其他角色的隊伍資料');
      const rev = Number(data.character.revision ?? data.character.rev);
      if (!Number.isFinite(rev) || rev < Math.max(state.revision,state.minRevision)) throw Error('收到較早的角色資料，請重新整理');
      for (const p of [data.active,data.party].filter(Boolean)) {
        if (p.kind !== kind || !Array.isArray(p.members)) throw Error(kind==='tower'?'這場隊伍不屬於爬塔':'這場隊伍不屬於三人副本');
        const r = partyRevision(p);
        if (!Number.isFinite(r) || r < (revisions.get(String(p.id)) ?? -1)) throw Error('收到較早的隊伍戰況，請重新整理');
        if (p.me?.actor?.id != null && String(p.me.actor.id) !== String(context.characterId)) throw Error('隊伍角色已切換，請重新開啟視窗');
      }
      for (const p of [data.active,data.party].filter(Boolean)) revisions.set(String(p.id),partyRevision(p));
      return rev;
    }
    // A revision-only re-read keeps the current buttons until the answer arrives.
    var backgroundRead = false;
    async function refresh(next) {
      const quiet = backgroundRead;backgroundRead = false;
      if (!current() || state.busy) return false;
      if (next) query = {tab:next.tab === 'ended' ? 'ended' : 'active',page:Math.max(1,Math.trunc(Number(next.page) || 1)),...(next.partyId ? {partyId:String(next.partyId)} : {})};
      const ticket = ++generation, before = fingerprint();
      controller?.abort();controller = new AbortController();state.loading = true;state.error = '';if (!quiet) notify();
      try {
        const data = await host.request(readAction,{...query},{signal:controller.signal});
        if (!current() || ticket !== generation) return false;
        state.revision = accept(data);state.data = clone(data);state.receivedAt = Date.now();state.stale = false;
        const waiting=pending(),sameParty=waiting?.body?.partyId?String(data.party?.id)===String(waiting.body.partyId):!query.partyId&&String(data.party?.id||'')===String(data.active?.id||'');
        state.checkedPending = waiting&&sameParty ? waiting.id : null;
        if (state.confirm && before !== fingerprint()) {state.confirm = null;state.notice = '隊伍狀態已更新，請重新確認操作。';}
        return true;
      } catch (error) {
        if (!current() || ticket !== generation) return false;
        state.stale = true;state.checkedPending = null;state.confirm = null;
        state.error = error?.message || '暫時無法更新隊伍資料';return false;
      } finally { if (current() && ticket === generation) {state.loading = false;notify();} }
    }
    function prepare(action,body,label,details,{quiet = false} = {}) {
      const reason = readiness();if (reason) {feedback(reason,true);return false;}
      const record = {version:1,scope:identity,kind,id:requestKey(),action,body:clone(body),label};
      if (!validPending(record,identity,kind)) throw Error('不支援的隊伍操作');
      state.error = '';state.notice = '';state.confirm = {action,body:clone(body),label,details,fingerprint:fingerprint()};
      if (!quiet) notify();return true;
    }
    function cancel() { if (!current() || state.busy) return;state.confirm = null;notify(); }
    async function submit() {
      if (!current() || !state.confirm || readiness()) return false;
      const plan = state.confirm;
      if (plan.fingerprint !== fingerprint()) {state.confirm = null;feedback('隊伍狀態已更新，請重新選擇。',true);return false;}
      const recordId = requestKey(), requestBody = clone(plan.body);
      if (plan.action !== 'party/create') requestBody.requestId = recordId;
      const record = {version:1,scope:identity,kind,id:recordId,action:plan.action,body:requestBody,label:plan.label,at:Date.now()};
      savePending(record);state.confirm = null;state.busy = true;state.checkedPending = null;state.error = '';state.notice = '';
      generation++;controller?.abort();notify();let acknowledged = false;
      try {
        const result = await host.request(plan.action,clone(record.body));
        if (!current()) return false;
        if (!result || result.ok !== true || !result.party || result.party.kind !== kind || !Array.isArray(result.party.members)
          || (plan.body.partyId && String(result.party.id) !== String(plan.body.partyId))) throw Object.assign(Error('未收到完整隊伍收據'),{uncertain:true});
        clearPending(record.id);acknowledged = true;state.stale = true;
        const rev = partyRevision(result.party);if (Number.isFinite(rev)) revisions.set(String(result.party.id),Math.max(revisions.get(String(result.party.id)) ?? -1,rev));
        if (plan.action === 'party/create' || plan.body.op === 'join') query.partyId = result.party.id;
        state.notice = plan.body.op === 'submit' ? '戰術已選定；本回合結算前仍可改選。' : plan.label + '已完成。';
        host.onChanged?.(result,{action:plan.action,body:clone(record.body)});
      } catch (error) {
        if (!current()) return false;
        const status = Number(error?.status), uncertain = error?.uncertain || !Number.isInteger(status) || status < 400 || status >= 500 || /duplicate|request_id|character_changed|stale|context/i.test(String(error?.code || ''));
        if (!uncertain) clearPending(record.id);
        state.stale = true;
        state.error = uncertain ? '操作結果待確認。請更新隊伍並核對；這筆操作不會自動再次送出。' : error?.code === 'round' ? '戰局已進入下一回合，請更新後重新選擇技能與目標。' : error?.message || '隊伍操作尚未完成';
      } finally {
        if (current()) {state.busy = false;notify();if (acknowledged || !pending()) {const error=state.error;await refresh();if(error && !state.error) {state.error=error;notify();}}}
      }
      return acknowledged;
    }
    async function execute(action,body,label,details='') { if (!prepare(action,body,label,details,{quiet:true})) return false;return submit(); }
    function acknowledge() {
      const p = pending();
      if (!current() || !p || state.busy || state.loading || state.stale || state.checkedPending !== p.id) return false;
      clearPending(p.id);state.error = '';state.notice = '已結束這筆待核對狀態。';notify();return true;
    }
    function update(scene) {
      if (!current()) return;
      for (const key of ['accountId','realmId','characterId']) if (scene?.[key] != null && String(scene[key]) !== String(context[key])) return;
      const revision = Number(scene?.live?.revision ?? scene?.character?.revision ?? scene?.actor?.revision);
      if (!Number.isFinite(revision)) return;
      state.minRevision = Math.max(state.minRevision,revision);
      if (revision > state.revision && !state.busy && !state.loading) {
        state.stale = true;
        if (state.confirm) {state.confirm = null;state.notice = '角色狀態已更新，請重新確認。';}
        backgroundRead = true;void refresh();
      }
    }
    return {state,context,kind,current,pending,now,readiness,refresh,prepare,cancel,submit,execute,acknowledge,feedback,update,
      dispose(){if(disposed)return;disposed=true;generation++;controller?.abort();}};
  }
  function ensureStyle(root) {
    const doc = root.ownerDocument;if (!doc?.createElement || !doc.head || sheets.has(doc)) return;
    const link = doc.createElement('link');link.rel = 'stylesheet';link.href = scriptUrl ? new URL('scene-party-ui.css?v=20261105',scriptUrl).href : 'scene-party-ui.css?v=20261105';
    link.onerror = () => {sheets.delete(doc);link.remove?.();};doc.head.appendChild(link);sheets.set(doc,link);
  }
  function mount(root,host,options = {}) {
    ensureStyle(root);const kind=options.kind || 'dungeon',towerMode=kind==='tower',tabs=towerMode?TOWER_TABS:TABS,catalogueTab=towerMode?'areas':'dungeons';
    const draft = host.draft || {};if(options.partyId)draft.partyId=String(options.partyId);
    draft.tab = tabs.some(([key])=>key === (options.tab || draft.tab)) ? options.tab || draft.tab : 'current';
    draft.directoryTab = draft.directoryTab === 'ended' ? 'ended' : 'active';draft.page = Math.max(1,Number(draft.page) || 1);
    let disposed = false, timer = null, focusConfirm = false, savedFocus = null;
    let pendingRevealFrame=null,pendingRevealId=null,revealedPendingId=null;
    const client = createClient({...host,onState:()=>paint(),onChanged:(result,op)=>{
      if (!client.current()) return;
      if (op.action === 'party/create' || op.body.op === 'join') {draft.tab='current';draft.partyId=result.party.id;draft.tactics=false;draft.pool='';}
      if (op.body.op === 'submit') draft.tactics=false;
      try {host.onChanged?.(result);} catch {}
    }},{kind});
    const state=client.state,data=()=>state.data,party=()=>data()?.party;
    const query=()=>({tab:draft.directoryTab,page:draft.page,...(draft.partyId ? {partyId:draft.partyId} : {})});
    const refresh=()=>client.refresh(query());
    const disabled=()=>!!client.readiness(), ownId=()=>String(client.context.characterId);
    const button=(action,label,{partyId,dungeonId,startFloor,skillId,tab,page,disabled:locked=false,primary=false,danger=false,extra=''}={})=>
      '<button type="button" data-sp-action="'+action+'"'+(partyId?' data-party-id="'+esc(partyId)+'"':'')+(dungeonId?' data-dungeon-id="'+esc(dungeonId)+'"':'')+(startFloor!=null?' data-start-floor="'+Number(startFloor)+'"':'')+(skillId?' data-skill-id="'+esc(skillId)+'"':'')+(tab?' data-tab="'+esc(tab)+'"':'')+(page?' data-page="'+page+'"':'')+
      (locked?' disabled':'')+' class="'+(primary?'sp-primary is-primary ':danger?'sp-danger ':'')+'"'+extra+'>'+esc(label)+'</button>';
    const muted=text=>'<p class="sp-muted">'+esc(text)+'</p>';
    const meter=(name,value,max,type='hp')=>{
      if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(max))) return '';
      const percent=Number(max)>0?Math.max(0,Math.min(100,Number(value)/Number(max)*100)):0;
      return '<div class="sp-vital"><span>'+name+' '+fmt(value)+'／'+fmt(max)+'</span><div class="sp-meter sp-meter-'+type+'" role="meter" aria-label="'+name+'" aria-valuemin="0" aria-valuemax="'+Math.max(1,Number(max))+'" aria-valuenow="'+Math.max(0,Number(value))+'"><i style="width:'+percent+'%"></i></div></div>';
    };
    const roles=(values=[])=>values.map(role=>'<span class="sp-role">'+esc(ROLES[role]||role)+'</span>').join('');
    const rewardText=items=>Object.entries(items||{}).filter(([,n])=>Number(n)>0).map(([key,n])=>{
      const s=data()?.skills?.find(v=>'book_'+v.id===key), name=s?s.name+'技能書':({tower_fragment:'星穹徽記',research_fragment:'研究碎片',trial_3:'三轉試煉證明',trial_4:'四轉試煉證明'})[key]||key;
      return name+' × '+fmt(n);
    }).join('、')||'本次沒有可領取的物品';
    function notices() {
      let html=state.error?'<p class="sp-feedback sp-error" role="alert">'+esc(state.error)+'</p>':'';
      if(state.notice)html+='<p class="sp-feedback" role="status">'+esc(state.notice)+'</p>';
      if(data()?.readOnly)html+='<p class="sp-feedback">'+esc(data().readOnlyReason||'這個世界目前只能查看資料')+'</p>';
      if(state.stale&&data())html+=muted('目前顯示上次取得的戰況；更新成功後才能繼續操作。');
      const pending=client.pending();
      if(pending){
        const partyId=pending.body.partyId;
        const guidance=partyId?'請查看這筆操作原本的隊伍，核對回合、已選戰術或獎勵。':'請以目前隊伍核對建立結果；若尚未看到隊伍，請稍後再更新。';
        html+='<section class="sp-pending" data-sp-pending role="status"><h3>上次操作待核對</h3><p>'+esc(pending.label)+'。'+esc(guidance)+'這筆操作不會自動再次送出。</p>'+
          (partyId&&String(data()?.party?.id)!==String(partyId)?muted('目前查看的是其他隊伍；請先回到待核對隊伍。'):'')+
          (!partyId&&data()?muted(data().active?'目前隊伍：'+data().active.name+'（'+(STATUS[data().active.status]||data().active.status)+'）':(towerMode?'目前沒有爬塔隊伍。':'目前沒有三人副本隊伍。')):'')+
          '<div class="sp-actions">'+button('pending-view',partyId?'查看待核對隊伍':'查看目前隊伍',{disabled:state.busy||state.loading})+button('acknowledge','我已核對結果',{disabled:state.busy||state.loading||state.stale||state.checkedPending!==pending.id})+'</div></section>';
      }
      return html;
    }
    function confirmation() {
      const c=state.confirm;if(!c)return '';
      return '<section class="sp-confirm" data-sp-confirm aria-labelledby="sp-confirm-title"><h3 id="sp-confirm-title">'+esc(c.label)+'？</h3><p>'+esc(c.details)+'</p><div class="sp-actions">'+button('confirm','確認'+c.label,{primary:true,disabled:disabled()})+button('cancel','取消')+'</div></section>';
    }
    function stamina() {
      const s=data()?.stamina;if(!s)return '';
      return '<section class="sp-summary"><strong>打寶體力 '+fmt(s.points)+'／'+fmt(s.max)+'</strong>'+muted('一般副本出發每人消耗 '+fmt(s.cost)+' 點；招募與準備不扣除。轉職試煉不消耗此體力。')+'</section>';
    }
    const reasonText=value=>typeof value==='string'?value:value?.message||'';
    const localTime=value=>Number.isFinite(Number(value))?new Date(Number(value)).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'待更新';
    function otherActivity() {
      const other=data()?.activeOtherKind;if(!other)return '';
      const canNavigate=other.ownCharacter&&['tower','dungeon'].includes(other.kind);
      return '<section class="sp-feedback" data-sp-other-kind="'+esc(other.kind)+'"><p>'+esc(reasonText(data()?.blockedReason)||'目前有其他隊伍行程，請先查看該隊伍。')+'</p>'+
        (canNavigate?button('other-kind',other.kind==='tower'?'查看目前塔隊':'查看目前副本',{disabled:state.busy}):!other.ownCharacter?button('other-character','查看角色',{disabled:state.busy}):'')+'</section>';
    }
    function towerSummary() {
      const t=data()?.tower;if(!t)return '';
      return '<section class="sp-summary" data-sp-tower-summary><span class="sp-kicker">每一步，都留下刻印</span><h3>最高通關 '+fmt(t.best)+' 層 · '+fmt(t.badges)+' 枚星穹徽記</h3>'+
        muted(t.daily?.used?'今日已使用挑戰次數；台灣時間 '+localTime(t.daily.resetAt)+' 重置。':'今日尚可挑戰一次。建立、加入與準備不扣次數，出發時才使用。')+
        muted('三個不同帳號同行，不消耗一般打寶體力。每場最長 15 分鐘；失敗或中止依已通關層數與出手紀錄結算。')+'</section>';
    }
    function towerCatalogue() {
      const areas=data()?.tower?.areas||[];
      return towerSummary()+otherActivity()+(!data()?.activeOtherKind&&data()?.blockedReason?'<p class="sp-feedback">'+esc(reasonText(data().blockedReason))+'</p>':'')+
        '<div class="sp-card-grid">'+areas.map(a=>'<article class="sp-card" data-sp-area="'+esc(a.id)+'"><span class="sp-kicker">第 '+fmt(a.startFloor)+'–'+fmt(a.endFloor)+' 層 · Lv.'+fmt(a.level)+'</span><h3>'+esc(a.name)+'</h3>'+
          muted((a.requiredBest?'需先通關第 '+fmt(a.requiredBest)+' 層。':'從第一區開始攀登。')+'本區完整通關 '+fmt(a.fullClearBadges)+' 枚徽記。')+
          (a.cooperation?.phases?.length?'<div class="sp-role-guide">'+a.cooperation.phases.map(v=>'<p>'+esc(v.name)+' '+roles(v.roles)+'</p>').join('')+'</div>':'')+
          (a.reason?muted(reasonText(a.reason)):'')+'<div class="sp-actions">'+button('create-tower','建立爬塔隊伍',{startFloor:a.startFloor,primary:true,disabled:disabled()||a.canCreate!==true})+'</div>'+
          muted('出發後依本場裝備與技能快照戰鬥。')+'</article>').join('')+'</div>';
    }
    function catalogue() {
      if(towerMode)return towerCatalogue();
      const trial=draft.tab==='trials',items=(data()?.dungeons||[]).filter(d=>!!d.trial===trial);
      const blocked=data()?.blockedReason?.message;
      return (blocked?'<p class="sp-feedback">'+esc(blocked)+'</p>':'')+(!trial?stamina():'')+
        '<div class="sp-card-grid">'+items.map(d=>{
          const level=Number(data()?.character?.level)||0,levelLocked=level<Number(d.level);
          const path=data()?.character?.classPath||'',stageLocked=d.trial&&path.length<Number(d.trial)-1;
          const reason=levelLocked?'Lv.'+d.level+' 解鎖':stageLocked?'尚未達到試煉轉職階段':'建立三人隊伍';
          return '<article class="sp-card" data-sp-dungeon="'+esc(d.id)+'"><span class="sp-kicker">'+(d.trial?'轉職試煉':'三人打寶')+' · Lv.'+fmt(d.level)+'</span><h3>'+esc(d.name)+'</h3>'+
            muted(d.trial?'首次合格通關可取得綁定的轉職證明。':'三名隊員各自結算戰利品；戰鬥中可選擇技能與隊友目標。')+
            (d.challenge?'<p class="sp-badge">強化挑戰 · 出發前備妥生命藥水</p>':'')+
            (d.cooperation?.phases?.length?'<div class="sp-role-guide">'+d.cooperation.phases.map(p=>'<p>'+esc(p.name)+' '+roles(p.roles)+'</p>').join('')+'</div>':'')+
            '<div class="sp-actions">'+button('create',reason,{dungeonId:d.id,primary:true,disabled:disabled()||!data().canCreate||levelLocked||stageLocked})+button('pool','可能戰利品',{dungeonId:d.id})+'</div>'+
            muted('建立後會在原有遊戲群組顯示招募卡。')+'</article>';
        }).join('')+'</div>';
    }
    function pool() {
      const d=data()?.dungeons?.find(v=>v.id===draft.pool);if(!d)return '';
      const skills=dropSkills(d,data().skills);
      return '<section class="sp-detail" data-sp-pool="'+esc(d.id)+'">'+button('pool-back','返回副本')+'<h3>'+esc(d.name)+' · 可能戰利品</h3>'+
        muted(d.trial?'符合轉職條件、參與出手並首次通關後，可取得綁定試煉證明。':'各隊員獨立結算。以下依目前角色列出可能獲得的技能書，實際結果以戰利品紀錄為準。')+
        (skills===null?muted('技能書掉落清單尚未取得，請更新戰況。'):skills.length?'<div class="sp-card-grid">'+skills.map(s=>'<article class="sp-card"><h4>'+esc(s.name)+'</h4><span>'+esc(s.rarity||'')+' · Lv.'+fmt(s.level)+'</span><p>'+esc(s.effect||'')+'</p></article>').join('')+'</div>':muted(d.trial?'此試煉提供轉職證明，不掉落技能書。':'目前角色在此副本沒有可獲得的技能書。'))+'</section>';
    }
    function teamCard(p) {
      const members=p.members||[];
      return '<article class="sp-card" data-sp-list-party="'+esc(p.id)+'"><span class="sp-kicker">'+esc(STATUS[p.status]||p.status)+' · '+(towerMode?'三人爬塔':p.trial?'轉職試煉':'三人副本')+'</span><h3>'+esc(p.name||(towerMode?'爬塔隊伍':'副本隊伍'))+'</h3>'+
        muted(members.length+'／3 人 · '+members.map(m=>m.name).filter(Boolean).join('、'))+
        button('view','查看隊伍',{partyId:p.id})+'</article>';
    }
    function directory() {
      const d=data()?.directory;if(!d)return '';
      return '<div class="sp-actions">'+button('directory','招募與戰鬥',{tab:'active',disabled:draft.directoryTab==='active'})+button('directory','已結束',{tab:'ended',disabled:draft.directoryTab==='ended'})+'</div>'+
        muted('共 '+fmt(d.total)+' 支隊伍 · 第 '+fmt(d.page)+'／'+fmt(Math.max(1,d.pages||1))+' 頁')+
        '<div class="sp-card-grid">'+(d.parties.length?d.parties.map(teamCard).join(''):muted('目前沒有符合條件的隊伍。'))+'</div>'+
        '<div class="sp-actions">'+button('page','上一頁',{page:Math.max(1,d.page-1),disabled:state.loading||d.page<=1})+button('page','下一頁',{page:d.page+1,disabled:state.loading||d.page>=d.pages})+'</div>';
    }
    function cooperation(p) {
      if(!p.briefing)return '';
      const c=p.cooperation;
      return '<section class="sp-section"><h3>職責與首領機制</h3>'+
        (c?'<p>'+esc(c.name)+' · '+fmt(c.cleared)+'／'+fmt(c.total)+' 已破解</p><div class="sp-roles">'+roles(c.roles)+'</div>'+
          muted(c.failed?'本階段機制失守。':c.complete?'首領護甲已解除。':c.next?'第 '+c.next.round+' 回合：'+c.next.name:'本階段尚餘 '+c.roundsLeft+' 回合。'):'')+
        '<details'+(p.status==='lobby'?' open':'')+'><summary>三人分工指南'+(p.status==='lobby'?' · '+(p.briefing.ready?'分工齊備':'請確認分工'):'')+'</summary><p>'+esc(p.briefing.guide||'')+'</p>'+
        (p.briefing.phases||[]).map(phase=>'<div class="sp-phase"><b>'+esc(phase.name)+'</b><div>'+roles(phase.roles)+'</div>'+
          (phase.assignment?muted((phase.roles||[]).map(r=>(ROLES[r]||r)+'：'+(p.members.find(m=>String(m.id)===String(phase.assignment[r]))?.name||'隊友')).join(' · ')):'')+'</div>').join('')+'</details></section>';
    }
    function skillList(p) {
      const a=p?.me?.actor;if(!a)return [];
      const native=[{id:'attack',name:'職業攻擊',target:'enemy',mp:null,native:true,effect:'依職業技能消耗魔力；不足時使用普通攻擊。沿用隊伍原有補水規則。'},{id:'defend',name:'防禦',target:'self',mp:0,effect:'本回合防禦，不消耗魔力。'}];
      const role=(p.me.roleSkills||[]).map(s=>({...s,target:'role',roleSkill:true,effect:s.description}));
      const equipped=(a.special?.loadout||[]).map(id=>data()?.skills?.find(s=>s.id===id)).filter(Boolean);
      return [...native,...role,...equipped];
    }
    const skillReason=(p,s)=>tacticReason(p,s,client.now(),ownId());
    function tactics(p) {
      const list=skillList(p);if(!list.length)return muted('這隻角色目前無法選擇戰術。');
      let selected=list.find(s=>s.id===draft.skillId)||list[0];draft.skillId=selected.id;
      const choices=targetChoices(p,selected,ownId());
      if(!choices.some(t=>t.value===draft.targetId))draft.targetId=(choices.find(t=>t.targetId===ownId())||choices[0])?.value||'';
      const chosen=choices.find(t=>t.value===draft.targetId),reason=skillReason(p,selected),sub=p.me?.submission;
      const submittedSkill=sub?list.find(s=>s.id===sub.skillId):null;
      const submittedTarget=sub?(submittedSkill&&['ally','downed_ally'].includes(submittedSkill.target)?p.members.find(m=>String(m.id)===String(sub.targetId))?.name:targetChoices(p,submittedSkill,ownId())[0]?.label):'';
      return '<section class="sp-section" data-sp-tactics><h3>第 '+fmt(p.round)+' 回合 · 我的戰術</h3>'+
        muted('未手動選擇時照原有規則自動戰鬥。這次選擇只覆蓋本回合，結算前仍可改選。')+
        (sub?'<p class="sp-feedback">本回合已選：'+esc(list.find(s=>s.id===sub.skillId)?.name||sub.skillId)+' · '+esc(submittedTarget||'依技能目標')+'</p>':'')+
        '<div class="sp-skill-grid">'+list.map(s=>{
          const r=skillReason(p,s);
          return '<button type="button" data-sp-action="choose-skill" data-skill-id="'+esc(s.id)+'" class="sp-skill'+(s.id===selected.id?' sp-selected':'')+'" aria-pressed="'+(s.id===selected.id)+'"'+(disabled()?' disabled':'')+'><strong>'+esc(s.name)+'</strong><span>'+(s.native?'依職業技能消耗；不足時普攻':(s.roleSkill?esc(ROLES[s.role]||'職責')+' · ':'')+'魔力 '+fmt(s.mp||0))+'</span><small>'+esc(r||s.effect||'')+'</small></button>';
        }).join('')+'</div><div class="sp-tactical-summary"><h4>'+esc(selected.name)+'</h4><p>'+esc(selected.effect||'')+'</p>'+
        '<label>施放目標<select name="partyTarget"'+(disabled()||choices.length<2?' disabled':'')+'>'+choices.map(t=>'<option value="'+esc(t.value)+'"'+(t.value===draft.targetId?' selected':'')+'>'+esc(t.label)+'</option>').join('')+'</select></label>'+
        (reason?muted(reason):muted('本回合使用「'+selected.name+'」，目標：'+(chosen?.label||'未選擇')+'。'))+
        '<div class="sp-actions">'+button('submit','提交第 '+p.round+' 回合',{primary:true,disabled:disabled()||!!reason||!chosen})+button('tactics-back','返回隊伍')+'</div></div></section>';
    }
    function currentParty() {
      const p=party();
      if(!p)return (towerMode?towerSummary():'')+otherActivity()+'<section class="sp-empty"><h3>'+(towerMode?'目前沒有爬塔隊伍':'目前沒有三人副本隊伍')+'</h3>'+muted(data()?.blockedReason?.message||'建立隊伍，或到大廳加入其他旅人。')+'<div class="sp-actions">'+button('tab',towerMode?'選擇登塔區域':'選擇副本',{tab:catalogueTab,primary:true})+button('tab','前往組隊大廳',{tab:'lobby'})+'</div></section>'+history();
      const me=p.me,member=!!me&&!me.left,combat=p.status==='combat',finished=['won','lost','ended'].includes(p.status);
      const canStart=member&&me.leader&&p.status==='lobby'&&p.members.length===3&&p.members.every(m=>m.ready)&&p.briefing?.ready!==false&&p.stamina?.ready!==false&&!p.expired&&(!towerMode||!data()?.tower?.daily?.used);
      let actions='';
      if(p.status==='lobby'){
        if(member)actions+=button('ready',me.ready?'取消準備':'我已準備',{primary:true,disabled:disabled()||p.expired})+
          (me.leader?button('start','全員準備 · 出發',{disabled:disabled()||!canStart}):'')+
          button('leave',me.leader?'結束招募':'離開隊伍',{danger:!!me.leader,disabled:disabled()||p.expired});
        else actions+=button('join',p.members.length>=3?'隊伍已滿':'加入隊伍',{partyId:p.id,primary:true,disabled:disabled()||(towerMode?p.canJoin!==true:!data().canCreate)||p.members.length>=3||p.expired});
      }
      if(combat&&member)actions+=button('tactics','選擇戰術',{primary:true,disabled:disabled()||Number(me.actor?.hp)<=0})+button(me.leader?'end':'leave',me.leader?'中止全隊挑戰':'離隊並中止挑戰',{danger:true,disabled:disabled()});
      if(finished&&member&&p.canReward)actions+=button('reward','領取戰利品',{primary:true,disabled:disabled()});
      if(finished&&member&&!p.nextPartyId&&!p.disbanded)actions+=button('leave',me.leader?'結束隊伍':'離開隊伍',{disabled:disabled()});
      if(p.nextPartyId)actions+=button('view','查看下一場戰況',{partyId:p.nextPartyId});
      actions+=button('tab','返回大廳',{tab:'lobby'});
      return '<section data-sp-party="'+esc(p.id)+'" data-sp-status="'+esc(p.status)+'" data-sp-round="'+fmt(p.round)+'"><div class="sp-summary"><span class="sp-kicker">'+esc(STATUS[p.status]||p.status)+' · '+p.members.length+'／3 人</span><h3>'+esc(p.name)+'</h3>'+
        (combat?'<p>第 '+fmt(p.round)+'／'+fmt(p.roundLimit||40)+' 回合</p>':'')+
        (towerMode&&p.towerProgress?'<div data-sp-tower-progress><p>本場已通關 '+fmt(p.towerProgress.cleared)+'／'+fmt(Number(p.towerProgress.endFloor)-Number(p.towerProgress.startFloor)+1)+' 層 · 對應 '+fmt(p.towerProgress.badges)+' 枚徽記</p>'+
          (p.towerProgress.challengeEndsAt?muted('本場最晚結算：台灣時間 '+localTime(p.towerProgress.challengeEndsAt)):'')+'</div>':'')+
        (p.pendingSettlement||p.expired?muted('等待戰況更新；最新結算完成後會顯示在這裡。'):'')+'</div>'+
        (p.enemy?'<article class="sp-enemy"><h4>'+esc(p.enemy.name||'目前敵人')+'</h4>'+meter('生命',p.enemy.hp,p.enemy.maxHp)+
          (p.challenge?.nextAttack?.windup?muted('即將蓄力重擊 · '+(p.challenge.nextAttack.interruptible?'可用技能打斷':'請準備護盾或防禦')):'')+'</article>':'')+
        '<div class="sp-members">'+p.members.map(m=>'<article class="sp-member'+(m.left?' sp-departed':'')+'" data-sp-member="'+esc(m.id)+'"><h4>'+esc(m.name)+(String(m.id)===ownId()?' · 你':'')+'</h4><p>Lv.'+fmt(m.level)+(m.left?' · 已離隊':'')+'</p>'+
          (p.status==='lobby'?'<p class="sp-badge">'+(m.ready?'已準備':'等待準備')+'</p>':meter('生命',m.hp,m.maxHp)+meter('魔力',m.mp,m.maxMp,'mp'))+
          (Number(m.hp)===0&&combat?'<strong class="sp-down">倒地</strong>':'')+
          '<div class="sp-roles">'+roles(m.roles)+'</div>'+
          (m.stamina?muted('體力 '+fmt(m.stamina.points)+'／'+fmt(m.stamina.max)):'')+
          (m.collectionBlessing?muted('祝福 · '+m.collectionBlessing.name):'')+
          (m.guardian?muted('守護 · '+(m.guardian.typeName||m.guardian.name||'')):'')+'</article>').join('')+'</div>'+
        (p.stamina?.ready===false?'<p class="sp-feedback">有隊員體力不足，暫時不能出發。</p>':'')+
        (combat&&Number(me?.actor?.hp)<=0?muted('你已倒地，等待隊友復活。'):'')+
        '<div class="sp-actions">'+actions+'</div>'+(towerMode&&!member&&p.joinReason?muted(reasonText(p.joinReason)):'')+
        (draft.tactics&&combat&&member?tactics(p):'')+
        (me?.reward?'<section class="sp-summary"><h3>已取得戰利品</h3><p>'+esc(rewardText(me.reward.items))+'</p></section>':finished&&member&&p.rewardReason?muted(typeof p.rewardReason==='object'?p.rewardReason.message:p.rewardReason):'')+
        cooperation(p)+partyDrops()+
        '<details class="sp-section"><summary>最近戰況</summary><ol class="sp-log">'+(p.log||[]).slice(0,20).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ol></details></section>'+history();
    }
    function partyDrops() {
      const rows=data()?.drops||[];if(!rows.length)return '';
      return '<section class="sp-section"><h3>隊伍戰利品</h3>'+rows.map(row=>'<article class="sp-drop"><strong>'+esc(row.name||'隊員')+(String(row.characterId)===ownId()?' · 你':'')+'</strong><p>'+esc(row.received?rewardText(row.items):'尚未領取戰利品')+'</p></article>').join('')+'</section>';
    }
    function history() {
      const rows=(data()?.history||[]).filter(p=>p.id!==party()?.id);if(!rows.length)return '';
      return '<details class="sp-section"><summary>最近參與的隊伍</summary><div class="sp-card-grid">'+rows.slice(0,10).map(teamCard).join('')+'</div></details>';
    }
    function cancelPendingReveal() {
      if(pendingRevealFrame!==null)globalThis.cancelAnimationFrame?.(pendingRevealFrame);
      pendingRevealFrame=null;pendingRevealId=null;
    }
    function revealPendingOnce() {
      const waiting=client.pending();
      if(!waiting){cancelPendingReveal();return;}
      if(state.busy||state.loading||waiting.id===revealedPendingId||typeof globalThis.requestAnimationFrame!=='function')return;
      if(pendingRevealFrame!==null&&pendingRevealId===waiting.id)return;
      cancelPendingReveal();const id=waiting.id;pendingRevealId=id;
      pendingRevealFrame=globalThis.requestAnimationFrame(()=>{
        if(pendingRevealId!==id)return;
        pendingRevealFrame=null;pendingRevealId=null;
        if(disposed||!client.current()||!root.isConnected||root.ownerDocument?.hidden||state.busy||state.loading||client.pending()?.id!==id)return;
        const panel=root.querySelector?.('[data-sp-pending]'),entry=root.querySelector?.('[data-sp-action="pending-view"]');
        if(!panel||!entry||entry.disabled)return;
        revealedPendingId=id;savedFocus=null;
        panel.scrollIntoView?.({block:'nearest',behavior:'auto'});
        entry.focus?.({preventScroll:true});
      });
    }
    function paint() {
      if(disposed||!client.current())return;
      const top=root.scrollTop,doc=root.ownerDocument,active=doc?.activeElement;
      if(root.contains?.(active))savedFocus={name:active?.name,action:active?.dataset?.spAction,skill:active?.dataset?.skillId,party:active?.dataset?.partyId,dungeon:active?.dataset?.dungeonId,tab:active?.dataset?.tab,page:active?.dataset?.page,pending:!!active?.closest?.('[data-sp-pending]')};
      else if(active&&active!==doc?.body&&active!==doc?.documentElement)savedFocus=null;
      const focus=savedFocus;
      root.innerHTML='<div class="sp-panel" data-sp-kind="'+kind+'" data-sp-ready="'+(!state.loading&&!state.stale&&!!data()?'1':'0')+'" data-sp-tab="'+draft.tab+'" aria-busy="'+(state.loading||state.busy)+'">'+
        '<header class="sp-header"><div><h2>'+(towerMode?'攜手登塔':'結伴出征')+'</h2><p>'+esc(data()?.character?.name||host.getActor?.()?.name||'')+'</p></div>'+button('refresh',state.loading?'更新中…':'更新戰況',{disabled:state.loading||state.busy})+'</header>'+
        '<nav class="sp-tabs" aria-label="'+(towerMode?'爬塔與隊伍':'副本與隊伍')+'">'+tabs.map(([key,label])=>button('tab',label,{tab:key,disabled:state.busy,extra:' aria-pressed="'+(draft.tab===key)+'"'})).join('')+'</nav>'+
        notices()+confirmation()+(!data()?muted('正在讀取隊伍…'):draft.pool?pool():draft.tab==='current'?currentParty():draft.tab==='lobby'?directory():catalogue())+
        '<div class="sp-footer">'+button('skills','配置特殊技能')+button('supplies','準備藥水')+(towerMode?button('tower-workshop','塔印工坊'):'')+'</div></div>';
      root.scrollTop=top;
      if(state.confirm&&focusConfirm){focusConfirm=false;root.scrollTop=0;root.querySelector?.('[data-sp-confirm]')?.scrollIntoView?.({block:'nearest'});root.querySelector?.('[data-sp-action="cancel"]')?.focus?.({preventScroll:true});}
      else if(focus){const node=[...root.querySelectorAll?.('button,select')||[]].find(n=>focus.name?n.name===focus.name:n.dataset.spAction===focus.action&&n.dataset.skillId===focus.skill&&n.dataset.partyId===focus.party&&n.dataset.dungeonId===focus.dungeon&&n.dataset.tab===focus.tab&&n.dataset.page===focus.page&&!!n.closest?.('[data-sp-pending]')===focus.pending);node?.focus?.({preventScroll:true});}
      revealPendingOnce();
    }
    function prepare(action,body,label,details){focusConfirm=true;client.prepare(action,body,label,details);}
    async function click(event) {
      const b=event.target?.closest?.('[data-sp-action]');if(!b||b.disabled||!root.contains?.(b)||!client.current())return;
      const action=b.dataset.spAction,p=party();
      if(action==='refresh')return refresh();
      if(action==='cancel')return client.cancel();
      if(action==='confirm')return client.submit();
      if(action==='acknowledge')return client.acknowledge();
      if(action==='pending-view'){
        const pending=client.pending();if(!pending||state.busy||state.loading)return;
        draft.tab='current';draft.partyId=pending.body.partyId||'';draft.pool='';draft.tactics=pending.body.op==='submit';
        if(pending.body.skillId)draft.skillId=pending.body.skillId;
        if(pending.body.targetId)draft.targetId=String(pending.body.targetId);
        client.cancel();paint();return refresh();
      }
      if(action==='tower-workshop'){if(!state.busy)host.navigate?.('tower-imprint',{});return;}
      if(action==='other-character'){if(!state.busy)host.navigate?.('characters',{});return;}
      if(action==='other-kind'){const other=data()?.activeOtherKind;if(!state.busy&&other?.ownCharacter&&['dungeon','tower'].includes(other.kind))host.navigate?.(other.kind==='tower'?'tower':'party',{tab:'current',partyId:other.id});return;}
      if(action==='skills'||action==='supplies'){if(!state.busy)host.navigate?.(action==='skills'?'skills':'supplies',{});return;}
      if(state.busy)return;
      if(action==='tab'){if(!tabs.some(([key])=>key===b.dataset.tab))return;draft.tab=b.dataset.tab;draft.partyId='';draft.tactics=false;draft.pool='';client.cancel();paint();return refresh();}
      if(action==='view'){draft.tab='current';draft.partyId=b.dataset.partyId;draft.tactics=false;draft.pool='';client.cancel();paint();return refresh();}
      if(action==='directory'){draft.directoryTab=b.dataset.tab==='ended'?'ended':'active';draft.page=1;return refresh();}
      if(action==='page'){draft.page=Math.max(1,Number(b.dataset.page)||1);return refresh();}
      if(action==='pool'){draft.pool=b.dataset.dungeonId;return paint();}
      if(action==='pool-back'){draft.pool='';return paint();}
      if(action==='tactics'){draft.tactics=true;return paint();}
      if(action==='tactics-back'){draft.tactics=false;return paint();}
      if(action==='choose-skill'){draft.skillId=b.dataset.skillId;draft.targetId='';return paint();}
      const reason=client.readiness();if(reason)return client.feedback(reason,true);
      if(action==='create-tower'){
        const a=data()?.tower?.areas?.find(v=>v.startFloor===Number(b.dataset.startFloor));
        if(!towerMode||!a||a.canCreate!==true)return client.feedback(reasonText(a?.reason)||'目前不符合登塔條件。',true);
        return client.execute('party/create',{kind:'tower',startFloor:a.startFloor},'建立「'+a.name+'」塔隊');
      }
      if(action==='create'){
        if(towerMode)return;
        const d=data().dungeons.find(v=>v.id===b.dataset.dungeonId);
        if(!d||!data().canCreate||Number(data().character.level)<Number(d.level)||d.trial&&String(data().character.classPath||'').length<Number(d.trial)-1)return client.feedback(data().blockedReason?.message||'目前不符合副本條件。',true);
        return client.execute('party/create',{kind:'dungeon',dungeonId:d.id},'建立「'+d.name+'」隊伍');
      }
      if(action==='join'){
        if(!p||p.id!==b.dataset.partyId||p.status!=='lobby'||p.expired||p.members.length>=3||(towerMode?p.canJoin!==true:!data().canCreate))return client.feedback(reasonText(p?.joinReason)||'這支隊伍目前無法加入，請更新戰況。',true);
        return client.execute('party/action',{partyId:p.id,op:'join'},'加入隊伍');
      }
      if(!p||!p.me||p.me.left)return;
      if(action==='ready'&&p.status==='lobby'&&!p.expired)return client.execute('party/action',{partyId:p.id,op:'ready',ready:!p.me.ready},p.me.ready?'取消準備':'設定準備');
      if(action==='start'){
        if(!p.me.leader||p.status!=='lobby'||p.expired||p.members.length!==3||p.members.some(m=>!m.ready)||p.briefing?.ready===false||p.stamina?.ready===false||towerMode&&data()?.tower?.daily?.used)return;
        return prepare('party/action',{partyId:p.id,op:'start'},'開始挑戰',p.name+'。'+(towerMode?'每位隊員使用今日一次登塔機會；出發後不退還次數，不消耗一般打寶體力。':p.trial?'轉職試煉不消耗打寶體力。':'每位隊員消耗 '+fmt(p.stamina?.cost??data().stamina?.cost)+' 點打寶體力；失敗或中止不退還。')+'出發後沿用本次裝備與技能配置。');
      }
      if(action==='leave'||action==='end'){
        const combat=p.status==='combat',leader=!!p.me.leader;
        if(action==='end'&&!leader)return;
        const label=combat?'中止全隊挑戰':leader?(p.status==='lobby'?'結束招募':'結束隊伍'):'離開隊伍';
        const body={partyId:p.id,op:action};
        if(!combat&&!leader)return client.execute('party/action',body,label);
        return prepare('party/action',body,label,combat?(towerMode?'這個操作會中止整支三人隊伍的挑戰。出發已使用的次數不退還；可領戰果依本場規則、實際通關層數與出手紀錄結算。':'這個操作會中止整支三人隊伍的挑戰。已消耗的體力不退還，也不會發放未完成的通關獎勵。'):p.status==='lobby'?'隊長結束招募會解散這支隊伍，隊友需要重新組隊。':'本次已取得的戰利品與紀錄會保留。');
      }
      if(action==='reward'){if(!p.canReward)return;return client.execute('party/reward',{partyId:p.id},'領取戰利品');}
      if(action==='submit'){
        const s=skillList(p).find(v=>v.id===draft.skillId);if(!s)return;
        const blocked=skillReason(p,s);if(blocked)return client.feedback(blocked,true);
        const target=targetChoices(p,s,ownId()).find(v=>v.value===draft.targetId);if(!target)return client.feedback('請重新選擇有效目標。',true);
        return client.execute('party/action',{partyId:p.id,op:'submit',round:p.round,skillId:s.id,targetId:target.targetId},'提交第 '+p.round+' 回合「'+s.name+'」');
      }
    }
    function change(event){if(!client.current()||!root.contains?.(event.target))return;if(event.target.name==='partyTarget'){draft.targetId=event.target.value;paint();}}
    const visibility=()=>{if(!root.ownerDocument?.hidden&&client.current()&&!state.busy&&!state.loading&&!state.confirm)void refresh();};
    root.addEventListener('click',click);root.addEventListener('change',change);root.ownerDocument?.addEventListener?.('visibilitychange',visibility);
    timer=globalThis.setInterval?.(()=>{if(client.current()&&!root.ownerDocument?.hidden&&!state.busy&&!state.loading&&!state.confirm&&root.ownerDocument?.activeElement?.name!=='partyTarget')void refresh();},5000);
    paint();void refresh();
    return {refresh,update:scene=>client.update(scene),
      handleBack(){if(state.confirm){client.cancel();return true;}if(draft.pool){draft.pool='';paint();return true;}if(draft.tactics){draft.tactics=false;paint();return true;}if(draft.partyId){draft.partyId='';draft.tab='lobby';void refresh();return true;}return false;},
      dispose(){if(disposed)return;disposed=true;cancelPendingReveal();client.dispose();if(timer!=null)globalThis.clearInterval?.(timer);root.removeEventListener('click',click);root.removeEventListener('change',change);root.ownerDocument?.removeEventListener?.('visibilitychange',visibility);}
    };
  }
  globalThis.RpgSceneParty = {createClient,mount,targetChoices,dropSkills,tacticReason};
})();
