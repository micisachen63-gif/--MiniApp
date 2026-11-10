import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fixture, NOW, OWNER, changes, snapshot, completeOriginal } from './fate-scene-fixture.js';
import * as Scene from '../src/services/fate-scene.js';
import * as Scoped from '../src/services/fate-scoped.js';
import * as Receipt from '../src/services/fate-receipt.js';
import * as Fate from '../src/services/fate.js';
import * as Atlas from '../src/services/atlas.js';
import { advanceLife, addActive, LIFE_MS } from '../public/fate/life.js';

const plain = value => JSON.parse(JSON.stringify(value));
const endpoint = 'http://127.0.0.1:9792/app/api/';
const sources = ['scene-live-session.js', 'scene-fate-ui.js'].map(name =>
  fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8'));

// Exercise the real client and shared session wire contract against real SQLite.
// Transport asserts fields as sent; it never supplies missing scope or payload.
async function bridge(t) {
  const f = await fixture(t), calls = [], committed = [], stored = new Map();
  const h = { f, calls, committed, stored, now: NOW, sequence: 0,
    loseNextWrite: false, dropNextWriteBeforeCommit: false, holdNextScene: false };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [h.now])); }
    static now() { return h.now; }
  }
  const sandbox = { AbortController, URL, URLSearchParams, console, Date: Clock,
    crypto: globalThis.crypto, setTimeout, clearTimeout, queueMicrotask };
  vm.createContext(sandbox);
  for (const source of sources) vm.runInContext(source, sandbox);
  const session = sandbox.RpgSceneSession.create({
    endpoint, accountId: OWNER, realmId: 'permanent', characterId: f.tg, now: () => h.now,
    fetch: async (url, options) => {
      const action = url.slice(endpoint.length), body = JSON.parse(options.body);
      const call = { action, body, headers: plain(options.headers), at: h.now };
      calls.push(call);
      assert.equal(options.method, 'POST');
      assert.equal(call.headers['X-Dev-Tg-Id'], OWNER);
      assert.equal(call.headers['X-Realm-Id'], 'permanent');
      assert.equal(body.selectedCharacterId, f.tg);
      if (action.startsWith('fate/')) assert.equal(body.realmId, 'permanent');
      if (action === 'fate/action-scoped' && h.dropNextWriteBeforeCommit) {
        h.dropNextWriteBeforeCommit = false;
        throw Error('Original request deliberately never reached the service');
      }
      let value;
      try {
        if (action === 'fate/scene') value = await Scene.view(f.env, body.selectedCharacterId, body, call.at, 'app');
        else if (action === 'fate/receipt') value = await Receipt.view(f.env, body.selectedCharacterId, body, call.at, 'app');
        else if (action === 'fate/action-scoped') value = await Scoped.run(f.env, body.selectedCharacterId, body, call.at, 'app');
        else if (action === 'atlas/status') value = await Atlas.status(f.env, body.selectedCharacterId, call.at);
        else throw Error('Unexpected wire action ' + action);
      } catch (error) {
        return { ok: false, status: error.status || 400,
          json: async () => ({ ok: false, error: error.code || 'bridge_error', message: error.message }) };
      }
      call.result = plain(value);
      if (action === 'fate/action-scoped') {
        committed.push(call);
        if (h.loseNextWrite) { h.loseNextWrite = false; throw Error('Original committed response deliberately lost'); }
      }
      if (action === 'fate/scene' && h.holdNextScene) {
        h.holdNextScene = false;
        await new Promise(resolve => { h.releaseScene = resolve; h.sceneHeld?.(); });
      }
      return { ok: true, status: 200, json: async () => plain(value) };
    }
  });
  const clients = [];
  h.remount = () => {
    h.client?.dispose();
    const client = sandbox.RpgSceneFate.createClient({
      getContext: () => session.getContext(), current: () => true,
      request: (...args) => session.request(...args), now: () => h.now,
      newRequestId: () => 'bridge-' + String(++h.sequence).padStart(12, '0'),
      storage: { getItem: key => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) }
    });
    clients.push(client); h.client = client; return client;
  };
  h.session = session; h.remount();
  t.after(() => { for (const client of clients) client.dispose(); session.dispose(); });
  return h;
}
async function submit(h, prepare, kind) {
  const c = h.client;
  assert.equal(prepare(), true, c.state.error || c.state.notice);
  assert.equal(await c.submit(), true, c.state.error || c.state.notice);
  const call = h.committed.at(-1);
  assert.equal(call.body.kind, kind);
  assert.equal(call.result.kind, kind);
  assert.equal(call.result.requestId, call.body.requestId);
  assert.equal(call.result.signature, c.state.lastResult.signature);
  assert.equal(c.pending(), null);
  return call;
}

test('F1 actual client/session preserves false and recovers one original random start after lost response and remount', async t => {
  const h = await bridge(t), f = h.f;
  let c = h.client;
  const before = snapshot(f.db), n = changes(f.db);
  assert.equal(await c.refresh(), true, c.state.error);
  assert.deepEqual(snapshot(f.db), before); assert.equal(changes(f.db), n);
  assert.equal(c.state.data.fate.state.startedToday, 0);
  assert.equal(c.prepareStart('TW', false), true, c.state.error);
  h.loseNextWrite = true;
  assert.equal(await c.submit(), false);
  const pending = plain(c.pending()), original = h.committed.at(-1);
  assert.ok(pending.id);
  assert.deepEqual(original.body, pending.wireBody);
  assert.equal(original.body.showSign, false);
  assert.equal(original.body.socialInvite, false);
  assert.equal(original.body.mode, 'random');
  assert.equal(h.committed.length, 1);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_lives').n, 1);
  c = h.remount();
  assert.equal(c.pending().id, pending.id);
  assert.equal(await c.refresh(), true, c.state.error);
  const committedState = snapshot(f.db), committedChanges = changes(f.db);
  assert.equal(await c.checkPending(pending.id), true, c.state.error);
  assert.equal(c.state.receipt.found, true);
  assert.deepEqual(plain(c.state.receipt.result), original.result.result);
  assert.deepEqual(snapshot(f.db), committedState); assert.equal(changes(f.db), committedChanges);
  assert.equal(h.committed.length, 1);
  assert.equal(c.acknowledge(pending.id), true, c.state.error);
  assert.equal(c.pending(), null);
  assert.equal(c.state.data.fate.state.startedToday, 1);
  assert.equal(c.state.data.fate.state.active.id, original.result.result.lifeId);
});

test('F1 actual choice wire preserves 0 and 1; a late pre-completion scene cannot restore an old life at unchanged player revision', async t => {
  const h = await bridge(t), f = h.f, c = h.client;
  assert.equal(await c.refresh(), true, c.state.error);
  const started = await submit(h, () => c.prepareStart('TW', true), 'start');
  const id = started.result.result.lifeId;
  for (const answer of [0, 1]) {
    const row = f.one('SELECT * FROM rpg_fate_lives WHERE id=?', id), draft = JSON.parse(row.state_json);
    let projected = advanceLife(draft, h.now);
    for (let step = 0; !projected.available && !projected.completed && step < 64; step += 1) {
      assert.ok(Number.isSafeInteger(projected.nextAt) && projected.nextAt > h.now,
        'original engine must provide a future nextAt while waiting for a choice');
      h.now = projected.nextAt;
      projected = advanceLife(draft, h.now);
    }
    assert.equal(projected.available, true, 'original random life must expose a manual choice');
    const index = projected.index;
    assert.equal(await c.refresh(), true, c.state.error);
    const choice = await submit(h, () => c.prepareChoice(index, answer), 'choice');
    assert.equal(choice.body.answer, answer); assert.equal(choice.body.index, index);
    assert.equal(choice.body.lifeId, id);
  }
  const oldRevision = f.one('SELECT rev FROM rpg_characters WHERE tg_id=?', f.tg).rev;
  const oldLifeRevision = c.state.data.fate.state.active.rev;
  const held = new Promise(resolve => { h.sceneHeld = resolve; });
  h.holdNextScene = true;
  const late = c.refresh(); await held;
  const row = f.one('SELECT started_at FROM rpg_fate_lives WHERE id=?', id);
  h.now = addActive(row.started_at, LIFE_MS);
  await Fate.sweep(f.env, h.now);
  assert.equal(f.one('SELECT rev FROM rpg_characters WHERE tg_id=?', f.tg).rev, oldRevision);
  assert.equal(await c.refresh(), true, c.state.error);
  assert.equal(c.state.data.fate.state.active, null);
  assert.equal(c.state.data.fate.state.completed, 1);
  const newToken = c.state.data.fate.domain.token;
  h.releaseScene(); assert.equal(await late, false);
  assert.equal(c.state.data.fate.state.active, null);
  assert.equal(c.state.data.fate.state.completed, 1);
  assert.equal(c.state.data.fate.domain.token, newToken);
  assert.ok(oldLifeRevision >= 2);
  const originalStart = await h.session.request('fate/receipt', started.body);
  assert.equal(originalStart.found, true);
  assert.deepEqual(plain(originalStart.result), started.result.result);
});

test('F1 real four-life claim and exact-ID open recover the original award after remount without a second consume or RNG draw', async t => {
  const h = await bridge(t), f = h.f;
  await completeOriginal(f, 4);
  h.now = NOW + 4 * LIFE_MS;
  let c = h.client;
  assert.equal(await c.refresh(), true, c.state.error);
  assert.equal(c.state.data.fate.state.completed, 4);
  assert.equal(c.state.data.fate.state.startedToday, 4);
  const claimed = await submit(h, () => c.prepareClaim(), 'gift-claim');
  assert.deepEqual(claimed.body.expectedMilestones, [4]);
  const giftId = claimed.result.result.giftIds[0];
  assert.equal(f.qty('fate_cycle_gift'), 1);
  assert.equal(c.prepareOpen(giftId), true, c.state.error);
  h.loseNextWrite = true;
  assert.equal(await c.submit(), false);
  const pending = plain(c.pending()), opened = h.committed.at(-1);
  assert.equal(opened.body.giftId, giftId);
  assert.deepEqual(opened.body, pending.wireBody);
  assert.equal(f.qty('fate_cycle_gift'), 0);
  const gift = f.one('SELECT status,rewards_json FROM rpg_fate_gifts WHERE id=?', giftId);
  assert.equal(gift.status, 'opened');
  assert.deepEqual(JSON.parse(gift.rewards_json), opened.result.result.items);
  const after = snapshot(f.db), n = changes(f.db), writes = h.committed.length;
  c = h.remount(); assert.equal(c.pending().id, pending.id);
  assert.equal(await c.checkPending(pending.id), true, c.state.error);
  assert.equal(c.state.receipt.found, true);
  assert.deepEqual(plain(c.state.receipt.result), opened.result.result);
  assert.deepEqual(snapshot(f.db), after); assert.equal(changes(f.db), n);
  assert.equal(h.committed.length, writes);
  assert.equal(c.acknowledge(pending.id), true, c.state.error);
  assert.equal(c.pending(), null);
  const oldClaim = await h.session.request('fate/receipt', claimed.body);
  assert.equal(oldClaim.found, true);
  assert.deepEqual(plain(oldClaim.result), claimed.result.result);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_ledger WHERE event_id=?', 'fate-gift:consume:' + giftId).n, 1);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_gift_operations WHERE account_id=?', OWNER).n, 2);
});

test('F1 never-sent memorial can be explicitly recovered with identical durable wire intent and cannot add a completed life', async t => {
  const h = await bridge(t), f = h.f, c = h.client;
  await completeOriginal(f, 1); h.now = NOW + LIFE_MS;
  assert.equal(await c.refresh(), true, c.state.error);
  const code = c.state.data.fate.history.entries[0].code;
  assert.equal(c.prepareKeep(code), true, c.state.error);
  h.dropNextWriteBeforeCommit = true;
  assert.equal(await c.submit(), false);
  const pending = plain(c.pending());
  assert.equal(h.committed.length, 0);
  const before = snapshot(f.db), n = changes(f.db);
  assert.equal(await c.checkPending(pending.id), true, c.state.error);
  assert.equal(c.state.receipt.found, false);
  assert.equal(c.state.receipt.recoveryAllowed, true);
  assert.deepEqual(snapshot(f.db), before); assert.equal(changes(f.db), n);
  assert.equal(c.prepareRecovery(pending.id), true, c.state.error);
  assert.equal(await c.submit(), true, c.state.error);
  const kept = h.committed.at(-1);
  assert.deepEqual(kept.body, pending.wireBody);
  assert.equal(kept.result.result.saved, true);
  assert.equal(kept.result.result.countsAsLife, false);
  assert.equal(c.pending(), null);
  assert.equal(c.state.data.fate.state.completed, 1);
  assert.equal(f.one('SELECT COUNT(*) n FROM rpg_fate_memorials WHERE char_id=?', f.tg).n, 1);
});
