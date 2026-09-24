import { describe, expect, it } from 'vitest';
import { judgeOrigin, type OriginInput } from '../originJudge';
import { analyzeFilename } from '../heuristics/filenameAnalyzer';
import { hasCameraExif } from '../heuristics/strippedDetector';
import type { CompressionVerdict } from '../jpegQuant';

const NOT_STRIPPED = { stripped: false, strippedBy: null, confidence: 0, evidence: [] };
const NOT_EDITED = { edited: false, editingLevel: 'none' as const, software: [], hints: [], aiScope: 'none' as const, aiTool: null, aiEvidence: null, aiDetails: null };

const libjpeg80: CompressionVerdict = { code: 'standard-medium', quality: 80, exact: true, subsampling: '4:2:0', conflict: 'apple-standard' };
const apple92: CompressionVerdict = { code: 'custom', quality: 92, exact: false, subsampling: '4:2:0', conflict: null };
const samsung95: CompressionVerdict = { code: 'standard-high', quality: 95, exact: true, subsampling: '4:2:0', conflict: null };

function input(overrides: Partial<OriginInput> & { name?: string } = {}): OriginInput {
  const { name = 'IMG_0001.JPG', ...rest } = overrides;
  return {
    mimeType: 'image/jpeg',
    width: 4032,
    height: 3024,
    hasCameraExif: true,
    filename: analyzeFilename(name, 'en'),
    stripped: NOT_STRIPPED,
    editing: NOT_EDITED,
    compression: null,
    livePhoto: false,
    motionPhoto: false,
    modifiedLater: false,
    resized: false,
    thumbnailDiffers: false,
    screenshotLikely: false,
    ...rest
  };
}

describe('judgeOrigin: the sample and the Telegram photo that used to contradict themselves', () => {
  it('Apple EXIF + libjpeg tables + Live Photo → written again, the marker listed but outvoted', () => {
    const verdict = judgeOrigin(input({ compression: libjpeg80, livePhoto: true }));
    expect(verdict.verdict).toBe('resaved');
    expect(verdict.confidence).toBe('medium');
    expect(verdict.reasons).toEqual(['camera-exif', 'libjpeg-tables-apple', 'live-photo']);
  });

  it('a Telegram file from macOS: no camera block, the name and the 1280 cap → messenger, confident', () => {
    const verdict = judgeOrigin(input({ name: 'photo_2022-03-08 13.33.59 2.jpeg', width: 853, height: 1280, hasCameraExif: false }));
    expect(verdict).toEqual({
      verdict: 'messenger',
      confidence: 'high',
      platforms: ['Telegram'],
      reasons: ['no-camera-exif', 'messenger-name', 'messenger-size', 'small-jpeg']
    });
  });

  it('the size alone names every service sharing the cap, with medium confidence', () => {
    const verdict = judgeOrigin(input({ name: 'holiday.jpg', width: 1280, height: 960, hasCameraExif: false }));
    expect(verdict.verdict).toBe('messenger');
    expect(verdict.confidence).toBe('medium');
    expect(verdict.platforms).toEqual(['Telegram', 'Viber']);
  });
});

describe('judgeOrigin: camera originals', () => {
  it('Apple EXIF + own tables + Live Photo → camera original, confident', () => {
    const verdict = judgeOrigin(input({ compression: apple92, livePhoto: true }));
    expect(verdict).toEqual({ verdict: 'camera-original', confidence: 'high', platforms: [], reasons: ['camera-exif', 'own-tables', 'live-photo'] });
  });

  it('a Samsung original with libjpeg tables at 95 and nothing else → camera original, most likely', () => {
    const verdict = judgeOrigin(input({ compression: samsung95 }));
    expect(verdict).toEqual({ verdict: 'camera-original', confidence: 'medium', platforms: [], reasons: ['camera-exif'] });
  });

  it('two negative signs make the re-save confident', () => {
    const verdict = judgeOrigin(input({ compression: samsung95, modifiedLater: true, resized: true }));
    expect(verdict.verdict).toBe('resaved');
    expect(verdict.confidence).toBe('high');
    expect(verdict.reasons).toEqual(['camera-exif', 'modify-date', 'resized']);
  });
});

describe('judgeOrigin: the rest', () => {
  it('a screenshot is a screenshot whatever else the file says', () => {
    expect(judgeOrigin(input({ screenshotLikely: true, compression: libjpeg80 }))).toEqual({
      verdict: 'screenshot',
      confidence: 'high',
      platforms: [],
      reasons: ['screenshot']
    });
  });

  it('a JPEG without a camera block, no name, no cap → stripped by something unnamed', () => {
    const verdict = judgeOrigin(input({ name: 'export.jpg', width: 2048, height: 1536, hasCameraExif: false }));
    expect(verdict.verdict).toBe('stripped');
    expect(verdict.confidence).toBe('low');
    expect(verdict.reasons).toEqual(['no-camera-exif']);
  });

  it('a PNG had no EXIF to lose: unknown, unless a messenger name says otherwise', () => {
    expect(judgeOrigin(input({ mimeType: 'image/png', name: 'chart.png', hasCameraExif: false })).verdict).toBe('unknown');
    const named = judgeOrigin(input({ mimeType: 'image/webp', name: 'WhatsApp Image 2026-01-02 at 10.00.00.webp', hasCameraExif: false }));
    expect(named.verdict).toBe('messenger');
    expect(named.platforms).toEqual(['WhatsApp']);
  });
});

describe('hasCameraExif', () => {
  it('the six-field resolution stub a re-encoder leaves is not a camera block', () => {
    expect(hasCameraExif({ XResolution: 72, YResolution: 72, ResolutionUnit: 2, ColorSpace: 1, ExifImageWidth: 853, ExifImageHeight: 1280 })).toBe(false);
  });

  it('a maker, a model or a shot date is', () => {
    expect(hasCameraExif({ Make: 'Apple' })).toBe(true);
    expect(hasCameraExif({ DateTimeOriginal: new Date() })).toBe(true);
    expect(hasCameraExif({ model: 'iPhone' })).toBe(true);
    expect(hasCameraExif({ Make: '' })).toBe(false);
    expect(hasCameraExif(null)).toBe(false);
  });
});
