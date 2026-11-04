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
import * as AtlasBackground from '../src/services/atlas-background.js';
import * as AutoEnhance from '../src/services/auto-enhance.js';
import * as AutoReroll from '../src/services/auto-reroll.js';
import {equipmentCollectionCatalog} from '../src/game/equipment-collection.js';
import {makeGear} from '../src/game/gear.js';
import {insertEquipStmt} from '../src/db.js';
import { initializeRealmIdentity, resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';
import { CATALOG } from '../test/realm-test-helpers.js';

const argv = process.argv.slice(2);
if (argv.some(value => !/^--(?:port=\d+|preview-origin=http:\/\/127\.0\.0\.1:\d+|vfx-fixture=long-targets)$/.test(value)) || argv.length > 3 || new Set(argv.map(v=>v.split('=')[0])).size!==argv.length) throw Error('Use --port=9642 [--preview-origin=http://127.0.0.1:9593] [--vfx-fixture=long-targets]');
const vfxFixture = argv.includes('--vfx-fixture=long-targets');
const port = Number(argv.find(v=>v.startsWith('--port='))?.split('=')[1] || 9642);
const previewOrigin=argv.find(v=>v.startsWith('--preview-origin='))?.slice('--preview-origin='.length)||'http://127.0.0.1:9593';
const previewPort=Number(new URL(previewOrigin).port);if(!Number.isInteger(previewPort)||previewPort<1024||previewPort>65535)throw Error('Invalid preview origin');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port');
// Deny network requests from any game handler, including notification delivery.
globalThis.fetch = async () => { throw Error('Outbound requests disabled in isolated Atlas preview'); };
const env = {
  DB: freshDb(), DB_SEASON: freshDb(), REALM_CATALOG_JSON: JSON.stringify(CATALOG),
  // Explicit local QA only: keep real targets alive long enough to inspect release/impact.
  ...(vfxFixture ? { ATLAS_PROFILE_JSON: JSON.stringify({ id: 'local-vfx-long-targets', enemyHpMultiplier: 20 }) } : {}),
  CURRENT_SEASON_ID: 'season_2026_01', ENVIRONMENT: 'development',
  ALLOW_DEV_AUTH: 'true', ATLAS_ENABLED: 'true', EQUIPMENT_COLLECTION_ENABLED:'true', EQUIPMENT_RECOVERY_ENABLED:'true',
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
  for (const [item,quantity] of [['red_1',500],['blue_1',500],['scroll_w',20],['scroll_a',20]]) db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id,item,quantity);
  for(const collection of equipmentCollectionCatalog(baseClass).filter(c=>c.tier===1))for(const r of collection.requirements){const item=makeGear({id:`collection-fixture:${id}:${r.slot}`,tgId:id,cls:baseClass,slot:r.slot,kind:r.kind,tier:1,rng:()=>.2,now,source:'local-collection-fixture',forceRarity:'common'});item.enhance_level=r.slot==='weapon'?4:r.minEnhance;await insertEquipStmt(env.DB,item).run();}
  // Disposable surplus lets the same real API exercise archive, salvage and reroll.
  for(let i=0;i<14;i++){const sample=makeGear({id:`recovery-fixture:${id}:${i}`,tgId:id,cls:baseClass,slot:i<12?'boots':'ring',tier:1,rng:()=>.2,now,source:i<6?'atlas':'elite',forceRarity:'common',prefix:'試玩'});await insertEquipStmt(env.DB,sample).run();}
  for (const material of ['atlas_shard', 'atlas_iron', 'atlas_ember', 'atlas_venom']) db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,100)').run(id, material);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json' };
let sweeping=false;
const sweepTimer=setInterval(async()=>{if(sweeping)return;sweeping=true;try{await AtlasBackground.sweep(permanent,Date.now());}catch(error){console.error('isolated atlas sweep',error.message);}finally{sweeping=false;}},60000);
sweepTimer.unref();
// The same production step functions, with real due times, in disposable local data.
let workshopRunning=false;
const workshopTimer=setInterval(async()=>{if(workshopRunning)return;workshopRunning=true;try{await AutoEnhance.sweep(permanent,Date.now());await AutoReroll.sweep(permanent,Date.now());}catch(error){console.error('isolated workshop sweep',error.message);}finally{workshopRunning=false;}},1000);
workshopTimer.unref();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    // Only the user's loopback art preview may read these isolated test APIs.
    // No production authentication or player data is forwarded.
    const socialPaths=new Set(['meta','characters','select','equipment-recovery','equipment-recovery/preview','equipment-recovery/action','equipment-collection','equipment-collection/preview','equipment-collection/submit','me','atlas/catalog','atlas/status','atlas/talents','atlas/talents/preview','atlas/talents/action','atlas/configure','atlas/start','atlas/stop','atlas/settle','atlas/craft','atlas/quests','atlas/quests/claim','chat/state','chat/send',"shop","ledger","settings","buy","buy-gear","gacha","refill","equip","unequip","sell-gear","sell-gear-batch","gacha/open","fate/gifts/summary","fate/gifts/open","enhance","reroll","auto-enhance/start","auto-enhance/stop","auto-enhance/status","auto-reroll/options","auto-reroll/start","auto-reroll/stop","auto-reroll/status","background/status","forge/receipt"].map(a=>'/app/api/'+a));
    if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`){
      if(req.headers.origin!==previewOrigin||!socialPaths.has(url.pathname)){res.writeHead(403);res.end('Preview origin is not allowed');return;}
      res.setHeader('Access-Control-Allow-Origin',previewOrigin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type,X-Dev-Tg-Id,X-Realm-Id'});res.end();return;}
    }
    if (url.pathname === '/__preview/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, isolated: true, ephemeral: true, productionAccess: false, realmCount: 2,liveSocialPreview:true,vfxFixture:vfxFixture?'long-targets':null }));
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
function close() { clearInterval(sweepTimer);clearInterval(workshopTimer);server.closeAllConnections(); server.close(() => { env.DB.sqlite.close(); env.DB_SEASON.sqlite.close(); }); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
