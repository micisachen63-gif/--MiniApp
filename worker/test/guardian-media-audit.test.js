import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publicConfig} from '../src/game/guardian-sigil-config.js';

const read = name => fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const mediaOptions = {treeVideoUrl: 'art/guardian-scene-20261014/tree.mp4', deityVideoUrl: 'art/guardian-scene-20261014/angel-alpha.webm',
  treeArtUrl: 'art/guardian-scene-20261014/tree.webp', deityArtUrl: 'art/guardian-scene-20261014/angel.webp'};

function target() {
  const listeners = new Map();
  return {listeners, addEventListener(name, fn) {if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn);},
    removeEventListener(name, fn) {listeners.get(name)?.delete(fn); if (!listeners.get(name)?.size) listeners.delete(name);},
    emit(name, detail = {}) {for (const fn of [...listeners.get(name) || []]) fn(detail);}};
}
function node(tag = 'div') {
  const classes = new Set(), api = {...target(), tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: new Map(), parent: null,
    classList: {add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value), toggle: (value, on) => on ? classes.add(value) : classes.delete(value)},
    setAttribute(name, value) {api.attributes.set(name, value);}, removeAttribute(name) {api.attributes.delete(name);},
    append(child) {child.parent = api; api.children.push(child);}, remove() {if (api.parent) api.parent.children = api.parent.children.filter(child => child !== api); api.parent = null;}};
  return api;
}
function setup(options = {}) {
  const window = target(), reduced = {...target(), matches: !!options.reduced}, connection = {...target(), saveData: !!options.saveData};
  const videos = [], observers = [], canvases = [];
  const document = {...target(), hidden: !!options.hidden, documentElement: {clientHeight: 844, clientWidth: 390}, createElement(tag) {
    if (tag === 'canvas') {
      const canvas = node(tag); canvases.push(canvas);
      canvas.getContext = () => options.nullContext ? null : {
        drawImage(video) {if (options.alphaError) throw Error('decoder/canvas unavailable'); assert.ok(video.readyState >= 2); canvas.video = video;},
        getImageData() {return {data: new Uint8ClampedArray([0, 0, 0, options.alpha ?? 0])};}
      };
      return canvas;
    }
    const video = node(tag); let src = '';
    Object.assign(video, {paused: true, playCalls: 0, pauseCalls: 0, loadCalls: 0, sourceWrites: 0, currentTime: 0, duration: NaN,
      readyState: 0, videoWidth: 0, videoHeight: 0,
      canPlayType: () => options.vp9 === false ? '' : 'probably',
      play() {video.playCalls++; if (options.play) return options.play(video); video.paused = false; return Promise.resolve();},
      pause() {video.pauseCalls++; video.paused = true;}, load() {video.loadCalls++; video.readyState = 0;},
      removeAttribute(name) {video.attributes.delete(name); if (name === 'src') src = '';}});
    Object.defineProperty(video, 'src', {get: () => src, set(value) {video.sourceWrites++; src = value;}});
    videos.push(video); return video;
  }};
  window.innerWidth = 390; window.innerHeight = 844; window.navigator = {connection}; window.matchMedia = () => reduced;
  const scene = node(), tree = node('button'), angel = node('button'), treeArt = node('img'), angelArt = node('svg');
  tree.append(treeArt); angel.append(angelArt); scene.append(tree); scene.append(angel);
  scene.dataset = options.dataset || {};
  let box = options.box || {top: 0, left: 0, bottom: 800, right: 390};
  scene.getBoundingClientRect = () => box;
  scene.querySelector = selector => selector === '.guardian-worldtree-background' ? tree : selector === '.guardian-angel-foreground' ? angel : null;
  const Observer = options.observer === false ? undefined : class {
    constructor(callback) {this.callback = callback; this.disconnected = false; observers.push(this);}
    observe(element) {this.element = element;}
    disconnect() {this.disconnected = true;}
    show(value) {this.callback([{target: this.element, isIntersecting: value}]);}
  };
  const context = vm.createContext({window, document, IntersectionObserver: Observer});
  vm.runInContext(read('guardian-sigil-contract.js'), context);
  vm.runInContext(read('guardian-scene-media.js'), context);
  let handle;
  const mount = (config = mediaOptions) => handle = window.RpgGuardianSceneMedia.mount(scene, config);
  const show = (value = true) => observers.at(-1)?.show(value);
  const data = video => {video.readyState = 2; video.duration = 10; video.videoWidth = 500; video.videoHeight = 842; video.emit('loadeddata');};
  return {window, document, reduced, connection, scene, tree, angel, treeArt, angelArt, videos, observers, canvases, mount, show, data,
    setBox: value => box = value, get handle() {return handle;}};
}

test('video options load only after intersection and decoded frames preserve the original posters until ready', async () => {
  const h = setup(), handle = h.mount();
  assert.equal(h.videos.length, 2); assert.equal(handle.getState().visible, false);
  assert.ok(h.videos.every(video => !video.src && video.playCalls === 0));
  h.show(false); assert.ok(h.videos.every(video => !video.src));
  h.show(); assert.ok(h.videos.every(video => video.sourceWrites === 1 && video.playCalls === 1));
  assert.equal(h.scene.classList.contains('is-tree-video-ready'), false); assert.equal(h.scene.classList.contains('is-angel-video-ready'), false);
  assert.equal(h.videos[0].poster, mediaOptions.treeArtUrl); assert.equal(h.videos[1].poster, mediaOptions.deityArtUrl);
  assert.ok(h.videos.every(video => video.preload === 'none' && video.muted && video.defaultMuted && video.loop && video.playsInline));
  assert.ok(h.tree.children.includes(h.treeArt)); assert.ok(h.angel.children.includes(h.angelArt));
  h.videos.forEach(h.data); await tick();
  assert.equal(h.scene.classList.contains('is-tree-video-ready'), true); assert.equal(h.scene.classList.contains('is-angel-video-ready'), true);
  assert.equal(h.canvases.length, 1); h.data(h.videos[1]); assert.equal(h.canvases.length, 1); handle.cleanup();
});
test('scene datasets are supported and malformed/external/non-video sources never receive a src', () => {
  const h = setup({dataset: {guardianTreeVideo: mediaOptions.treeVideoUrl, guardianDeityVideo: mediaOptions.deityVideoUrl}});
  h.mount({}); h.show(); assert.equal(h.videos[0].src, mediaOptions.treeVideoUrl); assert.equal(h.videos[1].src, mediaOptions.deityVideoUrl); h.handle.cleanup();
  for (const path of ['https://evil.test/video.mp4', 'art/../secret.mp4', 'art/test/photo.webp', 'javascript:alert(1)', 'art/%2e%2e/video.mp4']) {
    const h = setup(); h.mount({treeVideoUrl: path, deityVideoUrl: path}); h.show(); assert.equal(h.videos.length, 0); h.handle.cleanup();
  }
});
test('VP9 unsupported and opaque/failed alpha decoding preserve the transparent angel art without a green or black matte', async () => {
  const unsupported = setup({vp9: false}); unsupported.mount(); unsupported.show();
  assert.equal(unsupported.angel.children.length, 1); assert.equal(unsupported.handle.getState().media.length, 1); unsupported.handle.cleanup();
  for (const options of [{alpha: 255}, {alphaError: true}, {nullContext: true}]) {
    const h = setup(options), handle = h.mount(); h.show(); h.data(h.videos[1]); await tick();
    assert.equal(handle.getState().media[1].failed, true); assert.equal(h.videos[1].src, ''); assert.equal(h.videos[1].paused, true);
    assert.equal(h.scene.classList.contains('is-angel-video-ready'), false); assert.ok(h.angel.children.includes(h.angelArt));
    h.data(h.videos[1]); h.show(false); h.show(); h.scene.emit('pointerdown');
    assert.equal(h.canvases.length, 1); assert.equal(h.videos[1].playCalls, 1); handle.cleanup();
  }
});
test('drag progress and ordinary clicks cannot create repeated play promises or repeated pauses', async () => {
  const h = setup(), handle = h.mount(); h.show(); await tick();
  for (let n = 0; n < 100; n++) handle.setInteracting(true);
  assert.equal(h.videos[1].pauseCalls, 1); assert.equal(h.videos[0].playCalls, 1); assert.equal(h.videos[0].pauseCalls, 0);
  assert.equal(h.scene.classList.contains('is-angel-interacting'), true);
  for (let n = 0; n < 100; n++) handle.setInteracting(false);
  await tick(); for (let n = 0; n < 100; n++) {h.scene.emit('pointerdown'); h.show();}
  assert.equal(h.videos[1].playCalls, 2); assert.equal(h.videos[0].playCalls, 1); assert.equal(h.scene.classList.contains('is-angel-interacting'), false); handle.cleanup();
});
test('restored result mode never loads the hidden master angel while the world tree continues playing',async()=>{
 const h=setup(),handle=h.mount({...mediaOptions,resultMode:true});h.show();await tick();
 assert.equal(handle.getState().angelVisible,false);assert.equal(h.videos[0].playCalls,1);assert.equal(h.videos[1].src,'');assert.equal(h.videos[1].playCalls,0);
 for(let n=0;n<30;n++){handle.setInteracting(false);handle.setAngelVisible(false);h.scene.emit('pointerdown');h.show(false);h.show();}
 await tick();assert.equal(h.videos[1].playCalls,0);assert.equal(h.videos[1].sourceWrites,0);
 handle.setAngelVisible(true);await tick();assert.equal(h.videos[1].playCalls,1);assert.equal(h.videos[1].sourceWrites,1);
 handle.setAngelVisible(false);for(let n=0;n<30;n++){handle.setAngelVisible(false);handle.setInteracting(false);h.window.emit('pagehide');h.window.emit('pageshow');}
 await tick();assert.equal(h.videos[1].playCalls,1);assert.equal(h.videos[1].pauseCalls,1);assert.equal(h.videos[1].paused,true);assert.equal(handle.getState().media[0].paused,false);
 handle.cleanup();handle.setAngelVisible(true);assert.equal(h.videos[1].playCalls,1);
});
test('revealing a batch pauses an in-flight master angel, and a late play response cannot restart it',async()=>{
 const calls=[],h=setup({play(video){const call=deferred();calls.push({video,...call});video.paused=false;return call.promise;}}),handle=h.mount();h.show();assert.equal(calls.length,2);
 handle.setAngelVisible(false);assert.equal(h.videos[1].paused,true);handle.setInteracting(false);h.show();calls.forEach(call=>call.resolve());await tick();
 assert.equal(h.videos[1].playCalls,1);assert.equal(h.videos[1].paused,true);assert.equal(h.videos[0].paused,false);assert.equal(handle.getState().media[1].pending,false);
 for(let n=0;n<20;n++){h.scene.emit('pointerdown');h.document.emit('visibilitychange');}assert.equal(h.videos[1].playCalls,1);handle.cleanup();
});
test('initial loading play promises are gated even across repeated observer, visibility and layout calls', async () => {
  const pending = [], h = setup({play(video) {const call = deferred(); pending.push(call); video.paused = false; return call.promise;}}), handle = h.mount();
  h.show(); for (let n = 0; n < 100; n++) {h.show(); h.document.emit('visibilitychange'); handle.setInteracting(false); h.scene.emit('pointerdown');}
  assert.equal(pending.length, 2); assert.ok(handle.getState().media.every(item => item.pending));
  pending.forEach(call => call.resolve()); await tick(); assert.ok(handle.getState().media.every(item => !item.pending));
  assert.ok(h.videos.every(video => video.playCalls === 1)); handle.cleanup();
});
test('hidden, reduced motion and data saver each prevent initial loading and pause without downloading again', async () => {
  for (const condition of ['hidden', 'reduced', 'saveData']) {
    const h = setup({[condition]: true}), handle = h.mount(); h.show(); assert.ok(h.videos.every(video => !video.src));
    const change = value => {
      if (condition === 'hidden') {h.document.hidden = value; h.document.emit('visibilitychange');}
      if (condition === 'reduced') {h.reduced.matches = value; h.reduced.emit('change');}
      if (condition === 'saveData') {h.connection.saveData = value; h.connection.emit('change');}
    };
    change(false); await tick(); assert.ok(h.videos.every(video => video.sourceWrites === 1 && video.playCalls === 1));
    change(true); for (let n = 0; n < 20; n++) {h.show(); handle.setInteracting(false);} assert.ok(h.videos.every(video => video.paused && video.pauseCalls === 1));
    change(false); await tick(); assert.ok(h.videos.every(video => video.sourceWrites === 1 && video.playCalls === 2)); handle.cleanup();
  }
});
test('offscreen and pagehide suspend playback and restore without another source assignment', async () => {
  const h = setup(), handle = h.mount(); h.show(); await tick(); h.show(false); h.show(false);
  assert.ok(h.videos.every(video => video.paused && video.pauseCalls === 1));
  h.show(); await tick(); h.window.emit('pagehide'); h.window.emit('pagehide');
  assert.ok(h.videos.every(video => video.paused && video.pauseCalls === 2));
  h.window.emit('pageshow'); await tick(); assert.ok(h.videos.every(video => video.playCalls === 3 && video.sourceWrites === 1)); handle.cleanup();
});
test('pausing an in-flight play then resuming retries once after its AbortError, without a promise loop', async () => {
  const calls = [], h = setup({play(video) {const call = deferred(); calls.push({video, ...call}); video.paused = false; return call.promise;}}), handle = h.mount();
  h.show(); h.document.hidden = true; h.document.emit('visibilitychange'); h.document.hidden = false; h.document.emit('visibilitychange');
  assert.equal(calls.length, 2); calls.slice(0, 2).forEach(call => call.reject(Error('AbortError'))); await tick();
  assert.equal(calls.length, 4); calls.slice(2).forEach(call => call.resolve()); await tick();
  assert.ok(handle.getState().media.every(item => !item.pending && !item.blocked));
  h.show(); assert.equal(calls.length, 4); handle.cleanup();
});
test('autoplay rejection retains the posters and only a real interaction retries the blocked play', async () => {
  let blocked = true;
  const h = setup({play(video) {if (blocked) return Promise.reject(Error('NotAllowedError')); video.paused = false; return Promise.resolve();}}), handle = h.mount();
  h.show(); h.videos.forEach(h.data); await tick();
  assert.ok(handle.getState().media.every(item => item.blocked && !item.ready));
  for (let n = 0; n < 100; n++) {h.show(); h.document.emit('visibilitychange'); handle.setInteracting(false);}
  assert.ok(h.videos.every(video => video.playCalls === 1)); blocked = false; h.scene.emit('pointerdown'); await tick();
  assert.ok(h.videos.every(video => video.playCalls === 2)); assert.ok(handle.getState().media.every(item => item.ready && !item.blocked)); handle.cleanup();
});
test('synchronous play failure falls back safely and never leaks a rejected promise', () => {
  const h = setup({play() {throw Error('unavailable');}}), handle = h.mount(); h.show();
  assert.ok(handle.getState().media.every(item => item.blocked && !item.pending && !item.ready));
  h.show(); assert.ok(h.videos.every(video => video.playCalls === 1)); handle.cleanup();
});
test('a media error restores the original art and can never re-enable its failed video', async () => {
  const h = setup(), handle = h.mount(); h.show(); h.videos.forEach(h.data); await tick();
  h.videos.forEach(video => video.emit('error'));
  assert.ok(handle.getState().media.every(item => item.failed && !item.ready)); assert.ok(h.videos.every(video => video.src === '' && video.paused));
  h.videos.forEach(h.data); h.scene.emit('pointerdown'); h.show(); assert.ok(h.videos.every(video => video.playCalls === 1)); handle.cleanup();
});
test('cleanup frees all sources, videos, observers/listeners; late promises and interactions cannot repaint', async () => {
  const pending = [], h = setup({play() {const call = deferred(); pending.push(call); return call.promise;}}), handle = h.mount(); h.show(); h.videos.forEach(h.data);
  handle.setInteracting(true); handle.cleanup(); handle.cleanup();
  assert.equal(handle.getState().disposed, true); assert.equal(h.observers[0].disconnected, true);
  assert.ok(h.videos.every(video => video.src === '' && video.paused && !video.parent && video.listeners.size === 0 && video.loadCalls === 1));
  assert.ok([h.window, h.document, h.reduced, h.connection, h.scene].every(element => element.listeners.size === 0));
  pending.forEach(call => call.resolve()); await tick(); h.show(); handle.setInteracting(true);
  assert.equal(h.scene.classList.contains('is-angel-interacting'), false); assert.equal(h.scene.classList.contains('is-angel-video-ready'), false);
  assert.ok(h.videos.every(video => video.playCalls === 1));
});
test('remount cleans the previous instance and restores cached loop times after metadata, without hidden mounts erasing them', async () => {
  const h = setup(), first = h.mount(); h.show(); h.videos.forEach(h.data); await tick();
  h.videos[0].currentTime = 18.75; h.videos[1].currentTime = 4.5;
  h.mount(); assert.equal(first.getState().disposed, true); assert.equal(h.observers[0].disconnected, true);
  h.handle.cleanup(); // No src was loaded, so its zero currentTime must not erase a previous position.
  h.mount(); h.show(); const current = h.videos.slice(-2);
  current.forEach(video => {video.duration = 10; video.emit('loadedmetadata');});
  assert.equal(current[0].currentTime, 8.75); assert.equal(current[1].currentTime, 4.5);
  h.data(current[0]); assert.equal(current[0].currentTime, 8.75); h.handle.cleanup();
});
test('without IntersectionObserver, viewport checks still avoid offscreen downloads and listeners are removed', async () => {
  const h = setup({observer: false, box: {top: 900, bottom: 1200, left: 0, right: 390}}), handle = h.mount();
  assert.ok(h.videos.every(video => !video.src)); h.setBox({top: 0, bottom: 800, left: 0, right: 390}); h.window.emit('scroll'); await tick();
  assert.ok(h.videos.every(video => video.playCalls === 1)); h.setBox({top: 900, bottom: 1200, left: 0, right: 390}); h.window.emit('resize');
  assert.ok(h.videos.every(video => video.paused)); handle.cleanup(); assert.equal(h.window.listeners.size, 0);
});
test('position cache retains only the eight latest decoded assets', async () => {
  const h = setup();
  for (let n = 0; n < 9; n++) {
    h.mount({treeVideoUrl: `art/guardian-scene-20261014/tree-${n}.mp4`}); h.show(); const video = h.videos.at(-1); h.data(video); await tick(); video.currentTime = n + 1; h.handle.cleanup();
  }
  h.mount({treeVideoUrl: 'art/guardian-scene-20261014/tree-0.mp4'}); h.show(); h.data(h.videos.at(-1)); assert.equal(h.videos.at(-1).currentTime, 0); h.handle.cleanup();
  h.mount({treeVideoUrl: 'art/guardian-scene-20261014/tree-8.mp4'}); h.show(); h.data(h.videos.at(-1)); assert.equal(h.videos.at(-1).currentTime, 9); h.handle.cleanup();
});

test('actual approved scene config preserves portrait/video references through normalization and markup to native media', async () => {
  const h = setup(), context = vm.createContext({window: h.window}); vm.runInContext(read('guardian-worldtree.js'), context);
  const config = h.window.RpgGuardianContract.config(publicConfig());
  assert.equal(config.angelPose, 'portrait'); assert.equal(config.scene.angelPose, 'portrait');
  assert.equal(config.scene.treeVideoUrl, config.treeVideoUrl); assert.equal(config.scene.deityVideoUrl, config.deityVideoUrl);
  const html = h.window.RpgGuardianWorldTree.markup(config);
  for (const match of html.matchAll(/data-guardian-(tree-video|deity-video|angel-pose)="([^"]*)"/g)) {
    h.scene.dataset['guardian' + match[1].split('-').map(word => word[0].toUpperCase() + word.slice(1)).join('')] = match[2];
  }
  h.mount({}); h.show();
  assert.equal(h.videos[0].src, config.treeVideoUrl); assert.equal(h.videos[1].src, config.deityVideoUrl);
  assert.equal(h.scene.dataset.guardianAngelPose, 'portrait'); assert.match(html, /viewBox="0 0 820 1380"/);
  h.videos.forEach(h.data); await tick(); assert.equal(h.handle.getState().media[1].ready, true); h.handle.cleanup();
});
test('scatter reference stays a safe local scene field through normalization and markup, and malformed duration falls back',()=>{
 const window={},context=vm.createContext({window});vm.runInContext(read('guardian-sigil-contract.js'),context);vm.runInContext(read('guardian-worldtree.js'),context);
 const source=publicConfig(),normalized=window.RpgGuardianContract.config({...source,scene:{...source.scene,transitionVideoUrl:'/art/guardian/scatter.webm',transitionDurationMs:1800}});
 assert.equal(normalized.transitionVideoUrl,'/art/guardian/scatter.webm');assert.equal(normalized.scene.transitionVideoUrl,normalized.transitionVideoUrl);assert.equal(normalized.transitionDurationMs,1800);assert.match(window.RpgGuardianWorldTree.markup(normalized),/data-guardian-transition-video="\/art\/guardian\/scatter.webm"/);
 const invalid=window.RpgGuardianContract.config({...source,scene:{...source.scene,transitionVideoUrl:'https://evil.test/scatter.webm',transitionDurationMs:-1}});assert.equal(invalid.transitionVideoUrl,null);assert.equal(invalid.transitionDurationMs,null);assert.doesNotMatch(window.RpgGuardianWorldTree.markup(invalid),/evil.test/);
});
test('native transparent poster matches the portrait SVG dimensions and unsupported pose names retain classic geometry', () => {
  const window = {}, context = vm.createContext({window}); vm.runInContext(read('guardian-sigil-contract.js'), context); vm.runInContext(read('guardian-worldtree.js'), context);
  const config = window.RpgGuardianContract.config(publicConfig()), bytes = fs.readFileSync(new URL('../public' + config.deityArtUrl, import.meta.url));
  const size = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]; assert.deepEqual(size, [820, 1380]);
  const html = window.RpgGuardianWorldTree.markup(config); assert.match(html, new RegExp(`viewBox="0 0 ${size[0]} ${size[1]}"`));
  assert.ok(Math.abs(size[0] / size[1] - 500 / 842) < .001);
  const invalid = window.RpgGuardianContract.config({...publicConfig(), scene: {...publicConfig().scene, angelPose: 'untrusted-pose'}});
  assert.equal(invalid.angelPose, 'classic'); assert.match(window.RpgGuardianWorldTree.markup(invalid), /viewBox="0 0 1000 1500"/);
});
test('portrait hand anchor and drag displacement use the full screen matrix; tree cleanup releases its native media exactly once', () => {
  const window = {}, frames = new Map(), observers = [], interactions = [],angelVisibility=[]; let mediaCleanup = 0, hapticCleanup = 0, serial = 0;
  window.RpgGuardianSceneMedia = {mount: () => ({setInteracting: value => interactions.push(value),setAngelVisible:value=>angelVisibility.push(value), cleanup: () => mediaCleanup++})};
  const Resize = class {constructor(callback) {this.callback = callback; this.disconnected = false; observers.push(this);} observe() {} disconnect() {this.disconnected = true;}};
  const context = vm.createContext({window, ResizeObserver: Resize, requestAnimationFrame: callback => {const id = ++serial; frames.set(id, callback); return id;},
    cancelAnimationFrame: id => frames.delete(id), setTimeout, clearTimeout});
  vm.runInContext(read('guardian-sigil-contract.js'), context); vm.runInContext(read('guardian-worldtree.js'), context);
  const matrix = {a: .6, b: .05, c: -.02, d: .6, e: 150, f: 80}, values = new Map(), anchor = {style: {}}, scene = node(), speech = node();
  scene.dataset.guardianAngelPose = 'portrait'; scene.style = {setProperty: (key, value) => values.set(key, value)};
  scene.getBoundingClientRect = () => ({left: 100, top: 50});
  scene.querySelector = selector => selector === '.guardian-angel-art' ? {getScreenCTM: () => matrix} : selector === '.guardian-feather-anchor' ? anchor : selector === '.guardian-tree-speech' ? speech : null;
  const handle = window.RpgGuardianWorldTree.mount(scene, {haptics: {cleanup: () => hapticCleanup++}});
  [...frames.values()].forEach(callback => callback()); frames.clear();
  assert.equal(parseFloat(anchor.style.left), matrix.a * 273 + matrix.c * 731 + matrix.e - 100);
  assert.equal(parseFloat(anchor.style.top), matrix.b * 273 + matrix.d * 731 + matrix.f - 50);
  assert.equal(parseFloat(values.get('--guardian-wrist-x')), 0); assert.equal(parseFloat(values.get('--guardian-wrist-y')), 0);
  const rotate = (point, pivot, angle) => {const radians = angle * Math.PI / 180, x = point.x - pivot.x, y = point.y - pivot.y; return {x: pivot.x + x * Math.cos(radians) - y * Math.sin(radians), y: pivot.y + x * Math.sin(radians) + y * Math.cos(radians)};};
  const point = rotate(rotate({x: 273, y: 731}, {x: 265, y: 625}, 14), {x: 304, y: 507}, -3), displacement = {x: point.x - 273, y: point.y - 731};
  handle.progress(1);
  assert.ok(Math.abs(parseFloat(values.get('--guardian-wrist-x')) - (matrix.a * displacement.x + matrix.c * displacement.y)) < 1e-9);
  assert.ok(Math.abs(parseFloat(values.get('--guardian-wrist-y')) - (matrix.b * displacement.x + matrix.d * displacement.y)) < 1e-9);
  assert.equal(interactions.at(-1), true);handle.resultMode(true);assert.equal(angelVisibility.at(-1),false);handle.resultMode(false);assert.equal(angelVisibility.at(-1),true);handle.cleanup();handle.resultMode(true);assert.equal(angelVisibility.length,2);handle.cleanup();
  assert.equal(mediaCleanup, 1); assert.equal(hapticCleanup, 1); assert.equal(observers[0].disconnected, true); assert.equal(scene.listeners.size, 0);
});
test('the invitation follows the upper torso, clears the face and ends near the stage centre after resize while arms stay still',()=>{
 const window={},observers=[],interactions=[],values=new Map(),anchor={style:{}},scene=node(),speech=node();let box={left:24,top:80,width:274,height:320};
 const matrix=()=>{const width=box.width*.94,height=box.height*.98,scale=Math.min(width/820,height/1380);return {a:scale,b:0,c:0,d:scale,e:box.left+box.width*.03+(width-820*scale)/2,f:box.top-box.height*.16+(height-1380*scale)/2};};
 window.RpgGuardianSceneMedia={mount:()=>({setInteracting:value=>interactions.push(value),cleanup(){}})};
 const Resize=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}};
 const context=vm.createContext({window,ResizeObserver:Resize,setTimeout,clearTimeout});vm.runInContext(read('guardian-sigil-contract.js'),context);vm.runInContext(read('guardian-worldtree.js'),context);
 const config=window.RpgGuardianContract.config(publicConfig());assert.match(window.RpgGuardianWorldTree.markup(config),/data-guardian-feather-anchor="chest"/);assert.match(window.RpgGuardianWorldTree.markup(config),/漂浮在天使胸前/);
 scene.dataset.guardianAngelPose='portrait';scene.dataset.guardianFeatherAnchor='chest';scene.style={setProperty:(key,value)=>values.set(key,value)};scene.getBoundingClientRect=()=>box;scene.querySelector=selector=>selector==='.guardian-angel-art'?{getScreenCTM:matrix}:selector==='.guardian-feather-anchor'?anchor:selector==='.guardian-tree-speech'?speech:null;
 const handle=window.RpgGuardianWorldTree.mount(scene);
 for(const size of [{width:274,height:320},{width:344,height:500},{width:494,height:700},{width:274,height:640},{width:494,height:280}]){
  box={...box,...size};observers[0].callback();const m=matrix(),chest=window.RpgGuardianWorldTree.chestPoint(true);
  assert.ok(Math.abs(parseFloat(anchor.style.left)-(m.a*chest.x+m.e-box.left))<1e-9);assert.ok(Math.abs(parseFloat(anchor.style.top)-(m.d*chest.y+m.f-box.top))<1e-9);
  const start=parseFloat(anchor.style.top),travel=parseFloat(values.get('--guardian-chest-pull-y'));assert.ok(travel>=64);assert.ok(Math.abs((start+travel)/box.height-.55)<1e-9);assert.equal(handle.pullDistance(),travel);
  // A large chest feather must clear the face in short, tall and wide stages.
  // Its centre stays above the stage midpoint, with room left for the pull.
  const featherHeight=Math.min(208,box.height*.36,Number.parseFloat(values.get('--guardian-feather-fit-height'))),faceBottom=m.d*430+m.f-box.top;
  assert.ok(start/box.height>=.20&&start/box.height<=.32);
  // The original cutout starts with a narrow quill; its broad barbs begin 18%
  // below the top. Check those visible barbs against the authored face.
  assert.ok(start-featherHeight/2+featherHeight*.18>faceBottom);
  for(const p of [0,.5,1]){handle.progress(p);assert.equal(values.get('--guardian-limb-progress'),'0');assert.equal(values.get('--guardian-wrist-x'),'0px');assert.equal(values.get('--guardian-wrist-y'),'0px');assert.equal(values.get('--guardian-feather-detach'),'0');assert.equal(Number(values.get('--guardian-chest-progress')),p);}
  assert.equal(interactions.at(-1),true);
 }
 handle.cleanup();
});
