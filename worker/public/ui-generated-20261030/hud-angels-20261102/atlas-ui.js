/* Persistent Atlas workspace. All game data and mutations go through the existing host. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => Number.isFinite(Number(value)) && value !== null && value !== undefined ? new Intl.NumberFormat('zh-TW').format(Number(value)) : '—';
  const entries = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).map(([id, item]) => ({id, ...item})) : [];
  const idOf = item => String(item?.id ?? item?.key ?? '');
  const textOf = item => item?.description || item?.desc || item?.summary || '';
  const contextKey = context => `${context?.realmId || ''}:${context?.characterId || ''}:${context?.epoch || 0}`;
  const groups = Object.freeze([
    {id:'expedition', name:'出征', subtitle:'星圖與冒險', icon:'map'},
    {id:'build', name:'構築', subtitle:'技能與裝備', icon:'build'},
    {id:'workshop', name:'工坊', subtitle:'鍛造與補給', icon:'forge'},
    {id:'companions', name:'天使與旅章', subtitle:'守護與輪迴', icon:'angel'},
    {id:'social', name:'社交交易', subtitle:'組隊與市集', icon:'social'},
    {id:'records', name:'圖鑑紀錄', subtitle:'收藏與戰報', icon:'book'}
  ]);
  const paths = {
    map:'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zm6-3v15m6-12v15',
    build:'M12 3v5m0 8v5M3 12h5m8 0h5M5.5 5.5l3.5 3.5m6 6 3.5 3.5M5.5 18.5 9 15m6-6 3.5-3.5M12 8l4 4-4 4-4-4 4-4z',
    forge:'m14 3 7 7-4 4-7-7 4-4zm-3 9L3 20m1-3 3 3M3 8h4m-2-2v4',
    angel:'M12 8c-2-5-6-5-9-5 0 7 3 12 9 14 6-2 9-7 9-14-3 0-7 0-9 5zm0 0v13M4 8l5 4m11-4-5 4',
    social:'M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9 1a2.5 2.5 0 1 0 0-5M3 21v-4a6 6 0 0 1 12 0v4m3-7a4 4 0 0 1 4 4v3',
    book:'M12 5c-3-2-6-2-9-1v16c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zm0 0v16',
    close:'m6 6 12 12M6 18 18 6', refresh:'M20 8a8 8 0 1 0 0 8m0-13v5h-5', arrow:'M4 12h16m-6-6 6 6-6 6'
  };
  const icon = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key] || paths.map}"/></svg>`;
  const errorText = error => error?.code === 'context_changed' || error?.code === 'request_cancelled' ? '' : error?.message || '資料暫時無法同步，請稍後重試。';

  function createClient(host, changed = () => {}) {
    const state = {context:null, catalog:null, snapshot:null, quests:null, questError:'', questsLoading:false, draft:null, pending:null, loading:false, busy:false, error:'', syncedAt:null};
    let generation = 0, flight = null, controller = null, questFlight = null, questController = null;
    const notify = () => changed(state);
    const current = (version, key) => version === generation && key === contextKey(state.context);
    function setContext(context) {
      if (contextKey(context) === contextKey(state.context)) { state.context = context; return false; }
      generation++; controller?.abort(); questController?.abort(); controller = null; flight = null; questController = null; questFlight = null;
      const saved=context?.characterId?host.loadPendingOperation?.(context):null;
      const pending=saved&&['atlas/configure','atlas/start','atlas/settle','atlas/stop','atlas/craft','atlas/quests/claim','atlas/talents/action'].includes(saved.action)&&saved.payload&&typeof saved.payload==='object'?saved:null;
      Object.assign(state, {context, catalog:null, snapshot:null, quests:null, questError:'', questsLoading:false, draft:null, pending, loading:false, busy:false, error:'', syncedAt:null});
      notify(); return true;
    }
    function checkContext(data) {
      if (String(data?.realmId) !== String(state.context.realmId) || String(data?.characterId) !== String(state.context.characterId)) throw Error('回傳的角色或環境不符，請重新同步。');
    }
    function acceptQuests(data) {checkContext(data);if(!Array.isArray(data.quests))throw Error('委託資料尚未完整載入。');state.quests=data;state.questError='';if(state.snapshot&&data.materials)state.snapshot={...state.snapshot,materials:{...data.materials}};}
    function accept(data) {
      checkContext(data);
      state.snapshot = data.talentOnly?{...state.snapshot,talents:data.talents}:data;
      state.syncedAt = Number.isFinite(Number(data.now)) ? Number(data.now) : null;
      if (!state.draft) state.draft = {...(data.profile || {}), supportIds:[...(data.profile?.supportIds || [])]};
    }
    async function refresh() {
      if (!state.context?.characterId || state.busy) return null;
      if (flight) return flight;
      const version = generation, key = contextKey(state.context), abort = new AbortController();
      controller = abort; state.loading = true; state.error = ''; notify();
      const pending = (async () => {
        try {
          const catalog = await host.request('atlas/catalog', {}, {signal:abort.signal});
          if (!current(version, key)) return null;
          if (!catalog?.catalog) throw Error('星圖資料尚未完整載入，請重新同步。');
          state.catalog = catalog.catalog;
          if (state.catalog.enabled === false) return null;
          const snapshot = await host.request('atlas/status', {}, {signal:abort.signal});
          if (!current(version, key)) return null;
          accept(snapshot); return snapshot;
        } catch (error) {
          if (current(version, key)) state.error = errorText(error);
          return null;
        } finally {
          if (current(version, key)) {state.loading = false; flight = null; controller = null; notify();}
        }
      })();
      flight = pending; return pending;
    }
    async function refreshQuests() {
      if(!state.context?.characterId||state.context.realmId!=='permanent'||state.catalog?.enabled===false||state.busy)return null;
      if(questFlight)return questFlight;
      const version=generation,key=contextKey(state.context),abort=new AbortController();questController=abort;state.questsLoading=true;state.questError='';notify();
      const pending=(async()=>{try{const data=await host.request('atlas/quests',{}, {signal:abort.signal});if(!current(version,key))return null;acceptQuests(data);return data;}catch(error){if(current(version,key))state.questError=errorText(error);return null;}finally{if(current(version,key)){state.questsLoading=false;questFlight=null;questController=null;notify();}}})();questFlight=pending;return pending;
    }
    async function operate(action, payload = {}) {
      if (state.busy || !state.context?.characterId) return null;
      if(state.pending&&host.mutationKey(state.pending.action,state.pending.payload)!==host.mutationKey(action,payload)){state.error='上一筆操作的結果仍待確認，請先確認上次操作。';notify();return null;}
      generation++; controller?.abort(); questController?.abort(); controller = null; flight = null; questController = null; questFlight = null; state.loading = false;state.questsLoading=false;
      const version = generation, scope = contextKey(state.context), key = host.mutationKey(action, payload);
      state.pending={action,payload:{...payload}};host.savePendingOperation?.(state.context,state.pending);
      state.busy = true; state.error = ''; notify();
      try {
        const requestId=host.pendingRequestId(key);
        let data = await host.request(action, {...payload, requestId});
        if (!current(version, scope)) return null;
        if(action==='atlas/quests/claim')acceptQuests(data);else accept(data);
        if(action==='atlas/settle'||action==='atlas/stop')for(let chunk=1;chunk<16&&data.run?.status==='running'&&data.run?.progress?.catchingUp;chunk++){
          notify();data=await host.request('atlas/settle',{runId:payload.runId,requestId});
          if(!current(version,scope))return null;accept(data);
        }
        host.clearPendingRequest(key);state.pending=null;host.savePendingOperation?.(state.context,null);
        if (action === 'atlas/configure') state.draft = {...data.profile, supportIds:[...(data.profile?.supportIds || [])]};
        await host.refresh?.();
        return current(version, scope) ? data : null;
      } catch (error) {
        if (current(version, scope)) {
          state.error = errorText(error);
          if (!error?.uncertain && error?.status >= 400 && error?.status < 500) {host.clearPendingRequest(key);state.pending=null;host.savePendingOperation?.(state.context,null);}
        }
        return null;
      } finally {
        if (current(version, scope)) {state.busy = false; notify();}
      }
    }
    return {state, setContext, refresh, refreshQuests, operate, dispose(){generation++;controller?.abort();questController?.abort();flight=null;questFlight=null;}};
  }

  const routeCards = (rows) => `<div class="atlas-route-grid">${rows.map(([route, name, detail, pict]) => `<button type="button" class="atlas-route-card" data-atlas-route="${esc(route)}">${icon(pict || 'arrow')}<span><strong>${esc(name)}</strong><small>${esc(detail)}</small></span><b aria-hidden="true">↗</b></button>`).join('')}</div>`;
  const empty = (title, detail, action = '') => `<div class="atlas-empty"><span aria-hidden="true">◇</span><h3>${esc(title)}</h3><p>${esc(detail)}</p>${action}</div>`;
  const statusNames = {running:'探索中',completed:'已完成',settled:'已結算',stopped:'已停止',failed:'探索結束',expired:'已達派遣時限',ready:'可結算'};
  function progressPercent(run) {
    const ratio = run?.progress?.ratio;
    return Number.isFinite(ratio) ? Math.max(0, Math.min(100, ratio * 100)) : 0;
  }
  function progressLabel(run) {
    const maps = run?.queueMode === 'duration' ? `已完成 ${number(run.completedMaps)} 張星圖 · 持續探索至派遣時間結束` : Number.isFinite(run?.mapCount) ? `${number(run.completedMaps)} / ${number(run.mapCount)} 張星圖` : '探索進度待同步';
    return `${maps}${run?.progress?.catchingUp ? ' · 離線進度仍在結算，請繼續同步' : ''}`;
  }
  function reportHtml(report, catalog) {
    if (!report) return empty('還沒有探索戰報', '完成或結算一趟星圖後，這裡會顯示實際戰果。');
    const fields = [['擊殺',report.kills],['倒地',report.deaths],['經驗',report.exp],['金幣',report.gold],['生命藥水消耗',report.used?.hp],['魔力藥水消耗',report.used?.mp]];
    const visible = fields.filter(([,value]) => value !== undefined && value !== null);
    const reasons = {completed:'已完成設定的探索張數',queue_completed:'已完成設定的探索張數',duration:'已達派遣時間',duration_reached:'已達派遣時間',time_limit:'已達派遣時間',stopped:'已停止探索',player_stopped:'已依停止時點結算並退還剩餘補給',dead:'角色倒地，探索結束',hp_depleted:'角色倒地，探索結束',death:'角色倒地，探索結束'};
    const materials = Object.entries(report.materials || {}).filter(([,value]) => Number(value) > 0);
    return `<div class="atlas-report-grid">${visible.map(([label,value]) => `<div><small>${esc(label)}</small><strong>${number(value)}</strong></div>`).join('')}</div>${materials.length ? `<div class="atlas-materials">${materials.map(([id,value]) => `<span>${esc(entries(catalog?.materials).find(item=>idOf(item)===id)?.name || id)} <b>+${number(value)}</b></span>`).join('')}</div>` : ''}${report.reason ? `<p class="atlas-note">${esc(reasons[report.reason] || report.reason)}</p>` : ''}${!visible.length ? '<p class="atlas-note">這趟戰報已保存，詳細結果待同步。</p>' : ''}`;
  }

  function mount(host) {
    let context = null, panel = null, lastPanelKey = '', focusReturn = null, disposed = false;
    let scrollLocked = false, previousOverflow = '', legacyFocusReturn = null;
    let draftRun = {}, draftCraft = {}, draftScope = '', poll = null,talentSelected=null,talentZoom=90,talentEffectsReviewed=false,talentConfirming=false;
    let gearbookView=null;
    // /classic-next: only the floating Atlas panels; the classic shell keeps #view, no workspace, no timed refresh.
    const overlayOnly=host.overlayOnly===true;
    let talentPreview=null,talentPreviewLoading=false,talentPreviewSeq=0,talentPreviewAbort=null;
    const app = document.getElementById('app'), view = document.getElementById('view');
    const root = document.createElement('section'); root.id = 'atlas-world'; root.setAttribute('aria-label','星穹旅誌星圖營地'); root.hidden = true;
    root.innerHTML = `<div class="atlas-landscape" aria-hidden="true"></div><div class="atlas-vignette" aria-hidden="true"></div>
      <header class="atlas-topbar"><button class="atlas-brand" type="button" data-atlas-home><span>✦</span><span><small>STAR JOURNAL</small><strong>星穹旅誌</strong></span></button><div class="atlas-environment"><label for="atlas-realm">旅程環境</label><select id="atlas-realm" aria-label="切換永久或賽季環境"></select><span data-atlas-season></span></div><button class="atlas-character-button" type="button" data-atlas-character>選擇角色</button></header>
      <div class="atlas-scene"><div class="atlas-location"><small>ATLAS OF THE STARS</small><h1>你的下一段旅程</h1><p data-atlas-location>選擇角色，展開星圖</p></div><div class="atlas-actor" data-atlas-actor></div><aside class="atlas-tracker" aria-label="目前探索進度"></aside></div>
      <div class="atlas-character-bar" data-atlas-stats></div><div class="atlas-shortcuts"><button type="button" data-atlas-open-talents>✧ 天賦星盤</button><button type="button" data-atlas-open-growth>✦ 冒險進程</button><button type="button" data-atlas-direct="guardian:summon">✦ 召喚天使</button><button type="button" data-atlas-direct="fate">◇ 命運旅章</button><span data-atlas-sync role="status"></span></div>
      <nav class="atlas-nav" aria-label="六大系統">${groups.map(group => `<button type="button" data-atlas-group="${group.id}">${icon(group.icon)}<span><strong>${group.name}</strong><small>${group.subtitle}</small></span></button>`).join('')}</nav><footer class="atlas-world-credit">Game Producer · ミカサ</footer>`;
    if(!overlayOnly)app.prepend(root);
    const legacy = document.createElement('section'); legacy.id = 'atlas-legacy'; legacy.hidden = true; legacy.setAttribute('aria-label','遊戲功能');legacy.setAttribute('role','dialog');legacy.setAttribute('aria-modal','true');
    legacy.innerHTML = `<header class="atlas-panel-header"><div><small>STAR JOURNAL</small><h2 data-atlas-legacy-title>冒險</h2></div><button type="button" class="atlas-close" data-atlas-legacy-close aria-label="返回營地">${icon('close')}</button></header>`;
    if(!overlayOnly){view.before(legacy); legacy.append(view);}
    const legacyBackdrop=document.createElement('div');legacyBackdrop.className='atlas-legacy-backdrop';legacyBackdrop.hidden=true;legacyBackdrop.setAttribute('aria-hidden','true');legacy.before(legacyBackdrop);
    const overlay = document.createElement('section'); overlay.id = 'atlas-panel'; overlay.hidden = true; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
    overlay.innerHTML = `<div class="atlas-panel-backdrop" data-atlas-close></div><div class="atlas-panel-card" tabindex="-1"><header class="atlas-panel-header"><div><small data-atlas-panel-eyebrow>星圖營地</small><h2 id="atlas-panel-title"></h2></div><button type="button" class="atlas-close" data-atlas-close aria-label="關閉並返回營地">${icon('close')}</button></header><div class="atlas-panel-body"></div></div>`;
    overlay.setAttribute('aria-labelledby','atlas-panel-title'); document.body.append(overlay);
    const client = createClient(host, () => paint());
    let chatStorage;try{chatStorage=window.sessionStorage;}catch{}
    const chatClient=window.RpgSceneChatUI?.createClient({...host,storage:chatStorage},()=>paint());
    let chatPanel=null;
    const chatLauncher=document.createElement('button');chatLauncher.type='button';chatLauncher.className='scene-chat-launcher';chatLauncher.innerHTML='<b>聊天</b><span>世界與隊伍頻道</span>';root.querySelector('.atlas-shortcuts').after(chatLauncher);chatLauncher.onclick=()=>open('chat');
    const refreshAll=async()=>{await client.refresh();return client.refreshQuests();};
    const operate=async(action,payload)=>{const data=await client.operate(action,payload);if(data){if(action==='atlas/quests/claim')void refreshAll();else void client.refreshQuests();}return data;};
    const get = selector => root.querySelector(selector);
    const selectedRealm = () => context?.realms?.find(realm => realm.id === context.realmId);
    const character = () => context?.me?.character;
    const running = () => client.state.snapshot?.run?.status === 'running';
    const canStart = () => client.state.catalog?.canStart !== false && client.state.snapshot?.canStart !== false;
    const validCharacter = () => !!character() && !context?.choosing && !context?.creating;

    function syncWindowState() {
      const visible=!overlay.hidden||!legacy.hidden;
      root.inert=visible;
      if(visible&&!scrollLocked){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';scrollLocked=true;}
      else if(!visible&&scrollLocked){document.body.style.overflow=previousOverflow;scrollLocked=false;}
    }

    function close() {
      gearbookView?.dispose();gearbookView=null;panel = null; overlay.hidden = true; lastPanelKey = '';syncWindowState();
      if (focusReturn?.isConnected) focusReturn.focus({preventScroll:true}); focusReturn = null;
      paintNav();
    }
    function open(name) {
      if (!groups.some(group => group.id === name) && !['talents','chat','progression','gearbook','recovery'].includes(name) && !(name==='quests'&&context.realmId==='permanent')) return;
      if (!validCharacter()) {host.chooseCharacter(); return;}
      if (!overlayOnly&&context.tab !== 'atlas') host.home();
      if(name!==panel||!['gearbook','recovery'].includes(name)){gearbookView?.dispose();gearbookView=null;}focusReturn = document.activeElement; panel = name; lastPanelKey = ''; overlay.hidden = false;syncWindowState();overlay.querySelector('.atlas-panel-body').scrollTop=0;
      paint(); overlay.querySelector('.atlas-panel-card').focus({preventScroll:true});
      if(name==='chat')void chatClient?.refresh();else if (name==='quests')void client.refreshQuests();else if (['expedition','build','workshop','records','talents','progression'].includes(name)) void refreshAll();
    }
    function route(name) {close(); host.openRoute(name);}
    function paintNav() {
      root.querySelectorAll('[data-atlas-group]').forEach(button => {const on=button.dataset.atlasGroup===panel;button.classList.toggle('active',on);button.setAttribute('aria-expanded',String(on));});
    }
    function questPreview() {
      if(context.realmId!=='permanent'||!validCharacter())return '';
      const state=client.state,quests=state.quests?.quests||[],next=quests.find(item=>item.claimable)||quests.find(item=>item.category==='tutorial'&&!item.claimed)||quests.find(item=>!item.claimed&&!item.locked&&(!item.expiresAt||item.expiresAt>state.quests.now)),claimable=quests.filter(item=>item.claimable).length;
      if(state.catalog?.enabled===false)return '<div class="atlas-quest-preview"><small>永久世界委託</small><p>新星圖開放後，可查看教學與長期目標。</p></div>';
      return `<div class="atlas-quest-preview"><small>永久世界委託${claimable?' · '+number(claimable)+' 項可領獎':''}</small><strong>${esc(next?.title|| (state.questsLoading?'正在讀取下一個目標':state.questError?'委託暫未同步':'查看教學與長期目標'))}</strong>${next?`<p>${number(next.progress)} / ${number(next.target)} ${esc(next.unit||'')} ${next.claimable?'· 已達成':''}</p>`:''}<button type="button" data-atlas-open-quests ${state.busy?'disabled':''}>${claimable?'查看與領取獎勵':'查看任務與教學'} ${icon('arrow')}</button></div>`;
    }
    function paintScene() {
      if (!context) return;
      const c = character(), statsData = context.me?.stats, realm = selectedRealm(), realms = context.realms || [], state = client.state;
      const select = get('#atlas-realm'), options = realms.map(item => `<option value="${esc(item.id)}" ${item.id===context.realmId?'selected':''} ${item.available===false?'disabled':''}>${esc(item.name)}${item.available===false?' · 尚未開放':''}</option>`).join('');
      if (select.dataset.signature !== options) {select.innerHTML=options || '<option>正在讀取環境…</option>';select.dataset.signature=options;}
      select.disabled = !realms.length || state.busy || context.busy || context.switchingRealm;
      const season = realms.find(item=>item.type==='season'||item.type==='seasonal');
      get('[data-atlas-season]').textContent=context.realmError?'環境讀取失敗':realm?.type==='permanent'?(season?.available?'永久旅程 · 當期賽季開放中':'永久旅程 · 賽季尚未開放'):realm?.endsAt?`本季至 ${new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric'}).format(new Date(realm.endsAt))}`:'賽季旅程';
      const charButton=get('[data-atlas-character]');charButton.textContent=c?`${c.name} ▾`:'選擇角色';charButton.disabled=state.busy||context.busy||context.switchingRealm;
      const actor=get('[data-atlas-actor]'),portrait=c?host.portrait(c):null,actorKey=c?`${context.realmId}:${c.tgId}:${portrait}`:'';
      if(actor.dataset.key!==actorKey){actor.dataset.key=actorKey;actor.innerHTML=portrait?`<div class="atlas-actor-halo"></div><img src="${esc(portrait)}" alt="${esc(c.name)}的角色外觀"><span class="atlas-actor-name">${esc(c.name)}</span>`:'<div class="atlas-empty-emblem" aria-hidden="true">✦</div>';}
      const mapName=client.state.catalog&&entries(client.state.catalog.maps).find(item=>idOf(item)===String(state.snapshot?.run?.mapId))?.name;
      get('[data-atlas-location]').textContent=mapName || (c ? host.scene?.(c)?.name || '星圖營地' : '選擇角色，展開星圖');
      const scene=host.scene?.(c);if(scene?.image)root.querySelector('.atlas-landscape').style.backgroundImage=`url("${scene.image.replace(/["\\]/g,'')}")`;
      const stats=get('[data-atlas-stats]');stats.innerHTML=c?`<div class="atlas-identity"><span class="atlas-level">${number(c.level)}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.className||context.meta?.classes?.[c.baseClass]?.name||'冒險者')}</small></span></div><div class="atlas-vital"><small>生命</small><strong>${number(c.hp)} <em>/ ${number(statsData?.maxHp)}</em></strong></div><div class="atlas-vital"><small>魔力</small><strong>${number(c.mp)} <em>/ ${number(statsData?.maxMp)}</em></strong></div><div class="atlas-currency"><small>金幣</small><strong>${number(c.gold)}</strong></div>`:'<p>既有角色與裝備保留於永久環境。選擇角色即可繼續旅程。</p>';
      get('[data-atlas-sync]').textContent=state.loading?'正在同步進度…':state.error?'同步暫停 · 可重新讀取':state.syncedAt?`更新於 ${new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}).format(new Date(state.syncedAt))}`:'進度由伺服器記錄';
      root.querySelectorAll('[data-atlas-group],[data-atlas-direct]').forEach(button=>{button.disabled=!validCharacter()||state.busy||context.busy;});
      const run=state.snapshot?.run;
      get('.atlas-tracker').innerHTML=`<div class="atlas-tracker-heading"><span>旅程追蹤</span><span class="atlas-live-dot"></span></div>${!c?'<h3>營地等你歸來</h3><p>先選擇一位冒險者。</p>':state.loading&&!state.snapshot?'<h3>正在確認旅程</h3><p>讀取此環境的探索紀錄。</p>':state.catalog?.enabled===false?'<h3>星圖即將展開</h3><p>新星圖尚未開放，現有冒險與各系統可繼續使用。</p><button type="button" data-atlas-tracker-open>查看出征入口 '+icon('arrow')+'</button>':state.error?`<h3>尚未取得最新進度</h3><p>${esc(state.error)}</p><button type="button" data-atlas-retry>重新同步</button>`:run?`<h3>${esc(statusNames[run.status]||run.status)}</h3><p>${esc(mapName||'星圖探索')}</p><div class="atlas-progress"><span style="width:${progressPercent(run)}%"></span></div><small>${progressLabel(run)}</small><button type="button" data-atlas-tracker-open>查看探索與戰報 ${icon('arrow')}</button>`:'<h3>準備下一次出征</h3><p>選擇目標星圖，讓構築迎接新的挑戰。</p><button type="button" data-atlas-tracker-open>展開星圖 '+icon('arrow')+'</button>'}`;
      get('[data-atlas-retry]')?.addEventListener('click',()=>client.refresh());get('[data-atlas-tracker-open]')?.addEventListener('click',()=>open('expedition'));
      get('.atlas-tracker').insertAdjacentHTML('beforeend',questPreview());get('[data-atlas-open-quests]')?.addEventListener('click',()=>open('quests'));
    }
    function dataState(content) {
      const state=client.state;
      const operationNames={'atlas/configure':'儲存構築','atlas/start':'開始出征','atlas/settle':'探索結算','atlas/stop':'停止探索','atlas/craft':'星圖銘刻','atlas/quests/claim':'委託領獎','atlas/talents/action':'天賦配點'};
      const pending=state.pending&&!state.busy?`<div class="atlas-error" role="status">「${esc(operationNames[state.pending.action])}」的結果尚未確認。按下方按鈕會核對同一次操作。<button type="button" data-atlas-recover>確認上次操作</button></div>`:'';
      if(state.loading&&!state.snapshot)return empty('正在展開星圖','讀取你的構築、探索與材料。');
      if(state.catalog?.enabled===false)return pending+empty('星圖尚未開放','目前仍可透過下方入口繼續原有冒險、裝備與收藏進度。');
      if(!state.catalog||!state.snapshot)return pending+empty('星圖尚未連線',state.error||'目前沒有可顯示的探索資料。','<button type="button" class="atlas-primary" data-atlas-refresh>重新讀取</button>');
      return `${pending}${state.error?`<div class="atlas-error" role="alert">${esc(state.error)}<button type="button" data-atlas-refresh>重新讀取</button></div>`:''}${!canStart()?'<p class="atlas-prototype">新星圖出征與製作暫停開放；現有探索仍可同步或停止，結束時退還剩餘補給。</p>':state.catalog.balanceStatus==='prototype'?'<p class="atlas-prototype">試行星圖 · 流派與敵人數值仍在驗證，既有裝備強化 +N 保留。</p>':''}${content()}`;
    }
    function buildFields() {
      const state=client.state,catalog=state.catalog,draft=state.draft||{},c=character();
      const builds=entries(catalog.builds).filter(build=>!build.baseClass||build.baseClass===c?.baseClass);
      const supports=entries(catalog.supports),build=builds.find(item=>idOf(item)===String(draft.buildId));
      return `<label class="atlas-field"><span>流派</span><select name="buildId" ${running()||state.busy||!canStart()?'disabled':''}><option value="">選擇你的流派</option>${builds.map(item=>`<option value="${esc(idOf(item))}" ${idOf(item)===String(draft.buildId)?'selected':''}>${esc(item.name||idOf(item))}</option>`).join('')}</select></label><div class="atlas-build-description">${esc(textOf(build))}</div>${build?.recommendedSupports?.length?'<button type="button" class="atlas-text-button" data-atlas-recommend '+(running()||state.busy||!canStart()?'disabled':'')+'>套用此流派的入門輔助</button>':''}<fieldset class="atlas-supports" ${running()||state.busy||!canStart()?'disabled':''}><legend>輔助配置 · 最多 2 個</legend>${supports.length?supports.map(support=>{const compatible=!support.requires?.length||support.requires.some(tag=>build?.tags?.includes(tag));return `<label class="atlas-support ${(draft.supportIds||[]).includes(idOf(support))?'selected':''}"><input type="checkbox" name="supportIds" value="${esc(idOf(support))}" ${(draft.supportIds||[]).includes(idOf(support))?'checked':''} ${!compatible?'disabled':''}><span><strong>${esc(support.name||idOf(support))}</strong><small>${esc(textOf(support))}${!compatible?' · 需要相符的流派':''}</small></span></label>`;}).join(''):'<p class="atlas-note">目前沒有開放的輔助配置。</p>'}</fieldset>`;
    }
    function runFields() {
      const catalog=client.state.catalog,locked=running()||client.state.busy||!canStart(),inventory=context.me?.inventory||{},supplyCounts=client.state.snapshot?.supplies;
      const maxMaps=Math.min(96,Number(catalog.maxMapCount)||96),maxMinutes=Math.min(480,Math.floor(Number(catalog.maxDurationSeconds)/60)||480);
      const values={queueMode:draftRun.queueMode??catalog.defaultQueueMode??'count',mapCount:draftRun.mapCount??1,durationMinutes:draftRun.durationMinutes??60,hp:draftRun.supplies?.hp??0,mp:draftRun.supplies?.mp??0};
      return `<div class="atlas-run-options"><label class="atlas-field"><span>出征方式</span><select name="queueMode" ${locked?'disabled':''}>${entries(catalog.queueModes||[{id:'count',name:'探索指定張數'}]).map(mode=>`<option value="${esc(mode.id)}" ${values.queueMode===mode.id?'selected':''}>${esc(mode.name)}</option>`).join('')}</select><small>持續探索不受 96 張上限影響，倒地或手動停止會提前返營。</small></label><label class="atlas-field"><span>最多探索張數</span><input name="mapCount" type="number" inputmode="numeric" min="1" max="${maxMaps}" step="1" value="${esc(values.mapCount)}" required ${locked||values.queueMode==='duration'?'disabled':''}><small>${values.queueMode==='duration'?'持續探索模式依時間結束，不以張數停止':`1–${maxMaps} 張，達上限即返營`}</small></label><label class="atlas-field"><span>最長派遣時間</span><input name="durationMinutes" type="number" inputmode="numeric" min="1" max="${maxMinutes}" step="1" value="${esc(values.durationMinutes)}" required ${locked?'disabled':''}><small>1–${maxMinutes} 分鐘</small></label>${[['hp','生命藥水','red_1'],['mp','魔力藥水','blue_1']].map(([key,label,item])=>{const held=Number(supplyCounts?.[key]??inventory[item]??0);return `<label class="atlas-field"><span>${label}預算</span><input name="${key}" type="number" inputmode="numeric" min="0" max="${Math.min(500,held)}" step="1" value="${esc(values[key])}" required ${locked?'disabled':''}><small>背包持有 ${number(held)} 瓶 · 最多帶 500 瓶</small></label>`;}).join('')}</div><p class="atlas-note">從背包預留初級生命／魔力藥水，按實際需要使用；返營退還剩餘藥水。不會自動購買或追加預算。</p>`;
    }
    function automationField() {
      const modes=entries(client.state.catalog?.automation),current=client.state.draft?.automation;
      return modes.length?`<label class="atlas-field atlas-automation"><span>自動施放策略</span><select name="automation" ${running()||client.state.busy||!canStart()?'disabled':''}>${modes.map(mode=>`<option value="${esc(idOf(mode))}" ${idOf(mode)===current?'selected':''}>${esc(mode.name)}</option>`).join('')}</select><small>${esc(textOf(modes.find(mode=>idOf(mode)===current)))}</small></label>`:'';
    }
    function workshopPanel() {
      const content=dataState(()=>{
        const {catalog,snapshot,busy}=client.state,materials=snapshot.materials||{},equipment=entries(snapshot.equipment),recipes=entries(catalog.recipes),cap=Number(catalog.maxCraftsPerItem)||3;
        const item=equipment.find(row=>idOf(row)===draftCraft.itemId),recipe=recipes.find(row=>idOf(row)===draftCraft.recipeId);
        const canCraft=canStart()&&item&&recipe&&!item.tradeLocked&&item.crafts<cap&&Object.entries(recipe.cost||{}).every(([id,cost])=>(materials[id]||0)>=cost);
        const materialName=id=>entries(catalog.materials).find(row=>idOf(row)===id)?.name||id;
        const costHtml=cost=>Object.entries(cost||{}).map(([id,count])=>`${esc(materialName(id))} ${number(materials[id]||0)} / ${number(count)}`).join(' · ');
        return `<div class="atlas-section-top"><div><small>用指定材料，培養手中的裝備</small><h3>星圖銘刻</h3></div><button type="button" class="atlas-icon-button" data-atlas-refresh aria-label="更新工坊材料">${icon('refresh')}</button></div><div class="atlas-materials">${entries(catalog.materials).map(row=>`<span>${esc(row.name)} <b>${number(materials[idOf(row)]||0)}</b></span>`).join('')}</div>${!equipment.length?empty('尚未取得裝備資料','選擇下方背包入口可查看現有裝備。'):!recipes.length?empty('星圖配方尚未開放','原有強化與重鑄仍可使用。'):`<form data-atlas-craft><label class="atlas-field"><span>選擇要培養的裝備</span><select name="craftItemId" ${busy?'disabled':''} required><option value="">選擇一件裝備</option>${equipment.map(row=>`<option value="${esc(idOf(row))}" ${draftCraft.itemId===idOf(row)?'selected':''} ${row.tradeLocked||row.crafts>=cap?'disabled':''}>${esc(row.name)} +${number(row.enhanceLevel)} · 銘刻 ${number(row.crafts)} / ${cap}${row.tradeLocked?' · 交易託管中':''}</option>`).join('')}</select></label><div class="atlas-recipe-grid">${recipes.map(row=>`<label class="atlas-recipe ${draftCraft.recipeId===idOf(row)?'selected':''}"><input type="radio" name="recipeId" value="${esc(idOf(row))}" ${draftCraft.recipeId===idOf(row)?'checked':''} ${busy?'disabled':''} required><span><strong>${esc(row.name)}</strong><p>${esc(textOf(row))}</p><small>${costHtml(row.cost)}</small></span></label>`).join('')}</div><div class="atlas-form-footer"><span>${item?`${esc(item.name)}的強化 +${number(item.enhanceLevel)} 維持不變`:`每件裝備最多銘刻 ${cap} 次；強化 +N 保留`}</span><button type="submit" class="atlas-primary" ${busy||!canCraft?'disabled':''}>${busy?'處理中…':'確認製作'}</button></div>${item&&recipe&&!canCraft?'<p class="atlas-note">材料不足、裝備正在交易，或已達銘刻次數上限。</p>':''}</form>`}`;
      });
      return content+routeCards([['bag','鍛造與詞綴重鑄','從裝備詳情開啟強化、自動強化與重鑄','forge'],['shop','商店與補給','購買藥水、材料、裝備與回收道具','forge'],['background','背景工坊','查看目前角色的自動作業','forge']])+`<div class="atlas-preservation"><b>強化成果繼續保留</b><p>既有裝備的強化 +N 不會因介面或能力調整而重置。</p></div>`;
    }
    function loadRecoveryUI(){
     if(window.RpgEquipmentRecovery)return Promise.resolve(window.RpgEquipmentRecovery);
     if(window.__RpgEquipmentRecoveryLoading)return window.__RpgEquipmentRecoveryLoading;
     window.__RpgEquipmentRecoveryLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script'),base=document.querySelector('script[src*="atlas-ui.js"]')?.src||document.baseURI;
      script.src=new URL('equipment-recovery-ui.js?v=idle-content-20261104',base).href;
      const failed=()=>{window.__RpgEquipmentRecoveryLoading=null;script.remove();reject(Error('典藏介面載入失敗，請重試'));};
      script.onload=()=>window.RpgEquipmentRecovery?resolve(window.RpgEquipmentRecovery):failed();script.onerror=failed;document.head.append(script);
     });return window.__RpgEquipmentRecoveryLoading;
    }
    const questGroupsOpen = new Map();
    function questsPanel() {
      return dataState(()=>{
        const state=client.state;
        if(context.realmId!=='permanent')return empty('永久世界的委託','切換至永久環境，可查看這個帳號的教學與長期目標。');
        if(state.quests?.enabled===false)return empty('永久委託尚未開放','新玩法開放後，可在此查看教學與長期目標；既有冒險仍可繼續。');
        if(!state.quests)return empty(state.questsLoading?'正在讀取委託':'委託暫未同步',state.questError||'進度由伺服器記錄，載入後即可查看下一步。','<button type="button" class="atlas-primary" data-atlas-quests-refresh>重新讀取</button>');
        const rewardsHtml=rewards=>{if(!rewards)return '獎勵待同步';const materialNames=entries(state.catalog.materials);return [...Object.entries(rewards.materials||{}).filter(([,n])=>n>0).map(([id,n])=>esc(materialNames.find(row=>idOf(row)===id)?.name||id)+' ×'+number(n)),...(rewards.gold>0?['金幣 '+number(rewards.gold)]:[]),...(rewards.exp>0?['經驗 '+number(rewards.exp)]:[])].join(' · ')||'無額外獎勵';};
        const rows=state.quests.quests||[];
        const currentPeriod=q=>!['daily','weekly'].includes(q.category)||q.periodKey===rows.filter(row=>row.id===q.id).map(row=>row.periodKey).sort().at(-1);
        const visibleRows=rows.filter(q=>currentPeriod(q)||q.progress>0||q.claimed);
        const amount=(q,n)=>q.unit==='秒'?(n<60?number(n)+'秒':number(Math.floor(n/60))+'分'+(n%60?' '+number(n%60)+'秒':'')):number(n);
        const groups=[['tutorial','旅人教學'],['investigation','地區調查鏈'],['daily','每日活動'],['weekly','每週目標'],['longterm','長期踏查']];
        const cards=groups.map(([category,title])=>{
          const group=visibleRows.filter(q=>q.category===category);if(!group.length)return '';
          const ready=group.filter(q=>q.claimable).length,expanded=questGroupsOpen.has(category)?questGroupsOpen.get(category):['daily','investigation'].includes(category)||ready>0||category==='tutorial'&&group.some(q=>!q.claimed);
          return `<details class="atlas-quest-group" data-quest-category="${category}" ${expanded?'open':''}><summary><strong>${title}</strong> · ${number(group.length)} 項${ready?' · '+number(ready)+' 項可領取':''}</summary>${group.map(q=>{
            const expired=q.expiresAt&&q.expiresAt<=state.quests.now,current=currentPeriod(q),progress=q.target>0?Math.max(0,Math.min(100,100*q.progress/q.target)):0;
            const status=q.claimed?'已領取':q.locked?'等待前一步':q.claimable?'已達成 · 可領獎':expired||!current?'先前期別':'進行中';
            const button=q.claimed?'<span>已領取</span>':q.locked?'<span>先完成前一步領取</span>':q.claimable?`<button type="button" class="atlas-primary" data-quest-claim="${esc(q.id)}" data-quest-period="${esc(q.periodKey)}" ${state.busy?'disabled':''}>領取獎勵</button>`:q.action&&current&&!expired?`<button type="button" data-quest-go="${esc(q.id)}" data-quest-period="${esc(q.periodKey)}" ${state.busy?'disabled':''}>前往目標 ${icon('arrow')}</button>`:expired?'<span>已過補領期限</span>':current?'<span>持續探索即可累積</span>':'<span>可同步此期已完成的探索</span>';
            return `<article class="atlas-quest-card ${q.claimed?'is-claimed':''}"><div><small>${q.periodKey==='lifetime'?'':esc(q.periodKey)+' · '}${status}</small><h5>${esc(q.title)}</h5><p>${esc(q.description)}</p>${q.lockedReason?`<p class="atlas-quest-deadline">${esc(q.lockedReason)}</p>`:''}<div class="atlas-progress"><span style="width:${progress}%"></span></div><span class="atlas-quest-count">${amount(q,q.progress)} / ${amount(q,q.target)} ${q.unit==='秒'?'':esc(q.unit||'')}</span><p class="atlas-quest-reward">${rewardsHtml(q.rewards)}</p>${q.expiresAt&&!q.claimed?`<p class="atlas-quest-deadline">已完成獎勵可補領至 ${new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(q.expiresAt))}</p>`:''}</div><div class="atlas-quest-actions">${button}</div></article>`;
          }).join('')}</details>`;
        }).join('');
        return `<div class="atlas-section-top"><div><small>每段探索，都有真實累積</small><h3>永久世界委託</h3></div><button type="button" class="atlas-icon-button" data-atlas-quests-refresh aria-label="更新永久任務">${icon('refresh')}</button></div><p class="atlas-panel-intro">教學、三區調查、每日活動、每週與長期目標分開查看。同環境帳號共用進度，材料送給領獎角色。調查依序領取，離線已累積的進度保留；每日與每週依實際活動的台北時間計算。</p>${state.questError?`<div class="atlas-error">${esc(state.questError)}</div>`:''}${cards||empty('目前沒有開放的委託','新目標開放後會出現在這裡。')}`;
      });
    }
    function expeditionPanel() {
      const content=dataState(()=>{
        const state=client.state,maps=entries(state.catalog.maps),run=state.snapshot.run;
        return `<div class="atlas-section-top"><div><small>下一段未知，由你選擇</small><h3>星圖出征</h3></div><button type="button" class="atlas-icon-button" data-atlas-refresh aria-label="更新探索進度">${icon('refresh')}</button></div>${run?`<section class="atlas-run-card"><div><span class="atlas-tag">${esc(statusNames[run.status]||run.status)}</span><h4>${esc(maps.find(map=>idOf(map)===String(run.mapId))?.name||'星圖探索')}</h4><p>${progressLabel(run)}</p><div class="atlas-progress"><span style="width:${progressPercent(run)}%"></span></div></div><div class="atlas-run-actions"><button type="button" class="atlas-primary" data-atlas-settle ${state.busy?'disabled':''}>${run.progress?.catchingUp?'繼續同步離線進度':'同步並結算'}</button>${running()?'<button type="button" data-atlas-stop '+(state.busy?'disabled':'')+'>停止探索</button>':''}</div></section>${run.report?reportHtml(run.report,state.catalog):''}`:''}<form data-atlas-expedition><div class="atlas-map-grid">${maps.map(map=>`<label class="atlas-map-card ${String(draftRun.mapId)===idOf(map)?'selected':''}"><input type="radio" name="mapId" value="${esc(idOf(map))}" ${String(draftRun.mapId)===idOf(map)?'checked':''} ${running()||state.busy||!canStart()||map.available===false||state.snapshot.availableMapIds&&!state.snapshot.availableMapIds.includes(idOf(map))?'disabled':''}><span class="atlas-map-mark">${icon('map')}</span><span class="atlas-map-copy"><small>${map.kind==='boss'?'首領試煉':map.tier!==undefined?'階級 '+number(map.tier):'教學星圖'}</small><strong>${esc(map.name||idOf(map))}</strong><span>${esc(textOf(map)||map.hints?.join(' ')||'')}</span>${map.minLevel?`<em>需要等級 ${number(map.minLevel)}</em>`:''}${map.prerequisites?.length?`<em>前置：${map.prerequisites.map(id=>esc(maps.find(item=>idOf(item)===id)?.name||id)).join('、')}</em>`:''}</span></label>`).join('')||empty('目前沒有可選星圖','新的星圖開放後會出現在這裡。')}</div><details class="atlas-build-in-expedition" ${!state.draft?.buildId?'open':''}><summary>出征構築與輔助</summary>${buildFields()}${automationField()}</details>${runFields()}<p class="atlas-note">出征後使用當次配置；實際進度、補給與獎勵以探索紀錄為準。點「同步並結算」才會入帳。</p><div class="atlas-form-footer"><span>${running()?'目前已有一趟探索進行中':'準備好後開始探索'}</span><button type="submit" class="atlas-primary" ${running()||state.busy||!canStart()||!maps.length?'disabled':''}>${state.busy?'處理中…':'開始出征'} ${icon('arrow')}</button></div></form>`;
      });
      return content+routeCards([['home','一般掛機與補給','查看原有冒險、藥水與每日領獎','map'],['boss','首領與合作冒險','世界首領、星環遠征、組隊副本','social']]);
    }
    function panelHtml() {
      if(panel==='talents')return dataState(()=>window.RpgAtlasTalents?.render(client.state.snapshot.talents,{level:character()?.level||1,busy:client.state.busy,locked:running()||!!character()?.partyId||!canStart(),selectedId:talentSelected,zoom:talentZoom,effectsReviewed:talentEffectsReviewed,preview:talentPreview,previewLoading:talentPreviewLoading})||empty('天賦介面尚未載入','請重新開啟遊戲。'));
      if(panel==='progression')return dataState(()=>window.RpgAtlasProgression?.render(client.state.catalog,client.state.snapshot,{level:character()?.level||1,busy:client.state.busy})||'');
      if(panel==='quests')return questsPanel();
      if(panel==='expedition')return expeditionPanel();
      if(panel==='build')return dataState(()=>`<button type="button" class="atlas-primary" data-atlas-open-talents>天賦星盤 · 可用 ${number(client.state.snapshot.talents?.availablePoints??0)} 點</button><p class="atlas-panel-intro">技能決定出手方式，輔助改變節奏。選出適合下一張星圖的配置。</p><form data-atlas-build>${buildFields()}${automationField()}<div class="atlas-form-footer"><span>${running()?'探索中，結束後可調整配置':'儲存後套用於下一趟探索'}</span><button type="submit" class="atlas-primary" ${running()||client.state.busy||!canStart()?'disabled':''}>儲存構築</button></div></form>`)+`<div class="atlas-preservation"><b>原有強化等級保留</b><p>裝備的 +N 維持原值；目前能力與詞綴可在裝備詳情查看。</p></div>${routeCards([['bag','裝備與背包','穿戴、查看能力與原有強化等級','build'],['class','職業與傳承','轉職、分支與成長路線','build'],['skills','原生與特殊戰技','學習、進修與自動施放配置','build']])}`;
      if(panel==='workshop')return '<button type="button" class="atlas-primary" data-atlas-open-recovery>典藏與精煉 · 讓舊裝備與重複品繼續派上用場</button><button type="button" class="atlas-primary" data-atlas-open-gearbook>裝備收藏冊 · 集滿獲得永久能力</button>'+workshopPanel();
      if(panel==='companions')return `<p class="atlas-panel-intro">帶著守護啟程，也為另一段人生留一盞星燈。</p>${routeCards([['guardian:summon','抽取天使','召喚、查看結果與原有抽取紀錄','angel'],['guardian:inventory','天使管理','啟用、鎖定、合成與守護配置','angel'],['fate','命運旅章與輪迴','繼續此世、開啟新人生與查看進度','book'],['fate:archive','靈魂旅誌','翻閱過往人生與旅章紀錄','book'],['fate:gift','星輝匣','查看、領取與開啟輪迴贈禮','angel']])}`;
      if(panel==='social')return `<p class="atlas-panel-intro">與同一環境的旅人同行，交換彼此需要的收穫。</p>${routeCards([['party','組隊冒險','尋找隊伍、討伐、轉職試煉與爬塔','social'],['star-ring','星環遠征','原有五人遠征與進行中戰況','map'],['trade','雙人交易與集會','邀請、託管、確認交易與紀錄','social'],['exchange','交易所','搜尋、上架與查看成交紀錄','forge'],['hall','英雄殿堂','查看角色與公開穿戴','social']])}`;
      return `${dataState(()=>`<div class="atlas-section-top"><h3>最近一趟星圖</h3><button type="button" class="atlas-icon-button" data-atlas-refresh aria-label="更新戰報">${icon('refresh')}</button></div>${reportHtml(client.state.snapshot?.run?.report,client.state.catalog)}`)}${routeCards([['collection','地圖圖鑑與收藏','材料、徽記與收藏祝福','book'],['journal','旅團日誌','原有委託進度與領獎','book'],['home','掛機戰報與帳本','查看原有結算、掉落與操作紀錄','book']])}`;
    }
    function paintPanel() {
      if(!panel||overlay.hidden)return;
      const group=groups.find(item=>item.id===panel);overlay.querySelector('#atlas-panel-title').textContent=group?.name||(panel==='chat'?'聊天':panel==='talents'?'天賦星盤':panel==='progression'?'冒險成長路線':panel==='gearbook'?'裝備收藏冊':panel==='recovery'?'典藏與精煉':'永久世界委託');
      if(panel==='gearbook'){if(!gearbookView){const body=overlay.querySelector('.atlas-panel-body'),scope=contextKey(client.state.context);body.innerHTML='<button type="button" class="atlas-primary" data-open-recovery>典藏與精煉 · 首次典藏、重複回收與材料重洗</button><div data-legacy-collection></div>';body.querySelector('[data-open-recovery]').onclick=()=>open('recovery');gearbookView=window.RpgEquipmentCollection.mount(body.querySelector('[data-legacy-collection]'),{request:host.request,characterId:character().tgId,realmId:context.realmId,current:()=>scope===contextKey(client.state.context)&&panel==='gearbook',onChanged:()=>{void refreshAll();void host.refresh?.();}});}return;}
      if(panel==='recovery'){
        if(!gearbookView){
          const body=overlay.querySelector('.atlas-panel-body'),scope=contextKey(client.state.context);let cancelled=false;
          body.textContent='正在載入典藏與精煉…';gearbookView={dispose(){cancelled=true;}};
          const current=()=>!cancelled&&panel==='recovery'&&scope===contextKey(client.state.context)&&body.isConnected;
          void loadRecoveryUI().then(()=>{if(!current())return;gearbookView=window.RpgEquipmentRecovery.mount(body,{request:host.request,characterId:character().tgId,realmId:context.realmId,current,getContext:()=>client.state.context,onLegacy:()=>open('gearbook'),onChanged:()=>{void refreshAll();void host.refresh?.();}});}).catch(error=>{if(!current())return;body.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='重新載入';retry.onclick=()=>{gearbookView=null;paintPanel();};body.append(retry);});
        }return;
      }
      if(panel==='chat'&&chatClient){const body=overlay.querySelector('.atlas-panel-body');if(!body.querySelector('[data-scene-chat-panel]'))chatPanel=window.RpgSceneChatUI.mountPanel(body,chatClient);chatPanel.update();lastPanelKey='';return;}
      const state=client.state,scope=contextKey(state.context);
      if(draftScope!==scope){draftScope=scope;draftRun={};draftCraft={};}
      const signature=JSON.stringify([panel,scope,state.loading,state.busy,state.error,state.pending,state.catalog,state.snapshot,state.quests,state.questError,state.questsLoading,talentSelected,talentEffectsReviewed,talentPreview,talentPreviewLoading,context.me?.inventory?.red_1,context.me?.inventory?.blue_1]);
      if(signature===lastPanelKey)return;lastPanelKey=signature;
      const body=overlay.querySelector('.atlas-panel-body'),scroll=body.scrollTop,active=document.activeElement,oldTree=body.querySelector('.atlas-talent-canvas'),treeScroll=oldTree?{left:oldTree.scrollLeft,top:oldTree.scrollTop}:null;
      const focusedName=body.contains(active)?active.name:null,focusedValue=active?.value,details=[...body.querySelectorAll('details')].map(node=>node.open);
      body.innerHTML=panelHtml();body.scrollTop=scroll;bindPanel(body);
      const tree=body.querySelector('.atlas-talent-canvas');if(tree){tree.scrollLeft=treeScroll?.left??Math.max(0,(tree.scrollWidth-tree.clientWidth)/2);tree.scrollTop=treeScroll?.top??0;}
      body.querySelectorAll('details').forEach((node,index)=>{if(details[index]!==undefined)node.open=details[index];});
      if(focusedName){const controls=[...body.querySelectorAll(`[name="${CSS.escape(focusedName)}"]`)];(controls.find(node=>node.value===focusedValue)||controls[0])?.focus({preventScroll:true});}
    }
    function bindPanel(body) {
      body.querySelector('[data-atlas-open-recovery]')?.addEventListener('click',()=>open('recovery'));
      body.querySelector('[data-atlas-open-gearbook]')?.addEventListener('click',()=>open('gearbook'));
      body.querySelectorAll('[data-atlas-open-talents]').forEach(button=>button.onclick=()=>open('talents'));
      body.querySelectorAll('[data-talent-node]').forEach(node=>{const select=()=>{if(node.dataset.talentNode==='origin'){talentSelected='origin';lastPanelKey='';paintPanel();return;}void previewTalent(node.dataset.talentNode);};node.onclick=select;node.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();select();}};});
      body.querySelectorAll('[data-talent-plan]').forEach(button=>button.onclick=()=>previewTalent(button.dataset.talentPlan,true));
      body.querySelector('[data-talent-apply-path]')?.addEventListener('click',async()=>{const data=talentPreview,scope=contextKey(client.state.context);if(!data?.plan.canApply||talentConfirming||client.state.busy)return;talentConfirming=true;try{if(!await host.confirm('確認天賦路線',`新增 ${data.plan.requiredPoints} 點，保留原有節點。${esc(data.plan.after.effectText)}。`,'配置整條路線')||scope!==contextKey(client.state.context))return;const result=await operate('atlas/talents/action',{kind:'allocate_path',nodeId:data.nodeId,expectedRevision:data.baseRevision});if(result){talentPreview=null;host.toast('路線已保存，原有節點與裝備強化保留。');}}finally{talentConfirming=false;lastPanelKey='';paintPanel();}});
      body.querySelectorAll('[data-growth-open]').forEach(button=>button.onclick=()=>open(button.dataset.growthOpen));
      body.querySelectorAll('[data-growth-map]').forEach(button=>button.onclick=()=>{draftRun.mapId=button.dataset.growthMap;open('expedition');});
      const talentCanvas=body.querySelector('.atlas-talent-canvas');
      if(talentCanvas){let drag=null,moved=false;talentCanvas.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:talentCanvas.scrollLeft,top:talentCanvas.scrollTop};moved=false;});talentCanvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;if(!moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;moved=true;event.preventDefault();talentCanvas.setPointerCapture(event.pointerId);talentCanvas.scrollLeft=drag.left-(event.clientX-drag.x);talentCanvas.scrollTop=drag.top-(event.clientY-drag.y);});const endDrag=event=>{if(drag&&event.pointerId===drag.id){if(talentCanvas.hasPointerCapture(event.pointerId))talentCanvas.releasePointerCapture(event.pointerId);drag=null;}};talentCanvas.addEventListener('pointerup',endDrag);talentCanvas.addEventListener('pointercancel',endDrag);talentCanvas.addEventListener('click',event=>{if(moved){moved=false;event.preventDefault();event.stopPropagation();}},true);}
      body.querySelector('[name="talentZoom"]')?.addEventListener('input',event=>{talentZoom=Number(event.target.value);body.querySelector('.atlas-talent-canvas svg').style.width=900*talentZoom/100+'px';});
      body.querySelector('[data-talent-review]')?.addEventListener('click',()=>{talentEffectsReviewed=true;lastPanelKey='';paintPanel();body.querySelector('[data-talent-effects]')?.scrollIntoView({block:'nearest'});});
      body.querySelectorAll('[data-talent-guide]').forEach(button=>button.onclick=async()=>{const result=await operate('atlas/talents/action',{kind:button.dataset.talentGuide});if(result)body.scrollTop=0;});
      body.querySelector('[data-talent-allocate]')?.addEventListener('click',async event=>{if(talentConfirming||client.state.busy)return;talentConfirming=true;try{const nodeId=event.currentTarget.dataset.talentAllocate,t=client.state.snapshot.talents,node=t.catalog.nodes.find(n=>n.id===nodeId),scope=contextKey(client.state.context);if(!node)return;if(!await host.confirm('確認天賦配點',`配置「${esc(node.name)}」，消耗 1 點天賦。${esc(node.description)}。下次星圖出征生效。`,'配置 1 點')||scope!==contextKey(client.state.context))return;const result=await operate('atlas/talents/action',{kind:'allocate',nodeId});if(result){host.toast('天賦已保存，下次星圖出征生效。');if(result.talents?.tutorialStep===1)body.scrollTop=0;}}finally{talentConfirming=false;}});
      body.querySelector('[data-talent-reset]')?.addEventListener('click',async()=>{const scope=contextKey(client.state.context);if(!await host.confirm('重新配置天賦','試作期間免費洗點，清空目前節點並返還全部天賦點。裝備、強化與等級維持原樣。','確認洗點')||scope!==contextKey(client.state.context))return;const result=await operate('atlas/talents/action',{kind:'reset'});if(result){talentSelected=null;talentEffectsReviewed=false;lastPanelKey='';paintPanel();host.toast('天賦點已返還。');}});
      body.querySelectorAll('[data-atlas-route]').forEach(button=>button.onclick=()=>route(button.dataset.atlasRoute));
      body.querySelectorAll('[data-atlas-refresh]').forEach(button=>button.onclick=()=>refreshAll());
      body.querySelectorAll('[data-quest-category]').forEach(details=>details.ontoggle=()=>{if(details.isConnected)questGroupsOpen.set(details.dataset.questCategory,details.open);});
      body.querySelectorAll('[data-atlas-quests-refresh]').forEach(button=>button.onclick=()=>client.refreshQuests());
      body.querySelectorAll('[data-quest-claim]').forEach(button=>button.onclick=async()=>{const result=await operate('atlas/quests/claim',{questId:button.dataset.questClaim,periodKey:button.dataset.questPeriod});if(result)host.toast(result.rewardCharacterId&&String(result.rewardCharacterId)!==String(client.state.context.characterId)?'這筆獎勵已入帳到原領獎角色；帳號紀錄已同步。':result.alreadyClaimed?'這項委託已領取，已同步帳號紀錄。':'委託獎勵已送入目前角色的材料庫。');});
      body.querySelectorAll('[data-quest-go]').forEach(button=>button.onclick=()=>{const quest=client.state.quests?.quests?.find(row=>row.id===button.dataset.questGo&&row.periodKey===button.dataset.questPeriod);if(!quest)return;if(quest.action==='maps'){if(quest.mapId)draftRun.mapId=quest.mapId;open('expedition');}else if(quest.action==='loadout')open('build');else if(quest.action==='craft')open('workshop');else if(quest.action==='gearbook')open('gearbook');else if(quest.action==='recovery')open('recovery');});
      body.querySelector('[data-atlas-recover]')?.addEventListener('click',()=>{const pending=client.state.pending;if(pending)void operate(pending.action,pending.payload);});
      body.querySelector('[data-atlas-settle]')?.addEventListener('click',()=>operate('atlas/settle',{runId:client.state.snapshot.run.id}));
      body.querySelector('[data-atlas-stop]')?.addEventListener('click',async()=>{const scope=contextKey(client.state.context),runId=client.state.snapshot.run.id;if(await host.confirm('停止探索','已完成部分會依探索規則結算。確定停止目前這一趟？','停止探索')&&scope===contextKey(client.state.context))await operate('atlas/stop',{runId});});
      body.querySelectorAll('[name="buildId"]').forEach(select=>select.onchange=()=>{client.state.draft.buildId=select.value;const build=entries(client.state.catalog.builds).find(item=>idOf(item)===select.value);client.state.draft.supportIds=(client.state.draft.supportIds||[]).filter(id=>{const support=entries(client.state.catalog.supports).find(item=>idOf(item)===id);return support&&(!support.requires?.length||support.requires.some(tag=>build?.tags?.includes(tag)));});lastPanelKey='';paintPanel();});
      body.querySelector('[name="automation"]')?.addEventListener('change',event=>{client.state.draft.automation=event.target.value;const mode=entries(client.state.catalog.automation).find(row=>idOf(row)===event.target.value);event.target.closest('label').querySelector('small').textContent=textOf(mode);});
      body.querySelector('[data-atlas-recommend]')?.addEventListener('click',()=>{const build=entries(client.state.catalog.builds).find(item=>idOf(item)===client.state.draft.buildId);client.state.draft.supportIds=[...(build?.recommendedSupports||[])].slice(0,2);lastPanelKey='';paintPanel();});
      body.querySelectorAll('[name="supportIds"]').forEach(input=>input.onchange=()=>{const selected=[...body.querySelectorAll('[name="supportIds"]:checked')];if(selected.length>2){input.checked=false;return host.toast('最多選擇 2 個輔助。',true);}client.state.draft.supportIds=selected.map(node=>node.value);input.closest('label').classList.toggle('selected',input.checked);});
      body.querySelectorAll('[name="mapId"]').forEach(input=>input.onchange=()=>{draftRun.mapId=input.value;body.querySelectorAll('.atlas-map-card').forEach(card=>card.classList.toggle('selected',card.contains(input)));});
      body.querySelector('[name="queueMode"]')?.addEventListener('change',event=>{draftRun.queueMode=event.target.value;lastPanelKey='';paintPanel();});
      body.querySelectorAll('[name="mapCount"],[name="durationMinutes"],[name="hp"],[name="mp"]').forEach(input=>input.oninput=()=>{if(input.name==='hp'||input.name==='mp')draftRun.supplies={...draftRun.supplies,[input.name]:input.value};else draftRun[input.name]=input.value;});
      body.querySelector('[name="craftItemId"]')?.addEventListener('change',event=>{draftCraft.itemId=event.target.value;lastPanelKey='';paintPanel();});
      body.querySelectorAll('[name="recipeId"]').forEach(input=>input.onchange=()=>{draftCraft.recipeId=input.value;lastPanelKey='';paintPanel();});
      body.querySelector('[data-atlas-craft]')?.addEventListener('submit',async event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;const scope=contextKey(client.state.context),payload={itemId:draftCraft.itemId,recipeId:draftCraft.recipeId},item=entries(client.state.snapshot.equipment).find(row=>idOf(row)===payload.itemId),recipe=entries(client.state.catalog.recipes).find(row=>idOf(row)===payload.recipeId);if(!item||!recipe)return;const cost=Object.entries(recipe.cost||{}).map(([id,count])=>`${esc(entries(client.state.catalog.materials).find(row=>idOf(row)===id)?.name||id)} ×${number(count)}`).join('、');if(!await host.confirm('確認星圖銘刻',`在「${esc(item.name)} +${number(item.enhanceLevel)}」套用${esc(recipe.name)}，消耗 ${cost}。強化 +${number(item.enhanceLevel)} 維持不變。`,'確認製作')||scope!==contextKey(client.state.context))return;const result=await operate('atlas/craft',payload);if(result)host.toast('銘刻完成，原有強化等級保留。');});
      body.querySelector('[data-atlas-build]')?.addEventListener('submit',async event=>{event.preventDefault();const draft=client.state.draft;if(!draft?.buildId)return host.toast('請先選擇流派。',true);const result=await operate('atlas/configure',{buildId:draft.buildId,supportIds:[...(draft.supportIds||[])],automation:draft.automation||'balanced'});if(result)host.toast('構築已儲存，下一趟探索將使用這份配置。');});
      body.querySelector('[data-atlas-expedition]')?.addEventListener('submit',async event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;if(!draftRun.mapId)return host.toast('請先選擇一張星圖。',true);if(!client.state.draft?.buildId)return host.toast('請先選擇流派。',true);const draft={...client.state.draft,supportIds:[...(client.state.draft.supportIds||[])]},queueMode=draftRun.queueMode??client.state.catalog.defaultQueueMode??'count',payload={mapId:draftRun.mapId,queueMode,...(queueMode==='count'?{mapCount:Number(draftRun.mapCount??1)}:{}),durationMinutes:Number(draftRun.durationMinutes??60),supplies:{hp:Number(draftRun.supplies?.hp??0),mp:Number(draftRun.supplies?.mp??0)}};const configured=await operate('atlas/configure',{buildId:draft.buildId,supportIds:draft.supportIds,automation:draft.automation||'balanced'});if(!configured)return;const result=await operate('atlas/start',payload);if(result)host.toast('已開始探索，離線後旅程仍會繼續。');});
    }
    async function previewTalent(nodeId,routePreview=false){
      talentPreviewAbort?.abort();const abort=new AbortController(),seq=++talentPreviewSeq,scope=contextKey(client.state.context);talentPreviewAbort=abort;talentSelected=nodeId;talentPreview=null;talentPreviewLoading=true;lastPanelKey='';paintPanel();
      try{const data=await host.request('atlas/talents/preview',{nodeId},{signal:abort.signal});if(seq!==talentPreviewSeq||scope!==contextKey(client.state.context))return;talentPreview=data;}
      catch(error){if(!abort.signal.aborted&&scope===contextKey(client.state.context))host.toast(errorText(error),true);}
      finally{if(seq===talentPreviewSeq&&scope===contextKey(client.state.context)){talentPreviewLoading=false;lastPanelKey='';paintPanel();overlay.querySelector(routePreview?'.atlas-talent-preview':'.atlas-talent-detail')?.scrollIntoView({block:routePreview?'start':'nearest'});}}
    }
    function paint() {if(disposed)return;if(talentPreview&&talentPreview.baseRevision!==client.state.snapshot?.talents?.revision)talentPreview=null;paintScene();paintPanel();paintNav();chatLauncher.hidden=!validCharacter();const s=chatClient?.state,m=s?.messages.at(-1);chatLauncher.querySelector('span').textContent=s?.error?'聊天暫時離線 · 點此重新連線':m?`${m.channel==='party'?'隊伍':'世界'} · ${m.name}：${m.text}`:'世界與隊伍頻道 · 點此聊天';}
    function update(next) {
      context=next;if(!overlayOnly)document.body.classList.add('atlas-enabled');root.hidden=overlayOnly||!next.meta;
      const selecting=next.choosing||next.creating||!next.me;
      const legacyWasOpen=!legacy.hidden;
      legacy.hidden=overlayOnly||!selecting&&next.tab==='atlas';legacyBackdrop.hidden=legacy.hidden;legacy.classList.toggle('atlas-selecting',selecting);
      if(!legacy.hidden&&!legacyWasOpen){legacyFocusReturn=document.activeElement;queueMicrotask(()=>{if(!disposed&&!legacy.hidden&&!document.getElementById('app').inert)legacy.querySelector('[data-atlas-legacy-close]:not([hidden])')?.focus({preventScroll:true});});}
      if(legacy.hidden&&legacyWasOpen){const target=legacyFocusReturn;legacyFocusReturn=null;queueMicrotask(()=>{if(!disposed&&legacy.hidden&&!root.inert&&target?.isConnected)target.focus({preventScroll:true});});}
      legacy.querySelector('[data-atlas-legacy-close]').hidden=selecting&&!next.me;
      legacy.querySelector('[data-atlas-legacy-title]').textContent=selecting?'選擇冒險者':({home:'一般掛機與補給',bag:'裝備與背包',class:'職業與傳承',guardian:'守護天使',shop:'工坊與市集',trade:'社交與交易',boss:'首領與合作冒險',collection:'地圖圖鑑'})[next.tab]||'冒險';
      const changed=client.setContext({realmId:next.realmId,characterId:next.me?.character?.tgId||'',epoch:next.contextEpoch||0});
      chatClient?.setContext({realmId:next.realmId,characterId:next.me?.character?.tgId||'',epoch:next.contextEpoch||0});
      if(changed){close();draftRun={};draftCraft={};draftScope='';talentSelected=null;talentZoom=90;talentEffectsReviewed=false;talentPreviewSeq++;talentPreviewAbort?.abort();talentPreview=null;talentPreviewLoading=false;}
      if(selecting)close();syncWindowState();paint();
      if(changed&&!selecting&&!overlayOnly){void refreshAll();void chatClient?.refresh();}
    }
    root.querySelectorAll('[data-atlas-group]').forEach(button=>button.onclick=()=>open(button.dataset.atlasGroup));
    root.querySelectorAll('[data-atlas-direct]').forEach(button=>button.onclick=()=>route(button.dataset.atlasDirect));
    root.querySelectorAll('[data-atlas-open-talents]').forEach(button=>button.onclick=()=>open('talents'));
    root.querySelectorAll('[data-atlas-open-growth]').forEach(button=>button.onclick=()=>open('progression'));
    get('[data-atlas-home]').onclick=()=>{close();host.home();};get('[data-atlas-character]').onclick=()=>{close();host.chooseCharacter();};
    get('#atlas-realm').onchange=event=>{close();void host.switchRealm(event.target.value);};
    legacy.querySelector('[data-atlas-legacy-close]').onclick=()=>{host.home();};
    legacyBackdrop.onclick=()=>{if(context?.me)host.home();};
    overlay.querySelectorAll('[data-atlas-close]').forEach(button=>button.onclick=close);
    function keydown(event){
      const active=!overlay.hidden?overlay:!legacy.hidden?legacy:null;
      if(!active)return;
      if(!document.getElementById('sheet')?.hidden)return;
      if(document.getElementById('expedition-overlay')||document.querySelector('.fate-overlay'))return;
      if(event.key==='Escape'){event.preventDefault();if(active===legacy){if(context?.me)host.home();}else close();return;}
      if(event.key!=='Tab')return;
      const items=[...active.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(node=>node.getClientRects().length),first=items[0],last=items.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',keydown);
    const visibility=()=>{if(!document.hidden&&validCharacter()){void refreshAll();void chatClient?.refresh();}};
    if(!overlayOnly)document.addEventListener('visibilitychange',visibility);
    if(!overlayOnly)poll=setInterval(()=>{if(!document.hidden&&validCharacter()&&!client.state.busy)void refreshAll();},30000);
    const chatPoll=overlayOnly?0:setInterval(()=>{if(!document.hidden&&validCharacter()&&(panel==='chat'||Date.now()-(chatClient?.state.syncedAt||0)>=30000))void chatClient?.refresh();},5000);
    return {update,open,close,refresh:client.refresh,client,chatClient,dispose(){disposed=true;gearbookView?.dispose();clearInterval(poll);clearInterval(chatPoll);talentPreviewSeq++;talentPreviewAbort?.abort();client.dispose();chatClient?.dispose();document.removeEventListener('keydown',keydown);document.removeEventListener('visibilitychange',visibility);overlay.remove();legacyBackdrop.remove();if(scrollLocked)document.body.style.overflow=previousOverflow;root.remove();}};
  }
  function styleSceneFrame(frame) {
    if(!document.body.classList.contains('atlas-enabled'))return;
    frame.addEventListener('load',()=>{
      const doc=frame.contentDocument;
      if(!doc?.head)return;
      doc.documentElement.classList.add('atlas-scene-frame');
      if(!doc.getElementById('atlas-scene-frame-style')){
        const css=doc.createElement('link');css.id='atlas-scene-frame-style';css.rel='stylesheet';css.href='/scene-window-frame.css?v=20261102-floating1';doc.head.append(css);
      }
    });
  }
  window.RpgAtlasUI={mount,createClient,groups,contextKey,reportHtml,progressPercent,progressLabel,styleSceneFrame};
})();
