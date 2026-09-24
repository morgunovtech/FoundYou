/*
 * Is this a screenshot rather than a photo? No single sign is proof, so the signs are summed
 * as log-odds and shown as a probability with the reasons: a screenshot file name, a known
 * screen size, no camera EXIF, the PNG container, and flat interface pixels (runs of exactly
 * equal neighbours, which a camera sensor never produces). Camera EXIF pulls the other way.
 * Pure; the pixel measure comes from `measureFlatness`.
 */

export interface ScreenshotInput {
  /** The file name matched a screenshot pattern (`analyzeFilename`). */
  filenameScreenshot: boolean;
  /** The pixel size is a known phone, tablet or monitor screen (`analyzeResolution`). */
  knownScreenSize: boolean;
  /** EXIF names a camera make or model. */
  hasCameraExif: boolean;
  /** EXIF carries DateTimeOriginal. */
  hasShotDate: boolean;
  mimeType: string;
  /** Share of pixels equal to their right-hand neighbour, 0–1; null when not measured. */
  flatRatio: number | null;
}

export type ScreenshotReason =
  'filename' | 'screen-size' | 'no-camera-exif' | 'png' | 'flat-pixels' | 'camera-exif' | 'photo-pixels';
export type ScreenshotLevel = 'unlikely' | 'possible' | 'likely' | 'certain';

export interface ScreenshotScore {
  /** 0–1. */
  probability: number;
  level: ScreenshotLevel;
  reasons: ScreenshotReason[];
}

/** Prior: about one file in fifteen brought here is a screenshot. */
const PRIOR_LOGIT = -2.6;
/**
 * Interfaces are flat: above this share of identical neighbours a photo is practically ruled out.
 * Measured 2026-09-24 (`docs/threshold-check-2026-09-24.md`): 76 camera originals sit at
 * 0.01–0.20, 24 Telegram-recompressed photos at 0.13–0.41, a 480 px iCloud thumbnail at 0.45;
 * 16 real screenshots at 0.39–0.93, with four content-heavy captures (long page captures, an
 * app home screen full of pictures) under 0.55. Lowering the bar to 0.50 catches two of those
 * four and no photograph in the set; the two at 0.39–0.44 still get the middle band below.
 */
export const FLAT_SCREENSHOT = 0.5;
/** Below this the picture has sensor noise everywhere, as photos do. */
export const FLAT_PHOTO = 0.12;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function scoreScreenshot(input: ScreenshotInput): ScreenshotScore {
  const reasons: ScreenshotReason[] = [];
  let logit = PRIOR_LOGIT;
  if (input.filenameScreenshot) {
    logit += 4;
    reasons.push('filename');
  }
  if (input.knownScreenSize) {
    logit += 2.5;
    reasons.push('screen-size');
  }
  if (input.hasCameraExif) {
    logit -= 3;
    reasons.push('camera-exif');
  } else if (!input.hasShotDate) {
    logit += 1;
    reasons.push('no-camera-exif');
  }
  if (/png$/i.test(input.mimeType)) {
    logit += 0.8;
    reasons.push('png');
  }
  if (input.flatRatio != null) {
    if (input.flatRatio >= FLAT_SCREENSHOT) {
      logit += 3;
      reasons.push('flat-pixels');
    } else if (input.flatRatio >= 0.3) {
      logit += 1;
      reasons.push('flat-pixels');
    } else if (input.flatRatio < FLAT_PHOTO) {
      logit -= 1.5;
      reasons.push('photo-pixels');
    }
  }
  const probability = Math.round(sigmoid(logit) * 100) / 100;
  const level: ScreenshotLevel =
    probability < 0.2 ? 'unlikely' : probability < 0.5 ? 'possible' : probability < 0.85 ? 'likely' : 'certain';
  return { probability, level, reasons };
}

/**
 * Share of pixels whose RGB equals the right-hand neighbour's, sampled on every other row.
 * Flat interface colour blocks score near 1, camera pictures near 0 even after downscaling.
 */
export function measureFlatness(data: Uint8ClampedArray, width: number, height: number): number {
  if (width < 2 || height < 1) return 0;
  let same = 0;
  let total = 0;
  for (let y = 0; y < height; y += 2) {
    let i = y * width * 4;
    for (let x = 0; x < width - 1; x++, i += 4) {
      total += 1;
      if (data[i] === data[i + 4] && data[i + 1] === data[i + 5] && data[i + 2] === data[i + 6]) same += 1;
    }
  }
  return total === 0 ? 0 : same / total;
}
