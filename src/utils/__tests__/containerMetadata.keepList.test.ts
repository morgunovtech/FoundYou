import { describe, expect, it } from 'vitest';
import { sniffContainer, stripContainerMetadata, stripJpegMetadata, stripPngMetadata } from '../containerMetadata';

/* ── builders ─────────────────────────────────────────────── */

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

function jpeg(...segments: number[][]): ArrayBuffer {
  return new Uint8Array([0xff, 0xd8, ...segments.flat()]).buffer;
}

function jpegMarkers(buffer: ArrayBuffer): number[] {
  const bytes = new Uint8Array(buffer);
  const found: number[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = bytes[offset + 1];
    found.push(marker);
    if (marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    offset += 2 + length;
  }
  return found;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [(length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, ...ascii(type), ...data, 0, 0, 0, 0];
}

function png(...chunks: number[][]): ArrayBuffer {
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]).buffer;
}

function pngChunkTypes(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    types.push(String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]));
    offset += 12 + length;
  }
  return types;
}

/* ── JPEG: only the two decoder blocks survive under APP0 / APP14 ── */

describe('stripJpegMetadata keeps APP0 and APP14 only when they are the decoder blocks', () => {
  const jfif = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const jfxx = segment(0xe0, [...ascii('JFXX'), 0, 0x10, 0xff, 0xd8, 0xff, 0xd9]);
  const vendorApp0 = segment(0xe0, [...ascii('AVI1'), 0, 0, 0]);
  const adobe = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
  const vendorApp14 = segment(0xee, [...ascii('Foo'), 0, 1, 2, 3]);
  const dqt = segment(0xdb, [0, ...new Array(64).fill(1)]);
  const sof = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
  const scan = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9];

  it('drops a JFXX thumbnail — the picture again, in small — and a vendor APP0', () => {
    const output = stripJpegMetadata(jpeg(jfif, jfxx, vendorApp0, dqt, sof, sos, scan));
    expect(jpegMarkers(output)).toEqual([0xe0, 0xdb, 0xc0, 0xda]);
    // The surviving APP0 is the JFIF one.
    const bytes = new Uint8Array(output);
    expect(String.fromCharCode(...bytes.subarray(6, 10))).toBe('JFIF');
  });

  it('keeps the Adobe APP14 (the colour transform flag) and drops any other APP14', () => {
    const output = stripJpegMetadata(jpeg(jfif, dqt, vendorApp14, adobe, sof, sos, scan));
    expect(jpegMarkers(output)).toEqual([0xe0, 0xdb, 0xee, 0xc0, 0xda]);
    const bytes = new Uint8Array(output);
    const app14 = bytes.indexOf(0xee, 2) ;
    expect(String.fromCharCode(...bytes.subarray(app14 + 3, app14 + 8))).toBe('Adobe');
  });
});

/* ── PNG: a keep-list, not a drop-list ──────────────────────── */

describe('stripPngMetadata keeps only what a decoder needs', () => {
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = chunk('IDAT', [1, 2, 3]);
  const iend = chunk('IEND', []);

  it('drops a Content Credentials manifest (caBX) and a private chunk nobody has heard of', () => {
    /*
     * The drop-list it used to be knew tEXt, iCCP and eXIf but not caBX, so a Firefly or
     * Photoshop PNG kept its whole manifest through the «metadata only» export while exifr,
     * which does not read caBX, reported 0 fields left.
     */
    const input = png(ihdr, chunk('caBX', ascii('jumb...manifest')), chunk('prVW', [9, 9]), chunk('tEXt', ascii('parameters\0a prompt')), idat, iend);
    expect(pngChunkTypes(stripPngMetadata(input))).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('keeps the rendering chunks: transparency, gamma, colour space, physical size, animation', () => {
    const input = png(
      ihdr,
      chunk('gAMA', [0, 1, 0, 0]),
      chunk('cHRM', new Array(32).fill(0)),
      chunk('sRGB', [0]),
      chunk('pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]),
      chunk('tRNS', [0, 0]),
      chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]),
      chunk('iCCP', ascii('profile\0')),
      idat,
      iend
    );
    expect(pngChunkTypes(stripPngMetadata(input))).toEqual(['IHDR', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'tRNS', 'acTL', 'IDAT', 'IEND']);
  });
});

/* ── the container is what the bytes say ──────────────────── */

describe('stripContainerMetadata reads the format from the bytes', () => {
  it('a JPEG saved as .png is still stripped as a JPEG', async () => {
    const exif = segment(0xe1, [...ascii('Exif'), 0, 0, 0x49, 0x49, 0x2a, 0]);
    const dqt = segment(0xdb, [0, ...new Array(64).fill(1)]);
    const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
    const input = jpeg(exif, dqt, sos, [0x12, 0xff, 0xd9]);
    const out = await stripContainerMetadata(new Blob([input], { type: 'image/png' }));
    expect(out.type).toBe('image/jpeg');
    expect(jpegMarkers(await out.arrayBuffer())).toEqual([0xdb, 0xda]);
  });

  it('a file that is neither is returned untouched', async () => {
    const webp = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], { type: 'image/jpeg' });
    expect(await stripContainerMetadata(webp)).toBe(webp);
    expect(sniffContainer(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
    expect(sniffContainer(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffContainer(new Uint8Array(PNG_SIGNATURE))).toBe('image/png');
  });
});
