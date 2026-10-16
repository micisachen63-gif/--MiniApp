import test from 'node:test';
import assert from 'node:assert/strict';
import {TAIWAN_EXTRA_MEMORIES_V8 as extra} from '../public/fate/taiwan-days-extra-v8.js';
import {TAIWAN_MEMORIES_V8 as original, TAIWAN_CAREER_CHAPTERS_V8 as careers,
  TAIWAN_TEACHER_CHAPTERS_V8 as teachers} from '../public/fate/taiwan-content-v8.js';

test('second Taiwan collection contains 600 authored entries with the intended age coverage', () => {
  assert.equal(extra.length, 600);
  assert.deepEqual(Object.fromEntries(['child', 'youth', 'adult', 'late', 'any'].map(phase => [
    phase, extra.filter(item => item.phase === phase).length,
  ])), {child: 120, youth: 80, adult: 180, late: 180, any: 40});
  assert.ok(Object.isFrozen(extra));
  for (const item of extra) {
    assert.ok(Object.isFrozen(item));
    assert.ok(item.text.length >= 20, item.id);
    assert.doesNotMatch(item.text, /\$\{|\{\{|<[^>]+>/, item.id);
  }
});

test('second collection does not repeat a sentence or identity from the first collection or job chapters', () => {
  const old = [...original, ...Object.values(careers).flat(), ...teachers];
  const ids = new Set(old.map(item => item.id)), texts = new Set(old.map(item => item.text));
  assert.equal(new Set(extra.map(item => item.id)).size, extra.length);
  assert.equal(new Set(extra.map(item => item.text)).size, extra.length);
  for (const item of extra) {
    assert.equal(ids.has(item.id), false, item.id);
    assert.equal(texts.has(item.text), false, item.id);
    assert.match(item.id, /^tw8-extra-(?:child|youth|adult|late|any)-\d{3}$/);
    assert.ok(item.id.length <= 32, item.id);
  }
});

test('neutral reserves and age pools cannot leak school or employment into early childhood or old age', () => {
  const ranges = {child: [6, 12], youth: [13, 17], adult: [18, 59], late: [60, 110], any: [3, 110]};
  for (const item of extra) {
    assert.deepEqual([item.minAge, item.maxAge], ranges[item.phase], item.id);
    if (item.phase === 'any') {
      assert.doesNotMatch(item.text, /段考|補習|志願表|學測|入職|薪資|你下班|你上班|畢業照|你的孩子/, item.id);
    }
    if (item.phase === 'child') {
      assert.doesNotMatch(item.text, /高中|大學畢業|學測|駕照|你的房東|薪資|你的伴侶/, item.id);
    }
    if (item.phase === 'youth') {
      assert.doesNotMatch(item.text, /你考上大學|你取得教師證|你成為護理師|你正式上班|學測|高考/, item.id);
    }
  }
});

test('ungated modern daily prose does not assign the player a job, tenancy, marriage, child or diagnosis', () => {
  for (const item of extra) {
    assert.doesNotMatch(item.text,
      /你(?:的)?(?:下班|上班|同事|薪資|房東|租約|伴侶|丈夫|妻子|兒子|女兒)|你和(?:室友|伴侶)|你的孩子|退租前你|你被診斷|你確診|停掉原來的藥|你領到薪水/,
      item.id);
  }
});

test('additional city moments do not invent foreign customs, named policy years or real statistical rankings', () => {
  const text = extra.map(item => item.text).join('\n');
  assert.doesNotMatch(text, /星曆|城邦|符文|感恩節|國慶遊行|全球前\d|同年代\d+%|保證月薪|保證年薪|20\d{2}年/);
  for (const detail of ['捷運', '公車', '早餐店', '夜市', '市場', '騎樓', '超商', '社區', '河邊']) {
    assert.ok(text.includes(detail), detail);
  }
});
