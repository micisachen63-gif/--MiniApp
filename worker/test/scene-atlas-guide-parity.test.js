import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ATLAS_BUILDS } from '../src/game/atlas-catalog.js';

const guide = fs.readFileSync(new URL('../public/scene-atlas-guide.js', import.meta.url), 'utf8');

test('星圖構築 shows classic description, stats, recommend and compatibility text, plus a build icon', () => {
  assert.match(guide, /function buildHtml\(/);
  assert.match(guide, /current\.description/);
  assert.match(guide, /擅長/);
  assert.match(guide, /代價：/);
  assert.match(guide, /倍率 /);
  assert.match(guide, /耗魔 /);
  assert.match(guide, /冷卻 /);
  assert.match(guide, /個目標/);
  assert.match(guide, /套用此流派的入門輔助/);
  assert.match(guide, /需要相符的流派/);
  assert.match(guide, /recommendedSupports/);
  assert.match(guide, /recommendedAutomation/);
  assert.match(guide, /data-guide-recommend/);
  assert.match(guide, /\/art\/atlas-build-icons-20261110\//);
});

test('every atlas build has a compact icon file', () => {
  const ids = ATLAS_BUILDS.map(b => b.id);
  assert.ok(ids.length >= 12);
  const missing = ids.filter(id => !fs.existsSync(new URL('../public/art/atlas-build-icons-20261110/' + id + '.webp', import.meta.url)));
  assert.deepEqual(missing, []);
});
