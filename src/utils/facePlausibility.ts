/**
 * Plausibility gate for BlazeFace detections.
 *
 * BlazeFace short-range answers «face» for shiny blobs too: a helmet visor, a car roof under a
 * tree, a reflection in a window — usually with a score between 0.45 and 0.7 and keypoints that do
 * not form a face (an «ear» on an «eye», the nose off to the side). Measured on the fixtures, real
 * faces keep 0.93–0.95 at every size down to 28 px and their six keypoints sit where they should.
 *
 * A candidate passes when its keypoints form a face AND it has some corroboration: the model is
 * sure of it (`score` ≥ {@link FACE_STRONG_SCORE}), EfficientDet found a person under it, or a
 * face already accepted stands beside it at much the same size. One odd keypoint (a turned head
 * hides the far ear) is tolerated only for a sure face that belongs to a person. Anything weaker
 * is dropped: the brush covers what the models miss, a blurred car roof cannot be undone.
 *
 * The third kind of corroboration exists because the second is not always there. On a tight
 * selfie of five, EfficientDet named two people, so three real faces — clean keypoints, scores in
 * the 0.5–0.8 band — had nothing to vouch for them and were dropped. The page then showed two
 * «ЧЕЛОВЕК» boxes and two «ЛИЦО» boxes over five people, on different people at that. Faces in one
 * photograph of a group sit near each other and are about the same size, so they can vouch for
 * each other; a lone helmet on a road has no such neighbour.
 *
 * Use {@link selectPlausibleFaces} rather than calling the gate and the merge separately: the
 * order matters, and getting it the other way round silently loses faces (see its own note).
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

/** Above this score the face stands on its own; below it needs context underneath or beside it. */
export const FACE_STRONG_SCORE = 0.8;
/** A person box counts as context from this score (the same bar the preview uses for people). */
export const PERSON_CONTEXT_SCORE = 0.5;
/**
 * The floor for a face vouched for by its neighbours rather than by a person box.
 *
 * Measured on a five-person group photo: the eight BlazeFace candidates score 0.48–0.96 and every
 * one of them has clean keypoints. Five of the eight passed only because EfficientDet had found a
 * person under them — which is why a tight selfie, where EfficientDet finds two people out of
 * five, lost three real faces. On the negatives in the fixture set (a photo with no people, two
 * UI screenshots) BlazeFace returns no candidates at all, so this floor admits nothing there.
 */
export const FACE_SUPPORTED_SCORE = 0.5;
/**
 * What the two BlazeFace passes are asked for. It is the same number as
 * {@link FACE_SUPPORTED_SCORE} on purpose: a candidate that reaches this file has already cleared
 * the model's own bar, and the two must be changed together or the neighbour rule silently stops
 * admitting anything. Lowering it was measured and made no difference on the fixture set — 0.5,
 * 0.4 and 0.3 all give 5 faces on the group photo and 0 on every negative — so it stays where the
 * model's own default puts it.
 */
export const FACE_MODEL_MIN_CONFIDENCE = 0.5;
/** A neighbour vouches only if it is roughly the same size: faces in one photo of a group are. */
const NEIGHBOUR_SIZE_RATIO = 2.5;
/** …and near enough, measured in the neighbour's own diagonals. */
const NEIGHBOUR_REACH = 4;
/**
 * Above this share of the smaller box, two detections describe the same face. Measured: the
 * fragments BlazeFace returns inside a tight portrait sit at 1.0, while the two genuinely
 * different faces nearest each other on a group photo reach 0.0 — there is no contest.
 */
const MAX_CONTAINMENT = 0.6;

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

function intersectionArea(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

/** Intersection over union of two boxes; 0 when they do not overlap. */
export function overlapRatio(a: Rect, b: Rect): number {
  const intersection = intersectionArea(a, b);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * How much of the smaller box the larger one swallows.
 *
 * Intersection over union is the wrong question for a box inside a box, and BlazeFace produces
 * those: on a tight portrait it returned the whole face at 179 px and two fragments of it at 59
 * and 47 px, all with clean keypoints. Their IoU against the big box is 0.11 and 0.07 — far under
 * any sane merge threshold — so all three survived and the page drew three «ЛИЦО» labels over one
 * person, which is also how a photo ends up reporting more faces than people. Measured against
 * the smaller box instead, those same pairs read 1.0.
 */
export function containmentRatio(a: Rect, b: Rect): number {
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? intersectionArea(a, b) / smaller : 0;
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
export function pickDistinctFaces(
  candidates: readonly { box: Rect; score: number }[],
  maxOverlap = 0.4,
  maxContainment = MAX_CONTAINMENT
): number[] {
  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.score - a.candidate.score);
  const kept: number[] = [];
  for (const { candidate, index } of order) {
    const duplicate = kept.some((other) => {
      const box = candidates[other].box;
      return overlapRatio(candidate.box, box) > maxOverlap || containmentRatio(candidate.box, box) > maxContainment;
    });
    if (duplicate) continue;
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
 * Whether a BlazeFace detection should be shown and blurred as a face on its own evidence.
 * `persons` are the EfficientDet person boxes of the same frame that already passed
 * {@link PERSON_CONTEXT_SCORE}. A face that fails this may still be admitted by a neighbour —
 * see {@link selectPlausibleFaces}.
 */
export function isPlausibleFace(candidate: FaceCandidate, persons: readonly Rect[]): boolean {
  const anomalies = faceAnomalies(candidate);
  const strong = candidate.score >= FACE_STRONG_SCORE;
  const inPerson = persons.some((person) => centreInside(candidate.box, person));
  if (anomalies.length === 0) return strong || inPerson;
  if (anomalies.length === 1) return strong && inPerson;
  return false;
}

const diagonal = (box: Rect): number => Math.hypot(box.width, box.height);

const centre = (box: Rect): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Is `box` a plausible companion of `anchor` — close by and of a comparable size? */
export function isNeighbourOf(box: Rect, anchor: Rect): boolean {
  const a = diagonal(anchor);
  const b = diagonal(box);
  if (a <= 0 || b <= 0) return false;
  const ratio = a > b ? a / b : b / a;
  if (ratio > NEIGHBOUR_SIZE_RATIO) return false;
  const from = centre(anchor);
  const to = centre(box);
  return Math.hypot(to.x - from.x, to.y - from.y) <= a * NEIGHBOUR_REACH;
}

/**
 * The faces to show and blur, from every candidate the two passes produced.
 *
 * Three steps, and the order of the first two is the point:
 *
 * 1. Accept the candidates that stand on their own evidence ({@link isPlausibleFace}).
 * 2. Accept the ones a neighbour vouches for: clean keypoints, a score of at least
 *    {@link FACE_SUPPORTED_SCORE}, and an accepted face nearby at a comparable size.
 * 3. Only then merge the duplicates, because the two models see the same face twice.
 *
 * Merging first, which is what this code used to do, lets a candidate that is about to be
 * rejected suppress an overlapping one that would have passed — the loser of the merge is
 * gone before anything asks whether the winner is a face at all, and that face is then
 * neither drawn nor blurred.
 */
export function selectPlausibleFaces(candidates: readonly FaceCandidate[], persons: readonly Rect[]): number[] {
  const accepted = candidates.map((candidate) => isPlausibleFace(candidate, persons));

  // A neighbour may only be vouched for by a face accepted on its own evidence, so this does not
  // cascade: one admitted face cannot lend its authority onwards to a third.
  const anchors = candidates.filter((_, i) => accepted[i]).map((candidate) => candidate.box);
  if (anchors.length > 0) {
    candidates.forEach((candidate, i) => {
      if (accepted[i]) return;
      if (candidate.score < FACE_SUPPORTED_SCORE) return;
      if (faceAnomalies(candidate).length > 0) return;
      if (anchors.some((anchor) => isNeighbourOf(candidate.box, anchor))) accepted[i] = true;
    });
  }

  const survivors = candidates.map((candidate, i) => ({ candidate, i })).filter(({ i }) => accepted[i]);
  return pickDistinctFaces(survivors.map(({ candidate }) => candidate)).map((k) => survivors[k].i);
}
