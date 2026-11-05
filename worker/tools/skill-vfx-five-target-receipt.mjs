// Isolated committed-receipt fixture for Canvas replay, not a five-target MiniApp UI test.
// Uses only fresh SQLite and the existing Atlas services/catalog; never opens a server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { freshDb } from '../test/d1-shim.js';
import { T0 } from '../test/helpers.js';
import { mulberry32 } from '../src/game/rng.js';
import { computeStats } from '../src/game/stats.js';
import { POTIONS } from '../src/game/constants.js';
import { createAtlasRun, advanceAtlasRun } from '../src/game/atlas-engine.js';
import { loadPlayer } from '../src/db.js';
import { readAtlasTalents } from '../src/services/atlas-talents.js';
import * as Player from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length > 1 || args.some(value => !value.startsWith('--out='))) {
  throw Error('Use [--out=.release-sync/skill-vfx-targets-20261104/five-target/results.json]');
}
const output = path.resolve(root, args[0]?.slice(6) || '.release-sync/skill-vfx-targets-20261104/five-target/results.json');
const allowedOutput = path.join(root, '.release-sync') + path.sep;
if (!output.startsWith(allowedOutput) || path.extname(output) !== '.json') throw Error('Output must be a JSON receipt under this worktree .release-sync');
if (fs.existsSync(output)) throw Error('Refusing to overwrite an existing receipt; choose a new --out path');
fs.mkdirSync(path.dirname(output), { recursive: true });
const startedAt = new Date().toISOString();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const relative = value => path.relative(root, value).split(path.sep).join('/');
const bytesRecord = value => {
  const bytes = fs.readFileSync(value);
  return { path: relative(value), bytes: bytes.length, sha256: sha256(bytes) };
};
function sourceInputs() {
  const seen = new Set(), queue = [fileURLToPath(import.meta.url)];
  while (queue.length) {
    const filename = queue.pop();
    if (seen.has(filename)) continue;
    seen.add(filename);
    const source = fs.readFileSync(filename, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = path.resolve(path.dirname(filename), match[1]);
      if (!dependency.startsWith(root + path.sep)) throw Error('Unexpected import outside worktree');
      queue.push(dependency);
    }
  }
  for (const filename of fs.readdirSync(path.join(root, 'worker/migrations')).filter(name => name.endsWith('.sql'))) {
    seen.add(path.join(root, 'worker/migrations', filename));
  }
  return [...seen].sort().map(bytesRecord);
}
const sourceFilesBefore = sourceInputs();
const forbiddenFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Network is disabled for the five-target receipt fixture'); };
const env = { DB: freshDb(), ATLAS_ENABLED: 'true', REALM_CONTEXT: { id: 'permanent' } };
const sqlite = env.DB.sqlite;
const clone = value => JSON.parse(JSON.stringify(value));
const prerequisites = ['laurel_intro', 'pillar_intro', 'grove_intro', 'laurel_warden', 'laurel_survey'];
let restoreRandom = () => {};
let evidence;
try {
  const created = await Player.createCharacter(env, {
    tgId: '81995', name: '五目標提交測試', gender: 'f', baseClass: 'mage',
  }, T0, mulberry32(7));
  const characterId = String(created.char.tg_id);
  // All setup is synthetic and confined to the disposable test database.
  // Equipment remains the ordinary real character-creation starter set.
  sqlite.prepare('UPDATE rpg_characters SET level=45,class_path=?,gold=50000,last_settle_at=? WHERE tg_id=?')
    .run('A', T0, characterId);
  for (const item of ['red_1', 'blue_1']) {
    sqlite.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,100) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity')
      .run(characterId, item);
  }
  for (const mapId of prerequisites) {
    sqlite.prepare('INSERT INTO rpg_atlas_progress(char_id,map_id,completions,first_completed_at,last_completed_at) VALUES(?,?,1,?,?)')
      .run(characterId, mapId, T0 - 1000, T0 - 1000);
  }
  let player = await loadPlayer(env.DB, characterId, env);
  const stats = computeStats(player.char, player.equipment.filter(item => item.is_equipped));
  sqlite.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp, stats.maxMp, characterId);
  await Atlas.configure(env, characterId, {
    requestId: 'five-target-configure', buildId: 'mage_chain', supportIds: ['wide'], automation: 'balanced',
  }, T0);
  const ready = await Atlas.status(env, characterId, T0);
  assert.ok(ready.availableMapIds.includes('pillar_survey'), 'Existing map level and unlock checks must pass');
  assert.equal(ready.profile.buildId, 'mage_chain');
  assert.deepEqual(ready.profile.supportIds, ['wide']);
  player = await loadPlayer(env.DB, characterId, env);
  const talents = await readAtlasTalents(env.DB, player.char);
  const fixedRunId = 'f13e0000-0000-4000-8000-000000000005';
  const commitAtMs = T0 + 17000;
  const probeInput = {
    runId: fixedRunId, realmId: 'permanent', startAt: Math.floor(T0 / 1000),
    durationSeconds: 3600, queueMode: 'count', mapCount: 1, mapId: 'pillar_survey',
    buildId: 'mage_chain', supports: ['wide'], automation: 'balanced',
    talentIds: talents.allocatedIds,
    snapshot: {
      ...stats, characterId, baseClass: 'mage', classPath: player.char.class_path,
      hp: stats.maxHp, mp: stats.maxMp,
    },
    supplies: { hp: 20, mp: 20, hpRestore: POTIONS.red_1.heal, mpRestore: POTIONS.blue_1.heal },
  };
  let selected;
  for (let seed = 1; seed <= 4096; seed++) {
    const initial = createAtlasRun({ ...probeInput, seed });
    const observed = advanceAtlasRun(initial, Math.floor(commitAtMs / 1000), { maxSteps: 2000, combatTrace: true });
    const event = observed.combatTrace.events.find(row => row.skillId === 'atlas:mage_chain'
      && new Set(row.targetIds).size === 5 && row.hits.length === 5);
    if (observed.state.content?.roomEncounter?.id === 'ambush' && observed.state.enemies.length === 5 && event) {
      selected = { seed, initial, probe: observed, eventId: event.id ?? null };
      break;
    }
  }
  assert.ok(selected, 'Bounded seed search must find an existing first-room ambush with five actual hit targets');

  // The service owns run creation. Only its random inputs are fixed inside this
  // process; no run state, enemy, event, catalog entry or production API is patched.
  const randomUUIDDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  const randomValuesDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'getRandomValues');
  const originalRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  restoreRandom = () => {
    for (const [name, descriptor] of [['randomUUID', randomUUIDDescriptor], ['getRandomValues', randomValuesDescriptor]]) {
      if (descriptor) Object.defineProperty(globalThis.crypto, name, descriptor);
      else delete globalThis.crypto[name];
    }
  };
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => fixedRunId });
  Object.defineProperty(globalThis.crypto, 'getRandomValues', { configurable: true, value: array => {
    if (array instanceof Uint32Array && array.length === 1) { array[0] = selected.seed; return array; }
    return originalRandomValues(array);
  } });
  try {
    await Atlas.start(env, characterId, {
      requestId: 'five-target-start', mapId: 'pillar_survey', mapCount: 1,
      durationMinutes: 60, supplies: { hp: 20, mp: 20 },
    }, T0);
  } finally { restoreRandom(); restoreRandom = () => {}; }

  const getRun = () => clone(sqlite.prepare('SELECT * FROM rpg_atlas_runs WHERE id=? AND char_id=?').get(fixedRunId, characterId));
  const beforeRun = getRun(), initialState = JSON.parse(beforeRun.state_json);
  assert.deepEqual(initialState, selected.initial, 'The real service must create precisely the deterministic catalog fixture');
  assert.equal(initialState.map.enemy.count, 4);
  assert.equal(initialState.skill.targets, 5, 'The normal server target cap remains five');
  const observerOff = advanceAtlasRun(initialState, Math.floor(commitAtMs / 1000), { maxSteps: 2000 });
  const observerOn = advanceAtlasRun(initialState, Math.floor(commitAtMs / 1000), { maxSteps: 2000, combatTrace: true });
  const { combatTrace: expectedTrace, ...onRules } = observerOn;
  assert.deepEqual(onRules, observerOff, 'Observation cannot change state, rewards, activities, steps or any RNG stream');

  // Hold the genuine run CAS immediately before the SQLite transaction and
  // prove the service has not yet published its response or modified that row.
  const originalBatch = env.DB.batch.bind(env.DB);
  let published = false, releaseCommit, enterCommit;
  const gate = new Promise(resolve => { releaseCommit = resolve; });
  const atCommit = new Promise(resolve => { enterCommit = resolve; });
  let commitCount = 0;
  env.DB.batch = async statements => {
    if (statements.some(statement => /^\s*UPDATE\s+rpg_atlas_runs\s+SET\s+status\s*=/i.test(statement.sql))) {
      commitCount++;
      enterCommit();
      await gate;
    }
    return originalBatch(statements);
  };
  let response, unpublishedBeforeCommit = false, unchangedBeforeCommit = false;
  const pending = Atlas.settle(env, characterId, { runId: fixedRunId }, commitAtMs)
    .then(result => { published = true; return result; });
  // If validation fails before the commit, propagate instead of hanging on gate.
  const arrived = await Promise.race([atCommit.then(() => true), pending.then(() => false)]);
  try {
    assert.equal(arrived, true, 'Real service settlement must reach the run CAS');
    assert.equal(published, false);
    unpublishedBeforeCommit = true;
    assert.deepEqual(getRun(), beforeRun);
    unchangedBeforeCommit = true;
  } finally { releaseCommit(); }
  response = await pending;
  env.DB.batch = originalBatch;
  const afterRun = getRun(), committedState = JSON.parse(afterRun.state_json);
  const trace = response.combatTrace;
  assert.equal(commitCount, 1);
  assert.equal(trace.source, 'committed-combat');
  assert.equal(trace.revision, Number(beforeRun.rev) + 1);
  assert.equal(trace.revision, afterRun.rev);
  assert.equal(trace.committedAtMs, commitAtMs);
  assert.deepEqual(committedState, observerOff.state);
  for (const [key, value] of Object.entries(expectedTrace)) assert.deepEqual(trace[key], value);
  assert.equal(Object.hasOwn(committedState, 'combatTrace'), false);
  assert.equal(Object.hasOwn(committedState, 'combatEvents'), false);
  const eventIndex = trace.events.findIndex(row => row.skillId === 'atlas:mage_chain'
    && new Set(row.targetIds).size === 5 && row.hits.length === 5);
  assert.ok(eventIndex >= 0);
  const selectedEvent = trace.events[eventIndex];
  const targetIds = [...new Set(selectedEvent.targetIds)];
  const enemyIds = committedState.enemies.map(enemy => enemy.id);
  assert.deepEqual([...targetIds].sort(), [...enemyIds].sort());
  assert.equal(new Set(selectedEvent.hits.map(hit => hit.targetId)).size, 5);
  for (const hit of selectedEvent.hits) {
    assert.ok(targetIds.includes(hit.targetId));
    assert.equal(hit.hpBefore - hit.hpAfter, hit.damage);
    assert.ok(hit.damage > 0);
    assert.equal(typeof hit.critical, 'boolean');
  }
  assert.equal(committedState.content.roomEncounter.id, 'ambush');
  const sourceFilesAfter = sourceInputs();
  assert.deepEqual(sourceFilesAfter, sourceFilesBefore, 'All fixture, backend and migration source inputs remain unchanged');
  evidence = {
    schemaVersion: 1, status: 'passed', startedAt, finishedAt: new Date().toISOString(),
    classification: 'isolated-real-SQLite-committed-Atlas-receipt-for-controlled-Canvas-replay',
    limitation: 'This is not full five-target MiniApp UI evidence. The fresh database character and prerequisite clears are synthetic setup; Atlas configure/start/settle, encounter selection, target selection, damage and commit are real unchanged game code.',
    isolated: true, productionAccess: false, networkRequestsAllowed: false,
    fixture: { accountId: '81995', characterId, baseClass: 'mage', classPath: 'A', level: 45,
      seededPrerequisiteMaps: prerequisites, equipment: 'Unmodified ordinary character-creation starter set',
      balanceProfileOverride: null, mapId: 'pillar_survey', encounterId: 'ambush',
      buildId: 'mage_chain', supportIds: ['wide'], catalogBaseEnemies: 4, encounterExtraEnemies: 1,
      serverTargetCap: 5, seed: selected.seed, seedSearch: { first: 1, lastExamined: selected.seed, maximum: 4096 },
      fixtureStartAtMs: T0, committedAtMs: commitAtMs,
    },
    assertions: {
      availableMapPassed: true, serviceCreatedExactProbeState: true,
      stateRewardsActivitiesAndRngEqualWithoutObserver: true,
      unpublishedBeforeCommit, unchangedBeforeCommit, realRunCommitCount: commitCount,
      committedStateEqualsObserverOff: true, sourceInputsUnchanged: true,
      uniqueActualTargetCount: targetIds.length, uniqueActualHitCount: selectedEvent.hits.length,
      actualEnemyIds: enemyIds, selectedEventIndex: eventIndex,
    },
    originalCombatTrace: trace,
    selectedEvent,
    originalServiceResponse: response,
    beforeRun, afterRun,
    observerOff: { ...observerOff, state: undefined, stateSha256: sha256(JSON.stringify(observerOff.state)) },
    sourceFiles: sourceFilesBefore, sourceFilesAfter,
    nodeVersion: process.version,
  };
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({
    status: 'passed', output: relative(output), sha256: bytesRecord(output).sha256,
    seed: selected.seed, targetCount: targetIds.length, targetIds,
    hitCount: selectedEvent.hits.length, commitRevision: afterRun.rev,
    eventIndex, sourceInputCount: sourceFilesBefore.length,
    observerOffIdentical: true, unpublishedBeforeCommit, sourceInputsUnchanged: true,
  }));
} catch (error) {
  const failure = { schemaVersion: 1, status: 'failed', startedAt, finishedAt: new Date().toISOString(),
    error: { name: error.name, message: error.message, stack: error.stack },
    sourceFiles: sourceFilesBefore, sourceFilesAfter: sourceInputs(), nodeVersion: process.version };
  const failurePath = output.replace(/\.json$/, '.failure-' + Date.now() + '.json');
  fs.writeFileSync(failurePath, JSON.stringify(failure, null, 2) + '\n', { flag: 'wx' });
  console.error(JSON.stringify({ status: 'failed', failurePath: relative(failurePath), message: error.message }));
  process.exitCode = 1;
} finally {
  restoreRandom();
  globalThis.fetch = forbiddenFetch;
  sqlite.close();
}
