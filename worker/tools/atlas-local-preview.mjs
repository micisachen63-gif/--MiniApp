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
import * as Party from '../src/services/party.js';
import { seedPartyQa, partyQaSnapshot } from './party-qa-fixture.mjs';
import { seedTowerQa, createTowerQaController } from './tower-qa-fixture.mjs';
import { seedBossQa, createBossQaController } from './boss-qa-fixture.mjs';
import { seedStarRingQa, createStarRingQaController } from './star-ring-qa-fixture.mjs';
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
const skillCareerQa = process.env.RPG_SKILL_CAREER_QA === '1';
const partyQa = process.env.RPG_PARTY_QA === '1';
const towerQa = process.env.RPG_TOWER_QA === '1';
const bossQa = process.env.RPG_BOSS_QA === '1';
const starRingQa = process.env.RPG_STAR_RING_QA === '1';
if(starRingQa&&(bossQa||towerQa||partyQa||skillCareerQa))throw Error('Star Ring QA uses its own isolated fixture mode');
if(bossQa&&(towerQa||partyQa||skillCareerQa))throw Error('Boss QA uses its own isolated fixture mode');
if(towerQa&&(partyQa||skillCareerQa))throw Error('Tower QA uses its own isolated fixture mode');
if(towerQa||bossQa||starRingQa)env.ALLOW_DEBUG_TIME='true';
await initializeRealmIdentity(env, 'permanent', { now });
await initializeRealmIdentity(env, 'season_2026_01', { now });
const permanent = scopeEnvForRealm(env, await resolveRealm(env, 'permanent'));
const classes = [['sword', '測試劍士'], ['archer', '測試妖精'], ['mage', '測試法師'], ['thief', '測試盜賊']];
for (const [index, [baseClass, name]] of classes.entries()) {
  const player = await Player.createCharacter(permanent, { tgId: '90101', charSlot: index + 1, name, baseClass, gender: 'f' }, now);
  const id = player.char.tg_id, db = env.DB.sqlite;
  db.prepare('UPDATE rpg_characters SET level=15,gold=50000,last_settle_at=? WHERE tg_id=?').run(now, id);
  db.prepare("UPDATE rpg_equipment SET enhance_level=7 WHERE tg_id=? AND slot='weapon'").run(id);
  // Opt-in, disposable skill/career fixtures; the normal preview seed stays unchanged.
  if(skillCareerQa && ['sword','archer'].includes(baseClass)) {
    db.prepare("UPDATE rpg_characters SET level=60,class_path='A',party_id=NULL,special_json='{}' WHERE tg_id=?").run(id);
    const items=baseClass==='sword'?[['book_skill_01_1',10],['book_skill_01_2',3],['book_skill_01_3',3],['book_skill_02_1',1],['book_skill_07_1',1],['research_fragment',100],['mat_2',1],['reselect_2',1]]:[];
    for(const [item,quantity] of items)db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id,item,quantity);
  }
  // Owned higher-tier bottles verify real reservation/consumption/refund without buying locked shop stock.
  for (const [item,quantity] of [['red_1',500],['red_2',30],['red_3',12],['red_4',4],['blue_1',500],['blue_2',30],['blue_3',12],['blue_4',4],['scroll_w',20],['scroll_a',20]]) db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id,item,quantity);
  for(const collection of equipmentCollectionCatalog(baseClass).filter(c=>c.tier===1))for(const r of collection.requirements){const item=makeGear({id:`collection-fixture:${id}:${r.slot}`,tgId:id,cls:baseClass,slot:r.slot,kind:r.kind,tier:1,rng:()=>.2,now,source:'local-collection-fixture',forceRarity:'common'});item.enhance_level=r.slot==='weapon'?4:r.minEnhance;await insertEquipStmt(env.DB,item).run();}
  // Disposable surplus lets the same real API exercise archive, salvage and reroll.
  for(let i=0;i<14;i++){const sample=makeGear({id:`recovery-fixture:${id}:${i}`,tgId:id,cls:baseClass,slot:i<12?'boots':'ring',tier:1,rng:()=>.2,now,source:i<6?'atlas':'elite',forceRarity:'common',prefix:'試玩'});await insertEquipStmt(env.DB,sample).run();}
  for (const material of ['atlas_shard', 'atlas_iron', 'atlas_ember', 'atlas_venom']) db.prepare('INSERT INTO rpg_atlas_materials(char_id,material,quantity) VALUES(?,?,100)').run(id, material);
}
const partyQaFixtures=partyQa?await seedPartyQa(env,permanent,now):[];
const towerQaFixtures=towerQa?await seedTowerQa(env,permanent,now):[];
const towerQaClock=towerQa?createTowerQaController(env,permanent,towerQaFixtures,now):null;
const bossQaSeed=bossQa?await seedBossQa(env,permanent,now):null;
const bossQaClock=bossQa?createBossQaController(env,permanent,bossQaSeed,now):null;
const starRingQaSeed=starRingQa?await seedStarRingQa(env,permanent,now):null;
const starRingQaClock=starRingQa?createStarRingQaController(env,permanent,starRingQaSeed,now):null;
const qaClock=towerQaClock||bossQaClock||starRingQaClock;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json' };
let sweeping=false;
const sweepTimer=(towerQa||bossQa||starRingQa)?null:setInterval(async()=>{if(sweeping)return;sweeping=true;try{await AtlasBackground.sweep(permanent,Date.now());}catch(error){console.error('isolated atlas sweep',error.message);}finally{sweeping=false;}},60000);
sweepTimer?.unref();
// The same production step functions, with real due times, in disposable local data.
let workshopRunning=false;
const workshopTimer=(towerQa||bossQa||starRingQa)?null:setInterval(async()=>{if(workshopRunning)return;workshopRunning=true;try{await AutoEnhance.sweep(permanent,Date.now());await AutoReroll.sweep(permanent,Date.now());}catch(error){console.error('isolated workshop sweep',error.message);}finally{workshopRunning=false;}},1000);
workshopTimer?.unref();
// Only this opt-in, disposable preview checks due party work. Actual round deadlines stay unchanged.
let partySweeping=false;
const partySweepTimer=partyQa?setInterval(async()=>{if(partySweeping)return;partySweeping=true;try{await Party.sweep(permanent,Date.now());}catch(error){console.error('isolated party sweep',error.message);}finally{partySweeping=false;}},1000):null;
partySweepTimer?.unref();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    // Only the user's loopback art preview may read these isolated test APIs.
    // No production authentication or player data is forwarded.
    const socialPaths=new Set(['meta','characters','select','skill-career','tower/scene','tower/receipt','tower/action','star-ring/scene','star-ring/receipt','star-ring/create-scoped','star-ring/action-scoped','star-ring/shop-scoped','star-ring/cosmetics/equip-scoped','boss/scene','boss/receipt','boss/attack-scoped','boss/exchange-scoped','party/scene','party/create','party/action','party/reward','expedition/action','advance','reselect','equipment-recovery','equipment-recovery/preview','equipment-recovery/action','equipment-collection','equipment-collection/preview','equipment-collection/submit','me','atlas/catalog','atlas/status','atlas/talents','atlas/talents/preview','atlas/talents/action','atlas/configure','atlas/start','atlas/stop','atlas/settle','atlas/craft','atlas/quests','atlas/quests/claim','chat/state','chat/send',"shop","ledger","settings","buy","buy-gear","gacha","refill","equip","unequip","sell-gear","sell-gear-batch","gacha/open","fate/gifts/summary","fate/gifts/open","enhance","reroll","auto-enhance/start","auto-enhance/stop","auto-enhance/status","auto-reroll/options","auto-reroll/start","auto-reroll/stop","auto-reroll/status","background/status","forge/receipt"].map(a=>'/app/api/'+a));
    if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`){
      if(req.headers.origin!==previewOrigin||!socialPaths.has(url.pathname)){res.writeHead(403);res.end('Preview origin is not allowed');return;}
      res.setHeader('Access-Control-Allow-Origin',previewOrigin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type,X-Dev-Tg-Id,X-Realm-Id'});res.end();return;}
    }
    if (url.pathname === '/__preview/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, pid:process.pid, isolated: true, ephemeral: true, productionAccess: false, realmCount: 2,liveSocialPreview:true,vfxFixture:vfxFixture?'long-targets':null,skillCareerQa,partyQa,towerQa,bossQa,starRingQa,qaClock:qaClock?.info()||null,partySweepMs:partyQa?1000:null }));
      return;
    }
    if (partyQa && url.pathname === '/__preview/party-qa/state') {
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(partyQaSnapshot(env,partyQaFixtures)));return;
    }
    if(towerQa&&url.pathname==='/__preview/tower-qa/state'){
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(towerQaClock.snapshot()));return;
    }
    if(towerQa&&url.pathname==='/__preview/tower-qa/advance'){
      if(req.method!=='POST'){res.writeHead(405);res.end();return;}
      let input='';for await(const chunk of req){input+=chunk;if(Buffer.byteLength(input)>2048)throw Error('QA clock request too large');}
      const result=await towerQaClock.advance(JSON.parse(input||'{}'));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
    }
    if(bossQa&&url.pathname==='/__preview/boss-qa/state'){
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(bossQaClock.snapshot()));return;
    }
    if(bossQa&&url.pathname==='/__preview/boss-qa/advance'){
      if(req.method!=='POST'){res.writeHead(405);res.end();return;}
      let input='';for await(const chunk of req){input+=chunk;if(Buffer.byteLength(input)>4096)throw Error('Boss QA command too large');}
      const result=await bossQaClock.advance(JSON.parse(input||'{}'));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
    }
    if(starRingQa&&url.pathname==='/__preview/star-ring-qa/state'){
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(starRingQaClock.snapshot()));return;
    }
    if(starRingQa&&url.pathname==='/__preview/star-ring-qa/advance'){
      if(req.method!=='POST'){res.writeHead(405);res.end();return;}
      let input='';for await(const chunk of req){input+=chunk;if(Buffer.byteLength(input)>4096)throw Error('Star Ring QA command too large');}
      const result=await starRingQaClock.advance(JSON.parse(input||'{}'));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
    }
    if (url.pathname.startsWith('/app/api/')) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024 * 1024) throw Error('Request too large');
      }
      const response = await handle(new CurrentClientRequest(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method, headers: qaClock?{...req.headers,'x-debug-now':String(qaClock.now())}:req.headers, body,
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
  notice: starRingQa?'本機星環隔離驗收；五帳號合成角色；明示開發時鐘；關閉後資料清除。':'本機 POE 功能測試；四名測試角色；關閉後資料清除；9593 與正式機不受影響。',
})));
function close() { clearInterval(sweepTimer);clearInterval(workshopTimer);if(partySweepTimer)clearInterval(partySweepTimer);server.closeAllConnections(); server.close(() => { env.DB.sqlite.close(); env.DB_SEASON.sqlite.close(); }); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
