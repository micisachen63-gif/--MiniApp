import test from 'node:test';
import assert from 'node:assert/strict';
import pack, {COUNTRY_PACK_JP} from '../public/fate/country-packs-v9/jp.js';
import {TAIWAN_MEMORIES_V8 as tw1, TAIWAN_CAREER_CHAPTERS_V8 as twJobs, TAIWAN_TEACHER_CHAPTERS_V8 as twTeachers} from '../public/fate/taiwan-content-v8.js';
import {TAIWAN_EXTRA_MEMORIES_V8 as tw2} from '../public/fate/taiwan-days-extra-v8.js';
import {TAIWAN_RESERVE_MEMORIES_V8 as tw3} from '../public/fate/taiwan-days-reserve-v8.js';

test('Japan pack is frozen data scoped to Tokyo 23 wards, with fictional native starting budgets', () => {
  assert.equal(pack, COUNTRY_PACK_JP);
  assert.equal(pack.id, 'JP');
  assert.equal(pack.cityId, 'tokyo');
  assert.match(pack.scope, /23區/);
  assert.match(pack.scope, /不代表全日本/);
  assert.equal(pack.currency, 'JPY');
  assert.ok(Object.isFrozen(pack));
  assert.deepEqual(pack.families.map(item => item.id), ['tight', 'ordinary', 'small-business', 'comfortable']);
  for (const family of pack.families) {
    assert.ok(Number.isInteger(family.money) && family.money >= 0);
    assert.ok(family.text.length > 30);
    assert.doesNotMatch(family.text, /全球前|平均月薪|中位數|必然信仰|一定是/);
  }
});

test('Japan has 1500 authored daily scenes in the specified age-phase capacities', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(pack.daily).map(([phase, rows]) => [phase, rows.length])),
    {child: 120, youth: 100, adult: 720, late: 420, any: 140});
  const all = Object.values(pack.daily).flat();
  assert.equal(all.length, 1500);
  assert.equal(new Set(all).size, 1500);
  for (const rows of Object.values(pack.daily)) assert.ok(Object.isFrozen(rows));
  for (const text of all) {
    assert.ok(text.length >= 18);
    assert.doesNotMatch(text, /\{[^}]*\}|<[^>]+>|\$\{/);
  }
});

test('Japanese daily text is not reused verbatim from the frozen Taiwan catalog or job chapters', () => {
  const old = new Set([...tw1, ...tw2, ...tw3, ...Object.values(twJobs).flat(), ...twTeachers].map(row => row.text));
  for (const text of Object.values(pack.daily).flat()) assert.equal(old.has(text), false, text);
});

test('adult daily scenes do not award personal employment, partner, child, tenancy, medication or a diagnosis', () => {
  const unearned = /你(?:的)?(?:下班|上班|同事|薪資|房東|租約|伴侶|丈夫|妻子|兒子|女兒)|你和(?:室友|伴侶)|你的孩子|你領到薪水|你結婚了|你買下房子|你取得學位|你被診斷|你確診|停掉原來的藥/;
  for (const text of [...pack.daily.adult, ...pack.daily.late, ...pack.daily.any]) assert.doesNotMatch(text, unearned);
  for (const text of pack.daily.any) assert.doesNotMatch(text, /段考|入職|薪資|學測|駕照|高中畢業|上班/);
  for (const text of pack.daily.child) assert.doesNotMatch(text, /高中畢業|大學錄取|取得駕照|你領到薪水|你取得資格/);
});

test('four ordinal shelves have enough daily capacity for 240 nodes from death age 59 through 103', () => {
  const sizes = Object.fromEntries(Object.entries(pack.daily).map(([key, rows]) => [key, rows.length / 4]));
  for (let death = 59; death <= 103; death++) {
    const need = {infant: 0, child: 0, youth: 0, adult: 0, late: 0};
    for (let tick = 1; tick <= 240; tick++) {
      const age = Math.floor(tick / 240 * death);
      need[age < 3 ? 'infant' : age < 13 ? 'child' : age < 18 ? 'youth' : age < 60 ? 'adult' : 'late']++;
    }
    const preschool = Array.from({length: 240}, (_, i) => Math.floor((i + 1) / 240 * death)).filter(age => age >= 3 && age < 6).length;
    assert.ok(preschool <= sizes.any, `death ${death}: preschool`);
    assert.ok(need.child - preschool <= sizes.child, `death ${death}: child`);
    assert.ok(need.youth <= sizes.youth, `death ${death}: youth`);
    assert.ok(need.adult <= sizes.adult, `death ${death}: adult`);
    assert.ok(need.late <= sizes.late, `death ${death}: late`);
  }
});

test('12 Japanese careers each contain 10 ordered work chapters and 4 explicit two-option dilemmas', () => {
  assert.equal(pack.careers.length, 12);
  assert.equal(new Set(pack.careers.map(item => item.id)).size, 12);
  const questionIds = new Set();
  const texts = [];
  for (const career of pack.careers) {
    assert.match(career.id, /^[a-z][a-z-]{0,19}$/);
    assert.ok([18, 21].includes(career.minAge));
    assert.ok(career.practice.length >= 30 && career.entry.length >= 30);
    assert.equal(career.chapters.length, 10);
    assert.equal(career.dilemmas.length, 4);
    assert.ok(Object.isFrozen(career.chapters));
    texts.push(...career.chapters);
    for (const dilemma of career.dilemmas) {
      assert.match(dilemma.id, /^jp-[a-z-]+$/);
      assert.ok(dilemma.id.length <= 24);
      assert.equal(questionIds.has(dilemma.id), false);
      questionIds.add(dilemma.id);
      assert.ok([1, 2, 3].includes(dilemma.minStage));
      assert.equal(dilemma.choices.length, 2);
      assert.notEqual(dilemma.choices[0].outcome, dilemma.choices[1].outcome);
      for (const choice of dilemma.choices) {
        assert.equal(typeof choice.exit, 'boolean');
        assert.deepEqual(Object.keys(choice.delta).sort(), ['bonds', 'energy', 'money', 'reputation']);
        assert.ok(Object.values(choice.delta).every(Number.isInteger));
        assert.equal(choice.flags, undefined);
      }
    }
  }
  assert.equal(texts.length, 120);
  assert.equal(new Set(texts).size, 120);
  assert.equal(questionIds.size, 48);
  assert.match(pack.careers.find(row => row.id === 'household-care').entry, /未受雇/);
});

test('24 social chains provide six safe fictional-name chapters each and work-gate colleague roles', () => {
  assert.equal(pack.social.length, 24);
  assert.equal(new Set(pack.social.map(item => item.id)).size, 24);
  const all = [];
  for (const row of pack.social) {
    assert.match(row.id, /^[a-z-]{1,16}$/);
    assert.ok(['friend', 'neighbor', 'colleague'].includes(row.role));
    assert.equal(typeof row.requiresCareer, 'boolean');
    if (row.role === 'colleague') assert.equal(row.requiresCareer, true);
    assert.equal(row.chapters.length, 6);
    all.push(...row.chapters);
    for (const text of row.chapters) {
      assert.ok(text.includes('{name}'), row.id);
      assert.doesNotMatch(text.replaceAll('{name}', ''), /\{[^}]*\}/);
      assert.doesNotMatch(text, /欠你|騙你|偷竊|犯罪|出軌|逼迫|愛上你|替你還債/);
    }
  }
  assert.equal(all.length, 144);
  assert.equal(new Set(all).size, 144);
});

test('six Japanese shared choices have reciprocal placeholders and distinct safe outcomes', () => {
  assert.deepEqual(pack.shared.map(row => row.id), ['moving', 'parcel', 'repair', 'market', 'umbrella', 'bookstore']);
  for (const row of pack.shared) {
    assert.ok(row.text.includes('{owner}') && row.text.includes('{guest}'));
    assert.equal(row.choices.length, 2);
    assert.notEqual(row.choices[0].outcome, row.choices[1].outcome);
    for (const choice of row.choices) {
      assert.ok(choice.outcome.includes('{owner}') && choice.outcome.includes('{guest}'));
      assert.doesNotMatch(choice.outcome.replaceAll('{owner}', '').replaceAll('{guest}', ''), /\{[^}]*\}/);
    }
  }
});

test('Japanese education distinguishes school routes and course completion from degrees or protected credentials', () => {
  assert.match(pack.education.description, /六年小學.*三年初中/);
  assert.match(pack.education.description, /高專/);
  assert.match(pack.education.completeLabel, /課程/);
  assert.doesNotMatch(pack.education.completeOutcome, /取得學士|取得執照|教師資格|護理師資格|自動畢業/);
  for (const key of ['name', 'description', 'startLabel', 'startOutcome', 'pauseOutcome', 'completeLabel', 'completeOutcome']) assert.ok(pack.education[key]);
});

test('primary-source records identify checked dates, scope and supported facts without salary or FX claims', () => {
  assert.ok(pack.sources.length >= 10);
  assert.equal(new Set(pack.sources.map(item => item.id)).size, pack.sources.length);
  for (const source of pack.sources) {
    assert.equal(source.checkedAt, '2026-10-16');
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.supports.length >= 20);
    assert.match(new URL(source.url).hostname, /(?:go\.jp|lg\.jp|tokyometro\.jp|gotokyo\.org|japanpost\.jp)$/);
  }
  const daily = Object.values(pack.daily).flat().join('\n');
  assert.doesNotMatch(daily, /星曆|城邦|感恩節|台北捷運|垃圾車音樂|全球前\d|同年代\d+%|保證月薪|20\d{2}年/);
});
