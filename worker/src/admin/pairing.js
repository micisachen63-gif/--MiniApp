import {GameError} from '../game/classes.js';
import {adminRole} from './auth.js';
export async function approvePair(env,admin,challenge,now){
 if(typeof challenge!=='string'||!/^[0-9a-f]{64}$/.test(challenge))throw new GameError('challenge','登入代碼無效');
 // Replays never change identity, extend expiry or reactivate a redeemed code.
 await env.DB.prepare('INSERT OR IGNORE INTO rpg_admin_login_approvals(challenge,admin_tg_id,created_at,expires_at) VALUES(?,?,?,?)').bind(challenge,admin.id,now,now+300000).run();
 const row=await env.DB.prepare('SELECT admin_tg_id,expires_at,used_at FROM rpg_admin_login_approvals WHERE challenge=?').bind(challenge).first();
 if(row.admin_tg_id!==admin.id||row.expires_at<=now||row.used_at!==null)throw new GameError('challenge','這組登入代碼已失效或已使用，請回後台確認',409);
 return {ok:true,approved:true};
}
export async function approveFromBot(env,b,now){
 if(typeof b.challenge!=='string'||!/^[0-9a-f]{64}$/.test(b.challenge))throw new GameError('challenge','登入代碼無效');
 // Called only through the service-secret route. The BOT forwards the verified
 // private callback's account identity; live group authority is still checked here.
 const admin=await adminRole(env,String(b.adminTgId||''));
 return approvePair(env,admin,b.challenge,now);
}
