import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/scene-live-view.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this.disabled = false; this.textContent = ''; this.className = ''; this.id = ''; this.parent = null;
    this.classList = { add: (...names) => this.classes = new Set([...(this.classes || []), ...names]),
      remove: (...names) => { for (const name of names) this.classes?.delete(name); },
      toggle: (name, value) => value ? this.classList.add(name) : this.classList.remove(name) };
  }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  set innerHTML(value) {
    this.children = [];
    for (const match of value.matchAll(/<(i|span) class="([^"]+)"/g)) {
      const child = new Element(match[1]); child.className = match[2]; this.appendChild(child);
    }
  }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    const match = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector);
    return !!match && this.dataset[match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === match[2];
  }
  querySelectorAll(selector) {
    const nodes = [];
    for (const child of this.children) { if (child.matches(selector)) nodes.push(child); nodes.push(...child.querySelectorAll(selector)); }
    return nodes;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { if (!this.disabled) this.onclick?.({}); }
}
function snapshot({ accountId = '90101', realmId = 'permanent', characterId = 'A', revision = 7, active = false } = {}) {
  return {
    schemaVersion: 1, realmId, accountId, characterId, serverNow: 10000,
    character: { id: characterId, name: '法師甲', baseClass: 'mage', gender: 'm', classPath: 'B22', appearanceKey: 'adv3_mage_B22_m', level: 90, revision },
    live: { hp: 23, maxHp: 100, mp: 12, maxMp: 40, revision, activeRunId: active ? 'R' : null,
      supplies: { hp: 8, mp: 6, totals: { hp: 47, mp: 0 } } },
    run: active ? { id: 'R', realmId, characterId, revision: 5, active: true, status: 'running',
      hero: { hp: 0, maxHp: 120, mp: 3, maxMp: 60 }, supplies: { hp: 4, mp: 2 }, enemies: [] } : null,
  };
}
function skills(snap, { revision = snap.live.revision, loadout = ['mage-frost', 'mage-flame'], accountId } = {}) {
  return { ok: true, realmId: snap.realmId, characterId: snap.characterId, ...(accountId ? { accountId } : {}),
    character: { tgId: snap.characterId, revision },
    skills: [
      { id: 'mage-frost', name: '冰封牢籠' }, { id: 'mage-flame', name: '焚天炎術' },
      { id: 'archer-heal', name: '月光療癒' }, { id: 'thief-venom', name: '淬毒刃' },
    ],
    special: { loadout, learned: loadout.filter(Boolean), cooldowns: { 'mage-frost': 120000 } }, eligible: loadout.filter(Boolean),
  };
}
function harness(initial = null, initialContext = null) {
  const html = new Element('html'), head = new Element('head'), body = new Element('body');
  html.appendChild(head); html.appendChild(body);
  const mid = body.appendChild(new Element()); mid.id = 'mid';
  const xp = mid.appendChild(new Element()); xp.id = 'xp';
  const xpFill = xp.appendChild(new Element()); xpFill.id = 'xpfill';
  for (const kind of ['hp', 'mp']) {
    const value = body.appendChild(new Element('span')); value.id = kind + 'Txt'; value.textContent = kind === 'hp' ? '70%' : '45%';
    const orb = body.appendChild(new Element()); orb.className = 'candidate-orb candidate-' + kind;
    const fill = orb.appendChild(new Element()); fill.className = 'candidate-fill'; fill.style.height = kind === 'hp' ? '70%' : '45%';
    const number = orb.appendChild(new Element('span')); number.className = 'candidate-number'; number.textContent = kind === 'hp' ? '70%' : '45%';
    const bezel = orb.appendChild(new Element('img')); bezel.className = 'candidate-frame';
  }
  const listeners = new Map(), docListeners = new Map();
  const document = { head, body, documentElement: html, hidden: false, createElement: tag => new Element(tag),
    getElementById: id => html.querySelector('#' + id), querySelector: selector => html.querySelector(selector),
    querySelectorAll: selector => html.querySelectorAll(selector),
    addEventListener: (type, listener) => { docListeners.set(type, listener); } };
  let current = initial, context = initialContext || { accountId: initial?.accountId || '90101', realmId: initial?.realmId || 'permanent', characterId: initial?.characterId || 'A', epoch: 0 };
  const requests = [], navigation = [];
  const window = { __RpgScenePreviewConfig: { live: true }, document, UI: {}, AbortController,
    addEventListener: (type, listener) => listeners.set(type, listener),
    RpgSceneNavigation: { navigate: route => navigation.push(route) },
    RpgSceneSession: {
      getContext: () => ({ ...context }), getSnapshot: () => current,
      request(action, body, options) {
        assert.equal(action, 'skill-career', 'HUD must only call the existing pure read');
        assert.deepEqual(JSON.parse(JSON.stringify(body)), {});
        return new Promise((resolve, reject) => requests.push({ action, options, resolve, reject, context: { ...context } }));
      },
    },
  };
  vm.runInNewContext(source, { window, Intl, Number, Object, Set, Map, String, Error, Date });
  window.RpgSceneLiveView.mountHUD();
  const api = window.RpgSceneLiveView, row = () => document.getElementById('hud-v2-actions');
  return { api, document, requests, navigation, row, listeners,
    skill: index => row().querySelector('[data-live-skill="' + index + '"]'),
    potion: kind => row().querySelector('[data-live-potion="' + kind + '"]'),
    publish(value) { current = value; listeners.get('rpg:scene-state')({ detail: value }); },
    change(next) { context = { ...context, ...next, epoch: context.epoch + 1 }; current = null; listeners.get('rpg:scene-state')({ detail: null }); },
    error() { listeners.get('rpg:scene-error')({ detail: { message: 'fixture offline' } }); },
    visibility(hidden) { document.hidden = hidden; docListeners.get('visibilitychange')?.(); },
    context: () => context,
  };
}
test('first load and absent snapshot expose unknown values, never prototype counts or percentages', async () => {
  const h = harness(); await tick();
  assert.equal(h.requests.length, 0); assert.equal(h.row().children.length, 5);
  assert.equal(h.potion('hp').querySelector('.hud-v2-count').textContent, '—');
  assert.equal(h.potion('mp').querySelector('.hud-v2-count').textContent, '—');
  for (const kind of ['hp', 'mp']) {
    assert.equal(h.document.querySelector('.candidate-' + kind).querySelector('.candidate-number').textContent, '—');
    assert.equal(h.document.querySelector('.candidate-' + kind).querySelector('.candidate-fill').style.visibility, 'hidden');
  }
  for (const button of h.row().children) { assert.equal(button.disabled, true); button.click(); }
  assert.deepEqual(h.navigation, []);
  h.api.mountHUD(); assert.equal(h.document.querySelectorAll('#hud-v2-actions').length, 1);
  assert.equal(h.document.getElementById('hud-v2-style').href, '/ui/hud-v2/hud-v2.css');
  assert.ok(h.document.querySelectorAll('.candidate-frame').every(node => node.src === '/ui/hud-v2/orb-bezel.webp'));
});

test('visible EXP follows committed snapshots, preserves zero and clears between characters', async () => {
  const h = harness();
  const caption = h.document.getElementById('scene-xp-caption');
  const bar = h.document.getElementById('xp');
  const fill = h.document.getElementById('xpfill');
  assert.equal(caption.textContent, 'EXP 待同步');
  assert.equal(fill.style.visibility, 'hidden');
  const zero = snapshot();
  zero.live.experience = { current: 0, required: 400, ratio: 0, maxLevel: false };
  h.publish(zero); await tick();
  assert.equal(caption.textContent, 'EXP 0.0% · 0 / 400');
  assert.equal(bar.getAttribute('aria-valuenow'), '0');
  assert.equal(fill.style.visibility, 'visible');
  const partial = snapshot({ revision: 8 });
  partial.live.experience = { current: 1250, required: 5000, ratio: 0.25, maxLevel: false };
  h.publish(partial); await tick();
  assert.equal(caption.textContent, 'EXP 25.0% · 1,250 / 5,000');
  assert.equal(bar.getAttribute('aria-valuetext'), caption.textContent);
  h.error();
  assert.equal(caption.dataset.authority, 'stale');
  assert.equal(fill.dataset.authority, 'stale');
  assert.equal(bar.getAttribute('aria-valuetext'), caption.textContent);
  assert.match(caption.textContent, /^上次同步 · EXP 25.0%/);
  h.change({ characterId: 'B' });
  assert.equal(caption.textContent, 'EXP 待同步');
  assert.equal(bar.getAttribute('aria-valuenow'), undefined);
  assert.equal(fill.style.visibility, 'hidden');
  const maximum = snapshot({ characterId: 'B', revision: 9 });
  maximum.live.experience = { current: 0, required: null, ratio: 1, maxLevel: true };
  h.publish(maximum); await tick();
  assert.equal(caption.textContent, 'EXP 已達滿級');
  assert.equal(bar.getAttribute('aria-valuenow'), '100');
  const missing = snapshot({ characterId: 'B', revision: 10 });
  h.publish(missing); await tick();
  assert.equal(caption.textContent, 'EXP 待同步', 'missing authoritative EXP cannot retain a previous character level');
  assert.equal(fill.style.visibility, 'hidden');
  h.api.mountHUD();
  assert.equal(h.document.querySelectorAll('#scene-xp-caption').length, 1);
});
test('three slots preserve actual ordered class skills and empty positions, navigation never casts or drinks', async () => {
  const snap = snapshot(), h = harness(snap); await tick();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(skills(snap, { loadout: ['archer-heal', null, 'thief-venom'] })); await tick();
  assert.equal(h.skill(0).dataset.skillId, 'archer-heal'); assert.equal(h.skill(0).querySelector('.hud-v2-name').textContent, '月光療癒');
  assert.equal(h.skill(1).dataset.skillId, ''); assert.equal(h.skill(1).querySelector('.hud-v2-name').textContent, '未配置');
  assert.equal(h.skill(2).dataset.skillId, 'thief-venom');
  assert.equal(h.skill(0).querySelector('.hud-v2-icon').textContent, '月');
  assert.equal(h.skill(2).querySelector('.hud-v2-icon').textContent, '淬');
  for (const button of h.row().children) button.click();
  assert.deepEqual(h.navigation, ['supplies', 'supplies', 'skills', 'skills', 'skills']);
  assert.equal(h.requests.length, 1, 'clicking the row cannot submit a mutation');
  assert.match(h.skill(0).title, /開啟技能配置/); assert.doesNotMatch(h.skill(0).title, /可施放/);
  assert.equal(h.potion('hp').querySelector('.hud-v2-count').textContent, '47');
  assert.equal(h.potion('mp').querySelector('.hud-v2-count').textContent, '0', 'known zero must survive');
  assert.match(h.potion('hp').title, /庫存合計/); assert.match(h.potion('hp').title, /原規則自動使用/);
  assert.ok(!h.listeners.has('keydown'), 'this navigation row does not capture typing, IME or modal hotkeys');
});
test('active expedition counters use current-run reserves rather than camp totals', async () => {
  const snap = snapshot({ active: true }), h = harness(snap); await tick();
  h.requests[0].resolve(skills(snap)); await tick();
  assert.equal(h.potion('hp').querySelector('.hud-v2-count').textContent, '4');
  assert.equal(h.potion('mp').querySelector('.hud-v2-count').textContent, '2');
  assert.match(h.potion('hp').title, /當趟剩餘/);
  const next = snapshot({ revision: 8, active: false }); h.publish(next); await tick();
  assert.equal(h.potion('hp').querySelector('.hud-v2-count').textContent, '47'); assert.match(h.potion('hp').title, /庫存合計/);
});
test('A to B to A clears old skills immediately and rejects both late generations', async () => {
  const a = snapshot(), h = harness(a); await tick(); const original = h.requests[0];
  h.change({ characterId: 'B' });
  assert.equal(h.skill(0).dataset.skillId, ''); assert.equal(h.potion('hp').querySelector('.hud-v2-count').textContent, '—');
  assert.equal(h.skill(0).disabled, true); assert.equal(original.options.signal.aborted, true);
  const b = snapshot({ characterId: 'B', revision: 8 }); h.publish(b); await tick(); const second = h.requests[1];
  h.change({ characterId: 'A' }); h.publish(a); await tick(); const final = h.requests[2];
  original.resolve(skills(a)); second.resolve(skills(b, { loadout: ['thief-venom'] })); await tick();
  assert.equal(h.skill(0).dataset.skillId, '');
  final.resolve(skills(a, { loadout: ['mage-flame'] })); await tick();
  assert.equal(h.skill(0).dataset.skillId, 'mage-flame'); assert.equal(h.api.inspectHUD().status, 'ready');
});
test('same actor in a new account and realm cannot reuse old projection or accept cross-scope payload', async () => {
  const a = snapshot(), h = harness(a); await tick();
  h.requests[0].resolve(skills(a)); await tick();
  h.change({ accountId: '90102', realmId: 'season-one' });
  assert.equal(h.skill(0).dataset.skillId, '');
  const b = snapshot({ accountId: '90102', realmId: 'season-one' }); h.publish(b); await tick();
  h.requests[1].resolve(skills(a)); await tick();
  assert.equal(h.api.inspectHUD().status, 'error'); assert.equal(h.skill(0).dataset.skillId, '');
  h.publish(b); await tick(); h.requests[2].resolve(skills(b, { accountId: '90101' })); await tick();
  assert.equal(h.api.inspectHUD().status, 'error'); assert.equal(h.skill(0).dataset.skillId, '');
  h.publish(b); await tick(); h.requests[3].resolve(skills(b)); await tick();
  assert.equal(h.skill(0).dataset.skillId, 'mage-frost');
});
test('new revisions coalesce repeated snapshots and stale read responses cannot restore older skills', async () => {
  const a = snapshot({ revision: 7 }), h = harness(a); await tick();
  h.publish(a); h.publish(a); await tick(); assert.equal(h.requests.length, 1);
  const newer = snapshot({ revision: 8 }); h.publish(newer); await tick(); assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].resolve(skills(a)); h.requests[1].resolve(skills(newer, { revision: 7 })); await tick();
  assert.equal(h.api.inspectHUD().status, 'error'); assert.equal(h.skill(0).dataset.skillId, '');
  h.publish(newer); await tick(); h.requests[2].resolve(skills(newer, { revision: 8, loadout: ['mage-flame'] })); await tick();
  assert.equal(h.skill(0).dataset.skillId, 'mage-flame');
  h.publish(newer); h.api.refreshHUD(); await tick(); assert.equal(h.requests.length, 3);
});
test('unknown skill IDs or duplicate slots do not manufacture a fallback warrior skill', async () => {
  for (const loadout of [['unmapped'], ['mage-frost', 'mage-frost']]) {
    const snap = snapshot(), h = harness(snap); await tick(); h.requests[0].resolve(skills(snap, { loadout })); await tick();
    assert.equal(h.api.inspectHUD().status, 'error'); assert.equal(h.skill(0).dataset.skillId, '');
    assert.equal(h.skill(0).querySelector('.hud-v2-name').textContent, '待同步');
  }
});
test('offline state removes skill projections and marks retained potion values as last synchronized', async () => {
  const snap = snapshot(), h = harness(snap); await tick(); h.requests[0].resolve(skills(snap)); await tick();
  assert.equal(h.skill(0).dataset.skillId, 'mage-frost'); h.error();
  assert.equal(h.skill(0).dataset.skillId, ''); assert.equal(h.skill(0).dataset.authority, 'unknown');
  assert.equal(h.potion('hp').dataset.authority, 'stale'); assert.match(h.potion('hp').title, /上次同步/);
  assert.equal(h.potion('hp').querySelector('.hud-v2-count').textContent, '47');
  h.publish(snap); await tick(); h.requests[1].reject(new Error('fixture disconnected')); await tick();
  assert.equal(h.api.inspectHUD().status, 'error'); assert.equal(h.skill(0).dataset.skillId, '');
  assert.equal(h.skill(0).querySelector('.hud-v2-count').textContent, '', 'no simulated cooldown');
});
test('hidden-page snapshots do not start new skill requests; visibility resumes one scoped read', async () => {
  const h = harness(); h.visibility(true); const snap = snapshot(); h.publish(snap); await tick();
  assert.equal(h.requests.length, 0);
  h.visibility(false); await tick(); assert.equal(h.requests.length, 1);
  h.requests[0].resolve(skills(snap)); await tick();
  h.visibility(false); await tick(); assert.equal(h.requests.length, 1);
});

test('a valid snapshot renders genuine resources even before the Phaser viewer finishes mounting', async () => {
  const snap = snapshot({ active: true }), h = harness(snap); await tick();
  const hp = h.document.querySelector('.candidate-hp'), mp = h.document.querySelector('.candidate-mp');
  assert.equal(hp.querySelector('.candidate-number').textContent, '0');
  assert.equal(hp.querySelector('.candidate-fill').style.visibility, 'hidden');
  assert.equal(hp.dataset.authority, 'committed'); assert.match(hp.title, /0 \/ 120/);
  assert.equal(mp.querySelector('.candidate-number').textContent, '3');
  assert.equal(mp.querySelector('.candidate-fill').style.height, '5%');
});
test('a context switch before the pending microtask does not issue an obsolete read under the new account', async () => {
  const h = harness(snapshot());
  h.change({ accountId: '90102', characterId: 'B' });
  await tick(); assert.equal(h.requests.length, 0);
  assert.equal(h.skill(0).dataset.skillId, ''); assert.equal(h.skill(0).disabled, true);
});

test('accepted skill revision floor survives same-context offline and visibility resets', async () => {
  for (const reset of ['offline', 'hidden']) {
    const snap = snapshot({ revision: 7 }), h = harness(snap); await tick();
    h.requests[0].resolve(skills(snap, { revision: 9 })); await tick();
    assert.equal(h.api.inspectHUD().revision, 9);
    if (reset === 'offline') { h.error(); h.publish(snap); }
    else { h.visibility(true); h.publish(snap); h.visibility(false); }
    await tick(); h.requests[1].resolve(skills(snap, { revision: 8, loadout: ['mage-flame'] })); await tick();
    assert.equal(h.api.inspectHUD().status, 'error', reset);
    assert.equal(h.skill(0).dataset.skillId, '', reset);
  }
});
