import {IDLE,TICK_MS} from './constants.js';
import {monsterPressure} from './formulas.js';
export const PVE_BALANCE_VERSION=2;
const state=c=>{try{return JSON.parse(c.special_json||'{}');}catch{return {};}};
export function idleBalanceFrom(c){const v=state(c).idleBalance;return v?.version===2&&Number.isFinite(v.from)?v.from:null;}
export function idleBalanceVersion(c,at=Infinity){const from=idleBalanceFrom(c);return from!=null&&at>from?2:1;}
// A character's first post-update settlement keeps every already accrued minute.
// Start the new rules only AFTER this observed boundary, not retroactively.
export function armIdleBalance(c,now){
 if(c.party_id||c.level<=30||now-c.last_settle_at<TICK_MS||idleBalanceFrom(c)!=null)return c;
 return {...c,special_json:JSON.stringify({...state(c),idleBalance:{version:2,from:now}})};
}
export function idleEncounter(s,level,legacy,version){
 if(version<2||level<=30)return {...legacy,version:1};
 const progress=level-30,armorScale=(6*level+40)*(1+progress*.01),dr=s.def/(s.def+armorScale);
 const hpLoss=monsterPressure(level)*(1+progress/10)*(1-dr)*s.taken-IDLE.hpRegenPct*s.maxHp;
 const eliteScale=(6*level+40)*(3+progress*.03),raw=(120+24*level)*(.55+progress*.002)*eliteScale/(eliteScale+s.def)*s.taken;
 const blend=Math.min(1,progress/10),burst=legacy.burst*(1-blend)+Math.min(s.maxHp*.42,raw)*blend;
 return {version:2,hpLoss,dr,burst};
}
// Fixed encounter stats. Better weapons do not cause an enemy HP increase.
// These profiles are stamped only on NEW ordinary dungeon departures.
export const DUNGEON_BALANCE=Object.freeze({
 aegean:Object.freeze({hp:18000,attack:300,defenseScale:620}),
 forge:Object.freeze({hp:36000,attack:450,defenseScale:800}),
 river:Object.freeze({hp:65000,attack:650,defenseScale:980}),
 titan:Object.freeze({hp:105000,attack:900,defenseScale:1160}),
 oracle:Object.freeze({hp:150000,attack:1200,defenseScale:1340}),
 stars:Object.freeze({hp:210000,attack:1500,defenseScale:1520}),
});
export const dungeonProfile=p=>p.kind==='dungeon'&&!p.state.trial?DUNGEON_BALANCE[p.state.dungeonId]||null:null;
