import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Video } from '../types';
import { resolveSource } from '../lib/video-source';
import { extractMedia, type ExtractedMedia } from '../lib/api';

interface VideoPlayerProps {
  video: Video;
  onClose: () => void;
  /**
   * #17 連続再生モード。渡すとヘッダーに前/次と自動再生トグルが出る。
   * プレイリスト詳細なら並び順どおりの videos、Vault なら現在のフィルタ結果を渡す想定。
   */
  queue?: Video[];
  onNavigate?: (video: Video) => void;
}

/**
 * フルスクリーンモーダルで動画を再生する。
 * - YouTube / TikTok / Niconico / Vimeo は iframe 埋め込み
 * - .mp4 等の直リンクは <video> タグ
 * - それ以外 (X 等の埋め込み難しいサイト) は「元サイトで開く」ボタン
 *
 * 呼び出し側は動画が変わるたびに `key={video.id}` を付けて再マウントさせること。
 * (抽出結果や hls.js のアタッチ状態が前の動画のまま残らないようにするため)
 */
export function VideoPlayer({ video, onClose, queue, onNavigate }: VideoPlayerProps) {
  const source = resolveSource(video.url);
  const [autoAdvance, setAutoAdvance] = useState(true);

  const queueIndex = queue?.findIndex((v) => v.id === video.id) ?? -1;
  const hasQueue = !!queue && queue.length > 1 && queueIndex >= 0;
  const hasNext = hasQueue && queueIndex < queue.length - 1;
  const hasPrev = hasQueue && queueIndex > 0;
  const goNext = () => {
    if (hasNext) onNavigate?.(queue![queueIndex + 1]);
  };
  const goPrev = () => {
    if (hasPrev) onNavigate?.(queue![queueIndex - 1]);
  };
  const handleEnded = () => {
    if (autoAdvance) goNext();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      onClick={onClose}
    >
      {/* ヘッダー: タイトル + 操作ボタン */}
      <header
        className="flex items-center gap-3 px-4 py-3 text-zinc-100 bg-black/40 backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10"
        >
          ×
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{video.title}</div>
          <div className="text-[10px] text-zinc-400">
            {video.site}
            {source.serviceLabel ? ` · ${source.serviceLabel}` : ''}
          </div>
        </div>
        {hasQueue && (
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
                className="accent-indigo-500"
              />
              自動再生
            </label>
            <span className="text-[10px] text-zinc-500 tabular-nums">
              {queueIndex + 1} / {queue!.length}
            </span>
            <button
              type="button"
              onClick={goPrev}
              disabled={!hasPrev}
              className="text-xs px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10"
              title="前の動画"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!hasNext}
              className="text-xs px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10"
              title="次の動画"
            >
              ▶
            </button>
          </div>
        )}
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-zinc-300 hover:text-white px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20"
          title="元サイトで開く (新規タブ)"
        >
          ↗ 開く
        </a>
      </header>

      {/* 本体 */}
      <div
        className="flex-1 flex items-center justify-center p-2 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {source.type === 'iframe' && (
          <div className="w-full max-w-5xl aspect-video bg-black">
            <iframe
              src={source.url}
              title={video.title}
              className="w-full h-full"
              frameBorder={0}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {source.type === 'video' && (
          <video
            src={source.url}
            controls
            autoPlay
            playsInline
            onEnded={handleEnded}
            className="max-w-full max-h-full"
          >
            この動画を再生できません
          </video>
        )}

        {source.type === 'unsupported' && (
          <UnsupportedBlock video={video} onClose={onClose} onEnded={handleEnded} />
        )}
      </div>
    </div>
  );
}

type ExtractState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'success'; media: ExtractedMedia }
  | { phase: 'failed' };

/**
 * iframe 埋め込みできないサイトでも、サーバ側で og:video / <video src> /
 * .mp4/.m3u8 直リンクを抜き出して再生できないかを試す。
 * .m3u8 (HLS) は Safari / iOS だと <video> タグが直接再生できる。
 * Chrome 系は本来 hls.js が必要だが、bundle 肥大化を避けるために CDN から
 * 動的 import する。
 */
function UnsupportedBlock({
  video,
  onClose,
  onEnded,
}: {
  video: Video;
  onClose: () => void;
  onEnded: () => void;
}) {
  const [state, setState] = useState<ExtractState>({ phase: 'idle' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  const tryExtract = async () => {
    setState({ phase: 'loading' });
    const media = await extractMedia(video.url);
    if (media) setState({ phase: 'success', media });
    else setState({ phase: 'failed' });
  };

  useEffect(() => {
    // 開いた瞬間に自動で抽出を試みる
    void tryExtract();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // m3u8 を Chrome 系で再生する場合のみ hls.js を attach
  // hls.js は npm dep として bundle 済み (静的 import)
  useEffect(() => {
    if (state.phase !== 'success') return;
    const el = videoRef.current;
    if (!el) return;
    const isHls = state.media.mediaType === 'application/x-mpegURL';

    // 非 HLS (mp4 等) はそのまま src
    if (!isHls) {
      el.src = state.media.url;
      el.play().catch(() => {});
      return;
    }

    // HLS の優先順:
    //   1. hls.js が動く環境 (Chrome / Firefox / Edge) は hls.js を使う
    //      Chrome は canPlayType で 'maybe' を返すが、実際にはネイティブ再生できない罠あり。
    //   2. hls.js 非対応で Safari ネイティブ HLS が動くなら素の src
    //   3. それも無ければフォールバック src (再生は失敗するがエラー表示はされる)
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(state.media.url);
      hls.attachMedia(el);
      hlsRef.current = hls;
      return;
    }

    const canNativeHls = el.canPlayType('application/vnd.apple.mpegurl') !== '';
    el.src = state.media.url;
    if (canNativeHls) el.play().catch(() => {});

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [state]);

  if (state.phase === 'loading') {
    return (
      <div className="text-center px-6 py-10 text-zinc-100">
        <p className="text-sm">動画 URL を解析中…</p>
        <p className="text-[10px] text-zinc-500 mt-2">サイトによっては数秒かかります</p>
      </div>
    );
  }

  if (state.phase === 'success') {
    return (
      <video
        ref={videoRef}
        controls
        autoPlay
        playsInline
        poster={state.media.poster}
        onEnded={onEnded}
        className="max-w-full max-h-full"
      >
        この動画を再生できません
      </video>
    );
  }

  // idle / failed
  return (
    <div className="text-center px-6 py-10 max-w-md text-zinc-100">
      <p className="text-base font-medium mb-2">
        {state.phase === 'failed' ? 'アプリ内で再生できませんでした' : 'アプリ内再生に未対応のサイトです'}
      </p>
      <p className="text-xs text-zinc-400 break-all leading-relaxed mb-6">{video.url}</p>
      <div className="flex flex-col gap-2 items-center">
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="inline-block px-4 py-2 rounded-md bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-zinc-300"
        >
          元サイトで開く
        </a>
        {state.phase === 'failed' && (
          <button
            type="button"
            onClick={() => void tryExtract()}
            className="text-xs text-zinc-400 hover:text-zinc-100 underline"
          >
            もう一度試す
          </button>
        )}
      </div>
      <p className="mt-6 text-[10px] text-zinc-500 leading-relaxed">
        対応サイト: YouTube / TikTok / ニコニコ動画 / Vimeo / 直リンク (.mp4 等)
        <br />
        その他のサイトでも og:video / 直リンクが拾えれば再生できます
      </p>
    </div>
  );
}
