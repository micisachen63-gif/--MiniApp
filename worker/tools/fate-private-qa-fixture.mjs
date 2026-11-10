// Opt-in Fate F2 QA: synthetic initial actors only, original service mutations.
// Every durable observation is allowlisted. Private DB digests use a process-only
// random HMAC key; neither that key nor private rows are a restorable backup.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { seedPartyQa } from './party-qa-fixture.mjs';
import * as Player from '../src/services/player.js';
import * as Fate from '../src/services/fate.js';
import * as Boss from '../src/services/boss.js';
import * as Party from '../src/services/party.js';
import { fateEvidence } from '../src/services/fate-quests.js';
import { LIFE_MS, CHOICE_MS, advanceLife } from '../public/fate/life.js';
import { BOSS } from '../src/game/constants.js';
import { attackWindow } from '../src/game/boss.js';
import { taipeiDay, taipeiAt } from '../src/game/time.js';
import { resolveRealm, scopeEnvForRealm, transitionRealmPhase } from '../src/realm/index.js';

export const FATE_PRIVATE_QA_STARTED_AT = Date.parse('2026-11-05T06:00:00+08:00');
const KINDS = new Set(['profile-save', 'profile-delete', 'birthday-start', 'daily-sync']);
const COVERAGE = new Set(['inspiration', 'three-traditions']);
const parse = (text, fallback = null) => { try { return JSON.parse(text); } catch { return fallback; } };
const number = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(value);
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const error = code => Object.assign(new Error(code), { code });
const requireValue = (test, code) => { if (!test) throw error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const publicHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(sorted) : Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;

function object(value, code) { requireValue(value && typeof value === 'object' && !Array.isArray(value), code); return value; }
function exactKeys(value, keys, code) { object(value, code); requireValue(Object.keys(value).every(key => keys.includes(key)), code); }
export function qaPrivateExpected(value) {
  exactKeys(value, ['generation', 'profile', 'daily'], 'QA_EXPECTED_SHAPE');
  const p = object(value.profile, 'QA_PROFILE_METADATA'), d = object(value.daily, 'QA_DAILY_METADATA');
  exactKeys(p, ['saved', 'rev', 'updatedAt'], 'QA_PROFILE_METADATA');
  exactKeys(d, ['day', 'materialized', 'rev', 'createdAt'], 'QA_DAILY_METADATA');
  requireValue(number(value.generation) && typeof p.saved === 'boolean' && number(p.rev) && (p.updatedAt === null || number(p.updatedAt)), 'QA_EXPECTED_PROFILE');
  requireValue(isoDay(d.day) && typeof d.materialized === 'boolean' && number(d.rev) && (d.createdAt === null || number(d.createdAt)), 'QA_EXPECTED_DAILY');
  return { generation: value.generation, profile: { saved: p.saved, rev: p.rev, updatedAt: p.updatedAt },
    daily: { day: d.day, materialized: d.materialized, rev: d.rev, createdAt: d.createdAt } };
}
function publicFields(body) {
  requireValue(KINDS.has(body.kind), 'QA_PRIVATE_KIND');
  requireValue(typeof body.intentNonce === 'string' && /^[a-f0-9]{32,64}$/.test(body.intentNonce), 'QA_PRIVATE_NONCE');
  const out = { kind: body.kind, intentNonce: body.intentNonce, expected: qaPrivateExpected(body.expected) };
  if (body.kind === 'profile-save') { requireValue(body.consent === true, 'QA_PRIVATE_CONSENT'); out.consent = true; }
  if (body.kind === 'birthday-start') {
    requireValue(['temporary', 'saved'].includes(body.source) && typeof body.country === 'string' && /^[A-Z]{2,3}$/.test(body.country)
      && typeof body.showSign === 'boolean' && body.socialInvite === false && isoDay(body.day), 'QA_PRIVATE_BIRTHDAY_METADATA');
    Object.assign(out, { source: body.source, country: body.country, showSign: body.showSign, socialInvite: false, day: body.day });
  }
  if (body.kind === 'daily-sync') { requireValue(isoDay(body.day), 'QA_PRIVATE_DAY'); out.day = body.day; }
  return out;
}
export function qaPrivatePublicIntent(body) {
  object(body, 'QA_PRIVATE_INTENT');
  requireValue(id(body.realmId) && id(body.selectedCharacterId) && typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.requestId), 'QA_PRIVATE_SCOPE');
  return { realmId: body.realmId, selectedCharacterId: body.selectedCharacterId, requestId: body.requestId, ...publicFields(body) };
}
export function qaPrivatePublicSignature(signature) {
  requireValue(typeof signature === 'string', 'QA_PRIVATE_SIGNATURE');
  const parsed = parse(signature), clean = publicFields(object(parsed, 'QA_PRIVATE_SIGNATURE'));
  requireValue(same(sorted(parsed), sorted(clean)), 'QA_PRIVATE_SIGNATURE_FIELDS');
  return signature;
}
export function qaPrivateResult(kind, result, outcome = 'committed') {
  object(result, 'QA_PRIVATE_RESULT');
  if (outcome === 'cancelled') { exactKeys(result, ['cancelled'], 'QA_CANCEL_RESULT'); requireValue(result.cancelled === true, 'QA_CANCEL_RESULT'); return { cancelled: true }; }
  if (kind === 'profile-save') {
    exactKeys(result, ['saved', 'coverage'], 'QA_SAVE_RESULT');
    requireValue(result.saved === true && COVERAGE.has(result.coverage), 'QA_SAVE_RESULT');
    return { saved: true, coverage: result.coverage };
  }
  if (kind === 'profile-delete') { exactKeys(result, ['deleted'], 'QA_DELETE_RESULT'); requireValue(result.deleted === true, 'QA_DELETE_RESULT'); return { deleted: true }; }
  if (kind === 'birthday-start') {
    exactKeys(result, ['lifeId', 'already'], 'QA_START_RESULT');
    requireValue(typeof result.lifeId === 'string' && /^[a-f0-9]{32}$/.test(result.lifeId) && (result.already === undefined || result.already === true), 'QA_START_RESULT');
    return { lifeId: result.lifeId, ...(result.already ? { already: true } : {}) };
  }
  if (kind === 'daily-sync') {
    exactKeys(result, ['day', 'materialized', 'created', 'unlocked', 'added', 'revision'], 'QA_DAILY_RESULT');
    requireValue(isoDay(result.day) && result.materialized === true && typeof result.created === 'boolean'
      && number(result.unlocked) && result.unlocked <= 3 && number(result.added) && result.added <= 3 && number(result.revision), 'QA_DAILY_RESULT');
    return { day: result.day, materialized: true, created: result.created, unlocked: result.unlocked, added: result.added, revision: result.revision };
  }
  throw error('QA_PRIVATE_RESULT_KIND');
}
export function qaPrivateReceipt(receipt) {
  exactKeys(receipt, ['version', 'kind', 'requestId', 'requestKey', 'intentNonce', 'signature', 'scope', 'createdAt', 'outcome', 'result', 'costs', 'authority'], 'QA_RECEIPT_SHAPE');
  requireValue(receipt.version === 1 && KINDS.has(receipt.kind) && /^[A-Za-z0-9_-]{8,64}$/.test(receipt.requestId)
    && /^private:(app|service):[A-Za-z0-9_-]{8,64}$/.test(receipt.requestKey) && number(receipt.createdAt)
    && ['committed', 'cancelled'].includes(receipt.outcome), 'QA_RECEIPT_METADATA');
  exactKeys(receipt.scope, ['realmId', 'accountId', 'characterId'], 'QA_RECEIPT_SCOPE');
  requireValue(Object.values(receipt.scope).every(id), 'QA_RECEIPT_SCOPE');
  exactKeys(receipt.costs, receipt.kind === 'birthday-start' && receipt.outcome === 'committed' ? ['dailyStarts'] : [], 'QA_RECEIPT_COSTS');
  if (receipt.kind === 'birthday-start' && receipt.outcome === 'committed') requireValue([0, 1].includes(receipt.costs.dailyStarts), 'QA_RECEIPT_COSTS');
  exactKeys(receipt.authority, ['family', 'requestKey', 'proofId'], 'QA_RECEIPT_AUTHORITY');
  requireValue(receipt.authority.family === 'life-operations' && receipt.authority.requestKey === receipt.requestKey
    && /^[a-f0-9]{32}$/.test(receipt.authority.proofId), 'QA_RECEIPT_AUTHORITY');
  const signature = qaPrivatePublicSignature(receipt.signature);
  requireValue(parse(signature).kind === receipt.kind && parse(signature).intentNonce === receipt.intentNonce, 'QA_RECEIPT_SIGNATURE');
  return { version: 1, kind: receipt.kind, requestId: receipt.requestId, requestKey: receipt.requestKey,
    intentNonce: receipt.intentNonce, signature, scope: { realmId: receipt.scope.realmId, accountId: receipt.scope.accountId, characterId: receipt.scope.characterId },
    createdAt: receipt.createdAt, outcome: receipt.outcome, result: qaPrivateResult(receipt.kind, receipt.result, receipt.outcome),
    costs: clone(receipt.costs), authority: { family: 'life-operations', requestKey: receipt.authority.requestKey, proofId: receipt.authority.proofId } };
}

// History rows are public recovery hints, not complete verified receipts. Keep
// their allowlist separate so a successful scene read neither fails nor upgrades
// unverified metadata into operation-success evidence.
function qaPrivateHistory(entry) {
  object(entry, 'QA_HISTORY_SHAPE');
  if (entry.corrupt === true) {
    exactKeys(entry, ['createdAt', 'corrupt'], 'QA_HISTORY_CORRUPT');
    requireValue(Object.keys(entry).length === 2 && number(entry.createdAt), 'QA_HISTORY_CORRUPT');
    return { createdAt: entry.createdAt, corrupt: true };
  }
  const fields = ['version', 'kind', 'requestId', 'requestKey', 'intentNonce', 'signature', 'scope', 'createdAt', 'outcome', 'intent'];
  exactKeys(entry, fields, 'QA_HISTORY_SHAPE');
  const requestKey = typeof entry.requestKey === 'string' && /^private:(app|service):([A-Za-z0-9_-]{8,64})$/.exec(entry.requestKey);
  requireValue(Object.keys(entry).length === fields.length && entry.version === 1 && KINDS.has(entry.kind)
    && typeof entry.requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(entry.requestId)
    && requestKey && requestKey[2] === entry.requestId && number(entry.createdAt)
    && ['committed', 'cancelled'].includes(entry.outcome), 'QA_HISTORY_METADATA');
  exactKeys(entry.scope, ['realmId', 'accountId', 'characterId'], 'QA_HISTORY_SCOPE');
  requireValue(Object.keys(entry.scope).length === 3 && Object.values(entry.scope).every(id), 'QA_HISTORY_SCOPE');
  const signature = qaPrivatePublicSignature(entry.signature), intent = publicFields(object(entry.intent, 'QA_HISTORY_INTENT'));
  requireValue(same(sorted(entry.intent), sorted(intent)), 'QA_HISTORY_INTENT_FIELDS');
  requireValue(same(sorted(parse(signature)), sorted(intent)) && intent.kind === entry.kind
    && intent.intentNonce === entry.intentNonce, 'QA_HISTORY_BINDING');
  return { version: 1, kind: entry.kind, requestId: entry.requestId, requestKey: entry.requestKey,
    intentNonce: entry.intentNonce, signature,
    scope: { realmId: entry.scope.realmId, accountId: entry.scope.accountId, characterId: entry.scope.characterId },
    createdAt: entry.createdAt, outcome: entry.outcome, intent: sorted(intent) };
}

function qaPrivateDomain(domain) {
  exactKeys(domain, ['version', 'generation', 'profile', 'daily', 'token'], 'QA_PRIVATE_DOMAIN');
  requireValue(domain.version === 1 && typeof domain.token === 'string' && /^[a-f0-9]{64}$/.test(domain.token), 'QA_PRIVATE_DOMAIN');
  return { version: 1, ...qaPrivateExpected({ generation: domain.generation, profile: domain.profile, daily: domain.daily }), token: domain.token };
}
function qaProfileMetadata(profile) {
  requireValue(typeof profile.saved === 'boolean' && number(profile.rev) && COVERAGE.has(profile.coverage)
    && (profile.updatedAt == null || number(profile.updatedAt)), 'QA_PROFILE_RESPONSE');
  return { saved: profile.saved, rev: profile.rev, updatedAt: profile.updatedAt ?? null, coverage: profile.coverage };
}
function qaEvidence(rows) {
  requireValue(Array.isArray(rows), 'QA_EVIDENCE_RESPONSE');
  return rows.map(row => { requireValue(['boss', 'dungeon', 'tower'].includes(row.id) && number(row.at), 'QA_EVIDENCE_RESPONSE'); return { id: row.id, at: row.at }; });
}
function qaControl(control) {
  requireValue(['ACTIVE', 'FREEZE', 'DRAIN', 'SEALED', 'IMPORTING', 'COMPLETE'].includes(control.realmPhase)
    && typeof control.writable === 'boolean', 'QA_CONTROL_RESPONSE');
  return { realmPhase: control.realmPhase, writable: control.writable };
}
export function qaPrivateResponse(value) {
  object(value, 'QA_PRIVATE_RESPONSE');
  const common = { ok: value.ok === true };
  if (number(value.now)) common.now = value.now;
  for (const key of ['realmId', 'accountId', 'characterId']) if (id(value[key])) common[key] = value[key];
  if (number(value.revision)) common.revision = value.revision;
  if (number(value.readSequence)) common.readSequence = value.readSequence;
  if (value.ok !== true) {
    const code = value.error?.code || value.error || value.code;
    return { ...common, errorCode: typeof code === 'string' && /^[a-z0-9_-]{1,80}$/.test(code) ? code : 'unclassified' };
  }
  if (value.privateFate) {
    const f = value.privateFate, d = object(f.daily, 'QA_DAILY_RESPONSE');
    requireValue(isoDay(f.day) && isoDay(d.day) && typeof d.materialized === 'boolean' && number(d.rev)
      && (d.createdAt === null || number(d.createdAt)) && number(d.profileRevision) && number(d.unlocked) && d.unlocked <= 3
      && Array.isArray(d.notes) && d.notes.length <= 3, 'QA_DAILY_RESPONSE');
    const notes = d.notes.map(note => {
      requireValue(['health', 'work', 'love'].includes(note.topic) && typeof note.locked === 'boolean', 'QA_NOTE_RESPONSE');
      return { topic: note.topic, locked: note.locked };
    });
    return { ...common, privateFate: { day: f.day, profile: qaProfileMetadata(f.profile),
      daily: { day: d.day, materialized: d.materialized, rev: d.rev, createdAt: d.createdAt,
        profileRevision: d.profileRevision, unlocked: d.unlocked, unlocks: qaEvidence(d.unlocks || []), notes },
      evidence: { available: qaEvidence(f.evidence?.available || []), pending: qaEvidence(f.evidence?.pending || []) },
      domain: qaPrivateDomain(f.domain), control: qaControl(f.control),
      ...(f.history ? { history: { receipts: (f.history.receipts || []).map(qaPrivateHistory) } } : {}) } };
  }
  if (value.privateProfile) {
    const f = value.privateProfile;
    return { ...common, privateProfile: { profile: { ...qaProfileMetadata(f.profile), revealed: Object.hasOwn(f.profile, 'birth') },
      domain: qaPrivateDomain(f.domain), control: qaControl(f.control) } };
  }
  requireValue(KINDS.has(value.kind) && typeof value.requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value.requestId)
    && typeof value.intentNonce === 'string' && /^[a-f0-9]{32,64}$/.test(value.intentNonce)
    && ['committed', 'cancelled', null, undefined].includes(value.outcome), 'QA_PRIVATE_RESPONSE_KIND');
  const receipt = value.receipt ? qaPrivateReceipt(value.receipt) : null;
  return { ...common, kind: value.kind, requestId: value.requestId, intentNonce: value.intentNonce, signature: qaPrivatePublicSignature(value.signature),
    outcome: value.outcome ?? null, result: value.result ? qaPrivateResult(value.kind, value.result, value.outcome) : null, receipt,
    ...(typeof value.found === 'boolean' ? { found: value.found } : {}), ...(typeof value.replayed === 'boolean' ? { replayed: value.replayed } : {}),
    ...(typeof value.recoveryAllowed === 'boolean' ? { recoveryAllowed: value.recoveryAllowed } : {}),
    ...(typeof value.cancellationAllowed === 'boolean' ? { cancellationAllowed: value.cancellationAllowed } : {}) };
}

function isolated(env) {
  requireValue(env.ENVIRONMENT === 'development' && env.ALLOW_DEV_AUTH === 'true', 'QA_REQUIRES_DEVELOPMENT');
  for (const db of [env.DB, env.DB_SEASON]) requireValue(db?.sqlite && db.sqlite.prepare('PRAGMA database_list').all().every(row => !row.file), 'QA_REQUIRES_MEMORY_DATABASE');
}
function noOutcomes(db) {
  const counts = {};
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'rpg_fate_%' OR name IN ('rpg_boss_instances','rpg_boss_attacks','rpg_parties','rpg_party_members','rpg_party_operations')) ORDER BY name").all()) {
    counts[row.name] = db.prepare('SELECT COUNT(*) n FROM "' + row.name + '"').get().n;
  }
  requireValue(Object.values(counts).every(n => n === 0), 'QA_REQUIRES_EMPTY_FATE_AND_BATTLES');
  return counts;
}
export async function seedFatePrivateQa(env, permanent, now) {
  isolated(env); requireValue(now === FATE_PRIVATE_QA_STARTED_AT, 'QA_REQUIRES_ORIGINAL_START_CLOCK');
  env.GROUP_CHAT_ID = permanent.GROUP_CHAT_ID = '-100190101';
  const membershipChecks = [];
  const membership = async accounts => {
    membershipChecks.push({ fixtureOnly: true, remoteCalled: false, accountCount: accounts.length });
    return { ok: true, members: accounts.map(accountId => ({ accountId: String(accountId), member: false })) };
  };
  env.FATE_SOCIAL_MEMBERSHIP = permanent.FATE_SOCIAL_MEMBERSHIP = membership;
  const fixtures = (await seedPartyQa(env, permanent, now)).map(row => ({ ...row, realmId: 'permanent' }));
  const primary = fixtures.find(row => row.accountId === '90101' && row.baseClass === 'mage');
  const alternate = fixtures.find(row => row.accountId === '90101' && row.baseClass === 'archer');
  const partyRoster = [primary, fixtures.find(row => row.accountId === '90102'), fixtures.find(row => row.accountId === '90103')];
  requireValue(primary && alternate && partyRoster.every(Boolean), 'QA_FIXTURE_ACTORS');
  const foreignCreated = await Player.createCharacter(permanent, { tgId: '90104', charSlot: 1, name: '私人資料他帳驗收', baseClass: 'mage', gender: 'm' }, now);
  const foreign = { accountId: '90104', characterId: String(foreignCreated.char.tg_id), name: foreignCreated.char.name, baseClass: 'mage', realmId: 'permanent', role: 'foreign-account' };
  fixtures.push(foreign);
  for (const actor of [primary, ...partyRoster.slice(1), foreign]) env.DB.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(actor.characterId, actor.accountId);
  const season = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  season.FATE_SOCIAL_MEMBERSHIP = membership;
  const c = await Player.createCharacter(season, { tgId: '90101', charSlot: 1, name: '私人資料凍結世界驗收', baseClass: 'mage', gender: 'f' }, now);
  const seasonFixtures = [{ accountId: '90101', characterId: String(c.char.tg_id), name: c.char.name, baseClass: 'mage', realmId: 'season_2026_01', role: 'frozen-empty-world' }];
  await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: now, now });
  const initialOutcomeCounts = { permanent: noOutcomes(env.DB.sqlite), season: noOutcomes(env.DB_SEASON.sqlite) };
  const seed = { schemaVersion: 1, fixtures, primary, alternate, foreign, partyRoster, seasonFixtures, seededAt: now,
    syntheticInitialInputOnly: true, noSeededLifeGiftOrReceipt: true, noSeededPrivateOrBattleOutcomes: true,
    initialOutcomeCounts, initialInputs: { description: 'Synthetic actors, original generated equipment and resources only; no private, Fate or battle outcome', fixtureOnly: true, notAReceipt: true },
    originalRules: { lifeMs: LIFE_MS, choiceMs: CHOICE_MS, nightPause: '00:00-06:00 Asia/Taipei', dailyAccountStarts: 4, giftInterval: 4 },
    realNotificationsSent: false, noDispatcher: true };
  return { ...seed, initialInputSha256: publicHash(seed), membershipChecks };
}
export function createFatePrivateQaController(env, permanent, seed, initialNow) {
  isolated(env);
  const key = randomBytes(32), digestId = randomUUID().replaceAll('-', ''), commands = [], attempts = new Map();
  const ids = new Set(seed.fixtures.map(row => row.characterId)), bossIds = new Set(), partyIds = new Set();
  const rawSecrets = new Set();
  let now = initialNow, sequence = Promise.resolve(), commandInFlight = null;
  const hmac = value => createHmac('sha256', key).update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
  const info = () => ({ mode: 'manual-development-clock', now, wallTime: Date.now(), debugOnly: true,
    deadlinesUnmodified: true, lifeMs: LIFE_MS, choiceMs: CHOICE_MS, nightPause: '00:00-06:00 Asia/Taipei',
    automaticFateSweep: false, automaticBossSweep: false, automaticPartySweep: false,
    method: 'Explicit QA clock and original services; no natural waiting or seeded outcomes' });
  function snapshotDatabase(db) {
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    const tableHashes = {}, counts = {};
    for (const name of tableNames) {
      const rows = db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(row => JSON.stringify(row)).sort();
      counts[name] = rows.length; tableHashes[name] = hmac(rows);
    }
    return { digestAlgorithm: 'HMAC-SHA-256', digestId, secretPersisted: false, restorableBackup: false,
      sha256: hmac(tableHashes), tableNames, tableHashes, counts, totalChanges: db.prepare('SELECT total_changes() n').get().n, outboxHash: tableHashes.rpg_outbox };
  }
  const databases = () => ({ permanent: snapshotDatabase(env.DB.sqlite), season: snapshotDatabase(env.DB_SEASON.sqlite) });
  const rows = (db, table, order) => db.prepare('SELECT * FROM "' + table + '" ORDER BY ' + order).all();
  function privateRowMetadata(db) {
    const profiles = rows(db, 'rpg_fate_profiles', 'account_id').map(row => {
      const birth = parse(row.birth_json, {}), chart = parse(row.chart_json, {});
      if (typeof birth.date === 'string') rawSecrets.add(birth.date);
      rawSecrets.add(row.birth_json); rawSecrets.add(row.chart_json);
      return { accountId: row.account_id, saved: true, rev: row.rev, updatedAt: row.updated_at, coverage: COVERAGE.has(chart.coverage) ? chart.coverage : 'unknown', privateHmac: hmac(row) };
    });
    const daily = rows(db, 'rpg_fate_daily', 'account_id,day').map(row => {
      const notes = parse(row.notes_json, []), unlocks = parse(row.unlocks_json, []);
      rawSecrets.add(row.notes_json);
      for (const note of notes) for (const value of Object.values(note || {})) if (typeof value === 'string' && value.length >= 18) rawSecrets.add(value);
      return { accountId: row.account_id, day: row.day, rev: row.rev, createdAt: row.created_at, profileRevision: row.profile_rev,
        unlocked: unlocks.length, unlocks: unlocks.map(e => ({ id: e.id, at: e.at })), noteCount: notes.length, notesHmac: hmac(row.notes_json) };
    });
    return { profiles, daily };
  }
  function realmSnapshot(db) {
    const privateMetadata = privateRowMetadata(db);
    const operations = rows(db, 'rpg_fate_operations', 'account_id,request_id').map(row => {
      const value = parse(row.result_json), wrapped = value?.fatePrivate === true && KINDS.has(value.kind);
      return { accountId: row.account_id, requestKey: row.request_id, createdAt: row.created_at, private: wrapped,
        ...(wrapped ? { kind: value.kind, outcome: value.outcome, result: qaPrivateResult(value.kind, value.result, value.outcome), proofId: value.proofId } : { resultKeys: value && typeof value === 'object' ? Object.keys(value).filter(k => ['lifeId', 'already', 'saved', 'deleted', 'coverage', 'countsAsLife'].includes(k)) : [] }) };
    });
    const ledger = rows(db, 'rpg_ledger', 'event_id').map(row => ({ eventId: row.event_id, characterId: row.tg_id, type: row.type,
      goldDelta: row.gold_delta, expDelta: row.exp_delta, item: row.item, itemDelta: row.item_delta,
      createdAt: row.created_at, ...(row.type === '命運私人操作收據' ? { receipt: qaPrivateReceipt(parse(row.note)) } : {}) }));
    const outbox = rows(db, 'rpg_outbox', 'id').map(row => ({ id: row.id, kind: row.kind, target: row.target, status: row.status, attempts: row.attempts }));
    return { ...privateMetadata, operations, ledger, outbox,
      lives: rows(db, 'rpg_fate_lives', 'started_at,id').map(row => ({ id: row.id, characterId: row.char_id, accountId: row.account_id, status: row.status,
        startedAt: row.started_at, completedAt: row.completed_at, rev: row.rev, codePresent: !!row.code, stateHmac: hmac(row.state_json) })),
      starts: rows(db, 'rpg_fate_starts', 'account_id,day'), memorials: rows(db, 'rpg_fate_memorials', 'char_id,code').map(row => ({ characterId: row.char_id, createdAt: row.created_at })),
      gifts: rows(db, 'rpg_fate_gifts', 'char_id,milestone').map(row => ({ id: row.id, characterId: row.char_id, milestone: row.milestone, status: row.status })),
      giftOperations: rows(db, 'rpg_fate_gift_operations', 'account_id,request_id').map(row => ({ accountId: row.account_id, requestKey: row.request_id })),
      social: rows(db, 'rpg_fate_social_choices', 'id').map(row => ({ id: row.id })),
      accounts: db.prepare('SELECT account_tg_id,active_char_id FROM rpg_accounts ORDER BY account_tg_id').all(),
      characters: db.prepare('SELECT tg_id,account_tg_id,name,base_class,level,gold,hp,mp,exp,rev,party_id,idle_state,last_settle_at FROM rpg_characters ORDER BY tg_id').all(),
      inventory: rows(db, 'rpg_inventory', 'tg_id,item'), realmIdentity: rows(db, 'rpg_realm_identity', 'singleton'),
      bosses: db.prepare('SELECT id,chat_id,status,map_id,hp,started_at,ends_at,settled_at FROM rpg_boss_instances ORDER BY started_at,id').all(),
      attacks: rows(db, 'rpg_boss_attacks', 'boss_id,tg_id,win'),
      parties: rows(db, 'rpg_parties', 'id').map(row => { const s = parse(row.state_json, {}); return { id: row.id, kind: row.kind, status: row.status, rev: row.rev,
        updatedAt: row.updated_at, floor: s.floor, round: s.round, deadline: s.deadline, challengeEndsAt: s.challengeEndsAt,
        trial: s.trial, journalWonAt: s.journalWonAt, journalFloors: (s.journalFloors || []).map(f => ({ floor: f.floor, at: f.at, participants: f.participants })),
        actors: (s.actors || []).map(a => ({ id: a.id, hp: a.hp, maxHp: a.maxHp, actions: a.actions || 0, manualActions: a.manualActions || 0 })) }; }),
      members: rows(db, 'rpg_party_members', 'party_id,char_id').map(m => ({ partyId: m.party_id, characterId: m.char_id, accountId: m.account_id, ready: m.ready })) };
  }
  const knownActor = actor => { requireValue(ids.has(String(actor)), 'QA_FIXTURE_ACTOR_REQUIRED'); return String(actor); };
  function ownedLife(lifeId) {
    requireValue(typeof lifeId === 'string' && /^[a-f0-9]{32}$/.test(lifeId), 'QA_EXACT_LIFE_REQUIRED');
    const row = env.DB.sqlite.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').get(lifeId);
    requireValue(row && ids.has(String(row.char_id)), 'QA_OWNED_LIFE_REQUIRED'); return row;
  }
  function knownBoss(bossId) { requireValue(bossIds.has(String(bossId)), 'QA_OWNED_BOSS_REQUIRED'); const row = env.DB.sqlite.prepare('SELECT * FROM rpg_boss_instances WHERE id=?').get(bossId); requireValue(row, 'QA_OWNED_BOSS_REQUIRED'); return row; }
  function knownParty(partyId) {
    requireValue(partyIds.has(String(partyId)), 'QA_OWNED_PARTY_REQUIRED');
    const row = env.DB.sqlite.prepare('SELECT * FROM rpg_parties WHERE id=?').get(partyId);
    requireValue(row, 'QA_OWNED_PARTY_REQUIRED'); return { ...row, state: parse(row.state_json, {}) };
  }
  function timing(row) {
    const v = advanceLife(parse(row.state_json), now);
    return { lifeId: row.id, status: row.status, rev: row.rev, nextAt: v.nextAt, endAt: v.endAt, night: v.night,
      persistedAnswers: parse(row.state_json).answers.length, projectedAnswers: v.draft.answers.length, completedProjection: v.completed };
  }
  function safeFailure(e) { return { code: typeof e?.code === 'string' && /^[A-Z0-9_a-z-]{1,80}$/.test(e.code) ? e.code : 'QA_SERVICE_FAILED', messageWithheld: true }; }
  async function execute(body) {
    isolated(env);
    exactKeys(body, ['requestId', 'op', 'expectedNow', 'lifeId', 'bossId', 'partyId', 'characterId', 'kind', 'round', 'at', 'tier'], 'QA_COMMAND_SHAPE');
    requireValue(typeof body.requestId === 'string' && /^[A-Za-z0-9:_-]{8,120}$/.test(body.requestId), 'QA_COMMAND_ID');
    const allowed = new Set(['clock', 'next-day', 'life-end', 'fate-sweep', 'boss-spawn', 'boss-attack', 'boss-next-window',
      'party-create', 'party-join', 'party-ready', 'party-start', 'party-submit', 'party-deadline', 'party-sweep', 'party-end']);
    requireValue(allowed.has(body.op), 'QA_COMMAND_OP');
    const signature = JSON.stringify(sorted(body)), previous = attempts.get(body.requestId);
    if (previous) { requireValue(previous.signature === signature, 'QA_COMMAND_CHANGED'); if (previous.response) return clone(previous.response); throw error('QA_COMMAND_FAILED_REPLAY_FORBIDDEN'); }
    if (body.expectedNow !== undefined) requireValue(body.expectedNow === now, 'QA_CLOCK_CHANGED');
    const record = { requestId: body.requestId, op: body.op, input: clone(body), signature, from: now, status: 'started', before: databases() };
    attempts.set(body.requestId, record); commands.push(record); commandInFlight = body.requestId;
    try {
      let result = {}, clockOnly = false;
      if (body.op === 'clock' || body.op === 'next-day' || body.op === 'life-end' || body.op === 'boss-next-window' || body.op === 'party-deadline') {
        let target = body.at;
        if (body.op === 'next-day') target = taipeiAt(taipeiDay(now), 0) + 86400000 + 6 * 3600000;
        if (body.op === 'life-end') { const row = ownedLife(body.lifeId); requireValue(row.status === 'active', 'QA_ACTIVE_LIFE_REQUIRED'); target = timing(row).endAt; result = { lifeId: row.id, originalLifeMs: LIFE_MS }; }
        if (body.op === 'boss-next-window') { const boss = knownBoss(body.bossId); target = boss.started_at + (attackWindow(boss, now) + 1) * BOSS.attackWindowMs; requireValue(target < boss.ends_at, 'QA_BOSS_WINDOW_EXHAUSTED'); result = { bossId: boss.id }; }
        if (body.op === 'party-deadline') { const party = knownParty(body.partyId); requireValue(party.status === 'combat', 'QA_COMBAT_REQUIRED'); target = party.state.deadline; result = { partyId: party.id }; }
        requireValue(number(target) && target >= now, 'QA_FORWARD_CLOCK_REQUIRED'); now = target; clockOnly = true;
      } else if (body.op === 'fate-sweep') {
        const due = env.DB.sqlite.prepare("SELECT id,char_id FROM rpg_fate_lives WHERE status='active' AND next_at<=?").all(now);
        requireValue(due.every(row => ids.has(String(row.char_id))), 'QA_UNOWNED_LIFE_DUE');
        await Fate.sweep(permanent, now); result = { dueLifeIds: due.map(row => row.id), originalService: 'Fate.sweep' };
      } else if (body.op === 'boss-spawn') {
        requireValue(!env.DB.sqlite.prepare("SELECT id FROM rpg_boss_instances WHERE status IN ('active','settling')").get(), 'QA_FINISH_CURRENT_BOSS');
        requireValue([1, 2, 3].includes(body.tier || 1), 'QA_BOSS_TIER');
        const value = await Boss.spawnDue(permanent, now, { force: { tier: body.tier || 1 } }); bossIds.add(value.id);
        result = { bossId: value.id, spawned: value.spawned, tier: value.tier, originalService: 'Boss.spawnDue', manualForceOriginalOption: true };
      } else if (body.op === 'boss-attack') {
        const boss = knownBoss(body.bossId), actor = knownActor(body.characterId);
        const value = await Boss.attackBoss(permanent, actor, boss.id, now, { expectedWin: attackWindow(boss, now) });
        result = { bossId: boss.id, characterId: actor, damage: value.damage, killed: value.killed, bossHp: value.bossHp, originalService: 'Boss.attackBoss' };
      } else if (body.op === 'party-create') {
        requireValue(['dungeon', 'tower'].includes(body.kind), 'QA_PARTY_KIND');
        const actor = knownActor(body.characterId), value = await Party.create(permanent, actor, body.kind === 'tower' ? { kind: 'tower', startFloor: 1 } : { kind: 'dungeon', dungeonId: 'pillar' }, now);
        partyIds.add(value.party.id); result = { partyId: value.party.id, kind: value.party.kind, status: value.party.status, originalService: 'Party.create' };
      } else if (body.op === 'party-sweep') {
        knownParty(body.partyId);
        const due = env.DB.sqlite.prepare("SELECT id FROM rpg_parties WHERE status IN ('lobby','combat')").all();
        requireValue(due.every(row => partyIds.has(row.id)), 'QA_UNOWNED_PARTY_DUE');
        await Party.sweep(permanent, now, 6); result = { partyId: body.partyId, originalService: 'Party.sweep' };
      } else {
        const party = knownParty(body.partyId), actor = knownActor(body.characterId), op = body.op.slice('party-'.length);
        const action = { partyId: party.id, op, requestId: 'f2qa:' + body.requestId };
        if (op === 'ready') action.ready = true;
        if (op === 'submit') { requireValue(number(body.round), 'QA_PARTY_ROUND'); action.round = body.round; action.skillId = 'attack'; }
        await Party.action(permanent, actor, action, now);
        const after = knownParty(party.id); result = { partyId: party.id, characterId: actor, op, status: after.status, round: after.state.round, floor: after.state.floor, originalService: 'Party.action', manualSubmission: op === 'submit' };
      }
      const after = databases();
      if (clockOnly) requireValue(same(record.before, after), 'QA_CLOCK_WROTE_DATABASE');
      const response = { ok: true, isolated: true, productionAccess: false, debugOnly: true, requestId: body.requestId, op: body.op,
        from: record.from, to: now, clockOnly, result, before: record.before, after, qaClock: info() };
      record.status = 'completed'; record.response = response; record.to = now; record.after = after;
      return clone(response);
    } catch (e) { record.status = 'failed'; record.failure = safeFailure(e); record.to = now; record.after = databases(); throw error(record.failure.code); }
    finally { commandInFlight = null; }
  }
  return {
    now: () => now, info,
    async snapshot() {
      isolated(env);
      const permanentRows = realmSnapshot(env.DB.sqlite), seasonRows = realmSnapshot(env.DB_SEASON.sqlite);
      const forbiddenCopies = [];
      for (const [realm, db] of [['permanent', env.DB.sqlite], ['season', env.DB_SEASON.sqlite]]) {
        const text = db.prepare('SELECT note FROM rpg_ledger').all().map(row => row.note || '').join('\n') + '\n'
          + db.prepare('SELECT payload_json FROM rpg_outbox').all().map(row => row.payload_json || '').join('\n');
        if ([...rawSecrets].some(secret => secret.length >= 8 && text.includes(secret))) forbiddenCopies.push(realm);
      }
      const evidence = {};
      for (const actor of seed.fixtures.filter((row, i, all) => all.findIndex(x => x.accountId === row.accountId) === i)) evidence[actor.accountId] = await fateEvidence(permanent, actor.accountId, now);
      return { ok: true, isolated: true, ephemeral: true, productionAccess: false, readOnly: true,
        privacy: { digestId, secretPersisted: false, restorableBackup: false, privateRowsExposed: false, forbiddenCopies },
        qaClock: info(), commandInFlight, commands: clone(commands), ...seed, databases: databases(),
        permanent: permanentRows, season: seasonRows, evidence,
        lifeTiming: rows(env.DB.sqlite, 'rpg_fate_lives', 'started_at,id').map(timing) };
    },
    advance(body) { const task = sequence.then(() => execute(body)); sequence = task.catch(() => {}); return task; }
  };
}
