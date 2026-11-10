// Disposable, opt-in Fate F1 QA. Only initial actors/resources are synthetic.
// Lives, choices, gifts and receipts are produced by the original services.
import { createHash } from 'node:crypto';
import * as Player from '../src/services/player.js';
import * as Fate from '../src/services/fate.js';
import { LIFE_MS, CHOICE_MS, advanceLife, addActive, activeBetween } from '../public/fate/life.js';
import { resolveRealm, scopeEnvForRealm, transitionRealmPhase } from '../src/realm/index.js';

export const FATE_QA_STARTED_AT = Date.parse('2026-11-05T06:00:00+08:00');
const DAY = 86400000, OFFSET = 8 * 3600000;
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const originalTables = ['rpg_fate_lives', 'rpg_fate_starts', 'rpg_fate_memorials', 'rpg_fate_operations', 'rpg_fate_gifts', 'rpg_fate_gift_operations'];
function isolated(env) {
  if (env.ENVIRONMENT !== 'development' || env.ALLOW_DEV_AUTH !== 'true') throw Error('Fate QA requires explicit isolated development authentication');
  for (const db of [env.DB, env.DB_SEASON]) {
    if (!db?.sqlite || db.sqlite.prepare('PRAGMA database_list').all().some(row => row.file)) throw Error('Fate QA refuses persistent databases');
  }
}
export function fateDatabaseSnapshot(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  const rows = {}, counts = {}, tableHashes = {};
  for (const name of names) {
    rows[name] = db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(row => JSON.stringify(row)).sort();
    counts[name] = rows[name].length;
    tableHashes[name] = digest(rows[name]);
  }
  return { sha256: digest(rows), tableNames: names, tableHashes, counts, totalChanges: db.prepare('SELECT total_changes() n').get().n, outboxHash: tableHashes.rpg_outbox };
}
function actor(db, char, now, role, realmId = 'permanent') {
  db.prepare("UPDATE rpg_characters SET level=30,party_id=NULL,idle_state='gate',last_settle_at=? WHERE tg_id=?").run(now, char.tg_id);
  return { accountId: String(char.account_tg_id || char.tg_id), characterId: String(char.tg_id), name: char.name, baseClass: char.base_class, role, realmId };
}
function assertNoInitialOutcomes(db) {
  const counts = Object.fromEntries(originalTables.map(name => [name, db.prepare('SELECT COUNT(*) n FROM ' + name).get().n]));
  if (Object.values(counts).some(Boolean)) throw Error('Fate QA must begin without any life, start, memorial, gift or Fate receipt');
  return counts;
}
export async function seedFateQa(env, permanent, now) {
  isolated(env);
  if (now !== FATE_QA_STARTED_AT) throw Error('Fate QA requires its explicitly labelled initial development clock');
  const membershipChecks = [];
  const membership = async accounts => {
    const row = { accounts: accounts.map(String), fixtureOnly: true, remoteCalled: false, observedAt: new Date().toISOString() };
    membershipChecks.push(row);
    return { ok: true, members: row.accounts.map(accountId => ({ accountId, member: false })) };
  };
  env.FATE_SOCIAL_MEMBERSHIP = membership;
  permanent.FATE_SOCIAL_MEMBERSHIP = membership;
  const db = env.DB.sqlite;
  const existing = db.prepare("SELECT * FROM rpg_characters WHERE account_tg_id='90101' ORDER BY char_slot").all();
  if (existing.length !== 4) throw Error('Fate QA expects the original four disposable preview characters');
  const fixtures = existing.map(char => actor(db, char, now, char.base_class === 'mage' ? 'primary-four-lives' : char.base_class === 'archer' ? 'same-account-alternate' : 'owned-unused'));
  const other = await Player.createCharacter(permanent, { tgId: '90102', charSlot: 1, name: '命運他帳驗收', baseClass: 'mage', gender: 'f' }, now);
  fixtures.push(actor(db, other.char, now, 'foreign-account'));
  const primary = fixtures.find(row => row.role === 'primary-four-lives');
  const alternate = fixtures.find(row => row.role === 'same-account-alternate');
  db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(primary.characterId, primary.accountId);
  const season = scopeEnvForRealm(env, await resolveRealm(env, 'season_2026_01'));
  const created = await Player.createCharacter(season, { tgId: '90101', charSlot: 1, name: '命運凍結世界驗收', baseClass: 'mage', gender: 'f' }, now);
  const seasonActor = actor(env.DB_SEASON.sqlite, created.char, now, 'frozen-empty-world', 'season_2026_01');
  await transitionRealmPhase(env, 'season_2026_01', { expectedPhase: 'ACTIVE', expectedFenceEpoch: 0, nextPhase: 'FREEZE', cutoffAt: now, now });
  const initialOutcomeCounts = { permanent: assertNoInitialOutcomes(db), season: assertNoInitialOutcomes(env.DB_SEASON.sqlite) };
  const seed = {
    schemaVersion: 1, fixtures, primary, alternate, seasonFixtures: [seasonActor], seededAt: now,
    syntheticInitialInputOnly: true, noSeededLifeGiftOrReceipt: true, initialOutcomeCounts,
    initialInputs: { description: 'Synthetic actors and inherited preview resources only; no Fate outcome or receipt is seeded', fixtureOnly: true, notAReceipt: true },
    originalRules: { lifeMs: LIFE_MS, choiceMs: CHOICE_MS, nightPause: '00:00-06:00 Asia/Taipei', dailyAccountStarts: 4, giftInterval: 4 },
    realNotificationsSent: false, noDispatcher: true
  };
  return { ...seed, initialInputSha256: digest(seed), membershipChecks };
}
// Pure clock planning is shared by the isolated controller and its retained-draft preflight.
export function fateQaChoiceBoundary(draft, now) {
  let target = now, projected = advanceLife(draft, target);
  const originalTimingSteps = [];
  for (let step = 0; !projected.available && !projected.completed && step < 128; step++) {
    const nextAt = projected.nextAt;
    if (!Number.isSafeInteger(nextAt) || nextAt <= target || nextAt >= projected.endAt)
      throw Error('Original nextAt must move forward to a choice before completion');
    const fromAt = target; target = nextAt;
    projected = advanceLife(draft, target);
    originalTimingSteps.push({ from: fromAt, to: target, nextAt: projected.nextAt,
      available: projected.available, completed: projected.completed, index: projected.index,
      projectedAnswers: [...projected.draft.answers] });
  }
  if (!projected.available || projected.completed) throw Error('Original life exposed no available choice within the bounded clock walk');
  return { target, originalTimingSteps };
}
export function createFateQaController(env, permanent, seed, initialNow) {
  isolated(env);
  let now = initialNow, sequence = Promise.resolve(), commandInFlight = null;
  const commands = [], attempts = new Map(), fixtureIds = new Set(seed.fixtures.map(row => row.characterId));
  const info = () => ({
    mode: 'manual-development-clock', now, wallTime: Date.now(), debugOnly: true,
    deadlinesUnmodified: true, lifeMs: LIFE_MS, choiceMs: CHOICE_MS,
    nightPause: '00:00-06:00 Asia/Taipei', automaticFateSweep: false,
    method: 'Explicit QA clock plus original Fate.sweep; not natural two-hour waiting'
  });
  const databases = () => ({ permanent: fateDatabaseSnapshot(env.DB.sqlite), season: fateDatabaseSnapshot(env.DB_SEASON.sqlite) });
  const rows = (db, table, order) => db.prepare('SELECT * FROM ' + table + ' ORDER BY ' + order).all();
  const realmSnapshot = db => ({
    lives: rows(db, 'rpg_fate_lives', 'started_at,id'), starts: rows(db, 'rpg_fate_starts', 'account_id,day'),
    memorials: rows(db, 'rpg_fate_memorials', 'char_id,code'), operations: rows(db, 'rpg_fate_operations', 'account_id,request_id'),
    gifts: rows(db, 'rpg_fate_gifts', 'char_id,milestone'), giftOperations: rows(db, 'rpg_fate_gift_operations', 'account_id,request_id'),
    social: rows(db, 'rpg_fate_social_choices', 'id'), ledger: rows(db, 'rpg_ledger', 'event_id'),
    accounts: rows(db, 'rpg_accounts', 'account_tg_id'),
    characters: db.prepare('SELECT tg_id,account_tg_id,name,base_class,level,gold,hp,mp,rev,party_id,idle_state,last_settle_at FROM rpg_characters ORDER BY tg_id').all(),
    inventory: rows(db, 'rpg_inventory', 'tg_id,item'), outbox: rows(db, 'rpg_outbox', 'id'),
    realmIdentity: rows(db, 'rpg_realm_identity', 'singleton')
  });
  function ownedLife(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw Error('Fate QA needs an exact original life ID');
    const row = env.DB.sqlite.prepare('SELECT * FROM rpg_fate_lives WHERE id=?').get(id);
    if (!row || !fixtureIds.has(String(row.char_id))) throw Error('Fate QA only controls its original fixture lives');
    return row;
  }
  function timing(row) {
    const draft = parse(row.state_json);
    const view = advanceLife(draft, now);
    const open = Number.isSafeInteger(view.slots[view.index]) ? view.slots[view.index] : null;
    return {
      lifeId: row.id, status: row.status, rev: row.rev, persistedNextAt: row.next_at,
      index: view.index, available: view.available, opensAt: open,
      deadline: open === null ? null : addActive(open, CHOICE_MS), nextAt: view.nextAt,
      endAt: view.endAt, night: view.night, completedProjection: view.completed,
      activeElapsedMs: Math.min(LIFE_MS, activeBetween(draft.startedAt, now)), persistedAnswers: draft.answers,
      projectedAnswers: view.draft.answers, projectedSources: view.draft.sources
    };
  }
  async function execute(body) {
    isolated(env);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Fate QA command body required');
    const allowed = new Set(['requestId', 'op', 'lifeId', 'index', 'expectedNow']);
    if (Object.keys(body).some(key => !allowed.has(key))) throw Error('Unknown Fate QA command field');
    const requestId = String(body.requestId || '');
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestId)) throw Error('Fate QA requires a stable request ID');
    const signature = JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'requestId').sort(([a], [b]) => a.localeCompare(b))));
    const previous = attempts.get(requestId);
    if (previous) {
      if (previous.signature !== signature) throw Error('Fate QA command ID changed content');
      if (previous.response) return previous.response;
      throw Error('Original QA command did not finish successfully; inspect its retained command record instead of replaying it');
    }
    if (body.expectedNow !== undefined && body.expectedNow !== now) throw Error('Fate QA clock changed since the captured command');
    const before = databases(), from = now, record = { requestId, signature, input: body, from, state: 'started', before, recordedAt: new Date().toISOString() };
    commands.push(record); attempts.set(requestId, record); commandInFlight = requestId;
    try {
      let result = null, row = null, beforeTiming = null, target = now, originalTimingSteps = [];
      const clockOnly = body.op !== 'sweep';
      if (['choice-open', 'choice-before-deadline', 'choice-deadline', 'before-end', 'end'].includes(body.op)) {
        row = ownedLife(body.lifeId);
        if (row.status !== 'active') throw Error('Original active life required for this clock boundary');
        beforeTiming = timing(row);
        if (body.index !== undefined && body.index !== beforeTiming.index) throw Error('Original life event index changed');
        if (body.op === 'end' || body.op === 'before-end') target = beforeTiming.endAt - (body.op === 'before-end' ? 1 : 0);
        else if (body.op === 'choice-open') {
          // Dynamic lives expose future scenes as they unfold. An unopened
          // choice need not exist in slots yet; only nextAt is authoritative.
          ({ target, originalTimingSteps } = fateQaChoiceBoundary(parse(row.state_json), now));
        } else {
          if (beforeTiming.opensAt === null || beforeTiming.deadline === null) throw Error('Original life has no current choice boundary');
          target = beforeTiming.deadline - (body.op === 'choice-before-deadline' ? 1 : 0);
        }
      } else if (body.op === 'evening') {
        target = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET + 23 * 3600000 + 35 * 60000;
      } else if (body.op === 'midnight') {
        target = (Math.floor((now + OFFSET) / DAY) + 1) * DAY - OFFSET;
      } else if (body.op === 'dawn' || body.op === 'before-dawn') {
        target = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET + 6 * 3600000 - (body.op === 'before-dawn' ? 1 : 0);
      } else if (body.op === 'sweep') {
        const due = env.DB.sqlite.prepare("SELECT id,char_id FROM rpg_fate_lives WHERE status='active' AND next_at<=? ORDER BY next_at").all(now);
        if (due.some(life => !fixtureIds.has(String(life.char_id)))) throw Error('Fate sweep would reach an unowned actor');
        if (body.lifeId) { row = ownedLife(body.lifeId); beforeTiming = timing(row); }
        record.originalDueLives = due;
        result = await Fate.sweep(permanent, now);
      } else throw Error('Unknown Fate QA command');
      if (!Number.isSafeInteger(target) || target < now) throw Error('Fate QA refuses to rewind or invent an invalid clock');
      now = target;
      const after = databases();
      if (clockOnly && JSON.stringify(before) !== JSON.stringify(after)) throw Error('Clock-only command changed gameplay data');
      const response = {
        ok: true, isolated: true, debugOnly: true, productionAccess: false, deadlinesUnmodified: true,
        requestId, op: body.op, lifeId: row?.id || null, from, to: now,
        originalLifeMs: LIFE_MS, originalChoiceMs: CHOICE_MS, clockOnly,
        beforeTiming, originalTimingSteps, afterTiming: row ? timing(ownedLife(row.id)) : null,
        before, after, result, qaClock: info()
      };
      record.state = 'completed'; record.response = response; record.finishedAt = new Date().toISOString();
      return response;
    } catch (error) {
      record.state = 'failed'; record.error = { message: error.message }; record.after = databases(); record.to = now; record.finishedAt = new Date().toISOString();
      throw error;
    } finally { commandInFlight = null; }
  }
  return {
    now: () => now, info,
    snapshot() {
      isolated(env);
      const permanentRows = realmSnapshot(env.DB.sqlite);
      return {
        ok: true, isolated: true, ephemeral: true, productionAccess: false, readOnly: true,
        qaClock: info(), commandInFlight, commands, ...seed, databases: databases(),
        permanent: permanentRows, season: realmSnapshot(env.DB_SEASON.sqlite),
        lifeTiming: permanentRows.lives.map(row => timing(row))
      };
    },
    advance(body) {
      const result = sequence.then(() => execute(body));
      sequence = result.catch(() => {});
      return result;
    }
  };
}
