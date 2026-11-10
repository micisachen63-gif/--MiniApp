import { POTIONS } from './constants.js';
import { createAtlasRun, advanceAtlasRun, AtlasRuleError } from './atlas-engine.js';
import { ATLAS_POTION_KEYS, isVersionedAtlasSupplies } from './atlas-supplies.js';

/** Local calibration helper, never an HTTP handler. Pass an anonymized snapshot
 * from the real computeStats, keep the SAME seed/map/profile for before/after,
 * and change only the intended equipment or build. No production state is read.
 * Rates describe this finite simulation, not measured player retention or an
 * estimate of endless farming. Planned-hour rates include time after a stopped
 * run, while active-hour rates use actual simulated seconds including travel.
 */
export function benchmarkAtlasRun(input, { supplyPrices, target } = {}) {
  const prices = supplyPrices || { hp: POTIONS.red_1.price, mp: POTIONS.blue_1.price };
  for (const key of ['hp', 'mp']) if (!Number.isFinite(prices[key]) || prices[key] < 0) throw new AtlasRuleError('atlas_invalid_benchmark', '補給單價無效');
  let state = createAtlasRun(input);
  const rewards = [];
  let result;
  do {
    result = advanceAtlasRun(state, state.startedAt + state.durationSeconds);
    state = result.state;
    rewards.push(...result.rewards);
  } while (result.stillCatchingUp);
  // Itemized runs use the frozen server replacement price for each consumed
  // potion. The optional per-color calibration prices still apply to legacy runs.
  const supplyGoldSpent = isVersionedAtlasSupplies(state.supplies)
    ? ATLAS_POTION_KEYS.reduce((total, key) => total + state.supplies.usedItems[key] * state.supplies.priceByItem[key], 0)
    : state.supplies.hpUsed * prices.hp + state.supplies.mpUsed * prices.mp;
  const netGold = state.totals.gold - supplyGoldSpent;
  const activeRate = amount => amount * 3600 / Math.max(1, state.elapsedSeconds);
  const plannedRate = amount => amount * 3600 / state.durationSeconds;
  const summary = {
    rulesVersion: state.ruleset_version, profile: state.balanceProfile.id, balanceStatus: 'prototype',
    baseClass: state.snapshot.baseClass, level: state.snapshot.level, buildId: state.buildId,
    supports: [...state.supports], automation: state.automation, mapId: state.mapId, seed: state.seed,
    queueMode: state.queueMode || 'count',
    goldMultiplier: state.balanceProfile.goldMultiplier ?? state.balanceProfile.rewardMultiplier,
    experienceMultiplier: state.balanceProfile.experienceMultiplier ?? state.balanceProfile.rewardMultiplier,
    status: state.status, stopReason: state.stopReason, elapsedSeconds: state.elapsedSeconds,
    requestedDurationSeconds: state.durationSeconds, mapsCompleted: state.metrics.mapsCompleted,
    unusedPlannedSeconds: state.durationSeconds - state.elapsedSeconds,
    dispatchUtilization: state.elapsedSeconds / state.durationSeconds,
    packSeconds: state.metrics.packCombatSeconds, eliteSeconds: state.metrics.eliteCombatSeconds, bossSeconds: state.metrics.bossCombatSeconds,
    hpUsed: state.supplies.hpUsed, mpUsed: state.supplies.mpUsed, supplyGoldSpent,
    grossGold: state.totals.gold, netGold,
    netGoldPerActiveHour: activeRate(netGold), netGoldPerPlannedHour: plannedRate(netGold),
    exp: state.totals.exp, materials: { ...state.totals.materials },
    materialsPerActiveHour: Object.fromEntries(Object.entries(state.totals.materials).map(([key, amount]) => [key, activeRate(amount)])),
    nextUpgradeActiveSeconds: null,
  };
  if (target) {
    const costs = { ...target.materials, gold: target.gold ?? 0 };
    const waits = [];
    for (const [key, cost] of Object.entries(costs)) {
      if (!Number.isFinite(cost) || cost < 0) throw new AtlasRuleError('atlas_invalid_benchmark', '提升目標成本無效');
      if (cost === 0) continue;
      const earned = key === 'gold' ? netGold : state.totals.materials[key] || 0;
      waits.push(earned > 0 ? cost / earned * state.elapsedSeconds : Infinity);
    }
    const longest = waits.length ? Math.max(...waits) : 0;
    // A failed/expired dispatch cannot justify assuming indefinitely repeatable income.
    if (state.status === 'completed' && Number.isFinite(longest)) summary.nextUpgradeActiveSeconds = Math.ceil(longest);
  }
  return { summary, state, rewards };
}
