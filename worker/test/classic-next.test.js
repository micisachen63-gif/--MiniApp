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
  assert.match(atlas, /const atlasLive=\(\)=>!overlayOnly\|\|running\(\);/);
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

function embedHarness({ embed = 'battle', origin = 'https://elf.example' } = {}) {
  const posted = [], listeners = {}, head = [], loop = { running: true, sleep() { this.running = false; }, wake() { this.running = true; } };
  class Game { constructor(config) { this.config = config; this.loop = loop; } }
  const parent = { postMessage: (data, target) => posted.push({ data, target }) };
  const session = { ctx: { characterId: 'a', realmId: 'permanent' }, set: [], syncs: 0, visibility: 0, visibilityChanged() { this.visibility++; }, getContext() { return this.ctx; }, setContext(n) { this.set.push(n); this.ctx = { ...this.ctx, ...n }; }, sync() { this.syncs++; return Promise.resolve(); } };
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

// Atlas-active sync (owner t704u): the original atlas-ui 30 s refresh and visibility refresh, but on
// /classic-next only while a 星圖派遣 run is running; idle home stays silent.
function atlasTimers(overlayOnly, status) {
  const start = atlas.indexOf('    const atlasLive='), end = atlas.indexOf('\n', atlas.indexOf('    poll=setInterval(', start));
  assert.ok(start > 0 && end > start);
  const timers = fakeTimers(), listeners = {}, calls = [];
  const document = { hidden: false, addEventListener: (t, fn) => { listeners[t] = fn; } };
  const client = { state: { busy: false, snapshot: { run: status ? { status } : null } } };
  const context = vm.createContext({ ...timers, document, client, overlayOnly, validCharacter: () => true,
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
