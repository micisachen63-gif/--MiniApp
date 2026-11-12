import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/hero-hall-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/hero-hall-ui.css', import.meta.url), 'utf8');
const helpers = { esc: String, fmt: n => String(n), portrait: h => '/p/' + h.id + '.png' };
function heroes(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'c' + i, name: '英雄' + i, baseClass: i % 2 ? 'mage' : 'sword', className: i % 2 ? '法師' : '劍士',
    level: 90 - i, power: 400000 - i * 1000, title: i === 0 ? { name: '日冕' } : null
  }));
}

test('hall podium uses gold/silver/bronze frames and medals on the top edge, never rank-name pills', () => {
  const window = {};
  vm.runInNewContext(source, { window });
  const html = window.RpgHeroHallUI.render({ heroes: heroes(8) }, { filter: 'all', page: 1 }, helpers);
  assert.match(html, /hall-podium/);
  assert.match(html, /frame-gold\.svg/);
  assert.match(html, /frame-silver\.svg/);
  assert.match(html, /frame-bronze\.svg/);
  assert.match(html, /medal-1\.svg/);
  assert.match(html, /medal-2\.svg/);
  assert.match(html, /medal-3\.svg/);
  assert.doesNotMatch(html, /冠軍|亞軍|季軍|示例資料/);
  assert.match(html, /hall-list/);
  assert.match(html, /第 4 名/);
  assert.match(html, /data-hall-class="all"/);
  assert.match(css, /\.hall-medal\s*\{[^}]*top:\s*0/);
  assert.match(css, /hall-podium-stage[^}]*padding-top:calc\(var\(--medal\) \* \.62\)/, 'frame starts below the medal so it sits on the top rail');
  assert.match(css, /hall-podium \.hall-portrait[\s\S]*?top:13\.6%/, 'portrait window starts below the rail in every frame');
  assert.match(css, /hall-frame-ornament/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test('class filters stay wired and pagination still shows twenty heroes on the first page', () => {
  const window = {};
  vm.runInNewContext(source, { window });
  const html = window.RpgHeroHallUI.render({ heroes: heroes(8) }, { filter: 'mage', page: 1 }, { ...helpers, includeThief: true });
  assert.match(html, /data-hall-class="thief"/);
  assert.match(html, /data-hall-class="mage"/);
  assert.ok(html.includes("aria-selected=\"true\"") && html.includes('data-hall-class="mage"'));
  const onlyMages = (html.match(/data-hall-hero="/g) || []).length;
  assert.equal(onlyMages, 4);
  assert.doesNotMatch(html, /setInterval/);
});

test('hall frames are three distinct SVGs whose portrait window matches the CSS inset', () => {
  const art = name => fs.readFileSync(new URL('../public/art/hall-podium-20261110/' + name, import.meta.url), 'utf8');
  const frames = ['gold', 'silver', 'bronze'].map(k => art('frame-' + k + '.svg'));
  assert.equal(new Set(frames).size, 3);
  for (const svg of frames) assert.match(svg, /M22 34 H178 V222 H22 Z/);
  assert.match(art('medal-1.svg'), /M20 22 L23 8/, 'first place medal carries a crown');
  for (const n of [1, 2, 3]) assert.match(art('medal-' + n + '.svg'), new RegExp('>' + n + '</text>'));
});

test('hall window loads the ranking when opened and never polls', () => {
  const library = fs.readFileSync(new URL('../public/scene-library-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(library, /setInterval/);
  assert.match(source, /開啟時讀取最新排行/);
  assert.doesNotMatch(source, /每 5 分鐘更新/);
});
