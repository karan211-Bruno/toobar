// Collaborative Share Hub & Stage
// Supports: Screen/Window Share, Interactive Whiteboard, Presentation Slides, PDF Viewer, Video & Music Share
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  DEFAULT_YOUTUBE_SHARE_SETTINGS,
  type ShareSessionState,
  type WhiteboardStroke,
  type PresentationSlide,
} from '@shared/types';
import { useAppStore } from '../store';
import { webrtcManager } from '../webrtc';
import { isElectron } from '../electron-bridge';
import { detectDevicePlatform, saveOrShareFile } from '../cloud-bus';
import {
  fetchYouTubeTitle,
  parseTimeTokenToSeconds,
  parseYouTubeUrl,
} from '../youtube-utils';
import { YouTubeSettingsFields } from './YouTubeSettingsFields';
import { YouTubeShareStage } from './YouTubeShareStage';

const DEFAULT_SLIDES: PresentationSlide[] = [
  {
    id: 'slide-1',
    title: 'Toobar 실시간 프레젠테이션',
    content:
      '• 화면 공유, 전자칠판, PDF, 동영상/음악을 실시간으로 함께 공유하세요.\n• 상단 펜 도구로 슬라이드 위에 직접 판서할 수 있습니다.\n• 좌우 화살표 버튼으로 슬라이드를 넘기면 모든 참가자의 화면이 동기화됩니다.',
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
  },
  {
    id: 'slide-2',
    title: '주요 협업 기능 안내',
    content:
      '1. 실시간 전자칠판: 모든 참가자가 동시에 그림/도형/텍스트 판서\n2. PDF 문서 뷰어: 로컬 PDF 문서를 열고 스크롤/확대 및 형광펜 마킹\n3. 미디어 스트리밍: 동영상(MP4/WebM) 및 음악(MP3/WAV) WebRTC 동시 시청/청취',
    background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
  },
  {
    id: 'slide-3',
    title: 'Q & A 및 자유 토론',
    content:
      '• 궁금한 점은 우측 채팅 패널 또는 마이크를 켜고 질문해 주세요.\n• "슬라이드 이미지 추가" 버튼으로 내 컴퓨터의 발표 자료 이미지를 추가할 수 있습니다.',
    background: 'linear-gradient(135deg, #064e3b 0%, #0f172a 100%)',
  },
];

interface SharePickerModalProps {
  onClose: () => void;
}

async function uploadAndStartPdfShare(file: File): Promise<void> {
  const currentUser = useAppStore.getState().currentUser;
  if (!currentUser) return;

  const pdfId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let hostIp = '';
  let pdfUrl = '';
  const nativePath = (file as any).path as string | undefined;

  try {
    const ab = await file.arrayBuffer();

    // Create in-memory Blob URL immediately so iOS, iPadOS, Android, and Web work without localhost:3001
    try {
      const localBlob = URL.createObjectURL(new Blob([ab], { type: 'application/pdf' }));
      useAppStore.getState().setSharedPdfBlobUrl(pdfId, localBlob);
      pdfUrl = localBlob;
    } catch {
      // ignore
    }

    // 1. On Desktop Electron, also upload PDF buffer to local embedded HTTP server (port 3001) + Cross-PC Bridge
    if (isElectron()) {
      try {
        const resp = await fetch(
          `http://127.0.0.1:3001/shared-pdf?pdfId=${encodeURIComponent(pdfId)}`,
          {
            method: 'POST',
            body: ab,
          }
        );
        if (resp.ok) {
          const meta = (await resp.json().catch(() => ({}))) as {
            pdfId?: string;
            hostIp?: string;
          };
          hostIp = meta.hostIp || '';
          const params = new URLSearchParams();
          params.set('pdfId', pdfId);
          if (hostIp) params.set('hostIp', hostIp);
          params.set('t', String(Date.now()));
          pdfUrl = `http://127.0.0.1:3001/shared-pdf?${params.toString()}`;
        }
      } catch {
        // ignore if port 3001 unavailable
      }

      // 2. If connected to a remote signaling server (e.g., participant who became host), also push directly to remote HTTP server
      try {
        const sigUrl = useAppStore.getState().signalingUrl;
        if (sigUrl) {
          const remoteHost = new URL(sigUrl).hostname;
          if (
            remoteHost &&
            remoteHost !== 'localhost' &&
            remoteHost !== '127.0.0.1' &&
            remoteHost !== hostIp
          ) {
            fetch(`http://${remoteHost}:3001/shared-pdf?pdfId=${encodeURIComponent(pdfId)}`, {
              method: 'POST',
              body: ab,
            }).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Always broadcast PDF over Socket.IO / Cross-PC / Mobile CloudBus for guaranteed delivery across any OS
    if (ab.byteLength <= 20 * 1024 * 1024) {
      webrtcManager.broadcastPdfBuffer(pdfId, ab);
    }
  } catch {
    if (nativePath && isElectron()) {
      pdfUrl = `http://127.0.0.1:3001/local-media?path=${encodeURIComponent(nativePath)}`;
    }
  }

  const session: ShareSessionState = {
    mode: 'pdf',
    ownerId: currentUser.id,
    ownerName: currentUser.name,
    title: file.name,
    pdfDataUrl: pdfUrl,
    pdfId,
    hostIp,
    pdfPage: 1,
  };
  useAppStore.getState().clearWhiteboardStrokes();
  await webrtcManager.startCustomShare(session, null);
}

export function SharePickerModal({ onClose }: SharePickerModalProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const youtubeShareSettings =
    useAppStore((s) => s.youtubeShareSettings) || DEFAULT_YOUTUBE_SHARE_SETTINGS;
  const setYouTubeShareSettings = useAppStore((s) => s.setYouTubeShareSettings);

  const [shareSystemAudio, setShareSystemAudio] = useState(true);
  const [showYouTubeSetup, setShowYouTubeSetup] = useState(false);
  const [ytInput, setYtInput] = useState('');
  const [ytStartTime, setYtStartTime] = useState('');
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytLoading, setYtLoading] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const slideInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  if (!currentUser) return null;

  const parsedYtPreview = parseYouTubeUrl(ytInput);

  const handleStartYouTubeShare = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseYouTubeUrl(ytInput);
    if (!parsed) {
      setYtError('유튜브 링크(youtube.com/watch?v=..., youtu.be/..., shorts/...) 또는 11자리 영상 ID를 입력해 주세요.');
      return;
    }
    setYtError(null);
    setYtLoading(true);
    try {
      const title = parsed.videoId
        ? await fetchYouTubeTitle(parsed.videoId)
        : 'YouTube 재생목록';
      const customStart = ytStartTime.trim() ? parseTimeTokenToSeconds(ytStartTime) : 0;
      const startSec = customStart > 0 ? customStart : parsed.startSeconds;

      const session: ShareSessionState = {
        mode: 'youtube',
        ownerId: currentUser.id,
        ownerName: currentUser.name,
        title,
        youtubeVideoId: parsed.videoId,
        youtubePlaylistId: parsed.playlistId,
        youtubeUrl: parsed.canonicalUrl,
        youtubeIsPlaying: youtubeShareSettings.autoplay,
        youtubeCurrentTime: startSec,
        youtubeUpdatedAt: Date.now(),
        youtubeSettings: { ...youtubeShareSettings },
      };
      useAppStore.getState().clearWhiteboardStrokes();
      await webrtcManager.startCustomShare(session, null);
      onClose();
    } catch {
      setYtError('유튜브 공유를 시작하지 못했습니다. 링크를 다시 확인해 주세요.');
    } finally {
      setYtLoading(false);
    }
  };

  const handleScreenShare = async () => {
    onClose();
    await webrtcManager.startScreenShare(shareSystemAudio);
  };

  const handleWhiteboardShare = async () => {
    const session: ShareSessionState = {
      mode: 'whiteboard',
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      title: `${currentUser.name}의 전자칠판`,
    };
    useAppStore.getState().clearWhiteboardStrokes();
    await webrtcManager.startCustomShare(session, null);
    onClose();
  };

  const handlePresentationShare = async () => {
    const session: ShareSessionState = {
      mode: 'presentation',
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      title: '프레젠테이션 발표',
      slides: DEFAULT_SLIDES,
      currentSlideIndex: 0,
    };
    useAppStore.getState().clearWhiteboardStrokes();
    await webrtcManager.startCustomShare(session, null);
    onClose();
  };

  const handleSlideFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    const loadedSlides: PresentationSlide[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      loadedSlides.push({
        id: `custom-slide-${i}-${Date.now()}`,
        title: file.name,
        imageUrl: dataUrl,
      });
    }

    const session: ShareSessionState = {
      mode: 'presentation',
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      title: `슬라이드 발표 (${selectedFiles.length}장)`,
      slides: loadedSlides,
      currentSlideIndex: 0,
    };
    useAppStore.getState().clearWhiteboardStrokes();
    await webrtcManager.startCustomShare(session, null);
    onClose();
  };

  const handlePdfSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await uploadAndStartPdfShare(file);
    onClose();
  };

  const handleMediaSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mediaType: 'video' | 'audio'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const nativePath = (file as any).path as string | undefined;
    // Use local HTTP Range server when native path is available for instant (<30ms) video/audio streaming
    const mediaUrl = nativePath
      ? `http://127.0.0.1:3001/local-media?path=${encodeURIComponent(nativePath)}`
      : URL.createObjectURL(file);

    (window as any).__sharedMediaFileUrl = mediaUrl;
    (window as any).__sharedMediaFileName = file.name;

    const session: ShareSessionState = {
      mode: mediaType,
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      title: file.name,
      mediaName: file.name,
      mediaType,
    };
    await webrtcManager.startCustomShare(session, null);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div>
            <h2 className="font-semibold text-primary text-lg">
              {showYouTubeSetup ? '▶️ 유튜브 함께 보기 및 공유 설정' : '화면 및 콘텐츠 공유'}
            </h2>
            <p className="text-xs text-muted">
              {showYouTubeSetup
                ? '공유할 유튜브 영상 주소와 동기화 · 권한 · 플레이어 옵션을 설정하세요'
                : '참가자들과 함께 볼 화면, 유튜브, 전자칠판, 프레젠테이션, PDF, 동영상을 선택하세요'}
            </p>
          </div>
          <button onClick={onClose} className="btn btn-icon btn-ghost p-1" aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {showYouTubeSetup ? (
          <form
            onSubmit={handleStartYouTubeShare}
            className="p-5 overflow-y-auto flex-1 space-y-4 yt-setup-card"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowYouTubeSetup(false);
                  setYtError(null);
                }}
                className="btn btn-secondary py-1.5 px-3 text-xs"
              >
                ← 다른 공유 방식 선택
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                유튜브 링크 또는 영상 ID
              </label>
              <input
                type="text"
                autoFocus
                value={ytInput}
                onChange={(e) => {
                  setYtInput(e.target.value);
                  if (ytError) setYtError(null);
                }}
                placeholder="https://www.youtube.com/watch?v=... 또는 https://youtu.be/..."
                className="input w-full text-sm"
              />
              {ytError && <p className="text-xs text-red-400 mt-1.5">{ytError}</p>}
            </div>

            {parsedYtPreview && (
              <div className="flex items-center gap-3 p-2.5 rounded-lg bg-tertiary border border-border-color">
                {parsedYtPreview.videoId && (
                  <img
                    src={`https://i.ytimg.com/vi/${parsedYtPreview.videoId}/hqdefault.jpg`}
                    alt="YouTube 썸네일 미리보기"
                    className="rounded-md object-cover flex-shrink-0"
                    style={{ width: 96, height: 54 }}
                  />
                )}
                <div className="min-w-0 flex-1 text-xs">
                  <div className="font-semibold text-primary truncate">
                    {parsedYtPreview.videoId
                      ? `영상 ID: ${parsedYtPreview.videoId}`
                      : `재생목록 ID: ${parsedYtPreview.playlistId}`}
                  </div>
                  <div className="text-muted truncate mt-0.5">{parsedYtPreview.canonicalUrl}</div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                시작 위치 (선택 · 예: 1:30 또는 90초)
              </label>
              <input
                type="text"
                value={ytStartTime}
                onChange={(e) => setYtStartTime(e.target.value)}
                placeholder="0:00 (비워두면 링크의 시간 또는 처음부터 재생)"
                className="input w-full text-xs"
              />
            </div>

            <div>
              <div className="text-xs font-semibold text-primary mb-2">공유 설정</div>
              <YouTubeSettingsFields
                settings={youtubeShareSettings}
                onChange={setYouTubeShareSettings}
                compact
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-color">
              <button
                type="button"
                onClick={() => setShowYouTubeSetup(false)}
                className="btn btn-secondary py-2 px-4 text-xs"
              >
                뒤로
              </button>
              <button
                type="submit"
                disabled={ytLoading || !ytInput.trim()}
                className="btn btn-primary py-2 px-5 text-sm font-semibold"
              >
                {ytLoading ? '영상 정보 불러오는 중...' : '▶ 유튜브 공유 시작'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto">
              {/* 1. Screen / Window Share */}
              <button
                onClick={handleScreenShare}
                className="flex flex-col items-center p-4 rounded-xl bg-tertiary hover:bg-accent-primary/20 border border-border-color hover:border-accent-primary transition text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-3">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                </div>
                <span className="font-semibold text-primary text-sm">전체 화면 / 앱 창</span>
                <span className="text-xs text-muted mt-1">내 모니터 화면 실시간 공유</span>
              </button>

              {/* 2. YouTube Synchronized Watch */}
              <button
                onClick={() => setShowYouTubeSetup(true)}
                className="flex flex-col items-center p-4 rounded-xl bg-tertiary hover:bg-accent-primary/20 border border-border-color hover:border-accent-primary transition text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center mb-3">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="5" width="20" height="14" rx="4" />
                    <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" />
                  </svg>
                </div>
                <span className="font-semibold text-primary text-sm">유튜브 함께 보기</span>
                <span className="text-xs text-muted mt-1">재생 동기화 · 공유 설정 지원</span>
              </button>

              {/* 3. Interactive Whiteboard */}
              <button
                onClick={handleWhiteboardShare}
                className="flex flex-col items-center p-4 rounded-xl bg-tertiary hover:bg-accent-primary/20 border border-border-color hover:border-accent-primary transition text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 19l7-7 3 3-7 7-3-3z" />
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                    <path d="M2 2l7.586 7.586" />
                  </svg>
                </div>
                <span className="font-semibold text-primary text-sm">전자칠판 (화이트보드)</span>
                <span className="text-xs text-muted mt-1">모두가 함께 그리는 공동 칠판</span>
              </button>

              {/* 4. Presentation Slides */}
              <button
                onClick={handlePresentationShare}
                className="flex flex-col items-center p-4 rounded-xl bg-tertiary hover:bg-accent-primary/20 border border-border-color hover:border-accent-primary transition text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-3">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21l4-4 4 4" />
                    <path d="M7 8h10M7 12h6" />
                  </svg>
                </div>
                <span className="font-semibold text-primary text-sm">프레젠테이션</span>
                <span className="text-xs text-muted mt-1">슬라이드 발표 및 실시간 판서</span>
              </button>

              {/* 5. PDF Document */}
              <button
                onClick={() => pdfInputRef.current?.click()}
                className="flex flex-col items-center p-4 rounded-xl bg-tertiary hover:bg-accent-primary/20 border border-border-color hover:border-accent-primary transition text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center mb-3">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <span className="font-semibold text-primary text-sm">PDF 문서 공유</span>
                <span className="text-xs text-muted mt-1">PDF 파일 열기 및 페이지 판서</span>
              </button>

              {/* 6. Video File Share */}
              <button
                onClick={() => videoInputRef.current?.click()}
                className="flex flex-col items-center p-4 rounded-xl bg-tertiary hover:bg-accent-primary/20 border border-border-color hover:border-accent-primary transition text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-3">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                    <polygon points="10 8 16 12 10 16 10 8" />
                  </svg>
                </div>
                <span className="font-semibold text-primary text-sm">동영상 함께 보기</span>
                <span className="text-xs text-muted mt-1">MP4/WebM 영상 + 소리 스트리밍</span>
              </button>

              {/* 7. Music / Audio File Share */}
              <button
                onClick={() => audioInputRef.current?.click()}
                className="flex flex-col items-center p-4 rounded-xl bg-tertiary hover:bg-accent-primary/20 border border-border-color hover:border-accent-primary transition text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-pink-500/20 text-pink-400 flex items-center justify-center mb-3">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
                <span className="font-semibold text-primary text-sm">음악 / 오디오 공유</span>
                <span className="text-xs text-muted mt-1">MP3/WAV 고음질 음악 함께 듣기</span>
              </button>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={handlePdfSelected}
            />
            <input
              ref={slideInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleSlideFilesSelected}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*,.mp4,.webm,.mov,.mkv"
              className="hidden"
              onChange={(e) => handleMediaSelected(e, 'video')}
            />
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
              className="hidden"
              onChange={(e) => handleMediaSelected(e, 'audio')}
            />

            {/* Options bar */}
            <div className="px-5 py-3 bg-secondary border-t border-border-color flex items-center justify-between flex-wrap gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-secondary">
                <input
                  type="checkbox"
                  checked={shareSystemAudio}
                  onChange={(e) => setShareSystemAudio(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span>컴퓨터 오디오(시스템 소리) 함께 공유</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => slideInputRef.current?.click()}
                  className="btn btn-secondary text-xs py-1.5 px-3"
                >
                  이미지 슬라이드 묶음 열기...
                </button>
                <button onClick={onClose} className="btn btn-ghost text-xs py-1.5 px-3">
                  취소
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CollaborationStage() {
  const shareSession = useAppStore((s) => s.shareSession);
  const currentUser = useAppStore((s) => s.currentUser);
  const whiteboardStrokes = useAppStore((s) => s.whiteboardStrokes);
  const remoteStreams = useAppStore((s) => s.remoteStreams);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaVideoRef = useRef<HTMLVideoElement>(null);
  const mediaAudioRef = useRef<HTMLAudioElement>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement>(null);
  const slideUploadRef = useRef<HTMLInputElement>(null);
  const stagePdfInputRef = useRef<HTMLInputElement>(null);

  const [tool, setTool] = useState<
    'pen' | 'highlighter' | 'eraser' | 'line' | 'rect' | 'circle' | 'text'
  >('pen');
  const [color, setColor] = useState('#3B82F6');
  const [brushSize, setBrushSize] = useState(4);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Array<{ x: number; y: number }>>([]);
  // In PDF / YouTube mode, default to false so user can interact with player/document directly
  const [pdfAnnotateMode, setPdfAnnotateMode] = useState(false);
  const [ytAnnotateMode, setYtAnnotateMode] = useState(false);

  if (!shareSession || shareSession.mode === 'none' || shareSession.mode === 'screen') {
    return null;
  }

  const isOwner = currentUser?.id === shareSession.ownerId;
  const canControl = isOwner || Boolean(currentUser?.isHost);

  // Render whiteboard strokes onto canvas
  const renderStrokes = useCallback(
    (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, extraStroke?: WhiteboardStroke) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (shareSession.mode === 'whiteboard') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += 40) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      const allStrokes = extraStroke ? [...whiteboardStrokes, extraStroke] : whiteboardStrokes;
      for (const s of allStrokes) {
        if (s.points.length === 0) continue;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = s.size;

        if (s.tool === 'eraser') {
          if (shareSession.mode === 'whiteboard') {
            ctx.strokeStyle = '#0f172a';
          } else {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
          }
        } else if (s.tool === 'highlighter') {
          ctx.strokeStyle = s.color;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = s.size * 3;
        } else {
          ctx.strokeStyle = s.color;
          ctx.fillStyle = s.color;
        }

        const start = s.points[0];
        const end = s.points[s.points.length - 1];

        if (s.tool === 'line') {
          ctx.beginPath();
          ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
          ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
          ctx.stroke();
        } else if (s.tool === 'rect') {
          const rx = start.x * canvas.width;
          const ry = start.y * canvas.height;
          const rw = (end.x - start.x) * canvas.width;
          const rh = (end.y - start.y) * canvas.height;
          ctx.strokeRect(rx, ry, rw, rh);
        } else if (s.tool === 'circle') {
          const cx = ((start.x + end.x) / 2) * canvas.width;
          const cy = ((start.y + end.y) / 2) * canvas.height;
          const rx = Math.abs((end.x - start.x) * canvas.width) / 2;
          const ry = Math.abs((end.y - start.y) * canvas.height) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.tool === 'text' && s.text) {
          ctx.font = `bold ${Math.max(16, s.size * 4)}px sans-serif`;
          ctx.fillText(s.text, start.x * canvas.width, start.y * canvas.height);
        } else {
          ctx.beginPath();
          ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
          for (let i = 1; i < s.points.length; i++) {
            ctx.lineTo(s.points[i].x * canvas.width, s.points[i].y * canvas.height);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    },
    [whiteboardStrokes, shareSession.mode]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderStrokes(ctx, canvas);
  }, [whiteboardStrokes, renderStrokes, shareSession]);

  // Handle local media streaming (video / audio file share) without re-render loop
  useEffect(() => {
    if (!isOwner) return;
    if (shareSession.mode !== 'video' && shareSession.mode !== 'audio') return;

    const fileUrl = (window as any).__sharedMediaFileUrl as string | undefined;
    if (!fileUrl) return;

    if (shareSession.mode === 'video' && mediaVideoRef.current) {
      const videoEl = mediaVideoRef.current;
      if (videoEl.src !== fileUrl) {
        videoEl.src = fileUrl;
      }
      let captured = false;
      const handleCanPlay = async () => {
        if (captured) return;
        captured = true;
        try {
          await videoEl.play();
          const capture = (videoEl as any).captureStream || (videoEl as any).mozCaptureStream;
          if (capture) {
            const stream: MediaStream = capture.call(videoEl);
            await webrtcManager.attachShareStream(stream);
          }
        } catch (err) {
          console.error('Video play/capture error:', err);
        }
      };
      videoEl.addEventListener('canplay', handleCanPlay);
      return () => {
        videoEl.removeEventListener('canplay', handleCanPlay);
      };
    }

    if (shareSession.mode === 'audio' && mediaAudioRef.current && visualizerCanvasRef.current) {
      const audioEl = mediaAudioRef.current;
      const vCanvas = visualizerCanvasRef.current;
      if (audioEl.src !== fileUrl) {
        audioEl.src = fileUrl;
      }

      let animId = 0;
      let audioCtx: AudioContext | null = null;
      let captured = false;

      const handleCanPlay = async () => {
        if (captured) return;
        captured = true;
        try {
          await audioEl.play();
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaElementSource(audioEl);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          const dest = audioCtx.createMediaStreamDestination();

          source.connect(analyser);
          analyser.connect(audioCtx.destination);
          analyser.connect(dest);

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          const vCtx = vCanvas.getContext('2d')!;

          const drawVisualizer = () => {
            animId = requestAnimationFrame(drawVisualizer);
            analyser.getByteFrequencyData(dataArray);

            vCtx.fillStyle = '#0f172a';
            vCtx.fillRect(0, 0, vCanvas.width, vCanvas.height);

            vCtx.fillStyle = '#f8fafc';
            vCtx.font = 'bold 22px sans-serif';
            vCtx.textAlign = 'center';
            vCtx.fillText(
              `🎵 ${shareSession.mediaName || '음악 공유 재생 중'}`,
              vCanvas.width / 2,
              60
            );

            const barWidth = (vCanvas.width / bufferLength) * 1.6;
            let x = 20;
            for (let i = 0; i < bufferLength; i++) {
              const barHeight = (dataArray[i] / 255) * (vCanvas.height - 140);
              const hue = (i / bufferLength) * 320;
              vCtx.fillStyle = `hsl(${hue}, 85%, 60%)`;
              vCtx.fillRect(x, vCanvas.height - barHeight - 30, barWidth - 4, barHeight);
              x += barWidth;
            }
          };
          drawVisualizer();

          const canvasStream = vCanvas.captureStream(30);
          const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ]);
          await webrtcManager.attachShareStream(combinedStream);
        } catch (err) {
          console.error('Audio visualizer capture error:', err);
        }
      };

      audioEl.addEventListener('canplay', handleCanPlay);
      return () => {
        audioEl.removeEventListener('canplay', handleCanPlay);
        cancelAnimationFrame(animId);
        audioCtx?.close().catch(() => {});
      };
    }
  }, [isOwner, shareSession.mode, shareSession.mediaName]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getNormalizedPoint(e);
    if (tool === 'text') {
      const input = prompt('입력할 텍스트를 작성하세요:');
      if (input && input.trim()) {
        webrtcManager.sendWhiteboardStroke({
          id: `${Date.now()}-${Math.random()}`,
          tool: 'text',
          color,
          size: brushSize,
          points: [pt],
          text: input.trim(),
        });
      }
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setIsDrawing(true);
    setCurrentPoints([pt]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current) return;
    const pt = getNormalizedPoint(e);
    const nextPoints =
      tool === 'line' || tool === 'rect' || tool === 'circle'
        ? [currentPoints[0], pt]
        : [...currentPoints, pt];
    setCurrentPoints(nextPoints);

    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      renderStrokes(ctx, canvasRef.current, {
        id: 'preview',
        tool,
        color,
        size: brushSize,
        points: nextPoints,
      });
    }
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPoints.length > 0) {
      webrtcManager.sendWhiteboardStroke({
        id: `${Date.now()}-${Math.random()}`,
        tool,
        color,
        size: brushSize,
        points: currentPoints,
      });
    }
    setCurrentPoints([]);
  };

  const handleDownloadCanvas = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    saveOrShareFile(`Toobar-전자칠판-${Date.now()}.png`, dataUrl, 'image/png');
  };

  const handleSlideChange = (nextIndex: number) => {
    if (!shareSession.slides) return;
    const bounded = Math.max(0, Math.min(shareSession.slides.length - 1, nextIndex));
    const updated: ShareSessionState = {
      ...shareSession,
      currentSlideIndex: bounded,
    };
    useAppStore.getState().setShareSession(updated);
    webrtcManager.broadcastShareSession(updated);
    webrtcManager.clearWhiteboard();
  };

  const handleAddSlideFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    const newSlides: PresentationSlide[] = [...(shareSession.slides || [])];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      newSlides.push({
        id: `slide-${Date.now()}-${i}`,
        title: file.name,
        imageUrl: dataUrl,
      });
    }

    const updated: ShareSessionState = {
      ...shareSession,
      slides: newSlides,
      currentSlideIndex: newSlides.length - selectedFiles.length,
    };
    useAppStore.getState().setShareSession(updated);
    webrtcManager.broadcastShareSession(updated);
  };

  const handleStagePdfSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await uploadAndStartPdfShare(file);
  };

  const currentSlide =
    shareSession.slides && shareSession.slides[shareSession.currentSlideIndex || 0];

  const ownerStream = remoteStreams[shareSession.ownerId] || null;

  return (
    <div className="collab-main-column">
      {/* Top Collaboration Toolbar */}
      <div className="collab-toolbar">
        <div className="flex items-center gap-2 min-w-0">
          <span className="badge bg-accent-primary text-white">
            {shareSession.mode === 'whiteboard' && '🎨 전자칠판'}
            {shareSession.mode === 'presentation' && '📊 프레젠테이션'}
            {shareSession.mode === 'pdf' && '📄 PDF 문서'}
            {shareSession.mode === 'video' && '🎬 동영상 공유'}
            {shareSession.mode === 'audio' && '🎵 음악 공유'}
            {shareSession.mode === 'youtube' && '▶️ 유튜브 공유'}
          </span>
          <span className="font-semibold text-xs text-primary truncate max-w-[220px]">
            {shareSession.title}
          </span>
          <span className="text-xs text-muted whitespace-nowrap">
            ({shareSession.ownerName} 공유 중)
          </span>
        </div>

        {/* Drawing / Annotation Tools (Available on Whiteboard, Presentation, PDF, and YouTube) */}
        {(shareSession.mode === 'whiteboard' ||
          shareSession.mode === 'presentation' ||
          shareSession.mode === 'pdf' ||
          shareSession.mode === 'youtube') && (
          <div className="collab-tools-group">
            {shareSession.mode === 'pdf' && (
              <>
                <input
                  ref={stagePdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={handleStagePdfSelected}
                />
                <button
                  onClick={() => stagePdfInputRef.current?.click()}
                  className="btn btn-primary py-1 px-2.5 text-xs"
                  title="새 PDF 파일을 선택하여 공유합니다"
                >
                  📂 다른 PDF 열기
                </button>
                <button
                  onClick={() => setPdfAnnotateMode(!pdfAnnotateMode)}
                  className={`collab-tool-btn ${!pdfAnnotateMode ? 'active' : ''}`}
                  title="문서 스크롤/확대 모드와 펜 판서 모드를 전환합니다"
                >
                  {pdfAnnotateMode ? '🖱️ 스크롤/읽기 모드로 전환' : '🖱️ 스크롤/읽기 모드 켜짐'}
                </button>
              </>
            )}

            {shareSession.mode === 'youtube' && (
              <button
                onClick={() => setYtAnnotateMode(!ytAnnotateMode)}
                className={`collab-tool-btn ${!ytAnnotateMode ? 'active' : ''}`}
                title="유튜브 영상 직접 조작 모드와 화면 위 판서 모드를 전환합니다"
              >
                {ytAnnotateMode ? '🖱️ 영상 조작 모드로 전환' : '🖱️ 영상 조작 모드 켜짐'}
              </button>
            )}

            {(
              [
                { id: 'pen', label: '✏️ 펜' },
                { id: 'highlighter', label: '🖍️ 형광펜' },
                { id: 'line', label: '📏 직선' },
                { id: 'rect', label: '⬜ 사각형' },
                { id: 'circle', label: '⭕ 원' },
                { id: 'text', label: '🔤 텍스트' },
                { id: 'eraser', label: '🧹 지우개' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTool(t.id);
                  if (shareSession.mode === 'pdf') {
                    setPdfAnnotateMode(true);
                  } else if (shareSession.mode === 'youtube') {
                    setYtAnnotateMode(true);
                  }
                }}
                className={`collab-tool-btn ${
                  (shareSession.mode !== 'pdf' || pdfAnnotateMode) &&
                  (shareSession.mode !== 'youtube' || ytAnnotateMode) &&
                  tool === t.id
                    ? 'active'
                    : ''
                }`}
              >
                {t.label}
              </button>
            ))}

            {/* Color Swatches */}
            <div className="flex items-center gap-1.5 px-2">
              {['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#A855F7', '#FFFFFF'].map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-5 h-5 rounded-full"
                  style={{
                    backgroundColor: c,
                    border:
                      color === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.25)',
                    transform: color === c ? 'scale(1.18)' : 'scale(1)',
                  }}
                  aria-label={`색상 ${c}`}
                />
              ))}
            </div>

            {/* Brush Size */}
            <select
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="input py-1 px-2 text-xs"
              style={{ width: 'auto' }}
            >
              <option value={2}>가는 선</option>
              <option value={4}>보통 선</option>
              <option value={8}>굵은 선</option>
              <option value={14}>매우 굵게</option>
            </select>

            <button
              onClick={() => webrtcManager.clearWhiteboard()}
              className="btn btn-secondary py-1 px-2.5 text-xs"
            >
              판서 지우기
            </button>

            {shareSession.mode === 'whiteboard' && (
              <button
                onClick={handleDownloadCanvas}
                className="btn btn-secondary py-1 px-2.5 text-xs"
              >
                PNG 저장
              </button>
            )}
          </div>
        )}

        {/* Stop Share Button (for owner or current host) */}
        {canControl && (
          <button
            onClick={() => webrtcManager.stopScreenShare()}
            className="btn btn-danger py-1 px-3 text-xs"
          >
            공유 중지
          </button>
        )}
      </div>

      {/* Main Stage Body */}
      <div className="collab-canvas-viewport">
        {/* Mode 1: Whiteboard */}
        {shareSession.mode === 'whiteboard' && (
          <canvas
            ref={canvasRef}
            width={1600}
            height={900}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: 'none' }}
            className="w-full h-full object-contain cursor-crosshair"
          />
        )}

        {/* Mode 2: Presentation */}
        {shareSession.mode === 'presentation' && (
          <div className="relative w-full h-full flex flex-col">
            <div
              className="flex-1 relative flex items-center justify-center p-10 overflow-hidden"
              style={{
                background:
                  currentSlide?.background || 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              }}
            >
              {currentSlide?.imageUrl ? (
                <img
                  src={currentSlide.imageUrl}
                  alt={currentSlide.title}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none"
                />
              ) : (
                <div className="max-w-3xl w-full bg-black/30 backdrop-blur-md p-10 rounded-2xl border border-white/10 shadow-2xl">
                  <h2 className="text-3xl font-bold text-white mb-6">{currentSlide?.title}</h2>
                  <p className="text-lg text-gray-200 whitespace-pre-line leading-relaxed">
                    {currentSlide?.content}
                  </p>
                </div>
              )}

              <canvas
                ref={canvasRef}
                width={1600}
                height={900}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ touchAction: 'none' }}
                className="absolute inset-0 w-full h-full cursor-crosshair"
              />
            </div>

            <div className="flex items-center justify-between px-6 py-2.5 bg-secondary border-t border-border-color">
              <div className="flex items-center gap-2">
                <button
                  disabled={!canControl || (shareSession.currentSlideIndex || 0) <= 0}
                  onClick={() => handleSlideChange((shareSession.currentSlideIndex || 0) - 1)}
                  className="btn btn-secondary py-1 px-3 text-xs"
                >
                  ◀ 이전 슬라이드
                </button>
                <span className="text-xs font-medium text-primary px-3">
                  {(shareSession.currentSlideIndex || 0) + 1} / {shareSession.slides?.length || 1}
                </span>
                <button
                  disabled={
                    !canControl ||
                    (shareSession.currentSlideIndex || 0) >= (shareSession.slides?.length || 1) - 1
                  }
                  onClick={() => handleSlideChange((shareSession.currentSlideIndex || 0) + 1)}
                  className="btn btn-secondary py-1 px-3 text-xs"
                >
                  다음 슬라이드 ▶
                </button>
              </div>
              {canControl && (
                <div>
                  <input
                    ref={slideUploadRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleAddSlideFiles}
                  />
                  <button
                    onClick={() => slideUploadRef.current?.click()}
                    className="btn btn-primary py-1 px-3 text-xs"
                  >
                    + 슬라이드 이미지 추가
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mode 3: PDF Viewer + Annotation Overlay */}
        {shareSession.mode === 'pdf' && (
          <div className="relative w-full h-full flex flex-col bg-white">
            <div className="flex-1 relative w-full h-full">
              <PdfDocumentViewer
                pdfDataUrl={shareSession.pdfDataUrl}
                pdfId={shareSession.pdfId}
                hostIp={shareSession.hostIp}
                isOwner={isOwner}
                title={shareSession.title}
              />
              <canvas
                ref={canvasRef}
                width={1600}
                height={900}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ touchAction: pdfAnnotateMode ? 'none' : 'auto' }}
                className={`absolute inset-0 w-full h-full ${
                  pdfAnnotateMode
                    ? 'cursor-crosshair pointer-events-auto'
                    : 'pointer-events-none'
                }`}
              />
            </div>
          </div>
        )}

        {/* Mode 4: Video Player Share (Full Stage Instant Load) */}
        {shareSession.mode === 'video' && (
          <div className="w-full h-full flex items-center justify-center bg-black p-2">
            {isOwner ? (
              <video
                ref={mediaVideoRef}
                controls
                autoPlay
                playsInline
                preload="auto"
                className="w-full h-full object-contain bg-black"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : ownerStream ? (
              <RemoteMediaStreamPlayer stream={ownerStream} />
            ) : (
              <p className="text-secondary text-sm">
                {shareSession.ownerName}님의 동영상 스트림을 수신하는 중...
              </p>
            )}
          </div>
        )}

        {/* Mode 5: Audio / Music Visualizer Share */}
        {shareSession.mode === 'audio' && (
          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 p-6">
            {isOwner ? (
              <div className="w-full max-w-2xl flex flex-col items-center gap-4">
                <canvas
                  ref={visualizerCanvasRef}
                  width={800}
                  height={360}
                  className="w-full rounded-2xl border border-border-color shadow-2xl bg-slate-900"
                />
                <audio ref={mediaAudioRef} controls autoPlay preload="auto" className="w-full" />
              </div>
            ) : ownerStream ? (
              <RemoteMediaStreamPlayer stream={ownerStream} />
            ) : (
              <p className="text-secondary text-sm">
                {shareSession.ownerName}님의 음악 스트림을 수신하는 중...
              </p>
            )}
          </div>
        )}

        {/* Mode 6: Synchronized YouTube Shared Watch + Annotation Overlay */}
        {shareSession.mode === 'youtube' && (
          <div className="relative w-full h-full">
            <YouTubeShareStage
              shareSession={shareSession}
              canControl={canControl || Boolean(shareSession.youtubeSettings?.allowParticipantControl)}
              isOwnerOrHost={canControl}
            />
            <canvas
              ref={canvasRef}
              width={1600}
              height={900}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ touchAction: ytAnnotateMode ? 'none' : 'auto' }}
              className={`absolute inset-0 w-full h-full ${
                ytAnnotateMode
                  ? 'cursor-crosshair pointer-events-auto'
                  : 'pointer-events-none'
              }`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PdfDocumentViewer({
  pdfDataUrl,
  pdfId: propPdfId,
  hostIp: propHostIp,
  isOwner,
  title,
}: {
  pdfDataUrl?: string;
  pdfId?: string;
  hostIp?: string;
  isOwner: boolean;
  title?: string;
}) {
  const sharedBlobUrl = useAppStore((s) =>
    propPdfId ? s.sharedPdfBlobUrls[propPdfId] : undefined
  );
  const platform = detectDevicePlatform();

  const [readyHttpUrl, setReadyHttpUrl] = useState<string | null>(() => {
    if (sharedBlobUrl) return sharedBlobUrl;
    if (isOwner && pdfDataUrl && (pdfDataUrl.startsWith('http://') || pdfDataUrl.startsWith('blob:'))) {
      return pdfDataUrl.startsWith('http://') ? `${pdfDataUrl}#toolbar=1&view=FitH` : pdfDataUrl;
    }
    return null;
  });
  const [loadingMsg, setLoadingMsg] = useState<string>('PDF 문서를 불러오는 중...');

  useEffect(() => {
    if (sharedBlobUrl && !isElectron()) {
      setReadyHttpUrl(sharedBlobUrl);
    }
  }, [sharedBlobUrl]);

  useEffect(() => {
    if (!pdfDataUrl && !propPdfId) return;

    // Extract hostIp & pdfId if present
    let hostIp = propHostIp || '';
    let pdfId = propPdfId || '';
    if (pdfDataUrl) {
      try {
        const parsed = new URL(pdfDataUrl);
        if (!hostIp) hostIp = parsed.searchParams.get('hostIp') || '';
        if (!pdfId) pdfId = parsed.searchParams.get('pdfId') || '';
      } catch {
        // ignore
      }
    }

    // Non-Electron (iPhone, iPad, Android, Web): use CloudBus Blob URL directly
    if (!isElectron()) {
      if (sharedBlobUrl) {
        setReadyHttpUrl(sharedBlobUrl);
        return;
      }
      if (isOwner && pdfDataUrl && pdfDataUrl.startsWith('blob:')) {
        setReadyHttpUrl(pdfDataUrl);
        return;
      }
      if (pdfId) {
        webrtcManager.requestPdfPull(pdfId);
      }
      let cancelledMobile = false;
      const pollTimer = setInterval(() => {
        if (cancelledMobile) return;
        const found = pdfId ? useAppStore.getState().sharedPdfBlobUrls[pdfId] : undefined;
        if (found) {
          setReadyHttpUrl(found);
          clearInterval(pollTimer);
        } else if (pdfId) {
          webrtcManager.requestPdfPull(pdfId);
        }
      }, 1200);
      return () => {
        cancelledMobile = true;
        clearInterval(pollTimer);
      };
    }

    if (isOwner) {
      const params = new URLSearchParams();
      if (pdfId) params.set('pdfId', pdfId);
      params.set('v', String(Date.now()));
      setReadyHttpUrl(`http://127.0.0.1:3001/shared-pdf?${params.toString()}#toolbar=1&view=FitH`);
      return;
    }

    setReadyHttpUrl(null);
    let cancelled = false;

    if (!hostIp) {
      try {
        const sigUrl = useAppStore.getState().signalingUrl;
        if (sigUrl) {
          const h = new URL(sigUrl).hostname;
          if (h && h !== 'localhost' && h !== '127.0.0.1') {
            hostIp = h;
          }
        }
      } catch {
        // ignore
      }
    }

    const fetchPdfWithRetry = async () => {
      for (let attempt = 1; attempt <= 30; attempt++) {
        if (cancelled) return;
        // Check if chunked broadcast already arrived in store
        const memBlob = pdfId ? useAppStore.getState().sharedPdfBlobUrls[pdfId] : undefined;
        if (memBlob && attempt >= 4) {
          setReadyHttpUrl(memBlob);
          return;
        }
        try {
          const localParams = new URLSearchParams();
          if (pdfId) localParams.set('pdfId', pdfId);
          if (hostIp) localParams.set('hostIp', hostIp);
          localParams.set('attempt', String(attempt));
          const localCheckUrl = `http://127.0.0.1:3001/shared-pdf?${localParams.toString()}`;

          // 1. Check if local HTTP server (port 3001) already has the PDF or pulled it from hostIp
          try {
            const localResp = await fetch(localCheckUrl, { cache: 'no-store' });
            if (localResp.ok) {
              const ab = await localResp.arrayBuffer();
              if (ab && ab.byteLength > 64) {
                if (cancelled) return;
                const finalParams = new URLSearchParams();
                if (pdfId) finalParams.set('pdfId', pdfId);
                finalParams.set('v', String(Date.now()));
                setReadyHttpUrl(
                  `http://127.0.0.1:3001/shared-pdf?${finalParams.toString()}#toolbar=1&view=FitH`
                );
                return;
              }
            }
          } catch {
            // fallback to direct LAN pull below
          }

          // 2. If hostIp is known, try pulling directly from presenter's port 3001 and caching into local 127.0.0.1:3001
          if (hostIp && hostIp !== '127.0.0.1' && hostIp !== 'localhost') {
            try {
              const remoteResp = await fetch(
                `http://${hostIp}:3001/shared-pdf-raw?pdfId=${encodeURIComponent(pdfId)}&t=${Date.now()}`,
                { cache: 'no-store' }
              );
              if (remoteResp.ok) {
                const ab = await remoteResp.arrayBuffer();
                if (ab && ab.byteLength > 64) {
                  await fetch(
                    `http://127.0.0.1:3001/shared-pdf-cache?pdfId=${encodeURIComponent(pdfId)}`,
                    {
                      method: 'POST',
                      body: ab,
                    }
                  ).catch(() => {});
                  if (cancelled) return;
                  const finalParams = new URLSearchParams();
                  if (pdfId) finalParams.set('pdfId', pdfId);
                  finalParams.set('v', String(Date.now()));
                  setReadyHttpUrl(
                    `http://127.0.0.1:3001/shared-pdf?${finalParams.toString()}#toolbar=1&view=FitH`
                  );
                  return;
                }
              }
            } catch {
              // ignore and retry
            }
          }
        } catch {
          // ignore
        }

        if (!cancelled) {
          setLoadingMsg(`공유된 PDF 문서를 동기화하고 있습니다... (${attempt}회 시도)`);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };

    fetchPdfWithRetry();

    return () => {
      cancelled = true;
    };
  }, [pdfDataUrl, propPdfId, propHostIp, isOwner, sharedBlobUrl]);

  const handleSavePdf = async () => {
    const targetUrl = sharedBlobUrl || readyHttpUrl?.split('#')[0];
    if (!targetUrl) return;
    try {
      const resp = await fetch(targetUrl);
      const blob = await resp.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      await saveOrShareFile(title || 'shared-document.pdf', dataUrl, 'application/pdf');
    } catch {
      // ignore
    }
  };

  if (!readyHttpUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-secondary bg-primary gap-3">
        <span className="spinner" />
        <p className="text-sm font-medium">{loadingMsg}</p>
      </div>
    );
  }

  if (platform === 'android') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900 text-primary p-6 text-center gap-4">
        <div className="text-4xl">📄</div>
        <div>
          <h3 className="text-base font-bold">{title || '공유된 PDF 문서'}</h3>
          <p className="text-xs text-secondary mt-1">
            안드로이드 기기에서 PDF 문서를 다운로드하거나 기본 뷰어 앱으로 바로 열 수 있습니다.
          </p>
        </div>
        <button type="button" onClick={handleSavePdf} className="btn btn-primary py-2.5 px-5 text-sm">
          📥 PDF 문서 열기 / 다운로드
        </button>
      </div>
    );
  }

  if (platform === 'iphone' || platform === 'ipad' || !isElectron()) {
    return (
      <div className="relative w-full h-full bg-white">
        <iframe
          key={readyHttpUrl}
          src={readyHttpUrl}
          title={title || 'PDF 문서'}
          className="w-full h-full border-0 bg-white"
        />
        <button
          type="button"
          onClick={handleSavePdf}
          className="absolute bottom-3 right-3 z-10 btn btn-primary py-1.5 px-3 text-xs shadow-lg"
        >
          📥 PDF 저장/공유
        </button>
      </div>
    );
  }

  return (
    <embed
      key={readyHttpUrl}
      src={readyHttpUrl}
      type="application/pdf"
      title={title || 'PDF 문서'}
      className="w-full h-full border-0 bg-white"
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}

function RemoteMediaStreamPlayer({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      controls
      className="w-full h-full object-contain bg-black"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}
