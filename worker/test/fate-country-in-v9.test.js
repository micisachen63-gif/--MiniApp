import test from 'node:test';
import assert from 'node:assert/strict';
import pack, {COUNTRY_PACK_IN} from '../public/fate/country-packs-v9/in.js';
import jp from '../public/fate/country-packs-v9/jp.js';
import kr from '../public/fate/country-packs-v9/kr.js';
import {TAIWAN_MEMORIES_V8 as tw1, TAIWAN_CAREER_CHAPTERS_V8 as jobs, TAIWAN_TEACHER_CHAPTERS_V8 as teachers} from '../public/fate/taiwan-content-v8.js';
import {TAIWAN_EXTRA_MEMORIES_V8 as tw2} from '../public/fate/taiwan-days-extra-v8.js';
import {TAIWAN_RESERVE_MEMORIES_V8 as tw3} from '../public/fate/taiwan-days-reserve-v8.js';

test('IN is immutable Bengaluru Urban data with fictional INR starting budgets', () => {
  assert.equal(pack, COUNTRY_PACK_IN);
  assert.equal(pack.id, 'IN');
  assert.equal(pack.cityId, 'bengaluru');
  assert.match(pack.scope, /Karnataka州Bengaluru Urban/);
  assert.match(pack.scope, /不代表全印度/);
  assert.equal(pack.currency, 'INR');
  assert.ok(Object.isFrozen(pack));
  assert.deepEqual(pack.families.map(x => x.id), ['tight', 'ordinary', 'small-business', 'comfortable']);
  for (const row of pack.families) assert.ok(Number.isInteger(row.money) && row.money >= 0 && row.text.length > 30);
});

test('IN has exactly 1500 independent daily strings at each phase capacity', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(pack.daily).map(([k, v]) => [k, v.length])), {child: 120, youth: 100, adult: 720, late: 420, any: 140});
  const all = Object.values(pack.daily).flat();
  assert.equal(all.length, 1500);
  assert.equal(new Set(all).size, 1500);
  for (const rows of Object.values(pack.daily)) assert.ok(Object.isFrozen(rows));
  for (const text of all) {
    assert.ok(text.length >= 18);
    assert.doesNotMatch(text, /\{[^}]*\}|<[^>]+>|\$\{/);
    assert.doesNotMatch(text, /星曆|城邦|感恩節|台北捷運|全球前\d|同年代\d+%|保證月薪|20\d{2}年/);
  }
});

test('IN daily and work chapters have zero exact reuse from TW, JP and KR', () => {
  const previous = new Set([
    ...[...tw1, ...tw2, ...tw3, ...Object.values(jobs).flat(), ...teachers].map(x => x.text),
    ...[jp, kr].flatMap(p => [...Object.values(p.daily).flat(), ...p.careers.flatMap(x => x.chapters)]),
  ]);
  for (const text of [...Object.values(pack.daily).flat(), ...pack.careers.flatMap(x => x.chapters)]) assert.equal(previous.has(text), false, text);
});

test('daily texts do not grant unearned job, partner, child, tenancy, medical or qualification states', () => {
  const invalid = /你(?:的)?(?:下班|上班|同事|薪資|房東|租約|伴侶|丈夫|妻子|兒子|女兒)|你和(?:室友|伴侶)|你的孩子|你領到薪水|你結婚了|你買下房子|你取得學位|你被診斷|你確診|停掉原來的藥/;
  for (const text of [...pack.daily.adult, ...pack.daily.late, ...pack.daily.any]) assert.doesNotMatch(text, invalid);
  for (const text of pack.daily.any) assert.doesNotMatch(text, /段考|入職|薪資|學測|駕照|高中畢業|上班/);
  for (const text of pack.daily.child) assert.doesNotMatch(text, /高中畢業|大學錄取|取得駕照|你領到薪水|你取得資格/);
  for (const text of pack.daily.youth) assert.doesNotMatch(text, /大學畢業|取得學士|你考到駕照|你成為家長/);
});

test('four shelves each have 240-node phase coverage for death ages 59 to 103', () => {
  const available = Object.fromEntries(Object.entries(pack.daily).map(([k, v]) => [k, v.length / 4]));
  for (let death = 59; death <= 103; death++) {
    const required = {child: 0, youth: 0, adult: 0, late: 0, any: 0};
    for (let i = 1; i <= 240; i++) {
      const age = Math.floor(i / 240 * death);
      if (age < 3) continue;
      required[age < 6 ? 'any' : age < 13 ? 'child' : age < 18 ? 'youth' : age < 60 ? 'adult' : 'late']++;
    }
    for (const phase of Object.keys(required)) assert.ok(required[phase] <= available[phase], `${death}/${phase}`);
  }
});

test('12 IN careers each have 10 unique chapters and 4 valid two-option dilemmas', () => {
  assert.equal(pack.careers.length, 12);
  assert.equal(new Set(pack.careers.map(x => x.id)).size, 12);
  const ids = new Set();
  for (const career of pack.careers) {
    assert.match(career.id, /^[a-z][a-z-]{0,19}$/);
    assert.ok([18, 21].includes(career.minAge));
    assert.ok(career.practice.length >= 25 && career.entry.length >= 25);
    assert.equal(career.chapters.length, 10);
    assert.equal(career.dilemmas.length, 4);
    for (const dilemma of career.dilemmas) {
      assert.match(dilemma.id, /^in-[a-z-]+$/);
      assert.ok(dilemma.id.length <= 24);
      assert.equal(ids.has(dilemma.id), false);
      ids.add(dilemma.id);
      assert.ok([1, 2, 3].includes(dilemma.minStage));
      assert.equal(dilemma.choices.length, 2);
      assert.notEqual(dilemma.choices[0].outcome, dilemma.choices[1].outcome);
      for (const choice of dilemma.choices) {
        assert.deepEqual(Object.keys(choice.delta).sort(), ['bonds', 'energy', 'money', 'reputation']);
        assert.ok(Object.values(choice.delta).every(Number.isInteger));
        assert.equal(typeof choice.exit, 'boolean');
        assert.equal(choice.flags, undefined);
      }
    }
  }
  assert.equal(ids.size, 48);
  assert.equal(new Set(pack.careers.flatMap(x => x.chapters)).size, 120);
});

test('IN has unpaid household care, clear assistant roles and no automatic protected qualification', () => {
  const care = pack.careers.find(x => x.id === 'household-care');
  assert.equal(care.minAge, 21);
  assert.doesNotMatch(care.entry, /受聘|受雇|薪水|工資/);
  assert.ok(care.dilemmas.flatMap(x => x.choices).every(x => x.delta.money <= 0));
  assert.doesNotMatch(care.chapters.join('\n'), /同事|主管|薪水|退休金|客人/);
  for (const job of pack.careers) assert.doesNotMatch(job.entry, /你取得護理師|你成為正式教師|取得醫師執照|自行開業|自主接案/);
  assert.ok(pack.careers.every(x => x.employmentMode !== 'self-employed'));
  assert.equal(pack.careers.find(x => x.id === 'clinic-records').minAge, 21);
});

test('24 social chains contain six safe name chapters with colleague state gating', () => {
  assert.equal(pack.social.length, 24);
  assert.equal(new Set(pack.social.map(x => x.id)).size, 24);
  for (const row of pack.social) {
    assert.match(row.id, /^[a-z-]{1,16}$/);
    assert.ok(['friend', 'neighbor', 'colleague'].includes(row.role));
    assert.equal(typeof row.requiresCareer, 'boolean');
    if (row.role === 'colleague') assert.equal(row.requiresCareer, true);
    assert.equal(row.chapters.length, 6);
    for (const text of row.chapters) {
      assert.ok(text.includes('{name}'));
      assert.doesNotMatch(text.replaceAll('{name}', ''), /\{[^}]*\}/);
      assert.doesNotMatch(text, /欠你|騙你|偷竊|犯罪|出軌|逼迫|愛上你|替你還債/);
    }
  }
  assert.equal(new Set(pack.social.flatMap(x => x.chapters)).size, 144);
});

test('six reciprocal stories keep both players in both distinct outcomes', () => {
  assert.deepEqual(pack.shared.map(x => x.id), ['moving', 'parcel', 'repair', 'market', 'umbrella', 'bookstore']);
  for (const row of pack.shared) {
    assert.ok(row.text.includes('{owner}') && row.text.includes('{guest}'));
    assert.equal(row.choices.length, 2);
    assert.notEqual(row.choices[0].outcome, row.choices[1].outcome);
    for (const choice of row.choices) assert.ok(choice.outcome.includes('{owner}') && choice.outcome.includes('{guest}'));
  }
});

test('education and 13 primary source records keep scope and qualification limitations explicit', () => {
  assert.match(pack.education.description, /不同學校體系/);
  assert.match(pack.education.description, /PUC/);
  assert.match(pack.education.completeLabel, /課程/);
  assert.doesNotMatch(pack.education.completeOutcome, /取得學士|取得執照|教師資格|護理師資格|自動畢業/);
  assert.equal(pack.sources.length, 13);
  assert.equal(new Set(pack.sources.map(x => x.id)).size, 13);
  for (const source of pack.sources) {
    assert.equal(source.checkedAt, '2026-10-16');
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.supports.length >= 20);
    assert.match(new URL(source.url).hostname, /(?:nic\.in|gov\.in|bmrc\.co\.in|karnatakatourism\.org|bbmpgov\.in)$/);
  }
});
