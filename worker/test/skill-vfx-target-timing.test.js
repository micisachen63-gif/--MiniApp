import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEffectFrame, recipeFor } from '../public/skill-vfx-engine.mjs';

const catalog = JSON.parse(readFileSync(new URL('../public/skill-vfx-catalog.json', import.meta.url), 'utf8'));
const skillFor = family => {
  const skill = catalog.skills.find(value => value.family === family && value.kind === 'attack')
    || catalog.skills.find(value => value.family === family);
  assert.ok(skill, 'Real catalogue identity for ' + family);
  return skill;
};
const DIRECTIONS = ['right', 'down', 'left', 'up'];
const ANGLES = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const RELEASE = .22, CONTACT = .57, EPSILON = 1e-6;
const origin = { x: 600, y: 600 };
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < EPSILON;
const projected = (point, from, direction) => (point.x - from.x) * Math.cos(ANGLES[direction]) + (point.y - from.y) * Math.sin(ANGLES[direction]);
function destination(direction, distance, across = 0) {
  const angle = ANGLES[direction];
  return { x: origin.x + Math.cos(angle) * distance - Math.sin(angle) * across,
    y: origin.y + Math.sin(angle) * distance + Math.cos(angle) * across };
}
function targetsFor(count, direction = 'right') {
  return Array.from({ length: count }, (_, i) => destination(direction, 230 + (i % 8) * 54, Math.floor(i / 8) * 67));
}
const settings = (targets, direction = 'right', quality = 'high', extra = {}) => ({
  from: origin, to: targets[0] || destination(direction, 900), targets, direction, quality, bodyHeight: 150, seed: 'target-contact-regression', ...extra,
});
function frameFor(family, progress, options) {
  return buildEffectFrame(skillFor(family), progress, options);
}
function assertBudget(frame, quality, label) {
  assert.ok(frame.layers.length <= (quality === 'low' ? 48 : 94), label + ': sprite budget');
  assert.ok(frame.geometry.length <= 64, label + ': geometry budget');
  for (const layer of frame.layers) {
    for (const key of ['x', 'y', 'w', 'h', 'rotation', 'alpha']) assert.ok(Number.isFinite(layer[key]), label + ': finite ' + key);
    assert.ok(layer.w > 0 && layer.h > 0 && layer.alpha >= 0 && layer.alpha <= 1, label + ': valid sprite');
  }
  for (const shape of frame.geometry) {
    assert.ok(Number.isFinite(shape.alpha) && shape.alpha >= 0 && shape.alpha <= 1, label + ': valid geometry');
    if (shape.kind === 'line') {
      assert.ok(shape.points.length <= 32, label + ': bounded line');
      assert.ok(shape.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), label + ': finite line');
    }
  }
}
function anchored(frame, point) {
  return frame.layers.some(layer => near(layer, point))
    || frame.geometry.some(shape => shape.kind === 'ring' && near(shape, point));
}
function contactAnchors(frame, family) {
  // Particles can leave a target. Only impact rings and actual lightning ends
  // establish contacts, independently of decorative spark count.
  return frame.geometry.flatMap(shape => shape.kind === 'ring' ? [{ x: shape.x, y: shape.y }]
    : family === 'lightning' && shape.kind === 'line' ? [shape.points.at(-1)] : []);
}
const primarySize = { pierce: 80, snipe: 105, fireball: 110 };
function projectile(frame, family) {
  return frame.layers.find(layer => layer.cell === 0 && Math.abs(layer.w - primarySize[family]) < EPSILON);
}

for (const family of ['pierce', 'snipe', 'fireball']) {
  test(family + ': live release starts at the actor anchor and contact reaches the authoritative target at the declared impact phase', () => {
    const recipe = recipeFor(skillFor(family));
    assert.equal(recipe.phases.find(phase => phase.id === 'release').from, RELEASE, 'Existing actor-release marker stays fixed');
    assert.equal(recipe.impactAt, CONTACT, 'Existing hit scheduling contract stays fixed');
    for (const direction of DIRECTIONS) for (const distance of [240, 960]) {
      const target = destination(direction, distance), options = settings([target], direction);
      const label = family + '/' + direction + '/' + distance;
      assert.equal(projectile(frameFor(family, RELEASE - .0001, options), family), undefined, label + ': no projectile before actor release');
      const released = projectile(frameFor(family, RELEASE, options), family);
      assert.ok(released && near(released, origin), label + ': projectile starts at release anchor');
      const travelling = projectile(frameFor(family, .4, options), family);
      assert.ok(travelling && projected(travelling, origin, direction) > 0 && projected(travelling, origin, direction) < distance,
        label + ': projectile travels between actor and target');
      const contact = projectile(frameFor(family, CONTACT, options), family);
      assert.ok(contact && near(contact, target), label + ': center reaches target at impact phase');
      assert.ok(anchored(frameFor(family, CONTACT + .004, options), target), label + ': contact has a target-centered hit');
    }
  });
}

test('piercing projectiles continue beyond the true contact without relocating the impact to the tail endpoint', () => {
  for (const direction of DIRECTIONS) {
    const target = destination(direction, 400), options = settings([target], direction);
    const contact = projectile(frameFor('pierce', CONTACT, options), 'pierce');
    const tail = projectile(frameFor('pierce', .62, options), 'pierce');
    assert.ok(contact && near(contact, target), direction + ': true target contact');
    assert.ok(tail && projected(tail, origin, direction) > 400, direction + ': forward penetration after contact');
    const frame = frameFor('pierce', .62, options);
    assert.ok(frame.geometry.some(shape => shape.kind === 'ring' && near(shape, target)), direction + ': impact remains at true target');
    assert.equal(projectile(frameFor('pierce', .6501, options), 'pierce'), undefined, direction + ': travel tail ends by .65');
  }
});

for (const family of ['volley', 'lightning']) for (const count of [4, 5, 8, 32]) {
  test(family + ': all ' + count + ' actual targets receive contact before late fade in both quality settings and all directions', () => {
    for (const quality of ['high', 'low']) for (const direction of DIRECTIONS) {
      const targets = targetsFor(count, direction), options = settings(targets, direction, quality), seen = new Set();
      const samples = [...Array.from({ length: 34 }, (_, i) => .401 + i * .01), .735];
      for (const progress of samples) {
        const frame = frameFor(family, progress, options);
        assertBudget(frame, quality, family + '/' + count + '/' + direction + '/' + progress);
        const anchors = contactAnchors(frame, family);
        targets.forEach((target, index) => { if (anchors.some(point => near(point, target))) seen.add(index); });
      }
      assert.deepEqual([...seen].sort((a, b) => a - b), targets.map((_, index) => index),
        family + '/' + count + '/' + quality + '/' + direction + ': target contacts complete by .735');
    }
  });
}

test('volley primary contact follows its declared .57 impact phase even with a large actual target set', () => {
  for (const count of [1, 2, 8, 32]) for (const quality of ['high', 'low']) {
    const targets = targetsFor(count), options = settings(targets, 'right', quality);
    for (const progress of [.45, .52, CONTACT - .0001]) {
      const rings = frameFor('volley', progress, options).geometry.filter(shape => shape.kind === 'ring');
      assert.ok(rings.every(shape => !targets.some(target => near(shape, target))), count + '/' + quality + ': no early impact ring');
    }
    const frame = frameFor('volley', CONTACT + .004, options);
    assert.ok(contactAnchors(frame, 'volley').some(point => near(point, targets[0])), count + '/' + quality + ': primary contact after declared impact');
  }
});

test('explicit single, pair and empty target sets never create an extra volley or lightning destination', () => {
  const unrelated = destination('left', 1200, 350);
  for (const family of ['volley', 'lightning']) for (const count of [0, 1, 2]) {
    const targets = targetsFor(count), options = settings(targets, 'right', 'high', { to: unrelated });
    for (const progress of [.45, .6, .7, .79]) {
      const frame = frameFor(family, progress, options), anchors = contactAnchors(frame, family);
      // A travelling lightning endpoint may lie between true targets. Only
      // landed impact rings assert a hit; empty lists still forbid every arc.
      const impacts = frame.geometry.filter(shape => shape.kind === 'ring');
      assert.ok(impacts.every(point => targets.some(target => near(point, target))),
        family + '/' + count + '/' + progress + ': contact is one of the explicitly supplied targets');
      if (count === 0) {
        assert.equal(frame.layers.filter(layer => layer.cell === 0).length, 0, family + ': no projectile when targets explicitly empty');
        assert.equal(anchors.length, 0, family + ': no contact when targets explicitly empty');
      }
    }
  }
});

test('exact duplicate destinations are normalized before volley and lightning distribution', () => {
  const targets = targetsFor(8);
  const duplicates = [targets[0], { ...targets[0] }, targets[1], { ...targets[1] }, ...targets.slice(2)];
  for (const family of ['volley', 'lightning']) for (const progress of [.41, .6, .72, .79]) for (const quality of ['high', 'low']) {
    const reference = frameFor(family, progress, settings(targets, 'right', quality));
    const repeated = frameFor(family, progress, settings(duplicates, 'right', quality));
    assert.deepEqual({ layers: repeated.layers, geometry: repeated.geometry }, { layers: reference.layers, geometry: reference.geometry },
      family + '/' + progress + '/' + quality + ': duplicate points cannot consume target slots or create repeated contacts');
  }
});

for (const mode of ['impact', 'reduced-full', 'reduced-impact']) {
  test(mode + ': every actual hit remains visible for 4, 5, 8 and 32 targets without exceeding presentation budgets', () => {
    for (const family of ['volley', 'lightning']) for (const count of [4, 5, 8, 32]) for (const quality of ['high', 'low']) for (const direction of DIRECTIONS) {
      const targets = targetsFor(count, direction), options = settings(targets, direction, quality, {
        presentationMode: mode.includes('impact') ? 'impact' : 'full',
        reducedMotion: mode.startsWith('reduced-'),
      });
      const frame = frameFor(family, .38, options);
      assertBudget(frame, quality, mode + '/' + family + '/' + count + '/' + direction);
      for (const target of targets) assert.ok(anchored(frame, target),
        mode + '/' + family + '/' + count + '/' + quality + '/' + direction + ': actual target has a center sprite or impact ring');
    }
  });
}

test('impact and reduced-motion rendering honor empty and deduplicated actual target lists', () => {
  const targets = targetsFor(8), duplicates = [targets[0], { ...targets[0] }, ...targets.slice(1)];
  for (const family of ['volley', 'lightning']) for (const mode of ['impact', 'reduced-full', 'reduced-impact']) {
    const extra = { presentationMode: mode.includes('impact') ? 'impact' : 'full', reducedMotion: mode.startsWith('reduced-') };
    const plain = frameFor(family, .38, settings(targets, 'right', 'high', extra));
    const repeated = frameFor(family, .38, settings(duplicates, 'right', 'high', extra));
    assert.deepEqual({ layers: repeated.layers, geometry: repeated.geometry }, { layers: plain.layers, geometry: plain.geometry },
      family + '/' + mode + ': duplicate normalized');
    const empty = frameFor(family, .38, settings([], 'right', 'high', extra));
    assert.equal(empty.layers.length + empty.geometry.length, 0, family + '/' + mode + ': no invented destination');
  }
});

test('local support, trap placement and non-damaging summon never expand onto remote targets', () => {
  const cases = [
    { skill: skillFor('heal'), presentationMode: 'support', supportKind: 'heal' },
    { skill: skillFor('shield'), presentationMode: 'support', supportKind: 'shield' },
    { skill: skillFor('buff'), presentationMode: 'support', supportKind: 'buff' },
    { skill: catalog.skills.find(skill => skill.id === 'atlas:archer_trap'), presentationMode: 'placement' },
    { skill: catalog.skills.find(skill => skill.id === 'special:skill_18_1'), presentationMode: 'summon' },
  ];
  for (const item of cases) for (const reducedMotion of [false, true]) for (const quality of ['high', 'low']) {
    assert.ok(item.skill);
    const base = { from: origin, direction: 'right', bodyHeight: 150, seed: 51, presentationMode: item.presentationMode,
      supportKind: item.supportKind, reducedMotion, quality };
    const local = buildEffectFrame(item.skill, .5, { ...base, to: origin, targets: [] });
    const crowded = buildEffectFrame(item.skill, .5, { ...base, to: destination('left', 2000), targets: targetsFor(32) });
    assert.deepEqual({ layers: crowded.layers, geometry: crowded.geometry }, { layers: local.layers, geometry: local.geometry },
      item.presentationMode + '/' + item.supportKind + '/' + reducedMotion + ': local presentation ignores unrelated target geometry');
    assertBudget(crowded, quality, item.presentationMode);
  }
});
