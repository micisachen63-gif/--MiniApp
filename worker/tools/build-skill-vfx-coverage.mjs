/**
 * Auditable VFX coverage. Preview recipes, resolver observations, presentation
 * dispatch and browser observations are different evidence layers.
 * This command reads local sources/receipts only and never calls game APIs.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipeFor, validateCatalog } from '../public/skill-vfx-engine.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CATALOG = 'worker/public/skill-vfx-catalog.json';
const RECIPES = 'worker/public/skill-vfx-recipes.json';
const OUTPUT = 'worker/public/skill-vfx-coverage.json';
const DEFAULT_RECEIPTS = [
  '.release-sync/skill-vfx-20261104/legacy-coverage-events.json',
  '.release-sync/skill-vfx-20261104/legacy-committed-service-events.json',
  '.release-sync/skill-vfx-20261104/legacy-coverage-presentation.json',
  '.release-sync/skill-vfx-20261104/legacy-coverage-browser.json',
  '.release-sync/skill-vfx-20261104/gameplay-coverage-browser.json',
];
const LEGACY_MODES = ['idle', 'pk', 'boss', 'party', 'star-ring'];
export const COVERAGE_PATHS = Object.freeze({
  idle: {
    producer: ['worker/src/game/idle.js', 'worker/src/game/idle-combat.js', 'worker/src/game/special-idle.js'],
    publication: ['worker/src/services/player.js'],
    consumer: ['worker/public/battle.js', 'worker/public/skill-vfx-legacy.mjs'],
    clock: 'recorded minute; presentation is a replay of actual recorded actions',
  },
  pk: {
    producer: ['worker/src/game/pk.js'], publication: ['worker/src/services/pk.js'],
    consumer: ['worker/public/app.js', 'worker/public/skill-vfx-legacy.mjs'],
    clock: 'recorded duel turn',
  },
  boss: {
    producer: ['worker/src/game/boss.js'], publication: ['worker/src/services/boss.js'],
    consumer: ['worker/public/app.js', 'worker/public/skill-vfx-legacy.mjs'],
    clock: 'recorded boss action',
  },
  party: {
    producer: ['worker/src/services/party.js'], publication: ['worker/src/services/party.js'],
    consumer: ['worker/public/expedition/combat-playback.js', 'worker/public/skill-vfx-legacy.mjs'],
    clock: 'recorded party turn',
  },
  'star-ring': {
    producer: ['worker/src/game/star-ring.js'], publication: ['worker/src/services/star-ring.js'],
    consumer: ['worker/public/star-ring-heroes.js', 'worker/public/skill-vfx-legacy.mjs'],
    clock: 'deterministic running projection or committed checkpoint; source remains explicit',
  },
  atlas: {
    producer: ['worker/src/game/atlas-engine.js', 'worker/src/game/atlas-combat-observer.js'],
    publication: ['worker/src/services/atlas.js'],
    consumer: ['worker/public/skill-vfx-actor-bridge.mjs', 'worker/public/skill-vfx-combat-adapter.mjs', 'worker/public/scene-live-session.js', 'worker/public/scene-live-view.js'],
    clock: 'committed 1000 ms simulation observation; actor release marker controls presentation',
  },
});
const ALLY_KEYS = ['heal', 'healDamage', 'shield', 'guard', 'reduce', 'nextReduce', 'nextDamage', 'atkUp', 'takenUp', 'damageUp', 'critUp', 'echo', 'cleanse', 'lastStand', 'revive', 'accelerate', 'overflow', 'shieldSlow', 'thiefCounter'];
const ENEMY_KEYS = ['breakDef', 'mark', 'interrupt', 'enemyNextReduce', 'dot', 'thiefPoison'];

export function coverageSemantics(skill) {
  const m = skill.mechanics || {};
  const common = {
    trigger: skill.system === 'native' ? 'successful-native-cast' : skill.system === 'special' ? 'successful-special-cast' : 'committed-atlas-cast',
    identitySource: skill.system === 'native' ? 'baseClass+classPath; basic strikes without a native cast are excluded' : 'explicit authoritative skill/build ID',
    targets: 'Only observed enemy hits or observed allied recipients; never infer from the visual family or target-count text.',
    passivePolicy: 'Class passives, talents and support modifiers never create an independent cast.',
  };
  if (skill.system === 'native') {
    return { ...common, immediateDamage: true, castPresentation: 'full', primaryAnchor: 'observed-enemy',
      alliedEffects: [], enemyEffects: (skill.tags || []).filter(tag => ['poison', 'dot', 'mark', 'enemy-next-reduce'].includes(tag)),
      delayedDamage: (skill.tags || []).includes('dot') ? ['observed-poison-tick'] : [],
      modes: LEGACY_MODES, restriction: 'Mana-starved fallback strikes are ordinary attacks, not this skill identity.' };
  }
  if (skill.system === 'atlas') {
    const placement = skill.mechanic === 'trap';
    return { ...common, immediateDamage: !placement, castPresentation: placement ? 'placement' : 'full',
      primaryAnchor: placement ? 'actual-caster-foot' : 'observed-enemy',
      alliedEffects: (skill.tags || []).includes('shield') ? ['observed-shield'] : [],
      enemyEffects: [], delayedDamage: ({ bleed: ['dot'], poison: ['dot'], beast: ['pet'], trap: ['trap'], counter: ['counter'] })[skill.mechanic] || [],
      modes: ['atlas'], restriction: 'A summon-tagged Atlas beast cast retains its actual immediate damage; trap placement does not imply a hit.' };
  }
  assert.equal(skill.system, 'special', 'Only implemented native, special and Atlas identities are admitted.');
  const direct = Number(m.singleCoefficient ?? m.coefficient) > 0;
  const summon = !direct && Number(m.summon) > 0;
  const ally = ALLY_KEYS.filter(key => !!m[key]);
  let recipient = m.all ? 'all-observed-living-allies' : m.revive ? 'selected-downed-ally'
    : m.lowest ? 'observed-lowest-living-ally' : (m.target || m.guard) ? 'selected-observed-ally' : 'caster';
  const delayed = [];
  if (m.dot) delayed.push('observed-burning-tick');
  if (m.thiefPoison) delayed.push('observed-poison-tick');
  if (m.summon) delayed.push('observed-summon-tick');
  if (m.reflect) delayed.push('observed-shield-reflection');
  return { ...common, immediateDamage: direct, castPresentation: summon ? 'summon' : direct ? 'full' : 'support',
    primaryAnchor: direct ? 'observed-enemy' : summon ? 'caster' : recipient,
    alliedEffects: ally, alliedRecipientPolicy: ally.length ? recipient : null,
    enemyEffects: ENEMY_KEYS.filter(key => !!m[key]), delayedDamage: delayed,
    nextAttackModifierOnly: !!m.thiefCounter,
    modes: m.revive ? ['party', 'star-ring'] : LEGACY_MODES,
    restriction: m.revive ? 'Requires a genuinely downed teammate; no solo/PK revival is claimed.'
      : m.thiefCounter ? 'Effective incoming damage arms a later attack bonus; it is not an independent counter hit.'
      : summon ? 'Initial cast summons locally with no enemy impact; only recorded later summon damage may impact.'
      : 'A support recipient is not an enemy damage target. Mixed damage/healing casts retain both observed applications.' };
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function workspacePath(path) {
  assert.equal(typeof path, 'string', 'Evidence paths must be strings.');
  const full = resolve(ROOT, path);
  const rel = relative(ROOT, full);
  assert.ok(!isAbsolute(rel) && !rel.startsWith('..'), 'Evidence must stay in this worktree: ' + path);
  return full;
}
const json = path => JSON.parse(readFileSync(workspacePath(path), 'utf8'));
const normalizedPath = path => String(path).replaceAll('\\', '/');

export function collectEvidence(receipts, sourceHash, knownIds) {
  const observations = [], inspectedReceipts = [];
  for (const { path, value } of receipts) {
    assert.equal(value.schemaVersion, 1, 'Unsupported evidence schema: ' + path);
    assert.equal(value.status, 'passed', 'Only successful completed evidence may count: ' + path);
    assert.ok(Array.isArray(value.sourceFiles) && value.sourceFiles.length > 0, 'Evidence has no source fingerprints: ' + path);
    const sourceFiles = value.sourceFiles.map(item => ({ path: normalizedPath(item.path), sha256: item.sha256 }));
    for (const item of sourceFiles) {
      assert.match(item.sha256, /^[a-f0-9]{64}$/, 'Malformed source hash: ' + item.path);
      assert.equal(sourceHash(item.path), item.sha256, 'Evidence is stale for ' + item.path + ': ' + path);
    }
    assert.ok(Array.isArray(value.cases), 'Evidence must contain individual cases: ' + path);
    inspectedReceipts.push({ path, generatedAt: value.generatedAt || null, sourceFiles, caseCount: value.cases.length });
    for (const c of value.cases) {
      assert.ok(c.id && c.mode && c.evidenceKind, 'Every evidence case needs id, mode and evidenceKind: ' + path);
      if (c.status && c.status !== 'passed') continue;
      assert.ok(Array.isArray(c.events), 'Every evidence case needs observed descriptors: ' + c.id);
      // A factory/schema test can validate admission but cannot prove a resolver
      // cast, a committed write, a player dispatch or browser rendering.
      const layer = ({
        resolver: 'resolver', 'real-resolver': 'resolver', 'engine-resolver-fixture': 'resolver', 'sqlite-committed': 'commit',
        'sqlite-committed-service-fixture': 'commit', 'committed-api': 'commit',
        presentation: 'presentation', browser: 'browser',
        'browser-receipt-replay': 'browser', 'browser-gameplay-api': 'browser',
      })[c.evidenceKind];
      if (!layer) continue;
      const grouped = new Map();
      for (const event of c.events) {
        assert.ok(knownIds.has(event.skillId), 'Evidence claims an unknown or planned skill: ' + event.skillId);
        assert.ok(event.eventId, 'Observed descriptors must have an event ID: ' + c.id);
        assert.ok(['committed-combat', 'deterministic-projection'].includes(event.source), 'Unknown event authority: ' + c.id);
        if (layer === 'commit') assert.equal(event.source, 'committed-combat', 'A projection is not proof of a committed event.');
        const key = event.skillId + ':' + String(event.source);
        const row = grouped.get(key) || { skillId: event.skillId, source: event.source, eventCount: 0 };
        row.eventCount++; grouped.set(key, row);
      }
      for (const row of grouped.values()) observations.push({
        ...row, mode: c.mode, layer, evidenceKind: c.evidenceKind, caseId: c.id, evidencePath: path,
      });
    }
  }
  return { observations, receipts: inspectedReceipts };
}

export function buildCoverage(catalog, recipes, evidence = { observations: [], receipts: [] }, sourceFiles = []) {
  const valid = validateCatalog(catalog), recipeMap = new Map(recipes.skills.map(skill => [skill.id, skill.recipe]));
  assert.equal(recipeMap.size, catalog.skills.length, 'Every implemented identity needs one recipe.');
  const ids = new Set(catalog.skills.map(skill => skill.id));
  for (const observation of evidence.observations) assert.ok(ids.has(observation.skillId), 'Unknown evidence identity.');
  const skills = catalog.skills.map(skill => {
    const recipe = recipeFor(skill); assert.deepEqual(recipeMap.get(skill.id), recipe, 'Stale recipe: ' + skill.id);
    const semantic = coverageSemantics(skill), observations = evidence.observations.filter(row => row.skillId === skill.id);
    const layers = layer => observations.filter(row => row.layer === layer);
    return {
      id: skill.id, sourceId: skill.sourceId, system: skill.system, baseClass: skill.baseClass,
      name: skill.name, kind: skill.kind, family: recipe.family, source: skill.source, semantic,
      preview: { status: 'recipe-present', directions: ['up', 'down', 'left', 'right'] },
      evidence: {
        resolver: { observed: layers('resolver').length > 0, cases: layers('resolver') },
        commit: { observed: layers('commit').length > 0, cases: layers('commit') },
        presentation: { observed: layers('presentation').length > 0, cases: layers('presentation') },
        browser: {
          observed: layers('browser').length > 0,
          controlledReplayObserved: layers('browser').some(row => row.evidenceKind === 'browser-receipt-replay'),
          gameplayObserved: layers('browser').some(row => row.evidenceKind === 'browser-gameplay-api'),
          cases: layers('browser'),
        },
      },
      integration: semantic.modes.map(mode => ({
        mode, paths: COVERAGE_PATHS[mode],
        observedLayers: ['resolver', 'commit', 'presentation', 'browser'].filter(layer => observations.some(row => row.mode === mode && row.layer === layer)),
        state: observations.some(row => row.mode === mode && row.layer === 'browser') ? 'browser-observed'
          : observations.some(row => row.mode === mode && row.layer === 'commit') ? 'committed-event-observed'
          : observations.some(row => row.mode === mode) ? 'local-observation-only' : 'not-individually-verified',
      })),
      production: 'not-deployed-by-this-workstream',
    };
  });
  const tally = predicate => skills.filter(predicate).length;
  return {
    schemaVersion: 1, scope: 'local-skill-vfx-coverage',
    sourceCatalog: CATALOG, sourceRecipes: RECIPES, sourceFiles,
    policies: {
      identity: '196 identities do not mean 196 independently painted atlases. Current recipe families are shared and composed.',
      evidence: 'Recipe presence, actual resolver casts, successful publication, player dispatch and browser observations are separate layers.',
      authority: 'Preserve each event source. deterministic-projection is not promoted to committed-combat.',
      coverage: 'A passing common adapter test does not count as every skill or every battle mode having been observed.',
      missing: 'No evidence means not individually verified, not an assertion that the feature is broken.',
      planning: 'Planned awakening skills and passive/support modifiers are excluded from implemented cast counts.',
    },
    summary: {
      implementedIdentities: skills.length, visualFamilies: valid.families.length,
      bySystem: Object.fromEntries(['native', 'special', 'atlas'].map(system => [system, tally(skill => skill.system === system)])),
      immediateDamageIdentities: tally(skill => skill.semantic.immediateDamage),
      nonDirectCastIdentities: tally(skill => !skill.semantic.immediateDamage),
      recipePresent: skills.length,
      resolverObserved: tally(skill => skill.evidence.resolver.observed),
      committedEventObserved: tally(skill => skill.evidence.commit.observed),
      presentationObserved: tally(skill => skill.evidence.presentation.observed),
      browserObserved: tally(skill => skill.evidence.browser.observed),
      controlledBrowserReplayObserved: tally(skill => skill.evidence.browser.controlledReplayObserved),
      gameplayBrowserObserved: tally(skill => skill.evidence.browser.gameplayObserved),
      resolverAndPresentationObserved: tally(skill => skill.evidence.resolver.observed && skill.evidence.presentation.observed),
      plannedExcluded: catalog.planned.length,
      supports: catalog.supports.length,
      allocatableTalents: catalog.talents.reduce((n, tree) => n + tree.nodes.filter(node => node.cost > 0).length, 0),
      origins: catalog.talents.reduce((n, tree) => n + tree.nodes.filter(node => node.kind === 'origin').length, 0),
    },
    skills,
    modifiers: {
      supports: catalog.supports.map(support => ({ id: support.id, name: support.name, independentCast: false, policy: support.visualPolicy, source: support.source })),
      talents: catalog.talents.map(tree => ({ baseClass: tree.baseClass, source: tree.source,
        nodes: tree.nodes.map(node => ({ id: node.id, kind: node.kind, effects: node.effects, independentCast: false })) })),
      nativeClassPassives: 'Preserved in each catalog skill.classPassives; part of the existing action rules, never a new cast identity.',
    },
    planned: catalog.planned.map(skill => ({ id: skill.id, name: skill.name, implemented: false, status: 'planned-only' })),
    receipts: evidence.receipts,
  };
}

function main(args) {
  const catalog = json(CATALOG), recipes = json(RECIPES);
  const extra = args.filter(arg => arg.startsWith('--evidence=')).map(arg => arg.slice('--evidence='.length));
  const receiptPaths = [...new Set([...DEFAULT_RECEIPTS.filter(path => existsSync(workspacePath(path))), ...extra])];
  const receipts = receiptPaths.map(path => ({ path, value: json(path) }));
  const hashFile = path => digest(readFileSync(workspacePath(path)));
  const evidence = collectEvidence(receipts, hashFile, new Set(catalog.skills.map(skill => skill.id)));
  const dependencies = [...new Set([CATALOG, RECIPES, 'worker/public/skill-vfx-engine.mjs',
    'worker/tools/build-skill-vfx-coverage.mjs', 'worker/tools/build-skill-vfx-catalog.mjs', 'worker/tools/build-skill-vfx-recipes.mjs',
    'worker/src/game/skill-vfx-events.js', 'worker/src/game/special.js', 'worker/src/game/special-data.js', 'worker/src/game/stats.js',
    ...Object.values(COVERAGE_PATHS).flatMap(mode => [...mode.producer, ...mode.publication, ...mode.consumer]),
    ...receiptPaths,
    ...evidence.receipts.flatMap(receipt => receipt.sourceFiles.map(file => file.path))])].sort();
  const sourceFiles = dependencies.map(path => ({ path, sha256: hashFile(path) }));
  const manifest = buildCoverage(catalog, recipes, evidence, sourceFiles);
  if (args.includes('--require-legacy-observations')) {
    const legacy = manifest.skills.filter(skill => skill.system !== 'atlas');
    assert.ok(legacy.every(skill => skill.evidence.resolver.observed && skill.evidence.presentation.observed),
      'Every legacy identity needs both a true resolver observation and an actual presentation dispatch.');
  }
  if (args.includes('--require-legacy-completion')) {
    const legacy = manifest.skills.filter(skill => skill.system !== 'atlas');
    assert.ok(legacy.every(skill => ['resolver', 'commit', 'presentation', 'browser'].every(layer => skill.evidence[layer].observed)),
      'Every legacy identity needs true resolver, committed event, player dispatch and browser evidence.');
  }
  if (args.includes('--check')) {
    assert.deepEqual(json(OUTPUT), manifest, 'VFX coverage is stale; regenerate it.');
  } else {
    const path = workspacePath(OUTPUT); mkdirSync(dirname(path), { recursive: true });
    const temp = path + '.tmp-' + process.pid;
    writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', 'utf8'); renameSync(temp, path);
  }
  console.log(JSON.stringify({ status: 'passed', mode: args.includes('--check') ? 'check' : 'build', path: OUTPUT, summary: manifest.summary }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
