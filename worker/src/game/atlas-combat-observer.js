/**
 * Bounded, ephemeral observations of already resolved Atlas combat.
 *
 * This module never reads a clock, draws randomness, mutates a run, or decides
 * targets/damage. Its records become public only after the service commits the
 * corresponding state. Delayed effects keep the owning hero ID because saved
 * Atlas pets/traps have no independent actor IDs or persistent cast IDs.
 */
export const ATLAS_COMBAT_TRACE_LIMIT = 128;
export const ATLAS_COMBAT_TRACE_MAX_LIMIT = 256;
export const ATLAS_COMBAT_RESOLUTION_MS = 1000;

const EFFECT_KINDS = new Set(['dot', 'pet', 'trap', 'counter']);
const milliseconds = seconds => Math.round(seconds * 1000);

function traceLimit(options) {
  const value = options && typeof options === 'object' ? options.limit : undefined;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(ATLAS_COMBAT_TRACE_MAX_LIMIT, Math.floor(value)))
    : ATLAS_COMBAT_TRACE_LIMIT;
}

export function createAtlasCombatObserver(run, options = {}) {
  const limit = traceLimit(options);
  const runId = String(run.runId), actorId = String(run.snapshot.characterId);
  const skillId = 'atlas:' + run.buildId, startedAt = run.startedAt;
  const events = [];
  let currentTick = null, ordinals = Object.create(null), total = 0, dropped = 0;

  function begin(state, type, scheduledAt, effectKind, mpSpent) {
    if (currentTick !== state.elapsedSeconds) {
      currentTick = state.elapsedSeconds;
      ordinals = Object.create(null);
    }
    const phase = type === 'skill_cast' ? 'cast' : effectKind;
    const ordinal = (ordinals[phase] || 0) + 1;
    ordinals[phase] = ordinal;
    const resolvedAtMs = milliseconds(startedAt + state.elapsedSeconds);
    const record = {
      eventId: runId + ':combat:' + state.elapsedSeconds + ':' + phase + ':' + ordinal,
      type, actorId, skillId,
      atMs: resolvedAtMs, resolvedAtMs,
      scheduledAtMs: milliseconds(startedAt + scheduledAt),
      resolutionMs: ATLAS_COMBAT_RESOLUTION_MS,
      mapIndex: state.mapIndex, roomIndex: state.roomIndex,
      targetIds: [], hits: [],
    };
    if (effectKind) record.effectKind = effectKind;
    if (type === 'skill_cast') {
      record.mpBefore = state.hero.mp;
      // Cost is supplied by the resolved cast, including native free-cast rolls.
      record.mpSpent = mpSpent ?? state.skill.cost;
    }
    let finished = false;
    return {
      hit(enemy, outcome) {
        if (finished) return;
        const targetId = String(enemy.id);
        if (!record.targetIds.includes(targetId)) record.targetIds.push(targetId);
        record.hits.push({
          targetId, damage: outcome.damage, critical: outcome.critical,
          hpBefore: outcome.hpBefore, hpAfter: outcome.hpAfter, source: outcome.source,
        });
      },
      finish(state) {
        if (finished) return;
        finished = true;
        // A cast can place a trap without selecting an enemy. An effect record
        // represents actual damage, not a speculative trigger with no targets.
        if (type === 'skill_effect' && record.hits.length === 0) return;
        if (type === 'skill_cast') record.mpAfter = state.hero.mp;
        total++;
        events.push(record);
        if (events.length > limit) { events.shift(); dropped++; }
      },
    };
  }

  return {
    beginCast(state, scheduledAt, mpSpent = state.skill.cost) {
      return begin(state, 'skill_cast', scheduledAt, undefined, mpSpent);
    },
    beginEffect(state, effectKind, scheduledAt) {
      if (!EFFECT_KINDS.has(effectKind)) return null;
      return begin(state, 'skill_effect', scheduledAt, effectKind);
    },
    snapshot() {
      return { events: events.slice(), limit, dropped, total };
    },
  };
}
