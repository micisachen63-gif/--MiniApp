// Visual map progression: one Greek-mythology environment for each ten-level band.
// Gameplay tiers remain separate so this only changes scenery and map labels.
(() => {
  const scenes = Object.freeze([
    { id: 1, min: 1, max: 10, name: '阿耳忒彌斯月桂林', emoji: '🌿', mood: '月光聖林' },
    { id: 2, min: 11, max: 20, name: '雅典娜百柱神殿', emoji: '🏛️', mood: '智慧聖殿' },
    { id: 3, min: 21, max: 30, name: '阿卡迪亞聖林', emoji: '🌲', mood: '精靈泉源' },
    { id: 4, min: 31, max: 40, name: '波賽頓愛琴海崖', emoji: '🌊', mood: '海神斷崖' },
    { id: 5, min: 41, max: 50, name: '克里特迷宮門庭', emoji: '🌀', mood: '米諾斯迷宮' },
    { id: 6, min: 51, max: 60, name: '赫淮斯托斯熔爐', emoji: '🌋', mood: '火神鍛造場' },
    { id: 7, min: 61, max: 70, name: '冥河斯堤克斯渡口', emoji: '🌫️', mood: '冥界河岸' },
    { id: 8, min: 71, max: 80, name: '德爾菲阿波羅神諭谷', emoji: '🔮', mood: '神諭聖域' },
    { id: 9, min: 81, max: 90, name: '泰坦諸神山隘', emoji: '⛰️', mood: '泰坦高原' },
    { id: 10, min: 91, max: 100, name: '奧林帕斯雲門', emoji: '☁️', mood: '天界門廊' },
    { id: 11, min: 101, max: 110, name: '至福樂土', emoji: '✨', mood: '英雄安息之境' },
    { id: 12, min: 111, max: 120, name: '奧林帕斯星穹聖殿', emoji: '🌌', mood: '眾神星殿' },
  ]);
  // Lv.600 endgame (server endgame.js, endgame-v1): five world modes of 120 levels each. Every round
  // replays the same twelve scenes, so Lv.121 is scene 1 of round 2 (菁英) and Lv.600 is scene 12 of 地獄.
  const CYCLE_LEVELS = 120, MAX_LEVEL = 600;
  const modes = Object.freeze([['normal', '普通'], ['elite', '菁英'], ['expert', '專家'], ['nightmare', '惡夢'], ['hell', '地獄']]
    .map(([id, name], index) => Object.freeze({ id, name, index, round: index + 1, minLevel: index * CYCLE_LEVELS + 1, maxLevel: (index + 1) * CYCLE_LEVELS })));
  const clampLevel = (level) => Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const localLevel = (level) => (clampLevel(level) - 1) % CYCLE_LEVELS + 1;
  const mode = (level) => modes[Math.floor((clampLevel(level) - 1) / CYCLE_LEVELS)];
  const get = (level) => scenes[Math.ceil(localLevel(level) / 10) - 1];
  // Class awakenings unlock with each new round (server awakening.js AWAKENINGS; names and levels only).
  const awakeningRows = Object.freeze([
    ['sword', 'elite', '戰神破勢'], ['sword', 'expert', '壁壘回響'], ['sword', 'nightmare', '血誓狂潮'], ['sword', 'hell', '諸神斷罪'],
    ['archer', 'elite', '逐星連矢'], ['archer', 'expert', '群靈共獵'], ['archer', 'nightmare', '月蝕獵印'], ['archer', 'hell', '蒼穹裁決'],
    ['mage', 'elite', '星雷共鳴'], ['mage', 'expert', '霜鏡回流'], ['mage', 'nightmare', '元素裂解'], ['mage', 'hell', '太初星爆'],
    ['thief', 'elite', '影襲連鎖'], ['thief', 'expert', '淬毒散華'], ['thief', 'nightmare', '暗月處決'], ['thief', 'hell', '永夜分身'],
  ].map(([baseClass, modeId, name]) => Object.freeze({ id: `awakening:${baseClass}:${modeId}`, baseClass, mode: modeId, name, unlockLevel: modes.find((m) => m.id === modeId).minLevel })));
  const awakenings = (baseClass, level) => awakeningRows.filter((a) => a.baseClass === baseClass).map((a) => ({ ...a, unlocked: clampLevel(level) >= a.unlockLevel }));
  const progression = (level) => { const m = mode(level); return { level: clampLevel(level), localLevel: localLevel(level), maxLevel: MAX_LEVEL, cycleLevels: CYCLE_LEVELS, mode: m, round: m.round, rounds: modes.length, scene: get(level), next: modes[m.index + 1] || null }; };
  window.RpgMaps = Object.freeze({ scenes, get, key: (level) => `myth${String(get(level).id).padStart(2, '0')}`, modes, mode, localLevel, progression, awakenings, CYCLE_LEVELS, MAX_LEVEL });
})();
