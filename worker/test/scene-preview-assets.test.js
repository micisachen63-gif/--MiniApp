import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { boundPreviewInputPaths } from '../tools/scene-preview-bindings.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const sourceUrl = new URL('../tools/scene-live-preview.mjs', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8').replace(/^import .*;\r?$/gm, '').replaceAll('import.meta.url', 'sourceUrl');
const publicRoot = path.resolve(path.dirname(fileURLToPath(sourceUrl)), '../public');
const grokRoot = path.resolve(publicRoot, '../../../test-art-root');
const missing = () => Object.assign(Error('fixture asset absent'), { code: 'ENOENT' });

// Run the actual launcher handler with filesystem responses and inert process/listen
// boundaries. No HTTP listener, Atlas process, art files or real previews are started.
async function harness(entries = [], aliases = [], directories = [], environment = {}, extraArgs = [], hooks = {}) {
  const files = new Map(entries.map(([name, body]) => [path.resolve(publicRoot, name), Buffer.from(body)]));
  const links = new Map(aliases.map(([name, target]) => [path.resolve(publicRoot, name), target]));
  const dirs = new Set(directories.map(name => path.resolve(publicRoot, name)));
  const access = [], streams = [], logs = [], signals = new Map(), lifecycle = { created: 0, listening: false, closed: 0, connectionsClosed: 0, exitCalls: 0 };
  let handler;
  const server = { on() {}, listen(_port, _host, callback) { if (hooks.listen) { lifecycle.listening = true; callback(); } }, closeAllConnections() { lifecycle.connectionsClosed++; }, close() { lifecycle.closed++; } };
  const fs = {
    async realpath(value) {
      const file = path.resolve(value);
      if (file === grokRoot) return grokRoot;
      access.push(file);
      if (links.has(file)) return links.get(file);
      if (files.has(file) || dirs.has(file)) return file;
      throw missing();
    },
    async stat(file) {
      if (dirs.has(file)) return { size: 0, isFile: () => false, isDirectory: () => true };
      if (!files.has(file)) throw missing();
      return { size: files.get(file).length, isFile: () => true, isDirectory: () => false };
    },
    async readFile(file) {
      if (!files.has(file)) throw missing();
      return files.get(file);
    },
    async writeFile() { assert.fail('Attach reuse must not write snapshot files'); },
    async mkdir() { assert.fail('Attach reuse must not create snapshot directories'); },
  };
  await vm.runInNewContext('(async()=>{' + source + '\n})()', {
    sourceUrl: sourceUrl.href, URL, path, fileURLToPath, pathToFileURL, fs, createHash, AbortSignal,
    fetch: hooks.fetch || (() => assert.fail('Asset-only tests must not inspect a live API')),
    Math: Object.assign(Object.create(Math), { random() { assert.fail('Attach must not draw RNG'); } }),
    http: { createServer(callback) { lifecycle.created++; handler = callback; return server; } },
    createReadStream(file) {
      streams.push(file);
      return { on() {}, destroy() {}, pipe(res) { res.end(files.get(file)); } };
    },
    spawn() { assert.fail('Asset handling must not start an API process'); },
    process: { pid: 20000, env: environment, argv: ['node', fileURLToPath(sourceUrl), '--grok-root=' + grokRoot, '--port=9703', '--api-port=9702', ...extraArgs], once(signal, callback) { signals.set(signal, callback); }, exit() { lifecycle.exitCalls++; assert.fail('Preflight must finish naturally without process.exit'); } },
    console: { log(value) { logs.push(JSON.parse(value)); }, error(value) { assert.fail(String(value)); } },
  }, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  return {
    access, streams, logs, signals, lifecycle,
    async request(url, method = 'GET') {
      const response = { status: null, headers: {}, body: undefined, headersSent: false,
        writeHead(status, headers = {}) { this.status = status; this.headers = headers; this.headersSent = true; },
        end(body) { this.body = body; }, on() {}, destroy() { assert.fail('Unexpected destroyed response'); } };
      await handler({ url, method }, response);
      return response;
    },
  };
}

test('dedicated button materials resolve only to public and retain GET/HEAD MIME and headers', async () => {
  const fixtures = [['ui/button-materials/frame.webp', 'webp bytes'], ['ui/button-materials/icon.png', 'png bytes'], ['ui/button-materials/buttons.css', 'button{}']];
  const h = await harness(fixtures);
  for (const [file, body] of fixtures) {
    const r = await h.request('/' + file + '?v=button-polish');
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.png') ? 'image/png' : 'image/webp');
    assert.equal(r.headers['Content-Length'], Buffer.byteLength(body));
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(r.body.toString(), body);
  }
  const before = h.streams.length, head = await h.request('/ui/button-materials/frame.webp', 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body, undefined); assert.equal(h.streams.length, before);
  assert.deepEqual(h.access, [...fixtures.map(([file]) => path.resolve(publicRoot, file)), path.resolve(publicRoot, fixtures[0][0])]);
});

test('button material route refuses similar prefixes, decoded traversal, backslashes and NUL before filesystem access', async () => {
  const h = await harness();
  for (const url of [
    '/ui/button-materials', '/ui/button-materials-old/frame.webp', '/ui/other/frame.webp', '/ui/button-materials/../private.webp',
    '/ui/button-materials/%2e%2e%2fprivate.webp', '/ui/button-materials/a%5c..%5cprivate.webp', '/ui/button-materials/%00frame.webp',
  ]) assert.equal((await h.request(url)).status, 404, url);
  assert.equal((await h.request('/ui/button-materials/frame.webp', 'POST')).status, 405);
  assert.deepEqual(h.access, []); assert.deepEqual(h.streams, []);
});

test('missing files, directories and realpaths outside public never fall back to generated art', async () => {
  const escaped = path.resolve(publicRoot, '../private.webp');
  const h = await harness([], [['ui/button-materials/link.webp', escaped]], ['ui/button-materials/folder']);
  for (const name of ['missing.webp', 'link.webp', 'folder']) assert.equal((await h.request('/ui/button-materials/' + name)).status, 404, name);
  assert.deepEqual(h.access, ['missing.webp', 'link.webp', 'folder'].map(name => path.resolve(publicRoot, 'ui/button-materials', name)));
  assert.deepEqual(h.streams, []);
});

test('Fate story modules and original reward/ending artwork resolve only to public', async () => {
  const fixtures = [
    ['scene-fate-story.js', 'canonical story adapter'],
    ['fate/life.js', 'original life module'],
    ['fate/country-packs-v9/jp.js', 'original country module'],
    ['art/fate-taiwan-v8/taipei-dusk.webp', 'original Taipei art'],
    ['art/fate-countries-v9/jp-memory.webp', 'original country art'],
    ['art/fate-ending-20261016/ending.webp', 'original ending art'],
    ['art/ui/command-collect-20261012.webp', 'original archive art'],
    ['art/items-scrolls-pink-20261018/guaranteed_scroll_w.webp', 'original rare reward'],
    ['art/items-scrolls-cutout-20261011/scroll_a.webp', 'original ordinary reward'],
  ];
  const h = await harness(fixtures);
  for (const [file, body] of fixtures) {
    const r = await h.request('/' + file);
    assert.equal(r.status, 200, file);
    assert.equal(r.body.toString(), body);
    assert.equal(r.headers['Content-Type'], file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'image/webp');
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  }
  const before = h.streams.length, head = await h.request('/fate/life.js', 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body, undefined); assert.equal(h.streams.length, before);
});

test('Fate preview refuses old app, similar prefixes, traversal and public realpath escapes', async () => {
  const h = await harness([], [['fate/link.js', path.resolve(publicRoot, '../private.js')]]);
  for (const url of [
    '/scene-fate-story.js/extra', '/scene-fate-story.css', '/scene-fate-story-old.js',
    '/fate/app.js', '/fate-old/life.js', '/fate/life.json', '/fate/other/sub.js',
    '/fate/%2e%2e%2fprivate.js', '/fate/a%5c..%5cprivate.js', '/fate/%00life.js',
    '/art/fate-countries-v9-old/jp-memory.webp', '/art/items-scrolls-pink-20261018/other.webp',
  ]) assert.equal((await h.request(url)).status, 404, url);
  assert.deepEqual(h.access, []);
  assert.equal((await h.request('/fate/link.js')).status, 404);
  assert.deepEqual(h.access, [path.resolve(publicRoot, 'fate/link.js')]);
  assert.deepEqual(h.streams, []);
});

test('Fate input pinning requires its explicit snapshot argument and cannot share Guardian mode', async () => {
  await assert.rejects(harness([], [], [], { RPG_FATE_QA: '1' }), /requires explicit --qa-input-snapshot-dir/);
  await assert.rejects(harness([], [], [], { RPG_FATE_QA: '1', RPG_GUARDIAN_QA: '1' }), /Only one isolated QA fixture/);
});

test('Existing Fate API attach requires exact isolated intent and immutable reuse flags', async () => {
  const complete=['--attach-api-pid=44296','--qa-attach-state=.release-sync/preserve.json','--qa-reuse-input-snapshot-dir=.release-sync/original'];
  await assert.rejects(harness([],[],[],{},complete),/Existing API attach requires Fate-only/);
  await assert.rejects(harness([],[],[],{RPG_FATE_QA:'1'},['--qa-reuse-input-snapshot-dir=.release-sync/original']),/Existing API attach requires Fate-only/);
  await assert.rejects(harness([],[],[],{RPG_FATE_QA:'1'},[...complete,'--qa-input-snapshot-dir=.release-sync/new']),/Capture and reuse are mutually exclusive/);
  await assert.rejects(harness([],[],[],{RPG_FATE_QA:'1'},complete.map(arg=>arg.startsWith('--attach-api-pid=')?'--attach-api-pid=0':arg)),/Invalid expected isolated API PID/);
  await assert.rejects(harness([],[],[],{RPG_FATE_QA:'1',RPG_BOSS_QA:'1'},complete),/forbids other QA modes/);
});


const sha = value => createHash('sha256').update(value).digest('hex');
const fateTables = [
  'rpg_fate_lives', 'rpg_fate_starts', 'rpg_fate_memorials', 'rpg_fate_operations',
  'rpg_fate_gifts', 'rpg_fate_gift_operations', 'rpg_fate_profiles', 'rpg_fate_daily',
  'rpg_fate_social_choices', 'rpg_fate_social_limits', 'rpg_fate_social_locks',
  'rpg_fate_social_operations', 'rpg_fate_social_pairs', 'rpg_fate_social_preferences',
];
const rawOutcomeKeys = ['lives', 'starts', 'memorials', 'operations', 'gifts', 'giftOperations', 'social'];
function emptyFateState() {
  const primary = { accountId: '90101', characterId: 'unit-primary', realmId: 'permanent' };
  const alternate = { accountId: '90101', characterId: 'unit-alternate', realmId: 'permanent' };
  const seasonActor = { accountId: '90101', characterId: 'unit-season', realmId: 'season_2026_01' };
  const raw = () => ({ ...Object.fromEntries(rawOutcomeKeys.map(key => [key, []])),
    ledger: [{ event_id: 'character:unit', type: '初始角色' }], accounts: [{ active_char_id: 'unit-primary' }],
    characters: [], inventory: [], outbox: [], realmIdentity: [{ realm_id: 'unit-realm' }] });
  const database = () => ({ sha256: sha('unit-empty-db'), tableNames: [...fateTables, 'rpg_ledger'],
    tableHashes: Object.fromEntries(fateTables.map(name => [name, sha('[]')])),
    counts: { ...Object.fromEntries(fateTables.map(name => [name, 0])), rpg_ledger: 1 }, totalChanges: 11, outboxHash: sha('[]') });
  return {
    ok: true, schemaVersion: 1, isolated: true, ephemeral: true, productionAccess: false, readOnly: true,
    primary, alternate, fixtures: [primary, alternate], seasonFixtures: [seasonActor], seededAt: 1793829600000,
    syntheticInitialInputOnly: true, noSeededLifeGiftOrReceipt: true, noDispatcher: true, realNotificationsSent: false,
    initialInputs: { fixtureOnly: true, notAReceipt: true }, initialInputSha256: sha('unit-initial-inputs'),
    initialOutcomeCounts: { permanent: Object.fromEntries(fateTables.map(name => [name, 0])), season: Object.fromEntries(fateTables.map(name => [name, 0])) },
    qaClock: { mode: 'manual-development-clock', now: 1793829600000, wallTime: 1, debugOnly: true,
      lifeMs: 7200000, choiceMs: 90000, automaticFateSweep: false, deadlinesUnmodified: true, nightPause: '00:00-06:00 Asia/Taipei' },
    commandInFlight: null, commands: [], lifeTiming: [], membershipChecks: [],
    databases: { permanent: database(), season: database() }, permanent: raw(), season: raw(),
  };
}

// These are in-memory unit inputs, never a saved campaign fixture or fabricated
// browser result. The actual launcher imports its real, pure nine-path binder.
function attachFixture(options = {}) {
  const state = emptyFateState();
  if(options.private){
    const digestId='d'.repeat(32);state.noSeededPrivateOrBattleOutcomes=true;
    state.privacy={digestId,secretPersisted:false,restorableBackup:false,privateRowsExposed:false,forbiddenCopies:[]};
    for(const realm of ['permanent','season']){const db=state.databases[realm];Object.assign(db,{digestAlgorithm:'HMAC-SHA-256',digestId,secretPersisted:false,restorableBackup:false});for(const name of ['rpg_boss_instances','rpg_boss_attacks','rpg_parties','rpg_party_members','rpg_party_operations']){db.tableNames.push(name);db.counts[name]=0;db.tableHashes[name]=sha('unit-empty:'+name);}Object.assign(state[realm],{profiles:[],daily:[],bosses:[],parties:[],members:[]});}
  }
  if (options.resume) {
    state.permanent.lives.push({ id: 'unit-existing-life', char_id: state.primary.characterId, account_id: state.primary.accountId });
    state.permanent.operations.push({ request_id: 'scene:app:unit-start-request', account_id: state.primary.accountId, result_json: JSON.stringify({ lifeId: 'unit-existing-life' }) });
    state.databases.permanent.counts.rpg_fate_lives = 1;
    state.databases.permanent.counts.rpg_fate_operations = 1;
    state.qaClock.now += 100;
    state.commands.push({ requestId: 'unit-previous-command' });
  }
  options.state?.(state);
  const root = path.resolve(publicRoot, '../..'), evidenceRoot = path.join(root, '.release-sync');
  const snapshotRoot = path.join(evidenceRoot, 'unit-fate-inputs'), statePath = path.join(evidenceRoot, 'unit-fate-preserve.json');
  const rawRoot = path.join(snapshotRoot, 'raw'), boundRoot = path.join(snapshotRoot, 'bound');
  const binderPath = fileURLToPath(new URL('../tools/scene-preview-bindings.mjs', import.meta.url));
  const binder = readFileSync(binderPath), binderSha256 = sha(binder);
  const files = new Map([[binderPath, binder]]);
  const sources = boundPreviewInputPaths().map(entry => {
    const raw = Buffer.from('unit raw ' + entry.requestPath), bound = Buffer.from('unit bound ' + entry.requestPath);
    files.set(path.join(rawRoot, entry.relativePath), raw);
    files.set(path.join(boundRoot, entry.requestPath.slice(1)), bound);
    return { ...entry, sha256: sha(raw), bytes: raw.length, boundSha256: sha(bound), boundBytes: bound.length };
  });
  const id = sha(JSON.stringify({ binderSha256, sources: sources.map(({ requestPath, relativePath, sha256, boundSha256 }) => ({ requestPath, relativePath, sha256, boundSha256 })) }));
  const manifest = { schemaVersion: 1, status: 'passed', sourceCount: 9, sources, binderSha256,
    sourceRootWritten: false, changed: [], bindingErrors: [], id, scope: 'in-memory unit test only' };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  files.set(path.join(snapshotRoot, 'manifest.json'), manifestBytes);
  const intent = { schemaVersion: 1, status: options.resume ? 'preserve-exact-fate-api' : 'preserve-empty-fate-api',
    apiPid: 12345, apiOrigin: 'http://127.0.0.1:9702', inputSnapshotId: id,
    inputSnapshotManifestSha256: sha(manifestBytes), state: structuredClone(state) };
  if (options.resume) intent.originalLife = { id: 'unit-existing-life', startRequestId: 'unit-start-request',
    accountId: state.primary.accountId, characterId: state.primary.characterId, realmId: 'permanent' };
  else Object.assign(intent, { kind: 'empty-fate-campaign', campaignId: 'f1-fresh-02', initialInputSha256: state.initialInputSha256 });
  if(options.private)Object.assign(intent,{status:'preserve-empty-fate-private-api',kind:'empty-fate-private-campaign',campaignId:'f2-private-unit'});
  options.intent?.(intent);
  files.set(statePath, Buffer.from(JSON.stringify(intent)));
  options.files?.(files, { rawRoot, boundRoot, snapshotRoot, sources });
  const health = { pid: 12345, isolated: true, ephemeral: true, productionAccess: false,
    fateQa: true, guardianQa: false, starRingQa: false, bossQa: false, towerQa: false, partyQa: false, skillCareerQa: false,
    qaClock: structuredClone(state.qaClock) };
  if(options.private)Object.assign(health,{fateQa:false,fatePrivateQa:true});
  options.health?.(health);
  const calls = [];
  let reads = 0;
  return {
    state, intent, calls,
    async run() {
      return harness([...files], [], [evidenceRoot, snapshotRoot, rawRoot, boundRoot], options.private?{RPG_FATE_PRIVATE_QA:'1'}:{ RPG_FATE_QA: '1' },
        ['--attach-api-pid=12345', '--qa-attach-state=' + statePath, '--qa-reuse-input-snapshot-dir=' + snapshotRoot,
          ...(options.check ? ['--qa-attach-check=1'] : [])], {
          listen: !!options.listen,
          async fetch(url, init) {
            calls.push({ url, method: init.method || 'GET', redirect: init.redirect });
            assert.equal(new URL(url).origin, 'http://127.0.0.1:9702');
            assert.equal(init.redirect, 'error');
            assert.equal(init.method, undefined);
            let value;
            if (url.endsWith('/__preview/health')) value = structuredClone(health);
            else {
              assert.ok(url.endsWith(options.private?'/__preview/fate-private-qa/state':'/__preview/fate-qa/state'));
              value = structuredClone(state); value.qaClock.wallTime += ++reads;
              if (reads === 1) options.live?.(value);
              else options.after?.(value);
            }
            return { status: 200, json: async () => value };
          },
        });
    },
  };
}

test('explicit empty campaign reuses all nine inputs and attaches without owning or starting API', async () => {
  const fixture = attachFixture({ listen: true }), h = await fixture.run();
  const health = JSON.parse((await h.request('/__preview/health')).body);
  assert.equal(health.apiPid, 12345); assert.equal(health.apiOwned, false); assert.equal(health.attachedApi, true);
  assert.equal(health.apiReady, true); assert.equal(health.attachKind, 'empty-fate-campaign'); assert.equal(health.campaignId, 'f1-fresh-02');
  assert.equal(health.generatedInputSnapshot.reused, true); assert.equal(health.generatedInputSnapshot.id, fixture.intent.inputSnapshotId);
  assert.equal(h.logs[0].apiOwned, false); assert.equal(h.logs[0].campaignId, 'f1-fresh-02');
  assert.equal(fixture.calls.length, 3); assert.ok(fixture.calls.every(call => call.method === 'GET'));
  h.signals.get('SIGTERM')();
  assert.equal(h.lifecycle.closed, 1); assert.equal(h.lifecycle.connectionsClosed, 1);
  assert.equal(h.lifecycle.exitCalls, 0);
});

test('empty attach read-only preflight completes naturally without creating a server or process exit', async () => {
  const fixture = attachFixture({ check: true, listen: true }), h = await fixture.run();
  assert.equal(h.lifecycle.created, 0); assert.equal(h.lifecycle.listening, false);
  assert.equal(h.lifecycle.exitCalls, 0); assert.equal(h.signals.size, 0);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].kind, 'empty-fate-campaign'); assert.equal(h.logs[0].campaignId, 'f1-fresh-02');
  assert.equal(h.logs[0].originalLifeId, null);
  for (const key of ['apiSpawned', 'apiKilled', 'snapshotWritten']) assert.equal(h.logs[0][key], false);
});

test('existing nonempty resume still requires the exact original life and original start operation', async () => {
  const accepted = attachFixture({ resume: true, check: true }), h = await accepted.run();
  assert.equal(h.logs[0].originalLifeId, 'unit-existing-life');
  assert.equal(h.logs[0].kind, 'preserve-exact-fate-api');
  for (const change of [
    intent => { delete intent.originalLife; },
    intent => { intent.originalLife = null; },
    intent => { intent.originalLife.id = 'different-life'; },
    intent => { intent.originalLife.accountId = 'different-account'; },
    intent => { intent.originalLife.characterId = 'different-character'; },
    intent => { intent.originalLife.startRequestId = 'different-start'; },
  ]) await assert.rejects(attachFixture({ resume: true, intent: change }).run(), /original Fate API preservation intent|exact original start authority/);
});

test('empty intent cannot be inferred from a missing life, unknown kind, mixed resume fields or weak campaign identity', async () => {
  for (const change of [
    intent => { delete intent.kind; },
    intent => { intent.kind = 'empty'; },
    intent => { intent.originalLife = null; },
    intent => { intent.originalLife = {}; },
    intent => { delete intent.campaignId; },
    intent => { intent.campaignId = '../f1-fresh-02'; },
    intent => { intent.status = 'preserve-exact-fate-api'; },
    intent => { delete intent.initialInputSha256; },
    intent => { intent.initialInputSha256 = 'a'.repeat(64); },
    intent => { intent.apiPid++; },
  ]) {
    const fixture = attachFixture({ intent: change });
    await assert.rejects(fixture.run(), /preservation intent|preservation kind|empty Fate campaign intent|API identity/);
    assert.equal(fixture.calls.length, 0);
  }
});

test('empty bootstrap rejects every original raw outcome in both realms even when initial counts claim zero', async () => {
  for (const realm of ['permanent', 'season']) for (const key of rawOutcomeKeys) {
    const fixture = attachFixture({ state(value) { value[realm][key].push({ id: 'unit-existing-outcome' }); } });
    await assert.rejects(fixture.run(), /already has original/);
    assert.equal(fixture.calls.length, 0, realm + ':' + key);
  }
});

test('empty bootstrap rejects each nonzero or missing Fate table and future unknown Fate rows', async () => {
  for (const realm of ['permanent', 'season']) for (const table of fateTables) {
    await assert.rejects(attachFixture({ state(value) { value.databases[realm].counts[table] = 1; } }).run(), /nonempty or missing/);
  }
  await assert.rejects(attachFixture({ state(value) { delete value.databases.permanent.counts.rpg_fate_social_locks; } }).run(), /nonempty or missing/);
  await assert.rejects(attachFixture({ state(value) { value.databases.season.counts.rpg_fate_future_outcome = 1; } }).run(), /nonempty or missing/);
});

test('empty bootstrap rejects orphan typed receipts, original gift ledger and Fate delivery rows in either realm', async () => {
  for (const realm of ['permanent', 'season']) {
    for (const row of [{ event_id: 'unit', type: '命運場景操作收據' }, { event_id: 'fate-scene-receipt:unit', type: 'other' },
      { event_id: 'unit', type: '輪迴贈禮' }, { event_id: 'fate-gift:open:unit', type: 'other' }]) {
      await assert.rejects(attachFixture({ state(value) { value[realm].ledger.push(row); } }).run(), /Fate receipts/);
    }
    for (const kind of ['fate_event', 'fate_social', 'fate_cast']) {
      await assert.rejects(attachFixture({ state(value) { value[realm].outbox.push({ kind }); } }).run(), /Fate delivery rows/);
    }
  }
});

test('empty bootstrap requires initial clock and command history plus explicit synthetic-only no-send inputs', async () => {
  for (const change of [
    value => { value.commands.push({ requestId: 'already-used' }); },
    value => { value.commandInFlight = 'in-progress'; },
    value => { value.lifeTiming.push({ lifeId: 'old' }); },
    value => { value.qaClock.now++; },
    value => { value.qaClock.automaticFateSweep = true; },
    value => { value.qaClock.lifeMs = 1; },
    value => { value.syntheticInitialInputOnly = false; },
    value => { value.noSeededLifeGiftOrReceipt = false; },
    value => { value.noDispatcher = false; },
    value => { value.realNotificationsSent = true; },
    value => { value.initialInputs.notAReceipt = false; },
    value => { value.seasonFixtures = []; },
  ]) await assert.rejects(attachFixture({ state: change }).run(), /initial inputs and clock|original timing|exact fixture actors/);
});

test('attach binds expected PID, isolated Fate-only health and original clock without accepting another API', async () => {
  for (const change of [
    health => { health.pid++; },
    health => { health.productionAccess = true; },
    health => { health.isolated = false; },
    health => { health.fateQa = false; },
    health => { health.guardianQa = true; },
    health => { health.qaClock.choiceMs = 1; },
    health => { health.qaClock.now++; },
  ]) await assert.rejects(attachFixture({ health: change }).run(), /identity or isolation|original Fate timing|clock changed/);
});

test('attach refuses changed actors, DB, raw rows and clock before or during snapshot validation', async () => {
  for (const phase of ['live', 'after']) for (const change of [
    value => { value.primary.characterId = 'other-actor'; },
    value => { value.databases.season.totalChanges++; },
    value => { value.permanent.lives.push({ id: 'new-life' }); },
    value => { value.qaClock.now++; },
    value => { value.commands.push({ requestId: 'new-command' }); },
  ]) await assert.rejects(attachFixture({ [phase]: change }).run(), /fixture, actors|changed during read-only/);
});

test('attach refuses snapshot identity or captured raw/bound byte changes without recreating files', async () => {
  await assert.rejects(attachFixture({ intent(value) { value.inputSnapshotId = 'changed'; } }).run(), /Snapshot differs/);
  await assert.rejects(attachFixture({ intent(value) { value.inputSnapshotManifestSha256 = 'changed'; } }).run(), /Snapshot differs/);
  for (const side of ['rawRoot', 'boundRoot']) {
    await assert.rejects(attachFixture({ files(files, data) {
      const entry = data.sources[0], relative = side === 'rawRoot' ? entry.relativePath : entry.requestPath.slice(1);
      files.set(path.join(data[side], relative), Buffer.from('changed bytes'));
    } }).run(), /captured source or bound snapshot bytes changed/);
  }
});


test('private Fate preview requires independent attachment and rejects mixed fixture or capture modes', async () => {
  await assert.rejects(harness([], [], [], { RPG_FATE_PRIVATE_QA: '1' }), /requires explicit --qa-input-snapshot-dir/);
  await assert.rejects(harness([], [], [], { RPG_FATE_PRIVATE_QA: '1' }, ['--qa-input-snapshot-dir=.release-sync/private']), /independently owned API/);
  await assert.rejects(harness([], [], [], { RPG_FATE_PRIVATE_QA: '1', RPG_FATE_QA: '1' }), /Only one isolated QA fixture/);
  await assert.rejects(harness([], [], [], {}, ['--qa-capture-only=1']), /Private input capture requires/);
  await assert.rejects(harness([], [], [], { RPG_FATE_PRIVATE_QA: '1' }, ['--qa-capture-only=0']), /Private input capture requires/);
});

test('private Fate empty API reuses its original HMAC identity without owning the API or revealing data', async () => {
  const fixture = attachFixture({ private: true, listen: true }), h = await fixture.run();
  const health = JSON.parse((await h.request('/__preview/health')).body);
  assert.equal(health.apiOwned, false); assert.equal(health.attachedApi, true);
  assert.equal(health.attachKind, 'empty-fate-private-campaign'); assert.equal(health.campaignId, 'f2-private-unit');
  assert.equal(fixture.calls.filter(c => c.url.endsWith('/__preview/fate-private-qa/state')).length, 2);
  assert.equal(h.lifecycle.created, 1); assert.equal(h.lifecycle.listening, true);
  h.signals.get('SIGTERM')();
  assert.equal(h.lifecycle.closed, 1);
});

test('private Fate attach preflight is read-only and completes naturally before any listener', async () => {
  const h = await attachFixture({ private: true, check: true }).run();
  assert.equal(h.lifecycle.created, 0); assert.equal(h.lifecycle.exitCalls, 0);
  assert.equal(h.logs[0].kind, 'empty-fate-private-campaign');
  assert.equal(h.logs[0].apiSpawned, false); assert.equal(h.logs[0].apiKilled, false);
  assert.equal(h.logs[0].snapshotWritten, false);
});

test('private Fate attach refuses missing privacy proof, new digest identity, seeded battle and unsafe metadata', async () => {
  for (const change of [
    state => { delete state.privacy; },
    state => { state.privacy.secretPersisted = true; },
    state => { state.privacy.privateRowsExposed = true; },
    state => { state.privacy.restorableBackup = true; },
    state => { state.privacy.forbiddenCopies = ['permanent']; },
    state => { state.noSeededPrivateOrBattleOutcomes = false; },
    state => { state.databases.permanent.digestAlgorithm = 'SHA-256'; },
    state => { state.databases.season.digestId = 'e'.repeat(32); },
    state => { state.databases.permanent.counts.rpg_boss_instances = 1; },
    state => { state.databases.season.counts.rpg_parties = 1; },
    state => { state.permanent.ledger.push({ type: '命運私人操作收據' }); },
  ]) await assert.rejects(attachFixture({ private: true, state: change }).run(), /privacy evidence|already has|digest identity/);
  await assert.rejects(attachFixture({ private: true, live: state => { state.privacy.digestId = 'f'.repeat(32); } }).run(), /fixture, actors, both databases/);
  await assert.rejects(attachFixture({ private: true, after: state => { state.databases.permanent.tableHashes.rpg_fate_profiles = sha('different-private-input'); } }).run(), /changed during/);
});

test('private Fate root assets resolve to product modules and keep original places under the published module route', async () => {
  const entries = [['scene-fate-private-ui.js', 'export const privateUI=true;'], ['scene-fate-private-ui.css', '.private{}'], ['fate/places.js', 'export const places=[];']];
  const h = await harness(entries);
  for (const [name, body] of entries) {
    const result = await h.request('/' + name);
    assert.equal(result.status, 200); assert.equal(result.body.toString(), body);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
  for (const name of ['/scene-fate-private-ui.js/other', '/scene-fate-private-ui.json', '/fate/app.js']) assert.equal((await h.request(name)).status, 404);
});


test('exchange client and published catalog serve owned GET/HEAD bytes without a path escape', async () => {
  const binder=readFileSync(new URL('../tools/scene-preview-bindings.mjs',import.meta.url),'utf8');
  const prefix='/ui-generated-20261030/hud-angels-20261102/';
  const modules=[['scene-exchange-client.js','action client bytes'],['monster-expansion-catalog.js','published catalog bytes'],['scene-direct-trade-ui.js','direct trade read client bytes'],['scene-direct-trade-client.js','direct trade intent client bytes'],['scene-direct-trade-invitation-client.js','direct trade invitation recovery client bytes']];
  const h=await harness([...modules,['../tools/scene-preview-bindings.mjs',binder]]);
  for(const [name,bytes]of modules){
    const response=await h.request(prefix+name);
    assert.equal(response.status,200);assert.equal(response.body.toString(),bytes);
    assert.equal(response.headers['Content-Type'],'text/javascript; charset=utf-8');
    assert.equal(response.headers['Cache-Control'],'no-store');
    const head=await h.request(prefix+name,'HEAD');
    assert.equal(head.status,200);assert.equal(head.body,undefined);
    assert.equal((await h.request(prefix+name+'/other')).status,404);
  }
  for(const url of [prefix+'%2e%2e%2fprivate.js',prefix+'a%5c..%5cprivate.js'])
    assert.equal((await h.request(url)).status,404);
});

function exchangeAttachFixture(options={}) {
  const repo=path.resolve(publicRoot,'../..'),evidence=path.join(repo,'.release-sync');
  const statePath=path.join(evidence,'unit-exchange-preserve.json');
  const ownerPath=path.resolve(repo,'../../handoff/non-character',path.basename(repo).replace(/^star-journal-/,''),'OWNER.json');
  const owner={schemaVersion:1,status:'active',session:'unit-exchange-actions-owner',worktree:repo};
  const ownerBody=JSON.stringify(owner);
  const sources=['worker/tools/atlas-local-preview.mjs','worker/tools/exchange-actions-qa-fixture.mjs',
    'worker/tools/scene-live-preview.mjs','worker/tools/scene-preview-bindings.mjs'].map(name=>({path:name,body:'unit-bound-source:'+name}));
  const state={ok:true,schemaVersion:1,synthetic:true,isolated:true,ephemeral:true,productionAccess:false,
    noDispatcher:true,realNotificationsSent:false,
    seed:{setupNotAcceptance:true,manifestSha256:sha('original-setup')},
    databases:{permanent:{sha256:sha('original-permanent'),totalChanges:17},season:{sha256:sha('original-season'),totalChanges:8}},
    permanent:{operations:[{requestId:'original-operation'}]},season:{operations:[]}};
  const intent={schemaVersion:1,status:'preserve-exact-exchange-actions-api',kind:'preserve-exchange-actions-api',
    campaignId:'unit-exchange-campaign',apiPid:31000,apiOrigin:'http://127.0.0.1:9702',state:structuredClone(state),
    ownerSession:owner.session,ownerSha256:sha(ownerBody),
    sourceBindings:sources.map(row=>({path:row.path,bytes:Buffer.byteLength(row.body),sha256:sha(row.body)}))};
  options.intent?.(intent);options.owner?.(owner);options.sources?.(sources);
  const entries=[[path.relative(publicRoot,statePath),JSON.stringify(intent)],
    [path.relative(publicRoot,ownerPath),JSON.stringify(owner)],
    ...sources.map(row=>[path.relative(publicRoot,path.join(repo,row.path)),row.body])];
  const health={pid:31000,isolated:true,ephemeral:true,productionAccess:false,
    exchangeActionsQa:true,exchangeQa:false,ledgerQa:true,skillCareerQa:true,
    guardianQa:false,starRingQa:false,bossQa:false,towerQa:false,partyQa:false,fateQa:false,fatePrivateQa:false,
    exchangeActionsQaPolicy:{backgroundTimersDisabled:{atlas:true,workshop:true,party:true}}};
  options.health?.(health);
  const calls=[];let reads=0;
  const args=['--attach-api-pid=31000','--qa-attach-state=.release-sync/unit-exchange-preserve.json',...(options.check?['--qa-attach-check=1']:[])];
  return {calls,run:()=>harness(entries,[],[path.relative(publicRoot,evidence)],
    {RPG_EXCHANGE_ACTIONS_QA:'1',RPG_LEDGER_QA:'1',RPG_SKILL_CAREER_QA:'1'},args,
    {listen:options.listen,fetch:async(url,init={})=>{
      calls.push({url,method:init.method||'GET'});
      if(url.endsWith('/__preview/health'))return {status:200,json:async()=>structuredClone(health)};
      assert.equal(url,'http://127.0.0.1:9702/__preview/exchange-actions-state');
      const copy=structuredClone(state);reads++;
      if(reads===1)options.live?.(copy);else options.after?.(copy);
      return {status:200,json:async()=>copy};
    }})};
}

test('exchange action UI attaches only the source/owner/state-bound API and closes without owning its process',async()=>{
  const fixture=exchangeAttachFixture({listen:true}),h=await fixture.run();
  assert.equal(h.lifecycle.created,1);assert.equal(h.lifecycle.listening,true);
  assert.equal(fixture.calls.length,3);assert(fixture.calls.every(row=>row.method==='GET'));
  const health=JSON.parse((await h.request('/__preview/health')).body);
  assert.equal(health.apiPid,31000);assert.equal(health.apiOwned,false);assert.equal(health.attachedApi,true);
  assert.equal(health.attachKind,'preserve-exchange-actions-api');
  h.signals.get('SIGTERM')();
  assert.equal(h.lifecycle.closed,1);assert.equal(h.lifecycle.connectionsClosed,1);
  assert.equal(fixture.calls.length,3,'closing the UI performs no API request or replacement');
});

test('exchange action attachment preflight starts no listener, owns no signals, and performs only reads',async()=>{
  const fixture=exchangeAttachFixture({check:true,listen:true}),h=await fixture.run();
  assert.equal(h.lifecycle.created,0);assert.equal(h.lifecycle.listening,false);assert.equal(h.signals.size,0);
  assert.equal(h.lifecycle.exitCalls,0);assert.equal(fixture.calls.length,3);
  assert.equal(h.logs.at(-1).readOnlyPreflight,true);assert.equal(h.logs.at(-1).apiSpawned,false);assert.equal(h.logs.at(-1).apiKilled,false);
});

test('exchange action attachment refuses missing intent, mixed modes, owner/source changes and database drift',async()=>{
  await assert.rejects(harness([],[],[],{RPG_EXCHANGE_ACTIONS_QA:'1',RPG_LEDGER_QA:'1',RPG_SKILL_CAREER_QA:'1'}),/independently owned API/);
  await assert.rejects(harness([],[],[],{RPG_EXCHANGE_ACTIONS_QA:'1',RPG_FATE_QA:'1'}),/Only one isolated QA fixture/);
  for(const options of [
    {intent:value=>{value.ownerSession='another-writer';}},
    {owner:value=>{value.status='completed';}},
    {sources:value=>{value[0].body+='changed';}},
    {intent:value=>{value.sourceBindings.pop();}},
    {health:value=>{value.pid=31001;}},
    {health:value=>{value.exchangeActionsQaPolicy.backgroundTimersDisabled.atlas=false;}},
    {live:value=>{value.databases.permanent.totalChanges++;}},
    {after:value=>{value.season.operations.push({requestId:'late-write'});}},
  ])await assert.rejects(exchangeAttachFixture(options).run(),/owner changed|source changed|required source binding|identity or isolation|complete databases changed/);
});

test('endgame painted maps and aura assets use an explicit no-I/O startup allowlist and reject unknown chapters',async()=>{
 const fixtures=[['art/endgame-v1/elite-01-v1.png','painted map'],['art/endgame-v1/hell-aura-v1.png','painted aura'],['awakening-vfx-live.mjs','live module']];const h=await harness(fixtures);
 assert.equal(h.access.length,0,'module evaluation cannot enumerate an asset directory');
 for(const [file,body]of fixtures){for(const method of ['GET','HEAD']){const r=await h.request('/'+file,method);assert.equal(r.status,200);if(method==='HEAD')assert.equal(r.body,undefined);else assert.deepEqual(r.body,Buffer.from(body));}}
 const before=h.access.length;assert.equal((await h.request('/art/endgame-v1/hell-13-v1.png')).status,404);assert.equal(h.access.length,before);
});

test('original library and ritual art stay on the exact no-I/O allowlist with correct media types',async()=>{
 const fixtures=[['scene-library-art.json','{}'],['guardian-worldtree.js','native original'],['art/guardian-scene-20261014/archangel-loop-alpha.webm','alpha-video'],['art/v2/mon_moon_hare.webp','original-monster']];
 const h=await harness(fixtures);assert.equal(h.access.length,0,'starting a preview cannot read or enumerate original assets');
 for(const [file,body] of fixtures)for(const method of ['GET','HEAD']){const r=await h.request('/'+file,method);assert.equal(r.status,200,file);assert.deepEqual(r.body,method==='HEAD'?undefined:Buffer.from(body));if(file.endsWith('.webm'))assert.equal(r.headers['Content-Type'],'video/webm');}
 for(const file of ['/scene-library-art.json.other','/art/monsters-clean-20261011/unpublished.png','/art/monsters-clean-20261011/%2e%2e/secret.png']){const before=h.access.length;assert.equal((await h.request(file)).status,404);assert.equal(h.access.length,before,'unlisted path must fail before I/O');}
});
