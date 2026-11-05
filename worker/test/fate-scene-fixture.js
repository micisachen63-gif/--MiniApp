// Synthetic local SQLite input only. Never used as browser acceptance evidence.
import { freshDb } from './d1-shim.js';
import { createCharacter } from '../src/services/player.js';
import * as Scene from '../src/services/fate-scene.js';
import * as Scoped from '../src/services/fate-scoped.js';
import * as Receipt from '../src/services/fate-receipt.js';
import * as Fate from '../src/services/fate.js';
import { createLife, advanceLife, LIFE_MS, lifeSchedule } from '../public/fate/life.js';

export const NOW = Date.parse('2026-11-05T06:00:00+08:00'), OWNER = '19861';
export const changes = db => db.sqlite.prepare('SELECT total_changes() n').get().n;
export const snapshot = db => Object.fromEntries(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, JSON.stringify(db.sqlite.prepare('SELECT * FROM "' + name + '"').all().map(row => JSON.stringify(row)).sort())]));
export const typedId = (body, namespace = 'app') =>
  'fate-scene-receipt:' + body.selectedCharacterId + ':scene:' + namespace + ':' + body.requestId;
export async function fixture(t) {
  const db = freshDb(); t.after(() => db.sqlite.close());
  const env = { DB: db, REALM_CONTEXT: { id: 'permanent', phase: 'ACTIVE' } };
  const created = await createCharacter(env, { tgId: OWNER, name: '命運整合測甲', baseClass: 'mage', gender: 'f' }, NOW);
  const f = { db, sql: db.sqlite, env, tg: created.char.tg_id, sequence: 0 };
  f.scope = (tg = f.tg) => ({ realmId: env.REALM_CONTEXT.id, selectedCharacterId: tg });
  f.body = (kind, fields = {}, requestId = 'fate-' + kind + '-test-' + String(++f.sequence).padStart(6, '0'), tg = f.tg) =>
    ({ ...f.scope(tg), kind, requestId, ...(kind === 'start' ? { mode: 'random', country: 'TW', showSign: true, socialInvite: false } : {}), ...fields });
  f.run = (body, now = NOW, namespace = 'app') => Scoped.run(env, body.selectedCharacterId, body, now, namespace);
  f.read = (body, now = NOW, namespace = 'app') => Receipt.view(env, body.selectedCharacterId, body, now, namespace);
  f.scene = (body = {}, now = NOW, namespace = 'app') => Scene.view(env, f.tg, { ...f.scope(), ...body }, now, namespace);
  f.one = (sql, ...values) => db.sqlite.prepare(sql).get(...values);
  f.rows = (sql, ...values) => db.sqlite.prepare(sql).all(...values);
  f.qty = item => f.one('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?', f.tg, item)?.quantity || 0;
  f.active = tg => db.sqlite.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(tg, OWNER);
  f.addActor = async (name = '命運另一角') => {
    const c = await createCharacter(env, { tgId: OWNER, name, baseClass: 'sword', gender: 'm' }, NOW);
    return c.char.tg_id;
  };
  f.firstChoice = id => {
    const row = f.one('SELECT * FROM rpg_fate_lives WHERE id=?', id), draft = JSON.parse(row.state_json);
    return { row, draft, at: lifeSchedule(row.started_at, draft)[0] };
  };
  return f;
}
export async function completeOriginal(f, count, { start = NOW, country = 'TW' } = {}) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const now = start + i * LIFE_MS, result = await f.run(f.body('start', { country }), now);
    await Fate.sweep(f.env, now + LIFE_MS);
    results.push(result);
  }
  return results;
}
export function syntheticCompletedHistory(f, count, tg = f.tg) {
  // Explicit historical test input for pagination/large-cap/rollback boundaries.
  // This is not a committed operation, a receipt, or browser lifecycle evidence.
  const insert = f.sql.prepare("INSERT INTO rpg_fate_lives(id,char_id,account_id,state_json,status,started_at,completed_at,next_at,code,rev) VALUES(?,?,?,?,'complete',?,?,?,?,1)");
  for (let i = 0; i < count; i++) {
    const at = NOW - (count - i) * 86400000, raw = createLife({ version: 3, orbit: 0, seed: (i + 1).toString(16).padStart(8, '0'), startedAt: at }),
      done = advanceLife(raw, at + LIFE_MS);
    insert.run('synthetic-history-' + tg + '-' + i, tg, OWNER, JSON.stringify(done.draft), at, done.endAt, done.endAt, done.code);
  }
}
