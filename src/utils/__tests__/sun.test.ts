import { describe, expect, it } from 'vitest';
import { sunPosition } from '../sun';

describe('sunPosition', () => {
  it('puts the June solstice noon sun due south of London at about 62°', () => {
    const { altitude, azimuth } = sunPosition(new Date('2024-06-21T12:00:00Z'), 51.5, 0);
    expect(altitude).toBeGreaterThan(60);
    expect(altitude).toBeLessThan(63.5);
    expect(Math.abs(azimuth - 180)).toBeLessThan(4);
  });

  it('is below the horizon in London at midnight in June and deep at night in December', () => {
    expect(sunPosition(new Date('2024-06-21T00:00:00Z'), 51.5, 0).altitude).toBeLessThan(-10);
    expect(sunPosition(new Date('2024-12-21T00:00:00Z'), 51.5, 0).altitude).toBeLessThan(-50);
  });

  it('is almost overhead at the equator on the equinox around solar noon', () => {
    // Equation of time ≈ −7 min on 20 March, so solar noon at 0° is ~12:07 UTC.
    expect(sunPosition(new Date('2024-03-20T12:07:00Z'), 0, 0).altitude).toBeGreaterThan(88);
  });

  it('rises in the east over Tashkent in the morning and sets in the west', () => {
    // 08:00 local (UTC+5) on 14 September 2026.
    const morning = sunPosition(new Date('2026-09-14T03:00:00Z'), 41.3, 69.3);
    expect(morning.altitude).toBeGreaterThan(10);
    expect(morning.azimuth).toBeGreaterThan(80);
    expect(morning.azimuth).toBeLessThan(130);
    // 18:00 local.
    const evening = sunPosition(new Date('2026-09-14T13:00:00Z'), 41.3, 69.3);
    expect(evening.altitude).toBeGreaterThan(0);
    expect(evening.altitude).toBeLessThan(20);
    expect(evening.azimuth).toBeGreaterThan(240);
    expect(evening.azimuth).toBeLessThan(290);
  });

  it('keeps the southern-hemisphere noon sun in the north', () => {
    const { azimuth, altitude } = sunPosition(new Date('2024-12-21T02:00:00Z'), -33.9, 151.2); // Sydney, 13:00 local
    expect(altitude).toBeGreaterThan(70);
    expect(azimuth < 30 || azimuth > 330).toBe(true);
  });
});
