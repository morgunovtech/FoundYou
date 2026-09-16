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
 * Any option may be omitted; only --lat and --lon are required for the GPS block.
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
    'usage: make-exif-fixture.mjs in.jpg out.jpg [--lat --lon --alt --acc --heading --speed --date --offset --gps-time --make --model --lens --focal35]'
  );
  process.exit(1);
}
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

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

const exifEntries = [{ tag: 0x9003, type: ASCII, count: date.length + 1, data: ascii(date) }];
if (offset) exifEntries.push({ tag: 0x9011, type: ASCII, count: offset.length + 1, data: ascii(offset) });
if (focal35 != null) exifEntries.push({ tag: 0xa405, type: SHORT, count: 1, data: short(focal35) });
if (lens) exifEntries.push({ tag: 0xa434, type: ASCII, count: lens.length + 1, data: ascii(lens) });

const gpsEntries = [
  { tag: 0x0000, type: BYTE, count: 4, data: Buffer.from([2, 3, 0, 0]) },
  { tag: 0x0001, type: ASCII, count: 2, data: ascii(lat >= 0 ? 'N' : 'S') },
  { tag: 0x0002, type: RATIONAL, count: 3, data: rat(dms(Math.abs(lat))) },
  { tag: 0x0003, type: ASCII, count: 2, data: ascii(lon >= 0 ? 'E' : 'W') },
  { tag: 0x0004, type: RATIONAL, count: 3, data: rat(dms(Math.abs(lon))) },
  { tag: 0x0005, type: BYTE, count: 1, data: Buffer.from([0]) },
  { tag: 0x0006, type: RATIONAL, count: 1, data: rat([[Math.round(alt * 100), 100]]) },
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
  { tag: 0x8769, type: LONG, count: 1, data: long(0) },
  { tag: 0x8825, type: LONG, count: 1, data: long(0) }
];
const ifd0Offset = 8;
const exifOffset = ifd0Offset + ifdLength(ifd0Entries);
const gpsOffset = exifOffset + ifdLength(exifEntries);
ifd0Entries[2].data = long(exifOffset);
ifd0Entries[3].data = long(gpsOffset);

const tiff = Buffer.concat([
  Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
  ifd(ifd0Entries, ifd0Offset),
  ifd(exifEntries, exifOffset),
  ifd(gpsEntries, gpsOffset)
]);
const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
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
writeFileSync(output, Buffer.concat([jpeg.subarray(0, 2), marker, payload, rest]));
console.log(`${output}: EXIF ${payload.length} bytes, GPS ${lat}, ${lon}`);
