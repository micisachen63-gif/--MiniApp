// Disposable fixtures and read-only evidence for the opt-in party preview.
// This module only receives the in-memory D1 environment created by atlas-local-preview.
import { createHash } from 'node:crypto';
import * as Player from '../src/services/player.js';
import { insertEquipStmt, loadPlayer } from '../src/db.js';
import { makeGear } from '../src/game/gear.js';
import { computeStats } from '../src/game/stats.js';
import { GENERAL_WEAPON, SLOTS, POTIONS } from '../src/game/constants.js';
import { eligible, SPECIAL_SKILLS } from '../src/game/special.js';

export async function seedPartyQa(env, permanent, now) {
  const db = env.DB.sqlite;
  const roots = db.prepare("SELECT tg_id,account_tg_id,base_class,name FROM rpg_characters WHERE account_tg_id='90101' ORDER BY char_slot").all();
  const extras = [];
  for (const [accountId,baseClass,name] of [
    ['90102','sword','組隊驗收劍士'], ['90103','thief','組隊驗收盜賊'],
  ]) {
    const player = await Player.createCharacter(permanent,{tgId:accountId,charSlot:1,name,baseClass,gender:'m'},now);
    extras.push({tg_id:player.char.tg_id,account_tg_id:accountId,base_class:baseClass,name});
  }
  const fixtures = [];
  for (const c of [...roots,...extras]) {
    const id=c.tg_id,base=c.base_class,classPath=base==='mage'||base==='archer'?'B11':'A11';
    const learned=SPECIAL_SKILLS.filter(skill=>eligible({base_class:base,class_path:classPath,level:120},skill)).map(skill=>skill.id);
    const chosen=base==='mage'?['skill_06_2','skill_06_1','skill_17_2']:learned.slice(0,3);
    const special={learned,loadout:chosen.filter(id=>learned.includes(id)),auto:{},cooldowns:{},mode:'safe',budget:0,autoBluePct:0};
    db.prepare("UPDATE rpg_characters SET level=120,class_path=?,gold=50000,hp=1,mp=1,party_id=NULL,idle_state='gate',last_settle_at=?,special_json=? WHERE tg_id=?")
      .run(classPath,now,JSON.stringify(special),id);
    db.prepare('DELETE FROM rpg_equipment WHERE tg_id=?').run(id);
    for (const slot of SLOTS) for(let position=1;position<=(['ring','earring'].includes(slot)?2:1);position++) {
      const item=makeGear({id:`party-qa:${id}:${slot}:${position}`,tgId:id,cls:base,slot,kind:GENERAL_WEAPON[base],
        tier:12,forceRarity:'legendary',source:'shop',rng:()=>.5,now});
      item.enhance_level=7;item.is_equipped=position;
      await insertEquipStmt(env.DB,item).run();
    }
    for(const key of Object.keys(POTIONS)) db.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,200) ON CONFLICT(tg_id,item) DO UPDATE SET quantity=excluded.quantity').run(id,key);
    const player=await loadPlayer(env.DB,id),stats=computeStats(player.char,player.equipment.filter(e=>e.is_equipped));
    db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,id);
    fixtures.push({accountId:c.account_tg_id,characterId:id,name:c.name,baseClass:base,classPath,level:120,loadout:special.loadout});
  }
  return fixtures;
}

function databaseSnapshot(db) {
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rpg_%' ORDER BY name").all().map(x=>x.name);
  const rows={},counts={};
  for(const table of tables) {
    const safe=table.replaceAll('"','""');
    rows[table]=db.prepare('SELECT * FROM "'+safe+'"').all().map(row=>JSON.stringify(row)).sort();
    counts[table]=rows[table].length;
  }
  return {sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),counts};
}
export function partyQaSnapshot(env, fixtures) {
  const db=env.DB.sqlite;
  return {
    ok:true,isolated:true,ephemeral:true,productionAccess:false,readOnly:true,fixtures,
    databases:{permanent:databaseSnapshot(db),season:databaseSnapshot(env.DB_SEASON.sqlite)},
    parties:db.prepare('SELECT id,status,rev,state_json FROM rpg_parties ORDER BY id').all().map(p=>({...p,state:JSON.parse(p.state_json),state_json:undefined})),
    characters:db.prepare("SELECT tg_id,account_tg_id,name,hp,mp,rev,party_id,special_json FROM rpg_characters ORDER BY tg_id").all(),
    inventory:db.prepare('SELECT tg_id,item,quantity FROM rpg_inventory ORDER BY tg_id,item').all(),
    rewards:db.prepare('SELECT party_id,char_id,reward_json,created_at FROM rpg_party_rewards ORDER BY party_id,char_id').all(),
  };
}
