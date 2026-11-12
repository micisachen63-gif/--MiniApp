import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serveRangeMedia, parseRange, isRangeMedia, RANGE_MEDIA_PREFIXES } from '../src/media-range.js';

// 2026-11-12: production answered Range with a full 200 and no Accept-Ranges, so iOS
// Safari would not play the 冒險 banner mp4 loops. These paths now get proper 206s.
const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
function env({ status = 200, etag = '"v1"' } = {}) {
  const seen = [];
  return { seen, ASSETS: { async fetch(request) {
    seen.push({ url: request.url, range: request.headers.get('range'), method: request.method });
    if (status !== 200) return new Response(status === 304 ? null : 'nope', { status, headers: { etag } });
    return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '1000', etag, 'cache-control': 'public, max-age=3600' } });
  } } };
}
const url = 'https://example.invalid/art/adventure-banners-20261112/explore-1-dispatch.mp4';
const get = (headers = {}, method = 'GET', target = url) => new Request(target, { method, headers });

test('Range requests on banner videos return 206 with exact bytes and Content-Range', async () => {
  const e = env();
  for (const [range, start, end] of [['bytes=0-1', 0, 1], ['bytes=100-199', 100, 199], ['bytes=900-', 900, 999], ['bytes=-10', 990, 999], ['bytes=950-5000', 950, 999]]) {
    const r = await serveRangeMedia(get({ Range: range }), e);
    assert.equal(r.status, 206, range);
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.equal(r.headers.get('content-range'), `bytes ${start}-${end}/1000`);
    assert.equal(r.headers.get('content-length'), String(end - start + 1));
    assert.equal(r.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes.slice(start, end + 1));
  }
  assert.ok(e.seen.every(s => s.range === null && s.method === 'GET'), 'the asset binding is always asked for the whole file');
});
test('plain GET advertises ranges; unsatisfiable, multi-range and stale If-Range follow RFC 9110', async () => {
  const plain = await serveRangeMedia(get(), env());
  assert.equal(plain.status, 200); assert.equal(plain.headers.get('accept-ranges'), 'bytes'); assert.equal((await plain.arrayBuffer()).byteLength, 1000);
  const bad = await serveRangeMedia(get({ Range: 'bytes=1000-1001' }), env());
  assert.equal(bad.status, 416); assert.equal(bad.headers.get('content-range'), 'bytes */1000');
  const multi = await serveRangeMedia(get({ Range: 'bytes=0-1,5-6' }), env());
  assert.equal(multi.status, 200); assert.equal((await multi.arrayBuffer()).byteLength, 1000);
  const stale = await serveRangeMedia(get({ Range: 'bytes=0-1', 'If-Range': '"old"' }), env());
  assert.equal(stale.status, 200);
  const fresh = await serveRangeMedia(get({ Range: 'bytes=0-1', 'If-Range': '"v1"' }), env());
  assert.equal(fresh.status, 206);
  const head = await serveRangeMedia(get({ Range: 'bytes=0-9' }, 'HEAD'), env());
  assert.equal(head.status, 206); assert.equal(head.headers.get('content-length'), '10'); assert.equal(head.body, null);
  const notModified = await serveRangeMedia(get({ Range: 'bytes=0-9', 'If-None-Match': '"v1"' }), env({ status: 304 }));
  assert.equal(notModified.status, 304); assert.equal(notModified.headers.get('accept-ranges'), 'bytes');
  const missing = await serveRangeMedia(get({ Range: 'bytes=0-9' }), env({ status: 404 }));
  assert.equal(missing.status, 404);
});
test('only listed video folders are handled; posters there stay plain assets; API paths untouched', async () => {
  const e = env();
  assert.equal(await serveRangeMedia(get({}, 'GET', 'https://example.invalid/app/api/me'), e), null);
  assert.equal(await serveRangeMedia(get({}, 'POST', url), e), null);
  const poster = await serveRangeMedia(get({ Range: 'bytes=0-1' }, 'GET', url.replace('.mp4', '.webp')), e);
  assert.equal(poster.status, 200); assert.equal(e.seen.at(-1).range, 'bytes=0-1', 'poster request is forwarded unchanged');
  assert.equal(isRangeMedia('/art/adventure-banners-20261112/../x.mp4'), false);
  assert.equal(isRangeMedia('/art/other/x.mp4'), false);
  assert.equal(parseRange('items=0-1', 10), null);
});
test('wrangler run_worker_first lists exactly the folders the Worker slices', () => {
  const config = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /^binding = "ASSETS"/m);
  const listed = [...config.match(/run_worker_first = \[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(listed, RANGE_MEDIA_PREFIXES.map(prefix => prefix + '*'));
  for (const prefix of RANGE_MEDIA_PREFIXES) assert.ok(fs.existsSync(new URL('../public' + prefix, import.meta.url)), prefix);
});
