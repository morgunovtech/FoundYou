import { beforeAll, describe, expect, it, vi } from 'vitest';
import { blurManualMasks } from '../cleanup';
import type { ManualMask } from '../../types/cleanup';

/*
 * `blurManualMasks` needs a real 2D context to rasterise, which the test environment has none of.
 * What is worth pinning here is the branch, not the pixels: a tap must reach the canvas as a disc
 * instead of being dropped. So the context is a spy and the test reads which path was taken.
 */
beforeAll(() => {
  // `paintBlurredRegion` falls back to the pixelate path without a DOM and reaches for a scratch
  // canvas. It is handed one that yields no context, so it returns after the branch under test
  // has already run — the clip path is what this file is about, not the blur itself.
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
});

function spyContext() {
  const calls: string[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push(`${name}(${args.map((a) => (typeof a === 'number' ? Math.round(a) : '…')).join(',')})`);
  };
  const ctx = {
    canvas: { width: 1000, height: 1000 },
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    clip: record('clip'),
    drawImage: record('drawImage'),
    filter: 'none',
    lineJoin: '',
    lineCap: ''
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const mask = (points: Array<{ x: number; y: number }>): ManualMask => ({ id: 'm', points, radius: 20 });
const source = {} as CanvasImageSource;

describe('blurManualMasks', () => {
  it('paints a tap as a disc instead of throwing the gesture away', () => {
    /*
     * The bug behind «рисование ручной маски не работает: точка ставится и всё». A finger that
     * presses and lifts sends pointerdown and pointerup with no pointermove in between (measured
     * with touch input in Chromium), so the stroke reached here with one point and the
     * «fewer than three points» rule dropped it without a mark.
     */
    const { ctx, calls } = spyContext();
    blurManualMasks(ctx, source, [mask([{ x: 400, y: 300 }])], 10);
    expect(calls.some((c) => c.startsWith('arc(400,300,20'))).toBe(true);
    expect(calls.some((c) => c.startsWith('lineTo'))).toBe(false);
    expect(calls).toContain('clip()');
  });

  it('a two-point stroke is a dab at its end, not a hairline', () => {
    const { ctx, calls } = spyContext();
    blurManualMasks(ctx, source, [mask([{ x: 100, y: 100 }, { x: 108, y: 104 }])], 10);
    expect(calls.some((c) => c.startsWith('arc(108,104'))).toBe(true);
  });

  it('a real stroke is still filled as a polygon', () => {
    const { ctx, calls } = spyContext();
    blurManualMasks(ctx, source, [mask([{ x: 10, y: 10 }, { x: 90, y: 20 }, { x: 60, y: 80 }])], 10);
    expect(calls).toContain('moveTo(10,10)');
    expect(calls.filter((c) => c.startsWith('lineTo'))).toHaveLength(2);
    expect(calls).toContain('closePath()');
    expect(calls.some((c) => c.startsWith('arc('))).toBe(false);
  });

  it('an empty stroke paints nothing at all', () => {
    const { ctx, calls } = spyContext();
    blurManualMasks(ctx, source, [mask([])], 10);
    expect(calls).toEqual([]);
    const empty = spyContext();
    blurManualMasks(empty.ctx, source, [], 10);
    expect(empty.calls).toEqual([]);
  });

  it('the disc is never smaller than the minimum mask size', () => {
    const { ctx, calls } = spyContext();
    blurManualMasks(ctx, source, [{ id: 'm', points: [{ x: 500, y: 500 }], radius: 1 }], 10);
    // MIN_MASK_SIZE / 2 = 6: a one-pixel brush would otherwise cover nothing.
    expect(calls.some((c) => c.startsWith('arc(500,500,6'))).toBe(true);
  });
});

/** Guards the assumption the spy rests on: the function bails out before touching the context. */
it('does not call into the context for an empty mask list', () => {
  const draw = vi.fn();
  blurManualMasks({ canvas: { width: 10, height: 10 }, save: draw } as unknown as CanvasRenderingContext2D, source, [], 1);
  expect(draw).not.toHaveBeenCalled();
});
