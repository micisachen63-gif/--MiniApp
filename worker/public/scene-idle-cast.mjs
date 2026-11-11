import { planLegacyVfx } from './skill-vfx-legacy.mjs';
import { createActorReleaseResolver } from './skill-vfx-actor-bridge.mjs';
import { createNativeCastResolver } from './scene-native-cast.mjs';

// Replay explicit committed native/special descriptors, never infer a cast from
// the equipped icon, a class name, an elapsed cooldown, or a cosmetic hit.
export function createIdleCastController(options) {
  const { animator, hero } = options;
  const release = options.releaseResolver || createActorReleaseResolver(options);
  const native = options.nativeResolver || createNativeCastResolver(options);
  const seen = new Set();
  let epoch = 0, pending = [], active = null, preparing = false, destroyed = false;
  const counts = { accepted: 0, rejected: 0, lastSkillId: null, reason: null };
  function clear(reason = 'context-changed') {
    epoch++; pending = []; active = null; preparing = false;
    counts.reason = reason;
  }
  function reject(reason) { counts.rejected++; counts.reason = reason; }
  function enqueue(round, scope, now) {
    if (!round || destroyed || !Number.isFinite(now) || now - round.at > 120000 || round.at > now + 250
      || !Array.isArray(round.vfxEvents) || !Array.isArray(round.before)) return;
    for (const raw of round.vfxEvents) {
      const key = scope + ':' + raw?.eventId;
      if (!raw || raw.source !== 'committed-combat' || seen.has(key) || pending.some(x => x.key === key)
        || active?.key === key || pending.length >= 12) continue;
      seen.add(key); if (seen.size > 512) seen.delete(seen.values().next().value);
      pending.push({ raw, key, scope, round, epoch });
    }
  }
  const current = item => !destroyed && item.epoch === epoch && !options.hidden() && item.scope === options.getScope();
  async function start(item) {
    preparing = true;
    const version = epoch;
    try {
      const loaded = await options.load();
      if (!loaded || version !== epoch || !current(item)) return;
      const geometry = options.geometry(item.round, item.raw);
      const plan = planLegacyVfx(item.raw, geometry, loaded.catalog);
      if (!plan.accepted) { reject(plan.reason); return; }
      await loaded.player.prepare(plan.skill.baseClass);
      if (version !== epoch || !current(item) || !animator.ready) return;
      const direction = animator.face(geometry.targetWorld.x - hero.x, geometry.targetWorld.y - hero.y);
      let spec;
      try { spec = await release.resolve({ animator, actorId: animator.actor.id, direction,
        requireOrigin: item.raw.presentationMode === 'full' }); }
      catch (error) {
        if (!['missing-release-origin', 'missing-release-marker'].includes(error.code)) throw error;
        spec = await native.resolve({ animator, actorId: animator.actor.id, direction, recipe: loaded.player.getRecipe(item.raw.skillId) });
      }
      if (version !== epoch || !current(item)) return;
      if (!animator.play('attack', direction, true)) { reject('actor-not-ready'); return; }
      active = { ...item, loaded, spec, direction, generation: animator.generation, released: false };
    } catch (error) { if (version === epoch) reject(error.code || 'idle-cast-unavailable'); }
    finally { if (version === epoch) preparing = false; }
  }
  function update() {
    if (destroyed || options.hidden()) { if (active || preparing || pending.length) clear('hidden'); return false; }
    if (active) {
      const item = active;
      if (!current(item) || animator.generation !== item.generation || animator.action !== 'attack'
        || animator.activeDirection !== item.direction) { clear('actor-changed'); return false; }
      if (!item.released && animator.elapsed >= item.spec.delayMs) {
        item.released = true;
        const geometry = options.geometry(item.round, item.raw);
        const plan = planLegacyVfx(item.raw, geometry, item.loaded.catalog);
        if (!plan.accepted) reject(plan.reason);
        else {
          const origin = item.spec.nativeOrigin ? animator.releaseOrigin?.() : item.spec.origin;
          const impact = item.spec.presentation === 'native-target' && item.raw.presentationMode === 'full';
          const from = impact ? geometry.targets.find(t => t.id === item.raw.targetIds[0])?.point
            : origin ? options.project({ x: hero.x + origin.x * options.bodyHeight(), y: hero.y + origin.y * options.bodyHeight() }) : geometry.from;
          if (from && Number.isFinite(from.x) && Number.isFinite(from.y)) {
            for (const command of plan.commands) void Promise.resolve(item.loaded.player.play({ ...command,
              ...(command.presentationMode === 'full' ? { from, presentationMode: impact ? 'impact' : 'full',
                startProgress: impact ? 0 : item.loaded.player.getRecipe(item.raw.skillId)?.phases?.find(p => p.id === 'release')?.from ?? command.startProgress } : {}),
              canStart: () => current(item) && item.generation === animator.generation }))
              .catch(error => { if (current(item)) reject(error.code || 'idle-vfx-unavailable'); });
            counts.accepted++; counts.lastSkillId = item.raw.skillId; counts.reason = null;
          } else reject('missing-release-geometry');
        }
      }
      if (animator.elapsed >= item.spec.duration) { active = null; animator.play('idle', item.direction, true); }
      return !!active;
    }
    if (preparing) return true;
    const next = pending.shift();
    if (next && current(next)) { void start(next); return true; }
    return false;
  }
  const visibility = () => { if (options.hidden()) clear('hidden'); };
  options.document?.addEventListener('visibilitychange', visibility);
  return { enqueue, update, clear, stats: () => ({ ...counts, pending: pending.length, active: !!active, preparing }),
    destroy() { clear('destroyed'); destroyed = true; options.document?.removeEventListener('visibilitychange', visibility); release.clear(); native.destroy?.(); } };
}
