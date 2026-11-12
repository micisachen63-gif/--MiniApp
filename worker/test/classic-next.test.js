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

test('Atlas panels on /classic-next: overlay only, no workspace takeover and no timed refresh', () => {
  assert.match(atlas, /const overlayOnly=host\.overlayOnly===true;/);
  assert.match(atlas, /if\(!overlayOnly\)app\.prepend\(root\);/);
  assert.match(atlas, /if\(!overlayOnly\)\{view\.before\(legacy\); legacy\.append\(view\);\}/);
  assert.match(atlas, /if\(!overlayOnly\)document\.body\.classList\.add\('atlas-enabled'\);root\.hidden=overlayOnly\|\|!next\.meta;/);
  assert.match(atlas, /if\(!overlayOnly\)poll=setInterval\(/);
  assert.match(atlas, /const chatPoll=overlayOnly\?0:setInterval\(/);
  assert.match(atlas, /if \(!overlayOnly&&context\.tab !== 'atlas'\) host\.home\(\);/);
  assert.match(atlas, /if\(changed&&!selecting&&!overlayOnly\)\{void refreshAll\(\);/);
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

function embedHarness({ embed = 'battle', origin = 'https://elf.example' } = {}) {
  const posted = [], listeners = {}, head = [], loop = { running: true, sleep() { this.running = false; }, wake() { this.running = true; } };
  class Game { constructor(config) { this.config = config; this.loop = loop; } }
  const parent = { postMessage: (data, target) => posted.push({ data, target }) };
  const session = { ctx: { characterId: 'a', realmId: 'permanent' }, set: [], syncs: 0, getContext() { return this.ctx; }, setContext(n) { this.set.push(n); this.ctx = { ...this.ctx, ...n }; }, sync() { this.syncs++; return Promise.resolve(); } };
  const window = { __RpgSceneEmbed: embed, Phaser: { Game }, RpgSceneSession: session, addEventListener: (t, fn) => { listeners[t] = fn; } };
  const timers = fakeTimers();
  vm.runInNewContext(embedJs, { window, parent, location: { origin }, document: { createElement: () => ({}), head: { appendChild: n => head.push(n) } }, ...timers });
  return { window, parent, posted, listeners, head, loop, session, timers, Game };
}

test('embed=battle hides every scene UI layer except the target bar, registers no timers, and pauses Phaser', () => {
  const h = embedHarness();
  assert.equal(h.timers.intervals.length + h.timers.timeouts.length, 0);
  const css = h.head[0].textContent;
  assert.match(css, /#ui>\*:not\(#target\)\{display:none!important\}/);
  assert.match(css, /\.scene-login-status/);
  const game = new h.window.Phaser.Game({ parent: 'game' });
  assert.equal(h.window.RpgSceneEmbed.game(), game);
  const from = (data, source = h.parent, origin = 'https://elf.example') => h.listeners.message({ data: { source: 'rpg-classic-next', ...data }, source, origin });
  from({ type: 'pause' }); assert.equal(h.loop.running, false);
  from({ type: 'resume' }); assert.equal(h.loop.running, true);
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
    if (tag === 'iframe') node.contentWindow = { postMessage: (data, target) => posted.push({ data, target }), RpgSceneEmbed: {} };
    return node; };
  const timers = fakeTimers(), micro = [];
  const document = { hidden: false, documentElement: { dataset: {} }, body: { appendChild: n => nodes.push(n) }, createElement: el, getElementById: () => null, addEventListener: (t, fn) => { docListeners[t] = fn; } };
  const window = { addEventListener: (t, fn) => { listeners[t] = fn; } };
  vm.runInNewContext(frameJs, { window, document, location: { origin: 'https://elf.example' }, queueMicrotask: fn => micro.push(fn), ...timers, ResizeObserver: undefined });
  const flush = () => { while (micro.length) micro.shift()(); };
  return { api: window.RpgClassicNextBattle, nodes, listeners, posted, timers, flush, el, document };
}

test('classic home frame: one scene iframe, battlefield only, pauses when the home tab is not shown', () => {
  const h = frameHarness(), slot = h.el('div');
  assert.equal(h.api.attach(slot, { characterId: 'hero', realmId: 'permanent', fallback() {} }), true);
  h.flush();
  const frame = h.nodes[0];
  assert.equal(h.nodes.length, 1); assert.equal(frame.tag, 'iframe');
  assert.match(frame.src, /\/scene-bound-20261102\/scene\.html\?embed=battle$/);
  assert.equal(h.timers.intervals.length, 0, 'no polling of any kind');
  assert.deepEqual(h.timers.timeouts.map(t => t.ms), [20000], 'one load deadline only');
  // Ready -> it does not re-sync the same character it already shows.
  h.listeners.message({ source: frame.contentWindow, origin: 'https://elf.example', data: { source: 'rpg-scene-battle', type: 'ready', detail: { characterId: 'hero', realmId: 'permanent' } } });
  h.flush();
  assert.equal(h.posted.filter(p => p.data.type === 'refresh').length, 0);
  // Render cycle: release + attach in the same task keeps it running, a different tab pauses it.
  h.api.release(); h.api.attach(h.el('div'), { characterId: 'hero' }); h.flush();
  assert.equal(h.posted.filter(p => p.data.type === 'pause').length, 0);
  h.api.release(); h.flush();
  assert.equal(frame.hidden, true); assert.equal(h.posted.at(-1).data.type, 'pause');
  h.api.attach(h.el('div'), { characterId: 'other' }); h.flush();
  assert.deepEqual(h.posted.slice(-2).map(p => p.data.type), ['resume', 'refresh']);
  assert.equal(h.posted.at(-1).data.detail.characterId, 'other', 'character switch is pushed to the scene');
  h.api.refresh(); assert.equal(h.posted.at(-1).data.type, 'refresh');
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
  }
});
