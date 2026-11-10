import { GameError } from '../game/classes.js';
import { hasReachedIdleMap, idleMapView, resolveIdleMap, writeIdleMapPref } from '../game/idle-map.js';

export function setIdleMap(work, _ctx, body = {}) {
  const follow = body.follow !== false && body.follow !== 'false';
  if (follow) {
    writeIdleMapPref(work.char, { follow: true, mapId: null });
  } else {
    const mapId = Number(body.mapId);
    if (!hasReachedIdleMap(work.char.level, mapId)) throw new GameError('idle_map', '尚未到達這張地圖', 409);
    writeIdleMapPref(work.char, { follow: false, mapId });
  }
  const resolved = resolveIdleMap(work.char.level, { follow: follow, mapId: follow ? null : Number(body.mapId) });
  work.char.map_id = resolved.mapId;
  return { result: idleMapView(work.char) };
}

export function viewIdleMap(char) {
  return idleMapView(char);
}
