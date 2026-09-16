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
 * Ducky…), APP13 (Photoshop/IPTC), APP15 and COM. APP0 (JFIF/JFXX) and APP14
 * (Adobe colour transform) are kept: decoders rely on them for density and
 * colour interpretation, and neither carries user data.
 */
const isJpegMetadataMarker = (marker: number) =>
  marker === 0xfe || (marker >= 0xe1 && marker <= 0xed) || marker === 0xef;

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
    if (!isJpegMetadataMarker(marker)) {
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
 * Ancillary chunks that carry metadata rather than rendering information.
 * `sRGB`, `gAMA`, `cHRM`, `pHYs`, `tRNS`, `bKGD`, `PLTE` stay: they describe how to
 * show the pixels and contain no free text or profile blobs.
 */
const PNG_METADATA_CHUNKS = new Set(['iCCP', 'tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG', 'oFFs', 'pCAL', 'sCAL', 'sTER']);

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
    if (!PNG_METADATA_CHUNKS.has(type)) {
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

/** Strips container metadata for the formats we know how to rewrite; other blobs are returned untouched. */
export async function stripContainerMetadata(blob: Blob): Promise<Blob> {
  const type = blob.type || '';
  if (type !== 'image/jpeg' && type !== 'image/png') return blob;
  const buffer = await blob.arrayBuffer();
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
