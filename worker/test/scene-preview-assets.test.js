import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
async function harness(entries = [], aliases = [], directories = []) {
  const files = new Map(entries.map(([name, body]) => [path.resolve(publicRoot, name), Buffer.from(body)]));
  const links = new Map(aliases.map(([name, target]) => [path.resolve(publicRoot, name), target]));
  const dirs = new Set(directories.map(name => path.resolve(publicRoot, name)));
  const access = [], streams = [];
  let handler;
  const server = { on() {}, listen() {}, closeAllConnections() {}, close() {} };
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
      if (dirs.has(file)) return { size: 0, isFile: () => false };
      if (!files.has(file)) throw missing();
      return { size: files.get(file).length, isFile: () => true };
    },
  };
  await vm.runInNewContext('(async()=>{' + source + '\n})()', {
    sourceUrl: sourceUrl.href, URL, path, fileURLToPath, pathToFileURL, fs,
    http: { createServer(callback) { handler = callback; return server; } },
    createReadStream(file) {
      streams.push(file);
      return { on() {}, destroy() {}, pipe(res) { res.end(files.get(file)); } };
    },
    spawn() { assert.fail('Asset handling must not start an API process'); },
    process: { argv: ['node', fileURLToPath(sourceUrl), '--grok-root=' + grokRoot, '--port=9703', '--api-port=9702'], once() {} },
    console: { log() {}, error(value) { assert.fail(String(value)); } },
  });
  return {
    access, streams,
    async request(url, method = 'GET') {
      const response = { status: null, headers: {}, body: undefined, headersSent: false,
        writeHead(status, headers = {}) { this.status = status; this.headers = headers; this.headersSent = true; },
        end(body) { this.body = body; }, on() {}, destroy() { assert.fail('Unexpected destroyed response'); } };
      await handler({ url, method }, response);
      return response;
    },
  };
}

test('dedicated button materials resolve only to public and retain GET/HEAD MIME and headers', async () => {
  const fixtures = [['ui/button-materials/frame.webp', 'webp bytes'], ['ui/button-materials/icon.png', 'png bytes'], ['ui/button-materials/buttons.css', 'button{}']];
  const h = await harness(fixtures);
  for (const [file, body] of fixtures) {
    const r = await h.request('/' + file + '?v=button-polish');
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.png') ? 'image/png' : 'image/webp');
    assert.equal(r.headers['Content-Length'], Buffer.byteLength(body));
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(r.body.toString(), body);
  }
  const before = h.streams.length, head = await h.request('/ui/button-materials/frame.webp', 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body, undefined); assert.equal(h.streams.length, before);
  assert.deepEqual(h.access, [...fixtures.map(([file]) => path.resolve(publicRoot, file)), path.resolve(publicRoot, fixtures[0][0])]);
});

test('button material route refuses similar prefixes, decoded traversal, backslashes and NUL before filesystem access', async () => {
  const h = await harness();
  for (const url of [
    '/ui/button-materials', '/ui/button-materials-old/frame.webp', '/ui/other/frame.webp', '/ui/button-materials/../private.webp',
    '/ui/button-materials/%2e%2e%2fprivate.webp', '/ui/button-materials/a%5c..%5cprivate.webp', '/ui/button-materials/%00frame.webp',
  ]) assert.equal((await h.request(url)).status, 404, url);
  assert.equal((await h.request('/ui/button-materials/frame.webp', 'POST')).status, 405);
  assert.deepEqual(h.access, []); assert.deepEqual(h.streams, []);
});

test('missing files, directories and realpaths outside public never fall back to generated art', async () => {
  const escaped = path.resolve(publicRoot, '../private.webp');
  const h = await harness([], [['ui/button-materials/link.webp', escaped]], ['ui/button-materials/folder']);
  for (const name of ['missing.webp', 'link.webp', 'folder']) assert.equal((await h.request('/ui/button-materials/' + name)).status, 404, name);
  assert.deepEqual(h.access, ['missing.webp', 'link.webp', 'folder'].map(name => path.resolve(publicRoot, 'ui/button-materials', name)));
  assert.deepEqual(h.streams, []);
});
