/*
 * Perceptual hash (pHash): the fingerprint reverse-image search engines match on.
 *
 * SHA-256 changes with every re-save; a perceptual hash survives resizing,
 * recompression and light edits, which is exactly what «find this photo on
 * another service» relies on. The classic recipe: 32×32 luminance, a 2-D DCT,
 * the top-left 8×8 low-frequency block without the DC term, one bit per
 * coefficient above the median. Two hashes at Hamming distance ≤ 10 are
 * almost always the same picture; past ~20 they are different pictures.
 * Everything runs on the canvas, nothing leaves the device.
 */

export const PHASH_BITS = 64;
/** Below this Hamming distance reverse-image search still treats the copy as the same picture. */
export const PHASH_SAME_PICTURE = 10;

const SIZE = 32;
const LOW = 8;

const COS: number[][] = Array.from({ length: LOW }, (_, u) =>
  Array.from({ length: SIZE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)))
);

/** 32×32 luminance samples (row-major) from RGBA pixels. */
export function luminance(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float64Array {
  if (width !== SIZE || height !== SIZE) throw new Error(`luminance expects ${SIZE}×${SIZE}, got ${width}×${height}`);
  const out = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const p = i * 4;
    out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return out;
}

/** The low-frequency 8×8 block of the 2-D DCT-II of a 32×32 grid. */
export function lowFrequencyDct(grid: Float64Array): Float64Array {
  // Rows first: 32 rows × 8 frequencies.
  const rows = new Float64Array(SIZE * LOW);
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += grid[y * SIZE + x] * COS[u][x];
      rows[y * LOW + u] = sum;
    }
  }
  // Then columns: 8 × 8.
  const out = new Float64Array(LOW * LOW);
  for (let v = 0; v < LOW; v++) {
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) sum += rows[y * LOW + u] * COS[v][y];
      out[v * LOW + u] = sum;
    }
  }
  return out;
}

/** 64-bit hash as 16 lowercase hex characters, from 32×32 RGBA pixels. */
export function phashFromPixels(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): string {
  const dct = lowFrequencyDct(luminance(rgba, width, height));
  // Median over the 63 AC coefficients (the DC term at [0] only encodes brightness).
  const ac = Array.from(dct.subarray(1)).sort((a, b) => a - b);
  const median = (ac[31] + ac[32]) / 2;
  // Coefficients that only differ from the median by floating-point noise (a flat picture)
  // must not turn into random bits.
  const epsilon = 1e-6;
  let hex = '';
  for (let byte = 0; byte < 8; byte++) {
    let value = 0;
    for (let bit = 0; bit < 8; bit++) {
      const index = byte * 8 + bit;
      value = (value << 1) | (index !== 0 && dct[index] - median > epsilon ? 1 : 0);
    }
    hex += value.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Bits that differ between two hex hashes of equal length; null when they are not comparable. */
export function hammingDistance(a: string, b: string): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16);
    const y = parseInt(b[i], 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    let diff = x ^ y;
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

/**
 * pHash of anything the canvas can draw (an `<img>`, an `ImageBitmap`, another canvas).
 * The source is downscaled to 32×32 with the browser's own resampling.
 */
export function phashFromImage(source: CanvasImageSource): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  return phashFromPixels(data, SIZE, SIZE);
}

/** pHash of an encoded image (the exported blob), decoded by the browser. */
export async function phashFromBlob(blob: Blob): Promise<string | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    return phashFromImage(bitmap);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
