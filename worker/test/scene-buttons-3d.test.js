import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const pub = new URL('../public/', import.meta.url), read = p => fs.readFileSync(new URL(p, pub));
const base = 'ui/button-materials/buttons-3d-20261110/';
const states = ['tab-normal', 'tab-selected', 'pill-normal', 'pill-selected'];
const webpSize = buf => { // VP8L / VP8X / VP8 canvas size
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
};

test('3D button art: four sliced states as alpha WebP + PNG fallback, small, 2x display size, listed in the scene manifest', () => {
  const manifest = JSON.parse(read('scene-production-manifest.json'));
  for (const name of states) for (const ext of ['webp', 'png']) {
    const data = read(base + name + '.' + ext);
    assert.ok(data.length < 60 * 1024, name + '.' + ext + ' under 60KB');
    const entry = manifest.entries.find(e => e.url === '/' + base + name + '.' + ext);
    assert.ok(entry, 'manifest lists ' + name + '.' + ext);
    assert.equal(entry.bytes, data.length); assert.equal(entry.sha256, createHash('sha256').update(data).digest('hex'));
  }
  for (const name of states) {
    const data = read(base + name + '.webp'); assert.equal(data.toString('ascii', 8, 12), 'WEBP');
    assert.equal(data.toString('ascii', 12, 16), 'VP8X', name + ' keeps alpha (extended WebP)');
    const [w, h] = webpSize(data);
    if (name.startsWith('tab')) assert.equal(h, name === 'tab-normal' ? 112 : 145, name + ' frame is 112px tall (2x of 56); selected adds the crest');
    else assert.equal(h, 96);
    assert.ok(w / (name === 'tab-selected' ? h - 33 : h) > 2.2, name + ' wide aspect preserved');
  }
});

test('social tabs, chat filter pills and 英雄殿堂 class pills use the 3D art, three-slice, ≥44px and pressed when selected', () => {
  const css = read('scene-social-preview.css').toString();
  const block = css.slice(css.indexOf('/* Gold-frame navy 3D buttons'));
  assert.ok(block.length > 1000);
  for (const name of states) assert.match(block, new RegExp('/' + base + name + '\\.webp'));
  assert.match(block, /:is\(\.scene-social-shortcuts,\.scene-chat-tabs,\.hall-tabs\)/);
  assert.match(block, /grid-auto-columns:minmax\(0,1fr\)/, 'equal widths');
  assert.match(block, /min-height:44px!important/);
  assert.match(block, /white-space:nowrap/);
  assert.match(block, /border-image-slice:0 var\(--b3-slice\) fill/, 'caps keep aspect; only the middle stretches');
  assert.match(block, /border-image-slice:34 var\(--b3-slice\) 0 fill/, 'selected tab hides crest rows in the frame');
  assert.match(block, /aria-selected=true\],\[aria-current=page\],:active\)\{\s*transform:translateY\(1px\)/, 'pressed-in selected state');
  assert.match(css, /scene-social-shortcuts/); assert.equal(read('ui-generated-20261030/hud-angels-20261102/scene-social-preview.css').toString(), css, 'alias identical');
  const social = read('scene-social-preview.js').toString();
  assert.match(social, /createElement\('nav'\);shortcuts\.className='scene-social-shortcuts'/);
  assert.doesNotMatch(social, /partyButton\.style\.minHeight/);
  const library = read('scene-library-ui.js').toString();
  assert.match(library, /if\(tab==='hall'\|\|tab==='duel'\)html\+='<nav class="scene-social-shortcuts"/);
  assert.match(library, /aria-current="page"/);
  assert.match(library, /each\('\[data-sl-social\]'/);
});
