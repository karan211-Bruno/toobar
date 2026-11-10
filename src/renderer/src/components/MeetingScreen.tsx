// Main Meeting Screen
import React, { useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../store';
import { api } from '../electron-bridge';
import { webrtcManager } from '../webrtc';
import { VideoGrid } from './VideoGrid';
import { Toolbar } from './Toolbar';
import { ParticipantsPanel } from './ParticipantsPanel';
import { ChatPanel } from './ChatPanel';
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
  const [sidebarContent, setSidebarContent] = useState<'participants' | 'chat'>('participants');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);

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

  return (
    <div className="app-screen">
      {/* Top Meeting Info & Quick Action Header */}
      <header className="meeting-header">
        <div className="meeting-header-left">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: isConnected ? '#10b981' : '#f59e0b' }}
            title={isConnected ? '실시간 연결됨' : '연결 중'}
          />
          <span className="font-semibold text-sm text-primary truncate" style={{ maxWidth: 200 }}>
            {currentMeeting.name}
          </span>

          <div className="meeting-id-pill">
            <span className="text-muted">회의 ID</span>
            <code className="font-mono font-bold text-primary tracking-wider select-all">
              {currentMeeting.id}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(currentMeeting.id);
                setQuickCopied(true);
                setTimeout(() => setQuickCopied(false), 1800);
              }}
              className="text-xs text-blue-400 hover:underline ml-1"
              title="회의 ID 복사"
            >
              {quickCopied ? '✓ 복사됨' : '복사'}
            </button>
          </div>

          <span className="badge bg-tertiary text-secondary">
            참가자 {allParticipants.length}명
          </span>
        </div>

        <div className="meeting-header-right">
          <button
            onClick={() => setShowUpdateModal(true)}
            className="btn btn-secondary py-1.5 px-2.5 text-xs"
            title="무설치 자동/수동 업데이트 확인 및 설정"
          >
            <span>🔄 업데이트</span>
          </button>

          <button
            onClick={() => setShowShareModal(true)}
            className="btn btn-secondary py-1.5 px-3 text-xs"
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
            <span>초대 링크 공유</span>
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

        {/* Right Docked Sidebar (Participants / Chat) */}
        {showSidebar && (
          <aside className="meeting-sidebar animate-fade-in">
            <div className="flex items-center justify-between p-3 border-b border-border-color gap-2">
              <div className="flex bg-primary rounded-lg p-1 flex-1">
                <button
                  onClick={() => setSidebarContent('participants')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold ${
                    sidebarContent === 'participants'
                      ? 'bg-accent-primary text-white'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  참가자 ({allParticipants.length})
                </button>
                <button
                  onClick={() => setSidebarContent('chat')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold ${
                    sidebarContent === 'chat'
                      ? 'bg-accent-primary text-white'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  채팅 ({messages.length})
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
              ) : (
                <ChatPanel
                  messages={messages}
                  currentUserId={currentUser.id}
                  currentUserName={currentUser.name}
                />
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
        onToggleScreenShare={handleToggleScreenShare}
        onOpenSharePicker={() => setShowShareModal(true)}
        onToggleRecording={() => useAppStore.getState().setIsRecording(!isRecording)}
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
            setShowSidebar(true);
          }
        }}
        onInvite={() => setShowInviteModal(true)}
        onLeaveMeeting={async () => {
          await webrtcManager.leaveMeeting();
          useAppStore.getState().reset();
        }}
        onSettings={() => useAppStore.getState().setShowSettings(true)}
        onFullscreen={() => setIsFullscreen(!isFullscreen)}
        isFullscreen={isFullscreen}
        participantCount={allParticipants.length}
        unreadChatCount={messages.length}
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
