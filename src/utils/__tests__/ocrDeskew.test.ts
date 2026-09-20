import { describe, expect, it } from 'vitest';
import { keepTextTiles, profileSharpness, unrotatePoint, unrotateRect, SKEW_WORTH_FIXING_DEGREES } from '../ocrDeskew';

/*
 * `detectSkew`, `toGrayscale` and `rotateInPlace` need a real 2D context and are measured in the
 * browser instead (the numbers are in the module's own comment). What is pinned here is the
 * arithmetic they rest on: the tile ranking, the profile score and the mapping that carries a
 * word's box back onto the unrotated photo.
 */

const SIZE = { width: 800, height: 600 };

describe('unrotatePoint', () => {
  it('leaves a point alone at zero degrees', () => {
    const p = unrotatePoint({ x: 100, y: 50 }, 0, SIZE);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });

  it('never moves the centre, whatever the angle', () => {
    for (const angle of [-30, -7, 12, 45]) {
      const p = unrotatePoint({ x: 400, y: 300 }, angle, SIZE);
      expect(p.x).toBeCloseTo(400, 6);
      expect(p.y).toBeCloseTo(300, 6);
    }
  });

  it('undoes the rotation the page applied', () => {
    // Rotating a point clockwise about the centre and mapping it back must return it exactly.
    const rotate = (pt: { x: number; y: number }, deg: number) => {
      const rad = (deg * Math.PI) / 180;
      const dx = pt.x - SIZE.width / 2;
      const dy = pt.y - SIZE.height / 2;
      return {
        x: SIZE.width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad),
        y: SIZE.height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad)
      };
    };
    for (const angle of [-27, -12, 5, 20]) {
      const start = { x: 210, y: 140 };
      const back = unrotatePoint(rotate(start, angle), angle, SIZE);
      expect(back.x).toBeCloseTo(start.x, 6);
      expect(back.y).toBeCloseTo(start.y, 6);
    }
  });
});

describe('unrotateRect', () => {
  it('returns the same box at zero degrees', () => {
    const r = unrotateRect({ x: 10, y: 20, width: 100, height: 40 }, 0, SIZE);
    expect(r.x).toBeCloseTo(10, 6);
    expect(r.y).toBeCloseTo(20, 6);
    expect(r.width).toBeCloseTo(100, 6);
    expect(r.height).toBeCloseTo(40, 6);
  });

  it('grows the box rather than shrinking it — a blur must never fall short of the word', () => {
    const word = { x: 300, y: 250, width: 160, height: 40 };
    const back = unrotateRect(word, 25, SIZE);
    expect(back.width).toBeGreaterThan(word.width);
    expect(back.height).toBeGreaterThan(word.height);
    // The mapped centre still sits where the rotation puts it.
    const centre = unrotatePoint({ x: word.x + word.width / 2, y: word.y + word.height / 2 }, 25, SIZE);
    expect(back.x + back.width / 2).toBeCloseTo(centre.x, 6);
    expect(back.y + back.height / 2).toBeCloseTo(centre.y, 6);
  });

  it('covers every corner of the tilted word', () => {
    const word = { x: 100, y: 100, width: 200, height: 30 };
    const angle = -18;
    const back = unrotateRect(word, angle, SIZE);
    for (const corner of [
      { x: word.x, y: word.y },
      { x: word.x + word.width, y: word.y },
      { x: word.x, y: word.y + word.height },
      { x: word.x + word.width, y: word.y + word.height }
    ]) {
      const mapped = unrotatePoint(corner, angle, SIZE);
      expect(mapped.x).toBeGreaterThanOrEqual(back.x - 1e-6);
      expect(mapped.x).toBeLessThanOrEqual(back.x + back.width + 1e-6);
      expect(mapped.y).toBeGreaterThanOrEqual(back.y - 1e-6);
      expect(mapped.y).toBeLessThanOrEqual(back.y + back.height + 1e-6);
    }
  });
});

describe('profileSharpness', () => {
  it('scores a spiky profile — text lines and gaps — above a flat one', () => {
    const lines = new Float64Array([0, 200, 0, 200, 0, 200, 0, 200]);
    const flat = new Float64Array([100, 100, 100, 100, 100, 100, 100, 100]);
    expect(profileSharpness(lines)).toBeGreaterThan(profileSharpness(flat));
    expect(profileSharpness(flat)).toBe(0);
  });

  it('scores smeared lines below sharp ones of the same total energy', () => {
    // Rows of letters after a wrong rotation: the same ink spread across neighbours.
    const sharp = new Float64Array([0, 0, 240, 0, 0, 240, 0, 0]);
    const smeared = new Float64Array([40, 80, 120, 80, 40, 80, 120, 80]);
    expect(profileSharpness(sharp)).toBeGreaterThan(profileSharpness(smeared));
  });

  it('a profile too short to have neighbours scores nothing', () => {
    expect(profileSharpness(new Float64Array([5]))).toBe(0);
    expect(profileSharpness(new Float64Array([]))).toBe(0);
  });
});

describe('keepTextTiles', () => {
  /** A 4×4-tile grid, 40×40 px, with one loud cell in the bottom-right corner. */
  function grid(): { energy: Float64Array; width: number; height: number } {
    const width = 40;
    const height = 40;
    const energy = new Float64Array(width * height).fill(1);
    for (let y = 30; y < 40; y += 1) for (let x = 30; x < 40; x += 1) energy[y * width + x] = 100;
    return { energy, width, height };
  }

  it('keeps the loud cell and silences the quiet ones', () => {
    const { energy, width, height } = grid();
    const kept = keepTextTiles(energy, width, height, 4, 0.0625); // 1 of 16 cells
    expect(kept[35 * width + 35]).toBe(100);
    expect(kept[5 * width + 5]).toBe(0);
  });

  it('keeps at least one cell however small the fraction', () => {
    const { energy, width, height } = grid();
    const kept = keepTextTiles(energy, width, height, 4, 0);
    expect(kept.some((v) => v > 0)).toBe(true);
  });

  it('keeping everything changes nothing', () => {
    const { energy, width, height } = grid();
    expect(Array.from(keepTextTiles(energy, width, height, 4, 1))).toEqual(Array.from(energy));
  });

  it('this is what separates the writing from the room', () => {
    /*
     * On the reported photograph a projection profile over the whole frame answered 1°, because a
     * bed, curtains and furniture carry more edge energy than the letters. With the ranking on it
     * answered 27°, which is the angle that reads. The unit test can only pin the mechanism.
     */
    const width = 40;
    const height = 40;
    const energy = new Float64Array(width * height);
    // A broad, low «room» across the top half and a small, bright «label» bottom-left.
    for (let y = 0; y < 20; y += 1) for (let x = 0; x < width; x += 1) energy[y * width + x] = 20;
    for (let y = 30; y < 40; y += 1) for (let x = 0; x < 10; x += 1) energy[y * width + x] = 200;

    // The label's cell is kept before any of the room's, however few cells are taken.
    const one = keepTextTiles(energy, width, height, 4, 0.0625);
    expect(one[35 * width + 5]).toBe(200);
    expect(one.reduce((n, v) => n + (v === 20 ? 1 : 0), 0)).toBe(0);

    // The ranking is by mean energy, so the room ranks above the empty half — but never above
    // the label. That ordering is the whole mechanism: the angle is measured on the writing.
    const quarter = keepTextTiles(energy, width, height, 4, 0.25);
    expect(quarter[35 * width + 5]).toBe(200);
    let emptyKept = 0;
    for (let y = 20; y < 30; y += 1) for (let x = 0; x < width; x += 1) if (quarter[y * width + x] !== 0) emptyKept += 1;
    expect(emptyKept).toBe(0);
  });
});

describe('SKEW_WORTH_FIXING_DEGREES', () => {
  it('is small enough to catch a real tilt and large enough to ignore noise', () => {
    // Measured: recognition is unharmed to about 5°, and gone by 12°.
    expect(SKEW_WORTH_FIXING_DEGREES).toBeGreaterThan(1);
    expect(SKEW_WORTH_FIXING_DEGREES).toBeLessThan(10);
  });
});
