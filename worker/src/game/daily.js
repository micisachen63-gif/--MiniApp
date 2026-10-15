// Daily supply gold (pure). Idempotency is enforced in SQL (conditional UPDATE + ledger event_id).
import { dailyGold } from './formulas.js';
import { taipeiDay, daysBetween } from './time.js';
export const FIRST_WEEK_BONUS = 0.5;
export function dailyGoldFor(char, now) {
  const day = taipeiDay(now); const age = daysBetween(char.created_day, day);
  const base = dailyGold(char.level); const bonus = age >= 0 && age < 7 ? Math.round(base * FIRST_WEEK_BONUS) : 0;
  return { day, base, bonus, total: base + bonus, claimed: char.last_daily_gold_day === day, firstWeek: bonus > 0 };
}
