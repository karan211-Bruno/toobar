// WebRTC + Socket.io Multi-Client Manager
import { io, Socket } from 'socket.io-client';
import type {
  JoinPayload,
  SignalingMessage,
  OfferPayload,
  AnswerPayload,
  IceCandidatePayload,
  UserJoinedPayload,
  UserLeftPayload,
  UserUpdatedPayload,
  MeetingStatePayload,
  ErrorPayload,
  ShareSessionState,
  WhiteboardStroke,
} from '@shared/types';
import { useAppStore } from './store';
import { api } from './electron-bridge';

const DEFAULT_SIGNALING_URL = 'http://localhost:3002';

const DEFAULT_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

class WebRTCManager {
  private socket: Socket | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private remoteStreams = new Map<string, MediaStream>();
  private rtcConfig: RTCConfiguration = DEFAULT_RTC_CONFIGURATION;
  private currentMeetingId: string | null = null;
  private currentUserId: string | null = null;
  private activeSignalingUrl: string = DEFAULT_SIGNALING_URL;
  private incomingPdfChunks = new Map<
    string,
    { chunks: string[]; received: number; total: number }
  >();

  private ensureSocket(): Socket {
    const targetUrl = useAppStore.getState().signalingUrl || DEFAULT_SIGNALING_URL;
    if (this.socket && this.socket.connected && this.activeSignalingUrl === targetUrl) {
      return this.socket;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }

    this.activeSignalingUrl = targetUrl;
    const socket = io(targetUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('[WebRTC] Connected to signaling server:', socket.id);
      useAppStore.getState().setIsConnected(true);
      useAppStore.getState().setConnectionError(null);
    });

    socket.on('disconnect', (reason) => {
      console.log('[WebRTC] Disconnected from signaling server:', reason);
      useAppStore.getState().setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('[WebRTC] Signaling connection error:', err);
      useAppStore.getState().setIsConnected(false);
      useAppStore.getState().setConnectionError('시그널링 서버 연결 대기 중...');
    });

    socket.on('signaling', (message: SignalingMessage) => {
      this.handleSignalingMessage(message);
    });

    this.socket = socket;
    return socket;
  }

  public async joinMeeting(payload: JoinPayload): Promise<{
    success: boolean;
    meeting?: any;
    user?: any;
    error?: { code: string; message: string };
  }> {
    try {
      const config = await api.getRTCConfig();
      if (config) {
        this.rtcConfig = config;
      }
    } catch {
      // Fallback to default RTC_CONFIGURATION
    }

    let socket = this.ensureSocket();

    if (!socket.connected) {
      const targetUrl = useAppStore.getState().signalingUrl || DEFAULT_SIGNALING_URL;
      const connected = await new Promise<boolean>((resolve) => {
        const timeoutMs = targetUrl !== DEFAULT_SIGNALING_URL ? 1500 : 5000;
        const timer = setTimeout(() => {
          resolve(false);
        }, timeoutMs);

        socket.once('connect', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });

      if (!connected) {
        if (targetUrl !== DEFAULT_SIGNALING_URL) {
          console.log('[WebRTC] Remote signaling URL unreachable, falling back to local Cross-PC Bridge server (localhost:3002)');
          useAppStore.getState().setSignalingUrl(DEFAULT_SIGNALING_URL);
          socket = this.ensureSocket();
          if (!socket.connected) {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('시그널링 서버 연결 시간 초과')), 4000);
              socket.once('connect', () => {
                clearTimeout(timer);
                resolve();
              });
            });
          }
        } else {
          throw new Error('시그널링 서버 연결 시간 초과');
        }
      }
    }

    return new Promise((resolve) => {
      socket.emit(
        'join',
        payload,
        (response: {
          success: boolean;
          meetingState?: MeetingStatePayload;
          error?: ErrorPayload;
        }) => {
          if (response?.success && response.meetingState) {
            const { meeting, currentUser } = response.meetingState;
            this.currentMeetingId = meeting.id;
            this.currentUserId = currentUser.id;
            useAppStore.getState().setIsConnected(true);
            useAppStore.getState().setConnectionError(null);

            // Ensure WebRTC connections are initiated with any existing participants
            const existingPeers = (meeting.participants || []).filter(
              (p: any) => p.id && p.id !== currentUser.id
            );
            if (existingPeers.length > 0) {
              setTimeout(() => {
                for (const peer of existingPeers) {
                  if (!this.peerConnections.has(peer.id) && this.currentMeetingId === meeting.id) {
                    this.initiateOffer(peer.id);
                  }
                }
              }, 600);
            }

            resolve({
              success: true,
              meeting,
              user: currentUser,
            });
          } else {
            resolve({
              success: false,
              error: response?.error || {
                code: 'JOIN_FAILED',
                message: '회의 참가에 실패했습니다.',
              },
            });
          }
        }
      );
    });
  }

  public async connectToExistingParticipants(): Promise<void> {
    const { currentMeeting, currentUser } = useAppStore.getState();
    if (!currentMeeting || !currentUser) return;

    // Note: Existing participants will send offers to us upon 'user-joined',
    // or if we already received offers while in PreJoinScreen, syncLocalStream will attach our tracks.
    const localStream = useAppStore.getState().localStream;
    if (localStream) {
      await this.syncLocalStream(localStream);
    }
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peerConnections.get(peerId);
    if (existing) {
      return existing;
    }

    console.log(`[WebRTC] Creating RTCPeerConnection for peer: ${peerId}`);
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);

    // Attach local tracks if available
    const { localStream, screenStream, isScreenSharing } = useAppStore.getState();
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        pc.addTrack(audioTrack, localStream);
      }

      const activeVideoTrack =
        isScreenSharing && screenStream
          ? screenStream.getVideoTracks()[0]
          : localStream.getVideoTracks()[0];

      if (activeVideoTrack) {
        pc.addTrack(activeVideoTrack, isScreenSharing && screenStream ? screenStream : localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && this.currentMeetingId && this.currentUserId) {
        this.sendSignalingMessage({
          type: 'ice-candidate',
          payload: {
            candidate: event.candidate.toJSON(),
            to: peerId,
          } as IceCandidatePayload,
          from: this.currentUserId,
          to: peerId,
          meetingId: this.currentMeetingId,
          timestamp: Date.now(),
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track (${event.track.kind}) from ${peerId}`);
      let stream = this.remoteStreams.get(peerId);
      if (event.streams && event.streams[0]) {
        stream = event.streams[0];
      } else {
        if (!stream) {
          stream = new MediaStream();
        }
        if (!stream.getTracks().some((t) => t.id === event.track.id)) {
          stream.addTrack(event.track);
        }
      }

      this.remoteStreams.set(peerId, stream);
      useAppStore.getState().setRemoteStream(peerId, stream);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${peerId} connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // Keep participant in list until signaling says they left, or clean up if closed
      }
    };

    return pc;
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    switch (message.type) {
      case 'user-joined': {
        const { user } = message.payload as UserJoinedPayload;
        if (!user || user.id === this.currentUserId) return;

        console.log(`[WebRTC] User joined: ${user.name} (${user.id})`);
        useAppStore.getState().addParticipant(user);

        // Initiate WebRTC offer to the newly joined user
        await this.initiateOffer(user.id);

        // If we are currently hosting a collaborative share session, sync it to the new user
        const { shareSession, whiteboardStrokes } = useAppStore.getState();
        if (shareSession && shareSession.ownerId === this.currentUserId && this.currentMeetingId) {
          if (shareSession.mode === 'pdf') {
            fetch('http://127.0.0.1:3001/shared-pdf-rebroadcast', { method: 'POST' }).catch(() => {});
          }
          this.sendSignalingMessage({
            type: 'share-state',
            payload: shareSession,
            from: this.currentUserId,
            meetingId: this.currentMeetingId,
            timestamp: Date.now(),
          });
          for (const stroke of whiteboardStrokes) {
            this.sendSignalingMessage({
              type: 'whiteboard-draw',
              payload: stroke,
              from: this.currentUserId,
              meetingId: this.currentMeetingId,
              timestamp: Date.now(),
            });
          }
        }
        break;
      }

      case 'user-left': {
        const { userId } = message.payload as UserLeftPayload;
        console.log(`[WebRTC] User left: ${userId}`);
        this.closePeerConnection(userId);
        useAppStore.getState().removeParticipant(userId);
        break;
      }

      case 'offer': {
        const { sdp } = message.payload as OfferPayload;
        const peerId = message.from;
        if (!peerId || !sdp) return;

        console.log(`[WebRTC] Received offer from ${peerId}`);
        const pc = this.createPeerConnection(peerId);
        const isPolite = (this.currentUserId || '') < peerId;

        try {
          if (pc.signalingState !== 'stable') {
            if (!isPolite) {
              console.log(`[WebRTC] Ignoring colliding offer from ${peerId} (impolite peer)`);
              return;
            }
            await Promise.all([
              pc.setLocalDescription({ type: 'rollback' }),
              pc.setRemoteDescription(new RTCSessionDescription(sdp)),
            ]);
          } else {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          }

          await this.flushPendingCandidates(peerId, pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          if (pc.localDescription && this.currentMeetingId && this.currentUserId) {
            this.sendSignalingMessage({
              type: 'answer',
              payload: {
                sdp: pc.localDescription,
                to: peerId,
              } as AnswerPayload,
              from: this.currentUserId,
              to: peerId,
              meetingId: this.currentMeetingId,
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.error(`[WebRTC] Error handling offer from ${peerId}:`, err);
        }
        break;
      }

      case 'answer': {
        const { sdp } = message.payload as AnswerPayload;
        const peerId = message.from;
        if (!peerId || !sdp) return;

        console.log(`[WebRTC] Received answer from ${peerId}`);
        const pc = this.peerConnections.get(peerId);
        if (!pc) return;

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await this.flushPendingCandidates(peerId, pc);
        } catch (err) {
          console.error(`[WebRTC] Error setting remote answer from ${peerId}:`, err);
        }
        break;
      }

      case 'ice-candidate': {
        const { candidate } = message.payload as IceCandidatePayload;
        const peerId = message.from;
        if (!peerId || !candidate) return;

        const pc = this.peerConnections.get(peerId);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error(`[WebRTC] Error adding ICE candidate from ${peerId}:`, err);
          }
        } else {
          const queue = this.pendingCandidates.get(peerId) || [];
          queue.push(candidate);
          this.pendingCandidates.set(peerId, queue);
        }
        break;
      }

      case 'user-updated': {
        const { userId, updates } = message.payload as UserUpdatedPayload;
        useAppStore.getState().updateParticipant(userId, updates);

        // If the server updated our own user (e.g., host muted us or transferred host role)
        if (userId === this.currentUserId) {
          useAppStore.getState().updateCurrentUser(updates);
          if (typeof updates.audioEnabled === 'boolean') {
            const { localStream } = useAppStore.getState();
            localStream?.getAudioTracks().forEach((t) => (t.enabled = updates.audioEnabled!));
            useAppStore.setState({ audioEnabled: updates.audioEnabled });
          }
        }
        break;
      }

      case 'screen-share-start': {
        const { userId } = message.payload as { userId: string };
        useAppStore.getState().updateParticipant(userId, { screenSharing: true });
        break;
      }

      case 'screen-share-stop': {
        const { userId } = message.payload as { userId: string };
        useAppStore.getState().updateParticipant(userId, { screenSharing: false });
        const curSession = useAppStore.getState().shareSession;
        if (curSession && (curSession.ownerId === userId || userId === this.currentUserId)) {
          useAppStore.getState().setShareSession(null);
        }
        if (userId === this.currentUserId) {
          useAppStore.getState().setIsScreenSharing(false);
        }
        break;
      }

      case 'share-state': {
        const session = message.payload as ShareSessionState | null;
        const prevSession = useAppStore.getState().shareSession;
        if (!session) {
          if (prevSession?.ownerId) {
            useAppStore.getState().updateParticipant(prevSession.ownerId, { screenSharing: false });
          }
          if (useAppStore.getState().isScreenSharing) {
            useAppStore.getState().setIsScreenSharing(false);
          }
        } else if (session.ownerId !== this.currentUserId && useAppStore.getState().isScreenSharing) {
          // Another participant took over the collaboration stage
          useAppStore.getState().setIsScreenSharing(false);
        }
        useAppStore.getState().setShareSession(session);
        break;
      }

      case 'pdf-chunk': {
        const { pdfId, chunkIndex, totalChunks, chunkBase64 } = (message.payload || {}) as {
          pdfId: string;
          chunkIndex: number;
          totalChunks: number;
          chunkBase64: string;
        };
        if (!pdfId || typeof chunkIndex !== 'number' || !totalChunks || !chunkBase64) break;
        let entry = this.incomingPdfChunks.get(pdfId);
        if (!entry) {
          entry = { chunks: new Array(totalChunks).fill(''), received: 0, total: totalChunks };
          this.incomingPdfChunks.set(pdfId, entry);
        }
        if (!entry.chunks[chunkIndex]) {
          entry.chunks[chunkIndex] = chunkBase64;
          entry.received += 1;
          if (entry.received === entry.total) {
            const fullB64 = entry.chunks.join('');
            this.incomingPdfChunks.delete(pdfId);
            try {
              const binaryStr = atob(fullB64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              fetch(`http://127.0.0.1:3001/shared-pdf-cache?pdfId=${encodeURIComponent(pdfId)}`, {
                method: 'POST',
                body: bytes.buffer,
              }).catch(() => {});
            } catch {
              // ignore decode error
            }
          }
        }
        break;
      }

      case 'whiteboard-draw': {
        const stroke = message.payload as WhiteboardStroke;
        if (stroke) {
          useAppStore.getState().addWhiteboardStroke(stroke);
        }
        break;
      }

      case 'whiteboard-clear': {
        useAppStore.getState().clearWhiteboardStrokes();
        break;
      }

      case 'host-changed': {
        const { newHostId } = message.payload as { newHostId: string };
        if (newHostId) {
          useAppStore.getState().transferHost(newHostId);
        }
        break;
      }

      case 'chat': {
        const payload = message.payload as {
          id?: string;
          from: string;
          fromName?: string;
          message: string;
          timestamp?: number;
          isPrivate?: boolean;
        };
        const participants = useAppStore.getState().currentMeeting?.participants || [];
        const sender = participants.find((p) => p.id === payload.from);
        useAppStore.getState().addMessage({
          id: payload.id || `${Date.now()}-${Math.random()}`,
          from: payload.from,
          fromName: payload.fromName || sender?.name || '참가자',
          message: payload.message,
          timestamp: payload.timestamp || message.timestamp || Date.now(),
          isPrivate: payload.isPrivate,
        });
        break;
      }

      case 'error': {
        const err = message.payload as ErrorPayload;
        if (err?.code === 'KICKED') {
          alert(err.message || '호스트에 의해 회의에서 퇴장되었습니다.');
          await this.leaveMeeting();
          useAppStore.getState().reset();
        } else if (err?.message) {
          useAppStore.getState().setConnectionError(err.message);
        }
        break;
      }
    }
  }

  private async initiateOffer(peerId: string): Promise<void> {
    const pc = this.createPeerConnection(peerId);
    try {
      // Ensure transceivers exist even if local user has no camera/mic so we can receive remote audio/video
      if (pc.getTransceivers().length === 0) {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
        pc.addTransceiver('video', { direction: 'sendrecv' });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (pc.localDescription && this.currentMeetingId && this.currentUserId) {
        this.sendSignalingMessage({
          type: 'offer',
          payload: {
            sdp: pc.localDescription,
            to: peerId,
          } as OfferPayload,
          from: this.currentUserId,
          to: peerId,
          meetingId: this.currentMeetingId,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error(`[WebRTC] Failed to create offer for ${peerId}:`, err);
    }
  }

  private async flushPendingCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const candidates = this.pendingCandidates.get(peerId);
    if (!candidates || candidates.length === 0) return;

    this.pendingCandidates.delete(peerId);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(`[WebRTC] Failed to flush ICE candidate for ${peerId}:`, err);
      }
    }
  }

  public async syncLocalStream(stream: MediaStream | null): Promise<void> {
    if (!stream) return;

    const audioTrack = stream.getAudioTracks()[0] || null;
    const { isScreenSharing, screenStream } = useAppStore.getState();
    const videoTrack =
      isScreenSharing && screenStream
        ? screenStream.getVideoTracks()[0] || null
        : stream.getVideoTracks()[0] || null;

    for (const [peerId, pc] of this.peerConnections.entries()) {
      let needsRenegotiation = false;
      const transceivers = pc.getTransceivers();

      if (audioTrack) {
        const audioTransceiver = transceivers.find(
          (t) => t.sender.track?.kind === 'audio' || t.receiver.track?.kind === 'audio'
        );
        if (audioTransceiver) {
          await audioTransceiver.sender.replaceTrack(audioTrack);
          if (audioTransceiver.direction === 'recvonly' || audioTransceiver.direction === 'inactive') {
            audioTransceiver.direction = 'sendrecv';
            needsRenegotiation = true;
          }
        } else {
          pc.addTrack(audioTrack, stream);
          needsRenegotiation = true;
        }
      }

      if (videoTrack) {
        const videoTransceiver = transceivers.find(
          (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video'
        );
        if (videoTransceiver) {
          await videoTransceiver.sender.replaceTrack(videoTrack);
          if (videoTransceiver.direction === 'recvonly' || videoTransceiver.direction === 'inactive') {
            videoTransceiver.direction = 'sendrecv';
            needsRenegotiation = true;
          }
        } else {
          pc.addTrack(videoTrack, isScreenSharing && screenStream ? screenStream : stream);
          needsRenegotiation = true;
        }
      }

      if (needsRenegotiation) {
        if (pc.signalingState === 'stable') {
          await this.initiateOffer(peerId);
        } else {
          const onStable = () => {
            if (pc.signalingState === 'stable') {
              pc.removeEventListener('signalingstatechange', onStable);
              this.initiateOffer(peerId);
            }
          };
          pc.addEventListener('signalingstatechange', onStable);
        }
      }
    }
  }

  public async setLocalAudioEnabled(enabled: boolean): Promise<void> {
    useAppStore.getState().setAudioEnabled(enabled);
    let { localStream } = useAppStore.getState();

    // If enabling audio and no active audio track exists yet, acquire one
    if (enabled && (!localStream || localStream.getAudioTracks().length === 0)) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const newAudioTrack = audioStream.getAudioTracks()[0];
        if (newAudioTrack) {
          newAudioTrack.enabled = true;
          const nextStream = localStream
            ? new MediaStream([...localStream.getVideoTracks(), newAudioTrack])
            : new MediaStream([newAudioTrack]);
          useAppStore.getState().setLocalStream(nextStream);
          localStream = nextStream;
          await this.syncLocalStream(nextStream);
        }
      } catch {
        // ignore if mic hardware unavailable
      }
    }

    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }

    // Also update all active RTCRtpSenders for audio
    for (const pc of this.peerConnections.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = enabled;
        }
      }
    }

    this.broadcastUserUpdate({ audioEnabled: enabled });
  }

  public async setLocalVideoEnabled(enabled: boolean): Promise<void> {
    useAppStore.getState().setVideoEnabled(enabled);
    let { localStream, isScreenSharing } = useAppStore.getState();

    // If enabling video and no active video track exists yet, acquire one
    if (enabled && (!localStream || localStream.getVideoTracks().length === 0)) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        if (newVideoTrack) {
          newVideoTrack.enabled = true;
          const nextStream = localStream
            ? new MediaStream([...localStream.getAudioTracks(), newVideoTrack])
            : new MediaStream([newVideoTrack]);
          useAppStore.getState().setLocalStream(nextStream);
          localStream = nextStream;
          await this.syncLocalStream(nextStream);
        }
      } catch {
        // ignore if camera hardware unavailable
      }
    }

    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }

    // Also update all active RTCRtpSenders for camera video (when not screen sharing)
    if (!isScreenSharing) {
      for (const pc of this.peerConnections.values()) {
        for (const sender of pc.getSenders()) {
          if (sender.track && sender.track.kind === 'video') {
            sender.track.enabled = enabled;
          }
        }
      }
    }

    this.broadcastUserUpdate({ videoEnabled: enabled });
  }

  public broadcastUserUpdate(updates: Partial<{ audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }>): void {
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;

    this.sendSignalingMessage({
      type: 'user-updated',
      payload: {
        userId: this.currentUserId,
        updates,
      } as UserUpdatedPayload,
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public async startScreenShare(withAudio = true): Promise<boolean> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: withAudio,
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        return false;
      }

      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      const currentUser = useAppStore.getState().currentUser;
      useAppStore.getState().setScreenStream(screenStream);
      useAppStore.getState().setIsScreenSharing(true);
      if (currentUser) {
        const session: ShareSessionState = {
          mode: 'screen',
          ownerId: currentUser.id,
          ownerName: currentUser.name,
          title: '화면 공유',
        };
        useAppStore.getState().setShareSession(session);
        this.broadcastShareSession(session);
      }

      // Replace outgoing video (and audio if system audio is captured) on all peer connections
      const sysAudioTrack = screenStream.getAudioTracks()[0];
      for (const [peerId, pc] of this.peerConnections.entries()) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        } else {
          pc.addTrack(screenTrack, screenStream);
          if (pc.signalingState === 'stable') {
            await this.initiateOffer(peerId);
          }
        }
        if (sysAudioTrack) {
          const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
          if (audioSender) {
            await audioSender.replaceTrack(sysAudioTrack);
          }
        }
      }

      if (this.currentMeetingId && this.currentUserId) {
        this.sendSignalingMessage({
          type: 'screen-share-start',
          payload: { userId: this.currentUserId },
          from: this.currentUserId,
          meetingId: this.currentMeetingId,
          timestamp: Date.now(),
        });
        this.broadcastUserUpdate({ screenSharing: true });
      }

      return true;
    } catch (err) {
      console.error('[WebRTC] Failed to start screen share:', err);
      return false;
    }
  }

  public async startCustomShare(
    session: ShareSessionState,
    customStream?: MediaStream | null
  ): Promise<void> {
    useAppStore.getState().setShareSession(session);
    useAppStore.getState().setIsScreenSharing(true);

    if (customStream) {
      useAppStore.getState().setScreenStream(customStream);
      const videoTrack = customStream.getVideoTracks()[0] || null;
      const audioTrack = customStream.getAudioTracks()[0] || null;

      for (const [peerId, pc] of this.peerConnections.entries()) {
        let needsOffer = false;
        if (videoTrack) {
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(videoTrack);
          } else {
            pc.addTrack(videoTrack, customStream);
            needsOffer = true;
          }
        }
        if (audioTrack) {
          const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
          if (audioSender) {
            await audioSender.replaceTrack(audioTrack);
          } else {
            pc.addTrack(audioTrack, customStream);
            needsOffer = true;
          }
        }
        if (needsOffer && pc.signalingState === 'stable') {
          await this.initiateOffer(peerId);
        }
      }
    }

    this.broadcastShareSession(session);
    if (this.currentMeetingId && this.currentUserId) {
      this.sendSignalingMessage({
        type: 'screen-share-start',
        payload: { userId: this.currentUserId },
        from: this.currentUserId,
        meetingId: this.currentMeetingId,
        timestamp: Date.now(),
      });
      this.broadcastUserUpdate({ screenSharing: true });
    }
  }

  public async attachShareStream(customStream: MediaStream): Promise<void> {
    useAppStore.getState().setScreenStream(customStream);
    const videoTrack = customStream.getVideoTracks()[0] || null;
    const audioTrack = customStream.getAudioTracks()[0] || null;

    for (const [peerId, pc] of this.peerConnections.entries()) {
      let needsOffer = false;
      if (videoTrack) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(videoTrack);
        } else {
          pc.addTrack(videoTrack, customStream);
          needsOffer = true;
        }
      }
      if (audioTrack) {
        const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (audioSender) {
          await audioSender.replaceTrack(audioTrack);
        } else {
          pc.addTrack(audioTrack, customStream);
          needsOffer = true;
        }
      }
      if (needsOffer && pc.signalingState === 'stable') {
        await this.initiateOffer(peerId);
      }
    }
  }

  public broadcastShareSession(session: ShareSessionState | null): void {
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;
    this.sendSignalingMessage({
      type: 'share-state',
      payload: session,
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public broadcastPdfBuffer(pdfId: string, ab: ArrayBuffer): void {
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;
    try {
      const bytes = new Uint8Array(ab);
      let binary = '';
      const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, Math.min(i + step, bytes.length)))
        );
      }
      const fullBase64 = btoa(binary);
      const CHUNK_LEN = 24 * 1024;
      const totalChunks = Math.max(1, Math.ceil(fullBase64.length / CHUNK_LEN));
      for (let i = 0; i < totalChunks; i++) {
        const chunkBase64 = fullBase64.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN);
        setTimeout(() => {
          if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;
          this.sendSignalingMessage({
            type: 'pdf-chunk',
            payload: {
              pdfId,
              chunkIndex: i,
              totalChunks,
              chunkBase64,
            },
            from: this.currentUserId,
            meetingId: this.currentMeetingId,
            timestamp: Date.now(),
          });
        }, i * 6);
      }
    } catch (err) {
      console.error('[WebRTC] Failed to broadcast PDF chunks:', err);
    }
  }

  public sendWhiteboardStroke(stroke: WhiteboardStroke): void {
    useAppStore.getState().addWhiteboardStroke(stroke);
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;
    this.sendSignalingMessage({
      type: 'whiteboard-draw',
      payload: stroke,
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public clearWhiteboard(): void {
    useAppStore.getState().clearWhiteboardStrokes();
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;
    this.sendSignalingMessage({
      type: 'whiteboard-clear',
      payload: {},
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public async stopScreenShare(): Promise<void> {
    const { screenStream, localStream, shareSession } = useAppStore.getState();
    const targetOwnerId = shareSession?.ownerId || this.currentUserId;
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
    }

    useAppStore.getState().setScreenStream(null);
    useAppStore.getState().setIsScreenSharing(false);
    useAppStore.getState().setShareSession(null);
    if (targetOwnerId) {
      useAppStore.getState().updateParticipant(targetOwnerId, { screenSharing: false });
    }

    // Restore camera video and mic audio track on all peer connections
    const cameraTrack = localStream?.getVideoTracks()[0] || null;
    const micTrack = localStream?.getAudioTracks()[0] || null;
    for (const pc of this.peerConnections.values()) {
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(cameraTrack);
      }
      if (micTrack) {
        const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (audioSender) {
          await audioSender.replaceTrack(micTrack);
        }
      }
    }

    this.broadcastShareSession(null);
    if (this.currentMeetingId && this.currentUserId) {
      this.sendSignalingMessage({
        type: 'screen-share-stop',
        payload: { userId: targetOwnerId || this.currentUserId },
        from: this.currentUserId,
        meetingId: this.currentMeetingId,
        timestamp: Date.now(),
      });
      this.broadcastUserUpdate({ screenSharing: false });
    }
  }

  public sendChatMessage(message: string, to?: string): void {
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;

    this.sendSignalingMessage({
      type: 'chat',
      payload: {
        message,
        to: to && to !== 'everyone' ? to : undefined,
      },
      from: this.currentUserId,
      to: to && to !== 'everyone' ? to : undefined,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public muteParticipant(targetUserId: string, muted: boolean): void {
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;

    this.sendSignalingMessage({
      type: 'mute-user',
      payload: { userId: targetUserId, muted },
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public kickParticipant(targetUserId: string): void {
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;

    this.sendSignalingMessage({
      type: 'kick-user',
      payload: { userId: targetUserId },
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public transferHost(newHostId: string): void {
    useAppStore.getState().transferHost(newHostId);
    if (!this.socket || !this.currentMeetingId || !this.currentUserId) return;

    this.sendSignalingMessage({
      type: 'transfer-host',
      payload: { newHostId },
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  private sendSignalingMessage(message: SignalingMessage): void {
    this.socket?.emit('signaling', message);
  }

  private closePeerConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.pendingCandidates.delete(peerId);
    this.remoteStreams.delete(peerId);
    useAppStore.getState().removeRemoteStream(peerId);
  }

  public async leaveMeeting(): Promise<void> {
    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeerConnection(peerId);
    }

    if (this.socket && this.socket.connected) {
      await new Promise<void>((resolve) => {
        this.socket!.emit('leave', {}, () => resolve());
        setTimeout(resolve, 500);
      });
    }

    this.currentMeetingId = null;
    this.currentUserId = null;
    await api.leaveMeeting();
  }
}

export const webrtcManager = new WebRTCManager();
