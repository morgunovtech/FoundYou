import { describe, it, expect } from 'vitest';
import { buildCleanupSummary } from '../cleanupSummary';
import type { MessageKey } from '../../i18n';

/** Echoes the key plus its params (`key[a=1,b=2]`) so assertions target keys, not copy. */
const t = (key: MessageKey, params?: Record<string, string | number>) => {
  if (!params) return key;
  const rendered = Object.entries(params)
    .map(([paramKey, paramValue]) => `${paramKey}=${paramValue}`)
    .join(',');
  return `${key}[${rendered}]`;
};

const base = {
  prnuCleanup: false,
  resolutionSummary: 'resolution',
  blurSummary: 'blur',
  antiSearchEnabled: false,
  antiSearchLevel: 2,
  renameSummary: 'rename',
  watermarkEnabled: false,
  qualityMode: 'medium' as const,
  qualityPercent: 90,
  t
};

describe('buildCleanupSummary', () => {
  it('always reports metadata removal — the canvas re-encode never keeps it', () => {
    const withoutPrnu = buildCleanupSummary({ ...base, prnuCleanup: false });
    const withPrnu = buildCleanupSummary({ ...base, prnuCleanup: true });
    expect(withoutPrnu).toContain('privacyDiffMetadataRemoved');
    expect(withPrnu).toContain('privacyDiffMetadataRemoved');
    expect(withoutPrnu).not.toContain('privacyDiffMetadataKept');
    expect(withPrnu).not.toContain('privacyDiffMetadataKept');
  });

  it('adds the PRNU line only when sensor-noise softening is enabled', () => {
    expect(buildCleanupSummary({ ...base, prnuCleanup: false })).not.toContain('privacyDiffPrnuOn');
    const items = buildCleanupSummary({ ...base, prnuCleanup: true });
    expect(items).toContain('privacyDiffPrnuOn');
    expect(items.indexOf('privacyDiffPrnuOn')).toBe(items.indexOf('privacyDiffMetadataRemoved') + 1);
  });

  it('mentions the pixelate fallback only when a blur is active and the filter is unsupported', () => {
    expect(buildCleanupSummary({ ...base, blurActive: true, blurMode: 'filter' })).not.toContain('privacyDiffBlurPixelate');
    expect(buildCleanupSummary({ ...base, blurActive: false, blurMode: 'pixelate' })).not.toContain('privacyDiffBlurPixelate');
    expect(buildCleanupSummary({ ...base, blurActive: true, blurMode: 'pixelate' })).toContain('privacyDiffBlurPixelate');
  });

  it('adds the platform cap note with the megapixel figure', () => {
    expect(buildCleanupSummary(base)).not.toContain('privacyDiffPlatformCap');
    const items = buildCleanupSummary({ ...base, platformCapped: true, platformCapMegapixels: 16 });
    expect(items).toContain('privacyDiffPlatformCap[mp=16]');
  });

  it('keeps the anti-search, watermark and quality lines', () => {
    const items = buildCleanupSummary({ ...base, antiSearchEnabled: true, antiSearchLevel: 3, watermarkEnabled: true });
    expect(items).toContain('privacyDiffAntiSearchOn[level=3]');
    expect(items).toContain('privacyDiffWatermarkOn');
    expect(items).toContain('privacyDiffQualityMode[mode=qualityMode_medium,percent=90]');
  });

  it('reports the neutral anti-search and watermark-off lines when both are disabled', () => {
    const items = buildCleanupSummary(base);
    expect(items).toContain('privacyDiffAntiSearchNeutral');
    expect(items).toContain('privacyDiffWatermarkOff');
    expect(items).not.toContain('privacyDiffWatermarkOn');
    expect(items.some((item) => item.startsWith('privacyDiffAntiSearchOn'))).toBe(false);
  });
});
