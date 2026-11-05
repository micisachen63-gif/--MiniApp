import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { recipeFor } from '../public/skill-vfx-engine.mjs';
import { buildCoverage, collectEvidence, coverageSemantics } from '../tools/build-skill-vfx-coverage.mjs';

const catalog = JSON.parse(readFileSync(new URL('../public/skill-vfx-catalog.json', import.meta.url), 'utf8'));
const recipes = { skills: catalog.skills.map(skill => ({ id: skill.id, recipe: recipeFor(skill) })) };
const byId = new Map(catalog.skills.map(skill => [skill.id, skill]));
const hash = 'a'.repeat(64);
const sourceFiles = [{ path: 'worker/src/game/skill-vfx-events.js', sha256: hash }];
const event = skillId => ({ eventId: 'observed:1', skillId, source: 'committed-combat' });
const receipt = cases => [{ path: 'local-evidence.json', value: { schemaVersion: 1, status: 'passed', sourceFiles, cases } }];

test('all implemented identities have explicit cast semantics; passive and planned entries never become casts', () => {
  const report = buildCoverage(catalog, recipes);
  assert.equal(report.summary.implementedIdentities, 196);
  assert.deepEqual(report.summary.bySystem, { native: 124, special: 60, atlas: 12 });
  assert.equal(report.summary.nonDirectCastIdentities, 25);
  assert.equal(report.summary.immediateDamageIdentities, 171);
  assert.equal(report.summary.plannedExcluded, 16);
  assert.equal(report.summary.allocatableTalents, 120);
  assert.equal(report.summary.origins, 4);
  assert.equal(report.summary.supports, 6);
  assert.ok(report.modifiers.supports.every(row => row.independentCast === false));
  assert.ok(report.modifiers.talents.every(tree => tree.nodes.every(node => node.independentCast === false)));
  assert.ok(report.planned.every(row => !row.implemented));
  assert.equal(report.summary.resolverObserved, 0);
  assert.equal(report.summary.presentationObserved, 0);
  assert.equal(report.summary.browserObserved, 0);
});

test('same visual family does not override real damage, summon, trap or counter mechanics', () => {
  const pureSummon = coverageSemantics(byId.get('special:skill_18_1'));
  assert.equal(pureSummon.immediateDamage, false);
  assert.equal(pureSummon.castPresentation, 'summon');
  assert.deepEqual(pureSummon.delayedDamage, ['observed-summon-tick']);
  const nativeSummon = coverageSemantics(byId.get('native:mage:B2'));
  assert.equal(nativeSummon.immediateDamage, true);
  assert.equal(nativeSummon.castPresentation, 'full');
  const beast = coverageSemantics(byId.get('atlas:archer_beast'));
  assert.equal(beast.immediateDamage, true);
  assert.equal(beast.castPresentation, 'full');
  assert.deepEqual(beast.delayedDamage, ['pet']);
  const trap = coverageSemantics(byId.get('atlas:archer_trap'));
  assert.equal(trap.immediateDamage, false);
  assert.equal(trap.castPresentation, 'placement');
  const counterBuff = coverageSemantics(byId.get('special:skill_thief_06'));
  assert.equal(counterBuff.immediateDamage, false);
  assert.equal(counterBuff.nextAttackModifierOnly, true);
  assert.deepEqual(counterBuff.delayedDamage, []);
  const reflect = coverageSemantics(byId.get('special:skill_02_3'));
  assert.equal(reflect.immediateDamage, false);
  assert.deepEqual(reflect.delayedDamage, ['observed-shield-reflection']);
});

test('mixed heal attacks, real ally targets and revival conditions remain explicit', () => {
  const mixed = coverageSemantics(byId.get('special:skill_09_1'));
  assert.equal(mixed.immediateDamage, true);
  assert.equal(mixed.primaryAnchor, 'observed-enemy');
  assert.equal(mixed.alliedRecipientPolicy, 'observed-lowest-living-ally');
  assert.ok(mixed.alliedEffects.includes('heal'));
  const targeted = coverageSemantics(byId.get('special:skill_06_2'));
  assert.equal(targeted.primaryAnchor, 'selected-observed-ally');
  const team = coverageSemantics(byId.get('special:skill_23_2'));
  assert.equal(team.primaryAnchor, 'all-observed-living-allies');
  assert.ok(team.alliedEffects.includes('overflow'));
  const revival = coverageSemantics(byId.get('special:skill_24_2'));
  assert.equal(revival.primaryAnchor, 'selected-downed-ally');
  assert.deepEqual(revival.modes, ['party', 'star-ring']);
});

test('evidence stays individual, layer-specific and mode-specific; source labels are never promoted', () => {
  const id = 'special:skill_18_1';
  const inputs = receipt([
    { id: 'factory-only', mode: 'idle', evidenceKind: 'factory', events: [event('native:sword:base')] },
    { id: 'actual-summon', mode: 'special-resolver', evidenceKind: 'engine-resolver-fixture', events: [event(id), event(id)] },
    { id: 'player-dispatch', mode: 'idle', evidenceKind: 'presentation', events: [{ ...event(id), source: 'deterministic-projection' }] },
    { id: 'sqlite-service', mode: 'party', evidenceKind: 'sqlite-committed-service-fixture', events: [event(id)] },
    { id: 'controlled-browser', mode: 'identity-replay', evidenceKind: 'browser-receipt-replay', events: [event(id)] },
  ]);
  const evidence = collectEvidence(inputs, () => hash, new Set(byId.keys()));
  const report = buildCoverage(catalog, recipes, evidence);
  assert.equal(report.summary.resolverObserved, 1);
  assert.equal(report.summary.presentationObserved, 1);
  assert.equal(report.summary.committedEventObserved, 1);
  assert.equal(report.summary.browserObserved, 1);
  assert.equal(report.summary.controlledBrowserReplayObserved, 1);
  assert.equal(report.summary.gameplayBrowserObserved, 0);
  assert.equal(report.summary.resolverAndPresentationObserved, 1);
  const row = report.skills.find(skill => skill.id === id);
  assert.equal(row.evidence.resolver.cases[0].eventCount, 2);
  assert.equal(row.evidence.presentation.cases[0].source, 'deterministic-projection');
  assert.equal(row.integration.find(mode => mode.mode === 'idle').state, 'local-observation-only');
  assert.equal(row.integration.find(mode => mode.mode === 'boss').state, 'not-individually-verified');
  assert.equal(row.integration.find(mode => mode.mode === 'party').state, 'committed-event-observed');
  assert.ok(!row.integration.some(mode => mode.state === 'browser-observed'));
  assert.equal(report.skills.find(skill => skill.id === 'native:sword:base').evidence.resolver.observed, false);
});

test('stale, unfinished, unknown/planned or fingerprint-free evidence cannot make coverage green', () => {
  const cases = [{ id: 'real-cast', mode: 'idle', evidenceKind: 'resolver', events: [event('native:sword:base')] }];
  assert.throws(() => collectEvidence(receipt(cases), () => 'b'.repeat(64), new Set(byId.keys())), /stale/);
  const pending = receipt(cases); pending[0].value.status = 'running';
  assert.throws(() => collectEvidence(pending, () => hash, new Set(byId.keys())), /successful completed/);
  const noFingerprint = receipt(cases); noFingerprint[0].value.sourceFiles = [];
  assert.throws(() => collectEvidence(noFingerprint, () => hash, new Set(byId.keys())), /fingerprints/);
  const planned = receipt([{ ...cases[0], events: [event('planned:sword:elite')] }]);
  assert.throws(() => collectEvidence(planned, () => hash, new Set(byId.keys())), /unknown or planned/);
  const projection = receipt([{ ...cases[0], evidenceKind: 'sqlite-committed', events: [{ ...event('native:sword:base'), source: 'deterministic-projection' }] }]);
  assert.throws(() => collectEvidence(projection, () => hash, new Set(byId.keys())), /not proof of a committed/);
  const missing = { skills: recipes.skills.slice(1) };
  assert.throws(() => buildCoverage(catalog, missing), /one recipe/);
});
