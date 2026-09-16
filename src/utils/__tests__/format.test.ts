import { describe, it, expect } from 'vitest';
import {
  formatCompactDate,
  formatBytes,
  formatBytesPrecise,
  formatDetailedDate,
  formatMegapixels,
  formatWallClock,
  hasZoneDesignator,
  parseWallClock,
  wallClockAsUtcDate
} from '../format';

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats kilobytes (default locale keeps the dot)', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('drops decimals from two-digit values', () => {
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });

  it('uses the locale decimal separator', () => {
    expect(formatBytes(1024, 'ru')).toBe('1,0 KB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
  });
});

describe('formatBytesPrecise', () => {
  it('formats with precision', () => {
    expect(formatBytesPrecise(1536)).toBe('1.50 KB');
  });

  it('returns 0 B for zero', () => {
    expect(formatBytesPrecise(0)).toBe('0 B');
  });

  it('keeps two decimals on whole kilobytes and megabytes', () => {
    expect(formatBytesPrecise(1024)).toBe('1.00 KB');
    expect(formatBytesPrecise(2_097_152)).toBe('2.00 MB');
  });

  it('never adds decimals to plain bytes', () => {
    expect(formatBytesPrecise(512)).toBe('512 B');
  });

  it('uses the locale decimal separator', () => {
    expect(formatBytesPrecise(1536, 2, 'ru')).toBe('1,50 KB');
  });
});

describe('formatMegapixels', () => {
  it('calculates megapixels', () => {
    expect(formatMegapixels(4000, 3000)).toBe('12.00');
  });

  it('handles small images', () => {
    expect(formatMegapixels(100, 100)).toBe('0.01');
  });

  it('uses the locale decimal separator', () => {
    expect(formatMegapixels(4000, 3000, 'ru')).toBe('12,00');
  });
});

describe('parseWallClock / formatWallClock', () => {
  it('parses ISO and EXIF forms to the same digits', () => {
    const iso = parseWallClock('2024-06-15T02:30:07');
    const exif = parseWallClock('2024:06:15 02:30:07');
    expect(iso).toEqual({ year: 2024, month: 6, day: 15, hour: 2, minute: 30, second: 7 });
    expect(exif).toEqual(iso);
  });

  it('ignores a zone suffix and fractional seconds', () => {
    expect(parseWallClock('2024-06-15T02:30:07.123+05:00')?.hour).toBe(2);
    expect(parseWallClock('2024-06-15T02:30:07Z')?.hour).toBe(2);
  });

  it('rejects placeholders and garbage', () => {
    expect(parseWallClock('0000:00:00 00:00:00')).toBeNull();
    expect(parseWallClock('yesterday')).toBeNull();
    expect(parseWallClock(undefined)).toBeNull();
  });

  it('round-trips through formatWallClock', () => {
    expect(formatWallClock(parseWallClock('2024:06:15 02:30:07')!)).toBe('2024-06-15T02:30:07');
  });

  it('wallClockAsUtcDate exposes the digits via UTC getters', () => {
    const date = wallClockAsUtcDate(parseWallClock('2024-06-15T02:30:00')!);
    expect(date.getUTCHours()).toBe(2);
    expect(date.getUTCDay()).toBe(6);
  });

  it('hasZoneDesignator', () => {
    expect(hasZoneDesignator('2024-06-15T02:30:00')).toBe(false);
    expect(hasZoneDesignator('2024-06-15')).toBe(false);
    expect(hasZoneDesignator('2024-06-15T02:30:00Z')).toBe(true);
    expect(hasZoneDesignator('2024-06-15T02:30:00+05:00')).toBe(true);
    expect(hasZoneDesignator('2024-06-15T02:30:00-0300')).toBe(true);
  });
});

describe('formatDetailedDate', () => {
  it('renders a wall-clock string digit-for-digit (no zone conversion)', () => {
    const en = formatDetailedDate('2024-06-15T02:30:00', 'en');
    expect(en).toContain('Saturday');
    expect(en).toContain('02:30');
    const ru = formatDetailedDate('2024-06-15T02:30:00', 'ru');
    expect(ru?.startsWith('Суббота')).toBe(true);
    expect(ru).toContain('02:30');
  });

  it('accepts the EXIF colon form', () => {
    expect(formatDetailedDate('2024:06:15 02:30:00', 'en')).toContain('02:30');
  });

  it('returns undefined for empty or invalid input', () => {
    expect(formatDetailedDate(undefined, 'en')).toBeUndefined();
    expect(formatDetailedDate('nope', 'en')).toBeUndefined();
  });

  it('renders an instant in an explicit time zone (legacy path)', () => {
    expect(formatDetailedDate('2024-06-14T21:30:00Z', 'en', 'Asia/Tashkent')).toContain('02:30');
  });
});

describe('formatCompactDate', () => {
  it('renders a wall clock digit-for-digit and a zoned instant in the viewer zone', () => {
    expect(formatCompactDate('2026-06-14T18:30:12', 'ru')).toBe('14.06.2026, 18:30');
    expect(formatCompactDate('2026-06-14T18:30:12', 'en-GB')).toBe('14/06/2026, 18:30');
    expect(formatCompactDate('nope', 'ru')).toBeUndefined();
    expect(formatCompactDate(undefined, 'ru')).toBeUndefined();
    const zoned = formatCompactDate('2026-09-01T09:00:00.000Z', 'ru');
    expect(zoned).toMatch(/^\d{2}\.\d{2}\.2026, \d{2}:\d{2}$/);
  });
});
