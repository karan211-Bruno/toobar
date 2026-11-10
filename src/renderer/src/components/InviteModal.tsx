// Invite Modal - Share Meeting ID, Deep Link, Web Bridge Link, and Full Invitation Message
import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { api } from '../electron-bridge';

interface InviteModalProps {
  onClose: () => void;
}

export function InviteModal({ onClose }: InviteModalProps) {
  const currentMeeting = useAppStore((s) => s.currentMeeting);
  const currentUser = useAppStore((s) => s.currentUser);
  const signalingUrl = useAppStore((s) => s.signalingUrl);
  const setSignalingUrl = useAppStore((s) => s.setSignalingUrl);

  const [serverHost, setServerHost] = useState(signalingUrl || 'http://localhost:3002');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (api.getNetworkInfo) {
      api
        .getNetworkInfo()
        .then((info) => {
          if (info?.localIp && info.localIp !== '127.0.0.1') {
            if (!signalingUrl || signalingUrl.includes('localhost') || signalingUrl.includes('127.0.0.1')) {
              const lanUrl = `http://${info.localIp}:3002`;
              setServerHost(lanUrl);
            }
          }
        })
        .catch(() => {});
    }
  }, [signalingUrl]);

  if (!currentMeeting) return null;

  const meetingId = currentMeeting.id;
  const cleanServer = serverHost.trim();
  const encodedServer = encodeURIComponent(cleanServer);
  const appInviteLink = `toobar://join?meetingId=${meetingId}&server=${encodedServer}`;

  let hostIp = 'localhost';
  try {
    const parsed = new URL(cleanServer);
    hostIp = parsed.hostname;
  } catch {
    hostIp = 'localhost';
  }
  const webBridgeLink = `http://${hostIp}:3001/join?meetingId=${meetingId}&server=${encodedServer}`;

  const fullInviteText = `[Toobar 화상회의 초대]
${currentUser?.name || '호스트'}님이 화상회의에 초대했습니다.

• 아래 링크를 클릭하면 Toobar 프로그램이 자동으로 열리고 회의실에 바로 접속됩니다:
👉 바로 접속 링크 (클릭): ${webBridgeLink}

• 앱 직접 실행 링크: ${appInviteLink}
• 회의 ID (수동 입력 시): ${meetingId}`;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleTestDeepLink = async () => {
    if (api.openDeepLink) {
      await api.openDeepLink(appInviteLink);
      onClose();
    } else {
      window.location.href = appInviteLink;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-primary/20 text-accent-primary flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-primary">참가자 초대 (원클릭 자동 실행 링크)</h2>
              <p className="text-xs text-muted">링크 클릭 시 Toobar가 자동으로 열리고 바로 접속됩니다</p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-icon btn-ghost p-1" aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto" style={{ maxHeight: '75vh' }}>
          {/* 1. Clickable Web Bridge Link (For KakaoTalk / Slack / Browser) */}
          <div className="p-3.5 rounded-xl bg-tertiary border border-border-color space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-primary">
                🔗 원클릭 자동 접속 링크 (카카오톡·메신저·브라우저 클릭용)
              </label>
              <span className="badge badge-host">추천</span>
            </div>
            <p className="text-xs text-muted">
              메신저나 브라우저에서 이 링크를 누르면 자동으로 Toobar 앱이 실행되고 회의에 바로 입장합니다.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={webBridgeLink}
                className="input flex-1 text-xs font-mono select-all"
              />
              <button
                onClick={() => copyToClipboard(webBridgeLink, 'webLink')}
                className="btn btn-primary px-3 text-xs whitespace-nowrap"
              >
                {copiedField === 'webLink' ? '✓ 복사됨!' : '클릭 링크 복사'}
              </button>
            </div>
          </div>

          {/* 2. Direct App Deep Link (toobar://) */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              ⚡ 앱 직접 호출 스킴 링크 (toobar://)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={appInviteLink}
                className="input flex-1 text-xs font-mono select-all"
              />
              <button
                onClick={() => copyToClipboard(appInviteLink, 'appLink')}
                className="btn btn-secondary px-3 text-xs whitespace-nowrap"
              >
                {copiedField === 'appLink' ? '✓ 복사됨!' : '스킴 복사'}
              </button>
              <button
                onClick={handleTestDeepLink}
                className="btn btn-primary px-3 text-xs whitespace-nowrap"
                title="링크를 클릭했을 때처럼 새 창을 열어 즉시 회의에 접속합니다"
              >
                🚀 링크 바로 열기
              </button>
            </div>
          </div>

          {/* 3. Meeting ID */}
          <div className="p-3 rounded-xl bg-secondary border border-border-color flex items-center justify-between">
            <div>
              <span className="text-xs text-muted block mb-0.5">회의 ID (방 번호)</span>
              <span className="font-mono text-xl font-bold tracking-widest text-primary select-all">
                {meetingId}
              </span>
            </div>
            <button
              onClick={() => copyToClipboard(meetingId, 'id')}
              className="btn btn-secondary px-3 py-1.5 text-xs"
            >
              {copiedField === 'id' ? '✓ 복사 완료!' : '회의 ID 복사'}
            </button>
          </div>

          {/* Server Host setting for LAN/Remote */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">
              시그널링 서버 주소 (내 네트워크 IP 자동 감지됨)
            </label>
            <input
              type="text"
              value={serverHost}
              onChange={(e) => {
                setServerHost(e.target.value);
                setSignalingUrl(e.target.value);
              }}
              placeholder="예: http://192.168.0.10:3002"
              className="input w-full text-xs font-mono"
            />
          </div>

          {/* Full Invitation Message Preview */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-secondary">
                메신저/이메일용 초대장 문구
              </label>
              <button
                onClick={() => copyToClipboard(fullInviteText, 'full')}
                className="text-xs text-accent-primary hover:underline font-medium"
              >
                {copiedField === 'full' ? '✓ 초대장 전체 복사됨!' : '초대장 전체 복사'}
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-primary/70 border border-border-color text-xs text-secondary whitespace-pre-wrap font-sans leading-relaxed select-all">
              {fullInviteText}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-color flex justify-between items-center bg-secondary">
          <button
            onClick={() => copyToClipboard(fullInviteText, 'full')}
            className="btn btn-primary flex-1 mr-2 py-2.5"
          >
            {copiedField === 'full' ? '✓ 클립보드에 초대장이 복사되었습니다' : '초대장 메시지 전체 복사하기'}
          </button>
          <button onClick={onClose} className="btn btn-secondary px-4 py-2.5">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
