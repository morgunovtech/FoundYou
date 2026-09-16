import { describe, expect, it } from 'vitest';
import { stripContainerMetadata, stripJpegMetadata, stripPngMetadata } from '../containerMetadata';

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function jpeg(...segments: number[][]): ArrayBuffer {
  return new Uint8Array([0xff, 0xd8, ...segments.flat()]).buffer;
}

function markers(buffer: ArrayBuffer): number[] {
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

describe('stripJpegMetadata', () => {
  const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const app1Exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0]);
  const app2Icc = segment(0xe2, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0, 1, 1, 9, 9]);
  const app13Iptc = segment(0xed, [0x50, 0x68, 0x6f, 0x74, 0x6f, 0x73, 0x68, 0x6f, 0x70]);
  const app14Adobe = segment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 1]);
  const com = segment(0xfe, [0x68, 0x69]);
  const dqt = segment(0xdb, [0, ...new Array(64).fill(1)]);
  const sof = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
  const scan = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9];

  it('drops EXIF, ICC, IPTC and COM segments but keeps JFIF, Adobe, tables and the scan', () => {
    const input = jpeg(app0, app1Exif, app2Icc, app13Iptc, com, dqt, app14Adobe, sof, sos, scan);
    const output = stripJpegMetadata(input);
    expect(markers(output)).toEqual([0xe0, 0xdb, 0xee, 0xc0, 0xda]);
    // Scan bytes (including the stuffed 0xFF00 and EOI) survive verbatim.
    const bytes = new Uint8Array(output);
    expect(Array.from(bytes.subarray(bytes.length - scan.length))).toEqual(scan);
  });

  it('drops a vendor trailer after EOI and keeps tables between the scans of a progressive file', () => {
    const trailer = [0x53, 0x45, 0x46, 0x48, 1, 2, 3, 0x53, 0x45, 0x46, 0x54];
    const withTrailer = jpeg(app0, dqt, sof, sos, scan, trailer);
    const bytes = new Uint8Array(stripJpegMetadata(withTrailer));
    expect(Array.from(bytes.subarray(bytes.length - scan.length))).toEqual(scan);
    expect(bytes.length).toBe(new Uint8Array(jpeg(app0, dqt, sof, sos, scan)).length);
    // Progressive: scan, a DHT between scans (0xFF 0xC4 is a real marker, not stuffing), a second scan, EOI.
    const dht = segment(0xc4, [0, 1, 2, 3]);
    const firstScan = [0x12, 0xff, 0x00, 0xff, 0xd0, 0x34];
    const progressive = jpeg(app0, dqt, sof, sos, firstScan, dht, sos, [0x56, 0xff, 0xd9], trailer);
    const out = new Uint8Array(stripJpegMetadata(progressive));
    expect(Array.from(out)).toEqual(Array.from(new Uint8Array(jpeg(app0, dqt, sof, sos, firstScan, dht, sos, [0x56, 0xff, 0xd9]))));
  });

  it('is idempotent and leaves a clean file byte-identical', () => {
    const clean = jpeg(app0, dqt, sof, sos, scan);
    const once = stripJpegMetadata(clean);
    expect(new Uint8Array(once)).toEqual(new Uint8Array(clean));
    expect(new Uint8Array(stripJpegMetadata(once))).toEqual(new Uint8Array(clean));
  });

  it('returns the input untouched when the structure is not a JPEG or is truncated', () => {
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(stripJpegMetadata(notJpeg)).toBe(notJpeg);
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x10, 0x00, 1, 2]).buffer;
    expect(stripJpegMetadata(truncated)).toBe(truncated);
  });

  it('progressive JPEG: scans stay verbatim, a metadata segment between two scans is dropped', () => {
    const scan1 = [0x11, 0x22, 0xff, 0x00, 0x33];
    const sos2 = segment(0xda, [1, 1, 0, 1, 5, 0]);
    const scan2 = [0x44, 0x55, 0xff, 0xd9];
    // Inside entropy-coded data 0xFF is always stuffed, so an 0xFF 0xE1 pair after a scan is a
    // real APP1 segment between scans (where an editor may leave one) and is stripped like any other.
    const input = jpeg(app0, app1Exif, dqt, sof, [...sos, ...scan1, ...app1Exif, ...sos2, ...scan2]);

    const output = new Uint8Array(stripJpegMetadata(input));
    expect(output).toEqual(new Uint8Array([0xff, 0xd8, ...app0, ...dqt, ...sof, ...sos, ...scan1, ...sos2, ...scan2]));
    expect(markers(output.buffer)).toEqual([0xe0, 0xdb, 0xc0, 0xda]);
  });

  it('skips 0xFF fill bytes between segments', () => {
    const input = new Uint8Array([0xff, 0xd8, 0xff, ...app0, 0xff, 0xff, ...dqt, ...sof, ...sos, ...scan]).buffer;
    const output = stripJpegMetadata(input);
    expect(markers(output)).toEqual([0xe0, 0xdb, 0xc0, 0xda]);
    expect(output.byteLength).toBe(input.byteLength - 3);
  });

  it('a file that ends without SOS keeps its remaining segments', () => {
    const headerOnly = jpeg(app0, app1Exif, dqt, sof);
    expect(markers(stripJpegMetadata(headerOnly))).toEqual([0xe0, 0xdb, 0xc0]);
  });
});

function chunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...Array.from(type, (c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0 // crc placeholder: the stripper copies chunks verbatim and never validates it
  ];
}

function pngTypes(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return types;
}

describe('stripPngMetadata', () => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  it('drops iCCP, text and eXIf chunks and keeps rendering chunks in order', () => {
    const input = new Uint8Array([
      ...signature,
      ...chunk('IHDR', new Array(13).fill(0)),
      ...chunk('iCCP', [0x73, 0, 0, 1, 2, 3]),
      ...chunk('sRGB', [0]),
      ...chunk('tEXt', [0x70, 0x61, 0x72, 0x61, 0x6d, 0x73, 0, 0x41]),
      ...chunk('iTXt', [0x43, 0, 0, 0, 0, 0x42]),
      ...chunk('pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]),
      ...chunk('eXIf', [0x49, 0x49, 0x2a, 0]),
      ...chunk('IDAT', [1, 2, 3, 4]),
      ...chunk('tIME', [7, 0xe6, 6, 14, 18, 30, 12]),
      ...chunk('IEND', [])
    ]).buffer;
    const output = stripPngMetadata(input);
    expect(pngTypes(output)).toEqual(['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
  });

  it('returns non-PNG input untouched', () => {
    const notPng = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
    expect(stripPngMetadata(notPng)).toBe(notPng);
  });

  it('handles zero-length chunks: empty metadata is dropped, empty rendering chunks are kept', () => {
    const input = new Uint8Array([
      ...signature,
      ...chunk('IHDR', new Array(13).fill(0)),
      ...chunk('tEXt', []),
      ...chunk('IDAT', []),
      ...chunk('tIME', []),
      ...chunk('IDAT', [9]),
      ...chunk('IEND', [])
    ]).buffer;
    const output = stripPngMetadata(input);
    expect(pngTypes(output)).toEqual(['IHDR', 'IDAT', 'IDAT', 'IEND']);
    // Two empty chunks removed: 12 header/crc bytes each.
    expect(output.byteLength).toBe(input.byteLength - 2 * 12);
  });

  it('returns the input untouched when a chunk length overruns the buffer', () => {
    const input = new Uint8Array([...signature, 0, 0, 1, 0, ...Array.from('IHDR', (c) => c.charCodeAt(0)), 1, 2, 3, 4]).buffer;
    expect(stripPngMetadata(input)).toBe(input);
  });

  it('stops at IEND and drops whatever follows it', () => {
    const trailer = [0xde, 0xad, 0xbe, 0xef];
    const clean = [...signature, ...chunk('IHDR', new Array(13).fill(0)), ...chunk('IEND', [])];
    const input = new Uint8Array([...clean, ...trailer]).buffer;
    expect(new Uint8Array(stripPngMetadata(input))).toEqual(new Uint8Array(clean));
    // A file cut short before IEND is kept whole rather than truncated further.
    const cut = new Uint8Array([...signature, ...chunk('IHDR', new Array(13).fill(0)), 1, 2, 3]).buffer;
    expect(new Uint8Array(stripPngMetadata(cut))).toEqual(new Uint8Array(cut));
  });
});

describe('stripContainerMetadata', () => {
  const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const app1Exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0]);
  const app2Icc = segment(0xe2, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0, 1, 1, 9, 9]);
  const dqt = segment(0xdb, [0, ...new Array(64).fill(1)]);
  const sof = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
  const scan = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9];
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  it('returns the same Blob instance for image/webp and other types it does not rewrite', async () => {
    const webp = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], { type: 'image/webp' });
    expect(await stripContainerMetadata(webp)).toBe(webp);
    const gif = new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], { type: 'image/gif' });
    expect(await stripContainerMetadata(gif)).toBe(gif);
    const untyped = new Blob([new Uint8Array([0xff, 0xd8, ...app0])]);
    expect(await stripContainerMetadata(untyped)).toBe(untyped);
  });

  it('rewrites a JPEG blob without its metadata segments and keeps the type', async () => {
    const blob = new Blob([jpeg(app0, app1Exif, app2Icc, dqt, sof, sos, scan)], { type: 'image/jpeg' });
    const output = await stripContainerMetadata(blob);
    expect(output).not.toBe(blob);
    expect(output.type).toBe('image/jpeg');
    expect(output.size).toBe(blob.size - app1Exif.length - app2Icc.length);
    expect(markers(await output.arrayBuffer())).toEqual([0xe0, 0xdb, 0xc0, 0xda]);
  });

  it('rewrites a PNG blob without its metadata chunks', async () => {
    const blob = new Blob(
      [new Uint8Array([...signature, ...chunk('IHDR', new Array(13).fill(0)), ...chunk('iCCP', [1, 2, 3]), ...chunk('IDAT', [1]), ...chunk('IEND', [])])],
      { type: 'image/png' }
    );
    const output = await stripContainerMetadata(blob);
    expect(output).not.toBe(blob);
    expect(output.type).toBe('image/png');
    expect(pngTypes(await output.arrayBuffer())).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('returns the same instance when the bytes are not the declared container', async () => {
    const mislabeled = new Blob([new Uint8Array(signature)], { type: 'image/jpeg' });
    expect(await stripContainerMetadata(mislabeled)).toBe(mislabeled);
    const alsoMislabeled = new Blob([jpeg(app0, dqt, sof, sos, scan)], { type: 'image/png' });
    expect(await stripContainerMetadata(alsoMislabeled)).toBe(alsoMislabeled);
  });
});
