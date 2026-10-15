// Asia/Taipei is a fixed UTC+8 (no DST).
export const TPE_OFFSET_MS = 8 * 3_600_000;
export function taipeiDay(at = Date.now()) { return new Date(at + TPE_OFFSET_MS).toISOString().slice(0, 10); }
export function taipeiHM(at = Date.now()) { return new Date(at + TPE_OFFSET_MS).toISOString().slice(11, 16); }
/** epoch ms of Taipei local date (YYYY-MM-DD) at hour:00 */
export function taipeiAt(day, hour, minute = 0) { return Date.parse(`${day}T00:00:00Z`) - TPE_OFFSET_MS + hour * 3_600_000 + minute * 60_000; }
export function daysBetween(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000); }
/** ISO week key like 2026-W41 (Taipei) — used by the ladder (P2). */
export function isoWeek(at = Date.now()) {
  const d = new Date(at + TPE_OFFSET_MS); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
