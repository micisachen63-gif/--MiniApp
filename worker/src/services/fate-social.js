import {narrativeProfile} from '../../public/fate/formal-events.js';
import {SOCIAL_ROLES,publicNickname,validSocialCast} from '../../public/fate/social-cast.js';
import {hash} from '../../public/fate/world.js';

export async function snapshotSocialCast(db,accountId,life,sink=null){
 // Bounded reads from current rows only. Deleted characters are not candidates.
 // Account IDs are used privately for deduplication, then discarded before persistence.
 const rows=(await db.prepare("SELECT name,COALESCE(account_tg_id,tg_id) AS owner FROM rpg_live_characters AS rpg_characters WHERE COALESCE(account_tg_id,tg_id)<>? ORDER BY updated_at DESC,tg_id LIMIT 96").bind(String(accountId)).all()).results||[];
 const owners=new Set(),names=new Set(),candidates=[],byName=new Map();
 for(const r of [...rows].sort((a,b)=>hash(life.seed+':social:'+a.name)-hash(life.seed+':social:'+b.name))){const name=publicNickname(r.name);if(!name||owners.has(String(r.owner))||names.has(name))continue;owners.add(String(r.owner));names.add(name);candidates.push(name);byName.set(name,String(r.owner));if(candidates.length===3)break;}
 const threads=[7,8,9].includes(life.version)?Object.keys(SOCIAL_ROLES).sort((a,b)=>hash('v7-cast-role:'+life.seed+':'+a)-hash('v7-cast-role:'+life.seed+':'+b)).slice(0,3).map(id=>({id})):narrativeProfile(life).threads.filter(t=>Object.hasOwn(SOCIAL_ROLES,t.id));
 const cast=validSocialCast({v:1,people:candidates.slice(0,threads.length).map((name,i)=>({thread:threads[i].id,name}))});
 // Account IDs go only to the caller's private sink (for an opt-in mention); they are never persisted in the cast.
 if(sink&&cast)for(const person of cast.people)if(byName.has(person.name))sink.push({account:byName.get(person.name),name:person.name,thread:person.thread});
 return cast;
}
