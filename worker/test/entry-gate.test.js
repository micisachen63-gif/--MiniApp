import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { withEntryGate } from '../tools/entry-gate-html.mjs';

const pub = new URL('../public/', import.meta.url);
const plain = v => JSON.parse(JSON.stringify(v));
const read = path => fs.readFileSync(new URL(path, pub), 'utf8');
const gateSource = read('entry-gate.js');
function gateApi(extra = {}) {
  const window = { ...extra };
  vm.runInNewContext(gateSource, { window, URLSearchParams, AbortController, setTimeout, clearTimeout, Promise, Date, Error, Object, Array, Map, String, Number, JSON });
  return window;
}
const roster = [
  { charId: '11', slot: 1, name: '月光劍士', gender: 'm', baseClass: 'sword', classPath: '', level: 480, active: true },
  { charId: '12', slot: 2, name: '星環妖精', gender: 'f', baseClass: 'archer', classPath: 'B22', level: 481, active: false },
];
function controller({ signed = true, startParam = '', characters = roster, select = async () => ({ ok: true }) } = {}) {
  const { RpgEntryGate } = gateApi(), screens = [], requests = [], handoffs = [], waits = [];
  const gate = RpgEntryGate.createGate({
    signed, startParam,
    request: async (action, body) => { requests.push([action, body]); if (action === 'characters') { if (characters instanceof Error) throw characters; return { ok: true, characters, maxCharacters: 4 }; } return select(body); },
    portraits: async () => ({ sword_m: '/p/sword.webp', adv3_archer_B22_f: '/p/archer-b22.webp' }),
    render: (screen, html) => screens.push([screen, html]),
    handoff: options => handoffs.push(options),
    wait: async ms => { waits.push(ms); },
  });
  return { gate, screens, requests, handoffs, waits, RpgEntryGate };
}

test('every launch shows the classic splash first, then 選擇角色, and the scene is not opened before a choice', async () => {
  const c = controller();
  const started = c.gate.start();
  assert.equal(c.screens[0][0], 'splash', 'splash renders synchronously before any request resolves');
  for (const text of ['A JOURNAL BEYOND THE STARS', '星穹旅誌', '與星同行，將遠方寫成故事', 'journey-progress', 'Game Producer', 'ミカサ']) assert.ok(c.screens[0][1].includes(text), text);
  await started;
  assert.deepEqual(c.screens.map(s => s[0]), ['splash', 'select']);
  assert.ok(c.waits[0] > 0 && c.waits[0] <= 700, 'the splash stays up for its minimum time');
  const html = c.screens[1][1];
  for (const text of ['ADVENTURER SELECT', '選擇角色', '選定的角色會繼續離線掛機', '月光劍士', '劍士 · Lv.480', '上次掛機', '繼續冒險', '星環妖精', '妖精 · Lv.481', '2/4 名冒險者', '刪除角色']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('src="/p/archer-b22.webp"') && html.includes('src="/p/sword.webp"'), 'portraits follow the server appearance key');
  assert.equal((html.match(/data-new="/g) || []).length, 2, 'empty slots offer creation');
  assert.deepEqual(c.requests, [['characters', undefined]]);
  assert.deepEqual(plain(c.handoffs), []);
});

test('choosing a character calls the existing select API and only then hands off to the scene', async () => {
  const c = controller(); await c.gate.start();
  assert.equal(await c.gate.choose('99'), false, 'unknown ids are ignored');
  assert.equal(await c.gate.choose('12'), true);
  assert.deepEqual(c.requests.map(r => r[0]), ['characters', 'select']);
  assert.deepEqual(plain(c.requests[1][1]), { charId: '12' });
  assert.deepEqual(plain(c.handoffs), [{}]);
  assert.equal(await c.gate.choose('11'), false, 'hand-off happens once');
});

test('a failed select keeps the player on 選擇角色 with the server message', async () => {
  const c = controller({ select: async () => { throw Object.assign(new Error('角色正在遠征中'), { status: 409 }); } });
  await c.gate.start(); assert.equal(await c.gate.choose('12'), false);
  assert.deepEqual(plain(c.handoffs), []);
  assert.equal(c.screens.at(-1)[0], 'select'); assert.match(c.screens.at(-1)[1], /entry-gate-notice[^>]*>角色正在遠征中/);
});

test('create and delete open the scene character window; enter and unsigned launches go straight in', async () => {
  const a = controller(); await a.gate.start(); a.gate.manage(); assert.deepEqual(plain(a.handoffs), [{ route: 'characters' }]);
  const b = controller({ signed: false }); await b.gate.start();
  assert.deepEqual(b.screens.map(s => s[0]), ['splash']); assert.deepEqual(plain(b.handoffs), [{}]); assert.deepEqual(b.requests, []);
  const r = controller({ startParam: 'ring_' + 'a'.repeat(32) }); await r.gate.start();
  assert.deepEqual(plain(r.handoffs), [{}], 'a 星環 invite with an active character skips the picker'); assert.deepEqual(r.screens.map(s => s[0]), ['splash']);
});

test('roster errors show the classic retry screen; expired credentials explain how to reopen', async () => {
  const a = controller({ characters: new Error('連線暫時中斷') }); await a.gate.start();
  assert.equal(a.screens.at(-1)[0], 'error'); assert.match(a.screens.at(-1)[1], /data-entry-retry/); assert.match(a.screens.at(-1)[1], /data-entry-enter/);
  const b = controller({ characters: Object.assign(new Error('unauthorized'), { status: 401 }) }); await b.gate.start();
  assert.match(b.screens.at(-1)[1], /登入驗證失敗/); assert.doesNotMatch(b.screens.at(-1)[1], /data-entry-retry/);
});

test('the restored screens load the classic stylesheets that carry the original artwork', () => {
  const { RpgEntryGate } = gateApi();
  const css = RpgEntryGate.CLASSIC_CSS.map(href => read(href.slice(1).split('?')[0])).join('\n');
  assert.match(css, /skill-altar-banner\.webp/, 'splash background');
  assert.match(css, /olympus-sanctuary-v1\.png/, '選擇角色 background');
  const classic = read('classic.html');
  for (const href of RpgEntryGate.CLASSIC_CSS.slice(0, -1)) assert.ok(classic.includes('"' + href + '"') || classic.includes('"' + href.slice(1) + '"'), 'same stylesheet version as classic.html: ' + href);
});

function fakeDom({ initData = 'user=%7B%22id%22%3A1%7D&hash=x', version = '8.0' } = {}) {
  const calls = [], removed = [], bodyClasses = new Set(), listeners = {};
  const el = tag => ({ tagName: tag, dataset: {}, children: [], innerHTML: '', appendChild(c) { this.children.push(c); return c; }, remove() { removed.push(this); },
    addEventListener(type, fn) { listeners[type] = fn; }, querySelectorAll: () => [] });
  const frame = { id: 'demo', dataset: { sceneSrc: '/scene.html' }, src: '', getAttribute: k => k === 'src' && frame.src ? frame.src : null };
  const doc = { head: el('head'), body: { ...el('body'), classList: { add: (...c) => c.forEach(x => bodyClasses.add(x)), remove: (...c) => c.forEach(x => bodyClasses.delete(x)) } },
    createElement: el, getElementById: id => id === 'demo' ? frame : null };
  const tg = { initData, initDataUnsafe: {}, ready: () => calls.push('ready'), expand: () => calls.push('expand'), disableVerticalSwipes: () => calls.push('disableVerticalSwipes'),
    isVersionAtLeast: v => Number(version) >= Number(v), HapticFeedback: { notificationOccurred: () => {} } };
  const fetches = [];
  const fetch = async (url, options) => { fetches.push([url, options]);
    if (url.endsWith('.json')) return { ok: true, json: async () => ({ actors: [] }) };
    const action = url.split('/app/api/')[1];
    return { ok: true, status: 200, json: async () => action === 'characters' ? { ok: true, characters: roster } : { ok: true } }; };
  const events = [];
  const window = { document: doc, Telegram: { WebApp: tg }, location: { search: '' }, fetch, dispatchEvent: e => events.push(e), CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    RpgMonsterExpansion: { revision: 'monster16-v2-test' } };
  return { window, doc, frame, calls, removed, bodyClasses, listeners, fetches, events };
}

test('boot keeps the scene iframe unloaded behind the gate, disables vertical swipes, and loads it after select', async () => {
  const d = fakeDom();
  vm.runInNewContext(gateSource, { window: d.window, URLSearchParams, AbortController, setTimeout, clearTimeout, Promise, Date, Error, Object, Array, Map, String, Number, JSON });
  assert.deepEqual(plain(d.calls), ['ready', 'expand', 'disableVerticalSwipes']);
  assert.equal(d.frame.src, '', 'scene is not started before the choice');
  assert.ok(d.bodyClasses.has('mythic') && d.bodyClasses.has('olympus-suite'));
  const root = d.doc.body.children.find(c => c.className === 'entry-gate'), view = root.children[0];
  assert.equal(view.dataset.screen, 'splash');
  await new Promise(r => setTimeout(r, 800));
  assert.equal(view.dataset.screen, 'select'); assert.equal(d.frame.src, '');
  const [url, options] = d.fetches.find(f => f[0] === '/app/api/characters');
  assert.equal(url, '/app/api/characters'); assert.equal(options.headers['X-Realm-Id'], 'permanent'); assert.equal(options.headers['X-Monster-Art-Revision'], 'monster16-v2-test');
  const card = { dataset: { select: '12' }, querySelector: () => null };
  d.listeners.click({ target: { closest: () => card } });
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(d.fetches.find(f => f[0] === '/app/api/select')[1].body), { charId: '12' });
  assert.equal(d.frame.src, '/scene.html');
  assert.ok(d.removed.includes(root), 'gate removed at hand-off'); assert.equal(d.bodyClasses.size, 0);
  assert.equal(d.events.at(-1).type, 'rpg:entry-handoff');
});

test('older Telegram clients without vertical-swipe control still boot', () => {
  const d = fakeDom({ version: '7.0' });
  vm.runInNewContext(gateSource, { window: d.window, URLSearchParams, AbortController, setTimeout, clearTimeout, Promise, Date, Error, Object, Array, Map, String, Number, JSON });
  assert.deepEqual(plain(d.calls), ['ready', 'expand']);
});

test('the scene entry (/scene, the previous production home) is the packaged preview plus the gate, with a fallback if the gate script fails', () => {
  const index = read('scene.html'), preview = read('ui-generated-20261030/preview.html');
  assert.equal(index, withEntryGate(preview));
  assert.equal(withEntryGate(index), index, 'idempotent');
  const frame = index.match(/<iframe id="demo"[^>]*>/)[0];
  assert.doesNotMatch(frame, /\ssrc=/); assert.match(frame, /data-scene-src="\/ui-generated-20261030\/scene-bound-20261102\/scene\.html"/);
  assert.ok(index.indexOf('/entry-gate.js') > index.indexOf('<iframe id="demo"') && index.indexOf('/entry-gate.js') < index.indexOf('/ui-generated-20261030/preview.js'));
  const fallback = index.match(/<script src="\/entry-gate\.js[^"]*" onerror="([^"]+)"/)[1];
  const frameEl = { dataset: { sceneSrc: '/s.html' }, src: '', getAttribute: () => null };
  vm.runInNewContext(fallback, { document: { getElementById: () => frameEl } });
  assert.equal(frameEl.src, '/s.html');
});

test('packaged manifest matches the entry, the gate and the scene aliases', () => {
  const manifest = JSON.parse(read('scene-production-manifest.json'));
  const A = 'ui-generated-20261030/hud-angels-20261102/';
  for (const name of ['entry-gate.js', 'entry-gate.css', 'scene-live-auth.js', 'scene-live-view.js', 'scene-live-view.css']) assert.equal(read(A + name), read(name), 'alias is byte-identical: ' + name);
  for (const path of ['index.html', 'scene.html', A + 'entry-gate.js', A + 'entry-gate.css', A + 'scene-live-auth.js', A + 'scene-live-view.js', A + 'scene-live-view.css']) {
    const data = fs.readFileSync(new URL(path, pub)), entry = manifest.entries.find(e => e.url === '/' + path);
    assert.ok(entry, path); assert.equal(entry.bytes, data.length, path); assert.equal(entry.sha256, crypto.createHash('sha256').update(data).digest('hex'), path);
  }
});

test('bot deep links map to the scene windows that replaced the classic tabs', () => {
  const { RpgEntryGate } = gateApi(), map = v => plain(RpgEntryGate.deepLink(v));
  const expect = { bag: 'inventory', shop: 'shop', gacha: 'shop', boss: 'boss', guardian: 'guardian', fate: 'fate', 'star-ring': 'star-ring', class: 'career', trade: 'direct-trade', pk: 'duel' };
  for (const [screen, route] of Object.entries(expect)) { assert.deepEqual(map(screen), { route, params: {} }, screen); assert.deepEqual(map('rpg' + screen), { route, params: {} }, 'rpg' + screen); }
  assert.deepEqual(map('trade_t0123456789a'), { route: 'direct-trade', params: { tradeId: 't0123456789a' } });
  assert.deepEqual(map('req_q0123456789a'), { route: 'direct-trade', params: {} });
  assert.deepEqual(map('pk_p0123456789a'), { route: 'duel', params: {} });
  assert.deepEqual(map('party_abc123'), { route: 'party', params: { tab: 'current' } });
  assert.deepEqual(map('ring_' + 'f'.repeat(32)), { ring: true });
  assert.deepEqual(map('admin'), { admin: '/admin/' });
  assert.deepEqual(map('admin_' + 'a'.repeat(64)), { admin: '/admin/?approve=' + 'a'.repeat(64) });
  for (const none of ['', 'home', 'rpg', 'bestiary', 'trade_x', '../admin', 'admin_zz']) assert.equal(RpgEntryGate.deepLink(none), null, none);
  assert.equal(RpgEntryGate.sceneUrl('/s.html', { route: 'direct-trade', params: { tradeId: 't0123456789a', evil: 'x' } }), '/s.html?entry=direct-trade&tradeId=t0123456789a');
  assert.equal(RpgEntryGate.sceneUrl('/s.html', {}), '/s.html');
});

test('every screen the bot emits (cloud-bot deepLink/appBtn) resolves to a scene destination', () => {
  const { RpgEntryGate } = gateApi(), dir = new URL('../../cloud-bot/src/adapter/', import.meta.url), screens = new Set();
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(new URL(name, dir), 'utf8');
    for (const m of src.matchAll(/(?:deepLink|appBtn)\((?:'[^']*',\s*)?'([a-z-]+)'\)/g)) screens.add(m[1]);
    for (const m of src.matchAll(/(?:deepLink|appBtn)\([^)]*`([a-z]+)_\$\{/g)) screens.add(m[1] + '_');
    for (const m of src.matchAll(/(?:deepLink|appBtn)\('([a-z]+)_'\+/g)) screens.add(m[1] + '_');
    for (const m of src.matchAll(/screen = [^;]*?'([a-z-]+)'/g)) screens.add(m[1]);
  }
  for (const s of ['bag', 'shop', 'gacha', 'boss', 'guardian', 'fate', 'star-ring', 'trade_', 'pk_', 'party_', 'ring_']) assert.ok(screens.has(s), 'scan found ' + s);
  const sample = { trade_: 'trade_t0123456789a', req_: 'req_q0123456789a', pk_: 'pk_p0123456789a', party_: 'party_p1', ring_: 'ring_' + '0'.repeat(32) };
  assert.equal(RpgEntryGate.deepLink('home'), null, 'home is the default scene');
  const unmapped = [...screens].filter(s => !['home', 'material', 'relic', 'trade_request', 'trade_rejected'].includes(s)).filter(s => !RpgEntryGate.deepLink(sample[s] || s));
  assert.deepEqual(unmapped, []);
});

test('a deep link survives the select screen and opens its window; admin links leave before the splash', async () => {
  const { RpgEntryGate } = gateApi(), handoffs = [], screens = [], redirects = [];
  const deps = (startParam, extra = {}) => ({ signed: true, startParam, request: async a => a === 'characters' ? { characters: roster } : { ok: true }, portraits: async () => ({}),
    render: (s) => screens.push(s), handoff: o => handoffs.push(o), wait: async () => {}, redirect: url => redirects.push(url), ...extra });
  const bag = RpgEntryGate.createGate(deps('bag')); await bag.start();
  assert.equal(screens.at(-1), 'select', 'still chooses a character first (classic behaviour)');
  await bag.choose('12'); assert.deepEqual(plain(handoffs.at(-1)), { route: 'inventory', params: {} });
  const trade = RpgEntryGate.createGate(deps('rpgtrade_t0123456789a')); await trade.start(); trade.enter();
  assert.deepEqual(plain(handoffs.at(-1)), { route: 'direct-trade', params: { tradeId: 't0123456789a' } });
  const unsigned = RpgEntryGate.createGate(deps('boss', { signed: false })); await unsigned.start();
  assert.deepEqual(plain(handoffs.at(-1)), { route: 'boss', params: {} });
  screens.length = 0; const admin = RpgEntryGate.createGate(deps('admin')); await admin.start();
  assert.deepEqual(redirects, ['/admin/']); assert.deepEqual(screens, []);
});
