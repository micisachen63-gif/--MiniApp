import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const urls = {treeVideoUrl: 'art/guardian-scene-20261014/world-tree-loop.mp4', deityVideoUrl: 'art/guardian-scene-20261014/archangel-loop-alpha.webm'};
function events() {
  const listeners = new Map();
  return {listeners, addEventListener(name, callback) {if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback);},
    removeEventListener(name, callback) {listeners.get(name)?.delete(callback); if (!listeners.get(name)?.size) listeners.delete(name);},
    emit(name) {for (const callback of [...listeners.get(name) || []]) callback();}};
}
function fixture() {
  const window = events(), videos = [], calls = [], observers = [], classes = new Set();
  const scene = {...events(), dataset: {}, classList: {toggle: (name, on) => on ? classes.add(name) : classes.delete(name), remove: (...names) => names.forEach(name => classes.delete(name))}};
  const container = () => ({children: [], append(node) {node.parent = this; this.children.push(node);}});
  const tree = container(), body = container();
  scene.querySelector = selector => selector === '.guardian-worldtree-background' ? tree : selector === '.guardian-angel-foreground' ? body : null;
  window.matchMedia = () => ({...events(), matches: false}); window.navigator = {connection: {...events(), saveData: false}};
  const document = {...events(), hidden: false, createElement(tag) {
    if (tag === 'canvas') return {getContext: () => ({drawImage() {}, getImageData: () => ({data: [0, 0, 0, 0]})})};
    const video = {...events(), src: '', paused: true, currentTime: 0, duration: 10, videoWidth: 500, videoHeight: 842, playCalls: 0, pauseCalls: 0,
      setAttribute() {}, removeAttribute(name) {if (name === 'src') video.src = '';}, canPlayType: () => 'probably',
      play() {video.playCalls++; video.paused = false; let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); calls.push({video, resolve, reject}); return promise;},
      pause() {video.pauseCalls++; video.paused = true;}, load() {}, remove() {if (video.parent) video.parent.children = video.parent.children.filter(item => item !== video); video.parent = null;}};
    videos.push(video); return video;
  }};
  class Observer {constructor(callback) {this.callback = callback; observers.push(this);} observe(target) {this.target = target;} disconnect() {this.disconnected = true;} show(visible = true) {this.callback([{target: this.target, isIntersecting: visible}]);}}
  const context = vm.createContext({window, document, IntersectionObserver: Observer});
  vm.runInContext(read('guardian-sigil-contract.js'), context); vm.runInContext(read('guardian-scene-media.js'), context);
  return {window, document, scene, videos, calls, observers, classes, mount: options => window.RpgGuardianSceneMedia.mount(scene, {...urls, ...options}), show: () => observers.at(-1).show()};
}

test('a late rejected master-angel play after results cannot poison the next summon or disturb its playing background', async () => {
  const h = fixture(), handle = h.mount(); h.show();
  assert.equal(h.calls.length, 2); h.videos[1].emit('loadeddata');
  handle.setAngelVisible(false); h.calls[1].reject(Error('AbortError after result transition')); h.calls[0].resolve(); await flush();
  assert.equal(handle.getState().media[1].pending, false); assert.equal(handle.getState().media[1].blocked, false);
  assert.equal(h.videos[1].paused, true); assert.equal(h.videos[0].paused, false);
  for (let n = 0; n < 20; n++) {h.scene.emit('pointerdown'); h.document.emit('visibilitychange'); handle.setAngelVisible(false);}
  assert.equal(h.videos[1].playCalls, 1); assert.equal(h.videos[0].playCalls, 1);
  handle.setInteracting(true); handle.setAngelVisible(true); assert.equal(h.videos[1].playCalls, 1);
  handle.setInteracting(false); assert.equal(h.videos[1].playCalls, 2); h.calls.at(-1).resolve(); await flush();
  assert.equal(handle.getState().media[1].blocked, false); assert.equal(handle.getState().media[1].ready, true);
  assert.equal(h.videos[0].playCalls, 1); handle.cleanup();
});

test('same-scene remount owns all current media; old rejected promises and frame events cannot repaint or restart it', async () => {
  const h = fixture(), previous = h.mount(); h.show();
  const oldVideos = [...h.videos], oldCalls = [...h.calls], oldObserver = h.observers[0];
  const next = h.mount({resultMode: true}); h.show();
  assert.equal(previous.getState().disposed, true); assert.equal(oldObserver.disconnected, true);
  assert.ok(oldVideos.every(video => video.src === '' && video.listeners.size === 0 && !video.parent));
  const currentTree = h.videos[2], currentBody = h.videos[3];
  assert.equal(currentTree.playCalls, 1); assert.equal(currentBody.src, ''); assert.equal(currentBody.playCalls, 0);
  oldCalls.forEach(call => call.reject(Error('superseded play'))); oldVideos.forEach(video => {video.emit('loadeddata'); video.emit('error');});
  previous.setAngelVisible(true); oldObserver.show(); await flush();
  assert.equal(next.getState().angelVisible, false); assert.equal(currentBody.playCalls, 0); assert.equal(h.classes.has('is-angel-video-ready'), false);
  h.calls.at(-1).resolve(); currentTree.emit('loadeddata'); await flush(); assert.equal(h.classes.has('is-tree-video-ready'), true);
  next.setAngelVisible(true); currentBody.emit('loadeddata'); h.calls.at(-1).resolve(); await flush();
  assert.equal(currentBody.playCalls, 1); assert.equal(next.getState().media[1].ready, true);
  assert.ok(oldVideos.every(video => video.playCalls === 1 && video.paused)); next.cleanup();
});
