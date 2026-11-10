/* Fate F2 browser acceptance. Private values stay in process/browser memory.
 * Evidence contains validated public intents/receipts, masked images and the
 * fixture's process-keyed HMAC observations. Mutation cases are claimed once.
 * This file does not create an API, seed outcomes, replay failed cases or send
 * notifications. A root-issued source freeze and campaign authority are required. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const error = code => Object.assign(new Error(code), { code });
function check(condition, code) { if (!condition) throw error(code); }
function same(a, b, code) { check(JSON.stringify(a) === JSON.stringify(b), code); }
function safeFailure(value, stage = 'unknown') {
  const names = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError']);
  const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);
  const networkCode = networkCodes.has(value?.code) ? value.code : networkCodes.has(value?.cause?.code) ? value.cause.code : null;
  return { code: typeof value?.code === 'string' && /^F2QA_[A-Z0-9_]{1,72}$/.test(value.code) ? value.code : 'F2QA_OPERATION_FAILED',
    stage: /^[a-z0-9_-]{1,100}$/.test(stage) ? stage : 'unknown', errorName: names.has(value?.name) ? value.name : 'Error',
    ...(networkCode ? { networkCode } : {}), messageWithheld: true, stackWithheld: true };
}
function loopback(value) {
  const u = new URL(value);
  check(u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password
    && Number.isInteger(Number(u.port)) && Number(u.port) >= 1024, 'F2QA_LOOPBACK_REQUIRED');
  return u.origin;
}
function canonicalJson(value) {
  const stable = v => Array.isArray(v) ? v.map(stable) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return JSON.stringify(stable(value));
}
function samePublic(a, b, code) {
  check(object(a) && object(b) && JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort())
    && canonicalJson(a) === canonicalJson(b), code);
}
function continuationCancelOnly(endpoint, body, original) {
  check(endpoint === 'fate/private/cancel', 'F2QA_CONTINUATION_CANCEL_ONLY');
  samePublic(body, original, 'F2QA_CONTINUATION_ORIGINAL_INTENT');
}
function restoredPending(original, actor, restoredAt, ui) {
  const context = actorMetadata(actor);
  check(integer(restoredAt) && original.realmId === context.realmId && original.selectedCharacterId === context.characterId
    && identifier(original.requestId), 'F2QA_CONTINUATION_CACHE_SCOPE');
  const { realmId, selectedCharacterId, requestId, ...publicBody } = original;
  const intent = ui.canonicalPublic(publicBody), scope = JSON.stringify([context.accountId, context.realmId, context.characterId]);
  check(intent && intent.kind === 'profile-save', 'F2QA_CONTINUATION_CACHE_INTENT');
  const record = { version: 1, scope, context, id: requestId, kind: intent.kind, intent, signature: ui.signature(intent),
    at: restoredAt, cancelRequested: false, revealed: false };
  check(ui.validRecord(record, scope), 'F2QA_CONTINUATION_CACHE_RECORD');
  return { key: 'rpg-sfp-pending:' + scope, record };
}
function continuationSourceChanges(from, to) {
  const entries = value => {
    check(Array.isArray(value?.sources) && value.sourceCount === value.sources.length, 'F2QA_CONTINUATION_SOURCE_SCHEMA');
    const map = new Map();
    for (const row of value.sources) {
      check(typeof row.path === 'string' && digest(row.sha256) && integer(row.bytes) && !map.has(row.path), 'F2QA_CONTINUATION_SOURCE_ENTRY');
      map.set(row.path, { bytes: row.bytes, sha256: row.sha256 });
    }
    return map;
  };
  const before = entries(from), after = entries(to);
  const changes = [...new Set([...before.keys(), ...after.keys()])].sort().filter(name => canonicalJson(before.get(name)) !== canonicalJson(after.get(name)));
  same(changes, ['worker/tools/fate-private-browser.cjs'], 'F2QA_CONTINUATION_PRODUCT_SOURCE_CHANGED');
  return changes;
}

function continuationRequestAllowed(method, endpoint, pathname) {
  if (['GET', 'HEAD'].includes(method) && pathname === '/art/fate-taiwan-v8/taipei-dusk.webp') return true;
  return ['POST', 'OPTIONS'].includes(method) && (FATE_READS.has(endpoint)
    || ['atlas/status', 'atlas/quests', 'atlas/catalog', 'chat/state', 'fate/private/cancel'].includes(endpoint));
}
function untouchedSetupAttempt(attempt, original, failedSha256) {
  check(attempt?.case === 'continue-unsent-cancel' && attempt.status === 'failed' && attempt.ok === false && attempt.claimed === true
    && Array.isArray(attempt.submissions) && attempt.submissions.length === 0 && Array.isArray(attempt.operations) && attempt.operations.length === 0
    && Array.isArray(attempt.commands) && attempt.commands.length === 0 && Array.isArray(attempt.requests)
    && attempt.requests.every(row => !PRIVATE_WRITES.has(row.endpoint)), 'F2QA_PREVIOUS_SETUP_NO_WRITES');
  check(attempt.failure?.code === 'F2QA_MUTATION_NOT_ALLOWED' && attempt.routeErrors?.length > 0
    && attempt.routeErrors.every(row => row.code === 'F2QA_CONTINUATION_API_LIMIT'), 'F2QA_PREVIOUS_SETUP_GUARD_FAILURE');
  same(attempt.initialCheckpoint, attempt.finalCheckpoint, 'F2QA_PREVIOUS_SETUP_CHANGED_STATE');
  same(attempt.finalCheckpoint, original.finalCheckpoint, 'F2QA_PREVIOUS_SETUP_ORIGINAL_STATE');
  check(attempt.continuationBinding?.originalFailedRun?.sha256 === failedSha256
    && attempt.continuationBinding.originalFailedRun.status === 'failed'
    && attempt.continuationBinding.originalFailedRunReclassified === false && attempt.continuationBinding.originalClaimReused === false, 'F2QA_PREVIOUS_SETUP_ORIGINAL_BINDING');
  samePublic(attempt.continuationBinding.originalIntent, original.submissions[0].intent, 'F2QA_PREVIOUS_SETUP_ORIGINAL_INTENT');
}


function readonlyRequestAllowed(method, endpoint, pathname, apiOrigin = true) {
  if (!apiOrigin) return ['GET', 'HEAD'].includes(method);
  if (['GET', 'HEAD'].includes(method)) return pathname === '/art/fate-taiwan-v8/taipei-dusk.webp';
  return ['POST', 'OPTIONS'].includes(method) && (FATE_READS.has(endpoint)
    || ['atlas/status', 'atlas/quests', 'atlas/catalog', 'chat/state'].includes(endpoint));
}
function historyResponseMatches(response, api, requestId) {
  if (response.url().split('?')[0] !== api + '/app/api/fate/private/receipt' || response.request().method() !== 'POST') return false;
  try { return response.request().postDataJSON()?.requestId === requestId; } catch { return false; }
}
function historyResultExpectation(response) {
  const result = response.result;
  check(object(result), 'F2QA_HISTORY_RESULT');
  let firstParagraph, lifeNote = null;
  if (response.outcome === 'cancelled') firstParagraph = '這筆原請求已結束，此編號不會再執行操作。';
  else if (response.kind === 'profile-save') firstParagraph = '這筆出生檔案保存已完成。';
  else if (response.kind === 'profile-delete') firstParagraph = '這筆操作當時已刪除出生檔案與保存的旅箋。';
  else if (response.kind === 'birthday-start') {
    firstParagraph = result.already === true ? '已核對原本仍在進行的一世，這筆操作沒有再次使用啟程額度。' : '這筆生日啟程已完成，使用了今日一次啟程額度。';
    check(identifier(result.lifeId), 'F2QA_HISTORY_LIFE'); lifeNote = '旅章編號：' + result.lifeId;
  } else {
    check(response.kind === 'daily-sync' && /^\d{4}-\d{2}-\d{2}$/.test(result.day) && integer(result.unlocked) && result.unlocked <= 3, 'F2QA_HISTORY_DAILY');
    firstParagraph = '已同步 ' + result.day + ' 的旅箋；這筆操作當時共解鎖 ' + result.unlocked + ' / 3 則。';
  }
  return { firstParagraph, lifeNote };
}
function selectHistoryCard(cards, baseline, expected) {
  check([0, 1].includes(baseline) && Array.isArray(cards) && cards.length === baseline + 1, 'F2QA_HISTORY_CARD_COUNT');
  const card = cards[baseline];
  check(card?.firstParagraph === expected.firstParagraph && (expected.lifeNote === null || card.notes?.includes(expected.lifeNote)), 'F2QA_HISTORY_CARD_RESULT');
  return baseline;
}
function committedErasureEvidence(f) {
  check(f?.case === 'erase-history' && f.status === 'failed' && f.ok === false && f.claimed === true && f.sourcesStable === true
    && f.operations?.length === 1 && f.submissions?.length === 1 && f.commands?.length === 0
    && f.pageErrors?.length === 0 && f.httpErrors?.length === 0 && f.routeErrors?.length === 0 && f.externalRequestCount === 0, 'F2QA_ERASURE_ORIGINAL_FAILED');
  same(f.sourceBefore, f.sourceAfter, 'F2QA_ERASURE_ORIGINAL_SOURCE');
  const op = f.operations[0], sub = f.submissions[0], a = f.initialCheckpoint, b = f.finalCheckpoint;
  check(op.endpoint === 'fate/private/action-scoped' && op.intent?.kind === 'profile-delete'
    && op.response?.ok === true && op.response.outcome === 'committed' && op.response.result?.deleted === true
    && op.response.receipt?.kind === 'profile-delete' && op.response.receipt.outcome === 'committed' && op.response.receipt.result?.deleted === true
    && op.authority?.originalOperationVerified === true && op.authority.typedLedgerVerified === true && op.zeroGoldExpInventoryGiftChange === true
    && sub.endpoint === op.endpoint && sub.state === 'committed-response-delivered' && sub.status === 200 && sub.operationIndex === 0, 'F2QA_ERASURE_COMMITTED_PROOF');
  samePublic(sub.intent, op.intent, 'F2QA_ERASURE_SUBMISSION_INTENT'); same(sub.response, op.response, 'F2QA_ERASURE_SUBMISSION_RESPONSE');
  check(op.response.requestId === op.intent.requestId && op.response.intentNonce === op.intent.intentNonce
    && op.response.receipt.requestId === op.intent.requestId, 'F2QA_ERASURE_RECEIPT_ID');
  const writes = f.requests.filter(row => PRIVATE_WRITES.has(row.endpoint));
  check(writes.length === 1 && writes[0].endpoint === op.endpoint && writes[0].method === 'POST', 'F2QA_ERASURE_WRITE_COUNT');
  samePublic(writes[0].intent, op.intent, 'F2QA_ERASURE_WRITE_INTENT');
  check(a.initialInputSha256 === b.initialInputSha256 && a.digestId === b.digestId && a.now === b.now
    && a.commandCount === b.commandCount, 'F2QA_ERASURE_CLOCK_COMMANDS');
  same(a.databases.season, b.databases.season, 'F2QA_ERASURE_SEASON_CHANGED');
  const before = a.databases.permanent, after = b.databases.permanent;
  same(before.tableNames, after.tableNames, 'F2QA_ERASURE_TABLES');
  const changed = before.tableNames.filter(name => before.tableHashes[name] !== after.tableHashes[name]).sort();
  same(changed, ['rpg_fate_daily', 'rpg_fate_operations', 'rpg_fate_profiles', 'rpg_ledger', 'sqlite_sequence'], 'F2QA_ERASURE_UNEXPECTED_TABLE_CHANGE');
  check(before.counts.rpg_fate_profiles === 1 && before.counts.rpg_fate_daily === 1
    && after.counts.rpg_fate_profiles === 0 && after.counts.rpg_fate_daily === 0
    && after.counts.rpg_fate_operations === before.counts.rpg_fate_operations + 1
    && after.counts.rpg_ledger === before.counts.rpg_ledger + 1
    && after.totalChanges === before.totalChanges + 4 && before.outboxHash === after.outboxHash, 'F2QA_ERASURE_DELETE_COUNTS');
  for (const name of before.tableNames) if (!['rpg_fate_profiles', 'rpg_fate_daily', 'rpg_fate_operations', 'rpg_ledger'].includes(name))
    check(before.counts[name] === after.counts[name], 'F2QA_ERASURE_UNEXPECTED_COUNT_CHANGE');
  return op;
}

function parseArgs(argv) {
  const args = new Map();
  for (const value of argv) {
    const m = /^--(case|run-id|campaign|campaign-plan|previous-run|bridge-run)=([A-Za-z0-9][A-Za-z0-9_.-]{0,110})$/.exec(value);
    check(m && !args.has(m[1]), 'F2QA_ARGUMENTS'); args.set(m[1], m[2]);
  }
  for (const key of ['case', 'run-id', 'campaign', 'campaign-plan']) check(args.has(key), 'F2QA_EXPLICIT_RUN_REQUIRED');
  return args;
}
const CASES = Object.freeze([
  { id: 'layout-pure', mutation: false, predecessor: null },
  { id: 'ime-refresh', mutation: false, predecessor: 'layout-pure' },
  { id: 'temporary-birthday', mutation: true, predecessor: 'ime-refresh' },
  { id: 'profile-save-view-update', mutation: true, predecessor: 'temporary-birthday' },
  { id: 'daily-initial', mutation: true, predecessor: 'profile-save-view-update' },
  { id: 'battle-unlocks', mutation: true, predecessor: 'daily-initial' },
  { id: 'saved-birthday', mutation: true, predecessor: 'battle-unlocks' },
  { id: 'lost-committed', mutation: true, predecessor: 'saved-birthday' },
  { id: 'lost-unsent-cancel', mutation: true, predecessor: 'lost-committed' },
  { id: 'continue-unsent-cancel', mutation: true, predecessor: null, continuation: true },
  { id: 'continue-unsent-cancel-assets', mutation: true, predecessor: null, continuation: true },
  { id: 'scope-late', mutation: false, predecessor: 'lost-unsent-cancel' },
  { id: 'erase-history', mutation: true, predecessor: 'scope-late' },
  { id: 'erased-history-readonly', mutation: false, predecessor: null, erasedHistory: true },
  { id: 'final-layout', mutation: false, predecessor: 'erase-history' },
  { id: 'receipt-only', mutation: false, predecessor: null, bridge: true },
]);
const PRIVATE_READS = new Set(['fate/private/scene', 'fate/private/profile', 'fate/private/receipt']);
const PRIVATE_WRITES = new Set(['fate/private/action-scoped', 'fate/private/cancel']);
const FATE_READS = new Set(['fate/scene', 'fate/receipt', ...PRIVATE_READS]);
const FRONT = ['scene-fate-ui.js', 'scene-fate-ui.css', 'scene-fate-private-ui.js', 'scene-fate-private-ui.css',
  'scene-fate-story.js', 'scene-live-session.js', 'scene-social-preview.js', 'scene-social-preview.css', 'scene-window-manager.js'];
const TOOLS = ['fate-private-browser.cjs', 'fate-private-qa-fixture.mjs', 'party-qa-fixture.mjs',
  'atlas-local-preview.mjs', 'scene-live-preview.mjs', 'scene-preview-bindings.mjs'];

function databaseEvidence(state) {
  check(object(state) && object(state.privacy) && /^[a-f0-9]{32}$/.test(state.privacy.digestId)
    && state.privacy.secretPersisted === false && state.privacy.restorableBackup === false
    && state.privacy.privateRowsExposed === false && Array.isArray(state.privacy.forbiddenCopies)
    && state.privacy.forbiddenCopies.length === 0, 'F2QA_PRIVATE_SNAPSHOT');
  const result = {};
  for (const realm of ['permanent', 'season']) {
    const d = state.databases?.[realm];
    check(object(d) && d.digestAlgorithm === 'HMAC-SHA-256' && d.digestId === state.privacy.digestId
      && d.secretPersisted === false && d.restorableBackup === false && digest(d.sha256) && digest(d.outboxHash)
      && integer(d.totalChanges) && Array.isArray(d.tableNames) && d.tableNames.length >= 90
      && new Set(d.tableNames).size === d.tableNames.length, 'F2QA_DATABASE_PROOF');
    const hashes = {}, counts = {};
    for (const name of d.tableNames) {
      check(typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        && digest(d.tableHashes?.[name]) && integer(d.counts?.[name]), 'F2QA_TABLE_PROOF');
      hashes[name] = d.tableHashes[name]; counts[name] = d.counts[name];
    }
    result[realm] = { digestAlgorithm: 'HMAC-SHA-256', digestId: d.digestId, secretPersisted: false,
      restorableBackup: false, sha256: d.sha256, totalChanges: d.totalChanges, outboxHash: d.outboxHash,
      tableNames: [...d.tableNames], tableHashes: hashes, counts };
  }
  return result;
}
function checkpoint(state) {
  check(state?.ok === true && state.isolated === true && state.ephemeral === true && state.productionAccess === false
    && state.commandInFlight === null && Array.isArray(state.commands) && integer(state.qaClock?.now)
    && digest(state.initialInputSha256) && integer(state.seededAt)
    && state.noDispatcher === true && state.realNotificationsSent === false, 'F2QA_STATE_CHECKPOINT');
  return { initialInputSha256: state.initialInputSha256, digestId: state.privacy.digestId,
    now: state.qaClock.now, commandCount: state.commands.length, databases: databaseEvidence(state) };
}
function slimCheckpoint(state) {
  const s = checkpoint(state);
  return { initialInputSha256: s.initialInputSha256, digestId: s.digestId, now: s.now, commandCount: s.commandCount,
    databases: Object.fromEntries(Object.entries(s.databases).map(([realm, d]) => [realm,
      { sha256: d.sha256, totalChanges: d.totalChanges, outboxHash: d.outboxHash, digestId: d.digestId }])) };
}
function actorMetadata(actor) {
  check(object(actor) && ['accountId', 'characterId', 'realmId'].every(key => identifier(actor[key])), 'F2QA_ACTOR');
  return { accountId: actor.accountId, characterId: actor.characterId, realmId: actor.realmId };
}
function resourceState(state) {
  return Object.fromEntries(['permanent', 'season'].map(realm => {
    const r = state[realm];
    check(Array.isArray(r?.characters) && Array.isArray(r.inventory) && Array.isArray(r.gifts)
      && Array.isArray(r.giftOperations), 'F2QA_RESOURCE_STATE');
    return [realm, { characters: r.characters.map(c => ({ id: c.tg_id, gold: c.gold, exp: c.exp })),
      inventory: r.inventory, gifts: r.gifts, giftOperations: r.giftOperations }];
  }));
}
function noPrivateReceiptFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    check(!/^(birth|birthDate|birth_json|chart|chart_json|notes|notes_json|payloadHash|payload_hash|privateHash)$/i.test(key), 'F2QA_PRIVATE_RECEIPT_COPY');
    noPrivateReceiptFields(child);
  }
}

async function run(argv) {
  const args = parseArgs(argv), selected = args.get('case'), definition = CASES.find(item => item.id === selected);
  check(definition, 'F2QA_UNKNOWN_CASE');
  check(Boolean(args.get('bridge-run')) === Boolean(definition.bridge), 'F2QA_BRIDGE_ARGUMENT');
  check(!definition.bridge || !args.has('previous-run'), 'F2QA_BRIDGE_PREDECESSOR');
  const repo = path.resolve(__dirname, '../..'), base = path.join(repo, '.release-sync/fate-f2-20261105');
  const campaign = args.get('campaign'), runId = args.get('run-id'), campaignRoot = path.join(base, 'campaigns', campaign);
  const origin = loopback(process.env.FATE_PRIVATE_SCENE_ORIGIN || 'http://127.0.0.1:9803');
  const api = loopback(process.env.FATE_PRIVATE_API_ORIGIN || 'http://127.0.0.1:9802');
  check(origin !== api, 'F2QA_SEPARATE_PORTS');
  const qa = await import(pathToFileURL(path.join(repo, 'worker/tools/fate-private-qa-fixture.mjs')).href);
  const dir = path.join(campaignRoot, 'browser', runId);
  check(!fs.existsSync(dir), 'F2QA_RUN_EXISTS'); fs.mkdirSync(dir, { recursive: true });
  const evidence = { schemaVersion: 1, runId, case: selected, campaign, origin, api, pid: process.pid,
    status: 'starting', ok: false, startedAt: new Date().toISOString(), productionAccess: false,
    privacy: { privateValuesPersisted: false, rawApiBodiesPersisted: false, rawDbRowsPersisted: false,
      failureMessagesPersisted: false, screenshotsMasked: true, databaseProof: 'Process-only-key HMAC-SHA-256' },
    checks: [], submissions: [], operations: [], commands: [], requests: [], pureReads: [], screenshots: [],
    pageErrors: [], httpErrors: [], routeErrors: [], externalRequestCount: 0, assets: {}, loadedSources: {},
    fixture: null, selectionBoundary: 'Normal actor selection can settle original state; pure proofs start after selection completes.' };
  let stage = 'starting', browser, page, frame, actor, main, alt, foreign, season, fixture;
  let prepared = null, activeFault = null, heldRead = null, stopMutations = false, eventSerial = 0, commandSerial = 0;
  const pending = [], releases = new Set(), privateMarkers = new Set(), inMemoryBodies = new Map();
  const expectedHttpRequests = new WeakSet();
  const writeNew = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  function persist(next) {
    if (next) { stage = next; evidence.stage = next; }
    evidence.updatedAt = new Date().toISOString();
    const file = path.join(dir, 'results.json'), temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(evidence, null, 2) + '\n'); fs.renameSync(temporary, file);
  }
  function event(kind, value) {
    check(/^[a-z0-9-]{1,48}$/.test(kind), 'F2QA_EVENT_NAME');
    writeNew(path.join(dir, String(++eventSerial).padStart(4, '0') + '-' + kind + '.json'), value);
  }
  const note = id => { check(/^[a-z0-9_-]{1,100}$/.test(id), 'F2QA_CHECK_NAME'); evidence.checks.push({ id, passed: true }); persist(id); console.log(JSON.stringify({ check: id, passed: true })); };
  function owned(file) {
    check(typeof file === 'string' && !path.isAbsolute(file), 'F2QA_OWNED_PATH');
    const target = fs.realpathSync(path.resolve(base, file)), parent = fs.realpathSync(base), rel = path.relative(parent, target);
    check(rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel), 'F2QA_OWNED_PATH'); return target;
  }
  function readEvidence(file, expectedHash) {
    const full = owned(file), bytes = fs.readFileSync(full);
    check(digest(expectedHash) && sha(bytes) === expectedHash, 'F2QA_EVIDENCE_HASH');
    return { full, value: JSON.parse(bytes), sha256: expectedHash };
  }
  function sources() {
    const git = process.env.RPG_GIT_EXECUTABLE || 'C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe';
    const list = execFileSync(git, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true }).split('\0').filter(Boolean);
    const files = [...new Set([...list.filter(p => /^worker\/(?:src|migrations|public\/fate)\//.test(p) && /\.(?:[cm]?js|json|sql)$/.test(p)),
      ...FRONT.map(p => 'worker/public/' + p), ...TOOLS.map(p => 'worker/tools/' + p),
      ...['d1-shim.js', 'client-request.js', 'realm-test-helpers.js'].map(p => 'worker/test/' + p), 'package.json', 'package-lock.json'])].sort();
    return Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(repo, file)))]));
  }
  function playwright() {
    const candidates = [process.env.RPG_PLAYWRIGHT_MODULE,
      path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
      path.join(repo, '.release-sync/browser-tools/node_modules/playwright'), 'playwright'].filter(Boolean);
    for (const candidate of candidates) {
      try { const resolved = require.resolve(candidate), module = require(resolved); check(typeof module.chromium?.launch === 'function', 'F2QA_BROWSER_MODULE'); evidence.browserModule = resolved; return module; }
      catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
    }
    throw error('F2QA_EXISTING_PLAYWRIGHT_REQUIRED');
  }
  async function json(url, options = {}) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), ...options });
    check(response.status === 200, 'F2QA_READ_HTTP'); return response.json();
  }
  async function state() {
    const s = await json(api + '/__preview/fate-private-qa/state'); checkpoint(s);
    if (fixture) check(s.initialInputSha256 === fixture.initialInputSha256 && s.privacy.digestId === fixture.privacy.digestId, 'F2QA_API_STATE_IDENTITY');
    return s;
  }
  function previous(id) {
    const full = owned('campaigns/' + campaign + '/browser/' + id + '/results.json'), bytes = fs.readFileSync(full), value = JSON.parse(bytes);
    check(value.runId === id && value.campaign === campaign, 'F2QA_ORIGINAL_RUN'); return { full, sha256: sha(bytes), value };
  }
  let prior = null, bridge = null, continuation = null, erasedHistory = null;
  function safeResponse(value) {
    const clean = qa.qaPrivateResponse(value);
    // Product errors are never a free-form logging channel, even when they
    // happen to fit a syntactic identifier such as an ISO date.
    const publicErrorCodes = new Set(['fate_private_input', 'fate_private_changed', 'fate_private_day_changed',
      'fate_private_snapshot_changed', 'fate_private_receipt_unverified', 'fate_private_receipt_corrupt',
      'fate_private_state_corrupt', 'birth_consent', 'birth_date', 'request_reused', 'request_changed',
      'realm_read_only', 'realm_frozen', 'character_not_found', 'character_changed', 'character_selection_changed',
      'selected_character_changed', 'unauthorized', 'forbidden', 'not_found', 'unclassified']);
    if (!clean.ok && !publicErrorCodes.has(clean.errorCode)) clean.errorCode = 'unclassified';
    const serialized = JSON.stringify(clean);
    for (const secret of privateMarkers) check(!serialized.includes(secret), 'F2QA_RECORDED_PRIVATE_COPY');
    return clean;
  }
  function continuationAuthority(plan, freeze) {
    const c = plan.continuation;
    if (!c) { check(!definition.continuation, 'F2QA_CONTINUATION_AUTHORITY_REQUIRED'); return; }
    check(object(c) && ['continue-unsent-cancel', 'continue-unsent-cancel-assets'].includes(c.case)
      && (!definition.continuation || selected === c.case), 'F2QA_CONTINUATION_AUTHORITY');
    same([...plan.allowedCases].sort(), [c.case, 'scope-late', 'erase-history', 'final-layout', 'receipt-only'].sort(), 'F2QA_CONTINUATION_CASE_LIMIT');
    const failed = readEvidence(c.failedRunFile, c.failedRunSha256), originalClaim = readEvidence(c.originalClaimFile, c.originalClaimSha256),
      lookup = readEvidence(c.originalLookupFile, c.originalLookupSha256), sourceBridge = readEvidence(c.sourceBridgeFile, c.sourceBridgeSha256);
    const f = failed.value, claimValue = originalClaim.value, oldLookup = lookup.value;
    check(c.failedRunFile === 'campaigns/' + campaign + '/browser/' + f.runId + '/results.json'
      && c.originalClaimFile === 'campaigns/' + campaign + '/case-claims/lost-unsent-cancel.json'
      && c.originalLookupFile === 'campaigns/' + campaign + '/browser/' + f.runId + '/0003-pending-lookup.json', 'F2QA_CONTINUATION_ORIGINAL_PATH');
    check(f.campaign === campaign && f.case === 'lost-unsent-cancel' && f.status === 'failed' && f.ok === false && f.claimed === true
      && f.sourcesStable === true && f.operations?.length === 0 && f.commands?.length === 0 && f.submissions?.length === 1
      && f.health?.api?.pid === plan.apiPid && f.fixture?.initialInputSha256 === fixture.initialInputSha256
      && f.fixture?.digestId === fixture.privacy.digestId, 'F2QA_CONTINUATION_ORIGINAL_FAILED');
    same(f.sourceBefore, f.sourceAfter, 'F2QA_CONTINUATION_FAILED_SOURCE');
    same(f.initialCheckpoint, f.finalCheckpoint, 'F2QA_CONTINUATION_UNSENT_STATE');
    check(digest(c.currentCheckpointSha256) && sha(JSON.stringify(f.finalCheckpoint)) === c.currentCheckpointSha256, 'F2QA_CONTINUATION_CHECKPOINT_HASH');
    const row = f.submissions[0], original = qa.qaPrivatePublicIntent(row.intent), originalActor = actorMetadata(row.actor);
    samePublic(row.intent, original, 'F2QA_CONTINUATION_PUBLIC_ONLY');
    check(row.state === 'not-sent-intercepted' && row.endpoint === 'fate/private/action-scoped' && original.kind === 'profile-save'
      && original.realmId === originalActor.realmId && original.selectedCharacterId === originalActor.characterId, 'F2QA_CONTINUATION_UNSENT_INTENT');
    check(claimValue.schemaVersion === 1 && claimValue.case === 'lost-unsent-cancel' && claimValue.runId === f.runId
      && claimValue.campaign === campaign && claimValue.apiPid === plan.apiPid && claimValue.authoritySha256 === f.authority.sha256
      && claimValue.fixtureInitialInputSha256 === fixture.initialInputSha256 && claimValue.digestId === fixture.privacy.digestId, 'F2QA_CONTINUATION_ORIGINAL_CLAIM');
    check(oldLookup.requestId === original.requestId && oldLookup.databaseUnchanged === true && oldLookup.response?.ok === true
      && oldLookup.response.found === false && oldLookup.response.cancellationAllowed === true && oldLookup.response.receipt === null
      && oldLookup.response.requestId === original.requestId && oldLookup.response.intentNonce === original.intentNonce
      && oldLookup.response.kind === original.kind && oldLookup.response.realmId === originalActor.realmId
      && oldLookup.response.accountId === originalActor.accountId && oldLookup.response.characterId === originalActor.characterId, 'F2QA_CONTINUATION_ORIGINAL_LOOKUP');
    const binding = sourceBridge.value;
    check(binding.schemaVersion === 1 && binding.status === 'approved-tool-only-continuation' && binding.campaignId === campaign
      && binding.failedRunSha256 === c.failedRunSha256 && binding.toFreezeFile === plan.candidateFreezeFile
      && binding.toFreezeSha256 === plan.candidateFreezeSha256
      && binding.fromFreezeFile === f.authority.candidateFreezeFile && binding.fromFreezeSha256 === f.authority.candidateFreezeSha256, 'F2QA_CONTINUATION_SOURCE_BRIDGE');
    same(binding.allowedChangedSources, ['worker/tools/fate-private-browser.cjs'], 'F2QA_CONTINUATION_SOURCE_LIMIT');
    const oldFreeze = readEvidence(binding.fromFreezeFile, binding.fromFreezeSha256);
    const changes = continuationSourceChanges(oldFreeze.value, freeze.value);
    const oldSources = Object.fromEntries(oldFreeze.value.sources.map(v => [v.path, v.sha256]));
    for (const [name, hash] of Object.entries(f.sourceAfter)) check(oldSources[name] === hash, 'F2QA_CONTINUATION_OLD_FREEZE');
    const expectedCases = ['layout-pure', 'ime-refresh', 'temporary-birthday', 'profile-save-view-update', 'daily-initial', 'battle-unlocks', 'saved-birthday', 'lost-committed'];
    check(Array.isArray(c.passedRuns) && c.passedRuns.length === expectedCases.length, 'F2QA_CONTINUATION_PASSED_CHAIN');
    const passedRuns = []; let previousPassed = null;
    for (let i = 0; i < expectedCases.length; i++) {
      const descriptor = c.passedRuns[i], observed = readEvidence(descriptor.file, descriptor.sha256), v = observed.value;
      check(descriptor.file === 'campaigns/' + campaign + '/browser/' + v.runId + '/results.json' && v.case === expectedCases[i]
        && v.campaign === campaign && v.ok === true && v.status === 'passed' && v.sourcesStable === true
        && v.health?.api?.pid === plan.apiPid && v.fixture?.digestId === fixture.privacy.digestId
        && v.fixture?.initialInputSha256 === fixture.initialInputSha256 && v.authority?.sha256 === f.authority.sha256, 'F2QA_CONTINUATION_PASSED_RUN');
      same(v.sourceBefore, f.sourceAfter, 'F2QA_CONTINUATION_PASSED_SOURCE'); same(v.sourceAfter, f.sourceAfter, 'F2QA_CONTINUATION_PASSED_SOURCE');
      if (previousPassed) {
        check(v.previousRun?.runId === previousPassed.value.runId && v.previousRun.sha256 === previousPassed.sha256, 'F2QA_CONTINUATION_CHAIN_LINK');
        same(v.initialCheckpoint, previousPassed.value.finalCheckpoint, 'F2QA_CONTINUATION_CHAIN_STATE');
      } else same(v.initialCheckpoint, checkpoint(readEvidence(plan.initialStateFile, plan.initialStateSha256).value.state), 'F2QA_CONTINUATION_CHAIN_ORIGIN');
      passedRuns.push({ file: descriptor.file, sha256: descriptor.sha256, runId: v.runId, case: v.case }); previousPassed = observed;
    }
    check(f.previousRun?.runId === previousPassed.value.runId && f.previousRun.sha256 === previousPassed.sha256, 'F2QA_CONTINUATION_FAILED_LINK');
    same(f.initialCheckpoint, previousPassed.value.finalCheckpoint, 'F2QA_CONTINUATION_FAILED_CHECKPOINT');
    let previousSetup = null;
    if (c.case === 'continue-unsent-cancel-assets') {
      const p = c.previousSetupAttempt;
      check(object(p), 'F2QA_PREVIOUS_SETUP_REQUIRED');
      const run = readEvidence(p.runFile, p.runSha256), claim = readEvidence(p.claimFile, p.claimSha256), a = run.value, ac = claim.value;
      check(p.runFile === 'campaigns/' + campaign + '/browser/' + a.runId + '/results.json'
        && p.claimFile === 'campaigns/' + campaign + '/case-claims/continue-unsent-cancel.json', 'F2QA_PREVIOUS_SETUP_PATH');
      untouchedSetupAttempt(a, f, c.failedRunSha256);
      check(a.campaign === campaign && a.sourcesStable === true && a.health?.api?.pid === plan.apiPid
        && a.fixture?.initialInputSha256 === fixture.initialInputSha256 && a.fixture?.digestId === fixture.privacy.digestId
        && ac.schemaVersion === 1 && ac.case === 'continue-unsent-cancel' && ac.runId === a.runId && ac.campaign === campaign
        && ac.apiPid === plan.apiPid && ac.fixtureInitialInputSha256 === fixture.initialInputSha256 && ac.digestId === fixture.privacy.digestId
        && ac.authoritySha256 === a.authority.sha256 && ac.originalFailedRunSha256 === c.failedRunSha256
        && ac.originalRequestId === original.requestId && ac.independentContinuation === true, 'F2QA_PREVIOUS_SETUP_CLAIM');
      same(a.sourceBefore, a.sourceAfter, 'F2QA_PREVIOUS_SETUP_SOURCE');
      const previousAuthority = readEvidence(a.authority.file, a.authority.sha256);
      check(previousAuthority.value.status === 'approved-fate-private-campaign' && previousAuthority.value.productionAccess === false
        && previousAuthority.value.restoredDatabase === false && previousAuthority.value.continuation?.case === 'continue-unsent-cancel'
        && previousAuthority.value.continuation.failedRunSha256 === c.failedRunSha256 && previousAuthority.value.continuation.originalClaimSha256 === c.originalClaimSha256
        && previousAuthority.value.campaignId === campaign && previousAuthority.value.apiPid === plan.apiPid
        && previousAuthority.value.candidateFreezeFile === a.authority.candidateFreezeFile
        && previousAuthority.value.candidateFreezeSha256 === a.authority.candidateFreezeSha256, 'F2QA_PREVIOUS_SETUP_AUTHORITY');
      const previousFreeze = readEvidence(a.authority.candidateFreezeFile, a.authority.candidateFreezeSha256),
        previousSources = Object.fromEntries(previousFreeze.value.sources.map(v => [v.path, v.sha256]));
      for (const [name, hash] of Object.entries(a.sourceAfter)) check(previousSources[name] === hash, 'F2QA_PREVIOUS_SETUP_FROZEN_SOURCE');
      const previousChanges = continuationSourceChanges(previousFreeze.value, freeze.value);
      previousSetup = { run, claim };
      evidence.previousSetupAttempt = { runFile: p.runFile, runSha256: p.runSha256, claimFile: p.claimFile, claimSha256: p.claimSha256,
        status: 'failed', noSubmissionsOrWriteRequests: true, databaseClockCommandsUnchanged: true, changedSources: previousChanges,
        authorityFile: a.authority.file, authoritySha256: a.authority.sha256, freezeFile: a.authority.candidateFreezeFile, freezeSha256: a.authority.candidateFreezeSha256,
        originalFailedRunReclassified: false, originalClaimReused: false };
    } else check(!c.previousSetupAttempt, 'F2QA_UNEXPECTED_SETUP_ATTEMPT');

    continuation = { failed, originalClaim, lookup, sourceBridge, previousSetup, intent: original, actor: originalActor, cancelAttempted: false };
    evidence.continuationBinding = { case: c.case, originalFailedRun: { file: c.failedRunFile, sha256: c.failedRunSha256, status: 'failed' },
      originalClaim: { file: c.originalClaimFile, sha256: c.originalClaimSha256 }, originalLookup: { file: c.originalLookupFile, sha256: c.originalLookupSha256 },
      sourceBridge: { file: c.sourceBridgeFile, sha256: c.sourceBridgeSha256, changedSources: changes }, currentCheckpointSha256: c.currentCheckpointSha256, passedRuns,
      originalIntent: original, originalFailedRunReclassified: false, originalClaimReused: false };
  }


  function erasedHistoryAuthority(plan, freeze) {
    const c = plan.erasedHistoryContinuation;
    if (!c) { check(!definition.erasedHistory, 'F2QA_ERASURE_AUTHORITY_REQUIRED'); return; }
    check(object(c) && c.case === 'erased-history-readonly' && !plan.continuation && !definition.mutation
      && ['erased-history-readonly', 'final-layout'].includes(selected), 'F2QA_ERASURE_AUTHORITY');
    same([...plan.allowedCases].sort(), ['erased-history-readonly', 'final-layout'], 'F2QA_ERASURE_CASE_LIMIT');
    const failed = readEvidence(c.failedRunFile, c.failedRunSha256), originalClaim = readEvidence(c.originalClaimFile, c.originalClaimSha256),
      responseEvent = readEvidence(c.originalResponseFile, c.originalResponseSha256), verifiedEvent = readEvidence(c.verifiedOperationFile, c.verifiedOperationSha256),
      sourceBridge = readEvidence(c.sourceBridgeFile, c.sourceBridgeSha256);
    const f = failed.value, op = committedErasureEvidence(f), root = 'campaigns/' + campaign + '/browser/' + f.runId + '/';
    check(c.failedRunFile === root + 'results.json' && c.originalClaimFile === 'campaigns/' + campaign + '/case-claims/erase-history.json'
      && c.originalResponseFile === root + '0002-original-response.json' && c.verifiedOperationFile === root + '0003-verified-operation.json', 'F2QA_ERASURE_ORIGINAL_PATH');
    check(f.campaign === campaign && f.health?.api?.pid === plan.apiPid && f.fixture?.initialInputSha256 === fixture.initialInputSha256
      && f.fixture?.digestId === fixture.privacy.digestId, 'F2QA_ERASURE_ORIGINAL_API');
    const publicIntent = qa.qaPrivatePublicIntent(op.intent), who = actorMetadata(op.actor);
    samePublic(op.intent, publicIntent, 'F2QA_ERASURE_PUBLIC_INTENT'); qa.qaPrivateReceipt(op.response.receipt); noPrivateReceiptFields(op.response);
    check(publicIntent.realmId === who.realmId && publicIntent.selectedCharacterId === who.characterId && who.realmId === 'permanent', 'F2QA_ERASURE_ACTOR');
    same(verifiedEvent.value, op, 'F2QA_ERASURE_VERIFIED_EVENT');
    check(responseEvent.value.status === 200 && responseEvent.value.endpoint === op.endpoint, 'F2QA_ERASURE_RESPONSE_EVENT');
    samePublic(responseEvent.value.intent, publicIntent, 'F2QA_ERASURE_RESPONSE_INTENT'); same(responseEvent.value.response, op.response, 'F2QA_ERASURE_RESPONSE_RECEIPT');
    const claimValue = originalClaim.value;
    check(claimValue.schemaVersion === 1 && claimValue.case === 'erase-history' && claimValue.runId === f.runId && claimValue.campaign === campaign
      && claimValue.apiPid === plan.apiPid && claimValue.authoritySha256 === f.authority.sha256 && claimValue.fixtureInitialInputSha256 === fixture.initialInputSha256
      && claimValue.digestId === fixture.privacy.digestId, 'F2QA_ERASURE_ORIGINAL_CLAIM');
    check(digest(c.currentCheckpointSha256) && sha(JSON.stringify(f.finalCheckpoint)) === c.currentCheckpointSha256, 'F2QA_ERASURE_CHECKPOINT_HASH');
    same(checkpoint(fixture), f.finalCheckpoint, 'F2QA_ERASURE_CURRENT_CHECKPOINT');
    const oldAuthority = readEvidence(f.authority.file, f.authority.sha256), oldPlan = oldAuthority.value;
    check(oldPlan.status === 'approved-fate-private-campaign' && oldPlan.campaignId === campaign && oldPlan.apiPid === plan.apiPid
      && oldPlan.uiPid === plan.uiPid && oldPlan.productionAccess === false && oldPlan.restoredDatabase === false
      && oldPlan.continuation?.case === 'continue-unsent-cancel-assets', 'F2QA_ERASURE_ORIGINAL_AUTHORITY');
    const binding = sourceBridge.value;
    check(binding.schemaVersion === 1 && binding.status === 'approved-tool-only-readonly-continuation' && binding.campaignId === campaign
      && binding.failedRunSha256 === c.failedRunSha256 && binding.toFreezeFile === plan.candidateFreezeFile && binding.toFreezeSha256 === plan.candidateFreezeSha256
      && binding.fromFreezeFile === f.authority.candidateFreezeFile && binding.fromFreezeSha256 === f.authority.candidateFreezeSha256, 'F2QA_ERASURE_SOURCE_BRIDGE');
    same(binding.allowedChangedSources, ['worker/tools/fate-private-browser.cjs'], 'F2QA_ERASURE_SOURCE_LIMIT');
    const oldFreeze = readEvidence(binding.fromFreezeFile, binding.fromFreezeSha256), changes = continuationSourceChanges(oldFreeze.value, freeze.value);
    const sourceMaps = new Map();
    function checkOldSources(run) {
      const ref = run.authority;
      let map = sourceMaps.get(ref.candidateFreezeSha256);
      if (!map) {
        const archived = readEvidence(ref.candidateFreezeFile, ref.candidateFreezeSha256);
        continuationSourceChanges(archived.value, freeze.value); map = Object.fromEntries(archived.value.sources.map(row => [row.path, row.sha256]));
        sourceMaps.set(ref.candidateFreezeSha256, map);
      }
      same(run.sourceBefore, run.sourceAfter, 'F2QA_ERASURE_PASSED_SOURCE_CHANGED');
      for (const [name, hash] of Object.entries(run.sourceAfter)) check(map[name] === hash, 'F2QA_ERASURE_OLD_FREEZE');
    }
    checkOldSources(f);
    const expectedCases = ['layout-pure', 'ime-refresh', 'temporary-birthday', 'profile-save-view-update', 'daily-initial', 'battle-unlocks',
      'saved-birthday', 'lost-committed', 'continue-unsent-cancel-assets', 'scope-late'];
    check(Array.isArray(c.passedRuns) && c.passedRuns.length === expectedCases.length, 'F2QA_ERASURE_PASSED_CHAIN');
    const passedRuns = []; let last = null;
    for (let i = 0; i < expectedCases.length; i++) {
      const descriptor = c.passedRuns[i], observed = readEvidence(descriptor.file, descriptor.sha256), v = observed.value;
      check(descriptor.file === 'campaigns/' + campaign + '/browser/' + v.runId + '/results.json' && v.case === expectedCases[i] && v.campaign === campaign
        && v.ok === true && v.status === 'passed' && v.sourcesStable === true && v.health?.api?.pid === plan.apiPid
        && v.fixture?.initialInputSha256 === fixture.initialInputSha256 && v.fixture?.digestId === fixture.privacy.digestId, 'F2QA_ERASURE_PASSED_RUN');
      checkOldSources(v);
      if (i < 8) same(descriptor, oldPlan.continuation.passedRuns[i], 'F2QA_ERASURE_ORIGINAL_PASSED_BINDING');
      else check(v.authority.sha256 === f.authority.sha256, 'F2QA_ERASURE_PASSED_AUTHORITY');
      if (last) {
        same(v.initialCheckpoint, last.value.finalCheckpoint, 'F2QA_ERASURE_CHAIN_STATE');
        if (i === 8) {
          check(v.continuationBinding?.case === 'continue-unsent-cancel-assets'
            && v.continuationBinding.originalFailedRun.sha256 === oldPlan.continuation.failedRunSha256
            && v.continuationBinding.originalClaim.sha256 === oldPlan.continuation.originalClaimSha256
            && v.continuationBinding.originalFailedRunReclassified === false && v.continuationBinding.originalClaimReused === false, 'F2QA_ERASURE_CANCEL_CHAIN');
        } else check(v.previousRun?.runId === last.value.runId && v.previousRun.sha256 === last.sha256, 'F2QA_ERASURE_CHAIN_LINK');
      } else same(v.initialCheckpoint, checkpoint(readEvidence(plan.initialStateFile, plan.initialStateSha256).value.state), 'F2QA_ERASURE_CHAIN_ORIGIN');
      passedRuns.push({ ...descriptor, runId: v.runId, case: v.case }); last = observed;
    }
    check(f.previousRun?.runId === last.value.runId && f.previousRun.sha256 === last.sha256, 'F2QA_ERASURE_FAILED_LINK');
    same(f.initialCheckpoint, last.value.finalCheckpoint, 'F2QA_ERASURE_FAILED_CHECKPOINT');
    const originalView = f.requests.find(row => row.endpoint === 'fate/private/scene' && row.response?.privateFate?.profile?.saved === true);
    check(originalView, 'F2QA_ERASURE_ORIGINAL_TARGETS');
    const targets = safeResponse(originalView.response).privateFate.history.receipts.filter(row => ['profile-save', 'daily-sync', 'birthday-start'].includes(row.kind)).slice(0, 6);
    check(targets.length >= 3 && new Set(targets.map(row => row.requestId)).size === targets.length, 'F2QA_ERASURE_TARGET_COUNT');
    erasedHistory = { failed, originalClaim, operation: op, actor: who, targets };
    evidence.erasedHistoryBinding = { case: c.case, originalFailedRun: { file: c.failedRunFile, sha256: c.failedRunSha256, status: 'failed' },
      originalClaim: { file: c.originalClaimFile, sha256: c.originalClaimSha256 },
      originalResponse: { file: c.originalResponseFile, sha256: c.originalResponseSha256 }, verifiedOperation: { file: c.verifiedOperationFile, sha256: c.verifiedOperationSha256 },
      originalAuthority: { file: f.authority.file, sha256: f.authority.sha256 }, originalIntent: publicIntent,
      currentCheckpointSha256: c.currentCheckpointSha256, sourceBridge: { file: c.sourceBridgeFile, sha256: c.sourceBridgeSha256, changedSources: changes },
      passedRuns, originalFailedRunReclassified: false, originalClaimReused: false, newMutationAllowed: false };
  }
  function claimReadOnly() {
    check(erasedHistory && !definition.mutation && ['erased-history-readonly', 'final-layout'].includes(selected) && !stopMutations, 'F2QA_ERASURE_READONLY_CLAIM');
    const root = path.join(campaignRoot, 'case-claims'); fs.mkdirSync(root, { recursive: true });
    writeNew(path.join(root, selected + '.json'), { schemaVersion: 1, case: selected, runId, campaign,
      apiPid: evidence.health.api.pid, fixtureInitialInputSha256: fixture.initialInputSha256, digestId: fixture.privacy.digestId,
      authoritySha256: evidence.authority.sha256, originalFailedRunSha256: erasedHistory.failed.sha256,
      originalErasureRequestId: erasedHistory.operation.intent.requestId, startedAt: new Date().toISOString(),
      readonlyContinuation: true, mutationAllowed: false, policy: 'Independent read-only completion. Original failed erasure and its claim remain immutable.' });
    evidence.claimed = true; persist('readonly-case-claimed');
  }

  async function authority() {
    const relative = 'campaign-authority/' + args.get('campaign-plan') + '.json', full = owned(relative), bytes = fs.readFileSync(full), plan = JSON.parse(bytes);
    check(plan.schemaVersion === 1 && plan.status === 'approved-fate-private-campaign' && plan.campaignId === campaign
      && plan.productionAccess === false && plan.restoredDatabase === false && plan.origin === origin && plan.api === api
      && plan.apiPid === evidence.health.api.pid && plan.uiPid === evidence.health.ui.pid
      && plan.fixtureInitialInputSha256 === fixture.initialInputSha256 && plan.digestId === fixture.privacy.digestId
      && plan.inputSnapshotId === evidence.inputSnapshot.id && Array.isArray(plan.allowedCases) && plan.allowedCases.includes(selected), 'F2QA_CAMPAIGN_AUTHORITY');
    const initial = readEvidence(plan.initialStateFile, plan.initialStateSha256), bounce = readEvidence(plan.emptyBounceFile, plan.emptyBounceSha256),
      freeze = readEvidence(plan.candidateFreezeFile, plan.candidateFreezeSha256), cases = readEvidence(plan.casePlanFile, plan.casePlanSha256);
    check(initial.value.campaignId === campaign && initial.value.apiPid === plan.apiPid
      && initial.value.state.initialInputSha256 === fixture.initialInputSha256, 'F2QA_INITIAL_IDENTITY');
    const zero = initial.value.state;
    check(zero.noSeededPrivateOrBattleOutcomes === true && zero.commands.length === 0, 'F2QA_EMPTY_ORIGINAL');
    for (const realm of ['permanent', 'season']) {
      check(Object.entries(zero.databases[realm].counts).every(([name, n]) => !name.startsWith('rpg_fate_') || n === 0), 'F2QA_INITIAL_FATE_OUTCOMES');
      for (const table of ['rpg_boss_instances', 'rpg_boss_attacks', 'rpg_parties', 'rpg_party_members', 'rpg_party_operations']) check(zero.databases[realm].counts[table] === 0, 'F2QA_INITIAL_BATTLE_OUTCOMES');
    }
    const b = bounce.value;
    check(b.status === 'passed-empty-independent-api-bounce' && b.campaignId === campaign && b.apiPid === plan.apiPid
      && b.fixtureInitialInputSha256 === fixture.initialInputSha256 && b.dbClockPreserved === true && b.zeroFateOutcomes === true, 'F2QA_EMPTY_BOUNCE');
    check(cases.value.schemaVersion === 1 && Array.isArray(cases.value.cases) && cases.value.cases.some(c => c.id === selected), 'F2QA_CASE_PLAN');
    check(Array.isArray(freeze.value.sources), 'F2QA_SOURCE_FREEZE');
    const frozen = Object.fromEntries(freeze.value.sources.map(row => [row.path, row.sha256]));
    for (const [file, hash] of Object.entries(evidence.sourceBefore)) check(frozen[file] === hash, 'F2QA_FROZEN_SOURCE');
    continuationAuthority(plan, freeze); erasedHistoryAuthority(plan, freeze);
    const expectedPredecessor = selected === 'final-layout' && erasedHistory ? 'erased-history-readonly'
      : selected === 'scope-late' && plan.continuation ? plan.continuation.case : definition.predecessor;
    check(cases.value.cases.find(c => c.id === selected).predecessor === expectedPredecessor, 'F2QA_CASE_PREDECESSOR_PLAN');
    if (definition.erasedHistory) {
      check(!prior && !bridge && erasedHistory, 'F2QA_ERASURE_ARGUMENTS');
      same(checkpoint(fixture), erasedHistory.failed.value.finalCheckpoint, 'F2QA_ERASURE_CURRENT_STATE');
    } else if (definition.continuation) {
      check(!prior && !bridge && continuation, 'F2QA_CONTINUATION_ARGUMENTS');
      same(checkpoint(fixture), continuation.failed.value.finalCheckpoint, 'F2QA_CONTINUATION_CURRENT_STATE');
    } else if (definition.bridge) {
      check(bridge.value.health.api.pid === plan.apiPid && bridge.value.fixture.initialInputSha256 === fixture.initialInputSha256
        && bridge.value.fixture.digestId === fixture.privacy.digestId, 'F2QA_ORIGINAL_BRIDGE_API');
    } else if (expectedPredecessor) {
      check(prior?.value.ok === true && prior.value.status === 'passed' && prior.value.case === expectedPredecessor
        && prior.value.health.api.pid === plan.apiPid && prior.value.authority.sha256 === sha(bytes), 'F2QA_EXACT_PREDECESSOR');
      same(prior.value.finalCheckpoint, checkpoint(fixture), 'F2QA_PREDECESSOR_STATE');
      same(prior.value.sourceAfter, evidence.sourceBefore, 'F2QA_PREDECESSOR_SOURCE');
    } else { check(!prior, 'F2QA_UNEXPECTED_PREDECESSOR'); same(checkpoint(zero), checkpoint(fixture), 'F2QA_INITIAL_STATE_CHANGED'); }
    evidence.authority = { file: relative, sha256: sha(bytes), initialStateFile: plan.initialStateFile,
      initialStateSha256: plan.initialStateSha256, emptyBounceFile: plan.emptyBounceFile, emptyBounceSha256: plan.emptyBounceSha256,
      candidateFreezeFile: plan.candidateFreezeFile, candidateFreezeSha256: plan.candidateFreezeSha256,
      casePlanFile: plan.casePlanFile, casePlanSha256: plan.casePlanSha256, restoredDatabase: false };
    if (prior) evidence.previousRun = { runId: prior.value.runId, sha256: prior.sha256 };
    if (bridge) evidence.bridgeRun = { runId: bridge.value.runId, sha256: bridge.sha256, originalStatus: bridge.value.status };
  }
  function claim() {
    check(definition.mutation && !stopMutations, 'F2QA_MUTATION_NOT_ALLOWED');
    if (evidence.claimed) return;
    const root = path.join(campaignRoot, 'case-claims'); fs.mkdirSync(root, { recursive: true });
    const value = { schemaVersion: 1, case: selected, runId, campaign, apiPid: evidence.health.api.pid,
      fixtureInitialInputSha256: fixture.initialInputSha256, digestId: fixture.privacy.digestId,
      authoritySha256: evidence.authority.sha256, startedAt: new Date().toISOString(), policy: 'Original case only. A failed or uncertain case is never replayed.',
      ...(definition.continuation ? { originalFailedRunSha256: continuation.failed.sha256, originalRequestId: continuation.intent.requestId, independentContinuation: true } : {}) };
    writeNew(path.join(root, selected + '.json'), value); evidence.claimed = true; persist('case-claimed');
  }
  const button = (name, attribute, value) => frame.locator('[data-sfp-action=' + JSON.stringify(name) + ']' + (attribute ? '[' + attribute + '=' + JSON.stringify(value) + ']' : ''));
  const field = name => frame.locator('[data-sfp-field=' + JSON.stringify(name) + ']');
  const raf = () => frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function ready() {
    await frame.waitForFunction(() => { const root = document.querySelector('.sfp-window'), refresh = root?.querySelector('[data-sfp-action="refresh"]'); return root?.dataset.sfpReady === 'true' && refresh && !refresh.disabled && refresh.textContent.trim() === '重新整理'; });
    await raf();
  }
  async function openPrivate(tab = 'profile', remount = false) {
    if (remount) await frame.evaluate(() => window.RpgSceneNavigation.navigate('inventory'));
    await frame.evaluate(() => window.RpgSceneNavigation.navigate('fate', { section: 'private' }));
    await frame.waitForFunction(() => document.querySelector('.scene-unified-dialog')?.dataset.route === 'fate');
    const section = frame.locator('.sf-sections [data-sf-action="section"][data-sf-section="private"]');
    await section.waitFor(); if (await section.getAttribute('aria-selected') !== 'true') await section.click();
    await ready();
    const target = button('tab', 'data-sfp-tab', tab);
    if (await target.getAttribute('aria-selected') !== 'true') { await target.click(); await ready(); }
    check(await frame.locator('.scene-unified-dialog').count() === 1 && page.context().pages().length === 1, 'F2QA_SHARED_WINDOW');
  }
  async function choose(next) {
    let context = await frame.evaluate(() => window.RpgSceneSession.getContext());
    if (String(context.accountId) !== next.accountId || context.realmId !== next.realmId) {
      await frame.evaluate(async a => { window.RpgSceneSession.setContext({ accountId: a.accountId, realmId: a.realmId, characterId: null }); await window.RpgSceneSession.refresh({ force: true }); }, actorMetadata(next));
      context = await frame.evaluate(() => window.RpgSceneSession.getContext());
    }
    if (String(context.characterId) !== next.characterId) {
      await frame.locator('[data-scene-primary="character"]').click(); await frame.locator('[data-scene-route="characters"]').click();
      const entry = frame.locator('.scene-social-body button.scene-atlas-entry').filter({ hasText: next.name });
      await entry.waitFor(); check(await entry.count() === 1, 'F2QA_EXACT_ACTOR_SELECTION'); await entry.click();
    }
    await frame.waitForFunction(id => String(window.RpgSceneSession.getSnapshot()?.characterId) === id, next.characterId);
    actor = next; await raf();
  }
  async function shot(name, failed = false) {
    check(/^[a-z0-9_-]{1,100}$/.test(name), 'F2QA_SCREENSHOT_NAME');
    const masks = [frame.locator('[data-sfp-private], input, textarea, select, [data-sfp-error], .sf-error, .sf-story, .sf-story-pane')];
    if (failed) masks.push(frame.locator('.scene-unified-dialog'));
    const file = name + '.png'; await page.screenshot({ path: path.join(dir, file), fullPage: true, mask: masks, maskColor: '#30343b' });
    evidence.screenshots.push({ name, file, sha256: sha(fs.readFileSync(path.join(dir, file))), privateFieldsAndNotesMasked: true, failureDialogMasked: failed }); persist();
  }
  async function geometry(label) {
    const g = await frame.evaluate(() => {
      const card = document.querySelector('.scene-social-card'), body = document.querySelector('.scene-social-body'), root = document.querySelector('.sfp-window');
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, card: card.getBoundingClientRect().toJSON(),
        bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
        controls: [...root.querySelectorAll('button,select,input,summary')].map(el => {
          const target = el.type === 'checkbox' ? el.closest('label') || el : el;
          return { key: el.getAttribute('data-sfp-action') || el.getAttribute('data-sfp-field') || el.tagName, rect: target.getBoundingClientRect().toJSON() };
        }).filter(row => row.rect.width && row.rect.height) };
    });
    check(g.card.left >= -1 && g.card.right <= g.viewport + 1 && g.scrollWidth <= g.viewport + 1 && g.bodyScrollWidth <= g.bodyWidth + 1, 'F2QA_HORIZONTAL_LAYOUT');
    for (const c of g.controls) check(c.rect.width >= 43.5 && c.rect.height >= 43.5, 'F2QA_CONTROL_TARGET');
    evidence.geometry ??= []; evidence.geometry.push({ label, ...g }); persist();
  }
  async function storageSafe() {
    const result = await frame.evaluate(markers => {
      const stores = [sessionStorage, localStorage]; let pendingCount = 0, bad = false;
      for (const store of stores) for (const key of Object.keys(store)) {
        const text = store.getItem(key) || '';
        if (markers.some(marker => marker.length >= 8 && text.includes(marker))) bad = true;
        if (key.startsWith('rpg-sfp-pending:')) {
          pendingCount++;
          try {
            const value = JSON.parse(text), walk = node => { if (!node || typeof node !== 'object') return; for (const [name, child] of Object.entries(node)) { if (/^(birth|birthDate|birth_json|chart|chart_json|notes|notes_json|payloadHash|payload_hash)$/i.test(name)) bad = true; walk(child); } }; walk(value);
          } catch { bad = true; }
        }
      }
      return { privateCopiesAbsent: !bad, pendingCount, rawStorageWithheld: true };
    }, [...privateMarkers]);
    check(result.privateCopiesAbsent, 'F2QA_PRIVATE_BROWSER_STORAGE'); evidence.storageChecks ??= []; evidence.storageChecks.push(result); persist();
  }
  async function rpc(who, endpoint, body = {}, expectedStatus = 200) {
    check(PRIVATE_READS.has(endpoint), 'F2QA_DIRECT_WRITE_FORBIDDEN');
    const payload = { ...body, realmId: who.realmId, selectedCharacterId: who.characterId };
    const intent = endpoint.endsWith('/receipt') ? qa.qaPrivatePublicIntent(payload) : { realmId: who.realmId, selectedCharacterId: who.characterId, ...(integer(payload.readSequence) ? { readSequence: payload.readSequence } : {}) };
    const entry = { endpoint, actor: actorMetadata(who), intent, status: 'sending' }; evidence.requests.push(entry); persist('pure-request-prepared');
    const response = await fetch(api + '/app/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dev-tg-id': who.accountId, 'x-realm-id': who.realmId }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    const value = await response.json(), clean = safeResponse(value);
    if (endpoint.endsWith('/receipt')) noPrivateReceiptFields(value);
    Object.assign(entry, { status: response.status, response: clean }); persist('pure-request-observed');
    check(response.status === expectedStatus && (expectedStatus !== 200 || clean.ok), 'F2QA_PURE_RESPONSE'); return value;
  }
  async function pure(label, who = actor, requests = []) {
    const before = await state(); let value;
    for (let n = 0; n < 2; n++) { value = await rpc(who, 'fate/private/scene', { readSequence: n }); for (const item of requests) await rpc(who, item.endpoint, item.body || {}); }
    const after = await state(); same(databaseEvidence(after), databaseEvidence(before), 'F2QA_PURE_WROTE_DATABASE');
    evidence.pureReads.push({ label, actor: actorMetadata(who), before: databaseEvidence(before), after: databaseEvidence(after) }); persist(); return value;
  }
  async function confirmation() {
    const panel = frame.locator('[data-sfp-confirm]'); await panel.waitFor(); await raf();
    const detail = await panel.evaluate(el => { const body = document.querySelector('.scene-social-body'), r = el.getBoundingClientRect(), b = body.getBoundingClientRect(); return { visible: r.top >= Math.max(0, b.top) - 1 && r.bottom <= Math.min(innerHeight, b.bottom) + 1, cancelFocused: document.activeElement === el.querySelector('[data-sfp-action="cancel"]') }; });
    check(detail.visible && detail.cancelFocused, 'F2QA_CONFIRMATION_FOCUS'); return detail;
  }
  async function stageAction(control) {
    await control.click(); await confirmation(); const count = evidence.operations.length;
    await button('cancel').click(); await raf(); check(evidence.operations.length === count, 'F2QA_CANCEL_SENT_ACTION');
    check(await control.evaluate(el => el === document.activeElement), 'F2QA_RETURN_FOCUS');
    await control.press('Enter'); await confirmation();
  }
  function rememberPrivate(body) {
    for (const value of [body.birthDate, body.birth?.date, body.birth?.placeLabel]) if (typeof value === 'string' && value.length >= 8) privateMarkers.add(value);
  }
  async function captureMutation(route, endpoint, rawBody) {
    if (definition.continuation) {
      check(continuation && !continuation.cancelAttempted, 'F2QA_CONTINUATION_SINGLE_CANCEL');
      continuationCancelOnly(endpoint, rawBody, continuation.intent); continuation.cancelAttempted = true;
    }
    check(definition.mutation && evidence.claimed && !stopMutations && prepared, 'F2QA_UNPREPARED_MUTATION');
    const publicIntent = qa.qaPrivatePublicIntent(rawBody); rememberPrivate(rawBody);
    check(rawBody.realmId === prepared.actor.realmId && rawBody.selectedCharacterId === prepared.actor.characterId, 'F2QA_MUTATION_SCOPE');
    check(!prepared.intent, 'F2QA_DUPLICATE_SUBMISSION'); prepared.intent = publicIntent; prepared.endpoint = endpoint;
    inMemoryBodies.set(publicIntent.requestId, JSON.stringify(rawBody));
    const before = await state();
    if (definition.continuation) {
      const realm = continuation.actor.realmId === 'permanent' ? before.permanent : before.season;
      check(!realm.operations.some(row => row.accountId === continuation.actor.accountId && row.requestKey === 'private:app:' + continuation.intent.requestId), 'F2QA_CONTINUATION_EXISTING_OUTCOME');
      same(checkpoint(before), continuation.failed.value.finalCheckpoint, 'F2QA_CONTINUATION_FRESH_CHECKPOINT');
    }
    prepared.before = slimCheckpoint(before); prepared.state = 'original-request-captured';
    event('original-intent', { actor: prepared.actor, endpoint, intent: publicIntent, before: prepared.before }); persist('original-intent-persisted');
    const fault = activeFault; activeFault = null;
    if (fault === 'unsent') {
      prepared.state = 'not-sent-intercepted'; prepared.after = slimCheckpoint(await state());
      same(prepared.after.databases, prepared.before.databases, 'F2QA_UNSENT_WROTE_DATABASE');
      event('original-unsent', { actor: prepared.actor, endpoint, intent: publicIntent, before: prepared.before, after: prepared.after }); persist('original-unsent-preserved');
      await route.abort('failed'); return;
    }
    const response = await route.fetch({ timeout: 20000, maxRetries: 0 }), value = await response.json();
    const clean = safeResponse(value); noPrivateReceiptFields(value);
    for (const secret of privateMarkers) check(!JSON.stringify(value).includes(secret), 'F2QA_PRIVATE_RESULT_COPY');
    const after = await state();
    Object.assign(prepared, { status: response.status(), response: clean, after: slimCheckpoint(after), state: 'original-response-observed' });
    event('original-response', { actor: prepared.actor, endpoint, intent: publicIntent, status: response.status(), response: clean, before: prepared.before, after: prepared.after }); persist('original-response-persisted');
    check(response.status() === 200 && clean.ok && clean.requestId === publicIntent.requestId && clean.kind === publicIntent.kind
      && clean.intentNonce === publicIntent.intentNonce, 'F2QA_ORIGINAL_OPERATION_RESPONSE');
    const receipt = qa.qaPrivateReceipt(value.receipt), realm = prepared.actor.realmId === 'permanent' ? after.permanent : after.season;
    const op = realm.operations.find(row => row.accountId === prepared.actor.accountId && row.requestKey === receipt.requestKey);
    const ledger = realm.ledger.find(row => row.eventId === 'fate-private-receipt:' + prepared.actor.characterId + ':' + receipt.requestKey);
    check(op?.private === true && op.kind === receipt.kind && op.outcome === receipt.outcome && op.proofId === receipt.authority.proofId, 'F2QA_ORIGINAL_AUTHORITY');
    same(op.result, receipt.result, 'F2QA_AUTHORITY_RESULT');
    check(ledger?.type === '命運私人操作收據' && ledger.goldDelta === 0 && ledger.expDelta === 0 && ledger.itemDelta === 0 && ledger.item === null, 'F2QA_TYPED_LEDGER');
    same(qa.qaPrivateReceipt(ledger.receipt), receipt, 'F2QA_TYPED_RECEIPT');
    same(resourceState(after), resourceState(before), 'F2QA_PRIVATE_RESOURCE_CHANGE');
    const operation = { actor: prepared.actor, endpoint, intent: publicIntent, response: clean, authority: { requestKey: receipt.requestKey, proofId: receipt.authority.proofId, originalOperationVerified: true, typedLedgerVerified: true },
      before: prepared.before, after: prepared.after, zeroGoldExpInventoryGiftChange: true, responseLostToBrowser: fault === 'committed' };
    prepared.state = fault === 'committed' ? 'committed-response-withheld' : 'committed-response-delivered'; prepared.operationIndex = evidence.operations.length;
    evidence.operations.push(operation); event('verified-operation', operation); persist('original-authority-verified');
    if (fault === 'committed') await route.abort('failed'); else await route.fulfill({ response });
  }
  async function submit(control, label, { staged = false, fault = null, endpoint = 'fate/private/action-scoped' } = {}) {
    claim(); if (!staged) await stageAction(control);
    prepared = { label, actor: actorMetadata(actor), state: 'prepared', preparedAt: new Date().toISOString() };
    evidence.submissions.push(prepared); activeFault = fault; persist('before-original-confirm');
    const row = prepared;
    await button('confirm').click();
    await deadline(async () => {
      while (!stopMutations && !['committed-response-withheld', 'committed-response-delivered', 'not-sent-intercepted', 'failed'].includes(row.state)) await new Promise(resolve => setTimeout(resolve, 40));
      check(!stopMutations, 'F2QA_ORIGINAL_CAPTURE_STOPPED');
    }, 'F2QA_ORIGINAL_CAPTURE_TIMEOUT');
    check(row.state !== 'failed' && row.endpoint === endpoint, 'F2QA_ORIGINAL_CAPTURE_FAILED');
    if (fault) await pendingReady(row.intent.requestId); else await ready();
    await storageSafe(); return row;
  }
  async function deadline(task, code, ms = 30000) {
    let timer; try { return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(error(code)), ms); })]); } finally { clearTimeout(timer); }
  }
  async function pendingReady(id) {
    await button('check-pending', 'data-sfp-pending-id', id).waitFor();
    await frame.waitForFunction(id => { const b = document.querySelector('[data-sfp-action="check-pending"][data-sfp-pending-id="' + id + '"]'); return b && !b.disabled && b.textContent.trim() !== '核對中…'; }, id); await raf();
  }
  async function checkPending(id, found) {
    const before = await state(), count = evidence.operations.length;
    const waiting = page.waitForResponse(r => r.url().split('?')[0] === api + '/app/api/fate/private/receipt' && r.request().method() === 'POST');
    await button('check-pending', 'data-sfp-pending-id', id).click(); const response = await waiting, value = await response.json();
    const clean = safeResponse(value); noPrivateReceiptFields(value);
    check(response.status() === 200 && clean.found === found && clean.requestId === id, 'F2QA_PENDING_LOOKUP');
    await pendingReady(id);
    if (found) await button('acknowledge', 'data-sfp-pending-id', id).waitFor();
    else if (clean.cancellationAllowed) await button('end-pending', 'data-sfp-pending-id', id).waitFor();
    same(databaseEvidence(await state()), databaseEvidence(before), 'F2QA_PENDING_LOOKUP_WROTE');
    check(evidence.operations.length === count, 'F2QA_LOOKUP_REPLAYED');
    event('pending-lookup', { requestId: id, response: clean, databaseUnchanged: true }); persist('original-id-looked-up'); return value;
  }
  async function acknowledge(id) {
    const count = evidence.operations.length; await button('acknowledge', 'data-sfp-pending-id', id).click();
    await button('check-pending', 'data-sfp-pending-id', id).waitFor({ state: 'detached' }); await ready();
    check(evidence.operations.length === count, 'F2QA_ACKNOWLEDGE_REPLAYED');
  }
  const birthInput = () => ({ date: String(crypto.randomInt(1980, 2001)) + '-' + String(crypto.randomInt(1, 13)).padStart(2, '0') + '-' + String(crypto.randomInt(1, 28)).padStart(2, '0'), label: '驗收地點' + crypto.randomBytes(8).toString('hex') });
  async function fillBirth(input, detailed = false) {
    await openPrivate('profile'); await field('date').fill(input.date); privateMarkers.add(input.date);
    if (detailed) {
      const details = frame.locator('[data-sfp-details="more"]'); if (!await details.evaluate(el => el.open)) await details.locator('summary').click();
      await field('time').fill('00:00'); await field('placeId').selectOption('custom');
      await field('placeLabel').fill(input.label); privateMarkers.add(input.label);
      await field('zone').fill('UTC'); await field('lat').fill('0'); await field('lon').fill('0'); await field('sex').selectOption('');
    }
    await field('consent').uncheck();
  }
  async function originalReceipt(operation) {
    const before = await state(), result = await rpc(operation.actor, 'fate/private/receipt', operation.intent);
    check(result.found === true, 'F2QA_ORIGINAL_RECEIPT_MISSING');
    same(qa.qaPrivateReceipt(result.receipt), operation.response.receipt, 'F2QA_ORIGINAL_RECEIPT_CHANGED');
    same(databaseEvidence(await state()), databaseEvidence(before), 'F2QA_RECEIPT_WROTE'); return result;
  }
  async function command(op, fields = {}) {
    check(!definition.continuation && !erasedHistory, 'F2QA_CONTINUATION_COMMAND_FORBIDDEN');
    claim(); const before = await state(), requestId = 'f2qa_' + runId + '_' + (++commandSerial);
    const body = { requestId, op, expectedNow: before.qaClock.now, ...fields };
    check(Object.keys(body).every(key => ['requestId', 'op', 'expectedNow', 'lifeId', 'bossId', 'partyId', 'characterId', 'kind', 'round', 'at', 'tier'].includes(key)), 'F2QA_COMMAND_ALLOWLIST');
    const record = { input: body, status: 'prepared', before: slimCheckpoint(before) }; evidence.commands.push(record); event('command-intent', record); persist('original-command-prepared');
    const response = await fetch(api + '/__preview/fate-private-qa/advance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    check(response.status === 200, 'F2QA_COMMAND_HTTP'); const value = await response.json();
    check(value.ok === true && value.requestId === requestId && value.op === op && value.productionAccess === false, 'F2QA_COMMAND_RESPONSE');
    const after = await state(), result = {};
    for (const name of ['lifeId', 'bossId', 'partyId', 'characterId', 'originalService', 'op', 'status', 'kind']) if (typeof value.result?.[name] === 'string' && /^[A-Za-z0-9:_.-]{1,128}$/.test(value.result[name])) result[name] = value.result[name];
    for (const name of ['from', 'to']) check(integer(value[name]), 'F2QA_COMMAND_CLOCK');
    for (const name of ['damage', 'bossHp', 'tier', 'round', 'floor', 'originalLifeMs']) if (integer(value.result?.[name])) result[name] = value.result[name];
    for (const name of ['killed', 'spawned', 'manualForceOriginalOption', 'manualSubmission']) if (typeof value.result?.[name] === 'boolean') result[name] = value.result[name];
    if (Array.isArray(value.result?.dueLifeIds)) { check(value.result.dueLifeIds.every(identifier), 'F2QA_COMMAND_IDS'); result.dueLifeIds = [...value.result.dueLifeIds]; }
    Object.assign(record, { status: 'completed', result, from: value.from, to: value.to, clockOnly: value.clockOnly === true, after: slimCheckpoint(after) });
    event('command-result', record); persist('original-command-recorded'); return result;
  }
  async function completeLife(lifeId) {
    await command('life-end', { lifeId }); await command('fate-sweep'); const s = await state();
    check(s.permanent.lives.find(row => row.id === lifeId)?.status === 'complete', 'F2QA_ORIGINAL_LIFE_NOT_COMPLETE');
    await openPrivate('profile', true);
  }
  async function syncDaily(expectedUnlocked) {
    await openPrivate('daily'); const row = await submit(button('sync-daily'), 'explicit-daily-sync');
    const operation = evidence.operations[row.operationIndex]; check(operation.response.result.unlocked === expectedUnlocked, 'F2QA_DAILY_UNLOCK_COUNT');
    await originalReceipt(operation); const view = await pure('daily-after-explicit-sync');
    check(view.privateFate.daily.notes.length === 3 && view.privateFate.daily.unlocked === expectedUnlocked, 'F2QA_THREE_DAILY_NOTES');
    for (let i = 0; i < view.privateFate.daily.notes.length; i++) {
      const n = view.privateFate.daily.notes[i]; check(n.locked === (i >= expectedUnlocked), 'F2QA_NOTE_LOCK_ORDER');
      if (!n.locked) for (const v of Object.values(n)) if (typeof v === 'string' && v.length >= 18) privateMarkers.add(v);
    }
    await storageSafe(); await shot('daily-unlocked-' + expectedUnlocked); return operation;
  }
  async function layoutRegion(name, target) {
    await target.scrollIntoViewIfNeeded(); await raf();
    const region = await target.evaluate(el => {
      const body = document.querySelector('.scene-social-body'), rect = el.getBoundingClientRect(), b = body.getBoundingClientRect();
      let clip = { left: Math.max(0, b.left), top: Math.max(0, b.top), right: Math.min(innerWidth, b.right), bottom: Math.min(innerHeight, b.bottom) };
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), p = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) { clip.left = Math.max(clip.left, p.left); clip.right = Math.min(clip.right, p.right); }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) { clip.top = Math.max(clip.top, p.top); clip.bottom = Math.min(clip.bottom, p.bottom); }
      }
      const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const unoccluded = !!center && (center === el || el.contains(center));
      return { target: rect.toJSON(), body: b.toJSON(), viewport: { width: innerWidth, height: innerHeight }, clip,
        fullyVisible: rect.width > 0 && rect.height > 0 && rect.left >= clip.left - 1 && rect.right <= clip.right + 1
          && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1, unoccluded };
    });
    check(region.fullyVisible && region.unoccluded, 'F2QA_LAYOUT_REGION_NOT_VISIBLE');
    evidence.visibleRegions ??= []; evidence.visibleRegions.push({ name, ...region, valuesWithheld: true });
    await geometry(name); await shot(name);
  }
  async function layouts(final = false) {
    for (const [width, height] of [[320, 740], [390, 844], [1280, 900]]) {
      await page.setViewportSize({ width, height }); await raf();
      for (const tab of ['profile', 'daily']) {
        await openPrivate(tab); const name = (final ? 'final-' : '') + width + '-' + tab;
        await geometry(name); await shot(name);
        if (tab === 'profile') {
          await layoutRegion(name + '-birth', field('date'));
          await layoutRegion(name + '-save', button('save-profile'));
          await layoutRegion(name + '-birthday', button('birthday-start'));
          const deletion = button('delete-profile');
          if (await deletion.count()) await layoutRegion(name + '-delete', deletion);
          else { evidence.absentLayoutRegions ??= []; evidence.absentLayoutRegions.push({ name: name + '-delete', reason: 'not-offered-in-current-state' }); }
        } else {
          await layoutRegion(name + '-sync', button('sync-daily'));
          for (let n = 0; n < 3; n++) await layoutRegion(name + '-note-' + (n + 1), frame.locator('.sfp-notes > .sfp-note > header').nth(n));
          const history = frame.locator('.sfp-window > .sfp-card').last(), lastOperation = history.locator('[data-sfp-action="history-receipt"]').last();
          await layoutRegion(name + '-bottom', await lastOperation.count() ? lastOperation : history.locator('p.sfp-muted').last());
        }
      }
      note((final ? 'final-' : '') + width + '-shared-window-layout');
    }
    await page.setViewportSize({ width: 390, height: 844 }); await openPrivate();
  }
  async function imeRefresh() {
    const input = birthInput(); await fillBirth(input, true);
    await field('placeLabel').focus();
    await frame.evaluate(value => { const el = document.querySelector('[data-sfp-field="placeLabel"]'); window.__f2qaEditElement = el;
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })); el.value = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertCompositionText', isComposing: true })); }, input.label);
    const counts = () => Object.fromEntries(['fate/private/scene', 'fate/scene', 'atlas/status'].map(endpoint => [endpoint, evidence.requests.filter(row => row.endpoint === endpoint).length]));
    const beforeReads = counts();
    await new Promise(resolve => setTimeout(resolve, 16500));
    const preserved = await frame.evaluate(value => { const el = window.__f2qaEditElement; return { connected: el.isConnected, identical: el === document.querySelector('[data-sfp-field="placeLabel"]'), focused: el === document.activeElement, valuePreserved: el.value === value }; }, input.label);
    check(Object.values(preserved).every(Boolean), 'F2QA_IME_DOM_REPLACED');
    const afterReads = counts(), compositionPolls = Object.fromEntries(Object.keys(beforeReads).map(endpoint => [endpoint, afterReads[endpoint] - beforeReads[endpoint]]));
    check(compositionPolls['fate/scene'] >= 1 && compositionPolls['atlas/status'] >= 1, 'F2QA_IME_BACKGROUND_TICK_MISSING');
    evidence.editingProof = { composition: preserved, pollWaitMs: 16500, compositionPolls };
    await frame.evaluate(value => { const el = window.__f2qaEditElement; el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value })); el.blur(); delete window.__f2qaEditElement; }, input.label);
    const refreshed = page.waitForResponse(r => r.url().split('?')[0] === api + '/app/api/fate/private/scene', { timeout: 22000 }); await refreshed; await ready();
    await field('date').focus(); await frame.evaluate(() => { window.__f2qaDateElement = document.querySelector('[data-sfp-field="date"]'); });
    const beforeDateReads = counts();
    await new Promise(resolve => setTimeout(resolve, 16500));
    const datePreserved = await frame.evaluate(value => { const el = window.__f2qaDateElement; const result = { connected: el.isConnected, identical: el === document.querySelector('[data-sfp-field="date"]'), focused: el === document.activeElement, valuePreserved: el.value === value }; el.blur(); delete window.__f2qaDateElement; return result; }, input.date);
    check(Object.values(datePreserved).every(Boolean), 'F2QA_EDIT_DOM_REPLACED'); evidence.editingProof.normalInput = datePreserved;
    const afterDateReads = counts(), normalPolls = Object.fromEntries(Object.keys(beforeDateReads).map(endpoint => [endpoint, afterDateReads[endpoint] - beforeDateReads[endpoint]]));
    check(normalPolls['fate/scene'] >= 1 && normalPolls['atlas/status'] >= 1, 'F2QA_EDIT_BACKGROUND_TICK_MISSING'); evidence.editingProof.normalPolls = normalPolls;
    await button('clear-private').click(); await ready(); check(await field('date').inputValue() === '', 'F2QA_CLEAR_PRIVATE_INPUT');
    await storageSafe(); await shot('ime-and-refresh-redacted'); note('ime-normal-edit-survives-poll-and-clear-remains-immediate');
  }
  async function birthday(source) {
    const before = await state(); await openPrivate('profile', true);
    if (source === 'temporary') { check(before.permanent.profiles.length === 0, 'F2QA_TEMPORARY_START_SAVED_PROFILE'); await fillBirth(birthInput()); }
    else { check(before.permanent.profiles.some(row => row.accountId === main.accountId), 'F2QA_SAVED_PROFILE_REQUIRED'); await button('clear-private').click(); await ready(); }
    await field('source').selectOption(source); await field('country').selectOption('TW'); await field('showSign').uncheck();
    const row = await submit(button('birthday-start'), source + '-birthday-start'), operation = evidence.operations[row.operationIndex];
    check(operation.intent.source === source && operation.response.receipt.costs.dailyStarts === 1, 'F2QA_BIRTHDAY_SOURCE');
    const raw = JSON.parse(inMemoryBodies.get(operation.intent.requestId));
    check(source === 'temporary' ? typeof raw.birthDate === 'string' && !Object.hasOwn(raw, 'birth') : !Object.hasOwn(raw, 'birthDate') && !Object.hasOwn(raw, 'birth'), 'F2QA_BIRTHDAY_PRIVATE_BOUNDARY');
    const after = await state(); check(after.permanent.lives.length === before.permanent.lives.length + 1, 'F2QA_BIRTHDAY_ORIGINAL_LIFE');
    if (source === 'temporary') check(after.permanent.profiles.length === 0 && after.permanent.daily.length === 0, 'F2QA_TEMPORARY_PERSISTED_PROFILE');
    await originalReceipt(operation); await shot(source + '-birthday-redacted'); await completeLife(operation.response.result.lifeId); note(source + '-birthday-original-start-and-original-timing');
  }
  async function profiles() {
    const first = birthInput(); await fillBirth(first, true); const count = evidence.operations.length;
    await button('save-profile').click(); await raf(); check(await frame.locator('[data-sfp-confirm]').count() === 0 && evidence.operations.length === count, 'F2QA_CONSENT_BYPASSED');
    await field('consent').check(); const saved = await submit(button('save-profile'), 'consented-profile-save');
    await originalReceipt(evidence.operations[saved.operationIndex]);
    const viewing = page.waitForResponse(r => r.url().split('?')[0] === api + '/app/api/fate/private/profile'); await button('view-profile').click();
    const response = await viewing, value = await response.json(); check(response.status() === 200 && value.privateProfile.profile.birth.date === first.date, 'F2QA_EXPLICIT_OWNER_REVEAL');
    await frame.waitForFunction(value => document.querySelector('[data-sfp-field="date"]')?.value === value, first.date); await ready();
    check(await field('date').inputValue() === first.date, 'F2QA_REVEALED_FORM'); await storageSafe();
    const second = birthInput(); await button('clear-private').click(); await ready(); await fillBirth(second); await field('consent').check();
    const updated = await submit(button('save-profile'), 'consented-profile-update'); await originalReceipt(evidence.operations[updated.operationIndex]);
    const fresh = await rpc(main, 'fate/private/profile'); check(fresh.privateProfile.profile.birth.date === second.date, 'F2QA_UPDATED_PRIVATE_PROFILE');
    await shot('saved-profile-redacted'); note('consent-owner-view-update-and-zero-resource-cost');
  }
  async function battleUnlocks() {
    const spawn = await command('boss-spawn', { tier: 1 }), bossId = spawn.bossId;
    for (let n = 0; n < 12; n++) {
      const result = await command('boss-attack', { bossId, characterId: main.characterId }); if (result.killed) break;
      await command('boss-next-window', { bossId });
    }
    let s = await state(); check(s.permanent.bosses.find(row => row.id === bossId)?.status === 'killed'
      && s.evidence[main.accountId].some(row => row.id === 'boss'), 'F2QA_ORIGINAL_BOSS_EVIDENCE');
    await syncDaily(1);
    for (const kind of ['dungeon', 'tower']) {
      const created = await command('party-create', { kind, characterId: main.characterId }), partyId = created.partyId;
      for (const member of fixture.partyRoster.slice(1)) await command('party-join', { partyId, characterId: member.characterId });
      for (const member of fixture.partyRoster) await command('party-ready', { partyId, characterId: member.characterId });
      await command('party-start', { partyId, characterId: main.characterId });
      for (let turn = 0; turn < 80; turn++) {
        s = await state(); const party = s.permanent.parties.find(row => row.id === partyId);
        if (kind === 'dungeon' && party.status === 'won' || kind === 'tower' && party.journalFloors.length >= 5) break;
        check(party.status === 'combat', 'F2QA_ORIGINAL_BATTLE_NOT_PLAYABLE');
        for (const member of fixture.partyRoster) await command('party-submit', { partyId, characterId: member.characterId, round: party.round });
        await command('party-deadline', { partyId }); await command('party-sweep', { partyId });
      }
      s = await state(); const party = s.permanent.parties.find(row => row.id === partyId);
      check(new Set(s.permanent.members.filter(row => row.partyId === partyId).map(row => row.accountId)).size === 3
        && party.actors.every(member => member.manualActions > 0) && s.evidence[main.accountId].some(row => row.id === kind), 'F2QA_ORIGINAL_PARTY_EVIDENCE');
      if (kind === 'dungeon') check(party.status === 'won', 'F2QA_DUNGEON_NOT_WON');
      else { check(party.journalFloors.length >= 5, 'F2QA_TOWER_FLOORS'); await command('party-end', { partyId, characterId: main.characterId }); }
      await syncDaily(kind === 'dungeon' ? 2 : 3);
    }
    evidence.battleBoundary = { originalServices: ['Boss.spawnDue', 'Boss.attackBoss', 'Party.create', 'Party.action', 'Party.sweep'],
      seededResults: false, battleRewardsAllowed: true, onlyIndividualF2IntervalsClaimZeroResources: true, dispatcherStarted: false };
    note('three-real-battle-evidence-kinds-unlock-three-original-notes');
  }
  async function lostCommitted() {
    const input = birthInput(); await fillBirth(input); await field('consent').check();
    const row = await submit(button('save-profile'), 'lost-committed-profile-save', { fault: 'committed' }), id = row.intent.requestId;
    const operation = evidence.operations[row.operationIndex];
    await openPrivate('profile', true); await pendingReady(id); const found = await checkPending(id, true);
    same(qa.qaPrivateReceipt(found.receipt), operation.response.receipt, 'F2QA_LOST_RECEIPT_CHANGED');
    await pure('lost-committed-refresh-is-pure'); await button('refresh').click(); await ready(); await pendingReady(id);
    await acknowledge(id); await originalReceipt(operation);
    check(evidence.submissions.filter(s => s.intent?.requestId === id).length === 1, 'F2QA_LOST_ACTION_REPLAYED');
    await shot('lost-committed-original-recovered'); note('committed-response-loss-recovers-original-id-without-replay');
  }
  async function lostUnsent() {
    const input = birthInput(); await fillBirth(input); await field('consent').check();
    const row = await submit(button('save-profile'), 'lost-unsent-profile-save', { fault: 'unsent' }), id = row.intent.requestId;
    const beforeReload = await state(); await storageSafe();
    await page.reload({ waitUntil: 'domcontentloaded' }); await findFrame(); await choose(main); await openPrivate('profile'); await pendingReady(id);
    check(await field('date').inputValue() === '', 'F2QA_RELOAD_PRIVATE_INPUT_RETAINED');
    const result = await checkPending(id, false); check(result.cancellationAllowed === true && await button('retry', 'data-sfp-pending-id', id).count() === 0, 'F2QA_LOST_MEMORY_RECOVERY');
    await frame.locator('[data-sf-action="section"][data-sf-section="life"]').click();
    await frame.locator('[data-sf-action="tab"][data-sf-tab="overview"]').click();
    check(await frame.locator('[data-sf-action="start"]').isDisabled(), 'F2QA_F1_IGNORED_PRIVATE_PENDING');
    await openPrivate('profile'); await pendingReady(id); await checkPending(id, false);
    const firstIntent = JSON.stringify(row.intent); await button('end-pending', 'data-sfp-pending-id', id).click(); await confirmation();
    const ended = await submit(null, 'same-id-explicit-cancel', { staged: true, endpoint: 'fate/private/cancel' });
    check(JSON.stringify(ended.intent) === firstIntent && ended.response.outcome === 'cancelled', 'F2QA_CANCEL_CHANGED_ORIGINAL_ID');
    const after = await state();
    same(after.permanent.profiles, beforeReload.permanent.profiles, 'F2QA_CANCEL_CHANGED_PROFILE');
    same(after.permanent.daily, beforeReload.permanent.daily, 'F2QA_CANCEL_CHANGED_DAILY');
    await originalReceipt(evidence.operations[ended.operationIndex]); await shot('same-id-cancellation-redacted');
    note('unsent-lost-private-memory-is-explicitly-sealed-with-original-id');
  }
  async function restoreContinuationCache() {
    check(definition.continuation && continuation, 'F2QA_CONTINUATION_SETUP');
    same(actorMetadata(actor), continuation.actor, 'F2QA_CONTINUATION_ACTOR');
    const before = await state(); same(checkpoint(before), continuation.failed.value.finalCheckpoint, 'F2QA_CONTINUATION_CURRENT_STATE');
    const value = await rpc(continuation.actor, 'fate/private/receipt', continuation.intent);
    check(value.found === false && value.cancellationAllowed === true && value.requestId === continuation.intent.requestId, 'F2QA_CONTINUATION_LOOKUP_BEFORE_CACHE');
    same(checkpoint(await state()), checkpoint(before), 'F2QA_CONTINUATION_LOOKUP_WROTE');
    const ui = await import(pathToFileURL(path.join(repo, 'worker/public/scene-fate-private-ui.js')).href);
    const restoredAt = Date.now(), cache = restoredPending(continuation.intent, continuation.actor, restoredAt, ui);
    check(cache.record.signature === continuation.lookup.value.response.signature, 'F2QA_CONTINUATION_ORIGINAL_SIGNATURE');
    await frame.evaluate(({ key, record }) => {
      if (sessionStorage.getItem(key) !== null) throw Object.assign(new Error('F2QA_CONTINUATION_CACHE_EXISTS'), { code: 'F2QA_CONTINUATION_CACHE_EXISTS' });
      const text = JSON.stringify(record); sessionStorage.setItem(key, text);
      if (sessionStorage.getItem(key) !== text) throw Object.assign(new Error('F2QA_CONTINUATION_CACHE_READBACK'), { code: 'F2QA_CONTINUATION_CACHE_READBACK' });
    }, cache);
    continuation.cache = cache;
    evidence.restoredPendingCache = { key: cache.key, record: cache.record, restoredAt, newLocalCache: true, originalBrowserSnapshot: false,
      localMetadataRecreated: ['at', 'cancelRequested', 'revealed'], privatePayloadRestored: false };
    event('restored-public-pending-cache', evidence.restoredPendingCache); persist('original-public-pending-cache-restored');
  }
  async function continueUnsentCancel() {
    const id = continuation.intent.requestId, before = await state();
    check(await frame.evaluate(cache => window.RpgSceneFatePrivate.validRecord(cache.record, cache.record.scope), continuation.cache), 'F2QA_CONTINUATION_LIVE_RECORD');
    await pendingReady(id); check(await field('date').inputValue() === '', 'F2QA_CONTINUATION_PRIVATE_INPUT');
    const first = await checkPending(id, false);
    check(first.cancellationAllowed === true && await button('retry', 'data-sfp-pending-id', id).count() === 0, 'F2QA_CONTINUATION_NO_PRIVATE_RETRY');
    await frame.locator('.sf-sections [data-sf-action="section"][data-sf-section="life"]').click();
    await frame.locator('.sf-tabs [data-sf-action="tab"][data-sf-tab="overview"]').click();
    const locked = await frame.locator('[data-sf-action="start"]').isDisabled(),
      noticeCount = await frame.locator('.sf-notice [data-sf-action="section"][data-sf-section="private"]').count();
    check(locked && noticeCount === 1, 'F2QA_CONTINUATION_F1_INTERLOCK');
    evidence.continuationInterlock = { f1StartDisabled: locked, privatePendingNoticeCount: noticeCount, navigationScopedToSections: true };
    await openPrivate('profile'); await pendingReady(id); await checkPending(id, false);
    same(checkpoint(await state()), checkpoint(before), 'F2QA_CONTINUATION_PRE_CANCEL_WROTE');
    await button('end-pending', 'data-sfp-pending-id', id).click(); await confirmation();
    const ended = await submit(null, 'continued-original-id-cancel', { staged: true, endpoint: 'fate/private/cancel' });
    samePublic(ended.intent, continuation.intent, 'F2QA_CONTINUATION_CANCEL_INTENT');
    check(ended.response.outcome === 'cancelled' && evidence.operations.length === 1 && evidence.commands.length === 0, 'F2QA_CONTINUATION_CANCEL_RESULT');
    const after = await state();
    for (const realm of ['permanent', 'season']) for (const table of ['rpg_fate_profiles', 'rpg_fate_daily'])
      same(databaseEvidence(after)[realm].tableHashes[table], databaseEvidence(before)[realm].tableHashes[table], 'F2QA_CONTINUATION_CHANGED_PRIVATE_ROWS');
    await originalReceipt(evidence.operations[ended.operationIndex]); await ready();
    check(await frame.evaluate(key => sessionStorage.getItem(key) === null, continuation.cache.key)
      && await button('check-pending', 'data-sfp-pending-id', id).count() === 0, 'F2QA_CONTINUATION_PENDING_NOT_CLEARED');
    evidence.continuationAcknowledgement = { automaticAfterVerifiedCancel: true, localPendingCleared: true, manualAckRequired: false };
    check(sha(fs.readFileSync(continuation.failed.full)) === continuation.failed.sha256
      && sha(fs.readFileSync(continuation.originalClaim.full)) === continuation.originalClaim.sha256, 'F2QA_CONTINUATION_CHANGED_ORIGINAL_EVIDENCE');
    if (continuation.previousSetup) check(sha(fs.readFileSync(continuation.previousSetup.run.full)) === continuation.previousSetup.run.sha256
      && sha(fs.readFileSync(continuation.previousSetup.claim.full)) === continuation.previousSetup.claim.sha256, 'F2QA_CONTINUATION_CHANGED_SETUP_EVIDENCE');
    await storageSafe(); await shot('continued-original-id-cancellation');
    note('original-unsent-id-cancelled-through-independent-continuation');
  }

  async function scopes() {
    await openPrivate('profile'); const input = birthInput(); await fillBirth(input, true); await field('date').blur();
    let resolveHeld, release, settleDelivery;
    const captured = new Promise(resolve => { resolveHeld = resolve; }), pendingRelease = new Promise(resolve => { release = resolve; }),
      delivery = new Promise(resolve => { settleDelivery = resolve; });
    releases.add(release); heldRead = { resolve: resolveHeld, release: pendingRelease, settled: settleDelivery, actor: actorMetadata(main) };
    await button('refresh').click(); await deadline(() => captured, 'F2QA_LATE_READ_CAPTURE_TIMEOUT');
    await choose(alt); await openPrivate('profile'); check(await field('date').inputValue() === '', 'F2QA_SCOPE_PRIVATE_CACHE');
    release(); releases.delete(release);
    const delivered = await deadline(() => delivery, 'F2QA_LATE_READ_DELIVERY_TIMEOUT');
    check(['forwarded', 'scope-aborted'].includes(delivered), 'F2QA_LATE_READ_DELIVERY_FAILED');
    evidence.lateReadDelivery = delivered; await raf(); await ready();
    const context = await frame.evaluate(() => window.RpgSceneSession.getContext()); check(String(context.characterId) === alt.characterId && await field('date').inputValue() === '', 'F2QA_LATE_REPLY_POLLUTION');
    await pure('alternate-account-shared-private-metadata', alt);
    await choose(season); await openPrivate(); const frozen = await pure('frozen-private-reads', season);
    check(frozen.privateFate.control.writable === false && await button('save-profile').isDisabled(), 'F2QA_FROZEN_WRITABLE'); await shot('frozen-private-pane');
    await choose(foreign); await openPrivate(); const foreignView = await pure('foreign-private-isolation', foreign);
    check(foreignView.privateFate.profile.saved === false && foreignView.privateFate.history.receipts.length === 0, 'F2QA_FOREIGN_PRIVATE_DATA');
    const before = await state(); await rpc({ ...foreign, characterId: main.characterId }, 'fate/private/scene', {}, 409);
    same(databaseEvidence(await state()), databaseEvidence(before), 'F2QA_FOREIGN_SCOPE_WROTE');
    await choose(main); await openPrivate(); check(await field('date').inputValue() === '', 'F2QA_RETURN_SCOPE_PRIVATE_INPUT');
    await storageSafe(); note('late-private-read-scope-realm-and-other-account-isolation');
  }

  async function readHistoryTargets(targets, baseline) {
    const resultCards = () => frame.locator('.sfp-window > [data-sfp-result]');
    check(await resultCards().count() === baseline, 'F2QA_HISTORY_INITIAL_CARDS');
    const proofRows = [];
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index], before = await state();
      const oldHistory = index ? await resultCards().nth(baseline).elementHandle() : null;
      persist('history-receipt-wait-post');
      const waiting = page.waitForResponse(response => historyResponseMatches(response, api, target.requestId));
      await button('history-receipt', 'data-sfp-request-id', target.requestId).click();
      const response = await waiting, wire = response.request().postDataJSON(), value = await response.json(), clean = safeResponse(value);
      noPrivateReceiptFields(value);
      check(response.status() === 200 && clean.found === true && clean.requestId === target.requestId
        && clean.kind === target.kind && clean.intentNonce === target.intentNonce && clean.signature === target.signature
        && integer(wire.readSequence) && clean.readSequence === wire.readSequence, 'F2QA_ERASE_SAFE_HISTORY_RECEIPT');
      const expected = historyResultExpectation(clean);
      event('erased-history-response', { requestId: target.requestId, response: clean, method: 'POST', readSequenceMatched: true });
      persist('history-receipt-wait-ui'); await ready();
      await frame.waitForFunction(({ id, baseline, oldHistory }) => {
        const root = document.querySelector('.sfp-window'), cards = root ? [...root.children].filter(el => el.hasAttribute('data-sfp-result')) : [];
        const control = root?.querySelector('[data-sfp-action="history-receipt"][data-sfp-request-id="' + id + '"]');
        const refresh = root?.querySelector('[data-sfp-action="refresh"]');
        return cards.length === baseline + 1 && (!oldHistory || !oldHistory.isConnected) && control && !control.disabled && refresh && !refresh.disabled
          && !root.querySelector('[data-sfp-pending]') && !root.querySelector('[data-sfp-error]');
      }, { id: target.requestId, baseline, oldHistory });
      const cards = await resultCards().evaluateAll(nodes => nodes.map(node => ({
        firstParagraph: node.querySelector(':scope > p')?.textContent.trim().replace(/\s+/g, ' ') || '',
        notes: [...node.querySelectorAll('.sfp-muted')].map(el => el.textContent.trim().replace(/\s+/g, ' '))
      })));
      const selectedCard = selectHistoryCard(cards, baseline, expected);
      const after = await state(); same(checkpoint(after), checkpoint(before), 'F2QA_ERASE_HISTORY_WROTE');
      const row = { requestId: target.requestId, kind: clean.kind, outcome: clean.outcome, baselineCards: baseline,
        exactResultCardCount: cards.length, selectedCardIndex: selectedCard, priorHistoryDisconnected: !oldHistory || !await oldHistory.evaluate(el => el.isConnected),
        matchingPublicResult: true, readSequenceMatched: true, fullCheckpointUnchanged: true, privateRowsRestored: false };
      check(row.priorHistoryDisconnected, 'F2QA_HISTORY_STALE_CARD'); proofRows.push(row);
      event('erased-original-receipt', { ...row, response: clean });
      evidence.historyUiProof = proofRows; persist('history-receipt-verified'); await oldHistory?.dispose();
    }
    return proofRows;
  }
  async function erasedHistoryReadOnly() {
    check(erasedHistory && definition.erasedHistory, 'F2QA_ERASURE_READONLY_REQUIRED');
    const before = await state(); same(checkpoint(before), erasedHistory.failed.value.finalCheckpoint, 'F2QA_ERASURE_FRESH_STATE');
    await originalReceipt(erasedHistory.operation);
    await openPrivate('profile');
    const view = await pure('erased-history-private-projection', main, [{ endpoint: 'fate/private/profile' }]);
    check(view.privateFate.profile.saved === false && view.privateFate.daily.materialized === false && view.privateFate.daily.notes.length === 0
      && await field('date').inputValue() === '', 'F2QA_ERASURE_PRIVATE_PROJECTION');
    const rows = view.privateFate.history.receipts, targets = erasedHistory.targets.map(target => {
      const current = rows.find(row => row.requestId === target.requestId);
      check(current, 'F2QA_ERASURE_HISTORY_MISSING'); same(current, target, 'F2QA_ERASURE_HISTORY_CHANGED'); return current;
    });
    const deletion = rows.find(row => row.requestId === erasedHistory.operation.intent.requestId);
    check(deletion?.kind === 'profile-delete' && deletion.outcome === 'committed', 'F2QA_ERASURE_DELETE_HISTORY_MISSING');
    targets.push(deletion);
    await readHistoryTargets(targets, 0);
    await storageSafe();
    check(evidence.storageChecks.at(-1).pendingCount === 0, 'F2QA_ERASURE_LOCAL_PENDING');
    const history = frame.locator('.sfp-window > .sfp-card').last(), finalButton = history.locator('[data-sfp-action="history-receipt"]').last();
    await finalButton.scrollIntoViewIfNeeded(); await raf(); await shot('erased-public-history-bottom');
    await frame.locator('.sfp-window > [data-sfp-result]').scrollIntoViewIfNeeded(); await raf(); await shot('erased-verified-public-result');
    same(checkpoint(await state()), checkpoint(before), 'F2QA_ERASURE_READONLY_CHANGED_STATE');
    note('committed-erasure-history-completed-by-readonly-original-id-lookups');
  }

  async function eraseHistory() {
    await openPrivate('profile'); const beforeView = await pure('before-erasure');
    const targets = beforeView.privateFate.history.receipts.filter(row => ['profile-save', 'daily-sync', 'birthday-start'].includes(row.kind)).slice(0, 6);
    check(targets.length >= 3, 'F2QA_ERASE_HISTORY_TARGETS'); const row = await submit(button('delete-profile'), 'explicit-private-erasure');
    await originalReceipt(evidence.operations[row.operationIndex]); const after = await state();
    check(!after.permanent.profiles.some(p => p.accountId === main.accountId) && !after.permanent.daily.some(d => d.accountId === main.accountId), 'F2QA_ERASE_LEFT_PRIVATE_ROWS');
    check(await field('date').inputValue() === '', 'F2QA_ERASE_LEFT_PRIVATE_DOM');
    const view = await pure('after-erasure', main, [{ endpoint: 'fate/private/profile' }]);
    check(view.privateFate.profile.saved === false && view.privateFate.daily.notes.length === 0 && view.privateFate.daily.materialized === false, 'F2QA_ERASE_PRIVATE_PROJECTION');
    await readHistoryTargets(targets, 1);
    await storageSafe(); await shot('erased-private-data-public-history'); note('erase-deletes-private-rows-and-keeps-only-verifiable-public-history');
  }
  async function receiptOnly() {
    const targets = new Map();
    for (const row of [...(bridge.value.submissions || []), ...(bridge.value.operations || [])]) if (row.intent && row.actor) {
      const intent = qa.qaPrivatePublicIntent(row.intent), who = actorMetadata(row.actor), key = who.realmId + ':' + who.accountId + ':' + intent.requestId;
      const previous = targets.get(key); if (previous) same(previous.intent, intent, 'F2QA_BRIDGE_INTENT_CONFLICT'); else targets.set(key, { intent, who });
    }
    check(targets.size > 0, 'F2QA_BRIDGE_NO_ORIGINAL_ID'); const before = await state();
    for (const target of targets.values()) {
      const value = await rpc(target.who, 'fate/private/receipt', target.intent);
      event('bridge-original-lookup', { actor: target.who, intent: target.intent, response: safeResponse(value) });
    }
    same(databaseEvidence(await state()), databaseEvidence(before), 'F2QA_BRIDGE_WROTE');
    check(evidence.operations.length === 0 && evidence.commands.length === 0, 'F2QA_BRIDGE_REPLAYED'); note('exact-original-ids-inspected-without-replay');
  }
  async function findFrame() {
    frame = page.frames().find(f => f.url().includes('/scene-bound-20261102/scene.html'))
      || await page.waitForEvent('framenavigated', { predicate: f => f.url().includes('/scene-bound-20261102/scene.html'), timeout: 30000 });
    await frame.waitForFunction(() => window.RpgSceneSession?.getSnapshot()?.characterId, null, { timeout: 30000 });
    await frame.waitForFunction(() => window.RpgSceneLiveView?.inspect?.()[0]?.characterVisible, null, { timeout: 45000 });
  }
  function observePromise(promise) { pending.push(promise); return promise; }
  async function routeRequest(route) {
    const request = route.request(), u = new URL(request.url());
    if (u.origin !== origin && u.origin !== api) { evidence.externalRequestCount++; await route.abort('blockedbyclient'); return; }
    const endpoint = u.origin === api && u.pathname.startsWith('/app/api/') ? u.pathname.slice('/app/api/'.length) : null;
    if (erasedHistory && !readonlyRequestAllowed(request.method(), endpoint, u.pathname, u.origin === api)) {
      const known = new Set([...FATE_READS, ...PRIVATE_WRITES, 'atlas/status', 'atlas/quests', 'atlas/catalog', 'chat/state']);
      evidence.blockedReadonlyRequests ??= [];
      evidence.blockedReadonlyRequests.push({ method: ['GET', 'HEAD', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) ? request.method() : 'other',
        endpoint: known.has(endpoint) ? endpoint : 'unapproved', resourceClass: u.origin === origin ? 'ui-origin-resource'
          : u.pathname === '/art/fate-taiwan-v8/taipei-dusk.webp' ? 'fate-overview-art' : u.pathname.startsWith('/app/api/') ? 'app-api' : 'other-api-origin-resource',
        rawUrlWithheld: true });
      throw error('F2QA_ERASURE_READONLY_ROUTE');
    }
    if (definition.continuation && u.origin === api && !continuationRequestAllowed(request.method(), endpoint, u.pathname)) {
      const known = new Set([...FATE_READS, ...PRIVATE_WRITES, 'atlas/status', 'atlas/quests', 'atlas/catalog', 'chat/state']);
      evidence.blockedContinuationRequests ??= [];
      evidence.blockedContinuationRequests.push({ method: ['GET', 'HEAD', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) ? request.method() : 'other',
        endpoint: known.has(endpoint) ? endpoint : 'unapproved', resourceClass: u.pathname === '/art/fate-taiwan-v8/taipei-dusk.webp' ? 'fate-overview-art'
          : u.pathname.startsWith('/app/api/') ? 'app-api' : 'other-api-origin-resource', rawUrlWithheld: true });
      throw error('F2QA_CONTINUATION_API_LIMIT');
    }
    if (u.origin === origin && u.pathname === '/fate/app.js') { evidence.routeErrors.push({ code: 'F2QA_LEGACY_FATE_APP' }); await route.abort('blockedbyclient'); return; }
    if (endpoint?.startsWith('fate/') && !FATE_READS.has(endpoint) && !PRIVATE_WRITES.has(endpoint)) { evidence.routeErrors.push({ code: 'F2QA_IMPLICIT_FATE_WRITE' }); await route.abort('blockedbyclient'); return; }
    if (endpoint && request.method() === 'POST') {
      let intent;
      if (PRIVATE_WRITES.has(endpoint) || endpoint === 'fate/private/receipt') intent = qa.qaPrivatePublicIntent(request.postDataJSON());
      else if (PRIVATE_READS.has(endpoint)) {
        const body = request.postDataJSON(); check(object(body) && identifier(body.realmId) && identifier(body.selectedCharacterId)
          && Object.keys(body).every(key => ['realmId', 'selectedCharacterId', 'readSequence'].includes(key)), 'F2QA_PRIVATE_READ_REQUEST');
        intent = { realmId: body.realmId, selectedCharacterId: body.selectedCharacterId, ...(integer(body.readSequence) ? { readSequence: body.readSequence } : {}) };
      }
      evidence.requests.push({ endpoint, method: 'POST', ...(intent ? { intent } : {}), privateBodyWithheld: true });
      if (PRIVATE_WRITES.has(endpoint)) { await captureMutation(route, endpoint, request.postDataJSON()); return; }
      if (heldRead && endpoint === 'fate/private/scene') {
        const hold = heldRead; heldRead = null; let outcome = 'failed';
        try {
          const response = await route.fetch({ timeout: 20000, maxRetries: 0 }), clean = safeResponse(await response.json());
          event('held-private-read', { actor: hold.actor, response: clean, rawResponseWithheld: true }); hold.resolve();
          await deadline(() => hold.release, 'F2QA_HELD_READ_TIMEOUT');
          try { await route.fulfill({ response }); outcome = 'forwarded'; }
          catch (e) {
            const failure = request.failure();
            check(failure && /ERR_ABORTED|ERR_FAILED/.test(String(failure.errorText || '')), 'F2QA_HELD_READ_DELIVERY');
            evidence.lateReadDroppedByScope = true; outcome = 'scope-aborted';
          }
        } finally { hold.settled(outcome); }
        return;
      }
    }
    await route.continue();
  }
  persist('before-campaign-verification');
  try {
    prior = args.has('previous-run') ? previous(args.get('previous-run')) : null;
    bridge = args.has('bridge-run') ? previous(args.get('bridge-run')) : null;
    evidence.sourceBefore = sources();
    const [ui, service] = await Promise.all([json(origin + '/__preview/health'), json(api + '/__preview/health')]);
    check(ui.apiReady === true && ui.isolated === true && ui.attachedApi === true && ui.apiOwned === false && ui.apiPid === service.pid
      && service.isolated === true && service.ephemeral === true && service.productionAccess === false && service.fatePrivateQa === true && service.fateQa === false
      && service.qaClock?.lifeMs === 7200000 && service.qaClock?.choiceMs === 90000 && service.qaClock?.automaticFateSweep === false, 'F2QA_PREVIEW_HEALTH');
    evidence.health = { ui: { pid: ui.pid, apiPid: ui.apiPid, apiReady: true, isolated: true, attachedApi: true, apiOwned: false },
      api: { pid: service.pid, isolated: true, ephemeral: true, productionAccess: false, fatePrivateQa: true } };
    check(ui.generatedInputSnapshot?.mode === 'pinned-qa-text' && ui.generatedInputSnapshot.sourceCount === 9, 'F2QA_PINNED_INPUTS');
    const manifestFull = fs.realpathSync(ui.generatedInputSnapshot.manifestPath), rel = path.relative(base, manifestFull);
    check(rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel), 'F2QA_PINNED_INPUT_OWNER');
    const manifestBytes = fs.readFileSync(manifestFull), manifest = JSON.parse(manifestBytes);
    check(manifest.status === 'passed' && manifest.id === ui.generatedInputSnapshot.id && manifest.binderSha256 === evidence.sourceBefore['worker/tools/scene-preview-bindings.mjs'], 'F2QA_INPUT_MANIFEST');
    evidence.inputSnapshot = { id: manifest.id, sourceCount: 9, manifestFile: rel.replaceAll('\\', '/'), manifestSha256: sha(manifestBytes) };
    fixture = await state(); main = fixture.primary; alt = fixture.alternate; foreign = fixture.foreign; season = fixture.seasonFixtures[0]; actor = main;
    for (const a of [main, alt, foreign, season]) actorMetadata(a);
    evidence.fixture = { initialInputSha256: fixture.initialInputSha256, digestId: fixture.privacy.digestId, seededAt: fixture.seededAt,
      primary: actorMetadata(main), alternate: actorMetadata(alt), foreign: actorMetadata(foreign), season: actorMetadata(season),
      noSeededPrivateOrBattleOutcomes: fixture.noSeededPrivateOrBattleOutcomes, noDispatcher: true, realNotificationsSent: false };
    evidence.initialCheckpoint = checkpoint(fixture); await authority(); if (definition.continuation) claim(); if (erasedHistory) claimReadOnly();
    if (definition.bridge) { evidence.status = 'running'; persist('receipt-only'); await receiptOnly(); }
    else {
      browser = await playwright().chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      evidence.browserVersion = browser.version(); const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on('pageerror', e => { evidence.pageErrors.push(safeFailure(e, stage)); });
      page.on('response', response => {
        const u = new URL(response.url()), endpoint = u.origin === api && u.pathname.startsWith('/app/api/') ? u.pathname.slice(9) : null;
        if (response.status() >= 400) evidence.httpErrors.push({ endpoint: endpoint && /^[a-z0-9/_-]+$/.test(endpoint) ? endpoint : 'asset', status: response.status(), expected: expectedHttpRequests.has(response.request()) });
        if (u.origin === api) return;
        const name = u.pathname.split('/').at(-1), source = FRONT.includes(name) ? 'worker/public/' + name : u.pathname.startsWith('/fate/') && u.pathname.endsWith('.js') ? 'worker/public' + u.pathname : null;
        if (source || /\.(js|mjs|css|html|webp|png|jpg|svg|mp4)$/.test(u.pathname)) {
          const record = { path: u.pathname, status: response.status(), mime: response.headers()['content-type'] || '', bodyStored: false };
          evidence.assets[u.pathname] = record;
          if (source || /\.(js|mjs|css|html)$/.test(u.pathname)) {
            observePromise(response.body().then(bytes => { record.sha256 = sha(bytes); record.bytes = bytes.length; if (source) evidence.loadedSources[source] = record; })
              .catch(() => { record.bodyUnavailable = true; evidence.routeErrors.push({ code: 'F2QA_ASSET_BODY_UNAVAILABLE', source: source || 'static-text' }); }));
          } else record.validation = 'HTTP status only; existing character/image assets are outside this F2 source freeze';
        }
      });
      await page.route('**/*', route => observePromise(routeRequest(route).catch(async e => {
        stopMutations = true; if (prepared && !['committed-response-delivered', 'committed-response-withheld', 'not-sent-intercepted'].includes(prepared.state)) prepared.state = 'failed';
        evidence.routeErrors.push(safeFailure(e, stage)); persist('route-failed'); try { await route.abort('failed'); } catch {}
      })));
      evidence.status = 'running'; persist('launch-verified-private-scene');
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' }); await findFrame(); await choose(main);
      if (definition.continuation) await restoreContinuationCache();
      await openPrivate();
      if (selected === 'layout-pure') { await layouts(); await pure('initial-private-views', main, [{ endpoint: 'fate/private/profile' }]); await pure('initial-frozen-private-view', season); note('initial-private-views-are-select-only'); }
      else if (selected === 'ime-refresh') await imeRefresh();
      else if (selected === 'temporary-birthday') await birthday('temporary');
      else if (selected === 'profile-save-view-update') await profiles();
      else if (selected === 'daily-initial') { const v = await pure('daily-not-created-by-opening'); check(v.privateFate.daily.materialized === false, 'F2QA_DAILY_IMPLICIT_CREATION'); await syncDaily(0); note('three-locked-notes-materialize-only-by-explicit-sync'); }
      else if (selected === 'battle-unlocks') await battleUnlocks();
      else if (selected === 'saved-birthday') await birthday('saved');
      else if (selected === 'lost-committed') await lostCommitted();
      else if (selected === 'lost-unsent-cancel') await lostUnsent();
      else if (definition.continuation) await continueUnsentCancel();
      else if (selected === 'scope-late') await scopes();
      else if (selected === 'erase-history') await eraseHistory();
      else if (selected === 'erased-history-readonly') await erasedHistoryReadOnly();
      else if (selected === 'final-layout') { await layouts(true); await pure('final-erased-private-views', main, [{ endpoint: 'fate/private/profile' }]); await storageSafe(); }
      persist('await-observed-requests'); await Promise.all(pending);
      persist('validate-served-sources');
      for (const [source, record] of Object.entries(evidence.loadedSources)) check(record.sha256 === evidence.sourceBefore[source], 'F2QA_SERVED_SOURCE_CHANGED');
      check(evidence.loadedSources['worker/public/scene-fate-private-ui.js'] && evidence.loadedSources['worker/public/scene-fate-private-ui.css'], 'F2QA_PRIVATE_UI_NOT_LOADED');
      check(evidence.pageErrors.length === 0 && evidence.httpErrors.every(row => row.expected) && evidence.routeErrors.length === 0 && evidence.externalRequestCount === 0, 'F2QA_BROWSER_ERRORS');
    }
    persist('verify-source-freeze'); evidence.sourceAfter = sources(); same(evidence.sourceAfter, evidence.sourceBefore, 'F2QA_SOURCE_CHANGED_DURING_CASE');
    persist('read-final-checkpoint'); evidence.finalCheckpoint = checkpoint(await state());
    if (erasedHistory) {
      same(evidence.finalCheckpoint, erasedHistory.failed.value.finalCheckpoint, 'F2QA_ERASURE_FINAL_CHECKPOINT');
      check(evidence.submissions.length === 0 && evidence.operations.length === 0 && evidence.commands.length === 0
        && evidence.requests.every(row => !PRIVATE_WRITES.has(row.endpoint)), 'F2QA_ERASURE_NO_NEW_MUTATIONS');
      evidence.readonlyCompletion = { originalErasureRemainsFailed: true, originalErasureCommitted: true, noNewMutations: true,
        originalFailedRunSha256: erasedHistory.failed.sha256, fullCheckpointUnchanged: true };
    }
    evidence.ok = true; evidence.status = 'passed';
  } catch (e) {
    stopMutations = true; evidence.status = 'failed'; evidence.ok = false; evidence.failure = safeFailure(e, stage); process.exitCode = 1;
    for (const release of releases) release(); releases.clear();
    try { if (page && frame) await shot('failure-redacted', true); } catch { evidence.failureScreenshotUnavailable = true; }
  } finally {
    for (const release of releases) release();
    await Promise.allSettled(pending);
    try { evidence.finalCheckpoint = checkpoint(await state()); } catch (e) { evidence.finalCheckpointUnavailable = safeFailure(e, stage); }
    try { evidence.sourceAfter = sources(); evidence.sourcesStable = JSON.stringify(evidence.sourceBefore) === JSON.stringify(evidence.sourceAfter); } catch { evidence.sourcesStable = false; }
    if (evidence.ok && !evidence.sourcesStable) { evidence.ok = false; evidence.status = 'failed'; evidence.failure = safeFailure(error('F2QA_SOURCE_CHANGED_DURING_CASE'), stage); process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); evidence.requestCounts = Object.fromEntries([...new Set(evidence.requests.map(r => r.endpoint))].map(name => [name, evidence.requests.filter(r => r.endpoint === name).length]));
    persist('finished'); inMemoryBodies.clear(); privateMarkers.clear();
    if (browser) await browser.close();
    console.log(JSON.stringify({ ok: evidence.ok, status: evidence.status, case: selected, runId, operations: evidence.operations.length,
      checks: evidence.checks.length, dir, failure: evidence.failure || null }));
  }
  return evidence.ok;
}

module.exports = { CASES, safeFailure, loopback, parseArgs, databaseEvidence, checkpoint, noPrivateReceiptFields, continuationCancelOnly, restoredPending, continuationSourceChanges, continuationRequestAllowed, untouchedSetupAttempt, readonlyRequestAllowed, historyResponseMatches, historyResultExpectation, selectHistoryCard, committedErasureEvidence, run };
if (require.main === module) run(process.argv.slice(2)).catch(e => { console.error(JSON.stringify(safeFailure(e, 'startup'))); process.exitCode = 1; });
