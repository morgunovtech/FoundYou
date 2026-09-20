/*
 * Straightening a photo so the text in it can be read.
 *
 * Tesseract reads lines, and it reads them level. Measured on a synthetic label — the same words,
 * the same shading, the same blur, only the angle changing — upright gives confidence 92 and all
 * eight words, and a 20° tilt gives 26 and none. Nothing else in the picture had to change: not
 * the lighting, not the focus, not the font. That is the whole of why a photo of a medicine box
 * held at an angle came back as «текст не обнаружен» while a screenshot of the very same app
 * yielded 33 fragments.
 *
 * Rotating the frame back fixes it completely: the same 20° tilt, straightened, returns to
 * confidence 93 and seven words. On the reported photograph it goes from nothing to
 * «TRITTICO, retard, 150, produz, oslobad, anjem».
 *
 * Two things had to be right for that to work, and both were found the hard way:
 *
 * 1. **Rotate without growing the canvas.** Padding the corners out to fit the rotated rectangle
 *    puts a large blank margin around a tilted block, and Tesseract's layout analysis then finds
 *    no text at all — an upright image rotated one way and back, which should be a no-op, went
 *    from 92 to 0. So the canvas keeps its size and the corners are cropped. Text near a corner
 *    can be lost; text that fills the frame, which is the case this exists for, is not.
 *
 * 2. **Measure the angle on the text, not on the room.** A projection profile over the whole
 *    frame answers 1° on the reported photo, because a bed, curtains and furniture carry far more
 *    edge energy than the letters do. Keeping only the tiles richest in *stroke-sized* detail
 *    answers 27°, which is the angle that reads. Same picture, same metric, only the region
 *    changed.
 *
 * Accuracy on the synthetic set, tiles on: eight angles from −28° to +27°, every one within 1°.
 * Cost: about 280 ms at 420 px, against roughly 2.2 s for one OCR pass in the same browser.
 *
 * Platform note: this is canvas 2D and `getImageData` only — no codec, no worker, no device API —
 * so Chrome and Safari run the same arithmetic. The cost scales with `maxSide`, not with the
 * photo, so a 50 MP file pays the same as a 2 MP one.
 */

export interface SkewOptions {
  /** Largest tilt considered, degrees each way. */
  range?: number;
  /** Angular resolution of the search. */
  step?: number;
  /** The analysis runs on a copy no larger than this, which is what makes it cheap. */
  maxSide?: number;
  /** The frame is divided into `tiles × tiles` cells for the text-energy ranking. */
  tiles?: number;
  /** Fraction of cells kept — the ones richest in stroke-sized detail. */
  keep?: number;
  /** Radius of the box blur subtracted to isolate stroke-sized detail. */
  highPassRadius?: number;
}

const DEFAULTS: Required<SkewOptions> = {
  range: 35,
  step: 2,
  maxSide: 420,
  tiles: 8,
  keep: 0.25,
  /*
   * 3 px at 420 px across. Measured: 2 and 3 both answer 27° on the reported photo, 5 collapses
   * back to 1° — at that radius a letter stroke survives the subtraction no better than a fold
   * of cloth does, and the room wins again.
   */
  highPassRadius: 3
};

/** Below this the picture is already straight enough to leave alone. */
export const SKEW_WORTH_FIXING_DEGREES = 4;

export interface Grid {
  data: Float64Array;
  width: number;
  height: number;
}

/**
 * Anything the preprocess step may hand over. It is only ever drawn from, never drawn onto, so an
 * `OffscreenCanvas` serves as well as a DOM one — and in Chromium the preprocess step prefers the
 * offscreen kind, which an `HTMLCanvasElement`-only signature quietly excluded from this whole
 * path.
 */
export type DrawableSource = CanvasImageSource & { width: number; height: number };

/** Luminance of a canvas, scaled so the analysis cost does not depend on the photo's size. */
export function toGrayscale(source: DrawableSource, maxSide: number): Grid {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: new Float64Array(0), width: 0, height: 0 };
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const data = new Float64Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    data[p] = 0.299 * pixels[p * 4] + 0.587 * pixels[p * 4 + 1] + 0.114 * pixels[p * 4 + 2];
  }
  return { data, width, height };
}

/**
 * Detail finer than `radius`: the image minus its own box blur.
 *
 * Letters are strokes a few pixels wide; a curtain, a duvet or a wall is not. Subtracting the
 * local mean keeps the first and cancels the second, which is what lets the angle be measured on
 * the writing instead of on the furniture.
 */
export function textEnergy(grid: Grid, radius: number): Float64Array {
  const { data, width: w, height: h } = grid;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y += 1) {
    for (let x = 1; x <= w; x += 1) {
      integral[y * (w + 1) + x] =
        data[(y - 1) * w + (x - 1)] +
        integral[(y - 1) * (w + 1) + x] +
        integral[y * (w + 1) + x - 1] -
        integral[(y - 1) * (w + 1) + x - 1];
    }
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(w - 1, x + radius);
      const y1 = Math.min(h - 1, y + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + x1 + 1] -
        integral[y0 * (w + 1) + x1 + 1] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      out[y * w + x] = Math.abs(data[y * w + x] - sum / area);
    }
  }
  return out;
}

/** Zeroes everything outside the `keep` fraction of cells with the most text energy. */
export function keepTextTiles(energy: Float64Array, width: number, height: number, tiles: number, keep: number): Float64Array {
  const tileW = Math.ceil(width / tiles);
  const tileH = Math.ceil(height / tiles);
  const ranked: Array<{ tx: number; ty: number; mean: number }> = [];
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = ty * tileH; y < Math.min(height, (ty + 1) * tileH); y += 1) {
        for (let x = tx * tileW; x < Math.min(width, (tx + 1) * tileW); x += 1) {
          sum += energy[y * width + x];
          count += 1;
        }
      }
      if (count > 0) ranked.push({ tx, ty, mean: sum / count });
    }
  }
  ranked.sort((a, b) => b.mean - a.mean);
  const take = Math.max(1, Math.round(ranked.length * keep));
  const chosen = new Set(ranked.slice(0, take).map((t) => t.ty * tiles + t.tx));
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const ty = Math.floor(y / tileH);
    for (let x = 0; x < width; x += 1) {
      if (chosen.has(ty * tiles + Math.floor(x / tileW))) out[y * width + x] = energy[y * width + x];
    }
  }
  return out;
}

/**
 * How line-like a set of row sums is: the sum of squared differences between neighbouring rows.
 *
 * Level text alternates between dense rows (the letters) and empty ones (the gaps), so the
 * profile is spiky; at any other angle the strokes smear across rows and it flattens. The squared
 * difference reads that sharpness directly, where plain variance also rewards a bright blob.
 */
export function profileSharpness(rows: Float64Array): number {
  if (rows.length < 2) return 0;
  let sum = 0;
  for (let y = 1; y < rows.length; y += 1) {
    const d = rows[y] - rows[y - 1];
    sum += d * d;
  }
  return sum / rows.length;
}

/**
 * Rotates a canvas about its centre, keeping its size. The corners are cropped rather than
 * padded — see the note at the top of this file on why padding destroys recognition.
 */
export function rotateInPlace(source: DrawableSource, degrees: number, background = '#808080'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('rotate-no-context');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

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

/** A point of the rotated canvas back to where it sits in the original. */
export function unrotatePoint(point: Point, degrees: number, size: { width: number; height: number }): Point {
  const rad = (-degrees * Math.PI) / 180;
  const cx = size.width / 2;
  const cy = size.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
  };
}

/**
 * A box found on the rotated canvas, back onto the original as an upright box around all four of
 * its mapped corners. The result is larger than the true tilted rectangle, which is the safe
 * direction: a blur that covers a little extra hides the text, one that covers a little less
 * leaves some of it readable.
 */
export function unrotateRect(rect: Rect, degrees: number, size: { width: number; height: number }): Rect {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ].map((corner) => unrotatePoint(corner, degrees, size));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export interface SkewResult {
  /** Degrees to rotate the picture by to bring its text level. Positive is clockwise. */
  angle: number;
  /** The score of every angle tried, for the bench and for debugging. */
  scores: Array<{ angle: number; score: number }>;
}

/** The angle the writing in this picture is tilted by, measured on the writing alone. */
export function detectSkew(source: DrawableSource, options: SkewOptions = {}): SkewResult {
  const { range, step, maxSide, tiles, keep, highPassRadius } = { ...DEFAULTS, ...options };
  const grid = toGrayscale(source, maxSide);
  if (grid.width === 0 || grid.height === 0) return { angle: 0, scores: [] };

  const energy = keepTextTiles(textEnergy(grid, highPassRadius), grid.width, grid.height, tiles, keep);

  // The energy map as a canvas, so the same rotation the picture will get is applied to the
  // measurement — including the cropped corners, which keeps the two honest about each other.
  const map = document.createElement('canvas');
  map.width = grid.width;
  map.height = grid.height;
  const mapCtx = map.getContext('2d');
  if (!mapCtx) return { angle: 0, scores: [] };
  const image = mapCtx.createImageData(grid.width, grid.height);
  let max = 1;
  for (const value of energy) if (value > max) max = value;
  for (let p = 0; p < energy.length; p += 1) {
    const v = Math.min(255, (energy[p] / max) * 255);
    image.data[p * 4] = v;
    image.data[p * 4 + 1] = v;
    image.data[p * 4 + 2] = v;
    image.data[p * 4 + 3] = 255;
  }
  mapCtx.putImageData(image, 0, 0);

  const scores: Array<{ angle: number; score: number }> = [];
  let best = { angle: 0, score: -Infinity };
  for (let angle = -range; angle <= range; angle += step) {
    const rotated = rotateInPlace(map, angle, '#000');
    const ctx = rotated.getContext('2d');
    if (!ctx) continue;
    const pixels = ctx.getImageData(0, 0, rotated.width, rotated.height).data;
    const rows = new Float64Array(rotated.height);
    for (let y = 0; y < rotated.height; y += 1) {
      let sum = 0;
      for (let x = 0; x < rotated.width; x += 1) sum += pixels[(y * rotated.width + x) * 4];
      rows[y] = sum / rotated.width;
    }
    const score = profileSharpness(rows);
    scores.push({ angle, score });
    if (score > best.score) best = { angle, score };
  }
  return { angle: best.angle, scores };
}
