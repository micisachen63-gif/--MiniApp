// Versioned v2 encounter catalogue. Never reorder a published map or alter a
// seeded selection recipe: in-progress/offline expeditions must replay exactly.
import {rngFor} from './rng.js';

const rows=[
 [['碎潮寄居蟹','shield','碎潮殼盾','螯足拍擊'],['星礫沙蜥','venom','星礫毒息','砂尾橫掃'],['岸礁破浪者','cleave','破浪重鉗','礁鉗撞擊']],
 [['白曜風隼','swoop','白曜俯衝','風羽啄擊'],['浮階晶蛾','hollow','晶翅折光','粉晶飛散'],['曦穹雙翼獸','gust','雙翼風暴','曦爪撲擊']],
 [['碎齒巡械','shield','巡械護殼','碎齒切割'],['銅環弩偶','cleave','銅弩齊射','弩臂撞擊'],['斷輪重裝者','shield','重裝堡壘','斷輪衝撞']],
 [['月鏡蝶','hollow','月鏡幻光','鏡翅切風'],['映影狐','song','映影月鳴','狐爪掠擊'],['雙面鏡侍','unravel','雙鏡束縛','鏡刃穿刺']],
 [['銀絲螳螂','drain','銀絲汲能','鎌臂斬擊'],['夜露瓢甲','venom','夜露毒霧','甲角撞擊'],['織庭蛛后','drain','織庭奪魔','蛛足貫刺']],
 [['琉璃水母','torrent','琉璃寒潮','水母電觸'],['晶鰭躍魚','swoop','晶鰭掠水','飛鰭切擊'],['瀑心角螺','tide','瀑心護潮','螺角撞擊']],
 [['殘月紙靈','song','紙頁哀鳴','月紙割痕'],['鎖鏈燭使','curse','燭影咒印','鎖鏈抽擊'],['沉鐘守墓者','shield','沉鐘護障','鐘錘震擊']],
 [['風脊岩羊','cleave','岩角衝鋒','羊角頂擊'],['裂風翼蛇','gust','裂風雙襲','翼蛇噬咬'],['暴風鷹衛','gust','暴風羽陣','鐵羽掠擊']],
 [['曜角幼犀','cleave','曜角踐踏','犀角撞擊'],['金棘獵犬','cleave','金棘追獵','獵犬撕咬'],['星冠巨熊','shield','星冠護甲','熊掌震擊']],
 [['墨潮鰩','tide','墨潮護幕','鰩尾抽擊'],['黯礁海馬','torrent','黯礁寒流','螺尾敲擊'],['深淵鉗皇','tide','深淵甲潮','皇鉗斬擊']],
 [['寂星書妖','drain','寂星封頁','書翼拍擊'],['斷弦琴靈','song','斷弦殘響','琴弦割擊'],['王庭司儀','unravel','王庭禁令','雙杖交擊']],
 [['蝕晶飛蝠','venom','蝕晶毒音','晶翼噬咬'],['灰燼星骸','curse','灰燼咒痕','星骸重擊'],['終殿執刑獸','cleave','終殿斷刃','前刃劈斬']]
];
const roleByMechanic={shield:['breach'],hollow:['breach'],venom:['aid'],drain:['aid'],swoop:['control'],song:['control'],curse:['aid','control'],gust:['guard','control'],cleave:['guard'],torrent:['aid','control'],tide:['aid','breach'],unravel:['guard','breach','aid']};
export const POOL_ART='/art/star-ring-pools-20261019/';
export const POOL_MONSTERS=Object.freeze(rows.flatMap((map,hourIndex)=>map.map(([name,mechanic,spell,basicAttack],slot)=>{
 const serial=String(hourIndex+1).padStart(2,'0'),suffix=['normal-a','normal-b','elite'][slot],rank=slot===2?'elite':'normal';
 return Object.freeze({enemyId:`sr2_${serial}_${['a','b','e'][slot]}`,enemyName:name,hourIndex,rank,mechanic,spell,basicAttack,roles:roleByMechanic[mechanic],
  artUrl:`${POOL_ART}map-${serial}-${suffix}.webp`,atlasUrl:`${POOL_ART}map-${serial}-${suffix}_attack.webp`,
  behavior:`${rank==='elite'?'菁英魔物':'普通魔物'}施放「${spell}」；${roleByMechanic[mechanic].map(r=>({guard:'守護承傷',breach:'破陣破盾',aid:'支援恢復與解除異常',control:'壓制打斷蓄力'})[r]).join('、')}。`});
})));
export function mapPool(hourIndex,bosses){return [...POOL_MONSTERS.filter(e=>e.hourIndex===hourIndex),{...bosses[hourIndex],rank:'boss',hourIndex}];}
export function encounterSchedule(seed,hourIndex){
 const r=rngFor(`${seed}:encounters-v2:${hourIndex}:schedule`);
 return {eliteWave:3+Math.floor(r()*3),bossWave:9+Math.floor(r()*5),eliteBeat:30+Math.floor(r()*18),bossBeat:86+Math.floor(r()*19)};
}
// Selection has its own RNG stream; loading the page never consumes combat or
// loot randomness. The normal pair alternates, with a per-run/hour random first.
export function selectEncounter(state,hourIndex,wave,seen,localBeat,bosses,previousId=null){
 const pool=mapPool(hourIndex,bosses),schedule=encounterSchedule(state.seed,hourIndex),r=rngFor(`${state.seed}:encounters-v2:${hourIndex}:wave:${wave}`);
 if(!seen.boss&&(wave>=schedule.bossWave||localBeat>=schedule.bossBeat))return pool[3];
 if(!seen.elite&&(wave>=schedule.eliteWave||localBeat>=schedule.eliteBeat))return pool[2];
 if(wave>schedule.eliteWave&&r()<.13&&previousId!==pool[2].enemyId)return pool[2];
 const normals=pool.slice(0,2).filter(e=>e.enemyId!==previousId);
 return normals[Math.floor(r()*normals.length)];
}
