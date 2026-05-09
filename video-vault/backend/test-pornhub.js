// pornhub URL で extract.js が何を返すか確認
import { extractMedia } from './lib/extract.js';

const urls = [
  'https://jp.pornhub.com/view_video.php?viewkey=ph625b15a9b8b8e', // sample format
];

// 引数があればそれを使う
if (process.argv[2]) urls[0] = process.argv[2];

for (const url of urls) {
  process.stdout.write(`\n=== ${url} ===\n`);
  try {
    const m = await extractMedia(url);
    if (!m) {
      process.stdout.write('media: null (extract failed)\n');
    } else {
      process.stdout.write(`url: ${m.url.slice(0, 200)}\n`);
      process.stdout.write(`mediaType: ${m.mediaType}\n`);
      process.stdout.write(`title: ${m.title}\n`);
      process.stdout.write(`poster: ${m.poster?.slice(0, 200)}\n`);
      if (m.httpHeaders) {
        process.stdout.write(`httpHeaders count: ${Object.keys(m.httpHeaders).length}\n`);
        for (const [k, v] of Object.entries(m.httpHeaders)) {
          process.stdout.write(`  ${k}: ${String(v).slice(0, 100)}\n`);
        }
      }
    }
  } catch (err) {
    process.stdout.write(`ERROR: ${err.message}\n${err.stack}\n`);
  }
}
