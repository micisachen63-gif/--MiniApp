/**
 * Generate the visual-only skill inventory from current authoritative game data.
 * This tool never changes combat, players, saved encounters or deployment state.
 * Run from any cwd: node worker/tools/build-skill-vfx-catalog.mjs
 * --check validates existing output against live sources without writing.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES, CLASS_KEYS, MAX_OPEN_CLASS_TIER, MAX_LEVEL } from '../src/game/constants.js';
import { nodeFor } from '../src/game/stats.js';
import { SPECIAL_SKILLS, LEGACY_SPECIAL_SKILLS } from '../src/game/special-data.js';
import { MECHANICS, baseOf, eligible, skillCoefficient } from '../src/game/special.js';
import { THIEF_RELEASE_READY, THIEF_PATHS } from '../src/game/thief-data.js';
import { ATLAS_BUILDS, ATLAS_SUPPORTS, ATLAS_RULESET_VERSION } from '../src/game/atlas-catalog.js';
import { getAtlasTalentCatalog, ATLAS_TALENT_VERSION } from '../src/game/atlas-talents.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogPath = join(root, 'worker/public/skill-vfx-catalog.json');
const auditPath = join(root, 'worker/art-production/skill-vfx-20261104/catalog-audit.json');
const sourcePaths = [
  'worker/src/game/constants.js', 'worker/src/game/stats.js',
  'worker/src/game/classes.js', 'worker/src/game/advanced-specializations.js',
  'worker/src/game/elf-future.js', 'worker/src/game/mage-future.js',
  'worker/src/game/mage-fourth.js', 'worker/src/game/thief-data.js',
  'worker/src/game/thief-advancement.js', 'worker/src/game/thief-skills.js',
  'worker/src/game/thief-skill-catalog.js', 'worker/src/game/special-data.js',
  'worker/src/game/special.js', 'worker/src/game/skill-mastery.js',
  'worker/src/game/atlas-catalog.js', 'worker/src/game/atlas-talents.js',
];
const plannedSourcePath = 'progression-design-20261102/星穹旅誌 五輪模式與覺醒技能規劃 20261102.txt';
const plannedSourceLocal = resolve(root, '../../', plannedSourcePath);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sourceHashes = sourcePaths.map(path => {
  const data = readFileSync(join(root, path));
  return { path, bytes: data.length, sha256: sha256(data) };
});
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const generatedAt = new Date().toISOString();
const classes = ['sword', 'archer', 'mage', 'thief'].filter(base => CLASS_KEYS.includes(base));
const paths = [''];
let tierPaths = [''];
for (let tier = 1; tier <= MAX_OPEN_CLASS_TIER; tier++) {
  tierPaths = tierPaths.flatMap(parent => (tier === 1 ? ['A', 'B'] : ['1', '2']).map(branch => parent + branch));
  paths.push(...tierPaths);
}
const families = new Set(['slash','whirlwind','bleed','shield','counter','pierce','volley','rain','snipe','beast','summon','trap','lightning','frost','fireball','meteor','arcane','beam','heal','holy','buff','poison','execute','combo','dash','shadow','time','curse']);
const specialFamily = {
  skill_01_1:'slash', skill_01_2:'buff', skill_01_3:'execute',
  skill_02_1:'shield', skill_02_2:'shield', skill_02_3:'counter',
  skill_03_1:'pierce', skill_03_2:'rain', skill_03_3:'buff',
  skill_04_1:'beast', skill_04_2:'heal', skill_04_3:'beast',
  skill_05_1:'fireball', skill_05_2:'frost', skill_05_3:'lightning',
  skill_06_1:'arcane', skill_06_2:'shield', skill_06_3:'time',
  skill_07_1:'whirlwind', skill_07_2:'shield',
  skill_08_1:'combo', skill_08_2:'slash',
  skill_09_1:'holy', skill_09_2:'shield',
  skill_10_1:'shield', skill_10_2:'slash',
  skill_11_1:'snipe', skill_11_2:'buff',
  skill_12_1:'volley', skill_12_2:'shield',
  skill_13_1:'beast', skill_13_2:'heal',
  skill_14_1:'trap', skill_14_2:'trap',
  skill_15_1:'meteor', skill_15_2:'arcane',
  skill_16_1:'frost', skill_16_2:'shield',
  skill_17_1:'time', skill_17_2:'time',
  skill_18_1:'summon', skill_18_2:'shadow',
  skill_19_1:'slash', skill_19_2:'buff',
  skill_20_1:'rain', skill_20_2:'heal',
  skill_21_1:'arcane', skill_21_2:'shield',
  skill_22_1:'execute', skill_22_2:'shield',
  skill_23_1:'volley', skill_23_2:'heal',
  skill_24_1:'meteor', skill_24_2:'heal',
  skill_thief_01:'curse', skill_thief_02:'shadow', skill_thief_03:'execute',
  skill_thief_04:'poison', skill_thief_05:'pierce', skill_thief_06:'counter',
};
const atlasFamily = {
  sword_whirlwind:'whirlwind', sword_bleed:'bleed', sword_counter:'counter',
  archer_pierce:'pierce', archer_beast:'beast', archer_trap:'trap',
  mage_chain:'lightning', mage_frost:'frost', mage_arcane:'beam',
  thief_poison:'poison', thief_execute:'execute', thief_combo:'combo',
};
function nativeFamily(base, path, skill) {
  // Higher-tier names are cosmetic renames of inherited numerical route skills.
  // Preserve the authored route identity; a renamed druid is not an arrow volley.
  if (base === 'thief') {
    if (path.startsWith('A2')) return 'poison';
    if (path.startsWith('A1')) return 'dash';
    if (path.startsWith('B1') || path === 'B') return 'pierce';
    if (path.startsWith('B2')) return 'shadow';
    return path ? 'combo' : 'dash';
  }
  if (base === 'sword') {
    if (path === 'A' || path.startsWith('A1')) return 'whirlwind';
    if (path.startsWith('A2')) return 'dash';
    if (path.startsWith('B1')) return 'holy';
    if (path.startsWith('B')) return 'shield';
    return 'slash';
  }
  if (base === 'archer') {
    if (path === 'B' || path.startsWith('B1')) return 'beast';
    if (path.startsWith('B2')) return 'trap';
    if (path.startsWith('A1')) return 'pierce';
    if (path === 'A') return 'rain';
    return 'volley';
  }
  if (path.startsWith('B2')) return 'summon';
  if (path.startsWith('B1')) return 'time';
  if (path.startsWith('A2')) return 'frost';
  if (path.startsWith('A11')) return 'fireball';
  if (path.startsWith('A1')) return 'meteor';
  if (path === 'A') return 'lightning';
  if (path === 'B') return 'arcane';
  return 'fireball';
}
function visualElement(base, family, name) {
  if (/冰|霜|寒|凜|雪/.test(name)) return 'ice';
  if (/火|炎|焚|熾|燃/.test(name)) return 'fire';
  if (family === 'frost') return 'ice';
  if (family === 'fireball' || family === 'meteor') return 'fire';
  if (family === 'poison') return 'poison';
  if (family === 'bleed' || /血|猩紅/.test(name)) return 'blood';
  if (family === 'lightning') return 'lightning';
  if (family === 'holy' || /聖|神域|恩典|復甦/.test(name)) return 'light';
  if (family === 'time' || family === 'arcane' || family === 'beam') return 'arcane';
  if (family === 'shadow' || family === 'curse' || base === 'thief') return 'shadow';
  if (base === 'archer') return 'nature';
  return base === 'mage' ? 'arcane' : 'steel';
}
function decorated(record) {
  assert.ok(families.has(record.family), 'Unknown visual family: ' + record.id);
  return {
    ...record,
    visualElement: visualElement(record.baseClass, record.family, record.name),
    visualClassification: 'art-direction-only',
    combatElementSource: 'authoritative-encounter-or-character-equipment; never inferred from the visual family',
  };
}
function targetLimit(skill) {
  const match = skill.damage?.match(/最多\s*(\d+)\s*敵/);
  return match ? Number(match[1]) : 1;
}
function specialKind(skill, mechanics, coefficient) {
  if (mechanics.summon) return 'summon';
  if (coefficient > 0) return 'attack';
  if (mechanics.revive || mechanics.heal) return 'heal';
  if (mechanics.shield || mechanics.guard || mechanics.lastStand || mechanics.nextReduce || mechanics.reduce) return 'shield';
  return 'buff';
}
const native = classes.flatMap(baseClass => paths.map(classPath => {
  const node = nodeFor(baseClass, classPath);
  const family = nativeFamily(baseClass, classPath, node.skill);
  const tags = ['native', 'direct-damage'];
  if (node.skill.targets > 1) tags.push('area');
  if (baseClass === 'thief' && classPath.startsWith('A2')) tags.push('poison', 'dot');
  if (baseClass === 'thief' && classPath.startsWith('A1')) tags.push('mark');
  if (baseClass === 'thief' && classPath.startsWith('B2')) tags.push('enemy-next-reduce');
  return decorated({
    id: 'native:' + baseClass + ':' + (classPath || 'base'),
    sourceId: baseClass + '/' + (classPath || 'base'), system: 'native',
    name: node.skill.name, baseClass, classPath, tier: node.tier, job: node.name,
    kind: 'attack', family, tags, targets: node.skill.targets,
    description: node.skill.mult + '×ATK；' + node.skill.targets + '目標；基礎耗魔 ' + node.skill.cost + '。原生技能視覺依路線保留名稱與專精。',
    mechanics: { ...node.skill },
    classPassives: { effects: { ...node.passive }, description: node.passiveText, baseTakenMultiplier: CLASSES[baseClass].taken },
    ...(node.specialization ? { specialization: node.specialization } : {}),
    source: { path: 'worker/src/game/stats.js', export: 'nodeFor', identity: { baseClass, classPath }, dependencies: ['constants.js', 'advanced-specializations.js', 'thief-data.js'] },
    implemented: true,
    implementationScope: 'current-local-source; visual catalog is not live deployment evidence',
  });
}));
const specials = SPECIAL_SKILLS.map(skill => {
  const m = MECHANICS[skill.id];
  assert.ok(m, 'Missing actual combat mechanics: ' + skill.id);
  assert.ok(specialFamily[skill.id], 'New special skill needs an explicit visual family: ' + skill.id);
  const baseClass = baseOf(skill);
  const coefficient = skillCoefficient(skill);
  const classPaths = paths.filter(class_path => eligible({ base_class: baseClass, class_path, level: MAX_LEVEL }, skill));
  const prefixes = classPaths.filter(path => !classPaths.some(parent => parent !== path && path.startsWith(parent)));
  const tags = [];
  if (coefficient > 0) tags.push('direct-damage');
  if (targetLimit(skill) > 1) tags.push('area');
  if (m.heal || m.healDamage || m.leech) tags.push('heal');
  if (m.shield) tags.push('shield');
  if (m.reflect || m.thiefCounter) tags.push('counter');
  if (m.interrupt || m.enemyNextReduce) tags.push('control');
  if (m.dot || m.thiefPoison) tags.push('dot');
  if (m.thiefPoison) tags.push('poison');
  if (m.execute) tags.push('execute');
  if (m.mark) tags.push('mark');
  if (m.revive) tags.push('revive');
  if (m.cleanse) tags.push('cleanse');
  if (m.all) tags.push('team');
  if (m.summon) tags.push('summon');
  if (m.accelerate) tags.push('cooldown-reduction');
  return decorated({
    id: 'special:' + skill.id, sourceId: skill.id, system: 'special',
    name: skill.name, baseClass,
    ...(prefixes.length === 1 ? { classPath: prefixes[0] } : {}),
    eligiblePaths: prefixes, tier: skill.advancementTier, level: skill.level, job: skill.eligibleJob,
    kind: specialKind(skill, m, coefficient), family: specialFamily[skill.id], tags,
    targets: targetLimit(skill), description: skill.damage + '；' + skill.effect,
    mechanics: { ...m, coefficient, mp: skill.mp, cooldownSeconds: skill.cooldownSeconds, damageText: skill.damage, effectText: skill.effect },
    catalogMetadata: { bookType: skill.bookType, rarity: skill.rarity, eligibleJob: skill.eligibleJob, advancementTier: skill.advancementTier, level: skill.level, ...(skill.eligiblePaths ? { eligiblePaths: skill.eligiblePaths } : {}) },
    source: { path: 'worker/src/game/special-data.js', export: 'SPECIAL_SKILLS', mechanicsPath: 'worker/src/game/special.js', mechanicsExport: 'MECHANICS', ...(baseClass === 'thief' ? { definitionPath: 'worker/src/game/thief-skills.js' } : {}) },
    implemented: true,
    implementationScope: 'current-local-source; visual catalog is not live deployment evidence',
  });
});
const atlas = ATLAS_BUILDS.map(build => {
  assert.ok(atlasFamily[build.id], 'New Atlas build needs a visual family: ' + build.id);
  const tags = [...build.tags];
  if (build.mechanic === 'frost') tags.push('shield', 'control');
  if (build.mechanic === 'counter') tags.push('counter', 'shield');
  return decorated({
    id: 'atlas:' + build.id, sourceId: build.id, system: 'atlas',
    name: build.mainSkill, buildName: build.name, baseClass: build.baseClass,
    kind: build.mechanic === 'beast' ? 'summon' : 'attack',
    family: atlasFamily[build.id], tags: [...new Set(tags)],
    targets: build.targets, description: build.description, mechanic: build.mechanic,
    mechanics: { ...build },
    source: { path: 'worker/src/game/atlas-catalog.js', export: 'ATLAS_BUILDS' },
    implemented: true, implementationScope: 'local-prototype-flag-gated', balanceStatus: 'prototype',
  });
});
const plannedRows = [
  ['sword','elite','戰神破勢','combo','破甲接連擊。'],
  ['sword','expert','壁壘回響','counter','防護接反擊。'],
  ['sword','nightmare','血誓狂潮','bleed','以資源代價換取持續壓力；提案尚未定數值。'],
  ['sword','hell','諸神斷罪','execute','蓄勢換取首領輸出。'],
  ['archer','elite','逐星連矢','volley','穿透清群。'],
  ['archer','expert','群靈共獵','beast','強化召喚協擊。'],
  ['archer','nightmare','月蝕獵印','curse','寵物、陷阱與本體共用目標。'],
  ['archer','hell','蒼穹裁決','rain','在範圍與單體之間選擇。'],
  ['mage','elite','星雷共鳴','lightning','連鎖與耗魔取捨。'],
  ['mage','expert','霜鏡回流','frost','以實際吸收傷害換取有限回魔。'],
  ['mage','nightmare','元素裂解','arcane','對元素抗性施壓。'],
  ['mage','hell','太初星爆','meteor','消耗法力或蓄能換取爆發。'],
  ['thief','elite','影襲連鎖','combo','形成多段節奏。'],
  ['thief','expert','淬毒散華','poison','擴散毒素。'],
  ['thief','nightmare','暗月處決','execute','利用低血量窗口。'],
  ['thief','hell','永夜分身','shadow','有限追擊並有續航代價。'],
];
const planned = plannedRows.map(([baseClass, mode, name, family, description]) => decorated({
  id: 'planned:' + baseClass + ':' + mode,
  sourceId: null, system: 'planned', name, baseClass, mode, family, description,
  idScope: 'visual-proposal-only; no implemented server skill ID exists',
  source: { path: plannedSourcePath, section: '六 第二輪起的技能路線提案' },
  implemented: false, status: 'planned-only', balanceStatus: 'not-defined',
}));
const talents = classes.map(baseClass => ({
  ...getAtlasTalentCatalog(baseClass),
  visualPolicy: 'passive-stat-modifiers-only; nodes do not independently cast attacks',
  source: { path: 'worker/src/game/atlas-talents.js', export: 'getAtlasTalentCatalog' },
}));
const supports = ATLAS_SUPPORTS.map(support => ({
  ...support, implemented: true, modifierOnly: true,
  visualPolicy: 'modify an actual skill event only; never create damage or targets without authoritative evidence',
  source: { path: 'worker/src/game/atlas-catalog.js', export: 'ATLAS_SUPPORTS' },
}));
const skills = [...atlas, ...specials, ...native];
const groupCount = (records, key) => Object.fromEntries([...new Set(records.map(record => record[key]))].sort().map(value => [value, records.filter(record => record[key] === value).length]));
const summary = {
  implementedSkillIdentities: skills.length,
  nativeRouteIdentities: native.length,
  nativeDistinctNames: new Set(native.map(skill => skill.name)).size,
  nativeDistinctBaseClassAndNames: new Set(native.map(skill => skill.baseClass + ':' + skill.name)).size,
  specialSkills: specials.length,
  legacySpecialSkills: LEGACY_SPECIAL_SKILLS.length,
  releasedThiefSpecialSkills: specials.filter(skill => skill.baseClass === 'thief').length,
  atlasMainSkills: atlas.length,
  supports: supports.length,
  talentNodesIncludingOrigins: talents.reduce((total, catalog) => total + catalog.nodes.length, 0),
  allocatableTalentNodes: talents.reduce((total, catalog) => total + catalog.nodes.filter(node => node.cost > 0).length, 0),
  keystones: talents.reduce((total, catalog) => total + catalog.nodes.filter(node => node.kind === 'keystone').length, 0),
  maxTalentPointsPerClass: Math.max(...talents.map(catalog => catalog.maxPoints)),
  plannedAwakeningSkills: planned.length,
  bySystem: groupCount(skills, 'system'),
  byClass: groupCount(skills, 'baseClass'),
  byKind: groupCount(skills, 'kind'),
  byVisualFamily: groupCount(skills, 'family'),
  note: 'Skill identities and distinct names are not counts of independently painted assets. Gender appearances share the same skill identity. Planned awakenings, passive nodes, and support modifiers are excluded from implemented skill count.',
};
assert.equal(new Set(skills.map(skill => skill.id)).size, skills.length, 'Duplicate skill identity');
assert.equal(new Set(planned.map(skill => skill.id)).size, planned.length, 'Duplicate planned identity');
assert.ok(skills.every(skill => skill.implemented === true));
assert.ok(planned.every(skill => skill.implemented === false));
assert.ok(skills.every(skill => skill.name && skill.source && skill.mechanics && families.has(skill.family)));
assert.equal(native.length, classes.length * paths.length);
assert.ok(specials.every(skill => skill.eligiblePaths.length > 0), 'Special skill has no eligible path');
assert.ok(ATLAS_BUILDS.every(build => build.recommendedSupports.every(id => ATLAS_SUPPORTS.some(support => support.id === id))));
if (THIEF_RELEASE_READY) assert.deepEqual(new Set(paths), new Set(THIEF_PATHS));
for (const tree of talents) {
  assert.equal(new Set(tree.nodes.map(node => node.id)).size, tree.nodes.length, 'Duplicate talent node');
  assert.equal(tree.nodes.filter(node => node.kind === 'origin').length, 1);
  assert.equal(tree.nodes.filter(node => node.kind === 'keystone').length, tree.branches.length);
}
const catalog = {
  schemaVersion: 1, generatedAt, sourceCommit, sourceRevision: sourceCommit,
  rulesets: { atlas: ATLAS_RULESET_VERSION, talents: ATLAS_TALENT_VERSION, maxLevel: MAX_LEVEL, maxClassTier: MAX_OPEN_CLASS_TIER },
  summary,
  policies: {
    scope: 'local-skill-vfx-catalog',
    nativeIdentity: 'baseClass+classPath; game has no standalone native skill ID',
    visualClassification: 'family and visualElement are art direction, not authoritative combat damage elements or additional hits',
    playback: 'visual-only; never calculate damage, trigger rewards, spend MP, or infer casts from stat snapshots',
    advancedPassives: 'retained as source metadata; not separate castable skills',
    planned: 'separate list; no fabricated MP, cooldown, coefficient, targets, or server skill ID',
  },
  skills, supports, talents, planned,
};
const audit = {
  schemaVersion: 1, generatedAt, sourceCommit, catalogPath: 'worker/public/skill-vfx-catalog.json',
  summary, sourceHashes,
  plannedSource: {
    path: plannedSourcePath,
    availableLocally: existsSync(plannedSourceLocal),
    ...(existsSync(plannedSourceLocal) ? { sha256: sha256(readFileSync(plannedSourceLocal)) } : {}),
    capturedSection: '六 第二輪起的技能路線提案',
    runtimeImplemented: false,
  },
  checks: {
    authoritativeImports: 'passed',
    uniqueGlobalIds: 'passed',
    allNativeClassPaths: 'passed',
    releasedSpecialMechanicsPresent: 'passed',
    specialEligiblePathsPresent: 'passed',
    atlasSupportReferences: 'passed',
    talentRootsAndKeystones: 'passed',
    plannedExcludedFromImplemented: 'passed',
  },
  nativeByClass: Object.fromEntries(classes.map(baseClass => {
    const entries = native.filter(skill => skill.baseClass === baseClass);
    return [baseClass, { routes: entries.length, distinctNames: new Set(entries.map(skill => skill.name)).size }];
  })),
  classificationNote: 'Visual family is manually curated from names and source effects. Numeric mechanics are copied from live exports. This audit does not approve animation artwork or claim battle-event integration.',
};
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.tmp-' + process.pid;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(temp, path);
}
function stable(value) {
  // A later commit of VFX code does not alter the source data being audited.
  const { generatedAt: _, sourceCommit: __, sourceRevision: ___, ...rest } = value;
  return rest;
}
if (process.argv.includes('--check')) {
  assert.deepEqual(stable(JSON.parse(readFileSync(catalogPath, 'utf8'))), stable(catalog), 'Catalog differs from current source; rebuild it');
  assert.deepEqual(stable(JSON.parse(readFileSync(auditPath, 'utf8'))), stable(audit), 'Audit differs from current source; rebuild it');
  console.log(JSON.stringify({ status: 'passed', mode: 'check', sourceCommit, summary }));
} else {
  writeJson(catalogPath, catalog);
  writeJson(auditPath, audit);
  console.log(JSON.stringify({ status: 'written', sourceCommit, summary, paths: ['worker/public/skill-vfx-catalog.json','worker/art-production/skill-vfx-20261104/catalog-audit.json'] }));
}
