import { describe, it, expect } from 'vitest';
import {
  findDips,
  hotBlocks,
  judgeGhosts,
  judgeNoise,
  noiseBlocks,
  textureGroups,
  type GhostPoint
} from '../frameChecks';

const curve = (errors: number[]): GhostPoint[] => errors.map((error, i) => ({ quality: 40 + i * 2, error }));

describe('findDips', () => {
  // A smooth, convex, falling trend from 40 to 100, as a picture with no JPEG history gives.
  const trend = Array.from({ length: 31 }, (_, i) => 9 * Math.pow(0.93, i));

  it('finds the single dip of a once-saved picture', () => {
    const errors = trend.map((e, i) => (i === 18 ? e * 0.4 : e)); // q = 76
    expect(findDips(curve(errors))).toEqual([76]);
  });

  it('finds a dip that lands between two grid steps (quality 85 → 84 and 86)', () => {
    const errors = trend.map((e, i) => (i === 22 ? e * 0.5 : i === 23 ? e * 0.55 : e));
    expect(findDips(curve(errors))).toEqual([84]);
  });

  it('ignores a harmonic dip that is not below the curve two steps away, and the convex tail', () => {
    // A real dip at 74 and libjpeg's harmonic at 88 that only dips against its immediate neighbours.
    const errors = trend.map((e, i) => (i === 17 ? e * 0.2 : i === 24 ? e * 0.95 : e));
    expect(findDips(curve(errors))).toEqual([74]);
    expect(findDips(curve(trend))).toEqual([]);
    expect(findDips(curve([1, 2, 3]))).toEqual([]);
  });
});

describe('judgeGhosts', () => {
  const jpeg = (currentQuality: number | null) => ({ currentQuality, isJpeg: true, hasGrain: true });

  it('reads one dip at the file quality as a single save and a lower dip as a second save', () => {
    expect(judgeGhosts([74], jpeg(75))).toBe('single');
    expect(judgeGhosts([84], jpeg(95))).toBe('double');
    expect(judgeGhosts([84, 92], jpeg(92))).toBe('double');
    expect(judgeGhosts([92], jpeg(92))).toBe('single');
    expect(judgeGhosts([74], jpeg(null))).toBe('single');
  });

  it('names a JPEG past inside a PNG, no dips as none, and no grain as unreliable', () => {
    expect(judgeGhosts([74], { currentQuality: null, isJpeg: false, hasGrain: true })).toBe('jpeg-inside');
    expect(judgeGhosts([], jpeg(90))).toBe('none');
    expect(judgeGhosts([64], { currentQuality: null, isJpeg: false, hasGrain: false })).toBe('unreliable');
  });
});

describe('textureGroups / hotBlocks', () => {
  it('splits blocks into six texture groups by rank', () => {
    const groups = textureGroups([5, 1, 9, 3, 7, 11, 2, 8, 4, 6, 10, 12]);
    expect(groups[1]).toBe(0); // the smallest texture
    expect(groups[11]).toBe(5); // the largest
    expect(new Set(groups).size).toBe(6);
  });

  it('does not call edges hot when they are compared with other edges', () => {
    // 100 blocks: half smooth (error 3), half edgy (error 30): a normal photo.
    const errors = [...Array(50).fill(3), ...Array(50).fill(30)];
    const texture = [...Array(50).fill(2), ...Array(50).fill(20)];
    const hot = hotBlocks(errors, texture);
    expect(hot.hotBlocks).toBe(0);
    expect(hot.ratio).toBeLessThan(1.5);
  });

  it('flags a pasted patch that is far brighter than blocks of the same texture', () => {
    const errors = [...Array(50).fill(3), ...Array(46).fill(30), 140, 150, 160, 150];
    const texture = [...Array(50).fill(2), ...Array(50).fill(20)];
    const hot = hotBlocks(errors, texture);
    expect(hot.hotBlocks).toBe(4);
    expect(hot.ratio).toBeGreaterThan(4);
    // Even when the patch is most of its texture group the 30th percentile stays with the rest.
    const patch = [...Array(50).fill(3), ...Array(40).fill(30), ...Array(10).fill(150)];
    expect(hotBlocks(patch, texture).hotBlocks).toBe(10);
  });

  it('leaves blocks that did not change at all out of the statistics', () => {
    expect(hotBlocks([0, 0, 0, 0, 6, 6, 6, 6], [1, 1, 1, 1, 1, 1, 1, 1]).active).toBe(4);
    expect(hotBlocks([], []).ratio).toBe(1);
  });
});

describe('noiseBlocks / judgeNoise', () => {
  function plane(width: number, height: number, f: (x: number, y: number) => number): Float32Array {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = f(x, y);
    return out;
  }
  let seed = 11;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647 - 0.5;
  };

  it('measures grain and detail per block', () => {
    const grainy = plane(64, 64, () => 128 + rand() * 20);
    const blocks = noiseBlocks(grainy, 64, 64, 32);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].noise).toBeGreaterThan(0.8);
    const flat = noiseBlocks(
      plane(64, 64, () => 128),
      64,
      64,
      32
    );
    expect(flat[0]).toEqual({ noise: 0, texture: 0 });
  });

  it('calls uniform grain uniform and a patch with much coarser grain an outlier', () => {
    const uniform = plane(256, 256, () => 128 + rand() * 12);
    expect(judgeNoise(noiseBlocks(uniform, 256, 256, 32)).verdict).toBe('uniform');
    // The same fine grain everywhere except a 64×64 patch with five times coarser grain (a noisy paste).
    const patched = plane(256, 256, (x, y) => (x < 64 && y < 64 ? 128 + rand() * 60 : 128 + rand() * 12));
    const judged = judgeNoise(noiseBlocks(patched, 256, 256, 32));
    expect(judged.verdict).toBe('spots');
    expect(judged.outliers).toBe(4);
  });

  it('refuses to judge a picture with too few textured blocks', () => {
    const sky = plane(128, 128, (x) => 100 + x * 0.001);
    expect(judgeNoise(noiseBlocks(sky, 128, 128, 32)).verdict).toBe('flat');
  });
});
