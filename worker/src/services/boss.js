import {bossCorePlan,materialPurposes} from '../game/monsters.js';
import {guardianEffect,groupGuardianChance,guardianLootWinner} from '../game/guardian-effects.js';
import {voucherGrantStmt} from './guardian-sigil.js';
import {essencePlan} from '../game/boss-economy.js';
// Scheduled group boss: spawn at fixed Taipei slots, attacks, kill settlement, expiry. All state in D1.
import { BOSS, MAPS, ITEMS, MAX_OPEN_MAP, GENERAL_WEAPON, CLASSES, SLOTS, SLOT_NAMES, RELIC, BLESSED_DROPS } from '../game/constants.js';
import { shareStmts } from './share.js';
import { slotFor, chooseTier, newBoss, attackWindow, performAttack, lootPlan, needsMaterial, relicPlan } from '../game/boss.js';
import { idleStats, classTier } from '../game/stats.js';
import { makeGear, makeRelic } from '../game/gear.js';
import { mapForLevel } from '../game/formulas.js';
import { taipeiDay } from '../game/time.js';
import { rngFor, mulberry32 } from '../game/rng.js';
import { GameError } from '../game/classes.js';
import { withPlayer, shortId } from './player.js';
import { guardStmt, outboxStmt, insertEquipStmt, ledgerStmt, invDeltaStmt, classifyDbError } from '../db.js';
import { bossView } from '../views.js';

async function allPlayers(db) {
  const [cs, inv] = await db.batch([
    db.prepare('SELECT tg_id, level, class_path, base_class FROM rpg_characters'),
    db.prepare("SELECT tg_id, item, quantity FROM rpg_inventory WHERE item LIKE 'mat_%' AND quantity > 0"),
  ]);
  const mats = new Map();
  for (const r of inv.results || []) { if (!mats.has(r.tg_id)) mats.set(r.tg_id, {}); mats.get(r.tg_id)[r.item] = r.quantity; }
  return (cs.results || []).map((c) => ({ ...c, inv: mats.get(c.tg_id) || {} }));
}

/** previous scheduled boss (any day), maps already spawned today, slots left today (this one included) */
export async function spawnContext(db, slot) {
  // Same context query, now retaining the latest name of each map across days.
  // SQLite's single MAX aggregate selects bare name from that maximum row.
  const previous = await db.prepare("SELECT map_id,name,MAX(started_at) AS last_at FROM rpg_boss_instances WHERE id LIKE 'b%' AND started_at < ? GROUP BY map_id ORDER BY last_at DESC").bind(slot.start).all();
  const prev=previous.results?.[0];
  const today = slot.day ? await db.prepare("SELECT DISTINCT map_id FROM rpg_boss_instances WHERE id LIKE ? AND started_at < ?").bind(`b${slot.day.replace(/-/g, '')}%`, slot.start).all() : { results: [] };
  const slotsLeft = slot.hour == null ? 1 : BOSS.slotsTaipei.filter((h) => h >= slot.hour).length;
  return { prevTier: prev?.map_id ?? null,lastBossNames:Object.fromEntries((previous.results||[]).map(r=>[r.map_id,r.name])), spawnedToday: (today.results || []).map((r) => r.map_id), slotsLeft };
}

/** idempotent: creates the boss for the current slot if none exists (cron + 小精靈 tick both call this) */
export async function spawnDue(env, now, { force = null } = {}) {
  const db = env.DB; const slot = force ? { id: `t${now}`, start: now, end: now + BOSS.durationMs } : slotFor(now);
  if (!slot) return { spawned: false, reason: 'no_slot' };
  if (!force) { const exists = await db.prepare('SELECT id FROM rpg_boss_instances WHERE id = ?').bind(slot.id).first(); if (exists) return { spawned: false, reason: 'exists', id: slot.id }; }
  const players = await allPlayers(db);
  if (!players.length && !force) return { spawned: false, reason: 'no_players' };
  const ctx = await spawnContext(db, slot);
  const choice = force?.tier ? { tier: force.tier, reason: 'manual' } : chooseTier(players, ctx, rngFor(`${slot.id}:pick`), MAX_OPEN_MAP);
  const boss = newBoss(slot, choice.tier, rngFor(slot.id), env.GROUP_CHAT_ID,{previousName:ctx.lastBossNames[choice.tier]});
  const r = await db.batch([
    db.prepare('INSERT OR IGNORE INTO rpg_boss_instances (id,chat_id,map_id,name,element,base_hp,max_hp,hp,participants,spawn_reason,started_at,ends_at,status) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)')
      .bind(boss.id, boss.chat_id, boss.map_id, boss.name, boss.element, boss.base_hp, boss.max_hp, boss.hp, choice.reason, boss.started_at, boss.ends_at, 'active'),
    outboxStmt(db, { dedupe: `boss_spawn:${boss.id}`, target: 'group', kind: 'boss_spawn', payload: { bossId: boss.id } }, now),
  ]);
  return { spawned: (r[0].meta?.changes ?? 1) > 0, id: boss.id, tier: choice.tier, reason: choice.reason, pending: choice.pending, prevTier: ctx?.prevTier ?? null };
}

export async function bossWithAttackers(db, id) {
  const boss = await db.prepare('SELECT * FROM rpg_boss_instances WHERE id = ?').bind(id).first(); if (!boss) return null;
  const a = await db.prepare('SELECT a.tg_id, c.name, SUM(a.damage) AS damage, COUNT(*) AS hits FROM rpg_boss_attacks a LEFT JOIN rpg_characters c ON c.tg_id = a.tg_id WHERE a.boss_id = ? GROUP BY a.tg_id ORDER BY damage DESC').bind(id).all();
  return { boss, attackers: a.results || [] };
}

/** active (or just-finished) boss for the group card */
export async function currentBoss(env, now) {
  await expireDue(env, now);
  const b = await env.DB.prepare("SELECT id FROM rpg_boss_instances WHERE status IN ('active','settling') ORDER BY started_at DESC LIMIT 1").first();
  if (!b) return null;
  const x = await bossWithAttackers(env.DB, b.id); return bossView(x.boss, x.attackers, now);
}
export async function bossById(env, id, now) { const x = await bossWithAttackers(env.DB, id); return x ? bossView(x.boss, x.attackers, now) : null; }

export async function expireDue(env, now) {
  const db = env.DB; const out = [];
  const due = await db.prepare("SELECT id, participants, hp FROM rpg_boss_instances WHERE status = 'active' AND ends_at <= ?").bind(now).all();
  for (const b of due.results || []) {
    if (b.hp <= 0) { out.push(await settleKill(env, b.id, now)); continue; }
    const status = b.participants > 0 ? 'fled' : 'vanished';
    const r = await db.batch([
      db.prepare("UPDATE rpg_boss_instances SET status = ?, settled_at = ? WHERE id = ? AND status = 'active'").bind(status, now, b.id),
      outboxStmt(db, { dedupe: `boss_end:${b.id}`, target: 'group', kind: 'boss_end', payload: { bossId: b.id, status } }, now),
    ]);
    out.push({ id: b.id, status, changed: r[0].meta?.changes });
  }
  const stuck = await db.prepare("SELECT id FROM rpg_boss_instances WHERE status = 'settling'").all();
  for (const b of stuck.results || []) out.push(await settleKill(env, b.id, now));
  return out;
}

export async function attackBoss(env, tgId, bossId, now) {
  const db = env.DB;
  const boss = await db.prepare('SELECT * FROM rpg_boss_instances WHERE id = ?').bind(bossId).first();
  if (!boss) throw new GameError('no_boss', '首領不存在', 404);
  if (boss.status !== 'active' || now >= boss.ends_at || boss.hp <= 0) { await expireDue(env, now); throw new GameError('boss_over', '這隻首領已經結束了'); }
  const win = attackWindow(boss, now); const per = MAPS[boss.map_id].boss.perPlayer;
  const done = await db.prepare('SELECT 1 FROM rpg_boss_attacks WHERE boss_id=? AND tg_id=? AND win=?').bind(bossId, String(tgId), win).first();
  if (done) {
    const nextAt = boss.started_at + (win + 1) * BOSS.attackWindowMs;
    throw new GameError('cooldown', `這 ${BOSS.attackWindowMs / 60000} 分鐘內已經攻擊過了，約 ${Math.max(1, Math.ceil((nextAt - now) / 60000))} 分鐘後再打`);
  }
  let outcome; let res;
  try { res = await withPlayer(env, tgId, now, (work) => {
    if (work.char.boss_down_until && work.char.boss_down_until > now) throw new GameError('down', `你倒地了，約 ${Math.ceil((work.char.boss_down_until - now) / 60000)} 分鐘後才能再攻擊`);
    const stats = idleStats(work.char, work.equipment.filter((e) => e.is_equipped));
    outcome = performAttack({ c: work.char, inv: work.inv, stats, boss, rng: rngFor(`${bossId}:${tgId}:${win}`), now });
    const tg = String(tgId);
    return { extra: [
      db.prepare(`UPDATE rpg_boss_instances SET
          max_hp = max_hp + CASE WHEN participants > 0 AND NOT EXISTS (SELECT 1 FROM rpg_boss_attacks WHERE boss_id = ?1 AND tg_id = ?2) THEN ?3 ELSE 0 END,
          hp = hp + CASE WHEN participants > 0 AND NOT EXISTS (SELECT 1 FROM rpg_boss_attacks WHERE boss_id = ?1 AND tg_id = ?2) THEN ?3 ELSE 0 END,
          participants = participants + CASE WHEN NOT EXISTS (SELECT 1 FROM rpg_boss_attacks WHERE boss_id = ?1 AND tg_id = ?2) THEN 1 ELSE 0 END
        WHERE id = ?1 AND status = 'active' AND ends_at > ?4 AND hp > 0`).bind(bossId, tg, per, now),
      guardStmt(db),
      db.prepare('INSERT INTO rpg_boss_attacks (boss_id,tg_id,win,damage,created_at) VALUES (?,?,?,?,?)').bind(bossId, tg, win, outcome.damage, now),
      ...(work.char.level>=15&&outcome.damage>0?[voucherGrantStmt(db,work.char,bossId,now)]:[]),
      db.prepare('UPDATE rpg_boss_instances SET hp = MAX(0, hp - ?) WHERE id = ?').bind(outcome.damage, bossId),
    ], result: outcome };
  }); } catch (e) {
    if (e?.code !== 'conflict') throw e;
    const b = await db.prepare('SELECT status, hp, ends_at FROM rpg_boss_instances WHERE id = ?').bind(bossId).first();
    if (b && (b.status !== 'active' || b.hp <= 0 || now >= b.ends_at)) throw new GameError('boss_over', '慢了一步，首領已經倒下／離開了');
    throw e;
  }
  const after = await db.prepare('SELECT hp, status FROM rpg_boss_instances WHERE id = ?').bind(bossId).first();
  let kill = null;
  if (after.hp <= 0 && after.status === 'active') kill = await settleKill(env, bossId, now);
  return { ...res.result, bossHp: after.hp, killed: after.hp <= 0, kill, hp: res.player.char.hp, mp: res.player.char.mp };
}

/** claim active→settling and distribute loot in ONE batch (idempotent via ledger event ids) */
export async function settleKill(env, bossId, now) {
  const db = env.DB;
  const claim = await db.prepare("UPDATE rpg_boss_instances SET status = 'settling' WHERE id = ? AND status = 'active' AND hp <= 0").bind(bossId).run();
  const boss = await db.prepare('SELECT * FROM rpg_boss_instances WHERE id = ?').bind(bossId).first();
  if (!boss || boss.status !== 'settling' || boss.hp > 0) return { id: bossId, status: boss?.status, claimed: false };
  void claim;
  const x = await bossWithAttackers(db, bossId); const day = taipeiDay(now);
  const ids = x.attackers.map((a) => String(a.tg_id));
  const chars = new Map(); const invs = new Map(); const counts = new Map();
  for (const id of ids) {
    const [c, inv, cnt, eq, guardian] = await db.batch([
      db.prepare('SELECT * FROM rpg_characters WHERE tg_id = ?').bind(id),
      db.prepare("SELECT item, quantity FROM rpg_inventory WHERE tg_id = ? AND (item LIKE 'mat_%' OR item LIKE 'hunt_%' OR item LIKE 'collection_%')").bind(id),
      db.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id = ? AND day = ? AND key = 'boss_loot'").bind(id, day),
      db.prepare('SELECT slot FROM rpg_equipment WHERE tg_id = ?').bind(id),
      db.prepare('SELECT * FROM rpg_guardian_sigils WHERE char_id=? AND active=1').bind(id),
    ]);
    c.results[0].guardian=guardianEffect(guardian.results?.[0],env);chars.set(id, c.results[0]); invs.set(id, Object.fromEntries((inv.results || []).map((r) => [r.item, r.quantity]))); counts.set(id, cnt.results?.[0]?.n || 0); void eq;
  }
  const attackers = x.attackers.map((a) => ({ tg_id: String(a.tg_id), name: a.name, damage: a.damage, char: chars.get(String(a.tg_id)), inv: invs.get(String(a.tg_id)), lootToday: counts.get(String(a.tg_id)) }));
  const rng = rngFor(`loot:${bossId}`); const plan = lootPlan(boss, attackers, rng); const t = boss.map_id; const mat = MAPS[t].boss.mat;
  const stmts = []; const result = { materials: [], gold: {}, gear: null, capped: plan.capped, damage: attackers.map((a) => ({ tgId: a.tg_id, name: a.name, damage: a.damage })) };
  for (const tg of plan.materials) {
    stmts.push(invDeltaStmt(db, tg, mat, 1), ledgerStmt(db, { event_id: `boss:${bossId}:${tg}:mat`, tg_id: tg, type: '首領掉落', item: mat, item_delta: 1, note: boss.name }, now));
    result.materials.push({ tgId: tg, name: chars.get(tg)?.name, item: mat, itemName: ITEMS[mat].name });
  }
  for (const [tg, g] of Object.entries(plan.gold)) {
    if (g > 0) stmts.push(db.prepare('UPDATE rpg_characters SET gold = gold + ? WHERE tg_id = ?').bind(g, tg), ledgerStmt(db, { event_id: `boss:${bossId}:${tg}:gold`, tg_id: tg, type: '首領金幣', gold_delta: g, note: boss.name }, now));
    result.gold[tg] = g;
  }
  if (plan.gear) {
    const c = chars.get(plan.gear); const tier = Math.min(t, mapForLevel(c.level), MAX_OPEN_MAP);
    const weapon = rng() < 0.5; const branch = classTier(c.class_path) >= 1 ? c.class_path[0] : null;
    const kind = weapon ? (branch && tier >= 2 ? CLASSES[c.base_class].branches[branch].weapon : GENERAL_WEAPON[c.base_class]) : null;
    const others = SLOTS.filter((x) => x !== 'weapon'); const slot = weapon ? 'weapon' : others[Math.floor(rng() * others.length)];
    const item = makeGear({ id: shortId(), tgId: plan.gear, cls: c.base_class, slot, kind, tier, rng: mulberry32(Math.floor(rng() * 2 ** 32)), now, source: 'boss', rarityFloor: 'advanced', bonusPct: BOSS.gearBonusPct, prefix: `${boss.name}的` });
    const shareId = `s${item.id}`.slice(0, 40);
    const gearShare = shareStmts(db, { id: shareId, owner: plan.gear, ownerChar: { ...c, tg_id: plan.gear }, equip: item, kind: 'share', context: { source: 'boss', boss: boss.name, map: MAPS[boss.map_id]?.name }, now, announce: false });
    stmts.push(insertEquipStmt(db, item), ledgerStmt(db, { event_id: `boss:${bossId}:${plan.gear}:gear`, tg_id: plan.gear, type: '首領裝備', item: `equip:${item.id}`, item_delta: 1, note: item.name }, now), ...gearShare.stmts);
    result.gear = { tgId: plan.gear, name: c.name, itemName: item.name, rarity: item.element_tier, shareId };
  }
  // v0.4 遺物: 35% chance of 1 relic, damage-weighted (+floor) among everyone who hit it; class of class-specific pieces is random
  const relicRng = rngFor(`relic:${bossId}`); result.relics = [];
  relicPlan(attackers.map((a) => ({ tg_id: a.tg_id, damage: a.damage,char:a.char, mult: plan.capped.includes(a.tg_id) ? RELIC.cappedMult : 1 })), relicRng).forEach((tg, i) => {
    const item = makeRelic({ id: `rb${bossId}${i}`.slice(0, 40), tgId: tg, tier: Math.min(t, MAX_OPEN_MAP), rng: mulberry32(Math.floor(relicRng() * 2 ** 32)), now, source: 'relic_boss' });
    stmts.push(insertEquipStmt(db, item), ledgerStmt(db, { event_id: `boss:${bossId}:relic:${i}`, tg_id: tg, type: '遺物掉落', item: `equip:${item.id}`, item_delta: 1, note: `${item.name}（${boss.name}）` }, now));
    const payload = { tgId: tg, name: chars.get(tg)?.name, item: item.name, slot: SLOT_NAMES[item.slot], classReq: item.class_req, className: CLASSES[item.class_req]?.name || '全職業', tier: item.tier, source: 'boss', boss: boss.name };
    // v0.5: group announcement = PHOTO post (rpg_shares kind 'relic', with 我要交易/超讚 while tradeable) instead of a text line
    const owner = chars.get(tg) || { tg_id: tg, base_class: item.class_req === 'any' ? 'sword' : item.class_req, class_path: '', level: 1 };
    stmts.push(...shareStmts(db, { id: `s${item.id}`.slice(0, 40), owner: tg, ownerChar: { ...owner, tg_id: tg }, equip: item, kind: 'relic', context: { source: 'boss', boss: boss.name, map: MAPS[boss.map_id]?.name }, now }).stmts,
      outboxStmt(db, { dedupe: `dm:${tg}:relic:${item.id}`, target: 'dm', tgId: tg, kind: 'relic', payload }, now));
    result.relics.push({ tgId: tg, name: chars.get(tg)?.name, itemName: item.name, slot: item.slot, classReq: item.class_req });
  });
  // Separate deterministic boss-loot RNG; each defeated boss may award one blessed scroll to a contributing player.
  result.blessedScrolls = [];
  const blessedRng = rngFor(`blessed:${bossId}`);
  const blessedPool = attackers.filter((a) => a.damage > 0 && !plan.capped.includes(a.tg_id));
  if (blessedPool.length && blessedRng() < groupGuardianChance(BLESSED_DROPS.bossChance,blessedPool)) {
    const winner = guardianLootWinner(blessedPool,blessedRng);
    const key = BLESSED_DROPS.keys[Math.floor(blessedRng() * BLESSED_DROPS.keys.length)];
    stmts.push(invDeltaStmt(db, winner.tg_id, key, 1), ledgerStmt(db, { event_id: `boss:${bossId}:${winner.tg_id}:blessed`, tg_id: winner.tg_id, type: '祝福卷軸掉落', item: key, item_delta: 1, note: boss.name }, now));
    stmts.push(outboxStmt(db, { dedupe: `boss:${bossId}:blessed`, target: 'group', kind: 'blessed_scroll', payload: { tgId: winner.tg_id, name: winner.name || chars.get(winner.tg_id)?.name, item: key, itemName: ITEMS[key].name, source: 'boss', boss: boss.name } }, now));
    result.blessedScrolls.push({ tgId: winner.tg_id, name: winner.name || chars.get(winner.tg_id)?.name, item: key, itemName: ITEMS[key].name });
  }
  result.monsterMaterials=bossCorePlan(boss,attackers);
  const coreCommits=[];
  for(const drop of result.monsterMaterials){
    const eventId=`boss:${bossId}:${drop.tgId}:hunt-core`,index=stmts.length;
    // Recheck current collection/material inventory inside the existing kill batch.
    // These keys/quantities come only from the static recipe catalogue, never request text.
    const conditions=materialPurposes(drop.item).map(p=>`(NOT EXISTS (SELECT 1 FROM rpg_inventory WHERE tg_id=?1 AND item='${p.collection}' AND quantity>0) AND COALESCE((SELECT quantity FROM rpg_inventory WHERE tg_id=?1 AND item='${p.item}'),0)<${p.qty})`).join(' OR ')||'0';
    stmts.push(db.prepare(`INSERT INTO rpg_inventory(tg_id,item,quantity) SELECT ?1,?2,?3 WHERE ${conditions} ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity`).bind(drop.tgId,drop.item,drop.qty),
      db.prepare('INSERT INTO rpg_ledger(event_id,tg_id,type,item,item_delta,note,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()>0').bind(eventId,drop.tgId,'首領收藏材料',drop.item,drop.qty,boss.name,now));
    coreCommits.push({drop,eventId,index});
  }
  for(const a of attackers){const account=String(a.char.account_tg_id||a.tg_id);a.essenceToday=(await db.prepare("SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key='boss_essence'").bind(account,day).first())?.n||0;}
  result.essences=essencePlan(t,attackers);
  for(const e of result.essences)stmts.push(db.prepare("INSERT INTO rpg_daily_counters(tg_id,day,key,n) VALUES(?,?,'boss_essence',1) ON CONFLICT(tg_id,day,key) DO UPDATE SET n=n+1 WHERE n<4").bind(e.account,day),guardStmt(db),invDeltaStmt(db,e.tgId,'boss_essence',e.qty),ledgerStmt(db,{event_id:'boss:'+bossId+':'+e.account+':essence',tg_id:e.tgId,type:'首領精華掉落',item:'boss_essence',item_delta:e.qty,note:boss.name},now));
  for (const a of attackers) stmts.push(db.prepare("INSERT INTO rpg_daily_counters (tg_id,day,key,n) VALUES (?,?,'boss_loot',1) ON CONFLICT(tg_id,day,key) DO UPDATE SET n = n + 1").bind(a.tg_id, day));
  if(coreCommits.length){
    const placeholders=coreCommits.map(()=>'?').join(',');
    stmts.push(db.prepare(`UPDATE rpg_boss_instances SET status='killed',settled_at=?,result_json=json_set(?,'$.monsterMaterials',json((SELECT json_group_array(json_object('tgId',tg_id,'item',item,'qty',item_delta)) FROM rpg_ledger WHERE event_id IN (${placeholders})))) WHERE id=? AND status='settling'`).bind(now,JSON.stringify(result),...coreCommits.map(c=>c.eventId),bossId));
  }else stmts.push(db.prepare("UPDATE rpg_boss_instances SET status = 'killed', settled_at = ?, result_json = ? WHERE id = ? AND status = 'settling'").bind(now, JSON.stringify(result), bossId));
  stmts.push(outboxStmt(db, { dedupe: `boss_end:${bossId}`, target: 'group', kind: 'boss_end', payload: { bossId, status: 'killed' } }, now));
  for (const m of result.materials) stmts.push(outboxStmt(db, { dedupe: `dm:${m.tgId}:mat:${bossId}`, target: 'dm', tgId: m.tgId, kind: 'material', payload: { item: m.itemName, boss: boss.name } }, now));
  try { const committed=await db.batch(stmts);result.monsterMaterials=coreCommits.filter(c=>(committed[c.index].meta?.changes||0)>0).map(c=>c.drop); }
  catch (e) {
    const g = classifyDbError(e);
    if (g?.code === 'duplicate') { await db.prepare("UPDATE rpg_boss_instances SET status = 'killed', settled_at = ? WHERE id = ? AND status = 'settling'").bind(now, bossId).run(); return { id: bossId, status: 'killed', duplicate: true }; }
    throw g || e;
  }
  return { id: bossId, status: 'killed', claimed: true, ...result };
}

export async function setBossMessage(env, bossId, chatId, messageId) {
  await env.DB.prepare('UPDATE rpg_boss_instances SET message_chat_id = ?, message_id = ? WHERE id = ?').bind(String(chatId), Number(messageId), bossId).run();
  return { ok: true };
}
