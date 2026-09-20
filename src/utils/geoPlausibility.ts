import type { MessageKey } from '../i18n';

/*
 * Whether the coordinates and the altitude in the file can be true.
 *
 * A GPS tag is written by the phone without any sanity check of its own, so a chip that never got
 * a fix, a test build or a doctored file all end up as a perfectly formatted pair of numbers the
 * page then reports as a place. These checks say when the numbers do not describe a place anyone
 * could have stood in, and they never guess: each one names what is wrong, and the card keeps
 * showing the value next to it.
 *
 * Platform note: nothing here is browser-specific — the values come from EXIF on both Android and
 * iOS, and «0, 0» in particular is what a phone writes when it saves a photo with the location
 * permission on but no fix yet, on either platform.
 */

export type GeoDoubt = 'null-island' | 'polar' | 'altitude-high' | 'altitude-low' | 'sea-level-exact';

export interface GeoDoubtEntry {
  kind: GeoDoubt;
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** Everest is 8849 m; above this an EXIF altitude is an artefact, not a photo from a mountain. */
const MAX_PLAUSIBLE_ALTITUDE = 9000;
/** The Dead Sea shore is −430 m, the deepest mine about −4000 m. */
const MIN_PLAUSIBLE_ALTITUDE = -4500;
/** Closer to a pole than this and a consumer photo is essentially always a bad fix. */
const POLAR_LATITUDE = 89.5;
/** «Null island» is the classic no-fix value; allow for the rounding a phone may apply. */
const NULL_ISLAND_EPSILON = 0.0005;

export function checkGeoPlausibility(
  coords: { lat: number; lon: number } | null | undefined,
  altitude: number | null | undefined
): GeoDoubtEntry[] {
  const doubts: GeoDoubtEntry[] = [];
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
    if (Math.abs(coords.lat) < NULL_ISLAND_EPSILON && Math.abs(coords.lon) < NULL_ISLAND_EPSILON) {
      doubts.push({ kind: 'null-island', key: 'geoDoubtNullIsland' });
    } else if (Math.abs(coords.lat) >= POLAR_LATITUDE) {
      doubts.push({ kind: 'polar', key: 'geoDoubtPolar' });
    }
  }
  if (altitude != null && Number.isFinite(altitude)) {
    if (altitude > MAX_PLAUSIBLE_ALTITUDE) {
      doubts.push({ kind: 'altitude-high', key: 'geoDoubtAltitudeHigh', params: { altitude: Math.round(altitude) } });
    } else if (altitude < MIN_PLAUSIBLE_ALTITUDE) {
      doubts.push({ kind: 'altitude-low', key: 'geoDoubtAltitudeLow', params: { altitude: Math.round(altitude) } });
    }
  }
  return doubts;
}
