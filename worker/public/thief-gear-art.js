// Shared pure art contract for browser and Worker. This module never changes gameplay or release gates.
export const THIEF_GEAR_THEMES=Object.freeze(['laurel','athena','sacred','poseidon','labyrinth','forge','styx','oracle','titan','cloudgate','elysium','cosmos']);
export const THIEF_GEAR_WEAPONS=Object.freeze(['dagger','dual_daggers','throwing_blades']);
export const THIEF_GEAR_ARMOR=Object.freeze({helmet:'helm',armor:'arm',gloves:'gloves',boots:'boots'});
export function isThiefClassGear(item){
 if(!item)return false;
 const cls=item.class_req??item.classReq;
 return item.slot==='weapon'?(cls==='thief'||THIEF_GEAR_WEAPONS.includes(item.kind)):Object.hasOwn(THIEF_GEAR_ARMOR,item.slot)&&(cls==='thief'||item.kind==='light_leather');
}
export function thiefGearArt(item){
 if(!isThiefClassGear(item))return null;
 const tier=Number(item.tier);
 if(!Number.isInteger(tier)||tier<1||tier>12)return null;
 const theme=THIEF_GEAR_THEMES[tier-1];
 let artId;
 if(item.slot==='weapon'){
  if(!THIEF_GEAR_WEAPONS.includes(item.kind)||tier===1&&item.kind!=='dagger')return null;
  artId='gear_wpn_'+theme+'_'+item.kind;
 }else artId='gear_'+THIEF_GEAR_ARMOR[item.slot]+'_'+theme+'_light_leather';
 return {artId,iconSrc:'art/thief-gear-20261015/'+artId+'.webp',cardPrefix:'/art/cards/thief-gear-20261015/'+artId,classSpecific:true};
}
export function thiefGearCardPhoto(item,rarity='common'){
 const art=thiefGearArt(item);
 if(!art)return null;
 const frame=['common','advanced','epic','legendary','supreme','relic'].includes(rarity)?rarity:'common';
 return art.cardPrefix+'_'+frame+'.jpg';
}
export const THIEF_GEAR_ART_IDS=Object.freeze(THIEF_GEAR_THEMES.flatMap((theme,index)=>[
 ...THIEF_GEAR_WEAPONS.filter(kind=>index>0||kind==='dagger').map(kind=>'gear_wpn_'+theme+'_'+kind),
 ...Object.values(THIEF_GEAR_ARMOR).map(slot=>'gear_'+slot+'_'+theme+'_light_leather'),
]));
const legalIds=new Set(THIEF_GEAR_ART_IDS);
export function iconForArtId(artId){return typeof artId==='string'&&legalIds.has(artId)?'art/thief-gear-20261015/'+artId+'.webp':null;}
if(typeof window!=='undefined')window.RpgThiefGearArt=Object.freeze({resolve:thiefGearArt,isThiefClassGear,cardPhoto:thiefGearCardPhoto,iconForArtId});
