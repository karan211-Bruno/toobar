// Meeting Bottom Dock Toolbar
import React from 'react';

interface ToolbarProps {
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
  isRecording: boolean;
  isHost: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onSwitchCamera?: () => void;
  showSwitchCamera?: boolean;
  onToggleScreenShare: () => void;
  onOpenSharePicker?: () => void;
  onToggleRecording: () => void;
  onShowParticipants: () => void;
  onShowChat: () => void;
  onShowMessenger?: () => void;
  onInvite?: () => void;
  onLeaveMeeting: () => void;
  onSettings: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
  participantCount?: number;
  unreadChatCount?: number;
  unreadMessengerCount?: number;
}

export function Toolbar({
  audioEnabled,
  videoEnabled,
  isScreenSharing,
  isRecording,
  onToggleAudio,
  onToggleVideo,
  onSwitchCamera,
  showSwitchCamera = false,
  onToggleScreenShare,
  onOpenSharePicker,
  onToggleRecording,
  onShowParticipants,
  onShowChat,
  onShowMessenger,
  onInvite,
  onLeaveMeeting,
  onSettings,
  onFullscreen,
  isFullscreen,
  participantCount = 1,
  unreadChatCount = 0,
  unreadMessengerCount = 0,
}: ToolbarProps) {
  return (
    <footer className="meeting-dock" role="toolbar" aria-label="회의 컨트롤 바">
      {/* Left: Microphone & Camera */}
      <div className="dock-group">
        <button
          onClick={onToggleAudio}
          onMouseDown={(e) => e.preventDefault()}
          className={`dock-btn ${audioEnabled ? '' : 'danger'}`}
          aria-label={audioEnabled ? '마이크 끄기 (Space)' : '마이크 켜기 (Space)'}
          aria-pressed={audioEnabled}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {audioEnabled ? (
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="8" y1="22" x2="16" y2="22" />
              </>
            ) : (
              <>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="17" y1="17" x2="7" y2="7" />
              </>
            )}
          </svg>
          <span>{audioEnabled ? '음소거' : '음소거 해제'}</span>
        </button>

        <button
          onClick={onToggleVideo}
          onMouseDown={(e) => e.preventDefault()}
          className={`dock-btn ${videoEnabled ? '' : 'danger'}`}
          aria-label={videoEnabled ? '비디오 끄기 (V)' : '비디오 켜기 (V)'}
          aria-pressed={videoEnabled}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {videoEnabled ? (
              <>
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </>
            ) : (
              <>
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                <line x1="1" y1="5" x2="23" y2="19" />
              </>
            )}
          </svg>
          <span>{videoEnabled ? '비디오 중지' : '비디오 시작'}</span>
        </button>

        {showSwitchCamera && onSwitchCamera && (
          <button
            onClick={onSwitchCamera}
            onMouseDown={(e) => e.preventDefault()}
            className="dock-btn"
            aria-label="전후면 카메라 전환"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4" />
              <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
            </svg>
            <span>카메라 전환</span>
          </button>
        )}
      </div>

      {/* Center: Collaboration, Invite, Participants, Chat, Record */}
      <div className="dock-group">
        <button
          onClick={isScreenSharing ? onToggleScreenShare : onOpenSharePicker || onToggleScreenShare}
          className={`dock-btn ${isScreenSharing ? 'active' : ''}`}
          style={
            !isScreenSharing
              ? { borderColor: 'rgba(16, 185, 129, 0.45)', color: '#34d399' }
              : undefined
          }
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
            <path d="M12 13V7M9 10l3-3 3 3" />
          </svg>
          <span>{isScreenSharing ? '공유 중지' : '화면·칠판·미디어 공유'}</span>
        </button>

        {isScreenSharing && onOpenSharePicker && (
          <button
            onClick={onOpenSharePicker}
            className="dock-btn"
            title="다른 콘텐츠로 공유 전환"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            </svg>
            <span>공유 모드 변경</span>
          </button>
        )}

        {onInvite && (
          <button onClick={onInvite} className="dock-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            <span>초대하기</span>
          </button>
        )}

        <button onClick={onShowParticipants} className="dock-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>참가자 ({participantCount})</span>
        </button>

        <button onClick={onShowChat} className="dock-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>회의 채팅 {unreadChatCount > 0 ? `(${unreadChatCount})` : ''}</span>
        </button>

        {onShowMessenger && (
          <button onClick={onShowMessenger} className="dock-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <span>문자·파일 {unreadMessengerCount > 0 ? `(${unreadMessengerCount})` : ''}</span>
          </button>
        )}

        <button
          onClick={onToggleRecording}
          className={`dock-btn ${isRecording ? 'danger animate-pulse' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="7" />
          </svg>
          <span>{isRecording ? '녹화 중지' : '녹화'}</span>
        </button>

        <button onClick={onSettings} className="dock-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>설정</span>
        </button>

        <button onClick={onFullscreen} className="dock-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isFullscreen ? (
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            ) : (
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            )}
          </svg>
          <span>{isFullscreen ? '창 모드' : '전체화면'}</span>
        </button>
      </div>

      {/* Right: Leave Meeting */}
      <div className="dock-group">
        <button onClick={onLeaveMeeting} className="dock-btn-leave">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>회의 나가기</span>
        </button>
      </div>
    </footer>
  );
}
