import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MONSTER_DATA} from '../src/game/monster-data.js';

export const RUNTIME_FIELDS = Object.freeze(['map','name','role','key','behavior','spell','cols','rows','frames','folder','attackDirection','ready','ratio','bodyHeight','feet','frameBounds','idle','move','attack','cast','hurt','death']);
const digest = data => createHash('sha256').update(data).digest('hex');
const normalizeEOL = text => String(text).replace(/\r\n?/g, '\n');
const workerRoot = fileURLToPath(new URL('../', import.meta.url));

// Validate the committed raster files before preparing any generated output.
// This refresh never generates images or approves visual/scene QA.
export async function prepareMonsterCatalog(root = workerRoot, {readFile = fs.readFile} = {}) {
  const read = relative => readFile(path.join(root, relative));
  const manifest = JSON.parse(await read('art-manifests/monster-expansion.json'));
  const expected = new Map(MONSTER_DATA.filter(m => m.expansion).map(m => [m.spriteKey, m]));
  if (manifest.monsters?.length !== expected.size || expected.size !== 108) throw new Error('Expected all 108 monster identities');
  const catalog = [], keys = new Set(), imageHashes = {still: new Set(), atlas: new Set()};
  for (const entry of manifest.monsters) {
    const m = entry.runtime, identity = expected.get(m?.key);
    if (!identity || keys.has(m.key) || identity.mapId !== m.map || identity.name !== m.name || identity.role !== m.role) throw new Error(`Invalid/duplicate monster identity: ${m?.key}`);
    keys.add(m.key);
    if (m.ready !== true || m.cols !== 4 || m.rows !== 4 || m.frames !== 16 || m.folder !== 'monster-expansion-20261013') throw new Error(`Invalid ready 4x4 atlas: ${m.key}`);
    if (m.behavior !== identity.behavior || m.spell !== identity.spell || m.attackDirection !== identity.attackDirection) throw new Error(`Changed monster combat presentation identity: ${m.key}`);
    if (!(m.bodyHeight > 0 && m.bodyHeight <= 1 && m.feet > 0 && m.feet <= 1) || m.frameBounds?.length !== 16 || m.frameBounds.some(b => b.length !== 4 || b.some(v => !Number.isFinite(v) || v < 0 || v > 1) || b[0] >= b[2] || b[1] >= b[3])) throw new Error(`Invalid layout metadata: ${m.key}`);
    for (const action of ['idle','move','attack','cast','hurt','death']) if (!m[action]?.length || m[action].some(f => !Number.isInteger(f) || f < 0 || f > 15)) throw new Error(`Invalid ${action} frames: ${m.key}`);
    for (const kind of ['still','atlas']) {
      const relative = `public/art/${m.folder}/${m.key}${kind === 'atlas' ? '_attack' : ''}.webp`;
      const actual = digest(await read(relative));
      if (actual !== entry.assets?.[kind]?.sha256) throw new Error(`Monster ${kind} SHA256 mismatch: ${m.key}`);
      if (imageHashes[kind].has(actual)) throw new Error(`Duplicate monster ${kind}: ${m.key}`);
      imageHashes[kind].add(actual);
    }
    catalog.push(Object.fromEntries(RUNTIME_FIELDS.map(field => [field, m[field]])));
  }
  const revision = 'monster16-v2-' + digest(JSON.stringify(catalog));
  const catalogSource = '// Runtime presentation metadata; audit evidence lives in art-manifests/monster-expansion.json.\n' +
    `window.RpgMonsterExpansionArtRevision = ${JSON.stringify(revision)};\nwindow.RpgMonsterExpansionCatalog = ${JSON.stringify(catalog)};\n`;
  const readinessPath = 'src/game/monster-readiness.js';
  const readinessSource = String(await read(readinessPath));
  const match = readinessSource.match(/export const MONSTER_ART_REVISION\s*=\s*(['"])[^'"\r\n]+\1;/g);
  if (match?.length !== 1) throw new Error('Expected one server monster art revision');
  // Readiness is a separate release decision. Refresh cannot add or remove live keys.
  const keyBlock = readinessSource.slice(0, readinessSource.indexOf('export const MONSTER_ART_REVISION'));
  const released = [...keyBlock.matchAll(/['"]((?:mon|elite|boss)_x13_[^'"]+)['"]/g)].map(m => m[1]);
  if (released.length !== 108 || new Set(released).size !== 108 || released.some(key => !keys.has(key))) throw new Error('Server readiness must already contain exactly the same 108 keys');
  const nextReadiness = readinessSource.replace(match[0], `export const MONSTER_ART_REVISION = '${revision}';`);
  return {catalog, revision, outputs: {'public/monster-expansion-catalog.js': catalogSource, [readinessPath]: nextReadiness}};
}

export async function refreshMonsterCatalog(root = workerRoot, {check = false} = {}) {
  const result = await prepareMonsterCatalog(root);
  for (const [relative, content] of Object.entries(result.outputs)) {
    const target = path.join(root, relative), current = await fs.readFile(target, 'utf8');
    const changed = normalizeEOL(current) !== normalizeEOL(content);
    if (check && changed) throw new Error(`Generated monster metadata is stale: ${relative}`);
    if (!check && changed) await fs.writeFile(target, content);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await refreshMonsterCatalog(workerRoot, {check: process.argv.includes('--check')});
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Refreshed'} ${result.catalog.length} monsters / 216 raster SHA256 checks: ${result.revision}`);
}
