import {autoBluePct as getAutoBluePct} from '../game/auto-blue.js';
import {affixCost} from '../game/affixes.js';
// Player actions: every action = load → settle idle to now → apply → persist ONE atomic batch.
import { CLASSES, CLASS_KEYS, GENERAL_WEAPON, ITEMS, POTIONS, MAX_OPEN_MAP, RARITY_KEYS } from '../game/constants.js';
import { settleIdle, emptyReport, autoResume, applyExp, refillPlan, supplyHours } from '../game/idle.js';
import { idleStats, computeStats } from '../game/stats.js';
import { advance, reselect, GameError } from '../game/classes.js';
import { checkItemPurchase, drawGacha } from '../game/shop.js';
import { findOffer, makeGear, canEquip, convertWeapon, equipPosition, capacity, gearSellPrice, gearSellBlock } from '../game/gear.js';
import { dailyGoldFor } from '../game/daily.js';
import { mapForLevel } from '../game/formulas.js';
import { taipeiDay } from '../game/time.js';
import { mulberry32 } from '../game/rng.js';
import { enhance, reroll } from '../game/enhance.js';
import { ENHANCE, RARITIES, SLOT_NAMES, CLASSES as CLS } from '../game/constants.js';
import { shareStmts } from './share.js';
import { unbindCost, unbindBlock } from '../game/share.js';
import { loadPlayer, clonePlayer, persistStatements, classifyDbError, outboxStmt, insertEquipStmt, ledgerStmt, ledgerBatchStmts, invDeltaStmt } from '../db.js';

export const shortId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const rngDefault = () => mulberry32((crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0);
const eventId = (type, tg, requestId) => `${type}:${tg}:${requestId || crypto.randomUUID()}`;
const equippedOf = (p) => p.equipment.filter((e) => e.is_equipped);

// Compare actual persisted values, not combat ticks: party timestamps, midnight
// counters and actions can change state without awarding a single combat tick.
const JSON_FIELDS = new Set(['special_json','drops_today','affixes_json','affix_json','bonus_json']);
function comparable(value, key = '') {
  if (JSON_FIELDS.has(key) && typeof value === 'string') {
    try { value = JSON.parse(value); } catch {}
  }
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(x => comparable(x));
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k,comparable(value[k],k)]));
  return value;
}
function playerChanged(before, after) {
  const ignored = new Set(['rev','updated_at','active_char_id']);
  if (rowChanged(before.char,after.char,ignored)) return true;
  for (const key of new Set([...Object.keys(before.inv),...Object.keys(after.inv)])) if ((before.inv[key] || 0) !== (after.inv[key] || 0)) return true;
  if (before.equipment.length !== after.equipment.length) return true;
  const old = new Map(before.equipment.map(e => [e.id,e]));
  return after.equipment.some(e => !old.has(e.id) || rowChanged(old.get(e.id),e));
}
function rowChanged(before, after, ignored = new Set()) {
  for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    if (ignored.has(key) || before[key] === after[key]) continue;
    if (JSON.stringify(comparable(before[key],key)) !== JSON.stringify(comparable(after[key],key))) return true;
  }
  return false;
}
function settleSelectedPlayer(player, now) {
  const active = player.char.active_char_id;
  if (active && String(active) !== String(player.char.tg_id)) {
    const char = {...player.char,last_settle_at:Math.max(now,player.char.last_settle_at)};
    const report = emptyReport(player.char.last_settle_at,char.last_settle_at);
    report.end_state = char.idle_state;
    return {char,inv:{...player.inv},report,events:[]};
  }
  return settleIdle(player.char,player.inv,equippedOf(player),now);
}

function reportStatements(db, tg, report, now) {
  if (!report?.ticks) return [];
  return [db.prepare('INSERT INTO rpg_idle_reports (tg_id,from_at,to_at,ticks,skipped_ticks,kills,exp_gained,exp_lost,deaths,elites,gold_gained,used_json,drops_json,levels_gained,end_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(String(tg), report.from_at, report.to_at, report.ticks, report.skipped_ticks, report.kills, report.exp_gained, report.exp_lost, report.deaths, report.elites, report.gold_gained, JSON.stringify(report.used), JSON.stringify(report.drops || {}), report.levels_gained, report.end_state, now),
    ...(report.guardianStoneGoldSpent>0?[ledgerStmt(db,{event_id:`guardian-stone-auto:${tg}:${report.from_at}`,tg_id:tg,type:'召喚石自動補給',gold_delta:-report.guardianStoneGoldSpent,item:'guardian_summon_stone',item_delta:report.guardianStonesBought,note:'玩家已勾選自動購買；僅在所選天使需要下一顆召喚石時補購'},now)]:[]),
    // v0.5.1: idle gold goes through the ledger too — one row per settlement window (from_at = previous last_settle_at, so a retry
    // or a racing cron/app settle of the same window hits the UNIQUE event_id and the whole batch (incl. the gold UPDATE) is rejected)
    ...(report.gold_gained > 0 ? [ledgerStmt(db, { event_id: `idle:${tg}:${report.from_at}`, tg_id: tg, type: '掛機打怪', gold_delta: report.gold_gained, note: JSON.stringify({ kills: report.kills, killGold: report.gold_kills || 0, eliteGold: report.gold_elites || 0, ticks: report.ticks }) }, now)] : [])];
}
function notifyStatements(db, char, events, now, { cron = false, inv = {}, equipment = [] } = {}) {
  if (!cron) return [];
  const tg = String(char.tg_id); const day = taipeiDay(now); const out = [];
  for (const e of events) {
    // deaths: one DM per EXP penalty / ward use (≤3+wards a day) and at most one per day for free deaths (newbie / daily cap)
    if (e.type === 'death') out.push(outboxStmt(db, { dedupe: ['penalty', 'ward'].includes(e.reason) ? `dm:${tg}:death:${e.at}` : `dm:${tg}:death:${taipeiDay(e.at)}:free`, target: 'dm', tgId: tg, kind: 'death', payload: e }, now));
    if (e.type === 'town_no_red') out.push(outboxStmt(db, { dedupe: `dm:${tg}:town:${day}`, target: 'dm', tgId: tg, kind: 'town_no_red', payload: e }, now));
    if (e.type === 'gate') out.push(outboxStmt(db, { dedupe: `dm:${tg}:gate:${e.level}`, target: 'dm', tgId: tg, kind: 'gate', payload: e }, now));
  }
  if (char.idle_state === 'fighting' || char.idle_state === 'no_mp') {
    const s = supplyHours(char, inv, equipment.filter((x) => x.is_equipped));
    if (s.red < 1 || s.blue < 1) out.push(outboxStmt(db, { dedupe: `dm:${tg}:low:${day}`, target: 'dm', tgId: tg, kind: 'low_supply', payload: { redHours: s.red, blueHours: s.blue } }, now));
  }
  return out;
}

/** 遺物 drops from idle elites → group announcement (阿卡西記憶大廳) + a DM, regardless of who triggered the settlement */
export function relicStatements(db, char, events, now, equipment = []) {
  const out = [], eliteReceipts = []; const tg = String(char.tg_id);
  for (const e of events) if (e.type === 'blessed_scroll') {
    out.push(ledgerStmt(db, { event_id: `blessed:elite:${tg}:${e.at}`, tg_id: tg, type: '祝福卷軸掉落', item: e.key, item_delta: 1, note: `${ITEMS[e.key].name}（${e.elite}）` }, now));
    out.push(outboxStmt(db, { dedupe: `blessed:elite:${tg}:${e.at}`, target: 'group', kind: 'blessed_scroll', payload: { tgId: tg, name: char.name, item: e.key, itemName: ITEMS[e.key].name, source: 'elite', elite: e.elite, map: e.map } }, now));
  } else if (e.type === 'elite_gear') {
    const item = equipment.find((x) => x.id === e.item.id);
    // 紅裝以上（supreme 霸主 或 relic 遺物）才推播通知群組，綠裝/藍裝/紫裝靜默入背包
    if (item && (item.grade === 'relic' || item.element_tier === 'supreme')) {
      out.push(...shareStmts(db, { id: `s${item.id}`.slice(0, 40), owner: tg, ownerChar: char, equip: item, kind: 'share', context: { source: 'elite', elite: e.elite, map: e.map }, now }).stmts);
    }
    eliteReceipts.push({ event_id: `elite-gear:${e.item.id}`, tg_id: tg, type: '菁英掉落', item: `equip:${e.item.id}`, item_delta: 1, note: `${e.item.name}（${e.elite}）` });
  } else if (e.type === 'relic') {
    const payload = { tgId: tg, name: char.name, item: e.item.name, slot: SLOT_NAMES[e.item.slot], classReq: e.item.classReq, className: CLS[e.item.classReq]?.name || '全職業', tier: e.item.tier, source: 'elite', elite: e.elite, map: e.map };
    const item = equipment.find((x) => x.id === e.item.id);
    if (item) out.push(...shareStmts(db, { id: `s${item.id}`.slice(0, 40), owner: tg, ownerChar: char, equip: item, kind: 'relic', context: { source: 'elite', elite: e.elite, map: e.map }, now }).stmts);
    out.push(outboxStmt(db, { dedupe: `dm:${tg}:relic:${e.item.id}`, target: 'dm', tgId: tg, kind: 'relic', payload }, now));
    out.push(ledgerStmt(db, { event_id: `relic:${e.item.id}`, tg_id: tg, type: '遺物掉落', item: `equip:${e.item.id}`, item_delta: 1, note: `${e.item.name}（${e.elite}）` }, now));
  }
  return [...out, ...ledgerBatchStmts(db, eliteReceipts, now)];
}
/**
 * Core wrapper. fn(work, ctx) mutates `work` (a settled copy) and may return { ledger, extra, result }.
 * A GameError from fn still persists the idle settlement, then is re-thrown.
 */
export async function withPlayer(env, tgId, now, fn = null, { source = 'player', attempts = 3 } = {}) {
  const db = env.DB;
  for (let attempt = 1; ; attempt++) {
    const loaded = await loadPlayer(db, tgId, env);
    if (!loaded) throw new GameError('no_character', '你還沒有角色，私訊星穹旅誌輸入 /rpg 開始冒險', 404);
    const s = settleSelectedPlayer(loaded, now);
    const settledGear = [...(s.report.relics || []), ...(s.report.eliteGear || [])];
    const settled = { char: s.char, inv: s.inv, equipment: [...loaded.equipment.map((e) => ({ ...e })), ...settledGear.filter((r) => !loaded.equipment.some((e) => e.id === r.id))] };
    const work = clonePlayer(settled);
    let out = null, gameErr = null;
    if (fn) { try { const locks=await db.prepare("SELECT item_id FROM rpg_auto_enhance WHERE tg_id=? AND status='running' UNION SELECT item_id FROM rpg_auto_reroll WHERE tg_id=? AND status='running'").bind(String(tgId),String(tgId)).all();out = (await fn(work, { now, db, report: s.report, events: s.events,lockedEquipment:(locks.results||[]).map(x=>x.item_id) })) || {}; } catch (e) { if (e instanceof GameError) gameErr = e; else throw e; } }
    const final = gameErr ? settled : work;
    const extra = [...reportStatements(db, tgId, s.report, now), ...notifyStatements(db, final.char, s.events, now, { cron: source === 'cron', inv: final.inv, equipment: final.equipment }), ...relicStatements(db, final.char, s.events, now, final.equipment), ...(gameErr ? [] : out?.extra || [])];
    const ledger = gameErr ? [] : out?.ledger || [];
    try {
      if (playerChanged(loaded,final) || ledger.length || extra.length) {
        await db.batch(persistStatements(db, loaded, final, { ledger, extra, batchEquipmentDeletes: !gameErr && out?.batchEquipmentDeletes === true }, now));
        final.char.rev = Number(loaded.char.rev || 0) + 1;
        final.char.updated_at = now;
      }
    }
    catch (e) {
      const g = classifyDbError(e);
      if (g?.code === 'conflict' && attempt < attempts) continue;
      throw g || e;
    }
    if (gameErr) throw gameErr;
    return { player: final, report: s.report, events: s.events, result: out?.result ?? null };
  }
}

const NAME_RE = /^[\p{L}\p{N}_]{2,12}$/u;
export async function createCharacter(env, { tgId, tgName = null, name, gender, baseClass, charSlot = null, requestId = null }, now, rng = rngDefault()) {
  const db = env.DB; const account = String(tgId || '');
  if (!/^\d{1,20}$/.test(account)) throw new GameError('tg', 'Telegram ID 無效');
  name = String(name || '').trim();
  if (!NAME_RE.test(name)) throw new GameError('name', '角色名要 2–12 個字，只能用中文、英文、數字或底線');
  if (!['m', 'f'].includes(gender)) throw new GameError('gender', '請選擇性別');
  if (!CLASS_KEYS.includes(baseClass)) throw new GameError('class', '請選擇職業');
  const requestedSlot = charSlot == null ? null : Number(charSlot);
  if (requestedSlot != null && (!Number.isInteger(requestedSlot) || requestedSlot < 1 || requestedSlot > 4)) throw new GameError('character_slot', '角色欄位無效');
  const receiptId=requestId?eventId('character-create',account,requestId):null;
  const signature=JSON.stringify({name,gender,baseClass,charSlot:requestedSlot});
  const recover=async()=>{
    if(!receiptId)return null;
    const receipt=await db.prepare('SELECT tg_id,note FROM rpg_ledger WHERE event_id=?').bind(receiptId).first();
    if(!receipt)return null;
    const saved=JSON.parse(receipt.note);
    if(saved.signature!==signature)throw new GameError('request_reused','這次創角編號已使用，請重新選擇角色資料',409);
    const p=await loadPlayer(db,receipt.tg_id,env);
    if(!p||String(p.char.account_tg_id)!==account)throw new GameError('character_changed','角色資料已改變，請重新選角',409);
    return p;
  };
  const previous=await recover();if(previous)return previous;
  const owned = await db.prepare('SELECT tg_id, char_slot FROM rpg_characters WHERE account_tg_id = ? ORDER BY char_slot').bind(account).all();
  const characters = owned.results || [];
  if (characters.length >= 4) throw new GameError('character_limit', '每個 Telegram 帳號最多建立 4 隻角色');
  const usedSlots = new Set(characters.map((r) => Number(r.char_slot)));
  if (requestedSlot != null && usedSlots.has(requestedSlot)) throw new GameError('slot_taken', '這個角色欄位已被使用，請重新選擇');
  const slot = requestedSlot || [1, 2, 3, 4].find((n) => !usedSlots.has(n));
  // Keep the original Telegram ID as the first character's key for backward compatibility.
  // Additional characters receive opaque internal IDs; account_tg_id remains the Telegram identity.
  const tg = characters.length ? `c${crypto.randomUUID().replaceAll('-', '')}` : account;
  const char = { tg_id: tg, base_class: baseClass, class_path: '', level: 1 };
  const st = computeStats(char, []);
  const day = taipeiDay(now);
  const weapon = makeGear({ id: shortId(), tgId: tg, cls: baseClass, slot: 'weapon', kind: GENERAL_WEAPON[baseClass], tier: 1, rng, now, source: 'starter', forceRarity: 'common' });
  const armor = makeGear({ id: shortId(), tgId: tg, cls: baseClass, slot: 'armor', kind: null, tier: 1, rng, now, source: 'starter', forceRarity: 'common' });
  weapon.is_equipped = 1; armor.is_equipped = 1;
  const full = computeStats(char, [weapon, armor]);
  const starter = { red_1: 150, blue_1: 150 }; const gold = 1000;
  const stmts = [
    db.prepare(`INSERT INTO rpg_characters (tg_id,name,tg_name,gender,base_class,class_path,level,exp,hp,mp,map_id,idle_state,auto_red_pct,auto_blue,gold,last_settle_at,created_day,created_at,updated_at,rev,account_tg_id,char_slot)
      VALUES (?,?,?,?,?,'',1,0,?,?,1,'fighting',50,1,?,?,?,?,?,0,?,?)`).bind(tg, name, tgName, gender, baseClass, full.maxHp, full.maxMp, gold, now, day, now, now, account, slot),
    ...Object.entries(starter).map(([k, q]) => invDeltaStmt(db, tg, k, q)),
    insertEquipStmt(db, weapon), insertEquipStmt(db, armor),
    ledgerStmt(db, { event_id: `create:${tg}`, tg_id: tg, type: '新手禮包', gold_delta: gold, note: JSON.stringify(starter) }, now),
    db.prepare(`INSERT INTO rpg_accounts (account_tg_id,active_char_id,updated_at) VALUES (?,?,?)
      ON CONFLICT(account_tg_id) DO NOTHING`).bind(account, tg, now),
  ];
  if(receiptId)stmts.push(ledgerStmt(db,{event_id:receiptId,tg_id:tg,type:'角色建立',note:JSON.stringify({signature})},now));
  try { await db.batch(stmts); } catch (e) { const committed=await recover();if(committed)return committed;throw classifyDbError(e) || e; }
  void st;
  return loadPlayer(db, tg, env);
}

export function claimDaily(work, { now }, requestId) {
  const d = dailyGoldFor(work.char, now);
  if (d.claimed) throw new GameError('claimed', '今天的補給金已經領過了，明天再來！');
  work.char.gold += d.total; work.char.last_daily_gold_day = d.day;
  return { ledger: [{ event_id: `daily:${work.char.tg_id}:${d.day}`, tg_id: work.char.tg_id, type: '每日補給金', gold_delta: d.total, note: d.firstWeek ? `首週加成 +${d.bonus}` : null }], result: { gold: d.total, bonus: d.bonus } };
}

async function dailyCount(db, tg, day, key) {
  const r = await db.prepare('SELECT n FROM rpg_daily_counters WHERE tg_id=? AND day=? AND key=?').bind(String(tg), day, key).first();
  return r?.n || 0;
}
const counterStmt = (db, tg, day, key, n) => db.prepare('INSERT INTO rpg_daily_counters (tg_id,day,key,n) VALUES (?,?,?,?) ON CONFLICT(tg_id,day,key) DO UPDATE SET n = n + excluded.n').bind(String(tg), day, key, n);

export async function buyItem(work, { now, db }, { item, qty, requestId }) {
  const day = taipeiDay(now); const bought = ITEMS[item]?.dailyBuy ? await dailyCount(db, work.char.tg_id, day, `buy:${item}`) : 0;
  const { total } = checkItemPurchase(work.char, work.inv, item, qty, bought);
  work.char.gold -= total; work.inv[item] = (work.inv[item] || 0) + qty;
  autoResume(work.char, work.inv, idleStats(work.char, work.equipment.filter((e) => e.is_equipped)).maxHp);
  return { ledger: [{ event_id: eventId('buy', work.char.tg_id, requestId), tg_id: work.char.tg_id, type: '商店購買', gold_delta: -total, item, item_delta: qty }],
    extra: ITEMS[item]?.dailyBuy ? [counterStmt(db, work.char.tg_id, day, `buy:${item}`, qty)] : [], result: { item, qty, total, state: work.char.idle_state } };
}

/** 一鍵補滿: buy current-tier red/blue for 24h (scaled down if gold is short) */
export function refill(work, { now }, { hours = 24, requestId }) {
  const equipped = work.equipment.filter((e) => e.is_equipped);
  const plan = refillPlan(work.char, work.inv, equipped, hours);
  const pTier = Math.min(4, Math.ceil(mapForLevel(work.char.level) / 3));
  let red = plan[`red_${pTier}`], blue = plan[`blue_${pTier}`]; let cost = plan.cost;
  if (cost === 0) throw new GameError('full', `水已經夠用 ${hours} 小時了`);
  if (cost > work.char.gold) { const k = work.char.gold / cost; red = Math.floor(red * k); blue = Math.floor(blue * k); cost = red * POTIONS[`red_${pTier}`].price + blue * POTIONS[`blue_${pTier}`].price; }
  if (red + blue === 0) throw new GameError('gold', '金幣不足，先領每日補給金吧');
  work.char.gold -= cost; work.inv[`red_${pTier}`] = (work.inv[`red_${pTier}`] || 0) + red; work.inv[`blue_${pTier}`] = (work.inv[`blue_${pTier}`] || 0) + blue;
  autoResume(work.char, work.inv, idleStats(work.char, equipped).maxHp);
  const ledger = [];
  if (red) ledger.push({ event_id: eventId('refill-red', work.char.tg_id, requestId), tg_id: work.char.tg_id, type: '一鍵補水', gold_delta: -red * POTIONS[`red_${pTier}`].price, item: `red_${pTier}`, item_delta: red });
  if (blue) ledger.push({ event_id: eventId('refill-blue', work.char.tg_id, requestId), tg_id: work.char.tg_id, type: '一鍵補水', gold_delta: -blue * POTIONS[`blue_${pTier}`].price, item: `blue_${pTier}`, item_delta: blue });
  return { ledger, result: { red, blue, cost, partial: cost < plan.cost, state: work.char.idle_state } };
}

export function buyGear(work, { now }, { code, requestId }, rng = rngDefault()) {
  const offer = findOffer(work.char, code); if (!offer) throw new GameError('not_sold', '這件裝備你不能買（職業／路線／等級不符）');
  if (work.char.gold < offer.price) throw new GameError('gold', `金幣不足（需要 ${offer.price.toLocaleString()}）`);
  const item = makeGear({ id: shortId(), tgId: work.char.tg_id, cls: work.char.base_class, slot: offer.slot, kind: offer.kind, tier: offer.tier, rng, now });
  work.char.gold -= offer.price; work.equipment.push(item);
  return { ledger: [{ event_id: eventId('gear', work.char.tg_id, requestId), tg_id: work.char.tg_id, type: '購買裝備', gold_delta: -offer.price, item: `equip:${item.id}`, item_delta: 1, note: item.name }], result: { item } };
}

/** Purchase a sealed capsule; opening is a separate inventory transaction. */
export function buyGacha(work,{now},{type,requestId}){
  if(type!=='weapon'&&type!=='armor')throw new GameError('gacha_type','轉蛋類型無效');
  const price=type==='weapon'?10000:5000,key='gacha_'+type;
  if(work.char.gold<price)throw new GameError('gold',`金幣不足（需要 ${price.toLocaleString()}）`);
  work.char.gold-=price;work.inv[key]=(work.inv[key]||0)+1;
  return {ledger:[{event_id:eventId('gacha',work.char.tg_id,requestId),tg_id:work.char.tg_id,type:'購買轉蛋',gold_delta:-price,item:key,item_delta:1}],result:{itemKey:key,price,type,quantity:1}};
}
/** Consume one capsule and use the opening character's current level and class. */
export function openGacha(work,{now,db},{type,requestId},rng=rngDefault()){
  if(type!=='weapon'&&type!=='armor')throw new GameError('gacha_type','轉蛋類型無效');
  const key='gacha_'+type;
  if((work.inv[key]||0)<1)throw new GameError('no_gacha','背包沒有這種轉蛋');
  const {offer,rarity}=drawGacha(work.char,type,rng);
  const item=makeGear({id:shortId(),tgId:work.char.tg_id,cls:work.char.base_class,slot:offer.slot,kind:offer.kind,tier:offer.tier,rng,now,source:'gacha',forceRarity:rarity});
  if(canEquip(work.char,item))throw new GameError('gacha_equip','轉蛋裝備不符合職業或等級');
  work.inv[key]-=1;work.equipment.push(item);
  const extra=RARITY_KEYS.indexOf(rarity)>=RARITY_KEYS.indexOf('supreme')||item.grade==='relic'?shareStmts(db,{owner:work.char.tg_id,ownerChar:work.char,equip:item,kind:'share',context:{source:'gacha',showcase:true,type},now}).stmts:[];
  return {extra,ledger:[{event_id:eventId('gacha-open',work.char.tg_id,requestId),tg_id:work.char.tg_id,type:'開啟轉蛋',item:key,item_delta:-1,note:JSON.stringify({itemId:item.id,name:item.name,tier:item.tier,rarity})}],result:{item,rarity,type}};
}

/** Sell unequipped gear, including relics, for one third of its base shop price. */
export function sellGear(work, { now }, { itemId, requestId }) {
  const i = work.equipment.findIndex((e) => e.id === itemId);
  if (i < 0) throw new GameError('not_found', '找不到這件裝備');
  const item = work.equipment[i]; const block = gearSellBlock(item);
  if (block) throw new GameError('cannot_sell', block);
  const gold = gearSellPrice(item); const tg = String(work.char.tg_id);
  work.char.gold += gold; work.equipment.splice(i, 1);
  return { ledger: [{ event_id: eventId('sell-gear', tg, requestId), tg_id: tg, type: '出售裝備', gold_delta: gold, item: `equip:${item.id}`, item_delta: -1, note: item.name }], result: { itemId: item.id, itemName: item.name, gold } };
}

export const MAX_SELL_BATCH = 50;
/** Validate every chosen item before committing one sale; a stale/locked item rejects the entire selection. */
export async function sellGearBatch(work, { db, lockedEquipment = [] }, { itemIds, requestId }) {
  if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > MAX_SELL_BATCH || itemIds.some(id => typeof id !== 'string' || !id || id.length > 64) || new Set(itemIds).size !== itemIds.length) {
    throw new GameError('selection', `請勾選 1–${MAX_SELL_BATCH} 件不同的裝備`);
  }
  const tg = String(work.char.tg_id), receipt = eventId('sell-gear-batch', tg, requestId);
  if (requestId && await db.prepare('SELECT 1 FROM rpg_ledger WHERE event_id=?').bind(receipt).first()) throw new GameError('duplicate', '這批裝備已完成販售', 409);
  const items = itemIds.map(id => {
    const item = work.equipment.find(e => e.id === id && String(e.tg_id) === tg);
    if (!item) throw new GameError('not_found', '選取的裝備已變動，請更新後重新勾選', 409);
    if (lockedEquipment.includes(id)) throw new GameError('auto_active', '選取的裝備正在背景強化，請先停止強化', 409);
    const block = gearSellBlock(item); if (block) throw new GameError('cannot_sell', `${item.name}：${block}`, 409);
    return { id: item.id, name: item.name, enhance: item.enhance_level, grade: item.grade, gold: gearSellPrice(item) };
  });
  const gold = items.reduce((sum, item) => sum + item.gold, 0), removed = new Set(itemIds);
  work.char.gold += gold; work.equipment = work.equipment.filter(item => !removed.has(item.id));
  return { batchEquipmentDeletes: true, ledger: [{ event_id: receipt, tg_id: tg, type: '批量出售裝備', gold_delta: gold, item_delta: -items.length, note: JSON.stringify({ count: items.length, items }) }], result: { count: items.length, gold, items } };
}

/** equip: earrings/rings take position 1 or 2 (requested, else the first free one, else replace #1). Equipping binds the item. */
export function equip(work, ctx, { itemId, position = null }) {
  if(work.char.party_id)throw new GameError('party','請在組隊戰鬥結束後變更裝備');
  const item = work.equipment.find((e) => e.id === itemId); if (!item) throw new GameError('not_found', '找不到這件裝備');
  const why = canEquip(work.char, item); if (why) throw new GameError('cannot_equip', why);
  let pos; try { pos = equipPosition(work.equipment, item, position); } catch { throw new GameError('position', `${SLOT_NAMES[item.slot]}只有 ${capacity(item.slot)} 個欄位`); }
  for (const e of work.equipment) if (e.slot === item.slot && e.id !== item.id && (capacity(item.slot) === 1 ? e.is_equipped : e.is_equipped === pos)) e.is_equipped = 0;
  item.is_equipped = pos; item.bound = 1;
  const s = idleStats(work.char, work.equipment.filter((e) => e.is_equipped)); work.char.hp = Math.min(work.char.hp, s.maxHp); work.char.mp = Math.min(work.char.mp, s.maxMp);
  return { result: { itemId, slot: item.slot, position: pos } };
}
/** unequip by itemId, or by slot (+ position for earring/ring; default: the item in position 1, else 2) */
export function unequip(work, ctx, { slot = null, position = null, itemId = null }) {
  if(work.char.party_id)throw new GameError('party','請在組隊戰鬥結束後變更裝備');
  let item = null;
  if (itemId) item = work.equipment.find((e) => e.id === itemId && e.is_equipped);
  else {
    const on = work.equipment.filter((e) => e.slot === slot && e.is_equipped).sort((a, b) => a.is_equipped - b.is_equipped);
    item = position != null ? on.find((e) => e.is_equipped === Number(position)) : on[0];
  }
  if (!item) throw new GameError('not_found', '這個部位沒有穿裝備');
  item.is_equipped = 0;
  const s = idleStats(work.char, work.equipment.filter((e) => e.is_equipped)); work.char.hp = Math.min(work.char.hp, s.maxHp); work.char.mp = Math.min(work.char.mp, s.maxMp);
  return { result: { slot: item.slot, itemId: item.id } };
}
export function settings(work, ctx, { autoRedPct, autoBlue, autoBluePct }) {
  if (autoRedPct != null) { const v = Number(autoRedPct); if (!Number.isInteger(v) || v < 20 || v > 80) throw new GameError('range', '喝紅水門檻要在 20–80%'); work.char.auto_red_pct = v; }
  if (autoBluePct != null) { const v=Number(autoBluePct); if (!Number.isInteger(v)||v<20||v>80) throw new GameError('range','喝藍水門檻要在 20–80%'); let x; try{x=JSON.parse(work.char.special_json||'{}');}catch{x={};} work.char.special_json=JSON.stringify({...x,autoBluePct:v}); }
  if (autoBlue != null) work.char.auto_blue = autoBlue ? 1 : 0;
  autoResume(work.char, work.inv, idleStats(work.char, work.equipment.filter((e) => e.is_equipped)).maxHp);
  return { result: { autoRedPct: work.char.auto_red_pct, autoBlue: !!work.char.auto_blue, autoBluePct:getAutoBluePct(work.char) } };
}

export function doAdvance(work, { now, db }, { branch, requestId }) {
  if(work.char.party_id)throw new GameError('party','請先結束組隊戰鬥，再轉職');
  const r = advance(work.char, work.inv, branch);
  const statsFor = (L) => idleStats(work.char, work.equipment.filter((e) => e.is_equipped), L);
  const gained = applyExp(work.char, statsFor);
  autoResume(work.char, work.inv, statsFor(work.char.level).maxHp);
  return { ledger: [{ event_id: eventId('advance', work.char.tg_id, requestId), tg_id: work.char.tg_id, type: '轉職', item: Object.keys(r.used)[0], item_delta: -1, note: `${r.from || '基礎'}→${r.to}` }],
    extra: [db.prepare('INSERT INTO rpg_class_changes (tg_id,tier,from_path,to_path,kind,created_at) VALUES (?,?,?,?,?,?)').bind(String(work.char.tg_id), r.tier, r.from, r.to, 'advance', now)],
    result: { ...r, levelsGained: gained, level: work.char.level, map: work.char.map_id } };
}
export function doReselect(work, { now, db }, { tier, branch, requestId }) {
  if(work.char.party_id)throw new GameError('party','請先結束組隊戰鬥，再更換職業');
  const r = reselect(work.char, work.inv, work.equipment, Number(tier), branch, now);
  return { ledger: [{ event_id: eventId('reselect', work.char.tg_id, requestId), tg_id: work.char.tg_id, type: '命運轉職書', item: Object.keys(r.used)[0], item_delta: -1, note: `${r.from}→${r.to}` }],
    extra: [db.prepare('INSERT INTO rpg_class_changes (tg_id,tier,from_path,to_path,kind,created_at) VALUES (?,?,?,?,?,?)').bind(String(work.char.tg_id), Number(tier), r.from, r.to, 'reselect', now)],
    result: r };
}
export function doConvert(work, ctx, { itemId }) {
  if(work.char.party_id)throw new GameError('party','請在組隊戰鬥結束後變更裝備');
  const i = work.equipment.findIndex((e) => e.id === itemId); if (i < 0) throw new GameError('not_found', '找不到這件裝備');
  const item = work.equipment[i];
  if (item.trade_id) throw new GameError('in_trade', '交易中的裝備不能轉換');
  if (!item.branch_req || item.branch_req === String(work.char.class_path || '')[0]) throw new GameError('not_needed', '這件武器不需要轉換');
  const next = convertWeapon(item); if (!next) throw new GameError('no_token', '這件武器的免費轉換已經用過了');
  work.equipment[i] = next; return { result: { item: next } };
}

export async function ledgerFor(db, tgId, limit = 15) {
  const r = await db.prepare('SELECT type, gold_delta, item, item_delta, note, created_at FROM rpg_ledger WHERE tg_id = ? ORDER BY id DESC LIMIT ?').bind(String(tgId), limit).all();
  return r.results || [];
}
export async function latestReport(db, tgId) {
  return db.prepare('SELECT * FROM rpg_idle_reports WHERE tg_id = ? ORDER BY id DESC LIMIT 1').bind(String(tgId)).first();
}

/** 強化: one attempt; a break deletes the item. weapon +8 / armor & accessories +6 success or existing-level break → group announcement via outbox */
export function doEnhance(work, { now, db,lockedEquipment=[] }, { itemId, requestId, blessed = false, guaranteed = false }, rng = rngDefault()) {
  if(typeof blessed!=='boolean'||typeof guaranteed!=='boolean'||(blessed&&guaranteed))throw new GameError('scroll_mode','請選擇普通、祝福或必成其中一種強化卷');
  if(lockedEquipment.includes(itemId))throw new GameError('auto_active','這件裝備正在背景強化，請先停止強化',409);
  if(work.char.party_id)throw new GameError('party','請在組隊戰鬥結束後變更裝備');
  const i = work.equipment.findIndex((e) => e.id === itemId); if (i < 0) throw new GameError('not_found', '找不到這件裝備');
  const item = work.equipment[i]; const name = item.name;
  if (item.trade_id) throw new GameError('in_trade', '交易中的裝備不能強化');
  // Buy any missing scrolls and enhance in the same player transaction. This avoids
  // a race between the old client-side buy-then-enhance pair of requests.
  const key = guaranteed ? (item.slot === 'weapon' ? 'guaranteed_scroll_w' : 'guaranteed_scroll_a') : blessed ? (item.slot === 'weapon' ? 'blessed_scroll_w' : 'blessed_scroll_a') : (item.slot === 'weapon' ? 'scroll_w' : 'scroll_a');
  const need = blessed || guaranteed ? 1 : Math.max(1, Number(item.tier) || 1); const have = work.inv[key] || 0; const missing = Math.max(0, need - have);
  if ((blessed || guaranteed) && missing) throw new GameError('no_scroll', `需要「${ITEMS[key].name}」×1（目前有 ${have}）`);
  const goldCost = blessed || guaranteed ? 0 : missing * ITEMS[key].price;
  if ((work.char.gold || 0) < goldCost) throw new GameError('gold', `金幣不足：還需要 ${goldCost.toLocaleString()}（目前有 ${(work.char.gold || 0).toLocaleString()}）才能購買強化卷`);
  if (missing) {
    work.char.gold -= goldCost;
    work.inv[key] = have + missing;
  }
  const r = enhance(item, work.inv, rng, blessed, guaranteed);
  if (r.result === 'break') work.equipment.splice(i, 1);
  const tg = String(work.char.tg_id); const eid = eventId('enhance', tg, requestId);
  const extra = [];
  if (r.announce && r.result === 'success') {
    extra.push(...shareStmts(db, { owner: tg, ownerChar: work.char, equip: item, kind: 'enhance', context: { itemName: name, from: r.from, to: r.to }, now }).stmts);
  } else if (r.announce) {
    extra.push(outboxStmt(db, { dedupe: `enh:${eid}`, target: 'group', kind: 'enhance', payload: { tgId: tg, name: work.char.name, item: name, result: r.result, from: r.from, to: r.to, rarity: RARITIES[item.element_tier]?.name } }, now));
  }
  if (r.result !== 'break') { const s = idleStats(work.char, work.equipment.filter((e) => e.is_equipped)); work.char.hp = Math.min(work.char.hp, s.maxHp); work.char.mp = Math.min(work.char.mp, s.maxMp); }
  const ledger = [];
  if (missing) ledger.push({ event_id: eventId('buy-enhance-scroll', tg, requestId), tg_id: tg, type: '商店購買', gold_delta: -goldCost, item: key, item_delta: missing, note: `${ITEMS[key].name}（強化時補購）` });
  ledger.push({ event_id: eid, tg_id: tg, type: guaranteed ? '星輝必成強化' : blessed ? '祝福強化' : '強化', item: key, item_delta: -r.used[key], note: `${name} +${r.from}→${r.result === 'break' ? '爆裝' : `+${r.to}`}${guaranteed ? '（100% 成功）' : blessed ? '（祝福成功率 +10%）' : ''}` });
  return { ledger, extra, result: { ...r, itemId, itemName: name, goldCost } };
}
/** 洗屬性: auto-buys missing scroll_r in the same transaction if gold allows */
export function doReroll(work, { now,lockedEquipment=[] }, { itemId, requestId, locks=[],typeLocks=[] }, rng = rngDefault()) {
  if(lockedEquipment.includes(itemId))throw new GameError('auto_active','這件裝備正在背景強化，請先停止強化',409);
  const item = work.equipment.find((e) => e.id === itemId); if (!item) throw new GameError('not_found', '找不到這件裝備');
  if (item.trade_id) throw new GameError('in_trade', '交易中的裝備不能洗屬性');
  if(work.char.party_id)throw new GameError('party','請在組隊戰鬥結束後重洗裝備');
  const cost=affixCost(item,locks,typeLocks);const key = 'scroll_r';
  const need = cost.scrolls; const have = work.inv[key] || 0; const missing = Math.max(0, need - have);
  const goldCost = cost.fee + missing * ITEMS[key].price;
  if ((work.char.gold || 0) < goldCost) throw new GameError('gold', `金幣不足：還需要 ${goldCost.toLocaleString()}（目前有 ${(work.char.gold || 0).toLocaleString()}）才能購買洗屬性捲`);
  if (missing) {
    work.inv[key] = have + missing;
  }
  work.char.gold-=goldCost;
  const r = reroll(item, work.inv, rng,locks,typeLocks);const st=idleStats(work.char,work.equipment);work.char.hp=Math.min(work.char.hp,st.maxHp);work.char.mp=Math.min(work.char.mp,st.maxMp); const tg = String(work.char.tg_id); const eid = eventId('reroll', tg, requestId);
  const ledger = [];
  if (missing) ledger.push({ event_id: eventId('buy-reroll-scroll', tg, requestId), tg_id: tg, type: '商店購買', gold_delta: -missing*ITEMS[key].price, item: key, item_delta: missing, note: `${ITEMS[key].name}（洗屬性時補購）` });
  ledger.push({ event_id: eid, tg_id: tg, type: '洗屬性', gold_delta:-cost.fee,item: key, item_delta: -r.used[key], note: `${item.name} 詞條${r.before.quality}→${r.after.quality}；鎖定${cost.locks.length+cost.typeLocks.length}條` });
  return { ledger, result: { ...r, itemId, itemName: item.name, goldCost } };
}
/** 赫密士解契卷: a bound, unequipped (non-starter) item becomes tradeable/shareable again */
export function doUnbind(work, ctx, { itemId, requestId }) {
  const item = work.equipment.find((e) => e.id === itemId); if (!item) throw new GameError('not_found', '找不到這件裝備');
  const why = unbindBlock(item); if (why) throw new GameError('cannot_unbind', why);
  const need = unbindCost(item); const have = work.inv.unbind || 0;
  if (have < need) throw new GameError('insufficient', `需要「赫密士解契卷」×${need}（你有 ${have}），商店「📜 捲軸」可以買`);
  work.inv.unbind = have - need; item.bound = 0; const tg = String(work.char.tg_id);
  return { ledger: [{ event_id: eventId('unbind', tg, requestId), tg_id: tg, type: '解契', item: 'unbind', item_delta: -need, note: item.name }], result: { itemId, used: need, itemName: item.name } };
}
void ENHANCE;
