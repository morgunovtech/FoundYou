import type { QualityMode } from '../types/cleanup';
import type { MessageKey } from '../i18n';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface CleanupSummaryInput {
  removeMetadata: boolean;
  resolutionSummary: string;
  blurSummary: string;
  antiSearchEnabled: boolean;
  antiSearchLevel: number;
  renameSummary: string;
  watermarkEnabled: boolean;
  qualityMode: QualityMode;
  qualityPercent: number;
  t: Translate;
}

export function buildCleanupSummary({
  removeMetadata,
  resolutionSummary,
  blurSummary,
  antiSearchEnabled,
  antiSearchLevel,
  renameSummary,
  watermarkEnabled,
  qualityMode,
  qualityPercent,
  t
}: CleanupSummaryInput): string[] {
  const items: string[] = [];
  items.push(removeMetadata ? t('privacyDiffMetadataRemoved') : t('privacyDiffMetadataKept'));
  items.push(resolutionSummary);
  items.push(blurSummary);
  if (antiSearchEnabled) {
    items.push(t('privacyDiffAntiSearchOn', { level: antiSearchLevel }));
  } else {
    items.push(t('privacyDiffAntiSearchNeutral'));
  }
  items.push(renameSummary);
  items.push(watermarkEnabled ? t('privacyDiffWatermarkOn') : t('privacyDiffWatermarkOff'));
  items.push(
    t('privacyDiffQualityMode', {
      mode: t(`qualityMode_${qualityMode}`),
      percent: qualityPercent
    })
  );
  return items;
}
