import { describe, expect, it } from 'vitest';
import { analyzeResolution } from '../heuristics/resolutionAnalyzer';

type Lang = 'ru' | 'en' | 'uz';
const LANGS: Lang[] = ['ru', 'en', 'uz'];

describe('analyzeResolution: table', () => {
  it.each<[number, number, string[], string, boolean]>([
    // phone cameras
    [4032, 3024, ['iPhone 12/13/14/15'], 'standard_photo', false],
    [3024, 4032, ['iPhone (portrait)'], 'standard_photo', false],
    [4290, 2856, ['iPhone 15 Pro Max (48MP)'], 'dslr_photo', false],
    [3264, 2448, ['iPhone 6/7/8, iPad'], 'standard_photo', false],
    [4000, 3000, ['Samsung Galaxy S21/S22/S23'], 'standard_photo', false],
    [3000, 4000, ['Samsung Galaxy S21/S22/S23'], 'standard_photo', false], // flipped lookup
    [4080, 3072, ['Google Pixel 7/8'], 'standard_photo', false],
    // desktop screenshots
    [1920, 1080, ['FullHD monitor'], 'video_frame', true],
    [1080, 1920, ['FullHD monitor'], 'video_frame', true], // 16:9 wins over the ~9:16 stories check
    [2560, 1440, ['QHD monitor / iMac 27"'], 'video_frame', true],
    [2880, 1800, ['MacBook Pro 15"/16" (Retina)'], 'unknown', true], // 16:10 has no label
    // phone screenshots
    [1170, 2532, ['iPhone 12/13/14'], 'stories', true],
    [2532, 1170, ['iPhone 12/13/14'], 'unknown', true], // landscape → not stories
    [1080, 2340, ['Xiaomi, Realme, Oppo'], 'stories', true],
    [1080, 2400, ['Samsung Galaxy S21/S22, OnePlus 9'], 'unknown', true], // 20:9 misses the ±0.2 window
    [750, 1334, ['iPhone 6/7/8/SE2/SE3'], 'video_frame', true],
    // unknown devices, ratio only
    [1080, 1080, [], 'social_crop', false],
    [1000, 1010, [], 'social_crop', false],
    [6000, 4000, [], 'dslr_photo', false],
    [800, 600, [], 'standard_photo', false],
    [1080, 2160, [], 'stories', false],
    [2160, 1080, [], 'unknown', false],
    [8000, 2000, [], 'panorama', false],
    [1234, 987, [], 'unknown', false], // odd crop
    [1500, 1000, [], 'dslr_photo', false],
    [0, 0, [], 'unknown', false]
  ])('%d×%d → %j / %s / screenshot=%s', (width, height, devices, contentType, isScreenshot) => {
    const result = analyzeResolution(width, height, 'en');
    expect(result.possibleDevices).toEqual(devices);
    expect(result.contentType).toBe(contentType);
    expect(result.isScreenshot).toBe(isScreenshot);
    // A hint exists exactly when the ratio was classified.
    expect(result.contentHint === '').toBe(contentType === 'unknown');
  });

  it('a known screenshot size is flagged even when the ratio is unclassified', () => {
    const result = analyzeResolution(1080, 2400, 'en');
    expect(result.isScreenshot).toBe(true);
    expect(result.contentType).toBe('unknown');
    expect(result.contentHint).toBe('');
  });

  it('a phone photo is never a screenshot', () => {
    expect(analyzeResolution(4032, 3024, 'en').isScreenshot).toBe(false);
    expect(analyzeResolution(4000, 3000, 'ru').isScreenshot).toBe(false);
  });
});

describe('analyzeResolution: languages', () => {
  it('devices and type are language independent, the hint is localised', () => {
    const results = LANGS.map((lang) => analyzeResolution(4032, 3024, lang));
    for (const result of results) {
      expect(result.possibleDevices).toEqual(['iPhone 12/13/14/15']);
      expect(result.contentType).toBe('standard_photo');
      expect(result.contentHint.length).toBeGreaterThan(0);
    }
    expect(results[0].contentHint).not.toBe(results[1].contentHint);
  });

  it.each(['social_crop', 'video_frame', 'stories', 'standard_photo', 'dslr_photo', 'panorama'])(
    'every language has a non-empty hint for %s',
    (contentType) => {
      const sample: Record<string, [number, number]> = {
        social_crop: [1000, 1000],
        video_frame: [1920, 1080],
        stories: [1080, 2160],
        standard_photo: [800, 600],
        dslr_photo: [1500, 1000],
        panorama: [3000, 1000]
      };
      const [width, height] = sample[contentType];
      for (const lang of LANGS) {
        const result = analyzeResolution(width, height, lang);
        expect(result.contentType).toBe(contentType);
        expect(result.contentHint.trim().length, `${contentType} (${lang})`).toBeGreaterThan(0);
      }
    }
  );
});
