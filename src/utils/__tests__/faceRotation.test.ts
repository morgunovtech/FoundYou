import { describe, expect, it } from 'vitest';
import { unrotateBox, unrotatePoint, type Quarter } from '../faceRotation';

/** The upright analysis canvas used throughout: landscape, so the two turns are distinguishable. */
const UPRIGHT = { width: 800, height: 600 };

/** The forward rotation, written out independently so the inverse is checked against it, not itself. */
function rotatePoint(point: { x: number; y: number }, quarter: Quarter) {
  // Clockwise: upright (x, y) lands at (H − y, x) in the rotated canvas (H wide, W tall).
  return quarter === 'cw'
    ? { x: UPRIGHT.height - point.y, y: point.x }
    : { x: point.y, y: UPRIGHT.width - point.x };
}

describe('unrotateBox', () => {
  it('undoes a clockwise turn', () => {
    // A face at (100, 50) sized 40×60 in the upright frame. Rotated clockwise its corners are
    // (600−50, 100) = (550, 100) and (600−110, 140) = (490, 140), i.e. origin (490, 100), 60×40.
    const inRotated = { x: 490, y: 100, width: 60, height: 40 };
    expect(unrotateBox(inRotated, 'cw', UPRIGHT)).toEqual({ x: 100, y: 50, width: 40, height: 60 });
  });

  it('undoes a counter-clockwise turn', () => {
    // Same face: corners (50, 800−100) = (50, 700) and (110, 800−140) = (110, 660) → origin (50, 660).
    const inRotated = { x: 50, y: 660, width: 60, height: 40 };
    expect(unrotateBox(inRotated, 'ccw', UPRIGHT)).toEqual({ x: 100, y: 50, width: 40, height: 60 });
  });

  it('round-trips every corner of the frame', () => {
    const boxes = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 790, y: 590, width: 10, height: 10 },
      { x: 0, y: 590, width: 10, height: 10 },
      { x: 380, y: 280, width: 40, height: 40 }
    ];
    for (const quarter of ['cw', 'ccw'] as Quarter[]) {
      for (const box of boxes) {
        // Rotate the box forward by rotating its two corners, then map it back.
        const a = rotatePoint({ x: box.x, y: box.y }, quarter);
        const b = rotatePoint({ x: box.x + box.width, y: box.y + box.height }, quarter);
        const rotated = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y)
        };
        expect(unrotateBox(rotated, quarter, UPRIGHT)).toEqual(box);
      }
    }
  });

  it('keeps a box inside the frame it came from', () => {
    // Every box the model can report lies inside the rotated canvas (600×800); mapped back it must
    // lie inside the upright one (800×600), or the blur would be painted off the picture.
    const rotated = { x: 0, y: 0, width: 600, height: 800 };
    for (const quarter of ['cw', 'ccw'] as Quarter[]) {
      const back = unrotateBox(rotated, quarter, UPRIGHT);
      expect(back).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    }
  });
});

describe('unrotatePoint', () => {
  it('maps the normalised keypoints of a clockwise pass back', () => {
    // The rotated canvas's top-left is the upright canvas's bottom-left.
    expect(unrotatePoint({ x: 0, y: 0 }, 'cw')).toEqual({ x: 0, y: 1 });
    expect(unrotatePoint({ x: 1, y: 1 }, 'cw')).toEqual({ x: 1, y: 0 });
    expect(unrotatePoint({ x: 0.25, y: 0.5 }, 'cw')).toEqual({ x: 0.5, y: 0.75 });
  });

  it('maps a counter-clockwise pass back', () => {
    expect(unrotatePoint({ x: 0, y: 0 }, 'ccw')).toEqual({ x: 1, y: 0 });
    expect(unrotatePoint({ x: 1, y: 1 }, 'ccw')).toEqual({ x: 0, y: 1 });
    expect(unrotatePoint({ x: 0.25, y: 0.5 }, 'ccw')).toEqual({ x: 0.5, y: 0.25 });
  });

  it('agrees with the box mapping: a point inside a box stays inside it', () => {
    const upright = { x: 100, y: 50, width: 40, height: 60 };
    const inside = { x: 120, y: 80 };
    for (const quarter of ['cw', 'ccw'] as Quarter[]) {
      const a = rotatePoint({ x: upright.x, y: upright.y }, quarter);
      const b = rotatePoint({ x: upright.x + upright.width, y: upright.y + upright.height }, quarter);
      const rotatedBox = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y)
      };
      const rotatedPoint = rotatePoint(inside, quarter);
      // The model normalises keypoints to the rotated canvas: 600 wide, 800 tall.
      const normalised = { x: rotatedPoint.x / UPRIGHT.height, y: rotatedPoint.y / UPRIGHT.width };
      const back = unrotatePoint(normalised, quarter);
      const pixels = { x: back.x * UPRIGHT.width, y: back.y * UPRIGHT.height };
      expect(pixels.x).toBeCloseTo(inside.x, 6);
      expect(pixels.y).toBeCloseTo(inside.y, 6);
      const box = unrotateBox(rotatedBox, quarter, UPRIGHT);
      expect(pixels.x).toBeGreaterThanOrEqual(box.x);
      expect(pixels.x).toBeLessThanOrEqual(box.x + box.width);
      expect(pixels.y).toBeGreaterThanOrEqual(box.y);
      expect(pixels.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });
});
