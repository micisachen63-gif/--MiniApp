import {combatActor,autoPartyAction,validateCast,castSpecial,saveSpecial,periodic,damageEnemy,receiveDamage,valueOf} from './special.js';
import {spendMana,restoreOnAction} from './combat-passives.js';
import {monsterPool} from './monsters.js';
import {guardianDamageMultiplier,guardianLootMultiplier} from './guardian-effects.js';
import {elementMultiplier,elementalDamage,bossResistance} from './elements.js';
export {elementMultiplier} from './elements.js';
// Scheduled group boss (= the map boss). Pure rules; persistence lives in src/services/boss.js.
import { BOSS, MAPS, ELEMENT_KEYS, POTIONS, MAX_OPEN_MAP, RELIC } from './constants.js';
import { mapForLevel } from './formulas.js';
import { classTier } from './stats.js';
import { taipeiDay, taipeiAt } from './time.js';
import { choosePotion } from './idle.js';
import { pick } from './rng.js';

/** the spawn slot covering `now` (spawn time ≤ now < spawn + 30 min), or null */
export function slotFor(now) {
  for (const dayOffset of [0, -1]) {
    const day = taipeiDay(now + dayOffset * 86_400_000);
    for (const h of BOSS.slotsTaipei) {
      const start = taipeiAt(day, h);
      if (now >= start && now < start + BOSS.durationMs) return { id: `b${day.replace(/-/g, '')}${String(h).padStart(2, '0')}`, day, hour: h, start, end: start + BOSS.durationMs };
    }
  }
  return null;
}
export function nextSlot(now) {
  for (const dayOffset of [0, 1]) {
    const day = taipeiDay(now + dayOffset * 86_400_000);
    for (const h of BOSS.slotsTaipei) { const start = taipeiAt(day, h); if (start > now) return { day, hour: h, start }; }
  }
  return null;
}

/** material-needy: in the map's level range, not yet advanced past it, not holding its material */
export function needsMaterial(char, inv, tier) {
  const matKey = MAPS[tier]?.boss?.mat;
  if (!matKey || Number(matKey.split('_')[1])>2) return false;
  const matTier = Number(matKey.split('_')[1]);
  return mapForLevel(char.level) === tier && classTier(char.class_path) < matTier && !((inv?.[matKey] || 0) > 0);
}

/** stuck: at the map's level cap (Lv 30, 60, 90...), not advanced past it and missing that map's material */
export const isStuck = (p, tier) => needsMaterial(p, p.inv, tier) && p.level >= tier * 10;

/**
 * Which map boss spawns in a slot (DESIGN §8.2, v0.3 rule from ミカサ: random boss per slot, never the same as the previous slot
 * when there is a choice, plus a daily fairness guarantee).
 *  1. Guarantee: every map with ≥1 stuck player (see isStuck) that has not had its boss yet today is "pending". With R slots
 *     left today (this one included) and g pending maps: if g ≥ R → must pick a pending map now; otherwise pick a pending map
 *     with probability g/R (= each pending map lands in a uniformly random remaining slot). So every stuck map gets ≥1 spawn/day.
 *  2. Otherwise uniformly random among maps that currently have players (excluding the previous slot's boss if >1 candidate).
 * players: [{ level, class_path, inv }]; ctx: { prevTier, spawnedToday: [tier], slotsLeft }; rng: seeded per slot.
 */
export function chooseTier(players, { prevTier = null, spawnedToday = [], slotsLeft = 1 } = {}, rng = Math.random, maxTier = MAX_OPEN_MAP) {
  const tiers = Array.from({ length: maxTier }, (_, i) => i + 1);
  const present = tiers.filter((t) => players.some((p) => Math.min(mapForLevel(p.level), maxTier) === t));
  const stuck = tiers.filter((t) => players.some((p) => isStuck(p, t)));
  const pending = stuck.filter((t) => !spawnedToday.includes(t));
  const notPrev = (list) => (list.length > 1 ? list.filter((t) => t !== prevTier) : list);
  const R = Math.max(1, slotsLeft); const g = pending.length;
  if (g) {
    const forced = g >= R; const roll = rng();
    const options = forced ? notPrev(pending) : pending.filter((t) => t !== prevTier);
    if (options.length && (forced || roll < g / R)) return { tier: pick(rng, options), reason: 'guarantee', pending, stuck };
  }
  if (!present.length) return { tier: 1, reason: 'empty', pending, stuck };
  return { tier: pick(rng, notPrev(present)), reason: 'random', pending, stuck };
}

export const bossMaxHp = (tier, participants) => MAPS[tier].boss.baseHp + MAPS[tier].boss.perPlayer * Math.max(0, participants - 1);
export function newBoss(slot, tier, rng, chatId, {previousName=null,readyKeys}={}) {
  const hp = bossMaxHp(tier, 1);
  const pool=monsterPool(tier,'boss',readyKeys?{readyKeys}:undefined),last=pool.findIndex(m=>m.name===previousName),identity=pool[(last+1)%pool.length];
  return { id: slot.id, chat_id: String(chatId || ''), map_id: tier, name: identity.name, element: pick(rng, ELEMENT_KEYS), base_hp: hp, max_hp: hp, hp, participants: 0,
    started_at: slot.start, ends_at: slot.end, status: 'active' };
}
export const attackWindow = (boss, now) => Math.floor((now - boss.started_at) / BOSS.attackWindowMs);



/** one attack = 5 skill casts (MP from inventory), then the boss counter-attacks (red potions). mutates c / inv */
export function performAttack({ c, inv, stats, boss, rng, now }) {
  const s=stats,mapTier=mapForLevel(c.level),used={};
  const drink=k=>{inv[k]-=1;used[k]=(used[k]||0)+1;};
  const a=combatActor(c,s),x=a.special,old=x.bossCombat;
  const encounterId=String(boss.id||`map:${boss.map_id}`);
  if(old?.id===encounterId){a.buffs=old.buffs||[];a.summon=old.summon;}
  const enemy={hp:boss.hp??boss.max_hp,maxHp:boss.max_hp,def:0,element:boss.element,level:boss.map_id*10,
    elementResist:bossResistance(boss.map_id*10,boss.element),buffs:old?.id===encounterId?old.enemy?.buffs||[]:[],
    dots:old?.id===encounterId?old.enemy?.dots||[]:[],windup:true,interruptible:!boss.uninterruptible,
    damageBudget:Math.max(1,Math.floor(boss.max_hp*BOSS.maxDamagePctPerAttack))};
  const helper=c.level>MAPS[boss.map_id].max;
  // The helper modifier applies equally to native, special and periodic attacks.
  const originalAtk=a.atk;if(helper)a.atk*=BOSS.helperDamageMult;
  let crits=0,basics=0;const actions=[],beforeHp=enemy.hp;
  const beforePeriodic={hp:a.hp,mp:a.mp,enemyHp:beforeHp};periodic([a],enemy,now);
  if(enemy.hp<beforeHp)actions.push({skillId:'periodic',label:'召喚／持續傷害',damage:beforeHp-enemy.hp,before:beforePeriodic,after:{hp:a.hp,mp:a.mp,enemyHp:enemy.hp}});
  for(let i=0;i<BOSS.castsPerAttack&&enemy.hp>0;i++){
    const before={hp:a.hp,mp:a.mp,enemyHp:enemy.hp};
    const action=autoPartyAction(a,[a],enemy,now,{});let outcome,label;
    if(action.skillId!=='attack'){
      const skill=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp,affixPct:a.affixPct},x,action.skillId,now);
      outcome=castSpecial(a,[a],enemy,skill,a.id,now,rng,{});label=skill.name;
    }else{
      if(a.mp<s.skill.cost&&c.auto_blue){let key;while(a.mp<s.skill.cost&&(key=choosePotion(inv,'blue',mapTier))){drink(key);a.mp=Math.min(s.maxMp,a.mp+POTIONS[key].heal);}}
      const cast=a.mp>=s.skill.cost,spentMp=cast?spendMana(a,s.skill.cost,rng):0;
      if(!cast)basics++;
      let raw=a.atk*s.skill.mult*(cast?1+.1*(s.skill.targets-1):.35);
      raw*=(1+valueOf(a,'atkUp',now))*(1+valueOf(a,'damageUp',now))*(1+valueOf(a,'nextDamage',now));
      const crit=rng()<Math.min(.8,a.crit+valueOf(a,'critUp',now));if(crit)raw*=1.5;raw*=.9+rng()*.2;
      const damage=damageEnemy(enemy,raw,{},now,a),sustain=restoreOnAction(a,damage,{cast,enabled:enemy.hp>0});
      outcome={damage,crit,spentMp,healed:sustain.healed};label=cast?s.skill.name:'普通攻擊';
      for(const b of a.buffs)if(['nextDamage','critUp'].includes(b.type)&&b.uses>0)b.uses--;
    }
    if(outcome.crit)crits++;actions.push({skillId:action.skillId,label,...outcome,before,after:{hp:a.hp,mp:a.mp,enemyHp:enemy.hp}});
  }
  const r=Math.min(2,Math.max(.3,s.r??1));
  const counter=enemy.hp>0&&!enemy.interrupted?receiveDamage(a,BOSS.counterHpPct*s.maxHp/r*(1-valueOf(enemy,'enemyNextReduce',now)),[a],enemy,now,{defApplied:true}):0;
  {let key;while(a.hp<(c.auto_red_pct/100)*s.maxHp&&(key=choosePotion(inv,'red',mapTier))){drink(key);a.hp=Math.min(s.maxHp,a.hp+POTIONS[key].heal);}}
  const downed=a.hp<=0;if(downed){a.hp=1;c.boss_down_until=now+BOSS.downMs;}
  a.atk=originalAtk;c.hp=a.hp;c.mp=a.mp;
  x.bossCombat={id:encounterId,buffs:a.buffs.filter(b=>b.until>now&&(b.uses==null||b.uses>0)),summon:a.summon,enemy:{buffs:enemy.buffs,dots:enemy.dots}};saveSpecial(c,x);
  return {damage:beforeHp-enemy.hp,crits,basics,counter,used,downed,helper,elementMult:elementMultiplier(s.element,boss.element),actions,interrupted:!!enemy.interrupted};
}

/** integer allocation that conserves `total` (pet system's largest-remainder method) */
export function largestRemainder(total, weights) {
  const entries = Object.entries(weights).filter(([, w]) => Number.isFinite(w) && w > 0);
  const sum = entries.reduce((n, [, w]) => n + w, 0); if (!sum || total <= 0) return {};
  const shares = entries.map(([k, w]) => { const exact = (total * w) / sum; return { k, n: Math.floor(exact), f: exact - Math.floor(exact) }; });
  let left = total - shares.reduce((n, s) => n + s.n, 0);
  shares.sort((a, b) => b.f - a.f || a.k.localeCompare(b.k));
  for (let i = 0; i < left; i++) shares[i % shares.length].n += 1;
  return Object.fromEntries(shares.map((s) => [s.k, s.n]));
}

/**
 * Loot on kill. attackers: [{ tg_id, damage, char, inv, lootToday }]
 * - material ×1 to every attacker who needs it (not affected by the daily loot cap)
 * - gold pool 1,500 × tier × attackers, by damage (helpers ×1.5 weight); players over the daily cap get 20% of their share
 * - one boss gear, uniformly random among attackers under the cap
 */
export function lootPlan(boss, attackers, rng) {
  const t = boss.map_id; const n = attackers.length;
  const materials = attackers.filter((a) => needsMaterial(a.char, a.inv, t)).map((a) => a.tg_id);
  const weights = Object.fromEntries(attackers.map((a) => [a.tg_id, a.damage * (needsMaterial(a.char, a.inv, t) ? 1 : BOSS.helperGoldWeight)]));
  const raw = largestRemainder(BOSS.goldPerTierPerPlayer * t * n, weights);
  const gold = {}; const capped = new Set(attackers.filter((a) => a.lootToday >= BOSS.fullLootPerDay).map((a) => a.tg_id));
  for (const [k, v] of Object.entries(raw)) gold[k] = capped.has(k) ? Math.floor(v * BOSS.cappedGoldPct) : v;
  const pool = attackers.filter((a) => !capped.has(a.tg_id) && a.damage > 0); let gear = null;
  if (pool.length) gear = pool[Math.floor(rng() * pool.length)].tg_id;
  return { materials, gold, gear, capped: [...capped] };
}

/**
 * v0.4 遺物 on a group-boss kill: 35% chance (RELIC.bossChance) of exactly ONE relic. The winner is drawn by weight =
 * damage share + 0.10/N (× mult, 0.2 for attackers past the daily full-loot cap), so every attacker has a non-zero chance.
 * attackers: [{ tg_id, damage, mult? }] → [] or [tg_id]
 */
export function relicPlan(attackers, rng) {
  const pool = attackers.filter((a) => a.damage > 0); if (!pool.length) return [];
  const total = pool.reduce((s, a) => s + a.damage, 0),baseWeight=a=>(a.damage/total+RELIC.bossFloorShare/pool.length)*(a.mult??1),w=a=>baseWeight(a)*guardianLootMultiplier(a.char||a);
  const baseSum=pool.reduce((s,a)=>s+baseWeight(a),0),sum=pool.reduce((s,a)=>s+w(a),0);
  // Scale the shared roll AND recipient weights: each owner's unconditional
  // chance receives their relative loot bonus while the group gets at most one.
  if(rng()>=Math.min(1,RELIC.bossChance*sum/baseSum))return [];
  let x = rng() * sum;
  for (const a of pool) { x -= w(a); if (x <= 0) return [a.tg_id]; }
  return [pool[pool.length - 1].tg_id];
}
export const relicChances = (attackers) => {   // per-draw probabilities (for the UI / tests)
  const p = attackers.filter((a) => a.damage > 0); const total = p.reduce((s, a) => s + a.damage, 0); const sum = 1 + RELIC.bossFloorShare;
  return Object.fromEntries(p.map((a) => [a.tg_id, (a.damage / total + RELIC.bossFloorShare / p.length) / sum]));
};

