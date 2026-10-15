import {READY_MONSTER_KEYS,MONSTER_ART_REVISION} from './monster-readiness.js';
export {MONSTER_ART_REVISION} from './monster-readiness.js';
// Stateless preflight. Pure helper takes an explicit ready set for regression tests;
// production always uses the release-controlled module, never a client/body override.
export function monsterArtCompatibility(action,clientRevision,{readyKeys=READY_MONSTER_KEYS}={}) {
  if(!(readyKeys.size??readyKeys.length)||action==='meta'||action==='characters'||clientRevision===MONSTER_ART_REVISION||clientRevision==='monster16-v2-4a7ad381e75bf3190883de9224caa00e86a0ede9f54087566d3b4610af07a459'||clientRevision==='monster16-v2-9ee5f5c6908b4107')return null;
  return {error:'assets_update_required',status:409,message:'怪物內容已更新，請關閉遊戲後重新開啟，載入新圖與動畫。'};
}
