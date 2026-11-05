import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './d1-shim.js';
import { CATALOG } from './realm-test-helpers.js';
import { initializeRealmIdentity, resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';
import * as Player from '../src/services/player.js';
import * as Fate from '../src/services/fate.js';
import * as PrivateScene from '../src/services/fate-private-scene.js';
import * as PrivateScoped from '../src/services/fate-private-scoped.js';
import {
  FATE_PRIVATE_QA_STARTED_AT as T, seedFatePrivateQa, createFatePrivateQaController,
  qaPrivatePublicIntent, qaPrivatePublicSignature, qaPrivateReceipt, qaPrivateResponse,
} from '../tools/fate-private-qa-fixture.mjs';

async function fixture(t) {
  const env = { DB: freshDb(), DB_SEASON: freshDb(), REALM_CATALOG_JSON: JSON.stringify(CATALOG),
    CURRENT_SEASON_ID: 'season_2026_01', ENVIRONMENT: 'development', ALLOW_DEV_AUTH: 'true', ALLOW_DEBUG_TIME: 'true' };
  t.after(() => { env.DB.sqlite.close(); env.DB_SEASON.sqlite.close(); });
  await initializeRealmIdentity(env, 'permanent', { now: T });
  await initializeRealmIdentity(env, 'season_2026_01', { now: T });
  const permanent = scopeEnvForRealm(env, await resolveRealm(env, 'permanent'));
  for (const [i, baseClass] of ['sword', 'archer', 'mage', 'thief'].entries())
    await Player.createCharacter(permanent, { tgId: '90101', charSlot: i + 1, name: '私人驗收角色' + i, baseClass, gender: 'f' }, T);
  const seed = await seedFatePrivateQa(env, permanent, T);
  return { env, permanent, seed, controller: createFatePrivateQaController(env, permanent, seed, T) };
}
const expected = () => ({ generation: 0, profile: { saved: false, rev: 0, updatedAt: null },
  daily: { day: '2026-11-05', materialized: false, rev: 0, createdAt: null } });
const intent = () => ({ realmId: 'permanent', selectedCharacterId: 'c90101_3', requestId: 'f2qa_save_01', kind: 'profile-save',
  intentNonce: 'a'.repeat(32), expected: expected(), consent: true });
function receipt(body = intent()) {
  const { realmId, selectedCharacterId, requestId, ...publicFields } = body;
  return { version: 1, kind: body.kind, requestId, requestKey: 'private:app:' + requestId,
    intentNonce: body.intentNonce, signature: JSON.stringify(publicFields), scope: { realmId, accountId: '90101', characterId: selectedCharacterId },
    createdAt: T, outcome: 'committed', result: { saved: true, coverage: 'inspiration' }, costs: {},
    authority: { family: 'life-operations', requestKey: 'private:app:' + requestId, proofId: 'b'.repeat(32) } };
}

test('private QA starts with synthetic actors/resources and no Fate or battle outcomes', async t => {
  const f = await fixture(t), s = await f.controller.snapshot();
  assert.equal(s.noSeededPrivateOrBattleOutcomes, true);
  assert.equal(s.realNotificationsSent, false); assert.equal(s.noDispatcher, true);
  assert.equal(new Set(s.partyRoster.map(a => a.accountId)).size, 3);
  for (const realm of ['permanent', 'season']) {
    assert(Object.values(s.initialOutcomeCounts[realm]).every(n => n === 0));
    assert(s.databases[realm].tableNames.length >= 90);
    assert.equal(s.databases[realm].digestAlgorithm, 'HMAC-SHA-256');
    assert.equal(s.databases[realm].restorableBackup, false);
    assert.deepEqual(s[realm].profiles, []); assert.deepEqual(s[realm].daily, []);
  }
  assert.deepEqual(s.privacy.forbiddenCopies, []);
});

test('private QA snapshots are SELECT-only and use non-exported per-controller HMAC keys', async t => {
  const f = await fixture(t), first = await f.controller.snapshot(), second = await f.controller.snapshot();
  assert.deepEqual(second.databases, first.databases);
  assert.deepEqual(second.privacy, first.privacy);
  const other = createFatePrivateQaController(f.env, f.permanent, f.seed, T), alternate = await other.snapshot();
  assert.notEqual(alternate.privacy.digestId, first.privacy.digestId);
  assert.notEqual(alternate.databases.permanent.sha256, first.databases.permanent.sha256);
  assert.deepEqual(alternate.databases.permanent.counts, first.databases.permanent.counts);
  assert.equal(alternate.databases.permanent.totalChanges, first.databases.permanent.totalChanges);
  assert.equal(first.privacy.secretPersisted, false);
  assert(!Object.keys(first).some(k => /key|secret/i.test(k)), 'No digest secret is an exported field');
});

test('private QA snapshot never exports birth, charts, private fingerprints or derived notes', async t => {
  const f = await fixture(t), id = f.seed.primary.characterId, birth = { date: '2004-02-29' };
  await Fate.saveProfile(f.permanent, id, { requestId: 'qa-private-profile', consent: true, birth }, T);
  await Fate.daily(f.permanent, id, T);
  const row = f.env.DB.sqlite.prepare('SELECT birth_json,chart_json FROM rpg_fate_profiles').get();
  const notes = f.env.DB.sqlite.prepare('SELECT notes_json FROM rpg_fate_daily').get().notes_json;
  const s = await f.controller.snapshot(), text = JSON.stringify(s);
  for (const forbidden of [birth.date, row.birth_json, row.chart_json, notes, 'payload_hash', 'birth_json', 'chart_json', 'notes_json']) {
    assert(!text.includes(forbidden), 'Private observation allowlist must withhold source data');
  }
  assert.equal(s.permanent.profiles[0].saved, true);
  assert.equal(s.permanent.daily[0].noteCount, 3);
  assert.equal(s.permanent.daily[0].unlocked, 0);
  assert.deepEqual(s.privacy.forbiddenCopies, []);
});

test('public private-intent recorder drops exact raw fields while preserving false, zero and null metadata', () => {
  const body = { ...intent(), birth: { date: '2004-02-29', time: '00:00', lat: 0, lon: 0, sex: null } };
  const clean = qaPrivatePublicIntent(body), text = JSON.stringify(clean);
  assert(!text.includes('2004-02-29')); assert(!text.includes('birth')); assert(!text.includes('00:00'));
  assert.equal(clean.expected.generation, 0); assert.equal(clean.expected.profile.saved, false);
  assert.equal(clean.expected.profile.updatedAt, null); assert.equal(clean.expected.daily.materialized, false);
});

test('private receipt recorder validates public signature and refuses unexpected private copies', () => {
  const good = receipt();
  assert.deepEqual(qaPrivateReceipt(good), good);
  assert.throws(() => qaPrivateReceipt({ ...good, birthDate: '2004-02-29' }), { code: 'QA_RECEIPT_SHAPE' });
  assert.throws(() => qaPrivateReceipt({ ...good, result: { ...good.result, birth: {} } }), { code: 'QA_SAVE_RESULT' });
  assert.throws(() => qaPrivatePublicSignature(JSON.stringify({ ...JSON.parse(good.signature), birthDate: '2004-02-29' })), { code: 'QA_PRIVATE_SIGNATURE_FIELDS' });
});

test('private response recorder hides revealed profile and unlocked note bodies, including error text', () => {
  const domain = { version: 1, ...expected(), token: 'c'.repeat(64) }, control = { realmPhase: 'ACTIVE', writable: true };
  const profile = { saved: true, rev: 1, coverage: 'inspiration', updatedAt: T, birth: { date: '2004-02-29' } };
  const cleanProfile = qaPrivateResponse({ ok: true, privateProfile: { profile, domain, control } });
  assert(!JSON.stringify(cleanProfile).includes('2004-02-29')); assert.equal(cleanProfile.privateProfile.profile.revealed, true);
  const privateText = 'Synthetic long private reminder that must remain in memory';
  const cleanScene = qaPrivateResponse({ ok: true, privateFate: { day: '2026-11-05', profile,
    daily: { day: '2026-11-05', materialized: true, rev: 1, createdAt: T, profileRevision: 1, unlocked: 1,
      unlocks: [{ id: 'boss', at: T }], notes: [{ topic: 'health', locked: false, title: privateText, scene: privateText, action: privateText },
        { topic: 'work', locked: true }, { topic: 'love', locked: true }] },
    evidence: { available: [{ id: 'boss', at: T }], pending: [] }, domain, control } });
  assert(!JSON.stringify(cleanScene).includes(privateText));
  assert.deepEqual(cleanScene.privateFate.daily.notes, [{ topic: 'health', locked: false }, { topic: 'work', locked: true }, { topic: 'love', locked: true }]);
  const failed = qaPrivateResponse({ ok: false, error: 'private_failed', message: privateText + '2004-02-29' });
  assert.deepEqual(failed, { ok: false, errorCode: 'private_failed' });
});

test('private QA clock is explicit, forward-only, receipt-idempotent and preserves both databases', async t => {
  const f = await fixture(t), before = await f.controller.snapshot();
  const body = { requestId: 'qa-clock-original', op: 'clock', at: T + 60000, expectedNow: T };
  const first = await f.controller.advance(body), second = await f.controller.advance(body), after = await f.controller.snapshot();
  assert.deepEqual(first, second); assert.deepEqual(after.databases, before.databases); assert.equal(after.commands.length, 1);
  assert.equal(after.qaClock.now, T + 60000);
  await assert.rejects(f.controller.advance({ ...body, at: T + 120000 }), { code: 'QA_COMMAND_CHANGED' });
  await assert.rejects(f.controller.advance({ requestId: 'qa-clock-backwards', op: 'clock', at: T }), { code: 'QA_FORWARD_CLOCK_REQUIRED' });
  assert.equal((await f.controller.snapshot()).commands.at(-1).status, 'failed');
});

test('private QA failed commands are retained and cannot replay or accept a private payload', async t => {
  const f = await fixture(t);
  const body = { requestId: 'qa-bad-party-original', op: 'party-start', partyId: 'missing', characterId: f.seed.primary.characterId };
  await assert.rejects(f.controller.advance(body), { code: 'QA_OWNED_PARTY_REQUIRED' });
  await assert.rejects(f.controller.advance(body), { code: 'QA_COMMAND_FAILED_REPLAY_FORBIDDEN' });
  await assert.rejects(f.controller.advance({ requestId: 'qa-private-command', op: 'clock', at: T, birth: { date: '2004-02-29' } }), { code: 'QA_COMMAND_SHAPE' });
  const s = await f.controller.snapshot();
  assert.equal(s.commands.length, 1); assert.equal(s.commands[0].status, 'failed');
  assert(!JSON.stringify(s).includes('2004-02-29'));
});

test('private QA refuses non-development and persistent database contexts', async t => {
  const f = await fixture(t);
  assert.throws(() => createFatePrivateQaController({ ...f.env, ENVIRONMENT: 'production' }, f.permanent, f.seed, T), { code: 'QA_REQUIRES_DEVELOPMENT' });
  const fake = { sqlite: { prepare() { return { all: () => [{ file: 'persistent.sqlite' }] }; } } };
  assert.throws(() => createFatePrivateQaController({ ...f.env, DB: fake }, f.permanent, f.seed, T), { code: 'QA_REQUIRES_MEMORY_DATABASE' });
});

test('private QA generates boss evidence through original spawn/attack/settle rather than seeding a kill', async t => {
  const f = await fixture(t), c = f.controller;
  const spawn = await c.advance({ requestId: 'qa-real-boss-spawn', op: 'boss-spawn', tier: 1 }), bossId = spawn.result.bossId;
  for (let i = 0; i < 12; i++) {
    const hit = await c.advance({ requestId: 'qa-real-boss-hit-' + i, op: 'boss-attack', bossId, characterId: f.seed.primary.characterId });
    if (hit.result.killed) break;
    await c.advance({ requestId: 'qa-real-boss-window-' + i, op: 'boss-next-window', bossId });
  }
  const s = await c.snapshot(), boss = s.permanent.bosses.find(row => row.id === bossId);
  assert.equal(boss.status, 'killed');
  assert(s.permanent.attacks.some(row => row.tg_id === f.seed.primary.characterId && row.damage > 0));
  assert(s.evidence[f.seed.primary.accountId].some(row => row.id === 'boss'));
  assert.equal(s.permanent.daily.length, 0, 'A real battle must not materialize notes');
  assert(s.permanent.outbox.length > 0, 'Original battle queue is observable without dispatch');
  assert.equal(s.noDispatcher, true);
});

test('private QA generates three-account dungeon and five-floor tower evidence with original manual actions', async t => {
  const f = await fixture(t), c = f.controller;
  let serial = 0;
  const command = (op, rest = {}) => c.advance({ requestId: 'qa-party-proof-' + (++serial), op, ...rest });
  for (const kind of ['dungeon', 'tower']) {
    const created = await command('party-create', { kind, characterId: f.seed.primary.characterId }), partyId = created.result.partyId;
    for (const actor of f.seed.partyRoster.slice(1)) await command('party-join', { partyId, characterId: actor.characterId });
    for (const actor of f.seed.partyRoster) await command('party-ready', { partyId, characterId: actor.characterId });
    await command('party-start', { partyId, characterId: f.seed.primary.characterId });
    for (let turn = 0; turn < 80; turn++) {
      const s = await c.snapshot(), party = s.permanent.parties.find(row => row.id === partyId);
      if (kind === 'dungeon' && party.status === 'won') break;
      if (kind === 'tower' && party.journalFloors.length >= 5) break;
      assert.equal(party.status, 'combat', 'Original battle must stay playable until its acceptance boundary');
      for (const actor of f.seed.partyRoster) await command('party-submit', { partyId, characterId: actor.characterId, round: party.round });
      await command('party-deadline', { partyId });
      await command('party-sweep', { partyId });
    }
    const s = await c.snapshot(), party = s.permanent.parties.find(row => row.id === partyId);
    assert.equal(new Set(s.permanent.members.filter(row => row.partyId === partyId).map(row => row.accountId)).size, 3);
    assert(party.actors.every(actor => actor.manualActions > 0));
    assert(s.evidence[f.seed.primary.accountId].some(e => e.id === kind));
    if (kind === 'dungeon') assert.equal(party.status, 'won');
    else { assert(party.journalFloors.length >= 5); await command('party-end', { partyId, characterId: f.seed.primary.characterId }); }
  }
  const final = await c.snapshot();
  assert.equal(final.permanent.daily.length, 0);
  assert.equal(final.noDispatcher, true);
});

async function originalPrivateHistoryScene(f, requestId) {
  const actor = f.seed.primary.characterId, scope = { realmId: 'permanent', selectedCharacterId: actor };
  const initial = await PrivateScene.view(f.permanent, actor, scope, T, 'app');
  const domain = initial.privateFate.domain;
  const action = { ...intent(), ...scope, requestId,
    expected: { generation: domain.generation, profile: domain.profile, daily: domain.daily },
    birth: { date: '2004-02-29' } };
  const committed = await PrivateScoped.run(f.permanent, actor, action, T, 'app');
  const scene = { ok: true, ...await PrivateScene.view(f.permanent, actor, scope, T, 'app') };
  return { actor, scope, action, committed, scene };
}

test('private QA recorder accepts actual metadata history and corrupt markers without treating either as a receipt', async t => {
  const f = await fixture(t), h = await originalPrivateHistoryScene(f, 'qa-history-real-save');
  const clean = qaPrivateResponse(h.scene), history = clean.privateFate.history.receipts;
  assert.equal(history.length, 1);
  assert.equal(history[0].requestId, h.action.requestId);
  assert.equal(history[0].requestKey, h.committed.receipt.requestKey);
  assert.equal(history[0].signature, h.committed.signature);
  assert.deepEqual(history[0].intent, JSON.parse(h.committed.signature));
  assert.equal(history[0].outcome, 'committed');
  for (const key of ['result', 'costs', 'authority', 'birth', 'payloadHash']) assert.equal(Object.hasOwn(history[0], key), false);
  assert(!JSON.stringify(clean).includes(h.action.birth.date), 'History observation must withhold the original private input');
  assert.throws(() => qaPrivateReceipt(h.scene.privateFate.history.receipts[0]),
    'A metadata history entry is not a verified complete receipt');
  f.env.DB.sqlite.prepare('UPDATE rpg_ledger SET note=? WHERE event_id=?')
    .run('{malformed', 'fate-private-receipt:' + h.actor + ':' + h.committed.receipt.requestKey);
  const corruptScene = { ok: true, ...await PrivateScene.view(f.permanent, h.actor, h.scope, T, 'app') };
  assert.deepEqual(qaPrivateResponse(corruptScene).privateFate.history.receipts, [{ createdAt: T, corrupt: true }]);
});

test('private QA history recorder rejects private copies and mismatched public bindings', async t => {
  const f = await fixture(t), h = await originalPrivateHistoryScene(f, 'qa-history-strict-save');
  const row = h.scene.privateFate.history.receipts[0];
  const record = value => qaPrivateResponse({ ...h.scene,
    privateFate: { ...h.scene.privateFate, history: { receipts: [value] } } });
  const invalid = [
    { label: 'extra private field', value: { ...row, birth: h.action.birth } },
    { label: 'extra result must not become history evidence', value: { ...row, result: h.committed.result } },
    { label: 'private value hidden in intent', value: { ...row, intent: { ...row.intent, birthDate: h.action.birth.date } } },
    { label: 'missing account scope', value: { ...row, scope: { realmId: row.scope.realmId, characterId: row.scope.characterId } } },
    { label: 'different request binding', value: { ...row, requestId: 'qa-history-other-save' } },
    { label: 'different nonce binding', value: { ...row, intentNonce: 'c'.repeat(32) } },
    { label: 'different signature binding', value: { ...row,
      signature: JSON.stringify({ ...row.intent, intentNonce: 'd'.repeat(32) }) } },
    { label: 'unknown outcome', value: { ...row, outcome: 'unknown' } },
    { label: 'extra corrupt marker payload', value: { createdAt: T, corrupt: true, note: 'withheld' } },
    { label: 'invalid corrupt marker time', value: { createdAt: String(T), corrupt: true } },
  ];
  for (const item of invalid) assert.throws(() => record(item.value), item.label);
  assert.deepEqual(record({ createdAt: T, corrupt: true }).privateFate.history.receipts, [{ createdAt: T, corrupt: true }]);
});
