import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scene-live-session.js', import.meta.url), 'utf8');
const guideSource = fs.readFileSync(new URL('../public/scene-atlas-guide.js', import.meta.url), 'utf8');
const endpoint = 'http://127.0.0.1:9644/app/api/';
const plain = value => JSON.parse(JSON.stringify(value));
const drain = () => new Promise(resolve => setImmediate(resolve));
const outcome = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function scene({ characterId = 'a', realmId = 'permanent', accountId = '90101',
  revision = 1, runRevision = 1, runId = 'run-a', name = '目前角色', serverNow = 60000, processedAt = 0 } = {}) {
  return {
    schemaVersion: 1, accountId, realmId, characterId, serverNow,
    character: { name, baseClass: 'sword', gender: 'f', classPath: '', level: 15 },
    live: { revision, hp: 90, maxHp: 100, mp: 35, maxMp: 50, partyId: null, activeRunId: runId },
    run: runId ? {
      id: runId, characterId, realmId, revision: runRevision, status: 'running', active: true, processedAt,
      hero: { hp: 30, maxHp: 100, mp: 12, maxMp: 50 },
    } : null,
  };
}

function clock() {
  let next = 0, at = 0;
  const intervals = new Map(), deadlines = new Map();
  return {
    intervals, deadlines, now: () => at, advance(ms) { at += ms; },
    setTimeout(fn, ms) { const id = ++next; deadlines.set(id, { fn, ms }); return id; },
    clearTimeout(id) { deadlines.delete(id); },
    setInterval(fn, ms) { const id = ++next; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    tick() { at += 15000; for (const { fn } of [...intervals.values()]) fn(); },
  };
}

function network() {
  const calls = [];
  // Deliberately allow a response after AbortSignal aborts. A response already
  // in flight must be rejected by context/revision checks, not only by abort.
  const fetch = (url, options) => {
    const result = deferred();
    calls.push({
      action: url.slice(endpoint.length), url, options, body: JSON.parse(options.body),
      reply(data, status = 200) {
        result.resolve({ ok: status >= 200 && status < 300, status, json: async () => plain(data) });
      },
      fail(error = Error('offline')) { result.reject(error); },
    });
    return result.promise;
  };
  return { calls, fetch };
}

function harness(extra = {}) {
  const time = clock(), net = network(), snapshots = [], errors = [];
  const sandbox = {
    AbortController, queueMicrotask, console,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    setInterval: time.setInterval, clearInterval: time.clearInterval,
    fetch: net.fetch,
  };
  vm.runInNewContext(source, sandbox, { filename: 'scene-live-session.js' });
  const client = sandbox.RpgSceneSession.create({
    endpoint, fetch: net.fetch, accountId: '90101', realmId: 'permanent', characterId: 'a', now: time.now,
    onSnapshot: value => snapshots.push(value), onError: error => errors.push(error), ...extra,
  });
  return { client, time, net, snapshots, errors };
}

async function seed(h, value = scene()) {
  const pending = h.client.refresh();
  h.net.calls.at(-1).reply({ ok: true, scene: value });
  await pending;
}

test('refreshes coalesce and use only readonly Atlas status with the selected context', async t => {
  const h = harness({ realmId: 'season', characterId: 'season-a' });
  t.after(() => h.client.dispose());
  const first = h.client.refresh(), second = h.client.refresh();
  assert.equal(first, second);
  assert.equal(h.net.calls.length, 1);
  const request = h.net.calls[0];
  assert.equal(request.action, 'atlas/status');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['X-Realm-Id'], 'season');
  assert.equal(request.options.headers['X-Dev-Tg-Id'], '90101');
  assert.deepEqual(request.body, { selectedCharacterId: 'season-a' });
  request.reply({ ok: true, scene: scene({ realmId: 'season', characterId: 'season-a' }) });
  await first;
  assert.equal(h.client.getSnapshot().characterId, 'season-a');
  assert.deepEqual(h.net.calls.map(call => call.action), ['atlas/status']);
});

test('a forced newer read rejects a late response even if abort is ignored', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const old = outcome(h.client.refresh());
  const current = h.client.refresh({ force: true });
  assert.equal(h.net.calls[0].options.signal.aborted, true);
  h.net.calls[1].reply({ ok: true, scene: scene({ revision: 4, name: '新戰況' }) });
  await current;
  h.net.calls[0].reply({ ok: true, scene: scene({ revision: 99, name: '過期回覆' }) });
  const rejected = await old;
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'stale_response');
  assert.equal(h.client.getSnapshot().character.name, '新戰況');
  assert.equal(h.snapshots.filter(Boolean).length, 1);
});

test('newer HTTP requests cannot roll back live or same-run committed revisions', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  await seed(h, scene({ revision: 10, runRevision: 5 }));
  for (const candidate of [
    scene({ revision: 9, runRevision: 6 }),
    scene({ revision: 10, runRevision: 4 }),
  ]) {
    const pending = outcome(h.client.refresh());
    h.net.calls.at(-1).reply({ ok: true, scene: candidate });
    const rejected = await pending;
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'stale_response');
    assert.equal(h.client.getSnapshot().live.revision, 10);
    assert.equal(h.client.getSnapshot().run.revision, 5);
  }
  const nextRun = h.client.refresh();
  h.net.calls.at(-1).reply({ ok: true, scene: scene({ revision: 11, runId: 'run-b', runRevision: 0 }) });
  await nextRun;
  assert.equal(h.client.getSnapshot().run.id, 'run-b');
});

test('A to B to A invalidates both old epochs and clears the scene before discovery', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const firstA = outcome(h.client.refresh());
  h.client.setContext({ characterId: 'b' });
  assert.equal(h.client.getSnapshot(), null);
  const b = outcome(h.client.refresh());
  h.client.setContext({ characterId: 'a' });
  assert.equal(h.client.getContext().epoch, 2);
  const currentA = h.client.refresh();
  h.net.calls[2].reply({ ok: true, scene: scene({ name: '第三個上下文' }) });
  await currentA;
  h.net.calls[1].reply({ ok: true, scene: scene({ characterId: 'b', revision: 100 }) });
  h.net.calls[0].reply({ ok: true, scene: scene({ revision: 101, name: '第一個上下文' }) });
  for (const result of [await firstA, await b]) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'context_changed');
  }
  assert.deepEqual(h.snapshots.filter(Boolean).map(value => value.character.name), ['第三個上下文']);
  assert.equal(h.client.getSnapshot().characterId, 'a');
  assert.equal(h.net.calls[0].options.signal.aborted, true);
  assert.equal(h.net.calls[1].options.signal.aborted, true);
});

test('mismatched account, realm, character, or nested run identity is rejected', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  await seed(h, scene({ name: '可信快照' }));
  const badRunCharacter = scene(); badRunCharacter.run.characterId = 'b';
  const badRunRealm = scene(); badRunRealm.run.realmId = 'season';
  const candidates = [
    scene({ accountId: 'another-account' }), scene({ realmId: 'season' }),
    scene({ characterId: 'b' }), badRunCharacter, badRunRealm,
  ];
  for (const candidate of candidates) {
    const pending = outcome(h.client.refresh());
    h.net.calls.at(-1).reply({ ok: true, scene: candidate });
    const rejected = await pending;
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'context_changed');
    assert.equal(h.client.getSnapshot().character.name, '可信快照');
    assert.equal(h.client.getContext().characterId, 'a');
  }
});

test('request callers cannot overwrite the active selectedCharacterId', async t => {
  const h = harness({ characterId: 'a', realmId: 'season' });
  t.after(() => h.client.dispose());
  const pending = h.client.request('atlas/quests', { selectedCharacterId: 'b' });
  const request = h.net.calls[0];
  assert.equal(request.body.selectedCharacterId, 'a');
  assert.equal(request.options.headers['X-Realm-Id'], 'season');
  request.reply({ ok: true, quests: [] });
  await pending;
  assert.equal(h.net.calls.length, 1);
});

test('an acknowledged write stays successful when its follow-up readonly refresh fails', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  await seed(h);
  const write = h.client.request('atlas/start', { requestId: 'start-once', mapId: 'laurel_intro' });
  h.net.calls[1].reply({ ok: true, receipt: 'start-once', started: true });
  await drain();
  assert.equal(h.net.calls[2].action, 'atlas/status');
  h.net.calls[2].fail(Error('status connection lost'));
  const result = await write;
  assert.equal(result.receipt, 'start-once');
  assert.equal(result.started, true);
  assert.match(h.client.getError(), /未連線/);
  assert.equal(h.net.calls.filter(call => call.action === 'atlas/start').length, 1);
  assert.deepEqual(h.net.calls.map(call => call.action), ['atlas/status', 'atlas/start', 'atlas/status']);
});

test('an acknowledged write with an obsolete scene keeps its receipt and refreshes', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  await seed(h);
  const write = outcome(h.client.request('atlas/settle', { requestId: 'settle-once', runId: 'run-a' }));
  const newer = h.client.request('atlas/status');
  h.net.calls[2].reply({ ok: true, scene: scene({ revision: 3, runRevision: 3 }) });
  await newer;
  h.net.calls[1].reply({ ok: true, receipt: 'settle-once', scene: scene({ revision: 2, runRevision: 2 }) });
  await drain();
  assert.equal(h.net.calls.length, 4, 'successful writes still perform a readonly refresh after ignoring stale presentation data');
  assert.equal(h.net.calls[3].action, 'atlas/status');
  h.net.calls[3].reply({ ok: true, scene: scene({ revision: 4, runRevision: 4 }) });
  const result = await write;
  assert.equal(result.ok, true);
  assert.equal(result.value.receipt, 'settle-once');
  assert.equal(h.client.getSnapshot().live.revision, 4);
  assert.equal(h.net.calls.filter(call => call.action === 'atlas/settle').length, 1);
});

test('a lost mutation response is uncertain and never automatically replayed', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const write = outcome(h.client.request('atlas/start', { requestId: 'lost-start' }));
  h.net.calls[0].fail(Error('network ended before receipt'));
  const result = await write;
  assert.equal(result.ok, false);
  assert.equal(result.error.uncertain, true);
  assert.equal(result.error.code, 'connection_failed');
  await drain();
  assert.deepEqual(h.net.calls.map(call => call.action), ['atlas/start']);
});

test('failed explicit selection discovers the active character with a read and never retries selection', async t => {
  for (const lost of [true, false]) {
    const h = harness();
    t.after(() => h.client.dispose());
    await seed(h);
    const selection = outcome(h.client.selectCharacter('b'));
    assert.equal(h.client.getSnapshot(), null);
    assert.equal(h.net.calls[1].action, 'select');
    assert.deepEqual(h.net.calls[1].body, { charId: 'b' });
    assert.equal(await h.client.refresh(), null);
    assert.equal(h.net.calls.length, 2, 'ordinary polling is suppressed while selecting');
    if (lost) h.net.calls[1].fail(Error('select may have committed'));
    else h.net.calls[1].reply({ ok: false, error: 'character_not_found' }, 404);
    await drain();
    assert.equal(h.net.calls[2].action, 'atlas/status');
    assert.deepEqual(h.net.calls[2].body, {});
    h.net.calls[2].reply({ ok: true, scene: scene({ characterId: lost ? 'b' : 'a' }) });
    const result = await selection;
    assert.equal(result.ok, false);
    assert.equal(result.error.uncertain, lost);
    assert.equal(h.client.getSnapshot().characterId, lost ? 'b' : 'a');
    assert.equal(h.net.calls.filter(call => call.action === 'select').length, 1);
  }
});

test('server character_changed clears the old scene and performs readonly active-character discovery', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  await seed(h);
  const old = outcome(h.client.refresh());
  h.net.calls[1].reply({ ok: false, error: 'character_changed' }, 409);
  const rejected = await old;
  assert.equal(rejected.error.code, 'character_changed');
  await drain();
  assert.equal(h.client.getSnapshot(), null);
  assert.equal(h.net.calls.length, 3);
  assert.equal(h.net.calls[2].action, 'atlas/status');
  assert.deepEqual(h.net.calls[2].body, {});
  h.net.calls[2].reply({ ok: true, scene: scene({ characterId: 'b' }) });
  await drain();
  assert.equal(h.client.getSnapshot().characterId, 'b');
  assert.ok(h.net.calls.every(call => call.action === 'atlas/status'));
});

function eventTarget(target = {}) {
  const listeners = new Map();
  target.addEventListener = (type, fn, options = {}) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push({ fn, once: !!options.once });
  };
  target.dispatchEvent = event => {
    const entries = [...(listeners.get(event.type) || [])];
    for (const entry of entries) {
      if (entry.once) listeners.set(event.type, (listeners.get(event.type) || []).filter(item => item !== entry));
      entry.fn(event);
    }
    return true;
  };
  return target;
}

test('browser visibility and pagehide keep one poller and never poll after disposal', async () => {
  const time = clock(), net = network(), stateEvents = [];
  const document = eventTarget({ hidden: true });
  const sandbox = eventTarget({
    AbortController, queueMicrotask, console, document, fetch: net.fetch,
    location: { origin: 'http://127.0.0.1:9595' },
    __RpgScenePreviewConfig: { live: true, endpoint, accountId: '90101', realmId: 'permanent' },
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    setInterval: time.setInterval, clearInterval: time.clearInterval,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  sandbox.window = sandbox;
  sandbox.addEventListener('rpg:scene-state', event => stateEvents.push(event.detail));
  vm.runInNewContext(source, sandbox, { filename: 'scene-live-session.js' });
  const client = sandbox.RpgSceneSession;
  client.start(); client.start();
  assert.equal(time.intervals.size, 1);
  time.tick();
  assert.equal(net.calls.length, 0);
  document.hidden = false;
  document.dispatchEvent({ type: 'visibilitychange' });
  document.dispatchEvent({ type: 'visibilitychange' });
  time.tick();
  assert.equal(net.calls.length, 1);
  net.calls[0].reply({ ok: true, scene: scene({ runId: null }) });
  await drain();
  document.hidden = true;
  time.tick(); time.tick();
  assert.equal(net.calls.length, 1);
  document.hidden = false;
  document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(net.calls.length, 2);
  sandbox.dispatchEvent({ type: 'pagehide' });
  assert.equal(time.intervals.size, 0);
  assert.equal(net.calls[1].options.signal.aborted, true);
  assert.equal(client.getSnapshot(), null);
  net.calls[1].reply({ ok: true, scene: scene({ revision: 20 }) });
  await drain();
  time.tick();
  document.dispatchEvent({ type: 'visibilitychange' });
  client.start();
  await drain();
  assert.equal(net.calls.length, 2);
  assert.equal(time.intervals.size, 0);
  assert.equal(client.getSnapshot(), null);
  assert.equal(stateEvents.at(-1), null);
  assert.deepEqual(stateEvents.filter(Boolean).map(value => value.live.revision), [1]);
  assert.ok(net.calls.every(call => call.action === 'atlas/status'));
});

function guideHarness() {
  const calls = [], store = new Map(), rendered = [];
  let actor = { tgId: 'a', name: '目前角色', level: 15, baseClass: 'sword', partyId: null };
  let context = { realmId: 'season', characterId: 'a', epoch: 1 };
  const guideButton = { dataset: { talentGuide: 'dismiss_guide' } };
  const body = {
    innerHTML: '', scrollTop: 0,
    closest() { return null; }, querySelector() { return null; },
    querySelectorAll(selector) { return selector === '[data-talent-guide]' ? [guideButton] : []; },
  };
  const sandbox = {
    window: {
      RpgAtlasTalents: { render(talents) { rendered.push(talents.marker); return '<p>天賦</p>'; } },
      RpgAtlasProgression: { render() { return '<p>進度</p>'; } },
    },
    sessionStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    crypto: { randomUUID: () => 'guide-write-once' },
  };
  vm.runInNewContext(guideSource, sandbox, { filename: 'scene-atlas-guide.js' });
  const host = {
    actor: { ...actor }, realmId: 'season', getActor: () => actor, getContext: () => context,
    request(action, payload) { const result = deferred(); calls.push({ action, payload, ...result }); return result.promise; },
  };
  const view = sandbox.window.RpgSceneAtlasGuide.mount(body, host, 'talents');
  return {
    calls, store, rendered, body, guideButton, view,
    setContext(next) { context = { ...context, ...next }; actor = { ...actor, tgId: context.characterId }; },
  };
}
const guideState = marker => ({ talents: { revision: 1, marker }, run: null, canStart: true });

test('a mounted Atlas window rejects late reads after realm or A to B to A epoch changes', async () => {
  for (const change of [{ realmId: 'permanent', epoch: 2 }, { characterId: 'a', epoch: 3 }]) {
    const h = guideHarness();
    if (change.characterId) h.setContext({ characterId: 'b', epoch: 2 });
    h.setContext(change);
    h.calls.find(call => call.action === 'atlas/catalog').resolve({ catalog: {} });
    h.calls.find(call => call.action === 'atlas/status').resolve(guideState('old-context'));
    await drain();
    assert.equal(h.rendered.length, 0);
    h.view.dispose();
  }
});

test('Atlas window clears the acknowledged pending write even if its own refresh fails', async () => {
  const h = guideHarness();
  h.calls.find(call => call.action === 'atlas/catalog').resolve({ catalog: {} });
  h.calls.find(call => call.action === 'atlas/status').resolve(guideState('ready'));
  await drain();
  h.guideButton.onclick();
  await drain();
  const write = h.calls.find(call => call.action === 'atlas/talents/action');
  assert.ok(write);
  assert.equal(write.payload.requestId, 'guide-write-once');
  assert.ok(h.store.has('scene:atlas-pending:season:a'));
  assert.equal(h.store.has('scene:atlas-pending:permanent:a'), false);
  write.resolve({ ok: true, receipt: 'guide-write-once' });
  await drain();
  assert.equal(h.store.has('scene:atlas-pending:season:a'), false);
  const refresh = h.calls.at(-1);
  assert.equal(refresh.action, 'atlas/status');
  refresh.reject(Error('戰況讀取暫時離線'));
  await drain();
  assert.equal(h.calls.filter(call => call.action === 'atlas/talents/action').length, 1);
  assert.equal(h.store.size, 0);
  assert.match(h.body.innerHTML, /戰況讀取暫時離線/);
  assert.doesNotMatch(h.body.innerHTML, /上一筆操作尚未確認/);
  h.view.dispose();
});

test('visible synchronization settles one confirmed active run and applies its committed scene directly', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const pending = h.client.sync();
  assert.equal(h.client.sync(), pending, 'visibility and timer share one in-flight pass');
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await drain();
  assert.deepEqual(h.net.calls.map(call => call.action), ['atlas/status', 'atlas/settle']);
  assert.deepEqual(h.net.calls[1].body, { runId: 'run-a', selectedCharacterId: 'a' });
  const committed = scene({ revision: 2, runRevision: 2, processedAt: 15000 });
  h.net.calls[1].reply({ ok: true, scene: committed, run: { progress: { catchingUp: true } } });
  await pending;
  assert.equal(h.client.getSnapshot().run.processedAt, 15000);
  assert.equal(h.net.calls.length, 2, 'even a catching-up run gets one chunk and no redundant status');
});

test('historical, mismatched and already-current runs never trigger an automatic write', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const historical = scene(); historical.run.active = false;
  const mismatched = scene(); mismatched.live.activeRunId = 'another-run';
  const finished = scene(); finished.run.status = 'completed';
  for (const value of [scene({ runId: null }), historical, mismatched, finished, scene({ processedAt: 60000 })]) {
    const pending = h.client.sync();
    h.net.calls.at(-1).reply({ ok: true, scene: value });
    await pending;
  }
  assert.ok(h.net.calls.every(call => call.action === 'atlas/status'));
});

test('window refreshes and rapid resume events do not speed up the automatic settlement cadence', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const first = h.client.sync();
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await drain();
  h.net.calls[1].reply({ ok: true, scene: scene({ revision: 2, runRevision: 2 }) });
  await first;
  for (const method of ['refresh', 'sync', 'refresh', 'sync']) {
    const pending = h.client[method]();
    h.net.calls.at(-1).reply({ ok: true, scene: scene({ revision: 2, runRevision: 2 }) });
    await pending;
  }
  assert.equal(h.net.calls.filter(call => call.action === 'atlas/settle').length, 1);
  h.time.advance(15000);
  const next = h.client.sync();
  h.net.calls.at(-1).reply({ ok: true, scene: scene({ revision: 2, runRevision: 2 }) });
  await drain();
  assert.equal(h.net.calls.at(-1).action, 'atlas/settle');
  h.net.calls.at(-1).reply({ ok: true, scene: scene({ revision: 3, runRevision: 3 }) });
  await next;
  assert.equal(h.net.calls.filter(call => call.action === 'atlas/settle').length, 2);
});

test('hidden pages cannot begin or finish discovery into an automatic settlement', async t => {
  let hidden = true;
  const h = harness({ isHidden: () => hidden });
  t.after(() => h.client.dispose());
  await h.client.sync();
  assert.equal(h.net.calls.length, 0);
  hidden = false;
  const interrupted = h.client.sync();
  hidden = true;
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await interrupted;
  assert.equal(h.net.calls.length, 1);
  hidden = false;
  const resumed = h.client.sync();
  h.net.calls[1].reply({ ok: true, scene: scene() });
  await drain();
  assert.equal(h.net.calls[2].action, 'atlas/settle');
  h.net.calls[2].reply({ ok: true, scene: scene({ revision: 2, runRevision: 2 }) });
  await resumed;
});

test('automatic settlement receipts cannot cross a character or realm epoch', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const old = outcome(h.client.sync());
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await drain();
  assert.equal(h.net.calls[1].action, 'atlas/settle');
  h.client.setContext({ characterId: 'b', realmId: 'season' });
  assert.equal(h.net.calls[1].options.signal.aborted, true);
  const current = h.client.sync();
  h.net.calls[2].reply({ ok: true, scene: scene({ characterId: 'b', realmId: 'season', runId: 'run-b' }) });
  await drain();
  h.net.calls[1].reply({ ok: true, scene: scene({ revision: 99, runRevision: 99 }) });
  assert.equal((await old).error.code, 'context_changed');
  assert.equal(h.client.sync(), current, 'old finally cannot clear the new context flight');
  assert.equal(h.net.calls[3].body.runId, 'run-b');
  assert.equal(h.net.calls[3].body.selectedCharacterId, 'b');
  assert.equal(h.net.calls[3].options.headers['X-Realm-Id'], 'season');
  h.net.calls[3].reply({ ok: true, scene: scene({ characterId: 'b', realmId: 'season', runId: 'run-b', revision: 2, runRevision: 2 }) });
  await current;
  assert.equal(h.client.getSnapshot().characterId, 'b');
  assert.ok(!h.snapshots.some(value => value?.live.revision === 99));
});

test('automatic discovery waits for manual writes and never replays an unknown manual operation', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const manual = outcome(h.client.request('atlas/start', { requestId: 'manual-start-1' }));
  const pending = h.client.sync();
  h.net.calls[1].reply({ ok: true, scene: scene() });
  await pending;
  assert.deepEqual(h.net.calls.map(call => call.action), ['atlas/start', 'atlas/status']);
  h.net.calls[0].fail();
  assert.equal((await manual).error.uncertain, true);
  h.time.advance(15000);
  const recovered = h.client.sync();
  h.net.calls[2].reply({ ok: true, scene: scene({ runId: null, revision: 2 }) });
  await recovered;
  assert.deepEqual(h.net.calls.map(call => call.action), ['atlas/start', 'atlas/status', 'atlas/status']);
});

test('an unknown automatic settlement waits for fresh discovery and never retries in the same pass', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const first = outcome(h.client.sync());
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await drain();
  h.net.calls[1].fail();
  assert.equal((await first).error.uncertain, true);
  assert.equal(h.errors.length, 1);
  assert.equal(h.net.calls.length, 2);
  h.time.advance(15000);
  const next = h.client.sync();
  assert.equal(h.net.calls[2].action, 'atlas/status');
  const completed = scene({ revision: 2, runRevision: 2 });
  completed.run.status = 'completed'; completed.run.active = false; completed.live.activeRunId = null;
  h.net.calls[2].reply({ ok: true, scene: completed });
  await next;
  assert.equal(h.net.calls.length, 3, 'server completion discovered after the lost receipt is not settled again');
  assert.equal(h.client.getError(), '');
});

test('an invalid settlement scene falls back to a read without replaying the acknowledged write', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const pending = h.client.sync();
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await drain();
  h.net.calls[1].reply({ ok: true, scene: scene({ characterId: 'wrong-character' }) });
  await drain();
  assert.equal(h.net.calls[2].action, 'atlas/status');
  h.net.calls[2].reply({ ok: true, scene: scene({ revision: 2, runRevision: 2 }) });
  await pending;
  assert.equal(h.client.getSnapshot().characterId, 'a');
  assert.equal(h.net.calls.filter(call => call.action === 'atlas/settle').length, 1);
});

test('the visible page timer discovers and advances a run every fifteen seconds', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  h.client.start();
  assert.equal([...h.time.intervals.values()][0].ms, 15000);
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await drain();
  h.net.calls[1].reply({ ok: true, scene: scene({ revision: 2, runRevision: 2 }) });
  await drain();
  h.time.tick();
  h.net.calls[2].reply({ ok: true, scene: scene({ revision: 2, runRevision: 2 }) });
  await drain();
  h.net.calls[3].reply({ ok: true, scene: scene({ revision: 3, runRevision: 3 }) });
  await drain();
  assert.deepEqual(h.net.calls.map(call => call.action), ['atlas/status', 'atlas/settle', 'atlas/status', 'atlas/settle']);
  h.client.dispose();
  h.time.tick();
  assert.equal(h.net.calls.length, 4);
});

test('an automatic settlement timeout is visible and is not immediately retried', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  const pending = outcome(h.client.sync());
  h.net.calls[0].reply({ ok: true, scene: scene() });
  await drain();
  for (const { fn } of [...h.time.deadlines.values()]) fn();
  assert.equal(h.net.calls[1].options.signal.aborted, true);
  h.net.calls[1].fail(Error('aborted'));
  const result = await pending;
  assert.equal(result.error.code, 'request_aborted');
  assert.equal(result.error.uncertain, true);
  assert.equal(h.errors.length, 1);
  assert.equal(h.client.getError(), result.error.message);
  assert.equal(h.net.calls.length, 2);
});

test('equipment recovery discovery and previews are readonly while actions retain uncertain outcomes', async t => {
  const h = harness();
  t.after(() => h.client.dispose());
  for (const action of ['equipment-recovery', 'equipment-recovery/preview', 'equipment-recovery/action']) {
    const pending = outcome(h.client.request(action, { itemIds: ['item-a'] }));
    h.net.calls.at(-1).fail();
    const result = await pending;
    assert.equal(result.error.uncertain, action.endsWith('/action'));
  }
  assert.deepEqual(h.net.calls.map(call => call.action), ['equipment-recovery', 'equipment-recovery/preview', 'equipment-recovery/action']);
});

test('skill-career pure reads do not create a mutation barrier or a follow-up scene request',async t=>{
 const h=harness();t.after(()=>h.client.dispose());
 const refresh=h.client.refresh();
 const read=h.client.request('skill-career');
 assert.deepEqual(h.net.calls.map(c=>c.action),['atlas/status','skill-career']);
 h.net.calls[1].reply({ok:true,characterId:'a',career:{current:{tier:1}}});
 assert.equal((await read).characterId,'a');
 h.net.calls[0].reply({ok:true,scene:scene()});
 assert.equal((await refresh).characterId,'a');
 assert.equal(h.net.calls.length,2);
 assert.equal(h.client.getSnapshot().characterId,'a');
});

test('an offline skill-career read is not an uncertain write and is never retried automatically',async t=>{
 const h=harness();t.after(()=>h.client.dispose());
 const read=outcome(h.client.request('skill-career'));
 h.net.calls[0].fail();
 const result=await read;
 assert.equal(result.ok,false);assert.equal(result.error.uncertain,false);
 assert.equal(result.error.code,'connection_failed');assert.equal(h.net.calls.length,1);
});
