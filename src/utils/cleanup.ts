import type { AntiSearchParams, ManualMask } from '../types/cleanup';
import type { BoundingBox } from '../types/detection';

interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_MASK_SIZE = 12;
const MIN_MASK_POINTS = 3;

// ctx.filter появился в Safari только в 18-й версии; на старых iOS присваивание
// молча игнорируется и «размытый» регион копируется как есть. Проверяем один раз
// и при отсутствии поддержки размываем даунскейлом с апскейлом.
let filterSupportCache: boolean | null = null;

function canvasFilterSupported(): boolean {
  if (filterSupportCache != null) return filterSupportCache;
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) {
    filterSupportCache = false;
    return false;
  }
  probe.filter = 'blur(2px)';
  filterSupportCache = probe.filter !== 'none';
  return filterSupportCache;
}

function paintBlurred(
  target: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sWidth: number,
  sHeight: number,
  dx: number,
  dy: number,
  strength: number
) {
  if (canvasFilterSupported()) {
    target.filter = `blur(${Math.round(strength)}px)`;
    target.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, sWidth, sHeight);
    target.filter = 'none';
    return;
  }
  const factor = Math.max(2, Math.round(strength / 2));
  const smallWidth = Math.max(1, Math.round(sWidth / factor));
  const smallHeight = Math.max(1, Math.round(sHeight / factor));
  const tmp = document.createElement('canvas');
  tmp.width = smallWidth;
  tmp.height = smallHeight;
  const tmpCtx = tmp.getContext('2d');
  if (!tmpCtx) return;
  tmpCtx.imageSmoothingEnabled = true;
  tmpCtx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, smallWidth, smallHeight);
  target.imageSmoothingEnabled = true;
  target.drawImage(tmp, 0, 0, smallWidth, smallHeight, dx, dy, sWidth, sHeight);
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

export function blurDetections(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  detections: BoundingBox[],
  strength: number
) {
  detections.forEach((det) => {
    const pad = Math.max(det.width, det.height) * 0.08;
    const faceWidth = det.width * 0.55;
    const faceHeight = det.height * 0.45;
    const centerX = det.x + det.width / 2;
    const faceX = centerX - faceWidth / 2;
    const region: BlurRegion = {
      x: faceX - pad,
      y: det.y - pad * 0.6,
      width: faceWidth + pad * 2,
      height: faceHeight + pad * 1.5
    };
    const clamped = clampRect(region, ctx.canvas.width, ctx.canvas.height);
    if (!clamped) {
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(clamped.x, clamped.y, clamped.width, clamped.height);
    ctx.clip();
    paintBlurred(ctx, source, clamped.x, clamped.y, clamped.width, clamped.height, clamped.x, clamped.y, strength);
    ctx.restore();
  });
}

export function blurManualMasks(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  masks: ManualMask[],
  strength: number
) {
  if (masks.length === 0) return;

  masks.forEach((mask) => {
    if (mask.points.length < MIN_MASK_POINTS) {
      return;
    }

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = ctx.canvas.width;
    maskCanvas.height = ctx.canvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    const radius = Math.max(mask.radius, MIN_MASK_SIZE / 2);
    maskCtx.lineJoin = 'round';
    maskCtx.lineCap = 'round';
    maskCtx.beginPath();
    maskCtx.moveTo(mask.points[0].x, mask.points[0].y);
    for (let i = 1; i < mask.points.length; i += 1) {
      const pt = mask.points[i];
      maskCtx.lineTo(pt.x, pt.y);
    }
    maskCtx.closePath();
    maskCtx.fillStyle = 'white';
    maskCtx.strokeStyle = 'white';
    maskCtx.lineWidth = radius * 1.2;
    maskCtx.fill();
    maskCtx.stroke();

    const blurLayer = document.createElement('canvas');
    blurLayer.width = ctx.canvas.width;
    blurLayer.height = ctx.canvas.height;
    const blurCtx = blurLayer.getContext('2d');
    if (!blurCtx) return;

    const sourceWidth = typeof (source as { width?: unknown }).width === 'number' ? (source as { width: number }).width : ctx.canvas.width;
    const sourceHeight = typeof (source as { height?: unknown }).height === 'number' ? (source as { height: number }).height : ctx.canvas.height;
    paintBlurred(blurCtx, source, 0, 0, sourceWidth, sourceHeight, 0, 0, strength);
    blurCtx.globalCompositeOperation = 'destination-in';
    blurCtx.drawImage(maskCanvas, 0, 0);

    ctx.drawImage(blurLayer, 0, 0);
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
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rand() - 0.5) * params.noiseAmplitude;
    const adjust = (value: number) => {
      let v = value + noise + brightness * 255;
      v = factor * (v - 128) + 128;
      return clamp(v, 0, 255);
    };
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

export function applyColorReduction(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const quantised = Math.round(luminance / 12) * 12;
    data[i] = quantised;
    data[i + 1] = quantised;
    data[i + 2] = quantised;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function applyPrnuCleanup(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  const { width, height } = canvas;
  const original = ctx.getImageData(0, 0, width, height);
  const data = original.data;

  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = width;
  blurCanvas.height = height;
  const bctx = blurCanvas.getContext('2d');
  if (!bctx) {
    throw new Error('canvas');
  }
  paintBlurred(bctx, canvas, 0, 0, width, height, 0, 0, 1.8);
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
