export const BOSS_EXCHANGES=Object.freeze({
 reroll:{name:'洗屬性捲 ×5',cost:5,item:'scroll_r',qty:5},
 weapon:{name:'武器強化捲 ×4',cost:5,item:'scroll_w',qty:4},
 armor:{name:'防具強化捲 ×4',cost:5,item:'scroll_a',qty:4},
 blessedWeapon:{name:'祝福武器卷軸 ×1',cost:80,item:'blessed_scroll_w',qty:1},
 blessedArmor:{name:'祝福防具卷軸 ×1',cost:80,item:'blessed_scroll_a',qty:1},
 fragment:{name:'遺物碎片 ×1',cost:5,item:'relic_fragment',qty:1},
 relic:{name:'本職業隨機部位遺物 ×1',currency:'relic_fragment',cost:30,qty:1},
});
// Only the first four contributing kills per Telegram account per Taipei day award essence.
export function essencePlan(tier,attackers){const seen=new Set();return [...attackers].sort((a,b)=>b.damage-a.damage).filter(a=>{const account=String(a.char.account_tg_id||a.tg_id);if(a.damage<=0||seen.has(account)||(a.essenceToday||0)>=4)return false;seen.add(account);return true;}).map(a=>({tgId:a.tg_id,account:String(a.char.account_tg_id||a.tg_id),name:a.name,qty:4+Math.max(1,Math.min(12,tier))}));}
