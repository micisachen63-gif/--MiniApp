import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {D1Shim} from './d1-shim.js';
import {createCharacter} from '../src/services/player.js';
const dir=new URL('../migrations/',import.meta.url);
test('0044 preserves every populated historical column, +15 gear, old receipt and active expedition without rebuilding a player table',async t=>{
 const DB=new D1Shim();t.after(()=>DB.sqlite.close());for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<'0044').sort())DB.sqlite.exec(readFileSync(new URL(name,dir),'utf8').replace(/\r\n/g,'\n'));
 await createCharacter({DB},{tgId:'97101',name:'保值演練',baseClass:'sword',gender:'m'},1);DB.sqlite.prepare("UPDATE rpg_characters SET level=120,class_path='A111',gold=987654,atlas_run_id='frozen-old' WHERE tg_id=?").run('97101');DB.sqlite.prepare('UPDATE rpg_equipment SET enhance_level=15').run();
 const tables=DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all().map(t=>({name:t.name,cols:DB.sqlite.prepare('PRAGMA table_info('+t.name+')').all().map(c=>c.name)}));
 const snapshot=()=>tables.map(t=>[t.name,DB.sqlite.prepare('SELECT '+t.cols.map(c=>'"'+c+'"').join(',')+' FROM '+t.name+' ORDER BY rowid').all()]);const before=snapshot();
 const sql=readFileSync(new URL('0044_endgame_season_retention.sql',dir),'utf8');assert.doesNotMatch(sql,/DROP\s+TABLE|DELETE\s+FROM|UPDATE\s+rpg_characters|writable_schema|ignore_check_constraints/i);
 DB.sqlite.exec(sql);assert.deepEqual(snapshot(),before);assert.equal(DB.sqlite.prepare('SELECT atlas_run_id FROM rpg_live_characters WHERE tg_id=?').get('97101').atlas_run_id,'frozen-old');assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 DB.sqlite.prepare("UPDATE rpg_characters SET progression_level=600 WHERE tg_id='97101'").run();assert.equal(DB.sqlite.prepare("SELECT level FROM rpg_live_characters WHERE tg_id='97101'").get().level,600);assert.throws(()=>DB.sqlite.prepare("UPDATE rpg_characters SET level=600 WHERE tg_id='97101'").run());
});
