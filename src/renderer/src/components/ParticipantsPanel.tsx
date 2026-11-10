// Participants Panel
import React, { useState } from 'react';
import type { User } from '@shared/types';
import { useAppStore } from '../store';
import { webrtcManager } from '../webrtc';

interface ParticipantsPanelProps {
  participants: User[];
  currentUserId: string;
  currentUserIsHost: boolean;
}

export function ParticipantsPanel({
  participants,
  currentUserId,
  currentUserIsHost,
}: ParticipantsPanelProps) {
  const [copied, setCopied] = useState(false);
  const meetingId = useAppStore((s) => s.currentMeeting?.id || '');

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Sort: host first, then current user, then others
  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.isHost && !b.isHost) return -1;
    if (!a.isHost && b.isHost) return 1;
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-border-color flex items-center justify-between">
        <h3 className="font-semibold text-sm text-primary">참가자 ({participants.length})</h3>
        {currentUserIsHost && (
          <span className="badge badge-host">👑 내가 호스트</span>
        )}
      </div>

      <ul className="flex-1 overflow-y-auto divide-y" role="list">
        {sortedParticipants.map((participant) => (
          <li
            key={participant.id}
            className={`flex items-center gap-3 p-3 transition ${
              participant.id === currentUserId ? 'bg-accent-primary/10' : ''
            }`}
          >
            <div className="avatar avatar-sm">
              {getInitials(participant.name)}
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm text-primary truncate flex items-center gap-1.5">
                  <span className="truncate">{participant.name}</span>
                  {participant.id === currentUserId && (
                    <span className="badge bg-tertiary text-secondary">나</span>
                  )}
                  {participant.isHost && (
                    <span className="badge badge-host">👑 호스트</span>
                  )}
                </p>

                <div className="flex items-center gap-1 text-xs text-muted flex-shrink-0">
                  {participant.screenSharing && (
                    <span className="badge badge-speaking">공유 중</span>
                  )}
                </div>
              </div>

              {/* Host Controls Row */}
              {currentUserIsHost && participant.id !== currentUserId && (
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {!participant.isHost && (
                    <button
                      onClick={() => webrtcManager.transferHost(participant.id)}
                      className="btn btn-secondary py-1 px-2 text-xs"
                      title={`${participant.name}님에게 호스트 권한 넘기기`}
                    >
                      👑 호스트 넘기기
                    </button>
                  )}
                  <button
                    onClick={() =>
                      webrtcManager.muteParticipant(participant.id, participant.audioEnabled)
                    }
                    className={`btn py-1 px-2 text-xs ${
                      participant.audioEnabled ? 'btn-secondary' : 'btn-danger'
                    }`}
                  >
                    {participant.audioEnabled ? '🔇 음소거' : '🔊 음소거 해제'}
                  </button>
                  <button
                    onClick={() => webrtcManager.kickParticipant(participant.id)}
                    className="btn btn-danger py-1 px-2 text-xs"
                  >
                    퇴장
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="p-3 border-t border-border-color">
        <button
          onClick={() => {
            if (meetingId) {
              navigator.clipboard.writeText(meetingId);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
          className="btn btn-secondary w-full text-xs py-2"
        >
          {copied ? `✓ 회의 ID 복사됨 (${meetingId})` : `초대 (회의 ID 복사: ${meetingId})`}
        </button>
      </div>
    </div>
  );
}
