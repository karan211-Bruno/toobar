// WebRTC + Universal Multi-Platform Signaling Manager
// Supports:
// 1. Electron Desktop Socket.IO + LAN/MQTT Bridge (localhost:3002 or custom LAN URL)
// 2. Serverless Mobile/Web Cloud Bus Mode (iPhone, iPad, Android, Web via WSS MQTT)

import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
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
  ChatAttachment,
  ChatFileChunkPayload,
  Meeting,
  User,
} from '@shared/types';
import { useAppStore } from './store';
import { api, isElectron } from './electron-bridge';
import { cloudBus, detectDevicePlatform, getOrCreateUserCode, UniversalBridgePacket } from './cloud-bus';

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
  private useCloudBusMode = false;
  private cloudCleanup: (() => void) | null = null;
  private cloudRoomSyncTimer: ReturnType<typeof setInterval> | null = null;
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
  private incomingChatFiles = new Map<
    string,
    { messageId: string; mimeType: string; chunks: string[]; received: number; total: number }
  >();
  private localSharedPdfBuffer: ArrayBuffer | null = null;
  private localSharedPdfId = '';

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
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      useAppStore.getState().setIsConnected(true);
      useAppStore.getState().setConnectionError(null);
    });

    socket.on('disconnect', () => {
      if (!this.useCloudBusMode) {
        useAppStore.getState().setIsConnected(false);
      }
    });

    socket.on('connect_error', () => {
      if (!this.useCloudBusMode) {
        useAppStore.getState().setIsConnected(false);
        useAppStore.getState().setConnectionError('시그널링 서버 연결 대기 중...');
      }
    });

    socket.on('signaling', (message: SignalingMessage) => {
      this.handleSignalingMessage(message);
    });

    this.socket = socket;
    return socket;
  }

  private async joinViaCloudBus(payload: JoinPayload): Promise<{
    success: boolean;
    meeting?: Meeting;
    user?: User;
    error?: { code: string; message: string };
  }> {
    this.useCloudBusMode = true;
    cloudBus.start();

    const meetingId = (payload.meetingId || '').trim().toUpperCase();
    const myId = `mob-${uuidv4().slice(0, 10)}`;
    const user: User = {
      id: myId,
      name: (payload.userName || '').trim() || '참가자',
      userCode: getOrCreateUserCode(),
      platform: detectDevicePlatform(),
      audioEnabled: payload.audioEnabled,
      videoEnabled: payload.videoEnabled,
      screenSharing: false,
      isHost: false,
      joinedAt: Date.now(),
    };

    const requestId = uuidv4();
    let joinResolver:
      | ((res: {
          success: boolean;
          meeting?: Meeting;
          assignedUserName?: string;
          error?: ErrorPayload;
        }) => void)
      | null = null;

    if (this.cloudCleanup) {
      this.cloudCleanup();
      this.cloudCleanup = null;
    }

    this.cloudCleanup = cloudBus.onPacket((pkt: UniversalBridgePacket) => {
      const pktMeeting = (pkt.meetingId || '').trim().toUpperCase();

      if (pkt.type === 'bridge-join-res' && pktMeeting === meetingId) {
        const { requestId: resReqId, success, meeting, assignedUserName, error } = pkt.data || {};
        if (resReqId === requestId && joinResolver) {
          const r = joinResolver;
          joinResolver = null;
          r({ success, meeting, assignedUserName, error });
        }
        return;
      }

      if (!this.currentMeetingId || pktMeeting !== this.currentMeetingId) {
        if (pkt.type !== 'bridge-pdf-chunk' && pkt.type !== 'bridge-pdf-pull') {
          return;
        }
      }

      switch (pkt.type) {
        case 'bridge-join-req': {
          const localMeeting = useAppStore.getState().currentMeeting;
          if (!localMeeting || localMeeting.id !== meetingId) return;
          const { requestId: incomingReqId, user: joiningUser, password } = pkt.data || {};
          if (localMeeting.settings.password && localMeeting.settings.password !== password) {
            cloudBus.sendPacket('bridge-join-res', meetingId, {
              requestId: incomingReqId,
              success: false,
              error: { code: 'INVALID_PASSWORD', message: '잘못된 회의 비밀번호입니다.' },
            });
            return;
          }
          const remoteUser: User = { ...joiningUser, isHost: false };
          useAppStore.getState().addParticipant(remoteUser);
          const updatedMeeting = useAppStore.getState().currentMeeting || localMeeting;

          cloudBus.sendPacket('bridge-join-res', meetingId, {
            requestId: incomingReqId,
            success: true,
            meeting: updatedMeeting,
            assignedUserName: remoteUser.name,
          });

          this.handleSignalingMessage({
            type: 'user-joined',
            payload: { user: remoteUser },
            from: remoteUser.id,
            meetingId,
            timestamp: Date.now(),
          });
          break;
        }

        case 'bridge-user-joined':
        case 'bridge-room-sync': {
          const remoteMeeting = pkt.data?.meeting as Meeting | undefined;
          const localMeeting = useAppStore.getState().currentMeeting;
          if (!localMeeting || !remoteMeeting) return;

          if (
            (remoteMeeting.hostUpdatedAt || 0) > (localMeeting.hostUpdatedAt || 0) &&
            remoteMeeting.hostId &&
            remoteMeeting.hostId !== localMeeting.hostId
          ) {
            useAppStore.getState().transferHost(remoteMeeting.hostId);
          } else if (
            !remoteMeeting.hostUpdatedAt &&
            !localMeeting.hostUpdatedAt &&
            remoteMeeting.createdAt < localMeeting.createdAt &&
            remoteMeeting.hostId &&
            remoteMeeting.hostId !== localMeeting.hostId
          ) {
            useAppStore.getState().transferHost(remoteMeeting.hostId);
          }

          for (const rp of remoteMeeting.participants || []) {
            if (rp.id === this.currentUserId) continue;
            const exists = useAppStore
              .getState()
              .currentMeeting?.participants.some((p) => p.id === rp.id);
            if (!exists) {
              useAppStore.getState().addParticipant(rp);
              this.initiateOffer(rp.id);
            }
          }
          break;
        }

        case 'bridge-signaling': {
          const msg = pkt.data?.message as SignalingMessage | undefined;
          if (!msg || msg.from === this.currentUserId) return;
          if (msg.to && msg.to !== this.currentUserId) return;
          this.handleSignalingMessage(msg);
          break;
        }

        case 'bridge-user-left': {
          const { userId, newHostId } = (pkt.data || {}) as { userId: string; newHostId?: string };
          if (userId) {
            this.closePeerConnection(userId);
            useAppStore.getState().removeParticipant(userId);
          }
          if (newHostId) {
            useAppStore.getState().transferHost(newHostId);
          }
          break;
        }

        case 'bridge-pdf-chunk': {
          this.handleSignalingMessage({
            type: 'pdf-chunk',
            payload: pkt.data,
            from: 'bridge',
            meetingId: this.currentMeetingId || meetingId,
            timestamp: Date.now(),
          });
          break;
        }

        case 'bridge-pdf-pull': {
          const { pdfId: reqPdfId } = (pkt.data || {}) as { pdfId?: string };
          if (
            this.localSharedPdfBuffer &&
            (!reqPdfId || !this.localSharedPdfId || reqPdfId === this.localSharedPdfId)
          ) {
            this.broadcastPdfBuffer(
              this.localSharedPdfId || reqPdfId || uuidv4(),
              this.localSharedPdfBuffer
            );
          }
          break;
        }
      }
    });

    // Query existing hosts on Cloud/LAN Bus
    const remoteRes = await new Promise<{
      success: boolean;
      meeting?: Meeting;
      assignedUserName?: string;
      error?: ErrorPayload;
    } | null>((resolveJoin) => {
      const timer = setTimeout(() => {
        joinResolver = null;
        resolveJoin(null);
      }, 950);

      joinResolver = (res) => {
        clearTimeout(timer);
        resolveJoin(res);
      };

      cloudBus.sendPacket('bridge-join-req', meetingId, {
        requestId,
        user,
        password: payload.password,
      });
    });

    if (remoteRes && !remoteRes.success) {
      return {
        success: false,
        error: remoteRes.error || {
          code: 'INVALID_PASSWORD',
          message: '잘못된 회의 비밀번호입니다.',
        },
      };
    }

    let meeting: Meeting;
    if (remoteRes?.meeting) {
      if (remoteRes.assignedUserName) {
        user.name = remoteRes.assignedUserName;
      }
      const participants = remoteRes.meeting.participants.some((p) => p.id === user.id)
        ? remoteRes.meeting.participants
        : [...remoteRes.meeting.participants, user];
      meeting = {
        ...remoteRes.meeting,
        participants,
      };
    } else {
      user.isHost = true;
      meeting = {
        id: meetingId,
        name: `Meeting ${meetingId.slice(0, 8)}`,
        hostId: user.id,
        participants: [user],
        createdAt: Date.now(),
        settings: {
          allowScreenShare: true,
          allowChat: true,
          allowRecording: false,
          muteOnEntry: false,
          videoOnEntry: true,
          password: payload.password,
        },
      };
    }

    this.currentMeetingId = meeting.id;
    this.currentUserId = user.id;
    useAppStore.getState().setIsConnected(true);
    useAppStore.getState().setConnectionError(null);

    cloudBus.sendPacket('bridge-user-joined', meeting.id, {
      user,
      meeting,
    });

    if (this.cloudRoomSyncTimer) clearInterval(this.cloudRoomSyncTimer);
    this.cloudRoomSyncTimer = setInterval(() => {
      const curMeeting = useAppStore.getState().currentMeeting;
      if (curMeeting && curMeeting.id === this.currentMeetingId) {
        cloudBus.sendPacket('bridge-room-sync', curMeeting.id, { meeting: curMeeting });
      }
    }, 3000);

    const existingPeers = (meeting.participants || []).filter(
      (p) => p.id && p.id !== user.id
    );
    if (existingPeers.length > 0) {
      setTimeout(() => {
        for (const peer of existingPeers) {
          if (!this.peerConnections.has(peer.id) && this.currentMeetingId === meeting.id) {
            this.initiateOffer(peer.id);
          }
        }
      }, 500);
    }

    return {
      success: true,
      meeting,
      user,
    };
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

    const enrichedPayload: JoinPayload = {
      ...payload,
      userCode: getOrCreateUserCode(),
      platform: detectDevicePlatform(),
    };

    const targetUrl = useAppStore.getState().signalingUrl || DEFAULT_SIGNALING_URL;

    // On Mobile / Web without an explicit remote Socket.IO server, connect directly via Cloud Bus!
    if (!isElectron() && (targetUrl === DEFAULT_SIGNALING_URL || targetUrl.includes('127.0.0.1'))) {
      return this.joinViaCloudBus(enrichedPayload);
    }

    this.useCloudBusMode = false;
    let socket = this.ensureSocket();

    if (!socket.connected) {
      const connected = await new Promise<boolean>((resolve) => {
        const timeoutMs = targetUrl !== DEFAULT_SIGNALING_URL ? 1600 : 4500;
        const timer = setTimeout(() => resolve(false), timeoutMs);
        socket.once('connect', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });

      if (!connected) {
        if (!isElectron()) {
          // Mobile/Web fallback to Cloud Bus if custom LAN server is unreachable
          return this.joinViaCloudBus(enrichedPayload);
        }
        if (targetUrl !== DEFAULT_SIGNALING_URL) {
          useAppStore.getState().setSignalingUrl(DEFAULT_SIGNALING_URL);
          socket = this.ensureSocket();
          if (!socket.connected) {
            const localOk = await new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => resolve(false), 3000);
              socket.once('connect', () => {
                clearTimeout(timer);
                resolve(true);
              });
            });
            if (!localOk) {
              return this.joinViaCloudBus(enrichedPayload);
            }
          }
        } else {
          return this.joinViaCloudBus(enrichedPayload);
        }
      }
    }

    return new Promise((resolve) => {
      socket.emit(
        'join',
        enrichedPayload,
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

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);

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
        pc.addTrack(
          activeVideoTrack,
          isScreenSharing && screenStream ? screenStream : localStream
        );
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

    return pc;
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    switch (message.type) {
      case 'user-joined': {
        const { user } = message.payload as UserJoinedPayload;
        if (!user || user.id === this.currentUserId) return;

        useAppStore.getState().addParticipant(user);
        await this.initiateOffer(user.id);

        const { shareSession, whiteboardStrokes } = useAppStore.getState();
        if (
          shareSession &&
          shareSession.ownerId === this.currentUserId &&
          this.currentMeetingId
        ) {
          if (shareSession.mode === 'pdf') {
            if (isElectron()) {
              fetch('http://127.0.0.1:3001/shared-pdf-rebroadcast', { method: 'POST' }).catch(
                () => {}
              );
            } else if (this.localSharedPdfBuffer && this.localSharedPdfId) {
              this.broadcastPdfBuffer(this.localSharedPdfId, this.localSharedPdfBuffer);
            }
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
        this.closePeerConnection(userId);
        useAppStore.getState().removeParticipant(userId);
        break;
      }

      case 'offer': {
        const { sdp } = message.payload as OfferPayload;
        const peerId = message.from;
        if (!peerId || !sdp) return;

        const pc = this.createPeerConnection(peerId);
        const isPolite = (this.currentUserId || '') < peerId;

        try {
          if (pc.signalingState !== 'stable') {
            if (!isPolite) return;
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
          } catch {}
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
            useAppStore.getState().updateParticipant(prevSession.ownerId, {
              screenSharing: false,
            });
          }
          if (useAppStore.getState().isScreenSharing) {
            useAppStore.getState().setIsScreenSharing(false);
          }
        } else if (
          session.ownerId !== this.currentUserId &&
          useAppStore.getState().isScreenSharing
        ) {
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
              const blobUrl = URL.createObjectURL(
                new Blob([bytes], { type: 'application/pdf' })
              );
              useAppStore.getState().setSharedPdfBlobUrl(pdfId, blobUrl);

              if (isElectron()) {
                fetch(
                  `http://127.0.0.1:3001/shared-pdf-cache?pdfId=${encodeURIComponent(pdfId)}`,
                  {
                    method: 'POST',
                    body: bytes.buffer,
                  }
                ).catch(() => {});
              }
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
          to?: string;
          isPrivate?: boolean;
          attachment?: ChatAttachment;
        };
        const participants = useAppStore.getState().currentMeeting?.participants || [];
        const sender = participants.find((p) => p.id === (payload.from || message.from));
        useAppStore.getState().addMessage({
          id: payload.id || `${Date.now()}-${Math.random()}`,
          from: payload.from || message.from,
          fromName: payload.fromName || sender?.name || '참가자',
          message: payload.message || '',
          timestamp: payload.timestamp || message.timestamp || Date.now(),
          to: payload.to,
          isPrivate: payload.isPrivate,
          attachment: payload.attachment,
        });
        break;
      }

      case 'chat-file-chunk': {
        const data = (message.payload || {}) as ChatFileChunkPayload;
        if (
          !data.messageId ||
          typeof data.chunkIndex !== 'number' ||
          !data.totalChunks ||
          !data.chunkBase64
        ) {
          break;
        }
        let entry = this.incomingChatFiles.get(data.messageId);
        if (!entry) {
          entry = {
            messageId: data.messageId,
            mimeType: data.mimeType || 'application/octet-stream',
            chunks: new Array(data.totalChunks).fill(''),
            received: 0,
            total: data.totalChunks,
          };
          this.incomingChatFiles.set(data.messageId, entry);
        }
        if (!entry.chunks[data.chunkIndex]) {
          entry.chunks[data.chunkIndex] = data.chunkBase64;
          entry.received += 1;
          const pct = Math.round((entry.received / entry.total) * 100);
          if (entry.received === entry.total) {
            const fullB64 = entry.chunks.join('');
            const dataUrl = `data:${entry.mimeType};base64,${fullB64}`;
            this.incomingChatFiles.delete(data.messageId);
            useAppStore.getState().updateMessageAttachment(data.messageId, {
              progress: 100,
              isComplete: true,
              dataUrl,
            });
          } else {
            useAppStore.getState().updateMessageAttachment(data.messageId, {
              progress: pct,
              isComplete: false,
            });
          }
        }
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
      } catch {}
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
          if (
            audioTransceiver.direction === 'recvonly' ||
            audioTransceiver.direction === 'inactive'
          ) {
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
          if (
            videoTransceiver.direction === 'recvonly' ||
            videoTransceiver.direction === 'inactive'
          ) {
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

  public async switchCamera(): Promise<void> {
    const currentMode = useAppStore.getState().cameraFacingMode;
    const nextMode = currentMode === 'user' ? 'environment' : 'user';
    try {
      const { localStream, videoEnabled } = useAppStore.getState();
      localStream?.getVideoTracks().forEach((t) => t.stop());

      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      const newVideoTrack = newVideoStream.getVideoTracks()[0];
      if (!newVideoTrack) return;
      newVideoTrack.enabled = videoEnabled;

      const audioTracks = localStream ? localStream.getAudioTracks() : [];
      const nextStream = new MediaStream([...audioTracks, newVideoTrack]);

      useAppStore.getState().setCameraFacingMode(nextMode);
      useAppStore.getState().setLocalStream(nextStream);
      await this.syncLocalStream(nextStream);
    } catch (err) {
      console.error('[WebRTC] Failed to switch camera:', err);
    }
  }

  public async setLocalAudioEnabled(enabled: boolean): Promise<void> {
    useAppStore.getState().setAudioEnabled(enabled);
    let { localStream } = useAppStore.getState();

    if (enabled && (!localStream || localStream.getAudioTracks().length === 0)) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
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
      } catch {}
    }

    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }

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
    let { localStream, isScreenSharing, cameraFacingMode } = useAppStore.getState();

    if (enabled && (!localStream || localStream.getVideoTracks().length === 0)) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: cameraFacingMode },
        });
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
      } catch {}
    }

    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }

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

  public broadcastUserUpdate(
    updates: Partial<{ audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }>
  ): void {
    if (!this.currentMeetingId || !this.currentUserId) return;

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
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      alert(
        '현재 모바일 기기에서는 전체 화면 캡처 대신 전자칠판 · PDF 문서 · 사진/슬라이드 · 동영상 공유를 이용하실 수 있습니다.'
      );
      return false;
    }

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
    if (!this.currentMeetingId || !this.currentUserId) return;
    this.sendSignalingMessage({
      type: 'share-state',
      payload: session,
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public requestPdfPull(pdfId: string): void {
    if (this.useCloudBusMode && this.currentMeetingId) {
      cloudBus.sendPacket('bridge-pdf-pull', this.currentMeetingId, { pdfId });
    }
  }

  public broadcastPdfBuffer(pdfId: string, ab: ArrayBuffer): void {
    this.localSharedPdfId = pdfId;
    this.localSharedPdfBuffer = ab;

    try {
      const localBlobUrl = URL.createObjectURL(new Blob([ab], { type: 'application/pdf' }));
      useAppStore.getState().setSharedPdfBlobUrl(pdfId, localBlobUrl);
    } catch {}

    if (!this.currentMeetingId || !this.currentUserId) return;
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
          if (!this.currentMeetingId || !this.currentUserId) return;
          if (this.useCloudBusMode) {
            cloudBus.sendPacket('bridge-pdf-chunk', this.currentMeetingId, {
              pdfId,
              chunkIndex: i,
              totalChunks,
              chunkBase64,
            });
          } else {
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
          }
        }, i * 10);
      }
    } catch (err) {
      console.error('[WebRTC] Failed to broadcast PDF chunks:', err);
    }
  }

  public sendWhiteboardStroke(stroke: WhiteboardStroke): void {
    useAppStore.getState().addWhiteboardStroke(stroke);
    if (!this.currentMeetingId || !this.currentUserId) return;
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
    if (!this.currentMeetingId || !this.currentUserId) return;
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
    if (!this.currentMeetingId || !this.currentUserId) return;
    const chatId = uuidv4();
    const timestamp = Date.now();
    const isPrivate = Boolean(to && to !== 'everyone');
    const currentUser = useAppStore.getState().currentUser;

    if (this.useCloudBusMode) {
      // Append locally right away in serverless CloudBus mode
      useAppStore.getState().addMessage({
        id: chatId,
        from: this.currentUserId,
        fromName: currentUser?.name || '나',
        message,
        timestamp,
        to: isPrivate ? to : undefined,
        isPrivate,
      });
    }

    this.sendSignalingMessage({
      type: 'chat',
      payload: {
        id: chatId,
        message,
        from: this.currentUserId,
        fromName: currentUser?.name || '참가자',
        to: isPrivate ? to : undefined,
        isPrivate,
        timestamp,
      },
      from: this.currentUserId,
      to: isPrivate ? to : undefined,
      meetingId: this.currentMeetingId,
      timestamp,
    });
  }

  public async sendChatFile(file: File, caption = '', to?: string): Promise<void> {
    if (!this.currentMeetingId || !this.currentUserId) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    const base64Body = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const messageId = uuidv4();
    const fileId = uuidv4();
    const mimeType = file.type || 'application/octet-stream';
    const timestamp = Date.now();
    const isPrivate = Boolean(to && to !== 'everyone');
    const currentUser = useAppStore.getState().currentUser;

    // Add local message immediately with local dataUrl so sender sees preview & progress
    useAppStore.getState().addMessage({
      id: messageId,
      from: this.currentUserId,
      fromName: currentUser?.name || '나',
      message: caption.trim(),
      timestamp,
      to: isPrivate ? to : undefined,
      isPrivate,
      attachment: {
        id: fileId,
        name: file.name,
        mimeType,
        size: file.size,
        dataUrl,
        progress: 0,
        isComplete: false,
      },
    });

    // Send chat metadata (without large dataUrl) to peers
    this.sendSignalingMessage({
      type: 'chat',
      payload: {
        id: messageId,
        message: caption.trim(),
        from: this.currentUserId,
        fromName: currentUser?.name || '참가자',
        to: isPrivate ? to : undefined,
        isPrivate,
        timestamp,
        attachment: {
          id: fileId,
          name: file.name,
          mimeType,
          size: file.size,
          progress: 0,
          isComplete: false,
        },
      },
      from: this.currentUserId,
      to: isPrivate ? to : undefined,
      meetingId: this.currentMeetingId,
      timestamp,
    });

    const CHUNK_LEN = 22 * 1024;
    const totalChunks = Math.max(1, Math.ceil(base64Body.length / CHUNK_LEN));

    for (let i = 0; i < totalChunks; i++) {
      const chunkBase64 = base64Body.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN);
      await new Promise<void>((r) => setTimeout(r, 12));
      if (!this.currentMeetingId || !this.currentUserId) break;

      const chunkPayload: ChatFileChunkPayload = {
        messageId,
        fileId,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
        chunkIndex: i,
        totalChunks,
        chunkBase64,
        to: isPrivate ? to : undefined,
      };

      this.sendSignalingMessage({
        type: 'chat-file-chunk',
        payload: chunkPayload,
        from: this.currentUserId,
        to: isPrivate ? to : undefined,
        meetingId: this.currentMeetingId,
        timestamp: Date.now(),
      });

      const pct = Math.round(((i + 1) / totalChunks) * 100);
      useAppStore.getState().updateMessageAttachment(messageId, {
        progress: pct,
        isComplete: i + 1 === totalChunks,
      });
    }
  }

  public muteParticipant(targetUserId: string, muted: boolean): void {
    if (!this.currentMeetingId || !this.currentUserId) return;
    if (this.useCloudBusMode) {
      useAppStore.getState().updateParticipant(targetUserId, { audioEnabled: !muted });
      this.sendSignalingMessage({
        type: 'user-updated',
        payload: { userId: targetUserId, updates: { audioEnabled: !muted } },
        from: this.currentUserId,
        meetingId: this.currentMeetingId,
        timestamp: Date.now(),
      });
      return;
    }

    this.sendSignalingMessage({
      type: 'mute-user',
      payload: { userId: targetUserId, muted },
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  public kickParticipant(targetUserId: string): void {
    if (!this.currentMeetingId || !this.currentUserId) return;
    if (this.useCloudBusMode) {
      this.sendSignalingMessage({
        type: 'error',
        payload: { code: 'KICKED', message: '호스트에 의해 퇴장되었습니다.' },
        from: this.currentUserId,
        to: targetUserId,
        meetingId: this.currentMeetingId,
        timestamp: Date.now(),
      });
      useAppStore.getState().removeParticipant(targetUserId);
      return;
    }

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
    if (!this.currentMeetingId || !this.currentUserId) return;

    if (this.useCloudBusMode) {
      this.sendSignalingMessage({
        type: 'host-changed',
        payload: { newHostId },
        from: this.currentUserId,
        meetingId: this.currentMeetingId,
        timestamp: Date.now(),
      });
      return;
    }

    this.sendSignalingMessage({
      type: 'transfer-host',
      payload: { newHostId },
      from: this.currentUserId,
      meetingId: this.currentMeetingId,
      timestamp: Date.now(),
    });
  }

  private sendSignalingMessage(message: SignalingMessage): void {
    if (this.useCloudBusMode) {
      if (this.currentMeetingId) {
        cloudBus.sendPacket('bridge-signaling', this.currentMeetingId, { message });
      }
      return;
    }
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

    if (this.useCloudBusMode) {
      if (this.cloudRoomSyncTimer) {
        clearInterval(this.cloudRoomSyncTimer);
        this.cloudRoomSyncTimer = null;
      }
      if (this.currentMeetingId && this.currentUserId) {
        const curMeeting = useAppStore.getState().currentMeeting;
        const remaining = (curMeeting?.participants || []).filter(
          (p) => p.id !== this.currentUserId
        );
        const newHostId =
          curMeeting?.hostId === this.currentUserId && remaining.length > 0
            ? remaining[0].id
            : undefined;
        cloudBus.sendPacket('bridge-user-left', this.currentMeetingId, {
          userId: this.currentUserId,
          newHostId,
        });
      }
      if (this.cloudCleanup) {
        this.cloudCleanup();
        this.cloudCleanup = null;
      }
      this.useCloudBusMode = false;
    } else if (this.socket && this.socket.connected) {
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
