// Server-owned, versioned progression. Existing equipment without metadata is normal.
import {ENDGAME_ART} from './endgame-map-art.js';
export const ENDGAME_VERSION = 'endgame-v1';
export const CYCLE_LEVELS = 120;
export const ENDGAME_MAX_LEVEL = 600;
export const WORLD_MODES = Object.freeze([
  ['normal','普通',1],['elite','菁英',1.8],['expert','專家',3.2],['nightmare','惡夢',5.4],['hell','地獄',8.5],
].map(([id,name,power],index)=>Object.freeze({id,name,index,power,minLevel:index*120+1,maxLevel:(index+1)*120,baseEnhanceMultiplier:2**-index})));
export function modeForLevel(level){return WORLD_MODES[Math.max(0,Math.min(4,Math.floor((Math.max(1,Number(level)||1)-1)/120)))];}
export const localCycleLevel = level => (Math.max(1,Math.min(600,Math.floor(Number(level)||1)))-1)%120+1;
export function itemMode(item){
  let bonus;try{bonus=JSON.parse(item?.bonus_json||'{}');}catch{throw new Error('invalid_equipment_metadata');}
  const value=bonus?.endgameOrigin;
  if(value==null)return WORLD_MODES[0];
  const mode=WORLD_MODES.find(m=>m.id===value.mode);
  if(!mode||value.version!==ENDGAME_VERSION)throw new Error('invalid_equipment_mode');
  return mode;
}
/** Applied only when creating a NEW item. Never retunes existing assets. */
export function stampMode(item,modeId='normal'){
  const mode=WORLD_MODES.find(m=>m.id===modeId);if(!mode)throw new Error('invalid_equipment_mode');
  if(mode.index===0)return item;
  const bonus=JSON.parse(item.bonus_json||'{}');if(bonus.endgameOrigin)throw new Error('equipment_already_stamped');
  const next={...item,name:item.name+'-'+mode.name,level_req:item.level_req+mode.index*120};
  next.base_stat=Math.round(item.base_stat*mode.power);next.element_stat=Math.round(item.element_stat*mode.power);
  for(const key of ['hp','mp','atk','def'])if(Number.isFinite(bonus[key]))bonus[key]=Math.round(bonus[key]*mode.power);
  bonus.endgameOrigin={version:ENDGAME_VERSION,mode:mode.id};next.bonus_json=JSON.stringify(bonus);return next;
}
export function progressionView(level){const mode=modeForLevel(level);return {version:ENDGAME_VERSION,level,localLevel:localCycleLevel(level),maxLevel:600,mode:mode.id,modeName:mode.name,cycle:mode.index+1,cycleMaxLevel:mode.maxLevel,nextMode:WORLD_MODES[mode.index+1]?.id||null};}

/** 12 ten-level zones per cycle. Old seven Atlas maps remain byte-stable. */
export function cycleMaps(maps,loot){
  return WORLD_MODES.flatMap(mode=>Array.from({length:12},(_,i)=>{
    const chapter=i+1,themeId=(i+mode.index*5)%12+1,theme=maps[themeId],minLevel=mode.index*120+i*10+1;
    const level=i*10+5,scale=mode.power;
    const hp=Math.round((150+level*level*1.7)*scale),atk=Math.round((12+level*3.4)*scale);
    const boss=chapter%5===0||chapter===12;
    const id=`cycle_${mode.id}_${String(chapter).padStart(2,'0')}`;
    const art=ENDGAME_ART[id],enemyRoster=art.roster.filter(x=>x.role==='normal'),eliteArt=art.roster.find(x=>x.role===(boss?'boss':'elite'));
    return {id,name:(art.name||theme.name)+'-'+mode.name,themeId,themeName:theme.name,emoji:theme.emoji,kind:boss?'boss':'survey',
      minLevel,available:true,prerequisites:mode.index>0?[`cycle_${WORLD_MODES[mode.index-1].id}_12`]:[],
      progression:{version:ENDGAME_VERSION,mode:mode.id,modeName:mode.name,chapter,levelMin:minLevel,levelMax:minLevel+9},
      enemyName:enemyRoster[0].name+'-'+mode.name,eliteName:eliteArt.name+'-'+mode.name,
      art:{background:art.background,aura:art.aura||null},enemyRoster:enemyRoster.map(x=>({...x,name:x.name+'-'+mode.name})),eliteArt:{...eliteArt,name:eliteArt.name+'-'+mode.name},
      roomCount:boss?1:6,packRooms:boss?0:5,travelSeconds:6,entrySeconds:12,
      enemy:{count:4,hp,atk,def:Math.round((5+level*.25)*scale),attackInterval:4},
      elite:{count:1,hp:hp*(boss?10:5),atk:Math.round(atk*1.7),def:Math.round((8+level*.3)*scale),attackInterval:5},
      rewards:{roomGold:Math.round((20+level*2)* (1+mode.index*.3)),roomExp:Math.round((20+minLevel**1.3)*3),completionGold:Math.round((50+level*5)*(1+mode.index*.3)),completionExp:Math.round((60+minLevel**1.3)*8),material:boss?'atlas_core':['atlas_iron','atlas_ember','atlas_venom'][i%3]},
      dropTier:chapter,loot:loot(),encounters:{chance:0,maxPerMap:0,pool:[]},
      hints:[`第${mode.index+1}輪，Lv.${minLevel}–${minLevel+9}；${boss?'首領考驗':'普通怪群與菁英守衛'}。`,'新裝備保存來源模式；既有裝備與強化值保持。'],
    };
  }));
}
