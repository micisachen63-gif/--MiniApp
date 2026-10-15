import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXP_TABLE, expPerTick, dailyGold, mapForLevel, pyRound } from '../src/game/formulas.js';
import { taipeiDay, taipeiAt } from '../src/game/time.js';

test('EXP table matches sim.py exp_table.csv for Lv1–119', () => {
  const rows = readFileSync(new URL('../../exp_table.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
  assert.equal(rows.length, 119);
  for (const [L, perTick, need] of rows) { assert.equal(expPerTick(L), perTick, `tick L${L}`); assert.equal(EXP_TABLE[L], need, `need L${L}`); }
  assert.equal(EXP_TABLE[120], null);
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
