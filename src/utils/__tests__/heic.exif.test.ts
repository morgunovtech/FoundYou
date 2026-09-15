import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import exifr from 'exifr';
import { describe, expect, it } from 'vitest';
import { extractExifTiffFromHeif, extractMetadataFromOriginal } from '../heic';

/* ── byte helpers ─────────────────────────────────────────────── */

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const u8 = (...values: number[]) => Uint8Array.from(values);
const u16 = (n: number) => u8((n >>> 8) & 0xff, n & 0xff);
const u32 = (n: number) => u8((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const u64 = (n: number) => concat(u32(Math.floor(n / 2 ** 32)), u32(n % 2 ** 32));
const NONE = new Uint8Array(0);

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

const sized = (n: number, size: 0 | 4 | 8) => (size === 0 ? NONE : size === 4 ? u32(n) : u64(n));

/** ISO-BMFF Box: size(4) type(4) payload. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32(8 + body.length), ascii(type), body);
}

/** FullBox: Box + version(1) flags(3). */
const fullBox = (type: string, version: number, ...payload: Uint8Array[]) => box(type, u8(version, 0, 0, 0), ...payload);

const EXIF_MARKER = ascii('Exif\0\0');
const TIFF_LE = ascii('II*\0');
const TIFF_BE = ascii('MM\0*');

const must = <T,>(value: T | null): T => {
  if (value === null) throw new Error('expected a value');
  return value;
};

const header = (tiff: Uint8Array | null) => Array.from(must(tiff).subarray(0, 4));

/* ── minimal TIFF ─────────────────────────────────────────────── */

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DESCRIPTION = 0x010e;

/** Header + IFD0 holding ASCII tags. Values longer than 4 bytes are stored after the IFD. */
function buildTiff(byteOrder: 'II' | 'MM', tags: Array<[number, string]>): Uint8Array {
  const little = byteOrder === 'II';
  const ifdOffset = 8;
  const dataStart = ifdOffset + 2 + tags.length * 12 + 4;
  const values = tags.map(([, text]) => ascii(`${text}\0`));
  const out = new Uint8Array(dataStart + values.reduce((sum, value) => sum + (value.length > 4 ? value.length : 0), 0));
  const view = new DataView(out.buffer);

  out.set(ascii(byteOrder), 0);
  view.setUint16(2, 42, little);
  view.setUint32(4, ifdOffset, little);
  view.setUint16(ifdOffset, tags.length, little);

  let data = dataStart;
  tags.forEach(([tag], index) => {
    const entry = ifdOffset + 2 + index * 12;
    const value = values[index];
    view.setUint16(entry, tag, little);
    view.setUint16(entry + 2, 2, little); // ASCII
    view.setUint32(entry + 4, value.length, little);
    if (value.length <= 4) {
      out.set(value, entry + 8);
    } else {
      view.setUint32(entry + 8, data, little);
      out.set(value, data);
      data += value.length;
    }
  });
  view.setUint32(ifdOffset + 2 + tags.length * 12, 0, little); // next IFD: none
  return out;
}

const SAMSUNG_TIFF = buildTiff('II', [[TAG_MAKE, 'samsung'], [TAG_MODEL, 'SM-G998B']]);
const APPLE_TIFF = buildTiff('MM', [[TAG_MAKE, 'Apple'], [TAG_MODEL, 'iPhone 15 Pro']]);

/** libheif / heif-enc: exif_tiff_header_offset = 0, bare TIFF. */
const libheifItem = (tiff: Uint8Array) => concat(u32(0), tiff);
/** Apple: exif_tiff_header_offset = 6, JPEG-style "Exif\0\0" marker, then the TIFF. */
const appleItem = (tiff: Uint8Array) => concat(u32(6), EXIF_MARKER, tiff);

/* ── synthetic HEIF container ─────────────────────────────────── */

interface HeifLayout {
  /** Complete payload of the Exif item (offset field + marker? + TIFF). */
  exifItem: Uint8Array;
  ilocVersion?: 0 | 1 | 2;
  /** 0 = absolute file offsets (mdat), 1 = offsets into idat. */
  constructionMethod?: 0 | 1;
  offsetSize?: 4 | 8;
  lengthSize?: 4 | 8;
  baseOffsetSize?: 0 | 4 | 8;
  indexSize?: 0 | 4;
  infeVersion?: 2 | 3;
  iinfVersion?: 0 | 1;
  /** Split the Exif item into this many extents. */
  extents?: number;
  /** item_type written into infe for item 2 ('Exif' normally). */
  exifItemType?: string;
  brand?: string;
  /** Drop the iloc box (simulates a damaged meta). */
  omitIloc?: boolean;
}

/**
 * ftyp + meta{hdlr, pitm, iinf{infe hvc1, infe Exif}, iloc, [idat]} + mdat{image, [exif]}.
 * Field widths do not depend on the offsets, so the layout is built twice: once to measure,
 * once with the real positions.
 */
function buildHeif(layout: HeifLayout): Uint8Array<ArrayBuffer> {
  const {
    exifItem,
    ilocVersion = 0,
    constructionMethod = 0,
    offsetSize = 4,
    lengthSize = 4,
    baseOffsetSize = 0,
    indexSize = 0,
    infeVersion = 2,
    iinfVersion = 0,
    extents = 1,
    exifItemType = 'Exif',
    brand = 'heic',
    omitIloc = false
  } = layout;
  const image = ascii('hevc-bitstream-placeholder-bytes');
  const chunkLength = Math.ceil(exifItem.length / extents);
  const chunks = Array.from({ length: extents }, (_, i) => exifItem.subarray(i * chunkLength, Math.min(exifItem.length, (i + 1) * chunkLength)));
  const ilocId = (id: number) => (ilocVersion === 2 ? u32(id) : u16(id));
  const infeId = (id: number) => (infeVersion === 3 ? u32(id) : u16(id));
  const useBase = baseOffsetSize > 0;

  type Extent = { offset: number; length: number };
  const item = (id: number, method: number, base: number, list: Extent[]) =>
    concat(
      ilocId(id),
      ilocVersion >= 1 ? u16(method) : NONE,
      u16(0), // data_reference_index: this file
      sized(base, baseOffsetSize),
      u16(list.length),
      ...list.map((extent) =>
        concat(ilocVersion >= 1 ? sized(0, indexSize) : NONE, sized(extent.offset, offsetSize), sized(extent.length, lengthSize))
      )
    );

  const build = (mdatPayload: number, idatPayload: number) => {
    const ftyp = box('ftyp', ascii(brand), u32(0), ascii('mif1'), ascii(brand));
    const hdlr = fullBox('hdlr', 0, u32(0), ascii('pict'), u32(0), u32(0), u32(0), u8(0));
    const pitm = fullBox('pitm', 0, u16(1));
    const infe = (id: number, type: string) => fullBox('infe', infeVersion, infeId(id), u16(0), ascii(type), u8(0));
    const iinf = fullBox('iinf', iinfVersion, iinfVersion === 0 ? u16(2) : u32(2), infe(1, 'hvc1'), infe(2, exifItemType));

    // Item 1 (image) always sits at the start of mdat. Item 2 (Exif) follows it, or lives in idat.
    const imageBase = useBase ? mdatPayload : 0;
    const imageExtents: Extent[] = [{ offset: mdatPayload - imageBase, length: image.length }];
    const exifStart = constructionMethod === 1 ? 0 : mdatPayload + image.length; // idat-relative or absolute
    const exifBase = useBase ? exifStart : 0;
    let cursor = exifStart - exifBase;
    const exifExtents: Extent[] = chunks.map((chunk) => {
      const extent = { offset: cursor, length: chunk.length };
      cursor += chunk.length;
      return extent;
    });

    const iloc = fullBox(
      'iloc',
      ilocVersion,
      u8((offsetSize << 4) | lengthSize),
      u8((baseOffsetSize << 4) | (ilocVersion >= 1 ? indexSize : 0)),
      ilocVersion < 2 ? u16(2) : u32(2),
      item(1, 0, imageBase, imageExtents),
      item(2, constructionMethod, exifBase, exifExtents)
    );
    const idat = constructionMethod === 1 ? box('idat', exifItem) : NONE;
    const meta = fullBox('meta', 0, hdlr, pitm, iinf, omitIloc ? NONE : iloc, idat);
    const mdat = box('mdat', constructionMethod === 1 ? image : concat(image, exifItem));
    void idatPayload;
    return {
      file: concat(ftyp, meta, mdat),
      mdatPayloadAt: ftyp.length + meta.length + 8,
      idatPayloadAt: constructionMethod === 1 ? ftyp.length + meta.length - idat.length + 8 : 0
    };
  };

  const measured = build(0, 0);
  return build(measured.mdatPayloadAt, measured.idatPayloadAt).file;
}

/* ── tests ────────────────────────────────────────────────────── */

describe('extractExifTiffFromHeif: ISO-BMFF box walk', () => {
  it('(a) libheif layout — iloc v0, exif_tiff_header_offset 0, bare little-endian TIFF', async () => {
    const tiff = extractExifTiffFromHeif(buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF) }));
    expect(header(tiff)).toEqual(Array.from(TIFF_LE));
    expect(tiff).toEqual(SAMSUNG_TIFF);
    await expect(exifr.parse(must(tiff), { tiff: true })).resolves.toMatchObject({ Make: 'samsung', Model: 'SM-G998B' });
  });

  it('(b) Apple layout — exif_tiff_header_offset 6 behind an "Exif\\0\\0" marker, big-endian TIFF', async () => {
    const tiff = extractExifTiffFromHeif(buildHeif({ exifItem: appleItem(APPLE_TIFF) }));
    expect(header(tiff)).toEqual(Array.from(TIFF_BE));
    expect(tiff).toEqual(APPLE_TIFF);
    await expect(exifr.parse(must(tiff), { tiff: true })).resolves.toMatchObject({ Make: 'Apple', Model: 'iPhone 15 Pro' });
  });

  it('iloc v1 + construction_method 1: the item lives inside idat', () => {
    const tiff = extractExifTiffFromHeif(buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF), ilocVersion: 1, constructionMethod: 1 }));
    expect(tiff).toEqual(SAMSUNG_TIFF);
  });

  it('iloc v1 with extent_index and base_offset fields present', () => {
    const inIdat = buildHeif({ exifItem: appleItem(APPLE_TIFF), ilocVersion: 1, constructionMethod: 1, indexSize: 4, baseOffsetSize: 4 });
    expect(extractExifTiffFromHeif(inIdat)).toEqual(APPLE_TIFF);
    const inMdat = buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF), ilocVersion: 1, constructionMethod: 0, indexSize: 4, baseOffsetSize: 4 });
    expect(extractExifTiffFromHeif(inMdat)).toEqual(SAMSUNG_TIFF);
  });

  it('iloc v2 — 32-bit item IDs, infe v3, iinf v1, 8-byte offset/length/base fields', () => {
    const heif = buildHeif({
      exifItem: libheifItem(SAMSUNG_TIFF),
      ilocVersion: 2,
      infeVersion: 3,
      iinfVersion: 1,
      offsetSize: 8,
      lengthSize: 8,
      baseOffsetSize: 8
    });
    expect(extractExifTiffFromHeif(heif)).toEqual(SAMSUNG_TIFF);
  });

  it('an item split over several extents is reassembled in order', () => {
    expect(extractExifTiffFromHeif(buildHeif({ exifItem: appleItem(APPLE_TIFF), extents: 3 }))).toEqual(APPLE_TIFF);
    expect(extractExifTiffFromHeif(buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF), ilocVersion: 1, constructionMethod: 1, extents: 4 }))).toEqual(SAMSUNG_TIFF);
  });

  it('a writer that adds "Exif\\0\\0" but still declares offset 0 is tolerated', () => {
    expect(extractExifTiffFromHeif(buildHeif({ exifItem: concat(u32(0), EXIF_MARKER, SAMSUNG_TIFF) }))).toEqual(SAMSUNG_TIFF);
  });

  it('a nonsense exif_tiff_header_offset falls back to searching the item for the TIFF header', () => {
    expect(extractExifTiffFromHeif(buildHeif({ exifItem: concat(u32(0xffffff), APPLE_TIFF) }))).toEqual(APPLE_TIFF);
    expect(extractExifTiffFromHeif(buildHeif({ exifItem: concat(u32(2), u8(0, 0), SAMSUNG_TIFF) }))).toEqual(SAMSUNG_TIFF);
  });

  it('no 64 KB cap: a large Exif block is returned whole', () => {
    const big = buildTiff('II', [[TAG_MAKE, 'samsung'], [TAG_DESCRIPTION, 'x'.repeat(200_000)]]);
    expect(big.length).toBeGreaterThan(65536);
    const tiff = must(extractExifTiffFromHeif(buildHeif({ exifItem: libheifItem(big) })));
    expect(tiff.length).toBe(big.length);
    expect(tiff).toEqual(big);
  });

  it.each(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1', 'avif'])('brand %s uses the same walk', (brand) => {
    expect(extractExifTiffFromHeif(buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF), brand }))).toEqual(SAMSUNG_TIFF);
  });

  it('a non-Exif item (e.g. XMP "mime") is ignored', () => {
    expect(extractExifTiffFromHeif(buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF), exifItemType: 'mime' }))).toBeNull();
  });
});

describe('extractExifTiffFromHeif: marker-scan fallback and negatives', () => {
  const ftyp = box('ftyp', ascii('heic'), u32(0), ascii('mif1'), ascii('heic'));

  it('without a meta box the "Exif\\0\\0" scan still finds an Apple-style TIFF in mdat', () => {
    const file = concat(ftyp, box('mdat', ascii('junk before'), EXIF_MARKER, APPLE_TIFF));
    expect(header(extractExifTiffFromHeif(file))).toEqual(Array.from(TIFF_BE));
    expect(must(extractExifTiffFromHeif(file)).subarray(0, APPLE_TIFF.length)).toEqual(APPLE_TIFF);
  });

  it('a damaged meta (no iloc) falls back to the marker scan', () => {
    const file = buildHeif({ exifItem: appleItem(APPLE_TIFF), omitIloc: true });
    expect(header(extractExifTiffFromHeif(file))).toEqual(Array.from(TIFF_BE));
  });

  it('a bare TIFF without the marker cannot be found by the fallback', () => {
    // This is exactly the libheif case the box walk exists for.
    expect(extractExifTiffFromHeif(concat(ftyp, box('mdat', ascii('junk'), u32(0), SAMSUNG_TIFF)))).toBeNull();
  });

  it('returns null when there is neither an Exif item nor a marker', () => {
    expect(extractExifTiffFromHeif(concat(ftyp, box('mdat', ascii('nothing to see here'))))).toBeNull();
    expect(extractExifTiffFromHeif(new Uint8Array(0))).toBeNull();
    expect(extractExifTiffFromHeif(ascii('II*\0'))).toBeNull();
    expect(extractExifTiffFromHeif(EXIF_MARKER)).toBeNull();
  });

  it('a truncated file neither throws nor returns a partial item', () => {
    const heif = buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF) });
    expect(extractExifTiffFromHeif(heif.subarray(0, heif.length - 10))).toBeNull();
    expect(extractExifTiffFromHeif(heif.subarray(0, 40))).toBeNull();
  });

  it('a subarray view with a non-zero byteOffset is walked correctly', () => {
    const heif = buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF) });
    const padded = concat(ascii('0123456789'), heif);
    expect(extractExifTiffFromHeif(padded.subarray(10))).toEqual(SAMSUNG_TIFF);
  });
});

describe('extractMetadataFromOriginal: HEIC wiring', () => {
  it('parses Make/Model from a libheif-style .heic File through exifr', async () => {
    const file = new File([buildHeif({ exifItem: libheifItem(SAMSUNG_TIFF) })], 'IMG_0001.heic', { type: 'image/heic' });
    const raw = await extractMetadataFromOriginal(file);
    expect(raw.exifData).toMatchObject({ Make: 'samsung', Model: 'SM-G998B' });
  });

  it('recognises HEIC by extension when the MIME type is missing', async () => {
    const file = new File([buildHeif({ exifItem: appleItem(APPLE_TIFF) })], 'photo.HEIF', { type: '' });
    const raw = await extractMetadataFromOriginal(file);
    expect(raw.exifData).toMatchObject({ Make: 'Apple' });
  });
});

/* ── real-world sample (gitignored; skipped when absent) ─────── */

const SAMPLE = fileURLToPath(new URL('../../../public/test/sample.heic', import.meta.url));

describe('public/test/sample.heic', () => {
  it.skipIf(!existsSync(SAMPLE))('heif-enc output: Exif item at offset 0 is found and parsed by exifr', async () => {
    const tiff = must(extractExifTiffFromHeif(new Uint8Array(readFileSync(SAMPLE))));
    expect([Array.from(TIFF_LE), Array.from(TIFF_BE)]).toContainEqual(header(tiff));

    const parsed = (await exifr.parse(tiff, { tiff: true, exif: true, gps: true, translateKeys: true, translateValues: false })) as
      | Record<string, unknown>
      | undefined;
    const summary = {
      Make: parsed?.Make,
      Model: parsed?.Model,
      DateTimeOriginal: parsed?.DateTimeOriginal,
      GPS: parsed?.latitude != null ? `${parsed.latitude}, ${parsed.longitude}` : null
    };
    console.info('sample.heic →', summary);
    expect(typeof summary.Make).toBe('string');
    expect((summary.Make as string).length).toBeGreaterThan(0);
  });
});
