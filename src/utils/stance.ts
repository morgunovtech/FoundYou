import type { StructuredMetadata } from '../types/metadata';
import { sunPosition, type SunPosition } from './sun';
import { parseWallClock, wallClockAsUtcDate } from './format';

/*
 * «How the photo was taken»: everything that can be derived from GPS, time and
 * camera tags without the network, plus two lookups (zone of the place for the
 * sun, terrain height). Pure functions; the component only maps the result to
 * text and to the diagram. The camera-clock-versus-place comparison lives in
 * `timeProfile.ts` and is shown in the «When the photo was taken» card.
 */

export type CompassPoint = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
const POINTS: CompassPoint[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compassPoint(degrees: number): CompassPoint {
  const normalised = ((degrees % 360) + 360) % 360;
  return POINTS[Math.round(normalised / 45) % 8];
}

export type CameraSide = 'front' | 'rear' | 'unknown';

/** iPhones and most Androids name the lens («… front camera 2.69mm f/1.9», «Front Camera»). */
export function cameraSide(lensModel?: string | null): CameraSide {
  if (!lensModel) return 'unknown';
  if (/\b(front|selfie|facetime)\b/i.test(lensModel)) return 'front';
  if (/\b(back|rear|main|wide|tele|ultra)\b/i.test(lensModel)) return 'rear';
  return 'unknown';
}

/**
 * Horizontal field of view in degrees, from the 35 mm-equivalent focal length
 * (36 mm frame width in landscape, 24 mm in portrait). Phone defaults when the
 * tag is missing: ~70° main camera, ~75° front camera.
 */
export function fieldOfView(
  focalLength35mm: number | undefined,
  orientation: StructuredMetadata['orientation'],
  side: CameraSide
): number {
  if (focalLength35mm && focalLength35mm > 0) {
    const frameWidth = orientation === 'portrait' ? 24 : 36;
    return Math.round(2 * Math.atan(frameWidth / (2 * focalLength35mm)) * (180 / Math.PI));
  }
  return side === 'front' ? 75 : 70;
}

export type Movement = 'still' | 'walking' | 'vehicle';

export function movement(speedKmh: number): Movement {
  if (speedKmh < 3) return 'still';
  if (speedKmh < 8) return 'walking';
  return 'vehicle';
}

export type SunPhase = 'night' | 'twilight' | 'low' | 'day';

/** Civil twilight ends at −6°; below ~10° shadows are long and the light is warm. */
export function sunPhase(altitude: number): SunPhase {
  if (altitude < -6) return 'night';
  if (altitude < 0) return 'twilight';
  if (altitude < 10) return 'low';
  return 'day';
}

export type RelativeDirection = 'front' | 'right' | 'behind' | 'left';

/** Where the sun is relative to the camera's viewing direction. */
export function relativeDirection(headingDegrees: number, azimuthDegrees: number): RelativeDirection {
  const diff = (((azimuthDegrees - headingDegrees) % 360) + 360) % 360;
  if (diff < 45 || diff >= 315) return 'front';
  if (diff < 135) return 'right';
  if (diff < 225) return 'behind';
  return 'left';
}

export type ElevationVerdict = 'ground' | 'above' | 'high' | 'below';

/** Consumer GPS altitude is ±10–30 m; anything within that band is «on the ground». */
export function elevationVerdict(
  gpsAltitude: number,
  terrain: number
): { difference: number; verdict: ElevationVerdict } {
  const difference = Math.round(gpsAltitude - terrain);
  if (difference > 150) return { difference, verdict: 'high' };
  if (difference > 30) return { difference, verdict: 'above' };
  if (difference < -30) return { difference, verdict: 'below' };
  return { difference, verdict: 'ground' };
}

export function parseOffsetMinutes(offset: string | null | undefined): number | null {
  if (!offset) return null;
  const match = /^([-+])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** Offset of an IANA zone at a given instant, in minutes east of UTC; null for an unknown zone. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part) return null;
    if (part === 'GMT' || part === 'UTC') return 0;
    const match = /^(?:GMT|UTC)([-+])(\d{1,2})(?::(\d{2}))?$/.exec(part);
    if (!match) return null;
    const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === '-' ? -minutes : minutes;
  } catch {
    return null;
  }
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** Wall clock `YYYY-MM-DDTHH:mm:ss` read as if it were UTC (a stable reference for offset arithmetic). */
function wallClockAsUtc(shotDateLocal: string): Date | null {
  const parts = parseWallClock(shotDateLocal);
  return parts ? wallClockAsUtcDate(parts) : null;
}

export type InstantSource = 'exif-offset' | 'gps-time' | 'place-zone' | 'longitude';

export interface ShotInstant {
  utc: Date;
  /** The camera's own clock offset from UTC, when it can be told. */
  cameraOffsetMinutes: number | null;
  source: InstantSource;
  /**
   * The offset was not measured but taken from the place's zone, because the wall clock minus
   * the GPS time did not land on any zone (see `resolveShotInstant`).
   */
  cameraOffsetAssumed?: boolean;
}

/**
 * How far off a quarter hour the wall clock minus the GPS time may be and still be read as a
 * zone. Zones come in quarter hours, so a right clock lands on one; a clock 8 minutes fast in
 * UTC+5 gave 308 → +05:15, «a quarter of an hour ahead of the place», and a drift of −7 minutes,
 * when the fact is +8 minutes in the same zone.
 */
export const GPS_ZONE_SLACK_MINUTES = 2;

type GpsLike = { lon: number; timestampUtc?: string };

/**
 * The true moment of capture. In order of trust: the EXIF offset tag, the GPS
 * receiver's UTC stamp (the camera's zone follows as wall clock minus GPS time),
 * the zone of the place, and finally a rough zone from the longitude.
 */
export function resolveShotInstant(
  metadata: { shotDateLocal?: string; utcOffset?: string | null; gps?: GpsLike },
  placeTimezone?: string | null
): ShotInstant | null {
  const local = metadata.shotDateLocal ? wallClockAsUtc(metadata.shotDateLocal) : null;
  const gpsUtc = metadata.gps?.timestampUtc ? new Date(metadata.gps.timestampUtc) : null;
  const gpsValid = gpsUtc != null && !Number.isNaN(gpsUtc.getTime());

  const exifOffset = parseOffsetMinutes(metadata.utcOffset);
  if (local && exifOffset != null) {
    return {
      utc: new Date(local.getTime() - exifOffset * 60_000),
      cameraOffsetMinutes: exifOffset,
      source: 'exif-offset'
    };
  }
  if (gpsValid) {
    if (local) {
      const diffMinutes = (local.getTime() - gpsUtc.getTime()) / 60_000;
      // A GPS stamp more than a day away from the wall clock belongs to another shot (stale fix).
      if (Math.abs(diffMinutes) <= 26 * 60) {
        const rounded = Math.round(diffMinutes / 15) * 15;
        if (Math.abs(diffMinutes - rounded) <= GPS_ZONE_SLACK_MINUTES) {
          return { utc: gpsUtc, cameraOffsetMinutes: rounded, source: 'gps-time' };
        }
        // Off any zone: the camera is presumed set to the place's zone and the whole residual is
        // its drift (`timeProfile` reports it); with no place known the zone stays unknown.
        const zone = placeTimezone ? zoneOffsetMinutes(placeTimezone, gpsUtc) : null;
        return { utc: gpsUtc, cameraOffsetMinutes: zone, source: 'gps-time', cameraOffsetAssumed: zone != null };
      }
    } else {
      return { utc: gpsUtc, cameraOffsetMinutes: null, source: 'gps-time' };
    }
  }
  if (!local) return null;
  if (placeTimezone) {
    const zone = zoneOffsetMinutes(placeTimezone, local);
    if (zone != null)
      return { utc: new Date(local.getTime() - zone * 60_000), cameraOffsetMinutes: null, source: 'place-zone' };
  }
  if (metadata.gps && Number.isFinite(metadata.gps.lon)) {
    const rough = Math.round(metadata.gps.lon / 15) * 60;
    return { utc: new Date(local.getTime() - rough * 60_000), cameraOffsetMinutes: null, source: 'longitude' };
  }
  return null;
}

export interface Stance {
  heading: { degrees: number; point: CompassPoint } | null;
  speedKmh: number | null;
  movement: Movement | null;
  orientation: StructuredMetadata['orientation'];
  cameraSide: CameraSide;
  fovDegrees: number;
  instant: ShotInstant | null;
  sun: (SunPosition & { phase: SunPhase; relative: RelativeDirection | null }) | null;
  elevation: { gps: number; terrain: number; difference: number; verdict: ElevationVerdict } | null;
}

export function buildStance(input: {
  metadata: StructuredMetadata;
  placeTimezone?: string | null;
  terrainElevation?: number | null;
}): Stance {
  const { metadata, placeTimezone, terrainElevation } = input;
  const gps = metadata.gps;
  const side = cameraSide(metadata.lensModel);
  const orientation = metadata.orientation ?? 'unknown';
  const heading =
    gps?.heading != null && Number.isFinite(gps.heading)
      ? { degrees: Math.round(gps.heading), point: compassPoint(gps.heading) }
      : null;
  const speedKmh = gps?.speed != null && Number.isFinite(gps.speed) ? Math.round(gps.speed) : null;
  const instant = resolveShotInstant(metadata, placeTimezone);

  let sun: Stance['sun'] = null;
  if (instant && gps) {
    const position = sunPosition(instant.utc, gps.lat, gps.lon);
    sun = {
      altitude: Math.round(position.altitude),
      azimuth: Math.round(position.azimuth),
      phase: sunPhase(position.altitude),
      relative: heading ? relativeDirection(heading.degrees, position.azimuth) : null
    };
  }

  let elevation: Stance['elevation'] = null;
  if (
    gps?.altitude != null &&
    Number.isFinite(gps.altitude) &&
    terrainElevation != null &&
    Number.isFinite(terrainElevation)
  ) {
    elevation = {
      gps: Math.round(gps.altitude),
      terrain: Math.round(terrainElevation),
      ...elevationVerdict(gps.altitude, terrainElevation)
    };
  }

  return {
    heading,
    speedKmh,
    movement: speedKmh == null ? null : movement(speedKmh),
    orientation,
    cameraSide: side,
    fovDegrees: fieldOfView(metadata.focalLength35mm, orientation, side),
    instant,
    sun,
    elevation
  };
}
