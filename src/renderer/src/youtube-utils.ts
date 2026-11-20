// YouTube URL parser, time formatter, title resolver & embed URL builder
import type { YouTubeShareSettings } from '@shared/types';

export interface ParsedYouTubeLink {
  videoId?: string;
  playlistId?: string;
  startSeconds: number;
  canonicalUrl: string;
}

const YT_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

export function parseTimeTokenToSeconds(raw: string | null | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return 0;

  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10));
  }

  // Handle 1h2m3s / 2m30s / 45s
  const hmsMatch = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
    const h = parseInt(hmsMatch[1] || '0', 10);
    const m = parseInt(hmsMatch[2] || '0', 10);
    const s = parseInt(hmsMatch[3] || '0', 10);
    return h * 3600 + m * 60 + s;
  }

  // Handle HH:MM:SS or MM:SS
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => parseInt(p, 10));
    if (parts.every((n) => !Number.isNaN(n) && n >= 0)) {
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  return 0;
}

export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const whole = Math.floor(sec);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function parseYouTubeUrl(rawInput: string): ParsedYouTubeLink | null {
  const input = (rawInput || '').trim();
  if (!input) return null;

  // Bare 11-character YouTube video ID
  if (YT_ID_REGEX.test(input)) {
    return {
      videoId: input,
      startSeconds: 0,
      canonicalUrl: `https://www.youtube.com/watch?v=${input}`,
    };
  }

  let normalized = input;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    const playlistId = url.searchParams.get('list') || undefined;
    const startRaw = url.searchParams.get('t') || url.searchParams.get('start');
    const startSeconds = parseTimeTokenToSeconds(startRaw);

    let videoId: string | undefined;

    if (host === 'youtu.be') {
      const seg = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (seg && YT_ID_REGEX.test(seg)) videoId = seg;
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const pathParts = url.pathname.split('/').filter(Boolean);
      const vParam = url.searchParams.get('v');
      if (vParam && YT_ID_REGEX.test(vParam)) {
        videoId = vParam;
      } else if (
        pathParts.length >= 2 &&
        (pathParts[0] === 'shorts' ||
          pathParts[0] === 'live' ||
          pathParts[0] === 'embed' ||
          pathParts[0] === 'v')
      ) {
        if (YT_ID_REGEX.test(pathParts[1])) {
          videoId = pathParts[1];
        }
      }
    }

    if (!videoId && !playlistId) {
      return null;
    }

    const canonicalUrl = videoId
      ? `https://www.youtube.com/watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ''}`
      : `https://www.youtube.com/playlist?list=${playlistId}`;

    return {
      videoId,
      playlistId,
      startSeconds,
      canonicalUrl,
    };
  } catch {
    return null;
  }
}

export async function fetchYouTubeTitle(videoId: string): Promise<string> {
  const fallback = `YouTube 영상 (${videoId})`;
  if (!videoId || typeof fetch !== 'function') return fallback;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), 3000);
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const resp = await fetch(oembedUrl, {
      signal: controller?.signal,
    });
    if (!resp.ok) return fallback;
    const json = (await resp.json()) as { title?: string };
    return json.title?.trim() || fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export function buildYouTubeEmbedUrl({
  videoId,
  playlistId,
  startSeconds = 0,
  settings,
}: {
  videoId?: string;
  playlistId?: string;
  startSeconds?: number;
  settings: YouTubeShareSettings;
}): string {
  const domain = settings.privacyEnhanced
    ? 'https://www.youtube-nocookie.com'
    : 'https://www.youtube.com';

  const params = new URLSearchParams();
  params.set('enablejsapi', '1');
  params.set('playsinline', '1');
  params.set('rel', '0');
  params.set('modestbranding', '1');
  params.set('controls', settings.showControls ? '1' : '0');
  params.set('cc_load_policy', settings.captions ? '1' : '0');
  params.set('autoplay', settings.autoplay ? '1' : '0');
  params.set('mute', settings.startMuted ? '1' : '0');
  if (settings.loop) {
    params.set('loop', '1');
    if (videoId && !playlistId) {
      // YouTube embed requires playlist=VIDEO_ID for single-video looping
      params.set('playlist', videoId);
    }
  }
  if (playlistId) {
    params.set('list', playlistId);
    if (!videoId) {
      params.set('listType', 'playlist');
    }
  }
  if (startSeconds > 0) {
    params.set('start', String(Math.floor(startSeconds)));
  }

  // Only pass origin when running over http(s) — never file://
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    params.set('origin', window.location.origin);
  }

  const basePath = videoId ? `/embed/${videoId}` : '/embed/videoseries';
  return `${domain}${basePath}?${params.toString()}`;
}
