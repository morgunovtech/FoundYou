import { describe, it, expect } from 'vitest';
import { measureFlatness, scoreScreenshot, type ScreenshotInput } from '../screenshot';

const photo: ScreenshotInput = {
  filenameScreenshot: false,
  knownScreenSize: false,
  hasCameraExif: true,
  hasShotDate: true,
  mimeType: 'image/jpeg',
  flatRatio: 0.03
};

describe('scoreScreenshot', () => {
  it('rules out a camera photo with EXIF and sensor noise', () => {
    const score = scoreScreenshot(photo);
    expect(score.level).toBe('unlikely');
    expect(score.probability).toBeLessThan(0.02);
    expect(score.reasons).toEqual(['camera-exif', 'photo-pixels']);
  });

  it('is certain about a PNG named like a screenshot at a phone size with flat pixels', () => {
    const score = scoreScreenshot({
      filenameScreenshot: true,
      knownScreenSize: true,
      hasCameraExif: false,
      hasShotDate: false,
      mimeType: 'image/png',
      flatRatio: 0.8
    });
    expect(score.level).toBe('certain');
    expect(score.probability).toBeGreaterThan(0.99);
    expect(score.reasons).toEqual(['filename', 'screen-size', 'no-camera-exif', 'png', 'flat-pixels']);
  });

  it('calls a renamed JPEG screenshot likely from the size and the flat pixels alone', () => {
    const score = scoreScreenshot({
      filenameScreenshot: false,
      knownScreenSize: true,
      hasCameraExif: false,
      hasShotDate: false,
      mimeType: 'image/jpeg',
      flatRatio: 0.6
    });
    expect(score.level).toBe('certain');
    expect(score.reasons).toEqual(['screen-size', 'no-camera-exif', 'flat-pixels']);
  });

  it('stays at «possible» for a stripped photo of unknown size with mixed pixels', () => {
    const score = scoreScreenshot({
      filenameScreenshot: false,
      knownScreenSize: false,
      hasCameraExif: false,
      hasShotDate: false,
      mimeType: 'image/jpeg',
      flatRatio: 0.35
    });
    expect(score.level).toBe('possible');
  });

  it('works without a pixel measure', () => {
    expect(scoreScreenshot({ ...photo, flatRatio: null }).reasons).toEqual(['camera-exif']);
  });
});

describe('measureFlatness', () => {
  function image(
    width: number,
    height: number,
    pixel: (x: number, y: number) => [number, number, number]
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = pixel(x, y);
        const i = (y * width + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    return data;
  }

  it('reads a flat interface as ~1 and noise as ~0', () => {
    expect(
      measureFlatness(
        image(40, 10, () => [240, 240, 240]),
        40,
        10
      )
    ).toBe(1);
    let seed = 7;
    const noise = () => {
      seed = (seed * 48271) % 2147483647;
      return seed % 256;
    };
    expect(
      measureFlatness(
        image(40, 10, () => [noise(), noise(), noise()]),
        40,
        10
      )
    ).toBeLessThan(0.05);
  });

  it('counts a half-flat, half-noisy frame in between', () => {
    let seed = 3;
    const noise = () => {
      seed = (seed * 48271) % 2147483647;
      return seed % 256;
    };
    const ratio = measureFlatness(
      image(40, 10, (x) => (x < 20 ? [10, 20, 30] : [noise(), noise(), noise()])),
      40,
      10
    );
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });
});
