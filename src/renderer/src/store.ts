// Zustand store for app state management
import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import type {
  User,
  Meeting,
  MeetingSettings,
  ShareSessionState,
  WhiteboardStroke,
  ChatMessageItem,
  ChatAttachment,
} from '@shared/types';

interface AppState {
  // User state
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  updateCurrentUser: (updates: Partial<User>) => void;

  // Meeting state
  currentMeeting: Meeting | null;
  setCurrentMeeting: (meeting: Meeting | null) => void;
  updateMeetingSettings: (settings: Partial<MeetingSettings>) => void;
  addParticipant: (user: User) => void;
  removeParticipant: (userId: string) => void;
  updateParticipant: (userId: string, updates: Partial<User>) => void;
  transferHost: (newHostId: string) => void;

  // UI state
  isJoining: boolean;
  setIsJoining: (value: boolean) => void;
  showSettings: boolean;
  setShowSettings: (value: boolean) => void;
  activeTab: 'video' | 'chat' | 'participants' | 'settings';
  setActiveTab: (tab: AppState['activeTab']) => void;

  // Media state
  localStream: MediaStream | null;
  setLocalStream: (stream: MediaStream | null) => void;
  screenStream: MediaStream | null;
  setScreenStream: (stream: MediaStream | null) => void;
  remoteStreams: Record<string, MediaStream>;
  setRemoteStream: (userId: string, stream: MediaStream) => void;
  removeRemoteStream: (userId: string) => void;
  audioEnabled: boolean;
  setAudioEnabled: (value: boolean) => void;
  videoEnabled: boolean;
  setVideoEnabled: (value: boolean) => void;
  isScreenSharing: boolean;
  setIsScreenSharing: (value: boolean) => void;
  cameraFacingMode: 'user' | 'environment';
  setCameraFacingMode: (mode: 'user' | 'environment') => void;

  // Devices
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  videoInputDevices: MediaDeviceInfo[];
  setMediaDevices: (devices: {
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  }) => void;
  selectedAudioInput: string;
  setSelectedAudioInput: (deviceId: string) => void;
  selectedAudioOutput: string;
  setSelectedAudioOutput: (deviceId: string) => void;
  selectedVideoInput: string;
  setSelectedVideoInput: (deviceId: string) => void;

  // Chat
  messages: ChatMessageItem[];
  addMessage: (message: ChatMessageItem) => void;
  updateMessageAttachment: (messageId: string, updates: Partial<ChatAttachment>) => void;
  clearMessages: () => void;

  // Connection
  signalingUrl: string;
  setSignalingUrl: (url: string) => void;
  isConnected: boolean;
  setIsConnected: (value: boolean) => void;
  connectionError: string | null;
  setConnectionError: (error: string | null) => void;

  // Collaborative Share (Whiteboard / Presentation / PDF / Media)
  shareSession: ShareSessionState | null;
  setShareSession: (session: ShareSessionState | null) => void;
  sharedPdfBlobUrls: Record<string, string>;
  setSharedPdfBlobUrl: (pdfId: string, url: string) => void;
  whiteboardStrokes: WhiteboardStroke[];
  addWhiteboardStroke: (stroke: WhiteboardStroke) => void;
  clearWhiteboardStrokes: () => void;

  // Recording
  isRecording: boolean;
  setIsRecording: (value: boolean) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  currentUser: null,
  currentMeeting: null,
  isJoining: false,
  showSettings: false,
  activeTab: 'video' as const,
  localStream: null,
  screenStream: null,
  remoteStreams: {} as Record<string, MediaStream>,
  audioEnabled: true,
  videoEnabled: true,
  isScreenSharing: false,
  cameraFacingMode: 'user' as const,
  audioInputDevices: [],
  audioOutputDevices: [],
  videoInputDevices: [],
  selectedAudioInput: '',
  selectedAudioOutput: '',
  selectedVideoInput: '',
  messages: [] as ChatMessageItem[],
  signalingUrl: 'http://localhost:3002',
  isConnected: false,
  connectionError: null,
  shareSession: null as ShareSessionState | null,
  sharedPdfBlobUrls: {} as Record<string, string>,
  whiteboardStrokes: [] as WhiteboardStroke[],
  isRecording: false,
};

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        setCurrentUser: (user) => set({ currentUser: user }),
        updateCurrentUser: (updates) =>
          set((state) => ({
            currentUser: state.currentUser ? { ...state.currentUser, ...updates } : null,
          })),

        setCurrentMeeting: (meeting) => set({ currentMeeting: meeting }),
        updateMeetingSettings: (settings) =>
          set((state) => ({
            currentMeeting: state.currentMeeting
              ? {
                  ...state.currentMeeting,
                  settings: { ...state.currentMeeting.settings, ...settings },
                }
              : null,
          })),
        addParticipant: (user) =>
          set((state) => {
            if (!state.currentMeeting) return { currentMeeting: null };
            const exists = state.currentMeeting.participants.some((p) => p.id === user.id);
            const participants = exists
              ? state.currentMeeting.participants.map((p) => (p.id === user.id ? user : p))
              : [...state.currentMeeting.participants, user];
            return {
              currentMeeting: { ...state.currentMeeting, participants },
            };
          }),
        removeParticipant: (userId) =>
          set((state) => ({
            currentMeeting: state.currentMeeting
              ? {
                  ...state.currentMeeting,
                  participants: state.currentMeeting.participants.filter((p) => p.id !== userId),
                }
              : null,
          })),
        updateParticipant: (userId, updates) =>
          set((state) => ({
            currentMeeting: state.currentMeeting
              ? {
                  ...state.currentMeeting,
                  participants: state.currentMeeting.participants.map((p) =>
                    p.id === userId ? { ...p, ...updates } : p
                  ),
                }
              : null,
          })),
        transferHost: (newHostId) =>
          set((state) => ({
            currentUser: state.currentUser
              ? { ...state.currentUser, isHost: state.currentUser.id === newHostId }
              : null,
            currentMeeting: state.currentMeeting
              ? {
                  ...state.currentMeeting,
                  hostId: newHostId,
                  participants: state.currentMeeting.participants.map((p) => ({
                    ...p,
                    isHost: p.id === newHostId,
                  })),
                }
              : null,
          })),

        setIsJoining: (value) => set({ isJoining: value }),
        setShowSettings: (value) => set({ showSettings: value }),
        setActiveTab: (tab) => set({ activeTab: tab }),

        setLocalStream: (stream) => set({ localStream: stream }),
        setScreenStream: (stream) => set({ screenStream: stream }),
        setRemoteStream: (userId, stream) =>
          set((state) => ({
            remoteStreams: { ...state.remoteStreams, [userId]: stream },
          })),
        removeRemoteStream: (userId) =>
          set((state) => {
            const next = { ...state.remoteStreams };
            delete next[userId];
            return { remoteStreams: next };
          }),
        setAudioEnabled: (value) => {
          set({ audioEnabled: value });
          const { localStream, currentUser } = get();
          if (localStream) {
            localStream.getAudioTracks().forEach((track) => {
              track.enabled = value;
            });
          }
          if (currentUser) {
            get().updateCurrentUser({ audioEnabled: value });
            get().updateParticipant(currentUser.id, { audioEnabled: value });
          }
        },
        setVideoEnabled: (value) => {
          set({ videoEnabled: value });
          const { localStream, currentUser } = get();
          if (localStream) {
            localStream.getVideoTracks().forEach((track) => {
              track.enabled = value;
            });
          }
          if (currentUser) {
            get().updateCurrentUser({ videoEnabled: value });
            get().updateParticipant(currentUser.id, { videoEnabled: value });
          }
        },
        setIsScreenSharing: (value) => {
          set({ isScreenSharing: value });
          const { currentUser, screenStream } = get();
          if (!value && screenStream) {
            screenStream.getTracks().forEach((track) => track.stop());
            set({ screenStream: null });
          }
          if (currentUser) {
            get().updateCurrentUser({ screenSharing: value });
            get().updateParticipant(currentUser.id, { screenSharing: value });
          }
        },
        setCameraFacingMode: (mode) => set({ cameraFacingMode: mode }),

        setMediaDevices: (devices) =>
          set({
            audioInputDevices: devices.audioInputs,
            audioOutputDevices: devices.audioOutputs,
            videoInputDevices: devices.videoInputs,
          }),
        setSelectedAudioInput: (deviceId) => set({ selectedAudioInput: deviceId }),
        setSelectedAudioOutput: (deviceId) => set({ selectedAudioOutput: deviceId }),
        setSelectedVideoInput: (deviceId) => set({ selectedVideoInput: deviceId }),

        addMessage: (message) =>
          set((state) => {
            if (state.messages.some((m) => m.id === message.id)) {
              return { messages: state.messages };
            }
            return { messages: [...state.messages, message] };
          }),
        updateMessageAttachment: (messageId, updates) =>
          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId && m.attachment
                ? { ...m, attachment: { ...m.attachment, ...updates } }
                : m
            ),
          })),
        clearMessages: () => set({ messages: [] }),

        setSignalingUrl: (url) => set({ signalingUrl: url }),
        setIsConnected: (value) => set({ isConnected: value }),
        setConnectionError: (error) => set({ connectionError: error }),

        setShareSession: (session) => set({ shareSession: session }),
        setSharedPdfBlobUrl: (pdfId, url) =>
          set((state) => ({
            sharedPdfBlobUrls: { ...state.sharedPdfBlobUrls, [pdfId]: url },
          })),
        addWhiteboardStroke: (stroke) =>
          set((state) => ({ whiteboardStrokes: [...state.whiteboardStrokes, stroke] })),
        clearWhiteboardStrokes: () => set({ whiteboardStrokes: [] }),

        setIsRecording: (value) => set({ isRecording: value }),

        reset: () => {
          const { localStream, screenStream } = get();
          if (localStream) {
            localStream.getTracks().forEach((t) => t.stop());
          }
          if (screenStream) {
            screenStream.getTracks().forEach((t) => t.stop());
          }
          set(initialState);
        },
      }),
      {
        name: 'toobar-store',
        partialize: (state) => ({
          selectedAudioInput: state.selectedAudioInput,
          selectedAudioOutput: state.selectedAudioOutput,
          selectedVideoInput: state.selectedVideoInput,
          audioEnabled: state.audioEnabled,
          videoEnabled: state.videoEnabled,
        }),
      }
    ),
    { name: 'ToobarStore' }
  )
);
