import {ITEMS} from '../game/constants.js';
// Deliberate, reviewable allowlist: new game item kinds do not become mintable automatically.
// Fate gifts and welcome entitlements require dedicated rows and are deliberately excluded.
export const GRANT_ITEM_IDS=Object.freeze([
 'star_ring_token','star_ring_core','guardian_summon_stone','guardian_voucher',
 'boss_essence','relic_fragment','research_fragment','tower_fragment','trial_3','trial_4',
 'gacha_weapon','gacha_armor','scroll_w','scroll_a','blessed_scroll_w','blessed_scroll_a',
 'guaranteed_scroll_w','guaranteed_scroll_a','scroll_r','unbind','ward',
 'reselect_1','reselect_2','reselect_3',
 ...Array.from({length:4},(_,i)=>i+1).flatMap(i=>['red_'+i,'blue_'+i,'mat_'+i]),
 ...Array.from({length:12},(_,i)=>i+1).flatMap(i=>['hunt_'+i+'_1','hunt_'+i+'_2','hunt_'+i+'_3','hunt_'+i+'_sigil','hunt_'+i+'_core','collection_'+i]),
 ...Array.from({length:24},(_,i)=>i+1).flatMap(i=>Array.from({length:i<=6?3:2},(_,j)=>'book_skill_'+String(i).padStart(2,'0')+'_'+(j+1))),
 ...Array.from({length:6},(_,i)=>'book_skill_thief_'+String(i+1).padStart(2,'0')),
]);
const allowed=new Set(GRANT_ITEM_IDS);
export const grantable=id=>allowed.has(id)&&Object.hasOwn(ITEMS,id);
export const grantCatalog=()=>GRANT_ITEM_IDS.filter(grantable).map(id=>({id,name:ITEMS[id].name,kind:ITEMS[id].kind,emoji:ITEMS[id].emoji,maxHold:ITEMS[id].maxHold||null}));
