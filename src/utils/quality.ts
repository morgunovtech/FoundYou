import type { QualityMode } from '../types/cleanup';

// Единственный источник значений качества: раньше проценты в UI и коэффициенты
// экспорта были продублированы в App и CleanupDownloadBlock и могли разъехаться.
export const QUALITY_VALUES: Record<QualityMode, number> = {
  low: 0.82,
  medium: 0.9,
  original: 0.98
};

export function qualityForMode(mode: QualityMode): number {
  return QUALITY_VALUES[mode] ?? QUALITY_VALUES.original;
}

export function qualityPercent(mode: QualityMode): number {
  return Math.round(qualityForMode(mode) * 100);
}
