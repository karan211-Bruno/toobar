// Shared YouTube Share Settings Fields (reused in SettingsModal, SharePickerModal, and Stage)
import React from 'react';
import type { YouTubeShareSettings } from '@shared/types';

interface YouTubeSettingsFieldsProps {
  settings: YouTubeShareSettings;
  onChange: (partial: Partial<YouTubeShareSettings>) => void;
  compact?: boolean;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function YouTubeSettingsFields({
  settings,
  onChange,
  compact = false,
}: YouTubeSettingsFieldsProps) {
  const toggleRow = (
    key: keyof YouTubeShareSettings,
    label: string,
    description?: string
  ) => {
    const active = Boolean(settings[key]);
    return (
      <label
        key={key}
        className="flex items-center justify-between gap-3 cursor-pointer py-1.5"
      >
        <div className="min-w-0">
          <div className="text-xs sm:text-sm text-secondary font-medium">{label}</div>
          {!compact && description && (
            <div className="text-[11px] text-muted mt-0.5">{description}</div>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={label}
          onClick={() => onChange({ [key]: !active } as Partial<YouTubeShareSettings>)}
          className={`toggle ${active ? 'active' : ''}`}
        />
      </label>
    );
  };

  return (
    <div className={`yt-settings-list ${compact ? 'space-y-2' : 'space-y-3'}`}>
      <div className="p-3 rounded-lg bg-tertiary border border-border-color space-y-1.5">
        <div className="text-xs font-semibold text-primary mb-1">재생 동기화 · 권한</div>
        {toggleRow(
          'syncPlayback',
          '참가자 재생/탐색 실시간 동기화',
          '호스트가 재생·일시정지·이동 시 모든 참가자 화면을 맞춥니다'
        )}
        {toggleRow(
          'allowParticipantControl',
          '모든 참가자 영상 제어 허용',
          '켜면 참가자도 직접 재생·일시정지·시간 탐색을 조작할 수 있습니다'
        )}
      </div>

      <div className="p-3 rounded-lg bg-tertiary border border-border-color space-y-1.5">
        <div className="text-xs font-semibold text-primary mb-1">플레이어 및 개인정보</div>
        {toggleRow('autoplay', '공유 시작 시 자동 재생')}
        {toggleRow('captions', '자막(CC) 기본 표시')}
        {toggleRow('loop', '영상 반복 재생')}
        {toggleRow('showControls', '유튜브 플레이어 컨트롤 표시')}
        {toggleRow(
          'privacyEnhanced',
          '프라이버시 강화 도메인 사용 (youtube-nocookie)',
          '시청 전까지 유튜브 추적 쿠키 저장을 제한합니다'
        )}
        {toggleRow('startMuted', '음소거 상태로 시작')}
      </div>

      <div className="p-3 rounded-lg bg-tertiary border border-border-color space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-secondary font-medium">기본 음량</span>
            <span className="font-mono text-primary font-semibold">
              {settings.defaultVolume}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.defaultVolume}
            onChange={(e) => onChange({ defaultVolume: Number(e.target.value) })}
            className="range-slider w-full"
            aria-label="기본 음량"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs sm:text-sm text-secondary font-medium">기본 재생 속도</span>
          <select
            value={settings.playbackRate}
            onChange={(e) => onChange({ playbackRate: Number(e.target.value) })}
            className="input py-1 px-2.5 text-xs"
            style={{ width: 'auto' }}
            aria-label="기본 재생 속도"
          >
            {SPEED_OPTIONS.map((rate) => (
              <option key={rate} value={rate}>
                {rate}x
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
