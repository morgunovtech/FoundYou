import { describe, it, expect } from 'vitest';
import { extrapolateSize, sampleWindows } from '../sizeEstimate';

describe('sampleWindows', () => {
  it('spreads a 2×2 grid over the picture and keeps every window inside it', () => {
    const windows = sampleWindows(4000, 3000, 1024);
    expect(windows).toHaveLength(4);
    for (const { sx, sy } of windows) {
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx + 1024).toBeLessThanOrEqual(4000);
      expect(sy + 1024).toBeLessThanOrEqual(3000);
    }
    // Two distinct columns and two distinct rows: not four samples of the same spot.
    expect(new Set(windows.map((w) => w.sx)).size).toBe(2);
    expect(new Set(windows.map((w) => w.sy)).size).toBe(2);
  });

  it('collapses to the origin when the window is as large as the picture', () => {
    expect(sampleWindows(800, 600, 800)).toEqual([
      { sx: 0, sy: 0 },
      { sx: 0, sy: 0 },
      { sx: 0, sy: 0 },
      { sx: 0, sy: 0 }
    ]);
  });

  it('takes a single window when asked for a 1×1 grid', () => {
    expect(sampleWindows(4000, 3000, 1024, 1)).toEqual([{ sx: 1488, sy: 988 }]);
  });
});

describe('extrapolateSize', () => {
  it('scales the sampled bytes by the pixel count, not by the area of the preview', () => {
    // 4 windows of 1024², 300 KB in total, for a 12 MP export.
    const pixels = 4 * 1024 * 1024;
    expect(extrapolateSize(300_000, pixels, 4000 * 3000)).toBe(Math.round((300_000 / pixels) * 12_000_000));
  });

  it('returns 0 rather than dividing by zero when nothing was sampled', () => {
    expect(extrapolateSize(1000, 0, 12_000_000)).toBe(0);
  });
});
