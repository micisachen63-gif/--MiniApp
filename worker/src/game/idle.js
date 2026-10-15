import {chooseMonster,monsterMaterialPlan} from './monsters.js';
import {guardianDamageMultiplier,guardianChance} from './guardian-effects.js';
import {idleSpecial} from './special-idle.js';
import {beginAssistBattle,idleGuardianActor} from './guardian-assist.js';
import {idleCombatState,idleMonsterHp,resolveIdleCombat} from './idle-combat.js';
import {spendMana,restoreOnAction} from './combat-passives.js';
import {elementalDamage,mapElement} from './elements.js';
// Background idle combat: lazy, deterministic settlement (pure).
// 1 tick = 60 s = one battle. Called before every action and by the cron; result is persisted by the caller.
import { TICK_MS, MAX_SETTLE_TICKS, IDLE, DEATH, POTIONS, NEWBIE_EXP_LEVEL, NEWBIE_EXP_MULT, MAX_LEVEL, MAX_OPEN_MAP, MAX_OPEN_CLASS_TIER, DROPS, DROP_KEYS, RELIC, MONSTER_GOLD, BLESSED_DROPS } from './constants.js';
import { makeRelic, makeEliteGear } from './gear.js';
import { mulberry32 } from './rng.js';
import { expPerTick, expToNext, dailyGold, mapForLevel } from './formulas.js';
import { idleStats, classTier } from './stats.js';
import { rngFor } from './rng.js';
import { taipeiDay } from './time.js';

const potionKeys = (kind) => Object.keys(POTIONS).filter((k) => POTIONS[k].kind === kind).sort((a, b) => POTIONS[a].tier - POTIONS[b].tier);
const RED = potionKeys('red'), BLUE = potionKeys('blue');
export const countKind = (inv, kind) => (kind === 'red' ? RED : BLUE).reduce((n, k) => n + (inv[k] || 0), 0);

/** best potion to drink: highest tier ≤ map potion tier, else the lowest higher tier */
export function choosePotion(inv, kind, mapTier) {
  const keys = kind === 'red' ? RED : BLUE;
  const pTier = Math.min(4, Math.ceil(mapTier / 3));
  const lower = keys.filter((k) => POTIONS[k].tier <= pTier && (inv[k] || 0) > 0);
  if (lower.length) return lower[lower.length - 1];
  return keys.find((k) => (inv[k] || 0) > 0) || null;
}

/** level at which EXP stops until the next advancement (30/60/90), or the cap */
export function gateLevel(char) {
  const t = classTier(char.class_path);
  const gate = Math.min((t + 1) * 30, MAX_OPEN_MAP * 30);
  return Math.min(gate, MAX_LEVEL);
}
export const atGate = (char) => char.level >= gateLevel(char) && char.exp >= expToNext(char.level);
export const canAdvanceNow = (char) => char.level >= (classTier(char.class_path) + 1) * 30 && classTier(char.class_path) < MAX_OPEN_CLASS_TIER;

/** apply EXP → level-ups (full heal on level up), respecting the gate. mutates c, returns levels gained */
export function applyExp(c, statsFor) {
  let gained = 0;
  for (;;) {
    const need = expToNext(c.level);
    if (c.level >= MAX_LEVEL) { c.exp = 0; break; }
    if (c.exp < need) break;
    if (c.level >= gateLevel(c)) { c.exp = need; break; }   // EXP full, waiting at the gate
    c.exp -= need; c.level += 1; gained += 1;
    const s = statsFor(c.level); c.hp = s.maxHp; c.mp = s.maxMp; c.map_id = mapForLevel(c.level);
  }
  return gained;
}

/** after restocking / advancing: leave town automatically when possible (no manual "continue") */
export function autoResume(c, inv, maxHp) {
  if (c.idle_state === 'town_no_red' && countKind(inv, 'red') > 0) { c.idle_state = 'fighting'; return true; }
  if (c.idle_state === 'gate' && !atGate(c)) { c.idle_state = (countKind(inv, 'red') > 0 || c.hp > IDLE.townHpPct * maxHp) ? 'fighting' : 'town_no_red'; return true; }
  if (c.idle_state === 'no_mp' && countKind(inv, 'blue') > 0) { c.idle_state = 'fighting'; return true; }
  return false;
}

/** gold for one normal kill at level L (before variance) */
export const goldPerKill = (L) => (MONSTER_GOLD.base + MONSTER_GOLD.perLevel * L) * MONSTER_GOLD.mapMul[Math.min(MONSTER_GOLD.mapMul.length - 1, Math.max(0, mapForLevel(L) - 1))];
export function emptyReport(from, to) {
  return { from_at: from, to_at: to, ticks: 0, skipped_ticks: 0, kills: 0, exp_gained: 0, exp_lost: 0, deaths: 0, elites: 0, gold_gained: 0, gold_kills: 0, gold_elites: 0, used: {}, levels_gained: 0, end_state: null, wards_used: 0, drops: {}, drops_capped: 0, relics: [], eliteGear: [] };
}

/**
 * Settle idle combat from c.last_settle_at to `now`.
 * @param c   character row (copied, not mutated)
 * @param inv inventory map {item: qty} (copied)
 * @param equipped equipped rows
 * @returns { char, inv, report, events }
 */
const parseDrops = (j) => { try { return j ? JSON.parse(j) : {}; } catch { return {}; } };
export function settleIdle(char, inventory, equipped, now) {
  const c = { ...char }; const inv = { ...inventory }; const events = [];
  const total = Math.floor((now - c.last_settle_at) / TICK_MS);
  const report = emptyReport(c.last_settle_at, c.last_settle_at);
  if(c.party_id){c.last_settle_at=now;report.end_state=c.idle_state;return {char:c,inv,report,events};}
  if (total <= 0) return { char: c, inv, report, events };
  const skipped = Math.max(0, total - MAX_SETTLE_TICKS); const ticks = total - skipped;
  const start = c.last_settle_at + skipped * TICK_MS;
  const rng = rngFor(`${c.tg_id}:${c.last_settle_at}`);
  const dropRng = rngFor(`${c.tg_id}:${c.last_settle_at}:drop`);   // separate stream: drops never shift combat outcomes
  const relicRng = rngFor(`${c.tg_id}:${c.last_settle_at}:relic`); // v0.4 遺物 stream (separate: never shifts combat or scroll drops)
  const eliteGearRng = rngFor(`${c.tg_id}:${c.last_settle_at}:elite-gear`); // independent class-gear stream
  const blessedRng = rngFor(`${c.tg_id}:${c.last_settle_at}:blessed`); // independent scroll stream; never affects combat or existing loot
  const goldRng = rngFor(`${c.tg_id}:${c.last_settle_at}:gold`);   // v0.5.1 kill-gold variance stream (separate)
  const materialRng = rngFor(`${c.tg_id}:${c.last_settle_at}:monster-material`);
  let eliteGold = 0, killGold = 0, realKills = 0, combatState=null;
  let dropsToday = parseDrops(c.drops_today);
  const cache = new Map(); const statsFor = (L) => { if (!cache.has(L)) cache.set(L, idleStats(c, equipped, L)); return cache.get(L); };
  let goldAcc = 0, killAcc = 0;
  const use = (k) => { inv[k] -= 1; report.used[k] = (report.used[k] || 0) + 1; };
  const setState = (st, t, extra = {}) => { if (c.idle_state !== st) { c.idle_state = st; events.push({ type: st, at: t, ...extra }); } };
  report.skipped_ticks = skipped;

  for (let i = 1; i <= ticks; i++) {
    const t = start + i * TICK_MS; const day = taipeiDay(t);
    if (c.penalty_day !== day) { c.penalty_day = day; c.penalties_today = 0; }
    if (c.drop_day !== day) { c.drop_day = day; dropsToday = {}; }
    const s = statsFor(c.level); const mapTier = mapForLevel(c.level);
    const townRegen = () => { c.hp = Math.min(s.maxHp, c.hp + Math.ceil(IDLE.townRegenPct * s.maxHp)); c.mp = Math.min(s.maxMp, c.mp + Math.ceil(IDLE.townRegenPct * s.maxMp)); };

    if (atGate(c)) { setState('gate', t, { level: c.level }); townRegen(); continue; }
    if (c.idle_state === 'gate') c.idle_state = 'fighting';
    if (c.idle_state === 'reviving') { if (t < c.state_until) { townRegen(); continue; } c.state_until = null; c.idle_state = 'fighting'; }
    if (c.idle_state === 'town_no_red') { if (countKind(inv, 'red') === 0) { townRegen(); continue; } c.idle_state = 'fighting'; }

    beginAssistBattle(c,inv,use,price=>{report.guardianStonesBought=(report.guardianStonesBought||0)+1;report.guardianStoneGoldSpent=(report.guardianStoneGoldSpent||0)+price;});
    const guardianActor=idleGuardianActor(c);
    // MP: cast the skill if possible (auto blue), otherwise basic attacks
    const special=idleSpecial(c,inv,s,t,{chooseBlue:(inv,map)=>choosePotion(inv,'blue',map),use,potions:POTIONS,day,rng});
    let cast = !!special?.selected;
    if (!special?.selected && c.mp < s.skill.cost && c.auto_blue) { let k; while (c.mp < s.skill.cost && (k = choosePotion(inv, 'blue', mapTier))) { use(k); c.mp = Math.min(s.maxMp, c.mp + POTIONS[k].heal); } }
    if (!special?.selected && c.mp >= s.skill.cost) { cast = true; const mana={mp:c.mp,affixPct:s.pct};spendMana(mana,s.skill.cost,rng);c.mp=mana.mp; }
    c.mp = Math.min(s.maxMp, c.mp + s.mpRegen);
    setState(cast ? 'fighting' : 'no_mp', t);
    const crit=!special?.selected&&rng()<Math.min(.8,.05+(s.pct.critPct||0));
    const nativeElement=elementalDamage(s.atk*s.skill.mult,s,{element:mapElement(mapTier)})/Math.max(1,s.atk*s.skill.mult);
    const eff = special?.selected ? special.ratio : (cast ? 1 : IDLE.basicEff)*(special?.normalBonus??1)*(crit?1.5:1)*nativeElement;

    const combat=combatState?.mapId===mapTier?combatState:idleCombatState({...c,idle_combat_json:combatState?null:c.idle_combat_json});combatState=combat;
    const kills=s.killsPerTick*eff*s.g*guardianDamageMultiplier(guardianActor);
    // This is exactly the integer damage budget resolveIdleCombat will distribute, including its carried fraction.
    const damage=Math.floor(Math.max(0,kills)*idleMonsterHp(mapTier)+(combat.remainder||0));
    const recovery={hp:c.hp,maxHp:s.maxHp,affixPct:s.pct};
    const sustain=restoreOnAction(recovery,damage,{cast});c.hp=recovery.hp;

    // HP: monster pressure, auto red
    const autoRed = () => { let k; while (c.hp < (c.auto_red_pct / 100) * s.maxHp && (k = choosePotion(inv, 'red', mapTier))) { use(k); c.hp = Math.min(s.maxHp, c.hp + POTIONS[k].heal); } };
    c.hp = Math.min(s.maxHp, c.hp - (special?.hpLoss ?? s.hpLoss)); autoRed();

    const eliteMonster=chooseMonster(mapTier,'elite',Math.floor(t/TICK_MS));
    // elite ambush → possible death
    let died = c.hp <= 0, eliteDefeated=false;
    if (!died && rng() < IDLE.eliteChance) {
      report.elites += 1;
      if (c.hp <= s.burst && !special?.eliteProtected) died = true;
      else {
        eliteDefeated=true;
        c.hp = Math.max(special?.eliteProtected?1:0,c.hp-s.burst); autoRed();
        eliteGold += goldPerKill(c.level) * MONSTER_GOLD.elite * (1 - MONSTER_GOLD.variance + 2 * MONSTER_GOLD.variance * goldRng());
        // Every surviving elite drops one class-usable advanced+ item; 40% chance for a second.
        // At the current 3% encounter rate this averages 2.52 items/hour during active combat.
        const extraGear = eliteGearRng() < guardianChance(0.4,guardianActor) ? 1 : 0;
        for (let drop = 0; drop <= extraGear; drop++) {
          const item = makeEliteGear({ id: `eg${c.tg_id}${t.toString(36)}${drop}`, tgId: c.tg_id, cls: c.base_class, classPath: c.class_path, tier: Math.min(mapTier, MAX_OPEN_MAP), rng: mulberry32(Math.floor(eliteGearRng() * 2 ** 32)), now: t });
          report.eliteGear.push(item);
          events.push({ type: 'elite_gear', at: t, item: { id: item.id, name: item.name, slot: item.slot, classReq: item.class_req, tier: item.tier }, source: 'elite', elite: eliteMonster.name, map: s.map.name });
        }
        // A survived elite kill independently rolls one tradeable blessed enhancement scroll.
        if (blessedRng() < guardianChance(BLESSED_DROPS.eliteChance,guardianActor)) {
          const key = BLESSED_DROPS.keys[Math.floor(blessedRng() * BLESSED_DROPS.keys.length)];
          inv[key] = (inv[key] || 0) + 1; report.drops[key] = (report.drops[key] || 0) + 1;
          events.push({ type: 'blessed_scroll', at: t, key, source: 'elite', elite: eliteMonster.name, map: s.map.name });
        }
        // elite killed → 遺物 chance (daily cap); tier = map tier, slot/class random (see makeRelic)
        if (relicRng() < guardianChance(RELIC.eliteChance,guardianActor)) {
          if ((dropsToday.relic || 0) >= RELIC.eliteDailyCap) report.drops_capped += 1;
          else {
            const item = makeRelic({ id: `rl${c.tg_id}${t.toString(36)}`, tgId: c.tg_id, tier: Math.min(mapTier, MAX_OPEN_MAP), rng: mulberry32(Math.floor(relicRng() * 2 ** 32)), now: t, source: 'relic_elite' });
            dropsToday.relic = (dropsToday.relic || 0) + 1; report.relics.push(item);
            events.push({ type: 'relic', at: t, item: { id: item.id, name: item.name, slot: item.slot, classReq: item.class_req, tier: item.tier }, source: 'elite', elite: eliteMonster.name, map: s.map.name });
          }
        }
      }
    }
    if (died) {
      report.deaths += 1; c.deaths_total = (c.deaths_total || 0) + 1;
      let penalty = 0, reason;
      if (c.level <= NEWBIE_EXP_LEVEL) reason = 'newbie';
      else if (c.penalties_today >= DEATH.dailyPenaltyCap) reason = 'daily_cap';
      else if ((inv.ward || 0) > 0) { reason = 'ward'; use('ward'); report.wards_used += 1; }
      else { reason = 'penalty'; penalty = Math.min(c.exp, Math.floor(DEATH.expPct * expToNext(c.level))); c.exp -= penalty; c.penalties_today += 1; report.exp_lost += penalty; }
      events.push({ type: 'death', at: t, level: c.level, penalty, reason, elite: eliteMonster.name, map: s.map.name, penaltiesToday: c.penalties_today });
      c.idle_state = 'reviving'; c.state_until = t + IDLE.reviveTicks * TICK_MS;
      c.hp = Math.ceil(IDLE.reviveHpPct * s.maxHp); c.mp = Math.ceil(IDLE.reviveHpPct * s.maxMp);
      continue;
    }

    // rewards
    const mult = c.level <= NEWBIE_EXP_LEVEL ? NEWBIE_EXP_MULT : 1;
    const gain = Math.round(expPerTick(c.level) * eff * s.g * s.expFactor * mult);
    c.exp += gain; report.exp_gained += gain;
    goldAcc += dailyGold(c.level) * IDLE.goldPerDayPct / MAX_SETTLE_TICKS * eff;
    killAcc += kills;
    const round=resolveIdleCombat(combat,c,{at:t,killsBudget:kills,cast,skillName:special?.selected?.name||s.skill.name,crit,elite:eliteDefeated,eliteMonster,record:i===ticks});
    if(i===ticks){round.sustain={damage,healed:sustain.healed,cast};round.crit=crit;}
    for(const [key,qty]of Object.entries(monsterMaterialPlan(round,materialRng,dropsToday,inv))){inv[key]=(inv[key]||0)+qty;report.drops[key]=(report.drops[key]||0)+qty;}
    realKills+=round.kills+(round.eliteKills||0);report.combat=combat.round;
    killGold += kills * goldPerKill(c.level) * (1 - MONSTER_GOLD.variance + 2 * MONSTER_GOLD.variance * goldRng());
    // loot: enhancement / reroll scrolls (one roll per key per fighting tick, always consumed → deterministic)
    const T = Math.min(mapTier, MAX_OPEN_MAP);
    for (const k of DROP_KEYS) {
      if (dropRng() >= guardianChance(DROPS[k].base * T * eff,guardianActor) || round.kills+(round.eliteKills||0)===0) continue;
      if ((dropsToday[k] || 0) >= DROPS[k].capPerTier * T) { report.drops_capped += 1; continue; }
      dropsToday[k] = (dropsToday[k] || 0) + 1; inv[k] = (inv[k] || 0) + 1; report.drops[k] = (report.drops[k] || 0) + 1;
    }
    report.levels_gained += applyExp(c, statsFor);

    if (c.hp <= IDLE.townHpPct * statsFor(c.level).maxHp && countKind(inv, 'red') === 0) setState('town_no_red', t);
    if (atGate(c)) setState('gate', t, { level: c.level });
  }
  c.hp = Math.max(1, Math.round(c.hp)); c.mp = Math.max(0, Math.round(c.mp));
  c.last_settle_at = start + ticks * TICK_MS;
  if(combatState)c.idle_combat_json=JSON.stringify(combatState);
  report.ticks = ticks; report.to_at = c.last_settle_at; // stochastic rounding (own rng stream): the app settles every minute, so flooring would drop ~0.5 gold per settlement (−30% at low Lv)
  const sround = (v) => Math.floor(v) + (goldRng() < v - Math.floor(v) ? 1 : 0);
  report.gold_kills = sround(killGold); report.gold_elites = sround(eliteGold); report.gold_gained = Math.floor(goldAcc) + report.gold_kills + report.gold_elites; report.kills = realKills;
  c.drops_today = JSON.stringify(dropsToday);
  report.end_state = c.idle_state; c.gold = (c.gold || 0) + report.gold_gained; c.map_id = mapForLevel(c.level);
  const seen = new Set();
  // Compress repeated state notices only; each awarded equipment item needs its own receipt.
  const out = events.filter((e) => e.type !== 'fighting' && (e.type === 'death' || e.type === 'relic' || e.type === 'blessed_scroll' || e.type === 'elite_gear' || (!seen.has(e.type) && seen.add(e.type))));
  return { char: c, inv, report, events: out };
}

/** hours of potions left at the current consumption (for the menu) */
export function supplyHours(char, inv, equipped) {
  const s = idleStats(char, equipped); const mapTier = mapForLevel(char.level);
  const healOf = (kind) => (kind === 'red' ? RED : BLUE).reduce((n, k) => n + (inv[k] || 0) * POTIONS[k].heal * (POTIONS[k].tier <= mapTier ? 1 : 1), 0);
  const hpPerTick = Math.max(0.01, s.hpLoss + IDLE.eliteChance * s.burst);
  const mpPerTick = Math.max(0.01, s.skill.cost * (1 - (s.pct.freeCastPct || 0)) - s.mpRegen);
  return { red: healOf('red') / hpPerTick / 60, blue: healOf('blue') / mpPerTick / 60, hpPerTick, mpPerTick };
}
/** how many potions to cover `hours` of idle at the current consumption */
export function refillPlan(char, inv, equipped, hours = 24) {
  const { hpPerTick, mpPerTick } = supplyHours(char, inv, equipped);
  const pTier = Math.min(4, Math.ceil(mapForLevel(char.level) / 3));
  const red = `red_${pTier}`, blue = `blue_${pTier}`;
  const haveRed = RED.reduce((n, k) => n + (inv[k] || 0) * POTIONS[k].heal, 0); const haveBlue = BLUE.reduce((n, k) => n + (inv[k] || 0) * POTIONS[k].heal, 0);
  const needRed = Math.max(0, Math.ceil((hpPerTick * 60 * hours - haveRed) / POTIONS[red].heal));
  const needBlue = Math.max(0, Math.ceil((mpPerTick * 60 * hours - haveBlue) / POTIONS[blue].heal));
  return { [red]: needRed, [blue]: needBlue, cost: needRed * POTIONS[red].price + needBlue * POTIONS[blue].price };
}

