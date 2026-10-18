import {COSMETICS,cosmeticById,equippedAura} from '../game/star-ring-cosmetics.js';
import {GameError} from '../game/classes.js';
import {withPlayer} from './player.js';

const requestOf=b=>{const id=String(b?.requestId||'');if(!id||id.length>100)throw new GameError('request','請提供有效的操作編號');return id;};
export async function state(env,tg){
 const c=await env.DB.prepare('SELECT level,special_json FROM rpg_characters WHERE tg_id=?').bind(String(tg)).first();
 if(!c)throw new GameError('no_character','請先建立角色',404);
 const owned=(await env.DB.prepare('SELECT cosmetic_id FROM rpg_star_ring_cosmetics WHERE char_id=? ORDER BY unlocked_at,cosmetic_id').bind(String(tg)).all()).results.map(r=>r.cosmetic_id);
 const selected=equippedAura(c),equipped=selected&&owned.includes(selected.id)?selected:null;
 const balance=(await env.DB.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='star_ring_token'").bind(String(tg)).first())?.quantity||0;
 return {catalog:COSMETICS,owned,equipped,balance,currency:'star_ring_token'};
}
export async function list(env,tg){return {ok:true,...await state(env,tg)};}
export async function equip(env,tg,b,now){
 const request=requestOf(b),id=b.cosmeticId==null?null:String(b.cosmeticId);
 if(id&&!cosmeticById(id))throw new GameError('cosmetic','找不到此外觀');
 for(let n=0;n<4;n++)try{
  await withPlayer(env,String(tg),now,async w=>{
   const old=await env.DB.prepare('SELECT cosmetic_id FROM rpg_star_ring_cosmetic_operations WHERE char_id=? AND request_id=?').bind(String(tg),request).first();
   if(old){if(old.cosmetic_id!==id)throw new GameError('request','操作編號已用於其他外觀',409);return {};}
   if(w.char.level<40)throw new GameError('level','星環外觀需要 Lv.40');
   if(id&&!await env.DB.prepare('SELECT 1 FROM rpg_star_ring_cosmetics WHERE char_id=? AND cosmetic_id=?').bind(String(tg),id).first())throw new GameError('not_owned','尚未解鎖此外觀',403);
   const special=JSON.parse(w.char.special_json||'{}');if(id)special.starRingAura=id;else delete special.starRingAura;
   w.char.special_json=JSON.stringify(special);
   return {extra:[env.DB.prepare('INSERT INTO rpg_star_ring_cosmetic_operations(char_id,request_id,cosmetic_id,created_at) VALUES(?,?,?,?)').bind(String(tg),request,id,now)]};
  });return {ok:true,...await state(env,tg)};
 }catch(e){if(n<3&&(/rpg_star_ring_cosmetic_operations/.test(String(e))||e.code==='conflict'))continue;throw e;}
 throw new GameError('conflict','外觀正在更新，請重新整理',409);
}
