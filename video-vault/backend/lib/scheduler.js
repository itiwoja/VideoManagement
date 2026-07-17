// lib/scheduler.js
// 軽量な定期ジョブ基盤 (#19)。
//
// node-cron 等の外部依存は使わず setInterval ベースにする(このプロジェクトの
// 「外部依存を増やさない」方針に合わせる)。cron 式のような複雑なスケジュール指定は
// 不要で、「Nミリ秒ごとに実行」で十分な用途(サムネイル補完・リンク切れ検出・
// ゴミ箱の自動パージ等)のみを想定。
//
// 各ジョブの最終実行時刻・エラーは in-memory に保持し、将来の管理画面(#32)から
// 参照できるようにしておく。

/** @typedef {{ name: string, intervalMs: number, run: () => Promise<void>|void, runOnStart?: boolean }} JobDef */
/** @typedef {{ name: string, intervalMs: number, lastRunAt: string|null, lastError: string|null, lastDurationMs: number|null, runCount: number }} JobStatus */

/** @type {JobDef[]} */
const jobs = [];
/** @type {Map<string, JobStatus>} */
const statuses = new Map();
/** @type {NodeJS.Timeout[]} */
let timers = [];

/**
 * ジョブを登録する。startScheduler() を呼ぶまでは実行されない。
 * @param {JobDef} job
 */
export function registerJob(job) {
  jobs.push(job);
  statuses.set(job.name, {
    name: job.name,
    intervalMs: job.intervalMs,
    lastRunAt: null,
    lastError: null,
    lastDurationMs: null,
    runCount: 0,
  });
}

/**
 * @param {JobDef} job
 */
async function runJob(job) {
  const status = statuses.get(job.name);
  const startedAt = Date.now();
  try {
    await job.run();
    status.lastError = null;
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[scheduler] job "${job.name}" failed: ${status.lastError}\n`);
  } finally {
    status.lastRunAt = new Date().toISOString();
    status.lastDurationMs = Date.now() - startedAt;
    status.runCount += 1;
  }
}

/**
 * 登録済み全ジョブを起動する。プロセス起動時に一度だけ呼ぶ。
 * runOnStart のジョブはサーバー起動が詰まらないよう少し遅延させてから実行する。
 */
export function startScheduler() {
  for (const job of jobs) {
    if (job.runOnStart) {
      const t = setTimeout(() => void runJob(job), 5_000);
      timers.push(t);
    }
    const interval = setInterval(() => void runJob(job), job.intervalMs);
    // unref: このタイマーだけでプロセスを起動状態にし続けない (テスト環境での終了性向上)
    interval.unref?.();
    timers.push(interval);
  }
}

/** テスト用: 登録済みジョブと定期実行タイマーをリセットする。 */
export function resetScheduler() {
  for (const t of timers) clearInterval(t);
  timers = [];
  jobs.length = 0;
  statuses.clear();
}

/** @returns {JobStatus[]} */
export function getJobStatuses() {
  return Array.from(statuses.values());
}
