// test-extract.js
// extract.js を実機 URL で叩いて、何が拾えてるかを debug する。
// 使い方: node test-extract.js

import { extractMedia, extractMetadata } from './lib/extract.js';

const testUrls = [
  'https://jp.spankbang.com/9kkbn/video/saddle',
  'https://missav.ws/dm2/ja/midv-725-uncensored-leak',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // 確実に og 持ってる比較用
];

for (const url of testUrls) {
  process.stdout.write(`\n=== ${url} ===\n`);
  try {
    const meta = await extractMetadata(url);
    process.stdout.write(`metadata: ${JSON.stringify(meta, null, 2)}\n`);
  } catch (err) {
    process.stdout.write(`metadata ERROR: ${err.message}\n`);
  }
  try {
    const media = await extractMedia(url);
    process.stdout.write(`media: ${JSON.stringify(media, null, 2)}\n`);
  } catch (err) {
    process.stdout.write(`media ERROR: ${err.message}\n`);
  }
}
