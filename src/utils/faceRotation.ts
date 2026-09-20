/*
 * Mapping a quarter-turn detection back onto the upright frame.
 *
 * BlazeFace is trained on upright faces and loses them once the head lies on its side: a photo
 * taken with the phone held sideways and no orientation tag, a person lying down, a picture of a
 * picture. EfficientDet still reports the person, so «people found, faces not» is the signal that
 * a second look is worth its cost — and the second look is the same model on the same frame turned
 * 90° each way. Everything downstream (`pickDistinctFaces`, `isPlausibleFace`, the blur brush)
 * works in upright canvas pixels, so the boxes and keypoints are turned back here first.
 *
 * Geometry, for an upright canvas W×H turned into a rotated canvas H×W:
 *   clockwise:        rotated (x, y) came from upright (y, H − x)
 *   counter-clockwise: rotated (x, y) came from upright (W − y, x)
 * Keypoints are normalised to their own canvas, which makes their inverse independent of the
 * size: clockwise (kx, ky) → (ky, 1 − kx), counter-clockwise → (1 − ky, kx).
 *
 * Platform note: the rotation is a canvas `translate`/`rotate` draw, supported identically in
 * Chrome and Safari; only the cost differs, which is why the pass is gated rather than always on.
 */

export type Quarter = 'cw' | 'ccw';

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointLike {
  x: number;
  y: number;
}

/** A box in the rotated canvas, in pixels, back into upright-canvas pixels. */
export function unrotateBox(box: RectLike, quarter: Quarter, upright: { width: number; height: number }): RectLike {
  if (quarter === 'cw') {
    return {
      x: box.y,
      y: upright.height - box.x - box.width,
      width: box.height,
      height: box.width
    };
  }
  return {
    x: upright.width - box.y - box.height,
    y: box.x,
    width: box.height,
    height: box.width
  };
}

/** A keypoint normalised to the rotated canvas, back into coordinates normalised to the upright one. */
export function unrotatePoint(point: PointLike, quarter: Quarter): PointLike {
  return quarter === 'cw' ? { x: point.y, y: 1 - point.x } : { x: 1 - point.y, y: point.x };
}

/**
 * Draws `source` turned a quarter-turn into a new canvas of swapped dimensions.
 *
 * Returns null when a 2D context cannot be had — the caller then simply skips the extra pass,
 * because a missing second look costs recall, never correctness.
 */
export function rotateCanvas(source: HTMLCanvasElement, quarter: Quarter): HTMLCanvasElement | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = source.height;
    canvas.height = source.width;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (quarter === 'cw') {
      // The upright image's top-left ends up at the rotated canvas's top-right.
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(source, 0, 0);
    return canvas;
  } catch (error) {
    console.warn('rotate-canvas', error);
    return null;
  }
}
