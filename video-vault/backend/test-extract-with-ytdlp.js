// test-extract-with-ytdlp.js
// extract.js から extractMedia を呼んで、yt-dlp 経路がちゃんと動くか確認

import { extractMedia, extractMetadata } from './lib/extract.js';

const url = 'https://jp.spankbang.com/9kkbn/video/saddle';

process.stdout.write(`Testing ${url}\n`);

process.stdout.write('--- extractMedia ---\n');
try {
  const m = await extractMedia(url);
  process.stdout.write(JSON.stringify(m, null, 2) + '\n');
} catch (err) {
  process.stdout.write(`error: ${err.message}\n${err.stack}\n`);
}

process.stdout.write('--- extractMetadata ---\n');
try {
  const m = await extractMetadata(url);
  process.stdout.write(JSON.stringify(m, null, 2) + '\n');
} catch (err) {
  process.stdout.write(`error: ${err.message}\n${err.stack}\n`);
}
