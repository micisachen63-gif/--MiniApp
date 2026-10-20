// One shared pure mapping for Mini App, market/escrow, reward views and TG cards.
export const STAR_RING_ART_ROOT='/art/star-ring-gear-20261020/';
const weapons=['sword','greatsword','sword_shield','staff','elem_staff','wand','longbow','compound_bow','crossbow','dagger','dual_daggers','throwing_blades'];
const classes=['sword','mage','archer','thief'],armor=['helmet','armor','gloves','boots'],shared=['belt','undershirt','earring','ring'];
const rarities=['common','advanced','epic','legendary','supreme','relic'];
export const STAR_RING_ART_IDS=Object.freeze([...classes.flatMap(c=>armor.map(s=>c+'-'+s)),...shared.map(s=>'shared-'+s),...weapons.map(k=>'weapon-'+k)]);
export function starRingArtId(e){
 if(e?.source!=='star_ring')return null;
 if(e.slot==='weapon')return weapons.includes(e.kind)?'weapon-'+e.kind:null;
 if(shared.includes(e.slot))return 'shared-'+e.slot;
 const cls=e.class_req??e.classReq;return armor.includes(e.slot)&&classes.includes(cls)?cls+'-'+e.slot:null;
}
export function starRingIcon(e){const id=starRingArtId(e);return id?STAR_RING_ART_ROOT+id+'.webp':null;}
export function starRingCard(e,rarity='legendary'){const id=starRingArtId(e);return id?STAR_RING_ART_ROOT+'cards/'+id+'_'+(rarities.includes(rarity)?rarity:'legendary')+'.jpg':null;}
if(typeof window!=='undefined')globalThis.RpgStarRingGearArt=Object.freeze({gearArt:starRingIcon,artId:starRingArtId,cardPhoto:starRingCard});
