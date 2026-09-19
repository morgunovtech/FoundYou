/*
 * «Проверка кадра»: three classic looks at the pixels themselves, run only when the owner
 * presses the button, on the main thread with nothing but canvas.
 *
 * 1. Error level (ELA): save the picture as JPEG once more and show how much every pixel
 *    changed. A region pasted in from elsewhere, or retouched, has been compressed a
 *    different number of times than its surroundings and lights up on the map.
 * 2. Compression history («JPEG ghosts»): save the picture at every quality from 40 to 100
 *    and measure the error each time. The error dips at a quality the picture was saved with
 *    before: one dip is the file's own quality, two dips mean it was saved twice.
 * 3. Noise map: the sensor leaves the same fine grain everywhere; a patch with a different
 *    grain was pasted, smoothed or painted over.
 *
 * Pure helpers (`findDips`, `noiseBlocks`, `judgeNoise`, `blockRatio`) are tested; the
 * canvas wrappers are exercised in the browser.
 */

export interface ElaResult {
  /** Object URL of the amplified difference map. */
  url: string;
  width: number;
  height: number;
  /** Only the centre of a very large picture was checked. */
  cropped: boolean;
  /** How far the hottest block stands above blocks of the same texture (median of that group). */
  ratio: number;
  /** Blocks that stand out against their texture group. */
  hotBlocks: number;
  verdict: 'uniform' | 'spots';
}

export interface GhostPoint {
  quality: number;
  /** Mean absolute luma difference after re-saving at `quality`. */
  error: number;
}

export interface GhostResult {
  curve: GhostPoint[];
  /** Qualities where the error dips: the ones the picture was saved with before. */
  dips: number[];
  /** The quality the file is written with now (from its quantization tables); null for PNG / HEIC. */
  currentQuality: number | null;
  /**
   * `single`: one save, at `dips[0]` (≈ the file's own quality); `double`: a dip below the
   * current quality, so the picture was a JPEG before this save; `jpeg-inside`: a dip inside a
   * PNG / HEIC / WebP; `none`: a JPEG of a quality this method can see through, and no dip;
   * `not-applicable`: the file is not a JPEG and carries no JPEG past, so there is nothing for
   * the curve to find; `insensitive`: a JPEG written above `GHOST_BLIND_QUALITY`, where no dip
   * can clear the 30 % rule and «no dip» therefore says nothing; `unreliable`: no grain at all
   * (graphics), the curve means nothing there.
   */
  verdict: 'none' | 'single' | 'double' | 'jpeg-inside' | 'unreliable' | 'not-applicable' | 'insensitive';
  cropped: boolean;
}

export interface NoiseResult {
  url: string;
  width: number;
  height: number;
  /** Blocks with enough texture to judge. */
  judged: number;
  outliers: number;
  share: number;
  verdict: 'uniform' | 'spots' | 'flat';
}

export interface FrameCheckResults {
  ela: ElaResult;
  ghosts: GhostResult;
  noise: NoiseResult;
}

/** ELA re-save quality: high enough that an untouched picture changes little, low enough to show. */
const ELA_QUALITY = 0.9;
const ELA_GAIN = 20;
/** Native pixels (no scaling: scaling would destroy the JPEG block grid); bigger pictures are centre-cropped. */
const ELA_MAX_SIDE = 3000;
const GHOST_MAX_SIDE = 1024;
const GHOST_QUALITIES = Array.from({ length: 31 }, (_, i) => 40 + i * 2);
const NOISE_MAX_SIDE = 1024;
const BLOCK = 32;

type Rgba = Uint8ClampedArray;

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas-2d');
  return [canvas, ctx];
}

/** The centre of the picture at native scale, at most `maxSide` on each side. */
function centreCrop(
  bitmap: ImageBitmap,
  maxSide: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; cropped: boolean } {
  const width = Math.min(bitmap.width, maxSide);
  const height = Math.min(bitmap.height, maxSide);
  const sx = Math.floor((bitmap.width - width) / 2);
  const sy = Math.floor((bitmap.height - height) / 2);
  const [canvas, ctx] = makeCanvas(width, height);
  ctx.drawImage(bitmap, sx, sy, width, height, 0, 0, width, height);
  return { canvas, ctx, cropped: width < bitmap.width || height < bitmap.height };
}

/** The whole picture scaled down to at most `maxSide`. */
function scaledCopy(
  bitmap: ImageBitmap,
  maxSide: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const [canvas, ctx] = makeCanvas(width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, ctx };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas-encode'))), type, quality);
  });
}

/** Save as JPEG at `quality` and decode again: what a viewer would see after that save. */
async function resaved(canvas: HTMLCanvasElement, quality: number): Promise<Rgba> {
  const blob = await toBlob(canvas, 'image/jpeg', quality);
  const bitmap = await createImageBitmap(blob);
  try {
    const [, ctx] = makeCanvas(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  } finally {
    bitmap.close();
  }
}

const lumaAt = (data: Rgba, i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/** Lets the page paint between heavy steps. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

/** Sorts blocks into `count` groups of similar texture (quantiles); returns the group of each block. */
export function textureGroups(texture: number[], count = 6): number[] {
  const order = texture.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const groups = new Array<number>(texture.length).fill(0);
  order.forEach(({ index }, rank) => {
    groups[index] = Math.min(count - 1, Math.floor((rank / Math.max(1, texture.length)) * count));
  });
  return groups;
}

/** Percentile of `values` at the indices where `mask` is true; 0 when none. */
function maskedPercentile(values: number[], mask: boolean[], p: number): number {
  const picked = values.filter((_, i) => mask[i]).sort((a, b) => a - b);
  return picked.length === 0 ? 0 : percentile(picked, p);
}

export interface HotBlocks {
  /** The hottest block's error over the median of its texture group. */
  ratio: number;
  hotBlocks: number;
  /** Blocks that changed at all. */
  active: number;
}

/**
 * Blocks whose error stands far above blocks of the same texture. Edges and text are always
 * brighter than smooth areas on an error map, so a block is only compared with its own
 * texture group; flat blocks (mean below 1) are left out, otherwise a plain sky sets the bar.
 * Measured on ordinary photos and on synthetic pastes: this catches only gross cases (a fresh
 * or heavily recompressed patch), a careful paste does not stand out — hence the map is shown.
 */
export function hotBlocks(errors: number[], texture: number[], threshold = 3, floor = 25): HotBlocks {
  const groups = textureGroups(texture);
  const active = errors.map((value, i) => value >= 1 && texture[i] >= 1);
  // The 30th percentile, not the median: a pasted object can be half of its texture group.
  const references = Array.from({ length: 6 }, (_, g) =>
    maskedPercentile(
      errors,
      active.map((on, i) => on && groups[i] === g),
      0.3
    )
  );
  let ratio = 1;
  let hot = 0;
  errors.forEach((error, i) => {
    if (!active[i]) return;
    const base = Math.max(references[groups[i]], 0.5);
    ratio = Math.max(ratio, error / base);
    if (error / base >= threshold && error >= floor) hot += 1;
  });
  return { ratio, hotBlocks: hot, active: active.filter(Boolean).length };
}

/** Mean of a per-pixel value over `BLOCK`×`BLOCK` tiles (partial edge tiles included). */
function blockMeans(values: Float32Array, width: number, height: number, block: number): number[] {
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const out = new Array<number>(cols * rows).fill(0);
  const counts = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / block) * cols;
    for (let x = 0; x < width; x++) {
      const b = row + Math.floor(x / block);
      out[b] += values[y * width + x];
      counts[b] += 1;
    }
  }
  return out.map((sum, i) => (counts[i] ? sum / counts[i] : 0));
}

export async function computeEla(bitmap: ImageBitmap): Promise<ElaResult> {
  const { canvas, ctx, cropped } = centreCrop(bitmap, ELA_MAX_SIDE);
  const { width, height } = canvas;
  const original = ctx.getImageData(0, 0, width, height).data;
  await breathe();
  const again = await resaved(canvas, ELA_QUALITY);
  const diff = new Float32Array(width * height);
  const [mapCanvas, mapCtx] = makeCanvas(width, height);
  const map = mapCtx.createImageData(width, height);
  for (let p = 0, i = 0; p < diff.length; p++, i += 4) {
    const d = Math.min(255, Math.abs(lumaAt(original, i) - lumaAt(again, i)) * ELA_GAIN);
    diff[p] = d;
    map.data[i] = d;
    map.data[i + 1] = d;
    map.data[i + 2] = d;
    map.data[i + 3] = 255;
  }
  mapCtx.putImageData(map, 0, 0);
  const luma = new Float32Array(width * height);
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) luma[p] = lumaAt(original, i);
  const texture = noiseBlocks(luma, width, height, BLOCK).map((block) => block.texture);
  const hot = hotBlocks(blockMeans(diff, width, height, BLOCK), texture);
  // A few hot blocks are a coincidence; a pasted object covers a patch of them.
  const spots = hot.hotBlocks >= Math.max(4, Math.round(hot.active * 0.01));
  const url = URL.createObjectURL(await toBlob(mapCanvas, 'image/png'));
  return {
    url,
    width,
    height,
    cropped,
    ratio: hot.ratio,
    hotBlocks: hot.hotBlocks,
    verdict: spots ? 'spots' : 'uniform'
  };
}

/**
 * Qualities the picture was saved with before show as dips in the error curve. A dip is a
 * local minimum at least 30 % below the curve two steps on either side: measured against the
 * neighbours two steps away, the «harmonic» dips libjpeg's table steps produce at 50 + q / 2
 * and the convex tail near 100 do not qualify, while a real save two steps wide (85 lands
 * between 84 and 86) still does. The two points at each end are never dips.
 */
export function findDips(curve: GhostPoint[]): number[] {
  const e = curve.map((p) => p.error);
  const dips: number[] = [];
  for (let i = 2; i < e.length - 2; i++) {
    if (!(e[i] < e[i - 1] && e[i] <= e[i + 1])) continue;
    const reference = Math.min(e[i - 2], e[i + 2]);
    if ((reference - e[i]) / Math.max(reference, 1e-6) >= 0.3) dips.push(curve[i].quality);
  }
  return dips;
}

/**
 * Above this quality a single save leaves no dip `findDips` can see: near 100 the curve is so
 * flat that a real minimum stays well inside the 30 % rule. Measured on one photo saved once
 * and re-measured over 40…100: at quality 75 the dip is found at 74, at 85, 92 and 95 nothing
 * is found at all — although the curve's own minimum sits at 92 in the third case. Apple's
 * ImageIO hands the browser roughly 92…95, so this is the range of every iPhone upload.
 */
export const GHOST_BLIND_QUALITY = 85;

export interface GhostContext {
  /** Exact or estimated quality from the file's own tables; null for PNG / HEIC / WebP. */
  currentQuality: number | null;
  /** The file is a JPEG (a dip below `currentQuality` is a second save; otherwise a JPEG past). */
  isJpeg: boolean;
  /** The noise map found grain to compare: without any grain (graphics) the curve is noise. */
  hasGrain: boolean;
}

export function judgeGhosts(dips: number[], context: GhostContext): GhostResult['verdict'] {
  if (!context.hasGrain) return 'unreliable';
  const current = context.currentQuality;
  if (dips.length === 0) {
    // «No dip» is only an answer when the method could have seen one: not in a file that never
    // was a JPEG, and not above the quality where the curve flattens out.
    if (!context.isJpeg) return 'not-applicable';
    if (current != null && current >= GHOST_BLIND_QUALITY) return 'insensitive';
    return 'none';
  }
  if (!context.isJpeg) return 'jpeg-inside';
  if (current != null && dips.some((quality) => quality <= current - 4)) return 'double';
  return 'single';
}

export async function computeGhosts(bitmap: ImageBitmap, context: GhostContext): Promise<GhostResult> {
  const { canvas, ctx, cropped } = centreCrop(bitmap, GHOST_MAX_SIDE);
  const { width, height } = canvas;
  const original = ctx.getImageData(0, 0, width, height).data;
  const curve: GhostPoint[] = [];
  for (const quality of GHOST_QUALITIES) {
    const again = await resaved(canvas, quality / 100);
    let sum = 0;
    for (let i = 0; i < original.length; i += 4) sum += Math.abs(lumaAt(original, i) - lumaAt(again, i));
    curve.push({ quality, error: sum / (width * height) });
    await breathe();
  }
  const dips = findDips(curve);
  return { curve, dips, currentQuality: context.currentQuality, verdict: judgeGhosts(dips, context), cropped };
}

export interface NoiseBlock {
  /** The grain: the 20th percentile of the high-pass residual, which edges inside the block do not reach. */
  noise: number;
  /** Mean gradient magnitude: how much real detail the block holds. */
  texture: number;
}

/** Per-block grain and detail of a luma plane (row-major, `width`×`height`). */
export function noiseBlocks(luma: Float32Array, width: number, height: number, block: number): NoiseBlock[] {
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const residuals: number[][] = Array.from({ length: cols * rows }, () => []);
  const texture = new Float32Array(cols * rows);
  const counts = new Float32Array(cols * rows);
  const at = (x: number, y: number) =>
    luma[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / block) * cols;
    for (let x = 0; x < width; x++) {
      let mean = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mean += at(x + dx, y + dy);
      mean /= 9;
      const b = row + Math.floor(x / block);
      residuals[b].push(Math.abs(at(x, y) - mean));
      texture[b] += Math.abs(at(x + 1, y) - at(x, y)) + Math.abs(at(x, y + 1) - at(x, y));
      counts[b] += 1;
    }
  }
  return residuals.map((values, i) => ({
    noise: values.length
      ? percentile(
          values.sort((a, b) => a - b),
          0.2
        )
      : 0,
    texture: counts[i] ? texture[i] / counts[i] : 0
  }));
}

export interface NoiseJudgement {
  judged: number;
  outliers: number;
  share: number;
  verdict: NoiseResult['verdict'];
  /** Per block: 'skip' (too flat or all edges), 'ok', or 'outlier'. */
  flags: Array<'skip' | 'ok' | 'outlier'>;
}

/**
 * Flat blocks (sky, walls) carry no grain and blocks that are all edges drown it, so both are
 * skipped, as are blocks JPEG has flattened completely (grain under 0.05). Every other block
 * is compared with blocks of similar texture, because detail raises the residual even at the
 * 20th percentile: the reference is the group's 30th percentile (a pasted patch can be half of
 * its group), and four times that grain is an outlier. Measured on ordinary photos this
 * flags ~1 % of blocks; a smooth or pasted patch shows on the map rather than in the count.
 */
export function judgeNoise(blocks: NoiseBlock[]): NoiseJudgement {
  const usable = blocks.map((b) => b.texture >= 1.5 && b.texture <= 60 && b.noise >= 0.05);
  const judged = usable.filter(Boolean).length;
  if (judged < 16) {
    return { judged, outliers: 0, share: 0, verdict: 'flat', flags: blocks.map(() => 'skip') };
  }
  const groups = textureGroups(blocks.map((b) => b.texture));
  const noise = blocks.map((b) => b.noise);
  const references = Array.from({ length: 6 }, (_, g) =>
    Math.max(
      maskedPercentile(
        noise,
        usable.map((on, i) => on && groups[i] === g),
        0.3
      ),
      0.01
    )
  );
  const flags = blocks.map((b, i): 'skip' | 'ok' | 'outlier' => {
    if (!usable[i]) return 'skip';
    return b.noise >= 4 * references[groups[i]] ? 'outlier' : 'ok';
  });
  const outliers = flags.filter((flag) => flag === 'outlier').length;
  const share = outliers / judged;
  return { judged, outliers, share, verdict: share < 0.05 ? 'uniform' : 'spots', flags };
}

function accentColour(): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--v4-orange').trim();
    return value || '#d9531e';
  } catch {
    return '#d9531e';
  }
}

export async function computeNoiseMap(bitmap: ImageBitmap): Promise<NoiseResult> {
  const { canvas, ctx } = scaledCopy(bitmap, NOISE_MAX_SIDE);
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const luma = new Float32Array(width * height);
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) luma[p] = lumaAt(data, i);
  await breathe();
  const judgement = judgeNoise(noiseBlocks(luma, width, height, BLOCK));
  // The map: the picture dimmed, flat / edge blocks darkened, the outliers in the accent colour.
  const [mapCanvas, mapCtx] = makeCanvas(width, height);
  mapCtx.drawImage(canvas, 0, 0);
  mapCtx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  mapCtx.fillRect(0, 0, width, height);
  const cols = Math.ceil(width / BLOCK);
  const accent = accentColour();
  judgement.flags.forEach((flag, index) => {
    if (flag === 'ok') return;
    const x = (index % cols) * BLOCK;
    const y = Math.floor(index / cols) * BLOCK;
    mapCtx.fillStyle = flag === 'outlier' ? accent : 'rgba(0, 0, 0, 0.25)';
    mapCtx.globalAlpha = flag === 'outlier' ? 0.6 : 1;
    mapCtx.fillRect(x, y, BLOCK, BLOCK);
    mapCtx.globalAlpha = 1;
  });
  const url = URL.createObjectURL(await toBlob(mapCanvas, 'image/png'));
  return {
    url,
    width,
    height,
    judged: judgement.judged,
    outliers: judgement.outliers,
    share: judgement.share,
    verdict: judgement.verdict
  };
}

export type FrameCheckStep = 'decode' | 'ela' | 'ghosts' | 'noise';

/**
 * Runs the three checks on the working file, reporting each step; the caller revokes the
 * URLs. The noise map runs before the ghosts because its grain count gates them.
 */
export async function runFrameChecks(
  file: File,
  context: Omit<GhostContext, 'hasGrain'>,
  onStep: (step: FrameCheckStep) => void
): Promise<FrameCheckResults> {
  onStep('decode');
  const bitmap = await createImageBitmap(file);
  try {
    onStep('ela');
    const ela = await computeEla(bitmap);
    onStep('noise');
    const noise = await computeNoiseMap(bitmap);
    onStep('ghosts');
    const ghosts = await computeGhosts(bitmap, { ...context, hasGrain: noise.verdict !== 'flat' });
    return { ela, ghosts, noise };
  } finally {
    bitmap.close();
  }
}

export function revokeFrameChecks(results: FrameCheckResults | null): void {
  if (!results) return;
  URL.revokeObjectURL(results.ela.url);
  URL.revokeObjectURL(results.noise.url);
}

/**
 * Raw per-block numbers behind the three checks, for calibrating the thresholds against real
 * files in the browser (`import('/src/utils/frameChecks.ts')` on the dev server). Not used by
 * the card.
 */
export async function frameBlockData(bitmap: ImageBitmap): Promise<{
  errors: number[];
  elaTexture: number[];
  noise: number[];
  noiseTexture: number[];
  curve: GhostPoint[];
}> {
  const { canvas, ctx } = centreCrop(bitmap, ELA_MAX_SIDE);
  const { width, height } = canvas;
  const original = ctx.getImageData(0, 0, width, height).data;
  const again = await resaved(canvas, ELA_QUALITY);
  const diff = new Float32Array(width * height);
  const luma = new Float32Array(width * height);
  for (let p = 0, i = 0; p < diff.length; p++, i += 4) {
    diff[p] = Math.min(255, Math.abs(lumaAt(original, i) - lumaAt(again, i)) * ELA_GAIN);
    luma[p] = lumaAt(original, i);
  }
  const elaTexture = noiseBlocks(luma, width, height, BLOCK).map((block) => block.texture);
  const scaled = scaledCopy(bitmap, NOISE_MAX_SIDE);
  const sData = scaled.ctx.getImageData(0, 0, scaled.canvas.width, scaled.canvas.height).data;
  const sLuma = new Float32Array(scaled.canvas.width * scaled.canvas.height);
  for (let p = 0, i = 0; p < sLuma.length; p++, i += 4) sLuma[p] = lumaAt(sData, i);
  const blocks = noiseBlocks(sLuma, scaled.canvas.width, scaled.canvas.height, BLOCK);
  const ghosts = await computeGhosts(bitmap, { currentQuality: null, isJpeg: true, hasGrain: true });
  return {
    errors: blockMeans(diff, width, height, BLOCK),
    elaTexture,
    noise: blocks.map((b) => b.noise),
    noiseTexture: blocks.map((b) => b.texture),
    curve: ghosts.curve
  };
}
