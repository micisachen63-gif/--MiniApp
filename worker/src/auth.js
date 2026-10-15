// Service-to-service auth (小精靈 → Worker) and Telegram WebApp initData verification (Mini App).
const enc = new TextEncoder();
export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a ?? '')); const y = enc.encode(String(b ?? ''));
  let diff = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
export function checkServiceSecret(request, env) {
  const secret = env.SERVICE_SECRET;
  if (!secret || String(secret).length < 16) return { ok: false, status: 503, error: 'not_configured' };
  return timingSafeEqual(request.headers.get('X-Service-Secret'), secret) ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' };
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Telegram WebApp initData check (same algorithm as the pet system). returns the user object or null */
export async function verifyInitData(initData, botToken, now = Date.now(), maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData); const hash = p.get('hash'); if (!hash) return null; p.delete('hash');
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', botToken);
  if (!timingSafeEqual(hex(await hmac(secret, dcs)), hash)) return null;
  const authDate = Number(p.get('auth_date')); const age = now / 1000 - authDate;
  if (!authDate || age > maxAgeSec || age < -300) return null;   // stale, or more than 5 min in the future
  try { return JSON.parse(p.get('user')); } catch { return null; }
}
