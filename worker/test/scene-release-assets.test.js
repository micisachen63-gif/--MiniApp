import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RELEASE_ASSET_FOLDERS, collectReleaseAssets } from '../tools/scene-release-assets.mjs';

const publicRoot = new URL('../public', import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(new URL('../public/scene-production-manifest.json', import.meta.url), 'utf8'));
const builder = fs.readFileSync(new URL('../tools/build-scene-release.mjs', import.meta.url), 'utf8');

test('scene release rebuild keeps material and 3D button art entries byte-identical to the manifest', async () => {
  const collected = await collectReleaseAssets(publicRoot);
  for (const folder of ['art/materials-20261110', 'ui/button-materials/buttons-3d-20261110'])
    assert.ok(RELEASE_ASSET_FOLDERS.some(entry => entry.folder === folder), folder + ' is declared');
  const buttons = collected.filter(entry => entry.url.startsWith('/ui/button-materials/buttons-3d-20261110/'));
  assert.equal(buttons.length, 8, 'four states x webp/png');
  assert.ok(collected.filter(entry => entry.kind === 'material-art').length >= 1);
  const inManifest = new Map(manifest.entries.map(entry => [entry.url, entry]));
  for (const entry of collected) assert.deepEqual(inManifest.get(entry.url), entry, 'rebuilt entry matches committed manifest: ' + entry.url);
  const declared = manifest.entries.filter(entry => RELEASE_ASSET_FOLDERS.some(({ folder }) => entry.url.startsWith('/' + folder + '/')));
  assert.equal(declared.length, collected.length, 'no manifest entry in a declared folder would be dropped');
  assert.match(builder, /import \{collectReleaseAssets\} from '\.\/scene-release-assets\.mjs'/);
  assert.match(builder, /for\(const entry of await collectReleaseAssets\(publicRoot\)\)entries\.set\(entry\.url,entry\);/);
});
test('release asset collection skips missing folders and unlisted file types', async () => {
  assert.deepEqual(await collectReleaseAssets(publicRoot, [{ folder: 'no-such-folder-xyz', pattern: /./, kind: 'x', source: 'y' }]), []);
  const only = await collectReleaseAssets(publicRoot, [{ folder: 'ui/button-materials/buttons-3d-20261110', pattern: /\.webp$/, kind: 'ui-art', source: 's' }]);
  assert.equal(only.length, 4); assert.ok(only.every(entry => entry.url.endsWith('.webp')));
});
