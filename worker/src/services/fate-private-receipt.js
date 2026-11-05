// F2 private intent evidence. DOB, notes and private fingerprints never enter ledger/public receipts.
import { GameError } from '../game/classes.js';
import { ledgerStmt } from '../db.js';
import { COUNTRY_METADATA_V9 } from '../../public/fate/country-runtime-v9.js';
import { actorContext, requireActiveRealm, hashJSON, same } from './fate-receipt.js';

export { actorContext, requireActiveRealm, same };
export const RECEIPT_TYPE = '命運私人操作收據';
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const integer = value => Number.isSafeInteger(value) && value >= 0;
export const stable = value => Array.isArray(value) ? value.map(stable) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const keys = (value, expected) => plain(value) && same(Object.keys(value).sort(), [...expected].sort());
const input = message => { throw new GameError('fate_private_input', message, 400); };
const corrupt = () => { throw new GameError('fate_private_receipt_corrupt', '原私人操作目前無法完整核對，請保留原操作編號', 409); };
export const changed = () => { throw new GameError('fate_private_changed', '檔案或旅箋已更新，請先核對原操作，再重新確認', 409); };
export function decode(value) {
  try { return JSON.parse(value); } catch {
    throw new GameError('fate_private_state_corrupt', '私人資料目前無法完整讀取，請稍後再試', 409);
  }
}
const parsedReceipt = value => { try { return JSON.parse(value); } catch { return corrupt(); } };
const id = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const proofId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const transport = ['realmId', 'selectedCharacterId', 'tgId', 'accountId', 'namespace', 'readSequence'];
const publicFields = {
  'profile-save': ['consent'], 'profile-delete': [], 'birthday-start': ['source', 'country', 'showSign', 'socialInvite', 'day'],
  'daily-sync': ['day']
};
function onlyKeys(body, allowed) {
  if (!plain(body) || Object.keys(body).some(key => !allowed.includes(key))) input('這個私人入口不接受額外資料');
}
function expectedSnapshot(value) {
  if (!keys(value, ['generation', 'profile', 'daily']) || !integer(value.generation) ||
      !keys(value.profile, ['saved', 'rev', 'updatedAt']) || typeof value.profile.saved !== 'boolean' ||
      !integer(value.profile.rev) || (value.profile.saved ?
        value.profile.rev < 1 || !integer(value.profile.updatedAt) : value.profile.rev !== 0 || value.profile.updatedAt !== null) ||
      !keys(value.daily, ['day', 'materialized', 'rev', 'createdAt']) || !validDay(value.daily.day) ||
      typeof value.daily.materialized !== 'boolean' || !integer(value.daily.rev) ||
      (value.daily.materialized ? !integer(value.daily.createdAt) : value.daily.rev !== 0 || value.daily.createdAt !== null))
    input('請保留完整的原檔案與旅箋確認資料');
  return stable(value);
}
export function readSequence(body = {}) {
  const value = body.readSequence ?? 0;
  if (!integer(value)) input('讀取序號無效');
  return value;
}
export function readParameters(body = {}, namespace = 'service') {
  if (!['app', 'service'].includes(namespace)) input('私人資料讀取來源無效');
  onlyKeys(body, transport);
  return { readSequence: readSequence(body) };
}
export function operation(kind, body = {}, namespace = 'service', privateAction = false) {
  if (!plain(body) || !['app', 'service'].includes(namespace) || !has(publicFields, kind) ||
      typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId) ||
      typeof body.intentNonce !== 'string' || !/^[a-f0-9]{32,64}$/.test(body.intentNonce))
    input('需要有效的原私人操作編號');
  const privateKeys = privateAction ? kind === 'profile-save' ? ['birth'] :
    kind === 'birthday-start' && body.source === 'temporary' ? ['birthDate'] : [] : [];
  onlyKeys(body, [...transport, 'requestId', 'kind', 'intentNonce', 'expected', ...publicFields[kind], ...privateKeys]);
  const expected = expectedSnapshot(body.expected), fields = {};
  if (kind === 'profile-save') {
    if (body.consent !== true) throw new GameError('birth_consent', '請先同意將出生資料儲存於自己的帳號，供每日旅箋使用');
    fields.consent = true;
  } else if (kind === 'birthday-start') {
    if (!['temporary', 'saved'].includes(body.source) || typeof body.showSign !== 'boolean' || body.socialInvite !== false ||
        (body.country !== 'TW' && !Object.hasOwn(COUNTRY_METADATA_V9, body.country)) || !validDay(body.day))
      input('請明確選擇生日來源、出生地、星座顯示與啟程日期');
    Object.assign(fields, { source: body.source, country: body.country, showSign: body.showSign,
      socialInvite: false, day: body.day });
  } else if (kind === 'daily-sync') {
    if (!validDay(body.day) || body.day !== expected.daily.day) input('請保留這次旅箋原本的日期');
    fields.day = body.day;
  }
  if (kind === 'birthday-start' && fields.day !== expected.daily.day) input('請保留這次啟程原本的日期');
  if (privateAction && kind === 'profile-save') {
    if (!plain(body.birth)) input('請填寫出生資料');
    onlyKeys(body.birth, ['date', 'time', 'placeId', 'lat', 'lon', 'zone', 'placeLabel', 'sex', 'fold']);
  }
  if (privateAction && kind === 'birthday-start' && fields.source === 'temporary' &&
      (typeof body.birthDate !== 'string' || !body.birthDate)) input('請填寫這次啟程的生日');
  const intent = stable({ kind, intentNonce: body.intentNonce, expected, ...fields });
  return { kind, fields, expected, intentNonce: body.intentNonce, requestId: body.requestId,
    request: 'private:' + namespace + ':' + body.requestId, intent, signature: JSON.stringify(intent) };
}
export function payload(op, body = {}, cancel = false) {
  const common = { privateIntent: op.intent, requestId: op.request };
  if (cancel) return common;
  if (op.kind === 'profile-save') return { ...common, consent: true, birth: body.birth };
  if (op.kind === 'profile-delete') return common;
  if (op.kind === 'daily-sync') return { ...common, day: op.fields.day };
  return { ...common, mode: 'birthday', country: op.fields.country, showSign: op.fields.showSign, socialInvite: false,
    ...(op.fields.source === 'temporary' ? { birthDate: body.birthDate } : {}) };
}
export const originalKind = op => op.kind === 'birthday-start' ? 'start' : op.kind;
export const scopeOf = context => ({ realmId: context.realmId, accountId: context.accountId, characterId: context.characterId });
export const eventId = (context, op) => 'fate-private-receipt:' + context.characterId + ':' + op.request;

export async function snapshot(db, context, day) {
  const result = await db.batch([
    db.prepare('SELECT birth_json,chart_json,rev,updated_at FROM rpg_fate_profiles WHERE account_id=?').bind(context.accountId),
    db.prepare('SELECT day,notes_json,unlocks_json,profile_rev,rev,created_at FROM rpg_fate_daily WHERE account_id=? AND day=?')
      .bind(context.accountId, day),
    db.prepare('SELECT COUNT(*) generation FROM rpg_fate_operations WHERE account_id=?').bind(context.accountId)
  ]);
  return { day, profile: result[0]?.results?.[0] ?? null, daily: result[1]?.results?.[0] ?? null,
    generation: result[2]?.results?.[0]?.generation ?? 0 };
}
export function expectedOf(value) {
  return { generation: value.generation,
    profile: { saved: !!value.profile, rev: value.profile?.rev ?? 0, updatedAt: value.profile?.updated_at ?? null },
    daily: { day: value.day, materialized: !!value.daily, rev: value.daily?.rev ?? 0, createdAt: value.daily?.created_at ?? null } };
}
export async function domainOf(value) {
  const expected = expectedOf(value);
  return { version: 1, ...expected, token: await hashJSON(stable(expected)) };
}
export function snapshotGuards(db, context, op, facts) {
  const expected = op.expected, account = context.accountId;
  if (!same(expected, expectedOf(facts))) changed();
  // The count is an append-only account generation in the current authority:
  // all legacy and scoped profile saves/deletes insert an operation in the SAME batch.
  // No private hash or raw snapshot is returned in the public domain/receipt.
  return [
    db.prepare('INSERT INTO rpg_guard(ok) SELECT NULL WHERE (SELECT COUNT(*) FROM rpg_fate_operations WHERE account_id=?)<>?')
      .bind(account, expected.generation),
    db.prepare("INSERT INTO rpg_guard(ok) SELECT NULL WHERE (SELECT COUNT(*) FROM rpg_fate_profiles WHERE account_id=?)<>? OR COALESCE((SELECT rev FROM rpg_fate_profiles WHERE account_id=?),0)<>? OR COALESCE((SELECT updated_at FROM rpg_fate_profiles WHERE account_id=?),-1)<>? OR COALESCE((SELECT birth_json FROM rpg_fate_profiles WHERE account_id=?),'')<>? OR COALESCE((SELECT chart_json FROM rpg_fate_profiles WHERE account_id=?),'')<>?")
      .bind(account, expected.profile.saved ? 1 : 0, account, expected.profile.rev, account, expected.profile.updatedAt ?? -1,
        account, facts.profile?.birth_json ?? '', account, facts.profile?.chart_json ?? ''),
    db.prepare("INSERT INTO rpg_guard(ok) SELECT NULL WHERE (SELECT COUNT(*) FROM rpg_fate_daily WHERE account_id=? AND day=?)<>? OR COALESCE((SELECT rev FROM rpg_fate_daily WHERE account_id=? AND day=?),0)<>? OR COALESCE((SELECT created_at FROM rpg_fate_daily WHERE account_id=? AND day=?),-1)<>? OR COALESCE((SELECT notes_json FROM rpg_fate_daily WHERE account_id=? AND day=?),'')<>? OR COALESCE((SELECT unlocks_json FROM rpg_fate_daily WHERE account_id=? AND day=?),'')<>? OR COALESCE((SELECT profile_rev FROM rpg_fate_daily WHERE account_id=? AND day=?),0)<>?")
      .bind(account, expected.daily.day, expected.daily.materialized ? 1 : 0,
        account, expected.daily.day, expected.daily.rev, account, expected.daily.day, expected.daily.createdAt ?? -1,
        account, expected.daily.day, facts.daily?.notes_json ?? '', account, expected.daily.day, facts.daily?.unlocks_json ?? '',
        account, expected.daily.day, facts.daily?.profile_rev ?? 0)
  ];
}
function validResult(op, outcome, result) {
  if (outcome === 'cancelled') return keys(result, ['cancelled']) && result.cancelled === true;
  if (outcome !== 'committed') return false;
  if (op.kind === 'profile-save') return keys(result, ['saved', 'coverage']) && result.saved === true &&
    ['inspiration', 'three-traditions'].includes(result.coverage);
  if (op.kind === 'profile-delete') return keys(result, ['deleted']) && result.deleted === true;
  if (op.kind === 'birthday-start') return id(result?.lifeId) &&
    (keys(result, ['lifeId']) || keys(result, ['lifeId', 'already']) && result.already === true);
  return keys(result, ['day', 'materialized', 'created', 'unlocked', 'added', 'revision']) &&
    result.day === op.fields.day && result.materialized === true && typeof result.created === 'boolean' &&
    integer(result.unlocked) && result.unlocked <= 3 && integer(result.added) && result.added <= result.unlocked &&
    integer(result.revision);
}
const costsFor = (op, result, outcome) => outcome === 'committed' && op.kind === 'birthday-start' ?
  { dailyStarts: result.already === true ? 0 : 1 } : {};
function publicReceipt(context, op, result, now, proof, outcome) {
  if (!validResult(op, outcome, result) || !proofId(proof)) corrupt();
  return { version: 1, kind: op.kind, requestId: op.requestId, requestKey: op.request, intentNonce: op.intentNonce,
    signature: op.signature, scope: scopeOf(context), createdAt: now, outcome, result,
    costs: costsFor(op, result, outcome), authority: { family: 'life-operations', requestKey: op.request, proofId: proof } };
}
export function hooks(db, context, op, now, outcome = 'committed', facts = null) {
  const proof = crypto.randomUUID().replaceAll('-', '');
  return {
    ...(facts ? { guards: () => snapshotGuards(db, context, op, facts) } : {}),
    operationResult(result, { payloadHash }) {
      if (!hash(payloadHash) || !validResult(op, outcome, result)) corrupt();
      return { version: 1, fatePrivate: true, operationKind: outcome === 'cancelled' ? 'private-cancel' : originalKind(op),
        kind: op.kind, scope: scopeOf(context), intentNonce: op.intentNonce, signature: op.signature, proofId: proof,
        outcome, result, payloadHash };
    },
    readOperationResult(stored) {
      if (!plain(stored) || stored.fatePrivate !== true || !validResult(op, stored.outcome, stored.result)) corrupt();
      return stored.result;
    },
    receipt: result => ledgerStmt(db, { event_id: eventId(context, op), tg_id: context.characterId,
      type: RECEIPT_TYPE, note: JSON.stringify(publicReceipt(context, op, result, now, proof, outcome)) }, now)
  };
}
function validReceipt(saved, context, op, at) {
  return keys(saved, ['version', 'kind', 'requestId', 'requestKey', 'intentNonce', 'signature', 'scope', 'createdAt',
    'outcome', 'result', 'costs', 'authority']) &&
    saved.version === 1 && saved.kind === op.kind && saved.requestId === op.requestId && saved.requestKey === op.request &&
    saved.intentNonce === op.intentNonce && saved.signature === op.signature && same(saved.scope, scopeOf(context)) &&
    integer(saved.createdAt) && saved.createdAt === at && validResult(op, saved.outcome, saved.result) &&
    same(saved.costs, costsFor(op, saved.result, saved.outcome)) &&
    keys(saved.authority, ['family', 'requestKey', 'proofId']) && saved.authority.family === 'life-operations' &&
    saved.authority.requestKey === op.request && proofId(saved.authority.proofId);
}
export async function record(env, context, op, actionHash = null) {
  const db = env.DB, row = await db.prepare('SELECT * FROM rpg_ledger WHERE event_id=?').bind(eventId(context, op)).first(),
    authority = await db.prepare('SELECT account_id,request_id,payload_hash,result_json,created_at FROM rpg_fate_operations WHERE account_id=? AND request_id=?')
      .bind(context.accountId, op.request).first();
  if (!row) {
    const available = (!env.REALM_CONTEXT?.phase || env.REALM_CONTEXT.phase === 'ACTIVE') && !authority;
    return { found: false, outcome: null, result: null, receipt: null, recoveryAllowed: available, cancellationAllowed: available };
  }
  const saved = parsedReceipt(row.note);
  if (saved?.kind !== op.kind || saved?.intentNonce !== op.intentNonce || saved?.signature !== op.signature)
    throw new GameError('request_reused', '同一操作編號不可更換確認內容，請保留原紀錄', 409);
  if (String(row.tg_id) !== context.characterId || row.type !== RECEIPT_TYPE || row.gold_delta !== 0 ||
      row.exp_delta !== 0 || row.item_delta !== 0 || row.item !== null ||
      !validReceipt(saved, context, op, row.created_at) || !authority || authority.account_id !== context.accountId ||
      authority.request_id !== op.request || authority.created_at !== saved.createdAt || !hash(authority.payload_hash)) corrupt();
  const internal = parsedReceipt(authority.result_json), wanted = {
    version: 1, fatePrivate: true, operationKind: saved.outcome === 'cancelled' ? 'private-cancel' : originalKind(op),
    kind: op.kind, scope: scopeOf(context), intentNonce: op.intentNonce, signature: op.signature,
    proofId: saved.authority.proofId, outcome: saved.outcome, result: saved.result, payloadHash: authority.payload_hash
  };
  if (!same(internal, wanted)) corrupt();
  if (actionHash !== null && saved.outcome === 'committed' && actionHash !== authority.payload_hash)
    throw new GameError('request_changed', '這個操作編號的私人內容已不同，請查詢原紀錄', 409);
  if (saved.outcome === 'committed' && op.kind === 'birthday-start') {
    const life = await db.prepare('SELECT char_id,account_id,started_at FROM rpg_fate_lives WHERE id=?')
      .bind(saved.result.lifeId).first();
    if (!life || life.char_id !== context.characterId || life.account_id !== context.accountId ||
        (saved.result.already === true ? life.started_at > saved.createdAt : life.started_at !== saved.createdAt)) corrupt();
  }
  return { found: true, outcome: saved.outcome, result: saved.result, receipt: saved,
    recoveryAllowed: false, cancellationAllowed: false };
}
export async function history(db, context, namespace) {
  const prefix = 'fate-private-receipt:' + context.characterId + ':private:' + namespace + ':',
    rows = (await db.prepare('SELECT event_id,note,created_at FROM rpg_ledger WHERE tg_id=? AND type=? AND event_id LIKE ? ORDER BY created_at DESC,event_id DESC LIMIT 20')
      .bind(context.characterId, RECEIPT_TYPE, prefix + '%').all()).results || [];
  return { receipts: rows.map(row => {
    try {
      const saved = JSON.parse(row.note), intent = JSON.parse(saved.signature),
        requestId = row.event_id.slice(prefix.length),
        op = operation(intent.kind, { ...intent, requestId }, namespace);
      if (!validReceipt(saved, context, op, row.created_at)) throw new Error('invalid');
      return { version: saved.version, kind: op.kind, requestId, requestKey: op.request, intentNonce: op.intentNonce,
        signature: op.signature, scope: saved.scope, createdAt: row.created_at, outcome: saved.outcome, intent: op.intent };
    } catch { return { createdAt: row.created_at, corrupt: true }; }
  }) };
}
export async function view(env, tg, body = {}, now = Date.now(), namespace = 'service') {
  const op = operation(body.kind, body, namespace), sequence = readSequence(body),
    { context } = await actorContext(env, tg, now, body), saved = await record(env, context, op),
    { context: current } = await actorContext(env, tg, now, body);
  if (!same(scopeOf(context), scopeOf(current))) changed();
  return { ...current, readSequence: sequence, kind: op.kind, requestId: op.requestId,
    intentNonce: op.intentNonce, signature: op.signature, ...saved };
}
