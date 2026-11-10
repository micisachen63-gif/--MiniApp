// Boss scene receipts are committed evidence, read without settlement or maintenance.
import { GameError } from '../game/classes.js';
import { BOSS_EXCHANGES } from '../game/boss-economy.js';
import { BOSS, MAX_OPEN_MAP, SLOTS } from '../game/constants.js';

const fail = (code, message) => { throw new GameError(code, message, 409); };
const input = message => { throw new GameError('boss_receipt_input', message, 400); };
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const quantity = n => Number.isSafeInteger(n) && n >= 0;

export function bossIdentity(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) input('需要有效的原首領識別');
  return value;
}
export function bossWindow(value) {
  if (!quantity(value)) input('需要有效的原攻擊時間窗');
  return value;
}
export function exchangeRequest(requestId, namespace = 'service') {
  if (!['app', 'service'].includes(namespace)) input('操作來源無效');
  const pattern = namespace === 'app' ? /^[A-Za-z0-9_-]{8,64}$/ : /^[A-Za-z0-9_-]{8,80}$/;
  if (typeof requestId !== 'string' || !pattern.test(requestId)) input('需要有效的原操作編號');
  return namespace === 'app' ? 'app:' + requestId : requestId;
}
export function exchangeSignature(body, { scoped = false } = {}) {
  if (typeof body.offer !== 'string' || !(body.offer === 'legacy' || Object.hasOwn(BOSS_EXCHANGES, body.offer)))
    input('兌換品項無效');
  const materials = body.offer === 'legacy' ? body.expectedMaterials ?? null : null;
  if ((scoped && body.offer === 'legacy') || materials !== null) {
    if (!plain(materials) || Object.keys(materials).length !== 2
      || !Object.hasOwn(materials, 'mat_3') || !Object.hasOwn(materials, 'mat_4')
      || !quantity(materials.mat_3) || !quantity(materials.mat_4))
      input('請核對三、四轉舊材料的確切數量');
  }
  return JSON.stringify(body.offer === 'legacy' ? {
    offer: body.offer, expectedMaterials: materials === null ? null : { mat_3: materials.mat_3, mat_4: materials.mat_4 },
  } : { offer: body.offer });
}

export async function actorContext(env, tg, now) {
  const tgId = String(tg);
  if (!/^(?:\d{1,20}|c[\da-f]{32})$/i.test(tgId)) input('角色識別無效');
  const actor = await env.DB.prepare(
    'SELECT c.tg_id,c.account_tg_id,c.rev,c.boss_down_until,a.active_char_id FROM rpg_live_characters c ' +
    'LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id WHERE c.tg_id=?'
  ).bind(tgId).first();
  if (!actor) throw new GameError('no_character', '找不到目前帳號的角色', 404);
  if (actor.active_char_id && String(actor.active_char_id) !== tgId)
    fail('character_changed', '角色已切換，請回到原角色核對這筆紀錄');
  return {
    actor,
    context: {
      ok: true, now, realmId: env.REALM_CONTEXT?.id || 'permanent',
      accountId: String(actor.account_tg_id || tgId), characterId: tgId, revision: Number(actor.rev || 0),
    },
  };
}

// Guard every write, including withPlayer's rejected-action idle settlement and
// every automatic conflict retry. Keep the original authority and retry behavior.
// Read batches remain ordinary SELECTs, including in a frozen realm.
export function requireActiveRealm(env) {
  if (env.REALM_CONTEXT?.phase && env.REALM_CONTEXT.phase !== 'ACTIVE')
    fail('realm_read_only', '這個世界已停止接受新操作，目前僅供查看');
}

export function scopedBossEnv(env, actor) {
  const db = env.DB, statements = new WeakMap(), characterId = String(actor.tg_id);
  const accountId = String(actor.account_tg_id || characterId);
  const activeGuard = () => db.prepare(
    'INSERT INTO rpg_guard(ok) SELECT NULL WHERE NOT EXISTS (' +
    'SELECT 1 FROM rpg_live_characters c LEFT JOIN rpg_accounts a ON a.account_tg_id=c.account_tg_id ' +
    'WHERE c.tg_id=? AND c.account_tg_id=? AND (a.active_char_id IS NULL OR a.active_char_id=c.tg_id))'
  ).bind(characterId, accountId);
  async function execute(items) {
    const entries = items.map(item => {
      const entry = statements.get(item);
      if (!entry) throw new Error('boss scoped statement belongs to another database');
      return entry;
    });
    const write = entries.some(entry => !entry.readOnly);
    const result = await db.batch([...(write ? [activeGuard()] : []), ...entries.map(entry => entry.statement)]);
    return write ? result.slice(1) : result;
  }
  function wrap(statement, readOnly) {
    const wrapped = {
      bind(...values) { return wrap(statement.bind(...values), readOnly); },
      async all() { return (await execute([wrapped]))[0]; },
      async run() { return (await execute([wrapped]))[0]; },
      async first(column) {
        const row = (await execute([wrapped]))[0]?.results?.[0] ?? null;
        return column && row ? row[column] : row;
      },
    };
    statements.set(wrapped, { statement, readOnly });
    return wrapped;
  }
  return {
    ...env,
    DB: {
      prepare(sql) { return wrap(db.prepare(sql), /^\s*SELECT\b/i.test(sql)); },
      batch(items) { return execute(items); },
    },
  };
}

export async function attackRecord(env, tg, bossId, win) {
  const id = bossIdentity(bossId), window = bossWindow(win), tgId = String(tg);
  const row = await env.DB.prepare(
    'SELECT damage,created_at FROM rpg_boss_attacks WHERE boss_id=? AND tg_id=? AND win=?'
  ).bind(id, tgId, window).first();
  if (!row) return { found: false, result: null, receipt: null };
  if (!quantity(row.damage) || !quantity(row.created_at))
    fail('boss_receipt_corrupt', '原攻擊紀錄目前無法核對，請保留待核對狀態');
  return {
    found: true,
    // The original attack table does not store crit, counter, HP, MP or kill.
    result: { bossId: id, win: window, damage: row.damage, createdAt: row.created_at },
    receipt: { kind: 'attack', evidence: 'attack-row', bossId: id, win: window, createdAt: row.created_at },
  };
}

function validSaved(saved, body, row, ledger, tg, prefix) {
  if (!plain(saved) || saved.version !== 1 || typeof saved.signature !== 'string'
    || !plain(saved.result) || !plain(saved.result.items) || !plain(saved.costs)
    || row.type !== '首領精華操作收據' || row.item !== null || row.item_delta !== 0
    || row.gold_delta !== 0 || row.exp_delta !== 0 || !quantity(row.created_at)) return false;
  const keys = Object.keys(saved.result).sort();
  if (!same(keys, body.offer === 'relic' ? ['equipment', 'items'] : ['items'])) return false;
  let expectedCosts, expectedItems, expectedLedger;
  if (body.offer === 'legacy') {
    if (Object.keys(saved.costs).sort().join(',') !== 'mat_3,mat_4'
      || !quantity(saved.costs.mat_3) || !quantity(saved.costs.mat_4)) return false;
    expectedCosts = { mat_3: saved.costs.mat_3, mat_4: saved.costs.mat_4 };
    if (body.expectedMaterials && !same(expectedCosts, { mat_3: body.expectedMaterials.mat_3, mat_4: body.expectedMaterials.mat_4 })) return false;
    const total = expectedCosts.mat_3 * 12 + expectedCosts.mat_4 * 16;
    if (!Number.isSafeInteger(total) || total <= 0) return false;
    expectedItems = { boss_essence: total };
    expectedLedger = Object.entries(expectedCosts).filter(([, count]) => count > 0).map(([item, count]) => [item, -count]);
    expectedLedger.push(['boss_essence', total]);
  } else {
    const offer = BOSS_EXCHANGES[body.offer], currency = offer.currency || 'boss_essence';
    expectedCosts = { [currency]: offer.cost };
    if (body.offer === 'relic') {
      const equipment = saved.result.equipment;
      if (!plain(equipment) || typeof equipment.id !== 'string' || !/^x[a-f0-9]{11}$/i.test(equipment.id)
        || String(equipment.tg_id) !== tg || typeof equipment.name !== 'string' || !equipment.name
        || equipment.grade !== 'relic' || equipment.source !== 'boss_exchange' || !SLOTS.includes(equipment.slot)
        || !Number.isInteger(equipment.tier) || equipment.tier < 1 || equipment.tier > MAX_OPEN_MAP) return false;
      expectedItems = {};
      expectedLedger = [[currency, -offer.cost], ['equip:' + equipment.id, 1]];
    } else {
      expectedItems = { [offer.item]: offer.qty };
      expectedLedger = [[currency, -offer.cost], [offer.item, offer.qty]];
    }
  }
  if (!same(saved.costs, expectedCosts) || !same(saved.result.items, expectedItems) || ledger.length !== expectedLedger.length) return false;
  const expected = new Map(expectedLedger);
  if (new Set(ledger.map(entry => entry.item)).size !== expected.size) return false;
  return ledger.every(entry => entry.event_id === prefix + entry.item && entry.type === '首領精華兌換' && entry.created_at === row.created_at
    && entry.gold_delta === 0 && entry.exp_delta === 0 && expected.has(entry.item) && expected.get(entry.item) === entry.item_delta
    && (entry.item?.startsWith('equip:') ? entry.note === saved.result.equipment.name : true));
}

export async function exchangeRecord(env, tg, body, namespace = 'service', { scoped = true } = {}) {
  const tgId = String(tg), request = exchangeRequest(body.requestId, namespace);
  const signature = exchangeSignature(body, { scoped });
  const row = await env.DB.prepare(
    'SELECT type,item,item_delta,gold_delta,exp_delta,note,created_at FROM rpg_ledger WHERE event_id=? AND tg_id=?'
  ).bind('boss-exchange-receipt:' + tgId + ':' + request, tgId).first();
  const prefix = 'boss-exchange:' + tgId + ':' + request + ':';
  const ledger = (await env.DB.prepare(
    'SELECT event_id,type,item,item_delta,gold_delta,exp_delta,note,created_at FROM rpg_ledger ' +
    'WHERE tg_id=? AND event_id>=? AND event_id<? ORDER BY event_id'
  ).bind(tgId, prefix, prefix + '\uffff').all()).results || [];
  if (!row) return {
    found: false, result: null, receipt: null, signature,
    recoveryAllowed: !ledger.length && (!env.REALM_CONTEXT?.phase || env.REALM_CONTEXT.phase === 'ACTIVE'),
    ...(ledger.length ? { unverified: true, reason: 'legacy_receipt' } : {}),
  };
  let saved;
  try { saved = JSON.parse(row.note); } catch {}
  if (!plain(saved) || typeof saved.signature !== 'string')
    fail('boss_receipt_corrupt', '原兌換紀錄目前無法核對，請保留待核對狀態');
  if (saved.signature !== signature) fail('request_reused', '同一操作編號不能用於不同內容');
  if (!validSaved(saved, body, row, ledger, tgId, prefix))
    fail('boss_receipt_corrupt', '原兌換結果與帳務不相符，請保留待核對狀態');
  return {
    found: true, result: saved.result, signature, recoveryAllowed: false,
    receipt: { kind: 'exchange', version: 1, requestId: body.requestId, offer: body.offer, createdAt: row.created_at, costs: saved.costs },
  };
}

export async function view(env, tg, body = {}, now, namespace = 'service') {
  const { actor, context } = await actorContext(env, tg, now);
  if (body.kind === 'attack') {
    const record = await attackRecord(env, tg, body.bossId, body.win);
    const boss = await env.DB.prepare('SELECT started_at,ends_at,status,hp FROM rpg_boss_instances WHERE id=?').bind(body.bossId).first();
    const currentWin = boss ? Math.floor((now - boss.started_at) / BOSS.attackWindowMs) : null;
    const recoveryAllowed = !record.found && (!env.REALM_CONTEXT?.phase || env.REALM_CONTEXT.phase === 'ACTIVE')
      && !!boss && boss.status === 'active' && boss.hp > 0 && now >= boss.started_at && now < boss.ends_at
      && currentWin === body.win && !(actor.boss_down_until > now);
    return { ...context, kind: 'attack', bossId: body.bossId, win: body.win, ...record, currentWin, recoveryAllowed };
  }
  if (body.kind === 'exchange') return { ...context, kind: 'exchange', requestId: body.requestId, offer: body.offer, ...await exchangeRecord(env, tg, body, namespace) };
  input('首領紀錄種類無效');
}
