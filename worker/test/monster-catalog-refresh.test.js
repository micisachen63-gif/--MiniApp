import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareMonsterCatalog, RUNTIME_FIELDS} from '../tools/refresh-monster-catalog.mjs';
import {READY_MONSTER_KEYS, MONSTER_ART_REVISION} from '../src/game/monster-readiness.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = relative => fs.readFile(path.join(root, relative));
const normalizeEOL = text => String(text).replace(/\r\n?/g, '\n');
const manifest = JSON.parse(await read('art-manifests/monster-expansion.json'));

test('portable catalog refresh uses only the committed manifest and 216 exact raster hashes', async () => {
  const portableRoot = path.join(root, 'absent-portable-checkout'), requested = [];
  const result = await prepareMonsterCatalog(portableRoot, {readFile: async absolute => {
    const relative = path.relative(portableRoot, absolute).replaceAll('\\', '/');
    requested.push(relative);
    assert.ok(relative === 'art-manifests/monster-expansion.json' || relative === 'src/game/monster-readiness.js' || /^public\/art\/monster-expansion-20261013\/(mon|elite|boss)_x13_[\w]+(?:_attack)?\.webp$/.test(relative));
    return read(relative);
  }});
  assert.equal(requested.filter(p => p.endsWith('.webp')).length, 216);
  assert.equal(result.catalog.length, 108);
  assert.equal(result.revision, MONSTER_ART_REVISION);
  for (const [relative, output] of Object.entries(result.outputs)) assert.equal(normalizeEOL(output), normalizeEOL(await read(relative)));
  assert.deepEqual(result.catalog.map(m => m.key), [...READY_MONSTER_KEYS]);
  assert.equal(result.revision, 'monster16-v2-' + createHash('sha256').update(JSON.stringify(result.catalog)).digest('hex'));
});

test('a changed still or last atlas is rejected before any generated output is returned', async () => {
  const before = await read('public/monster-expansion-catalog.js');
  for (const file of ['mon_x13_m01_laurel_fawn.webp', 'boss_x13_m12_boss_secondary_attack.webp']) {
    await assert.rejects(prepareMonsterCatalog(root, {readFile: absolute => absolute.endsWith(path.sep + file) ? Promise.resolve(Buffer.from('changed raster')) : fs.readFile(absolute)}), /SHA256 mismatch/);
  }
  assert.deepEqual(await read('public/monster-expansion-catalog.js'), before);
});

test('public catalog contains only runtime presentation fields and no local provenance or approval claims', async () => {
  const source = String(await read('public/monster-expansion-catalog.js')), context = vm.createContext({window: {}});
  vm.runInContext(source, context);
  for (const entry of context.window.RpgMonsterExpansionCatalog) assert.deepEqual(Object.keys(entry), [...RUNTIME_FIELDS]);
  assert.doesNotMatch(source, /technicalQA|sourceHash|sourceFilename|qaApproved|sceneQA|sceneSignature|deployment scene|[A-Z]:[\\/]/);
  assert.ok(Buffer.byteLength(source) < 125000);
  for (const entry of manifest.monsters) assert.doesNotMatch(entry.provenance.sourceFilename, /[\\/]|^[A-Z]:/);
  assert.equal(manifest.sceneQA.status, 'not-recorded');
});

test('boss7 layout matches its current intact raster instead of the replaced artwork metadata', async () => {
  const m = manifest.monsters.find(m => m.runtime.key === 'boss_x13_m07_boss_secondary'), r = m.runtime;
  assert.equal(m.assets.still.sha256, 'a724e3ca95d2b756fc726c58a2cb61039682e15ff0b8a7fe5688146db6c4991f');
  assert.equal(m.assets.atlas.sha256, '26c9a76ddc943b2b59c44f676814bdf700a2d3d344d276346c50de83a06af38c');
  assert.deepEqual(r.frameBounds[0], [119/480,119/480,450/480,450/480]);
  assert.equal(r.bodyHeight, 331/480); assert.equal(r.feet, 450/480);
  for (const [i, frame] of m.pixelAudit.frames.entries()) {
    assert.deepEqual(r.frameBounds[i], frame.bounds.map((v,j) => (v + (j > 1 ? 1 : 0))/480));
    assert.ok(frame.minMargin >= 30);
  }
  const layout = JSON.parse(await read('public/monster-layout.json'));
  for (const suffix of ['.webp','_attack.webp']) {
    assert.equal(layout[r.key+suffix].bodyHeight, r.bodyHeight);
    assert.deepEqual(layout[r.key+suffix].frameBounds, r.frameBounds);
  }
});
