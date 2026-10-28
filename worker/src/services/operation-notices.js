import {GameError} from '../game/classes.js';
async function ownedNotice(env,tg,b){
 const kind=b.kind,refId=b.refId;if(!['auto_enhance_end','guardian_summon','guardian_fuse'].includes(kind)||typeof refId!=='string'||!/^[A-Za-z0-9:_-]{8,120}$/.test(refId))throw new GameError('notice','通知編號無效');
 const account=await env.DB.prepare('SELECT account_tg_id FROM rpg_live_characters AS rpg_characters WHERE tg_id=?').bind(String(tg)).first();if(!account)throw new GameError('no_character','找不到你的角色',404);const owner=account.account_tg_id||String(tg);
 const source=kind==='auto_enhance_end'?await env.DB.prepare('SELECT id,status FROM rpg_auto_enhance WHERE id=? AND owner=?').bind(refId,owner).first():await env.DB.prepare('SELECT operation_id FROM rpg_guardian_operations WHERE operation_id=? AND account_id=? AND action=?').bind(refId,owner,kind==='guardian_summon'?'summon':'fuse').first();
 if(!source)throw new GameError('not_found','找不到這則通知',404);if(kind==='auto_enhance_end'&&source.status!=='ended')throw new GameError('running','強化尚未結束，請等結果完成後再關閉通知',409);
 return {kind,refId,owner};
}
export async function status(env,tg,b){const n=await ownedNotice(env,tg,b),row=await env.DB.prepare('SELECT created_at FROM rpg_notice_dismissals WHERE account_tg_id=? AND kind=? AND ref_id=?').bind(n.owner,n.kind,n.refId).first();return {ok:true,notice:{kind:n.kind,refId:n.refId,dismissed:!!row,dismissedAt:row?.created_at||null}};}
export async function dismiss(env,tg,b,now){const n=await ownedNotice(env,tg,b);await env.DB.prepare('INSERT OR IGNORE INTO rpg_notice_dismissals(account_tg_id,kind,ref_id,created_at) VALUES(?,?,?,?)').bind(n.owner,n.kind,n.refId,now).run();return {ok:true,notice:{kind:n.kind,refId:n.refId,dismissed:true}};}
