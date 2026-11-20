// Background Effects Panel & Modal (Virtual Background + Blur)
import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_VIRTUAL_BACKGROUND_CONFIG,
  type CustomBackgroundItem,
  type VirtualBackgroundConfig,
} from '@shared/types';
import { useAppStore } from '../store';
import {
  VIRTUAL_BACKGROUND_PRESETS,
  addCustomBackgroundFromFile,
  loadCustomBackgrounds,
  removeCustomBackground,
  virtualBackgroundEngine,
  type VirtualBackgroundEngineStatus,
} from '../virtual-background';

const BLUR_PRESETS = [
  { id: 'light', label: '약한 흐림', amount: 8 },
  { id: 'medium', label: '보통 흐림', amount: 16 },
  { id: 'strong', label: '강한 흐림', amount: 26 },
];

export function BackgroundEffectsPanel({ compact = false }: { compact?: boolean }) {
  const backgroundConfig =
    useAppStore((s) => s.backgroundConfig) || DEFAULT_VIRTUAL_BACKGROUND_CONFIG;
  const [engineStatus, setEngineStatus] = useState<VirtualBackgroundEngineStatus>(() =>
    virtualBackgroundEngine.getStatus()
  );
  const [customItems, setCustomItems] = useState<CustomBackgroundItem[]>(() =>
    loadCustomBackgrounds()
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return virtualBackgroundEngine.onStatusChange(setEngineStatus);
  }, []);

  const applyPartial = (partial: Partial<VirtualBackgroundConfig>) => {
    virtualBackgroundEngine.applyConfig(partial).catch((err) => {
      console.error('[VirtualBg] applyConfig failed:', err);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const added = await addCustomBackgroundFromFile(file);
      setCustomItems(loadCustomBackgrounds());
      applyPartial({
        mode: 'image',
        customImageId: added.id,
        customImageDataUrl: added.dataUrl,
      });
    } catch (err: any) {
      setUploadError(err?.message || '배경 이미지를 불러오지 못했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveCustom = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const nextList = removeCustomBackground(id);
    setCustomItems(nextList);
    if (backgroundConfig.mode === 'image' && backgroundConfig.customImageId === id) {
      applyPartial({
        mode: 'none',
        customImageId: null,
        customImageDataUrl: null,
      });
    }
  };

  const statusBadgeText =
    engineStatus === 'loading'
      ? '⏳ AI 인물 분리 모델 불러오는 중...'
      : engineStatus === 'ai-gpu' || engineStatus === 'ai-cpu'
      ? '✨ AI 인물 분리 활성화'
      : engineStatus === 'fallback'
      ? '🪄 기본 인물 마스킹 활성화'
      : backgroundConfig.mode === 'none'
      ? '원본 카메라'
      : '✨ 배경 효과 준비 중';

  return (
    <div className={`bg-effects-panel ${compact ? 'compact' : ''}`}>
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
        <div>
          <h4 className="text-xs font-semibold text-primary">🎭 내 화면 배경 효과 (흐림 · 가상 배경)</h4>
          {!compact && (
            <p className="text-[11px] text-muted mt-0.5">
              배경을 흐리게 처리하거나 가상 배경·내 사진으로 변경해 상대방에게 전송합니다
            </p>
          )}
        </div>
        <span
          className={`badge text-[10px] ${
            engineStatus === 'ai-gpu' || engineStatus === 'ai-cpu'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-tertiary text-secondary'
          }`}
        >
          {statusBadgeText}
        </span>
      </div>

      {/* Mode Quick Buttons: None + 3 Blur Presets */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <button
          type="button"
          onClick={() => applyPartial({ mode: 'none' })}
          className={`collab-tool-btn ${backgroundConfig.mode === 'none' ? 'active' : ''}`}
        >
          🚫 없음 (원본)
        </button>

        {BLUR_PRESETS.map((bp) => {
          const isSelected =
            backgroundConfig.mode === 'blur' &&
            Math.abs((backgroundConfig.blurAmount || 14) - bp.amount) <= 4;
          return (
            <button
              key={bp.id}
              type="button"
              onClick={() => applyPartial({ mode: 'blur', blurAmount: bp.amount })}
              className={`collab-tool-btn ${isSelected ? 'active' : ''}`}
            >
              💧 {bp.label}
            </button>
          );
        })}
      </div>

      {/* Blur Strength Slider */}
      {backgroundConfig.mode === 'blur' && (
        <div className="p-2.5 rounded-lg bg-tertiary border border-border-color mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-secondary font-medium">흐림 강도 조절</span>
            <span className="font-mono text-primary font-semibold">
              {backgroundConfig.blurAmount || 14}px
            </span>
          </div>
          <input
            type="range"
            min={4}
            max={32}
            step={1}
            value={backgroundConfig.blurAmount || 14}
            onChange={(e) =>
              applyPartial({ mode: 'blur', blurAmount: Number(e.target.value) })
            }
            className="range-slider w-full"
            aria-label="배경 흐림 강도"
          />
        </div>
      )}

      {/* Virtual Background Preset & Custom Grid */}
      <div className="text-[11px] font-medium text-secondary mb-1.5">가상 배경 선택</div>
      <div className="bg-effects-grid">
        {VIRTUAL_BACKGROUND_PRESETS.map((preset) => {
          const isActive =
            backgroundConfig.mode === 'preset' && backgroundConfig.presetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPartial({ mode: 'preset', presetId: preset.id })}
              className={`bg-thumb-card ${isActive ? 'active' : ''}`}
              title={preset.name}
            >
              <img src={preset.thumbnailDataUrl} alt={preset.name} />
              <span className="bg-thumb-label">
                {preset.badge} {preset.name}
              </span>
            </button>
          );
        })}

        {customItems.map((item) => {
          const isActive =
            backgroundConfig.mode === 'image' && backgroundConfig.customImageId === item.id;
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() =>
                applyPartial({
                  mode: 'image',
                  customImageId: item.id,
                  customImageDataUrl: item.dataUrl,
                })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  applyPartial({
                    mode: 'image',
                    customImageId: item.id,
                    customImageDataUrl: item.dataUrl,
                  });
                }
              }}
              className={`bg-thumb-card ${isActive ? 'active' : ''}`}
              title={item.name}
            >
              <img src={item.dataUrl} alt={item.name} />
              <button
                type="button"
                onClick={(e) => handleRemoveCustom(e, item.id)}
                className="bg-thumb-delete"
                title="사용자 배경 삭제"
                aria-label={`${item.name} 삭제`}
              >
                ✕
              </button>
              <span className="bg-thumb-label">🖼️ {item.name}</span>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="bg-thumb-card bg-thumb-upload"
          title="내 사진에서 배경 이미지 추가"
        >
          <span className="text-lg">+</span>
          <span className="text-[11px] font-medium">
            {uploading ? '불러오는 중...' : '내 사진 추가'}
          </span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
    </div>
  );
}

export function BackgroundEffectsModal({ onClose }: { onClose: () => void }) {
  const localStream = useAppStore((s) => s.localStream);
  const videoEnabled = useAppStore((s) => s.videoEnabled);
  const currentUser = useAppStore((s) => s.currentUser);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
      videoRef.current.play().catch(() => {});
    }
  }, [localStream, videoEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div>
            <h2 className="font-semibold text-primary text-base">
              ✨ 배경 효과 및 가상 배경 설정
            </h2>
            <p className="text-xs text-muted mt-0.5">
              설정한 배경 효과가 내 화면과 상대방에게 실시간으로 적용됩니다
            </p>
          </div>
          <button onClick={onClose} className="btn btn-icon btn-ghost p-1" aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="aspect-video bg-tertiary rounded-xl overflow-hidden border border-border-color relative">
            {localStream && videoEnabled ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ transform: 'scaleX(-1)' }}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted">
                <div className="avatar avatar-lg mb-2">
                  {(currentUser?.name || '나').charAt(0).toUpperCase()}
                </div>
                <p className="text-xs">
                  {videoEnabled ? '카메라 스트림 준비 중...' : '카메라가 꺼져 있습니다 (미리보기를 보려면 카메라를 켜세요)'}
                </p>
              </div>
            )}
            <div className="absolute top-2.5 left-2.5 badge bg-black/60 text-white">
              실시간 미리보기
            </div>
          </div>

          <BackgroundEffectsPanel />
        </div>

        <div className="p-3.5 border-t border-border-color flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-primary py-2 px-5 text-sm">
            적용 완료
          </button>
        </div>
      </div>
    </div>
  );
}
