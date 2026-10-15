import test from 'node:test';
import assert from 'node:assert/strict';
import { gearOffers, findOffer, makeGear, canEquip, convertWeapon } from '../src/game/gear.js';
import { itemOffers, checkItemPurchase, wardPrice } from '../src/game/shop.js';
import { advance, reselect, GameError } from '../src/game/classes.js';
import { dailyGoldFor } from '../src/game/daily.js';
import { computeStats } from '../src/game/stats.js';
import { mulberry32 } from '../src/game/rng.js';
import { mkChar, T0 } from './helpers.js';

const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof GameError, e.message); return e.code; } return null; };

test('shop gear is class- and branch-specific', () => {
  const sw = gearOffers(mkChar({ base_class: 'sword', level: 10 }));
  assert.ok(sw.every((o) => o.tier === 1));
  assert.ok(sw.some((o) => o.code === 'w.sword.1') && !sw.some((o) => o.code.startsWith('w.staff')));
  const knight = gearOffers(mkChar({ base_class: 'sword', level: 35, class_path: 'B' }));
  assert.ok(knight.some((o) => o.code === 'w.sword_shield.2')); assert.ok(!knight.some((o) => o.code === 'w.greatsword.2'));
  const mage = gearOffers(mkChar({ base_class: 'mage', level: 15, class_path: 'A' }));
  assert.ok(mage.some((o) => o.code === 'w.elem_staff.2') && !mage.some((o) => o.kind === 'wand'));
  assert.ok(mage.filter((o) => ['helmet', 'armor', 'gloves', 'boots'].includes(o.slot)).every((o) => o.type.startsWith('布')));
  assert.ok(mage.filter((o) => ['belt', 'undershirt', 'earring', 'ring'].includes(o.slot)).length === 8, 'shared slots × 2 tiers');
  assert.equal(findOffer(mkChar({ level: 10 }), 'w.sword.2'), null, 'tier 2 locked before Lv11');
});

test('equip rules: class, branch, level; branch weapon converts once', () => {
  const rng = mulberry32(1); const c = mkChar({ base_class: 'archer', level: 40, class_path: 'A' });
  const bow = makeGear({ id: 'x', tgId: c.tg_id, cls: 'archer', slot: 'weapon', kind: 'compound_bow', tier: 4, rng, now: T0 });
  assert.equal(canEquip(c, bow), null);
  assert.match(canEquip({ ...c, class_path: 'B' }, bow), /路線/);
  assert.match(canEquip({ ...c, base_class: 'mage' }, bow), /職業/);
  assert.match(canEquip({ ...c, level: 20 }, bow), /Lv31/);
  const conv = convertWeapon(bow); assert.equal(conv.kind, 'crossbow'); assert.equal(conv.branch_req, 'B'); assert.equal(conv.convert_token, 0);
  assert.equal(conv.base_stat, bow.base_stat); assert.equal(convertWeapon(conv), null);
});

test('守護符: 400 × map tier, hold ≤5, ≤3 per day; potions by tier; 命運轉職書 only after advancing', () => {
  assert.equal(wardPrice(10), 400); assert.equal(wardPrice(45), 800);
  const c = mkChar({ level: 20, gold: 100000 });
  assert.deepEqual(checkItemPurchase(c, {}, 'ward', 3, 0), { price: 400, total: 1200 });
  assert.equal(code(() => checkItemPurchase(c, {}, 'ward', 1, 3)), 'daily_limit');
  assert.equal(code(() => checkItemPurchase(c, { ward: 5 }, 'ward', 1, 0)), 'max_hold');
  assert.equal(code(() => checkItemPurchase({ ...c, gold: 10 }, {}, 'ward', 1, 0)), 'gold');
  assert.equal(code(() => checkItemPurchase(c, {}, 'red_2', 1, 0)), 'not_sold');
  assert.equal(code(() => checkItemPurchase(c, {}, 'reselect_1', 1, 0)), 'not_sold');
  assert.ok(itemOffers({ ...c, level: 31, class_path: 'A' }).some((o) => o.item === 'reselect_1' && o.price === 6000));
  assert.ok(!itemOffers({...c,level:14}).some(o=>o.item==='guardian_summon_stone'));
  const stone=itemOffers({...c,level:15}).find(o=>o.item==='guardian_summon_stone');
  assert.ok(stone && stone.price>0);
  assert.deepEqual(checkItemPurchase(c,{},stone.item,2),{price:stone.price,total:stone.price*2});
});

test('first advancement needs Lv30 + boss material; re-select book swaps branch with 30-min cooldown', () => {
  const c = mkChar({ base_class: 'mage', level: 30 }); const inv = {};
  assert.equal(code(() => advance(c, inv, 'A')), 'material');
  assert.equal(code(() => advance({ ...c, level: 29 }, { mat_1: 1 }, 'A')), 'level');
  inv.mat_1 = 1; const r = advance(c, inv, 'A'); assert.equal(c.class_path, 'A'); assert.equal(inv.mat_1, 0); assert.equal(r.node.name, '元素術士');
  assert.equal(code(() => advance(c, { mat_2: 1 }, '1')), 'level', 'second advancement waits for Lv60');
  const s1 = computeStats(c, []); assert.equal(s1.skill.name, '連鎖閃電');
  const staff = { id: 's', tg_id: c.tg_id, slot: 'weapon', kind: 'elem_staff', branch_req: 'A', is_equipped: 1 };
  assert.equal(code(() => reselect(c, {}, [staff], 1, 'B', T0)), 'no_book');
  const inv2 = { reselect_1: 1 }; const rr = reselect(c, inv2, [staff], 1, 'B', T0);
  assert.equal(c.class_path, 'B'); assert.deepEqual(rr.unequipped, ['s']); assert.equal(staff.is_equipped, 0); assert.equal(inv2.reselect_1, 0);
  assert.equal(computeStats(c, []).skill.name, '奧術飛彈');
  assert.equal(code(() => reselect(c, { reselect_1: 1 }, [], 1, 'A', T0 + 10 * 60_000)), 'cooldown');
  assert.doesNotThrow(() => reselect(c, { reselect_1: 1 }, [], 1, 'A', T0 + 30 * 60_000));
});

test('v0.5 二轉: Lv60 + 樹王之心 → node 1/2 (skill + stacked passive); book II swaps 1↔2; book I keeps the slot; third and fourth require trial certificates', () => {
  const c = mkChar({ base_class: 'sword', level: 60, class_path: 'A' }); const inv = { mat_2: 1 };
  assert.equal(code(() => advance(c, { mat_2: 1 }, 'A')), 'branch', 'tier 2 uses 1/2');
  assert.equal(code(() => advance(c, {}, '1')), 'material');
  const r = advance(c, inv, '1'); assert.equal(c.class_path, 'A1'); assert.equal(r.node.name, '血怒戰神'); assert.equal(inv.mat_2, 0);
  const s = computeStats(c, []); assert.equal(s.skill.name, '血之狂怒'); assert.equal(s.node.name, '血怒戰神');
  assert.equal(s.pct.lifestealPct, 0.08); assert.equal(s.pct.atkPct, 0.15, 'tier-1 狂暴 still applies');
  const veteran={...c,level:90}, trials={trial_3:1,trial_4:1};
  assert.equal(code(()=>advance(veteran,{mat_3:1},'1')),'material');
  assert.equal(advance(veteran,trials,'1').to,'A11'); assert.equal(trials.trial_3,0);
  assert.equal(code(()=>advance(veteran,trials,'1')),'level');
  veteran.level=120; assert.equal(advance(veteran,trials,'2').to,'A112'); assert.equal(trials.trial_4,0);
  assert.equal(code(()=>advance({...veteran,level:150},trials,'1')),'not_open');
  const rr = reselect(c, { reselect_2: 1 }, [], 2, '2', T0); assert.equal(c.class_path, 'A2'); assert.equal(rr.to, 'A2'); assert.equal(computeStats(c, []).skill.name, '一閃');
  const sw = { id: 'g', tg_id: c.tg_id, slot: 'weapon', kind: 'greatsword', branch_req: 'A', is_equipped: 1 };
  reselect(c, { reselect_1: 1 }, [sw], 1, 'B', T0 + 35 * 60_000); assert.equal(c.class_path, 'B2', 'deeper slot kept'); assert.equal(computeStats(c, []).node.name, '鐵壁守衛'); assert.equal(sw.is_equipped, 0);
  for (const cls of ['sword', 'archer', 'mage']) for (const p of ['A1', 'A2', 'B1', 'B2']) { const st = computeStats(mkChar({ base_class: cls, level: 60, class_path: p }), []); assert.ok(st.skill.mult > 1.9 && st.node.tier === 2, `${cls} ${p}`); }
});

test('daily gold: 600 + 70×Lv, +50% in the first week, once per Taipei day', () => {
  const c = mkChar({ level: 10, created_day: '2026-10-08' });
  assert.deepEqual(dailyGoldFor(c, T0), { day: '2026-10-08', base: 1300, bonus: 650, total: 1950, claimed: false, firstWeek: true });
  assert.equal(dailyGoldFor({ ...c, last_daily_gold_day: '2026-10-08' }, T0).claimed, true);
  assert.equal(dailyGoldFor(c, T0 + 8 * 86_400_000).bonus, 0);
});

import { enhance, reroll, enhanceOdds } from '../src/game/enhance.js';
test('enhance: safe zone 50/50, beyond safe 33/34/33 with break; costs T scrolls; weapon +8 / armor +6 announcements', () => {
  const w = { slot: 'weapon', tier: 2, enhance_level: 0 }; const a = { slot: 'armor', tier: 1, enhance_level: 4 };
  assert.deepEqual(enhanceOdds(w), { success: 0.5, nothing: 0.5, break: 0, safe: true });
  assert.equal(enhanceOdds(a).break, 0.33); assert.equal(enhanceOdds({ ...w, enhance_level: 6 }).break, 0.33);
  const inv = { scroll_w: 3 };
  assert.equal(enhance(w, inv, () => 0.1).result, 'success'); assert.equal(w.enhance_level, 1); assert.equal(inv.scroll_w, 1, 'tier 2 → 2 scrolls');
  assert.equal(code(() => enhance(w, inv, () => 0.1)), 'no_scroll');
  const x = { slot: 'weapon', tier: 1, enhance_level: 6 }; const i2 = { scroll_w: 5 };
  const s = enhance(x, i2, () => 0.2); assert.equal(s.result, 'success'); assert.equal(s.announce, false); assert.equal(x.enhance_level, 7);
  assert.equal(enhance(x, i2, () => 0.5).result, 'break'); assert.equal(enhance({ ...x }, i2, () => 0.9).result, 'nothing');
  assert.equal(enhance({ slot: 'weapon', tier: 1, enhance_level: 2 }, i2, () => 0.6).result, 'nothing', 'never breaks inside safe');
});
test('reroll: independent affixes and locks; item identity, element and rarity remain stable',()=>{
 const item=makeGear({id:'r',tgId:'1',cls:'mage',slot:'weapon',kind:'staff',tier:3,rng:mulberry32(5),now:T0,forceRarity:'epic'});
 item.enhance_level=3; const before={...item},inv={scroll_r:3};
 const r=reroll(item,inv,mulberry32(77)); assert.equal(inv.scroll_r,0);
 for(const key of Object.keys(before).filter(k=>k!=='affixes_json')) assert.deepEqual(item[key],before[key],key);
 assert.equal(r.after.lines.length,2);
 for(const line of r.after.lines){assert.ok(line.value>=line.range[0]&&line.value<=line.range[1]); assert.ok(line.score>=0&&line.score<=100);}
 assert.equal(code(()=>reroll(item,inv,mulberry32(1))),'no_scroll');
 const locked=JSON.parse(item.affixes_json)[0],lockInv={scroll_r:6};
 const lockedRoll=reroll(item,lockInv,mulberry32(9),[0]);
 assert.deepEqual(JSON.parse(item.affixes_json)[0],locked); assert.equal(lockInv.scroll_r,0); assert.deepEqual(lockedRoll.used,{scroll_r:6});
 assert.equal(item.element_tier,'epic');
});

test('shop sells the three scrolls at 75 / 50 / 60 (v0.5.1b)', () => {
  const o = itemOffers(mkChar({ level: 5 })); const p = Object.fromEntries(o.map((x) => [x.item, x.price]));
  assert.equal(p.scroll_w, 75); assert.equal(p.scroll_a, 50); assert.equal(p.scroll_r, 60);
});
