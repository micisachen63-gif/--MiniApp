import { ELEMENT_KEYS, MAPS } from './constants.js';
import { elementalDamage, mapElement, resistanceRate } from './elements.js';
import { spendMana } from './combat-passives.js';

// Independent of Atlas content/supply versions. Only new server-created runs
// opt in; absence on a saved run means the original combat and reward rules.
export const ATLAS_EFFECTS_RULES_VERSION = 'atlas-legacy-effects-v1';
export class AtlasEffectsError extends Error {
  constructor(code, message) { super(message); this.name = 'AtlasEffectsError'; this.code = code; }
}
const fail = (code, message) => { throw new AtlasEffectsError(code, message); };
const invalid = label => fail('atlas_invalid_effects', '星圖裝備效果快照無效：' + label);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
function finite(value, label, min, max, fallback) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) invalid(label);
  return n;
}
function record(value, label, fallback = {}) {
  if (value === undefined) return fallback;
  if (!object(value)) invalid(label);
  return value;
}
function hash(seed) {
  let n = 2166136261;
  for (const c of String(seed)) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619); }
  return n >>> 0 || 1;
}
function normalizeActor(input) {
  if (!object(input)) invalid('actor');
  const level = finite(input.level, 'level', 1, 10000, 1);
  if (!Number.isInteger(level)) invalid('level');
  const element = input.element === undefined ? null : input.element;
  if (element !== null && !ELEMENT_KEYS.includes(element)) invalid('element');
  const weaponElem = finite(input.weaponElem, 'weaponElem', 0, 100000000, 0);
  const points = record(input.elementResist, 'elementResist');
  const rates = record(input.elementResistance, 'elementResistance');
  if ([...Object.keys(points), ...Object.keys(rates)].some(key => !ELEMENT_KEYS.includes(key))) invalid('elementResist keys');
  const elementResist = {}, elementResistance = {};
  for (const key of ELEMENT_KEYS) {
    // Points are authoritative when both native representations are present.
    // A rate-only adapter is converted once, never applied as a second reduction.
    if (own(points, key)) elementResist[key] = finite(points[key], 'elementResist.' + key, 0, 100000000);
    else if (own(rates, key)) {
      const rate = finite(rates[key], 'elementResistance.' + key, 0, .4);
      elementResist[key] = rate * (6 * level + 100) / (1 - rate);
    } else elementResist[key] = 0;
    if (own(rates, key)) finite(rates[key], 'elementResistance.' + key, 0, .4);
    elementResistance[key] = resistanceRate({ level, elementResist }, key);
  }
  const source = record(input.pct, 'pct');
  const pct = {
    elemPct: Math.min(.5, Math.max(0, finite(source.elemPct, 'pct.elemPct', -100000000, 100000000, 0))),
    expPct: Math.min(.5, finite(source.expPct, 'pct.expPct', -.9, 100000000, 0)),
    freeCastPct: Math.min(1, Math.max(0, finite(source.freeCastPct, 'pct.freeCastPct', -100000000, 100000000, 0))),
  };
  return { level, element, weaponElem, elementResist, elementResistance, pct };
}

export function createAtlasEffects(version, sourceSnapshot, map, seed) {
  if (version === undefined) return null;
  if (version !== ATLAS_EFFECTS_RULES_VERSION) fail('atlas_effects_unsupported', '不支援的星圖裝備效果版本');
  if (!Number.isInteger(map?.themeId) || !own(MAPS, map.themeId)) invalid('map theme');
  const actor = normalizeActor(sourceSnapshot);
  // Atlas has no authored enemy resistance. Preserve zero resistance, including
  // bosses; importing legacy bossResistance here would silently retune them.
  const enemy = normalizeActor({ level: 1, element: mapElement(map.themeId) });
  return { version, actor, enemy, manaRng: hash('atlas-effects-mana-v1:' + seed) };
}

function validateActor(actor, label) {
  if (!object(actor) || !own(actor, 'level') || !own(actor, 'element') ||
      !own(actor, 'weaponElem') || !object(actor.pct) ||
      !object(actor.elementResist) || !object(actor.elementResistance)) invalid(label);
  for (const key of ELEMENT_KEYS) {
    if (!own(actor.elementResist, key) || !own(actor.elementResistance, key)) invalid(label + ' resistance');
  }
  for (const key of ['elemPct', 'expPct', 'freeCastPct']) if (!own(actor.pct, key)) invalid(label + ' pct');
  const normalized = normalizeActor(actor);
  for (const key of ['level', 'element', 'weaponElem']) {
    if (normalized[key] !== actor[key]) invalid(label + '.' + key);
  }
  for (const key of ['elemPct', 'expPct', 'freeCastPct']) {
    if (normalized.pct[key] !== actor.pct[key]) invalid(label + '.' + key);
  }
  for (const key of ELEMENT_KEYS) {
    if (Math.abs(normalized.elementResistance[key] - actor.elementResistance[key]) > 1e-12) invalid(label + ' resistance mismatch');
  }
}

/** Validate, never repair or upgrade, persisted effect state before any tick. */
export function validateAtlasEffects(run) {
  if (!own(run, 'effects')) {
    if (run.metrics && own(run.metrics, 'freeCasts')) invalid('missing effects');
    return false;
  }
  const effects = run.effects;
  if (!object(effects)) invalid('effects');
  if (effects.version !== ATLAS_EFFECTS_RULES_VERSION) fail('atlas_effects_unsupported', '不支援的星圖裝備效果版本');
  if (run.ruleset_version !== 'atlas-v4') invalid('content version');
  validateActor(effects.actor, 'actor');
  validateActor(effects.enemy, 'enemy');
  if (effects.actor.level !== run.snapshot?.level) invalid('actor level');
  if (!Number.isInteger(effects.manaRng) || effects.manaRng <= 0 || effects.manaRng > 0xffffffff) invalid('manaRng');
  if (!Number.isSafeInteger(run.metrics?.freeCasts) || run.metrics.freeCasts < 0 ||
      run.metrics.freeCasts > run.metrics.casts) invalid('freeCasts');
  return true;
}

export function atlasOutgoingDamage(state, raw, source) {
  if (!state.effects) return raw;
  // Direct attacks and the delayed one-shot trap receive the weapon flat bonus.
  // DOT/pets follow native source snapshots with no repeated flat bonus. Atlas
  // explicitly treats block-triggered counters the same way (not all native
  // skills named "counter" are reflected or periodic damage).
  const bonus = source === 'basic' || source === 'skill' || source === 'trap';
  return elementalDamage(raw, state.effects.actor, state.effects.enemy, { bonus });
}
export function atlasIncomingDamage(state, raw) {
  return state.effects ? elementalDamage(raw, state.effects.enemy, state.effects.actor, { bonus: false }) : raw;
}
export function atlasManaCost(state, cost) {
  if (!state.effects) return cost;
  // Call only after the original affordability/strategy/cooldown checks.
  // Reuse native spendMana: 0% consumes no roll; even 100% consumes one roll.
  // A dedicated persisted stream keeps this roll out of critical/block RNG.
  return spendMana({ mp: state.hero.mp, pct: state.effects.actor.pct }, cost, () => {
    let n = state.effects.manaRng;
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    state.effects.manaRng = n >>> 0;
    return state.effects.manaRng / 4294967296;
  });
}
export const atlasExperienceMultiplier = state => state.effects ? 1 + state.effects.actor.pct.expPct : 1;
