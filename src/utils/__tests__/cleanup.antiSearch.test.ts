import { describe, expect, it } from 'vitest';
import { ANTI_SEARCH_TARGET_BITS, antiSearchTargetBits, generateAntiSearchParams, smoothField } from '../cleanup';

describe('smoothField', () => {
  it('is deterministic for a seed, normalised to [−1, 1] and smooth', () => {
    const a = smoothField(64, 48, 7);
    const b = smoothField(64, 48, 7);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(64 * 48);
    let max = 0;
    for (const v of a) max = Math.max(max, Math.abs(v));
    expect(max).toBeCloseTo(1, 5);
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
