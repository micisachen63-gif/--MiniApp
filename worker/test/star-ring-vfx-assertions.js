import assert from 'node:assert/strict';

// The historical fixtures predate presentation receipts. Keep their exact JSON
// ordering and every gameplay / reward field; omit only the two added VFX fields.
export function stringifyStarRingGameplay(value) {
  return JSON.stringify(value, (key, entry) =>
    key === 'vfx' || key === 'vfxEvents' ? undefined : entry);
}

function gameplayEvent({vfx, vfxEvents, ...gameplay}) {
  return gameplay;
}

function assertDescriptorSources(projected, committed, label) {
  assert.ok(projected && typeof projected === 'object' && !Array.isArray(projected), label);
  assert.ok(committed && typeof committed === 'object' && !Array.isArray(committed), label);
  assert.equal(projected.source, 'deterministic-projection', label + ' projection source');
  assert.equal(committed.source, 'committed-combat', label + ' committed source');
  const {source: projectedSource, ...projectedFields} = projected;
  const {source: committedSource, ...committedFields} = committed;
  assert.deepEqual(projectedFields, committedFields, label + ' descriptor fields');
}

// The service exposes an uncommitted deterministic projection between two-hour
// checkpoints. The engine's default result is suitable for committing. Combat
// must be identical, and source must be the sole presentation-field difference.
export function assertProjectedCombatMatchesCommitted(projectedEvents, committedEvents) {
  assert.ok(Array.isArray(projectedEvents));
  assert.ok(Array.isArray(committedEvents));
  assert.deepEqual(projectedEvents.map(gameplayEvent), committedEvents.map(gameplayEvent),
    'projection and committed gameplay events');
  let compared = 0;
  for (let index = 0; index < projectedEvents.length; index++) {
    const projected = projectedEvents[index], committed = committedEvents[index];
    for (const field of ['vfx', 'vfxEvents']) {
      const label = 'event ' + index + '.' + field;
      assert.equal(Object.hasOwn(projected, field), Object.hasOwn(committed, field),
        label + ' presence');
      if (!Object.hasOwn(projected, field)) continue;
      if (field === 'vfx') {
        assertDescriptorSources(projected[field], committed[field], label);
        compared++;
      } else {
        assert.ok(Array.isArray(projected[field]), label);
        assert.ok(Array.isArray(committed[field]), label);
        assert.equal(projected[field].length, committed[field].length, label + ' count');
        for (let effect = 0; effect < projected[field].length; effect++) {
          assertDescriptorSources(projected[field][effect], committed[field][effect],
            label + '[' + effect + ']');
          compared++;
        }
      }
    }
  }
  return compared;
}
