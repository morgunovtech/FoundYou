import type { StructuredMetadata } from '../types/metadata';
import { formatWallClock, parseWallClock, wallClockAsUtcDate, type WallClockParts } from './format';
import { resolveShotInstant, zoneOffsetMinutes } from './stance';

/*
 * «When the photo was taken»: everything the capture time says once it is read
 * together with the place. Pure functions; the component maps the result to text.
 *
 * Two clocks matter. The camera wall-clock (`shotDateLocal`) is what the owner
 * saw on the screen; its zone is known only when EXIF wrote an offset or the
 * GPS receiver stamped UTC. The place zone comes from the weather lookup. When
 * both are known, their difference tells whether the phone lives in another
 * region and what the local clock showed. Facts only: no guesses about habits
 * from a single photo.
 */

export type TimeOfDay = 'night' | 'earlyMorning' | 'morning' | 'lunch' | 'afternoon' | 'evening' | 'lateEvening';

export function timeOfDay(hour: number): TimeOfDay {
  if (hour < 5) return 'night';
  if (hour < 7) return 'earlyMorning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'lunch';
  if (hour < 18) return 'afternoon';
  if (hour < 23) return 'evening';
  return 'lateEvening';
}

/** Sunday (0) or Saturday (6) of the camera wall-clock. */
export function isWeekend(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/** 09:00–18:59 — the office window; a fact about the hour, not about the owner's job. */
export function isWorkingHour(hour: number): boolean {
  return hour >= 9 && hour <= 18;
}

export type DayKind = 'weekend' | 'weekday' | 'holiday';

export type AgeKind = 'future' | 'today' | 'yesterday' | 'days' | 'months' | 'years';

export interface PhotoAge {
  kind: AgeKind;
  /** Days for `future` / `days`, months for `months`, years for `years`; 0 for `today` / `yesterday`. */
  value: number;
}

const DAY_MS = 86_400_000;

/**
 * How old the wall-clock is.
 *
 * «Today» and «yesterday» are calendar questions, not durations: a photo from 22:36 last night is
 * yesterday's at 13:59 today, although only fifteen hours have passed, and one from 00:30 this
 * morning is today's after thirteen. Subtracting timestamps cannot tell those apart, which is why
 * the card used to hedge with «сегодня или вчера» over a file that names its date to the second.
 * So the two calendar days are compared directly — the shot's own date digits against the
 * reader's — and only the coarser buckets are measured in elapsed days.
 *
 * The wall-clock is read as if it were UTC because the real offset may be unknown; that is at
 * most ±14 h off, which is why a date one calendar day ahead still counts as today rather than
 * «future» — a zone difference, not a broken clock.
 */
export function photoAge(asUtc: Date, now: Date): PhotoAge {
  const shotDay = Date.UTC(asUtc.getUTCFullYear(), asUtc.getUTCMonth(), asUtc.getUTCDate());
  const readerDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((readerDay - shotDay) / DAY_MS);
  if (dayDiff < -1) return { kind: 'future', value: -dayDiff };
  if (dayDiff <= 0) return { kind: 'today', value: 0 };
  if (dayDiff === 1) return { kind: 'yesterday', value: 0 };
  const years = Math.floor(dayDiff / 365);
  if (years > 0) return { kind: 'years', value: years };
  const months = Math.floor(dayDiff / 30);
  if (months > 1) return { kind: 'months', value: months };
  return { kind: 'days', value: dayDiff };
}

export type CameraClockSource = 'exif-offset' | 'gps-time';

export interface TimeProfile {
  /** Camera wall-clock, canonical `YYYY-MM-DDTHH:mm:ss`. */
  wallClock: string;
  parts: WallClockParts;
  /** 0 = Sunday … 6 = Saturday, from the wall-clock digits. */
  dayOfWeek: number;
  timeOfDay: TimeOfDay;
  dayKind: DayKind;
  holidayNames: string[];
  /** Weekday, not a holiday, 09:00–18:59 on the camera clock. */
  workingHours: boolean;
  /** The camera's own offset from UTC, when the file lets us tell. */
  camera: { offsetMinutes: number; source: CameraClockSource } | null;
  /** The zone of the place at the moment of capture, when the lookup answered. */
  place: { timezone: string; offsetMinutes: number } | null;
  /** Camera clock versus place clock; null unless both are known. */
  clock: {
    /** Camera minus place, minutes: positive when the camera runs ahead. */
    differenceMinutes: number;
    match: boolean;
    /** What a clock on the wall at the place showed, `YYYY-MM-DDTHH:mm:ss`. */
    local: string;
    /** False when the place date differs from the camera date (a shot around midnight). */
    sameDay: boolean;
  } | null;
  age: PhotoAge;
  /**
   * How far the phone clock was from GPS time, seconds (positive: the clock runs ahead), once the
   * zone offset is taken out. Null without a GPS stamp or when the stamp belongs to another shot.
   */
  driftSeconds: number | null;
}

/**
 * Camera clock versus the GPS stamp: below this many seconds they agree for every purpose;
 * above it the time was set by hand or edited, which the file history reports.
 */
export const DRIFT_SUSPICIOUS_SECONDS = 60;

export interface TimeProfileInput {
  metadata: Pick<StructuredMetadata, 'shotDateLocal' | 'utcOffset' | 'gps'> | null;
  /** IANA zone of the place (weather lookup), when lookups are allowed and it answered. */
  placeTimezone?: string | null;
  /** Holidays lookup answer for the capture date, when allowed and answered. */
  holiday?: { isHoliday: boolean; holidays: Array<{ localName: string; name: string }> } | null;
  now?: Date;
}

export function buildTimeProfile(input: TimeProfileInput): TimeProfile | null {
  const { metadata, placeTimezone, holiday } = input;
  const parts = parseWallClock(metadata?.shotDateLocal);
  if (!metadata || !parts) return null;
  const now = input.now ?? new Date();

  const asUtc = wallClockAsUtcDate(parts);
  const dayOfWeek = asUtc.getUTCDay();
  const holidayNames = holiday?.isHoliday
    ? Array.from(new Set(holiday.holidays.map((h) => h.localName || h.name).filter(Boolean)))
    : [];
  const dayKind: DayKind = holiday?.isHoliday ? 'holiday' : isWeekend(dayOfWeek) ? 'weekend' : 'weekday';
  const workingHours = dayKind === 'weekday' && isWorkingHour(parts.hour);

  const instant = resolveShotInstant(metadata, placeTimezone);
  const camera =
    instant &&
    instant.cameraOffsetMinutes != null &&
    (instant.source === 'exif-offset' || instant.source === 'gps-time')
      ? { offsetMinutes: instant.cameraOffsetMinutes, source: instant.source }
      : null;

  let placeZone: TimeProfile['place'] = null;
  if (placeTimezone && instant) {
    const offset = zoneOffsetMinutes(placeTimezone, instant.utc);
    if (offset != null) placeZone = { timezone: placeTimezone, offsetMinutes: offset };
  }

  let clock: TimeProfile['clock'] = null;
  if (camera && placeZone && instant) {
    const localDate = new Date(instant.utc.getTime() + placeZone.offsetMinutes * 60_000);
    const local = formatWallClock({
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
      hour: localDate.getUTCHours(),
      minute: localDate.getUTCMinutes(),
      second: localDate.getUTCSeconds()
    });
    clock = {
      differenceMinutes: camera.offsetMinutes - placeZone.offsetMinutes,
      match: camera.offsetMinutes === placeZone.offsetMinutes,
      local,
      sameDay: local.slice(0, 10) === formatWallClock(parts).slice(0, 10)
    };
  }

  // Clock drift: wall clock minus zone offset is the camera's idea of UTC; GPS has the true UTC.
  let driftSeconds: number | null = null;
  const gpsUtc = metadata.gps?.timestampUtc ? new Date(metadata.gps.timestampUtc) : null;
  if (camera && gpsUtc && !Number.isNaN(gpsUtc.getTime())) {
    const cameraUtc = asUtc.getTime() - camera.offsetMinutes * 60_000;
    const drift = Math.round((cameraUtc - gpsUtc.getTime()) / 1000);
    // A stamp more than a day away belongs to another fix, not to this shot.
    if (Math.abs(drift) <= 26 * 3600) driftSeconds = drift;
  }

  return {
    wallClock: formatWallClock(parts),
    parts,
    dayOfWeek,
    timeOfDay: timeOfDay(parts.hour),
    dayKind,
    holidayNames,
    workingHours,
    camera,
    place: placeZone,
    clock,
    age: photoAge(asUtc, now),
    driftSeconds
  };
}
