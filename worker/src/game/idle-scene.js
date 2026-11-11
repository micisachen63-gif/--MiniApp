// Read only the final minute that was already committed by the existing engine.
// Never call idleCombatState here: its fallback would invent an uncommitted wave.
export function committedIdleRound(char, expectedMapId = null) {
  if (char.party_id || char.atlas_run_id) return null;
  let state;
  try { state = JSON.parse(char.idle_combat_json || 'null'); } catch { return null; }
  const round = state?.round, actor = String(char.tg_id);
  if (state?.v !== 1 || !round || round.mapId !== state.mapId
    || (expectedMapId !== null && round.mapId !== expectedMapId)
    || !Number.isSafeInteger(round.at) || round.at < 0 || round.at > Number(char.last_settle_at)
    || round.id !== `idle-round:${actor}:${round.at}` || !Array.isArray(round.before)
    || round.before.length !== 2 || !round.before.every(e => typeof e.id === 'string' && e.id.startsWith(`idle:${actor}:`))
    || new Set(round.before.map(e => e.id)).size !== 2
    || !Array.isArray(round.vfxEvents) || round.vfxEvents.length > 12) return null;
  const targets = new Set([actor, ...round.before.map(e => e.id)]);
  const events = round.vfxEvents.filter(e => e?.schemaVersion === 1 && e.source === 'committed-combat'
    && e.actorId === actor && e.atMs === round.at && typeof e.eventId === 'string'
    && e.eventId.startsWith(round.id + ':') && typeof e.skillId === 'string'
    && Array.isArray(e.targetIds) && e.targetIds.every(id => targets.has(id))
    && (e.recipientEffects === undefined || Array.isArray(e.recipientEffects)
      && e.recipientEffects.every(effect => Array.isArray(effect?.targetIds) && effect.targetIds.every(id => targets.has(id)))));
  if (!events.length) return null;
  return { id: round.id, at: round.at, mapId: round.mapId,
    before: round.before.map(e => ({ id: e.id, name: e.name })),
    vfxEvents: structuredClone(events) };
}
