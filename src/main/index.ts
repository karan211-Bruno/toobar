// Main Electron process
// Handles: window management, native menus, system tray, signaling server lifecycle

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
  shell,
  dialog,
  session,
  desktopCapturer,
} from 'electron';
import { join, resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import {
  existsSync,
  statSync,
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { createServer, Server as HttpServer, get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import { gunzipSync, gzipSync } from 'zlib';
import { createHash } from 'crypto';
import * as net from 'net';
import * as dgram from 'dgram';
import { networkInterfaces, userInfo } from 'os';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type {
  User,
  Meeting,
  MeetingSettings,
  SignalingMessage,
  SignalingMessageType,
  JoinPayload,
  OfferPayload,
  AnswerPayload,
  IceCandidatePayload,
  UserJoinedPayload,
  UserLeftPayload,
  UserUpdatedPayload,
  MeetingStatePayload,
  ChatPayload,
  ErrorPayload,
} from '../shared/types';

const RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

const MEDIA_CONSTRAINTS = {
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

const isDev = process.env.NODE_ENV === 'development';

try {
  app.setName('Toobar');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.toobar.app');
  } else if (process.platform === 'linux') {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
  }
} catch {
  // ignore
}

export interface UpdateManifest {
  version: string;
  buildId: string;
  buildTimestamp: number;
  releaseNotes?: string;
  notes?: string;
  hash?: string;
}

export interface UpdateBundlePayload {
  manifest: UpdateManifest;
  filesGzipBase64: string;
}

export interface UpdateStatusInfo {
  currentManifest: UpdateManifest;
  latestManifest: UpdateManifest | null;
  hasUpdate: boolean;
  updateReadyToApply: boolean;
  autoUpdate: boolean;
  currentVersion: string;
  currentBuildId: string;
  currentBuildTimestamp: number;
  isLivePatched: boolean;
  autoUpdateEnabled: boolean;
  updateSourceUrl: string;
  lastCheckedAt: number | null;
  availableUpdate: UpdateManifest | null;
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error';
  progress: number;
  message: string;
}

export interface UpdateEventPayload {
  type?: 'checking' | 'update-available' | 'downloading' | 'update-downloaded' | 'up-to-date' | 'applied' | 'error';
  status?: UpdateStatusInfo['status'];
  manifest?: UpdateManifest | null;
  progress?: number;
  autoUpdate?: boolean;
  message?: string;
  autoApplied?: boolean;
}

function getLiveUpdateDir(): string {
  try {
    return join(app.getPath('userData'), 'live-update');
  } catch {
    return join(__dirname, '../../live-update');
  }
}

function getUpdateSettingsPath(): string {
  try {
    return join(app.getPath('userData'), 'update-settings.json');
  } catch {
    return join(__dirname, '../../update-settings.json');
  }
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf8')) as T;
    }
  } catch {
    // ignore
  }
  return null;
}

function getBundledManifest(): UpdateManifest {
  const bundledPath = join(__dirname, '../update-manifest.json');
  const parsed = readJsonSafe<UpdateManifest>(bundledPath);
  if (parsed && parsed.buildTimestamp) {
    return parsed;
  }
  return {
    version: app.getVersion() || '1.0.0',
    buildId: 'base-1.0.0',
    buildTimestamp: 1730000000000,
    releaseNotes: '기본 설치 패키지 빌드',
  };
}

function getLiveInstalledManifest(): UpdateManifest | null {
  const liveManifestPath = join(getLiveUpdateDir(), 'dist', 'update-manifest.json');
  const parsed = readJsonSafe<UpdateManifest>(liveManifestPath);
  if (parsed && parsed.buildTimestamp) {
    const liveRenderer = join(getLiveUpdateDir(), 'dist', 'renderer', 'index.html');
    if (existsSync(liveRenderer)) {
      return parsed;
    }
  }
  return null;
}

function isLiveUpdateActive(): boolean {
  const bundled = getBundledManifest();
  const live = getLiveInstalledManifest();
  return Boolean(live && live.buildTimestamp >= bundled.buildTimestamp);
}

function getActiveManifest(): UpdateManifest {
  const bundled = getBundledManifest();
  const live = getLiveInstalledManifest();
  if (live && live.buildTimestamp >= bundled.buildTimestamp) {
    return live;
  }
  return bundled;
}

function getEffectivePreloadPath(): string {
  if (isLiveUpdateActive()) {
    const livePreload = join(getLiveUpdateDir(), 'dist', 'main', 'preload.js');
    if (existsSync(livePreload)) {
      return livePreload;
    }
  }
  return join(__dirname, 'preload.js');
}

function getEffectiveRendererUrl(): string {
  if (isDev) {
    return 'http://localhost:5173';
  }
  if (isLiveUpdateActive()) {
    const liveHtml = join(getLiveUpdateDir(), 'dist', 'renderer', 'index.html');
    if (existsSync(liveHtml)) {
      return pathToFileURL(liveHtml).toString();
    }
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString();
}

export interface DeepLinkInvite {
  meetingId: string;
  serverUrl?: string;
  userName?: string;
  password?: string;
  autoJoin: boolean;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentMeetingId: string | null = null;
let currentUserId: string | null = null;
let httpServer: HttpServer | null = null;
let ioServer: SocketIOServer | null = null;

// Track which meeting each BrowserWindow is currently in (null if on LoginScreen)
const windowMeetingMap = new Map<number, string | null>();
// Pending deep-link invite per window
const pendingDeepLinkByWindow = new Map<number, DeepLinkInvite>();
let startupDeepLink: DeepLinkInvite | null = null;

// Register toobar:// custom protocol with the OS
try {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('toobar', process.execPath, [resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('toobar');
  }
} catch (err) {
  console.warn('[Protocol] Failed to register protocol:', err);
}

function getLocalIpAddress(): string {
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch {
    // ignore
  }
  return '127.0.0.1';
}

function getDefaultUserName(): string {
  try {
    const info = userInfo();
    if (info.username) return info.username;
  } catch {
    // ignore
  }
  return '참가자';
}

function isCustomDeepLink(url: string): boolean {
  return url.startsWith('toobar://');
}

function parseDeepLinkUrl(rawUrl: string): DeepLinkInvite | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  try {
    if (
      isCustomDeepLink(trimmed) ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://')
    ) {
      const parsed = new URL(trimmed);
      let meetingId =
        parsed.searchParams.get('meetingId') ||
        parsed.searchParams.get('room') ||
        parsed.searchParams.get('id') ||
        '';
      if (!meetingId && parsed.protocol === 'toobar:') {
        const hostPart = parsed.hostname && parsed.hostname !== 'join' ? parsed.hostname : '';
        const pathPart = parsed.pathname.replace(/^\/+/, '');
        meetingId = pathPart || hostPart;
      }
      meetingId = meetingId.trim().toUpperCase();
      if (!meetingId) return null;
      const serverParam = parsed.searchParams.get('server') || undefined;
      const nameParam = parsed.searchParams.get('name') || parsed.searchParams.get('userName') || undefined;
      const passwordParam = parsed.searchParams.get('password') || parsed.searchParams.get('pwd') || undefined;
      return {
        meetingId,
        serverUrl: serverParam ? decodeURIComponent(serverParam) : undefined,
        userName: nameParam ? decodeURIComponent(nameParam) : undefined,
        password: passwordParam ? decodeURIComponent(passwordParam) : undefined,
        autoJoin: true,
      };
    }
  } catch {
    // Fallback regex parsing
    const match = trimmed.match(/[?&]meetingId=([^&\s]+)/i);
    if (match?.[1]) {
      const srvMatch = trimmed.match(/[?&]server=([^&\s]+)/i);
      return {
        meetingId: decodeURIComponent(match[1]).toUpperCase(),
        serverUrl: srvMatch?.[1] ? decodeURIComponent(srvMatch[1]) : undefined,
        autoJoin: true,
      };
    }
  }
  return null;
}

function handleIncomingDeepLink(rawUrl: string): void {
  const invite = parseDeepLinkUrl(rawUrl);
  if (!invite) return;

  console.log('[DeepLink] Received invite:', invite);

  if (!app.isReady()) {
    startupDeepLink = invite;
    return;
  }

  // Find a window that is NOT currently in a meeting
  const allWindows = BrowserWindow.getAllWindows();
  const idleWindow = allWindows.find((w) => !w.isDestroyed() && !windowMeetingMap.get(w.id));

  if (idleWindow) {
    pendingDeepLinkByWindow.set(idleWindow.id, invite);
    if (idleWindow.isMinimized()) idleWindow.restore();
    idleWindow.show();
    idleWindow.focus();
    app.focus({ steal: true });
    idleWindow.webContents.send('deep-link-invite', invite);
  } else {
    // Either no window is open, or all open windows are already in a meeting (e.g. Host testing on same PC)
    const newWin = createMainWindow(invite);
    newWin.once('ready-to-show', () => {
      newWin.show();
      newWin.focus();
      app.focus({ steal: true });
    });
  }
}

// Check command-line arguments on cold start (Windows / Linux)
const initialDeepLinkArg = process.argv.find((arg) => isCustomDeepLink(arg));
if (initialDeepLinkArg) {
  startupDeepLink = parseDeepLinkUrl(initialDeepLinkArg);
}

// Register macOS open-url handler before app.whenReady()
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleIncomingDeepLink(url);
});

// Single-instance lock so launching a second time or clicking a link on Windows/Linux forwards cleanly
if (process.platform !== 'darwin') {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, commandLine) => {
      const deepUrl = commandLine.find((arg) => isCustomDeepLink(arg));
      if (deepUrl) {
        handleIncomingDeepLink(deepUrl);
        return;
      }
      const allWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      const idleWin = allWindows.find((w) => !windowMeetingMap.get(w.id)) || allWindows[0];
      if (idleWin) {
        if (idleWin.isMinimized()) idleWin.restore();
        idleWin.show();
        idleWin.focus();
      } else {
        createMainWindow();
      }
    });
  }
}

function resolvePublicAssetPath(relFile: string): string {
  const inAsar = join(__dirname, '../../public', relFile);
  const unpacked = inAsar.replace('app.asar', 'app.asar.unpacked');
  if (unpacked !== inAsar && existsSync(unpacked)) {
    return unpacked;
  }
  return inAsar;
}

function getWindowIconPath(): string | undefined {
  try {
    if (process.platform === 'win32') {
      const icoPath = resolvePublicAssetPath('icon.ico');
      if (existsSync(icoPath)) return icoPath;
    }
    const pngPath = resolvePublicAssetPath('icon.png');
    if (existsSync(pngPath)) return pngPath;
  } catch {
    // ignore
  }
  return undefined;
}

function createMainWindow(initialInvite?: DeepLinkInvite): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const existingCount = BrowserWindow.getAllWindows().length;
  const offset = existingCount * 32;
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    title: 'Toobar - 화상 회의',
    width: Math.min(1280, width),
    height: Math.min(840, height),
    minWidth: 800,
    minHeight: 600,
    x: Math.max(0, Math.floor((width - Math.min(1280, width)) / 2) + offset),
    y: Math.max(0, Math.floor((height - Math.min(840, height)) / 2) + offset),
    show: false,
    backgroundColor: '#0f172a',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {
          titleBarStyle: 'default' as const,
          autoHideMenuBar: false,
        }),
    webPreferences: {
      preload: getEffectivePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      plugins: true,
      allowRunningInsecureContent: true,
      spellcheck: true,
    },
    icon: getWindowIconPath(),
  });

  if (!mainWindow) {
    mainWindow = win;
  }

  windowMeetingMap.set(win.id, null);

  if (initialInvite) {
    pendingDeepLinkByWindow.set(win.id, initialInvite);
  }

  const baseRendererUrl = getEffectiveRendererUrl();
  let targetUrl = baseRendererUrl;
  if (initialInvite) {
    const params = new URLSearchParams();
    params.set('meetingId', initialInvite.meetingId);
    if (initialInvite.serverUrl) params.set('server', initialInvite.serverUrl);
    if (initialInvite.userName) params.set('name', initialInvite.userName);
    if (initialInvite.password) params.set('password', initialInvite.password);
    params.set('autoJoin', '1');
    targetUrl = `${baseRendererUrl}?${params.toString()}`;
  }

  const showWindowSafely = () => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      win.focus();
    }
  };

  // Fallback timer so the window always appears on Windows/Linux even if GPU ready-to-show lags
  const fallbackShowTimer = setTimeout(showWindowSafely, 1200);

  win.loadURL(targetUrl).catch((err) => {
    console.error('[Window] loadURL error:', err);
    showWindowSafely();
  });

  win.webContents.on('did-finish-load', () => {
    showWindowSafely();
    const pending = pendingDeepLinkByWindow.get(win.id);
    if (pending) {
      win.webContents.send('deep-link-invite', pending);
    }
  });

  win.once('ready-to-show', () => {
    clearTimeout(fallbackShowTimer);
    showWindowSafely();
    if (isDev && existingCount === 0) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  win.on('closed', () => {
    clearTimeout(fallbackShowTimer);
    windowMeetingMap.delete(win.id);
    pendingDeepLinkByWindow.delete(win.id);
    if (mainWindow === win) {
      const remaining = BrowserWindow.getAllWindows().filter((w) => w !== win);
      mainWindow = remaining[0] || null;
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isCustomDeepLink(url)) {
      handleIncomingDeepLink(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  createAppMenu();
  return win;
}

function createAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const appSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: 'about', label: 'Toobar 정보' },
    {
      label: '업데이트 확인 및 설정 (자동/수동 OTA)...',
      accelerator: 'CmdOrCtrl+U',
      click: () => {
        BrowserWindow.getFocusedWindow()?.webContents.send('menu-check-updates');
        triggerManualOrAutoUpdateCheck({ manual: true });
      },
    },
    { type: 'separator' },
    ...(isMac
      ? ([
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    { role: 'quit', label: '종료' },
  ];

  const windowSubmenu: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ]
    : [{ role: 'minimize' }, { role: 'close' }];

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Toobar',
      submenu: appSubmenu,
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '창',
      submenu: windowSubmenu,
    },
    {
      label: '회의',
      submenu: [
        {
          label: '새 회의',
          accelerator: 'CmdOrCtrl+N',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu-new-meeting'),
        },
        {
          label: '회의 참가',
          accelerator: 'CmdOrCtrl+J',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu-join-meeting'),
        },
        {
          label: '새 참가자 창 열기 (다중 클라이언트 테스트)',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createMainWindow(),
        },
        { type: 'separator' },
        {
          label: '오디오 설정...',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu-audio-settings'),
        },
        {
          label: '비디오 설정...',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu-video-settings'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray(): void {
  const iconPath = getWindowIconPath();

  if (iconPath && existsSync(iconPath)) {
    try {
      const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      tray = new Tray(icon);

      const restoreOrOpenWindow = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      };

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Toobar 열기',
          click: restoreOrOpenWindow,
        },
        {
          label: '새 참가자 창 열기',
          click: () => {
            createMainWindow();
          },
        },
        { type: 'separator' },
        {
          label: '종료',
          click: () => {
            app.quit();
          },
        },
      ]);

      tray.setToolTip('Toobar');
      tray.setContextMenu(contextMenu);

      tray.on('click', restoreOrOpenWindow);
      tray.on('double-click', restoreOrOpenWindow);
    } catch (err) {
      console.warn('[Tray] Failed to create tray icon:', err);
    }
  }
}

let bridgeCleanup: (() => void) | null = null;

function encodeMqttRemainingLength(len: number): Buffer {
  const bytes: number[] = [];
  do {
    let encodedByte = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) encodedByte = encodedByte | 128;
    bytes.push(encodedByte);
  } while (len > 0);
  return Buffer.from(bytes);
}

function buildMqttConnectPacket(clientId: string): Buffer {
  const idBuf = Buffer.from(clientId, 'utf8');
  const vh = Buffer.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c]);
  const payload = Buffer.concat([Buffer.from([idBuf.length >> 8, idBuf.length & 0xff]), idBuf]);
  const rem = encodeMqttRemainingLength(vh.length + payload.length);
  return Buffer.concat([Buffer.from([0x10]), rem, vh, payload]);
}

function buildMqttSubscribePacket(topic: string, packetId = 1): Buffer {
  const tBuf = Buffer.from(topic, 'utf8');
  const vh = Buffer.from([packetId >> 8, packetId & 0xff]);
  const payload = Buffer.concat([
    Buffer.from([tBuf.length >> 8, tBuf.length & 0xff]),
    tBuf,
    Buffer.from([0x00]),
  ]);
  const rem = encodeMqttRemainingLength(vh.length + payload.length);
  return Buffer.concat([Buffer.from([0x82]), rem, vh, payload]);
}

function buildMqttPublishPacket(topic: string, messageStr: string): Buffer {
  const tBuf = Buffer.from(topic, 'utf8');
  const mBuf = Buffer.from(messageStr, 'utf8');
  const vh = Buffer.concat([Buffer.from([tBuf.length >> 8, tBuf.length & 0xff]), tBuf]);
  const rem = encodeMqttRemainingLength(vh.length + mBuf.length);
  return Buffer.concat([Buffer.from([0x30]), rem, vh, mBuf]);
}

function getSubnetBroadcastAddresses(): string[] {
  const targets = new Set<string>(['255.255.255.255', '239.255.42.99']);
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const netInfo of nets[name] || []) {
        if (netInfo.family === 'IPv4' && !netInfo.internal && netInfo.netmask) {
          const ipParts = netInfo.address.split('.').map(Number);
          const maskParts = netInfo.netmask.split('.').map(Number);
          if (ipParts.length === 4 && maskParts.length === 4) {
            const bcast = ipParts.map((p, idx) => (p | (~maskParts[idx] & 0xff)) & 0xff).join('.');
            targets.add(bcast);
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return Array.from(targets);
}

interface BridgePacket {
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

// --- Live OTA Update Engine State & Helpers ---
let updateStatus: UpdateStatusInfo['status'] = 'idle';
let updateProgress = 0;
let updateMessage = '자동 및 수동 OTA 라이브 업데이트가 활성화되어 있습니다.';
let lastUpdateCheckedAt: number | null = null;
let pendingAvailableUpdate: UpdateManifest | null = null;
let autoUpdateEnabled = true;
let customUpdateServerUrl = '';
let globalSendBridgePacket: ((type: BridgePacket['type'], meetingId: string, data: any) => void) | null = null;

function loadUpdateSettings(): void {
  const settings = readJsonSafe<{ autoUpdateEnabled?: boolean; customUpdateServerUrl?: string }>(
    getUpdateSettingsPath()
  );
  if (settings) {
    if (typeof settings.autoUpdateEnabled === 'boolean') {
      autoUpdateEnabled = settings.autoUpdateEnabled;
    }
    if (typeof settings.customUpdateServerUrl === 'string') {
      customUpdateServerUrl = settings.customUpdateServerUrl;
    }
  }
}

function saveUpdateSettings(): void {
  try {
    const p = getUpdateSettingsPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ autoUpdateEnabled, customUpdateServerUrl }, null, 2),
      'utf8'
    );
  } catch {
    // ignore
  }
}

loadUpdateSettings();

function broadcastUpdateEvent(payload: UpdateEventPayload): void {
  if (payload.status) updateStatus = payload.status;
  if (typeof payload.progress === 'number') updateProgress = payload.progress;
  if (payload.message) updateMessage = payload.message;
  if (payload.manifest !== undefined) pendingAvailableUpdate = payload.manifest;

  const mappedType: UpdateEventPayload['type'] =
    payload.type ||
    (payload.status === 'ready'
      ? 'update-downloaded'
      : payload.status === 'checking'
      ? 'checking'
      : payload.status === 'downloading'
      ? 'downloading'
      : payload.status === 'up-to-date'
      ? 'up-to-date'
      : payload.status === 'error'
      ? 'error'
      : 'up-to-date');

  const fullPayload: UpdateEventPayload = {
    ...payload,
    type: mappedType,
    autoUpdate: autoUpdateEnabled,
  };

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('update-event', fullPayload);
    }
  }
}

function getLocalUpdateBundle(): UpdateBundlePayload | null {
  // 1. Check live-update directory first
  const liveBundlePath = join(getLiveUpdateDir(), 'dist', 'update-bundle.json');
  const liveBundle = readJsonSafe<UpdateBundlePayload>(liveBundlePath);
  const bundledBundlePath = join(__dirname, '../update-bundle.json');
  const bundledBundle = readJsonSafe<UpdateBundlePayload>(bundledBundlePath);

  if (
    liveBundle?.manifest &&
    liveBundle.filesGzipBase64 &&
    (!bundledBundle?.manifest || liveBundle.manifest.buildTimestamp >= bundledBundle.manifest.buildTimestamp)
  ) {
    return liveBundle;
  }
  if (bundledBundle?.manifest && bundledBundle.filesGzipBase64) {
    return bundledBundle;
  }
  return null;
}

function installUpdateBundle(bundle: UpdateBundlePayload, options?: { silent?: boolean }): boolean {
  try {
    if (!bundle || !bundle.manifest || !bundle.filesGzipBase64) return false;
    const rawBuf = gunzipSync(Buffer.from(bundle.filesGzipBase64, 'base64'));
    const fileMap = JSON.parse(rawBuf.toString('utf8')) as Record<string, string>;

    const targetRoot = getLiveUpdateDir();
    mkdirSync(targetRoot, { recursive: true });

    for (const [relPath, base64Content] of Object.entries(fileMap)) {
      const safeRel = relPath.replace(/^(\.\.(\/|\\|$))+/, '');
      const fullDest = join(targetRoot, safeRel);
      mkdirSync(dirname(fullDest), { recursive: true });
      writeFileSync(fullDest, Buffer.from(base64Content, 'base64'));
    }

    // Write manifest & bundle so this node can also seed the update to other PCs
    const manifestDest = join(targetRoot, 'dist', 'update-manifest.json');
    mkdirSync(dirname(manifestDest), { recursive: true });
    writeFileSync(manifestDest, JSON.stringify(bundle.manifest, null, 2), 'utf8');

    const bundleDest = join(targetRoot, 'dist', 'update-bundle.json');
    writeFileSync(bundleDest, JSON.stringify(bundle), 'utf8');

    pendingAvailableUpdate = bundle.manifest;

    // Check if all open windows are idle (on LoginScreen, not in an active meeting)
    const allWins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    const anyInMeeting = allWins.some((w) => Boolean(windowMeetingMap.get(w.id)));

    if (autoUpdateEnabled && !anyInMeeting && allWins.length > 0 && !options?.silent) {
      // Automatically hot-reload idle windows so the user immediately sees the updated version
      const newUrl = getEffectiveRendererUrl();
      for (const w of allWins) {
        w.loadURL(newUrl);
      }
      broadcastUpdateEvent({
        status: 'ready',
        manifest: bundle.manifest,
        progress: 100,
        message: `새 버전 (${bundle.manifest.buildId})이 다운로드되어 자동으로 화면에 적용되었습니다!`,
        autoApplied: true,
      });
    } else {
      broadcastUpdateEvent({
        status: 'ready',
        manifest: bundle.manifest,
        progress: 100,
        message: `새 업데이트 (${bundle.manifest.buildId}) 설치 준비 완료! '즉시 적용' 버튼을 누르면 바로 반영됩니다.`,
        autoApplied: false,
      });
    }
    return true;
  } catch (err) {
    console.error('[OTA Update] Failed to install update bundle:', err);
    broadcastUpdateEvent({
      status: 'error',
      progress: 0,
      message: `업데이트 패키지 압축 해제 중 오류가 발생했습니다: ${String(err)}`,
    });
    return false;
  }
}

function fetchJsonOverHttp<T>(urlStr: string, timeoutMs = 3500): Promise<T | null> {
  return new Promise((resolveReq) => {
    try {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? httpsGet : httpGet;
      const req = client(
        urlStr,
        { timeout: timeoutMs, headers: { Accept: 'application/json' } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            resolveReq(null);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.from(c)));
          res.on('end', () => {
            try {
              const body = Buffer.concat(chunks).toString('utf8');
              resolveReq(JSON.parse(body) as T);
            } catch {
              resolveReq(null);
            }
          });
        }
      );
      req.on('error', () => resolveReq(null));
      req.on('timeout', () => {
        req.destroy();
        resolveReq(null);
      });
    } catch {
      resolveReq(null);
    }
  });
}

async function triggerManualOrAutoUpdateCheck(options?: {
  serverUrl?: string;
  manual?: boolean;
}): Promise<{
  hasUpdate: boolean;
  manifest?: UpdateManifest | null;
  status: UpdateStatusInfo;
}> {
  if (options?.serverUrl && options.serverUrl.trim()) {
    customUpdateServerUrl = options.serverUrl.trim().replace(/\/+$/, '');
    saveUpdateSettings();
  }

  lastUpdateCheckedAt = Date.now();
  const activeManifest = getActiveManifest();

  broadcastUpdateEvent({
    status: 'checking',
    progress: 15,
    message: '최신 업데이트 버전을 확인하고 있습니다...',
  });

  // 1. Check local workspace build directory (if running on dev/build PC or shared folder)
  const candidateBundlePaths = [
    join(process.cwd(), 'dist/update-bundle.json'),
  ];
  for (const p of candidateBundlePaths) {
    const diskBundle = readJsonSafe<UpdateBundlePayload>(p);
    if (
      diskBundle?.manifest &&
      diskBundle.filesGzipBase64 &&
      diskBundle.manifest.buildTimestamp > activeManifest.buildTimestamp
    ) {
      broadcastUpdateEvent({
        status: 'downloading',
        manifest: diskBundle.manifest,
        progress: 65,
        message: `로컬 최신 빌드 (${diskBundle.manifest.buildId}) 패치 적용 중...`,
      });
      installUpdateBundle(diskBundle);
      if (globalSendBridgePacket) {
        globalSendBridgePacket('bridge-update-announce', 'GLOBAL', {
          manifest: diskBundle.manifest,
          httpUrl: `http://${getLocalIpAddress()}:3001`,
        });
      }
      return {
        hasUpdate: true,
        manifest: diskBundle.manifest,
        status: getUpdateStatusSnapshot(),
      };
    }
  }

  // 2. Check custom HTTP update server (if configured)
  const candidateUrls: string[] = [];
  if (customUpdateServerUrl) {
    const base = customUpdateServerUrl.startsWith('http')
      ? customUpdateServerUrl
      : `http://${customUpdateServerUrl}`;
    candidateUrls.push(base);
  }

  for (const base of candidateUrls) {
    const remoteManifest = await fetchJsonOverHttp<UpdateManifest>(`${base}/api/update-manifest`);
    if (remoteManifest && remoteManifest.buildTimestamp > activeManifest.buildTimestamp) {
      broadcastUpdateEvent({
        status: 'downloading',
        manifest: remoteManifest,
        progress: 50,
        message: `업데이트 서버에서 새 버전 (${remoteManifest.buildId}) 다운로드 중...`,
      });
      const remoteBundle = await fetchJsonOverHttp<UpdateBundlePayload>(
        `${base}/api/update-bundle`,
        10000
      );
      if (remoteBundle && installUpdateBundle(remoteBundle)) {
        return {
          hasUpdate: true,
          manifest: remoteBundle.manifest,
          status: getUpdateStatusSnapshot(),
        };
      }
    }
  }

  // 3. Query all peers over Cross-PC Bridge (LAN UDP 41234 + Cloud MQTT)
  if (globalSendBridgePacket) {
    globalSendBridgePacket('bridge-update-query', 'GLOBAL', {
      currentBuildTimestamp: activeManifest.buildTimestamp,
      currentBuildId: activeManifest.buildId,
    });
  }

  // Wait briefly (1.1s) in case a peer responds via Cross-PC Bridge
  await new Promise((r) => setTimeout(r, 1100));

  const latestNow = getActiveManifest();
  if (
    pendingAvailableUpdate &&
    pendingAvailableUpdate.buildTimestamp > activeManifest.buildTimestamp
  ) {
    return {
      hasUpdate: true,
      manifest: pendingAvailableUpdate,
      status: getUpdateStatusSnapshot(),
    };
  }
  if (latestNow.buildTimestamp > activeManifest.buildTimestamp) {
    return {
      hasUpdate: true,
      manifest: latestNow,
      status: getUpdateStatusSnapshot(),
    };
  }

  broadcastUpdateEvent({
    status: 'up-to-date',
    manifest: null,
    progress: 100,
    message: `현재 최신 버전 (${latestNow.version} · 빌드 ${latestNow.buildId})을 사용 중입니다.`,
  });

  return {
    hasUpdate: false,
    manifest: null,
    status: getUpdateStatusSnapshot(),
  };
}

function getUpdateStatusSnapshot(): UpdateStatusInfo {
  const active = getActiveManifest();
  const hasNewer = Boolean(
    pendingAvailableUpdate && pendingAvailableUpdate.buildTimestamp > active.buildTimestamp
  );
  return {
    currentManifest: active,
    latestManifest: pendingAvailableUpdate || active,
    hasUpdate: hasNewer,
    updateReadyToApply: hasNewer || updateStatus === 'ready',
    autoUpdate: autoUpdateEnabled,
    currentVersion: active.version || app.getVersion() || '1.0.0',
    currentBuildId: active.buildId,
    currentBuildTimestamp: active.buildTimestamp,
    isLivePatched: isLiveUpdateActive(),
    autoUpdateEnabled,
    updateSourceUrl:
      customUpdateServerUrl || `자동 P2P 클라우드/LAN 브리지 (http://${getLocalIpAddress()}:3001)`,
    lastCheckedAt: lastUpdateCheckedAt,
    availableUpdate: pendingAvailableUpdate,
    status: updateStatus,
    progress: updateProgress,
    message: updateMessage,
  };
}

async function startSignalingServer(): Promise<void> {
  const HTTP_PORT = 3001;
  const WS_PORT = 3002;
  const UDP_BRIDGE_PORT = 41234;
  const MQTT_TOPIC = 'toobar/v2/global_bus';
  const nodeId = uuidv4();

  const meetings = new Map<string, Meeting>();
  const userSockets = new Map<string, { socketId: string; meetingId: string }>();
  const seenMsgIds = new Set<string>();
  const pendingJoinRequests = new Map<
    string,
    (res: { success: boolean; meeting?: Meeting; assignedUserName?: string; error?: ErrorPayload }) => void
  >();

  let sharedPdfBuffer: Buffer | null = null;
  let sharedPdfId = '';
  let lastPdfPullBroadcastAt = 0;
  const incomingPdfChunks = new Map<string, { chunks: string[]; received: number; total: number }>();

  const broadcastSharedPdfChunks = (buf: Buffer, pdfId: string) => {
    try {
      const fullBase64 = buf.toString('base64');
      // 24KB base64 chunks (~33KB JSON) fit safely inside LAN UDP (<50KB) and Cloud MQTT
      const CHUNK_LEN = 24 * 1024;
      const totalChunks = Math.max(1, Math.ceil(fullBase64.length / CHUNK_LEN));
      for (let i = 0; i < totalChunks; i++) {
        const chunkBase64 = fullBase64.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN);
        setTimeout(() => {
          sendBridgePacket('bridge-pdf-chunk', currentMeetingId || 'GLOBAL', {
            pdfId,
            chunkIndex: i,
            totalChunks,
            chunkBase64,
          });
        }, i * 8);
      }
    } catch {
      // ignore chunk broadcast error
    }
  };

  const createDefaultMeetingSettings = (): MeetingSettings => ({
    allowScreenShare: true,
    allowChat: true,
    allowRecording: false,
    muteOnEntry: true,
    videoOnEntry: true,
  });

  const getOrCreateMeeting = (meetingId: string, hostId: string): Meeting => {
    let meeting = meetings.get(meetingId);
    if (!meeting) {
      meeting = {
        id: meetingId,
        name: `Meeting ${meetingId.slice(0, 8)}`,
        hostId,
        participants: [],
        createdAt: Date.now(),
        settings: createDefaultMeetingSettings(),
      };
      meetings.set(meetingId, meeting);
    }
    return meeting;
  };

  const addUserToMeeting = (meeting: Meeting, user: User): void => {
    const existingIdx = meeting.participants.findIndex((p) => p.id === user.id);
    if (existingIdx !== -1) {
      meeting.participants[existingIdx] = user;
      return;
    }
    const baseName = user.name.trim() || '참가자';
    const nameExists = meeting.participants.some((p) => p.name === baseName && p.id !== user.id);
    if (nameExists) {
      user.name = `${baseName} (${meeting.participants.length + 1})`;
    }
    meeting.participants.push(user);
    if (meeting.participants.length === 1) {
      user.isHost = true;
      meeting.hostId = user.id;
    }
  };

  const removeUserFromMeeting = (meetingId: string, userId: string): User | undefined => {
    const meeting = meetings.get(meetingId);
    if (!meeting) return undefined;
    const index = meeting.participants.findIndex((p) => p.id === userId);
    if (index === -1) return undefined;
    const [removedUser] = meeting.participants.splice(index, 1);
    if (removedUser.isHost && meeting.participants.length > 0) {
      meeting.participants[0].isHost = true;
      meeting.hostId = meeting.participants[0].id;
    }
    if (meeting.participants.length === 0) {
      setTimeout(() => {
        const m = meetings.get(meetingId);
        if (m && m.participants.length === 0) {
          meetings.delete(meetingId);
        }
      }, 60000);
    }
    return removedUser;
  };

  const getUserInMeeting = (meetingId: string, userId: string): User | undefined => {
    return meetings.get(meetingId)?.participants.find((p) => p.id === userId);
  };

  const updateUserInMeeting = (
    meetingId: string,
    userId: string,
    updates: Partial<User>
  ): User | undefined => {
    const user = getUserInMeeting(meetingId, userId);
    if (!user) return undefined;
    Object.assign(user, updates);
    return user;
  };

  // --- Cross-PC Bridge Setup (Redundant Cloud MQTT + LAN UDP Broadcast/Multicast) ---
  const mqttSockets: net.Socket[] = [];
  let udpSocket: dgram.Socket | null = null;
  let isBridgeStopped = false;

  const sendBridgePacket = (
    type: BridgePacket['type'],
    meetingId: string,
    data: any
  ): void => {
    const pkt: BridgePacket = {
      msgId: uuidv4(),
      nodeId,
      meetingId,
      type,
      data,
      ts: Date.now(),
    };
    seenMsgIds.add(pkt.msgId);
    const jsonStr = JSON.stringify(pkt);

    // 1. Send via Cloud MQTT Relays
    const mqttPkt = buildMqttPublishPacket(MQTT_TOPIC, jsonStr);
    for (const sock of mqttSockets) {
      if (!sock.destroyed && sock.writable) {
        try {
          sock.write(mqttPkt);
        } catch {
          // ignore write error
        }
      }
    }

    // 2. Send via LAN UDP Broadcast & Multicast (if size fits in UDP datagram)
    if (udpSocket && Buffer.byteLength(jsonStr, 'utf8') < 50000) {
      const buf = Buffer.from(jsonStr, 'utf8');
      for (const addr of getSubnetBroadcastAddresses()) {
        try {
          udpSocket.send(buf, 0, buf.length, UDP_BRIDGE_PORT, addr);
        } catch {
          // ignore
        }
      }
    }
  };

  globalSendBridgePacket = sendBridgePacket;
  const recentMessengerPackets: Array<{ rxAt: number; pkt: BridgePacket }> = [];
  const incomingUpdateChunks = new Map<
    string,
    { manifest: UpdateManifest; chunks: string[]; received: number; total: number }
  >();

  const handleBridgePacket = (rawJson: string): void => {
    let pkt: BridgePacket;
    try {
      pkt = JSON.parse(rawJson);
    } catch {
      return;
    }
    if (!pkt || !pkt.msgId || !pkt.nodeId || pkt.nodeId === nodeId) return;
    if (seenMsgIds.has(pkt.msgId)) return;
    seenMsgIds.add(pkt.msgId);
    if (seenMsgIds.size > 3000) {
      const first = seenMsgIds.values().next().value;
      if (first) seenMsgIds.delete(first);
    }

    const meetingId = (pkt.meetingId || '').trim().toUpperCase();

    switch (pkt.type) {
      case 'bridge-join-req': {
        const localMeeting = meetings.get(meetingId);
        if (!localMeeting || localMeeting.participants.length === 0) return;

        const { requestId, user: joiningUser, password } = pkt.data as {
          requestId: string;
          user: User;
          password?: string;
        };

        if (localMeeting.settings.password && localMeeting.settings.password !== password) {
          sendBridgePacket('bridge-join-res', meetingId, {
            requestId,
            success: false,
            error: { code: 'INVALID_PASSWORD', message: '잘못된 회의 비밀번호입니다.' },
          });
          return;
        }

        const remoteUser: User = { ...joiningUser, isHost: false };
        const alreadyIn = localMeeting.participants.some((p) => p.id === remoteUser.id);
        addUserToMeeting(localMeeting, remoteUser);

        if (!alreadyIn) {
          ioServer?.to(meetingId).emit('signaling', {
            type: 'user-joined',
            payload: { user: remoteUser },
            from: remoteUser.id,
            meetingId,
            timestamp: Date.now(),
          } as SignalingMessage);
        }

        sendBridgePacket('bridge-join-res', meetingId, {
          requestId,
          success: true,
          meeting: localMeeting,
          assignedUserName: remoteUser.name,
        });
        break;
      }

      case 'bridge-join-res': {
        const { requestId, success, meeting, assignedUserName, error } = pkt.data;
        const resolver = pendingJoinRequests.get(requestId);
        if (resolver) {
          pendingJoinRequests.delete(requestId);
          resolver({ success, meeting, assignedUserName, error });
        }
        break;
      }

      case 'bridge-user-joined':
      case 'bridge-room-sync': {
        const remoteMeeting = pkt.data.meeting as Meeting | undefined;
        const localMeeting = meetings.get(meetingId);
        if (!localMeeting || !remoteMeeting) return;

        const remoteHostTime = remoteMeeting.hostUpdatedAt || 0;
        const localHostTime = localMeeting.hostUpdatedAt || 0;

        // 1. If remote node has a newer explicit host transfer timestamp, adopt its hostId
        if (remoteHostTime > localHostTime && remoteMeeting.hostId) {
          localMeeting.hostUpdatedAt = remoteHostTime;
          if (localMeeting.hostId !== remoteMeeting.hostId) {
            localMeeting.hostId = remoteMeeting.hostId;
            localMeeting.participants.forEach((p) => {
              p.isHost = p.id === localMeeting.hostId;
            });
            ioServer?.to(meetingId).emit('signaling', {
              type: 'host-changed',
              payload: { newHostId: localMeeting.hostId },
              from: 'server',
              meetingId,
              timestamp: Date.now(),
            });
          }
        } else if (
          remoteHostTime === 0 &&
          localHostTime === 0 &&
          remoteMeeting.createdAt < localMeeting.createdAt &&
          remoteMeeting.hostId
        ) {
          // 2. Otherwise, adopt earlier meeting creation timestamp & initial hostId
          localMeeting.createdAt = remoteMeeting.createdAt;
          if (localMeeting.hostId !== remoteMeeting.hostId) {
            localMeeting.hostId = remoteMeeting.hostId;
            localMeeting.participants.forEach((p) => {
              p.isHost = p.id === localMeeting.hostId;
            });
            ioServer?.to(meetingId).emit('signaling', {
              type: 'host-changed',
              payload: { newHostId: localMeeting.hostId },
              from: 'server',
              meetingId,
              timestamp: Date.now(),
            });
          }
        }

        // Merge any participants from remoteMeeting that are missing locally
        for (const rp of remoteMeeting.participants || []) {
          const exists = localMeeting.participants.some((p) => p.id === rp.id);
          if (!exists) {
            localMeeting.participants.push({
              ...rp,
              isHost: rp.id === localMeeting.hostId,
            });
            ioServer?.to(meetingId).emit('signaling', {
              type: 'user-joined',
              payload: { user: { ...rp, isHost: rp.id === localMeeting.hostId } },
              from: rp.id,
              meetingId,
              timestamp: Date.now(),
            } as SignalingMessage);
          }
        }
        break;
      }

      case 'bridge-signaling': {
        const msg = pkt.data.message as SignalingMessage;
        if (!msg) return;
        const localMeeting = meetings.get(meetingId);

        if (msg.type === 'user-updated') {
          const up = msg.payload as UserUpdatedPayload;
          if (localMeeting) {
            updateUserInMeeting(meetingId, up.userId, up.updates);
          }
        } else if (msg.type === 'screen-share-start') {
          const { userId } = msg.payload as { userId: string };
          updateUserInMeeting(meetingId, userId, { screenSharing: true });
        } else if (msg.type === 'screen-share-stop') {
          const { userId } = msg.payload as { userId: string };
          updateUserInMeeting(meetingId, userId, { screenSharing: false });
        } else if (msg.type === 'host-changed') {
          const { newHostId } = msg.payload as { newHostId: string };
          if (localMeeting && newHostId) {
            localMeeting.hostId = newHostId;
            localMeeting.hostUpdatedAt = msg.timestamp || Date.now();
            localMeeting.participants.forEach((p) => {
              p.isHost = p.id === newHostId;
            });
          }
        } else if (msg.type === 'kick-user') {
          const { userId } = msg.payload as { userId: string };
          if (ioServer?.sockets.sockets.has(userId)) {
            ioServer.to(userId).emit('signaling', {
              type: 'error',
              payload: { code: 'KICKED', message: '호스트에 의해 퇴장되었습니다.' },
              from: 'server',
              meetingId,
              timestamp: Date.now(),
            });
            ioServer.sockets.sockets.get(userId)?.disconnect(true);
          }
          return;
        }

        if (msg.to) {
          if (ioServer?.sockets.sockets.has(msg.to)) {
            ioServer.to(msg.to).emit('signaling', msg);
          }
        } else {
          ioServer?.to(meetingId).emit('signaling', msg);
        }
        break;
      }

      case 'bridge-user-left': {
        const { userId, newHostId } = pkt.data as { userId: string; newHostId?: string };
        const localMeeting = meetings.get(meetingId);
        if (!localMeeting) return;
        const removed = removeUserFromMeeting(meetingId, userId);
        if (removed) {
          ioServer?.to(meetingId).emit('signaling', {
            type: 'user-left',
            payload: { userId },
            from: 'server',
            meetingId,
            timestamp: Date.now(),
          });
          if (newHostId) {
            localMeeting.hostId = newHostId;
            localMeeting.participants.forEach((p) => {
              p.isHost = p.id === newHostId;
            });
            ioServer?.to(meetingId).emit('signaling', {
              type: 'host-changed',
              payload: { newHostId },
              from: 'server',
              meetingId,
              timestamp: Date.now(),
            });
          }
        }
        break;
      }

      case 'bridge-pdf-chunk': {
        const { pdfId, chunkIndex, totalChunks, chunkBase64 } = pkt.data as {
          pdfId: string;
          chunkIndex: number;
          totalChunks: number;
          chunkBase64: string;
        };
        if (!pdfId || typeof chunkIndex !== 'number' || !totalChunks) break;
        let entry = incomingPdfChunks.get(pdfId);
        if (!entry) {
          entry = { chunks: new Array(totalChunks).fill(''), received: 0, total: totalChunks };
          incomingPdfChunks.set(pdfId, entry);
        }
        if (!entry.chunks[chunkIndex]) {
          entry.chunks[chunkIndex] = chunkBase64;
          entry.received += 1;
          if (entry.received === entry.total) {
            sharedPdfBuffer = Buffer.from(entry.chunks.join(''), 'base64');
            sharedPdfId = pdfId;
            incomingPdfChunks.delete(pdfId);
          }
        }
        break;
      }

      case 'bridge-pdf-pull': {
        const { pdfId: requestedPdfId } = (pkt.data || {}) as { pdfId?: string };
        if (sharedPdfBuffer && (!requestedPdfId || !sharedPdfId || requestedPdfId === sharedPdfId)) {
          const now = Date.now();
          if (now - lastPdfPullBroadcastAt > 1200) {
            lastPdfPullBroadcastAt = now;
            broadcastSharedPdfChunks(sharedPdfBuffer, sharedPdfId || requestedPdfId || uuidv4());
          }
        }
        break;
      }

      case 'bridge-update-query': {
        const { currentBuildTimestamp } = (pkt.data || {}) as {
          currentBuildTimestamp?: number;
        };
        const active = getActiveManifest();
        if (
          typeof currentBuildTimestamp === 'number' &&
          active.buildTimestamp > currentBuildTimestamp
        ) {
          sendBridgePacket('bridge-update-announce', 'GLOBAL', {
            manifest: active,
            httpUrl: `http://${getLocalIpAddress()}:${HTTP_PORT}`,
          });
        }
        break;
      }

      case 'bridge-update-announce': {
        const { manifest: remoteManifest, httpUrl } = (pkt.data || {}) as {
          manifest?: UpdateManifest;
          httpUrl?: string;
        };
        const active = getActiveManifest();
        if (!remoteManifest || remoteManifest.buildTimestamp <= active.buildTimestamp) {
          return;
        }
        if (
          pendingAvailableUpdate &&
          pendingAvailableUpdate.buildTimestamp >= remoteManifest.buildTimestamp &&
          updateStatus === 'ready'
        ) {
          return;
        }

        broadcastUpdateEvent({
          status: 'downloading',
          manifest: remoteManifest,
          progress: 35,
          message: `다른 PC에서 새 버전 (${remoteManifest.buildId}) 감지! 자동 다운로드 중...`,
        });

        // Try fast LAN HTTP pull first, fallback to P2P Bridge Chunk transfer
        if (httpUrl) {
          fetchJsonOverHttp<UpdateBundlePayload>(`${httpUrl}/api/update-bundle`, 2500).then(
            (bundle) => {
              if (bundle && bundle.manifest?.buildTimestamp === remoteManifest.buildTimestamp) {
                installUpdateBundle(bundle);
              } else {
                sendBridgePacket('bridge-update-pull', 'GLOBAL', {
                  targetBuildId: remoteManifest.buildId,
                  targetBuildTimestamp: remoteManifest.buildTimestamp,
                });
              }
            }
          );
        } else {
          sendBridgePacket('bridge-update-pull', 'GLOBAL', {
            targetBuildId: remoteManifest.buildId,
            targetBuildTimestamp: remoteManifest.buildTimestamp,
          });
        }
        break;
      }

      case 'bridge-update-pull': {
        const { targetBuildTimestamp } = (pkt.data || {}) as {
          targetBuildTimestamp?: number;
        };
        const localBundle = getLocalUpdateBundle();
        if (
          localBundle &&
          (!targetBuildTimestamp || localBundle.manifest.buildTimestamp === targetBuildTimestamp)
        ) {
          const fullB64 = localBundle.filesGzipBase64;
          const CHUNK_SIZE = 32 * 1024;
          const totalChunks = Math.max(1, Math.ceil(fullB64.length / CHUNK_SIZE));
          const transferId = `${localBundle.manifest.buildId}-${localBundle.manifest.buildTimestamp}`;
          for (let i = 0; i < totalChunks; i++) {
            const chunkBase64 = fullB64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            sendBridgePacket('bridge-update-chunk', 'GLOBAL', {
              transferId,
              manifest: localBundle.manifest,
              chunkIndex: i,
              totalChunks,
              chunkBase64,
            });
          }
        }
        break;
      }

      case 'bridge-update-chunk': {
        const { transferId, manifest, chunkIndex, totalChunks, chunkBase64 } = (pkt.data || {}) as {
          transferId: string;
          manifest: UpdateManifest;
          chunkIndex: number;
          totalChunks: number;
          chunkBase64: string;
        };
        if (!transferId || !manifest || typeof chunkIndex !== 'number' || !totalChunks) return;
        const active = getActiveManifest();
        if (manifest.buildTimestamp <= active.buildTimestamp) return;

        let entry = incomingUpdateChunks.get(transferId);
        if (!entry) {
          entry = {
            manifest,
            chunks: new Array(totalChunks).fill(''),
            received: 0,
            total: totalChunks,
          };
          incomingUpdateChunks.set(transferId, entry);
        }
        if (!entry.chunks[chunkIndex]) {
          entry.chunks[chunkIndex] = chunkBase64;
          entry.received += 1;
          const pct = Math.min(95, Math.round((entry.received / entry.total) * 100));
          broadcastUpdateEvent({
            status: 'downloading',
            manifest,
            progress: pct,
            message: `새 버전 (${manifest.buildId}) 수신 중... (${entry.received}/${entry.total})`,
          });

          if (entry.received === entry.total) {
            const filesGzipBase64 = entry.chunks.join('');
            incomingUpdateChunks.delete(transferId);
            installUpdateBundle({ manifest, filesGzipBase64 });
          }
        }
        break;
      }

      case 'bridge-presence':
      case 'bridge-presence-ping':
      case 'bridge-messenger-msg':
      case 'bridge-messenger-file-chunk': {
        const now = Date.now();
        recentMessengerPackets.push({ rxAt: now, pkt });
        while (recentMessengerPackets.length > 400 || (recentMessengerPackets[0] && now - recentMessengerPackets[0].rxAt > 60000)) {
          recentMessengerPackets.shift();
        }
        break;
      }
    }
  };

  // Start UDP LAN Broadcast/Multicast Bridge
  try {
    const uSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    uSock.on('error', () => {});
    uSock.on('message', (msg) => {
      handleBridgePacket(msg.toString('utf8'));
    });
    uSock.bind(UDP_BRIDGE_PORT, () => {
      try {
        uSock.setBroadcast(true);
      } catch {}
      try {
        uSock.addMembership('239.255.42.99');
      } catch {}
    });
    udpSocket = uSock;
  } catch {
    // ignore UDP error
  }

  // Start Redundant Cloud MQTT TCP Bridges
  const connectMqttBroker = (host: string) => {
    if (isBridgeStopped) return;
    const sock = new net.Socket();
    let rxBuffer = Buffer.alloc(0);
    let pingTimer: NodeJS.Timeout | null = null;

    sock.connect(1883, host, () => {
      const clientId = `zc-${nodeId.slice(0, 8)}-${Math.random().toString(16).slice(2, 6)}`;
      sock.write(buildMqttConnectPacket(clientId));
      sock.write(buildMqttSubscribePacket(MQTT_TOPIC, 1));
      mqttSockets.push(sock);

      pingTimer = setInterval(() => {
        if (!sock.destroyed && sock.writable) {
          sock.write(Buffer.from([0xc0, 0x00]));
        }
      }, 25000);
    });

    sock.on('data', (chunk: Buffer) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
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
          const payloadBuf = packet.subarray(payloadStart, totalPacketLen);
          handleBridgePacket(payloadBuf.toString('utf8'));
        }
      }
    });

    const cleanupAndReconnect = () => {
      if (pingTimer) clearInterval(pingTimer);
      const idx = mqttSockets.indexOf(sock);
      if (idx !== -1) mqttSockets.splice(idx, 1);
      if (!isBridgeStopped) {
        setTimeout(() => connectMqttBroker(host), 3000);
      }
    };

    sock.on('error', () => {});
    sock.on('close', cleanupAndReconnect);
  };

  connectMqttBroker('broker.emqx.io');
  connectMqttBroker('broker.hivemq.com');

  // Periodic room state sync across PCs every 2.5 seconds
  const syncInterval = setInterval(() => {
    for (const [mId, meeting] of meetings.entries()) {
      if (meeting.participants.length > 0) {
        sendBridgePacket('bridge-room-sync', mId, { meeting });
      }
    }
  }, 2500);

  bridgeCleanup = () => {
    isBridgeStopped = true;
    clearInterval(syncInterval);
    for (const s of mqttSockets) {
      try {
        s.destroy();
      } catch {}
    }
    mqttSockets.length = 0;
    if (udpSocket) {
      try {
        udpSocket.close();
      } catch {}
      udpSocket = null;
    }
  };

  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const urlObj = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);

      if (urlObj.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            meetings: meetings.size,
            manifest: getActiveManifest(),
          })
        );
        return;
      }

      if (urlObj.pathname === '/api/update-manifest' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getActiveManifest()));
        return;
      }

      if (urlObj.pathname === '/api/update-bundle' && req.method === 'GET') {
        const bundle = getLocalUpdateBundle();
        if (!bundle) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No update bundle available' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bundle));
        return;
      }

      if (urlObj.pathname === '/api/messenger-relay' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          try {
            const rawStr = Buffer.concat(chunks).toString('utf8');
            const pkt = JSON.parse(rawStr) as BridgePacket;
            if (pkt && pkt.msgId && !seenMsgIds.has(pkt.msgId)) {
              seenMsgIds.add(pkt.msgId);
              // Forward to LAN UDP broadcast/multicast (WSS already sent to Cloud MQTT, TCP also sends redundantly)
              const mqttPkt = buildMqttPublishPacket(MQTT_TOPIC, rawStr);
              for (const sock of mqttSockets) {
                if (!sock.destroyed && sock.writable) {
                  try { sock.write(mqttPkt); } catch {}
                }
              }
              if (udpSocket && Buffer.byteLength(rawStr, 'utf8') < 50000) {
                const buf = Buffer.from(rawStr, 'utf8');
                for (const addr of getSubnetBroadcastAddresses()) {
                  try { udpSocket.send(buf, 0, buf.length, UDP_BRIDGE_PORT, addr); } catch {}
                }
              }
              // Also add to recentMessengerPackets so multiple windows on same PC receive it
              recentMessengerPackets.push({ rxAt: Date.now(), pkt });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
        return;
      }

      if (urlObj.pathname === '/api/messenger-events' && req.method === 'GET') {
        const since = Number(urlObj.searchParams.get('since') || 0);
        const now = Date.now();
        const packets = recentMessengerPackets
          .filter((item) => item.rxAt > since)
          .map((item) => item.pkt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ packets, now }));
        return;
      }

      if (urlObj.pathname === '/api/publish-update' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const bundle = JSON.parse(body) as UpdateBundlePayload;
            const ok = installUpdateBundle(bundle);
            if (ok) {
              sendBridgePacket('bridge-update-announce', 'GLOBAL', {
                manifest: bundle.manifest,
                httpUrl: `http://${getLocalIpAddress()}:${HTTP_PORT}`,
              });
            }
            res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok, manifest: bundle.manifest }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
        return;
      }

      if ((urlObj.pathname === '/join' || urlObj.pathname === '/') && req.method === 'GET') {
        const meetingId = (urlObj.searchParams.get('meetingId') || urlObj.searchParams.get('room') || '').trim().toUpperCase();
        const hostHeader = req.headers.host || `${getLocalIpAddress()}:${HTTP_PORT}`;
        const hostIp = hostHeader.split(':')[0];
        const defaultServer = `http://${hostIp}:${WS_PORT}`;
        const serverParam = urlObj.searchParams.get('server') || defaultServer;
        const nameParam = urlObj.searchParams.get('name') || '';

        const deepLinkParams = new URLSearchParams();
        if (meetingId) deepLinkParams.set('meetingId', meetingId);
        if (serverParam) deepLinkParams.set('server', serverParam);
        if (nameParam) deepLinkParams.set('name', nameParam);
        const deepLinkUrl = `toobar://join?${deepLinkParams.toString()}`;

        const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Toobar 화상회의 바로 접속 (${meetingId || '초대 링크'})</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top, #1e293b 0%, #0f172a 100%);
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 20px;
      max-width: 460px;
      width: 100%;
      padding: 36px 28px;
      text-align: center;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
    }
    .icon {
      width: 64px;
      height: 64px;
      border-radius: 18px;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 18px;
      box-shadow: 0 10px 24px rgba(37, 99, 235, 0.4);
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 20px; }
    .badge {
      display: inline-block;
      background: #0f172a;
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
      font-family: monospace;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 3px;
      padding: 10px 22px;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 15px 20px;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35);
      transition: transform 0.15s ease;
    }
    .btn:hover { transform: translateY(-1px); }
    .sub { margin-top: 16px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    </div>
    <h1>Toobar 화상회의 자동 연결 중...</h1>
    <p>Toobar 앱을 자동으로 실행하여 회의실에 바로 입장합니다.<br/>브라우저 알림창이 뜨면 <b>"Toobar 열기"</b>를 눌러주세요.</p>
    <div class="badge">${meetingId || '회의실'}</div>
    <a id="launchBtn" class="btn" href="${deepLinkUrl}">🚀 Toobar 앱 열고 바로 입장하기</a>
    <div class="sub">자동으로 열리지 않으면 위 파란색 버튼을 클릭하세요.</div>
  </div>
  <script>
    (function() {
      var target = ${JSON.stringify(deepLinkUrl)};
      setTimeout(function() {
        window.location.href = target;
      }, 150);
    })();
  </script>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (urlObj.pathname === '/shared-pdf' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          sharedPdfBuffer = Buffer.concat(chunks);
          const customId = urlObj.searchParams.get('pdfId');
          sharedPdfId = customId || uuidv4();
          broadcastSharedPdfChunks(sharedPdfBuffer, sharedPdfId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              pdfId: sharedPdfId,
              hostIp: getLocalIpAddress(),
              size: sharedPdfBuffer.length,
            })
          );
        });
        return;
      }

      if (urlObj.pathname === '/shared-pdf-cache' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (buf.length > 0) {
            sharedPdfBuffer = buf;
            const customId = urlObj.searchParams.get('pdfId');
            if (customId) sharedPdfId = customId;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: buf.length > 0, pdfId: sharedPdfId, size: buf.length }));
        });
        return;
      }

      if (urlObj.pathname === '/shared-pdf-rebroadcast' && req.method === 'POST') {
        if (sharedPdfBuffer) {
          broadcastSharedPdfChunks(sharedPdfBuffer, sharedPdfId || uuidv4());
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: Boolean(sharedPdfBuffer) }));
        return;
      }

      if (urlObj.pathname === '/shared-pdf-raw' && req.method === 'GET') {
        if (!sharedPdfBuffer) {
          res.writeHead(404);
          res.end('No shared PDF');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': sharedPdfBuffer.length,
          'Content-Disposition': 'inline; filename="shared.pdf"',
          'Cache-Control': 'no-store',
        });
        res.end(sharedPdfBuffer);
        return;
      }

      if (urlObj.pathname.startsWith('/shared-pdf') && req.method === 'GET') {
        const requestedPdfId = urlObj.searchParams.get('pdfId') || '';
        const hostIp = urlObj.searchParams.get('hostIp') || '';
        const hasMatchingLocalPdf =
          Boolean(sharedPdfBuffer) && (!requestedPdfId || !sharedPdfId || requestedPdfId === sharedPdfId);

        if (hasMatchingLocalPdf && sharedPdfBuffer) {
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': sharedPdfBuffer.length,
            'Content-Disposition': 'inline; filename="shared.pdf"',
            'Cache-Control': 'no-store',
          });
          res.end(sharedPdfBuffer);
          return;
        }

        // Request P2P bridge re-broadcast from presenter PC
        sendBridgePacket('bridge-pdf-pull', currentMeetingId || 'GLOBAL', {
          pdfId: requestedPdfId,
        });

        // Also attempt fast direct LAN HTTP fetch from hostIp if provided
        if (hostIp && hostIp !== '127.0.0.1' && hostIp !== 'localhost' && hostIp !== getLocalIpAddress()) {
          const pullReq = httpGet(
            `http://${hostIp}:${HTTP_PORT}/shared-pdf-raw?pdfId=${encodeURIComponent(requestedPdfId)}`,
            { timeout: 1500 },
            (pullRes) => {
              if (pullRes.statusCode !== 200) {
                pullRes.resume();
                res.writeHead(404);
                res.end('Waiting for PDF sync');
                return;
              }
              const rx: Buffer[] = [];
              pullRes.on('data', (c) => rx.push(Buffer.from(c)));
              pullRes.on('end', () => {
                const buf = Buffer.concat(rx);
                if (buf.length > 0) {
                  sharedPdfBuffer = buf;
                  if (requestedPdfId) sharedPdfId = requestedPdfId;
                  res.writeHead(200, {
                    'Content-Type': 'application/pdf',
                    'Content-Length': buf.length,
                    'Content-Disposition': 'inline; filename="shared.pdf"',
                    'Cache-Control': 'no-store',
                  });
                  res.end(buf);
                } else {
                  res.writeHead(404);
                  res.end('Empty PDF');
                }
              });
            }
          );
          pullReq.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(404);
              res.end('Waiting for PDF chunks');
            }
          });
          pullReq.on('timeout', () => {
            pullReq.destroy();
            if (!res.headersSent) {
              res.writeHead(404);
              res.end('Timeout pulling PDF');
            }
          });
          return;
        }

        res.writeHead(404);
        res.end('Waiting for PDF chunks');
        return;
      }

      if (urlObj.pathname === '/local-media' && req.method === 'GET') {
        const filePath = urlObj.searchParams.get('path') || '';
        if (!filePath || !existsSync(filePath)) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }
        try {
          const stat = statSync(filePath);
          const fileSize = stat.size;
          const ext = filePath.split('.').pop()?.toLowerCase() || '';
          const mimeMap: Record<string, string> = {
            mp4: 'video/mp4',
            webm: 'video/webm',
            mov: 'video/quicktime',
            mkv: 'video/x-matroska',
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            ogg: 'audio/ogg',
            m4a: 'audio/mp4',
            flac: 'audio/flac',
            pdf: 'application/pdf',
          };
          const contentType = mimeMap[ext] || 'application/octet-stream';
          const range = req.headers.range;

          if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize,
              'Content-Type': contentType,
            });
            createReadStream(filePath, { start, end }).pipe(res);
          } else {
            res.writeHead(200, {
              'Content-Length': fileSize,
              'Content-Type': contentType,
              'Accept-Ranges': 'bytes',
            });
            createReadStream(filePath).pipe(res);
          }
        } catch (err) {
          res.writeHead(500);
          res.end(String(err));
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });

    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log('[Signaling] Port 3001 already in use, using existing signaling server');
        resolve();
      } else {
        console.error('[Signaling] HTTP server error:', err);
        resolve();
      }
    });

    srv.listen(HTTP_PORT, () => {
      httpServer = srv;
      console.log(`[Signaling] HTTP server listening on port ${HTTP_PORT}`);

      try {
        const wsHttpServer = createServer();
        wsHttpServer.on('error', (wsErr: NodeJS.ErrnoException) => {
          if (wsErr.code === 'EADDRINUSE') {
            console.log(`[Signaling] Port ${WS_PORT} already in use, using existing signaling server`);
          } else {
            console.error('[Signaling] WS HTTP server error:', wsErr);
          }
        });
        const io = new SocketIOServer(wsHttpServer, {
          cors: { origin: '*', methods: ['GET', 'POST'] },
          maxHttpBufferSize: 50 * 1024 * 1024,
          pingTimeout: 60000,
          pingInterval: 25000,
        });
        wsHttpServer.listen(WS_PORT, () => {
          console.log(`[Signaling] Signaling server listening on port ${WS_PORT}`);
        });
        ioServer = io;

        io.on('connection', (socket) => {
          socket.on('join', async (payload: JoinPayload, callback) => {
            try {
              const rawName = (payload.userName || '').trim() || '참가자';
              const meetingId = (payload.meetingId || '').trim().toUpperCase();
              const { password, audioEnabled, videoEnabled } = payload;

              const user: User = {
                id: socket.id,
                name: rawName,
                audioEnabled,
                videoEnabled,
                screenSharing: false,
                isHost: false,
                joinedAt: Date.now(),
              };

              // If meeting is not yet present on this PC, query other PCs via Cross-PC Bridge (LAN UDP + Cloud MQTT)
              if (!meetings.has(meetingId)) {
                const requestId = uuidv4();
                const remoteResult = await new Promise<{
                  success: boolean;
                  meeting?: Meeting;
                  assignedUserName?: string;
                  error?: ErrorPayload;
                } | null>((resolveJoin) => {
                  const timer = setTimeout(() => {
                    pendingJoinRequests.delete(requestId);
                    resolveJoin(null);
                  }, 750);

                  pendingJoinRequests.set(requestId, (res) => {
                    clearTimeout(timer);
                    resolveJoin(res);
                  });

                  sendBridgePacket('bridge-join-req', meetingId, {
                    requestId,
                    user,
                    password,
                  });
                });

                if (remoteResult) {
                  if (!remoteResult.success) {
                    callback?.({
                      success: false,
                      error: remoteResult.error || {
                        code: 'INVALID_PASSWORD',
                        message: '잘못된 회의 비밀번호입니다.',
                      },
                    });
                    return;
                  }
                  if (remoteResult.meeting) {
                    meetings.set(meetingId, remoteResult.meeting);
                    if (remoteResult.assignedUserName) {
                      user.name = remoteResult.assignedUserName;
                    }
                  }
                }
              }

              const existingMeeting = meetings.get(meetingId);
              if (
                existingMeeting?.settings.password &&
                existingMeeting.settings.password !== password
              ) {
                const error: ErrorPayload = {
                  code: 'INVALID_PASSWORD',
                  message: '잘못된 회의 비밀번호입니다.',
                };
                callback?.({ success: false, error });
                return;
              }

              const meetingResult = getOrCreateMeeting(meetingId, user.id);
              addUserToMeeting(meetingResult, user);
              userSockets.set(socket.id, { socketId: socket.id, meetingId });
              socket.join(meetingId);

              const currentUser = { ...user };
              const meetingState: MeetingStatePayload = {
                meeting: { ...meetingResult, participants: [...meetingResult.participants] },
                currentUser,
              };

              const userJoinedPayload: UserJoinedPayload = { user: currentUser };
              socket.to(meetingId).emit('signaling', {
                type: 'user-joined',
                payload: userJoinedPayload,
                from: user.id,
                meetingId,
                timestamp: Date.now(),
              } as SignalingMessage);

              // Broadcast user join & room state across Cross-PC Bridge
              sendBridgePacket('bridge-user-joined', meetingId, {
                user: currentUser,
                meeting: meetingResult,
              });

              callback?.({ success: true, meetingState });
            } catch (error) {
              console.error('Join error:', error);
              callback?.({
                success: false,
                error: { code: 'JOIN_FAILED', message: '회의 참여에 실패했습니다.' },
              });
            }
          });

          socket.on('signaling', (message: SignalingMessage, callback) => {
            const userSocket = userSockets.get(socket.id);
            if (!userSocket) {
              callback?.({
                success: false,
                error: { code: 'NOT_JOINED', message: '회의에 참여하지 않았습니다.' },
              });
              return;
            }
            const { meetingId } = userSocket;

            switch (message.type) {
              case 'offer': {
                const offerPayload = message.payload as OfferPayload;
                const outMsg: SignalingMessage = {
                  ...message,
                  from: userSocket.socketId,
                  to: offerPayload.to,
                  meetingId,
                };
                socket.to(offerPayload.to).emit('signaling', outMsg);
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'answer': {
                const answerPayload = message.payload as AnswerPayload;
                const outMsg: SignalingMessage = {
                  ...message,
                  from: userSocket.socketId,
                  to: answerPayload.to,
                  meetingId,
                };
                socket.to(answerPayload.to).emit('signaling', outMsg);
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'ice-candidate': {
                const icePayload = message.payload as IceCandidatePayload;
                const outMsg: SignalingMessage = {
                  ...message,
                  from: userSocket.socketId,
                  to: icePayload.to,
                  meetingId,
                };
                socket.to(icePayload.to).emit('signaling', outMsg);
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'user-updated': {
                const updatePayload = message.payload as UserUpdatedPayload;
                const updatedUser = updateUserInMeeting(
                  meetingId,
                  updatePayload.userId,
                  updatePayload.updates
                );
                if (updatedUser) {
                  const outMsg: SignalingMessage = {
                    type: 'user-updated',
                    payload: { userId: updatePayload.userId, updates: updatePayload.updates },
                    from: userSocket.socketId,
                    meetingId,
                    timestamp: Date.now(),
                  };
                  io.to(meetingId).emit('signaling', outMsg);
                  sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                }
                callback?.({ success: true });
                break;
              }
              case 'chat': {
                const chatPayload = message.payload as ChatPayload;
                const sender = getUserInMeeting(meetingId, userSocket.socketId);
                const fromName = sender?.name || '참가자';
                const chatId = chatPayload.id || uuidv4();
                const timestamp = Date.now();
                const isPrivate = Boolean(chatPayload.to && chatPayload.to !== 'everyone');

                const outgoingMessage: SignalingMessage = {
                  type: 'chat' as SignalingMessageType,
                  payload: {
                    id: chatId,
                    message: chatPayload.message,
                    from: userSocket.socketId,
                    fromName,
                    to: isPrivate ? chatPayload.to : undefined,
                    isPrivate,
                    timestamp,
                    attachment: chatPayload.attachment,
                  },
                  from: userSocket.socketId,
                  to: isPrivate ? chatPayload.to : undefined,
                  meetingId,
                  timestamp,
                };

                if (isPrivate && chatPayload.to) {
                  io.to(chatPayload.to).emit('signaling', outgoingMessage);
                  socket.emit('signaling', outgoingMessage);
                } else {
                  io.to(meetingId).emit('signaling', outgoingMessage);
                }
                sendBridgePacket('bridge-signaling', meetingId, { message: outgoingMessage });
                callback?.({ success: true });
                break;
              }
              case 'chat-file-chunk': {
                const chunkPayload = (message.payload || {}) as { to?: string };
                const isPrivate = Boolean(chunkPayload.to && chunkPayload.to !== 'everyone');
                const outMsg: SignalingMessage = {
                  type: 'chat-file-chunk',
                  payload: message.payload,
                  from: userSocket.socketId,
                  to: isPrivate ? chunkPayload.to : undefined,
                  meetingId,
                  timestamp: Date.now(),
                };
                if (isPrivate && chunkPayload.to) {
                  io.to(chunkPayload.to).emit('signaling', outMsg);
                } else {
                  socket.to(meetingId).emit('signaling', outMsg);
                }
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'screen-share-start': {
                updateUserInMeeting(meetingId, userSocket.socketId, { screenSharing: true });
                const outMsg: SignalingMessage = {
                  type: 'screen-share-start',
                  payload: { userId: userSocket.socketId },
                  from: userSocket.socketId,
                  meetingId,
                  timestamp: Date.now(),
                };
                socket.to(meetingId).emit('signaling', outMsg);
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'screen-share-stop': {
                updateUserInMeeting(meetingId, userSocket.socketId, { screenSharing: false });
                const outMsg: SignalingMessage = {
                  type: 'screen-share-stop',
                  payload: { userId: userSocket.socketId },
                  from: userSocket.socketId,
                  meetingId,
                  timestamp: Date.now(),
                };
                socket.to(meetingId).emit('signaling', outMsg);
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'share-state':
              case 'whiteboard-draw':
              case 'whiteboard-clear': {
                const outMsg: SignalingMessage = {
                  ...message,
                  from: userSocket.socketId,
                  meetingId,
                  timestamp: Date.now(),
                };
                socket.to(meetingId).emit('signaling', outMsg);
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'pdf-chunk': {
                const { pdfId, chunkIndex, totalChunks, chunkBase64 } = (message.payload || {}) as {
                  pdfId: string;
                  chunkIndex: number;
                  totalChunks: number;
                  chunkBase64: string;
                };
                if (pdfId && typeof chunkIndex === 'number' && totalChunks > 0 && chunkBase64) {
                  let entry = incomingPdfChunks.get(pdfId);
                  if (!entry) {
                    entry = { chunks: new Array(totalChunks).fill(''), received: 0, total: totalChunks };
                    incomingPdfChunks.set(pdfId, entry);
                  }
                  if (!entry.chunks[chunkIndex]) {
                    entry.chunks[chunkIndex] = chunkBase64;
                    entry.received += 1;
                    if (entry.received === entry.total) {
                      sharedPdfBuffer = Buffer.from(entry.chunks.join(''), 'base64');
                      sharedPdfId = pdfId;
                      incomingPdfChunks.delete(pdfId);
                    }
                  }
                }
                const outMsg: SignalingMessage = {
                  ...message,
                  from: userSocket.socketId,
                  meetingId,
                  timestamp: Date.now(),
                };
                socket.to(meetingId).emit('signaling', outMsg);
                sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                callback?.({ success: true });
                break;
              }
              case 'kick-user': {
                const meeting = meetings.get(meetingId);
                if (meeting) {
                  const targetId = (message.payload as { userId: string }).userId;
                  const targetSocket = Array.from(userSockets.entries()).find(
                    ([, v]) => v.socketId === targetId && v.meetingId === meetingId
                  );
                  if (targetSocket) {
                    io.to(targetSocket[0]).emit('signaling', {
                      type: 'error',
                      payload: { code: 'KICKED', message: '호스트에 의해 퇴장되었습니다.' },
                      from: 'server',
                      meetingId,
                      timestamp: Date.now(),
                    });
                    io.sockets.sockets.get(targetSocket[0])?.disconnect(true);
                  } else {
                    // Target user is on a remote PC
                    sendBridgePacket('bridge-signaling', meetingId, {
                      message: {
                        type: 'kick-user',
                        payload: { userId: targetId },
                        from: userSocket.socketId,
                        meetingId,
                        timestamp: Date.now(),
                      },
                    });
                  }
                }
                callback?.({ success: true });
                break;
              }
              case 'mute-user': {
                const meeting = meetings.get(meetingId);
                if (meeting) {
                  const { userId, muted } = message.payload as { userId: string; muted: boolean };
                  updateUserInMeeting(meetingId, userId, { audioEnabled: !muted });
                  const outMsg: SignalingMessage = {
                    type: 'user-updated',
                    payload: { userId, updates: { audioEnabled: !muted } },
                    from: 'server',
                    meetingId,
                    timestamp: Date.now(),
                  };
                  io.to(meetingId).emit('signaling', outMsg);
                  sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                }
                callback?.({ success: true });
                break;
              }
              case 'transfer-host': {
                const meeting = meetings.get(meetingId);
                const { newHostId } = message.payload as { newHostId: string };
                if (meeting && newHostId) {
                  meeting.hostId = newHostId;
                  meeting.hostUpdatedAt = Date.now();
                  meeting.participants.forEach((p) => {
                    p.isHost = p.id === newHostId;
                  });
                  const outMsg: SignalingMessage = {
                    type: 'host-changed',
                    payload: { newHostId },
                    from: 'server',
                    meetingId,
                    timestamp: meeting.hostUpdatedAt,
                  };
                  io.to(meetingId).emit('signaling', outMsg);
                  sendBridgePacket('bridge-signaling', meetingId, { message: outMsg });
                  sendBridgePacket('bridge-room-sync', meetingId, { meeting });
                }
                callback?.({ success: true });
                break;
              }
              default:
                callback?.({
                  success: false,
                  error: { code: 'UNKNOWN_MESSAGE', message: '알 수 없는 메시지 타입' },
                });
            }
          });

          const handleUserLeave = () => {
            const userSocket = userSockets.get(socket.id);
            if (userSocket) {
              const { meetingId, socketId } = userSocket;
              const meeting = meetings.get(meetingId);
              const wasHost = meeting?.hostId === socketId;
              const removedUser = removeUserFromMeeting(meetingId, socketId);
              socket.leave(meetingId);
              userSockets.delete(socket.id);

              if (removedUser) {
                const userLeftPayload: UserLeftPayload = { userId: socketId };
                socket.to(meetingId).emit('signaling', {
                  type: 'user-left',
                  payload: userLeftPayload,
                  from: 'server',
                  meetingId,
                  timestamp: Date.now(),
                });

                const updatedMeeting = meetings.get(meetingId);
                let newHostId: string | undefined;
                if (wasHost && updatedMeeting && updatedMeeting.participants.length > 0) {
                  const newHost = updatedMeeting.participants[0];
                  newHostId = newHost.id;
                  io.to(meetingId).emit('signaling', {
                    type: 'user-updated',
                    payload: { userId: newHost.id, updates: { isHost: true } },
                    from: 'server',
                    meetingId,
                    timestamp: Date.now(),
                  });
                }

                sendBridgePacket('bridge-user-left', meetingId, {
                  userId: socketId,
                  newHostId,
                });
              }
            }
          };

          socket.on('leave', (_payload, callback) => {
            handleUserLeave();
            callback?.({ success: true });
          });

          socket.on('disconnect', () => {
            handleUserLeave();
          });
        });

        resolve();
      } catch (err) {
        console.error('[Signaling] Socket.IO server startup error:', err);
        resolve();
      }
    });
  });
}

function stopSignalingServer(): void {
  if (bridgeCleanup) {
    bridgeCleanup();
    bridgeCleanup = null;
  }
  if (ioServer) {
    ioServer.close();
    ioServer = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

// IPC Handlers
ipcMain.handle('get-app-version', () => getActiveManifest().version || app.getVersion());

ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('get-network-info', () => ({
  localIp: getLocalIpAddress(),
  defaultUserName: getDefaultUserName(),
}));

ipcMain.handle('get-update-status', () => {
  return getUpdateStatusSnapshot();
});

ipcMain.handle(
  'check-for-updates',
  async (_event, arg?: string | { serverUrl?: string; manual?: boolean }) => {
    const options =
      typeof arg === 'string'
        ? { serverUrl: arg, manual: true }
        : { serverUrl: arg?.serverUrl, manual: arg?.manual ?? true };
    return triggerManualOrAutoUpdateCheck(options);
  }
);

ipcMain.handle('apply-update-now', (_event, mode?: boolean | 'hot-reload' | 'restart') => {
  if (mode === 'restart' || mode === true) {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);
    return { success: true };
  }

  // Default: instant hot-reload of all open BrowserWindows using the updated live-update renderer
  const targetUrl = getEffectiveRendererUrl();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.loadURL(targetUrl);
    }
  }
  pendingAvailableUpdate = null;
  updateStatus = 'up-to-date';
  updateMessage = `최신 빌드 (${getActiveManifest().buildId})가 즉시 적용되었습니다.`;
  return { success: true };
});

ipcMain.handle(
  'set-auto-update-enabled',
  (_event, enabled: boolean, customServerUrl?: string) => {
    autoUpdateEnabled = Boolean(enabled);
    if (typeof customServerUrl === 'string') {
      customUpdateServerUrl = customServerUrl.trim().replace(/\/+$/, '');
    }
    saveUpdateSettings();
    return getUpdateStatusSnapshot();
  }
);

ipcMain.handle('consume-deep-link', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const invite = pendingDeepLinkByWindow.get(win.id) || null;
  pendingDeepLinkByWindow.delete(win.id);
  return invite;
});

ipcMain.handle('set-window-meeting', (event, meetingId: string | null) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    windowMeetingMap.set(win.id, meetingId);
  }
});

ipcMain.handle('open-deep-link', (_event, rawUrl: string) => {
  handleIncomingDeepLink(rawUrl);
  return { success: true };
});

ipcMain.handle('join-meeting', async (event, payload: JoinPayload) => {
  currentMeetingId = payload.meetingId;
  currentUserId = uuidv4();
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    windowMeetingMap.set(win.id, payload.meetingId);
  }

  const user: User = {
    id: currentUserId,
    name: payload.userName,
    audioEnabled: payload.audioEnabled,
    videoEnabled: payload.videoEnabled,
    screenSharing: false,
    isHost: true,
    joinedAt: Date.now(),
  };

  const meeting: Meeting = {
    id: payload.meetingId,
    name: `Meeting ${payload.meetingId.slice(0, 8)}`,
    hostId: currentUserId,
    participants: [user],
    createdAt: Date.now(),
    settings: {
      allowScreenShare: true,
      allowChat: true,
      allowRecording: false,
      muteOnEntry: true,
      videoOnEntry: true,
    },
  };

  return { success: true, meeting, user };
});

ipcMain.handle('leave-meeting', async (event) => {
  currentMeetingId = null;
  currentUserId = null;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    windowMeetingMap.set(win.id, null);
  }
  return { success: true };
});

ipcMain.handle('get-media-devices', async () => {
  return {
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  };
});

ipcMain.handle('get-rtc-config', () => RTC_CONFIGURATION);

ipcMain.handle('get-media-constraints', () => MEDIA_CONSTRAINTS);

ipcMain.handle('show-save-dialog', async (_event, options: Electron.SaveDialogOptions) => {
  const result = await dialog.showSaveDialog(mainWindow!, options);
  return result;
});

ipcMain.handle('show-open-dialog', async (_event, options: Electron.OpenDialogOptions) => {
  const result = await dialog.showOpenDialog(mainWindow!, options);
  return result;
});

// App lifecycle
app.whenReady().then(async () => {
  try {
    if (process.platform === 'darwin' && app.dock) {
      const dockIconPath = resolvePublicAssetPath('icon.png');
      if (existsSync(dockIconPath)) {
        const dockImg = nativeImage.createFromPath(dockIconPath);
        if (!dockImg.isEmpty()) {
          app.dock.setIcon(dockImg);
        }
      }
    }

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          if (sources.length > 0) {
            if (request.audioRequested) {
              callback({ video: sources[0], audio: 'loopback' });
            } else {
              callback({ video: sources[0] });
            }
          } else {
            callback({});
          }
        })
        .catch((err) => {
          console.error('Desktop capturer error:', err);
          callback({});
        });
    });

    await startSignalingServer();
    const initialInvite = startupDeepLink || undefined;
    startupDeepLink = null;
    createMainWindow(initialInvite);
    createTray();

    // Auto-check for OTA updates on startup and periodically when autoUpdateEnabled is true
    setTimeout(() => {
      if (autoUpdateEnabled) {
        triggerManualOrAutoUpdateCheck({ manual: false }).catch(() => {});
      }
    }, 2500);

    setInterval(() => {
      if (autoUpdateEnabled) {
        const active = getActiveManifest();
        if (globalSendBridgePacket) {
          globalSendBridgePacket('bridge-update-query', 'GLOBAL', {
            currentBuildTimestamp: active.buildTimestamp,
            currentBuildId: active.buildId,
          });
        }
      }
    }, 30000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  } catch (error) {
    console.error('Failed to start app:', error);
    dialog.showErrorBox('시작 오류', `애플리케이션을 시작할 수 없습니다: ${error}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  try {
    tray?.destroy();
    tray = null;
  } catch {
    // ignore
  }
  stopSignalingServer();
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isCustomDeepLink(url)) {
      handleIncomingDeepLink(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

if (isDev) {
  app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(true);
  });
}
