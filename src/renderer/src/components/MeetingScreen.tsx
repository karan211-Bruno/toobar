// Main Meeting Screen
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useAppStore } from '../store';
import { api, isElectron } from '../electron-bridge';
import { webrtcManager } from '../webrtc';
import { cloudBus, detectDevicePlatform, saveOrShareFile } from '../cloud-bus';
import { VideoGrid } from './VideoGrid';
import { Toolbar } from './Toolbar';
import { ParticipantsPanel } from './ParticipantsPanel';
import { ChatPanel } from './ChatPanel';
import { MessengerPanel } from './MessengerPanel';
import { ScreenShareBanner } from './ScreenShareBanner';
import { ConnectionIndicator } from './ConnectionIndicator';
import { InviteModal } from './InviteModal';
import { UpdateModal } from './UpdateModal';
import { SharePickerModal, CollaborationStage } from './CollaborationStage';

export function MeetingScreen() {
  const {
    currentUser,
    currentMeeting,
    localStream,
    screenStream,
    remoteStreams,
    audioEnabled,
    videoEnabled,
    isScreenSharing,
    isRecording,
    messages,
    isConnected,
    connectionError,
    shareSession,
  } = useAppStore();

  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<'participants' | 'chat' | 'messenger'>(
    'participants'
  );
  const [lastSeenChatCount, setLastSeenChatCount] = useState(0);
  const [unreadMessengerCount, setUnreadMessengerCount] = useState(() =>
    cloudBus.getTotalUnreadCount()
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const platform = detectDevicePlatform();
  const isMobileDevice =
    platform === 'iphone' || platform === 'ipad' || platform === 'android';
  const isMacElectron = isElectron() && Boolean((window as any).platform?.isMac);

  useEffect(() => {
    if (showSidebar && sidebarContent === 'chat') {
      setLastSeenChatCount(messages.length);
    }
  }, [showSidebar, sidebarContent, messages.length]);

  useEffect(() => {
    const unsub = cloudBus.onMessengerUpdate(() => {
      setUnreadMessengerCount(cloudBus.getTotalUnreadCount());
    });
    return unsub;
  }, []);

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      useAppStore.getState().setIsRecording(false);
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      alert('이 기기에서는 브라우저 내장 녹화를 지원하지 않습니다.');
      return;
    }

    const state = useAppStore.getState();
    const baseStream = state.screenStream || state.localStream;
    if (!baseStream) {
      alert('녹화할 카메라 또는 공유 화면 스트림이 없습니다.');
      return;
    }

    try {
      const tracks: MediaStreamTrack[] = [...baseStream.getVideoTracks()];
      if (state.localStream?.getAudioTracks().length) {
        tracks.push(...state.localStream.getAudioTracks());
      } else if (baseStream.getAudioTracks().length) {
        tracks.push(...baseStream.getAudioTracks());
      }
      if (tracks.length === 0) {
        alert('녹화 가능한 비디오/오디오 트랙이 없습니다.');
        return;
      }

      const mixedStream = new MediaStream(tracks);
      const preferredMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : '';

      recordedChunksRef.current = [];
      const recorder = preferredMime
        ? new MediaRecorder(mixedStream, { mimeType: preferredMime })
        : new MediaRecorder(mixedStream);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        if (chunks.length === 0) return;
        const mime = recorder.mimeType || 'video/webm';
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mime });
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            saveOrShareFile(
              `Toobar-회의녹화-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`,
              reader.result,
              mime
            );
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      useAppStore.getState().setIsRecording(true);
    } catch (err) {
      console.error('Recording start failed:', err);
      alert('녹화를 시작하지 못했습니다.');
    }
  }, [isRecording]);

  const handleToggleAudio = useCallback(() => {
    const next = !useAppStore.getState().audioEnabled;
    webrtcManager.setLocalAudioEnabled(next);
  }, []);

  const handleToggleVideo = useCallback(() => {
    const next = !useAppStore.getState().videoEnabled;
    webrtcManager.setLocalVideoEnabled(next);
  }, []);

  const handleToggleScreenShare = useCallback(async () => {
    const state = useAppStore.getState();
    const isMyShare =
      state.isScreenSharing ||
      Boolean(state.shareSession && state.shareSession.ownerId === state.currentUser?.id);
    if (isMyShare) {
      await webrtcManager.stopScreenShare();
    } else {
      setShowShareModal(true);
    }
  }, []);

  useEffect(() => {
    if (localStream) {
      webrtcManager.syncLocalStream(localStream);
    }
  }, [localStream]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        handleToggleAudio();
      }
      if ((e.key === 'v' || e.key === 'V') && e.target === document.body) {
        e.preventDefault();
        handleToggleVideo();
      }
      if ((e.key === 'h' || e.key === 'H') && e.target === document.body) {
        setShowSidebar(true);
        setSidebarContent('chat');
      }
      if ((e.key === 'u' || e.key === 'U') && e.target === document.body) {
        setShowSidebar(true);
        setSidebarContent('participants');
      }
      if (e.key === 'Escape') {
        setShowSidebar(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleAudio, handleToggleVideo]);

  useEffect(() => {
    if (isFullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [isFullscreen]);

  if (!currentMeeting || !currentUser) return null;

  const allParticipants = currentMeeting.participants;

  const hasCollaborationStage = Boolean(
    shareSession &&
      shareSession.mode !== 'none' &&
      shareSession.mode !== 'screen'
  );

  const unreadChatCount = Math.max(0, messages.length - lastSeenChatCount);

  return (
    <div className="app-screen">
      {/* Top Meeting Info & Quick Action Header */}
      <header className={`meeting-header ${isMacElectron ? 'mac-traffic-padding' : ''}`}>
        <div className="meeting-header-left">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: isConnected ? '#10b981' : '#f59e0b' }}
            title={isConnected ? '실시간 연결됨' : '연결 중'}
          />
          <span className="font-semibold text-sm text-primary truncate" style={{ maxWidth: 180 }}>
            {currentMeeting.name}
          </span>

          <div className="meeting-id-pill">
            <span className="text-muted">회의 ID</span>
            <code className="font-mono font-bold text-primary tracking-wider select-all">
              {currentMeeting.id}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(currentMeeting.id);
                setQuickCopied(true);
                setTimeout(() => setQuickCopied(false), 1800);
              }}
              className="text-xs text-blue-400 hover:underline ml-1"
              title="회의 ID 복사"
            >
              {quickCopied ? '✓ 복사됨' : '복사'}
            </button>
          </div>

          <span className="badge bg-tertiary text-secondary hidden sm:inline-flex">
            참가자 {allParticipants.length}명
          </span>
        </div>

        <div className="meeting-header-right">
          {isElectron() && (
            <button
              onClick={() => setShowUpdateModal(true)}
              className="btn btn-secondary py-1.5 px-2.5 text-xs"
              title="무설치 자동/수동 업데이트 확인 및 설정"
            >
              <span>🔄 업데이트</span>
            </button>
          )}

          <button
            onClick={() => setShowShareModal(true)}
            className="btn btn-secondary py-1.5 px-3 text-xs hidden sm:inline-flex"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <span>화면 · 칠판 · PDF · 미디어 공유</span>
          </button>

          <button
            onClick={() => setShowInviteModal(true)}
            className="btn btn-primary py-1.5 px-3 text-xs"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            <span>초대</span>
          </button>
        </div>
      </header>

      {/* Screen Share Banner (Only when sharing OS screen, not CollaborationStage) */}
      {isScreenSharing && !hasCollaborationStage && (
        <ScreenShareBanner onStopShare={() => webrtcManager.stopScreenShare()} />
      )}

      {/* Connection Indicator */}
      <ConnectionIndicator isConnected={isConnected} error={connectionError} />

      {/* Main Workspace */}
      <main className="meeting-workspace">
        {hasCollaborationStage ? (
          <div className="collab-split-layout">
            <div className="collab-main-column">
              <CollaborationStage />
            </div>
            <aside className="collab-filmstrip scrollable" aria-label="참가자 카메라 목록">
              <div className="text-xs font-semibold text-secondary px-1">
                참가자 화면 ({allParticipants.length})
              </div>
              <VideoGrid
                participants={allParticipants}
                currentUserId={currentUser.id}
                localStream={localStream}
                screenStream={screenStream}
                remoteStreams={remoteStreams}
                isScreenSharing={false}
              />
            </aside>
          </div>
        ) : (
          <div className="meeting-stage-area">
            <VideoGrid
              participants={allParticipants}
              currentUserId={currentUser.id}
              localStream={localStream}
              screenStream={screenStream}
              remoteStreams={remoteStreams}
              isScreenSharing={isScreenSharing}
            />
          </div>
        )}

        {/* Right Docked Sidebar (Participants / Chat / Messenger) */}
        {showSidebar && (
          <aside
            className={`meeting-sidebar animate-fade-in ${
              sidebarContent === 'messenger' ? 'wide-messenger' : ''
            }`}
          >
            <div className="flex items-center justify-between p-2.5 border-b border-border-color gap-1.5">
              <div className="flex bg-primary rounded-lg p-1 flex-1 gap-0.5">
                <button
                  onClick={() => setSidebarContent('participants')}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold ${
                    sidebarContent === 'participants'
                      ? 'bg-accent-primary text-white'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  참가자 ({allParticipants.length})
                </button>
                <button
                  onClick={() => {
                    setSidebarContent('chat');
                    setLastSeenChatCount(messages.length);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold ${
                    sidebarContent === 'chat'
                      ? 'bg-accent-primary text-white'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  회의채팅 {unreadChatCount > 0 ? `(${unreadChatCount})` : ''}
                </button>
                <button
                  onClick={() => setSidebarContent('messenger')}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold ${
                    sidebarContent === 'messenger'
                      ? 'bg-accent-primary text-white'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  문자·파일 {unreadMessengerCount > 0 ? `(${unreadMessengerCount})` : ''}
                </button>
              </div>
              <button
                onClick={() => setShowSidebar(false)}
                className="btn btn-icon btn-ghost p-1.5"
                aria-label="사이드바 닫기"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              {sidebarContent === 'participants' ? (
                <ParticipantsPanel
                  participants={allParticipants}
                  currentUserId={currentUser.id}
                  currentUserIsHost={currentUser.isHost}
                />
              ) : sidebarContent === 'chat' ? (
                <ChatPanel
                  messages={messages}
                  currentUserId={currentUser.id}
                  currentUserName={currentUser.name}
                />
              ) : (
                <MessengerPanel embedded userName={currentUser.name} />
              )}
            </div>
          </aside>
        )}
      </main>

      {/* Bottom Control Dock */}
      <Toolbar
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        isScreenSharing={
          isScreenSharing || Boolean(hasCollaborationStage && shareSession?.ownerId === currentUser.id)
        }
        isRecording={isRecording}
        isHost={currentUser.isHost}
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onSwitchCamera={() => webrtcManager.switchCamera()}
        showSwitchCamera={isMobileDevice}
        onToggleScreenShare={handleToggleScreenShare}
        onOpenSharePicker={() => setShowShareModal(true)}
        onToggleRecording={handleToggleRecording}
        onShowParticipants={() => {
          if (showSidebar && sidebarContent === 'participants') {
            setShowSidebar(false);
          } else {
            setSidebarContent('participants');
            setShowSidebar(true);
          }
        }}
        onShowChat={() => {
          if (showSidebar && sidebarContent === 'chat') {
            setShowSidebar(false);
          } else {
            setSidebarContent('chat');
            setLastSeenChatCount(messages.length);
            setShowSidebar(true);
          }
        }}
        onShowMessenger={() => {
          if (showSidebar && sidebarContent === 'messenger') {
            setShowSidebar(false);
          } else {
            setSidebarContent('messenger');
            setShowSidebar(true);
          }
        }}
        onInvite={() => setShowInviteModal(true)}
        onLeaveMeeting={async () => {
          if (isRecording) {
            try {
              mediaRecorderRef.current?.stop();
            } catch {}
          }
          await webrtcManager.leaveMeeting();
          useAppStore.getState().reset();
        }}
        onSettings={() => useAppStore.getState().setShowSettings(true)}
        onFullscreen={() => setIsFullscreen(!isFullscreen)}
        isFullscreen={isFullscreen}
        participantCount={allParticipants.length}
        unreadChatCount={unreadChatCount}
        unreadMessengerCount={unreadMessengerCount}
      />

      {/* Invite Modal */}
      {showInviteModal && <InviteModal onClose={() => setShowInviteModal(false)} />}

      {/* Content & Screen Share Picker Modal */}
      {showShareModal && <SharePickerModal onClose={() => setShowShareModal(false)} />}

      {/* Live OTA Update Modal */}
      {showUpdateModal && <UpdateModal onClose={() => setShowUpdateModal(false)} />}
    </div>
  );
}
