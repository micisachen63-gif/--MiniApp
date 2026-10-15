// Approved gameplay settings are loaded from JSON; alternatives remain available for economic comparison.
import settings from './guardian-sigil-settings.json' with {type:'json'};
export const QUALITY_ORDER = Object.freeze(['white','green','blue','purple','red','gold','pink','cyan']);
export const DRAWABLE_QUALITY_COUNT=6;
export const UPGRADE_COUNTS=Object.freeze([4,4,4,4,4,6,6]);
export const TYPES = Object.freeze(['melee','ranged','magic','loot']);
export const WEIGHT_TOTAL = 1_000_000;
export const QUALITY_NAMES = Object.freeze(['白','綠','藍','紫','紅','金','粉','青']);
export const TYPE_NAMES = Object.freeze({melee:'天使・熾刃',ranged:'天使・星弦',magic:'天使・秘曜',loot:'天使・豐穗'});
export const TYPE_ABILITIES = Object.freeze({melee:'近戰傷害',ranged:'遠程傷害',magic:'魔法傷害',loot:'隨機掉寶率'});
export const DAMAGE_BONUSES = Object.freeze([.01,.02,.04,.07,.11,.16,.22,.30]);
export const LOOT_BONUSES = Object.freeze([.02,.05,.10,.18,.30,.50,.75,1]);
export const ACTIONS_DISABLED = Object.freeze({summon:false,fuse:false,activate:false,lock:false,unbind:false,trade:false,share:false});

export const CANDIDATES = Object.freeze({
 conservative:Object.freeze({name:'保守',normal:[700000,260000,38500,1400,98,2,0,0],featured:[0,350000,580000,65000,4900,100,0,0],fusionSuccess:[1,.90,.80,.70,.60,.70,.60],budgetFraction:.20,targetNewcomerDraws:3,tenDiscount:0,mixedTop:true}),
 balanced:Object.freeze({name:'平衡',normal:[649490,285000,53000,7500,5000,10,0,0],featured:[0,300000,589800,80000,30000,200,0,0],fusionSuccess:[1,.95,.85,.80,.40,.80,.95],budgetFraction:.20,targetNewcomerDraws:4,tenDiscount:0,mixedTop:true}),
 exciting:Object.freeze({name:'高刺激',normal:[620000,320000,57500,2300,195,5,0,0],featured:[0,250000,630000,100000,19500,500,0,0],fusionSuccess:[1,.95,.90,.85,.80,.90,.80],budgetFraction:.25,targetNewcomerDraws:5,tenDiscount:.05,mixedTop:true}),
});

export function validateCandidate(c) {
 for(const pool of ['normal','featured']) {
  if(!Array.isArray(c[pool])||c[pool].length!==8||c[pool].some(x=>!Number.isInteger(x)||x<0)||c[pool].reduce((a,b)=>a+b,0)!==WEIGHT_TOTAL)throw new Error('invalid probability weights');
 }
 if(c.normal.slice(0,6).some(x=>x<=0)||c.featured[0]!==0||c.featured.slice(1,6).some(x=>x<=0)||c.normal.slice(6).some(x=>x!==0)||c.featured.slice(6).some(x=>x!==0))throw new Error('invalid pool floor');
 if(c.fusionSuccess.length!==7||c.fusionSuccess.some(x=>!(x>0&&x<=1)))throw new Error('invalid fusion success');
 const mean=weights=>weights.reduce((n,w,i)=>n+w*(i+1)/WEIGHT_TOTAL,0);
 if(mean(c.featured)<=mean(c.normal))throw new Error('featured quality must be higher');
 return c;
}
for(const c of Object.values(CANDIDATES))validateCandidate(c);

export function publicDraftConfig() {
 return {schemaVersion:1,configVersion:'guardian-draft-v2',status:'pending_approval',enabled:false,
  qualityOrder:[...QUALITY_ORDER],types:TYPES.map(id=>({id,name:TYPE_NAMES[id],ability:TYPE_ABILITIES[id]})),
  qualities:QUALITY_ORDER.map((id,i)=>({id,rank:i+1,name:QUALITY_NAMES[i],damageBonus:DAMAGE_BONUSES[i],lootBonus:LOOT_BONUSES[i]})),
  pools:{normal:{id:'normal',name:'普通召喚',allowedCounts:[1,5,10],rates:[],singleGoldPrice:null,tenGoldPrice:null},featured:{id:'featured',name:'精選召喚',allowedCounts:[1,5,10],rates:[],drawsPerVoucher:5}},
  limits:{dailyVouchers:4,maxDraws:10,unlockLevel:15,announcementMinimumRank:4,visualMinimumRank:4},
  rules:{status:'pending_approval',upgradeStages:UPGRADE_COUNTS.map((materials,i)=>({from:QUALITY_ORDER[i],to:QUALITY_ORDER[i+1],materials,refundOnFailure:1,successRate:null,goldFee:null})),mixedTypeFusion:null,fusionFee:null,fusionSuccess:null,unbindScrollCost:null,bossGrantTiming:null,vouchersTradeable:null},actions:{...ACTIONS_DISABLED}};
}

/** One voucher becomes five credits; unspent partial credits stay 0..4. */
export function creditQuote(vouchers,remainder,count) {
 if(![vouchers,remainder,count].every(Number.isSafeInteger)||vouchers<0||remainder<0||remainder>4||count<1)throw new Error('invalid credit amount');
 const consumedVouchers=Math.ceil(Math.max(0,count-remainder)/5);
 if(consumedVouchers>vouchers)throw new Error('insufficient vouchers');
 return {consumedVouchers,voucherCount:vouchers-consumedVouchers,remainder:remainder+consumedVouchers*5-count,availableDraws:vouchers*5+remainder-count};
}

export function activeSettings(env={}){
 const cfg=env.GUARDIAN_SETTINGS?{...settings,...JSON.parse(env.GUARDIAN_SETTINGS)}:settings;
 const valid={normal:cfg.normalWeights,featured:cfg.featuredWeights,fusionSuccess:cfg.upgradeSuccess};validateCandidate(valid);
 if(!Number.isSafeInteger(cfg.assist?.stoneGold)||cfg.assist.stoneGold<1||!Number.isSafeInteger(cfg.assist?.battlesPerStone)||cfg.assist.battlesPerStone<1)throw new Error('invalid guardian assist settings');
 if(!Number.isSafeInteger(cfg.normalSingleGold)||cfg.normalSingleGold<1||!Number.isSafeInteger(cfg.normalTenGold)||cfg.normalTenGold<1)throw new Error('invalid guardian price');
 if(cfg.upgradeMaterials?.join(',')!=='4,4,4,4,4,6,6'||cfg.upgradeGoldFees?.length!==7||cfg.upgradeGoldFees.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('invalid upgrade settings');
 if(cfg.limits?.dailyVouchers!==4||cfg.limits?.drawsPerVoucher!==5||cfg.limits?.maxDraws!==10||cfg.limits?.unlockLevel!==15)throw new Error('invalid guardian limits');
 for(const key of ['damageBonuses','lootBonuses','unbindScrolls'])if(cfg[key]?.length!==8||cfg[key].some(x=>!Number.isFinite(x)||x<0))throw new Error('invalid guardian '+key);
 return cfg;
}
export function publicConfig(env={}){
 const cfg=activeSettings(env),base=publicDraftConfig();
 return {...base,configVersion:cfg.configVersion,status:cfg.status,enabled:cfg.enabled,
  scene:{treeArtUrl:'/art/guardian-scene-20261014/world-tree-poster.webp',deityArtUrl:'/art/guardian-scene-20261014/archangel-poster.png',featherArtUrl:'/art/guardian-sigil-20261013/summon-feather.webp',treeVideoUrl:'/art/guardian-scene-20261014/world-tree-loop.mp4',deityVideoUrl:'/art/guardian-scene-20261014/archangel-loop-alpha.webm',transitionVideoUrl:'/art/guardian-result-20261014/feather-transition-alpha.webm',transitionDurationMs:1834,angelPose:'portrait'},
  types:base.types.map(t=>({...t,artUrl:`/art/guardian-sigil-20261013/${t.id}.webp`,...(t.id==='ranged'?{guideArtUrl:'/art/guardian-sigil-20261014/ranged-guide-wide.webp'}:{}),artAlt:t.name})),
  qualities:base.qualities.map((q,i)=>({...q,damageBonus:cfg.damageBonuses[i],lootBonus:cfg.lootBonuses[i]})),
  pools:{normal:{...base.pools.normal,singleGoldPrice:cfg.normalSingleGold,tenGoldPrice:cfg.normalTenGold,rates:cfg.normalWeights.map((weight,i)=>({quality:QUALITY_ORDER[i],percent:weight/10000}))},featured:{...base.pools.featured,rates:cfg.featuredWeights.map((weight,i)=>({quality:QUALITY_ORDER[i],percent:weight/10000}))}},
  limits:cfg.limits,assist:cfg.assist,
  rules:{status:cfg.status,pity:false,vouchersTradeable:false,bossGrantTiming:cfg.bossGrantTiming,upgradeStages:cfg.upgradeMaterials.map((materials,i)=>({from:QUALITY_ORDER[i],to:QUALITY_ORDER[i+1],materials,refundOnFailure:1,successRate:cfg.upgradeSuccess[i],goldFee:cfg.upgradeGoldFees[i],mixedTypes:i+1>=cfg.mixedFromQuality,resultType:'primary_card',refundCard:'primary_card',binding:'any_input_bound'})),unbindScrollCost:cfg.unbindScrolls},
  actions:Object.fromEntries(Object.keys(ACTIONS_DISABLED).map(k=>[k,cfg.enabled===true&&cfg.status==='approved']))};
}
