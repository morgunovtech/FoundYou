/*
 * Does the file reach its own end marker?
 *
 * A JPEG ends with EOI (FF D9) and a PNG with an IEND chunk. A file cut short — an interrupted
 * download, a messenger that dropped the connection, a half-written file recovered from a card —
 * keeps both its header and most of its pixels, so every browser decodes it happily and paints
 * the missing rows grey or leaves them transparent. Nothing on the page says so, and the missing
 * part is exactly where a detector would have looked.
 *
 * The answer is a warning, never a refusal: the metadata sits at the front of the file and is
 * intact, the visible pixels are real, and the reading is still worth showing. What changes is
 * that the page admits the frame is incomplete instead of presenting a cut file as whole.
 *
 * Cost: the common case reads the last 64 KB only. A file with no end marker there is either
 * truncated or carries a trailer longer than that (a Samsung Motion Photo, whose MP4 payload runs
 * to several megabytes), and only then is the whole file read and walked. Platform note: this is
 * plain byte reading through `Blob.slice`, identical on Android/Chrome and iOS/Safari; the
 * full-read path is the one to watch on a phone, which is why it stays the exception.
 */

export type TruncationVerdict =
  /** The end marker is there, or the format is one we do not check. */
  | 'complete'
  /** A JPEG with no EOI: the scan data stops mid-frame. */
  | 'jpeg-truncated'
  /** A PNG with no IEND chunk. */
  | 'png-truncated';

const TAIL_BYTES = 64 * 1024;
const JPEG_SOI = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** ASCII «IEND». */
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

/** Index of the last occurrence of `needle`, or −1. */
function lastIndexOf(bytes: Uint8Array, needle: number[]): number {
  for (let i = bytes.length - needle.length; i >= 0; i -= 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/** Pure part: given the first bytes and the last bytes, is the end marker in the tail? */
export function tailHasEndMarker(head: Uint8Array, tail: Uint8Array): boolean | null {
  if (startsWith(head, JPEG_SOI)) return lastIndexOf(tail, [0xff, 0xd9]) >= 0;
  if (startsWith(head, PNG_SIGNATURE)) return lastIndexOf(tail, PNG_IEND) >= 0;
  // Not a container we know how to end-check: HEIC, WebP, AVIF, GIF, BMP.
  return null;
}

/**
 * Pure part: walk a whole JPEG or PNG and say whether it reaches its end marker.
 *
 * Unlike the tail scan this cannot be fooled by a byte pair that happens to read as FF D9 inside
 * a video trailer, and it is the only answer used to raise the warning.
 */
export function walkForEndMarker(bytes: Uint8Array): TruncationVerdict {
  if (startsWith(bytes, JPEG_SOI)) return walkJpeg(bytes);
  if (startsWith(bytes, PNG_SIGNATURE)) return walkPng(bytes);
  return 'complete';
}

function walkJpeg(bytes: Uint8Array): TruncationVerdict {
  let offset = 2;
  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      // The walk lost the marker stream. That is a malformed file rather than a cut one, and
      // saying «обрезан» about it would be a guess, so it passes.
      return 'complete';
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9) return 'complete';
    // RSTn / SOI / TEM carry no length field.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xd8) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return 'jpeg-truncated';
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return 'complete';
    const end = offset + 2 + length;
    // A segment whose declared length runs past the end of the file is the classic cut header.
    if (end > bytes.length) return 'jpeg-truncated';
    if (marker === 0xda) {
      offset = findScanEnd(bytes, end);
      continue;
    }
    offset = end;
  }
  return 'jpeg-truncated';
}

/** Index of the first real marker after entropy-coded data starting at `from`, or the end. */
function findScanEnd(bytes: Uint8Array, from: number): number {
  let i = from;
  while (i + 1 < bytes.length) {
    if (bytes[i] === 0xff) {
      const next = bytes[i + 1];
      const stuffed = next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7);
      if (!stuffed) return i;
    }
    i += 1;
  }
  return bytes.length;
}

function walkPng(bytes: Uint8Array): TruncationVerdict {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 0) return 'complete';
    const end = offset + 12 + length;
    if (end > bytes.length) return 'png-truncated';
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === 'IEND') return 'complete';
    offset = end;
  }
  return 'png-truncated';
}

/** The whole check against a file: cheap tail scan first, full walk only when it comes up empty. */
export async function checkTruncation(file: Blob): Promise<TruncationVerdict> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const tailStart = Math.max(0, file.size - TAIL_BYTES);
    const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
    const quick = tailHasEndMarker(head, tail);
    if (quick === null || quick === true) return 'complete';
    return walkForEndMarker(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    // Reading failed (a file that disappeared, an out-of-memory slice): say nothing rather than
    // accuse a file we could not read.
    console.warn('truncation-check-failed', error);
    return 'complete';
  }
}
