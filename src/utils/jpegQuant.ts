/*
 * JPEG compression signals read straight from the container: the quantization tables (DQT),
 * the chroma subsampling (SOF) and the segments before the scan. Cameras, editors, browsers
 * and messengers each write their own tables, so the tables say who saved the file last even
 * when the EXIF is gone or lies. libjpeg (IJG) scales one well-known base table by a quality
 * number and almost every Android camera, browser, web service and messenger uses it; Apple,
 * Canon, Nikon and Photoshop write their own tables. Pure functions; the hook reads the bytes.
 */

export interface JpegQuantTable {
  id: number;
  precision: 8 | 16;
  /** 64 values in natural (row-major) order. */
  values: number[];
}

export type ChromaSubsampling = '4:4:4' | '4:2:2' | '4:2:0' | '4:1:1' | 'gray' | 'unknown';

export interface JpegSignals {
  tables: JpegQuantTable[];
  /** The exact libjpeg quality when the luma table is the IJG base table scaled for that quality. */
  ijgQuality: number | null;
  /** Approximate quality (1–100) from the overall scale of the luma table against the IJG base. */
  estimatedQuality: number;
  subsampling: ChromaSubsampling;
  progressive: boolean;
  /** Marker names before the first scan, in file order: APP0, APP1, DQT, SOF0 … */
  segments: string[];
}

/** libjpeg's `jpeg_natural_order`: the natural index of the i-th zigzag coefficient. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63
];

/** ITU T.81 Annex K.1 luminance table, natural order. */
export const IJG_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
  87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
];

/** ITU T.81 Annex K.2 chrominance table, natural order. */
export const IJG_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99
];

/** The table libjpeg writes for `quality` (jcparam.c, `force_baseline` on: values clipped to 255). */
export function ijgTable(base: number[], quality: number): number[] {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  return base.map((value) => Math.min(255, Math.max(1, Math.floor((value * scale + 50) / 100))));
}

const sameTable = (a: number[], b: number[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/** The exact IJG quality whose luma table equals `luma` (and whose chroma table equals `chroma`, when given). */
export function matchIjgQuality(luma: number[], chroma?: number[]): number | null {
  for (let q = 100; q >= 1; q--) {
    if (!sameTable(luma, ijgTable(IJG_LUMA, q))) continue;
    if (chroma && !sameTable(chroma, ijgTable(IJG_CHROMA, q))) continue;
    return q;
  }
  return null;
}

/** The quality whose IJG luma table sums closest to `luma` (ImageMagick's estimate for foreign tables). */
export function estimateQuality(luma: number[]): number {
  const sum = luma.reduce((acc, value) => acc + value, 0);
  let best = 100;
  let bestDistance = Infinity;
  for (let q = 1; q <= 100; q++) {
    const candidate = ijgTable(IJG_LUMA, q).reduce((acc, value) => acc + value, 0);
    const distance = Math.abs(candidate - sum);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = q;
    }
  }
  return best;
}

const MARKER_NAMES: Record<number, string> = {
  0xc0: 'SOF0',
  0xc1: 'SOF1',
  0xc2: 'SOF2',
  0xc3: 'SOF3',
  0xc4: 'DHT',
  0xc5: 'SOF5',
  0xc6: 'SOF6',
  0xc7: 'SOF7',
  0xc9: 'SOF9',
  0xca: 'SOF10',
  0xcb: 'SOF11',
  0xcd: 'SOF13',
  0xce: 'SOF14',
  0xcf: 'SOF15',
  0xdb: 'DQT',
  0xdd: 'DRI',
  0xfe: 'COM'
};

function markerName(marker: number): string {
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  return MARKER_NAMES[marker] ?? `0x${marker.toString(16)}`;
}

function subsamplingOf(components: Array<{ h: number; v: number }>): ChromaSubsampling {
  if (components.length === 1) return 'gray';
  if (components.length < 3) return 'unknown';
  const [y, cb, cr] = components;
  if (cb.h !== 1 || cb.v !== 1 || cr.h !== 1 || cr.v !== 1) return 'unknown';
  if (y.h === 1 && y.v === 1) return '4:4:4';
  if (y.h === 2 && y.v === 1) return '4:2:2';
  if (y.h === 2 && y.v === 2) return '4:2:0';
  if (y.h === 4 && y.v === 1) return '4:1:1';
  return 'unknown';
}

/**
 * Reads the DQT and SOF segments before the first scan. Returns null unless `bytes` starts with
 * a JPEG SOI and holds at least one quantization table before the scan (or the end of the
 * slice: the caller may pass only the head of the file).
 */
export function parseJpegSignals(bytes: Uint8Array): JpegSignals | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const tables: JpegQuantTable[] = [];
  const segments: string[] = [];
  let subsampling: ChromaSubsampling = 'unknown';
  let progressive = false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS: the scan starts, tables are behind us
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    const start = offset + 4;
    const end = offset + 2 + length;
    if (end > bytes.length) break;
    segments.push(markerName(marker));
    if (marker === 0xdb) {
      let p = start;
      while (p < end) {
        const precision = bytes[p] >> 4 === 0 ? 8 : 16;
        const id = bytes[p] & 0x0f;
        p += 1;
        const stored: number[] = [];
        for (let i = 0; i < 64; i++) {
          if (precision === 8) {
            stored.push(bytes[p + i]);
          } else {
            stored.push((bytes[p + i * 2] << 8) | bytes[p + i * 2 + 1]);
          }
        }
        p += precision === 8 ? 64 : 128;
        const values = new Array<number>(64);
        for (let i = 0; i < 64; i++) values[ZIGZAG[i]] = stored[i];
        tables.push({ id, precision, values });
      }
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
      const count = bytes[start + 5];
      const components: Array<{ h: number; v: number }> = [];
      for (let i = 0; i < count; i++) {
        const hv = bytes[start + 6 + i * 3 + 1];
        components.push({ h: hv >> 4, v: hv & 0x0f });
      }
      subsampling = subsamplingOf(components);
    }
    offset = end;
  }
  if (tables.length === 0) return null;
  const luma = tables.find((table) => table.id === 0) ?? tables[0];
  const chroma = tables.find((table) => table.id === 1);
  return {
    tables,
    ijgQuality: matchIjgQuality(luma.values, chroma?.values),
    estimatedQuality: estimateQuality(luma.values),
    subsampling,
    progressive,
    segments
  };
}

export type CompressionCode = 'standard-high' | 'standard-medium' | 'standard-low' | 'custom';
export type VendorConflict = 'apple-standard' | 'android-low' | null;

export interface CompressionVerdict {
  code: CompressionCode;
  /** The quality to show: exact for IJG tables, approximate otherwise. */
  quality: number;
  exact: boolean;
  subsampling: ChromaSubsampling;
  /** The tables disagree with what the camera named in EXIF writes. */
  conflict: VendorConflict;
}

const ANDROID_STANDARD_MAKERS = /^(samsung|google|xiaomi|redmi|poco|oneplus)/i;

/**
 * What the tables say about the last program that wrote the file, against the camera maker
 * in EXIF: iPhones write their own tables (never libjpeg's), Samsung and Google cameras
 * write libjpeg tables at quality 90 or above.
 */
export function judgeCompression(signals: JpegSignals, cameraMake: string | null | undefined): CompressionVerdict {
  const exact = signals.ijgQuality != null;
  const quality = signals.ijgQuality ?? signals.estimatedQuality;
  const code: CompressionCode = !exact
    ? 'custom'
    : quality >= 90
      ? 'standard-high'
      : quality >= 60
        ? 'standard-medium'
        : 'standard-low';
  const make = (cameraMake ?? '').trim();
  let conflict: VendorConflict = null;
  // Not at quality 100: the IJG table scaled to 100 is all ones, which is what *every* encoder
  // writes at its top setting, so an exact match there says nothing about libjpeg. Measured on
  // 2026-09-24 over 74 real iPhone JPEGs (X, 11, 12 mini, 13, 13 Pro, 15 Pro Max): every camera
  // original has its own tables and no conflict; the one file the rule caught was an iPhone 13
  // Pro re-save at quality 100, 4:4:4, which is not evidence of another program either way.
  if (/^apple/i.test(make) && exact && quality < 100) conflict = 'apple-standard';
  else if (ANDROID_STANDARD_MAKERS.test(make) && exact && quality < 90) conflict = 'android-low';
  return { code, quality, exact, subsampling: signals.subsampling, conflict };
}
