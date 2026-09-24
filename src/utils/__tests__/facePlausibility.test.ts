import { describe, it, expect } from 'vitest';
import {
  containmentRatio,
  faceAnomalies,
  isPlausibleFace,
  overlapRatio,
  pickDistinctFaces,
  selectPlausibleFaces,
  type FaceCandidate,
  type Point,
  type Rect
} from '../facePlausibility';

// Keypoints measured with BlazeFace short-range on public/test/face.jpg (the ESA astronaut
// portrait) at the 640×800 analysis size: the real face and the golden helmet visor.
const astronautBox: Rect = { x: 332, y: 174, width: 114, height: 114 };
const astronautKeypoints: Point[] = [
  { x: 365, y: 207 },
  { x: 407, y: 205 },
  { x: 383, y: 231 },
  { x: 385, y: 256 },
  { x: 343, y: 219 },
  { x: 440, y: 218 }
];
const helmetBox: Rect = { x: 159, y: 480, width: 115, height: 115 };
const helmetKeypoints: Point[] = [
  { x: 201, y: 538 },
  { x: 219, y: 514 },
  { x: 239, y: 528 },
  { x: 251, y: 542 },
  { x: 177, y: 573 },
  { x: 218, y: 511 }
];
/** EfficientDet's person box on the same frame (score 0.82). */
const astronautPerson: Rect = { x: 4, y: 81, width: 624, height: 708 };

function candidate(box: Rect, keypoints: Point[], score: number): FaceCandidate {
  return { box, keypoints, score };
}

function rotate(points: Point[], centre: Point, degrees: number): Point[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map((p) => {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos };
  });
}

function mirror(points: Point[], width: number): Point[] {
  return points.map((p) => ({ x: width - p.x, y: p.y }));
}

describe('overlapRatio / pickDistinctFaces', () => {
  const box = (x: number, y: number, size: number) => ({ x, y, width: size, height: size });

  it('measures overlap as intersection over union', () => {
    expect(overlapRatio(box(0, 0, 10), box(0, 0, 10))).toBe(1);
    expect(overlapRatio(box(0, 0, 10), box(20, 20, 10))).toBe(0);
    // Half of each box overlaps: 50 / 150.
    expect(overlapRatio(box(0, 0, 10), box(5, 0, 10))).toBeCloseTo(1 / 3, 5);
  });

  it('keeps one box per face when the two passes both found it, preferring the surer one', () => {
    const candidates = [
      { box: box(100, 100, 60), score: 0.7 }, // full range
      { box: box(104, 98, 62), score: 0.9 }, // short range, same face
      { box: box(400, 300, 50), score: 0.6 } // a second face only one pass saw
    ];
    const kept = pickDistinctFaces(candidates);
    expect(kept).toEqual([1, 2]);
  });

  it('keeps faces that merely stand next to each other', () => {
    const candidates = [
      { box: box(100, 100, 60), score: 0.8 },
      { box: box(165, 100, 60), score: 0.8 }
    ];
    expect(pickDistinctFaces(candidates)).toEqual([0, 1]);
  });

  it('returns indices in input order so the detections stay paired with their keypoints', () => {
    const candidates = [
      { box: box(0, 0, 40), score: 0.5 },
      { box: box(200, 0, 40), score: 0.95 },
      { box: box(400, 0, 40), score: 0.7 }
    ];
    expect(pickDistinctFaces(candidates)).toEqual([0, 1, 2]);
  });
});

describe('faceAnomalies', () => {
  it('finds nothing wrong with the astronaut face', () => {
    expect(faceAnomalies(candidate(astronautBox, astronautKeypoints, 0.928))).toEqual([]);
  });

  it('is invariant to head tilt and mirrored selfies', () => {
    const centre = { x: 389, y: 231 };
    for (const degrees of [-40, -15, 20, 45, 90, 180]) {
      expect(faceAnomalies(candidate(astronautBox, rotate(astronautKeypoints, centre, degrees), 0.9))).toEqual([]);
    }
    expect(
      faceAnomalies(candidate({ ...astronautBox, x: 640 - 332 - 114 }, mirror(astronautKeypoints, 640), 0.9))
    ).toEqual([]);
  });

  it('catches the helmet visor: an ear sitting on an eye', () => {
    expect(faceAnomalies(candidate(helmetBox, helmetKeypoints, 0.644))).toEqual(['ear-inside-eye']);
  });

  it('flags a nose on the eye line, a mouth above the nose and a nose far off to the side', () => {
    const noseOnEyeLine = astronautKeypoints.map((p, i) => (i === 2 ? { x: 386, y: 206 } : p));
    expect(faceAnomalies(candidate(astronautBox, noseOnEyeLine, 0.9))).toContain('nose-on-eye-line');

    const mouthAboveNose = astronautKeypoints.map((p, i) => (i === 3 ? { x: 385, y: 215 } : p));
    expect(faceAnomalies(candidate(astronautBox, mouthAboveNose, 0.9))).toContain('mouth-above-nose');

    const noseOffCentre = astronautKeypoints.map((p, i) => (i === 2 ? { x: 420, y: 231 } : p));
    expect(faceAnomalies(candidate(astronautBox, noseOffCentre, 0.9))).toContain('nose-off-centre');
  });

  it('flags eyes that are far too close or too far apart for the box', () => {
    const tiny = astronautKeypoints.map((p, i) => (i === 0 ? { x: 400, y: 205 } : p));
    expect(faceAnomalies(candidate(astronautBox, tiny, 0.9))).toContain('eye-spacing');
    const wide = astronautKeypoints.map((p, i) => (i === 1 ? { x: 470, y: 205 } : p));
    expect(faceAnomalies(candidate(astronautBox, wide, 0.9))).toContain('eye-spacing');
  });

  it('cannot judge without the six keypoints', () => {
    expect(faceAnomalies(candidate(astronautBox, [], 0.9))).toEqual([]);
    expect(faceAnomalies(candidate(astronautBox, astronautKeypoints.slice(0, 4), 0.9))).toEqual([]);
  });
});

describe('isPlausibleFace', () => {
  it('keeps the astronaut face with or without the person box', () => {
    const face = candidate(astronautBox, astronautKeypoints, 0.928);
    expect(isPlausibleFace(face, [astronautPerson])).toBe(true);
    expect(isPlausibleFace(face, [])).toBe(true);
  });

  it('drops the helmet visor even though it sits inside the astronaut', () => {
    expect(isPlausibleFace(candidate(helmetBox, helmetKeypoints, 0.644), [astronautPerson])).toBe(false);
    expect(isPlausibleFace(candidate(helmetBox, helmetKeypoints, 0.644), [])).toBe(false);
  });

  it('keeps a small, hesitant face when a person is found under it, drops it when nothing is', () => {
    const groupFace = candidate(
      { x: 40, y: 40, width: 28, height: 28 },
      scaleTo(astronautKeypoints, astronautBox, 40, 40, 28),
      0.6
    );
    expect(isPlausibleFace(groupFace, [{ x: 20, y: 30, width: 80, height: 200 }])).toBe(true);
    expect(isPlausibleFace(groupFace, [])).toBe(false);
  });

  it('keeps a strong selfie face even when EfficientDet is unsure about the person', () => {
    const selfie = candidate(
      { x: 100, y: 120, width: 400, height: 400 },
      scaleTo(astronautKeypoints, astronautBox, 100, 120, 400),
      0.947
    );
    expect(isPlausibleFace(selfie, [])).toBe(true);
  });

  it('tolerates one odd keypoint only for a sure face that belongs to a person', () => {
    const turned = candidate(
      astronautBox,
      astronautKeypoints.map((p, i) => (i === 5 ? { x: 409, y: 210 } : p)),
      0.9
    );
    expect(faceAnomalies(turned)).toEqual(['ear-inside-eye']);
    expect(isPlausibleFace(turned, [astronautPerson])).toBe(true);
    expect(isPlausibleFace(turned, [])).toBe(false);
    expect(isPlausibleFace({ ...turned, score: 0.7 }, [astronautPerson])).toBe(false);
  });

  it('never keeps two anomalies', () => {
    const scrambled = astronautKeypoints.map((p, i) =>
      i === 2 ? { x: 386, y: 206 } : i === 5 ? { x: 409, y: 210 } : p
    );
    expect(isPlausibleFace(candidate(astronautBox, scrambled, 0.99), [astronautPerson])).toBe(false);
  });

  it('falls back to score and person context when the keypoints are missing', () => {
    const blind = candidate(astronautBox, [], 0.6);
    expect(isPlausibleFace(blind, [astronautPerson])).toBe(true);
    expect(isPlausibleFace(blind, [])).toBe(false);
    expect(isPlausibleFace({ ...blind, score: 0.85 }, [])).toBe(true);
  });
});

/** Moves the astronaut keypoints into another box of the given size (uniform scale). */
function scaleTo(points: Point[], from: Rect, x: number, y: number, size: number): Point[] {
  const k = size / from.width;
  return points.map((p) => ({ x: x + (p.x - from.x) * k, y: y + (p.y - from.y) * k }));
}

describe('containmentRatio', () => {
  it('reads a box inside a box as fully contained, where IoU reads almost nothing', () => {
    /*
     * The measurement behind the rule. On a tight portrait BlazeFace returned the whole face at
     * 179 px and two fragments of it at 59 and 47 px. Against the big box their IoU is 0.11 and
     * 0.07 — under any sane merge threshold — so all three survived and the page drew three
     * «ЛИЦО» labels over one person, which is also how a photo reports more faces than people.
     */
    const whole: Rect = { x: 9, y: 0, width: 179, height: 179 };
    const fragment: Rect = { x: 56, y: 11, width: 59, height: 59 };
    expect(overlapRatio(whole, fragment)).toBeLessThan(0.15);
    expect(containmentRatio(whole, fragment)).toBe(1);
  });

  it('two genuinely different faces contain nothing of each other', () => {
    // The two nearest faces on the five-person group photo, at their measured boxes.
    const a: Rect = { x: 58, y: 240, width: 134, height: 134 };
    const b: Rect = { x: 383, y: 302, width: 111, height: 111 };
    expect(containmentRatio(a, b)).toBe(0);
  });

  it('is symmetric and safe on empty boxes', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const b: Rect = { x: 25, y: 25, width: 50, height: 50 };
    expect(containmentRatio(a, b)).toBe(containmentRatio(b, a));
    expect(containmentRatio(a, { x: 0, y: 0, width: 0, height: 0 })).toBe(0);
  });
});

describe('pickDistinctFaces: nested duplicates', () => {
  it('drops a fragment sitting inside an accepted face', () => {
    const kept = pickDistinctFaces([
      { box: { x: 9, y: 0, width: 179, height: 179 }, score: 0.83 },
      { box: { x: 56, y: 11, width: 59, height: 59 }, score: 0.45 },
      { box: { x: 126, y: 45, width: 47, height: 47 }, score: 0.33 }
    ]);
    expect(kept).toEqual([0]);
  });

  it('keeps faces that merely sit side by side', () => {
    const kept = pickDistinctFaces([
      { box: { x: 58, y: 240, width: 134, height: 134 }, score: 0.95 },
      { box: { x: 383, y: 302, width: 111, height: 111 }, score: 0.76 },
      { box: { x: 600, y: 340, width: 108, height: 108 }, score: 0.48 }
    ]);
    expect(kept).toEqual([0, 1, 2]);
  });
});

describe('selectPlausibleFaces', () => {
  /** A face-shaped candidate of the given size and score, centred at (cx, cy). */
  function faceAt(cx: number, cy: number, size: number, score: number): FaceCandidate {
    const box: Rect = { x: cx - size / 2, y: cy - size / 2, width: size, height: size };
    const s = size / 114; // the astronaut keypoints scaled to this box
    const kp = astronautKeypoints.map((p) => ({
      x: cx + (p.x - (astronautBox.x + 57)) * s,
      y: cy + (p.y - (astronautBox.y + 57)) * s
    }));
    return candidate(box, kp, score);
  }

  it('a face inside an animal box and no person box is the animal’s and is dropped', () => {
    /*
     * The sample photograph: a dog beside a person. BlazeFace answered «face» for the dog's
     * muzzle at 0.63, the person's face vouched for it as a neighbour of comparable size, and the
     * page drew «ЛИЦО» on the dog. The person box is checked first, so someone holding a cat
     * keeps their face.
     */
    const person = faceAt(400, 100, 120, 0.95);
    const dogFace = faceAt(160, 240, 110, 0.63);
    const dogBox: Rect = { x: 40, y: 150, width: 260, height: 300 };
    expect(selectPlausibleFaces([person, dogFace], [], [dogBox])).toEqual([0]);
    // Held in someone's arms: the face sits in a person box too, and stays.
    const personBox: Rect = { x: 0, y: 0, width: 600, height: 600 };
    expect(selectPlausibleFaces([person, dogFace], [personBox], [dogBox])).toEqual([0, 1]);
  });

  it('admits a mid-confidence face when a sure one stands beside it', () => {
    /*
     * The reported case: a tight selfie of five where EfficientDet named two people, so three
     * real faces — clean keypoints, scores in the 0.5–0.8 band — had nothing to vouch for them.
     * The page showed two «ЛИЦО» and two «ЧЕЛОВЕК» boxes over five people.
     */
    const faces = [faceAt(100, 100, 120, 0.95), faceAt(260, 120, 110, 0.62), faceAt(410, 110, 115, 0.55)];
    expect(selectPlausibleFaces(faces, [])).toEqual([0, 1, 2]);
  });

  it('a lone mid-confidence face with no neighbour and no person box is still refused', () => {
    // A helmet on an empty road has nothing to vouch for it, which is the point of the gate.
    expect(selectPlausibleFaces([faceAt(100, 100, 120, 0.62)], [])).toEqual([]);
  });

  it('a neighbour of a wildly different size does not vouch', () => {
    const faces = [faceAt(100, 100, 300, 0.95), faceAt(700, 600, 40, 0.55)];
    expect(selectPlausibleFaces(faces, [])).toEqual([0]);
  });

  it('vouching does not cascade from one admitted face to the next', () => {
    // 0 is sure; 1 is admitted by 0; 2 is far from 0 and must not ride in on 1.
    const faces = [faceAt(100, 100, 100, 0.95), faceAt(300, 100, 100, 0.6), faceAt(900, 100, 100, 0.6)];
    expect(selectPlausibleFaces(faces, [])).toEqual([0, 1]);
  });

  it('gates before merging, so a reject cannot suppress a face that would have passed', () => {
    /*
     * The ordering bug. The helmet scores higher than the real face beside it and overlaps it
     * enough to win a merge; merging first removed the face, and only then did the gate throw
     * the helmet away too — leaving the person neither outlined nor blurred.
     */
    const helmet = candidate({ x: 100, y: 100, width: 120, height: 120 }, helmetKeypoints.map((p) => ({ x: p.x - 59, y: p.y - 380 })), 0.75);
    const real = faceAt(150, 150, 120, 0.9);
    const kept = selectPlausibleFaces([helmet, real], []);
    expect(kept).toEqual([1]);
  });

  it('keeps refusing what the old gate refused: a helmet with a person under it', () => {
    const helmet = candidate(helmetBox, helmetKeypoints, 0.62);
    expect(selectPlausibleFaces([helmet], [astronautPerson])).toEqual([]);
  });
});
