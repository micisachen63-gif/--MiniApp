import {READY_MONSTER_KEYS,MONSTER_ART_REVISION} from './monster-readiness.js';
export {MONSTER_ART_REVISION} from './monster-readiness.js';
// Stateless preflight. Pure helper takes an explicit ready set for regression tests;
// production always uses the release-controlled module, never a client/body override.
export function monsterArtCompatibility(action,clientRevision,{readyKeys=READY_MONSTER_KEYS}={}) {
  if(!(readyKeys.size??readyKeys.length)||action==='meta'||action==='characters'||clientRevision===MONSTER_ART_REVISION)return null;
  return {error:'assets_update_required',status:409,message:'怪物內容已更新，請關閉遊戲後重新開啟，載入新圖與動畫。'};
}
