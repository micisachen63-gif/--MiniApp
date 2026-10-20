import { adminLoginCommand, adminLoginLink } from './pairing.js?v=20261020b';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW') : '—';
const percent = value => value == null || !Number.isFinite(Number(value)) ? '待觀察' : `${Math.round(Number(value) * 1000) / 10}%`;
const dateTime = value => {
  if (value == null || value === '') return '—';
  const raw = typeof value === 'number' && value < 1e12 ? value * 1000 : value;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : String(value);
};
const isoDate = value => {
  if (value == null || value === '') return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const raw = typeof value === 'number' && value < 1e12 ? value * 1000 : value;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : String(value);
};
const absoluteTime = value => {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  return new Date(value).getTime();
};
const encodeId = value => encodeURIComponent(String(value));
const labels = {
  overview: ['營運總覽', 'THE BIG PICTURE', '從旅人的行為看見變化，找到值得關注的下一步。'],
  audience: ['旅人洞察', 'UNDERSTAND YOUR TRAVELERS', '從可核對的行為分群，辨識回訪與流失訊號。'],
  players: ['玩家查詢', 'TRAVELER DIRECTORY', '查閱角色近況，精準選取獎勵收件人。'],
  rewards: ['獎勵發放', 'A GIFT WITH A RECORD', '先核對對象與數量，再確認發放。每一次操作都有收據。'],
  teams: ['隊伍監看', 'LIVE EXPEDITIONS', '掌握組隊狀況；本頁不會干預隊伍、戰鬥或結算。'],
  audit: ['操作紀錄', 'EVERY ACTION HAS A TRACE', '回查管理操作與發獎收據，保留完整處理脈絡。']
};
const segmentLabels = { risk: '值得關心的旅人', new: '新加入的旅人', engaged: '穩定回訪的旅人' };
const classLabels = { sword: '劍士', mage: '法師', archer: '妖精', thief: '盜賊' };
const className = key => classLabels[key] || key || '—';
const modeLabels = { ring: '星環遠征', short: '打寶／爬塔', star_ring: '星環遠征', dungeon: '組隊打寶', tower: '組隊爬塔' };
const statusLabels = { lobby: '招募中', running: '進行中', combat: '戰鬥中', complete: '已完成', completed: '已完成', ended: '已結束', expired: '已逾時', abandoned: '已撤退', cancelled: '已取消' };
const S = {
  admin: null, epoch: 0, tab: 'overview', days: 14, selected: new Map(),
  segment: 'risk', search: '', players: [], playerCursor: null, audience: [], audienceCursor: null,
  audit: [], auditCursor: null, catalog: null, preview: null, pendingGrant: null,
  rewardDraft: { gold: 0, item: null, qty: 1, reason: '' },
  uncertainReference: null, lastGrant: null, poll: null, pollTimer: null, authController: null,
  toastTimer: null, requestVersions: new Map(), expiryTimer: null
};

class ApiError extends Error {
  constructor(message, status, code) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}

function friendlyError(error) {
  if (error?.name === 'AbortError') return '操作已中止，請重新嘗試。';
  if (error?.status === 503) return '管理服務暫時無法使用，請稍後重試。此處不會把舊資料顯示為目前狀況。';
  if (error?.status === 429) return '請求較密集，請稍候再試。';
  if (error?.status === 401 || error?.status === 403) return '管理員驗證已失效或沒有此操作權限，請重新登入。';
  if (error instanceof TypeError) return '網路連線中斷，無法確認伺服器結果。請檢查連線後重試。';
  return error?.message || '暫時無法完成，請稍後重試。';
}

async function api(endpoint, payload, { method = 'POST', auth = true, signal, telegram = false } = {}) {
  const authEpoch = S.epoch;
  const requestCsrf = S.admin?.csrf;
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (auth && S.admin?.csrf) headers['X-Admin-CSRF'] = S.admin.csrf;
  if (telegram) headers['X-Telegram-Init-Data'] = window.Telegram?.WebApp?.initData || '';
  const response = await fetch(`/admin/api/${endpoint}`, {
    method, credentials: 'same-origin', cache: 'no-store', headers, signal,
    ...(method !== 'GET' ? { body: JSON.stringify(payload ?? {}) } : {})
  });
  let data;
  try { data = await response.json(); } catch { throw new ApiError('伺服器回覆格式不完整，請稍後重試。', response.status); }
  if (!response.ok || data.ok === false || data.error) {
    const raw = data.error;
    const message = typeof raw === 'string' ? (data.message || raw) : raw?.message || data.message || '操作未完成。';
    const error = new ApiError(message, response.status, typeof raw === 'string' ? raw : raw?.code);
    if (auth && authEpoch === S.epoch && requestCsrf === S.admin?.csrf && [401, 403].includes(response.status)) lockSession(friendlyError(error));
    throw error;
  }
  return data;
}

function isCurrent(token, key) { return token.epoch === S.epoch && token.version === S.requestVersions.get(key) && token.tab === S.tab && !!S.admin; }
function requestToken(key) {
  const version = (S.requestVersions.get(key) || 0) + 1;
  S.requestVersions.set(key, version);
  return { version, epoch: S.epoch, tab: S.tab };
}
function toast(message) {
  clearTimeout(S.toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  S.toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}
function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
  $('#notice').hidden = !message;
}
function loading(message = '正在讀取管理資料…') {
  $('#view').setAttribute('aria-busy', 'true');
  $('#view').innerHTML = `<div class="loading-state"><span class="spinner" aria-hidden="true"></span>${escapeHtml(message)}</div>`;
}
function empty(title, message, action = '') {
  return `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">✧</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${action}</div>`;
}
function errorView(error, retry) {
  $('#view').setAttribute('aria-busy', 'false');
  $('#view').innerHTML = `<section class="panel">${empty('這次資料尚未載入', friendlyError(error), '<button class="button" type="button" id="view-retry">重新讀取</button>')}</section>`;
  $('#view-retry').addEventListener('click', retry);
}
function setView(html) {
  $('#view').innerHTML = html;
  $('#view').setAttribute('aria-busy', 'false');
}
function selectedBadge() {
  $('#nav-selected').textContent = S.selected.size;
  $('#nav-selected').hidden = !S.selected.size;
}
function hideModal() {
  S.requestVersions.set('player-detail', (S.requestVersions.get('player-detail') || 0) + 1);
  const modal = $('#modal');
  if (modal.open) modal.close();
  $('#modal-content').replaceChildren();
}
function showModal(title, body, actions = '') {
  hideModal();
  $('#modal-content').innerHTML = `<div class="modal-header"><h2 id="modal-title">${escapeHtml(title)}</h2><button class="close-button" type="button" aria-label="關閉對話框" data-close>×</button></div><div class="modal-body">${body}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ''}`;
  $$('[data-close]', $('#modal')).forEach(button => button.addEventListener('click', hideModal));
  $('#modal').showModal();
}

function stopLoginPolling({ forget = false } = {}) {
  clearTimeout(S.pollTimer);
  S.pollTimer = null;
  S.authController?.abort();
  S.authController = null;
  if (forget) S.poll = null;
}

function lockSession(message = '請登入管理員帳號。') {
  if (S.pendingGrant) S.uncertainReference = S.pendingGrant.requestId;
  S.epoch++;
  S.admin = null;
  S.selected.clear();
  S.players = []; S.audience = []; S.audit = []; S.catalog = null;
  S.search = ''; S.segment = 'risk';
  S.playerCursor = null; S.audienceCursor = null; S.auditCursor = null;
  S.preview = null; S.pendingGrant = null; S.lastGrant = null;
  S.rewardDraft = { gold: 0, item: null, qty: 1, reason: '' };
  clearTimeout(S.expiryTimer);
  stopLoginPolling({ forget: true });
  hideModal();
  $('#view').replaceChildren();
  $('#notice').hidden = true;
  $('#toast').hidden = true;
  $('#admin-name').textContent = '';
  $('#admin-role').textContent = '';
  $('#session-expiry').textContent = '';
  $('#app').hidden = true;
  $('#auth').hidden = false;
  renderLogin(message);
}

function approveChallenge() {
  const value = new URLSearchParams(location.search).get('approve');
  return /^[0-9a-f]{64}$/.test(value || '') ? value : null;
}

async function renderLogin(message = '') {
  const epoch = S.epoch;
  const content = $('#auth-content');
  const challenge = approveChallenge();
  const telegram = !!window.Telegram?.WebApp?.initData;
  if (challenge) {
    content.innerHTML = `<h2>確認電腦瀏覽器授權</h2><p>僅在這是你本人剛剛開啟的管理台，且電腦顯示相同代碼時批准。</p><span class="auth-code-label">請核對電腦上的 8 碼</span><div class="auth-code">${escapeHtml(challenge.slice(0, 8).toUpperCase())}</div><label class="inline-check"><input type="checkbox" id="approve-check">我已核對代碼，這是我的登入要求</label><button type="button" class="button primary" id="approve-login" disabled>批准這次登入</button><p id="auth-message" class="small" role="status"></p>`;
    if (!telegram) {
      $('#auth-message').textContent = '請由 Telegram 開啟這個授權頁面，才能驗證管理員身分。';
      $('#approve-check').disabled = true;
      return;
    }
    $('#approve-check').addEventListener('change', event => { $('#approve-login').disabled = !event.target.checked; });
    $('#approve-login').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      $('#approve-check').disabled = true;
      $('#auth-message').textContent = '正在核對管理員身分…';
      try {
        await api('login/approve', { challenge }, { auth: false, telegram: true });
        if (epoch !== S.epoch) return;
        content.innerHTML = `<h2>已批准這次登入</h2><p>請回到剛剛的電腦瀏覽器，管理台會接續開啟。此批准不會更動遊戲資料。</p><div class="auth-code">${escapeHtml(challenge.slice(0, 8).toUpperCase())}</div>`;
      } catch (error) {
        if (epoch !== S.epoch) return;
        $('#auth-message').textContent = friendlyError(error);
        $('#approve-check').disabled = false;
        button.disabled = !$('#approve-check').checked;
      }
    });
    return;
  }
  content.innerHTML = `<h2>以管理員身分登入</h2><p>${escapeHtml(message || '使用已授權的 Telegram 帳號驗證。電腦版可透過 Telegram 核對代碼登入，不需要輸入機器人金鑰。')}</p><div id="login-action"><div class="auth-loading"><span class="spinner" aria-hidden="true"></span>準備安全登入…</div></div><p id="auth-message" class="small" role="status"></p>`;
  if (S.uncertainReference) $('#auth-message').textContent = `上次發獎結果待核對。重新登入後請先查詢原操作 ${S.uncertainReference}，不要另開一筆補發。`;
  if (telegram) {
    $('#login-action').innerHTML = '<button type="button" class="button primary" id="tg-login">使用目前 Telegram 帳號登入</button>';
    $('#tg-login').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      $('#auth-message').textContent = '正在驗證管理員身分…';
      try {
        const result = await api('login/tg', {}, { auth: false, telegram: true });
        if (epoch === S.epoch) await enterSession(result.admin);
      } catch (error) {
        if (epoch !== S.epoch) return;
        $('#auth-message').textContent = friendlyError(error);
        $('#tg-login').disabled = false;
      }
    });
    return;
  }
  try {
    const verifier = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challengeValue = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (epoch !== S.epoch || S.admin) return;
    const command = adminLoginCommand(challengeValue);
    $('#login-action').innerHTML = `<a class="button primary" id="browser-login" target="_blank" rel="noopener noreferrer" href="${escapeHtml(adminLoginLink(challengeValue))}">到 Telegram 取得驗證按鈕 <span aria-hidden="true">↗</span></a><ol class="auth-steps"><li>開啟機器人私訊；若出現「開始／Start」，請先點一下。</li><li>核對私訊與此頁的 8 碼相同，再按私訊中的「批准登入」。</li><li>回到這個瀏覽器，管理台會自動開啟。</li></ol><div id="browser-code" hidden><span class="auth-code-label">在 Telegram 核對此代碼</span><div class="auth-code">${escapeHtml(challengeValue.slice(0, 8).toUpperCase())}</div><p class="small" id="login-poll-status" role="status">等待你在 Telegram 明確批准，最多等候 5 分鐘。</p></div><details class="auth-fallback" id="login-fallback"><summary>Telegram 沒出現驗證訊息？</summary><p class="small">複製下方指令，貼到 @StarJournalRpgBot 的私訊並送出，再核對代碼及按「批准登入」。請勿貼到群組或轉傳他人。</p><label class="auth-code-label" for="login-command">本次登入指令（可直接選取複製）</label><textarea id="login-command" class="mono auth-command" readonly rows="3" spellcheck="false">${escapeHtml(command)}</textarea><button type="button" class="button" id="copy-login-command">複製登入指令</button><p class="small" id="copy-login-status" role="status"></p></details>`;
    const isCurrentLogin = () => epoch === S.epoch && !S.admin && $('#login-command')?.value === command;
    const beginPolling = () => {
      if (!isCurrentLogin()) return;
      $('#browser-code').hidden = false;
      // Opening Telegram and copying the fallback belong to the same attempt.
      // Repeated clicks must not replace its verifier or extend its deadline.
      if (S.poll) return;
      S.poll = { verifier, challenge: challengeValue, deadline: Date.now() + 5 * 60 * 1000, epoch };
      pollBrowserLogin();
    };
    $('#browser-login').addEventListener('click', beginPolling);
    $('#login-fallback').addEventListener('toggle', event => { if (event.currentTarget.open) beginPolling(); });
    $('#login-command').addEventListener('focus', beginPolling);
    $('#copy-login-command').addEventListener('click', async () => {
      beginPolling();
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
        await navigator.clipboard.writeText(command);
        if (!isCurrentLogin()) return;
        $('#copy-login-status').textContent = '已複製，請貼到機器人私訊並送出。';
      } catch {
        if (!isCurrentLogin()) return;
        $('#login-command').focus();
        $('#login-command').select();
        $('#copy-login-status').textContent = '瀏覽器未允許自動複製。指令已選取，請自行複製後貼到機器人私訊並送出。';
      }
    });
  } catch {
    if (epoch !== S.epoch) return;
    $('#login-action').innerHTML = '<p class="error-text">目前瀏覽器不支援安全登入，請使用 HTTPS 與較新的瀏覽器，或直接在 Telegram 開啟管理台。</p>';
  }
}

async function pollBrowserLogin() {
  const poll = S.poll;
  if (!poll || poll.epoch !== S.epoch || S.admin || document.hidden || poll.running) return;
  clearTimeout(S.pollTimer);
  if (Date.now() >= poll.deadline) {
    stopLoginPolling({ forget: true });
    renderLogin('這次登入已逾時，請重新產生代碼。');
    return;
  }
  poll.running = true;
  S.authController = new AbortController();
  try {
    const result = await api('login/redeem', { verifier: poll.verifier }, { auth: false, signal: S.authController.signal });
    if (poll !== S.poll || poll.epoch !== S.epoch) return;
    if (result.admin) { stopLoginPolling({ forget: true }); await enterSession(result.admin); return; }
    const status = $('#login-poll-status');
    if (status) status.textContent = '等待 Telegram 私訊中的「批准登入」。請核對兩邊 8 碼相同，批准後回到這個視窗。';
  } catch (error) {
    if (poll !== S.poll || poll.epoch !== S.epoch) return;
    if ([401, 409].includes(error.status)) {
      // A consumed redemption may still have installed its HttpOnly cookie before a lost response.
      try {
        const recovered = await api('session', undefined, { method: 'GET', auth: false });
        if (poll === S.poll && poll.epoch === S.epoch && recovered.admin) { stopLoginPolling({ forget: true }); await enterSession(recovered.admin); return; }
      } catch {}
      if (poll === S.poll && poll.epoch === S.epoch) { stopLoginPolling({ forget: true }); renderLogin('這次登入代碼已失效，請重新核對新代碼。'); }
      return;
    }
    if (error.name !== 'AbortError') {
      const status = $('#login-poll-status');
      if (status) status.textContent = `${friendlyError(error)} 仍會在期限內核對同一次登入。`;
    }
  } finally {
    poll.running = false;
    if (poll === S.poll && !document.hidden) S.pollTimer = setTimeout(pollBrowserLogin, 3000);
  }
}

async function enterSession(admin) {
  if (!admin?.csrf || !admin?.id) throw new ApiError('管理員工作階段不完整，請重新登入。', 401);
  stopLoginPolling({ forget: true });
  S.admin = admin;
  S.epoch++;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#admin-name').textContent = admin.name || `管理員 ${admin.id}`;
  $('#admin-role').textContent = ['owner', 'creator'].includes(admin.role) ? '擁有者' : ['admin', 'administrator'].includes(admin.role) ? '管理員' : admin.role;
  $('#session-expiry').textContent = admin.expiresAt ? `工作階段至 ${dateTime(admin.expiresAt)}（台北）` : '時間均以台北時區顯示';
  const expiry = absoluteTime(admin.expiresAt);
  if (Number.isFinite(expiry)) S.expiryTimer = setTimeout(() => lockSession('工作階段已到期，請重新驗證。'), Math.max(0, Math.min(expiry - Date.now(), 2147483647)));
  selectedBadge();
  const requested = location.hash.slice(1);
  await switchTab(labels[requested] ? requested : 'overview', false);
  if (S.uncertainReference && S.admin) {
    notice(`有一筆發獎結果尚待核對（${S.uncertainReference}）。請先到獎勵發放頁查詢原收據，不要重建相同獎勵。`, true);
  }
}

async function switchTab(tab, focus = true) {
  if (!S.admin || !labels[tab]) return;
  S.tab = tab;
  hideModal();
  $$('.nav-item').forEach(button => button.toggleAttribute('aria-current', false));
  $(`.nav-item[data-tab="${tab}"]`).setAttribute('aria-current', 'page');
  const [title, kicker, subtitle] = labels[tab];
  $('#page-title').textContent = title;
  $('#breadcrumb-title').textContent = title;
  $('#page-kicker').textContent = kicker;
  $('#page-subtitle').textContent = subtitle;
  $('#page-actions').replaceChildren();
  history.replaceState(null, '', `${location.pathname}${location.search}#${tab}`);
  if (focus) $('#main').focus({ preventScroll: true });
  await ({ overview: loadDashboard, audience: () => loadAudience(false), players: () => loadPlayers(false), rewards: renderRewards, teams: loadTeams, audit: () => loadAudit(false) })[tab]();
}

function kpi(label, value, note, highlight = false) {
  return `<article class="kpi${highlight ? ' highlight' : ''}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(number(value))}</div><p class="kpi-note">${escapeHtml(note)}</p></article>`;
}
function panel(title, subtitle, content, badge = '', id = '') {
  return `<section class="panel"${id ? ` id="${escapeHtml(id)}" tabindex="-1"` : ''}><header class="panel-header"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p class="panel-subtitle">${escapeHtml(subtitle)}</p>` : ''}</div>${badge}</header>${content}</section>`;
}
function bars(items, max, blue = false) {
  if (!items.length) return empty('尚未有觀測資料', '有可用資料後會在這裡呈現。');
  return `<div class="bar-list">${items.map(item => `<div class="bar-row"><span class="bar-label">${escapeHtml(item.label)}</span><div class="bar-track"><div class="bar-fill${blue ? ' blue' : ''}" style="width:${Math.max(0, Math.min(100, Number(item.value) / Math.max(1, max) * 100))}%"></div></div><span class="bar-value">${number(item.value)}</span></div>`).join('')}</div>`;
}

function trendChart(rows) {
  if (!rows?.length) return '<div class="chart-empty">開始觀測後，這裡會呈現每日回訪趨勢。</div>';
  const width = 700, height = 250, left = 38, right = 14, top = 18, bottom = 36;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maximum = Math.max(1, ...rows.map(row => Math.max(Number(row.active) || 0, Number(row.newAccounts) || 0)));
  const ceiling = maximum <= 5 ? 5 : Math.ceil(maximum / 5) * 5;
  const x = index => left + (rows.length === 1 ? plotWidth / 2 : index * plotWidth / (rows.length - 1));
  const y = value => top + plotHeight * (1 - Math.max(0, Number(value) || 0) / ceiling);
  const path = key => {
    let open = false;
    return rows.map((row, index) => {
      if (row.observed === false) { open = false; return ''; }
      const segment = `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`;
      open = true;
      return segment;
    }).join(' ');
  };
  const active = path('active');
  const firstObserved = rows.findIndex(row => row.observed !== false);
  const area = firstObserved < 0 ? '' : `${active} L${x(rows.length - 1)},${top + plotHeight} L${x(firstObserved)},${top + plotHeight} Z`;
  const ticks = [0, .25, .5, .75, 1].map(part => `<line class="chart-grid" x1="${left}" y1="${y(ceiling * part)}" x2="${width - right}" y2="${y(ceiling * part)}"/><text x="${left - 9}" y="${y(ceiling * part) + 4}" text-anchor="end">${number(Math.round(ceiling * part))}</text>`).join('');
  const every = Math.max(1, Math.ceil(rows.length / 6));
  const xLabels = rows.map((row, index) => index % every === 0 || index === rows.length - 1 ? `<text x="${x(index)}" y="${height - 10}" text-anchor="middle">${escapeHtml(String(row.day).slice(5))}${row.partial ? '*' : ''}</text>` : '').join('');
  const points = rows.map((row, index) => row.observed === false ? '' : `<circle cx="${x(index)}" cy="${y(row.active)}" r="${row.partial ? 4 : 2.8}" fill="${row.partial ? '#132135' : '#dfc48a'}" stroke="#dfc48a" stroke-width="1.5"><title>${escapeHtml(row.day)}：活躍帳號 ${number(row.active)}，新帳號 ${number(row.newAccounts)}${row.partial ? '；當日尚未結束' : ''}</title></circle>`).join('');
  return `<div class="legend"><span><i style="background:#dfc48a"></i>活躍帳號</span><span><i style="background:#83b1e6"></i>新帳號</span><span>* 今日未結束</span></div><div class="chart-wrap"><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="trend-title trend-desc"><title id="trend-title">每日活躍與新帳號趨勢</title><desc id="trend-desc">${escapeHtml(rows.map(row => row.observed === false ? `${row.day} 尚未觀測` : `${row.day} 活躍${row.active}，新帳號${row.newAccounts}${row.partial ? '，未結束' : ''}`).join('；'))}</desc><defs><linearGradient id="active-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#dfc48a" stop-opacity=".2"/><stop offset="100%" stop-color="#dfc48a" stop-opacity="0"/></linearGradient></defs>${ticks}<path d="${area}" fill="url(#active-area)"/><path d="${active}" fill="none" stroke="#dfc48a" stroke-width="2.5" stroke-linejoin="round"/><path d="${path('newAccounts')}" fill="none" stroke="#83b1e6" stroke-width="2" stroke-dasharray="5 4"/>${points}${xLabels}</svg></div>`;
}

function retentionTable(rows) {
  if (!rows?.length) return empty('留存尚在累積', '觀測開始後的新帳號，才會納入可核對的留存群組。');
  return `<div class="table-wrap"><table><thead><tr><th>新帳號加入日</th><th>群組人數</th><th>隔日回訪 D1</th><th>第 7 日回訪 D7</th></tr></thead><tbody>${rows.map(row => `<tr><td class="mono">${escapeHtml(row.day)}</td><td>${number(row.size)}</td><td><span class="retention-cell${row.d1 == null || !row.size ? ' pending' : ''}" title="${row.d1 == null ? '尚未有完整觀測' : `${number(row.d1)}／${number(row.size)} 人回訪`}">${percent(row.d1 == null || !row.size ? null : row.d1 / row.size)}</span></td><td><span class="retention-cell${row.d7 == null || !row.size ? ' pending' : ''}" title="${row.d7 == null ? '尚未有完整觀測' : `${number(row.d7)}／${number(row.size)} 人回訪`}">${percent(row.d7 == null || !row.size ? null : row.d7 / row.size)}</span></td></tr>`).join('')}</tbody></table></div><p class="chart-note">依帳號去重。尚未到觀測日或缺少完整歷史時顯示「待觀察」，不當作 0%。</p>`;
}

async function loadDashboard() {
  const token = requestToken('dashboard');
  $('#page-actions').innerHTML = `<div class="page-controls"><div class="segmented" role="group" aria-label="統計期間">${[7, 14, 30].map(days => `<button type="button" data-days="${days}" aria-pressed="${S.days === days}">${days} 天</button>`).join('')}</div><button class="button ghost compact" type="button" id="refresh-dashboard">↻ 更新</button></div>`;
  $$('[data-days]').forEach(button => button.addEventListener('click', () => { S.days = Number(button.dataset.days); loadDashboard(); }));
  $('#refresh-dashboard').addEventListener('click', loadDashboard);
  loading('正在彙整已觀測的旅人行為…');
  try {
    const data = await api('dashboard', { days: S.days });
    if (!isCurrent(token, 'dashboard')) return;
    const totals = data.totals || {};
    const features = data.features || [];
    const classes = (data.classes || []).map(row => ({ label: className(row.name), value: row.count }));
    const levels = (data.levels || []).map(row => ({ label: row.low == null ? '未分類' : `Lv.${row.low}–${Number(row.low) + 9}`, value: row.count }));
    const insights = (data.insights || []).map((item, index) => `<article class="insight" data-level="${escapeHtml(item.level)}"><span class="insight-icon" aria-hidden="true">${['warning', 'risk'].includes(item.level) ? '!' : '✧'}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(Array.isArray(item.evidence) ? item.evidence.join('；') : typeof item.evidence === 'object' ? JSON.stringify(item.evidence) : item.evidence)}</p>${item.action ? `<button type="button" class="text-button" data-insight="${index}">${escapeHtml(item.action)} <span aria-hidden="true">→</span></button>` : ''}</div></article>`).join('');
    const economyRows = data.economy?.sources || [];
    const economy = economyRows.length ? `<div class="table-wrap"><table><thead><tr><th>帳本類型</th><th>筆數</th><th>流入</th><th>流出</th></tr></thead><tbody>${economyRows.map(row => `<tr><td class="wrap">${escapeHtml(row.type)}</td><td>${number(row.entries)}</td><td class="positive">+${number(row.inflow)}</td><td class="muted">−${number(row.outflow)}</td></tr>`).join('')}</tbody></table></div>` : empty('目前沒有帳本紀錄', '此期間尚無可用的金幣帳本資料。');
    const modes = data.modes || [];
    const todayNew = data.trend?.find(row => row.day === data.today)?.newAccounts;
    setView(`<div class="observation-note"><span aria-hidden="true">◷</span><span>行為觀測自 <strong>${escapeHtml(data.trackedSince || '尚未開始')}</strong> 起累積；不回填未觀測的歷史。資料更新 ${escapeHtml(dateTime(data.now))}（台北），今日尚未結束。</span></div>
      <div class="kpi-grid">${kpi('今日活躍帳號', totals.activeToday, '成功使用 MiniApp 的去重帳號', true)}${kpi('今日新增帳號', todayNew, '依帳號建立時間，不等同新角色')}${kpi('累計帳號／角色', totals.accounts, `共 ${number(totals.characters)} 位角色`)}${kpi('角色持有金幣', totals.gold, '目前持有量；不代表本期產出')}</div>
      <div class="dashboard-grid">${panel('旅人的回訪軌跡', `近 ${data.days || S.days} 天 · 以帳號計算`, `${trendChart(data.trend)}<p class="chart-note">自動計時、背景輪詢與伺服器排程不計入活躍。未開始觀測的日期不能解讀為沒有玩家。</p>`, '<span class="badge">行為觀測</span>')}${panel('值得留意的變化', '依實際資料整理線索，供管理員判斷', insights ? `<div class="insight-list">${insights}</div>` : empty('還需要一些時間', '資料累積後，會提供可核對的變化與建議。'), '<span class="badge blue">規則洞察</span>')}</div>
      <div class="dashboard-grid">${panel('玩法參與', '本期實際參與的去重帳號；不同玩法可重複', features.length ? `<div class="feature-list">${features.map(row => `<div class="feature"><span>${escapeHtml(row.label || row.event)}</span><strong>${number(row.users)}</strong></div>`).join('')}</div>` : empty('尚無玩法足跡', '成功操作會逐步形成這份參與分布。'), '', 'section-features')}${panel('職業分布', '目前角色數；包含同帳號的不同角色', bars(classes, Math.max(1, ...classes.map(row => Number(row.value) || 0))))}</div>
      ${panel('新旅人留存', '依加入日分組，觀察第 1 與第 7 個台北日是否回訪', retentionTable(data.retention), '', 'section-retention')}
      <div class="dashboard-grid section-gap">${panel('金幣流向', '帳本實際收支，含玩家間交易移轉', `<div class="button-row small" style="margin-bottom:15px"><span class="positive">流入 ${number(data.economy?.totals?.inflow)}</span><span class="muted">流出 ${number(data.economy?.totals?.outflow)}</span></div>${economy}<p class="chart-note">轉帳、交易與部分管理作業也會出現在帳本，不能將流入直接當成系統新增貨幣。</p>`, '', 'section-economy')}${panel('角色進度', '目前等級分布', bars(levels, Math.max(1, ...levels.map(row => Number(row.value) || 0)), true))}</div>
      ${panel('組隊活動概況', '此期間建立的隊伍狀態', modes.length ? `<div class="table-wrap"><table><thead><tr><th>玩法</th><th>總隊伍</th><th>完成</th><th>結束</th><th>戰鬥中</th><th>招募中</th></tr></thead><tbody>${modes.map(row => `<tr><td>${escapeHtml(row.label || modeLabels[row.mode] || row.mode)}</td><td>${number(row.total)}</td><td>${number(row.complete)}</td><td>${number(row.ended)}</td><td>${number(row.running)}</td><td>${number(row.lobby)}</td></tr>`).join('')}</tbody></table></div>` : empty('此期間尚無隊伍', '建立隊伍後，會顯示各玩法的活動概況。'))}
      <details class="definition"><summary>統計口徑與使用限制</summary><ul><li>活躍帳號：有成功且經驗證的 MiniApp 使用；排除輪詢、背景計時與伺服器自動戰鬥。未觀測到不能直接推論沒有登入。</li><li>留存：只計可完整觀測的新帳號群組。尚未到期、早於追蹤起點或分母不足時不顯示百分比。</li><li>規則洞察：依觀測數字產生可核對的提示，不是個人意圖預測，也不會自動封鎖、發獎或更動遊戲。</li><li>金幣：帳本流量包含交易移轉；角色餘額與本期收支是不同口徑。</li></ul></details>`);
    $$('[data-insight]').forEach(button => button.addEventListener('click', () => {
      const target = data.insights[Number(button.dataset.insight)].target;
      if (typeof target === 'string' && ['risk', 'new', 'engaged', 'segments'].includes(target)) { S.segment = target === 'segments' ? 'risk' : target; switchTab('audience'); }
      else if (typeof target === 'string' && ['retention', 'economy', 'features'].includes(target)) { const section = document.getElementById(`section-${target}`); section?.scrollIntoView({ block: 'start', behavior: 'smooth' }); section?.focus({ preventScroll: true }); }
      else if (typeof target === 'string' && labels[target]) switchTab(target);
      else { S.segment = 'risk'; switchTab('audience'); }
    }));
  } catch (error) { if (isCurrent(token, 'dashboard')) errorView(error, loadDashboard); }
}

function selectionTray() {
  if (!S.selected.size) return '';
  return `<div class="selection-tray"><span>已選取 <strong>${S.selected.size}</strong> 位角色 <span class="muted">／最多 20 位</span></span><div class="button-row"><button class="button ghost compact" type="button" data-clear-selected>清空選取</button><button class="button primary compact" type="button" data-go-rewards>帶入發獎 →</button></div></div>`;
}
function selectable(id) { return !S.pendingGrant && !S.uncertainReference && (S.selected.has(String(id)) || S.selected.size < 20); }
function playerTable(items, audience = false) {
  if (!items.length) return empty(audience ? '這個分群暫無旅人' : '找不到符合條件的角色', audience ? '隨著觀測持續累積，符合條件的帳號會出現在這裡。' : '可使用角色暱稱、角色 ID 或 Telegram 帳號 ID 查詢。');
  return `<div class="table-wrap"><table><thead><tr><th><span class="sr-only">選取收件人</span></th><th>角色／帳號</th><th>職業</th><th>等級</th>${audience ? '<th>觀測活躍日</th><th>最後回訪日</th>' : '<th>持有金幣</th><th>建立時間</th>'}<th>查看</th></tr></thead><tbody>${items.map(row => {
    const id = audience ? row.charId : row.id;
    const account = audience ? row.account : row.accountId;
    return `<tr><td><input class="table-check" type="checkbox" aria-label="選取 ${escapeHtml(row.name || id)} 作為收件人" data-select-player="${escapeHtml(id)}" ${S.selected.has(String(id)) ? 'checked' : ''} ${selectable(id) ? '' : 'disabled'}></td><td><span class="player-name">${escapeHtml(row.name || '未命名角色')}</span><span class="player-meta mono">角色 ${escapeHtml(id)} · 帳號 ${escapeHtml(account)}</span></td><td>${escapeHtml(className(row.baseClass))}</td><td class="nowrap">Lv.${number(row.level)}</td>${audience ? `<td>${number(row.activeDays)} 天</td><td class="mono nowrap">${escapeHtml(row.lastDay || '尚無紀錄')}</td>` : `<td>${number(row.gold)}</td><td class="nowrap">${escapeHtml(dateTime(row.createdAt))}</td>`}<td><button type="button" class="button ghost compact" data-player-detail="${escapeHtml(id)}">詳情</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function wireSelection(items, audience = false, render) {
  $$('[data-select-player]').forEach(input => input.addEventListener('change', () => {
    const id = input.dataset.selectPlayer;
    if (S.pendingGrant || S.uncertainReference) { input.checked = S.selected.has(id); toast('請先核對尚未確認的發獎結果。'); return; }
    if (input.checked) {
      if (S.selected.size >= 20) { input.checked = false; toast('單次最多發給 20 位角色，請分批處理。'); return; }
      const row = items.find(item => String(audience ? item.charId : item.id) === id);
      if (!row) return;
      S.selected.set(id, { id: audience ? row.charId : row.id, name: row.name, accountId: audience ? row.account : row.accountId, level: row.level });
    } else S.selected.delete(id);
    S.preview = null;
    selectedBadge();
    render();
  }));
  $('[data-clear-selected]')?.addEventListener('click', () => {
    if (S.pendingGrant || S.uncertainReference) return;
    S.selected.clear(); S.preview = null; selectedBadge(); render();
  });
  $('[data-go-rewards]')?.addEventListener('click', () => switchTab('rewards'));
  $$('[data-player-detail]').forEach(button => button.addEventListener('click', () => showPlayer(button.dataset.playerDetail)));
}

function renderPlayersPage({ moreError = '', loadingMore = false } = {}) {
  setView(`<form class="toolbar" id="player-search"><div class="search-form"><label class="sr-only" for="player-query">暱稱、角色或帳號 ID</label><input id="player-query" maxlength="80" value="${escapeHtml(S.search)}" placeholder="搜尋暱稱、角色 ID、帳號 ID" autocomplete="off"><button class="button primary" type="submit">搜尋</button></div><span class="list-count">已載入 ${number(S.players.length)} 位 · 每頁最多 40 位</span></form>${selectionTray()}<section class="panel">${playerTable(S.players)}${moreError ? `<p class="error-text" role="status">${escapeHtml(moreError)} 本頁資料已保留，可重試同一頁。</p>` : ''}${S.playerCursor ? `<div class="load-more"><button type="button" class="button" id="players-more" ${loadingMore ? 'disabled' : ''}>${loadingMore ? '載入中…' : moreError ? '重試載入下一頁' : '載入更多角色'}</button></div>` : ''}</section>`);
  $('#player-search').addEventListener('submit', event => { event.preventDefault(); S.search = $('#player-query').value.trim(); loadPlayers(false); });
  $('#players-more')?.addEventListener('click', () => loadPlayers(true));
  wireSelection(S.players, false, renderPlayersPage);
}

async function loadPlayers(more) {
  const query = S.search;
  const cursor = more ? S.playerCursor : undefined;
  const token = requestToken('players');
  if (more) renderPlayersPage({ loadingMore: true });
  else { S.players = []; S.playerCursor = null; loading('正在查詢角色…'); }
  try {
    const data = await api('players', { q: query, ...(cursor ? { cursor } : {}) });
    if (!isCurrent(token, 'players') || query !== S.search) return;
    S.players = more ? uniqueBy([...S.players, ...(data.items || [])], 'id') : data.items || [];
    S.playerCursor = data.nextCursor || null;
    renderPlayersPage();
  } catch (error) {
    if (!isCurrent(token, 'players') || query !== S.search) return;
    if (more) renderPlayersPage({ moreError: friendlyError(error) });
    else errorView(error, () => loadPlayers(false));
  }
}
function uniqueBy(items, key) { return [...new Map(items.map(item => [String(item[key]), item])).values()]; }

function renderAudiencePage({ moreError = '', loadingMore = false } = {}) {
  const descriptions = { risk: '曾被觀測，連續至少 3 個台北日未回訪', new: '近期建立帳號的新旅人', engaged: '近 14 天活躍至少 7 日' };
  setView(`<div class="audience-summary">${Object.keys(segmentLabels).map(segment => `<button type="button" class="segment-card" data-segment="${segment}" aria-pressed="${S.segment === segment}"><span class="segment-icon" aria-hidden="true">${segment === 'risk' ? '◷' : segment === 'new' ? '✧' : '↗'}</span><strong>${segmentLabels[segment]}</strong><p>${descriptions[segment]}</p></button>`).join('')}</div><div class="observation-note"><span aria-hidden="true">◎</span><span>分群以帳號為單位，每個帳號顯示一位代表角色，避免重複發獎。這是觀測訊號，並非對玩家意圖的判定。</span></div>${selectionTray()}${panel(segmentLabels[S.segment], `${descriptions[S.segment]} · 已載入 ${number(S.audience.length)} 位`, `${playerTable(S.audience, true)}${moreError ? `<p class="error-text" role="status">${escapeHtml(moreError)} 可重試同一頁。</p>` : ''}${S.audienceCursor ? `<div class="load-more"><button type="button" class="button" id="audience-more" ${loadingMore ? 'disabled' : ''}>${loadingMore ? '載入中…' : moreError ? '重試載入下一頁' : '載入更多旅人'}</button></div>` : ''}`)}`);
  $$('[data-segment]').forEach(button => button.addEventListener('click', () => { S.segment = button.dataset.segment; loadAudience(false); }));
  $('#audience-more')?.addEventListener('click', () => loadAudience(true));
  wireSelection(S.audience, true, renderAudiencePage);
}
async function loadAudience(more) {
  const segment = S.segment;
  const cursor = more ? S.audienceCursor : undefined;
  const token = requestToken('audience');
  if (more) renderAudiencePage({ loadingMore: true });
  else { S.audience = []; S.audienceCursor = null; loading('正在辨識符合條件的旅人…'); }
  try {
    const data = await api('segments', { segment, ...(cursor ? { cursor } : {}) });
    if (!isCurrent(token, 'audience') || segment !== S.segment) return;
    S.audience = more ? uniqueBy([...S.audience, ...(data.items || [])], 'account') : data.items || [];
    S.audienceCursor = data.nextCursor || null;
    renderAudiencePage();
  } catch (error) {
    if (!isCurrent(token, 'audience') || segment !== S.segment) return;
    if (more) renderAudiencePage({ moreError: friendlyError(error) });
    else errorView(error, () => loadAudience(false));
  }
}

async function showPlayer(id) {
  showModal('角色近況', '<div class="loading-state"><span class="spinner" aria-hidden="true"></span>正在讀取角色…</div>');
  const token = requestToken('player-detail');
  try {
    const data = await api('player', { id: String(id) });
    if (!isCurrent(token, 'player-detail') || !$('#modal').open) return;
    const player = data.character || {};
    const fields = [['角色 ID', player.id], ['帳號 ID', player.accountId], ['等級', `Lv.${number(player.level)}`], ['職業', `${className(player.baseClass)}${player.classPath ? ' · '+player.classPath : ''}`], ['持有金幣', number(player.gold)], ['建立時間', dateTime(player.createdAt)]];
    const behavior = data.behavior || [];
    const inventory = data.inventory || [];
    const ledger = data.ledger || [];
    showModal(player.name || '角色近況', `<p class="small muted">只讀查詢，不會改動角色當前配置與隊伍。</p><dl class="detail-grid">${fields.map(([label, value]) => `<div class="detail-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? '—')}</dd></div>`).join('')}</dl><section class="dialog-section"><h3>已觀測的玩法足跡</h3>${behavior.length ? `<div class="table-wrap"><table><thead><tr><th>行為</th><th>活躍日</th><th>最後使用</th></tr></thead><tbody>${behavior.map(row => `<tr><td>${escapeHtml(row.label || row.event)}</td><td>${number(row.activeDays)}</td><td>${escapeHtml(dateTime(row.lastAt))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">目前尚無觀測紀錄，不代表這位玩家從未使用遊戲。</p>'}</section><section class="dialog-section"><h3>道具數量</h3>${inventory.length ? `<div class="table-wrap"><table><thead><tr><th>道具</th><th>數量</th></tr></thead><tbody>${inventory.map(row => `<tr><td class="wrap">${escapeHtml(catalogName(row.item))}</td><td>${number(row.quantity)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">沒有可顯示的道具。</p>'}</section><section class="dialog-section"><h3>近期金幣帳本</h3>${ledger.length ? `<div class="table-wrap"><table><thead><tr><th>類型</th><th>金額</th><th>時間</th></tr></thead><tbody>${ledger.map(row => `<tr><td class="wrap">${escapeHtml(row.type || row.reason || row.kind || '帳本紀錄')}</td><td>${number(row.gold_delta ?? row.amount ?? row.gold ?? row.delta)}</td><td>${escapeHtml(dateTime(row.createdAt ?? row.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">尚無可顯示的帳本紀錄。</p>'}</section>`, `<button type="button" class="button ghost" data-close>關閉</button><button type="button" class="button primary" id="detail-select" ${selectable(player.id) ? '' : 'disabled'}>${S.selected.has(String(player.id)) ? '已在收件名單' : '加入獎勵收件人'}</button>`);
    $('#detail-select').addEventListener('click', () => {
      if (!selectable(player.id)) return;
      S.selected.set(String(player.id), { id: player.id, name: player.name, accountId: player.accountId, level: player.level });
      S.preview = null;
      selectedBadge();
      $('#detail-select').textContent = '已在收件名單';
      toast(`已選取 ${player.name || player.id}，可至獎勵發放頁核對。`);
    });
  } catch (error) {
    if (!isCurrent(token, 'player-detail') || !$('#modal').open) return;
    showModal('角色資料尚未載入', `<p class="error-text">${escapeHtml(friendlyError(error))}</p>`, '<button type="button" class="button ghost" data-close>關閉</button><button type="button" class="button" id="detail-retry">重試</button>');
    $('#detail-retry').addEventListener('click', () => showPlayer(id));
  }
}

function catalogName(id) { return S.catalog?.find(item => item.id === id)?.name || id || '—'; }
function captureRewardDraft() {
  if (!$('#reward-form') || S.pendingGrant || S.uncertainReference) return;
  S.rewardDraft = { gold: $('#reward-gold').value, item: $('#reward-item').value || null, qty: $('#reward-qty').value, reason: $('#reward-reason').value };
}
function rewardPayload() {
  const gold = Number($('#reward-gold').value);
  const item = $('#reward-item').value || null;
  const qty = item ? Number($('#reward-qty').value) : 0;
  const reason = $('#reward-reason').value.trim();
  if (S.selected.size < 1 || S.selected.size > 20) throw new Error('請先選取 1–20 位角色。');
  if (!Number.isInteger(gold) || gold < 0 || gold > 1000000) throw new Error('每位角色金幣須為 0–1,000,000 的整數。');
  if (item && (!Number.isInteger(qty) || qty < 1 || qty > 999)) throw new Error('每位角色道具數量須為 1–999。');
  if (!gold && !item) throw new Error('請至少選擇金幣或一種道具。');
  if (reason.length < 3 || reason.length > 100) throw new Error('發放原因請填寫 3–100 字。');
  if (/[\u0000-\u001f\u007f]/.test(reason)) throw new Error('發放原因請使用單段文字，不含換行或控制字元。');
  return { charIds: [...S.selected.values()].map(player => player.id), gold, item, qty, reason };
}

async function renderRewards() {
  if (!S.admin || S.tab !== 'rewards') return;
  const token = requestToken('catalog');
  if (!S.catalog) {
    loading('正在讀取可發放道具…');
    try {
      const data = await api('catalog', {});
      if (!isCurrent(token, 'catalog')) return;
      S.catalog = data.items || [];
    } catch (error) { if (isCurrent(token, 'catalog')) errorView(error, renderRewards); return; }
  }
  const locked = !!S.pendingGrant || !!S.uncertainReference;
  const payload = S.pendingGrant?.payload || S.rewardDraft;
  const recipients = [...S.selected.values()];
  setView(`${S.lastGrant ? `<div class="success-banner"><strong>獎勵已發放，收據已建立</strong><p>收據 <span class="mono">${escapeHtml(S.lastGrant.id)}</span> · ${escapeHtml(dateTime(S.lastGrant.createdAt))} · ${escapeHtml(number(Array.isArray(S.lastGrant.targets) ? S.lastGrant.targets.length : S.lastGrant.targets))} 位角色</p><p>可在操作紀錄回查，不需要再次送出。</p></div>` : ''}${S.uncertainReference ? `<div class="locked-state"><h3>先核對上一筆發獎結果</h3><p>登入前有一筆回覆尚未確認。操作編號 <span class="mono">${escapeHtml(S.uncertainReference)}</span>。這裡不會自動再發一筆。</p><button type="button" class="button primary" id="check-grant-status">查詢原操作收據</button><div id="grant-status-message" role="status"></div></div>` : ''}${S.pendingGrant ? `<div class="locked-state"><h3>這筆獎勵正在等待結果確認</h3><p>已鎖住收件人、內容與操作編號。請用原單重試，伺服器會依相同收據防止重複發放。</p><p class="mono small">${escapeHtml(S.pendingGrant.requestId)}</p><div class="button-row"><button type="button" class="button primary" id="retry-grant">核對並重試原單</button><button type="button" class="button ghost" id="check-pending-status">查詢原單收據</button><button type="button" class="button ghost" id="pending-detail">檢視原單內容</button></div><div id="grant-pending-error" role="status"></div></div>` : ''}<div class="reward-layout"><div class="panel"><header class="panel-header"><div><h2>建立獎勵</h2><p class="panel-subtitle">每位角色各自收到下列數量</p></div><span class="badge">逐次確認</span></header><div class="field"><span class="label">收件角色 <span class="gold">${recipients.length}／20</span></span>${recipients.length ? `<div class="recipient-list">${recipients.map(player => `<div class="recipient"><span>${escapeHtml(player.name)}<small class="mono"> #${escapeHtml(player.id)}</small></span><button type="button" data-remove-recipient="${escapeHtml(player.id)}" aria-label="移除收件人 ${escapeHtml(player.name)}" ${locked ? 'disabled' : ''}>×</button></div>`).join('')}</div>` : '<p class="hint">尚未選取角色。請從玩家查詢或旅人洞察加入收件人。</p>'}<button type="button" class="button ghost compact" id="choose-recipients" ${locked ? 'disabled' : ''}>＋ 從玩家清單選取</button></div><form id="reward-form"><fieldset ${locked ? 'disabled' : ''} style="border:0;padding:0;margin:0;min-width:0"><div class="form-grid"><div class="field full"><label for="reward-gold">金幣／每位角色</label><input id="reward-gold" type="number" min="0" max="1000000" step="1" value="${escapeHtml(payload?.gold || 0)}" inputmode="numeric" required><span class="hint">最高 1,000,000 金幣；本頁只新增獎勵，不會扣除玩家資產。</span></div><div class="field"><label for="reward-item">額外道具（選填一種）</label><select id="reward-item"><option value="">不發道具</option>${S.catalog.map(item => `<option value="${escapeHtml(item.id)}" ${payload?.item === item.id ? 'selected' : ''}>${escapeHtml(item.emoji || '')} ${escapeHtml(item.name)}</option>`).join('')}</select></div><div class="field"><label for="reward-qty">道具數量／每位角色</label><input id="reward-qty" type="number" min="1" max="999" step="1" value="${escapeHtml(payload?.qty || 1)}" inputmode="numeric" ${payload?.item ? '' : 'disabled'}></div><div class="field full"><label for="reward-reason">發放原因</label><textarea id="reward-reason" minlength="3" maxlength="100" required placeholder="例如：活動參與獎勵、已核對的異常補償">${escapeHtml(payload?.reason || '')}</textarea><span class="hint">3–100 字。會寫入稽核紀錄，請勿填入個資或管理機密。</span></div></div><button type="submit" class="button primary" ${!recipients.length ? 'disabled' : ''}>預覽發放清單 →</button></fieldset><p id="reward-error" class="error-text" role="status"></p></form></div><aside>${panel('發獎前的三次核對', '', '<ol class="step-list"><li>選取正確角色<small>同帳號可能有多位角色；請核對角色 ID。</small></li><li>檢視伺服器預覽<small>確認每位數量、全批總量與發放原因。</small></li><li>輸入確認文字後送出<small>不會因預覽、切換頁面或重新整理而自動發獎。</small></li></ol>')}<section class="panel section-gap"><h3>作業界線</h3><p class="small muted">發獎不變更等級、裝備配置、隊伍快照或戰鬥狀態。僅可使用伺服器白名單中的道具。</p><p class="small muted">連線中斷時保留同一筆操作重試，不另產生補發。若頁面關閉使原單遺失，請先查操作紀錄。</p><button type="button" class="text-button" id="go-audit">查看操作紀錄 →</button></section></aside></div>`);
  $('#choose-recipients').addEventListener('click', () => switchTab('players'));
  $('#go-audit').addEventListener('click', () => switchTab('audit'));
  $$('[data-remove-recipient]').forEach(button => button.addEventListener('click', () => { S.selected.delete(button.dataset.removeRecipient); S.preview = null; selectedBadge(); renderRewards(); }));
  $('#reward-item').addEventListener('change', () => { $('#reward-qty').disabled = !$('#reward-item').value; S.preview = null; });
  $('#reward-form').addEventListener('input', captureRewardDraft);
  $('#reward-form').addEventListener('change', captureRewardDraft);
  $('#reward-form').addEventListener('submit', previewGrant);
  $('#retry-grant')?.addEventListener('click', () => commitGrant(true));
  $('#pending-detail')?.addEventListener('click', () => showGrantPreview(S.pendingGrant, true));
  $('#check-pending-status')?.addEventListener('click', checkPendingGrant);
  $('#check-grant-status')?.addEventListener('click', checkUncertainGrant);
}

async function previewGrant(event) {
  event.preventDefault();
  if (S.pendingGrant || S.uncertainReference) return;
  const button = $('#reward-form button[type="submit"]');
  const token = requestToken('grant-preview');
  $('#reward-error').textContent = '';
  let payload;
  try { payload = rewardPayload(); } catch (error) { $('#reward-error').textContent = error.message; return; }
  button.disabled = true;
  button.textContent = '正在核對收件人…';
  try {
    const data = await api('grant/preview', payload);
    if (!isCurrent(token, 'grant-preview')) return;
    if (!data.preview?.ticket || !data.preview?.payload) throw new Error('伺服器未回傳有效預覽，沒有送出任何獎勵。');
    S.preview = data.preview;
    showGrantPreview(S.preview);
  } catch (error) { if (isCurrent(token, 'grant-preview')) $('#reward-error').textContent = friendlyError(error); }
  finally { if (isCurrent(token, 'grant-preview')) { button.disabled = false; button.textContent = '預覽發放清單 →'; } }
}

function previewBody(preview) {
  const payload = preview.payload;
  const targets = preview.targets || S.preview?.targets || [];
  const totalGold = preview.totals?.gold ?? Number(payload.gold) * payload.charIds.length;
  const totalQty = preview.totals?.qty ?? Number(payload.qty) * payload.charIds.length;
  return `<p class="small muted">以下為伺服器核對的發放內容，請逐項確認。</p><dl class="summary-list"><div><dt>收件人數</dt><dd>${number(payload.charIds.length)} 位角色</dd></div><div><dt>每位金幣</dt><dd class="gold">${number(payload.gold)}</dd></div><div><dt>每位道具</dt><dd>${payload.item ? `${escapeHtml(catalogName(payload.item))} × ${number(payload.qty)}` : '無'}</dd></div><div><dt>整批總量</dt><dd>${number(totalGold)} 金幣${payload.item ? ` ＋ ${number(totalQty)} 件道具` : ''}</dd></div><div><dt>發放原因</dt><dd>${escapeHtml(payload.reason)}</dd></div></dl><section class="dialog-section"><h3>收件名單</h3><div class="table-wrap"><table><thead><tr><th>角色</th><th>角色 ID</th><th>帳號 ID</th></tr></thead><tbody>${targets.map(player => `<tr><td>${escapeHtml(player.name)}<br><span class="player-meta">Lv.${number(player.level)}</span></td><td class="mono">${escapeHtml(player.id)}</td><td class="mono">${escapeHtml(player.accountId)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function showGrantPreview(preview, readOnly = false, original = null) {
  const expiresAt = preview.expiresAt || S.preview?.expiresAt;
  const body = previewBody(preview) + (readOnly ? `<p class="warning-box">此為已送出且結果待確認的原單。操作編號 <span class="mono">${escapeHtml(preview.requestId)}</span>；請回發獎頁使用原單重試。</p>` : `<div class="warning-box">預覽有效至 ${escapeHtml(dateTime(expiresAt))}。確認後將直接入袋，請核對收件人、數量與原因。</div><label class="label" for="grant-confirm-text">輸入「發放」確認這批獎勵</label><input id="grant-confirm-text" class="confirm-input" autocomplete="off" placeholder="發放"><p id="grant-confirm-error" class="error-text" role="status"></p>`);
  showModal(readOnly ? '待確認的原單' : '最後核對 · 獎勵發放', body, readOnly ? '<button type="button" class="button" data-close>返回</button>' : '<button type="button" class="button ghost" data-close>返回修改</button><button type="button" class="button primary" id="confirm-grant" disabled>確認發放</button>');
  if (readOnly) return;
  $('#grant-confirm-text').addEventListener('input', () => { $('#confirm-grant').disabled = $('#grant-confirm-text').value.trim() !== '發放'; });
  $('#confirm-grant').addEventListener('click', () => {
    if ($('#grant-confirm-text').value.trim() !== '發放' || S.uncertainReference || (S.pendingGrant && S.pendingGrant !== original)) return;
    if (Number.isFinite(absoluteTime(expiresAt)) && Date.now() >= absoluteTime(expiresAt)) { $('#grant-confirm-error').textContent = '這份預覽已逾時，請關閉後重新預覽。'; return; }
    if (original) {
      // Explicit recovery of the unchanged original. A new ticket never means a new award ID.
      if (S.pendingGrant !== original || JSON.stringify(original.payload) !== JSON.stringify(preview.payload)) { $('#grant-confirm-error').textContent = '原單內容不一致，請保留操作編號並查核紀錄。'; return; }
      Object.assign(original, { ticket: preview.ticket, targets: structuredClone(preview.targets || []), totals: structuredClone(preview.totals || {}), expiresAt: preview.expiresAt, canRenew: false });
    } else {
      S.pendingGrant = { requestId: crypto.randomUUID(), ticket: preview.ticket, payload: structuredClone(preview.payload), targets: structuredClone(preview.targets || []), totals: structuredClone(preview.totals || {}), expiresAt: preview.expiresAt };
    }
    hideModal();
    commitGrant(false);
  });
}

async function commitGrant(retry) {
  const pending = S.pendingGrant;
  if (!pending || pending.inFlight || !S.admin) return;
  const epoch = S.epoch;
  pending.inFlight = true;
  if (S.tab === 'rewards') await renderRewards();
  if (S.tab === 'rewards') {
    $('#retry-grant').disabled = true;
    $('#retry-grant').textContent = retry ? '正在核對原操作…' : '正在發放並建立收據…';
  }
  try {
    const data = await api('grant/commit', { requestId: pending.requestId, ticket: pending.ticket, payload: pending.payload });
    if (epoch !== S.epoch || S.pendingGrant !== pending) return;
    if (!data.grant?.id) throw new Error('尚未收到完整發獎收據，請保留原單核對。');
    S.lastGrant = data.grant;
    S.pendingGrant = null; S.preview = null; S.selected.clear(); S.uncertainReference = null;
    S.rewardDraft = { gold: 0, item: null, qty: 1, reason: '' };
    selectedBadge();
    if (S.tab === 'rewards') await renderRewards();
    toast(`獎勵已發放，收據 ${data.grant.id}`);
  } catch (error) {
    if (epoch !== S.epoch || S.pendingGrant !== pending) return;
    pending.error = friendlyError(error);
    if (S.tab === 'rewards') {
      await renderRewards();
      $('#grant-pending-error').innerHTML = `<p class="error-text">${escapeHtml(pending.error)} 請保留此頁，使用同一筆操作核對。</p>`;
    } else notice(`發獎結果尚未確認，請到獎勵發放頁核對原單 ${pending.requestId}。`, true);
  } finally {
    pending.inFlight = false;
    if (epoch === S.epoch && S.pendingGrant === pending && S.tab === 'rewards') {
      $('#retry-grant').disabled = false;
      $('#retry-grant').textContent = '核對並重試原單';
    }
  }
}

async function checkPendingGrant() {
  const pending = S.pendingGrant;
  if (!pending || pending.inFlight || !S.admin) return;
  const token = requestToken('pending-status');
  $('#check-pending-status').disabled = true;
  $('#grant-pending-error').textContent = '正在核對原操作的已提交收據…';
  try {
    const data = await api('grant/status', { requestId: pending.requestId });
    if (!isCurrent(token, 'pending-status') || S.pendingGrant !== pending) return;
    if (data.grant) {
      S.lastGrant = data.grant;
      S.pendingGrant = null; S.preview = null; S.selected.clear(); S.uncertainReference = null;
      S.rewardDraft = { gold: 0, item: null, qty: 1, reason: '' };
      selectedBadge();
      await renderRewards();
      toast('已找到原操作收據，沒有新增第二筆獎勵。');
      return;
    }
    const expired = Number.isFinite(absoluteTime(pending.expiresAt)) && Date.now() >= absoluteTime(pending.expiresAt);
    $('#grant-pending-error').innerHTML = `<p class="small muted">目前查無已提交收據。${expired ? '原預覽已過期，可用完全相同內容重新預覽；確認後仍沿用原操作編號。' : '請保留原單，稍後核對或重試。'}</p>${expired ? '<button type="button" class="button" id="renew-original-preview">原內容重新預覽</button>' : ''}`;
    $('#renew-original-preview')?.addEventListener('click', () => renewOriginalPreview(pending));
  } catch (error) {
    if (isCurrent(token, 'pending-status') && S.pendingGrant === pending) $('#grant-pending-error').innerHTML = `<p class="error-text">${escapeHtml(friendlyError(error))}</p>`;
  } finally {
    if (isCurrent(token, 'pending-status') && $('#check-pending-status')) $('#check-pending-status').disabled = false;
  }
}

async function renewOriginalPreview(pending) {
  if (S.pendingGrant !== pending || pending.inFlight || !S.admin) return;
  const token = requestToken('renew-preview');
  $('#renew-original-preview').disabled = true;
  try {
    const data = await api('grant/preview', pending.payload);
    if (!isCurrent(token, 'renew-preview') || S.pendingGrant !== pending) return;
    if (!data.preview?.ticket || JSON.stringify(data.preview.payload) !== JSON.stringify(pending.payload)) throw new Error('原單內容不一致，請保留操作編號並查核紀錄。');
    showGrantPreview(data.preview, false, pending);
  } catch (error) {
    if (isCurrent(token, 'renew-preview') && S.pendingGrant === pending) $('#grant-pending-error').innerHTML = `<p class="error-text">${escapeHtml(friendlyError(error))} 原單仍已保留，沒有更換操作編號。</p>`;
  } finally { if (isCurrent(token, 'renew-preview') && $('#renew-original-preview')) $('#renew-original-preview').disabled = false; }
}

async function checkUncertainGrant() {
  const id = S.uncertainReference;
  if (!id || !S.admin) return;
  const token = requestToken('grant-status');
  $('#check-grant-status').disabled = true;
  $('#grant-status-message').textContent = '正在查詢已提交收據…';
  try {
    const data = await api('grant/status', { requestId: id });
    if (!isCurrent(token, 'grant-status') || id !== S.uncertainReference) return;
    if (data.grant) {
      S.lastGrant = data.grant; S.uncertainReference = null; S.pendingGrant = null; S.preview = null; S.selected.clear(); selectedBadge();
      await renderRewards();
      toast('已確認原獎勵發放成功，沒有新增第二筆。');
    } else {
      $('#grant-status-message').innerHTML = '<p class="small muted">目前查無已提交收據。原單內容已在驗證失效時清除，不能自動重試或換新編號補發；請再核對操作紀錄後，由管理員決定是否重新建立。</p><button type="button" class="button ghost compact" id="acknowledge-grant">我已核對紀錄，解除待查提示</button>';
      $('#acknowledge-grant').addEventListener('click', () => {
        if (S.uncertainReference !== id) return;
        S.uncertainReference = null;
        renderRewards();
        toast('已解除提示；尚未發放任何新獎勵。');
      });
    }
  } catch (error) {
    if (isCurrent(token, 'grant-status')) $('#grant-status-message').innerHTML = `<p class="error-text">${escapeHtml(friendlyError(error))}</p>`;
  } finally { if (isCurrent(token, 'grant-status') && $('#check-grant-status')) $('#check-grant-status').disabled = false; }
}

async function loadTeams() {
  const token = requestToken('teams');
  $('#page-actions').innerHTML = '<button type="button" class="button ghost compact" id="refresh-teams">↻ 更新隊伍</button>';
  $('#refresh-teams').addEventListener('click', loadTeams);
  loading('正在查詢隊伍狀況…');
  try {
    const data = await api('teams', {});
    if (!isCurrent(token, 'teams')) return;
    const items = data.items || [];
    const running = items.filter(item => ['running', 'combat'].includes(item.status)).length;
    const lobby = items.filter(item => item.status === 'lobby').length;
    setView(`<div class="observation-note"><span aria-hidden="true">⚑</span><span>只讀監看，不執行推進、重置、發獎或終止操作。此處顯示 API 回傳範圍內的隊伍，不是全部歷史總量。</span></div><div class="kpi-grid">${kpi('目前載入隊伍', items.length, '最新查詢回傳範圍')}${kpi('戰鬥進行中', running, '由原本的伺服器排程處理', true)}${kpi('等待同行旅人', lobby, '隊伍仍在招募中')}${kpi('其他狀態', items.length - running - lobby, '完成、結束或其他狀態')}</div>${panel('隊伍動態', '需要最新狀態時請按右上方更新', items.length ? `<div class="table-wrap"><table><thead><tr><th>玩法／隊伍</th><th>狀態</th><th>隊長角色</th><th>階級</th><th>建立</th><th>最後更新</th></tr></thead><tbody>${items.map(item => `<tr><td><span class="player-name">${escapeHtml(modeLabels[item.kind] || modeLabels[item.mode] || item.mode || item.kind || '組隊活動')}</span><span class="player-meta mono">${escapeHtml(item.id)}</span></td><td><span class="badge ${['running', 'combat'].includes(item.status) ? 'green' : item.status === 'lobby' ? 'blue' : ''}">${escapeHtml(statusLabels[item.status] || item.status)}</span></td><td class="mono">${escapeHtml(item.leaderId)}</td><td>${escapeHtml(item.tier ?? '—')}</td><td class="nowrap">${escapeHtml(dateTime(item.createdAt))}</td><td class="nowrap">${escapeHtml(dateTime(item.updatedAt))}</td></tr>`).join('')}</tbody></table></div>` : empty('目前沒有可顯示的隊伍', '建立或更新隊伍後，可再次查詢。'))}`);
  } catch (error) { if (isCurrent(token, 'teams')) errorView(error, loadTeams); }
}

function renderAuditPage({ moreError = '', loadingMore = false } = {}) {
  const items = S.audit;
  setView(`<div class="observation-note"><span aria-hidden="true">≡</span><span>管理員操作的時間、原因與結果留存於伺服器。若發獎回覆中斷，先比對原操作編號與已建立收據。</span></div>${panel('管理作業紀錄', `已載入 ${number(items.length)} 筆`, `${items.length ? `<div class="table-wrap"><table><thead><tr><th>時間</th><th>管理員</th><th>操作</th><th>紀錄編號</th><th>內容</th></tr></thead><tbody>${items.map((item, index) => `<tr><td class="nowrap">${escapeHtml(dateTime(item.createdAt))}</td><td class="mono">${escapeHtml(item.adminId)}</td><td>${escapeHtml(auditLabel(item.action))}</td><td class="mono small">${escapeHtml(item.id)}</td><td><button type="button" class="button ghost compact" data-audit-detail="${index}">檢視內容</button></td></tr>`).join('')}</tbody></table></div>` : empty('尚無管理作業紀錄', '完成管理操作後，會在這裡留下可回查的紀錄。')}${moreError ? `<p class="error-text" role="status">${escapeHtml(moreError)} 可重試同一頁。</p>` : ''}${S.auditCursor ? `<div class="load-more"><button type="button" class="button" id="audit-more" ${loadingMore ? 'disabled' : ''}>${loadingMore ? '載入中…' : moreError ? '重試載入下一頁' : '載入較早紀錄'}</button></div>` : ''}`)}`);
  $('#audit-more')?.addEventListener('click', () => loadAudit(true));
  $$('[data-audit-detail]').forEach(button => button.addEventListener('click', () => {
    const item = items[Number(button.dataset.auditDetail)];
    let detail = item.details;
    if (typeof detail === 'string') { try { detail = JSON.parse(detail); } catch {} }
    showModal(auditLabel(item.action), `<dl class="summary-list"><div><dt>紀錄編號</dt><dd class="mono">${escapeHtml(item.id)}</dd></div><div><dt>管理員</dt><dd class="mono">${escapeHtml(item.adminId)}</dd></div><div><dt>時間（台北）</dt><dd>${escapeHtml(dateTime(item.createdAt))}</dd></div></dl><section class="dialog-section"><h3>原始操作內容</h3><pre class="audit-details">${escapeHtml(typeof detail === 'object' ? JSON.stringify(detail, null, 2) : detail)}</pre></section>`, '<button type="button" class="button" data-close>關閉</button>');
  }));
}
function auditLabel(action) {
  return ({ grant: '發放獎勵', reward_grant: '發放獎勵', 'grant.commit': '發放獎勵', login: '管理員登入', logout: '管理員登出', 'login.approve': '批准瀏覽器登入' })[action] || action || '管理操作';
}
async function loadAudit(more) {
  const cursor = more ? S.auditCursor : undefined;
  const token = requestToken('audit');
  $('#page-actions').innerHTML = '<button type="button" class="button ghost compact" id="refresh-audit">↻ 更新紀錄</button>';
  $('#refresh-audit').addEventListener('click', () => loadAudit(false));
  if (more) renderAuditPage({ loadingMore: true });
  else { S.audit = []; S.auditCursor = null; loading('正在讀取管理作業紀錄…'); }
  try {
    const data = await api('audit', { ...(cursor ? { cursor } : {}) });
    if (!isCurrent(token, 'audit')) return;
    S.audit = more ? uniqueBy([...S.audit, ...(data.items || [])], 'id') : data.items || [];
    S.auditCursor = data.nextCursor || null;
    renderAuditPage();
  } catch (error) {
    if (!isCurrent(token, 'audit')) return;
    if (more) renderAuditPage({ moreError: friendlyError(error) });
    else errorView(error, () => loadAudit(false));
  }
}

$('#navigation').addEventListener('click', event => {
  const button = event.target.closest('[data-tab]');
  if (button) switchTab(button.dataset.tab);
});
$('#logout').addEventListener('click', async event => {
  if (!S.admin) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('logout', {});
    lockSession('已登出，管理資料已從此頁清除。');
  } catch (error) {
    if (S.admin) notice(`登出尚未完成：${friendlyError(error)} 請重試，確保伺服器工作階段已清除。`, true);
  } finally { button.disabled = false; }
});
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const bounds = $('#modal').getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) hideModal(); } });
$('#modal').addEventListener('close', () => { if (!$('#modal').open) S.requestVersions.set('player-detail', (S.requestVersions.get('player-detail') || 0) + 1); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoginPolling(); else if (S.poll) pollBrowserLogin(); });
window.addEventListener('pagehide', () => stopLoginPolling({ forget: true }));
window.addEventListener('beforeunload', event => {
  if (S.pendingGrant) { event.preventDefault(); event.returnValue = ''; }
});

async function boot() {
  window.Telegram?.WebApp?.ready?.();
  $('#auth-content').innerHTML = '<div class="auth-loading"><span class="spinner" aria-hidden="true"></span>正在驗證工作階段…</div>';
  if (approveChallenge()) { await renderLogin(); return; }
  try {
    const data = await api('session', undefined, { method: 'GET', auth: false });
    await enterSession(data.admin);
  } catch (error) {
    if ([401, 403].includes(error.status)) await renderLogin();
    else await renderLogin(friendlyError(error));
  }
}
boot();
