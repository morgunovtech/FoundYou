import type { QualityMode } from '../types/cleanup';
import type { MessageKey } from '../i18n';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface CleanupSummaryInput {
  /** PRNU (sensor-noise) softening. Metadata itself is always dropped by the canvas re-encode. */
  prnuCleanup: boolean;
  resolutionSummary: string;
  blurSummary: string;
  /** True when at least one blur target (people, text, manual mask) is active. */
  blurActive?: boolean;
  /** 'pixelate' when the browser ignores canvas `filter` and regions are resampled instead. */
  blurMode?: 'filter' | 'pixelate';
  /** True when the platform canvas limit forced a smaller export than requested. */
  platformCapped?: boolean;
  /** Megapixel cap to quote in the platform note. */
  platformCapMegapixels?: number;
  antiSearchEnabled: boolean;
  antiSearchLevel: number;
  /** Hash-distance target of the level and the distance the last preview reached. */
  antiSearchTargetBits?: number;
  antiSearchDistance?: number | null;
  renameSummary: string;
  watermarkEnabled: boolean;
  qualityMode: QualityMode;
  qualityPercent: number;
  /** The export keeps the original picture bytes and only rewrites the container (JPEG/PNG source, no pixel operation). */
  losslessContainer?: boolean;
  /** The copy is written as PNG: lossless, so the quality setting does not apply. */
  losslessFormat?: boolean;
  /** The leak index now and the one predicted for the copy; both or neither. */
  leakBefore?: number | null;
  leakAfter?: number | null;
  t: Translate;
}

export function buildCleanupSummary({
  prnuCleanup,
  resolutionSummary,
  blurSummary,
  blurActive = false,
  blurMode = 'filter',
  platformCapped = false,
  platformCapMegapixels,
  antiSearchEnabled,
  antiSearchLevel,
  antiSearchTargetBits,
  antiSearchDistance = null,
  renameSummary,
  watermarkEnabled,
  qualityMode,
  qualityPercent,
  losslessContainer = false,
  losslessFormat = false,
  leakBefore = null,
  leakAfter = null,
  t
}: CleanupSummaryInput): string[] {
  const items: string[] = [];
  // Re-encoding through a canvas never carries EXIF/XMP/IPTC/ICC over, so this
  // line is unconditional; only the sensor-noise pass is optional.
  items.push(t('privacyDiffMetadataRemoved'));
  if (losslessContainer) {
    items.push(t('privacyDiffLossless'));
  }
  if (prnuCleanup) {
    items.push(t('privacyDiffPrnuOn'));
  }
  items.push(resolutionSummary);
  if (platformCapped) {
    items.push(t('privacyDiffPlatformCap', { mp: platformCapMegapixels ?? 16 }));
  }
  items.push(blurSummary);
  if (blurActive && blurMode === 'pixelate') {
    items.push(t('privacyDiffBlurPixelate'));
  }
  if (antiSearchEnabled) {
    items.push(t('privacyDiffAntiSearchOn', { level: antiSearchLevel, bits: antiSearchTargetBits ?? 10 }));
    if (antiSearchDistance != null) items.push(t('privacyDiffAntiSearchMeasured', { distance: antiSearchDistance }));
  } else {
    items.push(t('privacyDiffAntiSearchNeutral'));
  }
  items.push(renameSummary);
  items.push(watermarkEnabled ? t('privacyDiffWatermarkOn') : t('privacyDiffWatermarkOff'));
  // A PNG has no quality knob; «Качество: Среднее (90 %)» under a PNG screenshot was a lie by template.
  if (losslessFormat || losslessContainer) {
    items.push(t('privacyDiffFormatLossless'));
  } else {
    items.push(
      qualityMode === 'match'
        ? t('privacyDiffQualityMatch', { percent: qualityPercent })
        : t('privacyDiffQualityMode', { mode: t(`qualityMode_${qualityMode}`), percent: qualityPercent })
    );
  }
  if (leakBefore != null && leakAfter != null) {
    items.push(t('privacyDiffLeakIndex', { before: leakBefore, after: leakAfter }));
  }
  return items;
}
