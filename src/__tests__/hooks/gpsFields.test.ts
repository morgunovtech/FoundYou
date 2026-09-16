import { describe, expect, it } from 'vitest';
import { gpsInstant, gpsSpeedKmh } from '../../hooks/useExifMetadata';

describe('gpsSpeedKmh', () => {
  it('converts by the GPSSpeedRef unit and defaults to km/h', () => {
    expect(gpsSpeedKmh(45, 'K')).toBe(45);
    expect(gpsSpeedKmh(30, 'M')).toBe(48.3);
    expect(gpsSpeedKmh(10, 'N')).toBe(18.5);
    expect(gpsSpeedKmh(0.44, undefined)).toBe(0.4);
  });
  it('rejects missing or negative values', () => {
    expect(gpsSpeedKmh(undefined, 'K')).toBeUndefined();
    expect(gpsSpeedKmh(-1, 'K')).toBeUndefined();
    expect(gpsSpeedKmh(Number.NaN, 'K')).toBeUndefined();
  });
});

describe('gpsInstant', () => {
  it('joins the EXIF date stamp with an array, string or Date time stamp', () => {
    expect(gpsInstant('2026:09:14', [13, 20, 0])).toBe('2026-09-14T13:20:00Z');
    expect(gpsInstant('2026-09-14', '08:20:03')).toBe('2026-09-14T08:20:03Z');
    expect(gpsInstant(new Date('2026-09-14T00:00:00Z'), new Date('1970-01-01T08:20:03Z'))).toBe('2026-09-14T08:20:03Z');
    expect(gpsInstant('2026:09:14', [13, 20, 59.7])).toBe('2026-09-14T13:20:59Z');
  });
  it('returns undefined for anything incomplete or out of range', () => {
    expect(gpsInstant(undefined, [13, 20, 0])).toBeUndefined();
    expect(gpsInstant('2026:09:14', undefined)).toBeUndefined();
    expect(gpsInstant('2026:09:14', [25, 0, 0])).toBeUndefined();
    expect(gpsInstant('yesterday', [1, 2, 3])).toBeUndefined();
    expect(gpsInstant('2026:09:14', ['x', 'y'])).toBeUndefined();
  });
});
