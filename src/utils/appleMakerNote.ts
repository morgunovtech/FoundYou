/*
 * Apple MakerNote: the private EXIF block iPhones and iPads write into every
 * photo. Viewers skip it, the file keeps it. It holds the time since the last
 * reboot (`RunTime`, a binary plist with a CMTime), the Live Photo link
 * (`ContentIdentifier`), the burst id, the capture mode and which camera
 * fired. Only a handful of tags are read; nothing here needs the network.
 *
 * Layout: "Apple iOS\0" + 0x0001 + "MM", then a big-endian TIFF IFD whose
 * offsets count from the start of the MakerNote itself.
 */

export type AppleCaptureType = 'proraw' | 'portrait' | 'photo' | 'manual-focus' | 'scene';
export type AppleCameraType = 'back-wide' | 'back-normal' | 'front';

export interface AppleMakerNote {
  /** Seconds since the device last booted, from `RunTime`. */
  uptimeSeconds: number | null;
  /** Live Photo: the still carries an id shared with a video in the gallery. */
  livePhoto: boolean;
  /** Part of a burst series (`BurstUUID`). */
  burst: boolean;
  captureType: AppleCaptureType | null;
  /** `HDRImageType`: 3 is an HDR render, 4 the original frame. */
  hdr: boolean | null;
  cameraType: AppleCameraType | null;
  /** Tags seen in the IFD, for the raw data table. */
  tags: number[];
}

const HEADER = 'Apple iOS';
const TAG_RUNTIME = 0x0003;
const TAG_HDR_IMAGE_TYPE = 0x000a;
const TAG_BURST_UUID = 0x000b;
const TAG_CONTENT_IDENTIFIER = 0x0011;
const TAG_IMAGE_CAPTURE_TYPE = 0x0014;
const TAG_CAMERA_TYPE = 0x002e;

const CAPTURE_TYPES: Record<number, AppleCaptureType> = {
  1: 'proraw',
  2: 'portrait',
  10: 'photo',
  11: 'manual-focus',
  12: 'scene'
};
const CAMERA_TYPES: Record<number, AppleCameraType> = { 0: 'back-wide', 1: 'back-normal', 6: 'front' };

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8
};

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  const end = Math.min(bytes.length, start + length);
  let text = '';
  for (let i = Math.max(0, start); i < end; i++) text += String.fromCharCode(bytes[i]);
  return text;
};

export function isAppleMakerNote(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && ascii(bytes, 0, HEADER.length) === HEADER;
}

/**
 * Parse the Apple MakerNote block; null when the bytes are not one. Never throws: a MakerNote
 * that does not fit its own offsets is a vendor quirk, not a reason to drop the whole EXIF.
 */
export function parseAppleMakerNote(bytes: Uint8Array): AppleMakerNote | null {
  try {
    return parseAppleMakerNoteStrict(bytes);
  } catch {
    return null;
  }
}

function parseAppleMakerNoteStrict(bytes: Uint8Array): AppleMakerNote | null {
  if (!isAppleMakerNote(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = ascii(bytes, 12, 2) === 'II';
  const ifd = 14;
  if (ifd + 2 > bytes.length) return null;
  const count = view.getUint16(ifd, littleEndian);
  if (count === 0 || count > 256) return null;

  const result: AppleMakerNote = {
    uptimeSeconds: null,
    livePhoto: false,
    burst: false,
    captureType: null,
    hdr: null,
    cameraType: null,
    tags: []
  };

  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > bytes.length) break;
    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    const valueCount = view.getUint32(entry + 4, littleEndian);
    const size = (TYPE_SIZES[type] ?? 1) * valueCount;
    const start = size <= 4 ? entry + 8 : view.getUint32(entry + 8, littleEndian);
    if (start + size > bytes.length) continue;
    result.tags.push(tag);
    const value = bytes.subarray(start, start + size);

    switch (tag) {
      case TAG_RUNTIME:
        result.uptimeSeconds = runtimeSeconds(value);
        break;
      case TAG_HDR_IMAGE_TYPE:
        if (type === 9 || type === 4) {
          // 3 is an HDR render, 4 the original frame; other codes (older devices) say nothing.
          const code = view.getInt32(start, littleEndian);
          result.hdr = code === 3 ? true : code === 4 ? false : null;
        }
        break;
      case TAG_BURST_UUID:
        result.burst = ascii(value, 0, value.length).replace(/\0+$/, '').length > 0;
        break;
      case TAG_CONTENT_IDENTIFIER:
        result.livePhoto = ascii(value, 0, value.length).replace(/\0+$/, '').length > 0;
        break;
      case TAG_IMAGE_CAPTURE_TYPE:
        if (type === 9 || type === 4) result.captureType = CAPTURE_TYPES[view.getInt32(start, littleEndian)] ?? null;
        break;
      case TAG_CAMERA_TYPE:
        if (type === 9 || type === 4) result.cameraType = CAMERA_TYPES[view.getInt32(start, littleEndian)] ?? null;
        break;
      default:
        break;
    }
  }
  return result;
}

/* ── RunTime: a binary plist with a CMTime dictionary ────────────────────── */

/** `{ value, timescale }` → seconds; null when the plist does not hold a usable CMTime. */
export function runtimeSeconds(plist: Uint8Array): number | null {
  let root: PlistValue;
  try {
    root = parseBinaryPlist(plist);
  } catch {
    return null;
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  const dict = root as Record<string, unknown>;
  const value = dict.value;
  const timescale = dict.timescale;
  if (typeof value !== 'number' || typeof timescale !== 'number' || timescale <= 0 || value < 0) return null;
  const seconds = value / timescale;
  return Number.isFinite(seconds) ? seconds : null;
}

type PlistValue = null | boolean | number | string | Uint8Array | PlistValue[] | { [key: string]: PlistValue };

/**
 * Minimal reader for `bplist00`: integers, reals, ASCII / UTF-16 strings, data, arrays and
 * dictionaries. Enough for the CMTime Apple writes; anything else yields null.
 */
export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  if (bytes.length < 40 || ascii(bytes, 0, 8) !== 'bplist00') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6];
  const refSize = bytes[trailer + 7];
  const objectCount = Number(view.getBigUint64(trailer + 8));
  const topObject = Number(view.getBigUint64(trailer + 16));
  const tableOffset = Number(view.getBigUint64(trailer + 24));
  if (
    !offsetSize ||
    !refSize ||
    objectCount <= 0 ||
    objectCount > 4096 ||
    tableOffset + objectCount * offsetSize > bytes.length
  )
    return null;

  const readUint = (at: number, size: number): number => {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + bytes[at + i];
    return value;
  };
  const offsets: number[] = [];
  for (let i = 0; i < objectCount; i++) offsets.push(readUint(tableOffset + i * offsetSize, offsetSize));

  // Every read is checked against the buffer: a plist whose offsets point past its own end is
  // reported as "no value", never as an exception that escapes the parser.
  const outOfRange = () => new RangeError('bplist: read past the end');
  const readInt = (at: number, size: number): number => {
    if (at < 0 || at + size > bytes.length) throw outOfRange();
    if (size === 8) return Number(view.getBigInt64(at));
    if (size === 4) return view.getUint32(at);
    if (size === 2) return view.getUint16(at);
    return bytes[at];
  };

  // `seen` guards against reference cycles on the current path only: CoreFoundation shares equal
  // objects (a dict whose `value` and `timescale` are the same integer), so an index may be read
  // again once its subtree is done. That sharing is also what makes a path-only guard
  // insufficient on its own: a chain of arrays each holding its successor twice is read 2^depth
  // times — measured, 22 levels took 742 ms and 40 levels fit in 250 bytes — so every parse also
  // has a budget of object reads. A real MakerNote plist (a CMTime dict, a few integers) needs a
  // handful; a crafted one runs out of budget and reads as no value.
  const seen = new Set<number>();
  const PLIST_READ_BUDGET = 10_000;
  let budget = PLIST_READ_BUDGET;
  const readObject = (index: number): PlistValue => {
    if (!Number.isInteger(index) || index < 0 || index >= offsets.length || seen.has(index)) return null;
    if (--budget < 0) throw new RangeError('bplist: too many object reads');
    seen.add(index);
    try {
      return readObjectAt(offsets[index]);
    } finally {
      seen.delete(index);
    }
  };
  const readObjectAt = (at: number): PlistValue => {
    if (!(at >= 0 && at < bytes.length)) return null;
    const marker = bytes[at];
    const kind = marker >> 4;
    const info = marker & 0x0f;
    let cursor = at + 1;
    /** Element count (or byte length) of the object; never more than the buffer could hold. */
    const readLength = (unit: number) => {
      let length = info;
      if (info === 0x0f) {
        if (cursor >= bytes.length) throw outOfRange();
        const intMarker = bytes[cursor];
        const intSize = 1 << (intMarker & 0x0f);
        length = readInt(cursor + 1, intSize);
        cursor += 1 + intSize;
      }
      if (!Number.isFinite(length) || length < 0 || cursor + length * unit > bytes.length) throw outOfRange();
      return length;
    };
    switch (kind) {
      case 0x0:
        return info === 0x08 ? false : info === 0x09 ? true : null;
      case 0x1:
        return readInt(cursor, 1 << info);
      case 0x2: {
        const size = info === 3 ? 8 : info === 2 ? 4 : 0;
        if (size === 0) return null;
        if (cursor + size > bytes.length) throw outOfRange();
        return size === 8 ? view.getFloat64(cursor) : view.getFloat32(cursor);
      }
      case 0x4: {
        const length = readLength(1);
        return bytes.subarray(cursor, cursor + length);
      }
      case 0x5: {
        const length = readLength(1);
        return ascii(bytes, cursor, length);
      }
      case 0x6: {
        const length = readLength(2);
        let text = '';
        for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint16(cursor + i * 2));
        return text;
      }
      case 0xa: {
        const length = readLength(refSize);
        const items: PlistValue[] = [];
        for (let i = 0; i < length; i++) items.push(readObject(readUint(cursor + i * refSize, refSize)));
        return items;
      }
      case 0xd: {
        const length = readLength(2 * refSize);
        const dict: { [key: string]: PlistValue } = {};
        for (let i = 0; i < length; i++) {
          const key = readObject(readUint(cursor + i * refSize, refSize));
          const value = readObject(readUint(cursor + (length + i) * refSize, refSize));
          if (typeof key === 'string') dict[key] = value;
        }
        return dict;
      }
      default:
        return null;
    }
  };
  try {
    return readObject(topObject);
  } catch {
    return null;
  }
}

/** Wraps a small binary plist around a CMTime dictionary; used by tests and fixtures. */
export function encodeRuntimePlist(value: number, timescale: number): Uint8Array {
  // Objects: 0 dict, 1 "flags", 2 "value", 3 "timescale", 4 "epoch", 5 int 1, 6 int value, 7 int timescale, 8 int 0.
  const keys = ['flags', 'value', 'timescale', 'epoch'];
  const parts: number[][] = [];
  const offsets: number[] = [];
  let position = 8;
  const push = (part: number[]) => {
    offsets.push(position);
    parts.push(part);
    position += part.length;
  };
  push([0xd4, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const key of keys) push([0x50 | key.length, ...Array.from(key, (c) => c.charCodeAt(0))]);
  const int64 = (n: number) => {
    const out = new Uint8Array(9);
    out[0] = 0x13;
    new DataView(out.buffer).setBigInt64(1, BigInt(Math.floor(n)));
    return Array.from(out);
  };
  push(int64(1));
  push(int64(value));
  push(int64(timescale));
  push(int64(0));
  const tableOffset = position;
  const offsetSize = 2;
  const table = offsets.flatMap((o) => [(o >> 8) & 0xff, o & 0xff]);
  const trailer = new Uint8Array(32);
  const tv = new DataView(trailer.buffer);
  trailer[6] = offsetSize;
  trailer[7] = 1;
  tv.setBigUint64(8, BigInt(offsets.length));
  tv.setBigUint64(16, 0n);
  tv.setBigUint64(24, BigInt(tableOffset));
  return new Uint8Array([...Array.from('bplist00', (c) => c.charCodeAt(0)), ...parts.flat(), ...table, ...trailer]);
}
