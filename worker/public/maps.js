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
  const get = (level) => scenes[Math.max(0, Math.min(scenes.length - 1, Math.ceil(Math.max(1, Number(level) || 1) / 10) - 1))];
  window.RpgMaps = Object.freeze({ scenes, get, key: (level) => `myth${String(get(level).id).padStart(2, '0')}` });
})();
