import { MAPS, MONSTER_GOLD, MAX_LEVEL } from './constants.js';
import { mapForLevel } from './formulas.js';
import { modeForLevel, WORLD_MODES } from './endgame.js';
import { ENDGAME_ART } from './endgame-map-art.js';

export const IDLE_MAP_VERSION = 1;

export function currentIdleMapId(level) {
  return mapForLevel(level);
}

export function hasReachedIdleMap(level, mapId) {
  if (!Number.isInteger(mapId) || mapId < 1 || mapId > 12) return false;
  const mode = modeForLevel(level);
  return mode.index > 0 || mapId <= mapForLevel(level);
}

/** Most recent mode in which this map was reached. Current-round maps use the current mode. */
export function idleMapMode(level, mapId) {
  if (!hasReachedIdleMap(level, mapId)) return null;
  const mode = modeForLevel(level);
  return mapId <= mapForLevel(level) ? mode : WORLD_MODES[mode.index - 1];
}

/** Inclusive level cap of this map inside the given round (map 8 ordinary = 80, elite = 200). */
export function idleMapRewardLevel(mode, mapId) {
  return mode.index * 120 + mapId * 10;
}

/** Exp multiplier: gap is within the current round only. Previous-round maps are always 0. */
export function idleExpFactor(level, mapId) {
  const current = mapForLevel(level);
  if (mapId > current) return 0;
  const gap = current - mapId;
  if (gap <= 0) return 1;
  if (gap === 1) return 0.5;
  return 0;
}

export function goldPerKillOnMap(rewardLevel, mapId) {
  const mul = MONSTER_GOLD.mapMul[Math.min(MONSTER_GOLD.mapMul.length - 1, Math.max(0, mapId - 1))];
  return (MONSTER_GOLD.base + MONSTER_GOLD.perLevel * rewardLevel) * mul;
}

export function idleMapCycleId(mode, mapId) {
  return `cycle_${mode.id}_${String(mapId).padStart(2, '0')}`;
}

export function readIdleMapPref(char) {
  try {
    const raw = JSON.parse(char?.special_json || '{}').idleMap;
    if (!raw || raw.v !== IDLE_MAP_VERSION) return { follow: true, mapId: null };
    const follow = raw.follow !== false;
    const mapId = Number.isInteger(raw.mapId) ? raw.mapId : null;
    return { follow, mapId: follow ? null : mapId };
  } catch {
    return { follow: true, mapId: null };
  }
}

export function writeIdleMapPref(char, pref) {
  let extra;
  try { extra = JSON.parse(char.special_json || '{}'); } catch { extra = {}; }
  const follow = pref.follow !== false;
  extra.idleMap = { v: IDLE_MAP_VERSION, follow, mapId: follow ? null : pref.mapId };
  char.special_json = JSON.stringify(extra);
  return extra.idleMap;
}

export function resolveIdleMap(level, pref = { follow: true, mapId: null }) {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const currentMapId = mapForLevel(safeLevel);
  let follow = pref?.follow !== false;
  let mapId = follow ? currentMapId : pref?.mapId;
  let reset = false;
  if (!follow && !hasReachedIdleMap(safeLevel, mapId)) {
    follow = true;
    mapId = currentMapId;
    reset = true;
  }
  if (follow) mapId = currentMapId;
  const mode = idleMapMode(safeLevel, mapId);
  const rewardLevel = idleMapRewardLevel(mode, mapId);
  const cycleId = idleMapCycleId(mode, mapId);
  const themeId = (mapId - 1 + mode.index * 5) % 12 + 1;
  const art = ENDGAME_ART[cycleId];
  const theme = MAPS[themeId] || MAPS[mapId];
  const place = art?.name || theme?.name || `地圖 ${mapId}`;
  const reachedThisRound = mapId <= currentMapId;
  return {
    follow, reset, mapId, currentMapId, reachedThisRound, themeId,
    mode: mode.id, modeName: mode.name, modeIndex: mode.index,
    chapter: mapId, rewardLevel, expFactor: idleExpFactor(safeLevel, mapId),
    goldPerKill: goldPerKillOnMap(rewardLevel, mapId),
    cycleId,
    place,
    name: `${place}-${mode.name}`,
    emoji: theme?.emoji || '',
  };
}

export function resolveIdleMapForChar(char) {
  const resolved = resolveIdleMap(char.level, readIdleMapPref(char));
  if (resolved.reset) writeIdleMapPref(char, { follow: true, mapId: null });
  return resolved;
}

export function idleMapCatalog(level) {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const currentMapId = mapForLevel(safeLevel);
  return Array.from({ length: 12 }, (_, i) => {
    const mapId = i + 1;
    const reached = hasReachedIdleMap(safeLevel, mapId);
    if (!reached) {
      const theme = MAPS[mapId];
      return { mapId, reached: false, locked: true, place: theme?.name || `地圖 ${mapId}`, emoji: theme?.emoji || '', current: mapId === currentMapId };
    }
    const resolved = resolveIdleMap(safeLevel, { follow: false, mapId });
    return { ...resolved, reached: true, locked: false, current: mapId === currentMapId };
  });
}

export function idleMapView(char) {
  const resolved = resolveIdleMapForChar(char);
  return { ...resolved, maps: idleMapCatalog(char.level) };
}
