import { FACE_LABEL, type BoundingBox } from '../types/detection';

/**
 * How well a face in this photograph would serve a recognition system, and how far away the
 * camera was when it was taken.
 *
 * The detector already returns six keypoints per face and the pipeline already throws them away
 * after using them to reject helmets and reflections. Two of them — the eyes — answer a question
 * the box alone cannot: a face can fill a quarter of the frame and still be a smudge, or be small
 * and perfectly sharp. The distance between the pupils is the standard measure of how much of a
 * face a picture actually holds, and with the focal length it also gives the distance to the
 * subject, because the eyes of an adult are about 63 mm apart whoever they are.
 *
 * Everything here is arithmetic over numbers the browser already has. Nothing is sent anywhere,
 * and no face is compared with anything — this says how identifiable a face *is*, not whose.
 */

/** Average adult interpupillary distance. It varies by a few millimetres; the estimate is rough anyway. */
const EYE_DISTANCE_MM = 63;
/** The 35-mm frame the «equivalent» focal length refers to. */
const FRAME_WIDTH_MM = 36;

/**
 * Bands for what the pixel count is worth, from the biometric standards.
 *
 * ISO/IEC 39794-5:2019 requires at least 90 px between the eye centres for a face image used in
 * biometric interchange, and ISO/IEC 19794-5:2011 prefers 120 px or more. Those are requirements
 * for an *enrolment* photograph, not a statement about what a recogniser can do in the wild — a
 * system may well work below them — so the wording that goes with these bands says «по
 * биометрическому стандарту», never «узнать нельзя».
 */
export const IED_STANDARD_PREFERRED = 120;
export const IED_STANDARD_MINIMUM = 90;
/** Below this a face is a few dozen pixels across: a person who knows them may still recognise them. */
export const IED_RECOGNISABLE_BY_EYE = 40;

export type Recognisability = 'preferred' | 'standard' | 'human-only' | 'too-small';

export interface FaceReading {
  /** Distance between the pupils, in original-image pixels. */
  iedPx: number;
  level: Recognisability;
  /** Metres from the camera to that face; absent without a 35-mm equivalent focal length. */
  distanceMeters?: number;
}

export function recognisabilityOf(iedPx: number): Recognisability {
  if (iedPx >= IED_STANDARD_PREFERRED) return 'preferred';
  if (iedPx >= IED_STANDARD_MINIMUM) return 'standard';
  if (iedPx >= IED_RECOGNISABLE_BY_EYE) return 'human-only';
  return 'too-small';
}

/**
 * Distance from the camera to a face, by the pinhole rule.
 *
 * `focal35` is the focal length as it would be on a 36 mm-wide frame, so the picture's long side
 * stands for those 36 mm however the phone was held. `undefined` when the file gives no focal
 * length — a typical value would produce a number that looks like a measurement and is not.
 */
export function distanceToFace(
  iedPx: number,
  focal35mm: number | undefined,
  imageWidth: number,
  imageHeight: number
): number | undefined {
  if (!focal35mm || !Number.isFinite(focal35mm) || focal35mm <= 0) return undefined;
  const longSide = Math.max(imageWidth, imageHeight);
  if (!Number.isFinite(longSide) || longSide <= 0 || iedPx <= 0) return undefined;
  const mmPerPixel = FRAME_WIDTH_MM / longSide;
  const iedOnSensorMm = iedPx * mmPerPixel;
  if (iedOnSensorMm <= 0) return undefined;
  const metres = (focal35mm * EYE_DISTANCE_MM) / iedOnSensorMm / 1000;
  // Past a few dozen metres the estimate is dominated by the detector's own jitter on a face of
  // a few pixels, and «человек в 80 метрах» reads as a measurement it is not.
  return Number.isFinite(metres) && metres > 0 && metres < 50 ? metres : undefined;
}

/** A reading per detected face, largest first — the biggest face is the one that matters. */
export function readFaces(
  detections: readonly BoundingBox[],
  focal35mm: number | undefined,
  imageWidth: number,
  imageHeight: number
): FaceReading[] {
  return detections
    .filter((box) => box.label === FACE_LABEL && box.iedPx != null && box.iedPx > 0)
    .map((box) => {
      const iedPx = box.iedPx as number;
      return {
        iedPx,
        level: recognisabilityOf(iedPx),
        distanceMeters: distanceToFace(iedPx, focal35mm, imageWidth, imageHeight)
      };
    })
    .sort((a, b) => b.iedPx - a.iedPx);
}
