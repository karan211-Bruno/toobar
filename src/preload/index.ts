// Main App Component
import React, { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from './store';
import { api } from './electron-bridge';
import { webrtcManager } from './webrtc';
import { LoginScreen } from './components/LoginScreen';
import { MeetingScreen } from './components/MeetingScreen';
import { SettingsModal } from './components/SettingsModal';
import { PreJoinScreen } from './components/PreJoinScreen';

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

  // Initialize media devices on mount
  useEffect(() => {
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

    // Listen for menu actions
    const cleanupNewMeeting = api.onMenuAction('menu-new-meeting', () => {
      if (!currentMeeting) {
        setShowSettings(false);
      }
    });
    const cleanupJoinMeeting = api.onMenuAction('menu-join-meeting', () => {
      if (!currentMeeting) {
        setShowSettings(false);
      }
    });

    return () => {
      cleanupNewMeeting();
      cleanupJoinMeeting();
    };
  }, [currentMeeting, setShowSettings]);

  // Initialize local media stream
  const initializeLocalStream = useCallback(async () => {
    const existingStream = useAppStore.getState().localStream;
    if (existingStream && existingStream.active) {
      await webrtcManager.syncLocalStream(existingStream);
      return;
    }

    try {
      const constraints = await api.getMediaConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      setIsConnected(true);
      setConnectionError(null);

      // Apply initial audio/video settings
      const { audioEnabled: curAudio, videoEnabled: curVideo } = useAppStore.getState();
      stream.getAudioTracks().forEach(track => (track.enabled = curAudio));
      stream.getVideoTracks().forEach(track => (track.enabled = curVideo));

      await webrtcManager.syncLocalStream(stream);

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
      setConnectionError('카메라/마이크 접근 권한이 없거나 장치를 찾을 수 없습니다.');
    }
  }, [setLocalStream, setIsConnected, setConnectionError]);

  // Handle login screen
  if (!currentUser && !currentMeeting && !isJoining) {
    return <LoginScreen onJoin={initializeLocalStream} />;
  }

  // Handle pre-join preview
  if (currentUser && isJoining) {
    return <PreJoinScreen onJoinComplete={initializeLocalStream} />;
  }

  // Main meeting screen
  if (currentMeeting) {
    return (
      <div className="h-screen w-screen flex flex-col bg-primary">
        <MeetingScreen />
        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} />
        )}
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
  showSaveDialog: (options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
  showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
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