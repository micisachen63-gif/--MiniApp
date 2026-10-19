import {POTIONS} from './constants.js';
import {mapForLevel} from './formulas.js';

export const potionTierFor = char => Math.min(4, Math.ceil(mapForLevel(char.level) / 3));
export function potionPreference(char,kind){
 let state;try{state=JSON.parse(char?.special_json||'{}');}catch{}
 const key=state?.[kind==='red'?'autoRedPotion':'autoBluePotion'];
 return Object.hasOwn(POTIONS,key)&&POTIONS[key].kind===kind?key:'auto';
}
export const potionKeyFor=(char,kind)=>{const key=potionPreference(char,kind);return key==='auto'?`${kind}_${potionTierFor(char)}`:key;};
export function potionOptions(char,inv,kind){
 return Object.entries(POTIONS).filter(([,p])=>p.kind===kind).map(([key,p])=>({key,name:p.name,heal:p.heal,count:inv[key]||0,unlocked:p.tier<=potionTierFor(char)}));
}
// Explicit choices never spend another potion type when the selected stock runs out.
export function potionStock(char,inv,kind){
 const key=potionPreference(char,kind);
 return key==='auto'?Object.entries(POTIONS).filter(([,p])=>p.kind===kind).reduce((n,[k])=>n+(inv[k]||0),0):inv[key]||0;
}
export function potionHealing(char,inv,kind){
 const key=potionPreference(char,kind);
 return key==='auto'?Object.entries(POTIONS).filter(([,p])=>p.kind===kind).reduce((n,[k,p])=>n+(inv[k]||0)*p.heal,0):(inv[key]||0)*POTIONS[key].heal;
}
