import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const sourceUrl = new URL('../tools/scene-live-preview.mjs', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8').replace(/^import .*;\r?$/gm, '').replaceAll('import.meta.url', 'sourceUrl');
const publicRoot = path.resolve(path.dirname(fileURLToPath(sourceUrl)), '../public');
const grokRoot = path.resolve(publicRoot, '../../../test-art-root');
const missing = () => Object.assign(Error('fixture asset absent'), { code: 'ENOENT' });

// Run the actual launcher handler with filesystem responses and inert process/listen
// boundaries. No HTTP listener, Atlas process, art files or real previews are started.
async function harness(entries = [], aliases = [], directories = [], environment = {}, extraArgs = [], hooks = {}) {
  const files = new Map(entries.map(([name, body]) => [path.resolve(publicRoot, name), Buffer.from(body)]));
  const links = new Map(aliases.map(([name, target]) => [path.resolve(publicRoot, name), target]));
  const dirs = new Set(directories.map(name => path.resolve(publicRoot, name)));
  const access = [], streams = [], logs = [], signals = new Map(), lifecycle = { created: 0, listening: false, closed: 0, connectionsClosed: 0, exitCalls: 0 };
  let handler;
  const server = { on() {}, listen(_port, _host, callback) { if (hooks.listen) { lifecycle.listening = true; callback(); } }, closeAllConnections() { lifecycle.connectionsClosed++; }, close() { lifecycle.closed++; } };
  const fs = {
    async realpath(value) {
      const file = path.resolve(value);
      if (file === grokRoot) return grokRoot;
      access.push(file);
      if (links.has(file)) return links.get(file);
      if (files.has(file) || dirs.has(file)) return file;
      throw missing();
    },
    async stat(file) {
      if (dirs.has(file)) return { size: 0, isFile: () => false, isDirectory: () => true };
      if (!files.has(file)) throw missing();
      return { size: files.get(file).length, isFile: () => true, isDirectory: () => false };
    },
    async readFile(file) {
      if (!files.has(file)) throw missing();
      return files.get(file);
    },
    async writeFile() { assert.fail('Attach reuse must not write snapshot files'); },
    async mkdir() { assert.fail('Attach reuse must not create snapshot directories'); },
  };
  await vm.runInNewContext('(async()=>{' + source + '\n})()', {
    sourceUrl: sourceUrl.href, URL, path, fileURLToPath, pathToFileURL, fs, createHash, AbortSignal,
    fetch: hooks.fetch || (() => assert.fail('Asset-only tests must not inspect a live API')),
    Math: Object.assign(Object.create(Math), { random() { assert.fail('Attach must not draw RNG'); } }),
    http: { createServer(callback) { lifecycle.created++; handler = callback; return server; } },
    createReadStream(file) {
      streams.push(file);
      return { on() {}, destroy() {}, pipe(res) { res.end(files.get(file)); } };
    },
    spawn() { assert.fail('Asset handling must not start an API process'); },
    process: { pid: 20000, env: environment, argv: ['node', fileURLToPath(sourceUrl), '--grok-root=' + grokRoot, '--port=9703', '--api-port=9702', ...extraArgs], once(signal, callback) { signals.set(signal, callback); }, exit() { lifecycle.exitCalls++; assert.fail('Preflight must finish naturally without process.exit'); } },
    console: { log(value) { logs.push(JSON.parse(value)); }, error(value) { assert.fail(String(value)); } },
  }, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  return {
    access, streams, logs, signals, lifecycle,
    async request(url, method = 'GET') {
      const response = { status: null, headers: {}, body: undefined, headersSent: false,
        writeHead(status, headers = {}) { this.status = status; this.headers = headers; this.headersSent = true; },
        end(body) { this.body = body; }, on() {}, destroy() { assert.fail('Unexpected destroyed response'); } };
      await handler({ url, method }, response);
      return response;
    },
  };
}

const hudNames = ['hud-v2.css', 'orb-bezel.webp', 'action-icons.webp', 'accepted-layout.json', 'source-manifest.json'];
test('HUD GET and HEAD run the production handler and serve only its worktree-local approved assets', async () => {
  const fixtures = hudNames.map(name => ['ui/hud-v2/' + name, readFileSync(new URL('../public/ui/hud-v2/' + name, import.meta.url))]);
  const h = await harness(fixtures);
  for (const [file, body] of fixtures) {
    const r = await h.request('/' + file + '?v=hud');
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.json') ? 'application/json; charset=utf-8' : 'image/webp');
    assert.equal(r.headers['Content-Length'], body.length); assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff'); assert.deepEqual(r.body, body);
    const count = h.streams.length, head = await h.request('/' + file, 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body, undefined); assert.equal(h.streams.length, count);
  }
  assert.ok(h.access.every(file => file.startsWith(publicRoot + path.sep)));
  assert.equal(h.lifecycle.listening, false, 'focused tests do not start or modify any preview service');
});
test('HUD allowlist rejects unknown files, similar prefixes, decoded traversal, backslashes and NUL before I/O', async () => {
  const h = await harness();
  for (const url of [
    '/ui/hud-v2', '/ui/hud-v2-old/orb-bezel.webp', '/ui/hud-v2/extra.webp', '/ui/hud-v2/hud-v2.js',
    '/ui/hud-v2/action-icons.png', '/ui/hud-v2/orb-bezel.webp/extra', '/ui/hud-v2/../private.webp',
    '/ui/hud-v2/%2e%2e%2fprivate.webp', '/ui/hud-v2/a%5c..%5cprivate.webp', '/ui/hud-v2/%00orb-bezel.webp',
  ]) assert.equal((await h.request(url)).status, 404, url);
  assert.equal((await h.request('/ui/hud-v2/orb-bezel.webp', 'POST')).status, 405);
  assert.deepEqual(h.access, []); assert.deepEqual(h.streams, []);
});
test('missing HUD assets, directories and symlink escapes never fall back to grok source', async () => {
  const h = await harness([], [['ui/hud-v2/orb-bezel.webp', path.resolve(publicRoot, '../private.webp')]], ['ui/hud-v2/action-icons.webp']);
  for (const name of ['hud-v2.css', 'orb-bezel.webp', 'action-icons.webp']) assert.equal((await h.request('/ui/hud-v2/' + name)).status, 404);
  assert.deepEqual(h.access, ['hud-v2.css', 'orb-bezel.webp', 'action-icons.webp'].map(name => path.resolve(publicRoot, 'ui/hud-v2', name)));
  assert.deepEqual(h.streams, []);
});
test('shipped WebP bytes and accepted manifest match the original recorded source digests', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/ui/hud-v2/source-manifest.json', import.meta.url), 'utf8'));
  for (const name of ['orb-bezel.webp', 'action-icons.webp', 'accepted-layout.json']) {
    const body = readFileSync(new URL('../public/ui/hud-v2/' + name, import.meta.url));
    const original = manifest.sources.find(entry => entry.path.replaceAll('\\', '/').endsWith('/hud-v2/' + name));
    assert.equal(createHash('sha256').update(body).digest('hex'), original.sha256);
  }
  const css = readFileSync(new URL('../public/ui/hud-v2/hud-v2.css', import.meta.url), 'utf8');
  assert.match(css, /url\('\/ui\/hud-v2\/action-icons\.webp'\)/);
  assert.doesNotMatch(css, /\/ui-generated-20261030\/hud-v2\/action-icons\.webp/);
});
