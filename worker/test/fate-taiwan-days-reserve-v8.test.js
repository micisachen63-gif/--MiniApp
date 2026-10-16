import test from 'node:test';
import assert from 'node:assert/strict';
import {TAIWAN_RESERVE_MEMORIES_V8 as reserve} from '../public/fate/taiwan-days-reserve-v8.js';
import {TAIWAN_EXTRA_MEMORIES_V8 as extra} from '../public/fate/taiwan-days-extra-v8.js';
import {TAIWAN_MEMORIES_V8 as base, TAIWAN_CAREER_CHAPTERS_V8 as careers,
  TAIWAN_TEACHER_CHAPTERS_V8 as teachers} from '../public/fate/taiwan-content-v8.js';

test('third authored reserve adds exactly 300 adult, 120 late and 80 age-neutral distinct scenes', () => {
  assert.equal(reserve.length, 500);
  assert.deepEqual(Object.fromEntries(['adult', 'late', 'any'].map(phase => [phase,
    reserve.filter(item => item.phase === phase).length])), {adult: 300, late: 120, any: 80});
  assert.ok(Object.isFrozen(reserve));
  assert.equal(new Set(reserve.map(item => item.text)).size, reserve.length);
  for (const item of reserve) {
    assert.ok(Object.isFrozen(item));
    assert.match(item.id, /^tw8-reserve-(adult|late|any)-\d{3}$/);
    assert.ok(item.id.length <= 32);
    assert.ok(item.text.length >= 20, item.id);
    assert.doesNotMatch(item.text, /\$\{|\{\{|<[^>]+>/);
  }
});

test('all 1718 Taiwan daily scenes have unique full text and IDs, independent from the 170 job chapters', () => {
  const daily = [...base, ...extra, ...reserve];
  assert.equal(daily.length, 1718);
  assert.equal(new Set(daily.map(item => item.id)).size, daily.length);
  assert.equal(new Set(daily.map(item => item.text)).size, daily.length);
  const jobs = [...Object.values(careers).flat(), ...teachers];
  const jobIds = new Set(jobs.map(item => item.id)), jobTexts = new Set(jobs.map(item => item.text));
  for (const item of daily) {
    assert.equal(jobIds.has(item.id), false, item.id);
    assert.equal(jobTexts.has(item.text), false, item.id);
  }
});

test('reserve age constraints keep the 80 neutral moments usable from age three without school or job awards', () => {
  const ranges = {adult: [18, 59], late: [60, 110], any: [3, 110]};
  for (const item of reserve) {
    assert.deepEqual([item.minAge, item.maxAge], ranges[item.phase], item.id);
    if (item.phase === 'any') {
      assert.doesNotMatch(item.text, /段考|補習|志願表|學測|駕照|入職|薪資|上班|畢業照|你的孩子|買房/, item.id);
    }
  }
});

test('reserve does not silently assign employment, a tenancy, spouse, child, diagnosis or a professional qualification', () => {
  for (const item of reserve) {
    assert.doesNotMatch(item.text,
      /你(?:的)?(?:下班|上班|同事|薪資|房東|租約|伴侶|丈夫|妻子|兒子|女兒)|你和(?:室友|伴侶)|你的孩子|退租前你|你被診斷|你確診|停掉原來的藥|你領到薪水|你取得教師證|你成為護理師/,
      item.id);
  }
});

test('reserve remains date-neutral metropolitan fiction and does not claim statistical percentiles or historical world events', () => {
  const text = reserve.map(item => item.text).join('\n');
  assert.doesNotMatch(text, /星曆|城邦|符文|感恩節|全球前\d|同年代\d+%|保證月薪|保證年薪|20\d{2}年/);
  for (const detail of ['捷運', '公車', '市場', '站務', '影印', '社區', '保鮮盒']) {
    assert.ok(text.includes(detail), detail);
  }
});
