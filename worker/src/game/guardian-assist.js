// Guardian support is separate from permanent PvE equipment bonuses and PK.
// Time is counted only in actual one-minute idle battles, never town/party waits.
export const ASSIST_ITEM='guardian_summon_stone';
export function assistSupply(c,inv,settings,hours=24){const remaining=assistActive(c)?.remainingBattles||0,owned=inv[ASSIST_ITEM]||0,need=c.level>=15?Math.max(0,Math.ceil((hours*60-remaining)/settings.battlesPerStone)-owned):0;return {stoneCount:owned,remainingBattles:remaining,needed:need,stoneGold:settings.stoneGold,cost:need*settings.stoneGold,battlesPerStone:settings.battlesPerStone};}
export function assistActive(c){let x;try{x=JSON.parse(c.special_json||'{}')}catch{return null;}const a=x.guardianAssist;return a&&a.itemId===c.guardian?.id&&a.remainingBattles>0?a:null;}
export function beginAssistBattle(c,inv,use,bought=()=>{}){
 let x;try{x=JSON.parse(c.special_json||'{}')}catch{x={};}
 const a=x.guardianAssist;c.guardianAssistActive=false;
 if(!x.guardianSummonEnabled||!a||a.itemId!==c.guardian?.id)return;
 const continues=a.autoRenew===true||a.autoRenew===undefined;
 if(a.remainingBattles<=0){
  // A legacy selection queues its first stone. Continuation applies only after
  // that funded round; undefined flags retain the old legacy opt-in behavior.
  if(a.pendingFirstStone!==true&&!continues){x.guardianSummonEnabled=false;c.special_json=JSON.stringify(x);return;}
  const settings=c.guardianAssistSettings||{stoneGold:3000,battlesPerStone:1440};
  if(!(inv[ASSIST_ITEM]>0)&&x.guardianStoneSupply&&c.gold>=settings.stoneGold){c.gold-=settings.stoneGold;inv[ASSIST_ITEM]=(inv[ASSIST_ITEM]||0)+1;bought(settings.stoneGold);}
  if((inv[ASSIST_ITEM]||0)>0){use(ASSIST_ITEM);a.remainingBattles=settings.battlesPerStone;a.pendingFirstStone=false;}
 }
 if(a.remainingBattles<=0){x.guardianSummonEnabled=false;c.special_json=JSON.stringify(x);return;}
 c.guardianAssistActive=true;a.remainingBattles--;if(a.remainingBattles===0&&!continues)x.guardianSummonEnabled=false;c.special_json=JSON.stringify(x);
}
export const idleGuardianActor=c=>c.guardianAssistActive&&c.guardian?{...c,guardian:{...c.guardian,damageBonus:c.guardian.damageBonus*2,lootBonus:c.guardian.lootBonus*2}}:c;
