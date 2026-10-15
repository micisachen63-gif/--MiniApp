import nodeFs from 'node:fs/promises';
const _fs = typeof fs !== 'undefined' ? fs : nodeFs;
const _createHash = typeof createHash !== 'undefined' ? createHash : (await import('node:crypto')).createHash;

const isRelease = process.argv.includes('--release-gate');
const base = 'art-production/monster-expansion-20261013';

const hash = data => _createHash('sha256').update(data).digest('hex');

const manifestRaw = await _fs.readFile(base + '/manifest.json', 'utf8');
const manifest = JSON.parse(manifestRaw);
const jobs = manifest.jobs || [];

if (isRelease) {
  if (jobs.length !== 108) {
    throw new Error(`Expected 108 jobs for release gate, got ${jobs.length}`);
  }
  const keys = new Set();
  for (const job of jobs) {
    if (keys.has(job.key)) {
      throw new Error(`Duplicate unique monster identity found: ${job.key}`);
    }
    keys.add(job.key);
    if (job.cols !== 4 || job.rows !== 4 || job.frames !== 16) {
      throw new Error(`Invalid format cols/rows/frames for ${job.key}: must be 4x4 with 16 frames`);
    }
  }
}

const catalog = [];
for (const job of jobs) {
  const metaRaw = await _fs.readFile(`${base}/packed/${job.key}.json`, 'utf8');
  const meta = JSON.parse(metaRaw);
  if (isRelease) {
    if (meta.cols !== 4 || meta.rows !== 4 || meta.frames !== 16) {
      throw new Error(`Invalid format cols/rows/frames for ${job.key}: must be 4x4 with 16 frames`);
    }
    const srcBuf = await _fs.readFile(meta.source);
    if (hash(srcBuf) !== meta.sourceHash) {
      throw new Error(`Changed source hash for ${job.key}`);
    }
    const atlasBuf = await _fs.readFile(`public/art/monster-expansion-20261013/${job.key}_attack.webp`);
    if (hash(atlasBuf) !== meta.technicalQA?.assetHash) {
      throw new Error(`Changed atlas hash for ${job.key}`);
    }
    const stillBuf = await _fs.readFile(`public/art/monster-expansion-20261013/${job.key}.webp`);
    if (hash(stillBuf) !== meta.technicalQA?.stillHash) {
      throw new Error(`Changed still static hash for ${job.key}`);
    }
    if (!meta.sceneQA?.desktop || !meta.sceneQA?.mobile) {
      throw new Error(`Missing scene QA (mobile/desktop) for ${job.key}`);
    }
  }
  catalog.push(meta);
}

const rendererFiles = ['app.js','battle.js','battle.css','monster-expansion.js','cinematic-fx.js','styles.css'];
const rendererBuffers = [];
for (const f of rendererFiles) {
  const buf = await _fs.readFile('public/' + f);
  rendererBuffers.push(Buffer.from(f + '\n'), buf);
}
const rendererHash = hash(Buffer.concat(rendererBuffers));

const revision = 'monster16-v2-' + hash(Buffer.from(JSON.stringify(catalog) + rendererHash)).slice(0, 16);

const catalogJs = `window.RpgMonsterExpansionCatalog = ${JSON.stringify(catalog, null, 2)};\nwindow.RpgMonsterExpansionArtRevision = ${JSON.stringify(revision)};\n`;
await _fs.writeFile('public/monster-expansion-catalog.js', catalogJs);

if (isRelease) {
  const readinessJs = `export const READY_MONSTER_KEYS = new Set(${JSON.stringify(catalog.map(m => m.key))});\nexport const MONSTER_ART_REVISION = ${JSON.stringify(revision)};\n`;
  await _fs.writeFile('src/game/monster-readiness.js', readinessJs);
}
