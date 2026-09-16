import { describe, it, expect } from 'vitest';
import { selectBlurTargets } from '../cleanup';
import type { BoundingBox } from '../../types/detection';

function box(label: string, x: number, y: number, width: number, height: number, score = 0.9): BoundingBox {
  return { label, x, y, width, height, score };
}

describe('selectBlurTargets', () => {
  it('returns nothing for no detections or for labels that are not faces', () => {
    expect(selectBlurTargets([])).toEqual([]);
    expect(selectBlurTargets([box('car', 0, 0, 100, 50), box('dog', 200, 200, 40, 40)])).toEqual([]);
  });

  it('blurs every face box exactly as detected — the hook already padded it', () => {
    const faces = [box('face', 100, 80, 60, 70), box('face', 400, 90, 50, 55)];
    expect(selectBlurTargets(faces)).toEqual([
      { x: 100, y: 80, width: 60, height: 70, source: 'face' },
      { x: 400, y: 90, width: 50, height: 55, source: 'face' }
    ]);
  });

  it('leaves people without a detected face alone: that is what the brush is for', () => {
    const person = box('person', 100, 100, 200, 400);
    const face = box('face', 170, 110, 60, 70);
    expect(selectBlurTargets([person])).toEqual([]);
    expect(selectBlurTargets([person, face])).toEqual([{ x: 170, y: 110, width: 60, height: 70, source: 'face' }]);
  });
});
