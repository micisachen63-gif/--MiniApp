import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const viewSource = fs.readFileSync(new URL('../public/scene-live-view.js', import.meta.url), 'utf8');
const readabilitySource = fs.readFileSync(new URL('../public/scene-hero-readability.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

// The fixture models Phaser's relevant lifetime rule: Texture.remove destroys
// each Frame.data, and getBounds reads Frame.data.sourceSize even when hidden.
// No art catalog, network, browser, font, or machine-specific path is required.
function harness({ live = true, webgl = true, strictRelease = true, manualLoads = false } = {}) {
  const images = [], textures = new Map(), animations = new Map(), shutdown = [], pending = [], loads = [];
  let actorGeneration = 0, monsters = [], world = { w: 2194.4, h: 2194.4 };
  function texture(key, size = 100, height = size) {
    const frame = { name: 0, data: { sourceSize: { w: size, h: height } }, get realWidth() { return this.data.sourceSize.w; } };
    const value = { key, frame, getSourceImage: () => ({ width: size, height }) };
    textures.set(key, value); return value;
  }
  texture('__MISSING', 1); texture('hero_idle', 1); texture('ground', 1);
  class Image {
    constructor(key, frame = 0) {
      this.active = true; this.visible = true; this.x = 0; this.y = 0; this.depth = 0;
      this.originX = this.originY = .5; this.scaleX = this.scaleY = 1; this.alpha = 1;
      this.anims = { stop() {} }; this.setTexture(key, frame); images.push(this);
    }
    setTexture(key) { this.texture = textures.get(key) || textures.get('__MISSING'); this.frame = this.texture.frame; return this; }
    setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
    setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
    setFlip(x, y) { this.flipX = x; this.flipY = y; return this; }
    setFlipX(x) { this.flipX = x; return this; }
    setDepth(n) { this.depth = n; return this; }
    setAlpha(n) { this.alpha = n; return this; }
    setVisible(n) { this.visible = n; return this; }
    setTintFill() { return this; }
    play(key) { this.animation = key; const frame = animations.get(key)?.frames[0]; if (frame) this.setTexture(frame.key); return this; }
    getBounds() { const width = this.frame.realWidth * this.scaleX, height = this.frame.data.sourceSize.h * this.scaleY, x = this.x - this.originX * width, y = this.y - this.originY * height; return { x, y, width, height, right: x + width, bottom: y + height }; }
    createBitmapMask() { return { destroy() {} }; }
    addToDisplayList(list) { this.displayList = list; return this; }
    destroy() { this.active = false; this.visible = false; }
  }
  const node = () => {
    const children = [], selectors = new Map();
    return { children, textContent: '', style: {}, dataset: {}, classList: { add() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, appendChild(child) { children.push(child); }, replaceChildren() {}, remove() {}, querySelector(selector) { if (!selectors.has(selector)) selectors.set(selector, node()); return selectors.get(selector); } };
  };
  const document = { documentElement: node(), body: node(), createElement: node, querySelector: () => null, getElementById: () => null };
  const handlers = new Map();
  const window = { document, __RpgScenePreviewConfig: { live }, addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); }, dispatchEvent(event) { for (const callback of handlers.get(event.type) || []) callback(event); } };
  const graphics = { mask: null, clear() {}, fillStyle() { return this; }, fillRect() { return this; }, setMask(mask) { this.mask = mask; }, clearMask() { this.mask = null; } };
  const layer = { length: 0, mask: null, setDepth() {}, setMask(mask) { this.mask = mask; }, clearMask() { this.mask = null; } };
  const listeners = new Map(), queue = [];
  const listen = (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); };
  const emit = (event, value) => { for (const callback of [...(listeners.get(event) || [])]) callback(value); };
  const camera = { x: 0, y: 0, width: 390, height: 844, scrollX: 902, scrollY: 894, zoom: 1, following: true,
    setBounds() { return this; }, setViewport(x, y, width, height) { Object.assign(this, { x, y, width, height }); return this; },
    stopFollow() { this.following = false; return this; },
    centerOn(x, y) { this.scrollX = x - this.width / 2; this.scrollY = y - this.height / 2; this.worldView = { x: this.scrollX, y: this.scrollY, width: this.width, height: this.height }; return this; },
  };
  const scene = {
    game: { renderer: { gl: webgl ? {} : null } }, scale: { width: 390, height: 844 },
    cameras: { main: camera }, sys: { displayList: {} },
    events: { once(event, fn) { if (event === 'shutdown') shutdown.push(fn); } },
    add: { layer: () => layer, image: (x, y, key, frame) => new Image(key, frame).setPosition(x, y), sprite: (x, y, key) => new Image(key).setPosition(x, y) },
    make: { image: ({ key, frame }) => new Image(key, frame) },
    anims: { exists: key => animations.has(key), create(value) { animations.set(value.key, value); }, generateFrameNumbers: key => [{ key, frame: 0 }], remove: key => animations.delete(key) },
    time: { delayedCall() {} },
    textures: {
      exists: key => textures.has(key), get: key => textures.get(key),
      remove(key) {
        if (strictRelease) assert.equal(images.some(image => image.active && image.texture?.key === key), false, 'detach every image before removing ' + key);
        const old = textures.get(key); if (old) old.frame.data = null; textures.delete(key);
      },
    },
    load: {
      once: listen, on: listen, off(event, callback) { if (callback) listeners.get(event)?.delete(callback); else listeners.delete(event); },
      image(key) { queue.push({ key, kind: 'image' }); },
      spritesheet(key, url, frame) { queue.push({ key, kind: 'spritesheet', frame }); },
      start() {
        for (const item of queue.splice(0)) {
          const load = { ...item, finish() { texture(item.key, item.frame?.frameWidth || 1024, item.frame?.frameHeight || 1536); emit('filecomplete-' + item.kind + '-' + item.key); }, fail() { emit('loaderror', { key: item.key }); } };
          loads.push(load); if (!manualLoads) queueMicrotask(() => load.finish());
        }
      },
    },
  };
  const hero = new Image('hero_idle'), ground = new Image('ground');
  const animator = {
    ready: false, keys: [], clips: { idle: { down: {} } },
    destroy() { actorGeneration++; this.ready = false; for (const key of this.keys) scene.textures.remove(key); this.keys = []; },
    load(id) {
      const generation = ++actorGeneration; this.ready = false; hero.setVisible(false);
      return new Promise((resolve, reject) => pending.push({ id, fail: () => reject(Error('temporary actor load failure')), finish: () => {
        if (generation !== actorGeneration) { resolve(false); return; }
        const key = id + ':' + generation; texture(key, 480, 512);
        for (const previous of this.keys) scene.textures.remove(previous);
        this.keys = [key]; this.ready = true; hero.setTexture(key).setOrigin(240 / 480, 470 / 512).setVisible(true); resolve(true);
      } }));
    },
    play: () => true, update() { if (this.ready) hero.setScale(scene.scale.height * .20 / 300); },
  };
  vm.runInNewContext(readabilitySource, { window, document });
  const readability = window.RpgHeroReadability.mount(scene, { hero, monsters: () => monsters, ready: () => animator.ready, hpGraphics: graphics });
  vm.runInNewContext(viewSource, { window, Intl, Number, Object, Set, Map, String, Error, Date });
  const hooks = { hero, ground, animator, hpGraphics: graphics, resetReadability: () => readability.reset(), setMonsters: value => { monsters = value; }, getWorld: () => world, setWorld: value => { world = value; }, ui: { setHP() {}, setMP() {}, setXP() {}, target() {}, toggle() {} } };
  const render = () => { for (const image of images) if (image.active && image.visible && image.alpha > 0) image.getBounds(); };
  return { scene, window, hero, ground, animator, readability, graphics, layer, hooks, pending, loads, images, texture, render, shutdown };
}
function camp(id = 'A', appearance = id) {
  return {
    schemaVersion: 1, realmId: 'permanent', accountId: '90101', characterId: id, serverNow: 10000,
    character: { id, name: id, appearanceKey: appearance, level: 1 },
    live: { hp: 50, mp: 20, maxHp: 100, maxMp: 50, gold: 7, activeRunId: null, supplies: { hp: 3, mp: 4 } }, run: null,
  };
}

for (const webgl of [true, false]) {
  test('live ' + (webgl ? 'WebGL' : 'Canvas') + ' readability suspends released frames and resumes the new actor', () => {
    const h = harness({ webgl, strictRelease: false });
    h.texture('actor-a'); h.hero.setTexture('actor-a'); h.animator.ready = true; h.readability.update();
    assert.equal(h.readability.inspect().maskTexture, 'actor-a');
    h.scene.textures.remove('actor-a'); h.animator.ready = false; h.hero.setVisible(false);
    assert.throws(() => h.hero.getBounds(), /sourceSize/, 'fixture reproduces Phaser destroyed Frame failure');
    assert.doesNotThrow(() => h.readability.update());
    assert.equal(h.readability.inspect().suspended, true); assert.equal(h.readability.inspect().maskTexture, 'hero_idle');
    assert.equal(h.readability.inspect().outlineAlpha, 0); assert.equal(h.graphics.mask, null);
    h.texture('actor-b'); h.hero.setTexture('actor-b').setVisible(true); h.animator.ready = true;
    h.readability.update(); h.render();
    assert.equal(h.readability.inspect().suspended, false); assert.equal(h.readability.inspect().maskTexture, 'actor-b');
    assert.ok(h.readability.inspect().outlineAlpha > 0); if (webgl) assert.ok(h.graphics.mask);
  });
}

test('switch, appearance upgrade, async cancellation, null and shutdown detach frames before release', async () => {
  const h = harness(), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks);
  view.apply(camp('A', 'mage')); h.pending.shift().finish(); await flush(); view.update(16); h.readability.update(); h.render();
  assert.equal(view.inspect().characterVisible, true);
  // Same identity can acquire a new appearance; old textures must still detach.
  view.apply(camp('A', 'adv1_mage_B_m')); h.readability.update(); h.render();
  assert.equal(view.inspect().characterVisible, false); assert.equal(h.readability.inspect().maskTexture, 'hero_idle');
  h.pending.shift().finish(); await flush(); h.readability.update(); h.render();
  assert.equal(view.inspect().characterVisible, true);
  view.apply(camp('B', 'archer')); const stale = h.pending.shift();
  view.apply(camp('C', 'thief')); const latest = h.pending.shift();
  stale.finish(); latest.finish(); await flush();
  h.scene.scale.width = 1280; h.scene.scale.height = 900; view.update(16); h.readability.update(); h.render();
  assert.equal(view.inspect().characterId, 'C'); assert.equal(view.inspect().characterVisible, true);
  assert.match(h.readability.inspect().maskTexture, /^thief:/);
  view.apply(camp('D', 'sword')); const cleared = h.pending.shift(); view.apply(null); cleared.finish(); await flush();
  view.update(16); h.readability.update(); h.render();
  assert.equal(view.inspect().characterId, null); assert.equal(view.inspect().characterVisible, false);
  view.apply(camp('A', 'mage')); const disposed = h.pending.shift();
  for (const shutdown of h.shutdown) shutdown(); disposed.finish(); await flush();
  assert.equal(h.window.RpgSceneLiveView.inspect().length, 0); assert.doesNotThrow(() => h.readability.update());
});

test('return to camp releases the map only after the ground image is detached', async () => {
  const h = harness(), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks), state = camp();
  state.live.activeRunId = 'run';
  state.run = { id: 'run', characterId: 'A', realmId: 'permanent', active: true, revision: 1, status: 'running', map: { id: 'laurel_intro', themeId: 1, kind: 'tutorial', name: '月桂' }, hero: { hp: 50, mp: 20, maxHp: 100, maxMp: 50 }, supplies: { hp: 3, mp: 4 }, enemies: [], events: [], report: { gold: 0, exp: 0, kills: 0 } };
  view.apply(state); h.pending.shift().finish(); await flush(); h.readability.update(); h.render();
  assert.equal(view.inspect().mapReady, true); assert.match(h.ground.texture.key, /^live-/);
  view.apply(camp()); h.readability.update(); h.render();
  assert.equal(view.inspect().mapReady, false); assert.equal(h.ground.texture.key, 'ground'); assert.equal(h.ground.visible, false);
});

test('portrait ground cover and viewport changes keep the real actor bounds above the HUD immediately', async () => {
  const h = harness(), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks), state = camp();
  h.window.document.getElementById = id => id === 'bottom' ? { getBoundingClientRect: () => ({ x: 0, y: h.scene.scale.height * .75, width: h.scene.scale.width, height: h.scene.scale.height * .25 }) } : null;
  function visibleAboveHUD() {
    const { width, height } = h.scene.scale, camera = h.scene.cameras.main;
    assert.equal(camera.width, width); assert.equal(camera.height, height);
    assert.ok(Math.abs(h.hero.x - camera.scrollX - width / 2) < 1, 'actor anchor centered in current viewport');
    assert.ok(Math.abs(h.hero.y - camera.scrollY - height / 2) < 1, 'actor anchor does not inherit a stale follow scroll');
    const g = view.inspect().geometry, bounds = g.hero.screenBounds;
    assert.ok(bounds.x >= 0 && bounds.right <= width && bounds.y >= 0 && bounds.bottom < g.hud.y, 'actual sprite frame stays fully visible above bottom HUD');
    assert.equal(h.hero.scaleY, height * .20 / 300, 'preserves the source animator body-height ratio');
    assert.equal(h.hero.originY, 470 / 512, 'preserves the source foot anchor');
  }
  view.apply(state); h.pending.shift().finish(); await flush(); view.update(16); visibleAboveHUD();
  h.scene.scale.width = 1280; h.scene.scale.height = 900; view.update(16); visibleAboveHUD();
  state.live.activeRunId = 'run';
  state.run = { id: 'run', characterId: 'A', realmId: 'permanent', active: true, revision: 1, status: 'running', map: { id: 'laurel_intro', themeId: 1, kind: 'tutorial', name: '月桂' }, hero: { hp: 50, mp: 20, maxHp: 100, maxMp: 50 }, supplies: { hp: 3, mp: 4 }, enemies: [], events: [], report: { gold: 0, exp: 0, kills: 0 } };
  view.apply(state); await flush(); view.update(16); visibleAboveHUD();
  assert.ok(view.inspect().geometry.world.height > 3 * h.scene.scale.height, 'portrait cover genuinely creates a much taller world');
  assert.equal(h.scene.cameras.main.following, false, 'committed layout never waits for the art demo follow lerp');
  h.scene.scale.width = 390; h.scene.scale.height = 844; view.update(16); visibleAboveHUD();
  view.apply(camp()); view.update(16); visibleAboveHUD(); h.readability.update(); h.render();
});

test('art preview retains its active silhouette and visibility toggle', () => {
  const h = harness({ live: false }); h.texture('art-actor'); h.hero.setTexture('art-actor'); h.animator.ready = true;
  h.readability.update(); assert.equal(h.readability.inspect().maskTexture, 'art-actor'); assert.ok(h.graphics.mask);
  h.readability.setEnabled(false); assert.equal(h.graphics.mask, null); h.readability.update(); assert.equal(h.readability.inspect().outlineAlpha, 0);
  h.readability.setEnabled(true); h.readability.update(); assert.ok(h.graphics.mask); h.render();
});

function expedition(enemies = []) {
  const state = camp('A', 'mage'); state.live.activeRunId = 'run';
  state.run = { id: 'run', characterId: 'A', realmId: 'permanent', active: true, revision: 1, status: 'running', map: { id: 'laurel_intro', themeId: 1, kind: 'tutorial', name: '月桂' }, hero: { hp: 50, mp: 20, maxHp: 100, maxMp: 50 }, supplies: { hp: 3, mp: 4 }, enemies, events: [], report: { gold: 0, exp: 0, kills: 0 } };
  return state;
}

test('same-actor snapshots retry a failed load without duplicating an in-flight actor request', async () => {
  const h = harness(), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks), state = camp('A', 'mage');
  view.apply(state); view.apply(state); assert.equal(h.pending.length, 1);
  h.pending.shift().fail(); await flush();
  assert.equal(view.inspect().characterVisible, false); assert.match(view.inspect().actorIssue, /載入失敗/);
  view.apply(state); assert.equal(h.pending.length, 1, 'same actor retries after failure');
  h.pending.shift().finish(); await flush(); h.readability.update(); h.render();
  assert.equal(view.inspect().characterVisible, true); assert.equal(view.inspect().actorIssue, '');
  view.apply(state); assert.equal(h.pending.length, 0, 'a successfully loaded actor is retained');
});

test('a late actor failure cannot invalidate the newer character or trigger its reload', async () => {
  const h = harness(), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks);
  view.apply(camp('A', 'mage')); const old = h.pending.shift();
  view.apply(camp('B', 'archer')); h.pending.shift().finish(); await flush();
  old.fail(); await flush(); view.apply(camp('B', 'archer')); h.readability.update(); h.render();
  assert.equal(view.inspect().characterId, 'B'); assert.equal(view.inspect().appearance, 'archer');
  assert.equal(view.inspect().characterVisible, true); assert.equal(view.inspect().actorIssue, '');
  assert.equal(h.pending.length, 0);
});

test('same-run snapshots recover a failed background and keep an in-flight load intact', async () => {
  const h = harness({ manualLoads: true }), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks), state = expedition();
  view.apply(state); h.pending.shift().finish(); await flush();
  const first = h.loads.shift(); assert.equal(first.kind, 'image');
  view.apply(state); assert.equal(h.loads.length, 0, 'polling does not restart an in-flight background');
  first.fail(); await flush(); assert.equal(view.inspect().mapReady, false); assert.ok(view.inspect().mapIssue);
  view.apply(state); const retry = h.loads.shift(); assert.equal(retry.kind, 'image');
  view.apply(state); assert.equal(h.loads.length, 0);
  retry.finish(); await flush(); h.readability.update(); h.render();
  assert.equal(view.inspect().mapReady, true); assert.equal(view.inspect().mapIssue, '');
  view.apply(state); assert.equal(h.loads.length, 0); assert.equal(h.pending.length, 0);
});

test('same-enemy snapshots recover metadata and spritesheet failures without duplicate loads', async () => {
  const h = harness({ manualLoads: true }), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks);
  let metadataRequests = 0;
  h.window.fetch = async () => {
    if (++metadataRequests === 1) throw Error('temporary metadata failure');
    return { ok: true, json: async () => ({ moon_hare_idle: { file: 'moon_hare_idle.webp', cellW: 100, cellH: 100, frames: 2, ox: .5, oy: .9, frameInfo: [{ h: 80 }, { h: 80 }] } }) };
  };
  const state = expedition([{ id: '0:0:0', name: '月光野兔', rank: 'normal', hp: 15, maxHp: 70 }]);
  view.apply(state); h.pending.shift().finish(); h.loads.shift().finish(); await flush();
  assert.equal(view.inspect().mapReady, true); assert.equal(view.inspect().spriteCount, 0); assert.equal(view.inspect().assetIssues.length, 1);
  view.apply(state); await flush(); const firstSprite = h.loads.shift(); assert.equal(firstSprite.kind, 'spritesheet');
  view.apply(state); await flush(); assert.equal(h.loads.length, 0, 'only one pending request for the same enemy');
  firstSprite.fail(); await flush(); assert.equal(view.inspect().assetIssues.length, 1);
  view.apply(state); await flush(); const retry = h.loads.shift(); assert.equal(retry.key, firstSprite.key, 'failed promise is evicted for the same texture key');
  retry.finish(); await flush(); h.readability.update(); h.render();
  assert.equal(view.inspect().spriteCount, 1); assert.equal(view.inspect().assetIssues.length, 0);
  assert.equal(metadataRequests, 2, 'successful metadata remains reusable');
  view.apply(state); await flush(); assert.equal(h.loads.length, 0);
});

test('connection failure labels the last snapshot and a successful snapshot clears only that warning', () => {
  const h = harness(), view = h.window.RpgSceneLiveView.mount(h.scene, h.hooks), state = camp('A', null);
  h.window.dispatchEvent({ type: 'rpg:scene-state', detail: state });
  const panel = h.window.document.body.children[0], connection = panel.querySelector('[data-live-connection]'), assets = panel.querySelector('[data-live-warning]');
  const actorIssue = view.inspect().actorIssue; assert.ok(actorIssue);
  h.window.dispatchEvent({ type: 'rpg:scene-error', detail: { message: '測試 API 暫時離線' } });
  assert.equal(connection.hidden, false); assert.match(connection.textContent, /同步失敗.*上次資料/);
  assert.equal(view.inspect().hp, 50); assert.equal(view.inspect().characterId, 'A');
  assert.equal(view.inspect().actorIssue, actorIssue); assert.ok(assets.textContent.includes(actorIssue));
  h.window.dispatchEvent({ type: 'rpg:scene-state', detail: state });
  assert.equal(connection.hidden, true); assert.equal(connection.textContent, ''); assert.equal(view.inspect().syncError, null);
  assert.equal(view.inspect().actorIssue, actorIssue, 'connection recovery must not hide missing artwork');
});
