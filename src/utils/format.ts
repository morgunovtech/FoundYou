import type { MessageKey } from '../i18n';
/** Wall-clock date/time parts exactly as a camera wrote them (no time zone attached). */
export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const WALL_CLOCK_RE = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?/;
const ZONE_SUFFIX_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parse `YYYY-MM-DDTHH:mm:ss` or EXIF `YYYY:MM:DD HH:MM:SS` into its digits.
 * A trailing zone designator (`Z`, `+05:00`) is deliberately ignored: this helper is about the
 * wall-clock the camera wrote, not the instant. Returns null for the EXIF placeholder
 * `0000:00:00 00:00:00` and anything else that is not a calendar date.
 */
export function parseWallClock(value: string | undefined | null): WallClockParts | null {
  if (!value) return null;
  const match = WALL_CLOCK_RE.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const parts: WallClockParts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second)
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 60) return null;
  return parts;
}

/** Canonical `YYYY-MM-DDTHH:mm:ss` wall-clock string. */
export function formatWallClock(parts: WallClockParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/**
 * A Date whose *UTC* fields equal the wall-clock. Format it with `timeZone: 'UTC'` (or read it
 * with `getUTC*`) to see the camera's digits unchanged in every viewer time zone.
 */
export function wallClockAsUtcDate(parts: WallClockParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

/** True when an ISO-like string ends with a zone designator (`Z` or `±HH:MM`). */
export function hasZoneDesignator(value: string): boolean {
  return ZONE_SUFFIX_RE.test(value.trim());
}

function numberFormatter(locale: string | undefined, fractionDigits: number): Intl.NumberFormat {
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: false
  };
  try {
    return new Intl.NumberFormat(locale ?? 'en', options);
  } catch {
    return new Intl.NumberFormat('en', options);
  }
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

function splitBytes(bytes: number): { value: number; unit: string; exponent: number } {
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  return { value: bytes / Math.pow(1024, exponent), unit: BYTE_UNITS[exponent], exponent };
}

/** Compact size, e.g. `1.5 KB` / `12 MB`. Decimal separator follows `locale` (default `en`). */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const { value, unit } = splitBytes(bytes);
  return `${numberFormatter(locale, value >= 10 ? 0 : 1).format(value)} ${unit}`;
}

/** Fixed-precision size, e.g. `1.50 KB`. Decimal separator follows `locale` (default `en`). */
export function formatBytesPrecise(bytes: number, fractionDigits = 2, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const { value, unit, exponent } = splitBytes(bytes);
  const precision = exponent === 0 ? 0 : Math.min(2, Math.max(0, fractionDigits));
  return `${numberFormatter(locale, precision).format(value)} ${unit}`;
}

export function formatMegapixels(width: number, height: number, locale?: string): string {
  const mp = (width * height) / 1_000_000;
  return numberFormatter(locale, 2).format(mp);
}

export function formatDimensions(width: number, height: number): string {
  return `${width} × ${height}`;
}

const DETAILED_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
};

/**
 * Long human date for the "capture time" row.
 *
 * Pass `StructuredMetadata.shotDateLocal` (a wall-clock string without zone): it is rendered
 * digit-for-digit, so the user sees the time the camera wrote regardless of where they are.
 * A `Date` or zoned ISO string is treated as an instant and rendered in `timeZone` (or the
 * viewer's zone) — legacy behaviour kept for callers that have no wall-clock.
 */
export function formatDetailedDate(value: string | Date | undefined, locale?: string, timeZone?: string): string | undefined {
  if (!value) return undefined;

  if (typeof value === 'string' && !hasZoneDesignator(value)) {
    const parts = parseWallClock(value);
    if (!parts) return undefined;
    return capitalizeFirstLetter(
      new Intl.DateTimeFormat(locale, { ...DETAILED_DATE_OPTIONS, timeZone: 'UTC' }).format(wallClockAsUtcDate(parts))
    );
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const format = (resolvedTimeZone?: string) =>
    new Intl.DateTimeFormat(locale, { ...DETAILED_DATE_OPTIONS, timeZone: resolvedTimeZone }).format(date);
  try {
    return capitalizeFirstLetter(format(timeZone));
  } catch {
    return capitalizeFirstLetter(format(undefined));
  }
}

const COMPACT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
};

/**
 * Short date for narrow columns («14.06.2026, 18:30»). Same input rules as `formatDetailedDate`:
 * a wall-clock string renders digit-for-digit, a zoned value renders in the viewer's zone.
 */
export function formatCompactDate(value: string | Date | undefined, locale?: string): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string' && !hasZoneDesignator(value)) {
    const parts = parseWallClock(value);
    if (!parts) return undefined;
    return new Intl.DateTimeFormat(locale, { ...COMPACT_DATE_OPTIONS, timeZone: 'UTC' }).format(wallClockAsUtcDate(parts));
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, COMPACT_DATE_OPTIONS).format(date);
}

function capitalizeFirstLetter(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const MIME_FORMATS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP'
};

type FileTypeKey = 'fileTypeImage' | 'fileTypeUnknown';

export function describeFileType(mime: string, fileName?: string): { typeKey: FileTypeKey; format: string } {
  const normalized = mime.toLowerCase();
  const typeKey: FileTypeKey = normalized.startsWith('image/') ? 'fileTypeImage' : 'fileTypeUnknown';
  const extension = fileName?.split('.').pop();
  const fallback = extension ? extension.toUpperCase() : mime.split('/')[1]?.toUpperCase() ?? mime;
  const format = MIME_FORMATS[normalized] ?? fallback;
  return { typeKey, format };
}

/** File extension for an image mime type; JPEG for anything the app cannot name. */
export function extensionForMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** «Узбекистан» for `UZ` in the UI language; the code itself when the browser has no names. */
export function regionName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** `YYYY-MM` → «сентябрь 2023 г.» in the UI language. */
export function formatMonthYear(ym: string, locale: string): string {
  const date = new Date(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return ym;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** «2 ч 30 мин» / «45 мин» for a clock difference in minutes (the sign is dropped). */
export function formatMinutesDuration(minutes: number, t: Translate): string {
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(t('durationHoursShort', { count: hours }));
  if (rest > 0 || hours === 0) parts.push(t('durationMinutesShort', { count: rest }));
  return parts.join(' ');
}

/** «12 дн. 4 ч» / «3 ч 20 мин» for an uptime in seconds. */
export function formatUptime(seconds: number, t: Translate): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(t('durationDaysShort', { count: days }));
  if (hours > 0 || days > 0) parts.push(t('durationHoursShort', { count: hours }));
  if (days === 0) parts.push(t('durationMinutesShort', { count: minutes }));
  return parts.join(' ');
}

/** «2 мин 40 с» / «12 с» for a clock drift in seconds (non-negative). */
export function formatSecondsDuration(seconds: number, t: Translate): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(t('durationMinutesShort', { count: minutes }));
  if (rest > 0 || minutes === 0) parts.push(t('durationSecondsShort', { count: rest }));
  return parts.join(' ');
}

/** «2 г. 11 мес.» for an age in months. */
export function formatMonthsAge(months: number, t: Translate): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(t('durationYearsShort', { count: years }));
  if (rest > 0) parts.push(t('durationMonthsShort', { count: rest }));
  return parts.length > 0 ? parts.join(' ') : t('durationLessThanMonth');
}
