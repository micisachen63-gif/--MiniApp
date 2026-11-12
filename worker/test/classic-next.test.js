// /classic-next: classic shell + current battle scene in the home frame (owner t702u/t703u, 2026-11-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const app = read('app.js'), atlas = read('atlas-ui.js'), widgets = read('special-skill-widgets.js');
const next = read('classic-next.html'), classic = read('classic.html');
const frameJs = read('classic-next-battle.js');
const SCENE = 'ui-generated-20261030/scene-bound-20261102/';
const sceneHtml = read(SCENE + 'scene.html'), embedJs = read(SCENE + 'embed-battle.js');

function fakeTimers() {
  const intervals = [], timeouts = [];
  return {
    intervals, timeouts,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}, setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return 1000 + timeouts.length; }, clearTimeout() {},
    async advance(ms) { for (const t of intervals) for (let at = t.ms; at <= ms; at += t.ms) await t.fn(); },
  };
}

test('classic-next.html is the classic shell with the next flag, dark only, and the battle frame module before app.js', () => {
  const flag = next.indexOf('window.RPG_CLASSIC_NEXT=true'), appAt = next.indexOf('src="app.js'), frameAt = next.indexOf('src="classic-next-battle.js');
  assert.ok(flag > 0 && flag < appAt && flag < next.indexOf('src="atlas-ui.js') && flag < next.indexOf('src="special-skill-widgets.js'));
  assert.ok(frameAt > 0 && frameAt < appAt);
  assert.match(next, /<meta name="color-scheme" content="dark">/);
  assert.doesNotMatch(next, /content="dark light"/);
  // The same classic page set: every classic script and stylesheet is still loaded.
  const assets = html => [...html.matchAll(/(?:src|href)="([^"?]+)/g)].map(m => m[1]);
  for (const asset of assets(classic)) assert.ok(assets(next).includes(asset), 'classic asset kept: ' + asset);
  // /classic itself is untouched by the flag.
  assert.doesNotMatch(classic, /RPG_CLASSIC_NEXT/);
});

test('/classic-next opens on home, never the Atlas workspace, and the theme stays dark', () => {
  assert.match(app, /const NEXT = window\.RPG_CLASSIC_NEXT === true;/);
  assert.match(app, /pendingTab: NEXT \? 'home' : 'atlas'/);
  assert.match(app, /tab: NEXT \? 'home' : 'atlas'/);
  assert.match(app, /\[spx\] \|\| \(NEXT \? 'home' : 'atlas'\)/);
  assert.match(app, /S\.tab=NEXT\?'home':'atlas';render\(\);\}/);
  assert.match(app, /S\.pendingTab=NEXT\?'home':'atlas';S\.tab=S\.pendingTab;/);
  assert.match(app, /const light = !NEXT && tg && tg\.colorScheme === 'light';/);
  assert.match(app, /RpgAtlasUI\?\.mount\(\{overlayOnly:NEXT,/);
});

// The timer block of app.js, executed with fake timers: a long idle home screen must not read anything.
function appTimers(NEXT, state = {}) {
  const a = app.indexOf("  if(!NEXT)setInterval(()=>{if(!document.hidden&&S.tab==='trade'&&S.social==='hall')loadHeroes()},300000);");
  const b = app.indexOf('\n', app.indexOf("document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me", a));
  const c = app.indexOf('  let autoPollBusy=false,autoPollAt=0;'), d = app.indexOf('\n', app.indexOf('setInterval(async()=>{const viewing=', c));
  assert.ok(a > 0 && b > a && c > 0 && d > c, 'timer blocks found');
  const calls = [], timers = fakeTimers(), listeners = {};
  const rec = name => (...args) => { calls.push(name); return Promise.resolve(null); };
  const S = { me: { character: { tgId: 'hero' }, nextBoss: null }, tab: 'home', social: 'trade', choosing: false, creating: false, busy: false, backgroundJobs: [], ...state };
  const sheet = { hidden: true }, document = { hidden: false, querySelectorAll: () => [], addEventListener: (type, fn) => { listeners[type] = fn; } };
  const context = vm.createContext({ NEXT, S, document, ...timers, Date,
    $: sel => sel === '#sheet' ? sheet : null, equipmentSync: { pending: () => false }, window: { RpgAutoRerollUI: { viewing: () => false } },
    refreshMe: rec('refreshMe'), loadBoss: rec('loadBoss'), loadLedger: rec('loadLedger'), loadHeroes: rec('loadHeroes'), loadTrades: rec('loadTrades'), loadTrade: rec('loadTrade'), loadPks: rec('loadPks'),
    loadShop: rec('loadShop'), syncBackground: rec('syncBackground'), autoPanel: rec('autoPanel'), sNow: () => Date.now(), mmss: String });
  vm.runInContext(app.slice(c, d) + app.slice(a, b), context);
  return { calls, timers, listeners, S, document };
}

test('fake timers: the /classic-next home screen has no timed sync (classic control still polls every 30 s)', async () => {
  const nextHome = appTimers(true);
  assert.equal(nextHome.timers.intervals.some(t => t.ms >= 20000), false, 'no 30 s home or 5 min hall interval is registered');
  await nextHome.timers.advance(10 * 60 * 1000);
  assert.deepEqual(nextHome.calls, [], 'ten idle minutes on home: no reads at all');
  nextHome.listeners.visibilitychange();
  assert.deepEqual(nextHome.calls, [], 'returning to the app does not refresh either');
  const hall = appTimers(true, { tab: 'trade', social: 'hall' });
  await hall.timers.advance(10 * 60 * 1000);
  assert.equal(hall.calls.includes('loadHeroes'), false, 'hero hall loads on open only');

  const control = appTimers(false);
  await control.timers.advance(60 * 1000);
  assert.ok(control.calls.filter(c => c === 'refreshMe').length >= 2, 'the classic page keeps its original 30 s sync');
});

test('fake timers: per-window refresh stays only while that window is open', async () => {
  const boss = appTimers(true, { tab: 'boss' });
  await boss.timers.advance(16000);
  assert.ok(boss.calls.filter(c => c === 'loadBoss').length >= 2, 'boss window: every 8 s');
  const trade = appTimers(true, { tab: 'trade', social: 'trade', trade: { id: 't1', status: 'open' } });
  await trade.timers.advance(12000);
  assert.ok(trade.calls.filter(c => c === 'loadTrade').length >= 4, 'open trade: every 3 s');
  // A background auto-enhance job runs, but no progress panel/bag is open: no polling on home.
  const job = [{ refId: 'e1', job: { status: 'running' } }];
  const hidden = appTimers(true, { backgroundJobs: job });
  await hidden.timers.advance(60000);
  assert.deepEqual(hidden.calls, []);
  const viewing = appTimers(true, { backgroundJobs: job, tab: 'bag' });
  await viewing.timers.advance(9000);
  assert.ok(viewing.calls.includes('syncBackground'), 'progress is followed while its window is open');
  const classicJob = appTimers(false, { backgroundJobs: job });
  await classicJob.timers.advance(60000);
  assert.ok(classicJob.calls.includes('syncBackground'), 'classic keeps its 12 s background poll');
});

test('fake timers: special-skill widgets keep their 1 s local cooldown but drop the 30 s refresh on /classic-next', () => {
  for (const flag of [true, false]) {
    const timers = fakeTimers(), window = { RPG_CLASSIC_NEXT: flag, addEventListener() {} };
    vm.runInNewContext(widgets, { window, document: { addEventListener() {}, querySelectorAll: () => [], hidden: false }, ...timers, Date, JSON, Map, Promise });
    assert.deepEqual(timers.intervals.map(t => t.ms).sort((x, y) => x - y), flag ? [1000] : [1000, 30000]);
  }
});

test('Atlas panels on /classic-next: overlay only, no workspace takeover; timed Atlas sync only during an active run', () => {
  assert.match(atlas, /const overlayOnly=host\.overlayOnly===true;/);
  assert.match(atlas, /if\(!overlayOnly\)app\.prepend\(root\);/);
  assert.match(atlas, /if\(!overlayOnly\)\{view\.before\(legacy\); legacy\.append\(view\);\}/);
  assert.match(atlas, /if\(!overlayOnly\)document\.body\.classList\.add\('atlas-enabled'\);root\.hidden=overlayOnly\|\|!next\.meta;/);
  assert.match(atlas, /const atlasLive=\(\)=>!overlayOnly\|\|running\(\)&&host\.frameSync\?\.\(\)!==true;/);
  assert.match(atlas, /const chatPoll=overlayOnly\?0:setInterval\(/);
  assert.match(atlas, /if \(!overlayOnly&&context\.tab !== 'atlas'\) host\.home\(\);/);
  assert.match(atlas, /if\(changed&&!selecting\)\{if\(overlayOnly\)void client\.refresh\(\);else\{void refreshAll\(\);/);
  // One home entry opens 星圖派遣 / 構築 / 任務 through the same panels.
  assert.match(app, /data-next-atlas>/);
  for (const panel of ['expedition', 'build', 'quests']) assert.match(app, new RegExp('data-next-atlas-open="' + panel + '"'));
  assert.match(app, /atlasWorkspace\.open\(b\.dataset\.nextAtlasOpen\)/);
});

test('scene.html?embed=battle skips the window manager, HUD rituals, chat, guide and social windows', () => {
  const loader = sceneHtml.match(/<script>(\/\* Scene windows[\s\S]*?)<\/script><\/body>/)[1];
  for (const name of ['scene-window-manager.js', 'scene-chat-ui.js', 'scene-social-preview.js', 'scene-atlas-guide.js', 'scene-original-rituals.js'])
    assert.equal(sceneHtml.replace(loader, '').includes(name), false, name + ' only via the guarded loader');
  const run = embed => { const written = []; vm.runInNewContext(loader, { window: { __RpgSceneEmbed: embed }, document: { write: s => written.push(s) } }); return written; };
  assert.deepEqual(run('battle'), []);
  const normal = run(undefined);
  assert.equal(normal.length, 8, 'the full scene still loads every window script, in order');
  assert.ok(normal[0].includes('scene-original-rituals.js') && normal.at(-1).includes('scene-social-preview.js') && normal[6].includes('scene-window-manager.js'));
  // The flag is set before any scene script, the adapter right after Phaser and before scene.js.
  const flagAt = sceneHtml.indexOf('window.__RpgSceneEmbed="battle"'), phaser = sceneHtml.indexOf('phaser-3.90.0.min.js'), adapter = sceneHtml.indexOf('embed-battle.js'), scene = sceneHtml.indexOf('scene-bound-20261102/scene.js');
  assert.ok(flagAt > 0 && flagAt < sceneHtml.indexOf('<script src="/ui-generated-20261030/scene-bound-20261102/ui.js"') && phaser < adapter && adapter < scene);
  assert.match(sceneHtml, /telegram:true/);
});

function embedHarness({ embed = 'battle', origin = 'https://elf.example', hud = '' } = {}) {
  const posted = [], listeners = {}, head = [], loop = { running: true, sleep() { this.running = false; }, wake() { this.running = true; } };
  class Game { constructor(config) { this.config = config; this.loop = loop; } }
  const parent = { postMessage: (data, target) => posted.push({ data, target }) };
  const session = { ctx: { characterId: 'a', realmId: 'permanent' }, set: [], syncs: 0, visibility: 0, visibilityChanged() { this.visibility++; }, getContext() { return this.ctx; }, setContext(n) { this.set.push(n); this.ctx = { ...this.ctx, ...n }; }, sync() { this.syncs++; return Promise.resolve(); } };
  const window = { __RpgSceneEmbed: embed, Phaser: { Game }, RpgSceneSession: session, addEventListener: (t, fn) => { listeners[t] = fn; } };
  const timers = fakeTimers();
  const docListeners = {}, classes = new Set(), nodes = { chatLine: { textContent: '' }, ui: { classList: { add: c => classes.add('ui:' + c) } } }, q = { '#chat .ch': { textContent: '世界' }, '#quest .qn': { textContent: '◆ 泰坦的試煉' }, '#quest .qc': { textContent: '0/40' } };
  const document = { createElement: () => ({}), head: { appendChild: n => head.push(n) }, readyState: 'complete', documentElement: { classList: { add: c => classes.add(c) } },
    addEventListener: (t, fn, capture) => { (docListeners[t] ||= []).push({ fn, capture }); }, getElementById: id => nodes[id] || null, querySelector: sel => q[sel] || null };
  vm.runInNewContext(embedJs, { window, parent, location: { origin, search: hud ? '?embed=battle&hud=' + hud : '?embed=battle' }, document, URLSearchParams, ...timers });
  return { window, parent, posted, listeners, head, loop, session, timers, Game, docListeners, classes, nodes, q };
}

test('embed=battle hides every scene UI layer except the target bar, registers no timers, and pauses Phaser', () => {
  const h = embedHarness();
  assert.equal(h.timers.intervals.length + h.timers.timeouts.length, 0);
  const css = h.head[0].textContent;
  assert.match(css, /html\.scene-embed-battle:not\(\.scene-embed-hud\):not\(\.scene-embed-full\) #ui>\*:not\(#target\)\{display:none!important\}/);
  assert.match(css, /\.scene-login-status/);
  const game = new h.window.Phaser.Game({ parent: 'game' });
  assert.equal(h.window.RpgSceneEmbed.game(), game);
  const from = (data, source = h.parent, origin = 'https://elf.example') => h.listeners.message({ data: { source: 'rpg-classic-next', ...data }, source, origin });
  from({ type: 'pause' }); assert.equal(h.loop.running, false); assert.equal(h.window.RpgSceneEmbed.sleeping(), true);
  assert.equal(h.session.visibility, 1, 'the Atlas-active session timer is told the frame is hidden');
  from({ type: 'resume' }); assert.equal(h.loop.running, true); assert.equal(h.session.visibility, 2);
  from({ type: 'pause' }, h.parent, 'https://evil.example'); assert.equal(h.loop.running, true, 'other origins are ignored');
  from({ type: 'pause' }, {}); assert.equal(h.loop.running, true, 'only the parent frame can control it');
  from({ type: 'refresh', detail: { characterId: 'b', realmId: 'permanent' } });
  assert.deepEqual(JSON.parse(JSON.stringify(h.session.set)), [{ characterId: 'b', realmId: 'permanent' }]); assert.equal(h.session.syncs, 1);
  from({ type: 'refresh', detail: { characterId: 'b', realmId: 'permanent' } });
  assert.equal(h.session.set.length, 1, 'same character: refresh only'); assert.equal(h.session.syncs, 2);
  h.listeners['rpg:scene-state']({ detail: { characterId: 'b', realmId: 'permanent' } });
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted.map(p => [p.data.type, p.target]))), [['ready', 'https://elf.example']]);
});

test('without embed=battle the adapter does nothing (the full scene is unchanged)', () => {
  const h = embedHarness({ embed: null });
  assert.equal(h.head.length, 0); assert.equal(h.window.Phaser.Game, h.Game); assert.equal(h.window.RpgSceneEmbed, undefined); assert.deepEqual(Object.keys(h.listeners), []);
});

function frameHarness() {
  const nodes = [], listeners = {}, docListeners = {}, posted = [];
  const el = tag => { const node = { tag, style: {}, dataset: {}, classList: { set: new Set(), add(c) { this.set.add(c); }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } }, attrs: {}, hidden: false, isConnected: true,
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { (this.on ||= {})[t] = fn; }, remove() { this.isConnected = false; },
    getBoundingClientRect: () => ({ left: 10, top: 300, width: 340, height: 400 }), getClientRects: () => [1] };
    if (tag === 'iframe') { node.contentWindow = { postMessage: (data, target) => posted.push({ data, target }), RpgSceneEmbed: {} }; node.getAttribute = k => (k === 'src' ? node.src ?? null : node.attrs[k] ?? null); }
    return node; };
  const timers = fakeTimers(), micro = [];
  const classes = new Set(), props = {};
  const document = { hidden: false, documentElement: { dataset: {}, style: { setProperty: (k, v) => { props[k] = v; } }, classList: { set: classes, add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) } },
    body: { appendChild: n => nodes.push(n), prepend: n => nodes.push(n) }, createElement: el, getElementById: () => null, addEventListener: (t, fn) => { docListeners[t] = fn; } };
  const window = { addEventListener: (t, fn) => { listeners[t] = fn; } };
  vm.runInNewContext(frameJs, { window, document, location: { origin: 'https://elf.example' }, queueMicrotask: fn => micro.push(fn), ...timers, ResizeObserver: undefined });
  const flush = () => { while (micro.length) micro.shift()(); };
  return { api: window.RpgClassicNextBattle, nodes, listeners, posted, timers, flush, el, document, classes, props };
}

test('P7 home scene: one full-HUD scene frame, shown while a character is in play, paused when covered or hidden', () => {
  const h = frameHarness(), slot = h.el('div');
  assert.equal(h.nodes.length, 0, 'nothing loads on character select');
  assert.equal(h.api.home(false), false); h.flush(); assert.equal(h.nodes.length, 0);
  h.api.home(true, { characterId: 'hero', realmId: 'permanent' }); h.flush();
  const frame = h.nodes[0];
  assert.equal(h.nodes.length, 1); assert.equal(frame.tag, 'iframe'); assert.equal(frame.id, 'demo', 'the same #demo frame the current home page dresses (preview.js / hud-angels.js)');
  assert.match(frame.src, /\/scene-bound-20261102\/scene\.html\?embed=battle&hud=full$/);
  assert.ok(h.classes.has('cn-scene-home') && h.classes.has('cn-scene-loading'));
  assert.equal(h.timers.intervals.length, 0, 'no polling of any kind');
  assert.deepEqual(h.timers.timeouts.map(t => t.ms), [20000], 'one load deadline only');
  assert.equal(h.api.attach(slot, { characterId: 'hero', realmId: 'permanent', fallback() {} }), true); h.flush();
  assert.equal(h.nodes.length, 1, 'classic home render reuses the one frame');
  h.listeners.message({ source: frame.contentWindow, origin: 'https://elf.example', data: { source: 'rpg-scene-battle', type: 'ready', detail: { characterId: 'hero', realmId: 'permanent' } } });
  h.flush();
  assert.equal(h.classes.has('cn-scene-loading'), false); assert.equal(h.posted.filter(p => p.data.type === 'refresh').length, 0);
  assert.equal(h.posted.at(-1).data.type, 'resume');
  // Classic renders release/attach the slot: the scene keeps running.
  h.api.release(); h.api.attach(h.el('div'), { characterId: 'hero' }); h.flush();
  assert.equal(h.posted.filter(p => p.data.type === 'pause').length, 0);
  h.api.cover('window', true); h.flush(); assert.equal(h.posted.at(-1).data.type, 'pause', 'a classic window over the scene pauses it');
  h.api.cover('window', false); h.flush(); assert.equal(h.posted.at(-1).data.type, 'resume');
  h.api.home(false); h.flush();
  assert.equal(h.classes.has('cn-scene-home'), false); assert.equal(h.posted.at(-1).data.type, 'pause', 'character select: paused');
  h.api.home(true, { characterId: 'other', realmId: 'permanent' }); h.flush();
  assert.deepEqual(h.posted.slice(-2).map(p => p.data.type), ['resume', 'refresh']);
  assert.equal(h.posted.at(-1).data.detail.characterId, 'other', 'character switch is pushed to the scene');
  h.api.refresh(); assert.equal(h.posted.at(-1).data.type, 'refresh');
  // HUD taps from the scene are handed to the classic app (only from this frame and origin).
  const opened = []; h.api.onOpen((route, params) => opened.push([route, params]));
  h.listeners.message({ source: frame.contentWindow, origin: 'https://elf.example', data: { source: 'rpg-scene-battle', type: 'open', detail: { route: 'eq' } } });
  h.listeners.message({ source: {}, origin: 'https://elf.example', data: { source: 'rpg-scene-battle', type: 'open', detail: { route: 'inv' } } });
  h.listeners.message({ source: frame.contentWindow, origin: 'https://evil.example', data: { source: 'rpg-scene-battle', type: 'open', detail: { route: 'inv' } } });
  assert.deepEqual(plain(opened), [['eq', null]]);
  assert.ok(h.posted.every(p => p.target === 'https://elf.example'));
});

test('classic home frame falls back to the classic RpgBattle when the scene cannot load', () => {
  for (const failure of ['timeout', 'error', 'load']) {
    const h = frameHarness(), slot = h.el('div'); let fallback = null;
    h.api.attach(slot, { characterId: 'hero', fallback: s => { fallback = s; } }); h.flush();
    const frame = h.nodes[0];
    if (failure === 'timeout') h.timers.timeouts[0].fn();
    else if (failure === 'error') h.listeners.message({ source: frame.contentWindow, origin: 'https://elf.example', data: { source: 'rpg-scene-battle', type: 'error', detail: { code: 'auth_required', fatal: true } } });
    else { delete frame.contentWindow.RpgSceneEmbed; frame.on.load(); }
    assert.equal(fallback, slot, failure); assert.equal(frame.isConnected, false); assert.equal(h.api.state(), 'failed');
    assert.equal(h.api.attach(h.el('div'), { characterId: 'hero' }), false, 'later renders use the classic battle directly');
    assert.equal(h.api.home(true), false, 'the classic layout (tab bar) comes back'); h.flush(); assert.equal(h.classes.has('cn-scene-home'), false);
    assert.match(h.document.documentElement.dataset.cnBattle, /^fallback:/);
  }
  const failed = []; const h = frameHarness(); h.api.onFail(r => failed.push(r)); h.api.home(true, { characterId: 'hero' }); h.flush(); h.timers.timeouts[0].fn();
  assert.deepEqual(failed, ['timeout'], 'the classic app re-renders with the classic RpgBattle');
  assert.match(app, /window\.RpgClassicNextBattle\?\.onFail\?\.\(\(\) => \{ S\.nextWin = null; nextMenu\(false\); if \(S\.me && !S\.choosing && !S\.creating\) render\(\); \}\);/);
  assert.match(app, /else if \(NEXT && window\.RpgClassicNextBattle\?\.attach\(\$\('#bslot', view\), \{ characterId: S\.me\.character\.tgId, realmId: S\.realmId, fallback: slot => BATTLE\?\.attach\(slot\) \}\)\) \{\}/);
});

// Atlas-active sync (owner t704u): the original atlas-ui 30 s refresh and visibility refresh, but on
// /classic-next only while a 星圖派遣 run is running; idle home stays silent.
function atlasTimers(overlayOnly, status, frameSync = () => false) {
  const start = atlas.indexOf('    const atlasLive='), end = atlas.indexOf('\n', atlas.indexOf('    poll=setInterval(', start));
  assert.ok(start > 0 && end > start);
  const timers = fakeTimers(), listeners = {}, calls = [];
  const document = { hidden: false, addEventListener: (t, fn) => { listeners[t] = fn; } };
  const client = { state: { busy: false, snapshot: { run: status ? { status } : null } } };
  const context = vm.createContext({ ...timers, document, client, overlayOnly, host: { frameSync: () => frameSync() }, validCharacter: () => true,
    running: () => client.state.snapshot?.run?.status === 'running', refreshAll: () => { calls.push('refreshAll'); },
    chatClient: { refresh: () => { calls.push('chat'); } } });
  vm.runInContext('let poll;' + atlas.slice(start, end), context);
  return { timers, listeners, calls, client, document };
}

test('fake timers: Atlas-active run keeps the original 30 s Atlas sync on /classic-next; idle does not', async () => {
  const idle = atlasTimers(true, null);
  await idle.timers.advance(10 * 60 * 1000); idle.listeners.visibilitychange();
  assert.deepEqual(idle.calls, [], 'no run: no Atlas reads at all');
  const ended = atlasTimers(true, 'completed');
  await ended.timers.advance(5 * 60 * 1000); assert.deepEqual(ended.calls, []);
  const active = atlasTimers(true, 'running');
  await active.timers.advance(60 * 1000);
  assert.equal(active.calls.filter(c => c === 'refreshAll').length, 2, 'running: every 30 s like the original');
  active.listeners.visibilitychange();
  assert.deepEqual(active.calls.slice(-1), ['refreshAll'], 'back to the app during a run: refresh, no chat poll');
  active.document.hidden = true; await active.timers.advance(60 * 1000);
  assert.equal(active.calls.length, 3, 'hidden app: no reads');
  active.document.hidden = false; active.client.state.snapshot.run.status = 'completed';
  await active.timers.advance(60 * 1000); assert.equal(active.calls.length, 3, 'stops as soon as the run ends');
  const classic = atlasTimers(false, null);
  await classic.timers.advance(60 * 1000); classic.listeners.visibilitychange();
  assert.deepEqual(classic.calls, ['refreshAll', 'refreshAll', 'refreshAll', 'chat'], '/classic keeps its original behaviour');
});

test('scene Atlas-active session timer pauses with the embed frame', () => {
  const auth = read('scene-live-auth.js');
  assert.match(auth, /isHidden:\(\)=>document\.hidden\|\|window\.RpgSceneEmbed\?\.sleeping\?\.\(\)===true,/);
  const session = read('scene-live-session.js');
  assert.match(session, /isHidden/);
});

// P3: Lv.600 = 5 rounds × 120 levels, mapped to the classic 12 maps.
const MAPS_SRC = read('maps.js'), plain = v => JSON.parse(JSON.stringify(v));
function rpgMaps() { const window = {}; vm.runInNewContext(MAPS_SRC, { window, Object, Math, Number, Array, String }); return window.RpgMaps; }

test('maps: Lv.121/240/241/600 map onto the 12 classic maps by round (Lv-1)%120+1', async () => {
  const M = rpgMaps();
  const at = lv => { const p = M.progression(lv); return plain([p.round, p.mode.id, p.localLevel, M.get(lv).id]); };
  assert.deepEqual(at(1), [1, 'normal', 1, M.get(1).id]);
  assert.deepEqual(at(120), [1, 'normal', 120, M.get(120).id]);
  for (const lv of [60, 120]) assert.equal(M.get(lv + 120).id, M.get(lv).id);
  assert.deepEqual(at(121), [2, 'elite', 1, M.get(1).id]);
  assert.deepEqual(at(240), [2, 'elite', 120, M.get(120).id]);
  assert.deepEqual(at(241), [3, 'expert', 1, M.get(1).id]);
  assert.deepEqual(at(600), [5, 'hell', 120, M.get(120).id]);
  assert.equal(M.progression(900).level, 600, 'clamped at Lv.600');
  // Same as the server's chapter (mapId) for every level.
  const { mapForLevel } = await import('../src/game/formulas.js');
  for (const lv of [1, 60, 120, 121, 180, 240, 241, 480, 481, 600]) assert.equal(M.get(lv).id, mapForLevel(lv), 'Lv.' + lv);
  const E = await import('../src/game/endgame.js');
  assert.deepEqual(plain(M.modes.map(m => [m.id, m.name, m.minLevel, m.maxLevel])), E.WORLD_MODES.map(m => [m.id, m.name, m.minLevel ?? m.index * 120 + 1, m.maxLevel]));
  for (const lv of [1, 120, 121, 247, 600]) assert.equal(M.progression(lv).localLevel, E.localCycleLevel(lv));
});

test('maps: awakenings match the server table and unlock by round', async () => {
  const M = rpgMaps(), A = await import('../src/game/awakening.js');
  const server = A.AWAKENINGS;
  assert.equal(server.length, 16);
  for (const s of server) {
    const row = M.awakenings(s.baseClass).find(a => a.id === s.id);
    assert.ok(row, s.id); assert.equal(row.name, s.name); assert.equal(row.unlockLevel, s.unlockLevel);
  }
  assert.deepEqual(plain(M.awakenings('sword', 120).map(a => a.unlocked)), [false, false, false, false]);
  assert.deepEqual(plain(M.awakenings('sword', 247).map(a => a.unlocked)), [true, true, false, false]);
  assert.deepEqual(plain(M.awakenings('sword', 600).map(a => a.unlocked)), [true, true, true, true]);
});

test('P3/P4 classic cards: round badge on home, talents + rounds in 職業, talent changes only through the Atlas panel', () => {
  const growthSrc = read('classic-next-growth.js'), window = { RpgMaps: rpgMaps() };
  vm.runInNewContext(growthSrc, { window, Object, Set, Math, Number, String });
  const G = window.RpgClassicNextGrowth;
  assert.match(G.badge({ level: 247 }), /第3輪・專家 <b>Lv\.7<\/b>\/120/);
  assert.match(G.mapLabel({ level: 247, idleMap: { name: '日耀聖庭-專家' } }), /日耀聖庭-專家/);
  const rounds = G.roundCard({ level: 247, baseClass: 'sword' });
  assert.equal((rounds.match(/next-round-row done/g) || []).length, 2);
  assert.match(rounds, /next-round-row now[^]*進行中 · 本輪 Lv\.7 \/ 120/);
  assert.equal((rounds.match(/next-round-row locked/g) || []).length, 2);
  const card = G.talentCard({ status: 'ready', data: { allocatedIds: ['n1'], spent: 1, totalPoints: 24, availablePoints: 23, effectText: '攻擊 +2%',
    catalog: { nodes: [{ id: 'n1', branch: 'a', kind: 'minor', name: '<x>' }, { id: 'n2', branch: 'a', kind: 'keystone', name: 'K' }], branches: [{ id: 'a', name: '旋風', mainSkill: 'S', strengths: ['清群'], weaknesses: ['單體'] }] } } }, 247);
  assert.match(card, /<b>23<\/b><span>可用點數/); assert.match(card, /<b>旋風<\/b><span>1 \/ 2<\/span>/);
  assert.match(card, /data-next-talent-open/); assert.doesNotMatch(card, /<x>/);
  assert.match(G.talentCard({ status: 'error', error: '<b>' }), /&lt;b&gt;/);
  assert.match(next, /src="classic-next-growth\.js[^"]*"/);
  assert.ok(next.indexOf('classic-next-growth.js') < next.indexOf('src="app.js'));
  assert.doesNotMatch(classic, /classic-next-growth/);
  assert.match(app, /else if \(NEXT && tab === 'class'\) loadNextTalents\(\);/);
  assert.match(app, /const j = await api\('atlas\/talents'\);/);
  assert.match(app, /\[data-next-talent-open\]'\)\?\.addEventListener\('click', \(\) => atlasWorkspace\?\.open\('talents'\)\)/);
  assert.match(app, /panelClosed:name=>\{if\(NEXT&&name==='talents'&&S\.tab==='class'\)void loadNextTalents\(\);\}/);
  assert.match(atlas, /if\(closing\)host\.panelClosed\?\.\(closing\);/);
  assert.doesNotMatch(app, /atlas\/talents\/action/, 'the classic card never changes talents itself');
});

// ---------- P5 (owner decisions 2026-11-12) ----------
const entriesJs = read('classic-next-entries.js');

test('fake timers: during a run the visible battle frame drives Atlas sync; the page polls only when the frame is not syncing', async () => {
  let syncing = true;
  const h = atlasTimers(true, 'running', () => syncing);
  await h.timers.advance(5 * 60 * 1000); h.listeners.visibilitychange();
  assert.deepEqual(h.calls, [], 'frame visible and syncing: no duplicate page poll');
  syncing = false;
  await h.timers.advance(60 * 1000);
  assert.equal(h.calls.filter(c => c === 'refreshAll').length, 2, 'frame paused/other tab/panel open: the page keeps the original 30 s');
  const classic = atlasTimers(false, 'running', () => true);
  await classic.timers.advance(60 * 1000);
  assert.equal(classic.calls.filter(c => c === 'refreshAll').length, 2, '/classic ignores the frame');
});

test('battle frame pauses while a panel covers it and reports whether its own sync runs', () => {
  const h = frameHarness(), slot = h.el('div');
  h.api.home(true, { characterId: 'hero', realmId: 'permanent' }); h.api.attach(slot, { characterId: 'hero', realmId: 'permanent', fallback() {} }); h.flush();
  const frame = h.nodes[0];
  assert.equal(h.api.syncing(), false, 'not before the scene is ready');
  h.listeners.message({ source: frame.contentWindow, origin: 'https://elf.example', data: { source: 'rpg-scene-battle', type: 'ready', detail: { characterId: 'hero', realmId: 'permanent' } } });
  h.flush(); assert.equal(h.api.syncing(), true);
  h.api.cover('atlas', true); h.flush();
  assert.equal(h.posted.at(-1).data.type, 'pause'); assert.equal(h.api.syncing(), false);
  h.api.cover('panel', true); h.api.cover('atlas', false); h.flush();
  assert.equal(h.posted.at(-1).data.type, 'pause', 'still covered by the other panel');
  h.api.cover('panel', false); h.flush();
  assert.equal(h.posted.at(-1).data.type, 'resume'); assert.equal(h.api.syncing(), true);
  assert.equal(h.timers.intervals.length, 0);
});

function atlasWindowHarness(overlayOnly) {
  const start = atlas.indexOf('    function syncWindowState() {'), end = atlas.indexOf('\n    }', start) + 6;
  const timers = fakeTimers(), calls = [];
  const context = vm.createContext({ ...timers, overlayOnly, overlay: { hidden: true }, legacy: { hidden: true }, root: {}, document: { hidden: false, body: { style: {} } },
    host: { windowState: on => calls.push('cover:' + on) }, validCharacter: () => true, chatClient: { refresh: () => calls.push('chat') } });
  vm.runInContext('let panel=null,chatOpenPoll=0,scrollLocked=false,previousOverflow="";' + atlas.slice(start, end) +
    ';globalThis.show=(name)=>{panel=name;overlay.hidden=!name;syncWindowState();};globalThis.poll=()=>chatOpenPoll;', context);
  return { timers, calls, show: context.show, poll: context.poll };
}

test('fake timers: chat is polled every 5 s only while the chat panel is open on /classic-next', async () => {
  const h = atlasWindowHarness(true);
  assert.equal(h.timers.intervals.length, 0, 'no chat timer before the panel opens');
  h.show('recovery'); assert.equal(h.timers.intervals.length, 0, 'other panels add no chat timer');
  h.show('chat'); assert.equal(h.timers.intervals.length, 1); assert.equal(h.timers.intervals[0].ms, 5000);
  await h.timers.advance(15000); assert.equal(h.calls.filter(c => c === 'chat').length, 3);
  h.show(null); assert.equal(h.poll(), 0, 'closing the panel stops it');
  assert.deepEqual(h.calls.filter(c => c.startsWith('cover:')), ['cover:true', 'cover:true', 'cover:false'], 'panel state reaches the battle frame');
  const classic = atlasWindowHarness(false); classic.show('chat');
  assert.equal(classic.timers.intervals.length, 0, '/classic keeps its own original chat poll');
  assert.match(atlas, /const chatPoll=overlayOnly\?0:setInterval\(/);
  assert.match(atlas, /clearInterval\(chatOpenPoll\);chatOpenPoll=0;/, 'disposed with the workspace');
});

function entriesModule(extra = {}) {
  const timers = fakeTimers(), observed = [];
  class IO { constructor(fn) { this.fn = fn; } observe(el) { observed.push(el); } unobserve() {} }
  const window = { matchMedia: () => ({ matches: false }), ...extra.window };
  const document = { hidden: false, addEventListener() {}, createElement: tag => fakeNode(tag), ...extra.document };
  vm.runInNewContext(entriesJs, { window, document, IntersectionObserver: IO, MutationObserver: undefined, ...timers, Promise, JSON, Object, Error, String, Set, Map });
  return { E: window.RpgClassicNextEntries, timers, observed, IO };
}
function fakeNode(tag) {
  const node = { tag, children: [], attrs: {}, dataset: {}, isConnected: true, paused: true, classList: { set: new Set(), add(c) { this.set.add(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); }, prepend(c) { this.children.unshift(c); },
    querySelector(sel) { return sel === ':scope > .cn-banner' ? this.children.find(c => c.className === 'cn-banner') || null : null; }, querySelectorAll: () => [],
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  return node;
}

test('P5 entries: chat, 出生與旅箋, recovery and 戰報紀錄 open existing panels; chat/recovery reuse the Atlas panels', () => {
  const { E, timers } = entriesModule();
  const html = E.entriesHtml();
  assert.deepEqual([...html.matchAll(/data-next-entry="([a-z]+)"/g)].map(m => m[1]), ['chat', 'fate', 'recovery', 'ledger']);
  assert.equal(timers.intervals.length + timers.timeouts.length, 0, 'the module registers no timers');
  assert.doesNotMatch(entriesJs, /setInterval|setTimeout/);
  // Existing scene modules, unchanged: F2 private section and ledger history.
  assert.match(entriesJs, /src: '\/scene-ledger-ui\.js\?v=ledger-20261106', name: 'RpgSceneLedger'/);
  assert.match(entriesJs, /src: '\/scene-fate-ui\.js\?v=fate-f2-20261105', name: 'RpgSceneFate'.*m\.mount\(body, host, \{ section: 'private' \}\)/);
  for (const f of ['scene-ledger-ui.js', 'scene-fate-ui.js', 'scene-fate-private-ui.js', 'scene-chat-ui.js', 'equipment-recovery-ui.js']) assert.ok(fs.existsSync(new URL('../public/' + f, import.meta.url)), f);
  assert.match(entriesJs, /try \{ p\.view\?\.dispose\?\.\(\); \} catch/, 'closing disposes the panel (its own timers end with it)');
  assert.match(entriesJs, /window\.addEventListener\('rpg-context-changed', close\)/, 'character/realm switch closes it');
  assert.match(entriesJs, /host\.covered\?\.\(true\)/); assert.match(entriesJs, /p\.host\?\.covered\?\.\(false\)/);
  // app.js wiring
  assert.match(app, /\$\{NEXT \? atlasEntryHtml\(\) \+ \(window\.RpgClassicNextEntries\?\.entriesHtml\(\) \|\| ''\) : ''\}/);
  assert.match(app, /if \(kind === 'chat' \|\| kind === 'recovery'\) atlasWorkspace\?\.open\(kind\);/);
  assert.match(app, /else void window\.RpgClassicNextEntries\?\.open\(kind, nextHost\);/);
  assert.match(app, /if \(NEXT\) view\.querySelectorAll\('\[data-next-entry\]'\)/);
  assert.match(app, /request: \(action, body = \{\}, options = \{\}\) => api\(action, \{ \.\.\.body, realmId: S\.realmId \|\| 'permanent' \}, options\)/);
  assert.match(app, /windowState:on=>window\.RpgClassicNextBattle\?\.cover\?\.\('atlas',on\),frameSync:\(\)=>window\.RpgClassicNextBattle\?\.syncing\?\.\(\)===true,/);
  // Scene reads are classified as reads in the classic client (no mutation epoch bump).
  for (const a of ['ledger/history', 'fate/scene', 'fate/receipt', 'fate/private/scene', 'fate/private/profile', 'fate/private/receipt', 'chat/state']) assert.match(app, new RegExp("const readActions=new Set\\(\\[[^\\]]*'" + a.replace('/', '\\/') + "'"));
  assert.match(next, /src="classic-next-entries\.js[^"]*"/); assert.ok(next.indexOf('classic-next-entries.js') < next.indexOf('src="app.js'));
  assert.doesNotMatch(classic, /classic-next-entries/);
});

test('P5 banners: the 13 adventure loops, poster first, video only on screen, no timers', () => {
  const { E, observed } = entriesModule();
  const stems = Object.values(E.BANNERS);
  assert.equal(stems.length, 13); assert.equal(new Set(stems).size, 13);
  for (const stem of stems) for (const ext of ['webp', 'webm', 'mp4']) assert.ok(fs.existsSync(new URL('../public/art/adventure-banners-20261112/' + stem + '.' + ext, import.meta.url)), stem + '.' + ext);
  // Same set the scene uses for 冒險 (PR #62).
  const scene = read('scene-social-preview.js').match(/banners=route==='adventure'\?(\{[^}]+\})/)[1];
  assert.deepEqual([...scene.matchAll(/'?[a-z-]+'?:'([a-z0-9-]+)'/g)].map(m => m[1]).sort(), [...stems].sort());
  assert.ok(new Set(E.PLACES.map(p => p[1])).size === 13, 'every loop has a classic entry');
  const el = fakeNode('button');
  E.banner(el, 'status');
  const media = el.children[0];
  assert.equal(media.className, 'cn-banner'); assert.equal(media.children.length, 1);
  const img = media.children[0];
  assert.equal(img.tag, 'img'); assert.equal(img.loading, 'lazy'); assert.equal(img.src, '/art/adventure-banners-20261112/explore-2-status.webp');
  assert.equal(observed[0], el, 'video waits for the entry to be on screen');
  E.banner(el, 'status'); assert.equal(el.children.length, 1, 'idempotent');
  assert.match(entriesJs, /\['preload', 'none'\]/); assert.match(entriesJs, /prefers-reduced-motion: reduce/);
  assert.match(app, /window\.RpgClassicNextGrowth\?\.pill\?\.\(view, S\.me\.character\); window\.RpgClassicNextEntries\?\.decorate\(view\); nextChrome\(\); \}/);
  assert.match(app, /window\.RpgClassicNextEntries\?\.decorate\(c\);/, 'the 星圖 chooser sheet gets its loops');
});

test('P5 skill icons: classic skill lists use the career skill icons for the exact lineage path', () => {
  const { E } = entriesModule();
  assert.match(E.skillIcon('sword', 'A12'), /src="\/art\/career-skill-icons-20261110\/sword_A12\.webp"/);
  assert.match(E.skillIcon('mage', ''), /mage\.webp/);
  assert.equal(E.skillIcon('sword', '../x'), ''); assert.equal(E.skillIcon('dragon', 'A'), '');
  for (const cls of ['sword', 'archer', 'mage', 'thief']) for (const path of ['', 'A', 'B2', 'A121', 'B222'])
    assert.ok(fs.existsSync(new URL('../public/art/career-skill-icons-20261110/' + cls + (path ? '_' + path : '') + '.webp', import.meta.url)), cls + path);
  assert.match(app, /<div class="sk"><div>\$\{globalThis\.RpgClassicNextEntries\?\.skillIcon\?\.\(cls, path\) \|\| ''\}<b>/);
  assert.match(app, /skillIcon\?\.\(cls, node\.path, 'cn-skill-icon small'\)/);
  assert.match(app, /skillIcon\?\.\(c\.baseClass, c\.classPath, 'cn-skill-icon small'\)/);
});

test('P5 home Lv badge: the profession line keeps a small pill', () => {
  const growthSrc = read('classic-next-growth.js');
  const made = [];
  const document = { createElement: () => { const t = { content: { firstElementChild: null } }; Object.defineProperty(t, 'innerHTML', { set(v) { t.content.firstElementChild = { html: v, textContent: v.replace(/<[^>]+>/g, '') }; made.push(v); } }); return t; } };
  const window = { RpgMaps: rpgMaps() };
  vm.runInNewContext(growthSrc, { window, document, Object, Set, Math, Number, String });
  const appended = [], line = { textContent: '血怒戰神第3輪・專家 Lv.7/120', classList: { add() {} }, querySelector: () => null, append: n => appended.push(n) };
  assert.equal(window.RpgClassicNextGrowth.pill({ querySelector: () => line }, { level: 247 }), true);
  assert.equal(line.textContent, '血怒戰神'); assert.match(appended[0].html, /class="next-round-badge mode-expert"/);
});

// ---------- P6: the battle is the main home view ----------
test('P6 embed hud=1 (battle-only HUD mode) is unchanged and has no timers', () => {
  assert.match(embedJs, /hud = q === '1'; full = q === 'full';/);
  assert.match(embedJs, /html\.scene-embed-hud #ui>\*:not\(#target\):not\(#topR\):not\(#bottom\)\{display:none!important\}/);
  assert.doesNotMatch(embedJs, /setInterval|setTimeout/);
  const h = embedHarness({ hud: '1' });
  assert.equal(h.timers.intervals.length + h.timers.timeouts.length, 0);
  assert.ok(h.classes.has('scene-embed-hud')); assert.equal(h.window.RPG_LIVE_SOCIAL, undefined); assert.equal(h.window.RpgSceneNavigation, undefined);
});

test('P7 embed hud=full: the whole scene HUD, every tap forwarded to the classic parent, no scene windows, no timers', () => {
  const h = embedHarness({ hud: 'full' });
  assert.equal(h.timers.intervals.length + h.timers.timeouts.length, 0, 'no timers');
  assert.ok(h.classes.has('scene-embed-full')); assert.equal(h.window.RpgSceneEmbed.mode, 'home');
  assert.equal(h.window.RPG_LIVE_SOCIAL, true, 'ui.js mock chat (7 s interval) never starts');
  assert.ok(h.classes.has('ui:scene-unified-root'), 'current home HUD dressing (scene-social-preview.css: laurel portrait bezel)');
  assert.equal(h.nodes.chatLine.textContent, '點此與旅人聊天'); assert.equal(h.q['#quest .qn'].textContent, '◆ 星圖任務・派遣');
  const css = h.head[0].textContent;
  assert.match(css, /html\.scene-embed-full #panelHost,html\.scene-embed-full #tip,html\.scene-embed-full #topR button,html\.scene-embed-full #scene-live-status,html\.scene-embed-full \.scene-live-status-toggle\{display:none!important\}/, 'no prototype panels / scene status panel');
  assert.match(css, /#ui\.scene-unified-root #fn\{display:grid!important\}/, '背包/裝備/補給/技能/地圖/設定 bar shown');
  assert.match(css, /html\.scene-embed-full #bottom,html\.scene-embed-full #fn\{pointer-events:auto;cursor:pointer\}/, 'HUD is tappable');
  // Capture-phase routing: tapped HUD element -> route posted to the parent; ui.js handlers never see it.
  const clicks = h.docListeners.click.filter(l => l.capture), downs = h.docListeners.pointerdown.filter(l => l.capture);
  assert.equal(clicks.length, 1); assert.equal(downs.length, 1);
  const tap = (sel, extra = {}) => {
    let stopped = 0; const el = { dataset: {}, ...extra };
    const target = { closest: s => (s === sel ? el : null) };
    downs[0].fn({ type: 'pointerdown', target, stopPropagation() { stopped++; }, preventDefault() {} });
    clicks[0].fn({ type: 'click', target, stopPropagation() { stopped++; }, preventDefault() {} });
    return stopped;
  };
  for (const [p] of [['inv'], ['eq'], ['sup'], ['sk'], ['map'], ['set']]) assert.equal(tap('#fn .fb', { dataset: { p } }), 2);
  for (const sel of ['#topL', '#topR #zone', '#topR #mini', '#quest', '#chat']) tap(sel);
  const before = h.posted.length; h.docListeners.click[0].fn({ type: 'click', target: { closest: () => null }, stopPropagation() { throw new Error('battlefield taps pass through'); }, preventDefault() {} });
  assert.equal(h.posted.length, before);
  // Live HUD potions/skills and 選擇角色 go through the scene navigation API -> parent.
  h.window.RpgSceneNavigation.navigate('supplies'); h.window.RpgSceneNavigation.navigate('skills'); h.window.RpgSceneNavigation.navigate('characters', {});
  h.docListeners.keydown[0].fn({ key: 'Escape' });
  assert.deepEqual(plain(h.posted.map(p => p.data.detail.route)), ['inv', 'eq', 'sup', 'sk', 'map', 'set', 'hero', 'map', 'map', 'quest', 'chat', 'supplies', 'skills', 'characters', 'close']);
  assert.ok(h.posted.every(p => p.data.source === 'rpg-scene-battle' && p.data.type === 'open' && p.target === 'https://elf.example'));
  // Same tags the HUD code reads.
  for (const id of ['topL', 'pc', 'gold', 'topR', 'zone', 'mini', 'quest', 'chat', 'chatLine', 'bottom', 'bar', 'mid', 'fn', 'panelHost']) assert.match(sceneHtml, new RegExp('id="' + id + '"'), id);
  assert.match(read(SCENE + 'ui.js'), /var FN=\[\['背包','inv','belt'\],\['裝備','eq','helm'\],\['補給','sup','potion'\],\['技能','sk','spin'\],\['地圖','map','quake'\],\['設定','set','shield'\]\];/);
  assert.match(read(SCENE + 'ui.js'), /if\(!window\.RPG_LIVE_SOCIAL\)\{for\(var k=0;k<4;k\+\+\)pushChat\(\);setInterval\(pushChat,7000\);\}/);
});

test('P7 classic-next.html: the current home HUD installers on the scene frame, no debug chip, classic chrome gives way', () => {
  const frameAt = next.indexOf('<iframe id="demo" class="cn-scene"'), preview = next.indexOf('<script src="/ui-generated-20261030/preview.js"></script>'), angels = next.indexOf('hud-angels-20261102/hud-angels.js');
  assert.ok(frameAt > 0 && frameAt < next.indexOf('<script src="app.js') && preview > next.indexOf('<script src="app.js') && angels > preview, 'frame first, then the same installers as index.html');
  assert.match(read('index.html'), /<script src="\/ui-generated-20261030\/preview\.js"><\/script><script src="\/ui-generated-20261030\/hud-angels-20261102\/hud-angels\.js\?v=20261102-angels1"><\/script>/, 'reused, not copied');
  // preview.js needs its hidden controls; they stay hidden and inert (no 'UI 素材候選・本機測試 / 人物／預覽設定' chip).
  assert.match(next, /<aside class="test-controls" hidden inert style="display:none">/);
  assert.doesNotMatch(next, /preview-controls\.js|characters-v1\/|本機測試|素材候選/);
  assert.match(next, /classic-next-menu\.js\?v=20261112-next7/);
  const css = read('classic-next.css');
  assert.match(css, /html\.cn-scene-home #demo\.cn-scene\{display:block;position:fixed;inset:0;/);
  assert.match(css, /html\.cn-scene-home #hud,html\.cn-scene-home #nav,html\.cn-scene-home #app>\.game-credit,html\.cn-scene-home \.lc-battle-shell\{display:none!important\}/, 'no classic tab bar on the home');
  assert.match(css, /html\.cn-scene-home\.cn-window-open #app\{display:block;position:fixed;z-index:600;/, 'classic views open as a floating window');
  assert.match(css, /bottom:calc\(env\(safe-area-inset-bottom\) \+ var\(--cn-bar,64px\)\)/, 'the scene bar stays tappable under a window');
  assert.match(css, /html\.cn-scene-home #sheet\{z-index:1000\}/, 'item sheets (強化/洗鍊) above the window');
  assert.doesNotMatch(frameJs, /setInterval/);
});

test('P7 every HUD button and menu entry opens a classic feature', () => {
  const win = app.match(/const NEXT_WINDOWS = (\{[\s\S]*?\n  \});/)[1];
  const windows = vm.runInNewContext('(' + win + ')');
  const aliases = vm.runInNewContext('(' + app.match(/const NEXT_ALIASES = (\{[^\n]*\});/)[1] + ')');
  const special = ['close', 'menu', 'map', 'quest', 'chat', 'recovery', 'talents', 'build', 'progression', 'gearbook', 'atlas', 'fate', 'ledger', 'select', 'guardian'];
  for (const r of special.slice(0, 1)) assert.match(app, new RegExp("route === '" + r + "'"));
  const handled = r => { r = aliases[r] || r; return !!windows[r] || special.includes(r); };
  // Scene HUD: 背包 裝備 補給 技能 地圖 設定, portrait, zone/minimap, quest, chat; live potions/skills; 選擇角色.
  for (const r of ['inv', 'eq', 'sup', 'sk', 'map', 'set', 'hero', 'quest', 'chat', 'supplies', 'skills', 'characters']) assert.ok(handled(r), r);
  assert.deepEqual(plain({ inv: windows.inv, eq: windows.eq, sup: windows.sup, sk: windows.sk }), {
    inv: { tab: 'bag', panel: 'items', title: '背包' }, eq: { tab: 'bag', panel: 'wardrobe', title: '裝備' },
    sup: { tab: 'home', panel: 'supply', title: '補給與策略' }, sk: { tab: 'class', panel: 'destiny', title: '職業・技能' } });
  // Menu: every classic tab and home entry stays reachable.
  const window = {}; vm.runInNewContext(read('classic-next-menu.js'), { window });
  const ids = window.RpgClassicNextMenu.ids();
  for (const id of ids) assert.ok(handled(id), id);
  for (const id of ['home', 'boss', 'shop', 'trade', 'lineage', 'sk', 'talents', 'atlas', 'chat', 'fate', 'ledger', 'recovery', 'guardian', 'inv', 'eq', 'vault', 'collection', 'sup', 'hero', 'select']) assert.ok(ids.includes(id), 'menu has ' + id);
  for (const tab of ['home', 'bag', 'shop', 'boss', 'trade', 'class']) assert.ok(Object.values(windows).some(w => w.tab === tab), 'classic tab ' + tab);
  assert.match(window.RpgClassicNextMenu.html(), /data-next-logout/);
  assert.doesNotMatch(read('classic-next-menu.js'), /setInterval|setTimeout|fetch\(/);
  // Every menu icon is existing repo art.
  for (const m of read('classic-next-menu.js').matchAll(/art\('([^']+)'\)/g)) assert.ok(fs.existsSync(new URL('../public/' + m[1], import.meta.url)), m[1]);
  assert.ok(fs.existsSync(new URL('../public/ui-generated-20261030/function-icons-sheet-dark-v1.png', import.meta.url)));
  assert.match(app, /window\.RpgClassicNextBattle\?\.onOpen\?\.\(\(route, params\) => nextOpen\(route, params\)\);/);
  assert.match(app, /window\.RpgClassicNextBattle\?\.cover\?\.\('window', open\);/);
});
