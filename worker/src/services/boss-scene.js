// A SELECT-only projection. Never call currentBoss, expireDue or withPlayer here.
import { loadPlayer } from '../db.js';
import { GameError } from '../game/classes.js';
import { BOSS, ITEMS } from '../game/constants.js';
import { BOSS_EXCHANGES } from '../game/boss-economy.js';
import { attackWindow, nextSlot } from '../game/boss.js';
import { taipeiDay, taipeiAt } from '../game/time.js';
import { bossView } from '../views.js';
import { idleStats } from '../game/stats.js';
import { canManageBackpackInParty, runningRingId } from './party-presence.js';
import { actorContext, bossIdentity } from './boss-receipt.js';

const reason = (code, message) => ({ code, message });
const frozenReason = () => reason('realm_read_only', '這個世界已停止接受新操作，目前僅供查看');

function sceneBossView(row, attackers, now) {
  const view = bossView(row, attackers, now);
  if (Array.isArray(view.result?.monsterMaterials)) view.result = { ...view.result, monsterMaterials: view.result.monsterMaterials.map(drop => ({ ...drop, itemName: ITEMS[drop.item]?.name || drop.item })) };
  return view;
}

function projectBoss(row, attackers, mine, char, readOnly, now) {
  if (!row) return null;
  const window = attackWindow(row, now), attacked = mine.some(hit => hit.win === window);
  const downUntil = char.boss_down_until > now ? char.boss_down_until : null;
  const expired = row.ends_at <= now;
  const blocked = readOnly ? frozenReason()
    : row.status !== 'active' || expired || row.hp <= 0 ? reason('boss_over', '這隻首領已經結束，請查看實際戰果')
    : now < row.started_at ? reason('boss_not_started', '這隻首領尚未開放攻擊')
    : downUntil ? reason('down', '你目前倒地，請等恢復後再攻擊')
    : attacked ? reason('cooldown', '這個時間窗已攻擊過，請等待下一個時間窗') : null;
  return {
    ...sceneBossView(row, attackers, now),
    expired,
    settlementPending: row.status === 'settling' || row.status === 'active' && (expired || row.hp <= 0),
    me: {
      hits: mine.length, damage: mine.reduce((total, hit) => total + hit.damage, 0),
      window, attackedThisWindow: attacked, downUntil,
      nextAttackAt: Math.max(attacked ? row.started_at + (window + 1) * BOSS.attackWindowMs : now, downUntil || 0),
      canAttack: blocked === null, reason: blocked,
      attacks: mine.map(hit => ({ win: hit.win, damage: hit.damage, createdAt: hit.created_at })),
    },
  };
}

export async function view(env, tg, body = {}, now) {
  const { context } = await actorContext(env, tg, now), db = env.DB, characterId = String(tg);
  const player = await loadPlayer(db, characterId, env);
  if (!player) throw new GameError('no_character', '找不到目前帳號的角色', 404);
  const { char, inv } = player;
  if (char.active_char_id && String(char.active_char_id) !== characterId)
    throw new GameError('character_changed', '角色已切換，請重新核對', 409);
  const phase = env.REALM_CONTEXT?.phase || 'ACTIVE', readOnly = phase !== 'ACTIVE';
  const selectedId = body.bossId == null ? null : bossIdentity(body.bossId);
  const recent = (await db.prepare('SELECT * FROM rpg_boss_instances ORDER BY started_at DESC,id DESC LIMIT 12').all()).results || [];
  const selected = selectedId
    ? recent.find(row => row.id === selectedId) || await db.prepare('SELECT * FROM rpg_boss_instances WHERE id=?').bind(selectedId).first()
    : recent[0] || null;
  if (selectedId && !selected) throw new GameError('no_boss', '首領不存在', 404);
  const attackers = selected ? (await db.prepare(
    'SELECT a.tg_id,c.name,SUM(a.damage) AS damage,COUNT(*) AS hits FROM rpg_boss_attacks a ' +
    'LEFT JOIN rpg_live_characters c ON c.tg_id=a.tg_id WHERE a.boss_id=? GROUP BY a.tg_id ORDER BY damage DESC,a.tg_id'
  ).bind(selected.id).all()).results || [] : [];
  const mine = selected ? (await db.prepare(
    'SELECT win,damage,created_at FROM rpg_boss_attacks WHERE boss_id=? AND tg_id=? ORDER BY win'
  ).bind(selected.id, characterId).all()).results || [] : [];
  const day = taipeiDay(now);
  const used = (await db.prepare(
    "SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key='boss_essence'"
  ).bind(context.accountId, day).first())?.n || 0;
  const ringId = char.party_id ? await runningRingId(db, characterId) : null;
  const blocked = readOnly ? frozenReason() : !canManageBackpackInParty(char, ringId)
    ? reason('party', '請先結束目前的組隊戰鬥；星環遠征期間可管理背包物品') : null;
  const offers = Object.entries(BOSS_EXCHANGES).map(([id, offer]) => {
    const currency = offer.currency || 'boss_essence', currencyName = ITEMS[currency]?.name || currency;
    const block = blocked || ((inv[currency] || 0) < offer.cost ? reason('insufficient', '需要 ' + offer.cost + ' ' + currencyName) : null);
    return {
      id, ...offer, currency, currencyName, item: offer.item || null,
      canExchange: block === null, reason: block,
    };
  });
  const materials = { mat_3: inv.mat_3 || 0, mat_4: inv.mat_4 || 0 };
  const reclaimed = materials.mat_3 * 12 + materials.mat_4 * 16;
  const legacyBlocked = blocked || (!reclaimed ? reason('material', '沒有可回收的三、四轉舊材料') : null);
  return {
    ...context, revision: Number(char.rev || 0), realmPhase: phase, readOnly,
    character: { id: characterId, name: char.name, level: char.level, baseClass: char.base_class, classPath: char.class_path, hp: char.hp, mp: char.mp, stats: idleStats(char, player.equipment.filter(item => item.is_equipped)) },
    boss: projectBoss(selected, attackers, mine, char, readOnly, now),
    history: recent.map(row => ({ ...sceneBossView(row, [], now), expired: row.ends_at <= now, selected: row.id === selected?.id })),
    schedule: { slotsTaipei: BOSS.slotsTaipei, attackWindowMs: BOSS.attackWindowMs, durationMs: BOSS.durationMs, next: nextSlot(now) },
    essence: {
      quantity: inv.boss_essence || 0, fragments: inv.relic_fragment || 0,
      daily: { accountId: context.accountId, day, used, limit: 4, remaining: Math.max(0, 4 - used), resetsAt: taipeiAt(taipeiDay(now + 86400000), 0) },
    },
    rules: { castsPerAttack: BOSS.castsPerAttack, downMs: BOSS.downMs, attackWindowMs: BOSS.attackWindowMs, essenceDailyLimit: 4, essenceRequiresDamage: true, essenceScope: 'account', essenceRecipient: 'contributing-character', legacyRates: { mat_3: 12, mat_4: 16 } },
    exchange: {
      offers, canOperate: blocked === null, blockedReason: blocked,
      legacy: {
        expectedMaterials: materials, essence: reclaimed, canExchange: legacyBlocked === null, reason: legacyBlocked,
        materials: ['mat_3', 'mat_4'].map(key => ({ key, name: ITEMS[key]?.name || key, quantity: materials[key], essenceEach: key === 'mat_3' ? 12 : 16 })),
      },
    },
  };
}
