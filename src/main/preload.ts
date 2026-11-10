// Preload script - Secure bridge between main and renderer
// Uses contextBridge to expose safe APIs

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Type definitions for DOM APIs (available in renderer context)
interface RTCIceServer { urls: string | string[]; username?: string; credential?: string; }
interface RTCConfiguration { iceServers?: RTCIceServer[]; iceCandidatePoolSize?: number; }
interface MediaTrackConstraints { [key: string]: any; }
interface MediaStreamConstraints { audio?: boolean | MediaTrackConstraints; video?: boolean | MediaTrackConstraints; }

// Type definitions for exposed APIs
export interface DeepLinkInvite {
  meetingId: string;
  serverUrl?: string;
  userName?: string;
  password?: string;
  autoJoin: boolean;
}

export interface UpdateManifest {
  version: string;
  buildId: string;
  buildTimestamp: number;
  notes?: string;
  hash: string;
}

export interface UpdateStatusInfo {
  currentManifest: UpdateManifest;
  latestManifest: UpdateManifest | null;
  hasUpdate: boolean;
  updateReadyToApply: boolean;
  autoUpdate: boolean;
  lastCheckedAt: number | null;
}

export interface UpdateEventPayload {
  type: 'checking' | 'update-available' | 'downloading' | 'update-downloaded' | 'up-to-date' | 'applied' | 'error';
  manifest?: UpdateManifest;
  progress?: number;
  autoUpdate?: boolean;
  message?: string;
}

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
  consumeDeepLink: () => Promise<DeepLinkInvite | null>;
  onDeepLinkInvite: (listener: (invite: DeepLinkInvite) => void) => () => void;
  setWindowMeeting: (meetingId: string | null) => Promise<void>;
  openDeepLink: (url: string) => Promise<{ success: boolean }>;
  getNetworkInfo: () => Promise<{ localIp: string; defaultUserName: string }>;
  getUpdateStatus: () => Promise<UpdateStatusInfo>;
  checkForUpdates: (customServerUrl?: string) => Promise<{
    hasUpdate: boolean;
    manifest?: UpdateManifest;
    applied?: boolean;
    message: string;
  }>;
  applyUpdateNow: (restartProcess?: boolean) => Promise<{ success: boolean }>;
  setAutoUpdateEnabled: (enabled: boolean) => Promise<{ autoUpdate: boolean }>;
  onUpdateEvent: (listener: (event: UpdateEventPayload) => void) => () => void;
}

interface MediaDeviceInfo {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  groupId: string;
}

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  joinMeeting: (payload) => ipcRenderer.invoke('join-meeting', payload),
  leaveMeeting: () => ipcRenderer.invoke('leave-meeting'),
  getMediaDevices: () => ipcRenderer.invoke('get-media-devices'),
  getRTCConfig: () => ipcRenderer.invoke('get-rtc-config'),
  getMediaConstraints: () => ipcRenderer.invoke('get-media-constraints'),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // Menu actions
  onMenuAction: (channel, listener) => {
    const handler = (_event: IpcRendererEvent) => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Deep link & network helpers
  consumeDeepLink: () => ipcRenderer.invoke('consume-deep-link'),
  onDeepLinkInvite: (listener) => {
    const handler = (_event: IpcRendererEvent, invite: DeepLinkInvite) => listener(invite);
    ipcRenderer.on('deep-link-invite', handler);
    return () => ipcRenderer.removeListener('deep-link-invite', handler);
  },
  setWindowMeeting: (meetingId) => ipcRenderer.invoke('set-window-meeting', meetingId),
  openDeepLink: (url) => ipcRenderer.invoke('open-deep-link', url),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  checkForUpdates: (customServerUrl) => ipcRenderer.invoke('check-for-updates', customServerUrl),
  applyUpdateNow: (restartProcess) => ipcRenderer.invoke('apply-update-now', restartProcess),
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('set-auto-update-enabled', enabled),
  onUpdateEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: UpdateEventPayload) => listener(payload);
    ipcRenderer.on('update-event', handler);
    return () => ipcRenderer.removeListener('update-event', handler);
  },
} satisfies ElectronAPI);

// Expose platform info
contextBridge.exposeInMainWorld('platform', {
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
});

// Security: Disable Node.js integration in renderer
// The renderer cannot access require, process, or Node.js APIs