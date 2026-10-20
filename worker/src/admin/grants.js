import {ITEMS} from '../game/constants.js';
import {GameError} from '../game/classes.js';
import {ledgerStmt,invDeltaStmt,guardStmt,bumpRevStmt} from '../db.js';
import {timingSafeEqual} from '../auth.js';
import {digest,sign} from './auth.js';
import {grantable} from './catalog.js';
function normalize(b){
 if(!b||!Array.isArray(b.charIds)||b.charIds.length<1||b.charIds.length>20)throw new GameError('grant_targets','每批請選擇 1～20 個角色');
 const ids=b.charIds;
 if(ids.some(x=>typeof x!=='string'||!/^(?:\d{1,20}|c[0-9a-f]{32})$/i.test(x))||new Set(ids).size!==ids.length)throw new GameError('grant_targets','角色名單無效或重複');
 const gold=b.gold??0,item=b.item||null,qty=item?b.qty:0,reason=typeof b.reason==='string'?b.reason.trim():'';
 if(!Number.isSafeInteger(gold)||gold<0||gold>1000000)throw new GameError('grant_gold','每人金幣需介於 0～1,000,000');
 if(item&&(typeof item!=='string'||!grantable(item)||!Number.isSafeInteger(qty)||qty<1||qty>999||(ITEMS[item].maxHold&&qty>ITEMS[item].maxHold)))throw new GameError('grant_item','請選擇有效道具及符合持有上限的數量（最多 999）');
 if(!gold&&!item)throw new GameError('grant_empty','至少選擇金幣或一種道具');
 if(reason.length<3||reason.length>100||/[\u0000-\u001f\u007f]/.test(reason))throw new GameError('grant_reason','請填寫 3～100 字的發獎原因');
 return {charIds:[...ids].sort(),gold,item,qty,reason};
}
const fingerprint=p=>digest(JSON.stringify(p));
async function recipients(env,p){
 const result=await env.DB.prepare(`SELECT tg_id id,COALESCE(account_tg_id,tg_id) accountId,name,level FROM rpg_characters WHERE tg_id IN (${p.charIds.map(()=>'?').join(',')}) ORDER BY tg_id`).bind(...p.charIds).all();
 if(result.results?.length!==p.charIds.length)throw new GameError('grant_targets','名單中有不存在的角色，請重新確認',409);
 if(p.item&&ITEMS[p.item].maxHold){
  const held=await env.DB.prepare(`SELECT tg_id,quantity FROM rpg_inventory WHERE item=? AND tg_id IN (${p.charIds.map(()=>'?').join(',')})`).bind(p.item,...p.charIds).all();
  const full=held.results?.find(x=>x.quantity+p.qty>ITEMS[p.item].maxHold);
  if(full)throw new GameError('grant_capacity',`角色 ${full.tg_id} 領取後會超過道具持有上限，請調整名單或數量`,409);
 }
 return result.results;
}
export async function preview(env,admin,b,now){
 const payload=normalize(b),targets=await recipients(env,payload),fp=await fingerprint(payload),expiresAt=now+300000;
 const ticket=expiresAt+'.'+await sign(env,`grant:${admin.id}:${expiresAt}:${fp}`);
 return {targets,payload,fingerprint:fp,ticket,expiresAt,totals:{players:targets.length,gold:payload.gold*targets.length,qty:payload.qty*targets.length}};
}
function requestId(b){if(typeof b.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.requestId))throw new GameError('grant_request','需要有效的發獎操作編號');return b.requestId.toLowerCase();}
async function receipt(env,admin,id,fp=null){
 const old=await env.DB.prepare('SELECT fingerprint,result_json FROM rpg_admin_grants WHERE admin_tg_id=? AND request_id=?').bind(admin.id,id).first();
 if(old&&fp&&!timingSafeEqual(old.fingerprint,fp))throw new GameError('grant_reused','這個操作編號已用於不同獎勵，請先查核紀錄',409);
 return old?JSON.parse(old.result_json):null;
}
export async function status(env,admin,b){return receipt(env,admin,requestId(b));}
export async function commit(env,admin,b,now){
 const id=requestId(b),p=normalize(b.payload),fp=await fingerprint(p),old=await receipt(env,admin,id,fp);if(old)return old;
 try{
  const match=/^(\d{13})\.([0-9a-f]{64})$/.exec(String(b.ticket||'')),expires=Number(match?.[1]);
  if(!match||expires<=now||expires>now+300000||!timingSafeEqual(match[2],await sign(env,`grant:${admin.id}:${expires}:${fp}`)))throw new GameError('grant_preview','預覽已過期或內容已更動，請重新確認',409);
  const targets=await recipients(env,p),result={id,targets,gold:p.gold,item:p.item,itemName:p.item?ITEMS[p.item].name:null,qty:p.qty,reason:p.reason,createdAt:now};
  const event='console:grant:'+admin.id+':'+id,stmts=[
   env.DB.prepare('INSERT INTO rpg_admin_grants(admin_tg_id,request_id,fingerprint,payload_json,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(admin.id,id,fp,JSON.stringify(p),JSON.stringify(result),now),
  ];
  for(const target of targets){
   stmts.push(ledgerStmt(env.DB,{event_id:event+':'+target.id,tg_id:target.id,type:'管理者發獎',gold_delta:p.gold,item:p.item,item_delta:p.qty,note:p.reason},now));
   if(p.gold)stmts.push(env.DB.prepare('UPDATE rpg_characters SET gold=gold+?,rev=rev+1,updated_at=? WHERE tg_id=?').bind(p.gold,now,target.id),guardStmt(env.DB));
   else stmts.push(bumpRevStmt(env.DB,target.id,now),guardStmt(env.DB));
   if(p.item){
    const cap=ITEMS[p.item].maxHold;
    if(cap)stmts.push(env.DB.prepare(`INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)
     ON CONFLICT(tg_id,item) DO UPDATE SET quantity=quantity+excluded.quantity WHERE quantity+excluded.quantity<=?`).bind(target.id,p.item,p.qty,cap),guardStmt(env.DB));
    else stmts.push(invDeltaStmt(env.DB,target.id,p.item,p.qty));
   }
  }
  stmts.push(env.DB.prepare('INSERT INTO rpg_admin_audit(id,admin_tg_id,action,details,created_at) VALUES(?,?,?,?,?)').bind(event,admin.id,'後台發獎',JSON.stringify(result),now));
  await env.DB.batch(stmts);return result;
 }catch(e){const committed=await receipt(env,admin,id,fp);if(committed)return committed;throw e;}
}
