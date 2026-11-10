/**
 * Normalize already captured local API/browser receipts into coverage layers.
 * This reads evidence only: it does not start a browser, replay events or call APIs.
 * Per-mode fingerprints cover the actual event producer/presentation path;
 * unrelated consumer changes remain recorded but do not invalidate that mode.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELF = 'worker/tools/build-skill-vfx-browser-evidence.mjs';
const SHARED = [
  'worker/public/skill-vfx-legacy.mjs', 'worker/public/skill-vfx-engine.mjs', 'worker/public/skill-vfx-semantics.mjs', 'worker/public/art/skill-vfx-20261104/semantic-atlas.webp',
  'worker/public/skill-vfx-catalog.json', 'worker/public/skill-vfx-recipes.json',
  'worker/src/game/skill-vfx-events.js', 'worker/src/game/special.js',
];
const MODE_FILES = {
  idle: ['worker/public/battle.js', 'worker/src/game/idle.js', 'worker/src/game/idle-combat.js', 'worker/src/game/special-idle.js'],
  pk: ['worker/public/app.js', 'worker/src/game/pk.js', 'worker/src/services/pk.js'],
  boss: ['worker/public/app.js', 'worker/src/game/boss.js'],
  party: ['worker/public/expedition/combat-playback.js', 'worker/public/expedition/hero-art-playback.js', 'worker/src/services/party.js'],
  'star-ring': ['worker/public/star-ring-heroes.js', 'worker/src/game/star-ring.js', 'worker/src/services/star-ring.js'],
};
const ATLAS_REQUIRED = [
  'worker/src/game/atlas-engine.js', 'worker/src/game/atlas-combat-observer.js', 'worker/src/services/atlas.js',
  'worker/public/scene-live-session.js', 'worker/public/scene-live-view.js',
  'worker/public/skill-vfx-engine.mjs', 'worker/public/skill-vfx-semantics.mjs', 'worker/public/art/skill-vfx-20261104/semantic-atlas.webp', 'worker/public/skill-vfx-actor-bridge.mjs',
  'worker/public/skill-vfx-combat-adapter.mjs', 'worker/public/skill-vfx-catalog.json', 'worker/public/skill-vfx-recipes.json',
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modeName = value => String(value).startsWith('idle-') ? 'idle' : value === 'ring' ? 'star-ring' : value;
const sources = value => new Map((value || []).map(file => [file.path.replaceAll('\\', '/'), file.sha256]));
const uniqueEvents = events => [...new Map(events.map(event => [event.eventId, event])).values()];

function checkSources(report, paths, hashFile) {
  const before = sources(report.sourceFiles), after = sources(report.sourceFilesAfter);
  assert.ok(before.size && after.size, 'Both before/after source fingerprints are required.');
  return paths.map(path => {
    const sha256 = before.get(path);
    assert.match(sha256 || '', /^[a-f0-9]{64}$/, 'Missing fingerprint: ' + path);
    assert.equal(after.get(path), sha256, 'Source changed during capture: ' + path);
    assert.equal(hashFile(path), sha256, 'Source is stale: ' + path);
    return { path, sha256 };
  });
}
function emitCases(prefix, mode, apiEvents, renderedEvents, details) {
  const rows = [], committed = apiEvents.filter(event => event.source === 'committed-combat');
  for (const [suffix, evidenceKind, events] of [
    ['resolver', 'real-resolver', apiEvents],
    ['commit', 'committed-api', committed],
    ['presentation', 'presentation', renderedEvents],
    ['browser', 'browser-gameplay-api', renderedEvents],
  ]) if (events.length) rows.push({ id: prefix + ':' + suffix, mode, evidenceKind, status: 'passed', events, ...details });
  return rows;
}
function finish(path, report, accepted, excluded, hashFile, kind) {
  const files = new Map();
  for (const entry of accepted) for (const file of entry.sourceFiles) files.set(file.path, file.sha256);
  if (accepted.length) {
    files.set(path, hashFile(path));
    files.set(SELF, hashFile(SELF));
  }
  return {
    source: { path, status: report.status || (report.cases?.every(c => c.passed) ? 'passed' : 'partial'), generatedAt: report.generatedAt || report.completedAt || null },
    sourceFiles: [...files].map(([path, sha256]) => ({ path, sha256 })),
    cases: accepted.flatMap(entry => entry.cases), excluded,
    normalization: kind,
  };
}
export function normalizeGameplayReport(path, report, hashFile) {
  assert.equal(report.source, 'real-isolated-api');
  assert.equal(report.isolated, true); assert.equal(report.ephemeral, true); assert.equal(report.productionAccess, false);
  const accepted = [], excluded = [];
  for (const [index, c] of (report.cases || []).entries()) {
    const mode = modeName(c.mode), prefix = hash(path).slice(0, 12) + ':' + c.mode + ':' + c.width + ':' + index;
    try {
      assert.equal(c.status, 'passed', 'Scenario did not pass.');
      assert.ok(MODE_FILES[mode], 'Unknown mode: ' + mode);
      assert.equal((c.errors || []).length, 0); assert.equal((c.badResponses || []).length, 0);
      const sourceFiles = checkSources(report, [...SHARED, ...MODE_FILES[mode]], hashFile);
      const apiEvents = uniqueEvents((c.receipts || []).filter(receipt => receipt.status >= 200 && receipt.status < 300)
        .flatMap(receipt => receipt.vfx || []));
      assert.ok(apiEvents.length, 'No actual API descriptors.');
      for (const event of apiEvents) {
        assert.ok(event.skillId && event.eventId);
        assert.ok(['committed-combat', 'deterministic-projection'].includes(event.source));
      }
      const byId = new Map(apiEvents.map(event => [event.eventId, event]));
      const observations = [c.first, c.result].flatMap(value => [...(value?.active || []), ...(value?.completed || [])]);
      const rendered = [], observed = [];
      for (const layer of observations) {
        if (modeName(layer.mode) !== mode || !(layer.accepted > 0 && layer.drawCalls > 0 && layer.drawFrames > 0)) continue;
        if (layer.lastRender?.manual !== false && layer.player?.manual !== false) continue;
        const last = layer.lastEvent, actual = byId.get(last?.eventId);
        if (!actual) continue;
        assert.equal(actual.skillId, last.skillId, 'Rendered identity differs from API event.');
        assert.equal(actual.source, last.source, 'Rendered source differs from API event.');
        assert.deepEqual(actual.targetIds, last.targetIds, 'Rendered target IDs differ from API event.');
        rendered.push(actual); observed.push({ eventId: last.eventId, drawCalls: layer.drawCalls, drawFrames: layer.drawFrames, manual: false });
      }
      assert.ok(rendered.length, 'No event ID joins an actual API receipt to a real browser draw.');
      const usedPaths = new Set(sourceFiles.map(file => file.path));
      const details = { sourceEvidencePath: path, sourceCase: { index, mode: c.mode, width: c.width }, observation: observed,
        fingerprintScope: 'mode producer and presentation path; unrelated consumers excluded',
        excludedFingerprintPaths: (report.sourceFiles || []).map(file => file.path).filter(file => !usedPaths.has(file)) };
      accepted.push({ sourceFiles, cases: emitCases(prefix, mode, apiEvents, uniqueEvents(rendered), details) });
    } catch (error) { excluded.push({ index, mode: c.mode, width: c.width, reason: error.message }); }
  }
  return finish(path, report, accepted, excluded, hashFile, 'legacy-api-eventId-and-draw-intersection');
}
export function normalizeAtlasReport(path, report, hashFile) {
  for (const health of [report.health, report.apiHealth]) {
    assert.equal(health?.isolated, true); assert.equal(health?.ephemeral, true); assert.equal(health?.productionAccess, false);
  }
  assert.equal((report.errors || []).length, 0); assert.equal((report.badResponses || []).length, 0);
  const before = sources(report.sourceFiles);
  for (const required of ATLAS_REQUIRED) assert.ok(before.has(required), 'Missing Atlas source: ' + required);
  const sourceFiles = checkSources(report, [...before.keys()], hashFile), accepted = [], excluded = [];
  for (const [index, c] of (report.cases || []).entries()) {
    try {
      assert.equal(c.passed, true, 'Atlas scenario did not pass.');
      assert.ok(c.build && c.runId && c.release?.eventId);
      const matching = (report.receipts || []).filter(receipt => receipt.build === c.build && receipt.width === c.width
        && receipt.trace?.context?.dispatchId === c.runId);
      assert.ok(matching.length, 'No matching committed Atlas receipt.');
      const events = [];
      for (const receipt of matching) {
        const trace = receipt.trace;
        assert.equal(trace.schemaVersion, 1); assert.equal(trace.source, 'committed-combat');
        assert.equal(receipt.sceneRevision, trace.revision, 'Trace revision does not match accepted scene.');
        for (const event of trace.events || []) {
          assert.equal(event.skillId, 'atlas:' + c.build);
          assert.ok(['skill_cast', 'skill_effect'].includes(event.type));
          events.push({ ...event, source: trace.source });
        }
      }
      const apiEvents = uniqueEvents(events), byId = new Map(apiEvents.map(event => [event.eventId, event]));
      const rendered = [];
      for (const [phase, visual] of [['release', c.release], ['effect', c.effect]]) if (visual) {
        const actual = byId.get(visual.eventId);
        assert.ok(actual, 'Rendered Atlas event is not in the committed trace.');
        assert.equal(actual.type, phase === 'release' ? 'skill_cast' : 'skill_effect');
        assert.ok(visual.player?.drawCalls > 0 && visual.player?.active > 0, 'No actual Atlas draw.');
        assert.equal(visual.player.manual, false, 'Controlled rendering is not live API gameplay.');
        rendered.push(actual);
      }
      assert.equal(c.clear?.player?.active, 0, 'Atlas VFX was not cleared.');
      const prefix = hash(path).slice(0, 12) + ':' + c.build + ':' + c.width + ':' + index;
      accepted.push({ sourceFiles, cases: emitCases(prefix, 'atlas', apiEvents, rendered, {
        sourceEvidencePath: path, sourceCase: { index, build: c.build, width: c.width, runId: c.runId },
        fingerprintScope: 'all Atlas source paths captured before and after browser acceptance',
        observation: { release: c.release.eventId, effect: c.effect?.eventId || null, cleanupActive: c.clear.player.active },
      }) });
    } catch (error) { excluded.push({ index, build: c.build, width: c.width, reason: error.message }); }
  }
  return finish(path, report, accepted, excluded, hashFile, 'atlas-committed-trace-and-release-intersection');
}
export function combineBrowserEvidence(parts) {
  const sourceFiles = new Map();
  for (const part of parts) for (const file of part.sourceFiles) {
    if (sourceFiles.has(file.path)) assert.equal(sourceFiles.get(file.path), file.sha256, 'Conflicting evidence fingerprint.');
    sourceFiles.set(file.path, file.sha256);
  }
  const cases = parts.flatMap(part => part.cases);
  assert.ok(cases.length, 'No completed source-matched API/browser scenarios.');
  return {
    schemaVersion: 1, status: 'passed', generatedAt: new Date().toISOString(),
    scope: 'normalized-real-local-api-browser-evidence',
    sourceFiles: [...sourceFiles].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })),
    sources: parts.map(part => ({ ...part.source, normalization: part.normalization, excluded: part.excluded })),
    policies: {
      api: 'Only observed API descriptors count as resolver/commit; projections never count as committed writes.',
      browser: 'Only event IDs present in both the API receipt and real browser draw observation count as presentation/browser.',
      partial: 'A failed sibling scenario is excluded explicitly; a passing independent mode may remain valid.',
      fingerprints: 'Legacy modes use their recorded producer/presentation source subset; Atlas uses every captured source.',
    },
    summary: {
      cases: cases.length,
      browserIdentities: new Set(cases.filter(c => c.evidenceKind === 'browser-gameplay-api').flatMap(c => c.events.map(e => e.skillId))).size,
      excludedScenarios: parts.reduce((n, part) => n + part.excluded.length, 0),
    },
    cases,
  };
}
function workspace(path) {
  const full = resolve(ROOT, path), rel = relative(ROOT, full);
  assert.ok(!isAbsolute(rel) && !rel.startsWith('..'), 'Evidence must remain inside this worktree.');
  return full;
}
function main(args) {
  assert.ok(args.every(arg => /^--(?:gameplay|atlas|out)=.+/.test(arg)), 'Use --gameplay=path and/or --atlas=path [--out=path].');
  const hashFile = path => hash(readFileSync(workspace(path)));
  const parts = args.filter(arg => /^--(?:gameplay|atlas)=/.test(arg)).map(arg => {
    const split = arg.indexOf('='), kind = arg.slice(2, split), path = arg.slice(split + 1);
    const report = JSON.parse(readFileSync(workspace(path), 'utf8'));
    return (kind === 'atlas' ? normalizeAtlasReport : normalizeGameplayReport)(path, report, hashFile);
  });
  const receipt = combineBrowserEvidence(parts);
  const output = args.find(arg => arg.startsWith('--out='))?.slice(6) || '.release-sync/skill-vfx-20261104/gameplay-coverage-browser.json';
  mkdirSync(dirname(workspace(output)), { recursive: true });
  writeFileSync(workspace(output), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, output, summary: receipt.summary, excluded: receipt.sources.map(source => ({ path: source.path, cases: source.excluded })) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
