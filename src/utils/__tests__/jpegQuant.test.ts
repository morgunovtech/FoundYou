import { describe, it, expect } from 'vitest';
import {
  IJG_CHROMA,
  IJG_LUMA,
  estimateQuality,
  ijgTable,
  judgeCompression,
  matchIjgQuality,
  parseJpegSignals,
  type JpegSignals
} from '../jpegQuant';

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63
];

/** A minimal JPEG head: SOI, APP0, DQT (two 8-bit tables, zigzag order as libjpeg writes them), SOF0, SOS. */
function jpegHead(luma: number[], chroma: number[], options: { progressive?: boolean; hv?: number } = {}): Uint8Array {
  const zig = (table: number[]) => ZIGZAG.map((natural) => table[natural]);
  const dqt = [0xff, 0xdb, 0x00, 0x84, 0x00, ...zig(luma), 0x01, ...zig(chroma)];
  const sof = [
    0xff,
    options.progressive ? 0xc2 : 0xc0,
    0x00,
    0x11,
    0x08,
    0x00,
    0x10,
    0x00,
    0x10,
    0x03,
    0x01,
    options.hv ?? 0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01
  ];
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34];
  return new Uint8Array([0xff, 0xd8, ...app0, ...dqt, ...sof, ...sos]);
}

describe('ijgTable / matchIjgQuality', () => {
  it('reproduces libjpeg: quality 50 is the base table, 100 is all ones, 75 is half', () => {
    expect(ijgTable(IJG_LUMA, 50)).toEqual(IJG_LUMA);
    expect(ijgTable(IJG_LUMA, 100).every((v) => v === 1)).toBe(true);
    expect(ijgTable(IJG_LUMA, 75)[0]).toBe(8);
    expect(ijgTable(IJG_LUMA, 10)[63]).toBe(255);
  });

  it('finds the exact quality of an IJG table pair and rejects a foreign table', () => {
    expect(matchIjgQuality(ijgTable(IJG_LUMA, 92), ijgTable(IJG_CHROMA, 92))).toBe(92);
    expect(matchIjgQuality(ijgTable(IJG_LUMA, 75))).toBe(75);
    const apple = ijgTable(IJG_LUMA, 93).map((v, i) => (i === 5 ? v + 1 : v));
    expect(matchIjgQuality(apple)).toBeNull();
    expect(estimateQuality(apple)).toBe(93);
  });
});

describe('parseJpegSignals', () => {
  it('reads both tables in natural order, the subsampling and the segment list', () => {
    const signals = parseJpegSignals(jpegHead(ijgTable(IJG_LUMA, 85), ijgTable(IJG_CHROMA, 85)));
    expect(signals).not.toBeNull();
    expect(signals!.tables).toHaveLength(2);
    expect(signals!.tables[0].values).toEqual(ijgTable(IJG_LUMA, 85));
    expect(signals!.ijgQuality).toBe(85);
    expect(signals!.subsampling).toBe('4:2:0');
    expect(signals!.progressive).toBe(false);
    expect(signals!.segments).toEqual(['APP0', 'DQT', 'SOF0']);
  });

  it('tells 4:4:4 progressive files apart and returns null for non-JPEG bytes', () => {
    const signals = parseJpegSignals(
      jpegHead(ijgTable(IJG_LUMA, 95), ijgTable(IJG_CHROMA, 95), { progressive: true, hv: 0x11 })
    );
    expect(signals!.subsampling).toBe('4:4:4');
    expect(signals!.progressive).toBe(true);
    expect(parseJpegSignals(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(parseJpegSignals(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull();
  });
});

describe('judgeCompression', () => {
  const signals = (ijg: number | null, estimated = 90): JpegSignals => ({
    tables: [],
    ijgQuality: ijg,
    estimatedQuality: estimated,
    subsampling: '4:2:0',
    progressive: false,
    segments: []
  });

  it('classes the quality and reports exactness', () => {
    expect(judgeCompression(signals(96), 'samsung')).toMatchObject({
      code: 'standard-high',
      quality: 96,
      exact: true,
      conflict: null
    });
    expect(judgeCompression(signals(75), null)).toMatchObject({ code: 'standard-medium', quality: 75 });
    expect(judgeCompression(signals(40), null)).toMatchObject({ code: 'standard-low' });
    expect(judgeCompression(signals(null, 93), 'Apple')).toMatchObject({
      code: 'custom',
      quality: 93,
      exact: false,
      conflict: null
    });
  });

  it('flags libjpeg tables on an «Apple» file and a low libjpeg quality on a Samsung / Google file', () => {
    expect(judgeCompression(signals(92), 'Apple').conflict).toBe('apple-standard');
    // Quality 100 is all-ones tables, which every encoder writes at its top setting: no evidence.
    // Measured 2026-09-24 on 74 real iPhone JPEGs — the only «conflict» the rule raised was one
    // such file, an iPhone 13 Pro re-save at 100 / 4:4:4.
    expect(judgeCompression(signals(100), 'Apple').conflict).toBeNull();
    expect(judgeCompression(signals(75), 'samsung').conflict).toBe('android-low');
    expect(judgeCompression(signals(75), 'Google').conflict).toBe('android-low');
    expect(judgeCompression(signals(97), 'Google').conflict).toBeNull();
    expect(judgeCompression(signals(75), 'Canon').conflict).toBeNull();
  });
});
