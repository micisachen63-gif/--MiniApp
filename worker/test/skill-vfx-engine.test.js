import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEffectFrame, createVfxPlayer, drawEffectFrame, recipeFor, validateCatalog } from '../public/skill-vfx-engine.mjs';

const catalog = JSON.parse(readFileSync(new URL('../public/skill-vfx-catalog.json', import.meta.url), 'utf8'));
const byId = new Map(catalog.skills.map(skill => [skill.id, skill]));
const directions = ['right', 'down', 'left', 'up'];
const phases = [0, .015, .15, .22, .36, .5, .57, .71, .88, .99, 1];
const visiblePoints = frame => [
  ...frame.layers.map(layer => ({ x: layer.x, y: layer.y })),
  ...frame.geometry.flatMap(shape => shape.kind === 'ring' ? [{ x: shape.x, y: shape.y }] : shape.points),
];
function checkFrame(frame, quality, label) {
  // A mobile-sized effect must remain bounded regardless of its route/tier.
  assert.ok(frame.layers.length <= (quality === 'low' ? 48 : 96), label + ': bounded sprite count');
  assert.ok(frame.geometry.length <= 64, label + ': bounded geometry count');
  assert.ok(frame.layers.length + frame.geometry.length <= (quality === 'low' ? 112 : 160), label + ': bounded draw plan');
  for (const layer of frame.layers) {
    for (const key of ['x', 'y', 'w', 'h', 'rotation', 'alpha']) assert.ok(Number.isFinite(layer[key]), label + ': finite sprite ' + key);
    assert.ok(layer.w > 0 && layer.h > 0, label + ': positive dimensions');
    assert.ok(layer.alpha >= 0 && layer.alpha <= 1, label + ': sprite alpha');
    assert.ok(Number.isInteger(layer.cell) && layer.cell >= 0 && layer.cell < 9, label + ': valid atlas cell');
  }
  for (const shape of frame.geometry) {
    assert.ok(Number.isFinite(shape.alpha) && shape.alpha >= 0 && shape.alpha <= 1, label + ': geometry alpha');
    assert.ok(Number.isFinite(shape.width) && shape.width > 0, label + ': positive line width');
    if (shape.kind === 'ring') {
      for (const key of ['x', 'y', 'r', 'tilt']) assert.ok(Number.isFinite(shape[key]), label + ': finite ring ' + key);
      assert.ok(shape.r > 0 && shape.tilt > 0, label + ': positive ring size');
    } else {
      assert.equal(shape.kind, 'line');
      assert.ok(shape.points.length <= 32, label + ': bounded line point count');
      for (const point of shape.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), label + ': finite line point');
    }
  }
  if (frame.progress === 0 || frame.progress === 1) {
    assert.equal(frame.layers.length, 0, label + ': transparent clip boundary');
    assert.equal(frame.geometry.length, 0, label + ': transparent geometry boundary');
  }
}

function eventTarget() {
  const events = new Map();
  return {
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
    dispatch(name) { for (const callback of [...(events.get(name) || [])]) callback(); },
    listenerCount() { return [...events.values()].reduce((total, listeners) => total + listeners.size, 0); },
  };
}
function harness({ hidden = false, reduced = false } = {}) {
  let clock = 0, nextRaf = 0, saveDepth = 0, drawCount = 0;
  const pendingRaf = new Map(), images = [], draws = [];
  const doc = { ...eventTarget(), hidden };
  const media = { ...eventTarget(), matches: reduced };
  class FakeImage {
    constructor() { this.width = 900; this.height = 900; this.onload = null; this.onerror = null; this.complete = false; images.push(this); }
    set src(value) { this.source = value; }
    get src() { return this.source; }
    succeed() { this.complete = true; this.onload?.(); }
    fail() { this.onerror?.(new Error('fixture asset failed')); }
  }
  const ctx = {
    save() { saveDepth++; }, restore() { saveDepth--; assert.ok(saveDepth >= 0); },
    setTransform() {}, clearRect() {}, translate(...args) { assert.ok(args.every(Number.isFinite)); }, rotate(...args) { assert.ok(args.every(Number.isFinite)); }, scale(...args) { assert.ok(args.every(Number.isFinite)); }, beginPath() {}, stroke() {},
    ellipse(...args) { assert.ok(args.every(Number.isFinite)); }, moveTo(...args) { assert.ok(args.every(Number.isFinite)); },
    lineTo(...args) { assert.ok(args.every(Number.isFinite)); },
    drawImage(image, ...args) { assert.ok(image.complete !== false); assert.ok(args.every(Number.isFinite)); drawCount++; draws.push({ image, args }); },
  };
  const scope = {
    Image: FakeImage, performance: { now: () => clock }, devicePixelRatio: 1,
    requestAnimationFrame(callback) { const id = ++nextRaf; pendingRaf.set(id, callback); return id; },
    cancelAnimationFrame(id) { pendingRaf.delete(id); },
    matchMedia() { return media; },
  };
  doc.defaultView = scope;
  const canvas = { width: 800, height: 500, clientWidth: 800, clientHeight: 500, ownerDocument: doc, getContext: () => ctx };
  return {
    canvas, ctx, doc, media, images, draws,
    now: () => clock, rafCount: () => pendingRaf.size, drawCount: () => drawCount, saveDepth: () => saveDepth,
    advance(ms) { clock += ms; const callbacks = [...pendingRaf.values()]; pendingRaf.clear(); callbacks.forEach(callback => callback(clock)); },
    elapse(ms) { clock += ms; },
  };
}
async function preload(player, surface, baseClass) {
  const before = surface.images.length, promise = player.prepare(baseClass);
  if (surface.images.length > before) surface.images.at(-1).succeed();
  return promise;
}

test('catalogue has complete implemented identities and keeps proposals and passive modifiers separate', () => {
  const result = validateCatalog(catalog);
  assert.equal(result.skillCount, 196);
  assert.equal(catalog.skills.length, catalog.summary.implementedSkillIdentities);
  assert.equal(catalog.skills.filter(skill => skill.system === 'native').length, 124);
  assert.equal(catalog.skills.filter(skill => skill.system === 'special').length, 60);
  assert.equal(catalog.skills.filter(skill => skill.system === 'atlas').length, 12);
  assert.equal(catalog.planned.length, 16);
  assert.ok(catalog.planned.every(skill => !skill.implemented && !byId.has(skill.id)));
  assert.ok(catalog.supports.every(support => support.modifierOnly && !byId.has(support.id)));
  assert.equal(catalog.talents.reduce((count, tree) => count + tree.nodes.filter(node => node.cost > 0).length, 0), 120);
  assert.throws(() => validateCatalog({ ...catalog, skills: [catalog.skills[0], catalog.skills[0]] }), /Duplicate/);
});

test('all 196 identities stay finite and bounded in four directions, all phases and both quality settings', () => {
  const before = JSON.stringify(catalog.skills);
  for (const skill of catalog.skills) for (const [d, direction] of directions.entries()) for (const quality of ['high', 'low']) for (const progress of phases) {
    const options = { direction, quality, seed: 'audit-196', bodyHeight: [36, 96, 150, 480][d], from: { x: 640, y: 500 } };
    checkFrame(buildEffectFrame(skill, progress, options), quality, skill.id + '/' + direction + '/' + quality + '/' + progress);
  }
  assert.equal(JSON.stringify(catalog.skills), before, 'animation planning must not mutate source mechanics');
});

test('clips reproduce a seed, advance through visibly different frames, and normalize nonfinite progress safely', () => {
  for (const skill of catalog.skills) {
    const options = { seed: 'repeatable', direction: 'up', from: { x: 420, y: 260 } };
    assert.deepEqual(buildEffectFrame(skill, .7, options), buildEffectFrame(skill, .7, options), skill.id + ': reproducible');
    assert.notDeepEqual(buildEffectFrame(skill, .18, options).layers, buildEffectFrame(skill, .7, options).layers, skill.id + ': temporal change');
    for (const progress of [NaN, Infinity, -Infinity, -1, 2]) checkFrame(buildEffectFrame(skill, progress), 'high', skill.id + ': normalized progress');
  }
  const lightning = byId.get('atlas:mage_chain');
  assert.notDeepEqual(buildEffectFrame(lightning, .46, { seed: 1 }).geometry, buildEffectFrame(lightning, .46, { seed: 2 }).geometry);
});

test('directional projectiles actually travel toward the selected direction at a common body scale', () => {
  const skill = byId.get('native:mage:base'), axes = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const travel = [];
  for (const [index, direction] of directions.entries()) {
    const frame = buildEffectFrame(skill, .4, { direction, bodyHeight: 150, from: { x: 0, y: 0 } });
    const projectile = frame.layers.find(layer => layer.cell === 0);
    assert.ok(projectile, direction + ': projectile');
    const [dx, dy] = axes[index];
    const forward = projectile.x * dx + projectile.y * dy;
    const sideways = -projectile.x * dy + projectile.y * dx;
    assert.ok(forward > 0, direction + ': forward movement');
    travel.push(Math.hypot(forward, sideways));
  }
  assert.ok(Math.max(...travel) - Math.min(...travel) < 1e-8, 'direction changes preserve travel scale');
});

test('pure heals, buffs and defensive casts cannot produce effects on an unrelated enemy target', () => {
  const defensive = catalog.skills.filter(skill => ['heal', 'buff', 'shield'].includes(skill.kind));
  const from = { x: 120, y: 240 };
  for (const skill of defensive) for (const progress of [.34, .56, .74]) {
    const a = buildEffectFrame(skill, progress, { from, to: { x: 1500, y: 800 }, seed: 5 });
    const b = buildEffectFrame(skill, progress, { from, to: { x: -1500, y: -800 }, targets: [{ x: 4000, y: 1000 }], seed: 5 });
    assert.deepEqual({ layers: a.layers, geometry: a.geometry }, { layers: b.layers, geometry: b.geometry }, skill.id + ': defensive visuals cannot aim at enemy coordinates');
    assert.ok(visiblePoints(a).every(point => Math.hypot(point.x - from.x, point.y - from.y) < 700), skill.id + ': no remote hit');
  }
});

test('damaging shield and time skills retain a visible target impact rather than only a caster ornament', () => {
  const relevant = catalog.skills.filter(skill => skill.kind === 'attack' && ['shield', 'time'].includes(skill.family));
  const from = { x: 0, y: 0 }, to = { x: 2400, y: 400 };
  for (const skill of relevant) {
    assert.ok(!recipeFor(skill).support, skill.id + ': actual attack');
    const hasTargetEffect = [.4, .56, .68, .82].some(progress => {
      const frame = buildEffectFrame(skill, progress, { from, to, seed: 7 });
      return frame.layers.some(layer => Math.hypot(layer.x - to.x, layer.y - to.y) < 250 && [1, 2, 6, 8].includes(layer.cell));
    });
    assert.ok(hasTargetEffect, skill.id + ': damage needs a target release or impact');
  }
});

test('beasts and summons stay upright in every direction and mirror only when traveling left', () => {
  const summons = catalog.skills.filter(skill => ['beast', 'summon'].includes(skill.family));
  assert.ok(summons.some(skill => skill.family === 'beast') && summons.some(skill => skill.family === 'summon'));
  const classAtlas = { width: 900, height: 900, complete: true };
  const extras = { hawk: { width: 512, height: 512, complete: true }, 'fire-spirit': { width: 512, height: 512, complete: true } };
  for (const skill of summons) for (const direction of directions) for (const progress of [.3, .5, .7]) {
    const frame = buildEffectFrame(skill, progress, { direction, from: { x: 400, y: 300 }, bodyHeight: 150, seed: 'upright-spirit' });
    const spirits = frame.layers.filter(layer => layer.asset);
    assert.ok(spirits.length > 0, skill.id + '/' + direction + ': visible summon');
    for (const spirit of spirits) {
      assert.equal(spirit.asset, skill.family === 'beast' ? 'hawk' : 'fire-spirit');
      assert.ok(Number.isFinite(spirit.rotation) && Math.abs(spirit.rotation) < Math.PI / 4, skill.id + '/' + direction + ': body stays upright instead of rotating upside down');
      assert.equal(Boolean(spirit.flipX), direction === 'left', skill.id + '/' + direction + ': correct horizontal facing');
      assert.ok(spirit.w > 0 && spirit.h > 0, 'mirroring must not use a negative destination size');
    }
    if (progress === .5) {
      const surface = harness(), mirrored = [];
      const scale = surface.ctx.scale;
      surface.ctx.scale = (x, y) => { mirrored.push([x, y]); scale(x, y); };
      drawEffectFrame(surface.ctx, classAtlas, frame, extras);
      const spiritDraws = surface.draws.filter(draw => Object.values(extras).includes(draw.image));
      assert.equal(spiritDraws.length, spirits.length, skill.id + ': extra artwork is actually drawn');
      if (direction === 'left') assert.ok(mirrored.some(([x, y]) => x === -1 && y === 1), 'left facing uses horizontal, not vertical, mirroring');
      else assert.equal(mirrored.length, 0, 'up/down/right sprites retain upright source orientation');
      assert.equal(surface.saveDepth(), 0);
    }
  }
});

test('draw plans use valid atlas rectangles and leave the canvas save stack balanced', () => {
  const surface = harness();
  const atlas = { width: 1024, height: 1024, complete: true };
  for (const id of ['atlas:mage_chain', 'special:skill_15_1', 'native:thief:B222', 'special:skill_24_2']) {
    const frame = buildEffectFrame(byId.get(id), .64);
    assert.ok(drawEffectFrame(surface.ctx, atlas, frame) > 0);
    assert.equal(surface.saveDepth(), 0);
  }
  for (const { args } of surface.draws) {
    const [sx, sy, sw, sh] = args;
    assert.ok(sx >= 0 && sy >= 0 && sw > 0 && sh > 0 && sx + sw <= atlas.width && sy + sh <= atlas.height);
  }
});

test('clear prevents a cast waiting on an atlas from reappearing after character changes', async () => {
  const surface = harness(), renders = [];
  const player = createVfxPlayer(surface.canvas, { catalog, onRender: info => renders.push(info) });
  const pending = player.play({ skillId: 'native:mage:base' });
  assert.equal(surface.images.length, 1);
  player.clear();
  surface.images[0].succeed();
  const result = await pending;
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'superseded');
  assert.equal(player.stats().active, 0);
  assert.equal(surface.rafCount(), 0);
  assert.equal(surface.drawCount(), 0);
  assert.equal(renders.length, 0);
  player.destroy();
});

test('a later manual frame supersedes an earlier atlas load without stale redraw', async () => {
  const surface = harness(), errors = [];
  const player = createVfxPlayer(surface.canvas, { catalog, onError: error => errors.push(error) });
  const oldFrame = player.renderFrame({ skillId: 'native:mage:base', progress: .7 });
  const newFrame = player.renderFrame({ skillId: 'native:sword:base', progress: .7 });
  assert.equal(surface.images.length, 2);
  surface.images[1].succeed();
  assert.equal((await newFrame).accepted, true);
  const draws = surface.drawCount();
  surface.images[0].succeed();
  assert.equal((await oldFrame).accepted, false);
  assert.equal(surface.drawCount(), draws, 'old image callback must not repaint');
  assert.equal(errors.length, 0);
  assert.equal(surface.rafCount(), 0, 'manual frame has no animation loop');
  player.destroy();
});

test('player capacity bounds concurrent casts and reuses only one atlas load per class', async () => {
  const surface = harness();
  const player = createVfxPlayer(surface.canvas, { catalog, maxActive: 2 });
  const preloadA = player.prepare('sword'), preloadB = player.prepare('sword');
  assert.equal(surface.images.length, 1);
  surface.images[0].succeed();
  assert.equal(await preloadA, await preloadB);
  const results = await Promise.all([0, 1, 2, 3].map(seed => player.play({ skillId: 'native:sword:A', seed })));
  assert.equal(results.filter(result => result.accepted).length, 2);
  assert.ok(results.filter(result => !result.accepted).every(result => result.reason === 'capacity'));
  assert.equal(player.stats().active, 2);
  assert.equal(surface.rafCount(), 1, 'one shared animation loop');
  surface.advance(500);
  assert.ok(surface.drawCount() > 0);
  player.clear();
  assert.equal(player.stats().active, 0);
  assert.equal(surface.rafCount(), 0);
  player.destroy();
});

test('invalid capacity options retain a finite hard cap instead of silently allowing unlimited casts', async () => {
  for (const maxActive of [NaN, 'invalid', -4, 200]) {
    const surface = harness(), player = createVfxPlayer(surface.canvas, { catalog, maxActive });
    try {
      const stats = player.stats();
      assert.ok(Number.isInteger(stats.maxActive) && stats.maxActive >= 1 && stats.maxActive <= 12, String(maxActive) + ': finite cap');
      await preload(player, surface, 'mage');
      const results = await Promise.all(Array.from({ length: 20 }, () => player.play({ skillId: 'native:mage:base' })));
      assert.ok(results.filter(result => result.accepted).length <= 12);
    } finally { player.destroy(); }
  }
});

test('destroy cancels pending atlas work promptly and causes no late callbacks or retained handlers', async () => {
  const surface = harness(), errors = [], renders = [];
  const player = createVfxPlayer(surface.canvas, { catalog, onError: error => errors.push(error), onRender: info => renders.push(info) });
  const pending = player.play({ skillId: 'native:mage:base' });
  const image = surface.images[0];
  player.destroy();
  const waiting = Symbol('still-pending');
  const result = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve(waiting)))]);
  try {
    assert.notEqual(result, waiting, 'destroy must settle pending play even if the image request never responds');
    assert.equal(result.accepted, false);
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.equal(surface.doc.listenerCount(), 0);
    assert.equal(surface.media.listenerCount(), 0);
    assert.equal(player.stats().loadedAtlases, 0);
    assert.equal(player.stats().pendingLoads, 0);
    assert.equal(player.stats().active, 0);
    assert.equal(surface.rafCount(), 0);
    const beforeDraws = surface.drawCount();
    image.succeed();
    await Promise.resolve();
    assert.equal(surface.drawCount(), beforeDraws);
    assert.equal(errors.length, 0, 'intentional cancellation is not a UI error');
    assert.equal(renders.length, 0);
    assert.equal(surface.canvas.width, 1);
    assert.equal(surface.canvas.height, 1);
  } finally {
    // The failing implementation's request has no real network handle in this fixture.
    // Settling it prevents the test fixture itself from retaining an unresolved promise.
    if (image.onload) image.succeed();
    await pending;
  }
});

test('destroy also cancels a manual frame awaiting its atlas without reporting an application error', async () => {
  const surface = harness(), errors = [];
  const player = createVfxPlayer(surface.canvas, { catalog, onError: error => errors.push(error) });
  const pending = player.renderFrame({ skillId: 'native:archer:base', progress: .65 });
  const image = surface.images[0];
  player.destroy();
  const waiting = Symbol('still-pending');
  const result = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve(waiting)))]);
  try {
    assert.notEqual(result, waiting);
    assert.equal(result.accepted, false);
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.equal(surface.drawCount(), 0);
    assert.equal(errors.length, 0, 'cancelled manual preview must not write an error into a destroyed view');
  } finally {
    if (image.onload) image.succeed();
    await pending;
  }
});

test('hidden pages and reduced motion clear live effects and preserve a low-motion bounded plan', async () => {
  const surface = harness(), player = createVfxPlayer(surface.canvas, { catalog });
  await preload(player, surface, 'mage');
  assert.equal((await player.play({ skillId: 'atlas:mage_chain' })).accepted, true);
  surface.doc.hidden = true;
  surface.doc.dispatch('visibilitychange');
  assert.equal(player.stats().active, 0);
  assert.equal(surface.rafCount(), 0);
  assert.equal((await player.play({ skillId: 'atlas:mage_chain' })).reason, 'hidden');
  surface.doc.hidden = false;
  surface.media.matches = true;
  surface.media.dispatch('change');
  const reduced = await player.play({ skillId: 'atlas:mage_chain' });
  assert.equal(reduced.accepted, true);
  assert.ok(reduced.durationMs <= 500);
  for (const skill of catalog.skills) {
    const frame = buildEffectFrame(skill, .5, { reducedMotion: true });
    assert.ok(frame.layers.length <= 2 && frame.geometry.length <= 2, skill.id + ': reduced motion budget');
    checkFrame(frame, 'low', skill.id + ': reduced motion');
  }
  player.destroy();
  assert.equal(surface.doc.listenerCount() + surface.media.listenerCount(), 0);
});

test('late loads, expired events, and a changed actor admission gate cannot start obsolete effects', async () => {
  const surface = harness(), player = createVfxPlayer(surface.canvas, { catalog });
  let currentActor = 'old';
  const changed = player.play({ skillId: 'native:mage:base', canStart: () => currentActor === 'old' });
  currentActor = 'new';
  surface.images[0].succeed();
  assert.equal((await changed).accepted, false);
  assert.equal((await player.play({ skillId: 'native:mage:base', ageMs: 100000 })).reason, 'expired');
  const delayed = player.play({ skillId: 'native:archer:base' });
  surface.elapse(10000);
  surface.images[1].succeed();
  assert.equal((await delayed).reason, 'expired');
  assert.equal((await player.play({ skillId: 'planned:mage:elite' })).reason, 'unknown_skill');
  assert.equal(player.stats().active, 0);
  assert.equal(surface.rafCount(), 0);
  player.destroy();
});

test('recorded passive hits render only actual targets without another summon or caster charge', () => {
  const skill = byId.get('atlas:archer_beast'), from = { x: 40, y: 60 }, to = { x: 1800, y: 300 }, second = { x: 2200, y: 650 };
  for (const progress of [.05, .3, .75]) {
    const frame = buildEffectFrame(skill, progress, { from, to, targets: [to, second], presentationMode: 'impact' });
    assert.ok(frame.layers.length > 0);
    assert.ok(frame.layers.every(layer => !layer.asset), 'a pet hit must not summon new birds');
    assert.ok(visiblePoints(frame).every(p => [to, second].some(target => Math.hypot(p.x-target.x, p.y-target.y) < 220)), 'only recorded target geometry is used');
  }
  const defensive = catalog.skills.find(s => s.kind === 'shield');
  for (const reducedMotion of [false, true]) {
    const frame = buildEffectFrame(defensive, .3, { from, to, presentationMode: 'impact', reducedMotion });
    assert.ok(frame.layers.every(layer => Math.hypot(layer.x-to.x, layer.y-to.y) < 220));
  }
});

test('trap placement has no remote enemy impact and remains independent of unknown target coordinates', () => {
  const skill = byId.get('atlas:archer_trap'), from = { x: 320, y: 250 };
  for (const progress of [.2, .5, .8]) for (const reducedMotion of [false, true]) {
    const common = { from, presentationMode: 'placement', seed: 9, reducedMotion };
    const a = buildEffectFrame(skill, progress, { ...common, to: { x: 4000, y: 2000 } });
    const b = buildEffectFrame(skill, progress, { ...common, to: { x: -3000, y: -900 }, targets: [{ x: 9000, y: 1000 }] });
    assert.deepEqual(a, b);
    assert.ok(a.layers.length > 0);
    assert.ok(visiblePoints(a).every(p => Math.hypot(p.x-from.x, p.y-from.y) < 220));
  }
});

test('release-aligned playback uses effective duration including reduced motion', async () => {
  for (const reduced of [false, true]) {
    const surface = harness({ reduced }), player = createVfxPlayer(surface.canvas, { catalog });
    try {
      await preload(player, surface, 'mage');
      const result = await player.play({ skillId: 'atlas:mage_arcane', startProgress: .22, ageMs: 20 });
      assert.equal(result.accepted, true);
      if (reduced) assert.equal(result.durationMs, 420);
      const remaining = result.durationMs * .78 - 20;
      surface.advance(1);
      assert.ok(surface.drawCount() > 0, 'release-aligned clip is visible immediately');
      surface.advance(remaining - 2);
      assert.equal(player.stats().active, 1);
      surface.advance(2);
      assert.equal(player.stats().active, 0);
    } finally { player.destroy(); }
  }
});

test('impact and placement clips are bounded and account for asset loading and presentation delay', async () => {
  const surface = harness(), player = createVfxPlayer(surface.canvas, { catalog });
  try {
    const pending = player.play({ skillId: 'atlas:mage_arcane', startProgress: .22, presentationMode: 'impact', ageMs: 30 });
    surface.elapse(100); surface.images[0].succeed();
    const result = await pending;
    assert.equal(result.accepted, true); assert.equal(result.durationMs, 650);
    surface.advance(650 * .78 - 130 - 1);
    assert.equal(player.stats().active, 1);
    surface.advance(2);
    assert.equal(player.stats().active, 0);
    const expired = await player.play({ skillId: 'atlas:mage_arcane', startProgress: .9, presentationMode: 'impact', ageMs: 100 });
    assert.equal(expired.reason, 'expired');
    await preload(player, surface, 'archer');
    const placed = await player.play({ skillId: 'atlas:archer_trap', presentationMode: 'placement' });
    assert.equal(placed.accepted, true); assert.equal(placed.durationMs, 1200);
  } finally { player.destroy(); }
});

test('trap placement stays centered on the supplied foot point at every body scale and facing', () => {
  const skill = byId.get('atlas:archer_trap'), foot = { x: 640, y: 450 };
  for (const bodyHeight of [90, 180, 300]) for (const direction of ['up', 'down', 'left', 'right'])
    for (const progress of [.2, .5, .8]) for (const reducedMotion of [false, true]) {
      const frame = buildEffectFrame(skill, progress, { from: foot, bodyHeight, direction, reducedMotion, presentationMode: 'placement' });
      assert.ok(frame.layers.length > 0 && frame.geometry.length > 0);
      for (const layer of frame.layers) {
        assert.equal(layer.x, foot.x, 'ground sprite must not move sideways from the foot anchor');
        assert.equal(layer.y, foot.y, 'foot anchor must not receive a second anatomical ground offset');
      }
      for (const shape of frame.geometry) {
        assert.equal(shape.x, foot.x);
        assert.equal(shape.y, foot.y, 'the ground ring stays under the character at every scale');
      }
    }
});

test('non-damaging fire-spirit summon remains local and cannot imply an enemy impact',()=>{
 const skill=byId.get('special:skill_18_1'),from={x:320,y:300};
 for(const bodyHeight of [90,180,300])for(const direction of ['left','right','up','down'])
 for(const progress of [.2,.5,.8])for(const reducedMotion of [false,true]){
  const base={from,bodyHeight,direction,reducedMotion,presentationMode:'summon',seed:42};
  const a=buildEffectFrame(skill,progress,{...base,to:{x:4000,y:900},targets:[{x:5000,y:800}]});
  const b=buildEffectFrame(skill,progress,{...base,to:{x:-4000,y:-900},targets:[{x:-5000,y:-800}]});
  assert.deepEqual(a,b,'unknown enemy positions cannot affect a non-damaging summon');
  assert.ok(a.layers.length>0);
  assert.ok(visiblePoints(a).every(p=>Math.hypot(p.x-from.x,p.y-from.y)<bodyHeight*.8));
  assert.equal(a.layers.filter(layer=>layer.asset==='fire-spirit').length,reducedMotion?0:1);
  checkFrame(a,'high','summon');
 }
});
test('ancillary support on a direct attack has support geometry only at the supplied beneficiary',()=>{
 const skill=byId.get('native:sword:A11'),from={x:750,y:280};
 for(const supportKind of ['heal','shield','buff'])for(const reducedMotion of [false,true])for(const progress of [.2,.5,.8]){
  const common={from,bodyHeight:150,presentationMode:'support',supportKind,reducedMotion};
  const a=buildEffectFrame(skill,progress,{...common,to:{x:4000,y:900}});
  const b=buildEffectFrame(skill,progress,{...common,to:{x:-4000,y:-900}});
  assert.deepEqual(a,b);assert.ok(a.layers.length>0);
  assert.ok(visiblePoints(a).every(p=>Math.hypot(p.x-from.x,p.y-from.y)<200));
  assert.ok(a.layers.every(layer=>!layer.asset),'support must not create a companion');
 }
});
