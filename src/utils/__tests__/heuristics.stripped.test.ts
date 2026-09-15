import { describe, expect, it } from 'vitest';
import { analyzeFilename } from '../heuristics/filenameAnalyzer';
import { detectStrippedMetadata } from '../heuristics/strippedDetector';

type Lang = 'ru' | 'en' | 'uz';
const LANGS: Lang[] = ['ru', 'en', 'uz'];

type Input = Parameters<typeof detectStrippedMetadata>[0];

function input(filename: string, overrides: Partial<Input> = {}): Input {
  return {
    filename,
    filenameAnalysis: analyzeFilename(filename, overrides.lang ?? 'en'),
    mimeType: 'image/jpeg',
    width: 1280,
    height: 960,
    hasExif: false,
    hasSoftwareTag: false,
    lang: 'en',
    ...overrides
  };
}

const NOT_STRIPPED = { stripped: false, strippedBy: null, confidence: 0, evidence: [] };

describe('detectStrippedMetadata: messenger re-saves', () => {
  it('Telegram name + no EXIF + small JPEG → stripped by Telegram with three signs', () => {
    const result = detectStrippedMetadata(input('photo_2024-06-14_18-30-12.jpg'));
    expect(result.stripped).toBe(true);
    expect(result.strippedBy).toBe('Telegram');
    expect(result.confidence).toBe(0.85);
    expect(result.evidence).toHaveLength(3); // high-res JPEG w/o EXIF, messenger name, low resolution
  });

  it('Messenger name + no EXIF + full-size JPEG → two signs (no low-res)', () => {
    const result = detectStrippedMetadata(input('received_123.jpeg', { width: 2048, height: 1536 }));
    expect(result.stripped).toBe(true);
    expect(result.strippedBy).toBe('Facebook Messenger');
    expect(result.confidence).toBe(0.85);
    expect(result.evidence).toHaveLength(2);
  });

  it.each([
    ['WhatsApp Image 2024-06-14 at 18.30.12.jpeg', 'WhatsApp'],
    ['signal-2024-06-14-183012.jpg', 'Signal'],
    ['viber_image_2024-06-14_18-30-12.jpg', 'Viber']
  ])('%s → stripped by %s', (filename, platform) => {
    const result = detectStrippedMetadata(input(filename, { width: 1600, height: 1200 }));
    expect(result.stripped).toBe(true);
    expect(result.strippedBy).toBe(platform);
    expect(result.confidence).toBe(0.85);
  });
});

describe('detectStrippedMetadata: not stripped', () => {
  it('EXIF present → never stripped, whatever the filename', () => {
    expect(detectStrippedMetadata(input('photo_2024-06-14_18-30-12.jpg', { hasExif: true }))).toEqual(NOT_STRIPPED);
    expect(detectStrippedMetadata(input('vacation.jpg', { hasExif: true, width: 4032, height: 3024 }))).toEqual(NOT_STRIPPED);
  });

  it('a Software tag alone also counts as metadata', () => {
    expect(detectStrippedMetadata(input('received_123.jpeg', { hasSoftwareTag: true }))).toEqual(NOT_STRIPPED);
  });

  it('a camera-named low-res JPEG without EXIF has no sign at all', () => {
    const result = detectStrippedMetadata(input('IMG_1234.JPG', { width: 640, height: 480 }));
    expect(result).toEqual(NOT_STRIPPED);
  });

  it('an iPhone screenshot PNG without EXIF is not stripped', () => {
    const result = detectStrippedMetadata(input('IMG_1234.PNG', { mimeType: 'image/png', width: 1170, height: 2532 }));
    expect(result).toEqual(NOT_STRIPPED);
  });
});

describe('detectStrippedMetadata: unknown origin', () => {
  it('random name + no EXIF + high-res JPEG → stripped, source unknown', () => {
    const result = detectStrippedMetadata(input('vacation.jpg', { width: 4032, height: 3024 }));
    expect(result.stripped).toBe(true);
    expect(result.strippedBy).toBeNull();
    expect(result.confidence).toBe(0.85);
    expect(result.evidence).toHaveLength(2); // high-res JPEG w/o EXIF + non-camera name
  });

  it('random-named PNG → only the filename sign, low confidence', () => {
    const result = detectStrippedMetadata(input('chart.png', { mimeType: 'image/png', width: 800, height: 600 }));
    expect(result.stripped).toBe(true);
    expect(result.strippedBy).toBeNull();
    expect(result.confidence).toBe(0.6);
    expect(result.evidence).toHaveLength(1);
  });

  it('image/jpg is treated like image/jpeg', () => {
    const result = detectStrippedMetadata(input('vacation.jpg', { mimeType: 'image/jpg', width: 1280, height: 960 }));
    expect(result.evidence).toHaveLength(3);
  });

  it('the low-resolution sign needs more than 0.5 MP', () => {
    // 0.48 MP → filename sign only
    expect(detectStrippedMetadata(input('x.jpg', { width: 800, height: 600 })).evidence).toHaveLength(1);
    // 0.79 MP, longest side ≤ 1600 → filename + low-res (but not "high-res JPEG": < 1 MP)
    const mid = detectStrippedMetadata(input('x.jpg', { width: 1024, height: 768 }));
    expect(mid.evidence).toHaveLength(2);
    expect(mid.confidence).toBe(0.85);
  });

  it('a camera-named high-res JPEG without EXIF is stripped by an unknown party, not "by Apple iOS"', () => {
    const result = detectStrippedMetadata(input('IMG_1234.JPG', { width: 4032, height: 3024 }));
    expect(result.stripped).toBe(true);
    expect(result.confidence).toBe(0.6);
    expect(result.evidence).toHaveLength(1);
    expect(result.strippedBy).toBeNull();
  });

  it.each(['PXL_20240614_183012123.jpg', 'DSC_1234.JPG', 'DJI_0001.JPG', '20240614_183012.jpg', 'Screenshot_2024-06-14-18-30-12.png'])(
    '%s: a camera / vendor platform is never named as the stripper',
    (filename) => {
      const result = detectStrippedMetadata(input(filename, { width: 4032, height: 3024 }));
      expect(result.strippedBy).toBeNull();
    }
  );
});

describe('detectStrippedMetadata: languages', () => {
  it('evidence is localised and non-empty; flags and counts do not depend on the language', () => {
    const results = LANGS.map((lang) => detectStrippedMetadata(input('photo_2024-06-14_18-30-12.jpg', { lang })));
    for (const result of results) {
      expect(result.stripped).toBe(true);
      expect(result.strippedBy).toBe('Telegram');
      expect(result.evidence).toHaveLength(3);
      for (const line of result.evidence) expect(line.trim().length).toBeGreaterThan(0);
    }
    expect(results[0].evidence[0]).not.toBe(results[1].evidence[0]);
    expect(results[1].evidence[0]).not.toBe(results[2].evidence[0]);
  });
});
