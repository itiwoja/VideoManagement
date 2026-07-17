// lib/tag-suggest.js
// タグ自動提案 (#14)。タイトル・サイト・メモ・既存タグから Claude API でタグ候補を提案する。
//
// プライバシー方針上の唯一の明示的・限定的な opt-in 例外 (README「設計方針」参照):
// ANTHROPIC_API_KEY が未設定なら API 呼び出し自体を一切行わず、即座に [] を返す。
// 何が起きても (キー未設定・ネットワークエラー・タイムアウト・不正な応答形式) 例外を投げず、
// 保存フローを絶対にブロックしない best-effort の nice-to-have 機能として実装する。

import Anthropic from '@anthropic-ai/sdk';

// 軽量な分類タスクなので高速・安価な Haiku を使う。深い推論は不要。
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 200;
const TIMEOUT_MS = 8000;
const MAX_TAGS = 6;

/**
 * @param {{
 *   title?: string|null,
 *   site?: string|null,
 *   note?: string|null,
 *   existingTags?: string[],
 * }} input
 * @returns {Promise<string[]>} 提案タグ名の配列 (3〜6件程度、失敗時は常に [])
 */
export async function suggestTags({ title, site, note, existingTags = [] } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt({ title, site, note, existingTags });

    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      },
      // 保存フローを絶対に長時間止めないための上限。SDK は AbortSignal をそのまま
      // fetch に渡すので、タイムアウト時は AbortError として catch 節に落ちる。
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || typeof textBlock.text !== 'string') return [];
    return parseTagArray(textBlock.text);
  } catch {
    // ネットワークエラー・APIエラー・タイムアウト・想定外の応答形式、
    // 何であっても握りつぶして [] を返す (この機能で保存フローを壊してはいけない)。
    return [];
  }
}

/**
 * @param {{ title?: string|null, site?: string|null, note?: string|null, existingTags: string[] }} input
 * @returns {string}
 */
function buildPrompt({ title, site, note, existingTags }) {
  const lines = [];
  if (title) lines.push(`タイトル: ${title}`);
  if (site) lines.push(`サイト: ${site}`);
  if (note) lines.push(`メモ: ${note}`);
  if (existingTags.length > 0) {
    lines.push(`このライブラリで既に使われているタグ一覧 (可能な限りこの中から再利用すること): ${existingTags.join(', ')}`);
  }

  return [
    '次の動画のブックマーク情報を見て、短いタグを3〜6個提案してください。',
    '',
    lines.length > 0 ? lines.join('\n') : '(情報なし)',
    '',
    '出力ルール (厳守):',
    '- 出力は JSON 配列のみ。説明文・前置き・コードフェンス・改行以外の文字は一切含めない',
    '- 例: ["cooking","recipe","dessert"]',
    '- 各タグは短い単語かフレーズ、すべて小文字',
    '- 既存タグ一覧に意味の重複するタグがあれば、新語を作らずそれをそのまま使う',
    '  (例: 既存に "cooking" があるなら "料理" は提案しない)',
    '- 自信を持って提案できるタグが無ければ空配列 [] を返す',
  ].join('\n');
}

/**
 * モデル出力を安全にタグ配列へパースする。
 * markdown code fence (```json ... ``` 等) で包まれているケースを剥がしてから JSON.parse する。
 * 失敗したら例外を投げず [] を返す。
 * @param {string} raw
 * @returns {string[]}
 */
function parseTagArray(raw) {
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set();
  const tags = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const name = item.trim().toLowerCase();
    if (name.length === 0 || name.length > 64) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    tags.push(name);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}
