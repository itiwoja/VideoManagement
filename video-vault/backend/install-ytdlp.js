// install-ytdlp.js
// yt-dlp.exe を GitHub releases からダウンロードする (Node.js fetch)
// 使い方: node install-ytdlp.js

import { writeFile, stat } from 'node:fs/promises';

const TARGET = 'C:\\Users\\1kkim\\projects\\yt-dlp.exe';
const URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

try {
  process.stdout.write(`Downloading from ${URL}...\n`);
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) {
    process.stderr.write(`HTTP ${res.status} ${res.statusText}\n`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(TARGET, buf);
  const s = await stat(TARGET);
  process.stdout.write(`Downloaded ${s.size} bytes to ${TARGET}\n`);
} catch (err) {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
}
