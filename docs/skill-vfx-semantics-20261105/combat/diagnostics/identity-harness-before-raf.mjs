/**
 * Real committed SQLite/engine receipts replayed through the browser renderer.
 * This is an isolated identity/geometry/art acceptance harness, not an API game.
 * It opens only its own loopback static server and closes it on every exit.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)), PUBLIC = join(ROOT, 'worker/public');
const args = process.argv.slice(2);
assert.ok(args.every(arg => /^--(?:smoke|fixtures=.+|out=.+)$/.test(arg)), 'Use [--smoke] [--fixtures=path] [--out=path]');
const smoke = args.includes('--smoke');
const chosen = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
const fixturePath = chosen('fixtures') || '.release-sync/skill-vfx-20261104/legacy-committed-service-events.json';
const out = resolve(ROOT, chosen('out') || '.release-sync/skill-vfx-20261104/identity-browser-' + new Date().toISOString().replace(/[:.]/g, '-'));
const digest = data => createHash('sha256').update(data).digest('hex');
const normalized = path => path.replaceAll('\\', '/');
function inside(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));
}
assert.ok(inside(ROOT, out), 'Evidence must remain inside this worktree.');
const require = createRequire(import.meta.url);
const runtimeRoots = [
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,
  resolve(ROOT, '.release-sync/browser-tools/node_modules'),
  resolve(ROOT, '../star-journal-scene-integration-20261104/.release-sync/browser-tools/node_modules'),
].filter(Boolean);
let playwright;
for (const root of runtimeRoots) { try { playwright = require(join(root, 'playwright')); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; } }
if (!playwright) playwright = require('playwright');

const HERO_ART = {
  sword: '/art/v2/hero_sword_f.webp', archer: '/art/v2/hero_archer_f.webp',
  mage: '/art/v2/hero_mage_f.webp', thief: '/art/thief-20261015/thief_f/character.webp',
};
const MONSTER_ART = ['/art/v2/mon_temple_statue.webp', '/art/v2/mon_bronze_guard.webp'];
const STYLE = [
  '*{box-sizing:border-box}html,body{margin:0;background:#080e19;color:#edf1f7;font-family:"Segoe UI","Microsoft JhengHei",sans-serif}',
  'body{padding:24px}header{max-width:1184px;margin:0 auto 16px}.kicker{font-size:10px;letter-spacing:3px;color:#d5ba7b;font-weight:700}',
  'h1{font-size:26px;line-height:1.25;margin:10px 0 6px;font-weight:650}.subtitle{font-size:12px;line-height:1.5;color:#8193aa}',
  '#stage{position:relative;overflow:hidden;width:100%;max-width:1184px;height:530px;margin:auto;border:1px solid #2b374c;border-radius:18px;',
  'background:radial-gradient(ellipse at 48% 70%,#20334a55,transparent 58%),linear-gradient(160deg,#121d30,#090f1d 65%)}',
  '#stage:before{content:"";position:absolute;inset:68% 0 0;background:repeating-linear-gradient(90deg,transparent 0 77px,#67849b12 78px 79px),linear-gradient(#13223588,#080e18);border-top:1px solid #61768b20}',
  '.entity{position:absolute;width:136px;height:176px;transform:translate(-50%,-50%);object-fit:contain;object-position:50% 100%;filter:drop-shadow(0 10px 11px #0007);z-index:2}',
  '.entity.enemy{width:138px;height:170px}.entity.sentinel{opacity:.38;width:120px;height:148px}',
  '.entity-label{position:absolute;transform:translate(-50%,-50%);font-size:9px;color:#9aadc2;letter-spacing:.5px;text-align:center;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:3}',
  '.stage-note{position:absolute;left:20px;top:17px;font-size:10px;letter-spacing:1.3px;color:#8396af;z-index:20}',
  '#badge{position:absolute;right:17px;top:15px;padding:6px 9px;font-size:10px;letter-spacing:.7px;background:#283d4966;border:1px solid #628c7f55;border-radius:5px;color:#b4dfcd;z-index:20}',
  'footer{max-width:1184px;margin:14px auto 0;display:flex;justify-content:space-between;gap:14px;font-size:10px;line-height:1.6;color:#74869f}',
  '#identity{color:#b4c0d0;word-break:break-all}',
  '@media(max-width:600px){body{padding:12px}h1{font-size:22px}#stage{height:545px;border-radius:14px}.entity{width:88px;height:128px}.entity.enemy{width:88px;height:122px}.entity.sentinel{width:80px;height:102px}.stage-note{font-size:8px;left:12px;top:12px}#badge{font-size:8px;right:10px;top:10px}.entity-label{font-size:8px;max-width:95px}footer{display:block;font-size:9px}}',
].join('');

function installQa({ Engine, Legacy, catalog, heroArt, monsterArt }) {
  const stage = document.querySelector('#stage'), title = document.querySelector('#title');
  const identity = document.querySelector('#identity'), badge = document.querySelector('#badge');
  const known = new Map(catalog.skills.map(skill => [skill.id, skill]));
  let current = null, last = null;
  const fail = message => { throw new Error(message); };
  const close = () => { current?.destroy(); current = null; stage.querySelectorAll('.entity,.entity-label').forEach(node => node.remove()); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const frames = async n => { for (let i = 0; i < n; i++) await frame(); };
  const samePoint = (a, b) => Math.abs(a.x - b.x) < .01 && Math.abs(a.y - b.y) < .01;
  function image(source, id, role, x, y, label) {
    const node = document.createElement('img'); node.className = 'entity ' + role;
    node.dataset.targetId = id; node.src = source; node.alt = role + ':' + id;
    node.style.left = x + '%'; node.style.top = y + '%'; stage.append(node);
    const text = document.createElement('div'); text.className = 'entity-label'; text.textContent = label;
    text.style.left = x + '%'; text.style.top = (y + (innerWidth < 600 ? 14 : 20)) + '%'; stage.append(text);
    return node;
  }
  function pixels() {
    const canvas = stage.querySelector('canvas.legacy-skill-vfx');
    if (!canvas) return { pixels: 0, hash: 0, bbox: null };
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0, hash = 2166136261, left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let offset = 3, pixel = 0; offset < data.length; offset += 4, pixel++) {
      const alpha = data[offset];
      if (alpha > 5) { count++; const x = pixel % canvas.width, y = Math.floor(pixel / canvas.width); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      hash = Math.imul((hash ^ alpha) >>> 0, 16777619) >>> 0;
    }
    return { pixels: count, hash, bbox: count ? { left, top, right, bottom } : null, width: canvas.width, height: canvas.height };
  }
  async function run(input) {
    close(); const raw = input.event, skill = known.get(raw.skillId); if (!skill) fail('Unknown identity');
    title.textContent = skill.name; identity.textContent = raw.skillId;
    badge.textContent = raw.presentationMode + ' / ' + raw.source;
    const phone = innerWidth < 600, nodes = new Map();
    const actor = image(heroArt[skill.baseClass], raw.actorId, 'actor', phone ? 24 : 23, 58, '施法者');
    nodes.set(raw.actorId, actor);
    const enemies = new Set(raw.enemyTargetIds || (raw.targetKind === 'enemy' ? raw.targetIds : []));
    const required = [...new Set([...raw.targetIds, ...(raw.recipientEffects || []).flatMap(effect => effect.targetIds)])];
    const enemyIds = required.filter(id => enemies.has(id)), allyIds = required.filter(id => id !== raw.actorId && !enemies.has(id));
    enemyIds.forEach((id, index) => {
      const count = enemyIds.length, x = phone ? 62 + (index % 2) * 20 : 65 + (index % 3) * 12;
      const y = count > 3 ? 29 + Math.floor(index / (phone ? 2 : 3)) * 25 : 43 + (index % 2) * 22;
      nodes.set(id, image(monsterArt[index % monsterArt.length], id, 'enemy', x, y, '命中目標 ' + (index + 1)));
    });
    allyIds.forEach((id, index) => {
      const x = phone ? 53 + (index % 2) * 25 : 43 + (index % 3) * 16;
      const y = phone ? 31 + Math.floor(index / 2) * 30 : 33 + Math.floor(index / 3) * 35;
      nodes.set(id, image(heroArt[['sword','archer','mage','thief'][(index + 1) % 4]], id, 'ally', x, y, '受益隊友 ' + (index + 1)));
    });
    const sentinel = image(monsterArt[1], 'qa:unrelated', 'sentinel', phone ? 82 : 91, 81, '未被指定');
    nodes.set('qa:unrelated', sentinel);
    await Promise.all([...nodes.values()].map(node => node.decode()));
    if ([...nodes.values()].some(node => !node.naturalWidth)) fail('Actor/target art unavailable');
    const geometry = Legacy.legacyDomGeometry(stage, actor, [...nodes].map(([id, node]) => ({ id, node })), { actorId: raw.actorId });
    const plan = Legacy.planLegacyVfx(raw, geometry, catalog, { allowProjection: raw.source === 'deterministic-projection' });
    if (!plan.accepted) fail('Descriptor rejected: ' + plan.reason);
    const points = new Map(geometry.targets.map(target => [target.id, target.point]));
    const expectedIds = [...raw.targetIds, ...(raw.recipientEffects || []).flatMap(effect => effect.targetIds)];
    if (JSON.stringify(plan.targetIds) !== JSON.stringify(expectedIds)) fail('Target IDs changed');
    if (plan.targetIds.includes('qa:unrelated')) fail('Unrelated target was invented');
    for (const command of plan.commands) {
      if (command.presentationMode === 'support') {
        if (!command.recipientId || !expectedIds.includes(command.recipientId)) fail('Unknown support recipient');
        if (!samePoint(command.from, points.get(command.recipientId)) || !samePoint(command.to, points.get(command.recipientId))) fail('Support origin is not its real recipient');
      } else if (command.presentationMode === 'full' || command.presentationMode === 'impact') {
        if (!samePoint(command.to, points.get(raw.targetIds[0]))) fail('Enemy endpoint drifted');
        if (JSON.stringify(command.targets) !== JSON.stringify(raw.targetIds.map(id => points.get(id)))) fail('Enemy target points changed');
      } else if (command.presentationMode === 'summon') {
        if (raw.enemyTargetIds?.length || Number(skill.mechanics?.coefficient) !== 0) fail('Summoning invents immediate enemy damage');
      }
      if (command.presentationMode === 'support' || command.presentationMode === 'summon') {
        const observed = Engine.buildEffectFrame(skill, .66, command);
        for (const element of [...observed.layers, ...observed.geometry]) {
          if (typeof element.x === 'number' && Math.hypot(element.x - command.from.x, element.y - command.from.y) > command.bodyHeight * 1.65) fail('Non-damage visual escaped its beneficiary');
        }
      }
    }
    const removed = expectedIds[0];
    if (removed && Legacy.planLegacyVfx(raw, { ...geometry, targets: geometry.targets.filter(target => target.id !== removed) }, catalog, { allowProjection: true }).accepted) fail('Missing geometry was guessed');
    let actualPlayer = null;
    current = await Legacy.createLegacyVfxLayer(stage, {
      catalog, mode: ['idle','pk','boss','party','star-ring'].includes(input.sourceMode) ? input.sourceMode : 'party',
      contextKey: 'identity-qa:' + input.caseId, allowProjection: raw.source === 'deterministic-projection',
      playerFactory(canvas, options) { actualPlayer = Engine.createVfxPlayer(canvas, options); return actualPlayer; },
    });
    if (!current || !await current.prepare([raw])) fail('Failed to prepare VFX');
    const played = await current.play(raw, geometry); if (!played.accepted) fail('Player rejected: ' + played.reason);
    await frames(2); const firstPixels = pixels(), firstStats = current.stats();
    await frames(2); const secondPixels = pixels(), secondStats = current.stats();
    if (!secondStats.drawFrames || secondStats.drawCalls <= 0 || secondStats.lastRender?.manual || !secondPixels.pixels) fail('No actual animated Canvas draw');
    if (firstPixels.hash === secondPixels.hash) fail('Animation did not progress across browser frames');
    const commandCount = secondStats.commands;
    const duplicate = await current.play(raw, geometry);
    if (duplicate.accepted || duplicate.reason !== 'duplicate-event' || current.stats().commands !== commandCount) fail('Duplicate event replayed');
    if (input.capture) {
      // Actual RAF animation was verified above. Capture an explicit fixed
      // phase separately, so a busy software renderer cannot miss a short clip.
      const canvas = stage.querySelector('canvas.legacy-skill-vfx');
      const composite = document.createElement('canvas'); composite.width = canvas.width; composite.height = canvas.height;
      const merged = composite.getContext('2d');
      for (const command of plan.commands) {
        const rendered = await actualPlayer.renderFrame({ ...command, progress: .66 });
        if (!rendered.accepted || rendered.drawCalls <= 0) fail('Controlled representative frame was empty');
        merged.drawImage(canvas, 0, 0);
      }
      const context = canvas.getContext('2d'); context.save(); context.setTransform(1,0,0,1,0,0);
      context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(composite,0,0); context.restore();
      badge.textContent += ' / frame 0.66';
      if (!pixels().pixels) fail('Representative composition is empty');
    }
    last = {
      id: raw.skillId, caseId: input.caseId, sourceMode: input.sourceMode, presentationMode: raw.presentationMode,
      expectedIds, geometry, playerCommands: current.stats().lastEvent?.commands, commandCount,
      live: { firstPixels, secondPixels, drawFrames: secondStats.drawFrames, drawCalls: secondStats.drawCalls, animated: firstPixels.hash !== secondPixels.hash, manual: false },
      snapshotPixels: pixels(), captureMode: input.capture ? 'controlled-frame' : 'actual-raf', captureProgress: input.capture ? .66 : null,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      viewport: { width: innerWidth, height: innerHeight },
    };
    return last;
  }
  async function cleanup() {
    if (!current) return { cleared: true, destroyed: true, activeLayers: Legacy.inspectLegacyVfx().active.length };
    current.clear('identity-qa-cleanup');
    const cleared = current.stats().player.active === 0 && pixels().pixels === 0;
    current.destroy(); current = null; await frames(1);
    const activeLayers = Legacy.inspectLegacyVfx().active.length, canvases = stage.querySelectorAll('canvas.legacy-skill-vfx').length;
    if (!cleared || activeLayers || canvases) fail('VFX lifecycle leaked');
    return { cleared, destroyed: true, activeLayers, canvases };
  }
  window.SkillVfxIdentityQA = Object.freeze({ run, cleanup, inspect: () => ({ last, layer: current?.stats() || null }) });
}
function pageHtml() {
  return ['<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>StarJournal 技能事件重播驗收</title><style>' + STYLE + '</style>',
    '<header><div class="kicker">STARJOURNAL / SKILL VFX</div><h1 id="title">技能事件重播</h1><div class="subtitle">已記錄的真實技能事件 · 受控 DOM 場景 · 現有透明美術素材</div></header>',
    '<main id="stage"><div class="stage-note">RECEIPT REPLAY · LOCAL PRESENTATION QA</div><div id="badge"></div></main>',
    '<footer><div id="identity"></div><div>此頁驗證逐技能呈現與目標座標；完整遊戲流程另行驗收。</div></footer>',
    '<script type="module">',
    'import * as Engine from "/skill-vfx-engine.mjs";import * as Legacy from "/skill-vfx-legacy.mjs";',
    'const catalog=await (await fetch("/skill-vfx-catalog.json")).json();',
    '(' + installQa.toString() + ')({Engine,Legacy,catalog,heroArt:' + JSON.stringify(HERO_ART) + ',monsterArt:' + JSON.stringify(MONSTER_ART) + '});',
    '</script></html>'].join('\n');
}
const MIME = { '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const sourceFiles = [], errors = [], badResponses = [], cases = [], screenshots = [], extras = [];
let browser = null, server = null, origin = null, report = null, failure = null;
try {
  await mkdir(join(out, 'families'), { recursive: true }); await mkdir(join(out, 'mobile'), { recursive: true });
  const fixtureFull = resolve(ROOT, fixturePath); assert.ok(inside(ROOT, fixtureFull), 'Fixture must stay in worktree');
  const fixture = JSON.parse(await readFile(fixtureFull, 'utf8'));
  assert.equal(fixture.schemaVersion, 1); assert.equal(fixture.status, 'passed');
  assert.ok(fixture.sourceFiles?.length, 'Fixture lacks source fingerprints');
  const catalog = JSON.parse(await readFile(join(PUBLIC, 'skill-vfx-catalog.json'), 'utf8'));
  const skills = catalog.skills.filter(skill => ['native', 'special'].includes(skill.system));
  assert.equal(skills.length, 184);
  const indexed = new Map();
  for (const skill of skills) {
    const observed = fixture.cases.flatMap(c => (c.events || []).filter(e => e.skillId === skill.id && e.kind === 'cast').map(event => ({ fixtureCaseId: c.id, sourceMode: c.mode, evidenceKind: c.evidenceKind, event })));
    assert.ok(observed.length, 'Missing real cast fixture: ' + skill.id);
    indexed.set(skill.id, observed.find(c => c.sourceMode === 'idle') || observed[0]);
  }
  const smokeIds = ['native:sword:base','native:archer:base','native:mage:base','native:thief:base','special:skill_09_1','special:skill_18_1','special:skill_23_2','special:skill_24_2'];
  const selected = smoke ? skills.filter(skill => smokeIds.includes(skill.id)) : skills;
  const families = new Map();
  for (const skill of selected) if (!families.has(skill.family)) families.set(skill.family, skill.id);
  if (selected.some(skill => skill.id === 'special:skill_18_1')) families.set('summon', 'special:skill_18_1');
  const sourcePaths = [...new Set([
    normalized(relative(ROOT, fixtureFull)), 'worker/tools/skill-vfx-identity-browser.mjs',
    'worker/public/skill-vfx-legacy.mjs', 'worker/public/skill-vfx-engine.mjs', 'worker/public/skill-vfx-semantics.mjs', 'worker/public/art/skill-vfx-20261104/semantic-atlas.webp', 'worker/public/skill-vfx-catalog.json',
    ...fixture.sourceFiles.map(file => file.path),
    ...Object.values(HERO_ART).map(path => 'worker/public' + path), ...MONSTER_ART.map(path => 'worker/public' + path),
    ...['sword-atlas.webp','archer-atlas.webp','mage-atlas.webp','thief-atlas.webp','hawk.webp','fire-spirit.webp','semantic-atlas.webp'].map(name => 'worker/public/art/skill-vfx-20261104/' + name),
  ])].sort();
  for (const path of sourcePaths) {
    const bytes = await readFile(resolve(ROOT, path)); sourceFiles.push({ path, sha256: digest(bytes), bytes: bytes.length });
  }
  const sourceHash = new Map(sourceFiles.map(file => [file.path, file.sha256]));
  const staleFixtures = fixture.sourceFiles.filter(file => sourceHash.get(file.path) !== file.sha256);
  assert.equal(staleFixtures.length, 0, 'Fixture is stale for: ' + staleFixtures.map(file => file.path).join(', '));
  const screenshotFiles = new Map();
  const staticAllow = new Set(['/skill-vfx-engine.mjs','/skill-vfx-semantics.mjs','/skill-vfx-legacy.mjs','/skill-vfx-catalog.json',
    ...Object.values(HERO_ART), ...MONSTER_ART,
    ...['sword-atlas.webp','archer-atlas.webp','mage-atlas.webp','thief-atlas.webp','hawk.webp','fire-spirit.webp','semantic-atlas.webp'].map(name => '/art/skill-vfx-20261104/' + name)]);
  let gallery = '';
  server = createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (pathname === '/' || pathname === '/gallery') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : pathname === '/' ? pageHtml() : gallery); return;
      }
      let full;
      if (screenshotFiles.has(pathname)) full = screenshotFiles.get(pathname);
      else if (staticAllow.has(pathname)) full = join(PUBLIC, pathname.slice(1));
      else { res.writeHead(404); res.end(); return; }
      const actual = await realpath(full);
      assert.ok(inside(PUBLIC, actual) || inside(out, actual), 'Static containment failed');
      const bytes = await readFile(actual);
      res.writeHead(200, { 'content-type': MIME[extname(actual)] || 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'private, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) { res.writeHead(500); res.end(String(error.message)); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright.chromium.launch({
    ...(process.env.ATLAS_BROWSER_EXECUTABLE ? { executablePath: process.env.ATLAS_BROWSER_EXECUTABLE } : { channel: 'chrome' }),
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack }));
  page.on('response', response => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.SkillVfxIdentityQA);
  const browserVersion = await browser.version();
  async function runCase(skill, { variant = 'desktop', capture = false } = {}) {
    const fixtureCase = indexed.get(skill.id), caseId = skill.id + ':' + variant;
    const result = await page.evaluate(input => window.SkillVfxIdentityQA.run(input), {
      caseId, sourceMode: fixtureCase.sourceMode, event: fixtureCase.event, capture,
    });
    let screenshot = null;
    if (capture) {
      const safe = skill.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + variant + '.png';
      screenshot = (variant === 'desktop' ? 'families/' : 'mobile/') + safe;
      await page.screenshot({ path: join(out, screenshot), fullPage: true });
      screenshots.push({ skillId: skill.id, name: skill.name, family: skill.family, variant, path: screenshot });
      screenshotFiles.set('/__shot/' + safe, join(out, screenshot));
    }
    const cleanup = await page.evaluate(() => window.SkillVfxIdentityQA.cleanup());
    assert.ok(cleanup.cleared && cleanup.destroyed && cleanup.activeLayers === 0);
    return { ...result, id: caseId, mode: 'identity-replay', evidenceKind: 'browser-receipt-replay', status: 'passed',
      fixtureCase: { id: fixtureCase.fixtureCaseId, mode: fixtureCase.sourceMode, evidenceKind: fixtureCase.evidenceKind, path: fixturePath },
      events: [fixtureCase.event], skillId: skill.id, family: skill.family, variant, cleanup, screenshot };
  }
  for (const skill of selected) {
    const capture = families.get(skill.family) === skill.id || ['special:skill_09_1','special:skill_23_2','special:skill_24_2'].includes(skill.id);
    cases.push(await runCase(skill, { capture }));
    if (cases.length % 24 === 0 || cases.length === selected.length) console.log(JSON.stringify({ stage: 'identities', completed: cases.length, total: selected.length }));
  }
  const phoneIds = ['native:sword:A1','native:archer:A2','native:mage:B2','native:thief:A2','special:skill_09_1','special:skill_18_1','special:skill_23_2','special:skill_24_2'];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of phoneIds.filter(id => !smoke || smokeIds.includes(id))) extras.push(await runCase(skills.find(skill => skill.id === id), { variant: 'phone', capture: true }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const id of ['native:sword:base','native:mage:base','special:skill_18_1','special:skill_23_2']) extras.push(await runCase(skills.find(skill => skill.id === id), { variant: 'reduced', capture: true }));
  assert.equal(errors.length, 0, 'Page errors'); assert.equal(badResponses.length, 0, 'HTTP failures');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setViewportSize({ width: 1280, height: 900 });
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const cards = screenshots.map(shot => '<article><img src="/__shot/' + escape(shot.path.split('/').pop()) + '"><div><strong>' + escape(shot.name) + '</strong><span>' + escape(shot.family + ' / ' + shot.variant) + '</span></div></article>').join('');
  gallery = '<!doctype html><meta charset="utf-8"><title>Skill VFX identity contact sheet</title><style>body{background:#080e19;color:#dfe7f2;font:14px "Segoe UI","Microsoft JhengHei",sans-serif;margin:0;padding:26px}h1{font-size:25px;margin:0 0 8px}.note{font-size:12px;color:#8397af;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}article{border:1px solid #29364b;background:#111b2b;border-radius:10px;overflow:hidden}img{display:block;width:100%;height:246px;object-fit:contain;background:#080e19}article div{padding:11px}strong{font-size:13px}span{display:block;color:#8195ae;font-size:11px;margin-top:4px}</style><h1>星穹之旅 · 全技能事件呈現驗收</h1><div class="note">' + selected.length + ' 個技能身份 / ' + families.size + ' 個 legacy 視覺家族；真提交收據重播、實際 Canvas 動畫、目標與受益者核對。這不是正式機驗收。</div><div class="grid">' + cards + '</div>';
  await page.goto(origin + '/gallery', { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(out, 'identity-contact-sheet.jpg'), type: 'jpeg', quality: 88, fullPage: true });
  assert.equal(errors.length, 0, 'Gallery page errors'); assert.equal(badResponses.length, 0, 'Gallery HTTP failures');
  const changedSources = [];
  for (const file of sourceFiles) if (digest(await readFile(resolve(ROOT, file.path))) !== file.sha256) changedSources.push(file.path);
  assert.deepEqual(changedSources, [], 'Source changed during browser acceptance');
  report = {
    schemaVersion: 1, status: smoke ? 'smoke-passed' : 'passed', generatedAt: new Date().toISOString(),
    scope: 'controlled-browser-receipt-replay', sourceFixture: fixturePath, sourceFiles,
    environment: { browser: browserVersion, renderer: 'headless Chrome / SwiftShader', origin, externalRequests: false, productionAccess: false, gameApiWrites: 0 },
    summary: { identities: cases.length, uniqueIdentities: new Set(cases.map(row => row.skillId)).size, visualFamilies: families.size,
      phoneCases: extras.filter(row => row.variant === 'phone').length, reducedMotionCases: extras.filter(row => row.variant === 'reduced').length,
      pageErrors: errors.length, httpErrors: badResponses.length, actualAnimatedDraw: cases.every(row => row.live.animated && row.live.secondPixels.pixels > 0),
      allCleaned: [...cases, ...extras].every(row => row.cleanup.cleared && row.cleanup.destroyed), screenshots: screenshots.length, changedSources },
    limitations: [
      'The inputs are completed local SQLite service/engine receipts; this controlled DOM replay is not a full MiniApp API interaction.',
      'Existing base character portraits and representative existing monster art verify DOM geometry; this does not approve every class skin or actor animation.',
      'Representative screenshots are explicitly controlled progress 0.66 frames composed from the same accepted commands; actual RAF animation is verified separately before capture.',
      'Headless Chrome/mobile viewport and reduced-motion samples do not establish physical GPU or Telegram-host performance.',
      'Legacy families exclude Atlas-only beam/bleed; Atlas scene tests and the earlier full catalogue workshop cover those separate paths.',
    ],
    cases, extraCases: extras, screenshots, errors, badResponses,
  };
} catch (error) {
  failure = error;
  report = { schemaVersion: 1, status: 'failed', generatedAt: new Date().toISOString(), scope: 'controlled-browser-receipt-replay',
    sourceFixture: fixturePath, sourceFiles, summary: { completed: cases.length, extraCompleted: extras.length }, cases, extraCases: extras,
    screenshots, errors, badResponses, failure: { message: error.message, stack: error.stack } };
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  await mkdir(out, { recursive: true }); await writeFile(join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  if (!smoke && report?.status === 'passed') await writeFile(join(ROOT, '.release-sync/skill-vfx-20261104/legacy-coverage-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report?.status, output: normalized(relative(ROOT, out)), summary: report?.summary, error: failure?.message }));
}
if (failure) { console.error(failure.stack); process.exitCode = 1; }
