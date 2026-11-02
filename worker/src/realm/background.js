import { PERMANENT_REALM_ID } from './catalog.js';
import { resolveRealm } from './identity.js';
import { RealmError } from './errors.js';

/** Permanent object names stay stable so already-paid legacy jobs keep running. */
export async function wakeRealmJob(env, jobId, kind = 'enhance') {
  if (!env.AUTO_ENHANCE_RUNNER) return false;
  if (!['enhance', 'reroll', 'guardian'].includes(kind) || !/^[\da-f-]{36}$/i.test(String(jobId))) throw new RealmError('realm_background_invalid', '背景作業內容無效', 400);
  const realm = env.REALM_CONTEXT || await resolveRealm(env, PERMANENT_REALM_ID);
  if (realm.phase !== 'ACTIVE') throw new RealmError('realm_read_only', '這個世界已停止接受背景操作', 409);
  const legacyName = kind === 'enhance' ? jobId : kind + ':' + jobId;
  const name = realm.id === PERMANENT_REALM_ID ? legacyName : 'realm:' + realm.id + ':' + legacyName;
  const stub = env.AUTO_ENHANCE_RUNNER.get(env.AUTO_ENHANCE_RUNNER.idFromName(name));
  const result = await stub.fetch('https://auto-enhance.internal/wake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId, kind, realmId: realm.id }) });
  if (!result.ok) throw new Error('Unable to schedule background ' + kind);
  return true;
}
