import { describe, it, expect } from 'vitest';
import { analyzeDateTime } from '../heuristics/temporalAnalyzer';

const facts = (value: string | undefined, lang: 'ru' | 'en' | 'uz' = 'en') =>
  analyzeDateTime(value, lang).map((insight) => insight.fact);

describe('analyzeDateTime (camera wall-clock)', () => {
  it('02:30 wall-clock is a night photo', () => {
    // 2024-06-12 is a Wednesday
    expect(facts('2024-06-12T02:30:00')).toContain('Night photo (2:00)');
  });

  it('Saturday wall-clock is a weekend', () => {
    // 2024-06-15 is a Saturday
    expect(facts('2024-06-15T15:00:00')).toContain('Weekend');
    expect(facts('2024-06-15T15:00:00')).not.toContain('Weekday, working hours');
  });

  it('weekday daytime is working hours, not weekend', () => {
    // 2024-06-12 (Wednesday) 11:00
    const result = facts('2024-06-12T11:00:00');
    expect(result).toContain('Weekday, working hours');
    expect(result).not.toContain('Weekend');
  });

  it('reads hour and weekday from the digits, not from the instant (zone-independent)', () => {
    // As an instant, 2024-06-15T02:30+05:00 is Friday 21:30 UTC — no night, no weekend.
    // The camera wall-clock is Saturday 02:30 — night AND weekend. We must report the latter,
    // whatever process TZ vitest happens to run in.
    const zoned = '2024-06-15T02:30:00+05:00';
    expect(new Date(zoned).getUTCDay()).toBe(5); // sanity: UTC says Friday
    expect(new Date(zoned).getUTCHours()).toBe(21);
    const result = facts(zoned);
    expect(result).toContain('Night photo (2:00)');
    expect(result).toContain('Weekend');
  });

  it('accepts the raw EXIF "YYYY:MM:DD HH:MM:SS" form', () => {
    expect(facts('2024:06:15 02:30:00', 'ru')).toContain('Ночное фото (2:00)');
    expect(facts('2024:06:15 02:30:00', 'ru')).toContain('Выходной день');
  });

  it('does not call a photo a few hours ahead of UTC "future" (wall-clock treated as UTC)', () => {
    const fiveHoursAhead = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 19);
    const result = facts(fiveHoursAhead);
    expect(result).not.toContain('Future date');
    expect(result).toContain('Photo taken today');
  });

  it('flags a date days ahead as future', () => {
    const threeDaysAhead = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
    expect(facts(threeDaysAhead)).toContain('Future date');
  });

  it('reports age in years for old photos', () => {
    expect(facts('2015-03-10T10:00:00')).toEqual(expect.arrayContaining([expect.stringMatching(/^Photo taken ~\d+ years ago$/)]));
  });

  it('returns nothing for missing or unparsable input', () => {
    expect(analyzeDateTime(undefined, 'en')).toEqual([]);
    expect(analyzeDateTime('not a date', 'en')).toEqual([]);
    expect(analyzeDateTime('0000:00:00 00:00:00', 'en')).toEqual([]);
  });
});
