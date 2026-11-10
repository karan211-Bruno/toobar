// Participant Video Component
import React, { useRef, useEffect, useCallback } from 'react';
import type { User } from '@shared/types';
import { useAppStore } from '../store';
import { webrtcManager } from '../webrtc';

interface ParticipantVideoProps {
  user: User;
  stream: MediaStream | null;
  isLocal: boolean;
  isScreenShare: boolean;
  isLarge?: boolean;
}

export function ParticipantVideo({
  user,
  stream,
  isLocal,
  isScreenShare,
  isLarge = false,
}: ParticipantVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentUserIsHost = useAppStore((s) => Boolean(s.currentUser?.isHost));

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, user.videoEnabled, isScreenShare]);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const isSpeaking = user.audioEnabled && !isScreenShare;

  return (
    <div
      className={`participant-tile ${isLarge ? 'col-span-full row-span-2' : ''} ${
        isSpeaking ? 'speaking' : ''
      }`}
      role="group"
      aria-label={`${user.name}${isLocal ? ' (나)' : ''}${isScreenShare ? ' 화면 공유 중' : ''}`}
    >
      {/* Top: Unobstructed Video / Avatar Stage */}
      <div className="participant-video-stage">
        {stream && (
          <video
            ref={videoRef}
            autoPlay
            muted={isLocal}
            playsInline
            className={
              isScreenShare
                ? 'w-full h-full object-contain bg-black'
                : user.videoEnabled
                ? 'w-full h-full object-cover'
                : 'hidden'
            }
            onLoadedMetadata={handleLoadedMetadata}
            style={{ transform: isLocal && !isScreenShare ? 'scaleX(-1)' : 'none' }}
          />
        )}

        {(!stream || (!user.videoEnabled && !isScreenShare)) && (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <div className={`avatar ${isLarge ? 'avatar-xl' : 'avatar-lg'}`}>
              {getInitials(user.name)}
            </div>
            <p className="text-xs text-muted mt-2">
              {isScreenShare ? '화면 공유 중' : '카메라 꺼짐'}
            </p>
          </div>
        )}

        {isScreenShare && (
          <div className="absolute top-2 left-2 badge badge-speaking">
            <span>화면 공유 중</span>
          </div>
        )}
      </div>

      {/* Bottom: Dedicated Name & Status Bar BELOW the face video */}
      <div className="participant-footer-bar">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: user.audioEnabled ? '#10b981' : '#ef4444' }}
          />
          <span className="font-medium text-xs text-primary truncate">
            {user.name} {isLocal ? '(나)' : ''}
          </span>
          {user.isHost && (
            <span className="badge badge-host" style={{ padding: '1px 6px', fontSize: '10px' }}>
              👑 호스트
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {currentUserIsHost && !isLocal && !user.isHost && (
            <button
              onClick={() => webrtcManager.transferHost(user.id)}
              className="btn btn-secondary"
              style={{ padding: '2px 7px', fontSize: '10px', borderRadius: '6px' }}
              title={`${user.name}님에게 호스트 권한 넘기기`}
            >
              👑 호스트 넘기기
            </button>
          )}
          {!user.audioEnabled && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.2">
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="17" y1="17" x2="7" y2="7" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
