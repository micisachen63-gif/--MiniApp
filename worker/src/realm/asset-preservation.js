// Migration/rebalance policy: existing progression and each item's +N are assets,
// never defaults to regenerate. These helpers operate on snapshots, not live D1.
import { GameError } from '../game/classes.js';

export const EQUIPMENT_ABILITY_FIELDS = Object.freeze([
  'base_stat', 'bonus_json', 'affixes_json', 'affix_json', 'element_stat',
]);
const abilityFields = new Set(EQUIPMENT_ABILITY_FIELDS);
const numericFields = new Set(['base_stat', 'element_stat']);
const metadataKeys = ['endgameOrigin','towerImprint', 'starRingGearVersion', 'starRingYieldVersion','atlasLootVersion','atlasLootRunId','atlasLootMapId','atlasLootRewardId'];
const fail = (message) => { throw new GameError('asset_preservation', message, 409); };
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function parseJson(value, field) {
  if (value == null || value === '') return field === 'affixes_json' ? [] : {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') throw new Error('object required');
    const visit = entry => {
      if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('finite abilities required');
      if (entry && typeof entry === 'object') for (const child of Object.values(entry)) visit(child);
    };
    visit(parsed);
    return parsed;
  } catch { fail('道具能力資料格式無效'); }
}

export function applyEquipmentAbilityPatch(item, patch) {
  if (!item?.id || !patch || typeof patch !== 'object' || Array.isArray(patch)) fail('需要原始裝備及能力調整內容');
  const next = { ...item };
  for (const [field, value] of Object.entries(patch)) {
    if (!abilityFields.has(field)) fail(`能力調整不能更動保護欄位：${field}`);
    if (numericFields.has(field)) {
      if (!Number.isSafeInteger(value) || value < 0) fail('道具能力必須為非負安全整數');
      next[field] = value;
    } else {
      const parsed = parseJson(value, field);
      const old = parseJson(item[field], field);
      for (const key of metadataKeys) if (!same(old[key], parsed[key])) fail('不能清除裝備既有的養成或版本紀錄');
      next[field] = JSON.stringify(parsed);
    }
  }
  assertEquipmentPreserved(item, next);
  return next;
}

export function assertEquipmentPreserved(before, after) {
  if (!before || !after) fail('不能刪除或重建既有裝備');
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!abilityFields.has(key) && !same(before[key], after[key])) fail(`裝備保護欄位已改變：${key}`);
  }
  // Keep the explicit check even if the ability allowlist is later expanded.
  if (!Object.hasOwn(before, 'enhance_level') || !Object.hasOwn(after, 'enhance_level') || before.enhance_level !== after.enhance_level)
    fail('裝備強化值必須原樣保留');
  for (const field of EQUIPMENT_ABILITY_FIELDS.filter(key => !numericFields.has(key))) {
    const old = parseJson(before[field], field), current = parseJson(after[field], field);
    for (const key of metadataKeys) if (!same(old[key], current[key])) fail('不能清除裝備既有的養成或版本紀錄');
  }
  return true;
}

function keyed(rows, key, label) {
  if (!Array.isArray(rows)) fail(`${label}快照格式無效`);
  const result = new Map();
  for (const row of rows) {
    const id = row?.[key];
    if (id == null || result.has(String(id))) fail(`${label}包含缺少或重複的身分`);
    result.set(String(id), row);
  }
  return result;
}

/** No blanket exception for timestamps, gold, skills, level or unknown future columns. */
export function assertCharacterDataPreserved(before, after) {
  const old = keyed(before, 'tg_id', '角色'), current = keyed(after, 'tg_id', '角色');
  if (old.size !== current.size) fail('既有角色數量不能因改版改變');
  for (const [id, row] of old) if (!same(row, current.get(id))) fail('既有角色資料或進度已改變');
  return true;
}

/** Produces a reviewable plan only; never writes a database or starts gameplay. */
export function planEquipmentRebalance(equipment, changes) {
  const old = keyed(equipment, 'id', '裝備');
  const proposals = keyed(changes, 'id', '能力調整');
  const updates = [];
  for (const [id, proposal] of proposals) {
    const item = old.get(id);
    if (!item) fail('能力調整指向不存在的裝備');
    const next = applyEquipmentAbilityPatch(item, proposal.abilities);
    const changed = Object.fromEntries(EQUIPMENT_ABILITY_FIELDS.filter(key => !same(item[key], next[key])).map(key => [key, next[key]]));
    if (Object.keys(changed).length) updates.push({ id, owner: item.tg_id, expectedEnhanceLevel: item.enhance_level, before: Object.fromEntries(Object.keys(changed).map(key => [key, item[key]])), changes: changed });
  }
  return { policy: 'preserve-progress-and-enhancement-v1', existingItems: old.size, changedItems: updates.length, enhancementChanges: 0, updates };
}

export function assertRebalanceSnapshotPreserved(before, after) {
  assertCharacterDataPreserved(before.characters, after.characters);
  const old = keyed(before.equipment, 'id', '裝備'), current = keyed(after.equipment, 'id', '裝備');
  if (old.size !== current.size) fail('既有裝備數量不能因改版改變');
  for (const [id, item] of old) assertEquipmentPreserved(item, current.get(id));
  // Inventory, angels, receipts, quest state and future datasets are immutable.
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key !== 'characters' && key !== 'equipment' && !same(before[key], after[key])) fail(`既有資料已改變：${key}`);
  }
  return { ok: true, characters: before.characters.length, equipment: old.size, enhancementChanges: 0 };
}
