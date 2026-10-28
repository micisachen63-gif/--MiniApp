import {GameError} from '../game/classes.js';
import {taipeiDay} from '../game/time.js';
import {classifyDbError} from '../db.js';
export const DELETE_REASONS=Object.freeze({party:'請先完成或離開打寶、爬塔及遠征隊伍',trade:'請先結束交易、取消交易邀請並取回託管物品',market:'請先下架交易所中的商品',pk:'請先結束決鬥邀請',background:'請先停止背景強化、洗屬性及自動召喚',fate:'請先完成本世命運旅章及相關交織選擇',boss:'請等待參與的群組首領完成結算',rewards:'請先領取尚未入袋的組隊獎勵',daily:'每個帳號每天只能刪除一隻角色，台灣時間 00:00 重置'});
const accountId=x=>{const s=String(x||'');if(!/^\d{1,20}$/.test(s))throw new GameError('account','帳號無效');return s;};
const owned=async(db,account,id)=>{const c=await db.prepare('SELECT * FROM rpg_live_characters WHERE tg_id=? AND account_tg_id=?').bind(String(id||''),account).first();if(!c)throw new GameError('character_not_owned','找不到你擁有的這個角色',404);return c;};
async function reasons(db,account,id,now){const result=await db.batch([db.prepare('SELECT DISTINCT reason FROM rpg_character_delete_blocks WHERE char_id=?').bind(id),db.prepare('SELECT 1 FROM rpg_character_deletions WHERE account_tg_id=? AND day=?').bind(account,taipeiDay(now))]);return [...(result[0].results||[]).map(r=>r.reason),...(result[1].results?.length?['daily']:[])];}
export async function preview(env,account,b,now){account=accountId(account);const c=await owned(env.DB,account,b.charId),blocks=await reasons(env.DB,account,c.tg_id,now);return {ok:true,character:{charId:c.tg_id,name:c.name,level:c.level,baseClass:c.base_class,classPath:c.class_path,slot:c.char_slot},allowed:blocks.length===0,reasons:blocks.map(code=>({code,message:DELETE_REASONS[code]})),dailyLimit:1};}
export async function status(env,account,b){account=accountId(account);const r=await env.DB.prepare('SELECT char_id,original_name,result_json FROM rpg_character_deletions WHERE account_tg_id=? AND request_id=?').bind(account,String(b.requestId||'')).first();if(!r)return {ok:true,committed:false};if(r.char_id!==String(b.charId||'')||r.original_name!==String(b.confirmName||''))throw new GameError('request_reused','這個操作編號已用於其他刪除內容',409);return {...JSON.parse(r.result_json),committed:true,replayed:true};}
export async function remove(env,account,b,now){
 account=accountId(account);const db=env.DB,id=String(b.charId||''),name=String(b.confirmName||''),request=String(b.requestId||'');
 if(!/^[A-Za-z0-9_-]{6,64}$/.test(request))throw new GameError('request','需要有效的刪角操作編號');
 const recover=async()=>{const r=await db.prepare('SELECT char_id,original_name,result_json FROM rpg_character_deletions WHERE account_tg_id=? AND request_id=?').bind(account,request).first();if(!r)return null;if(r.char_id!==id||r.original_name!==name)throw new GameError('request_reused','這個操作編號已用於其他刪除內容',409);return {...JSON.parse(r.result_json),replayed:true};};
 const previous=await recover();if(previous)return previous;
 try{
 const c=await owned(db,account,id);if(name!==c.name)throw new GameError('confirm_name','請輸入完全相同的角色名稱，確認要刪除');
 const blocks=await reasons(db,account,id,now);if(blocks.length)throw new GameError(blocks.includes('daily')?'character_delete_daily':'character_delete_busy',blocks.map(k=>DELETE_REASONS[k]).join('；'),409);
 const day=taipeiDay(now),result={ok:true,deletedCharId:id,deletedName:c.name,slot:c.char_slot,deletedAt:now,day};
 // The single INSERT trigger validates current ownership/revision and performs all changes atomically.
 await db.batch([db.prepare('INSERT INTO rpg_character_deletions(char_id,account_tg_id,char_slot,original_name,day,request_id,snapshot_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,account,c.char_slot,c.name,day,request,JSON.stringify(c),JSON.stringify(result),now)]);return result;}
 catch(e){const committed=await recover();if(committed)return committed;const current=await reasons(db,account,id,now);if(current.length)throw new GameError(current.includes('daily')?'character_delete_daily':'character_delete_busy',current.map(k=>DELETE_REASONS[k]).join('；'),409);throw classifyDbError(e)||e;}
}
