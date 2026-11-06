import { createLegacyVfxLayer } from '../public/skill-vfx-legacy.mjs';

export function legacySurface({ reduced = false, autoLoad = true } = {}) {
  let clock = 0, nextFrame = 0, drawCalls = 0;
  const frames = new Map(), images = [], docListeners = new Map(), mediaListeners = new Map(), resizeObservers = [];
  const media = { matches: reduced, addEventListener: (name, fn) => mediaListeners.set(name, fn),
    removeEventListener: name => mediaListeners.delete(name) };
  // Count raster paints as well as atlas sprites; semantic cracks and waves use paths.
  // Clearing or transforming the canvas is not proof of a visible effect.
  const paints = Object.fromEntries(['drawImage', 'fill', 'stroke', 'fillRect', 'strokeRect'].map(name => [name, () => { drawCalls++; }]));
  const context = new Proxy(paints, { get(target, key) {
    if (key in target) return target[key];
    if (['canvas', 'globalAlpha', 'lineWidth'].includes(key)) return target[key];
    return () => {};
  }, set(target, key, value) { target[key] = value; return true; } });
  const document = { hidden: false, addEventListener: (name, fn) => docListeners.set(name, fn),
    removeEventListener: name => docListeners.delete(name), createElement() {
      return { width: 1280, height: 900, clientWidth: 1280, clientHeight: 900, style: {}, ownerDocument: document,
        setAttribute() {}, getContext: () => context, remove() { this.removed = true; } };
    } };
  const scope = {
    performance: { now: () => clock }, devicePixelRatio: 1,
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => media, getComputedStyle: () => ({ position: 'relative', objectFit: 'contain', objectPosition: '50% 100%' }),
    addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { constructor(callback) { this.callback = callback; resizeObservers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    Image: class {
      constructor() { this.width = this.height = 1254; images.push(this); }
      set src(value) { this._src = value; if (autoLoad) queueMicrotask(() => this.succeed()); }
      get src() { return this._src; }
      succeed() { this.onload?.(); }
      removeAttribute() { this._src = ''; }
    }
  };
  document.defaultView = scope;
  const scene = { ownerDocument: document, isConnected: true, clientWidth: 1280, clientHeight: 900,
    dataset: {}, style: {}, children: [], append(node) { this.children.push(node); },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: scene.clientWidth, height: scene.clientHeight }) };
  return { scene, document, scope, images, media, resizeObservers,
    drawCalls: () => drawCalls, rafCount: () => frames.size,
    advance(ms) { clock += ms; const callbacks = [...frames.values()]; frames.clear(); for (const fn of callbacks) fn(clock); },
    resize(width, height) { scene.clientWidth = width; scene.clientHeight = height; for (const observer of resizeObservers) observer.callback(); },
    hide() { document.hidden = true; docListeners.get('visibilitychange')?.(); },
    listenerCount: () => docListeners.size + mediaListeners.size,
    create: options => createLegacyVfxLayer(scene, options) };
}

export function geometryFor(descriptor) {
  const ids = [...new Set([descriptor.actorId, ...descriptor.targetIds,
    ...(descriptor.recipientEffects || []).flatMap(effect => effect.targetIds)])];
  const actor = { x: 260, y: 390 };
  return { actorId: descriptor.actorId, from: actor, foot: { x: 260, y: 470 }, bodyHeight: 170,
    direction: 'right', targets: ids.map((id, index) => ({
      id, point: id === descriptor.actorId ? actor : { x: 720 + index * 75, y: 350 + index * 28 },
      bodyHeight: id === descriptor.actorId ? 170 : 150
    })) };
}
