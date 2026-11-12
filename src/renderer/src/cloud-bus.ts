// Universal Cross-Platform Cloud & LAN Bus + Standalone Messenger & File Transfer Engine
// Connects macOS, Windows, Ubuntu, iPhone, iPad, Android, and Web seamlessly via:
// 1. MQTT over WebSockets (wss://broker.emqx.io:8084/mqtt & wss://broker.hivemq.com:8884/mqtt)
// 2. Local Electron Bridge HTTP/Event relay (for offline LAN UDP 41234 support on Desktop)

import { v4 as uuidv4 } from 'uuid';
import type {
  DevicePlatform,
  MessengerPeer,
  MessengerMessage,
  MessengerConversation,
  ChatAttachment,
} from '@shared/types';
import { isElectron } from './electron-bridge';

const MQTT_TOPIC = 'zoomclone/v2/global_bus';
const WSS_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export interface UniversalBridgePacket {
  msgId: string;
  nodeId: string;
  meetingId: string;
  type:
    | 'bridge-join-req'
    | 'bridge-join-res'
    | 'bridge-user-joined'
    | 'bridge-room-sync'
    | 'bridge-signaling'
    | 'bridge-user-left'
    | 'bridge-pdf-chunk'
    | 'bridge-pdf-pull'
    | 'bridge-update-query'
    | 'bridge-update-announce'
    | 'bridge-update-pull'
    | 'bridge-update-chunk'
    | 'bridge-presence'
    | 'bridge-presence-ping'
    | 'bridge-messenger-msg'
    | 'bridge-messenger-file-chunk';
  data: any;
  ts: number;
}

export function detectDevicePlatform(): DevicePlatform {
  if (typeof window === 'undefined') return 'web';
  const nativeHint = (window as any).__toobarNativePlatform as DevicePlatform | undefined;
  if (nativeHint) return nativeHint;

  const winPlatform = (window as any).platform;
  if (winPlatform?.isMac) return 'mac';
  if (winPlatform?.isWindows) return 'windows';
  if (winPlatform?.isLinux) return 'ubuntu';

  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPad/i.test(ua)) return 'ipad';
  if (/iPhone|iPod/i.test(ua)) return 'iphone';
  // iPadOS 13+ reports Macintosh in UA with multi-touch
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ipad';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'ubuntu';
  return 'web';
}

export function getPlatformLabel(platform?: string): string {
  switch (platform) {
    case 'mac':
      return '💻 MacBook';
    case 'windows':
      return '🪟 Windows';
    case 'ubuntu':
      return '🐧 Ubuntu';
    case 'iphone':
      return '📱 iPhone';
    case 'ipad':
      return '📱 iPad';
    case 'android':
      return '🤖 Android';
    default:
      return '🌐 Web';
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function saveOrShareFile(
  fileName: string,
  dataUrl: string,
  mimeType = 'application/octet-stream'
): Promise<void> {
  try {
    const base64Part = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

    // 1. Native iOS / iPadOS WKWebView bridge (UIActivityViewController)
    const iosHandler = (window as any).webkit?.messageHandlers?.toobar;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({
        action: 'saveFile',
        filename: fileName,
        base64: base64Part,
        mimeType,
      });
      return;
    }

    // 2. Native Android WebView JavascriptInterface
    const androidBridge = (window as any).ToobarAndroid;
    if (androidBridge?.saveBase64File) {
      androidBridge.saveBase64File(base64Part, fileName, mimeType);
      return;
    }

    // 3. Web Share API on mobile browsers if supported for files
    const binaryStr = atob(base64Part);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    if (
      !isElectron() &&
      /iphone|ipad|android/.test(detectDevicePlatform()) &&
      typeof navigator.share === 'function'
    ) {
      try {
        const fileObj = new File([blob], fileName, { type: mimeType });
        if (!navigator.canShare || navigator.canShare({ files: [fileObj] })) {
          await navigator.share({ files: [fileObj], title: fileName });
          return;
        }
      } catch {
        // user cancelled or unsupported -> fallback to anchor download
      }
    }

    // 4. Desktop / Standard Browser anchor download
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  } catch (err) {
    console.error('[FileSave] Failed to save/share file:', err);
  }
}

// --- MQTT 3.1.1 Binary Packet Framing for Browser WebSockets ---
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeMqttRemainingLength(len: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let encodedByte = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) encodedByte |= 128;
    bytes.push(encodedByte);
  } while (len > 0);
  return new Uint8Array(bytes);
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function buildMqttConnect(clientId: string): Uint8Array {
  const idBuf = textEncoder.encode(clientId);
  const vh = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c]);
  const lenPrefix = new Uint8Array([(idBuf.length >> 8) & 0xff, idBuf.length & 0xff]);
  const rem = encodeMqttRemainingLength(vh.length + lenPrefix.length + idBuf.length);
  return concatUint8Arrays([new Uint8Array([0x10]), rem, vh, lenPrefix, idBuf]);
}

function buildMqttSubscribe(topic: string, packetId = 1): Uint8Array {
  const tBuf = textEncoder.encode(topic);
  const vh = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const tLen = new Uint8Array([(tBuf.length >> 8) & 0xff, tBuf.length & 0xff]);
  const qos = new Uint8Array([0x00]);
  const rem = encodeMqttRemainingLength(vh.length + tLen.length + tBuf.length + 1);
  return concatUint8Arrays([new Uint8Array([0x82]), rem, vh, tLen, tBuf, qos]);
}

function buildMqttPublish(topic: string, jsonStr: string): Uint8Array {
  const tBuf = textEncoder.encode(topic);
  const mBuf = textEncoder.encode(jsonStr);
  const tLen = new Uint8Array([(tBuf.length >> 8) & 0xff, tBuf.length & 0xff]);
  const rem = encodeMqttRemainingLength(tLen.length + tBuf.length + mBuf.length);
  return concatUint8Arrays([new Uint8Array([0x30]), rem, tLen, tBuf, mBuf]);
}

export function getOrCreateUserCode(): string {
  const key = 'toobar_user_code_v1';
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^TB-[A-Z0-9]{4,8}$/.test(saved)) {
      return saved;
    }
  } catch {}
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'TB-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  try {
    localStorage.setItem(key, code);
  } catch {}
  return code;
}

export function makeDmConversationId(codeA: string, codeB: string): string {
  const sorted = [codeA.trim().toUpperCase(), codeB.trim().toUpperCase()].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

type PacketListener = (pkt: UniversalBridgePacket) => void;
type MessengerUpdateListener = () => void;

class UniversalCloudBus {
  public readonly nodeId: string = uuidv4();
  private sockets: WebSocket[] = [];
  private seenMsgIds = new Set<string>();
  private packetListeners = new Set<PacketListener>();
  private messengerListeners = new Set<MessengerUpdateListener>();
  private started = false;
  private connectedCount = 0;

  // Standalone Messenger State
  private myCode: string = getOrCreateUserCode();
  private myName: string = '';
  private myPlatform: DevicePlatform = detectDevicePlatform();
  private peers = new Map<string, MessengerPeer>();
  private conversations = new Map<string, MessengerConversation>();
  private messagesByConv = new Map<string, MessengerMessage[]>();
  private incomingFiles = new Map<
    string,
    {
      conversationId: string;
      messageId: string;
      chunks: string[];
      received: number;
      total: number;
      mimeType: string;
    }
  >();

  constructor() {
    this.loadPersistedMessengerState();
  }

  private loadPersistedMessengerState(): void {
    try {
      this.myName = localStorage.getItem('zoomclone_user_name') || '';
      const rawConvs = localStorage.getItem('toobar_messenger_convs_v1');
      if (rawConvs) {
        const parsed = JSON.parse(rawConvs) as MessengerConversation[];
        for (const c of parsed) {
          this.conversations.set(c.id, c);
        }
      }
      if (!this.conversations.has('public')) {
        this.conversations.set('public', {
          id: 'public',
          type: 'public',
          title: '🌐 전체 라운지 (오픈 채팅)',
          unreadCount: 0,
          updatedAt: Date.now(),
        });
      }

      const rawMsgs = localStorage.getItem('toobar_messenger_msgs_v1');
      if (rawMsgs) {
        const parsed = JSON.parse(rawMsgs) as Record<string, MessengerMessage[]>;
        for (const [cid, list] of Object.entries(parsed)) {
          this.messagesByConv.set(cid, list.slice(-80));
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  private persistMessengerState(): void {
    try {
      const convArr = Array.from(this.conversations.values());
      localStorage.setItem('toobar_messenger_convs_v1', JSON.stringify(convArr));

      // Persist text & small attachments (< 250KB dataUrl) so localStorage stays under 5MB quota
      const serializable: Record<string, MessengerMessage[]> = {};
      for (const [cid, list] of this.messagesByConv.entries()) {
        serializable[cid] = list.slice(-50).map((m) => {
          if (m.attachment?.dataUrl && m.attachment.dataUrl.length > 250 * 1024) {
            return {
              ...m,
              attachment: { ...m.attachment, dataUrl: undefined },
            };
          }
          return m;
        });
      }
      localStorage.setItem('toobar_messenger_msgs_v1', JSON.stringify(serializable));
    } catch {
      // ignore quota error
    }
  }

  public start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.myPlatform = detectDevicePlatform();

    for (const url of WSS_BROKERS) {
      this.connectWssBroker(url);
    }

    // Also poll local Electron HTTP bridge if running on Desktop for offline LAN UDP delivery
    if (isElectron()) {
      this.startLocalElectronRelayPoll();
    }

    // Announce online presence periodically
    setTimeout(() => {
      this.announcePresence();
      this.sendPacket('bridge-presence-ping', 'GLOBAL', { fromCode: this.myCode });
    }, 600);

    setInterval(() => {
      this.announcePresence();
      this.pruneStalePeers();
    }, 12000);
  }

  private connectWssBroker(url: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';
    } catch {
      setTimeout(() => this.connectWssBroker(url), 5000);
      return;
    }

    let rxBuffer: Uint8Array = new Uint8Array(0);
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.connectedCount += 1;
      const clientId = `tb-${this.nodeId.slice(0, 8)}-${Math.random().toString(16).slice(2, 6)}`;
      try {
        ws.send(buildMqttConnect(clientId));
        ws.send(buildMqttSubscribe(MQTT_TOPIC, 1));
      } catch {}
      this.sockets.push(ws);
      this.notifyMessengerListeners();

      setTimeout(() => this.announcePresence(), 250);

      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(new Uint8Array([0xc0, 0x00]));
          } catch {}
        }
      }, 25000);
    };

    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const chunk = new Uint8Array(ev.data);
      rxBuffer = concatUint8Arrays([rxBuffer, chunk]);

      while (rxBuffer.length >= 2) {
        const headerByte = rxBuffer[0];
        let multiplier = 1;
        let remLen = 0;
        let offset = 1;
        let encodedByte = 0;
        let hasFullLength = true;

        do {
          if (offset >= rxBuffer.length) {
            hasFullLength = false;
            break;
          }
          encodedByte = rxBuffer[offset++];
          remLen += (encodedByte & 127) * multiplier;
          multiplier *= 128;
        } while ((encodedByte & 128) !== 0 && offset < 5);

        if (!hasFullLength) break;
        const totalPacketLen = offset + remLen;
        if (rxBuffer.length < totalPacketLen) break;

        const packet = rxBuffer.subarray(0, totalPacketLen);
        rxBuffer = rxBuffer.subarray(totalPacketLen);

        const packetType = headerByte & 0xf0;
        if (packetType === 0x30) {
          const topicLen = (packet[offset] << 8) | packet[offset + 1];
          let payloadStart = offset + 2 + topicLen;
          const qos = (headerByte & 0x06) >> 1;
          if (qos > 0) payloadStart += 2;
          const payloadBytes = packet.subarray(payloadStart, totalPacketLen);
          const jsonStr = textDecoder.decode(payloadBytes);
          this.handleRawPacket(jsonStr);
        }
      }
    };

    const cleanup = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (opened) {
        opened = false;
        this.connectedCount = Math.max(0, this.connectedCount - 1);
      }
      const idx = this.sockets.indexOf(ws);
      if (idx !== -1) this.sockets.splice(idx, 1);
      this.notifyMessengerListeners();
      setTimeout(() => this.connectWssBroker(url), 4000);
    };

    ws.onerror = () => {};
    ws.onclose = cleanup;
  }

  private startLocalElectronRelayPoll(): void {
    let sinceTs = Date.now() - 2000;
    setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:3001/api/messenger-events?since=${sinceTs}`);
        if (!res.ok) return;
        const data = (await res.json()) as { packets?: UniversalBridgePacket[]; now?: number };
        if (Array.isArray(data.packets)) {
          for (const pkt of data.packets) {
            this.handleParsedPacket(pkt);
          }
        }
        if (data.now) sinceTs = data.now;
      } catch {
        // ignore if port 3001 not ready
      }
    }, 1200);
  }

  public isOnline(): boolean {
    return this.connectedCount > 0 || isElectron();
  }

  public getMyIdentity(): { userCode: string; userName: string; platform: DevicePlatform } {
    const storedName =
      this.myName ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('zoomclone_user_name') || '' : '');
    return {
      userCode: this.myCode,
      userName: storedName || '사용자',
      platform: this.myPlatform,
    };
  }

  public setMyName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.myName = trimmed;
    try {
      localStorage.setItem('zoomclone_user_name', trimmed);
    } catch {}
    this.announcePresence();
    this.notifyMessengerListeners();
  }

  public announcePresence(): void {
    const { userCode, userName, platform } = this.getMyIdentity();
    this.sendPacket('bridge-presence', 'GLOBAL', {
      userCode,
      userName,
      platform,
      ts: Date.now(),
    });
  }

  private pruneStalePeers(): void {
    const cutoff = Date.now() - 45000;
    let changed = false;
    for (const [code, peer] of this.peers.entries()) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(code);
        changed = true;
      }
    }
    if (changed) this.notifyMessengerListeners();
  }

  public sendPacket(
    type: UniversalBridgePacket['type'],
    meetingId: string,
    data: any
  ): UniversalBridgePacket {
    const pkt: UniversalBridgePacket = {
      msgId: uuidv4(),
      nodeId: this.nodeId,
      meetingId,
      type,
      data,
      ts: Date.now(),
    };
    this.seenMsgIds.add(pkt.msgId);
    if (this.seenMsgIds.size > 4000) {
      const first = this.seenMsgIds.values().next().value;
      if (first) this.seenMsgIds.delete(first);
    }

    const jsonStr = JSON.stringify(pkt);
    const mqttBin = buildMqttPublish(MQTT_TOPIC, jsonStr);
    for (const ws of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(mqttBin);
        } catch {}
      }
    }

    // Also forward to local Electron UDP/MQTT bridge if on Desktop
    if (isElectron()) {
      fetch('http://127.0.0.1:3001/api/messenger-relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr,
      }).catch(() => {});
    }

    return pkt;
  }

  private handleRawPacket(rawJson: string): void {
    try {
      const pkt = JSON.parse(rawJson) as UniversalBridgePacket;
      this.handleParsedPacket(pkt);
    } catch {
      // ignore malformed
    }
  }

  private handleParsedPacket(pkt: UniversalBridgePacket): void {
    if (!pkt || !pkt.msgId || !pkt.nodeId || pkt.nodeId === this.nodeId) return;
    if (this.seenMsgIds.has(pkt.msgId)) return;
    this.seenMsgIds.add(pkt.msgId);
    if (this.seenMsgIds.size > 4000) {
      const first = this.seenMsgIds.values().next().value;
      if (first) this.seenMsgIds.delete(first);
    }

    // Handle presence & messenger packets internally
    if (pkt.type === 'bridge-presence') {
      const { userCode, userName, platform } = (pkt.data || {}) as {
        userCode?: string;
        userName?: string;
        platform?: DevicePlatform;
      };
      if (userCode && userCode !== this.myCode) {
        this.peers.set(userCode, {
          userCode,
          userName: userName || userCode,
          platform: platform || 'web',
          lastSeen: Date.now(),
        });
        // Update DM conversation title if exists
        const dmId = makeDmConversationId(this.myCode, userCode);
        const existingConv = this.conversations.get(dmId);
        if (existingConv && userName) {
          existingConv.title = `${userName} (${userCode})`;
        }
        this.notifyMessengerListeners();
      }
    } else if (pkt.type === 'bridge-presence-ping') {
      this.announcePresence();
    } else if (pkt.type === 'bridge-messenger-msg') {
      this.handleIncomingMessengerMsg(pkt.data as MessengerMessage);
    } else if (pkt.type === 'bridge-messenger-file-chunk') {
      this.handleIncomingMessengerFileChunk(pkt.data);
    }

    for (const listener of this.packetListeners) {
      try {
        listener(pkt);
      } catch (err) {
        console.error('[CloudBus] Packet listener error:', err);
      }
    }
  }

  public onPacket(listener: PacketListener): () => void {
    this.start();
    this.packetListeners.add(listener);
    return () => {
      this.packetListeners.delete(listener);
    };
  }

  public onMessengerUpdate(listener: MessengerUpdateListener): () => void {
    this.start();
    this.messengerListeners.add(listener);
    return () => {
      this.messengerListeners.delete(listener);
    };
  }

  private notifyMessengerListeners(): void {
    for (const l of this.messengerListeners) {
      try {
        l();
      } catch {}
    }
  }

  // --- Messenger Public API ---
  public getOnlinePeers(): MessengerPeer[] {
    return Array.from(this.peers.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  public getConversations(): MessengerConversation[] {
    return Array.from(this.conversations.values()).sort((a, b) => {
      if (a.id === 'public') return -1;
      if (b.id === 'public') return 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  public getMessages(conversationId: string): MessengerMessage[] {
    return this.messagesByConv.get(conversationId) || [];
  }

  public getTotalUnreadCount(): number {
    let total = 0;
    for (const conv of this.conversations.values()) {
      total += conv.unreadCount || 0;
    }
    return total;
  }

  public markConversationRead(conversationId: string): void {
    const conv = this.conversations.get(conversationId);
    if (conv && conv.unreadCount > 0) {
      conv.unreadCount = 0;
      this.persistMessengerState();
      this.notifyMessengerListeners();
    }
  }

  public openDmConversation(peerCodeRaw: string, peerName?: string): MessengerConversation {
    const peerCode = peerCodeRaw.trim().toUpperCase();
    const convId = makeDmConversationId(this.myCode, peerCode);
    let conv = this.conversations.get(convId);
    const knownPeer = this.peers.get(peerCode);
    const displayTitle = peerName || knownPeer?.userName ? `${peerName || knownPeer?.userName} (${peerCode})` : `개인 대화 (${peerCode})`;

    if (!conv) {
      conv = {
        id: convId,
        type: 'dm',
        title: displayTitle,
        peerCode,
        unreadCount: 0,
        updatedAt: Date.now(),
      };
      this.conversations.set(convId, conv);
      this.persistMessengerState();
      this.notifyMessengerListeners();
    }
    return conv;
  }

  public openRoomConversation(roomCodeRaw: string): MessengerConversation {
    const roomCode = roomCodeRaw.trim().toUpperCase();
    const convId = `room:${roomCode}`;
    let conv = this.conversations.get(convId);
    if (!conv) {
      conv = {
        id: convId,
        type: 'room',
        title: `# ${roomCode} 그룹방`,
        roomCode,
        unreadCount: 0,
        updatedAt: Date.now(),
      };
      this.conversations.set(convId, conv);
      this.persistMessengerState();
      this.notifyMessengerListeners();
    }
    return conv;
  }

  public sendTextMessage(
    conversationId: string,
    text: string,
    meetingInviteId?: string
  ): MessengerMessage | null {
    const trimmed = text.trim();
    if (!trimmed && !meetingInviteId) return null;

    const { userCode, userName, platform } = this.getMyIdentity();
    const conv = this.conversations.get(conversationId);

    const msg: MessengerMessage = {
      id: uuidv4(),
      conversationId,
      fromCode: userCode,
      fromName: userName,
      fromPlatform: platform,
      toCode: conv?.type === 'dm' ? conv.peerCode : undefined,
      roomCode: conv?.type === 'room' ? conv.roomCode : undefined,
      text: trimmed,
      timestamp: Date.now(),
      meetingInviteId,
    };

    this.appendMessage(msg, false);
    this.sendPacket('bridge-messenger-msg', 'GLOBAL', msg);
    return msg;
  }

  public async sendFileMessage(
    conversationId: string,
    file: File,
    caption = ''
  ): Promise<MessengerMessage | null> {
    const { userCode, userName, platform } = this.getMyIdentity();
    const conv = this.conversations.get(conversationId);

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    const base64Body = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const attachmentId = uuidv4();
    const messageId = uuidv4();
    const mimeType = file.type || 'application/octet-stream';

    const localMsg: MessengerMessage = {
      id: messageId,
      conversationId,
      fromCode: userCode,
      fromName: userName,
      fromPlatform: platform,
      toCode: conv?.type === 'dm' ? conv.peerCode : undefined,
      roomCode: conv?.type === 'room' ? conv.roomCode : undefined,
      text: caption.trim(),
      timestamp: Date.now(),
      attachment: {
        id: attachmentId,
        name: file.name,
        mimeType,
        size: file.size,
        dataUrl,
        progress: 0,
        isComplete: false,
      },
    };

    this.appendMessage(localMsg, false);

    // 1. Send message metadata first (without full base64 body)
    const remoteMetaMsg: MessengerMessage = {
      ...localMsg,
      attachment: {
        id: attachmentId,
        name: file.name,
        mimeType,
        size: file.size,
        progress: 0,
        isComplete: false,
      },
    };
    this.sendPacket('bridge-messenger-msg', 'GLOBAL', remoteMetaMsg);

    // 2. Stream base64 chunks reliably
    const CHUNK_LEN = 22 * 1024;
    const totalChunks = Math.max(1, Math.ceil(base64Body.length / CHUNK_LEN));

    for (let i = 0; i < totalChunks; i++) {
      const chunkBase64 = base64Body.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN);
      await new Promise<void>((r) => setTimeout(r, 14));
      this.sendPacket('bridge-messenger-file-chunk', 'GLOBAL', {
        conversationId,
        messageId,
        toCode: localMsg.toCode,
        roomCode: localMsg.roomCode,
        mimeType,
        chunkIndex: i,
        totalChunks,
        chunkBase64,
      });

      const pct = Math.round(((i + 1) / totalChunks) * 100);
      this.updateAttachmentProgress(conversationId, messageId, pct, i + 1 === totalChunks ? dataUrl : undefined);
    }

    return localMsg;
  }

  private handleIncomingMessengerMsg(msg: MessengerMessage): void {
    if (!msg || !msg.id || msg.fromCode === this.myCode) return;

    // Filter: check if this message is addressed to us
    if (msg.toCode) {
      if (msg.toCode !== this.myCode) return;
      const dmId = makeDmConversationId(this.myCode, msg.fromCode);
      msg = { ...msg, conversationId: dmId };
      if (!this.conversations.has(dmId)) {
        this.conversations.set(dmId, {
          id: dmId,
          type: 'dm',
          title: `${msg.fromName} (${msg.fromCode})`,
          peerCode: msg.fromCode,
          unreadCount: 0,
          updatedAt: Date.now(),
        });
      }
    } else if (msg.roomCode) {
      const roomConvId = `room:${msg.roomCode.toUpperCase()}`;
      // Only show room messages if user has joined that room
      if (!this.conversations.has(roomConvId)) return;
      msg = { ...msg, conversationId: roomConvId };
    } else {
      msg = { ...msg, conversationId: 'public' };
    }

    // Also record sender in online peers
    this.peers.set(msg.fromCode, {
      userCode: msg.fromCode,
      userName: msg.fromName,
      platform: msg.fromPlatform || 'web',
      lastSeen: Date.now(),
    });

    this.appendMessage(msg, true);
  }

  private handleIncomingMessengerFileChunk(data: {
    conversationId: string;
    messageId: string;
    toCode?: string;
    roomCode?: string;
    mimeType: string;
    chunkIndex: number;
    totalChunks: number;
    chunkBase64: string;
  }): void {
    if (!data || !data.messageId || typeof data.chunkIndex !== 'number' || !data.totalChunks) return;
    if (data.toCode && data.toCode !== this.myCode) return;

    let targetConvId = data.conversationId;
    if (data.toCode === this.myCode) {
      // Find matching message across DM conversations
      for (const [cid, list] of this.messagesByConv.entries()) {
        if (list.some((m) => m.id === data.messageId)) {
          targetConvId = cid;
          break;
        }
      }
    } else if (data.roomCode) {
      targetConvId = `room:${data.roomCode.toUpperCase()}`;
      if (!this.conversations.has(targetConvId)) return;
    }

    let entry = this.incomingFiles.get(data.messageId);
    if (!entry) {
      entry = {
        conversationId: targetConvId,
        messageId: data.messageId,
        chunks: new Array(data.totalChunks).fill(''),
        received: 0,
        total: data.totalChunks,
        mimeType: data.mimeType || 'application/octet-stream',
      };
      this.incomingFiles.set(data.messageId, entry);
    }

    if (!entry.chunks[data.chunkIndex]) {
      entry.chunks[data.chunkIndex] = data.chunkBase64;
      entry.received += 1;
      const pct = Math.round((entry.received / entry.total) * 100);

      if (entry.received === entry.total) {
        const fullB64 = entry.chunks.join('');
        const fullDataUrl = `data:${entry.mimeType};base64,${fullB64}`;
        this.incomingFiles.delete(data.messageId);
        this.updateAttachmentProgress(entry.conversationId, data.messageId, 100, fullDataUrl);
      } else {
        this.updateAttachmentProgress(entry.conversationId, data.messageId, pct);
      }
    }
  }

  private updateAttachmentProgress(
    conversationId: string,
    messageId: string,
    progress: number,
    completedDataUrl?: string
  ): void {
    const list = this.messagesByConv.get(conversationId);
    if (!list) return;
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1 || !list[idx].attachment) return;

    const updatedMsg: MessengerMessage = {
      ...list[idx],
      attachment: {
        ...list[idx].attachment!,
        progress,
        isComplete: progress >= 100,
        dataUrl: completedDataUrl || list[idx].attachment!.dataUrl,
      },
    };
    const nextList = [...list];
    nextList[idx] = updatedMsg;
    this.messagesByConv.set(conversationId, nextList);
    if (progress >= 100) {
      this.persistMessengerState();
    }
    this.notifyMessengerListeners();
  }

  private appendMessage(msg: MessengerMessage, incrementUnread: boolean): void {
    const list = this.messagesByConv.get(msg.conversationId) || [];
    if (list.some((m) => m.id === msg.id)) return;

    const next = [...list, msg].slice(-120);
    this.messagesByConv.set(msg.conversationId, next);

    const conv = this.conversations.get(msg.conversationId);
    if (conv) {
      conv.updatedAt = msg.timestamp;
      if (incrementUnread) {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
      }
    }
    this.persistMessengerState();
    this.notifyMessengerListeners();
  }
}

export const cloudBus = new UniversalCloudBus();
