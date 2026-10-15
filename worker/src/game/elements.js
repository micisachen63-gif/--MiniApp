import {ELEMENT_KEYS} from './constants.js';
const finite=x=>Number.isFinite(Number(x))?Math.max(0,Number(x)):0;
export function elementMultiplier(atk,def){if(!atk||!def||atk===def)return 1;const beats={water:'fire',fire:'wind',wind:'earth',earth:'water'};if(beats[atk]===def)return 1.25;if(beats[def]===atk)return .85;if(atk==='light'&&def==='dark'||atk==='dark'&&def==='light')return 1.2;return 1;}
export function resistanceRate(target,element){const points=finite(target?.elementResist?.[element]);return Math.min(.4,points/(points+6*Math.max(1,finite(target?.level))+100));}
export function elementalDamage(raw,actor,target,{bonus=true}={}){raw=finite(raw);if(!ELEMENT_KEYS.includes(actor?.element))return raw;const power=bonus?Math.min(finite(actor.weaponElem),raw*.5):0;let mult=elementMultiplier(actor.element,target?.element);if(mult>1)mult+=Math.min(.5,finite(actor.pct?.elemPct??actor.affixPct?.elemPct));return (raw+power)*mult*(1-resistanceRate(target,actor.element));}
export const mapElement=map=>({1:'earth',2:'earth',3:'wind',4:'water',5:'fire',6:'earth',7:'dark',8:'earth',9:'fire',10:'wind',11:'light',12:'water'})[map]||'earth';
export function bossResistance(level,element){return {[element]:Math.max(1,finite(level))*2};}
