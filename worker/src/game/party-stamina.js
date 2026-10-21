export const PARTY_STAMINA=Object.freeze({max:100,cost:20,intervalMs:360000,perHour:10});
export const usesStamina=p=>p.kind==='dungeon'&&!p.state.trial;
export function partyStamina(char,now){
 let x;try{x=JSON.parse(char.special_json||'{}').partyStamina;}catch{}
 const valid=x&&Number.isInteger(x.points)&&x.points>=0&&x.points<=PARTY_STAMINA.max&&Number.isFinite(x.at);
 const at=valid?Math.min(now,x.at):now,stored=valid?x.points:PARTY_STAMINA.max;
 const gained=Math.floor(Math.max(0,now-at)/PARTY_STAMINA.intervalMs),points=Math.min(PARTY_STAMINA.max,stored+gained);
 const anchor=points===PARTY_STAMINA.max?now:at+gained*PARTY_STAMINA.intervalMs;
 return {points,max:PARTY_STAMINA.max,cost:PARTY_STAMINA.cost,perHour:PARTY_STAMINA.perHour,at:anchor,nextAt:points<PARTY_STAMINA.max?anchor+PARTY_STAMINA.intervalMs:null,readyAt:points<PARTY_STAMINA.cost?anchor+(PARTY_STAMINA.cost-points)*PARTY_STAMINA.intervalMs:null,ready:points>=PARTY_STAMINA.cost};
}
export function spentStamina(char,now){const s=partyStamina(char,now);return {points:s.points-s.cost,at:s.at};}
