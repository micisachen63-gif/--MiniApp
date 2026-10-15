// Isolated test-process override; the source release flag is never edited.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const ready = process.env.THIEF_TEST_RELEASE_READY;
assert.ok(ready === 'true' || ready === 'false');
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (!url.endsWith('/worker/src/game/thief-data.js')) return result;
  const source = String(result.source);
  assert.match(source, /export const THIEF_RELEASE_READY = (?:true|false);/);
  return { ...result, source: source.replace(/export const THIEF_RELEASE_READY = (?:true|false);/, `export const THIEF_RELEASE_READY = ${ready};`) };
} });
