/* Identity and release gate shared by all Mini App thief surfaces. */
(function (root) {
  'use strict';
  const LEGACY = new Set(['sword', 'archer', 'mage']);
  function selectableClasses(classes) {
    return Object.fromEntries(Object.entries(classes || {}).filter(([key, value]) =>
      value && value.releaseReady !== false && (LEGACY.has(key) || value.releaseReady === true)));
  }
  function heroKey(baseClass, gender, path = '') {
    if (baseClass !== 'thief') return null;
    if (!['m', 'f'].includes(gender) || (path && !/^[AB][12]{0,3}$/.test(path))) return null;
    return path ? `adv${path.length}_thief_${path}_${gender}` : `thief_${gender}`;
  }
  function isThiefKey(key) { return /^(?:thief_[mf]|adv[1-4]_thief_[AB][12]{0,3}_[mf]|thief:[mf])$/.test(String(key)); }
  function traits(classInfo) {
    const speed = classInfo?.attackSpeedMultiplier;
    const detail = typeof speed === 'number' && Number.isFinite(speed) && speed > 1 ? `（攻擊頻率 ×${Number(speed.toFixed(2))}）` : '';
    const potency = classInfo?.hitAttackMultiplier;
    const strike = typeof potency === 'number' && Number.isFinite(potency) && potency > 0 && potency <= 1 ? `，單擊威力 ${Number((potency * 100).toFixed(2))}%` : '';
    return `極高攻速${detail}${strike}・脆皮：生命與防禦較低，依靠快速連擊與戰術防護作戰。全路線套用近戰守護。`;
  }
  function stages(classInfo) {
    const nodes = classInfo?.lineageNodes || [];
    const entries = Array.isArray(nodes) ? nodes : Object.entries(nodes).map(([path, node]) => ({ ...node, path }));
    return [0, 1, 2, 3, 4].map(tier => ({ tier, entries: entries.filter(node => String(node.path || '').length === tier) }));
  }
  root.RpgThiefClass = Object.freeze({ selectableClasses, heroKey, isThiefKey, stages, traits });
})(typeof window !== 'undefined' ? window : globalThis);
