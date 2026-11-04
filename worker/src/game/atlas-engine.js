import {
  ATLAS_RULESET_VERSION, ATLAS_MAX_DURATION_SECONDS, ATLAS_MAX_MAP_COUNT,
  ATLAS_MAX_ADVANCE_STEPS, ATLAS_PROTOTYPE_PROFILE, ATLAS_SUPPORTS,
  ATLAS_AUTOMATION, ATLAS_SUPPORTED_RULESETS, ATLAS_QUEUE_MODES, getAtlasBuild, getAtlasMap,
} from './atlas-catalog.js';
import {applyAtlasTalentSnapshot} from './atlas-talents.js';
import { createAtlasCombatObserver } from './atlas-combat-observer.js';

/** Pure rules only. The API must authorize the realm/character, enforce map
 * minLevel/prerequisites, reserve supplies, pause legacy idle, and atomically
 * persist state + unique reward receipts.
 * All clocks are Unix SECONDS; never pass Date.now() without dividing by 1000.
 * Catalog coefficients are a prototype and require live-population calibration.
 */
export class AtlasRuleError extends Error {
  constructor(code, message) { super(message); this.name = 'AtlasRuleError'; this.code = code; this.status = 400; }
}
const fail = (code, message) => { throw new AtlasRuleError(code, message); };
const clone = value => structuredClone(value);
const round = value => Math.round(value * 1000) / 1000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
function number(value, key, low, high, fallback, integer = false) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < low || result > high || (integer && !Number.isInteger(result))) {
    fail('atlas_invalid_input', `${key} 超出有效範圍`);
  }
  return result;
}
function identifier(value, key) {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value)) || !String(value).trim() || String(value).length > 160) fail('atlas_invalid_input', `${key} 無效`);
  return String(value);
}
function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); }
  return result >>> 0 || 1;
}
function random(state, stream = 'combatRng') {
  let value = state[stream];
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state[stream] = value >>> 0;
  return state[stream] / 4294967296;
}

/** The only accepted character inputs are already-computed server combat stats.
 * computeStats has ALREADY applied enhance_level and hitAttackMultiplier to atk.
 * This adapter never scales stored gear, changes +N, or re-applies that multiplier.
 */
export function normalizeAtlasSnapshot(input) {
  if (!input || typeof input !== 'object') fail('atlas_invalid_snapshot', '缺少角色戰力快照');
  const baseClass = input.baseClass ?? input.base_class;
  if (!['sword', 'archer', 'mage', 'thief'].includes(baseClass)) fail('atlas_invalid_snapshot', '不支援的職業');
  const pct = {};
  for (const key of ['critPct', 'dotPct', 'summonPct', 'shieldPct', 'mpEfficiencyPct', 'mpCostPct', 'skillHastePct', 'lifestealPct', 'healPerCastPct','skillDamagePct']) {
    pct[key] = number(input.pct?.[key], `pct.${key}`, -.9, 3, 0);
  }
  const result = {
    characterId: identifier(input.characterId ?? input.id, 'characterId'), baseClass,
    level: number(input.level, 'level', 1, 10000, 1, true),
    atk: number(input.atk, 'atk', 0, 100000000, undefined),
    def: number(input.def, 'def', 0, 100000000, 0),
    maxHp: number(input.maxHp, 'maxHp', 1, 100000000, undefined),
    maxMp: number(input.maxMp, 'maxMp', 0, 100000000, 0),
    taken: number(input.taken, 'taken', .01, 10, 1),
    attackSpeedMultiplier: number(input.attackSpeedMultiplier, 'attackSpeedMultiplier', .1, 4, 1),
    // Kept only for an audit trail; atk already includes this native multiplier.
    hitAttackMultiplier: number(input.hitAttackMultiplier, 'hitAttackMultiplier', .01, 10, 1),
    pct,
  };
  result.hp = number(input.hp, 'hp', 1, result.maxHp, result.maxHp);
  result.mp = number(input.mp, 'mp', 0, result.maxMp, result.maxMp);
  result.mpRegenPerSecond = number(input.mpRegenPerSecond, 'mpRegenPerSecond', 0, result.maxMp, round(result.maxMp * .006));
  return result;
}

function profileSnapshot(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('atlas_invalid_input', 'profile 無效');
  const profile = { ...ATLAS_PROTOTYPE_PROFILE, id: identifier(input.id ?? ATLAS_PROTOTYPE_PROFILE.id, 'profile.id') };
  for (const key of ['enemyHpMultiplier', 'enemyDamageMultiplier', 'enemyDefenseMultiplier', 'rewardMultiplier', 'travelMultiplier']) {
    profile[key] = number(input[key], `profile.${key}`, .05, 100, profile[key]);
  }
  // Legacy profiles scale both currencies together; explicit fields override
  // each currency independently without changing materials or old run snapshots.
  for (const key of ['goldMultiplier', 'experienceMultiplier']) {
    profile[key] = number(input[key], `profile.${key}`, .05, 100, profile.rewardMultiplier);
  }
  return profile;
}

function skillSnapshot(build, supportIds, snapshot) {
  if (!Array.isArray(supportIds) || supportIds.length > 2 || new Set(supportIds).size !== supportIds.length) fail('atlas_invalid_support', '最多兩個不同輔助');
  const skill = clone(build);
  skill.damageMultiplier = 1+(snapshot.pct.skillDamagePct||0);
  skill.durationMultiplier = 1;
  skill.costMultiplier = clamp(1 + snapshot.pct.mpCostPct, .1, 4) * clamp(1 - snapshot.pct.mpEfficiencyPct, .2, 2);
  skill.cooldownMultiplier = clamp(1 - snapshot.pct.skillHastePct, .25, 2);
  skill.supportShieldFraction = 0;
  for (const id of supportIds) {
    const support = ATLAS_SUPPORTS.find(row => row.id === id);
    if (!support || (support.requires && !support.requires.some(tag => build.tags.includes(tag)))) fail('atlas_invalid_support', '輔助不適用這個主技能');
    skill.damageMultiplier *= support.damageMultiplier;
    skill.costMultiplier *= support.costMultiplier;
    skill.durationMultiplier *= support.durationMultiplier || 1;
    skill.cooldownMultiplier *= support.cooldownMultiplier || 1;
    skill.supportShieldFraction += support.shieldFraction || 0;
    skill.targets += support.extraTargets || 0;
  }
  // Focus overrides expansion independent of support order.
  if (supportIds.includes('focused')) skill.targets = 1;
  skill.targets = Math.min(5, skill.targets);
  skill.cost = Math.max(1, Math.ceil((build.cost + (build.manaFraction || 0) * snapshot.maxMp) * skill.costMultiplier));
  skill.cooldown = Math.max(.25, build.cooldown * skill.cooldownMultiplier / snapshot.attackSpeedMultiplier);
  return skill;
}

/** startAt/startedAt, now, and durationSeconds are measured in seconds.
 * profile and potion restoration values are SERVER-ONLY inputs. Never accept
 * them from an API payload. Reserve real potion quantities before creating a run.
 */
export function createAtlasRun(input) {
  if (!input || typeof input !== 'object') fail('atlas_invalid_input', '缺少派遣資料');
  const {snapshot,talents}=applyAtlasTalentSnapshot(normalizeAtlasSnapshot(input.snapshot),input.talentIds||[]);
  const build = getAtlasBuild(input.buildId);
  const map = getAtlasMap(input.mapId);
  if (!build || build.baseClass !== snapshot.baseClass) fail('atlas_invalid_build', '流派與角色職業不符');
  if (!map || !map.available) fail('atlas_invalid_map', '星圖尚未開放');
  if (input.ruleset_version && input.ruleset_version !== ATLAS_RULESET_VERSION) fail('atlas_ruleset_unsupported', '不支援的星圖規則版本');
  const startedAt = number(input.startedAt ?? input.startAt, 'startAt', 0, Number.MAX_SAFE_INTEGER - ATLAS_MAX_DURATION_SECONDS, undefined);
  const durationSeconds = number(input.durationSeconds, 'durationSeconds', 1, ATLAS_MAX_DURATION_SECONDS, ATLAS_MAX_DURATION_SECONDS, true);
  const queueMode = input.queueMode ?? 'count';
  if (!ATLAS_QUEUE_MODES.some(mode => mode.id === queueMode)) fail('atlas_invalid_queue', '不支援的出征方式');
  if (queueMode === 'duration' && input.mapCount != null) fail('atlas_invalid_queue', '持續探索不使用張數上限');
  const mapCount = queueMode === 'count' ? number(input.mapCount, 'mapCount', 1, ATLAS_MAX_MAP_COUNT, 1, true) : null;
  const seed = identifier(input.seed, 'seed');
  const automation = input.automation ?? 'balanced';
  if (!ATLAS_AUTOMATION.some(row => row.id === automation)) fail('atlas_invalid_automation', '不支援的自動施放策略');
  const supports = input.supports ?? [];
  const skill = skillSnapshot(build, supports, snapshot);
  const profile = profileSnapshot(input.profile);
  const mapSnapshot = clone(map);
  for (const enemy of [mapSnapshot.enemy, mapSnapshot.elite]) {
    enemy.hp = Math.max(1, Math.round(enemy.hp * profile.enemyHpMultiplier));
    enemy.atk = Math.max(1, Math.round(enemy.atk * profile.enemyDamageMultiplier));
    enemy.def = Math.round(enemy.def * profile.enemyDefenseMultiplier);
  }
  mapSnapshot.entrySeconds = Math.ceil(mapSnapshot.entrySeconds * profile.travelMultiplier);
  mapSnapshot.travelSeconds = Math.ceil(mapSnapshot.travelSeconds * profile.travelMultiplier);
  const hp = number(input.supplies?.hp, 'supplies.hp', 0, 10000, 0, true);
  const mp = number(input.supplies?.mp, 'supplies.mp', 0, 10000, 0, true);
  return {
    ruleset_version: ATLAS_RULESET_VERSION, runId: identifier(input.runId, 'runId'), realmId: identifier(input.realmId, 'realmId'),
    seed, encounterRng: hash(`encounter:${seed}`), combatRng: hash(`combat:${seed}`), lootRng: hash(`loot:${seed}`),
    startedAt, processedAt: startedAt, durationSeconds, elapsedSeconds: 0,
    status: 'running', stopReason: null, endedAt: null,
    snapshot, balanceProfile: profile,talentSnapshot:talents,
    buildId: build.id, supports: [...supports], automation, skill,
    mapId: map.id, map: mapSnapshot, queueMode, mapCount, mapIndex: 0, roomIndex: 0,
    transitionSeconds: mapSnapshot.entrySeconds, enemies: [],
    hero: { hp: snapshot.hp, mp: snapshot.mp, shield: 0, nextActionAt: 0, nextSkillAt: 0, combo: 0, pets: [], traps: [] },
    supplies: {
      hp, mp, hpInitial: hp, mpInitial: mp, hpUsed: 0, mpUsed: 0,
      hpRestore: number(input.supplies?.hpRestore, 'supplies.hpRestore', 1, 100000000, 50),
      mpRestore: number(input.supplies?.mpRestore, 'supplies.mpRestore', 1, 100000000, 40),
      lastHpAt: -1, lastMpAt: -1,
    },
    rewardSequence: 0,
    totals: { gold: 0, exp: 0, materials: {} },
    metrics: {
      combatSeconds: 0, packCombatSeconds: 0, eliteCombatSeconds: 0, bossCombatSeconds: 0,
      travelSeconds: 0, damage: 0, dotDamage: 0, petDamage: 0, counterDamage: 0,
      damageTaken: 0, shieldAbsorbed: 0, blockedDamage: 0, blocks: 0,
      casts: 0, basicAttacks: 0, manaSpent: 0, manaDenied: 0, kills: 0, roomsCleared: 0, mapsCompleted: 0,
      hpRestored: 0, mpRestored: 0, executeHits: 0, comboBursts: 0, trapsTriggered: 0,
    },
    events: [],
  };
}

const alive = state => state.enemies.filter(enemy => enemy.hp > 0);
const event = (state, type, details = {}) => {
  state.events.push({ at: state.elapsedSeconds, type, ...details });
  if (state.events.length > 24) state.events.shift();
};
function finish(state, status, reason) {
  state.status = status; state.stopReason = reason; state.endedAt = state.startedAt + state.elapsedSeconds;
  event(state, status, { reason });
}
function spawnRoom(state) {
  const elite = state.roomIndex >= state.map.packRooms;
  const spec = elite ? state.map.elite : state.map.enemy;
  const rank = state.map.kind === 'boss' ? 'boss' : elite ? 'elite' : 'normal';
  state.enemies = Array.from({ length: spec.count }, (_, index) => {
    const maxHp = Math.max(1, Math.round(spec.hp * (.94 + random(state, 'encounterRng') * .12)));
    return { id: `${state.mapIndex}:${state.roomIndex}:${index}`, name: elite ? state.map.eliteName : state.map.enemyName,
      rank, maxHp, hp: maxHp, atk: spec.atk, def: spec.def,
      attackInterval: spec.attackInterval,
      nextAttackAt: state.elapsedSeconds + spec.attackInterval + index * .25,
      chilledUntil: 0, dots: [] };
  });
  state.hero.nextActionAt = state.elapsedSeconds + .001;
  state.hero.traps = [];
  event(state, 'room_entered', { mapIndex: state.mapIndex, roomIndex: state.roomIndex, rank, enemies: spec.count });
}

function shield(state, fraction) {
  if (fraction <= 0) return;
  const amount = Math.round(state.snapshot.maxHp * fraction * clamp(1 + state.snapshot.pct.shieldPct, .1, 4));
  state.hero.shield = Math.min(Math.round(state.snapshot.maxHp * .45), state.hero.shield + amount);
}
function drinkHp(state) {
  const { hero, supplies, snapshot } = state;
  if (hero.hp <= 0 || hero.hp > snapshot.maxHp * .4 || supplies.hp <= 0 || supplies.lastHpAt === state.elapsedSeconds) return;
  const restored = Math.min(supplies.hpRestore, snapshot.maxHp - hero.hp);
  hero.hp += restored; supplies.hp--; supplies.hpUsed++; supplies.lastHpAt = state.elapsedSeconds;
  state.metrics.hpRestored += restored;
}
function drinkMp(state) {
  const { hero, supplies, snapshot } = state;
  if (supplies.mp <= 0 || hero.mp >= snapshot.maxMp || supplies.lastMpAt === state.elapsedSeconds) return;
  const restored = Math.min(supplies.mpRestore, snapshot.maxMp - hero.mp);
  hero.mp = round(hero.mp + restored); supplies.mp--; supplies.mpUsed++; supplies.lastMpAt = state.elapsedSeconds;
  state.metrics.mpRestored = round(state.metrics.mpRestored + restored);
}

function applyDot(state, enemy, source, duration, damage) {
  if (enemy.hp <= 0) return;
  const dots = enemy.dots.filter(dot => dot.source === source);
  if (dots.length >= state.skill.maxStacks) {
    const oldest = dots.reduce((result, dot) => dot.remaining < result.remaining ? dot : result);
    enemy.dots.splice(enemy.dots.indexOf(oldest), 1);
  }
  enemy.dots.push({ source, remaining: Math.ceil(duration), damage: Math.max(1, Math.round(damage)), appliedAt: state.elapsedSeconds });
}

function dealDamage(state, enemy, amount, source, critical = false, observation) {
  if (!enemy || enemy.hp <= 0) return 0;
  const mitigation = source === 'dot' ? 1 : 100 / (100 + enemy.def * 4);
  const critChance = clamp(.05 + state.snapshot.pct.critPct + (state.skill.critChance || 0), 0, .8);
  const crit = critical && random(state) < critChance ? 1.7 : 1;
  const hpBefore = enemy.hp;
  const damage = Math.min(enemy.hp, Math.max(1, Math.round(amount * mitigation * crit)));
  enemy.hp -= damage;
  state.metrics.damage += damage;
  if (source === 'dot') state.metrics.dotDamage += damage;
  if (source === 'pet') state.metrics.petDamage += damage;
  if (source === 'counter') state.metrics.counterDamage += damage;
  observation?.hit(enemy, { damage, source, critical: crit > 1, hpBefore, hpAfter: enemy.hp });
  if (source !== 'dot' && state.snapshot.pct.lifestealPct > 0) state.hero.hp = Math.min(state.snapshot.maxHp, state.hero.hp + Math.floor(damage * clamp(state.snapshot.pct.lifestealPct, 0, .2)));
  if (enemy.hp === 0) {
    state.metrics.kills++;
    // Death credit is common to direct hits, poison, pets, traps, and counters.
    event(state, 'enemy_defeated', { enemyId: enemy.id, source });
    if (state.skill.mechanic === 'poison') {
      const target = alive(state)[0];
      if (target) for (const dot of enemy.dots.filter(row => row.source === 'poison').slice(-2)) {
        applyDot(state, target, 'poison', Math.min(3, dot.remaining), dot.damage);
      }
    }
  }
  return damage;
}

function skillDamage(state, enemy, index = 0) {
  const { skill, snapshot } = state;
  let amount = snapshot.atk * skill.coefficient * skill.damageMultiplier;
  if (index > 0) amount *= skill.secondaryMultiplier || 1;
  if (skill.mechanic === 'execute' && enemy.hp <= enemy.maxHp * skill.executeThreshold) {
    amount *= skill.executeMultiplier; state.metrics.executeHits++;
  }
  return amount;
}

function cast(state, observer, actionAt) {
  const { hero, skill, snapshot } = state;
  const observation = observer?.beginCast(state, actionAt);
  hero.mp = round(hero.mp - skill.cost);
  state.metrics.manaSpent += skill.cost; state.metrics.casts++;
  shield(state, skill.supportShieldFraction + (skill.shieldFraction || 0));
  if (snapshot.pct.healPerCastPct > 0) hero.hp = Math.min(snapshot.maxHp, hero.hp + Math.round(snapshot.maxHp * Math.min(.2, snapshot.pct.healPerCastPct)));
  if (skill.mechanic === 'trap') {
    hero.traps.push({ triggerAt: state.elapsedSeconds + skill.trapDelay, targets: skill.targets, damage: snapshot.atk * skill.coefficient * skill.damageMultiplier });
    observation?.finish(state);
    return;
  }
  const targets = alive(state).slice(0, skill.targets);
  for (let index = 0; index < targets.length; index++) {
    const enemy = targets[index];
    dealDamage(state, enemy, skillDamage(state, enemy, index), 'skill', true, observation);
    if ((skill.mechanic === 'poison' || skill.mechanic === 'bleed') && enemy.hp > 0) {
      applyDot(state, enemy, skill.mechanic, skill.dotDuration * skill.durationMultiplier,
        snapshot.atk * skill.dotCoefficient * skill.damageMultiplier * clamp(1 + snapshot.pct.dotPct, .1, 4));
    }
    if (skill.mechanic === 'frost') enemy.chilledUntil = state.elapsedSeconds + skill.chillDuration;
  }
  if (skill.mechanic === 'beast') {
    const pet = { remaining: skill.petDuration, nextAttackAt: state.elapsedSeconds + 2,
      damage: snapshot.atk * skill.petCoefficient * skill.damageMultiplier * clamp(1 + snapshot.pct.summonPct, .1, 4) };
    if (hero.pets.length >= 2) hero.pets.sort((a, b) => a.remaining - b.remaining).shift();
    hero.pets.push(pet);
  }
  if (skill.mechanic === 'combo') {
    hero.combo = (hero.combo + 1) % 3;
    if (hero.combo === 0) {
      state.metrics.comboBursts++;
      for (let index = 0; index < 2; index++) {
        const target = alive(state)[0];
        if (target) dealDamage(state, target, snapshot.atk * skill.coefficient * skill.damageMultiplier, 'skill', true, observation);
      }
    }
  }
  observation?.finish(state);
}

function heroActions(state, observer) {
  const { hero, skill, snapshot } = state;
  const interval = 2 / snapshot.attackSpeedMultiplier;
  // Native speed affects event timestamps, not the number of settlement requests.
  for (let budget = 0; budget < 4 && hero.nextActionAt <= state.elapsedSeconds && alive(state).length; budget++) {
    const actionAt = hero.nextActionAt;
    hero.nextActionAt += interval;
    const enemies = alive(state);
    const strong = enemies.some(enemy => enemy.rank !== 'normal');
    const ready = actionAt + 1e-9 >= hero.nextSkillAt;
    const strategyAllows = state.automation === 'burst' || strong ||
      (state.automation === 'balanced' ? enemies.length > 1 || hero.mp >= snapshot.maxMp * .35 : hero.mp >= snapshot.maxMp * .5);
    if (ready && strategyAllows && hero.mp < skill.cost && skill.cost <= snapshot.maxMp && (state.automation === 'burst' || strong)) drinkMp(state);
    if (ready && strategyAllows && hero.mp >= skill.cost) {
      cast(state, observer, actionAt); hero.nextSkillAt = actionAt + skill.cooldown;
    } else {
      if (ready && strategyAllows && hero.mp < skill.cost) state.metrics.manaDenied++;
      state.metrics.basicAttacks++;
      dealDamage(state, enemies[0], snapshot.atk * .7, 'basic', true);
    }
  }
}

function periodic(state, observer) {
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    for (const dot of [...enemy.dots]) {
      if (dot.appliedAt >= state.elapsedSeconds) continue;
      const observation = observer?.beginEffect(state, 'dot', state.elapsedSeconds);
      dealDamage(state, enemy, dot.damage, 'dot', false, observation);
      observation?.finish(state);
      dot.remaining--;
      if (enemy.hp <= 0) break;
    }
    enemy.dots = enemy.dots.filter(dot => dot.remaining > 0);
  }
  for (const pet of state.hero.pets) {
    pet.remaining--;
    if (pet.nextAttackAt <= state.elapsedSeconds) {
      const enemy = alive(state)[0];
      if (enemy) {
        const observation = observer?.beginEffect(state, 'pet', pet.nextAttackAt);
        dealDamage(state, enemy, pet.damage, 'pet', false, observation);
        observation?.finish(state);
      }
      pet.nextAttackAt += 2;
    }
  }
  state.hero.pets = state.hero.pets.filter(pet => pet.remaining > 0);
  for (const trap of state.hero.traps) {
    if (trap.triggerAt > state.elapsedSeconds) continue;
    state.metrics.trapsTriggered++;
    const observation = observer?.beginEffect(state, 'trap', trap.triggerAt);
    for (const enemy of alive(state).slice(0, trap.targets)) dealDamage(state, enemy, trap.damage, 'trap', true, observation);
    observation?.finish(state);
  }
  state.hero.traps = state.hero.traps.filter(trap => trap.triggerAt > state.elapsedSeconds);
}

function enemyActions(state, observer) {
  const { hero, snapshot, skill } = state;
  for (const enemy of alive(state)) {
    if (enemy.hp <= 0 || enemy.nextAttackAt > state.elapsedSeconds) continue;
    const attackAt = enemy.nextAttackAt;
    drinkHp(state);
    let damage = Math.max(1, Math.round(enemy.atk * snapshot.taken * (100 / (100 + snapshot.def * 2))));
    const blocked = skill.mechanic === 'counter' && random(state) < skill.blockChance;
    if (blocked) {
      const prevented = Math.round(damage * skill.blockReduction);
      damage -= prevented; state.metrics.blocks++; state.metrics.blockedDamage += prevented;
    }
    const absorbed = Math.min(damage, hero.shield);
    hero.shield -= absorbed; damage -= absorbed; state.metrics.shieldAbsorbed += absorbed;
    const actual = Math.min(hero.hp, damage);
    hero.hp -= actual; state.metrics.damageTaken += actual;
    enemy.nextAttackAt += enemy.attackInterval * (enemy.chilledUntil > state.elapsedSeconds ? 1.5 : 1);
    if (hero.hp <= 0) { finish(state, 'dead', 'hp_depleted'); return; }
    if (blocked) {
      const observation = observer?.beginEffect(state, 'counter', attackAt);
      for (const target of alive(state).slice(0, 3)) {
        dealDamage(state, target, snapshot.atk * skill.counterCoefficient * skill.damageMultiplier, 'counter', true, observation);
      }
      observation?.finish(state);
    }
  }
}

function reward(state, rewards, kind) {
  const spec = state.map.rewards;
  const completion = kind === 'completion';
  const goldMultiplier = state.balanceProfile.goldMultiplier ?? state.balanceProfile.rewardMultiplier;
  const experienceMultiplier = state.balanceProfile.experienceMultiplier ?? state.balanceProfile.rewardMultiplier;
  const materials = completion
    ? { atlas_shard: 2, [spec.material]: 1 }
    : { atlas_shard: random(state, 'lootRng') < .35 ? 2 : 1 };
  const sequence = ++state.rewardSequence;
  const record = {
    id: `${state.runId}:reward:${sequence}`, runId: state.runId, realmId: state.realmId,
    sequence, mapId: state.mapId, mapIndex: state.mapIndex, roomIndex: state.roomIndex,
    kind, elapsedSeconds: state.elapsedSeconds,
    gold: Math.floor((completion ? spec.completionGold : spec.roomGold) * goldMultiplier),
    exp: Math.floor((completion ? spec.completionExp : spec.roomExp) * experienceMultiplier),
    materials,
  };
  state.totals.gold += record.gold; state.totals.exp += record.exp;
  for (const [key, amount] of Object.entries(materials)) state.totals.materials[key] = (state.totals.materials[key] || 0) + amount;
  rewards.push(record);
}

function clearRoom(state, rewards) {
  if (state.enemies.length === 0 || alive(state).length) return false;
  state.metrics.roomsCleared++;
  reward(state, rewards, 'room');
  state.roomIndex++;
  state.hero.traps = [];
  if (state.roomIndex >= state.map.roomCount) {
    state.metrics.mapsCompleted++;
    reward(state, rewards, 'completion');
    event(state, 'map_completed', { mapIndex: state.mapIndex });
    if (state.queueMode !== 'duration' && state.metrics.mapsCompleted >= state.mapCount) finish(state, 'completed', 'queue_completed');
    else {
      state.mapIndex++; state.roomIndex = 0; state.enemies = [];
      state.transitionSeconds = state.map.entrySeconds;
    }
  } else {
    state.enemies = []; state.transitionSeconds = state.map.travelSeconds;
  }
  return true;
}

function tick(state, rewards, observer) {
  state.elapsedSeconds++; state.processedAt = state.startedAt + state.elapsedSeconds;
  state.hero.mp = Math.min(state.snapshot.maxMp, round(state.hero.mp + state.snapshot.mpRegenPerSecond));
  if (state.transitionSeconds > 0) {
    state.transitionSeconds--; state.metrics.travelSeconds++;
    // Summons have a real lifetime, including travel between rooms.
    for (const pet of state.hero.pets) {
      pet.remaining--;
      // No missed attacks accumulate while travelling to the next encounter.
      pet.nextAttackAt = Math.max(pet.nextAttackAt, state.elapsedSeconds + 1);
    }
    state.hero.pets = state.hero.pets.filter(pet => pet.remaining > 0);
    if (state.transitionSeconds === 0) spawnRoom(state);
    return;
  }
  if (!state.enemies.length) spawnRoom(state);
  state.metrics.combatSeconds++;
  if (state.map.kind === 'boss') state.metrics.bossCombatSeconds++;
  else if (state.roomIndex >= state.map.packRooms) state.metrics.eliteCombatSeconds++;
  else state.metrics.packCombatSeconds++;
  periodic(state, observer);
  if (clearRoom(state, rewards)) return;
  heroActions(state, observer);
  if (clearRoom(state, rewards)) return;
  enemyActions(state, observer);
  if (state.status === 'running') clearRoom(state, rewards);
}

/** Returns only newly earned receipts. Commit them in the SAME transaction as
 * state, with UNIQUE(realm_id, receipt_id). Retrying the original input repeats
 * identical receipts; advancing the committed output emits no duplicates.
 * A maxSteps chunk never discards unprocessed elapsed time. Call again with the
 * returned state and SAME now while stillCatchingUp is true.
 * options.combatTrace enables a bounded, non-persistent observation sidecar.
 * It never changes state/rewards/RNG and is not public until the API commits.
 */
export function advanceAtlasRun(run, nowSeconds, options = {}) {
  if (!run || !ATLAS_SUPPORTED_RULESETS.includes(run.ruleset_version)) fail('atlas_ruleset_unsupported', '不支援的星圖規則版本');
  const now = number(nowSeconds, 'nowSeconds', 0, Number.MAX_SAFE_INTEGER, undefined);
  const maxSteps = number(options.maxSteps, 'maxSteps', 1, ATLAS_MAX_ADVANCE_STEPS, ATLAS_MAX_ADVANCE_STEPS, true);
  if (now < run.startedAt) fail('atlas_clock_before_start', '結算時間早於出發');
  const state = clone(run);
  const observer = options.combatTrace ? createAtlasCombatObserver(state, options.combatTrace) : null;
  const rewards = [];
  const target = Math.min(Math.floor(now - state.startedAt), state.durationSeconds);
  let steps = 0;
  while (state.status === 'running' && state.elapsedSeconds < target && steps < maxSteps) {
    tick(state, rewards, observer); steps++;
    if (state.status === 'running' && state.elapsedSeconds >= state.durationSeconds) finish(state, state.queueMode === 'duration' ? 'completed' : 'expired', 'duration_reached');
  }
  return { state, rewards, steps, processedAt: state.processedAt,
    stillCatchingUp: state.status === 'running' && state.elapsedSeconds < target,
    ...(observer ? { combatTrace: observer.snapshot() } : {}) };
}
