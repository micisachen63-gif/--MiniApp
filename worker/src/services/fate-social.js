import {narrativeProfile} from '../../public/fate/formal-events.js';
import {SOCIAL_ROLES,publicNickname,validSocialCast} from '../../public/fate/social-cast.js';
import {hash} from '../../public/fate/world.js';

export async function snapshotSocialCast(db,accountId,life){
 // Bounded reads from current rows only. Deleted characters are not candidates.
 // Account IDs are used privately for deduplication, then discarded before persistence.
 const rows=(await db.prepare("SELECT name,COALESCE(account_tg_id,tg_id) AS owner FROM rpg_characters WHERE COALESCE(account_tg_id,tg_id)<>? ORDER BY updated_at DESC,tg_id LIMIT 96").bind(String(accountId)).all()).results||[];
 const owners=new Set(),names=new Set(),candidates=[];
 for(const r of [...rows].sort((a,b)=>hash(life.seed+':social:'+a.name)-hash(life.seed+':social:'+b.name))){const name=publicNickname(r.name);if(!name||owners.has(String(r.owner))||names.has(name))continue;owners.add(String(r.owner));names.add(name);candidates.push(name);if(candidates.length===3)break;}
 const threads=[7,8,9].includes(life.version)?Object.keys(SOCIAL_ROLES).sort((a,b)=>hash('v7-cast-role:'+life.seed+':'+a)-hash('v7-cast-role:'+life.seed+':'+b)).slice(0,3).map(id=>({id})):narrativeProfile(life).threads.filter(t=>Object.hasOwn(SOCIAL_ROLES,t.id));
 return validSocialCast({v:1,people:candidates.slice(0,threads.length).map((name,i)=>({thread:threads[i].id,name}))});
}
