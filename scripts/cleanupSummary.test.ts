import assert from 'node:assert/strict';
import { buildCleanupSummary } from '../src/utils/cleanupSummary';

// Стаб возвращает ключ и значения параметров: реальный t подставляет параметры
// в шаблон словаря, которого здесь нет, поэтому просто делаем значения видимыми
// для assert'ов (прошлая версия интерполировала в сам ключ и теряла {mode}).
const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return `${key} ${Object.values(params).map(String).join(' ')}`;
};

const summary = buildCleanupSummary({
  removeMetadata: true,
  resolutionSummary: 'resolution',
  blurSummary: 'blur',
  antiSearchEnabled: false,
  antiSearchLevel: 2,
  renameSummary: 'rename',
  watermarkEnabled: false,
  qualityMode: 'medium',
  qualityPercent: 90,
  t
});

assert.ok(summary.includes('privacyDiffAntiSearchNeutral'));
assert.ok(summary.includes('privacyDiffWatermarkOff'));
assert.ok(summary.some((item) => item.includes('qualityMode_medium')));

console.log('buildCleanupSummary: ok');
