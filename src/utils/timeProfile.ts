import type { StructuredMetadata } from '../types/metadata';
import type { ReverseGeocodeResult } from '../types/api';
import { formatWallClock, parseWallClock, wallClockAsUtcDate, type WallClockParts } from './format';
import { resolveShotInstant, zoneOffsetMinutes } from './stance';

/*
 * «Time and habits»: everything the capture time says once it is read together
 * with the place. Pure functions; the component maps the result to text.
 *
 * Two clocks matter. The camera wall-clock (`shotDateLocal`) is what the owner
 * saw on the screen; its zone is known only when EXIF wrote an offset or the
 * GPS receiver stamped UTC. The place zone comes from the weather lookup. When
 * both are known, their difference tells whether the phone lives in another
 * region — a strong «trip» signal — and what the local clock showed.
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

/** 09:00–18:59 — the office window used by the habits heuristics. */
export function isWorkingHour(hour: number): boolean {
  return hour >= 9 && hour <= 18;
}

export type DayKind = 'weekend' | 'weekday' | 'holiday';

export type AgeKind = 'future' | 'fresh' | 'days' | 'months' | 'years';

export interface PhotoAge {
  kind: AgeKind;
  /** Days for `future` / `days`, months for `months`, years for `years`; 0 or 1 for `fresh`. */
  value: number;
}

const DAY_MS = 86_400_000;

/**
 * How old the wall-clock is. It is compared as if it were UTC because the real offset may be
 * unknown; that is at most ±14 h off, irrelevant for day/month/year buckets, but it is why a
 * photo from a few hours ago in a UTC+N zone gets one day of grace before it is called «future».
 */
export function photoAge(asUtc: Date, now: Date): PhotoAge {
  const ageDays = Math.floor((now.getTime() - asUtc.getTime()) / DAY_MS);
  if (ageDays < -1) return { kind: 'future', value: -ageDays };
  if (ageDays <= 1) return { kind: 'fresh', value: Math.max(0, ageDays) };
  const years = Math.floor(ageDays / 365);
  if (years > 0) return { kind: 'years', value: years };
  const months = Math.floor(ageDays / 30);
  if (months > 1) return { kind: 'months', value: months };
  return { kind: 'days', value: ageDays };
}

const LEISURE_CATEGORIES = new Set(['natural', 'tourism', 'leisure']);
const LEISURE_TYPES = new Set([
  'beach',
  'park',
  'hotel',
  'hostel',
  'resort',
  'camp_site',
  'caravan_site',
  'viewpoint',
  'attraction',
  'nature_reserve',
  'garden',
  'zoo',
  'theme_park',
  'water_park',
  'spa',
  'ski',
  'peak',
  'water',
  'bay',
  'island'
]);

/** Nominatim says the point is a place people go to rest, not to work. */
export function isLeisurePlace(
  place: Pick<ReverseGeocodeResult, 'category' | 'type' | 'addressType'> | null | undefined
): boolean {
  if (!place) return false;
  const category = place.category?.toLowerCase() ?? '';
  const addressType = place.addressType?.toLowerCase() ?? '';
  const type = place.type?.toLowerCase() ?? '';
  return LEISURE_CATEGORIES.has(category) || LEISURE_CATEGORIES.has(addressType) || LEISURE_TYPES.has(type);
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
  travel: {
    /** The camera clock lives in a different zone than the place. */
    zone: boolean;
    /** Working hours of a weekday spent at a leisure place: vacation, day off or business trip. */
    leisure: boolean;
  };
}

export interface TimeProfileInput {
  metadata: Pick<StructuredMetadata, 'shotDateLocal' | 'utcOffset' | 'gps'> | null;
  /** IANA zone of the place (weather lookup), when lookups are allowed and it answered. */
  placeTimezone?: string | null;
  /** Holidays lookup answer for the capture date, when allowed and answered. */
  holiday?: { isHoliday: boolean; holidays: Array<{ localName: string; name: string }> } | null;
  /** Reverse-geocode answer, for the leisure heuristic. */
  place?: Pick<ReverseGeocodeResult, 'category' | 'type' | 'addressType'> | null;
  now?: Date;
}

export function buildTimeProfile(input: TimeProfileInput): TimeProfile | null {
  const { metadata, placeTimezone, holiday, place } = input;
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
    travel: {
      zone: clock != null && !clock.match,
      leisure: workingHours && isLeisurePlace(place)
    }
  };
}
