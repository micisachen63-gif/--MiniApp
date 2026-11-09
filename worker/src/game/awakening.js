import {modeForLevel,ENDGAME_VERSION} from './endgame.js';
// Gameplay IDs are deliberately distinct from the pre-existing art-preview IDs.
const rows=[
 ['sword','elite','戰神破勢',18,22,2.6,3,'break'],['sword','expert','壁壘回響',22,28,1.6,3,'guard'],
 ['sword','nightmare','血誓狂潮',25,32,2.4,3,'blood'],['sword','hell','諸神斷罪',35,42,6,1,'verdict'],
 ['archer','elite','逐星連矢',20,22,2.2,5,'pierce'],['archer','expert','群靈共獵',24,30,1,1,'hunt'],
 ['archer','nightmare','月蝕獵印',28,34,2,1,'mark'],['archer','hell','蒼穹裁決',36,40,4,5,'sky'],
 ['mage','elite','星雷共鳴',32,24,2.6,4,'chain'],['mage','expert','霜鏡回流',28,30,1.4,3,'mirror'],
 ['mage','nightmare','元素裂解',36,34,2.5,3,'fracture'],['mage','hell','太初星爆',45,45,5.5,5,'nova'],
 ['thief','elite','影襲連鎖',18,22,1,1,'shadows'],['thief','expert','淬毒散華',22,28,.8,4,'venom'],
 ['thief','nightmare','暗月處決',26,32,2.7,1,'execute'],['thief','hell','永夜分身',32,40,1.2,1,'night'],
];
export const AWAKENINGS=Object.freeze(rows.map(([baseClass,mode,name,cost,cooldown,coefficient,targets,mechanic])=>Object.freeze({id:`awakening:${baseClass}:${mode}`,baseClass,mode,name,cost,cooldown,coefficient,targets,mechanic,unlockLevel:({elite:121,expert:241,nightmare:361,hell:481})[mode],version:ENDGAME_VERSION,artId:`preview:awakening:${baseClass}:${mode}`})));
export function awakeningSnapshot(baseClass,level){const mode=modeForLevel(level);return AWAKENINGS.filter(s=>s.baseClass===baseClass&&s.unlockLevel<=level&&mode.index>0).map(s=>({...s}));}
export function initializeAwakening(state){
  if(!state.map.progression)return;
  state.awakening={version:ENDGAME_VERSION,skills:awakeningSnapshot(state.snapshot.baseClass,state.snapshot.level),nextAt:{},casts:0,damage:0};
}
export function dueAwakening(state,at){return state.awakening?.skills.find(s=>(state.awakening.nextAt[s.id]||0)<=at)||null;}
