// In-App Live OTA Update Manager Modal (Auto & Manual Update)
import React, { useEffect, useState, useCallback } from 'react';
import { api, UpdateStatusInfo, UpdateEventPayload } from '../electron-bridge';

interface UpdateModalProps {
  onClose: () => void;
}

export function UpdateModal({ onClose }: UpdateModalProps) {
  const [status, setStatus] = useState<UpdateStatusInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [customServer, setCustomServer] = useState<string>(() => localStorage.getItem('toobar_update_server') || '');
  const [progress, setProgress] = useState<number | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!api.getUpdateStatus) return;
    try {
      const s = await api.getUpdateStatus();
      setStatus(s);
    } catch (err) {
      console.error('Failed to get update status:', err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    if (!api.onUpdateEvent) return;
    const unsub = api.onUpdateEvent((ev: UpdateEventPayload) => {
      if (ev.type === 'checking') {
        setIsChecking(true);
        setStatusMsg(ev.message || '최신 업데이트를 확인하는 중...');
      } else if (ev.type === 'downloading') {
        setIsChecking(true);
        if (typeof ev.progress === 'number') setProgress(ev.progress);
        setStatusMsg(ev.message || '업데이트 패키지 다운로드 중...');
      } else if (ev.type === 'update-downloaded') {
        setIsChecking(false);
        setProgress(100);
        setStatusMsg(
          `✨ 새 업데이트(${ev.manifest?.buildId || ev.manifest?.version}) 다운로드 완료! 바로 적용할 수 있습니다.`
        );
        refreshStatus();
      } else if (ev.type === 'up-to-date') {
        setIsChecking(false);
        setProgress(null);
        setStatusMsg(ev.message || '✓ 현재 최신 버전을 사용 중입니다.');
        refreshStatus();
      } else if (ev.type === 'applied') {
        setIsApplying(false);
        setStatusMsg('✓ 업데이트가 성공적으로 적용되었습니다!');
        refreshStatus();
      } else if (ev.type === 'error') {
        setIsChecking(false);
        setProgress(null);
        setStatusMsg(ev.message || '업데이트 확인 중 오류가 발생했습니다.');
      }
    });
    return () => unsub();
  }, [refreshStatus]);

  const handleCheckNow = async () => {
    if (!api.checkForUpdates) return;
    setIsChecking(true);
    setProgress(null);
    setStatusMsg('클라우드 브릿지 및 로컬 네트워크에서 최신 버전을 검색하고 있습니다...');
    if (customServer.trim()) {
      localStorage.setItem('toobar_update_server', customServer.trim());
    }
    try {
      const res = await api.checkForUpdates(customServer.trim() || undefined);
      setStatusMsg(res.message);
      await refreshStatus();
    } catch (err) {
      setStatusMsg(`업데이트 확인 실패: ${err}`);
    } finally {
      setIsChecking(false);
    }
  };

  const handleApplyNow = async (restartProcess = false) => {
    if (!api.applyUpdateNow) return;
    setIsApplying(true);
    setStatusMsg('최신 업데이트를 프로그램에 즉시 적용하고 있습니다...');
    try {
      await api.applyUpdateNow(restartProcess);
    } catch (err) {
      setIsApplying(false);
      setStatusMsg(`적용 오류: ${err}`);
    }
  };

  const handleToggleAutoUpdate = async (enabled: boolean) => {
    if (!api.setAutoUpdateEnabled) return;
    const res = await api.setAutoUpdateEnabled(enabled);
    setStatus((prev) => (prev ? { ...prev, autoUpdate: res.autoUpdate } : prev));
  };

  const formatTime = (ts?: number | null) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('ko-KR');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent-primary/20 text-accent-primary flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-primary">프로그램 무설치 자동 / 수동 업데이트</h2>
              <p className="text-xs text-muted">
                설치 파일(.dmg / .exe)을 다시 깔지 않고 앱 내부에서 즉시 최신 코드로 업데이트합니다
              </p>
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
          {/* Current Version Info Card */}
          <div className="p-4 rounded-xl bg-tertiary border border-border-color space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">현재 적용된 프로그램 버전</span>
              <span className="badge badge-host">
                v{status?.currentManifest.version || '1.0.0'} ({status?.currentManifest.buildId || '기본 빌드'})
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-secondary">
              <span>빌드 일시:</span>
              <span className="font-mono">{formatTime(status?.currentManifest.buildTimestamp)}</span>
            </div>
            {status?.latestManifest && status.latestManifest.buildTimestamp > status.currentManifest.buildTimestamp && (
              <div className="mt-2 pt-2 border-t border-border-color flex items-center justify-between text-xs">
                <span className="text-green-400 font-semibold">
                  ✨ 새로운 업데이트 준비됨: {status.latestManifest.buildId}
                </span>
                <span className="font-mono text-muted">
                  {formatTime(status.latestManifest.buildTimestamp)}
                </span>
              </div>
            )}
          </div>

          {/* Auto-Update Toggle */}
          <div className="p-3.5 rounded-xl bg-secondary border border-border-color flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-primary">🔄 자동 업데이트 활성화</div>
              <div className="text-xs text-muted mt-0.5">
                프로그램이 수정되면 백그라운드에서 자동으로 다운로드하고 즉시 반영합니다
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={status?.autoUpdate ?? true}
                onChange={(e) => handleToggleAutoUpdate(e.target.checked)}
                className="w-5 h-5 accent-accent-primary rounded cursor-pointer"
              />
              <span className="text-xs font-semibold text-primary">
                {status?.autoUpdate ?? true ? '켜짐' : '꺼짐'}
              </span>
            </label>
          </div>

          {/* Optional Direct Server IP */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">
              업데이트 서버 주소 (비워두면 클라우드 브릿지 & 로컬 네트워크에서 자동 탐색)
            </label>
            <input
              type="text"
              value={customServer}
              onChange={(e) => setCustomServer(e.target.value)}
              placeholder="자동 탐색 (또는 호스트 PC 주소 예: http://192.168.0.10:3001)"
              className="input w-full text-xs font-mono"
            />
          </div>

          {/* Progress Bar / Status Message */}
          {(statusMsg || progress !== null) && (
            <div className="p-3 rounded-lg bg-primary/80 border border-border-color space-y-2">
              {statusMsg && <p className="text-xs text-primary leading-relaxed">{statusMsg}</p>}
              {progress !== null && (
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-primary transition-all"
                    style={{ width: `${Math.min(100, Math.max(5, progress))}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleCheckNow}
              disabled={isChecking || isApplying}
              className="btn btn-primary w-full py-3 text-sm font-semibold"
            >
              {isChecking ? '🔍 최신 업데이트 검색 및 다운로드 중...' : '🔍 지금 수동으로 업데이트 확인 및 다운로드'}
            </button>

            {status?.updateReadyToApply && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleApplyNow(false)}
                  disabled={isApplying}
                  className="btn btn-success flex-1 py-2.5 text-xs font-semibold"
                >
                  ⚡ 화면 즉시 새로고침 적용 (0.1초 무중단)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyNow(true)}
                  disabled={isApplying}
                  className="btn btn-secondary py-2.5 px-3 text-xs font-semibold"
                >
                  🚀 앱 전체 재시작 적용
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-color flex justify-between items-center bg-secondary text-xs text-muted">
          <span>마지막 확인: {formatTime(status?.lastCheckedAt)}</span>
          <button onClick={onClose} className="btn btn-secondary px-4 py-2 text-xs">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
