import { describe, expect, it } from 'vitest';
import { analyzeFilename } from '../heuristics/filenameAnalyzer';

type Lang = 'ru' | 'en' | 'uz';
const LANGS: Lang[] = ['ru', 'en', 'uz'];

const UNKNOWN = { platform: null, device: '', confidence: 0, photoIndex: null, estimatedMonths: null, isScreenshot: false };

describe('analyzeFilename: platform table', () => {
  it.each<[string, string, number]>([
    // Android vendors
    ['IMG_20240614_183012.jpg', 'Android', 0.6],
    ['IMG_20240614_183012_001.jpg', 'Android', 0.65],
    ['PXL_20240614_183012123.jpg', 'Android', 0.95],
    ['PXL_20240614_183012123.MP.jpg', 'Android', 0.95],
    ['20240614_183012.jpg', 'Android', 0.7],
    ['SAMSUNG_CAMERA_PICTURES.jpg', 'Android', 0.95],
    ['Screenshot_2024-06-14-18-30-12-123_org.telegram.messenger.png', 'Android', 0.95],
    // Apple
    ['IMG_1234.HEIC', 'Apple iOS', 0.9],
    ['IMG_1234.JPG', 'Apple iOS', 0.9],
    ['IMG_1234.MOV', 'Apple iOS', 0.9],
    ['img_1234.heic', 'Apple iOS', 0.9],
    ['IMG_1234 (1).JPG', 'Apple iOS', 0.85],
    ['IMG_1234(2).jpeg', 'Apple iOS', 0.85],
    ['IMG_1234.PNG', 'Apple iOS', 0.8],
    ['Live Photo.HEIC', 'Apple iOS', 0.95],
    ['Screenshot 2024-06-14 at 18.30.12.png', 'Apple macOS', 0.95],
    ['Screen Shot 2024-06-14 at 18.30.12.png', 'Apple macOS', 0.9],
    ['Снимок экрана 2024-06-14 в 18.30.12.png', 'Desktop', 0.9],
    // Cameras
    ['DSC01234.ARW', 'Camera', 0.85],
    ['DSC01234.JPG', 'Camera', 0.85],
    ['DSC_1234.NEF', 'Camera', 0.9],
    ['DSC_12345.JPG', 'Camera', 0.9],
    ['_DSC1234.ARW', 'Camera', 0.9],
    ['IMG_1234.CR2', 'Camera', 0.95],
    ['IMG_12345.CR3', 'Camera', 0.95],
    ['GOPR0001.JPG', 'Camera', 0.95],
    ['GX010001.MP4', 'Camera', 0.9],
    ['DJI_0001.JPG', 'Drone', 0.95],
    // Messengers
    ['photo_2024-06-14_18-30-12.jpg', 'Telegram', 0.95],
    ['signal-2024-06-14-183012.jpg', 'Signal', 0.95],
    ['received_123.jpeg', 'Facebook Messenger', 0.9],
    ['received_1234567890123456.jpeg', 'Facebook Messenger', 0.9],
    ['WhatsApp Image 2024-06-14 at 18.30.12.jpeg', 'WhatsApp', 0.95],
    ['viber_image_2024-06-14_18-30-12.jpg', 'Viber', 0.9]
  ])('%s → %s (%d)', (filename, platform, confidence) => {
    const result = analyzeFilename(filename, 'en');
    expect(result.platform).toBe(platform);
    expect(result.confidence).toBe(confidence);
    expect(result.device).not.toBe('');
  });

  it.each([
    'vacation.jpg',
    'a8f3c2d1.png',
    'image (3).jpeg',
    'IMG_123.JPG', // three digits
    'IMG_1234.TIFF', // extension not in the Apple list
    'DSC1234.JPG', // DSCnnnnn needs five digits, DSC_ needs the underscore
    'received_123.jpg', // Messenger writes .jpeg
    'photo_2024-06-14.jpg', // Telegram always has the time part
    ''
  ])('%j → unknown', (filename) => {
    expect(analyzeFilename(filename, 'en')).toEqual(UNKNOWN);
  });
});

describe('analyzeFilename: photo index estimate', () => {
  it.each<[string, number | null, number | null]>([
    ['IMG_1234.HEIC', 1234, 8], // 1234 / 5 per day ≈ 247 days ≈ 8 months
    ['IMG_0042.JPG', 42, 1], // never below one month
    ['IMG_12345.CR3', 12345, 82],
    ['DSC_1234.NEF', 1234, 8],
    ['DSC01234.ARW', 1234, 8], // leading zero is dropped by parseInt
    ['_DSC9999.ARW', 9999, 67],
    ['IMG_0000.JPG', null, null], // a zero counter carries no information
    ['photo_2024-06-14_18-30-12.jpg', null, null],
    ['PXL_20240614_183012123.jpg', null, null],
    ['GOPR0001.JPG', null, null]
  ])('%s → index %j, ~%j months', (filename, photoIndex, estimatedMonths) => {
    const result = analyzeFilename(filename, 'en');
    expect(result.photoIndex).toBe(photoIndex);
    expect(result.estimatedMonths).toBe(estimatedMonths);
  });

  it('does not estimate for unknown names even when digits are present', () => {
    expect(analyzeFilename('holiday_1234.jpg', 'en').photoIndex).toBeNull();
  });

  it('date-stamped Android names carry no shot counter', () => {
    const result = analyzeFilename('IMG_20240614_183012.jpg', 'en');
    expect(result.platform).toBe('Android');
    expect(result.photoIndex).toBeNull();
    expect(result.estimatedMonths).toBeNull();
    expect(analyzeFilename('IMG_20240614_183012_001.jpg', 'en').photoIndex).toBeNull();
  });

  it('the counter survives an AirDrop duplicate suffix', () => {
    expect(analyzeFilename('IMG_1234 (1).JPG', 'en').photoIndex).toBe(1234);
    expect(analyzeFilename('IMG_1234(2).jpeg', 'en').photoIndex).toBe(1234);
  });
});

describe('analyzeFilename: languages', () => {
  it('platform, confidence and index are language independent; device copy is localised', () => {
    const results = LANGS.map((lang) => analyzeFilename('photo_2024-06-14_18-30-12.jpg', lang));
    for (const result of results) {
      expect(result.platform).toBe('Telegram');
      expect(result.confidence).toBe(0.95);
      expect(result.photoIndex).toBeNull();
      expect(typeof result.device).toBe('string');
      expect(result.device.length).toBeGreaterThan(0);
    }
    expect(new Set(results.map((result) => result.device)).size).toBe(3);
  });

  it('brand names stay the same in every language', () => {
    const devices = new Set(LANGS.map((lang) => analyzeFilename('IMG_1234.HEIC', lang).device));
    expect(devices.size).toBe(1);
  });

  it('every pattern has a non-empty device label in every language', () => {
    const samples = [
      'IMG_20240614_183012.jpg',
      'IMG_1234.HEIC',
      'IMG_1234 (1).JPG',
      'IMG_1234.PNG',
      'Live Photo.HEIC',
      'PXL_20240614_183012123.jpg',
      '20240614_183012.jpg',
      'SAMSUNG_1.jpg',
      'IMG_20240614_183012_001.jpg',
      'DSC01234.ARW',
      'DSC_1234.NEF',
      '_DSC1234.ARW',
      'IMG_1234.CR2',
      'GOPR0001.JPG',
      'GX010001.MP4',
      'DJI_0001.JPG',
      'Screenshot_2024-06-14.png',
      'Screenshot 2024-06-14 at 1.png',
      'Снимок экрана.png',
      'Screen Shot 1.png',
      'photo_2024-06-14_18-30-12.jpg',
      'signal-2024-06-14-1.jpg',
      'received_1.jpeg',
      'WhatsApp Image 2024-06-14 at 1.jpeg',
      'viber_image_1.jpg'
    ];
    for (const sample of samples) {
      for (const lang of LANGS) {
        const result = analyzeFilename(sample, lang);
        expect(result.platform, `${sample} (${lang})`).not.toBeNull();
        expect(result.device.trim().length, `${sample} (${lang})`).toBeGreaterThan(0);
      }
    }
  });
});
