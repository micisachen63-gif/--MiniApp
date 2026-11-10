// F2 composes the original Fate authorities; private input is never part of public recovery metadata.
import * as Fate from './fate.js';
import { GameError } from '../game/classes.js';
import { taipeiDay } from '../game/time.js';
import { scopedFateEnv } from './fate-receipt.js';
import { actorContext, operation, payload, originalKind, record, hooks, snapshot, expectedOf,
  requireActiveRealm, same, scopeOf, changed } from './fate-private-receipt.js';

const envelope = (context, op, saved, replayed) => ({ ...context, kind: op.kind, requestId: op.requestId,
  intentNonce: op.intentNonce, signature: op.signature, outcome: saved.outcome,
  result: saved.result, receipt: saved.receipt, replayed });
const unverified = () => { throw new GameError('fate_private_receipt_unverified',
  '已有未完整核對的私人操作，請保留原編號查詢', 409); };
async function execute(env, tg, body, now, namespace, cancel) {
  const op = operation(body.kind, body, namespace, !cancel), { actor, context } = await actorContext(env, tg, now, body);
  requireActiveRealm(env);
  const originalBody = payload(op, body, cancel), actionHash = cancel ? null :
    await Fate.operationFingerprint(originalKind(op), { ...originalBody, _character: String(tg) }),
    before = await record(env, context, op, actionHash);
  if (before.found) return envelope(context, op, before, true);
  if (!before.recoveryAllowed) unverified();
  const scoped = scopedFateEnv(env, actor);
  let facts = null;
  if (!cancel) {
    if (['birthday-start', 'daily-sync'].includes(op.kind) && op.fields.day !== taipeiDay(now))
      throw new GameError('fate_private_day_changed', '這次操作的日期已結束，請先核對或取消原操作', 409);
    facts = await snapshot(scoped.DB, context, op.expected.daily.day);
    if (!same(op.expected, expectedOf(facts))) changed();
    if (op.kind === 'birthday-start' && op.fields.source === 'saved' && !facts.profile)
      throw new GameError('birth_date', '請先儲存出生檔案，或明確選擇這次使用的生日');
  }
  const options = { ...hooks(scoped.DB, context, op, now, cancel ? 'cancelled' : 'committed', facts),
    [Fate.FATE_PRIVATE_AUTHORITY]: true };
  let execution;
  try {
    if (cancel) execution = await Fate.cancelPrivateIntent(scoped, tg, originalBody, now, options);
    else if (op.kind === 'profile-save') execution = await Fate.saveProfile(scoped, tg, originalBody, now, options);
    else if (op.kind === 'profile-delete') execution = await Fate.deleteProfile(scoped, tg, originalBody, now, options);
    else if (op.kind === 'birthday-start') execution = await Fate.start(scoped, tg, originalBody, now, options);
    else execution = await Fate.dailyScoped(scoped, tg, originalBody, now, options);
  } catch (error) {
    const { context: current } = await actorContext(env, tg, now, body);
    if (!same(scopeOf(context), scopeOf(current))) changed();
    const saved = await record(env, current, op, actionHash);
    if (saved.found) return envelope(current, op, saved, true);
    throw error;
  }
  const { context: current } = await actorContext(env, tg, now, body);
  if (!same(scopeOf(context), scopeOf(current))) changed();
  const saved = await record(env, current, op, actionHash);
  if (!saved.found) unverified();
  return envelope(current, op, saved, execution?.replayed === true);
}
export const run = (env, tg, body = {}, now = Date.now(), namespace = 'service') =>
  execute(env, tg, body, now, namespace, false);
export const cancel = (env, tg, body = {}, now = Date.now(), namespace = 'service') =>
  execute(env, tg, body, now, namespace, true);
