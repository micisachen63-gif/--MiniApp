// Byte-range support for looping banner / map videos (2026-11-12).
// Workers static assets answer `Range:` with a full 200 and no Accept-Ranges, which
// iOS Safari (Telegram iOS WebView) refuses to play as <video>. Only the paths listed
// in wrangler.toml [assets] run_worker_first reach this; everything else stays on the
// plain asset path. Reads only from the ASSETS binding; never touches game state.
const MEDIA = /\.(?:mp4|m4v|webm|mov)$/i;
export const RANGE_MEDIA_PREFIXES = Object.freeze([
  '/art/adventure-banners-20261112/', '/art/map-video/', '/art/star-ring-20261018/',
  '/art/guardian-cards-20261014/', '/art/guardian-scene-20261014/', '/art/guardian-result-20261014/',
  '/art/fate-chapter-20261016/', '/art/expedition-away-20261020/',
]);
export function isRangeMedia(pathname) {
  return MEDIA.test(pathname) && !pathname.includes('..') && RANGE_MEDIA_PREFIXES.some(prefix => pathname.startsWith(prefix));
}
// Single `bytes=a-b`, `bytes=a-` or `bytes=-n`. Anything else (multi-range, other units)
// is answered with the whole file, which RFC 9110 permits.
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start, end;
  if (match[1] === '') { const suffix = Number(match[2]); if (!(suffix > 0)) return { unsatisfiable: true }; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1); }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return { unsatisfiable: true };
  return { start, end };
}
export async function serveRangeMedia(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (!isRangeMedia(url.pathname)) {
    // Posters and other files in the same folders: unchanged plain asset response.
    return RANGE_MEDIA_PREFIXES.some(prefix => url.pathname.startsWith(prefix)) ? env.ASSETS.fetch(request) : null;
  }
  const forward = new Headers(request.headers); forward.delete('range'); forward.delete('if-range');
  const upstream = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET', headers: forward }));
  const headers = new Headers(upstream.headers); headers.set('Accept-Ranges', 'bytes');
  const range = request.headers.get('range'), ifRange = request.headers.get('if-range');
  const etag = upstream.headers.get('etag');
  const whole = () => new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  if (upstream.status !== 200 || !range || (ifRange && ifRange !== etag)) return whole();
  const body = await upstream.arrayBuffer(), size = body.byteLength, parsed = parseRange(range, size);
  if (!parsed) { headers.set('Content-Length', String(size)); return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers }); }
  if (parsed.unsatisfiable) {
    headers.set('Content-Range', `bytes */${size}`); headers.delete('Content-Length');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${parsed.start}-${parsed.end}/${size}`);
  headers.set('Content-Length', String(parsed.end - parsed.start + 1));
  return new Response(request.method === 'HEAD' ? null : body.slice(parsed.start, parsed.end + 1), { status: 206, headers });
}
