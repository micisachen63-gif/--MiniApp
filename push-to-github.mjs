import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const GIT_EXE = 'C:/Users/User/Documents/ChatGPT/tools/git/cmd/git.exe';
const REPO_DIR = 'C:/Users/User/Documents/ChatGPT/star-journal-rpg';
const DEFAULT_URL = 'https://github.com/micisachen63-gif/--MiniApp.git';

console.log('============================================================');
console.log('  ✨ 星穹旅誌 (Star Journal RPG) - GitHub 專案推送工具');
console.log('============================================================\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  console.log('📌 預設遠端倉庫: ' + DEFAULT_URL);
  let url = await rl.question('👉 按 Enter 直接推送至預設倉庫，或貼上其他倉庫網址：\n> ');
  url = url.trim().replace(/^['"]|['"]$/g, '') || DEFAULT_URL;

  // Ensure .git extension if missing
  if (url.startsWith('https://github.com/') && !url.endsWith('.git')) {
    url += '.git';
  }

  console.log(`\n[1/3] 設定遠端倉庫 origin -> ${url}`);
  await execGit(['remote', 'remove', 'origin']).catch(() => {});
  await execGit(['remote', 'add', 'origin', url]);

  console.log('[2/3] 設定分支名稱為 main');
  await execGit(['branch', '-M', 'main']);

  console.log('[3/3] 開始推送至 GitHub（專案內含全套前端美術資源，上傳約需 1~3 分鐘，請保持網路連線）...\n');

  try {
    await execGitInherit(['push', '-u', 'origin', 'main']);
    console.log('\n============================================================');
    console.log('  🎉 恭喜！星穹旅誌所有程式碼已成功上傳至 GitHub！');
    console.log('============================================================');
  } catch (err) {
    console.log('\n⚠️ 上傳過程提示：');
    console.log('若提示輸入帳號密碼：');
    console.log('1. Username 請輸入您的 GitHub 使用者名稱。');
    console.log('2. Password 請輸入 GitHub Personal Access Token (PAT)，而不是原本的登入密碼。');
    console.log('   （Token 產生路徑：GitHub -> Settings -> Developer settings -> Personal access tokens）');
  }

  rl.close();
}

function execGit(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(GIT_EXE, args, { cwd: REPO_DIR, stdio: 'pipe', windowsHide: true });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d.toString());
    p.stderr.on('data', d => stderr += d.toString());
    p.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Git exit code ${code}: ${stderr || stdout}`));
    });
  });
}

function execGitInherit(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(GIT_EXE, args, { cwd: REPO_DIR, stdio: 'inherit', windowsHide: false });
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Git exited with code ${code}`));
    });
  });
}

main().catch(e => {
  console.error('\n執行錯誤:', e.message);
  rl.close();
});
