import { settle } from './atlas.js';

export const ATLAS_SWEEP_LIMIT = 12;
export const ATLAS_SWEEP_MAX = 24;

// The persisted keyset survives Worker restarts. Claim the page before running
// it so one damaged run cannot pin all later accounts behind the same page.
export async function sweep(env, now = Date.now(), limit = ATLAS_SWEEP_LIMIT) {
  const realmId = env.REALM_CONTEXT?.id || 'permanent';
  const result = { enabled: String(env.ATLAS_ENABLED) === 'true', realmId, processed: 0, advanced: 0, errors: [] };
  // Flag-off must also work against a database without the Atlas migrations.
  if (!result.enabled) return result;
  if (env.REALM_CONTEXT?.phase && env.REALM_CONTEXT.phase !== 'ACTIVE') return { ...result, skipped: 'realm_closed' };
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Atlas sweep requires an integer timestamp');
  const size = Math.max(1, Math.min(ATLAS_SWEEP_MAX, Math.floor(Number(limit)) || ATLAS_SWEEP_LIMIT));
  const db = env.DB;
  await db.prepare('INSERT INTO rpg_atlas_sweep_cursor(realm_id,cursor,rev,updated_at) VALUES(?,?,0,?) ON CONFLICT(realm_id) DO NOTHING')
    .bind(realmId, '', now).run();
  const checkpoint = await db.prepare('SELECT cursor,rev FROM rpg_atlas_sweep_cursor WHERE realm_id=?').bind(realmId).first();
  const select = (comparison, cursor, count) => db.prepare(`SELECT r.id,r.char_id,r.rev FROM rpg_atlas_runs r
    JOIN rpg_live_characters c ON c.tg_id=r.char_id AND c.atlas_run_id=r.id AND c.account_tg_id=r.account_id
    WHERE r.realm_id=? AND r.status='running' AND r.id ${comparison} ? ORDER BY r.id LIMIT ?`)
    .bind(realmId, cursor, count).all();
  const page = (await select('>', checkpoint.cursor, size)).results || [];
  if (page.length < size && checkpoint.cursor) {
    page.push(...((await select('<=', checkpoint.cursor, size - page.length)).results || []));
  }
  if (!page.length) return result;
  // A concurrent sweep that read the same revision must not overwrite the
  // winning continuation. Each selected run is still protected by settle's
  // ordinary atomic character/run revision guards.
  const claim = await db.prepare('UPDATE rpg_atlas_sweep_cursor SET cursor=?,rev=rev+1,updated_at=? WHERE realm_id=? AND rev=?')
    .bind(page.at(-1).id, now, realmId, checkpoint.rev).run();
  if (Number(claim.meta?.changes) !== 1) return { ...result, skipped: 'claim_conflict' };
  for (const run of page) {
    result.processed++;
    try {
      // Never drain a single run in a loop: settle has a 2,000-step chunk cap.
      const receipt = await settle(env, run.char_id, { runId: run.id }, now);
      if (receipt.scene?.run?.id === run.id && receipt.scene.run.revision > run.rev) result.advanced++;
    } catch (error) {
      result.errors.push({ runId: run.id, code: error.code || 'internal' });
      if (['realm_fence_changed', 'realm_read_only', 'realm_closed'].includes(error.code)) {
        result.interrupted = true;
        break;
      }
    }
  }
  return result;
}
