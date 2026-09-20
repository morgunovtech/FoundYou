/*
 * Is the date in the file a date at all?
 *
 * EXIF stores the capture time as twenty ASCII characters, `YYYY:MM:DD HH:MM:SS`, and nothing in
 * the format stops a camera, a converter or a person with a hex editor from writing
 * `2031:02:30 25:61:61`. exifr hands such a value to `new Date(2031, 1, 30, 25, 61, 61)`, and
 * JavaScript rolls every overflow forward without a word: the page then printed «3 марта 2031,
 * 02:02» — a date and a minute that are in no file, presented with the same confidence as a real
 * one. A made-up fact is worse than a missing one, so the raw digits are checked before anything
 * is built on them.
 *
 * These checks are about the *form* of the value. A date that is well-formed but wrong (a camera
 * whose clock was never set, a file from the future) is a different question, answered by
 * `timestampConsistency.ts` and the time card. Platform note: nothing here touches the browser —
 * it is string arithmetic on bytes read from the file, identical on Android and iOS.
 */

export type DateFaultReason =
  /** A field is outside its range: month 13, day 30 in February, hour 25, minute 61. */
  | 'out-of-range'
  /** The all-zero placeholder some cameras write when the clock was never set. */
  | 'placeholder'
  /** Twenty characters that are not a date at all. */
  | 'unparsable';

export interface DateFault {
  reason: DateFaultReason;
  /** The value exactly as it stands in the file, for showing next to the verdict. */
  raw: string;
}

const EXIF_DATE = /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;
/** The year an EXIF date stops being a plausible typo and becomes a broken field. */
const MIN_YEAR = 1826; // the first surviving photograph
const MAX_YEAR = 2999;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * The fault in a raw EXIF date string, or null when the digits describe a real moment.
 *
 * A value that is not a date-shaped string at all (a number, an empty tag, a missing one) is not a
 * fault: there is simply no date, and the card says so on its own.
 */
export function findDateFault(raw: unknown): DateFault | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // `0000:00:00 00:00:00` and its blank-filled cousins: the tag exists but was never written.
  if (/^[0\s:.-]+$/.test(trimmed)) return { reason: 'placeholder', raw: trimmed };
  const match = EXIF_DATE.exec(trimmed);
  // Anything that does not even look like a date is left alone: exifr will not revive it either,
  // so nothing downstream can turn it into a wrong fact.
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[];
  if (year < MIN_YEAR || year > MAX_YEAR) return { reason: 'out-of-range', raw: trimmed };
  if (month < 1 || month > 12) return { reason: 'out-of-range', raw: trimmed };
  if (day < 1 || day > daysInMonth(year, month)) return { reason: 'out-of-range', raw: trimmed };
  if (hour > 23) return { reason: 'out-of-range', raw: trimmed };
  if (minute > 59) return { reason: 'out-of-range', raw: trimmed };
  // 60 is a legal leap second; 61 is not.
  if (second > 60) return { reason: 'out-of-range', raw: trimmed };
  return null;
}

/**
 * The fault to report for a file, taking the tags in the same order the shot date is resolved
 * from. Only the tag that would have supplied the capture time is judged: a broken `ModifyDate`
 * next to a sound `DateTimeOriginal` does not make the capture time a lie.
 */
export const SHOT_DATE_TAGS = ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized'] as const;

export function findShotDateFault(rawDates: Record<string, unknown> | undefined): DateFault | null {
  if (!rawDates) return null;
  for (const tag of SHOT_DATE_TAGS) {
    const value = rawDates[tag];
    if (typeof value !== 'string' || !value.trim()) continue;
    const fault = findDateFault(value);
    // The first tag that carries a value decides — it is the one the shot date comes from, and a
    // sound one means there is nothing to report even if a later tag is broken.
    return fault;
  }
  return null;
}
