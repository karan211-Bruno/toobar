// Pre-Join Preview Screen (Compact 2-Column Window-Safe Layout)
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useAppStore } from '../store';
import { api } from '../electron-bridge';
import { webrtcManager } from '../webrtc';
import { virtualBackgroundEngine } from '../virtual-background';
import { BackgroundEffectsPanel } from './BackgroundEffectsPanel';

export function PreJoinScreen({ onJoinComplete }: { onJoinComplete: () => void }) {
  const {
    currentUser,
    currentMeeting,
    localStream,
    audioEnabled,
    videoEnabled,
    setAudioEnabled,
    setVideoEnabled,
    selectedAudioInput,
    selectedVideoInput,
    audioInputDevices,
    videoInputDevices,
    setSelectedAudioInput,
    setSelectedVideoInput,
    setRawLocalStream,
    setLocalStream,
    setIsJoining,
  } = useAppStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [copied, setCopied] = useState(false);

  // Initialize preview stream
  useEffect(() => {
    let mounted = true;
    let currentStream: MediaStream | null = null;

    const initPreview = async () => {
      try {
        const constraints = await api.getMediaConstraints();
        const audioConstraint =
          typeof constraints.audio === 'object' ? { ...constraints.audio } : {};
        const videoConstraint =
          typeof constraints.video === 'object' ? { ...constraints.video } : {};

        if (selectedAudioInput && selectedAudioInput !== 'default') {
          (audioConstraint as any).deviceId = { exact: selectedAudioInput };
        }
        if (selectedVideoInput && selectedVideoInput !== 'default') {
          (videoConstraint as any).deviceId = { exact: selectedVideoInput };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: videoConstraint,
        });
        currentStream = stream;

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const { audioEnabled: curAudio, videoEnabled: curVideo } = useAppStore.getState();
        stream.getAudioTracks().forEach((track) => (track.enabled = curAudio));
        stream.getVideoTracks().forEach((track) => (track.enabled = curVideo));

        setRawLocalStream(stream);
        const outputStream = (await virtualBackgroundEngine.applyRawStream(stream)) || stream;
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setLocalStream(outputStream);
        if (videoRef.current) {
          videoRef.current.srcObject = outputStream;
        }
        await webrtcManager.syncLocalStream(outputStream);

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = allDevices.filter((d) => d.kind === 'audioinput');
        const audioOutputs = allDevices.filter((d) => d.kind === 'audiooutput');
        const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
        useAppStore.getState().setMediaDevices({ audioInputs, audioOutputs, videoInputs });
      } catch (error) {
        console.error('Failed to start preview:', error);
      }
    };

    initPreview();

    return () => {
      mounted = false;
      if (currentStream && useAppStore.getState().isJoining) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selectedAudioInput, selectedVideoInput, setLocalStream]);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleJoin = useCallback(() => {
    setIsJoining(false);
    onJoinComplete();
  }, [onJoinComplete, setIsJoining]);

  const handleCancel = useCallback(async () => {
    await webrtcManager.leaveMeeting();
    useAppStore.getState().reset();
  }, []);

  if (!currentUser) return null;

  return (
    <div className="app-screen">
      {/* Top Bar */}
      <header className="meeting-header">
        <div className="meeting-header-left">
          <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-sm text-primary">회의 입장 대기실 (장치 확인)</h1>
          </div>
        </div>
        <div className="meeting-header-right">
          <span className="text-xs text-secondary">{currentUser.name} (나)</span>
          {currentUser.isHost && <span className="badge badge-host">👑 호스트</span>}
        </div>
      </header>

      {/* Scroll-safe Main Area with 2-Column Studio Grid */}
      <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <div className="prejoin-grid w-full max-w-6xl">
          {/* Left Column: Camera Preview */}
          <div className="flex flex-col">
            <div className="participant-tile" style={{ minHeight: '260px' }}>
              <div className="participant-video-stage">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ transform: 'scaleX(-1)' }}
                  className={`w-full h-full object-cover ${
                    localStream && videoEnabled ? 'block' : 'hidden'
                  }`}
                />
                {(!localStream || !videoEnabled) && (
                  <div className="w-full h-full flex flex-col items-center justify-center text-secondary">
                    <div className="avatar avatar-xl mb-3">
                      {currentUser.name.charAt(0).toUpperCase()}
                    </div>
                    <p className="text-sm">
                      {!videoEnabled ? '카메라가 꺼져 있습니다' : '카메라 준비 중...'}
                    </p>
                  </div>
                )}

                <div className="absolute top-3 left-3 badge bg-black/60 text-white">
                  미리보기
                </div>
              </div>

              {/* Name Bar BELOW the preview video (never covering the face) */}
              <div className="participant-footer-bar">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: audioEnabled ? '#10b981' : '#ef4444' }}
                  />
                  <span className="font-semibold text-xs text-primary">
                    {currentUser.name} (나)
                  </span>
                  {currentUser.isHost && <span className="badge badge-host">👑 호스트</span>}
                </div>
                <span className="text-xs text-muted">좌우 미러링 적용됨</span>
              </div>
            </div>
          </div>

          {/* Right Column: Controls & Join Action (Always visible in windowed mode) */}
          <div className="card p-5 flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-bold text-primary">회의 입장 준비 완료</h2>
              <p className="text-xs text-secondary mt-0.5">
                입장 전 마이크와 카메라 상태를 확인하세요
              </p>
            </div>

            {/* Meeting ID Box */}
            {currentMeeting && (
              <div className="flex items-center justify-between p-3 bg-tertiary rounded-lg border border-border-color">
                <div>
                  <span className="text-xs text-muted block">회의 ID (초대 코드)</span>
                  <code className="text-base font-mono font-bold text-primary tracking-widest select-all">
                    {currentMeeting.id}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(currentMeeting.id);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="btn btn-secondary py-1.5 px-3 text-xs"
                >
                  {copied ? '✓ 복사됨' : '회의 ID 복사'}
                </button>
              </div>
            )}

            {/* Microphone Selector */}
            <div className="p-3 bg-secondary rounded-lg border border-border-color">
              <label className="text-xs font-medium text-secondary mb-2 flex items-center justify-between">
                <span>🎤 마이크 설정</span>
                <span className={audioEnabled ? 'text-green-400' : 'text-red-400'}>
                  {audioEnabled ? '마이크 켜짐' : '음소거됨'}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={selectedAudioInput || 'default'}
                  onChange={(e) => setSelectedAudioInput(e.target.value)}
                  className="input flex-1 text-xs py-2"
                >
                  <option value="default">기본 마이크 장치</option>
                  {audioInputDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `마이크 ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const next = !audioEnabled;
                    setAudioEnabled(next);
                    webrtcManager.broadcastUserUpdate({ audioEnabled: next });
                  }}
                  className={`btn py-2 px-3 text-xs ${
                    audioEnabled ? 'btn-secondary' : 'btn-danger'
                  }`}
                >
                  {audioEnabled ? '끄기' : '켜기'}
                </button>
              </div>
            </div>

            {/* Camera Selector */}
            <div className="p-3 bg-secondary rounded-lg border border-border-color">
              <label className="text-xs font-medium text-secondary mb-2 flex items-center justify-between">
                <span>📹 카메라 설정</span>
                <span className={videoEnabled ? 'text-green-400' : 'text-red-400'}>
                  {videoEnabled ? '카메라 켜짐' : '카메라 꺼짐'}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={selectedVideoInput || 'default'}
                  onChange={(e) => setSelectedVideoInput(e.target.value)}
                  className="input flex-1 text-xs py-2"
                >
                  <option value="default">기본 카메라 장치</option>
                  {videoInputDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `카메라 ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const next = !videoEnabled;
                    setVideoEnabled(next);
                    virtualBackgroundEngine.setPaused(!next);
                    webrtcManager.broadcastUserUpdate({ videoEnabled: next });
                  }}
                  className={`btn py-2 px-3 text-xs ${
                    videoEnabled ? 'btn-secondary' : 'btn-danger'
                  }`}
                >
                  {videoEnabled ? '끄기' : '켜기'}
                </button>
              </div>
            </div>

            {/* Background Effects (Blur / Virtual Background) */}
            <div className="p-3 bg-secondary rounded-lg border border-border-color">
              <BackgroundEffectsPanel compact />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleJoin}
                className="btn btn-primary flex-1 py-3 text-base font-semibold"
              >
                지금 회의 입장하기
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="btn btn-secondary py-3 px-4 text-sm"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
