import { describe, it, expect } from 'vitest';
import { timeHeadline } from '../../components/story/timeHeadline';
import { parseWallClock } from '../../utils/format';
import type { TimeProfile } from '../../utils/timeProfile';

/** A translator that echoes the key and its params, so the test checks composition, not copy. */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.values(params).join('|')})` : key;

function profile(overrides: Partial<TimeProfile> = {}): TimeProfile {
  const wallClock = '2026-09-16T22:06:41';
  const parts = parseWallClock(wallClock);
  if (!parts) throw new Error('fixture');
  return {
    wallClock,
    parts,
    dayOfWeek: 3,
    timeOfDay: 'evening',
    dayKind: 'weekday',
    holidayNames: [],
    workingHours: false,
    camera: null,
    place: null,
    clock: null,
    age: { kind: 'yesterday', value: 0 },
    driftSeconds: null,
    ...overrides
  };
}

describe('timeHeadline', () => {
  it('lines up age, date, weekday, day kind, time of day and the clock to the second', () => {
    expect(timeHeadline(profile(), 'ru', t)).toBe(
      'AgeYesterday(0), 16 сентября 2026 г., среда, dayWeekday, todEvening, 22:06:41'
    );
  });

  it('names the holiday and counts the days in the other languages', () => {
    const holiday = profile({
      dayKind: 'holiday',
      holidayNames: ['Independence Day'],
      age: { kind: 'days', value: 15 }
    });
    expect(timeHeadline(holiday, 'en', t)).toBe(
      'AgeDays(15), September 16, 2026, Wednesday, dayHoliday(Independence Day), todEvening, 22:06:41'
    );
    expect(timeHeadline(profile({ dayKind: 'weekend' }), 'en', t)).toContain(', dayWeekend, ');
  });
});
