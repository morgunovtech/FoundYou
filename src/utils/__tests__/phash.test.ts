import { describe, expect, it } from 'vitest';
import { PHASH_BITS, hammingDistance, luminance, phashFromPixels } from '../phash';

const SIZE = 32;

/** 32×32 RGBA from a per-pixel grey function. */
function pixels(grey: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = Math.max(0, Math.min(255, Math.round(grey(x, y))));
      const p = (y * SIZE + x) * 4;
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return out;
}

/**
 * What the browser does before hashing: a large picture (here 256×256, `grey` sampled per
 * source pixel) box-filtered down to 32×32. Per-pixel noise averages out on the way.
 */
function downscaled(grey: (x: number, y: number) => number, source = 256): Uint8ClampedArray {
  const block = source / SIZE;
  return pixels((x, y) => {
    let sum = 0;
    for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) sum += grey(x * block + dx, y * block + dy);
    return sum / (block * block);
  });
}

describe('phashFromPixels', () => {
  it('is 64 bits as 16 hex characters, and a flat image hashes to zero', () => {
    const hash = phashFromPixels(
      pixels(() => 128),
      SIZE,
      SIZE
    );
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe('0000000000000000');
    expect(PHASH_BITS).toBe(64);
  });

  it('survives noise and a brightness shift, separates different pictures', () => {
    // A 256×256 random low-pass texture with a 1/f spectrum across the whole 8×8 band the
    // hash looks at, like a real photo: every coefficient the hash thresholds carries energy.
    const field = (signs: (u: number, v: number) => number) => (x: number, y: number) => {
      let value = 110;
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          if (u === 0 && v === 0) continue;
          value +=
            ((8 * signs(u, v)) / (1 + u + v)) *
            Math.cos((Math.PI * u * (x + 0.5)) / 256) *
            Math.cos((Math.PI * v * (y + 0.5)) / 256);
        }
      }
      return value;
    };
    const scene = field((u, v) => ((u * 7 + v * 3) % 5 < 2 ? -1 : 1));
    const base = phashFromPixels(downscaled(scene), SIZE, SIZE);
    let seed = 7;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed % 41) - 20;
    };
    const noisy = phashFromPixels(
      downscaled((x, y) => scene(x, y) + noise()),
      SIZE,
      SIZE
    );
    const brighter = phashFromPixels(
      downscaled((x, y) => scene(x, y) + 30),
      SIZE,
      SIZE
    );
    const other = phashFromPixels(downscaled(field((u, v) => ((u * 3 + v * 5) % 7 < 3 ? -1 : 1))), SIZE, SIZE);
    expect(hammingDistance(base, noisy)!).toBeLessThanOrEqual(6);
    expect(hammingDistance(base, brighter)).toBe(0);
    expect(hammingDistance(base, other)!).toBeGreaterThan(16);
  });

  it('rejects the wrong grid size', () => {
    expect(() => luminance(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toThrow();
  });
});

describe('hammingDistance', () => {
  it('counts differing bits of equal-length hex strings', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('00', '0f')).toBe(4);
    expect(hammingDistance('00', '000')).toBeNull();
    expect(hammingDistance('zz', '00')).toBeNull();
    expect(hammingDistance('', '')).toBeNull();
  });
});
