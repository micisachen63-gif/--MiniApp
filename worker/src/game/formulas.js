// EXP curve, daily gold and monster pressure — must match /workspace/elf-rpg/sim.py and exp_table.csv.
import { MAX_LEVEL } from './constants.js';

/** Python-style round (half to even) so the table matches sim.py exactly. */
export function pyRound(x, digits = 0) {
  const m = 10 ** digits; const v = x * m; const f = Math.floor(v); const diff = v - f;
  let r;
  if (Math.abs(diff - 0.5) < 1e-9) r = f % 2 === 0 ? f : f + 1; else r = Math.round(v);
  return r / m;
}

const MAP_DAYS = [5, 15, 25, 35];
const WEIGHTS = Array.from({ length: 30 }, (_, j) => 0.35 + ((j + 1) / 30) ** 1.3);
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0);

/** target hours for level L → L+1 (24h supplied, standard gear) */
export function targetHours(L) {
  const k = Math.min(3, Math.floor((L - 1) / 30)); const i = (L - 1) % 30;
  return MAP_DAYS[k] * 24 * WEIGHTS[i] / WEIGHT_SUM;
}
/** base EXP per tick at efficiency 1 */
export const expPerTick = (L) => pyRound(10 * L ** 1.3);
/** EXP needed for L → L+1 */
export function expToNext(L) {
  if (L >= MAX_LEVEL) return Infinity;
  return pyRound(expPerTick(L) * 60 * targetHours(L));
}
export const EXP_TABLE = Object.freeze(Array.from({ length: MAX_LEVEL + 1 }, (_, L) => (L >= 1 && L < MAX_LEVEL ? expToNext(L) : null)));

export const dailyGold = (L) => 600 + 70 * L;
export const monsterPressure = (L) => 1.2 + 0.30 * L ** 1.12;
export const mapForLevel = (L) => Math.min(12, Math.max(1, Math.ceil(L / 10)));
