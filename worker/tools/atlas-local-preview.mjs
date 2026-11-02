// Local, disposable playtest only. No Wrangler, secrets, remote DB or live assets.
// node worker/tools/atlas-local-preview.mjs --port=9642
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb } from '../test/d1-shim.js';
import { CurrentClientRequest } from '../test/client-request.js';
import { handle } from '../src/index.js';
import * as Player from '../src/services/player.js';
import { initializeRealmIdentity, resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';
import { CATALOG } from '../test/realm-test-helpers.js';

const argv = process.argv.slice(2);
if (argv.some(value => !/^--port=\d+$/.test(value)) || argv.length > 1) throw Error('Use --port=9642 only');
const port = Number(argv[0]?.split('=')[1] || 9642);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port');
// Deny network requests from any game handler, including notification delivery.
globalThis.fetch = async () => { throw Error('Outbound requests disabled in isolated Atlas preview'); };
const env = {
  DB: freshDb(), DB_SEASON: freshDb(), REALM_CATALOG_JSON: JSON.stringify(CATALOG),
  CURRENT_SEASON_ID: 'season_2026_01', ENVIRONMENT: 'development',
  ALLOW_DEV_AUTH: 'true', ATLAS_ENABLED: 'true',
};
const now = Date.now();
await initializeRealmIdentity(env, 'permanent', { now });
await initializeRealmIdentity(env, 'season_2026_01', { now });
const permanent = scopeEnvForRealm(env, await resolveRealm(env, 'permanent'));
const classes = [['sword', '測試劍士'], ['archer', '測試妖精'], ['mage', '測試法師'], ['thief', '測試盜賊']];
for (const [index, [baseClass, name]] of classes.entries()) {
  const player = await Player.createCharacter(permanent, { tgId: '90101', charSlot: index + 1, name, baseClass, gender: 'f' }, now);
  const id = player.char.tg_id, db = env.DB.sqlite;
  db.prepare('UPDATE rpg_characters SET level=15,gold=50000,last_settle_at=? WHERE tg_id=?').run(now, id);
  db.prepare("UPDATE rpg_equipment SET enhance_level=7 WHERE tg_id=? AND slot='weapon'").run(id);
  for (const item of ['red_1', 'blue_1']) db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,500) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=500').run(id, item);
  for (const material of ['atlas_shard', 'atlas_iron', 'atlas_ember', 'atlas_venom']) db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,100)').run(id, material);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__preview/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, isolated: true, ephemeral: true, productionAccess: false, realmCount: 2 }));
      return;
    }
    if (url.pathname.startsWith('/app/api/')) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024 * 1024) throw Error('Request too large');
      }
      const response = await handle(new CurrentClientRequest(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method, headers: req.headers, body,
      }), env);
      res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await response.text());
      return;
    }
    const requested = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    const file = path.resolve(root, '.' + decodeURIComponent(requested));
    if (!file.startsWith(root + path.sep)) throw Error('Invalid static path');
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
});
server.on('error', error => { console.error(error.message); env.DB.sqlite.close(); env.DB_SEASON.sqlite.close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({
  url: `http://127.0.0.1:${port}/?devTg=90101`, isolated: true, ephemeral: true,
  notice: '本機 POE 功能測試；四名測試角色；關閉後資料清除；9593 與正式機不受影響。',
})));
function close() { server.closeAllConnections(); server.close(() => { env.DB.sqlite.close(); env.DB_SEASON.sqlite.close(); }); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
