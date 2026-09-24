import type { AntiSearchParams, ManualMask } from '../types/cleanup';
import { FACE_LABEL, type BoundingBox } from '../types/detection';
import { hammingDistance, phashFromImage } from './phash';
import type { OCRRegion } from '../hooks/useOCR';

export interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_MASK_SIZE = 12;
/** Fewer points than this is a tap: a dab of the brush. Two points already make a band. */
const MIN_MASK_POINTS = 2;

/* ── blur engine: CSS filter where it works, resampling elsewhere ── */

export type CanvasBlurMode = 'filter' | 'pixelate';

let blurModeCache: CanvasBlurMode | null = null;

/**
 * WebKit before Safari 18 either has no `filter` on the 2D context or accepts
 * the assignment and ignores it, so every blur silently became a plain redraw
 * while the UI claimed the region was hidden. Probe once: the property must be
 * on the prototype, the assignment must stick, and a blurred 1px dot must
 * actually bleed into its neighbour pixel.
 */
export function canvasBlurMode(): CanvasBlurMode {
  if (blurModeCache) return blurModeCache;
  blurModeCache = detectFilterSupport() ? 'filter' : 'pixelate';
  return blurModeCache;
}

function detectFilterSupport(): boolean {
  try {
    if (typeof document === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') return false;
    if (!('filter' in CanvasRenderingContext2D.prototype)) return false;
    const probe = document.createElement('canvas');
    probe.width = 5;
    probe.height = 5;
    const ctx = probe.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 5, 5);
    ctx.filter = 'blur(1px)';
    const sticks = typeof ctx.filter === 'string' && ctx.filter !== 'none' && ctx.filter !== '';
    ctx.fillStyle = '#000000';
    ctx.fillRect(2, 2, 1, 1);
    ctx.filter = 'none';
    if (!sticks) return false;
    const neighbour = ctx.getImageData(1, 2, 1, 1).data;
    return neighbour[0] < 250;
  } catch {
    return false;
  }
}

/** Block size for the resampling fallback; strength is the CSS blur radius in px. */
function pixelateFactor(strength: number): number {
  return Math.max(2, Math.round(strength / 2));
}

/** A Gaussian is gone past 3σ: a blurred layer wider than that no longer fades inside the region. */
const BLEED_SIGMAS = 3;

/** Width and height of what is being blurred; every source this file is handed is a canvas or a bitmap. */
function sourceSize(source: CanvasImageSource, fallback: { width: number; height: number }): { width: number; height: number } {
  const candidate = source as { width?: unknown; height?: unknown };
  const width = typeof candidate.width === 'number' ? candidate.width : fallback.width;
  const height = typeof candidate.height === 'number' ? candidate.height : fallback.height;
  return { width, height };
}

/**
 * The region grown by `bleed` on every side, as its own canvas. Where the padding would reach
 * past the picture, the picture is mirrored into it: the blur then samples pixels on every
 * side of the region, at the very edge of the frame as in the middle of it.
 */
function paddedSourceLayer(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  region: BlurRegion,
  bleed: number
): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const x = Math.floor(region.x - bleed);
  const y = Math.floor(region.y - bleed);
  const width = Math.ceil(region.width + bleed * 2);
  const height = Math.ceil(region.height + bleed * 2);
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (const fy of [-1, 0, 1]) {
    for (const fx of [-1, 0, 1]) {
      // The tile the picture (or its mirror image) occupies, in picture coordinates.
      const tileX = fx * sourceWidth;
      const tileY = fy * sourceHeight;
      if (tileX >= x + width || tileX + sourceWidth <= x || tileY >= y + height || tileY + sourceHeight <= y) continue;
      // A mirrored tile is the picture drawn with a negative scale: `-u` lands at 0…−W for the
      // left neighbour, `2W − u` at W…2W for the right one; the same for the rows.
      const scaleX = fx === 0 ? 1 : -1;
      const scaleY = fy === 0 ? 1 : -1;
      const translateX = fx === 1 ? 2 * sourceWidth : 0;
      const translateY = fy === 1 ? 2 * sourceHeight : 0;
      ctx.setTransform(scaleX, 0, 0, scaleY, translateX - x, translateY - y);
      ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, x, y };
}

/**
 * Draws `region` of `source` back onto `ctx` blurred. The caller owns the
 * clip and the save/restore pair. With filter support this is the classic
 * `filter: blur()` redraw; otherwise the region is shrunk into a tiny canvas
 * and stretched back with smoothing, which hides detail just as reliably.
 *
 * The filter path does not draw the region alone. The blur samples a layer that is transparent
 * outside whatever was drawn, so a layer the exact size of the region fades to α ≈ 0.5 at its
 * edge and the original shows through a band about 2σ wide — measured on 40 px text with the
 * default 28 px blur, the letters stayed as dark ghosts. The layer is therefore the region
 * padded by 3σ (mirrored where it would leave the picture), and the caller's clip cuts it
 * back to the region.
 */
function paintBlurredRegion(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  region: BlurRegion,
  strength: number
) {
  const { x, y, width, height } = region;
  if (canvasBlurMode() === 'filter') {
    const bleed = Math.max(1, Math.round(strength)) * BLEED_SIGMAS;
    const picture = sourceSize(source, ctx.canvas);
    const padded = paddedSourceLayer(source, picture.width, picture.height, region, bleed);
    if (!padded) return;
    ctx.filter = `blur(${Math.round(strength)}px)`;
    ctx.drawImage(padded.canvas, padded.x, padded.y);
    ctx.filter = 'none';
    return;
  }
  const factor = pixelateFactor(strength);
  const smallWidth = Math.max(1, Math.round(width / factor));
  const smallHeight = Math.max(1, Math.round(height / factor));
  const tiny = document.createElement('canvas');
  tiny.width = smallWidth;
  tiny.height = smallHeight;
  const tctx = tiny.getContext('2d');
  if (!tctx) return;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(source, x, y, width, height, 0, 0, smallWidth, smallHeight);
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tiny, 0, 0, smallWidth, smallHeight, x, y, width, height);
  ctx.imageSmoothingEnabled = previousSmoothing;
}

/** Blurs one rectangle of `source` in place on `ctx`, picking filter or pixelate. */
export function blurRegion(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  region: BlurRegion,
  strength: number
) {
  const clamped = clampRect(region, ctx.canvas.width, ctx.canvas.height);
  if (!clamped) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clamped.x, clamped.y, clamped.width, clamped.height);
  ctx.clip();
  paintBlurredRegion(ctx, source, clamped, strength);
  ctx.restore();
}

/** Whole-canvas low-pass copy used by the PRNU pass (filter or downscale/upscale). */
function blurredCopy(canvas: HTMLCanvasElement, radiusPx: number): HTMLCanvasElement {
  const { width, height } = canvas;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  if (canvasBlurMode() === 'filter') {
    ctx.filter = `blur(${radiusPx}px)`;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    return out;
  }
  const factor = Math.max(2, Math.round(radiusPx * 1.2));
  const smallWidth = Math.max(1, Math.round(width / factor));
  const smallHeight = Math.max(1, Math.round(height / factor));
  const tiny = document.createElement('canvas');
  tiny.width = smallWidth;
  tiny.height = smallHeight;
  const tctx = tiny.getContext('2d');
  if (!tctx) {
    throw new Error('canvas');
  }
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(canvas, 0, 0, width, height, 0, 0, smallWidth, smallHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tiny, 0, 0, smallWidth, smallHeight, 0, 0, width, height);
  return out;
}

function clampRect(rect: BlurRegion, maxWidth: number, maxHeight: number): BlurRegion | null {
  const x = Math.max(0, Math.min(rect.x, maxWidth));
  const y = Math.max(0, Math.min(rect.y, maxHeight));
  const width = Math.max(0, Math.min(rect.width, maxWidth - x));
  const height = Math.max(0, Math.min(rect.height, maxHeight - y));
  if (width < MIN_MASK_SIZE || height < MIN_MASK_SIZE) {
    return null;
  }
  return { x, y, width, height };
}

/* ── blur targets: detected faces first, person boxes as fallback ── */

export type BlurTargetSource = 'face' | 'person';

export interface BlurTarget extends BlurRegion {
  /** `face` — a padded FaceDetector box blurred as is; `person` — head-area fallback for a person box with no face inside. */
  source: BlurTargetSource;
}

/**
 * Chooses what «hide faces» blurs: every `face` box as is (the detector output is already
 * padded). Person boxes are ignored on purpose: the owner asked for faces only; a person seen
 * from the back or in a mask is covered with the brush. Pure — no canvas — so it is unit-tested.
 */
export function selectBlurTargets(detections: BoundingBox[]): BlurTarget[] {
  return detections
    .filter((det) => det.label === FACE_LABEL)
    .map((face) => ({ x: face.x, y: face.y, width: face.width, height: face.height, source: 'face' as const }));
}

export function blurDetections(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  detections: BoundingBox[],
  strength: number
) {
  for (const target of selectBlurTargets(detections)) {
    blurRegion(ctx, source, target, strength);
  }
}

export function blurManualMasks(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  masks: ManualMask[],
  strength: number
) {
  if (masks.length === 0) return;

  const { width, height } = ctx.canvas;

  masks.forEach((mask) => {
    if (mask.points.length === 0) return;

    const radius = Math.max(mask.radius, MIN_MASK_SIZE / 2);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of mask.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    // The band reaches `radius` past the points on every side, plus a pixel for the anti-aliased rim.
    const pad = radius + 1;
    const bounds = clampRect(
      { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 },
      width,
      height
    );
    if (!bounds) return;

    /*
     * What the brush covers is the shape the overlay draws, and nothing narrower. It used to be
     * the *filled polygon* of the stroke's points (`clip()` takes a fill region): a near-straight
     * swipe across a name tag enclosed a sliver, and measured in Chromium the export changed
     * about a tenth of the pixels the overlay had painted over. So the mask is rasterised the way
     * the overlay is — the swept band of a moving dab (a stroke of width 2·radius with round caps
     * and joins) together with the inside of the loop the points close — and it is applied with
     * `destination-in`, which keeps the union of the two, where a clip could only intersect them.
     */
    const blurred = document.createElement('canvas');
    blurred.width = bounds.width;
    blurred.height = bounds.height;
    const blurredCtx = blurred.getContext('2d');
    const shape = document.createElement('canvas');
    shape.width = bounds.width;
    shape.height = bounds.height;
    const shapeCtx = shape.getContext('2d');
    if (!blurredCtx || !shapeCtx) return;

    blurredCtx.translate(-bounds.x, -bounds.y);
    paintBlurredRegion(blurredCtx, source, bounds, strength);

    shapeCtx.translate(-bounds.x, -bounds.y);
    shapeCtx.fillStyle = '#000';
    shapeCtx.strokeStyle = '#000';
    shapeCtx.lineJoin = 'round';
    shapeCtx.lineCap = 'round';
    shapeCtx.lineWidth = radius * 2;
    shapeCtx.beginPath();
    if (mask.points.length < MIN_MASK_POINTS) {
      /*
       * A tap. It used to be dropped without a word: a finger that presses and lifts sends
       * pointerdown and pointerup with no pointermove in between (measured with touch input in
       * Chromium), so tapping a spot to cover it painted the draft on the overlay and then lost
       * it. A brush dab is a disc of the brush radius.
       */
      const centre = mask.points[mask.points.length - 1];
      shapeCtx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      shapeCtx.fill();
    } else {
      shapeCtx.moveTo(mask.points[0].x, mask.points[0].y);
      for (let i = 1; i < mask.points.length; i += 1) {
        shapeCtx.lineTo(mask.points[i].x, mask.points[i].y);
      }
      shapeCtx.closePath();
      shapeCtx.fill();
      shapeCtx.stroke();
    }

    blurredCtx.setTransform(1, 0, 0, 1, 0, 0);
    blurredCtx.globalCompositeOperation = 'destination-in';
    blurredCtx.drawImage(shape, 0, 0);
    ctx.drawImage(blurred, bounds.x, bounds.y);
  });
}

function seededRandom(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}


export function generateAntiSearchParams({ level }: { level: number }): AntiSearchParams {
  const safeLevel = Math.max(1, Math.min(level, 3));
  const seed = Math.floor(Math.random() * 1_000_000) + Date.now();
  const rand = seededRandom(seed);
  const baseCrop = safeLevel + 1;
  const crop = {
    top: 1 + Math.floor(rand() * baseCrop),
    right: 1 + Math.floor(rand() * baseCrop),
    bottom: 1 + Math.floor(rand() * baseCrop),
    left: 1 + Math.floor(rand() * baseCrop)
  };
  const rotation = ((rand() - 0.5) * Math.PI) / (180 / (0.6 + safeLevel * 0.15));
  const noiseAmplitude = 3 + safeLevel * 2.5;
  const brightnessShift = (rand() - 0.5) * 0.04 * safeLevel;
  const contrastShift = (rand() - 0.5) * 0.05 * safeLevel;
  const warpStrength = 0.004 * safeLevel + rand() * 0.002;
  return {
    crop,
    rotation,
    noiseSeed: seed,
    noiseAmplitude,
    brightnessShift,
    contrastShift,
    warpStrength,
    cropPercent: 0.004 + 0.008 * safeLevel,
    fieldAmplitude: 0.02 + 0.015 * safeLevel
  };
}

/**
 * The perceptual hash reads the low-frequency luminance structure, which per-pixel noise and
 * colour shifts leave alone. A smooth field of a few broad light and dark patches, faint enough
 * to pass for uneven lighting, is what moves its bits. Deterministic for a seed; values in [−1, 1].
 */
export function smoothField(width: number, height: number, seed: number): Float32Array {
  const grid = smoothFieldGrid(seed);
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x++) field[y * width + x] = sampleField(grid, (x + 0.5) / width, ny);
  }
  return field;
}

/** Cells per side of the coarse field; the blobs are far wider than a cell, so bilinear sampling loses nothing. */
export const FIELD_GRID = 48;

/**
 * The field on a coarse grid, normalised to [−1, 1]. Evaluating the Gaussians on every pixel
 * of a 40-megapixel export cost seconds and a 160 MB buffer; the grid is 2 304 values and the
 * pixel loop samples it bilinearly.
 */
export function smoothFieldGrid(seed: number): Float32Array {
  const rand = seededRandom(seed + 31);
  const blobs = Array.from({ length: 3 }, () => ({
    cx: 0.15 + rand() * 0.7,
    cy: 0.15 + rand() * 0.7,
    sigma: 0.2 + rand() * 0.25,
    sign: rand() < 0.5 ? -1 : 1
  }));
  const grid = new Float32Array(FIELD_GRID * FIELD_GRID);
  let peak = 1e-6;
  for (let y = 0; y < FIELD_GRID; y++) {
    const ny = (y + 0.5) / FIELD_GRID;
    for (let x = 0; x < FIELD_GRID; x++) {
      const nx = (x + 0.5) / FIELD_GRID;
      let v = 0;
      for (const b of blobs) {
        const dx = nx - b.cx;
        const dy = ny - b.cy;
        v += b.sign * Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
      }
      grid[y * FIELD_GRID + x] = v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] /= peak;
  return grid;
}

/** Bilinear sample of the coarse field at normalised picture coordinates (0–1). */
export function sampleField(grid: Float32Array, nx: number, ny: number): number {
  const gx = Math.min(FIELD_GRID - 1, Math.max(0, nx * FIELD_GRID - 0.5));
  const gy = Math.min(FIELD_GRID - 1, Math.max(0, ny * FIELD_GRID - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(FIELD_GRID - 1, x0 + 1);
  const y1 = Math.min(FIELD_GRID - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const top = grid[y0 * FIELD_GRID + x0] * (1 - fx) + grid[y0 * FIELD_GRID + x1] * fx;
  const bottom = grid[y1 * FIELD_GRID + x0] * (1 - fx) + grid[y1 * FIELD_GRID + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Minimum Hamming distance (of 64 bits) the export must reach for each level; ≥ 10 stops reverse image search. */
export const ANTI_SEARCH_TARGET_BITS: Record<number, number> = { 1: 10, 2: 14, 3: 18 };

export function antiSearchTargetBits(level: number): number {
  return ANTI_SEARCH_TARGET_BITS[Math.max(1, Math.min(3, Math.round(level)))];
}

export interface MeasuredAntiSearch {
  canvas: HTMLCanvasElement;
  /** Distance between the input and the output hashes; null when the canvas could not be hashed. */
  distance: number | null;
  /** The parameters that produced the output (amplitude and crop grow until the target is met). */
  params: AntiSearchParams;
}

/**
 * Applies the anti-search transform and checks the result against the perceptual hash of the
 * input, strengthening the smooth field and the crop until the distance reaches the target or
 * the visual budget is spent. The best attempt is returned either way.
 */
export function applyAntiSearchMeasured(base: HTMLCanvasElement, params: AntiSearchParams, targetBits: number): MeasuredAntiSearch {
  const reference = phashFromImage(base);
  let current = params;
  let best: MeasuredAntiSearch | null = null;
  for (let attempt = 0; attempt < ANTI_SEARCH_MAX_ATTEMPTS; attempt++) {
    const canvas = applyAntiSearch(base, current);
    const hash = reference ? phashFromImage(canvas) : null;
    const distance = reference && hash ? hammingDistance(reference, hash) : null;
    if (!best || (distance ?? -1) > (best.distance ?? -1)) best = { canvas, distance, params: current };
    if (!shouldStrengthenAntiSearch(distance, targetBits, current)) break;
    current = strengthenAntiSearch(current);
  }
  return best as MeasuredAntiSearch;
}

/* ── the measuring loop's decisions, kept pure so they are unit-tested without a canvas ── */

/** Attempts per preview; each one is a full pass over the frame. */
export const ANTI_SEARCH_MAX_ATTEMPTS = 5;
/** The visual budget: past this amplitude the lighting patches stop passing for uneven light. */
export const ANTI_SEARCH_MAX_AMPLITUDE = 0.16;
/** The crop never eats more than this per side, whatever the hash says. */
export const ANTI_SEARCH_MAX_CROP = 0.06;

/**
 * Another attempt is worth making only when the distance could be measured, is still short of
 * the target and the field has room to grow.
 */
export function shouldStrengthenAntiSearch(distance: number | null, targetBits: number, params: AntiSearchParams): boolean {
  return distance != null && distance < targetBits && params.fieldAmplitude < ANTI_SEARCH_MAX_AMPLITUDE;
}

/** The next, stronger set: a wider field, a slightly larger crop, a fresh noise seed. */
export function strengthenAntiSearch(params: AntiSearchParams): AntiSearchParams {
  return {
    ...params,
    fieldAmplitude: Math.min(ANTI_SEARCH_MAX_AMPLITUDE, params.fieldAmplitude + 0.03),
    cropPercent: Math.min(ANTI_SEARCH_MAX_CROP, params.cropPercent + 0.006),
    noiseSeed: params.noiseSeed + 1
  };
}

function cropCanvas(
  input: HTMLCanvasElement,
  crop: { top: number; right: number; bottom: number; left: number }
): HTMLCanvasElement {
  const width = Math.max(1, input.width - crop.left - crop.right);
  const height = Math.max(1, input.height - crop.top - crop.bottom);
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const ctx = output.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  ctx.drawImage(input, crop.left, crop.top, width, height, 0, 0, width, height);
  return output;
}

export function applyAntiSearch(
  base: HTMLCanvasElement,
  params: AntiSearchParams
): HTMLCanvasElement {
  const percentX = Math.round(base.width * (params.cropPercent ?? 0));
  const percentY = Math.round(base.height * (params.cropPercent ?? 0));
  const cropped = cropCanvas(base, {
    top: Math.max(params.crop.top, percentY),
    bottom: Math.max(params.crop.bottom, percentY),
    left: Math.max(params.crop.left, percentX),
    right: Math.max(params.crop.right, percentX)
  });
  const cos = Math.cos(params.rotation);
  const sin = Math.sin(params.rotation);
  const rotatedWidth = Math.abs(cos) * cropped.width + Math.abs(sin) * cropped.height;
  const rotatedHeight = Math.abs(sin) * cropped.width + Math.abs(cos) * cropped.height;
  const rotatedCanvas = document.createElement('canvas');
  rotatedCanvas.width = Math.ceil(rotatedWidth);
  rotatedCanvas.height = Math.ceil(rotatedHeight);
  const rctx = rotatedCanvas.getContext('2d');
  if (!rctx) {
    throw new Error('canvas');
  }
  rctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  rctx.rotate(params.rotation);
  rctx.drawImage(cropped, -cropped.width / 2, -cropped.height / 2);
  rctx.setTransform(1, 0, 0, 1, 0, 0);

  const imageData = rctx.getImageData(0, 0, rotatedCanvas.width, rotatedCanvas.height);
  const data = imageData.data;
  const rand = seededRandom(params.noiseSeed);
  const brightness = params.brightnessShift;
  const contrast = params.contrastShift;
  const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
  // The smooth luminance field is what actually moves the perceptual hash (see smoothFieldGrid).
  const amplitude = (params.fieldAmplitude ?? 0) * 255;
  const grid = amplitude > 0 ? smoothFieldGrid(params.noiseSeed) : null;
  const offset = brightness * 255;
  const width = rotatedCanvas.width;
  const height = rotatedCanvas.height;
  // No per-pixel allocation anywhere in this loop: on a multi-megapixel canvas even one short-lived
  // object per pixel used to freeze the slider for hundreds of milliseconds.
  let i = 0;
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x++, i += 4) {
      const noise = (rand() - 0.5) * params.noiseAmplitude;
      const lift = grid ? sampleField(grid, (x + 0.5) / width, ny) * amplitude : 0;
      const shift = noise + lift + offset;
      data[i] = clamp(factor * (data[i] + shift - 128) + 128, 0, 255);
      data[i + 1] = clamp(factor * (data[i + 1] + shift - 128) + 128, 0, 255);
      data[i + 2] = clamp(factor * (data[i + 2] + shift - 128) + 128, 0, 255);
    }
  }
  rctx.putImageData(imageData, 0, 0);

  const warpCanvas = document.createElement('canvas');
  warpCanvas.width = rotatedCanvas.width;
  warpCanvas.height = rotatedCanvas.height;
  const wctx = warpCanvas.getContext('2d');
  if (!wctx) {
    throw new Error('canvas');
  }
  const warpRand = seededRandom(params.noiseSeed + 97);
  const shearX = (warpRand() - 0.5) * params.warpStrength * 2;
  const shearY = (warpRand() - 0.5) * params.warpStrength * 2;
  const shiftX = (warpRand() - 0.5) * params.warpStrength * rotatedCanvas.width;
  const shiftY = (warpRand() - 0.5) * params.warpStrength * rotatedCanvas.height;
  wctx.setTransform(1, shearY, shearX, 1, shiftX, shiftY);
  wctx.drawImage(rotatedCanvas, 0, 0);
  wctx.setTransform(1, 0, 0, 1, 0, 0);

  const margin = Math.max(2, Math.round(params.noiseAmplitude / 2 + params.warpStrength * 160));
  const finalWidth = Math.max(1, cropped.width - margin * 2);
  const finalHeight = Math.max(1, cropped.height - margin * 2);
  const sx = clamp((warpCanvas.width - finalWidth) / 2, 0, warpCanvas.width - finalWidth);
  const sy = clamp((warpCanvas.height - finalHeight) / 2, 0, warpCanvas.height - finalHeight);
  const output = document.createElement('canvas');
  output.width = finalWidth;
  output.height = finalHeight;
  const octx = output.getContext('2d');
  if (!octx) {
    throw new Error('canvas');
  }
  octx.drawImage(warpCanvas, sx, sy, finalWidth, finalHeight, 0, 0, finalWidth, finalHeight);
  return output;
}

export function applyColorReduction(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const quantised = Math.round(luminance / 12) * 12;
    data[i] = quantised;
    data[i + 1] = quantised;
    data[i + 2] = quantised;
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

export function applyPrnuCleanup(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  const { width, height } = canvas;
  const original = ctx.getImageData(0, 0, width, height);
  const data = original.data;

  const blurCanvas = blurredCopy(canvas, 1.8);
  const bctx = blurCanvas.getContext('2d');
  if (!bctx) {
    throw new Error('canvas');
  }
  const blurred = bctx.getImageData(0, 0, width, height);
  const blurredData = blurred.data;

  const rand = seededRandom(Date.now());
  for (let i = 0; i < data.length; i += 4) {
    const residualR = data[i] - blurredData[i];
    const residualG = data[i + 1] - blurredData[i + 1];
    const residualB = data[i + 2] - blurredData[i + 2];
    const noise = (rand() - 0.5) * 10;
    data[i] = clamp(blurredData[i] + residualR * 0.25 + noise, 0, 255);
    data[i + 1] = clamp(blurredData[i + 1] + residualG * 0.25 + noise, 0, 255);
    data[i + 2] = clamp(blurredData[i + 2] + residualB * 0.25 + noise, 0, 255);
  }

  ctx.putImageData(original, 0, 0);
  return canvas;
}

export function applyWatermark(
  canvas: HTMLCanvasElement,
  text: string
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  const fontSize = Math.max(16, Math.round(canvas.width * 0.025));
  ctx.save();
  ctx.font = `600 ${fontSize}px 'Inter', 'Segoe UI', sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const margin = Math.max(12, Math.round(canvas.width * 0.02));
  const x = canvas.width - margin;
  const y = canvas.height - margin;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = Math.max(1, fontSize * 0.08);
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
  return canvas;
}

/* ── blur OCR text regions ──────────────────────────────── */

/**
 * Blurs boxes given in original-image pixels (OCR words, QR codes, anything rectangular) on a
 * canvas rendered at `scale`, each grown by a small margin so the edges do not show.
 */
export function blurBoxes(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  boxes: BlurRegion[],
  strength: number,
  scale: number,
  pad = 4
) {
  for (const box of boxes) {
    const rect: BlurRegion = {
      x: box.x * scale - pad,
      y: box.y * scale - pad,
      width: box.width * scale + pad * 2,
      height: box.height * scale + pad * 2
    };
    blurRegion(ctx, source, rect, strength);
  }
}

export function blurOcrRegions(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  regions: OCRRegion[],
  strength: number,
  scale: number
) {
  blurBoxes(ctx, source, regions, strength, scale);
}

/* ── licence plates ─────────────────────────────────────── */

/**
 * Plates get a generous margin (a quarter of the width, a third of the height each side):
 * OCR boxes hug the glyphs, the plate frame is wider than the characters.
 */
export function blurPlates(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  plates: Array<{ x: number; y: number; width: number; height: number }>,
  strength: number,
  scale: number
) {
  for (const plate of plates) {
    const padX = plate.width * scale * 0.25;
    const padY = plate.height * scale * 0.35;
    const rect: BlurRegion = {
      x: plate.x * scale - padX,
      y: plate.y * scale - padY,
      width: plate.width * scale + padX * 2,
      height: plate.height * scale + padY * 2,
    };
    blurRegion(ctx, source, rect, strength);
  }
}

/* ── horizontal flip (mirror) ───────────────────────────── */

export function applyMirror(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/* ── downscale to max dimension ─────────────────────────── */

export function applyDownscale(
  canvas: HTMLCanvasElement,
  maxDimension: number
): HTMLCanvasElement {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= maxDimension) return canvas;
  const scale = maxDimension / longest;
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0, w, h);
  return out;
}
