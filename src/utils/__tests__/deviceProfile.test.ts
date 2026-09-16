import { describe, expect, it } from 'vitest';
import {
  buildDeviceProfile,
  cameraModule,
  detectFirmware,
  detectOs,
  displayMake,
  monthsSince,
  resolveModel,
  samsungBuildDate
} from '../deviceProfile';
import type { FilenameAnalysis } from '../heuristics/filenameAnalyzer';
import type { ResolutionAnalysis } from '../heuristics/resolutionAnalyzer';

const NOW = new Date('2026-09-16T12:00:00Z');
const NO_FILENAME: FilenameAnalysis = {
  platform: null,
  device: '',
  confidence: 0,
  photoIndex: null,
  estimatedMonths: null
};
const IPHONE_FILENAME: FilenameAnalysis = {
  platform: 'Apple iOS',
  device: 'iPhone',
  confidence: 0.9,
  photoIndex: 8215,
  estimatedMonths: 55
};
const NO_RES: ResolutionAnalysis = {
  possibleDevices: [],
  contentType: 'unknown',
  contentHint: '',
  isScreenshot: false
};
const IPHONE_RES: ResolutionAnalysis = {
  possibleDevices: ['iPhone 12/13/14/15'],
  contentType: 'standard_photo',
  contentHint: '4:3',
  isScreenshot: false
};

describe('displayMake', () => {
  it('normalises the EXIF Make tag', () => {
    expect(displayMake('Apple')).toBe('Apple');
    expect(displayMake('samsung')).toBe('Samsung');
    expect(displayMake('NIKON CORPORATION')).toBe('Nikon');
    expect(displayMake('OM Digital Solutions')).toBe('OM System');
    expect(displayMake('Acme Cameras')).toBe('Acme Cameras');
    expect(displayMake('  ')).toBeNull();
    expect(displayMake(undefined)).toBeNull();
  });
});

describe('resolveModel', () => {
  it('knows iPhone and Pixel launch months by marketing name', () => {
    expect(resolveModel('Apple', 'iPhone 15 Pro Max')).toEqual({ name: 'iPhone 15 Pro Max', released: '2023-09' });
    expect(resolveModel('Apple', 'iPhone SE (3rd generation)')).toEqual({
      name: 'iPhone SE (3rd generation)',
      released: '2022-03'
    });
    expect(resolveModel('Google', 'Pixel 8 Pro')).toEqual({ name: 'Pixel 8 Pro', released: '2023-10' });
    expect(resolveModel('Apple', 'iPhone 99')).toEqual({ name: 'iPhone 99', released: null });
  });
  it('turns a Samsung code into the marketing name, with the lens tag as a fallback', () => {
    expect(resolveModel('Samsung', 'SM-S918B')).toEqual({ name: 'Galaxy S23 Ultra', released: '2023-02' });
    expect(resolveModel('Samsung', 'SM-F966U')).toEqual({ name: 'Galaxy Z Fold7', released: '2025-07' });
    expect(resolveModel('Samsung', 'SM-X999', 'Samsung Galaxy Tab Q Rear Camera')).toEqual({
      name: 'Galaxy Tab Q',
      released: null
    });
    expect(resolveModel('Samsung', 'SM-X999')).toEqual({ name: 'SM-X999', released: null });
  });
  it('knows a few Huawei codes and leaves other makers as written', () => {
    expect(resolveModel('Huawei', 'ELS-NX9')).toEqual({ name: 'P40 Pro', released: '2020-03' });
    expect(resolveModel('Sony', 'ILCE-7M4')).toEqual({ name: 'ILCE-7M4', released: null });
  });
});

describe('detectOs', () => {
  it('reads the iOS version Apple writes into Software and compares it with the shot month', () => {
    expect(detectOs('Apple', 'iPhone 15 Pro Max', '26.2', '2026-08')).toEqual({
      name: 'iOS',
      version: '26.2',
      major: 26,
      familyReleased: '2025-09',
      newerAtShot: null
    });
    expect(detectOs('Apple', 'iPhone 13', '17.5.1', '2026-08')).toMatchObject({
      major: 17,
      newerAtShot: { name: 'iOS', major: 26 }
    });
    expect(detectOs('Apple', 'iPad Pro', '18.0', null)).toMatchObject({ name: 'iPadOS', newerAtShot: null });
  });
  it('is conservative in the launch month itself', () => {
    // iOS 26 shipped in 2025-09: a photo from that month on iOS 18 is not called outdated.
    expect(detectOs('Apple', 'iPhone 15', '18.6', '2025-09')?.newerAtShot).toBeNull();
    expect(detectOs('Apple', 'iPhone 15', '18.6', '2025-10')?.newerAtShot).toEqual({ name: 'iOS', major: 26 });
  });
  it('reads an Android version when a vendor writes one, and nothing otherwise', () => {
    expect(detectOs('Xiaomi', '2210132G', 'Android 14', '2025-01')).toMatchObject({
      name: 'Android',
      version: '14',
      major: 14
    });
    expect(detectOs('Samsung', 'SM-S918B', 'S918BXXS4BXA1', '2026-06')).toBeNull();
    expect(detectOs('Apple', 'iPhone 15', 'Adobe Lightroom 9.1 (iOS)', '2026-06')).toBeNull();
    expect(detectOs('Apple', 'iPhone 15', '', '2026-06')).toBeNull();
  });
});

describe('firmware builds', () => {
  it('reads the build month out of a Samsung build id', () => {
    expect(samsungBuildDate('S918BXXS4BXA1')).toBe('2024-01');
    expect(samsungBuildDate('G930FXXU1APB6')).toBe('2016-02');
    expect(samsungBuildDate('S928BXXU1AXA8')).toBe('2024-01');
    expect(samsungBuildDate('Samsung Gallery')).toBeNull();
  });
  it('recognises Samsung and Huawei builds, not editors or OS versions', () => {
    expect(detectFirmware('Samsung', 'S918BXXS4BXA1')).toEqual({ build: 'S918BXXS4BXA1', built: '2024-01' });
    expect(detectFirmware('Huawei', 'ELS-NX9 10.1.0.155(C10E4R3P3)')).toEqual({
      build: 'ELS-NX9 10.1.0.155(C10E4R3P3)',
      built: null
    });
    expect(detectFirmware('Samsung', 'Samsung Gallery')).toBeNull();
    expect(detectFirmware('Apple', '26.2')).toBeNull();
  });
});

describe('cameraModule / monthsSince', () => {
  it('picks the module from the 35 mm focal length, then from the lens name', () => {
    expect(cameraModule('rear', 13)).toBe('ultrawide');
    expect(cameraModule('rear', 24)).toBe('main');
    expect(cameraModule('rear', 120)).toBe('tele');
    expect(cameraModule('rear', undefined, 'iPhone 11 back dual wide camera 4.25mm f/1.8')).toBe('main');
    expect(cameraModule('rear', undefined, 'back telephoto camera')).toBe('tele');
    expect(cameraModule('front', 26)).toBeNull();
    expect(cameraModule('unknown', undefined, undefined)).toBeNull();
  });
  it('counts whole months from the launch month', () => {
    expect(monthsSince('2023-09', new Date('2026-08-16T10:26:00Z'))).toBe(35);
    expect(monthsSince('2023-09', new Date('2023-09-30T00:00:00Z'))).toBe(0);
    expect(monthsSince('2026-02', new Date('2025-12-01T00:00:00Z'))).toBeNull();
    expect(monthsSince('nope', NOW)).toBeNull();
  });
});

describe('buildDeviceProfile', () => {
  it('assembles the Apple card: maker, model, iOS, launch, age at the shot, camera, counter', () => {
    const profile = buildDeviceProfile({
      metadata: {
        cameraMake: 'Apple',
        cameraModel: 'iPhone 15 Pro Max',
        lensModel: 'iPhone 15 Pro Max back triple camera 6.765mm f/1.78',
        software: '26.2',
        focalLength35mm: 24,
        aperture: 1.78,
        shotDateLocal: '2026-08-16T10:26:00'
      },
      filename: IPHONE_FILENAME,
      resolution: IPHONE_RES,
      now: NOW
    });
    expect(profile).toEqual({
      source: 'exif',
      make: 'Apple',
      model: 'iPhone 15 Pro Max',
      modelCode: null,
      os: { name: 'iOS', version: '26.2', major: 26, familyReleased: '2025-09', newerAtShot: null },
      firmware: null,
      released: '2023-09',
      ageAtShotMonths: 35,
      ageNowMonths: 36,
      camera: { side: 'rear', module: 'main', focalLength35mm: 24, aperture: 1.78 },
      shotIndex: 8215
    });
  });

  it('assembles the Samsung card from the code, the lens tag and the firmware build', () => {
    const profile = buildDeviceProfile({
      metadata: {
        cameraMake: 'samsung',
        cameraModel: 'SM-S918B',
        lensModel: 'Samsung Galaxy S23 Ultra Rear Camera',
        software: 'S918BXXS4BXA1',
        focalLength35mm: 24,
        aperture: 1.8,
        shotDateLocal: '2026-06-14T18:30:12'
      },
      filename: NO_FILENAME,
      resolution: NO_RES,
      now: NOW
    });
    expect(profile).toMatchObject({
      source: 'exif',
      make: 'Samsung',
      model: 'Galaxy S23 Ultra',
      modelCode: 'SM-S918B',
      os: null,
      firmware: { build: 'S918BXXS4BXA1', built: '2024-01' },
      released: '2023-02',
      ageAtShotMonths: 40,
      camera: { side: 'rear', module: 'main' },
      shotIndex: null
    });
  });

  it('falls back to the filename, then the resolution, and gives up without any signal', () => {
    expect(
      buildDeviceProfile({ metadata: null, filename: IPHONE_FILENAME, resolution: IPHONE_RES, now: NOW })
    ).toMatchObject({
      source: 'filename',
      make: null,
      model: 'iPhone',
      os: null,
      released: null,
      shotIndex: 8215
    });
    expect(
      buildDeviceProfile({ metadata: null, filename: NO_FILENAME, resolution: IPHONE_RES, now: NOW })
    ).toMatchObject({
      source: 'resolution',
      model: 'iPhone 12/13/14/15'
    });
    // An empty model tag is not a device either.
    expect(
      buildDeviceProfile({ metadata: { cameraModel: '  ' }, filename: NO_FILENAME, resolution: NO_RES, now: NOW })
    ).toBeNull();
  });

  it('leaves the camera row out when no lens data was written', () => {
    const profile = buildDeviceProfile({
      metadata: { cameraMake: 'Sony', cameraModel: 'ILCE-7M4' },
      filename: null,
      resolution: null,
      now: NOW
    });
    expect(profile).toMatchObject({
      make: 'Sony',
      model: 'ILCE-7M4',
      camera: null,
      released: null,
      ageNowMonths: null
    });
  });
});
