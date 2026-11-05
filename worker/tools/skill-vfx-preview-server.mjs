// Dedicated local, read-only VFX preview. No game API, mutation, or deployment.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const DEFAULT_ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp4': 'video/mp4',
}));
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function requestPath(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return null;
  let decoded;
  try { decoded = decodeURIComponent(target.split('?')[0]); } catch (_) { return null; }
  // Check raw decoded segments before URL/path normalization can erase traversal.
  if (/[\u0000-\u001f\\:]/.test(decoded) || decoded.startsWith('//')) return null;
  const segments = decoded.split('/');
  if (segments.some(part => part === '..' || part === '.' || part.startsWith('.'))) return null;
  return decoded;
}

/** Returned server does not listen until the caller explicitly starts it. */
export async function createSkillVfxPreviewServer({ publicRoot = DEFAULT_ROOT } = {}) {
  const root = await realpath(publicRoot);
  if (!(await stat(root)).isDirectory()) throw Error('VFX public root must be a directory.');
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      res.writeHead(status, {
        'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(req.method)) {
      send(405, 'Read-only preview: GET and HEAD only.', undefined, { Allow: 'GET, HEAD' }); return;
    }
    const decoded = requestPath(req.url);
    if (decoded === null) { send(400, 'Invalid asset path.'); return; }
    if (decoded === '/__vfx/health') {
      send(200, JSON.stringify({
        ok: true, service: 'star-journal-skill-vfx', readOnly: true, productionAccess: false,
        api: false, bind: '127.0.0.1', port: server.address()?.port ?? null,
        previewPath: '/preview-skill-vfx.html',
      }), 'application/json; charset=utf-8'); return;
    }
    if (decoded === '/favicon.ico') { send(204, ''); return; }
    const relative = decoded === '/' ? 'preview-skill-vfx.html' : decoded.slice(1);
    const candidate = path.resolve(root, relative);
    if (!within(root, candidate)) { send(403, 'Asset outside public root.'); return; }
    const type = TYPES.get(path.extname(candidate).toLowerCase());
    if (!type) { send(404, 'Asset not found.'); return; }
    try {
      const actual = await realpath(candidate);
      if (!within(root, actual)) { send(403, 'Asset outside public root.'); return; }
      const info = await stat(actual);
      if (!info.isFile()) { send(404, 'Asset not found.'); return; }
      if (res.destroyed) return;
      res.writeHead(200, {
        'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(actual);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      send(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : error.code === 'EACCES' ? 403 : 500,
        error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'Asset not found.' : 'Asset unavailable.');
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === '--port=9664')) {
    throw Error('Usage: node worker/tools/skill-vfx-preview-server.mjs [--port=9664]');
  }
  const server = await createSkillVfxPreviewServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(9664, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  console.log(JSON.stringify({
    url: 'http://127.0.0.1:9664/preview-skill-vfx.html', health: 'http://127.0.0.1:9664/__vfx/health',
    localOnly: true, readOnly: true, productionAccess: false, pid: process.pid,
  }));
  let closing = false;
  const stop = () => {
    if (closing) return; closing = true;
    server.closeAllConnections(); server.close();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.code === 'EADDRINUSE'
      ? 'Port 9664 is already in use; no existing process was stopped.'
      : error.message);
    process.exitCode = 1;
  });
}
