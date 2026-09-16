import { parseWallClock, wallClockAsUtcDate } from './format';

/*
 * Do the file's clocks agree with each other? EXIF DateTimeOriginal is the reference; the
 * digitized date, the XMP dates, the modify date, the camera zone against the place zone,
 * the Content Credentials signature and the file's own time on disk each get one comparison.
 * The GPS stamp is compared elsewhere (`TimeProfile.driftSeconds`). Pure.
 */

export interface TimestampInput {
  /** DateTimeOriginal, wall clock `YYYY-MM-DDTHH:mm:ss`. */
  shotLocal: string | null;
  /** DateTimeDigitized / CreateDate from EXIF, wall clock. */
  digitizedLocal: string | null;
  /** EXIF ModifyDate, wall clock. */
  modifyLocal: string | null;
  /** XMP CreateDate: wall clock or ISO with a zone. */
  xmpCreate: string | null;
  cameraOffsetMinutes: number | null;
  placeOffsetMinutes: number | null;
  /** Content Credentials signing time, ISO. */
  signedAt: string | null;
  /** `File.lastModified`, ms since the epoch. */
  lastModified: number | null;
}

export type TimestampIssue =
  | 'digitized-differs'
  | 'xmp-create-differs'
  | 'modify-before-shot'
  | 'zone-differs'
  | 'signed-before-shot'
  | 'disk-before-shot';

export interface TimestampCheck {
  /** How many comparisons the file allowed. */
  checked: number;
  issues: TimestampIssue[];
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Without a camera offset the wall clock can sit anywhere within ±14 h of the true instant. */
const UNKNOWN_ZONE_SLACK_MS = 14 * 3_600_000;

function wallClockMs(value: string | null): number | null {
  if (!value) return null;
  const parts = parseWallClock(value);
  return parts ? wallClockAsUtcDate(parts).getTime() : null;
}

/** A wall clock or an ISO instant, as «wall clock read as UTC» ms, so it compares with `wallClockMs`. */
function anyClockMs(value: string | null, cameraOffsetMinutes: number | null): number | null {
  if (!value) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value.trim())) {
    const instant = Date.parse(value);
    if (Number.isNaN(instant)) return null;
    // Bring the instant onto the camera's wall clock; without an offset leave it as UTC.
    return instant + (cameraOffsetMinutes ?? 0) * MINUTE_MS;
  }
  return wallClockMs(value);
}

export function checkTimestamps(input: TimestampInput): TimestampCheck {
  const issues: TimestampIssue[] = [];
  let checked = 0;
  const shot = wallClockMs(input.shotLocal);
  const offset = input.cameraOffsetMinutes;
  const slack = offset == null ? UNKNOWN_ZONE_SLACK_MS : 0;

  if (shot != null) {
    const digitized = wallClockMs(input.digitizedLocal);
    if (digitized != null) {
      checked += 1;
      if (Math.abs(digitized - shot) > MINUTE_MS) issues.push('digitized-differs');
    }
    const xmpCreate = anyClockMs(input.xmpCreate, offset);
    if (xmpCreate != null) {
      checked += 1;
      if (Math.abs(xmpCreate - shot) > MINUTE_MS + slack) issues.push('xmp-create-differs');
    }
    const modify = wallClockMs(input.modifyLocal);
    if (modify != null) {
      checked += 1;
      if (shot - modify > MINUTE_MS) issues.push('modify-before-shot');
    }
    // The shot as a true instant, for the two clocks that are instants.
    const shotInstant = shot - (offset ?? 0) * MINUTE_MS;
    if (input.signedAt) {
      const signed = Date.parse(input.signedAt);
      if (!Number.isNaN(signed)) {
        checked += 1;
        if (shotInstant - signed > DAY_MS + slack) issues.push('signed-before-shot');
      }
    }
    if (input.lastModified != null && Number.isFinite(input.lastModified) && input.lastModified > 0) {
      checked += 1;
      if (shotInstant - input.lastModified > DAY_MS + slack) issues.push('disk-before-shot');
    }
  }
  if (input.cameraOffsetMinutes != null && input.placeOffsetMinutes != null) {
    checked += 1;
    if (input.cameraOffsetMinutes !== input.placeOffsetMinutes) issues.push('zone-differs');
  }
  return { checked, issues };
}
