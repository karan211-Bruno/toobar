// Shared types between main, renderer, mobile webviews, and signaling

// Type references for DOM APIs (available in browser/renderer context)
type RTCSessionDescriptionInit = { type: RTCSdpType; sdp?: string };
type RTCIceCandidateInit = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};
type RTCConfiguration = {
  iceServers?: RTCIceServer[];
  iceCandidatePoolSize?: number;
  iceTransportPolicy?: RTCIceTransportPolicy;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
  peerIdentity?: string;
  certificates?: RTCCertificate[];
};
type MediaStreamConstraints = {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
};
type MediaTrackConstraints = { [key: string]: any };
type RTCIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
};
type RTCSdpType = 'offer' | 'answer' | 'pranswer' | 'rollback';
type RTCIceTransportPolicy = 'relay' | 'all';
type RTCBundlePolicy = 'balanced' | 'max-compat' | 'max-bundle';
type RTCRtcpMuxPolicy = 'require' | 'negotiate';
type RTCCertificate = any;

export type DevicePlatform =
  | 'mac'
  | 'windows'
  | 'ubuntu'
  | 'iphone'
  | 'ipad'
  | 'android'
  | 'web';

export interface User {
  id: string;
  name: string;
  avatar?: string;
  userCode?: string;
  platform?: DevicePlatform | string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface Meeting {
  id: string;
  name: string;
  hostId: string;
  hostUpdatedAt?: number;
  participants: User[];
  createdAt: number;
  settings: MeetingSettings;
}

export interface MeetingSettings {
  allowScreenShare: boolean;
  allowChat: boolean;
  allowRecording: boolean;
  muteOnEntry: boolean;
  videoOnEntry: boolean;
  password?: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  progress?: number;
  isComplete?: boolean;
}

export interface ChatMessageItem {
  id: string;
  from: string;
  fromName: string;
  message: string;
  timestamp: number;
  to?: string;
  isPrivate?: boolean;
  attachment?: ChatAttachment;
}

export interface MessengerPeer {
  userCode: string;
  userName: string;
  platform: DevicePlatform | string;
  lastSeen: number;
}

export interface MessengerConversation {
  id: string; // 'public' | 'dm:<sortedA>:<sortedB>' | 'room:<CODE>'
  type: 'public' | 'dm' | 'room';
  title: string;
  peerCode?: string;
  roomCode?: string;
  unreadCount: number;
  updatedAt: number;
}

export interface MessengerMessage {
  id: string;
  conversationId: string;
  fromCode: string;
  fromName: string;
  fromPlatform: DevicePlatform | string;
  toCode?: string;
  roomCode?: string;
  text: string;
  timestamp: number;
  attachment?: ChatAttachment;
  meetingInviteId?: string;
}

export interface SignalingMessage {
  type: SignalingMessageType;
  payload: unknown;
  from: string;
  to?: string;
  meetingId: string;
  timestamp: number;
}

export type SignalingMessageType =
  | 'join'
  | 'leave'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'user-joined'
  | 'user-left'
  | 'user-updated'
  | 'meeting-state'
  | 'chat'
  | 'chat-file-chunk'
  | 'screen-share-start'
  | 'screen-share-stop'
  | 'share-state'
  | 'whiteboard-draw'
  | 'whiteboard-clear'
  | 'recording-start'
  | 'recording-stop'
  | 'kick-user'
  | 'mute-user'
  | 'transfer-host'
  | 'host-changed'
  | 'pdf-chunk'
  | 'error';

export type ShareMode =
  | 'none'
  | 'screen'
  | 'whiteboard'
  | 'presentation'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'youtube';

export interface YouTubeShareSettings {
  syncPlayback: boolean;
  allowParticipantControl: boolean;
  autoplay: boolean;
  captions: boolean;
  loop: boolean;
  showControls: boolean;
  privacyEnhanced: boolean;
  startMuted: boolean;
  defaultVolume: number;
  playbackRate: number;
}

export const DEFAULT_YOUTUBE_SHARE_SETTINGS: YouTubeShareSettings = {
  syncPlayback: true,
  allowParticipantControl: false,
  autoplay: true,
  captions: false,
  loop: false,
  showControls: true,
  privacyEnhanced: true,
  startMuted: false,
  defaultVolume: 80,
  playbackRate: 1,
};

export type VirtualBackgroundMode = 'none' | 'blur' | 'preset' | 'image';

export interface VirtualBackgroundConfig {
  mode: VirtualBackgroundMode;
  blurAmount: number;
  presetId: string;
  customImageId?: string | null;
  customImageDataUrl?: string | null;
  edgeSoftness?: number;
}

export interface CustomBackgroundItem {
  id: string;
  name: string;
  dataUrl: string;
}

export const DEFAULT_VIRTUAL_BACKGROUND_CONFIG: VirtualBackgroundConfig = {
  mode: 'none',
  blurAmount: 14,
  presetId: 'office',
  customImageId: null,
  customImageDataUrl: null,
  edgeSoftness: 2,
};

export interface WhiteboardStroke {
  id: string;
  tool: 'pen' | 'highlighter' | 'eraser' | 'line' | 'rect' | 'circle' | 'text';
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
}

export interface PresentationSlide {
  id: string;
  title: string;
  content?: string;
  imageUrl?: string;
  background?: string;
}

export interface ShareSessionState {
  mode: ShareMode;
  ownerId: string;
  ownerName: string;
  title?: string;
  slides?: PresentationSlide[];
  currentSlideIndex?: number;
  pdfDataUrl?: string;
  pdfId?: string;
  hostIp?: string;
  pdfPage?: number;
  mediaName?: string;
  mediaType?: 'video' | 'audio';
  youtubeVideoId?: string;
  youtubePlaylistId?: string;
  youtubeUrl?: string;
  youtubeIsPlaying?: boolean;
  youtubeCurrentTime?: number;
  youtubeUpdatedAt?: number;
  youtubeSettings?: YouTubeShareSettings;
}

export interface JoinPayload {
  userName: string;
  meetingId: string;
  password?: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  userCode?: string;
  platform?: DevicePlatform | string;
}

export interface OfferPayload {
  sdp: RTCSessionDescriptionInit;
  to: string;
}

export interface AnswerPayload {
  sdp: RTCSessionDescriptionInit;
  to: string;
}

export interface IceCandidatePayload {
  candidate: RTCIceCandidateInit;
  to: string;
}

export interface UserJoinedPayload {
  user: User;
}

export interface UserLeftPayload {
  userId: string;
}

export interface UserUpdatedPayload {
  userId: string;
  updates: Partial<User>;
}

export interface MeetingStatePayload {
  meeting: Meeting;
  currentUser: User;
}

export interface ChatPayload {
  id?: string;
  message: string;
  to?: string; // undefined = broadcast
  attachment?: Omit<ChatAttachment, 'dataUrl'> & { dataUrl?: string };
}

export interface ChatFileChunkPayload {
  messageId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  chunkIndex: number;
  totalChunks: number;
  chunkBase64: string;
  to?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

// WebRTC configuration
export const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

export const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 2,
  },
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: 'user',
  },
};

export const SCREEN_SHARE_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  },
};
