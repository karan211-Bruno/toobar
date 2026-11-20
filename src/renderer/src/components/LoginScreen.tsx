// Login / Join Meeting & Cross-Platform Messenger Screen
import React, { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../store';
import { webrtcManager } from '../webrtc';
import { api, isElectron } from '../electron-bridge';
import { cloudBus, detectDevicePlatform, getPlatformLabel } from '../cloud-bus';
import { MessengerPanel } from './MessengerPanel';
import { v4 as uuidv4 } from 'uuid';

function parseInviteInput(raw: string): {
  meetingId: string;
  serverUrl?: string;
  isFullLink?: boolean;
} {
  const trimmed = raw.trim();
  if (
    trimmed.includes('meetingId=') ||
    trimmed.startsWith('toobar://')
  ) {
    try {
      const queryPart = trimmed.split('?')[1] || '';
      const params = new URLSearchParams(queryPart.split(/\s/)[0]);
      let id = params.get('meetingId') || params.get('room') || '';
      if (!id && trimmed.startsWith('toobar://')) {
        id = trimmed.replace(/^toobar:\/\/(join\/?)?/i, '').split(/[/?&\s]/)[0] || '';
      }
      const srv = params.get('server') || undefined;
      if (id) {
        return {
          meetingId: id.toUpperCase(),
          serverUrl: srv ? decodeURIComponent(srv) : undefined,
          isFullLink: true,
        };
      }
    } catch {
      // ignore
    }
  }
  const matchId = trimmed.match(/회의\s*ID\s*[:：]\s*([A-Za-z0-9-]+)/i);
  if (matchId?.[1]) {
    const srvMatch = trimmed.match(/[?&]server=([^&\s]+)/i);
    return {
      meetingId: matchId[1].toUpperCase(),
      serverUrl: srvMatch?.[1] ? decodeURIComponent(srvMatch[1]) : undefined,
      isFullLink: true,
    };
  }
  return { meetingId: trimmed.toUpperCase(), isFullLink: false };
}

export function LoginScreen({
  onJoin,
  onOpenUpdateModal,
}: {
  onJoin: () => void;
  onOpenUpdateModal?: () => void;
}) {
  const [userName, setUserName] = useState(
    () => localStorage.getItem('toobar_user_name') || ''
  );
  const [meetingId, setMeetingId] = useState('');
  const [password, setPassword] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'join' | 'new' | 'messenger'>('join');
  const [unreadMessengerCount, setUnreadMessengerCount] = useState(() =>
    cloudBus.getTotalUnreadCount()
  );

  const setSignalingUrl = useAppStore((s) => s.setSignalingUrl);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const setCurrentMeeting = useAppStore((s) => s.setCurrentMeeting);
  const setIsJoining = useAppStore((s) => s.setIsJoining);

  const currentPlatform = detectDevicePlatform();

  useEffect(() => {
    cloudBus.start();
    const unsub = cloudBus.onMessengerUpdate(() => {
      setUnreadMessengerCount(cloudBus.getTotalUnreadCount());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!userName && api.getNetworkInfo) {
      api
        .getNetworkInfo()
        .then((info) => {
          if (info?.defaultUserName && !localStorage.getItem('toobar_user_name')) {
            setUserName(info.defaultUserName);
            cloudBus.setMyName(info.defaultUserName);
          }
        })
        .catch(() => {});
    }
  }, [userName]);

  const connectDirectlyToMeeting = useCallback(
    async (targetMeetingId: string, targetServerUrl?: string) => {
      const resolvedName =
        userName.trim() || localStorage.getItem('toobar_user_name')?.trim() || '참가자';
      localStorage.setItem('toobar_user_name', resolvedName);
      cloudBus.setMyName(resolvedName);
      if (targetServerUrl) {
        setSignalingUrl(targetServerUrl);
      }

      setIsLoading(true);
      setError(null);
      try {
        await onJoin();
        const result = await webrtcManager.joinMeeting({
          userName: resolvedName,
          meetingId: targetMeetingId.trim().toUpperCase(),
          password: password.trim() || undefined,
          audioEnabled,
          videoEnabled,
        });

        if (result.success && result.meeting && result.user) {
          useAppStore.getState().setAudioEnabled(audioEnabled);
          useAppStore.getState().setVideoEnabled(videoEnabled);
          setCurrentUser(result.user);
          setCurrentMeeting(result.meeting);
          setIsJoining(false);
          await api.setWindowMeeting?.(result.meeting.id);
        } else {
          setError(result.error?.message || '회의 참가에 실패했습니다.');
        }
      } catch (err) {
        setError('연결에 실패했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.');
        console.error('Direct join error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [
      audioEnabled,
      onJoin,
      password,
      setCurrentMeeting,
      setCurrentUser,
      setIsJoining,
      setSignalingUrl,
      userName,
      videoEnabled,
    ]
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      const parsed = parseInviteInput(window.location.search);
      if (parsed.meetingId) {
        setMeetingId(parsed.meetingId);
        setActiveTab('join');
      }
      if (parsed.serverUrl) {
        setSignalingUrl(parsed.serverUrl);
      }
    }
  }, [setSignalingUrl]);

  const handleJoinMeeting = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!userName.trim() || !meetingId.trim()) {
        setError('이름과 회의 ID를 입력해주세요.');
        return;
      }

      localStorage.setItem('toobar_user_name', userName.trim());
      cloudBus.setMyName(userName.trim());
      setIsLoading(true);
      setError(null);

      try {
        await onJoin();
        const result = await webrtcManager.joinMeeting({
          userName: userName.trim(),
          meetingId: meetingId.trim().toUpperCase(),
          password: password.trim() || undefined,
          audioEnabled,
          videoEnabled,
        });

        if (result.success && result.meeting && result.user) {
          useAppStore.getState().setAudioEnabled(audioEnabled);
          useAppStore.getState().setVideoEnabled(videoEnabled);
          setCurrentUser(result.user);
          setCurrentMeeting(result.meeting);
          setIsJoining(false);
          await api.setWindowMeeting?.(result.meeting.id);
        } else {
          setError(result.error?.message || '회의 참가에 실패했습니다.');
        }
      } catch (err) {
        setError('연결에 실패했습니다. 잠시 후 다시 시도해주세요.');
        console.error('Join error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [
      userName,
      meetingId,
      password,
      audioEnabled,
      videoEnabled,
      setCurrentUser,
      setCurrentMeeting,
      setIsJoining,
      onJoin,
    ]
  );

  const handleNewMeeting = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!userName.trim()) {
        setError('이름을 입력해주세요.');
        return;
      }

      localStorage.setItem('toobar_user_name', userName.trim());
      cloudBus.setMyName(userName.trim());
      setIsLoading(true);
      setError(null);

      try {
        const newMeetingId = uuidv4().slice(0, 10).toUpperCase();
        const result = await webrtcManager.joinMeeting({
          userName: userName.trim(),
          meetingId: newMeetingId,
          audioEnabled,
          videoEnabled,
        });

        if (result.success && result.meeting && result.user) {
          useAppStore.getState().setAudioEnabled(audioEnabled);
          useAppStore.getState().setVideoEnabled(videoEnabled);
          setCurrentUser(result.user);
          setCurrentMeeting(result.meeting);
          setIsJoining(true);
        } else {
          setError(result.error?.message || '회의 생성에 실패했습니다.');
        }
      } catch (err) {
        setError('회의 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
        console.error('New meeting error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [userName, audioEnabled, videoEnabled, setCurrentUser, setCurrentMeeting, setIsJoining]
  );

  return (
    <div className="app-screen safe-area-screen overflow-y-auto p-3 sm:p-6">
      <div
        className={`w-full ${
          activeTab === 'messenger' ? 'max-w-4xl' : 'max-w-md'
        } mx-auto my-auto card p-4 sm:p-6 transition-all`}
      >
        {/* Logo & Platform Header */}
        <div className="text-center mb-4">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-2.5 shadow-lg overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 50%, #06B6D4 100%)',
            }}
          >
            <svg width="42" height="42" viewBox="0 0 1024 1024" fill="none">
              <rect
                x="180"
                y="200"
                width="664"
                height="108"
                rx="54"
                fill="#0F172A"
                fillOpacity="0.55"
                stroke="white"
                strokeOpacity="0.3"
                strokeWidth="10"
              />
              <circle cx="246" cy="254" r="22" fill="#34D399" />
              <circle cx="312" cy="254" r="22" fill="#38BDF8" />
              <rect x="368" y="238" width="260" height="32" rx="16" fill="white" fillOpacity="0.9" />
              <circle cx="776" cy="254" r="22" fill="#FB7185" />
              <rect x="180" y="370" width="460" height="410" rx="88" fill="white" />
              <path
                d="M 672 480 L 820 388 C 846 372 880 390 880 422 L 880 728 C 880 760 846 778 820 762 L 672 670 Z"
                fill="white"
              />
              <circle cx="410" cy="575" r="128" fill="#0284C7" />
              <circle cx="410" cy="575" r="94" fill="#0F172A" />
              <path d="M 352 520 H 468 V 550 H 426 V 642 H 394 V 550 H 352 Z" fill="#38BDF8" />
              <circle cx="372" cy="530" r="16" fill="white" fillOpacity="0.6" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-primary">Toobar</h1>
          <p className="text-xs text-secondary mt-0.5">
            화상 회의 · 문자 메신저 · 파일 공유 ({getPlatformLabel(currentPlatform)})
          </p>
        </div>

        {/* 3-Tab Navigation */}
        <div className="flex bg-secondary rounded-lg p-1 mb-5 gap-1" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'join'}
            onClick={() => {
              setActiveTab('join');
              setError(null);
            }}
            className={`flex-1 py-2 px-2 sm:px-4 rounded-md text-xs sm:text-sm font-medium transition ${
              activeTab === 'join'
                ? 'bg-accent-primary text-white shadow'
                : 'text-secondary hover:text-primary'
            }`}
          >
            회의 참가
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'new'}
            onClick={() => {
              setActiveTab('new');
              setError(null);
            }}
            className={`flex-1 py-2 px-2 sm:px-4 rounded-md text-xs sm:text-sm font-medium transition ${
              activeTab === 'new'
                ? 'bg-accent-primary text-white shadow'
                : 'text-secondary hover:text-primary'
            }`}
          >
            새 회의
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'messenger'}
            onClick={() => {
              setActiveTab('messenger');
              setError(null);
            }}
            className={`flex-1 py-2 px-2 sm:px-4 rounded-md text-xs sm:text-sm font-medium transition flex items-center justify-center gap-1.5 ${
              activeTab === 'messenger'
                ? 'bg-accent-primary text-white shadow'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <span>💬 문자 · 파일</span>
            {unreadMessengerCount > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-red-500 text-white font-bold">
                {unreadMessengerCount}
              </span>
            )}
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div
            className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-300 text-sm animate-slide-up"
            role="alert"
          >
            {error}
          </div>
        )}

        {activeTab === 'messenger' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="messengerUserName"
                className="text-xs font-medium text-secondary whitespace-nowrap"
              >
                내 표시 이름:
              </label>
              <input
                id="messengerUserName"
                type="text"
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value);
                  localStorage.setItem('toobar_user_name', e.target.value);
                  cloudBus.setMyName(e.target.value);
                }}
                placeholder="대화방에 표시될 이름"
                className="input py-1.5 px-3 text-xs flex-1 max-w-xs"
              />
            </div>

            <MessengerPanel
              userName={userName}
              onUserNameChange={(n) => setUserName(n)}
              onJoinMeetingById={(inviteRoomId) => {
                connectDirectlyToMeeting(inviteRoomId);
              }}
            />
          </div>
        ) : (
          <form
            onSubmit={activeTab === 'join' ? handleJoinMeeting : handleNewMeeting}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="userName"
                className="block text-sm font-medium text-secondary mb-1.5"
              >
                내 이름
              </label>
              <input
                id="userName"
                type="text"
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value);
                  cloudBus.setMyName(e.target.value);
                }}
                placeholder="표시될 이름"
                className="input w-full"
                autoComplete="name"
                required
              />
            </div>

            {activeTab === 'join' && (
              <div>
                <label
                  htmlFor="meetingId"
                  className="block text-sm font-medium text-secondary mb-1.5"
                >
                  회의 ID 또는 초대 링크
                </label>
                <input
                  id="meetingId"
                  type="text"
                  value={meetingId}
                  onChange={(e) => {
                    const parsed = parseInviteInput(e.target.value);
                    setMeetingId(parsed.meetingId);
                    if (parsed.serverUrl) {
                      setSignalingUrl(parsed.serverUrl);
                    }
                    if (parsed.isFullLink && parsed.meetingId) {
                      connectDirectlyToMeeting(parsed.meetingId, parsed.serverUrl);
                    }
                  }}
                  placeholder="회의 ID 또는 초대 링크(toobar://...) 붙여넣기"
                  className="input w-full text-center tracking-widest"
                  autoComplete="off"
                  required
                />
              </div>
            )}

            {activeTab === 'join' && (
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-secondary mb-1.5"
                >
                  회의 비밀번호 (선택사항)
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  className="input w-full"
                  autoComplete="current-password"
                />
              </div>
            )}

            <div className="flex items-center gap-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={audioEnabled}
                  onChange={(e) => setAudioEnabled(e.target.checked)}
                  className="w-4 h-4 accent-accent-primary rounded border-border-color bg-secondary"
                />
                <span className="text-sm text-secondary">오디오 켜기</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={videoEnabled}
                  onChange={(e) => setVideoEnabled(e.target.checked)}
                  className="w-4 h-4 accent-accent-primary rounded border-border-color bg-secondary"
                />
                <span className="text-sm text-secondary">비디오 켜기</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={
                isLoading || !userName.trim() || (activeTab === 'join' && !meetingId.trim())
              }
              className="btn btn-primary w-full py-3 text-base sm:text-lg mt-2"
            >
              {isLoading ? (
                <>
                  <span className="spinner" />
                  {activeTab === 'join' ? '참가 중...' : '회의 만들기...'}
                </>
              ) : activeTab === 'join' ? (
                '회의 참가'
              ) : (
                '새 회의 시작'
              )}
            </button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-5 pt-4 border-t border-border-color flex items-center justify-between text-xs text-muted flex-wrap gap-2">
          <div>
            <p className="font-medium text-secondary">Toobar v1.2.0</p>
            <p className="mt-0.5">
              Mac · iPhone · iPad · Windows · Ubuntu · Android 통합 지원
            </p>
          </div>
          {isElectron() && onOpenUpdateModal && (
            <button
              type="button"
              onClick={onOpenUpdateModal}
              className="btn btn-secondary py-1.5 px-3 text-xs"
            >
              🔄 업데이트 확인 / 설정
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
