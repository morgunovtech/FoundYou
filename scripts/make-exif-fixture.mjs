#!/usr/bin/env node
/**
 * Writes an EXIF APP1 segment into a JPEG so the analyzer has something to read:
 * GPS position, altitude, accuracy, heading, speed, GPS time, capture date with
 * its offset, device and lens. Everything else in the file is left untouched.
 *
 *   node scripts/make-exif-fixture.mjs in.jpg out.jpg \
 *     --lat 41.36123 --lon 69.92395 --alt 1287 --acc 14 --heading 312 --speed 0.4 \
 *     --date "2026:09:14 13:20:00" --offset +03:00 --gps-time 10:20:03 \
 *     --make Apple --model "iPhone 15 Pro" --lens "iPhone 15 Pro back triple camera 6.765mm f/1.78" --focal35 24
 *
 * Any option may be omitted; only --lat and --lon are required for the GPS block. A negative
 * --alt (below sea level: the Dead Sea shore, a mine) is written as its magnitude with
 * GPSAltitudeRef = 1, the way the EXIF spec encodes it — every RATIONAL here is unsigned.
 *
 * Vendor blocks for the «Device» card: --software "26.2" (iOS version in the Software tag),
 * --apple-uptime 1051200 (an Apple MakerNote with RunTime, a Live Photo id, a burst id and
 * the portrait capture mode), --samsung-mcc 434 (a Samsung SEF trailer after the EOI with
 * MCC_Data, Image_UTC_Data and a small MotionPhoto_Data payload).
 *
 * File history: --modify-date "2026:09:20 11:00:00" (IFD0 ModifyDate later than the shot),
 * --exif-size 4032x3024 (the pixel size the camera "wrote", to make the file look downscaled),
 * --thumbnail other.jpg (an IFD1 thumbnail; pass a different picture to make it mismatch),
 * --orientation 6 (the IFD0 Orientation tag: 6 = rotate 90° CW, the usual portrait phone photo).
 *
 * Author block for the «Автор и контакты» card: --artist "Семён Моргунов" (IFD0 Artist, what
 * Lightroom and a DSLR body write) and --copyright "© 2026 MOR TECH" (IFD0 Copyright).
 *
 * Samsung layout: --samsung-video-size 300000 (bytes of the MotionPhoto_Data payload; above 256 KB
 * the video starts before the tail window the parser reads) and --samsung-video-last (the small
 * MCC/UTC blocks written before the video instead of after it).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ASCII = 2;
const BYTE = 1;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

const args = process.argv.slice(2);
const [input, output] = args;
if (!input || !output) {
  console.error(
    'usage: make-exif-fixture.mjs in.jpg out.jpg [--lat --lon --alt --acc --heading --speed --date --offset --gps-time --make --model --lens --focal35 --software --apple-uptime --samsung-mcc --samsung-video-size --samsung-video-last --modify-date --exif-size --thumbnail --orientation --exposure --fnumber --iso --flash --digitized --artist --copyright]'
  );
  process.exit(1);
}
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const artist = opt('artist', '');
const copyright = opt('copyright', '');
const lat = Number(opt('lat', '41.36123'));
const lon = Number(opt('lon', '69.92395'));
const alt = Number(opt('alt', '1287'));
const acc = Number(opt('acc', '14'));
const heading = opt('heading') != null ? Number(opt('heading')) : null;
const speedKmh = opt('speed') != null ? Number(opt('speed')) : null;
const date = opt('date', '2026:09:14 13:20:00');
const offset = opt('offset', null);
const gpsTime = opt('gps-time', null);
const make = opt('make', 'Apple');
const model = opt('model', 'iPhone 15 Pro');
const lens = opt('lens', null);
const focal35 = opt('focal35') != null ? Number(opt('focal35')) : null;
const software = opt('software', null);
const appleUptime = opt('apple-uptime') != null ? Number(opt('apple-uptime')) : null;
const samsungMcc = opt('samsung-mcc', null);
const modifyDate = opt('modify-date', null);
const exifSize = opt('exif-size', null);
const thumbnailPath = opt('thumbnail', null);
const orientation = opt('orientation') != null ? Number(opt('orientation')) : null;
const samsungVideoSize = opt('samsung-video-size') != null ? Number(opt('samsung-video-size')) : 24_000;
const samsungVideoLast = args.includes('--samsung-video-last');
// Exposure for the «light vs time» check: --exposure 1/1000 (or seconds), --fnumber 1.8, --iso 50, --flash 1 (fired).
const exposure = opt('exposure', null);
const fnumber = opt('fnumber') != null ? Number(opt('fnumber')) : null;
const iso = opt('iso') != null ? Number(opt('iso')) : null;
const flash = opt('flash') != null ? Number(opt('flash')) : null;
// DateTimeDigitized, for the timestamp consistency row.
const digitized = opt('digitized', null);

const ascii = (s) => Buffer.from(`${s}\0`, 'latin1');
const short = (v) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const long = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const rat = (pairs) => {
  const b = Buffer.alloc(pairs.length * 8);
  pairs.forEach(([n, d], i) => {
    // EXIF type 5 is an unsigned pair; a sign lives in its own *Ref tag (see GPSAltitudeRef).
    if (!(n >= 0) || !(d >= 0)) {
      console.error(`RATIONAL values are unsigned: cannot write ${n}/${d}. Write the magnitude and a *Ref tag instead.`);
      process.exit(1);
    }
    b.writeUInt32LE(n, i * 8);
    b.writeUInt32LE(d, i * 8 + 4);
  });
  return b;
};
const dms = (deg) => {
  const d = Math.floor(deg);
  const mf = (deg - d) * 60;
  const m = Math.floor(mf);
  const s = Math.round((mf - m) * 60 * 100);
  return [
    [d, 1],
    [m, 1],
    [s, 100]
  ];
};

/** One IFD: entries sorted by tag; values over 4 bytes go to a data area right after the IFD. */
function ifd(entries, baseOffset) {
  entries.sort((a, b) => a.tag - b.tag);
  const n = entries.length;
  const head = 2 + n * 12 + 4;
  const buf = Buffer.alloc(head);
  buf.writeUInt16LE(n, 0);
  let dataOffset = head;
  const extra = [];
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    buf.writeUInt16LE(e.tag, o);
    buf.writeUInt16LE(e.type, o + 2);
    buf.writeUInt32LE(e.count, o + 4);
    if (e.data.length <= 4) e.data.copy(buf, o + 8);
    else {
      buf.writeUInt32LE(baseOffset + dataOffset, o + 8);
      extra.push(e.data);
      dataOffset += e.data.length;
    }
  });
  buf.writeUInt32LE(0, head - 4);
  return Buffer.concat([buf, ...extra]);
}

function ifdLength(entries) {
  return 2 + entries.length * 12 + 4 + entries.reduce((sum, e) => sum + (e.data.length > 4 ? e.data.length : 0), 0);
}

const UNDEFINED = 7;

/** A binary plist holding the CMTime dictionary Apple writes into MakerNote RunTime. */
function runtimePlist(seconds) {
  const keys = ['flags', 'value', 'timescale', 'epoch'];
  const parts = [];
  const offsets = [];
  let position = 8;
  const push = (part) => {
    offsets.push(position);
    parts.push(Buffer.from(part));
    position += part.length;
  };
  push([0xd4, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const key of keys) push([0x50 | key.length, ...Buffer.from(key, 'latin1')]);
  const int64 = (n) => {
    const out = Buffer.alloc(9);
    out[0] = 0x13;
    out.writeBigInt64BE(BigInt(Math.floor(n)), 1);
    return [...out];
  };
  push(int64(1));
  push(int64(seconds * 1e9));
  push(int64(1e9));
  push(int64(0));
  const table = Buffer.from(offsets.flatMap((o) => [(o >> 8) & 0xff, o & 0xff]));
  const trailer = Buffer.alloc(32);
  trailer[6] = 2;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(offsets.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(position), 24);
  return Buffer.concat([Buffer.from('bplist00', 'latin1'), ...parts, table, trailer]);
}

/** An Apple MakerNote: "Apple iOS\0" + 0001 + "MM" and a big-endian IFD with offsets from the block start. */
function appleMakerNote(seconds) {
  const entries = [
    { tag: 0x0001, type: 9, count: 1, data: Buffer.from([0, 0, 0, 14]) },
    { tag: 0x0003, type: UNDEFINED, data: runtimePlist(seconds) },
    { tag: 0x000a, type: 9, count: 1, data: Buffer.from([0, 0, 0, 3]) },
    { tag: 0x000b, type: ASCII, data: Buffer.from('7A4E0C9B-5D2F-4B11-9C7A-1F2E3D4C5B6A\0', 'latin1') },
    { tag: 0x0011, type: ASCII, data: Buffer.from('C3D2E1F0-1234-4A5B-8C9D-0E1F2A3B4C5D\0', 'latin1') },
    { tag: 0x0014, type: 9, count: 1, data: Buffer.from([0, 0, 0, 2]) },
    { tag: 0x002e, type: 9, count: 1, data: Buffer.from([0, 0, 0, 1]) }
  ];
  const header = Buffer.from('Apple iOS\0\0\x01MM', 'latin1');
  const head = 2 + entries.length * 12 + 4;
  const ifdBuf = Buffer.alloc(head);
  ifdBuf.writeUInt16BE(entries.length, 0);
  let dataOffset = header.length + head;
  const extra = [];
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    ifdBuf.writeUInt16BE(e.tag, o);
    ifdBuf.writeUInt16BE(e.type, o + 2);
    ifdBuf.writeUInt32BE(e.count ?? e.data.length, o + 4);
    if (e.data.length <= 4) e.data.copy(ifdBuf, o + 8);
    else {
      ifdBuf.writeUInt32BE(dataOffset, o + 8);
      extra.push(e.data);
      dataOffset += e.data.length;
    }
  });
  return Buffer.concat([header, ifdBuf, ...extra]);
}

/** A Samsung SEF trailer: blocks, then the SEFH directory, its length and "SEFT". */
function samsungTrailer(mcc, dateText) {
  const utc = String(Date.parse(dateText.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T') + (offset ?? 'Z')));
  const video = { type: 0x0a30, name: 'MotionPhoto_Data', data: Buffer.alloc(samsungVideoSize, 0x42) };
  const small = [
    { type: 0x0a01, name: 'Image_UTC_Data', data: Buffer.from(utc, 'latin1') },
    { type: 0x0aa1, name: 'MCC_Data', data: Buffer.from(mcc, 'latin1') }
  ];
  const blocks = samsungVideoLast ? [...small, video] : [video, ...small];
  const encoded = blocks.map((b) => Buffer.concat([long(b.type), long(b.name.length), Buffer.from(b.name, 'latin1'), b.data]));
  const body = Buffer.concat(encoded);
  const entries = [];
  let position = 0;
  for (const block of encoded) {
    entries.push(Buffer.concat([long(0), long(body.length - position), long(block.length)]));
    position += block.length;
  }
  const dir = Buffer.concat([Buffer.from('SEFH', 'latin1'), long(0x106), long(blocks.length), ...entries]);
  return Buffer.concat([body, dir, long(dir.length), Buffer.from('SEFT', 'latin1')]);
}

const exifEntries = [{ tag: 0x9003, type: ASCII, count: date.length + 1, data: ascii(date) }];
if (appleUptime != null) {
  const note = appleMakerNote(appleUptime);
  exifEntries.push({ tag: 0x927c, type: UNDEFINED, count: note.length, data: note });
}
if (exifSize) {
  const [w, h] = exifSize.split('x').map(Number);
  exifEntries.push({ tag: 0xa002, type: LONG, count: 1, data: long(w) });
  exifEntries.push({ tag: 0xa003, type: LONG, count: 1, data: long(h) });
}
if (offset) exifEntries.push({ tag: 0x9011, type: ASCII, count: offset.length + 1, data: ascii(offset) });
if (focal35 != null) exifEntries.push({ tag: 0xa405, type: SHORT, count: 1, data: short(focal35) });
if (lens) exifEntries.push({ tag: 0xa434, type: ASCII, count: lens.length + 1, data: ascii(lens) });
if (exposure) {
  const [n, d] = exposure.includes('/') ? exposure.split('/').map(Number) : [Math.round(Number(exposure) * 1_000_000), 1_000_000];
  exifEntries.push({ tag: 0x829a, type: RATIONAL, count: 1, data: rat([[n, d]]) });
}
if (fnumber != null) exifEntries.push({ tag: 0x829d, type: RATIONAL, count: 1, data: rat([[Math.round(fnumber * 100), 100]]) });
if (iso != null) exifEntries.push({ tag: 0x8827, type: SHORT, count: 1, data: short(iso) });
if (flash != null) exifEntries.push({ tag: 0x9209, type: SHORT, count: 1, data: short(flash) });
if (digitized) exifEntries.push({ tag: 0x9004, type: ASCII, count: digitized.length + 1, data: ascii(digitized) });

const gpsEntries = [
  { tag: 0x0000, type: BYTE, count: 4, data: Buffer.from([2, 3, 0, 0]) },
  { tag: 0x0001, type: ASCII, count: 2, data: ascii(lat >= 0 ? 'N' : 'S') },
  { tag: 0x0002, type: RATIONAL, count: 3, data: rat(dms(Math.abs(lat))) },
  { tag: 0x0003, type: ASCII, count: 2, data: ascii(lon >= 0 ? 'E' : 'W') },
  { tag: 0x0004, type: RATIONAL, count: 3, data: rat(dms(Math.abs(lon))) },
  // GPSAltitudeRef: 0 above sea level, 1 below; GPSAltitude is always the magnitude.
  { tag: 0x0005, type: BYTE, count: 1, data: Buffer.from([alt < 0 ? 1 : 0]) },
  { tag: 0x0006, type: RATIONAL, count: 1, data: rat([[Math.round(Math.abs(alt) * 100), 100]]) },
  { tag: 0x001f, type: RATIONAL, count: 1, data: rat([[Math.round(acc * 100), 100]]) }
];
if (gpsTime) {
  const [h, m, s] = gpsTime.split(':').map(Number);
  gpsEntries.push({
    tag: 0x0007,
    type: RATIONAL,
    count: 3,
    data: rat([
      [h, 1],
      [m, 1],
      [s || 0, 1]
    ])
  });
  gpsEntries.push({ tag: 0x001d, type: ASCII, count: 11, data: ascii(date.slice(0, 10)) });
}
if (speedKmh != null) {
  gpsEntries.push({ tag: 0x000c, type: ASCII, count: 2, data: ascii('K') });
  gpsEntries.push({ tag: 0x000d, type: RATIONAL, count: 1, data: rat([[Math.round(speedKmh * 100), 100]]) });
}
if (heading != null) {
  gpsEntries.push({ tag: 0x0010, type: ASCII, count: 2, data: ascii('T') });
  gpsEntries.push({ tag: 0x0011, type: RATIONAL, count: 1, data: rat([[Math.round(heading * 100), 100]]) });
}

const ifd0Entries = [
  { tag: 0x010f, type: ASCII, count: make.length + 1, data: ascii(make) },
  { tag: 0x0110, type: ASCII, count: model.length + 1, data: ascii(model) },
  // The author block of the «Автор и контакты» card: IFD0 Artist and Copyright.
  ...(artist ? [{ tag: 0x013b, type: ASCII, count: artist.length + 1, data: ascii(artist) }] : []),
  ...(copyright ? [{ tag: 0x8298, type: ASCII, count: copyright.length + 1, data: ascii(copyright) }] : []),
  ...(software ? [{ tag: 0x0131, type: ASCII, count: software.length + 1, data: ascii(software) }] : []),
  ...(modifyDate ? [{ tag: 0x0132, type: ASCII, count: modifyDate.length + 1, data: ascii(modifyDate) }] : []),
  ...(orientation != null ? [{ tag: 0x0112, type: SHORT, count: 1, data: short(orientation) }] : []),
  { tag: 0x8769, type: LONG, count: 1, data: long(0) },
  { tag: 0x8825, type: LONG, count: 1, data: long(0) }
];
const ifd0Offset = 8;
const exifOffset = ifd0Offset + ifdLength(ifd0Entries);
const gpsOffset = exifOffset + ifdLength(exifEntries);
ifd0Entries.find((e) => e.tag === 0x8769).data = long(exifOffset);
ifd0Entries.find((e) => e.tag === 0x8825).data = long(gpsOffset);

// IFD1 (the thumbnail directory) follows the GPS IFD; IFD0's "next IFD" pointer leads to it.
const thumbnail = thumbnailPath ? readFileSync(thumbnailPath) : null;
const ifd1Offset = gpsOffset + ifdLength(gpsEntries);
const ifd1Entries = thumbnail
  ? [
      { tag: 0x0103, type: SHORT, count: 1, data: short(6) },
      { tag: 0x0201, type: LONG, count: 1, data: long(0) },
      { tag: 0x0202, type: LONG, count: 1, data: long(thumbnail.length) }
    ]
  : [];
if (thumbnail) ifd1Entries[1].data = long(ifd1Offset + ifdLength(ifd1Entries));
const ifd0Buf = ifd(ifd0Entries, ifd0Offset);
if (thumbnail) ifd0Buf.writeUInt32LE(ifd1Offset, 2 + ifd0Entries.length * 12); // IFD0's «next IFD» pointer → IFD1
const tiff = Buffer.concat([
  Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
  ifd0Buf,
  ifd(exifEntries, exifOffset),
  ifd(gpsEntries, gpsOffset),
  ...(thumbnail ? [ifd(ifd1Entries, ifd1Offset), thumbnail] : [])
]);
const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
if (payload.length + 2 > 0xffff) {
  console.error(`the EXIF segment would be ${payload.length + 2} bytes; a JPEG segment holds at most 65535 (use a smaller --thumbnail)`);
  process.exit(1);
}
const marker = Buffer.alloc(4);
marker.writeUInt16BE(0xffe1, 0);
marker.writeUInt16BE(payload.length + 2, 2);

const jpeg = readFileSync(input);
if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
  console.error(`${input} is not a JPEG`);
  process.exit(1);
}
// Drop an existing APP1 Exif segment right after SOI so the file carries one metadata block.
let rest = jpeg.subarray(2);
if (rest[0] === 0xff && rest[1] === 0xe1 && rest.subarray(4, 10).toString('latin1') === 'Exif\0\0') {
  rest = rest.subarray(2 + rest.readUInt16BE(2));
}
// A Samsung trailer goes after the whole JPEG (past the EOI marker), as the phones write it.
const trailer = samsungMcc ? samsungTrailer(samsungMcc, date) : Buffer.alloc(0);
writeFileSync(output, Buffer.concat([jpeg.subarray(0, 2), marker, payload, rest, trailer]));
console.log(`${output}: EXIF ${payload.length} bytes, GPS ${lat}, ${lon}${trailer.length ? `, Samsung trailer ${trailer.length} bytes` : ''}`);
