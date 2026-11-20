// Interactive Synchronized YouTube Shared Watch Stage
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  DEFAULT_YOUTUBE_SHARE_SETTINGS,
  type ShareSessionState,
  type YouTubeShareSettings,
} from '@shared/types';
import { useAppStore } from '../store';
import { webrtcManager } from '../webrtc';
import {
  buildYouTubeEmbedUrl,
  fetchYouTubeTitle,
  formatSeconds,
  parseYouTubeUrl,
} from '../youtube-utils';
import { YouTubeSettingsFields } from './YouTubeSettingsFields';

interface YouTubeShareStageProps {
  shareSession: ShareSessionState;
  canControl: boolean;
  isOwnerOrHost: boolean;
}

export function YouTubeShareStage({
  shareSession,
  canControl,
  isOwnerOrHost,
}: YouTubeShareStageProps) {
  const youtubeShareSettings = useAppStore((s) => s.youtubeShareSettings);
  const settings: YouTubeShareSettings =
    shareSession.youtubeSettings || youtubeShareSettings || DEFAULT_YOUTUBE_SHARE_SETTINGS;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerIdRef = useRef(`toobar-yt-${Math.random().toString(36).slice(2, 8)}`);
  const handshakenRef = useRef(false);
  const suppressOutgoingUntilRef = useRef(0);
  const lastBroadcastTsRef = useRef(0);
  const localTimeRef = useRef(shareSession.youtubeCurrentTime || 0);
  const lastDeliveryTsRef = useRef(0);
  const prevStateRef = useRef<number>(shareSession.youtubeIsPlaying ? 1 : 2);

  const [isPlaying, setIsPlaying] = useState(Boolean(shareSession.youtubeIsPlaying));
  const [currentTime, setCurrentTime] = useState(shareSession.youtubeCurrentTime || 0);
  const [duration, setDuration] = useState(0);
  const [localVolume, setLocalVolume] = useState(() =>
    settings.startMuted ? 0 : settings.defaultVolume ?? 80
  );
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showChangeUrl, setShowChangeUrl] = useState(false);
  const [nextUrlInput, setNextUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [embedWarning, setEmbedWarning] = useState<string | null>(null);

  const embedKey = [
    shareSession.youtubeVideoId || '',
    shareSession.youtubePlaylistId || '',
    settings.privacyEnhanced ? 1 : 0,
    settings.showControls ? 1 : 0,
    settings.captions ? 1 : 0,
    settings.loop ? 1 : 0,
  ].join('|');

  const embedUrl = useMemo(
    () =>
      buildYouTubeEmbedUrl({
        videoId: shareSession.youtubeVideoId,
        playlistId: shareSession.youtubePlaylistId,
        startSeconds: Math.floor(shareSession.youtubeCurrentTime || 0),
        settings,
      }),
    // Only recreate iframe when structural embed params change — never on play/pause/seek
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [embedKey]
  );

  const sendCommand = useCallback((func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({
          event: 'command',
          func,
          args,
          id: playerIdRef.current,
        }),
        '*'
      );
    } catch {
      // ignore postMessage errors
    }
  }, []);

  const sendHandshake = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({
          event: 'listening',
          id: playerIdRef.current,
          channel: 'widget',
        }),
        '*'
      );
      sendCommand('addEventListener', ['onReady']);
      sendCommand('addEventListener', ['onStateChange']);
      sendCommand('addEventListener', ['onError']);
    } catch {
      // ignore
    }
  }, [sendCommand]);

  const broadcastState = useCallback(
    (patch: Partial<ShareSessionState>) => {
      const latest = useAppStore.getState().shareSession;
      if (!latest || latest.mode !== 'youtube') return;
      const ts = Date.now();
      lastBroadcastTsRef.current = ts;
      const updated: ShareSessionState = {
        ...latest,
        ...patch,
        youtubeUpdatedAt: ts,
      };
      useAppStore.getState().setShareSession(updated);
      webrtcManager.broadcastShareSession(updated);
    },
    []
  );

  const computeCompensatedTime = useCallback((session: ShareSessionState) => {
    const base = session.youtubeCurrentTime || 0;
    const rate = session.youtubeSettings?.playbackRate || 1;
    if (session.youtubeIsPlaying && session.youtubeUpdatedAt) {
      const elapsedSec = Math.max(0, (Date.now() - session.youtubeUpdatedAt) / 1000) * rate;
      return Math.max(0, base + elapsedSec);
    }
    return Math.max(0, base);
  }, []);

  const syncPlayerToSession = useCallback(
    (session: ShareSessionState) => {
      const s = session.youtubeSettings || settings;
      const rate = s.playbackRate || 1;
      const targetTime = computeCompensatedTime(session);
      suppressOutgoingUntilRef.current = Date.now() + 1400;

      sendCommand('setPlaybackRate', [rate]);
      if (Math.abs(targetTime - localTimeRef.current) > 1.6) {
        sendCommand('seekTo', [targetTime, true]);
        localTimeRef.current = targetTime;
        setCurrentTime(targetTime);
      }
      if (session.youtubeIsPlaying) {
        sendCommand('playVideo');
        setIsPlaying(true);
      } else {
        sendCommand('pauseVideo');
        setIsPlaying(false);
      }
    },
    [computeCompensatedTime, sendCommand, settings]
  );

  // Handshake retry timer when embedKey changes
  useEffect(() => {
    handshakenRef.current = false;
    setEmbedWarning(null);
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (handshakenRef.current || attempts > 12) {
        clearInterval(timer);
        return;
      }
      sendHandshake();
    }, 650);
    return () => clearInterval(timer);
  }, [embedKey, sendHandshake]);

  // Listen for postMessage events from YouTube iframe
  useEffect(() => {
    const handleMessage = (ev: MessageEvent) => {
      const origin = (ev.origin || '').toLowerCase();
      if (
        !origin.includes('youtube.com') &&
        !origin.includes('youtube-nocookie.com') &&
        ev.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }

      let data: any = ev.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== 'object') return;

      if (data.event === 'onReady' || data.event === 'initialDelivery') {
        handshakenRef.current = true;
        const latest = useAppStore.getState().shareSession;
        const curVol = settings.startMuted ? 0 : settings.defaultVolume ?? 80;
        if (settings.startMuted) {
          sendCommand('mute');
        } else {
          sendCommand('unMute');
          sendCommand('setVolume', [curVol]);
        }
        sendCommand('setPlaybackRate', [settings.playbackRate || 1]);
        if (latest && latest.mode === 'youtube' && latest.youtubeSettings?.syncPlayback !== false) {
          syncPlayerToSession(latest);
        }
      }

      if (data.event === 'onError') {
        const code = Number(data.info);
        if (code === 101 || code === 150 || code === 153) {
          setEmbedWarning(
            `이 영상은 업로더 또는 저작권 정책상 외부 임베드 재생이 제한되었습니다 (오류 ${code}). 우측 "유튜브에서 열기"로 시청할 수 있습니다.`
          );
        } else if (code === 100 || code === 2) {
          setEmbedWarning(`유튜브 영상을 찾을 수 없거나 비공개 상태입니다 (오류 ${code}).`);
        }
      }

      if (data.event === 'infoDelivery' && data.info && typeof data.info === 'object') {
        handshakenRef.current = true;
        const info = data.info;
        const now = Date.now();

        if (typeof info.duration === 'number' && info.duration > 0) {
          setDuration(info.duration);
        }

        const prevTime = localTimeRef.current;
        const prevWall = lastDeliveryTsRef.current || now;
        lastDeliveryTsRef.current = now;

        if (typeof info.currentTime === 'number' && info.currentTime >= 0) {
          localTimeRef.current = info.currentTime;
          setCurrentTime(info.currentTime);
        }

        let stateChangedByController = false;
        if (typeof info.playerState === 'number') {
          if (info.playerState === 1 || info.playerState === 2) {
            const nextPlaying = info.playerState === 1;
            setIsPlaying(nextPlaying);
            if (prevStateRef.current !== info.playerState) {
              prevStateRef.current = info.playerState;
              stateChangedByController = true;
            }
          }
        }

        const wallDelta = Math.max(0.1, (now - prevWall) / 1000);
        const timeDelta =
          typeof info.currentTime === 'number' ? Math.abs(info.currentTime - prevTime) : 0;
        const rate = settings.playbackRate || 1;
        const jumpedByScrub =
          typeof info.currentTime === 'number' && timeDelta > Math.max(2.5, wallDelta * rate + 1.8);

        if (
          canControl &&
          settings.syncPlayback &&
          now > suppressOutgoingUntilRef.current &&
          (stateChangedByController || jumpedByScrub)
        ) {
          const latest = useAppStore.getState().shareSession;
          if (latest && latest.mode === 'youtube') {
            broadcastState({
              youtubeIsPlaying:
                typeof info.playerState === 'number'
                  ? info.playerState === 1
                  : Boolean(latest.youtubeIsPlaying),
              youtubeCurrentTime:
                typeof info.currentTime === 'number'
                  ? info.currentTime
                  : localTimeRef.current,
            });
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [broadcastState, canControl, sendCommand, settings, syncPlayerToSession]);

  // Apply remote shareSession playback updates
  useEffect(() => {
    if (!settings.syncPlayback) return;
    if (
      shareSession.youtubeUpdatedAt &&
      Math.abs(shareSession.youtubeUpdatedAt - lastBroadcastTsRef.current) < 50
    ) {
      return;
    }
    syncPlayerToSession(shareSession);
  }, [
    shareSession,
    shareSession.youtubeIsPlaying,
    shareSession.youtubeCurrentTime,
    shareSession.youtubeUpdatedAt,
    shareSession.youtubeSettings?.playbackRate,
    settings.syncPlayback,
    syncPlayerToSession,
  ]);

  const handleTogglePlay = () => {
    if (!canControl) return;
    const nextPlaying = !isPlaying;
    suppressOutgoingUntilRef.current = Date.now() + 1200;
    sendCommand(nextPlaying ? 'playVideo' : 'pauseVideo');
    setIsPlaying(nextPlaying);
    prevStateRef.current = nextPlaying ? 1 : 2;
    if (settings.syncPlayback) {
      broadcastState({
        youtubeIsPlaying: nextPlaying,
        youtubeCurrentTime: localTimeRef.current,
      });
    }
  };

  const handleSeek = (targetSeconds: number) => {
    if (!canControl) return;
    const clamped = Math.max(0, duration > 0 ? Math.min(duration, targetSeconds) : targetSeconds);
    suppressOutgoingUntilRef.current = Date.now() + 1200;
    sendCommand('seekTo', [clamped, true]);
    localTimeRef.current = clamped;
    setCurrentTime(clamped);
    if (settings.syncPlayback) {
      broadcastState({
        youtubeIsPlaying: isPlaying,
        youtubeCurrentTime: clamped,
      });
    }
  };

  const handleVolumeChange = (vol: number) => {
    setLocalVolume(vol);
    if (vol <= 0) {
      sendCommand('mute');
    } else {
      sendCommand('unMute');
      sendCommand('setVolume', [vol]);
    }
  };

  const handleUpdateSettings = (partial: Partial<YouTubeShareSettings>) => {
    const nextSettings: YouTubeShareSettings = {
      ...settings,
      ...partial,
    };
    useAppStore.getState().setYouTubeShareSettings(nextSettings);

    if (typeof partial.playbackRate === 'number') {
      suppressOutgoingUntilRef.current = Date.now() + 1000;
      sendCommand('setPlaybackRate', [partial.playbackRate]);
    }

    if (isOwnerOrHost) {
      broadcastState({
        youtubeSettings: nextSettings,
        youtubeCurrentTime: localTimeRef.current,
        youtubeIsPlaying: isPlaying,
      });
    }
  };

  const handleChangeVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canControl) return;
    const parsed = parseYouTubeUrl(nextUrlInput);
    if (!parsed) {
      setUrlError('올바른 유튜브 링크 또는 영상 ID를 입력하세요.');
      return;
    }
    setUrlError(null);
    const resolvedTitle = parsed.videoId
      ? await fetchYouTubeTitle(parsed.videoId)
      : 'YouTube 재생목록';
    broadcastState({
      title: resolvedTitle,
      youtubeVideoId: parsed.videoId,
      youtubePlaylistId: parsed.playlistId,
      youtubeUrl: parsed.canonicalUrl,
      youtubeCurrentTime: parsed.startSeconds,
      youtubeIsPlaying: settings.autoplay,
    });
    setShowChangeUrl(false);
    setNextUrlInput('');
  };

  const externalWatchUrl =
    shareSession.youtubeUrl ||
    (shareSession.youtubeVideoId
      ? `https://www.youtube.com/watch?v=${shareSession.youtubeVideoId}`
      : shareSession.youtubePlaylistId
      ? `https://www.youtube.com/playlist?list=${shareSession.youtubePlaylistId}`
      : 'https://www.youtube.com');

  const sliderMax = Math.max(duration, currentTime, 100);

  return (
    <div className="relative w-full h-full flex flex-col bg-black">
      {/* YouTube Player Viewport */}
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
        <iframe
          key={embedKey}
          ref={iframeRef}
          src={embedUrl}
          title={shareSession.title || 'YouTube 공유 플레이어'}
          onLoad={sendHandshake}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          className="w-full h-full border-0"
        />

        {embedWarning && (
          <div className="absolute top-3 left-3 right-3 z-20 p-3 rounded-lg bg-red-900/90 border border-red-500/50 text-xs text-white flex items-center justify-between gap-3">
            <span>{embedWarning}</span>
            <a
              href={externalWatchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary py-1 px-2.5 text-xs flex-shrink-0"
            >
              ↗️ 유튜브에서 열기
            </a>
          </div>
        )}

        {/* Inline YouTube Share Settings Drawer */}
        {showSettingsDrawer && isOwnerOrHost && (
          <div
            className="yt-settings-drawer animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border-color">
              <span className="text-xs font-bold text-primary">⚙️ 유튜브 공유 실시간 설정</span>
              <button
                type="button"
                onClick={() => setShowSettingsDrawer(false)}
                className="btn btn-ghost py-0.5 px-2 text-xs"
              >
                닫기
              </button>
            </div>
            <div className="overflow-y-auto max-h-[54vh]">
              <YouTubeSettingsFields
                settings={settings}
                onChange={handleUpdateSettings}
                compact
              />
            </div>
          </div>
        )}
      </div>

      {/* Change URL Bar */}
      {showChangeUrl && canControl && (
        <form
          onSubmit={handleChangeVideo}
          className="px-3 py-2 bg-secondary border-t border-border-color flex items-center gap-2 flex-wrap"
        >
          <input
            type="text"
            value={nextUrlInput}
            onChange={(e) => setNextUrlInput(e.target.value)}
            placeholder="새 유튜브 링크(watch / youtu.be / shorts) 또는 11자리 영상 ID 붙여넣기..."
            className="input flex-1 text-xs py-1.5"
          />
          <button type="submit" className="btn btn-primary py-1.5 px-3 text-xs">
            영상 전환
          </button>
          <button
            type="button"
            onClick={() => {
              setShowChangeUrl(false);
              setUrlError(null);
            }}
            className="btn btn-ghost py-1.5 px-2.5 text-xs"
          >
            취소
          </button>
          {urlError && <span className="text-xs text-red-400 w-full">{urlError}</span>}
        </form>
      )}

      {/* Synchronized Transport & Utility Control Bar */}
      <div className="yt-control-bar">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={!canControl}
            onClick={handleTogglePlay}
            className="btn btn-primary py-1 px-2.5 text-xs"
            title={canControl ? (isPlaying ? '일시정지' : '재생') : '호스트만 제어할 수 있습니다'}
          >
            {isPlaying ? '⏸ 일시정지' : '▶ 재생'}
          </button>

          <button
            type="button"
            disabled={!canControl}
            onClick={() => handleSeek(currentTime - 10)}
            className="btn btn-secondary py-1 px-2 text-xs"
            title="10초 뒤로"
          >
            -10초
          </button>
          <button
            type="button"
            disabled={!canControl}
            onClick={() => handleSeek(currentTime + 10)}
            className="btn btn-secondary py-1 px-2 text-xs"
            title="10초 앞으로"
          >
            +10초
          </button>
        </div>

        {/* Seek Bar & Timestamp */}
        <div className="flex items-center gap-2 flex-1 min-w-[160px]">
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={Math.min(sliderMax, currentTime)}
            disabled={!canControl}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="range-slider flex-1"
            aria-label="유튜브 재생 위치"
          />
          <span className="text-[11px] font-mono text-secondary whitespace-nowrap">
            {formatSeconds(currentTime)}
            {duration > 0 ? ` / ${formatSeconds(duration)}` : ''}
          </span>
        </div>

        {/* Local Volume & Speed & Sync Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-xs" title="내 기기 음량">
              {localVolume <= 0 ? '🔇' : '🔊'}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={localVolume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="range-slider"
              style={{ inlineSize: '72px' }}
              aria-label="내 스피커 음량"
            />
          </div>

          <select
            value={settings.playbackRate}
            disabled={!canControl}
            onChange={(e) => handleUpdateSettings({ playbackRate: Number(e.target.value) })}
            className="input py-1 px-1.5 text-xs"
            style={{ width: 'auto' }}
            aria-label="재생 속도"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => syncPlayerToSession(shareSession)}
            className="btn btn-secondary py-1 px-2.5 text-xs"
            title="공유 중인 현재 재생 위치로 다시 맞춥니다"
          >
            🔄 위치 동기화
          </button>

          {canControl && (
            <button
              type="button"
              onClick={() => setShowChangeUrl((v) => !v)}
              className="btn btn-secondary py-1 px-2.5 text-xs"
            >
              🔗 영상 변경
            </button>
          )}

          {isOwnerOrHost && (
            <button
              type="button"
              onClick={() => setShowSettingsDrawer((v) => !v)}
              className={`btn py-1 px-2.5 text-xs ${
                showSettingsDrawer ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              ⚙️ 공유 설정
            </button>
          )}

          <a
            href={externalWatchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary py-1 px-2.5 text-xs"
            title="브라우저에서 원본 유튜브 페이지 열기"
          >
            ↗️ 열기
          </a>
        </div>
      </div>
    </div>
  );
}
