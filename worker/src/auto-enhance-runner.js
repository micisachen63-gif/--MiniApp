import * as REROLL_AUTO from './services/auto-reroll.js';
import * as GUARDIAN_AUTO from './services/guardian-auto.js';
import { step, INTERVAL_MS } from './services/auto-enhance.js';
import { PERMANENT_REALM_ID, RealmError, resolveRealm, scopeEnvForRealm } from './realm/index.js';

const sameBinding = (left, right) => left.realmId === right.realmId && left.jobId === right.jobId && left.kind === right.kind;
const realmFailure = error => typeof error?.code === 'string' && error.code.startsWith('realm_');
const validJob = id => /^[\da-f-]{36}$/i.test(String(id));

/** One durable alarm per immutable realm/job. D1 owns all money and revisions. */
export class AutoEnhanceRunner {
  constructor(state, env) { this.state = state; this.env = env; this.bindingTail = Promise.resolve(); }

  async storedBinding(storage = this.state.storage) {
    const binding = await storage.get('realmBinding');
    if (binding) return binding;
    const jobId = await storage.get('jobId');
    if (!jobId) return null;
    // Only pre-realm permanent jobs may omit a realm. Never use currentSeason.
    const realmId = await storage.get('realmId'), kind = await storage.get('kind');
    return { realmId: realmId === undefined ? PERMANENT_REALM_ID : realmId, jobId, kind: kind === undefined ? 'enhance' : kind };
  }

  async checkBinding(binding, storage = this.state.storage) {
    const existing = await this.storedBinding(storage);
    if (existing && !sameBinding(existing, binding)) throw new RealmError('realm_background_mismatch', '背景作業已固定至另一個世界或工作', 409);
    return existing;
  }

  async pinBinding(binding) {
    const pin = async storage => {
      await this.checkBinding(binding, storage);
      // The single immutable record also protects restarts between legacy writes.
      await storage.put('realmBinding', binding);
      await storage.put('realmId', binding.realmId);
      await storage.put('jobId', binding.jobId);
      await storage.put('kind', binding.kind);
    };
    if (typeof this.state.storage.transaction === 'function') return this.state.storage.transaction(pin);
    // Minimal test storage has no transaction API. Keep its first binding serial.
    const next = this.bindingTail.then(() => pin(this.state.storage));
    this.bindingTail = next.catch(() => {});
    return next;
  }

  async scopedEnv(realmId) {
    const context = await resolveRealm(this.env, realmId);
    if (context.phase !== 'ACTIVE') throw new RealmError('realm_read_only', '這個世界的背景工作已暫停', 409);
    // Never replace this.env: every invocation starts from the original bindings.
    return scopeEnvForRealm(this.env, context);
  }

  async job(env, id, kind = 'enhance') {
    const sql = kind === 'reroll' ? 'SELECT id,status,next_at FROM rpg_auto_reroll WHERE id=?'
      : kind === 'guardian' ? 'SELECT id,status,next_at FROM rpg_guardian_auto WHERE id=?'
        : 'SELECT id,status,next_at FROM rpg_auto_enhance WHERE id=?';
    return env.DB.prepare(sql).bind(id).first();
  }

  async suspend(binding, error) {
    await this.state.storage.deleteAlarm();
    await this.state.storage.put('realmSuspension', { realmId: binding.realmId, code: error.code || 'realm_unavailable', at: Date.now() });
  }

  async finish() {
    await this.state.storage.deleteAlarm();
    await this.state.storage.delete('jobId');
    await this.state.storage.delete('kind');
    await this.state.storage.delete('realmSuspension');
    // realmBinding/realmId remain forever; an ended DO cannot be rebound.
  }

  async fetch(request) {
    let body;
    try { body = await request.json(); } catch { return new Response('Invalid body', { status: 400 }); }
    const kind = body?.kind === undefined ? 'enhance' : body.kind;
    if (!body || !['enhance', 'guardian', 'reroll'].includes(kind) || !validJob(body.jobId)) return new Response('Invalid job', { status: 400 });
    const binding = { jobId: body.jobId, kind, realmId: body.realmId === undefined ? PERMANENT_REALM_ID : body.realmId };
    let matching = false;
    try {
      await this.checkBinding(binding); matching = true;
      const env = await this.scopedEnv(binding.realmId), row = await this.job(env, binding.jobId, binding.kind);
      if (!row || row.status !== 'running') return new Response('Ended');
      await this.pinBinding(binding);
      await this.state.storage.delete('realmSuspension');
      const desired = Math.max(Date.now() + 10, row.next_at), alarm = await this.state.storage.getAlarm();
      if (alarm == null || alarm > desired) await this.state.storage.setAlarm(desired);
      return new Response('Scheduled', { status: 202 });
    } catch (error) {
      // A mismatched request must not cancel the correctly bound object's alarm.
      if (matching && realmFailure(error) && error.code !== 'realm_background_mismatch') await this.suspend(binding, error);
      return Response.json({ error: error.code || 'internal', message: realmFailure(error) ? error.message : 'Background scheduling failed' }, { status: error.status || 500 });
    }
  }

  async alarm() {
    const id = await this.state.storage.get('jobId');
    if (!id) { await this.state.storage.deleteAlarm(); return; }
    const binding = await this.storedBinding();
    // Register crash recovery before D1 I/O, as in the original paid-job runner.
    await this.state.storage.setAlarm(Date.now() + 30_000);
    try {
      if (!binding || !validJob(binding.jobId) || binding.jobId !== id || !['enhance', 'guardian', 'reroll'].includes(binding.kind)) throw new RealmError('realm_background_invalid', '背景工作身分無效', 409);
      await this.pinBinding(binding);
      const env = await this.scopedEnv(binding.realmId);
      let row = await this.job(env, id, binding.kind), progressed = true;
      if (row?.status === 'running' && row.next_at <= Date.now()) progressed = await (binding.kind === 'reroll' ? REROLL_AUTO.step : binding.kind === 'guardian' ? GUARDIAN_AUTO.step : step)(env, id, Date.now());
      row = await this.job(env, id, binding.kind);
      if (row?.status === 'running') await this.state.storage.setAlarm(Math.max(Date.now() + (progressed ? 100 : 350 + Math.floor(Math.random() * 650)), row.next_at));
      else await this.finish();
    } catch (error) {
      if (realmFailure(error)) { await this.suspend(binding || { realmId: null }, error); return; }
      console.error('auto enhancement alarm', id, error.message);
      await this.state.storage.setAlarm(Date.now() + Math.max(INTERVAL_MS, 30_000));
    }
  }
}
