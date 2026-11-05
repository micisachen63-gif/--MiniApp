// Synthetic in-memory SQLite tests. Private inputs/snapshots never enter persistent diagnostics.
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture as baseFixture, NOW, OWNER, snapshot, changes } from './fate-scene-fixture.js';
import * as Scene from '../src/services/fate-private-scene.js';
import * as Receipt from '../src/services/fate-private-receipt.js';
import * as Scoped from '../src/services/fate-private-scoped.js';
export { NOW, OWNER, changes };
export const publicBody = body => {
  const { birth, birthDate, ...safe } = body;
  return safe;
};
export const error = code => value => value?.code === code;
export async function fixture(t) {
  const f = await baseFixture(t), key = randomBytes(32); let sequence = 0;
  f.env.GROUP_CHAT_ID = '-10019861';
  f.digest = () => createHmac('sha256', key).update(JSON.stringify(snapshot(f.db))).digest('hex');
  f.privateScene = (body = {}, now = NOW, namespace = 'app') => Scene.view(f.env, body.selectedCharacterId || f.tg,
    { ...f.scope(), ...body }, now, namespace);
  f.profile = (body = {}, now = NOW, namespace = 'app') => Scene.profile(f.env, body.selectedCharacterId || f.tg,
    { ...f.scope(), ...body }, now, namespace);
  f.prepare = async (kind, fields = {}, now = NOW, tg = f.tg) => {
    const d = (await f.privateScene({ selectedCharacterId: tg }, now)).privateFate.domain, n = ++sequence;
    return { ...f.scope(tg), kind, requestId: 'f2-' + kind + '-' + String(n).padStart(6, '0'),
      intentNonce: n.toString(16).padStart(32, '0'), expected: { generation: d.generation, profile: d.profile, daily: d.daily },
      ...(kind === 'profile-save' ? { consent: true } : {}),
      ...(kind === 'birthday-start' ? { source: 'temporary', country: 'TW', showSign: false, socialInvite: false, day: d.daily.day } : {}),
      ...(kind === 'daily-sync' ? { day: d.daily.day } : {}), ...fields };
  };
  f.privateRun = (body, now = NOW, namespace = 'app') => Scoped.run(f.env, body.selectedCharacterId, body, now, namespace);
  f.privateRead = (body, now = NOW, namespace = 'app') => Receipt.view(f.env, body.selectedCharacterId, publicBody(body), now, namespace);
  f.cancel = (body, now = NOW, namespace = 'app') => Scoped.cancel(f.env, body.selectedCharacterId, publicBody(body), now, namespace);
  f.typedId = (body, namespace = 'app') => 'fate-private-receipt:' + body.selectedCharacterId + ':private:' + namespace + ':' + body.requestId;
  f.count = table => f.one('SELECT COUNT(*) n FROM ' + table).n;
  f.resources = () => JSON.stringify({
    characters: f.rows('SELECT tg_id,gold,exp FROM rpg_characters ORDER BY tg_id'),
    inventory: f.rows('SELECT * FROM rpg_inventory ORDER BY tg_id,item'),
    gifts: f.rows('SELECT * FROM rpg_fate_gifts ORDER BY id')
  });
  return f;
}
export async function readOnly(f, fn) {
  const before = f.digest(), n = changes(f.db), result = await fn();
  assert.equal(f.digest(), before, 'pure operation changed database contents');
  assert.equal(changes(f.db), n, 'pure operation performed writes');
  return result;
}
// Explicit unit evidence, NOT browser acceptance or real completed battles.
export function syntheticBoss(f, { id = 'synthetic-f2-boss', tg = f.tg, at = NOW + 1000,
  damage = 1, status = 'killed', group = f.env.GROUP_CHAT_ID, attackAt = at } = {}) {
  f.sql.prepare("INSERT INTO rpg_boss_instances(id,chat_id,map_id,name,base_hp,max_hp,hp,started_at,ends_at,status,settled_at) VALUES(?,?,1,'合成測試Boss',100,100,0,?,?,?,?)")
    .run(id, group, NOW, NOW + 86400000, status, at);
  f.sql.prepare('INSERT INTO rpg_boss_attacks(boss_id,tg_id,win,damage,created_at) VALUES(?,?,0,?,?)')
    .run(id, tg, damage, attackAt);
}
