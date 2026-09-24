import { beforeAll, describe, expect, it, vi } from 'vitest';
import { blurManualMasks } from '../cleanup';
import type { ManualMask } from '../../types/cleanup';

/*
 * `blurManualMasks` needs real 2D contexts to rasterise, which the test environment has none
 * of. What is worth pinning is the shape, not the pixels: a tap is a disc of the brush radius,
 * a stroke is a band 2·radius wide with round caps plus the loop it closes, and the blurred
 * layer is kept only where that shape is (`destination-in`) before it lands on the picture.
 * So every context is a recorder and the tests read which calls were made, on which canvas.
 */

type Calls = string[];

const fmt = (args: unknown[]) =>
  args.map((a) => (typeof a === 'number' ? String(Math.round(a)) : typeof a === 'string' ? `'${a}'` : '…')).join(',');

/** A context that records every method call and property assignment under `tag`. */
function recorder(tag: string, calls: Calls, state: Record<string, unknown> = {}): CanvasRenderingContext2D {
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return (...args: unknown[]) => {
        calls.push(`${tag}.${String(prop)}(${fmt(args)})`);
        return undefined;
      };
    },
    set(target, prop, value) {
      target[prop as string] = value;
      calls.push(`${tag}.${String(prop)}=${typeof value === 'number' ? value : String(value)}`);
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
}

let calls: Calls = [];
let created = 0;

beforeAll(() => {
  // Every canvas the code creates hands back a recorder tagged c1, c2, … in creation order:
  // c1 is the blurred layer, c2 the shape, c3 the pixelate scratch canvas inside the blur.
  vi.stubGlobal('document', {
    createElement: () => {
      const tag = `c${++created}`;
      const canvas = { width: 0, height: 0, getContext: () => recorder(tag, calls, { canvas }) };
      return canvas;
    }
  });
});

function run(masks: ManualMask[], strength = 10): Calls {
  calls = [];
  created = 0;
  const main = recorder('main', calls, { canvas: { width: 1000, height: 1000 } });
  blurManualMasks(main, {} as CanvasImageSource, masks, strength);
  return calls;
}

const mask = (points: Array<{ x: number; y: number }>, radius = 20): ManualMask => ({ id: 'm', points, radius });

describe('blurManualMasks', () => {
  it('paints a tap as a disc of the brush radius instead of throwing the gesture away', () => {
    /*
     * The bug behind «рисование ручной маски не работает: точка ставится и всё». A finger that
     * presses and lifts sends pointerdown and pointerup with no pointermove in between (measured
     * with touch input in Chromium), so the stroke reached here with one point and the
     * «fewer than three points» rule dropped it without a mark.
     */
    const c = run([mask([{ x: 400, y: 300 }])]);
    expect(c).toContain('c2.arc(400,300,20,0,6)');
    expect(c).toContain('c2.fill()');
    expect(c.some((line) => line.startsWith('c2.lineTo'))).toBe(false);
    // The blurred layer is cut to the shape and only then drawn onto the picture, at the bounds' corner.
    expect(c.indexOf('c1.globalCompositeOperation=destination-in')).toBeLessThan(c.indexOf('c1.drawImage(…,0,0)'));
    expect(c).toContain('main.drawImage(…,379,279)');
  });

  it('a two-point stroke is a band, not a dab and not a hairline', () => {
    const c = run([mask([{ x: 100, y: 100 }, { x: 108, y: 104 }])]);
    expect(c).toContain('c2.moveTo(100,100)');
    expect(c).toContain('c2.lineTo(108,104)');
    expect(c).toContain('c2.stroke()');
    expect(c.some((line) => line.startsWith('c2.arc('))).toBe(false);
  });

  it('a stroke is the swept band of the dab — 2·radius wide, round caps — plus the loop it closes', () => {
    /*
     * The export used to clip to the *filled polygon* of the points: a near-straight swipe across
     * a name tag enclosed a sliver, and measured in Chromium it changed about a tenth of the pixels
     * the overlay had painted over. The overlay draws a stroke; so does the mask now.
     */
    const c = run([mask([{ x: 10, y: 10 }, { x: 90, y: 20 }, { x: 60, y: 80 }])]);
    expect(c).toContain('c2.lineWidth=40');
    expect(c).toContain('c2.lineCap=round');
    expect(c).toContain('c2.lineJoin=round');
    expect(c).toContain('c2.moveTo(10,10)');
    expect(c.filter((line) => line.startsWith('c2.lineTo'))).toHaveLength(2);
    expect(c).toContain('c2.closePath()');
    expect(c).toContain('c2.fill()');
    expect(c).toContain('c2.stroke()');
  });

  it('an empty stroke paints nothing at all', () => {
    expect(run([mask([])])).toEqual([]);
    expect(run([])).toEqual([]);
  });

  it('the disc is never smaller than the minimum mask size', () => {
    const c = run([mask([{ x: 500, y: 500 }], 1)]);
    // MIN_MASK_SIZE / 2 = 6: a one-pixel brush would otherwise cover nothing.
    expect(c).toContain('c2.arc(500,500,6,0,6)');
    expect(c).toContain('c2.lineWidth=12');
  });
});

/** Guards the assumption the recorders rest on: the function bails out before touching the context. */
it('does not call into the context for an empty mask list', () => {
  const draw = vi.fn();
  blurManualMasks({ canvas: { width: 10, height: 10 }, save: draw } as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, [], 1);
  expect(draw).not.toHaveBeenCalled();
});
