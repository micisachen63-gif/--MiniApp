// Disposable SQLite preview only. Never called by the Worker or production code.
import {createCharacter} from '../src/services/player.js';
import {scopeEnvForRealm,resolveRealm} from '../src/realm/index.js';
import {makeGear,gearOffers} from '../src/game/gear.js';
import {insertEquipStmt} from '../src/db.js';
import {computeStats} from '../src/game/stats.js';
export async function seedEndgameQa(root,now){
 const env=scopeEnvForRealm(root,await resolveRealm(root,'permanent')),db=env.DB,out=[];
 for(const [i,base]of ['sword','archer','mage','thief'].entries()){
  let c=await db.prepare('SELECT * FROM rpg_live_characters WHERE account_tg_id=? AND base_class=?').bind('90101',base).first();
  if(!c){const p=await createCharacter(env,{tgId:'90101',name:'覺醒測試'+i,gender:'m',baseClass:base},now);c=p.char;}
  await db.prepare("UPDATE rpg_characters SET level=120,progression_level=481,class_path='A111',gold=500000,last_settle_at=? WHERE tg_id=?").bind(now,c.tg_id).run();
  c=await db.prepare('SELECT * FROM rpg_live_characters WHERE tg_id=?').bind(c.tg_id).first();
  const offer=gearOffers(c).find(o=>o.slot==='weapon'),item=makeGear({id:'endgame-qa-'+i,tgId:c.tg_id,cls:base,slot:'weapon',kind:offer.kind,tier:offer.tier,rng:()=>.5,now,source:'qa',mode:'hell',forceRarity:'epic'});item.enhance_level=8;item.is_equipped=1;
  await db.prepare("UPDATE rpg_equipment SET is_equipped=0 WHERE tg_id=? AND slot='weapon'").bind(c.tg_id).run();await insertEquipStmt(db,item).run();
  const stats=computeStats(c,[item]);await db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').bind(stats.maxHp,stats.maxMp,c.tg_id).run();
  for(const cycle of ['normal','elite','expert','nightmare'])await db.prepare('INSERT INTO rpg_atlas_progress VALUES(?,?,1,?,?)').bind(c.tg_id,'cycle_'+cycle+'_12',now,now).run();
  for(const key of ['red_1','red_2','red_3','red_4','blue_1','blue_2','blue_3','blue_4'])await db.prepare('INSERT INTO rpg_inventory VALUES(?,?,500) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=500').bind(c.tg_id,key).run();
  out.push({characterId:c.tg_id,baseClass:base,level:481});
 }
 return {isolated:true,productionAccess:false,characters:out};
}
