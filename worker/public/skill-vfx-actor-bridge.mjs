/* Presentation bridge for committed Atlas combat and the existing character Animator.
 * It owns no damage, equipment, rewards, source artwork, or Animator update clock.
 */
import { createCombatVfxAdapter } from './skill-vfx-combat-adapter.mjs';

const CONTEXT_KEYS = ['accountId', 'realmId', 'characterId', 'dispatchId'];
const EFFECT_KINDS = new Set(['dot', 'pet', 'trap', 'counter']);
const DIRECTIONS = new Set(['right', 'left', 'up', 'down']);
const CHARACTER_ROOT = '/ui-generated-20261030/characters-v1/';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const point = value => object(value) && finite(value.x) && finite(value.y);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw Object.assign(new Error(reason), { code: reason }); };
const contextOf = value => object(value) && CONTEXT_KEYS.every(key => id(value[key]))
  ? Object.fromEntries(CONTEXT_KEYS.map(key => [key, value[key]])) : null;
const roomOf = value => object(value) && natural(value.mapIndex) && natural(value.roomIndex)
  ? { mapIndex: value.mapIndex, roomIndex: value.roomIndex } : null;
const directionFor = (dx, dy) => Math.abs(dx) > Math.abs(dy)
  ? (dx < 0 ? 'left' : 'right') : dy ? (dy < 0 ? 'up' : 'down') : 'right';
const validAnchor = value => Array.isArray(value) && value.length === 2 && value.every(finite);
function originFrom(source, index, anchor) {
  const frame = source?.frames?.[index];
  if (!frame || !validAnchor(anchor) || !validAnchor(frame.anchor) || !finite(frame.bodyHeight) || frame.bodyHeight <= 0) return null;
  return {
    x: (anchor[0] - frame.anchor[0]) / frame.bodyHeight * (!!source.mirrorX !== !!frame.mirrorX ? -1 : 1),
    y: (anchor[1] - frame.anchor[1]) / frame.bodyHeight,
  };
}
function markerOf(clip) {
  const source = clip?.source, durations = clip?.durations;
  if (!source || !Array.isArray(durations) || !durations.length || !durations.every(n => finite(n) && n > 0)) return null;
  const duration = durations.reduce((sum, n) => sum + n, 0), index = source.releaseFrame ?? source.hitFrame;
  if (natural(index) && index < durations.length) {
    return { index, delayMs: durations.slice(0, index).reduce((sum, n) => sum + n, 0), duration };
  }
  if (finite(source.releaseAtMs) && source.releaseAtMs >= 0 && source.releaseAtMs <= duration) {
    return { index: null, delayMs: source.releaseAtMs, duration };
  }
  return null; // Deliberately do not use Animator's duration/2 estimate.
}

/** Profiles supplement missing data only after same-origin bytes and geometry match.
 * Source marker/anchor always wins. Nothing is written to animator.clips or artwork.
 */
export function createActorReleaseResolver(options = {}) {
  const fetcher = options.fetch || globalThis.fetch?.bind(globalThis);
  const crypto = options.crypto || globalThis.crypto;
  const origin = options.origin || globalThis.location?.origin;
  const profilesUrl = options.profilesUrl || '/skill-vfx-actor-profiles.json';
  let profilesPromise = null, actorGeneration = '', verified = new Map();
  function urlFor(value, characterOnly = true) {
    if (!id(value) || !origin) fail('profile-source-url');
    let url;
    try { url = new URL(value, origin + '/'); } catch (_) { fail('profile-source-url'); }
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch (_) { fail('profile-source-url'); }
    if (url.origin !== origin || url.username || url.password || decoded.includes('\\') || decoded.includes('\0')
      || decoded.split('/').includes('..') || (characterOnly && !decoded.startsWith(CHARACTER_ROOT))) fail('profile-source-url');
    return url.href;
  }
  async function bytes(url, signal, maxBytes) {
    if (!fetcher) fail('profile-verification-unavailable');
    const response = await fetcher(url, { signal, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) fail('profile-source-unavailable');
    const data = await response.arrayBuffer();
    if (data.byteLength > maxBytes) fail('profile-source-too-large');
    return data;
  }
  async function digest(data) {
    if (!crypto?.subtle) fail('profile-verification-unavailable');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  async function profiles(signal) {
    if (options.profiles) return options.profiles;
    if (!profilesPromise) {
      profilesPromise = bytes(urlFor(profilesUrl, false), signal, 2 * 1024 * 1024)
        .then(data => JSON.parse(new TextDecoder().decode(data)))
        .catch(error => { profilesPromise = null; throw error; });
    }
    return profilesPromise;
  }
  function geometryMatches(profile, clip, marker) {
    const frames = clip.source.frames, frame = frames?.[profile.releaseFrame];
    if (!natural(profile.releaseFrame) || profile.releaseFrame >= clip.durations.length || !frame
      || profile.frameCount !== frames.length || !same(profile.frameDurationsMs, clip.durations)
      || !!profile.clipMirrorX !== !!clip.source.mirrorX
      || !same(profile.frame?.rect, frame.rect) || !same(profile.frame?.anchor, frame.anchor)
      || profile.frame?.bodyHeight !== frame.bodyHeight || !!profile.frame?.mirrorX !== !!frame.mirrorX
      || urlFor(profile.source?.url) !== urlFor(frame.url)) return false;
    const delay = clip.durations.slice(0, profile.releaseFrame).reduce((sum, n) => sum + n, 0);
    if (!finite(profile.releaseAtMs) || Math.abs(delay - profile.releaseAtMs) > .01) return false;
    if (marker && (marker.index !== null ? marker.index !== profile.releaseFrame : Math.abs(marker.delayMs - delay) > .01)) return false;
    return true;
  }
  async function verify(profile, clip, actorId, direction, marker, signal) {
    if (!geometryMatches(profile, clip, marker)) fail('stale-release-profile');
    if (!/^[a-f0-9]{64}$/.test(profile.sourceMetadataSha256 || '') || !/^[a-f0-9]{64}$/.test(profile.source?.sha256 || '')) fail('invalid-release-profile');
    const metadataUrl = urlFor(profile.sourceMetadataUrl), assetUrl = urlFor(profile.source.url);
    const key = actorId + ':' + direction + ':' + profile.releaseFrame + ':' + metadataUrl + ':' + assetUrl + ':' + profile.sourceMetadataSha256 + ':' + profile.source.sha256;
    let promise = verified.get(key);
    if (!promise) {
      promise = (async () => {
        const [metadataBytes, assetBytes] = await Promise.all([
          bytes(metadataUrl, signal, 8 * 1024 * 1024), bytes(assetUrl, signal, 64 * 1024 * 1024),
        ]);
        const [metadataHash, assetHash] = await Promise.all([digest(metadataBytes), digest(assetBytes)]);
        if (metadataHash !== profile.sourceMetadataSha256 || assetHash !== profile.source.sha256) fail('stale-release-profile');
        const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
        const fetched = metadata.clips?.attack?.[direction];
        if (metadata.id !== actorId || !fetched || !geometryMatches(profile, {
          source: fetched, durations: fetched.frames.map(frame => frame.durationMs || 125),
        }, marker)) fail('stale-release-profile');
        return true;
      })().catch(error => { if (verified.get(key) === promise) verified.delete(key); throw error; });
      verified.set(key, promise);
    }
    await promise;
    if (signal?.aborted) fail('cast-cancelled');
  }
  async function resolve({ animator, actorId, direction, signal, requireOrigin = true }) {
    if (signal?.aborted) fail('cast-cancelled');
    if (!animator?.ready || !id(actorId) || !DIRECTIONS.has(direction)) fail('actor-not-ready');
    const clip = animator.clips?.attack?.[direction];
    if (!clip?.source?.frames?.length) fail('missing-attack-clip');
    const generationKey = actorId + ':' + animator.generation;
    if (generationKey !== actorGeneration) { actorGeneration = generationKey; verified.clear(); }
    const marker = markerOf(clip), nativeOrigin = marker?.index !== null && marker
      ? originFrom(clip.source, marker.index, clip.source.releaseAnchorPx) : null;
    if (marker && (!requireOrigin || nativeOrigin)) {
      return { clip, ...marker, origin: nativeOrigin, nativeMarker: true, nativeOrigin: !!nativeOrigin, authority: 'source' };
    }
    const data = await profiles(signal);
    if (data?.schemaVersion !== 1 || !Array.isArray(data.profiles) || data.profiles.length > 512) fail('invalid-release-profile');
    const matches = data.profiles.filter(p => p.actorId === actorId && p.action === 'attack' && p.direction === direction);
    if (matches.length !== 1) fail(marker ? 'missing-release-origin' : 'missing-release-marker');
    const profile = matches[0];
    if (profile.status !== 'visually-reviewed' || (!marker && profile.fills?.marker !== true)
      || (requireOrigin && !nativeOrigin && profile.fills?.anchor !== true)) fail('invalid-release-profile');
    await verify(profile, clip, actorId, direction, marker, signal);
    const selectedMarker = marker || { index: profile.releaseFrame, delayMs: profile.releaseAtMs, duration: clip.durations.reduce((a, b) => a + b, 0) };
    const selectedOrigin = nativeOrigin || originFrom(clip.source, profile.releaseFrame, profile.releaseAnchorPx);
    if (requireOrigin && !selectedOrigin) fail('invalid-release-profile');
    return {
      clip, ...selectedMarker, origin: selectedOrigin, nativeMarker: !!marker, nativeOrigin: !!nativeOrigin,
      authority: marker ? 'source-marker-reviewed-origin' : 'vfx-visual-review',
    };
  }
  return Object.freeze({ resolve, clear() { verified.clear(); actorGeneration = ''; } });
}

/** One existing Animator, one scene clock. resolveGeometry must resolve every
 * actual target ID in the current room; null means unavailable, never guessed.
 * projectPoint maps world coordinates into the VFX canvas CSS coordinate space.
 * getBodyHeight returns WORLD body height, not the 512px frame's outer bounds.
 */
export function createActorVfxBridge(options = {}) {
  const { player, animator, hero } = options;
  if (!player || !animator || !hero || typeof options.resolveGeometry !== 'function'
    || typeof options.projectPoint !== 'function') throw new TypeError('Actor VFX bridge needs player, Animator, hero, geometry resolver and world projector.');
  const clock = options.now || Date.now;
  const maxAgeMs = options.maxAgeMs ?? 5000, maxFutureMs = options.maxFutureMs ?? 250;
  const maxPending = options.maxPendingCasts ?? 8;
  const getContext = options.getContext || (() => null), getRoom = options.getRoom || (() => null);
  const getActorId = options.getActorId || (() => animator.actor?.id);
  const getBodyHeight = options.getBodyHeight || (() => Math.abs(hero.scaleY) * 300);
  const releaseResolver = options.releaseResolver || createActorReleaseResolver(options);
  const document = options.document || globalThis.document;
  let destroyed = false, epoch = 0, token = 0, active = null, queue = [];
  let context = contextOf(getContext()), room = roomOf(getRoom()), actorGeneration = animator.generation, actorId = getActorId();
  const records = new Map(), geometryWaits = new Map(), counts = { traces: 0, received: 0, accepted: 0, acceptedCasts: 0, acceptedEffects: 0, skipped: 0, byReason: Object.create(null) };
  let lastRelease = null, lastEffect = null, lastReason = null;
  function skipped(reason, eventId) {
    counts.skipped++; counts.byReason[reason] = (counts.byReason[reason] || 0) + 1; lastReason = reason;
    return { accepted: false, reason, ...(eventId ? { eventId } : {}) };
  }
  function note(reason, record) { lastReason = reason; if (record) record.cancelReason = reason; }
  function eligible(record) {
    if (destroyed || record.epoch !== epoch || document?.hidden || !same(contextOf(getContext()), record.context)
      || !same(roomOf(getRoom()), record.room) || animator.generation !== record.actorGeneration || getActorId() !== record.actorId) return false;
    const now = clock();
    return finite(now) && now - record.event.atMs <= maxAgeMs && record.event.atMs - now <= maxFutureMs;
  }
  function body() {
    const world = getBodyHeight(), foot = options.projectPoint({ x: hero.x, y: hero.y });
    if (!finite(world) || world <= 0 || !point(foot)) return null;
    const top = options.projectPoint({ x: hero.x, y: hero.y - world });
    if (!point(top)) return null;
    const screen = Math.hypot(top.x - foot.x, top.y - foot.y);
    return finite(screen) && screen > 0 && screen <= 4096 ? { world, screen, foot } : null;
  }
  function geometry(record) {
    if (!eligible(record)) return null;
    let value, size;
    try {
      value = options.resolveGeometry(record.event, { placement: record.placement });
      if (value?.pending === true) return { pending: true };
      if (!animator.ready || hero.active === false || hero.visible === false) return null;
      size = body();
    } catch (_) { return null; }
    if (!value || !size || !point(value.from) || !point(value.to) || !Array.isArray(value.targets)
      || value.targets.length !== record.event.targetIds.length || !value.targets.every(point)) return null;
    const facing = value.facing && finite(value.facing.dx) && finite(value.facing.dy)
      ? value.facing : { dx: value.to.x - value.from.x, dy: value.to.y - value.from.y };
    const direction = value.direction || (record.placement ? animator.direction || 'down' : directionFor(facing.dx, facing.dy));
    if (!DIRECTIONS.has(direction)) return null;
    return { from: { ...value.from }, to: { ...value.to }, targets: value.targets.map(p => ({ ...p })), direction, bodyHeight: size.screen, facing, size };
  }
  function finish(item, reason, resetIdle = true) {
    if (!item) return;
    item.signal.removeEventListener('abort', item.abort);
    if (!item.released) { item.released = true; item.resolve(false); }
    if (reason) note(reason, item.record);
    if (resetIdle && item.started && animator.ready && animator.generation === item.actorGeneration
      && animator.action === 'attack' && animator.activeDirection === item.direction && animator.current?.() === item.spec.clip) {
      animator.play('idle', item.direction, true);
    }
    if (active === item) active = null;
    queue = queue.filter(value => value !== item);
  }
  function cancelWork(reason) {
    epoch++;
    const items = [...queue, ...(active ? [active] : [])]; queue = [];
    for (const item of new Set(items)) finish(item, reason);
    for (const wait of geometryWaits.values()) wait.resolve({ reason });
    geometryWaits.clear(); records.clear(); releaseResolver.clear?.();
  }
  async function onCast(event, state) {
    const record = records.get(event.eventId);
    if (!record || !eligible(record) || !state.isCurrent()) return false;
    let initial = geometry(record);
    if (!initial || initial.pending) { note('missing-target-geometry', record); return false; }
    const skill=player.getSkill?.(event.skillId);
    // Awakening rituals originate at the measured caster body, independent of
    // a weapon-release anchor. Do not invent anchors in another owner's clips.
    if(skill?.system==='awakening'&&skill.origin==='body'){
      try{await player.prepare?.(skill.baseClass);}catch{note('awakening-art-unavailable',record);return false;}
      if(!eligible(record)||!state.isCurrent())return false;
      const current=geometry(record);if(!current||current.pending)return false;
      const from=options.projectPoint({x:hero.x,y:hero.y-current.size.world*.6});
      if(!point(from))return false;
      return {...current,from,presentation:{startProgress:0,elapsedMs:0,mode:'full'}};
    }
    let spec;
    try {
      spec = await releaseResolver.resolve({ animator, actorId: record.actorId, direction: initial.direction, signal: state.signal, requireOrigin: !record.placement });
      const skill = player.getSkill?.(event.skillId);
      if (typeof player.prepare === 'function') await player.prepare(skill.baseClass);
    } catch (error) { note(error.code || (state.signal.aborted ? 'cast-cancelled' : 'release-profile-unavailable'), record); return false; }
    if (!eligible(record) || !state.isCurrent()) return false;
    const current = geometry(record);
    if (!current || current.pending || current.direction !== initial.direction || animator.clips?.attack?.[initial.direction] !== spec.clip) { note('actor-or-target-changed', record); return false; }
    if (queue.length + (active ? 1 : 0) >= maxPending) { note('cast-queue-full', record); return false; }
    return new Promise(resolve => {
      const item = { token: ++token, record, spec, direction: initial.direction, actorGeneration: record.actorGeneration,
        signal: state.signal, isCurrent: state.isCurrent, resolve, released: false, started: false, lastElapsed: 0 };
      item.abort = () => finish(item, 'cast-cancelled');
      if (state.signal.aborted) { resolve(false); return; }
      state.signal.addEventListener('abort', item.abort, { once: true });
      queue.push(item);
    });
  }
  function onEffect(event, state) {
    const record = records.get(event.eventId);
    if (!record || !eligible(record) || !state.isCurrent()) return false;
    const current = geometry(record);
    if (!current || current.pending) { note('missing-target-geometry', record); return false; }
    lastEffect = { eventId: event.eventId, effectKind: event.effectKind, mode: 'impact', context: { ...record.context }, room: { ...record.room }, targetCount: current.targets.length, actorAction: animator.action };
    return { from: current.from, to: current.to, targets: current.targets, direction: current.direction, bodyHeight: current.bodyHeight,
      presentation: { startProgress: 0, elapsedMs: 0, mode: 'impact' } };
  }
  const adapter = createCombatVfxAdapter(player, {
    context, now: clock, maxAgeMs, maxFutureMs, maxTargets: 32, maxEvents: options.maxEvents ?? 1024,
    isKnownSkill: skillId => (skillId.startsWith('atlas:') && player.getSkill?.(skillId)?.system === 'atlas')||(skillId.startsWith('awakening:')&&player.getSkill?.(skillId)?.system==='awakening'),
    onCast, onEffect,
  });
  function syncContext() {
    if (destroyed) return false;
    const nextContext = contextOf(getContext()), nextRoom = roomOf(getRoom()), nextActor = getActorId(), nextGeneration = animator.generation;
    const changedContext = !same(context, nextContext), changed = changedContext || !same(room, nextRoom) || actorId !== nextActor || actorGeneration !== nextGeneration;
    if (!changed) return false;
    cancelWork(changedContext ? 'context-changed' : !same(room, nextRoom) ? 'room-changed' : 'actor-changed');
    if (changedContext) adapter.setContext(nextContext); else adapter.clear();
    context = nextContext; room = nextRoom; actorId = nextActor; actorGeneration = nextGeneration;
    return true;
  }
  function update() {
    if (destroyed) return;
    syncContext();
    if (document?.hidden) { clear('hidden'); return; }
    for (const [eventId, wait] of geometryWaits) {
      const current = geometry(wait.record);
      if (current?.pending) continue;
      geometryWaits.delete(eventId);
      wait.resolve(current ? { geometry: current } : { reason: clock() - wait.record.event.atMs > maxAgeMs ? 'expired' : 'missing-target-geometry' });
    }
    if (active) {
      const item = active;
      if (!eligible(item.record) || !item.isCurrent()) finish(item, 'cast-superseded');
      else if (!animator.ready || animator.generation !== item.actorGeneration || animator.action !== 'attack'
        || animator.activeDirection !== item.direction || animator.current?.() !== item.spec.clip
        || !finite(animator.elapsed) || animator.elapsed < item.lastElapsed) finish(item, 'actor-interrupted', false);
      else {
        item.lastElapsed = animator.elapsed;
        if (!item.released && animator.elapsed >= item.delayMs) {
          const current = geometry(item.record);
          const origin = item.spec.nativeOrigin ? animator.releaseOrigin?.() : item.spec.origin;
          if (!current || current.pending || (!item.record.placement && !point(origin))) finish(item, 'missing-release-geometry');
          else {
            const from = item.record.placement ? current.size.foot : options.projectPoint({
              x: hero.x + origin.x * current.size.world, y: hero.y + origin.y * current.size.world,
            });
            const recipe = player.getRecipe?.(item.record.event.skillId);
            const startProgress = recipe?.phases?.find(phase => phase.id === 'release')?.from;
            if (!point(from) || !finite(startProgress) || startProgress < 0 || startProgress > 1) finish(item, 'missing-release-phase');
            else {
              item.released = true;
              const elapsedMs = Math.max(0, animator.elapsed - item.delayMs);
              lastRelease = { eventId: item.record.event.eventId, actorId: item.record.actorId, direction: item.direction,
                context: { ...item.record.context }, room: { ...item.record.room },
                markerMs: item.delayMs, actorElapsedMs: animator.elapsed, startProgress, elapsedMs,
                authority: item.spec.authority, from: { ...from }, bodyHeight: current.bodyHeight,
                mode: item.record.placement ? 'placement' : 'full' };
              item.resolve({ from, to: item.record.placement ? { ...from } : current.to,
                targets: item.record.placement ? [] : current.targets, direction: item.direction, bodyHeight: current.bodyHeight,
                presentation: { startProgress, elapsedMs, mode: item.record.placement ? 'placement' : 'full' } });
            }
          }
        }
        if (active === item && animator.elapsed >= item.spec.duration) finish(item, null);
      }
    }
    while (!active && queue.length) {
      const item = queue.shift();
      if (!eligible(item.record) || !item.isCurrent()) { finish(item, 'cast-superseded'); continue; }
      const current = geometry(item.record);
      if (!current || current.pending || current.direction !== item.direction || animator.clips?.attack?.[item.direction] !== item.spec.clip) { finish(item, 'actor-or-target-changed'); continue; }
      if (!item.record.placement) animator.face(current.facing.dx, current.facing.dy);
      if (!animator.play('attack', item.direction, true)) { finish(item, 'missing-attack-clip', false); continue; }
      item.started = true; item.lastElapsed = animator.elapsed; item.delayMs = item.spec.nativeMarker ? animator.releaseDelay() : item.spec.delayMs;
      if (!finite(item.delayMs) || Math.abs(item.delayMs - item.spec.delayMs) > .01) { finish(item, 'release-marker-changed'); continue; }
      active = item;
      break;
    }
  }
  function eventReason(event) {
    if (!object(event) || !id(event.eventId) || !['skill_cast', 'skill_effect'].includes(event.type)
      || !id(event.skillId) || event.actorId !== context?.characterId || !natural(event.atMs)
      || event.resolvedAtMs !== event.atMs || !natural(event.scheduledAtMs) || event.scheduledAtMs > event.atMs
      || !natural(event.mapIndex) || !natural(event.roomIndex)) return 'invalid-combat-event';
    if (!room || event.mapIndex !== room.mapIndex || event.roomIndex !== room.roomIndex) return 'room-mismatch';
    const now = clock();
    if (!finite(now)) return 'invalid-clock';
    if (now - event.atMs > maxAgeMs) return 'expired';
    if (event.atMs - now > maxFutureMs) return 'future-event';
    if (!Array.isArray(event.targetIds) || event.targetIds.length > 32 || !event.targetIds.every(id)
      || new Set(event.targetIds).size !== event.targetIds.length || !Array.isArray(event.hits) || event.hits.length > 128
      || event.hits.some(hit => !object(hit) || !id(hit.targetId))
      || !same([...new Set(event.hits.map(hit => hit.targetId))], event.targetIds)) return 'invalid-targets';
    const skill = player.getSkill?.(event.skillId);
    if (!skill||!((event.skillId.startsWith('atlas:')&&skill.system==='atlas')||(event.skillId.startsWith('awakening:')&&skill.system==='awakening'))) return 'unknown-live-skill';
    if (event.type === 'skill_effect' && (!EFFECT_KINDS.has(event.effectKind) || !event.targetIds.length)) return 'invalid-effect';
    if (!event.targetIds.length && !(event.type === 'skill_cast' && skill.mechanic === 'trap')) return 'missing-targets';
    return null;
  }
  async function ingestEvent(event, trace) {
    counts.received++;
    const reason = eventReason(event);
    if (reason) return skipped(reason, event?.eventId);
    if (records.has(event.eventId)) return skipped('duplicate', event.eventId);
    const record = { event, context: { ...context }, room: { ...room }, epoch, actorId, actorGeneration,
      placement: event.type === 'skill_cast' && !event.targetIds.length && player.getSkill(event.skillId).mechanic === 'trap' };
    let current = geometry(record);
    if (!current) return skipped('missing-target-geometry', event.eventId);
    if (records.size >= 128) return skipped('pending-limit', event.eventId);
    records.set(event.eventId, record);
    try {
      if (current.pending) {
        const ready = await new Promise(resolve => geometryWaits.set(event.eventId, { record, resolve }));
        if (!ready.geometry) return skipped(ready.reason || 'missing-target-geometry', event.eventId);
        current = ready.geometry;
      }
      if (!eligible(record)) return skipped(clock() - event.atMs > maxAgeMs ? 'expired' : 'context-changed', event.eventId);
      const result = await adapter.ingest({
        schemaVersion: 1, source: 'committed-combat', type: event.type, effectKind: event.effectKind,
        eventId: event.eventId, skillId: event.skillId, context: record.context, revision: trace.revision, atMs: event.atMs,
        from: current.from, to: current.to, targets: current.targets, direction: current.direction, bodyHeight: current.bodyHeight,
      });
      if (result.accepted) { counts.accepted++; counts[event.type === 'skill_cast' ? 'acceptedCasts' : 'acceptedEffects']++; return { ...result, type: event.type }; }
      const reason = ['cast-cancelled', 'effect-cancelled'].includes(result.reason) && record.cancelReason ? record.cancelReason : result.reason;
      return skipped(reason, event.eventId);
    } finally { if (records.get(event.eventId) === record) records.delete(event.eventId); }
  }
  async function ingestTrace(trace) {
    counts.traces++;
    if (destroyed) return { accepted: false, reason: 'destroyed', results: [] };
    syncContext();
    if (!context || !room) return { accepted: false, reason: 'no-context', results: [] };
    if (!object(trace) || trace.schemaVersion !== 1 || trace.source !== 'committed-combat'
      || !same(contextOf(trace.context), context) || !natural(trace.revision) || !natural(trace.committedAtMs)
      || trace.resolutionMs !== 1000 || !Array.isArray(trace.events) || trace.events.length > 128
      || !natural(trace.limit) || trace.limit < 1 || trace.limit > 128 || trace.events.length > trace.limit) {
      return { accepted: false, reason: 'invalid-combat-trace', results: [] };
    }
    const results = await Promise.all(trace.events.map(event => ingestEvent(event, trace)));
    return { accepted: results.some(result => result.accepted), results };
  }
  function clear(reason = 'cleared') {
    if (destroyed) return;
    cancelWork(reason); adapter.clear();
  }
  const visibility = () => { if (document?.hidden) clear('hidden'); };
  document?.addEventListener?.('visibilitychange', visibility);
  function destroy() {
    if (destroyed) return;
    cancelWork('destroyed'); adapter.destroy(); destroyed = true;
    document?.removeEventListener?.('visibilitychange', visibility);
  }
  return Object.freeze({
    ingestTrace, update, syncContext, clear, destroy,
    stats() { return { ...counts, byReason: { ...counts.byReason }, epoch, destroyed, context: context ? { ...context } : null,
      room: room ? { ...room } : null, actorId, pendingGeometry: geometryWaits.size, pendingCasts: queue.length + (active && !active.released ? 1 : 0),
      activeCast: active ? { eventId: active.record.event.eventId, direction: active.direction, released: active.released, token: active.token } : null,
      lastReason, lastRelease: lastRelease ? { ...lastRelease, from: { ...lastRelease.from }, context: { ...lastRelease.context }, room: { ...lastRelease.room } } : null,
      lastEffect: lastEffect ? { ...lastEffect, context: { ...lastEffect.context }, room: { ...lastEffect.room } } : null, adapter: adapter.stats() }; },
  });
}
