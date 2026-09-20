import { describe, expect, it } from 'vitest';
import {
  distanceToFace,
  readFaces,
  recognisabilityOf,
  IED_RECOGNISABLE_BY_EYE,
  IED_STANDARD_MINIMUM,
  IED_STANDARD_PREFERRED
} from '../faceRecognisability';
import { FACE_LABEL, PERSON_LABEL, type BoundingBox } from '../../types/detection';

const face = (iedPx: number | undefined): BoundingBox => ({
  label: FACE_LABEL,
  score: 0.9,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...(iedPx == null ? {} : { iedPx })
});

describe('recognisabilityOf', () => {
  /*
   * The bands come from the biometric standards, not from taste: ISO/IEC 39794-5:2019 requires
   * 90 px between the eye centres, 19794-5:2011 prefers 120. They describe an enrolment image,
   * so the copy says «по биометрическому стандарту», never «узнать нельзя».
   */
  it('splits at the numbers the standards give', () => {
    expect(recognisabilityOf(IED_STANDARD_PREFERRED)).toBe('preferred');
    expect(recognisabilityOf(IED_STANDARD_PREFERRED - 1)).toBe('standard');
    expect(recognisabilityOf(IED_STANDARD_MINIMUM)).toBe('standard');
    expect(recognisabilityOf(IED_STANDARD_MINIMUM - 1)).toBe('human-only');
    expect(recognisabilityOf(IED_RECOGNISABLE_BY_EYE)).toBe('human-only');
    expect(recognisabilityOf(IED_RECOGNISABLE_BY_EYE - 1)).toBe('too-small');
  });

  it('a face of a handful of pixels is too small', () => {
    expect(recognisabilityOf(8)).toBe('too-small');
  });
});

describe('distanceToFace', () => {
  it('puts a selfie at arm’s length', () => {
    // 4032 px wide, 26 mm equivalent (an iPhone main camera), eyes 367 px apart.
    const metres = distanceToFace(367, 26, 4032, 3024);
    expect(metres).toBeGreaterThan(0.4);
    expect(metres).toBeLessThan(0.6);
  });

  it('halving the eye distance doubles the distance', () => {
    const near = distanceToFace(360, 26, 4032, 3024) as number;
    const far = distanceToFace(180, 26, 4032, 3024) as number;
    expect(far / near).toBeCloseTo(2, 1);
  });

  it('a longer lens means the subject was further away for the same face size', () => {
    const wide = distanceToFace(200, 24, 4032, 3024) as number;
    const tele = distanceToFace(200, 77, 4032, 3024) as number;
    expect(tele).toBeGreaterThan(wide);
  });

  it('uses the long side whichever way the phone was held', () => {
    expect(distanceToFace(200, 26, 4032, 3024)).toBe(distanceToFace(200, 26, 3024, 4032));
  });

  it('says nothing without a focal length rather than assuming one', () => {
    // A typical value would produce a number that reads as a measurement and is not.
    expect(distanceToFace(200, undefined, 4032, 3024)).toBeUndefined();
    expect(distanceToFace(200, 0, 4032, 3024)).toBeUndefined();
    expect(distanceToFace(200, Number.NaN, 4032, 3024)).toBeUndefined();
  });

  it('refuses inputs that are not measurements', () => {
    expect(distanceToFace(0, 26, 4032, 3024)).toBeUndefined();
    expect(distanceToFace(-5, 26, 4032, 3024)).toBeUndefined();
    expect(distanceToFace(200, 26, 0, 0)).toBeUndefined();
  });

  it('gives up past the range where the estimate means anything', () => {
    // A face a few pixels across puts the subject hundreds of metres away, which is the
    // detector's jitter speaking, not the photograph.
    expect(distanceToFace(2, 26, 4032, 3024)).toBeUndefined();
  });
});

describe('readFaces', () => {
  it('reads only faces, and only those with eyes', () => {
    const boxes: BoundingBox[] = [
      face(120),
      face(undefined),
      { label: PERSON_LABEL, score: 0.9, x: 0, y: 0, width: 10, height: 10, iedPx: 999 }
    ];
    const read = readFaces(boxes, 26, 4032, 3024);
    expect(read).toHaveLength(1);
    expect(read[0].iedPx).toBe(120);
  });

  it('puts the biggest face first — it is the one that matters', () => {
    const read = readFaces([face(30), face(140), face(80)], 26, 4032, 3024);
    expect(read.map((r) => r.iedPx)).toEqual([140, 80, 30]);
    expect(read.map((r) => r.level)).toEqual(['preferred', 'human-only', 'too-small']);
  });

  it('carries no distance when the file carries no focal length', () => {
    const read = readFaces([face(140)], undefined, 4032, 3024);
    expect(read[0].distanceMeters).toBeUndefined();
    expect(read[0].level).toBe('preferred');
  });

  it('is empty for a photo with no faces', () => {
    expect(readFaces([], 26, 4032, 3024)).toEqual([]);
  });
});
