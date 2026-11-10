import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import { createCharacter } from '../src/services/player.js';
import * as Scene from '../src/services/guardian-scene.js';
import * as Scoped from '../src/services/guardian-scoped.js';
import * as Receipt from '../src/services/guardian-receipt.js';
import { activeSettings } from '../src/game/guardian-sigil-config.js';

export const NOW=T0,OWNER='19801';
export const changes=db=>db.sqlite.prepare('SELECT total_changes() n').get().n;
export const snapshot=db=>Object.fromEntries(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,JSON.stringify(db.sqlite.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(row)).sort())]));
export const put=(f,item,quantity,tg=OWNER)=>f.sql.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(tg,item,quantity);
export async function fixture(t,{welcome=false,gold=100000,settings={}}={}) {
 const db=freshDb();t.after(()=>db.sqlite.close());
 const env={DB:db,REALM_CONTEXT:{id:'permanent',phase:'ACTIVE'},...(Object.keys(settings).length?{GUARDIAN_SETTINGS:JSON.stringify(settings)}:{})};
 await createCharacter(env,{tgId:OWNER,name:'天使整合測甲',baseClass:'mage',gender:'f'},NOW);
 db.sqlite.prepare('UPDATE rpg_characters SET level=30,gold=?,last_settle_at=? WHERE tg_id=?').run(gold,NOW,OWNER);
 const f={db,sql:db.sqlite,env,tg:OWNER};
 f.scope=tg=>({realmId:env.REALM_CONTEXT.id,selectedCharacterId:tg||f.tg});
 f.body=(kind,fields={},requestId='guardian-'+kind+'-test-001',tg=f.tg)=>({...f.scope(tg),kind,requestId,...(!['auto-stop','auto-seen'].includes(kind)?{configVersion:activeSettings(env).configVersion}:{}),...fields});
 f.run=(body,now=NOW,namespace='app')=>Scoped.run(env,body.selectedCharacterId,body,now,namespace);
 f.read=(body,now=NOW,namespace='app')=>Receipt.view(env,body.selectedCharacterId,body,now,namespace);
 f.scene=(body={})=>Scene.view(env,f.tg,{...f.scope(),...body},NOW);
 if(welcome)await f.run(f.body('welcome'));
 return f;
}
export function seedSigils(f,{rank=1,count=4,type='magic',bound=0,prefix='fixture-'+rank}={}) {
 // Synthetic inventory is setup evidence, never a fabricated committed scene result.
 const op='fixture-op-'+prefix,ids=Array.from({length:count},(_,i)=>prefix+'-'+String(i).padStart(3,'0'));
 f.sql.prepare('INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(op,OWNER,f.tg,'seed_'+prefix,'summon','0'.repeat(64),'fixture-source-only','{}',JSON.stringify({action:'QA 合成初始素材（非已提交召喚；非收據）',status:'synthetic-initial-input',fixtureOnly:true,notAReceipt:true}),NOW);
 for(const id of ids)f.sql.prepare('INSERT INTO rpg_guardian_sigils(id,char_id,type,quality,bound,source_operation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,f.tg,type,rank,bound,op,NOW,NOW);
 return ids;
}
export const typedId=(body,namespace='app')=>'guardian-scene-receipt:'+body.selectedCharacterId+':scene:'+namespace+':'+body.requestId;
