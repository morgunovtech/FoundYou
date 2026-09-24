import type { MessageKey } from '../i18n';
import type { OriginConfidence, OriginJudgement, OriginReason, OriginVerdict } from './originJudge';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Dictionary keys for the one origin verdict, its confidence and each of its grounds. */
export const ORIGIN_VERDICT_KEYS: Record<OriginVerdict, MessageKey> = {
  'camera-original': 'originVerdictCameraOriginal',
  messenger: 'originVerdictMessenger',
  resaved: 'originVerdictResaved',
  stripped: 'originVerdictStripped',
  screenshot: 'originVerdictScreenshot',
  unknown: 'originVerdictUnknown'
};

export const ORIGIN_CONFIDENCE_KEYS: Record<OriginConfidence, MessageKey> = {
  high: 'originConfidenceHigh',
  medium: 'originConfidenceMedium',
  low: 'originConfidenceLow'
};

export const ORIGIN_REASON_KEYS: Record<OriginReason, MessageKey> = {
  'camera-exif': 'originReasonCameraExif',
  'no-camera-exif': 'originReasonNoCameraExif',
  'messenger-name': 'originReasonMessengerName',
  'messenger-size': 'originReasonMessengerSize',
  'small-jpeg': 'originReasonSmallJpeg',
  'own-tables': 'originReasonOwnTables',
  'libjpeg-tables-apple': 'originReasonLibjpegApple',
  'libjpeg-tables-low': 'originReasonLibjpegLow',
  'live-photo': 'originReasonLivePhoto',
  'motion-photo': 'originReasonMotionPhoto',
  'modify-date': 'originReasonModifyDate',
  software: 'originReasonSoftware',
  resized: 'originReasonResized',
  'thumbnail-differs': 'originReasonThumbnail',
  'ai-edit': 'originReasonAiEdit',
  screenshot: 'originReasonScreenshot',
  'no-exif-format': 'originReasonNoExifFormat'
};

/** The verdict as one line («скорее всего, прошёл через Telegram») and its grounds as short phrases. */
export function describeOrigin(origin: OriginJudgement, t: Translate): { headline: string; reasons: string[] } {
  const platforms = origin.platforms.join(', ');
  const verdict = t(ORIGIN_VERDICT_KEYS[origin.verdict], { platforms });
  const headline = `${t(ORIGIN_CONFIDENCE_KEYS[origin.confidence])} ${verdict}`;
  const reasons = origin.reasons.map((reason) => t(ORIGIN_REASON_KEYS[reason], { platforms }));
  return { headline, reasons };
}
