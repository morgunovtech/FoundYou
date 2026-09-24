import type { FilenameAnalysis } from './heuristics/filenameAnalyzer';
import type { StrippedAnalysis } from './heuristics/strippedDetector';
import type { EditingAnalysis } from './heuristics/editingHistory';
import type { CompressionVerdict } from './jpegQuant';
import { matchMessengerSize } from './messengerFootprint';

/*
 * One judge for where the file has been since the shutter.
 *
 * The «На что сделан снимок» card used to let every signal speak for itself: the quantization
 * tables said «пересжат мессенджером или редактором», the Live Photo row said «после съёмки не
 * пересохраняли», the history said «не редактировался» and the profile said «оригинальный файл,
 * не проходил через сервисы сжатия» — about the same bytes, on the sample every visitor opens
 * first. A photo out of Telegram was headlined «Оригинальный файл (не из мессенджера)» with
 * «1280 px — столько оставляет Telegram» printed a line below it.
 *
 * This module takes every sign the file offers and returns one verdict with its grounds. The
 * rows that used to judge on their own now print the same reasons, or nothing. Pure: no DOM,
 * no dictionary — the component maps codes to text.
 */

export type OriginVerdict = 'camera-original' | 'messenger' | 'resaved' | 'stripped' | 'screenshot' | 'unknown';
export type OriginConfidence = 'high' | 'medium' | 'low';

export type OriginReason =
  /** Make, Model or DateTimeOriginal are in the file. */
  | 'camera-exif'
  /** A format that carries EXIF, with none of the camera fields in it. */
  | 'no-camera-exif'
  /** The name follows a messenger's save pattern. */
  | 'messenger-name'
  /** The longest side sits exactly on a service's cap. */
  | 'messenger-size'
  /** A JPEG of 1600 px or less with no camera EXIF. */
  | 'small-jpeg'
  /** Quantization tables no libjpeg build writes (Apple, Canon, Photoshop, macOS). */
  | 'own-tables'
  /** EXIF names Apple, the tables are libjpeg's: another program wrote the picture. */
  | 'libjpeg-tables-apple'
  /** A Samsung / Google camera never writes libjpeg tables below quality 90. */
  | 'libjpeg-tables-low'
  /** The Live Photo marker is still attached. */
  | 'live-photo'
  /** The Motion Photo trailer is still attached. */
  | 'motion-photo'
  /** ModifyDate is later than the shot. */
  | 'modify-date'
  /** A Software / CreatorTool tag names an editor. */
  | 'software'
  /** Fewer pixels than the size the camera wrote. */
  | 'resized'
  /** The embedded thumbnail shows a different frame. */
  | 'thumbnail-differs'
  /** The file is marked as generatively edited. */
  | 'ai-edit'
  /** File name, screen size, PNG container or flat pixels say screen capture. */
  | 'screenshot'
  /** PNG, WebP, GIF, BMP: no EXIF to lose, nothing to judge by. */
  | 'no-exif-format';

export interface OriginJudgement {
  verdict: OriginVerdict;
  confidence: OriginConfidence;
  /** The services the name or the size point at; empty unless the verdict is `messenger` or the size matched. */
  platforms: string[];
  reasons: OriginReason[];
}

export interface OriginInput {
  /** The original container's MIME type (before any HEIC conversion). */
  mimeType: string;
  width: number;
  height: number;
  /** `hasCameraExif` from the stripped detector: Make / Model / DateTimeOriginal / lens / exposure, not the resolution stub. */
  hasCameraExif: boolean;
  filename: FilenameAnalysis;
  stripped: StrippedAnalysis;
  editing: EditingAnalysis | null;
  /** The JPEG tables against the maker in EXIF; null for other containers or before they are read. */
  compression: CompressionVerdict | null;
  livePhoto: boolean;
  motionPhoto: boolean;
  /** ModifyDate at least a minute after DateTimeOriginal. */
  modifiedLater: boolean;
  /** The picture has fewer pixels than the EXIF size. */
  resized: boolean;
  /** The IFD1 thumbnail differs from the frame (null when it could not be compared or is absent). */
  thumbnailDiffers: boolean;
  /** The screenshot score is «likely» or «certain», or the name / size say screen capture outright. */
  screenshotLikely: boolean;
}

const EXIF_BEARING = /(jpeg|jpg|heic|heif|avif|tiff)/i;
const SMALL_JPEG_MAX_SIDE = 1600;

/** Platforms whose save pattern means the picture went through them (a camera platform is where it was taken). */
const MESSENGERS = new Set(['Telegram', 'Signal', 'WhatsApp', 'Viber', 'Facebook Messenger', 'Instagram', 'VK', 'Discord']);

export function judgeOrigin(input: OriginInput): OriginJudgement {
  const reasons: OriginReason[] = [];
  const mime = input.mimeType.toLowerCase();
  const exifBearing = EXIF_BEARING.test(mime);
  const isJpeg = /jpe?g/.test(mime);

  if (input.screenshotLikely) {
    return { verdict: 'screenshot', confidence: 'high', platforms: [], reasons: ['screenshot'] };
  }

  const namedMessenger = input.filename.platform && MESSENGERS.has(input.filename.platform) ? input.filename.platform : null;
  const size = matchMessengerSize(input.width, input.height);
  const platforms = namedMessenger ? [namedMessenger] : size ? size.platforms : [];

  if (!exifBearing) {
    // A PNG or a WebP never had EXIF to lose: the name and the size are all there is.
    reasons.push('no-exif-format');
    if (namedMessenger) reasons.push('messenger-name');
    if (namedMessenger) return { verdict: 'messenger', confidence: 'medium', platforms, reasons };
    return { verdict: 'unknown', confidence: 'low', platforms: [], reasons };
  }

  if (!input.hasCameraExif) {
    reasons.push('no-camera-exif');
    if (namedMessenger) reasons.push('messenger-name');
    if (size) reasons.push('messenger-size');
    const smallJpeg = isJpeg && Math.max(input.width, input.height) <= SMALL_JPEG_MAX_SIDE;
    if (smallJpeg) reasons.push('small-jpeg');
    if (namedMessenger || size) {
      return {
        verdict: 'messenger',
        confidence: namedMessenger ? 'high' : 'medium',
        platforms,
        reasons
      };
    }
    // Something dropped the camera block and left no name: an editor's «export for web», a site, a
    // screenshot tool saving JPEG. The stripped detector's own evidence says how sure that is.
    return { verdict: 'stripped', confidence: smallJpeg || input.stripped.stripped ? 'medium' : 'low', platforms: [], reasons };
  }

  reasons.push('camera-exif');
  const negatives: OriginReason[] = [];
  if (input.compression?.conflict === 'apple-standard') negatives.push('libjpeg-tables-apple');
  if (input.compression?.conflict === 'android-low') negatives.push('libjpeg-tables-low');
  if (input.modifiedLater) negatives.push('modify-date');
  if (input.editing?.edited && input.editing.software.length > 0) negatives.push('software');
  if (input.resized) negatives.push('resized');
  if (input.thumbnailDiffers) negatives.push('thumbnail-differs');
  if (input.editing?.aiScope === 'edited') negatives.push('ai-edit');
  if (size) negatives.push('messenger-size');

  const positives: OriginReason[] = [];
  if (input.compression && !input.compression.exact) positives.push('own-tables');
  if (input.livePhoto) positives.push('live-photo');
  if (input.motionPhoto) positives.push('motion-photo');

  if (negatives.length > 0) {
    // The MakerNote or the trailer survived a re-save: they are copied along with the rest of
    // the metadata and say nothing about the pixels, so they are listed but do not outvote.
    reasons.push(...negatives, ...positives);
    return {
      verdict: 'resaved',
      confidence: negatives.length >= 2 ? 'high' : 'medium',
      platforms: size ? size.platforms : [],
      reasons
    };
  }

  reasons.push(...positives);
  return {
    verdict: 'camera-original',
    confidence: positives.length > 0 ? 'high' : 'medium',
    platforms: [],
    reasons
  };
}
