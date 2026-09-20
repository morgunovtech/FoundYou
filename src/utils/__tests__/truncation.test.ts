import { describe, expect, it } from 'vitest';
import { checkTruncation, tailHasEndMarker, walkForEndMarker } from '../truncation';

/** A minimal but structurally real JPEG: SOI, APP0/JFIF, SOS with a short scan, EOI. */
function jpeg({ withEoi = true, trailer = 0 } = {}): Uint8Array {
  const parts: number[] = [
    0xff, 0xd8, 0xff, // SOI + the first byte of the next marker
    0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS header, length 8
    0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78 // entropy data with a stuffed FF and a restart
  ];
  if (withEoi) parts.push(0xff, 0xd9);
  for (let i = 0; i < trailer; i += 1) parts.push(i % 251);
  return new Uint8Array(parts);
}

/** A minimal PNG: signature, IHDR, IDAT, optionally IEND. */
function png({ withEnd = true } = {}): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => {
    parts.push((data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff);
    for (const ch of type) parts.push(ch.charCodeAt(0));
    parts.push(...data);
    parts.push(0, 0, 0, 0); // CRC, never checked here
  };
  chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  chunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  if (withEnd) chunk('IEND', []);
  return new Uint8Array(parts);
}

describe('walkForEndMarker', () => {
  it('a whole JPEG reaches EOI', () => {
    expect(walkForEndMarker(jpeg())).toBe('complete');
  });

  it('a JPEG whose scan data just stops is truncated', () => {
    expect(walkForEndMarker(jpeg({ withEoi: false }))).toBe('jpeg-truncated');
  });

  it('a JPEG cut inside a segment header is truncated, not silently accepted', () => {
    // 20 bytes: SOI plus an APP0 that claims 16 bytes and has 3.
    expect(walkForEndMarker(jpeg().subarray(0, 9))).toBe('jpeg-truncated');
  });

  it('a trailer after EOI does not make the file truncated', () => {
    // A Samsung Motion Photo puts an MP4 after the image; the walk stops at EOI and never sees it.
    expect(walkForEndMarker(jpeg({ trailer: 4096 }))).toBe('complete');
  });

  it('a whole PNG reaches IEND and a cut one does not', () => {
    expect(walkForEndMarker(png())).toBe('complete');
    expect(walkForEndMarker(png({ withEnd: false }))).toBe('png-truncated');
  });

  it('a PNG chunk whose declared length runs past the file is truncated', () => {
    const bytes = png();
    // Blow up the IDAT length field (the chunk right after the 8-byte signature + 25-byte IHDR).
    bytes[8 + 25] = 0x7f;
    expect(walkForEndMarker(bytes)).toBe('png-truncated');
  });

  it('a format we do not end-check is never called truncated', () => {
    expect(walkForEndMarker(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBe('complete');
    expect(walkForEndMarker(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe('complete');
    expect(walkForEndMarker(new Uint8Array([]))).toBe('complete');
  });
});

describe('tailHasEndMarker', () => {
  const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const pngHead = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('finds the end marker in the tail of a whole file', () => {
    expect(tailHasEndMarker(jpegHead, new Uint8Array([0x11, 0x22, 0xff, 0xd9]))).toBe(true);
    expect(tailHasEndMarker(pngHead, new Uint8Array([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]))).toBe(true);
  });

  it('comes up empty on a cut tail, which is what sends the file to the full walk', () => {
    expect(tailHasEndMarker(jpegHead, new Uint8Array([0x11, 0x22, 0x33]))).toBe(false);
    expect(tailHasEndMarker(pngHead, new Uint8Array([0x11, 0x22, 0x33]))).toBe(false);
  });

  it('answers null — «do not check» — for every other container', () => {
    expect(tailHasEndMarker(new Uint8Array([0x52, 0x49, 0x46, 0x46]), new Uint8Array([0]))).toBeNull();
  });
});


describe('checkTruncation: what it reads', () => {
  /** A Blob that records every slice, so the test can see how much of the file was touched. */
  function countingBlob(bytes: Uint8Array) {
    const reads: Array<[number, number]> = [];
    const blob = {
      size: bytes.length,
      slice(start = 0, end = bytes.length) {
        const from = start < 0 ? Math.max(0, bytes.length + start) : Math.min(start, bytes.length);
        const to = end < 0 ? Math.max(0, bytes.length + end) : Math.min(end, bytes.length);
        reads.push([from, to]);
        const part = bytes.subarray(from, Math.max(from, to));
        return { arrayBuffer: async () => part.slice().buffer };
      },
      arrayBuffer: async () => {
        reads.push([0, bytes.length]);
        return bytes.slice().buffer;
      }
    };
    return { blob: blob as unknown as Blob, reads };
  }

  /**
   * A JPEG of `image` bytes followed by `trailer` bytes of video, laid out like a Motion Photo:
   * the picture first, its EOI, then the MP4.
   */
  function motionPhoto(image: number, trailer: number): Uint8Array {
    const head = jpeg({ trailer: Math.max(0, image - 40) });
    const out = new Uint8Array(head.length + trailer);
    out.set(head, 0);
    for (let i = 0; i < trailer; i += 1) out[head.length + i] = i % 251;
    // The EOI must be the last thing in the picture, so re-place it at the image's end.
    out[head.length - 2] = 0xff;
    out[head.length - 1] = 0xd9;
    return out;
  }

  it('answers a Motion Photo without ever holding the whole file', async () => {
    /*
     * The EOI sits before megabytes of MP4, so the 64 KB tail misses it. Reading the file whole
     * to answer would put a 50 MB photo in memory on the phone at once; the backwards scan holds
     * one window. What matters for a phone is that peak, not the bytes touched in total.
     */
    const bytes = motionPhoto(2 * 1024 * 1024, 1024 * 1024);
    const { blob, reads } = countingBlob(bytes);
    expect(await checkTruncation(blob)).toBe('complete');
    const peak = Math.max(...reads.map(([from, to]) => to - from));
    expect(peak).toBeLessThanOrEqual(1024 * 1024 + 64);
    expect(reads.some(([from, to]) => from === 0 && to === bytes.length)).toBe(false);
  });

  it('holds only a window even when the trailer is enormous', async () => {
    // A worst case: the picture is small and the video is everything. Still one window at a time.
    const bytes = motionPhoto(40, 3 * 1024 * 1024);
    const { blob, reads } = countingBlob(bytes);
    expect(await checkTruncation(blob)).toBe('complete');
    const peak = Math.max(...reads.map(([from, to]) => to - from));
    expect(peak).toBeLessThanOrEqual(1024 * 1024 + 64);
  });

  it('still reads only the tail for an ordinary photo', async () => {
    const { blob, reads } = countingBlob(jpeg({ trailer: 0 }));
    expect(await checkTruncation(blob)).toBe('complete');
    expect(reads.length).toBeLessThanOrEqual(2);
  });

  it('calls a cut file cut', async () => {
    const { blob } = countingBlob(jpeg({ withEoi: false }));
    expect(await checkTruncation(blob)).toBe('jpeg-truncated');
  });

  it('says nothing about a container it does not check', async () => {
    const { blob, reads } = countingBlob(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]));
    expect(await checkTruncation(blob)).toBe('complete');
    expect(reads).toHaveLength(1); // the 8-byte head, and nothing more
  });
});
