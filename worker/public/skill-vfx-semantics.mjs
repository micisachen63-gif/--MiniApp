/**
 * Explicit art direction for every implemented StarJournal skill identity.
 * These profiles only select visible materials, shapes and movement. They do
 * not create casts, damage, targets, companions, buffs, or combat elements.
 * multiplicity is ornamental repetition inside ONE authoritative effect.
 * A branch ward is a visual frame, never evidence of an actual shield grant.
 */
export const SEMANTIC_SCHEMA_VERSION = 1;
export const SEMANTIC_ENUMS = Object.freeze({
  element: Object.freeze(['steel','blood','holy','nature','wind','lunar','star','fire','ice','lightning','arcane','time','void','poison','shadow','water']),
  motif: Object.freeze(['blade','shield','crown','wing','leaf','thorn','star','sun','snowflake','clock','rift','mirror','moon','serpent','seal','banner','beast','soul','flame','rune','eye','crack','drop','web']),
  style: Object.freeze(['inherit','orbit','blade-rain','double-shot','pack','summon','void','clock','banner','smoke','mirror','tree','serpent','fountain','groundwave','aurora','starfall','cage','sunburst','storm','crosscut','comet']),
  accent: Object.freeze(['rays','orbit','halo','shards','ripple','glyph','echo','trail']),
  routeAccent: Object.freeze(['base','assault','ward']),
});

// Tuple: id, canonical label, visual element, motif, motion, ornament, visual
// count, route accent, optional subject asset, optional semantic-atlas cell.
// Every row is authored by identity: names are not guessed with a regex and
// hashes are not used as a substitute for a meaningful visual distinction.
const rows = [
  // Atlas builds retain their original event types and recipients.
  ['atlas:sword_whirlwind','旋風斬','steel','blade','storm','rays',3,'base',null,null],
  ['atlas:sword_bleed','裂傷斬','blood','blade','inherit','trail',3,'base',null,null],
  ['atlas:sword_counter','盾鋒','steel','shield','inherit','halo',1,'base',null,null],
  ['atlas:archer_pierce','貫穿箭','wind','wing','inherit','trail',1,'base',null,null],
  ['atlas:archer_beast','召喚獵鷹','nature','beast','summon','orbit',1,'base','hawk',null],
  ['atlas:archer_trap','棘網陷阱','nature','web','cage','glyph',6,'base',null,null],
  ['atlas:mage_chain','連鎖閃電','lightning','rune','inherit','rays',3,'base',null,null],
  ['atlas:mage_frost','霜壁脈衝','ice','snowflake','cage','halo',6,'base',null,null],
  ['atlas:mage_arcane','秘法聚束','arcane','rune','inherit','glyph',3,'base',null,null],
  ['atlas:thief_poison','淬毒刃','poison','blade','inherit','trail',3,'base',null,null],
  ['atlas:thief_execute','終結刃','shadow','blade','crosscut','rays',2,'base',null,null],
  ['atlas:thief_combo','鏡刃','shadow','mirror','mirror','echo',3,'base',null,null],

  // Learned special skills, including non-damaging support effects.
  ['special:skill_01_1','裂甲重斬','steel','blade','inherit','shards',1,'base',null,null],
  ['special:skill_01_2','血性戰吼','blood','crown','groundwave','ripple',3,'base',null,null],
  ['special:skill_01_3','斬殺追擊','blood','blade','crosscut','trail',2,'base',null,null],
  ['special:skill_02_1','破勢盾擊','steel','shield','groundwave','rays',1,'base',null,null],
  ['special:skill_02_2','守護誓約','holy','seal','inherit','halo',1,'base',null,null],
  ['special:skill_02_3','聖盾反震','holy','shield','mirror','rays',3,'base',null,null],
  ['special:skill_03_1','穿風箭','wind','wing','comet','trail',1,'base',null,null],
  ['special:skill_03_2','風縛箭陣','wind','web','cage','orbit',5,'base',null,null],
  ['special:skill_03_3','疾風祝福','wind','wing','inherit','ripple',3,'base',null,null],
  ['special:skill_04_1','獵鷹標記','nature','eye','inherit','glyph',1,'base','hawk',null],
  ['special:skill_04_2','生命之泉','water','drop','fountain','ripple',3,'base',null,null],
  ['special:skill_04_3','靈獸撲擊','nature','beast','pack','trail',2,'base','semantic',5],
  ['special:skill_05_1','灼炎爆破','fire','sun','sunburst','shards',3,'base',null,null],
  ['special:skill_05_2','寒冰封鎖','ice','snowflake','cage','glyph',4,'base',null,null],
  ['special:skill_05_3','雷霆穿刺','lightning','blade','comet','rays',1,'base',null,null],
  ['special:skill_06_1','奧術脈衝','arcane','rune','groundwave','ripple',3,'base',null,null],
  ['special:skill_06_2','法力護幕','arcane','shield','inherit','glyph',3,'base',null,null],
  ['special:skill_06_3','時序回響','time','clock','clock','echo',3,'base',null,null],
  ['special:skill_07_1','血刃風暴','blood','blade','storm','trail',5,'base',null,null],
  ['special:skill_07_2','不屈血誓','blood','seal','inherit','halo',2,'base',null,null],
  ['special:skill_08_1','瞬影三連','steel','blade','crosscut','echo',3,'base',null,null],
  ['special:skill_08_2','劍心破界','steel','sun','inherit','rays',2,'base',null,null],
  ['special:skill_09_1','聖光裁決','holy','blade','starfall','rays',1,'base',null,null],
  ['special:skill_09_2','庇護之環','holy','shield','inherit','halo',3,'base',null,null],
  ['special:skill_10_1','堡壘援護','steel','shield','cage','glyph',4,'base',null,null],
  ['special:skill_10_2','震地破陣','steel','crack','groundwave','shards',5,'base',null,null],
  ['special:skill_11_1','貫星狙擊','star','eye','comet','trail',1,'base',null,null],
  ['special:skill_11_2','鷹眼獵殺','wind','eye','inherit','glyph',2,'base',null,null],
  ['special:skill_12_1','風舞連射','wind','wing','storm','trail',3,'base',null,null],
  ['special:skill_12_2','風之壁障','wind','shield','storm','halo',4,'base',null,null],
  ['special:skill_13_1','群狼突襲','nature','beast','pack','trail',3,'base','semantic',0],
  ['special:skill_13_2','森靈回春','nature','leaf','tree','ripple',3,'base','semantic',3],
  ['special:skill_14_1','月影爆雷','lunar','moon','sunburst','shards',3,'base',null,null],
  ['special:skill_14_2','封魔陷阱','arcane','web','cage','glyph',6,'base',null,null],
  ['special:skill_15_1','天火流星','fire','flame','starfall','trail',3,'base',null,null],
  ['special:skill_15_2','元素崩解','arcane','rune','sunburst','shards',4,'base',null,null],
  ['special:skill_16_1','冰晶風暴','ice','snowflake','storm','shards',6,'base',null,null],
  ['special:skill_16_2','極寒護甲','ice','shield','cage','halo',6,'base',null,null],
  ['special:skill_17_1','時裂衝擊','time','crack','clock','glyph',2,'base',null,null],
  ['special:skill_17_2','時間加速','time','clock','clock','trail',3,'base',null,null],
  ['special:skill_18_1','火靈契約','fire','flame','summon','glyph',1,'base','fire-spirit',null],
  ['special:skill_18_2','使魔替身','shadow','soul','smoke','echo',1,'base','semantic',8],
  ['special:skill_19_1','泰坦破軍','steel','crown','groundwave','shards',3,'base',null,null],
  ['special:skill_19_2','英雄戰旗','steel','banner','banner','halo',1,'base','semantic',4],
  ['special:skill_20_1','世界樹審判','nature','thorn','tree','rays',5,'base','semantic',3],
  ['special:skill_20_2','森羅復甦','nature','leaf','tree','ripple',5,'base','semantic',3],
  ['special:skill_21_1','星界崩裂','star','star','sunburst','shards',5,'base',null,null],
  ['special:skill_21_2','時空庇護','time','clock','clock','halo',4,'base',null,null],
  ['special:skill_22_1','神域斬決','holy','blade','crosscut','rays',4,'base',null,null],
  ['special:skill_22_2','不滅軍勢','steel','shield','cage','halo',6,'base',null,null],
  ['special:skill_23_1','星穹獵殺','star','wing','comet','trail',5,'base',null,null],
  ['special:skill_23_2','世界樹恩典','holy','leaf','tree','halo',7,'base','semantic',3],
  ['special:skill_24_1','諸神隕滅','holy','sun','starfall','rays',4,'base',null,null],
  ['special:skill_24_2','命運逆轉','time','soul','clock','ripple',3,'base',null,null],
  ['special:skill_thief_01','破綻標記','shadow','eye','inherit','glyph',1,'base',null,null],
  ['special:skill_thief_02','煙幕幻步','shadow','soul','smoke','trail',2,'base','semantic',8],
  ['special:skill_thief_03','無聲處刑','shadow','blade','crosscut','shards',1,'base',null,null],
  ['special:skill_thief_04','淬毒祕術','poison','serpent','serpent','glyph',3,'base',null,null],
  ['special:skill_thief_05','穿心飛刃','steel','blade','comet','trail',2,'base',null,null],
  ['special:skill_thief_06','鏡影反制','shadow','mirror','mirror','halo',3,'base',null,null],

  // Sword: blood pacts, sword intent, holy recovery, and ramparts each keep
  // their own theme. Assault/ward frames distinguish fourth-tier branches.
  ['native:sword:base','強力斬','steel','blade','inherit','trail',1,'base',null,null],
  ['native:sword:A','旋風斬','steel','blade','storm','orbit',3,'base',null,null],
  ['native:sword:B','盾擊','steel','shield','inherit','shards',1,'base',null,null],
  ['native:sword:A1','血之狂怒','blood','blade','storm','rays',3,'base',null,null],
  ['native:sword:A2','一閃','steel','blade','comet','echo',1,'base',null,null],
  ['native:sword:B1','神聖制裁','holy','blade','starfall','glyph',1,'base',null,null],
  ['native:sword:B2','不動如山','steel','crown','cage','halo',4,'base',null,null],
  ['native:sword:A11','血之狂怒 · 血契','blood','seal','storm','glyph',3,'base',null,null],
  ['native:sword:A12','血之狂怒 · 怒潮','blood','drop','storm','ripple',5,'base',null,null],
  ['native:sword:A21','一閃 · 劍意','steel','soul','comet','glyph',2,'base',null,null],
  ['native:sword:A22','一閃 · 裂空','void','rift','comet','shards',2,'base',null,null],
  ['native:sword:B11','神聖制裁 · 聖療','holy','drop','fountain','ripple',3,'base',null,null],
  ['native:sword:B12','神聖制裁 · 庇護','holy','shield','inherit','rays',3,'base',null,null],
  ['native:sword:B21','不動如山 · 壁壘','steel','shield','cage','glyph',6,'base',null,null],
  ['native:sword:B22','不動如山 · 反攻','steel','blade','groundwave','echo',3,'base',null,null],
  ['native:sword:A111','血之狂怒 · 血契 · 精進','blood','seal','storm','rays',5,'assault',null,null],
  ['native:sword:A112','血之狂怒 · 血契 · 守望','blood','seal','storm','halo',4,'ward',null,null],
  ['native:sword:A121','血之狂怒 · 怒潮 · 精進','blood','drop','storm','trail',7,'assault',null,null],
  ['native:sword:A122','血之狂怒 · 怒潮 · 守望','blood','drop','storm','halo',6,'ward',null,null],
  ['native:sword:A211','一閃 · 劍意 · 精進','steel','blade','comet','rays',3,'assault',null,null],
  ['native:sword:A212','一閃 · 劍意 · 守望','steel','soul','comet','halo',3,'ward',null,null],
  ['native:sword:A221','一閃 · 裂空 · 精進','void','rift','comet','shards',5,'assault',null,null],
  ['native:sword:A222','一閃 · 裂空 · 守望','void','rift','comet','halo',4,'ward',null,null],
  ['native:sword:B111','神聖制裁 · 聖療 · 精進','holy','drop','fountain','rays',4,'assault',null,null],
  ['native:sword:B112','神聖制裁 · 聖療 · 守望','holy','drop','fountain','halo',5,'ward',null,null],
  ['native:sword:B121','神聖制裁 · 庇護 · 精進','holy','shield','starfall','rays',4,'assault',null,null],
  ['native:sword:B122','神聖制裁 · 庇護 · 守望','holy','shield','starfall','halo',6,'ward',null,null],
  ['native:sword:B211','不動如山 · 壁壘 · 精進','steel','crown','cage','shards',7,'assault',null,null],
  ['native:sword:B212','不動如山 · 壁壘 · 守望','steel','crown','cage','halo',8,'ward',null,null],
  ['native:sword:B221','不動如山 · 反攻 · 精進','steel','blade','groundwave','rays',5,'assault',null,null],
  ['native:sword:B222','不動如山 · 反攻 · 守望','steel','shield','groundwave','halo',6,'ward',null,null],

  // Archer: a pack is not a hawk, forest ancestors are not fire spirits, and
  // repeated arrows stay on the actual recipient instead of inventing foes.
  ['native:archer:base','二連射','wind','wing','double-shot','trail',2,'base',null,null],
  ['native:archer:A','箭雨','wind','wing','starfall','rays',7,'base',null,null],
  ['native:archer:B','獵鷹助攻','nature','wing','pack','echo',1,'base','hawk',null],
  ['native:archer:A1','穿透狙擊','star','blade','comet','glyph',1,'base',null,null],
  ['native:archer:A2','疾風連射','wind','wing','storm','echo',4,'base',null,null],
  ['native:archer:B1','野獸之王','nature','crown','pack','rays',3,'base','semantic',0],
  ['native:archer:B2','爆裂陷阱','fire','web','sunburst','shards',4,'base',null,null],
  ['native:archer:A11','星風聖射・秘技','wind','star','comet','rays',3,'base',null,null],
  ['native:archer:A12','蒼穹裁決者・秘技','holy','wing','starfall','glyph',2,'base',null,null],
  ['native:archer:A21','暴風先知・秘技','wind','crown','storm','rays',4,'base',null,null],
  ['native:archer:A22','天羽御風者・秘技','wind','wing','storm','echo',5,'base',null,null],
  ['native:archer:B11','萬獸祭司・秘技','nature','beast','pack','glyph',4,'base','semantic',5],
  ['native:archer:B12','古森召靈師・秘技','nature','leaf','summon','halo',3,'base','semantic',5],
  ['native:archer:B21','皎月巡狩・秘技','lunar','moon','cage','glyph',3,'base',null,null],
  ['native:archer:B22','荊棘影衛・秘技','nature','thorn','cage','halo',6,'base',null,null],
  ['native:archer:A111','永恆風冠・終章','wind','crown','comet','rays',5,'assault',null,null],
  ['native:archer:A112','群星神弓・終章','star','star','comet','halo',5,'ward',null,null],
  ['native:archer:A121','蒼穹神判・終章','holy','wing','starfall','rays',5,'assault',null,null],
  ['native:archer:A122','聖光獵星・終章','holy','star','comet','halo',4,'ward',null,null],
  ['native:archer:A211','太初風皇・終章','wind','crown','storm','rays',7,'assault',null,null],
  ['native:archer:A212','九霄御風・終章','wind','wing','storm','halo',9,'ward',null,null],
  ['native:archer:A221','天羽聖主・終章','holy','wing','storm','rays',6,'assault',null,null],
  ['native:archer:A222','嵐靈神使・終章','wind','soul','storm','halo',7,'ward',null,null],
  ['native:archer:B111','太古森皇・終章','nature','crown','tree','glyph',6,'assault','semantic',3],
  ['native:archer:B112','萬獸神尊・終章','nature','beast','pack','halo',5,'ward','semantic',0],
  ['native:archer:B121','世界樹祭主・終章','nature','leaf','tree','rays',7,'assault','semantic',3],
  ['native:archer:B122','精靈祖靈・終章','holy','soul','summon','halo',4,'ward','semantic',5],
  ['native:archer:B211','永夜月神・終章','lunar','moon','cage','echo',7,'assault',null,null],
  ['native:archer:B212','銀月聖獵・終章','lunar','eye','cage','halo',4,'ward',null,null],
  ['native:archer:B221','荊棘聖王・終章','nature','thorn','cage','rays',8,'assault',null,null],
  ['native:archer:B222','幽林守護・終章','nature','shield','tree','halo',6,'ward','semantic',3],

  // Mage: clock, void, astral summons and abyssal gates are separate visual
  // subjects even when the underlying combat route inherits its coefficient.
  ['native:mage:base','火球術','fire','flame','inherit','trail',1,'base',null,null],
  ['native:mage:A','連鎖閃電','lightning','rune','inherit','echo',3,'base',null,null],
  ['native:mage:B','奧術飛彈','arcane','star','comet','echo',3,'base',null,null],
  ['native:mage:A1','隕石術','fire','star','starfall','rays',1,'base',null,null],
  ['native:mage:A2','暴風雪','ice','snowflake','storm','ripple',7,'base',null,null],
  ['native:mage:B1','時間扭曲','time','clock','clock','orbit',3,'base',null,null],
  ['native:mage:B2','召喚火精靈','fire','flame','summon','echo',1,'base','fire-spirit',null],
  ['native:mage:A11','星炎大賢者・奧義','fire','star','sunburst','rays',3,'base',null,null],
  ['native:mage:A12','天隕魔導師・奧義','fire','crown','starfall','shards',3,'base',null,null],
  ['native:mage:A21','永霜詠唱者・奧義','ice','snowflake','cage','glyph',7,'base',null,null],
  ['native:mage:A22','極光冰術師・奧義','ice','star','aurora','trail',4,'base',null,null],
  ['native:mage:B11','時序預言者・奧義','time','eye','clock','glyph',3,'base',null,null],
  ['native:mage:B12','虛空旅法師・奧義','void','rift','void','orbit',3,'base',null,null],
  ['native:mage:B21','星靈召喚師・奧義','star','soul','summon','rays',3,'base','semantic',1],
  ['native:mage:B22','深淵契約者・奧義','void','seal','summon','glyph',2,'base','semantic',2],
  ['native:mage:A111','日冕焚界','fire','sun','sunburst','rays',7,'assault',null,null],
  ['native:mage:A112','熾天裁決','fire','wing','starfall','halo',5,'ward',null,null],
  ['native:mage:A121','星核崩滅','star','star','sunburst','shards',7,'assault',null,null],
  ['native:mage:A122','隕日終審','fire','sun','starfall','halo',6,'ward',null,null],
  ['native:mage:A211','永霜王域','ice','snowflake','cage','rays',8,'assault',null,null],
  ['native:mage:A212','零界封絕','ice','shield','cage','halo',6,'ward',null,null],
  ['native:mage:A221','極光聖降','ice','star','aurora','rays',5,'assault',null,null],
  ['native:mage:A222','蒼穹冰葬','ice','soul','starfall','shards',8,'ward',null,null],
  ['native:mage:B111','時序崩解','time','clock','clock','shards',7,'assault',null,null],
  ['native:mage:B112','命運斷章','time','seal','clock','halo',4,'ward',null,null],
  ['native:mage:B121','虛空湮滅','void','rift','void','rays',7,'assault',null,null],
  ['native:mage:B122','次元裂隙','void','rift','void','halo',4,'ward',null,null],
  ['native:mage:B211','萬靈降臨','star','soul','summon','rays',7,'assault','semantic',1],
  ['native:mage:B212','星界御令','star','crown','summon','halo',4,'ward','semantic',1],
  ['native:mage:B221','深淵魔召','void','beast','summon','shards',4,'assault','semantic',2],
  ['native:mage:B222','冥界開門','void','rift','void','halo',6,'ward','semantic',6],

  // Thief: curved blades, raining blades, serpents, mirrors and moon cuts.
  ['native:thief:base','迅刃突刺','steel','blade','comet','trail',1,'base',null,null],
  ['native:thief:A','交錯刃擊','shadow','blade','crosscut','trail',2,'base',null,null],
  ['native:thief:B','迴旋飛刃','shadow','blade','orbit','echo',2,'base',null,null],
  ['native:thief:A1','斷影背刺','shadow','blade','comet','glyph',1,'base',null,null],
  ['native:thief:A2','蝕骨毒刃','poison','blade','serpent','trail',3,'base',null,null],
  ['native:thief:B1','千刃迴旋','steel','blade','orbit','rays',5,'base',null,null],
  ['native:thief:B2','鏡影連襲','shadow','mirror','mirror','echo',2,'base',null,null],
  ['native:thief:A11','夜幕斷罪','shadow','seal','crosscut','rays',3,'base',null,null],
  ['native:thief:A12','幽影獵襲','shadow','soul','comet','trail',3,'base',null,null],
  ['native:thief:A21','蝕毒連刃','poison','blade','serpent','echo',5,'base',null,null],
  ['native:thief:A22','血棘穿刺','blood','thorn','comet','rays',3,'base',null,null],
  ['native:thief:B11','疾風刃旋','wind','blade','orbit','trail',5,'base',null,null],
  ['native:thief:B12','星芒追刃','star','blade','comet','echo',4,'base',null,null],
  ['native:thief:B21','鏡影刃舞','shadow','mirror','mirror','trail',4,'base',null,null],
  ['native:thief:B22','暮光幻襲','lunar','wing','smoke','halo',3,'base','semantic',8],
  ['native:thief:A111','冥夜裁決','void','seal','crosscut','rays',4,'assault',null,null],
  ['native:thief:A112','終焉斷影','shadow','blade','crosscut','halo',5,'ward',null,null],
  ['native:thief:A121','虛影穿襲','void','rift','comet','trail',4,'assault',null,null],
  ['native:thief:A122','無聲獵魂','shadow','soul','comet','halo',4,'ward',null,null],
  ['native:thief:A211','九首蝕毒','poison','serpent','serpent','rays',9,'assault','semantic',7],
  ['native:thief:A212','冥蛇噬影','shadow','serpent','serpent','halo',3,'ward',null,null],
  ['native:thief:A221','血棘王刃','blood','thorn','orbit','shards',7,'assault',null,null],
  ['native:thief:A222','蝕魂收割','void','soul','crosscut','halo',6,'ward',null,null],
  ['native:thief:B111','風暴千刃','wind','blade','orbit','rays',9,'assault',null,null],
  ['native:thief:B112','疾影穿梭','shadow','blade','orbit','trail',6,'ward',null,null],
  ['native:thief:B121','星隕刃雨','star','blade','blade-rain','rays',7,'assault',null,null],
  ['native:thief:B122','星軌追獵','star','star','comet','halo',4,'ward',null,null],
  ['native:thief:B211','千面鏡殺','shadow','mirror','mirror','rays',8,'assault',null,null],
  ['native:thief:B212','鏡界穿行','void','mirror','mirror','halo',5,'ward',null,null],
  ['native:thief:B221','暮光織刃','lunar','blade','orbit','echo',7,'assault',null,null],
  ['native:thief:B222','黑月幻刃','lunar','moon','crosscut','halo',4,'ward',null,null],
];

const byId = new Map();
const signatures = new Map();
for (const row of rows) {
  const [id,label,element,motif,style,accent,multiplicity,routeAccent,asset,cell] = row;
  const values = {element,motif,style,accent,routeAccent};
  for (const [key,value] of Object.entries(values)) {
    if (!SEMANTIC_ENUMS[key].includes(value)) throw new TypeError('Invalid semantic '+key+': '+id);
  }
  if (!id || !label || byId.has(id)) throw new TypeError('Duplicate or invalid semantic identity: '+id);
  if (!Number.isInteger(multiplicity) || multiplicity < 1 || multiplicity > 9) throw new RangeError('Invalid visual multiplicity: '+id);
  if (![null,'semantic','hawk','fire-spirit'].includes(asset)) throw new TypeError('Invalid semantic asset: '+id);
  if (asset === 'semantic' ? !Number.isInteger(cell) || cell < 0 || cell > 8 : cell !== null) throw new RangeError('Invalid semantic cell: '+id);
  const signatureKey = [element,motif,style,accent,multiplicity,routeAccent,asset || 'geometry',cell ?? '-'].join('/');
  if (signatures.has(signatureKey)) throw new TypeError('Indistinguishable authored semantic profile: '+id+' and '+signatures.get(signatureKey));
  signatures.set(signatureKey,id);
  byId.set(id,Object.freeze({id,label,element,motif,style,accent,multiplicity,routeAccent,signatureKey,asset,cell}));
}

export const SEMANTIC_PROFILES = Object.freeze([...byId.values()]);

/** Resolve an implemented identity only; no name guessing or silent fallback. */
export function semanticFor(skill) {
  const id = typeof skill === 'string' ? skill : skill?.id;
  const profile = byId.get(id);
  if (!profile) throw new RangeError('Missing authored skill VFX semantics: '+String(id));
  return profile;
}
