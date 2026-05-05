import { useEffect } from 'react';
import type { Video } from '../types';
import { resolveSource } from '../lib/video-source';

interface VideoPlayerProps {
  video: Video;
  onClose: () => void;
}

/**
 * フルスクリーンモーダルで動画を再生する。
 * - YouTube / TikTok / Niconico / Vimeo は iframe 埋め込み
 * - .mp4 等の直リンクは <video> タグ
 * - それ以外 (X 等の埋め込み難しいサイト) は「元サイトで開く」ボタン
 */
export function VideoPlayer({ video, onClose }: VideoPlayerProps) {
  const source = resolveSource(video.url);

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
            className="max-w-full max-h-full"
          >
            この動画を再生できません
          </video>
        )}

        {source.type === 'unsupported' && <UnsupportedBlock video={video} onClose={onClose} />}
      </div>
    </div>
  );
}

function UnsupportedBlock({ video, onClose }: { video: Video; onClose: () => void }) {
  return (
    <div className="text-center px-6 py-10 max-w-md text-zinc-100">
      <p className="text-base font-medium mb-2">アプリ内再生に未対応のサイトです</p>
      <p className="text-xs text-zinc-400 break-all leading-relaxed mb-6">{video.url}</p>
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
        className="inline-block px-4 py-2 rounded-md bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-zinc-300"
      >
        元サイトで開く
      </a>
      <p className="mt-6 text-[10px] text-zinc-500 leading-relaxed">
        対応サイト: YouTube / TikTok / ニコニコ動画 / Vimeo / 直リンク (.mp4 等)
      </p>
    </div>
  );
}
