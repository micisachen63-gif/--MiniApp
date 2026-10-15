import { computeStats } from '../src/game/stats.js';
import { makeGear } from '../src/game/gear.js';
import { mulberry32 } from '../src/game/rng.js';
export const T0 = Date.parse('2026-10-08T01:00:00Z'); // 09:00 Taipei
export function mkChar(over = {}) {
  const c = { tg_id: '111', name: '測試', gender: 'm', base_class: 'sword', class_path: '', level: 1, exp: 0, hp: 0, mp: 0, map_id: 1, idle_state: 'fighting', state_until: null,
    auto_red_pct: 50, auto_blue: 1, gold: 0, last_settle_at: T0, last_daily_gold_day: null, created_day: '2026-10-08', penalty_day: null, penalties_today: 0, deaths_total: 0,
    last_reselect_at: null, boss_down_until: null, pending_tier: null, rev: 0, ...over };
  const s = computeStats(c, []); if (!over.hp) c.hp = s.maxHp; if (!over.mp) c.mp = s.maxMp; return c;
}
export function starterGear(c, tier = 1) {
  const rng = mulberry32(7);
  const w = makeGear({ id: 'w1', tgId: c.tg_id, cls: c.base_class, slot: 'weapon', kind: { sword: 'sword', mage: 'staff', archer: 'longbow' }[c.base_class], tier, rng, now: T0, forceRarity: 'common' });
  const a = makeGear({ id: 'a1', tgId: c.tg_id, cls: c.base_class, slot: 'armor', kind: null, tier, rng, now: T0, forceRarity: 'common' });
  w.is_equipped = 1; a.is_equipped = 1; return [w, a];
}
