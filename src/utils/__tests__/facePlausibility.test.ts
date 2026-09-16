import { describe, it, expect } from 'vitest';
import { faceAnomalies, isPlausibleFace, type FaceCandidate, type Point, type Rect } from '../facePlausibility';

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
