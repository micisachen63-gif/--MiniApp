import * as GUARDIAN_AUTO from './services/guardian-auto.js';
import {fatePublic} from './fate-public.js';
import * as REROLL_AUTO from './services/auto-reroll.js';
import * as BACKGROUND from './services/background-operations.js';
import {activateCollection} from './services/collection-blessings.js';
import {monsterExchange} from './services/monster-exchange.js';
import * as HALL from './services/hero-hall.js';
import {bossExchange} from './services/boss-exchange.js';
import * as SP from './services/special.js';
import * as PARTY from './services/party.js';
import * as JOURNAL from './services/journal.js';
import * as FATE_GIFTS from './services/fate-gifts.js';
import * as FATE from './services/fate.js';
import {isOpenTime as fateIsOpenTime} from '../public/fate/life.js';
import * as GUARDIAN from './services/guardian-sigil.js';
import * as GUARDIAN_SHOP from './services/guardian-shop.js';
import * as EXCHANGE from './services/market-exchange.js';
// elf-rpg-api — 小精靈 RPG 掛機冒險 Worker. /rpg/* = 小精靈 (X-Service-Secret); /app/api/* = Telegram Mini App (initData);
// static Mini App files come from public/ (Workers static assets). The Worker never calls Telegram itself.
import { GameError } from './game/classes.js';
import { checkServiceSecret } from './auth.js';
import { classifyDbError, invDeltaStmt, ledgerStmt } from './db.js';
import { playerView, shopView, equipmentView } from './views.js';
import { ITEMS } from './game/constants.js';
import * as P from './services/player.js';
import * as AUTO from './services/auto-enhance.js';
import * as NOTICES from './services/operation-notices.js';
export {AutoEnhanceRunner} from './auto-enhance-runner.js';
import * as B from './services/boss.js';
import * as T from './services/trade.js';
import * as SH from './services/share.js';
import * as PK from './services/pk.js';
import { handleApp, APP_GRANT_MS, metaView } from './app.js';
import { resolveActiveCharacterId } from './accounts.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (code, message, status = 400) => json({ ok: false, error: code, message }, status);
const devMode = (env) => env.ENVIRONMENT === 'development' && String(env.ALLOW_DEBUG_TIME) === 'true';
function nowFor(request, env) {
  const d = request.headers.get('X-Debug-Now');
  if (d && devMode(env)) { const n = Number(d); if (Number.isFinite(n) && n > 0) return n; }
  return Date.now();
}
const tgOf = (b) => { const t = String(b?.tgId ?? ''); if (!/^(?:\d{1,20}|c[\da-f]{32})$/i.test(t)) throw new GameError('tg', 'tgId 無效'); return t; };

async function me(env, tg, now, { summary = false } = {}) {
  const r = await P.withPlayer(env, tg, now);
  const [autoEnhance,guardianAuto,autoReroll,backgroundJobs,boss,badges] = await Promise.all([
    AUTO.view(env,tg),GUARDIAN_AUTO.view(env,tg),REROLL_AUTO.view(env,tg),BACKGROUND.list(env,tg),B.currentBoss(env,now),SH.pendingCounts(env,tg,now).catch(() => null)
  ]);
  return { ok: true, ...playerView(r.player, { now, report: r.report?.ticks ? r.report : null, compact:summary }), autoEnhance,guardianAuto,autoReroll,backgroundJobs, boss, badges };
}
function act(fn) {
  return async (env, body, now) => {
    const tg = tgOf(body);
    const r = await P.withPlayer(env, tg, now, (work, ctx) => fn(work, ctx, body));
    return { ok: true, result: r.result, ...playerView(r.player, { now, report: r.report?.ticks ? r.report : null }) };
  };
}

function tradeAct(fn) {
  return async (env, body, now) => { const tg = tgOf(body); const result = await fn(env, tg, body, now); return { ok: true, result, trade: await T.tradeView(env, String(body.tradeId), tg, now) }; };
}

const routes = {
  'POST /rpg/exchange/list':(env,b)=>EXCHANGE.list(env,tgOf(b),b),
  'POST /rpg/exchange/sellable':(env,b)=>EXCHANGE.sellable(env,tgOf(b),b),
  'POST /rpg/exchange/mine':(env,b)=>EXCHANGE.mine(env,tgOf(b),b),
  'POST /rpg/exchange/create':(env,b,now)=>EXCHANGE.create(env,tgOf(b),b,now),
  'POST /rpg/exchange/cancel':(env,b,now)=>EXCHANGE.cancel(env,tgOf(b),b,now),
  'POST /rpg/exchange/buy':(env,b,now)=>EXCHANGE.buy(env,tgOf(b),b,now),
  'POST /rpg/guardian/auto/start':async(env,b,now)=>{const r=await GUARDIAN_AUTO.start(env,tgOf(b),b,now);env.guardianAutoWake?.(r.job.id);return r;},
  'POST /rpg/guardian/auto/stop':(env,b,now)=>GUARDIAN_AUTO.stop(env,tgOf(b),b,now),
  'POST /rpg/guardian/auto/seen':(env,b,now)=>GUARDIAN_AUTO.seen(env,tgOf(b),b,now),
  'POST /rpg/guardian/auto/status':async(env,b)=>({ok:true,job:await GUARDIAN_AUTO.view(env,tgOf(b))}),
  'POST /rpg/guardian/config': (env)=>GUARDIAN.config(env),
  'POST /rpg/guardian/shop/list': (env,b)=>GUARDIAN_SHOP.list(env,tgOf(b),b),
  'POST /rpg/guardian/shop/sell': (env,b,now)=>GUARDIAN_SHOP.sell(env,tgOf(b),b,now),
  'POST /rpg/guardian/inventory': (env,b,now)=>GUARDIAN.inventory(env,tgOf(b),b,now),
  'POST /rpg/guardian/summon': (env,b,now)=>GUARDIAN.summon(env,tgOf(b),b,now),
  'POST /rpg/guardian/fuse': (env,b,now)=>GUARDIAN.fuse(env,tgOf(b),b,now),
  'POST /rpg/guardian/activate': (env,b,now)=>GUARDIAN.activate(env,tgOf(b),b,now),
  'POST /rpg/guardian/assist': (env,b,now)=>GUARDIAN.assist(env,tgOf(b),b,now),
  'POST /rpg/guardian/lock': (env,b,now)=>GUARDIAN.lock(env,tgOf(b),b,now),
  'POST /rpg/guardian/unbind': (env,b,now)=>GUARDIAN.unbind(env,tgOf(b),b,now),
  'POST /rpg/guardian/share': (env,b,now)=>GUARDIAN.share(env,tgOf(b),b,now),
  'POST /rpg/guardian/operation': (env,b)=>GUARDIAN.operation(env,tgOf(b),b),
  'POST /rpg/guardian/history': (env,b)=>GUARDIAN.history(env,tgOf(b),b),
  'POST /rpg/journal': (env,b,now)=>JOURNAL.view(env,tgOf(b),now),
  'POST /rpg/journal/enroll': (env,b,now)=>JOURNAL.enroll(env,tgOf(b),now),
  'POST /rpg/fate/me': (env,b,now)=>FATE.me(env,tgOf(b),now),
  'POST /rpg/fate/gifts/summary': (env,b)=>FATE_GIFTS.summary(env,tgOf(b)),
  'POST /rpg/fate/gifts/claim': (env,b,now)=>FATE_GIFTS.claim(env,tgOf(b),b,now),
  'POST /rpg/fate/gifts/open': (env,b,now)=>FATE_GIFTS.open(env,tgOf(b),b,now),
  'POST /rpg/fate/state': (env,b,now)=>FATE.state(env,tgOf(b),now),
  'POST /rpg/fate/history': (env,b,now)=>FATE.history(env,tgOf(b),b,now),
  'POST /rpg/fate/start': (env,b,now)=>FATE.start(env,tgOf(b),b,now),
  'POST /rpg/fate/choice': (env,b,now)=>FATE.choose(env,tgOf(b),b,now),
  'POST /rpg/fate/keep': (env,b,now)=>FATE.keep(env,tgOf(b),b,now),
  'POST /rpg/fate/daily': (env,b,now)=>FATE.daily(env,tgOf(b),now),
  'POST /rpg/fate/profile': async(env,b)=>({ok:true,profile:await FATE.profileView(env,tgOf(b))}),
  'POST /rpg/fate/profile/save': (env,b,now)=>FATE.saveProfile(env,tgOf(b),b,now),
  'POST /rpg/fate/profile/delete': (env,b,now)=>FATE.deleteProfile(env,tgOf(b),b,now),
  'POST /rpg/fate/notification': (env,b,now)=>FATE.notification(env,b,now),
  'POST /rpg/journal/claim': (env,b,now)=>JOURNAL.claim(env,tgOf(b),b,now),
  'POST /rpg/journal/checkin': (env,b,now)=>JOURNAL.checkin(env,tgOf(b),b,now),
  'POST /rpg/journal/card': (env,b)=>JOURNAL.card(env,b),
  'POST /rpg/journal/message': (env,b)=>JOURNAL.setCard(env,b),
  'POST /rpg/journal/publish': async(env,b,now)=>{await JOURNAL.queueCard(env,now);return {ok:true};},
  'POST /rpg/auto-enhance/start': async(env,b,now)=>{const r=await AUTO.start(env,tgOf(b),b,now);env.autoEnhanceWake?.(r.job.id);return r;},
  'POST /rpg/auto-enhance/stop': (env,b,now)=>AUTO.stop(env,tgOf(b),b,now),
  'POST /rpg/notice/dismiss': (env,b,now)=>NOTICES.dismiss(env,tgOf(b),b,now),
  'POST /rpg/notice/status': (env,b)=>NOTICES.status(env,tgOf(b),b),
  'POST /rpg/auto-reroll/options': (env,b)=>REROLL_AUTO.options(env,tgOf(b),b),
  'POST /rpg/auto-reroll/start': async(env,b,now)=>{const r=await REROLL_AUTO.start(env,tgOf(b),b,now);env.autoRerollWake?.(r.job.id);return r;},
  'POST /rpg/auto-reroll/stop': (env,b,now)=>REROLL_AUTO.stop(env,tgOf(b),b,now),
  'POST /rpg/auto-reroll/status': async(env,b)=>({ok:true,job:await REROLL_AUTO.view(env,tgOf(b))}),
  'POST /rpg/background/status': async(env,b)=>({ok:true,...await BACKGROUND.list(env,tgOf(b),{withBalance:true})}),
  'POST /rpg/background/dismiss': (env,b,now)=>BACKGROUND.dismiss(env,tgOf(b),b,now),
  'POST /rpg/background/notice-status': (env,b)=>BACKGROUND.status(env,tgOf(b),b),
  'POST /rpg/auto-enhance/status': async(env,b)=>({ok:true,job:await AUTO.view(env,tgOf(b))}),
  'POST /rpg/expedition/me': (env,b,now)=>SP.view(env,tgOf(b),now),
  'POST /rpg/expedition/action': (env,b,now)=>SP.action(env,tgOf(b),b,now),
  'POST /rpg/expedition/share': (env,b,now)=>SP.share(env,tgOf(b),b,now),
  'POST /rpg/expedition/trade': (env,b,now)=>SP.tradeBook(env,tgOf(b),b,now),
  'POST /rpg/party/list': (env,b,now)=>PARTY.list(env,tgOf(b),now),
  'POST /rpg/party/create': (env,b,now)=>PARTY.create(env,tgOf(b),b,now),
  'POST /rpg/party/action': (env,b,now)=>PARTY.action(env,tgOf(b),b,now),
  'POST /rpg/party/reward': (env,b,now)=>PARTY.reward(env,tgOf(b),b,now),
  'POST /rpg/party/get': async(env,b,now)=>({ok:true,party:await PARTY.view(env,String(b.partyId),b.tgId?tgOf(b):null,now,b.sinceTurnId)}),
  'POST /rpg/party/message': (env,b)=>PARTY.setMessage(env,b),
  'POST /rpg/party/tick': async(env,b,now)=>({ok:true,advanced:await PARTY.sweep(env,now)}),

  'POST /rpg/meta': () => ({ok:true,meta:metaView()}),
  'POST /rpg/me': (env, b, now) => me(env, tgOf(b), now, {summary:b.summary===true}),
  'POST /rpg/create': async (env, b, now) => { const tg = tgOf(b); await P.createCharacter(env, { ...b, tgId: tg }, now); return me(env, tg, now); },
  'POST /rpg/monster-exchange': act((w,c,b)=>monsterExchange(w,c,b)),
  'POST /rpg/collection/activate': act((w,c,b)=>activateCollection(w,c,b)),
  'POST /rpg/boss-exchange': act((w,c,b)=>bossExchange(w,c,b)),
  'POST /rpg/daily': act((w, c, b) => P.claimDaily(w, c, b.requestId)),
  'POST /rpg/shop': async (env, b, now) => { const r = await P.withPlayer(env, tgOf(b), now); return { ok: true, shop: shopView(r.player.char), ...playerView(r.player, { now }) }; },
  'POST /rpg/buy': act((w, c, b) => P.buyItem(w, c, { item: String(b.item), qty: Number(b.qty), requestId: b.requestId })),
  'POST /rpg/refill': act((w, c, b) => P.refill(w, c, { hours: 24, requestId: b.requestId })),
  'POST /rpg/buy-gear': act((w, c, b) => P.buyGear(w, c, { code: String(b.code), requestId: b.requestId })),
  'POST /rpg/gacha/open': act((w,c,b)=>P.openGacha(w,c,{type:String(b.type),requestId:b.requestId})),
  'POST /rpg/gacha': act((w, c, b) => P.buyGacha(w, c, { type: String(b.type), requestId: b.requestId })),
  'POST /rpg/sell-gear': act((w, c, b) => P.sellGear(w, c, { itemId: String(b.itemId), requestId: b.requestId })),
  'POST /rpg/sell-gear-batch': act((w, c, b) => P.sellGearBatch(w, c, { itemIds: b.itemIds, requestId: b.requestId })),
  'POST /rpg/equip': act((w, c, b) => P.equip(w, c, { itemId: String(b.itemId), position: b.position ?? null })),
  'POST /rpg/unequip': act((w, c, b) => P.unequip(w, c, { slot: b.slot ? String(b.slot) : null, position: b.position ?? null, itemId: b.itemId ? String(b.itemId) : null })),
  'POST /rpg/settings': act((w, c, b) => P.settings(w, c, b)),
  'POST /rpg/advance': act((w, c, b) => P.doAdvance(w, c, { branch: String(b.branch), requestId: b.requestId })),
  'POST /rpg/reselect': act((w, c, b) => P.doReselect(w, c, { tier: Number(b.tier || 1), branch: String(b.branch), requestId: b.requestId })),
  'POST /rpg/convert': act((w, c, b) => P.doConvert(w, c, { itemId: String(b.itemId) })),
  'POST /rpg/enhance': act((w, c, b) => P.doEnhance(w, c, { itemId: String(b.itemId), requestId: b.requestId, blessed: b.blessed === true, guaranteed:b.guaranteed===true })),
  'POST /rpg/reroll': act((w, c, b) => P.doReroll(w, c, { itemId: String(b.itemId), requestId: b.requestId,locks:b.locks||[] })),
  'POST /rpg/unbind': act((w, c, b) => P.doUnbind(w, c, { itemId: String(b.itemId), requestId: b.requestId })),
  // 小精靈 calls this after its isGroupMember check, right before showing the Mini App button to a player without a character
  'POST /rpg/app/grant': async (env, b, now) => { const tg = tgOf(b); const exp = now + APP_GRANT_MS;
    await env.DB.prepare('INSERT INTO rpg_app_access (tg_id, granted_at, expires_at) VALUES (?,?,?) ON CONFLICT(tg_id) DO UPDATE SET granted_at = excluded.granted_at, expires_at = excluded.expires_at').bind(tg, now, exp).run();
    return { ok: true, tgId: tg, expiresAt: exp }; },
  // ---- v0.5 分享至群組 / 超讚 / 我要交易 → owner 確認 → trade window (鎖定 → OK). Every trade response carries the fresh view
  'POST /rpg/share': async (env, b, now) => ({ ok: true, share: await SH.shareItem(env, { tgId: tgOf(b), equipId: String(b.equipId || '') }, now) }),
  'POST /rpg/share/get': async (env, b) => { const s = await SH.shareView(env, String(b.shareId)); if (!s) throw new GameError('not_found', '找不到這則分享', 404); return { ok: true, share: s }; },
  'POST /rpg/share/like': async (env, b, now) => ({ ok: true, ...(await SH.toggleLike(env, { tgId: tgOf(b), shareId: String(b.shareId) }, now)), share: await SH.shareView(env, String(b.shareId)) }),
  'POST /rpg/share/message': async (env, b) => SH.setShareMessage(env, String(b.shareId), b.chatId, b.messageId),
  'POST /rpg/trade/request': async (env, b, now) => { const tg = tgOf(b); await T.touchUsername(env, tg, b.username); return { ok: true, request: await SH.requestTrade(env, { tgId: tg, shareId: String(b.shareId) }, now) }; },
  'POST /rpg/trade/open': (env, b, now) => T.openWithEquip(env, { tgId: tgOf(b), target: b.target, equipId: b.equipId, requestId: b.requestId }, now),
  'POST /rpg/trade/requests': async (env, b, now) => ({ ok: true, ...(await SH.listRequests(env, tgOf(b), now)) }),
  'POST /rpg/trade/accept': async (env, b, now) => ({ ok: true, ...(await SH.acceptRequest(env, { tgId: tgOf(b), requestId: String(b.reqId || '') }, now)) }),
  'POST /rpg/trade/reject': async (env, b, now) => ({ ok: true, request: await SH.rejectRequest(env, { tgId: tgOf(b), requestId: String(b.reqId || '') }, now) }),
  'POST /rpg/trade/withdraw': async (env, b, now) => ({ ok: true, request: await SH.cancelRequest(env, { tgId: tgOf(b), requestId: String(b.reqId || '') }, now) }),
  'POST /rpg/trade/get': async (env, b, now) => { const t = await T.tradeView(env, String(b.tradeId), b.tgId ? tgOf(b) : null, now); if (!t) throw new GameError('not_found', '找不到這筆交易', 404); if (b.tgId && !t.me) throw new GameError('not_party', '你不是這筆交易的成員', 403); return { ok: true, trade: t }; },
  'POST /rpg/hall/list': async(env,b,now)=>HALL.list(env,now),
  'POST /rpg/hall/get': async(env,b,now)=>HALL.get(env,b.charId,now),
  'POST /rpg/trade/list': async (env, b, now) => ({ ok: true, ...(await T.listTrades(env, tgOf(b), now)) }),
  'POST /rpg/trade/log': async (env, b, now) => { const tg = tgOf(b); const t = await T.tradeView(env, String(b.tradeId), tg, now); if (!t?.me) throw new GameError('not_party', '你不是這筆交易的成員', 403); return { ok: true, log: await T.tradeLog(env, t.id) }; },
  'POST /rpg/trade/gold': tradeAct((env, tg, b, now) => T.setGold(env, { tgId: tg, tradeId: String(b.tradeId), gold: b.gold, requestId: b.requestId ?? null }, now)),
  'POST /rpg/trade/add': tradeAct((env, tg, b, now) => T.addLine(env, { tgId: tg, tradeId: String(b.tradeId), equipId: b.equipId ? String(b.equipId) : null, sigilId:b.sigilId?String(b.sigilId):null, item: b.item ? String(b.item) : null, qty: b.qty ?? 1, requestId: b.requestId ?? null }, now)),
  'POST /rpg/trade/remove': tradeAct((env, tg, b, now) => T.removeLine(env, { tgId: tg, tradeId: String(b.tradeId), equipId: b.equipId ? String(b.equipId) : null, sigilId:b.sigilId?String(b.sigilId):null, item: b.item ? String(b.item) : null, qty: b.qty ?? null, requestId: b.requestId ?? null }, now)),
  'POST /rpg/trade/lock': tradeAct((env, tg, b, now) => T.lock(env, { tgId: tg, tradeId: String(b.tradeId), requestId: b.requestId ?? null }, now)),
  'POST /rpg/trade/confirm': tradeAct((env, tg, b, now) => T.confirm(env, { tgId: tg, tradeId: String(b.tradeId), offerRev: b.offerRev ?? null, requestId: b.requestId ?? null }, now)),
  'POST /rpg/trade/cancel': tradeAct((env, tg, b, now) => T.cancel(env, { tgId: tg, tradeId: String(b.tradeId), requestId: b.requestId ?? null }, now)),
  // ---- v0.5 群組決鬥. target: { tgId } | { username } | { name }
  'POST /rpg/pk/challenge': async (env, b, now) => { const tg = tgOf(b); await T.touchUsername(env, tg, b.username); return { ok: true, pk: await PK.challenge(env, { tgId: tg, target: b.target || {}, origin: b.origin === 'group' ? 'group' : 'app', chatId: b.chatId ?? null }, now) }; },
  'POST /rpg/pk/accept': async (env, b, now) => ({ ok: true, pk: await PK.accept(env, { tgId: tgOf(b), pkId: String(b.pkId) }, now) }),
  'POST /rpg/pk/decline': async (env, b, now) => ({ ok: true, pk: await PK.decline(env, { tgId: tgOf(b), pkId: String(b.pkId) }, now) }),
  'POST /rpg/pk/get': async (env, b, now) => { const p = await PK.pkView(env, String(b.pkId), b.tgId ? tgOf(b) : null, now); if (!p) throw new GameError('not_found', '找不到這場決鬥', 404); return { ok: true, pk: p }; },
  'POST /rpg/pk/list': async (env, b, now) => ({ ok: true, ...(await PK.listPk(env, tgOf(b), now)) }),
  'POST /rpg/pk/message': async (env, b) => PK.setPkMessage(env, String(b.pkId), b.chatId, b.messageId),
  'POST /rpg/ledger': async (env, b) => ({ ok: true, ledger: await P.ledgerFor(env.DB, tgOf(b)) }),
  'POST /rpg/boss/current': async (env, b, now) => ({ ok: true, boss: await B.currentBoss(env, now) }),
  'POST /rpg/boss/get': async (env, b, now) => ({ ok: true, boss: await B.bossById(env, String(b.bossId), now) }),
  'POST /rpg/boss/attack': async (env, b, now) => { const r = await B.attackBoss(env, tgOf(b), String(b.bossId), now); return { ok: true, result: r, boss: await B.bossById(env, String(b.bossId), now) }; },
  'POST /rpg/boss/spawn-due': async (env, b, now) => ({ ok: true, spawn: await B.spawnDue(env, now), expired: await B.expireDue(env, now) }),
  'POST /rpg/boss/message': async (env, b) => B.setBossMessage(env, String(b.bossId), b.chatId, b.messageId),
  'POST /rpg/outbox/claim': (env, b, now) => claimOutbox(env, now, Math.max(1,Math.min(50, Math.trunc(Number(b.limit) || 20)))),
  'POST /rpg/outbox/ack': (env, b, now) => ackOutbox(env, b, now),
  'POST /rpg/outbox/fail': (env, b, now) => failOutbox(env,b,now),
  'POST /rpg/outbox/status': (env, b, now) => outboxStatus(env,now),
  'POST /rpg/admin/grant': adminGrant,
  'POST /rpg/dev/spawn-now': async (env, b, now) => { if (!devMode(env)) throw new GameError('forbidden', 'dev only', 403); return { ok: true, spawn: await B.spawnDue(env, now, { force: { tier: Number(b.tier) || 1 } }) }; },
  'POST /rpg/dev/cron': async (env, b, now) => { if (!devMode(env)) throw new GameError('forbidden', 'dev only', 403); return { ok: true, cron: await runCron(env, now) }; },
};

async function claimOutbox(env, now, limit) {
  const db = env.DB;
  const claimToken = crypto.randomUUID();
  // party_card is rendered from the party's current state, so older unclaimed cards of the same party are superseded by the newest one.
  await db.prepare(`UPDATE rpg_outbox SET delivered_at = ?, last_error = 'superseded' WHERE kind = 'party_card' AND delivered_at IS NULL AND failed_at IS NULL AND claimed_at IS NULL AND id < (SELECT MAX(o2.id) FROM rpg_outbox o2 WHERE o2.kind = 'party_card' AND o2.delivered_at IS NULL AND o2.failed_at IS NULL AND json_extract(o2.payload_json,'$.partyId') = json_extract(rpg_outbox.payload_json,'$.partyId'))`).bind(now).run();
  const rows = await db.prepare(`UPDATE rpg_outbox SET claimed_at = ?, claim_token = ?, claim_attempts = claim_attempts + 1
    WHERE id IN (SELECT id FROM rpg_outbox WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= ? AND (claimed_at IS NULL OR claimed_at <= ?) AND (?=1 OR kind<>'fate_event') ORDER BY id LIMIT ?)
    RETURNING id, target, tg_id, kind, payload_json`).bind(now, claimToken, now, now - 60_000, fateIsOpenTime(now)?1:0, limit).all();
  const items = [];
  for (const r of (rows.results || []).sort((a, b) => a.id - b.id)) {
    try {
    const payload = r.payload_json ? JSON.parse(r.payload_json) : {};
    if (payload.bossId) {
      payload.boss = await B.bossById(env, payload.bossId, now);
      const gearShareId = payload.boss?.result?.gear?.shareId;
      if (gearShareId) payload.boss.result.gear.share = await SH.shareView(env, gearShareId);
    }
    if (payload.tradeId) payload.trade = await T.tradeView(env, String(payload.tradeId), null, now);
    if (payload.shareId) payload.share = await SH.shareView(env, String(payload.shareId));
    if (payload.partyId) payload.party=await PARTY.view(env,String(payload.partyId),null,now);
    if (payload.pkId) payload.pk = await PK.pkView(env, String(payload.pkId), null, now);
    if(r.target==='dm'&&!payload.recipientCharId&&(payload.trade||payload.pk)){
      const sides=payload.trade||payload.pk;
      const recipient=await db.prepare('SELECT tg_id FROM rpg_characters WHERE account_tg_id=? AND tg_id IN (?,?) LIMIT 1').bind(String(r.tg_id),String(sides.a.tgId),String(sides.b.tgId)).first();
      if(recipient)payload.recipientCharId=recipient.tg_id;
    }
    if (payload.requestId && r.kind.startsWith('trade_re')) payload.request = await SH.requestView(env, await env.DB.prepare('SELECT * FROM rpg_trade_requests WHERE id = ?').bind(String(payload.requestId)).first());
    items.push({ id: r.id, target: r.target, tgId: r.tg_id, kind: r.kind, payload, claimToken });
    } catch(e) {
      await failOutbox(env,{ids:[r.id],claimToken,errorCode:0,error:'通知資料讀取失敗：'+String(e?.message||e)},now);
    }
  }
  return { ok: true, items, groupChatId: env.GROUP_CHAT_ID };
}

function outboxSelection(body, code) {
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number))];
  const token = String(body.claimToken || '');
  if (!ids.length || ids.length > 50 || ids.some((id) => !Number.isSafeInteger(id) || id < 1) || !/^[\da-f-]{36}$/i.test(token))
    throw new GameError(code, '通知回報格式無效');
  return {ids,token,marks:ids.map(() => '?').join(',')};
}
async function ackOutbox(env, body, now) {
  const {ids,token,marks} = outboxSelection(body,'outbox_ack');
  const result = await env.DB.prepare(`UPDATE rpg_outbox SET delivered_at = ?, claim_token = NULL
    WHERE delivered_at IS NULL AND failed_at IS NULL AND claim_token = ? AND id IN (${marks})`).bind(now, token, ...ids).run();
  return { ok: true, delivered: result.meta?.changes || 0 };
}
async function failOutbox(env,body,now) {
  const {ids,token,marks} = outboxSelection(body,'outbox_fail');
  const status = Number(body.errorCode),code = Number.isInteger(status)&&status>=0&&status<=599 ? status : 0;
  const message = String(body.error||'通知傳送失敗').replace(/\d{8,12}:[A-Za-z0-9_-]{30,}/g,'[redacted]').slice(0,240);
  const retryAfter = Math.min(3600,Math.max(0,Number(body.retryAfterSeconds)||0))*1000;
  const result=await env.DB.prepare(`UPDATE rpg_outbox SET
    failed_at=CASE WHEN ?=403 OR claim_attempts>=8 THEN ? ELSE NULL END,
    next_attempt_at=CASE WHEN ?=403 OR claim_attempts>=8 THEN 0 ELSE ?+MAX(?,MIN(3600000,30000*(1 << MIN(7,MAX(0,claim_attempts-1))))) END,
    claimed_at=NULL,claim_token=NULL,last_error_code=?,last_error=?
    WHERE delivered_at IS NULL AND failed_at IS NULL AND claim_token=? AND id IN (${marks})
    RETURNING id,failed_at,next_attempt_at,claim_attempts`).bind(code,now,code,now,retryAfter,code,message,token,...ids).all();
  const rows=result.results||[];
  return {ok:true,failed:rows.filter(r=>r.failed_at!==null).length,retrying:rows.filter(r=>r.failed_at===null).length};
}
async function outboxStatus(env,now) {
  const row=await env.DB.prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
    SUM(CASE WHEN failed_at IS NOT NULL THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN delivered_at IS NULL AND failed_at IS NULL THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at<=? AND (claimed_at IS NULL OR claimed_at<=?) THEN 1 ELSE 0 END) AS ready,
    MIN(CASE WHEN delivered_at IS NULL AND failed_at IS NULL THEN created_at END) AS oldestPendingAt
    FROM rpg_outbox`).bind(now,now-60000).first();
  return {ok:true,outbox:{...row,total:row.total||0,delivered:row.delivered||0,failed:row.failed||0,pending:row.pending||0,ready:row.ready||0}};
}

/** 小精靈 only forwards this for internal-group admins (isGroupAdmin); audited + idempotent */
async function adminGrant(env, b, now) {
  const db = env.DB; const tg = tgOf(b); const admin = String(b.adminTgId || ''); const gold = Math.trunc(Number(b.gold) || 0);
  const item = b.item ? String(b.item) : null; const qty = Math.trunc(Number(b.qty) || 0);
  if (!/^\d+$/.test(admin)) throw new GameError('admin', 'adminTgId 無效');
  if (!b.requestId) throw new GameError('request', '需要 requestId');
  if (gold < 0 || gold > 1_000_000 || (item && (!ITEMS[item] || qty < 1 || qty > 999)) || (!gold && !item)) throw new GameError('grant', '發放內容無效');
  const exists = await db.prepare('SELECT 1 FROM rpg_characters WHERE tg_id = ?').bind(tg).first(); if (!exists) throw new GameError('no_character', '對方還沒有角色', 404);
  const eid = `admin:${b.requestId}`;
  const stmts = [ledgerStmt(db, { event_id: eid, tg_id: tg, type: '管理員發放', gold_delta: gold, item, item_delta: item ? qty : 0, note: String(b.reason || '').slice(0, 100) }, now),
    db.prepare('INSERT INTO rpg_admin_audit (id, admin_tg_id, action, details, created_at) VALUES (?,?,?,?,?)').bind(eid, admin, 'grant', JSON.stringify({ tg, gold, item, qty, reason: b.reason || null }), now)];
  if (gold) stmts.push(db.prepare('UPDATE rpg_characters SET gold = gold + ? WHERE tg_id = ?').bind(gold, tg));
  if (item) stmts.push(invDeltaStmt(db, tg, item, qty));
  await db.batch(stmts);
  return { ok: true, granted: { tgId: tg, gold, item, qty } };
}

/** every 30 min: spawn at slot hours, expire at :30, settle each account's selected character, prune */
export async function runCron(env, now) {
  await JOURNAL.queueCard(env,now);
  await PARTY.sweep(env,now);
  const out = { spawn: await B.spawnDue(env, now), expired: await B.expireDue(env, now), tradesExpired: await T.expireDue(env, now).catch((e) => { console.error('trade expire', e?.message); return -1; }),
    requestsExpired: await SH.expireRequests(env, now).catch(() => -1), pkExpired: await PK.expirePk(env, now).catch(() => -1), settled: 0, errors: 0 };
  const rows = await env.DB.prepare(`SELECT c.tg_id FROM rpg_characters c
    JOIN rpg_accounts a ON a.active_char_id = c.tg_id AND a.account_tg_id = c.account_tg_id
    WHERE c.last_settle_at < ? ORDER BY c.last_settle_at LIMIT 300`).bind(now - 60_000).all();
  for (const r of rows.results || []) {
    try { await P.withPlayer(env, r.tg_id, now, null, { source: 'cron' }); out.settled += 1; } catch (e) { out.errors += 1; console.error('settle', r.tg_id, e?.message); }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rpg_outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?').bind(now - 7 * 86_400_000),
    env.DB.prepare('DELETE FROM rpg_outbox WHERE failed_at IS NOT NULL AND failed_at < ?').bind(now - 30 * 86_400_000),
    env.DB.prepare('DELETE FROM rpg_idle_reports WHERE created_at < ?').bind(now - 14 * 86_400_000),
  ]);
  return out;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const publicStory=fatePublic(request);if(publicStory)return publicStory;
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'elf-rpg-api' });
  if (url.pathname.startsWith('/app/api/')) {
    try { return await handleApp(request, env, url, { routes, json, fail, nowFor }); }
    catch (e) { return errorResponse(e, url); }
  }
  const auth = checkServiceSecret(request, env); if (!auth.ok) return fail(auth.error, auth.error, auth.status);
  const route = routes[`${request.method} ${url.pathname}`]; if (!route) return fail('not_found', 'not found', 404);
  let body = {};
  try { body = request.method === 'POST' ? await request.json() : {}; } catch { return fail('bad_json', 'invalid JSON'); }
  const now = nowFor(request, env);
  try {
    const routeBody = body || {};
    if (routeBody.tgId && !['/rpg/create', '/rpg/app/grant'].includes(url.pathname))
      routeBody.tgId = await resolveActiveCharacterId(env.DB, tgOf(routeBody));
    return json(await route(env, routeBody, now));
  }
  catch (e) { return errorResponse(e, url); }
}
function errorResponse(e, url) {
  {
    const g = e instanceof GameError ? e : classifyDbError(e);
    if (g) {
      if (g.cause) console.error('classified database error', url.pathname, g.code, g.cause?.message || g.cause);
      return fail(g.code, g.message, g.status || 400);
    }
    console.error('rpg error', url.pathname, e?.stack || e);
    return fail('internal', '系統忙碌，請稍後再試', 500);
  }
}

export default {
  fetch: (request, env, ctx) => handle(request, {...env,autoRerollWake:id=>ctx?.waitUntil(REROLL_AUTO.wake(env,id).catch(e=>console.error('auto reroll start',e.message))),guardianAutoWake:id=>ctx?.waitUntil(GUARDIAN_AUTO.wake(env,id).catch(e=>console.error('guardian auto start',e.message))),autoEnhanceWake:id=>ctx?.waitUntil(AUTO.wake(env,id).catch(e=>console.error('auto start',e.message)))}),
  scheduled: (event, env, ctx) => ctx.waitUntil(event.cron==='* * * * *' ? Promise.all([AUTO.sweep(env,event.scheduledTime),GUARDIAN_AUTO.sweep(env,event.scheduledTime),REROLL_AUTO.sweep(env,event.scheduledTime),FATE.sweep(env,event.scheduledTime)]) : runCron(env, event.scheduledTime).then((r) => console.log('cron', JSON.stringify(r)))),
};
void equipmentView;
