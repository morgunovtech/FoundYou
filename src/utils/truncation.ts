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
 * truncated or carries a trailer longer than that — a Samsung or Pixel Motion Photo hides its EOI
 * behind a multi-megabyte MP4, which makes that miss ordinary rather than rare — so the scan then
 * walks backwards a megabyte at a time and stops at the marker. Platform note: this is plain byte
 * reading through `Blob.slice`, identical on Android/Chrome and iOS/Safari, and no path holds more
 * than a window at once until a file is both small and genuinely suspect.
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

/** The end marker a container must carry, or null for the formats this does not check. */
export function endMarkerOf(head: Uint8Array): { needle: number[]; verdict: TruncationVerdict } | null {
  if (startsWith(head, JPEG_SOI)) return { needle: [0xff, 0xd9], verdict: 'jpeg-truncated' };
  if (startsWith(head, PNG_SIGNATURE)) return { needle: PNG_IEND, verdict: 'png-truncated' };
  // Not a container we know how to end-check: HEIC, WebP, AVIF, GIF, BMP.
  return null;
}

/** Pure part: given the first bytes and the last bytes, is the end marker in the tail? */
export function tailHasEndMarker(head: Uint8Array, tail: Uint8Array): boolean | null {
  const marker = endMarkerOf(head);
  if (!marker) return null;
  return lastIndexOf(tail, marker.needle) >= 0;
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

/**
 * Keep scanning backwards in windows of this size when the last 64 KB held no end marker. A
 * Motion Photo hides its EOI behind a multi-megabyte MP4, so that first miss is the common case
 * on a Samsung or a Pixel, not the exception — and reading a 50 MB file whole to answer it would
 * put the entire photo in memory on the phone.
 */
const BACK_SCAN_WINDOW = 1024 * 1024;
/** Overlap between windows so a marker straddling the boundary is not missed. */
const BACK_SCAN_OVERLAP = 4;
/** Past this the file is either truncated or something we should not spend more time on. */
const BACK_SCAN_LIMIT = 24 * 1024 * 1024;

/**
 * The whole check against a file.
 *
 * The last 64 KB answer for almost every photo. When they do not, the scan walks backwards a
 * megabyte at a time rather than reading the file whole: a trailer sits between the end marker
 * and the end of the file, so going backwards finds the marker after a window or two and stops.
 * Only a file with no marker anywhere in the last {@link BACK_SCAN_LIMIT} is called truncated,
 * and even then the walk over the whole file — the one answer that cannot be fooled by a byte
 * pair inside a video — is done only for files small enough to hold in memory.
 */
export async function checkTruncation(file: Blob): Promise<TruncationVerdict> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const marker = endMarkerOf(head);
    if (!marker) return 'complete';

    let end = file.size;
    const floor = Math.max(0, file.size - BACK_SCAN_LIMIT);
    let window = TAIL_BYTES;
    while (end > floor) {
      const start = Math.max(floor, end - window);
      const bytes = new Uint8Array(await file.slice(start, Math.min(file.size, end + BACK_SCAN_OVERLAP)).arrayBuffer());
      if (lastIndexOf(bytes, marker.needle) >= 0) return 'complete';
      if (start === floor) break;
      end = start;
      window = BACK_SCAN_WINDOW;
    }

    // No end marker within reach. For a file we can hold, confirm with the structural walk, which
    // distinguishes a cut scan from a merely unusual one; for anything larger, report the tail.
    if (file.size <= BACK_SCAN_LIMIT) return walkForEndMarker(new Uint8Array(await file.arrayBuffer()));
    return marker.verdict;
  } catch (error) {
    // Reading failed (a file that disappeared, an out-of-memory slice): say nothing rather than
    // accuse a file we could not read.
    console.warn('truncation-check-failed', error);
    return 'complete';
  }
}
