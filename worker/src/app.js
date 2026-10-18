import {monsterMeta,monsterPool} from './game/monsters.js';
import {MONSTER_ART_REVISION,monsterArtCompatibility} from './game/monster-art-compatibility.js';
// Telegram Mini App API (/app/api/*). Auth = Telegram WebApp initData (HMAC with 小精靈's BOT_TOKEN, auth_date ≤ 24h).
// Development only (ENVIRONMENT=development + ALLOW_DEV_AUTH=true): X-Dev-Tg-Id header bypass for local smoke tests.
// The player id ALWAYS comes from the verified initData, never from the request body.
import { verifyInitData } from './auth.js';
import { GameError } from './game/classes.js';
import { CLASSES, CLASS_KEYS, MAPS, ITEMS, BOSS, SLOT_NAMES, WEAPON_KINDS, SLOT_CAPACITY, TRADE, PK, SHARE, UNBIND } from './game/constants.js';
import {THIEF_NODES,THIEF_RELEASE_READY,THIEF_CLASS} from './game/thief-data.js';
import { attackWindow } from './game/boss.js';
import { outboxStmt } from './db.js';
import * as B from './services/boss.js';
import * as T from './services/trade.js';
import * as P from './services/player.js';
import { history as exchangeHistory } from './services/market-exchange-history.js';
import { activeCharacterId, listAccountCharacters, selectAccountCharacter } from './accounts.js';
import {nodeFor} from './game/stats.js';
import {lineageNodes} from './game/lineage.js';

export const APP_ACTIONS = Object.freeze({
  'fate/social/preferences':'/rpg/fate/social/preferences','fate/social/preferences/save':'/rpg/fate/social/preferences/save',
  'fate/social/inbox':'/rpg/fate/social/inbox','fate/social/event':'/rpg/fate/social/event',
  'fate/social/reply':'/rpg/fate/social/reply','fate/social/decline':'/rpg/fate/social/decline','fate/social/withdraw':'/rpg/fate/social/withdraw',
  'fate/gifts/summary':'/rpg/fate/gifts/summary','fate/gifts/claim':'/rpg/fate/gifts/claim','fate/gifts/open':'/rpg/fate/gifts/open',
  'fate/me':'/rpg/fate/me','fate/state':'/rpg/fate/state','fate/history':'/rpg/fate/history',
  'fate/start':'/rpg/fate/start','fate/choice':'/rpg/fate/choice','fate/keep':'/rpg/fate/keep',
  'fate/daily':'/rpg/fate/daily','fate/profile':'/rpg/fate/profile',
  'fate/profile/save':'/rpg/fate/profile/save','fate/profile/delete':'/rpg/fate/profile/delete',
  'exchange/list':'/rpg/exchange/list','exchange/sellable':'/rpg/exchange/sellable','exchange/mine':'/rpg/exchange/mine',
  'exchange/create':'/rpg/exchange/create','exchange/cancel':'/rpg/exchange/cancel','exchange/buy':'/rpg/exchange/buy',
  'guardian/config':'/rpg/guardian/config','guardian/inventory':'/rpg/guardian/inventory',
  'guardian/shop/list':'/rpg/guardian/shop/list','guardian/shop/sell':'/rpg/guardian/shop/sell',
  'guardian/summon':'/rpg/guardian/summon','guardian/fuse':'/rpg/guardian/fuse',
  'guardian/activate':'/rpg/guardian/activate','guardian/lock':'/rpg/guardian/lock',
  'guardian/unbind':'/rpg/guardian/unbind','guardian/operation':'/rpg/guardian/operation','guardian/history':'/rpg/guardian/history',
  'guardian/share':'/rpg/guardian/share',
  'guardian/assist':'/rpg/guardian/assist',
  'guardian/auto/start':'/rpg/guardian/auto/start','guardian/auto/stop':'/rpg/guardian/auto/stop','guardian/auto/status':'/rpg/guardian/auto/status','guardian/auto/seen':'/rpg/guardian/auto/seen',
  journal:'/rpg/journal','journal/enroll':'/rpg/journal/enroll','journal/claim':'/rpg/journal/claim',
  'hall/list':'/rpg/hall/list','hall/get':'/rpg/hall/get',
  'auto-reroll/options':'/rpg/auto-reroll/options','auto-reroll/start':'/rpg/auto-reroll/start','auto-reroll/stop':'/rpg/auto-reroll/stop','auto-reroll/status':'/rpg/auto-reroll/status','background/status':'/rpg/background/status','background/dismiss':'/rpg/background/dismiss','background/notice-status':'/rpg/background/notice-status',
  'notice/dismiss':'/rpg/notice/dismiss','notice/status':'/rpg/notice/status',
  'auto-enhance/start':'/rpg/auto-enhance/start','auto-enhance/stop':'/rpg/auto-enhance/stop','auto-enhance/status':'/rpg/auto-enhance/status',
  'expedition/me':'/rpg/expedition/me','expedition/action':'/rpg/expedition/action','expedition/share':'/rpg/expedition/share','expedition/trade':'/rpg/expedition/trade',
  'party/list':'/rpg/party/list','party/create':'/rpg/party/create','party/action':'/rpg/party/action','party/reward':'/rpg/party/reward','party/get':'/rpg/party/get',
  'star-ring/list':'/rpg/star-ring/list','star-ring/me':'/rpg/star-ring/me','star-ring/get':'/rpg/star-ring/get',
  'star-ring/create':'/rpg/star-ring/create','star-ring/action':'/rpg/star-ring/action','star-ring/shop':'/rpg/star-ring/shop',

  'monster-exchange':'/rpg/monster-exchange',
  'collection/activate':'/rpg/collection/activate',
  'boss-exchange':'/rpg/boss-exchange',
  me: '/rpg/me', create: '/rpg/create', daily: '/rpg/daily', shop: '/rpg/shop', buy: '/rpg/buy', refill: '/rpg/refill',
  gacha: '/rpg/gacha', 'gacha/open': '/rpg/gacha/open', 'buy-gear': '/rpg/buy-gear', 'sell-gear': '/rpg/sell-gear', 'sell-gear-batch': '/rpg/sell-gear-batch', equip: '/rpg/equip', unequip: '/rpg/unequip', settings: '/rpg/settings', advance: '/rpg/advance',
  reselect: '/rpg/reselect', convert: '/rpg/convert', enhance: '/rpg/enhance', reroll: '/rpg/reroll', ledger: '/rpg/ledger',
  unbind: '/rpg/unbind', share: '/rpg/share', 'share/get': '/rpg/share/get',
  'trade/open': '/rpg/trade/open', 'trade/requests': '/rpg/trade/requests', 'trade/accept': '/rpg/trade/accept', 'trade/reject': '/rpg/trade/reject', 'trade/withdraw': '/rpg/trade/withdraw',
  'trade/get': '/rpg/trade/get', 'trade/list': '/rpg/trade/list', 'trade/log': '/rpg/trade/log', 'trade/gold': '/rpg/trade/gold',
  'trade/add': '/rpg/trade/add', 'trade/remove': '/rpg/trade/remove', 'trade/lock': '/rpg/trade/lock', 'trade/confirm': '/rpg/trade/confirm', 'trade/cancel': '/rpg/trade/cancel',
  'pk/challenge': '/rpg/pk/challenge', 'pk/accept': '/rpg/pk/accept', 'pk/decline': '/rpg/pk/decline', 'pk/get': '/rpg/pk/get', 'pk/list': '/rpg/pk/list',
});
export const APP_GRANT_MS = 24 * 3600e3;   // create pass issued by 小精靈 after its group-membership check
const devAuth = (env) => env.ENVIRONMENT === 'development' && String(env.ALLOW_DEV_AUTH) === 'true';

/** → { tgId, user } | { error, status } */
export async function appAuth(request, env, realNow = Date.now()) {
  const init = request.headers.get('X-Telegram-Init-Data');
  if (init) {
    if (!env.BOT_TOKEN) return { error: 'not_configured', status: 503 };
    const user = await verifyInitData(init, env.BOT_TOKEN, realNow);
    return user?.id ? { tgId: String(user.id), user } : { error: 'bad_init_data', status: 401 };
  }
  if (devAuth(env)) {
    const d = request.headers.get('X-Dev-Tg-Id');
    if (d && /^\d{1,20}$/.test(d)) return { tgId: d, user: { id: Number(d), first_name: `dev${d}` }, dev: true };
  }
  return { error: 'unauthorized', status: 401 };
}

export function metaView() {
  const thief = {releaseReady:THIEF_RELEASE_READY,guardianCategory:'melee',lineageNodes:Object.values(THIEF_NODES),
    attackSpeedMultiplier:THIEF_CLASS.attackSpeedMultiplier,hitAttackMultiplier:THIEF_CLASS.hitAttackMultiplier,
    traits:['極高攻速','脆皮'],speedModel:'deterministic-strikes-per-original-action'};
  const advancedSpecializations=Object.fromEntries(CLASS_KEYS.map(cls=>[cls,Object.fromEntries(['A1','A2','B1','B2'].flatMap(parent=>['1','2'].flatMap(suffix=>[parent+suffix,parent+suffix+'1',parent+suffix+'2'])).map(path=>{
    const node=nodeFor(cls,path);return [path,{name:node.name,skill:node.skill,passive:{text:node.passiveText},role:node.specialization?.role}];
  }))]));
  const classes = Object.fromEntries(Object.entries(CLASSES).filter(([key])=>CLASS_KEYS.includes(key)).map(([k, c]) => [k, {
    key: k, name: c.name, emoji: c.emoji, blurb: c.blurb, skill: c.node.skill, passive: c.node.passive.text,
    growth: { hp: c.hp, mp: c.mp, atk: c.atk, def: c.def }, releaseReady:c.releaseReady!==false,
    attackSpeedMultiplier:c.attackSpeedMultiplier??1,hitAttackMultiplier:c.hitAttackMultiplier??1,
    ...(k==='thief'?thief:{}),
    lineageNodes: lineageNodes(k),
    branches: Object.fromEntries(Object.entries(c.branches).map(([b, x]) => [b, { name: x.name, line: x.line, skill: x.skill, passive: x.passive.text, blurb: x.blurb, weapon: WEAPON_KINDS[x.weapon]?.type }])),
  }]));
  const maps = Object.fromEntries(Object.entries(MAPS).map(([k, m]) => [k, { id: m.id, name: m.name, emoji: m.emoji, min: m.min, max: m.max, monsters: monsterPool(m.id).map(x=>x.name), elite: m.elite, boss: m.boss.name }]));
  const items = Object.fromEntries(Object.entries(ITEMS).map(([k, i]) => [k, { name: i.name, emoji: i.emoji, kind: i.kind, desc: i.desc || null, tier: i.tier ?? null, heal: i.heal ?? null, price: i.price ?? null }]));
  return { classes, thief, maps, items, advancedSpecializations,monsterArtRevision:MONSTER_ART_REVISION, monsterExpansion:{...monsterMeta(),revision:MONSTER_ART_REVISION}, slots: SLOT_NAMES, slotCapacity: SLOT_CAPACITY, bossSlots: BOSS.slotsTaipei, attackWindowMinutes: BOSS.attackWindowMs / 60000,
    trade: { taxPct: TRADE.taxPct, maxGold: TRADE.maxGold, maxOpen: TRADE.maxOpenPerPlayer, idleMinutes: TRADE.idleMs / 60e3, requestHours: TRADE.requestTtlMs / 3600e3, tradeableItems: TRADE.tradeableItems },
    share: { dailyCap: SHARE.dailyCap, cooldownSec: SHARE.cooldownMs / 1000 }, unbind: UNBIND,
    pk: { minLevel: PK.minLevel, maxLevelGap: PK.maxLevelGap, dailyCap: PK.dailyCap, pairCooldownHours: PK.pairCooldownMs / 3600e3, challengeMinutes: PK.challengeTtlMs / 60e3, dropPct: PK.dropChance } };
}

async function bossFor(env, tg, now) {
  const boss = await B.currentBoss(env, now);
  if (!boss) return { boss: null };
  const rows = await env.DB.prepare('SELECT win, damage FROM rpg_boss_attacks WHERE boss_id = ? AND tg_id = ?').bind(boss.id, tg).all();
  const mine = rows.results || []; const win = attackWindow({ started_at: boss.startedAt }, now);
  const attacked = mine.some((r) => r.win === win);
  const ch = await env.DB.prepare('SELECT boss_down_until FROM rpg_characters WHERE tg_id = ?').bind(tg).first();
  const downUntil = ch?.boss_down_until && ch.boss_down_until > now ? ch.boss_down_until : null;
  const nextAt = attacked ? boss.startedAt + (win + 1) * BOSS.attackWindowMs : now;
  return { boss: { ...boss, me: { hits: mine.length, damage: mine.reduce((s, r) => s + r.damage, 0), attackedThisWindow: attacked, nextAttackAt: Math.max(nextAt, downUntil || 0), downUntil, hasCharacter: !!ch } }, now };
}

/** handles /app/api/<action>; `routes` = the service routes from index.js (same game logic, same D1 rows) */
export async function handleApp(request, env, url, { routes, json, fail, nowFor }) {
  if (request.method !== 'POST') return fail('method', 'POST only', 405);
  const auth = await appAuth(request, env);
  if (auth.error) return fail(auth.error, auth.error === 'not_configured' ? 'Mini App 尚未設定' : '請從 Telegram 星穹旅誌開啟遊戲', auth.status);
  let body = {};
  try { body = (await request.json()) || {}; } catch { return fail('bad_json', 'invalid JSON'); }
  const action = url.pathname.slice('/app/api/'.length); const now = nowFor(request, env); const tg = auth.tgId;
  if(['fate/gifts/claim','fate/gifts/open'].includes(action)&&!(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{6,64}$/.test(body.requestId)))return fail('request','需要有效的操作編號');
  if(['fate/start','fate/choice','fate/keep','fate/profile/save','fate/profile/delete'].includes(action)&&!(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{6,64}$/.test(body.requestId)))return fail('request','需要有效的操作編號');
  if(['guardian/summon','guardian/fuse','guardian/activate','guardian/lock','guardian/unbind','guardian/share','guardian/assist','guardian/shop/sell'].includes(action)&&!(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{6,64}$/.test(body.requestId)))return fail('request','需要有效的操作編號');
  const compatibility=monsterArtCompatibility(action,request.headers.get('X-Monster-Art-Revision'));
  if(compatibility)return fail(compatibility.error,compatibility.message,compatibility.status);
  const reqId = typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.requestId) ? `app:${body.requestId}` : `app:${crypto.randomUUID().replaceAll("-", "")}`;
  const safe = { ...body, tgId: tg, requestId: reqId };
  if(['exchange/create','exchange/cancel','exchange/buy'].includes(action)) {
    if(typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))return fail('request','需要有效的操作編號');
    // Preserve the client's UUID for committed-but-disconnected retries. Other
    // game actions retain their existing app: receipt namespace.
    safe.requestId=body.requestId.toLowerCase();
  }
  if (action === 'characters') return json({ ok: true, characters: await listAccountCharacters(env.DB, tg), maxCharacters: 4 });
  if (action === 'create' && !auth.dev) {
    const g = await env.DB.prepare('SELECT expires_at FROM rpg_app_access WHERE tg_id = ?').bind(tg).first();
    // The short-lived admission pass gates the first character only. Existing
    // membership comes from owned server rows, never a client-selected character ID.
    const established = await env.DB.prepare('SELECT 1 FROM rpg_characters WHERE account_tg_id=? LIMIT 1').bind(tg).first();
    if (!established && (!g || g.expires_at <= now)) return fail('no_pass', '首次建立角色，請先私訊 @StarJournalRpgBot 輸入 /rpg，再按「開啟旅誌」進入', 403);
  }
  if (action === 'create') safe.tgName = [auth.user?.first_name, auth.user?.last_name].filter(Boolean).join(' ') || auth.user?.username || null;
  if (action === 'create') {
    await P.createCharacter(env, { ...safe, tgId: tg }, now);
    return json({ ok: true, characters: await listAccountCharacters(env.DB, tg), maxCharacters: 4 });
  }
  if (action === 'select') {
    const charId = await selectAccountCharacter(env, tg, body.charId, now);
    const selected = await routes['POST /rpg/me'](env, { tgId: charId }, now);
    return json({ ...selected, characters: await listAccountCharacters(env.DB, tg), selected: charId });
  }
  safe.tgId = await activeCharacterId(env.DB, tg);
  if (body.selectedCharacterId && String(body.selectedCharacterId) !== String(safe.tgId))
    return fail('character_changed', '這個 Telegram 帳號已在另一個視窗切換角色，請重新選角後再操作', 409);
  if (action === 'exchange/history') return json(await exchangeHistory(env, safe.tgId, safe));
  if (auth.user?.username && action === 'me') await T.touchUsername(env, safe.tgId, auth.user.username).catch(() => null);
  if (action === 'pk/challenge') { safe.origin = 'app'; delete safe.chatId; safe.username = auth.user?.username || null; }
  if (action === 'players') {   // 決鬥 opponent picker: other characters (name, class, level) — no ids of non-players
    const q = String(body.q || '').trim().slice(0, 20);
    const rows = await env.DB.prepare(`SELECT tg_id, name, base_class, class_path, gender, level, tg_username FROM rpg_characters WHERE account_tg_id <> ? ${q ? 'AND (name LIKE ? OR tg_username LIKE ?)' : ''} ORDER BY updated_at DESC LIMIT 30`)
      .bind(...(q ? [tg, `%${q}%`, `%${q}%`] : [tg])).all();
    return json({ ok: true, players: (rows.results || []).map((r) => ({ tgId: r.tg_id, name: r.name, baseClass: r.base_class, classPath: r.class_path, gender: r.gender, level: r.level, username: r.tg_username })) });
  }
  if (action === 'meta') return json({ ok: true, meta: metaView(), dev: !!auth.dev });
  if (action === 'boss') return json({ ok: true, ...(await bossFor(env, safe.tgId, now)) });
  if (action === 'boss/attack') {
    const bossId = String(body.bossId || '');
    const character = safe.tgId;
    const r = await B.attackBoss(env, character, bossId, now);
    const win = attackWindow({ started_at: (await env.DB.prepare('SELECT started_at FROM rpg_boss_instances WHERE id = ?').bind(bossId).first())?.started_at || now }, now);
    // ask 小精靈 to refresh the group boss card (throttled on its side); a kill already queues boss_end
    if (!r.killed) await env.DB.batch([outboxStmt(env.DB, { dedupe: `boss_upd:${bossId}:${character}:${win}`, target: 'group', kind: 'boss_update', payload: { bossId } }, now)]);
    return json({ ok: true, result: r, ...(await bossFor(env, character, now)) });
  }
  const path = APP_ACTIONS[action]; if (!path) return fail('not_found', 'not found', 404);
  return json(await routes[`POST ${path}`](env, safe, now));
}
export { GameError };
