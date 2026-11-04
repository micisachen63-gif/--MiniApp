import {CLASS_KEYS,SLOTS,WEAPON_KINDS,ARMOR_FAMILIES} from './constants.js';
import {makeGear,isShared} from './gear.js';
import {mulberry32,pick} from './rng.js';
import {GameError} from './classes.js';

const invalid=()=>{throw new GameError('atlas_loot_invalid','星圖戰利品快照不一致，請保留出征紀錄',409);};
/** Materialize server-authored blueprints. No wall-clock RNG or current class change
 * can alter a committed drop; identity, tier and class come from its run snapshot. */
export function materializeAtlasEquipment(state,reward,charId){
 const blueprints=reward.equipment||[];
 if(!Array.isArray(blueprints))invalid();
 if(!blueprints.length)return [];
 if(state.ruleset_version!=='atlas-v4'||reward.runId!==state.runId||String(state.snapshot.characterId)!==String(charId)||reward.mapId!==state.mapId)invalid();
 const now=(state.startedAt+reward.elapsedSeconds)*1000;
 return blueprints.map(b=>{
  if(b.rulesVersion!=='atlas-loot-v1'||b.source!=='atlas'||typeof b.id!=='string'||!b.id.startsWith('atlas:'+state.runId+':equipment:')||
     !Number.isInteger(b.seed)||b.seed<0||b.seed>0xffffffff||!Number.isInteger(b.tier)||b.tier<1||b.tier>12||b.tier!==state.map.dropTier||
     !CLASS_KEYS.includes(b.baseClass)||b.baseClass!==state.snapshot.baseClass||b.classPath!==(state.content?.classPath??state.snapshot.classPath??'')||
     !['common','advanced'].includes(b.rarityFloor))invalid();
  const rng=mulberry32(b.seed),slot=pick(rng,SLOTS);
  const kind=slot==='weapon'?pick(rng,Object.entries(WEAPON_KINDS).filter(([,w])=>w.cls===b.baseClass&&w.names[b.tier]&&(!w.branch||w.branch===b.classPath[0])).map(([k])=>k)):isShared(slot)?slot:ARMOR_FAMILIES[b.baseClass].key;
  const item=makeGear({id:b.id,tgId:String(charId),cls:b.baseClass,slot,kind,tier:b.tier,rng,now,source:'atlas',rarityFloor:b.rarityFloor,prefix:'星圖'});
  item.bonus_json=JSON.stringify({...JSON.parse(item.bonus_json),atlasLootVersion:b.rulesVersion,atlasLootRunId:state.runId,atlasLootMapId:reward.mapId,atlasLootRewardId:reward.id});
  return item;
 });
}
export function atlasInventoryDrops(state,reward){
 const items=reward.items||{};
 if(!items||typeof items!=='object'||Array.isArray(items))invalid();
 for(const [key,n]of Object.entries(items))if(state.ruleset_version!=='atlas-v4'||!['scroll_w','scroll_a'].includes(key)||!Number.isInteger(n)||n<1||n>96)invalid();
 return items;
}
