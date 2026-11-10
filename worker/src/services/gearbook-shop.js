import { GameError } from '../game/classes.js';
import { makeGear } from '../game/gear.js';
import { mulberry32 } from '../game/rng.js';
import { modeForLevel } from '../game/endgame.js';
import { findGearbookShopRequirement, gearbookShopOffer, GEARBOOK_SHOP_VERSION } from '../game/gearbook-shop.js';
import { shortId } from './player.js';
import { withPlayer } from './player.js';
import { loadPlayer, guardStmt, classifyDbError, ledgerStmt } from '../db.js';

const fail = (message, code = 'gearbook_shop', status = 409) => { throw new GameError(code, message, status); };
const owner = p => p.char.account_tg_id || p.char.tg_id;
const activityReason = char => char.atlas_run_id ? '星圖派遣結束後才能兌換' : char.party_id ? '組隊或遠征結束後才能兌換' : null;

async function dustOf(db, charId) {
  return (await db.prepare('SELECT dust FROM rpg_equipment_recovery_balances WHERE char_id=?').bind(charId).first())?.dust || 0;
}

function receiptId(account, requestId) {
  return 'gearbook-shop:' + account + ':' + requestId;
}

function signatureOf(charId, collectionId, requirementId) {
  return JSON.stringify({ charId, collectionId, requirementId, version: GEARBOOK_SHOP_VERSION });
}

async function replay(db, account, requestId, signature) {
  const row = await db.prepare('SELECT note FROM rpg_ledger WHERE event_id=?').bind(receiptId(account, requestId)).first();
  if (!row) return null;
  let payload; try { payload = JSON.parse(row.note); } catch { fail('兌換收據損壞', 'request_reused'); }
  if (payload.signature !== signature) fail('操作編號已用於其他兌換', 'request_reused');
  return payload.result;
}

export async function offersFor(env, player, now) {
  const dust = await dustOf(env.DB, player.char.tg_id);
  const locked = activityReason(player.char);
  return { gold: player.char.gold || 0, dust, lockedReason: locked };
}

export function attachShopOffers(catalogView, char, { gold, dust, lockedReason }) {
  const completed = new Set(catalogView.collections.filter(c => c.completed).map(c => c.id));
  return catalogView.collections.map(c => ({
    ...c,
    requirements: c.requirements.map(r => ({
      ...r,
      shop: gearbookShopOffer(c, r, {
        gold, dust, level: char.level,
        registered: !!r.registered, lockedReason,
      }),
    })),
  }));
}

export async function preview(env, charId, body, now) {
  const p = await loadPlayer(env.DB, charId, env);
  if (!p) fail('請先選擇角色', 'no_character', 404);
  const found = findGearbookShopRequirement(p.char.base_class, body.collectionId, body.requirementId);
  if (!found?.cost) fail('找不到這個收藏欄位');
  const filled = await env.DB.prepare('SELECT 1 FROM rpg_equipment_collection_entries WHERE char_id=? AND collection_id=? AND requirement_id=?').bind(charId, found.collection.id, found.requirement.id).first();
  const wallet = await offersFor(env, p, now);
  const offer = gearbookShopOffer(found.collection, found.requirement, { ...wallet, level: p.char.level, registered: !!filled, lockedReason: wallet.lockedReason });
  if (offer.blockedReason) fail(offer.blockedReason);
  return { ok: true, realmId: env.REALM_CONTEXT?.id || 'permanent', characterId: charId, collectionName: found.collection.name, ...offer, warning: '兌換的裝備為綁定、未強化的收藏用裝備，可以穿戴但不可交易。收錄前仍需自行強化到需求值。', now };
}

export async function buy(env, charId, body, now) {
  if (!/^[A-Za-z0-9_:-]{6,96}$/.test(body.requestId || '')) fail('需要有效操作編號', 'request', 400);
  const p = await loadPlayer(env.DB, charId, env);
  if (!p) fail('請先選擇角色', 'no_character', 404);
  const found = findGearbookShopRequirement(p.char.base_class, body.collectionId, body.requirementId);
  if (!found?.cost) fail('找不到這個收藏欄位');
  const account = owner(p), signature = signatureOf(charId, found.collection.id, found.requirement.id);
  const previous = await replay(env.DB, account, body.requestId, signature);
  if (previous) return { ok: true, realmId: env.REALM_CONTEXT?.id || 'permanent', characterId: charId, result: previous, replayed: true, now };
  let result;
  try {
    await withPlayer(env, charId, now, async (work, ctx) => {
      if (work.char.active_char_id && String(work.char.active_char_id) !== String(charId)) fail('角色已切換', 'character_changed');
      const busy = activityReason(work.char); if (busy) fail(busy);
      const filled = await ctx.db.prepare('SELECT 1 FROM rpg_equipment_collection_entries WHERE char_id=? AND collection_id=? AND requirement_id=?').bind(charId, found.collection.id, found.requirement.id).first();
      if (filled) fail('此收藏欄位已填入');
      if (work.char.level < found.collection.minLevel) fail(`需要 Lv.${found.collection.minLevel} 才能兌換`);
      const dust = await dustOf(ctx.db, charId);
      if ((work.char.gold || 0) < found.cost.gold) fail(`金幣不足（需要 ${found.cost.gold.toLocaleString()}）`, 'gold');
      if (dust < found.cost.dust) fail(`精煉塵不足（需要 ${found.cost.dust}）`, 'dust');
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const item = makeGear({
        id: 'gb' + shortId(), tgId: String(charId), cls: work.char.base_class,
        slot: found.requirement.slot, kind: found.requirement.kind, tier: found.requirement.tier,
        rng: mulberry32(seed), now, source: 'gearbook_shop', forceRarity: found.requirement.minRarity,
        mode: modeForLevel(work.char.level).id,
      });
      item.bound = 1;
      item.enhance_level = 0;
      work.char.gold -= found.cost.gold;
      work.equipment.push(item);
      result = {
        collectionId: found.collection.id, requirementId: found.requirement.id,
        itemId: item.id, name: item.name, tier: item.tier, rarity: found.requirement.minRarity,
        gold: found.cost.gold, dust: found.cost.dust, bound: true, enhance: 0,
      };
      const note = JSON.stringify({ signature, result, version: GEARBOOK_SHOP_VERSION });
      const extra = [
        ctx.db.prepare('INSERT INTO rpg_equipment_recovery_balances(char_id,dust,updated_at) VALUES(?,0,?) ON CONFLICT(char_id) DO UPDATE SET dust=dust,rev=rev+1,updated_at=excluded.updated_at').bind(charId, now),
        ctx.db.prepare('UPDATE rpg_equipment_recovery_balances SET dust=dust-?,rev=rev+1,updated_at=? WHERE char_id=? AND dust>=?').bind(found.cost.dust, now, charId, found.cost.dust),
        guardStmt(ctx.db),
      ];
      return {
        extra,
        ledger: [
          { event_id: receiptId(account, body.requestId), tg_id: charId, type: '收藏兌換裝備', gold_delta: -found.cost.gold, item: 'recovery_dust', item_delta: -found.cost.dust, note },
          { event_id: receiptId(account, body.requestId) + ':equip', tg_id: charId, type: '收藏兌換裝備入帳', item: 'equip:' + item.id, item_delta: 1, note: item.name },
        ],
        result,
      };
    });
  } catch (error) {
    const saved = await replay(env.DB, account, body.requestId, signature);
    if (saved) return { ok: true, realmId: env.REALM_CONTEXT?.id || 'permanent', characterId: charId, result: saved, replayed: true, now };
    throw classifyDbError(error) || error;
  }
  return { ok: true, realmId: env.REALM_CONTEXT?.id || 'permanent', characterId: charId, result, now };
}
