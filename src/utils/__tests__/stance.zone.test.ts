import { describe, expect, it } from 'vitest';
import { GPS_ZONE_SLACK_MINUTES, resolveShotInstant } from '../stance';
import { buildTimeProfile } from '../timeProfile';

/*
 * The camera zone from GPS: wall clock minus the GPS stamp, rounded to a quarter hour. That is
 * right when the clock is right. A DSLR with a GPS unit and a hand-set clock 8 minutes fast in
 * UTC+5 gave 308 → «UTC+05:15 (по GPS)», «a quarter of an hour ahead of the place», and a
 * drift of −7 minutes — when the fact is +8 minutes in the same zone.
 */
describe('resolveShotInstant with a clock that is off', () => {
  const gps = { lat: 41.31, lon: 69.28, timestampUtc: '2026-06-14T07:00:00.000Z' };

  it('reads a zone only when the difference lands on a quarter hour', () => {
    const exact = resolveShotInstant({ shotDateLocal: '2026-06-14T12:00:00', gps });
    expect(exact).toMatchObject({ cameraOffsetMinutes: 300, source: 'gps-time' });
    expect(exact?.cameraOffsetAssumed).toBeUndefined();
    const nearly = resolveShotInstant({ shotDateLocal: `2026-06-14T12:0${GPS_ZONE_SLACK_MINUTES}:00`, gps });
    expect(nearly?.cameraOffsetMinutes).toBe(300);
  });

  it('takes the zone from the place when the clock is minutes off, and calls it assumed', () => {
    const eightFast = resolveShotInstant({ shotDateLocal: '2026-06-14T12:08:00', gps }, 'Asia/Tashkent');
    expect(eightFast).toMatchObject({ cameraOffsetMinutes: 300, source: 'gps-time', cameraOffsetAssumed: true });
  });

  it('leaves the zone unknown when the clock is off and no place is known', () => {
    const eightFast = resolveShotInstant({ shotDateLocal: '2026-06-14T12:08:00', gps });
    expect(eightFast?.cameraOffsetMinutes).toBeNull();
    expect(eightFast?.utc.toISOString()).toBe('2026-06-14T07:00:00.000Z');
  });

  it('a traveller whose clock is right but on another zone keeps that zone', () => {
    const moscow = resolveShotInstant({ shotDateLocal: '2026-06-14T10:00:00', gps }, 'Asia/Tashkent');
    expect(moscow).toMatchObject({ cameraOffsetMinutes: 180, source: 'gps-time' });
    expect(moscow?.cameraOffsetAssumed).toBeUndefined();
  });

  it('the time profile then reports the whole residual as drift', () => {
    const tp = buildTimeProfile({
      metadata: { shotDateLocal: '2026-06-14T12:08:00', gps },
      placeTimezone: 'Asia/Tashkent',
      now: new Date('2026-09-23T00:00:00Z')
    });
    expect(tp?.camera).toEqual({ offsetMinutes: 300, source: 'gps-time', assumed: true });
    expect(tp?.clock?.differenceMinutes).toBe(0);
    expect(tp?.driftSeconds).toBe(8 * 60);
  });
});
