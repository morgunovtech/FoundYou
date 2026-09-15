import { describe, it, expect } from 'vitest';
import { resolveShotDate } from '../../hooks/useExifMetadata';

describe('resolveShotDate', () => {
  it('EXIF string + OffsetTimeOriginal → wall-clock kept, true instant computed', () => {
    expect(resolveShotDate('2024:06:15 02:30:00', '+05:00')).toEqual({
      local: '2024-06-15T02:30:00',
      utcOffset: '+05:00',
      iso: '2024-06-14T21:30:00.000Z'
    });
  });

  it('EXIF string without offset → offset null, instant taken as if UTC', () => {
    expect(resolveShotDate('2024:06:15 02:30:00')).toEqual({
      local: '2024-06-15T02:30:00',
      utcOffset: null,
      iso: '2024-06-15T02:30:00.000Z'
    });
  });

  it('normalises a colon-less offset', () => {
    expect(resolveShotDate('2024:06:15 02:30:00', '-0300')?.utcOffset).toBe('-03:00');
    expect(resolveShotDate('2024:06:15 02:30:00', '-0300')?.iso).toBe('2024-06-15T05:30:00.000Z');
  });

  it('ignores a malformed offset tag', () => {
    expect(resolveShotDate('2024:06:15 02:30:00', '   ')?.utcOffset).toBeNull();
    expect(resolveShotDate('2024:06:15 02:30:00', 'GMT+5')?.utcOffset).toBeNull();
  });

  it('a Date revived by exifr (local fields hold the camera digits) → wall-clock from local getters', () => {
    // This is exactly how exifr builds it: new Date(y, m, d) + setHours/Minutes/Seconds.
    const revived = new Date(2024, 5, 15, 2, 30, 0);
    const result = resolveShotDate(revived);
    expect(result?.local).toBe('2024-06-15T02:30:00');
    expect(result?.utcOffset).toBeNull();
    expect(result?.iso).toBe('2024-06-15T02:30:00.000Z');
  });

  it('a zoned ISO string carries its own offset', () => {
    expect(resolveShotDate('2024-06-15T02:30:00+03:00')).toEqual({
      local: '2024-06-15T02:30:00',
      utcOffset: '+03:00',
      iso: '2024-06-14T23:30:00.000Z'
    });
    expect(resolveShotDate('2024-06-15T02:30:00Z')?.utcOffset).toBe('+00:00');
  });

  it('an explicit offset tag wins over the string zone', () => {
    expect(resolveShotDate('2024-06-15T02:30:00Z', '+05:00')?.iso).toBe('2024-06-14T21:30:00.000Z');
  });

  it('rejects the EXIF placeholder and garbage', () => {
    expect(resolveShotDate('0000:00:00 00:00:00')).toBeUndefined();
    expect(resolveShotDate('')).toBeUndefined();
    expect(resolveShotDate(undefined)).toBeUndefined();
    expect(resolveShotDate(new Date('invalid'))).toBeUndefined();
    expect(resolveShotDate(12345)).toBeUndefined();
  });
});
