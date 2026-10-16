// Only public character nicknames enter the fictional cast. Never an account / TG ID.
export const SOCIAL_ROLES=Object.freeze({
 ferry:{npc:'阿汀',role:'擺渡人'},rooftop:{npc:'禾梨',role:'鄰居'},theatre:{npc:'蘇陌',role:'戲臺夥伴'},
 brother:{npc:'小麥',role:'遠房親人'},weaver:{npc:'若竹',role:'織工好友'},stairs:{npc:'阿岑',role:'鄰居'},
 letter:{npc:'聞舟',role:'異鄉旅伴'},rival:{npc:'明硯',role:'同行宿敵'},bread:{npc:'月姨',role:'麵包店主人'},
});
export function publicNickname(value){if(typeof value!=='string')return null;const name=value.normalize('NFC').trim();return /^[\p{L}\p{N}_]{2,24}$/u.test(name)?name:null;}
export function validSocialCast(raw){
 if(raw?.v!==1||!Array.isArray(raw.people))return null;const people=[],threads=new Set(),names=new Set();
 for(const entry of raw.people.slice(0,3)){const name=publicNickname(entry?.name),thread=entry?.thread;if(!name||typeof thread!=='string'||!Object.hasOwn(SOCIAL_ROLES,thread)||threads.has(thread)||names.has(name))continue;people.push({thread,name});threads.add(thread);names.add(name);}
 return people.length?{v:1,people}:null;
}
export function socialThread(thread,cast){
 const actor=validSocialCast(cast)?.people.find(p=>p.thread===thread.id),role=SOCIAL_ROLES[thread.id];if(!actor||!role)return thread;
 return {...thread,actor:actor.name,role:role.role,steps:thread.steps.map((text,index)=>{const renamed=text.split(role.npc).join('「'+actor.name+'」');return `${index===0?'在這一世，':''}${index===0&&thread.id==='rival'?renamed.replace('同行','同行宿敵'):renamed}`;})};
}
