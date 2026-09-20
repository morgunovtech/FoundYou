import { describe, expect, it } from 'vitest';
import { inferOrientation } from '../orientation';

describe('inferOrientation', () => {
  it('reads the orientation off the decoded dimensions', () => {
    expect(inferOrientation(1920, 1080)).toBe('landscape');
    expect(inferOrientation(1080, 1920)).toBe('portrait');
    expect(inferOrientation(1000, 1000)).toBe('square');
  });

  it('a portrait phone photo is portrait, tag or no tag', () => {
    /*
     * The case this function got wrong. An iPhone held upright writes 4032×3024 pixels plus
     * Orientation = 6, and every browser applies the tag while decoding, so the page holds
     * 3024×4032. The old signature took the tag and swapped the sides a second time, which
     * turned the photo back into a landscape one: the card then said «держал горизонтально»
     * over a portrait picture and measured the field of view across the wrong side.
     */
    expect(inferOrientation(3024, 4032)).toBe('portrait');
    expect(inferOrientation(4032, 3024)).toBe('landscape');
  });

  it('refuses to guess from dimensions that are not dimensions', () => {
    expect(inferOrientation(0, 100)).toBe('unknown');
    expect(inferOrientation(100, 0)).toBe('unknown');
    expect(inferOrientation(Number.NaN, 100)).toBe('unknown');
    expect(inferOrientation(-4032, 3024)).toBe('unknown');
  });
});
