// AI Virtual Background & Background Blur Engine (MediaPipe ImageSegmenter + Canvas2D)
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import {
  DEFAULT_VIRTUAL_BACKGROUND_CONFIG,
  type CustomBackgroundItem,
  type VirtualBackgroundConfig,
} from '@shared/types';
import { isElectron } from './electron-bridge';
import { useAppStore } from './store';
import { webrtcManager } from './webrtc';

export type VirtualBackgroundEngineStatus =
  | 'idle'
  | 'loading'
  | 'ai-gpu'
  | 'ai-cpu'
  | 'fallback';

export interface VirtualBackgroundPreset {
  id: string;
  name: string;
  badge: string;
  thumbnailDataUrl: string;
}

const CUSTOM_BG_STORAGE_KEY = 'toobar_custom_backgrounds';
const MAX_CUSTOM_BACKGROUNDS = 6;

interface PresetDef {
  id: string;
  name: string;
  badge: string;
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

const PRESET_DEFS: PresetDef[] = [
  {
    id: 'office',
    name: '모던 오피스',
    badge: '🏢',
    paint: (ctx, w, h) => {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#1e293b');
      bg.addColorStop(0.55, '#334155');
      bg.addColorStop(1, '#0f172a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Daylight glass window panes on left
      ctx.save();
      const winGlow = ctx.createRadialGradient(w * 0.18, h * 0.28, 20, w * 0.25, h * 0.35, w * 0.65);
      winGlow.addColorStop(0, 'rgba(186, 230, 253, 0.32)');
      winGlow.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = winGlow;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(224, 242, 254, 0.08)';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(w * (0.06 + i * 0.11), h * 0.08, w * 0.085, h * 0.56);
      }

      // Warm oak desk / divider band
      const wood = ctx.createLinearGradient(0, h * 0.68, w, h);
      wood.addColorStop(0, 'rgba(120, 74, 42, 0.55)');
      wood.addColorStop(1, 'rgba(41, 27, 18, 0.9)');
      ctx.fillStyle = wood;
      ctx.fillRect(0, h * 0.72, w, h * 0.28);

      // Soft warm ceiling bokeh
      for (const [bx, by, br, alpha] of [
        [0.68, 0.18, 70, 0.14],
        [0.82, 0.26, 95, 0.1],
        [0.54, 0.12, 55, 0.09],
      ]) {
        const g = ctx.createRadialGradient(w * bx, h * by, 0, w * bx, h * by, br * (w / 640));
        g.addColorStop(0, `rgba(253, 230, 138, ${alpha})`);
        g.addColorStop(1, 'rgba(253, 230, 138, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(w * bx, h * by, br * (w / 640), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  },
  {
    id: 'study',
    name: '아늑한 서재',
    badge: '📚',
    paint: (ctx, w, h) => {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#1c1917');
      bg.addColorStop(0.6, '#292524');
      bg.addColorStop(1, '#0c0a09');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Warm amber reading lamp glow
      const lamp = ctx.createRadialGradient(w * 0.78, h * 0.3, 12, w * 0.76, h * 0.35, w * 0.55);
      lamp.addColorStop(0, 'rgba(251, 191, 36, 0.42)');
      lamp.addColorStop(0.45, 'rgba(217, 119, 6, 0.16)');
      lamp.addColorStop(1, 'rgba(12, 10, 9, 0)');
      ctx.fillStyle = lamp;
      ctx.fillRect(0, 0, w, h);

      // Soft bookshelf silhouettes on left
      ctx.fillStyle = 'rgba(28, 25, 23, 0.78)';
      ctx.fillRect(w * 0.04, h * 0.08, w * 0.34, h * 0.84);
      const spineColors = [
        'rgba(180, 83, 9, 0.35)',
        'rgba(55, 65, 81, 0.45)',
        'rgba(127, 29, 29, 0.35)',
        'rgba(20, 83, 45, 0.35)',
        'rgba(120, 53, 15, 0.35)',
      ];
      for (let row = 0; row < 4; row++) {
        const sy = h * (0.14 + row * 0.19);
        ctx.fillStyle = 'rgba(68, 64, 60, 0.7)';
        ctx.fillRect(w * 0.055, sy + h * 0.13, w * 0.31, h * 0.018);
        let bx = w * 0.065;
        let idx = row;
        while (bx < w * 0.34) {
          const bw = w * (0.018 + ((idx * 7) % 3) * 0.007);
          const bh = h * (0.1 + ((idx * 5) % 3) * 0.012);
          ctx.fillStyle = spineColors[idx % spineColors.length];
          ctx.fillRect(bx, sy + (h * 0.13 - bh), bw, bh);
          bx += bw + w * 0.005;
          idx++;
        }
      }
    },
  },
  {
    id: 'sunset',
    name: '노을 바다',
    badge: '🌅',
    paint: (ctx, w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.64);
      sky.addColorStop(0, '#1e1b4b');
      sky.addColorStop(0.42, '#7c2d12');
      sky.addColorStop(0.78, '#ea580c');
      sky.addColorStop(1, '#fdba74');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h * 0.64);

      const sun = ctx.createRadialGradient(w * 0.64, h * 0.56, 10, w * 0.64, h * 0.56, w * 0.32);
      sun.addColorStop(0, 'rgba(254, 249, 195, 0.92)');
      sun.addColorStop(0.25, 'rgba(251, 146, 60, 0.55)');
      sun.addColorStop(1, 'rgba(251, 146, 60, 0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);

      const sea = ctx.createLinearGradient(0, h * 0.63, 0, h);
      sea.addColorStop(0, '#312e81');
      sea.addColorStop(1, '#090d16');
      ctx.fillStyle = sea;
      ctx.fillRect(0, h * 0.63, w, h * 0.37);

      // Gentle sun reflections on sea
      ctx.fillStyle = 'rgba(254, 215, 170, 0.22)';
      for (let i = 0; i < 9; i++) {
        const y = h * (0.66 + i * 0.036);
        const rw = w * (0.24 - i * 0.018);
        ctx.fillRect(w * 0.64 - rw / 2, y, rw, Math.max(2, h * 0.009));
      }
    },
  },
  {
    id: 'forest',
    name: '숲속 창가',
    badge: '🌲',
    paint: (ctx, w, h) => {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#052e16');
      bg.addColorStop(0.5, '#064e3b');
      bg.addColorStop(1, '#022c22');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Sunbeams through trees
      const ray = ctx.createLinearGradient(w * 0.15, 0, w * 0.75, h);
      ray.addColorStop(0, 'rgba(167, 243, 208, 0.25)');
      ray.addColorStop(1, 'rgba(167, 243, 208, 0)');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, 0);
      ctx.lineTo(w * 0.45, 0);
      ctx.lineTo(w * 0.85, h);
      ctx.lineTo(w * 0.35, h);
      ctx.closePath();
      ctx.fill();

      // Soft botanical bokeh circles
      for (const [bx, by, br, col] of [
        [0.14, 0.22, 110, 'rgba(52, 211, 153, 0.14)'],
        [0.84, 0.3, 130, 'rgba(110, 231, 183, 0.12)'],
        [0.24, 0.72, 150, 'rgba(16, 185, 129, 0.1)'],
        [0.72, 0.76, 120, 'rgba(5, 150, 105, 0.18)'],
      ] as const) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(w * bx, h * by, br * (w / 1280), 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'studio',
    name: '다크 스튜디오',
    badge: '🌌',
    paint: (ctx, w, h) => {
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.35, 30, w * 0.5, h * 0.5, w * 0.78);
      bg.addColorStop(0, '#1e3a8a');
      bg.addColorStop(0.45, '#1e1b4b');
      bg.addColorStop(1, '#050814');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle violet & cyan studio accent lights
      const cyan = ctx.createRadialGradient(w * 0.16, h * 0.82, 10, w * 0.16, h * 0.82, w * 0.45);
      cyan.addColorStop(0, 'rgba(56, 189, 248, 0.26)');
      cyan.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = cyan;
      ctx.fillRect(0, 0, w, h);

      const violet = ctx.createRadialGradient(w * 0.86, h * 0.2, 10, w * 0.86, h * 0.2, w * 0.45);
      violet.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
      violet.addColorStop(1, 'rgba(168, 85, 247, 0)');
      ctx.fillStyle = violet;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'minimal',
    name: '미니멀 브라이트',
    badge: '☁️',
    paint: (ctx, w, h) => {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#e2e8f0');
      bg.addColorStop(0.55, '#cbd5e1');
      bg.addColorStop(1, '#94a3b8');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const light = ctx.createRadialGradient(w * 0.22, h * 0.22, 20, w * 0.3, h * 0.3, w * 0.75);
      light.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
      light.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, w, h);

      // Clean architectural panel accents
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(w * 0.68, 0, w * 0.015, h);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.06)';
      ctx.fillRect(0, h * 0.78, w, h * 0.22);
    },
  },
];

const presetCanvasCache = new Map<string, HTMLCanvasElement>();
const presetThumbCache = new Map<string, string>();

function renderPresetCanvas(presetId: string): HTMLCanvasElement {
  const existing = presetCanvasCache.get(presetId);
  if (existing) return existing;

  const def = PRESET_DEFS.find((d) => d.id === presetId) || PRESET_DEFS[0];
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    def.paint(ctx, canvas.width, canvas.height);
  }
  presetCanvasCache.set(def.id, canvas);
  return canvas;
}

export function getPresetThumbnailDataUrl(presetId: string): string {
  const cached = presetThumbCache.get(presetId);
  if (cached) return cached;
  if (typeof document === 'undefined') return '';

  const def = PRESET_DEFS.find((d) => d.id === presetId) || PRESET_DEFS[0];
  const thumb = document.createElement('canvas');
  thumb.width = 240;
  thumb.height = 135;
  const ctx = thumb.getContext('2d');
  if (ctx) {
    def.paint(ctx, thumb.width, thumb.height);
  }
  const url = thumb.toDataURL('image/jpeg', 0.85);
  presetThumbCache.set(def.id, url);
  return url;
}

export const VIRTUAL_BACKGROUND_PRESETS: VirtualBackgroundPreset[] = PRESET_DEFS.map((d) => ({
  id: d.id,
  name: d.name,
  badge: d.badge,
  get thumbnailDataUrl() {
    return getPresetThumbnailDataUrl(d.id);
  },
}));

export function loadCustomBackgrounds(): CustomBackgroundItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_BG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CustomBackgroundItem =>
        Boolean(item && typeof item.id === 'string' && typeof item.dataUrl === 'string')
    );
  } catch {
    return [];
  }
}

function saveCustomBackgrounds(items: CustomBackgroundItem[]): void {
  const list = items.slice(0, MAX_CUSTOM_BACKGROUNDS);
  while (list.length > 0) {
    try {
      localStorage.setItem(CUSTOM_BG_STORAGE_KEY, JSON.stringify(list));
      return;
    } catch {
      // Evict oldest entry if localStorage quota is tight
      list.pop();
    }
  }
  try {
    localStorage.removeItem(CUSTOM_BG_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function addCustomBackgroundFromFile(file: File): Promise<CustomBackgroundItem> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('이미지 읽기 실패'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('지원하지 않는 이미지 형식입니다.'));
    el.src = rawDataUrl;
  });

  const maxW = 1280;
  const maxH = 720;
  const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = Math.max(16, Math.round(img.naturalWidth * scale));
  const h = Math.max(16, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, w, h);
  }
  const optimizedUrl = canvas.toDataURL('image/jpeg', 0.84);

  const item: CustomBackgroundItem = {
    id: `cbg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: file.name.replace(/\.[^.]+$/, '') || '내 배경 사진',
    dataUrl: optimizedUrl,
  };

  const existing = loadCustomBackgrounds();
  saveCustomBackgrounds([item, ...existing]);
  return item;
}

export function removeCustomBackground(id: string): CustomBackgroundItem[] {
  const next = loadCustomBackgrounds().filter((item) => item.id !== id);
  saveCustomBackgrounds(next);
  return next;
}

function getMediapipeCandidateBases(): string[] {
  if (isElectron()) {
    return [
      'http://127.0.0.1:3001/mediapipe',
      'https://karan211-bruno.github.io/toobar/mediapipe',
    ];
  }
  if (
    typeof window !== 'undefined' &&
    window.location.protocol.startsWith('http') &&
    window.location.hostname !== 'app.toobar.local'
  ) {
    return ['./mediapipe', 'https://karan211-bruno.github.io/toobar/mediapipe'];
  }
  return ['https://karan211-bruno.github.io/toobar/mediapipe'];
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
  targetW: number,
  targetH: number
): void {
  const srcW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
      ? source.naturalWidth
      : source.width;
  const srcH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
      ? source.naturalHeight
      : source.height;
  if (!srcW || !srcH) return;

  const srcRatio = srcW / srcH;
  const dstRatio = targetW / targetH;
  let drawW = targetW;
  let drawH = targetH;
  let offsetX = 0;
  let offsetY = 0;

  if (srcRatio > dstRatio) {
    drawH = targetH;
    drawW = targetH * srcRatio;
    offsetX = (targetW - drawW) / 2;
  } else {
    drawW = targetW;
    drawH = targetW / srcRatio;
    offsetY = (targetH - drawH) / 2;
  }

  ctx.drawImage(source, offsetX, offsetY, drawW, drawH);
}

class VirtualBackgroundEngine {
  private config: VirtualBackgroundConfig = DEFAULT_VIRTUAL_BACKGROUND_CONFIG;
  private status: VirtualBackgroundEngineStatus = 'idle';
  private statusListeners = new Set<(status: VirtualBackgroundEngineStatus) => void>();

  private rawStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private processedVideoTrack: MediaStreamTrack | null = null;

  private sourceVideo: HTMLVideoElement | null = null;
  private outputCanvas: HTMLCanvasElement | null = null;
  private outputCtx: CanvasRenderingContext2D | null = null;
  private fgCanvas: HTMLCanvasElement | null = null;
  private fgCtx: CanvasRenderingContext2D | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private blurScratchCanvas: HTMLCanvasElement | null = null;
  private blurScratchCtx: CanvasRenderingContext2D | null = null;

  private maskImageData: ImageData | null = null;
  private emaMask: Float32Array | null = null;
  private emaW = 0;
  private emaH = 0;

  private segmenter: ImageSegmenter | null = null;
  private segmenterInitPromise: Promise<void> | null = null;
  private personMaskIndex: number | null = null;
  private invertSingleMask = false;

  private customImageCache = new Map<string, HTMLImageElement>();
  private supportsCanvasFilter: boolean | null = null;

  private running = false;
  private paused = false;
  private rafId: number | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderTs = 0;
  private lastVideoTime = -1;
  private lastInferTs = 0;

  public getStatus(): VirtualBackgroundEngineStatus {
    return this.status;
  }

  public onStatusChange(listener: (status: VirtualBackgroundEngineStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(next: VirtualBackgroundEngineStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of this.statusListeners) {
      try {
        listener(next);
      } catch {
        // ignore listener error
      }
    }
  }

  private checkCanvasFilterSupport(): boolean {
    if (this.supportsCanvasFilter !== null) return this.supportsCanvasFilter;
    try {
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 16;
      testCanvas.height = 16;
      const ctx = testCanvas.getContext('2d');
      if (!ctx || typeof ctx.filter !== 'string') {
        this.supportsCanvasFilter = false;
        return false;
      }
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 16, 16);
      ctx.filter = 'blur(4px)';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, 4, 8, 8);
      const pixel = ctx.getImageData(2, 8, 1, 1).data;
      this.supportsCanvasFilter = pixel[0] > 5;
    } catch {
      this.supportsCanvasFilter = false;
    }
    return this.supportsCanvasFilter;
  }

  private ensureCanvases(): boolean {
    if (typeof document === 'undefined') return false;
    if (!this.outputCanvas) {
      this.outputCanvas = document.createElement('canvas');
      this.outputCanvas.width = 640;
      this.outputCanvas.height = 360;
      this.outputCtx = this.outputCanvas.getContext('2d');
    }
    if (!this.fgCanvas) {
      this.fgCanvas = document.createElement('canvas');
      this.fgCanvas.width = 640;
      this.fgCanvas.height = 360;
      this.fgCtx = this.fgCanvas.getContext('2d');
    }
    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskCanvas.width = 256;
      this.maskCanvas.height = 144;
      this.maskCtx = this.maskCanvas.getContext('2d');
    }
    if (!this.blurScratchCanvas) {
      this.blurScratchCanvas = document.createElement('canvas');
      this.blurScratchCanvas.width = 96;
      this.blurScratchCanvas.height = 54;
      this.blurScratchCtx = this.blurScratchCanvas.getContext('2d');
    }
    if (!this.sourceVideo) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      this.sourceVideo = v;
    }
    return Boolean(this.outputCtx && this.fgCtx && this.maskCtx && this.blurScratchCtx);
  }

  private async ensureSegmenter(): Promise<void> {
    if (this.segmenter) return;
    if (this.segmenterInitPromise) return this.segmenterInitPromise;

    this.segmenterInitPromise = (async () => {
      this.setStatus('loading');
      const bases = getMediapipeCandidateBases();

      for (const baseUrl of bases) {
        try {
          const vision = await FilesetResolver.forVisionTasks(baseUrl);
          const modelAssetPath = `${baseUrl}/selfie_segmenter_landscape.tflite`;

          for (const delegate of ['GPU', 'CPU'] as const) {
            try {
              const seg = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: {
                  modelAssetPath,
                  delegate,
                },
                runningMode: 'VIDEO',
                outputCategoryMask: false,
                outputConfidenceMasks: true,
              });
              this.segmenter = seg;
              this.inspectModelLabels(seg);
              this.setStatus(delegate === 'GPU' ? 'ai-gpu' : 'ai-cpu');
              return;
            } catch (delegateErr) {
              console.warn(`[VirtualBg] ImageSegmenter init (${delegate}) failed at ${baseUrl}:`, delegateErr);
            }
          }
        } catch (baseErr) {
          console.warn(`[VirtualBg] FilesetResolver failed at ${baseUrl}:`, baseErr);
        }
      }

      this.setStatus('fallback');
    })().finally(() => {
      this.segmenterInitPromise = null;
    });

    return this.segmenterInitPromise;
  }

  private inspectModelLabels(seg: ImageSegmenter): void {
    try {
      const rawLabels = seg.getLabels?.() || [];
      const labels = rawLabels.map((l) => String(l || '').toLowerCase());
      const personIdx = labels.findIndex((l) =>
        /person|selfie|foreground|human/.test(l)
      );
      if (labels.length >= 2) {
        this.personMaskIndex = personIdx >= 0 ? personIdx : 1;
        this.invertSingleMask = false;
      } else if (labels.length === 1) {
        this.personMaskIndex = 0;
        this.invertSingleMask = /background/.test(labels[0]);
      } else {
        this.personMaskIndex = null;
        this.invertSingleMask = false;
      }
    } catch {
      this.personMaskIndex = null;
      this.invertSingleMask = false;
    }
  }

  private getCustomImageElement(dataUrl?: string | null): HTMLImageElement | null {
    if (!dataUrl || typeof Image === 'undefined') return null;
    let img = this.customImageCache.get(dataUrl);
    if (!img) {
      img = new Image();
      img.src = dataUrl;
      if (this.customImageCache.size > 10) {
        const firstKey = this.customImageCache.keys().next().value;
        if (firstKey) this.customImageCache.delete(firstKey);
      }
      this.customImageCache.set(dataUrl, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  private buildFallbackSilhouetteMask(width: number, height: number): Float32Array {
    const total = width * height;
    const out = new Float32Array(total);
    const cx = width * 0.5;
    const headY = height * 0.34;
    const bodyY = height * 0.88;
    const headRx = width * 0.16;
    const headRy = height * 0.24;
    const bodyRx = width * 0.32;
    const bodyRy = height * 0.44;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dxH = (x - cx) / headRx;
        const dyH = (y - headY) / headRy;
        const distH = Math.sqrt(dxH * dxH + dyH * dyH);

        const dxB = (x - cx) / bodyRx;
        const dyB = (y - bodyY) / bodyRy;
        const distB = Math.sqrt(dxB * dxB + dyB * dyB);

        const d = Math.min(distH, distB);
        // Smooth edge feathering between d=0.82 and d=1.18
        let val = (1.18 - d) / (1.18 - 0.82);
        if (val < 0) val = 0;
        if (val > 1) val = 1;
        out[y * width + x] = val * val * (3 - 2 * val);
      }
    }
    return out;
  }

  private writeAlphaMaskToCanvas(
    values: Float32Array,
    maskW: number,
    maskH: number,
    invert: boolean
  ): void {
    if (!this.maskCanvas || !this.maskCtx) return;

    if (this.maskCanvas.width !== maskW || this.maskCanvas.height !== maskH) {
      this.maskCanvas.width = maskW;
      this.maskCanvas.height = maskH;
      this.maskImageData = this.maskCtx.createImageData(maskW, maskH);
    }
    if (!this.maskImageData || this.maskImageData.width !== maskW || this.maskImageData.height !== maskH) {
      this.maskImageData = this.maskCtx.createImageData(maskW, maskH);
    }

    const total = maskW * maskH;
    if (!this.emaMask || this.emaW !== maskW || this.emaH !== maskH || this.emaMask.length !== total) {
      this.emaMask = new Float32Array(total);
      this.emaW = maskW;
      this.emaH = maskH;
      for (let i = 0; i < total; i++) {
        const raw = invert ? 1 - values[i] : values[i];
        this.emaMask[i] = raw;
      }
    } else {
      for (let i = 0; i < total; i++) {
        const raw = invert ? 1 - values[i] : values[i];
        this.emaMask[i] = this.emaMask[i] * 0.35 + raw * 0.65;
      }
    }

    const rgba = this.maskImageData.data;
    const low = 0.32;
    const high = 0.72;
    const invRange = 1 / (high - low);

    for (let i = 0; i < total; i++) {
      const p = this.emaMask[i];
      let alpha01 = (p - low) * invRange;
      if (alpha01 <= 0) alpha01 = 0;
      else if (alpha01 >= 1) alpha01 = 1;
      else alpha01 = alpha01 * alpha01 * (3 - 2 * alpha01);

      const idx = i * 4;
      rgba[idx] = 255;
      rgba[idx + 1] = 255;
      rgba[idx + 2] = 255;
      rgba[idx + 3] = Math.round(alpha01 * 255);
    }

    this.maskCtx.putImageData(this.maskImageData, 0, 0);
  }

  private renderBackgroundLayer(
    outCtx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    w: number,
    h: number
  ): void {
    const cfg = this.config;

    if (cfg.mode === 'blur') {
      const blurPx = Math.max(4, Math.min(36, cfg.blurAmount || 14));
      if (this.checkCanvasFilterSupport()) {
        const pad = Math.ceil(blurPx * 1.4);
        outCtx.save();
        outCtx.filter = `blur(${blurPx}px)`;
        outCtx.drawImage(video, -pad, -pad, w + pad * 2, h + pad * 2);
        outCtx.filter = 'none';
        outCtx.restore();
      } else if (this.blurScratchCanvas && this.blurScratchCtx) {
        const factor = Math.max(4, Math.min(20, Math.round(blurPx * 0.75)));
        const sw = Math.max(16, Math.round(w / factor));
        const sh = Math.max(12, Math.round(h / factor));
        if (this.blurScratchCanvas.width !== sw || this.blurScratchCanvas.height !== sh) {
          this.blurScratchCanvas.width = sw;
          this.blurScratchCanvas.height = sh;
        }
        this.blurScratchCtx.imageSmoothingEnabled = true;
        this.blurScratchCtx.imageSmoothingQuality = 'high';
        this.blurScratchCtx.drawImage(video, 0, 0, sw, sh);

        outCtx.save();
        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = 'high';
        outCtx.drawImage(this.blurScratchCanvas, 0, 0, w, h);
        outCtx.restore();
      }
      return;
    }

    if (cfg.mode === 'image') {
      const customImg = this.getCustomImageElement(cfg.customImageDataUrl);
      if (customImg) {
        drawCover(outCtx, customImg, w, h);
        return;
      }
    }

    // Preset background (also graceful fallback while custom image decodes)
    const presetCanvas = renderPresetCanvas(cfg.presetId || 'office');
    drawCover(outCtx, presetCanvas, w, h);
  }

  private processFrame(): void {
    if (!this.running || this.paused) return;
    const video = this.sourceVideo;
    const outCanvas = this.outputCanvas;
    const outCtx = this.outputCtx;
    const fgCanvas = this.fgCanvas;
    const fgCtx = this.fgCtx;
    const maskCanvas = this.maskCanvas;

    if (!video || !outCanvas || !outCtx || !fgCanvas || !fgCtx || !maskCanvas) return;
    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;

    const targetW = Math.min(640, video.videoWidth);
    const targetH = Math.max(180, Math.round((targetW * video.videoHeight) / video.videoWidth));
    if (outCanvas.width !== targetW || outCanvas.height !== targetH) {
      outCanvas.width = targetW;
      outCanvas.height = targetH;
      fgCanvas.width = targetW;
      fgCanvas.height = targetH;
    }

    // 1. Run segmentation when frame changes
    const curTime = video.currentTime;
    const hasNewFrame = curTime !== this.lastVideoTime;
    if (hasNewFrame) {
      this.lastVideoTime = curTime;
    }

    let maskReady = Boolean(this.emaMask);
    if (this.segmenter && (hasNewFrame || !maskReady)) {
      const nowPerf = Math.max(this.lastInferTs + 1, Math.round(performance.now()));
      this.lastInferTs = nowPerf;
      try {
        this.segmenter.segmentForVideo(video, nowPerf, (result) => {
          const masks = result.confidenceMasks;
          if (!masks || masks.length === 0) return;

          let targetIdx = 0;
          let shouldInvert = false;
          if (masks.length >= 2) {
            targetIdx =
              this.personMaskIndex !== null && this.personMaskIndex < masks.length
                ? this.personMaskIndex
                : 1;
            shouldInvert = false;
          } else {
            targetIdx = 0;
            shouldInvert = this.invertSingleMask;
          }

          const mask = masks[targetIdx];
          if (!mask) return;
          const floats = mask.getAsFloat32Array();
          if (floats && floats.length > 0 && mask.width > 0 && mask.height > 0) {
            this.writeAlphaMaskToCanvas(floats, mask.width, mask.height, shouldInvert);
            maskReady = true;
          }
        });
      } catch (err) {
        console.warn('[VirtualBg] segmentForVideo frame skipped:', err);
      }
    }

    if (!maskReady) {
      // Initial non-blocking center portrait fallback while MediaPipe WASM warms up
      const fbW = 160;
      const fbH = 90;
      const fb = this.buildFallbackSilhouetteMask(fbW, fbH);
      this.writeAlphaMaskToCanvas(fb, fbW, fbH, false);
    }

    // 2. Render background onto outCanvas
    this.renderBackgroundLayer(outCtx, video, targetW, targetH);

    // 3. Extract sharp foreground person via feathered mask onto fgCanvas
    fgCtx.save();
    fgCtx.globalCompositeOperation = 'source-over';
    fgCtx.clearRect(0, 0, targetW, targetH);

    const edgeFeather = Math.max(0, Math.min(6, this.config.edgeSoftness ?? 2));
    if (edgeFeather > 0 && this.checkCanvasFilterSupport()) {
      fgCtx.filter = `blur(${edgeFeather}px)`;
    }
    fgCtx.imageSmoothingEnabled = true;
    fgCtx.imageSmoothingQuality = 'high';
    fgCtx.drawImage(maskCanvas, 0, 0, targetW, targetH);
    fgCtx.filter = 'none';

    fgCtx.globalCompositeOperation = 'source-in';
    fgCtx.drawImage(video, 0, 0, targetW, targetH);
    fgCtx.restore();

    // 4. Composite foreground person over background
    outCtx.drawImage(fgCanvas, 0, 0, targetW, targetH);
  }

  private scheduleNextFrame = (): void => {
    if (!this.running) return;

    const tick = () => {
      this.rafId = null;
      this.fallbackTimer = null;
      if (!this.running) return;

      const now = performance.now();
      if (!this.paused && now - this.lastRenderTs >= 30) {
        this.lastRenderTs = now;
        this.processFrame();
      }
      this.scheduleNextFrame();
    };

    if (typeof document !== 'undefined' && document.hidden) {
      this.fallbackTimer = setTimeout(tick, 40);
    } else if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(tick);
    } else {
      this.fallbackTimer = setTimeout(tick, 33);
    }
  };

  private startProcessingLoop(rawStream: MediaStream): MediaStream {
    this.ensureCanvases();
    this.rawStream = rawStream;

    if (this.sourceVideo && this.sourceVideo.srcObject !== rawStream) {
      this.sourceVideo.srcObject = rawStream;
      this.sourceVideo.play().catch(() => {});
    }

    this.ensureSegmenter().catch(() => {});

    const videoEnabled = useAppStore.getState().videoEnabled;
    this.paused = !videoEnabled;

    if (!this.processedVideoTrack || this.processedVideoTrack.readyState === 'ended') {
      const captured = this.outputCanvas!.captureStream(30);
      this.processedVideoTrack = captured.getVideoTracks()[0] || null;
    }

    if (this.processedVideoTrack) {
      this.processedVideoTrack.enabled = videoEnabled;
    }

    const audioTracks = rawStream.getAudioTracks();
    const videoTracks = this.processedVideoTrack ? [this.processedVideoTrack] : [];
    const nextProcessed = new MediaStream([...audioTracks, ...videoTracks]);
    this.processedStream = nextProcessed;

    if (!this.running) {
      this.running = true;
      this.lastRenderTs = 0;
      this.scheduleNextFrame();
    }

    return nextProcessed;
  }

  private stopProcessingLoop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.processedVideoTrack) {
      try {
        this.processedVideoTrack.stop();
      } catch {}
      this.processedVideoTrack = null;
    }
    this.processedStream = null;
    if (this.sourceVideo) {
      this.sourceVideo.srcObject = null;
    }
    this.emaMask = null;
  }

  public async applyRawStream(rawStream: MediaStream | null): Promise<MediaStream | null> {
    this.rawStream = rawStream;
    this.config = useAppStore.getState().backgroundConfig || DEFAULT_VIRTUAL_BACKGROUND_CONFIG;

    if (!rawStream) {
      this.stopProcessingLoop();
      return null;
    }

    if (rawStream.getVideoTracks().length === 0 || this.config.mode === 'none') {
      this.stopProcessingLoop();
      return rawStream;
    }

    return this.startProcessingLoop(rawStream);
  }

  public async applyConfig(nextPartial: Partial<VirtualBackgroundConfig>): Promise<MediaStream | null> {
    const prevConfig = useAppStore.getState().backgroundConfig || DEFAULT_VIRTUAL_BACKGROUND_CONFIG;
    const nextConfig: VirtualBackgroundConfig = {
      ...prevConfig,
      ...nextPartial,
    };
    this.config = nextConfig;
    useAppStore.getState().setBackgroundConfig(nextConfig);

    const storeState = useAppStore.getState();
    const raw = storeState.rawLocalStream || this.rawStream || storeState.localStream;
    if (!raw) {
      return null;
    }

    if (nextConfig.mode === 'none') {
      this.stopProcessingLoop();
      const { audioEnabled, videoEnabled } = useAppStore.getState();
      raw.getAudioTracks().forEach((t) => (t.enabled = audioEnabled));
      raw.getVideoTracks().forEach((t) => (t.enabled = videoEnabled));
      useAppStore.getState().setLocalStream(raw);
      await webrtcManager.syncLocalStream(raw);
      return raw;
    }

    if (raw.getVideoTracks().length === 0) {
      return raw;
    }

    const wasActive =
      this.running &&
      this.rawStream === raw &&
      this.processedStream &&
      this.processedVideoTrack &&
      this.processedVideoTrack.readyState === 'live';

    if (wasActive && storeState.localStream === this.processedStream) {
      // Config updated in-place; no stream recreation or WebRTC track swap required
      this.ensureSegmenter().catch(() => {});
      return this.processedStream;
    }

    const processed = this.startProcessingLoop(raw);
    useAppStore.getState().setLocalStream(processed);
    await webrtcManager.syncLocalStream(processed);
    return processed;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.processedVideoTrack) {
      this.processedVideoTrack.enabled = !paused;
    }
  }

  public stop(): void {
    this.stopProcessingLoop();
    this.rawStream = null;
  }
}

export const virtualBackgroundEngine = new VirtualBackgroundEngine();
