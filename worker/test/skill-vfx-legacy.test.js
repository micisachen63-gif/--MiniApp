import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { semanticFor } from '../public/skill-vfx-semantics.mjs';
import { createLegacyVfxLayer, legacyDescriptors, validateLegacyDescriptor, planLegacyVfx, legacyDomGeometry } from '../public/skill-vfx-legacy.mjs';
import { legacySurface, geometryFor } from './skill-vfx-legacy-harness.js';

const catalog = JSON.parse(readFileSync(new URL('../public/skill-vfx-catalog.json', import.meta.url), 'utf8'));
const legacySkills = catalog.skills.filter(skill => ['native', 'special'].includes(skill.system));
const byId = new Map(legacySkills.map(skill => [skill.id, skill]));
function descriptor(skillId = 'native:mage:base', changes = {}) {
  const skill = byId.get(skillId), support = ['heal', 'shield', 'buff'].includes(skill?.kind), summon = skill?.kind === 'summon';
  return { schemaVersion: 1, source: 'committed-combat', eventId: 'test:' + skillId,
    skillId, kind: 'cast', actorId: 'hero', atMs: 1000, targetKind: support || summon ? 'self' : 'enemy',
    targetIds: support || summon ? ['hero'] : ['enemy'], presentationMode: summon ? 'summon' : support ? 'support' : 'full', ...changes };
}

test('all 184 canonical legacy identities dispatch into the real player using only their explicit descriptor', async () => {
  assert.equal(legacySkills.length, 184);
  const surface = legacySurface(), layer = await surface.create({ catalog, mode: 'party', contextKey: 'all-identities' });
  const rows = legacySkills.map(skill => descriptor(skill.id));
  try {
    assert.equal(await layer.prepare(rows), true, 'all declared textures must finish preloading');
    for (const raw of rows) {
      const before = JSON.stringify(raw), count = surface.drawCalls();
      const result = await layer.play(raw, geometryFor(raw));
      assert.equal(result.accepted, true, raw.skillId + ': ' + result.reason);
      surface.advance(170);
      assert.ok(surface.drawCalls() > count, raw.skillId + ': actual engine draw commands');
      assert.equal(layer.stats().lastEvent.skillId, raw.skillId);
      assert.equal(JSON.stringify(raw), before, 'presentation must not mutate a receipt');
      layer.clear('next-test-case');
    }
    assert.equal(layer.stats().accepted, 184);
    assert.equal(layer.stats().commands, 184);
    assert.equal(layer.stats().player.loadedAtlases, 7);
  } finally { layer.destroy(); }
});

test('semantic companions preload one shared sheet and play all 25 identities without late image loads', async () => {
  const semanticSkills = legacySkills.filter(skill => semanticFor(skill).asset === 'semantic');
  assert.equal(semanticSkills.length, 25);
  const surface = legacySurface(), layer = await surface.create({ catalog, mode: 'party', contextKey: 'semantic-preload' });
  const rows = semanticSkills.map(skill => descriptor(skill.id));
  try {
    assert.equal(await layer.prepare(rows), true, 'the actual player accepts every declared preload');
    assert.equal(surface.images.filter(image => image.src === '/art/skill-vfx-20261104/semantic-atlas.webp').length, 1);
    const imageCount = surface.images.length;
    assert.equal(imageCount, new Set(semanticSkills.map(skill => skill.baseClass)).size + 1);
    assert.equal(layer.stats().accepted, 0, 'preparing images does not fabricate a cast');
    for (const raw of rows) {
      assert.equal(await layer.prepare([raw]), true, raw.skillId + ': repeated preload stays fulfilled');
      const before = surface.drawCalls(), result = await layer.play(raw, geometryFor(raw));
      assert.equal(result.accepted, true, raw.skillId + ': ' + result.reason);
      surface.advance(170);
      assert.ok(surface.drawCalls() > before, raw.skillId + ': the real engine paints after preparation');
      assert.equal(surface.images.length, imageCount, raw.skillId + ': play must not discover an unloaded image');
      layer.clear('next-semantic');
    }
    assert.equal(layer.stats().accepted, 25);
  } finally { layer.destroy(); }
});

test('legacy records and cosmetic loop events never acquire a guessed skill identity', () => {
  for (const event of [{ skillName: '火球術', skill: true }, { skillId: 'attack', nativeSkill: '強力斬' },
    { vfx: descriptor(), cosmetic: true }, { vfx: descriptor(), presentationOnly: true }]) {
    assert.deepEqual(legacyDescriptors(event), []);
  }
  assert.equal(validateLegacyDescriptor(descriptor('planned:mage:future'), catalog).reason, 'unknown-skill');
  assert.equal(validateLegacyDescriptor(descriptor('atlas:mage_arcane'), catalog).reason, 'unknown-skill');
});

test('deterministic star ring projections are explicit opt-in and retain their source in diagnostics', async () => {
  const raw = descriptor('native:archer:B2', { source: 'deterministic-projection' });
  assert.equal(validateLegacyDescriptor(raw, catalog).reason, 'unsupported-source');
  const surface = legacySurface(), layer = await surface.create({ catalog, mode: 'star-ring', contextKey: 'ring:beat1', allowProjection: true });
  try {
    const result = await layer.play(raw, geometryFor(raw)); surface.advance(150);
    assert.equal(result.accepted, true);
    assert.equal(layer.stats().lastEvent.source, 'deterministic-projection');
    assert.equal(JSON.parse(surface.scene.dataset.legacyVfx).lastSource, 'deterministic-projection');
  } finally { layer.destroy(); }
});

test('missing or malformed actor/target geometry never receives a fallback target', () => {
  const raw = descriptor(), geometry = geometryFor(raw);
  for (const invalid of [null, { ...geometry, actorId: 'different' }, { ...geometry, from: { x: NaN, y: 5 } },
    { ...geometry, bodyHeight: 0 }, { ...geometry, targets: [] }]) {
    assert.equal(planLegacyVfx(raw, invalid, catalog).accepted, false);
  }
  const multi = { ...raw, targetIds: ['enemy', 'not-in-scene'] };
  assert.equal(planLegacyVfx(multi, geometry, catalog).reason, 'missing-target-geometry');
});

test('support spells appear on the exact healed or guarded teammate, not on the caster', () => {
  for (const skill of legacySkills.filter(skill => ['heal', 'shield', 'buff'].includes(skill.kind))) {
    const raw = descriptor(skill.id, { targetKind: 'ally', targetIds: ['ally-a', 'ally-b'] });
    const geometry = geometryFor(raw), result = planLegacyVfx(raw, geometry, catalog);
    assert.equal(result.accepted, true, skill.id);
    assert.equal(result.commands.length, 2);
    for (const command of result.commands) {
      const target = geometry.targets.find(target => target.id === command.recipientId);
      assert.deepEqual(command.from, target.point);
      assert.deepEqual(command.to, target.point);
      assert.notDeepEqual(command.from, geometry.from);
      assert.equal(command.presentationMode, 'support');
    }
  }
});

test('mixed direct damage and sustain keep the attack on enemies and the healing on actual beneficiaries', () => {
  const raw = descriptor('native:sword:A11', { recipientEffects: [{ kind: 'heal', targetIds: ['hero'] }] });
  const geometry = geometryFor(raw), result = planLegacyVfx(raw, geometry, catalog);
  assert.equal(result.accepted, true);
  assert.equal(result.commands.length, 2);
  assert.deepEqual(result.commands[0].to, geometry.targets.find(target => target.id === 'enemy').point);
  assert.equal(result.commands[0].presentationMode, 'full');
  assert.equal(result.commands[1].presentationMode, 'support');
  assert.equal(result.commands[1].supportKind, 'heal');
  assert.deepEqual(result.commands[1].from, geometry.from);
});

test('only the truly non-damaging contract selects summon mode; native summon-family damage remains full', () => {
  const special = descriptor('special:skill_18_1');
  assert.equal(validateLegacyDescriptor(special, catalog).accepted, true);
  assert.equal(special.presentationMode, 'summon');
  assert.equal(validateLegacyDescriptor({ ...special, presentationMode: 'full' }, catalog).reason, 'invalid-offensive-mode');
  assert.equal(descriptor('native:mage:B2').presentationMode, 'full');
  assert.equal(validateLegacyDescriptor(descriptor('native:mage:B2', { presentationMode: 'summon' }), catalog).reason, 'invalid-summon-mode');
});

test('a real periodic effect is impact-only and never restarts a cast', async () => {
  const raw = descriptor('special:skill_18_1', { kind: 'effect', presentationMode: 'impact', targetKind: 'enemy', targetIds: ['enemy'] });
  const surface = legacySurface(), layer = await surface.create({ catalog, mode: 'party', contextKey: 'periodic' });
  try {
    const result = await layer.play(raw, geometryFor(raw)); surface.advance(120);
    assert.equal(result.accepted, true);
    assert.equal(result.durationMs, 650);
    assert.equal(result.impactDelayMs, 0);
    assert.ok(layer.stats().drawCalls > 0);
    assert.equal(layer.stats().lastEvent.presentationMode, 'impact');
  } finally { layer.destroy(); }
});

test('repeated aggregate hit links are admitted once, including after clearing a visible clip', async () => {
  const raw = descriptor('native:thief:A12', { damageModel: 'aggregate-minute' });
  const surface = legacySurface(), layer = await surface.create({ catalog, mode: 'idle', contextKey: 'one-minute' });
  try {
    assert.equal((await layer.play(raw, geometryFor(raw))).accepted, true);
    assert.equal((await layer.play(raw, geometryFor(raw))).reason, 'duplicate-event');
    layer.clear('layout');
    assert.equal((await layer.play(raw, geometryFor(raw))).reason, 'duplicate-event');
    assert.equal(layer.stats().accepted, 1);
    assert.equal(layer.stats().lastEvent.damageModel, 'aggregate-minute');
  } finally { layer.destroy(); }
});

test('an actor/context switch during atlas loading cancels the pending event without later drawing', async () => {
  const surface = legacySurface({ autoLoad: false }); let current = true;
  const layer = await surface.create({ catalog, mode: 'party', contextKey: 'old-party', isCurrent: () => current });
  const raw = descriptor(), pending = layer.play(raw, geometryFor(raw));
  current = false;
  for (const image of surface.images) image.succeed();
  const result = await pending;
  surface.advance(200);
  assert.equal(result.accepted, false);
  assert.equal(surface.drawCalls(), 0);
  assert.equal(layer.stats().accepted, 0);
  layer.destroy();
});

test('hide, resize and destroy clean up effects and preserve receipt admission', async () => {
  const surface = legacySurface(), layer = await surface.create({ catalog, mode: 'pk', contextKey: 'duel' });
  const raw = descriptor();
  await layer.play(raw, geometryFor(raw)); surface.advance(100);
  assert.ok(layer.stats().player.active > 0);
  surface.resize(390, 844);
  assert.equal(layer.stats().player.active, 0);
  assert.equal(layer.stats().lastClear, 'layout-changed');
  assert.equal((await layer.play(raw, geometryFor(raw))).reason, 'duplicate-event');
  surface.hide();
  assert.equal((await layer.play({ ...raw, eventId: 'later' }, geometryFor(raw))).reason, 'inactive-context');
  layer.destroy();
  assert.equal(surface.rafCount(), 0);
  assert.ok(surface.scene.children.every(node => node.removed));
  assert.ok(surface.resizeObservers.every(observer => observer.disconnected));
});

test('reduced motion remains visible and bounded for attack, support, summon and passive receipt modes', async () => {
  const surface = legacySurface({ reduced: true }), layer = await surface.create({ catalog, mode: 'party', contextKey: 'reduced' });
  const support = legacySkills.find(skill => skill.kind === 'heal');
  try {
    for (const raw of [descriptor(), descriptor(support.id), descriptor('special:skill_18_1'),
      descriptor('special:skill_18_1', { eventId: 'pulse', kind: 'effect', presentationMode: 'impact', targetKind: 'enemy', targetIds: ['enemy'] })]) {
      const result = await layer.play(raw, geometryFor(raw)); surface.advance(80);
      assert.equal(result.accepted, true);
      assert.equal(result.durationMs, 420);
      assert.equal(result.impactDelayMs, 0);
      assert.ok(layer.stats().player.drawCalls > 0);
      layer.clear('next');
    }
  } finally { layer.destroy(); }
});

test('DOM projection respects visible contain geometry and CSS scaling without using placeholder coordinates', () => {
  const doc = { defaultView: { getComputedStyle: () => ({ objectFit: 'contain', objectPosition: '50% 100%' }) } };
  const actor = { ownerDocument: doc, isConnected: true, naturalWidth: 100, naturalHeight: 200,
    getBoundingClientRect: () => ({ x: 100, y: 200, width: 100, height: 300 }) };
  const target = { ...actor, getBoundingClientRect: () => ({ x: 500, y: 100, width: 200, height: 300 }) };
  const scene = { clientWidth: 500, clientHeight: 400, getBoundingClientRect: () => ({ x: 0, y: 0, width: 1000, height: 800 }) };
  const geometry = legacyDomGeometry(scene, actor, [{ id: 'enemy', node: target }], { actorId: 'hero' });
  assert.equal(geometry.bodyHeight, 100);
  assert.deepEqual(geometry.foot, { x: 75, y: 250 });
  assert.deepEqual(geometry.targets[0].point, { x: 300, y: 117.5 });
  assert.equal(legacyDomGeometry(scene, null, [], { actorId: 'hero' }), null);
});
