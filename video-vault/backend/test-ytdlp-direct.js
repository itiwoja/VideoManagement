// test-ytdlp-direct.js
// extract.js の extractWithYtDlp を直接呼ばずに、spawn を裸で確認する debug 用

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const YT_DLP_PATH = 'C:\\Users\\1kkim\\projects\\yt-dlp.exe';
const TEST_URL = 'https://jp.spankbang.com/9kkbn/video/saddle';

process.stdout.write(`yt-dlp path: ${YT_DLP_PATH}\n`);
process.stdout.write(`exists: ${existsSync(YT_DLP_PATH)}\n`);

const child = spawn(
  YT_DLP_PATH,
  ['-j', '--no-warnings', '--no-playlist', '--socket-timeout', '15', TEST_URL],
  { windowsHide: true },
);

let stdout = '';
let stderr = '';

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});
child.on('error', (err) => {
  process.stderr.write(`spawn error: ${err.message}\n`);
});
child.on('close', (code) => {
  process.stdout.write(`exit code: ${code}\n`);
  process.stdout.write(`stdout length: ${stdout.length}\n`);
  process.stdout.write(`stderr: ${stderr.slice(0, 500)}\n`);
  if (stdout) {
    try {
      const data = JSON.parse(stdout);
      process.stdout.write(`title: ${data.title}\n`);
      process.stdout.write(`thumbnail: ${data.thumbnail}\n`);
      process.stdout.write(`formats count: ${(data.formats || []).length}\n`);
    } catch (err) {
      process.stdout.write(`json parse error: ${err.message}\n`);
      process.stdout.write(`stdout head: ${stdout.slice(0, 200)}\n`);
    }
  }
});
