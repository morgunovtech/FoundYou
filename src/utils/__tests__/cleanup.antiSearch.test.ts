import { describe, expect, it } from 'vitest';
import {
  ANTI_SEARCH_MAX_AMPLITUDE,
  ANTI_SEARCH_MAX_ATTEMPTS,
  ANTI_SEARCH_MAX_CROP,
  ANTI_SEARCH_TARGET_BITS,
  antiSearchTargetBits,
  FIELD_GRID,
  generateAntiSearchParams,
  sampleField,
  shouldStrengthenAntiSearch,
  smoothField,
  smoothFieldGrid,
  strengthenAntiSearch
} from '../cleanup';

describe('smoothField', () => {
  it('is deterministic for a seed, normalised to [−1, 1] and smooth', () => {
    const a = smoothField(64, 48, 7);
    const b = smoothField(64, 48, 7);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(64 * 48);
    let max = 0;
    for (const v of a) max = Math.max(max, Math.abs(v));
    // The peak sits on the coarse grid; the sampled field reaches it within a bilinear step.
    expect(max).toBeGreaterThan(0.97);
    expect(max).toBeLessThanOrEqual(1);
    // Neighbouring cells differ by little: a field of broad patches, not noise.
    let jump = 0;
    for (let y = 0; y < 48; y++) for (let x = 1; x < 64; x++) jump = Math.max(jump, Math.abs(a[y * 64 + x] - a[y * 64 + x - 1]));
    expect(jump).toBeLessThan(0.15);
    expect(Array.from(smoothField(64, 48, 8))).not.toEqual(Array.from(a));
  });
});

describe('anti-search levels', () => {
  it('maps the three levels to hash-distance targets past the search threshold', () => {
    expect(antiSearchTargetBits(1)).toBe(10);
    expect(antiSearchTargetBits(2)).toBe(14);
    expect(antiSearchTargetBits(3)).toBe(18);
    expect(antiSearchTargetBits(0)).toBe(ANTI_SEARCH_TARGET_BITS[1]);
    expect(antiSearchTargetBits(9)).toBe(ANTI_SEARCH_TARGET_BITS[3]);
  });
  it('grows the field amplitude and the crop with the level', () => {
    const [one, two, three] = [1, 2, 3].map((level) => generateAntiSearchParams({ level }));
    expect(one.fieldAmplitude).toBeLessThan(two.fieldAmplitude);
    expect(two.fieldAmplitude).toBeLessThan(three.fieldAmplitude);
    expect(one.cropPercent).toBeLessThan(three.cropPercent);
    expect(three.cropPercent).toBeLessThanOrEqual(0.03);
  });
});

describe('the measuring loop (pure parts)', () => {
  it('strengthens until the target or the visual budget, then stops', () => {
    let params = generateAntiSearchParams({ level: 1 });
    // Short of the target with room to grow: keep going.
    expect(shouldStrengthenAntiSearch(4, 10, params)).toBe(true);
    // Target reached, or no measurement at all: stop.
    expect(shouldStrengthenAntiSearch(10, 10, params)).toBe(false);
    expect(shouldStrengthenAntiSearch(null, 10, params)).toBe(false);
    // Each step grows the field and the crop and moves the seed; both are capped.
    for (let i = 0; i < ANTI_SEARCH_MAX_ATTEMPTS + 3; i++) {
      const next = strengthenAntiSearch(params);
      expect(next.fieldAmplitude).toBeGreaterThanOrEqual(params.fieldAmplitude);
      expect(next.cropPercent).toBeGreaterThanOrEqual(params.cropPercent);
      expect(next.noiseSeed).toBe(params.noiseSeed + 1);
      expect(next.crop).toEqual(params.crop);
      params = next;
    }
    expect(params.fieldAmplitude).toBe(ANTI_SEARCH_MAX_AMPLITUDE);
    expect(params.cropPercent).toBeLessThanOrEqual(ANTI_SEARCH_MAX_CROP);
    // At the budget no further attempt is made even when the target is missed.
    expect(shouldStrengthenAntiSearch(2, 18, params)).toBe(false);
  });
});

describe('sampleField', () => {
  it('stays inside [−1, 1] over the whole picture and matches the grid at cell centres', () => {
    const grid = smoothFieldGrid(11);
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y <= 100; y++) {
      for (let x = 0; x <= 100; x++) {
        const v = sampleField(grid, x / 100, y / 100);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    const cx = 7;
    const cy = 30;
    expect(sampleField(grid, (cx + 0.5) / FIELD_GRID, (cy + 0.5) / FIELD_GRID)).toBeCloseTo(grid[cy * FIELD_GRID + cx], 6);
  });
});
