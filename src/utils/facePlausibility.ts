/**
 * Plausibility gate for BlazeFace detections.
 *
 * BlazeFace short-range answers «face» for shiny blobs too: a helmet visor, a car roof under a
 * tree, a reflection in a window — usually with a score between 0.45 and 0.7 and keypoints that do
 * not form a face (an «ear» on an «eye», the nose off to the side). Measured on the fixtures, real
 * faces keep 0.93–0.95 at every size down to 28 px and their six keypoints sit where they should.
 *
 * A candidate passes when its keypoints form a face AND either the model is sure (`score` ≥
 * {@link FACE_STRONG_SCORE}) or EfficientDet found a person under it. One odd keypoint (a turned
 * head hides the far ear) is tolerated only for a sure face that belongs to a person. Anything
 * weaker is dropped: the brush covers what the models miss, a blurred car roof cannot be undone.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceCandidate {
  /** The unpadded BlazeFace box, in the pixels of the analysis frame. */
  box: Rect;
  score: number;
  /**
   * BlazeFace keypoints in the same pixel frame, in model order: right eye, left eye, nose tip,
   * mouth centre, right ear tragion, left ear tragion. Fewer than six means «cannot judge».
   */
  keypoints: Point[];
}

/** Above this score the face stands on its own; below it needs a person box underneath. */
export const FACE_STRONG_SCORE = 0.8;
/** A person box counts as context from this score (the same bar the preview uses for people). */
export const PERSON_CONTEXT_SCORE = 0.5;

export type FaceAnomaly =
  'eye-spacing' | 'nose-on-eye-line' | 'mouth-above-nose' | 'nose-off-centre' | 'ear-inside-eye';

const KEYPOINT_COUNT = 6;
/** Interocular distance as a fraction of the box width: real faces measure 0.28–0.43. */
const MIN_EYE_SPACING = 0.15;
const MAX_EYE_SPACING = 0.7;
/** Nose tip below the eye line by at least this many interocular distances (real: ≈0.6). */
const MIN_NOSE_DROP = 0.15;
/** Mouth further from the eye line than the nose by at least this (real: ≈0.6). */
const MIN_MOUTH_BELOW_NOSE = 0.1;
/** Nose tip sideways from the eye midpoint, in interocular distances (real: ≈0.1). */
const MAX_NOSE_OFFSET = 0.6;
/** Each ear outside its eye: at least this far from the midpoint along the eye line (real: 1.0–1.3). */
const MIN_EAR_OFFSET = 0.6;

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function diff(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Geometry checks on the six keypoints, expressed in the face's own frame (the eye line as the
 * horizontal axis, «down» on the side of the nose) so an upright, tilted or mirrored face reads
 * the same. Returns every rule the candidate breaks; an empty list means «looks like a face».
 */
export function faceAnomalies(candidate: FaceCandidate): FaceAnomaly[] {
  const kp = candidate.keypoints;
  if (kp.length < KEYPOINT_COUNT) return [];
  const [eyeR, eyeL, nose, mouth, earR, earL] = kp;
  const anomalies: FaceAnomaly[] = [];

  const eyeVector = diff(eyeL, eyeR);
  const spacing = Math.hypot(eyeVector.x, eyeVector.y);
  const width = Math.max(candidate.box.width, 1);
  if (spacing < MIN_EYE_SPACING * width || spacing > MAX_EYE_SPACING * width) {
    anomalies.push('eye-spacing');
  }
  if (spacing <= 0) return anomalies;

  // Unit axes: `along` from the right eye to the left eye, `down` towards the nose.
  const along = { x: eyeVector.x / spacing, y: eyeVector.y / spacing };
  const mid = { x: (eyeR.x + eyeL.x) / 2, y: (eyeR.y + eyeL.y) / 2 };
  const noseRel = diff(nose, mid);
  let down = { x: -along.y, y: along.x };
  if (dot(noseRel, down) < 0) down = { x: -down.x, y: -down.y };

  const noseDrop = dot(noseRel, down) / spacing;
  const mouthDrop = dot(diff(mouth, mid), down) / spacing;
  if (noseDrop < MIN_NOSE_DROP) anomalies.push('nose-on-eye-line');
  if (mouthDrop < noseDrop + MIN_MOUTH_BELOW_NOSE) anomalies.push('mouth-above-nose');
  if (Math.abs(dot(noseRel, along)) / spacing > MAX_NOSE_OFFSET) anomalies.push('nose-off-centre');

  const earROffset = dot(diff(earR, mid), along) / spacing;
  const earLOffset = dot(diff(earL, mid), along) / spacing;
  if (earROffset > -MIN_EAR_OFFSET || earLOffset < MIN_EAR_OFFSET) anomalies.push('ear-inside-eye');

  return anomalies;
}

/** Intersection over union of two boxes; 0 when they do not overlap. */
export function overlapRatio(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = x * y;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Which of several BlazeFace candidates to keep when two passes looked at the same frame.
 *
 * The two models are blind to each other's case, measured on a five-person group photo and on a
 * crop of one face from it: short range finds 2 of the 5 faces in the group and the close-up at
 * 0.83, full range finds all 5 in the group (0.70–0.96) and the close-up not at all — it is
 * trained for faces that are small in the frame, the other for faces that fill it. So both run
 * and the lists are merged here: the higher score wins wherever two boxes describe one face.
 */
export function pickDistinctFaces(candidates: readonly { box: Rect; score: number }[], maxOverlap = 0.4): number[] {
  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.score - a.candidate.score);
  const kept: number[] = [];
  for (const { candidate, index } of order) {
    if (kept.some((other) => overlapRatio(candidate.box, candidates[other].box) > maxOverlap)) continue;
    kept.push(index);
  }
  return kept.sort((a, b) => a - b);
}

function centreInside(box: Rect, container: Rect): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return (
    cx >= container.x &&
    cx <= container.x + container.width &&
    cy >= container.y &&
    cy <= container.y + container.height
  );
}

/**
 * Whether a BlazeFace detection should be shown and blurred as a face. `persons` are the
 * EfficientDet person boxes of the same frame that already passed {@link PERSON_CONTEXT_SCORE}.
 */
export function isPlausibleFace(candidate: FaceCandidate, persons: readonly Rect[]): boolean {
  const anomalies = faceAnomalies(candidate);
  const strong = candidate.score >= FACE_STRONG_SCORE;
  const inPerson = persons.some((person) => centreInside(candidate.box, person));
  if (anomalies.length === 0) return strong || inPerson;
  if (anomalies.length === 1) return strong && inPerson;
  return false;
}
