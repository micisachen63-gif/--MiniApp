// One character, one universal blessing. No class restrictions or collection stacking.
const definitions=[
 [1,'月桂庇護','生命上限 +6%',{maxHpPct:.06},'適合承受傷害、增加生存餘裕。'],
 [2,'智慧泉源','魔力上限 +8%',{maxMpPct:.08},'增加施放技能與持續作戰的餘裕。'],
 [3,'聖林勇氣','攻擊力 +3%',{atkPct:.03},'所有職業的普通攻擊與攻擊技能都受益。'],
 [4,'潮汐循環','技能耗魔降低 4%',{mpEfficiencyPct:.04},'減少技能耗魔；仍遵守原有耗魔取整與上限。'],
 [5,'迷宮壁壘','防禦力 +6%',{defPct:.06},'適合需要降低承受傷害的角色。'],
 [6,'熔火鋒芒','爆擊率 +3 個百分點',{critPct:.03},'適合群組首領、組隊與決鬥中追求爆擊。'],
 [7,'冥河護魂','受到傷害降低 3%',{mitigationPct:.03},'提高生存力；與既有減傷共用原有上限。'],
 [8,'神諭均衡','生命上限 +3% · 魔力上限 +4%',{maxHpPct:.03,maxMpPct:.04},'兼顧生命與施放技能的餘裕。'],
 [9,'泰坦戰意','攻擊力 +2% · 防禦力 +3%',{atkPct:.02,defPct:.03},'兼顧輸出與防禦。'],
 [10,'雲門靈感','技能耗魔降低 2% · 爆擊率 +1.5 個百分點',{mpEfficiencyPct:.02,critPct:.015},'兼顧持續施法與爆擊。'],
 [11,'至福守望','生命上限 +3% · 受到傷害降低 1.5%',{maxHpPct:.03,mitigationPct:.015},'適合在隊伍中承受傷害與穩定存活。'],
 [12,'星穹祝願','攻擊力 +1.5% · 生命上限 +2% · 魔力上限 +3%',{atkPct:.015,maxHpPct:.02,maxMpPct:.03},'全職業適用的均衡祝福。']
];
export const COLLECTION_BLESSINGS=Object.freeze(definitions.map(([mapId,name,summary,bonuses,tip])=>Object.freeze({mapId,item:`collection_${mapId}`,name,summary,bonuses:Object.freeze(bonuses),tip,scope:'自身',universal:true})));
export function collectionBlessing(char){const id=char?.collection_active_map;return Number.isInteger(id)&&id>0?COLLECTION_BLESSINGS.find(x=>x.mapId===id)||null:null;}
export function collectionBlessingView(char,inv){const active=collectionBlessing(char);return active&&(inv?.[active.item]||0)>0?active:null;}
