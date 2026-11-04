// Read-only local progress checkpoint. Does not test, edit source, commit or deploy.
// node worker/tools/checkpoint-progress.mjs --root=D:/StarJournal --worktree=...
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const runFile = promisify(execFile);
const args = new Map();
for (const value of process.argv.slice(2)) {
  const match = /^--(root|worktree|git)=(.+)$/.exec(value);
  if (!match || args.has(match[1])) throw Error('Use --root=... [--worktree=...] [--git=...]');
  args.set(match[1], match[2]);
}
if (!args.has('root')) throw Error('An explicit local project root is required');
const root = await fs.realpath(path.resolve(args.get('root')));
const output = path.join(root, 'handoff', 'non-character');
const inside = (base, target) => { const rel = path.relative(base, target); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
await fs.mkdir(output, { recursive: true });
if (!inside(root, await fs.realpath(output))) throw Error('Handoff directory must stay inside project root');
const now = new Date(), generatedAt = now.toISOString();
const token = crypto.randomUUID(), lockDir = path.join(output, '.checkpoint.lock');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const text = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const clean = value => text(value).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n/g, '\n');
const cell = value => clean(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const list = values => (Array.isArray(values) && values.length ? values.map(value => '- ' + clean(value)).join('\n') : '- 尚未由人工記錄。');
async function readJson(file) {
  const stat = await fs.stat(file);
  if (stat.size > 1024 * 1024) throw Error('JSON input exceeds 1 MiB');
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}
async function atomic(file, bytes) {
  const temp = file + '.tmp-' + token;
  let handle;
  try {
    handle = await fs.open(temp, 'wx');
    await handle.writeFile(bytes, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function acquire() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: os.hostname(), token, startedAt: generatedAt }));
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner, stat;
      try { stat = await fs.stat(lockDir); owner = await readJson(path.join(lockDir, 'owner.json')); }
      catch (readError) { if (readError.code === 'ENOENT' && !stat) continue; }
      let reclaim = false;
      if (owner?.hostname === os.hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (processError) { reclaim = processError.code === 'ESRCH'; }
      } else if (!owner && stat && Date.now() - stat.mtimeMs > 10 * 60 * 1000) reclaim = true;
      if (!reclaim) return false;
      const stale = lockDir + '.stale-' + token;
      try { await fs.rename(lockDir, stale); await fs.rm(stale, { recursive: true }); }
      catch (renameError) { if (renameError.code !== 'ENOENT') return false; }
    }
  }
  return false;
}
function codeBlock(value) {
  const data = clean(value), tick = String.fromCharCode(96);
  const runs = data.match(new RegExp(tick + '+', 'g')) || [];
  const fence = tick.repeat(Math.max(3, ...runs.map(item => item.length + 1)));
  return fence + '\n' + data.trimEnd() + '\n' + fence;
}
async function gitSnapshot(worktree) {
  if (!worktree) return { error: '人工狀態未指定 worktree；未執行 Git 觀測。' };
  const candidate = path.resolve(worktree);
  if (!inside(root, candidate)) return { error: 'worktree 超出專案範圍；未讀取。' };
  let actual;
  try { actual = await fs.realpath(candidate); } catch { return { error: '指定 worktree 不存在。' }; }
  if (!inside(root, actual)) return { error: 'worktree 連結超出專案範圍；未讀取。' };
  const commands = [
    ['status', ['status', '--short', '--branch', '--untracked-files=normal']],
    ['recentCommits', ['log', '-5', '--no-show-signature', '--date=iso-strict', '--format=%h %cI %s']],
    ['unstagedDiffstat', ['diff', '--no-ext-diff', '--no-textconv', '--stat']],
    ['stagedDiffstat', ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--stat']],
    ['worktrees', ['worktree', 'list', '--porcelain']],
  ];
  const snapshot = { worktree: actual };
  for (const [key, command] of commands) {
    try {
      const result = await runFile(args.get('git') || 'git', ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', '-C', actual, ...command], {
        encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      });
      snapshot[key] = clean(result.stdout).slice(0, 20000);
      if (result.stdout.length > 20000) snapshot[key] += '\n[輸出超過 20,000 字，已截短]';
    } catch (error) { snapshot[key] = '[觀測失敗] ' + clean(error.stderr || error.message).slice(0, 1000); }
  }
  return snapshot;
}
const sensitive = /(^|[\\/])(?:\.env(?:[./\\]|$)|secrets?(?:[./\\]|$)|credentials?(?:[./\\]|$))|(?:\.local\.json|\.pem|\.key|\.p12|\.pfx)$/i;
function evidencePaths(status) {
  const all = [];
  for (const entry of Array.isArray(status.validation) ? status.validation : []) {
    const evidence = Array.isArray(entry?.evidence) ? entry.evidence : [entry?.evidence];
    for (const value of evidence) {
      const candidate = typeof value === 'string' ? value : value?.path;
      if (candidate && !all.includes(candidate)) all.push(candidate);
    }
  }
  return all.slice(0, 20);
}
function extractSummary(tail) {
  const rows = tail.split(/\r?\n/).map(line => line.trim());
  const summaries = rows.filter(line => /^(?:# |[ℹ✔✖]\s*)?(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms|duration)\s+[0-9]/i.test(line) || /^1\.\.[0-9]+$/.test(line));
  try {
    const value = JSON.parse(tail.replace(/^\uFEFF/, ''));
    const allowed = ['tests','suites','pass','passed','fail','failed','cancelled','skipped','todo','duration_ms','totalCases','casesPassed','casesFailed'];
    for (const source of [value, value?.summary, value?.totals]) if (source && typeof source === 'object') {
      for (const key of allowed) if (typeof source[key] === 'number') summaries.push(key + ': ' + source[key]);
      if (['pass','passed','fail','failed','running','pending'].includes(source.status)) summaries.push('status: ' + source.status);
    }
  } catch {}
  return [...new Set(summaries)].slice(-16);
}
async function observeEvidence(status) {
  const rows = [];
  for (const requested of evidencePaths(status)) {
    const row = { requested };
    rows.push(row);
    if (/^[a-z]+:\/\//i.test(requested) || sensitive.test(requested) || !/\.(?:log|txt|json|jsonl|tap)$/i.test(requested)) {
      row.note = '僅觀測專案內明確指定的非敏感驗收 log／JSON；此項保留人工引用，未讀取。'; continue;
    }
    const candidate = path.resolve(status.worktree || args.get('worktree') || root, requested);
    if (!inside(root, candidate)) { row.note = '超出專案範圍，未讀取。'; continue; }
    try {
      const actual = await fs.realpath(candidate);
      if (!inside(root, actual) || sensitive.test(actual)) { row.note = '實際路徑不符範圍，未讀取。'; continue; }
      const stat = await fs.stat(actual);
      if (!stat.isFile()) { row.note = '不是檔案。'; continue; }
      row.path = actual; row.modifiedAt = stat.mtime.toISOString(); row.bytes = stat.size;
      const length = Math.min(stat.size, 65536), handle = await fs.open(actual, 'r');
      let buffer;
      try {
        buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
        buffer = buffer.subarray(0, bytesRead);
      } finally { await handle.close(); }
      row.tailSha256 = sha(buffer); row.summary = extractSummary(buffer.toString('utf8'));
      if (!row.summary.length) row.note = '沒有可辨識的測試摘要；不推斷通過、失敗或完成。';
      row.tailOnly = stat.size > length;
    } catch (error) { row.note = error.code === 'ENOENT' ? '指定證據目前不存在。' : '讀取失敗：' + error.code; }
  }
  return rows;
}
async function main() {
  let status = {}, statusProblem = '';
  const statusPath = path.join(output, 'STATUS.json');
  try {
    status = await readJson(statusPath);
    if (status.schemaVersion !== 1 || typeof status.updatedAt !== 'string' || !Number.isFinite(Date.parse(status.updatedAt))) throw Error('Expected schemaVersion 1 and ISO updatedAt');
  } catch (error) { status = {}; statusProblem = error.code === 'ENOENT' ? 'STATUS.json 尚未建立；本次僅記錄觀測，沒有功能完成聲明。' : '人工狀態無法讀取：' + error.message; }
  const git = await gitSnapshot(status.worktree || args.get('worktree'));
  const evidence = await observeEvidence(status);
  let previous = null;
  try { previous = await readJson(path.join(output, 'CHECKPOINT_STATE.json')); } catch {}
  const parts = { semantic: sha(JSON.stringify({ status, statusProblem })), git: sha(JSON.stringify(git)), evidence: sha(JSON.stringify(evidence)) };
  const fingerprint = sha(JSON.stringify(parts));
  const changed = previous?.fingerprint !== fingerprint;
  const changeText = !previous ? '首次建立 checkpoint；尚無上一份可比較。' : changed
    ? '偵測到交接輸入變更：' + Object.keys(parts).filter(key => parts[key] !== previous.parts?.[key]).map(key => ({ semantic: '人工狀態', git: 'Git 工作樹觀測', evidence: '指定驗收紀錄' })[key]).join('、') + '。這不代表功能已完成。'
    : '未偵測新進展。人工語意狀態與本次觀測均未變更；排程時間更新不代表完成新的工作。';
  const lines = [
    '# 星穹之旅｜非角色整合交接',
    '',
    '- 本次 checkpoint：' + generatedAt,
    '- 人工語意最後更新：' + (status.updatedAt || '尚未記錄'),
    '- 上次成功 checkpoint：' + (previous?.generatedAt || '無'),
    '- 狀態來源：' + statusPath,
    '- 工作樹：' + (status.worktree || args.get('worktree') || '尚未指定'),
    '- 分支（人工記錄）：' + (status.branch || '尚未記錄'),
    '',
    changeText,
    '',
    '此檔由本機排程每 30 分鐘保存。排程只讀人工狀態、Git 摘要及指定驗收紀錄；不測試、不修改程式、不提交、不部署、不存取正式服務。電腦關機或使用者未登入時不執行；恢復登入後由 Windows 補執行已錯過的工作。',
    '',
  ];
  if (statusProblem) lines.push('## 來源問題', '', statusProblem, '');
  for (const [heading, value] of [['目前目標', status.objective], ['人工進度摘要', status.summary]]) lines.push('## ' + heading, '', clean(value) || '尚未由人工記錄。', '');
  for (const [heading, key] of [['已完成（人工確認）','completed'],['進行中','inProgress'],['未完成與限制','unfinished'],['下一步','nextSteps'],['工作邊界','constraints'],['新對話接續方式','resumeInstructions']]) lines.push('## ' + heading, '', list(status[key]), '');
  lines.push('## 驗收（人工記錄）', '', '| 項目 | 狀態 | 說明 | 證據 |', '| --- | --- | --- | --- |');
  for (const entry of Array.isArray(status.validation) ? status.validation : []) lines.push('| ' + [entry.name, entry.status, entry.detail, entry.evidence].map(cell).join(' | ') + ' |');
  if (!status.validation?.length) lines.push('| 尚未記錄 | 未知 | 不由 Git 推斷驗收結果 | |');
  lines.push('', '## 服務（人工記錄，未主動探測程序）', '', '| 名稱 | URL | PID | 說明 |', '| --- | --- | --- | --- |');
  for (const service of Array.isArray(status.services) ? status.services : []) lines.push('| ' + [service.name, service.url, service.pid, service.details].map(cell).join(' | ') + ' |');
  lines.push('', '## 交接參考', '');
  for (const ref of Array.isArray(status.references) ? status.references : []) lines.push('- ' + clean(ref.label) + '：' + clean(ref.path));
  lines.push('', '## 本次指定驗收紀錄觀測', '', '只列明確指定的本機驗收檔案及可辨識摘要。檔案可能仍在寫入；完成判斷以人工狀態為準。', '');
  const newest = evidence.filter(entry => entry.modifiedAt).sort((a,b) => b.modifiedAt.localeCompare(a.modifiedAt))[0];
  if (newest) lines.push('最近修改的指定紀錄：' + newest.path, '');
  if (!evidence.length) lines.push('沒有指定可觀測的驗收檔案。', '');
  for (const entry of evidence) {
    lines.push('### ' + clean(entry.requested), '');
    if (entry.modifiedAt) lines.push('- 檔案更新：' + entry.modifiedAt, '- 大小：' + entry.bytes + ' bytes；讀取末段最多 64 KiB。');
    if (entry.note) lines.push('- ' + entry.note);
    if (entry.summary?.length) lines.push('', codeBlock(entry.summary.join('\n')));
    lines.push('');
  }
  lines.push('## Git 唯讀觀測', '', '以下只說明工作樹狀態，不證明任何功能、驗收、合併或部署已完成。沒有讀取完整 diff、.env 或秘密檔案內容。', '');
  if (git.error) lines.push(git.error, '');
  for (const [key, heading] of [['status','Status'],['recentCommits','最近 5 筆提交'],['unstagedDiffstat','未暫存 diffstat'],['stagedDiffstat','已暫存 diffstat'],['worktrees','Worktrees']]) {
    if (key in git) lines.push('### ' + heading, '', codeBlock(git[key] || '(無)'), '');
  }
  const markdown = lines.join('\n') + '\n';
  const history = path.join(output, 'history');
  await fs.mkdir(history, { recursive: true });
  const historyPath = path.join(history, generatedAt.replace(/[:.]/g, '-') + '.md');
  await atomic(historyPath, markdown);
  await atomic(path.join(output, 'LATEST.md'), markdown);
  const state = { schemaVersion: 1, generatedAt, sourceUpdatedAt: status.updatedAt || null, statusProblem, changed, fingerprint, parts, historyPath, durationMs: Date.now() - now.getTime(), pid: process.pid };
  await atomic(path.join(output, 'CHECKPOINT_STATE.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, ...state, latestPath: path.join(output, 'LATEST.md') }));
}
if (!(await acquire())) console.log(JSON.stringify({ ok: true, skipped: 'overlapping_checkpoint', generatedAt }));
else {
  try { await main(); }
  catch (error) { console.error(JSON.stringify({ ok: false, generatedAt, error: error.message })); process.exitCode = 1; }
  finally {
    try { const owner = await readJson(path.join(lockDir, 'owner.json')); if (owner.token === token) await fs.rm(lockDir, { recursive: true }); } catch {}
  }
}
