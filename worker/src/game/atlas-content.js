// Immutable atlas-v4 exploration rules. Saved v1/v2/v3 runs never enter this module.
// All randomness and counters live in the serialized run, never in wall-clock time.
const VERSION = 'atlas-content-v1';
const LOOT_VERSION = 'atlas-loot-v1';
const TAIPEI_OFFSET_SECONDS = 8 * 60 * 60;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); }
  return result >>> 0 || 1;
}
function random(state, stream) {
  const rng = state.content.rng;
  let value = rng[stream];
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  rng[stream] = value >>> 0;
  return rng[stream] / 4294967296;
}
export const hasAtlasContent = state => state.ruleset_version === 'atlas-v4' && state.content?.version === VERSION;

export function initializeAtlasContent(state, sourceSnapshot = {}) {
  if (state.ruleset_version !== 'atlas-v4') return;
  const classPath = sourceSnapshot.classPath ?? sourceSnapshot.class_path ?? '';
  if (typeof classPath !== 'string' || classPath.length > 32 || !/^[A-Za-z0-9_-]*$/.test(classPath)) {
    const error = new Error('出征職業路徑無效'); error.code = 'atlas_invalid_snapshot'; error.status = 400; throw error;
  }
  state.content = {
    version: VERSION, classPath,
    rng: { encounter: hash('special-v4:' + state.seed), equipment: hash('equipment-v4:' + state.seed), scroll: hash('scroll-v4:' + state.seed) },
    encountersThisMap: 0, roomEncounter: null, mapHpDamage: 0,
    survival: { fromElapsed: 0, throughElapsed: 0, seconds: 0 },
  };
  state.totals.equipment = 0;
  state.totals.items = {};
  Object.assign(state.metrics, { encountersSeen: 0, encountersCompleted: 0, safeCompletions: 0, survivalSeconds: 0 });
}
function summary(state, type, details) {
  state.events.push({ at: state.elapsedSeconds, type, ...details });
  if (state.events.length > 24) state.events.shift();
}
function activity(state, activities, kind, quantity, suffix, tag, occurredAt = (state.startedAt + state.elapsedSeconds) * 1000) {
  if (!hasAtlasContent(state) || !activities || !Number.isSafeInteger(quantity) || quantity <= 0) return;
  const row = {
    sourceId: 'atlas:' + state.runId + ':activity:' + kind + ':' + suffix,
    kind, quantity, mapId: state.mapId, buildId: state.buildId, occurredAt,
  };
  if (tag) row.tag = tag;
  activities.push(row);
}

export function selectAtlasEncounter(state) {
  if (!hasAtlasContent(state)) return null;
  state.content.roomEncounter = null;
  const profile = state.map.encounters;
  if (!profile || state.map.kind === 'boss' || state.roomIndex >= state.map.packRooms ||
      state.content.encountersThisMap >= profile.maxPerMap || !profile.pool?.length) return null;
  if (random(state, 'encounter') >= profile.chance) return null;
  const total = profile.pool.reduce((sum, row) => sum + row.weight, 0);
  let roll = random(state, 'encounter') * total;
  const chosen = profile.pool.find(row => (roll -= row.weight) < 0) || profile.pool.at(-1);
  state.content.encountersThisMap++;
  state.metrics.encountersSeen++;
  state.content.roomEncounter = { id: chosen.id, name: chosen.name, completed: false };
  return chosen;
}
export function applyAtlasEncounter(state, encounter) {
  if (!hasAtlasContent(state) || !encounter) return;
  let hpRestored = 0, mpRestored = 0;
  if (encounter.id === 'spring') {
    hpRestored = Math.max(0, Math.min(state.snapshot.maxHp - state.hero.hp, Math.floor(state.snapshot.maxHp * encounter.hpFraction)));
    mpRestored = Math.max(0, Math.min(state.snapshot.maxMp - state.hero.mp, Math.floor(state.snapshot.maxMp * encounter.mpFraction)));
    state.hero.hp += hpRestored;
    state.hero.mp = Math.round((state.hero.mp + mpRestored) * 1000) / 1000;
    state.metrics.hpRestored += hpRestored;
    state.metrics.mpRestored = Math.round((state.metrics.mpRestored + mpRestored) * 1000) / 1000;
  }
  summary(state, 'encounter', { encounterId: encounter.id, name: encounter.name, mapIndex: state.mapIndex, roomIndex: state.roomIndex, hpRestored, mpRestored });
}
export function completeAtlasEncounter(state, activities) {
  if (!hasAtlasContent(state)) return;
  const encounter = state.content.roomEncounter;
  if (!encounter || encounter.completed) return;
  encounter.completed = true;
  state.metrics.encountersCompleted++;
  activity(state, activities, 'encounter', 1, state.mapIndex + ':' + state.roomIndex, encounter.id);
  summary(state, 'encounter_completed', { encounterId: encounter.id, mapIndex: state.mapIndex, roomIndex: state.roomIndex });
}
export function recordAtlasKill(state, activities, enemy) {
  if (!hasAtlasContent(state)) return;
  activity(state, activities, 'kill', 1, enemy.id, enemy.rank);
  if (enemy.rank !== 'normal') activity(state, activities, 'elite', 1, enemy.id, enemy.rank);
}
export function recordAtlasDamage(state, damage) {
  if (hasAtlasContent(state)) state.content.mapHpDamage += damage;
}
export function recordAtlasCompletion(state, activities) {
  if (!hasAtlasContent(state)) return;
  activity(state, activities, 'completion', 1, state.mapIndex);
  if (state.content.mapHpDamage === 0) {
    state.metrics.safeCompletions++;
    activity(state, activities, 'safe_completion', 1, state.mapIndex, 'no_hp_damage');
  }
}
export function resetAtlasMapContent(state) {
  if (!hasAtlasContent(state)) return;
  state.content.encountersThisMap = 0;
  state.content.roomEncounter = null;
  state.content.mapHpDamage = 0;
}

export function applyAtlasContentRewards(state, record, activities) {
  if (!hasAtlasContent(state)) return;
  const loot = state.map.loot;
  const encounter = state.content.roomEncounter;
  const encounterSpec = state.map.encounters?.pool.find(row => row.id === encounter?.id);
  // Extra treasure is earned only when its guarded room is actually cleared.
  if (record.kind === 'room' && encounterSpec) {
    record.gold += Math.floor(record.gold * (encounterSpec.goldBonus || 0));
    if (encounterSpec.shardBonus) record.materials.atlas_shard = (record.materials.atlas_shard || 0) + encounterSpec.shardBonus;
    if (encounterSpec.materialBonus) record.materials[state.map.rewards.material] = (record.materials[state.map.rewards.material] || 0) + encounterSpec.materialBonus;
  }
  record.equipment = [];
  record.items = {};
  if (!loot) return;
  const completion = record.kind === 'completion';
  // No starting allowance: stopping/restarting cannot mint a fresh first-drop budget.
  const equipmentAllowance = Math.min(loot.maxEquipment, Math.floor(state.elapsedSeconds / loot.equipmentEverySeconds));
  const scrollAllowance = Math.min(loot.maxScrolls, Math.floor(state.elapsedSeconds / loot.scrollEverySeconds));
  const extraChance = record.kind === 'room' ? (encounterSpec?.equipmentChanceBonus || 0) : 0;
  const equipmentChance = clamp((completion ? loot.completionEquipmentChance : loot.roomEquipmentChance) + extraChance, 0, 1);
  if (state.totals.equipment < equipmentAllowance && random(state, 'equipment') < equipmentChance) {
    const sequence = ++state.totals.equipment;
    const blueprint = {
      id: 'atlas:' + state.runId + ':equipment:' + sequence,
      seed: Math.floor(random(state, 'equipment') * 4294967296),
      tier: state.map.dropTier, baseClass: state.snapshot.baseClass, classPath: state.content.classPath,
      rarityFloor: state.map.kind === 'boss' || encounter?.id === 'elite_hunt' ? 'advanced' : 'common',
      source: 'atlas', rulesVersion: LOOT_VERSION,
    };
    record.equipment.push(blueprint);
    activity(state, activities, 'loot_equipment', 1, blueprint.id, 'equipment');
    summary(state, 'loot_equipment', { rewardId: record.id, itemId: blueprint.id, tier: blueprint.tier });
  }
  const grantedScrolls = (state.totals.items.scroll_w || 0) + (state.totals.items.scroll_a || 0);
  const scrollChance = completion ? loot.completionScrollChance : loot.roomScrollChance;
  if (grantedScrolls < scrollAllowance && random(state, 'scroll') < scrollChance) {
    const key = random(state, 'scroll') < loot.weaponScrollChance ? 'scroll_w' : 'scroll_a';
    record.items[key] = 1;
    state.totals.items[key] = (state.totals.items[key] || 0) + 1;
    activity(state, activities, 'loot_scroll', 1, record.id, key);
    summary(state, 'loot_scroll', { rewardId: record.id, item: key, quantity: 1 });
  }
}

function flushSurvival(state, activities) {
  const segment = state.content.survival;
  if (!segment.seconds) return;
  // Tick n describes [startedAt+n-1, startedAt+n); credit the last lived second.
  // A segment ending at Taipei midnight therefore still belongs to the previous day.
  activity(state, activities, 'survival', segment.seconds, segment.fromElapsed + ':' + segment.throughElapsed,
    'seconds', (state.startedAt + segment.throughElapsed - 1) * 1000);
  segment.fromElapsed = segment.throughElapsed;
  segment.seconds = 0;
}
export function recordAtlasSurvival(state, activities) {
  if (!hasAtlasContent(state)) return;
  const segment = state.content.survival;
  if (state.hero.hp > 0) {
    segment.seconds++;
    segment.throughElapsed = state.elapsedSeconds;
    state.metrics.survivalSeconds++;
    const end = state.startedAt + state.elapsedSeconds;
    const endDay = Math.floor((end + TAIPEI_OFFSET_SECONDS) / 86400);
    const lastDay = Math.floor((end - 1 + TAIPEI_OFFSET_SECONDS) / 86400);
    if (segment.seconds >= 60 || endDay !== lastDay) flushSurvival(state, activities);
  }
  if (state.status !== 'running') flushSurvival(state, activities);
}
/** Call after the service marks a fully caught-up stop/realm cutoff terminal.
 * Never call this for a still-running maxSteps chunk: partial-minute receipts
 * must not depend on how a client split its settlement requests.
 */
export function finalizeAtlasActivities(state, activities) {
  if (hasAtlasContent(state) && state.status !== 'running') flushSurvival(state, activities);
  return activities;
}
