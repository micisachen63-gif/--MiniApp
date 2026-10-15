import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const v2Dir = fileURLToPath(new URL('../public/art/v2/', import.meta.url));
const manifestPath = path.join(v2Dir, 'manifest.json');
const appJsPath = fileURLToPath(new URL('../public/app.js', import.meta.url));

const EXPECTED_T1_GEAR = [
  // 3 武器
  { name: '月桂短劍', file: 'gear_wpn_laurel_sword' },
  { name: '月桂法杖', file: 'gear_wpn_laurel_staff' },
  { name: '月桂狩獵弓', file: 'gear_wpn_laurel_longbow' },

  // 4 劍士板甲
  { name: '月桂頭盔', file: 'gear_helm_laurel_plate' },
  { name: '月桂板甲', file: 'gear_arm_laurel_plate' },
  { name: '月桂鐵護手', file: 'gear_gloves_laurel_plate' },
  { name: '月桂鐵靴', file: 'gear_boots_laurel_plate' },

  // 4 妖精皮甲
  { name: '月桂皮帽', file: 'gear_helm_laurel_leather' },
  { name: '月桂皮甲', file: 'gear_arm_laurel_leather' },
  { name: '月桂皮手套', file: 'gear_gloves_laurel_leather' },
  { name: '月桂皮靴', file: 'gear_boots_laurel_leather' },

  // 4 法師布袍
  { name: '月桂法師帽', file: 'gear_helm_laurel_cloth' },
  { name: '月桂法袍', file: 'gear_arm_laurel_robe' },
  { name: '月桂法師手套', file: 'gear_gloves_laurel_cloth' },
  { name: '月桂法師鞋', file: 'gear_boots_laurel_cloth' },

  // 4 通用飾品
  { name: '月桂編織腰帶', file: 'gear_belt_laurel' },
  { name: '月桂亞麻內衣', file: 'gear_undershirt_laurel' },
  { name: '月桂葉耳飾', file: 'gear_earring_laurel' },
  { name: '月桂枝戒', file: 'gear_ring_laurel' },
];

const EXPECTED_T2_GEAR = [
  // 3 武器
  { name: '雅典佩劍', file: 'gear_wpn_athena_sword' },
  { name: '雅典智慧杖', file: 'gear_wpn_athena_staff' },
  { name: '雅典守衛弓', file: 'gear_wpn_athena_longbow' },

  // 4 劍士板甲
  { name: '雅典頭盔', file: 'gear_helm_athena_plate' },
  { name: '雅典板甲', file: 'gear_arm_athena_plate' },
  { name: '雅典鐵護手', file: 'gear_gloves_athena_plate' },
  { name: '雅典鐵靴', file: 'gear_boots_athena_plate' },

  // 4 妖精皮甲
  { name: '雅典皮帽', file: 'gear_helm_athena_leather' },
  { name: '雅典皮甲', file: 'gear_arm_athena_leather' },
  { name: '雅典皮手套', file: 'gear_gloves_athena_leather' },
  { name: '雅典皮靴', file: 'gear_boots_athena_leather' },

  // 4 法師布袍
  { name: '雅典法師帽', file: 'gear_helm_athena_cloth' },
  { name: '雅典法袍', file: 'gear_arm_athena_robe' },
  { name: '雅典法師手套', file: 'gear_gloves_athena_cloth' },
  { name: '雅典法師鞋', file: 'gear_boots_athena_cloth' },

  // 4 通用飾品
  { name: '雅典神殿皮帶', file: 'gear_belt_athena' },
  { name: '雅典絲織內衣', file: 'gear_undershirt_athena' },
  { name: '雅典石玉耳墜', file: 'gear_earring_athena' },
  { name: '雅典銀印戒', file: 'gear_ring_athena' },
];

const EXPECTED_T3_GEAR = [
  // 3 武器
  { name: '聖林銳劍', file: 'gear_wpn_sacred_sword' },
  { name: '聖林藤木杖', file: 'gear_wpn_sacred_staff' },
  { name: '聖林青藤弓', file: 'gear_wpn_sacred_longbow' },

  // 4 劍士板甲
  { name: '聖林頭盔', file: 'gear_helm_sacred_plate' },
  { name: '聖林板甲', file: 'gear_arm_sacred_plate' },
  { name: '聖林鐵護手', file: 'gear_gloves_sacred_plate' },
  { name: '聖林鐵靴', file: 'gear_boots_sacred_plate' },

  // 4 妖精皮甲
  { name: '聖林皮帽', file: 'gear_helm_sacred_leather' },
  { name: '聖林皮甲', file: 'gear_arm_sacred_leather' },
  { name: '聖林皮手套', file: 'gear_gloves_sacred_leather' },
  { name: '聖林皮靴', file: 'gear_boots_sacred_leather' },

  // 4 法師布袍
  { name: '聖林法師帽', file: 'gear_helm_sacred_cloth' },
  { name: '聖林法袍', file: 'gear_arm_sacred_robe' },
  { name: '聖林法師手套', file: 'gear_gloves_sacred_cloth' },
  { name: '聖林法師鞋', file: 'gear_boots_sacred_cloth' },

  // 4 通用飾品
  { name: '聖林精靈腰帶', file: 'gear_belt_sacred' },
  { name: '聖林木棉內衣', file: 'gear_undershirt_sacred' },
  { name: '聖林泉水耳墜', file: 'gear_earring_sacred' },
  { name: '聖林翡翠戒', file: 'gear_ring_sacred' },
];

const EXPECTED_T4_GEAR = [
  // 3 武器
  { name: '海神之劍', file: 'gear_wpn_poseidon_sword' },
  { name: '海神潮汐杖', file: 'gear_wpn_poseidon_staff' },
  { name: '海神風暴弓', file: 'gear_wpn_poseidon_longbow' },

  // 4 劍士板甲
  { name: '海神頭盔', file: 'gear_helm_poseidon_plate' },
  { name: '海神板甲', file: 'gear_arm_poseidon_plate' },
  { name: '海神鐵護手', file: 'gear_gloves_poseidon_plate' },
  { name: '海神鐵靴', file: 'gear_boots_poseidon_plate' },

  // 4 妖精皮甲
  { name: '海神皮帽', file: 'gear_helm_poseidon_leather' },
  { name: '海神皮甲', file: 'gear_arm_poseidon_leather' },
  { name: '海神皮手套', file: 'gear_gloves_poseidon_leather' },
  { name: '海神皮靴', file: 'gear_boots_poseidon_leather' },

  // 4 法師布袍
  { name: '海神法師帽', file: 'gear_helm_poseidon_cloth' },
  { name: '海神法袍', file: 'gear_arm_poseidon_robe' },
  { name: '海神法師手套', file: 'gear_gloves_poseidon_cloth' },
  { name: '海神法師鞋', file: 'gear_boots_poseidon_cloth' },

  // 4 通用飾品
  { name: '海神波濤腰帶', file: 'gear_belt_poseidon' },
  { name: '海神鱗紋內衣', file: 'gear_undershirt_poseidon' },
  { name: '海神珍珠耳墜', file: 'gear_earring_poseidon' },
  { name: '海神珊瑚戒', file: 'gear_ring_poseidon' },
];

const EXPECTED_BRANCH_GEAR = [
  // T2 雅典階分支武器 (6)
  { name: '雅典厚刃巨劍', file: 'gear_wpn_athena_greatsword' },
  { name: '雅典衛士劍盾', file: 'gear_wpn_athena_sword_shield' },
  { name: '雅典元素使杖', file: 'gear_wpn_athena_elem_staff' },
  { name: '雅典智慧短杖', file: 'gear_wpn_athena_wand' },
  { name: '雅典風切複合弓', file: 'gear_wpn_athena_compound_bow' },
  { name: '雅典鋼弦重弩', file: 'gear_wpn_athena_crossbow' },

  // T3 聖林階分支武器 (6)
  { name: '聖林裂地巨劍', file: 'gear_wpn_sacred_greatsword' },
  { name: '聖林守護劍盾', file: 'gear_wpn_sacred_sword_shield' },
  { name: '聖林風雷之杖', file: 'gear_wpn_sacred_elem_staff' },
  { name: '聖林秘語典籍', file: 'gear_wpn_sacred_wand' },
  { name: '聖林疾風複合弓', file: 'gear_wpn_sacred_compound_bow' },
  { name: '聖林百步弩', file: 'gear_wpn_sacred_crossbow' },

  // T4 海神階分支武器 (6)
  { name: '海神破浪巨劍', file: 'gear_wpn_poseidon_greatsword' },
  { name: '海神浪壁劍盾', file: 'gear_wpn_poseidon_sword_shield' },
  { name: '海神怒濤元素杖', file: 'gear_wpn_poseidon_elem_staff' },
  { name: '海神深藍魔杖', file: 'gear_wpn_poseidon_wand' },
  { name: '海神破浪複合弓', file: 'gear_wpn_poseidon_compound_bow' },
  { name: '海神重潮弩', file: 'gear_wpn_poseidon_crossbow' },
];

const EXPECTED_T5_GEAR = [
  // 3 基礎武器
  { name: '迷宮秘劍', file: 'gear_wpn_labyrinth_sword' },
  { name: '迷宮引路杖', file: 'gear_wpn_labyrinth_staff' },
  { name: '迷宮穿楊弓', file: 'gear_wpn_labyrinth_longbow' },

  // 6 分支武器
  { name: '迷宮屠牛巨劍', file: 'gear_wpn_labyrinth_greatsword' },
  { name: '迷宮迷蹤劍盾', file: 'gear_wpn_labyrinth_sword_shield' },
  { name: '迷宮秘術元素杖', file: 'gear_wpn_labyrinth_elem_staff' },
  { name: '迷宮符文寶典', file: 'gear_wpn_labyrinth_wand' },
  { name: '迷宮死線複合弓', file: 'gear_wpn_labyrinth_compound_bow' },
  { name: '迷宮陷陣弩', file: 'gear_wpn_labyrinth_crossbow' },

  // 4 劍士板甲
  { name: '迷宮頭盔', file: 'gear_helm_labyrinth_plate' },
  { name: '迷宮板甲', file: 'gear_arm_labyrinth_plate' },
  { name: '迷宮鐵護手', file: 'gear_gloves_labyrinth_plate' },
  { name: '迷宮鐵靴', file: 'gear_boots_labyrinth_plate' },

  // 4 妖精皮甲
  { name: '迷宮皮帽', file: 'gear_helm_labyrinth_leather' },
  { name: '迷宮皮甲', file: 'gear_arm_labyrinth_leather' },
  { name: '迷宮皮手套', file: 'gear_gloves_labyrinth_leather' },
  { name: '迷宮皮靴', file: 'gear_boots_labyrinth_leather' },

  // 4 法師布袍
  { name: '迷宮法師帽', file: 'gear_helm_labyrinth_cloth' },
  { name: '迷宮法袍', file: 'gear_arm_labyrinth_robe' },
  { name: '迷宮法師手套', file: 'gear_gloves_labyrinth_cloth' },
  { name: '迷宮法師鞋', file: 'gear_boots_labyrinth_cloth' },

  // 4 通用飾品
  { name: '迷宮牛皮腰帶', file: 'gear_belt_labyrinth' },
  { name: '迷宮密織內衣', file: 'gear_undershirt_labyrinth' },
  { name: '迷宮秘石耳環', file: 'gear_earring_labyrinth' },
  { name: '迷宮紋章戒', file: 'gear_ring_labyrinth' },
];

const EXPECTED_T6_FINISHED = [
  // 9 武器 (全套完工)
  { name: '熔爐鍛劍', file: 'gear_wpn_forge_sword' },
  { name: '熔爐熾炎巨劍', file: 'gear_wpn_forge_greatsword' },
  { name: '熔爐烈鋼劍盾', file: 'gear_wpn_forge_sword_shield' },
  { name: '熔爐熾晶杖', file: 'gear_wpn_forge_staff' },
  { name: '熔爐純火元素杖', file: 'gear_wpn_forge_elem_staff' },
  { name: '熔爐火印魔杖', file: 'gear_wpn_forge_wand' },
  { name: '熔爐火翎弓', file: 'gear_wpn_forge_longbow' },
  { name: '熔爐焰爆複合弓', file: 'gear_wpn_forge_compound_bow' },
  { name: '熔爐熾炎鋼弩', file: 'gear_wpn_forge_crossbow' },

  // 4 劍士板甲 (全套完工)
  { name: '熔爐頭盔', file: 'gear_helm_forge_plate' },
  { name: '熔爐板甲', file: 'gear_arm_forge_plate' },
  { name: '熔爐鐵護手', file: 'gear_gloves_forge_plate' },
  { name: '熔爐鐵靴', file: 'gear_boots_forge_plate' },
];

const ALL_GEAR = [...EXPECTED_T1_GEAR, ...EXPECTED_T2_GEAR, ...EXPECTED_T3_GEAR, ...EXPECTED_T4_GEAR, ...EXPECTED_BRANCH_GEAR, ...EXPECTED_T5_GEAR, ...EXPECTED_T6_FINISHED];

test('T1～T6 已完工裝備與全分支武器 (共 132 件) 圖檔實體與 manifest 驗證', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  for (const item of ALL_GEAR) {
    const filePath = path.join(v2Dir, `${item.file}.webp`);
    assert.ok(fs.existsSync(filePath), `圖檔必須存在: ${filePath}`);

    const stat = fs.statSync(filePath);
    assert.ok(stat.size >= 10000, `${item.name} 圖檔大小應 >= 10KB (實際: ${stat.size} bytes)`);

    const meta = manifest[item.file];
    assert.ok(meta, `manifest.json 必須包含 ${item.file}`);
    assert.equal(meta[0], 256, `${item.file} 寬度應為 256`);
    assert.equal(meta[1], 256, `${item.file} 高度應為 256`);
    assert.equal(meta[2], stat.size, `${item.file} 位元組大小應與實體相符`);
  }
});

test('app.js 前端 GEAR_NAME_ART 映射完整性與遺物前綴容錯', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  for (const item of ALL_GEAR) {
    assert.ok(
      appJs.includes(`'${item.name}': '${item.file}'`),
      `app.js GEAR_NAME_ART 必須包含 '${item.name}': '${item.file}'`
    );
  }

  // 驗證遺物與菁英前綴清理邏輯
  assert.ok(appJs.includes('replace(/^(?:(?:遺物・|菁英))*/'), '必須包含連續前綴清理邏輯');
});
