import { describe, expect, it } from 'vitest';
import { buildTimeProfile, isWeekend, isWorkingHour, photoAge, timeOfDay } from '../timeProfile';

const NOW = new Date('2026-09-16T12:00:00Z');

describe('timeOfDay / isWeekend / isWorkingHour', () => {
  it('buckets the camera hour', () => {
    expect(timeOfDay(2)).toBe('night');
    expect(timeOfDay(5)).toBe('earlyMorning');
    expect(timeOfDay(10)).toBe('morning');
    expect(timeOfDay(13)).toBe('lunch');
    expect(timeOfDay(16)).toBe('afternoon');
    expect(timeOfDay(20)).toBe('evening');
    expect(timeOfDay(23)).toBe('lateEvening');
  });
  it('knows weekends and the office window', () => {
    expect(isWeekend(0)).toBe(true);
    expect(isWeekend(6)).toBe(true);
    expect(isWeekend(3)).toBe(false);
    expect(isWorkingHour(9)).toBe(true);
    expect(isWorkingHour(18)).toBe(true);
    expect(isWorkingHour(19)).toBe(false);
  });
});

describe('photoAge', () => {
  const at = (iso: string) => new Date(iso);
  it('grants a day of grace before calling the date future', () => {
    expect(photoAge(at('2026-09-17T06:00:00Z'), NOW)).toEqual({ kind: 'fresh', value: 0 });
    expect(photoAge(at('2026-09-19T12:00:00Z'), NOW)).toEqual({ kind: 'future', value: 3 });
  });
  it('buckets days, months and years', () => {
    expect(photoAge(at('2026-09-16T00:00:00Z'), NOW)).toEqual({ kind: 'fresh', value: 0 });
    expect(photoAge(at('2026-09-01T12:00:00Z'), NOW)).toEqual({ kind: 'days', value: 15 });
    expect(photoAge(at('2026-06-14T18:30:00Z'), NOW)).toEqual({ kind: 'months', value: 3 });
    expect(photoAge(at('2023-09-16T12:00:00Z'), NOW)).toEqual({ kind: 'years', value: 3 });
  });
});

describe('buildTimeProfile', () => {
  // Sunday 16 August 2026, 10:26 on a +05:00 camera clock, shot in Tashkent.
  const sunday = { shotDateLocal: '2026-08-16T10:26:00', utcOffset: '+05:00', gps: { lat: 41.3, lon: 69.3 } };

  it('returns null without a wall clock', () => {
    expect(buildTimeProfile({ metadata: null })).toBeNull();
    expect(buildTimeProfile({ metadata: { shotDateLocal: undefined } })).toBeNull();
  });

  it('classifies a weekend morning from the camera digits alone', () => {
    const tp = buildTimeProfile({ metadata: sunday, now: NOW });
    expect(tp).toMatchObject({
      wallClock: '2026-08-16T10:26:00',
      dayOfWeek: 0,
      timeOfDay: 'morning',
      dayKind: 'weekend',
      workingHours: false,
      camera: { offsetMinutes: 300, source: 'exif-offset' },
      place: null,
      clock: null,
      age: { kind: 'days', value: 31 }
    });
  });

  it('matches the camera clock against the place zone', () => {
    const tp = buildTimeProfile({ metadata: sunday, placeTimezone: 'Asia/Tashkent', now: NOW });
    expect(tp?.place).toEqual({ timezone: 'Asia/Tashkent', offsetMinutes: 300 });
    expect(tp?.clock).toEqual({ differenceMinutes: 0, match: true, local: '2026-08-16T10:26:00', sameDay: true });
  });

  it('a camera still on Moscow time in Tashkent: 2 h behind, local clock 12:26', () => {
    const tp = buildTimeProfile({
      metadata: { ...sunday, utcOffset: '+03:00' },
      placeTimezone: 'Asia/Tashkent',
      now: NOW
    });
    expect(tp?.camera).toEqual({ offsetMinutes: 180, source: 'exif-offset' });
    expect(tp?.clock).toEqual({ differenceMinutes: -120, match: false, local: '2026-08-16T12:26:00', sameDay: true });
  });

  it('a late shot crossing midnight in the place zone flags a different local date', () => {
    const tp = buildTimeProfile({
      metadata: { shotDateLocal: '2026-08-16T23:30:00', utcOffset: '+03:00', gps: { lat: 41.3, lon: 69.3 } },
      placeTimezone: 'Asia/Tashkent',
      now: NOW
    });
    expect(tp?.clock).toMatchObject({ local: '2026-08-17T01:30:00', sameDay: false });
  });

  it('measures the clock drift against the GPS stamp once the zone is taken out', () => {
    // 10:26:00 on a +05:00 clock is 05:26:00 UTC; GPS says 05:23:20 → the phone runs 160 s ahead.
    const ahead = buildTimeProfile({
      metadata: { shotDateLocal: '2026-08-16T10:26:00', utcOffset: '+05:00', gps: { lat: 41.3, lon: 69.3, timestampUtc: '2026-08-16T05:23:20Z' } },
      now: NOW
    });
    expect(ahead?.driftSeconds).toBe(160);
    const exact = buildTimeProfile({ metadata: { ...sunday, gps: { ...sunday.gps, timestampUtc: '2026-08-16T05:26:03Z' } }, now: NOW });
    expect(exact?.driftSeconds).toBe(-3);
    // No GPS stamp, or a stamp from another day: no drift.
    expect(buildTimeProfile({ metadata: sunday, now: NOW })?.driftSeconds).toBeNull();
    expect(
      buildTimeProfile({ metadata: { ...sunday, gps: { ...sunday.gps, timestampUtc: '2026-08-10T05:26:00Z' } }, now: NOW })?.driftSeconds
    ).toBeNull();
  });

  it('derives the camera zone from the GPS stamp when EXIF has no offset', () => {
    const tp = buildTimeProfile({
      metadata: {
        shotDateLocal: '2026-08-16T10:26:00',
        utcOffset: null,
        gps: { lat: 41.3, lon: 69.3, timestampUtc: '2026-08-16T05:26:03Z' }
      },
      now: NOW
    });
    expect(tp?.camera).toEqual({ offsetMinutes: 300, source: 'gps-time' });
  });

  it('has no camera zone when only the place zone can locate the instant', () => {
    const tp = buildTimeProfile({
      metadata: { shotDateLocal: '2026-08-16T10:26:00', utcOffset: null, gps: { lat: 41.3, lon: 69.3 } },
      placeTimezone: 'Asia/Tashkent',
      now: NOW
    });
    expect(tp?.camera).toBeNull();
    expect(tp?.place).toEqual({ timezone: 'Asia/Tashkent', offsetMinutes: 300 });
    expect(tp?.clock).toBeNull();
  });

  it('a holiday beats the weekday, and lists the names once', () => {
    const tp = buildTimeProfile({
      metadata: { shotDateLocal: '2026-09-01T11:00:00' },
      holiday: {
        isHoliday: true,
        holidays: [
          { localName: 'Mustaqillik kuni', name: 'Independence Day' },
          { localName: 'Mustaqillik kuni', name: 'x' }
        ]
      },
      now: NOW
    });
    expect(tp?.dayKind).toBe('holiday');
    expect(tp?.holidayNames).toEqual(['Mustaqillik kuni']);
    expect(tp?.workingHours).toBe(false);
  });

});
