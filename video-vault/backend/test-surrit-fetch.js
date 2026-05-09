// Test if Node fetch can reach surrit.com with Referer (no Cloudflare impersonation)
const url = 'https://surrit.com/a16d9647-94e5-49f8-925a-85d2f1a8c8e8/playlist.m3u8';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

console.log('=== Test A: bare fetch ===');
try {
  const r = await fetch(url, { headers: { 'User-Agent': ua } });
  console.log(`status: ${r.status} ${r.statusText}`);
  console.log(`content-type: ${r.headers.get('content-type')}`);
  const txt = await r.text();
  console.log(`body (first 300 chars):\n${txt.slice(0, 300)}`);
} catch (e) {
  console.log(`ERR: ${e.message}`);
}

console.log('\n=== Test B: with Referer ===');
try {
  const r = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Referer': 'https://missav.ws/dm3/ja/mide-488-uncensored-leak',
      'Origin': 'https://missav.ws',
    },
  });
  console.log(`status: ${r.status} ${r.statusText}`);
  console.log(`content-type: ${r.headers.get('content-type')}`);
  const txt = await r.text();
  console.log(`body (first 300 chars):\n${txt.slice(0, 300)}`);
} catch (e) {
  console.log(`ERR: ${e.message}`);
}
