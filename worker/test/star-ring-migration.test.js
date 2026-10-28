import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {D1Shim} from './d1-shim.js';
import * as P from '../src/services/player.js';
import {T0} from './helpers.js';
const folder=new URL('../migrations/',import.meta.url),migration=readFileSync(new URL('0029_star_ring_expedition.sql',folder),'utf8');
test('expedition schema only adds its isolated tables and preserves all populated existing rows, definitions and foreign keys',async()=>{
 const db=new D1Shim();for(const f of readdirSync(folder).filter(f=>f.endsWith('.sql')&&f<'0029').sort())db.sqlite.exec(readFileSync(new URL(f,folder),'utf8').replace(/\r\n/g,'\n'));
 // Current services use a live view; this fixture intentionally predates 0034.
 db.sqlite.exec('CREATE VIEW rpg_live_characters AS SELECT * FROM rpg_characters');
 await P.createCharacter({DB:db},{tgId:'98500',name:'保留角色',gender:'f',baseClass:'thief'},T0);
 await db.prepare('UPDATE rpg_characters SET gold=123456,level=40 WHERE tg_id=?').bind('98500').run();
 const schema=()=>db.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND tbl_name NOT LIKE 'rpg_star_ring_%' ORDER BY type,name").all();
 const oldTables=db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 const data=()=>Object.fromEntries(oldTables.map(({name})=>[name,db.sqlite.prepare('SELECT rowid,* FROM "'+name+'" ORDER BY rowid').all()]));
 const before={schema:schema(),data:data()};db.sqlite.exec(migration);
 assert.deepEqual({schema:schema(),data:data()},before);assert.equal(db.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_star_ring_%'").get().n,7);
 assert.doesNotMatch(migration,/\b(?:DROP|ALTER|DELETE|UPDATE|REPLACE)\b/i);
 db.sqlite.close();
});
