/* Local-only visual QA for the skill VFX catalog.
 * Run after: node worker/tools/skill-vfx-preview-server.mjs
 * Optional: VFX_QA_DIR, VFX_PREVIEW_ORIGIN, VFX_EXPECTED_SKILLS,
 *           VFX_BROWSER_EXECUTABLE, CODEX_PRIMARY_RUNTIME_NODE_MODULES
 * --smoke checks 12 representative IDs; the default covers every catalog ID.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const roots = [
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,
  path.resolve('.release-sync/browser-tools/node_modules'),
].filter(Boolean);
let playwright;
for (const root of roots) {
  try { playwright = require(path.join(root, 'playwright')); break; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) playwright = require('playwright');

const parsedOrigin = new URL(process.env.VFX_PREVIEW_ORIGIN || 'http://127.0.0.1:9664');
const origin = parsedOrigin.origin;
assert.equal(parsedOrigin.protocol, 'http:');
assert.equal(parsedOrigin.hostname, '127.0.0.1');
assert.equal(parsedOrigin.port, '9664');
assert.equal(parsedOrigin.username, '');
assert.equal(parsedOrigin.password, '');
assert.equal(parsedOrigin.pathname, '/');
assert.equal(parsedOrigin.search, '');
const expectedCount = Number(process.env.VFX_EXPECTED_SKILLS || 196);
assert(Number.isSafeInteger(expectedCount) && expectedCount > 0);
const smoke = process.argv.includes('--smoke');
assert(process.argv.slice(2).every(arg => arg === '--smoke'), 'Only --smoke is supported.');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.VFX_QA_DIR || '.release-sync/skill-vfx-20261104/browser-' + stamp);
const directions = ['right', 'left', 'up', 'down'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const slug = value => String(value).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 140);

async function run() {
  await fs.mkdir(evidenceDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(), origin, mode: smoke ? 'smoke' : 'full',
    status: 'running', catalogIds: [], coverage: [], phaseChecks: [], mobileChecks: [], uiChecks: [],
    screenshots: [], pageErrors: [], httpErrors: [], consoleErrors: [],
    limitations: ['Local desktop Chrome with software rendering; not a Telegram device or mobile GPU benchmark.'],
  };
  let browser, page;
  try {
    const healthResponse = await fetch(origin + '/__vfx/health');
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert(health.ok && health.service === 'star-journal-skill-vfx' && health.readOnly
      && health.productionAccess === false && health.api === false && health.port === 9664,
    'The dedicated read-only VFX preview must be running on port 9664.');
    const executable = process.env.VFX_BROWSER_EXECUTABLE || process.env.ATLAS_BROWSER_EXECUTABLE;
    browser = await playwright.chromium.launch({
      ...(executable ? { executablePath: executable } : { channel: 'chrome' }),
      headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.pageErrors.push({ message: error.message, stack: error.stack }));
    page.on('response', response => {
      if (response.status() >= 400) report.httpErrors.push({ status: response.status(), url: response.url() });
    });
    page.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });
    await page.goto(origin + '/preview-skill-vfx.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__VFX_PREVIEW__?.inspect?.().ready === true, {}, { timeout: 45000 });
    const initial = await page.evaluate(() => window.__VFX_PREVIEW__.inspect());
    const ids = initial.catalogIds;
    assert(Array.isArray(ids), 'inspect().catalogIds must expose the full catalog independent of UI filters.');
    assert.equal(ids.length, expectedCount);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(initial.skillCount, ids.length);
    report.catalogIds = ids;
    const representatives = [...new Set(Array.from({ length: Math.min(12, ids.length) }, (_, index) =>
      ids[Math.round(index * (ids.length - 1) / Math.max(1, Math.min(12, ids.length) - 1))]))];
    const checkedIds = smoke ? representatives : ids;

    async function sample(id, direction, progress) {
      const result = await page.evaluate(async ({ id, direction, progress }) => {
        const qa = window.__VFX_PREVIEW__;
        if (qa.inspect().selectedSkillId !== id) await qa.selectSkill(id);
        await qa.setDirection(direction);
        await qa.seek(progress);
        await new Promise(resolve => requestAnimationFrame(resolve));
        const state = qa.inspect(), canvas = document.querySelector('[data-vfx-canvas]');
        if (!canvas) throw Error('VFX canvas is missing.');
        const context = canvas.getContext('2d');
        if (!context) throw Error('The VFX preview must expose a readable 2D canvas.');
        const width = canvas.width, height = canvas.height;
        if (width < 1 || height < 1 || width * height > 10000000) throw Error('Unexpected VFX canvas dimensions.');
        const pixels = context.getImageData(0, 0, width, height).data;
        let count = 0, minX = width, minY = height, maxX = -1, maxY = -1, signature = 2166136261;
        for (let offset = 3; offset < pixels.length; offset += 4) {
          if (pixels[offset] <= 8) continue;
          const index = (offset - 3) / 4, x = index % width, y = Math.floor(index / width);
          count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          signature = Math.imul(signature ^ (pixels[offset] + pixels[offset - 1] * 3 + pixels[offset - 2] * 5 + index), 16777619);
        }
        return {
          skillId: state.selectedSkillId, direction: state.direction, progress: state.progress,
          bodyHeight: state.bodyHeight, active: state.player?.active,
          nonTransparentPixels: count, signature: signature >>> 0,
          canvas: { width, height },
          bounds: count ? { left: minX, top: minY, right: maxX, bottom: maxY } : null,
          touchesEdge: count > 0 && (minX <= 1 || minY <= 1 || maxX >= width - 2 || maxY >= height - 2),
          recipe: state.recipe?.id || state.recipe?.kind || state.recipe?.family || null,
        };
      }, { id, direction, progress });
      assert.equal(result.skillId, id);
      assert.equal(result.direction, direction);
      assert(Number.isFinite(result.bodyHeight) && result.bodyHeight > 0);
      assert(Number.isInteger(result.active) && result.active >= 0 && result.active <= 8);
      return result;
    }
    async function screenshot(name) {
      const filename = name + '.png', target = path.join(evidenceDir, filename);
      await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
      report.screenshots.push(filename);
    }

    async function waitForSelection(id) {
      await page.waitForFunction(id => {
        const qa = window.__VFX_PREVIEW__, state = qa?.inspect();
        return state?.selectedSkillId === id && !state.error && document.querySelector('[data-loading]')?.hidden;
      }, id, { timeout: 15000 });
    }
    async function checkAudit(type, expectedCards, scope = '') {
      const button = page.locator((scope ? scope + ' ' : '') + '[data-audit="' + type + '"]:visible').first();
      await button.click();
      const dialog = page.locator('[data-audit-dialog]');
      assert(await dialog.isVisible(), type + ' audit did not open.');
      const count = await page.locator('[data-audit-content] .audit-grid > *').count();
      assert.equal(count, expectedCards, type + ' audit count differs from the catalog.');
      const title = await page.locator('[data-audit-title]').innerText();
      await page.locator('[data-close-dialog]').click();
      assert.equal(await dialog.isVisible(), false);
      report.uiChecks.push({ control: 'audit-dialog', type, title, cards: count, viewport: scope ? 'phone' : 'desktop', passed: true });
    }
    async function desktopControls() {
      await page.locator('[data-class="mage"]').click();
      assert.equal(await page.locator('[data-class="mage"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-system="native"]').click();
      assert.equal(await page.locator('[data-system="native"]').getAttribute('aria-pressed'), 'true');
      const item = page.locator('.skill-item[data-skill-id]').nth(1), id = await item.getAttribute('data-skill-id');
      const expectedName = await item.locator('strong').innerText();
      await item.click(); await waitForSelection(id);
      const selectedItem = page.locator('.skill-item[aria-current="true"]');
      assert.equal(await selectedItem.getAttribute('data-skill-id'), id);
      assert.equal(await selectedItem.locator('strong').count(), 1, 'Selecting a skill destroyed its name element.');
      assert.equal(await selectedItem.locator('strong').innerText(), expectedName, 'The selected name was overwritten by the footer ID.');
      const footerText = await page.locator('code[data-selected-skill-id]').innerText();
      assert.equal(footerText.split(' · ')[0], id, 'The dedicated footer does not display the selected skill ID.');
      report.uiChecks.push({ control: 'selected-skill-name-and-footer', skillId: id, name: expectedName, footerText, passed: true });
      report.uiChecks.push({ control: 'class-source-desktop-item', skillId: id, passed: true });
      await page.locator('[data-play]').click();
      await page.waitForFunction(() => window.__VFX_PREVIEW__.inspect().playing === true, {}, { timeout: 5000 });
      await sleep(100); await page.locator('[data-pause]').click();
      const paused = await page.evaluate(() => window.__VFX_PREVIEW__.inspect());
      assert.equal(paused.playing, false);
      report.uiChecks.push({ control: 'play-pause', progress: paused.progress, passed: true });
      const timeline = page.locator('[data-progress]');
      await timeline.scrollIntoViewIfNeeded();
      const track = await timeline.boundingBox();
      assert(track && track.width > 30);
      await page.mouse.move(track.x + track.width * .25, track.y + track.height / 2);
      await page.mouse.down();
      await page.mouse.move(track.x + track.width * .65, track.y + track.height / 2, { steps: 8 });
      await page.mouse.up();
      const scrubbed = await page.evaluate(() => window.__VFX_PREVIEW__.inspect());
      assert(scrubbed.progress > .58 && scrubbed.progress < .72, 'The actual timeline drag did not change the playhead.');
      await page.locator('[data-step]').click();
      const stepped = await page.evaluate(() => window.__VFX_PREVIEW__.inspect());
      assert(stepped.progress > scrubbed.progress);
      report.uiChecks.push({ control: 'timeline-drag-and-step', scrubbed: scrubbed.progress, stepped: stepped.progress, passed: true });
      await page.locator('[data-direction="up"]').click();
      assert.equal((await page.evaluate(() => window.__VFX_PREVIEW__.inspect())).direction, 'up');
      assert.equal(await page.locator('[data-direction="up"]').getAttribute('aria-pressed'), 'true');
      report.uiChecks.push({ control: 'direction-button', direction: 'up', passed: true });
      for (const background of ['light', 'checker']) {
        await page.locator('[data-bg]').selectOption(background);
        assert.equal(await page.locator('[data-stage]').getAttribute('data-background'), background);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        await screenshot('ui-background-' + background);
        report.uiChecks.push({ control: 'background-select', background, passed: true });
      }
      await page.locator('[data-bg]').selectOption('scene');
      await checkAudit('talents', 120);
      await checkAudit('supports', 6);
      await checkAudit('planned', 16);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    async function mobileControls() {
      await page.locator('[data-class="archer"]').click();
      const select = page.locator('[data-skill-select]');
      await select.waitFor({ state: 'visible', timeout: 5000 });
      const values = await select.locator('option').evaluateAll(options => options.map(option => option.value));
      assert(values.length >= 2);
      const id = values[1]; await select.selectOption(id); await waitForSelection(id);
      assert.equal(await select.inputValue(), id);
      report.uiChecks.push({ control: 'phone-skill-dropdown', skillId: id, passed: true });
      for (const [type, count] of [['talents', 120], ['supports', 6], ['planned', 16]]) {
        await checkAudit(type, count, '.mobile-audit-links');
      }
      await page.locator('[data-stage]').scrollIntoViewIfNeeded();
    }
    async function createFamilyContactSheet() {
      const contact = await page.evaluate(async () => {
        const catalog = await (await fetch('/skill-vfx-catalog.json')).json(), qa = window.__VFX_PREVIEW__;
        const families = new Map();
        for (const skill of catalog.skills) if (!families.has(skill.family)) families.set(skill.family, skill);
        const chosen = [...families.entries()], columns = 4, cellW = 440, cellH = 330, header = 84, footer = 34;
        const sheet = document.createElement('canvas');
        sheet.width = columns * cellW;
        sheet.height = header + Math.ceil(chosen.length / columns) * cellH + footer;
        const paint = sheet.getContext('2d');
        paint.fillStyle = '#080e18'; paint.fillRect(0, 0, sheet.width, sheet.height);
        paint.fillStyle = '#e4d8be'; paint.font = '600 26px "Microsoft JhengHei", sans-serif';
        paint.fillText('STAR JOURNAL / 技能特效 · ' + chosen.length + ' 種動作家族', 24, 38);
        paint.fillStyle = '#8ea0b5'; paint.font = '14px "Microsoft JhengHei", sans-serif';
        paint.fillText('實際播放器 Canvas｜命中後 +0.06 相位｜透明原圖於深底合成｜不含角色示意與遊戲結算', 24, 64);
        const entries = [];
        for (let index = 0; index < chosen.length; index++) {
          const [family, skill] = chosen[index];
          await qa.selectSkill(skill.id); await qa.setDirection('right');
          const recipe = qa.inspect().recipe;
          let progress = Number.isFinite(recipe?.impactAt) ? Math.min(.98, recipe.impactAt + .06) : .5;
          let bounds = null, pixels = 0, fallback = false;
          const canvas = document.querySelector('[data-vfx-canvas]');
          for (const attempt of [progress, .5]) {
            await qa.seek(attempt); await new Promise(resolve => requestAnimationFrame(resolve));
            const context = canvas.getContext('2d'), data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1; pixels = 0;
            for (let offset = 3; offset < data.length; offset += 4) {
              if (data[offset] <= 8) continue;
              const pixel = (offset - 3) / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
              pixels++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            }
            if (pixels) { bounds = { minX, minY, maxX, maxY }; progress = attempt; break; }
            fallback = true;
          }
          const x = index % columns * cellW + 10, y = header + Math.floor(index / columns) * cellH + 8;
          paint.fillStyle = '#101a29'; paint.fillRect(x, y, cellW - 20, cellH - 16);
          paint.strokeStyle = '#24374b'; paint.lineWidth = 1; paint.strokeRect(x + .5, y + .5, cellW - 21, cellH - 17);
          paint.fillStyle = '#eee2cc'; paint.font = '600 17px "Microsoft JhengHei", sans-serif';
          paint.fillText(family + ' · ' + skill.name, x + 14, y + 25, cellW - 48);
          paint.fillStyle = '#8ba0b8'; paint.font = '12px "Microsoft JhengHei", sans-serif';
          paint.fillText(skill.id + '  |  ' + Math.round(progress * 100) + '%', x + 14, y + 45, cellW - 48);
          if (bounds) {
            const sx = Math.max(0, bounds.minX - 18), sy = Math.max(0, bounds.minY - 18);
            const sw = Math.min(canvas.width, bounds.maxX + 19) - sx, sh = Math.min(canvas.height, bounds.maxY + 19) - sy;
            const availableW = cellW - 54, availableH = cellH - 90, scale = Math.min(availableW / sw, availableH / sh);
            const dw = sw * scale, dh = sh * scale, dx = x + (cellW - 20 - dw) / 2, dy = y + 57 + (availableH - dh) / 2;
            paint.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
          } else {
            paint.fillStyle = '#f5b8a0'; paint.font = '16px "Microsoft JhengHei", sans-serif';
            paint.fillText('此相位未出現可見像素，需人工核對', x + 25, y + 160, cellW - 70);
          }
          entries.push({ family, skillId: skill.id, name: skill.name, progress, fallback, pixels, bounds });
        }
        paint.fillStyle = '#8295ad'; paint.font = '12px "Microsoft JhengHei", sans-serif';
        paint.fillText('各格依實際特效 alpha 範圍裁切等比顯示；此圖用於辨識素材、語意與透明邊緣，格間比例不同。', 24, sheet.height - 12);
        return { png: sheet.toDataURL('image/png'), entries, width: sheet.width, height: sheet.height };
      });
      const filename = 'family-contact-sheet.png';
      await fs.writeFile(path.join(evidenceDir, filename), Buffer.from(contact.png.split(',')[1], 'base64'));
      report.familyContactSheet = { filename, entries: contact.entries, width: contact.width, height: contact.height };
      report.screenshots.push(filename);
      assert.equal(contact.entries.length, 28, 'The contact sheet does not contain all 28 catalog families.');
      assert(contact.entries.every(value => value.pixels > 0), 'One or more family contact cells are empty.');
    }

    await desktopControls();
    for (let index = 0; index < checkedIds.length; index++) {
      const id = checkedIds[index], rows = [];
      for (const direction of directions) {
        let value = await sample(id, direction, .5);
        // A short effect can legitimately have dissipated by the midpoint.
        if (!value.nonTransparentPixels) {
          for (const phase of [.18, .32, .68]) {
            const candidate = await sample(id, direction, phase);
            if (candidate.nonTransparentPixels) { value = candidate; break; }
          }
        }
        assert(value.nonTransparentPixels > 0, 'No visible effect for ' + id + ' / ' + direction);
        rows.push(value);
      }
      assert(rows.every(row => Math.abs(row.bodyHeight - rows[0].bodyHeight) < .001), 'Direction changed the scale of ' + id);
      report.coverage.push(...rows);
      if ((index + 1) % 24 === 0 || index + 1 === checkedIds.length) {
        console.log(JSON.stringify({ stage: 'catalog-directions', done: index + 1, total: checkedIds.length, cases: report.coverage.length }));
      }
    }
    for (const id of representatives) {
      const phases = [];
      for (const progress of [.18, .5, .82]) phases.push(await sample(id, 'right', progress));
      assert(phases.some(value => value.nonTransparentPixels > 0), 'Representative effect is empty: ' + id);
      assert(new Set(phases.map(value => value.signature)).size > 1, 'Animation does not change across phases: ' + id);
      report.phaseChecks.push({ skillId: id, phases });
      await sample(id, 'right', .5);
      await screenshot('desktop-' + slug(id));
    }
    await createFamilyContactSheet();
    await page.setViewportSize({ width: 390, height: 844 });
    await mobileControls();
    const mobileIds = [...new Set([ids[0], ids[Math.floor(ids.length / 3)], ids[Math.floor(ids.length * 2 / 3)], ids[ids.length - 1]])];
    for (const id of mobileIds) {
      const rows = [];
      for (const direction of directions) rows.push(await sample(id, direction, .5));
      assert(rows.every(row => Math.abs(row.bodyHeight - rows[0].bodyHeight) < .001), 'Mobile direction changed scale: ' + id);
      report.mobileChecks.push(...rows);
      await sample(id, 'down', .5);
      await page.locator('[data-stage]').scrollIntoViewIfNeeded();
      await screenshot('phone-' + slug(id));
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(async id => {
      const qa = window.__VFX_PREVIEW__;
      await qa.selectSkill(id); await qa.setDirection('right'); await qa.play();
    }, ids[0]);
    await sleep(750);
    const reduced = await page.evaluate(() => window.__VFX_PREVIEW__.inspect());
    assert.equal(reduced.player.active, 0, 'Reduced-motion playback did not finish within its bounded duration.');
    report.reducedMotion = { activeAfter750ms: reduced.player.active, player: reduced.player };
    const cleanup = await page.evaluate(async () => {
      const qa = window.__VFX_PREVIEW__; await qa.destroy(); return qa.inspect();
    });
    assert.equal(cleanup.player.active, 0, 'Destroyed preview retained active effects.');
    report.cleanup = cleanup.player;
    assert.equal(report.pageErrors.length, 0, 'Browser page errors were recorded.');
    assert.equal(report.httpErrors.length, 0, 'Asset or page HTTP errors were recorded.');
    report.status = 'passed';
    report.summary = {
      catalogSkills: ids.length, checkedSkills: checkedIds.length, directionCases: report.coverage.length,
      representativePhaseCases: report.phaseChecks.reduce((sum, value) => sum + value.phases.length, 0),
      mobileCases: report.mobileChecks.length,
      edgeTouchCases: report.coverage.filter(value => value.touchesEdge).length,
      pageErrors: report.pageErrors.length, httpErrors: report.httpErrors.length,
    };
  } catch (error) {
    report.status = 'failed';
    report.failure = { message: error.message, stack: error.stack };
    if (page) {
      try { await page.screenshot({ path: path.join(evidenceDir, 'failure.png'), fullPage: false }); report.screenshots.push('failure.png'); }
      catch (_) { /* Preserve the first failure. */ }
    }
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(evidenceDir, 'results.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    if (browser) await browser.close();
    console.log(JSON.stringify({ status: report.status, summary: report.summary || null, failure: report.failure?.message || null, evidenceDir }));
  }
}
run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
