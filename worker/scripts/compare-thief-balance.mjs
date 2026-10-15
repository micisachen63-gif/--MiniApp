// Quantitative candidate-stat comparison. No database, player writes or remote API calls.
import { computeStats, standardSet, idleStats } from '../src/game/stats.js';
import { THIEF_PATHS, THIEF_CLASS } from '../src/game/thief-data.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const round = value => Math.round(value * 10000) / 10000;
const levels = [1, 30, 60, 90, 120];
const classes = ['thief', 'archer', 'sword', 'mage'];
const pathAt = level => ['', 'A', 'A1', 'A11', 'A111'][Math.floor(level / 30)];
const statsAt = (base_class, class_path, level) => computeStats({ base_class, class_path, level }, standardSet(base_class, level));
const ehp = stats => stats.maxHp * (1 + stats.def / 100) / stats.taken;
const native = stats => stats.atk * stats.skill.mult * stats.attackSpeedMultiplier * (1 + .5 * Math.min(.8, .05 + stats.pct.critPct));

export function compareThiefBalance() {
  const rows = levels.flatMap(level => classes.map(baseClass => {
    const path = pathAt(level), stats = statsAt(baseClass, path, level);
    return { level, baseClass, path, maxHp: stats.maxHp, def: stats.def, taken: round(stats.taken), atkPerStrike: stats.atk,
      attackSpeedMultiplier: stats.attackSpeedMultiplier, hitAttackMultiplier: stats.hitAttackMultiplier,
      nativeDamagePerBaselineUnit: round(native(stats)), ehpDef100: round(ehp(stats)) };
  }));
  const fragility = THIEF_PATHS.flatMap(path => {
    const thief = statsAt('thief', path, 120);
    return ['archer', 'sword', 'mage'].map(baseClass => {
      const other = statsAt(baseClass, path, 120);
      return { path, comparedWith: baseClass, hpRatio: round(thief.maxHp / other.maxHp), defRatio: round(thief.def / other.def), ehpRatio: round(ehp(thief) / ehp(other)) };
    });
  });
  const idle = levels.map(level => {
    const path = pathAt(level), stats = idleStats({ base_class: 'thief', class_path: path, level }, standardSet('thief', level));
    return { level, path, attackSpeedMultiplier: stats.attackSpeedMultiplier, hitAttackMultiplier: stats.hitAttackMultiplier,
      idleNativeDamageMultiplier: stats.idleNativeDamageMultiplier, killsPerTick: stats.killsPerTick, normalizedGearRatio: stats.r };
  });
  return {
    status: 'candidate-stat-proof-not-a-production-combat-claim', releaseReady: THIEF_CLASS.releaseReady,
    equipment: { tier: 'current map tier', rarity: 'common', enhancement: 0, rolls: 'midpoint', positions: 11,
      classArmor: 'same progression/quality; existing class armor-family scaling and passives retained', affixes: false, guardian: false, blessing: false },
    formulas: {
      nativeDamagePerBaselineUnit: 'ATK per strike * skill.mult * attackSpeedMultiplier * (1 + 0.5 * min(0.8, 0.05 + critPct))',
      ehpDef100: 'MaxHP * (1 + DEF / 100) / taken',
      exclusions: ['native estimate excludes enemy defense, elements, marks, poison, penetration, special skills, mana shortage and finite-fight rounding', 'EHP estimate excludes temporary smoke/counter protection, healing and enemy mechanics', 'actual strike scheduling is validated by separate combat-adapter tests'],
    },
    rows, fragility,
    maximumThiefEhpRatioAtLevel120: Math.max(...fragility.map(row => row.ehpRatio)),
    idle,
    idleBudgetExplanation: 'Idle rewards use a class-normalized budget, so apply frequency*per-strike potency = 1.08 once. The greater strike count divides this existing integer budget; it does not create a second reward or damage budget.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/thief/balance-comparison.json');
  const comparison = compareThiefBalance();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(comparison, null, 2) + '\n');
  const csv = ['level,baseClass,path,maxHp,def,taken,atkPerStrike,attackSpeedMultiplier,hitAttackMultiplier,nativeDamagePerBaselineUnit,ehpDef100',
    ...comparison.rows.map(row => Object.values(row).join(','))].join('\n') + '\n';
  writeFileSync(output.replace('.json', '.csv'), csv);
  console.log(JSON.stringify({ output, rows: comparison.rows.length, allRouteComparisons: comparison.fragility.length, maxEhpRatio: comparison.maximumThiefEhpRatioAtLevel120 }));
}
