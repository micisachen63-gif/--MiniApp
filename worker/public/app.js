// 小精靈 RPG 掛機冒險 — Telegram Mini App front-end (vanilla JS, no build step).
// Auth: every API call carries Telegram.WebApp.initData (verified server-side with 小精靈's bot token).
// Local dev only: ?devTg=<id> sends X-Dev-Tg-Id, which the Worker accepts ONLY when ENVIRONMENT=development + ALLOW_DEV_AUTH=true.
(() => {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp;
  const qs = new URLSearchParams(location.search);
  const initData = (tg && tg.initData) || '';
  const devTg = !initData ? qs.get('devTg') : null;
  const A = window.RpgArt;
  // ---- art direction: v2 painted Byzantine set (default) · ?art=v1 the SVG samples · ?art=svg pure procedural canvas art (art.js)
  const ARTQ = qs.get('art'); const MODE = ARTQ === 'v1' || ARTQ === 'svg' ? ARTQ : 'v2'; const V2 = MODE === 'v2';
  const ART = MODE !== 'svg';
  const MON = { 蛇髮女妖: 'mon_gorgon', 史萊姆: 'mon_slime_novice', 野狼: 'mon_wolf', 哈耳庇厄: 'mon_harpy', 哥布林: 'mon_goblin', 骷髏兵: 'mon_skeleton', 毒蜘蛛: 'mon_spider', 樹妖: 'mon_treant', 哥布林突擊隊長: 'elite_goblin_captain', 劇毒巨蛛: 'elite_giant_spider', 月光野兔: 'mon_moon_hare', 月桂樹精: 'mon_laurel_treant', 林地花仙: 'mon_wood_nymph', 林精斥候: 'mon_forest_scout', 阿耳忒彌斯巡林長: 'elite_artemis_ranger', 月桂巨樹精: 'boss_ancient_laurel', 百柱石像: 'mon_temple_statue', 智慧夜梟: 'mon_temple_owl', 青銅衛兵: 'mon_bronze_guard', 神殿侍從鬼魂: 'mon_temple_ghost', 神殿禁衛百夫長: 'elite_temple_centurion', 潘神幼獸: 'mon_pan_cub', 山林仙女: 'mon_arcadia_nymph', 聖角羚羊: 'mon_sacred_antelope', 古木守衛: 'mon_olive_guardian', 狂暴潘神衛士: 'elite_pan_warden' };
  const MON_ANIM = { 蛇髮女妖: 'mon_gorgon_attack', 史萊姆: 'mon_slime_attack', 月光野兔: 'mon_moon_hare_attack', 月桂樹精: 'mon_laurel_treant_attack', 林地花仙: 'mon_wood_nymph_attack', 林精斥候: 'mon_forest_scout_attack', 阿耳忒彌斯巡林長: 'elite_artemis_ranger_attack', 月桂巨樹精: 'boss_ancient_laurel_attack', 百柱石像: 'mon_temple_statue_attack', 智慧夜梟: 'mon_temple_owl_attack', 青銅衛兵: 'mon_bronze_guard_attack', 神殿侍從鬼魂: 'mon_temple_ghost_attack', 潘神幼獸: 'mon_pan_cub_attack', 山林仙女: 'mon_arcadia_nymph_attack', 聖角羚羊: 'mon_sacred_antelope_attack', 古木守衛: 'mon_olive_guardian_attack' };
  const ELITE_ANIM = { 阿耳忒彌斯巡林長: 'elite_artemis_ranger_attack', 神殿禁衛百夫長: 'elite_temple_centurion_attack', 狂暴潘神衛士: 'elite_pan_warden_attack' };
  const BOSS_ANIM = { 1: 'boss_ancient_laurel_attack', 2: 'boss_hundred_pillar_colossus_attack', 3: 'boss_arcadia_goblin_chief_attack' };
  const expansion = window.RpgMonsterExpansion;
  const monsterCatalog = [...(window.RpgMonsterCatalog || []), ...(expansion?.ready || [])];
  const cleanMonsterKeys = new Set(monsterCatalog.map(m=>m.key));
  for (const m of monsterCatalog) {
    MON[m.name]=MON[m.key]=m.key; MON_ANIM[m.name]=MON_ANIM[m.key]=m.key+'_attack';
    if (m.role==='elite') ELITE_ANIM[m.name]=ELITE_ANIM[m.key]=m.key+'_attack';
    if (m.role==='boss') { BOSS_ANIM[m.name]=BOSS_ANIM[m.key]=m.key+'_attack'; if(!m.folder) BOSS_ANIM[m.map]=m.key+'_attack'; }
  }
  Object.assign(MON, { '海崖塞壬': 'mon_aegean_siren', '潮汐甲蟲': 'mon_tidal_beetle', '波濤飛魚': 'mon_wave_fish', '海潮巨蟹': 'mon_sea_crab', '深海狂暴巨蟹': 'elite_deepsea_crab', '海崖利維坦': 'boss_aegean_leviathan' });
  Object.assign(MON_ANIM, { '海崖塞壬': 'mon_aegean_siren_attack', '潮汐甲蟲': 'mon_tidal_beetle_attack', '波濤飛魚': 'mon_wave_fish_attack', '海潮巨蟹': 'mon_sea_crab_attack', '海崖利維坦': 'boss_aegean_leviathan_attack' });
  Object.assign(ELITE_ANIM, { '深海狂暴巨蟹': 'elite_deepsea_crab_attack' });
  Object.assign(BOSS_ANIM, { 4: 'boss_aegean_leviathan_attack' });
  // Attack sheets are keyed by exact class path where generated; unmatched advancement routes retain procedural motion.
  const HERO_ANIM = {
    archer_f: { file: 'hero_archer_f_attack', cols: 5, rows: 2, firstFrame: 0 },
    archer_m: { file: 'hero_archer_m_attack', cols: 5, rows: 2, firstFrame: 0 },
    mage_f: { file: 'hero_mage_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    mage_m: { file: 'hero_mage_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv1_mage_A_f: { file: 'hero_adv1_mage_A_f_attack', cols: 4, rows: 3, firstFrame: 0 },
    adv1_mage_A_m: { file: 'hero_adv1_mage_A_m_attack', cols: 4, rows: 3, firstFrame: 0 },
    adv1_mage_B_f: { file: 'hero_adv1_mage_B_f_attack', cols: 4, rows: 3, firstFrame: 0 },
    adv1_mage_B_m: { file: 'hero_adv1_mage_B_m_attack', cols: 4, rows: 3, firstFrame: 0 },
    adv2_mage_A1_f: { file: 'hero_adv2_mage_A1_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_mage_A1_m: { file: 'hero_adv2_mage_A1_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_mage_A2_f: { file: 'hero_adv2_mage_A2_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_mage_A2_m: { file: 'hero_adv2_mage_A2_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_mage_B1_f: { file: 'hero_adv2_mage_B1_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_mage_B1_m: { file: 'hero_adv2_mage_B1_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_mage_B2_f: { file: 'hero_adv2_mage_B2_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_mage_B2_m: { file: 'hero_adv2_mage_B2_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A11_f: { file: 'hero_adv3_mage_A11_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A11_m: { file: 'hero_adv3_mage_A11_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A12_f: { file: 'hero_adv3_mage_A12_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A12_m: { file: 'hero_adv3_mage_A12_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A21_f: { file: 'hero_adv3_mage_A21_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A21_m: { file: 'hero_adv3_mage_A21_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A22_f: { file: 'hero_adv3_mage_A22_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_A22_m: { file: 'hero_adv3_mage_A22_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B11_f: { file: 'hero_adv3_mage_B11_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B11_m: { file: 'hero_adv3_mage_B11_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B12_f: { file: 'hero_adv3_mage_B12_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B12_m: { file: 'hero_adv3_mage_B12_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B21_f: { file: 'hero_adv3_mage_B21_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B21_m: { file: 'hero_adv3_mage_B21_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B22_f: { file: 'hero_adv3_mage_B22_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_mage_B22_m: { file: 'hero_adv3_mage_B22_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A111_f: { file: 'hero_adv4_mage_A111_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A111_m: { file: 'hero_adv4_mage_A111_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A112_f: { file: 'hero_adv4_mage_A112_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A112_m: { file: 'hero_adv4_mage_A112_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A121_f: { file: 'hero_adv4_mage_A121_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A121_m: { file: 'hero_adv4_mage_A121_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A122_f: { file: 'hero_adv4_mage_A122_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A122_m: { file: 'hero_adv4_mage_A122_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A211_f: { file: 'hero_adv4_mage_A211_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A211_m: { file: 'hero_adv4_mage_A211_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A212_f: { file: 'hero_adv4_mage_A212_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A212_m: { file: 'hero_adv4_mage_A212_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A221_f: { file: 'hero_adv4_mage_A221_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A221_m: { file: 'hero_adv4_mage_A221_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A222_f: { file: 'hero_adv4_mage_A222_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_A222_m: { file: 'hero_adv4_mage_A222_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B111_f: { file: 'hero_adv4_mage_B111_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B111_m: { file: 'hero_adv4_mage_B111_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B112_f: { file: 'hero_adv4_mage_B112_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B112_m: { file: 'hero_adv4_mage_B112_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B121_f: { file: 'hero_adv4_mage_B121_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B121_m: { file: 'hero_adv4_mage_B121_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B122_f: { file: 'hero_adv4_mage_B122_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B122_m: { file: 'hero_adv4_mage_B122_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B211_f: { file: 'hero_adv4_mage_B211_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B211_m: { file: 'hero_adv4_mage_B211_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B212_f: { file: 'hero_adv4_mage_B212_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B212_m: { file: 'hero_adv4_mage_B212_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B221_f: { file: 'hero_adv4_mage_B221_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B221_m: { file: 'hero_adv4_mage_B221_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B222_f: { file: 'hero_adv4_mage_B222_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv4_mage_B222_m: { file: 'hero_adv4_mage_B222_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv3_archer_A11_f: { file: 'hero_adv3_archer_A11_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_A11_m: { file: 'hero_adv3_archer_A11_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_A12_f: { file: 'hero_adv3_archer_A12_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_A12_m: { file: 'hero_adv3_archer_A12_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_A21_f: { file: 'hero_adv3_archer_A21_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_A21_m: { file: 'hero_adv3_archer_A21_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_A22_f: { file: 'hero_adv3_archer_A22_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_A22_m: { file: 'hero_adv3_archer_A22_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B11_f: { file: 'hero_adv3_archer_B11_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B11_m: { file: 'hero_adv3_archer_B11_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B12_f: { file: 'hero_adv3_archer_B12_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B12_m: { file: 'hero_adv3_archer_B12_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B21_f: { file: 'hero_adv3_archer_B21_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B21_m: { file: 'hero_adv3_archer_B21_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B22_f: { file: 'hero_adv3_archer_B22_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv3_archer_B22_m: { file: 'hero_adv3_archer_B22_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A111_f: { file: 'hero_adv4_archer_A111_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A111_m: { file: 'hero_adv4_archer_A111_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A112_f: { file: 'hero_adv4_archer_A112_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A112_m: { file: 'hero_adv4_archer_A112_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A121_f: { file: 'hero_adv4_archer_A121_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A121_m: { file: 'hero_adv4_archer_A121_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A122_f: { file: 'hero_adv4_archer_A122_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A122_m: { file: 'hero_adv4_archer_A122_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A211_f: { file: 'hero_adv4_archer_A211_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A211_m: { file: 'hero_adv4_archer_A211_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A212_f: { file: 'hero_adv4_archer_A212_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A212_m: { file: 'hero_adv4_archer_A212_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A221_f: { file: 'hero_adv4_archer_A221_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A221_m: { file: 'hero_adv4_archer_A221_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A222_f: { file: 'hero_adv4_archer_A222_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_A222_m: { file: 'hero_adv4_archer_A222_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B111_f: { file: 'hero_adv4_archer_B111_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B111_m: { file: 'hero_adv4_archer_B111_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B112_f: { file: 'hero_adv4_archer_B112_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B112_m: { file: 'hero_adv4_archer_B112_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B121_f: { file: 'hero_adv4_archer_B121_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B121_m: { file: 'hero_adv4_archer_B121_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B122_f: { file: 'hero_adv4_archer_B122_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B122_m: { file: 'hero_adv4_archer_B122_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B211_f: { file: 'hero_adv4_archer_B211_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B211_m: { file: 'hero_adv4_archer_B211_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B212_f: { file: 'hero_adv4_archer_B212_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B212_m: { file: 'hero_adv4_archer_B212_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B221_f: { file: 'hero_adv4_archer_B221_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B221_m: { file: 'hero_adv4_archer_B221_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B222_f: { file: 'hero_adv4_archer_B222_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv4_archer_B222_m: { file: 'hero_adv4_archer_B222_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    archer_f: { file: 'hero_archer_f_attack', cols: 5, rows: 2, firstFrame: 0 },
    adv1_archer_A_f: { file: 'hero_adv1_archer_A_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv1_archer_B_f: { file: 'hero_adv1_archer_B_f_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_archer_A1_f: { file: 'hero_adv2_archer_A1_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv2_archer_A2_f: { file: 'hero_adv2_archer_A2_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv2_archer_B1_f: { file: 'hero_adv2_archer_B1_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv2_archer_B2_f: { file: 'hero_adv2_archer_B2_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    archer_m: { file: 'hero_archer_m_attack', cols: 5, rows: 2, firstFrame: 0 },
    adv1_archer_A_m: { file: 'hero_adv1_archer_A_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv1_archer_B_m: { file: 'hero_adv1_archer_B_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv2_archer_A1_m: { file: 'hero_adv2_archer_A1_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv2_archer_A2_m: { file: 'hero_adv2_archer_A2_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv2_archer_B1_m: { file: 'hero_adv2_archer_B1_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv2_archer_B2_m: { file: 'hero_adv2_archer_B2_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv1_sword_A_f: { file: 'hero_adv1_sword_A_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv1_sword_A_m: { file: 'hero_adv1_sword_A_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv1_sword_B_f: { file: 'hero_adv1_sword_B_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv1_sword_B_m: { file: 'hero_adv1_sword_B_m_attack', cols: 4, rows: 2, firstFrame: 0 },
    adv2_sword_A1_f: { file: 'hero_adv2_sword_A1_f_attack', cols: 4, rows: 2, firstFrame: 2 },
    adv1_archer_A_m: { file: 'hero_adv1_archer_A_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    adv1_archer_B_m: { file: 'hero_adv1_archer_B_m_attack', cols: 5, rows: 2, firstFrame: 1 },
    sword_f: { file: 'hero_sword_f_attack', cols: 4, rows: 2, firstFrame: 0 },
    archer_f: { file: 'hero_archer_f_attack', cols: 5, rows: 2, firstFrame: 0 },
    archer_m: { file: 'hero_archer_m_attack', cols: 5, rows: 2, firstFrame: 0 },
    sword_m: { file: 'hero_sword_m_attack', cols: 4, rows: 2, firstFrame: 0 },
  };
  const SWORD_ADV2_HD={"adv2_sword_A1_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.5088495575221237,"fig":[0.10416666666666667,0.3580729166666667,0.66015625,0.9361979166666666]},"adv2_sword_A1_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.3583061889250814,"fig":[0.13020833333333334,0.29296875,0.7565104166666666,0.9361979166666666]},"adv2_sword_A2_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.4066666666666667,"fig":[0.1328125,0.3151041666666667,0.55859375,0.9361979166666666]},"adv2_sword_A2_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.337037037037037,"fig":[0.20833333333333334,0.2825520833333333,0.7057291666666666,0.9361979166666666]},"adv2_sword_B1_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.1477272727272725,"fig":[0.14973958333333334,0.17447916666666666,0.77734375,0.9361979166666666]},"adv2_sword_B1_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.3954248366013073,"fig":[0.11979166666666667,0.3098958333333333,0.62109375,0.9361979166666666]},"adv2_sword_B2_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2244224422442243,"fig":[0.1328125,0.22265625,0.6901041666666666,0.9361979166666666]},"adv2_sword_B2_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.1286173633440513,"fig":[0.19661458333333334,0.16276041666666666,0.79296875,0.9361979166666666]}};
  for(const [key,spec]of Object.entries(SWORD_ADV2_HD))HERO_ANIM[key]={...spec,file:'hero_'+key+'_attack'};
  const SWORD_ADV3_HD={"adv3_sword_A11_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2499999999999998,"fig":[0.07291666666666667,0.23697916666666666,0.75390625,0.9361979166666666]},"adv3_sword_A11_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2344322344322343,"fig":[0.12760416666666666,0.22916666666666666,0.8502604166666666,0.9361979166666666]},"adv3_sword_A12_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2277580071174377,"fig":[0.1640625,0.22526041666666666,0.78125,0.9361979166666666]},"adv3_sword_A12_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2333333333333332,"fig":[0.11197916666666667,0.22786458333333334,0.7708333333333334,0.9361979166666666]},"adv3_sword_A21_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2439024390243902,"fig":[0.11197916666666667,0.234375,0.6028645833333334,0.9361979166666666]},"adv3_sword_A21_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2013201320132012,"fig":[0.1328125,0.20963541666666666,0.734375,0.9361979166666666]},"adv3_sword_A22_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2572463768115942,"fig":[0.15364583333333334,0.24088541666666666,0.7278645833333334,0.9361979166666666]},"adv3_sword_A22_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2264150943396226,"fig":[0.14583333333333334,0.22395833333333334,0.7447916666666666,0.9361979166666666]},"adv3_sword_B11_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.468013468013468,"fig":[0.09635416666666667,0.3411458333333333,0.5885416666666666,0.9361979166666666]},"adv3_sword_B11_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.1163636363636364,"fig":[0.08333333333333333,0.15364583333333334,0.7369791666666666,0.9361979166666666]},"adv3_sword_B12_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.3712374581939801,"fig":[0.20182291666666666,0.2994791666666667,0.7278645833333334,0.9361979166666666]},"adv3_sword_B12_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.2457912457912457,"fig":[0.14322916666666666,0.23567708333333334,0.6484375,0.9361979166666666]},"adv3_sword_B21_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.1839464882943143,"fig":[0.19661458333333334,0.19791666666666666,0.71484375,0.9361979166666666]},"adv3_sword_B21_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.1013986013986015,"fig":[0.13802083333333334,0.14322916666666666,0.7760416666666666,0.9361979166666666]},"adv3_sword_B22_f":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.1726384364820845,"fig":[0.19921875,0.19140625,0.75,0.9361979166666666]},"adv3_sword_B22_m":{"cols":4,"rows":4,"firstFrame":0,"heightScale":1.1903114186851211,"fig":[0.17708333333333334,0.20182291666666666,0.7526041666666666,0.9361979166666666]}};
  for(const[key,spec]of Object.entries(SWORD_ADV3_HD))HERO_ANIM[key]={...spec,file:"hero_"+key+"_attack"};
  const MAGE_ADV2_HD={"adv2_mage_A1_f":{"name":"大魔導士・女","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.166015625,0.087890625,0.76953125,0.931640625]},"adv2_mage_A1_m":{"name":"大魔導士・男","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.1796875,0.09375,0.8125,0.9296875]},"adv2_mage_A2_f":{"name":"冰霜術士・女","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.15234375,0.095703125,0.80078125,0.931640625]},"adv2_mage_A2_m":{"name":"冰霜術士・男","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.169921875,0.091796875,0.83203125,0.931640625]},"adv2_mage_B1_f":{"name":"時空術士・女","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.203125,0.19140625,0.810546875,0.93359375]},"adv2_mage_B1_m":{"name":"時空術士・男","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.1484375,0.19140625,0.787109375,0.931640625]},"adv2_mage_B2_f":{"name":"召喚師・女","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.208984375,0.193359375,0.83203125,0.931640625]},"adv2_mage_B2_m":{"name":"召喚師・男","cols":4,"rows":3,"firstFrame":0,"heightScale":1,"useAsIdle":true,"fig":[0.01,0.193359375,0.99,0.935546875],"bodyHeight":0.7421875,"feet":0.935546875,"assetBounds":[0.1875,0.19140625,0.78125,0.931640625]}};
  for(const[key,spec]of Object.entries(MAGE_ADV2_HD))HERO_ANIM[key]={...spec,file:"hero_"+key+"_attack"};
  const ELF_ADV2_HD={"adv2_archer_A1_f":{"name":"逐風神射・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.78125,"feet":0.9375,"fig":[0.01,0.15625,0.99,0.9375]},"adv2_archer_A1_m":{"name":"逐風神射・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.833984375,"feet":0.9375,"fig":[0.01,0.103515625,0.99,0.9375]},"adv2_archer_A2_f":{"name":"蒼穹風舞・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.83203125,"feet":0.9375,"fig":[0.01,0.10546875,0.99,0.9375]},"adv2_archer_A2_m":{"name":"蒼穹風舞・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.822265625,"feet":0.9375,"fig":[0.01,0.115234375,0.99,0.9375]},"adv2_archer_B1_f":{"name":"森靈馭獸・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.85546875,"feet":0.9375,"fig":[0.01,0.08203125,0.99,0.9375]},"adv2_archer_B1_m":{"name":"森靈馭獸・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.826171875,"feet":0.9375,"fig":[0.01,0.111328125,0.99,0.9375]},"adv2_archer_B2_f":{"name":"月影獵使・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.84375,"feet":0.9375,"fig":[0.01,0.09375,0.99,0.9375]},"adv2_archer_B2_m":{"name":"月影獵使・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.5,"preservePlacement":true,"useAsIdle":true,"bodyHeight":0.84765625,"feet":0.9375,"fig":[0.01,0.08984375,0.99,0.9375]}};
  for(const[key,spec]of Object.entries(ELF_ADV2_HD))HERO_ANIM[key]={...spec,file:"hero_"+key+"_attack"};
  const ELF_ADV3_HD={"adv3_archer_A11_f":{"name":"星風聖射・女","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.23082386363636365,0.027777777777777776,0.7521306818181818,0.8611111111111112],"frameBounds":[0.13783482142857142,0.27064732142857145,0.8470982142857143,0.9118303571428571]},"adv3_archer_A11_m":{"name":"星風聖射・男","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.526405451448041,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.817717206132879,"feet":0.8637137989778535,"portraitCrop":{"left":192,"top":618,"width":1408,"height":1174},"fig":[0.10724431818181818,0.04599659284497445,0.8096590909090909,0.8637137989778535],"frameBounds":[0.19140625,0.20647321428571427,0.7611607142857143,0.9118303571428571]},"adv3_archer_A12_f":{"name":"蒼穹裁決者・女","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.15553977272727273,0.027777777777777776,0.8508522727272727,0.8611111111111112],"frameBounds":[0.21261160714285715,0.21205357142857142,0.7756696428571429,0.9118303571428571]},"adv3_archer_A12_m":{"name":"蒼穹裁決者・男","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.12642045454545456,0.027777777777777776,0.8061079545454546,0.8619791666666666],"frameBounds":[0.20647321428571427,0.234375,0.7712053571428571,0.9118303571428571]},"adv3_archer_A21_f":{"name":"暴風先知・女","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.52901023890785,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8191126279863481,"feet":0.863481228668942,"portraitCrop":{"left":192,"top":620,"width":1408,"height":1172},"fig":[0.20383522727272727,0.04607508532423208,0.8210227272727273,0.8626279863481229],"frameBounds":[0.26729910714285715,0.27566964285714285,0.7606026785714286,0.9118303571428571]},"adv3_archer_A21_m":{"name":"暴風先知・男","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8168402777777778,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.13920454545454544,0.044270833333333336,0.7840909090909091,0.8611111111111112],"frameBounds":[0.21651785714285715,0.24776785714285715,0.7416294642857143,0.9118303571428571]},"adv3_archer_A22_f":{"name":"天羽御風者・女","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.19318181818181818,0.026909722222222224,0.7897727272727273,0.8602430555555556],"frameBounds":[0.24330357142857142,0.24386160714285715,0.7628348214285714,0.9118303571428571]},"adv3_archer_A22_m":{"name":"天羽御風者・男","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.16761363636363635,0.027777777777777776,0.7734375,0.8611111111111112],"frameBounds":[0.20256696428571427,0.21651785714285715,0.8002232142857143,0.9118303571428571]},"adv3_archer_B11_m":{"name":"萬獸祭司・男","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5212224108658743,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8149405772495756,"feet":0.8641765704584041,"portraitCrop":{"left":192,"top":614,"width":1408,"height":1178},"fig":[0.125,0.04499151103565365,0.8245738636363636,0.8641765704584041],"frameBounds":[0.20535714285714285,0.2728794642857143,0.7550223214285714,0.9118303571428571]},"adv3_archer_B12_f":{"name":"古森召靈師・女","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.536878216123499,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.823327615780446,"feet":0.8627787307032591,"portraitCrop":{"left":192,"top":626,"width":1408,"height":1166},"fig":[0.2002840909090909,0.03945111492281304,0.7933238636363636,0.8627787307032591],"frameBounds":[0.24944196428571427,0.27120535714285715,0.7421875,0.9118303571428571]},"adv3_archer_B12_m":{"name":"古森召靈師・男","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.1640625,0.027777777777777776,0.7762784090909091,0.8611111111111112],"frameBounds":[0.23493303571428573,0.25223214285714285,0.7661830357142857,0.9118303571428571]},"adv3_archer_B21_f":{"name":"皎月巡狩・女","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.11363636363636363,0.027777777777777776,0.7272727272727273,0.8611111111111112],"frameBounds":[0.19642857142857142,0.36104910714285715,0.7165178571428571,0.9291294642857143]},"adv3_archer_B21_m":{"name":"皎月巡狩・男","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.5555555555555556,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8333333333333334,"feet":0.8611111111111112,"portraitCrop":{"left":192,"top":640,"width":1408,"height":1152},"fig":[0.14133522727272727,0.027777777777777776,0.8458806818181818,0.8611111111111112],"frameBounds":[0.21819196428571427,0.34375,0.7840401785714286,0.91796875]},"adv3_archer_B22_f":{"name":"荊棘影衛・女","cols":4,"rows":2,"cell":1792,"firstFrame":0,"heightScale":1.554206418039896,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8326105810928014,"feet":0.8612315698178664,"portraitCrop":{"left":192,"top":639,"width":1408,"height":1153},"fig":[0.1640625,0.028620988725065046,0.8352272727272727,0.8603642671292281],"frameBounds":[0.23604910714285715,0.36941964285714285,0.7823660714285714,0.9118303571428571]},"adv3_archer_B11_f":{"name":"萬獸祭司・女","cols":4,"rows":2,"cell":2048,"firstFrame":0,"heightScale":1.9086672879776327,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.7315936626281454,"feet":0.7688723205964585,"portraitCrop":{"left":320,"top":975,"width":1408,"height":1073},"fig":[0.21946022727272727,0.06057781919850885,0.7805397727272727,0.7698042870456664],"frameBounds":[0.30712890625,0.44091796875,0.697265625,0.8798828125]},"adv3_archer_B22_m":{"name":"荊棘影衛・男","cols":4,"rows":2,"cell":2048,"firstFrame":0,"heightScale":1.8253119429590017,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.750445632798574,"feet":0.7789661319073083,"portraitCrop":{"left":320,"top":926,"width":1408,"height":1122},"fig":[0.24786931818181818,0.029411764705882353,0.8288352272727273,0.7798573975044564],"frameBounds":[0.32177734375,0.4462890625,0.72607421875,0.8798828125]}};
  for(const[key,spec]of Object.entries(ELF_ADV3_HD))HERO_ANIM[key]={...spec,file:"hero_"+key+"_attack"};
  const ELF_ADV4_HD={"adv4_archer_A111_f":{"name":"永恆風冠・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.103125,0.045112781954887216,0.7703125,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.103125,0.4041666666666667,0.8265625,0.95625]},"adv4_archer_A111_m":{"name":"永恆風冠・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1921875,0.045112781954887216,0.75,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.16875,0.40729166666666666,0.83125,0.9572916666666667]},"adv4_archer_A112_f":{"name":"群星神弓・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.153125,0.045112781954887216,0.7328125,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1515625,0.3885416666666667,0.83125,0.9614583333333333]},"adv4_archer_A112_m":{"name":"群星神弓・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2171875,0.045112781954887216,0.76875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.165625,0.4010416666666667,0.8984375,0.9697916666666667]},"adv4_archer_A121_f":{"name":"蒼穹神判・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2734375,0.045112781954887216,0.78,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1984375,0.421875,0.875,0.9520833333333333]},"adv4_archer_A121_m":{"name":"蒼穹神判・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.25625,0.045112781954887216,0.78,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.21875,0.42604166666666665,0.878125,0.9625]},"adv4_archer_A122_f":{"name":"聖光獵星・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.159375,0.045112781954887216,0.7359375,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.14375,0.43125,0.84375,0.9739583333333334]},"adv4_archer_A122_m":{"name":"聖光獵星・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.26875,0.045112781954887216,0.78,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.2140625,0.39375,0.903125,0.95625]},"adv4_archer_A211_f":{"name":"太初風皇・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2140625,0.045112781954887216,0.7546875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.171875,0.4114583333333333,0.8234375,0.9583333333333334]},"adv4_archer_A211_m":{"name":"太初風皇・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1828125,0.045112781954887216,0.740625,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1828125,0.4010416666666667,0.9625,0.953125]},"adv4_archer_A212_f":{"name":"九霄御風・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1859375,0.045112781954887216,0.740625,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1859375,0.40729166666666666,0.828125,0.95]},"adv4_archer_A212_m":{"name":"九霄御風・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2109375,0.045112781954887216,0.7796875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1703125,0.3802083333333333,0.8359375,0.9541666666666667]},"adv4_archer_A221_f":{"name":"天羽聖主・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2109375,0.045112781954887216,0.746875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1203125,0.396875,0.8015625,0.9510416666666667]},"adv4_archer_A221_m":{"name":"天羽聖主・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.184375,0.045112781954887216,0.7296875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1828125,0.4083333333333333,0.8171875,0.9625]},"adv4_archer_A222_f":{"name":"嵐靈神使・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.215625,0.045112781954887216,0.753125,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.2078125,0.409375,0.859375,0.953125]},"adv4_archer_A222_m":{"name":"嵐靈神使・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1578125,0.045112781954887216,0.70625,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1484375,0.3927083333333333,0.825,0.959375]},"adv4_archer_B111_f":{"name":"太古森皇・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.184375,0.045112781954887216,0.7125,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1828125,0.43333333333333335,0.809375,0.9541666666666667]},"adv4_archer_B111_m":{"name":"太古森皇・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1984375,0.045112781954887216,0.7265625,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1890625,0.42291666666666666,0.8390625,0.95625]},"adv4_archer_B112_f":{"name":"萬獸神尊・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.246875,0.045112781954887216,0.7734375,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.240625,0.465625,0.7953125,0.9458333333333333]},"adv4_archer_B112_m":{"name":"萬獸神尊・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2296875,0.045112781954887216,0.7484375,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.190625,0.4479166666666667,0.79375,0.9489583333333333]},"adv4_archer_B121_f":{"name":"世界樹祭主・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.23125,0.045112781954887216,0.765625,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.2265625,0.43854166666666666,0.8765625,0.94375]},"adv4_archer_B121_m":{"name":"世界樹祭主・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2,0.045112781954887216,0.734375,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.196875,0.421875,0.8796875,0.9604166666666667]},"adv4_archer_B122_f":{"name":"精靈祖靈・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.20625,0.045112781954887216,0.746875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1953125,0.41458333333333336,0.8359375,0.953125]},"adv4_archer_B122_m":{"name":"精靈祖靈・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1921875,0.045112781954887216,0.74375,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1921875,0.44375,0.8109375,0.9541666666666667]},"adv4_archer_B211_f":{"name":"永夜月神・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1859375,0.045112781954887216,0.7328125,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.18125,0.42916666666666664,0.803125,0.9541666666666667]},"adv4_archer_B211_m":{"name":"永夜月神・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1765625,0.045112781954887216,0.7296875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1734375,0.390625,0.8203125,0.9489583333333333]},"adv4_archer_B212_f":{"name":"銀月聖獵・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1375,0.045112781954887216,0.6890625,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1375,0.4239583333333333,0.7546875,0.9541666666666667]},"adv4_archer_B212_m":{"name":"銀月聖獵・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.215625,0.045112781954887216,0.753125,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.2125,0.40520833333333334,0.83125,0.946875]},"adv4_archer_B221_f":{"name":"荊棘聖王・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.1765625,0.045112781954887216,0.7171875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.175,0.40208333333333335,0.8078125,0.9552083333333333]},"adv4_archer_B221_m":{"name":"荊棘聖王・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2046875,0.045112781954887216,0.7421875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1890625,0.4375,0.8140625,0.9583333333333334]},"adv4_archer_B222_f":{"name":"幽林守護・女","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.2046875,0.045112781954887216,0.746875,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.1828125,0.41875,0.8203125,0.95625]},"adv4_archer_B222_m":{"name":"幽林守護・男","cols":4,"rows":2,"firstFrame":0,"heightScale":1.8045112781954886,"preservePlacement":true,"useAsIdle":true,"authoredEffects":true,"bodyHeight":0.8421052631578947,"feet":0.8872180451127819,"fig":[0.19375,0.045112781954887216,0.73125,0.8872180451127819],"portraitCrop":{"left":0,"top":428,"width":640,"height":532},"frameBounds":[0.178125,0.4197916666666667,0.896875,0.9458333333333333]}};
  for(const[key,spec]of Object.entries(ELF_ADV4_HD))HERO_ANIM[key]={...spec,file:"hero_"+key+"_attack"};

  const SWORD_ADV4_HD={"adv4_sword_A111_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.6217008797653958,"fig":[0.023391812865497075,0.02346041055718475,0.9766081871345029,0.9765395894428153],"frameFig":[0.11256117455138662,0.19710669077757687,0.6443719412724307,0.7848101265822784],"frameBounds":[0.11256117455138662,0.045207956600361664,0.9494290375203915,0.786618444846293],"portraitCrop":{"left":61,"top":101,"width":342,"height":341},"nativePortraitPlacement":true},"adv4_sword_A111_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.804093567251462,"fig":[0.022099447513812154,0.023391812865497075,0.9779005524861878,0.9766081871345029],"frameFig":[0.19117647058823528,0.20745542949756887,0.7,0.7358184764991896],"frameBounds":[0.03529411764705882,0.050243111831442464,0.9558823529411765,0.7374392220421394],"portraitCrop":{"left":122,"top":120,"width":362,"height":342},"nativePortraitPlacement":true},"adv4_sword_A112_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.659400544959128,"fig":[0.01932367149758454,0.021798365122615803,0.9806763285024155,0.9782016348773842],"frameFig":[0.14088820826952528,0.2315270935960591,0.7503828483920367,0.8078817733990148],"frameBounds":[0.13169984686064318,0.054187192118226604,0.9356814701378254,0.8078817733990148],"portraitCrop":{"left":84,"top":133,"width":414,"height":367},"nativePortraitPlacement":true},"adv4_sword_A112_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.793201133144476,"fig":[0.018475750577367205,0.0226628895184136,0.9815242494226328,0.9773371104815864],"frameFig":[0.1575037147102526,0.21958925750394945,0.7771173848439822,0.7519747235387045],"frameBounds":[0.0950965824665676,0.044233807266982623,0.9004457652303121,0.7535545023696683],"portraitCrop":{"left":98,"top":131,"width":433,"height":353},"nativePortraitPlacement":true},"adv4_sword_A121_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.8035714285714286,"fig":[0.021739130434782608,0.023809523809523808,0.9782608695652174,0.9761904761904762],"frameFig":[0.19329073482428116,0.21122112211221122,0.755591054313099,0.7392739273927392],"frameBounds":[0.12779552715654952,0.06930693069306931,0.9408945686900958,0.740924092409241],"portraitCrop":{"left":113,"top":120,"width":368,"height":336},"nativePortraitPlacement":true},"adv4_sword_A121_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.920265780730897,"fig":[0.025078369905956112,0.026578073089700997,0.9749216300940439,0.973421926910299],"frameFig":[0.3333333333333333,0.29238754325259514,0.7924242424242425,0.7854671280276817],"frameBounds":[0.2803030303030303,0.11591695501730104,0.8924242424242425,0.7854671280276817],"portraitCrop":{"left":212,"top":161,"width":319,"height":301},"nativePortraitPlacement":true},"adv4_sword_A122_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.6005434782608696,"fig":[0.020356234096692113,0.021739130434782608,0.9796437659033079,0.9782608695652174],"frameFig":[0.1691842900302115,0.20882852292020374,0.7386706948640483,0.8064516129032258],"frameBounds":[0.1646525679758308,0.04584040747028863,0.9244712990936556,0.8064516129032258],"portraitCrop":{"left":104,"top":115,"width":393,"height":368},"nativePortraitPlacement":true},"adv4_sword_A122_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.591549295774648,"fig":[0.02077922077922078,0.022535211267605635,0.9792207792207792,0.9774647887323944],"frameFig":[0.2943786982248521,0.184070796460177,0.8402366863905325,0.784070796460177],"frameBounds":[0.14053254437869822,0.184070796460177,0.9393491124260355,0.784070796460177],"portraitCrop":{"left":191,"top":96,"width":385,"height":355},"nativePortraitPlacement":true},"adv4_sword_A211_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.6910112359550562,"fig":[0.02077922077922078,0.02247191011235955,0.9792207792207792,0.9775280898876404],"frameFig":[0.2107843137254902,0.23588039867109634,0.8137254901960784,0.8006644518272426],"frameBounds":[0.1388888888888889,0.053156146179401995,0.946078431372549,0.8023255813953488],"portraitCrop":{"left":121,"top":134,"width":385,"height":356},"nativePortraitPlacement":true},"adv4_sword_A211_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.7455621301775148,"fig":[0.021621621621621623,0.023668639053254437,0.9783783783783784,0.9763313609467456],"frameFig":[0.22327044025157233,0.28135593220338984,0.779874213836478,0.8271186440677966],"frameBounds":[0.19025157232704404,0.05084745762711865,0.9591194968553459,0.8288135593220339],"portraitCrop":{"left":134,"top":158,"width":370,"height":338},"nativePortraitPlacement":true},"adv4_sword_A212_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.6334310850439884,"fig":[0.021621621621621623,0.02346041055718475,0.9783783783783784,0.9765395894428153],"frameFig":[0.2115987460815047,0.22262118491921004,0.7664576802507836,0.8061041292639138],"frameBounds":[0.18181818181818182,0.0718132854578097,0.8526645768025078,0.8078994614003591],"portraitCrop":{"left":127,"top":116,"width":370,"height":341},"nativePortraitPlacement":true},"adv4_sword_A212_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.6828571428571428,"fig":[0.02318840579710145,0.022857142857142857,0.9768115942028985,0.9771428571428571],"frameFig":[0.24651810584958217,0.22920203735144312,0.7047353760445683,0.7962648556876061],"frameBounds":[0.22284122562674094,0.050933786078098474,0.9108635097493036,0.7962648556876061],"portraitCrop":{"left":169,"top":127,"width":345,"height":350},"nativePortraitPlacement":true},"adv4_sword_A221_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.67574931880109,"fig":[0.019559902200488997,0.021798365122615803,0.980440097799511,0.9782016348773842],"frameFig":[0.22767857142857142,0.23252032520325203,0.8125,0.8032520325203252],"frameBounds":[0.10416666666666667,0.061788617886178863,0.9151785714285714,0.8065040650406504],"portraitCrop":{"left":145,"top":135,"width":409,"height":367},"nativePortraitPlacement":true},"adv4_sword_A221_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.631728045325779,"fig":[0.024024024024024024,0.0226628895184136,0.975975975975976,0.9773371104815864],"frameFig":[0.17774936061381075,0.1840277777777778,0.5831202046035806,0.7690972222222222],"frameBounds":[0.13810741687979539,0.04861111111111111,0.9705882352941176,0.7690972222222222],"portraitCrop":{"left":131,"top":98,"width":333,"height":353},"nativePortraitPlacement":true},"adv4_sword_A222_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.5737265415549597,"fig":[0.0199501246882793,0.021447721179624665,0.9800498753117207,0.9785522788203753],"frameFig":[0.14759036144578314,0.2010221465076661,0.7274096385542169,0.8091993185689949],"frameBounds":[0.11897590361445783,0.05110732538330494,0.8900602409638554,0.8091993185689949],"portraitCrop":{"left":90,"top":110,"width":401,"height":373},"nativePortraitPlacement":true},"adv4_sword_A222_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.5601092896174864,"fig":[0.019138755980861243,0.02185792349726776,0.9808612440191388,0.9781420765027322],"frameFig":[0.14664981036662453,0.1978984238178634,0.6548672566371682,0.8108581436077058],"frameBounds":[0.13400758533501897,0.047285464098073555,0.9721871049304678,0.8108581436077058],"portraitCrop":{"left":108,"top":105,"width":418,"height":366},"nativePortraitPlacement":true},"adv4_sword_B111_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.5294117647058822,"fig":[0.025396825396825397,0.0213903743315508,0.9746031746031746,0.9786096256684492],"frameFig":[0.15286624203821655,0.12937062937062938,0.6289808917197452,0.7552447552447552],"frameBounds":[0.14331210191082802,0.08041958041958042,0.8439490445859873,0.7552447552447552],"portraitCrop":{"left":88,"top":66,"width":315,"height":374},"nativePortraitPlacement":true},"adv4_sword_B111_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.7113095238095237,"fig":[0.027874564459930314,0.023809523809523808,0.9721254355400697,0.9761904761904762],"frameFig":[0.20257234726688103,0.19304347826086957,0.6382636655948553,0.7495652173913043],"frameBounds":[0.16881028938906753,0.0817391304347826,0.8729903536977492,0.7513043478260869],"portraitCrop":{"left":118,"top":103,"width":287,"height":336},"nativePortraitPlacement":true},"adv4_sword_B112_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.598314606741573,"fig":[0.029304029304029304,0.02247191011235955,0.9706959706959707,0.9775280898876404],"frameFig":[0.16639477977161501,0.16520210896309315,0.5856443719412724,0.7627416520210897],"frameBounds":[0.16639477977161501,0.06854130052724078,0.8564437194127243,0.7644991212653779],"portraitCrop":{"left":94,"top":86,"width":273,"height":356},"nativePortraitPlacement":true},"adv4_sword_B112_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.7220543806646527,"fig":[0.029197080291970802,0.02416918429003021,0.9708029197080292,0.9758308157099698],"frameFig":[0.20504731861198738,0.20350877192982456,0.61198738170347,0.756140350877193],"frameBounds":[0.19873817034700317,0.10701754385964912,0.8706624605678234,0.7578947368421053],"portraitCrop":{"left":122,"top":108,"width":274,"height":331},"nativePortraitPlacement":true},"adv4_sword_B121_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.5961538461538463,"fig":[0.025889967637540454,0.02197802197802198,0.9741100323624595,0.978021978021978],"frameFig":[0.14680483592400692,0.16695352839931152,0.6528497409326425,0.76592082616179],"frameBounds":[0.14680483592400692,0.14802065404475043,0.8341968911917098,0.76592082616179],"portraitCrop":{"left":77,"top":89,"width":309,"height":364},"nativePortraitPlacement":true},"adv4_sword_B121_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.6763848396501457,"fig":[0.028469750889679714,0.023323615160349854,0.9715302491103203,0.9766763848396501],"frameFig":[0.18575851393188855,0.20173913043478262,0.5959752321981424,0.7704347826086957],"frameBounds":[0.17027863777089783,0.12173913043478261,0.8854489164086687,0.7704347826086957],"portraitCrop":{"left":112,"top":108,"width":281,"height":343},"nativePortraitPlacement":true},"adv4_sword_B122_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.5988538681948423,"fig":[0.026402640264026403,0.022922636103151862,0.9735973597359736,0.9770773638968482],"frameFig":[0.1806020066889632,0.18996415770609318,0.6605351170568562,0.7867383512544803],"frameBounds":[0.1806020066889632,0.07885304659498207,0.8712374581939799,0.7867383512544803],"portraitCrop":{"left":100,"top":98,"width":303,"height":349},"nativePortraitPlacement":true},"adv4_sword_B122_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.5892351274787535,"fig":[0.026143790849673203,0.0226628895184136,0.9738562091503268,0.9773371104815864],"frameFig":[0.18871252204585537,0.17290552584670232,0.7001763668430335,0.7736185383244206],"frameBounds":[0.15520282186948853,0.0873440285204991,0.8624338624338624,0.7736185383244206],"portraitCrop":{"left":99,"top":89,"width":306,"height":353},"nativePortraitPlacement":true},"adv4_sword_B211_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":2.329896907216495,"fig":[0.039603960396039604,0.027491408934707903,0.9603960396039604,0.9725085910652921],"frameFig":[0.28274428274428276,0.34365781710914456,0.6694386694386695,0.7492625368731564],"frameBounds":[0.27234927234927236,0.24336283185840707,0.7920997920997921,0.7522123893805309],"portraitCrop":{"left":128,"top":225,"width":202,"height":291},"nativePortraitPlacement":true},"adv4_sword_B211_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":2.4479166666666665,"fig":[0.032,0.027777777777777776,0.968,0.9722222222222222],"frameFig":[0.16377649325626203,0.3347517730496454,0.6146435452793835,0.7205673758865249],"frameBounds":[0.16377649325626203,0.20425531914893616,0.7456647398843931,0.7219858156028369],"portraitCrop":{"left":77,"top":228,"width":250,"height":288},"nativePortraitPlacement":true},"adv4_sword_B212_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":2.203125,"fig":[0.02973977695167286,0.025,0.9702602230483272,0.975],"frameFig":[0.19246861924686193,0.36879432624113473,0.7217573221757322,0.8],"frameBounds":[0.18619246861924685,0.25957446808510637,0.7928870292887029,0.8014184397163121],"portraitCrop":{"left":84,"top":252,"width":269,"height":320},"nativePortraitPlacement":true},"adv4_sword_B212_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":2.026627218934911,"fig":[0.02711864406779661,0.023668639053254437,0.9728813559322034,0.9763313609467456],"frameFig":[0.1279527559055118,0.32262773722627736,0.6771653543307087,0.7927007299270074],"frameBounds":[0.09448818897637795,0.1927007299270073,0.7401574803149606,0.7927007299270074],"portraitCrop":{"left":57,"top":213,"width":295,"height":338},"nativePortraitPlacement":true},"adv4_sword_B221_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":2.8122448979591836,"fig":[0.039603960396039604,0.0326530612244898,0.9603960396039604,0.9673469387755103],"frameFig":[0.26124197002141325,0.4005805515239477,0.6595289079229122,0.7329462989840348],"frameBounds":[0.2569593147751606,0.2714078374455733,0.815845824411135,0.7343976777939042],"portraitCrop":{"left":114,"top":268,"width":202,"height":245},"nativePortraitPlacement":true},"adv4_sword_B221_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":2.6222222222222222,"fig":[0.0326530612244898,0.02962962962962963,0.9673469387755103,0.9703703703703703],"frameFig":[0.22284644194756553,0.4392655367231638,0.651685393258427,0.7980225988700564],"frameBounds":[0.22284644194756553,0.2853107344632768,0.8333333333333334,0.7994350282485876],"portraitCrop":{"left":111,"top":303,"width":245,"height":270},"nativePortraitPlacement":true},"adv4_sword_B222_f":{"cols":4,"rows":2,"firstFrame":0,"heightScale":2.5064377682403434,"fig":[0.03162055335968379,0.034334763948497854,0.9683794466403162,0.9656652360515021],"frameFig":[0.25932504440497334,0.3441780821917808,0.6802841918294849,0.7157534246575342],"frameBounds":[0.24511545293072823,0.23116438356164384,0.7513321492007105,0.7157534246575342],"portraitCrop":{"left":138,"top":193,"width":253,"height":233},"nativePortraitPlacement":true},"adv4_sword_B222_m":{"cols":4,"rows":2,"firstFrame":0,"heightScale":1.6855524079320112,"fig":[0.023121387283236993,0.0226628895184136,0.976878612716763,0.9773371104815864],"frameFig":[0.10564663023679417,0.19831932773109243,0.7067395264116576,0.7647058823529411],"frameBounds":[0.09289617486338798,0.06554621848739496,0.9326047358834244,0.7647058823529411],"portraitCrop":{"left":50,"top":110,"width":346,"height":353},"nativePortraitPlacement":true}};
  for(const[key,spec]of Object.entries(SWORD_ADV4_HD))HERO_ANIM[key]={...spec,file:"hero_"+key+"_attack"};
  const WPN = { sword: 'wpn_sword', greatsword: 'wpn_greatsword', sword_shield: 'wpn_sword_shield', staff: 'wpn_staff', elem_staff: 'wpn_elemental_staff', wand: 'wpn_grimoire', longbow: 'wpn_longbow', compound_bow: 'wpn_composite_bow', crossbow: 'wpn_crossbow' };
  const FAM = { sword: 'plate', archer: 'leather', mage: 'cloth', thief: 'leather' };
  const ARMOR_ART = { armor: { plate: 'arm_plate', leather: 'arm_leather', cloth: 'arm_robe' }, helmet: { plate: 'helm_plate', leather: 'helm_leather', cloth: 'helm_cloth' },
    gloves: { plate: 'gloves_plate', leather: 'gloves_leather', cloth: 'gloves_cloth' }, boots: { plate: 'boots_plate', leather: 'boots_leather', cloth: 'boots_cloth' } };
  const ITEM_ART = (k) => (/^(red|blue)_\d$/.test(k) ? `item_potion_${k}` : { scroll_w: 'item_scroll_weapon', scroll_a: 'item_scroll_armor', blessed_scroll_w: 'item_scroll_blessed_weapon', blessed_scroll_a: 'item_scroll_blessed_armor', guaranteed_scroll_w: 'item_scroll_blessed_weapon', guaranteed_scroll_a: 'item_scroll_blessed_armor', scroll_r: 'item_scroll_reroll', unbind: 'item_scroll_unbind', ward: 'item_guardian', gold: 'item_gold',
    reselect_1: 'item_fate_book', reselect_2: 'item_fate_book', reselect_3: 'item_fate_book', mat_1: 'item_mat1', mat_2: 'item_mat2', mat_3: 'item_mat3', mat_4: 'item_mat4' }[k] || null);
  const GEAR_NAME_ART = {
    // T1 月桂階 (19 件全套)
    '月桂短劍': 'gear_wpn_laurel_sword',
    '月桂法杖': 'gear_wpn_laurel_staff',
    '月桂狩獵弓': 'gear_wpn_laurel_longbow',
    '月桂頭盔': 'gear_helm_laurel_plate',
    '月桂板甲': 'gear_arm_laurel_plate',
    '月桂鐵護手': 'gear_gloves_laurel_plate',
    '月桂鐵靴': 'gear_boots_laurel_plate',
    '月桂皮帽': 'gear_helm_laurel_leather',
    '月桂皮甲': 'gear_arm_laurel_leather',
    '月桂皮手套': 'gear_gloves_laurel_leather',
    '月桂皮靴': 'gear_boots_laurel_leather',
    '月桂法師帽': 'gear_helm_laurel_cloth',
    '月桂法袍': 'gear_arm_laurel_robe',
    '月桂法師手套': 'gear_gloves_laurel_cloth',
    '月桂法師鞋': 'gear_boots_laurel_cloth',
    '月桂編織腰帶': 'gear_belt_laurel',
    '月桂亞麻內衣': 'gear_undershirt_laurel',
    '月桂葉耳飾': 'gear_earring_laurel',
    '月桂枝戒': 'gear_ring_laurel',

    // T2 雅典階 (19 件主套 + 6 件分支武器)
    '雅典佩劍': 'gear_wpn_athena_sword',
    '雅典厚刃巨劍': 'gear_wpn_athena_greatsword',
    '雅典衛士劍盾': 'gear_wpn_athena_sword_shield',
    '雅典智慧杖': 'gear_wpn_athena_staff',
    '雅典元素使杖': 'gear_wpn_athena_elem_staff',
    '雅典智慧短杖': 'gear_wpn_athena_wand',
    '雅典守衛弓': 'gear_wpn_athena_longbow',
    '雅典風切複合弓': 'gear_wpn_athena_compound_bow',
    '雅典鋼弦重弩': 'gear_wpn_athena_crossbow',
    '雅典頭盔': 'gear_helm_athena_plate',
    '雅典板甲': 'gear_arm_athena_plate',
    '雅典鐵護手': 'gear_gloves_athena_plate',
    '雅典鐵靴': 'gear_boots_athena_plate',
    '雅典皮帽': 'gear_helm_athena_leather',
    '雅典皮甲': 'gear_arm_athena_leather',
    '雅典皮手套': 'gear_gloves_athena_leather',
    '雅典皮靴': 'gear_boots_athena_leather',
    '雅典法師帽': 'gear_helm_athena_cloth',
    '雅典法袍': 'gear_arm_athena_robe',
    '雅典法師手套': 'gear_gloves_athena_cloth',
    '雅典法師鞋': 'gear_boots_athena_cloth',
    '雅典神殿皮帶': 'gear_belt_athena',
    '雅典絲織內衣': 'gear_undershirt_athena',
    '雅典石玉耳墜': 'gear_earring_athena',
    '雅典銀印戒': 'gear_ring_athena',

    // T3 聖林階 (19 件主套 + 6 件分支武器)
    '聖林銳劍': 'gear_wpn_sacred_sword',
    '聖林裂地巨劍': 'gear_wpn_sacred_greatsword',
    '聖林守護劍盾': 'gear_wpn_sacred_sword_shield',
    '聖林藤木杖': 'gear_wpn_sacred_staff',
    '聖林風雷之杖': 'gear_wpn_sacred_elem_staff',
    '聖林秘語典籍': 'gear_wpn_sacred_wand',
    '聖林青藤弓': 'gear_wpn_sacred_longbow',
    '聖林疾風複合弓': 'gear_wpn_sacred_compound_bow',
    '聖林百步弩': 'gear_wpn_sacred_crossbow',
    '聖林頭盔': 'gear_helm_sacred_plate',
    '聖林板甲': 'gear_arm_sacred_plate',
    '聖林鐵護手': 'gear_gloves_sacred_plate',
    '聖林鐵靴': 'gear_boots_sacred_plate',
    '聖林皮帽': 'gear_helm_sacred_leather',
    '聖林皮甲': 'gear_arm_sacred_leather',
    '聖林皮手套': 'gear_gloves_sacred_leather',
    '聖林皮靴': 'gear_boots_sacred_leather',
    '聖林法師帽': 'gear_helm_sacred_cloth',
    '聖林法袍': 'gear_arm_sacred_robe',
    '聖林法師手套': 'gear_gloves_sacred_cloth',
    '聖林法師鞋': 'gear_boots_sacred_cloth',
    '聖林精靈腰帶': 'gear_belt_sacred',
    '聖林木棉內衣': 'gear_undershirt_sacred',
    '聖林泉水耳墜': 'gear_earring_sacred',
    '聖林翡翠戒': 'gear_ring_sacred',

    // T4 海神階 (19 件主套 + 6 件分支武器)
    '海神之劍': 'gear_wpn_poseidon_sword',
    '海神破浪巨劍': 'gear_wpn_poseidon_greatsword',
    '海神浪壁劍盾': 'gear_wpn_poseidon_sword_shield',
    '海神潮汐杖': 'gear_wpn_poseidon_staff',
    '海神怒濤元素杖': 'gear_wpn_poseidon_elem_staff',
    '海神深藍魔杖': 'gear_wpn_poseidon_wand',
    '海神風暴弓': 'gear_wpn_poseidon_longbow',
    '海神破浪複合弓': 'gear_wpn_poseidon_compound_bow',
    '海神重潮弩': 'gear_wpn_poseidon_crossbow',
    '海神頭盔': 'gear_helm_poseidon_plate',
    '海神板甲': 'gear_arm_poseidon_plate',
    '海神鐵護手': 'gear_gloves_poseidon_plate',
    '海神鐵靴': 'gear_boots_poseidon_plate',
    '海神皮帽': 'gear_helm_poseidon_leather',
    '海神皮甲': 'gear_arm_poseidon_leather',
    '海神皮手套': 'gear_gloves_poseidon_leather',
    '海神皮靴': 'gear_boots_poseidon_leather',
    '海神法師帽': 'gear_helm_poseidon_cloth',
    '海神法袍': 'gear_arm_poseidon_robe',
    '海神法師手套': 'gear_gloves_poseidon_cloth',
    '海神法師鞋': 'gear_boots_poseidon_cloth',
    '海神波濤腰帶': 'gear_belt_poseidon',
    '海神鱗紋內衣': 'gear_undershirt_poseidon',
    '海神珍珠耳墜': 'gear_earring_poseidon',
    '海神珊瑚戒': 'gear_ring_poseidon',

    // T5 迷宮階 (19 件主套 + 6 件分支武器)
    '迷宮秘劍': 'gear_wpn_labyrinth_sword',
    '迷宮屠牛巨劍': 'gear_wpn_labyrinth_greatsword',
    '迷宮迷蹤劍盾': 'gear_wpn_labyrinth_sword_shield',
    '迷宮引路杖': 'gear_wpn_labyrinth_staff',
    '迷宮秘術元素杖': 'gear_wpn_labyrinth_elem_staff',
    '迷宮符文寶典': 'gear_wpn_labyrinth_wand',
    '迷宮穿楊弓': 'gear_wpn_labyrinth_longbow',
    '迷宮死線複合弓': 'gear_wpn_labyrinth_compound_bow',
    '迷宮陷陣弩': 'gear_wpn_labyrinth_crossbow',
    '迷宮頭盔': 'gear_helm_labyrinth_plate',
    '迷宮板甲': 'gear_arm_labyrinth_plate',
    '迷宮鐵護手': 'gear_gloves_labyrinth_plate',
    '迷宮鐵靴': 'gear_boots_labyrinth_plate',
    '迷宮皮帽': 'gear_helm_labyrinth_leather',
    '迷宮皮甲': 'gear_arm_labyrinth_leather',
    '迷宮皮手套': 'gear_gloves_labyrinth_leather',
    '迷宮皮靴': 'gear_boots_labyrinth_leather',
    '迷宮法師帽': 'gear_helm_labyrinth_cloth',
    '迷宮法袍': 'gear_arm_labyrinth_robe',
    '迷宮法師手套': 'gear_gloves_labyrinth_cloth',
    '迷宮法師鞋': 'gear_boots_labyrinth_cloth',
    '迷宮牛皮腰帶': 'gear_belt_labyrinth',
    '迷宮密織內衣': 'gear_undershirt_labyrinth',
    '迷宮秘石耳環': 'gear_earring_labyrinth',
    '迷宮紋章戒': 'gear_ring_labyrinth',

    // T6 熔爐階 (19 件主套 + 6 件分支武器)
    '熔爐鍛劍': 'gear_wpn_forge_sword',
    '熔爐熾炎巨劍': 'gear_wpn_forge_greatsword',
    '熔爐烈鋼劍盾': 'gear_wpn_forge_sword_shield',
    '熔爐熾晶杖': 'gear_wpn_forge_staff',
    '熔爐純火元素杖': 'gear_wpn_forge_elem_staff',
    '熔爐火印魔杖': 'gear_wpn_forge_wand',
    '熔爐火翎弓': 'gear_wpn_forge_longbow',
    '熔爐焰爆複合弓': 'gear_wpn_forge_compound_bow',
    '熔爐熾炎鋼弩': 'gear_wpn_forge_crossbow',
    '熔爐頭盔': 'gear_helm_forge_plate',
    '熔爐板甲': 'gear_arm_forge_plate',
    '熔爐鐵護手': 'gear_gloves_forge_plate',
    '熔爐鐵靴': 'gear_boots_forge_plate',
    '熔爐皮帽': 'gear_helm_forge_leather',
    '熔爐皮甲': 'gear_arm_forge_leather',
    '熔爐皮手套': 'gear_gloves_forge_leather',
    '熔爐皮靴': 'gear_boots_forge_leather',
    '熔爐法師帽': 'gear_helm_forge_cloth',
    '熔爐法袍': 'gear_arm_forge_robe',
    '熔爐法師手套': 'gear_gloves_forge_cloth',
    '熔爐法師鞋': 'gear_boots_forge_cloth',
    '熔爐鍛鐵腰帶': 'gear_belt_forge',
    '熔爐抗火內衣': 'gear_undershirt_forge',
    '熔爐火晶耳墜': 'gear_earring_forge',
    '熔爐赤銅戒': 'gear_ring_forge',
  };
  Object.assign(GEAR_NAME_ART, window.RpgGearNames || {});
  const cleanGearName = (name) => String(name || '').replace(/^(?:(?:遺物・|菁英))*/, '').trim();
  /** gear row/offer → icon file: specific named item if present, else fallback to weapon kind / armor family / shared slot */
  const GEAR_ART = (g) => {
    if (!g) return null;
    if (window.RpgThiefGearArt?.isThiefClassGear(g)) return window.RpgThiefGearArt.resolve(g)?.artId || null;
    const directName = cleanGearName(g.name);
    if (directName && GEAR_NAME_ART[directName]) return GEAR_NAME_ART[directName];
    return (g.slot === 'weapon' ? WPN[g.kind] : ARMOR_ART[g.slot] ? ARMOR_ART[g.slot][FAM[g.classReq] || g.kind] || ARMOR_ART[g.slot][g.kind] : ['belt', 'undershirt', 'earring', 'ring'].includes(g.slot) ? g.slot : null);
  };
  const AV1 = { portrait: { 'archer:f': 'portrait_archer_f', 'archer:m': 'portrait_archer_m' }, sprite: { 'archer:f': 'sprite_archer_f', 'archer:m': 'sprite_archer_m' },
    monster: { '哥布林': 'monster_goblin' }, boss: { 1: 'boss_goblin_chief' }, map: { 1: 'map1_meadow' }, item: { red_1: 'item_red_potion', scroll_w: 'item_scroll_enhance', scroll_a: 'item_scroll_enhance' } };
  const HEROES = { nodes: new Set(), meta: {} };
  const HERO_DISPLAY = {};
  /** class_path 'A1' → adv2_<cls>_A1_<g> if present, else adv1_<cls>_A_<g>, else the base <cls>_<g> */
  function heroKey(cls, g, path) {
    if (cls === 'thief') return window.RpgThiefClass.heroKey(cls, g || 'm', String(path || '')) || 'thief_invalid_m';
    const exact=V2&&window.RpgHeroArtRegistry?.key({baseClass:cls,gender:g||'m',classPath:path||''});if(exact)return exact;
    const p = String(path || ''); g = g || 'm';
    for (let L = Math.min(4, p.length); L >= 1; L--) { const k = `adv${L}_${cls}_${p.slice(0, L)}_${g}`; if (HEROES.nodes.has(k) || ELF_ADV4_HD[k] || ELF_ADV3_HD[k] || SWORD_ADV3_HD[k] || SWORD_ADV4_HD[k]) return k; }
    return `${cls}_${g}`;
  }
  const myHeroKey = () => { const c = S.me ? S.me.character : {}; return heroKey(c.baseClass, c.gender, c.classPath); };
  const SINGLE_ELF4 = /^adv4_archer_(A11[12]|A12[12]|A21[12])_[fm]$/;
  function artFile(kind, key) {
    if(kind==='item'&&/^(red|blue)_[1-4]$/.test(key))return `art/potions-20261019/${key}.webp`;
    if(kind==='item'&&key==='star_ring_core')return '/art/star-ring-rank-rewards-20261019/star-ring-core.webp';
    if(kind==='item'&&key==='star_ring_token')return '/art/star-ring-20261018/star_ring_token.webp';
    if(kind==='item'&&key==='fate_cycle_gift')return '/art/ui/command-collect-20261012.webp';
    if(kind==='item'&&/^guaranteed_scroll_[wa]$/.test(key))return `/art/items-scrolls-pink-20261018/${key}.webp`;
    if(kind==='item'&&['boss_essence','tower_fragment'].includes(key))return 'art/ui/item-'+key+'-20261012.webp';
    if(kind==='item'&&['guardian_voucher','research_fragment'].includes(key))return 'art/ui/item-'+key+'-20261015.webp';
    if(kind==='item'&&key==='guardian_summon_stone')return 'art/guardian-sigil-20261013/guardian-summon-stone.webp';
    if(kind==='item'&&key==='gacha_weapon')return 'art/ui/gacha-weapon-20261015.webp';
    if(kind==='item'&&key==='gacha_armor')return 'art/ui/gacha-armor-blue-20261015.webp';
    if(kind==='item'&&key==='gold')return 'art/ui/hud-coin-v2.webp';
    if(kind === 'item' && ['scroll_w','scroll_a','scroll_r','blessed_scroll_w','blessed_scroll_a','unbind'].includes(key)) return `art/items-scrolls-cutout-20261011/${key}.webp`;
    // Thieves only use their exact authored registry identity; missing art never borrows another class or tier.
    if (['hero','sprite','portrait','heroAnim'].includes(kind) && (window.RpgThiefClass.isThiefKey(key) || String(key).includes('thief'))) return window.RpgHeroArtRegistry?.resolve(key, kind) || null;
    if (MODE === 'svg') return null;
    if (MODE === 'v1') { const k = kind === 'hero' ? 'sprite' : kind; const f = AV1[k] && AV1[k][String(key).replace('_', ':')] || (AV1[k] && AV1[k][key]); return f ? `art/v1/${f}.webp` : null; }
    if(V2&&['hero','sprite','portrait','heroAnim'].includes(kind)){const exact=window.RpgHeroArtRegistry?.resolve(key,kind);if(exact)return exact;}
    if(V2 && SWORD_ADV2_HD[key]) {const asset='art/sword-adv2-hd-20261012/hero_'+key;if(kind==='heroAnim')return asset+'_attack.webp?v=20261012-sword2-16-webp';if(kind==='portrait')return asset+'_portrait.png?v=20261012-sword2-16';if(kind==='hero'||kind==='sprite')return asset+'.png?v=20261012-sword2-16';}
    if(V2 && SWORD_ADV3_HD[key]) {const asset='art/sword-adv3-hd-20261012/hero_'+key;if(kind==='heroAnim')return asset+'_attack.webp?v=20261012-sword3-16';if(kind==='portrait')return asset+'_portrait.png?v=20261012-sword3-16';if(kind==='hero'||kind==='sprite')return asset+'.png?v=20261012-sword3-16';}
    if(V2 && MAGE_ADV2_HD[key]) {const asset='art/mage-adv2-hd-20261012/hero_'+key;if(kind==='heroAnim')return asset+'_attack.webp?v=20261012-mage2-hd1';if(kind==='portrait')return asset+'_portrait.png?v=20261012-mage2-hd1';if(kind==='hero'||kind==='sprite')return asset+'.png?v=20261012-mage2-hd1';}
    if(V2 && ELF_ADV4_HD[key]) {const asset="art/elf-adv4-magic-20261013/hero_"+key;if(kind==="heroAnim")return asset+"_attack.webp?v=20261013-elf4-magic2";if(["hero","sprite","portrait"].includes(kind))return asset+".webp?v=20261013-elf4-magic2";}
    if(V2 && ELF_ADV3_HD[key]) {const asset="art/elf-adv3-magic-20261013/hero_"+key;if(kind==="heroAnim")return asset+"_attack.webp?v=20261013-elf3-magic1";if(["hero","sprite","portrait"].includes(kind))return asset+".webp?v=20261013-elf3-magic1";}
    if(V2 && ELF_ADV2_HD[key]) {const asset='art/elf-adv2-magic-20261013/hero_'+key;if(kind==='heroAnim')return asset+'_attack.webp?v=20261013-elf2-magic1';if(kind==='portrait')return asset+'_portrait.png?v=20261013-elf2-magic1';if(kind==='hero'||kind==='sprite')return asset+'.webp?v=20261013-elf2-magic1';}
    if(V2 && SWORD_ADV4_HD[key]) {const asset='art/sword-adv4-magic-20261013/hero_'+key;if(kind==='heroAnim')return asset+'_attack.webp?v=20261013-sword4-magic1';if(kind==='portrait')return asset+'_portrait.png?v=20261013-sword4-magic1';if(kind==='hero'||kind==='sprite')return asset+'.png?v=20261013-sword4-magic1';}
    let f = null;
    if (kind === 'hero' || kind === 'sprite') f = `hero_${String(key).replace(':', '_')}`;
    else if (kind === 'heroAnim') f = HERO_ANIM[key] ? HERO_ANIM[key].file : null;
    else if (kind === 'portrait') f = `portrait_${String(key).replace(':', '_')}`;
    else if (kind === 'monster' || kind === 'elite') f = MON[key] || null;
    else if (kind === 'monsterAnim') f = MON_ANIM[key] || null;
    else if (kind === 'eliteAnim') f = ELITE_ANIM[key] || null;
    else if (kind === 'boss') f = BOSS_ANIM[key]?.replace(/_attack$/, '') || MON[key] || null;
    else if (kind === 'bossAnim') f = BOSS_ANIM[key] || MON_ANIM[key] || null;
    else if (kind === 'map') {
      if (key === 'town') f = 'bg_town';
      else if (typeof key === 'string' && /^myth(?:0[1-9]|1[0-2])$/.test(key)) return `art/v2/bg_${key}.webp?v=20261010-greek-maps-1`;
      else f = { 1: 'bg_map1', 2: 'bg_map2', 3: 'bg_map3', 4: 'bg_map4' }[key] || null;
    }
    else if (kind === 'item') f = ITEM_ART(key);
    else if (kind === 'gear') f = GEAR_ART(key);
    if (kind === 'gear' && f) return window.RpgThiefGearArt?.iconForArtId(f) || `art/v2/${f}.webp?v=20261011-equipment-2`;
    // First-advancement swordsmen: branch A berserkers and branch B knights use four aligned 4x2/8-frame sheets.
    if (V2 && /^adv1_sword_[AB]_[fm]$/.test(String(key))) {
      const asset = `art/sword-adv1-clean-20261011/hero_${key}`;
      const cache = 'v=20261011-sword-adv1-4x2-1';
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `${asset}.png?${cache}`;
      if (kind === 'heroAnim') return `${asset}_attack.png?${cache}`;
    }
    // Zero-turn sword heroes share the cleaned 4x2 sheets and first-frame idle cutouts.
    if (V2 && /^sword_[fm]$/.test(String(key))) {
      const gender = String(key).slice(-1);
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `art/sword-zero-clean-20261011/hero_sword_${gender}.png?v=20261011-sword-zero-4x2-1`;
      if (kind === 'heroAnim') return `art/sword-zero-clean-20261011/hero_sword_${gender}_attack.png?v=20261011-sword-zero-4x2-1`;
    }
    // Mage zero-turn and future painted advancement overrides must run before any legacy SVG fallback.
    // Original zero-advancement Greek-mythic mage artwork and painted eight-frame animation.
    if (V2 && /^mage_[fm]$/.test(String(key))) {
      const gender = String(key).slice(-1);
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `art/mage-zero-clean-20261010/hero_mage_${gender}.png?v=20261010-mage-zero-4x2-live-4`;
      if (kind === 'heroAnim') return `art/mage-zero-clean-20261010/hero_mage_${gender}_attack.png?v=20261010-mage-zero-4x2-live-4`;
    }
    // First-advancement mages have distinct painted full-body art, card portraits, and 4x3/12-frame combat sheets.
    if (V2 && /^adv1_mage_[AB]_[fm]$/.test(String(key))) {
      const asset = `art/mage-adv1-hd-20261011/hero_${key}`;
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `${asset}.png?v=20261011-mage-adv1-hd-1`;
      if (kind === 'heroAnim') return `${asset}_attack.png?v=20261011-mage-adv1-hd-1`;
    }
    // Legacy mage artwork is fallback-only. Never override published painted character assets.
    if (V2 && (kind === 'hero' || kind === 'sprite' || kind === 'portrait') && /^((adv[1-4]_)?mage(_[AB][12]*)?_[fm])$/.test(String(key))) {
      const file = `${kind === 'portrait' ? 'portrait' : 'hero'}_${key}`;
      const gender=String(key).slice(-1), branch=String(key).match(/_([AB])[12]*_[fm]$/)?.[1]||'A';
      return `art/mage-adv1-hd-20261011/hero_adv1_mage_${branch}_${gender}.png?v=20261011-painted-fallback-1`;
    }
    // Fresh original elf artwork. Exact archer class only; advanced careers retain their existing assets.
    if (V2 && /^(archer_[fm])$/.test(String(key))) {
      const gender = String(key).slice(-1);
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `art/elf-v2-20261010/hero_archer_${gender}.webp?v=20261010-attack-v2`;
      if (kind === 'heroAnim') return `art/elf-clean-20261010/hero_archer_${gender}_attack.png?v=20261010-clean-2s-1`;
    }
    // First-advancement elf: original portrait art plus re-matted, content-trimmed 4x2 attack sheets.
    if (V2 && /^adv1_archer_[AB]_[fm]$/.test(String(key))) {
      const asset = `art/elf-adv1-hd-20261011/hero_${key}`;
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `${asset}.png?v=20261012-elf-adv1-unified1`;
      if (kind === 'heroAnim') return `${asset}_attack.png?v=20261012-elf-adv1-unified1`;
    }
    // Second-advancement elves: eight distinct male/female branch sheets and first-frame card art.
    if (V2 && /^adv2_archer_[AB][12]_[fm]$/.test(String(key))) {
      const asset = `art/elf-adv2-hd-20261011/hero_${key}`;
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `${asset}.png?v=20261011-adv2-size-match-2`;
      if (kind === 'heroAnim') return `${asset}_attack.png?v=20261011-adv2-size-match-2`;
    }
    // Third-advancement elves use newly matted 4x2 sheets aligned to their second-advancement branch.
    if (V2 && /^adv3_archer_[AB][12]{2}_[fm]$/.test(String(key))) {
      const asset = `art/elf-adv3-hd-20261011/hero_${key}`;
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `${asset}.png?v=20261011-adv3-4x2-size-match-1`;
      if (kind === 'heroAnim') return `${asset}_attack.png?v=20261011-adv3-4x2-size-match-1`;
    }
    if (V2 && SINGLE_ELF4.test(String(key))) {
      const asset = `art/elf-adv4-single-20261011/hero_${key}`;
      if (['hero','sprite','portrait'].includes(kind)) return `${asset}.png?v=single-1`;
      if (kind === 'heroAnim') return `${asset}_attack.png?v=single-1`;
    }
    // Fourth-advancement elf combat and portrait assets, matched in size and baseline to tier three.
    if (V2 && /^adv4_archer_[AB][12]{3}_[fm]$/.test(String(key))) {
      const asset = `art/elf-adv4-clean-20261011/hero_${key}`;
      const cache = 'v=20261011-adv4-4x2-size-match-1';
      if (kind === 'hero' || kind === 'sprite' || kind === 'portrait') return `${asset}.png?${cache}`;
      if (kind === 'heroAnim') return `${asset}_attack.png?${cache}`;
    }
    // Production-quality safety fallback: use existing painted WebP, never flat procedural elf SVG.
    if (V2 && (kind === 'hero' || kind === 'sprite' || kind === 'portrait') && /^((adv[1-4]_)?archer(_[AB][12]*)?_[fm])$/.test(String(key))) {
      const parts = String(key).match(/^adv([1-4])_archer_([AB][12]*)_[fm]$/);
      const safeKey = parts && Number(parts[1]) > 2 ? `adv2_archer_${parts[2].slice(0,2)}_${String(key).slice(-1)}` : key;
      return `art/v2/${kind === 'portrait' ? 'portrait' : 'hero'}_${safeKey}.webp?v=20261010-painted-restore`;
    }
    const refreshedArt = ['hero_sword_f', 'portrait_sword_f', 'hero_sword_f_attack', 'hero_sword_m', 'portrait_sword_m', 'hero_mage_m', 'portrait_mage_m', 'hero_sword_m_attack', 'hero_mage_m_attack', 'hero_archer_m', 'portrait_archer_m', 'hero_archer_m_attack', 'mon_gorgon', 'mon_gorgon_attack', 'hero_adv1_mage_A_f', 'portrait_adv1_mage_A_f', 'hero_adv1_mage_A_f_attack', 'hero_adv1_mage_A_m', 'portrait_adv1_mage_A_m', 'hero_adv1_mage_A_m_attack', 'hero_adv1_archer_A_m', 'portrait_adv1_archer_A_m', 'hero_adv1_archer_A_m_attack', 'hero_adv1_archer_B_m', 'portrait_adv1_archer_B_m', 'hero_adv1_archer_B_m_attack', 'hero_adv1_sword_A_f', 'hero_adv1_sword_A_m', 'hero_adv1_sword_B_f', 'hero_adv1_sword_B_m', 'hero_adv1_sword_A_f_attack', 'hero_adv1_sword_A_m_attack', 'hero_adv1_sword_B_f_attack', 'hero_adv1_sword_B_m_attack'];
    if (expansion?.spec(f)) return `art/monster-expansion-20261013/${f}.webp?v=20261015-monster47`;
    if (cleanMonsterKeys.has((f || '').replace(/_attack$/, '')) || /^(mon_(olive_guardian|arcadia_nymph|pan_cub|laurel_treant)|elite_pan_warden|boss_(arcadia_goblin_chief|ancient_laurel))(_attack)?$/.test(f)) return `art/monsters-clean-20261011/${f}.png?v=20261011-clean-4`;
    if (kind === 'heroAnim' && /^hero_(adv[1-4]_)?mage_/.test(f || '')) return `art/mage/${f}.png?v=20261010-mage-anim-2`;
    // Disable all rotated paper-cutout attack sheets until genuinely animated painted frames exist.
    if (kind === 'heroAnim' && /^((adv[1-4]_)?archer(_[AB][12]*)?_[fm])$/.test(String(key))) return null;
    return f ? `art/v2/${f}.webp${refreshedArt.includes(f) ? (f.startsWith('hero_archer_m') || f === 'portrait_archer_m' ? '?v=20261009-archer-m-2' : f.startsWith('mon_gorgon') ? '?v=20261009-gorgon-1' : f.startsWith('hero_adv1_mage_A_') || f.startsWith('portrait_adv1_mage_A_') ? '?v=20261009-adv1-mage-a-1' : f.startsWith('hero_adv1_archer_') || f.startsWith('portrait_adv1_archer_') ? '?v=20261009-adv1-archer-branches-2' : '?v=20261009-hero-refresh-2') : ''}` : null;
  }
  for(const key of Object.keys(ELF_ADV4_HD))HERO_DISPLAY[key]=artFile("portrait",key);
  const IMG = {};
  const artSrc = (kind, key) => artFile(kind, key);
  // Retry failed reads on the existing drawing loop, with a fixed three-attempt
  // budget. A failed Image must not poison this page's cache forever.
  const IMG_LOAD = {};
  function artImg(kind, key) {
    const src=artSrc(kind,key);if(!src)return null;
    const now=Date.now(),meta=IMG_LOAD[src];
    if(!IMG[src]||meta?.failed&&meta.attempt<3&&now>=meta.retryAt){
      const attempt=(meta?.attempt||0)+1,i=new Image();
      const next={attempt,failed:false,retryAt:0};IMG_LOAD[src]=next;IMG[src]=i;i.decoding='async';
      i.onerror=()=>{if(IMG[src]===i){next.failed=true;next.retryAt=Date.now()+(attempt===1?1000:4000);}};
      i.src=src;
    }
    const i=IMG[src];return i.complete&&i.naturalWidth?i:null;
  }
  if (ART) {
    document.body.classList.add('greek'); if (V2) document.body.classList.add('v2');
    // font treatments (staging: ?font=A|B|C|D, remembered in localStorage; default = current v0.5 look). Google Fonts CSS2 slices CJK by unicode-range + display=swap.
    const SERIF = '"Noto Serif TC","Noto Serif CJK TC","Songti TC",serif', SANS = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif', SYS = '-apple-system,"PingFang TC","Noto Sans CJK TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    // v0.5.1: each CJK weight costs ~0.5–0.9 MB of slices on a busy screen → only 2 CJK weights per option (700 text maps to 900 / synthesises)
    const FONTS = {
      cur: { q: 'family=Cinzel:wght@700;900&family=Noto+Serif+TC:wght@500;700;900', body: SERIF, title: `Cinzel,${SERIF}`, ui: SERIF, num: `Cinzel,${SERIF}`, wb: 500, wt: 900 },
      A: { q: 'family=Noto+Serif+TC:wght@500;900', body: SERIF, title: SERIF, ui: SERIF, num: SERIF, wb: 500, wt: 900 },
      B: { q: 'family=LXGW+WenKai+TC:wght@400&family=Noto+Serif+TC:wght@900', body: `"LXGW WenKai TC",${SERIF}`, title: SERIF, ui: `"LXGW WenKai TC",${SERIF}`, num: `"LXGW WenKai TC",${SERIF}`, wb: 400, wt: 900 },
      C: { q: 'family=Iansui&family=Noto+Sans+TC:wght@400;700', body: SANS, title: `Iansui,${SANS}`, ui: SANS, num: SANS, wb: 400, wt: 400 },
      E: { q: 'family=Cinzel:wght@700&family=Noto+Serif+TC:wght@900', body: SYS, title: SERIF, ui: SYS, num: `Cinzel,${SYS}`, wb: 400, wt: 900 },   // lightest: system UI font for body (PingFang TC / Noto Sans CJK), web font only for titles
      D: { q: 'family=Cinzel:wght@700&family=Noto+Serif+TC:wght@900&family=Noto+Sans+TC:wght@400;700', body: SANS, title: SERIF, ui: SERIF, num: `Cinzel,${SERIF}`, wb: 400, wt: 900 },
    };
    let fk = (new URLSearchParams(location.search).get('font') || '').toUpperCase(); if (fk === 'CUR') fk = 'cur';
    try { if (FONTS[fk]) localStorage.setItem('elfFont', fk); else fk = localStorage.getItem('elfFont') || ''; } catch (_) {}
    const DEFAULT_FONT = 'D';   // ミカサ 21:07 picked D (Noto Serif TC Black titles + Cinzel numerals + Noto Sans TC body); ?font= / localStorage still override for previews
    const F0 = FONTS[fk] || FONTS[DEFAULT_FONT]; const R = document.documentElement.style; document.body.dataset.font = FONTS[fk] ? fk : DEFAULT_FONT;
    R.setProperty('--f-body', F0.body); R.setProperty('--f-title', F0.title); R.setProperty('--f-ui', F0.ui); R.setProperty('--f-num', F0.num); R.setProperty('--w-body', F0.wb); R.setProperty('--w-title', F0.wt);
    for (const href of [`https://fonts.googleapis.com/css2?${F0.q}&display=swap`, 'theme-greek.css?v=10', 'ui-refined.css?v=20261011-1', 'mythic-ui.css?v=20261011-2', 'olympus-luxury.css?v=20261011-1', 'olympus-suite.css?v=20261011-home-panels-1', 'hero-display.css?v=20261011-3', 'hero-fx.css?v=20261016-advanced-armory1', 'olympus-unified.css?v=20261016-create-surfaces1']) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  }
  const iconHtml = (k, fallback) => { if (String(k).startsWith('book_')) return `<img class="skill-book-icon" src="/expedition/assets/skills-painted-20261011/${esc(String(k).slice(5))}.webp" alt="${esc(itemName(k))}" loading="lazy">`; const collectionArt=window.RpgCollectionUI?.icon(k),src=collectionArt||artSrc('item', k); return src ? `<img src="${src}" ${collectionArt?`data-collection-icon="${esc(k)}"`:''} ${/^(blessed|guaranteed)_scroll_/.test(String(k))?'class="blessed-scroll-icon"':''} alt="${collectionArt||String(k).startsWith('guaranteed_scroll_')?esc(itemName(k)):''}" loading="lazy">${String(k).startsWith('guaranteed_scroll_')?'<small class="tc-legendary">必成100%</small>':''}` : fallback; };
  const gearIcon = (g, fallback) => { if(g?.slot==='weapon'&&g.classReq==='thief')fallback='🗡️'; const src = window.RpgStarRingCosmetics?.gearArt(g)||artSrc('gear', g); return src ? `<img src="${src}" alt="" loading="lazy" decoding="async">` : fallback; };
  function characterPortrait(c){return artSrc('hero',heroKey(c.baseClass,c.gender,c.classPath));}
  function portraitHtml(id, cls, gender) { const c = S.me ? S.me.character : {}; const key = cls ? heroKey(cls, gender || c.gender) : myHeroKey(); const src = characterPortrait(cls?{baseClass:cls,gender:gender||c.gender,classPath:''}:c); return src ? `<img class="portrait" id="${id}" src="${src}" alt="">` : `<canvas class="portrait" id="${id}"></canvas>`; }
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('zh-TW');
  const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 32);
  const haptic = (k) => { try { if (k === 'ok' || k === 'error' || k === 'warning') tg.HapticFeedback.notificationOccurred(k === 'ok' ? 'success' : k); else tg.HapticFeedback.impactOccurred(k || 'light'); } catch (_) {} };
  const WEAPON_EMOJI = { sword: '⚔️', archer: '🏹', mage: '🪄', thief: '🗡️' };
  const SLOT_EMOJI = { weapon: '⚔️', helmet: '🪖', armor: '🛡️', gloves: '🧤', boots: '👢', belt: '🎗️', undershirt: '👕', earring: '💎', ring: '💍' };
  // 11 equipped positions (v0.4): paper-doll left / right columns + accessory row
  const DOLL_L = [['helmet', 1], ['armor', 1], ['gloves', 1], ['boots', 1]];
  const DOLL_R = [['weapon', 1], ['undershirt', 1], ['belt', 1]];
  const DOLL_B = [['earring', 1], ['earring', 2], ['ring', 1], ['ring', 2]];
  const MULTI = { earring: 2, ring: 2 };
  const slotLabel = (slot, pos) => `${(S.meta && S.meta.slots[slot]) || slot}${MULTI[slot] ? pos : ''}`;
  const ELEM = { earth: '🌍地', water: '🌊水', fire: '🔥火', wind: '🌪️風', light: '☀️光', dark: '🌑暗' };

  const S = { meta: null, me: null, characters: [], choosing: true, creating: false, pendingTab: 'home', shop: null, boss: null, ledger: null, tab: 'home', shopTab: 'weapon', skew: 0, lastReport: null,
    session: { kills: 0, exp: 0, gold: 0, ticks: 0 }, create: { step: 0, name: '', cls: null, gender: null, slot: null }, busy: false, armorSlot: 'all', trades: null, trade: null, tradeTimer: 0 };
  const equipmentSync=window.RpgEquipmentLiveSync?.create();
  let equipmentSyncQueued=false;
  function scheduleEquipmentSync(){if(equipmentSyncQueued||!equipmentSync?.pending(S.me?.character?.tgId))return;equipmentSyncQueued=true;Promise.resolve().then(()=>{equipmentSyncQueued=false;if(!document.hidden&&equipmentSync.pending(S.me?.character?.tgId))void refreshMe({silent:true,full:true});});}
  function reconcileEquipmentSheet(){const card=$('.sheet-card'),id=card?.dataset.equipmentId,forge=$('#forge');if(!id||$('#sheet').hidden||(forge&&!forge.hidden))return;const item=S.me?.equipment.find(e=>e.id===id);if(item){if(card.dataset.equipmentVersion!==JSON.stringify(item))itemSheet(id);}else{closeSheet();delete card.dataset.equipmentId;toast('這件裝備已不在神器庫，畫面已同步。');}}
  const operationNotices=window.RpgOperationNotices?.create({api,owner:()=>String(tg?.initDataUnsafe?.user?.id||devTg||'')});
  const autoNotice=j=>({kind:'auto_enhance_end',refId:j.id,ownerAccountId:j.ownerAccountId,dismissed:j.dismissed});
  const backgroundWorkshop=window.RpgBackgroundWorkshop?.create({gate:operationNotices,onOpen:n=>{void openBackground(n).catch(e=>toast(e.message,true));},onDismiss:()=>{void syncBackground().catch(()=>{});}});
  function setBackground(jobs,actor=S.me?.character?.tgId){equipmentSync?.observe(jobs,null,actor);S.backgroundJobs=jobs||[];for(const[kind,key]of [['auto_enhance_end','autoEnhance'],['auto_reroll_end','autoReroll'],['guardian_auto','guardianAuto']]){const own=S.backgroundJobs.filter(x=>x.kind===kind),current=own.find(x=>x.job.status==='running')||own.at(-1);S[key]=current?.job||null;}backgroundWorkshop?.render(S.backgroundJobs);guardianController?.update({autoJob:S.guardianAuto});window.RpgAutoRerollUI?.updateJob(S.autoReroll);scheduleEquipmentSync();}
  async function syncBackground(){const epoch=S.apiEpoch||0,r=await api('background/status');if(epoch===(S.apiEpoch||0)){setBackground(r.jobs);equipmentSync?.observe(r.jobs,r.balance,S.me?.character?.tgId);if(r.balance&&String(r.balance.characterId)===String(S.me?.character?.tgId)&&r.balance.revision>=S.me.character.revision){S.me.character.gold=r.balance.gold;S.me.character.revision=r.balance.revision;renderHud();if(r.balance.guardianBalances)guardianController?.update({balances:r.balance.guardianBalances,revision:r.balance.revision,characterId:r.balance.characterId});}void operationNotices?.flush();if(equipmentSync?.pending(S.me?.character?.tgId))await refreshMe({silent:true,full:true});}return r;}
  async function openBackground(n){if(n.kind==='auto_enhance_end'){S.autoEnhance=n.job;autoPanel();}else if(n.kind==='auto_reroll_end')showRerollJob(n.job);else{if(String(n.job.characterId)!==String(S.me?.character?.tgId)){absorb(await api('select',{charId:n.job.characterId}),true);S.choosing=false;}openGuardian('inventory');}}
  function rerollNotice(j){return {kind:'auto_reroll_end',refId:j.id,ownerAccountId:j.ownerAccountId};}
  function showRerollJob(job){S.autoReroll=job;window.RpgAutoRerollUI.showJob(job,{sheet,closeSheet,api,onError:m=>toast(m,true),onDismiss:j=>{backgroundWorkshop.dismiss(rerollNotice(j));void refreshMe({silent:true});},onUpdate:j=>{S.autoReroll=j;S.backgroundJobs=(S.backgroundJobs||[]).map(n=>n.refId===j.id?{...n,job:j}:n);backgroundWorkshop.render(S.backgroundJobs);void syncBackground().catch(()=>{});}});}
  const ITEMS_REF = {};
  const BATTLE = V2 && window.RpgBattle ? window.RpgBattle.create({ src: artSrc, items: ITEMS_REF, fmt: (n) => fmt(n), stateInfo: (me) => stateInfo(me),
    heroKey: (c) => heroKey(c.baseClass, c.gender, c.classPath), heroMeta: (k) => window.RpgHeroArtRegistry?.get(k)?.heroMeta || (ELF_ADV4_HD[k] ? {fig:ELF_ADV4_HD[k].fig} : ELF_ADV3_HD[k] ? {fig:ELF_ADV3_HD[k].fig} : ELF_ADV2_HD[k] ? {fig:ELF_ADV2_HD[k].fig} : MAGE_ADV2_HD[k] ? {fig:MAGE_ADV2_HD[k].fig} : SWORD_ADV4_HD[k] ? {fig:SWORD_ADV4_HD[k].fig} : SWORD_ADV3_HD[k] ? {fig:SWORD_ADV3_HD[k].fig} : SWORD_ADV2_HD[k] ? {fig:SWORD_ADV2_HD[k].fig} : HEROES.meta[`hero_${k}`] || null),
    heroAnim: (k) => window.RpgHeroArtRegistry?.animation(k) || (HERO_ANIM[k] ? { src: artSrc('heroAnim', k), nativePortraitPlacement: !!SWORD_ADV4_HD[k], frameFig: SWORD_ADV4_HD[k]?.frameFig, portraitCrop: SWORD_ADV4_HD[k]?.portraitCrop || ELF_ADV4_HD[k]?.portraitCrop, frameBounds: SWORD_ADV4_HD[k]?.frameBounds || ELF_ADV4_HD[k]?.frameBounds || ELF_ADV3_HD[k]?.frameBounds, authoredEffects: !!ELF_ADV4_HD[k] || !!ELF_ADV3_HD[k] || !!SWORD_ADV4_HD[k], preservePlacement: !!ELF_ADV4_HD[k] || !!ELF_ADV3_HD[k] || !!ELF_ADV2_HD[k] || !!SWORD_ADV4_HD[k], cols: /^(archer_[fm]|adv1_archer_[AB]_[fm])$/.test(k) ? 4 : HERO_ANIM[k].cols, rows: HERO_ANIM[k].rows, firstFrame: ELF_ADV4_HD[k] ? 0 : ELF_ADV3_HD[k] ? 0 : ELF_ADV2_HD[k] ? 0 : /^(mage_[fm]|adv1_archer_[AB]_[fm]|adv1_mage_[AB]_[fm])$/.test(k) ? 0 : HERO_ANIM[k].firstFrame, heightScale: ELF_ADV4_HD[k]?.heightScale || ELF_ADV3_HD[k]?.heightScale || ELF_ADV2_HD[k]?.heightScale || SWORD_ADV4_HD[k]?.heightScale || SWORD_ADV3_HD[k]?.heightScale || SWORD_ADV2_HD[k]?.heightScale || (SINGLE_ELF4.test(k) ? 576/448 : 1), useAsIdle: !!ELF_ADV4_HD[k] || !!ELF_ADV3_HD[k] || !!ELF_ADV2_HD[k] || !!MAGE_ADV2_HD[k] || !!SWORD_ADV4_HD[k] || !!SWORD_ADV3_HD[k] || !!SWORD_ADV2_HD[k] || SINGLE_ELF4.test(k) || /^adv1_(archer|mage)_[AB]_[fm]$/.test(k) } : null) }) : null;

  // ---------- Telegram theme ----------
  function applyTheme() {
    const light = tg && tg.colorScheme === 'light';
    document.body.classList.toggle('light', !!light);
    const p = (tg && tg.themeParams) || {};
    const r = document.documentElement.style;
    if (ART) {   // v0.5.1: the painted theme owns its palette — never inherit Telegram text/bg colors (iOS dark made text dark-on-navy)
      document.body.classList.remove('light');
      try { tg.setHeaderColor && tg.setHeaderColor('#170f09'); tg.setBackgroundColor && tg.setBackgroundColor('#121a2e'); tg.setBottomBarColor && tg.setBottomBarColor('#121a2e'); } catch (_) {}
      return;
    }
    if (p.bg_color) r.setProperty('--bg', light ? p.secondary_bg_color || p.bg_color : p.bg_color);
    if (p.section_bg_color || p.secondary_bg_color) r.setProperty('--panel', light ? p.bg_color || '#fff' : p.section_bg_color || p.secondary_bg_color);
    if (p.text_color) r.setProperty('--text', p.text_color);
    if (p.hint_color) r.setProperty('--muted', p.hint_color);
    if (p.button_color) r.setProperty('--accent', p.button_color);
    try { tg.setHeaderColor && tg.setHeaderColor(light ? 'secondary_bg_color' : 'bg_color'); } catch (_) {}
  }
  if (tg) { tg.ready(); tg.expand(); applyTheme(); tg.onEvent && tg.onEvent('themeChanged', applyTheme); try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (_) {} }

  // ---------- API ----------
  const readActions=new Set(['fate/social/preferences','fate/social/inbox','fate/social/event','fate/gifts/summary','fate/me','fate/state','fate/history','fate/daily','fate/profile','guardian/config','guardian/inventory','guardian/operation','guardian/history','journal','meta','me','characters','exchange/list','exchange/sellable','exchange/mine','exchange/history','shop','boss','ledger','players','trade/list','trade/requests','trade/get','trade/log','pk/list','pk/get','expedition/me','party/list','party/get','star-ring/list','star-ring/me','star-ring/get','auto-enhance/status','guardian/auto/status','auto-reroll/status','auto-reroll/options','background/status','background/notice-status','notice/status']);
  async function api(action, body = {}, options = {}) {
    const mutating=!readActions.has(action);if(mutating)S.apiEpoch=(S.apiEpoch||0)+1;
    try {
    const headers = { 'content-type': 'application/json' };
    if(expansion?.revision)headers['X-Monster-Art-Revision']=expansion.revision;
    if (initData) headers['X-Telegram-Init-Data'] = initData; else if (devTg) headers['X-Dev-Tg-Id'] = devTg;
    const selected = S.me && S.me.character && S.me.character.tgId;
    const requestBody = selected && !['characters', 'select', 'meta'].includes(action) ? { ...body, selectedCharacterId: selected } : body;
    const {res,j}=await window.RpgRequest.request(action,requestBody,headers,options).catch(e=>{if(e.uncertain&&selected)void refreshMe({silent:true});throw e;});
    if (!j || !j.ok) { const e = new Error((j && j.message) || `連線失敗（${res.status}）`); e.code = j && j.error; e.status = res.status;
      if (e.code === 'character_changed') { S.me = null; S.choosing = true; setTimeout(openCharacterSelect, 0); }
      throw e; }
    return j;
    }finally{if(mutating)S.apiEpoch=(S.apiEpoch||0)+1;}
  }
  function mutationKey(action, body) {
    const stable = Object.fromEntries(Object.entries(body || {}).filter(([k]) => k !== 'requestId').sort(([a], [b]) => a.localeCompare(b)));
    const owner=action==='create'?String(tg?.initDataUnsafe?.user?.id||devTg||'account'):S.me?.character?.tgId||'account';
    return `elfRpgPending:${owner}:${action}:${JSON.stringify(stable)}`;
  }
  function pendingRequestId(key) {
    try { let value = localStorage.getItem(key); if (!value) { value = rid(); localStorage.setItem(key, value); } return value; }
    catch (_) { return rid(); }
  }
  function clearPendingRequest(key) { try { localStorage.removeItem(key); } catch (_) {} }
  const idleReportWindows = new Map();
  function acceptIdleReport(id, r) {
    if (!r?.ticks || !Number.isFinite(r.from_at) || !Number.isFinite(r.to_at) || r.to_at <= r.from_at) return false;
    const previous = idleReportWindows.get(String(id));
    if (previous !== undefined && r.from_at < previous) return false;
    idleReportWindows.set(String(id), r.to_at);
    if (idleReportWindows.size > 20) idleReportWindows.delete(idleReportWindows.keys().next().value);
    return true;
  }
  function absorb(j,allowCharacterSwitch=false,equipmentTicket) {
    if(!allowCharacterSwitch&&j?.character&&S.me?.character&&S.me.character.tgId!==j.character.tgId)return j;
    if(j?.character&&S.me?.character?.tgId===j.character.tgId&&Number(j.character.revision)<Number(S.me.character.revision))return j;
    if(j?.compact&&j.character)j={...S.me,...j,equipment:S.me?.equipment||[]};
    if(j&&'guardianAuto' in j)setGuardianAuto(j.guardianAuto);
    if(j&&'autoEnhance' in j){S.autoEnhance=j.autoEnhance;autoBanner();operationNotices?.flush();}
    if(j&&'backgroundJobs' in j)setBackground(j.backgroundJobs,j.character?.tgId||S.me?.character?.tgId);
    if (j && j.character) {
      if(S.me?.character&&S.me.character.tgId!==j.character.tgId){S.bossPersonalActor=null;if(S.boss)S.boss={...S.boss,me:undefined};}
      if (S.me?.character && S.me.character.tgId !== j.character.tgId) { S.lastReport=null;S.pending=null;S.session={kills:0,exp:0,gold:0,ticks:0};resetFight(); }
      const acceptedReport = !!j.report?.ticks && acceptIdleReport(j.character.tgId,j.report);
      if (BATTLE) BATTLE.sync(j, acceptedReport ? j.report : null);
      if (acceptedReport) { S.lastReport = j.report; { const r = j.report; const P = S.pending || (S.pending = { ticks: 0, kills: 0, gold_gained: 0, elites: 0, drops: {} }); P.ticks += r.ticks || 0; P.kills += r.kills || 0; P.gold_gained += r.gold_gained || 0; P.elites += r.elites || 0; for (const [k, v] of Object.entries(r.drops || {})) P.drops[k] = (P.drops[k] || 0) + v; } S.session.kills += j.report.kills || 0; S.session.exp += (j.report.exp_gained || 0) - (j.report.exp_lost || 0); S.session.gold += j.report.gold_gained || 0; S.session.ticks += j.report.ticks || 0; }
      const prevState = S.me && S.me.character.state; S.me = j;equipmentSync?.accept(j,equipmentTicket);scheduleEquipmentSync();
      if (prevState && prevState !== j.character.state) resetFight();
    }
    if (j && j.shop) S.shop = j.shop;
    if(j&&'boss' in j){
      const actor=String(S.me?.character?.tgId||''),personal=!!j.boss?.me,same=!!S.boss&&!!j.boss&&S.boss.id===j.boss.id;
      if(personal||!same)S.bossRevision=(S.bossRevision||0)+1;
      if(S.boss&&!j.boss)S.lastBoss=S.boss;
      const keep=same&&!personal&&S.bossPersonalActor===actor?S.boss.me:null;
      S.boss=j.boss?{...j.boss,...(keep?{me:keep}:{})}:null;
      if(personal)S.bossPersonalActor=actor;else if(!same)S.bossPersonalActor=null;
      if(j.now)S.skew=j.now-Date.now();
    }
    return j;
  }
  async function act(action, body = {}, okMsg) {
    if (S.busy) return null; S.busy = true; if(action==='enhance'||action==='reroll')S.forgeError=null;
    const key = mutationKey(action, body);
    try { const j = absorb(await api(action, { ...body, requestId: pendingRequestId(key) }),action==='create'); if((action==='enhance'||action==='reroll')&&!j.result)throw new Error('回應缺少操作結果，請返回裝備確認最新狀態。');clearPendingRequest(key); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(j) : okMsg); if(action!=='enhance'&&action!=='reroll')haptic('ok'); render(); return j; }
    catch (e) { if(action==='enhance'||action==='reroll')S.forgeError=e.message; if (e.code === 'duplicate') { clearPendingRequest(key); await refreshMe(); toast('剛才的操作已完成，資料已更新'); if(action!=='enhance'&&action!=='reroll')haptic('ok'); } else { if (e.status >= 400 && e.status < 500) clearPendingRequest(key); toast(e.message, true); if(action!=='enhance'&&action!=='reroll')haptic('error'); } return null; }
    finally { S.busy = false; }
  }

  // ---------- UI helpers ----------
  let toastT = 0;
  function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4000); }
  let sheetReturnFocus = null;
  let sheetCancel = null;
  let sheetPlaybackCancel = null;
  function sheet(html) {
    if (sheetPlaybackCancel) { sheetPlaybackCancel(); sheetPlaybackCancel = null; }
    const s = $('#sheet'), card = $('.sheet-card', s);
    if (s.hidden) sheetReturnFocus = document.activeElement;
    delete card.dataset.equipmentId;delete card.dataset.equipmentVersion;card.classList.remove('forge-flow-sheet'); card.innerHTML = html; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
    window.RpgInterface?.composeSheet(card);
    card.setAttribute('aria-label', (card.querySelector('h2')?.textContent || '遊戲操作').trim());
    card.tabIndex = -1; card.scrollTop=0; s.hidden = false; $('#app').inert = true; card.querySelectorAll('img').forEach(img=>{img.loading='eager';img.fetchPriority='high';});
    $('.sheet-bg', s).onclick = closeSheet;
    requestAnimationFrame(() => { if (!s.hidden) card.focus({ preventScroll: true }); });
    return card;
  }
  function closeSheet() {
    if (sheetPlaybackCancel) { sheetPlaybackCancel(); sheetPlaybackCancel = null; }
    $('#sheet').hidden = true; $('#app').inert = false;
    if (sheetCancel) { const cancel = sheetCancel; sheetCancel = null; cancel(); }
    if (sheetReturnFocus?.isConnected) sheetReturnFocus.focus({ preventScroll: true });
    sheetReturnFocus = null;
  }
  document.addEventListener('keydown', (e) => {
    if ($('#sheet').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const card = $('.sheet-card'), targets = [...card.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = targets[0], last = targets[targets.length - 1];
    if (!first) { e.preventDefault(); card.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  function confirmSheet(title, body, okText = '確定', danger = false) {
    return new Promise((resolve) => {
      const c = sheet(`<h2>${title}</h2><div>${body}</div><div class="row mt"><button class="btn ghost" data-x="0">取消</button><button class="btn ${danger ? 'red' : ''}" data-x="1">${okText}</button></div>`);
      sheetCancel = () => resolve(false);
      c.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { sheetCancel = null; closeSheet(); resolve(b.dataset.x === '1'); }; });
      $('.sheet-bg').onclick = () => { closeSheet(); resolve(false); };
    });
  }
  const bar = (cls, a, b, label) => `<div class="bar ${cls}"><i style="width:${pct(a, b)}%"></i><b>${label}</b></div>`;
  const itemEmoji = (k) => (S.meta && S.meta.items[k] ? S.meta.items[k].emoji : '📦');
  const itemName = (k) => (S.meta && S.meta.items[k] ? S.meta.items[k].name : k);
  function sumKind(kind) { const inv = (S.me && S.me.inventory) || {}; return Object.entries(inv).filter(([k]) => S.meta.items[k] && S.meta.items[k].kind === kind).reduce((n, [, v]) => n + v, 0); }

  // ---------- canvases + animation loop ----------
  let drawers = [];
  function fitCanvas(c) { const d = Math.min(2, window.devicePixelRatio || 1); const w = c.clientWidth || 300, h = c.clientHeight || 150; if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); } const ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); return { ctx, w, h }; }
  function loop(ts) { const t = ts / 1000; for (const d of drawers) { if (!d.c.isConnected) continue; const { ctx, w, h } = fitCanvas(d.c); ctx.clearRect(0, 0, w, h); d.fn(ctx, w, h, t); } requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  function heroOpts(extra) { const c = S.me ? S.me.character : {}; return { cls: c.baseClass, gender: c.gender, path: c.classPath, ...extra }; }
  function drawPortrait(c, o, animate = true) { if (!c || c.tagName !== 'CANVAS') return; if(o.cls==='thief'){const placeholder=document.createElement('span');placeholder.className=c.className+' muted';placeholder.setAttribute('role','img');placeholder.setAttribute('aria-label','盜賊外觀製作中');placeholder.textContent='🗡️';c.replaceWith(placeholder);return;} if (animate) drawers.push({ c, fn: (ctx, w, h, t) => A.hero(ctx, w / 2, h - 6, h / 95, { ...o, t }) }); else { const { ctx, w, h } = fitCanvas(c); A.hero(ctx, w / 2, h - 6, h / 95, o); } }

  // idle-combat simulation (purely visual; real progress comes from the server's 1-minute idle ticks)
  const F = { mon: null, floats: [], t0: 0, hit: 0, dieAt: 0, heroHurt: 0, monHurt: 0, monActT: -10, act: 'idle', actT: 0, idx: 0 };
  function resetFight() { F.mon = null; F.floats = []; }
  function spawnMon(t) {
    const m = S.meta.maps[S.me.character.mapId] || S.meta.maps[1]; const elite = Math.random() < 0.07;
    const name = m.monsters[(F.idx++) % m.monsters.length];
    F.mon = { name: elite ? m.monsters[m.monsters.length - 1] : name, label: elite ? m.elite : name, elite, born: t, alpha: 0 };
    F.dieAt = 0; F.hit = t + 0.9;
  }
  /** draw an art-v1 sprite (feet at x,y) with idle bob / attack lunge / hurt flash; returns false when no sprite → caller uses art.js */
  function drawSprite(ctx, im, x, y, hgt, { t = 0, action = 'idle', p = 0, flip = false, attackDirection = null, alpha = 1, glow = null, sheet = null } = {}) {
    if (!im) return false;
    const sheetReady = sheet && sheet.image && sheet.image.complete && sheet.image.naturalWidth;
    const frameW = sheetReady ? sheet.image.naturalWidth / sheet.cols : im.width;
    const frameH = sheetReady ? sheet.image.naturalHeight / sheet.rows : im.height;
    const drawH = hgt * (sheetReady ? sheet.heightScale || 1 : 1);
    const wdt = drawH * frameW / frameH;
    const bob = action === 'rest' ? 0 : Math.sin(t * 3) * 1.2; const lunge = action === 'attack' || action === 'cast' ? Math.sin(Math.min(1, p) * Math.PI) * 12 * (attackDirection ?? (flip ? -1 : 1)) : 0;
    const shake = action === 'hurt' ? Math.sin(t * 60) * 2 : 0;
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y, wdt * 0.32, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 16; }
    if (action === 'hurt') ctx.filter = 'brightness(1.8)';
    ctx.translate(x + lunge + shake, y + bob); if (flip) ctx.scale(-1, 1);
    if (sheetReady) {
      const cols = sheet.cols, rows = sheet.rows, total = cols * rows;
      const cellW = sheet.image.naturalWidth / cols, cellH = sheet.image.naturalHeight / rows; let frame = 0;
      if(sheet.folder === 'monster-expansion-20261013') frame=expansion.frame(sheet,action,p,t);
      else if (action === 'attack' || action === 'cast') { const start = action === 'cast' ? sheet.castStart ?? sheet.attackStart ?? 3 : sheet.attackStart ?? 3, count = action === 'cast' ? sheet.castFrames ?? sheet.attackFrames ?? total-start : sheet.attackFrames ?? total - start; frame = start + Math.min(count - 1, Math.floor(Math.max(0, Math.min(0.999, p)) * count)); }
      else if (action === 'hurt') frame = sheet.hurtFrame ?? 2;
      else if (action !== 'rest') frame = (sheet.idleStart ?? 0) + Math.floor(t * 3) % (sheet.idleFrames ?? 3);
      const sx = (frame % cols) * cellW, sy = Math.floor(frame / cols) * cellH;
      ctx.drawImage(sheet.image, sx, sy, cellW, cellH, -wdt / 2, -drawH, wdt, drawH);
    } else ctx.drawImage(im, -wdt / 2, -hgt, wdt, hgt);
    ctx.restore(); return true;
  }
  const heroSprite = () => { const c = S.me && S.me.character; return c ? artImg('sprite', myHeroKey()) : null; };
  const heroAnimSprite = () => { const c = S.me && S.me.character; if (!c) return null; const spec = HERO_ANIM[myHeroKey()]; return spec ? { image: artImg('heroAnim', myHeroKey()), cols: spec.cols, rows: spec.rows, ...(ELF_ADV4_HD[myHeroKey()] ? {heightScale:ELF_ADV4_HD[myHeroKey()].heightScale,attackStart:0,attackFrames:8,castStart:0,castFrames:8,idleFrames:1,hurtFrame:0} : {}), ...(ELF_ADV3_HD[myHeroKey()] ? {heightScale:ELF_ADV3_HD[myHeroKey()].heightScale,attackStart:0,attackFrames:8,castStart:0,castFrames:8,idleFrames:1,hurtFrame:0} : {}), ...(ELF_ADV2_HD[myHeroKey()] ? {heightScale:1.5,attackStart:0,attackFrames:8,castStart:0,castFrames:8,idleFrames:1,hurtFrame:0} : {}), ...(MAGE_ADV2_HD[myHeroKey()] ? {attackStart:0,attackFrames:12,castStart:0,castFrames:12,idleFrames:1,hurtFrame:0} : {}), ...(!ELF_ADV4_HD[myHeroKey()] && SINGLE_ELF4.test(myHeroKey()) ? {heightScale:576/448,attackStart:0,attackFrames:8,idleFrames:1,hurtFrame:0} : {}) } : null; };
  const bossAnimSprite = (mapId) => { const image = artImg('bossAnim', mapId), meta=expansion?.spec(mapId); return image ? meta ? expansion.canvasSpec(image,meta) : { image, cols: 5, rows: 2, idleStart: 9, idleFrames: 1, attackStart: 0, attackFrames: 5, castStart:5, castFrames:3, hurtFrame:image.currentSrc.includes('monsters-clean-20261011')?8:5 } : null; };
  const monsterAnimSprite = (name) => {
    const image = artImg('monsterAnim', name) || artImg('eliteAnim', name);
    const meta=expansion?.spec(name);
    return image ? meta ? expansion.canvasSpec(image,meta) : { image, cols: 5, rows: 2, idleStart: 9, idleFrames: 1, attackStart: 0, attackFrames: 5, castStart:5, castFrames:3, hurtFrame:image.currentSrc.includes('monsters-clean-20261011')?8:5 } : null;
  };
  function float(x, y, text, color, t, size = 16) { F.floats.push({ x, y, text, color, t0: t, size }); if (F.floats.length > 12) F.floats.shift(); }
  function drawStage(ctx, w, h, t) {
    const c = S.me.character; const st = c.state; const town = st === 'town_no_red';
    const scene = window.RpgMaps && window.RpgMaps.get(c.level);
    const bgImg = !town && artImg('map', scene ? window.RpgMaps.key(c.level) : c.mapId);
    if (bgImg) { const s = Math.max(w / bgImg.width, h / bgImg.height); ctx.drawImage(bgImg, (w - bgImg.width * s) / 2, h - bgImg.height * s, bgImg.width * s, bgImg.height * s); }
    else A.scene(ctx, w, h, { mapId: Math.min(4, c.mapId), town, t, scroll: 0 });
    if (!town) window.RpgMapMotion?.paint(ctx,w,h,t,scene?.id,bgImg,1);
    const gy = h * 0.9, hx = w * 0.3;
    if (st === 'reviving') {
      A.hero(ctx, hx, gy, 1.3, heroOpts({ t, action: 'dead' }));   // tombstone stays procedural
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('復活中…', hx, gy - 60);
    } else if (town) {
      if (!drawSprite(ctx, heroSprite(), w * 0.5, gy, 120, { t, action: 'rest' })) A.hero(ctx, w * 0.5, gy, 1.3, heroOpts({ t, action: 'rest' }));
      if (Math.floor(t * 1.2) !== Math.floor((t - 1 / 60) * 1.2)) float(w * 0.5 + 18, gy - 50, 'z', '#fff', t, 14);
    } else if (st === 'gate') {
      if (!drawSprite(ctx, heroSprite(), hx, gy, 120, { t })) A.hero(ctx, hx, gy, 1.3, heroOpts({ t, action: 'idle' }));
      const px = w * 0.72, py = gy - 46; const g = ctx.createRadialGradient(px, py, 4, px, py, 46); g.addColorStop(0, 'rgba(230,210,255,.95)'); g.addColorStop(0.5, 'rgba(140,90,255,.6)'); g.addColorStop(1, 'rgba(80,40,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(px, py, 26 + Math.sin(t * 3) * 3, 44, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd34d'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', hx, gy - 74 + Math.sin(t * 5) * 3);
    } else {
      const slow = st === 'no_mp'; const period = slow ? 1.9 : 1.25;
      if (!F.mon || (F.dieAt && t - F.dieAt > 0.9)) spawnMon(t);
      const mon = F.mon; const map3 = Number(c.mapId) === 3; const map4 = Number(c.mapId) === 4; const mx = w * 0.7 + (map3 ? 38 : map4 ? 26 : 0); mon.alpha = F.dieAt ? Math.max(0, 1 - (t - F.dieAt) / 0.6) : Math.min(1, (t - mon.born) / 0.4);
      if (!F.dieAt && t >= F.hit) {
        const skill = !slow && Math.random() < 0.3; F.act = skill ? 'cast' : 'attack'; F.actT = t; F.hit = t + period;
        // Idle settlement has no per-hit timeline: movement is illustrative, numbers come only from the report.
        F.monHurt = t + 0.18;
        if (t - mon.born > 8) F.dieAt = t + 0.2;
        else if (Math.random() < 0.35) { F.heroHurt = t + 0.5; F.monActT = t; }
      }
      const p = (t - F.actT) / 0.35; const action = t < F.heroHurt && t > F.heroHurt - 0.2 ? 'hurt' : p < 1 ? F.act : 'idle';
      if (!drawSprite(ctx, heroSprite(), hx, gy, 120, { t, action, p: Math.max(0, p), sheet: heroAnimSprite() })) A.hero(ctx, hx, gy, 1.3, heroOpts({ t, action, p: Math.max(0, p) }));
      if (F.act === 'cast' && p < 1) {
        const q = Math.max(0, Math.min(1, p)); const cx = hx + (mx - hx) * Math.min(1, q * 1.35), cy = gy - 46 - Math.sin(q * Math.PI) * 20;
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 22); g.addColorStop(0, 'rgba(255,250,210,.95)'); g.addColorStop(.35, 'rgba(135,205,255,.8)'); g.addColorStop(1, 'rgba(85,90,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 22 * (0.45 + q * 0.55), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(222,236,255,${0.8 * (1 - q)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, gy - 28, 18 + 32 * q, -Math.PI * .8, Math.PI * .8); ctx.stroke();
      }
      const monP = (t - F.monActT) / 0.36; const monAction = t < F.monHurt ? 'hurt' : monP >= 0 && monP < 1 ? 'attack' : 'idle';
      const monSpriteName = mon.elite ? mon.label : mon.name; const monKind = mon.elite ? 'elite' : 'monster';
      const monImage = artImg(monKind, monSpriteName) || artImg('monster', mon.name);
      const cleanMonster = monImage?.currentSrc.includes('monsters-clean-20261011') || !!expansion?.spec(monSpriteName);
      const monSheet = monsterAnimSprite(monSpriteName);
      const heroBounds = window.RpgBattle?.visibleBounds(heroSprite()) || [0,0,1,1];
      const monBounds = window.RpgBattle?.visibleBounds(monImage) || [0,0,1,1];
      const monLayout = monSheet?.image ? window.RpgBattle?.layout[monSheet.image.currentSrc.split('/').at(-1).split('?')[0]] : null;
      const heroVisibleHeight = 120*(heroBounds[3]-heroBounds[1]);
      const monHeight = expansion?.spec(monSpriteName) ? heroVisibleHeight*(mon.elite?1.2:1.12)/Math.max(.1,monLayout?.bodyHeight || monBounds[3]-monBounds[1]) : Math.min(heroVisibleHeight*(mon.elite?1.2:1.12)/Math.max(.1,monLayout?.bodyHeight || monBounds[3]-monBounds[1]),heroVisibleHeight*(mon.elite?1.4:1.3)/Math.max(.1,monBounds[2]-monBounds[0]));
      const monY = gy-120*(1-heroBounds[3])+monHeight*(1-(monLayout?.feet ?? monBounds[3]));
      const monRatio = monSheet?.image.naturalWidth ? monSheet.image.naturalWidth/monSheet.cols/(monSheet.image.naturalHeight/monSheet.rows) : monImage ? monImage.width/monImage.height : 1;
      const monX = Math.min(w*.7,w-monHeight*monRatio/2-8);
      if (!drawSprite(ctx, monImage, monX, monY, monHeight, { t, action: monAction, p: Math.max(0, monP), attackDirection:-1, flip: [1,3].includes(Number(c.mapId)) && !cleanMonster || mon.name === '哈耳庇厄', alpha: mon.alpha, glow: mon.elite ? '#ff3b3b' : mon.name === '哈耳庇厄' && monAction === 'attack' ? '#8fe8ff' : null, sheet: monSheet }))
        A.monster(ctx, mx, gy, 1.3, { name: mon.name, elite: mon.elite, t, hurt: t < F.monHurt, alpha: mon.alpha });
      if (!F.dieAt) { ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(mon.label, mx, gy - 80); }
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,235,191,.8)'; ctx.font = '11px sans-serif'; ctx.fillText('戰鬥演出 · 收益依冒險結算', 10, 18);
    ctx.textAlign = 'center';
    F.floats = F.floats.filter((f) => t - f.t0 < 1.1);
    for (const f of F.floats) { const k = (t - f.t0) / 1.1; if (k < 0) continue; ctx.globalAlpha = 1 - k; ctx.font = `900 ${f.size}px ${ART ? (getComputedStyle(document.documentElement).getPropertyValue('--f-num') || 'serif') : 'sans-serif'}`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(f.text, f.x, f.y - k * 34); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - k * 34); ctx.globalAlpha = 1; }
  }

  // ---------- header + nav ----------
  function renderHud() {
    const hud = $('#hud'), nav = $('#nav');
    if (!S.me || S.choosing || S.creating) { hud.hidden = true; nav.hidden = true; return; }
    const c = S.me.character; hud.hidden = false; nav.hidden = false;
    hud.innerHTML = `<div class="my-hud-crest" title="${esc(c.baseClassName||c.className)}">${['sword','archer','mage'].includes(c.baseClass)?`<img src="art/ui/hud-race-${c.baseClass}-v2.webp" alt="${esc(c.baseClassName||c.className)}圖徽">`:`<span role="img" aria-label="${esc(c.baseClassName||c.className)}圖徽">${esc(S.meta.classes[c.baseClass]?.emoji||'✦')}</span>`}</div><div class="who"><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.className)} · Lv.${c.level}${c.baseClass==='thief'?' · 近戰・極速・脆皮':''}</div></div>
      <div class="hud-actions"><span class="chip gold" aria-label="金幣 ${fmt(c.gold)}"><img class="hud-coin" src="art/ui/hud-coin-v2.webp" alt="" aria-hidden="true"> ${fmt(c.gold)}</span><button class="char-switch" id="charSwitch" aria-label="選擇角色或登出">選角 ▾</button></div>`;
    $('#charSwitch').onclick = openCharacterSelect;
    nav.querySelectorAll('button').forEach((b) => {
      if (b.hasAttribute('data-logout')) {
        b.classList.remove('on', 'dot');
        b.onclick = () => { haptic('light'); openCharacterSelect(); };
        return;
      }
      const currentTab=S.tab==='guardian'?'home':S.tab;
      b.classList.toggle('on', b.dataset.tab === currentTab);
      const titles = { home: '遠征', bag: '英雄', shop: '市集', boss: '神戰', trade: '集會', class: '傳承' };
      const label = b.querySelector('small'); if (label && titles[b.dataset.tab]) label.textContent = titles[b.dataset.tab];
      if (b.dataset.tab === currentTab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      b.classList.toggle('dot', (b.dataset.tab === 'boss' && !!(S.me.boss && S.me.boss.status === 'active')) || (b.dataset.tab === 'class' && S.me.gate.canAdvance) || (b.dataset.tab === 'home' && !S.me.daily.claimed));
      const bd = S.me.badges || {}; const n = b.dataset.tab === 'trade' ? (bd.requests || 0) + (bd.challenges || 0) + (bd.trades || 0) : 0;
      let cnt = b.querySelector('.nb'); if (n) { if (!cnt) { cnt = document.createElement('b'); cnt.className = 'nb'; b.appendChild(cnt); } cnt.textContent = n > 9 ? '9+' : String(n); } else if (cnt) cnt.remove();
      b.onclick = () => { if (S.tab === b.dataset.tab) return; S.tab = b.dataset.tab;if(S.tab==='trade'&&S.social==='hall'){S.hallClass='all';S.hallPage=1;} haptic('light'); render(); window.scrollTo({ top: 0, behavior: 'instant' }); load(S.tab); };
    });
  }

  // ---------- screens ----------
  function stateInfo(me) {
    const c = me.character, g = me.gate;
    switch (c.state) {
      case 'fighting': return { cls: '', text: '⚔️ 自動戰鬥中' };
      case 'no_mp': return { cls: 'warn', text: '💙 沒藍水：只用普攻（較慢）' };
      case 'town_no_red': return { cls: 'warn', text: '🏠 沒紅水：回城休息，暫停練功' };
      case 'reviving': return { cls: 'warn', text: `🪦 死亡復活中${c.stateUntil ? ` · ${mmss(c.stateUntil - Date.now() - 0)}` : ''}` };
      case 'gate': return { cls: 'gate', text: `🔒 等轉職：Lv.${g.gateLevel} 需要「${g.materialName}」` };
      default: return { cls: '', text: c.state };
    }
  }
  function potionChoiceHtml(kind,key,name,count,hours,other){
    const c=S.me.character,field=kind==='red'?'autoRedPotion':'autoBluePotion',label=kind==='red'?'生命藥水':'魔力藥水',stat=kind==='red'?'HP':'MP',options=S.me.supply?.[kind+'Options']||[];
    return `<div class="pot supply-choice"><div class="supply-choice-top"><span class="ic">${iconHtml(key,'🧪')}</span><div class="supply-choice-info"><span class="supply-choice-label">${label}</span><div class="n">${fmt(count)} <small>瓶</small></div><div class="h">${esc(name)} · ${stat} +${fmt(S.meta.items[key]?.heal||0)}</div></div></div><label class="supply-choice-select">自動飲用種類<select data-potion-kind="${kind}" aria-label="${label}種類"><option value="auto" ${c[field]==='auto'||!c[field]?'selected':''}>自動選擇（依等級與庫存）</option>${options.map(p=>`<option value="${p.key}" ${c[field]===p.key?'selected':''} ${!p.unlocked&&!p.count?'disabled':''}>${esc(p.name)} · ${stat} +${p.heal} · 持有 ${fmt(p.count)}${!p.unlocked&&!p.count?'（尚未解鎖）':''}</option>`).join('')}</select></label><div class="h supply-choice-hours">預估約 ${hours} 小時${other?` · 其他種類 ${fmt(other)} 瓶`:''}</div></div>`;
  }
  function homeView() {
    const me = S.me, c = me.character, st = me.stats, si = stateInfo(me);
    const scene = window.RpgMaps && window.RpgMaps.get(c.level);
    const mapLabel = scene ? `${scene.emoji} ${scene.name}` : c.mapName;
    const red = sumKind('red'), blue = sumKind('blue');
    const sp = me.supply || {}; const redKey = sp.redKey || 'red_1', blueKey = sp.blueKey || 'blue_1';
    const redName = (S.meta.items[redKey] || {}).name || '紅水', blueName = (S.meta.items[blueKey] || {}).name || '藍水';
    const redTier = (S.me.inventory || {})[redKey] || 0, blueTier = (S.me.inventory || {})[blueKey] || 0;
    const redOther = Math.max(0, red - redTier), blueOther = Math.max(0, blue - blueTier);
    const g = me.gate; const r = S.lastReport;
    const used = r ? Object.entries(r.used || {}).map(([k, v]) => `${itemEmoji(k)}${itemName(k)}×${fmt(v)}`).join('、') : '';
    const drops = r ? Object.entries(r.drops || {}).map(([k, v]) => `${itemEmoji(k)}${itemName(k)}×${v}`).join('、') : '';
    return `
    <div class="lc-adventure"><div class="lc-topline"><span>✦ ADVENTURE ✦</span><span>${esc(mapLabel)}</span></div>
    <div class="card lc-profile"><div class="hero">${portraitHtml('pt')}<div class="info">
      <div class="cls">${esc(c.className)} <span class="lv">Lv.${c.level}${c.classPath ? ` · ${esc(c.baseClassName)}系` : ''}</span></div>
      ${bar('hp', c.hp, c.maxHp, `HP ${fmt(c.hp)} / ${fmt(c.maxHp)}`)}
      ${bar('mp', c.mp, c.maxMp, `MP ${fmt(c.mp)} / ${fmt(c.maxMp)}`)}
      ${bar('exp', c.expPct, 100, c.expNeed ? `EXP ${c.expPct}%` : 'EXP MAX')}
    </div></div></div>
    <div class="lc-battle-shell"><div class="lc-battle-head"><span>⚔ 狩獵戰場</span><span>${si.text}</span></div>
    ${BATTLE ? '<div id="bslot"></div>' : `<div class="stage"><canvas id="stage"></canvas><div class="status ${si.cls}" id="stStatus">${si.text}</div><div class="mapname">${esc(mapLabel)}</div></div>`}
    </div></div>
    ${todoHtml()}
    ${c.state === 'gate' || g.canAdvance ? `<div class="banner gate"><span class="e">✨</span><div style="flex:1"><b>${g.canAdvance ? '可以轉職了！' : '卡在轉職門檻'}</b><br>${esc(g.materialName)}：${g.have} / 1${g.canAdvance ? '' : ' · 擊敗首領取得'}</div><button class="btn sm gold" data-go="class">轉職</button></div>` : ''}
    ${c.state === 'town_no_red' ? `<div class="banner warn"><span class="e">🧪</span><div style="flex:1"><b>目前選用的生命藥水已用完</b><br>補水後會自動回到 ${esc(mapLabel)}</div></div>` : ''}
    <div class="card"><h3>🧪 補給 <small>自動喝${esc(redName)} ≤ ${c.autoRedPct}%</small></h3>
      <div class="grid2 supply-choices">${potionChoiceHtml('red',redKey,redName,redTier,me.supply.redHours,redOther)}${potionChoiceHtml('blue',blueKey,blueName,blueTier,me.supply.blueHours,blueOther)}</div>
      <p class="muted supply-choice-note">指定種類後只會喝該藥水；用完請補給或切換種類。補滿 24 小時會購買目前所選藥水。</p>
      <div class="row mt"><button class="btn" id="refill" ${me.refill.cost > 0 ? '' : 'disabled'}>${me.refill.cost > 0 ? `🧪 補滿 24 小時（${esc(redName)}／${esc(blueName)}）· 💰${fmt(me.refill.cost)}` : '✅ 水量充足（24h）'}</button></div>
      ${c.level>=15?'<label class="guardian-refill-check"><input type="checkbox" id="refillGuardian" '+(me.guardianStoneSupply?'checked':'')+'> '+iconHtml('guardian_summon_stone','✦')+' 召喚石自動補給 · 持有 '+(me.guardianSupply?.stoneCount||0)+' 顆<span>用完自動購買 · 每顆 '+fmt(me.guardianSupply?.stoneGold||3000)+' 金幣</span></label>':''}
      <div class="mt muted">自動喝${esc(redName)}：HP 低於或等於設定比例時使用</div><div class="seg" id="redSeg">${[30, 40, 50, 60, 70].map((v) => `<button data-v="${v}" class="${c.autoRedPct === v ? 'on' : ''}">${v}%</button>`).join('')}</div>
      <div class="mt row" style="justify-content:space-between"><span class="muted" style="flex:1">自動喝${esc(blueName)}：MP 低於或等於設定比例時使用</span><div class="seg" style="flex:none"><button id="blueTog" class="${c.autoBlue ? 'on' : ''}">${c.autoBlue ? '開' : '關'}</button></div></div>
      <div class="seg" id="blueSeg">${[30,40,50,60,70].map(v=>`<button data-v="${v}" class="${(c.autoBluePct??50)===v?'on':''}" ${c.autoBlue?'':'disabled'}>${v}%</button>`).join('')}</div><div class="muted mt">技能 MP 不足時也會先補水；特殊技能仍依安全／強力模式與每日預算使用。</div>
    </div>
    <div class="card my-daily-blessing"><div class="blessing-heading"><h3>每日補給金</h3><small>${me.daily.firstWeek ? '首週加成 +50%' : '每天 00:00 重置'}</small></div><div class="blessing-reward"><span class="blessing-seal" aria-hidden="true"><img src="art/ui/hud-coin-v2.webp" alt=""></span><div><span class="blessing-caption">諸神賜予的遠征祝福</span><strong>${fmt(me.daily.total)} <small>金幣</small></strong><span class="blessing-note">${me.daily.bonus ? `包含首週額外 ${fmt(me.daily.bonus)} 金幣` : '每日領取，為下一場遠征做好準備'}</span></div></div>
      <button class="btn gold" id="daily" ${me.daily.claimed ? 'disabled' : ''}>${me.daily.claimed ? '今日祝福已領取' : '領取每日祝福'}<span aria-hidden="true">${me.daily.claimed ? '✓' : '→'}</span></button></div>
    <div class="card"><h3>📜 戰報 <small>開啟以來：擊殺 ${fmt(S.session.kills)} · EXP ${fmt(S.session.exp)} · 💰${fmt(S.session.gold)}</small></h3>
      ${r ? `<div class="log"><div>⏱️ 結算 ${r.ticks} 分鐘${r.skipped_ticks ? `（${r.skipped_ticks} 分鐘停滯）` : ''}</div><div>⚔️ 擊殺 ${fmt(r.kills)}${r.elites ? `（精英 ${r.elites}）` : ''} · ✨ EXP +${fmt(r.exp_gained)}${r.exp_lost ? ` / −${fmt(r.exp_lost)}` : ''}</div>
        <div>💰 金幣 +${fmt(r.gold_gained)}${r.gold_elites ? `（打怪 ${fmt(r.gold_kills || 0)}・菁英 ${fmt(r.gold_elites)}）` : ''}${r.levels_gained ? ` · 🎉 升了 ${r.levels_gained} 級` : ''}${r.deaths ? ` · 🪦 死亡 ${r.deaths}` : ''}${r.wards_used ? ` · 🧿 守護符 ${r.wards_used}` : ''}</div>
        ${used ? `<div>🧪 消耗：${used}</div>` : ''}${drops ? `<div>🎁 掉落：${drops}</div>` : ''}</div>` : '<div class="muted">掛機每分鐘結算一次，開著畫面會自動更新戰報。</div>'}
      <h3 class="mt">🧾 最近紀錄</h3><div class="log" id="ledger">${ledgerHtml()}</div></div>
    <div class="card"><h3>📊 能力</h3><div class="stats"><div><b>${fmt(st.atk)}</b><span>攻擊</span></div><div><b>${fmt(st.def)}</b><span>防禦</span></div><div><b>${fmt(st.power)}</b><span>戰力</span></div><div><b>${fmt(st.standard)}</b><span>地圖推薦</span></div></div>
      <div class="mt muted">技能「${esc(st.skill.name)}」MP ${st.skill.cost} · ×${st.skill.mult}${st.skill.targets > 1 ? ` · ${st.skill.targets} 目標` : ''}　被動：${esc(st.passive)}</div></div>`;
  }
  const ledgerIcon = (k) => { const h = iconHtml(k, itemEmoji(k)); return String(h).startsWith('<img') ? h.replace('<img ', '<img style="width:18px;height:18px;object-fit:contain;vertical-align:-4px;margin-right:2px" ') + ' ' : h; };
  function ledgerHtml() {
    if (!S.ledger) return '<div class="muted">載入中…</div>';
    if (!S.ledger.length) return '<div class="muted">還沒有紀錄</div>';
    return S.ledger.map((l) => { const d = new Date(l.created_at + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
      const parts = [l.gold_delta ? `💰${l.gold_delta > 0 ? '+' : ''}${fmt(l.gold_delta)}` : '', l.item && String(l.item).startsWith('sigil:') ? `🪶 守護羽毛 ${l.item_delta > 0 ? '+' : ''}${l.item_delta}` : l.item && !String(l.item).startsWith('equip:') ? `${ledgerIcon(l.item)}${l.item_delta > 0 ? '+' : ''}${l.item_delta}` : ''].filter(Boolean).join(' ');
      let note = l.note || ''; if (note.startsWith('{') || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note)) note = '';
      return `<div><span class="muted">${d}</span> ${esc(l.type)} ${parts} <span class="muted">${esc(note)}</span></div>`; }).join('');
  }
  function openGuardian(initialView='overview'){S.guardianInitialView=['overview','summon','inventory','fuse','guide'].includes(initialView)?initialView:'overview';S.tab='guardian';render();}
  function bindHome(view) {
    const guardianEntry=view.querySelector('[data-guardian-entry]');if(guardianEntry)guardianEntry.onclick=openGuardian;
    drawPortrait($('#pt', view), heroOpts({}));
    if (BATTLE) BATTLE.attach($('#bslot', view)); else drawers.push({ c: $('#stage', view), fn: drawStage });
    const supplyToggle=$('#refillGuardian',view);if(supplyToggle)supplyToggle.onchange=async()=>{const checked=supplyToggle.checked;supplyToggle.disabled=true;try{await api('guardian/assist',{mode:'supply',autoBuy:checked,requestId:window.RpgGuardianHost.requestId()});await refreshMe();window.dispatchEvent(new Event('elf-skills-refresh'));toast(checked?'已允許召喚石用完自動購買，每顆3,000金幣':'已關閉召喚石自動購買，背包石頭用完就停止召喚');}catch(e){supplyToggle.checked=!checked;toast(e.message);}finally{supplyToggle.disabled=false;}};
    view.querySelectorAll('[data-potion-kind]').forEach(select=>{select.onchange=async()=>{const field=select.dataset.potionKind==='red'?'autoRedPotion':'autoBluePotion',value=select.value;select.disabled=true;try{const j=await act('settings',{[field]:value},value==='auto'?'已改為自動選擇藥水':'已設定自動飲用：'+itemName(value));if(!j){select.value=S.me.character[field]||'auto';select.disabled=false;}}catch{select.value=S.me.character[field]||'auto';select.disabled=false;}};});
    $('#refill', view).onclick = () => act('refill', {}, (j) => '已補水，花費 '+fmt(j.result?.cost)+' 金幣');
    view.querySelectorAll('#redSeg button').forEach((b) => { b.onclick = () => act('settings', { autoRedPct: Number(b.dataset.v) }, `HP ≤ ${b.dataset.v}% 自動喝紅水`); });
    view.querySelectorAll('#blueSeg button').forEach(b=>{b.onclick=()=>act('settings',{autoBluePct:Number(b.dataset.v)},`MP ≤ ${b.dataset.v}% 自動喝藍水`);});
    $('#blueTog', view).onclick = () => act('settings', { autoBlue: !S.me.character.autoBlue }, (j) => (j.character.autoBlue ? '已開啟自動藍水' : '已關閉自動藍水（MP 不足時改用普攻）'));
    view.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.go; render(); }; });
    bindTodo(view);
  }
  // ---------- v0.5.1「現在可以做」: every visit shows what to spend gold / time on ----------
  const RAR_ORDER = ['common', 'advanced', 'epic', 'legendary', 'supreme'];
  const scrollPrice = (k) => (S.meta.items[k] && S.meta.items[k].price) || (S.shop && (S.shop.items.find((x) => x.item === k) || {}).price) || { scroll_w: 75, scroll_a: 50, scroll_r: 60 }[k] || 0;
  /** what an enhance/reroll attempt needs right now: scrolls owned, missing, gold to buy the rest, affordable? */
  function attemptCost(e, scroll) {
    const have = S.me.inventory[scroll] || 0; const miss = Math.max(0, e.scrollCost - have); const gold = miss * scrollPrice(scroll);
    return { have, miss, gold, ok: gold <= S.me.character.gold };
  }
  function todoList() {
    const me = S.me, c = me.character, out = [], bd = me.badges || {}; const r = S.pending;   // everything earned since the last 收下 (incl. the offline settlement on open)
    if (r && r.ticks && (r.gold_gained || Object.keys(r.drops || {}).length)) {
      const dr = Object.entries(r.drops || {}).map(([k, v]) => `${itemEmoji(k)}×${v}`).join(' ');
      out.push({ k: 'collect', ic: '🎁', t: `掛機收穫 💰+${fmt(r.gold_gained)}${dr ? ` ${dr}` : ''}`, s: `${r.ticks >= 120 ? `${Math.round(r.ticks / 6) / 10} 小時` : `${r.ticks} 分鐘`} · 擊殺 ${fmt(r.kills)}${r.elites ? ` · 菁英 ${r.elites}` : ''}`, b: '收下', cls: 'gold' });
    }
    if (!me.daily.claimed) out.push({ k: 'daily', ic: '<img class="daily-coin-icon" src="art/ui/hud-coin-v2.webp" alt="">', t: `每日補給金 ${fmt(me.daily.total)}`, s: me.daily.firstWeek ? '首週 +50%' : '每天 00:00 重置', b: '領取', cls: 'gold' });
    if (me.gate && me.gate.canAdvance) out.push({ k: 'go:class', ic: '✨', t: '可以轉職了！', s: `${me.gate.materialName} 已到手`, b: '轉職', cls: 'gold' });
    const nReq = (bd.requests || 0) + (bd.trades || 0) + (bd.challenges || 0);
    if (nReq) out.push({ k: 'go:trade', ic: '🤝', t: `${nReq} 個交易／決鬥等你回覆`, s: [bd.requests ? `交易請求 ${bd.requests}` : '', bd.trades ? `交易視窗 ${bd.trades}` : '', bd.challenges ? `決鬥 ${bd.challenges}` : ''].filter(Boolean).join(' · '), b: '查看' });
    if (me.refill.cost > 0 && me.supply.redHours < 8) out.push({ k: 'refill', ic: '🧪', t: `水只剩約 ${me.supply.redHours} 小時`, s: `補滿 24h 💰${fmt(me.refill.cost)}`, b: '補水' });
    // safe enhancement first (no break chance), highest tier / lowest + first
    const eq = me.equipment.filter((e) => e.equipped && e.enhanceNext && !e.inTrade);
    const safe = eq.filter((e) => !e.enhanceNext.break).map((e) => ({ e, a: attemptCost(e, e.scroll) })).filter((x) => x.a.ok).sort((x, y) => y.e.tier - x.e.tier || x.e.enhance - y.e.enhance || x.a.gold - y.a.gold);
    if (safe.length) { const { e, a } = safe[0];
      out.push({ k: `item:${e.id}`, ic: '⚒️', t: `可強化 +${e.enhance + 1}：${e.name}`, s: `安全 · 成功 ${Math.round(e.enhanceNext.success * 100)}% · ${a.miss ? `買捲 💰${fmt(a.gold)}` : `捲軸 ${a.have}/${e.scrollCost}`}${safe.length > 1 ? ` · 還有 ${safe.length - 1} 件可強化` : ''}`, b: '強化', cls: 'green' }); }
    const rr = eq.map((e) => ({ e, a: attemptCost(e, 'scroll_r') })).filter((x) => x.a.ok && RAR_ORDER.indexOf(x.e.rarity) < 3).sort((x, y) => RAR_ORDER.indexOf(x.e.rarity) - RAR_ORDER.indexOf(y.e.rarity) || y.e.tier - x.e.tier);
    if (rr.length) { const { e, a } = rr[0]; out.push({ k: `item:${e.id}`, ic: '🎲', t: `洗屬性：${e.name}（${e.rarityName}）`, s: `追極品／傳說 · ${a.miss ? `買捲 💰${fmt(a.gold)}` : `捲軸 ${a.have}/${e.scrollCost}`}`, b: '洗' }); }
    if (S.shop) { // a better shop piece for a slot you can afford now
      const best = {}; for (const e of me.equipment.filter((x) => x.equipped)) best[e.slot] = Math.max(best[e.slot] || 0, e.tier);
      const up = S.shop.gear.filter((o) => o.levelReq <= c.level && o.price <= c.gold && o.tier > (best[o.slot] || 0)).sort((a, b) => b.tier - a.tier || a.price - b.price);
      if (up.length) out.push({ k: 'go:shop', ic: '🛒', t: `買得起：${up[0].name}（T${up[0].tier}）`, s: `💰${fmt(up[0].price)}${up.length > 1 ? ` · 共 ${up.length} 件升級` : ''}`, b: '商店' });
    }
    if (S.boss && S.boss.status === 'active') out.push({ k: 'go:boss', ic: '👹', t: `首領出現中：${S.boss.name || '地圖首領'}`, s: '每 3 分鐘可攻擊一次', b: '去打', cls: 'red' });
    else if (me.nextBoss) out.push({ k: 'go:boss', ic: '⏰', t: `下一隻首領 ${String(me.nextBoss.hour).padStart(2, '0')}:00`, s: `<span id="todoCd">${mmss(me.nextBoss.start - sNow())}</span> 後出現`, b: '看看' });
    return out;
  }
  function commandIcon(t){
    let src='art/ui/hud-coin-v2.webp';
    if(t.k==='collect')src='art/ui/command-collect-20261012.webp';
    else if(t.k==='go:shop')src='art/ui/command-shop-20261012.webp';
    else if(t.k==='go:boss')src='art/ui/command-boss_time-20261012.webp';
    else if(t.k==='go:trade')src='art/ui/command-trade-20261012.webp';
    else if(t.k==='go:class')src='art/ui/item-boss_essence-20261012.webp';
    else if(t.k==='refill')src='art/potions-20261019/red_1.webp';
    else if(t.k.startsWith('item:')){const e=S.me.equipment.find(x=>x.id===t.k.slice(5));src='art/items-scrolls-cutout-20261011/'+(t.b==='洗'?'scroll_r':e?.scroll||'scroll_w')+'.webp';}
    return '<img class="command-icon" src="'+src+'" alt="" aria-hidden="true" decoding="async">';
  }
  function todoHtml() {
    const list = todoList();
    return `<div class="card todo my-command-board"><div class="command-heading"><div><span class="command-kicker">HERMES · 遠征指引</span><h3>現在可以做</h3></div><small class="command-balance"><img class="daily-coin-icon" src="art/ui/hud-coin-v2.webp" alt="金幣"> ${fmt(S.me.character.gold)}</small></div>${list.length ? list.slice(0, 6).map((t, i) => `<div class="todo-row" data-todo="${i}"><span class="ti">${commandIcon(t)}</span><div class="tm"><b>${esc(t.t)}</b><small>${t.s}</small></div><button class="btn sm ${t.cls || ''}">${t.b}</button></div>`).join('') : '<div class="muted">都處理好了，安心掛機 ☕</div>'}</div>`;
  }
  function bindTodo(view) {
    if (!S.shop && !S.shopLoading) { S.shopLoading = true; api('shop').then((j) => { absorb(j); if (S.tab === 'home' && $('#sheet').hidden) render(); }).catch(() => {}); }
    const list = todoList();
    view.querySelectorAll('[data-todo]').forEach((row) => { row.onclick = () => {
      const t = list[Number(row.dataset.todo)]; if (!t) return; haptic('light');
      if (t.k === 'collect') {
        // Idle rewards are credited by the server when it settles the report. The
        // collect button acknowledges that report; animate the already-credited
        // amount into the HUD instead of issuing a second gold mutation.
        const reward = Math.max(0, Number(S.pending && S.pending.gold_gained) || 0);
        const total = Math.max(0, Number(S.me && S.me.character && S.me.character.gold) || 0);
        S.pending = null; collectFx(row, reward, total); setTimeout(render, 700); return;
      }
      if (t.k === 'daily') return act('daily', {}, (j) => `💰 領到 ${fmt(j.result && j.result.gold)} 金幣`);
      if (t.k === 'refill') return act('refill', {}, (j) => `🧪 已補水，花費 💰${fmt(j.result && j.result.cost)}`);
      if (t.k.startsWith('go:')) { S.tab = t.k.slice(3); render(); return; }
      if (t.k.startsWith('item:')) return itemSheet(t.k.slice(5));
    }; });
  }
  /** coins fly from the row to the gold chip */
  function collectFx(row, reward = 0, total = 0) {
    const from = row.getBoundingClientRect(); const chip = $('#hud .chip') || $('#hud'); const to = chip ? chip.getBoundingClientRect() : { left: innerWidth - 60, top: 10, width: 40, height: 20 };
    for (let i = 0; i < 10; i++) { const c = document.createElement('span'); c.className = 'coinfly'; c.textContent = '🪙';
      c.style.left = `${from.left + 24 + Math.random() * 40}px`; c.style.top = `${from.top + from.height / 2}px`;
      c.style.setProperty('--dx', `${to.left + to.width / 2 - from.left - 40}px`); c.style.setProperty('--dy', `${to.top + to.height / 2 - from.top - from.height / 2}px`);
      c.style.animationDelay = `${i * 40}ms`; document.body.appendChild(c); setTimeout(() => c.remove(), 1100); }
    if (chip && reward > 0) {
      const start = Math.max(0, total - reward), startedAt = performance.now(), duration = 700;
      const countUp = (now) => {
        if (!chip.isConnected) return;
        const p = Math.min(1, (now - startedAt) / duration);
        chip.textContent = `💰 ${fmt(Math.round(start + (total - start) * p))}`;
        if (p < 1) requestAnimationFrame(countUp);
      };
      chip.textContent = `💰 ${fmt(start)}`; requestAnimationFrame(countUp);
      toast(`掛機金幣 +${fmt(reward)} 已入帳`);
    }
    haptic('ok');
  }
  // ---------- v0.5.1 強化／洗屬性 reveal (quick loop: buy missing scrolls → attempt → reveal → 再一次) ----------
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let forgeSession=0;
  const autoReasons={target:'願望成真 · 已達目標',break:'裝備破碎 · 淬鍊結束',resources:'資源不足 · 已停止',stopped:'已停止強化',party:'組隊戰鬥 · 已停止',busy:'裝備狀態改變 · 已停止',missing:'找不到裝備 · 已停止'};
  function autoBanner(){const old=$('#auto-forge-banner');if(old){old.hidden=true;old.style.display='none';}backgroundWorkshop?.render(S.backgroundJobs||[]);}
  function guardianAutoBanner(){const old=$('#guardian-auto-banner');if(old)old.hidden=true;backgroundWorkshop?.render(S.backgroundJobs||[]);}
  function autoPanel(){const j=S.autoEnhance;if(!j)return;window.RpgForgeRitual?.dispose?.();let ov=$('#forge');if(!ov){ov=document.createElement('div');ov.id='forge';document.body.append(ov);}ov.className='forge enhance';ov.hidden=false;$('#app').inert=true;
    ov.innerHTML=`<div class="fg-box"><div class="fg-t">${j.status==='running'?'🔨 背景淬鍊中':autoReasons[j.reason]||'淬鍊結束'}</div><div class="fg-r"><b class="big">${j.status==='running'?'+'+j.level+' → +'+j.target:'+'+j.level}</b><p>${esc(j.itemName)}</p></div><div class="fg-s" aria-live="polite">已強化 ${j.attempts} 次<br>卷軸 ${j.spentScrolls} 張 · 補購金幣 ${fmt(j.spentGold)}<p class="muted">${j.status==='running'?'關閉遊戲也會繼續；約每 3 秒強化一次。結束後由 BOT 私訊通知。':'本次淬鍊已結束，可返回查看最新裝備。'}</p></div><div class="fg-b"><button class="btn ghost" data-auto-back>返回冒險</button>${j.status==='running'?'<button class="btn red" data-auto-stop>停止強化</button>':'<button class="btn gold" data-auto-done>完成</button>'}</div></div>`;
    const close=()=>{if(j.status!=='running'){S.dismissAuto=j.id;backgroundWorkshop?.dismiss(autoNotice(j));autoBanner();}ov.hidden=true;$('#app').inert=false;void refreshMe({silent:true,full:true});};ov.querySelector('[data-auto-back]').onclick=close;
    const done=ov.querySelector('[data-auto-done]');if(done)done.onclick=()=>{S.dismissAuto=j.id;autoBanner();close();};
    const stop=ov.querySelector('[data-auto-stop]');if(stop)stop.onclick=async()=>{stop.disabled=true;try{S.autoEnhance=(await api('auto-enhance/stop',{jobId:j.id})).job;autoBanner();autoPanel();}catch(e){toast(e.message,true);stop.disabled=false;}};
  }
  async function startAuto(e,blessed,target){const j=await api('auto-enhance/start',{itemId:e.id,blessed,target});S.autoEnhance=j.job;S.dismissAuto=null;await syncBackground().catch(()=>{});autoPanel();return j;}
  let autoPollBusy=false,autoPollAt=0;
  setInterval(async()=>{const viewing=equipmentSync?.pending(S.me?.character?.tgId)||S.tab==='bag'||!!$('.sheet-card')?.dataset.equipmentId||!$('#forge')?.hidden&&$('#forge')?.querySelector('[data-auto-back]')||window.RpgAutoRerollUI?.viewing()||S.tab==='guardian'&&!S.choosing&&!S.creating&&S.guardianAuto?.status==='running';if(document.hidden||!S.me||autoPollBusy||!((S.backgroundJobs||[]).some(x=>x.job.status==='running')||equipmentSync?.pending(S.me.character.tgId))||Date.now()-autoPollAt<(viewing?3000:12000))return;autoPollBusy=true;autoPollAt=Date.now();const before=(S.backgroundJobs||[]).filter(x=>x.job.status==='running').map(x=>x.refId);try{await syncBackground();if(!$('#forge')?.hidden&&$('#forge')?.querySelector('[data-auto-back]')&&S.autoEnhance)autoPanel();if(before.some(id=>!S.backgroundJobs.some(x=>x.refId===id&&x.job.status==='running')))await refreshMe({silent:true,full:true});}catch(_){}finally{autoPollBusy=false;}},3000);
  function forgeFailure(e,message,onReturn){const ov=$('#forge');if(!ov)return;window.RpgForgeRitual?.dispose?.();ov.classList.remove('charging','dragging','waiting');ov.querySelector('.fr-instruction')?.replaceChildren(document.createTextNode('本次操作已停止'));const box=ov.querySelector('.fg-box');if(!box){ov.hidden=true;$('#app').inert=false;return;}let buttons=ov.querySelector('.fg-b');if(!buttons){buttons=document.createElement('div');buttons.className='fg-b';box.append(buttons);}const text=ov.querySelector('.fg-r');if(text)text.textContent=message||S.forgeError||'操作未完成，請確認裝備狀態後再試。';buttons.innerHTML='<button class="btn ghost" data-forge-exit>返回裝備</button>';buttons.querySelector('button').onclick=()=>{ov.hidden=true;$('#app').inert=false;refreshMe();if(S.me?.equipment.some(x=>x.id===e.id)){if(onReturn)onReturn();else itemSheet(e.id);}};ov.querySelector('.fr-auto')?.setAttribute('hidden','');}
  const guaranteedScrollKey=e=>e.slot==='weapon'||e.scroll==='scroll_w'?'guaranteed_scroll_w':'guaranteed_scroll_a';
  async function forge(e,kind,run,blessed=false,autoTarget=null,guaranteed=false){try{return await forgeRun(e,kind,run,blessed,autoTarget,guaranteed)}catch(err){forgeFailure(e,err.message);return null}}
  async function forgeRun(e, kind, run, blessed = false, autoTarget = null, guaranteed = false) {
    const session=++forgeSession;
    let ov = $('#forge'); if (!ov) { ov = document.createElement('div'); ov.id = 'forge'; document.body.appendChild(ov); }
    ov.className = `forge ${kind} charging`; ov.hidden = false;
    ov.innerHTML = `<div class="fg-box"><div class="fg-ring"></div><div class="fg-ic ic rar-${esc(e.rarity)}">${eqIcon(e)}${e.enhance ? `<em>+${e.enhance}</em>` : ''}</div>
      <div class="fg-t">${kind === 'enhance' ? `強化中… +${e.enhance} → +${e.enhance + 1}` : '洗屬性中…'}</div><div class="fg-r"></div><div class="fg-s"></div><div class="fg-b"></div></div>`;
    if(kind==='enhance'&&window.RpgForgeRitual){const a=attemptCost(e,e.scroll),key=guaranteed?guaranteedScrollKey(e):blessed?e.blessedScroll:e.scroll;
      const summary=`${itemName(key)} ×${guaranteed||blessed?1:e.scrollCost} · 持有 ${S.me.inventory[key]||0}${guaranteed?'\n必成100% · 只使用一張，不啟動背景強化':!blessed&&a.miss?'\n缺卷補購 '+a.miss+' 張 · 扣金幣 '+fmt(a.gold):''}`;
      const guaranteedKey=guaranteedScrollKey(e);
      const ready=await window.RpgForgeRitual.prepare(ov,e,eqIcon(e),blessed,{summary,autoTarget:guaranteed?null:autoTarget,choose:true,guaranteed,guaranteedKey,guaranteedName:itemName(guaranteedKey),guaranteedHave:S.me.inventory[guaranteedKey]||0,guaranteedArt:artSrc('item',guaranteedKey),guaranteedSummary:`${itemName(guaranteedKey)} ×1 · 持有 ${S.me.inventory[guaranteedKey]||0}\n必成100% · 只使用一張，不啟動背景強化`,ordinaryAffordable:a.ok,ordinaryHave:S.me.inventory[e.scroll]||0,blessedHave:S.me.inventory[e.blessedScroll]||0,ordinarySummary:`${itemName(e.scroll)} ×${e.scrollCost} · 持有 ${S.me.inventory[e.scroll]||0}${a.miss?'\n缺卷補購 '+a.miss+' 張 · 扣金幣 '+fmt(a.gold):''}`,blessedSummary:`${itemName(e.blessedScroll)} ×1 · 持有 ${S.me.inventory[e.blessedScroll]||0}`});
      if(session!==forgeSession)return null;if(ready?.ready){guaranteed=ready.guaranteed===true;blessed=!guaranteed&&ready.blessed;autoTarget=guaranteed?null:ready.autoTarget||null;}if(!ready){ov.hidden=true;itemSheet(e.id);return null;}}
    if(guaranteed){blessed=false;autoTarget=null;}
    if(kind==='enhance'&&autoTarget)return startAuto(e,blessed,autoTarget);
    if(kind!=='enhance')haptic('light'); let spin = 0; const keys = Object.keys(ELEM);
    const iv = kind === 'reroll' ? setInterval(() => { const el = ov.querySelector('.fg-r'); if (el) el.textContent = ELEM[keys[spin++ % keys.length]]; }, 90) : 0;
    const [j] = await Promise.all([kind==='enhance'?act('enhance',{itemId:e.id,...(guaranteed?{guaranteed:true}:blessed?{blessed:true}:{})}):run(), new Promise((r) => setTimeout(r, reducedMotion() ? 150 : 900))]); clearInterval(iv);
    if(session!==forgeSession)return null;if (!j || !j.result) { forgeFailure(e);return null; }
    const r = j.result; ov.classList.remove('charging');
    const set = (cls, title, sub) => { ov.classList.add(cls); ov.querySelector('.fg-t').innerHTML = title; ov.querySelector('.fg-r').innerHTML = sub; };
    if (kind === 'enhance') {
      if (r.result === 'success') { set('ok', `✨ 強化成功！`, `<b class="big">+${r.to}</b>`); window.RpgForgeRitual?.reveal(ov,'success',r.to); sparks(ov, ['#ffd75e', '#fff1b0', '#7fd6ff'], 26); }
      else if (r.result === 'break') { set('boom', '💥 爆裝了…', `「${esc(e.name)}」碎掉了`); window.RpgForgeRitual?.reveal(ov,'break'); sparks(ov, ['#ff8296', '#a1102c', '#ffd2a0'], 20); }
      else { set('none', '😶 沒有變化', '捲軸已消耗，再試一次？'); window.RpgForgeRitual?.reveal(ov,'nothing'); }
    } else {
      const a = r.after; set(r.upgraded ? 'ok' : 'roll', r.upgraded ? '⬆️ 稀有度提升！' : '🎲 洗好了', `<b class="big tc-${esc(a.rarity)}">${ELEM[a.element] || a.element} +${fmt(a.element_stat)}</b><br><span class="tc-${esc(a.rarity)}">${esc(r.rarityName)}</span> <span class="muted">（原本 ${ELEM[r.before.element] || r.before.element} +${fmt(r.before.element_stat)}）</span>`);
      haptic(r.upgraded ? 'ok' : 'light'); if (r.upgraded) sparks(ov, ['#d7a6ff', '#ffc857', '#fff'], 24);
    }
    const ne = kind==='enhance'&&r.result==='break' ? null : S.me.equipment.find((x) => x.id === e.id);
    const again = ne && guaranteed ? (ne.enhanceNext&&(S.me.inventory[guaranteedScrollKey(ne)]||0)>0?{ok:true,miss:0}:null) : ne && blessed ? (ne.blessedEnhanceNext && (S.me.inventory[ne.blessedScroll]||0)>0 ? {ok:true,miss:0}:null) : ne && (kind === 'reroll' ? attemptCost(ne, 'scroll_r') : ne.enhanceNext ? attemptCost(ne, ne.scroll) : null);
    const label = again && again.ok ? (guaranteed?'再用一張必成卷':again.miss ? `再一次 · 💰${fmt(again.gold)}` : '再一次') : '';
    const usedScroll=guaranteed?guaranteedScrollKey(e):blessed?e.blessedScroll:e.scroll;
    ov.querySelector('.fg-s').innerHTML = `<small class="muted">💰 ${fmt(S.me.character.gold)} · ${kind === 'reroll' ? `洗屬性捲 ${S.me.inventory.scroll_r || 0}` : `${itemName(usedScroll)} ${S.me.inventory[usedScroll] || 0}${guaranteed?' · 必成100% · 單次完成':''}`}</small>`;
    ov.querySelector('.fg-b').innerHTML = `${label ? `<button class="btn ${guaranteed?'gold':kind === 'enhance' && ne.enhanceNext && ne.enhanceNext.break ? 'red' : 'green'}" data-f="again">${label}</button>` : ''}<button class="btn ghost" data-f="done">完成</button>`;
    return new Promise((res) => {
      const autoPanel=ov.querySelector('.fr-auto');
      if(kind==='enhance'&&autoPanel&&!guaranteed){
        const check=autoPanel.querySelector('.fr-auto-check'),select=autoPanel.querySelector('.fr-auto-target'),start=autoPanel.querySelector('.fr-auto-start');
        const available=!!(ne&&ne.enhanceNext&&again?.ok);let starting=false;
        check.disabled=!available;select.disabled=!available;
        select.innerHTML=ne?Array.from({length:Math.max(0,15-ne.enhance)},(_,i)=>'<option value="'+(ne.enhance+i+1)+'">+'+(ne.enhance+i+1)+'</option>').join(''):'';
        const sync=()=>start.disabled=!available||!check.checked||starting;check.onchange=sync;sync();
        start.onclick=async()=>{if(starting||!available||!check.checked)return;const target=Number(select.value);if(!Number.isInteger(target)||target<=ne.enhance||target>15)return;
          starting=true;sync();let accepted=false;try{accepted=await window.RpgForgeRitual.confirmAuto(target,blessed)}finally{starting=false;sync()}if(!accepted)return;
          starting=true;sync();ov.querySelectorAll('[data-f]').forEach(b=>b.disabled=true);res('auto');startAuto(ne,blessed,target).catch(err=>forgeFailure(ne,err.message));
        };
      }
      ov.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { ov.hidden = true; res(b.dataset.f);
      if (b.dataset.f === 'again' && ne) (kind === 'reroll' ? doReroll : guaranteed ? doGuaranteedEnhance : blessed ? doBlessedEnhance : doEnhance)(ne); else if (ne) itemSheet(ne.id); }; }); });
  }
  function sparks(ov, cols, n) {
    if (reducedMotion()) return; const box = ov.querySelector('.fg-box');
    for (let i = 0; i < n; i++) { const p = document.createElement('i'); p.className = 'spark'; const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
      p.style.setProperty('--dx', `${Math.cos(a) * d}px`); p.style.setProperty('--dy', `${Math.sin(a) * d}px`); p.style.background = cols[i % cols.length]; box.appendChild(p); setTimeout(() => p.remove(), 900); }
  }
  async function buyMissing(scroll, miss) { return miss ? act('buy', { item: scroll, qty: miss }) : true; }
  async function doEnhance(e) {
    const nx = e.enhanceNext; if (!nx) return; const a = attemptCost(e, e.scroll);

    closeSheet();
    return forge(e, 'enhance', async () => act('enhance', { itemId: e.id }));
  }
  async function doBlessedEnhance(e) {
    const key = e.blessedScroll;
    const have = S.me.inventory[key] || 0;
    if (!e.blessedEnhanceNext || !have) return toast(`需要${itemName(key)} ×1`, true);
    const nx = e.blessedEnhanceNext;
    closeSheet();
    return forge(e, 'enhance', async () => act('enhance', { itemId: e.id, blessed: true }), true);
  }
  async function doGuaranteedEnhance(e){const key=guaranteedScrollKey(e);if(!e.enhanceNext||!(S.me.inventory[key]>0))return toast(`需要${itemName(key)} ×1`,true);closeSheet();return forge(e,'enhance',null,false,null,true);}
  async function forgeAffixes(e,locked,price,missing,gold){try{return await forgeAffixesRun(e,locked,price,missing,gold)}catch(err){forgeFailure(e,err.message,()=>doReroll(e,locked));return null}}
  async function forgeAffixesRun(e,locked,price,missing,gold) {
    const session=++forgeSession;
    let ov=$('#forge');if(!ov){ov=document.createElement('div');ov.id='forge';document.body.appendChild(ov);}ov.hidden=false;
    const summary='鎖定 '+locked.length+' 條 · 洗屬性卷軸 ×'+price.scrolls+'\n工費 '+fmt(price.fee)+' · 缺卷補購 '+missing+' 張：'+fmt(missing*60)+' 金幣\n本次共扣 '+fmt(gold)+' 金幣';
    const ready=await window.RpgForgeRitual.prepare(ov,e,eqIcon(e),false,{mode:'reroll',summary});
    if(session!==forgeSession)return null;if(!ready){ov.hidden=true;return doReroll(e,locked);}
    const [j]=await Promise.all([act('reroll',{itemId:e.id,locks:locked}),new Promise(resolve=>setTimeout(resolve,reducedMotion()?150:900))]);
    if(session!==forgeSession)return null;if(!j){forgeFailure(e,undefined,()=>doReroll(e,locked));return null;}
    const ne=S.me.equipment.find(x=>x.id===e.id)||e,after=ne.affixes||j.result?.after||{};
    window.RpgForgeRitual.reveal(ov,'reroll');ov.querySelector('.fg-t').textContent='詞條重鑄完成';
    ov.querySelector('.fg-r').innerHTML='<b class="big">品質 '+esc(after.quality||'')+'</b><div class="fr-affix-results">'+(after.lines||[]).map(x=>'<div class="'+(locked.includes(x.index)?'locked':'')+'"><span>'+esc(x.name)+' +'+(x.value*100).toFixed(2)+'%</span><small>'+(locked.includes(x.index)?'🔒 已保留':esc(x.quality)+' · 已重鑄')+'</small></div>').join('')+'</div>';
    ov.querySelector('.fg-s').textContent='剩餘金幣 '+fmt(S.me.character.gold)+' · 洗屬性卷軸 '+(S.me.inventory.scroll_r||0);
    ov.querySelector('.fg-b').innerHTML='<button class="btn gold" data-fr-again>調整鎖定／再洗</button><button class="btn ghost" data-fr-done>完成</button>';
    return new Promise(resolve=>{ov.querySelector('[data-fr-again]').onclick=()=>{ov.hidden=true;resolve();doReroll(ne,locked)};ov.querySelector('[data-fr-done]').onclick=()=>{ov.hidden=true;resolve();itemSheet(ne.id)}});
  }
  async function doReroll(e,locked=[]) {
    e=S.me.equipment.find(x=>x.id===e.id)||e;
    const lines=e.affixes?.lines||[],slots=e.affixes?.slots||1;
    const price=e.rerollPrices?.[locked.length]||e.rerollCost||{scrolls:e.scrollCost,fee:0};
    const missing=Math.max(0,price.scrolls-(S.me.inventory.scroll_r||0)),gold=price.fee+missing*60;
    const c=sheet('<div class="reroll-equipment showcase showcase-'+esc(e.classReq||e.class_req||'shared')+' rar-'+esc(e.rarity)+'"><div class="showcase-img-wrap rar-'+esc(e.rarity)+' '+clsCls(e)+'">'+eqIcon(e)+'</div><div class="showcase-tags">'+clsTag(e)+rarTag(e)+'</div><h2 class="showcase-title tc-'+esc(e.rarity)+'">+'+e.enhance+' '+esc(e.name)+'</h2><p class="reroll-equipment-meta">'+esc(e.slotName||'裝備')+' · T'+e.tier+' · '+esc(e.statName||'')+' '+fmt(e.stat)+'</p></div><h2>能力詞條重鑄</h2><p>'+esc(e.name)+' · 詞條 '+lines.length+'/'+slots+' · 品質 '+esc(e.affixes?.quality||'未鑑定')+'</p><p class="muted">保留裝備品階、元素、強化與遺物能力。勾選鎖定，重洗其餘詞條；至少留一條可洗。</p><div class="affix-list">'+(lines.length?lines.map(x=>'<label class="affix-row"><input type="checkbox" data-affix-lock="'+x.index+'" '+(locked.includes(x.index)?'checked':'')+'><span><b>'+esc(x.name)+' +'+(x.value*100).toFixed(2)+'%</b> · '+esc(x.quality)+(x.recommended?' ⭐ 分支推薦':'')+'<small>範圍 '+(x.range[0]*100).toFixed(2)+'–'+(x.range[1]*100).toFixed(2)+'% · 潛力 '+x.score+'/100</small></span></label>').join(''):'<div class="muted">尚未鑑定。首次重鑄產生 '+slots+' 條能力，原有遺物能力保留。</div>')+'</div><div class="reroll-cost"><b>鎖定 '+locked.length+' 條</b><p>洗屬性捲 ×'+price.scrolls+' · 工費 💰'+fmt(price.fee)+'</p><p>缺捲補購 '+missing+' 張：💰'+fmt(missing*60)+'<br>本次共扣 💰'+fmt(gold)+'（持有 '+fmt(S.me.character.gold)+'）</p><small>品質 C／B／A／S／SS；保留數值完整，未鎖定詞條可升可降。</small></div><div class="grid2"><button class="btn gold" data-affix-roll '+(gold>S.me.character.gold||e.inTrade?'disabled':'')+'>確認重洗</button><button class="btn ghost" data-affix-back>返回裝備</button></div>');
    c.classList.add('forge-flow-sheet');const flowContent=document.createElement('div');flowContent.className='forge-flow-content';const flowFooter=c.querySelector('.grid2');flowFooter.classList.add('forge-flow-footer');[...c.children].forEach(child=>{if(child!==flowFooter)flowContent.append(child)});c.prepend(flowContent);
    c.querySelectorAll('[data-affix-lock]').forEach(el=>el.onchange=()=>{const next=[...c.querySelectorAll('[data-affix-lock]:checked')].map(x=>Number(x.dataset.affixLock));if(next.length>=slots&&!window.RpgAutoRerollUI.typeMode(S.me.character.tgId+':'+e.id)){el.checked=false;return toast('至少留一條可重洗詞條',true);}doReroll(e,next);});
    c.querySelector('[data-affix-back]').onclick=()=>itemSheet(e.id);
    window.RpgAutoRerollUI.mount(c,{key:S.me.character.tgId+':'+e.id,item:e,locks:locked,actor:S.me.character,gold:S.me.character.gold,scrolls:S.me.inventory.scroll_r||0,api,onConfigure:()=>doReroll(e,locked),onError:m=>toast(m,true),onManual:async()=>{closeSheet();await forgeAffixes(e,locked,price,missing,gold);},onStart:async settings=>{const key='auto-reroll:'+e.id+':'+JSON.stringify(settings),r=await api('auto-reroll/start',{itemId:e.id,...settings,requestId:pendingRequestId(key)});clearPendingRequest(key);closeSheet();S.autoReroll=r.job;await syncBackground().catch(()=>{});showRerollJob(r.job);}});
  }

  function eqIcon(e) { return gearIcon(e, SLOT_EMOJI[e.slot] || '⚔️'); }
  const relicCls = (e) => (e.grade === 'relic' ? ' relic' : '');
  const clsCls = (e) => `ic-${(e && (e.classReq || e.class_req)) || 'shared'}`;
  const clsTag = (e) => {
    const c = (e && (e.classReq || e.class_req)) || 'any';
    if (c === 'sword') return '<span class="tag-cls tag-sword">⚔️ 劍士</span>';
    if (c === 'archer') return '<span class="tag-cls tag-archer">🧝 妖精</span>';
    if (c === 'mage') return '<span class="tag-cls tag-mage">🔮 法師</span>';
    return '<span class="tag-cls tag-shared">💎 通用</span>';
  };
  const rarTag = (e) => `<span class="rar-tag rar-${esc(e.rarity || 'common')}">${esc(e.rarityName || '一般')}</span>`;
  const AFFIX = { atk: 'ATK', def: 'DEF', hp: 'HP', mp: 'MP', critPct: '爆擊', takenPct: '受傷', maxHpPct: 'MaxHP', maxMpPct: 'MaxMP', expPct: 'EXP', atkPct: 'ATK' };
  const fmtBonus = (k, v) => `${AFFIX[k] || k} ${v > 0 ? '+' : '−'}${/Pct$/.test(k) ? `${Math.round(Math.abs(v) * 1000) / 10}%` : fmt(Math.abs(v))}`;
  function extrasText(e) {
    const parts = Object.entries(e.extras || {}).filter(([, v]) => v).map(([k, v]) => fmtBonus(k, v));
    for (const [k, v] of Object.entries(e.pct || {})) if (v && AFFIX[k]) parts.push(fmtBonus(k, v));
    return parts.join(' · ');
  }
  const BAG_EQUIP_FILTERS = [['all','全部','🎒'],['weapon','武器','⚔️'],['helmet','頭盔','🪖'],['armor','盔甲','🛡️'],['gloves','手套','🧤'],['boots','長靴','👢'],['belt','腰帶','🎗️'],['undershirt','內衣','👕'],['earring','耳環','💎'],['ring','戒指','💍']];
  function monsterCollectionView(){return window.RpgCollectionUI?.render({me:S.me,meta:S.meta},{esc,fmt,itemName})||'<div class="card">圖鑑尚未載入，請重新開啟遊戲。</div>';}
  async function chooseCollectionBlessing(mapId) {
    const actorId=S.me?.character?.tgId;if(!actorId||S.busy)return null;
    return act('collection/activate',{mapId,expectedCharId:actorId},mapId?'收藏祝福已啟用':'收藏祝福已停用');
  }
  function collectionMaterialSheet(item) {
    const match=/^hunt_(\d+)_(1|2|3|sigil|core)$/.exec(item),info=S.meta.items[item];if(!match||!info)return;
    const mapName=S.meta.maps[Number(match[1])]?.name||'地圖 '+match[1],source=match[2]==='core'?'擊敗群組首領':match[2]==='sigil'?'擊敗菁英怪物':'擊敗地圖怪物';
    const card=sheet('<img class="collection-detail-art" src="'+window.RpgCollectionUI.icon(item)+'" alt="'+esc(info.name)+'"><h2>'+esc(info.name)+'</h2><div class="collection-material-source">'+esc(mapName)+' · '+source+'</div><p class="collection-detail-quantity">目前持有 '+fmt(S.me.inventory[item]||0)+' 份</p><p class="collection-detail-copy">將旅途中取得的材料鑄成永久地圖徽記，解鎖可選用的收藏祝福。收集材料可在交易所買賣，完成的圖鑑徽記與祝福永久保留在角色身上。<br>需求與掉落上限沿用原規則；較高地圖同類材料可按 3 比 1 向下精煉。</p><button class="btn ghost" data-material-back>返回</button>');card.querySelector('[data-material-back]').onclick=closeSheet;
  }
  function collectionItemSheet(item) {
    const recipe=S.me.collection?.recipes.find(r=>r.item===item);if(!recipe)return;
    const actorId=S.me.character.tgId,active=S.me.collection.activeMapId===recipe.mapId,inParty=!!S.me.character.partyId;
    const card=sheet('<img class="collection-detail-art" src="'+window.RpgCollectionUI.icon(item)+'" alt="'+esc(recipe.name)+'"><h2>'+esc(recipe.name)+'</h2><p class="collection-detail-state">'+(recipe.owned?'已收藏 · 永久解鎖':'尚未製作 · 集齊材料即可鑄成徽記')+'</p><div class="collection-detail-bonus"><strong>'+esc(recipe.blessing?.name||'收藏祝福')+'</strong>'+esc(recipe.blessing?.summary||'完成收藏後解鎖')+'<br><small>全職業通用 · 只作用於自身</small></div><p class="collection-detail-copy">'+esc(recipe.blessing?.tip||'')+'<br>每位角色一次只能啟用一種祝福，免費更換，不消耗徽記。'+(inParty?'<br>請先完成組隊冒險再更换祝福。':'')+'</p><div class="grid2"><button class="btn gold" data-collection-use '+(recipe.owned&&!inParty&&!active?'':'disabled')+'>'+(active?'已啟用':'啟用祝福')+'</button></div><button class="btn ghost" data-collection-back>返回</button>');
    card.querySelector('[data-collection-back]').onclick=closeSheet;
    card.querySelector('[data-collection-use]').onclick=async()=>{if(actorId!==S.me?.character?.tgId){closeSheet();toast('角色已切換，請重新選擇收藏',true);return;}if(await chooseCollectionBlessing(recipe.mapId))closeSheet();};
  }
  function bagView() {
    const me = S.me; const eq = me.equipment; const c = me.character;
    const at = (slot, pos) => eq.find((e) => e.slot === slot && e.equipped && (MULTI[slot] ? e.position === pos : true));
    const cell = ([slot, pos]) => { const e = at(slot, pos);
      return e ? `<div class="slot has rar-${esc(e.rarity)}${relicCls(e)} ${clsCls(e)}" data-item="${esc(e.id)}">${eqIcon(e)}${e.enhance ? `<em>+${e.enhance}</em>` : ''}<small>${esc(slotLabel(slot, pos))}</small></div>`
        : `<div class="slot" data-empty="${slot}" data-pos="${pos}"><span class="ph">${SLOT_EMOJI[slot]}</span><small>${esc(slotLabel(slot, pos))}</small></div>`; };
    const selectedBagSlot = BAG_EQUIP_FILTERS.some(([slot]) => slot === S.bagEquipSlot) ? S.bagEquipSlot : 'all';
    const bagTabs = BAG_EQUIP_FILTERS.map(([slot,label,icon]) => `<button type="button" data-bag-filter="${slot}" class="${slot === selectedBagSlot ? 'on' : ''}" aria-pressed="${slot === selectedBagSlot}">${icon} ${label} <span class="bag-count">${slot === 'all' ? eq.length : eq.filter(e => e.slot === slot).length}</span></button>`).join('');
    const bagItems = eq.filter(e => selectedBagSlot === 'all' || e.slot === selectedBagSlot);
    const inv = Object.entries(me.inventory).filter(([item, v]) => v > 0 && item !== 'guardian_free_normal' && !/^(?:hunt_\d+_(?:[123]|sigil|core)|collection_\d+)$/.test(item)).sort((a, b) => Object.keys(S.meta.items).indexOf(a[0]) - Object.keys(S.meta.items).indexOf(b[0]));
    const row = (e) => `<div class="item${relicCls(e)}" ${selectedBagSlot!=="all"&&e.slot!==selectedBagSlot?"hidden":""} data-item="${esc(e.id)}"><div class="ic rar-${esc(e.rarity)} ${clsCls(e)}">${eqIcon(e)}${e.enhance ? `<em>+${e.enhance}</em>` : ''}</div><div class="mid"><div class="t tc-${esc(e.rarity)}">${clsTag(e)}${e.enhance ? `+${e.enhance} ` : ''}${esc(e.name)}${e.equipped ? ' <span class="muted">(裝備中)</span>' : ''}</div>
      <div class="d">${rarTag(e)}${esc(e.slotName)}${e.equipped && MULTI[e.slot] ? e.position : ''} · T${e.tier} · ${e.statName} ${fmt(e.stat)} · ${esc(e.elementName)} +${fmt(e.elemStat)}${e.affix ? ' · ✦詞條' : ''}</div>${e.cannotEquip && !e.equipped ? `<div class="d" style="color:var(--danger)">${esc(e.cannotEquip)}</div>` : ''}</div><button class="more" data-menu="${esc(e.id)}" aria-label="更多">⋯</button></div>`;
    const displayKey = myHeroKey();
    const portrait = characterPortrait(c);
    const companion=me.guardianSummonEnabled===true&&me.guardianAssist?.itemId===me.guardian?.id&&me.guardianAssist?.remainingBattles>0?window.RpgGuardianSigil?.head(me.guardian)||'':'';
    return `<div class="lc-character"><div class="lc-window-title"><span>✥ CHARACTER / EQUIPMENT</span><strong>${esc(c.name)} · Lv.${c.level}</strong></div><div class="card lc-equip hero-armory"><h3>🛡️ 裝備 <small>11 個欄位 · 點欄位穿脫</small></h3>
      <div class="hero-armory-layout"><div class="hero-equipment-rail hero-equipment-left">${DOLL_L.map(cell).join('')}</div><div class="doll ${companion?'has-hero-companion':''}">${companion?`<div class="hero-guardian-companion">${companion}</div>`:''}<div class="fig">${window.RpgStarRingCosmetics?.markup(c.aura)||''}${portrait ? `<img src="${portrait}" data-display-hero="${esc(displayKey)}" alt="${esc(c.name)}角色全身展示" decoding="async">` : portraitHtml('dollpt')}
        <div class="figstats"><b>ATK ${fmt(me.stats.atk)}</b><b>DEF ${fmt(me.stats.def)}</b><b>HP ${fmt(me.stats.maxHp)}</b><b>MP ${fmt(me.stats.maxMp)}</b><b>爆擊 ${me.stats.crit}%</b></div></div></div><div class="hero-equipment-rail hero-equipment-right">${DOLL_R.map(cell).join('')}</div></div>
      <div class="acc">${DOLL_B.map(cell).join('')}</div></div>
      <button class="sr-cosmetic-entry" type="button" data-cosmetic-open>${c.aura?`<img src="${window.RpgStarRingCosmetics?.icon(c.aura)||''}" alt="">`:''}<span>星環專屬外觀<small>${c.aura?esc(c.aura.name)+' · 穿戴中':'把遠征的星光留在腳下 · 進入衣櫥'}</small></span><b>›</b></button><div class="card bag-equipment"><h3>⚔️ 裝備列表 <small>共 ${eq.length} 件 · 依部位篩選</small></h3><div class="bag-slot-tabs" role="group" aria-label="裝備部位分類">${bagTabs}</div><div class="bag-equip-help">顯示 ${bagItems.length} 件 · 「裝備中」代表已穿戴 · 點選裝備查看詳情，⋯ 或長按管理</div><div class="bag-equip-list">${eq.filter(e => e.equipped).map(row).join('')}${eq.filter(e => !e.equipped).map(row).join('')}${bagItems.length ? '' : '<div class="bag-empty">此部位尚無裝備，可切換分類或前往商店取得。</div>'}</div></div>
      <div class="card"><h3>🎒 道具</h3><div class="inv">${inv.map(([k, v]) => `<div data-inv-item="${esc(k)}" role="button" tabindex="0" title="${esc(S.meta.items[k] && S.meta.items[k].desc)}"><b>${k.startsWith('book_')?`<img class="skill-book-icon" src="/expedition/assets/skills-painted-20261011/${esc(k.slice(5))}.webp" alt="">`:iconHtml(k, itemEmoji(k))}</b><i>${fmt(v)}</i><br>${esc(itemName(k))}</div>`).join('') || '<div class="muted">空的</div>'}</div></div>${window.RpgCollectionUI?.inventory({me,meta:S.meta},{esc,fmt,itemName})||''}</div>`;
  }
  function bindBag(view) {
    view.querySelector('[data-cosmetic-open]')?.addEventListener('click',openCosmeticWardrobe);
    const auraFigure=view.querySelector('.hero-armory .fig'),auraImage=auraFigure?.querySelector('img'),auraNode=auraFigure?.querySelector('.star-ring-aura');if(auraNode&&auraImage){const placeAura=()=>window.RpgStarRingCosmetics?.position(auraNode,auraImage,auraFigure,{contain:true,maxWidthRatio:.52,maxHeightRatio:.6});auraImage.addEventListener('load',placeAura,{once:true});if(auraImage.complete)placeAura();}
    const guardianMarkup=window.RpgGuardianSigil?.summary(S.me.guardian,S.me.guardianSummonEnabled===true&&S.me.guardianAssist?.itemId===S.me.guardian?.id&&S.me.guardianAssist?.remainingBattles>0);if(guardianMarkup){view.querySelector('.lc-character')?.insertAdjacentHTML('beforeend',guardianMarkup);view.querySelector('[data-guardian-entry]').onclick=openGuardian;}const collectionMarkup=monsterCollectionView();if(collectionMarkup)view.querySelector('.lc-character')?.insertAdjacentHTML('beforeend',collectionMarkup);
    window.RpgCollectionUI?.bind(view,collectionItemSheet,collectionMaterialSheet);
    window.RpgCollectionUI?.bindInventory(view);
    view.querySelectorAll("[data-collection-activate]").forEach(button=>{button.onclick=async()=>{button.disabled=true;const result=await chooseCollectionBlessing(Number(button.dataset.collectionActivate));if(!result&&button.isConnected)button.disabled=false;};});
    const coreOffers=(S.me.collection?.coreExchange||[]).filter(o=>!o.owned&&o.have<o.need);
    if(coreOffers.length){const gold=S.me.character?.gold||0,frag=S.me.inventory?.research_fragment||0;const markup=`<details class="monster-core-exchange"><summary>💠 兌換首領核心 · 金幣或技能研究碎片</summary><p class="muted">沒打到地圖首領也能補核心，用來製作地圖收藏。核心綁定、不可交易；只能兌換你已抵達或通過的地圖。</p>${coreOffers.map(o=>`<div class="item"><div class="ic art">${iconHtml(o.item,'💠')}</div><div class="mid"><div class="t">${esc(o.name)}</div><div class="d">持有 ${fmt(o.have)} / 需要 ${fmt(o.need)}</div></div><button class="btn sm" data-core-exchange="${o.mapId}" data-pay="gold" ${gold<o.gold?'disabled':''}>🪙 ${fmt(o.gold)}</button><button class="btn sm ghost" data-core-exchange="${o.mapId}" data-pay="fragment" ${frag<o.fragments?'disabled':''}>🔹 ${fmt(o.fragments)}</button></div>`).join('')}</details>`;view.querySelector('.monster-collection')?.insertAdjacentHTML('beforeend',markup);}
    view.querySelectorAll('[data-core-exchange]').forEach(button=>{button.onclick=async()=>{const actorId=S.me?.character?.tgId;const offer=(S.me.collection?.coreExchange||[]).find(o=>String(o.mapId)===button.dataset.coreExchange);if(!offer)return;const pay=button.dataset.pay==='fragment'?'fragment':'gold';const cost=pay==='gold'?`${fmt(offer.gold)} 金幣`:`${fmt(offer.fragments)} 個技能研究碎片`;if(!await confirmSheet('兌換首領核心',`用 ${cost} 兌換 1 個 ${esc(offer.name)}？核心綁定、不可交易。`,'兌換'))return;if(actorId!==S.me?.character?.tgId){toast('角色已切換，請重新選擇',true);return;}await act('monster-exchange',{action:'core',map:offer.mapId,pay},`已兌換 ${offer.name}`);};});
    const refineOptions=S.me.collection?.refineOptions || [];
    if(refineOptions.length){const markup=`<details class="monster-refining"><summary>向下精煉材料 · 3 份換 1 份</summary><p class="muted">較高地圖的同類材料可換取缺少的低圖材料。精煉後無法換回。</p>${refineOptions.map((r,index)=>`<div class="item"><div class="mid"><div class="t">${esc(itemName(r.source))} → ${esc(itemName(r.target))}</div><div class="d">持有 ${fmt(r.have)} 份 · 每次消耗 3 份</div></div><button class="btn sm" data-monster-refine="${index}">換取</button></div>`).join('')}</details>`;view.querySelector('.monster-collection')?.insertAdjacentHTML('beforeend',markup);}
    view.querySelectorAll('[data-monster-refine]').forEach(button=>{button.onclick=async()=>{const actorId=S.me?.character?.tgId;const option=refineOptions[Number(button.dataset.monsterRefine)];if(!option)return;const targetRecipe=S.me.collection.recipes.find(r=>r.ingredients.some(i=>i.item===option.target)),ingredient=targetRecipe?.ingredients.find(i=>i.item===option.target);const missing=Math.max(1,(ingredient?.qty||1)-(ingredient?.have||0)),max=Math.min(100,Math.floor(option.have/3),missing);const card=sheet(`<h2>精煉材料</h2><p>${esc(itemName(option.source))} → ${esc(itemName(option.target))}</p><p class="muted">3 份高圖材料換 1 份低圖材料，精煉後無法換回。</p><label>換取份數 <input id="refine-count" type="number" min="1" max="${max}" value="${max}" inputmode="numeric"></label><p>最多可補 ${fmt(max)} 份缺料。</p><button class="btn" data-refine-confirm>確認精煉</button>`);card.querySelector('[data-refine-confirm]').onclick=async()=>{if(actorId!==S.me?.character?.tgId){closeSheet();toast('角色已切換，請重新選擇材料',true);return;}const count=Number(card.querySelector('#refine-count').value);if(!Number.isInteger(count)||count<1||count>max){toast('請輸入範圍內的整數份數',true);return;}const result=await act('monster-exchange',{action:'refine',sourceItem:option.source,refineTarget:option.target,count},`已取得 ${itemName(option.target)} ×${count}`);if(result)closeSheet();};};});
    view.querySelectorAll('[data-monster-exchange]').forEach(button=>{button.onclick=async()=>{const actorId=S.me?.character?.tgId;const recipe=S.me.collection?.recipes.find(r=>r.id===button.dataset.monsterExchange);if(!recipe)return;if(!await confirmSheet('製作地圖收藏',`製作「${esc(recipe.name)}」將消耗 ${fmt(recipe.gold)} 金幣及畫面所列材料，解鎖永久收藏與通用祝福。`,'製作'))return;if(actorId!==S.me?.character?.tgId){toast('角色已切換，請重新選擇收藏',true);return;}await act('monster-exchange',{recipe:recipe.id},'地圖收藏已解鎖，可啟用收藏祝福');};});
    view.querySelectorAll('[data-bag-filter]').forEach(btn => { btn.onclick = () => { S.bagEquipSlot = btn.dataset.bagFilter; const root = btn.closest('.bag-equipment'); if (!root) return; const chosen = S.bagEquipSlot; const equipment = S.me.equipment.filter(e => chosen === 'all' || e.slot === chosen); root.querySelectorAll('[data-bag-filter]').forEach(b => { const on = b.dataset.bagFilter === chosen; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); root.querySelectorAll('.bag-equip-list .item').forEach(el => { const e = S.me.equipment.find(x => x.id === el.dataset.item); el.hidden = !e || (chosen !== 'all' && e.slot !== chosen); }); const help = root.querySelector('.bag-equip-help'); if (help) help.textContent = '顯示 ' + equipment.length + ' 件 · 「裝備中」代表已穿戴 · 點選裝備查看詳情，⋯ 或長按管理'; let empty = root.querySelector('.bag-empty'); if (!equipment.length && !empty) { empty = document.createElement('div'); empty.className = 'bag-empty'; empty.textContent = '此部位尚無裝備，可切換分類或前往商店取得。'; root.querySelector('.bag-equip-list').appendChild(empty); } if (empty) empty.hidden = equipment.length > 0; }; });
    const pt = $('#dollpt', view); if (pt) drawPortrait(pt, heroOpts({}));
    view.querySelectorAll('[data-inv-item]').forEach((el) => { el.onclick = () => invItemMenu(el.dataset.invItem); el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); invItemMenu(el.dataset.invItem); } }; });
  view.querySelectorAll('[data-item]').forEach((el) => { el.onclick = () => itemSheet(el.dataset.item); if (el.classList.contains('item')) bindLongPress(el, () => itemMenu(el.dataset.item)); });
    view.querySelectorAll('[data-menu]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); itemMenu(b.dataset.menu); }; });
    view.querySelectorAll('[data-empty]').forEach((el) => { el.onclick = () => slotPicker(el.dataset.empty, Number(el.dataset.pos)); });
  }
  /** empty slot → pick a compatible unequipped item for that slot/position */
  function slotPicker(slot, pos) {
    const list = S.me.equipment.filter((e) => e.slot === slot && !e.equipped);
    const c = sheet(`<h2>${SLOT_EMOJI[slot]} ${esc(slotLabel(slot, pos))}</h2>${list.map((e) => `<div class="item${relicCls(e)}" data-pick="${esc(e.id)}"><div class="ic rar-${esc(e.rarity)} ${clsCls(e)}">${eqIcon(e)}</div><div class="mid"><div class="t tc-${esc(e.rarity)}">${clsTag(e)}${e.enhance ? `+${e.enhance} ` : ''}${esc(e.name)}</div><div class="d">${rarTag(e)}${e.statName} ${fmt(e.stat)} · ${esc(e.className)}${e.cannotEquip ? ` · <span style="color:var(--danger)">${esc(e.cannotEquip)}</span>` : ''}</div></div><button class="btn sm" ${e.cannotEquip ? 'disabled' : ''}>裝備</button></div>`).join('') || `<div class="muted">背包裡沒有${esc(S.meta.slots[slot])}。商店的「${slot === 'earring' || slot === 'ring' ? '💍 飾品' : slot === 'weapon' ? '⚔️ 武器' : '🛡️ 防具'}」分頁可以買。</div>`}
      <button class="btn ghost mt" data-x>關閉</button>`);
    c.querySelector('[data-x]').onclick = closeSheet;
    c.querySelectorAll('[data-pick]').forEach((el) => { el.onclick = () => { const e = list.find((x) => x.id === el.dataset.pick); if (e.cannotEquip) return toast(e.cannotEquip, true); closeSheet(); act('equip', { itemId: e.id, position: MULTI[slot] ? pos : null }, `已裝備 ${e.name}`); }; });
  }
  function itemSheet(id) {
    const e = S.me.equipment.find((x) => x.id === id); if (!e) return closeSheet();
    const inv = S.me.inventory; const nx = e.enhanceNext; const have = inv[e.scroll] || 0; const haveR = inv.scroll_r || 0;
    const ac = attemptCost(e, e.scroll), rc = attemptCost(e, 'scroll_r');
    const ex = extrasText(e); const aff = e.affix ? Object.entries(e.affix).map(([k, v]) => fmtBonus(k, v)).join(' · ') : '';
    const scReq = e.classReq || e.class_req || 'shared';
    const scClass = `showcase showcase-${esc(scReq)} rar-${esc(e.rarity)}${e.grade === 'relic' ? ' relic' : ''}`;
    const c = sheet(`<div class="${scClass}">
        <div class="showcase-img-wrap rar-${esc(e.rarity)} ${clsCls(e)}">
          ${eqIcon(e)}
        </div>
        <div class="showcase-tags">
          ${clsTag(e)}
          ${rarTag(e)}
          ${e.grade === 'relic' ? '<span class="relictag">神話遺物</span>' : ''}
          ${e.source === 'boss' ? '<span class="chip">👑 首領裝</span>' : e.source === 'elite' ? '<span class="chip">⚔️ 菁英掉落</span>' : ''}
        </div>
        <h2 class="showcase-title tc-${esc(e.rarity)}">${e.enhance ? `+${e.enhance} ` : ''}${esc(e.name)}</h2>
        <div class="showcase-sub">${esc(e.type || '')} · ${esc(e.slotName)} · 需求 Lv.${e.levelReq}</div>
      </div>
      <div class="kv"><span>${e.statName}</span><b>${fmt(e.stat)}</b>${ex ? `<span>附加</span><b>${esc(ex)}</b>` : ''}${aff ? `<span>遺物詞條</span><b class="relictxt">${esc(aff)}</b>` : ''}<span>屬性</span><b>${esc(e.elementName)} +${fmt(e.elemStat)}</b><span>裝備階</span><b>T${e.tier} · Lv.${e.levelReq}</b>${e.branchReq ? `<span>路線</span><b>${esc(e.branchReq)} 路線限定</b>` : ''}
      <span>交易</span><b>${e.inTrade ? '🤝 交易中（保管）' : e.tradeBlock ? `🔒 ${esc(e.tradeBlock)}` : '可交易・可分享'}</b>
      <span>強化</span><b>${nx ? `+${e.enhance} → +${e.enhance + 1}：成功 ${Math.round(nx.success * 100)}%${nx.break ? ` · <span style="color:var(--danger)">爆裝 ${Math.round(nx.break * 100)}%</span>` : '（安全）'}` : '已達上限'}</b></div>
      ${e.affixes?.lines?.length?'<div class="card affix-list"><b>能力詞條 · '+esc(e.affixes.quality)+'</b>'+e.affixes.lines.map(x=>'<div>'+esc(x.name)+' +'+(x.value*100).toFixed(2)+'% · '+esc(x.quality)+(x.recommended?' ⭐':'')+'</div>').join('')+'</div>':''}
      ${e.cannotEquip ? `<div class="warnbox">${esc(e.cannotEquip)}</div>` : ''}
      <div class="grid2">
        ${e.equipped ? '<button class="btn ghost" data-a="unequip">卸下</button>' : MULTI[e.slot] ? [1, 2].map((p) => `<button class="btn" data-a="equip" data-pos="${p}" ${e.cannotEquip ? 'disabled' : ''}>裝到 ${esc(slotLabel(e.slot, p))}</button>`).join('') : `<button class="btn" data-a="equip" ${e.cannotEquip ? 'disabled' : ''}>${e.grade === 'relic' && !e.bound ? '裝備（綁定）' : '裝備'}</button>`}
        <button class="btn ${nx && nx.break ? 'red' : 'green'}" data-a="enhance" ${nx && (ac.ok || (inv[e.blessedScroll]||0)>0 || (inv[guaranteedScrollKey(e)]||0)>0) ? '' : 'disabled'}>📜 強化<small>選擇強化卷軸</small></button>
        <button class="btn ghost" data-a="reroll" ${e.inTrade?'disabled':''}>🎲 洗屬性<small>${e.affixes?.lines?.length||0}/${e.affixes?.slots||1} 條 · ${esc(e.affixes?.quality||'未鑑定')}</small></button>
        ${e.convertible ? '<button class="btn ghost" data-a="convert">🔄 轉換路線</button>' : ''}
        <button class="btn ghost" data-a="share" ${e.shareBlock ? 'disabled' : ''} title="${esc(e.shareBlock || '')}">📣 分享至群組</button>
        <button class="btn ghost" data-a="trade" ${e.tradeBlock ? 'disabled' : ''} title="${esc(e.tradeBlock || '')}">🤝 交易${e.tradeBlock ? '<small>' + esc(e.tradeBlock) + '</small>' : ''}</button>
        <button class="btn ghost" data-a="list" ${e.tradeBlock ? 'disabled' : ''} title="${esc(e.tradeBlock || '')}">🏷️ 掛賣到交易所${e.tradeBlock ? '<small>' + esc(e.tradeBlock) + '</small>' : ''}</button>
        ${e.bound ? `<button class="btn ghost" data-a="unbind" ${e.unbindBlock ? 'disabled' : ''} title="${esc(e.unbindBlock || '')}">🔓 解契（${S.me.inventory.unbind || 0}/${e.unbindCost}）</button>` : ''}
        ${e.sellBlock ? `<button class="btn ghost" disabled title="${esc(e.sellBlock)}">🔒 ${esc(e.sellBlock)}</button>` : `<button class="btn red" data-a="sell">🏪 賣給商店（${fmt(e.sellPrice)} 金）</button>`}
        <button class="btn ghost" data-a="close">關閉</button>
      </div>${e.shareBlock ? `<div class="muted mt">📣 不能分享：${esc(e.shareBlock)}${e.bound && !e.equipped ? '（可用 🔓 赫密士解契卷解除綁定）' : ''}</div>` : ''}`);
    c.dataset.equipmentId=id;c.dataset.equipmentVersion=JSON.stringify(e);
    c.querySelectorAll('[data-a]').forEach((b) => { b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'close') return closeSheet();
      if (a === 'share') return shareItem(e);
      if (a === 'trade') return tradeGear(e);
      if (a === 'list') return listGear(e);
      if (a === 'unbind') return unbindItem(e);
      if (a === 'sell') return sellGearItem(e);
      if (a === 'equip') {
        if (!e.bound && (e.grade === 'relic' || e.source !== 'starter') && !(await confirmSheet('🔒 穿上後綁定', `穿上「${esc(e.name)}」後會<b>綁定</b>，之後不能再交易。`, '穿上'))) return;
        closeSheet(); return act('equip', { itemId: e.id, position: b.dataset.pos ? Number(b.dataset.pos) : null }, `已裝備 ${e.name}`); }
      if (a === 'unequip') { closeSheet(); return act('unequip', { itemId: e.id }, `已卸下 ${e.name}`); }
      if (a === 'convert') { const ok = await confirmSheet('🔄 轉換路線', `把「${esc(e.name)}」轉成你目前路線的同階裝備？`, '轉換'); if (ok) await act('convert', { itemId: e.id }, '轉換完成'); return; }
      if (a === 'reroll') return doReroll(e);
      if (a === 'enhance') return doEnhance(e);
      if (a === 'blessed-enhance') return doBlessedEnhance(e);
    }; });
  }

  let guardianController=null,guardianActor=null;
  const SHOP_TABS = [['sell', '可販售'], ['gacha', '轉蛋'], ['weapon', '⚔️ 武器'], ['armor', '🛡️ 防具'], ['accessory', '💍 飾品'], ['potion', '🧪 藥水'], ['scroll', '📜 捲軸'], ['special', '🧿 特殊']];
  const ARMOR_FILTER = [['all', '全部'], ['armor', '盔甲'], ['helmet', '頭盔'], ['gloves', '手套'], ['boots', '長靴'], ['belt', '腰帶'], ['undershirt', '內衣']];
  function gachaCards(type=null) {
    const rates=(S.shop.gachaRates||[]).map(r=>`${r.rarity==='legendary'?'紫色傳說':'紅色霸主'} ${r.pct}%`).join(' · ');
    return (S.shop.gacha||[]).filter(g=>!type||g.type===type).map(g=>{

      return `<div class="item gacha-item"><div class="ic art">${iconHtml('gacha_'+g.type,'')}</div><div class="mid"><div class="t">${esc(g.name)}</div><div class="d">購買後存入道具庫 · 開啟時依角色等級與職業決定</div><div class="d">${esc(rates)}</div><div class="price"><img class="currency-coin" src="art/ui/hud-coin-v2.webp" alt=""> ${fmt(g.price)} 金幣 / 顆</div></div><button class="btn sm" data-gacha="${g.type}" ${S.me.character.gold<g.price?'disabled':''}>購買轉蛋</button></div>`;
    }).join('');
  }
  function shopBody() {
    if (!S.shop) return '<div class="card muted">商店載入中…</div>';
    const t = S.shopTab; const inv = S.me.inventory; let body = '';
    if (t === 'sell') return `<div class="tabs">${SHOP_TABS.map(([k, n]) => `<button data-st="${k}" class="${k === t ? 'on' : ''}">${n}</button>`).join('')}</div>${window.RpgMarketSell.render({me:S.me,autoEnhance:S.autoEnhance},{esc,fmt,gearIcon})}`;
    if(t==='gacha') { body=gachaCards(); }
    else if (t === 'weapon' || t === 'armor' || t === 'accessory') {
      if(t!=='accessory')body+=gachaCards(t);
      let list = S.shop.gear.filter((g) => (g.group || (g.slot === 'weapon' ? 'weapon' : 'armor')) === t);
      if (t === 'armor') { body += `<div class="seg chipsel">${ARMOR_FILTER.map(([k, n]) => `<button data-af="${k}" class="${S.armorSlot === k ? 'on' : ''}">${n}</button>`).join('')}</div>`; if (S.armorSlot !== 'all') list = list.filter((g) => g.slot === S.armorSlot); }
      const owned = (g) => S.me.equipment.filter((e) => e.slot === g.slot && e.tier === g.tier).length;
      body += list.map((g) => `<div class="item"><div class="ic art">${gearIcon({ ...g, classReq: S.me.character.baseClass }, SLOT_EMOJI[g.slot])}</div><div class="mid"><div class="t">${esc(g.name)} ${owned(g) ? `<span class="muted">已有 ${owned(g)}</span>` : ''}</div><div class="d">${esc(g.type)} · T${g.tier} · Lv.${g.levelReq}${g.branch ? ` · ${esc(g.branch)}路線` : ''}</div><div class="d">${esc(g.desc || '')}</div></div>
        <div style="text-align:right"><div class="price">💰${fmt(g.price)}</div><button class="btn sm mt" data-gear="${esc(g.code)}">購買</button></div></div>`).join('') || '<div class="muted card">目前沒有可買的裝備</div>';
      if (t === 'accessory') body += '<div class="muted">耳環、戒指各有 2 個欄位，全職業通用。遺物級飾品只會從首領與精英掉落。</div>';
    } else {
      const kinds = { potion: ['red', 'blue'], scroll: ['scroll'], special: ['ward', 'reselect', 'bound'] }[t];
      const list = S.shop.items.filter((i) => S.meta.items[i.item] && kinds.includes(S.meta.items[i.item].kind));
      const qtys = t === 'potion' ? [10, 50, 100] : [1, 5];
      body = list.map((i) => { const art = iconHtml(i.item, ''); return `<div class="item"><div class="ic${art ? ' art' : ''}">${art || itemEmoji(i.item)}</div><div class="mid"><div class="t">${esc(i.name)} <span class="muted" data-shop-held="${esc(i.item)}">持有 ${fmt(inv[i.item] || 0)}</span></div><div class="d">${esc(i.desc || '')}</div><div class="price">💰${fmt(i.price)} / 個</div></div>
        <div style="display:flex;flex-direction:column;gap:4px">${qtys.map((q) => `<button class="btn sm ${q === qtys[0] ? '' : 'ghost'}" data-buy="${esc(i.item)}" data-q="${q}">×${q}</button>`).join('')}</div></div>`; }).join('') || '<div class="muted card">目前沒有商品</div>';
      if (t === 'special') body += '<div class="muted">🧿 守護符：死亡時自動抵銷 EXP 損失；決鬥落敗掉裝時也會擋下（各消耗 1 張，有持有上限）。📖 命運轉職書：轉職後可重選路線（有冷卻）。</div>';
      if (t === 'scroll') body += '<div class="muted">🔓 赫密士解契卷：解除「未穿戴」裝備的綁定，之後可交易、分享。每次用的張數＝裝備階 T × 品階倍率（遺物 ×3）＋強化每 3 級 +1。</div>';
    }
    return `<div class="tabs">${SHOP_TABS.map(([k, n]) => `<button data-st="${k}" class="${k === t ? 'on' : ''}">${n}</button>`).join('')}</div>${body}`;
  }
  let marketController=null,marketActor=null,marketShopRef=null,marketShopTab=null,marketShopSaleSignature=null,shopForActor=null;
  function marketSaleSignature() {
    // Only changes visible to the merchant rebuild this hall. Gold/HP updates
    // leave the exchange form and its focused input in place.
    return JSON.stringify([(S.me?.equipment||[]).map(e=>[e.id,e.name,e.tier,e.slot,e.slotName,e.art,e.rarity,e.rarityName,e.grade,e.enhance,e.sellPrice,e.equipped,e.inTrade,e.sellBlock]),S.autoEnhance?.itemId||null,S.autoEnhance?.status||null]);
  }
  function shopView() { return window.RpgMarketExchange.shell(String(S.me.character.tgId),shopBody(),esc); }
  function updateShopSurface(force=false) {
    const body=document.querySelector('[data-market-shop-body]');if(!body)return;
    const saleSignature=S.shopTab==='sell'?marketSaleSignature():null;
    if(force||marketShopRef!==S.shop||marketShopTab!==S.shopTab||marketShopSaleSignature!==saleSignature){body.innerHTML=shopBody();marketShopRef=S.shop;marketShopTab=S.shopTab;marketShopSaleSignature=saleSignature;if(S.shopTab!=='sell')window.RpgMarketSell?.reset();bindShop(body);window.RpgMarketExchange.decorate(document.getElementById('view'));}
    body.querySelectorAll('[data-shop-held]').forEach(el=>{el.textContent='持有 '+fmt(S.me.inventory[el.dataset.shopHeld]||0);});
  }
  function mountMarket(view) {
    marketActor=String(S.me.character.tgId);marketShopRef=S.shop;marketShopTab=S.shopTab;marketShopSaleSignature=S.shopTab==='sell'?marketSaleSignature():null;
    const key=actor=>`elfRpgExchangePending:${devTg||tg?.initDataUnsafe?.user?.id||'account'}:${actor}`;
    marketController=window.RpgMarketExchange.mount(view,{esc,fmt,gearIcon,characterId:()=>S.me?.character?.tgId,api,requestId:window.RpgMarketExchange.requestId,
      itemIcon:item=>item?.startsWith('book_')?`<img src="/expedition/assets/skills-painted-20261011/${esc(item.slice(5))}.webp" alt="" loading="lazy">`:iconHtml(item,itemEmoji(item)),
      confirm:confirmSheet,toast,showDetail:html=>{const c=sheet(html+'<button type="button" class="btn ghost" data-market-close>返回</button>');c.querySelector('[data-market-close]').onclick=closeSheet;},
      loadPending:actor=>{try{return JSON.parse(localStorage.getItem(key(actor))||'null');}catch{return null;}},savePending:(actor,value)=>{if(value)localStorage.setItem(key(actor),JSON.stringify(value));else localStorage.removeItem(key(actor));},
      onBalance:value=>{if(String(value.characterId)===String(S.me?.character?.tgId)&&value.revision>=S.me.character.revision){S.me.character.gold=value.gold;S.me.character.revision=value.revision;renderHud();}},
      onChanged:()=>{void refreshMe({silent:true,full:true});}
    });
  }
  function openGuardianShop(itemId=null,quality='all') {
    const owner=String(S.me?.character?.tgId||'');if(!owner)return;
    window.RpgGuardianShop.open({actor:()=>String(S.me?.character?.tgId||''),api,sheet,close:closeSheet,onSold:async result=>{await refreshMe({silent:true,full:true});if(String(S.me?.character?.tgId)!==owner)return;renderHud();if(guardianController){const next=await window.RpgGuardianHost.state();if(String(S.me?.character?.tgId)===owner)guardianController.update({state:next});}toast('已出售 '+result.count+' 位天使，獲得 '+fmt(result.gold)+' 金幣');}},{itemId,quality});
  }
  function bindShop(view) {
    if (S.shopTab === 'sell') window.RpgMarketSell.bind(view, {esc,fmt,gearIcon,confirmSheet,toast,detail:itemSheet,openGuardians:()=>openGuardianShop(),getState:()=>({me:S.me,autoEnhance:S.autoEnhance}),sell:async itemIds=>{
      const result=await act('sell-gear-batch',{itemIds},j=>`已販售 ${j.result.count} 件裝備，獲得 ${fmt(j.result.gold)} 金幣`);
      if(!result)await refreshMe({silent:true,full:true});return result;
    }});
    view.querySelectorAll('[data-gacha]').forEach(button=>{button.onclick=async()=>{
      if(button.disabled)return;button.disabled=true;
      const actor=S.me.character.tgId,g=S.shop.gacha.find(x=>x.type===button.dataset.gacha);
      try{
        if(!await confirmSheet(esc(g.name),`花費 ${fmt(g.price)} 金幣購買 1 顆存入道具背包？<br>開啟時依角色當下等級、職業決定裝備。<br>紫色傳說 85% · 紅色霸主 15%`,'購買轉蛋'))return;
        if(actor!==S.me?.character?.tgId)return;
        const j=await act('gacha',{type:g.type});
        if(j?.result){toast('已購買 '+g.name+'，請到英雄的道具庫開啟');}
      }finally{button.disabled=false;}
    };});
    view.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { S.shopTab = b.dataset.st; updateShopSurface(true); }; });
    view.querySelectorAll('[data-af]').forEach((b) => { b.onclick = () => { S.armorSlot = b.dataset.af; updateShopSurface(true); }; });
    view.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => act('buy', { item: b.dataset.buy, qty: Number(b.dataset.q) }, `🛒 購買 ${itemName(b.dataset.buy)} ×${b.dataset.q}`).then((j) => { if (j) loadShop(true); }); });
    view.querySelectorAll('[data-gear]').forEach((b) => { b.onclick = async () => {
      const g = S.shop.gear.find((x) => x.code === b.dataset.gear);
      if (!(await confirmSheet('🛒 購買裝備', `花費 💰${fmt(g.price)} 購買「${esc(g.name)}」？<br><span class="muted">屬性與稀有度在購買時隨機決定。</span>`, '購買'))) return;
      const j = await act('buy-gear', { code: g.code }); if (j && j.result) { const it = j.result.item; const v = S.me.equipment.find((x) => x.id === it.id); toast(`🎁 獲得 ${it.name}${v ? `（${v.rarityName} · ${v.elementName}）` : ''}`); S.tab = 'bag'; render(); if (v) itemSheet(v.id); }
    }; });
  }

  // Use exact lineage identities, without the combat resolver's parent-branch fallback.
  function lineagePortrait(key) { return (V2&&window.RpgHeroArtRegistry?.resolve(key,'portrait')) || HERO_DISPLAY[key] || artSrc('portrait', key); }
  function branchCard(cls, b, opts = {}) {
    const path=opts.path || b.path || b.branch || '';
    const live=S.meta?.classes?.[cls]?.lineageNodes?.find(node=>node.path===path);
    b={...b,...(live?{blurb:live.blurb,passive:live.passive.text,weapon:live.weapon}: {})};
    const sk = b.skill || {}, key=path?`adv${path.length}_${cls}_${path}_${S.me.character.gender}`:`${cls}_${S.me.character.gender}`, portrait=lineagePortrait(key);
    return `<div class="branch ${opts.current ? 'pick' : ''}"><div class="top">${portrait?`<img class="lineage-portrait" data-lineage-key="${esc(key)}" src="${esc(portrait)}" alt="${esc(b.name)}">`:`<span class="hero-fit-frame" data-slot="lineage" role="img" aria-label="${esc(b.name)}外觀製作中">🗡️</span>`}<div style="flex:1"><div class="cls">${esc(b.name)} ${opts.current ? `<span class="chip">${path===S.me.character.classPath?'目前':'已傳承'}</span>` : ''}</div><div class="muted">${esc(b.line || '')}${b.weapon ? ` · 武器：${esc(b.weapon)}` : ''}</div><div style="font-size:13px;margin-top:4px">${esc(b.blurb || '')}</div></div></div>
      <div class="sk"><div><b>${esc(sk.name)}</b>技能</div><div><b>${sk.cost} MP</b>消耗</div><div><b>×${lineageNumber(sk.mult)} · ${sk.targets || 1}體</b>倍率</div></div>
      <div class="muted mt">路線被動：${esc(b.passive)}</div>${live?.effect ? `<div class="muted mt">效果：${esc(live.effect)}</div>` : ''}${live?.inheritance ? `<div class="muted mt">${esc(live.inheritance)}</div>` : ''}${opts.button || ''}</div>`;
  }
  const ELF_STAGES = [{"tier":0,"title":"初始・森林妖精","preview":false,"entries":[{"path":"","name":"森林妖精","theme":"葉芽與自然弓","skill":null,"passive":null}]},{"tier":1,"title":"一轉・精靈誓約","preview":false,"entries":[{"path":"A","name":"風語妖精","theme":"青空風紋、輕弓、羽翼披風","skill":null,"passive":null},{"path":"B","name":"靈獸妖精","theme":"森綠獸紋、靈獸圖騰、木靈護肩","skill":null,"passive":null}]},{"tier":2,"title":"二轉・雙重專精","preview":false,"entries":[{"path":"A1","name":"逐風神射","theme":"銀羽長弓、鷹眼金紋","skill":null,"passive":null},{"path":"A2","name":"蒼穹風舞","theme":"嵐風長披、風刃與羽衣","skill":null,"passive":null},{"path":"B1","name":"森靈馭獸","theme":"狼鷹雙靈、鹿角護肩","skill":null,"passive":null},{"path":"B2","name":"月影獵使","theme":"銀月陷阱、影葉符咒","skill":null,"passive":null}]},{"tier":3,"title":"三轉・精靈王傳承（規劃中）","preview":true,"entries":[{"path":"A11","name":"星風聖射","theme":"星風聖弓、白金羽甲與風翼","skill":{"name":"星風聖射・秘技","cost":26,"mult":3.6,"targets":3},"passive":{"text":"精靈祝福：攻擊 +8%","atkPct":0.08}},{"path":"A12","name":"蒼穹裁決者","theme":"蒼穹裁決、冰晶長弓與銀藍神羽","skill":{"name":"蒼穹裁決者・秘技","cost":29,"mult":3.85,"targets":3},"passive":{"text":"自然共鳴：受傷 −8%","takenPct":-0.08}},{"path":"A21","name":"暴風先知","theme":"暴風先知、嵐潮披風與風雷符紋","skill":{"name":"暴風先知・秘技","cost":26,"mult":3.6,"targets":3},"passive":{"text":"精靈祝福：攻擊 +8%","atkPct":0.08}},{"path":"A22","name":"天羽御風者","theme":"天羽御風、白金風羽與神聖弓矢","skill":{"name":"天羽御風者・秘技","cost":29,"mult":3.85,"targets":3},"passive":{"text":"自然共鳴：受傷 −8%","takenPct":-0.08}},{"path":"B11","name":"萬獸祭司","theme":"月桂、森林靈獸與自然魔法","skill":{"name":"萬獸祭司・秘技","cost":26,"mult":3.6,"targets":4},"passive":{"text":"精靈祝福：攻擊 +8%","atkPct":0.08}},{"path":"B12","name":"古森召靈師","theme":"古森召靈、月青古樹靈與白金藤甲","skill":{"name":"古森召靈師・秘技","cost":29,"mult":3.85,"targets":4},"passive":{"text":"自然共鳴：受傷 −8%","takenPct":-0.08}},{"path":"B21","name":"皎月巡狩","theme":"皎月巡狩、月銀羽甲與新月箭矢","skill":{"name":"皎月巡狩・秘技","cost":26,"mult":3.6,"targets":4},"passive":{"text":"精靈祝福：攻擊 +8%","atkPct":0.08}},{"path":"B22","name":"荊棘影衛","theme":"荊棘影衛、暗藤甲冑與赤棘獵弓","skill":{"name":"荊棘影衛・秘技","cost":29,"mult":3.85,"targets":4},"passive":{"text":"自然共鳴：受傷 −8%","takenPct":-0.08}}]},{"tier":4,"title":"四轉・神樹覺醒（規劃中）","preview":true,"entries":[{"path":"A111","name":"永恆風冠","theme":"永恆風冠・象牙白金冠冕與天青風翼","skill":{"name":"永恆風冠・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"A112","name":"群星神弓","theme":"群星神弓・星夜靛藍披風與星座弓矢","skill":{"name":"群星神弓・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}},{"path":"A121","name":"蒼穹神判","theme":"蒼穹神判・銀藍雷紋神弓與天穹符印","skill":{"name":"蒼穹神判・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"A122","name":"聖光獵星","theme":"聖光獵星・日耀白金甲與聖光星矢","skill":{"name":"聖光獵星・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}},{"path":"A211","name":"太初風皇","theme":"太初風皇・翡翠青金風暴羽甲","skill":{"name":"太初風皇・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"A212","name":"九霄御風","theme":"九霄御風・雲白天藍羽翼與九霄長弓","skill":{"name":"九霄御風・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}},{"path":"A221","name":"天羽聖主","theme":"天羽聖主・白金神羽冠與天界弓","skill":{"name":"天羽聖主・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"A222","name":"嵐靈神使","theme":"嵐靈神使・青碧風靈緞帶與靈弓","skill":{"name":"嵐靈神使・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}},{"path":"B111","name":"太古森皇","theme":"太古森皇・古木翠甲與森林靈冠","skill":{"name":"太古森皇・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"B112","name":"萬獸神尊","theme":"萬獸神尊・獸靈金紋與森綠神弓","skill":{"name":"萬獸神尊・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}},{"path":"B121","name":"世界樹祭主","theme":"世界樹祭主・世界樹翡翠符文與根脈披風","skill":{"name":"世界樹祭主・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"B122","name":"精靈祖靈","theme":"精靈祖靈・月白祖靈長袍與古老靈紋","skill":{"name":"精靈祖靈・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}},{"path":"B211","name":"永夜月神","theme":"永夜月神・深靛月銀甲與新月神弓","skill":{"name":"永夜月神・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"B212","name":"銀月聖獵","theme":"銀月聖獵・銀白月紋獵裝與冷光弓矢","skill":{"name":"銀月聖獵・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}},{"path":"B221","name":"荊棘聖王","theme":"荊棘聖王・暗翡翠棘甲與赤金荊棘弓","skill":{"name":"荊棘聖王・終章","cost":42,"mult":4.6,"targets":4},"passive":{"text":"神聖風靈：攻擊 +12%","atkPct":0.12}},{"path":"B222","name":"幽林守護","theme":"幽林守護・幽綠古木甲與林影符文","skill":{"name":"幽林守護・終章","cost":46,"mult":4.949999999999999,"targets":5},"passive":{"text":"神木加護：最大生命 +12%","maxHpPct":0.12}}]}];
  const MAGE_STAGES = [{"tier":0,"title":"初始・魔法學徒","preview":false,"entries":[{"path":"","name":"法師","theme":"星紋法袍、初始魔杖","skill":null,"passive":null}]},{"tier":1,"title":"一轉・魔力覺醒","preview":false,"entries":[{"path":"A","name":"元素術士","theme":"元素晶核、雷炎法杖","skill":{"name":"連鎖閃電","cost":14,"mult":2.3,"targets":3},"passive":{"text":"元素親和：相剋效果 +10%","elemPct":0.1}},{"path":"B","name":"秘法師","theme":"奧術魔導書、紫晶符文","skill":{"name":"奧術飛彈","cost":10,"mult":2.1,"targets":1},"passive":{"text":"法力回流：15% 機率不耗魔","freeCastPct":0.15}}]},{"tier":2,"title":"二轉・魔導專精","preview":false,"entries":[{"path":"A1","name":"大魔導士","theme":"烈焰、寒霜與元素法環","skill":{"name":"隕石術","cost":30,"mult":3.4,"targets":4},"passive":{"text":"魔導：ATK +10%","atkPct":0.1}},{"path":"A2","name":"冰霜術士","theme":"烈焰、寒霜與元素法環","skill":{"name":"暴風雪","cost":24,"mult":2.8,"targets":4},"passive":{"text":"冰甲：受傷 −20%","takenPct":-0.2}},{"path":"B1","name":"時空術士","theme":"時之沙、召喚契約與秘法","skill":{"name":"時間扭曲","cost":22,"mult":2.6,"targets":1},"passive":{"text":"時之沙：EXP +10%","expPct":0.1}},{"path":"B2","name":"召喚師","theme":"時之沙、召喚契約與秘法","skill":{"name":"召喚火精靈","cost":26,"mult":2.4,"targets":3},"passive":{"text":"使魔護盾：受傷 −25%","takenPct":-0.25}}]},{"tier":3,"title":"三轉・奧術昇華（尚未開放）","preview":true,"entries":[{"path":"A11","name":"星炎大賢者","theme":"金紅神炎與流星法陣","skill":{"name":"星炎大賢者・奧義","cost":29,"mult":3.65,"targets":5},"passive":{"text":"魔導共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"A12","name":"天隕魔導師","theme":"金紅神炎與流星法陣","skill":{"name":"天隕魔導師・奧義","cost":33,"mult":3.95,"targets":5},"passive":{"text":"魔能結界：受傷 −10%","takenPct":-0.1}},{"path":"A21","name":"永霜詠唱者","theme":"冰晶王冠與極光魔法","skill":{"name":"永霜詠唱者・奧義","cost":29,"mult":3.65,"targets":5},"passive":{"text":"魔導共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"A22","name":"極光冰術師","theme":"冰晶王冠與極光魔法","skill":{"name":"極光冰術師・奧義","cost":33,"mult":3.95,"targets":5},"passive":{"text":"魔能結界：受傷 −10%","takenPct":-0.1}},{"path":"B11","name":"時序預言者","theme":"紫金時輪與時空裂隙","skill":{"name":"時序預言者・奧義","cost":29,"mult":3.65,"targets":2},"passive":{"text":"魔導共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"B12","name":"虛空旅法師","theme":"紫金時輪與時空裂隙","skill":{"name":"虛空旅法師・奧義","cost":33,"mult":3.95,"targets":2},"passive":{"text":"魔能結界：受傷 −10%","takenPct":-0.1}},{"path":"B21","name":"星靈召喚師","theme":"星界召喚陣與契約符文","skill":{"name":"星靈召喚師・奧義","cost":29,"mult":3.65,"targets":4},"passive":{"text":"魔導共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"B22","name":"深淵契約者","theme":"星界召喚陣與契約符文","skill":{"name":"深淵契約者・奧義","cost":33,"mult":3.95,"targets":4},"passive":{"text":"魔能結界：受傷 −10%","takenPct":-0.1}}]},{"tier":4,"title":"四轉・神域覺醒（尚未開放）","preview":true,"entries":[{"path":"A111","name":"太陽神炎使","theme":"金紅神炎與流星法陣","skill":{"name":"日冕焚界","cost":44,"mult":4.85,"targets":5},"passive":{"text":"日冕共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"A112","name":"熾天聖魔導","theme":"金紅神炎與流星法陣","skill":{"name":"熾天裁決","cost":48,"mult":5.15,"targets":5},"passive":{"text":"熾羽結界：受傷 −10%","takenPct":-0.1}},{"path":"A121","name":"滅星魔皇","theme":"金紅神炎與流星法陣","skill":{"name":"星核崩滅","cost":44,"mult":4.85,"targets":5},"passive":{"text":"星核共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"A122","name":"隕日裁決者","theme":"金紅神炎與流星法陣","skill":{"name":"隕日終審","cost":48,"mult":5.15,"targets":5},"passive":{"text":"隕日結界：受傷 −10%","takenPct":-0.1}},{"path":"A211","name":"永恆霜皇","theme":"冰晶王冠與極光魔法","skill":{"name":"永霜王域","cost":44,"mult":4.85,"targets":5},"passive":{"text":"霜皇共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"A212","name":"絕對零度之主","theme":"冰晶王冠與極光魔法","skill":{"name":"零界封絕","cost":48,"mult":5.15,"targets":5},"passive":{"text":"零界結界：受傷 −10%","takenPct":-0.1}},{"path":"A221","name":"極光聖賢","theme":"冰晶王冠與極光魔法","skill":{"name":"極光聖降","cost":44,"mult":4.85,"targets":5},"passive":{"text":"極光共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"A222","name":"蒼穹冰神","theme":"冰晶王冠與極光魔法","skill":{"name":"蒼穹冰葬","cost":48,"mult":5.15,"targets":5},"passive":{"text":"蒼冰結界：受傷 −10%","takenPct":-0.1}},{"path":"B111","name":"時光主宰","theme":"紫金時輪與時空裂隙","skill":{"name":"時序崩解","cost":44,"mult":4.85,"targets":2},"passive":{"text":"時輪共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"B112","name":"命運編織者","theme":"紫金時輪與時空裂隙","skill":{"name":"命運斷章","cost":48,"mult":5.15,"targets":2},"passive":{"text":"命運結界：受傷 −10%","takenPct":-0.1}},{"path":"B121","name":"虛空法神","theme":"紫金時輪與時空裂隙","skill":{"name":"虛空湮滅","cost":44,"mult":4.85,"targets":2},"passive":{"text":"虛空共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"B122","name":"次元界行者","theme":"紫金時輪與時空裂隙","skill":{"name":"次元裂隙","cost":48,"mult":5.15,"targets":2},"passive":{"text":"次元結界：受傷 −10%","takenPct":-0.1}},{"path":"B211","name":"萬靈聖召者","theme":"星界召喚陣與契約符文","skill":{"name":"萬靈降臨","cost":44,"mult":4.85,"targets":4},"passive":{"text":"萬靈共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"B212","name":"星界君王","theme":"星界召喚陣與契約符文","skill":{"name":"星界御令","cost":48,"mult":5.15,"targets":4},"passive":{"text":"星界結界：受傷 −10%","takenPct":-0.1}},{"path":"B221","name":"深淵魔契王","theme":"星界召喚陣與契約符文","skill":{"name":"深淵魔召","cost":44,"mult":4.85,"targets":4},"passive":{"text":"魔契共鳴：法術攻擊 +10%","atkPct":0.1}},{"path":"B222","name":"幽冥萬象師","theme":"星界召喚陣與契約符文","skill":{"name":"冥界開門","cost":48,"mult":5.15,"targets":4},"passive":{"text":"幽冥結界：受傷 −10%","takenPct":-0.1}}]}];
  function advancedPreviewNodes(stage,cls) {
    if(stage.tier<3)return stage.entries;
    const live=S.meta?.advancedSpecializations?.[cls]||{};
    return stage.entries.map(v=>live[v.path]?{...v,...live[v.path]}:{...v,skill:null,passive:{text:'請更新遊戲以載入實際專精數值。'}});
  }
  function lineageNumber(value) { return Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(4))) : '—'; }
  function lineageDetails(node) {
    const sk=node.skill;
    return `${node.blurb ? `<small class="lineage-description">定位：${esc(node.blurb)}${node.role ? ` · ${esc(node.role)}` : ''}</small>` : ''}${node.weapon ? `<small>武器：${esc(node.weapon)}</small>` : ''}${sk ? `<small class="lineage-skill">原生技能：${esc(sk.name)} · 基礎 MP ${lineageNumber(sk.cost)} · ×${lineageNumber(sk.mult)} · 最多 ${lineageNumber(sk.targets)} 體</small>` : ''}${node.passive ? `<small class="lineage-passive">路線被動：${esc(node.passive.text || node.passive)}</small>` : ''}${node.effect ? `<small class="lineage-effect">效果：${esc(node.effect)}</small>` : ''}${node.inheritance ? `<small>${esc(node.inheritance)}</small>` : ''}`;
  }
  function classPathPreview(c) {
    const cls=c.baseClass, nodes=S.meta.classes[cls]?.lineageNodes;
    if(!nodes?.length)return '<section class="elf-ancestry"><p>傳承資料尚未載入，請重新開啟遊戲。</p></section>';
    const gender=c.gender==='f'?'f':'m', current=String(c.classPath||'');
    const labels={sword:'⚔️ 劍之傳承',archer:'❧ 精靈血脈',mage:'✧ 奧術傳承',thief:'🗡️ 夜刃傳承'};
    const themes=cls==='archer'?ELF_STAGES:cls==='mage'?MAGE_STAGES:[];
    return `<section class="elf-ancestry ${cls}-ancestry advanced-specializations" aria-label="${esc(S.meta.classes[cls].name)}完整成長樹"><div class="elf-ancestry-title"><span>${labels[cls]} · ${gender==='f'?'女性':'男性'}</span><small>零至四轉完整路線；高亮為目前傳承。</small></div><p class="lineage-rules">職業基礎：${esc(nodes[0].basePassive)}${cls==='thief'?`；${esc(window.RpgThiefClass.traits(S.meta.classes[cls]))}`:''}。技能列出原生基礎值，實際耗魔與倍率請看「當前傳承」；裝備、天使及能力加成會影響實戰數值。戰技書需另外取得、學習並配置，可在「特殊技能傳承」點圖示查看效果與取得副本。</p><div class="elf-progression">${[0,1,2,3,4].map(tier=>{
      const entries=nodes.filter(n=>n.tier===tier), first=entries[0];
      return `<div class="elf-tier"><h4>${['零轉','一轉','二轉','三轉','四轉'][tier]} <em>Lv.${first.level}${tier?' · '+esc(first.materialName)+' ×1':''}</em></h4>${tier?`<p class="lineage-requirement">需求：完成前一階轉職、Lv.${first.level}、${esc(first.materialName)} ×1。取得：${esc(first.materialSource)}。</p>`:''}<div class="elf-nodes">${entries.map(node=>{
        const path=node.path, key=path?`adv${tier}_${cls}_${path}_${gender}`:`${cls}_${gender}`, portrait=lineagePortrait(key);
        const selected=path===current, ancestor=path!==current&&current.startsWith(path);
        const theme=themes.find(s=>s.tier===tier)?.entries.find(n=>n.path===path)?.theme;
        return `<div class="elf-node ${tier>c.classTier?'locked':'available'} ${selected?'chosen':ancestor?'ancestor':''}" data-lineage-path="${esc(path)}"${selected?' aria-current="step"':''}><span class="elf-rune">${portrait?`<img class="elf-preview-art" data-lineage-key="${esc(key)}" src="${esc(portrait)}" alt="${esc(node.name)}" loading="lazy">`:`<span aria-label="${esc(S.meta.classes[cls].name)}外觀製作中">${S.meta.classes[cls].emoji||'✧'}</span>`}</span><strong>${esc(node.name)}${selected?' · 目前':ancestor?' · 已傳承':''}</strong>${tier?`<small class="lineage-parent">承接：${esc(node.parentName)}（${esc(node.parentPath||'零轉')} → ${esc(path)}）${ancestor||selected?'':' · '+(tier>c.classTier?'尚未轉職':'其他路線')}</small>`:''}${theme?`<small>外觀：${esc(theme)}</small>`:''}${lineageDetails(node)}</div>`;
      }).join('')}</div></div>`;
    }).join('')}</div></section>`;
  }
  function elfPathPreview(c) { return classPathPreview({...c,baseClass:'archer'}); }
  function magePathPreview(c) { return classPathPreview({...c,baseClass:'mage'}); }
  function thiefPathPreview(c) { return classPathPreview({...c,baseClass:'thief'}); }
  function classView() {
    const me = S.me, c = me.character, g = me.gate; const base = S.meta.classes[c.baseClass];
    const currentNode=base.lineageNodes?.find(node=>node.path===String(c.classPath||''));
    let html = `<div class="lc-class-title"><span>✥ CHARACTER / STATUS</span><strong>${esc(c.name)} · Lv.${c.level}</strong></div><div class="card"><h3>✨ 職業 <small>${esc(base.name)}系</small></h3><div class="hero">${portraitHtml('cpt')}<div class="info"><div class="cls">${esc(c.className)}</div><div class="muted">Lv.${c.level} · 轉職階段 ${c.classTier}</div>
      <div class="mt" style="font-size:13px">${currentNode?.blurb?`${esc(currentNode.blurb)}<br>`:''}目前技能「${esc(me.stats.skill.name)}」實際 MP ${me.stats.skill.cost} · ×${lineageNumber(me.stats.skill.mult)} · 最多 ${me.stats.skill.targets} 體<br>被動：${esc(me.stats.passive)}${currentNode?.effect?`<br>效果：${esc(currentNode.effect)}`:''}${currentNode?.inheritance?`<br>${esc(currentNode.inheritance)}`:''}${c.baseClass==='thief'?`<br><span class="thief-combat-traits">${esc(window.RpgThiefClass.traits(base))}</span>`:''}</div></div></div></div>`;
    if (g.canAdvance) {
      html += `<div class="banner gate"><span class="e">🎉</span><div>${c.classTier ? `第 ${c.classTier+1} 次轉職！` : ''}已達 Lv.${(c.classTier + 1) * 30}，用「${esc(g.materialName)}」（${g.have}/1）選一條路線轉職！${currentNode?`<br>材料取得：${esc(base.lineageNodes.find(n=>n.tier===c.classTier+1)?.materialSource||'')}`:''}</div></div>`;
      html += me.branches.map((b) => branchCard(c.baseClass, b, { path: b.path, button: `<button class="btn mt" data-adv="${esc(b.branch)}" ${g.have ? '' : 'disabled'}>${g.have ? `選擇「${esc(b.name)}」` : `缺「${esc(g.materialName)}」`}</button>` })).join('');
    } else if (c.classTier >= 1) {
      const book = me.inventory.reselect_1 || 0; const cur = c.classPath[0];
      html += `<div class="card"><h3>📖 命運轉職書 I <small>持有 ${book}</small></h3><div class="muted">可把第一次轉職改成另一條路線；已完成的後續轉職保留相同分支位置。重選共用 30 分鐘冷卻；不合路線的限定裝備會卸下，可用尚未使用的轉換機會轉換。</div></div>`;
      if (c.classTier >= 2 && (me.branches2 || []).length) { const book2 = me.inventory.reselect_2 || 0; const cur2 = c.classPath[1];
        html += `<div class="card"><h3>📖 命運轉職書 II <small>持有 ${book2}</small></h3><div class="muted">把第二次轉職改成同系的另一個職業；三、四轉保留相同分支位置。與其他轉職書共用 30 分鐘冷卻。</div></div>`;
        html += me.branches2.map((b) => branchCard(c.baseClass, b, { path: b.path, current: b.branch === cur2, button: b.branch === cur2 ? '' : `<button class="btn ghost mt" data-resel2="${esc(b.branch)}" ${book2 ? '' : 'disabled'}>📖 改為「${esc(b.name)}」</button>` })).join('');
        html += `<h3 class="sect">一轉路線</h3>`; }
      html += me.branches.map((b) => branchCard(c.baseClass, b, { path: b.branch, current: b.branch === cur, button: b.branch === cur ? '' : `<button class="btn ghost mt" data-resel="${esc(b.branch)}" ${book ? '' : 'disabled'}>📖 改走「${esc(b.name)}」</button>` })).join('');
      if (g.atGate) html += `<div class="banner gate"><span class="e">🔒</span><div>下一階轉職：Lv.${g.gateLevel} + 「${esc(g.materialName)}」（${g.have}/1）</div></div>`;
    } else {
      html += `<div class="card"><h3>🔒 第一次轉職 <small>Lv.${c.level} / ${g.gateLevel}</small></h3>${bar('exp', c.level, g.gateLevel, `Lv.${c.level} / ${g.gateLevel}`)}
        <div class="mt muted">需要「${esc(g.materialName)}」（${g.have}/1）— 打倒地圖首領取得。到達 Lv.${g.gateLevel} 後會停在門檻等轉職。</div></div>`;
      html += Object.entries(base.branches).map(([k, b]) => branchCard(c.baseClass, { ...b, branch: k }, { path: k })).join('');
    }
    return `<div class="lc-class-screen">${html}${classPathPreview(c)}</div>`;
  }
  function bindClass(view) {
    drawPortrait($('#cpt', view), heroOpts({}));
    view.querySelectorAll('canvas[data-br]').forEach((cv) => { const src = V2 && artSrc('hero', heroKey(cv.dataset.cls, S.me.character.gender, cv.dataset.path)); if (src) cv.replaceWith(Object.assign(document.createElement('img'), { src, className: 'brimg' })); else drawPortrait(cv, { cls: cv.dataset.cls, gender: S.me.character.gender, path: cv.dataset.br }); });
    view.querySelectorAll('[data-adv]').forEach((b) => { b.onclick = async () => { const br = S.me.branches.find((x) => x.branch === b.dataset.adv);
      if (await confirmSheet('✨ 轉職', `確定轉職為「${esc(br.name)}」？將消耗「${esc(S.me.gate.materialName)}」×1。<br><span class="muted">之後可用命運轉職書重選。</span>`, '轉職！')) act('advance', { branch: br.branch }, `🎉 轉職成功：${br.name}`); }; });
    view.querySelectorAll('[data-resel]').forEach((b) => { b.onclick = async () => { const br = S.me.branches.find((x) => x.branch === b.dataset.resel);
      if (await confirmSheet('📖 命運轉職書', `消耗命運轉職書 I，改為「${esc(br.name)}」？${S.me.character.classTier >= 2 ? '<br><span class="muted">已完成的二至四轉會換成新路線的同位置職業（二轉可再用轉職書 II 調整）。</span>' : ''}`, '確定')) act('reselect', { tier: 1, branch: br.branch }, `📖 已改為 ${br.name}`); }; });
    view.querySelectorAll('[data-resel2]').forEach((b) => { b.onclick = async () => { const br = S.me.branches2.find((x) => x.branch === b.dataset.resel2);
      if (await confirmSheet('📖 命運轉職書 II', `消耗命運轉職書 II，二轉改為「${esc(br.name)}」？`, '確定')) act('reselect', { tier: 2, branch: br.branch }, `📖 已改為 ${br.name}`); }; });
  }

  const sNow = () => Date.now() + S.skew;
  function bossPlayerVitals() { const c=S.me.character, st=S.me.stats, receipt=BF.charId===c.tgId&&BF.bossId===(S.boss||S.lastBoss)?.id?BF.result:null; return `<div class="card"><h3>我的狀態</h3>${bar('hp',c.hp,st.maxHp,`HP ${fmt(c.hp)} / ${fmt(st.maxHp)}`)}${bar('mp',c.mp,st.maxMp,`MP ${fmt(c.mp)} / ${fmt(st.maxMp)}`)}${receipt?`<div class="muted mt">本次連擊 ${fmt(receipt.damage)} · 首領反擊 ${fmt(receipt.counter)}${receipt.downed?' · 已倒地':''}</div>`:''}</div>`; }
  function bossView() {
    const b = S.boss;
    if (b === null || b === undefined) {
      const nb = S.me.nextBoss; const slots = S.meta.bossSlots;
      return `${window.RpgBossWaiting.markup(S.lastBoss?(S.lastBoss.status==='killed'||S.lastBoss.hp<=0?'🎉 首領已擊敗':'本場首領已結束'):'首領尚未出現')}${S.lastBoss?`<div class="card">${esc(S.lastBoss.name)} · 本場已結束。角色資料會同步伺服器的結算結果。</div>`:''}${bossPlayerVitals()}
        <div class="card"><h3>⏰ 下一隻首領 <small>${nb ? `${nb.day.slice(5)} ${String(nb.hour).padStart(2, '0')}:00` : ''}</small></h3>
        <div style="font-size:28px;font-weight:900;text-align:center" id="nextCd">${nb ? mmss(nb.start - sNow()) : '--'}</div>
        <div class="seg mt" style="justify-content:center">${slots.map((h) => `<button>${String(h).padStart(2, '0')}:00</button>`).join('')}</div>
        <div class="muted mt">每個時段隨機出現一隻地圖首領（不會連續同一隻）；有人卡在轉職門檻缺材料的地圖，每天保證至少出現一次。出現時群組會發首領卡。</div></div>`;
    }
    const me = b.me || {}; const now = sNow(); const left = b.endsAt - now;
    const myRank = (b.top || []).findIndex((t) => String(t.tgId) === String(S.me.character.tgId));
    let btn;
    if (b.status !== 'active' || left <= 0) btn = '<button class="btn" disabled>首領已結束</button>';
    else if (me.hasCharacter===false) btn = '<button class="btn" disabled>需要角色</button>';
    else if (me.hasCharacter!==true) btn = '<button class="btn" disabled>同步戰況…</button>';
    else if (me.downUntil && me.downUntil > now) btn = `<button class="btn red" disabled id="atk">🪦 倒地中 <span data-cd="${me.downUntil}">${mmss(me.downUntil - now)}</span></button>`;
    else if (me.attackedThisWindow && me.nextAttackAt > now) btn = `<button class="btn" disabled id="atk">已攻擊 · <span data-cd="${me.nextAttackAt}">${mmss(me.nextAttackAt - now)}</span></button>`;
    else btn = '<button class="btn red" id="atk" style="font-size:18px;padding:14px">⚔️ 攻擊！</button>';
    return `<div class="bossbox"><canvas id="bcv"></canvas><div class="tag">${esc(b.elementEmoji || '')} ${esc(b.name)}</div><div class="timer">⏱️ <span data-cd="${b.endsAt}">${mmss(left)}</span></div></div>
      <div class="card">${bar('boss', b.hp, b.maxHp, `HP ${fmt(b.hp)} / ${fmt(b.maxHp)}`)}
        <div class="muted mt">${esc(b.mapName)} · 屬性 ${esc(b.elementName)} · 參戰 ${b.participants} 人 · 每 ${b.attackWindowMinutes} 分鐘可攻擊 1 次 · 掉落「${esc(b.material)}」</div>
        <div class="mt">${btn}</div>
        <div class="muted mt">我的輸出：${fmt(me.damage)}（${me.hits || 0} 次）${myRank >= 0 ? ` · 第 ${myRank + 1} 名` : ''}</div></div>
      ${bossPlayerVitals()}<div class="card"><h3>🏆 傷害排行 · 前 30 名</h3><div class="rank">${(b.top || []).slice(0, 30).map((t, i) => `<div class="${String(t.tgId) === String(S.me.character.tgId) ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || i + 1}</span><span>${esc(t.name)}</span><span>${fmt(t.damage)}</span></div>`).join('') || '<div class="muted">還沒有人出手，搶頭香！</div>'}</div></div>`;
  }
  const BF = { hitT: -9, dmg: 0, crit: false, result: null, bossId: null, charId: null };
  let bossWaitingCleanup = null;
  function bindBoss(view) {
    const b = S.boss;
    if (!b) { bossWaitingCleanup = window.RpgBossWaiting.mount(view.querySelector('.boss-wait')); return; }
    drawers.push({ c: $('#bcv', view), fn: (ctx, w, h, t) => {
      const mapId = Math.max(1,Math.min(12,Number(b ? b.mapId : S.me.character.mapId)||1));
      const bi = artImg('map', V2 ? `myth${String(mapId).padStart(2,'0')}` : mapId);
      if (bi) { const s = Math.max(w / bi.width, h / bi.height); ctx.drawImage(bi, (w - bi.width * s) / 2, h - bi.height * s, bi.width * s, bi.height * s); } else if(!V2)A.scene(ctx,w,h,{mapId:Math.min(4,mapId),t});else{const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#122337');bg.addColorStop(1,'#08131e');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);}
      const gy = h * 0.92; const k = t - BF.hitT;
      const heroFigure = BATTLE ? window.RpgBattle.visibleBounds(heroSprite()) : [0,0,1,1];
      const bossArtKey=b&&(BOSS_ANIM[b.spriteKey||b.name]||expansion?.spec(b.spriteKey||b.name)?b.spriteKey||b.name:b.mapId);
      const bossSheet = b ? bossAnimSprite(bossArtKey) : null;
      const bossImage = b ? artImg('boss', bossArtKey) : null;
      const bossFrame = bossSheet && bossSheet.image;
      const bossLayout = expansion?.spec(bossArtKey) || (BATTLE && bossFrame ? window.RpgBattle.layout[bossFrame.currentSrc.split('/').at(-1).split('?')[0]] : null);
      const bossFigure = BATTLE ? window.RpgBattle.visibleBounds(bossImage) : [0,0,1,1];
      const bossBody = bossLayout ? bossLayout.bodyHeight : bossFigure[3]-bossFigure[1];
      const bossHeight = expansion?.spec(bossArtKey) ? 120*(heroFigure[3]-heroFigure[1])*1.2/Math.max(.1,bossBody) : Math.min(120*(heroFigure[3]-heroFigure[1])*1.2/Math.max(.1,bossBody),120*(heroFigure[3]-heroFigure[1])*1.45/Math.max(.1,bossFigure[2]-bossFigure[0]));
      const bossRatio = bossFrame && bossFrame.naturalWidth ? (bossFrame.naturalWidth/bossSheet.cols)/(bossFrame.naturalHeight/bossSheet.rows) : bossImage ? bossImage.width/bossImage.height : 1;
      const bx = Math.min(w*.7,w-bossHeight*bossRatio/2-8);
      const bossY = gy-120*(1-heroFigure[3])+bossHeight*(1-(bossLayout ? bossLayout.feet : bossFigure[3]));
      const phase=t%8,casting=phase>=4&&phase<5,attacking=phase>=2&&phase<2.65;
      const bossAction=k>.15&&k<.45?'hurt':casting?'cast':attacking?'attack':'idle';
      if (b&&b.hp>0&&b.status==='active') { if (!drawSprite(ctx, bossImage, bx, bossY, bossHeight, { t, action:bossAction,p:casting?phase-4:attacking?(phase-2)/.65:0, attackDirection:-1, flip: [1,3].includes(Number(b.mapId)) && !bossFrame?.currentSrc.includes('monsters-clean-20261011') && !expansion?.spec(bossArtKey), sheet: bossSheet })) {if(!V2)A.boss(ctx,bx,gy,1.15,{mapId:b.mapId,t,hurt:k>.15&&k<.45});else{ctx.save();ctx.textAlign='center';ctx.font='13px serif';ctx.fillStyle='#ddc991';const meta=IMG_LOAD[artSrc('boss',bossArtKey)];ctx.fillText(meta?.failed&&meta.attempt>=3?'首領畫像暫未載入，重新開啟可重試':'正在描繪首領…',w*.68,h*.55);ctx.restore();}} }
      else { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.font = '900 90px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', w * 0.66, gy - 30); }
      if (!drawSprite(ctx, heroSprite(), w * 0.24, gy, 120, { t, action: b&&b.hp>0&&b.status==='active'&&k < 0.4 ? 'attack' : 'idle', p: k / 0.4 })) A.hero(ctx, w * 0.24, gy, 1.2, heroOpts({ t, action: b&&b.hp>0&&b.status==='active'&&k < 0.4 ? 'attack' : 'idle', p: k / 0.4 }));
      window.RpgGuardianSigil?.draw(ctx,S.me.guardian,w*.24,gy-120*heroFigure[3],48);
      if(b&&b.hp>0&&b.status==='active'&&casting&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        if(expansion?.spec(bossArtKey)&&window.RpgSkillFX?.drawMonster){const meta=expansion.spec(bossArtKey);window.RpgSkillFX.drawMonster(ctx,phase-4,{x:bx-bossHeight*.12,y:gy-bossHeight*.48},{x:w*.24,y:gy-70},window.RpgSkillFX.monsterProfile(b.spell || meta.spell,true));}
        else {
        const p=phase-4,travel=Math.max(0,Math.min(1,(p-.35)/.55)),x=bx+(w*.24-bx)*travel,y=gy-bossHeight*.48-Math.sin(travel*Math.PI)*24;
        const color=[4,7,12].includes(Number(b.mapId))?'#77dfff':[6,9].includes(Number(b.mapId))?'#ff7b36':[1,3].includes(Number(b.mapId))?'#a7e568':'#c4a1ff';
        ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=Math.sin(p*Math.PI);
        const glow=ctx.createRadialGradient(x,y,0,x,y,22);glow.addColorStop(0,'#fff');glow.addColorStop(.25,color);glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(bx,gy,18+p*20,5+p*6,p*2,0,Math.PI*2);ctx.stroke();ctx.restore();
        }
      }
      if (k >= 0 && k < 1.25 && BF.charId === S.me.character.tgId) { const q = k / 1.25; ctx.globalAlpha = 1 - q; ctx.textAlign = 'center'; ctx.font = `900 ${BF.crit ? 34 : 28}px sans-serif`; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(fmt(BF.dmg), w * 0.66, gy - 140 - q * 40); ctx.fillStyle = BF.crit ? '#ff9b4a' : '#ffe066'; ctx.fillText(fmt(BF.dmg), w * 0.66, gy - 140 - q * 40); ctx.font = '12px sans-serif'; ctx.fillText('連擊總傷害', w*.66, gy-119-q*40); if(BF.result?.counter){ctx.fillStyle='#ff918c';ctx.font='bold 16px sans-serif';ctx.fillText(`反擊 −${fmt(BF.result.counter)}`,w*.24,gy-135-q*30);} ctx.globalAlpha = 1; }
    } });
    const atk = $('#atk', view);
    if (atk && !atk.disabled) atk.onclick = async () => {
      if (S.busy) return; S.busy = true; atk.disabled = true; haptic('heavy');
      const attacker = S.me.character.tgId;
      try {
        const j = await api('boss/attack', { bossId: b.id }); absorb(j);
        if (S.me.character.tgId !== attacker) return;
        const r = j.result || {};if(r.killed)S.lastBoss={...b,status:'killed',hp:0}; BF.hitT = performance.now() / 1000; BF.dmg = r.damage || 0; BF.crit = (r.crits || 0) > 0; BF.result = r; BF.bossId = b.id; BF.charId = attacker;
        toast(`⚔️ 連擊共造成 ${fmt(r.damage)} 傷害${r.crits ? `（${r.crits} 次爆擊）` : ''}${r.killed ? ' · 🎉 首領倒下！' : ''}${r.downed ? ' · 你被打倒了' : ''}`); haptic('ok');
        render(); setTimeout(refreshMe, 1500);
      } catch (e) { toast(e.message, true); haptic('error'); render(); }
      finally { S.busy = false; }
    };
  }


  // ---------- 交易 v0.5: 分享 → 我要交易 → 擁有者確認 → 雙方鎖定 → OK ・ 決鬥 ----------
  const TSTATUS = { open: '進行中', done: '✅ 完成', cancelled: '✕ 取消', expired: '⌛ 過期' };
  const PHASE = { placing: '放置中', one_locked: '一方已鎖定', ready: '雙方已鎖定 · 等 OK', ok_wait: '等對方按 OK', done: '✅ 交易完成', cancelled: '✕ 已取消（已退回）', expired: '⌛ 太久沒動作，已退回' };
  const tradeSide = (t) => (t.me === 'b' ? [t.b, t.a] : [t.a, t.b]);
  const SLOTS = 6;
  function tradeGearDetailsHtml(l) {
    if(l.kind!=='equip')return '';
    const legacy=Object.entries(l.affix||{}).map(([k,v])=>esc(fmtBonus(k,v))).join(' · ');
    const bonus=Object.entries(l.extras||{}).concat(Object.entries(l.pct||{})).filter(([,v])=>v).map(([k,v])=>esc(fmtBonus(k,v))).join(' · ');
    const aff=l.affixes;
    return `<article class="trade-gear-detail"><b>+${Number(l.enhance)||0} ${esc(l.name)}</b><div>${esc(l.className||'全職業')} · ${esc(l.slotName)} · T${l.tier} · ${l.grade==='relic'?'遺物 · ':''}${esc(l.rarityName)} · ${esc(l.statName)} ${fmt(l.stat)}</div>${l.levelReq?`<div>需求 Lv.${Number(l.levelReq)}${l.branchReq?' · 分支 '+esc(l.branchReq):''}</div>`:''}${l.elementName?`<div>${esc(l.elementName)} +${fmt(l.elemStat||0)}</div>`:''}${bonus?`<div>裝備加成：${bonus}</div>`:''}${legacy?`<div>遺物能力：${legacy}</div>`:''}<div class="trade-affix-heading">能力詞條 · ${esc(aff?.quality||'未鑑定')}（${aff?.lines?.length||0}/${aff?.slots||0}）</div>${aff?.lines?.length?aff.lines.map(x=>`<div class="trade-affix-line"><span>${esc(x.name)} +${(Number(x.value)*100).toFixed(2)}%</span><strong>${esc(x.quality)}</strong></div>`).join(''):'<div class="muted">尚無重鑄詞條</div>'}</article>`;
  }
  function tradeConfirmSideHtml(x) {
    return `<section class="trade-confirm-side"><h4>${esc(x.name)}</h4>${x.lines.map(l=>l.kind==='equip'?tradeGearDetailsHtml(l):`<div>${esc(l.name)} ×${fmt(l.qty||1)}</div>`).join('')||'<div>沒有物品</div>'}<div>金幣 ${fmt(x.gold)} · 對方實收 ${fmt(x.goldNet)}（稅 ${fmt(x.tax)}）</div></section>`;
  }
  function tradeLineHtml(l, mine) {
    const ic = l.kind==='sigil' ? guardianTradeIcon(l) : l.kind === 'equip' ? gearIcon({ ...l, kind: l.wkind }, SLOT_EMOJI[l.slot]) : iconHtml(l.ref, l.emoji || '📦');
    const d = l.kind==='sigil' ? `${esc(l.qualityName||window.RpgGuardianContract.QUALITY_NAMES[l.quality])}色守護羽毛` : l.kind === 'equip' ? `${esc(l.slotName)} · T${l.tier} · ${l.statName} ${fmt(l.stat)} · ${esc(l.grade === 'relic' ? '遺物' : l.rarityName)}` : `×${fmt(l.qty)}`;
    return `<div class="tslot has${l.grade === 'relic' ? ' relic' : ''}${l.rarity ? ` rar-${esc(l.rarity)}` : ''}" title="${esc(l.name)}"><span class="ic">${ic}</span>${l.enhance ? `<em>+${l.enhance}</em>` : ''}${l.kind === 'item' ? `<i>${fmt(l.qty)}</i>` : ''}<small class="${l.rarity ? `tc-${esc(l.rarity)}` : ''}">${esc(l.name)}</small><small class="dd">${d}</small>${mine ? `<button class="x" data-rm="${esc(l.kind)}:${esc(l.ref)}" aria-label="取回">✕</button>` : ''}</div>`;
  }
  function guardianTradeIcon(item){const url=window.RpgGuardianContract.safeArtUrl(item.artUrl)||('/art/guardian-sigil-20261013/'+(Object.hasOwn(window.RpgGuardianContract.TYPE_NAMES,item.type)?item.type:'melee')+'.webp');return '<img class="guardian-trade-art" src="'+esc(url)+'" alt="'+esc(item.name||window.RpgGuardianContract.TYPE_NAMES[item.type])+'" style="width:50px;height:60px;object-fit:contain">';}
  function tradePanel(t, x, role, isMe, open) {
    const canEdit = isMe && open && !x.locked; const cells = x.lines.map((l) => tradeLineHtml(l, canEdit));
    for (let i = cells.length; i < SLOTS; i++) cells.push(`<div class="tslot${canEdit && i === x.lines.length ? ' add" data-tadd="pick' : ''}">${canEdit && i === x.lines.length ? '<span class="ph">＋</span>' : ''}</div>`);
    return `<div class="tpanel ${x.locked ? 'locked' : ''} ${x.ok ? 'ok' : ''} ${isMe ? 'mine' : ''}"><h4><span class="role">${role}</span> ${esc(x.name)}${isMe ? '（我）' : ''}<span class="flags">${x.locked ? '<span class="chip lock">🔒 已鎖定</span>' : '<span class="chip">放置中</span>'}${x.ok ? '<span class="chip ok">✅ OK</span>' : ''}</span></h4>
      <div class="tslots">${cells.join('')}</div><div class="trade-gear-details">${x.lines.map(tradeGearDetailsHtml).join('')}</div>
      <div class="tgold">💰 ${fmt(x.gold)}${x.gold ? ` <small>→ 對方實收 ${fmt(x.goldNet)}（稅 ${fmt(x.tax)}）</small>` : ''}${canEdit ? ' <button class="btn sm ghost" data-tadd="gold">設定金幣</button>' : ''}</div>
      ${canEdit ? '<div class="row mt"><button class="btn sm ghost" data-tadd="equip">＋裝備</button><button class="btn sm ghost" data-tadd="item">＋道具</button><button class="btn sm ghost" data-tadd="sigil">＋守護羽毛</button></div>' : ''}</div>`;
  }
  function tradeWindowHtml(t) {
    const open = t.status === 'open'; const [mine] = tradeSide(t); const other = t.me === 'a' ? t.b : t.a;
    const both = t.a.locked && t.b.locked; const meta = S.meta.trade || {};
    const ph = open ? PHASE[t.phase] || '' : PHASE[t.status];
    let actions = '';
    if (open) {
      actions = `<div class="tact">${mine.locked ? '<button class="btn ghost" disabled>🔒 我已鎖定</button>' : '<button class="btn" id="tlock">🔒 鎖定</button>'}
        <button class="btn gold" id="tok" ${both && !mine.ok ? '' : 'disabled'}>${mine.ok ? '✅ 已確認交易' : '確認交易'}</button>
        <button class="btn red" id="tcancel">✕ 取消</button></div>
        <div class="muted mt">${!mine.locked ? '放好要給的物品與金幣後按「🔒 鎖定」。鎖定後不能再加減（要改就取消重來）。' : !other.locked ? `等 ${esc(other.name)} 鎖定…` : mine.ok ? `等待 ${esc(other.name)} 確認交易…` : '雙方已鎖定。請核對裝備、道具與金幣，再按「確認交易」。雙方確認後才會成交。'}
        金幣收 ${Math.round((t.taxPct || meta.taxPct || 0.05) * 100)}% 稅。${t.idleMinutes || meta.idleMinutes || 30} 分鐘沒有動作會自動取消並退回。</div>`;
    } else if (t.status === 'done') actions = `<div class="tdone">🎉 交易完成！物品已送到雙方背包${t.taxGold ? ` · 稅 💰${fmt(t.taxGold)}` : ''}</div>`;
    else actions = `<div class="muted mt">${PHASE[t.status] || t.status}，物品與金幣都已退回。</div>`;
    return `<div class="card twin phase-${esc(open ? t.phase : t.status)}"><h3>🤝 與 ${esc(other.name)} 交易 <small>${ph}${open ? ` · <span data-cd="${t.expiresAt}">${mmss(t.expiresAt - sNow())}</span>` : ''}</small></h3>
      ${actions}
      ${tradePanel(t, t.a, '發起人', t.me === 'a', open)}
      <div class="tswap">⇅</div>
      ${tradePanel(t, t.b, '接受者', t.me === 'b', open)}
      <button class="btn ghost mt" id="tback">↩️ 交易列表</button></div>
      <div class="card"><h3>🧾 交易紀錄</h3><div class="log" id="tlog"><div class="muted">載入中…</div></div></div>`;
  }
  function reqItemHtml(r, kind) {
    const it = r.item || {}; const who = kind === 'in' ? r.requester : r.owner;
    const left = r.expiresAt - sNow(); const pend = r.status === 'pending';
    const requestStatus=r.status==='accepted'&&r.tradeStatus&&r.tradeStatus!=='open'?r.tradeStatus:r.status;
    const st = { done:'已成交',closed:'已結束', pending: '等待確認', accepted: '✅ 已開窗', rejected: '✕ 已婉拒', expired: '⌛ 過期', cancelled: '已撤回' }[requestStatus] || requestStatus;
    const btns = !pend ? (requestStatus === 'accepted' && r.tradeId ? `<button class="btn sm" data-otrade="${esc(r.tradeId)}">打開</button>` : '')
      : kind === 'in' ? `<div class="col2"><button class="btn sm gold" data-racc="${esc(r.id)}">確認</button><button class="btn sm ghost" data-rrej="${esc(r.id)}">拒絕</button></div>` : `<button class="btn sm ghost" data-rwd="${esc(r.id)}">撤回</button>`;
    return `<div class="item${it.grade === 'relic' ? ' relic' : ''}"><div class="ic rar-${esc(it.rarity || 'common')}">${it.kind==='sigil'?guardianTradeIcon(it):gearIcon({ ...it, classReq: it.classReq }, SLOT_EMOJI[it.slot] || '⚔️')}${it.enhance ? `<em>+${it.enhance}</em>` : ''}</div><div class="mid">
      <div class="t">${kind === 'in' ? `${esc(who.name)} 想要` : `向 ${esc(who.name)} 要`}【${it.enhance ? `+${it.enhance} ` : ''}${esc(it.name || '?')}】</div>
      <div class="d">${kind === 'in' && who.level ? `Lv.${who.level} ${esc((S.meta.classes[who.baseClass] || {}).name || '')} · ` : ''}${st}${pend ? ` · 剩 <span data-cd="${r.expiresAt}">${mmss(left)}</span>` : ''}</div></div>${btns}</div>`;
  }
  function tradeListHtml() {
    const meta = S.meta.trade || {}; const L = S.trades; const R = S.reqs;
    const inPend = R ? R.incoming.filter((r) => r.status === 'pending') : []; const outAll = R ? R.outgoing.filter(r=>r.status==='pending'||(r.status==='accepted'&&r.tradeStatus==='open')).slice(0,8) : [];
    const card = (t) => { const [mine, theirs] = tradeSide(t); return `<div class="item" data-trade="${esc(t.id)}"><div class="ic">🤝</div><div class="mid"><div class="t">${esc(theirs.name)} <span class="muted">${t.status === 'open' ? PHASE[t.phase] : TSTATUS[t.status]}</span></div>
      <div class="d">我方 ${mine.lines.length} 項${mine.gold ? ` + 💰${fmt(mine.gold)}` : ''} ⇄ 對方 ${theirs.lines.length} 項${theirs.gold ? ` + 💰${fmt(theirs.gold)}` : ''}</div></div><span class="muted">›</span></div>`; };
    return `<div class="card"><h3>🤝 交易怎麼開始？</h3><div class="muted">「🎒 背包」<b>長按</b>（電腦版按「⋯」）一件沒綁定的裝備 →「📣 分享至群組」。群組裡想要的人按「🤝 我要交易」，你在這裡按「確認」就會打開交易視窗：雙方放物品／金幣 → 🔒 鎖定 → 都按 OK 才成交（金幣收 ${Math.round((meta.taxPct || 0.05) * 100)}% 稅）。</div></div>
      <div class="card"><h3>📥 收到的交易請求 <small>${inPend.length}</small></h3>${!R ? '<div class="muted">載入中…</div>' : inPend.map((r) => reqItemHtml(r, 'in')).join('') || '<div class="muted">沒有待確認的請求</div>'}</div>
      ${L && L.open.length ? `<div class="card"><h3>🔄 進行中的交易視窗 <small>${L.open.length}</small></h3>${L.open.map(card).join('')}</div>` : ''}
      <div class="card"><h3>📤 我送出的請求</h3>${!R ? '<div class="muted">載入中…</div>' : outAll.map((r) => reqItemHtml(r, 'out')).join('') || '<div class="muted">在群組的分享貼文按「🤝 我要交易」就會出現在這裡</div>'}</div>
      ${L ? `<div class="card"><h3>📜 交易歷史</h3>${L.history.map(card).join('') || '<div class="muted">還沒有交易紀錄</div>'}</div>` : ''}`;
  }
  // ---- 決鬥 (PK)
  const PKST = { pending: '等待接受', done: '已結束', declined: '✕ 拒絕', cancelled: '已取消', expired: '⌛ 過期' };
  function pkCardHtml(p) {
    const meSide = p.me; const other = meSide === 'a' ? p.b : p.a; const inc = p.status === 'pending' && meSide === 'b';
    const res = p.status === 'done' ? (p.winner === meSide ? '🏆 勝' : '💀 敗') : PKST[p.status];
    const btn = p.status === 'pending' ? (inc ? `<div class="col2"><button class="btn sm red" data-pacc="${esc(p.id)}">⚔️ 接受</button><button class="btn sm ghost" data-pdec="${esc(p.id)}">拒絕</button></div>` : `<button class="btn sm ghost" data-pdec="${esc(p.id)}">取消</button>`) : p.status === 'done' ? `<button class="btn sm ghost" data-pview="${esc(p.id)}">重播</button>` : '';
    return `<div class="item"><div class="ic pkic"><img src="${artSrc('portrait', heroKey(other.baseClass, other.gender, other.classPath))}" alt=""></div><div class="mid"><div class="t">${inc ? `${esc(other.name)} 向你挑戰` : meSide === 'a' ? `挑戰 ${esc(other.name)}` : `vs ${esc(other.name)}`} <span class="muted">${res}</span></div>
      <div class="d">Lv.${other.level} ${esc(other.className || '')}${p.status === 'pending' ? ` · 剩 <span data-cd="${p.expiresAt}">${mmss(p.expiresAt - sNow())}</span>` : ''}${p.drop ? ` · 💥 ${p.winner === meSide ? '奪得' : '掉落'}【${esc(p.drop.name)}】` : p.wardUsed ? ' · 🧿 守護符擋下掉裝' : ''}</div></div>${btn}</div>`;
  }
  function pkListHtml() {
    const r = S.meta.pk || {}; const P = S.pks; const lv = S.me.character.level;
    return `<div class="card"><h3>⚔️ 決鬥 <small>今天 ${P ? P.today : '-'} / ${r.dailyCap || 5} 場</small></h3>
      <div class="muted">雙方 Lv.${r.minLevel || 10} 以上、等級差 ≤ ${r.maxLevelGap || 10}；同一對手 ${r.pairCooldownHours || 12} 小時 1 場；挑戰 ${r.challengeMinutes || 10} 分鐘內要接受。決鬥用滿血滿魔模擬，<b>不扣 HP／EXP</b>。<br>⚠️ 輸的人有 <b>${Math.round((r.dropPct || 0.2) * 100)}%</b> 機率掉 1 件<b>身上穿的</b>裝備（武器也會掉）給贏家，掉出的裝備<b>解除綁定</b>、可以交易買回；背包有 🧿 守護符會自動擋下並消耗 1 張。</div>
      <button class="btn red mt" id="pknew" ${lv < (r.minLevel || 10) ? 'disabled' : ''}>${lv < (r.minLevel || 10) ? `Lv.${r.minLevel || 10} 才能決鬥` : '⚔️ 發起決鬥'}</button></div>
      ${!P ? '<div class="card muted">載入中…</div>' : `<div class="card"><h3>⏳ 等待中 <small>${P.pending.length}</small></h3>${P.pending.map(pkCardHtml).join('') || '<div class="muted">沒有等待中的挑戰（群組也可以輸入「/決鬥 @對方」）</div>'}</div>
      <div class="card"><h3>📜 決鬥紀錄</h3>${P.history.map(pkCardHtml).join('') || '<div class="muted">還沒有決鬥紀錄</div>'}</div>`}`;
  }
  function tradeView() {
    const badge = S.me.badges || {}; const sub = S.social || 'trade';
    let seg = `<div class="tabs"><button data-soc="trade" class="${sub === 'trade' ? 'on' : ''}">🤝 交易${(badge.requests || 0) + (badge.trades || 0) ? ` <b class="cnt">${(badge.requests || 0) + (badge.trades || 0)}</b>` : ''}</button><button data-soc="pk" class="${sub === 'pk' ? 'on' : ''}">⚔️ 決鬥${badge.challenges ? ` <b class="cnt">${badge.challenges}</b>` : ''}</button></div>`;
    seg=seg.replace('</div>','<button data-soc="hall" class="'+(sub==='hall'?'on':'')+'">英雄殿堂</button></div>');
    if(sub==='hall')return seg+heroHallHtml();
    if (sub === 'pk') return seg + pkListHtml();
    if (S.trade) return seg + tradeWindowHtml(S.trade);
    return seg + tradeListHtml();
  }
  async function tradeCall(action, body, okMsg) {
    if (S.busy) return null; S.busy = true;
    const key = mutationKey(`trade/${action}`, body);
    try { const j = await api(`trade/${action}`, { ...body, requestId: pendingRequestId(key) }); clearPendingRequest(key); if (j.trade) { S.trade = j.trade.status === 'open' ? j.trade : null; if(j.trade.status !== 'open') loadTrades(); } if (okMsg) toast(okMsg); haptic('ok'); refreshMe(); render(); return j; }
    catch (e) { if (e.status >= 400 && e.status < 500 && e.code !== 'conflict') clearPendingRequest(key); toast(e.message, true); haptic('error'); if (S.trade) loadTrade(S.trade.id); return null; }
    finally { S.busy = false; }
  }
  let tradeListFlight=null,tradeListEpoch=0,tradeFlight=null,tradeSelection=0;
  function loadTrades() {
    if(tradeListFlight)return tradeListEpoch===(S.apiEpoch||0)?tradeListFlight:tradeListFlight.then(()=>loadTrades());
    const selected=S.me?.character?.tgId,epoch=S.apiEpoch||0;tradeListEpoch=epoch;
    tradeListFlight=(async()=>{try { const [j, r] = await Promise.all([api('trade/list'), api('trade/requests')]);if(selected!==S.me?.character?.tgId||epoch!==(S.apiEpoch||0))return; S.trades = { open: j.open, history: j.history }; S.reqs = { incoming: r.incoming, outgoing: r.outgoing }; if (S.tab === 'trade' && !S.trade && $('#sheet').hidden) render(); } catch (e) { toast(e.message, true); }finally{tradeListFlight=null;}})();return tradeListFlight;
  }
  function selectTrade(id) {
    tradeSelection++;S.trade=null;S._lastTab=null;
    return fetchTrade(id,true);
  }
  function loadTrade(id) {
    if(S.trade?.id!==id)return Promise.resolve(null);
    return fetchTrade(id,false);
  }
  function fetchTrade(id, review) {
    const selection=tradeSelection,selected=S.me?.character?.tgId,epoch=S.apiEpoch||0;
    if(tradeFlight?.id===id&&tradeFlight.selection===selection&&tradeFlight.epoch===epoch)return tradeFlight.promise;
    const current=()=>selection===tradeSelection&&selected===S.me?.character?.tgId&&epoch===(S.apiEpoch||0)&&(review||S.trade?.id===id);
    const flight={id,selection,epoch,promise:null};tradeFlight=flight;
    flight.promise=(async()=>{try { const j = await api('trade/get', { tradeId: id });if(!current())return null; const o = S.trade;
      const changed = !o || o.id !== j.trade.id || o.offerRev !== j.trade.offerRev || o.status !== j.trade.status || o.phase !== j.trade.phase || o.a.ok !== j.trade.a.ok || o.b.ok !== j.trade.b.ok || o.a.locked !== j.trade.a.locked || o.b.locked !== j.trade.b.locked;
      if(!review&&j.trade.status!=='open'){S.trade=null;tradeSelection++;toast(j.trade.status==='done'?'🎉 交易完成！物品已送達背包':'交易已結束，託管物品與金幣已退回');refreshMe();await loadTrades();render();return;} S.trade = j.trade; if (S.tab === 'trade' && changed && $('#sheet').hidden) { render(); if (o && o.status === 'open' && j.trade.status === 'done') { toast('🎉 交易完成！'); haptic('ok'); refreshMe(); } } loadTradeLog(id);return j; } catch (e) {if(!current())return null; toast(e.message, true);if(['not_found','not_party'].includes(e.code)){S.trade=null;tradeSelection++;render();}}finally{if(tradeFlight===flight)tradeFlight=null;}})();return flight.promise;
  }
  function hallPortrait(h){return characterPortrait(h);}
  function heroHallHtml(){return window.RpgHeroHallUI.render(S.hall,{filter:S.hallClass||'all',page:S.hallPage||1},{esc,fmt,portrait:hallPortrait,includeThief:!!S.meta?.classes?.thief});}
  async function loadHeroes(){try{S.hall=await api('hall/list');if(S.tab==='trade'&&S.social==='hall'&&$('#sheet').hidden)render()}catch(e){toast(e.message,true)}}
  async function inspectHero(id){try{const {hero:h}=await api('hall/get',{charId:id});const cell=([slot,pos])=>{const e=h.equipment.find(x=>x.slot===slot&&(!MULTI[slot]||x.position===pos));return '<div class="slot '+(e?'has rar-'+esc(e.rarity):'')+'">'+(e?eqIcon(e)+(e.enhance?'<em>+'+e.enhance+'</em>':''):'<span class="ph">'+SLOT_EMOJI[slot]+'</span>')+'<small>'+esc(slotLabel(slot,pos))+'</small></div>'};const c=sheet('<div class="hall-loadout lc-character"><h2>'+esc(h.name)+' · 英雄武裝</h2><p>'+esc(h.className)+' · Lv.'+h.level+' · 戰力 '+fmt(h.power)+'</p><div class="card lc-equip"><div class="doll"><div class="col">'+DOLL_L.map(cell).join('')+'</div><div class="fig">'+(window.RpgStarRingCosmetics?.markup(h.aura)||'')+'<img src="'+esc(hallPortrait(h))+'" alt="'+esc(h.name)+'目前角色外觀"></div><div class="col">'+DOLL_R.map(cell).join('')+'</div></div><div class="acc">'+DOLL_B.map(cell).join('')+'</div></div><div class="hall-stats">ATK '+fmt(h.stats.atk)+' · DEF '+fmt(h.stats.def)+' · HP '+fmt(h.stats.maxHp)+' · MP '+fmt(h.stats.maxMp)+' · 爆擊 '+h.stats.crit+'%</div><div class="hall-equipment-list">'+h.equipment.map(e=>'<div class="item"><div class="ic">'+eqIcon(e)+'</div><div class="mid"><b>'+esc(e.name)+'</b><small>+'+e.enhance+' · '+esc(e.slotName)+' · '+esc(e.rarityName)+'</small></div></div>').join('')+'</div><button class="btn ghost" data-hall-close>關閉</button></div>');c.querySelector('[data-hall-close]').onclick=closeSheet;}catch(e){toast(e.message,true)}}
  async function loadPks() { try { const j = await api('pk/list'); S.pks = { pending: j.pending, history: j.history, today: j.today }; if (S.tab === 'trade' && S.social === 'pk' && $('#sheet').hidden) render(); } catch (e) { toast(e.message, true); } }
  async function loadTradeLog(id) {
    try { const j = await api('trade/log', { tradeId: id }); const el = $('#tlog'); if (!el || S.trade?.id!==id) return; const nm = (tg) => (String(tg) === String(S.trade.a.tgId) ? S.trade.a.name : String(tg) === String(S.trade.b.tgId) ? S.trade.b.name : '系統');
      const A = { open: '開啟交易視窗', add: '放入', remove: '取回', gold: '金幣改為', lock: '🔒 鎖定', confirm: '按 OK', done: '✅ 交易完成', cancel: '取消交易', expire: '⌛ 逾時退回' };
      el.innerHTML = j.log.map((l) => `<div><span class="muted">${new Date(l.created_at + 8 * 3600e3).toISOString().slice(11, 16)}</span> ${esc(nm(l.tg_id))} ${A[l.action] || l.action} ${l.details ? esc(l.details.name || (l.details.item ? `${itemName(l.details.item)}×${l.details.qty}` : l.details.to != null ? fmt(l.details.to) : '')) : ''}</div>`).join(''); } catch (_) {}
  }
  function bindTrade(view) {
    view.querySelectorAll('[data-soc]').forEach((b) => { b.onclick = () => { S.social = b.dataset.soc;if(S.social==='hall'){S.hallClass='all';S.hallPage=1;} render(); if(S.social==='hall')loadHeroes();else if (S.social === 'pk') loadPks(); else if (S.trade) loadTrade(S.trade.id); else loadTrades(); }; });
    if(S.social==='hall'){window.RpgHeroHallUI.bind(view,{onFilter:value=>{S.hallClass=value;S.hallPage=1;render();},onPage:value=>{S.hallPage=value;render();document.querySelector('.hero-hall')?.scrollIntoView({block:'start'});},onInspect:inspectHero});return;}
    if (S.social === 'pk') return bindPk(view);
    view.querySelectorAll('[data-trade],[data-otrade]').forEach((el) => { el.onclick = () => { S.trade = null; S._lastTab = null; window.scrollTo(0, 0); selectTrade(el.dataset.trade || el.dataset.otrade); }; });
    view.querySelectorAll('[data-racc]').forEach((b) => { b.onclick = async () => { if (S.busy) return; S.busy = true;
      try { const j = await api('trade/accept', { reqId: b.dataset.racc }); S.trade = j.trade; S.social = 'trade'; S._lastTab = null; window.scrollTo(0, 0); toast('🤝 交易視窗已開啟，操作按鈕在視窗上方'); haptic('ok'); refreshMe(); render(); } catch (e) { toast(e.message, true); loadTrades(); } finally { S.busy = false; } }; });
    view.querySelectorAll('[data-rrej]').forEach((b) => { b.onclick = async () => { if (!(await confirmSheet('婉拒交易請求', '對方會收到婉拒通知。', '婉拒'))) return; try { await api('trade/reject', { reqId: b.dataset.rrej }); toast('已婉拒'); refreshMe(); loadTrades(); } catch (e) { toast(e.message, true); } }; });
    view.querySelectorAll('[data-rwd]').forEach((b) => { b.onclick = async () => { try { await api('trade/withdraw', { reqId: b.dataset.rwd }); toast('已撤回請求'); loadTrades(); } catch (e) { toast(e.message, true); } }; });
    const bk = $('#tback', view); if (bk) bk.onclick = () => { tradeSelection++; S.trade = null; render(); loadTrades(); };
    if (!S.trade) return;
    const t = S.trade; loadTradeLog(t.id);
    const lk = $('#tlock', view); if (lk) lk.onclick = async () => { const [mine] = tradeSide(t);
      if (await confirmSheet('🔒 鎖定交易內容', `${tradeConfirmSideHtml(mine)}<p class="muted">鎖定後這一邊不能再加減；要改只能取消交易。</p>`, '鎖定')) tradeCall('lock', { tradeId: t.id }, '🔒 已鎖定'); };
    const ok = $('#tok', view); if (ok) ok.onclick = async () => { const [mine, theirs] = tradeSide(t);
      if (await confirmSheet('✅ 按 OK 成交', `<h3>你要給</h3>${tradeConfirmSideHtml(mine)}<h3>你會收到</h3>${tradeConfirmSideHtml(theirs)}<p class="muted">兩邊都按 OK 立即成交，無法還原。</p>`, 'OK')) {
        const j = await tradeCall('confirm', { tradeId: t.id, offerRev:t.offerRev }); if (j && j.result && j.result.done) { toast('🎉 交易完成！'); haptic('ok'); } } };
    const cc = $('#tcancel', view); if (cc) cc.onclick = async () => { if (await confirmSheet('✕ 取消交易', '取消後雙方的物品與金幣都會退回。', '取消交易', true)) tradeCall('cancel', { tradeId: t.id }, '交易已取消，物品已退回'); };
    view.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); const [kind, ref] = b.dataset.rm.split(':'); tradeCall('remove', kind === 'equip' ? { tradeId: t.id, equipId: ref } : kind==='sigil'?{tradeId:t.id,sigilId:ref}:{ tradeId: t.id, item: ref }); }; });
    view.querySelectorAll('[data-tadd]').forEach((b) => { b.onclick = () => tradeAddSheet(b.dataset.tadd); });
  }
  function tradeAddSheet(kind) {
    const t = S.trade; if (!t) return;
    if (kind === 'pick') { const c = sheet('<h2>＋ 放入</h2><div class="grid2"><button class="btn" data-k="equip">⚔️ 裝備</button><button class="btn" data-k="item">🎒 道具</button><button class="btn" data-k="sigil">🪶 守護羽毛</button><button class="btn gold" data-k="gold">💰 金幣</button><button class="btn ghost" data-k="x">關閉</button></div>');
      c.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => (b.dataset.k === 'x' ? closeSheet() : tradeAddSheet(b.dataset.k)); }); return; }
    if(kind==='sigil'){const actor=String(S.me.character.tgId),tradeId=t.id;const c=sheet('<h2>放入守護羽毛</h2><p data-guardian-trade-list>載入中…</p><button class="btn ghost" data-x>關閉</button>');c.querySelector('[data-x]').onclick=closeSheet;api('guardian/inventory').then(({state})=>{if(!c.isConnected||actor!==String(S.me?.character?.tgId)||S.trade?.id!==tradeId)return;const list=state.inventory.items.filter(item=>!item.bound&&!item.active&&!item.locked&&!item.inTrade);c.querySelector('[data-guardian-trade-list]').outerHTML='<div>'+list.map(item=>'<button type="button" class="item" data-guardian-trade="'+esc(item.id)+'">'+guardianTradeIcon(item)+'<span>'+esc(window.RpgGuardianContract.QUALITY_NAMES[item.quality])+'色 · '+esc(window.RpgGuardianContract.TYPE_NAMES[item.type])+'</span></button>').join('')+(state.inventory.nextCursor?'<p>更多羽毛可先於守護背包解鎖、解綁或移出保護狀態。</p>':'')+(list.length?'':'<p>沒有可交易羽毛：須未綁定、未啟用、未鎖定且不在交易中。</p>')+'</div>';c.querySelectorAll('[data-guardian-trade]').forEach(button=>button.onclick=()=>{if(actor!==String(S.me?.character?.tgId)||S.trade?.id!==tradeId)return;closeSheet();void tradeCall('add',{tradeId,sigilId:button.dataset.guardianTrade});});}).catch(error=>{if(c.isConnected)c.querySelector('[data-guardian-trade-list]').textContent=error.message;});return;}
    if (kind === 'gold') {
      const mine = tradeSide(t)[0]; const c = sheet(`<h2>💰 放入金幣</h2><div class="muted">你有 💰${fmt(S.me.character.gold + mine.gold)}（含已放入 ${fmt(mine.gold)}）。對方實收扣 ${Math.round((S.meta.trade?.taxPct || 0.05) * 100)}% 稅。</div>
        <input class="name-in mt" id="tg" inputmode="numeric" value="${mine.gold || ''}" placeholder="0"><div class="muted mt" id="tgnet"></div><div class="row mt"><button class="btn ghost" data-x>取消</button><button class="btn gold" id="tgo">設定</button></div>`);
      const inp = c.querySelector('#tg'); const net = () => { const v = Math.max(0, Math.floor(Number(String(inp.value).replace(/[^\d]/g, '')) || 0)); const tax = Math.ceil(v * (S.meta.trade?.taxPct || 0.05)); c.querySelector('#tgnet').textContent = v ? `對方實收 💰${fmt(v - tax)}（稅 ${fmt(tax)}）` : ''; }; inp.oninput = net; net();
      c.querySelector('[data-x]').onclick = closeSheet; c.querySelector('#tgo').onclick = () => { const v = Math.max(0, Math.floor(Number(String(inp.value).replace(/[^\d]/g, '')) || 0)); closeSheet(); tradeCall('gold', { tradeId: t.id, gold: v }, `💰 已放入 ${fmt(v)}`); };
      return;
    }
    if (kind === 'equip') {
      const list = S.me.equipment.filter((e) => !e.tradeBlock);
      const c = sheet(`<h2>＋ 放入裝備</h2>${list.map((e) => `<div class="item${relicCls(e)}" data-pe="${esc(e.id)}"><div class="ic rar-${esc(e.rarity)}">${eqIcon(e)}</div><div class="mid"><div class="t tc-${esc(e.rarity)}">${e.enhance ? `+${e.enhance} ` : ''}${esc(e.name)}</div><div class="d">${esc(e.slotName)} · ${e.statName} ${fmt(e.stat)} · ${esc(e.className)}</div></div></div>`).join('') || '<div class="muted">沒有可交易的裝備（穿過的會綁定，可用 🔓 赫密士解契卷解除；穿戴中要先卸下）</div>'}<button class="btn ghost mt" data-x>關閉</button>`);
      c.querySelector('[data-x]').onclick = closeSheet; c.querySelectorAll('[data-pe]').forEach((el) => { el.onclick = () => { closeSheet(); tradeCall('add', { tradeId: t.id, equipId: el.dataset.pe }); }; });
      return;
    }
    const keys = (S.meta.trade?.tradeableItems || []).filter((k) => (S.me.inventory[k] || 0) > 0);
    const c = sheet(`<h2>＋ 放入道具</h2>${keys.map((k) => `<div class="item"><div class="ic art">${k.startsWith('book_')?`<img class="skill-book-icon" src="/expedition/assets/skills-painted-20261011/${esc(k.slice(5))}.webp" alt="">`:iconHtml(k, itemEmoji(k))}</div><div class="mid"><div class="t">${esc(itemName(k))}</div><div class="d">持有 ${fmt(S.me.inventory[k])}</div></div><input class="qty" data-q="${k}" inputmode="numeric" placeholder="數量"><button class="btn sm" data-pi="${k}">放入</button></div>`).join('') || '<div class="muted">沒有可交易的道具（守護符、轉職書不能交易）</div>'}<button class="btn ghost mt" data-x>關閉</button>`);
    c.querySelector('[data-x]').onclick = closeSheet;
    c.querySelectorAll('[data-pi]').forEach((b) => { b.onclick = () => { const k = b.dataset.pi; const q = Math.floor(Number(c.querySelector(`[data-q="${k}"]`).value) || 0) || 1; closeSheet(); tradeCall('add', { tradeId: t.id, item: k, qty: q }, `已放入 ${itemName(k)} ×${q}`); }; });
  }
  function bindPk(view) {
    const nb = $('#pknew', view); if (nb) nb.onclick = () => playerPicker();
    view.querySelectorAll('[data-pacc]').forEach((b) => { b.onclick = async () => { const p = S.pks.pending.find((x) => x.id === b.dataset.pacc); const other = p.a;
      const ward = S.me.inventory.ward || 0;
      if (!(await confirmSheet('⚔️ 接受決鬥', `對手：${esc(other.name)}（Lv.${other.level} ${esc(other.className || '')}）<br>輸了有 ${Math.round((S.meta.pk?.dropPct || 0.2) * 100)}% 機率掉 1 件身上的裝備。${ward ? `<br>🧿 你有守護符 ×${ward}，掉裝時會自動擋下（消耗 1 張）。` : '<br><b>你沒有守護符</b>，掉裝無法阻擋。'}`, '開打！', true))) return;
      if (S.busy) return; S.busy = true;
      try { const j = await api('pk/accept', { pkId: p.id }); haptic('heavy'); refreshMe(); loadPks(); pkReplay(j.pk); } catch (e) { toast(e.message, true); loadPks(); } finally { S.busy = false; } }; });
    view.querySelectorAll('[data-pdec]').forEach((b) => { b.onclick = async () => { try { const j = await api('pk/decline', { pkId: b.dataset.pdec }); toast(j.pk.status === 'cancelled' ? '已取消挑戰' : '已拒絕決鬥'); refreshMe(); loadPks(); } catch (e) { toast(e.message, true); } }; });
    view.querySelectorAll('[data-pview]').forEach((b) => { b.onclick = async () => { try { const j = await api('pk/get', { pkId: b.dataset.pview }); pkReplay(j.pk); } catch (e) { toast(e.message, true); } }; });
  }
  /** duel replay: both portraits, HP bars driven by the server's log (purely a playback of the settled result) */
  function pkFrame(previous, s) {
    const hp = { ...previous.hp }, mp = { ...previous.mp };
    const target = s.by === 'a' ? 'b' : 'a';
    const oldSelf = hp[s.by];
    if (s.after?.hp) { for (const k of ['a','b']) if (Number.isFinite(s.after.hp[k])) hp[k] = s.after.hp[k]; }
    else {
      if (Number.isFinite(s.hp)) hp[target] = s.hp;
      if (Number.isFinite(s.self)) hp[s.by] = s.self;
    }
    if (s.after?.mp) for (const k of ['a','b']) if (Number.isFinite(s.after.mp[k])) mp[k] = s.after.mp[k];
    return { hp, mp, target, damage: Math.max(0, previous.hp[target] - hp[target]), healed: Math.max(0, hp[s.by] - oldSelf) };
  }
  function pkNativeStrikes(step, actor) {
    const rows=step.strikes;
    if(actor?.baseClass!=='thief'||!Array.isArray(rows)||!rows.length||rows.length>2)return [];
    if(!rows.every((row,index)=>Number.isFinite(row.damage)&&row.damage>=0&&Number.isFinite(row.beforeHp)&&Number.isFinite(row.afterHp)&&row.afterHp>=0&&Math.abs(row.beforeHp-row.afterHp-row.damage)<.001&&(!index||rows[index-1].afterHp===row.beforeHp)))return [];
    const total=rows.reduce((sum,row)=>sum+row.damage,0);
    if(Number.isFinite(step.directDamage)&&Math.abs(step.directDamage-total)>.001)return [];
    return rows;
  }
  function pkReplay(p) {
    const lg = p.log || {}; const steps = lg.steps || []; const max = lg.max || { a: 1, b: 1 };
    const maxMp = lg.maxMp;
    let state = { hp: { ...(lg.initial?.hp || max) }, mp: { ...(lg.initial?.mp || maxMp || {}) } };
    const side = (x, k) => `<div class="pkf" id="pk_${k}"><img src="${artSrc('portrait', heroKey(x.baseClass, x.gender, x.classPath))}" alt=""><b>${esc(x.name)}</b><small>Lv.${x.level} ${esc(x.className || '')}</small>${bar('hp', state.hp[k], max[k], `HP ${fmt(state.hp[k])} / ${fmt(max[k])}`)}${maxMp ? bar('mp', state.mp[k], maxMp[k], `MP ${fmt(state.mp[k])} / ${fmt(maxMp[k])}`) : ''}<div class="pkdmg"></div></div>`;
    const c = sheet(`<h2>⚔️ ${esc(p.a.name)} vs ${esc(p.b.name)}</h2><div class="muted">決鬥重播 · 傷害與血量依本場紀錄</div><div class="pkarena">${side(p.a, 'a')}<div class="pkvs">VS</div>${side(p.b, 'b')}</div><div class="pkres muted" id="pkres">${p.rounds} 回合…</div><div class="row mt"><button class="btn ghost" data-skip>跳過</button><button class="btn" data-x>關閉</button></div>`);
    const resultNode = c.querySelector('#pkres'); let i = 0, tm = 0, ended = false;
    const active = () => !ended && c.isConnected && !$('#sheet').hidden && c.querySelector('#pkres') === resultNode;
    const cancel = () => { clearTimeout(tm); ended = true; }; sheetPlaybackCancel = cancel;
    const set = (k) => { for (const kind of ['hp', 'mp']) { const el = c.querySelector(`#pk_${k} .bar.${kind}`); const limit = kind === 'hp' ? max[k] : maxMp?.[k]; if (el && Number.isFinite(state[kind][k])) { el.querySelector('i').style.width = `${pct(state[kind][k], limit)}%`; el.querySelector('b').textContent = `${kind.toUpperCase()} ${fmt(state[kind][k])} / ${fmt(limit)}`; } } };
    const finish = () => { if (!active()) return cancel(); clearTimeout(tm); if (lg.hp) state.hp = { ...lg.hp }; if (lg.mp) state.mp = { ...lg.mp }; set('a'); set('b'); const w = p.winner === 'a' ? p.a : p.b, l = p.winner === 'a' ? p.b : p.a;
      c.querySelectorAll('.pkf').forEach(el => el.classList.remove('atk','hitme'));
      c.querySelector(`#pk_${p.winner}`).classList.add('win'); c.querySelector(`#pk_${p.winner === 'a' ? 'b' : 'a'}`).classList.add('lose');
      resultNode.className = 'pkres'; resultNode.innerHTML = `🏆 <b>${esc(w.name)}</b> 勝！${lg.ko ? `${p.rounds} 回合擊倒` : `${p.rounds} 回合判定`}<br>${p.drop ? `💥 ${esc(l.name)} 掉落【${esc(p.drop.name)}】→ ${esc(w.name)}（已解除綁定，可交易買回）` : p.wardUsed ? `🧿 ${esc(l.name)} 的守護符擋下了掉裝` : `${esc(l.name)} 沒有掉裝備`}`;
      ended = true; if (sheetPlaybackCancel === cancel) sheetPlaybackCancel = null;
    };
    const step = () => {
      if (!active()) return cancel(); if (i >= steps.length || document.hidden) return finish();
      const s = steps[i++], tgt = s.by === 'a' ? 'b' : 'a', f = c.querySelector(`#pk_${tgt}`), atk = c.querySelector(`#pk_${s.by}`);
      c.querySelectorAll('.pkf').forEach(el => { el.classList.remove('atk','hitme'); const d = el.querySelector('.pkdmg'); d.className = 'pkdmg'; d.style.color = ''; }); void atk.offsetWidth; atk.classList.add('atk');
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const strikes=pkNativeStrikes(s,p[s.by]);
      if(strikes.length){
        const done=()=>{
          if(!active())return cancel();
          state=pkFrame(state,s);set('a');set('b');
          if(state.healed>0){const heal=atk.querySelector('.pkdmg');heal.textContent=`+${fmt(state.healed)}`;heal.className='pkdmg on';heal.style.color='#8dffad';}
          resultNode.textContent=`第 ${Math.ceil(i/2)} 回合 · ${p[s.by].name}${s.skill?'施展技能':'發動攻擊'} · ${strikes.length} 擊（${strikes.map(row=>fmt(row.damage)).join('＋')}）${s.periodicDamage>0?` · 持續傷害 ${fmt(s.periodicDamage)}`:''}${state.healed>0?` · 回復 ${fmt(state.healed)} HP`:''}`;
          tm=setTimeout(step,reduced?80:300);
        };
        if(reduced){tm=setTimeout(()=>{if(!active())return cancel();const d=f.querySelector('.pkdmg');d.textContent=`${strikes.length}擊`;d.className='pkdmg on';done();},40);return;}
        let strikeIndex=0;
        const poke=()=>{
          if(!active())return cancel();
          atk.classList.remove('atk');f.classList.remove('hitme');void atk.offsetWidth;atk.classList.add('atk');
          const row=strikes[strikeIndex++];
          tm=setTimeout(()=>{
            if(!active())return cancel();
            f.classList.add('hitme');const d=f.querySelector('.pkdmg');d.textContent=`${row.crit?'💥':''}−${fmt(row.damage)}`;d.className=`pkdmg on${row.crit?' crit':''}${s.skill?' skill':''}`;
            if(strikeIndex<strikes.length)tm=setTimeout(poke,180);else done();
          },180);
        };
        poke();return;
      }
      tm = setTimeout(() => {
        if (!active()) return cancel(); state = pkFrame(state, s); set('a'); set('b'); f.classList.add('hitme');
        const d = f.querySelector('.pkdmg'); d.textContent = `${s.crit ? '💥' : ''}−${fmt(state.damage)}`; d.className = `pkdmg on${s.crit ? ' crit' : ''}${s.skill ? ' skill' : ''}`;
        if (state.healed > 0) { const heal = atk.querySelector('.pkdmg'); heal.textContent = `+${fmt(state.healed)}`; heal.className = 'pkdmg on'; heal.style.color = '#8dffad'; }
        resultNode.textContent = `第 ${Math.ceil(i / 2)} 回合 · ${s.by === 'a' ? p.a.name : p.b.name}${s.skill ? '施展技能' : '發動攻擊'}${state.healed > 0 ? ` · 回復 ${fmt(state.healed)} HP` : ''}`;
        tm = setTimeout(step, reduced ? 80 : s.crit ? 520 : 300);
      }, reduced ? 40 : 180);
    };
    c.querySelector('[data-x]').onclick = closeSheet; c.querySelector('[data-skip]').onclick = finish;
    tm = setTimeout(step, 500);
  }
  async function playerPicker() {
    const r = S.meta.pk || {}; const me = S.me.character;
    const c = sheet(`<h2>⚔️ 向誰挑戰？</h2><div class="muted">Lv.${r.minLevel || 10}+、等級差 ≤ ${r.maxLevelGap || 10}</div><input class="name-in mt" id="pq" placeholder="搜尋角色名或 @username"><div id="plist" class="mt"><div class="muted">載入中…</div></div><button class="btn ghost mt" data-x>關閉</button>`);
    c.querySelector('[data-x]').onclick = closeSheet;
    const show = async (q) => { try { const j = await api('players', { q }); const el = $('#plist'); if (!el) return;
      el.innerHTML = j.players.map((p) => { const bad = p.level < (r.minLevel || 10) ? `需 Lv.${r.minLevel || 10}` : Math.abs(p.level - me.level) > (r.maxLevelGap || 10) ? '等級差太大' : '';
        return `<div class="item" data-pp="${esc(p.tgId)}" data-nm="${esc(p.name)}"><div class="ic pkic"><img src="${artSrc('portrait', heroKey(p.baseClass, p.gender, p.classPath))}" alt=""></div><div class="mid"><div class="t">${esc(p.name)}</div><div class="d">Lv.${p.level} · ${esc((S.meta.classes[p.baseClass] || {}).name || '')}${p.username ? ` · @${esc(p.username)}` : ''}</div></div><button class="btn sm red" ${bad ? 'disabled' : ''}>${bad || '挑戰'}</button></div>`; }).join('') || '<div class="muted">找不到有角色的玩家</div>';
      el.querySelectorAll('[data-pp]').forEach((x) => { const btn = x.querySelector('button'); if (btn.disabled) return; x.onclick = async () => { closeSheet(); if (S.busy) return; S.busy = true;
        try { await api('pk/challenge', { target: { tgId: x.dataset.pp } }); toast(`⚔️ 已向 ${x.dataset.nm} 發出挑戰，群組也會貼出決鬥卡`); S.social = 'pk'; S.tab = 'trade'; loadPks(); render(); } catch (e) { toast(e.message, true); } finally { S.busy = false; } }; }); } catch (e) { toast(e.message, true); } };
    let tmr = 0; c.querySelector('#pq').oninput = (ev) => { clearTimeout(tmr); tmr = setTimeout(() => show(ev.target.value), 300); }; show('');
  }
  async function sellGearItem(e) {
    if (e.sellBlock) return toast(e.sellBlock, true);
    if (!(await confirmSheet('🏪 賣給商店', `確定出售「${esc(e.name)}」？<br><b>售價：💰 ${fmt(e.sellPrice)}</b><br><span class="muted">售價為同部位、同階裝備基礎商店價格的三分之一。出售後無法取回${e.grade === 'relic' ? '，請確認不再需要這件遺物' : ''}。</span>`, '出售', true))) return;
    closeSheet();
    return act('sell-gear', { itemId: e.id }, (j) => `已出售 ${j.result.itemName}，獲得 💰${fmt(j.result.gold)}`);
  }
  // ---- 道具欄點選選單：只顯示伺服器實際支援的操作
  // 技能書：查看/學習(遠征頁)、分享到群組(expedition/share)、交易(expedition/trade)；可交易道具：到交易視窗放入；首領資源：兌換。
  // 一般道具沒有「分享到群組」、「販售給商店」的伺服器功能（商店只收裝備、羽毛），所以不顯示。
  function invItemMenu(k) {
    if(k==='star_ring_token'||k==='star_ring_core'){window.RpgExpeditionOpen?.('star-ring');return;}
    if(k==='fate_cycle_gift'){import('/fate/fate-gift-ui.js?v=20261018-pinkscroll2').then(m=>m.openFateGift(window.RpgFateHost)).catch(()=>toast('星輝匣暫未連上，請稍後重試',true));return;}
    const have = S.me.inventory[k] || 0, isBook = k.startsWith('book_'), skillId = isBook ? k.slice(5) : null;
    const tradeable = (S.meta.trade?.tradeableItems || []).includes(k), bossRes = k === 'boss_essence' || k === 'relic_fragment';
    const meta = S.meta.items[k] || {};
    const icon = isBook ? `<img class="skill-book-icon" src="/expedition/assets/skills-painted-20261011/${esc(skillId)}.webp" alt="">` : iconHtml(k, itemEmoji(k));
    const rows = [];
    if(meta.kind==='gacha')rows.push(['gachaopen','開啟 1 顆','依目前角色等級與職業抽取裝備，紫色傳說 85%、紅色霸主 15%。']);
    if (isBook) rows.push(['learn', '🔍 查看詳情／學習', '未使用的書可由符合職業的角色學習，學習後永久綁定該角色。'], ['bookshare', '📣 分享到群組', '把這本技能書貼到群組，夥伴可以來找你交易（每分鐘一次，組隊戰鬥中不能分享）。']);
    if (bossRes) rows.push(['rewards', '🏺 前往兌換', '首領精華與遺物碎片在「首領精華」頁兌換裝備養成道具。']);
    if (tradeable) rows.push([isBook ? 'booktrade' : 'trade', '🤝 交易', isBook ? '輸入對方角色名稱，建立交易視窗並先放入這本書。' : '到交易視窗，用「＋ 放入道具」放入這個道具。']);
    const c = sheet(`<h2 class="mh">${icon} ${esc(itemName(k))} <small>×${fmt(have)}</small></h2>
      <div class="menu"><div class="why">${esc(meta.desc || '')}</div>
      ${rows.map(([m, label, why]) => `<button class="btn" data-m="${m}" ${have < 1 && m !== 'rewards' ? 'disabled' : ''}>${label}</button><div class="why">${esc(why)}</div>`).join('')}
      ${!tradeable && !isBook && !bossRes ? '<div class="why">這個道具不能交易、分享或販售給商店。</div>' : ''}
      <button class="btn ghost" data-m="x">關閉</button></div>`);
    const reqId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    c.querySelectorAll('[data-m]').forEach((b) => { b.onclick = async () => {
      const m = b.dataset.m;
      if (m === 'x') return closeSheet();
      if(m==='gachaopen'){if(b.disabled)return;b.disabled=true;closeSheet();const j=await act('gacha/open',{type:k==='gacha_weapon'?'weapon':'armor'});if(j?.result){const item=S.me.equipment.find(e=>e.id===j.result.item.id);toast('獲得 '+(item?.rarityName||'')+' '+j.result.item.name);if(item)itemSheet(item.id);}return;}
      if (m === 'learn') { closeSheet(); return window.RpgExpeditionOpen?.(skillId); }
      if (m === 'rewards') { closeSheet(); return window.RpgExpeditionOpen?.('rewards'); }
      if (m === 'trade') { closeSheet(); S.tab = 'trade'; S.social = 'trade'; render(); if (!S.trade) loadTrades(); toast(S.trade?.status === 'open' ? '點交易視窗的「＋ 放入道具」放入 ' + itemName(k) : '先開啟交易（群組分享貼文按「我要交易」），再放入 ' + itemName(k)); return; }
      if (m === 'bookshare') {
        if (!(await confirmSheet('📣 分享到群組', '把「' + esc(itemName(k)) + '」貼到群組？夥伴可以來找你交易。', '分享'))) return;
        try { await api('expedition/share', { skillId, requestId: reqId() }); closeSheet(); toast('📣 已分享，貼文幾秒內會出現在群組'); } catch (e) { toast(e.message, true); }
        return;
      }
      if (m === 'booktrade') {
        const d = sheet('<h2>🤝 交易 · ' + esc(itemName(k)) + '</h2><div class="menu"><div class="why">輸入對方角色名稱，雙方鎖定、確認後物品才會移轉。</div><input id="bk-trade-name" placeholder="對方角色名稱" maxlength="12"><button class="btn" data-go>建立交易</button><button class="btn ghost" data-x>取消</button></div>');
        d.querySelector('[data-x]').onclick = closeSheet;
        d.querySelector('[data-go]').onclick = async () => {
          const name = d.querySelector('#bk-trade-name').value.trim(); if (!name) return toast('請輸入對方角色名稱', true);
          const actor=S.me.character.tgId,button=d.querySelector('[data-go]');if(button.disabled)return;button.disabled=true;
          try { const r = await api('expedition/trade', { skillId, target: { name }, requestId: reqId() }); if(actor!==S.me?.character?.tgId)return;closeSheet(); S.tab = 'trade'; S.social = 'trade'; const opened=await selectTrade(r.tradeId);if(!opened)await loadTrades();render();toast(opened?'已建立交易視窗':'交易已建立，可從交易清單重新開啟'); } catch (e) { toast(e.message, true); }finally{button.disabled=false;}
        };
      }
    }; });
  }
  // ---- 背包長按選單：分享至群組 / 解契 / 詳細 / 販售
  function itemMenu(id) {
    const e = S.me.equipment.find((x) => x.id === id); if (!e) return;
    const have = S.me.inventory.unbind || 0; const sb = e.shareBlock; const ub = e.unbindBlock;
    const c = sheet(`<h2 class="mh tc-${esc(e.rarity)}">${eqIcon(e)} ${e.enhance ? `+${e.enhance} ` : ''}${esc(e.name)}</h2>
      <div class="menu">
        <button class="btn" data-m="share" ${sb ? 'disabled' : ''}>📣 分享至群組</button>${sb ? `<div class="why">${esc(sb)}</div>` : `<div class="why">${e.tradeBlock ? '穿戴與綁定裝備也能展示，夥伴可以按 👍 超讚。' : '分享照片與屬性，夥伴可按 🤝 我要交易／👍 超讚。'}</div>`}
        <button class="btn" data-m="trade" ${e.tradeBlock ? 'disabled' : ''}>🤝 交易</button>${e.tradeBlock ? `<div class="why">${esc(e.tradeBlock)}（請先卸下裝備／解契）</div>` : '<div class="why">輸入對方角色名稱，開啟交易視窗並先放入這件裝備</div>'}
        <button class="btn ghost" data-m="list" ${e.tradeBlock ? 'disabled' : ''}>🏷️ 掛賣到交易所</button>
        ${e.bound ? `<button class="btn ghost" data-m="unbind" ${ub ? 'disabled' : ''}>🔓 解除綁定（需 ${e.unbindCost} 張・持有 ${have}）</button>${ub ? `<div class="why">${esc(ub)}</div>` : have < e.unbindCost ? '<div class="why">解契卷不夠 — 商店「📜 捲軸」500 金／張</div>' : ''}` : ''}
        ${e.sellBlock ? `<button class="btn ghost" disabled title="${esc(e.sellBlock)}">🔒 ${esc(e.sellBlock)}</button>` : `<button class="btn red" data-m="sell">🏪 賣給商店（${fmt(e.sellPrice)} 金）</button>`}
        <button class="btn ghost" data-m="detail">🔍 詳細／強化</button><button class="btn ghost" data-m="x">關閉</button></div>`);
    c.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { const m = b.dataset.m; if (m === 'x') return closeSheet(); if (m === 'detail') return itemSheet(id); if (m === 'share') return shareItem(e); if (m === 'trade') return tradeGear(e); if (m === 'list') return listGear(e); if (m === 'unbind') return unbindItem(e); if (m === 'sell') return sellGearItem(e); }; });
  }
  function listGear(e) {
    if (e.tradeBlock) return toast(e.tradeBlock, true);
    const d = sheet(`<h2>🏷️ 掛賣 · ${esc(e.name)}</h2><div class="menu"><div class="why">設定售價（1–1,000,000 金幣），成交後扣除手續費入帳；掛賣期間這件裝備會被保管，可在交易所「我的掛單」撤回。</div><input id="gear-list-price" inputmode="numeric" placeholder="售價（金幣）" maxlength="7"><button class="btn" data-go>確認掛賣</button><button class="btn ghost" data-x>取消</button></div>`);
    d.querySelector('[data-x]').onclick = closeSheet;
    d.querySelector('[data-go]').onclick = async () => {
      const price = Math.floor(Number(String(d.querySelector('#gear-list-price').value).replace(/[^\d]/g, '')) || 0); if (price < 1 || price > 1000000) return toast('售價需為 1–1,000,000 的整數', true);
      try { await api('exchange/create', { characterId: String(S.me.character.tgId), equipId: e.id, price, requestId: window.RpgMarketExchange.requestId() }); closeSheet(); toast('已掛賣到交易所'); refreshMe(); } catch (err) { toast(err.message, true); }
    };
  }
  function tradeGear(e) {
    if (e.tradeBlock) return toast(e.tradeBlock, true);
    const d = sheet(`<h2>🤝 交易 · ${esc(e.name)}</h2><div class="menu"><div class="why">輸入對方角色名稱，會開啟交易視窗並先放入這件裝備；雙方鎖定、確認後才會交換。</div><input id="gear-trade-name" placeholder="對方角色名稱" maxlength="12"><button class="btn" data-go>建立交易</button><button class="btn ghost" data-x>取消</button></div>`);
    d.querySelector('[data-x]').onclick = closeSheet;
    d.querySelector('[data-go]').onclick = async () => {
      const name = d.querySelector('#gear-trade-name').value.trim(); if (!name) return toast('請輸入對方角色名稱', true);
      const actor=S.me.character.tgId,button=d.querySelector('[data-go]');if(button.disabled)return;button.disabled=true;
      try { const r = await api('trade/open', { equipId: e.id, target: { name }, requestId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2) }); if(actor!==S.me?.character?.tgId)return;closeSheet(); S.tab = 'trade'; S.social = 'trade'; const opened=await selectTrade(r.tradeId);if(!opened)await loadTrades(); render(); refreshMe(); toast(opened?'已建立交易，裝備已放入':'交易已建立，可從交易清單重新開啟'); } catch (err) { toast(err.message, true); }finally{button.disabled=false;}
    };
  }
  async function shareItem(e) {
    if (e.shareBlock) return toast(e.shareBlock, true);
    if (!(await confirmSheet('📣 分享至群組', `把「${esc(e.name)}」的照片與完整屬性分享給夥伴？<br><span class="muted">${e.tradeBlock ? '這次是裝備展示，夥伴可以按「👍 超讚」。只分享照片與屬性，不會改變穿戴與綁定狀態。' : '夥伴可以按「👍 超讚」或「🤝 我要交易」；你確認後才會開啟交易視窗。'}每天最多 ${S.meta.share?.dailyCap || 10} 次。</span>`, '分享'))) return;
    const j = await act('share', { equipId: e.id }); if (j) toast('📣 已分享！照片貼文幾秒內會出現在群組');
  }
  async function unbindItem(e) {
    const have = S.me.inventory.unbind || 0;
    if (have < e.unbindCost) { toast(`需要赫密士解契卷 ×${e.unbindCost}（你有 ${have}），商店「📜 捲軸」有賣`, true); return; }
    if (!(await confirmSheet('🔓 赫密士解契卷', `消耗 ×${e.unbindCost} 解除「${esc(e.name)}」的綁定？<br><span class="muted">解除後可以交易、分享；再穿上又會綁定。</span>`, '解除綁定'))) return;
    const j = await act('unbind', { itemId: e.id }); if (j) { toast(`🔓 ${e.name} 已解除綁定`); itemMenu(e.id); }
  }
  /** long-press (touch) / right-click / ⋯ button on bag rows → itemMenu */
  function bindLongPress(el, fn) {
    let tm = 0, fired = false, sx = 0, sy = 0;
    el.addEventListener('pointerdown', (ev) => { fired = false; sx = ev.clientX; sy = ev.clientY; clearTimeout(tm); tm = setTimeout(() => { fired = true; haptic('medium'); fn(); }, 480); });
    el.addEventListener('pointermove', (ev) => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 10) clearTimeout(tm); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((k) => el.addEventListener(k, () => clearTimeout(tm)));
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); clearTimeout(tm); if (!fired) fn(); fired = true; });
    el.addEventListener('click', (ev) => { if (fired) { ev.stopImmediatePropagation(); ev.preventDefault(); fired = false; } }, true);
  }

  // ---------- creation flow ----------
  function createView() {
    const C = S.create; const steps = `<div class="steps">${[0, 1, 2].map((i) => `<i class="${i <= C.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const cls = window.RpgThiefClass.selectableClasses(S.meta.classes);
    if(C.cls&&!cls[C.cls]){C.cls=null;C.gender=null;if(C.step>1)C.step=1;}
    const cancel = S.characters.length ? '<button class="btn ghost mt" id="cancelCreate">返回選角</button>' : '';
    if (C.step === 0) return `<div class="create">${steps}<h1>⚔️ 建立新角色</h1><p>每個 Telegram 帳號最多 4 隻角色</p>
      <div class="card"><h3>1. 角色名稱</h3><input class="name-in" id="nm" maxlength="12" placeholder="2–12 個字" value="${esc(C.name)}"><div class="muted mt">中文、英文、數字或底線</div></div><button class="btn" id="next">下一步</button>${cancel}</div>`;
    if (C.step === 1) { const sel = C.cls && cls[C.cls];
      return `<div class="create">${steps}<h1>2. 選擇職業</h1><p>轉職後還會分成兩條路線</p><div class="pick3 ${Object.keys(cls).length > 3 ? 'pick4' : ''}">${Object.values(cls).map((c) => `<div class="pickc ${C.cls === c.key ? 'on' : ''}" data-cls="${c.key}"><canvas data-pc="${c.key}"></canvas><b>${esc(c.emoji)} ${esc(c.name)}</b><small>${esc(c.blurb)}</small></div>`).join('')}</div>
      ${sel ? `<div class="desc"><b>${esc(sel.name)}</b>　技能「${esc(sel.skill.name)}」MP ${sel.skill.cost} · ×${sel.skill.mult}<br>被動：${esc(sel.passive)}${C.cls==='thief'?`<br><span class="thief-combat-traits">${esc(window.RpgThiefClass.traits(sel))}</span>`:''}<br>轉職路線：${Object.values(sel.branches).map((b) => `${esc(b.name)}（${esc(b.skill.name)} ${b.skill.cost}MP）`).join('、')}</div>` : ''}
      <div class="row mt"><button class="btn ghost" id="back">上一步</button><button class="btn" id="next" ${C.cls ? '' : 'disabled'}>下一步</button></div></div>`; }
    return `<div class="create">${steps}<h1>3. 選擇性別</h1><p>${esc(cls[C.cls].emoji)} ${esc(cls[C.cls].name)}・${esc(C.name)}</p><div class="grid2">${['m', 'f'].map((g) => `<div class="pickc ${C.gender === g ? 'on' : ''}" data-g="${g}"><canvas data-pg="${g}" style="height:160px"></canvas><b>${g === 'm' ? '♂ 男' : '♀ 女'}</b></div>`).join('')}</div>
      <div class="row mt"><button class="btn ghost" id="back">上一步</button><button class="btn gold" id="go" ${C.gender ? '' : 'disabled'}>⚔️ 開始冒險</button></div></div>`;
  }
  function bindCreate(view) {
    const C = S.create;
    const cancelCreate = $('#cancelCreate', view); if (cancelCreate) cancelCreate.onclick = openCharacterSelect;
    const nm = $('#nm', view); if (nm) { nm.oninput = () => { C.name = nm.value; }; }
    view.querySelectorAll('[data-pc]').forEach((cv) => { const src = artSrc('hero', heroKey(cv.dataset.pc, C.gender || 'f')); if (V2 && src) cv.replaceWith(Object.assign(document.createElement('img'), { src, className: 'pickimg' })); else drawPortrait(cv, { cls: cv.dataset.pc, gender: C.gender || 'm' }); });
    view.querySelectorAll('[data-pg]').forEach((cv) => { const src = artSrc('hero', heroKey(C.cls, cv.dataset.pg)); if (V2 && src) cv.replaceWith(Object.assign(document.createElement('img'), { src, className: 'pickimg big' })); else drawPortrait(cv, { cls: C.cls, gender: cv.dataset.pg }); });
    view.querySelectorAll('[data-cls]').forEach((el) => { el.onclick = () => { if(!window.RpgThiefClass.selectableClasses(S.meta.classes)[el.dataset.cls])return; C.cls = el.dataset.cls; haptic('light'); render(); }; });
    view.querySelectorAll('[data-g]').forEach((el) => { el.onclick = () => { C.gender = el.dataset.g; haptic('light'); render(); }; });
    const back = $('#back', view); if (back) back.onclick = () => { C.step--; render(); };
    const next = $('#next', view); if (next) next.onclick = () => {
      if (C.step === 0 && !/^[\p{Script=Han}A-Za-z0-9_]{2,12}$/u.test(C.name.trim())) return toast('角色名要 2–12 個字，只能用中文、英文、數字或底線', true);
      C.name = C.name.trim(); C.step++; render(); };
    const go = $('#go', view); if (go) go.onclick = async () => {
      if(S.creationFlight)return;S.creationFlight=true;go.disabled = true;
      const payload={name:C.name,baseClass:C.cls,gender:C.gender,charSlot:C.slot},key=mutationKey('create',payload);
      try { if(!window.RpgThiefClass.selectableClasses(S.meta.classes)[C.cls])throw new Error('此職業尚未開放建立'); const created=await api('create', { ...payload, requestId:pendingRequestId(key) }); S.characters = created.characters; clearPendingRequest(key); S.create = { step: 0, name: '', cls: null, gender: null, slot: null }; S.creating = false; S.choosing = true; render(); haptic('ok'); toast('🎉 角色建立完成，請選擇角色進入冒險'); }
      catch (e) { toast(e.uncertain?'創角結果待確認，請再按一次確認；會核對同一次創角，不會重複建立。':e.message, true); go.disabled = false; }
      finally{S.creationFlight=false;}
    };
  }

  function characterSelectView() {
    const bySlot = new Map(S.characters.map((c) => [Number(c.slot), c]));
    const slots = [1, 2, 3, 4].map((slot) => {
      const c = bySlot.get(slot);
      if (!c) return `<button class="char-card char-empty" data-new="${slot}" aria-label="建立第 ${slot} 隻角色"><span class="char-question">?</span><b>尚未創角</b><small>第 ${slot} 格 · 建立新冒險者</small><em>＋ 建立角色</em></button>`;
      const cls = S.meta.classes[c.baseClass] || {}; const pic = artSrc('hero', heroKey(c.baseClass, c.gender, c.classPath));
      return `<button class="char-card ${c.active ? 'char-active' : ''}" data-select="${esc(c.charId)}"><span class="char-slot">角色 ${slot}${c.active ? ' · 上次掛機' : ''}</span>
        <span class="char-portrait">${pic ? `<img src="${pic}" alt="">` : `<i>${esc(cls.emoji || '✦')}</i>`}</span><strong>${esc(c.name)}</strong><small>${esc(cls.name || c.baseClass)} · Lv.${c.level}</small>
        <em>${c.active ? '繼續冒險' : '選擇角色'}</em></button>`;
    }).join('');
    return `<section class="char-select"><div class="char-select-title"><span>✥ ADVENTURER SELECT ✥</span><h1>選擇角色</h1><p>選定的角色會繼續離線掛機，並代表你挑戰世界王</p></div><div class="char-grid">${slots}</div>
      <div class="char-select-foot">${S.characters.length}/4 名冒險者 · 只有目前選定的角色獲得掛機收益</div>${S.me ? '<button class="btn ghost char-back" id="backAdventure">返回目前角色</button>' : ''}</section>`;
  }
  async function openCharacterSelect() {
    window.RpgElf4AttackFX?.dispose();
    try { S.pendingTab = S.tab; S.characters = (await api('characters')).characters; S.creating = false; S.choosing = true; render(); }
    catch (e) { toast(e.message, true); }
  }
  function bindCharacterSelect(view) {
    view.querySelectorAll('[data-new]').forEach((card) => { card.onclick = () => { S.create = { step: 0, name: S.create.name || '', cls: null, gender: null, slot: Number(card.dataset.new) }; S.creating = true; S.choosing = false; render(); }; });
    view.querySelectorAll('[data-select]').forEach((card) => { card.onclick = async () => {
      if (S.busy) return; S.busy = true; card.disabled = true;
      try { const j = absorb(await api('select', { charId: card.dataset.select }),true); S.characters = j.characters || S.characters; S.choosing = false; S.tab = S.pendingTab || 'home'; render(); load(S.tab); if (S.tab !== 'home') loadLedger(); haptic('ok'); }
      catch (e) { toast(e.message, true); card.disabled = false; }
      finally { S.busy = false; }
    }; });
    const back = $('#backAdventure', view); if (back) back.onclick = () => { S.choosing = false; refreshMe(); };
  }

  // ---------- render / load ----------
  function guardianFrameSize(){const root=document.getElementById('guardian-root');if(!root)return;const viewport=window.visualViewport?.height||innerHeight,nav=document.getElementById('nav'),bottom=nav&&!nav.hidden?nav.getBoundingClientRect().top:viewport;root.style.setProperty('--guardian-frame-height',Math.max(320,bottom-22)+'px');}
  window.addEventListener('resize',guardianFrameSize);window.visualViewport?.addEventListener('resize',guardianFrameSize);
  function guardianStorage(kind){return `elfRpgGuardian:${kind}:${S.me?.character?.tgId||''}`;}
  function guardianRead(kind,session=false){try{return JSON.parse((session?sessionStorage:localStorage).getItem(guardianStorage(kind))||'null');}catch{return null;}}
  function guardianWrite(kind,value,session=false){try{const store=session?sessionStorage:localStorage;if(value)store.setItem(guardianStorage(kind),JSON.stringify(value));else store.removeItem(guardianStorage(kind));return true;}catch{return false;}}
  function setGuardianAuto(job){S.guardianAuto=job;guardianAutoBanner();guardianController?.update({autoJob:job});}
  const guardianOperation=operation=>operation?{...operation,requestId:String(operation.requestId||'').replace(/^app:/,'')}:operation;
  window.RpgGuardianHost={
    autoCurrent:()=>S.guardianAuto||null,autoStart:async body=>{const r=await api('guardian/auto/start',body);setGuardianAuto(r.job);await syncBackground().catch(()=>{});return r;},autoStop:async jobId=>{const r=await api('guardian/auto/stop',{jobId});setGuardianAuto(r.job);return r;},
    openShop:(itemId,quality)=>openGuardianShop(itemId,quality),
    characterId:()=>String(S.me?.character?.tgId||''),requestId:()=>`guardian_${crypto.randomUUID().replace(/-/g,'')}`,confirm:confirmSheet,
    config:async({signal}={})=>(await api('guardian/config',{}, {signal})).config,
    state:async({signal,cursor,quality}={})=>(await api('guardian/inventory',{...(cursor?{cursor}:{}),...(quality?{quality}:{})},{signal})).state,
    recover:async({signal,requestId,operationId}={})=>guardianOperation((await api('guardian/operation',{...(requestId?{requestId:String(requestId).replace(/^app:/,'')}:{}),...(operationId?{operationId}:{})},{signal})).operation),
    history:async()=>(await api('guardian/history')).operations.map(guardianOperation),
    mutate:async(action,body)=>{if(!['summon','fuse','activate','lock','unbind','share','assist'].includes(action))throw Error('守護羽毛操作無效。');const result=await api(`guardian/${action}`,body);return {...result,operation:guardianOperation(result.operation)};},
    loadPending:()=>guardianRead('pending'),savePending:value=>guardianWrite('pending',value),clearPending:()=>guardianWrite('pending',null),loadReceipt:()=>guardianRead('receipt',true),saveReceipt:(operation,presentation)=>guardianWrite('receipt',{operation,presentation},true),
    loadFusionBatch:()=>guardianRead('fusionBatch'),saveFusionBatch:value=>guardianWrite('fusionBatch',value),
    loadAutoPending:()=>guardianRead('autoPending'),saveAutoPending:value=>guardianWrite('autoPending',value),clearAutoPending:()=>guardianWrite('autoPending',null),
    onChanged:snapshot=>{if(String(S.me?.character?.tgId)!==snapshot?.charId)return;if(snapshot.balances.gold!==null&&snapshot.revision>=S.me.character.revision){S.me.character.gold=snapshot.balances.gold;S.me.character.revision=snapshot.revision;}void refreshMe({silent:true,full:true});},
    openTrade:async item=>{if(S.trade?.status==='open'){const [mine,other]=tradeSide(S.trade);if(mine.locked){toast('交易已鎖定，不能新增羽毛。',true);return;}if(!await confirmSheet('放入守護羽毛',`將這根羽毛放入與 ${esc(other.name)} 的交易視窗？`,'放入'))return;await tradeCall('add',{tradeId:S.trade.id,sigilId:item.id});}else{S.tab='trade';S.social='trade';render();loadTrades();toast('可由「分享至群組」開始交易；已有視窗時可放入守護羽毛。');}}
  };
  function render() {
    const guardianVisible=S.tab==='guardian'&&!S.choosing&&!S.creating&&!!S.me;
    document.body.classList.toggle('guardian-mode',guardianVisible);
    if(guardianVisible&&guardianController&&guardianActor===String(S.me.character.tgId)&&document.getElementById('guardian-root')){renderHud();guardianFrameSize();return;}
    const marketVisible=S.tab==='shop'&&!S.choosing&&!S.creating&&!!S.me;
    if(marketVisible&&marketController&&marketActor===String(S.me.character.tgId)&&document.querySelector('.market-hub')){renderHud();updateShopSurface();marketController.update();return;}
    marketController?.cleanup();marketController=null;marketActor=null;
    guardianController?.cleanup();guardianController=null;guardianActor=null;
    if(S.tab!=='shop'||S.shopTab!=='sell'||S.choosing||S.creating)window.RpgMarketSell?.reset();
    bossWaitingCleanup?.(); bossWaitingCleanup = null;
    drawers = []; const view = $('#view');
    if (!S.meta) return;
    const designState = S.designState || (S.designState = {});
    if (S.choosing) { renderHud(); view.innerHTML = characterSelectView(); bindCharacterSelect(view); window.RpgInterface?.compose(view, { tab: 'select', state: designState }); return; }
    if (S.creating || !S.me) { renderHud(); view.innerHTML = createView(); bindCreate(view); window.RpgInterface?.compose(view, { tab: 'create', state: designState }); return; }
    renderHud();
    if(guardianVisible){view.innerHTML='<div id="guardian-root"></div>';guardianActor=String(S.me.character.tgId);guardianController=window.RpgGuardianSigil.mount(view.querySelector('#guardian-root'),{host:window.RpgGuardianHost,interactive:true,initialView:S.guardianInitialView||'overview',onBack:()=>{S.tab='home';render();}});guardianFrameSize();return;}
    const revealInventory = S._lastTab === 'shop' && S.tab === 'bag';
    const scrollKeep = S._lastTab === S.tab ? window.scrollY : 0; S._lastTab = S.tab;
    if (S.tab === 'home') { view.innerHTML = homeView(); bindHome(view); }
    else if (S.tab === 'bag') { view.innerHTML = bagView(); bindBag(view); }
    else if (S.tab === 'trade') { view.innerHTML = tradeView(); bindTrade(view); }
    else if (S.tab === 'shop') { if(shopForActor!==String(S.me.character.tgId))S.shop=null;view.innerHTML = shopView(); bindShop(view); }
    else if (S.tab === 'class') { view.innerHTML = classView(); bindClass(view); }
    else if (S.tab === 'boss') { view.innerHTML = bossView(); bindBoss(view); }
    window.RpgInterface?.compose(view, { tab: S.tab, state: designState, me: S.me, revealInventory, openGuardian });
    if(S.tab==='shop'){window.RpgMarketExchange.decorate(view);mountMarket(view);}
    window.scrollTo(0, scrollKeep);
  }
  let refreshFlight=null;
  let refreshEpoch=0,refreshFull=false;
  function refreshMe({silent=false,full=S.tab==='bag'}={}) {
    full=full||!!equipmentSync?.pending(S.me?.character?.tgId);
    if(refreshFlight)return refreshEpoch===(S.apiEpoch||0)&&(!full||refreshFull)?refreshFlight:refreshFlight.then(()=>refreshMe({silent,full}));
    const selected=S.me?.character?.tgId,epoch=S.apiEpoch||0,equipmentTicket=equipmentSync?.begin(selected);refreshEpoch=epoch;refreshFull=full;
    refreshFlight=(async()=>{try{const j=await api('me',{summary:!full});if(epoch!==(S.apiEpoch||0)||selected&&S.me?.character?.tgId!==selected)return null;absorb(j,false,equipmentTicket);render();reconcileEquipmentSheet();return j;}catch(e){if(!silent&&e.code!=='no_character')toast(e.message,true);return null;}finally{refreshFlight=null;}})();
    return refreshFlight;
  }
  async function loadShop(force) {const actor=String(S.me?.character?.tgId||''),epoch=S.apiEpoch||0;if(S.shop&&!force&&shopForActor===actor)return;try{const result=await api('shop');if(String(S.me?.character?.tgId||'')!==actor||epoch!==(S.apiEpoch||0))return;absorb(result);shopForActor=actor;if(S.tab==='shop')render();}catch(e){if(String(S.me?.character?.tgId||'')===actor)toast(e.message,true);}}
  let bossFlight=null;
  function loadBoss({silent=false}={}) {
    if(bossFlight)return bossFlight;
    const selected=S.me?.character?.tgId;
    bossFlight=(async()=>{try{const previous=S.boss,revision=S.bossRevision||0,j=await api('boss');if((S.bossRevision||0)!==revision)return null;if(selected&&S.me?.character?.tgId!==selected)return null;absorb(j);if(S.tab==='boss')render();if(previous&&!j.boss)await refreshMe({silent:true});return j;}catch(e){if(!silent)toast(e.message,true);return null;}finally{bossFlight=null;}})();
    return bossFlight;
  }
  async function loadLedger() { try { S.ledger = (await api('ledger')).ledger; const el = $('#ledger'); if (el) el.innerHTML = ledgerHtml(); } catch (_) {} }
  setInterval(()=>{if(!document.hidden&&S.tab==='trade'&&S.social==='hall')loadHeroes()},300000);
  function load(tab) { if(tab==='bag')refreshMe({silent:true,full:true});else if (tab === 'shop') loadShop(true); else if (tab === 'boss') loadBoss(); else if (tab === 'home') loadLedger(); else if (tab === 'trade') { if(S.social==='hall')loadHeroes();else if (S.social === 'pk') loadPks(); else if (S.trade) loadTrade(S.trade.id); else loadTrades(); } }
  // live polling: open trade window every 3 s (other side's items / 鎖定 / OK); request + duel lists every 12 s
  setInterval(() => { if (document.hidden || S.tab !== 'trade' || S.social === 'pk' || !S.trade || S.trade.status !== 'open' || S.busy || !$('#sheet').hidden) return; loadTrade(S.trade.id); }, 3000);
  setInterval(() => { if (document.hidden || S.tab !== 'trade' || S.busy || !$('#sheet').hidden) return; if(S.social==='hall')return;if (S.social === 'pk') loadPks(); else if (!S.trade) loadTrades(); }, 12000);

  // 1-second ticker for countdowns (no full re-render)
  setInterval(() => {
    document.querySelectorAll('[data-cd]').forEach((el) => { const left = Number(el.dataset.cd) - sNow(); el.textContent = mmss(left); if (left <= 0 && S.tab === 'boss' && !S.busy) { el.removeAttribute('data-cd'); loadBoss(); } });
    const n = $('#nextCd'); if (n && S.me && S.me.nextBoss) n.textContent = mmss(S.me.nextBoss.start - sNow());
    const tc = $('#todoCd'); if (tc && S.me && S.me.nextBoss) tc.textContent = mmss(S.me.nextBoss.start - sNow());
  }, 1000);
  setInterval(()=>{if(!document.hidden&&S.me&&S.tab==='boss'&&!S.busy&&$('#sheet').hidden)loadBoss({silent:true});},8000);
  // live idle status: the server settles idle progress on every read; poll gently
  setInterval(() => { if (document.hidden || !S.me || S.busy || !$('#sheet').hidden) return; refreshMe(); if (S.tab === 'boss') loadBoss(); if (S.tab === 'home') loadLedger(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) {refreshMe();if(S.tab==='boss')loadBoss({silent:true});} });

  function fatal(msg) { $('#view').innerHTML = `<div class="boot"><div class="boot-logo">🧚</div><div style="text-align:center;padding:0 20px">${msg}</div></div>`; }
  async function boot() {
    await import('./thief-gear-art.js?v=20261015-thief-gear1');
    if (!initData && !devTg) return fatal('請從 Telegram 的「星穹旅誌」打開遊戲<br><span class="muted">私訊 @StarJournalRpgBot，按「開啟旅誌」或輸入 /rpg</span>');
    const h0 = location.hash.replace(/^#/, '').split('&')[0]; const sp = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || qs.get('screen') || qs.get('tgWebAppStartParam') || (h0.includes('=') ? '' : h0) || '';
    const spx = sp.replace(/^rpg_?/, ''); const tradeId = /^trade_?(t[0-9a-f]{11})$/.exec(spx); const reqId = /^req_?(q[0-9a-f]{11})$/.exec(spx); const pkId = /^pk_?(p[0-9a-f]{11})$/.exec(spx);
    const ringLink=/^ring_([0-9a-f]{32})$/.exec(spx);
    const want = ringLink?'boss':tradeId || reqId || pkId ? 'trade' : { 'star-ring':'boss', gacha:'shop', guardian: 'guardian', boss: 'boss', shop: 'shop', bag: 'bag', class: 'class', home: 'home', trade: 'trade', pk: 'trade' }[spx] || 'home';
    if(spx==='gacha')S.shopTab='gacha';
    if (pkId || spx === 'pk') S.social = 'pk';
    if (tradeId) S.trade = { id: tradeId[1], a: { lines: [], ok: false }, b: { lines: [], ok: false }, status: 'open', expiresAt: 0, offerRev: -1, me: 'a' };
    fetch('art/v2/heroes.json?v=20261011-elf-adv4-2').then((r) => r.json()).then((h) => { HEROES.nodes = new Set(h.nodes || []); HEROES.meta = h.meta || {}; if (S.me) render(); }).catch(() => {});
    fetch('art/hero-display-hd-20261011/manifest.json?v=20261011-hero-display-2').then(r => r.json()).then(h => { Object.assign(HERO_DISPLAY, h.heroes || {});for(const key of [...Object.keys(ELF_ADV4_HD),...Object.keys(ELF_ADV3_HD),...Object.keys(SWORD_ADV2_HD),...Object.keys(SWORD_ADV3_HD),...Object.keys(SWORD_ADV4_HD),...Object.keys(MAGE_ADV2_HD)])HERO_DISPLAY[key]=artSrc('portrait',key); if (S.me && ['bag', 'class'].includes(S.tab)) render(); }).catch(() => {});
    try {
      const [m] = await Promise.all([api('meta')]); S.meta = m.meta; Object.assign(ITEMS_REF, m.meta.items);
      const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; S.create.name = u ? String(u.first_name || '').replace(/[^\p{Script=Han}A-Za-z0-9_]/gu, '').slice(0, 12) : '';
      S.pendingTab = want;
      S.characters = (await api('characters')).characters || []; S.choosing = true;
      render();
    } catch (e) { fatal(e.status === 401 ? '登入驗證失敗，請關閉後從 @StarJournalRpgBot 重新打開' : esc(e.message)); }
  }
  function openCosmeticWardrobe(){
    if(document.querySelector('.sr-cosmetic-modal')||!S.me)return;
    const dialog=document.createElement('dialog');dialog.className='sr-cosmetic-modal';dialog.setAttribute('aria-label','星環專屬外觀');dialog.innerHTML='<button class="sr-cosmetic-close" type="button" aria-label="關閉衣櫥">×</button><div data-cosmetic-root></div>';document.body.append(dialog);
    const owner=S.me.character.tgId,stop=window.RpgStarRingCosmetics.mount(dialog.querySelector('[data-cosmetic-root]'),{me:()=>S.me,api:(action,body)=>{if(owner!==S.me?.character?.tgId)throw Error('角色已切換，請重新開啟衣櫥');return api(action,body);},actorArt:characterPortrait,refresh:()=>refreshMe(),toast});
    const close=()=>{stop();dialog.close();dialog.remove();};dialog.querySelector('.sr-cosmetic-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();
  }
  window.RpgFateHost={characterId:()=>S.me?.character?.tgId,characterName:()=>S.me?.character?.name,request:(action,body)=>api(action,body),refresh:()=>refreshMe()};
  window.RpgExpeditionHost={invite:p=>{if(!/^ring:[0-9a-f]{32}$/.test(String(p?.id||'')))return;const link='https://t.me/StarJournalRpgBot?startapp=ring_'+p.id.slice(5),count=(p.members||[]).filter(m=>!m.left).length,text='✦ 星環遠征 · Lv.'+p.tier+'\n'+p.name+'，尚缺 '+Math.max(0,5-count)+' 名夥伴。五人同行、十二小時，離線也能一起成長。',url='https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(text);if(tg?.openTelegramLink)tg.openTelegramLink(url);else window.open(url,'_blank','noopener');},request:(action,b)=>{if(b?.selectedCharacterId&&String(b.selectedCharacterId)!==String(S.me?.character?.tgId)){const e=Error('角色已切換，請重新開啟組隊畫面');e.code='character_changed';throw e;}return api(action,b);},me:()=>S.me,toast,characterId:()=>S.me?.character?.tgId,now:sNow,journal:()=>api('journal'),journalEnroll:()=>api('journal/enroll'),journalClaim:b=>api('journal/claim',b),openTab:tab=>{S.tab=tab;render();load(tab);},guardianAssist:async b=>{const r=await api('guardian/assist',b);await refreshMe();return r;},skillState:()=>api('expedition/me'),skillAction:b=>api('expedition/action',b),partyList:()=>api('party/list'),refresh:()=>refreshMe(),openTrade:async id=>{S.tab='trade';S.social='trade';await selectTrade(id);render();}};
  boot();
})();










