/**
 * Container-level metadata stripping for files produced by `canvas.toBlob`.
 *
 * Re-encoding through a canvas drops the *source* EXIF/XMP/IPTC, but the browser's
 * own encoder still writes container metadata of its own: Chrome embeds an sRGB
 * ICC profile (APP2) into JPEGs and an `iCCP`/`sRGB` chunk into PNGs, Safari adds
 * a COM segment, and so on. None of that identifies the user, yet a verifier that
 * counts metadata fields (ours included) sees ~20 ICC fields and the promise
 * "0 fields left" becomes untrue. These helpers remove every optional segment the
 * decoder does not need, so the exported file really contains pixels only.
 *
 * Both functions are pure byte-level rewrites: no re-encoding, no quality loss. They also
 * serve the «metadata only» export, which keeps the original picture bytes: there the
 * walk must reach the real end of the image and drop whatever follows it (a Samsung
 * trailer with the SIM country and a Motion Photo video, a PNG with bytes after IEND).
 */

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;
/** Markers with no length field (RSTn, SOI, EOI, TEM). */
const isStandalone = (marker: number) => (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === JPEG_SOI || marker === JPEG_EOI;
/**
 * Segments to drop: APP1 (EXIF/XMP), APP2 (ICC, FlashPix), APP3–APP12 (Kodak, HP,
 * Ducky…), APP13 (Photoshop/IPTC), APP15 and COM. APP0 and APP14 are kept only when
 * they are what decoders rely on: a `JFIF` APP0 (pixel density) and an `Adobe` APP14
 * (colour transform). A `JFXX` APP0 is an embedded thumbnail — the picture again, in
 * small — and any other payload under those two markers is a vendor's, not the decoder's.
 */
const isJpegMetadataMarker = (marker: number) =>
  marker === 0xfe || (marker >= 0xe1 && marker <= 0xed) || marker === 0xef;

const JPEG_APP0 = 0xe0;
const JPEG_APP14 = 0xee;

/** Whether the payload of an APP0 / APP14 segment starting at `payload` names the standard block. */
function isDecoderSegment(bytes: Uint8Array, marker: number, payload: number, end: number): boolean {
  const startsWith = (text: string) => {
    if (payload + text.length > end) return false;
    for (let i = 0; i < text.length; i++) {
      if (bytes[payload + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  if (marker === JPEG_APP0) return startsWith('JFIF\0');
  if (marker === JPEG_APP14) return startsWith('Adobe');
  return true;
}

export function stripJpegMetadata(input: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(input);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) return input;

  const keep: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Not a marker where one is expected: bail out and keep the file untouched.
      return input;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      // Fill byte; skip.
      offset += 1;
      continue;
    }
    if (isStandalone(marker)) {
      keep.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      if (marker === JPEG_EOI) break;
      continue;
    }
    if (offset + 4 > bytes.length) return input;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return input;
    const end = offset + 2 + length;
    if (marker === JPEG_SOS) {
      // Entropy-coded data follows the SOS header. Inside it 0xFF is always stuffed (0xFF00)
      // or a restart marker, so the next real marker is the first 0xFF followed by anything
      // else; the walk then resumes (a progressive JPEG has several scans and tables between
      // them) and stops at EOI, so a vendor trailer after the image is never copied.
      const scanEnd = findScanEnd(bytes, end);
      keep.push(bytes.subarray(offset, scanEnd));
      offset = scanEnd;
      continue;
    }
    if (!isJpegMetadataMarker(marker) && isDecoderSegment(bytes, marker, offset + 4, end)) {
      keep.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  return concat(keep);
}

/** Index of the first marker after entropy-coded data starting at `from` (or the end of the buffer). */
function findScanEnd(bytes: Uint8Array, from: number): number {
  let i = from;
  while (i + 1 < bytes.length) {
    if (bytes[i] === 0xff) {
      const next = bytes[i + 1];
      const stuffed = next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7);
      if (!stuffed) return i;
    }
    i++;
  }
  return bytes.length;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/**
 * The chunks a PNG needs to be shown: the critical four, the ones that describe how to
 * interpret the pixels (transparency, gamma, colour space, physical size, palette hints)
 * and the animation triplet. Everything else is dropped — this is a keep-list, not a
 * drop-list, because the drop-list it used to be knew `tEXt`, `iCCP` and `eXIf` but not
 * `caBX`, the chunk a Content Credentials manifest travels in, and a Firefly or Photoshop
 * PNG kept its whole manifest through the «metadata only» export while exifr, which does
 * not read `caBX`, reported 0 fields left. A private chunk no one has heard of gets the
 * same treatment: the promise is «pixels only», and a keep-list is the only way to mean it.
 */
const PNG_KEEP_CHUNKS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND',
  'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs', 'hIST', 'sPLT',
  'cICP', 'mDCv', 'cLLi',
  'acTL', 'fcTL', 'fdAT'
]);

export function stripPngMetadata(input: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(input);
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return input;

  const keep: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 0 || offset + 12 + length > bytes.length) return input;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const end = offset + 12 + length; // length + type + data + crc
    if (PNG_KEEP_CHUNKS.has(type)) {
      keep.push(bytes.subarray(offset, end));
    }
    offset = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  // Bytes after IEND are not part of the picture; a file cut short before IEND is kept whole.
  if (!sawEnd && offset < bytes.length) keep.push(bytes.subarray(offset));
  return concat(keep);
}

/** What the first bytes say the container is; the extension and `blob.type` are only what someone named it. */
export function sniffContainer(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === JPEG_SOI) return 'image/jpeg';
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return 'image/png';
  return null;
}

/**
 * Strips container metadata for the formats we know how to rewrite; other blobs are returned
 * untouched. The format is read from the bytes, not from `blob.type`: a JPEG saved as `.png`
 * used to reach the PNG stripper, which found no signature and handed the file back with every
 * field in place, and the summary still said «Файл готов».
 */
export async function stripContainerMetadata(blob: Blob): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  const type = sniffContainer(new Uint8Array(buffer));
  if (!type) return blob;
  const stripped = type === 'image/jpeg' ? stripJpegMetadata(buffer) : stripPngMetadata(buffer);
  return stripped === buffer ? blob : new Blob([stripped], { type });
}

function concat(parts: Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out.buffer;
}
