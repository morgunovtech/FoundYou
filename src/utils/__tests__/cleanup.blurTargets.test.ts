import { describe, it, expect } from 'vitest';
import { selectBlurTargets } from '../cleanup';
import type { BoundingBox } from '../../types/detection';

function box(label: string, x: number, y: number, width: number, height: number, score = 0.9): BoundingBox {
  return { label, x, y, width, height, score };
}

function expectRegion(
  target: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number }
) {
  expect(target.x).toBeCloseTo(expected.x, 6);
  expect(target.y).toBeCloseTo(expected.y, 6);
  expect(target.width).toBeCloseTo(expected.width, 6);
  expect(target.height).toBeCloseTo(expected.height, 6);
}

describe('selectBlurTargets', () => {
  it('returns nothing for no detections or for labels that are neither face nor person', () => {
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

  it('falls back to the head area of a person without a detected face', () => {
    const person = box('person', 100, 100, 200, 400);
    const targets = selectBlurTargets([person]);
    expect(targets).toHaveLength(1);
    expect(targets[0].source).toBe('person');
    // pad = 400 * 0.08 = 32; 55 % width (110) centred at x = 200; upper 45 % (180) plus margins.
    expectRegion(targets[0], { x: 113, y: 80.8, width: 174, height: 228 });
    expect(targets[0].x + targets[0].width / 2).toBeCloseTo(person.x + person.width / 2, 6);
    expect(targets[0].y + targets[0].height).toBeLessThan(person.y + person.height * 0.6);
  });

  it('does not add the person fallback when a detected face lies inside the person box', () => {
    const person = box('person', 100, 100, 200, 400);
    const face = box('face', 170, 110, 60, 70); // centre (200, 145) is inside the person box
    const targets = selectBlurTargets([person, face]);
    expect(targets).toEqual([{ x: 170, y: 110, width: 60, height: 70, source: 'face' }]);
  });

  it('tolerates a padded face poking slightly out of a tight person box', () => {
    const person = box('person', 100, 100, 200, 400);
    const face = box('face', 170, 40, 60, 90); // centre y = 85, 15 px above the box: within 10 % of its height
    expect(selectBlurTargets([person, face]).map((t) => t.source)).toEqual(['face']);
  });

  it('keeps the fallback for a person whose face was not detected while another person has one', () => {
    const left = box('person', 0, 100, 200, 400);
    const right = box('person', 600, 100, 200, 400);
    const face = box('face', 70, 110, 60, 70); // inside `left` only
    const targets = selectBlurTargets([left, right, face]);
    expect(targets.map((t) => t.source)).toEqual(['face', 'person']);
    expect(targets[1].x + targets[1].width / 2).toBeCloseTo(right.x + right.width / 2, 6);
  });

  it('treats a face far outside the person box as belonging to nobody in it', () => {
    const person = box('person', 100, 100, 200, 400);
    const face = box('face', 500, 500, 60, 70);
    expect(selectBlurTargets([person, face]).map((t) => t.source)).toEqual(['face', 'person']);
  });

  it('does not filter by score — blurring more is the safe default for a privacy tool', () => {
    const targets = selectBlurTargets([box('face', 0, 0, 20, 20, 0.2), box('person', 100, 100, 50, 100, 0.3)]);
    expect(targets.map((t) => t.source)).toEqual(['face', 'person']);
  });

  it('never mutates the input boxes', () => {
    const face = box('face', 10, 10, 30, 30);
    const person = box('person', 300, 300, 100, 200);
    selectBlurTargets([face, person]);
    expect(face).toEqual(box('face', 10, 10, 30, 30));
    expect(person).toEqual(box('person', 300, 300, 100, 200));
  });
});
