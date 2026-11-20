// Main App Component
import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useAppStore } from './store';
import { api, DeepLinkInvite, UpdateManifest } from './electron-bridge';
import { webrtcManager } from './webrtc';
import { cloudBus } from './cloud-bus';
import { virtualBackgroundEngine } from './virtual-background';
import { LoginScreen } from './components/LoginScreen';
import { MeetingScreen } from './components/MeetingScreen';
import { SettingsModal } from './components/SettingsModal';
import { PreJoinScreen } from './components/PreJoinScreen';
import { UpdateModal } from './components/UpdateModal';

export function App() {
  const {
    currentUser,
    currentMeeting,
    isJoining,
    showSettings,
    activeTab,
    setActiveTab,
    setShowSettings,
    reset,
    localStream,
    audioEnabled,
    videoEnabled,
    isScreenSharing,
    isConnected,
    connectionError,
    setConnectionError,
    setIsConnected,
    setCurrentUser,
    setCurrentMeeting,
    setLocalStream,
    setIsJoining,
    setAudioEnabled,
    setVideoEnabled,
    setIsScreenSharing,
  } = useAppStore();

  const mediaInitialized = useRef(false);
  const autoJoiningRef = useRef(false);
  const deepLinkCheckedRef = useRef(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [readyUpdateManifest, setReadyUpdateManifest] = useState<UpdateManifest | null>(null);

  // Sync window meeting state with Electron main process
  useEffect(() => {
    api.setWindowMeeting?.(currentMeeting?.id || null);
  }, [currentMeeting?.id]);

  // Initialize local media stream (gracefully falls back to audio-only or video-only if a device is missing)
  const initializeLocalStream = useCallback(async () => {
    const existingRaw = useAppStore.getState().rawLocalStream;
    const existingStream = useAppStore.getState().localStream;
    if (existingRaw && existingRaw.active) {
      const outputStream =
        (await virtualBackgroundEngine.applyRawStream(existingRaw)) || existingRaw;
      setLocalStream(outputStream);
      await webrtcManager.syncLocalStream(outputStream);
      return;
    }
    if (existingStream && existingStream.active) {
      await webrtcManager.syncLocalStream(existingStream);
      return;
    }

    try {
      const constraints = await api.getMediaConstraints();
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        // Fallback: try audio-only or video-only if one device is missing on this PC
        const tracks: MediaStreamTrack[] = [];
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio, video: false });
          tracks.push(...audioStream.getAudioTracks());
        } catch {}
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints.video });
          tracks.push(...videoStream.getVideoTracks());
        } catch {}
        if (tracks.length > 0) {
          stream = new MediaStream(tracks);
        }
      }

      if (stream) {
        const { audioEnabled: curAudio, videoEnabled: curVideo } = useAppStore.getState();
        stream.getAudioTracks().forEach(track => (track.enabled = curAudio));
        stream.getVideoTracks().forEach(track => (track.enabled = curVideo));

        useAppStore.getState().setRawLocalStream(stream);
        const outputStream = (await virtualBackgroundEngine.applyRawStream(stream)) || stream;
        setLocalStream(outputStream);
        setIsConnected(true);
        setConnectionError(null);

        await webrtcManager.syncLocalStream(outputStream);
      } else {
        setIsConnected(true);
      }

      // Refresh device list with labels after permission is granted
      const devices = await navigator.mediaDevices.enumerateDevices();
      useAppStore.getState().setMediaDevices({
        audioInputs: devices.filter(d => d.kind === 'audioinput'),
        audioOutputs: devices.filter(d => d.kind === 'audiooutput'),
        videoInputs: devices.filter(d => d.kind === 'videoinput'),
      });
    } catch (error) {
      console.error('Failed to initialize local stream:', error);
      setIsConnected(true);
    }
  }, [setLocalStream, setIsConnected, setConnectionError]);

  // Auto-join directly into MeetingScreen when launched via invite link (toobar:// or ?meetingId=...)
  const autoJoinFromInvite = useCallback(async (invite: DeepLinkInvite) => {
    const targetMeetingId = invite?.meetingId?.trim().toUpperCase();
    if (!targetMeetingId || autoJoiningRef.current) return;
    // If already connected to this exact meeting, do not re-join or reset audio/video state
    if (useAppStore.getState().currentMeeting?.id === targetMeetingId) return;
    autoJoiningRef.current = true;

    try {
      if (invite.serverUrl) {
        useAppStore.getState().setSignalingUrl(invite.serverUrl);
      }

      let resolvedName = invite.userName?.trim() || localStorage.getItem('toobar_user_name')?.trim() || '';
      if (!resolvedName && api.getNetworkInfo) {
        try {
          const info = await api.getNetworkInfo();
          resolvedName = info.defaultUserName || '참가자';
        } catch {
          resolvedName = '참가자';
        }
      }
      if (!resolvedName) {
        resolvedName = '참가자';
      }

      // Set initial audio/video enabled before joining & initializing media
      useAppStore.getState().setAudioEnabled(true);
      useAppStore.getState().setVideoEnabled(true);
      await initializeLocalStream();

      const result = await webrtcManager.joinMeeting({
        userName: resolvedName,
        meetingId: targetMeetingId,
        password: invite.password,
        audioEnabled: useAppStore.getState().audioEnabled,
        videoEnabled: useAppStore.getState().videoEnabled,
      });

      if (result.success && result.meeting && result.user) {
        setCurrentUser(result.user);
        setCurrentMeeting(result.meeting);
        // Skip PreJoinScreen waiting room -> connect directly into MeetingScreen
        setIsJoining(false);
        await api.setWindowMeeting?.(result.meeting.id);
        await initializeLocalStream();
      } else {
        setConnectionError(result.error?.message || '초대 링크를 통한 회의 접속에 실패했습니다.');
      }
    } catch (err) {
      console.error('Auto-join from deep link failed:', err);
      setConnectionError('서버 연결에 실패했습니다.');
    } finally {
      autoJoiningRef.current = false;
    }
  }, [initializeLocalStream, setConnectionError, setCurrentMeeting, setCurrentUser, setIsJoining]);

  // Initialize media devices and deep-link listeners on mount (once)
  useEffect(() => {
    cloudBus.start();

    const initMediaDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        useAppStore.getState().setMediaDevices({
          audioInputs: devices.filter(d => d.kind === 'audioinput'),
          audioOutputs: devices.filter(d => d.kind === 'audiooutput'),
          videoInputs: devices.filter(d => d.kind === 'videoinput'),
        });
      } catch (error) {
        console.error('Failed to get media devices:', error);
      }
    };
    initMediaDevices();

    // Native iOS / iPadOS / Android deep link bridge: window.__toobarHandleDeepLink('toobar://join?meetingId=...')
    (window as any).__toobarHandleDeepLink = (rawUrl: string) => {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      try {
        const queryPart = rawUrl.split('?')[1] || '';
        const params = new URLSearchParams(queryPart.split(/\s/)[0]);
        let mId = params.get('meetingId') || params.get('room') || '';
        if (!mId && rawUrl.startsWith('toobar://')) {
          mId = rawUrl.replace(/^toobar:\/\/(join\/?)?/i, '').split(/[/?&\s]/)[0] || '';
        }
        if (mId) {
          autoJoinFromInvite({
            meetingId: mId.toUpperCase(),
            serverUrl: params.get('server') || undefined,
            userName: params.get('name') || undefined,
            password: params.get('password') || undefined,
            autoJoin: true,
          });
        }
      } catch {
        // ignore
      }
    };

    // Check URL query string or pending deep link from main process ONCE
    const checkInitialDeepLink = async () => {
      if (deepLinkCheckedRef.current) return;
      deepLinkCheckedRef.current = true;

      if (typeof window !== 'undefined' && window.location.search) {
        const rawSearch = window.location.search;
        // Clear query string from history immediately so subsequent state changes never re-trigger autoJoin!
        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch {}

        const params = new URLSearchParams(rawSearch);
        const meetingId = params.get('meetingId') || params.get('room');
        if (meetingId) {
          if (api.consumeDeepLink) {
            await api.consumeDeepLink().catch(() => {});
          }
          await autoJoinFromInvite({
            meetingId: meetingId.toUpperCase(),
            serverUrl: params.get('server') || undefined,
            userName: params.get('name') || undefined,
            password: params.get('password') || undefined,
            autoJoin: true,
          });
          return;
        }
      }

      if (api.consumeDeepLink) {
        const pending = await api.consumeDeepLink();
        if (pending && pending.meetingId) {
          await autoJoinFromInvite(pending);
          return;
        }
      }
    };
    checkInitialDeepLink();

    const cleanupDeepLink = api.onDeepLinkInvite
      ? api.onDeepLinkInvite((invite) => {
          autoJoinFromInvite(invite);
        })
      : () => {};

    // Listen for menu actions
    const cleanupNewMeeting = api.onMenuAction('menu-new-meeting', () => {
      if (!useAppStore.getState().currentMeeting) {
        setShowSettings(false);
      }
    });
    const cleanupJoinMeeting = api.onMenuAction('menu-join-meeting', () => {
      if (!useAppStore.getState().currentMeeting) {
        setShowSettings(false);
      }
    });
    const cleanupAudioSettings = api.onMenuAction('menu-audio-settings', () => {
      useAppStore.getState().setActiveTab('settings');
      setShowSettings(true);
    });
    const cleanupVideoSettings = api.onMenuAction('menu-video-settings', () => {
      useAppStore.getState().setActiveTab('video');
      setShowSettings(true);
    });
    const cleanupCheckUpdates = api.onMenuAction('menu-check-updates', () => {
      setShowUpdateModal(true);
    });

    const cleanupUpdateEvent = api.onUpdateEvent
      ? api.onUpdateEvent((ev) => {
          if (ev.type === 'update-downloaded' && ev.manifest) {
            setReadyUpdateManifest(ev.manifest);
            // If autoUpdate is enabled and user is not in a meeting, apply automatically!
            if (ev.autoUpdate && !useAppStore.getState().currentMeeting) {
              setTimeout(() => {
                api.applyUpdateNow?.(false);
              }, 400);
            }
          } else if (ev.type === 'applied') {
            setReadyUpdateManifest(null);
          }
        })
      : () => {};

    return () => {
      cleanupDeepLink();
      cleanupNewMeeting();
      cleanupJoinMeeting();
      cleanupAudioSettings();
      cleanupVideoSettings();
      cleanupCheckUpdates();
      cleanupUpdateEvent();
    };
  }, [autoJoinFromInvite, setShowSettings]);

  const updateBanner = readyUpdateManifest ? (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
        color: '#ffffff',
        padding: '10px 18px',
        borderRadius: '999px',
        boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontSize: '13px',
        fontWeight: 600,
      }}
    >
      <span>✨ 새로운 프로그램 업데이트({readyUpdateManifest.buildId})가 다운로드되었습니다!</span>
      <button
        onClick={() => api.applyUpdateNow?.(false)}
        style={{
          background: '#ffffff',
          color: '#1d4ed8',
          border: 'none',
          borderRadius: '999px',
          padding: '4px 12px',
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        ⚡ 지금 즉시 적용
      </button>
      <button
        onClick={() => setShowUpdateModal(true)}
        style={{
          background: 'rgba(255,255,255,0.2)',
          color: '#ffffff',
          border: 'none',
          borderRadius: '999px',
          padding: '4px 10px',
          fontSize: '12px',
          cursor: 'pointer',
        }}
      >
        설정
      </button>
    </div>
  ) : null;

  // Handle login screen
  if (!currentUser && !currentMeeting && !isJoining) {
    return (
      <>
        {updateBanner}
        <LoginScreen
          onJoin={initializeLocalStream}
          onOpenUpdateModal={() => setShowUpdateModal(true)}
        />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showUpdateModal && <UpdateModal onClose={() => setShowUpdateModal(false)} />}
      </>
    );
  }

  // Handle pre-join preview
  if (currentUser && isJoining) {
    return (
      <>
        {updateBanner}
        <PreJoinScreen onJoinComplete={initializeLocalStream} />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showUpdateModal && <UpdateModal onClose={() => setShowUpdateModal(false)} />}
      </>
    );
  }

  // Main meeting screen
  if (currentMeeting) {
    return (
      <div className="h-screen w-screen flex flex-col bg-primary">
        {updateBanner}
        <MeetingScreen />
        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} />
        )}
        {showUpdateModal && <UpdateModal onClose={() => setShowUpdateModal(false)} />}
      </div>
    );
  }

  return null;
}

// Electron API bridge types
interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  joinMeeting: (payload: {
    userName: string;
    meetingId: string;
    password?: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
  }) => Promise<{
    success: boolean;
    meeting?: any;
    user?: any;
    error?: { code: string; message: string };
  }>;
  leaveMeeting: () => Promise<{ success: boolean }>;
  getMediaDevices: () => Promise<{
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  }>;
  getRTCConfig: () => Promise<RTCConfiguration>;
  getMediaConstraints: () => Promise<MediaStreamConstraints>;
  showSaveDialog: (options: any) => Promise<any>;
  showOpenDialog: (options: any) => Promise<any>;
  onMenuAction: (channel: string, listener: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    platform: {
      isMac: boolean;
      isWindows: boolean;
      isLinux: boolean;
    };
  }
}