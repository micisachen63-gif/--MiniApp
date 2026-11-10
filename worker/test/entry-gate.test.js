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

test('the production entry is the packaged preview plus the gate, with a fallback if the gate script fails', () => {
  const index = read('index.html'), preview = read('ui-generated-20261030/preview.html');
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
  for (const path of ['index.html', A + 'entry-gate.js', A + 'entry-gate.css', A + 'scene-live-auth.js', A + 'scene-live-view.js', A + 'scene-live-view.css']) {
    const data = fs.readFileSync(new URL(path, pub)), entry = manifest.entries.find(e => e.url === '/' + path);
    assert.ok(entry, path); assert.equal(entry.bytes, data.length, path); assert.equal(entry.sha256, crypto.createHash('sha256').update(data).digest('hex'), path);
  }
});
