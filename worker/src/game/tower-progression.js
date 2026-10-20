// Existing equipment gains a bounded tower imprint; no new equipment pool.
export const TOWER_RULES=Object.freeze({version:2,durationMs:15*60_000,badgesByArea:[10,15,20],imprintMax:5,imprintStep:.02,imprintCosts:[20,30,45,65,90]});
export const TOWER_TITLES=Object.freeze([
 {id:'tower_5',floor:5,name:'月桂初耀'},
 {id:'tower_10',floor:10,name:'迷宮破曉者'},
 {id:'tower_15',floor:15,name:'冥河引星人'},
 {id:'tower_20',floor:20,name:'渡夜登臨者'},
 {id:'tower_25',floor:25,name:'蒼穹追光者'},
 {id:'tower_30',floor:30,name:'星穹登極者'},
]);
export const TOWER_OFFERS=Object.freeze([
 {id:'scroll_w',cost:10,perTier:1,item:'scroll_w',name:'武器強化卷軸'},
 {id:'scroll_a',cost:10,perTier:1,item:'scroll_a',name:'防具強化卷軸'},
 {id:'blessed_scroll_w',cost:60,qty:1,item:'blessed_scroll_w',name:'受祝福的武器強化卷軸'},
 {id:'blessed_scroll_a',cost:60,qty:1,item:'blessed_scroll_a',name:'受祝福的防具強化卷軸'},
]);
export function imprintLevel(item){let bonus={};try{bonus=JSON.parse(item?.bonus_json||'{}');}catch{}const n=bonus.towerImprint;return Number.isInteger(n)&&n>=0&&n<=TOWER_RULES.imprintMax?n:0;}
export const imprintMultiplier=item=>1+imprintLevel(item)*TOWER_RULES.imprintStep;
export function withImprint(item,level){let bonus={};try{bonus=JSON.parse(item.bonus_json||'{}');}catch{}return {...item,bonus_json:JSON.stringify({...bonus,towerImprint:level})};}
export function towerTitle(char){let s={};try{s=JSON.parse(char.special_json||'{}');}catch{}return TOWER_TITLES.find(t=>t.id===s.towerTitle&&t.floor<=(s.towerBest||0))||null;}
export const towerRewardable=p=>p.status==='won'||p.kind==='tower'&&p.state.towerVersion===TOWER_RULES.version&&['lost','ended'].includes(p.status)&&Number.isFinite(p.state.combatStartedAt);
export function clearedFloors(p){return Math.max(0,Math.min(10,(p.state.clearedFloor||p.state.startFloor-1)-(p.state.startFloor-1)));}
export function towerBadges(p){const area=Math.max(0,Math.min(2,Math.floor((p.state.startFloor-1)/10)));return Math.floor(clearedFloors(p)*TOWER_RULES.badgesByArea[area]/10);}
