/* Presentation-only bridge for future committed combat events.
 * This module is intentionally not subscribed to the current scene summaries.
 * Player.clear() must invalidate in-flight asset loads; canStart is also checked
 * by the VFX player immediately before creating an animation instance.
 */
const CONTEXT_KEYS = Object.freeze(['accountId', 'realmId', 'characterId', 'dispatchId']);
const DIRECTIONS = new Set(['right', 'left', 'up', 'down']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

function copyContext(value) {
  if (value === null || value === undefined) return null;
  if (!object(value) || !CONTEXT_KEYS.every(key => identifier(value[key]))) {
    throw new TypeError('VFX context requires accountId, realmId, characterId, and dispatchId strings.');
  }
  return Object.freeze(Object.fromEntries(CONTEXT_KEYS.map(key => [key, value[key]])));
}
function sameContext(a, b) {
  return !!a && object(b) && CONTEXT_KEYS.every(key => a[key] === b[key]);
}
function seedFor(id) {
  let result = 2166136261;
  for (let index = 0; index < id.length; index++) result = Math.imul(result ^ id.charCodeAt(index), 16777619);
  return result >>> 0;
}
function boundedOption(name, value, min, max, integer = false) {
  if (!finite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError('Invalid VFX adapter option: ' + name);
  }
  return value;
}

/**
 * onCast(event, {signal, isCurrent, context}) may await an explicitly authored
 * character release marker and return {from, to, targets, direction, bodyHeight}.
 * It does not infer a release time, damage, cooldown, hit count, or outcome.
 * skillIds/isKnownSkill are optional; player.hasSkill is used when available.
 */
export function createCombatVfxAdapter(player, options = {}) {
  if (!player || typeof player.play !== 'function' || typeof player.clear !== 'function') {
    throw new TypeError('A VFX player with play() and clear() is required.');
  }
  const maxAgeMs = boundedOption('maxAgeMs', options.maxAgeMs ?? 5000, 0, 60000);
  const maxFutureMs = boundedOption('maxFutureMs', options.maxFutureMs ?? 250, 0, 10000);
  const maxEvents = boundedOption('maxEvents', options.maxEvents ?? 1024, 1, 8192, true);
  const maxTargets = boundedOption('maxTargets', options.maxTargets ?? 32, 0, 128, true);
  const maxCoordinate = boundedOption('maxCoordinate', options.maxCoordinate ?? 1000000, 1, 10000000);
  const defaultBodyHeight = boundedOption('bodyHeight', options.bodyHeight ?? 128, 1, 4096);
  const clock = options.now ?? Date.now;
  if (typeof clock !== 'function') throw new TypeError('now must be a function.');
  if (options.onCast !== undefined && typeof options.onCast !== 'function') throw new TypeError('onCast must be a function.');
  if (options.isKnownSkill !== undefined && typeof options.isKnownSkill !== 'function') throw new TypeError('isKnownSkill must be a function.');
  const explicitSkills = options.skillIds === undefined ? null : new Set(options.skillIds);
  if (explicitSkills && [...explicitSkills].some(id => !identifier(id))) throw new TypeError('skillIds must contain skill ID strings.');
  let context = copyContext(options.context), generation = 0, destroyed = false, acceptedRevision = -1;
  let controller = new AbortController();
  const seen = new Map();
  const counts = { received: 0, accepted: 0, rejected: 0, byReason: Object.create(null) };

  function reject(reason) {
    counts.rejected++;
    counts.byReason[reason] = (counts.byReason[reason] || 0) + 1;
    return { accepted: false, reason };
  }
  function point(value) {
    return object(value) && finite(value.x) && finite(value.y)
      && Math.abs(value.x) <= maxCoordinate && Math.abs(value.y) <= maxCoordinate;
  }
  function presentation(value) {
    if (!point(value.from) || !point(value.to)) return null;
    const targets = value.targets ?? [];
    if (!Array.isArray(targets) || targets.length > maxTargets || !targets.every(point)) return null;
    const dx = value.to.x - value.from.x, dy = value.to.y - value.from.y;
    const direction = value.direction ?? (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy ? (dy < 0 ? 'up' : 'down') : 'right');
    const bodyHeight = value.bodyHeight ?? defaultBodyHeight;
    if (!DIRECTIONS.has(direction) || !finite(bodyHeight) || bodyHeight <= 0 || bodyHeight > 4096) return null;
    return {
      from: { x: value.from.x, y: value.from.y },
      to: { x: value.to.x, y: value.to.y },
      targets: targets.map(value => ({ x: value.x, y: value.y })),
      direction, bodyHeight,
    };
  }
  function clockValue() {
    const value = clock();
    return finite(value) ? value : null;
  }
  function temporalReason(event, now) {
    if (now === null) return 'invalid-clock';
    if (event.atMs - now > maxFutureMs) return 'future-event';
    if (now - event.atMs > maxAgeMs) return 'expired';
    return null;
  }
  function highRevision() {
    let highest = acceptedRevision;
    for (const entry of seen.values()) if (entry.status === 'pending') highest = Math.max(highest, entry.revision);
    return highest;
  }
  function prune(now) {
    for (const [id, entry] of seen) {
      if (now - entry.atMs > maxAgeMs) { entry.expired = true; seen.delete(id); }
    }
  }
  function currentReason(entry, checkRevision = true) {
    if (destroyed) return 'destroyed';
    if (entry.expired) return 'expired';
    if (entry.generation !== generation || entry.signal.aborted || !sameContext(context, entry.event.context)) return 'context-changed';
    const timeReason = temporalReason(entry.event, clockValue());
    if (timeReason) return timeReason;
    if (checkRevision && entry.revision < highRevision()) return 'stale-revision';
    return null;
  }
  function forget(entry) {
    if (seen.get(entry.event.eventId) === entry) seen.delete(entry.event.eventId);
  }
  function known(skillId) {
    if (explicitSkills && !explicitSkills.has(skillId)) return false;
    if (options.isKnownSkill && !options.isKnownSkill(skillId)) return false;
    if (typeof player.hasSkill === 'function' && !player.hasSkill(skillId)) return false;
    return true;
  }
  async function ingest(raw) {
    counts.received++;
    if (destroyed) return reject('destroyed');
    if (!context) return reject('no-context');
    if (!object(raw) || raw.schemaVersion !== 1 || raw.source !== 'committed-combat' || raw.type !== 'skill_cast') return reject('unsupported-event');
    if (!identifier(raw.eventId) || !identifier(raw.skillId) || !Number.isSafeInteger(raw.revision) || raw.revision < 0
      || !Number.isSafeInteger(raw.atMs) || raw.atMs < 0) return reject('invalid-event');
    if (!sameContext(context, raw.context)) return reject('context-mismatch');
    const render = presentation(raw);
    if (!render || (raw.seed !== undefined && !Number.isSafeInteger(raw.seed))) return reject('invalid-geometry');
    const now = clockValue(), timeReason = temporalReason(raw, now);
    if (timeReason) return reject(timeReason);
    prune(now);
    if (seen.has(raw.eventId)) return reject('duplicate');
    try { if (!known(raw.skillId)) return reject('unknown-skill'); }
    catch (_) { return reject('skill-check-failed'); }
    if (raw.revision < highRevision()) return reject('stale-revision');
    // Never evict a recent ID to make room: that would permit its replay.
    if (seen.size >= maxEvents) return reject('replay-window-full');
    const event = Object.freeze({
      schemaVersion: 1, source: 'committed-combat', type: 'skill_cast',
      eventId: raw.eventId, skillId: raw.skillId, revision: raw.revision, atMs: raw.atMs,
      context: copyContext(raw.context), ...render, seed: raw.seed ?? seedFor(raw.eventId),
    });
    const entry = { event, revision: event.revision, atMs: event.atMs, generation, signal: controller.signal, status: 'pending' };
    seen.set(event.eventId, entry);
    let actual = render;
    try {
      if (options.onCast) {
        // A hook sees its own coordinate copies and cannot mutate validated data.
        const hookEvent = { ...event, context: { ...event.context }, ...presentation(render) };
        const overrides = await options.onCast(hookEvent, {
          context: { ...event.context }, signal: entry.signal,
          isCurrent: () => !currentReason(entry),
        });
        const stale = currentReason(entry);
        if (stale) { forget(entry); return reject(stale); }
        if (overrides === false) { forget(entry); return reject('cast-cancelled'); }
        if (overrides !== null && overrides !== undefined) {
          if (!object(overrides)) { forget(entry); return reject('invalid-cast-geometry'); }
          const allowed = {};
          for (const key of ['from', 'to', 'targets', 'direction', 'bodyHeight']) {
            if (Object.hasOwn(overrides, key)) allowed[key] = overrides[key];
          }
          actual = presentation({ ...render, ...allowed });
          if (!actual) { forget(entry); return reject('invalid-cast-geometry'); }
        }
      }
      const stale = currentReason(entry);
      if (stale) { forget(entry); return reject(stale); }
      const result = await player.play({
        skillId: event.skillId, ...actual, seed: event.seed,
        ageMs: Math.max(0, clockValue() - event.atMs),
        canStart: () => !currentReason(entry),
      });
      const after = currentReason(entry, result?.accepted !== true);
      if (after) { forget(entry); return reject(after); }
      if (!result || result.accepted !== true) {
        forget(entry);
        return reject(result?.reason || 'player-rejected');
      }
      entry.status = 'accepted';
      acceptedRevision = Math.max(acceptedRevision, event.revision);
      counts.accepted++;
      return { accepted: true, eventId: event.eventId, instanceId: result.instanceId };
    } catch (_) {
      const reason = currentReason(entry) || 'render-failed';
      forget(entry);
      return reject(reason);
    }
  }
  function invalidate({ preserveAccepted = false } = {}) {
    generation++;
    controller.abort();
    controller = new AbortController();
    if (preserveAccepted) {
      for (const [id, entry] of seen) if (entry.status === 'pending') seen.delete(id);
    } else {
      seen.clear(); acceptedRevision = -1;
    }
    player.clear();
  }
  function setContext(next) {
    if (destroyed) return false;
    const candidate = copyContext(next);
    if ((candidate === null && context === null) || sameContext(context, candidate)) return false;
    invalidate();
    context = candidate;
    return true;
  }
  return Object.freeze({
    ingest, setContext,
    clear() { if (!destroyed) invalidate({ preserveAccepted: true }); },
    destroy() {
      if (destroyed) return;
      invalidate(); context = null; destroyed = true;
    },
    stats() {
      return {
        ...counts, byReason: { ...counts.byReason }, generation, destroyed,
        context: context ? { ...context } : null, revision: acceptedRevision,
        remembered: seen.size, pending: [...seen.values()].filter(entry => entry.status === 'pending').length,
      };
    },
  });
}
