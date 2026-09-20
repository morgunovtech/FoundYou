import type { PoiResult } from '../types/api';

/**
 * What the camera was pointed at.
 *
 * The photograph already says where the person stood and, on most iPhones, which way they were
 * facing; `stance.ts` also works out how wide the lens saw. Put together, those three answer a
 * question the «объекты рядом» list cannot: not what was near, but what was *in the frame*. A
 * café fifty metres behind the photographer is in that list and was never in the picture.
 *
 * Every number comes from the file and from the bearings the POI endpoint computed; nothing
 * extra is requested and no coordinates of anything are sent or received.
 */

export interface FramedPlace {
  name: string;
  category: string;
  distance: number;
  /** Degrees off the centre of the frame: 0 is dead ahead, positive is to the right. */
  offset: number;
}

/**
 * Without a focal length `fieldOfView` falls back to a typical 70°, and the heading itself is
 * written by the phone's compass, which is wrong by degrees rather than fractions. So the cone
 * is widened a little before anything is called «in frame»: the alternative — a place that was
 * plainly in the picture left out on a technicality — is the worse mistake of the two.
 */
export const HEADING_SLACK_DEGREES = 10;

/** Past this the object is a speck, if it is visible at all. Buildings do not read at 2 km. */
export const MAX_FRAMED_DISTANCE_METERS = 1200;

/** Signed difference between two bearings, in (−180, 180]. */
export function bearingOffset(from: number, to: number): number {
  const diff = (((to - from) % 360) + 360) % 360;
  return diff > 180 ? diff - 360 : diff;
}

/**
 * The places that fall inside the cone the camera saw, nearest first. Returns an empty list
 * when the photo carries no heading — which is most Android photos, and is the honest answer:
 * without a direction there is no way to tell what was in front from what was behind.
 */
export function placesInFrame(
  places: readonly PoiResult[],
  heading: number | null | undefined,
  fovDegrees: number | null | undefined
): FramedPlace[] {
  if (heading == null || !Number.isFinite(heading)) return [];
  const fov = Number.isFinite(fovDegrees ?? NaN) ? (fovDegrees as number) : 70;
  const halfCone = fov / 2 + HEADING_SLACK_DEGREES;

  return places
    .filter((place) => place.bearing != null && Number.isFinite(place.bearing))
    .filter((place) => place.distance <= MAX_FRAMED_DISTANCE_METERS)
    .map((place) => ({
      name: place.name,
      category: place.category,
      distance: place.distance,
      offset: bearingOffset(heading, place.bearing as number)
    }))
    .filter((place) => Math.abs(place.offset) <= halfCone)
    .sort((a, b) => a.distance - b.distance);
}
