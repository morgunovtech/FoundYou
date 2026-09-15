import type { AntiSearchParams, ManualMask } from '../types/cleanup';
import { FACE_LABEL, PERSON_LABEL, type BoundingBox } from '../types/detection';
import type { OCRRegion } from '../hooks/useOCR';

export interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_MASK_SIZE = 12;
const MIN_MASK_POINTS = 3;

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

/**
 * Draws `region` of `source` back onto `ctx` blurred. The caller owns the
 * clip and the save/restore pair. With filter support this is the classic
 * `filter: blur()` redraw; otherwise the region is shrunk into a tiny canvas
 * and stretched back with smoothing, which hides detail just as reliably.
 */
function paintBlurredRegion(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  region: BlurRegion,
  strength: number
) {
  const { x, y, width, height } = region;
  if (canvasBlurMode() === 'filter') {
    ctx.filter = `blur(${Math.round(strength)}px)`;
    ctx.drawImage(source, x, y, width, height, x, y, width, height);
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
 * A person box is grown by this fraction of its size before testing whether a face centre
 * falls inside it: face boxes are padded, and a tight person box may cut through the hair.
 */
const PERSON_FACE_TOLERANCE = 0.1;

function containsPoint(box: BoundingBox, px: number, py: number, tolerance: number): boolean {
  const dx = box.width * tolerance;
  const dy = box.height * tolerance;
  return px >= box.x - dx && px <= box.x + box.width + dx && py >= box.y - dy && py <= box.y + box.height + dy;
}

/**
 * Head-area estimate for a person without a detected face (back of the head, mask, a profile
 * the face model missed): the upper 45 % of the box, 55 % of its width, centred, plus a margin.
 */
function personHeadRegion(det: BoundingBox): BlurRegion {
  const pad = Math.max(det.width, det.height) * 0.08;
  const faceWidth = det.width * 0.55;
  const faceHeight = det.height * 0.45;
  const centerX = det.x + det.width / 2;
  return {
    x: centerX - faceWidth / 2 - pad,
    y: det.y - pad * 0.6,
    width: faceWidth + pad * 2,
    height: faceHeight + pad * 1.5
  };
}

/**
 * Chooses what "hide faces" blurs. Every `face` box is a target as is (the detector output is
 * already padded). A `person` box only adds the head-area fallback when no detected face lies
 * inside it, so nobody is left unblurred while people with a real face box are not blurred
 * twice. Other labels (car, dog, …) are ignored. Pure — no canvas — so it is unit-tested directly.
 */
export function selectBlurTargets(detections: BoundingBox[]): BlurTarget[] {
  const faces = detections.filter((det) => det.label === FACE_LABEL);
  const targets: BlurTarget[] = faces.map((face) => ({
    x: face.x,
    y: face.y,
    width: face.width,
    height: face.height,
    source: 'face'
  }));
  for (const person of detections) {
    if (person.label !== PERSON_LABEL) continue;
    const hasFace = faces.some((face) =>
      containsPoint(person, face.x + face.width / 2, face.y + face.height / 2, PERSON_FACE_TOLERANCE)
    );
    if (hasFace) continue;
    targets.push({ ...personHeadRegion(person), source: 'person' });
  }
  return targets;
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
  // Blur input outside the painted area so the polygon edge never samples the
  // transparent border of the sub-rectangle (3σ covers the Gaussian tail).
  const bleed = Math.round(strength) * 3;

  masks.forEach((mask) => {
    if (mask.points.length < MIN_MASK_POINTS) return;

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
    const pad = radius + bleed;
    const bounds = clampRect(
      { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 },
      width,
      height
    );
    if (!bounds) return;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mask.points[0].x, mask.points[0].y);
    for (let i = 1; i < mask.points.length; i += 1) {
      ctx.lineTo(mask.points[i].x, mask.points[i].y);
    }
    ctx.closePath();
    ctx.clip();
    paintBlurredRegion(ctx, source, bounds, strength);
    ctx.restore();
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

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
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
  const saturationShift = (rand() - 0.5) * 0.06 * safeLevel;
  const hueShift = (rand() - 0.5) * 12 * safeLevel;
  const warpStrength = 0.004 * safeLevel + rand() * 0.002;
  return {
    crop,
    rotation,
    noiseSeed: seed,
    noiseAmplitude,
    brightnessShift,
    contrastShift,
    saturationShift,
    hueShift,
    warpStrength
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
  const cropped = cropCanvas(base, params.crop);
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
  // One closure for the whole pass: allocating it per pixel froze the slider
  // for hundreds of milliseconds on multi-megapixel previews.
  let noise = 0;
  const adjust = (value: number) => {
    let v = value + noise + brightness * 255;
    v = factor * (v - 128) + 128;
    return clamp(v, 0, 255);
  };
  for (let i = 0; i < data.length; i += 4) {
    noise = (rand() - 0.5) * params.noiseAmplitude;
    const r = adjust(data[i]);
    const g = adjust(data[i + 1]);
    const b = adjust(data[i + 2]);
    const { h, s, l } = rgbToHsl(r, g, b);
    const shiftedH = ((h + params.hueShift / 360) % 1 + 1) % 1;
    const shiftedS = clamp(s + params.saturationShift, 0, 1);
    const [nr, ng, nb] = hslToRgb(shiftedH, shiftedS, clamp(l, 0, 1));
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
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

export function blurOcrRegions(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  regions: OCRRegion[],
  strength: number,
  scale: number
) {
  for (const region of regions) {
    const pad = 4;
    const rect: BlurRegion = {
      x: region.x * scale - pad,
      y: region.y * scale - pad,
      width: region.width * scale + pad * 2,
      height: region.height * scale + pad * 2,
    };
    blurRegion(ctx, source, rect, strength);
  }
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
