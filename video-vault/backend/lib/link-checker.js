// lib/link-checker.js
// 保存済み URL がまだ生きているかを確認する (#8 リンク切れ検出)。
//
// 判定方針: 誤検知(false positive)を避けるため、"確実に消えている" と言える
// シグナルのみを broken 扱いにする。
//   - HTTP 404 / 410 (Gone)
//   - DNS 解決失敗 (ドメイン自体が無くなった)
// それ以外 (403 等の bot ブロック・5xx・タイムアウト・その他ネットワークエラー) は
// 動画配信サイトが HEAD やスクレイピングを弾くことが多く、生死不明として扱う
// (broken フラグを立てない = 誤って消したように見せない)。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10_000;

/**
 * @param {string} url
 * @returns {Promise<'ok'|'broken'|'unknown'>}
 */
export async function checkLink(url) {
  const result = await headOrGet(url);
  if (result === 'dns-not-found') return 'broken';
  if (result === null) return 'unknown';
  if (result === 404 || result === 410) return 'broken';
  return 'ok';
}

/**
 * HEAD を試し、405 等でダメなら Range 付き GET にフォールバックする。
 * @param {string} url
 * @returns {Promise<number|'dns-not-found'|null>} HTTP status、取得自体に失敗したら null
 */
async function headOrGet(url) {
  const head = await fetchWithTimeout(url, 'HEAD');
  if (head !== null && head !== 405 && head !== 501) return head;
  // 一部サイトは HEAD 非対応。ボディを取らずに済むよう Range で軽量化。
  return fetchWithTimeout(url, 'GET', { Range: 'bytes=0-0' });
}

/**
 * @param {string} url
 * @param {'HEAD'|'GET'} method
 * @param {Record<string,string>} [extraHeaders]
 * @returns {Promise<number|'dns-not-found'|null>}
 */
async function fetchWithTimeout(url, method, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...extraHeaders },
    });
    return res.status;
  } catch (err) {
    // ドメイン自体が無くなっている (DNS 解決失敗) ことが明確な場合のみ区別する。
    // それ以外のネットワークエラー(タイムアウト・TLS失敗・bot ブロック等)は
    // 一時的な可能性があるため 'unknown' 扱いにする。
    if (err && err.cause && err.cause.code === 'ENOTFOUND') return 'dns-not-found';
    return null;
  } finally {
    clearTimeout(timer);
  }
}
