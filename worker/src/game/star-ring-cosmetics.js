// Permanent, character-bound visuals. These records never enter combat stats.
const root='/art/star-ring-rewards-20261018/';
export const COSMETICS=Object.freeze([
 {id:'star_ring_aura_dawn',name:'曙星之環',cost:60,tone:'dawn',description:'晨曦金羽與星砂環繞身側，留下溫暖光流。'},
 {id:'star_ring_aura_moon',name:'月潮星紋',cost:120,tone:'moon',description:'銀藍月潮與細碎星光在身側輕盈流轉。'},
 {id:'star_ring_aura_eclipse',name:'星蝕王冠',cost:180,tone:'eclipse',description:'紫金星霧與金色星點交織，環繞王者身影。'}
].map(c=>Object.freeze({...c,level:40,slot:'aura',bound:true,visualOnly:true,art:`/art/star-ring-surround-20261026/surround-${c.tone}.webp`,icon:`${root}icon-${c.tone}.webp`})));
export const cosmeticById=id=>COSMETICS.find(c=>c.id===id)||null;
export function equippedAura(char){try{return cosmeticById(JSON.parse(char.special_json||'{}').starRingAura);}catch{return null;}}
