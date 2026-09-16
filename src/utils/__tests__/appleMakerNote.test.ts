import { describe, expect, it } from 'vitest';
import {
  encodeRuntimePlist,
  isAppleMakerNote,
  parseAppleMakerNote,
  parseBinaryPlist,
  runtimeSeconds
} from '../appleMakerNote';

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

interface Entry {
  tag: number;
  type: number;
  data: number[];
  count?: number;
}

/** An Apple MakerNote in the "MM" layout with the given IFD entries. */
function makerNote(entries: Entry[]): Uint8Array {
  const header = [...text('Apple iOS\0'), 0, 1, ...text('MM')];
  const ifdStart = header.length;
  const dataStart = ifdStart + 2 + entries.length * 12 + 4;
  const blobs: number[] = [];
  const ifd: number[] = [(entries.length >> 8) & 0xff, entries.length & 0xff];
  for (const entry of entries) {
    const count = entry.count ?? entry.data.length;
    ifd.push((entry.tag >> 8) & 0xff, entry.tag & 0xff, (entry.type >> 8) & 0xff, entry.type & 0xff);
    ifd.push((count >>> 24) & 0xff, (count >> 16) & 0xff, (count >> 8) & 0xff, count & 0xff);
    if (entry.data.length <= 4) {
      ifd.push(...entry.data, ...new Array(4 - entry.data.length).fill(0));
    } else {
      const offset = dataStart + blobs.length;
      ifd.push((offset >>> 24) & 0xff, (offset >> 16) & 0xff, (offset >> 8) & 0xff, offset & 0xff);
      blobs.push(...entry.data);
    }
  }
  ifd.push(0, 0, 0, 0);
  return new Uint8Array([...header, ...ifd, ...blobs]);
}

const int32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

describe('binary plist', () => {
  it('round-trips the CMTime dictionary Apple writes into RunTime', () => {
    const plist = encodeRuntimePlist(1_046_640_000_000_000, 1_000_000_000);
    expect(parseBinaryPlist(plist)).toEqual({
      flags: 1,
      value: 1_046_640_000_000_000,
      timescale: 1_000_000_000,
      epoch: 0
    });
    expect(runtimeSeconds(plist)).toBe(1_046_640);
  });
  it('yields null for junk', () => {
    expect(parseBinaryPlist(new Uint8Array(10))).toBeNull();
    expect(runtimeSeconds(new Uint8Array(text('bplist00')))).toBeNull();
  });
});

describe('parseAppleMakerNote', () => {
  it('rejects blocks from other makers', () => {
    expect(isAppleMakerNote(new Uint8Array(text('Nikon\0')))).toBe(false);
    expect(parseAppleMakerNote(new Uint8Array(text('SAMSUNG')))).toBeNull();
  });

  it('reads uptime, Live Photo, burst, capture mode, HDR and the camera', () => {
    const note = makerNote([
      { tag: 0x0001, type: 9, data: int32(14), count: 1 },
      { tag: 0x0003, type: 7, data: Array.from(encodeRuntimePlist(12 * 86_400 * 1e9 + 4 * 3600 * 1e9, 1e9)) },
      { tag: 0x000a, type: 9, data: int32(3), count: 1 },
      { tag: 0x000b, type: 2, data: [...text('8F2C1C1A-0000-4C6B-9C1B-7B1F2A3B4C5D'), 0] },
      { tag: 0x0011, type: 2, data: [...text('4A5B6C7D-1111-4E2F-8A9B-0C1D2E3F4A5B'), 0] },
      { tag: 0x0014, type: 9, data: int32(2), count: 1 },
      { tag: 0x002e, type: 9, data: int32(6), count: 1 }
    ]);
    expect(parseAppleMakerNote(note)).toEqual({
      uptimeSeconds: 12 * 86_400 + 4 * 3600,
      livePhoto: true,
      burst: true,
      captureType: 'portrait',
      hdr: true,
      cameraType: 'front',
      tags: [0x0001, 0x0003, 0x000a, 0x000b, 0x0011, 0x0014, 0x002e]
    });
  });

  it('treats an empty ContentIdentifier as no Live Photo and unknown codes as null', () => {
    const note = makerNote([
      { tag: 0x0011, type: 2, data: [0] },
      { tag: 0x0014, type: 9, data: int32(99), count: 1 },
      { tag: 0x000a, type: 9, data: int32(4), count: 1 }
    ]);
    expect(parseAppleMakerNote(note)).toMatchObject({
      livePhoto: false,
      burst: false,
      captureType: null,
      hdr: false,
      uptimeSeconds: null
    });
  });
});
