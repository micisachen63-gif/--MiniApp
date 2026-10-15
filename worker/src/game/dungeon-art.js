export const DUNGEON_ART={
  "forge": {
    "name": "熔金鍛造守衛",
    "accent": "#efab64",
    "background": "art/dungeons-20261011/forge-background.webp",
    "backgroundPng": "dungeons/forge-background.png",
    "boss": "art/dungeons-20261011/forge-boss.webp",
    "bossPng": "dungeons/forge-boss.png"
  },
  "river": {
    "name": "冥河渡魂者",
    "accent": "#80d5d4",
    "background": "art/dungeons-20261011/river-background.webp",
    "backgroundPng": "dungeons/river-background.png",
    "boss": "art/dungeons-20261011/river-boss.webp",
    "bossPng": "dungeons/river-boss.png"
  },
  "titan": {
    "name": "遠古泰坦",
    "accent": "#dfbf79",
    "background": "art/dungeons-20261011/titan-background.webp",
    "backgroundPng": "dungeons/titan-background.png",
    "boss": "art/dungeons-20261011/titan-boss.webp",
    "bossPng": "dungeons/titan-boss.png"
  },
  "oracle": {
    "name": "星盤神諭者",
    "accent": "#bba4f1",
    "background": "art/dungeons-20261011/oracle-background.webp",
    "backgroundPng": "dungeons/oracle-background.png",
    "boss": "art/dungeons-20261011/oracle-boss.webp",
    "bossPng": "dungeons/oracle-boss.png"
  },
  "stars": {
    "name": "星穹執政官",
    "accent": "#96c6f6",
    "background": "art/dungeons-20261011/stars-background.webp",
    "backgroundPng": "dungeons/stars-background.png",
    "boss": "art/dungeons-20261011/stars-boss.webp",
    "bossPng": "dungeons/stars-boss.png"
  },
  "trial3": {
    "name": "傳承金羽獅鷲",
    "accent": "#e6bb76",
    "background": "art/dungeons-20261011/trial3-background.webp",
    "backgroundPng": "dungeons/trial3-background.png",
    "boss": "art/dungeons-20261011/trial3-boss.webp",
    "bossPng": "dungeons/trial3-boss.png"
  },
  "trial4": {
    "name": "覺醒白金鳳凰",
    "accent": "#f1dfa9",
    "background": "art/dungeons-20261011/trial4-background.webp",
    "backgroundPng": "dungeons/trial4-background.png",
    "boss": "art/dungeons-20261011/trial4-boss.webp",
    "bossPng": "dungeons/trial4-boss.png"
  }
};
function baseDungeonTheme(p){const id=p.kind==='tower'?(p.floor>20?'stars':p.floor>10?'river':'pillar'):(p.dungeonId||p.id);return DUNGEON_ART[id]||{name:id==='aegean'?'海崖利維坦':'百柱巨像',accent:'#efbf88',background:'expedition/assets/existing/map'+String(p.map||2).padStart(2,'0')+'.webp',boss:'expedition/assets/existing/'+(id==='aegean'?'leviathan.webp':'boss.webp')};}

const TOWER_MOBS=[[["青銅迷宮公牛","bronze_bull"],["迷宮巡守","labyrinth_patrol"],["蛇髮幻影","gorgon_phantom"],["石化夜蝠","petrifying_bat"],["橄欖守衛","olive_guardian"],["裂地石魔","earthsplit_stone_demon"],["泰坦蹄獸","titan_hoof_beast"],["月桂樹精","laurel_treant"]],[["迷途遊魂","lost_soul"],["冥河骸骨兵","styx_bone_soldier"],["地獄犬幼獸","cerberus_pup"],["冥界渡鴉","underworld_raven"],["預言祭司幽魂","prophet_priest_ghost"],["虛空吞噬者","void_devourer"],["神諭巨蟒","oracle_python"],["愛琴海妖","aegean_siren"]],[["星界侍從","astral_attendant"],["天界巡游鳥","celestial_patrol_bird"],["雲海仙女","cloud_nymph"],["雲海飛馬","cloud_pegasus"],["日冕精靈","corona_spirit"],["阿波羅日鷹","apollo_sun_hawk"],["聖光石像","holy_light_statue"],["黃道星獸","zodiac_beast"]]];
export function dungeonTheme(p){const theme=baseDungeonTheme(p);if(p.kind!=="tower")return {...theme,rank:"boss"};const floor=Math.max(1,Math.min(30,Number(p.floor)||1));if(floor%5===0){const bosses={5:baseDungeonTheme({dungeonId:"pillar",map:2}),10:DUNGEON_ART.titan,15:DUNGEON_ART.river,20:DUNGEON_ART.oracle,25:DUNGEON_ART.stars,30:{...DUNGEON_ART.stars,name:"極樂守護王",boss:"art/monsters-clean-20261011/boss_elysium_guardian_king.png"}};return {...theme,...bosses[floor],rank:"boss"};}const zone=Math.floor((floor-1)/10),offset=(floor-1)%10,index=offset-(offset>4?1:0),[name,key]=TOWER_MOBS[zone][index];return {...theme,name,boss:"art/monsters-clean-20261011/mon_"+key+".png",rank:"normal"};}
