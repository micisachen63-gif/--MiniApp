import {nativeClipShape} from '../public/scene-native-cast.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { createActorVfxBridge, createActorReleaseResolver } from '../public/skill-vfx-actor-bridge.mjs';

const CONTEXT = { accountId: 'account-1', realmId: 'permanent', characterId: 'hero-1', dispatchId: 'run-1' };
const ROOT = 'http://127.0.0.1:9664';
const ASSET = '/ui-generated-20261030/characters-v1/assets/test-attack.webp';
const META = '/ui-generated-20261030/characters-v1/character-preview-actors/mage.json';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const sha = data => createHash('sha256').update(data).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function makeAnimator() {
  const clips = { attack: {}, idle: {} }, plays = [];
  for (const direction of ['right', 'left', 'up', 'down']) {
    const source = {
      releaseFrame: 2, releaseAnchorPx: [70, 20], mirrorX: direction === 'left', loop: false,
      frames: Array.from({ length: 4 }, (_, n) => ({ url: ASSET, rect: [n * 100, 0, 100, 100], anchor: [50, 90], bodyHeight: 80, durationMs: 100 })),
    };
    clips.attack[direction] = { key: 'attack-' + direction, durations: [100, 100, 100, 100], duration: 400, source };
    clips.idle[direction] = { key: 'idle-' + direction, duration: 500, durations: [500], source: { frames: [] } };
  }
  return {
    ready: true, generation: 1, actor: { id: 'mage' }, clips, plays,
    direction: 'right', activeDirection: 'right', action: 'idle', elapsed: 0,
    face(dx, dy) { this.direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'; return this.direction; },
    play(action, direction, restart = false) {
      if (!this.ready || !this.clips[action]?.[direction]) return false;
      plays.push({ action, direction, restart });
      this.direction = direction;
      if (this.action !== action || this.activeDirection !== direction || restart) this.elapsed = 0;
      this.action = action; this.activeDirection = direction; return true;
    },
    current() { return this.clips[this.action]?.[this.activeDirection]; },
    update(ms) { if (this.ready) this.elapsed += ms; },
    releaseDelay() {
      const clip = this.clips.attack[this.action === 'attack' ? this.activeDirection : this.direction];
      const index = clip.source.releaseFrame ?? clip.source.hitFrame;
      return Number.isInteger(index) ? clip.durations.slice(0, index).reduce((a, b) => a + b, 0) : clip.duration / 2;
    },
    releaseOrigin() {
      const source = this.clips.attack[this.action === 'attack' ? this.activeDirection : this.direction].source;
      const frame = source.frames[source.releaseFrame ?? source.hitFrame], p = source.releaseAnchorPx;
      if (!frame || !p) return null;
      return { x: (p[0] - frame.anchor[0]) / frame.bodyHeight * (!!source.mirrorX !== !!frame.mirrorX ? -1 : 1),
        y: (p[1] - frame.anchor[1]) / frame.bodyHeight };
    },
  };
}
function fixture(extra = {}) {
  let now = 10000, context = { ...CONTEXT }, room = { mapIndex: 0, roomIndex: 0 }, geometryState = 'ready', clears = 0;
  const animator = makeAnimator(), hero = { x: 100, y: 200, scaleX: .4, scaleY: .4, visible: true, active: true };
  const targets = new Map([['0:0:0', { x: 280, y: 200 }], ['0:0:1', { x: 300, y: 190 }]]);
  const calls = [], prepared = [];
  const skills = {
    'atlas:mage_chain': { id: 'atlas:mage_chain', system: 'atlas', baseClass: 'mage', mechanic: 'strike' },
    'atlas:archer_trap': { id: 'atlas:archer_trap', system: 'atlas', baseClass: 'archer', mechanic: 'trap' },
  };
  const player = {
    getSkill: id => skills[id], hasSkill: id => !!skills[id],
    getRecipe: () => ({ durationMs: 1400, phases: [{ id: 'charge', from: 0, to: .22 }, { id: 'release', from: .22, to: .57 }] }),
    async prepare(baseClass) { prepared.push(baseClass); },
    async play(request) {
      if (request.canStart && !request.canStart()) return { accepted: false, reason: 'superseded' };
      calls.push(request); return { accepted: true, instanceId: calls.length };
    },
    clear() { clears++; },
  };
  const document = new EventTarget(); document.hidden = false;
  const bridge = createActorVfxBridge({
    player, animator, hero, getContext: () => context, getRoom: () => room, getActorId: () => animator.actor.id,
    projectPoint: p => ({ ...p }), now: () => now, document, origin: ROOT, crypto: webcrypto,
    resolveGeometry(event, { placement }) {
      if (geometryState === 'pending') return { pending: true };
      if (geometryState === 'missing') return null;
      const points = event.targetIds.map(id => targets.get(id));
      if (points.some(p => !p)) return null;
      return { from: { x: hero.x, y: hero.y }, to: placement ? { x: hero.x, y: hero.y } : { ...points[0] },
        targets: points.map(p => ({ ...p })), direction: placement ? animator.direction : undefined };
    }, ...extra,
  });
  const event = (overrides = {}) => ({
    eventId: 'run-1:combat:10:cast:1', type: 'skill_cast', actorId: 'hero-1', skillId: 'atlas:mage_chain',
    atMs: now, resolvedAtMs: now, scheduledAtMs: now, resolutionMs: 1000, mapIndex: 0, roomIndex: 0,
    targetIds: ['0:0:0'], hits: [{ targetId: '0:0:0', damage: 10, hpBefore: 100, hpAfter: 90, source: 'skill' }], ...overrides,
  });
  const trace = (events = [event()], overrides = {}) => ({
    schemaVersion: 1, source: 'committed-combat', context: { ...context }, revision: 1, committedAtMs: now,
    resolutionMs: 1000, events, limit: 128, dropped: 0, total: events.length, ...overrides,
  });
  return { bridge, animator, hero, player, targets, document, calls, prepared, event, trace,
    setNow(value) { now = value; }, get now() { return now; }, get clears() { return clears; },
    setContext(value) { context = value; }, setRoom(value) { room = value; },
    setGeometry(value) { geometryState = value; },
    async start() { await flush(); bridge.update(); await flush(); },
    async tick(ms) { now += ms; animator.update(ms); bridge.update(); await flush(); },
  };
}

test('casts wait for the real actor marker and start the VFX release phase once', async () => {
  const f = fixture(), pending = f.bridge.ingestTrace(f.trace());
  await f.start();
  assert.equal(f.animator.action, 'attack'); assert.equal(f.calls.length, 0);
  await f.tick(199); assert.equal(f.calls.length, 0);
  await f.tick(4);
  assert.equal((await pending).results[0].accepted, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].startProgress, .22);
  assert.equal(f.calls[0].ageMs, 3); assert.equal(f.calls[0].presentationMode, 'full');
  assert.deepEqual(f.calls[0].from, { x: 130, y: 95 });
  assert.equal(f.bridge.stats().lastRelease.markerMs, 200);
  assert.equal(f.bridge.stats().lastRelease.actorElapsedMs, 203);
  assert.equal(f.bridge.stats().lastRelease.authority, 'source');
  await f.tick(197); assert.equal(f.animator.action, 'idle');
  f.bridge.destroy();
});

test('all four directions retain the same projected body height and mirror the source once', async () => {
  const directions = { right: { x: 280, y: 200 }, left: { x: -80, y: 200 }, up: { x: 100, y: 20 }, down: { x: 100, y: 380 } };
  for (const [direction, target] of Object.entries(directions)) {
    const f = fixture({ projectPoint: p => ({ x: p.x * 2, y: p.y * 2 }) });
    f.targets.set('0:0:0', target);
    const pending = f.bridge.ingestTrace(f.trace()); await f.start(); await f.tick(200);
    assert.equal((await pending).results[0].accepted, true);
    assert.equal(f.calls[0].direction, direction); assert.equal(f.calls[0].bodyHeight, 240);
    assert.equal(f.calls[0].from.x, direction === 'left' ? 140 : 260);
    f.bridge.destroy();
  }
});

test('periodic hits use actual targets and impact presentation without any actor attack', async () => {
  const f = fixture();
  const event = f.event({ type: 'skill_effect', effectKind: 'pet', atMs: 9000, resolvedAtMs: 9000, scheduledAtMs: 9000,
    targetIds: ['0:0:0', '0:0:1'], hits: [{ targetId: '0:0:0', source: 'pet' }, { targetId: '0:0:1', source: 'pet' }] });
  assert.equal((await f.bridge.ingestTrace(f.trace([event]))).results[0].accepted, true);
  assert.equal(f.animator.plays.length, 0); assert.equal(f.calls[0].ageMs, 0);
  assert.equal(f.calls[0].presentationMode, 'impact'); assert.equal(f.calls[0].targets.length, 2);
  assert.equal(f.bridge.stats().acceptedEffects, 1); assert.equal(f.bridge.stats().lastEffect.actorAction, 'idle');
  f.bridge.destroy();
});

test('targetless trap casts place a caster ring and never invent an enemy impact', async () => {
  const f = fixture();
  const pending = f.bridge.ingestTrace(f.trace([f.event({ skillId: 'atlas:archer_trap', targetIds: [], hits: [] })]));
  await f.start(); await f.tick(200);
  assert.equal((await pending).results[0].accepted, true);
  assert.equal(f.calls[0].presentationMode, 'placement');
  assert.deepEqual(f.calls[0].targets, []); assert.deepEqual(f.calls[0].from, { x: 100, y: 200 });
  assert.deepEqual(f.calls[0].to, f.calls[0].from);
  f.bridge.destroy();
});

test('expired, previous-room, unknown-live-skill and missing-target traces do not animate', async () => {
  const f = fixture();
  const events = [
    f.event({ eventId: 'old', atMs: 4000, resolvedAtMs: 4000, scheduledAtMs: 4000 }),
    f.event({ eventId: 'room', roomIndex: 1 }),
    f.event({ eventId: 'native', skillId: 'native:mage:A' }),
    f.event({ eventId: 'absent', targetIds: ['absent'], hits: [{ targetId: 'absent' }] }),
    f.event({ eventId: 'mismatch', targetIds: ['0:0:0'], hits: [{ targetId: '0:0:1' }] }),
  ];
  const result = await f.bridge.ingestTrace(f.trace(events));
  assert.deepEqual(result.results.map(r => r.reason), ['expired', 'room-mismatch', 'unknown-live-skill', 'missing-target-geometry', 'invalid-targets']);
  assert.equal(f.calls.length, 0); assert.equal(f.animator.plays.length, 0);
  f.bridge.destroy();
});

test('a real snapshot target may wait for sprites without changing the committed timestamp', async () => {
  const f = fixture(); f.setGeometry('pending');
  const pending = f.bridge.ingestTrace(f.trace()); await flush();
  assert.equal(f.bridge.stats().pendingGeometry, 1); assert.equal(f.animator.plays.length, 0);
  f.setNow(10400); f.setGeometry('ready'); f.bridge.update(); await f.start(); await f.tick(200);
  assert.equal((await pending).results[0].accepted, true);
  assert.equal(f.calls[0].ageMs, 0); assert.equal(f.bridge.stats().pendingGeometry, 0);
  f.bridge.destroy();
});

test('asset waits expire on the real clock and discard a room that changes during loading', async () => {
  for (const reason of ['expired', 'room-changed']) {
    const f = fixture(); f.setGeometry('pending');
    const pending = f.bridge.ingestTrace(f.trace()); await flush();
    if (reason === 'expired') f.setNow(15001); else f.setRoom({ mapIndex: 0, roomIndex: 1 });
    f.bridge.update();
    assert.equal((await pending).results[0].reason, reason);
    assert.equal(f.calls.length, 0); assert.equal(f.animator.plays.length, 0);
    f.bridge.destroy();
  }
});

test('context and actor generation changes cancel a marker wait', async () => {
  for (const change of ['context', 'actor']) {
    const f = fixture(), pending = f.bridge.ingestTrace(f.trace());
    await f.start();
    if (change === 'context') f.setContext({ ...CONTEXT, characterId: 'hero-2' }); else f.animator.generation++;
    f.bridge.syncContext(); await f.tick(300);
    assert.equal((await pending).results[0].accepted, false); assert.equal(f.calls.length, 0);
    f.bridge.destroy();
  }
});

test('hidden and destroyed scenes cancel pending work and do not restart an actor', async () => {
  for (const mode of ['hidden', 'destroy']) {
    const f = fixture(), pending = f.bridge.ingestTrace(f.trace()); await f.start();
    if (mode === 'hidden') { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); }
    else f.bridge.destroy();
    await f.tick(300); assert.equal((await pending).results[0].accepted, false);
    assert.equal(f.calls.length, 0); f.bridge.destroy();
  }
});

test('casts are bounded by a single actor sequence while later effects do not restart it', async () => {
  const f = fixture();
  const pending = f.bridge.ingestTrace(f.trace([f.event({ eventId: 'one' }), f.event({ eventId: 'two' })]));
  await f.start(); assert.equal(f.animator.plays.filter(p => p.action === 'attack').length, 1);
  await f.tick(200); await f.tick(200);
  assert.equal(f.animator.plays.filter(p => p.action === 'attack').length, 2);
  await f.tick(200);
  assert.equal((await pending).results.filter(r => r.accepted).length, 2);
  assert.equal(f.calls.length, 2);
  f.bridge.destroy();
});

test('replaying an accepted trace after clear never replays the actor or VFX', async () => {
  const f = fixture(), trace = f.trace(), pending = f.bridge.ingestTrace(trace);
  await f.start(); await f.tick(200); await pending;
  const release = f.bridge.stats().lastRelease;
  f.bridge.clear('test-clear');
  assert.equal((await f.bridge.ingestTrace(trace)).results[0].reason, 'duplicate');
  assert.equal(f.calls.length, 1); assert.equal(f.animator.plays.filter(p => p.action === 'attack').length, 1);
  assert.deepEqual(f.bridge.stats().lastRelease, release);
  f.bridge.destroy();
});

test('an externally restarted actor clip cannot release a stale token', async () => {
  const f = fixture(), pending = f.bridge.ingestTrace(f.trace());
  await f.start(); await f.tick(100);
  f.animator.play('attack', 'right', true);
  await f.tick(20);
  assert.equal((await pending).results[0].accepted, false); assert.equal(f.calls.length, 0);
  assert.equal(f.bridge.stats().lastReason, 'actor-interrupted');
  f.bridge.destroy();
});

async function profileFixture() {
  const animator = makeAnimator(), source = animator.clips.attack.right.source;
  delete source.releaseFrame; delete source.releaseAnchorPx;
  const metadata = Buffer.from(JSON.stringify({ id: 'mage', clips: { attack: { right: source } } }));
  const asset = Buffer.from('A byte-exact local fixture for profile hash validation.');
  const frame = source.frames[1];
  const profile = {
    actorId: 'mage', direction: 'right', action: 'attack', status: 'visually-reviewed',
    sourceMetadataUrl: META, sourceMetadataSha256: sha(metadata),
    source: { url: ASSET, sha256: sha(asset), width: 400, height: 100 },
    frameCount: 4, frameDurationsMs: [100, 100, 100, 100], clipMirrorX: false,
    releaseFrame: 1, releaseAtMs: 100, releaseAnchorPx: [70, 20],
    frame: { rect: [...frame.rect], anchor: [...frame.anchor], bodyHeight: frame.bodyHeight, mirrorX: false },
    fills: { marker: true, anchor: true },
  };
  let fetches = 0, badAsset = false, badMetadata = false;
  const resolver = createActorReleaseResolver({
    profiles: { schemaVersion: 1, profiles: [profile] }, origin: ROOT, crypto: webcrypto,
    async fetch(url) {
      fetches++;
      const original = url === ROOT + META ? metadata : asset;
      const data = (url === ROOT + META ? badMetadata : badAsset) ? Buffer.from('changed bytes') : original;
      return { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    },
  });
  return { animator, source, profile, resolver, get fetches() { return fetches; },
    badAsset() { badAsset = true; }, badMetadata() { badMetadata = true; } };
}

test('native markers and origins win without fetching any fallback', async () => {
  const animator = makeAnimator(); let fetches = 0;
  const resolver = createActorReleaseResolver({ profiles: { schemaVersion: 99 }, fetch() { fetches++; throw Error('unexpected'); } });
  const result = await resolver.resolve({ animator, actorId: 'mage', direction: 'right' });
  assert.equal(result.authority, 'source'); assert.equal(result.delayMs, 200); assert.equal(fetches, 0);
});

test('a missing authored marker is never replaced by duration/2', async () => {
  const f = await profileFixture();
  const resolver = createActorReleaseResolver({ profiles: { schemaVersion: 1, profiles: [] } });
  await assert.rejects(resolver.resolve({ animator: f.animator, actorId: 'mage', direction: 'right' }), { code: 'missing-release-marker' });
});

test('reviewed fallback requires matching metadata, image bytes and current frame geometry without mutation', async () => {
  const f = await profileFixture(), before = JSON.stringify(f.source);
  const result = await f.resolver.resolve({ animator: f.animator, actorId: 'mage', direction: 'right' });
  assert.equal(result.delayMs, 100); assert.equal(result.authority, 'vfx-visual-review');
  assert.deepEqual(result.origin, { x: .25, y: -.875 }); assert.equal(f.fetches, 2);
  assert.equal(JSON.stringify(f.source), before);
  await f.resolver.resolve({ animator: f.animator, actorId: 'mage', direction: 'right' }); assert.equal(f.fetches, 2);
  f.animator.generation++;
  await f.resolver.resolve({ animator: f.animator, actorId: 'mage', direction: 'right' }); assert.equal(f.fetches, 4);
});

test('stale asset or metadata SHA rejects the fallback', async () => {
  for (const kind of ['badAsset', 'badMetadata']) {
    const f = await profileFixture(); f[kind]();
    await assert.rejects(f.resolver.resolve({ animator: f.animator, actorId: 'mage', direction: 'right' }), { code: 'stale-release-profile' });
  }
});

test('source frame changes and a conflicting native marker reject stale supplemental points', async () => {
  for (const change of ['frame', 'marker']) {
    const f = await profileFixture();
    if (change === 'frame') f.source.frames[1].anchor[0]++;
    else f.source.releaseFrame = 2;
    await assert.rejects(f.resolver.resolve({ animator: f.animator, actorId: 'mage', direction: 'right' }), { code: 'stale-release-profile' });
    assert.equal(f.fetches, 0);
  }
});

test('cross-origin profile asset URLs are never fetched', async () => {
  const f = await profileFixture(); f.profile.source.url = 'https://example.test/asset.webp';
  await assert.rejects(f.resolver.resolve({ animator: f.animator, actorId: 'mage', direction: 'right' }), { code: 'profile-source-url' });
  assert.equal(f.fetches, 0);
});

// Ritual effects use their own measured body origin; legacy weapon anchors stay strict.
test('committed awakenings render from the real caster body without rewriting incomplete native weapon anchors',async()=>{
 const f=fixture(),old=f.player.getSkill;
 f.player.getSkill=id=>id==='awakening:mage:elite'?{id,system:'awakening',baseClass:'mage',origin:'body'}:old(id);
 f.player.hasSkill=id=>!!f.player.getSkill(id);
 for(const clip of Object.values(f.animator.clips.attack))delete clip.source.releaseAnchorPx;
 const result=await f.bridge.ingestTrace(f.trace([f.event({skillId:'awakening:mage:elite'})]));
 assert.equal(result.results[0].accepted,true);assert.equal(f.calls[0].skillId,'awakening:mage:elite');assert.equal(f.animator.plays.length,0);assert.ok(f.calls[0].from.y<f.hero.y);f.bridge.destroy();
});

function nativeFixture(marker=false){
 const policies={schemaVersion:1,profiles:[]},files=new Map();
 const f=fixture({profiles:{schemaVersion:1,profiles:[]},nativePresentationsUrl:'/scene-native-cast-profiles.json',nativePresentations:policies,fetch:async input=>{const data=files.get(new URL(input).pathname);return data?new Response(data):new Response('',{status:404});}});
 const source=f.animator.clips.attack.right.source;delete source.releaseAnchorPx;if(!marker)delete source.releaseFrame;
 const metadata=Buffer.from(JSON.stringify({id:'mage',clips:{attack:{right:source}}})),image=Buffer.from('original native source');files.set(META,metadata);files.set(ASSET,image);
 policies.profiles.push({actorId:'mage',direction:'right',status:'integration-choreography',strategy:'native-cast-and-target',sourcePixelsModified:false,metadataUrl:META,metadataSha256:sha(metadata),clip:nativeClipShape(source),sources:[{url:ASSET,sha256:sha(image)}]});
 f.player.getRecipe=()=>({durationMs:1400,phases:[{id:'release',from:.22,to:.57},{id:'impact',from:.57,to:.8}]});
 return f;
}
async function nativeStart(f){for(let i=0;i<100&&f.animator.action!=='attack';i++){await new Promise(resolve=>setImmediate(resolve));f.bridge.update();}assert.equal(f.animator.action,'attack');}
test('a source-bound native cast plays its actor and the real target impact with no invented projectile',async()=>{
 const f=nativeFixture(),pending=f.bridge.ingestTrace(f.trace());await nativeStart(f);await f.tick(227);assert.equal(f.calls.length,0);await f.tick(2);
 assert.equal((await pending).results[0].accepted,true);assert.equal(f.calls[0].presentationMode,'impact');assert.equal(f.calls[0].startProgress,0);assert.deepEqual(f.calls[0].from,f.targets.get('0:0:0'));assert.deepEqual(f.calls[0].to,f.calls[0].from);assert.equal(f.bridge.stats().lastRelease.timingAuthority,'skill-recipe-impact');f.bridge.destroy();
});
test('native target choreography retains the original hit marker when no weapon point exists',async()=>{
 const f=nativeFixture(true),pending=f.bridge.ingestTrace(f.trace());await nativeStart(f);await f.tick(200);assert.equal((await pending).results[0].accepted,true);assert.equal(f.calls[0].presentationMode,'impact');assert.equal(f.bridge.stats().lastRelease.markerMs,200);f.bridge.destroy();
});
test('native casts remain cancelled when the target or room disappears before impact',async()=>{
 for(const change of ['target','room']){const f=nativeFixture(),pending=f.bridge.ingestTrace(f.trace());await nativeStart(f);if(change==='target')f.targets.clear();else f.setRoom({mapIndex:0,roomIndex:1});await f.tick(250);assert.equal((await pending).results[0].accepted,false);assert.equal(f.calls.length,0);f.bridge.destroy();}
});
