import {TICK_MS} from './constants.js';
// Protect previously accrued offline minutes from a new skill/potion schedule.
export function armIdleSkillRotation(c,now){
 let x;try{x=JSON.parse(c.special_json||'{}');}catch{x={};}
 if(c.party_id||now-c.last_settle_at<TICK_MS||Number.isFinite(x.idleAutoFrom)||(x.loadout||[]).filter(id=>x.auto?.[id]&&x.auto[id]!=='manual').length<2)return c;
 return {...c,special_json:JSON.stringify({...x,idleAutoFrom:now})};
}
export function idleSkillOrder(x,now){
 if(Number.isFinite(x.idleAutoFrom)&&now<=x.idleAutoFrom)return x.loadout;
 const start=Math.max(0,x.loadout.indexOf(x.idleAutoNext));return [...x.loadout.slice(start),...x.loadout.slice(0,start)];
}
