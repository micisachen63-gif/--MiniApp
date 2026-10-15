import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXP_TABLE, expPerTick, dailyGold, mapForLevel, pyRound } from '../src/game/formulas.js';
import { taipeiDay, taipeiAt } from '../src/game/time.js';

test('released EXP curve matches the tracked pre-remediation baseline for every level 1–119',()=>{
  // Frozen from release 4f49917. This isn't a claim to validate an absent sim.py.
  const rows=readFileSync(new URL('./fixtures/exp-table-release-4f49917.csv',import.meta.url),'utf8').trim().split('\n').slice(1).map(line=>line.split(',').map(Number));
  assert.equal(rows.length,119);
  for(const [level,tick,next] of rows){assert.equal(expPerTick(level),tick,`tick ${level}`);assert.equal(EXP_TABLE[level],next,`next ${level}`);}
  assert.equal(EXP_TABLE[120],null);
});

test('python-style rounding, daily gold, map tiers', () => {
  assert.equal(pyRound(2.5), 2); assert.equal(pyRound(3.5), 4);
  assert.equal(dailyGold(1), 670); assert.equal(dailyGold(30), 2700);
  assert.deepEqual([1, 10, 11, 20, 30, 31, 60, 61, 120].map(mapForLevel), [1, 1, 2, 2, 3, 4, 6, 7, 12]);
});
test('Taipei day boundaries', () => {
  const t = taipeiAt('2026-10-08', 0); assert.equal(new Date(t).toISOString(), '2026-10-07T16:00:00.000Z');
  assert.equal(taipeiDay(t - 1), '2026-10-07'); assert.equal(taipeiDay(t), '2026-10-08');
});
