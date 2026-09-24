import exifr from 'exifr';
import { phashFromImage } from './phash';
import type { EmbeddedThumbnail } from './fileHistory';

type RawMetadata = {
  exifData: Record<string, unknown> | undefined;
  xmpData: Record<string, unknown> | undefined;
  iptcData: Record<string, unknown> | undefined;
  iccData: Record<string, unknown> | undefined;
  /** PNG only: IHDR header fields + text chunks (tEXt / zTXt / iTXt). */
  pngData: Record<string, unknown> | undefined;
  gpsRaw: Record<string, unknown> | undefined;
  /**
   * The date tags as the twenty ASCII characters they are in the file, before exifr revives them
   * into `Date`s. Reviving hides an impossible value: `2031:02:30 25:61:61` silently becomes
   * 3 March 2031, 02:02. `exifDateSanity.ts` judges these strings.
   */
  rawDates: Record<string, string> | undefined;
};

/* ── HEIF / ISO-BMFF Exif extraction ─────────────────────────────────────────
 *
 * exifr cannot open HEIC containers, so the TIFF stream is cut out first. The Exif item
 * (ISO/IEC 23008-12 §A.2.1) is `exif_tiff_header_offset` (4 bytes, big-endian) followed by
 * the TIFF header at `4 + offset`. Apple writes offset 6 and puts the JPEG-style `Exif\0\0`
 * marker in front of the TIFF; libheif's heif-enc and most other encoders write offset 0 and
 * a bare TIFF — which the old "search for Exif\0\0" scan never found.
 *
 * The box walk locates the item exactly: meta → iinf (which item is `Exif`) → iloc (where
 * its bytes are: absolute file offsets for construction_method 0, offsets into `idat` for 1).
 * The marker scan is kept only as a fallback for files with a damaged `meta`.
 */

/** Hard cap on the returned TIFF (a real Exif block is tens of KB; some embed a preview JPEG). */
const TIFF_MAX_BYTES = 8 * 1024 * 1024;

interface Box {
  type: string;
  /** Offset of the first payload byte (after size + type [+ largesize]). */
  payload: number;
  end: number;
}

interface ItemLocation {
  constructionMethod: number;
  dataReferenceIndex: number;
  baseOffset: number;
  extents: Array<{ offset: number; length: number }>;
}

const fourcc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

const dataView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Boxes of one nesting level in [start, end). Stops at the first malformed header. */
function* iterateBoxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
  const view = dataView(bytes);
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = fourcc(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset; // extends to the end of the enclosing box
    }
    if (size < header) return;
    yield { type, payload: offset + header, end: Math.min(offset + size, end) };
    offset += size;
  }
}

/** Reads a 0/4/8-byte unsigned field used by iloc; other widths are invalid per spec. */
function readSized(view: DataView, at: number, size: number): number {
  if (size === 0) return 0;
  if (size === 4) return view.getUint32(at);
  if (size === 8) return Number(view.getBigUint64(at));
  throw new RangeError(`iloc field size ${size}`);
}

/** Item IDs whose `infe` declares item_type 'Exif'. */
function parseExifItemIds(bytes: Uint8Array, iinf: Box): number[] {
  const view = dataView(bytes);
  const version = bytes[iinf.payload];
  const countAt = iinf.payload + 4;
  const entriesAt = version === 0 ? countAt + 2 : countAt + 4;
  const ids: number[] = [];
  for (const infe of iterateBoxes(bytes, entriesAt, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const infeVersion = bytes[infe.payload];
    if (infeVersion < 2) continue; // v0/v1 carry no item_type
    let at = infe.payload + 4;
    const itemId = infeVersion === 2 ? view.getUint16(at) : view.getUint32(at);
    at += infeVersion === 2 ? 2 : 4;
    at += 2; // item_protection_index
    if (at + 4 > infe.end) continue;
    if (fourcc(bytes, at) === 'Exif') ids.push(itemId);
  }
  return ids;
}

function parseItemLocations(bytes: Uint8Array, iloc: Box): Map<number, ItemLocation> {
  const view = dataView(bytes);
  const version = bytes[iloc.payload];
  let at = iloc.payload + 4;
  const offsetSize = bytes[at] >> 4;
  const lengthSize = bytes[at] & 0x0f;
  const baseOffsetSize = bytes[at + 1] >> 4;
  const indexSize = version === 1 || version === 2 ? bytes[at + 1] & 0x0f : 0;
  at += 2;
  const itemCount = version < 2 ? view.getUint16(at) : view.getUint32(at);
  at += version < 2 ? 2 : 4;

  const locations = new Map<number, ItemLocation>();
  for (let i = 0; i < itemCount && at < iloc.end; i++) {
    const itemId = version < 2 ? view.getUint16(at) : view.getUint32(at);
    at += version < 2 ? 2 : 4;
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = view.getUint16(at) & 0x0f;
      at += 2;
    }
    const dataReferenceIndex = view.getUint16(at);
    at += 2;
    const baseOffset = readSized(view, at, baseOffsetSize);
    at += baseOffsetSize;
    const extentCount = view.getUint16(at);
    at += 2;
    // An Exif item has one extent, two at most; a box that declares 65 535 per item with zero-byte
    // offsets and lengths never advances the cursor and used to allocate an object per extent —
    // measured, 40 such items in a 319-byte file took 154 MB of heap. Bound both, and stop at the
    // end of the box inside the loop as well as outside it.
    if (extentCount > ILOC_MAX_EXTENTS || locations.size >= ILOC_MAX_ITEMS) break;
    const extents: ItemLocation['extents'] = [];
    for (let e = 0; e < extentCount && at < iloc.end; e++) {
      at += indexSize; // extent_index — unused (only meaningful for construction_method 2)
      const offset = readSized(view, at, offsetSize);
      at += offsetSize;
      const length = readSized(view, at, lengthSize);
      at += lengthSize;
      extents.push({ offset, length });
    }
    locations.set(itemId, { constructionMethod, dataReferenceIndex, baseOffset, extents });
  }
  return locations;
}

/** More extents than any still image needs, and more items than a HEIC of one picture carries. */
const ILOC_MAX_EXTENTS = 64;
const ILOC_MAX_ITEMS = 4096;

/** Concatenates the Exif item's extents; a single extent is returned as a view (no copy). */
function readItemBytes(bytes: Uint8Array, location: ItemLocation, idat: Box | null): Uint8Array | null {
  if (location.dataReferenceIndex !== 0) return null; // data lives in another file
  let base: number;
  let limit: number;
  if (location.constructionMethod === 0) {
    base = location.baseOffset;
    limit = bytes.length;
  } else if (location.constructionMethod === 1 && idat) {
    base = idat.payload + location.baseOffset;
    limit = idat.end;
  } else {
    return null; // construction_method 2 (item offsets) is not used for Exif in practice
  }

  const parts: Uint8Array[] = [];
  let total = 0;
  for (const extent of location.extents) {
    const start = base + extent.offset;
    const end = start + extent.length;
    if (extent.length <= 0 || start < 0 || end > limit) return null;
    parts.push(bytes.subarray(start, end));
    total += extent.length;
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const joined = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    joined.set(part, cursor);
    cursor += part.length;
  }
  return joined;
}

const isTiffHeader = (bytes: Uint8Array, at: number) =>
  at + 4 <= bytes.length &&
  ((bytes[at] === 0x49 && bytes[at + 1] === 0x49 && bytes[at + 2] === 0x2a && bytes[at + 3] === 0x00) || // "II*\0"
    (bytes[at] === 0x4d && bytes[at + 1] === 0x4d && bytes[at + 2] === 0x00 && bytes[at + 3] === 0x2a)); // "MM\0*"

const isExifMarker = (bytes: Uint8Array, at: number) =>
  at + 6 <= bytes.length &&
  bytes[at] === 0x45 && bytes[at + 1] === 0x78 && bytes[at + 2] === 0x69 && bytes[at + 3] === 0x66 && // "Exif"
  bytes[at + 4] === 0x00 && bytes[at + 5] === 0x00;

/** First TIFF header in [from, to), with or without a leading "Exif\0\0"; -1 when absent. */
function findTiffHeader(bytes: Uint8Array, from: number, to: number): number {
  for (let i = from; i + 4 <= to; i++) {
    if (isTiffHeader(bytes, i)) return i;
  }
  return -1;
}

/** Exif item payload → TIFF stream (ISO 23008-12 A.2.1, tolerant of the common writer mistakes). */
function tiffFromExifItem(item: Uint8Array): Uint8Array | null {
  if (item.length < 4 + 8) return null;
  const headerOffset = dataView(item).getUint32(0);
  let start = 4 + headerOffset;
  if (start + 8 > item.length) start = 4; // nonsense offset — assume the TIFF follows the field
  if (isExifMarker(item, start)) start += 6; // Apple (offset 6) and writers that add the marker but declare 0
  if (!isTiffHeader(item, start)) {
    const found = findTiffHeader(item, 0, item.length);
    if (found === -1) return null;
    start = found;
  }
  return item.slice(start, Math.min(item.length, start + TIFF_MAX_BYTES));
}

/** ISO-BMFF walk: meta → iinf/iloc/idat → Exif item → TIFF. Null when the structure is absent or broken. */
function locateExifViaBoxes(bytes: Uint8Array): Uint8Array | null {
  try {
    for (const box of iterateBoxes(bytes, 0, bytes.length)) {
      if (box.type !== 'meta') continue;
      let iinf: Box | null = null;
      let iloc: Box | null = null;
      let idat: Box | null = null;
      // `meta` is a FullBox: 4 bytes of version/flags precede its children.
      for (const child of iterateBoxes(bytes, box.payload + 4, box.end)) {
        if (child.type === 'iinf') iinf = child;
        else if (child.type === 'iloc') iloc = child;
        else if (child.type === 'idat') idat = child;
      }
      if (!iinf || !iloc) continue;
      const locations = parseItemLocations(bytes, iloc);
      for (const itemId of parseExifItemIds(bytes, iinf)) {
        const location = locations.get(itemId);
        if (!location) continue;
        const item = readItemBytes(bytes, location, idat);
        const tiff = item && tiffFromExifItem(item);
        if (tiff) return tiff;
      }
    }
  } catch {
    // Truncated or malformed boxes — fall back to the marker scan below.
  }
  return null;
}

/** Legacy fallback: "Exif\0\0" immediately followed by a TIFF header anywhere in the file. */
function scanForExifMarker(bytes: Uint8Array): Uint8Array | null {
  let i = bytes.indexOf(0x45);
  while (i !== -1 && i + 10 <= bytes.length) {
    if (isExifMarker(bytes, i) && isTiffHeader(bytes, i + 6)) {
      const start = i + 6;
      return bytes.slice(start, Math.min(bytes.length, start + TIFF_MAX_BYTES));
    }
    i = bytes.indexOf(0x45, i + 1);
  }
  return null;
}

/**
 * TIFF stream of the Exif item in a HEIF/HEIC/AVIF container (any brand: heic, heix, hevc,
 * heim, heis, hevm, mif1, msf1 share the same meta/iinf/iloc layout), or null.
 * Exported for tests; the app goes through `extractMetadataFromOriginal`.
 */
export function extractExifTiffFromHeif(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 16) return null;
  return locateExifViaBoxes(bytes) ?? scanForExifMarker(bytes);
}

async function extractExifFromHeic(file: File): Promise<Uint8Array | null> {
  try {
    return extractExifTiffFromHeif(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

const HEIC_MIME_PREFIXES = ['image/heic', 'image/heif'];

function isHeicFile(file: File): boolean {
  if (HEIC_MIME_PREFIXES.some(m => file.type.toLowerCase().startsWith(m))) return true;
  return /\.(heic|heif)$/i.test(file.name);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Magic-byte check — MIME types from the OS are not reliable for renamed files. */
async function isPngFile(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, PNG_SIGNATURE.length).arrayBuffer());
    return PNG_SIGNATURE.every((byte, index) => head[index] === byte);
  } catch {
    return false;
  }
}

/**
 * The IFD1 thumbnail the camera embedded (JPEG bytes), decoded for its size and perceptual
 * hash. HEIC keeps it inside the Exif item, so the TIFF is cut out first. Null when there is
 * none or the browser cannot decode it. The caller owns the blob URL.
 *
 * The thumbnail JPEG carries no EXIF of its own, so the browser shows it as stored, while the
 * main picture is shown with the `Orientation` tag applied. Both are compared (and shown) the
 * same way up: the thumbnail is turned by the main picture's tag before it is hashed.
 */
export async function readEmbeddedThumbnail(file: File, orientation?: number | string | null): Promise<EmbeddedThumbnail | null> {
  let source: File | Uint8Array = file;
  if (isHeicFile(file)) {
    const exifTiff = await extractExifFromHeic(file);
    if (!exifTiff) return null;
    source = exifTiff;
  }
  const bytes = (await exifr.thumbnail(source as Parameters<typeof exifr.thumbnail>[0])) as Uint8Array | undefined;
  if (!bytes || bytes.length < 100) return null;
  const rawBlob = new Blob([Uint8Array.from(bytes)], { type: 'image/jpeg' });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(rawBlob);
  } catch {
    return null;
  }
  try {
    const oriented = orientThumbnail(bitmap, exifOrientationCode(orientation));
    if (!oriented) {
      const { width, height } = bitmap;
      return { url: URL.createObjectURL(rawBlob), width, height, bytes: bytes.length, phash: phashFromImage(bitmap) };
    }
    const orientedBlob = await new Promise<Blob | null>((resolve) => oriented.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9));
    return {
      url: URL.createObjectURL(orientedBlob ?? rawBlob),
      width: oriented.width,
      height: oriented.height,
      bytes: bytes.length,
      phash: phashFromImage(oriented)
    };
  } finally {
    bitmap.close();
  }
}

/** The EXIF `Orientation` tag as a number 1–8; anything else (missing, a translated string) is 1. */
export function exifOrientationCode(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 8) return numeric;
    const text = value.toLowerCase();
    if (/rotate 180/.test(text)) return 3;
    if (/rotate 90 cw/.test(text)) return 6;
    if (/rotate 270 cw/.test(text)) return 8;
  }
  return 1;
}

/**
 * Draws a bitmap the way the EXIF orientation says it should be viewed (the same transforms a
 * browser applies to the main picture). Null when nothing needs to change.
 */
function orientThumbnail(bitmap: ImageBitmap, code: number): HTMLCanvasElement | null {
  if (code <= 1 || code > 8) return null;
  const swap = code >= 5;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? bitmap.height : bitmap.width;
  canvas.height = swap ? bitmap.width : bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = bitmap.width;
  const h = bitmap.height;
  switch (code) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, h, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, h, w);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, w);
      break;
    default:
      break;
  }
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

export async function extractMetadataFromOriginal(file: File): Promise<RawMetadata> {
  // For HEIC files: extract EXIF TIFF blob from the ISO BMFF container,
  // then parse that blob with exifr (which doesn't support HEIC natively).
  let parseSource: File | Uint8Array = file;
  if (isHeicFile(file)) {
    const exifTiff = await extractExifFromHeic(file);
    if (exifTiff) {
      parseSource = exifTiff;
    }
    // If no EXIF found in HEIC, fall through to try parsing the file directly
    // (will likely return empty, but no harm)
  }

  const parsed = await safeExtract(() =>
    exifr.parse(parseSource, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      iptc: true,
      icc: true,
      // PNG header + tEXt chunks (Stable Diffusion `parameters`, ComfyUI `workflow`, …).
      // exifr only ever emits this segment for PNG sources, so it is harmless for JPEG/HEIC.
      ihdr: true,
      // The raw MakerNote bytes: `appleMakerNote.ts` reads uptime / Live Photo / burst out of them.
      makerNote: true,
      translateKeys: true,
      translateValues: false,
    })
  ) as Record<string, unknown> | undefined;

  const gpsRaw = await safeExtract(() => (exifr as any).gps(parseSource));

  // A second, deliberately tiny pass: only the date tags, unrevived. It reads the same TIFF
  // header region that is already in the page cache, so the cost is parsing, not I/O.
  const rawDates = (await safeExtract(() =>
    exifr.parse(parseSource, {
      tiff: true,
      exif: true,
      gps: false,
      xmp: false,
      iptc: false,
      icc: false,
      ihdr: false,
      translateKeys: true,
      translateValues: false,
      reviveValues: false,
      pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ModifyDate']
    })
  )) as Record<string, string> | undefined;

  // PNG: collect the header + every text chunk separately so they can live in their own group.
  let pngData: Record<string, unknown> | undefined;
  if (await isPngFile(file)) {
    const header = (await safeExtract(() =>
      exifr.parse(file, {
        ihdr: true,
        tiff: false,
        exif: false,
        gps: false,
        xmp: false,
        iptc: false,
        icc: false,
        mergeOutput: false,
        translateKeys: true,
        translateValues: true,
      })
    )) as { ihdr?: Record<string, unknown> } | undefined;
    const text = await safeExtract(() => readPngTextChunks(file));
    const merged = { ...(header?.ihdr ?? {}), ...(text ?? {}) };
    if (Object.keys(merged).length > 0) {
      pngData = merged;
    }
  }

  const base = parsed ?? {};

  // exifr returns all segments merged into one flat object when parsed together.
  // Split them back into logical groups for the rest of the pipeline.
  const XMP_KEYS = new Set(['Rating', 'Label', 'Subject', 'Description', 'Title',
    'Creator', 'Rights', 'CreatorTool', 'CreateDate', 'ModifyDate', 'MetadataDate',
    'xmp', 'dc', 'photoshop', 'xmpMM', 'crs']);
  const IPTC_KEYS = new Set(['ObjectName', 'Caption', 'Keywords', 'Byline', 'BylineTitle',
    'Credit', 'Source', 'CopyrightNotice', 'City', 'Province', 'Country',
    'CountryCode', 'Category', 'SupplementalCategories', 'Headline', 'SpecialInstructions']);
  const ICC_KEYS = new Set(['ProfileDescription', 'ColorSpaceData', 'ProfileConnectionSpace',
    'ProfileClass', 'RenderingIntent', 'MediaWhitePoint', 'MediaBlackPoint',
    'RedColorant', 'GreenColorant', 'BlueColorant']);

  const exifData: Record<string, unknown> = {};
  const xmpData: Record<string, unknown> = {};
  const iptcData: Record<string, unknown> = {};
  const iccData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(base)) {
    if (pngData && key in pngData) {
      // Header/text chunk → `png` group. `Software` is mirrored into exif because the
      // stripped-metadata and editing-history heuristics read `exif.Software`.
      if (key === 'Software') exifData[key] = value;
      continue;
    }
    if (ICC_KEYS.has(key)) { iccData[key] = value; }
    else if (IPTC_KEYS.has(key)) { iptcData[key] = value; }
    else if (XMP_KEYS.has(key)) { xmpData[key] = value; }
    else { exifData[key] = value; }
  }

  return {
    exifData,
    xmpData,
    iptcData,
    iccData,
    pngData,
    gpsRaw: (gpsRaw ?? {}) as Record<string, unknown>,
    rawDates,
  };
}

const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt']);
/** A single prompt/workflow payload is a few KB; anything past this is not text we want to hold. */
const PNG_TEXT_MAX_CHUNK = 4 * 1024 * 1024;

/**
 * PNG text chunks. exifr surfaces `tEXt` only (and XMP hidden in iTXt); generators such as
 * Automatic1111 write non-Latin prompts as `iTXt`, and some tools compress them (`zTXt`,
 * compressed `iTXt`). Read all three so `parameters` / `prompt` / `workflow` show up.
 */
async function readPngTextChunks(file: File): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const latin1 = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');

  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset);
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length || type === 'IEND') break;
    if (PNG_TEXT_CHUNKS.has(type) && size <= PNG_TEXT_MAX_CHUNK) {
      try {
        const entry = await decodePngTextChunk(type, bytes.subarray(start, end), latin1, utf8);
        if (entry) out[entry.key] = entry.value;
      } catch {
        // Malformed or unsupported compression — skip this chunk, keep the rest.
      }
    }
    offset = end + 4; // + CRC
  }
  return out;
}

async function decodePngTextChunk(
  type: string,
  chunk: Uint8Array,
  latin1: TextDecoder,
  utf8: TextDecoder
): Promise<{ key: string; value: string } | null> {
  const nulAfter = (from: number) => {
    const index = chunk.indexOf(0, from);
    return index === -1 ? chunk.length : index;
  };
  const keyEnd = nulAfter(0);
  const key = latin1.decode(chunk.subarray(0, keyEnd)).trim();
  if (!key) return null;

  if (type === 'tEXt') {
    return { key, value: latin1.decode(chunk.subarray(keyEnd + 1)) };
  }

  if (type === 'zTXt') {
    // keyword \0 compressionMethod(1) compressedText
    if (chunk[keyEnd + 1] !== 0) return null;
    const text = await inflate(chunk.subarray(keyEnd + 2));
    return text ? { key, value: latin1.decode(text) } : null;
  }

  // iTXt: keyword \0 compressionFlag(1) compressionMethod(1) languageTag \0 translatedKeyword \0 text
  const compressed = chunk[keyEnd + 1] === 1;
  const method = chunk[keyEnd + 2];
  const languageEnd = nulAfter(keyEnd + 3);
  const translatedEnd = nulAfter(languageEnd + 1);
  const payload = chunk.subarray(translatedEnd + 1);
  if (!compressed) {
    return { key, value: utf8.decode(payload) };
  }
  if (method !== 0) return null;
  const text = await inflate(payload);
  return text ? { key, value: utf8.decode(text) } : null;
}

/**
 * The most text one chunk may inflate to. `PNG_TEXT_MAX_CHUNK` bounds the *compressed* size,
 * and deflate compresses a run of zeros about a thousandfold, so a 4 MB chunk could ask for
 * ~4 GB in one `arrayBuffer()`; a prompt or a ComfyUI workflow is a few hundred KB at most.
 */
const PNG_TEXT_MAX_INFLATED = 8 * 1024 * 1024;

/** zlib-inflate via the platform stream API; null when the browser has none or the text is past the budget. */
async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  // `slice()` copies onto a plain ArrayBuffer — Blob refuses a view over a SharedArrayBuffer-typed buffer.
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > PNG_TEXT_MAX_INFLATED) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

type HeicDecodeResult = {
  file: File;
  width: number;
  height: number;
};

const HEIC_MAX_SIDE = 2200;

/**
 * Try native browser HEIC decoding via createImageBitmap.
 * Works on Safari 17+, macOS Chrome (with system HEIC codec).
 */
async function tryNativeBitmapDecode(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width < 2 || bitmap.height < 2) {
      bitmap.close();
      return null;
    }
    return bitmap;
  } catch {
    return null;
  }
}

/**
 * Try decoding HEIC via <img> tag with object URL.
 * macOS browsers can often decode HEIC through system codecs
 * even when createImageBitmap doesn't support it.
 */
async function tryImgTagDecode(file: File): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    const loaded = await Promise.race([
      new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!loaded || img.naturalWidth < 2 || img.naturalHeight < 2) {
      URL.revokeObjectURL(url);
      return null;
    }
    // Don't revoke URL yet — caller needs it for canvas drawing
    return img;
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

export async function decodeHeicToJpegForPreview(sourceFile: File): Promise<HeicDecodeResult> {
  let image: { width: number; height: number; source: CanvasImageSource; cleanup?: () => void };

  // Strategy 1: createImageBitmap (Safari 17+, some macOS Chrome)
  const nativeBitmap = await tryNativeBitmapDecode(sourceFile);
  if (nativeBitmap) {
    image = {
      width: nativeBitmap.width,
      height: nativeBitmap.height,
      source: nativeBitmap,
      cleanup: () => nativeBitmap.close(),
    };
  } else {
    // Strategy 2: <img> tag with system codec (macOS)
    const nativeImg = await tryImgTagDecode(sourceFile);
    if (nativeImg) {
      const imgSrc = nativeImg.src; // object URL to revoke after canvas draw
      image = {
        width: nativeImg.naturalWidth,
        height: nativeImg.naturalHeight,
        source: nativeImg,
        cleanup: () => { if (imgSrc.startsWith('blob:')) URL.revokeObjectURL(imgSrc); },
      };
    } else {
      // Strategy 3: libheif-js WASM decoder (supports all HEIC variants).
      // The package default (`libheif-js`) inlines the 1.4 MB wasm as base64 into a 3 MB JS
      // chunk. The `libheif-wasm` variant ships the same emscripten glue (91 KB) with a
      // separate `.wasm` that Vite emits as a hashed asset; the factory instantiates
      // synchronously when handed `wasmBinary`, so the module is usable right away.
      const [glue, { default: wasmUrl }] = await Promise.all([
        import('libheif-js/libheif-wasm/libheif.js'),
        import('libheif-js/libheif-wasm/libheif.wasm?url'),
      ]);
      const wasmResponse = await fetch(wasmUrl);
      if (!wasmResponse.ok) throw new Error(`heic-convert: libheif.wasm ${wasmResponse.status}`);
      const wasmBinary = await wasmResponse.arrayBuffer();
      const createLibheif = ((glue as any).default ?? glue) as (options: { wasmBinary: ArrayBuffer }) => any;
      const libheif = createLibheif({ wasmBinary });
      const decoder = new libheif.HeifDecoder();
      const buffer = await sourceFile.arrayBuffer();
      const data = new Uint8Array(buffer);
      const images = decoder.decode(data);

      if (!images || images.length === 0) {
        throw new Error('heic-convert: libheif could not decode image');
      }

      const heifImage = images[0];
      const w = heifImage.get_width();
      const h = heifImage.get_height();

      // Render HEIC to canvas via display() callback
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');

      const imageData = ctx.createImageData(w, h);
      await new Promise<void>((resolve, reject) => {
        heifImage.display(imageData, (result: ImageData | null) => {
          if (!result) {
            reject(new Error('heic-convert: libheif display failed'));
            return;
          }
          ctx.putImageData(result, 0, 0);
          resolve();
        });
      });

      image = { width: w, height: h, source: canvas };
    }
  }

  const maxSide = Math.max(image.width, image.height);
  const scale = Math.min(1, HEIC_MAX_SIDE / Math.max(1, maxSide));
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    image.cleanup?.();
    throw new Error('canvas');
  }
  ctx.drawImage(image.source, 0, 0, targetWidth, targetHeight);
  image.cleanup?.();

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('jpeg-encode'));
        return;
      }
      resolve(result);
    }, 'image/jpeg', 0.92);
  });

  const safeName = sourceFile.name.replace(/\.(heic|heif)$/i, '') || 'photo';
  const file = new File([blob], `${safeName}.jpg`, { type: 'image/jpeg' });

  return {
    file,
    width: image.width,
    height: image.height
  };
}

async function safeExtract<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    console.warn('metadata-optional-extract', error);
    return undefined;
  }
}
